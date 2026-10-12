/**
 * 共享甘特渲染器（2026-10-13 · 5 块 × 4 模板重构 · 批 1 地基）。
 *
 * ── 它只管什么 ──
 * **DOM 结构 + 内联几何**（`left` / `width` 百分比与 `data-tick-left`），
 * **零配色、零模板专属文案**：所有颜色走两处出口——
 *   ① 阶段色（9 槽 / 自定义色）走 `components/timeline/stageColors` 的
 *      `stageSolidClass` / `stageSolidColor`（全仓唯一的阶段取色出口）；
 *   ② 其余（轴 / 轨道底 / 条 / 字形）全部留给
 *      `.print-root.print-template-*` 前缀的模板 CSS（各版自己覆写）。
 * 这样「同一份几何、四套长相」不需要在本文件里出现任何 `if (template === ...)`。
 *
 * ── 红线：经典**不接入**本渲染器 ──
 * `tests/print-options.spec.tsx:757-775` 与 `tests/print-preview.spec.tsx:99-115`
 * 是**读 `SchedulePaper.tsx` 源文件文本**的锁（钉七个 class/属性字符串），
 * 且 `tests/schedule-print-band-bounds.spec.tsx:202-219` 靠经典轨道行的结构
 * 选择器（`div.relative.h-7`）定位色条。故经典甘特的 JSX **原地不动**，
 * 本组件只服务 A/D/E/H 四套（批 1 只有 A 接入）。
 *
 * ── 为什么刻度与条带的属性名和经典**同款** ──
 * `data-print-month-tick` / `data-tick-left` 沿用一个约定，不是为了复用经典
 * 代码，而是为了让「新派生层与经典数学恒等」这条断言可以用**同一套量具**
 * 在两个 DOM 上取数（`tests/print-gantt-derive.spec.ts` 的等价性用例）。
 */

import { StageStatus } from '../../core/types/enums';
import {
  STAGE_COLOR_NAMES,
  customStageColorAttr,
  stageSolidClass,
  stageSolidColor,
} from '../../components/timeline/stageColors';
import { STAGE_GLYPH, stageStatusLabel } from '../pages/generic/shared';
import {
  GANTT_COMPACT_UNDER,
  GANTT_ROW_HEIGHT,
  type PrintGanttModel,
} from '../model/print-gantt';

/** 四套模板的渲染标识（决定根类名后缀与 CSS 命名空间；不决定任何配色） */
export type PrintGanttVariant = 'swiss' | 'de' | 'ei' | 'ap';

const VARIANT_CLASS: Record<PrintGanttVariant, string> = {
  swiss: 'print-gantt--swiss',
  de: 'print-gantt--de',
  ei: 'print-gantt--ei',
  ap: 'print-gantt--ap',
};

/** 四态字形在轨道行里的展示口径（双编码：字形 + 文字语义由 figcaption/图例给） */
const STAGE_STATES: readonly StageStatus[] = [
  StageStatus.NotStarted,
  StageStatus.InProgress,
  StageStatus.Completed,
  StageStatus.Delayed,
];

export interface PrintGanttProps {
  model: PrintGanttModel;
  variant: PrintGanttVariant;
  /**
   * 轨道行高（px）。**由宿主模板按纸面预算算好传入**（A 见 `swissGanttPitch`：
   * 阶段越多行越矮，下限 14）——本组件只负责把它落到内联几何上。
   * 缺省 = 设计基线 28（§1.1 的「28px 轨道行」）。
   */
  rowHeight?: number;
}

export function PrintGantt({
  model,
  variant,
  rowHeight = GANTT_ROW_HEIGHT,
}: PrintGanttProps): JSX.Element {
  // 行高被压到基线以下 ⇒ 切紧凑字体档（各版 CSS 按 data-density 覆写字号）
  const compact = rowHeight < GANTT_COMPACT_UNDER;
  return (
    <section
      className={`print-gantt ${VARIANT_CLASS[variant]}`}
      data-print-gantt={variant}
      data-view-days={model.viewDays}
      data-density={compact ? 'compact' : undefined}
    >
      {/* 轴：2px 基线；月份刻度**压线**（与条带同一坐标系，故与轨道行左右两端同宽） */}
      <div className="print-gantt__axis">
        <div className="print-gantt__lead" aria-hidden />
        <div className="print-gantt__ticks">
          {model.ticks.map((t) => (
            <span
              key={t.label}
              data-print-month-tick=""
              data-tick-left={t.leftPercent.toFixed(2)}
              className="print-gantt__tick"
              style={{ left: `${t.leftPercent}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
        <div className="print-gantt__tail" aria-hidden />
      </div>

      <div className="print-gantt__rows">
        {model.rows.map((r) => {
          const color = stageSolidColor(r.orderIndex, r.colorIndex, r.customColor);
          const attr = customStageColorAttr(r.customColor);
          return (
            <div
              key={r.key}
              className="print-gantt__row"
              data-print-gantt-row={r.orderIndex}
              style={{ height: rowHeight }}
            >
              {/* 站号列：`NN` + 阶段名（A 的 `w-40` 站号位；宽度由模板 CSS 定） */}
              <div className="print-gantt__stop">
                <span className="print-gantt__no">{String(r.orderIndex).padStart(2, '0')}</span>
                <span className="print-gantt__name" title={r.name}>
                  {r.name}
                </span>
              </div>
              {/* 轨道：底由模板 CSS 给；条是墨实心（A），几何只在这里 */}
              <div className="print-gantt__track" style={{ height: rowHeight }}>
                <div
                  className="print-gantt__bar"
                  data-print-gantt-bar=""
                  data-left={r.left.toFixed(4)}
                  data-width={r.width.toFixed(4)}
                  style={{ left: `${r.left}%`, width: `${r.width}%` }}
                  title={r.title}
                >
                  {/* 条左端 4px 阶段色端标（A 的取舍：纸面是交通黄，条若也走阶段色会隐身） */}
                  <span
                    className={`print-gantt__cap${attr ? '' : ` ${stageSolidClass(r.orderIndex)}`}`}
                    data-stage-index={r.orderIndex}
                    style={attr ? { backgroundColor: color } : undefined}
                    {...(attr ? { 'data-stage-key': attr } : {})}
                    aria-hidden
                  />
                  <span className="print-gantt__state" aria-hidden>
                    {STAGE_GLYPH[r.status]}
                  </span>
                </div>
              </div>
              {/* 行末右对齐两端日期（tabular） */}
              <div className="print-gantt__dates">
                {r.startAt} — {r.endAt}
              </div>
            </div>
          );
        })}
      </div>

      {model.rows.length > 0 && (
        <div className="print-gantt__legend">
          {/* 图例两行：① 阶段色 9（名称进 title，不占版面）② 状态四态（字形 + 词） */}
          <div className="print-gantt__legend-row">
            <span className="print-gantt__legend-label">阶段色</span>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <span
                key={n}
                className={`print-gantt__swatch ${stageSolidClass(n)}`}
                title={`${n} ${STAGE_COLOR_NAMES[n] ?? ''}`}
              />
            ))}
          </div>
          <div className="print-gantt__legend-row">
            <span className="print-gantt__legend-label">状态</span>
            {STAGE_STATES.map((st) => (
              <span key={st} className="print-gantt__legend-state">
                <span className="print-gantt__legend-glyph" aria-hidden>
                  {STAGE_GLYPH[st]}
                </span>
                {stageStatusLabel(st)}
              </span>
            ))}
            {/* 口径注（四套甘特统一：条 = 时间跨度，不是完成度）——宪法 7 每页可独立解释 */}
            <span className="print-gantt__legend-note">条 = 时间跨度（非完成度）</span>
          </div>
        </div>
      )}
    </section>
  );
}
