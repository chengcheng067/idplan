/**
 * 月历「当日条目浮层」——「+N」点开的东西（画布定稿 2026-10-08 · 规格 §5）。
 *
 * ── 为什么必须是 body portal，不能住格子里 ──
 * 日期格是 `overflow:hidden` 的（格内容超限必须裁，这是定稿铁律 1），浮层若做格子的
 * 子元素会被整块裁掉——这个坑有实测记录（规格 §5.1）：浮层矩形超出格子边界的部分
 * 全部不可见。故本组件用 `createPortal` 挂到 `document.body`，状态由
 * `MonthlyCalendarView` 持有（浮层要跨格定位，格子自己无权持）。
 *
 * ── 形态契约（冲突时以画布定稿 HTML 为准）──
 *   · 宽 280、圆角 14、底 paper、1px line 描边、阴影走 app 现有浮层档
 *     （`shadow-overlay` = 0 24px 70px -12px …，亮暗双套，零新 token）；
 *   · 默认贴锚定格**右侧展开**，右侧空间不足翻左侧；顶缘与格对齐；底部不超视口（留 8px）；
 *   · 行清单**当天全部条目全列**（9 条就 9 条），超 6 条浮层内滚动（max-h 236）、
 *     **不截断、不出现任何不可点的「还有 N 个」死文本**（需求方 0.8.6.0002 原话：
 *     「我已经点不动了，没有办法再继续展开」——就地展开机制已从月历废除）；
 *   · 行 = 色点 10×10（圆角 3，取该阶段实心块色，幽灵态空心）+ 项目全名 12px +
 *     阶段名 10px mist + 百分比 10px mist（等宽数字 tabular-nums）；行是 button，hover 出 sand；
 *   · 关闭三路径：Esc / 点浮层外部（mousedown 捕获）/ 右上 ✕；打开焦点入面板，
 *     关闭后焦点还给触发它的「+N」按钮（打开前的 activeElement，用户从哪来回哪去）；
 *   · 视口 <768px 或触屏（pointer:coarse）⇒ **同一组件**换底部弹层（左右留 12px、
 *     贴底、圆角 16），不另写一套列表（规格 §5.4）。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { formatDayMonthLocalized, useLang } from '../../i18n';
import type { GridDay } from './calendarGrid';
import type { CalendarEntry } from './calendarMath';
import { EntryDot } from './EntryDot';
import { stageLabelOf } from './MonthDayCell';

/** 锚定矩形（视口坐标；调用方持触发格 DOM，scroll/resize 时同步） */
export interface PopoverAnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 浮层宽（定稿 `.ov{width:280px}`） */
const PANEL_WIDTH = 280;
/** 浮层与锚定格的横向间距 */
const PANEL_GAP = 8;
/** 视口留白（「底部不超出视口，留 8px」） */
const VIEWPORT_EDGE = 8;
/* 行清单最大高 236px 直接写在 list 的 Tailwind 静态类上（max-h-[236px]）：
   动态拼类名 Tailwind 一条 CSS 都不会生成（BUG-05 同款），故不留常量。 */

/** 窄屏判定（与 MonthlyCalendarView.useIsMobile 同一断点口径） */
const NARROW_QUERY = '(max-width: 767px)';

/** <768px 或触屏环境 ⇒ 底部弹层（规格 §5.4） */
function isSheetEnv(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return (
    window.matchMedia(NARROW_QUERY).matches || window.matchMedia('(pointer: coarse)').matches
  );
}

function useIsSheet(): boolean {
  const [sheet, setSheet] = useState(isSheetEnv);
  useEffect(() => {
    const mqls = [window.matchMedia(NARROW_QUERY), window.matchMedia('(pointer: coarse)')];
    const onChange = (): void => setSheet(isSheetEnv());
    setSheet(isSheetEnv());
    mqls.forEach((m) => m.addEventListener('change', onChange));
    return () => mqls.forEach((m) => m.removeEventListener('change', onChange));
  }, []);
  return sheet;
}

export function DayItemsPopover({
  day,
  items,
  anchorRect,
  onOpenProject,
  onClose,
}: {
  day: GridDay;
  items: CalendarEntry[];
  anchorRect: PopoverAnchorRect | null;
  onOpenProject(projectId: string): void;
  onClose(): void;
}): JSX.Element {
  // i18n 笔 3-A：订阅语言变化 + 取词（本组件此前无 i18n）。
  // i18n 笔 3-B：头部那行日期也接上了 —— 日期部分走 `src/i18n/date.ts` 的屏幕出口
  //   （**不在消息表里建日期格式串**：那会造出本仓第三份月份/日期格式，
  //    见 `src/i18n/date.ts` 文件头与接任包 §3.1 的「日期格式不要新建消息键」）。
  const { t, lang } = useLang();
  const panelRef = useRef<HTMLDivElement>(null);
  const sheet = useIsSheet();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 用 ref 持最新 onClose：父组件每次重渲染产生的新函数引用不该让下面的关闭 effect
  // 卸载重订阅（Modal 同款纪律，见 src/components/common/Modal.tsx 的 IME 注释）。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /**
   * 头部：zh `8 月 28 日 · 5 个项目` / en `Aug 28 · 5 projects`。
   *
   * ⚠️ 日期**不是** `formatSelectedDateLocalized`（那条给的是 `8月28日，星期五`：
   *    不带空格、带星期）—— 原实现的取值是 `8 月 28 日`，直接换会改 zh 渲染。
   *    故本笔在同一个日期模块里补了同类出口 `formatDayMonthLocalized`（两条取值都保住）。
   * ⚠️ 「· N 个项目」走消息表，**分隔符住在取值里**（英文用半角、中文用全角）。
   */
  const headLabel = t('calendar.dayPopover.head', {
    date: formatDayMonthLocalized(day.date, lang),
    n: items.length,
  });

  /**
   * 焦点管理（规格 §5.3），两件事分成两个 effect——
   *
   * ① 打开入面板（**Bug A 修复**，真 Chromium 实测的老 bug）：桌面档面板在 pos 算出来
   *    之前是 `visibility:hidden`（定位要等父组件同步 anchorRect，首帧 pos=null），
   *    而**对 visibility:hidden 元素调 focus() 是空操作**——老实现把 focus() 放在挂载
   *    effect 里，那一刻面板恰好 hidden，焦点从未进过面板（✕/行键盘不可达、
   *    role=dialog 焦点契约失效）。故聚焦条件挂「面板已可见」：sheet 无 visibility 门
   *    （挂载即可见）直接聚焦；panel 等 pos 有值那一刻（面板已 visible）再聚焦，
   *    pos 变化本 effect 自然重跑。
   * ② 关闭回还：卸载时把焦点还给打开前的 activeElement（「+N」按钮，从哪来回哪去）。
   *    isConnected 兜底：触发格可能已随切月重挂（旧节点 detached），此时无权抢焦点。
   */
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const trigger = restoreFocusRef.current;
      // isConnected：触发格可能已随切月重挂（旧节点 detached），此时无权抢焦点
      if (trigger && trigger.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    if (sheet || pos) panelRef.current?.focus();
  }, [sheet, pos]);

  /** 关闭两路（第三路 ✕ 走面板内按钮 onClick）：Esc + 点外部。mousedown 用**捕获**——
   *  必须早于格子根节点的 onClick（onSelect 选中态）拿到事件，否则关之前先闪一下选中 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    const onDown = (e: MouseEvent): void => {
      const panel = panelRef.current;
      if (panel && !panel.contains(e.target as Node)) {
        /*
         * Bug B 修复（真 Chromium 实测的老 bug）：先 preventDefault 再关。
         * mousedown 的浏览器默认行为会把焦点移到事件目标——目标**不可聚焦**（h2/空白）
         * 时焦点被清到 <body>，而它发生在 React 同步刷新「卸载 ⇒ 焦点回还 +N」之后，
         * 把回还结果覆盖掉（点 Esc/✕ 不受影响，那两路没有默认焦点转移）。
         * preventDefault 掐掉默认焦点转移，回还才留得住。副作用（可接受）：不 start
         * 文本选择；点外部可聚焦元素也不抢焦点——焦点按规格回「+N」，click 照常触发。
         * 这也是 overlay 类组件（dropdown/popover）的标准做法。
         */
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, []);

  /**
   * 桌面定位：默认贴格右侧展开 → 右侧不足翻左侧 → 顶缘与格对齐 → 底部不超视口。
   * 用 layout effect：先量面板尺寸再定位，`pos` 算出前面板 visibility:hidden，
   * 用户永远看不到它闪在 (0,0) 的那一帧。anchorRect 由调用方在 scroll/resize 时同步。
   */
  useLayoutEffect(() => {
    if (sheet || anchorRect === null) {
      setPos(null);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    // offsetWidth/Height 是布局盒，不吃入场动画 transform 的缩放污染
    const w = el.offsetWidth || PANEL_WIDTH;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchorRect.right + PANEL_GAP;
    if (left + w > vw - VIEWPORT_EDGE) left = anchorRect.left - w - PANEL_GAP;
    if (left < VIEWPORT_EDGE) left = Math.max(VIEWPORT_EDGE, vw - w - VIEWPORT_EDGE);
    let top = anchorRect.top;
    if (top + h > vh - VIEWPORT_EDGE) top = Math.max(VIEWPORT_EDGE, vh - h - VIEWPORT_EDGE);
    setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, [sheet, anchorRect, items.length]);

  const list = (
    <div data-day-popover-list="" className="-mx-[12px] max-h-[236px] overflow-y-auto">
      {items.map((e) => {
        return (
          <button
            key={e.project.id}
            type="button"
            onClick={() => {
              onOpenProject(e.project.id);
              onClose();
            }}
            className="flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left transition-colors hover:bg-sand"
          >
            {/* 色点 10×10 圆角 3；幽灵态空心（同色 1.5px 描边）——与格内/日程行同一枚组件 */}
            <EntryDot entry={e} className="h-[10px] w-[10px] rounded-[3px]" />
            <span className="min-w-0 flex-1 truncate pl-[2px] text-[12px] text-ink">
              {e.project.name}
            </span>
            <span className="shrink-0 text-[10px] text-mist">{stageLabelOf(e)}</span>
            <span className="w-[34px] shrink-0 text-right text-[10px] tabular-nums text-mist">
              {Math.round(e.percent)}%
            </span>
          </button>
        );
      })}
    </div>
  );

  const head = (
    <div className="flex items-center justify-between pb-[12px]">
      <span className="text-[14px] font-semibold text-ink">{headLabel}</span>
      <button
        type="button"
        /* ★ 语言无关定位钩子（批次⑥）：真机 spec 原本按 aria-label="关闭当日清单" 定位 ——
           该串走 i18n 后，一切到英文就找不到元素且会伪装成「控件不存在」。
           aria 的无障碍契约仍在（下面那行），只是不再当选择器。 */
        data-day-popover-close=""
        aria-label={t('calendar.dayPopover.closeAria')}
        onClick={onClose}
        className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full text-mist transition-colors hover:bg-sand hover:text-ink"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );

  const foot = <div className="pt-[10px] text-[10px] text-mist">{t('calendar.dayPopover.footHint')}</div>;

  return createPortal(
    sheet ? (
      /* 底部弹层（§5.4）：左右留 12px、贴底、圆角 16；列表与桌面浮层同一份 */
      <div
        ref={panelRef}
        role="dialog"
        aria-label={headLabel}
        data-day-popover="sheet"
        tabIndex={-1}
        className={cn(
          'menuFadeIn fixed inset-x-[12px] bottom-0 z-[75] flex flex-col rounded-t-[16px]',
          'border border-line bg-paper p-[12px] pb-[calc(12px+env(safe-area-inset-bottom))]',
          'shadow-overlay outline-none',
        )}
      >
        {head}
        {list}
        {foot}
      </div>
    ) : (
      /* 桌面浮动卡：贴格右展/左翻，顶缘对齐，底部不超视口 */
      <div
        ref={panelRef}
        role="dialog"
        aria-label={headLabel}
        data-day-popover="panel"
        tabIndex={-1}
        className={cn(
          'drawer-slide-in fixed z-[75] flex w-[280px] flex-col rounded-[14px]',
          'border border-line bg-paper p-[12px] shadow-overlay outline-none',
        )}
        style={{
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          // 定位算出来之前不显示，避免首帧闪在 (0,0)
          visibility: pos ? 'visible' : 'hidden',
        }}
      >
        {head}
        {list}
        {foot}
      </div>
    ),
    document.body,
  );
}
