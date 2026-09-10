/**
 * 月历色镜像与取色（设计规格 §1.2 角色映射 · PRD §6.2 铁律 8）。
 *
 * 组件内一律用 Tailwind token class；色带 / 色点 / 图例等需要内联 fill 的场景，
 * 色值必须集中镜像到本文件（与 tailwind.config / stageColors / timelineColors 同步，
 * 修改任一处必须同步）。禁止在组件里写裸 hex。
 *
 * ⚠️ 阶段九色 v3 起分「角色变体」（设计规格 §1.2），本文件按角色分别取：
 *   · 宽面色带（月历色带 / 大横条）→ STAGE_BAND_COLORS
 *       即 --stage-band-sN：亮色页 = lightBar、暗色页 = darkBar（暗色切换由 global.css
 *       的主题变量承担，本文件零改动）。
 *   · 实心块（图例点 / 清单色点 / 小方块）→ STAGE_BAR_COLORS
 *       即 --stage-sN：亮色页 = main、暗色页 = lightBar。
 *   · 面内字（压在色带上的字 / 页面级前景装饰）→ STAGE_BAND_INK_COLORS
 *       即 --stage-ink-sN：亮色页 = lightText、暗色页 = darkText。
 *
 * ⚠️ 月历图例九色是**实心块**（10×10 小方块），故用 STAGE_BAR_COLORS；
 *   画板 14/15 亦明确「图例九色亮暗都用 main 值，不是 band 组」。
 */

import {
  STAGE_BAND_COLORS,
  STAGE_BAND_INK_COLORS,
  STAGE_BAR_COLORS,
} from '../timeline/stageColors';
import { TODAY_LINE_COLOR, RING_PROGRESS } from '../timeline/timelineColors';
import { resolveStageColorIndex } from '../../core/template/stage-fallback';

/** 未开始幽灵态底色 = --calendar-not-started（亮色 #a0a0a8 / 暗色 #9aa3b2，住 global.css，随主题换肤） */
export const NOT_STARTED_COLOR = 'var(--calendar-not-started)';

/** 逾期色带 = clay token（#f06548，复用今日线色，同一语义源） */
export const OVERDUE_COLOR = TODAY_LINE_COLOR;

/** 已完成色带 = stage.s9 的宽面变体（九段色末段，token 唯一来源） */
export const COMPLETED_COLOR = STAGE_BAND_COLORS[9];

/** 末端蓝色进度点 = pine token（#6ea8fe，复用完成度环进度色） */
export const PROGRESS_DOT_COLOR = RING_PROGRESS;

/** 九段阶段序号（图例 / 筛选 chip / 清单色点共用，避免各处散写 [1..9]） */
export const STAGE_ORDERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** 阶段序号的可读角标（①~⑨） */
export const CIRCLED_NUMBERS = '①②③④⑤⑥⑦⑧⑨';

/** 按阶段取九段色「宽面」变体（时间轴色带同源，跨视图一致）。
 *  colorIndex 优先（多阶段项目 1..9 循环色板），缺失时按 orderIndex 读时回落。 */
export function stageColorOf(orderIndex: number, colorIndex?: number | null): string {
  return STAGE_BAND_COLORS[resolveStageColorIndex(orderIndex, colorIndex)] ?? COMPLETED_COLOR;
}

/**
 * 按阶段取「实心块」色（画板 18-B 清单色点 12×12、图例点）。
 * 入参口径与 computeCalendarEntry 的 filterStageIndex 一致（激活阶段 orderIndex /
 * 已完成→9 / 未开始→1），故色点与同一天色带恒为同一色相（只是角色变体不同）。
 */
export function stageSolidOf(filterStageIndex: number, colorIndex?: number | null): string {
  return (
    STAGE_BAR_COLORS[resolveStageColorIndex(filterStageIndex, colorIndex)] ?? STAGE_BAR_COLORS[9]
  );
}

/**
 * 取该阶段色带上的文字色（亮色页 lightText / 暗色页 darkText）。
 * 需要把文字压在 stageColorOf() 的色带上时使用——浅色带（s5 芽白 / s7 米白）上的
 * 白字对比度仅 1.10 / 1.11，是硬 bug，故一律走本函数而非 text-white。
 */
export function stageBandInkOf(orderIndex: number, colorIndex?: number | null): string {
  return (
    STAGE_BAND_INK_COLORS[resolveStageColorIndex(orderIndex, colorIndex)] ??
    STAGE_BAND_INK_COLORS[9]
  );
}

/**
 * 页面级前景装饰（月历「六 / 日」表头文字）的角色基准阶段。
 *
 * ── 为什么需要「按主题反转」 ──
 * 设计规格 §1.2 角色表最后一行单独规定了这一行：
 *   页面级前景装饰 → 明色页面用 `lightText`（深调）／暗色页面用 `main`（亮调）。
 * 与其余所有角色**方向相反**（别处都是「亮色 main、暗色 lightBar」），
 * 因为这两者都压在页面底上（亮底要深字、暗底要亮字），而不是压在色带上。
 *
 * ── 为什么取 s1 ──
 * 规格未指名具体阶段色（画板 14/15 只写「用 lightText 深调着色」）。
 * 取 s1 松墨：九色首位、中性偏冷，且亮色 lightText #071212 是九色里最深的，
 * 作为「周末」这种纯装饰性强调对比度最好。改这一处即可整体换基准色。
 */
export const WEEKEND_ACCENT_STAGE = 1;

/**
 * 周末表头文字色（按当前主题取相反变体）：
 *   亮色页 → --stage-ink-s1（解析为 lightText，深调）
 *   暗色页 → --stage-s1    （解析为 main，亮调）
 * 需要调用方传入已解析主题（见 hooks/useTheme），因为这一处必须显式跨角色取色。
 */
export function weekendHeaderColor(theme: 'light' | 'dark'): string {
  return theme === 'dark'
    ? STAGE_BAR_COLORS[WEEKEND_ACCENT_STAGE]
    : STAGE_BAND_INK_COLORS[WEEKEND_ACCENT_STAGE];
}
