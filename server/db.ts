/**
 * better-sqlite3 初始化：WAL 模式 + DDL 三段式执行。
 * schema 与 src/core/types/entities.ts 同构（见 schema.sql）。
 *
 * ★ createDb() 的执行顺序是硬约束（v0.6 · 设计文档 §6.2 / R1 缺陷修复）：
 *     ① 表结构段（-- @SECTION:TABLES）
 *     ② 幂等补列（V2 + V3 的 ALTER TABLE ADD COLUMN）
 *     ③ 索引段（-- @SECTION:INDEXES）
 *   顺序错了，老库（v1/v2 表结构）执行 `CREATE INDEX ... ON tasks(external_id)`
 *   时列尚不存在 → `no such column` → 服务启动即崩。
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
  {
    table: 'members',
    column: 'actor_kind',
    ddl: "ALTER TABLE members ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'human'",
  },
  { table: 'members', column: 'agent_kind', ddl: 'ALTER TABLE members ADD COLUMN agent_kind TEXT' },
];

/** 一次性数据迁移的版本标记（PRAGMA user_version）：>=3 表示已归一，跳过全表扫 */
const V3_DATA_MIGRATION_VERSION = 3;

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
 * 执行 DDL（幂等）：★ 三段式 —— 表结构 → 补列 → 索引。
 * 顺序错了，老库升级会在索引 DDL 上抛 `no such column`（见文件头说明）。
 */
export function createDb(db: ChangxiaServerDb): void {
  const ddl = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  // ① 只执行「表结构」段
  db.exec(sectionOf(ddl, 'TABLES'));
  // ② 幂等补列（v2 既有 8 项 + v3 新增 11 项）
  migrateColumns(db, [...V2_COLUMN_MIGRATIONS, ...V3_COLUMN_MIGRATIONS]);
  // ③ 一次性数据迁移（done=1 → status='done'，user_version 打标）
  migrateDoneToStatus(db);
  // ④ 列齐备后才建索引
  db.exec(sectionOf(ddl, 'INDEXES'));
}
