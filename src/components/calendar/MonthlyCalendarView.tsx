import { useEffect, useLayoutEffect, useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { Project, Stage, Task } from '../../core/types/entities';
import { useUiStore } from '../../store/useUiStore';
import {
  useHumanProjects,
  useHumanStages,
  useHumanTasks,
} from '../../core/project/visibility';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTheme } from '../../hooks/useTheme';
import { useRoleGuard, isRestrictedView, computeRelatedStageIds } from '../../hooks/useRoleGuard';
import { cn } from '../../lib/cn';
import { isRestDay } from '../../lib/workdays';
import { cnHolidayIndex, holidayLabelOf } from '../../core/holidays';
import { SegmentedControl } from '../ui/SegmentedControl';
import {
  buildMonthMeta,
  shiftMonth,
  computeCalendarEntry,
  filterEntries,
  entryShowsOnDate,
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
import { EntryDot } from './EntryDot';
import { DayItemsPopover, type PopoverAnchorRect } from './DayItemsPopover';

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

  /*
    ★ v0.8 T04-A · §7.2 #7 接线（**P / Pid** 接法；用户决策 2 明文要求）。

    本组件在**两处入口**被复用 —— 管理员首页的「月历」档、以及成员看板的「月历」档。
    两条入口共用同一个过滤，所以这一处收口同时修好两个页面。

    三行各自为什么必须过滤：
      · `projects` → `active` memo（下一行）派生"本月有哪些项目" ⇒ **P**；漏了的话
        Agent 看板会在人类月历上画出色带（用户决策 2 明示这是不可接受的）。
      · `stages`  → `stageSpan(stagesOf(p))` 决定该项目的实际起止覆盖哪些月份 ⇒ **Pid**；
        漏了的话 Agent 看板的阶段会把它的月份范围**撑大**，人类项目跟着多画一段。
      · `tasks`   → 成员视图的 `computeRelatedStageIds` 判定之一（"该阶段下有我参与的任务"）
        ⇒ **Pid**；漏了的话与 #15 成员看板同一个病：AI 把任务指派给成员 ⇒
        该 Agent 看板被判定为"与我相关"，于是**漏进成员的月历**。

    ⚠️ 本组件内部**自己**做完成员过滤（`isRestrictedView` + `computeRelatedStageIds`），
       调用方**不得**再传一份数据进来（`MemberBoardPage` 的既有注释已把这条列为纪律）。
       本行的过滤是"kind 维"，与"成员维"正交，两层叠加而不是替换。
  */
  const projects = useHumanProjects();
  const stages = useHumanStages();
  const tasks = useHumanTasks();
  /* 生效口径（非原始值）：skipHolidays 开时已合并内置法定节假日表——
     休息日底纹与排期吸附都必须是「用户真正生效的那份制度」 */
  const restPolicy = useSettingsStore((s) => s.effectiveRestPolicy);
  const rawRestPolicy = useSettingsStore((s) => s.restPolicy);

  const { role, currentMember } = useRoleGuard();
  const memberView = isRestrictedView(role);

  const [density, setDensity] = useState<CalendarDensity>('month');

  const meta: CalendarMonthMeta = useMemo(() => buildMonthMeta(calendarMonth), [calendarMonth]);
  const active = useMemo(() => projects.filter((p) => p.status === 'active'), [projects]);

  const currentMemberId = currentMember?.id ?? null;
  const stagesOf = (p: Project): Stage[] => stages.filter((s) => s.projectId === p.id);
  const tasksOf = (p: Project): Task[] => tasks.filter((t) => t.projectId === p.id);

  const [selectedDate, setSelectedDate] = useState(meta.todayIso);

  /**
   * 「当日条目浮层」状态（画布定稿 2026-10-08 · 规格 §5：点「+N」弹全量清单）。
   *
   * 为什么住在 view 级而不是格子里：浮层是 body portal 的跨格浮层（格子 overflow:hidden，
   * 住进去会被整块裁掉——规格 §5.1 有实测记录）。格子的「+N」只负责把
   * 「当天全部条目 + 锚定格 DOM」回调上来。
   */
  const [dayPopover, setDayPopover] = useState<{
    day: GridDay;
    items: CalendarEntry[];
    anchorEl: HTMLElement;
  } | null>(null);
  const [popoverAnchorRect, setPopoverAnchorRect] = useState<PopoverAnchorRect | null>(null);

  // 锚定矩形同步：打开时量一次，滚动/缩放时重算（fixed 浮层不随页面滚动，
  // 锚格动了浮层必须跟着动）。锚定格被卸载（切月/切视图导致网格重挂）⇒ 直接关浮层。
  useLayoutEffect(() => {
    if (dayPopover === null) {
      setPopoverAnchorRect(null);
      return;
    }
    const sync = (): void => {
      const el = dayPopover.anchorEl;
      if (!el.isConnected) {
        setDayPopover(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setPopoverAnchorRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    };
    sync();
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
    };
  }, [dayPopover]);

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

  /**
   * 节日名查表（显示面）。仅 skipHolidays 开启时启用——开关关着就不会有合并，
   * 显示节日名会造成「这天明明要上班却写着国庆节」的假信息。
   * 内置表一次展开（~60 天），按开关布尔 memo，不在渲染路径里反复建 Set。
   */
  const holidayLabelFn = useMemo(() => {
    if (rawRestPolicy.skipHolidays !== true) return null;
    const index = cnHolidayIndex();
    return (date: string): string | null => holidayLabelOf(index, date);
  }, [rawRestPolicy.skipHolidays]);

  /**
   * 当日条目（0.8.6.0009 起叠加**休息日过滤**）：色带区间命中只是第一条件，
   * 该天还必须真的是工作日（effectiveRestPolicy 口径）——格子底纹说「这天休息」
   * （bg-rest-day + 节日名小字）而条目圆点说「这天有活」自相矛盾，她的原话：
   * 「本来国庆节是休息的，但是国庆节却被排满了」。
   * 跨休息日的阶段只在其非休息日格渲染（不是整条消失）；整段落在休息日内的
   * 条目一格都不渲染；调休补班日照常渲染（extraWorkdays 优先级最高）。
   * 规则本体与三态判例见 calendarMath.entryShowsOnDate。
   */
  const entriesOnDate = (date: string): CalendarEntry[] =>
    finalEntries.filter((e) => entryShowsOnDate(e, date, restPolicy));

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
          /* ★ 休息日一律走公司制度判定，不硬编码周六周日（画板 14 的「六/日」是双休语境）。
             此处 restPolicy = effectiveRestPolicy：skipHolidays 开时节假日自动落休息底纹。 */
          isRest={isRestDay(day.date, restPolicy)}
          isMobile={isMobile}
          holidayLabel={holidayLabelFn?.(day.date) ?? null}
          onSelect={() => setSelectedDate(day.date)}
          onOpen={open}
          onOpenDay={(items, anchorEl) => setDayPopover({ day, items, anchorEl })}
        />
      ))}
    </div>
  );

  return (
    /*
      v0.8.6.0002 · 反馈 #7：去掉根节点自带的 px-[16px] / md:px-[36px] 横向内边距。

      她的话：「日历看板这个位置，它左右两侧和上下 UI 没有对齐，我希望使其是对齐的」。
      根因：本组件在页级 px-8（32px）之内又自带一层横向内边距（移动端 16 / 桌面 36），
      而页面底色与这里的 bg-cream 同值（AppShell 根就是 bg-cream）⇒ 这层 cream 带
      视觉上不可见，可见的 sunken 日历卡因此比同页统计卡行 / 看板列**内缩 36px**
      （实测 1440 档：统计卡左缘 272，日历卡左缘 308）——左右锚点错位即她看到的
      「没对齐」。两个使用方（HomePage / MemberBoardPage）都已有页级 px，本组件
      再加一层即是双重锚点；去掉后工具行 / 图例 / 筛选 / 日历卡与页内其他块共用
      同一条左右竖线。纵向节奏不变（pt/pb 与页面 gap 原样保留）。
    */
    <div className="flex flex-col gap-[12px] bg-cream pb-[24px] pt-[20px]">
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

      {/* ② 图例行（节日名小字在场时补一条文字说明） */}
      <CalendarLegend showHolidayHint={holidayLabelFn !== null} />

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
                  data-agenda-row=""
                  className="flex min-w-0 flex-wrap items-center gap-[10px] rounded-[12px] bg-paper px-[12px] py-[10px]"
                >
                  {/* v3「B 方案」色点：与月/周格内点、当日浮层行同一枚 EntryDot ——
                      实心块角色（stageSolidOf）+ 幽灵态空心描边 + 自定义色 data-stage-key
                      三态归一（旧实现用 e.color 宽面带、幽灵实心、且漏半套 attrs） */}
                  <EntryDot entry={e} className="h-[12px] w-[12px] rounded-[3px]" />
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

      {/* 当日条目浮层（body portal，挂在本组件外也不影响 React 树归属）；
          空状态四态下没有格可点，不渲染 */}
      {dayPopover && (
        <DayItemsPopover
          day={dayPopover.day}
          items={dayPopover.items}
          anchorRect={popoverAnchorRect}
          onOpenProject={open}
          onClose={() => setDayPopover(null)}
        />
      )}
    </div>
  );
}
