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
  DEXIE_V3_STORES,
  SCHEMA_VERSION,
} from '../../schema/current';

/**
 * Dexie 数据库声明（local adapter 唯一持久化出口）。
 * 业务代码禁止 import dexie —— 只有本目录下的适配器允许（铁律 4）。
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ★★★ 铁律：`version(n).stores({...})` 对列出的表是【整体替换】，不是增量合并。  │
 * │     每个 version(n) 只列「相对上一版索引有变化」的表；未列出的表自动继承旧定义——  │
 * │     **绝对不要**把未变化的表也写进新版本。                                   │
 * │     凡是列出的表，其索引串必须包含该表在**所有历史版本**里的全部索引项         │
 * │     （v1 原串逐字重复 + 新增项）。漏写一个索引 = 静默丢索引：不报错，           │
 * │     但未来任何 `.where()` 都会悄悄退化为全表扫描。                            │
 * │     索引串的唯一出处：`src/core/schema/current.ts`（配守卫测试）。            │
 * │     历史版本号一律写**字面量**，不得写成 SCHEMA_VERSION 变量（见 v2 处注释）。  │
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
    // ★ 版本号写**字面量 2** 而不是 SCHEMA_VERSION：本行是**历史声明**，而
    //   SCHEMA_VERSION 会随版本推进而变。若此处用变量，下一次 bump 到 3 时这一行
    //   会变成 `version(3).stores(DEXIE_V2_STORES)` —— 既把 v2 的升级事务（
    //   migrateTaskV2Row / migrateMemberV2Row，老库数据归一的唯一入口）整段删掉，
    //   又用 v2 的旧索引串顶替 v3 声明（静默丢「复合唯一」）。字面量 + 守卫测试里
    //   断言 `new ChangxiaDatabase().verno === SCHEMA_VERSION`，两者合起来才防得住。
    this.version(2)
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

    // ── v3（v0.7 §6.1 / O1）：唯一性换轨 `&externalId` → `&[projectId+externalId]` ──
    // 只重声明 tasks（members 在 v3 无变化 → 不列，自动继承 v2 定义）。
    // 刻意**不写** `.upgrade()`：本版 schema 变更只动索引、不动任何行数据，
    // 索引重建由 Dexie 按新 stores 自动完成（空 upgrade 回调只会招来「忘了写内容」的误读）。
    // 两端都不用搬家：
    //   · agent 任务：externalId 必有值 → 按 [projectId, externalId] 唯一；
    //   · human 任务：externalId 是 undefined（不写键，见 migrateTaskV2Row 注释）→
    //     IndexedDB 不索引 undefined 值 → 根本不进复合索引，不会因 [projectId, undefined]
    //     重复而抛 ConstraintError。
    // 升级事务抛异常 → Dexie 整体回滚，库保持 v2（三级回滚的 L0）。
    this.version(3).stores(DEXIE_V3_STORES);
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
 * Dexie 把 verno **×10** 写进 IndexedDB 的 version 字段——为了支持 `version(1.5)`
 * 这类小数版本（1.5 → 15）。实测映射：verno 1/2/3 → IDB 10/20/30。
 *
 * ★ BUG-02 的根因就是漏了这一步：从 IDB 直接读到的版本号必须先 ÷10 才能与
 *   `SCHEMA_VERSION` 比较。漏了归一 → 闸门判据 `10 < 2` / `20 < 3` 恒为 false
 *   → 迁移前备份闸门（L1）**从不弹出**，老库升级没有回滚凭据。
 */
const IDB_VERSION_STRIDE = 10;

/**
 * 原始 IDB version → Dexie verno。
 *
 * ★ 本文件两条读取路径（`databases()` / 带外 open）的**唯一归一出口**。
 *   两条路径都必须经过它，否则就会重现 BUG-02 的另一半症状：
 *   一条返回 `10`（原始值未归一）、另一条返回 `1`（probe 声明值）——
 *   同一个问题两个错答案，下一个人只会修一条。
 *
 * 取 `Math.round` 而非直接 `/10`：前者是 Dexie 内部 `Math.round(verno * 10)` 的
 * 精确逆运算，对本项目只会声明的整数版本完全等值，且能把任何浮点噪声收成整数。
 * （唯一差异在理论上的小数版本：verno 1.5 → raw 15 → 本函数得 2 而非 1.5。
 * 本项目不声明小数版本，且闸门只做 `<` 比较，故不影响判据。）
 */
function toDexieVerno(rawIdbVersion: number): number {
  return Math.round(rawIdbVersion / IDB_VERSION_STRIDE);
}

/**
 * 带外读原始 IDB 版本：**不传 version** → 对已存在的库 = 按当前版本打开，不触发升级。
 * 实测无副作用：读后库的版本与数据均不变（raw 仍 10；随后的正常升级照常成功）。
 *
 * ⚠️ 调用方**必须**先用 `Dexie.exists` 确认库存在：`indexedDB.open(name)` 对
 *   **不存在**的库会把它**建出来**（版本 1）。实测确认该副作用真实存在——一旦发生，
 *   「全新环境」下次启动就会看到 verno=1 而误弹备份闸门。
 */
function readRawIdbVersion(dbName: string): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const req = globalThis.indexedDB.open(dbName);
    req.onsuccess = () => {
      const raw = req.result.version;
      req.result.close();
      resolve(typeof raw === 'number' ? raw : null);
    };
    req.onerror = () => resolve(null);
    // 不传版本号不触发升级，正常不会 blocked；留个出口以免 Promise 永不落定
    req.onblocked = () => resolve(null);
  });
}

/**
 * 探测本地 Dexie 库的**当前版本（Dexie verno 语义）**。
 *
 * 返回：
 *   - `null`   → 库不存在（全新环境，直接建当前版本库，**不弹闸门**）；
 *   - `1..N`   → 库已存在的版本号（**Dexie verno 语义**，不是 IDB 原始值）。
 *                与 `SCHEMA_VERSION` 比较请用 `needsPreMigrationBackup()`。
 *
 * 两条读取路径（性能/兼容性不同，**语义必须完全一致**）：
 *   ① 首选 `indexedDB.databases()`：Chromium/Electron 均支持，不创建库、不触发升级；
 *   ② 回落 `Dexie.exists` 守卫 + 不带版本号 `indexedDB.open()` 读 `result.version`。
 *
 * ★ 两条路径都经 `toDexieVerno()` 归一 —— 这是 BUG-02 的修复核心。
 * ★ 回落路径**不能**沿用「只声明 v1 的临时 Dexie 实例 + `probe.verno`」：
 *   实测 `verno` 返回的是**声明值**（恒 1），对 v2/v3 库同样报 1 —— 又一个错答案。
 *   原先据此写的 `VersionError` 分支也是死的：实测在 v2 库上以「只声明 v1」的实例
 *   open() **不会抛** VersionError，而是静默打开并报 verno=1。故该分支一并删除。
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
      // ★ 这里拿到的是**原始 IDB 版本（×10）**，必须归一（BUG-02）
      return found?.version != null ? toDexieVerno(found.version) : null;
    } catch {
      // 个别实现的 databases() 可能抛错 → 走回落
    }
  }

  // ② 回落：先确认库存在（Dexie.exists 实测不会创建库），再带外读原始版本
  try {
    const exists = await Dexie.exists(dbName);
    if (!exists) return null;
  } catch {
    return null;
  }

  const raw = await readRawIdbVersion(dbName);
  return raw === null ? null : toDexieVerno(raw);
}

/**
 * 迁移前备份闸门（L1）判据：**库已存在且版本比我方当前版本旧** → 必须先导出回滚凭据。
 *
 * ★ 唯一出处：UI（`di/repository.provider`）与测试都调用本函数，
 *   **不允许**任何地方再复写一遍 `verno !== null && verno < SCHEMA_VERSION`。
 *   判据抄成两份，就会出现「闸门改了、测试不会红」这种最坏组合。
 *
 * 比当前版本**更高**（降级安装）→ false：交由 Dexie 自己抛 VersionError 暴露，
 * 不在这里假装「要升级」——那会引导用户做一次方向相反的导出。
 *
 * 签名写成类型谓词 `verno is number`：调用方进入闸门分支后，`verno` 由编译器
 * 收窄为非空数字，于是「显示实际探测到的版本号」的文案**不可能**渲染出 `vnull`。
 */
export function needsPreMigrationBackup(verno: number | null): verno is number {
  return verno !== null && verno < SCHEMA_VERSION;
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
