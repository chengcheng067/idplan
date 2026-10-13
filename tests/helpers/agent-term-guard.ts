/**
 * Agent 术语表的**判别力核心**（纯函数，供 `tests/i18n-agent-terms.spec.tsx` 使用）。
 *
 * 这里只放「判据」本身，不放被扫的对象 —— 对象（键表 / 两份语言表 / 登记表 / 全仓源码）
 * 由 spec 侧喂进来。这样**反例自证**才能在同一份实现上跑：
 * 把对象换成一个故意造错的替身，判据必须变红；换回真对象，必须零违规。
 *
 * 判据形状的两条讲究（都是本仓实测过的假绿形态）：
 *   ① 「文件里出现 `termFor(`」必须**先剥注释**（`maskComments`）—— 否则一句
 *      「调用点 `termFor(key, mode)` 的 mode 参数…」的注释就能把守卫喂饱
 *      （`src/store/useLayoutStore.ts:88` 正是这种注释，且那个文件**没有** `useLang()`，
 *      不剥注释这条守卫会立刻**误报**）。
 *   ② 「两类读者取值必须不同」的判据是**逐语言**的，不是全语言公理：见
 *      `MODE_COLLAPSED_KEYS` 的说明。
 */
import { maskComments } from './cjk-locator-guard';

/** 键表形态：术语 key → 模式 → 文案键（值此处只当字符串用，不依赖 MessageKey 类型） */
export type KeyTable = Record<string, { human: string; tech: string }>;

/** 一份语言表：文案键 → 取值 */
export type Catalog = Record<string, string>;

/** 忽略首尾空白 + 大小写后的比较值（「只差大小写」不算两类读者的不同措辞） */
export function normTerm(value: string): string {
  return value.trim().toLowerCase();
}

export interface CollapseFinding {
  lang: string;
  key: string;
  human: string;
  tech: string;
}

function modesOf(table: KeyTable, key: string): { human: string; tech: string } {
  return table[key]!;
}

/**
 * **会报**：在两列取值实际重合、但**没有**登记的语言/键上，返回违规项。
 * 真实的 zh / en 两份表跑出来必须是 `[]`（见 spec 的「不误报」用例）。
 */
export function findUnregisteredCollapses(
  table: KeyTable,
  catalogs: Record<string, Catalog>,
  registered: Record<string, readonly string[]>,
): CollapseFinding[] {
  const out: CollapseFinding[] = [];
  for (const key of Object.keys(table)) {
    const { human, tech } = modesOf(table, key);
    for (const lang of Object.keys(catalogs)) {
      const catalog = catalogs[lang]!;
      const h = catalog[human];
      const t = catalog[tech];
      if (h === undefined || t === undefined) continue; // 缺键由别的守卫管（编译期即红）
      if (normTerm(h) !== normTerm(t)) continue;
      if ((registered[lang] ?? []).includes(key)) continue;
      out.push({ lang, key, human: h, tech: t });
    }
  }
  return out;
}

/**
 * **反向**：登记表里写了「这两列重合」、而实际**并不重合**的项 ⇒ 也要报。
 *
 * 没有这条，「登记表」会慢慢腐化成一张只会越来越长的豁免清单（登记一次就永远不用管）；
 * 有了它，取值一旦被改得不同了，那行登记本身就成了必须清掉的债。
 */
export function findStaleRegistrations(
  table: KeyTable,
  catalogs: Record<string, Catalog>,
  registered: Record<string, readonly string[]>,
): Array<{ lang: string; key: string }> {
  const out: Array<{ lang: string; key: string }> = [];
  for (const lang of Object.keys(registered)) {
    const catalog = catalogs[lang];
    if (catalog === undefined) continue; // 没这把语言的表：登记无意义，由别的用例管
    for (const key of registered[lang] ?? []) {
      if (table[key] === undefined) {
        out.push({ lang, key });
        continue;
      }
      const { human, tech } = modesOf(table, key);
      const h = catalog[human];
      const t = catalog[tech];
      if (h === undefined || t === undefined) continue;
      if (normTerm(h) !== normTerm(t)) out.push({ lang, key });
    }
  }
  return out;
}

/**
 * **反应性**：`termFor` 不是 React hook、不订阅语言变化（同 `labels.ts` 其余取词函数）。
 * ⇒ 凡源码里**调用**了 `termFor(` 的文件，必须同时出现 `useLang(`，否则切语言后
 * 该组件不重渲染（用户可感知，且中文态完全看不出来）。
 *
 * 豁免：`src/constants/**` 与 `src/i18n/**` 自身（定义处与类型处，不是渲染点）。
 * 判据在 `maskComments` 剥注释后的源码上跑（理由见文件头 ①）。
 */
export function scanTermReactivity(
  files: ReadonlyArray<{ path: string; source: string }>,
): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    if (/^src\/(constants|i18n)\//.test(file.path)) continue;
    const code = maskComments(file.source);
    if (!/\btermFor\(/.test(code)) continue;
    if (!/\buseLang\(/.test(code)) offenders.push(file.path);
  }
  return offenders;
}
