import { MemberRoleKind } from '../../types/enums';
import { ROLE_SENTINELS } from '../../types/role-sentinel';
/* Dexie 只在 gatekeeper 文件 import（arch-boundary）；此处经其再导出取 exists */
import { ChangxiaDatabase, Dexie, openDatabase } from './dexie.database';
import { LocalMembersRepository } from './local.members.repo';

/**
 * 工作区分库的建库/探测辅助（多工作区 0016）。
 *
 * ⚠️ 铁律定位：本目录是全仓唯一允许触碰 Dexie 的地方（tests/arch-boundary.spec.ts
 * 把 import dexie 锁死在 `dexie.database.ts` 一个文件——所以本文件**不直接**
 * import dexie 包，一切经 `ChangxiaDatabase` / `Dexie.exists`（由 gatekeeper 再导出））。
 * localStorage（注册表）不在这里——core 不碰浏览器存储，注册表在
 * `src/lib/workspace-registry.ts`，由调用方（UI 组件）编排两半。
 */

/** 新区 Owner 的头像底色（首成员，取 IdentityDialog 既有色板的第 0 色，不新造色值） */
const OWNER_AVATAR_COLOR = '#3D6B5B';

export interface CreateWorkspaceOwnerCmd {
  /** 新区库名（`idplan-<wsId>`，由注册表方案给定） */
  dbName: string;
  /** Owner 管理员名 */
  ownerName: string;
  /** 工作区密码明文（≥4 位校验在 UI 层；这里只负责 PBKDF2 落哈希） */
  password: string;
}

/**
 * 建一个**空白新区**并把 Owner 管理员写入其成员表。
 *
 * 为什么不走 useRepos：当前进程的仓储 bundle 绑定的是**当前区**的库；新区还没切过去，
 * 必须用临时实例直接建。Owner 行与 IdentityDialog 的 `createAdminAndEnter` 同构
 * （roleKind=admin、role=负责人哨兵、明文经 LocalMembersRepository.insert 做 PBKDF2），
 * 保证「区内新建管理员」的 0015 密码闸对它照常工作。
 *
 * 返回 Owner 成员 id（调用方写区级身份键，reload 后即以 Owner 进入）。
 */
export async function createWorkspaceOwnerDb(cmd: CreateWorkspaceOwnerCmd): Promise<string> {
  const db = await openDatabase(cmd.dbName);
  try {
    const members = new LocalMembersRepository(db);
    const owner = await members.insert({
      name: cmd.ownerName,
      role: ROLE_SENTINELS.owner,
      contact: null,
      avatarColor: OWNER_AVATAR_COLOR,
      roleKind: MemberRoleKind.Admin,
      password: cmd.password,
    });
    return owner.id;
  } finally {
    db.close();
  }
}

/**
 * 读某工作区的**进入闸密码哈希**（切区验密的比对基准）。
 *
 * 判据：该区成员表里任一 `active` 且 `roleKind==='admin'` 且设了 `passwordHash` 的行。
 * 返回 null = 该区没设过任何管理员密码（全新区/老库首次）→ 切入**不**验密
 * （没有可验之物；区内首次新建管理员时 0015 闸会先让它设密码，语义不变）。
 *
 * ⚠️ 必须走**带外读**（不传版本的 `indexedDB.open`）：目标库可能仍是老版本
 * （ws-default 绑定的存量库），带 schema 声明打开会**绕过 RepoProvider 的
 * 迁移前备份闸门直接触发升级**——那是 L1 回滚凭据的硬前提，绝不能破。
 * `Dexie.exists` 先确认库存在（对不存在的库裸 open 会把它建出来）。
 * 带外读不升级、不改数据（与 dexie.database.ts 的 readRawIdbVersion 同一实测口径）。
 */
export async function readWorkspaceGateHash(dbName: string): Promise<string | null> {
  const exists = await Dexie.exists(dbName);
  if (!exists) return null;

  const raw = await new Promise<unknown[] | null>((resolve) => {
    try {
      const req = globalThis.indexedDB.open(dbName);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('members', 'readonly');
          const store = tx.objectStore('members');
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            db.close();
            resolve(getAll.result as unknown[]);
          };
          getAll.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  if (raw === null) return null;

  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue;
    const m = row as Record<string, unknown>;
    if (m.active === false) continue;
    if (m.roleKind !== MemberRoleKind.Admin) continue;
    if (typeof m.passwordHash === 'string' && m.passwordHash) return m.passwordHash;
  }
  return null;
}

/** 类型引用保持（供外部扩展） */
export type { ChangxiaDatabase };
