/**
 * H 版 · L3「改期记录」（§0.5 的公共附加件；B4 的附属层，随 B4 一起不出）。
 *
 * §0.5 给 H 定的形态：「走 `ap-block` 清单行（**块头 2px 粗上线 + mono meta 行**）」。
 * 所以本组件**不自创表格**——它就是 H 的块语法本身：
 *   · 块头 = 2px 粗上线 + 12.5px/700 的阶段名（与 `.ap-block__title` 同族）；
 *   · 块下 = 一行 mono meta（`旧结束日 → 新结束日 · 原因`）+ 右端 `时间 · 操作人`；
 *   · 块与块之间 1px 发丝线（H 的行间语法）；
 *   · 末尾一行 `共 M 条`（口径与 D/E 同源：取最近 N 条 + 总数告诉读者被截断了没）。
 *
 * ⚠️ **跨模板可识别**：四套的 L3 是同一件事（§0.5），允许各版用自己的 L2/L3 语法，
 * 但**列语义必须一致**（阶段 / 旧结束日 / 新结束日 / 原因 / 时间）。H 的 meta 行把
 * 五列压成一行，是为了不在这页引入一张 H 语法里没有的表。
 */

import type { JSX } from 'react';

import type { ApReschedRow } from './shared';

export function Reschedule({
  rows,
  total,
}: {
  rows: readonly ApReschedRow[];
  /** 该 VM 的改期记录总条数（可能 > rows.length；`共 M 条` 用） */
  total: number;
}): JSX.Element {
  return (
    <section className="ap-l3" data-print-resched="">
      <h3 className="ap-l3__title">改期记录</h3>
      <div className="ap-l3__rows">
        {rows.map((r) => (
          <div className="ap-l3__row" key={r.key}>
            <div className="ap-l3__head">
              <span className="ap-l3__stage" title={r.stageName}>
                {r.stageName}
              </span>
              <span className="ap-l3__at">{r.at}</span>
            </div>
            <p className="ap-l3__meta">
              <span className="ap-l3__span">{r.span}</span>
              {' · '}
              <span className="ap-l3__reason" title={r.reason}>
                {r.reason}
              </span>
            </p>
          </div>
        ))}
      </div>
      <p className="ap-l3__foot">{`共 ${total} 条`}</p>
    </section>
  );
}
