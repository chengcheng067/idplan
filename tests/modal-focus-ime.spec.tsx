// @vitest-environment jsdom
/**
 * 回归测试：Modal 焦点劫持导致 IME 吞字（横切 bug，所有走 Modal 的输入框都受影响）。
 *
 * 症状：切换身份弹窗用微软拼音输入时「打第二个字，第一个字消失」。
 * 根因：Modal 的焦点 effect 依赖里带了 onClose；父组件（如 IdentityDialog）的
 *       handleClose 未 memo，每次输入触发重渲染都会产生新的 onClose 引用，
 *       导致该 effect 卸载重跑 —— cleanup 的焦点还原 + 重新聚焦面板，
 *       于是**每次击键都把焦点从输入框抢到面板 DIV 上**。
 *       输入框失焦会摧毁 Windows TSF/IME 组合上下文、强制结束进行中的组合，
 *       表现为每敲一个字都是一次全新组合，value 只剩最后一个字。
 *
 * 本测试的关键断言：连续输入过程中 document.activeElement 必须始终是那个 input。
 * 修复（deps 去掉 onClose）之前它会变成 Modal 的面板 DIV，测试必红。
 *
 * 只依赖 react-dom/client 原生渲染，不引入 testing-library。
 */
import { describe, expect, it, afterEach } from 'vitest';
import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// 注意：这里刻意沿用 react-dom/test-utils 的 act，而非 React 18.3 的新 React.act。
// 实测：换成 React.act（并置 IS_REACT_ACT_ENVIRONMENT=true）后，挂载期的被动 effect
// 会被推迟到下一次 act() 才 flush，导致「面板首次聚焦」发生在第一次输入时，
// 核心断言假红。与本仓库既有测试（ime-identity.spec.tsx）保持一致。
import { act } from 'react-dom/test-utils';

import { Modal } from '../src/components/common/Modal';
import { ImeInput } from '../src/components/common/ImeInput';

/**
 * 复刻 IdentityDialog 的形态：
 * onClose 是未 memo 的内联函数，每次重渲染都是全新引用（正是触发 bug 的条件）。
 */
function Harness({ onClosed }: { onClosed?: () => void }): JSX.Element {
  const [name, setName] = useState('');
  return (
    <Modal open onClose={() => { setName(''); onClosed?.(); }} ariaLabel="输入身份">
      <ImeInput
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="你的姓名"
        aria-label="你的姓名"
        /* 语言无关定位钩子（i18n-EN 批）：aria-label 保留（复刻 IdentityDialog 形态），
           但**定位改走 data-*** —— 不拿中文当选择器（本文件的输入框是测试自有夹具，
           中文串永不随语言变，但选择器形态要与全仓纪律一致）。 */
        data-ime-harness-input=""
      />
    </Modal>
  );
}

/** 绕过 React 的 value 追踪器写值，忠实模拟「IME 原生插入文本」。 */
function setValueNative(el: HTMLInputElement, v: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(el, v);
  else el.value = v;
}

/** 模拟微软拼音一次完整组合：start → update + input → end。 */
function imeCommit(el: HTMLInputElement, text: string): void {
  const next = el.value + text;
  el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  setValueNative(el, next);
  el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: text }));
  el.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      isComposing: true,
      inputType: 'insertCompositionText',
      data: text,
    }),
  );
  el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
}

describe('Modal 不得在输入过程中抢走输入框焦点（IME 吞字横切修复）', () => {
  let host: HTMLDivElement;
  let root: Root;

  function mount(el: React.ReactElement): void {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(el);
    });
  }

  afterEach(() => {
    if (root) act(() => root.unmount());
    host?.remove();
  });

  it('核心：连续输入全程输入框保持焦点，不被面板 DIV 抢走', () => {
    mount(<Harness />);
    const input = document.querySelector<HTMLInputElement>('input[data-ime-harness-input]');
    expect(input).toBeTruthy();

    act(() => input!.focus());
    expect(document.activeElement).toBe(input);

    // 第一个字：触发 setName → 父组件重渲染 → 产生新的 onClose 引用
    act(() => imeCommit(input!, 'd'));
    expect(document.activeElement).toBe(input);
    expect(input!.value).toBe('d');

    // 第二个字：修复前焦点已被抢到面板 DIV，组合上下文被摧毁 → 值变成 'w' 而非 'dw'
    act(() => imeCommit(input!, 'w'));
    expect(document.activeElement).toBe(input);
    expect(input!.value).toBe('dw');

    // 第三个字继续验证不会累积性失焦
    act(() => imeCommit(input!, 'm'));
    expect(document.activeElement).toBe(input);
    expect(input!.value).toBe('dwm');
  });

  it('核心：输入完成后焦点也不得停留在面板 DIV 上', () => {
    mount(<Harness />);
    const input = document.querySelector<HTMLInputElement>('input[data-ime-harness-input]');
    act(() => input!.focus());
    act(() => imeCommit(input!, 'z'));

    const panel = document.querySelector<HTMLElement>('[role="dialog"] > div');
    expect(panel).toBeTruthy();
    expect(document.activeElement).not.toBe(panel);
    expect(document.activeElement).toBe(input);
  });

  it('回归：Escape 仍能关闭，且调用的是最新的 onClose（ref 透传正确）', () => {
    let closed = 0;
    mount(<Harness onClosed={() => { closed += 1; }} />);
    const input = document.querySelector<HTMLInputElement>('input[data-ime-harness-input]');

    // 先输入，让父组件重渲染若干次，确保 onCloseRef 已被刷新到最新
    act(() => input!.focus());
    act(() => imeCommit(input!, 'a'));
    act(() => imeCommit(input!, 'b'));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closed).toBe(1);
  });

  it('回归：Tab 焦点圈禁仍生效（从最后一个可聚焦元素 Tab 回到第一个）', () => {
    let host2: HTMLDivElement | undefined;
    const container = document.createElement('div');
    document.body.appendChild(container);
    host2 = container;
    const r2 = createRoot(container);
    act(() => {
      r2.render(
        <Modal open onClose={() => {}} ariaLabel="圈禁测试">
          {/* 语言无关定位钩子（i18n-EN 批）：测试自有夹具的输入框，定位走 data-* */}
          <input aria-label="第一个" data-focus-trap-first="" />
          <button type="button">最后一个</button>
        </Modal>,
      );
    });

    const first = document.querySelector<HTMLInputElement>('input[data-focus-trap-first]')!;
    const last = document.querySelector<HTMLButtonElement>('button')!;

    act(() => last.focus());
    expect(document.activeElement).toBe(last);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      last.dispatchEvent(tab);
    });
    // 圈禁逻辑：从最后一个 Tab → 回到第一个
    expect(document.activeElement).toBe(first);

    act(() => r2.unmount());
    host2.remove();
  });

  it('回归：真正关闭弹窗时焦点仍还原给触发元素（cleanup 未被破坏）', () => {
    const trigger = document.createElement('button');
    trigger.textContent = '打开弹窗';
    document.body.appendChild(trigger);
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);

    const Comp = ({ open }: { open: boolean }): JSX.Element => (
      <Modal open={open} onClose={() => undefined} ariaLabel="测试">
        <input aria-label="姓名" />
      </Modal>
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const r2 = createRoot(container);

    // 打开 → 焦点进入弹窗（不再停留在触发按钮）
    act(() => r2.render(<Comp open />));
    expect(document.activeElement).not.toBe(trigger);

    // 关闭 → 焦点还原给触发元素（deps 只剩 [open] 后，cleanup 恰在此时执行一次）
    act(() => r2.render(<Comp open={false} />));
    expect(document.activeElement).toBe(trigger);

    act(() => r2.unmount());
    container.remove();
    trigger.remove();
  });

  it('回归：打开时锁定 body 滚动，卸载时还原', () => {
    const prev = document.body.style.overflow;
    mount(<Harness />);
    expect(document.body.style.overflow).toBe('hidden');

    act(() => root.unmount());
    expect(document.body.style.overflow).toBe(prev);
    // 已卸载，afterEach 再 unmount 会报错，这里置空
    root = undefined as unknown as Root;
  });
});
