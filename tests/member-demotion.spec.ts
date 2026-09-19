/**
 * v0.3 变更 A：管理员降级边界测试（增量架构 4.2 新增用例）：
 *   1. countActiveAdmins 三态（唯一 / 多 / 停用不计 / 无）；
 *   2. 唯一 active 管理员时「取消管理员」按钮 disabled（isLastAdmin=true，纯函数组合断言）；
 *   3. 确认回调双保险拒绝（唯一 admin 时再次校验拒绝降级）。
 * node 环境纯函数断言；双保险拒绝逻辑 = 组件内 countActiveAdmins 再校验，此处以等价纯函数表达。
 */

import { describe, it, expect } from 'vitest';

import {
  countActiveAdmins,
  deriveRoleGuardState,
} from '../src/hooks/useRoleGuard';
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

const adminA = member({ id: 'mem_a', name: '齐活林', roleKind: MemberRoleKind.Admin });
const adminB = member({ id: 'mem_b', name: '王工', roleKind: MemberRoleKind.Admin });
const normal = member({ id: 'mem_n', name: '许工' });
const inactiveAdmin = member({
  id: 'mem_off',
  name: '停用管理员',
  roleKind: MemberRoleKind.Admin,
  active: false,
});

/** 组件等价判定：MemberRow 的 isLastAdmin（active 管理员且全库仅 1 名 active 管理员） */
function isLastAdmin(m: Member, members: Member[]): boolean {
  return (
    m.active &&
    m.roleKind === MemberRoleKind.Admin &&
    countActiveAdmins(members) === 1
  );
}

/** 组件等价判定：确认回调双保险——唯一 active 管理员时拒绝降级 */
function demoteBlocked(m: Member, members: Member[]): boolean {
  return (
    countActiveAdmins(members) === 1 &&
    members.some((x) => x.id === m.id && x.active && x.roleKind === MemberRoleKind.Admin)
  );
}

describe('countActiveAdmins：active 管理员计数', () => {
  it('无管理员 → 0', () => {
    expect(countActiveAdmins([normal])).toBe(0);
    expect(countActiveAdmins([])).toBe(0);
  });

  it('唯一 active 管理员 → 1', () => {
    expect(countActiveAdmins([adminA, normal])).toBe(1);
  });

  it('多个 active 管理员 → 数量', () => {
    expect(countActiveAdmins([adminA, adminB, normal])).toBe(2);
  });

  it('停用管理员不计入（与 hasAdmin 语义一致）', () => {
    expect(countActiveAdmins([inactiveAdmin, normal])).toBe(0);
    expect(countActiveAdmins([adminA, inactiveAdmin])).toBe(1);
  });
});

describe('降级边界：唯一 active 管理员保护', () => {
  it('唯一 active 管理员 → isLastAdmin=true（取消管理员按钮 disabled）', () => {
    expect(isLastAdmin(adminA, [adminA, normal])).toBe(true);
  });

  it('多个 active 管理员 → isLastAdmin=false（可降级）', () => {
    expect(isLastAdmin(adminA, [adminA, adminB, normal])).toBe(false);
  });

  it('停用管理员不是唯一保护对象 → 不参与计数', () => {
    expect(isLastAdmin(adminA, [adminA, inactiveAdmin])).toBe(true);
    expect(isLastAdmin(inactiveAdmin, [inactiveAdmin])).toBe(false);
  });

  it('确认回调双保险：唯一 admin 时降级被拒绝', () => {
    expect(demoteBlocked(adminA, [adminA, normal])).toBe(true);
    expect(demoteBlocked(adminA, [adminA, adminB])).toBe(false);
    // 非管理员不受保护（本来就没有管理员权限）
    expect(demoteBlocked(normal, [adminA, normal])).toBe(false);
  });
});

describe('降级自己的视角切换链（store 同步 → useRoleGuard 派生重算）', () => {
  it('降级自己后 deriveRoleGuardState 重算为 member（isAdmin=false / isMember=true）', () => {
    const before = deriveRoleGuardState([adminA, normal], adminA.id, true);
    expect(before.isAdmin).toBe(true);
    // 模拟 repo.update + store.upsert 后的 members 快照
    const afterMembers = [
      member({ id: 'mem_a', name: '齐活林', roleKind: MemberRoleKind.Member }),
      normal,
    ];
    const after = deriveRoleGuardState(afterMembers, adminA.id, true);
    expect(after.role).toBe(MemberRoleKind.Member);
    expect(after.isAdmin).toBe(false);
    expect(after.isMember).toBe(true);
    // HomeRouteGuard 依据 isMember → /my-tasks
    expect(after.isMember ? '/my-tasks' : '/').toBe('/my-tasks');
  });

  it('降级他人：当前管理员视角不变；被降级者下次进入即成员视角', () => {
    const adminView = deriveRoleGuardState([adminA, adminB, normal], adminA.id, true);
    expect(adminView.isAdmin).toBe(true);
    // 被降级者 B 重进（currentMemberId=B，members 中 B 已是 member）
    const afterB = [
      adminA,
      member({ id: 'mem_b', name: '王工', roleKind: MemberRoleKind.Member }),
      normal,
    ];
    const bView = deriveRoleGuardState(afterB, adminB.id, true);
    expect(bView.isAdmin).toBe(false);
    expect(bView.isMember).toBe(true);
  });
});
