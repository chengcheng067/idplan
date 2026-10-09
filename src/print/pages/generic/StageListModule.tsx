/**
 * 通用渲染 · M1 阶段清单（期三第一批 + 期七语法保真；
 * 产品决策文档 §3.1 M1 / UX 研究 §2.6.2）。
 *
 * ── 读法 ──
 * 行 = 阶段（orderIndex 序；VM 已过 visible 过滤）。与选择器里 M1 的一句话
 * 说明逐字对应（「Stage 四态 / 日期 / 占比 / 负责人」）。完成度与任务进度
 * 收在模块头计数行 / D 的 KPI 带（占比 ≠ 完成度的口径防误读留在口径注）。
 *
 * ── 期七：按语法 token 分发四种行形态 ──
 *   table      A（>9 回落）/ D：密集横线表；D 带 KPI 带 + 行内进度条
 *             （de-stat / de-bar 原生类直接复用——作用域正是 D 模板域）；
 *   grid       E：六列目录行 + 24px 衬线巨编号 + 按状态分章 + 发丝线；
 *   blocks     H：左右双栏，右栏「阶段健康度」摘要（大号 mono，不借巨字）；
 *   staggered  A×M1 ≤9：三列错落卡片（A 原生 P1 时刻表语法，20px 序号）。
 *
 * ── 双编码（01 §2：灰度下不靠色相） ──
 * 四态 = 字形（□◐●▲）+ 文字；延期态加重 + accent 色只是第三重编码。
 * 长阶段名单行省略 + title 可访问（02 §8：不挤邻字段）。
 *
 * ── 排版归属 ──
 * 本组件只出语义结构（data 属性 + 类名），视觉四套外表各一套
 * （generic-modules.css 的 per-template 块）——用户改 accent/ink/line
 * 时通用渲染跟着变。
 */

import type { JSX } from 'react';

import { StageStatus } from '../../../core/types/enums';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { GenericModuleHead, GenericModuleNote } from './GenericModuleFrame';
import { StageHealthPanel } from './panels';
import {
  GENERIC_NOTES,
  GENERIC_TITLES,
  STAGE_GLYPH,
  stageStatusLabel,
  type GenericItem,
  type StageListRow,
} from './shared';
import type { GenericPlan } from './shared';

export interface StageListModuleProps {
  /** 分页计划（syntax / 全量 rows / chunks 都在里面） */
  plan: Extract<GenericPlan, { module: 'stage-list' }>;
  /** 本物理页是第几 chunk（0 起；>0 ⇒ 模块头带「（续）」） */
  chunkIndex: number;
}

export function StageListModule({ plan, chunkIndex }: StageListModuleProps): JSX.Element {
  const items = plan.chunks[chunkIndex] ?? [];
  const { syntax, compact } = plan;
  const withProgress = syntax.extraEncodings.includes('progress-bar');
  const withKpi = syntax.extraEncodings.includes('kpi-band');
  // 章条目只出现在分章组合（E×M1 = grid）；table/staggered 变体只取行
  const rows = items.flatMap((i) => (i.kind === 'row' ? [i.row] : []));
  return (
    <section
      className="gm-module"
      data-module="stage-list"
      data-row-form={syntax.rowForm}
      data-number-form={syntax.numberForm}
      data-table-layout={withProgress ? 'merged' : 'split'}
      data-density={compact ? 'compact' : undefined}
    >
      <GenericModuleHead
        label={chunkIndex > 0 ? `${GENERIC_TITLES['stage-list'].cn}（续）` : GENERIC_TITLES['stage-list'].cn}
        count={plan.count}
      />
      {items.length === 0 ? (
        <EmptyPrintState kind="stages" />
      ) : (
        <>
          {withKpi && <StageKpiBand rows={plan.rows} />}
          {syntax.rowForm === 'grid' && <StageGrid items={items} />}
          {syntax.rowForm === 'blocks' && <StageBlocks rows={plan.rows} />}
          {syntax.rowForm === 'staggered' && <StageStaggered rows={rows} />}
          {syntax.rowForm === 'table' && <StageTable rows={rows} withProgress={withProgress} />}
        </>
      )}
      <GenericModuleNote>{GENERIC_NOTES['stage-list']}</GenericModuleNote>
    </section>
  );
}

/* ------------------------------------------------------------------ D：KPI 带 */

/** KPI 带三格（已完成 / 延期 / 占比）——复用原生 de-stat 视觉（硬边 + mono 大数字） */
function StageKpiBand({ rows }: { rows: readonly StageListRow[] }): JSX.Element {
  const done = rows.filter((r) => r.status === StageStatus.Completed).length;
  const delayed = rows.filter((r) => r.status === StageStatus.Delayed).length;
  const ratio = rows.reduce((n, r) => n + r.ratioPercent, 0);
  return (
    <div className="gm-kpi">
      <div className="de-stat">
        <span className="de-stat__value de-num">
          {done}/{rows.length}
        </span>
        <span className="de-stat__caption">阶段已完成</span>
      </div>
      <div className="de-stat" data-signal={delayed > 0 || undefined}>
        <span className="de-stat__value de-num">{delayed}</span>
        <span className="de-stat__caption">延期阶段</span>
      </div>
      <div className="de-stat">
        <span className="de-stat__value de-num">{ratio}%</span>
        <span className="de-stat__caption">占比合计（不等于完成度）</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ table 变体 */

function StageTable({
  rows,
  withProgress,
}: {
  rows: readonly StageListRow[];
  withProgress: boolean;
}): JSX.Element {
  return (
    <table className="gm-table">
      <thead>
        <tr>
          {withProgress ? (
            <>
              <th className="gm-col-stage">STAGE 阶段</th>
              <th className="gm-col-state">STATUS 状态</th>
              <th className="gm-col-date">DATES 计划日期</th>
              <th className="gm-col-progress">TASK PROGRESS 阶段内任务完成度</th>
              <th className="gm-col-ratio">RATIO 占比</th>
              <th className="gm-col-owner">OWNER 负责人</th>
            </>
          ) : (
            <>
              <th className="gm-col-no">序号</th>
              <th className="gm-col-name">阶段</th>
              <th className="gm-col-state">状态</th>
              <th className="gm-col-date">计划日期</th>
              <th className="gm-col-ratio">占比</th>
              <th className="gm-col-owner">负责人</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <StageTableRow key={row.key} row={row} withProgress={withProgress} />
        ))}
      </tbody>
    </table>
  );
}

function StageTableRow({ row, withProgress }: { row: StageListRow; withProgress: boolean }): JSX.Element {
  const delayed = row.status === StageStatus.Delayed;
  const { done, total } = row.taskProgress;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <tr className="gm-row" data-state={row.status} data-delayed={delayed || undefined}>
      {withProgress ? (
        <>
          {/* D 原生矩阵同款：序号并入阶段单元格（de-matrix__no + name） */}
          <td className="gm-cell-stage">
            <span className="gm-cell-no gm-num">{row.no}</span>
            <span className="gm-cell-name" title={row.name}>
              {row.name}
            </span>
          </td>
          <td>
            <StageStateCell row={row} />
          </td>
          <td className="gm-num gm-cell-date">
            {row.startAt} — {row.endAt}
          </td>
          <td className="gm-cell-progress">
            {/* 进度条：深色 = 已完成部分 / 浅灰 = 剩余（复用原生 de-bar 的双色编码，
                track 浅灰 + fill 深色/信号色）；百分比 ≥15% 嵌段内白字（新稿 D P1
                形态），更窄则落条外墨色（段内放不下，不硬塞） */}
            <span className="de-bar" role="img" aria-label={`任务完成度 ${percent}%`}>
              <span className="de-bar__track">
                <span className="de-bar__fill" data-tone={delayed ? 'signal' : 'ink'} style={{ width: `${percent}%` }}>
                  {percent >= 15 && <span className="gm-bar__num">{percent}%</span>}
                </span>
              </span>
              <span className="de-bar__num de-num">
                {done}/{total}
                {percent < 15 ? ` · ${percent}%` : ''}
              </span>
            </span>
          </td>
          <td className="gm-num gm-cell-ratio">{row.ratioPercent}%</td>
          <td className="gm-cell-owner">{row.ownerName ?? '—'}</td>
        </>
      ) : (
        <>
          <td className="gm-num gm-cell-no">{row.no}</td>
          <td className="gm-cell-name" title={row.name}>
            {row.name}
          </td>
          <td>
            <StageStateCell row={row} />
          </td>
          <td className="gm-num gm-cell-date">
            {row.startAt} — {row.endAt}
          </td>
          <td className="gm-num gm-cell-ratio">{row.ratioPercent}%</td>
          <td className="gm-cell-owner">{row.ownerName ?? '—'}</td>
        </>
      )}
    </tr>
  );
}

/** 四态单元格（字形 + 文字双编码；延期态加重 + 信号色由各版 CSS 决定） */
function StageStateCell({ row }: { row: StageListRow }): JSX.Element {
  const delayed = row.status === StageStatus.Delayed;
  return (
    <span className="gm-state" data-tone={delayed ? 'signal' : row.status}>
      <span className="gm-glyph" aria-hidden>
        {STAGE_GLYPH[row.status]}
      </span>
      {stageStatusLabel(row.status)}
    </span>
  );
}

/* ------------------------------------------------------------------ grid 变体（E） */

function StageGrid({ items }: { items: readonly GenericItem<StageListRow>[] }): JSX.Element {
  return (
    <div className="gm-grid">
      {items.map((item, i) =>
        item.kind === 'chapter' ? (
          <div
            key={`ch-${i}`}
            className="gm-chapter"
            data-focus={item.label === '延期' || undefined}
            data-continued={item.continued || undefined}
          >
            <span className="gm-chapter__label">
              <span className="gm-chapter__glyph" aria-hidden>
                {STAGE_GLYPH[chapterStatusOf(item.label)]}
              </span>
              {item.label}
            </span>
            <span className="gm-chapter__count">{item.count} 阶段</span>
          </div>
        ) : (
          <StageGridRow key={item.row.key} row={item.row} />
        ),
      )}
    </div>
  );
}

/** 章名 ⇒ 四态（glyph 取用；章名与 stageStatusLabel 一一对应） */
function chapterStatusOf(label: string): StageStatus {
  switch (label) {
    case '进行中':
      return StageStatus.InProgress;
    case '延期':
      return StageStatus.Delayed;
    case '已完成':
      return StageStatus.Completed;
    default:
      return StageStatus.NotStarted;
  }
}

function StageGridRow({ row }: { row: StageListRow }): JSX.Element {
  const delayed = row.status === StageStatus.Delayed;
  return (
    <div
      className="gm-grid__row"
      data-state={row.status}
      data-delayed={delayed || undefined}
      data-agent={row.ownerIsAgent || undefined}
      data-testid={`gm-stage-row-${row.no}`}
    >
      {/* 巨编号：独立列（真实 DOM；E 的目录身份装置） */}
      <span className="gm-grid__no" data-focus={delayed || undefined}>
        {row.no}
      </span>
      <span className="gm-grid__name" title={row.name}>
        {row.name}
      </span>
      <span className="gm-grid__state" data-focus={delayed || undefined}>
        <span className="gm-glyph" aria-hidden>
          {STAGE_GLYPH[row.status]}
        </span>
        {stageStatusLabel(row.status)}
      </span>
      <span className="gm-grid__date gm-num">
        {row.startAt} — {row.endAt}
      </span>
      <span className="gm-grid__owner" data-agent={row.ownerIsAgent || undefined}>
        {row.ownerName ?? '—'}
        {row.ownerIsAgent && <span className="gm-grid__agent-tag">Agent</span>}
      </span>
      <span className="gm-grid__ratio gm-num">{row.ratioPercent}%</span>
    </div>
  );
}

/* ------------------------------------------------------------------ blocks 变体（H） */

function StageBlocks({ rows }: { rows: readonly StageListRow[] }): JSX.Element {
  return (
    <div className="gm-blocks">
      <div className="gm-blocks__main">
        <div className="gm-blocks__rows">
          {rows.map((row) => {
            const delayed = row.status === StageStatus.Delayed;
            return (
              <div
                key={row.key}
                className="gm-block-row"
                data-state={row.status}
                data-delayed={delayed || undefined}
                data-agent={row.ownerIsAgent || undefined}
              >
                <span className="gm-num gm-block-row__no">{row.no}</span>
                <span className="gm-block-row__name" title={row.name}>
                  {row.name}
                </span>
                <span className="gm-block-row__state">
                  <span className="gm-glyph" aria-hidden>
                    {STAGE_GLYPH[row.status]}
                  </span>
                  {stageStatusLabel(row.status)}
                </span>
                <span className="gm-num gm-block-row__date">
                  {row.startAt} — {row.endAt}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {/* 右栏：阶段健康度（大号 mono 摘要；与左栏同块语言） */}
      <StageHealthPanel rows={rows} />
    </div>
  );
}

/* ------------------------------------------------------------------ staggered 变体（A×M1 ≤9） */

/** 三组阶段分期（新稿 A P1：前期 / 中期 / 后期——分组语义是并列语法的可读性来源） */
const STAGGERED_PHASES: ReadonlyArray<{ cn: string; en: string }> = [
  { cn: '前期', en: 'PREP' },
  { cn: '中期', en: 'BUILD' },
  { cn: '后期', en: 'CLOSE' },
];

function StageStaggered({ rows }: { rows: readonly StageListRow[] }): JSX.Element {
  // 按 orderIndex 顺序切三组（均分；空组不进栏）——不是轮分：组即「前期/中期/后期」
  const per = Math.ceil(rows.length / 3);
  const groups = [0, 1, 2]
    .map((gi) => rows.slice(gi * per, (gi + 1) * per))
    .filter((g) => g.length > 0);
  return (
    <div className="gm-staggered">
      {groups.map((group, gi) => (
        <div key={gi} className="gm-staggered__col" data-col={gi + 1}>
          {/* 组头：分期标签 + 2px 粗线（新稿「前期 / PREP」式；组间分隔靠它） */}
          <div className="gm-phase">
            <span className="gm-phase__label">
              {STAGGERED_PHASES[gi]!.cn}
              <span className="gm-phase__en">/ {STAGGERED_PHASES[gi]!.en}</span>
            </span>
            <span className="gm-phase__count gm-num">{group.length}</span>
          </div>
          {group.map((s) => (
            <div key={s.key} className="gm-card" data-state={s.status}>
              <div className="gm-card__top">
                <span className="gm-card__no">{s.no}</span>
                <span className="gm-card__name" title={s.name}>
                  {s.name}
                </span>
                <span className="gm-card__state">
                  <span className="gm-glyph" aria-hidden>
                    {STAGE_GLYPH[s.status]}
                  </span>
                  {stageStatusLabel(s.status)}
                </span>
              </div>
              <div className="gm-card__bottom">
                <span className="gm-num">
                  {s.startAt} — {s.endAt}
                </span>
                <span>占比 {s.ratioPercent}%</span>
                <span>
                  任务 {s.taskProgress.done}/{s.taskProgress.total}
                </span>
                <span>负责人 {s.ownerName ?? '—'}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
