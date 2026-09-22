/**
 * v0.8 · T04-SRV · Agent 建板通道（`POST /api/agent/boards`）＋ §7.6「定向反转」验收 spec。
 *
 * ── 覆盖 ──
 * PRD B7（AI 能建板 / 仍不能碰人类项目）、B8（阶段来源＝18 套餐 / 56 阶段项；不在库 → 自定义）、
 * B9（名称＋起止日期＋阶段集合缺一即拒，**绝不猜日期**）、B10（人类项目一字不改，回归铁律）；
 * 设计 §7.6（定向反转）、§7.2 #26（候选清单只列 Agent 看板 —— 2026-09-20 用户
 * 裁决「Agent 与她自己的项目零关系」后再反转，修订记录见 PRD 文末）。
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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
 * 四、§7.6 / §7.2 #26 · 候选清单只列 Agent 看板（2026-09-20 用户裁决后再反转）
 *
 * ── 为什么是「再反转」而不是回归疏漏 ──
 * v0.8 §7.6「定向反转」原定候选只列**人类**项目（AI 辅助排期写进人类项目，
 * PRD §5.2 #26 + 隔离清单测试钉死）。用户 2026-09-20 明确边界：「Agent 可以在
 * 各个专业领域排期，但肯定跟我自己的项目没关系」⇒ 候选集合翻转为 Agent 看板。
 * 修订记录见 `deliverables/research/v0.8-增量PRD-建档重构与Agent工作区.md` 文末。
 * ==================================================================================== */

describe('§7.6 / §7.2 #26 · listProjectCandidates() 只列 Agent 看板', () => {
  it('探活清单含已建的 Agent 看板、不含人类项目', async () => {
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
    // ★ 合法落点只剩 Agent 看板：探活清单呈现的就是「导得进去的那些板」
    expect(body.projects.map((p) => p.id)).toContain(board.body.projectId);
    expect(body.projects.map((p) => p.name)).toContain('AI 看板 · 候选边界');
    // ★ 反向断言：人类项目**不在**候选集里（用户边界：Agent 与她自己的项目零关系）
    expect(body.projects.map((p) => p.id)).not.toContain('p_human');
    expect(body.projects.map((p) => p.name)).not.toContain('人类项目');
  });

  it('★ ?projectName=<人类项目名> → project_unresolved 且**零写入**（按名解析被结构性排除）', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'p_human', '人类项目');
    const before = tableCounts();

    const res = await doImport(app, `?projectName=${encodeURIComponent('人类项目')}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('project_unresolved');
    // 按名解析的第一道排除：人类项目名不进候选集 ⇒ 名字「查无此项」
    expect(res.body.error?.userMessage).toContain('未找到名为');
    // ★ 零写入：既没有新任务、也没有新阶段
    expect(tableCounts()).toEqual(before);
    // 诊断载荷里的候选清单同样只剩 Agent 看板（此刻一口都没有 → 空数组，
    // 否则等于在诱导调用方去选一个必然被拒的落点）
    expect(res.body.error?.projects).toEqual([]);
    // 人类项目本体逐字段未变（一个阶段都没被建出来）
    expect(projectRow('p_human').kind).toBe('human');
    expect(stageRows('p_human')).toHaveLength(0);
  });

  it('★ ?projectId=<人类项目 id> → 400 project_unresolved（归属关卡：文案指明「不是 Agent 看板」）', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'p_human', '人类项目');
    const before = tableCounts();

    // 显式 id 绕过按名解析 —— 这一道由**归属关卡**接住（与存在性合并为一次查询）
    const res = await doImport(app, '?projectId=p_human');

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('project_unresolved');
    // 文案指明归属：落点不是 Agent 看板（不是「名字打错了」那种无信息量报错）
    expect(res.body.error?.userMessage).toContain('不是 Agent 看板');
    expect(res.body.error?.userMessage).toContain('p_human');
    // ★ 零写入 + 人类项目本体一字未改
    expect(tableCounts()).toEqual(before);
    expect(projectRow('p_human')).toMatchObject({ kind: 'human' });
    expect(stageRows('p_human')).toHaveLength(0);
  });

  it('★ ?projectId=<不存在的 id> → 400 project_unresolved（存在性关卡：文案指明「不存在」）', async () => {
    const app = await buildServer();
    const before = tableCounts();

    // 显式 id 指向一个从未建过的项目（既不是人类项目、也不是 Agent 看板）——
    // 这一道由**存在性判定**接住（与归属关卡同一次查询：先判存在、再判 kind）。
    // 变异验证锚点：把 `if (!targetRow)` 改成永假，本用例必须转红。
    const res = await doImport(app, '?projectId=p_ghost');

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('project_unresolved');
    expect(res.body.error?.userMessage).toContain('不存在');
    expect(res.body.error?.userMessage).toContain('p_ghost');
    // ★ 零写入
    expect(tableCounts()).toEqual(before);
  });

  it('?projectName=<Agent 看板名> → 正常按名解析导入（合法落点：任务落进看板已有阶段）', async () => {
    const app = await buildServer();
    const board = await postBoard(app, {
      name: 'AI 看板 · 合法落点',
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-08-31',
      presetKey: 'indoor_full',
    });
    expect(board.statusCode, board.raw).toBe(201);

    // 显式声明落点名 → 命中 indoor_full 骨架里的「提案」，任务落进去
    const res = await doImport(
      app,
      `?projectName=${encodeURIComponent('AI 看板 · 合法落点')}&stageName=${encodeURIComponent('提案')}`,
    );
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    const tasks = db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number };
    expect(tasks.c).toBe(1); // 反转后这条通道照样能用——只是落点换了对象
    // 任务确实落进了 Agent 看板（不是别的项目）
    const row = db.prepare('SELECT project_id FROM tasks').get() as { project_id: string };
    expect(row.project_id).toBe(board.body.projectId);
    // 看板骨架 9 段一字未增（stageName 命中的是已有阶段，不是新建）
    expect(stageRows(board.body.projectId!)).toHaveLength(9);
  });
});

/* ======================================================================================
 * 四二、★ 2026-09-20 补齐 · GET /api/agent/tasks 读侧归属关卡
 *
 * 写侧的落点门（第四节）只拦「导入」；读侧同样有归属：Skill 拿任务流是为了**回喂
 * payload**，若这里还带着人类项目的任务，「看得见」会被误解为「导得进」—— 白费
 * 一轮 depends_unresolved，且等于把她的排期整库递给任何持 token 的调用方。
 * ==================================================================================== */

/** 给项目插一个可见批次（不经建板端点，模拟「库里已有的人类项目」） */
function seedStage(projectId: string, id = `stg_${projectId}`): void {
  db.prepare(
    `INSERT INTO stages (id, project_id, order_index, template_key, color_index, custom_color,
       name, ratio_percent, start_at, end_at, status, owner_id, visible, resource_path, revision, updated_at)
     VALUES (?, ?, 1, NULL, 1, NULL, '批次1', 10, '2026-01-01', '2026-12-31',
       'not_started', NULL, 1, NULL, 1, '2026-01-01T00:00:00.000Z')`,
  ).run(id, projectId);
}

/** 往项目插一条人工任务（走既有 POST /api/tasks，不经 Agent 通道） */
async function createManualTask(
  app: App,
  projectId: string,
  stageId: string,
  title: string,
): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { projectId, stageId, title },
  });
  expect(res.statusCode, res.body).toBe(200);
}

describe('§3.3 GET /api/agent/tasks · 读侧归属关卡（2026-09-20 补齐）', () => {
  it('★ 显式 projectId 指向人类项目 → 400 project_unresolved（即使库里确实有任务）', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'p_human', '人类项目');
    seedStage('p_human');
    // 人类项目里确实有一条任务 —— 证明 400 不是「恰好为空」的假红
    await createManualTask(app, 'p_human', 'stg_p_human', '人类任务');

    const res = await app.inject({
      method: 'GET',
      url: '/api/agent/tasks?projectId=p_human',
      headers: { 'x-agent-token': TOKEN },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; userMessage: string; projects: unknown[] } };
    expect(body.error.code).toBe('project_unresolved');
    expect(body.error.userMessage).toContain('Agent 看板');
    expect(body.error.projects).toEqual([]);
  });

  it('★ 未指定 projectId → 只回 Agent 看板的任务（人类项目任务一条都不出现）', async () => {
    const app = await buildServer();
    // ① 人类项目 + 1 条人工任务
    await createHumanProject(app, 'p_human', '人类项目');
    seedStage('p_human');
    await createManualTask(app, 'p_human', 'stg_p_human', '人类任务');
    // ② Agent 看板 + 1 条导入任务
    const board = await postBoard(app, {
      name: 'AI 看板 · 读侧边界',
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-08-31',
      presetKey: 'indoor_full',
    });
    expect(board.statusCode, board.raw).toBe(201);
    const imp = await doImport(
      app,
      `?projectId=${board.body.projectId}&stageName=${encodeURIComponent('提案')}`,
    );
    expect(imp.statusCode, JSON.stringify(imp.body)).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/agent/tasks',
      headers: { 'x-agent-token': TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const tasks = (res.json() as { tasks: Array<{ title: string }> }).tasks;
    // 库里明明有两条任务（人类一条 + 看板一条），Agent 通道只看得见看板那条
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('写提案'); // makePayload 的固定标题
  });
});

/* ======================================================================================
 * 五、源码锁 · fail-closed 启动告警的端点清单 ⇄ 实际注册清单，**双向**对账
 *
 * ── 为什么值得单开一段锁 ──
 * `server/lib/agent-auth.ts` 的启动告警（env 未配置时打印）存在**唯一**理由：
 * 让用户在启动日志里认出他刚踩的那个 401 属于哪个端点。否则 Skill 拿到 401，
 * 用户在日志里找不到任何提到它的线索，只会回到「是不是 ID Plan 没起来」——
 * 即 V1-13 的「假无响应」原样复发。v0.8 加建板端点时，这条清单确实漏了
 * `POST /api/agent/boards`（本段就是那次漏报的回归锁）。
 *
 * ── 为什么是「双向」而不是「清单里有建板」──
 * 单向断言（「告警里含 boards」）只锁住这一次补丁的形状，下次新增端点照样漏。
 * 双向对账锁的是**规则本身**：实际注册了什么，就必须一字不差地宣告什么。
 * 反向那一半还顺带防「删了端点、文案留着」——那种陈旧文案会把人引向不存在的端点。
 *
 * 端点的**唯一事实来源**是 `agent.routes.ts` 的 `scope.<verb>('/api/agent/...')`；
 * 告警侧用「以单引号开头且以 /api/agent/ 开头」的行来定位（不用宽泛 includes，
 * 免得把本文件新增的注释文字误当清单）。
 * ==================================================================================== */
describe('源码锁 · fail-closed 启动告警的端点清单 ⇄ 实际注册清单', () => {
  const ROOT = join(__dirname, '..');
  const readSrc = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8');

  /** 实际注册的 `/api/agent/*` 端点（读 `agent.routes.ts` 的真实注册语句） */
  const registeredEndpoints = (): string[] =>
    [...readSrc('server/routes/agent.routes.ts').matchAll(
      /scope\.(?:get|post|put|patch|delete)\(\s*'(\/api\/agent\/[^']*)'/g,
    )].map((m) => m[1]!);

  /** 告警文案**宣告**会拒绝的端点（读 `agent-auth.ts` 里那行单引号字面量） */
  const announcedEndpoints = (): string[] => {
    const line = readSrc('server/lib/agent-auth.ts')
      .split('\n')
      .find((l) => /^\s*'\/api\/agent\//.test(l));
    if (!line) return [];
    return [...line.matchAll(/\/api\/agent\/[a-z0-9-]+/g)].map((m) => m[0]);
  };

  it('★ 双向对账：注册了几个就宣告几个（漏报 / 陈旧文案都会红）', () => {
    const registered = registeredEndpoints();
    const announced = announcedEndpoints();

    // 防「正则没匹配到」造成的假绿：两侧都必须非空，且实际注册数就是当前的 4 个。
    expect(registered.length, '未匹配到任何 /api/agent 注册语句——正则已失效').toBeGreaterThan(0);
    expect(announced.length, '未匹配到告警端点清单行——定位方式已失效').toBeGreaterThan(0);

    // ① 一个不漏：新增端点忘记改告警文案 → 这里红
    expect(
      registered.filter((e) => !announced.includes(e)),
      '以下已注册端点未出现在 fail-closed 启动告警里（用户会搜不到自己踩的 401）',
    ).toEqual([]);

    // ② 一个不剩：删了端点却没删文案 → 这里红（陈旧文案会把人引向不存在的端点）
    expect(
      announced.filter((e) => !registered.includes(e)),
      '以下端点已不在路由里，却仍被启动告警宣告为「会被拒绝」',
    ).toEqual([]);

    // ③ 顺序也对齐：`agent.routes.ts` 的端点按 ①②③④ 编号排列，告警沿用同序便于人工比对
    expect(announced).toEqual(registered);
  });

  it('★ 每个 /api/agent 端点都被 requireAgentToken 覆盖（新增端点忘了鉴权 → 这里红）', () => {
    const code = readSrc('server/routes/agent.routes.ts');
    const gated = [...code.matchAll(/if\s*\(\s*!requireAgentToken\(req\)\s*\)/g)];
    // 本锁的语义：鉴权调用点数 == 端点数。少一处 = 有一个端点在裸奔。
    expect(
      gated.length,
      `注册端点 ${registeredEndpoints().length} 个，但 requireAgentToken 只出现 ${gated.length} 处`,
    ).toBe(registeredEndpoints().length);
  });
});
