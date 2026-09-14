// 筛选 chip / 阶段 chip 组件 · 规格 §3.7 / 画板 08
//
// 高 30，横向 padding 14，圆角 9999，文字 12/500。
// 未选：paper 底 + line 描边；选中：pine-soft 底 + pine 字。
// stageIndex 存在时：选中用该阶段 lightBar 底 + lightText 字
//   （bg-stage-band-sN + text-stage-ink-sN，N = stageIndex 取模折回 1–9，入参 1-based）。
// 输出 <button aria-pressed={active}>。

import { forwardRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { stageBandClass } from '../timeline/stageColors';

export interface ChipProps {
  active?: boolean;
  /** 阶段序号（**1-based**，与 `stage.orderIndex` 同口径）。存在时选中态改用该阶段 lightBar / lightText。 */
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
  // ⚠️ 必须走 stageBandClass 的静态映射表。
  // 这里曾写成 `bg-stage-band-s${n} text-stage-ink-s${n}` 模板字符串——Tailwind 是静态扫描，
  // 拼接类名一条 CSS 都不会生成，导致阶段 chip 在亮/暗两套主题下**完全不显色**（BUG-05）。
  const stageCls = isStage ? stageBandClass(stageIndex) : '';

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
