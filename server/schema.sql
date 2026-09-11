-- 《长夏》SQLite DDL（与 src/core/types/entities.ts 同构）
-- 约定：时间一律 TEXT 存储 UTC ISO 8601 字符串；金额为元整数 REAL/INTEGER。
--
-- ★ 文件分段（v0.6 · 设计文档 §6.2 / R1 顺序缺陷修复）：
--   本文件被 `-- @SECTION:TABLES` 与 `-- @SECTION:INDEXES` 两个标记切成两段，
--   server/db.ts 的 createDb() 按「① 表结构 → ② 幂等补列 → ③ 索引」三段式执行。
--   为什么：对已存在的老库，CREATE TABLE IF NOT EXISTS 不会补列；若索引 DDL 与
--   表 DDL 一起先执行，`CREATE INDEX ... ON tasks(external_id)` 会因列尚不存在而
--   抛 `no such column` → 服务启动即崩。v2 迁移侥幸没踩中（那批新列恰好无索引），
--   v3 的新列（external_id/status/agent_id）都要建索引，缺陷必然触发。
--   索引 DDL 一律放 INDEXES 段；TABLES 段内禁止出现 CREATE INDEX。

-- @SECTION:TABLES

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  contract_amount INTEGER,
  signed_at TEXT,
  planned_start_at TEXT NOT NULL,
  planned_end_at TEXT NOT NULL,
  cover_color TEXT,
  -- v0.7 侧栏折叠态增强：折叠态项目方块简称。
  -- NULL = 老数据/未设置 → 读时回落「项目名首字」，故本列**无需**数据迁移（只加列不填值）。
  -- 键序与 entities.Project 一致：cover_color 之后、阶段字段之前。
  short_label TEXT,
  -- v2 阶段自定义字段（与 backup schemaVersion=2 / entities.Project 同构）
  stage_preset_key TEXT,
  stage_template_version INTEGER NOT NULL DEFAULT 0,
  schedule_basis TEXT NOT NULL DEFAULT 'calendar',
  status TEXT NOT NULL DEFAULT 'active',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  -- v2：阶段自定义字段（键序与 entities.Stage / stageSchema 一致：order_index 之后、name 之前）
  -- CHECK 上限由 9 放宽到 99：前端备份 schema（backup.service.stageSchema）已放宽到 1..99，
  -- 自定义阶段组合（MAX_STAGE_COUNT=12）与老项目迁移场景需要 >9 的序号。
  order_index INTEGER NOT NULL CHECK (order_index BETWEEN 1 AND 99),
  template_key TEXT,
  color_index INTEGER,
  name TEXT NOT NULL,
  ratio_percent REAL NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  owner_id TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  resource_path TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  stage_id TEXT NOT NULL REFERENCES stages(id),
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  assignee_id TEXT,
  -- v0.3 参与人全集：JSON 数组串（SQLite 无数组类型），与 entities.Task.assigneeIds 对应。
  -- 读取时反序列化为 string[]；写入前序列化。缺失/空 → '[]'。
  assignee_ids TEXT NOT NULL DEFAULT '[]',
  due_date TEXT,
  -- v0.6 Agent 字段（键序与 entities.Task 一致：due_date 之后、order_index 之前）。
  -- depends_on / artifacts 为 JSON 文本列；artifacts 是对象数组，
  -- 序列化必须走 server/lib/json-columns.ts 的 serializeJson（绝不可 filter(string)）。
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

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  contact TEXT,
  avatar_color TEXT NOT NULL DEFAULT '#3D6B5B',
  active INTEGER NOT NULL DEFAULT 1,
  -- v0.2 角色种类：'admin' | 'member'，与 entities.Member.roleKind 对应。
  role_kind TEXT NOT NULL DEFAULT 'member',
  -- v0.6 密码系统：密码哈希（格式 saltHex:hashHex），NULL=无密码（管理员决定成员可有/可无）。
  password_hash TEXT,
  -- v0.6 Agent 身份（键序与 entities.Member 一致：password_hash 之后、revision 之前）。
  -- agent_kind 为开放字符串（workbuddy/deepseek/codex/claude/…），人类成员为 NULL。
  actor_kind TEXT NOT NULL DEFAULT 'human',
  agent_kind TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- append-only
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  member_id TEXT,
  action TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- append-only
CREATE TABLE IF NOT EXISTS stage_logs (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  old_start_at TEXT,
  new_start_at TEXT,
  old_end_at TEXT,
  new_end_at TEXT,
  reason TEXT,
  operator_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  file_name TEXT,
  raw_text_digest TEXT NOT NULL,
  parsed_result_json TEXT NOT NULL,
  confirmed_payload_json TEXT,
  created_by_manual INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- @SECTION:INDEXES

CREATE INDEX IF NOT EXISTS idx_stages_project ON stages(project_id, order_index);
CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage_id, done);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
-- v0.6 新增索引（三段式执行到本段时列已齐备）：
-- external_id 用 UNIQUE + 部分索引（WHERE external_id IS NOT NULL）——幂等键的
-- 最后一道防线是 DB 层唯一约束；部分索引允许无数条 NULL（人工任务无幂等键）。
--
-- ★ v0.7 §6.1（O1）：唯一性从「全局」收窄为「项目内」——复合 (project_id, external_id)。
--   理由：全局唯一会让 A 项目的 Agent 用同一个幂等键更新自己的任务时，撞上 B 项目的
--   同名键而失败或误改（跨项目互相干扰）。幂等键的作用域天然就是「一次 Agent 运行的
--   一个项目」。
--   ⚠️ 老库升级**不能**指望本行的 IF NOT EXISTS：索引定义变了但名字没变，SQLite 见到
--      同名索引已存在会直接跳过 → 新列形永不生效，老库仍是全局唯一索引。
--      重建由 server/db.ts 的 `migrateAgentIndex()` 负责（DROP 旧的 + CREATE 新的 +
--      PRAGMA user_version 打标）。本行负责新库的首次创建。
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_external_id
  ON tasks(project_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_members_actor ON members(actor_kind);
-- append-only 流水索引
CREATE INDEX IF NOT EXISTS idx_assignments_task ON assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_logs_stage ON stage_logs(stage_id);
CREATE INDEX IF NOT EXISTS idx_logs_project ON stage_logs(project_id);
