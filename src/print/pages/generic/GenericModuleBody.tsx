/**
 * 通用模块调度（一个 module + 一个 chunk ⇒ 对应组件）。
 *
 * 四套 Document 的纸面外壳（页头/页脚/logo）由各自模板持有，主体里的
 * 通用模块都经本组件分发——「外表 × 模块分离」的渲染侧汇聚点：
 * 模块内容只实现一份（三组件），外表排版由 generic-modules.css 的
 * per-template 块承接。
 */

import type { JSX } from 'react';

import type { GenericPlan } from './shared';
import { isGenericRenderable } from './shared';
import { MemberRosterModule } from './MemberRosterModule';
import { StageListModule } from './StageListModule';
import { TaskListModule } from './TaskListModule';
// 通用模块样式（共享结构层 + 四套外表承接层；Vite 随组件 chunk 进包）
import '../../styles/generic-modules.css';

export interface GenericModuleBodyProps {
  /** 分页计划（null = 该模块无数据 ⇒ 明确空态，不用示例数据填版） */
  plan: GenericPlan | null;
  /** 本物理页是该模块的第几 chunk（0 起；>0 ⇒ 模块头带「（续）」） */
  chunkIndex: number;
}

export function GenericModuleBody({ plan, chunkIndex }: GenericModuleBodyProps): JSX.Element | null {
  if (plan === null || !isGenericRenderable(plan.module)) return null;
  const continued = chunkIndex > 0;
  switch (plan.module) {
    case 'stage-list':
      return (
        <StageListModule
          rows={plan.chunks[chunkIndex] ?? []}
          count={plan.count}
          compact={plan.compact}
          continued={continued}
        />
      );
    case 'task-list':
      return (
        <TaskListModule
          rows={plan.chunks[chunkIndex] ?? []}
          count={plan.count}
          compact={plan.compact}
          continued={continued}
        />
      );
    case 'member-roster':
      return (
        <MemberRosterModule
          rows={plan.chunks[chunkIndex] ?? []}
          count={plan.count}
          compact={plan.compact}
          continued={continued}
        />
      );
  }
}
