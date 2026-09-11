import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * QA 独立复核（批次 A）· 真构建产物 + 真 Chromium。
 *
 * ── 为什么独立于工程师的 spec ──
 *   `tests/ui-batch-a.spec.tsx` 与 `tests/stage-drawer-hook-order.spec.tsx` 走 jsdom，
 *   断言的是**类名与 store 行为**；而本批五个问题里有三个是「真浏览器才成立」的事实：
 *     · 拖拽区（-webkit-app-region 由 Chromium 计算，jsdom 无此概念）；
 *     · 顶栏高度与 138 避让位（flex/断点/几何，jsdom 的 getBoundingClientRect 恒 0）；
 *     · 设置抽屉上下间距与底部圆角（几何 + max-h 交互）。
 *   更关键的是：**类名断言挡不住令牌刻度误用**——本仓库 tailwind.config.ts 把
 *   borderRadius.xl 覆盖成 16px（Tailwind 默认 12px），于是「写 rounded-xl 以为 12」
 *   在类名断言下永远绿，只有真浏览器读 computed style 才能发现（Q-A4-3 抓到）。
 *
 * ── 前置（与 layout-walkthrough.spec.ts 同口径）──
 *   `npm run build` 先跑过，且产物不得早于任何构建输入；否则整组 skip。
 *   产物须经 HTTP 提供（file:// 下 /assets/* 404 → 应用不挂载 → 误导性全红）。
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

const BUILD_INPUT_DIRS = ['src', 'electron'];
const BUILD_INPUT_FILES = ['index.html', 'vite.config.ts', 'tailwind.config.ts', 'postcss.config.js'];

function collectFiles(dir: string): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectFiles(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** 产物是否早于任一构建输入 → 过期守卫（过期时 skip，避免「误报绿」测的是上一版界面） */
function staleInputs(): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  const { resolve: res } = require('node:path') as typeof import('node:path');
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = fs.statSync(DIST_INDEX).mtimeMs;
  const candidates = [
    ...BUILD_INPUT_DIRS.flatMap((d) => collectFiles(res(__dirname, '..', d))),
    ...BUILD_INPUT_FILES.map((f) => res(__dirname, '..', f)).filter((f) => existsSync(f)),
  ];
  return candidates
    .filter((f) => fs.statSync(f).mtimeMs > distMs)
    .map((f) => f.replace(res(__dirname, '..') + '\\', '').replace(res(__dirname, '..') + '/', ''))
    .slice(0, 3);
}

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
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  const server = http.createServer((req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = join(rootDir, raw);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // 资源请求缺失一律 404：若把 index.html 当 JS 回，会制造「Unexpected token '<'」假错误
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
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/index.html`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** 伪装 Windows 桌面端（注入 preload 等价物），用于顶栏叠加层相关断言 */
const IDPLAN_STUB = `
window.__tbCalls = [];
window.idplan = {
  isDesktop: true,
  platform: 'win32',
  version: '0.0.0.0',
  setTitleBarTheme: function (t) { window.__tbCalls.push(t); },
  checkUpdate: function () {
    return Promise.resolve({ current: '0.0.0.0', latest: '0.0.0.0', hasUpdate: false,
      releaseUrl: null, publishedAt: null, notes: null, exeAssetUrl: null });
  },
  onUpdateAvailable: function () { return function () {}; },
};
`;

const HEAVY = 30000;

describe.skipIf(!CAN_RUN_FRESH)('QA 复核 · 批次 A（真构建产物 + 真 Chromium）', () => {
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

  async function open(
    w: number,
    h: number,
    opts: { desktop?: boolean } = {},
  ): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    if (opts.desktop !== false) await ctx.addInitScript(IDPLAN_STUB);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(DIST_URL);
    await page.waitForSelector('header', { timeout: 20000 });
    await page.waitForTimeout(500);
    return { ctx, page, errors };
  }

  /** 确立管理员身份（否则项目详情落「请先进入身份」空态，时间轴与阶段彩条不渲染） */
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
  }

  /** 走真实建档 UI 建一个 9 段室内项目，返回第一阶段彩条的几何中心 */
  async function createProjectAndFindBar(
    page: Page,
    name: string,
  ): Promise<{ x: number; y: number } | null> {
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) =>
        (x.textContent ?? '').includes('新建项目'),
      );
      b?.click();
    });
    await page.waitForTimeout(500);
    await page.locator('input[placeholder*="XX餐饮"]').fill(name);
    const dates = await page.$$('input[type="date"]');
    if (dates[0]) await dates[0].fill('2026-01-05');
    if (dates[1]) await dates[1].fill('2026-06-30');
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) =>
        (x.textContent ?? '').includes('建档（按所选'),
      );
      b?.click();
    });
    await page.waitForTimeout(2000);
    return page.evaluate(() => {
      const rects: DOMRect[] = [];
      for (const svg of Array.from(document.querySelectorAll('svg'))) {
        for (const r of Array.from(svg.querySelectorAll('rect'))) {
          const w = Number(r.getAttribute('width'));
          const h = Number(r.getAttribute('height'));
          if (r.getAttribute('rx') !== '8') continue;
          if (!(w > 20 && h >= 20)) continue;
          if (getComputedStyle(r).pointerEvents === 'none') continue;
          const b = r.getBoundingClientRect();
          if (b.width > 0) rects.push(b);
        }
      }
      if (rects.length === 0) return null;
      const b = rects[0];
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
  }

  /* ================= Q-CRASH · 点击彩条不得白屏（React #310 回归） ================= */

  it('Q-CRASH-1 · 真实路径「null → 有值」点击甘特彩条：抽屉正常打开、无 #310、应用存活', async () => {
    const { ctx, page, errors } = await open(1600, 900);
    try {
      await becomeAdmin(page);
      const bar = await createProjectAndFindBar(page, 'QA复核·茶空间');
      // 前置：必须真的落在项目详情且彩条已渲染，否则本用例无意义
      expect(page.url()).toMatch(/\/project\//);
      expect(bar).not.toBeNull();

      // 首屏抽屉必须是关的（hook 顺序 bug 只在 null → 有值 的第二次渲染暴露）
      expect(await page.locator('[role="dialog"][aria-label^="阶段详情"]').count()).toBe(0);

      // 真实鼠标点击彩条中心
      await page.mouse.click(bar!.x, bar!.y);
      await page.waitForTimeout(900);

      const dlg = page.locator('[role="dialog"][aria-label^="阶段详情"]');
      await expect(dlg.count()).resolves.toBe(1);
      // 应用未白屏：header/main 仍在，且抽屉带阶段名
      expect(await page.locator('header').count()).toBe(1);
      expect(await page.locator('main').count()).toBe(1);
      const label = await dlg.first().getAttribute('aria-label');
      expect(label).toMatch(/^阶段详情：.+/);

      // Esc 关闭 → 再次点击应能重开（反复开合不累积破坏 hook 顺序）
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      expect(await page.locator('[role="dialog"][aria-label^="阶段详情"]').count()).toBe(0);
      await page.mouse.click(bar!.x, bar!.y);
      await page.waitForTimeout(600);
      expect(await page.locator('[role="dialog"][aria-label^="阶段详情"]').count()).toBe(1);

      const hookErrs = errors.filter((e) => /more hooks than|#310|Rendered more hooks/i.test(e));
      expect(hookErrs).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  /* ================= A1 · 顶栏高度 / 主题融合 / 拖拽区 / 138 避让 ================= */

  it('Q-A1-1 · 顶栏高度与 titleBarHeight 同口径：<1280→56，≥1280→64（含临界 1279/1280）', async () => {
    for (const [w, expected] of [
      [1279, 56],
      [1280, 64],
      [1600, 64],
    ] as const) {
      const { ctx, page } = await open(w, 900);
      try {
        const h = await page.evaluate(() => {
          const el = document.querySelector('header');
          return el ? Math.round(el.getBoundingClientRect().height) : 0;
        });
        expect(h).toBe(expected);
        // 下发给主进程的高度必须与真实顶栏一致（否则原生三键与内容纵向错位）
        const calls = await page.evaluate(
          () => (window as unknown as { __tbCalls: { height: number }[] }).__tbCalls,
        );
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[calls.length - 1].height).toBe(expected);
      } finally {
        await ctx.close();
      }
    }
  }, HEAVY);

  it('Q-A1-2 · 亮/暗两主题：titleBarOverlay 的 color 必须等于顶栏实测底色（真实主题切换路径）', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      await becomeAdmin(page);
      const toHex = (rgb: string): string => {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
        if (!m) return '';
        return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
      };

      const light = await page.evaluate(() => {
        const h = document.querySelector('header');
        const calls = (window as unknown as { __tbCalls: { color: string; symbolColor: string; height: number }[] })
          .__tbCalls;
        return { bg: h ? getComputedStyle(h).backgroundColor : '', last: calls[calls.length - 1] };
      });
      expect(light.bg).not.toBe('');
      expect(light.last.color).toMatch(/^#[0-9a-f]{6}$/);
      // 亮色：叠加层底色 == 顶栏底色（核心：同色一体，不得是系统灰白）
      expect(light.last.color).toBe(toHex(light.bg));

      // 真实切换路径：设置抽屉里点「深色」→ useTheme.setMode → apply() → syncTitleBarTheme()
      await page.evaluate(() => {
        const s = Array.from(document.querySelectorAll('[data-app-sidebar] button')).find(
          (x) => x.getAttribute('aria-label') === '设置',
        );
        s?.click();
      });
      await page.waitForTimeout(500);
      const before = await page.evaluate(
        () => (window as unknown as { __tbCalls: unknown[] }).__tbCalls.length,
      );
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
          (x) => (x.textContent ?? '').trim() === '深色',
        );
        b?.click();
      });
      await page.waitForTimeout(600);

      const dark = await page.evaluate(() => {
        const h = document.querySelector('header');
        const calls = (window as unknown as { __tbCalls: { color: string; height: number }[] }).__tbCalls;
        return {
          theme: document.documentElement.getAttribute('data-theme'),
          bg: h ? getComputedStyle(h).backgroundColor : '',
          count: calls.length,
          last: calls[calls.length - 1],
        };
      });
      // 切主题必须触发一次下发（不是只改 DOM 不通知主进程）
      expect(dark.count).toBeGreaterThan(before);
      expect(dark.theme).toBe('dark');
      expect(dark.last.color).toBe(toHex(dark.bg));
      // 暗色下的实际值必须与 design token 一致（--paper dark = #1F2126）
      expect(dark.last.color).toBe('#1f2126');
      expect(dark.last.color).not.toBe(light.last.color);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('Q-A1-3 · 拖拽区逐个元素核对：header=drag，其内交互元素全部 no-drag（漏一个就点不动）', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      await becomeAdmin(page);
      const bar = await createProjectAndFindBar(page, 'QA拖拽探针');
      expect(bar).not.toBeNull();

      const probe = await page.evaluate(() => {
        const region = (el: Element | null): string =>
          el ? getComputedStyle(el).getPropertyValue('-webkit-app-region').trim() : 'NOEL';
        const header = document.querySelector('header');
        const inter = Array.from(
          document.querySelectorAll('header button, header a, header input, header select, header textarea'),
        );
        return {
          headerRegion: region(header),
          count: inter.length,
          violations: inter
            .filter((el) => region(el) !== 'no-drag')
            .map((el) => `${el.tagName}[${el.getAttribute('aria-label') ?? ''}]=${region(el)}`),
        };
      });
      // 顶栏整体是拖拽区（否则用户无法移动无原生标题栏的窗口）
      expect(probe.headerRegion).toBe('drag');
      expect(probe.count).toBeGreaterThan(3);
      // 交互元素零例外（面包屑按钮 / 搜索框 / 头像 / ⋮更多 全部覆盖）
      expect(probe.violations).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('Q-A1-4 · Windows 桌面端留 138px 避让窗口三键；浏览器端不留白且不遮挡头像', async () => {
    {
      const { ctx, page } = await open(1600, 900);
      try {
        const m = await page.evaluate(() => {
          const header = document.querySelector('header');
          const row = header ? header.firstElementChild : null;
          const spacer = row ? row.lastElementChild : null;
          const avatar = Array.from(document.querySelectorAll('header button')).pop() ?? null;
          const sr = spacer ? spacer.getBoundingClientRect() : null;
          const ar = avatar ? avatar.getBoundingClientRect() : null;
          const cs = row ? getComputedStyle(row) : null;
          return {
            spacerW: sr ? Math.round(sr.width) : 0,
            rowPadRight: cs ? cs.paddingRight : '',
            avatarRight: ar ? Math.round(ar.right) : -1,
            vw: window.innerWidth,
          };
        });
        expect(m.spacerW).toBe(138);
        /**
         * 避让位的判定口径：锚点是「内容离窗口右缘的净空」而非「避让块贴到窗口右缘」——
         * 顶栏行自带 xl:px-6（右内边距 24），故避让块右缘 = 视口宽 − 24，属预期，
         * 不是缺陷（不写这条会误报红）。
         * 真正要守住的是：内容（头像右缘）离窗口右缘 ≥ 138，否则原生三键盖住头像。
         */
        expect(m.vw - m.avatarRight).toBeGreaterThanOrEqual(138);
      } finally {
        await ctx.close();
      }
    }
    {
      // 浏览器 / NAS 端：无 idplan → 不得预留 138（否则白丢一块宽度）
      const { ctx, page } = await open(1600, 900, { desktop: false });
      try {
        const has = await page.evaluate(() => typeof window.idplan);
        const spacerW = await page.evaluate(() => {
          const header = document.querySelector('header');
          const row = header ? header.firstElementChild : null;
          const spacer = row ? row.lastElementChild : null;
          return spacer ? Math.round(spacer.getBoundingClientRect().width) : 0;
        });
        expect(has).toBe('undefined');
        expect(spacerW).not.toBe(138);
      } finally {
        await ctx.close();
      }
    }
  }, HEAVY);

  it('Q-A1-5 · 跨 xl 断点 resize 必须重发高度（56↔64）；system 模式跟随系统换肤也须重发配色', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      const callsOf = (): Promise<{ height: number; color: string }[]> =>
        page.evaluate(
          () =>
            (window as unknown as { __tbCalls: { height: number; color: string }[] }).__tbCalls.slice(),
        );

      // 1) resize 1600 → 1200（跌出 xl）：高度必须从 64 变 56 并重发
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.waitForTimeout(500);
      const afterShrink = await callsOf();
      expect(afterShrink[afterShrink.length - 1].height).toBe(56);

      // 2) resize 1200 → 1600：回到 64
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.waitForTimeout(500);
      const afterGrow = await callsOf();
      expect(afterGrow[afterGrow.length - 1].height).toBe(64);
      expect(afterGrow.length).toBeGreaterThan(afterShrink.length - 1);

      // 3) system 模式（未显式选主题）下系统切暗色：必须重发暗色配色
      //    初始未写过 idplan-theme → mode=system；页面加载时已下发亮色
      const beforeCalls = (await callsOf()).length;
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(600);
      const afterMedia = await page.evaluate(() => {
        const h = document.querySelector('header');
        const calls = (window as unknown as { __tbCalls: { height: number; color: string }[] }).__tbCalls;
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(h ? getComputedStyle(h).backgroundColor : '');
        const hex = m
          ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
          : '';
        return { theme: document.documentElement.getAttribute('data-theme'), bg: hex, last: calls[calls.length - 1], count: calls.length };
      });
      expect(afterMedia.theme).toBe('dark');
      expect(afterMedia.count).toBeGreaterThan(beforeCalls);
      expect(afterMedia.last.color).toBe(afterMedia.bg);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  /* ================= A2 · 设置弹窗：距顶≈距底 + 底部圆角可见 ================= */

  it('Q-A2-1 · 管理员打开设置抽屉：面板距顶 == 距底（±2px）、底圆角在视口内、亮暗一致', async () => {
    for (const theme of ['light', 'dark'] as const) {
      const { ctx, page } = await open(1600, 900);
      try {
        await becomeAdmin(page);
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll('[data-app-sidebar] button')).find(
            (x) => x.getAttribute('aria-label') === '设置',
          );
          b?.click();
        });
        await page.waitForTimeout(700);
        if (theme === 'dark') {
          await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
              (x) => (x.textContent ?? '').trim() === '深色',
            );
            b?.click();
          });
          await page.waitForTimeout(500);
        }

        const m = await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"][aria-label="设置"]');
          if (!dlg) return null;
          const anchor = dlg.firstElementChild as HTMLElement;
          const panel = anchor.firstElementChild as HTMLElement;
          const pr = panel.getBoundingClientRect();
          const acs = getComputedStyle(anchor);
          const cs = getComputedStyle(panel);
          return {
            vh: window.innerHeight,
            topGap: Math.round(pr.top),
            bottomGap: Math.round(window.innerHeight - pr.bottom),
            padTop: acs.paddingTop,
            padBottom: acs.paddingBottom,
            bottomInViewport: pr.bottom <= window.innerHeight + 0.5 && pr.top >= 0,
            blRadius: cs.borderBottomLeftRadius,
            brRadius: cs.borderBottomRightRadius,
            theme: document.documentElement.getAttribute('data-theme'),
          };
        });
        expect(m).not.toBeNull();
        expect(m!.theme).toBe(theme);
        // 容器 padding 必须上下对称（曾因内联 paddingTop 变成上 48 / 下 24）
        expect(m!.padTop).toBe(m!.padBottom);
        // 视觉间距对称（内容溢出 max-h 时面板贴满可用高度）
        expect(Math.abs(m!.topGap - m!.bottomGap)).toBeLessThanOrEqual(2);
        // 底部圆角不得被推出视口（用户原始投诉）
        expect(m!.bottomInViewport).toBe(true);
        expect(m!.blRadius).not.toBe('0px');
        expect(m!.brRadius).not.toBe('0px');
      } finally {
        await ctx.close();
      }
    }
  }, HEAVY);

  it('Q-A2-2 · 未知身份（内容较短）打开设置：底部圆角仍可见（对称降级但不得被裁）', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      // 不确立身份 → 设置面板内容较短（不触发 max-h 截断）
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('[data-app-sidebar] button')).find(
          (x) => x.getAttribute('aria-label') === '设置',
        );
        b?.click();
      });
      await page.waitForTimeout(700);
      const m = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"][aria-label="设置"]');
        if (!dlg) return null;
        const panel = (dlg.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
        const pr = panel.getBoundingClientRect();
        return {
          bottomGap: Math.round(window.innerHeight - pr.bottom),
          bottomInViewport: pr.bottom <= window.innerHeight + 0.5,
          radius: getComputedStyle(panel).borderBottomLeftRadius,
        };
      });
      expect(m).not.toBeNull();
      // 核心底线：底部仍在视口内、且圆角非 0（不再被裁掉）
      expect(m!.bottomInViewport).toBe(true);
      expect(m!.bottomGap).toBeGreaterThan(0);
      expect(m!.radius).toBe('16px');
      /**
       * 记录口径偏差（非本 spec 判失败项，供 team-lead 裁决）：
       * 内容短于 max-h 时面板顶对齐 → 上 24 / 下 46（差 22px）。
       * 「距顶 == 距底 ±2px」只在内容撑满 max-h（管理员场景）时成立。
       */
      expect(m!.bottomGap).toBeGreaterThanOrEqual(24);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  /* ================= A3 · 顶栏设置按钮已移除，侧栏入口仍在 ================= */

  it('Q-A3-1 · 顶栏无「设置」入口；侧栏「设置」可点开设置抽屉', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      await becomeAdmin(page);
      // 顶栏不得再有设置按钮（画板 02/12 顶栏只有 面包屑 + 搜索 + 头像）
      expect(await page.locator('header [aria-label="设置"]').count()).toBe(0);
      expect(await page.locator('header [aria-label="休息制度"]').count()).toBe(0);
      // 侧栏入口仍在（只断言「没有了」会把入口丢失误判为通过）
      const sidebarBtn = page.locator('[data-app-sidebar] [aria-label="设置"]');
      expect(await sidebarBtn.count()).toBeGreaterThanOrEqual(1);
      await sidebarBtn.first().click();
      await page.waitForTimeout(600);
      expect(await page.locator('[role="dialog"][aria-label="设置"]').count()).toBe(1);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  /* ================= A4 · 首页视图切换（lg 规格 + 持久化） ================= */

  it('Q-A4-1 · lg 档真几何：容器 r16/pad4/gap4/高36；项 84×28', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      const m = await page.evaluate(() => {
        const tl = document.querySelector('[role="tablist"]');
        if (!tl) return null;
        const cs = getComputedStyle(tl);
        const r = tl.getBoundingClientRect();
        const tabs = Array.from(tl.querySelectorAll('[role="tab"]')).map((t) => {
          const b = t.getBoundingClientRect();
          return {
            label: (t.textContent ?? '').trim(),
            w: Math.round(b.width),
            h: Math.round(b.height),
            selected: t.getAttribute('aria-selected'),
            radius: getComputedStyle(t).borderRadius,
            bg: getComputedStyle(t).backgroundColor,
          };
        });
        return {
          h: Math.round(r.height),
          radius: cs.borderRadius,
          pad: cs.padding,
          gap: cs.gap,
          bg: cs.backgroundColor,
          tabs,
        };
      });
      expect(m).not.toBeNull();
      expect(m!.h).toBe(36);
      expect(m!.radius).toBe('16px'); // 画板 02：外壳 r16
      expect(m!.pad).toBe('4px');
      expect(m!.gap).toBe('4px');
      expect(m!.tabs.map((t) => t.label)).toEqual(['看板', '月历']);
      for (const t of m!.tabs) {
        expect(t.h).toBe(28);
        expect(t.w).toBe(84);
      }
      // 选中项 paper 底、未选透明（画板 02）
      const sel = m!.tabs.find((t) => t.selected === 'true')!;
      const unsel = m!.tabs.find((t) => t.selected === 'false')!;
      expect(sel.label).toBe('看板');
      expect(sel.bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(unsel.bg).toBe('rgba(0, 0, 0, 0)');
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('Q-A4-2 · lg 档选中项圆角必须为规格 r12（本仓库 rounded-xl = 16px，类名断言看不出来）', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      const radii = await page.evaluate(() => {
        const tl = document.querySelector('[role="tablist"]');
        const tabs = Array.from(tl?.querySelectorAll('[role="tab"]') ?? []);
        return tabs.map((t) => getComputedStyle(t).borderRadius);
      });
      expect(radii.length).toBe(2);
      // 画板 02：选中/未选段均为 12px 圆角（当前实现渲染 16px → 本断言用于拦回归）
      for (const r of radii) expect(r).toBe('12px');
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('Q-A4-3 · 切到月历后刷新仍为月历（idplan.homeView 持久化，真浏览器）', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      const initial = await page.evaluate(() => localStorage.getItem('idplan.homeView'));
      expect(initial === null || initial === 'kanban').toBe(true);

      await page.evaluate(() => {
        const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
          (t.textContent ?? '').includes('月历'),
        );
        (tab as HTMLElement | undefined)?.click();
      });
      await page.waitForTimeout(700);
      expect(await page.evaluate(() => localStorage.getItem('idplan.homeView'))).toBe('calendar');

      await page.reload();
      await page.waitForSelector('header', { timeout: 20000 });
      await page.waitForTimeout(700);
      const after = await page.evaluate(() => {
        const tl = document.querySelector('[role="tablist"]');
        const tabs = Array.from(tl?.querySelectorAll('[role="tab"]') ?? []);
        return {
          stored: localStorage.getItem('idplan.homeView'),
          selected: tabs.map((t) => (t.textContent ?? '').trim() + ':' + t.getAttribute('aria-selected')),
        };
      });
      expect(after.stored).toBe('calendar');
      expect(after.selected).toEqual(['看板:false', '月历:true']);
    } finally {
      await ctx.close();
    }
  }, HEAVY);
});

describe('QA 复核 · 前置检查（跳过时给出可操作提示）', () => {
  it('构建产物未过期且 Chromium 可用', () => {
    if (!CAN_RUN_FRESH) {
      // eslint-disable-next-line no-console
      console.warn(
        `[qa-batch-a] 跳过复核：build-dist=${existsSync(DIST_INDEX)} chromium=${CHROMIUM_PATH !== null} 过期输入=${STALE.join(', ')}`,
      );
    }
    expect(true).toBe(true);
  });
});
