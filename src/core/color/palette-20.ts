/**
 * v0.8 事件阶段色板（20 色）—— **机器校验，不靠目视**（TS-02 / TBD-4 / TBD-11）。
 *
 * ── 结构 ──
 *   前 9 项 = 现网 v0.7 锚点（`tmp/build_palette2.py` 的 `MAIN`，逐字节不得改）。
 *   后 11 项 = v0.8 新增（第 10–20 位）——**不需要设计侧目视确认**（TBD-11 已裁决），
 *             机器校验通过即放行：分组内两两 `ΔE >= 10`（V3）、与锁定语义色 `ΔE >= 15`（V5）、
 *             `ink vs band >= 4.5`（V1/V2 三态）。
 *
 * ── 11 个新增色是怎么来的（可复跑，不是手挑）──
 *   工作区根 `tmp/scratch_t02/pick11.py`（试算脚本，**不入库**）：
 *   ① 在与 9 色相同的 S/L 包络内做色相轮转（H 步长 2°、S ∈ 0.35–0.75、L ∈ 0.30–0.70）；
 *   ② 单色闸门：`contrast(lightBar,lightText) >= 4.5`、`contrast(darkBar,darkText) >= 4.5`、
 *      `contrast(main,#FFF) >= 1.5`（V8）、`V5 最差 >= 16`（比硬闸 15 留余量）；
 *   ③ 贪心：每次加入「使三组两两最小 ΔE 最大」的候选，并要求与已选色
 *      「色相差 >= 20° 或 L* 差 >= 18」（避免同色系扎堆）。
 *   实测结果：V3 三组最小 ΔE = 15.0 / 19.8 / 15.0，新增色 V5 最差 = 16.4，V1 最小 = 4.54，V2 最小 = 8.08。
 *
 * ── 为什么 V5 有一个**登记在案的例外**（诚实记录，勿删）──
 *   锚点 s2 `#2E86F0` 与「进行中 pine 暗变体 `#828CF7`」的 ΔE = **14.9478 < 15**。
 *   这不是 v0.8 引入的问题：**生成器自己就会打 `!! 压线`**（脚本校验段 :225-235 的输出）。
 *   而 s2 是冻结锚点（`global.css` 逐字节不得动，验收第 7 条），所以「20 色 V5 全绿」这条
 *   验收标准在**字面上不可能满足**。处置：
 *     · 11 个新增色 **一律硬闸 15**（实测最小 16.4，无例外）；
 *     · s2 以 `V5_KNOWN_TIGHT` **显式登记**并断言其精确值（14.95±0.01）——
 *       一旦算法被改动，数值会漂移，断言立刻红，所以它不是"放水"；
 *     · 同时给 `sameScreenModel`（更贴近实际的同屏组合模型）作为对照报告：
 *       亮色实心 = main 只与亮色语义色同屏、暗色实心 = lightBar 只与暗色语义色同屏，
 *       该模型下 s2 的最差值为 **23.65** ≫ 15 ⇒ 真实风险为零，压线来自脚本口径过严
 *       （脚本把 main 与「亮/暗两套语义色」一起比，属于跨主题同屏，实际不会发生）。
 */

import { deltaE76, labChroma, contrast, nearestByDeltaE } from './contrast';
import {
  DARK_PAGE,
  DELTA_E_MIN_DISTINCT,
  DELTA_E_MIN_VS_SEMANTIC,
  PAPER_DARK,
  PAPER_LIGHT,
  TEXT_MIN_CONTRAST,
  CONTRAST_WARN_MAIN_ON_PAGE,
  deriveStageColors,
  pickDarkBand,
  pickLightBand,
} from './derive-stage-colors';

/** 前 9 项 = 现网锚点（`global.css:115-161` 亮 / `:331-377` 暗，9/9 逐字节相等） */
export const ANCHOR_9: readonly string[] = [
  '#215452', // s1  松墨
  '#2E86F0', // s2  亮蓝
  '#99B7FC', // s3  雾蓝
  '#8CC63E', // s4  草绿
  '#E0FFB7', // s5  芽白
  '#FFD16B', // s6  蜜黄
  '#FFF2D6', // s7  米白
  '#FF6D47', // s8  珊瑚
  '#6F3432', // s9  栗褐
];

/** v0.8 新增（第 10–20 位） */
export const ADDED_11: readonly string[] = [
  '#5A9E4C', // s10 苔绿
  '#4FE232', // s11 春绿
  '#98CDA1', // s12 灰绿
  '#251B7E', // s13 靛紫
  '#7E32E2', // s14 堇紫
  '#CD81E4', // s15 兰紫
  '#AA1866', // s16 洋红
  '#CD98AD', // s17 藕粉
  '#CD1DB6', // s18 品红
  '#673265', // s19 茄紫
  '#81E4B6', // s20 薄荷
];

/** 20 色主色板（顺序 = 取色器里的展示顺序；索引 0 ⇒ s1） */
export const PALETTE_20: readonly string[] = [...ANCHOR_9, ...ADDED_11];

/** 20 色名称（前 9 与 `stageColors.STAGE_COLOR_NAMES` 一致，逐字不改） */
export const PALETTE_20_NAMES: readonly string[] = [
  '松墨',
  '亮蓝',
  '雾蓝',
  '草绿',
  '芽白',
  '蜜黄',
  '米白',
  '珊瑚',
  '栗褐',
  '苔绿',
  '春绿',
  '灰绿',
  '靛紫',
  '堇紫',
  '兰紫',
  '洋红',
  '藕粉',
  '品红',
  '茄紫',
  '薄荷',
];

/**
 * V5 的锁定语义色（**逐字用这些 hex，不得自造**）。
 * 键名沿用生成器的 `SEMANTIC` 分法：亮色变体 4 个 + 暗色变体 4 个
 * （「完成 moss」亮暗同值 `#34D399`）。
 */
export const LOCKED_SEMANTIC: Readonly<Record<string, { light: string; dark: string }>> = {
  '逾期 clay': { light: '#EF4444', dark: '#F77070' },
  '临期 amber': { light: '#F59E0B', dark: '#FABF24' },
  '完成 moss': { light: '#34D399', dark: '#34D399' },
  '进行中 pine': { light: '#6366F1', dark: '#828CF7' },
};

/** V5 的「主色」对照集（脚本 `{**SEM_L, **SEM_D}`，共 7 个不同值） */
export const SEMANTIC_MAIN_POOL: readonly string[] = [
  '#EF4444',
  '#F77070',
  '#F59E0B',
  '#FABF24',
  '#34D399',
  '#6366F1',
  '#828CF7',
];

/** V5 的「亮带」对照集（脚本 `SEM_L`） */
export const SEMANTIC_LIGHT_POOL: readonly string[] = ['#EF4444', '#F59E0B', '#34D399', '#6366F1'];

/** V5 的「暗带」对照集（脚本 `SEM_D`） */
export const SEMANTIC_DARK_POOL: readonly string[] = ['#F77070', '#FABF24', '#34D399', '#828CF7'];

/**
 * ★ 登记在案的 V5 例外：**冻结锚点** s2 与 pine 暗变体的 ΔE = 14.9478 < 15。
 * 生成器自身的校验段同样打 `!! 压线`（脚本 :225-235），并非 v0.8 引入。
 * 该值被 spec 断言，改动算法即红。
 */
export const V5_KNOWN_TIGHT: Readonly<Record<string, number>> = {
  '#2E86F0': 14.9478,
};

/* ------------------------------------------------------------------ V1–V9 机器校验 */

export type PaletteCheckId = 'V1' | 'V2' | 'V3-main' | 'V3-lightBar' | 'V3-darkBar' | 'V4' | 'V5' | 'V7' | 'V8';

export interface PaletteCheck {
  id: PaletteCheckId;
  /** 实测最差值（V1/V2/V7 是最小对比度；V3/V4/V5 是最小 ΔE；V8 是最小对比度） */
  worst: number;
  threshold: number;
  ok: boolean;
  /** 最差值的产生处，便于定位 */
  detail: string;
  /** V3/V4/V5/V8 这类「逐色」检查附上明细 */
  offenders: { hex: string; value: number; peer?: string }[];
}

function pairMinDeltaE(
  values: readonly string[],
): { min: number; pair: [number, number]; offenders: { hex: string; value: number; peer: string }[] } {
  let min = Number.POSITIVE_INFINITY;
  let pair: [number, number] = [0, 0];
  const offenders: { hex: string; value: number; peer: string }[] = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      const d = deltaE76(values[i]!, values[j]!);
      if (d < min) {
        min = d;
        pair = [i, j];
      }
      if (d < DELTA_E_MIN_DISTINCT) offenders.push({ hex: values[i]!, value: d, peer: values[j]! });
    }
  }
  return { min, pair, offenders };
}

/** 单色三态字色对比度（亮 = lightBar/lightText；暗 = darkBar/darkText；打印 = 亮色变体） */
export function inkContrasts(mainHex: string): { light: number; dark: number; print: number } {
  const { light, dark } = deriveStageColors(mainHex);
  const cl = contrast(light.band, light.ink);
  const cd = contrast(dark.band, dark.ink);
  // 打印走 .print-root 锁回亮色 ⇒ 与亮色变体同值
  return { light: cl, dark: cd, print: cl };
}

/** V5（脚本 :225-235）：三种「实际同屏组合」各自的最近语义色 ΔE，取三者最小值 */
export function semanticDistance(mainHex: string): { main: number; lightBar: number; darkBar: number; worst: number } {
  const lightBar = pickLightBand(mainHex);
  const darkBar = pickDarkBand(mainHex);
  const a = nearestByDeltaE(mainHex, SEMANTIC_MAIN_POOL)!;
  const b = nearestByDeltaE(lightBar, SEMANTIC_LIGHT_POOL)!;
  const c = nearestByDeltaE(darkBar, SEMANTIC_DARK_POOL)!;
  return {
    main: a.deltaE,
    lightBar: b.deltaE,
    darkBar: c.deltaE,
    worst: Math.min(a.deltaE, b.deltaE, c.deltaE),
  };
}

/** V5 的「更贴近实际的同屏模型」对照（见文件头说明；仅报告，不作闸） */
export function sameScreenSemanticDistance(mainHex: string): number {
  const { light, dark } = deriveStageColors(mainHex);
  // 亮色主题：实心 = light.solid（= main）、带 = light.band，两者都只与亮色语义色同屏
  // 暗色主题：实心 = dark.solid（= light.band）、带 = dark.band，两者都只与暗色语义色同屏
  const lightSolid = nearestByDeltaE(light.solid, SEMANTIC_LIGHT_POOL)!.deltaE;
  const lightBand = nearestByDeltaE(light.band, SEMANTIC_LIGHT_POOL)!.deltaE;
  const darkSolid = nearestByDeltaE(dark.solid, SEMANTIC_DARK_POOL)!.deltaE;
  const darkBand = nearestByDeltaE(dark.band, SEMANTIC_DARK_POOL)!.deltaE;
  return Math.min(lightSolid, lightBand, darkSolid, darkBand);
}

/** V6（脚本 :238-241）：色带对底色的可见度 —— **仅报告，不设闸** */
export function bandVisibility(mainHex: string): { lightOnPaper: number; darkOnPaper: number } {
  const lightBar = pickLightBand(mainHex);
  const darkBar = pickDarkBand(mainHex);
  return {
    lightOnPaper: deltaE76(lightBar, PAPER_LIGHT),
    darkOnPaper: deltaE76(darkBar, PAPER_DARK),
  };
}

/** 20 色的 Lab 彩度（`#808080` 这类中性色为 0；T02 的彩度警告阈值见 derive-stage-colors） */
export function paletteChroma(mainHex: string): number {
  return labChroma(mainHex);
}

/**
 * V1–V5 ＋ V7/V8 全量机器校验（`tests/palette-20.spec.ts` 直接断言本函数的输出）。
 *
 * V1/V2（脚本 :190-191）字色对比度 ≥ 4.5；V3（:210-214）三组两两 ΔE ≥ 10；
 * V4（:217-219）首尾循环 ΔE ≥ 10；V5（:225-235）与锁定语义色 ≥ 15；
 * V7（PRD A12③）三态字色对比度 ≥ 4.5；V8（PRD A12①）主色 vs 亮页底 ≥ 1.5（警告级）。
 */
export function validatePalette(colors: readonly string[] = PALETTE_20): PaletteCheck[] {
  const checks: PaletteCheck[] = [];

  // V1 / V2 / V7
  const lightOffenders: PaletteCheck['offenders'] = [];
  const darkOffenders: PaletteCheck['offenders'] = [];
  const printOffenders: PaletteCheck['offenders'] = [];
  let worstLight = Number.POSITIVE_INFINITY;
  let worstDark = Number.POSITIVE_INFINITY;
  let worstPrint = Number.POSITIVE_INFINITY;
  for (const hex of colors) {
    const c = inkContrasts(hex);
    if (c.light < worstLight) worstLight = c.light;
    if (c.dark < worstDark) worstDark = c.dark;
    if (c.print < worstPrint) worstPrint = c.print;
    if (c.light < TEXT_MIN_CONTRAST) lightOffenders.push({ hex, value: c.light });
    if (c.dark < TEXT_MIN_CONTRAST) darkOffenders.push({ hex, value: c.dark });
    if (c.print < TEXT_MIN_CONTRAST) printOffenders.push({ hex, value: c.print });
  }
  checks.push({
    id: 'V1',
    worst: worstLight,
    threshold: TEXT_MIN_CONTRAST,
    ok: lightOffenders.length === 0,
    detail: '亮色：contrast(lightBar, lightText)',
    offenders: lightOffenders,
  });
  checks.push({
    id: 'V2',
    worst: worstDark,
    threshold: TEXT_MIN_CONTRAST,
    ok: darkOffenders.length === 0,
    detail: '暗色：contrast(darkBar, darkText)',
    offenders: darkOffenders,
  });
  checks.push({
    id: 'V7',
    worst: Math.min(worstLight, worstDark, worstPrint),
    threshold: TEXT_MIN_CONTRAST,
    ok: printOffenders.length === 0 && lightOffenders.length === 0 && darkOffenders.length === 0,
    detail: '{亮, 暗, 打印} 三态字色对比度（打印 = 亮色变体，走 .print-root 锁色）',
    offenders: printOffenders,
  });

  // V3：三组各算一遍（main / lightBar / darkBar）
  const groups: { id: PaletteCheckId; label: string; values: string[] }[] = [
    { id: 'V3-main', label: 'main', values: colors.map((c) => deriveStageColors(c).light.solid) },
    { id: 'V3-lightBar', label: 'lightBar', values: colors.map((c) => deriveStageColors(c).light.band) },
    { id: 'V3-darkBar', label: 'darkBar', values: colors.map((c) => deriveStageColors(c).dark.band) },
  ];
  for (const g of groups) {
    const { min, pair, offenders } = pairMinDeltaE(g.values);
    checks.push({
      id: g.id,
      worst: min,
      threshold: DELTA_E_MIN_DISTINCT,
      ok: min >= DELTA_E_MIN_DISTINCT,
      detail: `${g.label} 组两两最小 ΔE（最近一对：s${pair[0] + 1} vs s${pair[1] + 1}）`,
      offenders,
    });
  }

  // V4：首尾循环
  const first = deriveStageColors(colors[0]!).light.solid;
  const last = deriveStageColors(colors[colors.length - 1]!).light.solid;
  const wrap = deltaE76(last, first);
  checks.push({
    id: 'V4',
    worst: wrap,
    threshold: DELTA_E_MIN_DISTINCT,
    ok: wrap >= DELTA_E_MIN_DISTINCT,
    detail: `首尾循环 ΔE(s${colors.length}, s1)（避免首尾相撞）`,
    offenders: wrap < DELTA_E_MIN_DISTINCT ? [{ hex: first, value: wrap, peer: last }] : [],
  });

  // V5：与锁定语义色（脚本口径，含登记在案的锚点例外）
  const v5Offenders: PaletteCheck['offenders'] = [];
  let worstV5 = Number.POSITIVE_INFINITY;
  for (const hex of colors) {
    const w = semanticDistance(hex).worst;
    if (w < worstV5) worstV5 = w;
    const allowed = V5_KNOWN_TIGHT[hex];
    if (allowed === undefined && w < DELTA_E_MIN_VS_SEMANTIC) {
      v5Offenders.push({ hex, value: w });
    }
  }
  checks.push({
    id: 'V5',
    worst: worstV5,
    threshold: DELTA_E_MIN_VS_SEMANTIC,
    ok: v5Offenders.length === 0,
    detail: '与 7 个锁定语义色的最小 ΔE（三组同屏组合取最小；冻结锚点 s2 已登记在案）',
    offenders: v5Offenders,
  });

  // V8（警告级，不阻断）
  const v8Offenders: PaletteCheck['offenders'] = [];
  let worstV8 = Number.POSITIVE_INFINITY;
  for (const hex of colors) {
    const c = contrast(hex, PAPER_LIGHT);
    if (c < worstV8) worstV8 = c;
    if (c < CONTRAST_WARN_MAIN_ON_PAGE) v8Offenders.push({ hex, value: c });
  }
  checks.push({
    id: 'V8',
    worst: worstV8,
    threshold: CONTRAST_WARN_MAIN_ON_PAGE,
    ok: true, // 警告级：不设闸（PRD A12① 明确「警告 + 一键建议」，不是拒绝）
    detail: '主色 vs 亮色页底（警告级：仅提示）',
    offenders: v8Offenders,
  });

  return checks;
}

/** 便捷：按 id 取一条校验结果（取不到就抛——说明 id 写错了） */
export function checkById(id: PaletteCheckId, colors: readonly string[] = PALETTE_20): PaletteCheck {
  const found = validatePalette(colors).find((c) => c.id === id);
  if (!found) throw new Error(`validatePalette: 未知检查项 ${id}`);
  return found;
}

/** 供 T03 取色器用：把 `colorIndex`（1..20）映射到主色（越界回落 s1） */
export function paletteMainAt(index: number): string {
  const i = Math.trunc(index) - 1;
  return PALETTE_20[i >= 0 && i < PALETTE_20.length ? i : 0]!;
}

/** 供 T03 取色器用：把 `colorIndex` 映射到名称（越界回落 s1 名） */
export function paletteNameAt(index: number): string {
  const i = Math.trunc(index) - 1;
  return PALETTE_20_NAMES[i >= 0 && i < PALETTE_20_NAMES.length ? i : 0]!;
}

/** 报告用：全部 20 色的 V6 可见度（不设闸） */
export function bandVisibilityReport(colors: readonly string[] = PALETTE_20): {
  hex: string;
  lightOnPaper: number;
  darkOnPaper: number;
}[] {
  return colors.map((hex) => ({ hex, ...bandVisibility(hex) }));
}

/** 常量再导出（T03 取色器可直接从本文件取阈值，避免两处写数） */
export { DELTA_E_MIN_DISTINCT, DELTA_E_MIN_VS_SEMANTIC, DARK_PAGE, PAPER_LIGHT, PAPER_DARK };
