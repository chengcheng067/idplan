/**
 * BUG-02 · 迁移前备份闸门（L1）· `detectLocalDbVersion` 的版本号归一。
 *
 * ── 缺陷（实测复现）──
 * Dexie 把 `verno` **×10** 写进 IndexedDB（为了支持 `version(1.5)` 这类小数版本）：
 *     version(1) → IDB 10    version(2) → IDB 20    version(3) → IDB 30
 * 而 `detectLocalDbVersion` 的首选路径 `indexedDB.databases()` 拿到的是**原始 IDB 版本**，
 * 直接 return，没有 `/10` 归一。
 *
 * 闸门判据（`repository.provider`）是 `verno !== null && verno < SCHEMA_VERSION`，于是：
 *   v1 库：`10 < 2` → false
 *   v2 库：`20 < 3` → false
 * → 在支持 `indexedDB.databases()` 的环境（**Chromium / Electron = 全部三种部署形态**），
 *   迁移前备份闸门**从不弹出**，老库升级一律静默执行，**没有任何回滚凭据**。
 *   自 v0.6 引入至今一直如此。
 *
 * 回落路径（无 `databases()`）同样错：它 `return probe.verno`，而 probe 只声明了 v1，
 * 故对**任何已存在的库**都恒返回 1 —— 两条路径语义还不一致。
 *
 * ── 本文件的两条纪律 ──
 * 1. **两条路径必须返回同一语义**（Dexie verno）。故几乎所有用例都跑两遍：
 *    有 `databases()` / 屏蔽掉 `databases()`。只测一条路径 = 下一个人只会修一条。
 * 2. 判据本身取自**唯一出处** `needsPreMigrationBackup()`，测试不另抄一份
 *    `verno < SCHEMA_VERSION` —— 否则断言与被测代码是两份真相，闸门改了测试不会红。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import Dexie from 'dexie';

import { installFakeIndexedDB } from './setup';
import {
  DEXIE_STORES,
  DEXIE_V1_STORES,
  DEXIE_V2_STORES,
  SCHEMA_VERSION,
} from '../src/core/schema/current';
import {
  ChangxiaDatabase,
  detectLocalDbVersion,
  dumpLegacyTables,
  needsPreMigrationBackup,
} from '../src/core/repositories/local/dexie.database';
import { validateBackupJson } from '../src/core/services/backup.service';

beforeAll(async () => {
  await installFakeIndexedDB();
});

/** 某个 verno 对应的「全量索引声明」（用于手工造各版本的老库） */
function storesUpTo(verno: 1 | 2 | 3): Record<string, string> {
  if (verno === 1) return { ...DEXIE_V1_STORES };
  if (verno === 2) return { ...DEXIE_V1_STORES, ...DEXIE_V2_STORES };
  return { ...DEXIE_STORES };
}

/** 造一个处于指定 verno 的库（含一行可辨识数据），返回库名 */
async function seedLibraryAt(verno: 1 | 2 | 3): Promise<string> {
  const name = `gate-lib-v${verno}`;
  await Dexie.delete(name);
  const db = new Dexie(name);
  db.version(1).stores(DEXIE_V1_STORES);
  if (verno >= 2) db.version(2).stores(DEXIE_V2_STORES);
  if (verno >= 3) db.version(3).stores({ tasks: DEXIE_STORES.tasks });
  await db.open();
  await db.table('projects').add({
    id: `p-v${verno}`,
    name: `v${verno} 项目`,
    type: 'dining',
    address: '',
    clientName: '',
    plannedStartAt: '2026-08-01',
    plannedEndAt: '2026-10-01',
    status: 'active',
    revision: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
  });
  db.close();
  return name;
}

/**
 * 屏蔽 `indexedDB.databases()` 以强制走回落路径。
 * 用赋值（而非 delete）是为了连带覆盖原型上的同名方法。
 */
async function withoutDatabases<T>(fn: () => Promise<T>): Promise<T> {
  const idx = globalThis.indexedDB as unknown as { databases?: unknown };
  const original = idx.databases;
  idx.databases = undefined;
  try {
    return await fn();
  } finally {
    idx.databases = original;
  }
}

/** 某库是否存在（不复用被测代码，直接用 IDB 自己的清单） */
async function libraryExists(name: string): Promise<boolean> {
  const idx = globalThis.indexedDB as unknown as {
    databases?: () => Promise<Array<{ name?: string }>>;
  };
  const list = await idx.databases!();
  return list.some((d) => d.name === name);
}

describe('detectLocalDbVersion：版本号必须归一为 Dexie verno（两条路径各跑一遍）', () => {
  it('无库 → null（两条路径一致）', async () => {
    const name = 'gate-nothing-here';
    await Dexie.delete(name);
    expect(await detectLocalDbVersion(name)).toBeNull();
    expect(await withoutDatabases(() => detectLocalDbVersion(name))).toBeNull();
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
  ] as const)('Dexie verno %i → 返回 %i（首选路径）', async (verno, expected) => {
    const name = await seedLibraryAt(verno);
    expect(await detectLocalDbVersion(name)).toBe(expected);
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
  ] as const)('Dexie verno %i → 返回 %i（回落路径）', async (verno, expected) => {
    const name = await seedLibraryAt(verno);
    expect(await withoutDatabases(() => detectLocalDbVersion(name))).toBe(expected);
  });

  it('★ 两条路径对同一库必须返回同一个值（v1/v2/v3 全覆盖）', async () => {
    for (const verno of [1, 2, 3] as const) {
      const name = await seedLibraryAt(verno);
      const primary = await detectLocalDbVersion(name);
      const fallback = await withoutDatabases(() => detectLocalDbVersion(name));
      expect(fallback, `v${verno} 库：两条路径语义必须一致`).toBe(primary);
      expect(primary).toBe(verno);
    }
  });

  it('★ 探测不存在的库不得把它建出来（回落路径也不能有副作用）', async () => {
    const name = 'gate-should-not-be-created';
    await Dexie.delete(name);
    expect(await withoutDatabases(() => detectLocalDbVersion(name))).toBeNull();
    // 若回落路径先裸开 indexedDB.open(name)（不带版本号），IDB 会把库建成 v1 空库，
    // 于是「全新环境」下次启动就会看到 verno=1 → 误弹备份闸门。故这里必须守住。
    expect(await libraryExists(name), '探测一个不存在的库不应创建它').toBe(false);
  });

  it('★ 探测不改变既有库的版本与数据', async () => {
    const name = await seedLibraryAt(2);
    await detectLocalDbVersion(name);
    await withoutDatabases(() => detectLocalDbVersion(name));
    expect(await detectLocalDbVersion(name), '探测后版本不变').toBe(2);
    const probe = new Dexie(name);
    probe.version(1).stores(DEXIE_V1_STORES);
    probe.version(2).stores(DEXIE_V2_STORES);
    await probe.open();
    expect(await probe.table('projects').count(), '探测后数据不丢').toBe(1);
    probe.close();
  });
});

describe('闸门判据 needsPreMigrationBackup（唯一出处，测试不另抄一份）', () => {
  it('★ v2 库必须弹闸门（本 BUG 的核心：修复前这里是 false）', async () => {
    const name = await seedLibraryAt(2);
    const verno = await detectLocalDbVersion(name);
    expect(verno, '先确认探测值已归一').toBe(2);
    expect(
      needsPreMigrationBackup(verno),
      'Dexie v2 库要升到 v3 → 必须先导出回滚凭据',
    ).toBe(true);
  });

  it('v1 库必须弹闸门（v0.6 起就该如此，修复前同样是 false）', async () => {
    const name = await seedLibraryAt(1);
    expect(needsPreMigrationBackup(await detectLocalDbVersion(name))).toBe(true);
  });

  it('已是当前版本 → 不弹（无需备份）', async () => {
    const name = await seedLibraryAt(SCHEMA_VERSION as 3);
    const verno = await detectLocalDbVersion(name);
    expect(verno).toBe(SCHEMA_VERSION);
    expect(needsPreMigrationBackup(verno)).toBe(false);
  });

  it('全新环境（无库）→ 不弹（直接建库，无数据可备份）', () => {
    expect(needsPreMigrationBackup(null)).toBe(false);
  });

  it('★ 三条路径组合的判据回归：只有「库存在且版本更旧」才弹', async () => {
    const cases: Array<[number | null, boolean]> = [
      [null, false],
      [1, true],
      [2, true],
      [3, false],
      // 比当前更高的版本号（理论上不该出现，但降级安装会）：不弹，
      // 由 Dexie 自己去抛 VersionError，而不是在这里假装要升级。
      [4, false],
    ];
    for (const [verno, expected] of cases) {
      expect(needsPreMigrationBackup(verno), `verno=${String(verno)}`).toBe(expected);
    }
  });
});

describe('L1 回滚凭据真的可用（闸门的下游）', () => {
  /** 一份最小的、**先经 zod 归一**的 v2 老库数据（夹具不合规会在这里早失败） */
  function legacyV2Data() {
    const now = '2026-08-01T00:00:00.000Z';
    const pkg = validateBackupJson({
      meta: { app: 'changxia', schemaVersion: 2, exportedAt: now },
      data: {
        projects: [
          {
            id: 'p-legacy',
            name: '老项目',
            type: 'dining',
            address: '成都',
            clientName: '甲方',
            contractAmount: 1000,
            signedAt: '2026-08-01T00:00:00.000Z',
            plannedStartAt: '2026-08-01',
            plannedEndAt: '2026-10-01',
            coverColor: 'clay',
            stagePresetKey: 'indoor_full',
            stageTemplateVersion: 1,
            scheduleBasis: 'calendar',
            status: 'active',
            revision: 1,
            updatedAt: now,
          },
        ],
        stages: [
          {
            id: 's-legacy',
            projectId: 'p-legacy',
            orderIndex: 1,
            templateKey: 'indoor.proposal',
            colorIndex: 1,
            name: '提案',
            ratioPercent: 30,
            startAt: '2026-08-01',
            endAt: '2026-08-10',
            status: 'in_progress',
            ownerId: null,
            visible: true,
            resourcePath: null,
            revision: 1,
            updatedAt: now,
          },
        ],
        tasks: [
          {
            id: 't-legacy',
            projectId: 'p-legacy',
            stageId: 's-legacy',
            title: '老任务',
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
            updatedAt: now,
          },
        ],
        members: [
          {
            id: 'm-legacy',
            name: '许工',
            role: '主案',
            contact: null,
            avatarColor: '#3D6B5B',
            active: true,
            roleKind: 'admin',
            actorKind: 'human',
            agentKind: null,
            revision: 1,
            updatedAt: now,
          },
        ],
        assignments: [],
        logs: [],
        contracts: [],
        settings: [],
      },
    });
    return pkg.data;
  }

  it('★ 从 v2 老库导出的备份必须是合法备份包（否则 L1 拿到的是张废纸）', async () => {
    const name = 'gate-credential-v2';
    await Dexie.delete(name);
    const db = new Dexie(name);
    db.version(1).stores(DEXIE_V1_STORES);
    db.version(2).stores(DEXIE_V2_STORES);
    await db.open();

    const data = legacyV2Data(); // 结构不合法会在这里早失败（夹具自检）
    for (const table of ['projects', 'stages', 'tasks', 'members'] as const) {
      await db.table(table).bulkAdd(data[table]);
    }
    db.close();

    const dumped = await dumpLegacyTables(name);
    expect(dumped.data.projects).toHaveLength(1);
    expect(dumped.data.tasks).toHaveLength(1);
    expect(dumped.meta.schemaVersion, '回滚凭据须标旧版号，旧版应用才导得回去').toBe(2);
    // 终极校验：这份凭据必须能被真实 zod schema 接受（否则回滚时导不回来）
    expect(() => validateBackupJson(dumped)).not.toThrow();
  });
});
