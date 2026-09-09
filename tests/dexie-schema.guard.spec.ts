/**
 * Dexie schema 守卫 + v1→v2 迁移（v0.6 追加项 / N24 / IN-05）。
 *
 * 三条防线：
 *   1. DEXIE_STORES 声明守卫：表集合完整（8 张一张不少）；version(2) 对其覆盖的每张表
 *      逐字包含 v1 全部索引——防「stores() 整体替换」静默丢索引（设计文档 §5.3 致命陷阱）；
 *   2. 真·升级链路（fake-indexeddb）：v1 库 → ChangxiaDatabase(v2) 升级后，schema.indexes
 *      同时含 v1 全部索引名与 v2 新增索引，数据行数不变且 done=true 的行 status==='done'；
 *   3. &externalId 唯一索引：重复幂等键被拒绝（ConstraintError），无数条空键行相安无事。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Dexie from 'dexie';

import { installFakeIndexedDB } from './setup';
import {
  ALL_STORE_NAMES,
  DEXIE_STORES,
  DEXIE_V1_STORES,
  DEXIE_V2_STORES,
  SCHEMA_VERSION,
} from '../src/core/schema/current';
import {
  ChangxiaDatabase,
  migrateMemberV2Row,
  migrateTaskV2Row,
} from '../src/core/repositories/local/dexie.database';

/** 索引串 → 索引名集合（'&externalId' → 'externalId'；'[a+b]' → '[a+b]'） */
function indexNames(spec: string): string[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^[&*+]+/, ''));
}

beforeAll(async () => {
  await installFakeIndexedDB();
});

describe('DEXIE_STORES 声明守卫（防 stores() 整体替换丢索引）', () => {
  it('表集合完整：8 张表一张不少、一张不多', () => {
    expect(Object.keys(DEXIE_STORES).sort()).toEqual([...ALL_STORE_NAMES].sort());
    expect(ALL_STORE_NAMES).toContain('stageLogs'); // 驼峰表名不被手滑改错
  });

  it('v2 声明只覆盖索引有变化的表（未列出的表继承 v1）', () => {
    expect(Object.keys(DEXIE_V2_STORES).sort()).toEqual(['members', 'tasks']);
  });

  it('v2 对覆盖的每张表逐字包含 v1 全部索引项', () => {
    for (const table of Object.keys(DEXIE_V2_STORES) as Array<keyof typeof DEXIE_V2_STORES>) {
      const v1Names = indexNames(DEXIE_V1_STORES[table]);
      const v2Names = indexNames(DEXIE_V2_STORES[table]!);
      for (const name of v1Names) {
        expect(v2Names, `${table} 丢了 v1 索引 ${name}`).toContain(name);
      }
    }
  });

  it('v2 新增索引齐全：&externalId（唯一）/ status / agentId / source；dependsOn 不建索引', () => {
    const v2 = DEXIE_V2_STORES.tasks!;
    expect(v2).toContain('&externalId');
    expect(indexNames(v2)).toEqual(
      expect.arrayContaining(['externalId', 'status', 'agentId', 'source']),
    );
    expect(indexNames(v2)).not.toContain('dependsOn'); // 本期无按依赖反查的持久化查询
    expect(DEXIE_V2_STORES.members).toContain('actorKind');
  });

  it('SCHEMA_VERSION 与声明版本号一致（防只改 stores 忘了 bump / 反之）', () => {
    expect(SCHEMA_VERSION).toBe(2);
  });
});

describe('单行迁移纯函数（表驱动，幂等）', () => {
  it('migrateTaskV2Row：done=true → status=done，其余新字段显式默认值', () => {
    const row: Record<string, unknown> = {
      id: 'tsk_1',
      projectId: 'p1',
      stageId: 's1',
      title: '量房',
      done: true,
      assigneeId: null,
      assigneeIds: ['a'],
      dueDate: null,
      orderIndex: 1,
      revision: 1,
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    migrateTaskV2Row(row);
    expect(row.status).toBe('done');
    expect(row.source).toBe('human');
    expect(row.agentId).toBeNull();
    expect(row.description).toBeNull();
    expect(row.dependsOn).toEqual([]);
    expect(row.artifacts).toEqual([]);
    expect(row.startAt).toBeNull();
    expect(row.claimedAt).toBeNull();
    // ★ externalId 用 delete 而非置 null（null 不是合法 IDB key）
    expect('externalId' in row).toBe(false);
  });

  it('migrateTaskV2Row：done=false → 保守置 draft（不置 ready，防灌满 Ready 队列）', () => {
    const row: Record<string, unknown> = { id: 'tsk_2', done: false };
    migrateTaskV2Row(row);
    expect(row.status).toBe('draft');
  });

  it('migrateTaskV2Row：幂等（已迁移行原样返回，不重复处理）', () => {
    const row: Record<string, unknown> = {
      id: 'tsk_3',
      done: false,
      status: 'review',
      source: 'agent',
    };
    migrateTaskV2Row(row);
    expect(row.status).toBe('review'); // 不被改写
    expect(row.dependsOn).toBeUndefined(); // 不被补默认值（幂等守卫直接返回）
  });

  it('migrateMemberV2Row：存量成员归入 human，agentKind=null，幂等', () => {
    const row: Record<string, unknown> = { id: 'mem_1', name: '许工' };
    migrateMemberV2Row(row);
    expect(row.actorKind).toBe('human');
    expect(row.agentKind).toBeNull();
    migrateMemberV2Row(row);
    expect(row.actorKind).toBe('human');
    const agent: Record<string, unknown> = { id: 'mem_2', actorKind: 'agent', agentKind: 'codex' };
    migrateMemberV2Row(agent);
    expect(agent.agentKind).toBe('codex'); // 已迁移行不被改写
  });
});

describe('真·升级链路（fake-indexeddb）', () => {
  const DB = 'guard-migration';

  /** 造一个 v1 老库（只声明 version(1)），写入 v1 形状的数据 */
  async function seedV1Db(): Promise<void> {
    await Dexie.delete(DB);
    const legacy = new Dexie(DB);
    legacy.version(1).stores(DEXIE_V1_STORES);
    await legacy.open();
    await legacy.table('tasks').bulkAdd([
      {
        id: 'tsk_v1_a',
        projectId: 'p1',
        stageId: 's1',
        title: '老任务A',
        done: true,
        assigneeId: null,
        assigneeIds: [],
        dueDate: null,
        orderIndex: 1,
        revision: 1,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'tsk_v1_b',
        projectId: 'p1',
        stageId: 's1',
        title: '老任务B',
        done: false,
        assigneeId: null,
        assigneeIds: [],
        dueDate: null,
        orderIndex: 2,
        revision: 1,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    await legacy.table('members').bulkAdd([
      {
        id: 'mem_v1_1',
        name: '许工',
        role: '主案',
        contact: null,
        avatarColor: '#3D6B5B',
        active: true,
        roleKind: 'admin',
        passwordHash: null,
        revision: 1,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    legacy.close();
  }

  it('v1 库升 v2：不丢数据、v1 索引全部健在、新索引就位', async () => {
    await seedV1Db();
    const db = new ChangxiaDatabase(DB);
    await db.open();

    // ① v1 索引一个不丢（整体替换陷阱的最终防线）。
    //    注意 schema.indexes 不含主键（id 是 inline primary key），比对时排除。
    const taskIndexNames = db.tasks.schema.indexes.map((i) => i.name);
    for (const name of indexNames(DEXIE_V1_STORES.tasks)) {
      if (name === 'id') continue; // 主键不在 indexes 列表内
      expect(taskIndexNames, `升级后丢了 v1 索引 ${name}`).toContain(name);
    }
    expect(taskIndexNames).toEqual(
      expect.arrayContaining(['externalId', 'status', 'agentId', 'source']),
    );
    const memberIndexNames = db.members.schema.indexes.map((i) => i.name);
    for (const name of indexNames(DEXIE_V1_STORES.members)) {
      if (name === 'id') continue;
      expect(memberIndexNames).toContain(name);
    }
    expect(memberIndexNames).toContain('actorKind');

    // ② 数据行数不变 + 状态归一
    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(2);
    const doneRow = tasks.find((t) => t.id === 'tsk_v1_a')!;
    expect(doneRow.status).toBe('done');
    expect(doneRow.done).toBe(true);
    expect(doneRow.source).toBe('human');
    const draftRow = tasks.find((t) => t.id === 'tsk_v1_b')!;
    expect(draftRow.status).toBe('draft');

    const members = await db.members.toArray();
    expect(members).toHaveLength(1);
    expect(members[0]!.actorKind).toBe('human');

    // ③ 空键 externalId 可并存无数条（唯一索引跳过非法 key）
    await db.tasks.bulkAdd([
      {
        id: 'tsk_v2_x',
        projectId: 'p1',
        stageId: 's1',
        title: '新任务X',
        done: false,
        assigneeId: null,
        assigneeIds: [],
        dueDate: null,
        orderIndex: 3,
        revision: 1,
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
      {
        id: 'tsk_v2_y',
        projectId: 'p1',
        stageId: 's1',
        title: '新任务Y',
        done: false,
        assigneeId: null,
        assigneeIds: [],
        dueDate: null,
        orderIndex: 4,
        revision: 1,
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    ]);
    await expect(db.open()).resolves.toBe(db); // 空键不炸唯一索引
    db.close();
  });

  it('&externalId 唯一索引：重复幂等键被拒绝（ConstraintError 可捕获）', async () => {
    await Dexie.delete(DB);
    const db = new ChangxiaDatabase(DB);
    await db.open();
    const base = {
      projectId: 'p1',
      stageId: 's1',
      title: '幂等任务',
      done: false,
      assigneeId: null,
      assigneeIds: [],
      dueDate: null,
      orderIndex: 1,
      revision: 1,
      updatedAt: '2026-08-01T00:00:00.000Z',
      status: 'draft',
      source: 'agent' as const,
      agentId: null,
      description: null,
      dependsOn: [],
      artifacts: [],
      startAt: null,
      claimedAt: null,
    };
    await db.tasks.bulkAdd([{ ...base, id: 'tsk_u1', externalId: 'codex:run-1:t1' }]);
    let conflictName: string | null = null;
    try {
      await db.tasks.add({ ...base, id: 'tsk_u2', externalId: 'codex:run-1:t1' });
    } catch (err) {
      conflictName = (err as { name?: string })?.name ?? 'unknown';
    }
    expect(conflictName).toBe('ConstraintError');
    db.close();
  });
});
