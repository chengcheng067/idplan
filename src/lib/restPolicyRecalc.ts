/**
 * 休息制度切换重算（纯函数，预览与应用同一份演算）。
 *
 * ── 为什么存在 ──
 * 产品决策文档 §四（product-redesign-calendar-print-2026-10-09.md）废止了
 * 「已排定的阶段日期不会因切换制度而变更」的旧结论：切换公司休息制度后，
 * 已排阶段必须按新制度重算。本文件是那份重算的**唯一演算源**——确认弹窗
 * 先跑它出 diff（预览即演算），用户确认后由编排层（组件内 applyRestPolicyRecalc）
 * 消费**同一份 RecalcPlan** 落库，不存在「预览和应用不一致」。
 *
 * ── 重算规则（§4.1 推荐候选①+③）──
 *   工期不变 + 链式平移：每阶段的「工作日工期」不变
 *   （countWorkdays(oldStart, oldEnd, 旧制度)），起止按新制度重走
 *   （addWorkdays）。阶段首尾相接的链式关系保留；原本有间隙的保留间隙
 *   （间隙按旧制度的工作日步数计量）。项目第一段作锚（吸附到新制度工作日）。
 *
 * ── 三态口径（§4.2）──
 *   completed   整段冻结——日期是完工事实（StageLog/验收依据），改历史=伪造记录；
 *   in_progress 冻 startAt（实际开工是事实），endAt 按新制度重算；
 *   not_started / delayed 起止都重算，与前一阶段链式相接（前段冻结时从它的
 *   endAt 之后第一个工作日接）。
 *
 * ── 影响面（§4.0）──
 *   只有 scheduleBasis=workday 的项目进 plan；自然日制项目零影响
 *   （弹窗影响计数也按此口径报）。
 *
 * ── 工期改变模式 ──
 * 需求方拍板「提醒用户让用户选择工期是否改变」：调用方（弹窗）可传
 * durationOverrides（key=stageId，value=工作日天数）覆盖某阶段工期，
 * 未填的阶段走原工期。解析逻辑与建档 ManualFallbackForm 的「每阶段时长
 * 覆盖」同源（parseDurationDays）。
 *
 * ── Task.dueDate（§4.2）──
 * 默认不跟随。plan 恒算出 taskShifts（弹窗要报「N 个任务的到期日将落在阶段
 * 新区间之外」的计数）；**是否真写**由应用层决定（弹窗复选框 alignTaskDueDates，
 * 默认不勾）——applyRestPolicyRecalc 只平移被勾选的那批。
 *
 * 铁律：日期判定一律走 src/lib/workdays.ts，本文件不做二次周末判定。
 */

import { RestPolicyKind, ScheduleBasis, StageStatus } from '../core/types/enums';
import type { Project, RestPolicyConfig, Stage, Task } from '../core/types/entities';
import { REST_POLICY_LABELS } from '../core/types/enums';
import { addWorkdays, countWorkdays, snapToWorkday } from './workdays';
import { toIsoDate } from './date';
import { dayjs } from './date';

/* ------------------------------ 输入形状 ------------------------------ */

export interface RecalcInputProject {
  project: Project;
  /** 该项目全部阶段（顺序不限，内部按 orderIndex 升序） */
  stages: Stage[];
  /** 该项目任务（dueDate 对齐用；不传 = 不演算任务平移） */
  tasks?: Task[];
}

export interface PlanRestPolicyRecalcArgs {
  /** 仅传工作日制项目即可——自然日制项目零影响，不进 plan */
  projects: RecalcInputProject[];
  /** 旧制度（生效口径：调用方已合并法定节假日表） */
  oldPolicy: RestPolicyConfig;
  /** 新制度（生效口径） */
  newPolicy: RestPolicyConfig;
  /** 工期覆盖（工期改变模式）：key=stageId，value=工作日天数（正整数） */
  durationOverrides?: Record<string, number>;
}

/* ------------------------------ 输出形状 ------------------------------ */

/** 冻结类型：full=整段冻结（completed）；start=冻开始日（in_progress） */
export type StageFreezeKind = 'full' | 'start';

export interface RecalcStagePlan {
  stageId: string;
  projectId: string;
  orderIndex: number;
  name: string;
  status: StageStatus;
  /** 旧起止（ISO date 'YYYY-MM-DD'） */
  oldStartAt: string;
  oldEndAt: string;
  /** 新起止（ISO date；冻结段 = 旧值） */
  newStartAt: string;
  newEndAt: string;
  freeze: StageFreezeKind | null;
  freezeReason: string | null;
  /** 新起止与旧起止是否有差异（false = 无需写库） */
  changed: boolean;
  /** 该阶段采用的工作日工期（原工期或覆盖值） */
  workdays: number;
  /** 工期是否被用户覆盖（工期改变模式） */
  durationOverridden: boolean;
}

export interface RecalcTaskShift {
  taskId: string;
  title: string;
  stageId: string;
  stageName: string;
  oldDueDate: string;
  newDueDate: string;
}

export interface RecalcProjectPlan {
  projectId: string;
  projectName: string;
  scheduleBasis: ScheduleBasis;
  stages: RecalcStagePlan[];
  changedStageCount: number;
  /** 已完成（整段冻结）阶段数 */
  frozenStageCount: number;
  /** 旧/新计划竣工日（ISO date）；无阶段或末段冻结时相等 */
  oldPlannedEndAt: string;
  newPlannedEndAt: string;
  plannedEndAtChanged: boolean;
  /** dueDate 需要平移的任务（恒算——弹窗据此报「N 个任务到期日将落在新区间外」；是否真写由应用层复选框决定） */
  taskShifts: RecalcTaskShift[];
}

export interface RecalcPlan {
  projects: RecalcProjectPlan[];
  affectedProjectCount: number;
  /** 将有日期变化的阶段总数（= 需要写库+留痕的条数） */
  changedStageCount: number;
  /** 已完成冻结阶段总数 */
  frozenStageCount: number;
  /** dueDate 需要平移的任务总数（默认不写，见 taskShifts 注释） */
  taskShiftCount: number;
  /** 是否有任何阶段/项目级变化（false = 幂等：同制度重算第二次零变化） */
  hasChanges: boolean;
}

/* ------------------------------ 纯函数 ------------------------------ */

/**
 * 解析「每阶段时长覆盖」输入（与建档 ManualFallbackForm 同源语义）：
 * key=阶段 key/stageId、value=天数字符串，空=未填走原工期。
 * 非正整数 / 非数字 / 空串一律返回 null（调用方走原工期）。
 */
export function parseDurationDays(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : null;
}

/** 旧制度下 prevEnd → thisStart 的工作日步数（首尾相接=1；重叠/倒挂=1；有间隙=1+间隙工作日数） */
function chainSteps(prevEnd: string, thisStart: string, oldPolicy: RestPolicyConfig): number {
  if (thisStart <= prevEnd) return 1; // 重叠/同日：强制下一工作日接
  const span = countWorkdays(prevEnd, thisStart, oldPolicy); // 含两端（两端均为工作日时=2）
  return Math.max(1, span - 1);
}

/** 自然日偏移（保持阶段内相对偏移用） */
function shiftNaturalDays(iso: string, days: number): string {
  return dayjs(iso).add(days, 'day').format('YYYY-MM-DD');
}

/** 制度里影响工作日判定的字段是否有差异（kind/锚点/单休周几/节假日三件套） */
export function sameWorkdayPolicy(a: RestPolicyConfig, b: RestPolicyConfig): boolean {
  const norm = (p: RestPolicyConfig): string =>
    JSON.stringify([
      p.kind,
      p.anchorWeek ?? null,
      [...(p.extraHolidays ?? [])].sort(),
      [...(p.extraWorkdays ?? [])].sort(),
      p.skipHolidays === true,
      // 单休周几：仅单休档参与判定；非单休档缺省等价
      p.kind === RestPolicyKind.SingleOff ? (p.singleRestWeekday ?? 6) : null,
    ]);
  return norm(a) === norm(b);
}

/**
 * 休息制度切换重算主入口（纯函数）。
 *
 * 输入项目应为**全部** `scheduleBasis=workday` 的项目（自然日制项目由调用方
 * 前置过滤——它们与休息制度无关，进 plan 只会稀释影响计数）。
 */
export function planRestPolicyRecalc(args: PlanRestPolicyRecalcArgs): RecalcPlan {
  const { oldPolicy, newPolicy } = args;
  const overrides = args.durationOverrides ?? {};

  const projects: RecalcProjectPlan[] = args.projects.map(({ project, stages, tasks }) =>
    planProject(project, stages, tasks ?? [], oldPolicy, newPolicy, overrides),
  );

  return {
    projects,
    affectedProjectCount: projects.length,
    changedStageCount: projects.reduce((acc, p) => acc + p.changedStageCount, 0),
    frozenStageCount: projects.reduce((acc, p) => acc + p.frozenStageCount, 0),
    taskShiftCount: projects.reduce((acc, p) => acc + p.taskShifts.length, 0),
    // hasChanges 只看阶段与项目级日期——dueDate 平移依附于阶段变化，
    // 阶段零变化时 taskShifts 必为空（无 changed 阶段可挂）。
    hasChanges: projects.some((p) => p.changedStageCount > 0 || p.plannedEndAtChanged),
  };
}

function planProject(
  project: Project,
  rawStages: Stage[],
  tasks: Task[],
  oldPolicy: RestPolicyConfig,
  newPolicy: RestPolicyConfig,
  overrides: Record<string, number>,
): RecalcProjectPlan {
  const stages = [...rawStages].sort((a, b) => a.orderIndex - b.orderIndex);
  const stagePlans: RecalcStagePlan[] = [];

  /** 链游标：前一阶段的（旧 endAt, 新 endAt） */
  let prev: { oldEndAt: string; newEndAt: string } | null = null;

  for (const stage of stages) {
    const oldStartAt = toIsoDate(stage.startAt) ?? stage.startAt;
    const oldEndAt = toIsoDate(stage.endAt) ?? stage.endAt;

    const override = overrides[stage.id];
    const overridden = typeof override === 'number' && Number.isInteger(override) && override > 0;
    const workdays = overridden
      ? (override as number)
      : Math.max(1, countWorkdays(oldStartAt, oldEndAt, oldPolicy));

    let newStartAt: string;
    let newEndAt: string;
    let freeze: StageFreezeKind | null = null;
    let freezeReason: string | null = null;

    if (stage.status === StageStatus.Completed) {
      // 已完成：整段冻结——日期是完工事实，改历史=伪造记录
      newStartAt = oldStartAt;
      newEndAt = oldEndAt;
      freeze = 'full';
      freezeReason = '已完成：日期是完工事实，整段冻结';
    } else if (stage.status === StageStatus.InProgress) {
      // 进行中：冻 startAt（实际开工是事实），endAt 按新制度重算（工期是计划）
      newStartAt = oldStartAt;
      newEndAt = addWorkdays(oldStartAt, workdays - 1, newPolicy);
      freeze = 'start';
      freezeReason = '进行中：开工日是事实（冻结），截止日按新制度重算';
    } else {
      // 未开始 / 延期：起止都重算，与前一阶段链式相接
      if (prev === null) {
        // 第一段作锚：吸附到新制度工作日（正常数据下 = 项目开始日原样）
        newStartAt = snapToWorkday(oldStartAt, newPolicy);
      } else {
        const steps = chainSteps(prev.oldEndAt, oldStartAt, oldPolicy);
        newStartAt = addWorkdays(prev.newEndAt, steps, newPolicy);
      }
      newEndAt = addWorkdays(newStartAt, workdays - 1, newPolicy);
    }

    const changed = newStartAt !== oldStartAt || newEndAt !== oldEndAt;
    stagePlans.push({
      stageId: stage.id,
      projectId: project.id,
      orderIndex: stage.orderIndex,
      name: stage.name,
      status: stage.status,
      oldStartAt,
      oldEndAt,
      newStartAt,
      newEndAt,
      freeze,
      freezeReason,
      changed,
      workdays,
      durationOverridden: overridden,
    });

    prev = { oldEndAt, newEndAt };
  }

  const oldPlannedEndAt = toIsoDate(project.plannedEndAt) ?? project.plannedEndAt;
  const lastPlan = stagePlans[stagePlans.length - 1];
  // plannedEndAt 锚处理：项目计划窗口是**容纳末段的容器**——末段新 endAt 拖出
  // 旧 plannedEndAt 时才延长（单→双延后场景）；结束日提前不缩短计划窗口
  // （双→单时项目计划维持原样，缩短的只是末段日期）。末段冻结时天然不变。
  const newPlannedEndAt =
    lastPlan && lastPlan.newEndAt > oldPlannedEndAt ? lastPlan.newEndAt : oldPlannedEndAt;

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const taskShifts: RecalcTaskShift[] = [];
  for (const task of tasks) {
    const dueIso = task.dueDate ? toIsoDate(task.dueDate) : null;
    if (!dueIso) continue;
    const stage = stageById.get(task.stageId);
    const plan = stagePlans.find((p) => p.stageId === task.stageId);
    if (!stage || !plan || !plan.changed) continue;
    // 相对偏移 = dueDate - 阶段旧起点（自然日）；平移后 clamp 进新区间
    const offset = dayjs(dueIso).diff(dayjs(plan.oldStartAt), 'day');
    const candidate = shiftNaturalDays(plan.newStartAt, offset);
    const clamped = candidate < plan.newStartAt ? plan.newStartAt : candidate > plan.newEndAt ? plan.newEndAt : candidate;
    if (clamped !== dueIso) {
      taskShifts.push({
        taskId: task.id,
        title: task.title,
        stageId: stage.id,
        stageName: plan.name,
        oldDueDate: dueIso,
        newDueDate: clamped,
      });
    }
  }

  return {
    projectId: project.id,
    projectName: project.name,
    scheduleBasis: project.scheduleBasis,
    stages: stagePlans,
    changedStageCount: stagePlans.filter((p) => p.changed).length,
    frozenStageCount: stagePlans.filter((p) => p.freeze === 'full').length,
    oldPlannedEndAt,
    newPlannedEndAt,
    plannedEndAtChanged: newPlannedEndAt !== oldPlannedEndAt,
    taskShifts,
  };
}

/**
 * 重算原因串（StageLog.reason，新制度名）。
 * 例：'休息制度切换：双休→单休'。
 */
export function restPolicyRecalcReason(oldPolicy: RestPolicyConfig, newPolicy: RestPolicyConfig): string {
  return `休息制度切换：${REST_POLICY_LABELS[oldPolicy.kind]}→${REST_POLICY_LABELS[newPolicy.kind]}`;
}
