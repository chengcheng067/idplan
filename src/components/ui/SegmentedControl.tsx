// 分段控件（tablist 语义）· 规格 §3.7 / 画板 08（默认 md）· 画板 02（lg）
//
// md（默认，画板 08 元件库）：外壳 sunken 底 / 圆角 8 / 内 padding 4 / gap 2；
//   选中段 paper 底 / 圆角 6 / 高 24 / 文字 12-600 / shadow-soft；未选段透明底 / 12-400 mist。
// lg（画板 02「首页视图切换」）：外壳 sunken 底 / 圆角 16 / 内 padding 4 / gap 4 / 高 36；
//   选中段 paper 底 / 圆角 12 / 高 28 / 宽 84 / 文字 13-600 ink；未选段 13-400 mist。
//   画板把该控件写成 176×36（= 4 + 84 + 4 + 84 + 4 = 180，画板自身有 4px 出入）。
//   实现以**逐元素精确值**为准（gap 4 / pad 4 / 项 84×28 / 容器 r16 / 项 r12），
//   而非派生出来的容器宽度 176 —— 逐项值在机械转译稿里比推导值可信。
// 每段为 <button role="tab" aria-selected>，键盘可用；disabled 段降透明度且不可点。

import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  /** md=画板 08 通用件（默认）/ sm=紧凑 / lg=画板 02 首页视图切换 */
  size?: 'md' | 'sm' | 'lg';
  ariaLabel?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const isLg = size === 'lg';
  const textSize = size === 'sm' ? 'text-[11px]' : isLg ? 'text-[13px]' : 'text-[12px]';
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center bg-sunken',
        // md/sm：gap 2 / 圆角 8 / pad 4（画板 08）→ 容器 rounded-sm
        // lg   ：gap 4 / 圆角 16 / pad 4（画板 02）→ 容器 rounded-2xl
        //
        // ⚠️ 本仓库 tailwind.config.ts 重定义过 borderRadius 刻度：
        //    sm=8 / DEFAULT=md=12 / lg=16 / xl=16 / 2xl=16 / 3xl=24
        //    因此「圆角 12」必须写 rounded-md（=12），**不能写 rounded-xl（=16）**。
        //    容器 16 用 rounded-2xl、项 12 用 rounded-md，二者不可凭直觉互换。
        isLg ? 'gap-[4px] rounded-2xl p-[4px]' : 'gap-[2px] rounded-sm p-[4px]',
        className,
      )}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={opt.disabled}
            onClick={() => {
              if (!opt.disabled) onChange(opt.value);
            }}
            className={cn(
              'inline-flex items-center justify-center transition-colors',
              isLg
                ? // 画板 02：项 84×28、圆角 12、无内边距（宽度由 min-w 保证）
                  // rounded-md=12（本仓库刻度重映射，rounded-xl 会渲染成 16 而非 12）
                  'h-[28px] min-w-[84px] rounded-md px-0'
                : 'h-[24px] rounded-[6px] px-[12px]',
              textSize,
              selected
                ? 'bg-paper font-semibold text-ink shadow-soft'
                : 'bg-transparent font-normal text-mist hover:text-ink',
              opt.disabled && 'cursor-not-allowed opacity-40',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
