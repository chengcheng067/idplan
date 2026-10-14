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

import { useRef, type KeyboardEvent } from 'react';

import { cn } from '../../lib/cn';
import { calendarStatusLabel, useLang } from '../../i18n';
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
  if (entry.status === 'completed') return calendarStatusLabel('completed');
  if (entry.status === 'not_started') return calendarStatusLabel('not_started');
  return calendarStatusLabel('in_progress');
}

/**
 * 日期格上的节假日徽章（**已取词**的两件事捆在一起传）。
 *
 * ⚠️ 为什么是「一个对象两个字段」而不是两个独立 prop：
 *   `text`（显示字：节日名 / 「班」）与 `makeup`（aria 说的是「调休补班日」还是节日名）
 *   来自**同一个事实**（`core/holidays` 的 `holidayMarkOf`）。拆成两个 prop 时，
 *   调用方漏传/传错一个就会出现「显示『班』但读屏念节日名」——捆在一起则不可能失配。
 * ⚠️ `text` 是**已按界面语言取好词**的字：本组件不碰 `core/holidays`，
 *   也不做 `=== '班'` 这类**字符串比较**（那正是英文态会静默失效的哑雷形态）。
 */
export interface DayHolidayBadge {
  /** 显示字（屏幕侧：`cnHolidayNameLabel(name)` 或 `t('calendar.holiday.makeupBadge')`） */
  text: string;
  /** 是否「调休补班」徽章（决定 aria 读「调休补班日」还是节日名） */
  makeup: boolean;
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
  /* 取词 + 订阅语言变化：`t()` 本身不订阅（见 src/i18n/useLang.ts 纪律 ②），
     本组件没有别的订阅点，必须自己调一次，否则切语言后 aria-label 不更新。 */
  const { t } = useLang();
  return (
    <button
      type="button"
      /*
       * ★ 语言无关定位钩子（笔 3-B）：`aria-label` 已改走消息表
       * （`calendar.cell.openProject`），英文态会变成 `Open project X` ——
       * 拿中文那半截当选择器的（`button[aria-label^="打开项目"]`）会**静默失配**，
       * 且失败会伪装成「按钮不存在」。故另给两个不改语言、只承担事实的钩子：
       *   `data-entry-open`  = 「这是一条打开项目的条目」（定位用）
       *   `data-entry-name`  = 项目名（取名字用，免去从 aria 里正则剥前缀）
       * aria 的无障碍契约仍在（下一行），只是不再当选择器。
       */
      data-entry-open=""
      data-entry-name={entry.project.name}
      onClick={(ev) => {
        ev.stopPropagation();
        onOpen(entry.project.id);
      }}
      aria-label={t('calendar.cell.openProject', { name: entry.project.name })}
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
  holiday,
  tabStop,
  onCellFocus,
  onSelect,
  onOpen,
  onOpenDay,
}: {
  day: GridDay;
  items: CalendarEntry[];
  /** 是否休息日。**由调用方走 lib/workdays.isRestDay 得出**（见 calendarGrid「休息日口径」说明） */
  isRest: boolean;
  isMobile: boolean;
  /**
   * 节日名小字（法定节假日）或「班」徽章（调休补班日）；null/缺省 = 不显示。
   * 由调用方从内置节假日表（core/holidays）按 skipHolidays 开关取**事实**，
   * 再在渲染侧取词（笔 3-B：本组件不再做 `=== '班'` 比较，见 `DayHolidayBadge`）。
   * 与底纹同源：节假日 isRestDay 自动 true 落 bg-rest-day，补班日落 bg-paper。
   */
  holiday?: DayHolidayBadge | null;
  /**
   * ★ F7（键盘可达）：本格是不是整张网格里**唯一**的 Tab 停靠点（roving tabindex）。
   * 由调用方按「上次聚焦的日期 → 今天 → 本月第一天」派生，保证任何月份下恰有一格可 Tab 到。
   */
  tabStop: boolean;
  /**
   * 本格**自身**获得焦点时上报（roving 停靠点随之移动，避免 42 格全进 Tab 序列）。
   * 注意：只在 `e.target === e.currentTarget` 时调用 —— 见下方 onFocus 的说明。
   */
  onCellFocus(): void;
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
  /* 取词 + 订阅语言变化（本格自己的 aria 与计数小字都要随语言变） */
  const { t } = useLang();

  const limit = isMobile ? COLLAPSE_LIMIT_MOBILE : COLLAPSE_LIMIT_DESKTOP;
  const crowded = items.length > limit;
  const hiddenCount = Math.max(0, items.length - limit);

  /**
   * 格子的可访问名：`${日期}${（今天）}${，N 个项目}${，节日/补班}`。
   * 三段都是消息表取值（**分隔符也住在键里**：中文全角、英文半角），
   * 本文件里**不出现**任何硬编码标点或中文 —— 否则英文态会拼出半中半英的读音。
   */
  const holidayAria = holiday ? (holiday.makeup ? t('calendar.holiday.makeupAria') : holiday.text) : '';
  const cellAriaLabel =
    day.date +
    (day.isToday ? t('calendar.cell.todaySuffix') : '') +
    t('calendar.cell.countSuffix', { n: items.length }) +
    (holidayAria ? t('calendar.cell.holidaySuffix', { label: holidayAria }) : '');

  /**
   * ★ F7 · 网格键盘导航（修前：日格是 `<div onClick>` —— 无 role/tabIndex/键处理，
   * Tab 永远落不到格子上，日格选中这条主路径**纯鼠标**；同伴范式见
   * ProjectCard.tsx:289-297 的 `role="button" + tabIndex + Enter/Space`）。
   *
   * 规则：
   *   ←/→ 前后一格；↑/↓ 上下跳一行；Home/End 到本行首/尾；Enter/Space = 选中（同 onSelect）。
   * 两个刻意的实现选择：
   *   ① **列数从计算样式读**（`grid-template-columns` 的轨道数），不写死 7 ——
   *      月视图 42 格（6×7）与周视图 7 格共用本组件，写死 7 在别处会越界。
   *      jsdom 无布局 ⇒ 计算样式为空串，回落 7（单测据此断言 ↑/↓ = ±7）。
   *   ② 焦点移动**只碰 DOM**（`cells[next].focus()`），不往父层塞第二份「当前格」真相：
   *      roving 停靠点由 `onFocus` 上报，React 状态始终是唯一真相源。
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      onSelect();
      return;
    }
    const self = cellRef.current;
    const grid = self?.parentElement;
    if (!self || !grid) return;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-day-cell]'));
    const idx = cells.indexOf(self);
    if (idx < 0) return;
    const colsRaw = getComputedStyle(grid).gridTemplateColumns.trim();
    const cols = colsRaw ? colsRaw.split(/\s+/).filter(Boolean).length : 7;
    const rowStart = idx - (idx % cols);
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
        next = idx + 1;
        break;
      case 'ArrowLeft':
        next = idx - 1;
        break;
      case 'ArrowDown':
        next = idx + cols;
        break;
      case 'ArrowUp':
        next = idx - cols;
        break;
      case 'Home':
        next = rowStart;
        break;
      case 'End':
        next = rowStart + cols - 1;
        break;
      default:
        return;
    }
    if (next < 0 || next >= cells.length) return;
    e.preventDefault();
    cells[next]?.focus();
  };

  return (
    <div
      ref={cellRef}
      data-day-cell=""
      data-day-date={day.date}
      /*
       * ★ 语言无关的「格事实」钩子（笔 3-B）：`aria-label` 已整条走消息表，
       * 英文态形如 `2026-10-01 (today), 9 projects` ——
       * 凡是「从中文 aria 里正则抠出今天 / 条目数」的地方（`aria-label*="（今天）"`、
       * `/，(\d+) 个项目/`）在英文态都会**静默抠不到**。故把这两件事实各给一个钩子：
       *   `data-day-today`  = 该格是今天（属性存在即真，无值）
       *   `data-day-count`  = 该格条目数（数字，取数不再依赖文案）
       * aria 的无障碍契约仍在（下方 `aria-label={cellAriaLabel}`），只是不再当数据源。
       */
      data-day-today={day.isToday ? '' : undefined}
      data-day-count={items.length}
      /*
       * ★ F7：`aria-label` 此前挂在一个**不可聚焦**的 div 上（等于白写）；补 role+tabIndex
       * 之后它才真正被读屏播报。role 用 button（本仓既有范式）而非 gridcell：
       * 42 格无 row 包裹（`grid-cols-7` 要求格是容器的直接子元素），
       * 挂 gridcell 会得到「有格无行」的半套 ARIA，反而更差。
       */
      role="button"
      tabIndex={tabStop ? 0 : -1}
      aria-pressed={day.isSelected}
      onClick={onSelect}
      /*
       * ★ 只在**格子自身**拿到焦点时才上报 roving 停靠点。
       *
       * 为什么必须加这个 target 判断（真机实测踩到的坑）：React 的 onFocus 走 focusin，
       * **会冒泡** —— 格内条目按钮（EntryRow / 「…+N」）获得焦点时事件也会冒到格子上。
       * 不判断的话，键盘用户从网格前面 Tab 进来时：焦点先落到「10-01 格内第一个条目」
       * → 停靠点被改写成 10-01 → 之后所有 42 格再重渲染时，唯一 tabIndex=0 的变成
       * 10-01（已经**在用户身后**），于是「今天」那一格变成 -1 —— 结果是
       * **正向 Tab 永远落不到任何日格**（实测：130 次 Tab 遍历整页 1.25 轮，一次都没落到）。
       * 加了判断后停靠点只在格子本体被聚焦（含方向键移动）时移动，Tab 才能落进网格。
       */
      onFocus={(e) => {
        if (e.target === e.currentTarget) onCellFocus();
      }}
      onKeyDown={onKeyDown}
      className={cn(
        'relative flex cursor-pointer flex-col gap-[4px] overflow-hidden p-[4px] transition-colors md:p-[6px]',
        // 格底色三分：当月 paper / 休息日 rest-day / 非当月 cream
        day.inMonth ? (isRest ? 'bg-rest-day' : 'bg-paper') : 'bg-cream',
        day.inMonth ? 'text-ink' : 'text-mist',
        'hover:bg-sand/40',
        // 选中格高亮（既有功能保留）
        day.isSelected && 'ring-1 ring-inset ring-pine',
        /*
         * ★ F7 焦点指示**必须内描边**：格子是不透明底、彼此紧邻，且整张网格带
         * `overflow-hidden` —— 全局那圈 3px 外描边会被右侧/下方后画的兄弟格盖掉、
         * 在网格边缘还会被裁掉。内描边画在格内，任何位置都完整可见，
         * 也与选中态的 `ring-inset` 同一套视觉语言。
         */
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pine/70',
      )}
      /* 恒高走常量（单一来源）：桌面 86 / 窄窗 78。
         用 height 而非 min-height —— 定稿铁律 1「格子高度恒定」：内容超限裁掉，
         任何交互（含「+N」浮层）都不允许把格子撑高。 */
      style={{ height: isMobile ? MOBILE_CELL_H : DESKTOP_CELL_H }}
      aria-label={cellAriaLabel}
    >
      {/* 日号（今天 = 18×18 pine 圆点 + 白字）；色点轴线对齐日号字轴（§3.5.1）
          ⚠️ 2026-10-08 二次拍板：定稿当时把「今天」改成自然绿 #2F9E77（--cal-today），
          她看过实物后改回主题色靛蓝——「和别的地方不像」。用 bg-pine 而非写色值：
          pine 随亮/暗主题自动换值（亮 #6366f1 / 暗 #828cf7），--cal-today 已删。 */}
      <div className="flex items-center justify-between gap-[2px]">
        {/* 日号 + 节日名小字（iPhone 日历「寒露」形态）：同款 text-mist token，零新色 */}
        <span className="flex min-w-0 items-center gap-[4px]">
          {day.isToday ? (
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-pine text-[11px] font-medium text-white">
              {day.day}
            </span>
          ) : (
            <span className={cn('text-[11px] md:text-[13px]', day.inMonth ? 'text-ink' : 'text-mist')}>
              {day.day}
            </span>
          )}
          {holiday && (
            <span className="truncate text-[9px] leading-tight text-mist" title={holiday.text}>
              {holiday.text}
            </span>
          )}
        </span>
        {/* 移动端双行小字（画板 19）：不拥挤时给一个计数，拥挤时由「+N」承担 */}
        {isMobile && items.length > 0 && !crowded && (
          <span className="whitespace-nowrap text-[9px] leading-tight text-mist">
            {t('calendar.cell.mobileCount', { n: items.length })}
          </span>
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
              /* ★ 语言无关定位钩子（笔 3-B）：aria 已走消息表（`calendar.cell.expandAria`），
                 英文态形如 `Expand the day list of 3 projects` —— 拿「展开」当选择器的
                 （`button[aria-label^="展开"]`）会静默失配。取「+N」入口请用本钩子。 */
              data-day-expand=""
              aria-label={t('calendar.cell.expandAria', { n: hiddenCount })}
              className="min-w-0 truncate text-left text-[10px] text-mist transition-colors hover:text-ink md:text-[11px]"
            >
              {/* 窄窗是纯计数 `+N`（无单位字，不随语言变）；桌面带「…+N 个项目」 */}
              {isMobile ? `+${hiddenCount}` : t('calendar.cell.overflow', { n: hiddenCount })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
