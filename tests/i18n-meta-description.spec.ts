// @vitest-environment jsdom
/**
 * 笔 4-c · `index.html` 的 meta description **运行时语言同步**的契约（新 spec）。
 *
 * ══════════════════ 这个文件守四件事 ══════════════════
 * ① **静态串一字未动**：`index.html` 里那句仍是中文（中文用户不该丢失中文），
 *    且 `tests/i18n.spec.tsx` 的**行业中立化锁**（`跨行业项目排程工具`）继续成立；
 * ② **两边不漂**（可执行断言）：静态串与消息表 `meta.description` 的 **zh 取值逐字相同**
 *    —— 否则「启动时写回同一个串 ⇒ 中文态零变化」这句话就不成立；
 * ③ **真渲染**：`applyMetaDescription()` 真的把 `<meta content>` 写成消息表那句；
 *    `initMetaDescription()` 订阅语言 ⇒ `setLang('en')` 后 content 跟着变英文；
 * ④ **结构锁（防成环）**：`src/i18n/lang.ts` 不许 import `translate` / `meta`
 *    （`translate → lang` 是单向的，反向 import 会成环 —— 本仓为这个循环写过代价说明）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyMetaDescription, catalogOf, initMetaDescription, setLang, t } from '../src/i18n';
import { maskComments } from './helpers/cjk-locator-guard';

const rootDir = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(rootDir, p), 'utf8');

/** `index.html` 里 description 的 content（静态串；从源码文本里取，不靠运行时） */
function staticDescription(): string {
  const html = read('index.html');
  const m = /name="description"\s*\n?\s*content="([^"]*)"/.exec(html);
  if (m === null) throw new Error('index.html 里找不到 meta description');
  return m[1]!;
}

/** jsdom 里装一个 `<meta name="description">`（模拟 index.html 的那一个） */
function installMeta(content = '占位'): HTMLMetaElement {
  const el = document.createElement('meta');
  el.setAttribute('name', 'description');
  el.setAttribute('content', content);
  document.head.appendChild(el);
  return el;
}

beforeEach(() => {
  document.head.querySelectorAll('meta[name="description"]').forEach((e) => e.remove());
  setLang('zh');
});

afterEach(() => {
  document.head.querySelectorAll('meta[name="description"]').forEach((e) => e.remove());
  setLang('zh'); // 语言是模块级全局状态 ⇒ 复位
});

describe('① 静态串与消息表：一字不差（两边不漂的可执行断言）', () => {
  it('★ `index.html` 的 content === `catalogOf(\'zh\')[\'meta.description\']`', () => {
    expect(staticDescription()).toBe(catalogOf('zh')['meta.description']);
  });

  it('行业中立化锁的两个关键词仍在（本笔没碰静态串）', () => {
    const html = read('index.html');
    expect(html).toContain('跨行业项目排程工具');
    expect(staticDescription()).toContain('跨行业项目排程工具');
  });

  it('en 取值不是中文（防漏翻）', () => {
    expect(catalogOf('en')['meta.description']).not.toBe(catalogOf('zh')['meta.description']);
    expect(/[\u4e00-\u9fff]/.test(catalogOf('en')['meta.description']), '英文取值里不该有汉字').toBe(
      false,
    );
  });
});

describe('② 真渲染：按语言写 `<meta content>`', () => {
  it('zh：写回**同一个**串（启动零变化）', () => {
    const el = installMeta();
    applyMetaDescription();
    expect(el.getAttribute('content')).toBe(catalogOf('zh')['meta.description']);
    expect(el.getAttribute('content'), '中文态必须与静态串逐字相同').toBe(staticDescription());
  });

  it('en：切语言后 content 变英文，且不再含汉字', () => {
    const el = installMeta();
    setLang('en');
    applyMetaDescription();
    expect(el.getAttribute('content')).toBe(t('meta.description'));
    expect(/[\u4e00-\u9fff]/.test(el.getAttribute('content') ?? ''), '英文态不得残留汉字').toBe(
      false,
    );
  });

  it('★ `initMetaDescription()` 自己订阅语言变化（不必等刷新）', () => {
    const el = installMeta();
    initMetaDescription();
    expect(el.getAttribute('content')).toBe(catalogOf('zh')['meta.description']);
    setLang('en');
    expect(el.getAttribute('content'), '订阅没接上 ⇒ 切语言后 description 不会跟').toBe(
      catalogOf('en')['meta.description'],
    );
    setLang('zh');
    expect(el.getAttribute('content')).toBe(catalogOf('zh')['meta.description']);
  });

  it('找不到 meta（被剥离 / 非浏览器）⇒ 静默不动，不抛', () => {
    expect(() => applyMetaDescription()).not.toThrow();
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
  });
});

describe('③ 结构锁：防成环（`translate → lang` 是单向的）', () => {
  it('★ `src/i18n/lang.ts` 不许 import `translate` / `meta`', () => {
    const src = maskComments(read('src/i18n/lang.ts'));
    const specifiers = [...src.matchAll(/['"]\.\/([\w-]+)['"]/g)].map((m) => m[1]!);
    expect(specifiers, 'lang.ts 反向 import 了它会成环（代价见 translate.ts 文件头）').not.toContain(
      'translate',
    );
    expect(specifiers).not.toContain('meta');
  });

  it('`meta.ts` 只认 `lang` / `translate` 两个内部依赖（不许引渲染层）', () => {
    const src = maskComments(read('src/i18n/meta.ts'));
    const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
    expect(specifiers.sort()).toEqual(['./lang', './translate']);
  });
});
