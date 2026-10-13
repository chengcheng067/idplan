/**
 * `useLang()` —— 组件取词与切语言的**唯一 hook 出口**。
 *
 * 用法（全仓统一，不许有第二种）：
 * ```tsx
 * const { t, lang, setLang } = useLang();
 * <span>{t('nav.projects')}</span>
 * ```
 *
 * ⚠️ 三条纪律：
 *   ① **不许直接 import `src/i18n/messages/*`**（那是「可替换性」的命根子：
 *      将来若换成第三方库，只改 `src/i18n/` 一层就够）；
 *   ② 用到 `t()` 的组件**必须**调 `useLang()`——它同时是语言变化的订阅点。
 *      只在模块顶层 `t(...)` 存成常量的话，切语言时不会重渲染（语言只在
 *      首次 import 那一刻被求值）。所以本仓的标签表一律是「`(x) => t(KEY[x])`
 *      的函数形态」，不是常量表；
 *   ③ 非组件代码（store / 工具函数）用 `import { t } from '../../i18n'` 直接调
 *      ——`t()` 读的是同一个模块级 store，随时取的是当前语言；但**它不会订阅**，
 *      所以只能用在「事件回调里算一次就完」的场合（如 toast 文案），
 *      不能用于渲染期求值的派生常量。
 */
import { useCallback, useSyncExternalStore } from 'react';

import {
  getLang,
  getLangServerSnapshot,
  setLang as setLangRaw,
  subscribeLang,
  type Lang,
} from './lang';
import { t as translate, type InterpolationVars } from './translate';
import type { MessageKey } from './messages/zh';

export interface UseLangResult {
  /** 当前语言 */
  lang: Lang;
  /** 切换语言（同步生效，无需刷新） */
  setLang(l: Lang): void;
  /** 取词（随语言变化返回新文案；组件已订阅，会自动重渲染） */
  t(key: MessageKey, vars?: InterpolationVars): string;
}

export function useLang(): UseLangResult {
  // 快照是原始字符串（'zh' | 'en'）⇒ useSyncExternalStore 的 === 判定天然正确，
  // 不需要像 useTheme 那样造合并对象。
  const lang = useSyncExternalStore(subscribeLang, getLang, getLangServerSnapshot);
  const setLang = useCallback((l: Lang) => {
    setLangRaw(l);
  }, []);
  const t = useCallback((key: MessageKey, vars?: InterpolationVars) => translate(key, vars, lang), [lang]);
  return { lang, setLang, t };
}
