/**
 * taskNo 服务端口径（v0.7 §2.15-⑦ + 清单第 8 点）· SQLite + Fastify inject。
 *
 * ── 本 spec 锁死什么 ──
 *   ⑦ **老库升级路径**：`tasks.task_no` 靠 `PRAGMA table_info` 幂等补列，
 *      **绝不占 `user_version`**（该计数器被 `migrateDoneToStatus`(→3) 与
 *      `migrateAgentIndex`(→4) 共用）—— 升级后 user_version 必须仍是 4；
 *   ⑧ 号在**四条写入路径**上都要落：单建 / bulk / upsert 新建分支，且
 *      **更新路径绝不覆写**（upsert 命中、PATCH 均不得改写 task_no）。
 *
 * ── 为什么必须端到端验 ──
 * 「INSERT 列数 = 占位符数」这类错只在**运行期**才炸（"N values for M columns"），
 * 静态 typecheck 抓不到；「更新覆写号」则完全不报错，只有真发一次请求再看库里才拦得住。
 */
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';
import { registerTaskRoutes } from '../server/routes/tasks.routes';

type Db = InstanceType<typeof Database>;

/** 建一个内存库 + 注册 project/stage/task 路由 */
async function buildServer(): Promise<{ app: ReturnType<typeof Fastify>; db: Db }> {
  const db = new Database(':memory:');
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

/** 建一个项目 + 一个阶段（tasks 有外键，缺父行会 FR 失败） */
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

/** 读回号计数器（settings.taskNoSeq），未落库 → null */
function readSeq(db: Db): number | null {
  const row = db.prepare('SELECT value_json AS v FROM settings WHERE key = ?').get('taskNoSeq') as
    | { v: string }
    | undefined;
  return row ? (JSON.parse(row.v) as number) : null;
}

/** 经 GET /api/tasks 读全部任务行（含 taskNo） */
async function listTasks(
  app: ReturnType<typeof Fastify>,
): Promise<Array<{ id: string; taskNo: number | null; title: string }>> {
  const res = await app.inject({ method: 'GET', url: '/api/tasks' });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('⑦ 老库升级：task_no 幂等补列，user_version 不 bump', () => {
  it('缺 task_no 的老 tasks 表 → createDb 补出该列，且 user_version 仍为 4', () => {
    const db = new Database(':memory:');
    // 造一个「v0.6 时代」的 tasks 表：有全部既有列、**没有 task_no**
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        stage_id TEXT NOT NULL,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        assignee_id TEXT,
        assignee_ids TEXT NOT NULL DEFAULT '[]',
        due_date TEXT,
        source TEXT NOT NULL DEFAULT 'human',
        external_id TEXT,
        agent_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        description TEXT,
        depends_on TEXT NOT NULL DEFAULT '[]',
        artifacts TEXT NOT NULL DEFAULT '[]',
        start_at TEXT,
        claimed_at TEXT,
        order_index INTEGER NOT NULL DEFAULT 1,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
    `);
    // 老库已跑过 v3/v4 迁移 → user_version = 4
    db.pragma('user_version = 4');

    const colsBefore = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(colsBefore).not.toContain('task_no');

    createDb(db);

    const colsAfter = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(colsAfter).toContain('task_no');
    // ★ user_version 不得被列迁移截胡（仍是 4，不是 5）
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    db.close();
  });

  it('幂等：重复 createDb 不报错、不重复补列', () => {
    const db = new Database(':memory:');
    createDb(db);
    const first = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).filter(
      (c) => c.name === 'task_no',
    ).length;
    createDb(db); // 第二次
    const second = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).filter(
      (c) => c.name === 'task_no',
    ).length;
    expect(first).toBe(1);
    expect(second).toBe(1);
    db.close();
  });

  it('老行（task_no NULL）读回 → taskNo === null（展示侧回落 —）', async () => {
    const { app, db } = await buildServer();
    await seedProject(app, 'p1', 's1');
    // 直接 SQL 造一条「老数据」：task_no 留 NULL
    db.prepare(
      `INSERT INTO tasks (id, project_id, stage_id, title, done, status, order_index, revision, updated_at, task_no)
       VALUES ('legacy-1', 'p1', 's1', '老任务', 0, 'draft', 1, 1, '2026-08-01T00:00:00.000Z', NULL)`,
    ).run();

    const rows = await listTasks(app);
    const legacy = rows.find((r) => r.id === 'legacy-1');
    expect(legacy?.taskNo).toBeNull();
  });
});

describe('单建 POST /tasks：事务内分配号', () => {
  it('空库第一条 → 1000；计数器前移到 1001', async () => {
    const { app, db } = await buildServer();
    await seedProject(app, 'p1', 's1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { projectId: 'p1', stageId: 's1', title: '第一条' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().taskNo).toBe(1000);
    expect(readSeq(db)).toBe(1001);
  });

  it('请求体里带 taskNo 一律忽略（号是仓储分配字段，谁能给号谁就能造重号）', async () => {
    const { app, db } = await buildServer();
    await seedProject(app, 'p1', 's1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { projectId: 'p1', stageId: 's1', title: '想自己指定号', taskNo: 99999 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().taskNo).toBe(1000); // 不是 99999
    expect(readSeq(db)).toBe(1001);
  });

  it('连续单建严格递增（1000/1001/1002）', async () => {
    const { app } = await buildServer();
    await seedProject(app, 'p1', 's1');
    const nos: number[] = [];
    for (const title of ['a', 'b', 'c']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { projectId: 'p1', stageId: 's1', title },
      });
      nos.push(res.json().taskNo);
    }
    expect(nos).toEqual([1000, 1001, 1002]);
  });
});

describe('批量 POST /tasks/bulk：逐行分配（不是全批同号）', () => {
  it('未带号 → 1000/1001/1002，计数器 = 1003', async () => {
    const { app, db } = await buildServer();
    await seedProject(app, 'p1', 's1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk',
      payload: {
        rows: [0, 1, 2].map((i) => ({
          id: `t-${i}`,
          projectId: 'p1',
          stageId: 's1',
          title: `批 ${i}`,
          orderIndex: i + 1,
        })),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(readSeq(db)).toBe(1003);

    const rows = await listTasks(app);
    expect(rows.map((r) => r.taskNo).sort((a, b) => Number(a) - Number(b))).toEqual([
      1000, 1001, 1002,
    ]);
  });

  it('已带号 → 原样保留，且计数器抬到「本批最大号 + 1」（跨库搬运号段领先）', async () => {
    const { app, db } = await buildServer();
    await seedProject(app, 'p1', 's1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk',
      payload: {
        rows: [
          { id: 't-1', projectId: 'p1', stageId: 's1', title: '搬运1', orderIndex: 1, taskNo: 5000 },
          { id: 't-2', projectId: 'p1', stageId: 's1', title: '搬运2', orderIndex: 2, taskNo: 5001 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    // 只看 counter.peek() 会把计数器留在数据之下 → 下次新建撞号；这里必须是 5002
    expect(readSeq(db)).toBe(5002);

    const rows = await listTasks(app);
    expect(rows.map((r) => r.taskNo).sort((a, b) => Number(a) - Number(b))).toEqual([5000, 5001]);

    // 之后单建不撞号
    const next = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { projectId: 'p1', stageId: 's1', title: '搬运之后新建' },
    });
    expect(next.json().taskNo).toBe(5002);
  });
});

describe('幂等 upsert POST /tasks/upsert：新建分配、更新不覆写', () => {
  it('新建 → 分配号；同键重发 → updated 且号不变', async () => {
    const { app, db } = await buildServer();
    await seedProject(app, 'p1', 's1');

    const first = await app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: {
        rows: [
          {
            projectId: 'p1',
            stageId: 's1',
            title: 'Agent 首投',
            externalId: 'agent:run-1:task-1',
            status: 'ready',
          },
        ],
      },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ created: 1, updated: 0 });

    const afterFirst = (await listTasks(app)).find((r) => r.title === 'Agent 首投');
    expect(afterFirst?.taskNo).toBe(1000);
    expect(readSeq(db)).toBe(1001);

    const second = await app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: {
        rows: [
          {
            projectId: 'p1',
            stageId: 's1',
            title: 'Agent 重发（改名）',
            externalId: 'agent:run-1:task-1',
            status: 'ready',
          },
        ],
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ created: 0, updated: 1 });

    const afterSecond = (await listTasks(app)).find((r) => r.title === 'Agent 重发（改名）');
    expect(afterSecond?.id).toBe(afterFirst?.id);
    expect(afterSecond?.taskNo).toBe(1000); // ★ 不覆写
    expect(readSeq(db)).toBe(1001); // 重发不消耗号
  });

  it('批内两条新建 → 逐条分配（1000/1001）', async () => {
    const { app } = await buildServer();
    await seedProject(app, 'p1', 's1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: {
        rows: [
          { projectId: 'p1', stageId: 's1', title: 'A', externalId: 'k-a' },
          { projectId: 'p1', stageId: 's1', title: 'B', externalId: 'k-b' },
        ],
      },
    });
    expect(res.json()).toEqual({ created: 2, updated: 0 });
    const rows = await listTasks(app);
    expect(rows.map((r) => r.taskNo).sort((a, b) => Number(a) - Number(b))).toEqual([1000, 1001]);
  });
});

describe('更新路径绝不改写 task_no', () => {
  it('PATCH /tasks/:id 改标题/状态后 task_no 与计数器都不动', async () => {
    const { app, db } = await buildServer();
    await seedProject(app, 'p1', 's1');

    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { projectId: 'p1', stageId: 's1', title: '原始标题' },
    });
    const id = created.json().id as string;
    const no = created.json().taskNo as number;
    const seqBefore = readSeq(db);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      payload: { title: '改过的标题', status: 'done' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().title).toBe('改过的标题');
    expect(patched.json().taskNo).toBe(no); // ★ 不动
    expect(readSeq(db)).toBe(seqBefore); // 更新不消耗号
  });
});

describe('GET /api/tasks 序列化含 taskNo（键紧接 id）', () => {
  it('返回对象的第一批键顺序为 id → taskNo → projectId', async () => {
    const { app } = await buildServer();
    await seedProject(app, 'p1', 's1');
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { projectId: 'p1', stageId: 's1', title: '顺序检查' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/tasks' });
    const row = res.json()[0] as Record<string, unknown>;
    const keys = Object.keys(row);
    expect(keys.slice(0, 3)).toEqual(['id', 'taskNo', 'projectId']);
  });
});
