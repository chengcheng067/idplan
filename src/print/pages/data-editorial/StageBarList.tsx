/**
 * D 版 · B4 阶段清单 = **两段式通栏条清单** + L3 附属件「改期记录」（2026-10-13 批 B）。
 *
 * ── 为什么行渲染要从 ProgressMatrixPage 搬出来 ──
 * 5 块重构把 D 今天那张「阶段进度矩阵」页拆成两格（决策 6：严格一一对应）：
 *   · 时间 → **B2 日期格矩阵**（DateMatrix.tsx）
 *   · 清单 → **B4 本块**（今天 `de-matrix` 那个形态**原样**）
 * 两处都要出同一行 ⇒ 行组件收此一处（`MatrixRow` **逐字搬运**，DOM 与类名
 * 一字未改，`print-a4-visual-d` 的 P0-7 骨架断言照旧）。这与 A 批把阶段卡抽成
 * `SwissStageCard` 是同一手法：搬出来只为「一处一行」，不重画。
 *
 * ── L3 附属件「改期记录」（§0.5）──
 * 位置 = B4 的末尾（同页装得下就是 B4 的一部分）；形态 = D 的 `de-table` 语法
 * （mono 日期 + 1px 灰行线）；取最近 N 条 + 行末「共 M 条」；无记录 ⇒ 整段不出；
 * 随 B4 勾选（不单独成块）。
 */

import type { PrintStageLogVM, PrintStageVM, PrintViewModel } from '../../model/print-view-model';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { deBarFillWidth, deBarFillTone, pct, stampOf } from './shared';

/** L3 改期记录最多登几条（§0.5：「取最近 N 条 + 行末「共 M 条」」，D 的一页余量按 6 定） */
export const DE_RESCHED_MAX_ROWS = 6;

/**
 * 目录行：段1 [号码 + 阶段名] / [日期 · 占比]；段2 通栏条（填充分色 = 四态）。
 * **2026-10-11 P0-7 的骨架逐字保留**（从 ProgressMatrixPage 搬来，类名/结构未改）。
 */
export function MatrixRow({ stage }: { stage: PrintStageVM }): JSX.Element {
  const { done, total } = stage.taskProgress;
  const percent = pct(done, total);
  const tone = deBarFillTone(stage.status);
  return (
    <div className="de-row" data-state={stage.status} data-testid={`de-matrix-row-${stage.orderIndex}`}>
      <div className="de-row__head">
        <span className="de-row__id">
          <span className="de-row__no de-num">{String(stage.orderIndex).padStart(2, '0')}</span>
          <span className="de-row__name" title={stage.name}>
            {stage.name}
          </span>
        </span>
        <span className="de-row__meta de-num">
          {stage.startAt} → {stage.endAt} · {stage.ratioPercent}%
        </span>
      </div>
      <span className="de-bar" role="img" aria-label={`阶段内任务完成度 ${percent}%（${done}/${total}）`}>
        <span className="de-bar__track">
          <span
            className="de-bar__fill"
            data-fill={tone}
            style={{ width: deBarFillWidth(percent) }}
          >
            <span className="de-bar__num de-num">
              {done}/{total} · {percent}%
            </span>
          </span>
        </span>
      </span>
    </div>
  );
}

/** L3「改期记录」（§0.5：D 走 `de-table` 语法 = mono 日期 + 1px 灰行线） */
export function DeReschedule({
  rows,
  total,
}: {
  rows: readonly PrintStageLogVM[];
  total: number;
}): JSX.Element {
  return (
    <div className="de-resched" data-print-resched="">
      <h3 className="de-resched__title">改期记录</h3>
      <table className="de-table de-resched__table">
        <thead>
          <tr>
            <th>阶段</th>
            <th>旧结束日</th>
            <th>新结束日</th>
            <th>原因</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>{l.stageName}</td>
              <td className="de-num">{l.oldEndAt ?? '—'}</td>
              <td className="de-num">{l.newEndAt ?? '—'}</td>
              <td>{l.reason ?? '—'}</td>
              <td className="de-num">{stampOf(l.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="de-resched__more de-num">
        共 {total} 条{rows.length < total ? `（示最近 ${rows.length} 条）` : ''}
      </p>
    </div>
  );
}

export interface StageBarListProps {
  vm: PrintViewModel;
  /** 本页承载的阶段（与 B2 同一批） */
  rows: readonly PrintStageVM[];
  /** 本页是第几块（>0 ⇒ 续表头，沿用 P0-7 的续表语法） */
  chunkIndex: number;
  chunkTotal: number;
  /** L3 改期记录（空数组 = 整段不出）；只在 B4 的最后一块出 */
  resched: readonly PrintStageLogVM[];
  reschedTotal: number;
  withResched: boolean;
  /** 档位（20 阶段起紧凑；与分页估高同源，由文档层给） */
  dense: boolean;
}

export function StageBarList({
  rows,
  chunkIndex,
  chunkTotal,
  resched,
  reschedTotal,
  withResched,
  dense,
}: StageBarListProps): JSX.Element {
  return (
    <section className="de-board" data-print-block="stageTable" data-density={dense ? 'compact' : undefined}>
      {/* 续表模块头（D 硬边语法：2px 近黑线 + 英文栏 kicker + 信号方）。
          第一页没有——参考稿 P1 的页头线之后直接是第 01 行。 */}
      {chunkIndex > 0 && (
        <div className="de-matrix__cont">
          <p className="de-matrix__cont-kicker">
            <span className="de-matrix__cont-signal" aria-hidden />
            STAGE BAR LIST · CONT.
          </p>
          <span className="de-matrix__cont-label de-num">
            阶段清单（续）· 第 {chunkIndex + 1} / {chunkTotal} 部分
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyPrintState kind="stages" />
      ) : (
        <div className="de-matrix" data-print-matrix>
          {rows.map((s) => (
            <MatrixRow key={s.id} stage={s} />
          ))}
        </div>
      )}

      {/* L3 附属件（§0.5）：挂在 B4 的最后一页末尾；无记录 ⇒ 整段不出 */}
      {withResched && resched.length > 0 && <DeReschedule rows={resched} total={reschedTotal} />}
    </section>
  );
}
