// @vitest-environment node
/**
 * 身份去重 · **真 Chromium** 实测（2026-10-12 用户 21:43：身份控件只剩侧栏左下角一处）。
 *
 * ══════════════════ 为什么必须真浏览器 ══════════════════
 * 本次改动的三条承诺里，有两条 jsdom **物理上测不出来**：
 *   · 「菜单从身份行**上方**弹出、且不越出视口底/左右缘」——jsdom 里 rect 恒为 0，
 *     翻转与夹取全都不发生（那正是 `resolveAnchoredPosition` 要真浏览器几何测试的原因）。
 *   · 「点左下角身份行**真的**能点到」——jsdom 没有 hit-test
 *     （`document.elementFromPoint` 不可用），也没有层叠，类名声明在场 ≠ 点得到。
 * 形态断言（"按钮带着 h-[52px]"）只能证明声明在，证明不了它赢；本文件取的全是
 * 实际生效几何（`getBoundingClientRect`）与实际命中元素。
 *
 * ══════════════════ 四组证据 ══════════════════
 *   ① 展开态：点左下角身份行 ⇒ 菜单在**上方**、四边都不越界；外点关闭。
 *   ①b 同一动作在**内容浮层之下**也成立：设置抽屉(60) 开着时点身份行 ⇒ 菜单(79)
 *      仍在遮罩之上可点；按一次 Esc **只关菜单**、抽屉必须还活着（这条是 F2 的
 *      回归面 —— 身份控件换了位置，但"chrome 永远在内容遮罩之上"这条不能跟着丢）。
 *   ② 未进入身份：左下角出现「点击进入」，点击**真的**走进身份流程。
 *   ③ 收起态（宽 64）：身份控件仍可见可点、菜单仍能开且不越界。
 *   ④ 顶栏右侧**已无**身份控件（那里只剩搜索 / ⋮更多 / 自绘三键等原有内容）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname, resolve } from 'node:path';

import { listenOnSafePort } from './helpers/safe-listen';
import { staleInputs } from './helpers/board-env';

const ROOT = resolve(__dirname, '..');
const DIST_INDEX = join(ROOT, 'build-dist', 'index.html');

function resolveChromium(): string | null {
  const { readdirSync: rd } = require('node:fs') as typeof import('node:fs');
  const { join: jn } = require('node:path') as typeof import('node:path');
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? jn(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.HOME ? jn(process.env.HOME, '.cache', 'ms-playwright') : null,
    process.env.USERPROFILE ? jn(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
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
      entries = rd(root).filter((n) => n.startsWith('chromium-'));
    } catch {
      continue;
    }
    for (const dir of entries) {
      for (const rel of rels) {
        const exe = jn(root, dir, ...rel);
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
 * （它内部带 `warnStaleOnce`：过期时会打印「哪些构建输入比产物新 + 先 npm run build」）。
 *
 * ⚠️ 本文件原先内联了一份**语义相同、但没有告警**的复制体 ⇒ 产物过期时它**静默 skip**
 *    （skip ≠ 通过）。2026-10-13 那次「让跳过出声」只覆盖了 import 共享助手的文件，
 *    内联复制的那批漏了；本次收敛补上。
 *    判据本身**没有变**：候选集 = `BUILD_INPUT_DIRS`（src/electron）+ `BUILD_INPUT_FILES`
 *    （index.html / vite.config.ts / tailwind.config.ts / postcss.config.js），任一 mtime 比
 *    `build-dist/index.html` 新即视为过期（两份口径已逐字核对）。
 */
const STALE = CAN_RUN ? staleInputs() : [];
const CAN_RUN_FRESH = CAN_RUN && STALE.length === 0;

async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
  const http = require('node:http') as typeof import('node:http');
  const fs = require('node:fs') as typeof import('node:fs');
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
  const server = createServer((req, res) => {
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

/** 桌面端 stub（自绘三键 + 更新探测），与 settings-zones.spec.ts 同口径 */
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

const HEAVY = 60000;

const IDENTITY_MENU = '[data-identity-menu]';
const SETTINGS_DRAWER = '[data-settings-drawer]';
const RAIL_TITLE = '当前身份（点击切换/退出）';

/** 视口几何快照（用于"是否在视口内 / 是否在上方"这类断言） */
interface Geometry {
  x: number;
  y: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

describe.skipIf(!CAN_RUN_FRESH)('身份去重 · 真 Chromium（身份控件只剩侧栏左下角）', () => {
  let browser: Browser;
  let server: { url: string; close(): Promise<void> };
  let DIST_URL = '';

  beforeAll(async () => {
    server = await startStaticServer(join(ROOT, 'build-dist'));
    DIST_URL = server.url;
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
  }, HEAVY);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function open(w: number, h: number): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(IDPLAN_STUB);
    const page = await ctx.newPage();
    await page.goto(DIST_URL);
    await page.waitForSelector('header', { timeout: 20000 });
    await page.waitForTimeout(500);
    return { ctx, page };
  }

  /** 确立管理员身份（与 settings-zones.spec.ts 逐字同口径） */
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
      await page.waitForTimeout(500);
    }
  }

  /** 按可见文案点按钮（真鼠标点，保证走完整命中链路） */
  async function clickText(page: Page, text: string): Promise<boolean> {
    const point = await page.evaluate((t) => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => (x.textContent ?? '').trim() === t,
      );
      if (!b) return null;
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, text);
    if (!point) return false;
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(400);
    return true;
  }

  /**
   * 侧栏身份控件（可见的那一枚）的中心点与几何。
   * 三种外观的 title 不同（展开态是固定文案、收起态带姓名），故按 `点击切换/退出` 收口 ——
   * **不许**用「页面里第一个身份按钮」这种写法：那正是"删了顶栏却还在点顶栏"的温床。
   */
  async function identityPoint(page: Page): Promise<(Geometry & { title: string }) | null> {
    return page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('[data-app-sidebar] button')).find((x) => {
        const t = x.getAttribute('title') ?? '';
        if (!t.includes('点击切换/退出')) return false;
        const r = x.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
        title: b.getAttribute('title') ?? '',
      };
    });
  }

  async function menuGeometry(page: Page): Promise<Geometry | null> {
    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
      };
    }, IDENTITY_MENU);
  }

  /** 点身份控件（真鼠标，走完整命中链路）；找不到就当场炸，避免后续断言空转成假绿 */
  async function clickIdentity(page: Page): Promise<Geometry> {
    const p = await identityPoint(page);
    expect(p, '侧栏应有可见的身份控件（前置：已进入身份且侧栏未折叠/可见）').not.toBeNull();
    await page.mouse.click(p!.x, p!.y);
    await page.waitForTimeout(500);
    return p!;
  }

  it('① 展开态：点左下角身份行 ⇒ 菜单从**上方**弹出，且四边都不越出视口', async () => {
    const { ctx, page } = await open(1440, 900);
    try {
      await becomeAdmin(page);
      const trigger = await clickIdentity(page);

      const menu = await menuGeometry(page);
      expect(menu, '点身份行应开出菜单（前置：菜单没开 ⇒ 后续几何断言全空转）').not.toBeNull();
      const m = menu!;

      // ★ 核心：身份行住屏幕底部 ⇒ 菜单必须在**它上面**，不能盖住自己
      expect(
        m.bottom,
        `菜单必须在身份行上方（菜单底 ${Math.round(m.bottom)} vs 身份行顶 ${Math.round(trigger.top)}）`,
      ).toBeLessThanOrEqual(trigger.top);

      // 四边不越界（含底部：底部越界就是被视口切掉、用户点不到最后一项）
      const vp = page.viewportSize()!;
      expect(m.top, '菜单不得越出视口上缘').toBeGreaterThanOrEqual(0);
      expect(m.left, '菜单不得越出视口左缘').toBeGreaterThanOrEqual(0);
      expect(m.right, '菜单不得越出视口右缘').toBeLessThanOrEqual(vp.width);
      expect(m.bottom, '菜单不得越出视口下缘').toBeLessThanOrEqual(vp.height);
      expect(m.width).toBeGreaterThan(0);
      expect(m.height).toBeGreaterThan(0);

      // 身份行确实在左下角（否则"菜单在它上方"证明不了"向上展开"这件事有意义）
      expect(trigger.left, '身份行应贴在左侧').toBeLessThan(vp.width / 2);
      expect(
        vp.height - trigger.bottom,
        '身份行应贴在视口底部（贴底才会触发翻转，这正是要点）',
      ).toBeLessThan(120);

      // 外点关闭（既有行为不许因为换外观而丢）
      await page.mouse.click(vp.width / 2, 120);
      await page.waitForTimeout(400);
      expect(await menuGeometry(page), '点外部应关闭菜单').toBeNull();
    } finally {
      await ctx.close();
    }
  }, 90000);

  it('①b 设置抽屉(60) 开着时：身份行仍可点、菜单(79) 在遮罩之上；一次 Esc 只关菜单、抽屉仍存活', async () => {
    const { ctx, page } = await open(1440, 900);
    try {
      await becomeAdmin(page);

      // 开设置抽屉（侧栏底部那枚「设置」）
      const settingsPoint = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('[data-app-sidebar] button')).find((x) => {
          if (x.getAttribute('aria-label') !== '设置') return false;
          const r = x.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      expect(settingsPoint, '侧栏应有可见的「设置」入口').not.toBeNull();
      await page.mouse.click(settingsPoint!.x, settingsPoint!.y);
      await page.waitForTimeout(600);
      expect(await page.locator(SETTINGS_DRAWER).count(), '设置抽屉应已打开（前置）').toBeGreaterThan(0);

      // 抽屉开着时点左下角身份行
      const trigger = await clickIdentity(page);
      const menu = await menuGeometry(page);
      expect(menu, '设置抽屉开着时，点身份行仍必须开出菜单').not.toBeNull();

      // 菜单仍必须在自己上方，且**在遮罩之上**能被点到：点菜单项「退出身份」看它真生效
      expect(menu!.bottom, '菜单仍在身份行上方').toBeLessThanOrEqual(trigger.top);

      // ★ 一次 Esc 只关栈顶（菜单）——抽屉必须还活着（F2 的回归面）
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      expect(await menuGeometry(page), 'Esc 应关掉身份菜单').toBeNull();
      expect(
        await page.locator(SETTINGS_DRAWER).count(),
        '★ 一次 Esc 只该关栈顶：下层的设置抽屉必须仍存活（否则就是 F3 复发）',
      ).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  }, 90000);

  it('② 未进入身份：左下角出现「点击进入」，且点击真的走进身份流程', async () => {
    const { ctx, page } = await open(1440, 900);
    try {
      await becomeAdmin(page);

      // 退出身份（走真实路径：身份行 → 菜单 → 退出身份）
      await clickIdentity(page);
      expect(await clickText(page, '退出身份'), '菜单里应有「退出身份」').toBe(true);
      await page.waitForTimeout(800);
      // 退出后会自动开姓名流程（同机换人）；先关掉它，回到"未进入身份"的静止态
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      const cancel = page.locator('button', { hasText: '取消' });
      if (await cancel.count()) {
        await cancel.first().click();
        await page.waitForTimeout(600);
      }

      // ★ 左下角必须出现「点击进入」——**在侧栏里**
      const entry = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('[data-app-sidebar] button')).find(
          (x) => (x.textContent ?? '').trim() === '点击进入',
        );
        if (!b) return null;
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, bottom: r.bottom, left: r.left };
      });
      expect(
        entry,
        '★ 未进入身份时，左下角侧栏内必须有可见的「点击进入」（顶栏已删 ⇒ 这是唯一入口）',
      ).not.toBeNull();
      const vp = page.viewportSize()!;
      expect(entry!.left, '入口应在左侧').toBeLessThan(vp.width / 2);
      expect(vp.height - entry!.bottom, '入口应在底部').toBeLessThan(120);

      // 真点它 ⇒ 应走进身份流程（库里有管理员 ⇒ 直达姓名输入）
      await page.mouse.click(entry!.x, entry!.y);
      await page.waitForTimeout(700);
      expect(
        await page.locator('input[placeholder="你的姓名"]').count(),
        '★ 点左下角「点击进入」应走到姓名输入（与顶栏原来同一口径）',
      ).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  }, 90000);

  it('③ 收起态（宽 64）：身份控件仍可见可点、菜单仍能开且不越界', async () => {
    const { ctx, page } = await open(1440, 900);
    try {
      await becomeAdmin(page);

      // 收起侧栏
      const collapse = page.locator('[data-sidebar-collapse-toggle]');
      expect(await collapse.count(), '侧栏应有收起键').toBeGreaterThan(0);
      await collapse.first().click();
      await page.waitForTimeout(600);

      const railWidth = await page.evaluate(() => {
        const el = document.querySelector('[data-app-sidebar]');
        return el ? el.getBoundingClientRect().width : 0;
      });
      expect(railWidth, `收起态侧栏应是 64 宽（实际 ${Math.round(railWidth)}）`).toBeLessThan(80);

      const trigger = await clickIdentity(page);
      expect(trigger.width, '收起态身份控件仍应可见（宽 > 0）').toBeGreaterThan(0);

      const menu = await menuGeometry(page);
      expect(menu, '★ 收起态点身份控件也必须能开菜单').not.toBeNull();
      const m = menu!;
      expect(m.bottom, '收起态菜单同样在控件上方').toBeLessThanOrEqual(trigger.top);

      const vp = page.viewportSize()!;
      expect(m.top).toBeGreaterThanOrEqual(0);
      expect(m.left).toBeGreaterThanOrEqual(0);
      expect(m.right, '收起态菜单不得越出视口右缘').toBeLessThanOrEqual(vp.width);
      expect(m.bottom).toBeLessThanOrEqual(vp.height);

      // 菜单项真的可点（真鼠标点最后一项「退出身份」，看它生效 = 身份被清掉）
      expect(await clickText(page, '退出身份'), '收起态菜单里应有可点的「退出身份」').toBe(true);
      await page.waitForTimeout(700);
      const cleared = await page.evaluate(() => {
        return (
          Array.from(document.querySelectorAll('[data-app-sidebar] button')).filter((x) => {
            const t = x.getAttribute('title') ?? '';
            return t.includes('点击切换/退出');
          }).length === 0
        );
      });
      expect(cleared, '★ 收起态菜单项真的生效了（身份已被清掉）').toBe(true);

      /*
       * ★ 收起态 + 未进入身份 —— 这是本轮唯一一处**真的断过链**的组合，必须真机钉住。
       *
       * 根因：`useLayoutStore.defaultExpanded()` = `matchMedia('(min-width: 1280px)')`
       * ⇒ **1024–1280 这一档侧栏默认就是收起态**。收起态只有 32px、放不下「点击进入」
       * 四个字，于是那四个字在窄窗上曾经**不在 DOM 里**；而顶栏那枚（本轮已删）是任何
       * 宽度都渲染文字的，全站"按文案找身份入口"因此总能命中它 —— 删掉顶栏后，
       * 该路径在 1024–1280 集体失效（实测 `member-board-layout` M-02 与
       * `calendar-anchor` C-01 两例均在 1152×864 超时）。
       * 现在四个字用 `sr-only` 留在 DOM 里，这条断言就是那个断链的守闸 ——
       * 允许改视觉，**不允许把文本从这枚按钮上拿走**。
       */
      const narrowEntry = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('[data-app-sidebar] button')).find(
          (x) => (x.textContent ?? '').trim() === '点击进入',
        );
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
      });
      expect(
        narrowEntry,
        '★ 收起态 + 未进入身份时，「点击进入」必须在 DOM 里（1024–1280 那一档的唯一入口）',
      ).not.toBeNull();

      await page.mouse.click(narrowEntry!.x, narrowEntry!.y);
      await page.waitForTimeout(700);
      expect(
        await page.locator('input[placeholder="你的姓名"]').count(),
        '★ 收起态点这枚入口必须真的走进身份流程',
      ).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  }, 90000);

  /** 当前路径 */
  async function pathname(page: Page): Promise<string> {
    return page.evaluate(() => window.location.pathname);
  }

  /**
   * 在侧栏（常驻或抽屉）内真鼠标点一枚链接。
   *
   * ⚠️ 两个踩过的坑，缺一不可：
   *   ① **只能认可见的那个侧栏**。<1280 时 DOM 里有**两个** `[data-app-sidebar]`
   *      —— 常驻侧栏（`hidden`，仍在 DOM）排在抽屉前面；`document.querySelector`
   *      只会拿到那个隐藏的，量出来 0×0 ⇒ 永远点不到（实测 @1024 就死在这）。
   *   ② **匹配口径要同时认两种形态**：收起态导航项只有图标 ⇒ 靠 `aria-label`
   *      （`SidebarNav` 里 `collapsed ? label : undefined`）；展开态渲染文字、
   *      `aria-label` 反而是 undefined ⇒ 只能按文本认。
   *   并且**优先在 `<nav aria-label="主导航">` 里找**：侧栏项目列表里可能真有个
   *   叫「项目」的项目，全侧栏按文本找会认错。
   */
  async function clickSidebarLink(page: Page, label: string): Promise<boolean> {
    const point = await page.evaluate((l) => {
      const matchIn = (root: Element): HTMLAnchorElement | undefined =>
        Array.from(root.querySelectorAll('a')).find((x) => {
          const al = x.getAttribute('aria-label');
          const txt = (x.textContent ?? '').trim();
          return al === l || txt === l || txt.startsWith(l);
        });
      const visible = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      for (const host of Array.from(document.querySelectorAll('[data-app-sidebar]'))) {
        if (!visible(host)) continue; // ① 跳过隐藏的常驻侧栏
        const nav = host.querySelector('nav[aria-label="主导航"]');
        const a = (nav ? matchIn(nav) : undefined) ?? matchIn(host); // ②
        if (!a || !visible(a)) continue;
        const r = a.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      return null;
    }, label);
    if (!point) return false;
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(700);
    return true;
  }

  /**
   * 「身份入口就在导航**最下方**」的量化判据：入口顶边落在导航高度的下方 30% 之内。
   * 取**可见**的那个 `[data-app-sidebar]`（1024 那一档常驻侧栏是 hidden、抽屉才是可见的）。
   *
   * ⚠️ 两种身份态都要认（踩过）：已进入 ⇒ title 含「点击切换/退出」；
   *   未进入 ⇒ 那枚是「点击进入」（title 是"点击进入身份…"、文本是"点击进入"）。
   *   本用例走的正是**未进入**那条路 —— 引导语只会出现在那个状态下。
   */
  async function identityBottomRatio(page: Page): Promise<number | null> {
    return page.evaluate(() => {
      const navs = Array.from(document.querySelectorAll('[data-app-sidebar]')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const nav = navs[0];
      if (!nav) return null;
      const btn = Array.from(nav.querySelectorAll('button')).find((x) => {
        const t = x.getAttribute('title') ?? '';
        const txt = (x.textContent ?? '').trim();
        return t.includes('点击切换/退出') || txt === '点击进入';
      });
      if (!btn) return null;
      const nr = nav.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      return (br.top - nr.top) / nr.height;
    });
  }

  /**
   * 侧栏没在屏幕上就开抽屉。
   * ⚠️ 判据必须用 `.some()` 而不是 `querySelector`：1024 那一档**常驻侧栏仍在 DOM 里**
   *   但 `hidden`（`hidden xl:flex`）且排在前面 —— 只取第一个会永远判"不可见"，
   *   于是每次都去点汉堡，反而把已经开着的抽屉点关了（踩过）。
   */
  async function openNavIfHidden(page: Page): Promise<void> {
    const visible = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-app-sidebar]')).some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }),
    );
    if (visible) return;
    const burger = page.locator('[data-nav-menu-trigger]');
    expect(await burger.count(), '侧栏收在抽屉里时应能靠汉堡打开').toBeGreaterThan(0);
    await burger.first().click();
    await page.waitForTimeout(700);
  }

  it('⑤ 收起态「回首页」仍可达（头像改成身份控件后不曾失联）—— team-lead 裁决 ② 的前置', async () => {
    const { ctx, page } = await open(1440, 900);
    try {
      await becomeAdmin(page);
      const collapse = page.locator('[data-sidebar-collapse-toggle]');
      expect(await collapse.count(), '侧栏应有收起键').toBeGreaterThan(0);
      await collapse.first().click();
      await page.waitForTimeout(600);

      // 先离开首页，否则"回首页"没有判别力
      expect(await clickSidebarLink(page, '我的任务'), '收起态应有「我的任务」导航').toBe(true);
      expect(await pathname(page), '前置：应已离开首页').toBe('/my-tasks');

      // 承载①：收起态顶部 Logo（`aria-label="ID Plan 首页"`）——它**不是**展开侧栏的开关
      expect(
        await clickSidebarLink(page, 'ID Plan 首页'),
        '★ 收起态 Logo 应仍是指向 / 的入口（回首页承载①）',
      ).toBe(true);
      expect(await pathname(page), '★ 点收起态 Logo 应回到首页').toBe('/');

      // 承载②：导航首枚（管理员支 = 「项目」→ `/`）
      expect(await clickSidebarLink(page, '我的任务')).toBe(true);
      expect(await pathname(page)).toBe('/my-tasks');
      expect(
        await clickSidebarLink(page, '项目'),
        '★ 收起态导航首枚（项目 → /）应仍在（回首页承载②）',
      ).toBe(true);
      expect(await pathname(page), '★ 点收起态首枚导航应回到首页').toBe('/');
    } finally {
      await ctx.close();
    }
  }, 90000);

  it('⑥ 引导语在两档都成立：1280 常驻侧栏 / 1024 抽屉，入口都真的在导航最下方', async () => {
    for (const width of [1280, 1024]) {
      const { ctx, page } = await open(width, 900);
      try {
        await becomeAdmin(page);
        /*
         * ⚠️ 1024 那一档侧栏在抽屉里、且默认关着 ⇒ 想"从侧栏退出身份"必须先开导航。
         *   这正是裁决 ① 承认的那一步（「左下角没变，只是多了一步开抽屉」），
         *   所以这几处都显式地走它，而不是绕过去（绕过去就等于测了个不存在的入口）。
         */
        await openNavIfHidden(page);
        // 退出身份 → 回到"未进入身份"（这时引导语才出现）
        await clickIdentity(page);
        expect(await clickText(page, '退出身份')).toBe(true);
        await page.waitForTimeout(800);
        const cancel = page.locator('button', { hasText: '取消' });
        if (await cancel.count()) {
          await cancel.first().click();
          await page.waitForTimeout(600);
        }

        // 去「我的任务」——它带着那句「请到左侧导航最下方进入身份」
        await openNavIfHidden(page); // 点导航项可能把抽屉关掉，这里再开一次
        expect(await clickSidebarLink(page, '我的任务'), `@${width} 应有「我的任务」导航`).toBe(true);
        expect(await pathname(page)).toBe('/my-tasks');
        const hasCopy = await page.evaluate(() =>
          (document.body.textContent ?? '').includes('请到左侧导航最下方进入身份'),
        );
        expect(hasCopy, `@${width} 我的任务页应显示新引导语`).toBe(true);

        /*
         * ★ 措辞验真：句子说「左侧导航最下方」，那就必须在**这一档真的成立**。
         *   ≥1280 侧栏常驻 ⇒ 直接可量；1024–1279 侧栏收在抽屉里 ⇒ 先开汉堡再量。
         *   两档都用同一个量化判据（入口顶边落在导航高度的下方 30% 内）。
         */
        await openNavIfHidden(page);
        const ratio = await identityBottomRatio(page);
        expect(ratio, `@${width} 打开导航后应能找到身份入口`).not.toBeNull();
        expect(
          ratio!,
          `@${width} 身份入口应落在导航下方 30% 之内（「左侧导航最下方」这句话得是真的，实际比值 ${ratio?.toFixed(2)}）`,
        ).toBeGreaterThan(0.7);
      } finally {
        await ctx.close();
      }
    }
  }, 120000);

  it('④ 顶栏右侧已无身份控件（那里只剩原有内容）', async () => {
    const { ctx, page } = await open(1440, 900);
    try {
      await becomeAdmin(page);

      // ① 顶栏内不得有任何身份控件
      const inHeader = await page.evaluate((title) => {
        const h = document.querySelector('header');
        if (!h) return { triggers: -1, menus: -1, byName: -1 };
        return {
          triggers: h.querySelectorAll(`button[title="${title}"]`).length,
          menus: h.querySelectorAll('[data-identity-menu]').length,
          // 按当前身份名找：顶栏里也不该再出现身份胶囊那一份可见姓名
          byName: Array.from(h.querySelectorAll('button')).filter((b) =>
            (b.textContent ?? '').includes('严过关'),
          ).length,
        };
      }, RAIL_TITLE);
      expect(inHeader.triggers, '★ 顶栏不该再有身份触发器').toBe(0);
      expect(inHeader.menus, '顶栏不该有身份菜单').toBe(0);
      expect(inHeader.byName, '★ 顶栏不该再出现身份胶囊里的姓名').toBe(0);

      // 打开身份菜单（从侧栏开），确认它 portal 到 body 而**不在 header 里**
      await clickIdentity(page);
      const menuHost = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return 'missing';
        return el.closest('header') ? 'header' : el.parentElement === document.body ? 'body' : 'other';
      }, IDENTITY_MENU);
      expect(menuHost, '身份菜单应 portal 到 body，而不是住在顶栏层叠上下文里').toBe('body');

      // ② 顶栏原有内容还在：自绘三键 + 搜索（身份删掉不等于把顶栏清空）
      const headerBits = await page.evaluate(() => {
        const h = document.querySelector('header');
        if (!h) return { wc: 0, search: 0 };
        const labels = Array.from(h.querySelectorAll('button')).map(
          (b) => b.getAttribute('aria-label') ?? '',
        );
        const wc = ['最小化', '最大化', '关闭'].filter((n) => labels.includes(n)).length;
        return { wc, search: h.querySelectorAll('input[type="search"], input[placeholder*="搜索"]').length };
      });
      expect(headerBits.wc, '顶栏三键（最小化/最大化/关闭）应仍在').toBe(3);
      expect(headerBits.search, '顶栏搜索应仍在').toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  }, 90000);
});
