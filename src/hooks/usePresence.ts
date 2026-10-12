import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 出口动画的前提：元素必须**活到出口动画播完**才卸载（presence 机制）。
 *
 * ── 为什么需要它 ───────────────────────────────────────────────────────
 * React 的条件渲染是「开关即卸载」：`open` 一翻 false，元素当场从 DOM 消失，
 * 定义层那六组 `*-out` keyframes 永远没有机会播。presence 做的唯一一件事，
 * 就是把「卸载」推迟到出口动画结束 —— 其余一律不碰。
 *
 * ── 与「出口不拦输入」的关系（team-lead 2026-10-11 定的规矩）────────────
 * 出口动画**绝不允许拦输入**。让元素多活 200ms 本身没有代价；代价只出现在
 * 「它在这 200ms 里还接受点击」。所以本 hook 在进入出口期的**同一帧**就把
 * `pointer-events: none` 打在元素上：视觉余韵与可操作性解耦 —— 用户关掉抽屉
 * 马上就能点下一页，抽屉的淡出只是**剩余的视觉余韵**，不承载任何交互等待。
 *
 * ── 四条硬要求（缺任何一条都会在生产里留下「元素永久留在 DOM」这类事故）──
 *   1. `prefers-reduced-motion: reduce` ⇒ **立即卸载，绝不等待**。
 *      reduce 下 CSS 里 `*-out` 的 `animation` 是 `none`，`animationend` 根本不会来，
 *      「等」就等于把元素永久留在页面上。判定**每次出口时现读**而不是订阅：
 *      系统开关可以在应用运行中改。
 *   2. 出口期间 `pointer-events: none`（见上）。
 *   3. 卸载 / 重开时清理监听与定时器，不留悬挂。
 *   4. **超时兜底 cap**：动画事件可能永远不来（CSS 未加载完、元素被 `display:none`、
 *      动画被中途取消、类名写错）。cap = 出口时长 + 一小段余量，到点强制卸载。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────
 * ```tsx
 * const p = usePresence(open, { enterClass: 'drawer-slide-in', exitClass: 'drawer-out-right' });
 * if (!p.mounted) return null;
 * return (
 *   <>
 *     <div ref={p.blockRef} className="overlay" />
 *     <div ref={p.exitRef} className="drawer-slide-in panel">…</div>
 *   </>
 * );
 * ```
 * - **`exitClass` 由本 hook 挂，不要再写进 JSX**；
 *   `enterClass` 由调用方的 JSX 负责首次入场（如现状），hook 只在出口启动时
 *   把它摘掉 —— 出口动画要**取代**入场动画，而不是两条动画挤在同一个
 *   `animation` 简写上抢级联（`animation-fill-mode: both` 下谁赢都不好）。
 *   重开时 hook 会把 `enterClass` 补回，保证 DOM 与 React 的 className 不漂移。
 * - `blockRef` 是给「动画元素 ≠ 需要停止接受输入的容器」准备的：Modal 的出口
 *   动画在面板上，但**拦住点击的是遮罩**，两者都必须是 `pointer-events: none`，
 *   否则用户点到的还是那个正在淡出的遮罩。两者同一个元素时（Toast 就是）
 *   只挂 `exitRef` 即可。
 * - 调用方必须用 `mounted` 做渲染门，否则「卸载」无从发生。`mounted` 的翻转是
 *   **渲染期同步**的（打开当帧就在场、关闭当帧就被扣住），不晚一帧 —— 晚一帧会
 *   同时坏两件事：① 元素晚一帧才交给 React，依赖 `[open]` 的 effect（Modal 的
 *   焦点入场）只跑那一次，抓到的是 null ref；② 关闭时元素先被卸载，动画没机会播。
 *   完整时序与实测见 `tests/use-presence.spec.tsx` 的「在场判定必须发生在渲染期」。
 */
export function usePresence(
  active: boolean,
  { exitClass, enterClass, exitMs = DEFAULT_EXIT_MS }: PresenceOptions,
): Presence {
  /**
   * 出口期「保留」标记：本次关闭要不要把元素扣在 DOM 里等动画。
   *
   * ★ 这个标记**必须在这一帧的渲染期**算出来，不能等 effect（原因见下方 `if` 块）。
   */
  const [retain, setRetain] = useState(false);
  /** 上一帧的 `active`，用来在渲染期识别「翻转方向」 */
  const [prevActive, setPrevActive] = useState(active);
  const [exiting, setExiting] = useState(false);
  const exitElRef = useRef<HTMLElement | null>(null);
  const blockElRef = useRef<HTMLElement | null>(null);
  /** 两个元素被改成 `none` 之前的内联值（'' = 本来没有内联值，还原成空串即恢复样式表口径） */
  const prevPeRef = useRef<{ exit: string; block: string } | null>(null);
  /** 本次出口是否摘过 `enterClass`（决定重开时要不要补回） */
  const strippedRef = useRef(false);

  /** 打上「不拦输入」。幂等：重复调用不会用已经被改成 none 的值覆盖原值。 */
  const block = useCallback(() => {
    if (prevPeRef.current) return;
    const exitEl = exitElRef.current;
    const blockEl = blockElRef.current;
    prevPeRef.current = {
      exit: exitEl?.style.pointerEvents ?? '',
      block: blockEl?.style.pointerEvents ?? '',
    };
    if (exitEl) exitEl.style.pointerEvents = 'none';
    if (blockEl) blockEl.style.pointerEvents = 'none';
  }, []);

  const unblock = useCallback(() => {
    const prev = prevPeRef.current;
    if (!prev) return;
    prevPeRef.current = null;
    if (exitElRef.current) exitElRef.current.style.pointerEvents = prev.exit;
    if (blockElRef.current) blockElRef.current.style.pointerEvents = prev.block;
  }, []);

  useEffect(() => {
    const el = exitElRef.current;

    if (active) {
      // 打开（含「出口期又打开」）：撤销出口态，元素回到入场态继续用。
      // 上一轮的监听与兜底定时器已由 cleanup 摘掉。
      unblock();
      if (el && strippedRef.current && enterClass) el.classList.add(enterClass);
      strippedRef.current = false;
      if (el && exitClass) el.classList.remove(exitClass);
      setExiting(false);
      return;
    }

    /*
     * 没进入出口期就无事可做。两种情形都会落到这里：
     *   · 本次关闭「不值得等」（无出口动画 / reduce）—— 渲染期就没扣住，元素当帧已卸载；
     *   · 出口已经收尾（`finish()` 把 `retain` 放掉）。
     */
    if (!retain) return;

    /*
     * 要求 1 的兜底复检：保留标记是**渲染期**算的，从这里到 effect 之间系统开关
     * 仍可能被改（reduce 可以在应用运行中打开）。宁可少一次动画，也绝不留在 DOM。
     * `!el` 同理 —— 调用方漏接 `exitRef` 时没有可等的东西，直接收尾（绝不会滞留在 DOM）。
     */
    if (!el || !exitClass || prefersReducedMotion()) {
      setExiting(false);
      setRetain(false);
      return;
    }

    if (enterClass) {
      el.classList.remove(enterClass);
      strippedRef.current = true;
    }
    el.classList.add(exitClass);
    setExiting(true);
    block();

    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      /*
       * ★ 2026-10-12「关闭频闪」修复（用户原话：「呼出设置以后再关闭设置会有频闪的现象」）。
       *
       * **不能在这里摘掉出口类。** 摘掉类 = 元素立刻回到**动画前**的样式；而六组
       * `*-out` 的终态是 `opacity: 0`、基态是 `opacity: 1` —— 这一行会让元素从
       * 「几乎透明」瞬间弹回「完全不透明」。从它执行到 React 真正把元素卸载之间，
       * 只要浏览器还绘了一帧（真机稳定复现：**整整一帧**），屏幕上就是整块面板
       * 全亮一下。
       *
       * 实测（真 Chromium，把出口动画冻在结束前一毫秒、然后**只做"摘类"这一步**，
       * 同一元素同一像素）：摘类前 rgb(200,202,206) L=202 opacity=0.0082；
       * 摘类后 rgb(255,255,255) L=255 opacity=1.0000 ⇒ **ΔL = +53**，且摘类时元素
       * 仍 `isConnected`。逐帧看更直观：出口 200ms 里 opacity 1→0.987→…→0.130
       * 一路单调下降，动画结束那一帧直接跳回 **1.0**，再下一帧才随卸载消失。
       * 三个关闭方式（X / Esc / 点遮罩）与另一族消费方（<xl 左导航抽屉）逐帧同形
       * ⇒ 这是一族的 bug，不是设置抽屉独有。
       *
       * 为什么是**删掉**而不是"延后几帧再摘"：这条 remove 在两个正常路径上都是多余的 ——
       *   · 关闭路径：`setRetain(false)` ⇒ `mounted=false` ⇒ 消费方按契约 `return null`，
       *     元素整个卸载，摘不摘都看不见；
       *   · 重开路径：本文件上方 `active` 分支已经负责摘掉出口类并补回入场类。
       * 它想必是想当"消费方没按契约卸载"的兜底，但那会让兜底场景**更糟**：
       * 元素从"已淡出、看不见"变成"弹回全亮、看得见却关不掉"。
       *
       * 回归闸：`tests/settings-drawer-flicker.spec.ts`（真 Chromium 逐帧：元素仍挂载
       * 期间 opacity 不得回升、出口类不得缺席）＋ `tests/use-presence.spec.tsx` 的
       * 「出口期重开」用例（类名接管仍成立）。
       */
      unblock();
      setExiting(false);
      setRetain(false);
    };
    const onEnd = (e: AnimationEvent): void => {
      // 只认出口元素**自己**的动画结束：子元素冒泡上来的 animationend 不算数，
      // 否则面板里任何一个带过渡的子元素都能提前把面板卸载掉。
      if (e.target === el) finish();
    };
    el.addEventListener('animationend', onEnd);
    // 要求 4：到点强制卸载，兜住「事件永远不来」的一切情形。
    const timer = window.setTimeout(finish, exitMs + EXIT_CAP_MARGIN_MS);

    // 要求 3：卸载（或重开导致 effect 重跑）时清理，不留悬挂监听 / 定时器。
    return () => {
      el.removeEventListener('animationend', onEnd);
      window.clearTimeout(timer);
    };
  }, [active, retain, exitClass, enterClass, exitMs, block, unblock]);

  /*
   * ── 两个方向都在**渲染期**定，不能等到 effect ───────────────────────────
   * · 打开必须同步：`mounted` 若晚一帧变 true，用 `mounted` 做渲染门的调用方就会晚
   *   一帧才把元素交给 React；而依赖 `[open]` 的 `useEffect`（Modal 的焦点入场正是
   *   这一形态：`panelRef.current?.focus()`）**只会跑那一次** —— 它跑的时候 ref 还是
   *   null，之后不会再跑，焦点就永远进不去（真机症状：打开设置后焦点还留在触发钮上）。
   * · 关闭必须当帧决定扣不扣：等 effect 才决定的话，元素已经先被卸载掉了，
   *   出口动画没有机会播。
   * 用 React 官方的「渲染期调 state」写法：它会在**提交之前**重跑一次渲染，
   * 所以外部看到的仍是同一次提交的最终结果，中间没有可观察的帧。
   */
  if (prevActive !== active) {
    setPrevActive(active);
    /*
     * 保留的三个条件缺一不可：
     *   · 是「关」而不是「开」（开向一律立即在场）；
     *   · 本形态有出口动画 —— 没有就没什么可等的，白活 200ms 是纯负债；
     *   · 用户没要求减弱动效 —— reduce 下 `*-out` 的 `animation` 是 `none`，
     *     `animationend` 永不来，「等」就等于把元素永久留在 DOM 里（要求 1）。
     */
    setRetain(!active && !!exitClass && !prefersReducedMotion());
  }
  /** 在场 = 打开中 **或** 出口期被扣住。消费方拿它做渲染门（`if (!mounted) return null`）。 */
  const mounted = active || retain;

  const exitRef = useCallback((node: HTMLElement | null) => {
    exitElRef.current = node;
  }, []);
  const blockRef = useCallback((node: HTMLElement | null) => {
    blockElRef.current = node;
  }, []);

  return { mounted, exiting, exitRef, blockRef };
}

/** 出口动画时长默认值 —— 等于 `--dur-base`（定义层六组 `*-out` 类统一用这一档）。 */
export const DEFAULT_EXIT_MS = 200;

/**
 * 兜底余量。为什么是 120ms：`animationend` 在同一帧的第二次 rAF 之后才派发，
 * 低端机上还会被 VSync 推迟；给小了会「动画没播完就被卸载」（视觉上被截断），
 * 给大了元素滞留过久。120ms ≈ 7 帧，够吞掉调度抖动又不至于被察觉。
 */
export const EXIT_CAP_MARGIN_MS = 120;

/**
 * 当前是否要求减弱动效。**每次现读**：Windows「显示动画」开关可以在应用运行中改，
 * 缓存成 state 就会在改完之后继续按旧值走。
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface PresenceOptions {
  /**
   * 出口动画类名（定义层已有，如 `toast-exit`）。由 hook 在出口期挂到 `exitRef` 元素上。
   *
   * **不传 = 本形态没有出口动画 ⇒ 关闭即卸载**（与接线前行为一致）。定义层只有六组
   * `*-out`，没有出口动画的形态（下拉浮层、全屏打印预览）就该走这条路，
   * 而不是随便挑一个类名凑数或白等 200ms。
   */
  exitClass?: string;
  /**
   * 入场动画类名（如 `toast-enter`）。首帧仍由调用方的 JSX 负责；hook 只在出口启动时
   * 摘掉、重开时补回。不传 = 调用方自己用 `exiting` 切换类名。
   */
  enterClass?: string;
  /** 出口动画自身时长，缺省 {@link DEFAULT_EXIT_MS}。兜底 cap = 本值 + {@link EXIT_CAP_MARGIN_MS}。 */
  exitMs?: number;
}

export interface Presence {
  /** 是否应保留在 DOM。false ⇒ 调用方 `return null`。 */
  mounted: boolean;
  /** 是否处于出口期。出口类由 hook 自己挂，本标志供调用方表达禁用态等附加语义。 */
  exiting: boolean;
  /** 出口动画元素：出口期挂 `exitClass`，并打上 `pointer-events: none`。 */
  exitRef: (node: HTMLElement | null) => void;
  /** 额外需要「出口期不拦输入」的容器（如 Modal 遮罩）。与动画元素不同一时才需要。 */
  blockRef: (node: HTMLElement | null) => void;
}
