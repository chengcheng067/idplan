// 通用卡片组件 · 规格 §3.4 / 画板 08
//
// 变体：
//   raised   —— 普通卡片：圆角 24，paper 底，可选 line 描边，shadow-raised
//   sunken   —— 内嵌/浅底卡（空状态容器）：圆角 24，cream 底
//   timeline —— 时间轴卡：圆角 24，paper 底 + line 描边，padding 24，纵向 gap 16
//   pinned   —— 置顶条：圆角 24，pine-soft 底 + pine 描边，padding 24，纵向 gap 12
//   small    —— 列表卡/移动端：圆角 12，paper 底，shadow-soft
//
// 暗色收紧：最终设计稿（画板 13）要求时间轴卡暗色下圆角 16。
// 项目主题走 <html data-theme="dark">（非 Tailwind class），无法用普通 dark: 变体。
// 这里用「祖先属性任意变体」[data-theme='dark']_& 在暗色主题下把 timeline 圆角降到 16。
// 若该任意变体在当前 Tailwind 构建未生成，则 timeline 暗色下保持 24（已在报告说明）。

import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type CardVariant = 'raised' | 'sunken' | 'timeline' | 'pinned' | 'small';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantMap: Record<CardVariant, string> = {
  raised: 'rounded-3xl bg-paper border border-line shadow-raised',
  sunken: 'rounded-3xl bg-cream',
  timeline: cn(
    'rounded-3xl bg-paper border border-line p-[24px] flex flex-col gap-[16px]',
    "[data-theme='dark'] &]:rounded-2xl",
  ),
  pinned: 'rounded-3xl bg-pine-soft border border-pine p-[24px] flex flex-col gap-[12px]',
  small: 'rounded-md bg-paper shadow-soft',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'raised', className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cn(variantMap[variant], className)} {...rest}>
      {children}
    </div>
  );
});
