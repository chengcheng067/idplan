/**
 * 工作区注册表（多工作区 · NAS 版 · 批 1 地基）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这个概念是什么
 * ══════════════════════════════════════════════════════════════════════
 * 一台 NAS 上可有多个「工作区」（= 一家公司/团队），业务数据完全隔离。
 * 实现方式是**每区一个独立 SQLite 文件** + **一张注册表库**：
 *
 *     <dataDir>/workspaces.db      ← 注册表（只放 workspaces 一张表）
 *     <dataDir>/changxia.db        ← ws-default 的业务库（= 今天那个文件，一个字节不搬）
 *     <dataDir>/ws-<id>.db         ← 新建工作区的业务库（schema 与今天逐字相同）
 *
 * 每个业务库都跑**同一个** `createDb()`（`server/db.ts`），所以「一个区的库」
 * 和「今天整台机器的库」在表结构上没有任何区别 —— 这是「零迁移」的实现基础：
 * 老库不需要搬数据，它**本来就**是一个合格的工作区业务库，只需在注册表里登记一行。
 *
 * 与桌面版的同源关系：`src/lib/workspace-registry.ts` 的存量迁移口径是
 * 「把现有库整体认作 ws-default、名『未命名工作室』、数据零迁移」。本文件的
 * `seedDefaultWorkspace()` 是**同一口径的服务端实现**（id 常量、默认名逐字相同）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 本批（批 1）的边界：零行为变化
 * ══════════════════════════════════════════════════════════════════════
 * 本批**只建地基**：注册表建出来、默认区播种好、模块函数齐备且有单测。
 * **不改** register 签名、**不改**任何请求路由 —— 也就是说服务端今天收的请求
 * 还是一个库、一套行为。把请求按 `X-Workspace-Id` 分流到对应库是**批 2** 的事。
 * 因此本文件的全部能力在批 2 落地前是 **inert 的**（唯一的实际效果：启动时多建
 * 一个 `workspaces.db` 并在里面写一行 ws-default）—— 这是刻意的安全垫。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 三条硬约束（踩了会静默丢数据 / 静默串味）
 * ══════════════════════════════════════════════════════════════════════
 * ① **绝不写 `user_version`**。它是 `migrateDoneToStatus`(→3) 与
 *    `migrateAgentIndex`(→4) 共用的**单一单调计数器**（见 `server/db.ts` 文件头）。
 *    本文件对业务库的唯一动作是调一次 `createDb()`（它自己按规矩管计数器），
 *    对注册表库只跑 `schema.sql` 的 REGISTRY 段 —— 注册表库上**永不调用**
 *    `createDb()`（那会在注册表库里长出 13 张永空业务表并推进它的 user_version）。
 * ② **不存在的工作区 id 必须 404，绝不回落默认区**。回落 = 把 A 公司的请求
 *    静默写进 B 公司的库（串味），且用户看不到任何报错。
 * ③ **不带 `X-Workspace-Id` 必须照常工作**（回落 ws-default）。老客户端/老脚本
 *    不知道这个 header 的存在，它们的行为一个字都不能变 —— 这是升级平滑的硬前提。
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createDb, sectionOf } from './db';
import { resolveDataDir, REGISTRY_DB_FILENAME } from './lib/data-paths';
import { hashPassword, verifyPassword } from './lib/password-hash';
// 角色哨兵值的**唯一出处**（`src/core/types/role-sentinel.ts`；零 import 零 DOM 零 Node，
// 服务端 tsconfig 已显式纳入 `../src/core/types/**`）。**不**在这里抄一份 `'负责人'` 字面量
// —— 那样「改哨兵值」只改一处就会出现「界面新成员叫 Owner、服务端建的 Owner 叫负责人」。
import { ROLE_SENTINELS } from '../src/core/types/role-sentinel';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type ChangxiaServerDb = Database.Database;

/** 存量库绑定的固定工作区 id（与桌面版 `src/lib/workspace-registry.ts` 同值） */
export const DEFAULT_WORKSPACE_ID = 'ws-default';

/**
 * 存量工作区的默认名（与桌面版 `src/lib/workspace-registry.ts` 逐字相同）。
 *
 * ⚠️ 这是**落库数据值**（A-数据类，见 `tests/server-error-i18n.spec.ts` ④ 棘轮）：
 *    翻了会造成「老行中文 / 新行英文」的审计串味，正解在显示层取词。
 *    它不是用户面文案（不进错误体），所以留在本文件而不是载荷表。
 */
export const DEFAULT_WORKSPACE_NAME = '未命名工作室';

/** 新区 Owner 的头像底色（取 IdentityDialog 色板第 0 色，不新造色值） */
const OWNER_AVATAR_COLOR = '#3D6B5B';

/**
 * 请求头：指定本请求落在哪个工作区。
 *
 * 语义（批 2 接线，本批只有解析函数）：
 *   · 有值 ⇒ 必须解析到已登记的工作区，否则 **404**；
 *   · 无值 ⇒ ws-default（老客户端零改动）。
 */
export const WORKSPACE_HEADER = 'x-workspace-id';

/** 注册表行（`workspaces` 表的 snake_case 原样形状） */
interface WorkspaceRow {
  id: string;
  name: string;
  db_file: string;
  owner_member_id: string | null;
  gate_password_hash: string | null;
  created_at: string;
  updated_at: string;
}

/** 对外的工作区条目（camelCase；**不 join members**，Owner 名派生留给批 3 的 API 层） */
export interface WorkspaceInfo {
  id: string;
  name: string;
  /** 该区业务库的绝对路径 */
  dbFile: string;
  createdAt: string;
}

/** 新建工作区的入参 */
export interface CreateWorkspaceCmd {
  /** 工作区名（用户输入；空白会被拒绝，不代取默认名） */
  name: string;
  /** Owner 管理员名（写进该区 members 表） */
  ownerName: string;
  /** 区闸密码明文（与 Owner 成员密码**同一个**；建区时强制设密） */
  password: string;
}

/** `createWorkspace` 的返回 */
export interface CreatedWorkspace extends WorkspaceInfo {
  /** 新建的 Owner 成员 id（调用方据此写身份键 / 直接以 Owner 进入） */
  ownerMemberId: string;
}

const nowIso = (): string => new Date().toISOString();

/* ══════════════════════════ 注册表句柄（单例） ══════════════════════════ */

/**
 * 注册表库句柄缓存。
 *
 * 为什么单例：注册表是**每个请求都要读一次**的东西（批 2 按 header 解析区），
 * 每次 `new Database()` 是 open + 3 条 pragma 的固定开销，且 better-sqlite3 的
 * 连接数没有上限保护。缓存一个句柄即可 —— 注册表是单写入者（本进程），
 * 不需要多连接并发。
 *
 * 缓存键是**文件路径**而不是「有没有打开过」：测试会在同一次进程里对多个临时目录
 * 反复 `openRegistry()`，只认布尔标记会把第二次调用接到第一次的库上（跨测试串味）。
 */
const registryCache = new Map<string, ChangxiaServerDb>();

/** 业务库句柄缓存（同上；批 2 起会在每请求路径上被查一次） */
const workspaceDbCache = new Map<string, ChangxiaServerDb>();

/**
 * 建表（幂等）：只跑 `schema.sql` 的 **REGISTRY 段**。
 *
 * 为什么不跑 `createDb()`：那会在这个库上建出全部 13 张业务表并推进 `user_version`。
 * 注册表库的业务内容只有 workspaces 一张表 —— 多出来的空表不只脏，还会让
 * 「这到底是注册表还是业务库」这个问题在排查时永远说不清。
 */
function ensureRegistrySchema(db: ChangxiaServerDb): void {
  const ddl = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(sectionOf(ddl, 'REGISTRY'));
}

/**
 * 打开注册表库（单例，幂等）。
 *
 * `CHANGXIA_DB` 的解析规则见 `lib/data-paths.ts` 的文件头（四条）：
 * env 指向一个已存在的业务库文件时，**那个文件仍是 ws-default 的业务库**，
 * 注册表另存**同目录**的 `workspaces.db` —— 老部署一个字节都不搬。
 */
export function openRegistry(registryFile?: string): ChangxiaServerDb {
  const file = registryFile ?? resolveDataDir().registryFile;
  const cached = registryCache.get(file);
  if (cached !== undefined) return cached;

  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureRegistrySchema(db);
  registryCache.set(file, db);
  return db;
}

/** 关闭并清空全部缓存句柄（测试用；生产进程活到退出，不需要） */
export function closeAllWorkspaceDbs(): void {
  for (const db of workspaceDbCache.values()) {
    try {
      db.close();
    } catch {
      /* 已关或库被删：无动作 */
    }
  }
  workspaceDbCache.clear();
  for (const db of registryCache.values()) {
    try {
      db.close();
    } catch {
      /* 同上 */
    }
  }
  registryCache.clear();
}

/* ══════════════════════════ 读取 ══════════════════════════ */

function rowToInfo(r: WorkspaceRow): WorkspaceInfo {
  return { id: r.id, name: r.name, dbFile: r.db_file, createdAt: r.created_at };
}

/**
 * 全部工作区（按创建时间先后）。
 *
 * **不 join members**：Owner 显示名要跨库查（members 在**另一个文件**里），
 * 那是 API 层的编排（批 3）。本函数保持「注册表只答注册表的问题」。
 */
export function listWorkspaces(registryDb: ChangxiaServerDb = openRegistry()): WorkspaceInfo[] {
  const rows = registryDb
    .prepare('SELECT * FROM workspaces ORDER BY created_at ASC, id ASC')
    .all() as WorkspaceRow[];
  return rows.map(rowToInfo);
}

/** 按 id 取一行（不存在 ⇒ null；不抛） */
export function findWorkspace(
  id: string,
  registryDb: ChangxiaServerDb = openRegistry(),
): WorkspaceRow | null {
  const row = registryDb.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
    | WorkspaceRow
    | undefined;
  return row ?? null;
}

/* ══════════════════════════ 播种默认区 ══════════════════════════ */

/**
 * 幂等播种 `ws-default`（存量迁移的服务端实现）。
 *
 * 语义与桌面版 `src/lib/workspace-registry.ts` 的 `ensureEntries()` **同源**：
 *   · 注册表里已有 ws-default ⇒ **什么都不做**（幂等；连 `updated_at` 都不动，
 *     免得每次启动都刷新一行，让「创建时间/更新时间」失去审计价值）；
 *   · 没有 ⇒ 插一行，`db_file` = 默认业务库路径（= 今天 `openDb()` 打开的那个文件），
 *     `name` = 「未命名工作室」，`owner_member_id` = NULL。
 *
 * `owner_member_id` 为什么是 NULL 而不是「去老库找第一个管理员」：
 *   本批是数据层地基，读老库的 `members` 表意味着「播种」这一步要依赖业务库已被
 *   `createDb()` 打开且结构可读 —— 把副作用叠进启动期的一次性动作里，失败面变大。
 *   老区的 Owner 名派生是**显示层**的事（批 3 的 `GET /api/workspaces` 编排），
 *   届时按需查、查不到就显「—」，不会因为播种时没回填而永久缺失。
 *
 * @returns true = 本次真的插入了（首次启动）；false = 已存在，跳过
 */
export function seedDefaultWorkspace(
  registryDb: ChangxiaServerDb = openRegistry(),
  defaultDbFile: string = resolveDataDir().defaultDbFile,
): boolean {
  if (findWorkspace(DEFAULT_WORKSPACE_ID, registryDb) !== null) return false;
  const ts = nowIso();
  registryDb
    .prepare(
      `INSERT INTO workspaces (id, name, db_file, owner_member_id, gate_password_hash, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
    )
    .run(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, defaultDbFile, ts, ts);
  return true;
}

/* ══════════════════════════ 打开业务库 ══════════════════════════ */

/**
 * 按 id 打开该区业务库（带句柄缓存；首次打开时对该库跑一次 `createDb()`）。
 *
 * 为什么缓存：批 2 起每个请求都要取一次库句柄。每次 `new Database()` 的开销
 * （open + WAL + pragma + 五次 DDL 扫描）在 30ms 量级，放在每请求路径上是灾难。
 *
 * 为什么首次要 `createDb()`：新建区时文件是 `createWorkspace()` 建好的，但
 * **默认区**的业务库可能是老文件、甚至不存在（首发）。统一在这里跑一次，
 * 保证「任何被 `openWorkspaceDb()` 拿到手的库都有全量 schema」。
 * `createDb()` 本身幂等（CREATE TABLE IF NOT EXISTS + PRAGMA table_info 补列 +
 * user_version 打标），按规矩管 `user_version` —— 本文件**不写**它（铁律 ①）。
 *
 * @throws 该 id 未登记（调用方据此 404，绝不回落默认区 —— 铁律 ②）
 */
export function openWorkspaceDb(
  id: string,
  registryDb: ChangxiaServerDb = openRegistry(),
): ChangxiaServerDb {
  const row = findWorkspace(id, registryDb);
  if (row === null) {
    throw new WorkspaceNotFoundError(id);
  }
  const cached = workspaceDbCache.get(row.db_file);
  if (cached !== undefined) return cached;

  mkdirSync(dirname(row.db_file), { recursive: true });
  const db = new Database(row.db_file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createDb(db);
  workspaceDbCache.set(row.db_file, db);
  return db;
}

/** 工作区不存在（**必须是 404**，不许静默回落到默认区） */
export class WorkspaceNotFoundError extends Error {
  public readonly workspaceId: string;
  public constructor(workspaceId: string) {
    // ★ 内部诊断文案一律**英文**：它是纯 Error，message 永不外溢到用户（错误处理器只取
    //   `userMessage` 或兜底句）。写中文会在 `tests/server-error-i18n.spec.ts` ④ 的棘轮上
    //   占一条豁免 —— 而豁免只留给「翻不了的东西」，这类纯诊断串没必要占用配额。
    super(`[workspace-registry] unknown workspace id=${workspaceId}`);
    this.name = 'WorkspaceNotFoundError';
    this.workspaceId = workspaceId;
  }
}

/* ══════════════════════════ 建新区 ══════════════════════════ */

/** 新区 id（`ws-<uuid>`，与桌面版 `WorkspacePicker` 的 `ws-${crypto.randomUUID()}` 同形） */
function newWorkspaceId(): string {
  return `ws-${crypto.randomUUID()}`;
}

/** 新区的库文件名（`ws-<uuid>.db`；与注册表同目录） */
function dbFileFor(id: string, dataDir: string): string {
  return join(dataDir, `${id}.db`);
}

/**
 * 建一个新区（**事务式**：任一步失败整体回滚，不留半成品）。
 *
 * 六步（顺序即依赖）：
 *   ① 校验入参（名字/Owner 名/密码都不能空白 —— 不代取默认值）
 *   ② 生成 id + 目标文件路径；**先查文件占用**（同名文件已存在 ⇒ 拒绝，不覆盖）
 *   ③ 建 `ws-<id>.db` + `createDb()`（全量 schema）
 *   ④ 插入 Owner 成员（`role_kind='admin'`、`role='负责人'` 哨兵、scrypt 落密码）
 *   ⑤ 插注册表行，`owner_member_id` / `gate_password_hash` **同一次写入就带上**
 *      （不做「先插行再 UPDATE 回填」—— 那会留一个「行在、字段空」的中间态，
 *      而 `gate_password_hash` 为空在批 3 语义里意味着「本区无闸密」，会被放行）
 *   ⑥ 失败清理：删注册表行、关句柄、删文件（含 -wal / -shm）
 *
 * 为什么密码只落一次 scrypt：区闸密码与 Owner 成员密码是**同一个密码**
 * （产品口径：建区即 Owner、进区就验这一个）。落两次会得到两个不同盐的哈希，
 * 虽然都能验过，但「改一个另一个没改」就会立刻不一致 —— 同一个密码只存一份哈希。
 *
 * @throws WorkspaceCreateError 入参非法 / 文件冲突 / 任一步失败（已回滚）
 */
export function createWorkspace(
  cmd: CreateWorkspaceCmd,
  registryDb: ChangxiaServerDb = openRegistry(),
  dataDir: string = resolveDataDir().dataDir,
): CreatedWorkspace {
  const name = String(cmd.name ?? '').trim();
  const ownerName = String(cmd.ownerName ?? '').trim();
  const password = String(cmd.password ?? '');

  // ① 入参校验（**不代取默认名**：静默造一个「未命名工作区」会让用户以为自己建成了）
  //    ⚠️ 文案英文：同 WorkspaceNotFoundError 的理由（内部诊断串，永不外溢）。
  //    真正的用户面提示由批 3 的 API 层按 `err.field` 建取词键给出。
  if (!name) throw new WorkspaceCreateError('name', 'workspace name is required');
  if (!ownerName) throw new WorkspaceCreateError('ownerName', 'owner name is required');
  if (!password) throw new WorkspaceCreateError('password', 'workspace password is required');

  // ② id + 路径；文件占用先判（绝不复用别人的库文件 —— 那会把两个区绑到同一份数据上）
  const id = newWorkspaceId();
  const dbFile = dbFileFor(id, dataDir);
  if (existsSync(dbFile)) {
    throw new WorkspaceCreateError('dbFile', `db file already exists, refusing to overwrite: ${dbFile}`);
  }

  const passwordHash = hashPassword(password);
  let opened: ChangxiaServerDb | null = null;
  let inserted = false;

  try {
    // ③ 建库 + 全量 schema
    mkdirSync(dataDir, { recursive: true });
    opened = new Database(dbFile);
    opened.pragma('journal_mode = WAL');
    opened.pragma('foreign_keys = ON');
    createDb(opened);

    // ④ Owner 成员（与 POST /api/members 的插入口径同源：roleKind=admin、role=哨兵值）
    const ownerMemberId = crypto.randomUUID();
    const ts = nowIso();
    opened
      .prepare(
        `INSERT INTO members (id, name, role, contact, avatar_color, active, role_kind, password_hash, actor_kind, agent_kind, revision, updated_at)
         VALUES (?, ?, ?, NULL, ?, 1, 'admin', ?, 'human', NULL, 1, ?)`,
      )
      .run(ownerMemberId, ownerName, ROLE_SENTINELS.owner, OWNER_AVATAR_COLOR, passwordHash, ts);

    // ⑤ 注册表行（owner / gate hash 一次写入，无中间态）
    registryDb
      .prepare(
        `INSERT INTO workspaces (id, name, db_file, owner_member_id, gate_password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, name, dbFile, ownerMemberId, passwordHash, ts, ts);
    inserted = true;

    // ⑥ 只在这个库上跑过 createDb，新库不需要额外迁移；句柄交缓存
    workspaceDbCache.set(dbFile, opened);
    return { id, name, dbFile, createdAt: ts, ownerMemberId };
  } catch (err) {
    // 回滚：注册表行 → 句柄 → 文件（含 WAL 副产物）
    if (inserted) {
      try {
        registryDb.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
      } catch {
        /* 删不掉也要继续清理文件 —— 两个都失败时把原错误抛出去更有价值 */
      }
    }
    workspaceDbCache.delete(dbFile);
    if (opened !== null) {
      try {
        opened.close();
      } catch {
        /* 已关 */
      }
    }
    removeDbFiles(dbFile);
    if (err instanceof WorkspaceCreateError) throw err;
    throw new WorkspaceCreateError('storage', `create workspace failed: ${(err as Error).message ?? String(err)}`, err);
  }
}

/** 删库文件及其 WAL 副产物（幂等；不存在是空操作） */
function removeDbFiles(dbFile: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${dbFile}${suffix}`;
    try {
      if (existsSync(p)) rmSync(p, { force: true });
    } catch {
      /* 被占用等情况：留着比抛错好（原错误更重要） */
    }
  }
}

/** 建区失败（`field` 供调用方区分是哪一步；文案只给内部排查用，不外溢） */
export class WorkspaceCreateError extends Error {
  public readonly field: 'name' | 'ownerName' | 'password' | 'dbFile' | 'storage';
  public constructor(field: 'name' | 'ownerName' | 'password' | 'dbFile' | 'storage', message: string, cause?: unknown) {
    // 纯 Error：文案永不外溢到用户（英文，理由同 WorkspaceNotFoundError）
    super(`[workspace-registry] ${message}`);
    this.name = 'WorkspaceCreateError';
    this.field = field;
    if (cause !== undefined) {
      try {
        (this as { cause?: unknown }).cause = cause;
      } catch {
        /* 环境不支持 cause 时静默忽略 */
      }
    }
  }
}

/* ══════════════════════════ 按请求解析工作区 ══════════════════════════ */

/** 最小请求形状（只取 header；不 import fastify 类型，便于单测直接喂普通对象） */
export interface WorkspaceRequestLike {
  headers: Record<string, string | string[] | undefined>;
}

/** 解析结果：命中哪个区 + 它的库句柄 */
export interface ResolvedWorkspace {
  id: string;
  info: WorkspaceInfo;
  db: ChangxiaServerDb;
}

/**
 * 从请求头解析工作区并返回其库句柄（批 2 的接线入口；本批只有单测消费）。
 *
 * 三条口径（铁律 ②③）：
 *   · 带 `X-Workspace-Id` 且该区已登记 ⇒ 返回该区；
 *   · 带 `X-Workspace-Id` 但未登记 ⇒ **抛 WorkspaceNotFoundError**（调用方必须回 404，
 *     **绝不回落默认区**）；
 *   · 不带（或空串）⇒ ws-default。**老客户端不带这个 header，必须照常工作**。
 *
 * header 取值兼容数组形态（`string[]` 是 Node 对重复 header 的表示；取第一个）。
 */
export function resolveWorkspaceFromRequest(
  req: WorkspaceRequestLike,
  registryDb: ChangxiaServerDb = openRegistry(),
): ResolvedWorkspace {
  const raw = req.headers[WORKSPACE_HEADER];
  const headerValue = Array.isArray(raw) ? raw[0] : raw;
  const id = headerValue === undefined ? '' : String(headerValue).trim();
  const effectiveId = id === '' ? DEFAULT_WORKSPACE_ID : id;

  const row = findWorkspace(effectiveId, registryDb);
  if (row === null) {
    // 带了一个不存在的 id ⇒ 404；默认区不存在（未播种）同样 404 —— 但那是部署故障，
    // 不在这里兜底建区：静默建区会让「注册表写失败」伪装成「正常启动」。
    throw new WorkspaceNotFoundError(effectiveId);
  }
  return { id: effectiveId, info: rowToInfo(row), db: openWorkspaceDb(effectiveId, registryDb) };
}

/* ══════════════════════════ 区闸密码 ══════════════════════════ */

/** 读某区的闸密码哈希（未登记 / 尚未设密 ⇒ null） */
export function readGateHash(
  id: string,
  registryDb: ChangxiaServerDb = openRegistry(),
): string | null {
  return findWorkspace(id, registryDb)?.gate_password_hash ?? null;
}

/**
 * 校验某区的闸密码（未登记 ⇒ false，不抛 —— 与「密码错」同形，
 * 免得未登记 id 的存在性从这一路泄漏出去）。
 */
export function verifyGatePassword(
  id: string,
  plain: string,
  registryDb: ChangxiaServerDb = openRegistry(),
): boolean {
  const stored = readGateHash(id, registryDb);
  return verifyPassword(plain, stored);
}

/** `setGatePassword()` 的失败原因（路由层据此选状态码与取词键） */
export type SetGateFailure = 'notFound' | 'currentPasswordRequired' | 'currentPasswordWrong';

/**
 * 闸密同步的**基础设施故障**（不是业务失败）。
 *
 * 为什么单立一个类而不是复用 `WorkspaceCreateError`：那个是「建区入参/落盘失败」，
 * 语义是「用户填错了」；本类是「跨两个库的写入只成功了一半」，语义是「服务端出了问题，
 * 数据可能不一致」。两者的用户面文案不同（前者引导改输入，后者只能重试 + 报运维），
 * 混用会让用户对着一个他没填错的表单反复修改。
 *
 * `inconsistent=true` 表示**补偿也失败**了：注册表列没改、成员密码已经改了。
 * 这个状态必须被看见（500 + 日志），不能伪装成「什么都没发生」。
 */
export class WorkspaceGateSyncError extends Error {
  public readonly inconsistent: boolean;
  public constructor(message: string, opts: { original: unknown; rollback?: unknown }) {
    // 内部诊断串用英文（同 WorkspaceNotFoundError 的理由：不进棘轮豁免配额）。
    // ⚠️ 不用 `super(msg, { cause })`：本仓 target 是 ES2020，`ErrorOptions.cause`
    //    要 ES2022 lib 才在类型里 ⇒ TS2554。与 `ChangxiaError` 同款手工赋值（见 enums.ts）。
    super(`[workspace-registry] ${message}`);
    this.name = 'WorkspaceGateSyncError';
    try {
      (this as { cause?: unknown }).cause = opts.original;
    } catch {
      /* 环境不支持 cause 时静默忽略 */
    }
    // 只有补偿也失败时才有 rollback 字段
    this.inconsistent = opts.rollback !== undefined;
    if (opts.rollback !== undefined) {
      try {
        (this as { rollbackError?: unknown }).rollbackError = opts.rollback;
      } catch {
        /* 同上 */
      }
    }
  }
}

/**
 * 设 / 改某区闸密码（**必须校验旧密**，首次设密除外），并**同步该区全部 active 管理员**的成员密码。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 产品口径（批 3.5 · 老板拍板）：「闸密 = 管理员密码，改就一起改」
 * ══════════════════════════════════════════════════════════════════════
 * 改闸密成功后，**同一次操作内**把该区所有 `active = 1 AND role_kind = 'admin'` 的成员
 * `password_hash` 一并更新成**同一个新哈希**。
 *
 * ── 为什么必须一起改（批 3 的解耦是错的）──
 * 批 3 写成「闸密守进区、成员密码守发言，两者解耦」。但用户的心智模型只有一个密码：
 * 他在「工作区密码」框里改完，就会认为自己的登录密码也变了。解耦的真实后果是
 * **下次用成员身份登录时发现「我明明改过密码」** —— 那是最困惑的形态，且完全静默。
 *
 * ── 三条硬要求（都有用例钉）──
 *   ① **同一个哈希只算一次**：scrypt 只跑一次，注册表列与所有 admin 行写入**完全相同的
 *      字符串**。各算一遍会得到不同盐的两个哈希，症状是「闸密能进、成员密码不过」——
 *      比不改还糟。
 *   ② **不动非管理员**：`role_kind = 'member'` 的密码一个都不许动（他们各自设的密码
 *      是独立的，与「进入这个区」无关）。
 *   ③ **事务性**：注册表列 + 业务库 N 行，任一失败整体回滚。绝不出现「闸密改了、
 *      成员密码没改」的半截状态。
 *
 * ── 一个刻意保留的例外 ──
 * 该区**没有任何 active 管理员**（管理员全被停用等异常状态）时，**不失败**：
 * 只更新注册表列、跳过成员同步。理由：闸密是**进入这个区的门**，不能因为区里恰好
 * 没有管理员就把门锁死 —— 那会让用户彻底进不去，而他能做的只有「删库重来」。
 * 这不是「成功」而是「尽力而为」，故返回值里用 `syncedMembers: 0` 让调用方可观测。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 事务的边界（两个独立 SQLite 连接，没有原生原子性）
 * ══════════════════════════════════════════════════════════════════════
 * 注册表库与业务库是**两个独立连接**，SQLite 的事务是**单连接**概念 ⇒ 跨库没有原子性。
 * 这里用「先做可逐行补偿的那一步」：
 *
 *   ⓪ 先**逐行快照**将被改的 admin 行（id / password_hash / revision）
 *   ① 写业务库成员密码（单条 UPDATE，同一连接内天然原子）
 *   ② 写注册表列；②失败 ⇒ 按快照**逐行写回**各自的旧哈希（补偿）
 *
 * ── 为什么补偿必须逐行，不能「统一写回旧闸密」──
 * `PATCH /api/members/:id` 允许单独改某个管理员的成员密码，所以这些行的旧值**可能
 * 各不相同**（也可能有的是 NULL）。用闸密统一回填会把「各自设过密码的管理员」全部
 * 改成同一个值 —— 那是比不补偿更坏的数据损坏，而且完全静默。
 * 逐行快照是唯一正确的做法（admin 行数是个位数，成本可忽略）。
 * ★ 这条由 tests/server.workspaces-api.spec.ts ⑤b-③ 的变异 M5 钉住（统一写回会红）。
 *
 * ⚠️ 极端情况（补偿**也**失败，如进程被杀）仍可能留下不一致。这里不假装解决它：
 *    SQLite 没有跨库事务，真要彻底解决得用 ATTACH + 单连接（会把注册表与业务库
 *    耦合成同一连接池，代价远大于收益）。这种情形抛 `WorkspaceGateSyncError` 且
 *    `inconsistent = true`，让调用方看到 500 并进日志 —— 好过假装成功。
 *
 * @returns `{ ok: true, syncedMembers }` 或 `{ ok: false, reason }`（**不抛**业务失败，
 *          只有「跨库写入只成功了一半」这类基础设施故障才会抛）
 */
export function setGatePassword(
  id: string,
  plain: string,
  currentPassword: string | undefined,
  registryDb: ChangxiaServerDb = openRegistry(),
): { ok: true; syncedMembers: number } | { ok: false; reason: SetGateFailure } {
  const row = findWorkspace(id, registryDb);
  if (row === null) return { ok: false, reason: 'notFound' };

  const existing = row.gate_password_hash;
  if (existing !== null && existing !== '') {
    if (currentPassword === undefined || currentPassword === '') {
      return { ok: false, reason: 'currentPasswordRequired' };
    }
    if (!verifyPassword(currentPassword, existing)) {
      return { ok: false, reason: 'currentPasswordWrong' };
    }
  }

  // ★ 硬要求 ①：整个操作**只算一次** scrypt。注册表列与所有 admin 行写入同一个字符串。
  const newHash = hashPassword(plain);
  const ts = nowIso();

  // 业务库句柄：未登记已在上面 return；这里取句柄失败（文件损坏等）按 storage 故障处理
  const biz = openWorkspaceDb(id, registryDb);

  /*
   * ★ 事务边界（跨两个 SQLite 连接，没有原生原子性）：先做「能逐行补偿」的那一步。
   *
   * 先把将要被改的 admin 行**逐行记下旧哈希**（连同 id）再更新 —— 补偿时按 id 逐行写回。
   * 为什么不能「统一写回注册表里那个旧闸密」：`PATCH /api/members/:id` 允许单独改某个
   * 管理员的成员密码，所以这些行的旧值**可能各不相同**（也可能有的是 NULL）。
   * 用闸密统一回填会把「各自设过密码的管理员」全部改成同一个值 —— 那是比不补偿更坏
   * 的数据损坏，而且是静默的。逐行快照是唯一正确的做法（行数是个位数，成本可忽略）。
   */
  const admins = biz
    .prepare(
      `SELECT id, password_hash, revision FROM members
        WHERE active = 1 AND role_kind = 'admin'`,
    )
    .all() as Array<{ id: string; password_hash: string | null; revision: number }>;

  // ── ① 写业务库（单条 UPDATE = 单连接内天然原子；`role_kind='member'` 不在 WHERE 里 ⇒ 不动，硬要求 ②）
  const updated = biz
    .prepare(
      `UPDATE members
          SET password_hash = ?, revision = revision + 1, updated_at = ?
        WHERE active = 1 AND role_kind = 'admin'`,
    )
    .run(newHash, ts);

  // ── ② 写注册表列；失败则按快照逐行补偿 ──
  try {
    registryDb
      .prepare('UPDATE workspaces SET gate_password_hash = ?, updated_at = ? WHERE id = ?')
      .run(newHash, ts, id);
  } catch (err) {
    const restore = biz.prepare(
      'UPDATE members SET password_hash = ?, revision = ?, updated_at = ? WHERE id = ?',
    );
    const rollbackAll = biz.transaction(() => {
      for (const a of admins) restore.run(a.password_hash, a.revision, nowIso(), a.id);
    });
    try {
      rollbackAll();
    } catch (rollbackErr) {
      // 补偿也失败：**如实抛**，让调用方看到 500。不假装成功 ——
      // 「闸密没改但成员密码改了」是必须被人看见的状态，藏起来只会更难查。
      throw new WorkspaceGateSyncError(
        'gate write failed AND member rollback failed (inconsistent state)',
        { original: err, rollback: rollbackErr },
      );
    }
    throw new WorkspaceGateSyncError(`gate write failed, members rolled back: ${(err as Error).message}`, {
      original: err,
    });
  }

  return { ok: true, syncedMembers: updated.changes };
}


/* ══════════════════════════ Owner 名派生 ══════════════════════════ */

/**
 * 派生某区的 Owner 显示名（`GET /api/workspaces` 的 `ownerMemberName`）。
 *
 * 判据（**与桌面版 `readWorkspaceGateHash` 的选取口径同源**）：该区业务库里
 * `active=1 AND role_kind='admin'` 的第一行（按 `updated_at` 升序 = 最早的那个管理员）。
 *
 * 为什么是「派生」而不是读注册表的 `owner_member_id`：
 *   `owner_member_id` 只有**新建区**才有（`createWorkspace()` 写入）；存量区
 *   （ws-default 及所有升级上来的库）那一列是 NULL —— 播种时刻意不读业务库（见
 *   `seedDefaultWorkspace()` 的注释）。所以「Owner 名」必须按判据实时查，
 *   不能假设注册表里有。
 *
 * 为什么按判据查而不是「第一个创建的管理员」：
 *   桌面版切区验密用的是同一判据（`active + role_kind='admin'` 里任一有 passwordHash 的）。
 *   两边判据一致 ⇒ 「列表上显示的 Owner」与「实际能进去的那个管理员」是同一个人；
 *   若这里改用创建时间最早，会出现「列表写着 A 是 Owner，实际只有 B 的密码能过」。
 *
 * 任何失败（库打不开 / 表不存在 / 无管理员）⇒ `null`（**不抛**）：
 *   列表端点必须能出全表，一个区的库坏掉不该让整个工作区列表 500。
 */
export function deriveOwnerMemberName(
  id: string,
  registryDb: ChangxiaServerDb = openRegistry(),
): string | null {
  try {
    const db = openWorkspaceDb(id, registryDb);
    // `members.active` 在 schema 里是 INTEGER（0/1，见 schema.sql），故写整数 1。
    // ⚠️ 如实记一条实测结论（免得后人以为这里埋着雷）：SQLite 的**列亲和性**会让
    //    INTEGER 列上的「把 1 写成引号串」与「写整数 1」**结果完全等价**，
    //    所以这一列上不存在「引号串 vs INTEGER 列」的静默失配。
    //    写整数仍是对的 —— 它让读者一眼看出这列是数值列，不会有人跟着写出
    //    「把 true 写成引号串」那种**真正**查不到的形态。
    const row = db
      .prepare(
        `SELECT name FROM members
          WHERE active = 1 AND role_kind = 'admin'
          ORDER BY updated_at ASC, id ASC
          LIMIT 1`,
      )
      .get() as { name: string } | undefined;
    return row?.name ?? null;
  } catch {
    return null;
  }
}

/* ══════════════════════════ 再导出 ══════════════════════════ */

/**
 * `resolveDataDir` 从本文件再导出：对外**只有一个入口**。
 * 实现在 `lib/data-paths.ts`（拆出去是为了打断 `db.ts ↔ 本文件` 的循环依赖，见该文件头）。
 */
export { resolveDataDir, REGISTRY_DB_FILENAME };
export type { ResolvedDataPaths } from './lib/data-paths';
