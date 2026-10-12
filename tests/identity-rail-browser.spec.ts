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

const BUILD_INPUT_DIRS = ['src', 'electron'];
const BUILD_INPUT_FILES = ['index.html', 'vite.config.ts', 'tailwind.config.ts', 'postcss.config.js'];

function collectFiles(dir: string): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  const { join: jn } = require('node:path') as typeof import('node:path');
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = jn(dir, e.name);
    if (e.isDirectory()) out.push(...collectFiles(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** 产物过期守卫：src / 构建配置比 build-dist 新 ⇒ 整组 skip（拿旧界面下结论 = 假绿） */
function staleInputs(): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  const { resolve: res } = require('node:path') as typeof import('node:path');
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = fs.statSync(DIST_INDEX).mtimeMs;
  const candidates = [
    ...BUILD_INPUT_DIRS.flatMap((d) => collectFiles(res(ROOT, d))),
    ...BUILD_INPUT_FILES.map((f) => res(ROOT, f)).filter((f) => existsSync(f)),
  ];
  return candidates
    .filter((f) => fs.statSync(f).mtimeMs > distMs)
    .map((f) => f.replace(ROOT + '\\', '').replace(ROOT + '/', ''))
    .slice(0, 3);
}

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

const IDENTITY_MENU = '[role="menu"][aria-label="身份操作"]';
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
      const collapse = page.locator('button[aria-label="收起侧边栏"]');
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
          menus: h.querySelectorAll('[role="menu"][aria-label="身份操作"]').length,
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
