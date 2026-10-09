/**
 * 通用渲染 · M1 阶段清单（期三第一批；产品决策文档 §3.1 M1）。
 *
 * ── 读法 ──
 * 行 = 阶段（orderIndex 序；VM 已过 visible 过滤）。列 = 序号 / 阶段 /
 * 四态 / 计划日期 / 占比 / 负责人——与选择器里 M1 的一句话说明逐字对应
 * （「Stage 四态 / 日期 / 占比 / 负责人」）。完成度与任务进度不进表格，
 * 收在模块头计数行（占比 ≠ 完成度的口径防误读留在口径注）。
 *
 * ── 双编码（01 §2：灰度下不靠色相） ──
 * 四态 = 字形（□◐●▲）+ 文字；延期态加重 + accent 色只是第三重编码。
 * 长阶段名单行省略 + title 可访问（02 §8：不挤邻字段）。
 *
 * ── 排版归属 ──
 * 本组件只出语义结构（table + data 属性），视觉四套外表各一套
 * （generic-modules.css 的 per-template 块）：字体阶 / 色板 / 密度 /
 * 表格形态全部走该版 token——用户改 accent/ink/line 时本模块跟着变。
 */

import type { JSX } from 'react';

import { StageStatus } from '../../../core/types/enums';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { GenericModuleHead, GenericModuleNote } from './GenericModuleFrame';
import {
  GENERIC_NOTES,
  GENERIC_TITLES,
  STAGE_GLYPH,
  stageStatusLabel,
  type StageListRow,
} from './shared';

export interface StageListModuleProps {
  /** 本物理页的行（分页产物） */
  rows: readonly StageListRow[];
  /** 模块头计数行（整模块一份，跨页不变；由 plan 从全量 VM 算好传入） */
  count: string;
  /** 紧凑档（16+ 行；分页估高同步变小） */
  compact: boolean;
  /** 跨页续页（模块头带「（续）」） */
  continued: boolean;
}

export function StageListModule({ rows, count, compact, continued }: StageListModuleProps): JSX.Element {
  return (
    <section className="gm-module" data-module="stage-list" data-density={compact ? 'compact' : undefined}>
      <GenericModuleHead
        label={continued ? `${GENERIC_TITLES['stage-list'].cn}（续）` : GENERIC_TITLES['stage-list'].cn}
        count={count}
      />
      {rows.length === 0 ? (
        <EmptyPrintState kind="stages" />
      ) : (
        <table className="gm-table">
          <thead>
            <tr>
              <th className="gm-col-no">序号</th>
              <th className="gm-col-name">阶段</th>
              <th className="gm-col-state">状态</th>
              <th className="gm-col-date">计划日期</th>
              <th className="gm-col-num">占比</th>
              <th className="gm-col-owner">负责人</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delayed = r.status === StageStatus.Delayed;
              return (
                <tr key={r.key} className="gm-row" data-state={r.status} data-delayed={delayed || undefined}>
                  <td className="gm-num gm-cell-no">{r.no}</td>
                  <td className="gm-cell-name" title={r.name}>
                    {r.name}
                  </td>
                  <td>
                    <span className="gm-state" data-tone={delayed ? 'signal' : r.status}>
                      <span className="gm-glyph" aria-hidden>
                        {STAGE_GLYPH[r.status]}
                      </span>
                      {stageStatusLabel(r.status)}
                    </span>
                  </td>
                  <td className="gm-num gm-cell-date">
                    {r.startAt} — {r.endAt}
                  </td>
                  <td className="gm-num gm-cell-num">{r.ratioPercent}%</td>
                  <td className="gm-cell-owner">{r.ownerName ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <GenericModuleNote>{GENERIC_NOTES['stage-list']}</GenericModuleNote>
    </section>
  );
}
