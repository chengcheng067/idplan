/**
 * 核心层用户面错误文案的**载荷中文唯一出处**（英文补齐批 · core 片）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么核心层要自己持有一份中文表，而不直接调 `t('…')`
 * ══════════════════════════════════════════════════════════════════════
 * `src/core/**` **全目录不许 import i18n**：`src/i18n/lang.ts` 会引用 `document`，
 * 一旦被 core 引入就会把它拖进 `server/tsconfig.json` 那份**无 DOM** 的 program，
 * `npm run typecheck:server` 当场报 TS2584（`lib/date.ts`、`constants/agentTerms.ts`
 * 都栽过这条）。守卫是 `tests/custom-library-path-i18n.spec.ts` 的「豁免集**恰好**等于
 * 命中集」（唯一豁免 `src/core/plugin/PluginSandboxFrame.tsx`，它是渲染组件）。
 *
 * 所以取词**不在 core 发生**。本文件只做两件事：
 *   ① 持有**载荷口径**的中文模板（`ChangxiaError.userMessage` 的渲染输入）；
 *   ② 把模板键挂到错误对象上，供**渲染层**取词。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 两边不漂 = 可执行断言，不是注释
 * ══════════════════════════════════════════════════════════════════════
 * 同一个词因此有两个物理位置（本表 = 载荷口径；`src/i18n/messages/parts/core.ts`
 * = 界面口径）。这三张表的**键集必须两两相等、取值必须逐字相等**，由
 * `tests/core-error-i18n.spec.ts` 直接读三份并断言 —— 改任一侧都会红。
 * 本形态与已批准的 `customLibrary` 裁 3 / 裁 4、以及 `electron/plugin-install.cjs`
 * 的「**主进程不持有界面语言 ⇒ 返回机器码，渲染层映射**」同款。
 *
 * ⚠️ 判据（别把这条表当成"界面文案表"来改）：
 *   · 这里的取值**逐字节等于改动前源码里那句字面量** —— `userMessage` 是
 *     `agent-loopback` 回给**外部 Agent** 的协议字段（读者是对方的程序），
 *     改一个字节都是契约变更；
 *   · 界面英文走 `t(messageKey)`，**不从这里取**。
 */

/** 插值参数（与 `src/i18n` 的 `InterpolationVars` 同形；core 不许 import 它） */
export type CoreErrorParams = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * 键 → 中文模板。键名一律 `coreErr.<名词>.<做什么>`，与消息表里的键**逐字同名**。
 *
 * 取值纪律：**与改动前源码里的字面量逐字节一致**（含标点，含全角括号）。
 * 原本是模板串的（如 `` `「${name}」起止日期倒置。` ``）在这里写成 `{name}` 占位，
 * 渲染结果与原文一字不差。
 */
export const CORE_ERROR_TEXT = {
  /* ── 阶段仓储 / 阶段服务 ── */
  'coreErr.stage.listReadFailed': '阶段列表读取失败。',
  'coreErr.stage.readFailed': '阶段读取失败。',
  'coreErr.stage.draftIncomplete': '阶段草稿字段不完整，无法入库。',
  'coreErr.stage.rangeReversed': '「{name}」起止日期倒置。',
  'coreErr.stage.bulkWriteFailed': '阶段批量写入失败。',
  'coreErr.stage.notFound': '未找到该阶段。',
  'coreErr.stage.badDate': '日期格式无效。',
  'coreErr.stage.endBeforeStart': '新截止日早于开始日，已拒绝保存。',
  'coreErr.stage.newRangeInvalid': '新起止日期无效。',
  'coreErr.stage.newEndBeforeStart': '新的截止日早于开始日。',
  'coreErr.stage.postponeReasonRequired': '截止日后移必须填写延期原因（PRD 硬规则），否则不予保存。',
  'coreErr.stage.completedOnlyReopenInProgress': '已完成阶段仅允许重新开启为「进行中」。',

  /* ── 成员仓储 ── */
  'coreErr.member.listReadFailed': '成员列表读取失败。',
  'coreErr.member.readFailed': '成员读取失败。',
  'coreErr.member.nameRequired': '成员姓名不能为空。',
  'coreErr.member.createFailed': '成员创建失败。',
  'coreErr.member.notFound': '未找到该成员。',
} as const;

/** 机器可读的载荷文案键（= 上表的键；渲染层用 `t(messageKey)` 取界面口径） */
export type CoreErrorKey = keyof typeof CORE_ERROR_TEXT;

/** 该串是不是本表的键（供 `coreError()` 以外的调用方自检；正常路径不需要） */
export function isCoreErrorKey(key: string): key is CoreErrorKey {
  return Object.prototype.hasOwnProperty.call(CORE_ERROR_TEXT, key);
}

/**
 * 渲染**载荷中文**（= 改动前源码里那句字面量）。
 *
 * 占位符缺变量时**原样保留** `{name}` —— 与 `src/i18n/translate.ts` 的 `t()` 同口径：
 * 漏传变量要一眼看得见，而不是渲染成 `undefined` 混进协议字段。
 */
export function coreErrorText(key: CoreErrorKey, params?: CoreErrorParams): string {
  const raw: string = CORE_ERROR_TEXT[key];
  if (params === undefined) return raw;
  return raw.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}
