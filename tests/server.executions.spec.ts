/**
 * 服务端 Agent 执行域：端点读写 + 存储边界强制（v0.8 · T04-SRV）。
 *
 * ── 为什么必须有这个 spec ──
 * `server/schema.sql` 自 v5 起就建好了执行域四张表，但服务端**没有任何入口**读写它们，
 * 且 `server/adapters/sqlite.bundle.ts` 里 12 个方法全是 `notImplemented`。
 * 「表存在」与「能力存在」是两件事：前者只保证备份能捞到数据，后者才是功能。
 *
 * ── 本 spec 锁死六条 ──
 *   ① 端点读写闭环：建执行单 → 读回 → 推状态 → 新开 attempt → 追加事件 → 建/审批提案；
 *   ② **状态机在存储边界生效**（不是只在 UI 生效）：
 *      非法邻接被拒、未确认不得入 queued/running、completed 需 applied 且 decidedBy 非空；
 *   ③ 错误体形状恒为 `{error:{code,userMessage}}` + 恰当 HTTP 状态码；
 *   ④ `operations` 数组 / `confirmation` 对象两个 JSON 列**往返保真**
 *      （对象误走 parseJsonArray 会被清成 `[]`，是静默数据销毁）；
 *   ⑤ 外键约束真实生效（孤儿 attempt 被拒）；
 *   ⑥ 排序口径与本地 Dexie 适配器一致（两端列表顺序相同）。
 *
 * 用内存 SQLite + Fastify inject，不起端口、不依赖网络。
 */

import { describe, expect, it, beforeEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';
import { registerTaskRoutes } from '../server/routes/tasks.routes';
import { registerMemberRoutes } from '../server/routes/members.routes';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { registerExecutionRoutes } from '../server/routes/executions.routes';

/** 建内存库 + 注册全量路由（含执行域；与 `server/index.ts` 的注册序一致） */
async function buildServer(): Promise<{ app: FastifyInstance; db: Database.Database }> {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  // ★ 与 `server/db.ts` 的 `openDb()` 一致：外键必须开，否则本 spec 的外键用例是假绿
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

const PROJECT_ID = 'proj_exec';

/** 建一个最小项目（执行单的归属；不建它则外键/查询维度无法验证） */
async function seedProject(app: FastifyInstance): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      id: PROJECT_ID,
      name: '执行域项目',
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-08-01',
      plannedEndAt: '2026-12-31',
      coverColor: null,
    },
  });
  expect(res.statusCode).toBeLessThan(300);
}

/** 建一个执行单并返回实体（大量用例的前置） */
async function createExecution(
  app: FastifyInstance,
  idempotencyKey = 'exec:test:proj_exec:1',
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${PROJECT_ID}/executions`,
    payload: {
      source: 'project-task',
      objective: '把阶段二的排期挪到下周',
      idempotencyKey,
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json<Record<string, unknown>>();
}

/** 常见推进路径：draft → awaiting_confirmation → queued（带上确认凭据） */
const CONFIRMATION = {
  confirmedAt: '2026-09-01T00:00:00.000Z',
  confirmedBy: 'm_human',
  planHash: 'hash_abc',
  planRevision: 1,
};

describe('服务端执行域端点：读写闭环', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
    await seedProject(app);
  });

  it('建执行单：默认 draft / currentAttemptNo=0 / confirmation=null', async () => {
    const exec = await createExecution(app);
    expect(exec.status).toBe('draft');
    expect(exec.currentAttemptNo).toBe(0);
    expect(exec.confirmation).toBeNull();
    expect(exec.projectId).toBe(PROJECT_ID);
    expect(typeof exec.id).toBe('string');
    expect((exec.id as string).length).toBeGreaterThan(0);
  });

  it('按项目列出执行单 + 按 id 读回（形状一致）', async () => {
    const created = await createExecution(app);
    const list = await app.inject({ method: 'GET', url: `/api/projects/${PROJECT_ID}/executions` });
    expect(list.statusCode).toBe(200);
    const rows = list.json<Array<Record<string, unknown>>>();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    // 列表与单读必须同形（同一 rowToExecution），否则前端两处取值会不一致
    expect(JSON.stringify(rows[0])).toBe(JSON.stringify(created));

    const one = await app.inject({ method: 'GET', url: `/api/executions/${created.id}` });
    expect(one.statusCode).toBe(200);
    expect(JSON.stringify(one.json())).toBe(JSON.stringify(created));
  });

  it('按 id 读不存在的执行单 → 404 {error:{code,userMessage}}', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executions/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: { code: string; userMessage: string } }>();
    expect(body.error.code).toBe('not_found');
    expect(typeof body.error.userMessage).toBe('string');
    expect(body.error.userMessage.length).toBeGreaterThan(0);
  });

  it('detail 聚合端点一次取齐四份数据', async () => {
    const exec = await createExecution(app);
    const res = await app.inject({ method: 'GET', url: `/api/executions/${exec.id}/detail` });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect((body.execution as { id: string }).id).toBe(exec.id);
    expect(body.attempts).toEqual([]);
    expect(body.events).toEqual([]);
    expect(body.proposals).toEqual([]);
  });

  it('状态推进：draft → awaiting_confirmation → queued（同请求带确认凭据）', async () => {
    const exec = await createExecution(app);
    const toConfirm = await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'awaiting_confirmation' },
    });
    expect(toConfirm.statusCode).toBe(200);
    expect(toConfirm.json<{ status: string }>().status).toBe('awaiting_confirmation');

    // ★ 关键：确认与入队是**同一步**请求。仓储必须用「合并后的确认快照」
    //   校验，否则合法的确认入队会被永远拒绝（本地侧 local.execution.repo.ts:104 同款）。
    const toQueued = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/status`,
      payload: { status: 'queued', confirmation: CONFIRMATION },
    });
    expect(toQueued.statusCode).toBe(200);
    const queued = toQueued.json<Record<string, unknown>>();
    expect(queued.status).toBe('queued');
    expect(queued.confirmation).toEqual(CONFIRMATION);
  });

  it('PATCH 与 POST /status 两个入口语义完全一致', async () => {
    const a = await createExecution(app, 'k-a');
    const b = await createExecution(app, 'k-b');
    const viaPatch = await app.inject({
      method: 'PATCH',
      url: `/api/executions/${a.id}`,
      payload: { status: 'awaiting_confirmation' },
    });
    const viaPost = await app.inject({
      method: 'POST',
      url: `/api/executions/${b.id}/status`,
      payload: { status: 'awaiting_confirmation' },
    });
    expect(viaPatch.statusCode).toBe(200);
    expect(viaPost.statusCode).toBe(200);
    expect(viaPatch.json<{ status: string }>().status).toBe(
      viaPost.json<{ status: string }>().status,
    );
  });

  it('状态写入不误伤未提供的字段（pickDefined 语义）', async () => {
    const exec = await createExecution(app);
    await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'awaiting_confirmation', blockedReason: '缺输入' },
    });
    // 第二次只改状态：blockedReason 必须**保留**（undefined 不覆盖既有值）
    const second = await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'draft' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ blockedReason: string }>().blockedReason).toBe('缺输入');
  });

  it('事件：seq 从 1 起严格单调，乱序/跳号被拒', async () => {
    const exec = await createExecution(app);
    const first = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/events`,
      payload: { seq: 1, type: 'created', actor: 'system' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ seq: number }>().seq).toBe(1);

    const second = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/events`,
      payload: { seq: 2, type: 'status_changed', actor: 'user' },
    });
    expect(second.statusCode).toBe(200);

    // 跳号（期望 3，传 5）→ 400
    const gap = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/events`,
      payload: { seq: 5, type: 'resumed', actor: 'user' },
    });
    expect(gap.statusCode).toBe(400);

    // 重复（期望 3，传 1）→ 400
    const dup = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/events`,
      payload: { seq: 1, type: 'resumed', actor: 'user' },
    });
    expect(dup.statusCode).toBe(400);

    const list = await app.inject({ method: 'GET', url: `/api/executions/${exec.id}/events` });
    const events = list.json<Array<{ seq: number }>>();
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('attempt：号段单调 + 同一执行单同时最多一个非终态', async () => {
    const exec = await createExecution(app);
    const a1 = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: { runtimeKind: 'local' },
    });
    expect(a1.statusCode).toBe(200);
    const attempt1 = a1.json<Record<string, unknown>>();
    expect(attempt1.attemptNo).toBe(1);
    expect(attempt1.status).toBe('queued');

    // ★ 非终态 attempt 仍在 → 不能新开（Conflict，不是 Validation）
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('conflict');

    // 落定为终态后可以新开，号段 +1。
    // ★ 路径必须是 queued → running → succeeded：`queued → succeeded` 是**非法邻接**
    //   （见 ATTEMPT_TRANSITIONS：queued 只能去 running / cancelled / failed）。
    //   写这条时先误写成直达 succeeded，被状态机拒了 —— 那是**实现对、测试错**。
    await app.inject({
      method: 'PATCH',
      url: `/api/attempts/${attempt1.id}`,
      payload: { status: 'running' },
    });
    const finish = await app.inject({
      method: 'PATCH',
      url: `/api/attempts/${attempt1.id}`,
      payload: { status: 'succeeded' },
    });
    expect(finish.statusCode).toBe(200);
    const a2 = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: {},
    });
    expect(a2.statusCode).toBe(200);
    expect(a2.json<{ attemptNo: number }>().attemptNo).toBe(2);
  });

  it('attempt 状态机：queued 不能直达 succeeded（终端转移须经 running）', async () => {
    const exec = await createExecution(app);
    const a = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: {},
    });
    const attempt = a.json<Record<string, unknown>>();
    const direct = await app.inject({
      method: 'PATCH',
      url: `/api/attempts/${attempt.id}`,
      payload: { status: 'succeeded' },
    });
    expect(direct.statusCode).toBe(400);
    expect(direct.json<{ error: { userMessage: string } }>().error.userMessage).toContain(
      'queued → succeeded',
    );
  });

  it('attempt 状态机：终态不得改回 running（堵住「单活 attempt」绕过）', async () => {
    const exec = await createExecution(app);
    const a = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: {},
    });
    const attempt = a.json<Record<string, unknown>>();
    await app.inject({
      method: 'PATCH',
      url: `/api/attempts/${attempt.id}`,
      payload: { status: 'failed' },
    });
    const back = await app.inject({
      method: 'PATCH',
      url: `/api/attempts/${attempt.id}`,
      payload: { status: 'running' },
    });
    expect(back.statusCode).toBe(400);
    expect(back.json<{ error: { code: string } }>().error.code).toBe('validation');
  });

  it('attempt 调用方传入的 attemptNo 与计算值不一致 → 400', async () => {
    const exec = await createExecution(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: { attemptNo: 7 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { userMessage: string } }>().error.userMessage).toContain('attemptNo');
  });

  it('attempt 进入终态时自动盖 finishedAt', async () => {
    const exec = await createExecution(app);
    const a = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: {},
    });
    const attempt = a.json<Record<string, unknown>>();
    expect(attempt.finishedAt).toBeNull();
    await app.inject({
      method: 'PATCH',
      url: `/api/attempts/${attempt.id}`,
      payload: { status: 'running' },
    });
    const done = await app.inject({
      method: 'PATCH',
      url: `/api/attempts/${attempt.id}`,
      payload: { status: 'succeeded' },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json<{ finishedAt: string | null }>().finishedAt).not.toBeNull();
  });

  it('queued → cancelled 直接落终态时也盖 finishedAt（合法边）', async () => {
    const exec = await createExecution(app);
    const a = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: {},
    });
    const attempt = a.json<Record<string, unknown>>();
    const cancelled = await app.inject({
      method: 'PATCH',
      url: `/api/attempts/${attempt.id}`,
      payload: { status: 'cancelled' },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<{ finishedAt: string | null }>().finishedAt).not.toBeNull();
  });

  it('attempt 非终态时**不**盖 finishedAt', async () => {
    const exec = await createExecution(app);
    const a = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: {},
    });
    const attempt = a.json<Record<string, unknown>>();
    const running = await app.inject({
      method: 'PATCH',
      url: `/api/attempts/${attempt.id}`,
      payload: { status: 'running' },
    });
    expect(running.statusCode).toBe(200);
    expect(running.json<{ finishedAt: string | null }>().finishedAt).toBeNull();
  });
});

describe('服务端存储边界：P0「未人工确认绝不执行」', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
    await seedProject(app);
  });

  it('未确认时直接推 queued → 400（哪怕邻接表合法）', async () => {
    const exec = await createExecution(app);
    // draft → awaiting_confirmation 合法；awaiting_confirmation → queued 邻接合法，
    // 但**没有 confirmation** → 必须被 P0 门槛拒绝
    await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'awaiting_confirmation' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'queued' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; userMessage: string } }>();
    expect(body.error.code).toBe('validation');
    expect(body.error.userMessage).toContain('未确认');
  });

  it('confirmation 缺 planHash 或 confirmedAt 任一 → 仍拒', async () => {
    const exec = await createExecution(app);
    await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'awaiting_confirmation' },
    });
    for (const bad of [
      { confirmedAt: CONFIRMATION.confirmedAt, confirmedBy: 'm', planRevision: 1 },
      { confirmedBy: 'm', planHash: CONFIRMATION.planHash, planRevision: 1 },
    ]) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/executions/${exec.id}`,
        payload: { status: 'queued', confirmation: bad },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('非法邻接：draft → completed 直接拒（且 completed 还要求 applied 提案）', async () => {
    const exec = await createExecution(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'completed' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('终态不得出边：cancelled 之后任何推进都被拒', async () => {
    const exec = await createExecution(app);
    const cancel = await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'cancelled' },
    });
    expect(cancel.statusCode).toBe(200);
    const after = await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'draft' },
    });
    expect(after.statusCode).toBe(400);
  });

  it('completed 路径：awaiting_review + applied（decidedBy 非空）提案才放行', async () => {
    const exec = await createExecution(app);
    const id = exec.id as string;
    // 推进到 running（带确认）
    await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`,
      payload: { status: 'awaiting_confirmation' },
    });
    await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`,
      payload: { status: 'queued', confirmation: CONFIRMATION },
    });
    await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`, payload: { status: 'running' },
    });
    await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`, payload: { status: 'awaiting_review' },
    });

    // ① 无提案 → 拒
    const noProposal = await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`, payload: { status: 'completed' },
    });
    expect(noProposal.statusCode).toBe(400);

    // ② 有 applied 且 decidedBy 非空 → 放行
    const p = await app.inject({
      method: 'POST',
      url: `/api/executions/${id}/proposals`,
      payload: {
        projectId: PROJECT_ID,
        operations: [{ field: 'task.status', before: 'todo', after: 'done' }],
        idempotencyKey: 'wb:1',
      },
    });
    expect(p.statusCode).toBe(200);
    const proposal = p.json<Record<string, unknown>>();
    const applied = await app.inject({
      method: 'PATCH',
      url: `/api/proposals/${proposal.id}`,
      payload: { status: 'applied', decidedBy: 'm_human' },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json<{ decidedAt: string | null }>().decidedAt).not.toBeNull();

    const done = await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`, payload: { status: 'completed' },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json<{ status: string }>().status).toBe('completed');
  });
});

describe('服务端写回提案边界', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
    await seedProject(app);
  });

  it('不允许创建时即为 applied / rejected（否则 P0 只剩形状校验）', async () => {
    const exec = await createExecution(app);
    for (const status of ['applied', 'rejected']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/executions/${exec.id}/proposals`,
        payload: {
          projectId: PROJECT_ID,
          operations: [],
          idempotencyKey: `wb-${status}`,
          status,
        },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('落定终态时 decidedBy 必填 → 400', async () => {
    const exec = await createExecution(app);
    const p = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/proposals`,
      payload: { projectId: PROJECT_ID, operations: [], idempotencyKey: 'wb-x' },
    });
    const proposal = p.json<Record<string, unknown>>();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/proposals/${proposal.id}`,
      payload: { status: 'applied' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { userMessage: string } }>().error.userMessage).toContain('decidedBy');
  });

  it('已落定的提案不可再变更 → 409（堵住「审批后换 operations」）', async () => {
    const exec = await createExecution(app);
    const p = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/proposals`,
      payload: { projectId: PROJECT_ID, operations: [], idempotencyKey: 'wb-y' },
    });
    const proposal = p.json<Record<string, unknown>>();
    await app.inject({
      method: 'PATCH',
      url: `/api/proposals/${proposal.id}`,
      payload: { status: 'applied', decidedBy: 'm_human' },
    });
    const again = await app.inject({
      method: 'PATCH',
      url: `/api/proposals/${proposal.id}`,
      payload: { operations: [{ field: 'task.status', before: 'a', after: 'b' }] },
    });
    expect(again.statusCode).toBe(409);
  });

  it('更新不存在的提案 → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/proposals/nope',
      payload: { status: 'proposed' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('operations 非数组 → 400（挡住「字符串恰好也能被 parse 成功」的蒙混）', async () => {
    const exec = await createExecution(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/proposals`,
      payload: { projectId: PROJECT_ID, operations: '[]', idempotencyKey: 'wb-z' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('服务端执行域：JSON 列往返保真（静默数据销毁防线）', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
    await seedProject(app);
  });

  it('operations 对象数组往返保真（不被 parseJsonArray 之外的转换清空）', async () => {
    const exec = await createExecution(app);
    const operations = [
      { field: 'task.status', before: 'todo', after: 'done', note: '含中文与 emoji ✅' },
      { field: 'task.notes.append', before: null, after: '多行\n文本', nested: { a: 1, b: [2, 3] } },
    ];
    const created = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/proposals`,
      payload: { projectId: PROJECT_ID, operations, idempotencyKey: 'wb-roundtrip' },
    });
    expect(created.statusCode).toBe(200);
    // 创建返回值与读回值都必须**逐字**等于原数组（对象数组不得丢嵌套）
    expect(created.json<{ operations: unknown }>().operations).toEqual(operations);

    const list = await app.inject({
      method: 'GET',
      url: `/api/executions/${exec.id}/proposals`,
    });
    const proposals = list.json<Array<{ operations: unknown }>>();
    expect(proposals).toHaveLength(1);
    expect(proposals[0].operations).toEqual(operations);
  });

  it('confirmation 对象往返保真（**不可**走 parseJsonArray：对象会被清成 []）', async () => {
    const exec = await createExecution(app);
    const id = exec.id as string;
    await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`,
      payload: { status: 'awaiting_confirmation' },
    });
    const confirmation = {
      confirmedAt: '2026-09-01T00:00:00.000Z',
      confirmedBy: 'm_human',
      planHash: 'hash_deep',
      planRevision: 3,
    };
    const res = await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`,
      payload: { status: 'queued', confirmation },
    });
    expect(res.statusCode).toBe(200);
    // ★ 若 confirmation 被误登记进 JSON_ARRAY_COLUMNS，这里会变成 [] —— 而 [] 是
    //   truthy，`assertExecutionConfirmed` 会看到 `[].confirmedAt === undefined` 并拒绝：
    //   症状不是「闸门失效」而是「已确认的执行单永远进不了队列」，同样致命。
    expect(res.json<{ confirmation: unknown }>().confirmation).toEqual(confirmation);

    const reread = await app.inject({ method: 'GET', url: `/api/executions/${id}` });
    expect(reread.json<{ confirmation: unknown }>().confirmation).toEqual(confirmation);
  });

  it('confirmation=null 是「清空」，缺省是「不动」（两者语义不同）', async () => {
    const exec = await createExecution(app);
    const id = exec.id as string;
    await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`,
      payload: { status: 'awaiting_confirmation' },
    });
    await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`,
      payload: { status: 'queued', confirmation: CONFIRMATION },
    });
    // 缺省 → 保留
    const kept = await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`, payload: { status: 'running' },
    });
    expect(kept.json<{ confirmation: unknown }>().confirmation).toEqual(CONFIRMATION);
    // 显式 null → 清空
    const cleared = await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`,
      payload: { status: 'paused', confirmation: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<{ confirmation: unknown }>().confirmation).toBeNull();
  });

  it('confirmation 列在 DB 中存的是 JSON 对象串（不是 [object Object]）', async () => {
    const exec = await createExecution(app);
    const id = exec.id as string;
    await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`,
      payload: { status: 'awaiting_confirmation' },
    });
    await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`,
      payload: { status: 'queued', confirmation: CONFIRMATION },
    });
    const raw = db.prepare('SELECT confirmation FROM executions WHERE id = ?').get(id) as {
      confirmation: string;
    };
    expect(raw.confirmation.startsWith('{')).toBe(true);
    expect(JSON.parse(raw.confirmation)).toEqual(CONFIRMATION);
  });
});

describe('服务端执行域：外键与排序', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
    await seedProject(app);
  });

  it('外键真的开着（底层直接插孤儿行会抛）', async () => {
    // 这条断言的是**前提**而不是被测代码：若 pragma 没开，下面那条
    // 「孤儿 attempt 被拒」的用例会因为完全不同的原因通过（或通不过），失去意义。
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
    expect(() =>
      db
        .prepare(
          `INSERT INTO execution_attempts
             (id, execution_id, attempt_no, status, created_at, updated_at)
           VALUES ('orphan', 'no_such_exec', 1, 'queued', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('对不存在的执行单开 attempt → 404（而不是 500 外键错误）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/executions/no_such_exec/attempts',
      payload: {},
    });
    // 显式先查执行单存在性 → 语义化的 NotFound，比外键约束的 500 有用
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_found');
  });

  it('列表排序与本地一致：createdAt → id', async () => {
    // 三条执行单，createdAt 有并列 → 必须靠 id 决出稳定次序（两端同序）
    const ids: string[] = [];
    for (const k of ['k1', 'k2', 'k3']) {
      const e = await createExecution(app, k);
      ids.push(e.id as string);
    }
    db.prepare('UPDATE executions SET created_at = ?').run('2026-09-01T00:00:00.000Z');
    const list = await app.inject({ method: 'GET', url: `/api/projects/${PROJECT_ID}/executions` });
    const rows = list.json<Array<{ id: string; createdAt: string }>>();
    const expected = [...ids].sort((a, b) => a.localeCompare(b));
    expect(rows.map((r) => r.id)).toEqual(expected);
  });

  it('按项目过滤：别的项目的执行单不出现在列表里', async () => {
    await createExecution(app);
    const other = await app.inject({
      method: 'GET',
      url: '/api/projects/other_project/executions',
    });
    expect(other.json<unknown[]>()).toEqual([]);
  });
});

describe('服务端执行域：入参形状拒绝（400 + 契约错误体）', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
    await seedProject(app);
  });

  it('缺 idempotencyKey → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${PROJECT_ID}/executions`,
      payload: { source: 'project-task', objective: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('validation');
  });

  it('source 非法 → 400（没有任何下游会拒它，必须在入口拒）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${PROJECT_ID}/executions`,
      payload: { source: 'whatever', objective: 'x', idempotencyKey: 'k' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('事件 type 非法 → 400（打错字会变成永远查不到的审计记录）', async () => {
    const exec = await createExecution(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/events`,
      payload: { seq: 1, type: 'not_a_type', actor: 'user' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('事件缺 seq → 400（seq 必须由调用方显式传入）', async () => {
    const exec = await createExecution(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/events`,
      payload: { type: 'created', actor: 'user' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('status 非法值 → 400 且错误体是契约形状（由状态机给文案）', async () => {
    const exec = await createExecution(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'not_a_status' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; userMessage: string } }>();
    expect(body.error.code).toBe('validation');
    expect(typeof body.error.userMessage).toBe('string');
  });
});
