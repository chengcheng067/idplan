/**
 * 服务端备份导入的 taskNo 号段归一（v0.7 · T01-b）· SQLite + Fastify inject。
 *
 * ── 本 spec 锁死什么 ──
 *   ★ **团队形态（remote）的撞号回归**：服务端 `POST /api/backup/import` 必须与
 *     local（Dexie）的 `replaceAllImport` **同义**地归一 `taskNoSeq` —— 导入前先在
 *     `DELETE FROM settings` **之前**读走本地计数器，再按 §2.9.1「三者取最大」
 *     （包内 max+1 / 包内 seq / 本地 seq）算出导入后应落的计数器值。
 *
 * ── 为什么只靠 typecheck 抓不到 ──
 * 缺口是「导入后 settings 里躺着包内的旧值」，写入与读取都完全合法，
 * 只有**真的发一次导入、再真的新建一条任务**才会看见号被复用 —— 且全程不报错。
 * 故本 spec 全部走端到端 HTTP（`app.inject`），不走仓储内部函数。
 *
 * ── 判别力（本 spec 的自证）──
 * 每个 `it` 都对应一条在修复前**会红**的断言，注释里标了「修复前实测值」。
 * 变异验证：把 meta.routes.ts 导入事务内的 `resolveTaskNoCollisions` 归一注释掉，
 * 本 spec 的 ①②③ 三条用例全部变红（详见提交说明）。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';
import { registerTaskRoutes } from '../server/routes/tasks.routes';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { AGENT_TOKEN_ENV } from '../server/lib/agent-auth';
import { TASK_NO_SEQ_KEY } from '../src/core/lib/task-no';

type Db = InstanceType<typeof Database>;
type App = ReturnType<typeof Fastify>;

const TOKEN = 'taskno-import-token-0123456789';
const PROJECT_ID = 'p1';
const STAGE_ID = 's1';

let savedToken: string | undefined;
let db: Db;

/** 建一个内存库 + 注册 project/stage/task/meta 四条路由（沿用 server.taskno.spec 的写法） */
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
  registerMetaRoutes(app, db);
  await app.ready();
  return app;
}

beforeEach(() => {
  savedToken = process.env[AGENT_TOKEN_ENV];
  process.env[AGENT_TOKEN_ENV] = TOKEN;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createDb(db);
});

afterEach(() => {
  if (savedToken === undefined) delete process.env[AGENT_TOKEN_ENV];
  else process.env[AGENT_TOKEN_ENV] = savedToken;
  db.close();
});

/** 建一个项目 + 一个阶段（tasks 有外键，缺父行会 FR 失败） */
async function seedProject(app: App): Promise<void> {
  const p = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      id: PROJECT_ID,
      name: '号段归一演练',
      type: 'dining',
      address: '',
      clientName: '',
      plannedStartAt: '2026-08-01',
      plannedEndAt: '2026-10-01',
    },
  });
  expect(p.statusCode, '建项目失败').toBe(200);

  const s = await app.inject({
    method: 'POST',
    url: '/api/stages/bulk',
    payload: {
      rows: [
        {
          id: STAGE_ID,
          projectId: PROJECT_ID,
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
  expect(s.statusCode, '建阶段失败').toBe(200);
}

/**
 * 用**既有的批量写入路径**把库内号段推进到 `maxNo`，并让计数器落到 `maxNo + 1`
 * （`/api/tasks/bulk` 自带「行自带号则沿用，并抬到本批最大号+1」的语义）。
 */
async function seedTasksUpTo(app: App, maxNo: number): Promise<void> {
  const from = maxNo - 3;
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks/bulk',
    payload: {
      rows: [0, 1, 2, 3].map((i) => ({
        id: `seed-${from + i}`,
        projectId: PROJECT_ID,
        stageId: STAGE_ID,
        title: `种子 ${from + i}`,
        orderIndex: i + 1,
        taskNo: from + i,
      })),
    },
  });
  expect(res.statusCode, '批量播种任务失败').toBe(200);
}

/** 读回号计数器（settings.taskNoSeq），未落库 → null */
function readSeq(): number | null {
  const row = db
    .prepare('SELECT value_json AS v FROM settings WHERE key = ?')
    .get(TASK_NO_SEQ_KEY) as { v: string } | undefined;
  return row ? (JSON.parse(row.v) as number) : null;
}

interface ImportResponse {
  ok: boolean;
  renumbered?: number;
}

type PackageData = Record<string, Array<Record<string, unknown>>>;

/** 一条完整形状的包内任务行（缺 NOT NULL 列会在 INSERT 期才炸，故一次给全） */
function taskRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pkg-1',
    taskNo: 1005,
    projectId: PROJECT_ID,
    stageId: STAGE_ID,
    title: '包内任务',
    done: false,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'human',
    externalId: null,
    agentId: null,
    status: 'draft',
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * 现导出一份真实备份作为底包（projects/stages 形状由导出端保证，避免手写行缺列），
 * 再按需替换 tasks / settings —— 这样「包」永远是合法形状。
 */
async function basePackage(app: App): Promise<{ meta: unknown; data: PackageData }> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/backup',
    headers: { 'x-agent-token': TOKEN },
  });
  expect(res.statusCode, '导出底包失败').toBe(200);
  return res.json() as { meta: unknown; data: PackageData };
}

function withData(
  base: { meta: unknown; data: PackageData },
  data: Partial<PackageData>,
): { meta: unknown; data: PackageData } {
  return { meta: base.meta, data: { ...base.data, ...data } };
}

/** 包内计数器行（`valueJson` 恒为裸数字串，与前端 zod 归一产物同形） */
function seqRow(value: number): Record<string, unknown> {
  return { key: TASK_NO_SEQ_KEY, valueJson: String(value), updatedAt: '2026-08-01T00:00:00.000Z' };
}

async function importPackage(
  app: App,
  pkg: { meta: unknown; data: PackageData },
): Promise<ImportResponse> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/backup/import',
    headers: { 'x-agent-token': TOKEN },
    payload: pkg,
  });
  // 失败时把响应体一并打出来：导入是事务内的多表写入，光看 500 定位不到具体语句
  expect(res.statusCode, `导入失败：${res.body}`).toBe(200);
  return res.json() as ImportResponse;
}

/** 经 GET /api/tasks 读全部任务行（含 taskNo） */
async function listTasks(app: App): Promise<Array<{ id: string; taskNo: number | null }>> {
  const res = await app.inject({ method: 'GET', url: '/api/tasks' });
  expect(res.statusCode).toBe(200);
  return res.json() as Array<{ id: string; taskNo: number | null }>;
}

/** 经既有新建路径（POST /api/tasks）建一条任务，返回它的号 */
async function createTask(app: App, title: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { projectId: PROJECT_ID, stageId: STAGE_ID, title },
  });
  expect(res.statusCode, '新建任务失败').toBe(200);
  return res.json().taskNo as number;
}

describe('① ★ 团队形态撞号回归：本地号段领先时导入老包，不得被拉回包内旧号', () => {
  it('库内已发到 1043 / seq=1044 → 导入老包（包内 max=1005、包内 seq=1000）→ 新建仍发 1044', async () => {
    const app = await buildServer();
    await seedProject(app);
    await seedTasksUpTo(app, 1043);
    expect(readSeq()).toBe(1044); // 前置条件：本地计数器确实领先

    const base = await basePackage(app);
    const res = await importPackage(
      app,
      withData(base, {
        tasks: [taskRow({ id: 'pkg-1', taskNo: 1005, title: '老包任务 1005' })],
        settings: [seqRow(1000)],
      }),
    );

    // 兼容字段必须保留（老客户端只读 ok）
    expect(res.ok).toBe(true);

    // ★ 修复前：settings 被包内原样导入 → 计数器 = 1000（跨过 1043 直接复用旧号段）
    expect(readSeq()).toBe(1044);

    // ★ 修复前：这里拿到的是 1000（落在既有号段内），且可能与包内已占用号相撞
    const fresh = await createTask(app, '导入之后新建');
    expect(fresh).toBeGreaterThan(1043);

    const allTasks = await listTasks(app);
    const nos = allTasks.map((t) => t.taskNo);
    expect(new Set(nos).size).toBe(nos.length); // 库内不允许出现重号
  });

  it('计数器只增不减：导入后 taskNoSeq 不小于导入前值', async () => {
    const app = await buildServer();
    await seedProject(app);
    await seedTasksUpTo(app, 1043);
    const before = readSeq();
    expect(before).toBe(1044);

    const base = await basePackage(app);
    await importPackage(
      app,
      withData(base, {
        tasks: [taskRow({ id: 'pkg-1', taskNo: 1005 })],
        settings: [seqRow(1000)],
      }),
    );

    const after = readSeq();
    expect(after).not.toBeNull();
    // ★ 修复前：after = 1000 < 1044 → 红
    expect(after as number).toBeGreaterThanOrEqual(before as number);
  });
});

describe('② 包内号段领先：计数器被顶到「包内 MAX(task_no) + 1」', () => {
  it('导入带 5000/5001 的包 → 计数器 = 5002 → 新建拿 5002（不是 1000）', async () => {
    const app = await buildServer();
    await seedProject(app);

    const base = await basePackage(app);
    await importPackage(
      app,
      withData(base, {
        tasks: [
          taskRow({ id: 'pkg-a', taskNo: 5000, title: '搬运 A' }),
          taskRow({ id: 'pkg-b', taskNo: 5001, title: '搬运 B', orderIndex: 2 }),
        ],
        settings: [seqRow(1000)],
      }),
    );

    // ★ 修复前：包内 seq=1000 被原样导入 → 计数器 = 1000 → 红（且下次新建撞 1000 段）
    expect(readSeq()).toBe(5002);
    const fresh = await createTask(app, '搬运之后新建');
    expect(fresh).toBe(5002);
  });
});

describe('③ 包内自身撞号：保留先到者、后到者重编号，renumbered 如实上报', () => {
  it('两条同为 1000 → renumbered=1，先到者保留 1000、后到者重编号为 1001', async () => {
    const app = await buildServer();
    await seedProject(app);

    const base = await basePackage(app);
    const res = await importPackage(
      app,
      withData(base, {
        tasks: [
          taskRow({ id: 'pkg-a', taskNo: 1000, title: '先到者', orderIndex: 1 }),
          taskRow({ id: 'pkg-b', taskNo: 1000, title: '后到者', orderIndex: 2 }),
        ],
        settings: [seqRow(1000)],
      }),
    );

    // ★ 修复前：服务端不做查重也不上报 → renumbered 字段缺失/为 0 → 红
    expect(res.renumbered).toBe(1);
    expect(res.renumbered).not.toBe(0);

    const rows = (await listTasks(app)).sort((a, b) => a.id.localeCompare(b.id));
    expect(rows.map((r) => r.taskNo)).toEqual([1000, 1001]); // 先到者原样保留

    // 重编号之后计数器前移，新建不与被保留/被重编的号相撞
    expect(readSeq()).toBe(1002);
    expect(await createTask(app, '归一后新建')).toBe(1002);
  });

  it('包内无撞号时 renumbered 为 0（正常包不误报）', async () => {
    const app = await buildServer();
    await seedProject(app);

    const base = await basePackage(app);
    const res = await importPackage(
      app,
      withData(base, {
        tasks: [
          taskRow({ id: 'pkg-a', taskNo: 1000 }),
          taskRow({ id: 'pkg-b', taskNo: 1001, orderIndex: 2 }),
        ],
        settings: [seqRow(1002)],
      }),
    );
    expect(res.renumbered).toBe(0);
  });
});
