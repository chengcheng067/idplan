/**
 * H 版三页共用的「海报页主体」（人类化批次；规格 §1.2.2 / §1.2.3 / §1.2.4）。
 *
 * ── 构件一个都不删，只换载荷 ──
 * 双栏 + **局部橙中轴** → 栏头（组名 + 3px 规则线 + 一行组注）→ **实底状态标签块**
 * （块 = 标题 + 状态标签 + 一行 meta，标签左右**错落**、块下 1px 发丝线）→
 * **居中摘要块**（大号 mono，**不借巨字**——借了每页都是海报，就没有一页是海报）→
 * **通栏 3px 橙线** → **mono 平铺口径行** → **图例行** → **两行脚注**。
 *
 * ── 为什么三页共用这一个组件 ──
 * 规格 §1.2.1 给 P1/P2/P3 列的是**同一套构件**，差异只在载荷（栏数 2 或 4、
 * 组名、块的字段）。三份平行实现必然漂移（本仓已有「第二真值源」三次事故），
 * 故：**载荷全在 `shared.ts` 的 `planPosterSheets`，渲染层不做内容判断**。
 * 页别差异只剩两处，都由数据驱动：栏数（2 栏 / 4 栏 2×2）与块内容。
 *
 * ── 中轴纪律（02 §6 硬约束）──
 * 轴是 `.ap-cols` 的 `::before`（`inset-block: 0; left: 50%`），**只在双栏容器内
 * 贯穿**；禁绝对定位贯穿整页（下方说明文字在容器外，轴穿不到它）。轴高随栏内容
 * 自然收口（参考稿「轴止于 y≈600」是它那一页内容的高度，不是固定值）。
 *
 * ── 灰度与色相（宪法 4）──
 * 状态标签是**实底**（accent 的 8.6% 面积来源之一），但标签里**一定有字**
 * （状态名），并带**形状互异的字形**——灰度打印下不靠色相也读得出。
 */

import type { JSX, ReactNode } from 'react';

import type { SchedulePaperBlocks } from '../../../lib/schedule-print';
import type { PrintEmptyKind } from '../../parts/EmptyPrintState';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { PosterTail } from './PosterTail';
import type { PosterColumn, PosterSheet } from './shared';

/** 三页各自的空态口径（真值驱动；文案在 EmptyPrintState 的唯一出处里） */
const EMPTY_KIND: Record<PosterSheet['kind'], PrintEmptyKind> = {
  'stage-overview': 'stages',
  'task-register': 'tasks',
  'member-roster': 'members',
};

export function PosterSheetBody({
  sheet,
  blocks,
  first = true,
  annex = null,
}: {
  sheet: PosterSheet;
  /**
   * 五块勾选态。**undefined = legacy 路径**（尾部全部恒出，逐字保持旧行为）。
   * 传了则按 §2.6 的门控：B3 关 ⇒ 口径行 + 图例整块不出（口径句锚回脚注）；
   * B5 关 ⇒ 只摘脚注的「数据来源 … 同步」行。
   */
  blocks?: SchedulePaperBlocks;
  /** 本页是该文档的第一张纸（B3 承载区只在它上面） */
  first?: boolean;
  /** B4 的附属层（L3 改期记录；§0.5 说它挂在清单**末尾**） */
  annex?: ReactNode;
}): JSX.Element {
  // 无数据：纸面照常出（页头/巨字/页脚齐全），主体走明确空态，
  // **不许用模拟记录填版**（01 §8 / 02 §8）
  // legacy（blocks === undefined）保持旧行为：空态页**只有空态**，不出尾部；
  // 5 块形态则仍要出尾部——口径句属原则 1（恒在），B3/B5 的门也在那里。
  if (sheet.empty) {
    if (blocks === undefined) return <EmptyPrintState kind={EMPTY_KIND[sheet.kind]} />;
    return (
      <>
        <EmptyPrintState kind={EMPTY_KIND[sheet.kind]} />
        <PosterTail
          summary={sheet.summary}
          scope={sheet.scope}
          legend={sheet.legend}
          notes={sheet.notes}
          blocks={blocks}
          first={first}
          variant="list"
        />
      </>
    );
  }

  return (
    <div className="ap-poster">
      {/* 双栏容器 + 局部橙中轴（轴是本容器的伪元素，栏内容多长它就多长）。
          data-cols 供 CSS 判「只剩一栏时不出轴」——单栏页上那根轴会画在栏右侧
          的空区里，像一根走失的线。 */}
      <div className="ap-cols" data-cols={sheet.columns.length}>
        {sheet.columns.map((c) => (
          <PosterColumnView key={c.key} column={c} />
        ))}
      </div>

      {/* B4 的附属层 L3（§0.5：B4 的**末尾**，与主体同一页）——
          放在栏区之后、尾部之前：栏区是「阶段清单」本体，L3 是它的脚注小表，
          尾部（摘要/线/口径/图例/脚注）是**页级装置**、跨页位置稳定。 */}
      {annex}

      <PosterTail
        summary={sheet.summary}
        scope={sheet.scope}
        legend={sheet.legend}
        notes={sheet.notes}
        blocks={blocks}
        first={first}
        variant="list"
      />
    </div>
  );
}

/** 一个栏：栏头（组名 + 3px 规则线 + 组注）+ 块序列 */
function PosterColumnView({ column }: { column: PosterColumn }): JSX.Element {
  return (
    <section className="ap-col" data-tone={column.tone}>
      {/* 用 div 不用 <header>：global.css 的打印媒体有 `header{display:none}`
          blanket 规则，纸面内每多一个语义 <header> 就多一处需豁免的坑 */}
      <div className="ap-col__head">
        <span className="ap-col__label">
          {column.label}
          <span className="ap-col__en">{column.en}</span>
        </span>
        <span className="ap-col__count">{column.blocks.length}</span>
      </div>
      <div className="ap-col__rule" aria-hidden />
      <p className="ap-col__note">{column.note}</p>
      <div className="ap-col__rows">
        {column.blocks.map((b, i) => (
          // 「错落」是参考稿的签名特征（1001 左 / 1002 右 / 1003 左）：
          // 交替把标签推到右缘，标签就不会连成一条整齐边界、退化成表格
          <div key={b.key} className="ap-block" data-stagger={i % 2 === 0 ? 'start' : 'end'}>
            <div className="ap-block__row">
              <span className="ap-block__title">{b.title}</span>
              <span className="ap-block__tag" data-tone={b.tagTone}>
                <span className="ap-block__glyph" aria-hidden>
                  {b.glyph}
                </span>
                {b.tag}
              </span>
            </div>
            <p className="ap-block__meta" title={b.meta}>
              {b.meta}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
