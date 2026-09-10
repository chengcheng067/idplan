import { useEffect, useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import type { Project, Stage, Task } from '../../core/types/entities';
import { useUiStore } from '../../store/useUiStore';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useMembersStore } from '../../store/useMembersStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useRoleGuard, isRestrictedView, computeRelatedStageIds } from '../../hooks/useRoleGuard';
import { cn } from '../../lib/cn';
import { totalDaysInclusive } from '../../lib/date';
import { isRestDay } from '../../lib/workdays';
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
import { CalendarLegend } from './CalendarLegend';
import { CalendarFilters as CalendarFilterPanel } from './CalendarFilters';

/** 星期表头（周一为起点，与系统日历一致） */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;

const MONTH_NAMES = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

/** 本地时区 ISO（YYYY-MM-DD） */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 周一 = 0，周日 = 6 */
function mondayFirst(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** 手机（<768px）判定：月历手机适配用（纯 CSR SPA，window 可用；口径与 TimelineView 一致） */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const onChange = (): void => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

interface GridDay {
  date: string; // 'YYYY-MM-DD'
  day: number; // 公历日 1~31
  inMonth: boolean; // 是否属于当月
  isToday: boolean;
  isSelected: boolean;
}

/** 生成系统日历风格的 6×7 日期网格（含前后月填充） */
function buildCalendarGrid(meta: CalendarMonthMeta, selectedDate: string): GridDay[] {
  const first = new Date(meta.year, meta.month - 1, 1);
  const startOffset = mondayFirst(first);
  const start = new Date(meta.year, meta.month - 1, 1 - startOffset);

  const days: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = localIso(d);
    days.push({
      date: iso,
      day: d.getDate(),
      inMonth: d.getMonth() + 1 === meta.month,
      isToday: iso === meta.todayIso,
      isSelected: iso === selectedDate,
    });
  }
  return days;
}

/** 格式化顶部大日期："8月28日，星期五"（无农历时副标题留空） */
function formatSelectedDate(iso: string): string {
  const d = new Date(iso);
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `${d.getMonth() + 1}月${d.getDate()}日，${weekdays[d.getDay()]}`;
}

/** 农历占位（未来可接入 lunar-javascript；避免手写农历导致错排） */
function lunarLabel(): string {
  return '农历';
}

type EmptyKind = 'E1' | 'E2' | 'E3' | 'E4' | null;

/**
 * 月历视图（系统日历网格风格，对齐用户截图图一）：
 *   顶部大日期头 + 年月切换 + 今天；
 *   主体 7 列星期表头 + 日期格子；
 *   每个格子里显示当天覆盖的项目色条（项目进度以颜色块在日期格上延伸）。
 * 周/日密度切换当前未实现，已移除无效按钮。
 */
export function MonthlyCalendarView({ onManual }: { onManual?(): void }): JSX.Element {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const calendarMonth = useUiStore((s) => s.calendarMonth);
  const setCalendarMonth = useUiStore((s) => s.setCalendarMonth);
  const filters = useUiStore((s) => s.calendarFilters);
  const toggleStatus = useUiStore((s) => s.toggleCalendarStatusFilter);
  const toggleStage = useUiStore((s) => s.toggleCalendarStageFilter);
  const clearFilters = useUiStore((s) => s.clearCalendarFilters);

  const projects = useProjectsStore((s) => s.projects);
  const stages = useProjectsStore((s) => s.stages);
  const tasks = useProjectsStore((s) => s.tasks);
  const members = useMembersStore((s) => s.members);
  const restPolicy = useSettingsStore((s) => s.restPolicy);

  const { role, currentMember } = useRoleGuard();
  const memberView = isRestrictedView(role);

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

  const emptyKind: EmptyKind = useMemo(() => {
    if (active.length === 0) return 'E1';
    if (baseEntries.length === 0) return memberView ? 'E4' : 'E2';
    if (finalEntries.length === 0) return 'E3';
    return null;
  }, [active.length, baseEntries.length, finalEntries.length, memberView]);

  // 键盘 ←/→ 切换月份
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

  const thisMonth = useMemo(() => localIso(new Date()).slice(0, 7), []);
  const todayIso = meta.todayIso;

  const gridDays = useMemo(
    () => buildCalendarGrid(meta, selectedDate),
    [meta, selectedDate],
  );

  const entriesOnDate = (date: string): CalendarEntry[] =>
    finalEntries.filter((e) => e.bandStart <= date && e.bandEnd >= date);

  const open = (projectId: string): void => navigate(`/project/${projectId}`);

  const goToday = (): void => {
    setCalendarMonth(thisMonth);
    setSelectedDate(todayIso);
  };

  return (
    <div className="space-y-5">
      {/* 顶部大日期头（系统日历风格）；手机端两行式（标题一行、年月导航一行），避免横向挤压 */}
      <div className="glass-strong flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-line p-4 sm:gap-4 sm:p-5">
        <div className="min-w-0">
          <div className="font-display text-xl text-ink">{formatSelectedDate(selectedDate)}</div>
          <div className="mt-0.5 text-xs text-mist">{lunarLabel()}</div>
        </div>

        <div className={`flex items-center gap-3 ${isMobile ? 'w-full justify-between' : ''}`}>
          <button
            type="button"
            onClick={() => setCalendarMonth(shiftMonth(calendarMonth, -1))}
            aria-label="上个月"
            className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-line bg-paper text-lg text-ink transition-colors hover:bg-sand"
          >
            ‹
          </button>
          <h2 className="min-w-0 flex-1 text-center font-display text-display-md text-ink">
            {meta.label}
          </h2>
          <button
            type="button"
            onClick={() => setCalendarMonth(shiftMonth(calendarMonth, 1))}
            aria-label="下个月"
            className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-line bg-paper text-lg text-ink transition-colors hover:bg-sand"
          >
            ›
          </button>
          <button
            type="button"
            onClick={goToday}
            className={cn(
              'rounded-[12px] border px-4 py-2 text-sm transition-colors',
              calendarMonth === thisMonth
                ? 'border-pine bg-pine-soft text-pine-deep'
                : 'border-line bg-paper text-mist hover:bg-sand hover:text-ink',
            )}
          >
            今天
          </button>
        </div>
      </div>

      {/* 图例 + 筛选 */}
      <CalendarLegend />
      <CalendarFilterPanel
        filters={filters as CalendarFilters}
        onToggleStatus={toggleStatus}
        onToggleStage={toggleStage}
        onClear={clearFilters}
      />

      {/* 月历网格 / 空状态 */}
      {emptyKind ? (
        <EmptyState kind={emptyKind} monthLabel={meta.label} onClear={clearFilters} onManual={onManual} />
      ) : (
        <div className="glass-medium overflow-x-auto rounded-[20px] border border-line p-3 shadow-soft sm:p-4">
          <div
            className={cn(
              'grid grid-cols-7 gap-px overflow-hidden rounded-[12px] border border-line bg-sand',
              // 手机端去掉固定 560px 最小宽：7 列自适应屏宽，不再横向滚动导致右缘被裁/格子被压
              !isMobile && 'min-w-[560px]',
            )}
          >
            {/* 星期表头 */}
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="bg-cream py-2.5 text-center text-[12px] font-medium text-mist"
              >
                {w}
              </div>
            ))}

            {/* 日期格子 */}
            {gridDays.map((day) => {
              const items = entriesOnDate(day.date);
              // 休息日底纹按公司制度走（单休只有周日、大小休周六隔周）。
              // 顺带修存量 bug：原实现 new Date(iso).getDay() 是「UTC 解析 + 本地读取」，
              // 在 GMT-X 时区会把周末画错一天；isRestDay 内部统一用 dayjs 本地口径。
              const isRest = isRestDay(day.date, restPolicy);
              const showCount = isMobile ? items.length > 0 : false;
              return (
                <div
                  key={day.date}
                  onClick={() => setSelectedDate(day.date)}
                  className={cn(
                    // 结构层级 §mobile-density：手机 min-h 收紧、内部 gap/p 更紧凑；桌面维持原高度
                    'group relative flex flex-col gap-0.5 bg-paper p-1.5 transition-colors hover:bg-sand/70 sm:min-h-[120px]',
                    isMobile ? 'min-h-[92px]' : 'min-h-[110px]',
                    isRest && 'bg-rest-day/70',
                    day.isSelected && 'ring-1 ring-inset ring-pine',
                    !day.inMonth && 'opacity-60',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'flex items-center justify-center rounded-full text-sm',
                        isMobile ? 'h-6 w-6' : 'h-7 w-7',
                        day.isToday
                          ? 'bg-pine text-white'
                          : day.inMonth
                            ? 'text-ink'
                            : 'text-mist',
                      )}
                    >
                      {day.day}
                    </span>
                    {items.length > 0 && (
                      <span
                        className={cn(
                          'text-[10px] text-mist',
                          isMobile ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100',
                        )}
                      >
                        {items.length}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                    {items.slice(0, isMobile ? 2 : 3).map((e) => (
                      <button
                        key={e.project.id}
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          open(e.project.id);
                        }}
                        className={cn(
                          'w-full truncate rounded-[4px] px-1.5 py-0.5 text-left font-medium text-white transition-transform hover:scale-[1.02]',
                          isMobile ? 'text-[10px] leading-4' : 'text-[11px]',
                        )}
                        style={{ backgroundColor: e.color }}
                        title={`${e.project.name} · ${Math.round(e.percent)}%`}
                      >
                        {e.project.name}
                      </button>
                    ))}
                    {items.length > (isMobile ? 2 : 3) && (
                      <span className="text-[10px] text-mist">+{items.length - (isMobile ? 2 : 3)} 个项目</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** 四类空状态（PRD §3.6） */
function EmptyState({
  kind,
  monthLabel,
  onClear,
  onManual,
}: {
  kind: EmptyKind;
  monthLabel: string;
  onClear(): void;
  onManual?(): void;
}): JSX.Element {
  const config: Record<Exclude<EmptyKind, null>, { title: string; desc: string; cta?: 'clear' | 'manual' }> = {
    E1: {
      title: '还没有进行中的项目',
      desc: '用顶部「新建项目 → 导入合同建档」粘贴合同文本试试；任何情况下都可以先手动建档。',
      cta: 'manual',
    },
    E2: {
      title: `${monthLabel} 暂无在途项目`,
      desc: '当前月份没有跨月推进的项目，换个时间段看看，或检查项目计划日期。',
    },
    E3: {
      title: '没有符合筛选条件的项目',
      desc: '试着放宽状态或阶段筛选条件。',
      cta: 'clear',
    },
    E4: {
      title: '该项目的阶段与你无关',
      desc: '你当前身份下没有可查看的相关阶段，请先进入对应身份。',
    },
  };

  const c = config[kind as Exclude<EmptyKind, null>];

  return (
    <div className="glass-light rounded-[16px] border border-dashed border-line p-10 text-center">
      <p className="font-display text-display-md text-mist">{c.title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-mist">{c.desc}</p>
      {c.cta === 'clear' && (
        <button
          type="button"
          onClick={onClear}
          className="mt-4 rounded-md border border-pine px-4 py-2 text-sm text-pine hover:bg-pine-soft"
        >
          清除筛选
        </button>
      )}
      {c.cta === 'manual' && (
        <button
          type="button"
          onClick={() => onManual?.()}
          className="mt-4 rounded-md border border-pine px-4 py-2 text-sm text-pine hover:bg-pine-soft"
        >
          直接手动建档
        </button>
      )}
    </div>
  );
}
