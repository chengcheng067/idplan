// @vitest-environment jsdom
/**
 * 笔 ① · 共享组件 `ConfirmDialog` 的**界面文案来源**契约（新 spec）。
 *
 * ══════════════════ 判据（team-lead 立的，本文件就是它的机器化） ══════════════════
 * > `confirmText` / `cancelText` 的默认值硬编在**共享组件**里 ⇒ 省略这两参的调用方
 * > 在英文态**露中文**。**修法必须让「省略参数」这个用法本身得到正确语言的结果**
 * > （不许靠「记得传参」这种纪律 —— 那等于把 bug 推给下一个调用方）。
 *
 * ⇒ 本文件的第一条用例就是：**不传**这两参，分别在中/英两态**真渲染**，断按钮上的字。
 *   （比源码锁强：源码锁只能证明「默认值写着 t(...)」，证明不了「省略时真的拿到当前语言」。）
 *
 * 另外守三件事：
 * ② **显式传参优先**（K6 的反面用法）：需要**恒中文**的场合（纸面 / 打印）由调用方显式传，
 *    本组件不再给写死的中文 —— 用例里传一个中文字面量，两语言下都必须是它。
 * ③ **组件活代码里 0 个中文字面量**（源码锁；注释由 `maskComments` 剥掉）。
 * ④ **关闭钮的 aria 也接了消息表**（同一处共享组件里第三个硬编中文，顺手一并收掉）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConfirmDialog } from '../src/components/common/ConfirmDialog';
import { catalogOf, setLang } from '../src/i18n';
import { maskComments } from './helpers/cjk-locator-guard';

const rootDir = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(rootDir, p), 'utf8');

/* ══════════════ 渲染脚手架（Modal 底座要 matchMedia / ResizeObserver） ══════════════ */
let host: HTMLDivElement | null = null;
let root: Root | null = null;

function installEnvStubs(): void {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  w.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

function unmount(): void {
  if (root !== null) {
    const r = root;
    act(() => {
      r.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
}

/** 只给**必填**那几个 prop：`confirmText` / `cancelText` **刻意不传**（那就是被测的用法） */
function renderDialog(overrides: Partial<{ confirmText: string; cancelText: string }> = {}): void {
  unmount();
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  const r = createRoot(h);
  root = r;
  act(() => {
    r.render(
      <ConfirmDialog open title="T" onConfirm={() => undefined} onCancel={() => undefined} {...overrides}>
        正文
      </ConfirmDialog>,
    );
  });
}

/**
 * 面板里的两个动作按钮。
 * ⚠️ **按 DOM 位置取**（面板内最后两个 `button`），**不许**按文案/aria 过滤 ——
 *    后者本身就是「拿文案当定位」（本仓禁的形态），而且英文态会**静默取错元素**
 *    （第一版就是这么写的：用 `aria-label !== '关闭'` 排掉关闭钮 ⇒ 英文态排不掉，
 *     顺序整体错位，报出 `expected '' to be 'Cancel'` 这种看不懂的错）。
 */
function buttons(): HTMLButtonElement[] {
  const panel = document.querySelector<HTMLElement>('[role="dialog"]');
  if (panel === null) throw new Error('确认框没渲染（role=dialog 缺席）');
  const all = [...panel.querySelectorAll<HTMLButtonElement>('button')];
  expect(all.length, '确认框应有「关闭 + 取消 + 确认」三个按钮').toBe(3);
  return [all[1]!, all[2]!]; // [取消, 确认]
}

function closeButton(): HTMLButtonElement {
  const panel = document.querySelector<HTMLElement>('[role="dialog"]');
  if (panel === null) throw new Error('确认框没渲染');
  const b = panel.querySelector<HTMLButtonElement>('button');
  if (b === null) throw new Error('找不到关闭钮');
  return b; // 标题行里的第一个按钮就是关闭钮
}

beforeEach(() => {
  localStorage.clear();
  installEnvStubs();
  setLang('zh');
});

afterEach(() => {
  unmount();
  setLang('zh'); // 语言是模块级全局状态 ⇒ 复位，避免污染后续用例
});

/* ══════════════ ① 核心判据：**省略这两参**也拿到当前语言 ══════════════ */
describe('① 省略 confirmText / cancelText ⇒ 仍得到当前语言（本笔的核心判据）', () => {
  it('★ zh：按钮显示「取消 / 确定」（取自消息表，不是组件里的字面量）', () => {
    setLang('zh');
    renderDialog();
    const [cancel, confirm] = buttons();
    expect(cancel?.textContent).toBe(catalogOf('zh')['common.cancel']);
    expect(confirm?.textContent).toBe(catalogOf('zh')['common.confirm']);
  });

  it('★ en：**不传**这两参也必须是英文（修前：会渲染成「取消 / 确认」）', () => {
    setLang('en');
    renderDialog();
    const [cancel, confirm] = buttons();
    expect(cancel?.textContent, '省略 cancelText ⇒ 英文态露了中文').toBe(catalogOf('en')['common.cancel']);
    expect(confirm?.textContent, '省略 confirmText ⇒ 英文态露了中文').toBe(catalogOf('en')['common.confirm']);
    expect(/[\u4e00-\u9fff]/.test(`${cancel?.textContent}${confirm?.textContent}`), '英文态按钮上有汉字').toBe(
      false,
    );
  });

  it('★ 关闭钮的 aria 也随语言（同一处共享组件里第三个硬编中文，已一并收掉）', () => {
    setLang('zh');
    renderDialog();
    expect(closeButton().getAttribute('aria-label')).toBe(catalogOf('zh')['common.close']);
    setLang('en');
    renderDialog();
    const label = closeButton().getAttribute('aria-label');
    expect(label).toBe(catalogOf('en')['common.close']);
    expect(/[\u4e00-\u9fff]/.test(label ?? ''), '英文态关闭钮仍读中文').toBe(false);
  });

  it('切语言当场生效（组件订阅了语言，不是只读一次模块级快照）', () => {
    setLang('zh');
    renderDialog();
    expect(buttons()[1]?.textContent).toBe('确定');
    act(() => {
      setLang('en');
    });
    expect(buttons()[1]?.textContent, '切语言后按钮没换字 ⇒ 组件没订阅').toBe('OK');
  });
});

/* ══════════════ ② 显式传参优先（K6：要求恒中文的场合显式传） ══════════════ */
describe('② 显式传参覆盖缺省（K6 的用法：需要恒中文就显式传）', () => {
  it('★ 传了中文字面量 ⇒ 两语言下都必须是它（默认值不会把它盖掉）', () => {
    for (const lang of ['zh', 'en'] as const) {
      setLang(lang);
      renderDialog({ confirmText: '留痕删除', cancelText: '先不动' });
      const [cancel, confirm] = buttons();
      expect(cancel?.textContent, `${lang} 态下显式取消文案被默认值覆盖了`).toBe('先不动');
      expect(confirm?.textContent, `${lang} 态下显式确认文案被默认值覆盖了`).toBe('留痕删除');
    }
  });
});

/* ══════════════ ③ 源码锁：组件活代码里 0 个中文字面量 ══════════════ */
describe('③ 源码锁：共享组件不该再持有任何硬编界面文案', () => {
  const src = maskComments(read('src/components/common/ConfirmDialog.tsx'));

  it('★ 活代码里没有任何中文字面量（注释不算 —— 用 maskComments 剥过）', () => {
    const literals = [...src.matchAll(/'[^'\n]*[\u4e00-\u9fff][^'\n]*'/g)].map((m) => m[0]);
    expect(literals, `还有硬编中文：${literals.join(' / ')}`).toEqual([]);
  });

  it('★ 调用形状锁：两个按钮的缺省取自 `common.cancel` / `common.confirm`', () => {
    expect(src).toMatch(/cancelText\s*\?\?\s*t\('common\.cancel'\)/);
    expect(src).toMatch(/confirmText\s*\?\?\s*t\('common\.confirm'\)/);
    // 关闭钮的 aria 取自 common.close
    expect(src).toMatch(/aria-label=\{t\('common\.close'\)\}/);
  });

  it('注释里写明了「需要恒中文 ⇒ 显式传参，不要指望默认值」（K6 的登记不可省）', () => {
    /*
     * ⚠️ 这条要用**原文**（不剥注释）：`maskComments` 会把注释内容抹成空格，
     *    用它去断「注释里写了什么」必然红（第一版就是这么写的，当场被自己抓到）。
     */
    expect(read('src/components/common/ConfirmDialog.tsx'), 'K6 那条提醒必须留在文件里').toContain(
      '显式传参',
    );
  });
});
