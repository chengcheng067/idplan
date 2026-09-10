// 通用空状态组件 · 规格 §3.5 / 画板 08
//
// 容器：宽 480（width 可覆盖），圆角 24，paper 底 + line 描边，padding 32，纵向 gap 12，内容居中。
// 组成：图标底 48×48（圆角 12，sunken 底，图标 22 text-mist）→ 标题 15/600 ink
//       → 说明 13 mist → action 插槽。
// 无 icon 时整个图标底不渲染。

import { forwardRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  width?: number;
  className?: string;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { icon, title, description, action, width = 480, className },
  ref,
) {
  return (
    <div
      ref={ref}
      style={{ width }}
      className={cn(
        'flex flex-col items-center gap-[12px] rounded-3xl border border-line bg-paper p-[32px] text-center',
        className,
      )}
    >
      {icon && (
        <div className="flex h-[48px] w-[48px] items-center justify-center rounded-md bg-sunken text-mist">
          <span className="text-[22px] leading-none">{icon}</span>
        </div>
      )}
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {description && <div className="text-[13px] text-mist">{description}</div>}
      {action && <div className="mt-[4px]">{action}</div>}
    </div>
  );
});
