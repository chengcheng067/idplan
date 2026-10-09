/**
 * 通用渲染 · M2 任务清单（期三第一批；产品决策文档 §3.1 M2）。
 *
 * ── 读法 ──
 * 行 = 任务（VM 序 = taskNo 序；**随阶段可见性收窄**——隐藏阶段的任务
 * 不进 VM，本组件不重算权限）。列 = 读号 / 任务 / 七态 / 负责人 / 产出物
 * 数——与选择器里 M2 的一句话说明逐字对应（「taskNo / 七态 / 负责人 /
 * 产出物数」）。逾期 = 文字「· 逾期」+ 加重双编码（不靠颜色单独表意）。
 *
 * ── 权限口径 ──
 * VM 装配顺序固定（adapters/project-print-adapter.ts）：角色 →
 * computeRelatedStageIds → visible !== false → 任务随阶段过滤。通用渲染
 * **只是渲染层**，权限语义一行不改。
 *
 * ── 排版归属 ──
 * 语义结构在本组件，视觉四套外表各一套（generic-modules.css per-template
 * 块：字体阶 / 色板 / 密度 / 表格形态走该版 token）。
 */

import type { JSX } from 'react';

import { TASK_STATUS_LABELS } from '../../../core/types/enums';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { GenericModuleHead, GenericModuleNote } from './GenericModuleFrame';
import { GENERIC_NOTES, GENERIC_TITLES, taskStatusLabel, type TaskListRow } from './shared';

export interface TaskListModuleProps {
  /** 本物理页的行（分页产物） */
  rows: readonly TaskListRow[];
  /** 模块头计数行（整模块一份，跨页不变；由 plan 从全量 VM 算好传入） */
  count: string;
  /** 紧凑档（16+ 行） */
  compact: boolean;
  /** 跨页续页（模块头带「（续）」） */
  continued: boolean;
}

export function TaskListModule({ rows, count, compact, continued }: TaskListModuleProps): JSX.Element {
  return (
    <section className="gm-module" data-module="task-list" data-density={compact ? 'compact' : undefined}>
      <GenericModuleHead
        label={continued ? `${GENERIC_TITLES['task-list'].cn}（续）` : GENERIC_TITLES['task-list'].cn}
        count={count}
      />
      {rows.length === 0 ? (
        <EmptyPrintState kind="tasks" />
      ) : (
        <table className="gm-table">
          <thead>
            <tr>
              <th className="gm-col-no">读号</th>
              <th className="gm-col-name">任务</th>
              <th className="gm-col-state">状态</th>
              <th className="gm-col-owner">负责人</th>
              <th className="gm-col-num">产出物</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="gm-row" data-overdue={r.overdue || undefined}>
                <td className="gm-num gm-cell-no">{r.no}</td>
                <td className="gm-cell-name" title={r.title}>
                  {r.title}
                </td>
                <td>
                  <span className="gm-state" data-tone={r.overdue ? 'signal' : undefined}>
                    {TASK_STATUS_LABELS[r.status]}
                    {r.overdue ? ' · 逾期' : ''}
                  </span>
                </td>
                <td className="gm-cell-owner">{r.assigneeNames.length > 0 ? r.assigneeNames.join('、') : '—'}</td>
                <td className="gm-num gm-cell-num">{r.artifactCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <GenericModuleNote>{GENERIC_NOTES['task-list']}</GenericModuleNote>
    </section>
  );
}
