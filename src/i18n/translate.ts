/**
 * 取词实现（`t`）。**组件不要直接 import 本文件**——统一从 `src/i18n` 取
 * （见 `src/i18n/index.ts` 的说明与 `tests/i18n.spec.ts` 的单一出口守卫）。
 *
 * 为什么单独一个文件、而不把 `t()` 塞进 `lang.ts`：
 * 状态（`lang.ts`）与查表（本文件）职责不同；更要紧的是 `useLang.ts` 需要
 * `t()`，而 `index.ts` 需要 `useLang`——两者放同一个文件会形成 index ↔ useLang
 * 的循环 import（ESM 能跑，但首帧求值顺序会变得脆弱）。拆开后依赖是单向的：
 *   messages/*  ←  translate.ts  ←  useLang.ts  ←  index.ts
 */
import { zhMessages, type MessageKey } from './messages/zh';
import { enMessages } from './messages/en';
import { getLang, type Lang } from './lang';

/** 插值变量（`{name}` / `{count}` 这类占位符的取值） */
export type InterpolationVars = Record<string, string | number>;

/**
 * 语言 → 文案表。类型是 `Record<MessageKey, string>`（**不是** `Partial`）
 * ⇒ 任何一份表缺键都在编译期报错，运行期不需要「查不到给兜底」的分支。
 */
const CATALOGS: Record<Lang, Record<MessageKey, string>> = {
  zh: zhMessages,
  en: enMessages,
};

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * 按键取词。`lang` 缺省取当前语言（模块级 store，同步读）。
 *
 * - 键不存在 → **编译错**（`MessageKey` 是字面量联合），运行期不会静默返回键名；
 * - `vars` 缺省时直接返回原文（不做正则开销）；
 * - 占位符找不到对应变量时**原样保留** `{name}`——这样漏传变量会被一眼看见，
 *   而不是渲染成 `undefined`。
 */
export function t(key: MessageKey, vars?: InterpolationVars, lang: Lang = getLang()): string {
  const raw = CATALOGS[lang][key];
  if (vars === undefined) return raw;
  return raw.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** 运行期判键（供守卫 spec 与调试使用；正常业务代码不需要） */
export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(zhMessages, key);
}

/** 全部文案键（顺序即中文表声明顺序。供守卫 spec 做两表逐键对照） */
export const MESSAGE_KEYS = Object.keys(zhMessages) as MessageKey[];

/** 指定语言的一份文案表（供守卫 spec 做「与 enums 的中文值逐键一致」对照） */
export function catalogOf(lang: Lang): Record<MessageKey, string> {
  return CATALOGS[lang];
}
