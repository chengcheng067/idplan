// @vitest-environment jsdom
/**
 * 期五 · 预览连续缩放（滑块 + Ctrl+滚轮双入口；产品决策文档 §七附）。
 *
 * 她的原话：「同时，在打印预览的这个位置增加滑块，用于页面的放大与缩小；
 * 或者再增加一个 Ctrl+滚轮放大缩小页面的功能」——两个都做：滑块给发现性、
 * Ctrl+滚轮给效率，二者同一状态源。
 *
 * 本 spec 锁六件事：
 *   ① 滑块 change ⇒ 纸面缩放值实时变（50%–200%，步进 5%）；
 *   ② Ctrl+wheel 向上放大 / 向下缩小（同帧连续事件逐次累加、端点钳制），
 *      preventDefault 被调（页面不跟着滚）；
 *   ③ 不按 Ctrl 的 wheel 不触发缩放、不 preventDefault（预览区该滚还滚）；
 *   ④ 缩放态**不进打印克隆**：print-frame 的克隆源（paperRootRef 子树）
 *      自身与 cloneNode 产物都不带 transform——scale 在包裹层
 *      （.print-zoom-layer）上，物理上不在克隆范围；@media print 里另有
 *      transform 重置（主窗口兜底路径保险，静态锁）；
 *   ⑤ 导出 PNG 不受缩放影响：capture 期间 wrapper 无 transform（恒 100%），
 *      用户档位原样保留、完成后即恢复；
 *   ⑥ 适应/100% 两钮与滑块状态同步（点 100% ⇒ 滑块 100；拖到 100 ⇒ 钮点亮；
 *      fit 档滑块镜像实测值）——旧二态锚点行为不回归。
 * 附：缩放是预览瞬态——不进 usePrintPrefsStore（localStorage 零写入）。
 *
 * 挂载/打桩范式同 print-preview-zoom.spec.tsx：生产形态（先 open=false 再
 * 翻 true），useSchedulePaperData / SchedulePaper 顶掉；另顶 print-frame
 * （捕获克隆源）与 schedule-print 的导出函数（capture 时读 transform）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/** ResizeObserver：jsdom 无原生实现（Modal 与 fit 缩放 effect 都要，打桩保底） */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

/** rAF 保底：jsdom 未开 pretendToBeVisual 时导出路径的「等一帧」会挂 */
if (typeof globalThis.requestAnimationFrame !== 'function') {
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (
    cb: FrameRequestCallback,
  ): number => window.setTimeout(() => cb(DateNow()), 0) as unknown as number;
}
function DateNow(): number {
  return Date.now();
}

/** 共享捕获态（vi.mock 工厂先于 import 执行，只能经 vi.hoisted 传递） */
const H = vi.hoisted(() => ({
  /** printPaper 收到的克隆源元素（transform 隔离实证） */
  printCalls: [] as unknown[],
  /** exportSchedulePngPages 被调时 wrapper 的 transform（导出恒 100% 实证） */
  transformAtCapture: null as string | null,
}));

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

/** 纸面 stub：两枚 .a4-page 且收 pageRef（导出路径要 els 非空才继续） */
vi.mock('../src/components/print/SchedulePaper', () => ({
  SchedulePaper: ({
    pageRef,
  }: {
    pageRef?: (idx: number) => (el: HTMLDivElement | null) => void;
  }): JSX.Element => (
    <>
      {[0, 1].map((i) => (
        <div key={i} className="a4-page" ref={pageRef ? pageRef(i) : undefined} />
      ))}
    </>
  ),
}));

/** print-frame：捕获打印调用的克隆源（iframe 路径恒 'frame'，不触发回退 toast） */
vi.mock('../src/lib/print-frame', () => ({
  printPaper: (root: HTMLElement): 'frame' => {
    H.printCalls.push(root);
    return 'frame';
  },
}));

/** schedule-print：只顶掉导出函数（其余真身）；capture 时读 wrapper transform */
vi.mock('../src/lib/schedule-print', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/schedule-print')>();
  return {
    ...actual,
    exportSchedulePngPages: async (els: HTMLDivElement[]): Promise<void> => {
      const stage = document.querySelector('[data-print-preview-stage]');
      const wrapper = stage?.firstElementChild as HTMLElement | null;
      H.transformAtCapture = wrapper?.style.transform ?? null;
      expect(els.length, '导出应收到纸面元素').toBeGreaterThan(0);
    },
  };
});

import { PrintPreviewDialog } from '../src/components/print/PrintPreviewDialog';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  H.printCalls.length = 0;
  H.transformAtCapture = null;
  localStorage.clear();
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

/** 缩放包裹层（stage 的直接子 div；.print-zoom-layer） */
function zoomWrapper(): HTMLElement | null {
  const stage = document.querySelector('[data-print-preview-stage]');
  return (stage?.firstElementChild as HTMLElement | null) ?? null;
}

/** 打印克隆源（paperRootRef：灰度 wrapper，iframe 克隆的就是它） */
function printSource(): HTMLElement | null {
  return document.querySelector('[data-print-grayscale]');
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

/** 点「导出 PNG（N 张）」（前缀匹配——张数随页数变） */
function clickExportPng(): void {
  const btn = Array.from(document.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').trim().startsWith('导出 PNG'),
  );
  if (!btn) throw new Error('找不到导出 PNG 按钮');
  act(() => {
    btn.click();
  });
}

function slider(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('[data-print-zoom-slider]');
  if (!el) throw new Error('找不到缩放滑块');
  return el;
}

/** 拖滑块（原生 value setter + input 事件，React 受控组件标准打法） */
function setSlider(percent: number): void {
  const el = slider();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, String(percent));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 百分比读数（工具条等宽数字） */
function percentText(): string {
  return (document.querySelector('[data-print-zoom-value]')?.textContent ?? '').trim();
}

function pressedOf(label: string): string | null {
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  return btn?.getAttribute('aria-pressed') ?? null;
}

/** 造一个 wheel 事件（jsdom 无 WheelEvent 构造器时的等价物） */
function wheelEvent(deltaY: number, ctrl: boolean): Event {
  const ev = new Event('wheel', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'ctrlKey', { get: () => ctrl });
  Object.defineProperty(ev, 'deltaY', { get: () => deltaY });
  return ev;
}

function dispatchWheel(deltaY: number, ctrl: boolean): Event {
  const ev = wheelEvent(deltaY, ctrl);
  const stage = document.querySelector('[data-print-preview-stage]')!;
  act(() => {
    stage.dispatchEvent(ev);
  });
  return ev;
}

/* ====================================================================================
 * ① 滑块
 * ==================================================================================== */

describe('期五 · ① 滑块：change ⇒ 纸面缩放实时变（50%–200% / 步进 5%）', () => {
  it('滑块属性（范围/步进/无障碍名）+ 拖动改 transform 与百分比', () => {
    render(false);
    render(true);
    // 前置：fit 档首开即算出缩放（jsdom 无布局 ⇒ 下限 0.25）
    expect(zoomWrapper()!.style.transform, 'fit 档首开应有 transform').toBe('scale(0.25)');

    // 滑块属性（与 ZOOM_MIN/MAX/STEP 同一口径）
    expect(slider().min).toBe('50');
    expect(slider().max).toBe('200');
    expect(slider().step).toBe('5');
    expect(slider().getAttribute('aria-label')).toBe('预览缩放滑块');
    // fit 档百分比镜像实测值；range 输入自身把低于 min 的读数钳到 50
    // （窄窗口 fit 25% 时的既成行为：标签讲真话，滑块钳在下限）
    expect(percentText()).toBe('25%');
    expect(slider().value).toBe('50');

    // 拖到 150% ⇒ 纸面实时缩放 + 百分比读数
    setSlider(150);
    expect(zoomWrapper()!.style.transform).toBe('scale(1.5)');
    expect(percentText()).toBe('150%');
    expect(pressedOf('适应'), '拖滑块后退出 fit 档').toBe('false');

    // 端点值
    setSlider(200);
    expect(zoomWrapper()!.style.transform).toBe('scale(2)');
    expect(percentText()).toBe('200%');
    setSlider(50);
    expect(zoomWrapper()!.style.transform).toBe('scale(0.5)');
    expect(percentText()).toBe('50%');

    // 100% 档撤掉 transform（旧「100%」行为：wrapper 无 transform）
    setSlider(100);
    expect(zoomWrapper()!.style.transform, '100% 应无 transform').toBe('');
    expect(percentText()).toBe('100%');
  });
});

/* ====================================================================================
 * ② Ctrl+滚轮
 * ==================================================================================== */

describe('期五 · ② Ctrl+滚轮：上下缩放 + preventDefault + 累加钳制', () => {
  it('向上放大 / 向下缩小；连续事件逐次累加；端点钳制不越界', () => {
    render(false);
    render(true);
    clickButton('100%'); // 从 100% 起算（custom 档）
    expect(zoomWrapper()!.style.transform, '100% 档无 transform').toBe('');

    // 向上（deltaY<0）放大一档（5%），且阻止了页面滚动
    const up = dispatchWheel(-100, true);
    expect(zoomWrapper()!.style.transform).toBe('scale(1.05)');
    expect(up.defaultPrevented, 'Ctrl+wheel 必须 preventDefault').toBe(true);

    // 向下缩小一档（回到 1 ⇒ 撤掉 transform，100% 档行为）
    const down = dispatchWheel(100, true);
    expect(zoomWrapper()!.style.transform, '回到 100% 应无 transform').toBe('');
    expect(percentText()).toBe('100%');
    expect(down.defaultPrevented).toBe(true);

    // 同帧连续滚轮（一次惯性排多个事件）逐次累加 ⇒ 30 档后钳在 200%
    for (let i = 0; i < 30; i++) dispatchWheel(-100, true);
    expect(zoomWrapper()!.style.transform, '连滚 30 档应钳在最大值 2').toBe('scale(2)');
    expect(percentText()).toBe('200%');

    // 反方向 40 档 ⇒ 钳在 50%
    for (let i = 0; i < 40; i++) dispatchWheel(100, true);
    expect(zoomWrapper()!.style.transform, '连滚 40 档应钳在最小值 0.5').toBe('scale(0.5)');
    expect(percentText()).toBe('50%');
  });

  it('fit 档接管不断档：基座低于手动下限 ⇒ 首档落在下限 50%', () => {
    render(false);
    render(true);
    // 首开是 fit 档（scale 0.25，jsdom 无布局下限）；Ctrl+wheel 向上接管。
    // 手动档位领域就是滑块的 50%–200%（没有更小的档）⇒ 首档落在下限 0.5，
    // 不是从 1 起跳、也不是 0.3（那会掉出手动领域，滑块与标签对不上）。
    expect(zoomWrapper()!.style.transform).toBe('scale(0.25)');
    dispatchWheel(-100, true);
    expect(zoomWrapper()!.style.transform, '接管首档应落在手动下限').toBe('scale(0.5)');
    expect(percentText()).toBe('50%');
    expect(pressedOf('适应'), '滚轮后退出 fit 档').toBe('false');

    // 接管后继续在手动领域内逐档走
    dispatchWheel(-100, true);
    expect(zoomWrapper()!.style.transform).toBe('scale(0.55)');
  });
});

/* ====================================================================================
 * ③ 无 Ctrl 不拦截
 * ==================================================================================== */

describe('期五 · ③ 无 Ctrl 的 wheel：不缩放、不拦截', () => {
  it('普通滚轮原样放行（预览区该滚还滚）', () => {
    render(false);
    render(true);
    clickButton('100%');
    const ev = dispatchWheel(-100, false);
    expect(zoomWrapper()!.style.transform, '无 Ctrl 不触发缩放').toBe('');
    expect(ev.defaultPrevented, '无 Ctrl 不得 preventDefault').toBe(false);
  });
});

/* ====================================================================================
 * ④ 打印隔离
 * ==================================================================================== */

describe('期五 · ④ 缩放态不进打印克隆', () => {
  it('150% 缩放下点打印：克隆源与克隆产物都不带 transform', () => {
    render(false);
    render(true);
    setSlider(150);
    // 屏幕上确实缩放着（隔离不是「不缩放」而是「缩放不进打印」）
    expect(zoomWrapper()!.style.transform).toBe('scale(1.5)');

    clickButton('打印');
    expect(H.printCalls.length, '打印应走一次 printPaper').toBe(1);
    const src = H.printCalls[0] as HTMLElement;
    // 克隆源是灰度 wrapper（paperRootRef）；scale 在它的**父层**包裹层上
    expect(src, '克隆源应是打印纸面容器').toBe(printSource());
    expect(src.style.transform, '克隆源自身无 transform').toBe('');
    // 最近的带 transform 的祖先就是缩放包裹层（scale 物理上在克隆范围外）
    expect(src.closest('[style*="transform"]'), 'transform 只在包裹层').toBe(zoomWrapper());
    expect(zoomWrapper()!.contains(src), '克隆源确实在包裹层内').toBe(true);
    // 克隆产物（iframe 里实际打印的 DOM）同样零 transform
    const clone = src.cloneNode(true) as HTMLElement;
    expect(clone.outerHTML, '克隆产物不得带 scale').not.toContain('scale(');
    expect(clone.outerHTML, '克隆产物不得带 transform').not.toContain('transform');
  });

  it('@media print 里 .print-zoom-layer transform 重置（主窗口兜底路径保险）', () => {
    const ROOT = resolve(__dirname, '..');
    const css = readFileSync(resolve(ROOT, 'src/styles/global.css'), 'utf-8');
    const at = css.indexOf('@media print');
    expect(at, 'global.css 应有 @media print 块').toBeGreaterThan(-1);
    const printBlock = css.slice(at);
    expect(printBlock, '打印块内应有缩放层重置').toContain('.print-zoom-layer');
    expect(printBlock).toContain('transform: none !important');
  });
});

/* ====================================================================================
 * ⑤ 导出 PNG 不受影响
 * ==================================================================================== */

describe('期五 · ⑤ 导出 PNG 不受缩放影响', () => {
  it('150% 档导出：capture 期间 wrapper 无 transform（恒 100%），完成后档位恢复', async () => {
    render(false);
    render(true);
    setSlider(150);
    expect(zoomWrapper()!.style.transform).toBe('scale(1.5)');

    clickExportPng();
    // 等异步导出链走完（rAF 等帧 + exportSchedulePngPages）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(H.transformAtCapture, 'capture 期间必须无 transform（导出恒 100%）').toBe('');
    expect(zoomWrapper()!.style.transform, '导出后用户档位原样恢复（无视觉残留）').toBe('scale(1.5)');
  });
});

/* ====================================================================================
 * ⑥ 锚点同步 + 瞬态纪律
 * ==================================================================================== */

describe('期五 · ⑥ 适应/100% 与滑块同步；缩放是预览瞬态', () => {
  it('点 100% ⇒ 滑块到 100；拖到 100 ⇒ 钮点亮；回适应 ⇒ 滑块镜像实测值', () => {
    render(false);
    render(true);

    // 点 100%：滑块与百分比同步到 100，100% 钮点亮、适应熄灭
    clickButton('100%');
    expect(slider().value).toBe('100');
    expect(percentText()).toBe('100%');
    expect(pressedOf('100%')).toBe('true');
    expect(pressedOf('适应')).toBe('false');
    expect(zoomWrapper()!.style.transform, '100% 档无 transform').toBe('');

    // 拖到 120：100% 锚点熄灭（两个入口不存两套状态）
    setSlider(120);
    expect(pressedOf('100%')).toBe('false');
    expect(percentText()).toBe('120%');

    // 拖回 100：锚点重新点亮（互为同步）
    setSlider(100);
    expect(pressedOf('100%')).toBe('true');

    // 回适应：百分比镜像 fit 实测值（jsdom 下限 25%），transform 回来；
    // range 输入把低于 min 的读数钳到 50（见 ① 的口径注释）
    clickButton('适应');
    expect(pressedOf('适应')).toBe('true');
    expect(percentText()).toBe('25%');
    expect(slider().value).toBe('50');
    expect(zoomWrapper()!.style.transform).toBe('scale(0.25)');
  });

  it('缩放不进 usePrintPrefsStore：交互后 localStorage 零写入', () => {
    render(false);
    render(true);
    setSlider(150);
    dispatchWheel(-100, true);
    clickButton('100%');
    clickButton('适应');
    expect(
      localStorage.getItem('changxia.printPrefs'),
      '缩放是预览瞬态，不得落 localStorage',
    ).toBeNull();
    // 静态锁：prefs store 不新增缩放字段（partialize 仍四字段）
    const ROOT = resolve(__dirname, '..');
    const src = readFileSync(resolve(ROOT, 'src/store/usePrintPrefsStore.ts'), 'utf-8');
    expect(src, 'prefs store 不得引入缩放状态').not.toContain('zoom');
    expect(src).not.toContain('scale');
  });
});
