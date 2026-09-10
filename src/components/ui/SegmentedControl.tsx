// 分段控件（tablist 语义）· 规格 §3.7 / 画板 08
//
// 外壳：sunken 底，圆角 8，内 padding 4，横向 gap 2，role="tablist"。
// 选中段：paper 底，圆角 6，高 24，文字 12/600，shadow-soft。
// 未选段：透明底，文字 12/400 mist。
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
  size?: 'md' | 'sm';
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
  const textSize = size === 'sm' ? 'text-[11px]' : 'text-[12px]';
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-[2px] rounded-sm bg-sunken p-[4px]',
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
              'h-[24px] rounded-[6px] px-[12px] transition-colors',
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
