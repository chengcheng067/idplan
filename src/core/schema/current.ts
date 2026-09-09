/**
 * 本地数据库 schema 唯一声明（v0.6 追加项 · 集中化）。
 *
 * 为什么要集中：Dexie 的 `version(n).stores()` 对**列出的表是整体替换，不是增量合并**
 * （设计文档 §5.3 致命陷阱）。索引串散落在各版本声明里，任何一处漏抄 v1 原串，
 * 都会静默丢掉既有索引——不报错，但未来任何 `.where()` 会悄悄退化为全表扫描。
 * 把「v1 全量 / v2 增量 / 当前全量」三份声明放进同一个文件，配守卫测试
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
 */
export const SCHEMA_VERSION = 2;

/** 全部表名（与 dexie.database.ts 的 Table 声明一一对应，备份整库替换遍历用） */
export const ALL_STORE_NAMES = [
  'projects',
  'stages',
  'tasks',
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
export const DEXIE_V1_STORES: Readonly<Record<StoreName, string>> = {
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
 * 当前版本（SCHEMA_VERSION）的全量索引声明 = v1 ∪ v2。
 * 守卫测试用它断言：① 表集合完整（8 张，一张不少）；
 * ② v2 对其覆盖的每张表都**逐字包含** v1 的全部索引项（防整体替换丢索引）。
 */
export const DEXIE_STORES: Readonly<Record<StoreName, string>> = {
  ...DEXIE_V1_STORES,
  ...DEXIE_V2_STORES,
};
