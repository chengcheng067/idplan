/**
 * `src/i18n/date.ts` —— 日期与时间的**语言出口**（本版 ⑤e 项）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么要**两条**出口，而不是「一个函数加个 lang 默认值」
 * ══════════════════════════════════════════════════════════════════════
 * 全仓对日期文案有**相反**的两条要求：
 *   · **屏幕**（时间轴刻度、月历日期行）⇒ 必须跟随界面语言；
 *   · **纸面**（排期纸、甘特纸）⇒ **必须恒为中文**：打印稿是交付物，
 *     它的语言不该随「我今天把界面切成了英文」而变（`useSchedulePaperData` /
 *     `print-gantt` 两处调用点）。
 * 若写成 `formatMonthYear(d, lang = 'zh')`，**漏传 lang 会静默退化成中文** ——
 * 而「静默退化」正是本项要修的那个形态。分开成两条出口后：
 *   · 纸面调用点**根本拿不到** lang 参数（想传也传不了）；
 *   · 屏幕调用点必须显式把 `lang` 传进 `*Localized` 那一支。
 * 判据因此是**结构上的**，不靠人记。
 *
 * 取词口径：屏幕侧的日期**拼接**只用本文件的函数，不在组件里手写 `年/月/日`；
 * 纸面侧同理（默认参数就是中文那一支）。
 * ⚠️ 本文件**不是** `useLang()` 的替代品：组件仍要调 `useLang()` 来订阅语言变化，
 *    本文件的 `*Localized` 只是在渲染期被调用的**纯格式化**函数。
 */
import dayjs from 'dayjs';

/** zh 侧星期名（索引 0..6 = 周日..周六，与 `dayjs().day()` 同序） */
const ZH_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const;

/* ───────────────────────── 纸面出口（无语言分支，恒中文） ───────────────────────── */

/**
 * 月刻度标签：`2026年9月`。
 * **无语言分支** —— 纸面（打印）固定中文，见文件头。屏幕侧请用
 * `formatMonthYearLocalized`。
 */
export function formatMonthYear(date: string | Date): string {
  return dayjs(date).format('YYYY年M月');
}

/**
 * 半月刻度标签：`9月·上` / `9月·下`。**无语言分支**（同上）。
 * `part`：`first` = 上半月（1–15），`second` = 下半月（16–月末）。
 */
export function formatMonthPart(date: string | Date, part: 'first' | 'second'): string {
  const m = dayjs(date).format('M月');
  return part === 'first' ? `${m}·上` : `${m}·下`;
}

/* ───────────────────────────── 屏幕出口（随语言） ───────────────────────────── */

/** 月刻度标签（屏幕）：zh `2026年9月` / en `Sep 2026` */
export function formatMonthYearLocalized(date: string | Date, lang: string): string {
  if (lang === 'en') return dayjs(date).format('MMM YYYY');
  return formatMonthYear(date);
}

/** 半月刻度标签（屏幕）：zh `9月·上` / en `Sep · 1st half`（英文补空格，中文不加） */
export function formatMonthPartLocalized(
  date: string | Date,
  part: 'first' | 'second',
  lang: string,
): string {
  if (lang === 'en') {
    const m = dayjs(date).format('MMM');
    return `${m} · ${part === 'first' ? '1st half' : '2nd half'}`;
  }
  return formatMonthPart(date, part);
}

/**
 * 月历「选中日期」详情行：zh `8月28日，星期五` / en `Aug 28, Friday`
 * （画板 19 的移动端日期详情行；原实现手写「M月D日，星期X」，此处保留 zh 逐字不变）。
 */
export function formatSelectedDateLocalized(iso: string, lang: string): string {
  const d = dayjs(iso);
  if (lang === 'en') return d.format('MMM D, dddd');
  return `${d.month() + 1}月${d.date()}日，${ZH_WEEKDAYS[d.day()]}`;
}

/**
 * 「日 + 月」短标签（无星期、无年份）：zh `8 月 28 日` / en `Aug 28`。
 *
 * ── 为什么是**第三条**出口，而不是复用上面那条 ──
 * `DayItemsPopover` 的头部取值是 **`8 月 28 日`（数字与「月/日」之间带空格）**，
 * 而 `formatSelectedDateLocalized` 给的是 **`8月28日，星期五`（不带空格、带星期）**。
 * 两者**不是同一个取值** ⇒ 直接复用会改 zh 渲染（zh 逐字不变是硬线）。
 *
 * ⚠️ 它属于**本模块**（`src/i18n/date.ts`）而不是消息表：日期拼接口径只能有一处出处，
 *    塞进消息表就变成「本仓第三种月份/日期格式」（前两条见本文件头）。
 * ⚠️ 与上面那条同样是**屏幕出口**：`lang` 必填、无缺省值（漏传即编译错）。
 *    纸面（打印）不用它 —— 打印稿的日期走 `formatMonthYear` 那一支。
 */
export function formatDayMonthLocalized(iso: string, lang: string): string {
  const d = dayjs(iso);
  if (lang === 'en') return d.format('MMM D');
  return `${d.month() + 1} 月 ${d.date()} 日`;
}
