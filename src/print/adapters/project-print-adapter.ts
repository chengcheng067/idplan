/**
 * 项目打印数据适配器（02 文档 §3 装配顺序的落地）。
 *
 * ── 为什么是纯函数 + 薄 hook 两层 ──
 * 装配顺序（角色 → computeRelatedStageIds → visible 过滤 → clientName 门控 →
 * 派生统计 → 页面模型）是**权限口径**，写错一行就是越权泄露，必须可单测
 * （tests/print-view-model.spec.ts 先于页面落地）。故本文件只放纯函数；
 * store 读取与异步装载在 use-print-view-model.ts（hook 层）。
 *
 * ── 复用纪律（02 §4）──
 * computeProjectPercent / computeStageTaskProgress 一律走 src/lib/progress.ts，
 * **不复制算法**；可见范围判定走 useRoleGuard 的 computeRelatedStageIds /
 * taskAssigneeIds（与 useSchedulePaperData.ts:65-79 同一示范顺序）；
 * taskNo 展示格式不在本层（消费方走 formatTaskNo）。
 *
 * 禁止：把 ratioPercent 当完成度；为阶段延期之外的逾期生成原因；
 * 自行创建字段；把 agentKind 收成枚举。
 */

import type { Member, Project, Stage, StageLog, Task } from '../../core/types/entities';
import { taskIsDone } from '../../core/types/entities';
import { MemberRoleKind, SCHEDULE_BASIS_LABELS, ScheduleBasis } from '../../core/types/enums';
import type { Execution, WritebackProposal } from '../../core/types/agent-execution';
import { computeProjectPercent, computeStageTaskProgress } from '../../lib/progress';
import { computeRelatedStageIds, taskAssigneeIds } from '../../hooks/useRoleGuard';

import type {
  PrintExecutionVM,
  PrintMemberVM,
  PrintProjectVM,
  PrintStageLogVM,
  PrintStageVM,
  PrintTaskVM,
  PrintViewModel,
  PrintViewerRole,
  PrintWritebackProposalVM,
} from '../model/print-view-model';

export interface PrintViewModelInput {
  project: Project;
  /** 该项目**全部**阶段（含 visible=false；过滤在本层做） */
  stages: readonly Stage[];
  /** 该项目全部任务（含隐藏阶段下的；过滤在本层做） */
  tasks: readonly Task[];
  members: readonly Member[];
  /** 阶段流水（该项目的；按可见阶段过滤） */
  stageLogs: readonly StageLog[];
  /** Agent 执行（可空：A 版不渲染，H 版批次再接装载） */
  executions?: readonly Execution[];
  /** 写回提案（可空，同上） */
  proposals?: readonly WritebackProposal[];
  /** 当前用户角色（useRoleGuard 的 role；null = 未进入 ⇒ 按成员口径） */
  role: MemberRoleKind | null;
  /** 当前成员 id（成员可见范围收窄用） */
  currentMemberId: string | null;
  /** 今天 YYYY-MM-DD（注入保证纯函数可测；缺省取系统今天） */
  todayIso?: string;
  /** 装配时刻（generatedAt；缺省取现在） */
  now?: Date;
}

/** 今天兜底：与 useSchedulePaperData 同口径（UTC ISO 前 10 位） */
function todayOf(input: PrintViewModelInput): string {
  return input.todayIso ?? new Date().toISOString().slice(0, 10);
}

/** 角色 → VM 口径。未进入（null）按成员（与 isRestrictedView 同语义） */
function viewerRoleOf(role: MemberRoleKind | null): PrintViewerRole {
  return role === MemberRoleKind.Admin ? 'admin' : 'member';
}

/**
 * 装配打印视图模型（只读投影，不回写任何实体）。
 *
 * 顺序即 02 §3 七步，每一步的过滤理由写在行内——这是权限代码，
 * 将来改一步都要能看见「动了哪道闸」。
 */
export function buildPrintViewModel(input: PrintViewModelInput): PrintViewModel {
  const todayIso = todayOf(input);
  const generatedAt = (input.now ?? new Date()).toISOString();
  const viewerRole = viewerRoleOf(input.role);

  // ── ② 可见范围：computeRelatedStageIds（成员=相关阶段；管理员=null 全量；
  //        未进入=空集）——与 useSchedulePaperData.ts:65-79 同一判定，不造新口径 ──
  const memberView = input.role !== MemberRoleKind.Admin;
  const relatedStageIds = computeRelatedStageIds({
    memberView,
    currentMemberId: input.currentMemberId,
    stages: input.stages as Stage[],
    tasks: input.tasks as Task[],
  });

  // ── ③ visible !== false 过滤（隐藏阶段不进普通成员输出，也不参与完成度）──
  const visibleStages = (input.stages as Stage[])
    .filter((s) => s.projectId === input.project.id)
    .filter((s) => s.visible !== false)
    .filter((s) => (relatedStageIds ? relatedStageIds.has(s.id) : true))
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const visibleStageIds = new Set(visibleStages.map((s) => s.id));

  // ── ④ 任务 / 流水按可见阶段收窄 ──
  const visibleTasks = (input.tasks as Task[])
    .filter((t) => t.projectId === input.project.id && visibleStageIds.has(t.stageId))
    .sort((a, b) => {
      const na = a.taskNo ?? Number.MAX_SAFE_INTEGER;
      const nb = b.taskNo ?? Number.MAX_SAFE_INTEGER;
      return na !== nb ? na - nb : a.id.localeCompare(b.id);
    });
  const visibleTaskIds = new Set(visibleTasks.map((t) => t.id));

  const memberName = (id: string): string | null =>
    input.members.find((m) => m.id === id)?.name ?? null;

  // ── ⑥ 派生统计：完成度复用 computeProjectPercent（不按 ratioPercent 加权）──
  const percent = computeProjectPercent(visibleStages as Stage[]);
  const plannedEndDate = input.project.plannedEndAt.slice(0, 10);
  // 口径一「项目逾期」：结束日早于今天且未完成。**不**生成原因（01 §3.3）。
  const projectOverdue = plannedEndDate < todayIso && percent < 100;

  const projectVM: PrintProjectVM = {
    id: input.project.id,
    name: input.project.name,
    address: input.project.address,
    // ── ⑤ clientName 仅管理员进 VM；普通成员是 undefined，不是渲染层隐藏 ──
    clientName: viewerRole === 'admin' ? input.project.clientName : undefined,
    plannedStartAt: input.project.plannedStartAt.slice(0, 10),
    plannedEndAt: plannedEndDate,
    scheduleBasisLabel:
      SCHEDULE_BASIS_LABELS[input.project.scheduleBasis] ??
      SCHEDULE_BASIS_LABELS[ScheduleBasis.Calendar],
    percent,
    visibleStageCount: visibleStages.length,
    projectOverdue,
    todayIso,
  };

  const stagesVM: PrintStageVM[] = visibleStages.map((s) => ({
    id: s.id,
    orderIndex: s.orderIndex,
    name: s.name,
    ratioPercent: s.ratioPercent,
    startAt: s.startAt.slice(0, 10),
    endAt: s.endAt.slice(0, 10),
    status: s.status,
    ownerName: memberName(s.ownerId ?? ''),
    colorIndex: s.colorIndex,
    customColor: s.customColor ?? null,
    // 阶段内任务完成度复用 computeStageTaskProgress（done/total，不复制算法）
    taskProgress: computeStageTaskProgress(visibleTasks as Task[], s.id),
  }));

  const tasksVM: PrintTaskVM[] = visibleTasks.map((t) => ({
    id: t.id,
    taskNo: t.taskNo,
    title: t.title,
    status: t.status,
    assigneeNames: taskAssigneeIds(t)
      .map((id) => memberName(id))
      .filter((n): n is string => n !== null),
    dueDate: t.dueDate?.slice(0, 10) ?? null,
    // 原样携带；指向不可见/不存在任务的「引用不可用」化解在 D 版依赖网络
    dependsOn: [...t.dependsOn],
    artifactCount: t.artifacts.length,
    stageId: t.stageId,
    // 口径三「任务逾期」：dueDate < today 且 status !== done。**不**与阶段延期混用
    overdue: t.dueDate !== null && t.dueDate.slice(0, 10) < todayIso && !taskIsDone(t),
    source: t.source,
    runId: t.runId,
  }));

  // 成员名册：被可见阶段/任务引用（负责人 / 参与人 / Agent 产出者）的 active 成员。
  // agentKind 是开放字符串——未知值原样进 VM（01 §3.2，禁止收枚举）。
  const referencedIds = new Set<string>();
  for (const s of visibleStages) if (s.ownerId) referencedIds.add(s.ownerId);
  for (const t of visibleTasks) {
    for (const id of taskAssigneeIds(t)) referencedIds.add(id);
    if (t.agentId) referencedIds.add(t.agentId);
  }
  // 「负责任务数」= 被指派（taskAssigneeIds）+ 本人产出的任务（agentId 溯源）——
  // Agent 行常见「产出者不在 assigneeIds 里」，只数指派会把 Agent 的责任数算成 0。
  const taskCountOf = (memberId: string): number =>
    visibleTasks.filter((t) => taskAssigneeIds(t).includes(memberId) || t.agentId === memberId).length;
  const membersVM: PrintMemberVM[] = input.members
    .filter((m) => m.active && referencedIds.has(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      roleKind: m.roleKind,
      actorKind: m.actorKind,
      agentKind: m.agentKind,
      taskCount: taskCountOf(m.id),
    }))
    // Agent 行在前（A 版 P4 的唯一强焦点），其余按负责任务数降序
    .sort(
      (a, b) =>
        Number(b.actorKind === 'agent') - Number(a.actorKind === 'agent') ||
        b.taskCount - a.taskCount ||
        a.name.localeCompare(b.name),
    );

  const stageNameOf = (id: string): string =>
    visibleStages.find((s) => s.id === id)?.name ?? id;
  const stageLogsVM: PrintStageLogVM[] = (input.stageLogs as StageLog[])
    .filter((l) => l.projectId === input.project.id && visibleStageIds.has(l.stageId))
    .map((l) => ({
      id: l.id,
      stageId: l.stageId,
      stageName: stageNameOf(l.stageId),
      type: l.type,
      oldEndAt: l.oldEndAt?.slice(0, 10) ?? null,
      newEndAt: l.newEndAt?.slice(0, 10) ?? null,
      // reason 只随 StageLog 真实存在（rescheduled 且新结束日晚于旧时必填）；
      // 阶段延期之外的逾期禁造原因（01 §3.3 / 02 §4 禁止清单）
      reason: l.reason,
      operatorName: l.operatorName,
      createdAt: l.createdAt,
    }))
    // 台账新→旧
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const executionsVM: PrintExecutionVM[] = (input.executions ?? [])
    .filter((e) => e.projectId === input.project.id)
    .filter((e) => e.taskId === null || visibleTaskIds.has(e.taskId))
    .map((e) => {
      const task = visibleTasks.find((t) => t.id === e.taskId);
      return {
        id: e.id,
        taskId: e.taskId,
        source: e.source,
        objective: e.objective,
        agentName: e.agentMemberId ? memberName(e.agentMemberId) : null,
        status: e.status,
        currentAttemptNo: e.currentAttemptNo,
        // runId 是任务级溯源元数据（ entities.Task.runId ），执行单经任务解析
        runId: task?.runId ?? null,
        createdAt: e.createdAt,
        startedAt: e.startedAt,
        finishedAt: e.finishedAt,
        terminalReason: e.terminalReason,
        blockedReason: e.blockedReason,
      };
    });

  const proposalsVM: PrintWritebackProposalVM[] = (input.proposals ?? [])
    .filter((p) => p.projectId === input.project.id)
    .filter((p) => p.taskId === null || visibleTaskIds.has(p.taskId))
    .map((p) => ({
      id: p.id,
      executionId: p.executionId,
      taskId: p.taskId,
      // 只携字段名；before/after 原值不进打印投影（纸面要的是「改了哪个字段」）
      operations: p.operations.map((op) => ({ field: op.field })),
      status: p.status,
      reason: p.reason,
      // confidence 仅展示（01 §3.3），不做任何阈值判定
      confidence: p.confidence,
      decidedBy: p.decidedBy,
      decidedAt: p.decidedAt,
      createdAt: p.createdAt,
    }));

  return {
    project: projectVM,
    stages: stagesVM,
    tasks: tasksVM,
    members: membersVM,
    stageLogs: stageLogsVM,
    executions: executionsVM,
    proposals: proposalsVM,
    generatedAt,
    viewerRole,
  };
}
