/**
 * E 版 · B4 的 L3 附属件「改期记录」（2026-10-13 批 C · §0.5）。
 *
 * §0.5 的跨模板口径把形态交各版自定，但要求**四套互相认得出**（都是
 * 「标题 + 窄表 + 共 M 条」的 L3 层）。E 的形态 = **目录行 grid**（发丝线 + mono
 * 日期，**不用巨编号**——§0.5 明文：改期不是会被口头引用的稳定身份，不该占
 * 目录的巨编号位）。
 *
 * 位置/勾选/空态三条纪律同四套：
 *   · 挂在 B4 的**最后一页**末尾（不单独成页）；
 *   · 随 B4 勾选（不是第 6 块）；
 *   · 无 `StageLog(rescheduled)` ⇒ **整段不出**（不出孤单表头）。
 */

import type { PrintStageLogVM } from '../../model/print-view-model';
import { stampOf } from './shared';

/** L3 最多登几条（与 D 的 `DE_RESCHED_MAX_ROWS` 同值；两套互相认得出） */
export const EI_RESCHED_MAX_ROWS = 6;

export function EiReschedule({
  rows,
  total,
}: {
  rows: readonly PrintStageLogVM[];
  total: number;
}): JSX.Element {
  return (
    <div className="ei-l3" data-print-resched="">
      <h3 className="ei-l3__title">改期记录</h3>
      <div className="ei-l3__grid">
        <div className="ei-l3__row ei-l3__row--head">
          <span className="ei-l3__stage">阶段</span>
          <span className="ei-l3__date">旧结束日</span>
          <span className="ei-l3__date">新结束日</span>
          <span className="ei-l3__reason">原因</span>
          <span className="ei-l3__at">时间</span>
        </div>
        {rows.map((l) => (
          <div className="ei-l3__row" key={l.id}>
            <span className="ei-l3__stage">{l.stageName}</span>
            <span className="ei-l3__date de-num">{l.oldEndAt ?? '—'}</span>
            <span className="ei-l3__date de-num">{l.newEndAt ?? '—'}</span>
            <span className="ei-l3__reason">{l.reason ?? '—'}</span>
            <span className="ei-l3__at de-num">{stampOf(l.createdAt)}</span>
          </div>
        ))}
      </div>
      <p className="ei-l3__more de-num">
        共 {total} 条{rows.length < total ? `（示最近 ${rows.length} 条）` : ''}
      </p>
    </div>
  );
}
