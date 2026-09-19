// @vitest-environment jsdom
/**
 * 一次性验证 spec：确认 Modal 底座在 createPortal 下能拦住合成 click，
 * 防止点弹窗内输入框沿 React 树冒泡到外层触发器（bug #1 的项目卡片跳转问题）。
 * 只依赖 react-dom/client 原生渲染，不引入 testing-library。
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

describe('Modal 合成冒泡拦截（bug #1）', () => {
  let host: HTMLDivElement;
  let unmountHost: (() => void) | undefined;

  afterEach(() => {
    unmountHost?.();
    host?.remove();
    unmountHost = undefined;
  });

  it('点弹窗内输入框不会触发外层触发器 onClick', () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    let outerClicked = 0;
    // 模拟 ProjectCard：外层是可点击触发器（onClick 会跳转），内嵌一个 Modal。
    unmountHost = renderIn(
      host,
      React.createElement(
        'div',
        { onClick: () => { outerClicked += 1; } },
        React.createElement('span', null, '项目卡片'),
        React.createElement(
          Modal,
          {
            open: true,
            onClose: () => {},
            ariaLabel: '项目重命名',
            children: React.createElement('input', {
              'aria-label': '新的项目名称',
              value: '测试',
              onChange: () => {},
            }),
          },
        ),
      ),
    );

    const input = document.querySelector<HTMLInputElement>('input[aria-label="新的项目名称"]');
    expect(input).toBeTruthy();
    input!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // 断言：外层触发器 onClick 未被触发（不应跳转）
    expect(outerClicked).toBe(0);
  });

  it('对照组——在没有 Modal 拦截时，portal 内 click 会冒泡到外层触发跳转', () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    let outerClicked = 0;
    const { createPortal } = require('react-dom');
    unmountHost = renderIn(
      host,
      React.createElement(
        'div',
        { onClick: () => { outerClicked += 1; } },
        React.createElement('span', null, '对照组卡片'),
        createPortal(
          React.createElement('input', { 'aria-label': '对照输入框' }),
          document.body,
        ),
      ),
    );

    const input = document.querySelector<HTMLInputElement>('input[aria-label="对照输入框"]');
    expect(input).toBeTruthy();
    input!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // 对照组没有 stopPropagation，外层 onClick 被触发（证明 bug 确实存在）
    expect(outerClicked).toBe(1);
  });
});
