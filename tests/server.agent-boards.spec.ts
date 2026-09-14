/**
 * v0.8 · T04-SRV · Agent 建板通道（`POST /api/agent/boards`）＋ §7.6「定向反转」验收 spec。
 *
 * ── 覆盖 ──
 * PRD B7（AI 能建板 / 仍不能碰人类项目）、B8（阶段来源＝18 套餐 / 56 阶段项；不在库 → 自定义）、
 * B9（名称＋起止日期＋阶段集合缺一即拒，**绝不猜日期**）、B10（人类项目一字不改，回归铁律）；
 * 设计 §7.6（定向反转）、§7.2 #26（候选清单只列人类项目）。
 *
 * ── 为什么全部走 `app.inject` 端到端 ──
 * 本任务的缺口几乎全是**集成缺口**：校验判序、零写入、`kind` 落库值、阶段骨架的来源与
 * 键集合。这些在单测纯函数时全都正确，只有真发一次 HTTP 才看得见（与 v07-T02 spec 同因）。
 *
 * ── 零写入怎么证明 ──
 * 断言「请求前后 `projects` / `stages` / `tasks` 三张表的行数逐一相等」——
 * 而不是断言「返回 400」：返回 400 但偷偷写了半行，是这种端点最典型的失效模式。
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
import { AGENT_API_TOKEN_ENV, AGENT_TOKEN_ENV } from '../server/lib/agent-auth';

type Db = InstanceType<typeof Database>;
type App = ReturnType<typeof Fastify>;

const TOKEN = 'v08-t04srv-agent-api-token-0123456789';
const BACKUP_TOKEN = 'v08-t04srv-backup-token-9876543210';

/**
 * `indoor_full` 套餐的 9 段名 —— **逐字硬编码**（不从 stage-library 读）。
 * 若测试也从库读，「库里少了一项」这个失效模式会被测成绿的（两边同时少）。
 * 这 9 个名字就是 PRD B8「声明 presetKey=indoor_full → 9 段」的验收内容。
 */
const INDOOR_FULL_NAMES = [
  '提案',
  '测量',
  '平面方案',
  'SU 建模',
  '效果图',
  '施工图深化',
  '材料表',
  '交付',
  '实景',
];

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

interface BoardRes {
  projectId?: string;
  name?: string;
  stages?: Array<{ id: string; name: string; templateKey: string | null }>;
  error?: { code: string; userMessage: string; projects?: unknown };
}

/** 建板请求（默认带 token；`token: false` 用于测 401） */
async function postBoard(
  app: App,
  body: Record<string, unknown>,
  opts: { token?: boolean } = {},
): Promise<{ statusCode: number; body: BoardRes; raw: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/agent/boards',
    headers: {
      'content-type': 'application/json',
      ...(opts.token === false ? {} : { 'x-agent-token': TOKEN }),
    },
    payload: body,
  });
  return { statusCode: res.statusCode, body: res.json() as BoardRes, raw: res.body };
}

/** 三张表的行数（零写入证明用） */
function tableCounts(): { projects: number; stages: number; tasks: number } {
  const n = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
  return {
    projects: n('SELECT COUNT(*) AS c FROM projects'),
    stages: n('SELECT COUNT(*) AS c FROM stages'),
    tasks: n('SELECT COUNT(*) AS c FROM tasks'),
  };
}

type ProjectRow = Record<string, unknown>;
const projectRow = (id: string): ProjectRow =>
  db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow;

type StageRow = Record<string, unknown>;
const stageRows = (projectId: string): StageRow[] =>
  db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY order_index').all(projectId) as StageRow[];

/** 一个人类项目（`kind` 不传 → 落 'human'），用于候选项 / 边界对照 */
async function createHumanProject(app: App, id = 'p_human', name = '人类项目'): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      id,
      name,
      type: 'dining',
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-12-31',
    },
  });
  expect(res.statusCode, `建人类项目失败：${res.body}`).toBe(200);
}

/** 一个最小的合法 import payload（1 条任务）；`projectId: null` 才能走 `?projectName=` 解析 */
function makePayload(): Record<string, unknown> {
  return {
    schema: 'idplan-agent-payload/v1',
    projectId: null,
    stageId: null,
    producedBy: {
      actorKind: 'agent',
      agentKind: 'workbuddy',
      agentName: 'WorkBuddy',
      runId: 'run-boards-1',
    },
    tasks: [
      {
        externalId: 'workbuddy:boards-1:t1',
        title: '写提案',
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

async function doImport(
  app: App,
  query: string,
): Promise<{ statusCode: number; body: BoardRes }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/agent/import${query}`,
    headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
    payload: makePayload(),
  });
  return { statusCode: res.statusCode, body: res.json() as BoardRes };
}

/* ======================================================================================
 * 一、PRD B7 / B8 / B9 · 正常建板
 * ==================================================================================== */

describe('B7/B8 · POST /api/agent/boards 正常建板', () => {
  it('presetKey=indoor_full → 201、9 段（骨架来自阶段库）、项目 kind=agent / domain=indoor', async () => {
    const app = await buildServer();
    const res = await postBoard(app, {
      name: 'AI 看板 · 全流程',
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-08-31',
      presetKey: 'indoor_full',
    });

    expect(res.statusCode, res.raw).toBe(201);
    const body = res.body;
    expect(body.name).toBe('AI 看板 · 全流程');
    expect(body.projectId).toBeTruthy();
    // ★ PRD B8 的验收：9 段，且就是 indoor_full 的那 9 段（名字逐个比对）
    expect(body.stages).toHaveLength(9);
    expect(body.stages?.map((s) => s.name)).toEqual(INDOOR_FULL_NAMES);
    // 契约的键集合恒定：id → name → templateKey（不多不少）
    expect(Object.keys(body.stages![0]!)).toEqual(['id', 'name', 'templateKey']);
    // 套餐骨架的 templateKey 全部是库内真 key（不是 null，也不是伪造 key）
    expect(body.stages!.every((s) => typeof s.templateKey === 'string')).toBe(true);

    const p = projectRow(body.projectId!);
    expect(p.kind).toBe('agent'); // ★ PRD B7 的验收：新看板 kind='agent'
    expect(p.domain).toBe('indoor'); // 套餐声明的行业
    expect(p.stage_preset_key).toBe('indoor_full');
    expect(p.name).toBe('AI 看板 · 全流程');
    expect(p.status).toBe('active');

    const stages = stageRows(body.projectId!);
    expect(stages.map((s) => s.order_index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(stages.map((s) => s.name)).toEqual(INDOOR_FULL_NAMES);
    expect(stages.every((s) => s.project_id === body.projectId)).toBe(true);
    expect(stages.every((s) => s.status === 'not_started')).toBe(true);
    expect(stages.every((s) => s.visible === 1)).toBe(true);
    // Agent 只声明名字/套餐，不带颜色 ⇒ 用内置色（custom_color 恒 null）
    expect(stages.every((s) => s.custom_color === null)).toBe(true);
    // 起止日取项目基线（不猜、不切分）
    expect(stages.every((s) => s.start_at === '2026-03-01')).toBe(true);
    expect(stages.every((s) => s.end_at === '2026-08-31')).toBe(true);
    // 响应的 id/name 与落库逐字一致（所见即所写）
    expect(body.stages!.map((s) => s.id)).toEqual(stages.map((s) => s.id));

    // 往返：既有只读端点读回来也是 agent（B2 的透传）
    const got = await app.inject({ method: 'GET', url: `/api/projects/${body.projectId}` });
    expect((got.json() as { kind: string }).kind).toBe('agent');
  });

  it('stageNames=[提案,消防报审] → 2 段；在库者带 key、不在库者 templateKey=null；domain=null', async () => {
    const app = await buildServer();
    const res = await postBoard(app, {
      name: 'AI 看板 · 报审',
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-08-31',
      stageNames: ['提案', '消防报审'],
    });

    expect(res.statusCode, res.raw).toBe(201);
    // ★ PRD B8 的验收：2 段
    expect(res.body.stages).toHaveLength(2);
    expect(res.body.stages!.map((s) => s.name)).toEqual(['提案', '消防报审']);
    // 声明名**在库** → 正常溯源到库内 key（不落 null）
    expect(res.body.stages![0]!.templateKey).toBe('indoor.proposal');
    // ★ 声明名**不在库** → 自定义阶段：templateKey 落 null（N4：禁伪造 key）
    expect(res.body.stages![1]!.templateKey).toBeNull();

    const p = projectRow(res.body.projectId!);
    expect(p.kind).toBe('agent');
    // 纯 stageNames 建板没有套餐来源 ⇒ domain 为 null（不猜主板块）
    expect(p.domain).toBeNull();

    const stages = stageRows(res.body.projectId!);
    expect(stages).toHaveLength(2);
    expect(stages[0]!.template_key).toBe('indoor.proposal');
    expect(stages[1]!.template_key).toBeNull();
    // 自定义阶段走 §4.3 属性表：ratioPercent 0、色号 = clamp(orderIndex,1,9)
    expect(stages[1]!.ratio_percent).toBe(0);
    expect(stages[1]!.color_index).toBe(2);
  });

  it('presetKey 与 stageNames 同传 → 先展开套餐骨架，再追加声明的名字', async () => {
    const app = await buildServer();
    const res = await postBoard(app, {
      name: 'AI 看板 · 套餐＋追加',
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-08-31',
      presetKey: 'indoor_full',
      stageNames: ['消防报审'],
    });

    expect(res.statusCode, res.raw).toBe(201);
    expect(res.body.stages).toHaveLength(10);
    expect(res.body.stages!.map((s) => s.name)).toEqual([...INDOOR_FULL_NAMES, '消防报审']);
    expect(res.body.stages![9]!.templateKey).toBeNull();
    expect(projectRow(res.body.projectId!).domain).toBe('indoor');
  });

  it('同一次请求内阶段名去重（判重键 = normalizeStageName，保留首次出现）', async () => {
    const app = await buildServer();
    const res = await postBoard(app, {
      name: 'AI 看板 · 去重',
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-08-31',
      // '提案。' 归一后 == '提案'；'测量 ' 归一后 == '测量'（空白）
      stageNames: ['提案', '提案。', '测量 ', '测量', '消防报审'],
    });

    expect(res.statusCode, res.raw).toBe(201);
    expect(res.body.stages).toHaveLength(3);
    expect(res.body.stages!.map((s) => s.name)).toEqual(['提案', '测量', '消防报审']);
  });

  it('套餐骨架阶段名被稍后声明的同义名再次提到时 → 不重复建（跨来源去重）', async () => {
    const app = await buildServer();
    const res = await postBoard(app, {
      name: 'AI 看板 · 跨来源去重',
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-08-31',
      presetKey: 'indoor_full',
      stageNames: ['提案。', '实景'],
    });

    expect(res.statusCode, res.raw).toBe(201);
    expect(res.body.stages).toHaveLength(9); // 不是 11：两条声明名都已在套餐骨架里
    expect(res.body.stages!.map((s) => s.name)).toEqual(INDOOR_FULL_NAMES);
  });
});

/* ======================================================================================
 * 二、PRD B9 · 显式声明（缺一即拒，绝不猜）
 * ==================================================================================== */

describe('B9 · 建板必须显式声明：缺一即拒、零写入、绝不猜日期', () => {
  const base = {
    name: 'AI 看板',
    plannedStartAt: '2026-03-01',
    plannedEndAt: '2026-08-31',
    presetKey: 'indoor_full',
  };

  it('缺 plannedStartAt → 400 invalid_field，且**不得默认一个日期**（零写入）', async () => {
    const app = await buildServer();
    const before = tableCounts();
    const res = await postBoard(app, { ...base, plannedStartAt: undefined });

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(res.body.error?.userMessage).toContain('不会替你猜一个日期');
    // ★ 零写入：三张表行数逐一相等（返回 400 但偷偷写了半行，是这种端点最典型的失效模式）
    expect(tableCounts()).toEqual(before);
  });

  it('缺 plannedEndAt → 400 invalid_field（零写入）', async () => {
    const app = await buildServer();
    const before = tableCounts();
    const res = await postBoard(app, { ...base, plannedEndAt: '   ' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(res.body.error?.userMessage).toContain('不会替你猜一个日期');
    expect(tableCounts()).toEqual(before);
  });

  it('缺 name / name 仅空白 → 400 invalid_field（零写入）', async () => {
    const app = await buildServer();
    const before = tableCounts();
    for (const bad of [undefined, '', '   ']) {
      const res = await postBoard(app, { ...base, name: bad });
      expect(res.statusCode, String(bad)).toBe(400);
      expect(res.body.error?.code).toBe('invalid_field');
    }
    expect(tableCounts()).toEqual(before);
  });

  it('阶段集合缺失（presetKey / stageNames 都不给，或给了空数组）→ 400 invalid_field（零写入）', async () => {
    const app = await buildServer();
    const before = tableCounts();
    for (const bad of [
      { ...base, presetKey: undefined },
      { ...base, presetKey: undefined, stageNames: [] },
      { ...base, presetKey: undefined, stageNames: undefined },
    ]) {
      const res = await postBoard(app, bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.body.error?.code).toBe('invalid_field');
    }
    expect(tableCounts()).toEqual(before);
  });

  it('presetKey=未知 key → 400 invalid_field（零写入，不悄悄退化成「没有阶段」）', async () => {
    const app = await buildServer();
    const before = tableCounts();
    const res = await postBoard(app, { ...base, presetKey: 'indoor_nope' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(tableCounts()).toEqual(before);
  });

  it('stageNames 里出现空条目 → 400 invalid_field（显式声明却给空名 = 调用方 bug）', async () => {
    const app = await buildServer();
    const before = tableCounts();
    const res = await postBoard(app, {
      ...base,
      presetKey: undefined,
      stageNames: ['提案', '  '],
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(tableCounts()).toEqual(before);
  });

  it('展开后阶段数 > 20 → 400 invalid_field（零写入）', async () => {
    const app = await buildServer();
    const before = tableCounts();
    const res = await postBoard(app, {
      ...base,
      presetKey: undefined,
      stageNames: Array.from({ length: 21 }, (_, i) => `阶段 ${i + 1}`),
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(res.body.error?.userMessage).toContain('20');
    expect(tableCounts()).toEqual(before);
  });

  it('恰好 20 段 → 201（上限是 >20 才拒，边界不误伤）', async () => {
    const app = await buildServer();
    const res = await postBoard(app, {
      ...base,
      presetKey: undefined,
      stageNames: Array.from({ length: 20 }, (_, i) => `阶段 ${i + 1}`),
    });
    expect(res.statusCode, res.raw).toBe(201);
    expect(res.body.stages).toHaveLength(20);
  });

  it('无 token → 401（fail-closed），且零写入', async () => {
    const app = await buildServer();
    const before = tableCounts();
    const res = await postBoard(app, base, { token: false });

    expect(res.statusCode).toBe(401);
    expect(res.body.error?.code).toBe('Unauthorized');
    expect(tableCounts()).toEqual(before);
  });
});

/* ======================================================================================
 * 三、结构性「只新建」：不接受落点解析参数
 * ==================================================================================== */

describe('★ 建板端点只新建：projectId / projectName 一律不接受', () => {
  it('body 带 projectId → 400 invalid_field，且该人类项目一字未改、零写入', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'p_human', '人类项目');
    const pBefore = projectRow('p_human');
    const before = tableCounts();

    const res = await postBoard(app, {
      name: 'AI 看板',
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-08-31',
      presetKey: 'indoor_full',
      projectId: 'p_human',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    // 人类项目行**逐字段**未变（连 revision / updated_at 都不许动）
    expect(projectRow('p_human')).toEqual(pBefore);
    expect(projectRow('p_human').kind).toBe('human');
    expect(tableCounts()).toEqual(before);
  });

  it('body 带 projectName → 400 invalid_field（零写入）', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'p_human', '人类项目');
    const before = tableCounts();

    const res = await postBoard(app, {
      name: 'AI 看板',
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-08-31',
      presetKey: 'indoor_full',
      projectName: '人类项目',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(tableCounts()).toEqual(before);
  });
});

/* ======================================================================================
 * 四、§7.6 / §7.2 #26 · 定向反转的另一半：候选清单只列人类项目
 * ==================================================================================== */

describe('§7.6 / §7.2 #26 · listProjectCandidates() 只列人类项目', () => {
  it('探活清单含人类项目、不含已建的 Agent 看板', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'p_human', '人类项目');
    const board = await postBoard(app, {
      name: 'AI 看板 · 候选边界',
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-08-31',
      presetKey: 'indoor_full',
    });
    expect(board.statusCode, board.raw).toBe(201);

    const health = await app.inject({
      method: 'GET',
      url: '/api/agent/health',
      headers: { 'x-agent-token': TOKEN },
    });
    expect(health.statusCode).toBe(200);
    const body = health.json() as { projects: Array<{ id: string; name: string }> };
    expect(body.projects.map((p) => p.id)).toContain('p_human');
    // ★ 反向断言：Agent 看板**不在**候选集里（现状最刺眼处：AI 会往人类项目写，人会选到 Agent 板）
    expect(body.projects.map((p) => p.id)).not.toContain(board.body.projectId);
    expect(body.projects.map((p) => p.name)).not.toContain('AI 看板 · 候选边界');
  });

  it('★ ?projectName=<已存在的 Agent 看板名> → project_unresolved 且**零写入**（B7/B10 边界）', async () => {
    const app = await buildServer();
    const board = await postBoard(app, {
      name: 'AI 看板 · 不可被导入',
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-08-31',
      presetKey: 'indoor_full',
    });
    expect(board.statusCode, board.raw).toBe(201);

    const before = tableCounts();
    const res = await doImport(
      app,
      `?projectName=${encodeURIComponent('AI 看板 · 不可被导入')}`,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('project_unresolved');
    // ★ 零写入：导入通道**结构上**不可能命中 Agent 看板（它不在候选集里），
    //   因此既没有新任务、也没有新阶段（哪怕这条看板有 9 个可见阶段）
    expect(tableCounts()).toEqual(before);
    // 诊断载荷里的候选清单同样只剩人类项目（否则等于在诱导调用方去选一个必然被拒的落点）
    expect(res.body.error?.projects).toEqual([]);
    // 看板本体逐字段未变
    expect(projectRow(board.body.projectId!)).toMatchObject({ kind: 'agent' });
    expect(stageRows(board.body.projectId!)).toHaveLength(9);
  });

  it('?projectName=<人类项目名> → 仍正常按名解析导入（反转只针对 Agent 看板，人类通道零变化）', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'p_human', '人类项目');

    // 显式声明落点名 → 自动建一个阶段并落一条任务（§4.4 按名选点）
    const res = await doImport(
      app,
      `?projectName=${encodeURIComponent('人类项目')}&stageName=${encodeURIComponent('实施')}`,
    );
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    const tasks = db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number };
    expect(tasks.c).toBe(1); // 人类项目这条通道一个字都没改
    expect(stageRows('p_human')).toHaveLength(1);
  });
});
