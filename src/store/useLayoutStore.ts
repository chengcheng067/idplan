import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * 布局瞬态状态（v0.7 · 子系统 ① · N03 / T18）。
 *
 * 为什么**新建独立 store** 而不塞进 `useUiStore`（架构决策，§3.3.3）：
 *   `useUiStore` 现为**非持久化**（其文件头注释明说「刷新即失，不落库」），
 *   且承载月历筛选（`calendarFilters.status/stage` 是 `Set` 类型——JSON 化会丢）。
 *   若直接给它加 `persist`，要么波及既有月历逻辑（Set 序列化破坏），
 *   要么得为每个字段写 partialize 特例，改动面大幅扩大且回归风险高。
 *   故本处新建独立 store：**只装布局态、零业务数据**，零回归风险。
 *   `useUiStore` 的持久化改造只在子系统 ② 需要（那时也只 partialize
 *   `agentBoardMode` 一个字段），与本 store 互不干扰。
 *
 * ── R13（首屏闪烁 FOUC）对策，两条同时生效 ──
 * 1. **首帧前同步读**：`persist` 默认 `skipHydration: false` → 在 store 创建时
 *    （即模块求值期，早于 React 首次渲染）就**同步**从 localStorage 读回
 *    `sidebarExpanded`，因此首帧拿到的就是正确宽度，不会出现「先 64px 再跳
 *    240px」的宽度跳变。
 * 2. **`index.html` 防闪脚本 + `data-sidebar-collapsed`**：见 index.html 内联脚本与
 *    `applySidebarAttrEarly()`。即便将来有人给 store 加了 SSR / 异步 hydration，
 *    首帧的侧栏宽度也已由 DOM 属性决定，CSS 层不依赖 JS 时序。
 *
 * ── D3 断点纪律（严格锁 xl=1280，不引入新 Tailwind 断点类）──
 *   ≥1280      展开 240px / 可切 64px，**持久化**
 *   1024–1280  默认收起 64px（由 `defaultExpanded()` 的 matchMedia 推断首启值）
 *   <768       抽屉（覆盖层，点击展开非悬停）；<1280 一律走抽屉
 * 「1024–1280 默认收起」无法用纯 CSS 表达——CSS 只能表达「某断点下长什么样」，
 * 无法表达「首次进入的默认值」与「用户切换后持久化」的**叠加**语义。故必须
 * 由 JS 状态驱动：`matchMedia('(min-width: 1280px)')` 决定首启默认值。
 */

/** localStorage key（与 index.html 防闪脚本、useLayoutStore.persist 三处必须一致） */
export const LAYOUT_STORAGE_KEY = 'idplan.layout';

/** 与 Tailwind `xl` 严格对齐的断点（D3 锁 1280，禁止改成 lg/2xl） */
export const SIDEBAR_BREAKPOINT_PX = 1280;

export interface LayoutState {
  /** 侧栏展开态（≥xl 有效；<xl 走抽屉，本字段不参与形态决策） */
  sidebarExpanded: boolean;
  /** 抽屉开合（<xl；按会话，**不**持久化 —— D3：抽屉开合不强制持久化） */
  sidebarDrawerOpen: boolean;

  toggleSidebar(): void;
  setSidebarExpanded(v: boolean): void;
  openSidebarDrawer(): void;
  closeSidebarDrawer(): void;
}

/**
 * 首启默认：≥1280（xl）展开；1024–1280 / <768 收起（D3）。
 * 仅在「本地无持久值」时被采用——用户切换过就一律以持久值为准。
 */
export function defaultExpanded(): boolean {
  if (typeof window === 'undefined') return true;
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(`(min-width: ${SIDEBAR_BREAKPOINT_PX}px)`).matches;
}

/** 当前视口是否达到 xl（侧栏以持久左栏形态渲染的档位） */
export function isXlViewport(): boolean {
  if (typeof window === 'undefined') return true;
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(`(min-width: ${SIDEBAR_BREAKPOINT_PX}px)`).matches;
}

/**
 * 把折叠态写到 `<html data-sidebar-collapsed>`。
 *
 * 为什么走 DOM 属性而不是直接把状态喂给 className：
 *   侧栏宽度需要由一个**不依赖 React 渲染时序**的源头决定，才能在首帧前生效
 *   （配合 index.html 的同步内联脚本，R13）。CSS 里用
 *   `[data-sidebar-collapsed='true']` 选择器读取，React 只负责后续同步。
 */
export function applySidebarAttr(collapsed: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.sidebarCollapsed = collapsed ? 'true' : 'false';
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarExpanded: defaultExpanded(),
      sidebarDrawerOpen: false,

      toggleSidebar: () =>
        set((s) => {
          const next = !s.sidebarExpanded;
          applySidebarAttr(!next);
          return { sidebarExpanded: next };
        }),
      setSidebarExpanded: (v) => {
        applySidebarAttr(!v);
        set({ sidebarExpanded: v });
      },
      openSidebarDrawer: () => set({ sidebarDrawerOpen: true }),
      closeSidebarDrawer: () => set({ sidebarDrawerOpen: false }),
    }),
    {
      name: LAYOUT_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // 只持久化展开态；抽屉态按会话（D3）。
      // 注意：**不能**持久化 sidebarDrawerOpen——否则刷新后抽屉自动弹开，
      // 在小屏上会盖住全屏内容，属于「上次会话的瞬时状态」而非偏好。
      partialize: (s) => ({ sidebarExpanded: s.sidebarExpanded }),
      /**
       * 每次从 localStorage 恢复 / 每次写入后，都把折叠态同步到 DOM 属性。
       * `onRehydrateStorage` 在**同步 hydration 完成时立即**回调（persist 默认
       * 同步 storage 就是同步的），因此这一步与首帧渲染同一批次完成，
       * 不会产生「首帧 240px → 次帧 64px」的跳变（R13）。
       */
      onRehydrateStorage: () => (state) => {
        if (state) applySidebarAttr(!state.sidebarExpanded);
      },
    },
  ),
);

/**
 * 首帧前的**同步**引导：在 `main.tsx` 渲染前调用一次。
 *
 * 与 `initTheme()` 同一模式（`main.tsx:65`）。index.html 的同步内联脚本已做过
 * 一次（保证 CSS 生效前 DOM 属性就位），这里再跑一次是为了：
 *   1) 覆盖「内联脚本被 CSP / 构建工具剥离」的降级场景；
 *   2) 让 `<html data-sidebar-collapsed>` 与 zustand 内存状态**严格一致**
 *      （内联脚本只读原始 localStorage JSON，这里走 persist 的解析结果，
 *       若 localStorage 内容损坏，persist 会回落到 defaultExpanded()，
 *       本函数负责把 DOM 属性也纠正到同一结果——避免 DOM 与内存状态打架）。
 *
 * 幂等：重复调用结果一致。
 */
export function initSidebarCollapsed(): void {
  const expanded = useLayoutStore.getState().sidebarExpanded;
  applySidebarAttr(!expanded);
}
