/**
 * v0.3 LOW-2 边界迁移测试（增量 bug 修复新增用例）：
 *   1. 旧成员行 roleKind=undefined → 默认归一 'member'（与备份导入 zod .default('member') 口径一致）；
 *   2. 管理员恢复：系统无 active 管理员且 currentMemberId 指向旧行（active）→ 恢复 'admin'，
 *      避免旧管理员被降级为 member 而在日程表等守卫处被静默挡回首页；
 *   3. 已有显式 admin 时旧行一律归 'member'（绝不新增第二个 admin）；
 *   4. currentMemberId 指向停用旧行 → 不提权。
 * node 环境纯函数断言（normalizeLegacyMemberRoles），无需 DOM。
 */

import { describe, it, expect } from 'vitest';

import { normalizeLegacyMemberRoles } from '../src/hooks/useRoleGuard';
import { MemberActorKind, MemberRoleKind } from '../src/core/types/enums';
import type { Member } from '../src/core/types/entities';

function member(overrides: Partial<Member> & { id: string; name: string }): Member {
  return {
    role: '',
    contact: null,
    avatarColor: '#3D6B5B',
    active: true,
    roleKind: MemberRoleKind.Member,
    passwordHash: null,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    revision: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 模拟 v0.2 之前创建的旧成员行：roleKind 缺失（运行时 undefined） */
function legacyMember(
  overrides: Partial<Omit<Member, 'roleKind'>> & { id: string; name: string },
): Member {
  return {
    role: '',
    contact: null,
    avatarColor: '#3D6B5B',
    active: true,
    roleKind: undefined as unknown as MemberRoleKind,
    revision: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Member;
}

describe('normalizeLegacyMemberRoles：旧成员 roleKind 归一', () => {
  it('全部显式 roleKind → 原样返回（admin/member 保真）', () => {
    const admin = member({ id: 'mem_a', name: '齐活林', roleKind: MemberRoleKind.Admin });
    const normal = member({ id: 'mem_n', name: '许工' });
    const out = normalizeLegacyMemberRoles([admin, normal], null);
    expect(out).toEqual([admin, normal]);
  });

  it('旧行（undefined）且无管理员 → 默认归 member', () => {
    const legacy = legacyMember({ id: 'mem_old', name: '许工' });
    const out = normalizeLegacyMemberRoles([legacy], null);
    expect(out[0]!.roleKind).toBe(MemberRoleKind.Member);
  });

  it('旧行 + currentMemberId 命中该旧行（active）+ 无 admin → 恢复 admin（旧管理员找回）', () => {
    const legacy = legacyMember({ id: 'mem_owner', name: '齐活林' });
    const out = normalizeLegacyMemberRoles([legacy], 'mem_owner');
    expect(out[0]!.id).toBe('mem_owner');
    expect(out[0]!.roleKind).toBe(MemberRoleKind.Admin);
  });

  it('旧行 + 已有显式 admin → 旧行归 member（绝不新增第二个 admin）', () => {
    const admin = member({ id: 'mem_a', name: '齐活林', roleKind: MemberRoleKind.Admin });
    const legacy = legacyMember({ id: 'mem_old', name: '许工' });
    const out = normalizeLegacyMemberRoles([admin, legacy], 'mem_old');
    const old = out.find((m) => m.id === 'mem_old')!;
    expect(old.roleKind).toBe(MemberRoleKind.Member);
    expect(out.filter((m) => m.roleKind === MemberRoleKind.Admin)).toHaveLength(1);
  });

  it('currentMemberId 指向停用旧行 → 不提权，归 member', () => {
    const legacy = legacyMember({ id: 'mem_off', name: '停用旧管理员', active: false });
    const out = normalizeLegacyMemberRoles([legacy], 'mem_off');
    expect(out[0]!.roleKind).toBe(MemberRoleKind.Member);
  });

  it('多旧行 + 无 admin + currentMemberId 命中其一 → 仅该行提权，其余归 member', () => {
    const owner = legacyMember({ id: 'mem_owner', name: '齐活林' });
    const other = legacyMember({ id: 'mem_m', name: '许工' });
    const out = normalizeLegacyMemberRoles([owner, other], 'mem_owner');
    expect(out.find((m) => m.id === 'mem_owner')!.roleKind).toBe(MemberRoleKind.Admin);
    expect(out.find((m) => m.id === 'mem_m')!.roleKind).toBe(MemberRoleKind.Member);
  });

  it('currentMemberId=null 且无 admin → 不凭空制造管理员，全部旧行归 member', () => {
    const legacy = legacyMember({ id: 'mem_old', name: '许工' });
    const out = normalizeLegacyMemberRoles([legacy], null);
    expect(out[0]!.roleKind).toBe(MemberRoleKind.Member);
    expect(out.some((m) => m.roleKind === MemberRoleKind.Admin)).toBe(false);
  });
});
