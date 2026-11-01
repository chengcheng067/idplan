// @vitest-environment jsdom
/**
 * 界面语言 · **默认跟随系统**（2026-10-31 产品负责人拍板新增）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 这条功能的一句话
 * ══════════════════════════════════════════════════════════════════════
 * 用户从没在 设置 › 外观 › 语言 里选过 ⇒ 界面语言**跟随系统语言**
 * （系统英文 ⇒ 界面英文）；一旦手动选过 ⇒ **永久以用户选择为准**，系统再变都不动。
 * 与主题的「用户显式 light/dark > prefers-color-scheme」逐条对齐。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★ 为什么这份 spec 必须自己重载模块（而不是直接 setLang 测）
 * ══════════════════════════════════════════════════════════════════════
 * 「跟随系统」是**模块加载期**决定的（`let lang = resolveLang()`）。
 * 直接 `setLang('zh')` 再断言，测的是「setLang 有没有生效」——那是**早已被
 * `i18n.spec.tsx` 覆盖的东西**，跟本功能无关，会形成一条**永远绿的空判据**。
 * ⇒ 每条用例都用 `vi.resetModules()` + 动态 `import()` 重新跑一次模块初始化，
 *   让 `resolveLang()` 真的被执行到（这正是「首次启动」的路径）。
 *
 * ★ 与 `tests/setup.ts` 的关系（本文件为何要自己改 navigator）
 * `setup.ts` 把本测试环境的系统语言**钉成了 zh-CN**（否则全量基线会从中文变英文）。
 * 本文件正是要测「系统语言是别的值时怎么办」，所以在**每个用例内**用
 * `defineProperty` 覆盖它——覆盖后记得还原（`afterEach`），别漏给同进程的下一个 spec。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const STORAGE_KEY = 'idplan-lang';

/** 把「系统语言」设成给定标签；`languages` 传 `undefined` 表示走单值降级分支 */
function setSystemLang(language: string, languages?: string[]): void {
  Object.defineProperty(navigator, 'language', { value: language, configurable: true });
  Object.defineProperty(navigator, 'languages', {
    value: languages,
    configurable: true,
  });
}

/**
 * 全新加载一次 `src/i18n/lang.ts`（模拟一次应用冷启动），返回其模块。
 * `vi.resetModules()` 保证模块级的 `let lang = resolveLang()` 重新求值。
 */
async function bootLang() {
  vi.resetModules();
  return import('../src/i18n/lang');
}

beforeEach(() => {
  localStorage.clear();
  // 默认每条用例都从「干净的英文系统、无任何显式选择」出发；
  // 需要别的场景的用例自己再调 setSystemLang()。
  setSystemLang('en-US');
});

afterEach(() => {
  // 还原成 setup.ts 钉的中文基线，别把英文系统漏给同进程的下一个 spec
  setSystemLang('zh-CN');
  localStorage.clear();
});

describe('① 无显式选择 ⇒ 跟随系统语言', () => {
  it('系统英文 ⇒ 首帧就是 en（不是先 zh 再纠正）', async () => {
    setSystemLang('en-US');
    const { getLang } = await bootLang();
    expect(getLang()).toBe('en');
  });

  it('系统中文 ⇒ zh', async () => {
    setSystemLang('zh-CN');
    const { getLang } = await bootLang();
    expect(getLang()).toBe('zh');
  });

  it('系统是日文等第三语言 ⇒ 回落出厂默认 zh（不猜、不空）', async () => {
    setSystemLang('ja-JP');
    const { DEFAULT_LANG, getLang } = await bootLang();
    expect(DEFAULT_LANG).toBe('zh');
    expect(getLang()).toBe('zh');
  });

  it('繁体中文也归 zh（本仓只有 zh/en 两档，不新开档）', async () => {
    setSystemLang('zh-TW');
    const { getLang } = await bootLang();
    expect(getLang()).toBe('zh');
  });

  it('navigator.languages 缺失时走 navigator.language 降级分支', async () => {
    setSystemLang('en-GB', undefined);
    const { getLang } = await bootLang();
    expect(getLang()).toBe('en');
  });

  it('languages 里首个不认识的项被跳过，取首个可解析项', async () => {
    // 多语言用户的真实形态：['de-DE', 'en-US', 'zh-CN'] ⇒ 应取 en，而不是凉在 de 上
    setSystemLang('de-DE', ['de-DE', 'en-US', 'zh-CN']);
    const { getLang } = await bootLang();
    expect(getLang()).toBe('en');
  });
});

describe('② 用户显式选择 > 系统语言（不可写反）', () => {
  it('显式选 zh + 系统英文 ⇒ 仍是 zh', async () => {
    setSystemLang('en-US');
    localStorage.setItem(STORAGE_KEY, 'zh');
    const { getLang } = await bootLang();
    expect(getLang()).toBe('zh');
  });

  it('显式选 en + 系统中文 ⇒ 仍是 en', async () => {
    setSystemLang('zh-CN');
    localStorage.setItem(STORAGE_KEY, 'en');
    const { getLang } = await bootLang();
    expect(getLang()).toBe('en');
  });

  it('localStorage 里是脏值 ⇒ 视同「没选过」，回落系统语言（不是回 zh）', async () => {
    setSystemLang('en-US');
    localStorage.setItem(STORAGE_KEY, 'klingon');
    const { getLang } = await bootLang();
    expect(getLang()).toBe('en');
  });
});

describe('③ 系统语言在运行期改变', () => {
  it('用户没选过 ⇒ 跟着变（languagechange 生效，不必重启）', async () => {
    setSystemLang('zh-CN');
    const mod = await bootLang();
    expect(mod.getLang()).toBe('zh');

    mod.initLang(); // 挂上 languagechange 监听（真机里由 main.tsx 调）

    setSystemLang('en-US');
    window.dispatchEvent(new Event('languagechange'));
    expect(mod.getLang()).toBe('en');
  });

  it('用户选过 ⇒ 系统再变也不动（选择被锁定）', async () => {
    setSystemLang('zh-CN');
    localStorage.setItem(STORAGE_KEY, 'zh');
    const mod = await bootLang();
    mod.initLang();
    expect(mod.getLang()).toBe('zh');

    setSystemLang('en-US');
    window.dispatchEvent(new Event('languagechange'));
    expect(mod.getLang(), '显式选择必须锁死，系统变化不该覆盖它').toBe('zh');
  });

  /**
   * ★ 这条是本功能**最危险的写歪方式**的守卫：
   * 若 languagechange 回调里调 `setLang(next)`，`setLang` 会写 localStorage ⇒
   * 用户从没点过语言按钮，却凭空产生「显式选择」⇒ 之后系统语言再变就不跟了（静默失效）。
   * 它不是「洁癖」，是**一条会在第二次切换时才暴露的隐性 bug**——所以单独钉一条。
   */
  it('跟随系统产生的值**不落库**（不许伪造出「用户显式选择」）', async () => {
    setSystemLang('zh-CN');
    const mod = await bootLang();
    mod.initLang();

    setSystemLang('en-US');
    window.dispatchEvent(new Event('languagechange'));
    expect(mod.getLang()).toBe('en');
    expect(
      localStorage.getItem(STORAGE_KEY),
      '跟随系统不是用户选择 ⇒ 不许写 idplan-lang，否则下次系统再变就不跟了',
    ).toBeNull();

    // 再变一次，证明它**仍然**在跟随（这才是「没落库」的真正后果）
    setSystemLang('zh-CN');
    window.dispatchEvent(new Event('languagechange'));
    expect(mod.getLang(), '第二次系统变化仍应跟随').toBe('zh');
  });
});

describe('④ 落 DOM（无障碍朗读与样式钩子）', () => {
  it('initLang 写 <html lang> 与 data-lang，英文系统下两者都是 en', async () => {
    setSystemLang('en-US');
    const mod = await bootLang();
    mod.initLang();
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dataset.lang).toBe('en');
  });

  it('中文系统的 <html lang> 用 zh-CN（与改造前逐字一致）', async () => {
    setSystemLang('zh-CN');
    const mod = await bootLang();
    mod.initLang();
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.documentElement.dataset.lang).toBe('zh');
  });
});
