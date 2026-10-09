/**
 * 通用渲染 · H blocks 变体的右栏面板与状态卡（期七；UX 研究 §2.6.4 字段级规格）。
 *
 * ── blocks 变体（H×M1/M2/M4 共用结构） ──
 * 模块 = 左右双栏：左栏明细（块头 2px 粗上线 + mono 编号行 + 发丝线），
 * 右栏 240px 摘要块（2px 顶线 + **大号 mono 数字** + 字段行）。右栏数字用
 * ap-font-mono 大号，**不借衬线巨字**——巨字（ap-giant）是页锚点装置，
 * 模块是页内组件，不能抢页锚点（§2.6.4）。
 *
 * ── 三块右栏的共同纪律 ──
 * 只做「摘要」不做「第二张清单」：任何列表 ≤6 行，超了进「+N」；不与左栏
 * 重复同一字段（左栏是明细，右栏是结论）。
 *
 * ── H×M2 ≤8 条卡化 ──
 * 左栏从清单行转为**状态分组卡**（ExecutionStatusPage 卡同构：glyph + 状态名
 * + key + 计数），右栏省略；>8 条回清单行 + 右栏常驻。卡直接复用原生
 * `.ap-status__cards` / `.ap-status__card` 类名——它们的作用域
 * （.print-root.print-template-agent-poster）正是 H 通用模块的渲染域，
 * 同构不只是样子，是同一套规则。
 */

import type { JSX, ReactNode } from 'react';

import { AGENT_SEAT_LIMIT } from '../../../constants/agentTerms';
import { StageStatus, TaskStatus } from '../../../core/types/enums';
import {
  STAGE_GLYPH,
  TASK_STATUS_GLYPH,
  stageStatusLabel,
  taskStatusLabel,
  type MemberRosterRow,
  type StageListRow,
  type TaskListRow,
} from './shared';

/** 右栏列表的行数上限（§2.6.4 纪律：≤6 行，超了进「+N」） */
const PANEL_LIST_MAX = 6;
/** Agent 简列的上限（§2.6.4：最多 5 行 + 「+N」） */
const AGENT_LIST_MAX = 5;

/* ------------------------------------------------------------------ 右栏公共骨架 */

function PanelFrame({
  title,
  big,
  caption,
  children,
}: {
  title: string;
  big: string;
  caption: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <aside className="gm-panel">
      <p className="gm-panel__title">{title}</p>
      <p className="gm-panel__big gm-num">{big}</p>
      <p className="gm-panel__caption">{caption}</p>
      {children}
    </aside>
  );
}

/** 「+N」行（右栏列表超限的收敛尾） */
function MoreRow({ count }: { count: number }): JSX.Element {
  return <p className="gm-panel__more gm-num">+{count}</p>;
}

/* ------------------------------------------------------------------ H×M1 阶段健康度 */

export function StageHealthPanel({ rows }: { rows: readonly StageListRow[] }): JSX.Element {
  const done = rows.filter((r) => r.status === StageStatus.Completed).length;
  const listed = rows.slice(0, PANEL_LIST_MAX);
  const rest = rows.length - listed.length;
  return (
    <PanelFrame title="阶段健康度" big={`${String(done).padStart(2, '0')}/${String(rows.length).padStart(2, '0')}`} caption="阶段已完成">
      <ul className="gm-panel__list">
        {listed.map((r) => {
          const delayed = r.status === StageStatus.Delayed;
          return (
            <li
              key={r.key}
              className="gm-panel__item"
              data-delayed={delayed || undefined}
              title={r.name}
            >
              <span className="gm-num">{r.no}</span>
              <span className="gm-panel__item-name">{r.name}</span>
              <span className="gm-panel__item-state">
                {delayed && (
                  <span className="gm-glyph" aria-hidden>
                    {STAGE_GLYPH[StageStatus.Delayed]}
                  </span>
                )}
                {stageStatusLabel(r.status)}
              </span>
              <span className="gm-num gm-panel__item-num">{r.ratioPercent}%</span>
            </li>
          );
        })}
      </ul>
      {rest > 0 && <MoreRow count={rest} />}
    </PanelFrame>
  );
}

/* ------------------------------------------------------------------ H×M2 任务状态分布 */

export function TaskDistributionPanel({ rows }: { rows: readonly TaskListRow[] }): JSX.Element {
  const done = rows.filter((r) => r.status === TaskStatus.Done).length;
  const byStatus = new Map<TaskStatus, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const dist = [...byStatus.entries()].sort((a, b) => b[1] - a[1]);
  const listed = dist.slice(0, PANEL_LIST_MAX);
  const rest = dist.length - listed.length;
  const overdueDates = rows
    .filter((r) => r.overdue && r.dueDate !== null)
    .map((r) => r.dueDate!)
    .sort();
  const earliest = overdueDates[0] ?? null;
  return (
    <PanelFrame
      title="任务状态分布"
      big={`${String(done).padStart(2, '0')}/${String(rows.length).padStart(2, '0')}`}
      caption="任务已完成"
    >
      <ul className="gm-panel__list">
        {listed.map(([status, count]) => (
          <li key={status} className="gm-panel__item">
            <span className="gm-glyph" aria-hidden>
              {TASK_STATUS_GLYPH[status]}
            </span>
            <span className="gm-panel__item-name">{taskStatusLabel(status)}</span>
            <span className="gm-num gm-panel__item-num">{count}</span>
          </li>
        ))}
      </ul>
      {rest > 0 && <MoreRow count={rest} />}
      {rows.some((r) => r.overdue) && (
        <p className="gm-panel__flag">
          <span className="gm-glyph" aria-hidden>
            ▲
          </span>
          逾期 {rows.filter((r) => r.overdue).length} 条
          {earliest !== null && <span className="gm-num"> · 最早 {earliest}</span>}
        </p>
      )}
    </PanelFrame>
  );
}

/* ------------------------------------------------------------------ H×M4 席位与门控 */

export function SeatGatePanel({ rows }: { rows: readonly MemberRosterRow[] }): JSX.Element {
  const agents = rows.filter((r) => r.isAgent);
  const humans = rows.length - agents.length;
  const listed = agents.slice(0, AGENT_LIST_MAX);
  const rest = agents.length - listed.length;
  const full = agents.length >= AGENT_SEAT_LIMIT;
  return (
    <PanelFrame
      title="席位与门控"
      big={`${String(agents.length).padStart(2, '0')}/${String(AGENT_SEAT_LIMIT).padStart(2, '0')}`}
      caption="Agent 席位已用"
    >
      <ul className="gm-panel__list">
        <li className="gm-panel__item">
          <span className="gm-panel__item-name">人类成员</span>
          <span className="gm-num gm-panel__item-num">{humans}</span>
        </li>
        <li className="gm-panel__item">
          <span className="gm-panel__item-name">Agent 执行体</span>
          <span className="gm-num gm-panel__item-num">{agents.length}</span>
        </li>
      </ul>
      {listed.length > 0 && (
        <ul className="gm-panel__list">
          {listed.map((r) => (
            <li key={r.key} className="gm-panel__item" title={`${r.name} · ${r.agentKind ?? '—'}`}>
              <span className="gm-num">{r.no}</span>
              <span className="gm-panel__item-name">{r.name}</span>
              <span className="gm-panel__item-kind gm-num">{r.agentKind ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && <MoreRow count={rest} />}
      <p className="gm-panel__gate" data-full={full || undefined}>
        {full ? `席位已满 ${agents.length}/${AGENT_SEAT_LIMIT} · 新增 Agent 需管理员审批` : `剩余 ${AGENT_SEAT_LIMIT - agents.length} 席`}
      </p>
    </PanelFrame>
  );
}

/* ------------------------------------------------------------------ H×M2 ≤8 双栏状态分组卡 */

/** 两栏分组（新稿 H P1：PENDING / RUNNING 双栏 + 橙粗线 + 状态标签底色） */
const TASK_CARD_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  en: string;
  statuses: readonly TaskStatus[];
}> = [
  {
    key: 'inflight',
    label: '进行中',
    en: 'IN FLIGHT',
    statuses: [TaskStatus.InProgress, TaskStatus.Blocked, TaskStatus.Review, TaskStatus.Claimed],
  },
  {
    key: 'queued',
    label: '待命与终局',
    en: 'QUEUED & CLOSED',
    statuses: [TaskStatus.Ready, TaskStatus.Draft, TaskStatus.Done],
  },
];

/**
 * 双栏状态分组卡（≤8 条时左栏的形态）。向新稿 H P1 靠：两栏 + 栏间 2px 橙粗线
 * （中轴是 .gm-task-cols 的 ::before，只贯穿栏区——同原生 ap-status__cols 纪律），
 * 每条任务 = 任务名 + 状态标签（**门控态橙底白字 / 其他墨底白字**，标签即双编码）。
 */
export function TaskStatusCards({ rows }: { rows: readonly TaskListRow[] }): JSX.Element {
  const groups = TASK_CARD_GROUPS.map((g) => ({
    ...g,
    items: rows.filter((r) => g.statuses.includes(r.status)),
  })).filter((g) => g.items.length > 0);
  return (
    <div className="gm-task-cols">
      {groups.map((g) => (
        <section key={g.key} className="gm-task-col" data-group={g.key}>
          <header className="gm-task-col__head">
            <span className="gm-task-col__label">
              {g.label}
              <span className="gm-task-col__en">/ {g.en}</span>
            </span>
            <span className="gm-task-col__count gm-num">{g.items.length}</span>
          </header>
          <div className="gm-task-col__rows">
            {g.items.map((r) => {
              // 门控态（受阻 / 待审）走橙底白字标签，其余墨底白字——与 H 的治理焦点同语法
              const gate = r.status === TaskStatus.Blocked || r.status === TaskStatus.Review;
              return (
                <div key={r.key} className="gm-task-col__row">
                  <span className="gm-task-col__name" title={r.title}>
                    {r.title}
                  </span>
                  <span className="gm-task-tag" data-tone={gate ? 'gate' : 'sys'}>
                    {taskStatusLabel(r.status)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
