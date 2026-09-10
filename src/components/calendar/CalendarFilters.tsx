/**
 * 月历筛选行（画板 14 第 3 行 · 规格 §3.7 筛选 chip / 阶段 chip）。
 *
 * ── 规格 §3.7 原文 ──
 *   「筛选 chip：高 30，横向 padding 14，圆角 9999，文字 12/500；
 *     未选：paper + line 描边；选中：pine-soft 底 + pine 字
 *     阶段 chip：同上，选中时用该阶段 lightBar 底 + lightText 字」
 *
 * ── 为什么阶段 chip 不用 components/ui/Chip ──
 *   ui/Chip 的阶段分支把类名拼成了模板字符串：`bg-stage-band-s${stageN}`。
 *   Tailwind 是**静态扫描**源码里出现过的完整类名字面量，拼串它看不见，
 *   产物 CSS 里 `bg-stage-band-s*` / `text-stage-ink-s*` 一条都不会生成
 *   （已核对 build-dist 的 css：命中数 0），选中态会渲染成「没有底色」。
 *   本组件改用 stageColors 的 var() 引用走内联 style——既不写裸 hex，
 *   也不依赖 Tailwind 的类名提取，亮暗主题仍随 <html data-theme> 自动切换。
 *   （ui/ 目录不归本任务改动，该问题已在交付报告中上报。）
 *
 * ── 语义 ──
 *   状态组（进行中/已完成/逾期/未开始）+ 阶段组（①~⑨）；组间 AND、组内 OR
 *   （判定在 calendarMath.filterEntries，本文件只负责渲染与回调）。
 */

import type { ReactNode } from 'react';

import { Chip } from '../ui/Chip';
import { STAGE_BAND_COLORS, STAGE_BAND_INK_COLORS } from '../timeline/stageColors';
import { cn } from '../../lib/cn';
import { CIRCLED_NUMBERS, STAGE_ORDERS } from './calendarColors';
import { CalendarFilterStatus, STATUS_LABELS, type CalendarFilters as Filters } from './calendarMath';

/**
 * chip 骨架类（规格 §3.7）：高 30 / 横向 padding 14 / 圆角 9999 / 文字 12/500。
 * 导出给空状态 E3 复用（那边只展示当前生效的筛选条件，不需要交互），
 * 避免同一套尺寸在两处各写一遍、日后改规格漏改。
 */
export const CHIP_BASE =
  'inline-flex h-[30px] items-center justify-center rounded-full px-[14px] text-[12px] font-medium';

/**
 * 阶段 chip（规格 §3.7 第 3 行）：选中用该阶段 `lightBar` 底 + `lightText` 字。
 * stageOrder = 阶段序号 1..9（与 filters.stage 的 orderIndex 同口径），
 * 故直接索引 --stage-band-sN / --stage-ink-sN，与画板 16 的 D4 裁决一致
 * （阶段③ → s3 lightBar、阶段⑦ → s7 lightBar）。
 */
export function StageChip({
  active,
  stageOrder,
  onClick,
  children,
}: {
  active: boolean;
  stageOrder: number;
  onClick(): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        CHIP_BASE,
        'transition-colors',
        active
          ? 'border border-transparent'
          : 'border border-line bg-paper text-ink hover:bg-sunken',
      )}
      style={
        active
          ? {
              backgroundColor: STAGE_BAND_COLORS[stageOrder],
              color: STAGE_BAND_INK_COLORS[stageOrder],
            }
          : undefined
      }
    >
      {children}
    </button>
  );
}

export function CalendarFilters({
  filters,
  onToggleStatus,
  onToggleStage,
  onClear,
}: {
  filters: Filters;
  onToggleStatus(status: CalendarFilterStatus): void;
  onToggleStage(orderIndex: number): void;
  onClear(): void;
}): JSX.Element {
  const hasAny = filters.status.size > 0 || filters.stage.size > 0;

  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      {/* 状态组 */}
      {(Object.keys(STATUS_LABELS) as CalendarFilterStatus[]).map((s) => (
        <Chip key={s} active={filters.status.has(s)} onClick={() => onToggleStatus(s)}>
          {STATUS_LABELS[s]}
        </Chip>
      ))}

      {/* 组间隔断（视觉分组，不参与语义） */}
      <span className="hidden h-[16px] w-px bg-line md:inline-block" aria-hidden />

      {/* 阶段组 */}
      <span className="text-[12px] text-mist">阶段</span>
      {STAGE_ORDERS.map((i) => (
        <StageChip key={i} active={filters.stage.has(i)} stageOrder={i} onClick={() => onToggleStage(i)}>
          <span className="tabular-nums">{CIRCLED_NUMBERS[i - 1]}</span>
        </StageChip>
      ))}

      {hasAny && (
        <button
          type="button"
          onClick={onClear}
          className={cn(CHIP_BASE, 'text-mist transition-colors hover:bg-sunken hover:text-ink')}
        >
          清除筛选
        </button>
      )}
    </div>
  );
}
