/**
 * 四版模板配色架构（产品决策文档 §3.2 的代码落地，横切四套的孪生件）。
 *
 * ── 机制三句话 ──
 *   ① 每套 3 枚受控 token：`--tpl-accent` 身份色 / `--tpl-ink` 主文字 /
 *      `--tpl-line` 线色（accent/ink/line 三槽位，**全 token 开放不做**）；
 *   ② 主路径 = 预设变体卡（三枚打包、已过灰度验收，本文件的单测逐组验）；
 *      自定义路径 = 对比度**硬闸门**（禁存，不是提示）——复用仓库现成的
 *      `contrast()`（src/core/color/contrast.ts）与 `TEXT_MIN_CONTRAST`
 *      （derive-stage-colors.ts），不复制算法、不新增依赖；
 *   ③ 挂载 = `.print-root` 上的 inline CSS 变量（iframe 打印
 *      `cloneNode(true)` 原样进克隆面，print-frame.ts:77），**不拼动态类名**。
 *
 * ── 为什么闸门是「每模板一对列表」而不是固定三对 ──
 * A 版的 accent **兼纸面**（决策文档 §3.2：「A 版的 accent 已承担纸面性格这
 * 一票」）——「accent vs 纸底」在 A 是自比对（恒 1.0），拿它当闸门会连设计
 * 师基线一起禁掉，属于假闸门。A 真正要守的三对是：
 *   · 主文字 vs 纸面（accent）≥ 4.5（正文级）
 *   · 线色 vs 纸面（accent）≥ 1.5（线条可辨级）
 *   · 栏内反白字（accent）vs 栏底（line）≥ 4.5（黑顶/底栏上的黄字，A 的身份区）
 * 其余三版纸底固定，三对即决策文档原文：ink ≥ 4.5 / accent ≥ 3 / line ≥ 1.5。
 * 每套的 pairs 在 spec 里显式列出——闸门口径随模板可见、可测、可评审。
 *
 * ── 密度下限也住这里 ──
 * 对比度闸门管「改色后可辨」，`PRINT_DENSITY_FLOORS`（下文）管「改色后
 * 密度不失效」——行高下限 / 轨道 6px 硬下限 / accent 文字 ≥9.5px，外加
 * 一条固定列宽表格的日期列防溢出布局规则。两条护栏同源：都是用户可改三
 * 槽位的前提下，纸面质量的可机器执行底线。
 *
 * ── 经典（classic）为什么不在这张表里 ──
 * 它的 token 是 global.css 的阶段九色板品牌资产（应用内/打印共用），
 * 开放自定义会造成「打印稿与应用内不同色」的分裂（决策文档 §3.2 边界）。
 */

import { contrast } from '../../core/color/contrast';
import { CONTRAST_WARN_MAIN_ON_PAGE, TEXT_MIN_CONTRAST } from '../../core/color/derive-stage-colors';

import type { PrintTemplateId } from './print-view-model';

/** 三枚受控 token（槽位名 = CSS 变量名的后缀：--tpl-<slot>） */
export interface PrintPalette {
  /** 身份/信号色（A 版兼纸面） */
  accent: string;
  /** 主文字 */
  ink: string;
  /** 线/描边（A 版兼顶/底栏栏底） */
  line: string;
}

export type PrintPaletteSlot = keyof PrintPalette;

export const PRINT_PALETTE_SLOTS: readonly PrintPaletteSlot[] = ['accent', 'ink', 'line'];

export const PRINT_PALETTE_SLOT_LABELS: Record<PrintPaletteSlot, string> = {
  accent: '身份色',
  ink: '主文字',
  line: '线色',
};

/** 非文字/图形级对比度阈值（WCAG 1.4.11：3:1）——仓库无同义常量，此处单一定义 */
export const PALETTE_ACCENT_MIN_CONTRAST = 3;

/** 预设变体卡（三枚打包；用户点选即用，保存形态与自定义完全一致） */
export interface PrintPalettePreset {
  id: string;
  name: string;
  palette: PrintPalette;
}

/** 一对对比度检查的规格（a/b 可以是槽位或 'paper'） */
export interface PrintPalettePairSpec {
  a: PrintPaletteSlot | 'paper';
  b: PrintPaletteSlot | 'paper';
  min: number;
  /** 人读标签（禁存提示里指名用） */
  label: string;
}

/** 每模板的配色规格：纸底 + 设计师基线 + 预设组 + 闸门配对 */
export interface PrintTemplatePaletteSpec {
  /**
   * 纸底。hex = 固定纸底；`'accent'` = 纸底即 accent 槽位（A 版：
   * 改 accent = 改纸面，决策文档 §3.2 明示的 A 版特性）。
   */
  paper: string | 'accent';
  baseline: PrintPalette;
  presets: readonly PrintPalettePreset[];
  pairs: readonly PrintPalettePairSpec[];
}

/** 闸门阈值命名（提示文案与单测共用，避免两处漂移） */
export const PALETTE_MIN_CONTRAST = {
  ink: TEXT_MIN_CONTRAST, // 4.5 正文级（复用 derive-stage-colors.ts:56）
  accent: PALETTE_ACCENT_MIN_CONTRAST, // 3 图形/大字级
  line: CONTRAST_WARN_MAIN_ON_PAGE, // 1.5 线条可辨级（复用 derive-stage-colors.ts:63）
} as const;

/* ------------------------------------------------------------------ 密度下限 */

/**
 * 打印密度硬下限（print-density-study-2026-10-09 §4；与对比度闸门同源
 * 的**配色侧护栏**——用户可改 accent/ink/line 三槽位，密度规则要防「改色
 * 后密度失效」，故在此立常量、可被 spec 钉）。三条有常量（①②③），
 * 第四条是布局规则（④，靠 D 版视觉 spec 的 Chromium 实测断言防回潮）：
 *
 * ① **行高下限 = 文字行高 + 2×3px**（`rowPaddingMin`）：td/行 padding 任何
 *    档位不得低于上下各 3px。用户把 line 调深后，5px 间距是「文字不碰线」
 *    的最低保障；E 的 compact 31px 估高 + 6px padding 已贴近下限，不要再出
 *    第三档。四版现状全部达标（最小 4px：A/D 的 compact td）。
 * ② **进度条/色带轨道 6px 硬下限**（`trackHeightMin`）：再细，填充色
 *    （ink 或 accent）与 1px 边框（line）在任何用户线下都会糊成一条。
 *    D 的 8px / compact 6px 已到位；经典收紧到 28px 是**行高**，色带视觉
 *    厚薄（inset-y-1.5）不碰此规则。
 * ③ **accent 文字 ≥9.5px**（`accentFontSizeMin`）：延期 flags、焦点编号
 *    这类 accent 色文字，用户把 accent 调深/调艳后，小字号高饱和最糊。
 *    A 的行内 meta 收紧到 9.5 后正好压线，禁止再小。
 * ④ **固定列宽表格：列宽 ≥ 该列最长可能内容串 + 2×padding**（等宽日期列
 *    防溢出）：table-layout:fixed 的列不会给 nowrap 内容让路——D 矩阵
 *    日期列 18% 装不下 23 字符等宽日期串（Consolas 实测 139.1px，最坏
 *    等宽回落 0.6em ⇒ 151.8px），溢出部分被下一列的不透明底遮成
 *    「截断+残字」（0006 既有缺陷，2026-10-09 加宽到 24% 修复）。防回潮靠
 *    print-a4-visual-d.spec 的 Chromium 实测断言（字体无关），不靠硬编码
 *    px——那会是第二真值源。
 *
 * ⚠️ 已知低于 ③ 的既有元素（模板交接稿原值，登记在此待后续专项）：
 * E `.ei-row__agent-tag` 9px（Agent 签随负责人行变朱红）、D
 * `.de-stack__tick[data-delayed]` 8.5px（延期段下标变信号色）。
 * （H `.ap-status__card-key` 原 9px 已于 2026-10-09 收尾批修到 9.5px。）
 */
export const PRINT_DENSITY_FLOORS = {
  /** td/行 padding 单侧下限（px）；行高下限 = 文字行高 + 2×此值 */
  rowPaddingMin: 3,
  /** 进度条/色带轨道高度硬下限（px） */
  trackHeightMin: 6,
  /** accent 色文字字号下限（px） */
  accentFontSizeMin: 9.5,
} as const;

/* ------------------------------------------------------------------ 四版规格 */

/**
 * A · Swiss Schedule：交通黄纸面。line 兼顶/底栏栏底（黑），accent 兼栏内反白字。
 * 基线数值照 02 §6 token（--swiss-yellow / --swiss-black）。
 */
const SWISS_SCHEDULE_PALETTE: PrintTemplatePaletteSpec = {
  paper: 'accent',
  baseline: { accent: '#F2D957', ink: '#191816', line: '#191816' },
  pairs: [
    { a: 'ink', b: 'paper', min: PALETTE_MIN_CONTRAST.ink, label: '主文字 vs 纸面' },
    { a: 'line', b: 'paper', min: PALETTE_MIN_CONTRAST.line, label: '线色 vs 纸面' },
    // A 的身份区：黑顶/底栏上的黄字。accent 与 line 任一枚跑偏都会出「白栏黄字」事故
    { a: 'accent', b: 'line', min: PALETTE_MIN_CONTRAST.ink, label: '栏内反白字 vs 栏底' },
  ],
  presets: [
    { id: 'traffic-yellow', name: '交通黄', palette: { accent: '#F2D957', ink: '#191816', line: '#191816' } },
    { id: 'platform-blue', name: '站台蓝', palette: { accent: '#16324F', ink: '#F2D957', line: '#F2D957' } },
    { id: 'ochre', name: '赭石', palette: { accent: '#8C4A2F', ink: '#F5E9DA', line: '#F5E9DA' } },
    { id: 'pine', name: '松墨', palette: { accent: '#1E4D3B', ink: '#F2D957', line: '#F2D957' } },
  ],
};

/**
 * D · Data Editorial：白底硬边。line 槽基线取 #C9C9C9 而非 02 §6 灰阶表里的
 * #D4D4D4——后者实测 vs 白底 1.48:1，**过不了本架构 1.5 的硬闸门**（连基线
 * 自己都禁存是架构笑话）。D 版页面落地时若要还原 #D4D4D4，须先正式调整闸门
 * 口径并在此登记，不允许静默踩线。
 */
const DATA_EDITORIAL_PALETTE: PrintTemplatePaletteSpec = {
  paper: '#FFFFFF',
  baseline: { accent: '#EF4B23', ink: '#0A0A0A', line: '#C9C9C9' },
  pairs: [
    { a: 'ink', b: 'paper', min: PALETTE_MIN_CONTRAST.ink, label: '主文字 vs 纸底' },
    { a: 'accent', b: 'paper', min: PALETTE_MIN_CONTRAST.accent, label: '身份色 vs 纸底' },
    { a: 'line', b: 'paper', min: PALETTE_MIN_CONTRAST.line, label: '线色 vs 纸底' },
  ],
  presets: [
    { id: 'signal-orange', name: '橙红', palette: { accent: '#EF4B23', ink: '#0A0A0A', line: '#C9C9C9' } },
    { id: 'indigo', name: '靛蓝', palette: { accent: '#3B5BDB', ink: '#0A0A0A', line: '#C9C9C9' } },
    { id: 'pine-green', name: '墨绿', palette: { accent: '#1F7A4D', ink: '#0A0A0A', line: '#C9C9C9' } },
    { id: 'sienna', name: '赭石', palette: { accent: '#A0522D', ink: '#0A0A0A', line: '#C9C9C9' } },
  ],
};

/** E · Editorial Index：暖浅纸面 + 朱红焦点 + 发丝线 */
const EDITORIAL_INDEX_PALETTE: PrintTemplatePaletteSpec = {
  paper: '#FAF7F2',
  baseline: { accent: '#C8102E', ink: '#141414', line: '#CFC8BC' },
  pairs: [
    { a: 'ink', b: 'paper', min: PALETTE_MIN_CONTRAST.ink, label: '主文字 vs 纸底' },
    { a: 'accent', b: 'paper', min: PALETTE_MIN_CONTRAST.accent, label: '焦点色 vs 纸底' },
    { a: 'line', b: 'paper', min: PALETTE_MIN_CONTRAST.line, label: '发丝线 vs 纸底' },
  ],
  presets: [
    { id: 'vermilion', name: '朱红', palette: { accent: '#C8102E', ink: '#141414', line: '#CFC8BC' } },
    { id: 'indigo', name: '靛蓝', palette: { accent: '#2B4ACB', ink: '#141414', line: '#CFC8BC' } },
    { id: 'pine-green', name: '墨绿', palette: { accent: '#1F7A4D', ink: '#141414', line: '#CFC8BC' } },
    { id: 'sienna', name: '赭石', palette: { accent: '#A0522D', ink: '#141414', line: '#CFC8BC' } },
  ],
};

/** H · Agent Poster：灰白底 + 橙 + 近黑 */
const AGENT_POSTER_PALETTE: PrintTemplatePaletteSpec = {
  paper: '#F5F5F5',
  baseline: { accent: '#E8590C', ink: '#0A0A0A', line: '#BFBFBF' },
  pairs: [
    { a: 'ink', b: 'paper', min: PALETTE_MIN_CONTRAST.ink, label: '主文字 vs 纸底' },
    { a: 'accent', b: 'paper', min: PALETTE_MIN_CONTRAST.accent, label: '状态色 vs 纸底' },
    { a: 'line', b: 'paper', min: PALETTE_MIN_CONTRAST.line, label: '分隔线 vs 纸底' },
  ],
  presets: [
    { id: 'signal-orange', name: '橙', palette: { accent: '#E8590C', ink: '#0A0A0A', line: '#BFBFBF' } },
    { id: 'vermilion', name: '朱红', palette: { accent: '#C8102E', ink: '#0A0A0A', line: '#BFBFBF' } },
    { id: 'indigo', name: '靛蓝', palette: { accent: '#3B5BDB', ink: '#0A0A0A', line: '#BFBFBF' } },
    { id: 'pine-green', name: '墨绿', palette: { accent: '#1F7A4D', ink: '#0A0A0A', line: '#BFBFBF' } },
  ],
};

/** 四版配色规格表（classic 缺席是刻意的：品牌资产不开放，见文件头） */
export const PRINT_TEMPLATE_PALETTES: Readonly<
  Record<Exclude<PrintTemplateId, 'classic'>, PrintTemplatePaletteSpec>
> = {
  'swiss-schedule': SWISS_SCHEDULE_PALETTE,
  'data-editorial': DATA_EDITORIAL_PALETTE,
  'editorial-index': EDITORIAL_INDEX_PALETTE,
  'agent-poster': AGENT_POSTER_PALETTE,
};

/** 取某模板的配色规格；classic（不开放配色）返回 null */
export function templatePaletteSpec(
  templateId: PrintTemplateId,
): PrintTemplatePaletteSpec | null {
  return templateId === 'classic' ? null : PRINT_TEMPLATE_PALETTES[templateId];
}

/** 有效配色：自定义优先，缺键 = 设计师基线 */
export function effectivePalette(templateId: PrintTemplateId): PrintPalette | null {
  const spec = templatePaletteSpec(templateId);
  return spec ? spec.baseline : null;
}

/* ------------------------------------------------------------------ 硬闸门 */

export interface PrintPalettePairResult {
  a: PrintPaletteSlot | 'paper';
  b: PrintPaletteSlot | 'paper';
  label: string;
  /** 实测 WCAG 比值 */
  ratio: number;
  min: number;
  pass: boolean;
}

export interface PrintPaletteGateResult {
  ok: boolean;
  pairs: readonly PrintPalettePairResult[];
  failures: readonly PrintPalettePairResult[];
  /** 禁存提示（指名哪一对不达标、当前比值多少）；ok 时为 null */
  message: string | null;
}

/** 解析一对的一侧：槽位取 palette 值；'paper' 取 spec.paper（A 版解析成 accent） */
function sideColor(
  side: PrintPaletteSlot | 'paper',
  palette: PrintPalette,
  spec: PrintTemplatePaletteSpec,
): string {
  if (side !== 'paper') return palette[side];
  return spec.paper === 'accent' ? palette.accent : spec.paper;
}

/** 比值两位小数（提示语与 UI 共用格式） */
export function formatContrastRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}

/**
 * 对比度硬闸门（**禁存，不是提示**）。
 *
 * 任一对不达标 ⇒ `ok: false` + `message` 指名该对与当前比值。调用方
 * （store 的 setPalette / UI 的保存钮）必须据此拒绝落库。
 */
export function checkPrintPalette(
  templateId: PrintTemplateId,
  palette: PrintPalette,
): PrintPaletteGateResult {
  const spec = templatePaletteSpec(templateId);
  // classic 不开放配色：无 spec ⇒ 无闸门（UI 根本不渲染配色截）
  if (!spec) return { ok: true, pairs: [], failures: [], message: null };

  const pairs: PrintPalettePairResult[] = spec.pairs.map((pair) => {
    const ratio = contrast(sideColor(pair.a, palette, spec), sideColor(pair.b, palette, spec));
    return { a: pair.a, b: pair.b, label: pair.label, ratio, min: pair.min, pass: ratio >= pair.min };
  });
  const failures = pairs.filter((p) => !p.pass);
  return {
    ok: failures.length === 0,
    pairs,
    failures,
    message:
      failures.length === 0
        ? null
        : `对比度不足，已禁止保存：${failures
            .map((f) => `${f.label} ${formatContrastRatio(f.ratio)}（需 ≥${f.min}:1）`)
            .join('；')}`,
  };
}

/** 便捷判定：是否允许保存（store 的 setPalette 用它做硬阻断） */
export function canSavePrintPalette(templateId: PrintTemplateId, palette: PrintPalette): boolean {
  return checkPrintPalette(templateId, palette).ok;
}
