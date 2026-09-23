// @vitest-environment jsdom
/**
 * v0.7 批次 A 回归测试（顶栏主题融合 / 设置弹窗对称 / 日历入口持久化）。
 *
 * 每条用例都锚定一个**具体的、曾经真实存在的缺陷**，而不是复述实现：
 *   A1 - 自绘窗口三键：平台门控 / 窗口控制桥 / 最大化态联动（2026-09-23 起，
 *        原生 titleBarOverlay 因「弹窗遮罩盖不住原生层」被用户投诉后退役）。
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
import { MemoryRouter } from 'react-router-dom';

import { titleBarHeight } from '../src/lib/topbarMetrics';
import { Modal } from '../src/components/common/Modal';
import { SegmentedControl } from '../src/components/ui/SegmentedControl';
import { TopBar } from '../src/components/layout/TopBar';

/* TopBar 子树（MobileMoreMenu → useBackupIo）需要仓储上下文；本文件只测顶栏 DOM，
 * 按仓库惯例（同 v07-t03b-ingress-wired）mock 掉 useRepos。深代理兜住任意解构深度。 */
vi.mock('../src/hooks/useRepos', () => {
  const deep = (): unknown =>
    new Proxy(function async() { return undefined; } as unknown as object, {
      get: () => deep(),
    });
  return { useRepos: (): unknown => deep() };
});

/* ============================ A1 · 自绘窗口三键 ============================
 *
 * 2026-09-23：原生 titleBarOverlay 退役，改自绘三键（用户投诉「弹窗一开、
 * 背景压暗，原生三键亮度不变像贴上去的」——叠加层由系统合成器画在网页之上，
 * DOM 遮罩盖不住它，压暗近似必然修不好）。本段钉新契约：三键是 DOM、
 * 随平台门控、走窗口控制桥、最大化态图标联动。
 * ========================================================================== */

describe('A1 · 自绘窗口三键（窗口控制桥 + 平台门控 + 最大化态联动）', () => {
  const original = window.idplan;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    window.idplan = original;
  });

  function stubBridge(
    controls: Record<string, unknown> = {},
    platform = 'win32',
  ): void {
    window.idplan = {
      isDesktop: true,
      platform,
      version: '0.0.0.0',
      // 子树（MobileMoreMenu → useUpdateCheck）订阅更新推送：给最小形状即可
      checkUpdate: async () => null,
      onUpdateAvailable: () => () => undefined,
      windowControls: {
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
        isMaximized: async () => false,
        onMaximizeChange: () => () => undefined,
        ...controls,
      },
    } as unknown as typeof window.idplan;
  }

  async function renderTopBar(): Promise<void> {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TopBar />
        </MemoryRouter>,
      );
    });
  }

  it('win32 桌面端：三键渲染，aria/锚点齐全，总宽 138 = 3×46', async () => {
    stubBridge();
    await renderTopBar();

    const group = document.querySelector('[data-window-controls]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute('aria-label')).toBe('窗口控制');
    for (const [anchor, label] of [
      ['minimize', '最小化'],
      ['maximize', '最大化'],
      ['close', '关闭'],
    ] as const) {
      const btn = document.querySelector<HTMLButtonElement>(`[data-window-control="${anchor}"]`);
      expect(btn, `缺少 ${anchor} 键`).not.toBeNull();
      expect(btn!.getAttribute('aria-label')).toBe(label);
      expect(btn!.type).toBe('button');
      // 命中宽 46px（Windows 10/11 标准）——写在类名上，几何真值由真浏览器验收钉
      expect(btn!.className).toContain('w-[46px]');
    }
    // 总宽 138 = 旧「原生叠加层避让位」同宽 ⇒ 右组元素（头像等）零位移
    expect((group as HTMLElement).style.width).toBe('138px');
  });

  it('★ 点击三键 → 对应窗口控制桥调用（最小化 / 最大化切换 / 关闭）', async () => {
    const minimize = vi.fn();
    const toggleMaximize = vi.fn();
    const close = vi.fn();
    stubBridge({ minimize, toggleMaximize, close });
    await renderTopBar();

    for (const anchor of ['minimize', 'maximize', 'close'] as const) {
      await act(async () => {
        document
          .querySelector<HTMLButtonElement>(`[data-window-control="${anchor}"]`)!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }
    expect(minimize).toHaveBeenCalledTimes(1);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('★ 最大化态联动：初值查询 + 变更推送 → 图标语义在「最大化 ⇄ 还原」间切换', async () => {
    let pushChange: ((v: boolean) => void) | null = null;
    stubBridge({
      isMaximized: async () => false,
      onMaximizeChange: (cb: (v: boolean) => void) => {
        pushChange = cb;
        return () => undefined;
      },
    });
    await renderTopBar();

    const maxBtn = () =>
      document.querySelector<HTMLButtonElement>('[data-window-control="maximize"]')!;
    expect(maxBtn().getAttribute('aria-label')).toBe('最大化');

    // 双击标题栏 / 系统快捷键改变态时，主进程走同一条推送
    await act(async () => {
      pushChange?.(true);
    });
    expect(maxBtn().getAttribute('aria-label')).toBe('还原');

    await act(async () => {
      pushChange?.(false);
    });
    expect(maxBtn().getAttribute('aria-label')).toBe('最大化');
  });

  it('非 win32（linux / macOS）不渲染三键——走系统装饰', async () => {
    stubBridge({}, 'linux');
    await renderTopBar();
    expect(document.querySelector('[data-window-controls]')).toBeNull();
  });

  it('浏览器 / NAS 端（无 window.idplan）不渲染、不抛错', async () => {
    window.idplan = undefined;
    await renderTopBar();
    expect(document.querySelector('[data-window-controls]')).toBeNull();
  });

  it('高度口径保留（topbarMetrics 单一出处）：<1280 → 56，≥1280 → 64', () => {
    const setWidth = (w: number): void => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
    };
    setWidth(1600);
    expect(titleBarHeight()).toBe(64);
    setWidth(1279); // 临界值必须走 56（断点严格锁 xl=1280，不得引入 lg=1024）
    expect(titleBarHeight()).toBe(56);
    setWidth(1024);
    expect(titleBarHeight()).toBe(56);
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
