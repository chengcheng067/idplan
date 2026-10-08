/**
 * 月历图例（画板 14 第 2 行 · 画板 15 · 规格 §1.2 角色表）。
 *
 * ── 画板 14 原文 ──
 *   「图例行：横向 gap: 10，含「阶段」标签 10 + 九色图例（9 个 10 × 10 方块，**无圆角**，
 *     用 `main` 值，gap: 2）」
 *
 * ⚠️ 九色取 `STAGE_BAR_COLORS`（实心块组 = 亮色 main / 暗色 lightBar），
 *   **不是** `STAGE_BAND_COLORS`。画板 14 与 15 都专门写明「图例九色亮暗都用 main」——
 *   图例是 10×10 小方块 = 实心块角色（§1.2 角色表第 2 行含「图例点」）。
 *
 * ── 与画板的一处有意差异（保留既有功能）──
 * 画板 14 的图例行只画了「阶段 + 九色」。但月历里实际还会出现另外三种色：
 * 逾期（clay）、未开始（幽灵灰）、当前进度点（pine）。删掉这三个说明会让页面出
 * 三块「无人解释的颜色」，属于既有功能回退，故**保留**，并统一改成与九色一致的
 * 10×10 无圆角方块（进度点保留圆形，它语义上就是个点）。
 *
 * ── 法定节假日说明（showHolidayHint）──
 * 节日名/「班」小字复用既有 text-mist token（零新色、零新色块），故图例也只补一条
 * **轻量文字说明**，不加色块。仅在「跳过国家法定节假日」开关开启时传入 true——
 * 开关关着没有节日名可解释，写出来反而是噪声。
 */

import {
  CIRCLED_NUMBERS,
  NOT_STARTED_COLOR,
  OVERDUE_COLOR,
  PROGRESS_DOT_COLOR,
  STAGE_ORDERS,
} from './calendarColors';
import { STAGE_BAR_COLORS } from '../timeline/stageColors';
import { cn } from '../../lib/cn';

/**
 * 图例色块：10×10、**无圆角**（画板 14 明确「无圆角」，故不加 rounded-*）。
 * round 仅用于「当前进度点」——它是环状点，形状本身是语义的一部分。
 */
function Swatch({
  color,
  ghost,
  round,
}: {
  color: string;
  ghost?: boolean;
  round?: boolean;
}): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-[10px] w-[10px] shrink-0', round && 'rounded-full')}
      style={{ backgroundColor: color, opacity: ghost ? 0.35 : 1 }}
    />
  );
}

export function CalendarLegend({ showHolidayHint = false }: { showHolidayHint?: boolean }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-[10px]">
      {/* 阶段九色：label 10 + 方块 10×10 + gap 2 */}
      <div className="flex items-center gap-[10px]">
        <span className="text-[10px] text-mist">阶段</span>
        <div className="flex items-center gap-[2px]">
          {STAGE_ORDERS.map((i) => (
            /* inline-flex：让外壳**收缩到色块本身**（10×10）。
               若留成 inline，外壳会按行高撑到 ~24px，图例行因此虚高、色块在行内偏上。 */
            <span key={i} className="inline-flex" title={`阶段${CIRCLED_NUMBERS[i - 1]}`}>
              <Swatch color={STAGE_BAR_COLORS[i]} />
            </span>
          ))}
        </div>
      </div>

      {/* 既有语义色说明（画板 14 未画，但月历里真实出现，删掉即为功能回退） */}
      <div className="flex items-center gap-[6px]">
        <Swatch color={OVERDUE_COLOR} />
        <span className="text-[11px] text-mist">逾期</span>
      </div>

      <div className="flex items-center gap-[6px]">
        <Swatch color={NOT_STARTED_COLOR} ghost />
        <span className="text-[11px] text-mist">未开始</span>
      </div>

      <div className="flex items-center gap-[6px]">
        <Swatch color={PROGRESS_DOT_COLOR} round />
        <span className="text-[11px] text-mist">当前进度位置</span>
      </div>

      {/* 法定节假日说明（纯文字，不加色块：节日名小字本身不带新色） */}
      {showHolidayHint && (
        <span className="text-[11px] text-mist">节日名 = 法定节假日 · 班 = 调休补班日</span>
      )}
    </div>
  );
}
