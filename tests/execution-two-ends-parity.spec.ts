/**
 * 执行域「两端一致」护栏（v0.8 · 缺口 1 / 缺口 2 的可执行防线）。
 *
 * ── 这个 spec 存在的理由 ──
 * 本仓库的形态是「本地 Dexie 适配器 + 远端 SQLite 适配器（经 HTTP）」双实现，
 * 两者都要满足 `IExecutionsRepository` 的**同一份**语义契约。历史上有过一个真实教训：
 * 服务端 `createAttempt` 有父存在性检查而本地侧没有 —— 两端对**同一件事**给出不同的码，
 * 于是「同一个操作在本地成功、在 NAS 上失败」这类只在部署后才暴露的缺陷。
 *
 * 只测一端 = 只锁住一半契约。更坏的是：**只修一端**会制造**新的**两端分歧，
 * 那比「两端一致地不完整」更难诊断（至少后者行为可预测）。故本 spec 的价值不在
 * 「再测一遍两个方法」，而在于**把「两端必须同款」这句话变成一条会红的断言**。
 *
 * ── 怎么做的（关键：不重复写两遍用例，而是同一张表跑两遍）──
 *   · 一张**输入表**（`ATTEMPT_STATUS_CASES` / `ORPHAN_CASES`），每行是「输入 + 期望码」；
 *   · 两个**驱动器**：`driveLocal`（真 Dexie + `LocalExecutionsRepository`）与
 *     `driveRemote`（真 Fastify + 内存 SQLite + `RemoteExecutionsRepository`，经
 *     `vi.stubGlobal('fetch')` 打到真路由栈）；
 *   · 断言写成 `expect(remoteResult).toEqual(localResult)` —— 即**只比较两端彼此**，
 *     不比较「两端与期望」。
 *
 * ── 为什么敢只比较两端彼此（而不是各自比期望）──
 * 若只断言 `both === expected`，一个「两端商量好一起错」的实现也能全绿；
 * 反之若两端各自与期望一致，两端之间必然一致 —— 但那种写法**不会在只改一端时变红**，
 * 因为它没有把「两端」放进同一条断言里。本 spec 刻意两件事都做：
 *   ① `expect(local).toEqual(remote)`（护栏：只改一端必红）
 *   ② `expect(local).toEqual(expected)`（正确性：两端一起错也红）
 *
 * ── 变异验证（已实测，见报告）──
 * 撤掉**本地侧**的 `ATTEMPT_STATUSES` 白名单 → 本 spec 的 attempt 组变红
 * （远端 400 / 本地 200 落库），而两个「单端 spec」各自依然全绿 ——
 * 这正是本 spec 不可被单端用例替代的证明。
 */

import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

import { installFakeIndexedDB } from './setup';
import { createDb } from '../server/db';
import { createSqliteBundle } from '../server/adapters/sqlite.bundle';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';
import { registerTaskRoutes } from '../server/routes/tasks.routes';
import { registerMemberRoutes } from '../server/routes/members.routes';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { registerExecutionRoutes } from '../server/routes/executions.routes';

import { RemoteExecutionsRepository, RestClient } from '../src/core/repositories/remote/rest.client';
import type { IExecutionsRepository } from '../src/core/repositories/interfaces';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { ChangxiaErrorCode } from '../src/core/types/enums';
import {
  ATTEMPT_STATUSES,
  EXECUTION_SOURCES,
  WRITEBACK_PROPOSAL_STATUSES,
} from '../src/core/types/agent-execution';

const PROJECT_ID = 'proj_parity';
const API_BASE = 'http://nas.test.local:7788/api';

/* ------------------------------ 远端设施 ------------------------------ */

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

/** 与 `tests/remote-executions.e2e.spec.ts` 同款：把 RestClient 的 fetch 转到 app.inject */
function installInjectFetch(app: FastifyInstance): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const full = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(full);
      const res = await app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PATCH',
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

async function seedRemoteProject(app: FastifyInstance): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      id: PROJECT_ID,
      name: '两端一致性项目',
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

/* ------------------------------ 本地设施 ------------------------------ */

let localBundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

/** 清空本地库（每个用例独立的干净起点，与远端 beforeAll 建库对齐） */
async function resetLocal(): Promise<void> {
  localBundle = await createRepositories({ dataSource: 'local' });
  await localBundle.admin?.replaceAllImport({
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      projects: [],
      stages: [],
      tasks: [],
      // `itineraries` 必填：`execution.repository.spec.ts` 的同类 fixture 漏了它，
      // 是 tsconfig.tests.json 里 66 条存量债之一。新文件没必要复刻那笔债。
      itineraries: [],
      members: [],
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
      executions: [],
      executionAttempts: [],
      executionEvents: [],
      writebackProposals: [],
    },
  });
}

/* ---------------------------- 调用结果的规范化 ---------------------------- */

/**
 * 把一次调用压成**可比对的形状**：`'ok'` 或错误码（`ChangxiaErrorCode` 的值）。
 *
 * 刻意**只比错误码、不比 userMessage**：两端文案本来就可以不同（本地 vs 服务端可各说各话），
 * 把文案也纳入比对会让本护栏因为纯文案调整而变红 —— 那是噪音，会训练人忽略它。
 * 真正必须逐字同款的是**码**：它决定了调用方的分支与 UI 文案档位
 * （`RestClient` 的映射、`AgentExecutionConsolePage` 的 message() 都按码走）。
 */
async function outcomeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'ok';
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    return typeof code === 'string' ? code : `unexpected:${String(err)}`;
  }
}

/* ================================ 测试 ================================ */

describe('执行域两端一致：同一输入 → 同一个码（护栏）', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let remote: IExecutionsRepository;

  beforeEach(async () => {
    ({ app, db } = await buildServer());
    await seedRemoteProject(app);
    installInjectFetch(app);
    remote = new RemoteExecutionsRepository(new RestClient(API_BASE));
    await resetLocal();
  });

  /** 两端各建一个执行单，返回各自的 executionId（本地 projectId 无外键约束，随便用） */
  async function seedBoth(key: string): Promise<{ localId: string; remoteId: string }> {
    const l = await localBundle.executions.createExecution({
      projectId: PROJECT_ID,
      source: 'project-task',
      objective: 'parity',
      idempotencyKey: `${key}:local`,
    });
    const r = await remote.createExecution({
      projectId: PROJECT_ID,
      source: 'project-task',
      objective: 'parity',
      idempotencyKey: `${key}:remote`,
    });
    return { localId: l.id, remoteId: r.id };
  }

  /* ------------------- ① createAttempt 的 status 值域 ------------------- */

  /**
   * 输入表：`AttemptStatus` 六个合法值 + 一组**必须拒**的形态。
   *
   * 这张表就是「合法值集合」的可执行定义 —— 它必须与 `ATTEMPT_STATUSES` 同步增长。
   * 表里有 `...ATTEMPT_STATUSES` 展开（不是手抄六个字面量）：将来枚举加值，
   * 本用例自动把新值纳入「应放行」组，不会出现「新增值没被护栏覆盖」的盲区。
   */
  const ATTEMPT_STATUS_CASES: ReadonlyArray<{ label: string; value: unknown }> = [
    ...ATTEMPT_STATUSES.map((s) => ({ label: `合法值 ${s}`, value: s })),
    { label: '不存在的值', value: 'not-a-status' },
    { label: '近似值 done', value: 'done' },
    { label: '近似值 complete', value: 'complete' },
    { label: '美式拼写 canceled', value: 'canceled' },
    { label: '大写变体 QUEUED', value: 'QUEUED' },
    { label: '首字母大写 Queued', value: 'Queued' },
    { label: '带尾空格', value: 'queued ' },
    { label: '空串', value: '' },
    { label: '数字', value: 1 },
  ];

  it('createAttempt：status 的接受 / 拒绝集合两端逐值相同', async () => {
    for (const [i, c] of ATTEMPT_STATUS_CASES.entries()) {
      const { localId, remoteId } = await seedBoth(`parity:attempt:${i}`);

      const local = await outcomeOf(() =>
        localBundle.executions.createAttempt({
          executionId: localId,
          status: c.value as never,
        }),
      );
      const remoteOutcome = await outcomeOf(() =>
        remote.createAttempt({ executionId: remoteId, status: c.value as never }),
      );

      // ① 护栏：两端必须**逐值相同**（只改一端 → 这条必红）
      expect(`${c.label} → local=${local}`).toBe(`${c.label} → local=${remoteOutcome}`);
      // ② 正确性：两端一起错也红
      const shouldAccept = ATTEMPT_STATUSES.includes(c.value as never);
      expect(`${c.label} → ${local}`).toBe(`${c.label} → ${shouldAccept ? 'ok' : 'validation'}`);
    }
  });

  it('createAttempt：非法 status 两端都**一行不落**（拒绝 ≠ 什么都没写）', async () => {
    const { localId, remoteId } = await seedBoth('parity:norow');
    await outcomeOf(() =>
      localBundle.executions.createAttempt({ executionId: localId, status: 'ghost' as never }),
    );
    await outcomeOf(() =>
      remote.createAttempt({ executionId: remoteId, status: 'ghost' as never }),
    );
    expect(await localBundle.executions.listAttempts(localId)).toHaveLength(0);
    const listed = await remote.listAttempts(remoteId);
    expect(listed).toHaveLength(0);
    // 另一条独立证据：号段没被推进（下一条 attempt 仍是 1）
    const l = await localBundle.executions.createAttempt({ executionId: localId });
    const r = await remote.createAttempt({ executionId: remoteId });
    expect(l.attemptNo).toBe(r.attemptNo);
    expect(l.attemptNo).toBe(1);
  });

  /* ------------------- ② 孤儿父记录：events / proposals ------------------- */

  const ORPHAN_CASES: ReadonlyArray<{
    label: string;
    run: (repo: IExecutionsRepository) => Promise<unknown>;
  }> = [
    {
      label: 'createAttempt',
      run: (repo) => repo.createAttempt({ executionId: 'exec_not_exist' }),
    },
    {
      label: 'appendEvent',
      run: (repo) =>
        repo.appendEvent({ executionId: 'exec_not_exist', seq: 1, type: 'created', actor: 'user' }),
    },
    {
      label: 'createProposal',
      run: (repo) =>
        repo.createProposal({
          executionId: 'exec_not_exist',
          projectId: PROJECT_ID,
          operations: [],
          idempotencyKey: 'wb:orphan',
        }),
    },
  ];

  it('孤儿父记录：三条写路径两端都返回 NotFound（不是 storage / 不是 500）', async () => {
    for (const c of ORPHAN_CASES) {
      const local = await outcomeOf(() => c.run(localBundle.executions));
      const remoteOutcome = await outcomeOf(() => c.run(remote));

      // ① 护栏：两端同码
      expect(`${c.label} → local=${local}`).toBe(`${c.label} → local=${remoteOutcome}`);
      // ② 正确性：都必须是 NotFound
      expect(`${c.label} → ${local}`).toBe(`${c.label} → ${ChangxiaErrorCode.NotFound}`);
      // ③ 硬纠偏：`storage` 是本缺口修复前的形态（500 → 客户端映射成 Network），
      //    写死它出不来 —— 否则「两端一起退回 500」也能通过 ①
      expect(local).not.toBe(ChangxiaErrorCode.Storage);
      expect(remoteOutcome).not.toBe(ChangxiaErrorCode.Storage);
    }
  });

  it('孤儿父记录：events / proposals 两端都不落任何行', async () => {
    await outcomeOf(() =>
      localBundle.executions.appendEvent({
        executionId: 'exec_not_exist',
        seq: 1,
        type: 'created',
        actor: 'user',
      }),
    );
    await outcomeOf(() =>
      remote.appendEvent({
        executionId: 'exec_not_exist',
        seq: 1,
        type: 'created',
        actor: 'user',
      }),
    );
    await outcomeOf(() =>
      localBundle.executions.createProposal({
        executionId: 'exec_not_exist',
        projectId: PROJECT_ID,
        operations: [],
        idempotencyKey: 'wb:orphan',
      }),
    );
    await outcomeOf(() =>
      remote.createProposal({
        executionId: 'exec_not_exist',
        projectId: PROJECT_ID,
        operations: [],
        idempotencyKey: 'wb:orphan',
      }),
    );
    // 本地：executionEvents / writebackProposals 都是空表
    expect(await localBundle.executions.listEvents('exec_not_exist')).toHaveLength(0);
    expect(await localBundle.executions.listProposals('exec_not_exist')).toHaveLength(0);
    // 远端：直接查库（HTTP 读路径按 executionId 过滤，孤儿行不该存在）
    const ev = db.prepare('SELECT COUNT(*) AS n FROM execution_events').get() as { n: number };
    const pr = db.prepare('SELECT COUNT(*) AS n FROM writeback_proposals').get() as { n: number };
    expect(ev.n).toBe(0);
    expect(pr.n).toBe(0);
  });

  /* ------------------- ③ 反向：父存在时两端都成功（没过度收紧）------------------- */

  it('父存在时：events / proposals / attempts 两端都成功（确认没过度收紧）', async () => {
    const { localId, remoteId } = await seedBoth('parity:happy');

    expect(await outcomeOf(() =>
      localBundle.executions.appendEvent({
        executionId: localId,
        seq: 1,
        type: 'created',
        actor: 'user',
      }),
    )).toBe('ok');
    expect(await outcomeOf(() =>
      remote.appendEvent({ executionId: remoteId, seq: 1, type: 'created', actor: 'user' }),
    )).toBe('ok');

    expect(await outcomeOf(() =>
      localBundle.executions.createProposal({
        executionId: localId,
        projectId: PROJECT_ID,
        operations: [],
        idempotencyKey: 'wb:happy',
      }),
    )).toBe('ok');
    expect(await outcomeOf(() =>
      remote.createProposal({
        executionId: remoteId,
        projectId: PROJECT_ID,
        operations: [],
        idempotencyKey: 'wb:happy',
      }),
    )).toBe('ok');

    // 提案直接创建为 applied → 两端都 Validation（既有语义，顺便锁住没被本次改动带偏）
    const { localId: l2, remoteId: r2 } = await seedBoth('parity:happy2');
    const lBad = await outcomeOf(() =>
      localBundle.executions.createProposal({
        executionId: l2,
        projectId: PROJECT_ID,
        operations: [],
        idempotencyKey: 'wb:bad',
        status: 'applied',
      }),
    );
    const rBad = await outcomeOf(() =>
      remote.createProposal({
        executionId: r2,
        projectId: PROJECT_ID,
        operations: [],
        idempotencyKey: 'wb:bad',
        status: 'applied',
      }),
    );
    expect(lBad).toBe(rBad);
    expect(lBad).toBe(ChangxiaErrorCode.Validation);
  });

  /* ------------------- ④ 提案的 attemptId 两端都不过度收紧 ------------------- */

  it('createProposal 的 attemptId 指向不存在的 attempt：两端都放行（DDL 未约束）', async () => {
    // `writeback_proposals.attempt_id` 在 schema.sql 里没有 REFERENCES，也没有读路径 JOIN。
    // 两端都**刻意**不查它 —— 这条把「刻意」钉住：谁单方面加一条存在性检查，这里就红。
    const { localId, remoteId } = await seedBoth('parity:ghost-attempt');
    const lp = await localBundle.executions.createProposal({
      executionId: localId,
      attemptId: 'attempt_does_not_exist',
      projectId: PROJECT_ID,
      operations: [],
      idempotencyKey: 'wb:ghost',
    });
    const rp = await remote.createProposal({
      executionId: remoteId,
      attemptId: 'attempt_does_not_exist',
      projectId: PROJECT_ID,
      operations: [],
      idempotencyKey: 'wb:ghost',
    });
    expect(lp.attemptId).toBe(rp.attemptId);
    expect(lp.attemptId).toBe('attempt_does_not_exist');
  });

  /* ------------------- ④′ 审计补齐：source 与 proposal status ------------------- */

  it('createProposal：status 的接受 / 拒绝集合两端逐值相同（同源缺口）', async () => {
    /**
     * 审计发现（实测确认，修复前）：`createProposal` 的 `status` **两端都没有值域校验**，
     * `status='ghost'` 在本地与远端**都**落库。注意它的形态与 attempt 不同：
     * `updateProposal` 有两条检查，但都是「状态语义」而非「值域」——
     * ghost 值既不等于 applied 也不等于 rejected，两条都不触发。
     */
    const cases: ReadonlyArray<{ label: string; value: unknown }> = [
      ...WRITEBACK_PROPOSAL_STATUSES.map((s) => ({ label: `合法值 ${s}`, value: s })),
      { label: '不存在的值', value: 'ghost' },
      { label: '近似值 done', value: 'done' },
      { label: '大写变体 APPLIED', value: 'APPLIED' },
      { label: '空串', value: '' },
      { label: '数字', value: 3 },
    ];
    for (const [i, c] of cases.entries()) {
      const { localId, remoteId } = await seedBoth(`parity:proposal:${i}`);
      const local = await outcomeOf(() =>
        localBundle.executions.createProposal({
          executionId: localId,
          projectId: PROJECT_ID,
          operations: [],
          idempotencyKey: `wb:${i}`,
          status: c.value as never,
        }),
      );
      const remoteOutcome = await outcomeOf(() =>
        remote.createProposal({
          executionId: remoteId,
          projectId: PROJECT_ID,
          operations: [],
          idempotencyKey: `wb:${i}`,
          status: c.value as never,
        }),
      );
      expect(`${c.label} → local=${local}`).toBe(`${c.label} → local=${remoteOutcome}`);
      // applied / rejected 仍是 Validation（既有 P0 语义），其余合法值放行，非法值 Validation
      const blockByP0 =
        c.value === 'applied' || c.value === 'rejected';
      const shouldAccept = WRITEBACK_PROPOSAL_STATUSES.includes(c.value as never) && !blockByP0;
      expect(`${c.label} → ${local}`).toBe(
        `${c.label} → ${shouldAccept ? 'ok' : 'validation'}`,
      );
    }
  });

  it('createExecution：非法 source 两端同码（修复前本地落库 / 远端 400 的分歧）', async () => {
    /**
     * 审计发现（实测确认，修复前）：`createExecution` 的 `source` **本地侧不校验**，
     * 而远端侧由路由层 `EXECUTION_SOURCES.includes()` 拦住 —— 这是一处**两端分歧**：
     * 同一个 `source='whatever'` 在本地成功落库、在 NAS 上 400。
     * 分歧比「两端一致地不完整」更坏（行为不可预测），故本次一并在本地侧补齐。
     */
    const cases = [...EXECUTION_SOURCES, 'whatever', '', 'PROJECT-TASK'];
    for (const [i, s] of cases.entries()) {
      const local = await outcomeOf(() =>
        localBundle.executions.createExecution({
          projectId: PROJECT_ID,
          source: s as never,
          objective: 'parity',
          idempotencyKey: `parity:src:local:${i}`,
        }),
      );
      const remoteOutcome = await outcomeOf(() =>
        remote.createExecution({
          projectId: PROJECT_ID,
          source: s as never,
          objective: 'parity',
          idempotencyKey: `parity:src:remote:${i}`,
        }),
      );
      expect(`source=${s} → local=${local}`).toBe(`source=${s} → local=${remoteOutcome}`);
      const shouldAccept = EXECUTION_SOURCES.includes(s as never);
      expect(`source=${s} → ${local}`).toBe(
        `source=${s} → ${shouldAccept ? 'ok' : 'validation'}`,
      );
    }
  });

  /* ------------------- ⑤ 适配器层白名单**独立**成立（不经 HTTP）------------------- */
  it('服务端适配器层：绕过 HTTP 直调 createAttempt，非法 status 仍必须被拒', async () => {
    /**
     * ── 这条为什么必须存在（一次真实的变异验证发现）──
     * 最初我把缺口 1 的守卫写成两层（路由层白名单 + 适配器层白名单），
     * 但**撤掉适配器层那层**后，全部 HTTP 用例依然全绿 —— 因为路由层先拦住了，
     * 请求根本到不了适配器。也就是说：适配器层那层在测试上是**不可见的**，形同装饰。
     *
     * 这不代表适配器层没用 —— 它在**路由层之外**仍有价值（本文件上方注释引用的
     * 文件头纪律：「路由层的校验是体验，仓储层的校验才是边界；两处都要有，且以后者为准」）。
     * 但那句话要成立，必须有一条测试**直接打适配器**，否则「以后者为准」是一句空话：
     * 将来任何人删掉适配器层的那段校验，CI 都不会告诉他。
     *
     * 故这里用 `createSqliteBundle` **直接构造**仓储（不经 Fastify、不经 HTTP），
     * 把「边界」这件事测出来。真实可达性证据：`server/routes/agent.routes.ts:171`
     * 也调用 `createSqliteBundle(db, delegate)`，是**第二个** bundle 实例
     * （当前未触达 `bundle.executions`，但正是这种「将来会接进来」的第二入口
     * 让适配器层不能只依赖路由层的白名单）。
     */
    const r = await seedBoth('parity:direct');
    const bundle = createSqliteBundle(db, {
      async inject() {
        throw new Error('本用例刻意不经 HTTP：适配器层必须独立成立');
      },
    });

    const direct = await outcomeOf(() =>
      bundle.executions.createAttempt({
        executionId: r.remoteId,
        status: 'not-a-status' as never,
      }),
    );
    // 直调（无路由层）也必须 Validation —— 这才是「边界在仓储层」的可执行证据
    expect(direct).toBe(ChangxiaErrorCode.Validation);
    expect(await bundle.executions.listAttempts(r.remoteId)).toHaveLength(0);

    // 合法值直调照常成功（确认没把整条路径打死）
    const okAttempt = await bundle.executions.createAttempt({
      executionId: r.remoteId,
      status: 'queued',
    });
    expect(okAttempt.status).toBe('queued');

    // 与本地侧直调同码：两端边界层语义一致
    const localDirect = await outcomeOf(() =>
      localBundle.executions.createAttempt({
        executionId: r.localId,
        status: 'not-a-status' as never,
      }),
    );
    expect(localDirect).toBe(direct);
  });

  it('服务端适配器层：绕过 HTTP 直调 appendEvent / createProposal，孤儿父仍必须 NotFound', async () => {
    // 与上一条同理由：路由层之外的第二入口也必须有同款父存在性检查。
    const bundle = createSqliteBundle(db, {
      async inject() {
        throw new Error('本用例刻意不经 HTTP');
      },
    });
    expect(
      await outcomeOf(() =>
        bundle.executions.appendEvent({
          executionId: 'exec_not_exist',
          seq: 1,
          type: 'created',
          actor: 'user',
        }),
      ),
    ).toBe(ChangxiaErrorCode.NotFound);
    expect(
      await outcomeOf(() =>
        bundle.executions.createProposal({
          executionId: 'exec_not_exist',
          projectId: PROJECT_ID,
          operations: [],
          idempotencyKey: 'wb:direct',
        }),
      ),
    ).toBe(ChangxiaErrorCode.NotFound);
    const ev = db.prepare('SELECT COUNT(*) AS n FROM execution_events').get() as { n: number };
    expect(ev.n).toBe(0);
  });
});
