import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { listenOnSafePort } from './helpers/safe-listen';
import { staleInputs } from './helpers/board-env';

/**
 * 手机档（<768）的 ⋮ 菜单里，**Agent 项真的受插件开关管吗** —— 真 Chromium + 真断点。
 *
 * ══════════════════ 这条补的是哪一半 ══════════════════
 * `tests/plugin-ui-gating.spec.tsx` 已经用 **jsdom** 锁住了「条件渲染逻辑」：
 * `MobileMoreMenu` 里 `{agentBoardOn && <Link to="/agent" …>}`。但 jsdom **不跑 CSS**，
 * 而那个组件的根节点是 `relative md:hidden`（注释明写「仅在 <768 渲染」）——
 * 也就是说 jsdom 那一层证明不了**断点可见性**，只能证明「渲染出来了」。
 * ⇒ 本 spec 用真浏览器在 **390 档**回答两件事：
 *    ① 这一档 ⋮ 触发器真的可见可得（不是被 CSS 藏起来的死代码）；
 *    ② 插件开关**在真机上**真的能把它拿掉 / 放回来。
 *
 * ══════════════════ 判据（离散，且与文案解耦）══════════════════
 *   · 用 `a[href="/agent"][role="menuitem"]` 定位 —— **不拿「Agent」这三个字当契约**
 *     （文案会走 i18n，英文版下按文字找必然失效）。
 *   · 三步链都要断：**启用 ⇒ 在** / **停用 ⇒ 不在** / **拨回 ⇒ 在**。
 *     只断「停用后不在」是半截判据：菜单整个坏掉、页面崩掉、触发器没点到，
 *     那一条**都会过**（假阴）。拨回那一步就是它的反面对照。
 *   · 另加一条**负对照**：同一次打开菜单里，「我的任务」那一项必须**始终在** ——
 *     它证明「少了一项」是**门控生效**，不是「菜单没打开 / 渲染坏了」。
 *
 * ══════════════════ 为什么必须真机 ══════════════════
 *   `md:hidden` 是 CSS 断点事实（jsdom 无概念）；且本用例要在设置里真拨开关再回看菜单，
 *   走的是「注册表 → 派生视图 → 消费点」整条链。
 */

const DIST_INDEX = resolve(__dirname, '..', 'build-dist', 'index.html');

function resolveChromium(): string | null {
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  const rels = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-linux64', 'chrome'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(root).filter((n) => n.startsWith('chromium-'));
    } catch {
      continue;
    }
    for (const dir of entries) {
      for (const rel of rels) {
        const exe = join(root, dir, ...rel);
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const CHROMIUM_PATH = resolveChromium();
const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null;

/*
 * 产物过期判定：**唯一出处** = `tests/helpers/board-env.ts` 的 `staleInputs()`
 * （它内部带 `warnStaleOnce`）。
 *
 * ⚠️ 本文件原先内联了一份语义相同、**但没有告警**的复制体 ⇒ 产物过期时它**静默 skip**。
 *    2026-10-13 那次「让跳过出声」只覆盖了 import 共享助手的文件；内联复制的那批漏了。
 *    ⇒ 改为 import。判据本身没变（候选集与 mtime 比法逐字核对过）。
 */
const STALE = CAN_RUN ? staleInputs() : [];
const CAN_RUN_FRESH = CAN_RUN && STALE.length === 0;

async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
  const http = require('node:http') as typeof import('node:http');
  const fs = require('node:fs') as typeof import('node:fs');
  const { join, extname } = require('node:path') as typeof import('node:path');
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  const server = http.createServer((req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = join(rootDir, raw);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      if (/\.(js|mjs|css|json|png|jpg|svg|ico|woff2?)$/.test(raw)) {
        res.writeHead(404).end('not found');
        return;
      }
      filePath = join(rootDir, 'index.html');
    }
    try {
      const body = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return listenOnSafePort(server);
}

/** 手机档 = <768（MobileMoreMenu 根节点 `md:hidden`）；用 390 与 settings-zones 的 S-Z2 同档 */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** ⋮ 菜单里的 Agent 项：按 href 定位，不拿文案当契约（文案走 i18n） */
const AGENT_ITEM = 'a[href="/agent"][role="menuitem"]';
/** 负对照项：宿主自己的「我的任务」，任何插件开关都不该影响它 */
const HOST_ITEM = 'a[href="/my-tasks"][role="menuitem"]';
const MORE_TRIGGER = '[data-mobile-more-trigger]';

describe.skipIf(!CAN_RUN_FRESH)('手机档 ⋮ 菜单 · Agent 项受插件开关管（真 Chromium · <768 断点）', () => {
  let browser: Browser;
  let server: { url: string; close(): Promise<void> };
  let DIST_URL = '';

  beforeAll(async () => {
    server = await startStaticServer(resolve(__dirname, '..', 'build-dist'));
    DIST_URL = server.url;
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function open390(): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await ctx.newPage();
    await page.goto(DIST_URL);
    await page.waitForSelector('header', { timeout: 20000 });
    await page.waitForTimeout(500);
    return { ctx, page };
  }

  /** 390 档确立管理员（插件开关是管理员门控的 —— 成员拨不动，前置必须先满足） */
  async function becomeAdmin(page: Page): Promise<void> {
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '我是管理员')?.click();
    });
    await page.waitForTimeout(400);
    await page.locator('input[placeholder="你的姓名"]').fill('严过关');
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('确认为管理员'))?.click();
    });
    await page.waitForTimeout(1000);
    const guideSkip = page.locator('button', { hasText: '先四处看看' });
    if (await guideSkip.count()) {
      await guideSkip.first().click();
      await page.waitForTimeout(500);
    }
  }

  /** 打开 ⋮ 菜单并读两项的存在性（读完 Esc 关掉，免得挡住下一次点击） */
  async function readMenu(page: Page): Promise<{ agent: number; host: number }> {
    await page.locator(MORE_TRIGGER).first().click();
    await page.waitForTimeout(400);
    const agent = await page.locator(AGENT_ITEM).count();
    const host = await page.locator(HOST_ITEM).count();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    return { agent, host };
  }

  /** 进设置 → 插件区，把 agent-board 拨到目标态 */
  async function setAgentBoard(page: Page, want: boolean): Promise<void> {
    await page.locator(MORE_TRIGGER).first().click();
    await page.waitForTimeout(400);
    await page.locator('[role="menu"] [role="menuitem"]', { hasText: '设置' }).first().click();
    await page.waitForTimeout(600);
    await page.locator('[data-settings-zone="plugins"]').click();
    await page.waitForTimeout(400);
    const toggle = page.locator('[data-plugin-toggle="agent-board"]');
    expect(await toggle.count(), '前提：插件区应有 agent-board 的开关').toBe(1);
    expect(
      await toggle.first().isDisabled(),
      '前提：本用例走的是管理员身份（开关是管理员门控的，成员拨不动）',
    ).toBe(false);
    const checked = (await toggle.first().getAttribute('aria-checked')) === 'true';
    if (checked !== want) {
      await toggle.first().click();
      await page.waitForTimeout(1000);
    }
    expect(
      (await toggle.first().getAttribute('aria-checked')) === 'true',
      `前提：agent-board 应已被拨到 ${want ? '启用' : '停用'}`,
    ).toBe(want);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }

  it('★ 启用 ⇒ ⋮ 里有 Agent 项；停用 ⇒ 没有；拨回 ⇒ 又有了（同一次菜单里「我的任务」始终在）', async () => {
    const { ctx, page } = await open390();
    try {
      await becomeAdmin(page);

      // ① 断点前提：390 档 ⋮ 触发器**真的可见可点**（否则本 spec 全在测空气）
      const trig = page.locator(MORE_TRIGGER);
      expect(await trig.count(), '<768 档应渲染 ⋮ 触发器').toBeGreaterThan(0);
      const box = await trig.first().boundingBox();
      expect(box, '⋮ 触发器在 390 档必须真的占位置（`md:hidden` 的反面）').not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);

      // ② agent-board 默认启用 ⇒ Agent 项在；宿主项「我的任务」也在（负对照基线）
      const before = await readMenu(page);
      expect(before.agent, 'agent-board 默认启用 ⇒ ⋮ 菜单里应有 Agent 项').toBe(1);
      expect(before.host, '负对照：宿主项「我的任务」应在').toBe(1);

      // ③ 停用 ⇒ Agent 项**不在**，而宿主项仍在（证明是门控生效，不是菜单坏了）
      await setAgentBoard(page, false);
      const off = await readMenu(page);
      expect(off.agent, 'agent-board 停用 ⇒ ⋮ 菜单里不得再有 Agent 项').toBe(0);
      expect(off.host, '★ 负对照：菜单本身必须还活着（否则上一条会把「菜单没打开」当成功）').toBe(1);

      // ④ 拨回启用 ⇒ 又有了（排除「关掉就再也回不来」这类半成品）
      await setAgentBoard(page, true);
      const back = await readMenu(page);
      expect(back.agent, '拨回启用 ⇒ Agent 项必须回到菜单里').toBe(1);
      expect(back.host).toBe(1);
    } finally {
      await ctx.close();
    }
  }, 90000);
});
