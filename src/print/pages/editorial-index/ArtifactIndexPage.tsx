/**
 * E 版 P3 · 产出物清单（01 文档 §6 / 02 文档 §6）。
 *
 * ── 目录读法 ──
 * 章 = 任务（taskNo + 标题；粗章节线分组），行 = 该任务的产出物：
 * [种类签 | 产出物标题 | 来源]。来源 = 任务的 TaskSource（human / agent）——
 * Agent 产出的行走朱红（01 §6：Agent 来源朱红），同时带「AGENT」文字签，
 * 灰度下不靠色相表意。
 *
 * ── 底部保持干净纸面（01 §6 P3 明文）──
 * 本页不画黑栏、不画任何色块收口；页脚只有发丝线 + 署名 + 页码。
 * 空态走 EmptyPrintState 标准文案「当前可见任务暂无产出物」（02 §8），
 * **不用示例数据填版**（01 §8）。
 *
 * ── 无产出物字段的字段纪律 ──
 * 纸面只出现软件真实存在的：种类（TaskArtifact.kind 封闭六值）、标题、
 * 关联任务（taskNo + title）、来源。path/url/note 不打（本机路径不该
 * 上纸，备注与版式无关）。
 */

import { formatTaskNo } from '../../../core/lib/task-no';
import type { PrintTaskVM, PrintViewModel } from '../../model/print-view-model';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { ARTIFACT_KIND_LABELS, type EiEntry, taskSourceLabel } from './shared';

/** 清单行 = 一条产出物（携带关联任务与来源，行内自足） */
export interface EiArtifactRow {
  task: PrintTaskVM;
  kind: PrintTaskVM['artifacts'][number]['kind'];
  title: string;
  agentSource: boolean;
}

export interface ArtifactIndexPageProps {
  vm: PrintViewModel;
  entries: readonly EiEntry<EiArtifactRow>[];
  compact?: boolean;
}

export function ArtifactIndexPage({ entries, compact }: ArtifactIndexPageProps): JSX.Element {
  return (
    <>
      <div className="ei-index" data-density={compact ? 'compact' : undefined}>
        {entries.map((entry, i) =>
          entry.kind === 'chapter' ? (
            <ChapterHead key={`ch-${i}`} entry={entry} />
          ) : (
            <ArtifactRow key={`${entry.row!.task.id}-${i}`} row={entry.row!} />
          ),
        )}
      </div>
      {/* 口径注（压到主体底部）：来源口径 + 不打上纸的字段 */}
      <p className="ei-note">
        口径：来源 = 任务的产生方（human / Agent）；仅列软件真实存在的产出物，
        <strong>本地路径与外链不打上纸</strong>；无产出物的任务不进本清单。
      </p>
    </>
  );
}

/** 章头：任务（taskNo + 标题截断；完整标题经 title 可访问，02 §8） */
function ChapterHead({ entry }: { entry: EiEntry<EiArtifactRow> }): JSX.Element {
  const chapter = entry.chapter!;
  return (
    <div className="ei-chapter" data-testid="ei-chapter-task">
      <span className="ei-chapter__label">
        <span className="ei-chapter__no">{chapter.no}</span>
        <span className="ei-chapter__task" title={chapter.label}>
          {chapter.label}
        </span>
      </span>
      <span className="ei-chapter__count">{chapter.count} 产出物</span>
    </div>
  );
}

/** 清单行：种类签 + 标题 + 来源 */
function ArtifactRow({ row }: { row: EiArtifactRow }): JSX.Element {
  return (
    <div className="ei-row ei-row--artifact" data-agent={row.agentSource || undefined}>
      <span className="ei-row__no" data-focus={row.agentSource || undefined}>
        {ARTIFACT_KIND_LABELS[row.kind]}
      </span>
      <span className="ei-row__name" title={row.title}>
        {row.title}
      </span>
      <span className="ei-row__kind" data-agent={row.agentSource || undefined}>
        <span className="ei-row__glyph" aria-hidden>
          {row.agentSource ? '◆' : '○'}
        </span>
        {taskSourceLabel(row.task.source)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ 条目构造 */

/** 清单条目（章 = 有产出物的任务，按 taskNo 序；章内按原数组序） */
export function buildArtifactIndexEntries(vm: PrintViewModel): EiEntry<EiArtifactRow>[] {
  const entries: EiEntry<EiArtifactRow>[] = [];
  for (const task of vm.tasks) {
    if (task.artifacts.length === 0) continue;
    const agentSource = task.source === 'agent';
    entries.push({
      kind: 'chapter',
      chapter: {
        no: formatTaskNo(task.taskNo),
        label: task.title,
        count: task.artifacts.length,
      },
    });
    for (const a of task.artifacts) {
      entries.push({
        kind: 'row',
        row: { task, kind: a.kind, title: a.title, agentSource },
      });
    }
  }
  return entries;
}

/** 空态判定：可见任务全部无产出物 */
export function artifactIndexIsEmpty(vm: PrintViewModel): boolean {
  return vm.tasks.every((t) => t.artifacts.length === 0);
}

export function ArtifactIndexEmpty(): JSX.Element {
  return <EmptyPrintState kind="artifacts" />;
}
