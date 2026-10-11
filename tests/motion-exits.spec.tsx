// @vitest-environment jsdom
/**
 * 出口接线（四类表面）的形态与生命周期断言。
 *
 * 四类表面 = Toast / 抽屉（左右两档）/ Modal 对话框 / 锚定浮动卡。前四类都经
 * `src/components/common/Modal.tsx` 这一个底座（placement 决定用哪一组 `*-out`），
 * Toast 走 `ToastItem` + `useExitRetained`。
 *
 * 这里钉的是「接线接了、接对了、接不出事故」：
 *   ① 关闭后元素**还在**（不然出口动画根本没机会播）
 *   ② 挂的是**本档**那个出口类（接错就会看到「下拉菜单按抽屉的轨迹飞出去」）
 *   ③ 出口期出口元素与拦截容器都 `pointer-events: none`
 *   ④ reduce 下立即移除、动画事件不来时兜底 cap 强制移除（元素绝不永驻）
 *   ⑤ 定义层没有出口动画的档位（dropdown / fullscreen）**维持关闭即卸载**
 * 真浏览器里的「真的点得到底层」由 motion-exits-browser.spec.ts 负责
 * （jsdom 没有 hit-test，`elementFromPoint` 不可用）。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { Modal } from '../src/components/common/Modal';
import { ToastHost } from '../src/components/common/Toast';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { DEFAULT_EXIT_MS, EXIT_CAP_MARGIN_MS } from '../src/hooks/usePresence';

type Placement = 'center' | 'right' | 'left' | 'left-rail' | 'float' | 'dropdown' | 'fullscreen';

const CASE_LABEL: Record<string, string> = {
  center: '① Modal 对话框（居中）',
  right: '② 右侧抽屉',
  left: '② 左侧抽屉',
  'left-rail': '② 左侧贴缘抽屉（设置抽屉）',
  float: '④ 锚定浮动卡',
};

/** 有出口动画的档位 → 定义层里属于它的那一个 `*-out` 类 */
const WIRED: Array<{ placement: Placement; exit: string }> = [
  { placement: 'center', exit: 'dialog-pop-out' },
  { placement: 'right', exit: 'drawer-out-right' },
  { placement: 'left', exit: 'drawer-out-left' },
  { placement: 'left-rail', exit: 'drawer-out-left' },
  { placement: 'float', exit: 'float-pop-out' },
];

let container: HTMLDivElement;
let root: Root;
let unmounted: boolean;

function renderModal(placement: Placement, open: boolean): void {
  act(() => {
    root.render(
      <Modal open={open} onClose={() => undefined} placement={placement} ariaLabel="测试浮层">
        <div data-testid="panel">面板内容</div>
      </Modal>,
    );
  });
}

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');
/** 出口动画落在哪：float 档在面板自身，其余档在 Modal 自己的锚点容器上 */
function exitEl(placement: Placement): HTMLElement {
  const d = dialog()!;
  return placement === 'float'
    ? d.querySelector<HTMLElement>('[data-anchored-float]')!
    : (d.firstElementChild as HTMLElement);
}
function fireAnimEnd(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new Event('animationend', { bubbles: true }));
  });
}

/* reduce 开关（hook 每次出口现读，因此要在**关闭之前**改） */
let reduced = false;
let savedMatchMedia: typeof window.matchMedia | undefined;
function installMatchMedia(): void {
  savedMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion') ? reduced : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  reduced = false;
  installMatchMedia();
  useProjectsStore.setState({ toasts: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  unmounted = false;
});

afterEach(() => {
  if (!unmounted) {
    unmounted = true;
    act(() => root.unmount());
  }
  act(() => {
    useProjectsStore.setState({ toasts: [] });
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (savedMatchMedia === undefined) delete (window as unknown as Record<string, unknown>).matchMedia;
  else window.matchMedia = savedMatchMedia;
  container.remove();
});

describe('出口接线 · Modal 底座四档（含左右抽屉两档）', () => {
  for (const { placement, exit } of WIRED) {
    const label = CASE_LABEL[placement] ?? placement;

    it(`${label}：关闭后仍在 DOM、挂上 ${exit}、且出口期不拦输入`, () => {
      renderModal(placement, true);
      expect(dialog()).not.toBeNull();
      const el = exitEl(placement);
      expect(el.classList.contains(exit)).toBe(false);

      renderModal(placement, false);
      // ① 关键：`open` 已经是 false，元素还在 —— 否则出口动画永远播不出来
      expect(dialog(), '关闭后立刻卸载 ⇒ 出口动画没机会播').not.toBeNull();
      // ② 挂的是本档那个类
      expect(el.classList.contains(exit)).toBe(true);
      // ③ 出口期两个元素都不拦输入：动画元素 + 拦截点击的容器
      expect(el.style.pointerEvents).toBe('none');
      expect(dialog()!.style.pointerEvents).toBe('none');
      // 而且这一刻动画确实还没播完（没有 animationend 就一直是 none）
      expect(el.style.pointerEvents).toBe('none');

      fireAnimEnd(el);
      expect(dialog()).toBeNull();
    });
  }

  it('无出口动画的档位（dropdown / fullscreen）维持关闭即卸载 —— 不许拿别的档的类凑数', () => {
    for (const placement of ['dropdown', 'fullscreen'] as const) {
      renderModal(placement, true);
      expect(dialog(), `${placement} 应该打开`).not.toBeNull();
      renderModal(placement, false);
      expect(dialog(), `${placement} 定义层没有出口 keyframes，就该关闭即卸载`).toBeNull();
      const stale = document.querySelector('.drawer-out-right, .drawer-out-left, .dialog-pop-out');
      expect(stale, `${placement} 挂上了不属于它的出口类`).toBeNull();
    }
  });

  it('出口期重开：撤销出口态（类摘掉 + 恢复可点），元素继续用', () => {
    renderModal('right', true);
    const el = exitEl('right');
    renderModal('right', false);
    expect(el.classList.contains('drawer-out-right')).toBe(true);

    renderModal('right', true);
    expect(dialog()).not.toBeNull();
    expect(el.classList.contains('drawer-out-right')).toBe(false);
    expect(el.style.pointerEvents).toBe('');
    expect(dialog()!.style.pointerEvents).toBe('');
  });

  it('动画事件不来 ⇒ 兜底 cap（出口时长 + 余量）到点强制卸载，到点之前不卸载', () => {
    vi.useFakeTimers();
    renderModal('center', true);
    renderModal('center', false);
    expect(dialog()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(DEFAULT_EXIT_MS + EXIT_CAP_MARGIN_MS - 1);
    });
    expect(dialog(), '兜底不该提前触发').not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(dialog(), '兜底没触发 ⇒ 元素永驻').toBeNull();
  });

  it('reduce 下立即卸载（绝不等一个不会到来的 animationend）', () => {
    renderModal('left-rail', true);
    reduced = true;
    renderModal('left-rail', false);
    expect(dialog()).toBeNull();
  });

  it('子元素冒泡上来的 animationend 不算数（面板里任何过渡元素都别想提前把面板卸掉）', () => {
    renderModal('center', true);
    renderModal('center', false);
    fireAnimEnd(document.querySelector<HTMLElement>('[data-testid="panel"]')!);
    expect(dialog()).not.toBeNull();
    fireAnimEnd(exitEl('center'));
    expect(dialog()).toBeNull();
  });
});

describe('出口接线 · Toast', () => {
  const toastButtons = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('.toast-enter, .toast-exit'));

  it('③ Toast 被 dismiss 后仍在 DOM、挂 toast-exit、不拦输入，动画结束才真正消失', () => {
    act(() => {
      useProjectsStore.setState({ toasts: [{ id: 7, kind: 'success', message: '已保存' }] });
    });
    act(() => {
      root.render(<ToastHost />);
    });
    expect(toastButtons()).toHaveLength(1);
    const btn = toastButtons()[0]!;
    expect(btn.classList.contains('toast-enter')).toBe(true);
    expect(btn.textContent).toBe('已保存');

    // 点它 = 走真实链路（dismissToast 把它从 store 摘掉）
    act(() => {
      btn.click();
    });
    expect(useProjectsStore.getState().toasts, 'store 里应已删除').toHaveLength(0);
    // ① 但画面上还在（列表版的 presence 扣住了它）
    expect(toastButtons(), 'dismiss 后立刻消失 ⇒ toast-exit 没机会播').toHaveLength(1);
    const leaving = toastButtons()[0]!;
    expect(leaving.classList.contains('toast-exit')).toBe(true);
    // 出口期它必须停止吃点击：用户这时应在点下一个操作，而不是重复点到这条残影
    expect(leaving.style.pointerEvents).toBe('none');
    expect(leaving.getAttribute('aria-hidden')).toBeNull();

    fireAnimEnd(leaving);
    expect(toastButtons(), '出口结束后必须交还列表').toHaveLength(0);
  });

  it('③ Toast 的兜底：动画事件不来也不会永久留在页面上', () => {
    vi.useFakeTimers();
    act(() => {
      useProjectsStore.setState({ toasts: [{ id: 9, kind: 'info', message: '提示' }] });
    });
    act(() => {
      root.render(<ToastHost />);
    });
    act(() => {
      useProjectsStore.getState().dismissToast(9);
    });
    expect(toastButtons()).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(DEFAULT_EXIT_MS + EXIT_CAP_MARGIN_MS);
    });
    expect(toastButtons(), '兜底没触发 ⇒ toast 残影永驻').toHaveLength(0);
  });
});
