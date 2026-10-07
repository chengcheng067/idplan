// @vitest-environment jsdom
/**
 * 0.8.6.0002 · 反馈 #9.1：打印预览「适应 / 100%」按钮**首次打开**失效。
 *
 * 她的原话：「修复'适应'和'百分之百'按钮在第一次打开时会失效的问题」。
 *
 * 根因（PrintPreviewDialog）：fit 缩放 effect 只依赖 `[zoom]`，而本面板是
 * 「常驻挂载、open 才渲染内容」——Modal 在 open=false 时 return null，stage
 * 元素每次打开才挂载。首开时 deps 未变 ⇒ effect 不跑 ⇒ scale 停在初始 1、
 * ResizeObserver 也没挂：「适应」是按下的却没生效，「100%」因 scale 本就是 1
 * 点了肉眼无变化。
 *
 * 本 spec 复刻生产挂载形态（先挂 open=false，再翻 true = 首次打开），断言：
 *   ① 首帧 fit 档就把缩放算出来（wrapper 上有 transform: scale(...)）；
 *   ② 点「100%」：缩放撤销（wrapper 无 transform）；
 *   ③ 再点「适应」：缩放恢复（transform 回来，且 observer 重挂）。
 * 修复前 ① 失败（wrapper 只有 transition、无 transform）。
 *
 * 手法同既有 jsdom 组件测：原生 react-dom/client，仓储/数据 hook 用 vi.mock 顶掉。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/** ResizeObserver：jsdom 无原生实现（Modal 的 float 档同样靠它，打桩保底） */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

/** 纸面数据：hydrated 直接为真，跳过加载态（本 spec 只关心缩放档位） */
vi.mock('../src/components/print/useSchedulePaperData', () => ({
  useSchedulePaperData: (projectId: string) => ({
    hydrated: true,
    project: { id: projectId || 'p1', name: '云栖·湖畔茶室' },
    pages: [{}, {}],
    sections: [],
    bandGeom: null,
    monthTicks: [],
    nowText: '',
    startAt: '',
    endAt: '',
    totalDays: 0,
    role: 'member',
  }),
}));

/** 纸面本体与缩放档位无关：打桩占位（真实纸面结构由 print-preview.spec 锁） */
vi.mock('../src/components/print/SchedulePaper', () => ({
  SchedulePaper: (): JSX.Element => <div data-paper-stub="" style={{ width: 794, height: 1123 }} />,
}));

import { PrintPreviewDialog } from '../src/components/print/PrintPreviewDialog';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.removeChild(container);
});

/** 按生产形态挂载：ProjectCard 常驻挂载本面板，靠 open 切换 */
function render(open: boolean): void {
  act(() => {
    root.render(<PrintPreviewDialog projectId="p1" open={open} onClose={() => {}} />);
  });
}

/** 缩放 wrapper（stage 的直接子 div；fit 档带 transform，100% 档只有 transition） */
function zoomWrapper(): HTMLElement | null {
  const stage = document.querySelector('[data-print-preview-stage]');
  return (stage?.firstElementChild as HTMLElement | null) ?? null;
}

function clickButton(text: string): void {
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === text,
  );
  if (!btn) throw new Error(`找不到按钮：${text}`);
  act(() => {
    btn.click();
  });
}

describe('打印预览缩放二态 · 首次打开即可用（反馈 #9.1）', () => {
  it('首帧 fit 档即算出缩放；100% / 适应来回切换都即时生效', () => {
    // 生产形态：先挂关闭态，再打开（Modal 此时才渲染 stage 子树）
    render(false);
    expect(zoomWrapper(), '关闭态不应渲染预览区').toBeNull();

    render(true);
    const wrapper = zoomWrapper();
    expect(wrapper, '打开后应渲染预览区').not.toBeNull();

    // ① 回归位：首次打开 fit 档必须已**算出**缩放。
    //    jsdom 无布局 ⇒ stage.clientWidth=0 ⇒ clamp((0−32)/794, 0.25, 1) = 0.25。
    //    旧实现此处是 scale(1)（effect 没跑，初始值原样透出）——精确值才能逮到。
    expect(wrapper!.style.transform, '首开 fit 档应已应用计算出的缩放（jsdom 下限 0.25）').toBe('scale(0.25)');

    // ② 点「100%」：撤销缩放（无 transform，只留过渡）
    clickButton('100%');
    expect(zoomWrapper()!.style.transform, '100% 档应无 transform').toBe('');
    const fitPressed = () =>
      Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === '适应')
        ?.getAttribute('aria-pressed') ?? null;
    expect(fitPressed()).toBe('false');

    // ③ 点回「适应」：缩放恢复（effect 因 stageEl 依赖重跑）
    clickButton('适应');
    expect(zoomWrapper()!.style.transform, '切回适应应恢复 transform:scale(...)').toContain('scale(');
    expect(fitPressed()).toBe('true');
  });

  it('关闭再打开：档位保持，且 fit 档缩放重新计算（observer 重挂，不留陈旧 scale）', () => {
    render(false);
    render(true);
    // fit 档首开：缩放已算出（scale(0.25)，见上一个用例的口径注释）
    const first = zoomWrapper()!.style.transform;
    expect(first, 'fit 档首开应已算出缩放').toBe('scale(0.25)');

    // 关闭 → 再打开：wrapper 重新挂载，fit 档必须重算出缩放（stageEl null→el 换依赖）
    render(false);
    expect(zoomWrapper(), '关闭态不渲染预览区').toBeNull();
    render(true);
    expect(zoomWrapper()!.style.transform, '重开首帧 fit 档应重新应用缩放').toBe(first);

    // 切 100% 后关闭再开：档位保持（不重置回 fit）——缩放选择是跨打开持久的偏好
    clickButton('100%');
    render(false);
    render(true);
    expect(zoomWrapper()!.style.transform, '100% 档跨打开保持，不重置回 fit').toBe('');
  });
});
