/**
 * 纸面物理页数（预览面板「预计 N 页」的唯一出处；期三）。
 *
 * ── 为什么需要它 ──
 * 期二「预计 N 页」= 启用原生页数（enabledPages.length），对 E 版长目录
 * （原生分页多页）本来就少算；期三通用模块同样跨页（planGenericModule
 * 的分页产物），页数不再等于 sheet 数。四个 Document 各自导出物理页
 * 装配函数（swissSchedulePhysical / dataEditorialPhysical /
 * editorialIndexPhysical / agentPosterPhysical），本文件只做分发——
 * 「预计页数」与「实际出纸」因此同源，不会一个说 4 个打 7。
 *
 * classic 不走本表（五块 blocks 的分页在 useSchedulePaperData，调用方
 * 直接用 d.pages.length）。
 */

import type { PrintSheet } from '../../components/print/print-templates';
import type { PrintTemplateId } from '../../components/print/print-templates';
import type { PrintViewModel } from '../model/print-view-model';
import { agentPosterPhysical } from './AgentPosterDocument';
import { dataEditorialPhysical } from './DataEditorialDocument';
import { editorialIndexPhysical } from './EditorialIndexDocument';
import { swissSchedulePhysical } from './SwissScheduleDocument';

/** 该模板在给定 VM 与勾选态下的物理纸面数（0 = 一页不出） */
export function printPhysicalPageCount(
  template: PrintTemplateId,
  vm: PrintViewModel,
  sheets: readonly PrintSheet[],
): number {
  switch (template) {
    case 'swiss-schedule':
      return swissSchedulePhysical(vm, sheets).length;
    case 'data-editorial':
      return dataEditorialPhysical(vm, sheets).length;
    case 'editorial-index':
      return editorialIndexPhysical(vm, sheets).length;
    case 'agent-poster':
      return agentPosterPhysical(vm, sheets).length;
    default:
      // classic 不走模块表（五块 blocks 另一套粒度；调用方走 d.pages.length）
      return 0;
  }
}
