/**
 * E 版 P1 · 阶段目录（01 文档 §6 / 02 文档 §6）。
 *
 * ── 目录读法 ──
 * 行 = 阶段（按四态分章：进行中 → 延期 → 未开始 → 已完成；章序即「先看哪里」
 * 的阅读优先级）。每行：[巨编号 | 阶段名 | 四态 | 日期 | 占比]。
 *   · **巨编号是独立列**（grid 第一列的真实 DOM 元素，不是 ::before 伪元素）
 *——02 §6 明文：分页与可访问性稳定（伪元素生成的编号进不了打印分页的
 *    盒子测量，读屏也拿不到）；
 *   · 条目之间发丝线（--tpl-line）分组，章与章之间粗章节线（2px 近黑）。
 *
 * ── 朱红纪律（01 §6：Agent 行/Agent 来源朱红，整页不许单色红）──
 * 朱红只出现在三处：延期章的章头与章内条目、Agent 负责阶段的负责人名、
 * 占比注记里的「占比≠完成度」提醒词。其余一律近黑 + 灰——灰度下朱红变
 * 中灰，所以每个朱红元素都同时带字形（▲）或文字，不靠色相单独表意。
 *
 * ── 双语名称的口径（不造字段，01 §2）──
 * 软件里阶段只有一个 name 字段，「双语名称」落地为：页刊头中英双语
 * （阶段目录 / STAGE INDEX）+ 行内真实阶段名。**不虚构**第二阶段名。
 *
 * ── 长目录跨页 ──
 * 20+ 阶段的目录由 shared.ts 的 paginateEiEntries 贪心分页（章头不孤儿 /
 * 跨页续头 / 行不裂），本组件只负责「一个物理页内的条目序列」。
 */

import { StageStatus } from '../../../core/types/enums';
import type { PrintStageVM, PrintViewModel } from '../../model/print-view-model';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { EI_CHAPTER_ORDER, stageStatusLabel, STAGE_GLYPH, type EiEntry } from './shared';

export interface StageIndexPageProps {
  vm: PrintViewModel;
  /** 本物理页要渲染的条目（分页产物；含章头与续头） */
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
        {entries.map((entry, i) =>
          entry.kind === 'chapter' ? (
            <ChapterHead key={`ch-${i}`} entry={entry} />
          ) : (
            <StageRow
              key={entry.row!.id}
              stage={entry.row!}
              agentOwned={entry.row!.ownerId !== null && agentOwnerIds.has(entry.row!.ownerId)}
            />
          ),
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

/** 章头：粗章节线（2px 近黑）+ 章名 + 章内计数；延期章走朱红焦点 */
function ChapterHead({ entry }: { entry: EiEntry<PrintStageVM> }): JSX.Element {
  const chapter = entry.chapter!;
  const delayed = chapter.status === StageStatus.Delayed;
  return (
    <div
      className="ei-chapter"
      data-focus={delayed || undefined}
      data-testid={`ei-chapter-${chapter.status}`}
    >
      <span className="ei-chapter__label">
        <span className="ei-chapter__glyph" aria-hidden>
          {STAGE_GLYPH[chapter.status ?? StageStatus.NotStarted]}
        </span>
        {chapter.label}
      </span>
      <span className="ei-chapter__count">{chapter.count} 阶段</span>
    </div>
  );
}

/** 目录行：巨编号独立列 + 阶段名 + 四态 + 日期 + 占比 */
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
 * 阶段目录条目序列（章 + 行；供分页器消费）。
 * 章序 = EI_CHAPTER_ORDER；章内按 orderIndex。空章不进序列（无条目不出章头）。
 */
export function buildStageIndexEntries(vm: PrintViewModel): EiEntry<PrintStageVM>[] {
  const entries: EiEntry<PrintStageVM>[] = [];
  for (const status of EI_CHAPTER_ORDER) {
    const rows = vm.stages.filter((s) => s.status === status);
    if (rows.length === 0) continue;
    entries.push({
      kind: 'chapter',
      chapter: { status, label: stageStatusLabel(status), count: rows.length },
    });
    for (const row of rows) entries.push({ kind: 'row', row });
  }
  return entries;
}

/** 空态判定：无可见阶段（调用方渲染 EmptyPrintState，不出分页纸面） */
export function stageIndexIsEmpty(vm: PrintViewModel): boolean {
  return vm.stages.length === 0;
}

/** 阶段目录空态（02 §8：无可见阶段的明确文案，不造数据填版） */
export function StageIndexEmpty(): JSX.Element {
  return <EmptyPrintState kind="stages" />;
}
