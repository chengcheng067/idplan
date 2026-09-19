/**
 * 角色集中收口层测试（增量架构 4.2 表）：
 *   1. hasAdmin 判定（无 / 有 / 仅停用 admin）；
 *   2. 角色推导（admin / member / 未进入）；
 *   3. 姓名匹配命中 / 未命中（成员进入主路径）；
 *   4. 成员勾选权限（仅 assigneeId===me 可勾选）；
 *   5. HomeRouteGuard 路由决策（isMember → /my-tasks）。
 * 以纯函数断言（deriveRoleGuardState 等），node 环境无需 DOM。
 */

import { describe, it, expect } from 'vitest';

import {
  deriveRoleGuardState,
  matchActiveMemberByName,
  canMemberToggleTask,
  homeRouteTarget,
  isRestrictedView,
  computeRelatedStageIds,
  taskAssigneeIds,
  sameAssigneeSet,
  countActiveAdmins,
} from '../src/hooks/useRoleGuard';
import { MemberActorKind, MemberRoleKind, StageStatus, TaskStatus } from '../src/core/types/enums';
import type { Member, Stage, Task } from '../src/core/types/entities';

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

const admin = member({ id: 'mem_admin', name: '齐活林', roleKind: MemberRoleKind.Admin });
const normal = member({ id: 'mem_member', name: '许工', role: '主案' });
const inactiveAdmin = member({
  id: 'mem_admin_off',
  name: '停用管理员',
  roleKind: MemberRoleKind.Admin,
  active: false,
});

describe('deriveRoleGuardState：hasAdmin 判定', () => {
  it('无任何成员 → hasAdmin=false', () => {
    const s = deriveRoleGuardState([], null, true);
    expect(s.hasAdmin).toBe(false);
  });

  it('有 active 管理员 → hasAdmin=true', () => {
    const s = deriveRoleGuardState([normal, admin], null, true);
    expect(s.hasAdmin).toBe(true);
  });

  it('仅停用管理员 → hasAdmin=false（停用 admin 不视为存在管理员）', () => {
    const s = deriveRoleGuardState([normal, inactiveAdmin], null, true);
    expect(s.hasAdmin).toBe(false);
  });
});

describe('deriveRoleGuardState：角色推导', () => {
  it('currentMemberId 命中 admin → isAdmin=true / isMember=false / role=admin', () => {
    const s = deriveRoleGuardState([normal, admin], admin.id, true);
    expect(s.role).toBe(MemberRoleKind.Admin);
    expect(s.isAdmin).toBe(true);
    expect(s.isMember).toBe(false);
    expect(s.isEntered).toBe(true);
    expect(s.currentMember?.id).toBe(admin.id);
  });

  it('currentMemberId 命中 member → isMember=true', () => {
    const s = deriveRoleGuardState([normal, admin], normal.id, true);
    expect(s.role).toBe(MemberRoleKind.Member);
    expect(s.isMember).toBe(true);
    expect(s.isAdmin).toBe(false);
  });

  it('未进入（currentMemberId=null）→ role=null / isEntered=false', () => {
    const s = deriveRoleGuardState([normal, admin], null, true);
    expect(s.role).toBeNull();
    expect(s.isEntered).toBe(false);
    expect(s.currentMember).toBeNull();
  });

  it('currentMemberId 指向停用成员 → 视为未进入（active 才有效）', () => {
    const off = member({ id: 'mem_off', name: '已停用', active: false });
    const s = deriveRoleGuardState([off, admin], off.id, true);
    expect(s.role).toBeNull();
    expect(s.isEntered).toBe(false);
  });

  it('hydrated 透传（bootstrap 完成信号）', () => {
    expect(deriveRoleGuardState([], null, false).hydrated).toBe(false);
    expect(deriveRoleGuardState([], null, true).hydrated).toBe(true);
  });
});

describe('matchActiveMemberByName：姓名匹配', () => {
  it('命中 active 成员（trim 归一）→ 返回该成员', () => {
    const hit = matchActiveMemberByName([normal, admin], '  许工 ');
    expect(hit?.id).toBe(normal.id);
  });

  it('命中管理员 → 返回管理员（管理员进入管理员视角）', () => {
    const hit = matchActiveMemberByName([normal, admin], '齐活林');
    expect(hit?.id).toBe(admin.id);
  });

  it('未命中 → null（不进入，停留提示）', () => {
    expect(matchActiveMemberByName([normal, admin], '不存在的人')).toBeNull();
  });

  it('停用成员不参与匹配 → null', () => {
    expect(matchActiveMemberByName([inactiveAdmin], '停用管理员')).toBeNull();
  });

  it('空输入 → null', () => {
    expect(matchActiveMemberByName([normal, admin], '   ')).toBeNull();
  });

  it('重名取首个 active 匹配项（已知边界）', () => {
    const dup1 = member({ id: 'mem_dup1', name: '张三' });
    const dup2 = member({ id: 'mem_dup2', name: '张三' });
    expect(matchActiveMemberByName([dup1, dup2], '张三')?.id).toBe(dup1.id);
  });
});

describe('canMemberToggleTask：成员勾选权限（v0.3 参与人包含）', () => {
  it('成员仅可勾选 assigneeId===me 的条目（旧数据回落：无 assigneeIds）', () => {
    expect(canMemberToggleTask('mem_member', { assigneeId: 'mem_member' })).toBe(true);
    expect(canMemberToggleTask('mem_member', { assigneeId: 'mem_other' })).toBe(false);
    expect(canMemberToggleTask('mem_member', { assigneeId: null })).toBe(false);
  });

  it('多人任务：任一参与人均可勾选（assigneeIds 包含）', () => {
    const multi = { assigneeId: 'mem_a', assigneeIds: ['mem_a', 'mem_b'] };
    expect(canMemberToggleTask('mem_a', multi)).toBe(true);
    expect(canMemberToggleTask('mem_b', multi)).toBe(true);
    expect(canMemberToggleTask('mem_c', multi)).toBe(false);
  });

  it('assigneeIds 为空数组时回落 assigneeId（旧数据兼容）', () => {
    const legacy = { assigneeId: 'mem_a', assigneeIds: [] };
    expect(canMemberToggleTask('mem_a', legacy)).toBe(true);
    expect(canMemberToggleTask('mem_b', legacy)).toBe(false);
  });

  it('未进入（memberId=null）不可勾选', () => {
    expect(canMemberToggleTask(null, { assigneeId: null })).toBe(false);
    expect(canMemberToggleTask(null, { assigneeId: 'mem_a', assigneeIds: ['mem_a'] })).toBe(false);
  });
});

describe('taskAssigneeIds：有效参与人读取收口（v0.3）', () => {
  it('assigneeIds 多值 → 原样返回', () => {
    expect(taskAssigneeIds({ assigneeId: 'A', assigneeIds: ['A', 'B'] })).toEqual(['A', 'B']);
  });

  it('assigneeIds=[] 且 assigneeId 有值 → 回落 [assigneeId]（旧数据）', () => {
    expect(taskAssigneeIds({ assigneeId: 'A', assigneeIds: [] })).toEqual(['A']);
  });

  it('assigneeIds 缺省（undefined）→ 回落 [assigneeId]', () => {
    expect(taskAssigneeIds({ assigneeId: 'A' })).toEqual(['A']);
  });

  it('全空 → []（未指派）', () => {
    expect(taskAssigneeIds({ assigneeId: null, assigneeIds: [] })).toEqual([]);
    expect(taskAssigneeIds({ assigneeId: null })).toEqual([]);
  });

  it('返回副本，不引用原数组', () => {
    const src = { assigneeId: 'A', assigneeIds: ['A'] };
    const out = taskAssigneeIds(src);
    out.push('X');
    expect(src.assigneeIds).toEqual(['A']);
  });
});

describe('sameAssigneeSet：集合级指派流水去重判定（v0.3）', () => {
  it('顺序无关 → 相等', () => {
    expect(sameAssigneeSet(['A', 'B'], ['B', 'A'])).toBe(true);
  });

  it('重复去重 → 相等', () => {
    expect(sameAssigneeSet(['A', 'A', 'B'], ['B', 'A'])).toBe(true);
  });

  it('集合不同 → false', () => {
    expect(sameAssigneeSet(['A', 'B'], ['A', 'C'])).toBe(false);
    expect(sameAssigneeSet(['A'], [])).toBe(false);
  });

  it('空集与空集 → 相等', () => {
    expect(sameAssigneeSet([], [])).toBe(true);
  });
});

describe('countActiveAdmins：active 管理员计数（v0.3 降级保护）', () => {
  it('无管理员 → 0', () => {
    expect(countActiveAdmins([normal])).toBe(0);
  });

  it('唯一 active 管理员 → 1', () => {
    expect(countActiveAdmins([admin, normal])).toBe(1);
  });

  it('多个 active 管理员 → 数量', () => {
    const admin2 = member({ id: 'mem_admin2', name: '王工', roleKind: MemberRoleKind.Admin });
    expect(countActiveAdmins([admin, admin2, normal])).toBe(2);
  });

  it('停用管理员不计入', () => {
    expect(countActiveAdmins([inactiveAdmin, normal])).toBe(0);
    expect(countActiveAdmins([admin, inactiveAdmin])).toBe(1);
  });
});

describe('homeRouteTarget：落地页路由决策', () => {
  it('isMember → /member-board（成员进入自己的项目看板，仅见相关项目）', () => {
    expect(homeRouteTarget(true)).toBe('/member-board');
  });

  it('非成员 → /（首页）', () => {
    expect(homeRouteTarget(false)).toBe('/');
  });
});

/**
 * BUG-1 回归（QA 严过关）：受限视图判定必须是「非管理员即受限」（!isAdmin 语义），
 * 绝不能是 isMember——未进入身份（role=null）时 isMember=false，
 * 若被当作管理员即可见敏感字段并获写权限（拖拽改期/归档）。
 */
describe('isRestrictedView：受限视图判定（BUG-1 回归）', () => {
  it('管理员 → 不受限（全量可见可写）', () => {
    expect(isRestrictedView(MemberRoleKind.Admin)).toBe(false);
  });

  it('成员 → 受限', () => {
    expect(isRestrictedView(MemberRoleKind.Member)).toBe(true);
  });

  it('未进入身份（role=null）→ 受限（不允许当管理员处理）', () => {
    expect(isRestrictedView(null)).toBe(true);
  });
});

describe('computeRelatedStageIds：项目详情相关阶段（BUG-1 回归）', () => {
  const stages: Stage[] = [
    { id: 'stg_1', projectId: 'proj_1', orderIndex: 1, templateKey: null, colorIndex: 1, customColor: null, name: '提案', ratioPercent: 5, startAt: '2026-08-01', endAt: '2026-08-07', status: StageStatus.NotStarted, ownerId: null, visible: true, resourcePath: null, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
    { id: 'stg_2', projectId: 'proj_1', orderIndex: 2, templateKey: null, colorIndex: 2, customColor: null, name: '测量', ratioPercent: 4, startAt: '2026-08-08', endAt: '2026-08-13', status: StageStatus.NotStarted, ownerId: 'mem_member', visible: true, resourcePath: null, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
    { id: 'stg_3', projectId: 'proj_1', orderIndex: 3, templateKey: null, colorIndex: 3, customColor: null, name: '平面方案', ratioPercent: 11, startAt: '2026-08-14', endAt: '2026-08-29', status: StageStatus.NotStarted, ownerId: null, visible: true, resourcePath: null, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
  ];
  const tasks: Task[] = [
    { id: 'tsk_1', taskNo: null, projectId: 'proj_1', stageId: 'stg_3', title: '平面布局', done: false, assigneeId: 'mem_member', assigneeIds: [], dueDate: '2026-08-29', source: 'human', externalId: null, agentId: null, status: TaskStatus.Draft, description: null, dependsOn: [], artifacts: [], startAt: null, claimedAt: null, orderIndex: 1, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
  ];

  it('管理员 → null（全量渲染全部阶段）', () => {
    const ids = computeRelatedStageIds({
      memberView: false,
      currentMemberId: 'mem_admin',
      stages,
      tasks,
    });
    expect(ids).toBeNull();
  });

  it('成员 → 仅相关阶段（自己负责 ownerId 或存在自己名下任务 assigneeId）', () => {
    const ids = computeRelatedStageIds({
      memberView: true,
      currentMemberId: 'mem_member',
      stages,
      tasks,
    });
    expect(ids).not.toBeNull();
    expect([...(ids as Set<string>)].sort()).toEqual(['stg_2', 'stg_3']);
  });

  it('多人任务：成员因参与某任务（assigneeIds 含 me）而看到该阶段', () => {
    const multiTasks: Task[] = [
      { id: 'tsk_multi', taskNo: null, projectId: 'proj_1', stageId: 'stg_3', title: '平面深化', done: false, assigneeId: 'mem_other', assigneeIds: ['mem_other', 'mem_member'], dueDate: '2026-08-29', source: 'human', externalId: null, agentId: null, status: TaskStatus.Draft, description: null, dependsOn: [], artifacts: [], startAt: null, claimedAt: null, orderIndex: 2, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
    ];
    const ids = computeRelatedStageIds({
      memberView: true,
      currentMemberId: 'mem_member',
      stages,
      tasks: multiTasks,
    });
    expect(ids).not.toBeNull();
    // stg_2 因 ownerId=me 命中；stg_3 因参与任务（assigneeIds 含 me）命中
    expect([...(ids as Set<string>)].sort()).toEqual(['stg_2', 'stg_3']);
  });

  it('未进入身份（memberView=true 且 currentMemberId=null）→ 空集（受限空态，无任何阶段可见）', () => {
    const ids = computeRelatedStageIds({
      memberView: true,
      currentMemberId: null,
      stages,
      tasks,
    });
    expect(ids).not.toBeNull();
    expect(ids?.size).toBe(0);
  });

  it('成员与项目完全无关 → 空集（「该项目的阶段与你无关」空态）', () => {
    const ids = computeRelatedStageIds({
      memberView: true,
      currentMemberId: 'mem_other',
      stages,
      tasks,
    });
    expect(ids?.size).toBe(0);
  });
});
