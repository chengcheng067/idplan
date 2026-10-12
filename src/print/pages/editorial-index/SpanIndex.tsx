/**
 * E 版 · B2 打印时间轴 = **编年跨度目录**（2026-10-13 批 C）。
 *
 * 依据 §1.3：先一条**时间标尺**（1px 发丝线 + 月份 tabular 小字），其下每阶段一行，
 * **沿用 E 的目录 grid 行语法**（六列栅格 + 发丝线）：左 = 编号列（降为小号 mono，
 * 把位置让给条）、中 = 阶段名、中段 = **行内跨度条**、右 = 两端日期 tabular；
 * 行间 1px 发丝线。**条上不写数字**。
 *
 * ── ★ 本块最大的误读风险：跨度条被读成完成度（批 C 任务书的验收核心）──
 * E 的目录行里**本来就有一个百分比（占比）**，右段再加一条 → 读者极易把条读成
 * 「完成到哪了」。三重防线：
 *   ① **位置/形态/色彩角色不同**：条走「1px 发丝线基线 + 4px 赭红实心段」的行内
 *      刻度语法（E 的目录行里**从不出现条**，它只出现在这里），占比是**数字**；
 *   ② **纸面口径**：本块 caption 写明「条 = 日期跨度，非完成度」（B3 的口径行同句）；
 *   ③ **决定性机器断言**（spec）：夹具让「跨度比例」与「占比」**故意不相等**，
 *      断言条长跟跨度、不跟占比（两边都测）。
 *
 * ── 窗口来源 ──
 * 与 A/D **同一套派生**（批 B 裁决：两把尺子必须同口径）：直接用
 * `buildPrintGantt`（`print-gantt.ts`）的 `rows[].left/width` 与 `ticks`。
 * 本组件不自己算几何——它是 E 对同一份模型的**另一种画法**（条 → 行内刻度）。
 *
 * ── 实测几何（2026-10-13 批 C · 真 Chromium 794×1123）──
 *
 *   | 件                | 实测（9 阶段首页） |
 *   |-------------------|-------------------|
 *   | caption           | 14.25px           |
 *   | 时间标尺（`.ei-span__ruler`） | 19px |
 *   | 阶段行（`.ei-span__row`）    | 30px（= 本文件的 `EI_SPAN_ROW_H`） |
 *   | B2 整块（4 行 + caption + 标尺） | 159.25px |
 *   | 标尺刻度                   | 每页 3 枚（窗口 60 天 ⇒ 3 个月）；6 页 = 18 枚，**一枚不抽稀** |
 *   | 条长对账                   | 像素宽 = `data-span-width%` × 轨宽，40 阶段逐条误差 ≤1.5px |
 *
 * 刻度与条**同一栅格**（栏宽处处相等，实测由 spec 锁 `new Set(trackWidths).size === 1`）
 * —— 标尺与条不对齐是这类图最容易被糊过去、也最容易被读者一眼看穿的事。
 */

import type { PrintStageVM, PrintViewModel } from '../../model/print-view-model';
import type { PrintGanttModel } from '../../model/print-gantt';

/** B2 的行高（px）：E 的目录行语法但编号降为小号 mono ⇒ 比 B4 的巨编号行矮得多 */
export const EI_SPAN_ROW_H = 30;

/** 条 = 日期跨度（非完成度）的口径句（caption 与 B3 口径行共用，两处同源） */
export const EI_SPAN_NOTE = '条 = 日期跨度，非完成度';

export interface SpanIndexProps {
  vm: PrintViewModel;
  /** 本页承载的阶段（与 B4 同一批切片） */
  rows: readonly PrintStageVM[];
  /** 甘特模型（文档层算一次传给本块与其它块；同一份尺子） */
  model: PrintGanttModel;
}

export function SpanIndex({ vm, rows, model }: SpanIndexProps): JSX.Element {
  // 只画本页切片：模型的 rows 与 vm.stages 同序（buildPrintGantt 按传入顺序出）
  const index = new Map(vm.stages.map((s, i) => [s.id, i]));
  const slice = rows.map((s) => model.rows[index.get(s.id) ?? -1]).filter((r) => r !== undefined);
  return (
    <section className="ei-span" data-print-span-index="">
      {/* caption：口径句与「条」同排（读者第一眼就能读到它，不必翻到页脚） */}
      <p className="ei-span__caption de-num">
        编年跨度 {vm.stages.length} 阶段 · {EI_SPAN_NOTE}
      </p>
      {/* 时间标尺：1px 发丝线 + 月份 tabular 小字；与条同一坐标系（0→100%） */}
      <div className="ei-span__ruler">
        <span className="ei-span__no" aria-hidden />
        <span className="ei-span__name" aria-hidden />
        <span className="ei-span__track">
          {model.ticks.map((t) => (
            <span
              key={t.label}
              className="ei-span__tick de-num"
              data-print-month-tick=""
              data-tick-left={t.leftPercent.toFixed(2)}
              style={{ left: `${t.leftPercent}%` }}
            >
              {t.label}
            </span>
          ))}
        </span>
        <span className="ei-span__dates" aria-hidden />
      </div>
      <div className="ei-span__rows">
        {slice.map((r) => (
          <div
            key={r.key}
            className="ei-span__row"
            data-state={r.status}
            data-testid={`ei-span-row-${r.orderIndex}`}
          >
            <span className="ei-span__no de-num">{String(r.orderIndex).padStart(2, '0')}</span>
            <span className="ei-span__name" title={r.name}>
              {r.name}
            </span>
            {/* 行内跨度条：基线上叠赭红实心段；**条上不写数字**（数据在右端日期里） */}
            <span className="ei-span__track">
              <span
                className="ei-span__bar"
                data-span-left={r.left.toFixed(4)}
                data-span-width={r.width.toFixed(4)}
                /* 状态只做第二重编码（灰度可辨）：延期用赭红实心 + 上缘加粗，
                   其余一律近黑实心——但**条的语义始终是跨度**，与状态无关 */
                data-span-state={r.status}
                style={{ left: `${r.left}%`, width: `${r.width}%` }}
                title={`${r.orderIndex}. ${r.name}（${r.startAt} — ${r.endAt}）`}
              />
            </span>
            <span className="ei-span__dates de-num">
              {r.startAt} — {r.endAt}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
