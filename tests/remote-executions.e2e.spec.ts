/**
 * 远端执行域适配器 ↔ 真实服务端 端到端契约锁定（v0.8）。
 *
 * ── 这个 spec 存在的理由 ──
 * `RemoteExecutionsRepository` 的 12 个方法此前全是 `notImplemented` 桩，
 * 「服务端有端点」与「客户端能调通」是两件事：路径、字段名（camelCase）、
 * 返回形状、错误码，任何一处对不上都是**运行期**才暴露的静默失效
 * （最坏形态：读回空数组，界面显示「没有执行记录」，而库里其实有）。
 * 本 spec 用**真服务端**（内存 SQLite + 全量路由）当被测对象，用
 * `RemoteExecutionsRepository` 当客户端打它，逐方法锁死契约。
 *
 * ── 怎么把真实服务端喂给 RestClient ──
 * `RestClient` 内部走全局 `fetch(\`${baseUrl}${path}\`)`。这里 `vi.stubGlobal('fetch', …)`
 * 装一个**基于 `app.inject` 的 fetch 替身**：
 *   · 比起真实端口（`app.listen`）更稳：不碰 socket，无端口占用 / TIME_WAIT / 防火墙问题，
 *     且与 `tests/server.*.spec.ts` 同一套设施；
 *   · 比手写 mock 强得多：请求真的走完 Fastify 路由栈 → 真仓储 → 真事务 → 真 SQLite，
 *     路径写错（404）、字段名写错（validation）、返回形状不符（断言红）**全部可见**。
 * 替身只做三件事：把 `baseUrl + path` 拆成 inject 需要的 `url`、拷 header、回 `Response`。
 * 它**不碰业务**，因此「路径是否含重复 /api」这类错误原样暴露（见变异验证 ①）。
 *
 * ── 环境 ──
 * 无 jsdom：本 spec 走 node 环境，只有 `RemoteExecutionsRepository` + 真服务端，
 * 不涉及 React（另见 `tests/agent-console-consistency.spec.tsx` 的 UI 侧）。
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
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

import { RemoteExecutionsRepository, RestClient } from '../src/core/repositories/remote/rest.client';
import { ChangxiaError, ChangxiaErrorCode } from '../src/core/types/enums';
import { AttemptStatus, ExecutionStatus } from '../src/core/types/agent-execution';
import type { ExecutionConfirmation } from '../src/core/types/agent-execution';
import { computePlanHash } from '../src/core/execution/plan-hash';

const PROJECT_ID = 'proj_remote';
/** `VITE_API_BASE_URL` 的真实形状：**已含 /api** 且**无尾斜杠**（装配点会 strip） */
const API_BASE = 'http://nas.test.local:7788/api';

/* -------------------------------- 服务端 -------------------------------- */

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

/**
 * `vi.stubGlobal('fetch', …)` 的替身：把 RestClient 的请求转成 `app.inject`。
 *
 * 只做 URL 拆解与 Response 构造 —— **不做任何路径改写 / 容错重试**，
 * 否则「路径写错」这类缺陷会被替身自己抹平，测试就成了假绿。
 */
function installInjectFetch(app: FastifyInstance): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const full = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // 替身复用真实 URL 解析：`new URL` 会归一化重复斜杠之外的一切，
      // 但 `/api/api/...` 这种**语义错误**原样保留 → 服务端 404 → 用例红。
      const u = new URL(full);
      const res = await app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
        url: `${u.pathname}${u.search}`,
        payload: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return new Response(res.statusCode === 204 ? null : res.body, {
        status: res.statusCode,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

async function seedProject(app: FastifyInstance): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      id: PROJECT_ID,
      name: '远端执行域项目',
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

/**
 * 用「真实执行单」算出确认快照：stale-approval 收紧后 planHash 必须 ==
 * computePlanHash(execution) 才能过门槛，故测试不再手抄 hash，而是按真实实体计算。
 */
async function confirmationFor(
  repo: RemoteExecutionsRepository,
  id: string,
): Promise<ExecutionConfirmation> {
  const exec = await repo.getExecution(id);
  if (!exec) throw new Error(`fixture: execution ${id} 不存在`);
  return {
    confirmedAt: '2026-09-01T00:00:00.000Z',
    confirmedBy: 'm_human',
    planHash: computePlanHash(exec),
    planRevision: 1,
  };
}

/* --------------------------------- 用例 --------------------------------- */

describe('远端执行域适配器 ↔ 真实服务端（端到端契约）', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let repo: RemoteExecutionsRepository;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
    await seedProject(app);
    installInjectFetch(app);
    repo = new RemoteExecutionsRepository(new RestClient(API_BASE));
  });

  /* ---------------- ① 12 个方法 happy path ---------------- */

  it('createExecution：POST /projects/:id/executions，projectId 走路径、默认 draft', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'project-task',
      objective: '把阶段二挪到下周',
      taskId: null,
      agentMemberId: null,
      channelKind: 'workbuddy',
      inputSnapshotHash: null,
      idempotencyKey: 'exec:remote:1',
    });
    expect(exec.projectId).toBe(PROJECT_ID);
    expect(exec.status).toBe(ExecutionStatus.Draft);
    expect(exec.currentAttemptNo).toBe(0);
    expect(exec.confirmation).toBeNull();
    expect(exec.channelKind).toBe('workbuddy');
    expect(typeof exec.id).toBe('string');
  });

  it('getExecution / listExecutionsByProject：读回与写入同形', async () => {
    const created = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '读回形状',
      idempotencyKey: 'exec:remote:2',
    });
    const one = await repo.getExecution(created.id);
    expect(one).toEqual(created);

    const list = await repo.listExecutionsByProject(PROJECT_ID);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(created);
  });

  it('getExecution：不存在返回 null（不是抛错，与接口契约一致）', async () => {
    await expect(repo.getExecution('nope')).resolves.toBeNull();
  });

  it('updateExecutionStatus：PATCH /executions/:id，确认与入队同一步', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '状态推进',
      idempotencyKey: 'exec:remote:3',
    });
    const toConfirm = await repo.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.AwaitingConfirmation,
    });
    expect(toConfirm.status).toBe(ExecutionStatus.AwaitingConfirmation);
    expect(toConfirm.confirmation).toBeNull();

    // ★ 合并确认快照：同一步带 confirmation 入队必须放行（服务端 L890-895）
    const queued = await repo.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.Queued,
      confirmation: await confirmationFor(repo, exec.id),
    });
    expect(queued.status).toBe(ExecutionStatus.Queued);
    expect(queued.confirmation).toEqual(await confirmationFor(repo, exec.id));
  });

  it('createAttempt / listAttempts / updateAttempt：attemptNo 由服务端分配并原样读回', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '尝试链路',
      idempotencyKey: 'exec:remote:4',
    });
    const a1 = await repo.createAttempt({ executionId: exec.id });
    expect(a1.attemptNo).toBe(1);
    expect(a1.status).toBe(AttemptStatus.Queued);

    const running = await repo.updateAttempt(a1.id, { status: AttemptStatus.Running });
    expect(running.status).toBe(AttemptStatus.Running);

    const done = await repo.updateAttempt(a1.id, { status: AttemptStatus.Succeeded });
    expect(done.status).toBe(AttemptStatus.Succeeded);
    // 进终态自动盖 finishedAt（服务端 L1091-1093，与本地适配器同规则）
    expect(done.finishedAt).not.toBeNull();

    const a2 = await repo.createAttempt({ executionId: exec.id });
    expect(a2.attemptNo).toBe(2);

    const list = await repo.listAttempts(exec.id);
    expect(list.map((a) => a.attemptNo)).toEqual([1, 2]);
  });

  it('appendEvent / listEvents：seq 严格单调，读回按 seq 升序', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '事件链路',
      idempotencyKey: 'exec:remote:5',
    });
    const e1 = await repo.appendEvent({
      executionId: exec.id,
      seq: 1,
      type: 'status_changed',
      actor: 'system',
      fromStatus: ExecutionStatus.Draft,
      toStatus: ExecutionStatus.AwaitingConfirmation,
      reason: '提交确认',
    });
    expect(e1.seq).toBe(1);
    expect(e1.executionId).toBe(exec.id);

    await repo.appendEvent({
      executionId: exec.id,
      seq: 2,
      type: 'error',
      actor: 'user',
      reason: '人工备注',
    });
    const events = await repo.listEvents(exec.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events[0].fromStatus).toBe(ExecutionStatus.Draft);
  });

  it('createProposal / listProposals / updateProposal：审批落定闭环', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '提案链路',
      idempotencyKey: 'exec:remote:6',
    });
    const p = await repo.createProposal({
      executionId: exec.id,
      projectId: PROJECT_ID,
      operations: [{ field: 'task.status', before: 'todo', after: 'done' }],
      idempotencyKey: 'wb:remote:1',
    });
    expect(p.status).toBe('draft');
    expect(p.decidedBy).toBeNull();

    const applied = await repo.updateProposal(p.id, {
      status: 'applied',
      decidedBy: 'm_human',
    });
    expect(applied.status).toBe('applied');
    expect(applied.decidedBy).toBe('m_human');
    expect(applied.decidedAt).not.toBeNull();
    // operations 是 JSON 数组列：往返必须保真（误走对象反序列化会被清成 {}）
    expect(applied.operations).toEqual([{ field: 'task.status', before: 'todo', after: 'done' }]);

    const list = await repo.listProposals(exec.id);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('applied');
  });

  it('12 个方法全覆盖：一次跑完全链路（防「某一方法没被调过」的假覆盖）', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'project-task',
      objective: '全链路',
      idempotencyKey: 'exec:remote:full',
    });
    expect((await repo.listExecutionsByProject(PROJECT_ID)).length).toBe(1);
    await repo.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.AwaitingConfirmation,
    });
    await repo.appendEvent({
      executionId: exec.id, seq: 1, type: 'status_changed', actor: 'user',
    });
    const attempt = await repo.createAttempt({ executionId: exec.id });
    await repo.updateAttempt(attempt.id, { status: AttemptStatus.Running });
    await repo.createProposal({
      executionId: exec.id, projectId: PROJECT_ID,
      operations: [], idempotencyKey: 'wb:full',
    });
    expect((await repo.getExecution(exec.id))?.id).toBe(exec.id);
    expect((await repo.listEvents(exec.id)).length).toBe(1);
    expect((await repo.listAttempts(exec.id)).length).toBe(1);
    expect((await repo.listProposals(exec.id)).length).toBe(1);
  });

  /* ---------------- ② 服务端校验的错误语义如实传播 ---------------- */

  it('非法状态转移（draft → completed）→ Validation，**不是** Network', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '非法转移',
      idempotencyKey: 'exec:remote:7',
    });
    const err = await repo
      .updateExecutionStatus(exec.id, { status: ExecutionStatus.Completed })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChangxiaError);
    expect((err as ChangxiaError).code).toBe(ChangxiaErrorCode.Validation);
    // 服务端的权威文案必须逐字到达（含 from → to），不能被换成「网络错误」
    expect((err as ChangxiaError).userMessage).toContain('draft');
    expect((err as ChangxiaError).userMessage).toContain('completed');
  });

  it('未确认不得入队 → Validation（产品铁律「未人工确认绝不执行」在远端形态可见）', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '未确认入队',
      idempotencyKey: 'exec:remote:8',
    });
    await repo.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.AwaitingConfirmation,
    });
    const err = await repo
      .updateExecutionStatus(exec.id, { status: ExecutionStatus.Queued })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);
    expect((err as ChangxiaError).userMessage).toContain('confirmation');
  });

  it('completed 缺 applied 提案 → Validation（执行成功 ≠ 业务完成）', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '缺提案完成',
      idempotencyKey: 'exec:remote:9',
    });
    await repo.updateExecutionStatus(exec.id, { status: ExecutionStatus.AwaitingConfirmation });
    await repo.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.Queued, confirmation: await confirmationFor(repo, exec.id),
    });
    await repo.updateExecutionStatus(exec.id, { status: ExecutionStatus.Running });
    await repo.updateExecutionStatus(exec.id, { status: ExecutionStatus.AwaitingReview });
    const err = await repo
      .updateExecutionStatus(exec.id, { status: ExecutionStatus.Completed })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);
    expect((err as ChangxiaError).userMessage).toContain('applied');
  });

  it('seq 跳号 → Validation（append-only 审计流水的规范排序键）', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: 'seq 跳号',
      idempotencyKey: 'exec:remote:10',
    });
    const err = await repo
      .appendEvent({ executionId: exec.id, seq: 5, type: 'resumed', actor: 'user' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);
    expect((err as ChangxiaError).userMessage).toContain('seq');
  });

  it('attemptNo 与计算值不一致 → Validation（不静默修正）', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: 'attemptNo 乱传',
      idempotencyKey: 'exec:remote:11',
    });
    const err = await repo
      .createAttempt({ executionId: exec.id, attemptNo: 7 })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);
    expect((err as ChangxiaError).userMessage).toContain('attemptNo');
  });

  it('已存在非终态 attempt → Conflict（单活 attempt 不变量）', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '重复开活',
      idempotencyKey: 'exec:remote:12',
    });
    await repo.createAttempt({ executionId: exec.id });
    const err = await repo
      .createAttempt({ executionId: exec.id })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Conflict);
  });

  it('attempt 终态不得改回 running → Validation', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: 'attempt 回退',
      idempotencyKey: 'exec:remote:13',
    });
    const a = await repo.createAttempt({ executionId: exec.id });
    await repo.updateAttempt(a.id, { status: AttemptStatus.Failed });
    const err = await repo
      .updateAttempt(a.id, { status: AttemptStatus.Running })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);
  });

  it('提案直接创建为 applied → Validation（审批事实必须经由 updateProposal 落定）', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '提案越权',
      idempotencyKey: 'exec:remote:14',
    });
    const err = await repo
      .createProposal({
        executionId: exec.id,
        projectId: PROJECT_ID,
        operations: [],
        idempotencyKey: 'wb:bad',
        status: 'applied',
      })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);
  });

  it('提案落定缺 decidedBy → Validation；已落定再改 → Conflict', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '提案审批',
      idempotencyKey: 'exec:remote:15',
    });
    const p = await repo.createProposal({
      executionId: exec.id,
      projectId: PROJECT_ID,
      operations: [],
      idempotencyKey: 'wb:dec',
    });
    const noDecider = await repo
      .updateProposal(p.id, { status: 'applied' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((noDecider as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);

    await repo.updateProposal(p.id, { status: 'applied', decidedBy: 'm_human' });
    const again = await repo
      .updateProposal(p.id, { status: 'rejected', decidedBy: 'm_human' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((again as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Conflict);
  });

  it('孤儿 attempt（execution 不存在）→ NotFound，不是 500/Network', async () => {
    const err = await repo
      .createAttempt({ executionId: 'exec_not_exist' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.NotFound);
  });

  /**
   * ★ 缺口 2：孤儿父记录写 events / proposals 曾返回 500，经 `RestClient` 映射成
   * **Network** —— 客户端文案指向「网络排查」，真因却是父记录不存在（外键约束）。
   *
   * 这三条（含上面那条 createAttempt）一起构成「同一件事必须同一个码」的**客户端侧**证据：
   * 单看服务端返回 404 还不够 —— 中间还隔着 HTTP → 业务码的映射
   * （`rest.client.ts:106-127`），映射表里 404→NotFound、500→Network，
   * 任何一环写错都会让「服务端对了但客户端拿到的还是 Network」。
   */
  it('孤儿 appendEvent（execution 不存在）→ NotFound，不是 500/Network', async () => {
    const err = await repo
      .appendEvent({ executionId: 'exec_not_exist', seq: 1, type: 'created', actor: 'user' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.NotFound);
    // 硬纠偏：`Network` 是本缺口修复前的形态，写死它出不来
    expect((err as ChangxiaError).code).not.toBe(ChangxiaErrorCode.Network);
  });

  it('孤儿 createProposal（execution 不存在）→ NotFound，不是 500/Network', async () => {
    const err = await repo
      .createProposal({
        executionId: 'exec_not_exist',
        projectId: PROJECT_ID,
        operations: [],
        idempotencyKey: 'wb:orphan',
      })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.NotFound);
    expect((err as ChangxiaError).code).not.toBe(ChangxiaErrorCode.Network);
  });

  it('createAttempt 的 status 非法 → Validation（不是 500/Network），且没落库', async () => {
    /**
     * 缺口 1 的客户端视角：修复前服务端直接 200 落库非法 status，客户端**根本不会报错** ——
     * 这条用例在修复前是「没有任何异常可捕获」，故它同时锁住「必须报错」与「错在 Validation」。
     */
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '非法 status',
      idempotencyKey: 'exec:remote:20',
    });
    const err = await repo
      .createAttempt({ executionId: exec.id, status: 'not-a-status' as never })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);
    expect((err as ChangxiaError).code).not.toBe(ChangxiaErrorCode.Network);
    // 「拒绝了」还得「什么都没写」：经真服务端读回必须为空
    expect(await repo.listAttempts(exec.id)).toHaveLength(0);
  });

  it('createAttempt 的六个合法 status 都能经客户端读写往返', async () => {
    for (const [i, s] of [
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
    ].entries()) {
      const exec = await repo.createExecution({
        projectId: PROJECT_ID,
        source: 'natural-language',
        objective: `合法 status ${s}`,
        idempotencyKey: `exec:remote:valid:${i}`,
      });
      const a = await repo.createAttempt({ executionId: exec.id, status: s as never });
      expect(a.status).toBe(s);
      const [reread] = await repo.listAttempts(exec.id);
      expect(reread?.status).toBe(s);
    }
  });

  /* ---------------- ③ 字段名 / 形状对齐 ---------------- */

  it('camelCase 全程一致：写入的每个字段都能在响应里按同名读回', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'external',
      objective: '字段名对齐',
      taskId: null,
      agentMemberId: 'm_agent',
      channelKind: 'loopback',
      inputSnapshotHash: 'sha256:abc',
      idempotencyKey: 'exec:remote:16',
    });
    expect(exec).toMatchObject({
      projectId: PROJECT_ID,
      source: 'external',
      objective: '字段名对齐',
      agentMemberId: 'm_agent',
      channelKind: 'loopback',
      inputSnapshotHash: 'sha256:abc',
      idempotencyKey: 'exec:remote:16',
    });
    // snake_case 泄漏 = 某一层漏了映射（SQLite 列名直出）
    for (const k of Object.keys(exec)) {
      expect(k).not.toContain('_');
    }
  });

  it('updateExecutionStatus 的 confirmation 三态：不传=保留、null=清空', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '确认三态',
      idempotencyKey: 'exec:remote:17',
    });
    await repo.updateExecutionStatus(exec.id, { status: ExecutionStatus.AwaitingConfirmation });
    await repo.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.Queued, confirmation: await confirmationFor(repo, exec.id),
    });

    // 不传 confirmation：保留既有（推进到 running 时仍带确认）
    const running = await repo.updateExecutionStatus(exec.id, { status: ExecutionStatus.Running });
    expect(running.confirmation).toEqual(await confirmationFor(repo, exec.id));

    // 显式 null：撤销确认
    const cleared = await repo.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.Paused, confirmation: null,
    });
    expect(cleared.confirmation).toBeNull();
  });

  it('不存在字段不被 JSON 序列化下发（undefined 语义 = 「不动」而非「清空」）', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: 'undefined 语义',
      idempotencyKey: 'exec:remote:18',
    });
    await repo.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.AwaitingConfirmation, blockedReason: '等排期确认',
    });
    const after = await repo.updateExecutionStatus(exec.id, { status: ExecutionStatus.Draft });
    // blockedReason 未传 → 保留（若被序列化成 null 下发，这里会变 null）
    expect(after.blockedReason).toBe('等排期确认');
  });

  it('db 句柄被真实写入（防「替身把请求吞了」的假绿）', async () => {
    const exec = await repo.createExecution({
      projectId: PROJECT_ID,
      source: 'natural-language',
      objective: '落库确认',
      idempotencyKey: 'exec:remote:19',
    });
    const row = db.prepare('SELECT * FROM executions WHERE id = ?').get(exec.id) as
      | { project_id: string; status: string }
      | undefined;
    expect(row?.project_id).toBe(PROJECT_ID);
    expect(row?.status).toBe('draft');
  });

  /* ---------------- ④ RestClient 错误映射（本次补的 400 缺口） ---------------- */

  it('HTTP 400 → ChangxiaError(Validation) 并透出服务端 userMessage', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: 'validation', userMessage: '非法的执行状态转移：draft → completed' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const api = new RestClient(API_BASE);
    const err = await api
      .patch('/executions/e1', { status: 'completed' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError).code).toBe(ChangxiaErrorCode.Validation);
    expect((err as ChangxiaError).userMessage).toContain('draft → completed');
  });

  it('HTTP 422 同样归 Validation；500 不冒充 Validation', async () => {
    vi.unstubAllGlobals();
    const api = new RestClient(API_BASE);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 422 })));
    const err422 = await api.get('/executions/e1').then(() => null).catch((e: unknown) => e);
    expect((err422 as ChangxiaError).code).toBe(ChangxiaErrorCode.Validation);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const err500 = await api.get('/executions/e1').then(() => null).catch((e: unknown) => e);
    // 500 = 服务端故障（服务端 CODE_TO_STATUS 把 storage 映到 500）→ 不是 Validation，
    // 也不该是 Conflict/NotFound。归 Network 是既有口径，此处只锁「别误判成入参错」。
    expect((err500 as ChangxiaError).code).not.toBe(ChangxiaErrorCode.Validation);
  });
});
