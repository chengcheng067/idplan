/**
 * 本地数据库 schema 唯一声明（v0.6 追加项 · 集中化）。
 *
 * 为什么要集中：Dexie 的 `version(n).stores()` 对**列出的表是整体替换，不是增量合并**
 * （设计文档 §5.3 致命陷阱）。索引串散落在各版本声明里，任何一处漏抄 v1 原串，
 * 都会静默丢掉既有索引——不报错，但未来任何 `.where()` 会悄悄退化为全表扫描。
 * 把「v1 全量 / v2 增量 / v3 增量 / 当前全量」四份声明放进同一个文件，配守卫测试
 * （tests/dexie-schema.guard.spec.ts）做逐字比对，才防得住这种静默回归。
 *
 * ★ 版本号只能升不能降（Dexie 限制）：本文件每次 bump 后，`DEXIE_V{N}_STORES`
 *   必须原样保留为不可变的历史声明，**永不删除、永不改写**。
 */

/** IndexedDB 库名（迁移前备份闸门需要用名字探测，故集中声明） */
export const DB_NAME = 'changxia';

/**
 * 当前 Dexie schema 版本。
 * v1 → v2：Task 增 9 字段索引（&externalId / status / agentId / source）+ Member 增 actorKind。
 * v2 → v3（v0.7 §6.1 / O1）：Task 的唯一索引换轨 `&externalId` → `&[projectId+externalId]`，
 *   使幂等键的作用域从「全局」收窄为「项目内」。
 * v3 → v4（v0.9 旅游二期）：新增 itineraries 表，按 `[projectId+date]` 唯一。
 *
 * ⚠️ 本常量与备份包的 `BACKUP_SCHEMA_VERSION`（恒为 3）是**两个独立维度**：
 *   前者是 IndexedDB 库版本，后者是备份文件格式版本。本版只动前者。
 */
export const SCHEMA_VERSION = 4;

/** 全部表名（与 dexie.database.ts 的 Table 声明一一对应，备份整库替换遍历用） */
export const ALL_STORE_NAMES = [
  'projects',
  'stages',
  'tasks',
  'itineraries',
  'members',
  'assignments',
  'stageLogs',
  'contracts',
  'settings',
] as const;

export type StoreName = (typeof ALL_STORE_NAMES)[number];

/**
 * v1 索引声明（历史版本，**逐字冻结，一个字符都不要改**）。
 * 说明：tasks 里的 `done` / `[stageId+done]` 是死索引（布尔不是合法 IDB key），
 * 但保留它们是刻意的——删除会让 v2 与 v1 差异变大、增加迁移风险，且无害。
 */
export const DEXIE_V1_STORES: Readonly<Record<Exclude<StoreName, 'itineraries'>, string>> = {
  projects: 'id, status, name, updatedAt',
  stages: 'id, projectId, [projectId+orderIndex], updatedAt',
  tasks: 'id, projectId, stageId, assigneeId, done, [stageId+done], dueDate',
  members: 'id, active, name',
  assignments: 'id, taskId, projectId, memberId, createdAt',
  stageLogs: 'id, stageId, projectId, createdAt',
  contracts: 'id, projectId, createdAt',
  settings: 'key',
};

/**
 * v2 相对 v1 **有索引变化**的表（version(2).stores() 只允许列这些表；
 * 未列出的表自动继承 v1 定义，写进来反而是多余且易漂移）。
 *
 * ★ tasks 串 = v1 原串逐字重复 + 新增项。新增只加：
 *   `&externalId`（唯一，幂等键约束）/ `status` / `agentId` / `source`。
 *   `dependsOn` 刻意**不建 multiEntry 索引**（本期无按依赖反查的持久化查询，
 *   加了是死索引且拖慢写入——设计文档 §5.2）。
 */
export const DEXIE_V2_STORES: Readonly<Partial<Record<StoreName, string>>> = {
  tasks:
    'id, projectId, stageId, assigneeId, done, [stageId+done], dueDate, ' + // ← v1 原样
    '&externalId, status, agentId, source', // ← v2 新增
  members: 'id, active, name, actorKind', // v1 + actorKind
};

/**
 * v3 相对 v2 **有索引变化**的表：只有 tasks。
 * （members 在 v3 无变化 → 不列，自动继承 v2 定义。多列反而是易漂移的冗余声明。）
 *
 * ★★ R2 铁律：本串必须是 v2 串的**逐字重写**，只把 `&externalId` 换成
 *    `&[projectId+externalId]`，其余索引项（含顺序）一个字都不能动。
 *    Dexie 对列出的表整体替换索引声明：漏抄任一索引**不报错**，只在未来
 *    `.where('status')` 时静默退化为全表扫描。守卫测试用「数组逐字相等
 *    （含顺序）」而非松散的 contains 断言，漏抄/多写/顺序漂移都会红。
 *
 * ★ 行为差异（O1 的目的）：v2 下「A 项目与 B 项目不能用同一个 externalId」
 *   （全局唯一 → 跨项目互相误伤/误改）；v3 下各项目独立，互不干扰。
 */
export const DEXIE_V3_STORES: Readonly<Partial<Record<StoreName, string>>> = {
  tasks:
    'id, projectId, stageId, assigneeId, done, [stageId+done], dueDate, ' + // ← v1+v2 原样
    '&[projectId+externalId], status, agentId, source', // ← 仅此一处：&externalId → &[projectId+externalId]
};

/** v4 新增旅游每日行程表；项目内日期唯一，避免改期/重复补卡造出两张同日卡。 */
export const DEXIE_V4_STORES: Readonly<Partial<Record<StoreName, string>>> = {
  itineraries: 'id, projectId, date, &[projectId+date], updatedAt',
};

/**
 * 当前版本（SCHEMA_VERSION）的全量索引声明 = v1 ∪ v2 ∪ v3。
 * 守卫测试用它断言：① 表集合完整（8 张，一张不少）；
 * ② 每个增量版本对其覆盖的每张表都**逐字包含**该表在全部历史版本里的索引项
 *    （防整体替换丢索引）。
 * 注：tasks 的最终形态取自 v3（后展开者胜），这正是「当前全量」应有的语义。
 */
export const DEXIE_STORES: Readonly<Record<StoreName, string>> = {
  ...DEXIE_V1_STORES,
  ...DEXIE_V2_STORES,
  ...DEXIE_V3_STORES,
  itineraries: DEXIE_V4_STORES.itineraries as string,
};
