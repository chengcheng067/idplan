/**
 * 工作区能力仓储（local / Dexie 形态）。
 *
 * ── 它包装什么 ──
 * 把桌面版既有的两块能力收进 `IWorkspaceRepository`：
 *   ① `./workspace.db.ts` 的建库+Owner入库 / 读闸密哈希 / 写闸密哈希；
 *   ② `src/lib/workspace-registry.ts` 的**元数据列表**（localStorage 注册表）。
 *
 * ⚠️ ② 是**注入**进来的，不是 import 进来的 —— 这是本文件能住 `src/core/` 的唯一原因：
 *   `tests/arch-boundary.spec.ts` 把浏览器全局（`window` / `document` / `localStorage`）
 *   锁在 `src/core/agent/**` 与 `src/core/types/**` 之外，而 `src/core/repositories/**`
 *   虽不在共享内核的扫描面内，但本文件与 `./workspace.db.ts` 同处一层、且
 *   `interfaces.ts` 是服务端 tsconfig 的 include 面内的共享内核文件。让这一层
 *   依赖 localStorage 等价于把「core 不许碰浏览器存储」这条口径撕开一个口子。
 *   ⇒ 注册表读取以 `listRegistry` 回调注入（由 `src/di/` 或 UI 侧传
 *   `() => listWorkspaces().map(...)`），本文件只消费它的**纯数据**。
 *
 * ── 行为必须与 `WorkspacePicker` 直连那套逐字一致 ──
 *   · `gateOf` ⇒ `readWorkspaceGateHash(dbName) !== null`
 *     （null = 该区没设过任何 active+admin 的密码 ⇒ `hasGate:false`）
 *   · `verifyGate` ⇒ `verifyPassword(password, hash)`（PBKDF2-SHA256，与建区/设密同一算法）
 *   · `setGate` ⇒ `writeWorkspaceGateHash(dbName, password)`；返回 false 视为失败**抛错**
 *     （UI 侧需要区分「设好了」与「没设上」——静默成功会让用户以为设过了）
 *   · `create` ⇒ `createWorkspaceOwnerDb({ dbName, ownerName, password })`
 *     ⚠️ 建库**不**登记注册表：注册表在 `src/lib/`，由调用方在建库成功后 `addWorkspace()`。
 *        本方法只负责「库建好 + Owner 入库」，返回 `ownerMemberId` 供调用方落区级身份键。
 *
 * ── 库名怎么来 ──
 *   两套口径并存，且都来自注册表：
 *     · `id` 是 `ws-default`（存量区）⇒ 库名是老的 `changxia`（= `dbNameOf` 注入回调）；
 *     · 否则 ⇒ 新区库名 `idplan-<id>`（建区时的命名约定，`WorkspacePicker` 与
 *       `workspace-registry.ts` 同口径）。
 *   `dbNameOf` 同样注入：注册表条目里本来就有 `dbName` 字段，直接用它比自己拼更可靠
 *   （拼出来与注册表不一致 = 读的库和列的区不是同一个）。
 */

import type {
  CreateWorkspaceCmd,
  IWorkspaceRepository,
  SetWorkspaceGateOptions,
  WorkspaceSummary,
} from '../interfaces';
import { ChangxiaErrorCode, coreError } from '../../types/enums';
import { verifyPassword } from '../../../lib/password';
import {
  createWorkspaceOwnerDb,
  readWorkspaceGateHash,
  writeWorkspaceGateHash,
} from './workspace.db';

/** local 实现需要的注入面（全部是纯数据/纯回调，不碰任何浏览器全局） */
export interface LocalWorkspacesRepoDeps {
  /**
   * 列出全部工作区的**元数据**（调用方从 `src/lib/workspace-registry` 的
   * `listWorkspaces()` 映射而来）。必须同步：注册表本身是同步可读的，
   * 且 `list()` 的实现只是把它包成 Promise —— 这里不接受 async 回调是为了
   * 让「注册表读取不会失败」这条既有事实保持显式。
   *
   * 可选：留空时 `list()` **抛错**（不返回空数组）—— 空数组在首屏会被读成
   * 「这台电脑上没有工作区」，那是假空态，比一次明确的失败更糟。
   */
  listRegistry?: () => WorkspaceSummary[];
  /**
   * 工作区 id → 该区的 Dexie 库名。
   *
   * 真实调用方传 `(id) => listWorkspaces().find(w => w.id === id)?.dbName ?? fallback`；
   * 缺省实现走命名约定（`ws-default` → `changxia`，其余 `idplan-<id>`），
   * 与 `workspace-registry.ts` / `WorkspacePicker` 的建区命名逐字一致。
   * 给缺省是为了让单测与「只有 id 没有条目」的边界场景仍能跑。
   */
  dbNameOf?: (id: string) => string;
}

/** 存量区的库名（= `schema/current.ts` 的 `DB_NAME`；见 workspace-registry 同名字面量） */
const LEGACY_DB_NAME = 'changxia';

/** 命名约定兜底：`ws-default` → 老库名；其余 → `idplan-<id>` */
function defaultDbNameOf(id: string): string {
  return id === 'ws-default' ? LEGACY_DB_NAME : `idplan-${id}`;
}

export class LocalWorkspacesRepo implements IWorkspaceRepository {
  private readonly dbNameOf: (id: string) => string;

  public constructor(private readonly deps: LocalWorkspacesRepoDeps) {
    this.dbNameOf = deps.dbNameOf ?? defaultDbNameOf;
  }

  async list(): Promise<WorkspaceSummary[]> {
    const registry = this.deps.listRegistry;
    if (!registry) {
      /*
       * 没有注入注册表 ⇒ **抛错**，绝不返回空数组。
       * 「空数组」在首屏的语义是「这台电脑上没有工作区」，而真因是「装配时漏了注入」
       * —— 用户会看到一个空的工作区列表且没有新建议入口，排查方向完全错。
       * 本仓纪律：装配缺失必须是一次可见的失败，不是一次长得像正常结果的假空态。
       */
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.workspace.registryUnavailable');
    }
    return registry();
  }

  async create(cmd: CreateWorkspaceCmd): Promise<{ id: string; ownerMemberId: string }> {
    /*
     * id 生成口径与 `WorkspacePicker.submitCreate` 逐字一致（`ws-<uuid>`）：
     * 复用同一套命名，是为了让「注册表里已有的区」与「这次新建的区」在库名推导上
     * 没有两种形状 —— 否则同一次会话里两次建区会得到不同的库名规则。
     */
    const id = `ws-${crypto.randomUUID()}`;
    const dbName = this.dbNameOf(id);
    const ownerMemberId = await createWorkspaceOwnerDb({
      dbName,
      ownerName: cmd.ownerName,
      password: cmd.password,
    });
    return { id, ownerMemberId };
  }

  async gateOf(id: string): Promise<{ hasGate: boolean }> {
    const hash = await readWorkspaceGateHash(this.dbNameOf(id));
    return { hasGate: hash !== null };
  }

  async verifyGate(id: string, password: string): Promise<boolean> {
    const hash = await readWorkspaceGateHash(this.dbNameOf(id));
    // 无闸密 ⇒ 无可验之物 ⇒ false（不抛）。调用方应先 `gateOf` 判断走「先设一个再进」；
    // 这里给 false 而不是 true，是因为「验密通过」必须建立在**真的验过**之上。
    if (hash === null) return false;
    return verifyPassword(password, hash);
  }

  async setGate(
    id: string,
    password: string,
    _opts?: SetWorkspaceGateOptions,
  ): Promise<void> {
    /*
     * `currentPassword` 在 local 形态**有意不使用**（下划线前缀是显式声明）：
     * 桌面版的闸密存在本区 Dexie 库里，改密的「验旧密」若放在这里，就等于让
     * 「谁调用了仓储」成为唯一的安全边界 —— 而现在这条路只用于 0017 的
     * 「该区还没有闸密 ⇒ 补设一个」，那时本来就没有旧密可验。
     * 真正的改密走成员管理（`LocalMembersRepository.update` 的密码字段），
     * 那里有身份与权限门。远端形态则交给服务端裁决（见 remote 实现）。
     */
    const ok = await writeWorkspaceGateHash(this.dbNameOf(id), password);
    if (!ok) {
      /*
       * 失败必须抛：`writeWorkspaceGateHash` 返回 false 的三类原因（库不存在 /
       * 该区没有 active 管理员 / 读写出错）对用户是同一句可操作的话（重试或检查存储），
       * 但**绝不能**静默成功 —— 那会让用户以为密码已设好，下次进区被拦在门外。
       */
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.workspace.gateWriteFailed');
    }
  }
}
