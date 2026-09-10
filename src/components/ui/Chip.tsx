// 筛选 chip / 阶段 chip 组件 · 规格 §3.7 / 画板 08
//
// 高 30，横向 padding 14，圆角 9999，文字 12/500。
// 未选：paper 底 + line 描边；选中：pine-soft 底 + pine 字。
// stageIndex 存在时：选中用该阶段 lightBar 底 + lightText 字
//   （bg-stage-band-sN + text-stage-ink-sN，N = (stageIndex%9)+1，循环取模 1–9）。
// 输出 <button aria-pressed={active}>。

import { forwardRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface ChipProps {
  active?: boolean;
  /** 阶段序号（0-based）。存在时选中态改用该阶段 lightBar / lightText。 */
  stageIndex?: number;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { active = false, stageIndex, onClick, children, className },
  ref,
) {
  const isStage = stageIndex != null && active;
  const stageN = isStage ? (stageIndex % 9) + 1 : 0;
  const stageCls = isStage ? `bg-stage-band-s${stageN} text-stage-ink-s${stageN}` : '';

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-[30px] items-center justify-center rounded-full px-[14px] text-[12px] font-medium transition-colors',
        isStage
          ? stageCls
          : active
            ? 'bg-pine-soft text-pine'
            : 'bg-paper border border-line text-ink hover:bg-sunken',
        className,
      )}
    >
      {children}
    </button>
  );
});
