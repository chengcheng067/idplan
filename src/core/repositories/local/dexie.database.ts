import Dexie, { Table } from 'dexie';

import type { BackupPackage } from '../../types/dto';
import type {
  AssignmentLog,
  ContractRecord,
  Member,
  Project,
  Setting,
  Stage,
  StageLog,
  Task,
} from '../../types/entities';
import { ChangxiaError, ChangxiaErrorCode, MemberActorKind, TaskStatus } from '../../types/enums';
import {
  ALL_STORE_NAMES,
  DB_NAME,
  DEXIE_V1_STORES,
  DEXIE_V2_STORES,
  SCHEMA_VERSION,
} from '../../schema/current';

/**
 * Dexie 数据库声明（local adapter 唯一持久化出口）。
 * 业务代码禁止 import dexie —— 只有本目录下的适配器允许（铁律 4）。
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ★★★ 铁律：`version(n).stores({...})` 对列出的表是【整体替换】，不是增量合并。  │
 * │     version(2) 只列「索引有变化」的表；未列出的表自动继承 v1 定义——          │
 * │     **绝对不要**把未变化的表也写进新版本。                                   │
 * │     凡是列出的表，其索引串必须包含该表在**所有历史版本**里的全部索引项         │
 * │     （v1 原串逐字重复 + 新增项）。漏写一个索引 = 静默丢索引：不报错，           │
 * │     但未来任何 `.where()` 都会悄悄退化为全表扫描。                            │
 * │     索引串的唯一出处：`src/core/schema/current.ts`（配守卫测试）。            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export class ChangxiaDatabase extends Dexie {
  public projects!: Table<Project, string>;
  public stages!: Table<Stage, string>;
  public tasks!: Table<Task, string>;
  public members!: Table<Member, string>;
  public assignments!: Table<AssignmentLog, string>;
  public stageLogs!: Table<StageLog, string>;
  public contracts!: Table<ContractRecord, string>;
  public settings!: Table<Setting, string>;

  constructor(name = DB_NAME) {
    super(name);

    // ── v1：历史声明，字符串逐字冻结在 schema/current.ts，一个字符都不要改 ──
    this.version(1).stores(DEXIE_V1_STORES);

    // ── v2：只重声明「索引有变化」的两张表（tasks / members）──
    // 升级事务里跑单行迁移纯函数；抛异常 → Dexie 整体回滚，库保持 v1（三级回滚的 L0）。
    this.version(SCHEMA_VERSION)
      .stores(DEXIE_V2_STORES)
      .upgrade(async (tx) => {
        await tx
          .table('tasks')
          .toCollection()
          .modify((t: Record<string, unknown>) => {
            migrateTaskV2Row(t);
          });
        await tx
          .table('members')
          .toCollection()
          .modify((m: Record<string, unknown>) => {
            migrateMemberV2Row(m);
          });
      });
  }
}

/**
 * 单行迁移：tasks v1 → v2（纯函数、幂等、可表驱动单测）。
 *
 * 与 backup.service 的 zod `.default()` 口径必须一致（键序铁律：本函数补的键
 * 按 §3.1 序 9–17 顺序写入，老行追加到对象尾部——Dexie 行键序不影响 roundtrip，
 * 因为备份导出经 zod 归一重建，见 T04 spec）。
 *
 * 状态归一口径（PRD §4.4 步骤 3）：`done===true → 'done'`；否则**保守置 'draft'**
 * 而非 'ready'——ready 语义是「可被 Agent 认领的下一步」，把存量人工任务全置 ready
 * 会瞬间灌满 Ready 队列。
 *
 * ★ `externalId` 用 `delete` 而非置 `null`：`null` 不是合法 IDB key，显式存在的
 *   null 键在 `&externalId` 唯一索引下的行为因浏览器实现而异；不写该键才是安全态。
 *   读取侧由 `t.externalId ?? null` 归一，序列化（备份）侧由 zod `.default(null)` 归一。
 */
export function migrateTaskV2Row(t: Record<string, unknown>): void {
  // 幂等守卫：已迁移过的行直接返回（重复升级 / 升级中途重放场景）
  if (typeof t.status === 'string') return;

  t.source = t.source ?? 'human';
  if (t.externalId === null || t.externalId === undefined) delete t.externalId;
  t.agentId = t.agentId ?? null;
  t.status = t.done === true ? TaskStatus.Done : TaskStatus.Draft;
  t.description = t.description ?? null;
  t.dependsOn = Array.isArray(t.dependsOn) ? t.dependsOn : [];
  t.artifacts = Array.isArray(t.artifacts) ? t.artifacts : [];
  t.startAt = t.startAt ?? null;
  t.claimedAt = t.claimedAt ?? null;
}

/**
 * 单行迁移：members v1 → v2（纯函数、幂等、可表驱动单测）。
 * 存量成员全部归入 human（Agent 身份只能由用户新建）。
 */
export function migrateMemberV2Row(m: Record<string, unknown>): void {
  if (typeof m.actorKind === 'string') return;
  m.actorKind = MemberActorKind.Human;
  m.agentKind = m.agentKind ?? null;
}

/** 打开失败时的统一错误归一 */
export async function openDatabase(): Promise<ChangxiaDatabase> {
  const db = new ChangxiaDatabase();
  try {
    await db.open();
    return db;
  } catch (err) {
    db.close();
    throw new ChangxiaError(
      ChangxiaErrorCode.Storage,
      '本地数据库打开失败，请检查浏览器隐私模式或存储空间。',
      err,
    );
  }
}

/**
 * 迁移前版本探测（备份闸门的第一步，设计文档 §5.4）。
 *
 * 返回：
 *   - `null`   → 库不存在（全新环境，直接建当前版本库，**不弹闸门**）；
 *   - `1`      → 老库待升级（**必须先备份再 open**）；
 *   - `>= 2`   → 已是当前版本（不弹闸门）。
 *
 * 实现：优先 `indexedDB.databases()`（Chromium/Electron 均支持，且**不会创建库**）；
 * 不可用时回落「Dexie.exists 确认存在 + 只声明 v1 的临时实例读 verno 后 close」。
 */
export async function detectLocalDbVersion(dbName: string = DB_NAME): Promise<number | null> {
  const anyIndexedDB = globalThis.indexedDB as
    | { databases?: () => Promise<Array<{ name?: string; version?: number }>> }
    | undefined;

  // ① 首选：databases()（不创建库、不触发升级）
  if (typeof anyIndexedDB?.databases === 'function') {
    try {
      const list = await anyIndexedDB.databases();
      const found = list.find((d) => d.name === dbName);
      return found ? (found.version ?? null) : null;
    } catch {
      // 个别实现的 databases() 可能抛错 → 走回落
    }
  }

  // ② 回落：先确认库存在（Dexie.exists 不会创建库），再开只声明 v1 的临时实例
  try {
    const exists = await Dexie.exists(dbName);
    if (!exists) return null;
  } catch {
    return null;
  }

  const probe = new Dexie(dbName);
  try {
    probe.version(1).stores(DEXIE_V1_STORES);
    await probe.open();
    return probe.verno;
  } catch (err) {
    // 已是更高版本的库对「只声明 v1」会抛 VersionError → 说明 ≥ 当前版本
    if ((err as { name?: string })?.name === 'VersionError') {
      return SCHEMA_VERSION;
    }
    return null;
  } finally {
    probe.close();
  }
}

/** 表名清单（备份整库替换时遍历用；单一出处见 schema/current.ts） */
export const ALL_TABLE_NAMES = ALL_STORE_NAMES;

export type AllTableName = (typeof ALL_TABLE_NAMES)[number];

/**
 * 读取**升级前**的老库（v1）整表快照——迁移前备份闸门（L1/L2 回滚凭据）的数据源。
 *
 * 为什么不能直接用 BackupService：备份闸门必须发生在 `db.open()`（触发升级）**之前**，
 * 此时正式仓储还不存在。这里开一个只声明 v1 的临时 Dexie 实例（对已是 v1 的库
 * open() 不会触发任何升级），把八张表原样读出。
 *
 * `meta.schemaVersion` 刻意标 **2**（而非当前 3）：这份备份是「回滚凭据」，必须能被
 * **旧版应用**（只接受 1|2）导回。v1 原始行本就没有 v0.6 新字段，与新版本号匹配。
 */
export async function dumpLegacyTables(dbName: string = DB_NAME): Promise<BackupPackage> {
  const probe = new Dexie(dbName);
  try {
    probe.version(1).stores(DEXIE_V1_STORES);
    await probe.open();
    const readAll = async (name: string): Promise<unknown[]> => probe.table(name).toArray();
    const [projects, stages, tasks, members, assignments, logs, contracts, settings] =
      await Promise.all([
        readAll('projects') as Promise<Project[]>,
        readAll('stages') as Promise<Stage[]>,
        readAll('tasks') as Promise<Task[]>,
        readAll('members') as Promise<Member[]>,
        readAll('assignments') as Promise<AssignmentLog[]>,
        readAll('stageLogs') as Promise<StageLog[]>,
        readAll('contracts') as Promise<ContractRecord[]>,
        readAll('settings') as Promise<Setting[]>,
      ]);
    return {
      meta: {
        app: 'changxia',
        // 迁移前快照 → 标 v2：旧版应用可导回（L2 回滚路径的硬前提）
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
      },
      data: { projects, stages, tasks, members, assignments, logs, contracts, settings },
    };
  } catch (err) {
    throw new ChangxiaError(ChangxiaErrorCode.Storage, '迁移前备份读取失败。', err);
  } finally {
    probe.close();
  }
}
