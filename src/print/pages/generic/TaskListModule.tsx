/**
 * 通用渲染 · M2 任务清单（期三第一批 + 期七语法保真；
 * 产品决策文档 §3.1 M2 / UX 研究 §2.6.2）。
 *
 * ── 读法 ──
 * 行 = 任务（VM 序 = taskNo 序；**随阶段可见性收窄**——隐藏阶段的任务
 * 不进 VM，本组件不重算权限）。与选择器里 M2 的一句话说明逐字对应
 * （「taskNo / 七态 / 负责人 / 产出物数」）。逾期 = 文字「· 逾期」+ 加重
 * 双编码（不靠颜色单独表意）。
 *
 * ── 期七：按语法 token 分发三种行形态 ──
 *   table   A/D：密集横线表（A register 同构；D 加逾期行灰底）；
 *   grid    E：目录行语法 + **mono 序号降级**（§2.6.3：巨编号是目录身份
 *           装置，任务读号是密集表设备，24px 衬线会顶破行高）+ 按七态分章；
 *   blocks  H：双栏块——≤8 条左栏转**状态分组卡**（ExecutionStatusPage 卡
 *           同构，复用原生 ap-status__card 类）、右栏省略；>8 条回清单行
 *           + 右栏「任务状态分布」常驻。
 *
 * ── 权限口径 ──
 * VM 装配顺序固定（adapters/project-print-adapter.ts）：角色 →
 * computeRelatedStageIds → visible !== false → 任务随阶段过滤。通用渲染
 * **只是渲染层**，权限语义一行不改。
 */

import type { JSX } from 'react';

import { TaskStatus, TASK_STATUS_LABELS } from '../../../core/types/enums';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { GenericModuleHead, GenericModuleNote } from './GenericModuleFrame';
import { TaskDistributionPanel, TaskStatusCards } from './panels';
import {
  GENERIC_NOTES,
  GENERIC_TITLES,
  TASK_STATUS_GLYPH,
  taskStatusLabel,
  type GenericItem,
  type TaskListRow,
} from './shared';
import type { GenericPlan } from './shared';

/** H×M2 卡化阈值：≤8 条走状态分组卡（§2.6.4 左栏联动规则） */
export const TASK_CARD_MAX = 8;

export interface TaskListModuleProps {
  plan: Extract<GenericPlan, { module: 'task-list' }>;
  /** 本物理页是第几 chunk（0 起；>0 ⇒ 模块头带「（续）」） */
  chunkIndex: number;
}

export function TaskListModule({ plan, chunkIndex }: TaskListModuleProps): JSX.Element {
  const items = plan.chunks[chunkIndex] ?? [];
  const { syntax, compact } = plan;
  const rows = items.flatMap((i) => (i.kind === 'row' ? [i.row] : []));
  // H blocks 的卡化是**全模块**判定（≤8 条转卡，不是按 chunk）
  const cardMode = syntax.rowForm === 'blocks' && plan.rows.length <= TASK_CARD_MAX;
  return (
    <section
      className="gm-module"
      data-module="task-list"
      data-row-form={syntax.rowForm}
      data-number-form={syntax.numberForm}
      data-density={compact ? 'compact' : undefined}
    >
      <GenericModuleHead
        label={chunkIndex > 0 ? `${GENERIC_TITLES['task-list'].cn}（续）` : GENERIC_TITLES['task-list'].cn}
        count={plan.count}
      />
      {items.length === 0 ? (
        <EmptyPrintState kind="tasks" />
      ) : (
        <>
          {syntax.rowForm === 'grid' && <TaskGrid items={items} />}
          {syntax.rowForm === 'blocks' &&
            (cardMode ? <TaskStatusCards rows={plan.rows} /> : <TaskBlocks rows={plan.rows} />)}
          {syntax.rowForm === 'table' && <TaskTable rows={rows} />}
        </>
      )}
      <GenericModuleNote>{GENERIC_NOTES['task-list']}</GenericModuleNote>
    </section>
  );
}

/* ------------------------------------------------------------------ table 变体 */

function TaskTable({ rows }: { rows: readonly TaskListRow[] }): JSX.Element {
  return (
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
  );
}

/* ------------------------------------------------------------------ grid 变体（E） */

function TaskGrid({ items }: { items: readonly GenericItem<TaskListRow>[] }): JSX.Element {
  return (
    <div className="gm-grid">
      {items.map((item, i) =>
        item.kind === 'chapter' ? (
          <div
            key={`ch-${i}`}
            className="gm-chapter"
            data-continued={item.continued || undefined}
          >
            <span className="gm-chapter__label">
              <span className="gm-chapter__glyph" aria-hidden>
                {TASK_STATUS_GLYPH[taskStatusKeyOf(item.label)]}
              </span>
              {item.label}
            </span>
            <span className="gm-chapter__count">{item.count} 任务</span>
          </div>
        ) : (
          <TaskGridRow key={item.row.key} row={item.row} />
        ),
      )}
    </div>
  );
}

/** 章名 ⇒ 任务七态（glyph 取用；章名与 TASK_STATUS_LABELS 一一对应） */
function taskStatusKeyOf(label: string): TaskListRow['status'] {
  return (
    (Object.keys(TASK_STATUS_LABELS) as TaskListRow['status'][]).find(
      (s) => TASK_STATUS_LABELS[s] === label,
    ) ?? TaskStatus.Draft
  );
}

function TaskGridRow({ row }: { row: TaskListRow }): JSX.Element {
  return (
    <div
      className="gm-grid__row gm-grid__row--task"
      data-overdue={row.overdue || undefined}
      data-testid={`gm-task-row-${row.no}`}
    >
      {/* E×M2 降级：mono 序号列（巨编号是目录身份装置，任务读号是密集表设备） */}
      <span className="gm-grid__no gm-grid__no--mono gm-num">{row.no}</span>
      <span className="gm-grid__name" title={row.title}>
        {row.title}
      </span>
      <span className="gm-grid__state" data-focus={row.overdue || undefined}>
        <span className="gm-glyph" aria-hidden>
          {TASK_STATUS_GLYPH[row.status]}
        </span>
        {taskStatusLabel(row.status)}
        {row.overdue ? ' · 逾期' : ''}
      </span>
      <span className="gm-grid__owner">{row.assigneeNames.length > 0 ? row.assigneeNames.join('、') : '—'}</span>
      <span className="gm-grid__num gm-num">{row.artifactCount}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ blocks 变体（H） */

function TaskBlocks({ rows }: { rows: readonly TaskListRow[] }): JSX.Element {
  return (
    <div className="gm-blocks">
      <div className="gm-blocks__main">
        <div className="gm-blocks__rows">
          {rows.map((r) => (
            <div key={r.key} className="gm-block-row" data-overdue={r.overdue || undefined}>
              <span className="gm-num gm-block-row__no">{r.no}</span>
              <span className="gm-block-row__name" title={r.title}>
                {r.title}
              </span>
              <span className="gm-block-row__state">
                <span className="gm-glyph" aria-hidden>
                  {TASK_STATUS_GLYPH[r.status]}
                </span>
                {taskStatusLabel(r.status)}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* 右栏：任务状态分布（大号 mono 摘要） */}
      <TaskDistributionPanel rows={rows} />
    </div>
  );
}
