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
 *   ④ 仓库已有先例：手写的多轴术语表（**#354 起移到本层的 `labels.ts`**，
 *      见 `AGENT_TERM_KEYS` / `termFor`；原在 `src/constants/agentTerms.ts`）
 *      ＋ `tests/agent-ui-terms.spec.ts` 守着它。
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
 *   2) **优先级**：用户显式选择（localStorage `idplan-lang`）> 系统语言。
 *      用户没选过时**跟随系统语言**；一旦在 设置 › 外观 › 语言 里显式选过，
 *      就以用户选择为准，系统语言再怎么变都不影响。
 *      —— 这与 `src/hooks/useTheme.ts` 的语义**逐条对齐**（那里是
 *      用户显式 light/dark > `prefers-color-scheme`）：两处都是「默认跟随系统，
 *      用户一动手就锁定」，同一个产品里不该有两套默认语义。
 *      ⇒ 无显式选择时取 `detectSystemLang()`（解析见该函数），解析不出中文/英文
 *      时回落 `DEFAULT_LANG`（'zh'）。
 *
 *      ⚠️ **本条是 2026-10-31 产品负责人拍板推翻的**：原设计是「不跟随浏览器语言、
 *      无选择恒为 'zh'」，理由当时是「2742 条用例与全部文案口径建立在默认中文上」。
 *      他明确要求改成跟随系统（原话：「要做的，而且我注意到主题默认是跟随系统这点就很好」），
 *      ⇒ 既有用例的「默认中文」前提改由**测试环境显式声明系统语言为中文**来维持
 *      （`tests/setup.ts` 末尾），而不是靠生产代码里写死 'zh'。
 *      这样生产语义（跟随系统）与测试基线（恒中文）各自成立、互不牵制。
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

/** 读取用户显式选择；无 / 脏值 → null（由调用方回落系统语言 / DEFAULT_LANG） */
function readStoredLang(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 把一个 BCP-47 语言标签解析成 `Lang`；解析不出中/英 → `null`。
 *
 * 判据（**故意只认中/英两档**，与 `Lang` 的取值域严格一致）：
 *   · 以 `zh` 开头（`zh` / `zh-CN` / `zh-Hans-CN` / `zh-TW` …）⇒ `'zh'`
 *   · 以 `en` 开头（`en` / `en-US` / `en-GB` …）⇒ `'en'`
 *   · 其它一切（`ja` / `de` / `fr` …）⇒ `null`（**不猜**，交给调用方回落 DEFAULT_LANG）
 *
 * ⚠️ **繁体中文（zh-TW / zh-HK）归到 `'zh'` 是有意的**：本仓只有 zh / en 两档，
 *    繁体用户的界面会得到简体文案——这比「日文用户拿到中文」更可接受，
 *    而且**没有开启「新增 zh-Hant 档」这个范围**（真要开是另一次产品决策）。
 * ⚠️ 大小写与下划线不做兼容（`zh_CN` 这种非标准写法不认）——浏览器给的
 *    `navigator.language` 一律是标准的连字符小写形式。
 */
function parseLangTag(tag: string): Lang | null {
  const lower = tag.toLowerCase();
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh';
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  return null;
}

/**
 * 探测系统语言（**唯一的系统语言来源**）。
 *
 * 优先 `navigator.languages`（用户在该语言的偏好列表，按优先级排序），
 * 逐个解析、取**第一个能解析成中/英**的；全都解析不出才用 `navigator.language`。
 * 为什么不是直接读 `navigator.language`：它对多语言用户只给首选项，
 * 而 `languages` 里可能同时有 `en-US` 与 `zh-CN`——取首个可解析项更符合
 * 「界面优先用我会的语言」的直觉。
 *
 * 降级：非浏览器环境（`typeof navigator === 'undefined'`）/ 读不到 ⇒ `null`，
 * 由调用方回落 `DEFAULT_LANG`。与 `useTheme.systemTheme()` 同款「环境缺失不抛错」口径。
 */
export function detectSystemLang(): Lang | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & { languages?: readonly string[] };
  const list = Array.isArray(nav.languages) && nav.languages.length > 0 ? nav.languages : null;
  if (list !== null) {
    for (const tag of list) {
      const hit = parseLangTag(tag);
      if (hit !== null) return hit;
    }
  }
  const single = nav.language;
  if (typeof single === 'string' && single !== '') return parseLangTag(single);
  return null;
}

/**
 * 当前应当生效的语言：**显式选择 > 系统语言 > 出厂默认**。
 *
 * 这是本模块「默认跟随系统」语义的**唯一解析处**——模块加载期与 `initLang()`
 * 都只经这里取值，不许第二处各自解析（会漂移成两套口径）。
 */
function resolveLang(): Lang {
  return readStoredLang() ?? detectSystemLang() ?? DEFAULT_LANG;
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
/**
 * ★ 模块级同步求值（首帧不闪的全部实现）：**必须**在这里就解析出「显式选择 / 系统语言 /
 * 默认」三者的结果，而不是等 React 渲染时再算。
 * 跟随系统后这条更重要：若初值写成 DEFAULT_LANG、等 `initLang()` 再纠正，
 * 首帧就会先画一帧中文再跳英文——那正是本文件头「不存在先画一帧中文」那条不变量
 * 被打破的形态。`detectSystemLang()` 同步、无 I/O，放在这里没有代价。
 */
let lang: Lang = resolveLang();
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
 * 在 `main.tsx` 渲染前调用一次：把内存里的语言同步到 DOM，并挂上系统语言监听。
 *
 * 与 `index.html` 的内联脚本互补——内联脚本防「样式生效前属性未就位」，
 * 这里负责「内联脚本被剥离 / localStorage 内容损坏时，DOM 与内存严格一致」。
 * 与 `initSidebarCollapsed()` 同款对齐纠正语义。
 *
 * ★ 系统语言监听（2026-10-31 跟随系统后新增，与 `initTheme()` 逐条对应）：
 *   `languagechange` 事件在系统/浏览器语言改变时触发。**仅在用户尚未显式选择时**
 *   才跟随（`readStoredLang() === null`）——一旦用户手动选过，系统怎么变都不动。
 *   ⚠️ 与主题的一处差别（有意的）：主题的 change 回调直接改 `current` 不动 `mode`；
 *   这里语言的「选择」与「生效值」是同一个 `Lang`（没有 `'system'` 哨兵位），
 *   所以直接 `setLang(下一个系统语言)`——但**必须不走 `setLang()`**，否则会把
 *   系统语言当成「用户显式选择」写进 localStorage，下次系统再变就不跟了。
 *   ⇒ 故这里手写「只改内存 + 落 DOM + 广播」这三步，**不落库**。
 */
export function initLang(): void {
  applyDocumentLang(lang);

  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('languagechange', () => {
    // 用户显式选过 ⇒ 锁定他的选择，系统语言变化一律忽略
    if (readStoredLang() !== null) return;
    const next = detectSystemLang() ?? DEFAULT_LANG;
    if (next === lang) return;
    lang = next; // 只改内存，**不写 localStorage**（见上方注释：它不是用户选择）
    applyDocumentLang(lang);
    emit();
  });
}
