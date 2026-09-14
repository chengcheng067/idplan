/**
 * 阶段色三层派生（v0.8 · T02 · **本轮最高风险模块**）。
 *
 * 唯一权威 = 工作区根 `tmp/build_palette2.py`（`tmp/palette2.json` 的 `meta.rule` 已知漂移，
 * 不作依据）。规则编号 R0–R9 与脚本行号的对应关系见设计文档 §2.4.1。
 *
 * ── 三层令牌与主题映射（与 global.css 同构）──
 *   light.solid = main              亮色 `--stage-sN`
 *   light.band  = pickLightBand     亮色 `--stage-band-sN`；**暗色 `--stage-sN` 复用同一份值（R4）**
 *   light.ink   = chooseText        亮色 `--stage-ink-sN`
 *   dark.solid  = light.band        （R4：暗底上 main 太深会糊进背景）
 *   dark.band   = pickDarkBand      暗色 `--stage-band-sN`
 *   dark.ink    = chooseTextDark    暗色 `--stage-ink-sN`
 *
 * ── 五条"照抄脚本、别优化"的实现纪律 ──
 *   1. `mix` 是 sRGB 逐通道插值（见 contrast.ts），不是 HSL；
 *   2. R2 亮带是**按序搜索 9 档 t**（`0.25,0.30,0.20,...`）取首个达标者，**不是"一律 25%"**
 *      —— s1 就是因为 t=0.25 时最优字色只有 4.47 被拒，才落到 t=0.30（实测 `#648786`）；
 *   3. R5 暗带阈值 `L* >= 70`、混合目标 `#0F1217`、比例 `0.58`
 *      （**不是** `meta.rule` 写的 `L*>88` / `15% 叠白`）；
 *   4. 选字是「**首个** >=4.5 者胜，全不达标才取对比最高者」，**不是 argmax**；
 *   5. 前 9 色是回归锚点，逐字节不得改（45 条断言锁在 tests/stage-color-derive.spec.ts）。
 *
 * ── 脚本之外的两处新增（都已在代码里标注出处）──
 *   · **E1 暗带回退搜索**：脚本只服务 9 个精选主色，用户可任选主色，故补一层同构回退；
 *   · **中性彩度警告**：脚本没有彩度概念；用于 `#FFFFFF`/`#000000`/`#808080` 这类
 *     零彩度主色出警告（PRD A12①）。
 */

import {
  contrast,
  labChroma,
  lstar,
  mix,
  normalizeHex,
  rgbTripletString,
  scale,
  deltaE76,
  nearestByDeltaE,
  type RgbTriplet,
  tryParseHex,
} from './contrast';

/* ------------------------------------------------------------------ R0 常量 */

/** 面内字的中性近黑（脚本 `INK`，:26；= global.css 的 --ink） */
export const INK = '#111318';
/** 亮色页底（脚本 `PAPER_LIGHT`，:24） */
export const PAPER_LIGHT = '#FFFFFF';
/** 暗色页底（脚本 `PAPER_DARK`，:25）——**只用于可见度报告（V6），不参与派生** */
export const PAPER_DARK = '#14161C';
/** ★ R5 的混合目标（脚本 `DARK_PAGE`，:131；= global.css `--sunken-rgb`）——注意 ≠ PAPER_DARK */
export const DARK_PAGE = '#0F1217';

/** 压带文字的最低对比度（WCAG AA 正文；PRD A12③ 硬闸） */
export const TEXT_MIN_CONTRAST = 4.5;

/** V3/V4/V9：两两区分度下限（CIE76 ΔE） */
export const DELTA_E_MIN_DISTINCT = 10;
/** ★ V5：与锁定语义色的最小 ΔE（上一版设计漏了这条） */
export const DELTA_E_MIN_VS_SEMANTIC = 15;
/** V8：主色 vs 页面底（**警告级，不阻断**；PRD A12①） */
export const CONTRAST_WARN_MAIN_ON_PAGE = 1.5;

/** ★ R2：`Lstar(main) > 80` ⇒ 亮带保持原色（再叠白会消失） */
export const LIGHT_BAND_KEEP_ABOVE = 80;
/** ★ R2：按序搜索的 9 档叠白比例（**首选 0.25，不是唯一档**） */
export const LIGHT_BAND_SEARCH = [0.25, 0.30, 0.20, 0.35, 0.15, 0.40, 0.10, 0.45, 0.50] as const;
/** ★ R5：`Lstar(main) >= 70` ⇒ 暗带保持原色 */
export const DARK_BAND_KEEP_AT_OR_ABOVE = 70;
/** ★ R5：否则 `mix(main, DARK_PAGE, 0.58)`（**压暗，不是叠白**） */
export const DARK_BAND_MIX_T = 0.58;
/** ★ E1（设计扩展，脚本无此回退）：暗带选不出达标字色时的递增搜索档 */
export const DARK_BAND_FALLBACK_SEARCH = [0.58, 0.65, 0.72, 0.80] as const;
/** ★ E1 第二支：L* 距 70 阈值 ±该值以内 ⇒ 再试「保持原色」支 */
export const DARK_BAND_NEAR_THRESHOLD = 5;

/**
 * T02 新增：主色彩度下限（Lab C*）。低于此值⇒与界面中性面（墨色/边框/灰底）
 * 属于同一视觉层级，阶段色失去可编码意义 ⇒ `deriveAndValidate` 出警告。
 * P2 说明：脚本无此概念，取值 6 由 `tests/palette-20.spec.ts` 守住
 * （20 色全部 C* ≥ 6；`#808080` 的 C* 恰为 0）。
 */
export const NEUTRAL_CHROMA_MIN = 6;

/**
 * T02 新增：`suggestAccessibleMain()` 给零彩度主色"注入色相"时的锚色 ——
 * **等于 `PALETTE_20` 中 Lab 彩度最高的那一项**（一致性断言在 tests/palette-20.spec.ts）。
 * 不写 import 是为了避免 `palette-20.ts → derive-stage-colors.ts` 的循环依赖。
 */
export const SUGGEST_CHROMA_ANCHOR = '#7E32E2';

/** `suggestAccessibleMain()` 对非法输入的回退建议色（也是 PALETTE_20 的第 2 项） */
export const SUGGEST_FALLBACK = '#2E86F0';

/* ------------------------------------------------------------------ 类型 */

/** 单个主题下的三层令牌。`inkRgb` 是 `"r g b"` 形态，供 `rgb(var(--…) / α)` 注入 alpha（BUG-04） */
export interface StageTriple {
  solid: string;
  band: string;
  ink: string;
  inkRgb: string;
}

/** 亮 / 暗两套（打印走 `.print-root` 锁回亮色，故**不新增第三套**） */
export interface DerivedStageColors {
  light: StageTriple;
  dark: StageTriple;
}

/** 派生警告码（**接口已冻结**：不要新增第 5 个码，否则 T03 的穷尽分支会编译失败） */
export type DeriveWarningCode =
  | 'low-page-contrast'
  | 'low-band-contrast'
  | 'forced-band-shift'
  | 'unresolvable';

export interface DeriveWarning {
  code: DeriveWarningCode;
  message: string;
}

export interface DeriveResult {
  colors: DerivedStageColors;
  warnings: DeriveWarning[];
}

/* ------------------------------------------------------------------ R3 / R6 选字 */

/**
 * 脚本 `choose_text(band, c)`（:97-112）—— R3「亮色主题面内字」。
 *
 * 偏好序（**顺序即优先级**）：同色相深色 `0.22 → 0.30 → 0.38` → 更深的 `0.14` → 中性近黑 → 白。
 * 语义：**返回第一个 `contrast(band, t) >= 4.5` 者**；若全不达标，返回**对比度最高**者。
 *
 * ⚠️ 不要写成"直接 argmax"：脚本用 `best/bestv` 同时维护这两个分支（:105-112），
 * 两分支在边界色上会给出不同答案（s9 的 `#FFFFFF` 就是这条口径的产物）。
 */
export function chooseText(band: string, main: string): string {
  const ordered = [
    scale(main, 0.22),
    scale(main, 0.30),
    scale(main, 0.38),
    scale(main, 0.14),
    INK,
    PAPER_LIGHT,
  ];
  let best = ordered[0]!;
  let bestValue = -1;
  for (const candidate of ordered) {
    const v = contrast(band, candidate);
    if (v > bestValue) {
      best = candidate;
      bestValue = v;
    }
    if (v >= TEXT_MIN_CONTRAST) return candidate;
  }
  return best;
}

/**
 * 脚本 `choose_text_dark(band, c)`（:134-145）—— R6「暗色主题面内字」。
 *
 * 偏好序：白 → `mix(c, #FFF, 0.80)` → `mix(c, #FFF, 0.65)` → 中性近黑 → 同色相深色 `0.22`。
 * 同样是「首个 >=4.5 者胜，否则取最高」。
 */
export function chooseTextDark(band: string, main: string): string {
  const ordered = [
    PAPER_LIGHT,
    mix(main, PAPER_LIGHT, 0.8),
    mix(main, PAPER_LIGHT, 0.65),
    INK,
    scale(main, 0.22),
  ];
  let best = ordered[0]!;
  let bestValue = -1;
  for (const candidate of ordered) {
    const v = contrast(band, candidate);
    if (v > bestValue) {
      best = candidate;
      bestValue = v;
    }
    if (v >= TEXT_MIN_CONTRAST) return candidate;
  }
  return best;
}

/* ------------------------------------------------------------------ R2 / R5 选底 */

/**
 * 脚本 `pick_light_band()`（:119-128 + :148-150）—— **R2 亮色宽面**。
 *
 * ```
 * if Lstar(main) > 80 → 原色（本身已很浅，再叠白会消失）
 * else 按序搜索 t ∈ (0.25, 0.30, 0.20, 0.35, 0.15, 0.40, 0.10, 0.45, 0.50)
 *      返回第一个 contrast(mix(main,#FFF,t), chooseText(...,main)) >= 4.5 的混色
 *      全不达标 → mix(main, #FFF, 0.50)
 * ```
 *
 * ⚠️ **这是"搜索"不是"固定 25%"** —— s1 `#215452` 在 t=0.25 时最优字色对比度仅 4.47 < 4.5
 *   ⇒ 该档被拒 ⇒ 落到 t=0.30 得 `#648786`、字色 `#071212`、对比度 4.85 ✓。
 *   若实现成"一律 25%"，s1 的成品字会**当场对不过 PRD A12③ 的 4.5 硬闸**。
 */
export function pickLightBand(main: string): string {
  if (lstar(main) > LIGHT_BAND_KEEP_ABOVE) return main;
  for (const t of LIGHT_BAND_SEARCH) {
    const band = mix(main, PAPER_LIGHT, t);
    if (contrast(band, chooseText(band, main)) >= TEXT_MIN_CONTRAST) return band;
  }
  return mix(main, PAPER_LIGHT, 0.5);
}

/**
 * 脚本 `pick_dark_band()`（:153-156）—— **R5 暗色宽面（原生规则，不含 E1）**。
 *
 * `Lstar(main) >= 70 ? main : mix(main, DARK_PAGE, 0.58)`，其中 DARK_PAGE = `#0F1217`。
 *
 * ⚠️ 三个常数都与 `palette2.json` 的 `meta.rule` 字符串不一致（88 / 15% 叠白），
 *   **以本函数为准**；`tests/stage-color-derive.spec.ts` 里有反向守卫断言。
 * ⚠️ 这里的"原色"指的是 **main**（不是 lightBar）：满足 `L* >= 70` 的有 s3/s4/s5/s6/s7。
 */
export function pickDarkBand(main: string): string {
  return lstar(main) >= DARK_BAND_KEEP_AT_OR_ABOVE ? main : mix(main, DARK_PAGE, DARK_BAND_MIX_T);
}

/**
 * R8（脚本 :253-254）：满饱和色卡上的文字色 —— 白与近黑比对比度，**大者胜**（平手取 INK）。
 * 注意：这条是**色卡**（main 底）用字，与色带内字（R3/R6）不是同一个决策。
 */
export function pickSwatchInk(main: string): string {
  return contrast(main, PAPER_LIGHT) > contrast(main, INK) ? PAPER_LIGHT : INK;
}

/* ------------------------------------------------------------------ E1 暗带安全网 */

/** 选字器的依赖注入形态（默认 `chooseTextDark`；测试用它构造"必然失败"的场景） */
export type TextPickerDark = (band: string, main: string) => string;

export interface DarkBandResolution {
  /** 最终采用的暗带 */
  band: string;
  /** 是否偏离了 R5 原生规则（触发 E1 即 true） */
  shifted: boolean;
  /** 是否拿到了达标的字色（false ⇒ 调用方应给出 `low-band-contrast` 警告） */
  resolved: boolean;
}

/**
 * ★ **E1：设计扩展，脚本无此回退**（§2.4.2 的"越界处置"表）。
 *
 * 脚本只服务 9 个精选主色，作者手工确认过它们的暗带都选得出字；用户可任选主色，
 * 所以这里补一条与 R2 同构的回退：
 *   1. 先按 R5 原生规则算暗带；若 `contrast(band, chooseTextDark(band, main)) >= 4.5` → 直接采用；
 *   2. 否则在 `mix(main, DARK_PAGE, t)` 上按 `t ∈ (0.58, 0.65, 0.72, 0.80)` 递增搜索；
 *   3. 仍不达标且 `Lstar(main)` 距 70 阈值很近（±5）→ 再试「保持原色」支；
 *   4. 仍不达标 → **不抛异常**（PRD A12① 要求边界色不崩），返回原生暗带 + `resolved=false`，
 *      由 `deriveAndValidate` 转成 `low-band-contrast` / `unresolvable` 警告，UI 拒绝落库。
 *
 * ── 实测可达性（诚实记录）──
 *   在 4 步网格（262,144 个主色）上穷举，**第 1 支一次也没被触发**；
 *   解析上也可证明：暗带失败要求 `lum(band) ∈ (4.5·(lum_scale022+0.05)−0.05, 0.1833)`，
 *   而满足后者的主色几乎全黑（`L* >= 70` 的支又必然能配 INK 字色）⇒ 窗口其实是空的。
 *   故 E1 的定位是**永不触发但必须存在的安全网**；测试通过 `TextPickerDark` 注入
 *   "必然失败"的选字器来验证搜索阶梯行为（见 tests/stage-color-derive.spec.ts）。
 */
export function resolveDarkBand(
  main: string,
  pickText: TextPickerDark = chooseTextDark,
): DarkBandResolution {
  const raw = pickDarkBand(main);
  if (contrast(raw, pickText(raw, main)) >= TEXT_MIN_CONTRAST) {
    return { band: raw, shifted: false, resolved: true };
  }
  for (const t of DARK_BAND_FALLBACK_SEARCH) {
    const band = mix(main, DARK_PAGE, t);
    if (band === raw) continue; // 0.58 就是原生值，刚才已试过
    if (contrast(band, pickText(band, main)) >= TEXT_MIN_CONTRAST) {
      return { band, shifted: true, resolved: true };
    }
  }
  if (Math.abs(lstar(main) - DARK_BAND_KEEP_AT_OR_ABOVE) <= DARK_BAND_NEAR_THRESHOLD) {
    if (contrast(main, pickText(main, main)) >= TEXT_MIN_CONTRAST) {
      return { band: main, shifted: true, resolved: true };
    }
  }
  return { band: raw, shifted: false, resolved: false };
}

/* ------------------------------------------------------------------ 唯一出口 */

function triple(solid: string, band: string, ink: string): StageTriple {
  return { solid, band, ink, inkRgb: rgbTripletString(ink) };
}

/**
 * 唯一对外出口（§5.2 冻结签名）：`mainHex` → 亮/暗两套三层令牌。
 *
 * 主题映射：`light.solid = main`、`dark.solid = light.band`（R4 —— 暗底上 main 太深会糊掉）。
 *
 * 输入非法时不抛异常，按 `INK` 兜底（零值安全）；需要判别请用 `deriveAndValidate()`。
 */
export function deriveStageColors(mainHex: string): DerivedStageColors {
  const main = normalizeHex(mainHex) ?? INK;

  const lightBand = pickLightBand(main);
  const dark = resolveDarkBand(main);

  return {
    light: triple(main, lightBand, chooseText(lightBand, main)),
    dark: triple(lightBand, dark.band, chooseTextDark(dark.band, main)),
  };
}

/**
 * 带校验的入口（§5.2 冻结签名）：派生 + 一组**不阻断**的警告（PRD A12①）。
 *
 * 警告码只有 4 个（接口冻结），语义边界：
 *   · `low-page-contrast`  —— 主色/实心块在**实际承载面**（亮页白底、暗页底）上不可见（V8 族）
 *   · `low-band-contrast`  —— ① 带/字对比度不达标；② **主色彩度过低**（C* < NEUTRAL_CHROMA_MIN，
 *                             与界面中性面同层级，阶段色失去可编码意义）
 *   · `forced-band-shift`  —— 触发了 E1 暗带回退（偏离 R5 原生值）
 *   · `unresolvable`       —— 主色非法，或三层色根本无法给出可用对
 */
export function deriveAndValidate(mainHex: string): DeriveResult {
  const warnings: DeriveWarning[] = [];
  const normalized = normalizeHex(mainHex);

  if (normalized === null) {
    warnings.push({
      code: 'unresolvable',
      message: `主色 ${JSON.stringify(String(mainHex))} 不是合法颜色（期望 #RRGGBB），已按 ${INK} 兜底；请重新取色。`,
    });
  }
  const main = normalized ?? INK;

  // ① 中性/零彩度主色（T02 新增判定；`#FFFFFF` / `#000000` / `#808080` 都会命中）
  const chroma = labChroma(main);
  if (chroma < NEUTRAL_CHROMA_MIN) {
    warnings.push({
      code: 'low-band-contrast',
      message: `主色彩度过低（C*=${chroma.toFixed(1)} < ${NEUTRAL_CHROMA_MIN}）：派生的阶段色与界面中性色（墨色/边框/灰底）属同一视觉层级，时间轴与月历上难以识别；建议换一个有色相的色。`,
    });
  }

  // ② V8（警告级）：主色在亮页白底上不可见
  const onLight = contrast(main, PAPER_LIGHT);
  if (onLight < CONTRAST_WARN_MAIN_ON_PAGE) {
    warnings.push({
      code: 'low-page-contrast',
      message: `主色在亮色底上不可见（对比度 ${onLight.toFixed(2)} < ${CONTRAST_WARN_MAIN_ON_PAGE}）；建议同色相加深。`,
    });
  }

  const lightBand = pickLightBand(main);
  const dark = resolveDarkBand(main);

  // ③ 暗色主题的实心块 = lightBand（R4）：若它糊在暗页底上，暗色主题也会"看不见"
  const solidOnDark = contrast(lightBand, PAPER_DARK);
  if (solidOnDark < CONTRAST_WARN_MAIN_ON_PAGE) {
    warnings.push({
      code: 'low-page-contrast',
      message: `派生出的实心块（暗色主题用 lightBar）在暗色底上不可见（对比度 ${solidOnDark.toFixed(2)} < ${CONTRAST_WARN_MAIN_ON_PAGE}）；建议同色相变浅或加深。`,
    });
  }

  // ④ 亮带字色硬闸（PRD A12③）—— R2 自带 9 档搜索，走到底仍不达标才会命中
  const lightInk = chooseText(lightBand, main);
  const lightContrast = contrast(lightBand, lightInk);
  if (lightContrast < TEXT_MIN_CONTRAST) {
    warnings.push({
      code: 'low-band-contrast',
      message: `亮色色带上的文字对比度不足（${lightContrast.toFixed(2)} < ${TEXT_MIN_CONTRAST}），即使走完 R2 的全部叠白档位仍无解；建议换主色。`,
    });
  }

  // ⑤ E1 结果
  const darkInk = chooseTextDark(dark.band, main);
  const darkContrast = contrast(dark.band, darkInk);
  if (dark.shifted) {
    warnings.push({
      code: 'forced-band-shift',
      message: `暗色色带偏离了 R5 原生规则（改用比例 ${DARK_BAND_FALLBACK_SEARCH.join('/')} 中的另一档）以满足文字对比度 ≥ ${TEXT_MIN_CONTRAST}。`,
    });
  }
  if (!dark.resolved || darkContrast < TEXT_MIN_CONTRAST) {
    warnings.push({
      code: 'low-band-contrast',
      message: `暗色色带上的文字对比度不足（${darkContrast.toFixed(2)} < ${TEXT_MIN_CONTRAST}），E1 回退搜索亦无解；请换主色（不建议落库半成品）。`,
    });
    warnings.push({
      code: 'unresolvable',
      message: '该主色无法派生出「亮/暗两套都达标」的三层令牌；请改用其它主色。',
    });
  }

  return { colors: { light: triple(main, lightBand, lightInk), dark: triple(lightBand, dark.band, darkInk) }, warnings };
}

/* ------------------------------------------------------------------ A12① 一键建议 */

function stepToward(from: string, to: string, predicate: (hex: string) => boolean): string {
  for (let t = 5; t <= 95; t += 5) {
    const candidate = mix(from, to, t / 100);
    if (predicate(candidate)) return candidate;
  }
  return to;
}

/**
 * A12① 「一键建议」：把用户主色调成**至少可见且不糊成中性色**的最小改动色。
 *
 * 判据（与 `deriveAndValidate` 的警告一一对应）：
 *   · 亮页对比度 `>= CONTRAST_WARN_MAIN_ON_PAGE`（1.5）
 *   · Lab 彩度 `>= NEUTRAL_CHROMA_MIN`（6）
 *
 * 顺序：① 亮页不可见 ⇒ 向 `INK` 逐步加深；② 彩度不足 ⇒ 向 `SUGGEST_CHROMA_ANCHOR`
 * 逐步注入色相。非法输入返回 `SUGGEST_FALLBACK`。
 *
 * 说明：本函数**只给建议、不改数据**；是否采纳由 UI 决定（A12 是提示级）。
 */
export function suggestAccessibleMain(mainHex: string): string {
  if (tryParseHex(mainHex) === null) return SUGGEST_FALLBACK;

  const ok = (hex: string): boolean =>
    contrast(hex, PAPER_LIGHT) >= CONTRAST_WARN_MAIN_ON_PAGE && labChroma(hex) >= NEUTRAL_CHROMA_MIN;

  let current = normalizeHex(mainHex)!;
  if (ok(current)) return current;

  if (contrast(current, PAPER_LIGHT) < CONTRAST_WARN_MAIN_ON_PAGE) {
    current = stepToward(current, INK, (hex) => contrast(hex, PAPER_LIGHT) >= CONTRAST_WARN_MAIN_ON_PAGE);
  }
  if (labChroma(current) < NEUTRAL_CHROMA_MIN) {
    current = stepToward(current, SUGGEST_CHROMA_ANCHOR, ok);
  }
  return current;
}

/* ------------------------------------------------------------------ V6 可见度报告 */

/**
 * V6（脚本 :238-241）：色带在底色上的可见度 —— **仅报告，不设闸**。
 * 暗色带上暗页底本来就低（s1 只有 13.5），这是 BUG-04「发丝描边」存在的原因，
 * 因此不作为警告，只作为调色板体检数据。
 */
export function reportBandVisibility(mainHex: string): {
  main: string;
  lightBandOnPaper: number;
  darkBandOnPaper: number;
} {
  const main = normalizeHex(mainHex) ?? INK;
  const lightBand = pickLightBand(main);
  const darkBand = pickDarkBand(main);
  return {
    main,
    lightBandOnPaper: deltaE76(lightBand, PAPER_LIGHT),
    darkBandOnPaper: deltaE76(darkBand, PAPER_DARK),
  };
}

/** V9（提示级）：主色与「项目内已有阶段色」的最近 ΔE（≥ DELTA_E_MIN_DISTINCT 为宜） */
export function nearestExistingStageColor(
  mainHex: string,
  existingStageColors: readonly string[],
): { hex: string; deltaE: number } | null {
  const main = normalizeHex(mainHex) ?? INK;
  const valid = existingStageColors.map((c) => normalizeHex(c)).filter((c): c is string => c !== null);
  return nearestByDeltaE(main, valid);
}

/** 供上层（T03 取色器）复用的 RGB 解析出口 */
export { tryParseHex, normalizeHex };
export type { RgbTriplet };
