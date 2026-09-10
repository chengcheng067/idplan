/**
 * BUG-03 回归防线 · `POST /tasks/upsert` 的幂等查找必须是**项目作用域**。
 *
 * ── 为什么这个 spec 必须存在 ──
 * v0.7 阶段C（commit 9f5de5f）把 `external_id` 的唯一性从「全局」收窄为
 * 「`(project_id, external_id)` 复合唯一」，理由见设计规格 §6.1 / O1：
 * 同一份 Agent payload 在不同项目下复用同一套 externalId 是很常见的
 * （如都叫 `stage-1-task-1`）——全局唯一下这种复用**根本插不进去**。
 *
 * 但 server 侧 upsert 的幂等查找没有跟着换轨，仍是：
 *     SELECT * FROM tasks WHERE external_id = ?
 * 于是：A 项目已有 `k`，B 项目再 upsert `k` → **命中 A 的行** → 走
 * `UPDATE tasks SET ... WHERE id = <A 的行 id>` →
 * **把 A 项目的任务内容整体改写成 B 项目的**，且 B 项目该有的行根本没建。
 * 这是**静默的跨项目数据污染**：不报错、不冲突、计数还显示 `updated: 1`
 * 看起来一切正常，只有回到 A 项目才发现任务变了样。
 *
 * ── 本 spec 锁死什么 ──
 *   1. 跨项目同键 upsert → B 新建（created=1），A 的行走**原样不动**（title/status/revision 全不变）；
 *   2. 各项目重复 upsert 自己的同键行 → 命中**自己那条**（不能串到隔壁项目）；
 *   3. 请求行缺 projectId → 明确拒绝（fail-closed），绝不退化成全局查找。
 *
 * 用内存 SQLite + Fastify inject，不起端口、不依赖网络。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';
import { registerTaskRoutes } from '../server/routes/tasks.routes';

type Db = InstanceType<typeof Database>;

/** 建一个内存库 + 注册 project/stage/task 路由（upsert 只需要这三个） */
async function buildServer(): Promise<{ app: ReturnType<typeof Fastify>; db: Db }> {
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
  await app.ready();
  return { app, db };
}

/**
 * 建一个项目 + 一个阶段。
 * tasks.project_id / stage_id 都有外键（foreign_keys=ON），缺父行会 FR 失败，
 * 所以每条任务都必须挂在真实存在的 project + stage 下。
 */
async function seedProject(
  app: ReturnType<typeof Fastify>,
  projectId: string,
  stageId: string,
): Promise<void> {
  const p = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      id: projectId,
      name: `项目 ${projectId}`,
      type: 'dining',
      address: '',
      clientName: '',
      plannedStartAt: '2026-08-01',
      plannedEndAt: '2026-10-01',
    },
  });
  expect(p.statusCode, `建项目 ${projectId} 失败`).toBe(200);

  const s = await app.inject({
    method: 'POST',
    url: '/api/stages/bulk',
    payload: {
      rows: [
        {
          id: stageId,
          projectId,
          orderIndex: 1,
          templateKey: 'indoor.proposal',
          colorIndex: 1,
          name: '提案',
          ratioPercent: 30,
          startAt: '2026-08-01',
          endAt: '2026-08-10',
          status: 'not_started',
          ownerId: null,
          visible: true,
          resourcePath: null,
          revision: 1,
        },
      ],
    },
  });
  expect(s.statusCode, `建阶段 ${stageId} 失败`).toBe(200);
}

/** 一行 upsert 请求体（TaskUpsertRow 形状 + snake 侧所需字段） */
function upsertRow(
  projectId: string,
  stageId: string,
  title: string,
  externalId: string,
  status = 'ready',
): Record<string, unknown> {
  return {
    projectId,
    stageId,
    title,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'agent',
    externalId,
    agentId: null,
    status,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    orderIndex: 1,
  };
}

/**
 * ★ 两个不同项目复用同一个 externalId —— Agent payload 的常态
 * （每个项目都从 `stage-1-task-1` 编起）。
 * 全局唯一年代这种复用是被 DB 拒绝的，v3 换轨后必须能共存。
 */
const SHARED_KEY = 'stage-1-task-1';

describe('BUG-03 · upsert 幂等查找必须是项目作用域', () => {
  let ctx: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    ctx = await buildServer();
    await seedProject(ctx.app, 'pA', 'sA');
    await seedProject(ctx.app, 'pB', 'sB');
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.db.close();
  });

  it('★ 跨项目同键 upsert：B 项目新建自己的行，A 项目的行原样不动（不被改写）', async () => {
    // ① A 项目先写入 SHARED_KEY
    const resA = await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: { rows: [upsertRow('pA', 'sA', 'A 项目原始任务', SHARED_KEY)] },
    });
    expect(resA.statusCode).toBe(200);
    expect(resA.json()).toEqual({ created: 1, updated: 0 });

    const aBefore = ctx.db
      .prepare('SELECT id, title, status, revision FROM tasks WHERE project_id = ? AND external_id = ?')
      .get('pA', SHARED_KEY) as { id: string; title: string; status: string; revision: number };
    expect(aBefore, 'A 项目的行必须已存在').toBeTruthy();

    // ② B 项目用**同一个** externalId upsert（Agent 复用键序）
    const resB = await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: { rows: [upsertRow('pB', 'sB', 'B 项目任务', SHARED_KEY)] },
    });
    expect(resB.statusCode).toBe(200);
    // ★ 核心断言（修复前红）：必须是**新建**。若查找仍是全局作用域，
    //   这里会命中 A 的行 → 返回 { created: 0, updated: 1 }。
    expect(resB.json(), 'B 项目应新建自己的行，而不是「更新」到 A 项目的行上').toEqual({
      created: 1,
      updated: 0,
    });

    // ③ A 项目的任务必须**一个字段都没被碰**（修复前：title 被改成 'B 项目任务'）
    const aAfter = ctx.db
      .prepare('SELECT id, project_id, title, status, revision FROM tasks WHERE id = ?')
      .get(aBefore.id) as {
      id: string;
      project_id: string;
      title: string;
      status: string;
      revision: number;
    };
    expect(aAfter, 'A 项目的行必须还在').toBeTruthy();
    expect(aAfter.project_id, 'A 项目的行不能改挂到别的项目').toBe('pA');
    expect(aAfter.title, '★ A 项目的任务标题被跨项目污染了').toBe('A 项目原始任务');
    expect(aAfter.status, '★ A 项目的任务状态被跨项目污染了').toBe('ready');
    expect(aAfter.revision, 'A 的行未被触碰 → revision 不应被 bump').toBe(aBefore.revision);

    // ④ B 项目确实有了自己独立的一行
    const bRow = ctx.db
      .prepare('SELECT id, project_id, title, status FROM tasks WHERE project_id = ? AND external_id = ?')
      .get('pB', SHARED_KEY) as {
      id: string;
      project_id: string;
      title: string;
      status: string;
    } | undefined;
    expect(bRow, 'B 项目必须存在自己的同键行').toBeTruthy();
    expect(bRow!.id, 'B 的行必须是全新的一行，不是 A 那行').not.toBe(aBefore.id);
    expect(bRow!.project_id).toBe('pB');
    expect(bRow!.title).toBe('B 项目任务');

    // ⑤ 全库恰好 2 行（各项目一行），没有多余/丢失
    expect((ctx.db.prepare('SELECT COUNT(*) c FROM tasks').get() as { c: number }).c).toBe(2);
  });

  it('★ 各项目重复 upsert 自己的同键行 → 命中自己那条，互不串项目', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: { rows: [upsertRow('pA', 'sA', 'A 项目原始任务', SHARED_KEY)] },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: { rows: [upsertRow('pB', 'sB', 'B 项目原始任务', SHARED_KEY)] },
    });

    const ids = ctx.db
      .prepare('SELECT id, project_id FROM tasks ORDER BY project_id')
      .all() as Array<{ id: string; project_id: string }>;
    expect(ids).toHaveLength(2);
    const aId = ids.find((r) => r.project_id === 'pA')!.id;
    const bId = ids.find((r) => r.project_id === 'pB')!.id;

    // A 重发自己的行 → 必须命中 A 自己那条（updated=1 / created=0）
    const reA = await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: { rows: [upsertRow('pA', 'sA', 'A 项目任务（第二次）', SHARED_KEY)] },
    });
    expect(reA.json(), 'A 重发必须命中 A 自己那条').toEqual({ created: 0, updated: 1 });

    // B 重发自己的行 → 必须命中 B 自己那条
    const reB = await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: { rows: [upsertRow('pB', 'sB', 'B 项目任务（第二次）', SHARED_KEY)] },
    });
    expect(reB.json(), 'B 重发必须命中 B 自己那条').toEqual({ created: 0, updated: 1 });

    // 两行 id 全程不变（各自更新各自的行，没有谁被新建 / 谁被顶掉）
    const after = ctx.db
      .prepare('SELECT id, project_id, title, revision FROM tasks ORDER BY project_id')
      .all() as Array<{ id: string; project_id: string; title: string; revision: number }>;
    expect(after).toHaveLength(2);
    expect(after.find((r) => r.project_id === 'pA')!.id).toBe(aId);
    expect(after.find((r) => r.project_id === 'pB')!.id).toBe(bId);
    // 各自标题只被自己的第二次请求改写
    expect(after.find((r) => r.project_id === 'pA')!.title).toBe('A 项目任务（第二次）');
    expect(after.find((r) => r.project_id === 'pB')!.title).toBe('B 项目任务（第二次）');
    // 各被 bump 一次（1 → 2），证明命中的是既有行而非新建
    expect(after.find((r) => r.project_id === 'pA')!.revision).toBe(2);
    expect(after.find((r) => r.project_id === 'pB')!.revision).toBe(2);
  });

  it('★ 一次请求同时给两项目发同键行 → 两行各归其位（批内也不能互相串）', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: {
        rows: [
          upsertRow('pA', 'sA', 'A 批量任务', SHARED_KEY),
          upsertRow('pB', 'sB', 'B 批量任务', SHARED_KEY),
        ],
      },
    });
    // 修复前：第一条新建后，第二条会命中第一条刚建的行 → { created: 1, updated: 1 }
    expect(res.json()).toEqual({ created: 2, updated: 0 });

    const rows = ctx.db
      .prepare('SELECT project_id, title FROM tasks ORDER BY project_id')
      .all() as Array<{ project_id: string; title: string }>;
    expect(rows).toEqual([
      { project_id: 'pA', title: 'A 批量任务' },
      { project_id: 'pB', title: 'B 批量任务' },
    ]);
  });

  it('缺 projectId 的 upsert 行 → 400 拒绝（fail-closed，绝不退化为全局查找）', async () => {
    const bad = upsertRow('pA', 'sA', '缺项目任务', SHARED_KEY);
    delete bad.projectId;

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: { rows: [bad] },
    });
    expect(res.statusCode, '缺 projectId 必须显式拒绝，不能猜').toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('validation');
    // 拒绝后全库零写入：不留半套数据（整个请求在事务内，且校验先于事务）
    expect((ctx.db.prepare('SELECT COUNT(*) c FROM tasks').get() as { c: number }).c).toBe(0);
  });
});
