/**
 * H 版「海报页尾部」= 居中摘要 + 通栏橙线 + mono 口径行 + 图例 + 两行脚注。
 * （2026-10-13 批 D 从 `PosterSheetBody` 里抽出来：B2 页与 B4 页**共用同一个尾**，
 * 差别只在 `summary` 的载荷 —— B2 登「跨度总天数」、B4 登「项目完成度」。）
 *
 * ── 为什么必须抽出来 ──
 * B2 与 B4 是**两张同族双栏页**（§1.4）；如果尾部由各自的页形自带，两页就会各写
 * 一份「摘要块 + 通栏线 + 口径行 + 图例 + 脚注」，这就是本仓出过三次事故的
 * 「第二真值源」。抽成一个件后，两页的尾**逐字节同构**，读者翻页时看到的差异
 * 只剩内容（摘要载荷 + 有/无跨度条）——那正是 team-lead 要的区分方式。
 *
 * ── 勾选门（5 块形态；`blocks === undefined` ⇒ legacy，全部恒出）──
 *   · `ap-sum` / `ap-rule` —— **装置**，永在（§2.6 原则 2）；
 *   · `ap-scope`（mono 平铺口径行）/ `ap-legend`（图例）—— **B3 的承载区**，
 *     只首页出；关 B3 ⇒ 整块不出（§2.6：B3 = 乙 + 口径注锚回）；
 *   · `ap-notes` 第一行（口径句）—— **恒在**（§2.6 原则 1；B3 关掉时它锚回这里）；
 *     第二行起（`数据来源 … 同步`）—— B5 的可摘载荷。
 */

import type { JSX } from 'react';

import type { SchedulePaperBlocks } from '../../../lib/schedule-print';
import type { FieldScopeLine, PosterSummary } from './shared';

export function PosterTail({
  summary,
  scope,
  legend,
  notes,
  blocks,
  first,
  variant,
}: {
  summary: PosterSummary;
  scope: FieldScopeLine;
  legend: string;
  notes: readonly string[];
  /** undefined = legacy 路径（全部恒出，逐字保持旧行为） */
  blocks?: SchedulePaperBlocks;
  /** 本页是该文档的第一张纸（B3 的承载区只在它上面） */
  first: boolean;
  /** 页形标识（`span` / `list` / `shell`）——只用于 DOM 断言与样式钩子 */
  variant: 'span' | 'list' | 'shell';
}): JSX.Element {
  // legacy（blocks === undefined）逐字保持旧行为：尾部每页全出
  const carrier = blocks === undefined ? true : first && blocks.projectInfo;
  const footnoteSource = blocks === undefined ? true : blocks.footer;
  const noteLines = footnoteSource ? notes : notes.filter((n) => !n.startsWith('数据来源'));
  return (
    <>
      {/* 居中摘要块（在双栏容器与中轴**之外**，与参考稿同） */}
      <div className="ap-sum" data-print-sum={variant}>
        <p className="ap-sum__label">{summary.label}</p>
        <p className="ap-sum__big">{summary.big}</p>
        <p className="ap-sum__sub">{summary.sub}</p>
      </div>

      {/* 通栏 3px 橙线（分区线；纯装置，内容无关） */}
      <div className="ap-rule" aria-hidden />

      {/* B3 的承载区（只首页）：一行 mono 平铺口径行（标签末二字橙 —— 参考稿
          「白名单」二字着橙的同位替换）+ 图例行（态数按真实数据算） */}
      {carrier && (
        <p className="ap-scope" data-print-block="projectInfo">
          <span className="ap-scope__label">
            {scope.head}
            <span className="ap-scope__tail">{scope.tail}</span>
          </span>
          {scope.items.map((f) => (
            <span key={f} className="ap-scope__item">
              {f}
            </span>
          ))}
        </p>
      )}
      {carrier && <p className="ap-legend">{legend}</p>}

      {/* 脚注：口径 + 数据来源（每页可独立解释，宪法 7）。
          口径句**恒在**（§2.6 原则 1）；`数据来源` 行是 B5 的可摘载荷。 */}
      <div className="ap-notes" data-print-block="footer">
        {noteLines.map((n) => (
          <p key={n} className="ap-notes__line">
            {n}
          </p>
        ))}
      </div>
    </>
  );
}
