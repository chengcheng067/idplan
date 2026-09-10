// 通用标签 / 角标组件 · 规格 §3.2 / 画板 08
//
// 允许的裸 hex 例外（规格 §3.2 显式指定，token 表未收录）：
//   #92400E —— due（临期）字色
//   #0F766E —— done（完成）字色
// 其余一律走 Tailwind token 类。
//
// 阶段色签（stageIndex 存在时）：底色取该阶段 lightBar（bg-stage-band-sN），
// 字色取 lightText（text-stage-ink-sN）。绝不使用「实色色带 + 白字」（作废方案，对比度不达标）。

import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type TagTone = 'doing' | 'due' | 'overdue' | 'done' | 'neutral' | 'pine';

export interface TagProps {
  tone?: TagTone;
  /** 阶段序号（0-based）。存在时覆盖 tone，底色/字色取该阶段 lightBar / lightText，循环取模 1–9。 */
  stageIndex?: number;
  children: ReactNode;
  className?: string;
}

// tone 映射：色底 + 深色字（规格 §3.2 表格）
const toneMap: Record<TagTone, string> = {
  doing: 'bg-pine-soft text-pine',
  due: 'bg-amber-soft text-[#92400E]', // 规格 §3.2 指定值，token 表未收录
  overdue: 'bg-clay-soft text-clay',
  done: 'bg-moss-soft text-[#0F766E]', // 规格 §3.2 指定值，token 表未收录
  neutral: 'bg-sunken text-mist',
  pine: 'bg-pine-soft text-pine',
};

export function Tag({ tone = 'neutral', stageIndex, children, className }: TagProps) {
  const isStage = stageIndex != null;
  // N = (stageIndex % 9) + 1，范围 1–9 循环取模
  const stageN = isStage ? (stageIndex % 9) + 1 : 0;
  const stageCls = isStage
    ? `bg-stage-band-s${stageN} text-stage-ink-s${stageN}`
    : '';

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-sm px-2 font-medium text-[11px]',
        isStage ? 'h-[22px]' : 'h-[20px]',
        isStage ? stageCls : toneMap[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
