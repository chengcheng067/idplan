/**
 * 九段阶段配色（v0.7 v3 · 设计 token 的别名层）。
 *
 * 数值唯一来源是 src/styles/global.css 的 CSS 变量（--stage-sN / --stage-band-sN /
 * --stage-ink-sN），本文件**只持有 var() 引用，不持有任何 hex**——
 * 因此换肤（<html data-theme>）时 SVG / 内联 style 会跟 Tailwind 类一起自动切换，
 * 不会再出现「侧栏彩条换肤了、时间轴色带没换」的割裂。
 *
 * 三套变体 = 三个角色，对应 global.css 里的三组变量（映射表见设计规格 §1.2）：
 *
 *   STAGE_BAR_COLORS      实心块  --stage-sN      亮 = main     / 暗 = lightBar
 *     用途：侧栏项目彩条 / 细竖条 / 小方块 / 色点 / 图例点 / 阶段点
 *   STAGE_BAND_COLORS     宽面    --stage-band-sN 亮 = lightBar / 暗 = darkBar
 *     用途：时间轴跨度色带 / 月历色带 / 大横条 / 阶段条
 *   STAGE_BAND_INK_COLORS 面内字  --stage-ink-sN  亮 = lightText / 暗 = darkText
 *     用途：压在 STAGE_BAND_COLORS 上的文字
 *
 * 为什么用 var() 而不是 hex：
 *   1) 主题感知——同一个常量在亮/暗页解析出不同变体，无需组件传 theme；
 *   2) SVG 的 fill / stroke 与 DOM 的色板属性在现代浏览器下都支持 CSS 变量；
 *   3) 唯一值源收敛到 global.css，消除「两处必须手工同步」的隐患。
 *
 * ⚠️ 打印页 / A4 预览页（SchedulePrintPage、CalendarPrintPage）根节点带 .print-root，
 *    global.css 已把该子树的所有令牌锁回亮色，故打印稿永远是浅色变体（SPEC 画板 09/20）。
 *
 * ⚠️ 索引约定：1..9 与阶段 colorIndex 一致（见 core/types/dto.ts），
 *    越界取色由 resolveStageColorIndex() 兜底，调用方的 ?? 回落只在「连 9 号都没有」时生效。
 */

import { resolveStageColorIndex } from '../../core/template/stage-fallback';

/** 实心块取色：亮 = main / 暗 = lightBar */
export const STAGE_BAR_COLORS: Readonly<Record<number, string>> = {
  1: 'var(--stage-s1)',
  2: 'var(--stage-s2)',
  3: 'var(--stage-s3)',
  4: 'var(--stage-s4)',
  5: 'var(--stage-s5)',
  6: 'var(--stage-s6)',
  7: 'var(--stage-s7)',
  8: 'var(--stage-s8)',
  9: 'var(--stage-s9)',
};

/** 宽面色带取色：亮 = lightBar / 暗 = darkBar */
export const STAGE_BAND_COLORS: Readonly<Record<number, string>> = {
  1: 'var(--stage-band-s1)',
  2: 'var(--stage-band-s2)',
  3: 'var(--stage-band-s3)',
  4: 'var(--stage-band-s4)',
  5: 'var(--stage-band-s5)',
  6: 'var(--stage-band-s6)',
  7: 'var(--stage-band-s7)',
  8: 'var(--stage-band-s8)',
  9: 'var(--stage-band-s9)',
};

/** 色带内文字取色：亮 = lightText / 暗 = darkText */
export const STAGE_BAND_INK_COLORS: Readonly<Record<number, string>> = {
  1: 'var(--stage-ink-s1)',
  2: 'var(--stage-ink-s2)',
  3: 'var(--stage-ink-s3)',
  4: 'var(--stage-ink-s4)',
  5: 'var(--stage-ink-s5)',
  6: 'var(--stage-ink-s6)',
  7: 'var(--stage-ink-s7)',
  8: 'var(--stage-ink-s8)',
  9: 'var(--stage-ink-s9)',
};

/** 九段色的可读名称（用于图例 / 打印稿「阶段色泽」说明，避免散落硬编码中文色名） */
export const STAGE_COLOR_NAMES: Readonly<Record<number, string>> = {
  1: '松墨',
  2: '亮蓝',
  3: '雾蓝',
  4: '草绿',
  5: '芽白',
  6: '蜜黄',
  7: '米白',
  8: '珊瑚',
  9: '栗褐',
};

/**
 * 按阶段取「实心块」色（侧栏彩条 / 图例点 / 阶段点一类）。
 * 与旧签名完全一致，调用点零改动。
 */
export function stageSolidColor(orderIndex: number, colorIndex?: number | null): string {
  return STAGE_BAR_COLORS[resolveStageColorIndex(orderIndex, colorIndex)] ?? STAGE_BAR_COLORS[9];
}

/**
 * 按阶段取「宽面」色（时间轴跨度色带 / 月历色带 / 大横条 / 阶段条）。
 * SVG 的 rect fill 与 DOM 的 backgroundColor 都可直接用。
 */
export function stageBandColor(orderIndex: number, colorIndex?: number | null): string {
  return STAGE_BAND_COLORS[resolveStageColorIndex(orderIndex, colorIndex)] ?? STAGE_BAND_COLORS[9];
}

/** 取该阶段色带上的文字色（与 stageBandColor 配对使用） */
export function stageBandInkColor(orderIndex: number, colorIndex?: number | null): string {
  return (
    STAGE_BAND_INK_COLORS[resolveStageColorIndex(orderIndex, colorIndex)] ??
    STAGE_BAND_INK_COLORS[9]
  );
}
