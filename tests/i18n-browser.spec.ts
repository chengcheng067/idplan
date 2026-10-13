// @vitest-environment node
/**
 * 界面语言 · **英文几何常驻闸**（2026-10-13 · 语言切换批 2a）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么必须有这一条（它是一个「空过判据」的补丁）
 * ══════════════════════════════════════════════════════════════════════
 * `tests/settings-zones.spec.ts:508-510`（S-Z3）守的是「767px 档六个导航按钮
 * 同屏可见且不横滑」——但它的判据跑在**出厂中文**下（全量用例的默认语言）。
 * 中文那组（外观/排程/数据与备份/插件/行业与模板/关于）是宽的；英文那组
 * （Appearance / Scheduling / Data & Backup / Plugins / Industry & Templates /
 * About）才是**真正压线**的那组：实测中文按钮总宽 516，英文 707（×1.37）。
 *
 * ⇒ 没有这条 spec，今后任何人把某个英文标签改长一点，**没有任何测试会红**，
 *   而 S-Z3 仍然是绿的（它根本不看英文）。这正是「判据只在一次临时探针里跑过」
 *   的典型风险：风险已经量化了，但没被钉住。本文件把它钉住。
 *
 * ── 判据（与 S-Z3 同一量法，只是把语言换成 en）──
 *   ① `data-settings-zone` 恰好 6 个；
 *   ② 每个按钮完整落在导航容器视框内（`allVisible` ⇒ 不需要横滑就能点）；
 *   ③ 导航容器 `scrollWidth <= clientWidth`（不横滑）；
 *   ④ 六个标签就是英文那六个词（顺带证明语言真的切过去了，不是「量了个中文壳」）。
 *
 * ── 为什么不用 jsdom ──
 *   这是 flex 换行 + overflow-x-auto 的**事实**：jsdom 的 getBoundingClientRect
 *   恒 0、scrollWidth 恒 0，量不出「挤破」。只有真 Chromium 能验。
 *
 * ── 底座与陈旧产物守卫 ──
 *   与 S-Z3 同底座：`build-dist` + 静态服务 + 产物过期即整组 skip
 *   （拿旧产物报绿/报红都是假信号）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { resolve } from 'node:path';

import { CAN_RUN_FRESH, CHROMIUM_PATH, startStaticServer } from './helpers/board-env';

const HEAVY = 30000;

/** 桌面端 stub（自绘三键 + 更新探测），与 settings-zones.spec.ts 逐字同口径 */
const IDPLAN_STUB = `
window.__wcCalls = [];
window.idplan = {
  isDesktop: true,
  platform: 'win32',
  version: '0.0.0.0',
  windowControls: {
    minimize: function () { window.__wcCalls.push('minimize'); },
    toggleMaximize: function () { window.__wcCalls.push('toggleMaximize'); },
    close: function () { window.__wcCalls.push('close'); },
    isMaximized: function () { return Promise.resolve(false); },
    onMaximizeChange: function () { return function () {}; },
  },
  checkUpdate: function () {
    return Promise.resolve({ current: '0.0.0.0', latest: '0.0.0.0', hasUpdate: false,
      releaseUrl: null, publishedAt: null, notes: null, exeAssetUrl: null });
  },
  onUpdateAvailable: function () { return function () {}; },
};
`;

/** 英文六区（顺序即导航顺序；与 src/i18n/messages/en.ts 的 zone 键一一对应） */
const EN_ZONES = [
  'Appearance',
  'Scheduling',
  'Data & Backup',
  'Plugins',
  'Industry & Templates',
  'About',
] as const;

/** 中文六区（同一量法再量一遍，保证「两列都守住」而不是只守英文） */
const ZH_ZONES = ['外观', '排程', '数据与备份', '插件', '行业与模板', '关于'] as const;

describe.skipIf(!CAN_RUN_FRESH)('界面语言 · 英文 767 档六区导航几何（真 Chromium）', () => {
  let browser: Browser;
  let server: { url: string; close(): Promise<void> };
  let DIST_URL = '';

  beforeAll(async () => {
    server = await startStaticServer(resolve(__dirname, '..', 'build-dist'));
    DIST_URL = server.url;
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
  }, HEAVY);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  /**
   * 开一个 767×900 的英文环境。
   * `idplan-lang=en` 经 addInitScript 预置 ⇒ 应用**冷启动即英文**
   * （顺带覆盖「英文用户首屏」这条路径，不需要先点一次切换按钮）。
   *
   * ⚠️ 同时预置首启引导的「看过了」标记（`idplan.firstRunGuideSeen`，是组件自己的
   *   门控键）：引导卡是**模态**（z-70），不关掉会拦掉后面所有点击。用它自己的键
   *   而不是点「先四处看看」按钮，是为了**与语言无关**——那条按钮的文案刚被翻译，
   *   按文案定位会让本 spec 在两种语言下走两条不同的路。
   */
  async function openEnglish(): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ viewport: { width: 767, height: 900 } });
    await ctx.addInitScript(IDPLAN_STUB);
    await ctx.addInitScript(
      "try { localStorage.setItem('idplan-lang', 'en'); localStorage.setItem('idplan.firstRunGuideSeen', '1'); } catch (e) {}",
    );
    const page = await ctx.newPage();
    await page.goto(DIST_URL);
    await page.waitForSelector('header', { timeout: 20000 });
    await page.waitForTimeout(500);
    return { ctx, page };
  }

  /** 确立管理员身份（同 qa-batch-a-verify / settings-zones 口径；这一步的界面是中文） */
  async function becomeAdmin(page: Page): Promise<void> {
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => (x.textContent ?? '').trim() === '我是管理员',
      );
      b?.click();
    });
    await page.waitForTimeout(400);
    await page.locator('input[placeholder="你的姓名"]').fill('严过关');
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) =>
        (x.textContent ?? '').includes('确认为管理员'),
      );
      b?.click();
    });
    await page.waitForTimeout(1000);
    const guideSkip = page.locator('button', { hasText: '先四处看看' });
    if (await guideSkip.count()) {
      await guideSkip.first().click();
      await page.waitForTimeout(400);
    }
  }

  /** <md 走「⋮ 更多 → 设置」。按钮按 data 钩子定位（文案会随语言变，钩子不会）。 */
  async function openSettingsViaMoreMenu(page: Page): Promise<void> {
    await page.locator('[data-mobile-more-trigger]').first().click();
    await page.waitForTimeout(400);
    await page.locator('[role="menu"] [role="menuitem"]').last().click();
    await page.waitForTimeout(500);
    await page.waitForFunction(
      () => {
        const p = document.querySelector('[data-settings-drawer]') as HTMLElement | null;
        return !!p && p.getAnimations().every((a) => a.playState === 'finished');
      },
      undefined,
      { timeout: 8000 },
    );
  }

  /** 六区导航几何（与 settings-zones.spec.ts:495-510 同一量法） */
  async function navFits(page: Page) {
    return page.evaluate(() => {
      const drawer = document.querySelector('[data-settings-drawer]') as HTMLElement | null;
      const nav = drawer ? (drawer.querySelector('nav') as HTMLElement | null) : null;
      if (!nav) return null;
      const btns = Array.from(nav.querySelectorAll<HTMLElement>('[data-settings-zone]'));
      const nr = nav.getBoundingClientRect();
      return {
        count: btns.length,
        labels: btns.map((b) => b.innerText.trim()),
        widths: btns.map((b) => Math.round(b.getBoundingClientRect().width * 10) / 10),
        buttonTotal: Math.round(btns.reduce((a, b) => a + b.getBoundingClientRect().width, 0)),
        clientWidth: nav.clientWidth,
        scrollWidth: nav.scrollWidth,
        scrollable: nav.scrollWidth > nav.clientWidth + 1,
        allVisible: btns.every((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left >= nr.left - 1;
        }),
      };
    });
  }

  it(
    '★ 英文 767 档：六个导航按钮同屏完整可见、不横滑（改长英文标签必红）',
    async () => {
      const { ctx, page } = await openEnglish();
      try {
        // 冷启动即英文（预置 localStorage），这条本身就是语言生效的前提
        expect(await page.evaluate(() => document.documentElement.dataset.lang)).toBe('en');

        await becomeAdmin(page);
        await openSettingsViaMoreMenu(page);

        const en = await navFits(page);
        expect(en, '设置抽屉的导航容器应存在').not.toBeNull();

        // ① 六个 + 就是那六个英文词（顺带证明「量的是英文那一版」，不是中文壳）
        expect(en!.count, '六区分区数').toBe(6);
        expect(en!.labels).toEqual([...EN_ZONES]);

        // ② 不横滑（判据核心）
        expect(
          en!.scrollable,
          `英文 767 档出现横滑：按钮总宽 ${en!.buttonTotal} / 容器 ${en!.clientWidth}`,
        ).toBe(false);

        // ③ 每个按钮完整落进容器视框（「同屏可见可点」）
        expect(en!.allVisible, '767 档六个英文导航按钮应同屏完整可见').toBe(true);

        // ④ 中文那一列同一量法再量一遍（两列都守住，而不是只守压线的英文）
        await page.locator('[data-settings-zone="appearance"]').click();
        await page.waitForTimeout(300);
        await page.locator('[data-lang-option="zh"]').click();
        await page.waitForTimeout(400);
        const zh = await navFits(page);
        expect(zh!.labels).toEqual([...ZH_ZONES]);
        expect(zh!.count).toBe(6);
        expect(zh!.scrollable, '中文 767 档不应横滑（与 S-Z3 同判据，这里是同一量法的双保险）').toBe(
          false,
        );
        expect(zh!.allVisible).toBe(true);
      } finally {
        await ctx.close();
      }
    },
    90000,
  );
});
