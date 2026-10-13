/**
 * 枚举值 → 文案键的映射表 + 取词小函数。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么不把值直接搬进 messages、把 enums 的表改成 key（本批的取舍）
 * ══════════════════════════════════════════════════════════════════════
 * `src/core/types/enums.ts` 那五张标签表**本批保留中文值**，改成在 React 层
 * 用本文件的键表取词。三条硬约束决定了这个形态：
 *   ① 消费方里有 `src/print/**`（7 个文件，打印是**后批**）与共享内核
 *      `src/core/services/task.service.ts`、`src/lib/restPolicyRecalc.ts`；
 *   ② `tests/workdays.rest-policy.spec.ts:447-449 / :479-480` 直接断言那五张表的
 *      中文值，`tests/print-selector-modules.spec.tsx:1133` 断言经典模板名含「经」
 *      ——把值换成 key 会当场撞红三条**不属本批**的 spec；
 *   ③ `enums.ts` 在 `tests/arch-boundary.spec.ts` 的共享内核约束面内
 *      （`src/core/types/**` 禁 window / document / localStorage）
 *      ⇒ 它不可能自己读语言状态，也不该 import 渲染层。
 * ⇒ 中文一致性改由 `tests/i18n.spec.ts` 逐键对照 `enums.ts` 锁死（防漂移）。
 *
 * ⚠️ 用法纪律：这些函数**不是** React hook，不订阅语言变化。
 *    渲染期调用它们的组件**必须**同时调 `useLang()`（订阅 + 拿 `t`），
 *    否则切语言时该组件不会重渲染。见 `src/i18n/useLang.ts` 的纪律 ②。
 */
import {
  MemberActorKind,
  MemberRoleKind,
  RestPolicyKind,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../core/types/enums';
import type { ProjectCalendarStatus } from '../core/types/enums';
import { t } from './translate';
import type { MessageKey } from './messages/zh';

/* ──────────────────────── 休息制度（REST_POLICY_LABELS） ──────────────────────── */

export const REST_POLICY_KEYS: Record<RestPolicyKind, MessageKey> = {
  [RestPolicyKind.DoubleOff]: 'restPolicy.doubleOff',
  [RestPolicyKind.SingleOff]: 'restPolicy.singleOff',
  [RestPolicyKind.BigSmallWeek]: 'restPolicy.bigSmallWeek',
};

export function restPolicyLabel(kind: RestPolicyKind): string {
  return t(REST_POLICY_KEYS[kind]);
}

/* ─────────────────────── 排期基准（SCHEDULE_BASIS_LABELS） ─────────────────────── */

export const SCHEDULE_BASIS_KEYS: Record<ScheduleBasis, MessageKey> = {
  [ScheduleBasis.Calendar]: 'scheduleBasis.calendar',
  [ScheduleBasis.Workday]: 'scheduleBasis.workday',
};

export function scheduleBasisLabel(basis: ScheduleBasis): string {
  return t(SCHEDULE_BASIS_KEYS[basis]);
}

/* ─────────────────────── 成员角色（MEMBER_ROLE_LABELS） ─────────────────────── */

export const MEMBER_ROLE_KEYS: Record<MemberRoleKind, MessageKey> = {
  [MemberRoleKind.Admin]: 'memberRole.admin',
  [MemberRoleKind.Member]: 'memberRole.member',
};

export function memberRoleLabel(role: MemberRoleKind): string {
  return t(MEMBER_ROLE_KEYS[role]);
}

/* ──────────────────── 行为体种类（MEMBER_ACTOR_KIND_LABELS） ──────────────────── */

export const MEMBER_ACTOR_KIND_KEYS: Record<MemberActorKind, MessageKey> = {
  [MemberActorKind.Human]: 'memberActorKind.human',
  [MemberActorKind.Agent]: 'memberActorKind.agent',
};

export function memberActorKindLabel(kind: MemberActorKind): string {
  return t(MEMBER_ACTOR_KIND_KEYS[kind]);
}

/* ────────────────────────── 任务七态（TASK_STATUS_LABELS） ────────────────────────── */

export const TASK_STATUS_KEYS: Record<TaskStatus, MessageKey> = {
  [TaskStatus.Draft]: 'taskStatus.draft',
  [TaskStatus.Ready]: 'taskStatus.ready',
  [TaskStatus.Claimed]: 'taskStatus.claimed',
  [TaskStatus.InProgress]: 'taskStatus.inProgress',
  [TaskStatus.Blocked]: 'taskStatus.blocked',
  [TaskStatus.Review]: 'taskStatus.review',
  [TaskStatus.Done]: 'taskStatus.done',
};

export function taskStatusLabel(status: TaskStatus): string {
  return t(TASK_STATUS_KEYS[status]);
}

/* ─────────────────────── 阶段四态（重算弹窗的 STATUS_LABELS） ─────────────────────── */

export const STAGE_STATUS_KEYS: Record<StageStatus, MessageKey> = {
  [StageStatus.NotStarted]: 'stageStatus.notStarted',
  [StageStatus.InProgress]: 'stageStatus.inProgress',
  [StageStatus.Completed]: 'stageStatus.completed',
  [StageStatus.Delayed]: 'stageStatus.delayed',
};

export function stageStatusLabel(status: StageStatus): string {
  return t(STAGE_STATUS_KEYS[status]);
}

/* ─────────────────── 月历筛选四态（calendarMath 的 STATUS_LABELS） ─────────────────── */

export const CALENDAR_STATUS_KEYS: Record<ProjectCalendarStatus, MessageKey> = {
  in_progress: 'calendarStatus.inProgress',
  completed: 'calendarStatus.completed',
  overdue: 'calendarStatus.overdue',
  not_started: 'calendarStatus.notStarted',
};

export function calendarStatusLabel(status: ProjectCalendarStatus): string {
  return t(CALENDAR_STATUS_KEYS[status]);
}

/* ─────────────────── Agent 写回状态五态（AgentActivityStream） ─────────────────── */

export const WRITEBACK_STATUS_KEYS: Record<string, MessageKey> = {
  draft: 'agent.writeback.draft',
  proposed: 'agent.writeback.proposed',
  applied: 'agent.writeback.applied',
  rejected: 'agent.writeback.rejected',
  conflict: 'agent.writeback.conflict',
};

/** 未知状态（上游新增枚举值）原样回显，不吞成空白——与改造前 `?? p.status` 同口径 */
export function writebackStatusLabel(status: string): string {
  const key = WRITEBACK_STATUS_KEYS[status];
  return key === undefined ? status : t(key);
}

/* ─────────────────── Agent 接入档位（AgentIngressPanel 的 MODE_LABELS） ─────────────────── */

export const INGRESS_MODE_KEYS: Record<'local' | 'nas', MessageKey> = {
  local: 'agent.ingress.local',
  nas: 'agent.ingress.nas',
};

/* ──────────────────────── 星期：短名 / 全名（各 7 项） ──────────────────────── */

/** 索引 0..6 = 周一..周日（与全仓「周一行首」口径一致） */
export const WEEKDAY_SHORT_KEYS: readonly MessageKey[] = [
  'weekday.short.mon',
  'weekday.short.tue',
  'weekday.short.wed',
  'weekday.short.thu',
  'weekday.short.fri',
  'weekday.short.sat',
  'weekday.short.sun',
];

/** 索引 0..6 = 周一..周日；全名（「周一」/「Monday」），供休息制度编辑器使用 */
export const WEEKDAY_FULL_KEYS: readonly MessageKey[] = [
  'weekday.full.mon',
  'weekday.full.tue',
  'weekday.full.wed',
  'weekday.full.thu',
  'weekday.full.fri',
  'weekday.full.sat',
  'weekday.full.sun',
];

/**
 * 星期短名（索引 0..6 = 周一..周日）。
 * 越界索引回落周一——改造前是 `as const` 数组，越界取到 `undefined` 会渲染空串；
 * 这里保持"不抛错"，但给一个确定值（工作日索引由 lib/workdays 提供，恒 0..6）。
 */
export function weekdayShortLabel(index: number): string {
  return t(WEEKDAY_SHORT_KEYS[index] ?? WEEKDAY_SHORT_KEYS[0]!);
}

/** 星期全名（索引 0..6 = 周一..周日） */
export function weekdayFullLabel(index: number): string {
  return t(WEEKDAY_FULL_KEYS[index] ?? WEEKDAY_FULL_KEYS[0]!);
}
