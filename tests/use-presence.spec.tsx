// @vitest-environment jsdom
/**
 * 出口动画 presence 机制（`src/hooks/usePresence.ts`）的验收。
 *
 * 这个 hook 是「六组 `*-out` keyframes 能不能真的播出来」的唯一前提：React 是
 * 开关即卸载，不把卸载推迟到动画结束，出口动画就永远没机会播。
 * 而「推迟卸载」本身有个明显的失败模式 —— **元素永久留在 DOM 里**
 * （等一个永远不会来的 `animationend`）。下面九条用例就是这个失败模式的反面清单。
 *
 * 只依赖 react-dom/client 原生渲染，不引入 testing-library（与仓库其余 tsx spec 一致）。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import React, { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// 与仓库其余 tsx spec 一致：用 react-dom/test-utils 的 act（理由见 modal-focus-ime.spec.tsx）
import { act } from 'react-dom/test-utils';

import {
  usePresence,
  prefersReducedMotion,
  DEFAULT_EXIT_MS,
  EXIT_CAP_MARGIN_MS,
} from '../src/hooks/usePresence';

const ENTER = 'demo-enter';
const EXIT = 'demo-exit';

/**
 * 复刻真实消费方的形态：入场类写死在 JSX 里（现状就是这样，Toast / 抽屉 / Modal 的
 * `toast-enter` / `drawer-slide-in` / `dialog-pop` 都是静态 className），
 * 出口类交给 hook。`blocker` 常驻（对应 Modal 的遮罩：比面板活得久、也必须停止吃点击）。
 */
function Harness({ open }: { open: boolean }): JSX.Element {
  const p = usePresence(open, { enterClass: ENTER, exitClass: EXIT });
  return (
    <>
      <div data-testid="blocker" data-exiting={p.exiting ? '1' : '0'} ref={p.blockRef} />
      {p.mounted ? (
        <div data-testid="surface" ref={p.exitRef} className={ENTER}>
          <span data-testid="inner" />
        </div>
      ) : null}
    </>
  );
}

let container: HTMLDivElement;
let root: Root;
let unmounted: boolean;

/** 可变的 reduce 开关（hook 每次出口现读，因此必须在关闭**之前**改它才算数） */
let reduced = false;
let savedMatchMedia: typeof window.matchMedia | undefined;

function installMatchMedia(): void {
  savedMatchMedia = window.matchMedia;
  const fake = (query: string): MediaQueryList =>
    ({
      matches: query.includes('prefers-reduced-motion') ? reduced : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  window.matchMedia = fake as typeof window.matchMedia;
}

function surface(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="surface"]');
}
function blocker(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-testid="blocker"]')!;
}
function isExiting(): boolean {
  return blocker().dataset.exiting === '1';
}

function render(open: boolean): void {
  act(() => {
    root.render(<Harness open={open} />);
  });
}
function unmount(): void {
  if (unmounted) return;
  unmounted = true;
  act(() => root.unmount());
}
/** 派发 `animationend`；target 默认是出口元素自己 */
function fireAnimEnd(target: HTMLElement): void {
  act(() => {
    target.dispatchEvent(new Event('animationend', { bubbles: true }));
  });
}

beforeEach(() => {
  reduced = false;
  installMatchMedia();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  unmounted = false;
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (savedMatchMedia === undefined) {
    delete (window as unknown as Record<string, unknown>).matchMedia;
  } else {
    window.matchMedia = savedMatchMedia;
  }
  container.remove();
});

describe('presence · 基本生命周期', () => {
  it('打开时在 DOM；关闭后**不立即卸载**（否则出口动画没机会播），动画结束才卸载', () => {
    render(true);
    expect(surface()).not.toBeNull();
    expect(isExiting()).toBe(false);

    render(false);
    // 这一步是本机制的全部意义：`open` 已为 false，但元素还在。
    expect(surface()).not.toBeNull();
    expect(isExiting()).toBe(true);

    fireAnimEnd(surface()!);
    expect(surface()).toBeNull();
    expect(isExiting()).toBe(false);
  });

  it('导出默认时长常量与定义层 `--dur-base` 同值（200ms），兜底余量 120ms', () => {
    expect(DEFAULT_EXIT_MS).toBe(200);
    expect(EXIT_CAP_MARGIN_MS).toBe(120);
  });
});

describe('presence · 类名接管', () => {
  it('出口类在**同一帧**就挂上、入场类同一帧摘掉（不等下一帧，否则先出一帧静止态）', () => {
    render(true);
    const el = surface()!;
    expect(el.classList.contains(ENTER)).toBe(true);
    expect(el.classList.contains(EXIT)).toBe(false);

    render(false);
    // 同一个节点（没被卸载重建）
    expect(surface()).toBe(el);
    expect(el.classList.contains(EXIT)).toBe(true);
    // 出口动画必须**取代**入场动画，而不是两条动画挤在同一个 `animation` 简写上抢级联
    expect(el.classList.contains(ENTER)).toBe(false);
  });

  it('出口期重开：出口态整体撤销（出口类摘掉、入场类补回），元素继续用', () => {
    render(true);
    const el = surface()!;
    render(false);
    expect(el.classList.contains(EXIT)).toBe(true);

    render(true);
    expect(surface()).toBe(el);
    expect(isExiting()).toBe(false);
    expect(el.classList.contains(EXIT)).toBe(false);
    // 不漂移：JSX 里写着的入场类必须回到 DOM 上（React 不会替我们补，prop 没变）
    expect(el.classList.contains(ENTER)).toBe(true);
  });
});

describe('presence · 出口期不拦输入', () => {
  it('出口期出口元素与「拦截容器」都 pointer-events: none；结束后还原', () => {
    render(true);
    const el = surface()!;
    const blk = blocker();
    expect(el.style.pointerEvents).toBe('');

    render(false);
    expect(el.style.pointerEvents).toBe('none');
    // Modal 的关键一条：拦住点击的是**遮罩**而不是面板，两者都要停止吃点击，
    // 否则用户点到的还是那个正在淡出的遮罩（视觉余韵与可操作性没解耦）。
    expect(blk.style.pointerEvents).toBe('none');

    render(true);
    expect(el.style.pointerEvents).toBe('');
    expect(blk.style.pointerEvents).toBe('');
  });

  it('没等到动画事件也一直是 none（不靠动画事件兜底才禁点）', () => {
    render(true);
    render(false);
    // 什么都不派发、什么都不推进：这正是「动画事件没来」的现场
    expect(surface()!.style.pointerEvents).toBe('none');
    expect(blocker().style.pointerEvents).toBe('none');
  });
});

describe('presence · 超时兜底 cap', () => {
  it('动画事件不来 ⇒ cap = 出口时长 + 余量 到点强制卸载；到点之前**不**卸载', () => {
    vi.useFakeTimers();
    render(true);
    render(false);
    expect(surface()).not.toBeNull();

    // 兜底存在的意义就是「不早退也不永驻」：先证明它确实在等，再证明它一定会来。
    act(() => {
      vi.advanceTimersByTime(DEFAULT_EXIT_MS + EXIT_CAP_MARGIN_MS - 1);
    });
    expect(surface()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(surface()).toBeNull();
    expect(isExiting()).toBe(false);
  });

  it('cap 跟随 `exitMs` 走（将来某类出口改档不会留下过短的兜底）', () => {
    vi.useFakeTimers();
    const Custom = ({ open }: { open: boolean }): JSX.Element | null => {
      const p = usePresence(open, { exitClass: EXIT, exitMs: 40 });
      return p.mounted ? <div data-testid="surface" ref={p.exitRef} /> : null;
    };
    const custom = document.createElement('div');
    document.body.appendChild(custom);
    const customRoot = createRoot(custom);
    act(() => customRoot.render(<Custom open />));
    act(() => customRoot.render(<Custom open={false} />));

    act(() => {
      vi.advanceTimersByTime(40 + EXIT_CAP_MARGIN_MS - 1);
    });
    expect(custom.querySelector('[data-testid="surface"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(custom.querySelector('[data-testid="surface"]')).toBeNull();

    act(() => customRoot.unmount());
    custom.remove();
  });

  it('子元素冒泡上来的 animationend 不算数（否则面板里任何过渡元素都能提前把面板卸掉）', () => {
    render(true);
    render(false);
    fireAnimEnd(document.querySelector<HTMLElement>('[data-testid="inner"]')!);
    expect(surface()).not.toBeNull();
    expect(isExiting()).toBe(true);

    fireAnimEnd(surface()!);
    expect(surface()).toBeNull();
  });
});

describe('presence · 无障碍与清理', () => {
  it('reduce 下**立即卸载**：不推进任何计时器，也不等 animationend', () => {
    render(true);
    reduced = true;
    render(false);

    // reduce 下 CSS 里 `*-out` 的 animation 是 none —— animationend 永远不会来，
    // 「等」就等于把元素（以及那个 pointer-events:none 的遮罩）永久留在页面上。
    expect(surface()).toBeNull();
    expect(isExiting()).toBe(false);
  });

  it('reduce 是**出口时现读**的：挂载时不 reduce，关闭前才打开 ⇒ 照样立即卸载', () => {
    render(true);
    expect(prefersReducedMotion()).toBe(false);
    reduced = true;
    render(false);
    expect(surface()).toBeNull();
  });

  it('组件卸载后：animationend 监听被摘、兜底定时器被清，不留悬挂', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    render(true);
    render(false);
    const el = surface()!;
    const removeSpy = vi.spyOn(el, 'removeEventListener');

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('animationend', expect.any(Function));
    expect(clearSpy).toHaveBeenCalled();

    // 悬挂的兜底定时器若还在，这里会对已卸载的组件 setState（React 会告警）。
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.querySelector('[data-testid="surface"]')).toBeNull();
  });

  it('StrictMode 双调 effect 不破：仍然等动画、仍然能卸载', () => {
    const Strict = ({ open }: { open: boolean }): JSX.Element => (
      <React.StrictMode>
        <Harness open={open} />
      </React.StrictMode>
    );
    act(() => root.render(<Strict open />));
    act(() => root.render(<Strict open={false} />));

    expect(surface()).not.toBeNull();
    expect(isExiting()).toBe(true);
    fireAnimEnd(surface()!);
    expect(surface()).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 在场判定的**时序**（回归：晚一帧 = 真机上焦点进不去弹层）
 * ------------------------------------------------------------------ */

/**
 * 与 `Modal` 同构的组件：焦点入场写成 `useEffect(..., [open])` + `panelRef.current?.focus()`
 * ——这正是 `src/components/common/Modal.tsx` 里那段（且它**必须**保持 `[open]` 依赖，
 * 否则会在每次击键时重跑、抢走输入框焦点造成 IME 吞字）。
 */
function ModalLike({ open }: { open: boolean }): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // 刻意声明在 usePresence **之前**（与 Modal 一致）：同一次提交里本 effect 先跑。
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const p = usePresence(open, { exitClass: EXIT, enterClass: ENTER });
  if (!p.mounted) return null;
  return (
    <div
      data-testid="panel"
      tabIndex={-1}
      ref={(node) => {
        panelRef.current = node;
        p.exitRef(node);
      }}
      className={ENTER}
    />
  );
}

describe('presence · 在场判定必须发生在渲染期（不许晚一帧）', () => {
  it('打开的那一次提交里元素就已在 DOM ⇒ 依赖 [open] 的聚焦 effect 抓得到它', () => {
    /*
     * 这条断言的是**时序**，不是「最终在不在」。所以不能只查 DOM 里有元素
     * （那样新旧实现都过：旧的靠 effect 里 setMounted 追一次重渲染，`act()` 返回时
     * 元素也已经在了）。要区分两者，只能问「聚焦 effect 跑的那一刻 ref 有没有值」——
     * 而依赖 `[open]` 的 effect 不会再跑第二次，所以最终焦点落在谁身上就是答案。
     */
    act(() => {
      root.render(<ModalLike open={false} />);
    });
    expect(document.querySelector('[data-testid="panel"]')).toBeNull();

    act(() => {
      root.render(<ModalLike open />);
    });

    const panel = document.querySelector<HTMLElement>('[data-testid="panel"]');
    expect(panel, '打开后元素应在 DOM').not.toBeNull();
    expect(document.activeElement, '打开的当帧焦点就必须能进面板（Modal 的焦点入场靠这个）').toBe(
      panel,
    );
  });

  it('关闭仍是渲染期决定：当帧不卸载（否则出口动画没机会播）', () => {
    // 与上一条同一机制的关向：保留标记若等到 effect 才置上，元素已经先被卸载了。
    act(() => {
      root.render(<ModalLike open />);
    });
    act(() => {
      root.render(<ModalLike open={false} />);
    });
    const panel = document.querySelector<HTMLElement>('[data-testid="panel"]');
    expect(panel, '关闭后**当帧**仍应在 DOM').not.toBeNull();
    expect(panel!.classList.contains(EXIT)).toBe(true);
  });
});
