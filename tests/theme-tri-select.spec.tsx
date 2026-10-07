// @vitest-environment jsdom
/**
 * 主题三选（浅色 / 深色 / 跟随系统）高亮回归 —— v0.8.6.0002 · 反馈 #4 前半。
 *
 * 她的话：「选择了主题以后，比如系统已经是浅色，如果我选择了'浅色'，这个按钮就
 * 不会跳转到'跟随系统'。只有点击了'深色'以后，再点击'跟随系统'才会有反应。」
 *
 * 根因（src/hooks/useTheme.ts）：外部 store 的快照只含**生效主题** current，
 * 不含**用户选择** mode。系统为浅色时点「浅色」，mode: system→light 而
 * current 仍是 light，快照值未变 ⇒ useSyncExternalStore 跳过重渲染 ⇒
 * 高亮停留在上一帧的「跟随系统」。修法：快照改为 { mode, current } 合并对象，
 * 任一变化即换引用，订阅方必然重渲染。
 *
 * 本 spec 复刻设置面板的真实消费形态（const { mode, setMode } = useTheme() +
 * 高亮判断 mode === key + setMode 点击），逐条锁：
 *   1. 初始（无显式选择）：「跟随系统」高亮；
 *   2. 系统浅色 + 点「浅色」：高亮跳「浅色」（回归位，此前不跳）；
 *   3. 点「深色」：高亮跳「深色」且 <html data-theme> 变 dark；
 *   4. 点「跟随系统」：高亮回「跟随系统」，data-theme 回系统浅色；
 *   5. 系统偏好实时切换（未显式选择时）：跟随系统仍高亮、颜色实时跟随；
 *   6. 显式选过之后系统再切：保持用户选择（不跟系统）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { initTheme, useTheme } from '../src/hooks/useTheme';

/* --------------------- matchMedia 打桩（jsdom 无原生实现） --------------------- */

type ChangeCb = (e: { matches: boolean }) => void;
const changeCbs = new Set<ChangeCb>();
let systemDark = false;

const fakeMql = {
  get matches() {
    return systemDark;
  },
  media: '(prefers-color-scheme: dark)',
  onchange: null,
  addEventListener: (_type: string, cb: ChangeCb) => changeCbs.add(cb),
  removeEventListener: (_type: string, cb: ChangeCb) => changeCbs.delete(cb),
  addListener: (cb: ChangeCb) => changeCbs.add(cb),
  removeListener: (cb: ChangeCb) => changeCbs.delete(cb),
  dispatchEvent: () => false,
};

beforeEach(() => {
  localStorage.clear();
  changeCbs.clear();
  systemDark = false;
  document.documentElement.removeAttribute('data-theme');
  vi.stubGlobal('matchMedia', vi.fn(() => fakeMql));
});

/** 把系统偏好切到 dark/light 并派发 change（模拟 OS 层实时切换） */
function emitSystemChange(dark: boolean): void {
  systemDark = dark;
  act(() => {
    changeCbs.forEach((cb) => cb({ matches: dark }));
  });
}

/* --------------------- 最小 harness：复刻设置面板消费形态 --------------------- */

const THEME_OPTIONS = ['light', 'dark', 'system'] as const;
const LABELS: Record<(typeof THEME_OPTIONS)[number], string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

function ThemeTriSelect(): JSX.Element {
  const { mode, setMode } = useTheme();
  return (
    <div>
      {THEME_OPTIONS.map((key) => (
        <button key={key} type="button" aria-label={LABELS[key]} aria-pressed={mode === key} onClick={() => setMode(key)}>
          {LABELS[key]}
        </button>
      ))}
    </div>
  );
}

let container: HTMLDivElement;
let root: Root;

function setup(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
}

function teardown(): void {
  act(() => root.unmount());
  document.body.removeChild(container);
}

function render(): void {
  act(() => {
    root.render(<ThemeTriSelect />);
  });
}

/** 当前高亮（aria-pressed=true）的按钮标签 */
function pressedLabel(): string | null {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-pressed') === 'true');
  return btn?.getAttribute('aria-label') ?? null;
}

function click(label: string): void {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === label);
  if (!btn) throw new Error(`找不到按钮：${label}`);
  act(() => {
    btn.click();
  });
}

function currentDataTheme(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

/* -------------------------------- 用例 -------------------------------- */

describe('主题三选高亮（反馈 #4 前半）', () => {
  it('高亮始终跟随用户显式选择，与生效主题解耦', () => {
    initTheme(); // 生产入口：main.tsx 渲染前同一路径
    setup();
    render();

    // 1. 初始：无显式选择（localStorage 空）= 跟随系统
    expect(pressedLabel()).toBe('跟随系统');
    expect(currentDataTheme()).toBe('light');

    // 2. 回归位：系统浅色时点「浅色」——高亮必须跳到「浅色」。
    //    修复前快照只有 current（light→light 未变），本断言失败。
    click('浅色');
    expect(pressedLabel(), '系统浅色 + 点浅色：高亮应跳浅色').toBe('浅色');
    expect(currentDataTheme()).toBe('light');

    // 3. 点「深色」：高亮跳深色，实际换肤
    click('深色');
    expect(pressedLabel()).toBe('深色');
    expect(currentDataTheme()).toBe('dark');

    // 4. 点「跟随系统」：高亮回跟随系统，颜色回落到系统浅色
    click('跟随系统');
    expect(pressedLabel()).toBe('跟随系统');
    expect(currentDataTheme()).toBe('light');
    expect(localStorage.getItem('idplan-theme')).toBeNull();

    // 5. 未显式选择时，系统实时切换 → 跟随系统仍高亮且实时换肤
    emitSystemChange(true);
    expect(pressedLabel()).toBe('跟随系统');
    expect(currentDataTheme()).toBe('dark');

    // 6. 显式选过之后，系统再切 → 保持用户选择（不跟系统）
    click('浅色');
    expect(pressedLabel()).toBe('浅色');
    emitSystemChange(false);
    expect(currentDataTheme()).toBe('light');
    emitSystemChange(true);
    expect(pressedLabel(), '显式选择后系统切换不应改变高亮').toBe('浅色');
    expect(currentDataTheme(), '显式选择后系统切换不应改变生效主题').toBe('light');

    teardown();
  });
});
