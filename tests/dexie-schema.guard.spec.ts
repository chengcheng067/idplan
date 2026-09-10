/**
 * Dexie schema 守卫 + v1→v2/v3 迁移（v0.6 追加项 / N24 / IN-05；v0.7 §6.1 扩展）。
 *
 * 三条防线：
 *   1. DEXIE_STORES 声明守卫：表集合完整（8 张一张不少）；version(n) 对其覆盖的每张表
 *      逐字包含 v1 全部索引——防「stores() 整体替换」静默丢索引（设计文档 §5.3 致命陷阱）；
 *   2. 真·升级链路（fake-indexeddb）：老库 → ChangxiaDatabase(当前版) 升级后，schema.indexes
 *      同时含历史全部索引名与新增索引，数据行数不变且 done=true 的行 status==='done'；
 *   3. 唯一索引：重复幂等键被拒绝（ConstraintError），无数条空键行相安无事。
 *
 * ── v0.7 · 阶段C（O1 复合唯一索引）追加 ────────────────────────────────────────
 * 本版唯一的 schema 变更：`&externalId`（全局唯一）→ `&[projectId+externalId]`
 * （项目内唯一），使「A 项目更新同名幂等键」不再误改 B 项目任务。
 *
 * ★ 本文件最后一条 `R2` 用例是**本阶段唯一能拦住「漏写索引」的机制**：
 *   Dexie 的 `version(3).stores({tasks})` 对该表是**整体替换**。若有人手抄 v3 串时
 *   漏掉 `assigneeId` / `dueDate` / `status` 等任一项，Dexie **不报错**，只在未来
 *   `.where('status')` 时静默退化为全表扫描。故 v3 串必须与本文件给出的
 *   「v2 串 + 唯一一处替换」**逐字数组相等**（含顺序），而非松散的 contains。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Dexie from 'dexie';

import { installFakeIndexedDB } from './setup';
import {
  ALL_STORE_NAMES,
  DEXIE_STORES,
  DEXIE_V1_STORES,
  DEXIE_V2_STORES,
  DEXIE_V3_STORES,
  SCHEMA_VERSION,
} from '../src/core/schema/current';
import {
  ChangxiaDatabase,
  migrateMemberV2Row,
  migrateTaskV2Row,
} from '../src/core/repositories/local/dexie.database';
import type { Task } from '../src/core/types/entities';

/** 索引串 → 索引名集合（'&externalId' → 'externalId'；'[a+b]' → '[a+b]'） */
function indexNames(spec: string): string[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^[&*+]+/, ''));
}

/**
 * 索引串 → 索引项**原始**列表（保留 `&`/`*` 前缀与 `[a+b]` 形状，顺序不变）。
 *
 * 为什么需要它（而不是复用 indexNames）：`indexNames` 会剥掉唯一性前缀，
 * 于是 `&externalId` 与 `externalId` 长得一样——而 v3 的**全部意义**正是
 * 「唯一性从单列挪到复合列」，用 indexNames 断言等于把要验的东西抹平。
 */
function rawItems(spec: string): string[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 对称差集（用于断言「两个索引串的差异恰好只有这些项」） */
function symmetricDiff(a: readonly string[], b: readonly string[]): string[] {
  const sa = new Set(a);
  const sb = new Set(b);
  return [
    ...a.filter((x) => !sb.has(x)),
    ...b.filter((x) => !sa.has(x)),
  ].sort();
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

  it('v3 声明只覆盖索引有变化的表（仅 tasks —— members 在 v3 无变化）', () => {
    expect(Object.keys(DEXIE_V3_STORES).sort()).toEqual(['tasks']);
  });

  it('★ R2 铁律：v3 串 === v2 串 + 【唯一】一处替换 &externalId → &[projectId+externalId]', () => {
    const v1Tasks = 'id, projectId, stageId, assigneeId, done, [stageId+done], dueDate';
    const v2Tasks = DEXIE_V2_STORES.tasks!;
    const v3Tasks = DEXIE_V3_STORES.tasks!;

    // ── 断言方式刻意用「数组逐字相等（含顺序）」而非 expect(v3).toContain(...) ──
    // contains 只能查出「漏了 A」，查不出「漏了 A 但加了 B」「顺序被顺手重排」。
    // 下面把 v2 的原始索引项列表做**唯一一处**替换，要求 v3 与该期望**完全相同**，
    // 于是：漏抄任一索引 → 红；多写死索引 → 红；顺序漂移 → 红。
    const expectedV3 = rawItems(v2Tasks).map((item) =>
      item === '&externalId' ? '&[projectId+externalId]' : item,
    );
    expect(rawItems(v3Tasks)).toEqual(expectedV3);

    // ── 双重表述（人可读）：差异**恰好**是旧/新唯一索引这两项，一个不多一个不少 ──
    expect(symmetricDiff(rawItems(v2Tasks), rawItems(v3Tasks))).toEqual([
      '&[projectId+externalId]',
      '&externalId',
    ]);

    // ── v1 的索引一个都不能丢（跨两级继承的最终防线）──
    for (const name of indexNames(v1Tasks)) {
      expect(indexNames(v3Tasks), `v3 丢了 v1 索引 ${name}`).toContain(name);
    }
    // 写死期望串，防止「v2/v3 一起被改错」时上面两条自洽地通过
    expect(v3Tasks.replace(/\s+/g, ' ')).toBe(
      'id, projectId, stageId, assigneeId, done, [stageId+done], dueDate, ' +
        '&[projectId+externalId], status, agentId, source',
    );
  });

  it('★ v3 唯一性已换轨：复合索引就位、旧全局唯一索引彻底消失', () => {
    const v3Tasks = DEXIE_V3_STORES.tasks!;
    // 新唯一索引必须在（且必须带 & 前缀 = 真·唯一约束，不是普通索引）
    expect(rawItems(v3Tasks)).toContain('&[projectId+externalId]');
    // 旧的全局唯一索引必须消失 —— 它正是 O1「跨项目误改」的根因。
    // ☆ 这一行就是本阶段的核心断言：若有人只加复合索引却没删旧索引，
    //   跨项目同键仍会被旧索引拒绝 → 本行红。
    expect(rawItems(v3Tasks)).not.toContain('&externalId');
    // v2 的非唯一扩展索引一个不少
    expect(indexNames(v3Tasks)).toEqual(
      expect.arrayContaining(['status', 'agentId', 'source']),
    );
  });

  it('SCHEMA_VERSION 与声明版本号一致（防只改 stores 忘了 bump / 反之）', () => {
    expect(SCHEMA_VERSION).toBe(3);
    // bump 到几，就必须存在对应版本的增量声明（防「改了版本号却没写声明」）
    expect(DEXIE_V3_STORES).toBeDefined();
  });

  it('★ 版本接线守卫：类里实际声明的最高版本 === SCHEMA_VERSION', () => {
    // 上一行只保证「常量是 3」；本行保证「类真的声明到了 3」。
    // 二者缺一，就出现设计文档点名的静默陷阱：
    //   · 只改 SCHEMA_VERSION 不加 version(3) → 常量说 3、库里永远停在 2（本行红）
    //   · 只加 version(3) 不改 SCHEMA_VERSION → 迁移前备份闸门的比较基准错位（上一行红）
    // 注意：只读 verno（声明值），不需要 open()，因此不会碰 IndexedDB。
    expect(new ChangxiaDatabase('guard-verno-probe').verno).toBe(SCHEMA_VERSION);
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

  /**
   * 造一行 **v2 形状**的任务（含 v0.6 九字段）。
   * `externalId` 只在显式给出时写键——与生产写入路径同口径（human 任务不写该键）。
   */
  function v2Row(overrides: {
    id: string;
    projectId: string;
    title: string;
    externalId?: string;
  }): Record<string, unknown> {
    const row: Record<string, unknown> = {
      id: overrides.id,
      projectId: overrides.projectId,
      stageId: 's1',
      title: overrides.title,
      done: false,
      assigneeId: null,
      assigneeIds: [],
      dueDate: null,
      source: overrides.externalId ? 'agent' : 'human',
      status: 'ready',
      agentId: null,
      description: null,
      dependsOn: [],
      artifacts: [],
      startAt: null,
      claimedAt: null,
      orderIndex: 1,
      revision: 1,
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    if (overrides.externalId) row.externalId = overrides.externalId;
    return row;
  }

  /**
   * 造一个 **v2 老库**（声明 v1+v2）并写入 v2 形状数据。
   *
   * ★ 夹具的硬约束：v2 的 `&externalId` 是**全局**唯一，故三行的 externalId 必须
   *   互不相同——这本身就是「升级前跨项目同键被禁止」的事实证据。升级后同一程序
   *   会往里加一个跨项目重复键并**期望成功**，两相对照才构成 O1 的验收。
   */
  async function seedV2Db(): Promise<void> {
    await Dexie.delete(DB);
    const legacy = new Dexie(DB);
    legacy.version(1).stores(DEXIE_V1_STORES);
    legacy.version(2).stores(DEXIE_V2_STORES);
    await legacy.open();
    await legacy.table('tasks').bulkAdd([
      v2Row({ id: 'tsk_v2_p1', projectId: 'p1', title: 'P1 的幂等任务', externalId: 'codex:run-1:t1' }),
      v2Row({ id: 'tsk_v2_p1_human', projectId: 'p1', title: 'P1 的人工任务' }),
      v2Row({ id: 'tsk_v2_p1b', projectId: 'p1b', title: 'P1B 的另一个键', externalId: 'codex:run-1:t2' }),
    ]);
    legacy.close();
  }

  it('v1 库升到当前版：不丢数据、v1 索引全部健在、当前版索引就位', async () => {
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
    // ★ v0.7（O1）本条断言为何改了：升级终点已从 v2 变成 v3，tasks 的唯一索引
    //   换轨为复合索引，因此**不再**存在名为 externalId 的索引。
    //   v1 索引健在（上面那条）+ 复合唯一索引就位（下面两条）+ 旧全局唯一索引绝迹，
    //   三者合起来才是「升级后索引完整」的完整表述。
    expect(taskIndexNames).toEqual(
      expect.arrayContaining(['status', 'agentId', 'source']),
    );
    expect(taskIndexNames).toContain('[projectId+externalId]');
    expect(taskIndexNames, '旧全局唯一索引必须已被替换掉').not.toContain('externalId');
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

  it('★ v2→v3 真实升级：数据零丢失、索引换轨、跨项目同幂等键从此各建一行（O1 验收点）', async () => {
    await seedV2Db();
    const db = new ChangxiaDatabase(DB);
    await db.open();
    expect(db.verno).toBe(3);

    // ── ① 数据零丢失：v3 无逐行迁移，三行必须原样健在 ──
    const rows = await db.tasks.toArray();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.id).sort()).toEqual(['tsk_v2_p1', 'tsk_v2_p1_human', 'tsk_v2_p1b']);
    const agentRow = rows.find((r) => r.id === 'tsk_v2_p1')!;
    expect(agentRow.title).toBe('P1 的幂等任务');
    expect(agentRow.externalId).toBe('codex:run-1:t1');
    expect(agentRow.status, 'v2 行已归一，v3 不得再改写').toBe('ready');
    // human 行仍然**不带 externalId 键** —— 这是它不撞复合唯一索引的根本原因
    const humanRow = rows.find((r) => r.id === 'tsk_v2_p1_human')!;
    expect('externalId' in humanRow).toBe(false);

    // ── ② 索引换轨（不是「新增」，是「替换」）──
    const names = db.tasks.schema.indexes.map((i) => i.name);
    expect(names).toContain('[projectId+externalId]');
    expect(names, '旧全局唯一索引必须消失').not.toContain('externalId');

    // ── ③ ★ O1 的验收点：升级前做不到的事，升级后必须做到 ──
    //    另一个项目用**同一个** externalId 建任务，不再被唯一约束拒绝。
    //    夹具自检：升级前的 v2 库确实拒得掉（seedV2Db 只能放进不同的键），
    //    故本行不是「本来就绿」的摆设。
    await expect(
      db.tasks.add(
        v2Row({
          id: 'tsk_v3_p2',
          projectId: 'p2',
          title: 'P2 的同键任务',
          externalId: 'codex:run-1:t1',
        }) as unknown as Task,
      ),
    ).resolves.toBeDefined();

    // ── ④ 同项目同键仍然被唯一约束拒绝（复合索引的「唯一」二字不能丢）──
    let conflictName: string | null = null;
    try {
      await db.tasks.add(
        v2Row({
          id: 'tsk_v3_dup',
          projectId: 'p1',
          title: 'P1 重复键',
          externalId: 'codex:run-1:t1',
        }) as unknown as Task,
      );
    } catch (err) {
      conflictName = (err as { name?: string })?.name ?? 'unknown';
    }
    expect(conflictName).toBe('ConstraintError');

    // ── ⑤ 升级后 human 行仍可继续批量新增（不进唯一索引，互不冲突）──
    await db.tasks.bulkAdd([
      v2Row({ id: 'tsk_v3_h1', projectId: 'p1', title: '人工甲' }) as unknown as Task,
      v2Row({ id: 'tsk_v3_h2', projectId: 'p1', title: '人工乙' }) as unknown as Task,
    ]);
    expect(await db.tasks.count()).toBe(6);

    db.close();
  });

  it('★ v3 复合唯一索引：同项目同幂等键被拒绝（ConstraintError 可捕获）', async () => {
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
