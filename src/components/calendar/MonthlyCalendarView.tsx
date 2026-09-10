import { useEffect, useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { Project, Stage, Task } from '../../core/types/entities';
import { useUiStore } from '../../store/useUiStore';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTheme } from '../../hooks/useTheme';
import { useRoleGuard, isRestrictedView, computeRelatedStageIds } from '../../hooks/useRoleGuard';
import { cn } from '../../lib/cn';
import { isRestDay } from '../../lib/workdays';
import { SegmentedControl } from '../ui/SegmentedControl';
import {
  buildMonthMeta,
  shiftMonth,
  computeCalendarEntry,
  filterEntries,
  stageSpan,
  type CalendarEntry,
  type CalendarMonthMeta,
  type CalendarFilters,
} from './calendarMath';
import {
  WEEKDAYS,
  buildCalendarGrid,
  formatSelectedDate,
  gridDaysOf,
  lunarLabel,
  weekOf,
  type GridDay,
} from './calendarGrid';
import { weekendHeaderColor } from './calendarColors';
import { CalendarLegend } from './CalendarLegend';
import { CalendarFilters as CalendarFilterPanel } from './CalendarFilters';
import { CalendarEmptyStates, type EmptyKind } from './CalendarEmptyStates';
import { MonthDayCell, stageLabelOf } from './MonthDayCell';

/**
 * 月历看板（v0.7 画板 14 亮色 / 15 暗色 / 16-17 空状态四态 / 18 拥挤方案 A / 19 移动端）。
 *
 * ── 结构（画板 14 原文）──
 *   内容区 padding 20 36 24 36、纵向 gap 12、底 cream（规格 #F7F8FA 的 token 近似）
 *   1) 日历工具行：高 60、横向 gap 16
 *        左 = 「2026年8月」18/600 + 上/下月箭头 32×32
 *        中 = 「今天」胶囊（pine-soft 底、圆角 9999、高 28、padding 0 14）
 *        右 = 视图切换分段控件（月 / 周 / 日程）
 *   2) 图例行（CalendarLegend）
 *   3) 筛选行（CalendarFilters，§3.7）
 *   4) 日历卡片：圆角 24、底 sunken、内部 gap 8
 *        · 星期表头 一~日 11，**六/日 按主题取相反变体**（§1.2 角色表末行）
 *        · 日期网格 7 列 × 6 行（MonthDayCell）
 *
 * ── 亮暗两套底（画板 14 末尾专门警告「别用同一个」）──
 *   规格给的是两个裸 hex：内容区 `#F7F8FA`、日历卡 `#F1F3F7`。
 *   按「零新色」纪律做 token 近似（差异均为 Δ≈2，肉眼不可分）：
 *     内容区底 → `bg-cream`（亮 #F8FAFC / 暗 #141619，暗色与规格完全一致）
 *     日历卡底 → `bg-sunken`（亮 #F1F5F9 / 暗 #0F1217 ≈ 规格 #101215）
 *   详见交付报告的映射表。
 *
 * ── 休息日口径（有意偏离设计稿，见下方注释）──
 *   画板 14 把「周末」写作「六 / 日」，本项目有休息制度配置（双休/单休/大小休），
 *   业务真相源是 lib/workdays.isRestDay。格子底色一律走 isRestDay，
 *   **不硬编码周六周日** —— 单休制下只有周日休息，硬编码会把功能做坏。
 *
 * ── 数据层与业务逻辑未动 ──
 *   calendarMath 的纯计算、useUiStore 的 calendarMonth/calendarFilters 契约、
 *   isRestDay 口径、四类空状态的判定条件全部保持原样；本次只做视觉与交互重构。
 */

/** 视图密度（画板 14 工具行右端的分段控件；§7.2 D2「方案 A 为主 + 允许切周」的配套） */
type CalendarDensity = 'month' | 'week' | 'agenda';

const DENSITY_OPTIONS = [
  { value: 'month' as const, label: '月' },
  { value: 'week' as const, label: '周' },
  { value: 'agenda' as const, label: '日程' },
];

/** 手机（<768px）判定：月历手机适配用（纯 CSR SPA，window 可用） */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const onChange = (): void => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

/** 工具行里的上/下月箭头：桌面 32×32（画板 14），移动端放大到 44×44 满足触控 ≥44（画板 19） */
function MonthArrow({
  direction,
  onClick,
}: {
  direction: 'prev' | 'next';
  onClick(): void;
}): JSX.Element {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === 'prev' ? '上个月' : '下个月'}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-line bg-paper text-ink transition-colors hover:bg-sunken md:h-[32px] md:w-[32px]"
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}

export function MonthlyCalendarView({ onManual }: { onManual?(): void }): JSX.Element {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { theme } = useTheme();
  const calendarMonth = useUiStore((s) => s.calendarMonth);
  const setCalendarMonth = useUiStore((s) => s.setCalendarMonth);
  const filters = useUiStore((s) => s.calendarFilters);
  const toggleStatus = useUiStore((s) => s.toggleCalendarStatusFilter);
  const toggleStage = useUiStore((s) => s.toggleCalendarStageFilter);
  const clearFilters = useUiStore((s) => s.clearCalendarFilters);

  const projects = useProjectsStore((s) => s.projects);
  const stages = useProjectsStore((s) => s.stages);
  const tasks = useProjectsStore((s) => s.tasks);
  const restPolicy = useSettingsStore((s) => s.restPolicy);

  const { role, currentMember } = useRoleGuard();
  const memberView = isRestrictedView(role);

  const [density, setDensity] = useState<CalendarDensity>('month');

  const meta: CalendarMonthMeta = useMemo(() => buildMonthMeta(calendarMonth), [calendarMonth]);
  const active = useMemo(() => projects.filter((p) => p.status === 'active'), [projects]);

  const currentMemberId = currentMember?.id ?? null;
  const stagesOf = (p: Project): Stage[] => stages.filter((s) => s.projectId === p.id);
  const tasksOf = (p: Project): Task[] => tasks.filter((t) => t.projectId === p.id);

  const [selectedDate, setSelectedDate] = useState(meta.todayIso);

  // 切换月份时，若选中日期不在当月，则重置为当月 1 日
  useEffect(() => {
    if (selectedDate < meta.monthStart || selectedDate > meta.monthEnd) {
      setSelectedDate(meta.monthStart);
    }
  }, [meta, selectedDate]);

  const baseEntries: CalendarEntry[] = useMemo(() => {
    return active
      .filter((p) => {
        // 月份命中范围（图3修复）：取「阶段实际起止 ∪ 项目计划基线」覆盖当月才渲染，
        // 否则阶段被拖出计划范围后，那段月历会被裁剪（评审指出的易漏点）。
        const span = stageSpan(stagesOf(p));
        const s = span && span.minStart < p.plannedStartAt ? span.minStart : p.plannedStartAt;
        const e = span && span.maxEnd > p.plannedEndAt ? span.maxEnd : p.plannedEndAt;
        return s <= meta.monthEnd && e >= meta.monthStart;
      })
      .filter((p) => {
        if (!memberView) return true;
        const ids = computeRelatedStageIds({
          memberView: true,
          currentMemberId,
          stages: stagesOf(p),
          tasks: tasksOf(p),
        });
        if (!ids) return true;
        return p.id ? stagesOf(p).some((s) => ids.has(s.id)) : false;
      })
      .map((p) => computeCalendarEntry(p, stagesOf(p), meta));
  }, [active, meta, memberView, currentMemberId, stages, tasks]);

  const finalEntries = useMemo(() => filterEntries(baseEntries, filters), [baseEntries, filters]);

  /** 四类空状态的判定条件与触发时机（业务语义，本次重构**未改**） */
  const emptyKind: EmptyKind = useMemo(() => {
    if (active.length === 0) return 'E1';
    if (baseEntries.length === 0) return memberView ? 'E4' : 'E2';
    if (finalEntries.length === 0) return 'E3';
    return null;
  }, [active.length, baseEntries.length, finalEntries.length, memberView]);

  // 键盘 ←/→ 切换月份（既有功能保留）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCalendarMonth(shiftMonth(calendarMonth, -1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCalendarMonth(shiftMonth(calendarMonth, 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [calendarMonth, setCalendarMonth]);

  const thisMonth = useMemo(
    () => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    [],
  );

  const gridDays = useMemo(() => buildCalendarGrid(meta, selectedDate), [meta, selectedDate]);
  const weekDays = useMemo(() => gridDaysOf(weekOf(selectedDate), selectedDate, meta.todayIso), [
    selectedDate,
    meta.todayIso,
  ]);

  const entriesOnDate = (date: string): CalendarEntry[] =>
    finalEntries.filter((e) => e.bandStart <= date && e.bandEnd >= date);

  const open = (projectId: string): void => navigate(`/project/${projectId}`);

  const goToday = (): void => {
    setCalendarMonth(thisMonth);
    setSelectedDate(meta.todayIso);
  };

  /** 六 / 日表头色：亮色页 = lightText（深调），暗色页 = main（亮调）——§1.2 角色表末行 */
  const weekendColor = weekendHeaderColor(theme);

  /** 星期表头（画板 14：11；六/日 着色；移动端同尺寸 11） */
  const weekdayHeader = (
    <div className="grid grid-cols-7">
      {WEEKDAYS.map((w, i) => (
        <div
          key={w}
          className={cn('pb-[6px] text-center text-[11px]', i >= 5 ? 'font-medium' : 'text-mist')}
          style={i >= 5 ? { color: weekendColor } : undefined}
        >
          {w}
        </div>
      ))}
    </div>
  );

  /** 日历卡片（画板 14：圆角 24、底 sunken、内部 gap 8） */
  const calendarCard = (children: JSX.Element): JSX.Element => (
    <div className="rounded-[24px] bg-sunken p-[10px] md:p-[16px]">
      <div className="flex min-w-0 flex-col gap-[8px]">{children}</div>
    </div>
  );

  const grid = (days: GridDay[], cols = 'grid-cols-7'): JSX.Element => (
    <div className={cn('grid', cols, 'gap-px overflow-hidden overflow-x-hidden rounded-[12px] bg-line')}>
      {days.map((day) => (
        <MonthDayCell
          key={day.date}
          day={day}
          items={entriesOnDate(day.date)}
          /* ★ 休息日一律走公司制度判定，不硬编码周六周日（画板 14 的「六/日」是双休语境） */
          isRest={isRestDay(day.date, restPolicy)}
          isMobile={isMobile}
          onSelect={() => setSelectedDate(day.date)}
          onOpen={open}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-[12px] bg-cream px-[16px] pb-[24px] pt-[20px] md:px-[36px]">
      {/* ① 日历工具行（画板 14：高 60 / 横向 gap 16） */}
      <div className="flex flex-col gap-[10px] md:h-[60px] md:flex-row md:items-center md:gap-[16px]">
        {/* 左：年月 + 上/下月 */}
        <div className="flex min-w-0 items-center gap-[8px] md:shrink-0">
          <MonthArrow direction="prev" onClick={() => setCalendarMonth(shiftMonth(calendarMonth, -1))} />
          <h2 className="min-w-0 flex-1 truncate text-center text-[18px] font-semibold text-ink md:flex-none md:text-left">
            {meta.label}
          </h2>
          <MonthArrow direction="next" onClick={() => setCalendarMonth(shiftMonth(calendarMonth, 1))} />
        </div>

        {/* 中 + 右：桌面「今天」居中、「月/周/日程」靠右；移动端两者共处一行（画板 19） */}
        <div className="flex items-center justify-between gap-[12px] md:flex-1 md:gap-[16px]">
          <div className="md:flex md:flex-1 md:justify-center">
            <button
              type="button"
              onClick={goToday}
              className={cn(
                // 画板 14：pine-soft 底、圆角 9999、高 28、padding 0 14。
                // 画板 19：移动端宽 54 × 高 28（padding 略放宽到 16 凑出同量级宽度）。
                'inline-flex h-[28px] items-center rounded-full bg-pine-soft text-[13px] font-medium text-pine transition-colors hover:brightness-95',
                'px-[16px] md:px-[14px]',
              )}
            >
              今天
            </button>
          </div>
          <div className="md:flex md:shrink-0 md:justify-end">
            <SegmentedControl
              value={density}
              onChange={setDensity}
              options={DENSITY_OPTIONS}
              ariaLabel="月历视图密度"
            />
          </div>
        </div>
      </div>

      {/* 移动端日期详情行（画板 19 第 3 项：桌面画板 14 无此行，日期由选中格高亮表达） */}
      <div className="flex flex-col gap-[2px] md:hidden">
        <span className="text-[13px] font-medium text-ink">{formatSelectedDate(selectedDate)}</span>
        <span className="text-[11px] text-mist">{lunarLabel()}</span>
      </div>

      {/* ② 图例行 */}
      <CalendarLegend />

      {/* ③ 筛选行 */}
      <CalendarFilterPanel
        filters={filters as CalendarFilters}
        onToggleStatus={toggleStatus}
        onToggleStage={toggleStage}
        onClear={clearFilters}
      />

      {/* ④ 日历卡片 / 空状态四态 */}
      {emptyKind ? (
        <CalendarEmptyStates
          kind={emptyKind}
          monthLabel={meta.label}
          gridDays={gridDays}
          filters={filters as CalendarFilters}
          memberProject={active[0] ?? null}
          onClear={clearFilters}
          onManual={onManual}
          onToggleStatus={toggleStatus}
          onToggleStage={toggleStage}
        />
      ) : density === 'month' ? (
        calendarCard(
          <>
            {weekdayHeader}
            {grid(gridDays)}
          </>,
        )
      ) : density === 'week' ? (
        calendarCard(
          <>
            {/* 周视图（画板 18-C / §7.2 D2「允许切周」）：同一套日期格，7 列一行 */}
            <div className="pb-[2px] text-[11px] text-mist">
              {meta.label} · 本周（周一 ~ 周日）
            </div>
            {weekdayHeader}
            {grid(weekDays)}
          </>,
        )
      ) : (
        calendarCard(
          // 日程视图（§7.2 D2 的补充档）：按月列出在途项目的阶段区间，纯清单、无网格
          <div className="flex flex-col gap-[8px]">
            {[...finalEntries]
              .sort((a, b) => (a.bandStart < b.bandStart ? -1 : a.bandStart > b.bandStart ? 1 : 0))
              .map((e) => (
                <div
                  key={e.project.id}
                  className="flex min-w-0 flex-wrap items-center gap-[10px] rounded-[12px] bg-paper px-[12px] py-[10px]"
                >
                  <span
                    aria-hidden
                    className="h-[12px] w-[12px] shrink-0 rounded-[3px]"
                    style={{ backgroundColor: e.color }}
                  />
                  <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                    {e.project.name}
                  </span>
                  <span className="text-[12px] text-mist">{stageLabelOf(e)}</span>
                  <span className="tabular-nums text-[12px] text-mist">
                    {e.bandStart} – {e.bandEnd}
                  </span>
                  <span className="tabular-nums text-[11px] text-mist">
                    {Math.round(e.percent)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => open(e.project.id)}
                    className="ml-auto shrink-0 text-[12px] text-pine hover:underline"
                  >
                    查看
                  </button>
                </div>
              ))}
          </div>,
        )
      )}
    </div>
  );
}
