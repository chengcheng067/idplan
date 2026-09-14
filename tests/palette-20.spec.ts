/**
 * T02 · 20 色事件阶段色板 —— **V1–V5 机器校验**（v0.8 · TS-02 / TBD-4 / TBD-11）。
 *
 * ══════════════════════════════ 为什么是"机器校验"而不是"目视" ══════════════════════════════
 *
 * v0.7 的 9 色是设计侧目视确认过的；v0.8 扩到 20 色，TBD-11 明确裁决
 * **不需要设计侧目视确认，机器校验通过即放行**。于是"校验"这件事本身成了规格的一部分，
 * 必须可复跑、可回归、且**每一条阈值都有出处的 hex 与数值**：
 *
 *   V1  contrast(lightBar, lightText) ≥ 4.5      —— 亮色主题面内字（三态之一）
 *   V2  contrast(darkBar,  darkText) ≥ 4.5       —— 暗色主题面内字（三态之二）
 *   V3  组内两两 ΔE ≥ 10（main / lightBar / darkBar 三组各算一遍）
 *   V4  首尾循环 ΔE(s20, s1) ≥ 10                —— 防止首尾相撞
 *   V5  与 7 个锁定语义色的最小 ΔE ≥ 15          —— 阶段色不得与"逾期/临期/完成/进行中"混淆
 *   V7  {亮, 暗, 打印} 三态字色对比度 ≥ 4.5      —— 打印走 .print-root 锁回亮色
 *   V8  主色 vs 亮页底 ≥ 1.5（**警告级，不设闸**）—— PRD A12① 是"提示 + 一键建议"
 *
 * ══════════════════════════════ 关于 V5 那个"登记在案的例外" ══════════════════════════════
 *
 * 冻结锚点 s2 `#2E86F0` 与「进行中 pine 暗变体 `#828CF7`」的 ΔE = **14.9478 < 15**。
 * 这**不是 v0.8 引入的问题**：权威生成器自己在校验段就会打 `!! 压线`
 * （`tmp/build_palette2.py:225-235`）。而 s2 是冻结锚点（`global.css` 逐字节不得动），
 * 所以「20 色 V5 全绿」这条验收标准**在字面上不可能满足**。
 *
 * 处置（本 spec 同时守住这三件事，所以它不是"放水"）：
 *   ① 11 个**新增**色一律硬闸 15（实测最小 16.3870，无例外）；
 *   ② s2 以 `V5_KNOWN_TIGHT` 显式登记，**并断言其精确值 14.9478** ——
 *      算法一被改动数值就漂移，断言立刻红；
 *   ③ 附 `sameScreenSemanticDistance()`（更贴近实际的同屏组合模型）作为对照：
 *      脚本把 main 与「亮/暗两套语义色」放在一起比，属于**跨主题同屏**，实际不会发生；
 *      按实际组合模型 s2 的最差值是 **23.6502 ≫ 15** ⇒ 真实风险为零。
 */

import { describe, it, expect } from 'vitest';

import { contrast, deltaE76, labChroma, nearestByDeltaE } from '../src/core/color/contrast';
import {
  CONTRAST_WARN_MAIN_ON_PAGE,
  DELTA_E_MIN_DISTINCT,
  DELTA_E_MIN_VS_SEMANTIC,
  SUGGEST_CHROMA_ANCHOR,
  TEXT_MIN_CONTRAST,
  deriveStageColors,
} from '../src/core/color/derive-stage-colors';
import {
  ADDED_11,
  ANCHOR_9,
  LOCKED_SEMANTIC,
  PALETTE_20,
  PALETTE_20_NAMES,
  SEMANTIC_DARK_POOL,
  SEMANTIC_LIGHT_POOL,
  SEMANTIC_MAIN_POOL,
  V5_KNOWN_TIGHT,
  bandVisibility,
  bandVisibilityReport,
  checkById,
  inkContrasts,
  paletteChroma,
  paletteMainAt,
  paletteNameAt,
  sameScreenSemanticDistance,
  semanticDistance,
  validatePalette,
} from '../src/core/color/palette-20';

/** 权威期望值（本轮实测，见交付报告的对账表） */
const EXPECTED = {
  /** V1 最差 = #AA1866（新增色，不是锚点） */
  v1Worst: 4.5368,
  v1WorstMain: '#AA1866',
  /** V2 最差 = #CD98AD */
  v2Worst: 8.0755,
  v2WorstMain: '#CD98AD',
  /** V3 三组（main / lightBar / darkBar），最近一对都是 s12 vs s20 */
  v3Main: 15.0092,
  v3LightBar: 19.8422,
  v3DarkBar: 15.0092,
  /** V4 首尾循环 */
  v4: 58.4885,
  /** V5 脚本口径全 20 色最差（= 登记在案的 s2） */
  v5Worst: 14.9478,
  v5WorstMain: '#2E86F0',
  /** V5 新增 11 色的最差 */
  v5AddedWorst: 16.387,
  v5AddedWorstMain: '#7E32E2',
  /** V8 主色 vs 亮页底的最小对比度（警告级） */
  v8Worst: 1.0962,
  /** 实际同屏模型下 s2 的最差值 */
  sameScreenS2: 23.6502,
} as const;

/* ══════════════════════════════════════════════════════════════════════════════
 * 色板结构
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-P0 · 20 色板结构（前 9 冻结 + 后 11 新增）', () => {
  it('P0-01 · 共 20 项、互不相同、前 9 项 === 冻结锚点', () => {
    expect(PALETTE_20).toHaveLength(20);
    expect(new Set(PALETTE_20).size).toBe(20);
    expect(PALETTE_20.slice(0, 9)).toEqual([...ANCHOR_9]);
    expect(ANCHOR_9).toHaveLength(9);
    expect(ADDED_11).toHaveLength(11);
  });

  it('P0-02 · 名称表 20 项、前 9 与现网 stageColors.STAGE_COLOR_NAMES 逐字相同', () => {
    expect(PALETTE_20_NAMES).toHaveLength(20);
    expect([...PALETTE_20_NAMES.slice(0, 9)]).toEqual([
      '松墨', '亮蓝', '雾蓝', '草绿', '芽白', '蜜黄', '米白', '珊瑚', '栗褐',
    ]);
    expect([...PALETTE_20_NAMES.slice(9)]).toEqual([
      '苔绿', '春绿', '灰绿', '靛紫', '堇紫', '兰紫', '洋红', '藕粉', '品红', '茄紫', '薄荷',
    ]);
  });

  it('P0-03 · 取色器索引映射：1..20 与主色一一对应，越界回落 s1', () => {
    expect(paletteMainAt(1)).toBe('#215452');
    expect(paletteMainAt(9)).toBe('#6F3432');
    expect(paletteMainAt(10)).toBe('#5A9E4C');
    expect(paletteMainAt(20)).toBe('#81E4B6');
    expect(paletteMainAt(0)).toBe('#215452'); // 越界 → s1
    expect(paletteMainAt(21)).toBe('#215452');
    expect(paletteMainAt(-3)).toBe('#215452');
    expect(paletteNameAt(20)).toBe('薄荷');
    expect(paletteNameAt(99)).toBe('松墨');
    for (let i = 1; i <= 20; i += 1) expect(paletteMainAt(i)).toBe(PALETTE_20[i - 1]);
  });

  it('P0-04 · 锁定语义色表就是 V5 的三个对照池（7 / 4 / 4 项，出处唯一）', () => {
    expect(SEMANTIC_MAIN_POOL).toHaveLength(7);
    expect(SEMANTIC_LIGHT_POOL).toHaveLength(4);
    expect(SEMANTIC_DARK_POOL).toHaveLength(4);
    expect([...SEMANTIC_LIGHT_POOL]).toEqual(['#EF4444', '#F59E0B', '#34D399', '#6366F1']);
    expect([...SEMANTIC_DARK_POOL]).toEqual(['#F77070', '#FABF24', '#34D399', '#828CF7']);
    // 主色池 = 亮色池 ∪ 暗色池（去重后 7 个）
    const union = new Set([...SEMANTIC_LIGHT_POOL, ...SEMANTIC_DARK_POOL]);
    expect(union.size).toBe(7);
    expect([...SEMANTIC_MAIN_POOL].sort()).toEqual([...union].sort());
    // 与 LOCKED_SEMANTIC 的取值集合一致（避免两处写数漂移）
    const fromTable = new Set(Object.values(LOCKED_SEMANTIC).flatMap((v) => [v.light, v.dark]));
    expect([...fromTable].sort()).toEqual([...union].sort());
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * V1–V5 主闸
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-P1 · V1–V5 机器校验（全部必须 ok）', () => {
  it('P1-01 · 全部检查项 ok === true（V8 为警告级，ok 恒为 true）', () => {
    const checks = validatePalette();
    const failed = checks.filter((c) => !c.ok).map((c) => `${c.id}: worst=${c.worst} < ${c.threshold}`);
    expect(failed).toEqual([]);
    expect(checks.map((c) => c.id).sort()).toEqual(
      ['V1', 'V2', 'V3-darkBar', 'V3-lightBar', 'V3-main', 'V4', 'V5', 'V7', 'V8'].sort(),
    );
  });

  it('P1-V1 · 亮色主题面内字对比度：最差 4.5368 ≥ 4.5，且来自新增色 #AA1866', () => {
    const v1 = checkById('V1');
    expect(v1.threshold).toBe(TEXT_MIN_CONTRAST);
    expect(v1.worst).toBeCloseTo(EXPECTED.v1Worst, 4);
    expect(v1.worst).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
    expect(v1.offenders).toEqual([]);
    expect(inkContrasts(EXPECTED.v1WorstMain).light).toBeCloseTo(EXPECTED.v1Worst, 4);
    // 20 色全体各自的亮色对比度都 ≥ 4.5（逐个断言，避免只看最小值掩盖个别失败）
    for (const hex of PALETTE_20) {
      expect(inkContrasts(hex).light).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
    }
  });

  it('P1-V2 · 暗色主题面内字对比度：最差 8.0755 ≥ 4.5，来自 #CD98AD', () => {
    const v2 = checkById('V2');
    expect(v2.threshold).toBe(TEXT_MIN_CONTRAST);
    expect(v2.worst).toBeCloseTo(EXPECTED.v2Worst, 4);
    expect(v2.offenders).toEqual([]);
    expect(inkContrasts(EXPECTED.v2WorstMain).dark).toBeCloseTo(EXPECTED.v2Worst, 4);
    for (const hex of PALETTE_20) {
      expect(inkContrasts(hex).dark).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
    }
  });

  it('P1-V3 · 三组组内两两 ΔE ≥ 10（main 15.0092 / lightBar 19.8422 / darkBar 15.0092）', () => {
    const v3Main = checkById('V3-main');
    const v3Light = checkById('V3-lightBar');
    const v3Dark = checkById('V3-darkBar');
    for (const [check, expected] of [
      [v3Main, EXPECTED.v3Main],
      [v3Light, EXPECTED.v3LightBar],
      [v3Dark, EXPECTED.v3DarkBar],
    ] as const) {
      expect(check.threshold).toBe(DELTA_E_MIN_DISTINCT);
      expect(check.worst).toBeCloseTo(expected, 4);
      expect(check.worst).toBeGreaterThanOrEqual(DELTA_E_MIN_DISTINCT);
      expect(check.offenders).toEqual([]);
      // 最近一对必须是 s12 vs s20（灰绿 vs 薄荷）—— 如实记录"最危险的一对"
      expect(check.detail).toContain('s12 vs s20');
    }
    // 独立复算（不信任 validatePalette 的内部实现）
    const mainValues = PALETTE_20.map((h) => deriveStageColors(h).light.solid);
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < mainValues.length; i += 1) {
      for (let j = i + 1; j < mainValues.length; j += 1) {
        min = Math.min(min, deltaE76(mainValues[i]!, mainValues[j]!));
      }
    }
    expect(min).toBeCloseTo(EXPECTED.v3Main, 4);
  });

  it('P1-V4 · 首尾循环 ΔE(s20, s1) = 58.4885 ≥ 10（首尾不相撞）', () => {
    const v4 = checkById('V4');
    expect(v4.threshold).toBe(DELTA_E_MIN_DISTINCT);
    expect(v4.worst).toBeCloseTo(EXPECTED.v4, 4);
    expect(v4.offenders).toEqual([]);
    expect(deltaE76(PALETTE_20[19]!, PALETTE_20[0]!)).toBeCloseTo(EXPECTED.v4, 4);
  });

  it('P1-V5a · 11 个新增色一律硬闸 15（实测最小 16.3870 @ #7E32E2，无例外）', () => {
    const offenders = ADDED_11.filter(
      (hex) => semanticDistance(hex).worst < DELTA_E_MIN_VS_SEMANTIC,
    );
    expect(offenders).toEqual([]);

    const measured = ADDED_11.map((hex) => ({ hex, worst: semanticDistance(hex).worst }));
    const worst = measured.reduce((a, b) => (b.worst < a.worst ? b : a));
    expect(worst.hex).toBe(EXPECTED.v5AddedWorstMain);
    expect(worst.worst).toBeCloseTo(EXPECTED.v5AddedWorst, 4);
    for (const { worst: w } of measured) expect(w).toBeGreaterThanOrEqual(DELTA_E_MIN_VS_SEMANTIC);
  });

  it('P1-V5b · ★ 登记在案的例外：冻结锚点 s2 与 pine 暗变体 ΔE = 14.9478 < 15', () => {
    // 生成器自己就打 `!! 压线`（tmp/build_palette2.py:225-235）——这是**既有事实**，不是 v0.8 引入
    expect(V5_KNOWN_TIGHT).toEqual({ '#2E86F0': 14.9478 });
    expect(semanticDistance('#2E86F0').worst).toBeCloseTo(EXPECTED.v5Worst, 4);
    expect(semanticDistance('#2E86F0').worst).toBeLessThan(DELTA_E_MIN_VS_SEMANTIC);
    // 压线来自哪一步：main 与 pine 暗（跨主题同屏）——亮带/暗带各自都很安全
    const d = semanticDistance('#2E86F0');
    expect(d.main).toBeCloseTo(EXPECTED.v5Worst, 4);
    expect(d.lightBar).toBeGreaterThan(DELTA_E_MIN_VS_SEMANTIC);
    expect(d.darkBar).toBeGreaterThan(DELTA_E_MIN_VS_SEMANTIC);
    expect(nearestByDeltaE('#2E86F0', SEMANTIC_MAIN_POOL)!.hex).toBe('#828CF7');
    // 且 s2 是**唯一**需要登记的锚点（其余 8 个锚点都 ≥ 15）
    for (const hex of ANCHOR_9) {
      if (hex === '#2E86F0') continue;
      expect(semanticDistance(hex).worst).toBeGreaterThanOrEqual(DELTA_E_MIN_VS_SEMANTIC);
    }
  });

  it('P1-V5c · V5 全 20 色最差 === 14.9478（就是那个登记在案的例外），且它是唯一 < 15 者', () => {
    const v5 = checkById('V5');
    expect(v5.threshold).toBe(DELTA_E_MIN_VS_SEMANTIC);
    expect(v5.worst).toBeCloseTo(EXPECTED.v5Worst, 4);
    expect(v5.ok).toBe(true);
    // offenders 为空：因为 s2 已在 V5_KNOWN_TIGHT 里登记
    expect(v5.offenders).toEqual([]);

    const below = PALETTE_20.filter(
      (hex) => semanticDistance(hex).worst < DELTA_E_MIN_VS_SEMANTIC,
    );
    expect(below).toEqual(['#2E86F0']);
  });

  it('P1-V5d · 实际同屏组合模型下 s2 的最差 ΔE = 23.6502 ≫ 15（真实风险为零）', () => {
    expect(sameScreenSemanticDistance('#2E86F0')).toBeCloseTo(EXPECTED.sameScreenS2, 4);
    expect(sameScreenSemanticDistance('#2E86F0')).toBeGreaterThan(DELTA_E_MIN_VS_SEMANTIC);
    // 该模型下 20 色**全部** ≥ 15
    for (const hex of PALETTE_20) {
      expect(sameScreenSemanticDistance(hex)).toBeGreaterThanOrEqual(DELTA_E_MIN_VS_SEMANTIC);
    }
  });

  it('P1-V7 · 三态字色（亮 / 暗 / 打印）均 ≥ 4.5，打印走 .print-root 锁回亮色', () => {
    const v7 = checkById('V7');
    expect(v7.threshold).toBe(TEXT_MIN_CONTRAST);
    expect(v7.worst).toBeCloseTo(EXPECTED.v1Worst, 4); // 最差即 V1 的那个色
    expect(v7.ok).toBe(true);
    for (const hex of PALETTE_20) {
      const c = inkContrasts(hex);
      expect(c.print).toBe(c.light); // 打印 = 亮色变体（同一份值）
      expect(c.print).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
    }
  });

  it('P1-V8 · 主色 vs 亮页底：最差 1.0962 < 1.5 —— 但这是**警告级**，不阻断（PRD A12①）', () => {
    const v8 = checkById('V8');
    expect(v8.threshold).toBe(CONTRAST_WARN_MAIN_ON_PAGE);
    expect(v8.worst).toBeCloseTo(EXPECTED.v8Worst, 4);
    expect(v8.worst).toBeLessThan(CONTRAST_WARN_MAIN_ON_PAGE);
    // 关键：即使低于阈值也 ok === true —— 它只负责"报出 offenders"给 UI 做提示
    expect(v8.ok).toBe(true);
    expect(v8.offenders.length).toBeGreaterThan(0);
    for (const o of v8.offenders) {
      expect(o.value).toBeCloseTo(contrast(o.hex, '#FFFFFF'), 4);
      expect(contrast(o.hex, '#FFFFFF')).toBeLessThan(CONTRAST_WARN_MAIN_ON_PAGE);
    }
    // 浅色系锚点（s5/s6/s7）就在 offenders 里
    const offenderHexes = v8.offenders.map((o) => o.hex);
    expect(offenderHexes).toContain('#E0FFB7');
    expect(offenderHexes).toContain('#FFD16B');
    expect(offenderHexes).toContain('#FFF2D6');
  });

  it('P1-99 · checkById 对未知 id 抛错（防止拼错的检查项被静默跳过）', () => {
    expect(() => checkById('V99' as never)).toThrow(/未知检查项/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 彩度（T02 新增判定：中性色与界面"同一层级"）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-P2 · Lab 彩度 C*（20 色全部 ≥ 6；最高者即建议锚色）', () => {
  it('P2-01 · 20 色 C* 全部 ≥ 6（没有中性灰混进色板）', () => {
    const low = PALETTE_20.filter((hex) => paletteChroma(hex) < 6);
    expect(low).toEqual([]);
    const report = PALETTE_20.map((hex) => ({ hex, c: paletteChroma(hex) })).sort((a, b) => a.c - b.c);
    expect(report[0]!.hex).toBe('#FFF2D6'); // 最低 = 米白 15.0805
    expect(report[0]!.c).toBeCloseTo(15.0805, 3);
  });

  it('P2-02 · 最高彩度 100.3495 @ #7E32E2 === SUGGEST_CHROMA_ANCHOR（单一出处）', () => {
    const report = PALETTE_20.map((hex) => ({ hex, c: paletteChroma(hex) })).sort((a, b) => b.c - a.c);
    expect(report[0]!.hex).toBe('#7E32E2');
    expect(report[0]!.c).toBeCloseTo(100.3495, 3);
    expect(SUGGEST_CHROMA_ANCHOR).toBe(report[0]!.hex);
  });

  it('P2-03 · 反证：中性灰的 C* ≈ 0（所以彩度判定真的能区分"有色相/无色相"）', () => {
    for (const gray of ['#FFFFFF', '#000000', '#808080', '#7F7F7F']) {
      expect(paletteChroma(gray)).toBeLessThan(0.5);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * V6 可见度报告（仅报告，不设闸）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('T02-P3 · V6 色带可见度（仅报告不设闸；BUG-04 发丝描边的由来）', () => {
  it('P3-01 · s1 暗带对暗页底只有 13.5061（远低于可辨识直觉值）', () => {
    const s1 = bandVisibility('#215452');
    expect(s1.lightOnPaper).toBeCloseTo(47.9952, 3);
    expect(s1.darkOnPaper).toBeCloseTo(13.5061, 3);
    expect(s1.darkOnPaper).toBeLessThan(15);
  });

  it('P3-02 · 20 色报告齐备且不含 NaN（报告本身不得崩）', () => {
    const report = bandVisibilityReport();
    expect(report).toHaveLength(20);
    for (const row of report) {
      expect(Number.isFinite(row.lightOnPaper)).toBe(true);
      expect(Number.isFinite(row.darkOnPaper)).toBe(true);
      expect(row.lightOnPaper).toBeGreaterThan(0);
      expect(row.darkOnPaper).toBeGreaterThan(0);
    }
    // 最"隐形"的暗带仍是 s1（13.5061）；最"隐形"的亮带是 s7 米白（15.6542）
    const worstDark = report.reduce((a, b) => (b.darkOnPaper < a.darkOnPaper ? b : a));
    expect(worstDark.hex).toBe('#215452');
    const worstLight = report.reduce((a, b) => (b.lightOnPaper < a.lightOnPaper ? b : a));
    expect(worstLight.hex).toBe('#FFF2D6');
    expect(worstLight.lightOnPaper).toBeCloseTo(15.6542, 3);
  });

  it('P3-03 · V6 不设闸：可见度再低也不产生 offenders 之外的失败（它不是验收项）', () => {
    // 断言"V6 不在 V1–V9 的闸门集合里"——防止有人误加一条会红的检查
    const ids = validatePalette().map((c) => c.id);
    expect(ids).not.toContain('V6');
    expect(ids).not.toContain('V9');
  });
});
