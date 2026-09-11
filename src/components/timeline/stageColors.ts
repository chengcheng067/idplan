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
 * 除上面三个「取色常量」外，本文件还持有**色带发丝描边**的共享实现
 * （BAND_OUTLINE_ALPHA / stageBandOutline，见文件尾）——月历色带与时间轴色带两处共用，
 * 解决规格未定义「色带 vs 格底对比度」导致的隐形色带问题。
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

/* ------------------------ Tailwind 类名静态镜像（BUG-05） ------------------------ */
/*
 * ── 为什么必须有这一组常量（这是一个真实的、曾经导致全站阶段色不显色的根因）──
 *
 * Tailwind 的 CSS 生成是**纯静态文本扫描**：它只在源码里寻找字面量形式的类名，
 * 模板字符串（`bg-stage-band-s${n}`）在扫描期还不知道 n 是什么，因此**一个类都不会生成**。
 * 这不是「可能不灵」，是确定性的失败——实测构建产物 CSS 里
 * `bg-stage-band-s1..s9` / `text-stage-ink-s1..s9` / `bg-stage-s1..s9` 的生成条数 **全部为 0**。
 *
 * 后果：month 色带、阶段 chip、阶段色点在**亮色与暗色下都完全不显色**（只剩透明或继承色），
 * 而单测与 tsc 都发现不了它——只有真浏览器看构建产物才看得见。
 *
 * ── 铁律 ──
 * 凡需要「按阶段序号取 Tailwind 类名」的地方，**一律索引本文件的静态映射表**，
 * 禁止在调用点写模板字符串。新增调用点时照抄下面任意一行的写法即可。
 *
 * ⚠️ 本表与 tailwind.config.ts 的 safelist 是**双保险**，两者都要在：
 *    · 本表 —— 让运行时真的取到正确的类；
 *    · safelist —— 万一某处又退回动态拼接，CSS 里仍然有这些类可用。
 *    只做其中一件都不算修好。
 */

/** 实心块类名（bg-stage-sN）：色点 / 细竖条 / 小方块 / 图例点 */
export const STAGE_SOLID_CLASS: Readonly<Record<number, string>> = {
  1: 'bg-stage-s1',
  2: 'bg-stage-s2',
  3: 'bg-stage-s3',
  4: 'bg-stage-s4',
  5: 'bg-stage-s5',
  6: 'bg-stage-s6',
  7: 'bg-stage-s7',
  8: 'bg-stage-s8',
  9: 'bg-stage-s9',
};

/** 宽面底 + 面内字 成对类名（bg-stage-band-sN text-stage-ink-sN）：阶段 chip / 色签 / 色带文字 */
export const STAGE_BAND_CLASS: Readonly<Record<number, string>> = {
  1: 'bg-stage-band-s1 text-stage-ink-s1',
  2: 'bg-stage-band-s2 text-stage-ink-s2',
  3: 'bg-stage-band-s3 text-stage-ink-s3',
  4: 'bg-stage-band-s4 text-stage-ink-s4',
  5: 'bg-stage-band-s5 text-stage-ink-s5',
  6: 'bg-stage-band-s6 text-stage-ink-s6',
  7: 'bg-stage-band-s7 text-stage-ink-s7',
  8: 'bg-stage-band-s8 text-stage-ink-s8',
  9: 'bg-stage-band-s9 text-stage-ink-s9',
};

/**
 * 阶段序号 → 1..9 取模。
 * 与 stageBandColor 等函数共用同一约定（1..9，越界由 resolveStageColorIndex 兜底）。
 */
export function stageSlotOf(stageIndex: number): number {
  const n = Math.trunc(stageIndex) % 9;
  return (n < 0 ? n + 9 : n) + 1;
}

/** 取「实心块」Tailwind 类名（禁止调用点自行拼接） */
export function stageSolidClass(stageIndex: number): string {
  return STAGE_SOLID_CLASS[stageSlotOf(stageIndex)];
}

/** 取「宽面底 + 面内字」Tailwind 类名对（禁止调用点自行拼接） */
export function stageBandClass(stageIndex: number): string {
  return STAGE_BAND_CLASS[stageSlotOf(stageIndex)];
}

/* ------------------------------ 色带发丝描边（BUG-04） ------------------------------ */

/**
 * 发丝描边的不透明度 —— **单一来源**，两处渲染点（月历格内色带 / 时间轴跨度色带）共用。
 *
 * ── 为什么需要它（这是规格的一处空白）──
 * 规格 §1.2 只规定了三个角色变体（main / lightBar / darkBar、lightText / darkText）的 hex，
 * **从未规定「色带 vs 所在格底」的对比度**。于是出现了两侧主题都存在的隐形色带：
 *   · 亮色：格底是白，而 s5 芽白 #e0ffb7 / s7 米白 #fff2d6 压上去 → 对比度 1.10 / 1.11
 *   · 暗色：格底是 #1F2126 一类中性暗，而 s1 松墨 #172e30 / s9 栗褐 #372022 → 1.13 / 1.07
 * WCAG 2.1 SC 1.4.11 对「理解内容所必需的图形元素」要求 ≥ 3.0，上述四例连 1.2 都不到。
 *
 * ── 为什么是「本阶段的 stage-ink」而不是某个固定描边色 ──
 * `--stage-ink-sN` 的定义就是「压在该阶段色带上可读的字色」，即它**天生与本阶段色带
 * 明度对立**（浅带配深字、深带配白字）。把它按 30% 压在色带边缘，等于给每根色带描一圈
 * 「自己的反色毛边」——九色无需按色号分支，亮/暗两套主题也无需分支，一个公式通吃。
 *
 * 实测（`qa-scratch/tl-contrast.txt`，改写前 → 改写后，对白色/暗色格底）：
 *   s5 亮 1.10 → 1.92 ／ s7 亮 1.11 → 1.94 ／ s1 暗 1.13 → 2.96（月历 paper 底）
 * 与色带自身的亮度差恒定落在 1.63–1.96（「边 vs 带」），即描边永远能与带面分离。
 *
 * ⚠️ 30% 实测可辨但**未达 3.0**（亮色侧缺口最大的是 s5，需 ~51% 才过线）。
 *    这是本任务按领队指令取的值；若要冲 WCAG，只需把本常量调大（无需改任何调用点）——
 *    因为它是唯一来源。详见交付报告「对比度」一节。
 */
export const BAND_OUTLINE_ALPHA = 0.3;

/** 发丝描边线宽（两处渲染点统一 1px，画板 04 的「当前阶段 1px 描边」同宽） */
export const BAND_OUTLINE_WIDTH = 1;

/**
 * 色带描边在两种渲染面上的取值形态。
 * DOM 用 `boxShadow`（内描边），SVG 用 `stroke` + `strokeOpacity`——
 * 之所以分成两个字段而不是一个字符串，是因为 SVG 的 `<rect>` 只有一个 `stroke` 通道，
 * 而「当前阶段」还要额外占用它画 1px pine（画板 04），故 alpha 必须能拆开传递。
 */
export interface BandOutline {
  /** DOM 内联 style 用：1px inset 描边（box-shadow 实现，不占布局空间） */
  readonly boxShadow: string;
  /** SVG 用：描边色（CSS 颜色，不含 alpha） */
  readonly stroke: string;
  /** SVG 用：描边不透明度 */
  readonly strokeOpacity: number;
  /** SVG 用：描边线宽 */
  readonly strokeWidth: number;
}

/**
 * 取某阶段色带的发丝描边样式。
 *
 * 两处渲染点必须都调它，不要各写一套：
 *   1. 月历格内色带 —— `src/components/calendar/MonthDayCell.tsx`（消费 `.boxShadow`）
 *   2. 时间轴跨度色带 —— `src/components/timeline/StageBar.tsx`（消费 `.stroke*`）
 *
 * DOM 侧走 `--stage-ink-sN-rgb` 三元组（global.css 已为九色各备一份），
 * 这样 alpha 才能在 CSS 里注入；SVG 侧直接引用 `--stage-ink-sN` 实体色 + strokeOpacity。
 * 两者解析结果完全一致，且都随 <html data-theme> 自动换肤。
 */
export function stageBandOutline(orderIndex: number, colorIndex?: number | null): BandOutline {
  const idx = resolveStageColorIndex(orderIndex, colorIndex);
  return {
    boxShadow: `inset 0 0 0 ${BAND_OUTLINE_WIDTH}px rgb(var(--stage-ink-s${idx}-rgb) / ${BAND_OUTLINE_ALPHA})`,
    stroke: `var(--stage-ink-s${idx})`,
    strokeOpacity: BAND_OUTLINE_ALPHA,
    strokeWidth: BAND_OUTLINE_WIDTH,
  };
}
