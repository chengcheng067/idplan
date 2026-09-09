import { ChangxiaError, ChangxiaErrorCode, MemberActorKind, MemberRoleKind } from '../../types/enums';
import type { Member } from '../../types/entities';
import type { CreateMemberCmd, UpdateMemberCmd } from '../../types/dto';
import type { IMembersRepository } from '../interfaces';
import type { ChangxiaDatabase } from './dexie.database';
import { pickDefined } from './local.projects.repo';
import { hashPassword, verifyPassword } from '../../../lib/password';

/** Dexie 实现的成员仓储 */
export class LocalMembersRepository implements IMembersRepository {
  constructor(private readonly db: ChangxiaDatabase) {}

  async list(includeInactive?: boolean): Promise<Member[]> {
    try {
      const rows = await this.db.members.toArray();
      const filtered = includeInactive ? rows : rows.filter((m) => m.active);
      return filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '成员列表读取失败。', err);
    }
  }

  async get(id: string): Promise<Member | null> {
    try {
      return (await this.db.members.get(id)) ?? null;
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '成员读取失败。', err);
    }
  }

  async insert(cmd: CreateMemberCmd): Promise<Member> {
    if (!cmd.name?.trim()) {
      throw new ChangxiaError(ChangxiaErrorCode.Validation, '成员姓名不能为空。');
    }
    const now = new Date().toISOString();
    const row: Member = {
      id: crypto.randomUUID(),
      name: cmd.name.trim(),
      role: cmd.role?.trim() ?? '',
      contact: cmd.contact ?? null,
      avatarColor: cmd.avatarColor,
      active: true,
      // 角色默认 member（外部调用方零改动）；first-run 管理员提权经 roleKind:'admin' 显式传入
      roleKind: cmd.roleKind ?? MemberRoleKind.Member,
      // v0.6 密码系统：明文 password → Web Crypto PBKDF2 哈希；缺省/未设 → null（无密码）
      passwordHash: cmd.password ? await hashPassword(cmd.password) : null,
      // v0.6 Agent 身份（键序铁律：passwordHash 后、revision 前，与 entities.Member / memberSchema 同步）。
      // actorKind 默认 human（存量调用方零改动）；agentKind 为开放字符串、人类恒 null。
      actorKind: cmd.actorKind ?? MemberActorKind.Human,
      agentKind: cmd.agentKind ?? null,
      revision: 1,
      updatedAt: now,
    };
    try {
      await this.db.members.add(row);
      return row;
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '成员创建失败。', err);
    }
  }

  async update(id: string, cmd: UpdateMemberCmd): Promise<Member> {
    const existing = await this.db.members.get(id);
    if (!existing) {
      throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该成员。');
    }
    // password 语义：string → 设为明文密码（哈希入库）；null → 清除密码；
    // undefined → 不变（缺省，不进入 pickDefined 覆盖集合）。
    // 用 pickDefined 处理除 password 外的常规字段（只过滤 undefined，保留 null 清除语义）。
    const { password, ...rest } = cmd;
    const base = pickDefined(rest);
    const next: Member = {
      ...existing,
      ...base,
      ...(password !== undefined
        ? { passwordHash: password ? await hashPassword(password) : null }
        : {}),
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.db.members.put(next);
    return next;
  }

  /** 本地密码校验：Web Crypto PBKDF2 比对（见 src/lib/password.ts） */
  async verifyCredentials(memberId: string, password: string): Promise<boolean> {
    const existing = await this.db.members.get(memberId);
    if (!existing || !existing.active) return false;
    return verifyPassword(password, existing.passwordHash);
  }
}
