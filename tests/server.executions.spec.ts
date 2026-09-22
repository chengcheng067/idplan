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
import {
  ATTEMPT_NON_TERMINAL_STATUSES,
  AttemptStatus,
  ExecutionStatus,
} from '../src/core/types/agent-execution';
import { isContradictoryExecution } from '../src/core/execution/execution-recovery';
import { computePlanHash } from '../src/core/execution/plan-hash';

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

/**
 * 用「真实执行单」算出确认快照：stale-approval 收紧后 planHash 必须 ==
 * computePlanHash(execution) 才能过门槛，故测试按真实实体计算，不再手抄 hash。
 */
function confirmationFor(
  exec: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    confirmedAt: '2026-09-01T00:00:00.000Z',
    confirmedBy: 'm_human',
    planHash: computePlanHash(exec as never),
    planRevision: 1,
    ...overrides,
  };
}

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
      payload: { status: 'queued', confirmation: confirmationFor(exec) },
    });
    expect(toQueued.statusCode).toBe(200);
    const queued = toQueued.json<Record<string, unknown>>();
    expect(queued.status).toBe('queued');
    expect(queued.confirmation).toEqual(confirmationFor(exec));
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

/**
 * `currentAttemptNo` 的存储与读路径口径（v0.8 裁定后）。
 *
 * ── 背景（为什么这几条测试值得单独成组）──
 * 服务端一开始在 `createAttempt` 里回写父表 `current_attempt_no`，被判定为错误设计：
 * 该列**全仓零读取方**，是个冗余缓存列；而 dump 是字段级搬运，服务端算出的值会
 * 被导出、再被本地导入 —— 造成「本地导入来的值是对的、本地自建的是错的（恒 0）」，
 * 这种"有时对有时错"比"两端一致地无值"难诊断得多。
 *
 * 现行设计：**DB 列两端一致地恒为 0**，`currentAttemptNo` 由**读路径现算**
 * （`withDerivedAttemptNo`，语义 = max(attemptNo)，空 → 0，指向最近一次 attempt）。
 *
 * 本组锁死三件事：① 读路径确实给出了正确值；② 写路径确实不再碰父表；
 * ③ dump 往返后该列与本地侧语义一致（不出现服务端有值 / 本地无值的分歧）。
 */
describe('currentAttemptNo：DB 恒为 0，读路径现算', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
    await seedProject(app);
  });

  /** 新开一个 attempt 并推进到终态（终态才能再开下一个），返回 attemptNo */
  async function addAttempt(app: FastifyInstance, executionId: string): Promise<number> {
    const created = await app.inject({
      method: 'POST',
      url: `/api/executions/${executionId}/attempts`,
      payload: {},
    });
    expect(created.statusCode).toBe(200);
    const no = created.json<{ attemptNo: number }>().attemptNo;
    // 落到终态，让下一次能开新的（同一 execution 同时最多一个非终态 attempt）
    await app.inject({
      method: 'PATCH',
      url: `/api/attempts/${created.json<{ id: string }>().id}`,
      payload: { status: 'cancelled' },
    });
    return no;
  }

  it('0 个 attempt → currentAttemptNo = 0（getExecution 与列表都给 0）', async () => {
    const exec = await createExecution(app);
    const one = await app.inject({ method: 'GET', url: `/api/executions/${exec.id}` });
    expect(one.json<{ currentAttemptNo: number }>().currentAttemptNo).toBe(0);

    const list = await app.inject({ method: 'GET', url: `/api/projects/${PROJECT_ID}/executions` });
    expect(list.json<Array<{ currentAttemptNo: number }>>()[0].currentAttemptNo).toBe(0);
  });

  it('1 个 attempt → currentAttemptNo = 1（不是 2：语义是「最近一次」而非「下一个」）', async () => {
    const exec = await createExecution(app);
    const no = await addAttempt(app, exec.id as string);
    expect(no).toBe(1);

    const one = await app.inject({ method: 'GET', url: `/api/executions/${exec.id}` });
    // ★ 若这里实现成 nextAttemptNo()（max+1）就会得到 2 —— 差一，最易犯的错
    expect(one.json<{ currentAttemptNo: number }>().currentAttemptNo).toBe(1);
  });

  it('3 个 attempt → currentAttemptNo = 3（三处读路径口径一致）', async () => {
    const exec = await createExecution(app);
    const id = exec.id as string;
    expect(await addAttempt(app, id)).toBe(1);
    expect(await addAttempt(app, id)).toBe(2);
    expect(await addAttempt(app, id)).toBe(3);

    const one = await app.inject({ method: 'GET', url: `/api/executions/${id}` });
    expect(one.json<{ currentAttemptNo: number }>().currentAttemptNo).toBe(3);

    const list = await app.inject({ method: 'GET', url: `/api/projects/${PROJECT_ID}/executions` });
    const row = list.json<Array<{ currentAttemptNo: number }>>()[0];
    expect(row.currentAttemptNo).toBe(3);

    // detail 端点必须同口径（否则列表显示 3、详情页显示别的 → 互相矛盾）
    const detail = await app.inject({ method: 'GET', url: `/api/executions/${id}/detail` });
    expect(
      detail.json<{ execution: { currentAttemptNo: number } }>().execution.currentAttemptNo,
    ).toBe(3);
  });

  it('读路径现算：直接改 DB 列不影响返回值（证明真的没在读列）', async () => {
    const exec = await createExecution(app);
    const id = exec.id as string;
    await addAttempt(app, id);
    // 把列塞一个明显错误的哨兵值
    db.prepare('UPDATE executions SET current_attempt_no = 999 WHERE id = ?').run(id);
    const one = await app.inject({ method: 'GET', url: `/api/executions/${id}` });
    // 返回的仍是数子表算出的 1，而非列里的 999
    expect(one.json<{ currentAttemptNo: number }>().currentAttemptNo).toBe(1);
  });

  it('createAttempt **不碰**父表：current_attempt_no 与 updated_at 逐字节不变', async () => {
    const exec = await createExecution(app);
    const id = exec.id as string;
    const before = db
      .prepare('SELECT current_attempt_no, updated_at FROM executions WHERE id = ?')
      .get(id) as { current_attempt_no: number; updated_at: string };
    // 确保父表初始就是 0（本地侧同款）
    expect(before.current_attempt_no).toBe(0);

    await addAttempt(app, id);

    const after = db
      .prepare('SELECT current_attempt_no, updated_at FROM executions WHERE id = ?')
      .get(id) as { current_attempt_no: number; updated_at: string };
    // ★ 与本地 local.execution.repo.ts:180-227 的 createAttempt 同款：只插子表
    expect(after.current_attempt_no).toBe(0);
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('updateAttempt 同样不碰父表', async () => {
    const exec = await createExecution(app);
    const id = exec.id as string;
    const a = await app.inject({
      method: 'POST',
      url: `/api/executions/${id}/attempts`,
      payload: {},
    });
    const before = db
      .prepare('SELECT current_attempt_no, updated_at FROM executions WHERE id = ?')
      .get(id) as { current_attempt_no: number; updated_at: string };

    await app.inject({
      method: 'PATCH',
      url: `/api/attempts/${a.json<{ id: string }>().id}`,
      payload: { status: 'running' },
    });

    const after = db
      .prepare('SELECT current_attempt_no, updated_at FROM executions WHERE id = ?')
      .get(id) as { current_attempt_no: number; updated_at: string };
    expect(after.current_attempt_no).toBe(0);
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('状态写入的返回值也用现算口径（PATCH 与 GET 不得互相矛盾）', async () => {
    const exec = await createExecution(app);
    const id = exec.id as string;
    await addAttempt(app, id);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/executions/${id}`,
      payload: { status: 'awaiting_confirmation' },
    });
    expect(patched.json<{ currentAttemptNo: number }>().currentAttemptNo).toBe(1);
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
      { confirmedAt: '2026-09-01T00:00:00.000Z', confirmedBy: 'm', planRevision: 1 },
      { confirmedBy: 'm', planHash: 'stale-hash', planRevision: 1 },
    ]) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/executions/${exec.id}`,
        payload: { status: 'queued', confirmation: bad },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  // 上一用例的两个畸形体**都缺 planHash**（或给陈旧 hash），拒绝实际由关卡③
  // （计划绑定比对）完成，关卡②的字段级检查被掩盖。这里补齐字段级覆盖：
  // planHash 与当前计划匹配（关卡③无从拒绝），只缺 confirmedBy / confirmedAt 之一。
  // （对抗式验证 report M3/M3b 遗留补救；删除关卡②对应字段检查时本用例必须红。）

  it('confirmation planHash 匹配但 confirmedBy / confirmedAt 为空 → 仍拒（关卡②字段级）', async () => {
    const exec = await createExecution(app);
    await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'awaiting_confirmation' },
    });
    for (const bad of [
      confirmationFor(exec, { confirmedBy: '' }),
      confirmationFor(exec, { confirmedAt: '' }),
    ]) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/executions/${exec.id}`,
        payload: { status: 'queued', confirmation: bad },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string; userMessage: string } }>();
      expect(body.error.code).toBe('validation');
      // 拒绝文案来自关卡②（「均非空」）而非关卡③（「不一致」）——证明确实测的是字段级检查
      expect(body.error.userMessage).toContain('均非空');
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
      payload: { status: 'queued', confirmation: confirmationFor(exec) },
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

  it('落定终态时 decidedBy 必填 → 400', async () => {    const exec = await createExecution(app);
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
    const confirmation = confirmationFor(exec, { planRevision: 3 });
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
      payload: { status: 'queued', confirmation: confirmationFor(exec) },
    });
    // 缺省 → 保留
    const kept = await app.inject({
      method: 'PATCH', url: `/api/executions/${id}`, payload: { status: 'running' },
    });
    expect(kept.json<{ confirmation: unknown }>().confirmation).toEqual(confirmationFor(exec));
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
      payload: { status: 'queued', confirmation: confirmationFor(exec) },
    });
    const raw = db.prepare('SELECT confirmation FROM executions WHERE id = ?').get(id) as {
      confirmation: string;
    };
    expect(raw.confirmation.startsWith('{')).toBe(true);
    expect(JSON.parse(raw.confirmation)).toEqual(confirmationFor(exec));
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

  /**
   * ★ 缺口 2：孤儿父记录写 events / proposals 曾返回 **500 {code:'storage'}**，
   * 而 `createAttempt` 同场景已是 404 —— 三条写路径对同一件事给了三种反馈。
   *
   * 危害不在 500 本身，而在**映射链**：`RestClient` 把 500 归为 `Network`
   * （`rest.client.ts:106-127` 只认 404/409/400/422），于是远端形态下客户端拿到
   * 「网络异常，请检查连接」——文案指向网络排查，真因却是父记录不存在。
   * 这三条用例锁死「同一件事、同一个码」。
   */
  it('对不存在的执行单追加事件 → 404（不是 500 storage / Network）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/executions/no_such_exec/events',
      payload: { seq: 1, type: 'created', actor: 'user' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_found');
  });

  it('对不存在的执行单创建提案 → 404（不是 500 storage / Network）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/executions/no_such_exec/proposals',
      payload: { projectId: PROJECT_ID, operations: [], idempotencyKey: 'wb:orphan' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_found');
  });

  it('父存在时 events / proposals 照常 200（确认没过度收紧）', async () => {
    // 反向用例：只测「该拒的拒了」会掩盖「把合法的也拒了」——那更糟（功能没了还不报错）。
    const exec = await createExecution(app);
    const ev = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/events`,
      payload: { seq: 1, type: 'created', actor: 'user' },
    });
    expect(ev.statusCode).toBe(200);
    const pr = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/proposals`,
      payload: { projectId: PROJECT_ID, operations: [], idempotencyKey: 'wb:ok' },
    });
    expect(pr.statusCode).toBe(200);
    expect(pr.json<{ status: string }>().status).toBe('draft');
  });

  it('proposal 的 attemptId 允许指向不存在的 attempt（不过度收紧，与 DDL 对齐）', async () => {
    /**
     * `writeback_proposals.attempt_id` 在 `schema.sql` 里**没有** `REFERENCES`
     * （`execution_attempts` 有、events/proposals 没有），也没有任何读路径 JOIN 它。
     * 故这里**刻意**不查 attempt 存在性 —— 本用例把「刻意不查」钉住：
     * 若将来有人「顺手补一条存在性检查」，这条会红，提醒他先看 DDL 与两端分歧风险。
     */
    const exec = await createExecution(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/proposals`,
      payload: {
        projectId: PROJECT_ID,
        attemptId: 'attempt_does_not_exist',
        operations: [],
        idempotencyKey: 'wb:ghost-attempt',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ attemptId: string | null }>().attemptId).toBe('attempt_does_not_exist');
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

/**
 * ★ 缺口 1：`createAttempt` 的 `status` 曾**完全没有白名单校验**。
 *
 * 实测（修复前）：`POST /api/executions/<id>/attempts {"status":"not-a-status"}` → **200**，
 * 落库 `{"attempt_no":1,"status":"not-a-status"}`；`{"status":"succeeded"}` 同样 200。
 *
 * ── 为什么这是「静默数据损坏」而不是「输入有点脏」──
 * attempt 的**创建路径不经过状态机**（`assertAttemptTransition` 只在 `updateAttempt` 上），
 * 于是非法 / 绕过式 status 一旦落库就**永久留存**，且两个下游判据都会放行它：
 *   · `ATTEMPT_NON_TERMINAL_STATUSES.includes(a.status)`（`execution-state.ts` 的 `canStartAttempt`）
 *     → 非法值不在集合里 → 判它「不是活的」→ **允许再开新 attempt**（单活不变量破了）；
 *   · `isContradictoryExecution`（`execution-recovery.ts:150-156`）同样用那个 `includes`
 *     → 终态 execution 上挂一个非法 attempt **不被识别为矛盾** → 既不收敛也不标给用户看。
 * 结果是一条「永远活着又不被识别」的记录。修法见本文件的 `ATTEMPT_STATUSES` 注释。
 *
 * ── 合法值集合定为「全部 6 个」而非「只接受 queued」──
 * 证据：`tests/execution-enforcement.spec.ts`（L208/213/224/236/410/422/433/440）与本 spec
 * 的 `currentAttemptNo` 组**刻意**用 `createAttempt({status:'running'})` /
 * `{status:'succeeded'}` 来快速构造「已有一条终态 attempt，可以再开新 attempt」的场景。
 * 那是既有设计意图（仓储是通用写入口，不只服务「新建即排队」这一条 UI 路径），
 * 收紧成「只接受 queued」会砍掉它并让一批用例必须改构造方式 —— 那是扩大改动面，
 * 不是修缺口。故本次只**拒绝非法值**，接受全部 6 个合法值。
 */
describe('服务端执行域：attempt 创建时的 status 白名单（缺口 1）', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
    await seedProject(app);
  });

  /** 直接查库数 attempt 行数 —— 「拒了但已经落了一行」是最坏的假修复 */
  function attemptCount(): number {
    const r = db.prepare('SELECT COUNT(*) AS n FROM execution_attempts').get() as { n: number };
    return r.n;
  }

  it('非法 status → 400 validation，且**库里一行都没落**', async () => {
    const exec = await createExecution(app);
    expect(attemptCount()).toBe(0);

    const res = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: { status: 'not-a-status' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; userMessage: string } }>();
    expect(body.error.code).toBe('validation');
    // 文案要能让调用方自查：必须列出合法值
    expect(body.error.userMessage).toContain('not-a-status');
    expect(body.error.userMessage).toContain('queued');

    // ★ 关键断言：不只是「拒绝了」，而是**什么都没写**
    expect(attemptCount()).toBe(0);
    // 并且 attemptNo 号段没被偷偷推进（下次开 attempt 仍是 1）
    const ok = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: {},
    });
    expect(ok.json<{ attemptNo: number }>().attemptNo).toBe(1);
  });

  it('终态 succeeded 可以直接创建（既有设计意图），但**非法**终态如 "done" 一律拒', async () => {
    /**
     * 这条刻意把「合法终态放行」与「非法终态拒绝」并排断言，防止两种误读：
     *   · 只看后半个 → 以为收紧成「只接受 queued」；
     *   · 只看前半个 → 以为压根没校验（正是修复前的状态）。
     */
    const exec = await createExecution(app);
    const ok = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: { status: 'succeeded' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ status: string }>().status).toBe('succeeded');

    const exec2 = await createExecution(app, 'exec:test:whitelist:2');
    const bad = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec2.id}/attempts`,
      payload: { status: 'done' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error: { code: string } }>().error.code).toBe('validation');
    expect(attemptCount()).toBe(1); // 只有上面那条 succeeded
  });

  it('六个合法值逐个放行，其余全部拒绝（含大小写变体与终态名）', async () => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    const payloads = [
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
      // 以下全是**必须拒**的：大小写变体、近似词、历史遗留词、空串、非字符串
      'QUEUED',
      'Queued',
      'done',
      'complete',
      'canceled', // 美式拼写：不是枚举值（枚举是双 l 的 cancelled）
      '',
      'queued ',
    ];
    for (const [i, s] of payloads.entries()) {
      const exec = await createExecution(app, `exec:test:six:${i}`);
      const res = await app.inject({
        method: 'POST',
        url: `/api/executions/${exec.id}/attempts`,
        payload: { status: s },
      });
      if (res.statusCode === 200) accepted.push(s);
      else {
        rejected.push(s);
        expect(res.statusCode).toBe(400);
      }
    }
    expect(accepted).toEqual([
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
    ]);
    expect(rejected).toEqual(['QUEUED', 'Queued', 'done', 'complete', 'canceled', '', 'queued ']);
    // 6 条合法 + 7 条非法被拒 → 库里恰好 6 行（非法的连一行都没落）
    expect(attemptCount()).toBe(6);
  });

  it('非字符串 status（数字/对象/数组/布尔/null）→ 400 而非 500，且一行不落', async () => {
    /**
     * 注意 `null` 也在**拒绝**之列（不是「未提供」）：`optionalEnum` 只放行 `undefined`
     * 与字符串，其余一律 ShapeError → 400。这条是**实测确认**的，不是照抄推断 ——
     * 第一版断言写的是「null 可能被当作未提供 → 库里 1 行」，跑出来是 0，说明实现更严，
     * 于是把断言改正成实现真实行为（而不是把实现改成我猜的样子）。
     */
    for (const [i, v] of [1, {}, [], true, null].entries()) {
      const exec = await createExecution(app, `exec:test:nonstr:${i}`);
      const res = await app.inject({
        method: 'POST',
        url: `/api/executions/${exec.id}/attempts`,
        payload: { status: v },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('validation');
    }
    expect(attemptCount()).toBe(0);
  });

  it('联动：`isContradictoryExecution` 依赖 `includes`，白名单是它的前提', async () => {
    /**
     * ── 这条怎么验证联动（不是复述实现）──
     * 用**真服务端**造出「终态 execution + 一条 attempt」，把 HTTP 层返回的 attempt
     * 喂给 UI 用的同一个判据函数，比对两类输入的结果差异：
     *   · 非法 status（`not-a-status`）——修复前它真能落库 —— `includes()` 判 false
     *     → `isContradictoryExecution` 返回 **false**（识别不出矛盾，正是缺口）；
     *   · 合法非终态（`queued`）—— 判 true（能识别）。
     * 修复后前者**根本无法进库**，故本用例的作用是：把「白名单为什么必须存在」
     * 变成一个可执行的证明，而不是一句注释。若有人撤掉白名单，前段的 400 断言会红。
     */
    const exec = await createExecution(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/executions/${exec.id}`,
      payload: { status: 'cancelled' },
    });
    expect(res.statusCode).toBe(200);

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: { status: 'not-a-status' },
    });
    expect(blocked.statusCode).toBe(400); // 进不了库 → 矛盾判据不会被它骗过

    const live = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/attempts`,
      payload: { status: 'queued' },
    });
    expect(live.statusCode).toBe(200);
    const attempt = live.json<{ id: string; status: string }>();

    // 真判据（UI 与兜底扫描共用同一份实现）
    const listed = await app.inject({
      method: 'GET',
      url: `/api/executions/${exec.id}/attempts`,
    });
    const attempts = listed.json<Array<{ status: string }>>();
    expect(attempts.map((a) => a.status)).toEqual([attempt.status]);
    expect(
      isContradictoryExecution(
        { status: ExecutionStatus.Cancelled },
        attempts as Array<{ status: AttemptStatus }>,
      ),
    ).toBe(true);
    // 对照：非法值（若它真落库了）会被判 false —— 这就是缺口的形状
    expect(
      isContradictoryExecution(
        { status: ExecutionStatus.Cancelled },
        [{ status: AttemptStatus.Queued }],
      ),
    ).toBe(true);
    const bogus = { status: 'not-a-status' as unknown as AttemptStatus };
    expect(ATTEMPT_NON_TERMINAL_STATUSES.includes(bogus.status)).toBe(false);
    expect(isContradictoryExecution({ status: ExecutionStatus.Cancelled }, [bogus])).toBe(false);
  });
});

/**
 * 审计补齐（原缺口 1 的**同源排查**）：`createProposal` 的 `status` 此前也没有值域校验。
 *
 * 两条既有检查都是「状态语义」而非「值域」：`status='ghost'` 既不等于 applied 也不等于
 * rejected，两条都不触发 → 实测**两端都落库**。危害与 attempt 同源（永久留存 +
 * 界面按未知状态静默漏显），故一并补上并在此锁死。
 */
describe('服务端执行域：proposal 创建时的 status 白名单（审计补齐）', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
    await seedProject(app);
  });

  function proposalCount(): number {
    const r = db.prepare('SELECT COUNT(*) AS n FROM writeback_proposals').get() as { n: number };
    return r.n;
  }

  it('非法 status → 400 validation，且库里一行都没落', async () => {
    const exec = await createExecution(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/executions/${exec.id}/proposals`,
      payload: { projectId: PROJECT_ID, operations: [], idempotencyKey: 'wb:ghost', status: 'ghost' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; userMessage: string } }>();
    expect(body.error.code).toBe('validation');
    expect(body.error.userMessage).toContain('ghost');
    expect(body.error.userMessage).toContain('draft'); // 文案列出合法值
    expect(proposalCount()).toBe(0);
  });

  it('五个合法值：draft / proposed / conflict 放行，applied / rejected 仍被 P0 拒', async () => {
    const exec = await createExecution(app);
    for (const [i, s] of ['draft', 'proposed', 'conflict'].entries()) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/executions/${exec.id}/proposals`,
        payload: { projectId: PROJECT_ID, operations: [], idempotencyKey: `wb:ok:${i}`, status: s },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe(s);
    }
    for (const s of ['applied', 'rejected']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/executions/${exec.id}/proposals`,
        payload: { projectId: PROJECT_ID, operations: [], idempotencyKey: `wb:p0:${s}`, status: s },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(proposalCount()).toBe(3);
  });

  it('非法值形态：大写变体 / 近似词 / 空串 → 400', async () => {
    const exec = await createExecution(app);
    for (const [i, s] of ['DRAFT', 'Proposed', 'done', 'applied ', ''].entries()) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/executions/${exec.id}/proposals`,
        payload: { projectId: PROJECT_ID, operations: [], idempotencyKey: `wb:bad:${i}`, status: s },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(proposalCount()).toBe(0);
  });
});
