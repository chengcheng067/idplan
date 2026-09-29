/**
 * better-sqlite3 初始化：WAL 模式 + DDL 分段式执行。
 * schema 与 src/core/types/entities.ts 同构（见 schema.sql）。
 *
 * ★ createDb() 的执行顺序是硬约束（v0.6 · 设计文档 §6.2 / R1 缺陷修复；
 *   v0.7 §6.1 增补第 ④ 步）：
 *     ① 表结构段（-- @SECTION:TABLES）
 *     ② 幂等补列（V2 + V3 + V7 + V8 + V0.8 的 ALTER TABLE ADD COLUMN）
 *     ③ 数据归一（done=1 → status='done'，user_version ⇒ 3）
 *     ④ 索引换轨（idx_tasks_external_id ⇒ 复合唯一，user_version ⇒ 4）
 *     ⑤ 索引段（-- @SECTION:INDEXES）
 *   顺序错了有两种崩法：
 *     · ② 之前执行 ⑤ → 老库 `CREATE INDEX ... ON tasks(external_id)` 时列尚不存在
 *       → `no such column` → 服务启动即崩；
 *     · ④ 早于 ③ → 二者共用的 user_version 被抢先置 4，③ 的 `>= 3` 守卫恒真
 *       → 老库状态归一被静默跳过（界面不报错，只是历史完成任务退回 draft）。
 *   ⚠️ user_version 是**单一单调计数器**：任何新增列迁移都**不得**写它
 *      （v0.8 的 V08_COLUMN_MIGRATIONS 同理，见其注释）。
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type ChangxiaServerDb = Database.Database;

/** 打开（不建表） */
export function openDb(filePath = process.env.CHANGXIA_DB ?? join(__dirname, 'changxia.db')): ChangxiaServerDb {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * v2 列迁移：老库（v1 表结构）已存在时，CREATE TABLE IF NOT EXISTS 不会补列，
 * 会导致导入/写入报 "table X has no column named Y"。
 * 这里对已存在的表做幂等 ALTER TABLE ADD COLUMN，让老库自动升级到 v2，
 * 避免 NAS 升级场景必须删库重建（数据不可丢）。
 */
const V2_COLUMN_MIGRATIONS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  { table: 'projects', column: 'stage_preset_key', ddl: 'ALTER TABLE projects ADD COLUMN stage_preset_key TEXT' },
  {
    table: 'projects',
    column: 'stage_template_version',
    ddl: 'ALTER TABLE projects ADD COLUMN stage_template_version INTEGER NOT NULL DEFAULT 0',
  },
  {
    table: 'projects',
    column: 'schedule_basis',
    ddl: "ALTER TABLE projects ADD COLUMN schedule_basis TEXT NOT NULL DEFAULT 'calendar'",
  },
  { table: 'stages', column: 'template_key', ddl: 'ALTER TABLE stages ADD COLUMN template_key TEXT' },
  { table: 'stages', column: 'color_index', ddl: 'ALTER TABLE stages ADD COLUMN color_index INTEGER' },
  {
    table: 'tasks',
    column: 'assignee_ids',
    ddl: "ALTER TABLE tasks ADD COLUMN assignee_ids TEXT NOT NULL DEFAULT '[]'",
  },
  {
    table: 'members',
    column: 'role_kind',
    ddl: "ALTER TABLE members ADD COLUMN role_kind TEXT NOT NULL DEFAULT 'member'",
  },
  {
    table: 'members',
    column: 'password_hash',
    ddl: 'ALTER TABLE members ADD COLUMN password_hash TEXT',
  },
];

/**
 * v3 列迁移（v0.6 Agent 字段，11 项）：列声明与 schema.sql / entities.ts 键序一致
 * （tasks 9 列插在 due_date 后、order_index 前；members 2 列插在 password_hash 后）。
 */
const V3_COLUMN_MIGRATIONS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  { table: 'tasks', column: 'source', ddl: "ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'human'" },
  { table: 'tasks', column: 'external_id', ddl: 'ALTER TABLE tasks ADD COLUMN external_id TEXT' },
  { table: 'tasks', column: 'agent_id', ddl: 'ALTER TABLE tasks ADD COLUMN agent_id TEXT' },
  { table: 'tasks', column: 'status', ddl: "ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'" },
  { table: 'tasks', column: 'description', ddl: 'ALTER TABLE tasks ADD COLUMN description TEXT' },
  {
    table: 'tasks',
    column: 'depends_on',
    ddl: "ALTER TABLE tasks ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]'",
  },
  {
    table: 'tasks',
    column: 'artifacts',
    ddl: "ALTER TABLE tasks ADD COLUMN artifacts TEXT NOT NULL DEFAULT '[]'",
  },
  { table: 'tasks', column: 'start_at', ddl: 'ALTER TABLE tasks ADD COLUMN start_at TEXT' },
  { table: 'tasks', column: 'claimed_at', ddl: 'ALTER TABLE tasks ADD COLUMN claimed_at TEXT' },
  // v0.8.2：runId 溯源列（老库 ALTER 补列；新库由 schema.sql 声明）
  { table: 'tasks', column: 'run_id', ddl: 'ALTER TABLE tasks ADD COLUMN run_id TEXT' },
  {
    table: 'members',
    column: 'actor_kind',
    ddl: "ALTER TABLE members ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'human'",
  },
  { table: 'members', column: 'agent_kind', ddl: 'ALTER TABLE members ADD COLUMN agent_kind TEXT' },
];

/**
 * v0.7 侧栏折叠态增强列迁移（1 项）：`projects.short_label`。
 *
 * 只加列、**不填值**——NULL 即「未设置」，读取侧由 `resolveProjectShortLabel`
 * 回落项目名首字。因此**不需要**一次性数据迁移，也**不占** user_version：
 * user_version 是 `migrateDoneToStatus`(→3) 与 `migrateAgentIndex`(→4) 共用的
 * 单调计数器（见 V4_INDEX_MIGRATION_VERSION 注释），列迁移掺进去会把两者截胡。
 *
 * 与 V2/V3 两个列表一样，本表由 `createDb` 的 ② 步统一走幂等 ALTER，
 * 顺序无耦合（每条各自 PRAGMA table_info 判存在）。
 */
const V7_COLUMN_MIGRATIONS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  {
    table: 'projects',
    column: 'short_label',
    ddl: 'ALTER TABLE projects ADD COLUMN short_label TEXT',
  },
];

/**
 * v0.7 数据层冻结列迁移（1 项）：`tasks.task_no`（任务人读号）。
 *
 * 与 V7 同款：**只加列、不填值**。NULL 即「老数据/未分配」，展示侧由
 * `formatTaskNo` 回落 `—`，因此不需要一次性数据迁移。
 *
 * ★ **绝对不占 `user_version`**（§2.11）：user_version 是 `migrateDoneToStatus`(→3)
 *   与 `migrateAgentIndex`(→4) 共用的**单一单调计数器**。列迁移若掺进去，会把两者
 *   截胡 —— 具体说，若在此处 `db.pragma('user_version = 5')`，`migrateDoneToStatus`
 *   的 `>= 3` 守卫会永远为真而被跳过，老库「done=1 → status='done'」的归一**静默丢失**
 *   （界面不报错，只是历史已完成任务全部退回 draft）。
 *   列迁移靠 `PRAGMA table_info` 判存在，**天然幂等，不需要版本标记**。
 */
const V8_COLUMN_MIGRATIONS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  {
    table: 'tasks',
    column: 'task_no',
    ddl: 'ALTER TABLE tasks ADD COLUMN task_no INTEGER',
  },
];

/**
 * v0.8 数据层列迁移（3 项）：`projects.domain` / `projects.kind` / `stages.custom_color`。
 *
 * 与 V7/V8 同款：**只加列、不做一次性数据迁移**。
 *   · `domain`：NULL 即「未确认/老数据」→ 读取侧 `resolveProjectDomain` 按
 *     `stage_preset_key` 反查套餐 domain、再退 'indoor'（与改造前观感逐字一致）；
 *   · `kind`：DDL 自带 `NOT NULL DEFAULT 'human'` ⇒ 老库经本步 ALTER 后
 *     **存量行全部读出 'human'**，自动落回人类侧（PRD B1）。无需 UPDATE 语句；
 *   · `custom_color`：NULL 即「用内置色」→ 读取侧直接用 `color_index`。
 *
 * ★ **绝对不占 `user_version`**（同 V8 的理由，见其注释）：user_version 是
 *   `migrateDoneToStatus`(→3) 与 `migrateAgentIndex`(→4) 共用的单一单调计数器，
 *   列迁移掺进去会截胡两者的 `>= 自己那档` 守卫。列迁移靠 `PRAGMA table_info`
 *   判存在，天然幂等，**不需要版本标记**。
 *
 * ⚠️ 注意 SQLite 的 ALTER TABLE ADD COLUMN 对 `NOT NULL` 列的约束：
 *   带非常量 DEFAULT 才不允许；这里 `'human'` 是字面量常量，合法。
 */
const V09_COLUMN_MIGRATIONS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  {
    table: 'tasks',
    column: 'itinerary_date',
    ddl: 'ALTER TABLE tasks ADD COLUMN itinerary_date TEXT',
  },
];

const V08_COLUMN_MIGRATIONS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  {
    table: 'projects',
    column: 'domain',
    ddl: 'ALTER TABLE projects ADD COLUMN domain TEXT',
  },
  {
    table: 'projects',
    column: 'kind',
    ddl: "ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'human'",
  },
  {
    table: 'stages',
    column: 'custom_color',
    ddl: 'ALTER TABLE stages ADD COLUMN custom_color TEXT',
  },
];

/** 一次性数据迁移的版本标记（PRAGMA user_version）：>=3 表示已归一，跳过全表扫 */
const V3_DATA_MIGRATION_VERSION = 3;

/**
 * 索引换轨的版本标记（PRAGMA user_version）：>=4 表示 idx_tasks_external_id 已是复合索引。
 *
 * ★ user_version 是**单一单调计数器**，被 migrateDoneToStatus(→3) 与
 *   migrateAgentIndex(→4) 共用。两者守卫都是 `>= 自己那档`，因此**调用顺序构成语义**：
 *   见 createDb 内 migrateAgentIndex 的调用点注释。
 */
const V4_INDEX_MIGRATION_VERSION = 4;

/** 幂等补列：逐条检查 PRAGMA table_info，缺才 ALTER */
function migrateColumns(db: ChangxiaServerDb, list: ReadonlyArray<{ table: string; column: string; ddl: string }>): void {
  for (const m of list) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === m.column)) {
      db.exec(m.ddl);
    }
  }
}

/**
 * 一次性数据迁移：老库补出的 status 全是默认 'draft'，但 done 可能为 1。
 * 幂等（user_version 打标，避免每次启动全表扫）：只改「status 仍是默认值且 done=1」的行。
 * 放在 migrateColumns 之后、索引之前执行。
 */
function migrateDoneToStatus(db: ChangxiaServerDb): void {
  const version = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  if (version >= V3_DATA_MIGRATION_VERSION) return;
  db.exec("UPDATE tasks SET status='done' WHERE done=1 AND status='draft'");
  db.pragma(`user_version = ${V3_DATA_MIGRATION_VERSION}`);
}

/**
 * v0.7 §6.1 索引换轨（O1）：`idx_tasks_external_id` 的唯一性从**全局**收窄到
 * **项目内**（`external_id` → `(project_id, external_id)`）。
 *
 * 为什么必须单独写一个迁移函数（而不是靠索引段的 IF NOT EXISTS）：
 * 索引**定义**变了但**名字没变**，`CREATE UNIQUE INDEX IF NOT EXISTS` 见到同名索引
 * 已存在会直接跳过 —— 于是老库里永远还是旧的全局唯一索引，而它正是 O1
 * 「跨项目同幂等键互相误伤/误改」的根因。必须先 DROP 再 CREATE。
 *
 * 幂等：以 PRAGMA user_version 打标（>= 4 直接返回），避免每次启动都重建索引。
 *
 * ★★ 调用顺序是硬约束：必须在 `migrateDoneToStatus` **之后**执行。
 *    两个迁移共用同一个 user_version 单调计数器，而 `migrateDoneToStatus` 的守卫是
 *    `>= 3`。若本函数先跑并把 user_version 置为 4，`migrateDoneToStatus` 就会看到
 *    `4 >= 3` 而**跳过**「done=1 → status='done'」的全表归一 —— 老库的状态迁移被
 *    静默丢掉，且界面完全不报错（只是历史已完成任务全部退回 draft）。
 *    这条顺序由 tests/server.external-id-index.spec.ts 的「老库升级」用例守着。
 *
 * 历史数据安全性（设计文档 §6.4）：旧的全局唯一已禁止跨项目重复 external_id，
 * 故重建为复合唯一**不可能产生冲突行**，无需回滚式检测。
 */
function migrateAgentIndex(db: ChangxiaServerDb): void {
  const version = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  if (version >= V4_INDEX_MIGRATION_VERSION) return;
  // ① 先删旧索引：名字相同、列形不同，不删则下面的 IF NOT EXISTS 永不生效
  db.exec('DROP INDEX IF EXISTS idx_tasks_external_id');
  // ② 重建为复合唯一索引（与 schema.sql 索引段逐字同源，便于人工比对）
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_external_id
       ON tasks(project_id, external_id) WHERE external_id IS NOT NULL`,
  );
  // ③ 打标（与 migrateDoneToStatus 共用同一个单调计数器）
  db.pragma(`user_version = ${V4_INDEX_MIGRATION_VERSION}`);
}

/** 从分段 DDL 中取某一段（schema.sql 用行首 `-- @SECTION:NAME` 标记分隔） */
export function sectionOf(ddl: string, name: string): string {
  // 行锚定匹配：文件头说明性注释里可能出现标记字样（如「用 -- @SECTION:TABLES 与
  // -- @SECTION:INDEXES 切分」），只有独立成行的标记才是真正的分段边界。
  const re = new RegExp(`^-- @SECTION:${name}[ \\t]*$`, 'm');
  const m = re.exec(ddl);
  if (!m) {
    throw new Error(`schema.sql 缺少分段标记 -- @SECTION:${name}`);
  }
  const rest = ddl.slice(m.index + m[0].length);
  const nextSection = /^-- @SECTION:/m.exec(rest);
  return (nextSection ? rest.slice(0, nextSection.index) : rest).trim();
}

/**
 * 执行 DDL（幂等）：★ 四段式 —— 表结构 → 补列 → 数据归一 → 索引换轨 → 建索引。
 * 顺序错了，老库升级会在索引 DDL 上抛 `no such column`（见文件头说明），
 * 或在 user_version 上互相截胡（见 migrateAgentIndex 注释）。
 */
export function createDb(db: ChangxiaServerDb): void {
  const ddl = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  // ① 只执行「表结构」段
  db.exec(sectionOf(ddl, 'TABLES'));
  // ② 幂等补列（v2 既有 8 项 + v3 新增 11 项 + v0.7 新增 2 项：projects.short_label、tasks.task_no
  //    + v0.8 新增 3 项：projects.domain / projects.kind / stages.custom_color）
  //    ⚠️ 本步必须早于 ⑤（索引段）：新列若被索引段引用，顺序颠倒会在建索引时
  //       `no such column` → 服务启动即崩（见文件头「顺序错了有两种崩法」）。
  //    v0.8 三列**不进任何索引**，但保持同一注册处便于审计。
  migrateColumns(db, [
    ...V2_COLUMN_MIGRATIONS,
    ...V3_COLUMN_MIGRATIONS,
    ...V7_COLUMN_MIGRATIONS,
    ...V8_COLUMN_MIGRATIONS,
    ...V09_COLUMN_MIGRATIONS,
    ...V08_COLUMN_MIGRATIONS,
  ]);
  // ③ 一次性数据迁移（done=1 → status='done'，user_version 打标为 3）
  migrateDoneToStatus(db);
  // ④ v0.7：idx_tasks_external_id 换轨为复合唯一索引（user_version 打标为 4）
  //    ★ 必须在 ③ 之后：两者共用 user_version，本步置 4 会让 ③ 的 `>= 3` 守卫永远为真
  migrateAgentIndex(db);
  // ⑤ 列齐备、索引换轨完成后建索引（新库由本段首次建出复合索引；
  //    老库的第 ④ 步已建好同名复合索引，本段是 IF NOT EXISTS 空操作）
  db.exec(sectionOf(ddl, 'INDEXES'));
}
