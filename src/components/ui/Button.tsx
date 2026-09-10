// 通用按钮组件 · 规格 §3.1 / 画板 08
//
// 允许的裸 hex 例外（规格 §3.1 显式指定，token 表未收录）：
//   #F5F5FF —— primary 文字（品牌靛蓝底上 4.6 对比度，见规格 §0.2 / D1）
//   #A5A7F0 —— primary disabled 文字
//   #F0A0A0 —— danger disabled 文字
// 其余一律走 Tailwind token 类（bg-pine / bg-paper / border-line …）。
//
// hover / active 的 #5457E8 / #4A4DDB / #DC2626 / #B91C1C 均为裸 hex 且不在 token 表，
// 故不硬编码；改用 brightness 微调 + transition-colors 近似（见下方 variantMap）。

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'lg' | 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant; // 默认 'primary'
  size?: ButtonSize; // 默认 'md'
  loading?: boolean;
  icon?: ReactNode; // 左侧图标
  fullWidth?: boolean;
}

// 统一骨架：高由 size 控制，圆角 16，文字 14/500，gap 8，flex 居中。
// 移动端（<768）：主/次按钮高 44、宽 100%（max-md:h-11 max-md:w-full）。
const base =
  'inline-flex items-center justify-center gap-2 rounded-lg text-[14px] font-medium ' +
  'transition-colors select-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine ' +
  'focus-visible:ring-offset-1 focus-visible:ring-offset-cream ' +
  'disabled:cursor-not-allowed max-md:h-11';

const sizeMap: Record<ButtonSize, string> = {
  lg: 'h-11 px-6',
  md: 'h-10 px-5',
  sm: 'h-9 px-5',
};

// hover/active 用 brightness 近似规格的裸 hex 微调，避免引入未收录色值。
const variantMap: Record<ButtonVariant, string> = {
  primary: cn(
    'bg-pine text-[#F5F5FF] hover:brightness-95 active:brightness-90',
    'disabled:bg-pine-soft disabled:text-[#A5A7F0]',
    'max-md:w-full',
  ),
  secondary: cn(
    'bg-paper border border-line text-ink',
    'hover:bg-pine-soft hover:border-transparent active:brightness-95',
    'disabled:bg-cream disabled:border-line disabled:text-mist',
    'max-md:w-full',
  ),
  danger: cn(
    'bg-clay text-white hover:brightness-95 active:brightness-90',
    'disabled:bg-clay-soft disabled:text-[#F0A0A0]',
  ),
  ghost: cn(
    'bg-transparent text-ink hover:bg-sunken active:bg-sunken active:brightness-95',
    'disabled:text-mist/50',
  ),
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    fullWidth = false,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      className={cn(
        base,
        sizeMap[size],
        variantMap[variant],
        fullWidth && 'w-full',
        loading && 'pointer-events-none',
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        // 14×14 CSS 转圈，使用 border-current 跟随当前文字色；文字保留不换文案。
        <span
          aria-hidden="true"
          className="h-[14px] w-[14px] shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {!loading && icon && <span className="inline-flex shrink-0 items-center">{icon}</span>}
      {children}
    </button>
  );
});
