/**
 * 打印视图模型 · 权限过滤与派生口径单测（02 文档 §9 单元测试清单 + §10 第 1 步）。
 *
 * ── 为什么这个 spec 必须先于任何页面 ──
 * VM 装配顺序就是权限口径：角色 → computeRelatedStageIds → visible 过滤 →
 * clientName 门控 → 派生统计。任何一步写错都是**越权泄露**（成员看到客户名 /
 * 隐藏阶段 / 别人的任务），而页面渲染层发现不了。故这里是纯函数断言，
 * 不碰 React / DOM（node 环境）。
 *
 * 锁的七条（对应 02 §9）：
 *   ① 管理员 / 普通成员快照不同；
 *   ② clientName 不进普通成员 VM（是 undefined，不是「渲染层隐藏」）；
 *   ③ visible=false 阶段不进 VM、不计完成度、其任务/流水不进 VM；
 *   ④ 三类延期口径不混（项目逾期 / 阶段延期 / 任务逾期各自判据，禁造原因）；
 *   ⑤ agentKind 未知值原样进 VM（开放字符串，禁止收枚举）；
 *   ⑥ 派生统计复用 lib/progress（完成度不按 ratioPercent 加权；阶段任务 done/total）；
 *   ⑦ 执行 / 提案按可见任务收窄；confidence 仅展示。
 */
import { describe, it, expect } from 'vitest';

import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageLogType,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import { ExecutionStatus, WritebackProposalStatus } from '../src/core/types/agent-execution';
import type {
  Execution,
  Member,
  Project,
  Stage,
  StageLog,
  Task,
  WritebackProposal,
} from '../src/core/types/entities';

/* ====================================================================================
 * 夹具：4 阶段（1 隐藏）× 5 任务（1 在隐藏阶段）× 5 成员（1 停用）× 4 流水（1 在隐藏阶段）
 * 今天固定 2026-10-09（注入 todayIso，不读系统时钟——纯函数可测）。
 * ==================================================================================== */

const TODAY = '2026-10-09';
const PROJECT_ID = 'proj_print_vm';
const ADMIN_ID = 'm-vm-admin';
const MEMBER_ID = 'm-vm-member';
const INACTIVE_ID = 'm-vm-inactive';
const AGENT_ID = 'm-vm-agent';
const OUTSIDER_ID = 'm-vm-outsider';

const PROJECT: Project = {
  id: PROJECT_ID,
  name: '云栖·湖畔茶室',
  address: '城区某路 1 号',
  clientName: '客户甲',
  contractAmount: 880000,
  signedAt: '2026-01-01T00:00:00Z',
  plannedStartAt: '2026-01-01T00:00:00Z',
  plannedEndAt: '2026-03-01T23:59:59Z',
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  domain: null,
  kind: 'human',
  ownerMemberId: null,
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

function member(id: string, name: string, roleKind: MemberRoleKind, actorKind: MemberActorKind, agentKind: string | null, active = true): Member {
  return {
    id,
    name,
    role: roleKind === MemberRoleKind.Admin ? '项目负责人' : '协作成员',
    contact: null,
    avatarColor: '#3D6B5B',
    active,
    roleKind,
    passwordHash: null,
    actorKind,
    agentKind,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const MEMBERS: Member[] = [
  member(ADMIN_ID, '负责人甲', MemberRoleKind.Admin, MemberActorKind.Human, null),
  member(MEMBER_ID, '成员乙', MemberRoleKind.Member, MemberActorKind.Human, null),
  // 停用成员：被可见任务引用，但名册只收 active（责任表现状）
  member(INACTIVE_ID, '停用丙', MemberRoleKind.Member, MemberActorKind.Human, null, false),
  // Agent 成员：agentKind 是**开放字符串**——刻意用一个不存在的 harness 名
  member(AGENT_ID, '小 Agent', MemberRoleKind.Member, MemberActorKind.Agent, 'brand-new-harness-9000'),
];

function stage(id: string, orderIndex: number, status: StageStatus, ownerId: string | null, visible: boolean): Stage {
  return {
    id,
    projectId: PROJECT_ID,
    orderIndex,
    templateKey: null,
    colorIndex: ((orderIndex - 1) % 9) + 1,
    customColor: null,
    name: `阶段${orderIndex}`,
    ratioPercent: 25,
    startAt: '2026-01-05T00:00:00Z',
    endAt: '2026-01-20T23:59:59Z',
    status,
    ownerId,
    visible,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const STAGES: Stage[] = [
  stage('stg_vm_1', 1, StageStatus.Completed, ADMIN_ID, true),
  stage('stg_vm_2', 2, StageStatus.InProgress, ADMIN_ID, true),
  // 阶段延期：status=delayed，且有一条带 reason 的改期流水
  stage('stg_vm_3', 3, StageStatus.Delayed, MEMBER_ID, true),
  // 隐藏阶段：任务/流水都在它下面，必须整体不进普通成员输出
  stage('stg_vm_4', 4, StageStatus.Completed, ADMIN_ID, false),
];

function task(id: string, taskNo: number | null, stageId: string, status: TaskStatus, assigneeIds: string[], dueDate: string | null, agentId: string | null = null): Task {
  return {
    id,
    taskNo,
    projectId: PROJECT_ID,
    stageId,
    title: `任务${taskNo ?? '老'}`,
    done: status === TaskStatus.Done,
    assigneeId: assigneeIds[0] ?? null,
    assigneeIds,
    dueDate,
    source: 'human',
    externalId: null,
    agentId,
    status,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    runId: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const TASKS: Task[] = [
  // 已完成 + 截止日已过 ⇒ **不是**任务逾期（口径三的 done 例外）
  task('tsk_vm_1', 1001, 'stg_vm_1', TaskStatus.Done, [ADMIN_ID, INACTIVE_ID], '2026-02-01'),
  // 未完成 + 截止日已过 ⇒ 任务逾期；与它所在阶段（进行中）的状态无关
  task('tsk_vm_2', 1002, 'stg_vm_2', TaskStatus.InProgress, [ADMIN_ID, MEMBER_ID], '2026-10-01'),
  // Agent 产出任务：截止日在未来 ⇒ 不逾期
  task('tsk_vm_3', 1003, 'stg_vm_3', TaskStatus.Blocked, [MEMBER_ID], '2026-12-01', AGENT_ID),
  // 隐藏阶段下的任务：截止日已过，但任何角色都不该看见它
  task('tsk_vm_4', 1004, 'stg_vm_4', TaskStatus.Ready, [INACTIVE_ID], '2026-09-01'),
  // 老数据：taskNo=null，未指派，无截止日
  task('tsk_vm_5', null, 'stg_vm_2', TaskStatus.Draft, [], null),
];
TASKS[0]!.artifacts = [
  { id: 'art_1', kind: 'task_md', title: '需求稿', path: null, url: null, note: null },
  { id: 'art_2', kind: 'doc', title: '会议纪要', path: null, url: null, note: null },
];

function log(id: string, stageId: string, type: StageLogType, createdAt: string, opts: Partial<StageLog> = {}): StageLog {
  return {
    id,
    stageId,
    projectId: PROJECT_ID,
    type,
    fromStatus: null,
    toStatus: null,
    oldStartAt: null,
    newStartAt: null,
    oldEndAt: null,
    newEndAt: null,
    reason: null,
    operatorName: '成员乙',
    createdAt,
    ...opts,
  };
}

const STAGE_LOGS: StageLog[] = [
  // 阶段延期的改期流水：reason 必填，旧/新结束日都在
  log('log_vm_1', 'stg_vm_3', StageLogType.Rescheduled, '2026-02-15T02:00:00Z', {
    oldEndAt: '2026-02-10T23:59:59Z',
    newEndAt: '2026-02-20T23:59:59Z',
    reason: '等客户确认材料',
  }),
  log('log_vm_2', 'stg_vm_3', StageLogType.StatusChanged, '2026-02-16T02:00:00Z', {
    fromStatus: StageStatus.InProgress,
    toStatus: StageStatus.Delayed,
  }),
  log('log_vm_3', 'stg_vm_4', StageLogType.Rescheduled, '2026-02-17T02:00:00Z', {
    oldEndAt: '2026-02-10T23:59:59Z',
    newEndAt: '2026-02-25T23:59:59Z',
    reason: '隐藏阶段改期（不该出现）',
  }),
  log('log_vm_4', 'stg_vm_1', StageLogType.Created, '2026-01-01T00:00:00Z'),
];

const EXECUTIONS: Execution[] = [
  {
    id: 'exec_vm_1',
    projectId: PROJECT_ID,
    taskId: 'tsk_vm_2',
    source: 'project-task',
    objective: '整理会议纪要',
    agentMemberId: AGENT_ID,
    channelKind: 'loopback',
    inputSnapshotHash: null,
    status: ExecutionStatus.Running,
    confirmation: null,
    idempotencyKey: 'exec:project-task:proj_print_vm:t2',
    currentAttemptNo: 2,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    startedAt: '2026-09-01T01:00:00Z',
    finishedAt: null,
    terminalReason: null,
    blockedReason: null,
  },
  {
    id: 'exec_vm_hidden',
    projectId: PROJECT_ID,
    // 挂在隐藏阶段任务下 ⇒ 必须被收窄掉
    taskId: 'tsk_vm_4',
    source: 'natural-language',
    objective: '不该出现的执行',
    agentMemberId: AGENT_ID,
    channelKind: null,
    inputSnapshotHash: null,
    status: ExecutionStatus.Completed,
    confirmation: null,
    idempotencyKey: 'exec:natural-language:proj_print_vm:hidden',
    currentAttemptNo: 1,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    terminalReason: null,
    blockedReason: null,
  },
];

const PROPOSALS: WritebackProposal[] = [
  {
    id: 'wb_vm_1',
    executionId: 'exec_vm_1',
    attemptId: null,
    projectId: PROJECT_ID,
    taskId: 'tsk_vm_2',
    operations: [
      { field: 'task.status', before: 'in_progress', after: 'review' },
      { field: 'task.notes.append', before: null, after: '已补充说明' },
    ],
    status: WritebackProposalStatus.Proposed,
    idempotencyKey: 'wb:exec_vm_1:tsk_vm_2:task.status',
    reason: '状态推进',
    // confidence 仅展示（01 §3.3）
    confidence: 0.42,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-09-02T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
  },
];

function build(role: MemberRoleKind | null, currentMemberId: string | null) {
  return buildPrintViewModel({
    project: PROJECT,
    stages: STAGES,
    tasks: TASKS,
    members: MEMBERS,
    stageLogs: STAGE_LOGS,
    executions: EXECUTIONS,
    proposals: PROPOSALS,
    role,
    currentMemberId,
    todayIso: TODAY,
    now: new Date('2026-10-09T07:30:00Z'),
  });
}

/* ====================================================================================
 * 断言
 * ==================================================================================== */

describe('PrintViewModel · 权限过滤（02 §9）', () => {
  it('① 管理员 / 普通成员快照不同：成员只见相关阶段，任务随之收窄', () => {
    const admin = build(MemberRoleKind.Admin, ADMIN_ID);
    const memberVm = build(MemberRoleKind.Member, MEMBER_ID);

    expect(admin.stages.map((s) => s.orderIndex)).toEqual([1, 2, 3]);
    expect(memberVm.stages.map((s) => s.orderIndex)).toEqual([2, 3]);
    // 成员的任务只有可见阶段下的；管理员的可见任务多一条（stg_1 的 tsk_vm_1）
    expect(admin.tasks.map((t) => t.id)).toEqual(['tsk_vm_1', 'tsk_vm_2', 'tsk_vm_3', 'tsk_vm_5']);
    expect(memberVm.tasks.map((t) => t.id)).toEqual(['tsk_vm_2', 'tsk_vm_3', 'tsk_vm_5']);
    expect(admin.viewerRole).toBe('admin');
    expect(memberVm.viewerRole).toBe('member');
  });

  it('①b 未进入身份（role=null）按成员口径：相关阶段空集，不是全量', () => {
    const vm = build(null, null);
    expect(vm.stages).toEqual([]);
    expect(vm.tasks).toEqual([]);
    expect(vm.viewerRole).toBe('member');
  });

  it('①c 与项目无关的成员：相关阶段空集', () => {
    const vm = build(MemberRoleKind.Member, OUTSIDER_ID);
    expect(vm.stages).toEqual([]);
    expect(vm.project.clientName).toBeUndefined();
  });

  it('② clientName 仅管理员进 VM；普通成员是 undefined（不是渲染层隐藏）', () => {
    expect(build(MemberRoleKind.Admin, ADMIN_ID).project.clientName).toBe('客户甲');
    const memberVm = build(MemberRoleKind.Member, MEMBER_ID);
    expect(memberVm.project.clientName).toBeUndefined();
    // 未进入同样 undefined
    expect(build(null, null).project.clientName).toBeUndefined();
  });

  it('③ visible=false 阶段不进 VM、不计完成度，其任务与流水一并收窄', () => {
    const vm = build(MemberRoleKind.Admin, ADMIN_ID);
    expect(vm.stages.some((s) => s.orderIndex === 4)).toBe(false);
    expect(vm.tasks.some((t) => t.id === 'tsk_vm_4')).toBe(false);
    expect(vm.stageLogs.some((l) => l.id === 'log_vm_3')).toBe(false);
    // 完成度 = 已完成可见阶段 1 / 可见阶段 3（隐藏的 stg_4 已完成但不计入，
    // ratioPercent 全是 25 也不参与加权）
    expect(vm.project.percent).toBeCloseTo((1 / 3) * 100, 6);
    expect(vm.project.visibleStageCount).toBe(3);
  });

  it('④ 三类延期口径不混：项目逾期 / 阶段延期 / 任务逾期各自判据', () => {
    const vm = build(MemberRoleKind.Admin, ADMIN_ID);

    // 口径一 · 项目逾期：结束日 2026-03-01 早于今天且未完成 ⇒ true；且没有任何「原因」
    expect(vm.project.projectOverdue).toBe(true);

    // 口径二 · 阶段延期：只有 status=delayed 的阶段算，理由来自真实 StageLog
    const delayed = vm.stages.filter((s) => s.status === StageStatus.Delayed);
    expect(delayed.map((s) => s.orderIndex)).toEqual([3]);
    const reschedule = vm.stageLogs.find((l) => l.id === 'log_vm_1')!;
    expect(reschedule.reason).toBe('等客户确认材料');
    expect(reschedule.oldEndAt).toBe('2026-02-10');
    expect(reschedule.newEndAt).toBe('2026-02-20');

    // 口径三 · 任务逾期：dueDate < today 且 status !== done——与所在阶段状态无关
    const byId = new Map(vm.tasks.map((t) => [t.id, t]));
    expect(byId.get('tsk_vm_2')!.overdue).toBe(true); // 进行中阶段里的逾期任务
    expect(byId.get('tsk_vm_1')!.overdue).toBe(false); // done 的例外
    expect(byId.get('tsk_vm_3')!.overdue).toBe(false); // 截止日在未来
    // 延期阶段（stg_3）里的任务本身不逾期 ⇒ 两类不互相推导
    expect(byId.get('tsk_vm_3')!.stageId).toBe('stg_vm_3');
    // 任务投影没有 reason 字段——禁为任务逾期造原因（02 §4 禁止清单）
    expect(byId.get('tsk_vm_2')).not.toHaveProperty('reason');
  });

  it('④b 项目未逾期：结束日在未来 或 已完成 ⇒ projectOverdue=false', () => {
    const future = buildPrintViewModel({
      ...base(),
      project: { ...PROJECT, plannedEndAt: '2026-12-01T23:59:59Z' },
      todayIso: TODAY,
    });
    expect(future.project.projectOverdue).toBe(false);

    const allDone = buildPrintViewModel({
      ...base(),
      stages: STAGES.filter((s) => s.visible).map((s) => ({ ...s, status: StageStatus.Completed })),
      todayIso: TODAY,
    });
    expect(allDone.project.projectOverdue).toBe(false);
  });

  it('⑤ agentKind 未知值原样进 VM；Agent 行排在名册最前', () => {
    const vm = build(MemberRoleKind.Admin, ADMIN_ID);
    const agent = vm.members.find((m) => m.id === AGENT_ID)!;
    expect(agent.agentKind).toBe('brand-new-harness-9000');
    expect(agent.actorKind).toBe(MemberActorKind.Agent);
    expect(vm.members[0]!.id).toBe(AGENT_ID);
  });

  it('⑤b 名册只收 active；负责任务数只数可见阶段下的任务', () => {
    const vm = build(MemberRoleKind.Admin, ADMIN_ID);
    expect(vm.members.some((m) => m.id === INACTIVE_ID)).toBe(false);
    const count = (id: string): number => vm.members.find((m) => m.id === id)?.taskCount ?? -1;
    expect(count(ADMIN_ID)).toBe(2); // tsk_vm_1 + tsk_vm_2
    expect(count(MEMBER_ID)).toBe(2); // tsk_vm_2 + tsk_vm_3
    expect(count(AGENT_ID)).toBe(1); // tsk_vm_3
  });

  it('⑥ 派生统计复用 lib/progress：阶段任务 done/total，完成度不按 ratioPercent', () => {
    const vm = build(MemberRoleKind.Admin, ADMIN_ID);
    const s2 = vm.stages.find((s) => s.orderIndex === 2)!;
    expect(s2.taskProgress).toEqual({ done: 0, total: 2 }); // tsk_vm_2 进行中 + tsk_vm_5 草稿
    const s1 = vm.stages.find((s) => s.orderIndex === 1)!;
    expect(s1.taskProgress).toEqual({ done: 1, total: 1 });
    // 产出物数量上屏（E 版消费；此处先锁 VM 口径）
    expect(vm.tasks.find((t) => t.id === 'tsk_vm_1')!.artifactCount).toBe(2);
  });

  it('⑥b taskNo 原样携带（null = 老数据）；依赖 id 原样携带', () => {
    const vm = build(MemberRoleKind.Admin, ADMIN_ID);
    expect(vm.tasks.find((t) => t.id === 'tsk_vm_5')!.taskNo).toBeNull();
    const withDep = buildPrintViewModel({
      ...base(),
      tasks: TASKS.map((t) => (t.id === 'tsk_vm_2' ? { ...t, dependsOn: ['tsk_vm_1', 'tsk_missing'] } : t)),
      todayIso: TODAY,
    });
    expect(withDep.tasks.find((t) => t.id === 'tsk_vm_2')!.dependsOn).toEqual(['tsk_vm_1', 'tsk_missing']);
  });

  it('⑦ 执行 / 提案按可见任务收窄；confidence 仅展示；operations 只携字段名', () => {
    const vm = build(MemberRoleKind.Admin, ADMIN_ID);
    expect(vm.executions.map((e) => e.id)).toEqual(['exec_vm_1']);
    expect(vm.executions[0]!.runId).toBeNull();
    expect(vm.executions[0]!.agentName).toBe('小 Agent');
    const p = vm.proposals[0]!;
    expect(p.confidence).toBe(0.42);
    expect(p.operations.map((o) => o.field)).toEqual(['task.status', 'task.notes.append']);
    expect(p.operations[0]).not.toHaveProperty('before');
  });

  it('⑧ generatedAt / 排期基准标签 / todayIso 注入生效', () => {
    const vm = build(MemberRoleKind.Admin, ADMIN_ID);
    expect(vm.generatedAt).toBe('2026-10-09T07:30:00.000Z');
    expect(vm.project.scheduleBasisLabel).toBe('按自然日');
    expect(vm.project.todayIso).toBe(TODAY);
  });

  it('⑨ 阶段流水按时间倒序（台账新→旧），隐藏阶段的流水不漏出', () => {
    const vm = build(MemberRoleKind.Admin, ADMIN_ID);
    expect(vm.stageLogs.map((l) => l.id)).toEqual(['log_vm_2', 'log_vm_1', 'log_vm_4']);
  });
});

/** 复用夹具的基线入参（局部覆盖用） */
function base() {
  return {
    project: PROJECT,
    stages: STAGES,
    tasks: TASKS,
    members: MEMBERS,
    stageLogs: STAGE_LOGS,
    executions: EXECUTIONS,
    proposals: PROPOSALS,
    role: MemberRoleKind.Admin as MemberRoleKind | null,
    currentMemberId: ADMIN_ID,
    todayIso: TODAY,
  };
}
