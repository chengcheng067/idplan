/**
 * 排期纸面数据（0.8.4 · A 方案：SchedulePrintPage 的算法收敛为单一 hook）。
 *
 * ── 为什么抽 ──
 * 打印内置化后纸面有两个宿主（独立路由 + 应用内预览面板）。若各自复算
 * sections / 分页 / 色带几何 / 月份刻度，母本里那些**用 bug 换来的注释**
 * （越界窗口 union、月份刻度同坐标系、脏行过滤）就会出现第二第三份版本，
 * 且「修了 A 漏了 B」必然复发。算法收此一处，宿主只管渲染。
 *
 * ── 搬运纪律 ──
 * 本文件自 `SchedulePrintPage.tsx` 原内联计算**逐字搬运**（含依赖与依赖理由），
 * 未改任何一行逻辑。母本的取色/坐标系/union 窗口判据注释随代码一起搬。
 */

import { useMemo } from 'react';

import { useMembersStore } from '../../store/useMembersStore';
import { useProjectById, useProjectStages, useProjectTasks } from '../../core/project/visibility';
import { computeRelatedStageIds, isRestrictedView, useRoleGuard } from '../../hooks/useRoleGuard';
import {
  buildScheduleSections,
  firstPageHeaderFor,
  paginateSections,
  type SchedulePaperBlocks,
  type ScheduleSection,
} from '../../lib/schedule-print';
import { buildMonthTicks, totalDaysInclusive } from '../../lib/date';

export interface SchedulePaperData {
  project: ReturnType<typeof useProjectById>;
  /** 收窄后的阶段集合（管理员全量 / 成员相关）——仅供宿主展示空态判断 */
  visibleStagesCount: number;
  sections: ScheduleSection[];
  pages: ScheduleSection[][];
  bandGeom: (startAt: string, endAt: string) => { left: number; width: number };
  monthTicks: Array<{ label: string; leftPercent: number }>;
  nowText: string;
  startAt: string;
  endAt: string;
  totalDays: number;
  role: string | null;
  hydrated: boolean;
  memberView: boolean;
}

/** MIN_LABEL_GAP_PCT：母本逐字（启发式阈值，轨宽变化需复核） */
const MIN_LABEL_GAP_PCT = 12;

/**
 * 排期纸面数据。
 *
 * `blocks`（v0.8.6.0002 · 反馈 #9.2）：打印内容勾选，**可选参**。缺省 = 母本
 * 行为（时间轴在 ⇒ 第一页按 210 预留）——深链路由 `SchedulePrintPage` 不传即
 * 逐字不变；预览面板传用户勾选，关掉时间轴时第一页预留同步降到 92
 * （`firstPageHeaderFor`），否则第一页会按少一截内容的空间分页、下半部留白。
 */
export function useSchedulePaperData(id: string, blocks?: SchedulePaperBlocks): SchedulePaperData {
  const project = useProjectById(id);
  const stages = useProjectStages(id);
  const tasks = useProjectTasks(id);
  const members = useMembersStore((s) => s.members);
  const { role, currentMember, hydrated } = useRoleGuard();
  const memberView = isRestrictedView(role);

  const relatedStageIds = useMemo(
    () =>
      computeRelatedStageIds({
        memberView,
        currentMemberId: currentMember?.id ?? null,
        stages,
        tasks,
      }),
    [memberView, currentMember, stages, tasks],
  );

  const visibleStages = useMemo(
    () => (relatedStageIds ? stages.filter((s) => relatedStageIds.has(s.id)) : stages),
    [relatedStageIds, stages],
  );

  const sections = useMemo(
    () => (project ? buildScheduleSections({ project, stages: visibleStages, tasks, members }) : []),
    [project, visibleStages, tasks, members],
  );
  // 分页随打印内容联动（反馈 #9.2）：关时间轴 ⇒ 第一页预留 210→92。
  // blocks 是 store 里的稳定对象（未改动时引用不变）⇒ 不会无辜重算。
  const pages = useMemo(
    () => paginateSections(sections, firstPageHeaderFor(blocks)),
    [sections, blocks],
  );
  const nowIso = new Date().toISOString();

  // ── 以下母本逐字（越界窗口 union / 脏行过滤 / 同坐标系刻度）──
  const plannedStart = project ? project.plannedStartAt.slice(0, 10) : '';
  const plannedEnd = project ? project.plannedEndAt.slice(0, 10) : '';
  const sectionStarts = sections.map((s) => s.startAt.slice(0, 10)).filter((d) => d !== '');
  const sectionEnds = sections.map((s) => s.endAt.slice(0, 10)).filter((d) => d !== '');
  const viewStart = sectionStarts.length
    ? [plannedStart, ...sectionStarts].reduce((a, b) => (a < b ? a : b))
    : plannedStart;
  const viewEnd = sectionEnds.length
    ? [plannedEnd, ...sectionEnds].reduce((a, b) => (a > b ? a : b))
    : plannedEnd;
  const viewDays = Math.max(totalDaysInclusive(viewStart, viewEnd), 1);
  const offsetDays = (iso: string): number => totalDaysInclusive(viewStart, iso) - 1;
  const bandGeom = (startAt: string, endAt: string): { left: number; width: number } => {
    const lo = offsetDays(startAt);
    const hi = offsetDays(endAt);
    const left = (lo / viewDays) * 100;
    const width = Math.max(((hi - lo + 1) / viewDays) * 100, 2.5);
    return { left, width };
  };

  const monthTicks = useMemo<{ label: string; leftPercent: number }[]>(() => {
    if (!project || !Number.isFinite(viewDays) || viewDays <= 0) return [];
    const kept: { label: string; leftPercent: number }[] = [];
    for (const t of buildMonthTicks(viewStart, viewEnd)) {
      const leftPercent = Math.max((offsetDays(t.start) / viewDays) * 100, 0);
      const prev = kept[kept.length - 1];
      if (prev && leftPercent - prev.leftPercent < MIN_LABEL_GAP_PCT) continue;
      kept.push({ label: t.label, leftPercent });
    }
    return kept;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- offsetDays 由 viewStart 派生，viewStart 已在依赖里
  }, [project, viewStart, viewEnd, viewDays]);

  const startAt = project ? project.plannedStartAt.slice(0, 10) : '';
  const endAt = project ? project.plannedEndAt.slice(0, 10) : '';
  const totalDays = totalDaysInclusive(startAt, endAt);
  const nowText = `${nowIso.slice(0, 10)} ${nowIso.slice(11, 16)}`;

  return {
    project,
    visibleStagesCount: visibleStages.length,
    sections,
    pages,
    bandGeom,
    monthTicks,
    nowText,
    startAt,
    endAt,
    totalDays,
    role,
    hydrated,
    memberView,
  };
}
