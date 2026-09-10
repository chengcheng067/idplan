/**
 * v0.7 阶段C（T09/T10/T11）· SQLite 侧索引换轨（`server/schema.sql` + `server/db.ts`）。
 *
 * ── 为什么这个 spec 必须存在 ──
 * `idx_tasks_external_id` 换轨有一个**只在老库上才暴露**的陷阱：
 * 索引定义变了但**名字没变**，`CREATE UNIQUE INDEX IF NOT EXISTS` 见到同名索引已存在
 * 会**直接跳过** → 老库永远还是「全局唯一」，O1 在 NAS 部署形态下根本没生效，
 * 而新库全绿、单测全绿、只有升级过的老库是错的。
 * 故本文件只干一件事：造**老库**，跑真迁移，验列形。
 *
 * 同时锁住 createDb 的**调用顺序**：migrateDoneToStatus(→3) 与 migrateAgentIndex(→4)
 * 共用同一个 `PRAGMA user_version` 单调计数器。若顺序颠倒，前者会因 `4 >= 3` 被跳过，
 * 老库的「done=1 → status='done'」归一被静默丢掉（界面不报错，只是历史完成任务退回 draft）。
 *
 * 用内存 SQLite，不起端口、不依赖网络。
 */
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';

type Db = InstanceType<typeof Database>;

/** 建一个内存库并跑一次迁移 */
function freshDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createDb(db);
  return db;
}

/** 取某索引的列名（按索引内顺序）；索引不存在 → 空数组 */
function indexColumns(db: Db, indexName: string): string[] {
  const rows = db.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{
    name?: string;
    seqno: number;
  }>;
  return rows.sort((a, b) => a.seqno - b.seqno).map((r) => r.name ?? '');
}

/** 取索引元信息（unique / partial / 是否存在） */
function indexMeta(
  db: Db,
  table: string,
  indexName: string,
): { name: string; unique: boolean; partial: boolean } | null {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{
    name: string;
    unique: number;
    partial: number;
  }>;
  const hit = rows.find((r) => r.name === indexName);
  return hit ? { name: hit.name, unique: hit.unique === 1, partial: hit.partial === 1 } : null;
}

/** tasks 的完整列名 */
function taskColumns(db: Db): string[] {
  return (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map((c) => c.name);
}

/** 建父行（tasks.project_id / stage_id 都有外键，缺父行会 FR 失败） */
function seedParents(db: Db, projectIds: readonly string[]): void {
  const insertProject = db.prepare(
    `INSERT INTO projects (id, name, type, planned_start_at, planned_end_at, updated_at)
     VALUES (?,?,?,?,?,?)`,
  );
  const insertStage = db.prepare(
    `INSERT INTO stages (id, project_id, order_index, name, ratio_percent, start_at, end_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  for (const id of projectIds) {
    insertProject.run(id, `项目 ${id}`, 'dining', '2026-08-01', '2026-10-01', '2026-08-01T00:00:00.000Z');
    insertStage.run(`st_${id}`, id, 1, '阶段', 30, '2026-08-01', '2026-08-10', '2026-08-01T00:00:00.000Z');
  }
}

const TASK_COLS = `id, project_id, stage_id, title, done, assignee_ids, order_index, revision, updated_at, status, source, external_id`;

/**
 * 老库夹具 A：**v0.6 年代**的库——v0.6 的 9 个 Agent 列（含 status / external_id）
 * 与**旧的全局唯一索引**都在，只差「索引还是单列」。
 * 这是真实 NAS 老库在本次升级前的确切形态。
 */
function legacyDbWithGlobalIndex(): Db {
  const db = new Database(':memory:');
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
    -- 换轨前形态：全局唯一（单列）
    CREATE UNIQUE INDEX idx_tasks_external_id ON tasks(external_id) WHERE external_id IS NOT NULL;
  `);
  // 老库里的 agent 任务：全局唯一下，两个项目的 key 必须不同（夹具自证「升级前跨项目重复是被禁的」）
  db.exec(`
    INSERT INTO tasks (${TASK_COLS}) VALUES
      ('t_old_a','pA','stA','A 项目幂等任务',0,'[]',1,1,'2026-08-01T00:00:00.000Z','ready','agent','codex:1:a'),
      ('t_old_b','pB','stB','B 项目幂等任务',0,'[]',1,1,'2026-08-01T00:00:00.000Z','ready','agent','codex:1:b'),
      ('t_old_h','pA','stA','A 项目人工任务',0,'[]',2,1,'2026-08-01T00:00:00.000Z','draft','human',NULL);
  `);
  return db;
}

/**
 * 老库夹具 B：**更早（v1/v2 年代）**的库——`tasks` 里**没有** v0.6 的 9 列，
 * 因此也没有 external_id 索引；两条历史任务 done=1/0，status 列尚不存在。
 * 用它验证「补列 → 数据归一 → 建/换索引」整条链在同一个 user_version 计数器下的协作。
 */
function legacyDbWithoutAgentColumns(): Db {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      assignee_id TEXT,
      due_date TEXT,
      order_index INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    INSERT INTO tasks (id, project_id, stage_id, title, done, order_index, revision, updated_at)
    VALUES ('t_done_1','p1','s1','历史已完成',1,1,1,'2026-08-01T00:00:00.000Z'),
           ('t_open_1','p1','s1','历史未完成',0,2,1,'2026-08-01T00:00:00.000Z');
  `);
  return db;
}

describe('SQLite 索引换轨：新库', () => {
  it('新库的 idx_tasks_external_id 就是复合唯一索引（project_id, external_id）', () => {
    const db = freshDb();
    const meta = indexMeta(db, 'tasks', 'idx_tasks_external_id');
    expect(meta, '索引必须存在').not.toBeNull();
    expect(meta!.unique, '必须是 UNIQUE').toBe(true);
    expect(meta!.partial, '必须仍是部分索引（WHERE external_id IS NOT NULL）').toBe(true);
    expect(indexColumns(db, 'idx_tasks_external_id')).toEqual(['project_id', 'external_id']);
    db.close();
  });

  it('新库 user_version 已打标到 4（迁移标记单调推进的终点）', () => {
    const db = freshDb();
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    db.close();
  });

  it('复合唯一语义：跨项目同键可存、同项目同键被 DB 拒绝、NULL 键无数条相安无事', () => {
    const db = freshDb();
    seedParents(db, ['pA', 'pB']);
    const insert = db.prepare(
      `INSERT INTO tasks (${TASK_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insertTask = (
      id: string,
      projectId: string,
      title: string,
      externalId: string | null,
      source: string,
    ): void => {
      insert.run(
        id,
        projectId,
        `st_${projectId}`,
        title,
        0,
        '[]',
        1,
        1,
        '2026-08-01T00:00:00.000Z',
        source === 'agent' ? 'ready' : 'draft',
        source,
        externalId,
      );
    };

    insertTask('x1', 'pA', 'A 项目', 'codex:1:a', 'agent');
    // ① 跨项目同键 → 允许（O1 的全部目的）
    expect(() => insertTask('x2', 'pB', 'B 项目', 'codex:1:a', 'agent')).not.toThrow();
    // ② 同项目同键 → 拒绝（唯一性不能被放宽掉）
    expect(() => insertTask('x3', 'pA', 'A 重复', 'codex:1:a', 'agent')).toThrow(
      /UNIQUE constraint failed/,
    );
    // ③ 无数条 NULL 键相安无事（部分索引的意义）
    expect(() => {
      insertTask('n1', 'pA', '人工甲', null, 'human');
      insertTask('n2', 'pA', '人工乙', null, 'human');
    }).not.toThrow();
    expect((db.prepare('SELECT COUNT(*) c FROM tasks').get() as { c: number }).c).toBe(4);
    db.close();
  });
});

describe('SQLite 索引换轨：幂等', () => {
  it('★ 重复 createDb 3 次：列形不变、user_version 稳定为 4', () => {
    const db = freshDb();
    const before = indexColumns(db, 'idx_tasks_external_id');

    for (let i = 0; i < 2; i += 1) {
      createDb(db); // 幂等：不应重建、不应换形、不应报错
    }

    expect(indexColumns(db, 'idx_tasks_external_id')).toEqual(before);
    expect(indexColumns(db, 'idx_tasks_external_id')).toEqual(['project_id', 'external_id']);
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    db.close();
  });

  it('★ 已打标（user_version=4）的库再跑 createDb：不 DROP 不重建（幂等靠打标，不靠猜）', () => {
    const db = freshDb();
    const sqlFirst = (
      db.prepare(`SELECT sql FROM sqlite_master WHERE name='idx_tasks_external_id'`).get() as {
        sql: string;
      }
    ).sql;

    createDb(db);
    createDb(db);

    const sqlRepeat = (
      db.prepare(`SELECT sql FROM sqlite_master WHERE name='idx_tasks_external_id'`).get() as {
        sql: string;
      }
    ).sql;
    expect(sqlRepeat).toBe(sqlFirst);
    expect(indexColumns(db, 'idx_tasks_external_id')).toEqual(['project_id', 'external_id']);
    db.close();
  });
});

describe('SQLite 索引换轨：老库升级', () => {
  it('★ v0.6 老库（全局唯一索引）升级：索引被真换成复合列形，而非「IF NOT EXISTS 跳过」', () => {
    const db = legacyDbWithGlobalIndex();
    // 夹具自检：升级前必须是**单列**全局唯一，否则下面的断言毫无区分力
    expect(indexColumns(db, 'idx_tasks_external_id')).toEqual(['external_id']);

    createDb(db);

    expect(
      indexColumns(db, 'idx_tasks_external_id'),
      '★ 本阶段核心断言：若 migrateAgentIndex 缺失或顺序错，这里仍是 [external_id]',
    ).toEqual(['project_id', 'external_id']);
    expect(indexMeta(db, 'tasks', 'idx_tasks_external_id')!.unique).toBe(true);
    expect(indexMeta(db, 'tasks', 'idx_tasks_external_id')!.partial).toBe(true);
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    db.close();
  });

  it('升级后老库能存下「跨项目同幂等键」——O1 在 NAS 形态下真的生效了', () => {
    const db = legacyDbWithGlobalIndex();
    createDb(db);

    // 升级前：pA 已有 codex:1:a。现在 pB 用**同一个键**插入（老索引下会 UNIQUE 失败）
    const insert = db.prepare(
      `INSERT INTO tasks (${TASK_COLS}) VALUES (?,?,?,?,0,'[]',9,1,'2026-08-02T00:00:00.000Z','ready','agent',?)`,
    );
    expect(() =>
      insert.run('t_new_b', 'pB', 'stB', 'B 项目同键任务', 'codex:1:a'),
    ).not.toThrow();

    // 同项目同键仍被拒
    expect(() => insert.run('t_dup_a', 'pA', 'stA', 'A 重复键', 'codex:1:a')).toThrow(
      /UNIQUE constraint failed/,
    );
    // 老数据一条不少
    expect((db.prepare('SELECT COUNT(*) c FROM tasks').get() as { c: number }).c).toBe(4);
    db.close();
  });

  it('★★ 顺序守卫：更早的老库升级后 done=1 的历史任务必须同时被归一为 status=done', () => {
    const db = legacyDbWithoutAgentColumns();
    expect(taskColumns(db), '夹具自检：升级前不该有 v0.6 列').not.toContain('status');

    createDb(db);

    const rows = db
      .prepare('SELECT id, done, status, source FROM tasks ORDER BY id')
      .all() as Array<{ id: string; done: number; status: string; source: string }>;
    // 若 migrateAgentIndex 跑在 migrateDoneToStatus 之前，user_version 会先变 4，
    // 后者看到 `4 >= 3` 直接 return → status 停留在补列默认值 'draft' → 本行红。
    expect(rows.find((r) => r.id === 't_done_1')!.status, '已完成的历史任务必须归一为 done').toBe(
      'done',
    );
    expect(rows.find((r) => r.id === 't_open_1')!.status, '未完成的历史任务保守留 draft').toBe(
      'draft',
    );
    // 两项迁移必须**同时**生效（这正是顺序约束的全部意义）
    expect(indexColumns(db, 'idx_tasks_external_id')).toEqual(['project_id', 'external_id']);
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    db.close();
  });

  it('老库升级幂等：重复 createDb 不重复改写数据、user_version 稳定', () => {
    const db = legacyDbWithoutAgentColumns();
    createDb(db);
    const first = db.prepare('SELECT id, status FROM tasks ORDER BY id').all();

    createDb(db);
    createDb(db);

    expect(db.prepare('SELECT id, status FROM tasks ORDER BY id').all()).toEqual(first);
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    db.close();
  });
});
