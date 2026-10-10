/**
 * 通用渲染 · 语法 token（期七「语法保真」；UX 研究 §2.4/§2.6，print-preview-ux-study-
 * 2026-10-09.md）。
 *
 * ── 为什么有这一层 ──
 * 她的原话：「每一个模板哪怕有别的模块加进来，也应该保持原本设计稿那样的基础展示
 * 方式」。期三的通用渲染是「一份内容组件 + 四套皮肤」——结构全是同一张 table，
 * 只换了字体/线色/行距（UX 研究 §2.1 的诊断）。期七把每模板的**结构语法**提成
 * 声明式 token，组件按 token 选渲染变体（§2.4 候选 2）：
 *   · 内容/列/截断/口径注仍在共享层（一份组件）；
 *   · 行形态（table/grid/blocks/staggered）、编号形态（giant/mono/tabular）、
 *     分章、分隔线、焦点行、视觉编码（KPI 带/进度条/堆叠条）按 token 分支。
 * 第五套模板出现时写第五份 token，不碰组件。
 *
 * ── 值表出处（§2.6，实现侧直接输入） ──
 * 模板级默认 §2.6.1 + 组合级覆盖 §2.6.2：一个组合的最终语法 = 模板默认 ⊕ 组合
 * 覆盖。两处条件降级（§2.6.3）在 resolveSyntax 里按行数落地：
 *   · E×M2：giant→mono（巨编号是目录身份装置，任务读号是密集表设备，且 24px
 *     衬线会把 20-30 行任务列表的行高顶破 40px）；
 *   · A×M1：rowForm staggered 仅 ≤9 条用，>9 回落 table+tabular（三列错落
 *     装不下就回 register 表——A 原生超过一页容量时自己也这么干）。
 *
 * ── 生产路由注意 ──
 * A×M1/M2/M4、E×M1/M4 在注册表里是**原生页**（A P1 时刻表本身就是 staggered，
 * E 原生三页本身就是 grid+giant+chaptering）⇒ 生产纸面不走通用路径；本 token
 * 机对这些组合是「注册表若翻通用时的落地态 + spec 强制 generic sheet 的参照」。
 * 生产走通用路径的是 D×M1/M2/M4、E×M2、H×M1/M2/M4 七个组合。
 */

import type { PrintModuleId } from '../../../components/print/print-templates';
import type { PrintTemplateId } from '../../../components/print/print-templates';

/** 结构语法 token（§2.4 六字段；extraEncodings 是 D 专属的视觉编码开关） */
export interface TemplateSyntax {
  /** 行形态：表格 / 目录 grid / 海报双栏块 / A 时刻表三列错落 */
  rowForm: 'table' | 'grid' | 'blocks' | 'staggered';
  /** 编号形态：24px 衬线巨编号 / 等宽 mono / tabular-nums */
  numberForm: 'giant' | 'mono' | 'tabular';
  /** 按状态分章（E 目录语法；章头不孤儿 + 跨页续头） */
  chaptering: boolean;
  /** 分隔线语言：发丝线 / 2px 粗表头线 / 2px 块粗上线 */
  divider: 'hairline' | 'heavy-rule' | 'block-rule';
  /** 焦点行（Agent 行）形态：反色 / 左粗签 / accent 文字 / 块焦点 */
  focusRow: 'invert' | 'left-sign' | 'accent-text' | 'block-focus';
  /** 额外视觉编码（D：「视觉编码是正文的一部分」） */
  extraEncodings: readonly ('kpi-band' | 'progress-bar' | 'stack-bar')[];
}

/** 四套外表的模板级默认（§2.6.1，每值有原生页出处，见文件头引用的设计文档） */
export const TEMPLATE_SYNTAX: Readonly<
  Record<Exclude<PrintTemplateId, 'classic'>, TemplateSyntax>
> = {
  // A：密集横线 register 表 + tabular 数字 + 2px 表头线 + Agent 反色行；按页分内容不分章
  'swiss-schedule': {
    rowForm: 'table',
    numberForm: 'tabular',
    chaptering: false,
    divider: 'heavy-rule',
    focusRow: 'invert',
    extraEncodings: [],
  },
  // D：硬边编辑网格 + mono 数字 + 信号色只给重点态；视觉编码是正文的一部分
  'data-editorial': {
    rowForm: 'table',
    numberForm: 'mono',
    chaptering: false,
    divider: 'heavy-rule',
    focusRow: 'accent-text',
    extraEncodings: ['kpi-band', 'progress-bar', 'stack-bar'],
  },
  // E：六列 grid 目录行 + 24px 衬线巨编号 + 按状态分章 + 发丝线 + 朱红左签
  'editorial-index': {
    rowForm: 'grid',
    numberForm: 'giant',
    chaptering: true,
    divider: 'hairline',
    focusRow: 'left-sign',
    extraEncodings: [],
  },
  // H：双栏块 + mono 数字 + 2px 块粗上线 + 门控焦点块；巨字（ap-giant）是页锚点，
  // 模块内不借——右栏摘要用大号 mono（§2.6.4）
  'agent-poster': {
    rowForm: 'blocks',
    numberForm: 'mono',
    chaptering: false,
    divider: 'block-rule',
    focusRow: 'block-focus',
    extraEncodings: [],
  },
};

/** 组合级覆盖（§2.6.2 的「组合级覆盖/备注」列；只列与模板默认不同的 token） */
const COMBO_OVERRIDES: Readonly<
  Partial<Record<PrintModuleId, Partial<Record<Exclude<PrintTemplateId, 'classic'>, Partial<TemplateSyntax>>>>>
> = {
  'stage-list': {
    // A×M1：三列错落 + 20px 序号（A 原生 P1 时刻表语法；>9 条回落见 resolveSyntax）
    'swiss-schedule': { rowForm: 'staggered', numberForm: 'giant' },
    // D×M1：KPI 带 + 行内进度条（D 原生 ProgressMatrixPage 的核心视觉编码）
    'data-editorial': { extraEncodings: ['kpi-band', 'progress-bar'] },
    // E×M1 / H×M1：模板默认（grid+giant+分章 / blocks+mono）
  },
  'task-list': {
    // E×M2：giant→mono 降级（§2.6.3：任务读号是密集表设备，无模板对任务列表用巨字）
    'editorial-index': { numberForm: 'mono' },
    // D×M2 / H×M2：模板默认（table+mono / blocks+mono；H 的 ≤8 卡化在组件层）
  },
  'member-roster': {
    // D×M4 / E×M4 / H×M4：模板默认（D accent-text 家族左签 / E grid+giant / H blocks）
  },
};

/**
 * 组合的最终语法 = 模板默认 ⊕ 组合覆盖；A×M1 的 >9 回落在此按行数落地
 * （staggered 仅 ≤9 条，>9 回落 table+tabular——与 A 原生「超容量回 register」
 * 同纪律）。classic 不走模块表 ⇒ null（调用方不渲染通用模块）。
 */
export function resolveSyntax(
  template: PrintTemplateId,
  module: PrintModuleId,
  rowCount: number,
): TemplateSyntax | null {
  if (template === 'classic') return null;
  const base = TEMPLATE_SYNTAX[template];
  const merged: TemplateSyntax = { ...base, ...COMBO_OVERRIDES[module]?.[template] };
  // A×M1 条件降级：三列错落装不下 >9 条 ⇒ 回落 register 表 + tabular 序号
  if (
    template === 'swiss-schedule' &&
    module === 'stage-list' &&
    merged.rowForm === 'staggered' &&
    rowCount > STAGGERED_MAX_ROWS
  ) {
    return { ...merged, rowForm: 'table', numberForm: 'tabular' };
  }
  return merged;
}

/** A×M1 三列错落的行数上限（3 列 × 3 条/列；A 原生 P1 的并列语法容量） */
export const STAGGERED_MAX_ROWS = 9;

/** 不含行数条件的组合语法（spec 静态锁用；A×M1 返回 staggered 声明值） */
export function syntaxOf(template: PrintTemplateId, module: PrintModuleId): TemplateSyntax | null {
  return resolveSyntax(template, module, 0);
}
