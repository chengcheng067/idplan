/**
 * 月历色点（v3「B 方案」画布定稿 2026-10-08 · 规格 §3.5/§3.6/§5）。
 *
 * ── 为什么是共享组件 ──
 * 「B 方案」把月历格内条目从色带改为「小色点 + 项目名」后，色点出现在**三处**：
 *   ① MonthDayCell 折叠态条目行（8×8 圆点，§3.5 两列栅格）
 *   ② DayItemsPopover 当日浮层清单行（10×10 圆角 3 方点，§5）
 *   ③ MonthlyCalendarView 日程视图清单行（12×12 圆角 3 方点）
 * 三处此前各写一份取色/幽灵/自定义色逻辑（日程行还漏了半套），必然漂移
 * （日程行就漂成了宽面带 e.color + 实心幽灵 + 缺 data-stage-key）。
 * 故取色与三态判定收口到本组件，尺寸 / 圆角 / 幽灵态附加类由调用方经
 * `className` 给（三处规格各不相同，且格内幽灵点的 opacity-80 是格内
 * 特有视觉，浮层/日程行没有，属调用方自由）。
 *
 * ── 三态（与 MonthDayCell 画布定稿逐字节一致）──
 *   · 实心：`backgroundColor: stageSolidOf(...)` —— 一律取「实心块」角色
 *     （内置 `var(--stage-sN)` / 自定义 `var(--stage-local-solid)`）。
 *     **不得**用 `entry.color`（那是宽面角色 `var(--stage-band-sN)`，
 *     小面积色点用宽面变体会在亮/暗格底上漂移对比度）。
 *   · 幽灵（`entry.isGhost`，未开始）：**空心**点 —— 同色 1.5px 描边、
 *     内部透明（§3.5 未开始语义）。不发实心底。
 *   · 自定义色：`customStageColor()` 的 attrs（`data-stage-key`）与实心 /
 *     空心两种 style 组合铺全 —— 只写一半 ⇒ `var()` 解析为空 ⇒ 色点透明
 *     （通路 B 的两个半件必须成对，见 timeline/stageColorKey 的注释）。
 */

import { cn } from '../../lib/cn';
import { stageSolidOf } from './calendarColors';
import { customStageColor } from '../timeline/stageColorKey';
import type { CalendarEntry } from './calendarMath';

export function EntryDot({
  entry,
  className,
}: {
  entry: CalendarEntry;
  /** 尺寸 / 圆角 / 幽灵态附加类（格内 8px 圆、浮层 10px 方、日程 12px 方） */
  className: string;
}): JSX.Element {
  // ★ 通路 B：判定 + `data-stage-key` 一次取齐（只写一半 ⇒ var() 解析为空 ⇒ 透明）
  const { attrs: colorAttrs } = customStageColor(entry.activeStage?.customColor);
  const solid = stageSolidOf(
    entry.filterStageIndex,
    entry.activeStage?.colorIndex,
    entry.activeStage?.customColor,
  );
  return (
    <span
      aria-hidden
      className={cn('shrink-0', className)}
      style={
        entry.isGhost
          ? { border: `1.5px solid ${solid}` }
          : { backgroundColor: solid }
      }
      {...colorAttrs}
    />
  );
}
