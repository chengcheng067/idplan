import { dayjs } from '../../lib/date';
import { cn } from '../../lib/cn';
import { isRestDay } from '../../lib/workdays';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { CalendarMonthMeta } from './calendarMath';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 月历日期列头（列=当月日期，28~31）：
 * - 休息日列底色微沉（bg-rest-day；原来是「周末」，现在按公司休息制度走）
 * - 每 7 天弱竖向分隔（border-line/40）
 * - 今日列高亮（bg-pine-soft + 顶部 pine 描边）
 * - 左列 sticky 锁定的表头占位（与行左列同宽）
 */

export function MonthGridHeader({
  meta,
  colWidth,
  leftWidth,
}: {
  meta: CalendarMonthMeta;
  colWidth: number;
  leftWidth: number;
}): JSX.Element {
  const restPolicy = useSettingsStore((s) => s.restPolicy);

  const cells = Array.from({ length: meta.daysInMonth }, (_, i) => {
    const day = i + 1;
    const dateStr = dayjs(meta.monthStart).add(i, 'day').format('YYYY-MM-DD');
    const weekday = dayjs(dateStr).day(); // 0=Sun..6=Sat
    // 休息日判定统一走 workdays.isRestDay：单休只有周日、大小休周六隔周
    const isRest = isRestDay(dateStr, restPolicy);
    const isToday = meta.todayInMonth && i === meta.todayIdx;
    const isWeekStart = i % 7 === 0; // 每 7 天弱分隔
    return { day, weekday, isRest, isToday, isWeekStart };
  });

  return (
    <div className="flex border-b border-line bg-paper">
      {/* 左列表头占位（sticky） */}
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center border-r border-line bg-paper px-3 text-xs font-medium text-mist"
        style={{ width: leftWidth }}
      >
        项目
      </div>

      {/* 日期列 */}
      <div className="flex" style={{ width: meta.daysInMonth * colWidth }}>
        {cells.map((c) => (
          <div
            key={c.day}
            className={cn(
              'flex flex-col items-center justify-center py-1.5 text-[11px] leading-tight',
              c.isWeekStart && 'border-l border-line/40',
              c.isRest ? 'bg-rest-day text-mist' : 'text-mist',
              c.isToday && 'bg-pine-soft text-pine',
            )}
            style={{ width: colWidth }}
            title={dayjs(meta.monthStart).add(c.day - 1, 'day').format('YYYY年M月D日')}
          >
            <span className={cn('text-[10px]', c.isToday ? 'text-pine' : 'text-mist')}>
              {WEEKDAY_LABELS[c.weekday]}
            </span>
            <span className={cn('font-medium', c.isToday ? 'text-pine' : 'text-ink')}>{c.day}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
