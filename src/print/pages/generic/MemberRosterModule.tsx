/**
 * 通用渲染 · M4 成员名册（期三第一批 + 期七语法保真；
 * 产品决策文档 §3.1 M4 / UX 研究 §2.6.2）。
 *
 * ── 读法 ──
 * 行 = 成员（VM 序）。与选择器里 M4 的一句话说明逐字对应（「human /
 * agent · 角色 · 负责任务数」）。**全员口径**：无 clientName 涉权（02
 * §3：clientName 仅 admin 进 VM，本模块不消费它）；成员范围 = 可见范围
 * 内被引用成员（适配器 referencedIds 口径，通用渲染不重算）。
 *
 * ── 期七：按语法 token 分发三种行形态 ──
 *   table   A/D：密集横线表（A register + Agent 反色行；D 左 3px 信号粗签）；
 *   grid    E：目录行 + 24px 衬线巨编号（成员序号是原生最重的身份）+
 *            按人类/Agent 分章 + Agent 朱红左签；
 *   blocks  H：双栏块，右栏「席位与门控」摘要（大号 mono 已用/上限，
 *            AGENT_SEAT_LIMIT 现成常量 + 人类/Agent 分栏 + Agent 简列）。
 *
 * ── Agent 行焦点（密度研究规则 1「焦点必须松」的轻量版） ──
 * Agent 行是页内焦点：各版给各自的焦点语法（A 反色行 / D·E 左侧 accent
 * 粗签 + 姓名着色 / H 姓名 accent 加重），**同时带「Agent」文字签**——
 * 双编码，灰度下不靠色相。agentKind 是开放字符串：未知值原样显示，
 * 不收敛枚举（01 §3.2）。
 */

import type { JSX } from 'react';

import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { GenericModuleHead, GenericModuleNote } from './GenericModuleFrame';
import { SeatGatePanel } from './panels';
import { GENERIC_NOTES, GENERIC_TITLES, type GenericItem, type MemberRosterRow } from './shared';
import type { GenericPlan } from './shared';

export interface MemberRosterModuleProps {
  plan: Extract<GenericPlan, { module: 'member-roster' }>;
  /** 本物理页是第几 chunk（0 起；>0 ⇒ 模块头带「（续）」） */
  chunkIndex: number;
}

export function MemberRosterModule({ plan, chunkIndex }: MemberRosterModuleProps): JSX.Element {
  const items = plan.chunks[chunkIndex] ?? [];
  const { syntax, compact } = plan;
  const rows = items.flatMap((i) => (i.kind === 'row' ? [i.row] : []));
  return (
    <section
      className="gm-module"
      data-module="member-roster"
      data-row-form={syntax.rowForm}
      data-number-form={syntax.numberForm}
      data-density={compact ? 'compact' : undefined}
    >
      <GenericModuleHead
        label={chunkIndex > 0 ? `${GENERIC_TITLES['member-roster'].cn}（续）` : GENERIC_TITLES['member-roster'].cn}
        count={plan.count}
      />
      {items.length === 0 ? (
        <EmptyPrintState kind="members" />
      ) : (
        <>
          {syntax.rowForm === 'grid' && <MemberGrid items={items} />}
          {syntax.rowForm === 'blocks' && <MemberBlocks rows={plan.rows} />}
          {syntax.rowForm === 'table' && <MemberTable rows={rows} />}
        </>
      )}
      <GenericModuleNote>{GENERIC_NOTES['member-roster']}</GenericModuleNote>
    </section>
  );
}

/* ------------------------------------------------------------------ table 变体 */

function MemberTable({ rows }: { rows: readonly MemberRosterRow[] }): JSX.Element {
  return (
    <table className="gm-table">
      <thead>
        <tr>
          <th className="gm-col-no">序号</th>
          <th className="gm-col-name">姓名</th>
          <th className="gm-col-state">类型</th>
          <th className="gm-col-kind">agentKind</th>
          <th className="gm-col-role">角色</th>
          <th className="gm-col-num">负责任务数</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="gm-row" data-agent={r.isAgent || undefined}>
            <td className="gm-num gm-cell-no">{r.no}</td>
            <td className="gm-cell-name">{r.name}</td>
            <td>
              <span className="gm-state" data-tone={r.isAgent ? 'signal' : undefined}>
                {r.isAgent ? 'Agent' : 'human'}
              </span>
            </td>
            {/* agentKind 开放字符串：未知值原样显示，不收敛枚举（01 §3.2） */}
            <td className="gm-num gm-cell-kind">{r.agentKind ?? '—'}</td>
            <td className="gm-cell-role">{r.role}</td>
            <td className="gm-num gm-cell-num">{r.taskCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ grid 变体（E） */

function MemberGrid({ items }: { items: readonly GenericItem<MemberRosterRow>[] }): JSX.Element {
  return (
    <div className="gm-grid">
      {items.map((item, i) =>
        item.kind === 'chapter' ? (
          <div key={`ch-${i}`} className="gm-chapter" data-continued={item.continued || undefined}>
            <span className="gm-chapter__label">
              <span className="gm-chapter__glyph" aria-hidden>
                {item.label === 'Agent 执行体' ? '▲' : '●'}
              </span>
              {item.label}
            </span>
            <span className="gm-chapter__count">{item.count} 成员</span>
          </div>
        ) : (
          <MemberGridRow key={item.row.key} row={item.row} />
        ),
      )}
    </div>
  );
}

function MemberGridRow({ row }: { row: MemberRosterRow }): JSX.Element {
  return (
    <div
      className="gm-grid__row gm-grid__row--member"
      data-agent={row.isAgent || undefined}
      data-testid={`gm-member-row-${row.no}`}
    >
      {/* 巨编号：成员序号（E 原生 MemberIndex 最重的身份列） */}
      <span className="gm-grid__no">{row.no}</span>
      <span className="gm-grid__name" data-agent={row.isAgent || undefined}>
        {row.name}
      </span>
      <span className="gm-grid__state" data-agent={row.isAgent || undefined}>
        {row.isAgent ? 'Agent' : 'human'}
      </span>
      <span className="gm-grid__kind gm-num">{row.agentKind ?? '—'}</span>
      <span className="gm-grid__role">{row.role}</span>
      <span className="gm-grid__num gm-num">{row.taskCount}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ blocks 变体（H） */

function MemberBlocks({ rows }: { rows: readonly MemberRosterRow[] }): JSX.Element {
  return (
    <div className="gm-blocks">
      <div className="gm-blocks__main">
        <div className="gm-blocks__rows">
          {rows.map((r) => (
            <div key={r.key} className="gm-block-row" data-agent={r.isAgent || undefined}>
              <span className="gm-num gm-block-row__no">{r.no}</span>
              <span className="gm-block-row__name">{r.name}</span>
              <span className="gm-block-row__state">{r.isAgent ? 'Agent' : 'human'}</span>
              <span className="gm-block-row__role">{r.role}</span>
              <span className="gm-num gm-block-row__num">{r.taskCount}</span>
            </div>
          ))}
        </div>
      </div>
      {/* 右栏：席位与门控（大号 mono 已用/上限） */}
      <SeatGatePanel rows={rows} />
    </div>
  );
}
