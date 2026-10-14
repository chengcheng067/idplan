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

import { t, type MessageKey } from '../../i18n';
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

/**
 * 三槽位的**显示名键**（屏幕侧唯一消费方 = `PaletteSection`，取词 `t(...)`）。
 * ⚠️ 存键不存值：本表只服务**屏幕**（配色选择器）；纸面拿的是 `PrintPalette`
 * 的三枚 hex，一个字都不读本表 ⇒「纸面恒中文」不受影响。
 */
export const PRINT_PALETTE_SLOT_LABELS: Record<PrintPaletteSlot, MessageKey> = {
  accent: 'print.palette.slot.accent',
  ink: 'print.palette.slot.ink',
  line: 'print.palette.slot.line',
};

/** 非文字/图形级对比度阈值（WCAG 1.4.11：3:1）——仓库无同义常量，此处单一定义 */
export const PALETTE_ACCENT_MIN_CONTRAST = 3;

/**
 * 预设变体卡（三枚打包；用户点选即用，保存形态与自定义完全一致）。
 * `nameKey` = **配色预设名**的键（产品负责人 2026-10-14 拍板：配色预设名也翻，
 * 原判 C 灰区改判 A）。落库的是 hex，名字只用于屏幕 ⇒ 换名不动数据。
 *
 * ⚠️ **边界句（防口径交叉，2026-10-15 补）**：这里的「色号」= **配色预设名**
 *   （屏幕侧，本表 `nameKey`：交通黄 / 站台蓝 / 橙红 …）。
 *   它**不是** `src/components/timeline/stageColors.ts` 的 `STAGE_COLOR_NAMES`
 *   （九段阶段色名：松墨 / 亮蓝 / 雾蓝 …）—— **两张表只是词面像，互不相干**：
 *     · 本表：消费点 = `PaletteSection`（**屏幕**）⇒ 存键、随语言；
 *     · `STAGE_COLOR_NAMES`：消费点全在**打印族**（`PrintGantt` / `SchedulePaper` /
 *       `CalendarPrintPage` 等 `title`）⇒ **恒中文**（team-lead 2026-10-15 裁定，
 *       见 `36f627e` 表头注释）。
 *   ⇒ 判别依据是「**消费点在纸面还是屏幕**」，**不是「属于哪套命名体系」**。
 *     读到本句想「顺手把九段色名也翻了」的人：那会当场打红纸面口径，请先读上面那条。
 */
export interface PrintPalettePreset {
  id: string;
  nameKey: MessageKey;
  palette: PrintPalette;
}

/** 一对对比度检查的规格（a/b 可以是槽位或 'paper'） */
export interface PrintPalettePairSpec {
  a: PrintPaletteSlot | 'paper';
  b: PrintPaletteSlot | 'paper';
  min: number;
  /** 人读标签的**键**（禁存提示里指名用；调用方 `t(labelKey)`） */
  labelKey: MessageKey;
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
 * ⚠️ accent 文字下限的既有违登记项**已全部清除**（2026-10-09 收尾批：
 * H `.ap-status__card-key` 9→9.5px；E `.ei-row__agent-tag` 9→9.5px；
 * D `.de-stack__ticks` 8.5→9.5px——整行同字号，原值同时低于规则 4 的
 * L3 9-10px 区间，P3 实测 356px 自由空间吸收行高 +1.4px）。此后新元素
 * 一律 ≥9.5px，spec 有断言。
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
    { a: 'ink', b: 'paper', min: PALETTE_MIN_CONTRAST.ink, labelKey: 'print.palette.pair.inkPaper' },
    { a: 'line', b: 'paper', min: PALETTE_MIN_CONTRAST.line, labelKey: 'print.palette.pair.linePaper' },
    // A 的身份区：黑顶/底栏上的黄字。accent 与 line 任一枚跑偏都会出「白栏黄字」事故
    { a: 'accent', b: 'line', min: PALETTE_MIN_CONTRAST.ink, labelKey: 'print.palette.pair.accentLine' },
  ],
  presets: [
    { id: 'traffic-yellow', nameKey: 'print.palette.swiss.trafficYellow', palette: { accent: '#F2D957', ink: '#191816', line: '#191816' } },
    { id: 'platform-blue', nameKey: 'print.palette.swiss.platformBlue', palette: { accent: '#16324F', ink: '#F2D957', line: '#F2D957' } },
    { id: 'ochre', nameKey: 'print.palette.swiss.ochre', palette: { accent: '#8C4A2F', ink: '#F5E9DA', line: '#F5E9DA' } },
    { id: 'pine', nameKey: 'print.palette.swiss.pine', palette: { accent: '#1E4D3B', ink: '#F2D957', line: '#F2D957' } },
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
    { a: 'ink', b: 'paper', min: PALETTE_MIN_CONTRAST.ink, labelKey: 'print.palette.pair.inkPage' },
    { a: 'accent', b: 'paper', min: PALETTE_MIN_CONTRAST.accent, labelKey: 'print.palette.pair.accentPage' },
    { a: 'line', b: 'paper', min: PALETTE_MIN_CONTRAST.line, labelKey: 'print.palette.pair.linePage' },
  ],
  presets: [
    { id: 'signal-orange', nameKey: 'print.palette.data.signalOrange', palette: { accent: '#EF4B23', ink: '#0A0A0A', line: '#C9C9C9' } },
    { id: 'indigo', nameKey: 'print.palette.data.indigo', palette: { accent: '#3B5BDB', ink: '#0A0A0A', line: '#C9C9C9' } },
    { id: 'pine-green', nameKey: 'print.palette.data.pineGreen', palette: { accent: '#1F7A4D', ink: '#0A0A0A', line: '#C9C9C9' } },
    { id: 'sienna', nameKey: 'print.palette.data.sienna', palette: { accent: '#A0522D', ink: '#0A0A0A', line: '#C9C9C9' } },
  ],
};

/**
 * E · Editorial Index：暖浅纸面 + 赭红焦点 + 发丝线。
 *
 * 2026-10-11（P0-15 向参考稿还原）：纸底 `#FAF7F2 → #F5F2EC`、accent
 * `#C8102E → #B04A2F`（参考稿实测；原色相 H≈352° 偏冷正红，参考 H≈16°），
 * 并**连带**把 line 由 `#CFC8BC → #CFC6B4`（同样是参考稿实测值）。连带原因
 * 是硬闸门：纸底压深后原线色对新纸底只有 **1.487:1**，低于 `line` 的 1.5
 * 阈值（宪法 5：闸门不是建议），而参考稿自己的发丝线实测值正好是
 * `#CFC6B4`。改后三对实测（仓库 `contrast()` 实算）：
 *   · ink `#141414` vs paper `#F5F2EC` = **16.488**（≥4.5 ✅）
 *   · accent `#B04A2F` vs paper `#F5F2EC` = **4.861**（≥3 ✅）
 *   · line `#CFC6B4` vs paper `#F5F2EC` = **1.517**（≥1.5 ✅，压线但过）
 */
const EDITORIAL_INDEX_PALETTE: PrintTemplatePaletteSpec = {
  paper: '#F5F2EC',
  baseline: { accent: '#B04A2F', ink: '#141414', line: '#CFC6B4' },
  pairs: [
    { a: 'ink', b: 'paper', min: PALETTE_MIN_CONTRAST.ink, labelKey: 'print.palette.pair.inkPage' },
    { a: 'accent', b: 'paper', min: PALETTE_MIN_CONTRAST.accent, labelKey: 'print.palette.pair.focusPage' },
    { a: 'line', b: 'paper', min: PALETTE_MIN_CONTRAST.line, labelKey: 'print.palette.pair.hairlinePage' },
  ],
  presets: [
    { id: 'vermilion', nameKey: 'print.palette.editorial.vermilion', palette: { accent: '#B04A2F', ink: '#141414', line: '#CFC6B4' } },
    { id: 'indigo', nameKey: 'print.palette.editorial.indigo', palette: { accent: '#2B4ACB', ink: '#141414', line: '#CFC6B4' } },
    { id: 'pine-green', nameKey: 'print.palette.editorial.pineGreen', palette: { accent: '#1F7A4D', ink: '#141414', line: '#CFC6B4' } },
    { id: 'sienna', nameKey: 'print.palette.editorial.sienna', palette: { accent: '#A0522D', ink: '#141414', line: '#CFC6B4' } },
  ],
};

/**
 * H · Agent Poster：暖灰米纸面 + 橙红焦点 + 近黑。
 *
 * 2026-10-11（P0-17 向参考稿还原）：纸底 `#F5F5F5 → #DEDDD4`、accent
 * `#E8590C → #E2522B`，两枚都是参考稿像素实测值（旧纸底是中性灰、参考稿是暖灰米，
 * 纸色是模板身份故取值必须精确，规格 A1）。
 *
 * ⚠️ **H 的登记偏离只剩一条（accent），line 已于 2026-10-11 P1-3 复核后归队。**
 * 纸底一压深，accent 跌破闸门；line 不跌破（仓库 `contrast()` 实算，非推断）：
 *   · ink    `#0A0A0A` vs paper `#DEDDD4` = **14.518**（≥4.5 ✅）
 *   · accent `#E2522B` vs paper `#DEDDD4` = **2.812**（≥3 ❌；旧纸底上 3.284）
 *   · line   `#91918A` vs paper `#DEDDD4` = **2.3258**（≥1.5 ✅，余量 55%）
 *
 * **裁决（规格 P0-17，2026-10-11 产品在场的口径）：忠于参考稿 + 显式登记偏离。**
 * 分界是「**闸门管用户自定义配色，不管设计师基线**」——D/E 的先例都是「改值过闸」
 * （D line `#D4D4D4→#C9C9C9`、E line `#CFC8BC→#CFC6B4`）。H 的分工：
 *   · **基线 = 参考稿实测值写死**（`#DEDDD4` / `#E2522B` / `#91918A`），
 *     `checkPrintPalette('agent-poster', baseline).ok === false`——**登记的有意
 *     偏离**，失败对**只有「状态色 vs 纸底」一条**；`tests/print-palette.spec.ts`
 *     的 ①c 用例把三枚值与实测比值一起钉住，**不许当成缺陷去"修"**（同 D 的
 *     `#C9C9C9` 先例：审美标准 §4 末条）。accent 是**身份色**，为过闸改它等于改
 *     模板身份 ⇒ 只能登记。
 *   · **line 不是身份色，不登记偏离**：参考稿自己的发丝线取色实测 = `#91918A`
 *     （对参考稿 PNG 做**全像素**扫描：`#91918A` 命中该页全部 1px 分隔行；
 *     旧写法 `#BFBFBF` 在参考稿里 **0 处命中**——那一版是取色失误，不是参考稿值）。
 *     它本身即过闸（2.3258 ≥ 1.5）⇒ 无需任何例外，与其余三版同口径。
 *   · **四个预设逐一过闸**（规格明示「用户在 H 上改色时拿不到 2.81 那种组合」）：
 *     线色与基线**同值** `#91918A`（line 已过闸，原先那条「为过闸而同色相加深」
 *     的 `#B4B4B4` 由此退役）；`signal-orange` 的 accent 取 `#DA4B21`
 *     （**3.074 ✅**）——同色相逐级加深的**最小位移解**，与参考橙 `#E2522B`
 *     肉眼无法区分（再浅一档 `#DC4E24` 就只有 2.985 ❌）。accent 这处差异是
 *     **算术上必需**的：预设是**用户可达组合**，必须真过闸；基线不是（见上条分界）。
 *   · 配套语义纪律已写进 `agent-poster.css` 头部：accent 只用于**大面积实底 /
 *     栏头 / 粗线 / 中轴**（**不得用于小字正文**，2.812 撑不起正文）；line 只作
 *     **1px 分隔**（**不承载分组职责**，分组线走 ink / accent）。
 */
const AGENT_POSTER_PALETTE: PrintTemplatePaletteSpec = {
  paper: '#DEDDD4',
  baseline: { accent: '#E2522B', ink: '#0A0A0A', line: '#91918A' },
  pairs: [
    { a: 'ink', b: 'paper', min: PALETTE_MIN_CONTRAST.ink, labelKey: 'print.palette.pair.inkPage' },
    { a: 'accent', b: 'paper', min: PALETTE_MIN_CONTRAST.accent, labelKey: 'print.palette.pair.statusPage' },
    { a: 'line', b: 'paper', min: PALETTE_MIN_CONTRAST.line, labelKey: 'print.palette.pair.dividerPage' },
  ],
  // 线色与基线同值（已过闸）；signal-orange 的 accent 差异是「预设必须真过闸」的算术必需
  presets: [
    { id: 'signal-orange', nameKey: 'print.palette.poster.signalOrange', palette: { accent: '#DA4B21', ink: '#0A0A0A', line: '#91918A' } },
    { id: 'vermilion', nameKey: 'print.palette.poster.vermilion', palette: { accent: '#C8102E', ink: '#0A0A0A', line: '#91918A' } },
    { id: 'indigo', nameKey: 'print.palette.poster.indigo', palette: { accent: '#3B5BDB', ink: '#0A0A0A', line: '#91918A' } },
    { id: 'pine-green', nameKey: 'print.palette.poster.pineGreen', palette: { accent: '#1F7A4D', ink: '#0A0A0A', line: '#91918A' } },
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
  labelKey: MessageKey;
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
    return { a: pair.a, b: pair.b, labelKey: pair.labelKey, ratio, min: pair.min, pass: ratio >= pair.min };
  });
  const failures = pairs.filter((p) => !p.pass);
  return {
    ok: failures.length === 0,
    pairs,
    failures,
    message:
      failures.length === 0
        ? null
        : t('print.palette.gate.blocked') +
          failures
            .map(
              (f) =>
                t(f.labelKey) +
                ' ' +
                formatContrastRatio(f.ratio) +
                t('print.palette.gate.need', { min: f.min }),
            )
            .join(t('print.palette.gate.join')),
  };
}

/** 便捷判定：是否允许保存（store 的 setPalette 用它做硬阻断） */
export function canSavePrintPalette(templateId: PrintTemplateId, palette: PrintPalette): boolean {
  return checkPrintPalette(templateId, palette).ok;
}
