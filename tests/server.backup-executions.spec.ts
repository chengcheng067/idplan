/**
 * 服务端备份：执行域四表的**数据丢失缺陷**回归防线（v0.8 · T04-SRV）。
 *
 * ── 被锁死的真实缺陷 ──
 * `server/schema.sql` 自 v5 起就建好了执行域四表，但服务端 dump 清单（三处：
 * `GET /api/backup` 的 data、`POST /api/bootstrap`、`POST /api/backup/import` 的 map）
 * **只列了 9 张表**，四张执行域表全部缺失。后果是数据**静默整片丢失**：
 *   · 服务端备份 → 四表数据不进备份文件；
 *   · NAS → NAS 迁移（backup → import）→ 执行域数据在新机器上完全不存在；
 *   · bootstrap 启动装载 → 前端拿不到任何执行单。
 * 全程**无报错、无日志**，因为「少 dump 一张表」在 SQL 层面完全合法。
 *
 * ── 本 spec 锁死五条 ──
 *   ① 三处清单都含四表（导出 / bootstrap / 导入回灌能力）；
 *   ② 带数据的四表：导出 → 清库 → 导入 → 再导出，逐表 JSON.stringify 相等（保真）；
 *   ③ JSON 列序列化：`operations` 必须是**数组**（不是字符串），`confirmation` 必须是
 *      **对象**（不是 `[]`、不是字符串）—— 前者会让前端 zod 拒收整包，后者会摧毁确认凭据；
 *   ④ 导入顺序：DELETE 逆序 / INSERT 正序，外键约束真实生效（顺序错了会响亮失败）；
 *   ⑤ 旧包（无四键）导入不报错、四表清空（清库重建语义）。
 */

import { describe, expect, it, beforeEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

// T14：备份通道 fail-closed，本 spec 的 backup 请求必须带 token（模块级设置）
process.env.IDPLAN_AGENT_TOKEN = 'test-token';

import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';
import { registerTaskRoutes } from '../server/routes/tasks.routes';
import { registerMemberRoutes } from '../server/routes/members.routes';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { registerExecutionRoutes } from '../server/routes/executions.routes';
import { validateBackupJson } from '../src/core/services/backup.service';

const AUTH = { authorization: 'Bearer test-token' };
const PROJECT_ID = 'proj_bk';

async function buildServer(): Promise<{ app: FastifyInstance; db: Database.Database }> {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createDb(db);
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) => {
    void reply.status(err.statusCode ?? 500).send({
      error: {
        code: String((err as { code?: string }).code ?? 'internal'),
        userMessage: (err as { userMessage?: string }).userMessage ?? '服务器内部错误',
      },
    });
  });
  registerProjectRoutes(app, db);
  registerStageRoutes(app, db);
  registerTaskRoutes(app, db);
  registerMemberRoutes(app, db);
  registerMetaRoutes(app, db);
  registerExecutionRoutes(app, db);
  await app.ready();
  return { app, db };
}

/** 造一条完整执行域数据（执行单 + 尝试 + 事件 + 提案），返回各 id */
async function seedExecutionDomain(app: FastifyInstance): Promise<{
  executionId: string;
  attemptId: string;
  proposalId: string;
}> {
  await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      id: PROJECT_ID,
      name: '备份执行域项目',
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-08-01',
      plannedEndAt: '2026-12-31',
      coverColor: null,
    },
  });

  const created = await app.inject({
    method: 'POST',
    url: `/api/projects/${PROJECT_ID}/executions`,
    payload: {
      source: 'project-task',
      objective: '把阶段二的排期挪到下周（含中文与 ✅ emoji）',
      idempotencyKey: 'exec:project-task:proj_bk:seed',
    },
  });
  const executionId = created.json<{ id: string }>().id;

  await app.inject({
    method: 'PATCH',
    url: `/api/executions/${executionId}`,
    payload: { status: 'awaiting_confirmation' },
  });
  await app.inject({
    method: 'PATCH',
    url: `/api/executions/${executionId}`,
    payload: {
      status: 'queued',
      confirmation: {
        confirmedAt: '2026-09-01T00:00:00.000Z',
        confirmedBy: 'm_human',
        planHash: 'hash_seed',
        planRevision: 2,
      },
    },
  });

  const attemptRes = await app.inject({
    method: 'POST',
    url: `/api/executions/${executionId}/attempts`,
    payload: { runtimeKind: 'local' },
  });
  const attemptId = attemptRes.json<{ id: string }>().id;

  await app.inject({
    method: 'POST',
    url: `/api/executions/${executionId}/events`,
    payload: { seq: 1, type: 'created', actor: 'system' },
  });

  const proposalRes = await app.inject({
    method: 'POST',
    url: `/api/executions/${executionId}/proposals`,
    payload: {
      projectId: PROJECT_ID,
      attemptId,
      operations: [
        { field: 'task.status', before: 'todo', after: 'done' },
        { field: 'task.notes.append', before: null, after: '多行\n文本', nested: { a: [1, 2] } },
      ],
      idempotencyKey: 'wb:seed',
    },
  });
  const proposalId = proposalRes.json<{ id: string }>().id;

  return { executionId, attemptId, proposalId };
}

/** 归一化用于 diff：抹掉 exportedAt（每次都变），并按 id 排序（SQLite 行序不保证） */
function normalize(pkg: unknown): string {
  const p = JSON.parse(
    JSON.stringify(pkg, (key, value) => (key === 'exportedAt' ? undefined : value)),
  ) as { data: Record<string, Array<{ id?: string; key?: string }>> };
  for (const key of Object.keys(p.data)) {
    const rows = p.data[key];
    if (Array.isArray(rows)) {
      rows.sort((a, b) => String(a.id ?? a.key ?? '').localeCompare(String(b.id ?? b.key ?? '')));
    }
  }
  return JSON.stringify(p);
}

const EXEC_TABLES = [
  'executions',
  'executionAttempts',
  'executionEvents',
  'writebackProposals',
] as const;

describe('① 三处 dump 清单都含执行域四表', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
  });

  it('GET /api/backup 的 data 含四表（即使为空也必须是数组）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: Record<string, unknown> }>().data;
    for (const t of EXEC_TABLES) {
      expect(Array.isArray(data[t]), `备份 data 缺少 ${t}`).toBe(true);
    }
  });

  it('POST /api/bootstrap 含四表', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/bootstrap', payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    for (const t of EXEC_TABLES) {
      expect(Array.isArray(body[t]), `bootstrap 缺少 ${t}`).toBe(true);
    }
  });

  it('有数据时四表真的被导出（不是恒空数组的摆设）', async () => {
    await seedExecutionDomain(app);
    const res = await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH });
    const data = res.json<{ data: Record<string, unknown[]> }>().data;
    expect(data.executions).toHaveLength(1);
    expect(data.executionAttempts).toHaveLength(1);
    expect(data.executionEvents).toHaveLength(1);
    expect(data.writebackProposals).toHaveLength(1);
  });
});

describe('② 带数据四表的导出 → 导入 → 再导出往返保真', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
  });

  it('逐表 JSON.stringify 相等（这是本切片的核心验收）', async () => {
    await seedExecutionDomain(app);

    const first = await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH });
    const pkg = first.json<{ meta: unknown; data: Record<string, unknown[]> }>();
    const before = normalize(pkg);

    // 清库重建（同端点的真实语义），再导出
    const imported = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: AUTH,
      payload: pkg,
    });
    expect(imported.statusCode).toBe(200);

    const second = await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH });
    expect(normalize(second.json())).toBe(before);
  });

  it('导入后四表行数不变（不是被 DELETE 掉没插回来）', async () => {
    const { executionId, attemptId, proposalId } = await seedExecutionDomain(app);
    const pkg = (
      await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH })
    ).json<Record<string, unknown>>();
    await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: AUTH,
      payload: pkg,
    });
    expect(db.prepare('SELECT COUNT(*) AS c FROM executions').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM execution_attempts').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM execution_events').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM writeback_proposals').get()).toEqual({ c: 1 });
    // id 一致（不是重新生成了新 id）
    const ids = db.prepare('SELECT id FROM executions').get() as { id: string };
    expect(ids.id).toBe(executionId);
    const a = db.prepare('SELECT id FROM execution_attempts').get() as { id: string };
    expect(a.id).toBe(attemptId);
    const p = db.prepare('SELECT id FROM writeback_proposals').get() as { id: string };
    expect(p.id).toBe(proposalId);
  });

  it('导出包能通过前端 zod 校验（否则整包被拒收）', async () => {
    await seedExecutionDomain(app);
    const res = await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH });
    // 这是「服务端导出 → 前端导入」这条真实路径的第一道关卡
    expect(() => validateBackupJson(res.json())).not.toThrow();
  });
});

describe('③ JSON 列序列化（静默数据销毁防线）', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
  });

  it('operations 导出为**数组**（不是字符串）；对象嵌套保真', async () => {
    await seedExecutionDomain(app);
    const res = await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH });
    const row = res.json<{ data: { writebackProposals: Array<{ operations: unknown }> } }>().data
      .writebackProposals[0];
    // ★ 若 operations 未登记进 JSON_ARRAY_COLUMNS，这里会是 JSON **字符串**：
    //   `"[{...}]"` → 前端 `z.array(z.any())` 拒收 → **整份备份包导入失败**
    //   （tasks 表已有同类先例，注释见 meta.routes.ts 的 JSON_ARRAY_COLUMNS 头）。
    expect(Array.isArray(row.operations), 'operations 必须是数组而非字符串').toBe(true);
    const ops = row.operations as Array<Record<string, unknown>>;
    expect(ops).toHaveLength(2);
    expect(ops[0].field).toBe('task.status');
    // 对象数组的嵌套结构不得被拍平/丢弃（这正是不能走 filter(string) 的原因）
    expect(ops[1].nested).toEqual({ a: [1, 2] });
    expect(ops[1].after).toBe('多行\n文本');
  });

  it('confirmation 导出为**对象**（不是 []，不是字符串）', async () => {
    await seedExecutionDomain(app);
    const res = await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH });
    const row = res.json<{ data: { executions: Array<{ confirmation: unknown }> } }>().data
      .executions[0];
    // ★ 若 confirmation 被误登记进 JSON_ARRAY_COLUMNS（走 parseJsonArray），
    //   对象会被 `Array.isArray` 判否而回落 `[]` —— 「人工确认凭据」被静默清空。
    expect(Array.isArray(row.confirmation), 'confirmation 不得是数组').toBe(false);
    expect(typeof row.confirmation).toBe('object');
    expect(row.confirmation).toEqual({
      confirmedAt: '2026-09-01T00:00:00.000Z',
      confirmedBy: 'm_human',
      planHash: 'hash_seed',
      planRevision: 2,
    });
  });

  it('往返后 confirmation 仍是对象（导入侧的 snake() 也序列化了对象）', async () => {
    await seedExecutionDomain(app);
    const pkg = (
      await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH })
    ).json<Record<string, unknown>>();
    await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: AUTH,
      payload: pkg,
    });
    const raw = db.prepare('SELECT confirmation FROM executions').get() as {
      confirmation: string;
    };
    // 库里存的是 JSON 文本，不是 "[object Object]"
    expect(raw.confirmation.startsWith('{')).toBe(true);
    expect(JSON.parse(raw.confirmation)).toMatchObject({ planHash: 'hash_seed' });

    const again = await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH });
    const row = again.json<{ data: { executions: Array<{ confirmation: unknown }> } }>().data
      .executions[0];
    // 逐字相等（不是「大致像」）：往返不得丢字段、不得多字段
    expect(row.confirmation).toEqual({
      confirmedAt: '2026-09-01T00:00:00.000Z',
      confirmedBy: 'm_human',
      planHash: 'hash_seed',
      planRevision: 2,
    });
  });

  it('往返后 operations 仍是数组且内容不变', async () => {
    await seedExecutionDomain(app);
    const pkg = (
      await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH })
    ).json<Record<string, unknown>>();
    await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: AUTH,
      payload: pkg,
    });
    const raw = db.prepare('SELECT operations FROM writeback_proposals').get() as {
      operations: string;
    };
    expect(raw.operations.startsWith('[')).toBe(true);
    const parsed = JSON.parse(raw.operations) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(2);
    expect(parsed[1].nested).toEqual({ a: [1, 2] });
  });
});

describe('④ 导入顺序与外键（顺序错了必须响亮失败）', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
  });

  it('外键确实开着（顺序用例的前提）', async () => {
    // 若 pragma 没开，下面「顺序错了会失败」的论断就是空的 —— 先钉住前提
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('父表 executions 有子行时不能被删除（DELETE 必须子表在前）', async () => {
    const { executionId } = await seedExecutionDomain(app);
    // 直接按「父表先删」的顺序操作 —— 应当立刻抛外键约束（这正是 map 逆序的意义）
    expect(() =>
      db.prepare('DELETE FROM executions WHERE id = ?').run(executionId),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('子表不能先于父表插入（INSERT 必须父表在前）', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        id: PROJECT_ID,
        name: 'x',
        address: '',
        clientName: '',
        contractAmount: null,
        signedAt: null,
        plannedStartAt: '2026-08-01',
        plannedEndAt: '2026-12-31',
        coverColor: null,
      },
    });
    expect(() =>
      db
        .prepare(
          `INSERT INTO execution_attempts
             (id, execution_id, attempt_no, status, created_at, updated_at)
           VALUES ('a-x', 'exec-not-yet', 1, 'queued', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('导入一份非空四表的数据到非空库能成功（证明顺序确实排对了）', async () => {
    // 这条是「顺序正确」的**正向**证据：若 map 把 executions 排在子表之后，
    // DELETE 逆序会先删 executions 而库里有子行 → 抛外键 → 本用例红。
    await seedExecutionDomain(app);
    const pkg = (
      await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH })
    ).json<Record<string, unknown>>();
    // 直接往**已有数据**的库里再导一次（不清库前提下的最严场景）
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: AUTH,
      payload: pkg,
    });
    expect(res.statusCode).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS c FROM executions').get()).toEqual({ c: 1 });
  });
});

describe('⑤ 旧包兼容与清库重建', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
  });

  it('不含四键的老包导入不报错，且四表被清空（清库重建语义）', async () => {
    await seedExecutionDomain(app);
    expect(db.prepare('SELECT COUNT(*) AS c FROM executions').get()).toEqual({ c: 1 });

    const legacy = {
      meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-01-01T00:00:00.000Z' },
      data: {
        projects: [],
        stages: [],
        tasks: [],
        itineraries: [],
        members: [],
        assignments: [],
        logs: [],
        contracts: [],
        settings: [],
      },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: AUTH,
      payload: legacy,
    });
    expect(res.statusCode).toBe(200);
    // ★ 老包**没有**四键 = 明确的「这四张表是空的」意图 → 必须清空
    //   （若实现成「缺键就跳过」，会留下上一份数据的幽灵，比报错更难查）
    expect(db.prepare('SELECT COUNT(*) AS c FROM executions').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM execution_attempts').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM execution_events').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM writeback_proposals').get()).toEqual({ c: 0 });
  });

  it('schemaVersion 仍是 3（bump 会让本地侧 zod 拒收整个服务端备份包）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH });
    const meta = res.json<{ meta: { schemaVersion: number } }>().meta;
    // 本地 backup.service.ts 的 union 只接受 1|2|3；四表在本地 zod 里已是
    // `.default([])`，新老包双向兼容，**不需要**也不能 bump。
    expect(meta.schemaVersion).toBe(3);
  });

  it('current_attempt_no 两端语义一致：服务端有 attempt 时导出的列仍是 0', async () => {
    // ★ 两端一致性防线（v0.8 裁定）：服务端**不**维护该列（本地也从不维护），
    //   故即使开了 attempt，导出的 `currentAttemptNo` 仍是 0。
    //   若服务端单方面回写，这里会导出非 0 → 导入本地后本地就"有了值"，
    //   而本地自建的仍是 0 → 同一台机器上两种语义并存，无法判断以谁为准。
    const { executionId } = await seedExecutionDomain(app);
    const pkg = (
      await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH })
    ).json<{
      data: {
        executions: Array<{ id: string; currentAttemptNo: number }>;
        executionAttempts: unknown[];
      };
    }>();
    // 前提：确实存在 attempt（否则本用例退化成平凡情形）
    expect(pkg.data.executionAttempts).toHaveLength(1);
    const row = pkg.data.executions.find((e) => e.id === executionId);
    expect(row?.currentAttemptNo).toBe(0);
  });

  it('导入后该列仍为 0（往返不引入分歧）', async () => {
    await seedExecutionDomain(app);
    const pkg = (
      await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH })
    ).json<Record<string, unknown>>();
    await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: AUTH,
      payload: pkg,
    });
    const raw = db.prepare('SELECT current_attempt_no FROM executions').get() as {
      current_attempt_no: number;
    };
    expect(raw.current_attempt_no).toBe(0);
  });

  it('导出的包能被 validateBackupJson 收下（两端 schemaVersion 对齐的实证）', async () => {
    await seedExecutionDomain(app);
    const res = await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH });
    const parsed = validateBackupJson(res.json());
    expect(parsed.meta.schemaVersion).toBe(3);
    expect(parsed.data.executions).toHaveLength(1);
    expect(parsed.data.executionAttempts).toHaveLength(1);
    expect(parsed.data.executionEvents).toHaveLength(1);
    expect(parsed.data.writebackProposals).toHaveLength(1);
  });
});
