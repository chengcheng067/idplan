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
 * - 调用方必须用 `mounted` 做渲染门，否则「卸载」无从发生。
 */
export function usePresence(
  active: boolean,
  { exitClass, enterClass, exitMs = DEFAULT_EXIT_MS }: PresenceOptions,
): Presence {
  const [mounted, setMounted] = useState(active);
  const [exiting, setExiting] = useState(false);

  /** 与 `mounted` 同步的镜像：effect 里要读它，但**不能**进依赖（否则出口期会被自己打断） */
  const aliveRef = useRef(active);
  const exitElRef = useRef<HTMLElement | null>(null);
  const blockElRef = useRef<HTMLElement | null>(null);
  /** 两个元素被改成 `none` 之前的内联值（'' = 本来没有内联值，还原成空串即恢复样式表口径） */
  const prevPeRef = useRef<{ exit: string; block: string } | null>(null);
  /** 本次出口是否摘过 `enterClass`（决定重开时要不要补回） */
  const strippedRef = useRef(false);

  const alive = useCallback((next: boolean) => {
    aliveRef.current = next;
    setMounted(next);
  }, []);

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
      if (el) el.classList.remove(exitClass);
      setExiting(false);
      alive(true);
      return;
    }

    if (!aliveRef.current) return;

    // 要求 1：reduce 下不等 —— CSS 的 `animation: none` 永不给 animationend。
    // 元素没挂上（调用方漏了 exitRef）同样立即卸载：宁可少一次动画，也绝不留在 DOM。
    if (prefersReducedMotion() || !el) {
      setExiting(false);
      alive(false);
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
      el.classList.remove(exitClass);
      unblock();
      setExiting(false);
      alive(false);
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
  }, [active, exitClass, enterClass, exitMs, alive, block, unblock]);

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
  /** 出口动画类名（定义层已有，如 `toast-exit`）。由 hook 在出口期挂到 `exitRef` 元素上。 */
  exitClass: string;
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
