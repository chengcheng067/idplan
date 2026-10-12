/**
 * D 版 · B2 打印时间轴 = 日期格矩阵（2026-10-13 批 B）。
 *
 * 结构（§1.2 B2 逐条）：
 *   caption（时间列 · 粒度 · 真实区间 —— 同时解决「W01 是哪一周」的歧义）
 *   → **2px 近黑硬边线**（D 的表格骨架只有横线）
 *   → 列头行（英文小字帽 + letter-spacing .08em，mono）
 *   → 每阶段一行：左 `NN` mono + 阶段名 ／ 中 = 格阵 ／ 右 `占比 NN%` mono 灰
 *
 * 格阵纪律（§1.2 + 审美 §2-D）：**零圆角、无竖线**——列与列之间是 1px 间隙，
 * 不是画出来的线；格子在轨即填充（近黑 / 延期橙 / 未开始灰，见 matrix.ts 的口径）。
 *
 * ── 它为什么不吃 `PrintGantt` ──
 * 四套共用的是**数据派生**（`print-gantt.ts` 的窗口/刻度），不是**渲染件**：
 * A/H 用条、D 用格、E 用行内跨度——§1.2 的 1.3/1.4 格各自写明「不新增语法件」
 * 或「用本版语法件」。本组件只消费 `matrix.ts` 的列序列（与 A 的甘特同一个窗口
 * 口径 `deMatrixWindow` ↔ `buildPrintGantt` 的 union 窗口逐值同源）。
 */

import type { PrintStageVM, PrintViewModel } from '../../model/print-view-model';
import {
  DE_COLUMN_UNIT_LABEL,
  deMatrixCellOn,
  deMatrixCellTone,
  deMatrixColumnUnit,
  deMatrixColumns,
  deMatrixWindow,
} from './matrix';

export interface DateMatrixProps {
  vm: PrintViewModel;
  /** 本页承载的阶段（与 B4 同一批；分页由文档层统一裁） */
  rows: readonly PrintStageVM[];
  /** 本页行高（px）：文档层按纸面预算给（分页估高与渲染同源） */
  rowHeight: number;
}

export function DateMatrix({ vm, rows, rowHeight }: DateMatrixProps): JSX.Element {
  const { viewStart, viewEnd } = deMatrixWindow(vm.project, vm.stages);
  const cols = deMatrixColumns(viewStart, viewEnd);
  const unit = deMatrixColumnUnit(viewStart, viewEnd);
  return (
    <section className="de-mx" data-print-matrix2={unit} data-cols={cols.length}>
      {/* caption：时间列数 · 粒度 · 真实区间（W01 这类窗口相对序号靠它自明） */}
      <p className="de-mx__caption de-num">
        时间列 {cols.length} 格 · {DE_COLUMN_UNIT_LABEL[unit]} · {viewStart} → {viewEnd}
      </p>
      <div className="de-mx__head">
        <span className="de-mx__lead" aria-hidden />
        <span className="de-mx__cols" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
          {cols.map((c) => (
            <span key={c.key} className="de-mx__col de-num" title={`${c.from} → ${c.to}`}>
              {c.label}
            </span>
          ))}
        </span>
        <span className="de-mx__tail" aria-hidden />
      </div>
      <div className="de-mx__rows">
        {rows.map((s) => (
          <div
            key={s.id}
            className="de-mx__row"
            data-state={s.status}
            style={{ height: rowHeight }}
            data-testid={`de-mx-row-${s.orderIndex}`}
          >
            <span className="de-mx__lead">
              <span className="de-mx__no de-num">{String(s.orderIndex).padStart(2, '0')}</span>
              <span className="de-mx__name" title={s.name}>
                {s.name}
              </span>
            </span>
            <span className="de-mx__cols" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
              {cols.map((c) => {
                const on = deMatrixCellOn(s, c);
                return (
                  <span
                    key={c.key}
                    className="de-mx__cell"
                    data-cell={on ? deMatrixCellTone(s.status) : 'empty'}
                    data-col-from={c.from}
                  />
                );
              })}
            </span>
            <span className="de-mx__tail de-num">{s.ratioPercent}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}
