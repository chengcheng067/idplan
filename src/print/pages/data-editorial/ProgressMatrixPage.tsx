/**
 * D 版 P1 · 阶段进度矩阵（01 文档 §5 / 02 文档 §6）。
 *
 * ── 矩阵读法（2026-10-11 P0-7 骨架重做：6 列表格 → 两段式 + 通栏大条）──
 * 参考稿 D P1 的行是**两段式**：
 *   段1  行首 `[号码 + 阶段名]`（左）＋ `[起止日期 · 占比]`（右，mono 灰）；
 *   段2  一条**通栏条**（682 × 32），起点比内容框再内缩 16px（x56..737）。
 * 行节距 **90px**（= 段1 15px + 间隙 6 + 条 32 + 下距 36）。
 * **无表格竖线、无行分隔线**（参考稿没有）；`STATUS` / `OWNER` 两列删除
 * ——状态改由**条的颜色**承载（图形编码），负责人不在 `01 §5` 的字段清单里。
 *
 * ── 条的口径（哪一根数字进条）──
 * 条长 = **阶段内任务完成度**（`taskProgress.done / total`，产品必登项，
 * 规格 §3.3）；行首右侧的百分比 = **ratioPercent（工作量占比）**。
 * 两个数字紧邻出现正是 `01 §3.1` 要防的误读点，故页脚脚注把口径写死。
 * 填充色按阶段四态（P0-10）：已完成 `#0A0A0A` / 进行中·延期 `#EF4B23` /
 * 未开始 `#737373`；轨道一律 `#E5E5E5`。
 * 填充宽度 = `max(百分比, 96px)`（P0-11：0/3/4/12 四档都要有可见底桩，
 * 参考实测四档填充全是 96px；**实现在本组件，不写进 CSS**）。
 *
 * ── 橙红纪律（01 §5：橙红仅用于重点状态）──
 * 信号色只出现在：进行中/延期阶段的条填充、页尾「项目完成度」巨字、
 * 页头英文副标。其余一律灰阶 + 近黑——灰度打印下信号色变中灰，所以
 * 每处信号色都同时带数字或字形，不靠色相单独表意。
 *
 * ── 占比口径 ──
 * ratioPercent 是工作量占比、不是完成度（01 §3.1）；脚注把这两条口径
 * 并排写出（**单行**，参考稿的脚注是单行）。
 *
 * ── 批 B（2026-10-13）后的定位 ──
 * 5 块重构把本页拆成「B2 日期格矩阵 + B4 两段式清单」两格；本组件因此退为
 * **legacy 纸面页路径**（sheets 传入时才渲染，出选择器但代码与 spec 全留）。
 * 它的行渲染 `MatrixRow` 与页尾横带 `DeBand` 已抽到共享件，**DOM 逐字不变**
 * ——本页与新形态的 B4 因此永远同形，不会各长一版。
 *
 * ── 跨页分页（2026-10-09「原生矩阵无分页」修复）──
 * 阶段行按页预算 chunk（planMatrixPages，实测估高）：续表页带「续表」
 * 模块头；页尾完成度横带**每页都有**（每页可独立解释，01 §2）。
 * 行是原子单位（行不裂）；本页无行时不渲染行区（不出孤单续表头）。
 */

import type { PrintStageVM, PrintViewModel } from '../../model/print-view-model';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { DeBand } from './chrome';
import { MatrixRow } from './StageBarList';
import { MATRIX_COMPACT_AT } from './shared';

export interface ProgressMatrixPageProps {
  vm: PrintViewModel;
  /** 本物理页的阶段行（planMatrixPages 的一个 chunk；行不裂） */
  rows: readonly PrintStageVM[];
  /** 本页是矩阵的第几 chunk（0 起；>0 ⇒ 续表页：带续表头） */
  chunkIndex: number;
  /** chunk 总数（续表标识用） */
  chunkTotal: number;
}

export function ProgressMatrixPage({ vm, rows, chunkIndex, chunkTotal }: ProgressMatrixPageProps): JSX.Element {
  const stages = vm.stages;
  // 档位判定与分页同源（同一个常量，不是两处各写一个数字）：
  // normal 容量 9 行 ⇒ 10 阶段起转紧凑档（见 shared.ts 的 MATRIX_EST 注释）
  const dense = stages.length > MATRIX_COMPACT_AT;

  return (
    <section className="de-board" data-density={dense ? 'compact' : undefined}>
      {/* 续表模块头（D 硬边语法：2px 近黑线 + 英文栏 kicker + 信号方）。
          第一页没有——参考稿 P1 的页头线之后直接是第 01 行。 */}
      {chunkIndex > 0 && (
        <div className="de-matrix__cont">
          <p className="de-matrix__cont-kicker">
            <span className="de-matrix__cont-signal" aria-hidden />
            PROGRESS MATRIX · CONT.
          </p>
          <span className="de-matrix__cont-label de-num">
            阶段进度矩阵（续）· 第 {chunkIndex + 1} / {chunkTotal} 部分
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

      {/* 页尾横带（P0-9 / 装置 · 丙）：**每页都有**（每页可独立解释，01 §2）。
          2026-10-13 批 B：改用共享件 `DeBand`（与 5 块形态同源），DOM 逐字不变。 */}
      <DeBand vm={vm} />
    </section>
  );
}
