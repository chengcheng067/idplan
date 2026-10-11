/**
 * E 版 P1 · 阶段目录（01 文档 §6 / 02 文档 §6）。
 *
 * ── 目录读法（2026-10-11 P0-14 修订：行序回到 orderIndex）──
 * 行 = 阶段，**按 orderIndex 连续 01→09**。每行：[巨编号 | 阶段名 | 四态 |
 * 日期 | 负责人 | 占比]。
 *   · **巨编号是独立列**（grid 第一列的真实 DOM 元素，不是 ::before 伪元素）
 *——02 §6 明文：分页与可访问性稳定（伪元素生成的编号进不了打印分页的
 *    盒子测量，读屏也拿不到）；
 *   · 条目之间发丝线（--tpl-line）分组。
 *
 * ── 为什么不再按四态分章（P0-14② 的判据）──
 * 参考稿的 9 行是 `01→09` **连续编号**，巨编号是「目录身份装置」——你会
 * 对人说「看 07 号阶段」，编号一旦被状态重排，「按号定位」这个 E 最核心的
 * 功能就失效了（审计 §1.3②：「现状把 E 最核心的身份特征做没了」）。
 * `01 §6` 要求的是**四态必须登**（内容），不是「按四态分章」（形态）；
 * 故四态改为**行内二级标记**：行内字形 + 状态签（`data-state` 亦上纸），
 * 行序保持连续。规格 §3.3 的结论正是「登四态 + 行序连续」。
 *
 * ── 焦点色纪律（01 §6：Agent 行/Agent 来源落焦点色，整页不许单色）──
 * 焦点色只出现在三处：延期阶段的行内状态签与编号、Agent 负责阶段的负责人
 * 名与「Agent」签、占比注记里的「占比≠完成度」提醒词。其余一律近黑 + 灰
 * ——灰度下焦点色变中灰，所以每个焦点元素都同时带字形（▲）或文字。
 *
 * ── 双语名称的口径（不造字段，01 §2）──
 * 软件里阶段只有一个 name 字段，「双语名称」落地为：页刊头中英双语
 * （阶段目录 / STAGE INDEX）+ 行内真实阶段名。**不虚构**第二阶段名。
 *
 * ── 长目录跨页 ──
 * 20+ 阶段的目录由 shared.ts 的 paginateEiEntries 贪心分页（行不裂 / 同序
 * 跨页连续），本组件只负责「一个物理页内的条目序列」。
 */

import { StageStatus } from '../../../core/types/enums';
import type { PrintStageVM, PrintViewModel } from '../../model/print-view-model';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { stageStatusLabel, STAGE_GLYPH, type EiEntry } from './shared';

export interface StageIndexPageProps {
  vm: PrintViewModel;
  /** 本物理页要渲染的条目（分页产物；行序连续 01→09） */
  entries: readonly EiEntry<PrintStageVM>[];
  /** 紧凑档（分页估高同步变小；由调用方按条目数决定） */
  compact?: boolean;
}

export function StageIndexPage({ vm, entries, compact }: StageIndexPageProps): JSX.Element {
  const agentOwnerIds = new Set(
    vm.members.filter((m) => m.actorKind === 'agent').map((m) => m.id),
  );

  return (
    <>
      {/* 元信息行（期七深化，新稿 E P1「可见阶段 9 / 9 · 完成度 67%」口径） */}
      <p className="ei-meta">
        可见阶段 {vm.stages.length} · 完成度 {Math.round(vm.project.percent)}%
      </p>
      <div className="ei-index" data-density={compact ? 'compact' : undefined}>
        {entries.map((entry) =>
          entry.kind === 'row' ? (
            <StageRow
              key={entry.row!.id}
              stage={entry.row!}
              agentOwned={entry.row!.ownerId !== null && agentOwnerIds.has(entry.row!.ownerId)}
            />
          ) : null,
        )}
      </div>
      {/* 口径注（压到主体底部）：占比 ≠ 完成度（01 §3.1 硬要求，防误读） */}
      <p className="ei-note">
        口径：四态以 Stage.status 为准；<strong>占比 = 阶段工作量分配（ratioPercent），不等于完成度</strong>
        （完成度 = 已完成可见阶段数 ÷ 可见阶段总数）；隐藏阶段不进入本目录，也不参与统计。
      </p>
    </>
  );
}

/** 目录行：巨编号独立列 + 阶段名 + 四态（行内标记）+ 日期 + 负责人 + 占比 */
function StageRow({ stage, agentOwned }: { stage: PrintStageVM; agentOwned: boolean }): JSX.Element {
  const delayed = stage.status === StageStatus.Delayed;
  return (
    <div
      className="ei-row"
      data-state={stage.status}
      data-agent={agentOwned || undefined}
      data-testid={`ei-stage-row-${stage.orderIndex}`}
    >
      {/* 巨编号：独立列（02 §6）；朱红仅延期/Agent 负责两档，其余近黑 */}
      <span className="ei-row__no" data-focus={delayed || agentOwned || undefined}>
        {String(stage.orderIndex).padStart(2, '0')}
      </span>
      <span className="ei-row__name" title={stage.name}>
        {stage.name}
      </span>
      <span className="ei-row__state" data-focus={delayed || undefined}>
        <span className="ei-row__glyph" aria-hidden>
          {STAGE_GLYPH[stage.status]}
        </span>
        {stageStatusLabel(stage.status)}
      </span>
      <span className="ei-row__date">
        {stage.startAt} — {stage.endAt}
      </span>
      <span className="ei-row__owner" data-agent={agentOwned || undefined}>
        {stage.ownerName ?? '—'}
        {agentOwned && <span className="ei-row__agent-tag">Agent</span>}
      </span>
      <span className="ei-row__ratio">{stage.ratioPercent}%</span>
    </div>
  );
}

/* ------------------------------------------------------------------ 条目构造 */

/**
 * 阶段目录条目序列（行；供分页器消费）。
 * **行序 = orderIndex 升序**（订单号式连续 01→09，参考稿口径；P0-14②）。
 * 不出章头：四态是行内二级标记（见文件头），不重排行的分组。
 */
export function buildStageIndexEntries(vm: PrintViewModel): EiEntry<PrintStageVM>[] {
  return vm.stages.map((row) => ({ kind: 'row' as const, row }));
}

/** 空态判定：无可见阶段（调用方渲染 EmptyPrintState，不出分页纸面） */
export function stageIndexIsEmpty(vm: PrintViewModel): boolean {
  return vm.stages.length === 0;
}

/** 阶段目录空态（02 §8：无可见阶段的明确文案，不造数据填版） */
export function StageIndexEmpty(): JSX.Element {
  return <EmptyPrintState kind="stages" />;
}
