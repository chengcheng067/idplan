/**
 * 自绘标题栏（Electron `titleBarOverlay`）配色同步。
 *
 * ── 为什么需要这个模块 ──
 *   用户反馈「顶栏关闭栏与主题割裂」：设计稿的顶栏是内容区的一部分
 *   （画板 02 亮 #FFFFFF / 画板 12 暗 #1F2126，内容仅面包屑+搜索+头像三块），
 *   而原生 Windows 标题栏恒为系统灰白，两者拼接处颜色断层。
 *   解法是隐藏原生栏、改用叠加层（见 electron/main.cjs），叠加层颜色必须
 *   **跟着 `<html data-theme>` 走**，否则暗色下会出现「顶栏暗、按钮区亮」。
 *
 * ── 颜色从哪来（关键纪律）──
 *   一律读 CSS 变量的**实际计算值**（`--paper-rgb` / `--ink-rgb`），
 *   不在 JS 里另起一套 hex。理由：色值唯一真相源是 src/styles/global.css，
 *   这里再抄一份必然在下次改色时漂移（本项目已有「整类不显色」的前车之鉴）。
 *
 * ── 调用时机 ──
 *   必须在 `<html data-theme>` 写入**之后**调用。`getComputedStyle` 会强制
 *   同步样式重算，故写完立刻读即可拿到新主题的值，无需等 rAF。
 *
 * ── 降级 ──
 *   浏览器 / NAS 端 `window.idplan` 不存在 → 整个模块短路，零副作用。
 *   老版本 preload 未暴露 `setTitleBarTheme` → 同样短路（做存在性判断）。
 */

/** 顶栏高度：<xl 档与 TopBar 的 `h-14`（56px）一致 */
const TOPBAR_HEIGHT_COMPACT = 56;
/** 顶栏高度：≥xl 档与 TopBar 的 `xl:h-16`（64px）一致 */
const TOPBAR_HEIGHT_DESKTOP = 64;
/** xl 断点（与 tailwind.config.ts 的 screens.xl 严格一致，不得引入 lg=1024） */
const XL_MIN_WIDTH = 1280;

/** 兜底底色：亮色 --paper（#FFFFFF）。仅在 CSS 变量读不到时使用 */
const FALLBACK_COLOR = '#ffffff';
/** 兜底前景：亮色 --ink（#1F2937） */
const FALLBACK_SYMBOL = '#1f2937';

/** 把 0–255 的数值收敛到合法字节 */
function clampByte(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)));
}

/**
 * `'255 255 255'`（CSS 变量里的 RGB 三元组）→ `'#ffffff'`。
 * 解析失败（空串 / 非三元组 / 含非数字）返回 null，由调用方回落兜底值。
 */
function rgbTripleToHex(raw: string): string | null {
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .filter((s) => s.length > 0)
    .map((s) => Number.parseInt(s, 10));
  if (parts.length < 3) return null;
  if (parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  return `#${parts
    .slice(0, 3)
    .map((n) => clampByte(n).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** 读取 `:root` 上某个令牌变量的实际值并转成 hex；读不到时回落 fallback */
function readTokenHex(varName: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return fallback;
  }
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(varName);
  return rgbTripleToHex(raw) ?? fallback;
}

/**
 * 给定视口宽度下的顶栏高度（px）——**纯函数，不依赖 `window`**。
 *
 * 口径与 `TopBar` 的 `h-14 xl:h-16` 同一份：<1280 → 56，≥1280 → 64。
 *
 * ── 为什么单独导出（而不是让调用方自己比一下 innerWidth）──
 *   `titleBarHeight()` 读的是**当前** `window`，在 Node / jsdom 里拿不到；
 *   而验收测试需要在 **Node 侧**算出「原生三键占多高」，再拿它当基准去断言
 *   「浮层顶边 ≥ 三键底边」。若测试自己抄一份 `innerWidth >= 1280 ? 64 : 56`，
 *   本模块的口径一变（56/64 改成别的值），那份副本会**静默不同步** ——
 *   而它恰是断言另一边的基准，会直接把假绿放进来（断言比真实要求更松）。
 *   故把「按宽度取高度」这件事做成单一出处，测试与产品共用。
 */
export function titleBarHeightFor(viewportWidth: number): number {
  return viewportWidth >= XL_MIN_WIDTH ? TOPBAR_HEIGHT_DESKTOP : TOPBAR_HEIGHT_COMPACT;
}

/**
 * 当前顶栏高度（px）。与 TopBar 的 `h-14 xl:h-16` 同一口径：
 * <1280 → 56，≥1280 → 64。两者必须一致，否则原生三键会与顶栏内容纵向错位。
 *
 * 无 `window`（Node / 测试主进程）时返回桌面档 —— 仅作兜底，
 * 需要按宽度求值的调用方请直接用 `titleBarHeightFor`。
 */
export function titleBarHeight(): number {
  if (typeof window === 'undefined') return TOPBAR_HEIGHT_DESKTOP;
  return titleBarHeightFor(window.innerWidth);
}

/**
 * 把当前主题下的顶栏配色 + 高度同步给主进程。
 * 非桌面端 / 老 preload 静默短路（这是常态，不是错误）。
 */
let modalDepth = 0;

function darkenHex(hex: string, factor = 0.55): string {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  if (channels.some((channel) => !Number.isFinite(channel))) return hex;
  return `#${channels.map((channel) => clampByte(channel * factor).toString(16).padStart(2, '0')).join('')}`;
}

/** 把当前主题下的顶栏配色 + 高度同步给主进程；遮罩打开期间标题栏一并压暗。 */
export function syncTitleBarTheme(): void {
  if (typeof window === 'undefined') return;
  const bridge = window.idplan;
  if (!bridge || bridge.isDesktop !== true || typeof bridge.setTitleBarTheme !== 'function') return;
  const color = readTokenHex('--paper-rgb', FALLBACK_COLOR);
  bridge.setTitleBarTheme({
    color: modalDepth > 0 ? darkenHex(color) : color,
    symbolColor: readTokenHex('--ink-rgb', FALLBACK_SYMBOL),
    height: titleBarHeight(),
  });
}

/** 遮罩型 Modal 计数：嵌套弹窗仅在最后一个关闭后恢复原生三键背景。 */
export function dimTitleBarForModal(): void {
  modalDepth += 1;
  syncTitleBarTheme();
}

export function restoreTitleBarAfterModal(): void {
  modalDepth = Math.max(0, modalDepth - 1);
  syncTitleBarTheme();
}

/**
 * 订阅视口宽度跨越 xl 断点引起的高度变化（56 ↔ 64）。
 * 颜色不需要重算（主题切换时由 useTheme 主动调用），但高度随视口变，
 * 故监听 resize 重发一次；非桌面端返回空取消函数（调用方无需分支）。
 */
export function installTitleBarThemeSync(): () => void {
  if (typeof window === 'undefined' || !window.idplan?.isDesktop) {
    return () => undefined;
  }
  const onResize = (): void => syncTitleBarTheme();
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
