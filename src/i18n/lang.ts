/**
 * 界面语言状态源（中 / 英）。**手写最小实现，不引任何 i18n 库**。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么不用 i18next / react-intl（选型理由，别再讨论第二遍）
 * ══════════════════════════════════════════════════════════════════════
 *   ① 项目原则「尽量不加依赖」（§8.1，`tests/arch-boundary.spec.ts:4`
 *      把它从「现状」钉成了「被锁死的约束」）；
 *   ② 离线优先 + 三形态（桌面 / NAS / Docker）**共用同一份 build-dist**，
 *      多一层运行时库只增风险不增能力；
 *   ③ 打印的**分页 / 估高是纯函数**（`src/print/**`），引库在那种场合也用不了
 *      ——真引进来会形成「界面走库、纸面手写」的两套口径；
 *   ④ 仓库已有先例：`src/constants/agentTerms.ts:55` 的手写多轴表 +
 *      `tests/agent-ui-terms.spec.ts:45-52` 守着它。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★★ 可替换性（本模块存在的最大理由之一）★★
 * ══════════════════════════════════════════════════════════════════════
 * 若产品将来改主意要引第三方库，**只需重写 `src/i18n/` 这一层**：
 * 全仓消费方（组件 / store / 打印层）一律只经 `src/i18n` 的 `useLang()` /
 * `t()` 取词，**不许直接 import `src/i18n/messages/*`**（这条由
 * `tests/i18n.spec.ts` 的源码守卫钉住）。收敛成单一出口是这里唯一不可让步
 * 的约束。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 结构与 `src/hooks/useTheme.ts` 逐条对齐（照抄样板，便于维护期一眼对照）
 * ══════════════════════════════════════════════════════════════════════
 *   1) **首屏不闪**：`index.html` 里有一段同步内联脚本先按 localStorage 写好
 *      `<html lang>` 与 `<html data-lang>`；本模块只负责接管后续变更，
 *      不作为首屏唯一依据。**真正的「首帧就是对的」靠的是另一条**：
 *      模块级 `let lang = readStoredLang() ?? DEFAULT_LANG` 在 import 期同步求值，
 *      而 `main.tsx` 在 `ReactDOM.createRoot().render()` **之前**就调用 `initLang()`
 *      ⇒ React 第一次渲染时 `getLang()` 已经是持久化的语言，不存在「先画一帧中文」。
 *   2) **优先级**：只有「用户显式选择」一个来源，**不跟随浏览器语言**。
 *      理由：默认语言必须是中文（既有 2742 条用例与全部产品文案口径都建立在
 *      「默认中文」上；`Accept-Language: en` 的浏览器打开时突然变英文属于
 *      无人要求的范围扩张）。⇒ 无选择时恒为 `'zh'`。
 *   3) **持久化降级**：localStorage 不可用（隐私模式 / 禁用 storage）时静默
 *      降级为「仅当前会话生效」，不抛错、不影响渲染。
 *   4) 文案本身不在这里，全部住在 `src/i18n/messages/`；
 *      这里只切换 `<html lang>` / `<html data-lang>`，整站自动换语言。
 */

export type Lang = 'zh' | 'en';

/** 出厂默认语言。⚠️ **绝不改为 'en'**（既有全量用例与产品文案口径按中文建立） */
export const DEFAULT_LANG: Lang = 'zh';

/** 全部语言（顺序即 UI 呈现顺序，见 settings 的「外观 › 语言」） */
export const ALL_LANGS: readonly Lang[] = ['zh', 'en'];

const STORAGE_KEY = 'idplan-lang';

function isLang(v: string | null): v is Lang {
  return v === 'zh' || v === 'en';
}

/** 读取用户显式选择；无 / 脏值 → null（由调用方回落 DEFAULT_LANG） */
function readStoredLang(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

/** `<html lang>` 的属性值：中文用带地区的 `zh-CN`（与改造前 index.html 逐字一致） */
function htmlLangValue(l: Lang): string {
  return l === 'en' ? 'en' : 'zh-CN';
}

/**
 * 落 DOM：`<html lang>` 影响无障碍朗读与浏览器翻译提示；
 * `<html data-lang>` 供 CSS `[data-lang="en"]` 选择器使用（如英文行长规则）。
 * 两者都必须写——只写 lang 的话 CSS 侧没有钩子，只写 data-lang 则朗读器仍是中文。
 */
function applyDocumentLang(l: Lang): void {
  document.documentElement.lang = htmlLangValue(l);
  document.documentElement.dataset.lang = l;
}

// —— 极小的外部 store：让任意多个组件共享同一份语言状态（同 useTheme 的形态）——
let lang: Lang = readStoredLang() ?? DEFAULT_LANG;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前语言（快照是**原始值**，useSyncExternalStore 直接用 === 判定变化） */
export function getLang(): Lang {
  return lang;
}

/** 服务端 / 首帧快照：与出厂默认一致（SSR 不存在，这里只给 jsdom 与预渲染兜底） */
export function getLangServerSnapshot(): Lang {
  return DEFAULT_LANG;
}

/**
 * 切换语言：写内存 + 落 DOM + 持久化（存储不可用静默降级）。
 * 同步生效——订阅方（`useLang()`）在同一次 React 更新里拿到新语言，无需刷新。
 */
export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  applyDocumentLang(lang);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* 存储不可用：仅当前会话生效，忽略 */
  }
  emit();
}

export { subscribe as subscribeLang };

/**
 * 在 `main.tsx` 渲染前调用一次：把内存里的语言同步到 DOM。
 * 与 `index.html` 的内联脚本互补——内联脚本防「样式生效前属性未就位」，
 * 这里负责「内联脚本被剥离 / localStorage 内容损坏时，DOM 与内存严格一致」。
 * 与 `initSidebarCollapsed()` 同款对齐纠正语义。
 */
export function initLang(): void {
  applyDocumentLang(lang);
}
