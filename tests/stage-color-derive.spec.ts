/**
 * T02 · 阶段配色派生引擎 —— **byte-exact 回归**（v0.8 · P0 · 本轮最高风险模块）。
 *
 * ══════════════════════════════ 本文件为什么长这样 ══════════════════════════════
 *
 * 阶段色是「设计令牌 → SVG/内联 style → 月历/时间轴/打印稿」的**唯一数值来源**。
 * 它一旦漂移，症状是**视觉的、跨页面的、且构建期无感的**（不报错、tsc 不拦、
 * jsdom 也看不出来）——正是 BUG-04/BUG-05 那一类。所以本 spec 的存在意义不是
 * 「测一遍能跑」，而是**把 9 个冻结锚点逐字节锁死**，让任何"顺手优化"当场变红。
 *
 * ── 期望值从哪来（这是本 spec 的关键纪律）──
 *   期望值**不是**从被测代码里现算出来的（那就是自证），而是由
 *   **权威生成器** `tmp/build_palette2.py` 直接产出后固化到本文件的常量里：
 *     · `ANCHOR_45` —— 9 个现网锚点 × 5 个令牌（main / lightBar / lightText / darkBar / darkText）
 *     · `EXTRA_10`  —— 10 个边界色 / 任意色，用来覆盖锚点之外的代码路径
 *   导出脚本（试算用，不入库）：`tmp/scratch_t02/emit_gt.py`。
 *   本次对账结论：TS 实现与生成器在 **20/20 个颜色**（9 锚点 + 11 新增）的
 *   三组令牌、亮/暗字色对比度、V5 语义色距离、Lab 彩度上**全部逐字节相等**。
 *
 * ── 覆盖的规则（编号同设计 §2.4.1）──
 *   R0 常量 · R2 亮带搜索 · R3 亮色选字 · R4 暗底色复用 · R5 暗带 · R6 暗色选字
 *   R8 色卡字色 · E1 暗带回退（**生成器没有的扩展**，只在本文件用依赖注入验证）
 *   ＋ meta.rule **反漂移守卫**（`palette2.json` 的规则字符串是已知漂移源）
 *   ＋ 源头守卫（零 hex 泄漏 / 零动态类名 / 反漂移）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  contrast,
  deltaE76,
  hexToRgb,
  labChroma,
  lin,
  lstar,
  mix,
  nearestByDeltaE,
  normalizeHex,
  relativeLuminance,
  rgbToHex,
  rgbTripletString,
  roundHalfToEven,
  scale,
  toLab,
  tryParseHex,
} from '../src/core/color/contrast';
import {
  CONTRAST_WARN_MAIN_ON_PAGE,
  DARK_BAND_FALLBACK_SEARCH,
  DARK_BAND_KEEP_AT_OR_ABOVE,
  DARK_BAND_MIX_T,
  DARK_BAND_NEAR_THRESHOLD,
  DARK_PAGE,
  DELTA_E_MIN_DISTINCT,
  DELTA_E_MIN_VS_SEMANTIC,
  INK,
  LIGHT_BAND_KEEP_ABOVE,
  LIGHT_BAND_SEARCH,
  NEUTRAL_CHROMA_MIN,
  PAPER_DARK,
  PAPER_LIGHT,
  SUGGEST_CHROMA_ANCHOR,
  SUGGEST_FALLBACK,
  TEXT_MIN_CONTRAST,
  chooseText,
  chooseTextDark,
  deriveAndValidate,
  deriveStageColors,
  nearestExistingStageColor,
  pickDarkBand,
  pickLightBand,
  pickSwatchInk,
  reportBandVisibility,
  resolveDarkBand,
  suggestAccessibleMain,
  type DeriveWarningCode,
} from '../src/core/color/derive-stage-colors';
import { ADDED_11, ANCHOR_9, PALETTE_20 } from '../src/core/color/palette-20';

/* ══════════════════════════════════════════════════════════════════════════════
 * 权威期望值（由 tmp/scratch_t02/emit_gt.py 从 build_palette2.py 导出，勿手改）
 * ══════════════════════════════════════════════════════════════════════════════ */

interface AnchorRow {
  /** 主色（= 亮色实心块 light.solid） */
  readonly main: string;
  /** 亮色宽面色带 light.band（= 暗色实心块 dark.solid，R4） */
  readonly lightBar: string;
  /** 亮色面内字 light.ink */
  readonly lightText: string;
  /** 暗色宽面色带 dark.band */
  readonly darkBar: string;
  /** 暗色面内字 dark.ink */
  readonly darkText: string;
  /** contrast(lightBar, lightText)，生成器口径，4 位小数 */
  readonly cl: number;
  /** contrast(darkBar, darkText)，生成器口径，4 位小数 */
  readonly cd: number;
  /** CIE L*（R2/R5 阈值所用口径） */
  readonly lst: number;
  /** Lab 彩度 C*（T02 中性色判定所用口径） */
  readonly chroma: number;
}

/**
 * ★ 45 条 byte-exact 断言的数据源 = 现网 v0.7 九色锚点。
 * 逐字节不得改：这 9 个值就是 `src/styles/global.css:115-161 / :331-377` 里
 * `--stage-sN / --stage-band-sN / --stage-ink-sN` 的现行取值。
 */
const ANCHOR_45: readonly AnchorRow[] = [
  { main: '#215452', lightBar: '#648786', lightText: '#071212', darkBar: '#172E30', darkText: '#FFFFFF', cl: 4.8463, cd: 14.2866, lst: 32.4209, chroma: 17.8908 },
  { main: '#2E86F0', lightBar: '#62A4F4', lightText: '#0A1D35', darkBar: '#1C4372', darkText: '#FFFFFF', cl: 6.5608, cd: 10.0228, lst: 56.0099, chroma: 61.6159 },
  { main: '#99B7FC', lightBar: '#B2C9FD', lightText: '#222837', darkBar: '#99B7FC', darkText: '#111318', cl: 8.8778, cd: 9.3203, lst: 74.6148, chroma: 37.9609 },
  { main: '#8CC63E', lightBar: '#A9D46E', lightText: '#1F2C0E', darkBar: '#8CC63E', darkText: '#111318', cl: 8.6531, cd: 9.0803, lst: 73.7472, chroma: 71.2536 },
  { main: '#E0FFB7', lightBar: '#E0FFB7', lightText: '#313828', darkBar: '#E0FFB7', darkText: '#111318', cl: 11.0934, cd: 16.9507, lst: 96.3219, chroma: 38.1747 },
  { main: '#FFD16B', lightBar: '#FFD16B', lightText: '#382E18', darkBar: '#FFD16B', darkText: '#111318', cl: 9.2769, cd: 12.9047, lst: 85.9677, chroma: 56.0350 },
  { main: '#FFF2D6', lightBar: '#FFF2D6', lightText: '#38352F', darkBar: '#FFF2D6', darkText: '#111318', cl: 11.0122, cd: 16.7442, lst: 95.8386, chroma: 15.0805 },
  { main: '#FF6D47', lightBar: '#FF9275', lightText: '#381810', darkBar: '#74382B', darkText: '#FFFFFF', cl: 7.3647, cd: 8.9623, lst: 63.8783, chroma: 72.0139 },
  { main: '#6F3432', lightBar: '#936765', lightText: '#FFFFFF', darkBar: '#372022', darkText: '#FFFFFF', cl: 4.8070, cd: 15.0846, lst: 29.5778, chroma: 29.2171 },
];

/**
 * 第二组 byte-exact：**边界色 / 任意色**。
 * 锚点只覆盖 9 个精选色，而用户可任选主色 —— 这 10 个用来覆盖
 * 「L* > 80 保持原色」、纯黑、纯白、中性灰、纯色相、含 3 位简写的输入等分支。
 */
const EXTRA_10: readonly AnchorRow[] = [
  { main: '#FFFFFF', lightBar: '#FFFFFF', lightText: '#383838', darkBar: '#FFFFFF', darkText: '#111318', cl: 11.7258, cd: 18.5812, lst: 100.0000, chroma: 0.0117 },
  { main: '#000000', lightBar: '#404040', lightText: '#FFFFFF', darkBar: '#090A0D', darkText: '#FFFFFF', cl: 10.3684, cd: 19.7956, lst: 0.0000, chroma: 0.0000 },
  { main: '#808080', lightBar: '#A0A0A0', lightText: '#1C1C1C', darkBar: '#3E4043', darkText: '#FFFFFF', cl: 6.5171, cd: 10.4000, lst: 53.5850, chroma: 0.0070 },
  { main: '#FF0000', lightBar: '#FF4040', lightText: '#380000', darkBar: '#740A0D', darkText: '#FFFFFF', cl: 5.1872, cd: 11.7199, lst: 53.2329, chroma: 104.5755 },
  { main: '#00FF00', lightBar: '#00FF00', lightText: '#003800', darkBar: '#00FF00', darkText: '#111318', cl: 9.7747, cd: 13.5413, lst: 87.7370, chroma: 119.7785 },
  { main: '#0000FF', lightBar: '#4040FF', lightText: '#FFFFFF', darkBar: '#090A78', darkText: '#FFFFFF', cl: 6.1849, cd: 15.8342, lst: 32.3026, chroma: 133.8159 },
  { main: '#2F6F8F', lightBar: '#6393AB', lightText: '#0A181F', darkBar: '#1C3949', darkText: '#FFFFFF', cl: 5.4086, cd: 12.1329, lst: 44.1703, chroma: 25.4956 },
  { main: '#123456', lightBar: '#4D6780', lightText: '#FFFFFF', darkBar: '#102031', darkText: '#FFFFFF', cl: 5.8867, cd: 16.4966, lst: 21.0431, chroma: 24.1280 },
  { main: '#ABCDEF', lightBar: '#ABCDEF', lightText: '#262D35', darkBar: '#ABCDEF', darkText: '#111318', cl: 8.4222, cd: 11.2465, lst: 81.0450, chroma: 20.7760 },
  { main: '#7F7F7F', lightBar: '#9F9F9F', lightText: '#1C1C1C', darkBar: '#3E4043', darkText: '#FFFFFF', cl: 6.4387, cd: 10.4000, lst: 53.1928, chroma: 0.0070 },
];

/** 每个锚点断言的令牌条数（5）—— 45 = 9 × 5，本 spec 的「45 条」由此而来 */
const TOKENS_PER_ANCHOR = 5;

const REPO_ROOT = resolve(__dirname, '..');

/** 去掉 `//` 与 `/* *\/` 注释（守卫要在"代码"上做，不能在注释上做） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readSrc(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

/** 给定选字偏好序，返回「首个达标者」，全不达标则返回对比度最高者（脚本口径） */
function firstPassingElseArgmax(band: string, order: readonly string[]): string {
  let best = order[0]!;
  let bestValue = -1;
  for (const candidate of order) {
    const value = contrast(band, candidate);
    if (value > bestValue) {
      best = candidate;
      bestValue = value;
    }
    if (value >= TEXT_MIN_CONTRAST) return candidate;
  }
  return best;
}

/** 纯 argmax（用于反证「首个达标者胜」不是 argmax） */
function argmax(band: string, order: readonly string[]): string {
  return order.reduce((a, b) => (contrast(band, b) > contrast(band, a) ? b : a), order[0]!);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * A · 45 条 byte-exact 锚点（前 9 色）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-A · 45 条 byte-exact 锚点（现网 v0.7 九色，逐字节锁定）', () => {
  it('A-00 · 表规模自检：9 锚点 × 5 令牌 = 45 条断言', () => {
    expect(ANCHOR_45).toHaveLength(9);
    expect(ANCHOR_45.length * TOKENS_PER_ANCHOR).toBe(45);
  });

  it.each(ANCHOR_45)('A · $main 的 5 个令牌逐字节相等', (row) => {
    const { light, dark } = deriveStageColors(row.main);

    // 锚点主色本身也必须归一化后逐字节相等（防"大小写/简写"造成的隐式漂移）
    expect(light.solid).toBe(row.main);
    expect(light.band).toBe(row.lightBar);
    expect(light.ink).toBe(row.lightText);
    expect(dark.band).toBe(row.darkBar);
    expect(dark.ink).toBe(row.darkText);
  });

  it.each(ANCHOR_45)('A · $main 的亮/暗对比度与生成器 4 位小数一致', (row) => {
    const { light, dark } = deriveStageColors(row.main);
    expect(contrast(light.band, light.ink)).toBeCloseTo(row.cl, 4);
    expect(contrast(dark.band, dark.ink)).toBeCloseTo(row.cd, 4);
  });

  it.each(ANCHOR_45)('A · $main 的 inkRgb 三元组可用于 rgb(var()/α) 描边', (row) => {
    const { light, dark } = deriveStageColors(row.main);
    expect(light.inkRgb).toBe(rgbTripletString(row.lightText));
    expect(dark.inkRgb).toBe(rgbTripletString(row.darkText));
    // 三元组必须是 3 个 0-255 的十进制整数（BUG-04 的发丝描边靠它注入 alpha）
    for (const triplet of [light.inkRgb, dark.inkRgb]) {
      expect(triplet).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      expect(triplet.split(' ').map(Number).every((v) => v >= 0 && v <= 255)).toBe(true);
    }
  });

  it('A-10 · ★ R4：暗色实心块 === 亮色宽面，逐字节相等', () => {
    for (const row of ANCHOR_45) {
      const { light, dark } = deriveStageColors(row.main);
      // 暗底上 main 太深会糊进背景 —— 故暗色实心块复用亮色宽面值（R4）
      expect(dark.solid).toBe(light.band);
      expect(dark.solid).toBe(row.lightBar);
    }
  });

  it('A-11 · 前 9 色 === ANCHOR_9 冻结清单，且 === PALETTE_20 的前 9 项', () => {
    expect(ANCHOR_9).toEqual([
      '#215452', '#2E86F0', '#99B7FC', '#8CC63E', '#E0FFB7', '#FFD16B', '#FFF2D6', '#FF6D47', '#6F3432',
    ]);
    expect(PALETTE_20.slice(0, 9)).toEqual([...ANCHOR_9]);
    expect(ANCHOR_45.map((r) => r.main)).toEqual([...ANCHOR_9]);
  });

  it('A-12 · L* 与 C* 与生成器一致（R2/R5 阈值口径 + 中性色判定口径）', () => {
    for (const row of ANCHOR_45) {
      expect(lstar(row.main)).toBeCloseTo(row.lst, 3);
      expect(labChroma(row.main)).toBeCloseTo(row.chroma, 3);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * B · 第二组 byte-exact：边界色 / 任意色
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-B · 第二组 byte-exact：边界色与任意主色（期望值同源于生成器）', () => {
  it.each(EXTRA_10)('B · $main 三组令牌逐字节相等', (row) => {
    const { light, dark } = deriveStageColors(row.main);
    expect(light.solid).toBe(row.main);
    expect(light.band).toBe(row.lightBar);
    expect(light.ink).toBe(row.lightText);
    expect(dark.band).toBe(row.darkBar);
    expect(dark.ink).toBe(row.darkText);
  });

  it.each(EXTRA_10)('B · $main 亮/暗对比度与生成器一致', (row) => {
    const { light, dark } = deriveStageColors(row.main);
    expect(contrast(light.band, light.ink)).toBeCloseTo(row.cl, 4);
    expect(contrast(dark.band, dark.ink)).toBeCloseTo(row.cd, 4);
  });

  it('B-10 · 「L* > 80 保持原色」的边界：纯白/纯绿/浅蓝/米色都保持主色', () => {
    for (const main of ['#FFFFFF', '#E0FFB7', '#FFF2D6', '#FFD16B', '#00FF00', '#ABCDEF']) {
      expect(lstar(main)).toBeGreaterThan(LIGHT_BAND_KEEP_ABOVE);
      expect(pickLightBand(main)).toBe(main);
    }
    // 反证：L* 恰好低于阈值的颜色**必须**被叠白（否则上面那条断言可能是"永远返回原色"）
    expect(lstar('#99B7FC')).toBeLessThan(LIGHT_BAND_KEEP_ABOVE);
    expect(pickLightBand('#99B7FC')).toBe('#B2C9FD');
  });

  it('B-11 · 任意主色 × 两面令牌：对比度硬闸（PRD A12③）在锚点之外同样成立', () => {
    // 20 色板全体：亮/暗两面都必须压得住字
    for (const main of PALETTE_20) {
      const { light, dark } = deriveStageColors(main);
      expect(contrast(light.band, light.ink)).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
      expect(contrast(dark.band, dark.ink)).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
    }
  });

  it('B-12 · 粗网格扫描：派生永不抛异常，且两面字色对比度均 ≥ 4.5', () => {
    const failures: string[] = [];
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
          const { light, dark } = deriveStageColors(hex);
          if (contrast(light.band, light.ink) < TEXT_MIN_CONTRAST) failures.push(`${hex} light`);
          if (contrast(dark.band, dark.ink) < TEXT_MIN_CONTRAST) failures.push(`${hex} dark`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * C · Python round() 语义 —— s1 落在 t=0.30 的**根因**
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-C · Python round() 语义（四舍六入五取偶）—— 被锚点锁死的取整方式', () => {
  it('C-00 · roundHalfToEven 与 Python round() 逐例一致', () => {
    // Python: round(0.5)=0, round(1.5)=2, round(2.5)=2, round(88.5)=88, round(126.75)=127
    expect(roundHalfToEven(0.5)).toBe(0);
    expect(roundHalfToEven(1.5)).toBe(2);
    expect(roundHalfToEven(2.5)).toBe(2);
    expect(roundHalfToEven(3.5)).toBe(4);
    expect(roundHalfToEven(88.5)).toBe(88);
    expect(roundHalfToEven(126.75)).toBe(127);
    expect(roundHalfToEven(125.25)).toBe(125);
    expect(roundHalfToEven(-0.5)).toBe(0);
    expect(Number.isFinite(roundHalfToEven(Number.NaN))).toBe(true);
  });

  it('C-01 · ★ mix("#215452","#FFFFFF",0.25) === "#587F7D"（Math.round 会给 #597F7D）', () => {
    const pythonLike = mix('#215452', '#FFFFFF', 0.25);
    expect(pythonLike).toBe('#587F7D');

    // 反证：若用 Math.round 实现同一公式，结果会不同 —— 而这正是 s1 亮带会漂移的那一档
    const rgb = hexToRgb('#215452');
    const naive = rgbToHex(rgb.map((v) => Math.round(v * 0.75 + 255 * 0.25)));
    expect(naive).toBe('#597F7D');
    expect(naive).not.toBe(pythonLike);
  });

  it('C-02 · 该档（t=0.25）的最优字色对比度 4.4618 < 4.5 ⇒ 被 R2 拒收', () => {
    const band = mix('#215452', '#FFFFFF', 0.25);
    expect(band).toBe('#587F7D');
    const ink = chooseText(band, '#215452');
    expect(ink).toBe('#050C0B');
    expect(contrast(band, ink)).toBeCloseTo(4.4618, 4);
    expect(contrast(band, ink)).toBeLessThan(TEXT_MIN_CONTRAST);
  });

  it('C-03 · 于是落到 t=0.30：mix 得 #648786、字色 #071212、对比度 4.8463 ≥ 4.5', () => {
    expect(mix('#215452', '#FFFFFF', 0.3)).toBe('#648786');
    expect(chooseText('#648786', '#215452')).toBe('#071212');
    expect(contrast('#648786', '#071212')).toBeCloseTo(4.8463, 4);
    // s1 是**唯一**触发"搜索到第二档"的锚点 —— 若实现成"一律 25%"，这一条会立刻变红
    expect(pickLightBand('#215452')).toBe('#648786');
    expect(mix('#215452', '#FFFFFF', 0.25)).not.toBe(pickLightBand('#215452'));
  });

  it('C-04 · 其余 8 个锚点都在 t=0.25 即达标（证明"搜索"不是"碰巧落在第二档"）', () => {
    const atFirstTier: string[] = [];
    for (const row of ANCHOR_45) {
      const band = mix(row.main, PAPER_LIGHT, LIGHT_BAND_SEARCH[0]);
      if (contrast(band, chooseText(band, row.main)) >= TEXT_MIN_CONTRAST) {
        atFirstTier.push(row.main);
      }
    }
    // s1 不在其中，其余 8 个全在（s5/s6/s7 走 L*>80 分支，其 band === main）
    expect(atFirstTier).not.toContain('#215452');
    expect(atFirstTier).toHaveLength(8);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * D · R2 亮带（按序搜索）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-D · R2 亮色宽面：按序搜索 9 档，不是"固定 25%"', () => {
  it('D-00 · 常量口径：L*>80 保持原色；搜索序列逐项相等', () => {
    expect(LIGHT_BAND_KEEP_ABOVE).toBe(80);
    expect([...LIGHT_BAND_SEARCH]).toEqual([0.25, 0.3, 0.2, 0.35, 0.15, 0.4, 0.1, 0.45, 0.5]);
    expect(PAPER_LIGHT).toBe('#FFFFFF');
    expect(INK).toBe('#111318');
    expect(TEXT_MIN_CONTRAST).toBe(4.5);
  });

  it('D-01 · 每个锚点的亮带都是搜索序列中「首个达标档」的产物', () => {
    for (const row of ANCHOR_45) {
      if (lstar(row.main) > LIGHT_BAND_KEEP_ABOVE) {
        expect(pickLightBand(row.main)).toBe(row.main);
        continue;
      }
      const expected =
        LIGHT_BAND_SEARCH.map((t) => mix(row.main, PAPER_LIGHT, t)).find(
          (band) => contrast(band, chooseText(band, row.main)) >= TEXT_MIN_CONTRAST,
        ) ?? mix(row.main, PAPER_LIGHT, 0.5);
      expect(pickLightBand(row.main)).toBe(expected);
      expect(pickLightBand(row.main)).toBe(row.lightBar);
    }
  });

  it('D-02 · 亮带字色硬闸：9 锚点 + 20 色板全部 ≥ 4.5', () => {
    for (const main of [...ANCHOR_45.map((r) => r.main), ...PALETTE_20]) {
      const band = pickLightBand(main);
      expect(contrast(band, chooseText(band, main))).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * E · R5 暗带 + meta.rule 反漂移守卫（★ 本任务点名的守卫）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-E · R5 暗色宽面 + meta.rule 反漂移守卫', () => {
  it('E-00 · 常量口径：阈值 70、混色目标 #0F1217、比例 0.58', () => {
    // ⚠️ tmp/palette2.json 的 meta.rule 字符串写的是「L*>88 保持原色否则 15% 叠白」——
    //    那是**已知漂移**，与生成器实际代码不符。以本文件的常量为准。
    expect(DARK_BAND_KEEP_AT_OR_ABOVE).toBe(70);
    expect(DARK_BAND_MIX_T).toBe(0.58);
    expect(DARK_PAGE).toBe('#0F1217');
    // DARK_PAGE 与 PAPER_DARK 是**两个**不同的暗色：#0F1217 是下沉面，PAPER_DARK 是页底
    expect(PAPER_DARK).toBe('#14161C');
    expect(DARK_PAGE).not.toBe(PAPER_DARK);
  });

  it('E-01 · ★ 行为反证（阈值必为 70，不可能是 88）：L* ∈ [70, 88) 的主色保持原色', () => {
    const inBand = ['#8CC63E', '#99B7FC']; // L* = 73.7472 / 74.6148
    for (const main of inBand) {
      expect(lstar(main)).toBeGreaterThanOrEqual(70);
      expect(lstar(main)).toBeLessThan(88);
      // 若阈值是 meta.rule 写的 88，这些色会被压暗成 #xxxx 而**不是**原色
      expect(pickDarkBand(main)).toBe(main);
      expect(pickDarkBand(main)).not.toBe(mix(main, DARK_PAGE, DARK_BAND_MIX_T));
    }
  });

  it('E-02 · ★ 行为反证（比例必为 0.58 压暗，不是 15% 叠白）', () => {
    const main = '#6F3432'; // L* = 29.5778 < 70 ⇒ 走压暗支
    expect(lstar(main)).toBeLessThan(DARK_BAND_KEEP_AT_OR_ABOVE);
    expect(pickDarkBand(main)).toBe('#372022');
    expect(pickDarkBand(main)).toBe(mix(main, DARK_PAGE, DARK_BAND_MIX_T));

    // 反证：meta.rule 的说法会得到完全不同的（更亮的）颜色，与冻结锚点 s9 不符
    const drifted = mix(main, PAPER_LIGHT, 0.15);
    expect(drifted).toBe('#855251');
    expect(drifted).not.toBe(pickDarkBand(main));
    // 而且"叠白"方向本身就是反的：暗带必须比主色**更暗**
    expect(lstar(pickDarkBand(main))).toBeLessThan(lstar(main));
    expect(lstar(drifted)).toBeGreaterThan(lstar(main));
  });

  it('E-03 · ★ 源码守卫：src/core/color/*.ts 中不存在数字字面量 88（去注释后）', () => {
    const dir = resolve(REPO_ROOT, 'src/core/color');
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      const code = stripComments(readFileSync(resolve(dir, file), 'utf8'));
      // \b88\b 只匹配"独立的 88"，不会误伤 0.008856 / 0.08883 这类数值
      if (/\b88\b/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('E-04 · ★ 源码守卫：暗带阈值/比例只有单一出处，且声明值正确', () => {
    const code = stripComments(readSrc('src/core/color/derive-stage-colors.ts'));
    expect(code).toMatch(/DARK_BAND_KEEP_AT_OR_ABOVE\s*=\s*70\b/);
    expect(code).toMatch(/DARK_BAND_MIX_T\s*=\s*0\.58\b/);
    expect(code).toMatch(/DARK_PAGE\s*=\s*'#0F1217'/);
    // pickDarkBand 必须引用这两个常量（而不是内联魔数）
    const body = code.slice(code.indexOf('function pickDarkBand'));
    expect(body.slice(0, body.indexOf('}'))).toMatch(/DARK_BAND_KEEP_AT_OR_ABOVE/);
    expect(body.slice(0, body.indexOf('}'))).toMatch(/DARK_BAND_MIX_T/);
  });

  it('E-05 · 20 色板 + 边界色的暗带都压得住字（≥ 4.5）', () => {
    for (const main of [...PALETTE_20, ...EXTRA_10.map((r) => r.main)]) {
      const band = pickDarkBand(main);
      expect(contrast(band, chooseTextDark(band, main))).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
    }
  });

  it('E-06 · 暗带方向单调性：L* < 70 的主色，暗带必比主色更暗或相等', () => {
    for (const main of PALETTE_20) {
      if (lstar(main) >= DARK_BAND_KEEP_AT_OR_ABOVE) continue;
      expect(lstar(pickDarkBand(main))).toBeLessThanOrEqual(lstar(main));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * F · R3 / R6 选字口径：首个达标者胜（不是 argmax）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-F · R3/R6 选字口径：首个 ≥4.5 者胜，全不达标才取最高者', () => {
  it('F-01 · ★ 反 argmax 证据（s1）：首个达标者 #071212(4.8463) vs argmax #050C0B(5.0304)', () => {
    const main = '#215452';
    const band = '#648786';
    const order = [scale(main, 0.22), scale(main, 0.3), scale(main, 0.38), scale(main, 0.14), INK, PAPER_LIGHT];

    expect(chooseText(band, main)).toBe('#071212');
    expect(contrast(band, '#071212')).toBeCloseTo(4.8463, 4);
    // 偏好序里的第 4 项（scale 0.14）对比度更高，但排在后面 ⇒ 不应被选中
    expect(argmax(band, order)).toBe('#050C0B');
    expect(contrast(band, argmax(band, order))).toBeGreaterThan(contrast(band, chooseText(band, main)));
    expect(chooseText(band, main)).not.toBe(argmax(band, order));
  });

  it('F-02 · R3 在 9 锚点里有 8 个与 argmax 分歧（仅 s9 重合，原因见下）', () => {
    const divergent: string[] = [];
    const same: string[] = [];
    for (const row of ANCHOR_45) {
      const band = row.lightBar;
      const order = [scale(row.main, 0.22), scale(row.main, 0.3), scale(row.main, 0.38), scale(row.main, 0.14), INK, PAPER_LIGHT];
      // 每个锚点都必须等于「首个达标者」口径
      expect(chooseText(band, row.main)).toBe(firstPassingElseArgmax(band, order));
      (chooseText(band, row.main) === argmax(band, order) ? same : divergent).push(row.main);
    }
    // 8/9 与 argmax 分歧 ⇒ 这条口径不是"无关紧要的实现细节"
    expect(divergent).toHaveLength(8);
    // 唯一重合的是 s9：偏好序里**只有最后一项**（白字）达标，故"首个达标者"恰好就是 argmax
    expect(same).toEqual(['#6F3432']);
    const s9order = [scale('#6F3432', 0.22), scale('#6F3432', 0.3), scale('#6F3432', 0.38), scale('#6F3432', 0.14), INK, PAPER_LIGHT];
    const passing = s9order.filter((c) => contrast('#936765', c) >= TEXT_MIN_CONTRAST);
    expect(passing).toEqual(['#FFFFFF']);
  });

  it('F-03 · 全不达标时返回对比度**最高**者（而不是第一项或抛异常）', () => {
    // #787878：白 4.4151 / 近黑 4.2086 / 四个同色相深色 3.07–4.28 —— 六项全部 < 4.5
    const band = '#787878';
    const main = '#787878';
    const order = [scale(main, 0.22), scale(main, 0.3), scale(main, 0.38), scale(main, 0.14), INK, PAPER_LIGHT];
    const contrasts = order.map((c) => contrast(band, c));
    expect(Math.max(...contrasts)).toBeLessThan(TEXT_MIN_CONTRAST);

    const ink = chooseText(band, main);
    expect(ink).toBe('#FFFFFF');
    expect(ink).toBe(argmax(band, order));
    expect(contrast(band, ink)).toBeCloseTo(4.4151, 4);
  });

  it('F-04 · R6 偏好序本身是「对比度递减」，故首个达标者 ≡ argmax（如实记录）', () => {
    // 与 R3 不同：R6 的候选序（白 → 叠白 0.80 → 0.65 → 近黑 → 同色相深色）在暗带上
    // 天然对比度递减，所以两个分支重合。这里把它作为**性质**断言，防止未来被改乱。
    for (const row of ANCHOR_45) {
      const band = row.darkBar;
      const order = [PAPER_LIGHT, mix(row.main, PAPER_LIGHT, 0.8), mix(row.main, PAPER_LIGHT, 0.65), INK, scale(row.main, 0.22)];
      expect(chooseTextDark(band, row.main)).toBe(firstPassingElseArgmax(band, order));
      expect(chooseTextDark(band, row.main)).toBe(argmax(band, order));
      expect(chooseTextDark(band, row.main)).toBe(row.darkText);
    }
  });

  it('F-05 · R8 色卡用字：白与近黑比对比度，大者胜（平手取 INK）', () => {
    for (const row of ANCHOR_45) {
      const swatch = pickSwatchInk(row.main);
      const whiteC = contrast(row.main, PAPER_LIGHT);
      const inkC = contrast(row.main, INK);
      expect(swatch).toBe(whiteC > inkC ? '#FFFFFF' : INK);
    }
    // s4 草绿：白字对比度大于近黑 ⇒ 色卡用白字
    expect(pickSwatchInk('#8CC63E')).toBe('#111318');
    expect(pickSwatchInk('#215452')).toBe('#FFFFFF');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * G · 输入归一化与脏值兜底（边界不崩，PRD A12①）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-G · 输入归一化与脏值兜底（边界色不崩）', () => {
  it('G-01 · 宽松解析：大小写 / 无 # / 前后空白 / 3 位简写', () => {
    expect(normalizeHex('#215452')).toBe('#215452');
    expect(normalizeHex('#21545 2')).toBeNull();
    expect(normalizeHex('215452')).toBe('#215452');
    expect(normalizeHex('  #215452  ')).toBe('#215452');
    expect(normalizeHex('#AbCdEf')).toBe('#ABCDEF');
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(tryParseHex('#abc')).toEqual([170, 187, 204]);
  });

  it('G-02 · 非法输入：宽松入口返回 null，严格入口抛 RangeError', () => {
    for (const bad of ['', '   ', '#12345', '#GGGGGG', 'not-a-color', 'rgb(1,2,3)', '#1234567']) {
      expect(tryParseHex(bad)).toBeNull();
      expect(normalizeHex(bad)).toBeNull();
      expect(() => hexToRgb(bad)).toThrow(RangeError);
    }
    expect(tryParseHex(null)).toBeNull();
    expect(tryParseHex(undefined)).toBeNull();
    expect(tryParseHex(12345)).toBeNull();
  });

  it('G-03 · deriveStageColors 对脏值不抛异常，回落 INK（零值安全）', () => {
    for (const bad of ['', 'not-a-color', '#12345', 'rgb(1,2,3)'] as unknown as string[]) {
      const { light, dark } = deriveStageColors(bad);
      expect(light.solid).toBe(INK);
      expect(light.band).toBe(pickLightBand(INK));
      expect(dark.solid).toBe(light.band);
    }
  });

  it('G-04 · 3 位简写与 6 位展开式派生结果完全相同（幂等归一化）', () => {
    expect(deriveStageColors('#abc')).toEqual(deriveStageColors('#AABBCC'));
    expect(deriveStageColors('  #215452  ')).toEqual(deriveStageColors('#215452'));
    expect(deriveStageColors('215452')).toEqual(deriveStageColors('#215452'));
  });

  it('G-05 · rgbTripletString 与 hexToRgb 一致', () => {
    expect(rgbTripletString('#071212')).toBe('7 18 18');
    expect(rgbTripletString('#FFFFFF')).toBe('255 255 255');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * H · E1 暗带安全网（**生成器没有的扩展**，用依赖注入验证）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-H · E1 暗带回退搜索（脚本无此机制；永不触发但必须存在的安全网）', () => {
  it('H-00 · 常量：递增搜索档 4 档；L* 近阈值窗口 ±5', () => {
    expect([...DARK_BAND_FALLBACK_SEARCH]).toEqual([0.58, 0.65, 0.72, 0.8]);
    expect(DARK_BAND_NEAR_THRESHOLD).toBe(5);
    // 第一档必须等于 R5 原生比例，否则"原生值"与"回退第一档"会各说各话
    expect(DARK_BAND_FALLBACK_SEARCH[0]).toBe(DARK_BAND_MIX_T);
  });

  it('H-01 · 真实色：20 色板 + 边界色全部走「原生第 1 支」，shifted 恒为 false', () => {
    for (const main of [...PALETTE_20, ...EXTRA_10.map((r) => r.main)]) {
      const res = resolveDarkBand(main);
      expect(res.resolved).toBe(true);
      expect(res.shifted).toBe(false);
      expect(res.band).toBe(pickDarkBand(main));
    }
  });

  it('H-02 · 网格穷举：真实色从不触发回退（诚实记录 E1 的可达性）', () => {
    let shifted = 0;
    let unresolved = 0;
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
          const res = resolveDarkBand(hex);
          if (res.shifted) shifted += 1;
          if (!res.resolved) unresolved += 1;
        }
      }
    }
    // 4096 个主色：0 次回退、0 次无解 ⇒ E1 是"永不触发但必须存在"的安全网
    expect(shifted).toBe(0);
    expect(unresolved).toBe(0);
  });

  it('H-03 · 注入「仅第 2 档达标」的选字器 ⇒ 命中 t=0.65 档、shifted=true', () => {
    const main = '#8CC63E'; // L* = 73.7472 ≥ 70 ⇒ 原生暗带 = main 本身
    expect(pickDarkBand(main)).toBe(main);
    const t065 = mix(main, DARK_PAGE, 0.65);
    expect(t065).toBe('#3B5125');
    expect(mix(main, DARK_PAGE, 0.58)).toBe('#445E27');
    expect(mix(main, DARK_PAGE, 0.58)).not.toBe(main); // 0.58 档与原生值不同 ⇒ 会被试到

    const res = resolveDarkBand(main, (band) => (band === t065 ? '#FFFFFF' : band));
    expect(res).toEqual({ band: t065, shifted: true, resolved: true });
    expect(contrast(t065, '#FFFFFF')).toBeCloseTo(8.7879, 4);
  });

  it('H-04 · 注入「必败」选字器 ⇒ 不抛异常、回落原生值、resolved=false', () => {
    const main = '#8CC63E';
    const res = resolveDarkBand(main, (band) => band); // 字色 === 带色 ⇒ 对比度恒为 1
    expect(res).toEqual({ band: pickDarkBand(main), shifted: false, resolved: false });
  });

  it('H-05 · 注入「仅原色达标」的选字器 ⇒ 走第 3 支（保持原色），仅当 L* 距阈值 ≤ 5', () => {
    const near = '#88A3E0'; // L* = 67.1346，|67.1346 - 70| = 2.87 ≤ 5
    expect(lstar(near)).toBeLessThan(DARK_BAND_KEEP_AT_OR_ABOVE);
    expect(Math.abs(lstar(near) - DARK_BAND_KEEP_AT_OR_ABOVE)).toBeLessThanOrEqual(DARK_BAND_NEAR_THRESHOLD);
    const res = resolveDarkBand(near, (band) => (band === near ? INK : band));
    expect(res).toEqual({ band: near, shifted: true, resolved: true });
    expect(contrast(near, INK)).toBeCloseTo(7.3989, 3);

    // 反证：L* 远离阈值的颜色**不**走第 3 支（窗口真的是 ±5，不是"永远兜底保持原色"）
    const far = '#215452'; // L* = 32.4209
    expect(Math.abs(lstar(far) - DARK_BAND_KEEP_AT_OR_ABOVE)).toBeGreaterThan(DARK_BAND_NEAR_THRESHOLD);
    const farRes = resolveDarkBand(far, (band) => (band === far ? INK : band));
    expect(farRes).toEqual({ band: pickDarkBand(far), shifted: false, resolved: false });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * I · deriveAndValidate 警告（4 个码，接口冻结）
 * ══════════════════════════════════════════════════════════════════════════════ */

const WARNING_CODES: readonly DeriveWarningCode[] = [
  'low-page-contrast',
  'low-band-contrast',
  'forced-band-shift',
  'unresolvable',
];

describe('T02-I · deriveAndValidate：不阻断的警告（4 个码，接口冻结）', () => {
  it('I-00 · 常量口径', () => {
    expect(CONTRAST_WARN_MAIN_ON_PAGE).toBe(1.5);
    expect(NEUTRAL_CHROMA_MIN).toBe(6);
    expect(DELTA_E_MIN_DISTINCT).toBe(10);
    expect(DELTA_E_MIN_VS_SEMANTIC).toBe(15);
  });

  it('I-01 · 6 个锚点零警告；浅色锚点（s5/s6/s7）只出 low-page-contrast', () => {
    const withWarnings = new Map<string, string[]>();
    for (const row of ANCHOR_45) {
      const codes = deriveAndValidate(row.main).warnings.map((w) => w.code);
      if (codes.length > 0) withWarnings.set(row.main, codes);
    }
    // 实测：只有三个超浅色在主色 vs 亮页底上提示（1.0934 / 1.4399 / 1.1097 < 1.5）
    expect([...withWarnings.keys()].sort()).toEqual(['#E0FFB7', '#FFD16B', '#FFF2D6']);
    for (const codes of withWarnings.values()) expect(codes).toEqual(['low-page-contrast']);
  });

  it('I-02 · 零彩度主色 ⇒ low-band-contrast（彩度判定），#808080 与 #7F7F7F 都命中', () => {
    for (const gray of ['#FFFFFF', '#000000', '#808080', '#7F7F7F']) {
      expect(labChroma(gray)).toBeLessThan(NEUTRAL_CHROMA_MIN);
      const codes = deriveAndValidate(gray).warnings.map((w) => w.code);
      expect(codes).toContain('low-band-contrast');
    }
    // 反证：有彩度的主色不出这条
    for (const colored of ['#215452', '#2E86F0', '#7E32E2']) {
      expect(labChroma(colored)).toBeGreaterThanOrEqual(NEUTRAL_CHROMA_MIN);
      expect(deriveAndValidate(colored).warnings.map((w) => w.code)).not.toContain('low-band-contrast');
    }
  });

  it('I-03 · 非法主色 ⇒ unresolvable + low-band-contrast，且颜色回落 INK', () => {
    const res = deriveAndValidate('not-a-color');
    expect(res.warnings.map((w) => w.code)).toContain('unresolvable');
    expect(res.warnings.map((w) => w.code)).toContain('low-band-contrast');
    expect(res.colors.light.solid).toBe(INK);
    for (const w of res.warnings) expect(w.message.length).toBeGreaterThan(8);
  });

  it('I-04 · 警告码恒为 4 个之一（穷举网格，接口不漂移）', () => {
    const seen = new Set<string>();
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
          for (const w of deriveAndValidate(hex).warnings) {
            expect(WARNING_CODES).toContain(w.code);
            expect(w.message.length).toBeGreaterThan(8);
            seen.add(w.code);
          }
        }
      }
    }
    // 网格上真实出现过的码不得超出冻结集合（forced-band-shift 实测不出现，但保留在契约里）
    for (const code of seen) expect(WARNING_CODES).toContain(code);
    expect([...seen].sort()).toEqual(['low-band-contrast', 'low-page-contrast'].sort());
  });

  it('I-05 · E1 触发时 deriveAndValidate 会给出 forced-band-shift（通过注入不可达 ⇒ 用常量与文案守卫）', () => {
    // resolveDarkBand 的 shifted 分支在真实色上不可达（H-02 已穷举证明），
    // 因此这里断言"文案与档位一致"这条可机器校验的性质，防止二者脱节。
    const source = stripComments(readSrc('src/core/color/derive-stage-colors.ts'));
    expect(source).toContain('forced-band-shift');
    expect(source).toMatch(/DARK_BAND_FALLBACK_SEARCH\.join\('\/'\)/);
  });

  it('I-06 · suggestAccessibleMain：结果必满足「亮页可见 + 有彩度」；非法输入回落兜底色', () => {
    for (const bad of ['#FFFFFF', '#000000', '#808080', '#7F7F7F', '#FFF2D6', 'not-a-color']) {
      const suggestion = suggestAccessibleMain(bad);
      expect(tryParseHex(suggestion)).not.toBeNull();
      expect(contrast(suggestion, PAPER_LIGHT)).toBeGreaterThanOrEqual(CONTRAST_WARN_MAIN_ON_PAGE);
      expect(labChroma(suggestion)).toBeGreaterThanOrEqual(NEUTRAL_CHROMA_MIN);
    }
    expect(suggestAccessibleMain('not-a-color')).toBe(SUGGEST_FALLBACK);
    // 已合规的主色**不做改动**（建议是"最小改动"，不是"一律改写"）
    expect(suggestAccessibleMain('#215452')).toBe('#215452');
    expect(suggestAccessibleMain('#7E32E2')).toBe('#7E32E2');
  });

  it('I-07 · SUGGEST_CHROMA_ANCHOR === 20 色板中 Lab 彩度最高者（单一出处）', () => {
    const maxChroma = PALETTE_20.reduce((best, hex) =>
      labChroma(hex) > labChroma(best) ? hex : best,
    );
    expect(maxChroma).toBe(SUGGEST_CHROMA_ANCHOR);
    expect(SUGGEST_CHROMA_ANCHOR).toBe('#7E32E2');
    expect(PALETTE_20).toContain(SUGGEST_FALLBACK);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * J · 底层色度学与源头守卫
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-J · 底层色度学口径（与脚本逐行对齐）', () => {
  it('J-01 · lin() 分段点 0.04045 / 12.92（先除 255 再比阈值）', () => {
    expect(lin(10)).toBeCloseTo(10 / 255 / 12.92, 10); // 10/255 = 0.039215 ≤ 0.04045
    expect(lin(11)).toBeCloseTo(((11 / 255 + 0.055) / 1.055) ** 2.4, 10); // 0.043137 > 0.04045
    expect(lin(0)).toBe(0);
    expect(lin(255)).toBeCloseTo(1, 10);
  });

  it('J-02 · 相对亮度取 WCAG 系数（0.2126 / 0.7152 / 0.0722）', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#215452')).toBeCloseTo(
      0.2126 * lin(0x21) + 0.7152 * lin(0x54) + 0.0722 * lin(0x52),
      10,
    );
  });

  it('J-03 · Lab 用 D65 白点（0.95047 / 1 / 1.08883），黑/白落点正确', () => {
    expect(toLab('#000000')[0]).toBeCloseTo(0, 10);
    expect(toLab('#FFFFFF')[0]).toBeCloseTo(100, 6);
    // 灰色 a*/b* ≈ 0
    expect(Math.abs(toLab('#808080')[1])).toBeLessThan(0.5);
    expect(Math.abs(toLab('#808080')[2])).toBeLessThan(0.5);
  });

  it('J-04 · deltaE76 是 CIE76（Lab 欧氏距离），对称且自距为 0', () => {
    expect(deltaE76('#215452', '#215452')).toBe(0);
    expect(deltaE76('#215452', '#2E86F0')).toBeCloseTo(deltaE76('#2E86F0', '#215452'), 10);
    const [l1, a1, b1] = toLab('#215452');
    const [l2, a2, b2] = toLab('#2E86F0');
    expect(deltaE76('#215452', '#2E86F0')).toBeCloseTo(
      Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2),
      10,
    );
  });

  it('J-05 · mix 是 sRGB 逐通道线性插值（两端点 + t=0.5 中点）', () => {
    expect(mix('#215452', '#FFFFFF', 0)).toBe('#215452');
    expect(mix('#215452', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    // 不是 HSL/OKLab 插值：红→绿的中点必须是 #808000 一类"脏黄"，而非饱和黄
    expect(mix('#FF0000', '#00FF00', 0.5)).toBe('#808000');
  });

  it('J-06 · scale 逐通道乘 k 后取整（R3/R6 偏好序的基础）', () => {
    expect(scale('#6F3432', 0.22)).toBe('#180B0B');
    expect(scale('#6F3432', 0.3)).toBe('#21100F');
    expect(scale('#6F3432', 0.38)).toBe('#2A1413');
    expect(scale('#6F3432', 0.14)).toBe('#100707');
  });

  it('J-07 · nearestByDeltaE / nearestExistingStageColor 用于取色“撞色”提示', () => {
    expect(nearestByDeltaE('#215452', [])).toBeNull();
    expect(nearestByDeltaE('#215452', ['#2E86F0', '#215452'])).toEqual({ hex: '#215452', deltaE: 0 });
    expect(nearestExistingStageColor('#215452', ['nope', '#2E86F0'])).toEqual({
      hex: '#2E86F0',
      deltaE: deltaE76('#215452', '#2E86F0'),
    });
    expect(nearestExistingStageColor('#215452', ['nope'])).toBeNull();
  });

  it('J-08 · reportBandVisibility：V6 可见度仅报告，s1 暗带对暗页底本来就很低（BUG-04 的由来）', () => {
    const s1 = reportBandVisibility('#215452');
    expect(s1.main).toBe('#215452');
    expect(s1.lightBandOnPaper).toBeCloseTo(47.9952, 3);
    expect(s1.darkBandOnPaper).toBeCloseTo(13.5061, 3);
    // 远低于"可辨识"直觉值 —— 这正是需要发丝描边（BAND_OUTLINE_ALPHA）的原因
    expect(s1.darkBandOnPaper).toBeLessThan(15);
  });
});

describe('T02-K · 源头守卫（零 hex 泄漏 / 零动态类名 / 通路 B 契约）', () => {
  const COMPONENT_FILES = [
    'src/components/timeline/stageColors.ts',
    'src/components/timeline/stageColorKey.ts',
  ];

  it('K-01 · ★ 组件层零 hex 字面量（去注释后）—— 通路 B 仍只持 var()', () => {
    for (const rel of COMPONENT_FILES) {
      const code = stripComments(readSrc(rel));
      const hexes = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect({ file: rel, hexes }).toEqual({ file: rel, hexes: [] });
    }
  });

  it('K-02 · ★ 组件层不出现动态拼出的 Tailwind 阶段类名（BUG-05 的根因）', () => {
    const DYNAMIC_CLASS = /(bg|text|border|fill|stroke)-stage[a-z0-9-]*\$\{/;

    // 正控：这条正则必须能抓住真实的 BUG-05 形态，否则守卫是"空心的"
    expect('bg-stage-band-s${n}').toMatch(DYNAMIC_CLASS);
    expect('text-stage-ink-s${n}').toMatch(DYNAMIC_CLASS);
    // 反控：`var(--stage-ink-s${idx}-rgb)` 是**变量名**解析（global.css 已定义 9 份），
    //       不是 Tailwind 类名 —— 不得误伤，这是 v0.7 既有的合法机制（BUG-04 的发丝描边）
    expect('rgb(var(--stage-ink-s${idx}-rgb) / 0.3)').not.toMatch(DYNAMIC_CLASS);
    expect('var(--stage-local-solid)').not.toMatch(DYNAMIC_CLASS);

    for (const rel of COMPONENT_FILES) {
      const code = stripComments(readSrc(rel));
      expect({ file: rel, dynamic: DYNAMIC_CLASS.test(code) }).toEqual({ file: rel, dynamic: false });
    }

    // 修复本体必须在：静态镜像表用字面量写出 9 个类名（新增调用点只能索引本表）
    const stageColorsCode = stripComments(readSrc(COMPONENT_FILES[0]!));
    expect(stageColorsCode).toMatch(/1:\s*'bg-stage-s1'/);
    expect(stageColorsCode).toMatch(/1:\s*'bg-stage-band-s1 text-stage-ink-s1'/);
    expect(stageColorsCode).toMatch(/9:\s*'bg-stage-s9'/);
    expect(stageColorsCode).toMatch(/9:\s*'bg-stage-band-s9 text-stage-ink-s9'/);
  });

  it('K-03 · 组件层的三个取色出口在自定义色分支返回 --stage-local-* 变量', () => {
    const code = stripComments(readSrc('src/components/timeline/stageColors.ts'));
    expect(code).toMatch(/STAGE_LOCAL_SOLID_COLOR\s*=\s*`var\(\$\{STAGE_LOCAL_VAR\.solid\}\)`/);
    expect(code).toMatch(/STAGE_LOCAL_BAND_COLOR\s*=\s*`var\(\$\{STAGE_LOCAL_VAR\.band\}\)`/);
    expect(code).toMatch(/STAGE_LOCAL_INK_COLOR\s*=\s*`var\(\$\{STAGE_LOCAL_VAR\.ink\}\)`/);
    // 描边必须走 -rgb 三元组（漏了它 ⇒ 新通路描边静默消失）
    expect(code).toMatch(/STAGE_LOCAL_VAR\.inkRgb/);
  });

  it('K-04 · 通路 B 不新增 Tailwind 类名通路（属性 + CSS 变量，与扫描器解耦）', () => {
    const registry = stripComments(readSrc('src/core/color/custom-color-registry.ts'));
    expect(registry).toMatch(/STAGE_COLOR_KEY_ATTR\s*=\s*'data-stage-key'/);
    // 注册表里不得出现 Tailwind 工具类拼接
    expect(registry).not.toMatch(/bg-stage/);
    expect(registry).not.toMatch(/text-stage/);
  });

  it('K-05 · 派生的唯一出口在 core/color，组件层不重复实现算法', () => {
    const code = stripComments(readSrc('src/components/timeline/stageColors.ts'));
    // 组件层不得自算对比度 / Lab / 混色
    expect(code).not.toMatch(/relativeLuminance|toLab|deltaE76|Math\.sqrt/);
    expect(code).toMatch(/from '\.\.\/\.\.\/core\/color\/custom-color-registry'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * L · 与**冻结的** global.css 逐字节对账（终极口径）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-L · 派生结果 === 冻结的 global.css 令牌（54 个令牌逐字节相等）', () => {
  const CSS_SRC = readSrc('src/styles/global.css');
  const DARK_START = CSS_SRC.indexOf(":root[data-theme='dark'] {");
  /** 亮色段 = `:root, .print-root { … }`（打印锁亮色与亮色同块同值） */
  const LIGHT_SECTION = CSS_SRC.slice(0, DARK_START);
  /** 暗色段（后续 `@media print` 里的 `.print-root` 覆盖块在更后面，故取**首次**出现即暗色块） */
  const DARK_SECTION = CSS_SRC.slice(DARK_START);

  /** 取某段里某变量的**首次**声明值（大写归一化；取不到返回 null） */
  function firstToken(section: string, name: string): string | null {
    const match = section.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
    return match === null ? null : match[1]!.toUpperCase();
  }

  it('L-00 · global.css 结构自检：亮/暗两段都能定位（守卫本身不得空转）', () => {
    expect(DARK_START).toBeGreaterThan(0);
    // 亮色段必须同时含 :root 与 .print-root（打印锁亮色的机制本体）
    expect(LIGHT_SECTION).toContain(':root,');
    expect(LIGHT_SECTION).toContain('.print-root {');
    // 抽样：两段的 s1 必须都取得到，且亮色段首值就是锚点
    expect(firstToken(LIGHT_SECTION, '--stage-s1')).toBe('#215452');
    expect(firstToken(DARK_SECTION, '--stage-s1')).toBe('#648786');
  });

  it('L-01 · ★ 54 个令牌（9 色 × 3 角色 × 亮/暗）与派生结果逐字节相等', () => {
    expect(ANCHOR_45).toHaveLength(9);
    let compared = 0;
    const mismatches: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      const n = i + 1;
      const main = ANCHOR_45[i]!.main;
      const { light, dark } = deriveStageColors(main);
      const pairs: [string, string, string | null][] = [
        ['light.solid', light.solid, firstToken(LIGHT_SECTION, `--stage-s${n}`)],
        ['light.band', light.band, firstToken(LIGHT_SECTION, `--stage-band-s${n}`)],
        ['light.ink', light.ink, firstToken(LIGHT_SECTION, `--stage-ink-s${n}`)],
        ['dark.solid', dark.solid, firstToken(DARK_SECTION, `--stage-s${n}`)],
        ['dark.band', dark.band, firstToken(DARK_SECTION, `--stage-band-s${n}`)],
        ['dark.ink', dark.ink, firstToken(DARK_SECTION, `--stage-ink-s${n}`)],
      ];
      for (const [label, derived, css] of pairs) {
        compared += 1;
        if (css === null || css !== derived.toUpperCase()) {
          mismatches.push(`s${n} ${label}: derived=${derived} css=${String(css)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBe(54);
  });

  it('L-02 · ★ R4 在冻结 CSS 里的直接证据：暗色 `--stage-sN` === 亮色 `--stage-band-sN`', () => {
    for (let n = 1; n <= 9; n += 1) {
      const darkSolid = firstToken(DARK_SECTION, `--stage-s${n}`);
      const lightBand = firstToken(LIGHT_SECTION, `--stage-band-s${n}`);
      const lightSolid = firstToken(LIGHT_SECTION, `--stage-s${n}`);
      expect(darkSolid).toBe(lightBand);

      // 反空转：只有当亮色宽面**确实不同于**主色（即未走 L*>80 分支）时，
      // 才能用"三者互不相等"来证明这条断言不是"两边恰好同值"。
      // s5/s6/s7（L* > 80）的亮色宽面 === 主色，属合法重合，故跳过该子断言。
      if (ANCHOR_45[n - 1]!.lightBar !== ANCHOR_45[n - 1]!.main) {
        expect(darkSolid).not.toBe(lightSolid);
        expect(lightBand).not.toBe(lightSolid);
      } else {
        expect(lightBand).toBe(lightSolid);
      }
    }
    // 实测：9 个锚点里 6 个"暗色实心 ≠ 亮色主色"，3 个（s5/s6/s7）合法重合
    const distinct = ANCHOR_45.filter((r) => r.lightBar !== r.main).length;
    expect(distinct).toBe(6);
  });

  it('L-03 · 打印锁亮色：.print-root 与 :root 同块 ⇒ 打印稿取亮色令牌', () => {
    // global.css 把亮色令牌同时声明在 `:root, .print-root` 上（就近继承压过 <html data-theme>）
    // anchor 换行无关：autocrlf 会把两行在 LF/CRLF 间来回搬（本次实测假红过一次）
    const lightStart = CSS_SRC.search(/:root,\s*\.print-root \{/);
    expect(lightStart).toBeGreaterThan(0);
    expect(lightStart).toBeLessThan(DARK_START);
    // 亮色段内 s1..s9 的 27 个令牌必须齐全（缺一个 ⇒ 打印稿某个阶段会掉色）
    for (let n = 1; n <= 9; n += 1) {
      for (const name of [`--stage-s${n}`, `--stage-band-s${n}`, `--stage-ink-s${n}`]) {
        expect(firstToken(LIGHT_SECTION, name)).not.toBeNull();
        expect(firstToken(DARK_SECTION, name)).not.toBeNull();
      }
    }
  });
});
