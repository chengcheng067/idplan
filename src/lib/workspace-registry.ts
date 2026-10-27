/**
 * 工作区注册表（多工作区 0016 · 数据层地基）。
 *
 * ── 概念 ──
 * 一台电脑上可有多个「工作区」（= 一家公司/团队），数据完全隔离（IndexedDB 按区分库）。
 * 本文件是工作区**元数据**的唯一出处：id / 名称 / 创建时间 / Owner 名 / 该区库名。
 * 业务数据不在这里 —— 每个区的项目/成员/任务都在自己的 Dexie 库里（见
 * `src/core/repositories/local/workspace.db.ts` 与 `dexie.database.ts`）。
 *
 * ── 为什么用 localStorage 而不是 meta Dexie 库 ──
 * 注册表必须在**建仓储之前**同步可读（RepoProvider 要先知道当前区叫什么库名，
 * 才能探测版本、弹迁移闸门、开对应的库）。Dexie 是异步的，塞进启动序列会把
 * 「先开哪个库」变成先有鸡还是先有蛋；localStorage 同步、且身份键本就存它。
 *
 * ── 存量迁移（升级那一刻发生什么）──
 * 首次读取（注册表键不存在）时：把现有库（`changxia`，见 schema/current.ts 的
 * DB_NAME）整体认作第一个工作区 `ws-default`（名「未命名工作室」），**数据零迁移**
 * —— 分库方案下老库本身就是它的库，只需把老库名绑定到该工作区 id。同时把旧的
 * 库级身份键（`changxia.currentMemberId`）的值**抄写**到 ws-default 的区级身份键，
 * 老用户的「上次身份」记忆不丢（旧键保留不删，只作迁移源，见 useSettingsStore）。
 *
 * ⚠️ 本文件在 `src/lib/` 而非 `src/core/`：注册表读 localStorage（浏览器专属），
 * 而 `src/core/agent|types` 是服务端共跑的共享内核（tests/arch-boundary.spec.ts
 * 禁浏览器 API）。`src/lib/` 无此约束（`password.ts` 同理住 lib）。
 *
 * ⚠️ 所有 localStorage 访问都 try/catch：node 环境单测 / 隐私模式会把
 * `localStorage` 变成 ReferenceError 或抛写入异常 —— 注册表读不出来不该拦启动，
 * 全部静默回落「单区 ws-default」内存态（与 useSettingsStore 既有口径一致）。
 */

/** 注册表在 localStorage 的键（本常量是它的唯一出处） */
const WORKSPACES_KEY = 'idplan.workspaces';
/** 当前工作区 id 在 localStorage 的键 */
const CURRENT_WS_KEY = 'idplan.currentWorkspaceId';
/** 「进入某个区的流程已开始」标记（首屏选择列表 vs 身份引导的判据之一） */
const ENTRY_STARTED_KEY = 'idplan.workspaceEntryStarted';
/** 「用户手动切换过工作区」标记（单区老用户不显选择列表的判据之一） */
const SWITCHED_KEY = 'idplan.workspaceManuallySwitched';

/** 第一个工作区 id（固定值：存量库绑定目标，测试与迁移都依赖它恒定） */
export const DEFAULT_WORKSPACE_ID = 'ws-default';

/** 存量库的库名（= schema/current.ts 的 DB_NAME 的值；此处字面量避免 core→lib 反向依赖） */
const LEGACY_DB_NAME = 'changxia';

/** 单个工作区的注册表条目 */
export interface WorkspaceEntry {
  id: string;
  name: string;
  /** ISO 时间串（建区时刻） */
  createdAt: string;
  /** Owner（最高管理员）成员名；存量区在 bootstrap 解析出首个管理员后回填 */
  ownerMemberName: string | null;
  /** 该区的 IndexedDB 库名（ws-default → `changxia`；新区 → `idplan-<id>`） */
  dbName: string;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式等写不进的场合：注册表退化为内存态（见文件头 ⚠️） */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 同上 */
  }
}

function parseEntries(raw: string | null): WorkspaceEntry[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const list = parsed.filter(
      (e): e is WorkspaceEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as WorkspaceEntry).id === 'string' &&
        typeof (e as WorkspaceEntry).dbName === 'string',
    );
    return list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

/**
 * 确保注册表存在并返回全部工作区（**所有读路径都经它**，保证懒迁移恰好跑一次）。
 * 空/损坏/不存在 → 建默认注册表（存量库绑定 ws-default + 身份键迁移）。
 */
function ensureEntries(): WorkspaceEntry[] {
  const existing = parseEntries(safeGet(WORKSPACES_KEY));
  if (existing !== null) return existing;

  const seeded: WorkspaceEntry[] = [
    {
      id: DEFAULT_WORKSPACE_ID,
      name: '未命名工作室',
      createdAt: new Date().toISOString(),
      ownerMemberName: null,
      dbName: LEGACY_DB_NAME,
    },
  ];
  saveEntries(seeded);
  migrateLegacyIdentityKey();
  return seeded;
}

function saveEntries(entries: WorkspaceEntry[]): void {
  safeSet(WORKSPACES_KEY, JSON.stringify(entries));
}

/**
 * 一次性身份键迁移：旧库级键 `changxia.currentMemberId` → ws-default 区级键。
 * 只在注册表首次创建（升级那一刻）跑；旧键**保留**不删 —— 老版本应用回滚打开时
 * 仍能读到自己的身份记忆（降级兼容）。
 *
 * 键名出处是 useSettingsStore 的 CURRENT_MEMBER_ID_KEY；此处字面量并加守卫测试锁
 * （lib ← store 单向依赖会成环，见 useSettingsStore 顶部注释）。
 */
const LEGACY_IDENTITY_KEY = 'changxia.currentMemberId';

function migrateLegacyIdentityKey(): void {
  const legacy = safeGet(LEGACY_IDENTITY_KEY);
  if (legacy === null) return;
  const target = identityKeyFor(DEFAULT_WORKSPACE_ID);
  if (safeGet(target) === null) safeSet(target, legacy);
}

/** 某工作区的身份键（`changxia.currentMemberId.<wsId>`；useSettingsStore 拼装同一格式） */
export function identityKeyFor(workspaceId: string): string {
  return `changxia.currentMemberId.${workspaceId}`;
}

/* ─────────────────────────── 对外读取 ─────────────────────────── */

/** 全部工作区（选择列表数据源，按创建时间先后） */
export function listWorkspaces(): WorkspaceEntry[] {
  return ensureEntries();
}

/** 当前工作区 id（注册表损坏/无记录 → ws-default） */
export function currentWorkspaceIdSync(): string {
  const id = safeGet(CURRENT_WS_KEY);
  const entries = ensureEntries();
  if (id !== null && entries.some((e) => e.id === id)) return id;
  return entries[0]?.id ?? DEFAULT_WORKSPACE_ID;
}

/** 当前工作区条目 */
export function currentWorkspaceSync(): WorkspaceEntry {
  const id = currentWorkspaceIdSync();
  return (
    ensureEntries().find((e) => e.id === id) ?? {
      id: DEFAULT_WORKSPACE_ID,
      name: '未命名工作室',
      createdAt: new Date().toISOString(),
      ownerMemberName: null,
      dbName: LEGACY_DB_NAME,
    }
  );
}

/** 当前工作区的 Dexie 库名（RepoProvider / 迁移备份导出的取值出口） */
export function currentWorkspaceDbName(): string {
  return currentWorkspaceSync().dbName;
}

/* ─────────────────────────── 对外写入 ─────────────────────────── */

/** 切换当前工作区（调用方负责先完成目标区密码验证，再 reload 使分库生效） */
export function setCurrentWorkspaceId(id: string): void {
  safeSet(CURRENT_WS_KEY, id);
}

/** 建新工作区（只登记元数据；建库+Owner 入库由 core 的 workspace.db 负责，调用方编排） */
export function addWorkspace(entry: WorkspaceEntry): void {
  const entries = ensureEntries();
  entries.push(entry);
  saveEntries(entries);
}

/** 回填 Owner 名（bootstrap 解析出首个 active 管理员后调用；幂等） */
export function setWorkspaceOwnerName(workspaceId: string, ownerName: string): void {
  const entries = ensureEntries();
  const ws = entries.find((e) => e.id === workspaceId);
  if (!ws || ws.ownerMemberName === ownerName) return;
  ws.ownerMemberName = ownerName;
  saveEntries(entries);
}

/** 标记「进入某区的流程已开始」（成功选区/建区后置位；首屏据此显身份引导而非区列表） */
export function markWorkspaceEntryStarted(): void {
  safeSet(ENTRY_STARTED_KEY, '1');
}

export function hasWorkspaceEntryStarted(): boolean {
  return safeGet(ENTRY_STARTED_KEY) === '1';
}

/** 标记「用户手动切换过工作区」（置位后即使只有一个区也显选择列表） */
export function markWorkspaceManuallySwitched(): void {
  safeSet(SWITCHED_KEY, '1');
}

export function hasWorkspaceManuallySwitched(): boolean {
  return safeGet(SWITCHED_KEY) === '1';
}

/**
 * 直接写某工作区的身份记忆（建区流程用：新区 Owner 建好后、切库 reload 前落键，
 * reload 后 useSettingsStore 初始化即读它，实现「建区即以 Owner 身份进入」）。
 */
export function writeMemberIdForWorkspace(workspaceId: string, memberId: string | null): void {
  if (memberId === null) safeRemove(identityKeyFor(workspaceId));
  else safeSet(identityKeyFor(workspaceId), memberId);
}
