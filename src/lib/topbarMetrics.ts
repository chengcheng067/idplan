/**
 * 顶栏高度度量（px）——**纯函数，无 IPC、无主题耦合**。
 *
 * ── 这个模块的来历（2026-09-23 自绘三键重构）──
 * 原 `titleBarTheme.ts` 混了两职：① 顶栏高度口径（本文件保留的）；
 * ② 原生 titleBarOverlay 叠加层的配色同步 + 弹窗压暗（已随自绘三键整类删除——
 * 叠加层由系统合成器画在网页之上，DOM 遮罩盖不住它，压暗近似必然修不好
 * 「弹窗一开三键像贴上去的」，见 TopBar.tsx 文件头）。高度口径与叠加层无关，
 * 迁移到此处；overlay 时代的同文件其余导出（syncTitleBarTheme / dimTitleBarForModal
 * / restoreTitleBarAfterModal / installTitleBarThemeSync）**全部退役，不要复活**。
 *
 * ── 为什么单独导出（而不是让调用方自己比一下 innerWidth）──
 *   `titleBarHeight()` 读的是**当前** `window`，在 Node / jsdom 里拿不到；
 *   而验收测试需要在 **Node 侧**算出「顶栏占多高」，再拿它当基准去断言
 *   「浮层顶边 ≥ 顶栏底边」。若测试自己抄一份 `innerWidth >= 1280 ? 64 : 56`，
 *   本模块的口径一变（56/64 改成别的值），那份副本会**静默不同步** ——
 *   而它恰是断言另一边的基准，会直接把假绿放进来（断言比真实要求更松）。
 *   故把「按宽度取高度」这件事做成单一出处，测试与产品共用。
 */

/** 顶栏高度：<xl 档与 TopBar 的 `h-14`（56px）一致 */
const TOPBAR_HEIGHT_COMPACT = 56;
/** 顶栏高度：≥xl 档与 TopBar 的 `xl:h-16`（64px）一致 */
const TOPBAR_HEIGHT_DESKTOP = 64;
/** xl 断点（与 tailwind.config.ts 的 screens.xl 严格一致，不得引入 lg=1024） */
const XL_MIN_WIDTH = 1280;

/** 给定视口宽度下的顶栏高度（px）——纯函数，不依赖 `window`。 */
export function titleBarHeightFor(viewportWidth: number): number {
  return viewportWidth >= XL_MIN_WIDTH ? TOPBAR_HEIGHT_DESKTOP : TOPBAR_HEIGHT_COMPACT;
}

/**
 * 当前顶栏高度（px）。与 TopBar 的 `h-14 xl:h-16` 同一口径：
 * <1280 → 56，≥1280 → 64。无 `window`（Node / 测试主进程）时返回桌面档 ——
 * 仅作兜底，需要按宽度求值的调用方请直接用 `titleBarHeightFor`。
 */
export function titleBarHeight(): number {
  if (typeof window === 'undefined') return TOPBAR_HEIGHT_DESKTOP;
  return titleBarHeightFor(window.innerWidth);
}
