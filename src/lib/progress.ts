import type { Project, Stage, Task } from '../core/types/entities';
import { taskIsDone } from '../core/types/entities';
import { StageStatus } from '../core/types/enums';
// ★ v0.7 契约修订 R1：项目日历态的定义已收口到 core/types/enums（它是契约类型）。
//   此处**引入到本模块作用域**（本文件要拿它当返回类型）+ 下方 re-export 保导出名不变。
import type { ProjectCalendarStatus } from '../core/types/enums';

/**
 * 进度派生共享层（PRD §5.4 / §8.2）：
 * 把分散在 TimelineView.pickActiveStage 与 ProjectCard.currentStageOf 的「当前阶段」
 * 口径收敛到单一出口，月历 / 详情页 / 卡片共用，避免三处置信漂移（零回归硬要求）。
 *
 * 颜色本体唯一来源仍是 tailwind.config 的 colors.stage.*（铁律 8）；本文件只做逻辑派生，
 * 不持有任何 hex——色值映射由调用方从 STAGE_BAR_COLORS / timelineColors / calendarColors 取。
 */

/**
 * 月历/卡片共用的项目**日历态**（与 PRD §3.4 筛选、§4.2 颜色一一对应）。
 *
 * ★ v0.7 契约修订 R1：定义已**收口**到 `core/types/enums.ts` —— 它属**契约**
 *   （`ApplyStageImpact` 直接引用它），而本文件是**派生层**；契约放在派生层会造成
 *   「契约 → 派生」的反向依赖（`agent-payload.ts` 这个纯类型文件被迫 import 本模块）。
 *   此处改为**引入 + re-export**（本文件自身也要用它作返回类型），
 *   故导出名与全部既有消费点**零改动**。
 */
export type { ProjectCalendarStatus };

/**
 * 当前激活阶段（返回 Stage 对象，全站一致口径）：
 * 今天落在其区间内且未完成 → 该阶段；否则取最近的未完成阶段（startAt > today 的最小 orderIndex）；
 * 全部完成 / 今天已越过末阶段且无未来未完成阶段 → null。
 */
export function pickActiveStage(stages: Stage[], todayIso: string): Stage | null {
  const visible = stages.filter((s) => s.visible !== false);
  const inRange = visible.find(
    (s) =>
      s.status !== StageStatus.Completed &&
      todayIso >= s.startAt.slice(0, 10) &&
      todayIso <= s.endAt.slice(0, 10),
  );
  if (inRange) return inRange;
  const nextUp = visible
    .filter((s) => s.status !== StageStatus.Completed)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .find((s) => s.startAt.slice(0, 10) > todayIso);
  return nextUp ?? null;
}

/** 当前激活阶段 id（与旧 TimelineView.pickActiveStage 签名一致，避免回归） */
export function pickActiveStageId(stages: Stage[], todayIso: string): string | null {
  return pickActiveStage(stages, todayIso)?.id ?? null;
}

/**
 * 当前阶段（ProjectCard 口径，含末阶段回落）：
 * 无激活阶段时回落到「最后一条可见阶段」（兼容今日已越过全部阶段、或全完成场景），
 * 与 ProjectCard 历史行为完全一致。
 */
export function currentStageOf(stages: Stage[], todayIso: string): Stage | undefined {
  const visible = stages.filter((s) => s.visible !== false);
  return (
    pickActiveStage(stages, todayIso) ??
    visible.slice().sort((a, b) => a.orderIndex - b.orderIndex).at(-1)
  );
}

/** 完成百分比（MVP，对齐 ProjectDetailPage.percent：已完成可见阶段数 / 可见阶段总数 × 100） */
export function computeProjectPercent(stages: Stage[]): number {
  const visible = stages.filter((s) => s.visible !== false);
  if (visible.length === 0) return 0;
  const done = visible.filter((s) => s.status === StageStatus.Completed).length;
  return (done / visible.length) * 100;
}

/** 项目综合状态（进行中 / 已完成 / 逾期 / 未开始）——月历筛选与色带配色的前置判定 */
export function computeProjectStatus(
  project: Project,
  stages: Stage[],
  todayIso: string,
): ProjectCalendarStatus {
  const visible = stages.filter((s) => s.visible !== false);
  const allCompleted = visible.length > 0 && visible.every((s) => s.status === StageStatus.Completed);
  if (allCompleted) return 'completed';
  if (todayIso < project.plannedStartAt) return 'not_started';
  if (project.plannedEndAt < todayIso) return 'overdue';
  return 'in_progress';
}

/**
 * 阶段内任务完成度聚合（v0.6 · M21）：按 `taskIsDone` 统一口径，
 * 供 Agent 进度回填与 T11 指标卡使用。不改动本文件既有 4 个导出函数的行为。
 */
export function computeStageTaskProgress(
  tasks: Task[],
  stageId: string,
): { done: number; total: number } {
  const stageTasks = tasks.filter((t) => t.stageId === stageId);
  return {
    done: stageTasks.filter((t) => taskIsDone(t)).length,
    total: stageTasks.length,
  };
}
