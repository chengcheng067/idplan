/**
 * 通用渲染 · M4 成员名册（期三第一批；产品决策文档 §3.1 M4）。
 *
 * ── 读法 ──
 * 行 = 成员（VM 序）。列 = 姓名 / 类型 / agentKind / 角色 / 负责任务数
 * ——与选择器里 M4 的一句话说明逐字对应（「human / agent · 角色 ·
 * 负责任务数」）。**全员口径**：无 clientName 涉权（02 §3：clientName
 * 仅 admin 进 VM，本模块不消费它）；成员范围 = 可见范围内被引用成员
 * （适配器 referencedIds 口径，通用渲染不重算）。
 *
 * ── Agent 行焦点（密度研究规则 1「焦点必须松」的轻量版） ──
 * Agent 行是全页唯一强焦点：各版给各自的焦点语法（A 反色行 / D·E·H
 * 左侧 accent 粗签 + 姓名着色），**同时带「Agent」文字签**——双编码，
 * 灰度下不靠色相。agentKind 是开放字符串：未知值原样显示，不收敛枚举
 * （01 §3.2）。
 *
 * ── 排版归属 ──
 * 语义结构在本组件，视觉四套外表各一套（generic-modules.css per-template
 * 块：字体阶 / 色板 / 密度 / 表格形态走该版 token）。
 */

import type { JSX } from 'react';

import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { GenericModuleHead, GenericModuleNote } from './GenericModuleFrame';
import { GENERIC_NOTES, GENERIC_TITLES, type MemberRosterRow } from './shared';

export interface MemberRosterModuleProps {
  /** 本物理页的行（分页产物） */
  rows: readonly MemberRosterRow[];
  /** 模块头计数行（整模块一份，跨页不变；由 plan 从全量 VM 算好传入） */
  count: string;
  /** 紧凑档（16+ 行） */
  compact: boolean;
  /** 跨页续页（模块头带「（续）」） */
  continued: boolean;
}

export function MemberRosterModule({ rows, count, compact, continued }: MemberRosterModuleProps): JSX.Element {
  return (
    <section className="gm-module" data-module="member-roster" data-density={compact ? 'compact' : undefined}>
      <GenericModuleHead
        label={continued ? `${GENERIC_TITLES['member-roster'].cn}（续）` : GENERIC_TITLES['member-roster'].cn}
        count={count}
      />
      {rows.length === 0 ? (
        <EmptyPrintState kind="members" />
      ) : (
        <table className="gm-table">
          <thead>
            <tr>
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
      )}
      <GenericModuleNote>{GENERIC_NOTES['member-roster']}</GenericModuleNote>
    </section>
  );
}
