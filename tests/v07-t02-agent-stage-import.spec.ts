/**
 * v0.7 · T02 · A 线（写入通道与自动建阶段）验收 spec。
 *
 * ── 覆盖 ──
 * 验收：§8-V1-13（服务端侧）/ V1-17 / V1-18 / V1-19 / V1-20 / V1-21
 * 坑清单：§4.8 的 C1 / C2 / C3 / C6 / C7 / C8 / C9 / C13 / C14（+ C15 / C16 的原位回归）
 *
 * ── 为什么全部走 `app.inject` 端到端（而不只测纯函数）──
 * 本任务的缺口几乎全是**集成缺口**：`resolve()` 的判序、创建时机、行的 `stageId` 重写、
 * 响应体的键集合。这些在单测纯函数时**全都正确**，只有真发一次 HTTP 才看得见 ——
 * 例如 C1（漏重写行 stageId）会让任务插到 `stage_id=''`，而 `resolveStageByName` 自己
 * 一千个用例全绿。故本 spec 的主体是 HTTP 层。
 *
 * ── 判别力（每个 it 都对应一条「改坏了就红」的断言）──
 * 注释里逐条标了「变异验证」：把实现改成某种具体错误写法，本用例应转红。
 * 变异记录见提交说明与任务报告。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';
import { registerTaskRoutes } from '../server/routes/tasks.routes';
import { registerMemberRoutes } from '../server/routes/members.routes';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { registerAgentRoutes } from '../server/routes/agent.routes';
import {
  AGENT_API_TOKEN_ENV,
  AGENT_TOKEN_ENV,
  requireAgentToken,
} from '../server/lib/agent-auth';
import { normalizeStageName, resolveStageByName } from '../src/core/lib/task-no';
import { buildCreatedStage, planImpact } from '../src/core/agent/stage-resolve';
import { StageStatus } from '../src/core/types/enums';
import type { Project, Stage } from '../src/core/types/entities';

type Db = InstanceType<typeof Database>;
type App = ReturnType<typeof Fastify>;

const TOKEN = 'v07-t02-agent-api-token-0123456789';
const BACKUP_TOKEN = 'v07-t02-backup-token-9876543210';
const PROJECT_ID = 'p1';
const STAGE_ID = 's1';

/** 契约样例里的三个规范键集合（R1 四键恒定 / R5 impact 白名单） */
const STAGE_KEYS_WITH_IMPACT = ['mode', 'id', 'name', 'orderIndex', 'impact'];
const STAGE_KEYS_PLAIN = ['mode', 'id', 'name', 'orderIndex'];

let savedAgentToken: string | undefined;
let savedBackupToken: string | undefined;
let db: Db;

async function buildServer(): Promise<App> {
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
  registerAgentRoutes(app, db);
  await app.ready();
  return app;
}

beforeEach(() => {
  savedAgentToken = process.env[AGENT_API_TOKEN_ENV];
  savedBackupToken = process.env[AGENT_TOKEN_ENV];
  process.env[AGENT_API_TOKEN_ENV] = TOKEN;
  process.env[AGENT_TOKEN_ENV] = BACKUP_TOKEN;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createDb(db);
});

afterEach(() => {
  if (savedAgentToken === undefined) delete process.env[AGENT_API_TOKEN_ENV];
  else process.env[AGENT_API_TOKEN_ENV] = savedAgentToken;
  if (savedBackupToken === undefined) delete process.env[AGENT_TOKEN_ENV];
  else process.env[AGENT_TOKEN_ENV] = savedBackupToken;
  db.close();
});

/* ------------------------------------ 夹具 ------------------------------------ */

interface StageFixture {
  id: string;
  name: string;
  orderIndex: number;
  visible?: boolean;
  status?: string;
}

async function createProject(app: App, id = PROJECT_ID, plannedEnd = '2026-12-31'): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      id,
      name: `项目 ${id}`,
      type: 'dining',
      address: '',
      clientName: '',
      plannedStartAt: '2026-01-01',
      plannedEndAt: plannedEnd,
    },
  });
  expect(res.statusCode, `建项目失败：${res.body}`).toBe(200);
}

async function createStages(app: App, stages: StageFixture[]): Promise<void> {
  if (stages.length === 0) return; // 零阶段是 V1-17 / V1-20 的关键前置
  const res = await app.inject({
    method: 'POST',
    url: '/api/stages/bulk',
    payload: {
      rows: stages.map((s) => ({
        id: s.id,
        projectId: PROJECT_ID,
        orderIndex: s.orderIndex,
        templateKey: null,
        colorIndex: 1,
        name: s.name,
        ratioPercent: 0,
        startAt: '2026-01-01',
        endAt: '2026-03-01',
        status: s.status ?? StageStatus.NotStarted,
        ownerId: null,
        visible: s.visible !== false,
        resourcePath: null,
        revision: 1,
      })),
    },
  });
  expect(res.statusCode, `建阶段失败：${res.body}`).toBe(200);
}

/** 一个最小的合法 payload（1 条任务） */
function makePayload(externalId = 'workbuddy:sync-2026-09-11', title = '写提案'): Record<string, unknown> {
  return {
    schema: 'idplan-agent-payload/v1',
    projectId: PROJECT_ID,
    stageId: null,
    producedBy: { actorKind: 'agent', agentKind: 'workbuddy', agentName: 'WorkBuddy', runId: 'run-1' },
    tasks: [
      {
        externalId,
        title,
        description: null,
        status: 'draft',
        assigneeAgentKind: null,
        assigneeHuman: null,
        dependsOnExternal: [],
        startAt: null,
        dueDate: null,
        artifacts: [],
      },
    ],
  };
}

interface ImportRes {
  created: number;
  updated: number;
  rejected: Array<{ externalId: string; code: string; reason: string }>;
  stage: { mode: string; id: string | null; name: string; orderIndex: number; impact?: unknown };
}

async function doImport(
  app: App,
  payload: Record<string, unknown>,
  query = '',
): Promise<{ statusCode: number; body: ImportRes }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/agent/import${query}`,
    headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
    payload,
  });
  return { statusCode: res.statusCode, body: res.json() as ImportRes };
}

/** 读该项目全部阶段行（含隐藏），按 orderIndex 排序 */
async function listStages(app: App): Promise<Array<{ id: string; name: string; orderIndex: number }>> {
  const res = await app.inject({ method: 'GET', url: `/api/projects/${PROJECT_ID}/stages` });
  expect(res.statusCode).toBe(200);
  return res.json() as Array<{ id: string; name: string; orderIndex: number }>;
}

/** 读该项目全部任务行（走既有端点，形状即前端所见） */
async function listTasks(
  app: App,
): Promise<Array<{ id: string; stageId: string; externalId: string | null; taskNo: number | null }>> {
  const res = await app.inject({ method: 'GET', url: `/api/tasks?projectId=${PROJECT_ID}` });
  expect(res.statusCode).toBe(200);
  return res.json() as Array<{ id: string; stageId: string; externalId: string | null; taskNo: number | null }>;
}

/* ======================================================================================
 * 一、V1-17 · 自动落进「Agent 排期」（该阶段不存在时被创建）
 * ==================================================================================== */

describe('V1-17 ★ 零阶段项目 + ?stageName=Agent 排期 → 自动建阶段且任务全落进去', () => {
  it('实写：stage.mode=created、id 非空、name=Agent 排期，且每条任务的 stageId 都等于 stage.id（C1）', async () => {
    const app = await buildServer();
    await createProject(app);
    // 零阶段（V1-17 的核心前置：没有可落点，才逼出自动建）

    const { statusCode, body } = await doImport(
      app,
      makePayload(),
      `?stageName=${encodeURIComponent('Agent 排期')}`,
    );

    expect(statusCode, JSON.stringify(body)).toBe(200);
    expect(body.created).toBe(1);
    expect(body.updated).toBe(0);
    expect(body.rejected).toEqual([]);

    // ── R4：created → id 非空；R5：impact 必出现（C14 的 created 半边）──
    expect(body.stage.mode).toBe('created');
    expect(body.stage.id).toBeTruthy();
    expect(body.stage.name).toBe('Agent 排期');
    expect(body.stage.orderIndex).toBe(1); // 零阶段 → 下限锁 1（schema CHECK order_index>=1）
    // ★ C13 写法：断言**键集合**（不是 toBeUndefined —— 后者对 null 也通过）
    expect(Object.keys(body.stage).sort()).toEqual([...STAGE_KEYS_WITH_IMPACT].sort());

    // ── C1 ★ 关键断言：行落到了新阶段，**绝不是** stage_id='' ──
    const tasks = await listTasks(app);
    expect(tasks).toHaveLength(1);
    expect(tasks.every((t) => t.stageId === body.stage.id)).toBe(true);
    expect(tasks.every((t) => t.stageId !== '')).toBe(true);

    // 阶段确实真的落库了（不是只在回执里声称建了）
    const stages = await listStages(app);
    expect(stages).toHaveLength(1);
    expect(stages[0]!.id).toBe(body.stage.id);
    expect(stages[0]!.name).toBe('Agent 排期');
  });

  it('显式声明**只**建一个阶段（不是每行建一个）', async () => {
    const app = await buildServer();
    await createProject(app);
    const payload = makePayload();
    (payload.tasks as Array<Record<string, unknown>>).push({
      externalId: 'workbuddy:sync-2026-09-11-b',
      title: '第二件',
      description: null,
      status: 'draft',
      assigneeAgentKind: null,
      assigneeHuman: null,
      dependsOnExternal: [],
      startAt: null,
      dueDate: null,
      artifacts: [],
    });

    const { body } = await doImport(app, payload, '?stageName=Agent%20%E6%8E%92%E6%9C%9F');
    expect(body.created).toBe(2);
    expect(await listStages(app)).toHaveLength(1); // ★ 两行任务只建 1 个阶段（§4.6 步骤 4）
  });
});

/* ======================================================================================
 * 二、V1-18 · 连续 3 次同步不会变成 3 个阶段
 * ==================================================================================== */

describe('V1-18 ★ 连续 3 次同步同一份带阶段声明的排期：阶段不增长、任务不增长', () => {
  it('第 1 次 created、第 2/3 次 existing 且 stage.id 相同，阶段增量恒为 1', async () => {
    const app = await buildServer();
    await createProject(app);
    const payload = makePayload();
    const query = '?stageName=Agent%20%E6%8E%92%E6%9C%9F';

    const before = await listStages(app);
    expect(before).toHaveLength(0);

    const r1 = await doImport(app, payload, query);
    const r2 = await doImport(app, payload, query);
    const r3 = await doImport(app, payload, query);

    // ① 阶段数增量 === 1（★ 这条就是 C6/N3 要防的「每天建一个新阶段」）
    const after = await listStages(app);
    expect(after.length - before.length).toBe(1);

    // ② 第 2/3 次命中既有阶段（不建），且 id 与第 1 次相同
    expect(r1.body.stage.mode).toBe('created');
    expect(r2.body.stage.mode).toBe('existing');
    expect(r3.body.stage.mode).toBe('existing');
    expect(r2.body.stage.id).toBe(r1.body.stage.id);
    expect(r3.body.stage.id).toBe(r1.body.stage.id);

    // ③ 第 2/3 次全 updated、created === 0
    expect(r2.body.created).toBe(0);
    expect(r2.body.updated).toBe(1);
    expect(r3.body.created).toBe(0);
    expect(r3.body.updated).toBe(1);

    // ④ 任务数不增长
    expect(await listTasks(app)).toHaveLength(1);
  });

  it('C6 ★ 全角/尾标点变体被判为同名：`Agent 排期。` 与 `Agent 排期` 复用同一阶段', async () => {
    const app = await buildServer();
    await createProject(app);

    const r1 = await doImport(app, makePayload(), '?stageName=Agent%20%E6%8E%92%E6%9C%9F');
    expect(r1.body.stage.mode).toBe('created');

    // 尾标点变体（这是「每次同步建一个新阶段」最真实的触发方式）
    const r2 = await doImport(app, makePayload(), `?createStageIfMissing=${encodeURIComponent('Agent 排期。')}`);
    expect(r2.body.stage.mode).toBe('existing'); // ★ 若归一漏了去尾标点 → 'created' → 红
    expect(r2.body.stage.id).toBe(r1.body.stage.id);
    expect(await listStages(app)).toHaveLength(1);
  });

  it('C6 ★ 全角空格 / 全角字母变体同样命中（全角→半角 + 折叠空白）', async () => {
    const app = await buildServer();
    await createProject(app);
    const r1 = await doImport(app, makePayload(), '?stageName=Agent%20%E6%8E%92%E6%9C%9F');
    expect(r1.body.stage.mode).toBe('created');
    // 全角空格（U+3000）+ 连续空白
    const r2 = await doImport(
      app,
      makePayload(),
      `?stageName=${encodeURIComponent('Agent\u3000\u3000排期')}`,
    );
    expect(r2.body.stage.mode).toBe('existing'); // ★ 漏 \u3000 替换 → 红
    expect(await listStages(app)).toHaveLength(1);
  });
});

/* ======================================================================================
 * 三、V1-19 · 预览可见「将新建阶段」且取消不留空阶段
 * ==================================================================================== */

describe('V1-19 ★ dryRun 预览：mode=planned、id=null、impact 可见，且库内零写入', () => {
  it('planned + id===null + impact.percentAfter < percentBefore（C14 的 planned 半边）', async () => {
    const app = await buildServer();
    await createProject(app);
    // 两个已完成阶段 → 完成度 100% → 新建一个未开始阶段 → 掉到 66.67% → 取整 67
    await createStages(app, [
      { id: 's1', name: '提案', orderIndex: 1, status: StageStatus.Completed },
      { id: 's2', name: '施工图', orderIndex: 2, status: StageStatus.Completed },
    ]);

    const stagesBefore = await listStages(app);
    const tasksBefore = await listTasks(app);

    const { statusCode, body } = await doImport(
      app,
      makePayload(),
      `?dryRun=1&stageName=${encodeURIComponent('Agent 排期')}`,
    );

    expect(statusCode, JSON.stringify(body)).toBe(200);
    expect(body.stage.mode).toBe('planned');
    // ★ C14 硬要求：planned → id === null（阶段尚未落库）
    expect(body.stage.id).toBeNull();
    expect(body.stage.name).toBe('Agent 排期');
    expect(body.stage.orderIndex).toBe(3);
    // ★ C13 写法：planned 必须**有** impact → 键集合含 impact
    expect(Object.keys(body.stage).sort()).toEqual([...STAGE_KEYS_WITH_IMPACT].sort());

    const impact = body.stage.impact as {
      percentBefore: number;
      percentAfter: number;
      statusBefore: string;
      statusAfter: string;
    };
    expect(impact.percentBefore).toBe(100);
    expect(impact.percentAfter).toBe(67); // ★ 这条同时证明「完成度稀释」被算出来了
    expect(impact.percentAfter).toBeLessThan(impact.percentBefore);

    // ── C3 ★ 断言零写入：阶段数与任务数**完全不变** ──
    expect(await listStages(app)).toHaveLength(stagesBefore.length);
    expect(await listTasks(app)).toHaveLength(tasksBefore.length);
    expect(await listTasks(app)).toHaveLength(0);
  });

  it('planned 的 id 为 null 而**不是**空串（R4 四态表的精确口径）', async () => {
    const app = await buildServer();
    await createProject(app);
    const { body } = await doImport(app, makePayload(), '?dryRun=1&stageName=X');
    expect(body.stage.id).toBeNull();
    expect(body.stage.id).not.toBe('');
    // 严格判等 null（`toBe(null)` 不放过 undefined / ''）
    expect(body.stage.id === null).toBe(true);
  });
});

/* ======================================================================================
 * 四、V1-20 · 不声明阶段时行为与今天完全一样（铁律：绝不建）
 * ==================================================================================== */

describe('V1-20 ★ 项目零阶段 + 未声明 → stage_limit、零写入、stage.mode=none（样本 C / C15）', () => {
  it('N1 + N2：mode=none ⇒ created===0 && updated===0 && rejected 全为 stage_limit', async () => {
    const app = await buildServer();
    await createProject(app);

    const { statusCode, body } = await doImport(app, makePayload());

    expect(statusCode).toBe(200); // ★ C11：仍是 200 + 逐条 rejected，不是 400
    // ★ N1
    expect(body.stage.mode).toBe('none');
    expect(body.created).toBe(0);
    expect(body.updated).toBe(0);
    expect(body.rejected.length).toBeGreaterThan(0);
    // ★ N2
    expect(body.rejected.every((r) => r.code === 'stage_limit')).toBe(true);
  });

  it('N3 ★ stage 恰好四键（不得出现 impact）—— 用键集合断言，不用 toBeUndefined', async () => {
    const app = await buildServer();
    await createProject(app);
    const { body } = await doImport(app, makePayload());

    // ★ 必须 `toEqual` 键集合：`expect(body.stage.impact).toBeUndefined()` 对
    //   `"impact": null` / `{}` 都会通过，抓不到 C13/C15 的错（这正是文档点名要求的写法）
    expect(Object.keys(body.stage)).toEqual(STAGE_KEYS_PLAIN);
  });

  it('N3 ★ none 的 id/name/orderIndex 哨兵值（null / "" / -1）', async () => {
    const app = await buildServer();
    await createProject(app);
    const { body } = await doImport(app, makePayload());
    expect(body.stage.id).toBeNull();
    expect(body.stage.name).toBe('');
    expect(body.stage.orderIndex).toBe(-1);
  });

  it('铁律：阶段数仍为 0 —— 绝不偷偷建（这是自动建阶段最危险的失效方式）', async () => {
    const app = await buildServer();
    await createProject(app);
    await doImport(app, makePayload());
    expect(await listStages(app)).toHaveLength(0); // ★ 若误建 → 红
  });
});

/* ======================================================================================
 * 五、V1-21 · 全完成项目 + 声明新阶段 → 预览告知「回到进行中」
 * ==================================================================================== */

describe('V1-21 ★ 全 completed 项目 + 声明新名 dryRun → statusBefore=completed、statusAfter≠completed', () => {
  it('impact 两态如实产出（进度回退必须可见）', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [
      { id: 's1', name: '提案', orderIndex: 1, status: StageStatus.Completed },
      { id: 's2', name: '施工图', orderIndex: 2, status: StageStatus.Completed },
    ]);

    const { body } = await doImport(app, makePayload(), '?dryRun=1&stageName=%E6%96%B0%E9%98%B6%E6%AE%B5');
    const impact = body.stage.impact as { statusBefore: string; statusAfter: string };

    expect(body.stage.mode).toBe('planned');
    expect(impact.statusBefore).toBe('completed');
    // ★ 断言「不再是 completed」而不是某个具体值：in_progress / overdue 都合法，
    //   取决于当日与项目基线的关系，写死具体值会让 spec 随日历变红（假红）
    expect(impact.statusAfter).not.toBe('completed');
  });

  it('反例：项目本就没全完成时 statusBefore 不为 completed（防止恒真断言）', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [
      { id: 's1', name: '提案', orderIndex: 1, status: StageStatus.Completed },
      { id: 's2', name: '施工图', orderIndex: 2, status: StageStatus.NotStarted },
    ]);
    const { body } = await doImport(app, makePayload(), '?dryRun=1&stageName=X');
    const impact = body.stage.impact as { statusBefore: string };
    // 若实现里 statusBefore 被写成常量 'completed'（恒真），本条转红
    expect(impact.statusBefore).not.toBe('completed');
  });
});

/* ======================================================================================
 * 六、C2 · 按名选点（只做「缺则建」会让显式声明被静默忽略）
 * ====================================================================================== */

describe('C2 ★ 项目已有其它阶段时，显式声明的名字必须被采纳（不是落到 orderIndex 最大者）', () => {
  it('已有 3 个阶段（最大 orderIndex=9）+ 声明「Agent 排期」→ 建到 orderIndex=10，任务落进它', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [
      { id: 's1', name: '提案', orderIndex: 1 },
      { id: 's2', name: '施工图', orderIndex: 5 },
      { id: 's3', name: '竣工', orderIndex: 9 },
    ]);

    const { body } = await doImport(app, makePayload(), '?stageName=Agent%20%E6%8E%92%E6%9C%9F');

    // ★ 若只做「缺则建」而不做「按名选点」→ 任务会落到 orderIndex 最大的『竣工』（s3）
    expect(body.stage.mode).toBe('created');
    expect(body.stage.name).toBe('Agent 排期');
    expect(body.stage.orderIndex).toBe(10); // max(1,5,9) + 1
    expect(body.stage.id).not.toBe('s3');

    const tasks = await listTasks(app);
    expect(tasks[0]!.stageId).toBe(body.stage.id);
    expect(tasks[0]!.stageId).not.toBe('s3'); // ★ C2 的核心断言
  });

  it('已有**同名**阶段时复用它（createStageIfMissing 的另一半语义，C12）', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [{ id: 's1', name: '提案', orderIndex: 1 }]);
    await createStages(app, [{ id: 'sx', name: 'Agent 排期', orderIndex: 4 }]);

    const { body } = await doImport(
      app,
      makePayload(),
      `?createStageIfMissing=${encodeURIComponent('Agent 排期')}`,
    );

    // 「命中则复用」——若别名被做成「只在解析失败时才建」，这里就会新建第二个阶段
    expect(body.stage.mode).toBe('existing');
    expect(body.stage.id).toBe('sx');
    expect(await listStages(app)).toHaveLength(2); // 没有变 3 个
  });

  it('同名多命中时取 orderIndex 最小者（稳定可解释）', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [
      { id: 'sy', name: 'Agent 排期', orderIndex: 7 },
      { id: 'sx', name: 'Agent 排期', orderIndex: 3 },
    ]);
    const { body } = await doImport(app, makePayload(), '?stageName=Agent%20%E6%8E%92%E6%9C%9F');
    expect(body.stage.mode).toBe('existing');
    expect(body.stage.id).toBe('sx'); // orderIndex 最小者
  });
});

/* ======================================================================================
 * 七、C4 / C5 · orderIndex 必须含隐藏阶段取 max
 * ====================================================================================== */

describe('C4/C5 ★ orderIndex = max(全部阶段，含 visible=false) + 1', () => {
  it('隐藏阶段占位：可见阶段只到 2，但隐藏阶段在 8 → 新阶段必须是 9', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [
      { id: 's1', name: '提案', orderIndex: 1 },
      { id: 's2', name: '施工图', orderIndex: 2 },
      { id: 's8', name: '已隐藏的旧批次', orderIndex: 8, visible: false },
    ]);

    const { body } = await doImport(app, makePayload(), '?stageName=Agent%20%E6%8E%92%E6%9C%9F');

    // ★ 只按可见取 max → 3（与隐藏阶段 8 撞号）；含隐藏取 max → 9
    expect(body.stage.orderIndex).toBe(9);
  });

  it('隐藏阶段**不**参与同名命中（落点不能是黑洞）', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [
      { id: 'sh', name: 'Agent 排期', orderIndex: 1, visible: false },
    ]);
    // 只有隐藏的同名阶段 → 不算命中，应新建（否则任务落进看不见的批次）
    const { body } = await doImport(app, makePayload(), '?stageName=Agent%20%E6%8E%92%E6%9C%9F');
    expect(body.stage.mode).toBe('created');
    expect(body.stage.id).not.toBe('sh');
  });
});

/* ======================================================================================
 * 八、C7 · stageName 空值必须 400 invalid_field，绝不静默降级
 * ====================================================================================== */

describe('C7 ★ `stageName` 出现但空/仅空白 → 400 invalid_field（不静默当「未声明」）', () => {
  it('空串 → 400 invalid_field，且**零写入**（阶段与任务都不动）', async () => {
    const app = await buildServer();
    await createProject(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/import?stageName=',
      headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
      payload: makePayload(),
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invalid_field');
    // ★ 若被静默当作「未声明」→ 会走 stage_limit 分支返回 200 → 红
    expect(await listStages(app)).toHaveLength(0);
    expect(await listTasks(app)).toHaveLength(0);
  });

  it('仅空白（空格）→ 400 invalid_field', async () => {
    const app = await buildServer();
    await createProject(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/import?stageName=%20%20%20',
      headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
      payload: makePayload(),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invalid_field');
  });

  it('同义别名 createStageIfMissing 空值同样 400', async () => {
    const app = await buildServer();
    await createProject(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/import?createStageIfMissing=',
      headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
      payload: makePayload(),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invalid_field');
  });

  it('**完全不传** stageName 时正常走既有行为（400 不得误伤缺省路径）', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [{ id: 's1', name: '提案', orderIndex: 1 }]);
    const { statusCode, body } = await doImport(app, makePayload());
    expect(statusCode).toBe(200);
    expect(body.stage.mode).toBe('existing'); // 缺省 → 落最后一个可见阶段（v0.6 行为）
    expect(body.stage.id).toBe('s1');
  });
});

/* ======================================================================================
 * 九、互斥：stageId 与 stageName 同传 → 400 invalid_field
 * ====================================================================================== */

describe('★ 落点名与 stageId 互斥（§4.2 决策树第一问 / §4.5 失败矩阵）', () => {
  it('query ?stageId + ?stageName 同传 → 400 invalid_field', async () => {
    const app = await buildServer();
    await createProject(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/agent/import?stageId=s1&stageName=${encodeURIComponent('Agent 排期')}`,
      headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
      payload: makePayload(),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invalid_field');
    expect(await listStages(app)).toHaveLength(0);
  });

  it('body.stageId + query ?stageName 同传 → 400 invalid_field（语义重叠不猜）', async () => {
    const app = await buildServer();
    await createProject(app);
    const payload = makePayload();
    payload.stageId = 's1';
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/import?stageName=X',
      headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invalid_field');
  });

  it('stageName 与别名同传且**值相同** → 接受（同义别名共用分支）', async () => {
    const app = await buildServer();
    await createProject(app);
    const r = await doImport(
      app,
      makePayload(),
      '?stageName=Agent%20%E6%8E%92%E6%9C%9F&createStageIfMissing=Agent%20%E6%8E%92%E6%9C%9F',
    );
    expect(r.statusCode).toBe(200);
    expect(r.body.stage.mode).toBe('created');
  });

  it('stageName 与别名同传但**值不同** → 400 invalid_field', async () => {
    const app = await buildServer();
    await createProject(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/import?stageName=A&createStageIfMissing=B',
      headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
      payload: makePayload(),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invalid_field');
  });
});

/* ======================================================================================
 * 十、C3 强化 · 全拒场景**不得**创建阶段（创建时机 = §4.6）
 * ====================================================================================== */

describe('C3/§4.6 ★ 整批被拒时绝不创建阶段（库内零写入铁律）', () => {
  it('依赖成环 → 整批 cycle 拒绝，阶段仍为 0 个（否则留下一个永远不用的空阶段）', async () => {
    const app = await buildServer();
    await createProject(app);
    const payload = makePayload();
    payload.tasks = [
      {
        externalId: 'a',
        title: 'A',
        description: null,
        status: 'draft',
        assigneeAgentKind: null,
        assigneeHuman: null,
        dependsOnExternal: ['b'], // a → b → a 成环
        startAt: null,
        dueDate: null,
        artifacts: [],
      },
      {
        externalId: 'b',
        title: 'B',
        description: null,
        status: 'draft',
        assigneeAgentKind: null,
        assigneeHuman: null,
        dependsOnExternal: ['a'],
        startAt: null,
        dueDate: null,
        artifacts: [],
      },
    ];

    const { body } = await doImport(app, payload, '?stageName=Agent%20%E6%8E%92%E6%9C%9F');

    expect(body.created).toBe(0);
    expect(body.updated).toBe(0);
    expect(body.rejected.every((r) => r.code === 'cycle')).toBe(true);
    // ★ 核心：阶段一个都没建（若在 resolve() 内建阶段 → 这里会是 1 → 红）
    expect(await listStages(app)).toHaveLength(0);
    expect(await listTasks(app)).toHaveLength(0);
  });

  it('全部 dep_unresolved → rows 为空 → 同样不建阶段', async () => {
    const app = await buildServer();
    await createProject(app);
    const payload = makePayload();
    payload.tasks = [
      {
        externalId: 'a',
        title: 'A',
        description: null,
        status: 'draft',
        assigneeAgentKind: null,
        assigneeHuman: null,
        dependsOnExternal: ['不存在的键'],
        startAt: null,
        dueDate: null,
        artifacts: [],
      },
    ];

    const { body } = await doImport(app, payload, '?stageName=Agent%20%E6%8E%92%E6%9C%9F');
    expect(body.rejected[0]!.code).toBe('dep_unresolved');
    expect(await listStages(app)).toHaveLength(0); // ★ 不得留下空阶段
  });
});

/* ======================================================================================
 * 十一、C13 · existing 与 none 的 stage **不得**带 impact 键
 * ==================================================================================== */

describe('C13 ★ impact 键的出现规则（R2/R3/R5 正向白名单）', () => {
  it('existing（命中既有阶段）→ 键集合恰好四键，**无** impact（样例 A）', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [{ id: 's1', name: '提案', orderIndex: 1 }]);

    const { body } = await doImport(app, makePayload());
    expect(body.stage.mode).toBe('existing');
    // ★ 必须断键集合：`expect(body.stage.impact).toBeUndefined()` **对 null 也通过**，
    //   抓不到 C13（"impact": null → 两种形状 → 老 Skill 解析崩）
    expect(Object.keys(body.stage)).toEqual(STAGE_KEYS_PLAIN);
    expect(Object.keys(body.stage)).not.toContain('impact');
    // 且序列化后的**原文**里不得出现 impact 字样（连 `"impact":null` 都不允许）
    expect(JSON.stringify(body.stage)).not.toContain('impact');
  });

  it('existing（按名命中复用）→ 同样无 impact 键', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [{ id: 'sx', name: 'Agent 排期', orderIndex: 1 }]);
    const { body } = await doImport(app, makePayload(), '?stageName=Agent%20%E6%8E%92%E6%9C%9F');
    expect(body.stage.mode).toBe('existing');
    expect(Object.keys(body.stage)).toEqual(STAGE_KEYS_PLAIN);
  });

  /**
   * C16 ★ 全局 sitemap：四态各自的 impact 出现与否（**正向白名单**，非 `!== existing`）。
   *
   * ★ 用 `it.each`（而不是在**一个** `it` 里 `for` 循环）：`beforeEach` 是**每个 `it`**
   *   各跑一次，单个 `it` 内的循环会共用同一个 `:memory:` 库——第二次 `createProject('p1')`
   *   就撞 `SQLITE_CONSTRAINT_PRIMARYKEY`（这不是实现缺陷，是夹具自身的错）。
   *   拆成 4 个 `it` 后每个用例都有干净的库，失败信息也直接指到具体那一态。
   */
  it.each([
    { label: 'existing', query: '', stages: [{ id: 's1', name: '提案', orderIndex: 1 }], expectImpact: false, mode: 'existing' },
    { label: 'none', query: '', stages: [], expectImpact: false, mode: 'none' },
    { label: 'planned', query: '?dryRun=1&stageName=X', stages: [], expectImpact: true, mode: 'planned' },
    { label: 'created', query: '?stageName=X', stages: [], expectImpact: true, mode: 'created' },
  ] as Array<{ label: string; query: string; stages: StageFixture[]; expectImpact: boolean; mode: string }>)(
    'C16 ★ 四态 sitemap · $label：impact 键出现与否',
    async (c) => {
      const app = await buildServer();
      await createProject(app);
      await createStages(app, c.stages);
      const { body } = await doImport(app, makePayload(), c.query);
      expect(body.stage.mode, `mode @ ${c.label}`).toBe(c.mode);
      const keys = Object.keys(body.stage);
      if (c.expectImpact) {
        expect(keys.sort(), `应含 impact @ ${c.label}`).toEqual([...STAGE_KEYS_WITH_IMPACT].sort());
      } else {
        // ★ 若把判据写成 `mode !== 'existing'`，则 'none' 会被误判为「有 impact」→ 红
        expect(keys, `不应含 impact @ ${c.label}`).toEqual(STAGE_KEYS_PLAIN);
      }
    },
  );
});

/* ======================================================================================
 * 十二、C9 · 自动建阶段**不写** StageLog（延期档案 append-only 不得污染）
 * ====================================================================================== */

describe('C9 ★ 自动建阶段不得写变更流水（新建不是「流转/延期」事件）', () => {
  it('建阶段后该项目的 stage_logs 为 0 条', async () => {
    const app = await buildServer();
    await createProject(app);
    await doImport(app, makePayload(), '?stageName=Agent%20%E6%8E%92%E6%9C%9F');

    const stages = await listStages(app);
    expect(stages).toHaveLength(1);
    // ★ 若顺手写了一条 StageLog → 红（append-only 表不可清，污染真实延期档案）
    for (const s of stages) {
      const res = await app.inject({ method: 'GET', url: `/api/stages/${s.id}/logs` });
      expect(res.json()).toEqual([]);
    }
    const projectLogs = await app.inject({ method: 'GET', url: `/api/projects/${PROJECT_ID}/logs` });
    expect(projectLogs.json()).toEqual([]);
  });
});

/* ======================================================================================
 * 十三、C8 · 写方法用 `.immediate()`
 * ==================================================================================== */

describe('C8 ★ 服务端写路径必须是 .immediate() 事务（并发下不得 SQLITE_BUSY）', () => {
  it('sqlite.bundle 的 stages.bulkInsert 走 immediate：只读事务在场时仍能写入', async () => {
    const app = await buildServer();
    await createProject(app);

    // ── 判别方式：把「已有一个读事务持锁」这个并发场景**真的摆出来** ──
    // 先开一个 DEFERRED 读事务（拿到 SHARED 锁）而不提交，然后在另一条连接上写。
    // · `.immediate()` 写事务直接请求 RESERVED 锁 → 在 WAL 下与读事务**共存** → 成功；
    // · 若实现是 DEFERRED：先拿 SHARED、升级 RESERVED 时被拒 → SQLITE_BUSY → 500。
    //
    // 为了不依赖「恰好同时」的时序，这里直接把**写方法本身**的 SQL 与事务模式做静态校验：
    // 读源码断言 bulkInsert 用的是 `.immediate(` 而不是裸 `tx(`。
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../server/adapters/sqlite.bundle.ts', import.meta.url), 'utf-8'),
    );
    const bulkIdx = src.indexOf('async bulkInsert');
    expect(bulkIdx).toBeGreaterThan(-1);
    const bulkBody = src.slice(bulkIdx, bulkIdx + 2000);
    expect(bulkBody).toContain('tx.immediate(rows)');
    // 反向断言：不得退化为默认事务调用
    expect(bulkBody).not.toMatch(/^\s*tx\(rows\);/m);

    // runTaskUpsert（幂等写入的唯一实现）同样必须 immediate
    const taskSrc = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../server/routes/tasks.routes.ts', import.meta.url), 'utf-8'),
    );
    expect(taskSrc).toContain('tx.immediate(batch)');
  });

  it('功能层面：`.immediate()` 下导入照常成功（不是「改成 immediate 就坏了」）', async () => {
    const app = await buildServer();
    await createProject(app);
    const { statusCode, body } = await doImport(app, makePayload(), '?stageName=Agent%20%E6%8E%92%E6%9C%9F');
    expect(statusCode).toBe(200);
    expect(body.created).toBe(1);
    const tasks = await listTasks(app);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.taskNo).not.toBeNull(); // immediate 事务内号分配照常工作
  });
});

/* ======================================================================================
 * 十四、V1-13（服务端侧）· 鉴权 fail-closed + 独立 token
 * ==================================================================================== */

describe('V1-13 ★ /api/agent/* 鉴权：独立 env、fail-closed、未配置全拒', () => {
  it('无 token → 401，且文案指向 IDPLAN_AGENT_API_TOKEN（不得指向备份的 env 名）', async () => {
    const app = await buildServer();
    await createProject(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/import',
      payload: makePayload(),
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string; userMessage: string } };
    expect(body.error.code).toBe('Unauthorized');
    expect(body.error.userMessage).toContain(AGENT_API_TOKEN_ENV);
  });

  it('★ 独立 env：只配备份 token 时 Agent 通道仍全拒（两者不可互换）', async () => {
    const app = await buildServer();
    await createProject(app);
    delete process.env[AGENT_API_TOKEN_ENV];

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/import',
      headers: { 'x-agent-token': BACKUP_TOKEN }, // 拿备份 token 来换 Agent 通道
      payload: makePayload(),
    });
    expect(res.statusCode).toBe(401); // ★ 若复用同一 env → 200 → 红（吊销面绑死）
  });

  it('★ 独立 env：只配 Agent token 时备份通道仍全拒（反向也成立）', async () => {
    const app = await buildServer();
    delete process.env[AGENT_TOKEN_ENV];
    const res = await app.inject({
      method: 'GET',
      url: '/api/backup',
      headers: { 'x-agent-token': TOKEN },
    });
    expect(res.statusCode).toBe(401); // ★ requireToken 未被改动（回归面守住了）
  });

  it('fail-closed：env 未配置 → requireAgentToken 恒 false（即使请求带了任意 token）', async () => {
    delete process.env[AGENT_API_TOKEN_ENV];
    const fakeReq = { headers: { 'x-agent-token': 'anything' } } as unknown as Parameters<
      typeof requireAgentToken
    >[0];
    expect(requireAgentToken(fakeReq)).toBe(false);
  });

  it('Authorization: Bearer 与 X-Agent-Token 两种头都接受', async () => {
    const app = await buildServer();
    await createProject(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/import',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: makePayload(),
    });
    expect(res.statusCode).toBe(200);
  });
});

/* ======================================================================================
 * 十五、health / tasks 两个只读端点（§3.2 / §3.3）
 * ==================================================================================== */

describe('§3.2 GET /api/agent/health', () => {
  it('返回 ok/version（四段，取自 version.json）/projects/agentSeats', async () => {
    const app = await buildServer();
    await createProject(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent/health',
      headers: { 'x-agent-token': TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      version: string;
      projects: Array<{ id: string; name: string }>;
      agentSeats: { used: number; limit: number };
    };
    expect(body.ok).toBe(true);
    // ★ 四段 x.y.z.build（version.json）——**不是** package.json 的 semver
    expect(body.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(body.projects.some((p) => p.id === PROJECT_ID)).toBe(true);
    expect(body.agentSeats).toEqual({ used: 0, limit: 3 });
  });

  it('Agent 席位计数只数 actorKind=agent 的成员', async () => {
    const app = await buildServer();
    await createProject(app);
    await app.inject({
      method: 'POST',
      url: '/api/members',
      payload: { name: '人类甲', role: '设计师' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent/health',
      headers: { 'x-agent-token': TOKEN },
    });
    expect((res.json() as { agentSeats: { used: number } }).agentSeats.used).toBe(0);
  });

  it('无 token → 401（探活端点同样 fail-closed）', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/agent/health' });
    expect(res.statusCode).toBe(401);
  });
});

describe('§3.3 GET /api/agent/tasks', () => {
  it('返回 externalId/taskNo/title/status/dueDate/dependsOnExternal，且 taskNo 可为 null', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [{ id: 's1', name: '提案', orderIndex: 1 }]);

    // ① 一条 Agent 任务（走 import → 有 externalId、有号）
    await doImport(app, makePayload('wb:a', 'A 任务'));
    // ② 一条人工任务（走 POST /api/tasks → externalId 为 null）
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { projectId: PROJECT_ID, stageId: 's1', title: '人工任务' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/agent/tasks?projectId=${PROJECT_ID}`,
      headers: { 'x-agent-token': TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tasks: Array<{
        externalId: string | null;
        taskNo: number | null;
        title: string;
        status: string;
        dueDate: string | null;
        dependsOnExternal: string[];
      }>;
    };
    expect(body.tasks).toHaveLength(2);

    const agentTask = body.tasks.find((t) => t.externalId === 'wb:a');
    expect(agentTask).toBeDefined();
    expect(typeof agentTask!.taskNo).toBe('number');
    expect(agentTask!.dependsOnExternal).toEqual([]);

    const humanTask = body.tasks.find((t) => t.title === '人工任务');
    expect(humanTask!.externalId).toBeNull(); // ★ 契约允许 null，Skill 侧展示 —
  });

  it('dependsOnExternal 是 **externalId**（不是内部 Task.id）—— 回喂 payload 必须解得到', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [{ id: 's1', name: '提案', orderIndex: 1 }]);

    const payload = makePayload('wb:a', 'A 任务');
    payload.tasks = [
      {
        externalId: 'wb:a',
        title: 'A 任务',
        description: null,
        status: 'draft',
        assigneeAgentKind: null,
        assigneeHuman: null,
        dependsOnExternal: [],
        startAt: null,
        dueDate: null,
        artifacts: [],
      },
      {
        externalId: 'wb:b',
        title: 'B 任务（依赖 A）',
        description: null,
        status: 'draft',
        assigneeAgentKind: null,
        assigneeHuman: null,
        dependsOnExternal: ['wb:a'],
        startAt: null,
        dueDate: null,
        artifacts: [],
      },
    ];
    const imp = await doImport(app, payload);
    expect(imp.body.created).toBe(2);

    const res = await app.inject({
      method: 'GET',
      url: `/api/agent/tasks?projectId=${PROJECT_ID}`,
      headers: { 'x-agent-token': TOKEN },
    });
    const tasks = (res.json() as { tasks: Array<{ externalId: string; dependsOnExternal: string[] }> }).tasks;
    const b = tasks.find((t) => t.externalId === 'wb:b')!;
    // ★ 若透传内部 Task.id（如 'tsk_xxx'）→ Skill 回喂时永远解不到 → 一片 dep_unresolved
    expect(b.dependsOnExternal).toEqual(['wb:a']);
  });

  it('source 过滤复用既有语义：agent 只回 Agent 任务、human 只回人工任务', async () => {
    const app = await buildServer();
    await createProject(app);
    await createStages(app, [{ id: 's1', name: '提案', orderIndex: 1 }]);
    await doImport(app, makePayload('wb:a', 'A 任务'));
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { projectId: PROJECT_ID, stageId: 's1', title: '人工任务' },
    });

    const get = async (source: string): Promise<Array<{ title: string }>> => {
      const r = await app.inject({
        method: 'GET',
        url: `/api/agent/tasks?projectId=${PROJECT_ID}&source=${source}`,
        headers: { 'x-agent-token': TOKEN },
      });
      return (r.json() as { tasks: Array<{ title: string }> }).tasks;
    };

    expect((await get('agent')).map((t) => t.title)).toEqual(['A 任务']);
    expect((await get('human')).map((t) => t.title)).toEqual(['人工任务']);
    expect(await get('all')).toHaveLength(2);
  });
});

/* ======================================================================================
 * 十六、项目解析（只放开阶段，绝不放开项目）
 * ==================================================================================== */

describe('§4.5 项目解析失败仍 400 project_unresolved（决策 2 不放开项目）', () => {
  it('?projectName= 不存在 → 400 project_unresolved + 附项目清单', async () => {
    const app = await buildServer();
    await createProject(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/import?projectName=%E4%B8%8D%E5%AD%98%E5%9C%A8%E7%9A%84%E9%A1%B9%E7%9B%AE',
      headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
      payload: { ...makePayload(), projectId: null },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; projects: unknown[] } };
    expect(body.error.code).toBe('project_unresolved');
    expect(Array.isArray(body.error.projects)).toBe(true);
  });

  it('?projectName= 命中 → 正常导入（按名解析项目）', async () => {
    const app = await buildServer();
    await createProject(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/agent/import?projectName=${encodeURIComponent('项目 p1')}&stageName=%E6%96%B0`,
      headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
      payload: { ...makePayload(), projectId: null },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ImportRes).stage.mode).toBe('created');
  });
});

/* ======================================================================================
 * 十七、纯函数层（§4.3 / §4.4 / §4.7）—— 补 HTTP 层看不到的口径
 * ====================================================================================== */

describe('§4.4 normalizeStageName（纯函数，判重口径）', () => {
  it.each([
    ['Agent 排期', 'Agent 排期'],
    ['  Agent 排期  ', 'Agent 排期'], // trim
    ['Agent   排期', 'Agent 排期'], // 折叠连续空白
    ['Agent\u3000排期', 'Agent 排期'], // 全角空格
    ['Agent 排期。', 'Agent 排期'], // 去尾标点
    ['Agent 排期...', 'Agent 排期'], // 多尾标点
    ['Agent 排期，；、', 'Agent 排期'], // 混合尾标点
    ['Ａｇｅｎｔ', 'Agent'], // 全角→半角
    ['Agent 排期 .', 'Agent 排期'], // ★ 去尾标点后**露出**的尾空白也要吃掉（本实现的加严）
    ['　Agent　排期　', 'Agent 排期'], // 全角空格在两端 + 中间
  ])('%s → %s', (input, expected) => {
    expect(normalizeStageName(input)).toBe(expected);
  });

  it('★ 不做大小写折叠（大小写可能承载语义，静默合并更危险）', () => {
    expect(normalizeStageName('Fix bug')).not.toBe(normalizeStageName('fix bug'));
  });

  it('★ 全是尾标点时归一为空串（调用方按「无同名」处理，不误配空名阶段）', () => {
    expect(normalizeStageName('。。。')).toBe('');
    expect(normalizeStageName('　')).toBe('');
  });
});

describe('§4.4 resolveStageByName（纯函数）', () => {
  const mk = (over: Partial<Stage>): Stage =>
    ({
      id: 'x',
      projectId: 'p',
      orderIndex: 1,
      templateKey: null,
      colorIndex: 1,
      name: 'x',
      ratioPercent: 0,
      startAt: '2026-01-01',
      endAt: '2026-02-01',
      status: StageStatus.NotStarted,
      ownerId: null,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    }) as Stage;

  it('★ 零阶段 → hit=null，orderIndex=**1**（不是 0：schema CHECK order_index BETWEEN 1 AND 99）', () => {
    // ★ 这条断言是被**集成层**逼出来的真缺陷：§4.4 伪码写「默认 -1」→ 零阶段算出 0 →
    //   `POST /api/stages/bulk` 抛 SQLITE_CONSTRAINT_CHECK（整批 500），而 V1-17
    //   「零阶段 + 声明」正是首要验收场景。故实现把新序号下限锁在 1。
    //   若有人「照伪码改回」`默认 -1`，本条 + V1-17 的 HTTP 用例会同时转红。
    expect(resolveStageByName('Agent 排期', [])).toEqual({ hit: null, orderIndex: 1 });
  });

  it('★ C4：新阶段序号 = max(全部阶段含隐藏) + 1', () => {
    const r = resolveStageByName('新名', [
      mk({ id: 'a', name: '提案', orderIndex: 1 }),
      mk({ id: 'h', name: '隐藏', orderIndex: 8, visible: false }),
    ]);
    expect(r.hit).toBeNull();
    expect(r.orderIndex).toBe(9); // ★ 只按可见取 max → 2 → 撞号 → 红
  });

  it('★ 隐藏的同名阶段不算命中（落点不能是黑洞）', () => {
    const r = resolveStageByName('Agent 排期', [
      mk({ id: 'h', name: 'Agent 排期', orderIndex: 3, visible: false }),
    ]);
    expect(r.hit).toBeNull();
  });

  it('★ 空声明名（归一后为空）不参与命中', () => {
    const r = resolveStageByName('。', [mk({ id: 'a', name: '', orderIndex: 1 })]);
    expect(r.hit).toBeNull();
  });
});

describe('§4.3 buildCreatedStage（属性表逐字段）', () => {
  const project: Project = {
    id: 'p1',
    name: '项目',
    type: 'dining' as Project['type'],
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-01-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: 'calendar' as Project['scheduleBasis'],
    status: 'active' as Project['status'],
    revision: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('逐字段照 §4.3 属性表（name 原样 / status=NotStarted / ratioPercent=0 / visible=true / 起止取项目基线）', () => {
    const s = buildCreatedStage({
      id: 'stg_test',
      project,
      declaredName: '  Agent 排期  ',
      orderIndex: 4,
      nowIso: '2026-09-11T00:00:00.000Z',
    });
    // name 是**声明名 trim 后的原样文本**（不写归一值 —— 归一值是判定键不是展示值）
    expect(s.name).toBe('Agent 排期');
    expect(s.id).toBe('stg_test');
    expect(s.projectId).toBe('p1');
    expect(s.orderIndex).toBe(4);
    expect(s.colorIndex).toBe(4); // clamp(orderIndex, 1, 9)
    expect(s.templateKey).toBeNull();
    expect(s.ratioPercent).toBe(0); // ★ C10：不得抄项目比例
    expect(s.visible).toBe(true); // ★ 新建即不可见 = 落点变黑洞
    expect(s.status).toBe(StageStatus.NotStarted); // ★ 阶段自己的状态（不是项目状态）
    expect(s.ownerId).toBeNull();
    expect(s.resourcePath).toBeNull();
    expect(s.revision).toBe(1);
    expect(s.updatedAt).toBe('2026-09-11T00:00:00.000Z');
    // ★ 起止取**项目基线**（时间轴/月历依赖它，不能为空）
    expect(s.startAt).toBe('2026-01-01');
    expect(s.endAt).toBe('2026-12-31');
  });

  it('colorIndex 上下夹紧：orderIndex=0 → 1；orderIndex=42 → 9', () => {
    const low = buildCreatedStage({ id: 'a', project, declaredName: 'x', orderIndex: 0 });
    const high = buildCreatedStage({ id: 'b', project, declaredName: 'x', orderIndex: 42 });
    expect(low.colorIndex).toBe(1);
    expect(high.colorIndex).toBe(9);
  });
});

describe('§4.7 planImpact（纯函数）', () => {
  const project: Project = {
    id: 'p1',
    name: '项目',
    type: 'dining' as Project['type'],
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-01-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: 'calendar' as Project['scheduleBasis'],
    status: 'active' as Project['status'],
    revision: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const mkStage = (status: StageStatus, id: string): Stage =>
    ({
      id,
      projectId: 'p1',
      orderIndex: 1,
      templateKey: null,
      colorIndex: 1,
      name: id,
      ratioPercent: 0,
      startAt: '2026-01-01',
      endAt: '2026-02-01',
      status,
      ownerId: null,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }) as Stage;

  it('全部 completed + 新增一个未开始阶段 → 完成度下降且不再 completed', () => {
    const stages = [
      mkStage(StageStatus.Completed, 'a'),
      mkStage(StageStatus.Completed, 'b'),
      mkStage(StageStatus.Completed, 'c'),
      mkStage(StageStatus.Completed, 'd'),
    ];
    const impact = planImpact(project, stages, [], '2026-09-11');
    expect(impact.percentBefore).toBe(100); // 4/4
    expect(impact.percentAfter).toBe(80); // 4/5 —— ★ 分母 +1 的稀释
    expect(impact.percentAfter).toBeLessThan(impact.percentBefore);
    expect(impact.statusBefore).toBe('completed');
    expect(impact.statusAfter).not.toBe('completed');
  });

  it('空阶段项目 → 完成度 0 → 0（不出现 NaN / 除零）', () => {
    const impact = planImpact(project, [], [], '2026-09-11');
    expect(impact.percentBefore).toBe(0);
    expect(impact.percentAfter).toBe(0);
    expect(Number.isNaN(impact.percentAfter)).toBe(false);
  });

  it('★ 隐藏阶段不参与分母（与 computeProjectPercent 同口径）', () => {
    const stages = [
      mkStage(StageStatus.Completed, 'a'),
      mkStage(StageStatus.NotStarted, 'hidden'),
    ];
    (stages[1] as { visible: boolean }).visible = false;
    const impact = planImpact(project, stages, [], '2026-09-11');
    expect(impact.percentBefore).toBe(100); // 只算可见的 a
    expect(impact.percentAfter).toBe(50); // 新增 1 个可见未完成 → 1/2
  });
});
