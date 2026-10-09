// @vitest-environment jsdom
/**
 * Modal `fullscreen` 档 · railLeft 让出侧栏的几何断言（她 10-09 23:38 反馈：
 * 「然后日程表打印预览的窗口不要超过左侧的侧边栏」）。
 *
 * ── 反馈与修法 ──
 * fullscreen 档（打印预览）的遮罩几何原是 `fixed inset-x-0 bottom-0
 * md:top-14 xl:top-16`——从 x=0 起，**盖住整个常驻侧栏**（压暗、不可点）。
 * 修法复用 `left-rail` 档（反馈 #1：设置抽屉贴侧栏右缘展开）的既有让位
 * 模式：fullscreen 接受**可选** railLeft，传了就把遮罩（与全屏面板）左缘
 * 推到该宽度（内联 style 的 left 覆盖 inset-x-0 的 left:0）；不传保持全宽
 * （<xl 无持久侧栏 ⇒ 现状不变）。bg / z 档不随本参数变。
 *
 * ── 为什么在 jsdom 里断言几何 ──
 * 让位的载体是遮罩元素上的 **inline style left**（+ 不变的类名面：
 * bg-ink/45 + z-[75] + top-14 xl:top-16 顶栏让位）——jsdom 足以诚实断言
 * （style.left / className 都是 DOM 事实）。「侧栏真的可见可点」的活体验证
 * 由 qa-batch-a-verify 的真 Chromium 探针族承担（Q-A2 同款判据），本 spec
 * 守组件契约：参数 → 几何的映射不漂移。
 *
 * 范式同 tests/modal.bubble.spec.ts：只依赖 react-dom/client 原生渲染，
 * 不引入 testing-library。
 */
import { describe, expect, it, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Modal } from '../src/components/common/Modal';

function renderIn(container: HTMLDivElement, el: React.ReactNode): () => void {
  const root = createRoot(container);
  flushSync(() => root.render(el));
  return () => root.unmount();
}

/** 取遮罩本体（role=dialog 的 portal 根） */
function overlayEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!el) throw new Error('Modal 遮罩未渲染');
  return el;
}

function renderModal(props: Partial<React.ComponentProps<typeof Modal>>): () => void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return renderIn(
    host,
    React.createElement(Modal, {
      open: true,
      onClose: () => {},
      ariaLabel: '测试浮层',
      children: React.createElement('div', { 'data-testid': 'panel' }, '面板'),
      ...props,
    } as React.ComponentProps<typeof Modal>),
  );
}

describe('Modal fullscreen · railLeft 让出侧栏（她 10-09 23:38 反馈）', () => {
  let unmountHost: (() => void) | undefined;

  afterEach(() => {
    unmountHost?.();
    unmountHost = undefined;
    document.body.innerHTML = '';
  });

  it('fullscreen + railLeft ⇒ 遮罩左缘让出（inline left），bg / z / 顶栏让位不变', () => {
    unmountHost = renderModal({ placement: 'fullscreen', railLeft: '240px' });
    const overlay = overlayEl();
    // 让位载体：inline style left 覆盖 inset-x-0 的 left:0
    expect(overlay.style.left, 'fullscreen + railLeft 应把遮罩左缘让出到 240px').toBe('240px');
    // 浓度与层级不随让位变（仍是 ink/45 + z-75 全屏预览那一档）
    expect(overlay.className).toContain('bg-ink/45');
    expect(overlay.className).toContain('z-[75]');
    // 顶栏让位几何不动（top-14 xl:top-16；<md 两行顶帽 100）
    expect(overlay.className).toContain('md:top-14');
    expect(overlay.className).toContain('xl:top-16');
    expect(overlay.className).toContain('max-md:top-[100px]');
    // 面板仍是全屏几何（p-0，不引入点击缓冲区）
    const panel = overlay.firstElementChild as HTMLElement;
    expect(panel.className).toContain('p-0');
  });

  it('fullscreen 不传 railLeft ⇒ 无 inline left（全宽，<xl 现状不变）', () => {
    unmountHost = renderModal({ placement: 'fullscreen' });
    const overlay = overlayEl();
    expect(overlay.style.left, '不传 railLeft 不得写 inline left（保持全宽）').toBe('');
    expect(overlay.className).toContain('bg-ink/45');
    expect(overlay.className).toContain('z-[75]');
  });

  it('left-rail 档口径不变（反馈 #1：传值让出 / 缺省 0px 全屏）', () => {
    unmountHost = renderModal({ placement: 'left-rail', railLeft: '64px' });
    expect(overlayEl().style.left).toBe('64px');
    unmountHost?.();
    unmountHost = renderModal({ placement: 'left-rail' });
    expect(overlayEl().style.left, 'left-rail 缺省仍是 0px（全屏，与 left 档一致）').toBe('0px');
  });

  it('其余档位不受影响（center / right / dropdown 无 inline left）', () => {
    for (const placement of ['center', 'right', 'dropdown', 'float', 'right-float', 'left'] as const) {
      unmountHost = renderModal({ placement });
      expect(overlayEl().style.left, `${placement} 档不得写 inline left`).toBe('');
      unmountHost?.();
      unmountHost = undefined;
    }
  });
});
