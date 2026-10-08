/**
 * 月历日期格（画布定稿 2026-10-08「B 方案」· 规格 §3.5/§3.5.1/§3.6/§5）。
 *
 * ── 画布定稿（ardot 733991817247895，用户已确认）──
 *   月历格内条目**废除整条实心色带**，改为「小色点 + 项目名」：
 *     · 色点 8×8 圆形，取该阶段「实心块」色（stageSolidOf，亮 = main / 暗 = lightBar，
 *       自定义色走 --stage-local-solid）；未开始幽灵态 = 空心点（同色描边 1.5px、内部透明）。
 *     · 条目名 11px（移动端 10px），超宽 truncate；title 仍给全量「项目 · 阶段 · 百分比」。
 *     · 条目流：两列栅格（CSS grid repeat(2, minmax(0,1fr))，移动端单列）——
 *       每列的色点各自成一条竖线（§3.5.1 对齐规则：靠栅格列对齐，禁止按序号奇偶推断宽度）。
 *     · 溢出标（§3.6）：满排优先，真放不下的才折叠为「…+N 个项目」（移动端「+N」），
 *       纯文字、无底色；**点击弹当日浮层（DayItemsPopover），格内永不就地展开**。
 *     · 格子高度**恒定**（桌面 86 / 窄窗 78，calendarGrid 常量）：height + overflow:hidden，
 *       内容超限裁掉。旧版「点 +N 就地展开把格子撑高」是需求方明确反馈过的
 *       （「格子撑高、行高跳变」+「我已经点不动了，没有办法再继续展开」），本定稿从机制上废除。
 *
 * ── 历史（画板 14/18-A/19 的纯色带方案 + 就地展开清单）已被本定稿取代 ──
 *   色带的发丝描边（BUG-04）随色带一并退役：8px 色点在亮暗两主题格底上
 *   对比度均 ≥ 3（实心块角色本就是为小面积设计的），无需描边。
 */

import { useRef } from 'react';

import { cn } from '../../lib/cn';
import {
  MOBILE_CELL_H,
  DESKTOP_CELL_H,
  type GridDay,
} from './calendarGrid';
import { EntryDot } from './EntryDot';
import type { CalendarEntry } from './calendarMath';

/**
 * 折叠阈值（§3.6 画布定稿）：两列栅格下桌面满排 2 行 = 4 条，移动端单列 2 条。
 * 超出即出现「…+N 个项目」；点击弹出当日浮层全列，**不就地展开**。
 */
const COLLAPSE_LIMIT_DESKTOP = 4;
const COLLAPSE_LIMIT_MOBILE = 2;

/** 清单行里的阶段名：激活阶段优先，否则按状态给一个可读词，绝不留空 */
export function stageLabelOf(entry: CalendarEntry): string {
  if (entry.activeStage) return entry.activeStage.name;
  if (entry.status === 'completed') return '已完成';
  if (entry.status === 'not_started') return '未开始';
  return '进行中';
}

/** 折叠态单条条目：色点 + 项目名（B 方案画布定稿形态） */
function EntryRow({
  entry,
  isMobile,
  onOpen,
}: {
  entry: CalendarEntry;
  isMobile: boolean;
  onOpen(projectId: string): void;
}) {
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onOpen(entry.project.id);
      }}
      aria-label={`打开项目 ${entry.project.name}`}
      title={`${entry.project.name} · ${stageLabelOf(entry)} · ${Math.round(entry.percent)}%`}
      className="flex min-w-0 items-center gap-[5px] text-left"
    >
      {/* 色点 8×8 圆形；幽灵态 = 空心（同色 1.5px 描边、内部透明），§3.5 未开始语义 */}
      <EntryDot
        entry={entry}
        className={cn('h-[8px] w-[8px] rounded-full', entry.isGhost && 'opacity-80')}
      />
      <span
        className={cn(
          'min-w-0 truncate',
          isMobile ? 'text-[10px]' : 'text-[11px]',
          'text-ink',
        )}
      >
        {entry.project.name}
      </span>
    </button>
  );
}

export function MonthDayCell({
  day,
  items,
  isRest,
  isMobile,
  onSelect,
  onOpen,
  onOpenDay,
}: {
  day: GridDay;
  items: CalendarEntry[];
  /** 是否休息日。**由调用方走 lib/workdays.isRestDay 得出**（见 calendarGrid「休息日口径」说明） */
  isRest: boolean;
  isMobile: boolean;
  onSelect(): void;
  onOpen(projectId: string): void;
  /**
   * 「+N」回调：把**当天全部条目**与锚定格 DOM 交给调用方弹当日浮层。
   * 状态必须住在外层（MonthlyCalendarView）——浮层是 body portal 的跨格浮层，
   * 住格子会被 overflow:hidden 整块裁掉（规格 §5.1，有实测记录）。
   */
  onOpenDay(items: CalendarEntry[], anchorEl: HTMLElement): void;
}): JSX.Element {
  const cellRef = useRef<HTMLDivElement>(null);

  const limit = isMobile ? COLLAPSE_LIMIT_MOBILE : COLLAPSE_LIMIT_DESKTOP;
  const crowded = items.length > limit;
  const hiddenCount = Math.max(0, items.length - limit);

  return (
    <div
      ref={cellRef}
      data-day-cell=""
      onClick={onSelect}
      className={cn(
        'relative flex cursor-pointer flex-col gap-[4px] overflow-hidden p-[4px] transition-colors md:p-[6px]',
        // 格底色三分：当月 paper / 休息日 rest-day / 非当月 cream
        day.inMonth ? (isRest ? 'bg-rest-day' : 'bg-paper') : 'bg-cream',
        day.inMonth ? 'text-ink' : 'text-mist',
        'hover:bg-sand/40',
        // 选中格高亮（既有功能保留）
        day.isSelected && 'ring-1 ring-inset ring-pine',
      )}
      /* 恒高走常量（单一来源）：桌面 86 / 窄窗 78。
         用 height 而非 min-height —— 定稿铁律 1「格子高度恒定」：内容超限裁掉，
         任何交互（含「+N」浮层）都不允许把格子撑高。 */
      style={{ height: isMobile ? MOBILE_CELL_H : DESKTOP_CELL_H }}
      aria-label={`${day.date}${day.isToday ? '（今天）' : ''}，${items.length} 个项目`}
    >
      {/* 日号（今天 = 18×18 pine 圆点 + 白字）；色点轴线对齐日号字轴（§3.5.1）
          ⚠️ 2026-10-08 二次拍板：定稿当时把「今天」改成自然绿 #2F9E77（--cal-today），
          她看过实物后改回主题色靛蓝——「和别的地方不像」。用 bg-pine 而非写色值：
          pine 随亮/暗主题自动换值（亮 #6366f1 / 暗 #828cf7），--cal-today 已删。 */}
      <div className="flex items-center justify-between gap-[2px]">
        {day.isToday ? (
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-pine text-[11px] font-medium text-white">
            {day.day}
          </span>
        ) : (
          <span className={cn('text-[11px] md:text-[13px]', day.inMonth ? 'text-ink' : 'text-mist')}>
            {day.day}
          </span>
        )}
        {/* 移动端双行小字（画板 19）：不拥挤时给一个计数，拥挤时由「+N」承担 */}
        {isMobile && items.length > 0 && !crowded && (
          <span className="whitespace-nowrap text-[9px] leading-tight text-mist">{items.length} 个</span>
        )}
      </div>

      {/* 条目流（两列栅格，§3.5.1；溢出隐藏，保证任何情况下都不横向滚动） */}
      <div className={cn('min-w-0 flex-1 overflow-hidden', !day.inMonth && 'opacity-70')}>
        {/* 折叠态：满排优先（B 方案画布定稿），真放不下的才进「…+N」→ 当日浮层 */}
        <div
          className={cn(
            'grid min-w-0 gap-x-[10px] gap-y-[3px]',
            isMobile ? 'grid-cols-1' : 'grid-cols-2',
          )}
        >
          {items.slice(0, limit).map((e) => (
            <EntryRow key={e.project.id} entry={e} isMobile={isMobile} onOpen={onOpen} />
          ))}
          {crowded && (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                // 锚点传格子本体（浮层贴格展开，规格 §5.1）。点按钮时 ref 必已挂载，
                // 用非空断言拿 DOM；+N 按钮自身保持焦点，浮层关闭后经 activeElement
                // 还原链把焦点还给本按钮（§5.3）。
                const anchor = cellRef.current;
                if (anchor) onOpenDay(items, anchor);
              }}
              aria-label={`展开 ${hiddenCount} 个项目的当日清单`}
              className="min-w-0 truncate text-left text-[10px] text-mist transition-colors hover:text-ink md:text-[11px]"
            >
              {isMobile ? `+${hiddenCount}` : `…+${hiddenCount} 个项目`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
