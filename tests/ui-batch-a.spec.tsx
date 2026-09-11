// @vitest-environment jsdom
/**
 * v0.7 批次 A 回归测试（顶栏主题融合 / 设置弹窗对称 / 日历入口持久化）。
 *
 * 每条用例都锚定一个**具体的、曾经真实存在的缺陷**，而不是复述实现：
 *   A1 - 自绘标题栏配色必须来自 token；非桌面端必须短路。
 *   A2 - Modal 面板上不得再出现内联 paddingTop（它是「上 48 / 下 24」不对称的根因）。
 *   A4 - homeViewMode 必须落盘并能读回（否则刷新回落看板 = 「入口又不见了」）。
 *
 * 只依赖 react-dom/client / zustand 原生能力，不引入 testing-library。
 *
 * ── 为什么本文件的 A4 不再断言「圆角/尺寸类名」（v0.7 批次 A 二次修订）──
 *   原用例名叫「…+ r12」，断言却是 `tabs[0].className).toContain('rounded-xl')`：
 *   这条**证明不了圆角是几像素**，而真缺陷正落在这个缝里 ——
 *   `tailwind.config.ts` 把 `borderRadius.xl` 重映射为 **16px**（Tailwind 默认 12px），
 *   于是「写 rounded-xl 以为 12」在类名断言下永远绿（QA Q-A4-2 由此抓到）。
 *   根因是**类名 ≠ 渲染值**：jsdom 既不加载 Tailwind 产物 CSS，也不做类→像素的映射，
 *   `getComputedStyle` 在这里对 Tailwind 类恒返回空值 —— 在本文件里断言「r12」只能
 *   是自欺。故 A4 的**几何事实**（项 r12 / 容器 r16 / 项 84×28 / 容器高 36）已迁至
 *   `tests/ui-batch-a-geometry.spec.ts`（真 Chromium 读 `getComputedStyle().borderRadius`）；
 *   本文件只保留 jsdom 真正判得了的事实：DOM 结构、aria 语义、**类名存在性**。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { syncTitleBarTheme, titleBarHeight } from '../src/lib/titleBarTheme';
import { Modal } from '../src/components/common/Modal';
import { SegmentedControl } from '../src/components/ui/SegmentedControl';

/* ============================ A1 · 自绘标题栏 ============================ */

describe('A1 · 顶栏与主题融合（titleBarOverlay 配色同步）', () => {
  const original = window.idplan;

  afterEach(() => {
    window.idplan = original;
    document.documentElement.removeAttribute('style');
  });

  it('桌面端：把顶栏配色与高度下发给主进程，且颜色是合法 hex', () => {
    const spy = vi.fn();
    window.idplan = {
      isDesktop: true,
      platform: 'win32',
      version: '0.0.0.0',
      setTitleBarTheme: spy,
    } as unknown as typeof window.idplan;

    syncTitleBarTheme();

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as { color: string; symbolColor: string; height: number };
    // 颜色一律是 #rrggbb（由 CSS 变量实际值转换，或兜底值），不得是空串 / rgba 串
    expect(arg.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(arg.symbolColor).toMatch(/^#[0-9a-f]{6}$/);
    // jsdom 不加载样式表，读不到 CSS 变量 → 走亮色兜底（--paper #ffffff / --ink #1f2937），
    // 这也顺带验证了「读不到时不崩、有确定兜底」。
    expect(arg.color).toBe('#ffffff');
    expect(arg.symbolColor).toBe('#1f2937');
    expect(arg.height).toBe(titleBarHeight());
  });

  it('高度与 TopBar 的 h-14 xl:h-16 同口径：<1280 → 56，≥1280 → 64', () => {
    const spy = vi.fn();
    window.idplan = {
      isDesktop: true,
      platform: 'win32',
      version: '0.0.0.0',
      setTitleBarTheme: spy,
    } as unknown as typeof window.idplan;

    const setWidth = (w: number): void => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
    };

    setWidth(1600);
    expect(titleBarHeight()).toBe(64);
    syncTitleBarTheme();
    expect(spy.mock.calls[0][0].height).toBe(64);

    setWidth(1279); // 临界值必须走 56（断点严格锁 xl=1280，不得引入 lg=1024）
    expect(titleBarHeight()).toBe(56);
    syncTitleBarTheme();
    expect(spy.mock.calls[1][0].height).toBe(56);

    setWidth(390);
    expect(titleBarHeight()).toBe(56);

    setWidth(1024);
    expect(titleBarHeight()).toBe(56);
  });

  it('浏览器 / NAS 端（无 window.idplan）必须静默短路，不得抛错', () => {
    window.idplan = undefined;
    expect(() => syncTitleBarTheme()).not.toThrow();
  });

  it('老 preload 未暴露 setTitleBarTheme 时短路（不抛 not a function）', () => {
    window.idplan = {
      isDesktop: true,
      platform: 'win32',
      version: '0.0.0.0',
    } as unknown as typeof window.idplan;
    expect(() => syncTitleBarTheme()).not.toThrow();
  });
});

/* ======================= A2 · 设置弹窗对称/底部圆角 ======================= */

describe('A2 · Modal 不得再用内联 paddingTop 覆盖 sm:p-6（距底不对称根因）', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  /** 取 Modal 的锚点面板：role=dialog 的第一个子元素，其下再取我们的内容面板 */
  function panelOf(placement: 'center' | 'right' | 'right-float'): HTMLElement {
    act(() => {
      root.render(
        <Modal open onClose={() => undefined} placement={placement} ariaLabel="测试">
          <div data-testid="panel">内容</div>
        </Modal>,
      );
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    return dialog.firstElementChild as HTMLElement;
  }

  it('right-float：面板无内联 paddingTop（否则 ≥sm 实际是上 48 / 下 24）', () => {
    const panel = panelOf('right-float');
    expect(panel.style.paddingTop).toBe('');
    // 且必须带上「<sm 安全区 + ≥sm 对称 sm:p-6」的响应式类
    expect(panel.className).toContain('pt-[max(env(safe-area-inset-top),3rem)]');
    expect(panel.className).toContain('sm:p-6');
  });

  it('right 抽屉：桌面端口径保持 48px（sm:pt-12），不引入非预期视觉变更', () => {
    const panel = panelOf('right');
    expect(panel.style.paddingTop).toBe('');
    expect(panel.className).toContain('pt-[max(env(safe-area-inset-top),3rem)]');
    expect(panel.className).toContain('sm:pt-12');
  });

  it('center：保持 p-4 sm:p-6 对称，且不带右侧抽屉的安全区 padding', () => {
    const panel = panelOf('center');
    expect(panel.style.paddingTop).toBe('');
    expect(panel.className).toContain('p-4');
    expect(panel.className).toContain('sm:p-6');
    expect(panel.className).not.toContain('safe-area-inset-top');
  });
});

/* ==================== A4 · 首页视图切换（画板 02 / lg 档） ==================== */

describe('A4 · 首页视图切换按画板规格（lg）', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('lg 档：容器/项类名与 aria 语义正确（像素几何见 ui-batch-a-geometry.spec.ts）', () => {
    act(() => {
      root.render(
        <SegmentedControl<'kanban' | 'calendar'>
          size="lg"
          ariaLabel="首页视图切换"
          value="kanban"
          onChange={() => undefined}
          options={[
            { value: 'kanban', label: '看板' },
            { value: 'calendar', label: '月历' },
          ]}
        />,
      );
    });

    const list = document.querySelector('[role="tablist"]')!;
    // 画板 02：fill=#F1F5F9(sunken) r=16 pad=4 gap=4
    expect(list.className).toContain('bg-sunken');
    expect(list.className).toContain('rounded-2xl');
    expect(list.className).toContain('p-[4px]');
    expect(list.className).toContain('gap-[4px]');

    const tabs = Array.from(list.querySelectorAll('[role="tab"]')) as HTMLElement[];
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    // 画板 02：项 84×28，激活 paper 底
    expect(tabs[0].className).toContain('h-[28px]');
    expect(tabs[0].className).toContain('min-w-[84px]');
    expect(tabs[0].className).toContain('bg-paper');
    expect(tabs[1].className).not.toContain('bg-paper');

    /**
     * 圆角：只做「类名级防呆」，不做像素断言（jsdom 判不了像素，见文件头）。
     *
     * 这三条**不是恒真**——它们专拦一个已经真实发生过的回归：
     *   `rounded-xl` 在本仓库渲染 16px ≠ 画板 02 要求的 12px。
     * 之所以三条一起写：`rounded-md` 是唯一正解，而 `xl`/`2xl` 是历史上被误用过的
     * 两个键（两者都 = 16px），只写正向断言会让「改回 rounded-xl」再度溜过去。
     * 真正的像素证据在真浏览器 spec 里（`ui-batch-a-geometry.spec.ts` A4-G1）。
     */
    expect(tabs[0].className).toContain('rounded-md');
    expect(tabs[0].className).not.toContain('rounded-xl');
    expect(tabs[0].className).not.toContain('rounded-2xl');
  });

  it('默认档（md）不受影响：仍为 r8 / pad4 / gap2 / 项高 24', () => {
    act(() => {
      root.render(
        <SegmentedControl<'a' | 'b'>
          ariaLabel="密度"
          value="a"
          onChange={() => undefined}
          options={[
            { value: 'a', label: '月' },
            { value: 'b', label: '周' },
          ]}
        />,
      );
    });
    const list = document.querySelector('[role="tablist"]')!;
    expect(list.className).toContain('rounded-sm');
    expect(list.className).toContain('gap-[2px]');
    const tab = list.querySelector('[role="tab"]') as HTMLElement;
    expect(tab.className).toContain('h-[24px]');
  });
});

describe('A4 · homeViewMode 持久化（刷新不回落看板）', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('切换即落盘，重新装载 store 后读回 calendar', async () => {
    const mod = await import('../src/store/useUiStore');
    expect(mod.useUiStore.getState().homeViewMode).toBe('kanban'); // 无存档 → 默认看板

    mod.useUiStore.getState().setHomeViewMode('calendar');
    expect(localStorage.getItem('idplan.homeView')).toBe('calendar');

    // 重新装载模块 = 模拟「刷新页面」重新初始化 store
    vi.resetModules();
    const fresh = await import('../src/store/useUiStore');
    expect(fresh.useUiStore.getState().homeViewMode).toBe('calendar');

    // 切回看板同样落盘
    fresh.useUiStore.getState().setHomeViewMode('kanban');
    expect(localStorage.getItem('idplan.homeView')).toBe('kanban');
  });

  it('存档值非法（脏数据）时回落 kanban，不抛错', async () => {
    localStorage.setItem('idplan.homeView', '{not-a-mode}');
    vi.resetModules();
    const mod = await import('../src/store/useUiStore');
    expect(mod.useUiStore.getState().homeViewMode).toBe('kanban');
  });
});
