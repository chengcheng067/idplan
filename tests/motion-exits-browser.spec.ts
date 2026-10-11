// @vitest-environment node
/**
 * 出口接线 · **真 Chromium** 实测（设置抽屉 left-rail ⇒ drawer-out-left）。
 *
 * 为什么必须真浏览器：本批最核心的一条规矩是「出口动画绝不允许拦输入」，
 * 而它唯一的硬证据是 `document.elementFromPoint` —— **jsdom 没有 hit-test**
 * （该方法不可用），形态断言（motion-exits.spec.tsx）只能证明 `pointer-events`
 * 这个**声明**在，证明不了「用户真的点得到底层」。
 *
 * 三条判据（每条都配一个反面对照，防止「反正都会消失」式假绿）：
 *   ① 非 reduce：关闭后元素**留在 DOM**（presence 生效）→ 出口期
 *      `elementFromPoint` 命中**抽屉之外**的元素，且关闭前同一个点命中的是抽屉。
 *   ② reduce：关闭后**立即**消失（不等一个不会到来的 animationend）。
 *   ③ 动画事件不来（注入 `animation: none`）：仍留在 DOM，但在兜底 cap
 *      （200 + 120ms）内被强制卸载 —— 元素绝不永驻。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
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

/**
 * 产物过期守卫：src / tailwind.config.ts 等任一构建输入比 build-dist 新 ⇒ 整组 skip。
 * 过期时跑等于拿**上一版界面**下结论（假绿），比 skip 危险得多。
 */
function staleInputs(): string[] {
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = statSync(DIST_INDEX).mtimeMs;
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) files.push(full);
    }
  };
  walk(join(ROOT, 'src'));
  for (const f of ['index.html', 'vite.config.ts', 'tailwind.config.ts', 'postcss.config.js']) {
    const abs = join(ROOT, f);
    if (existsSync(abs)) files.push(abs);
  }
  return files
    .filter((f) => statSync(f).mtimeMs > distMs)
    .map((f) => f.slice(ROOT.length + 1))
    .slice(0, 3);
}
const STALE = CAN_RUN ? staleInputs() : [];
const CAN_RUN_FRESH = CAN_RUN && STALE.length === 0;
const SKIP_NOTE = !CAN_RUN
  ? '(未构建或缺 chromium)'
  : STALE.length > 0
    ? `(构建产物过期：${STALE.join(', ')} 比 build-dist 新)`
    : '';

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

async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = join(rootDir, raw);
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      if (/\.(js|mjs|css|json|png|jpg|svg|ico|woff2?)$/.test(raw)) {
        res.writeHead(404).end('not found');
        return;
      }
      filePath = join(rootDir, 'index.html');
    }
    try {
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(readFileSync(filePath));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return listenOnSafePort(server);
}

/** 桌面端 stub（自绘三键 + 更新探测），与 settings-zones 同口径 */
const IDPLAN_STUB = `
window.idplan = {
  isDesktop: true,
  platform: 'win32',
  version: '0.0.0.0',
  windowControls: {
    minimize: function () {}, toggleMaximize: function () {}, close: function () {},
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

const HEAVY = 30000;

describe.skipIf(!CAN_RUN_FRESH)(`出口接线 · 真 Chromium（不拦输入 / reduce / 兜底）${SKIP_NOTE}`, () => {
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

  async function openApp(reducedMotion: 'reduce' | 'no-preference'): Promise<{
    ctx: BrowserContext;
    page: Page;
  }> {
    const ctx = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      reducedMotion,
    });
    await ctx.addInitScript(IDPLAN_STUB);
    const page = await ctx.newPage();
    await page.goto(DIST_URL);
    await page.waitForSelector('header', { timeout: 20000 });
    await page.waitForTimeout(500);
    return { ctx, page };
  }

  /** 确立管理员身份（同 settings-zones 口径），并跳过首启引导 */
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

  /** 真鼠标点侧栏「设置」（取可见的那枚） */
  async function openSettings(page: Page): Promise<void> {
    const point = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('[data-app-sidebar] button')).find((x) => {
        if (x.getAttribute('aria-label') !== '设置') return false;
        const r = x.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!point) throw new Error('侧栏「设置」入口不可见');
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => document.querySelector('[data-settings-drawer]') !== null, undefined, {
      timeout: 8000,
    });
    // 等入场动画播完再取样，否则量到的是动画中途的盒子
    await page.waitForFunction(
      () => {
        const p = document.querySelector('[data-settings-drawer]') as HTMLElement | null;
        if (!p) return false;
        return p.getAnimations().every((a) => a.playState === 'finished');
      },
      undefined,
      { timeout: 8000 },
    );
  }

  /** 抽屉面板的几何中心（同时断言取样点在视口内 —— 视口外的点 elementFromPoint 必返 null） */
  async function panelCenter(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
    const r = await page.evaluate(() => {
      const p = document.querySelector('[data-settings-drawer]') as HTMLElement;
      const b = p.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
    });
    const vp = page.viewportSize()!;
    expect(r.x > 0 && r.x < vp.width, `取样点 x=${r.x} 不在视口宽 ${vp.width} 内`).toBe(true);
    expect(r.y > 0 && r.y < vp.height, `取样点 y=${r.y} 不在视口高 ${vp.height} 内`).toBe(true);
    return r;
  }

  /**
   * 出口期的一次性读数。
   *
   * ⚠️ 出口动画**不在** `[data-settings-drawer]`（那是调用方的子面板）上，而在 Modal
   *    自己的**锚点容器**上（`[role="dialog"]` 的首个子元素，见 Modal.tsx 的
   *    attachPanel 注释）：子面板是调用方的 JSX，底座碰不到它的 className。
   */
  async function probe(page: Page, x: number, y: number): Promise<{
    dialog: boolean;
    anchorClass: string;
    anchorPe: string;
    panelPe: string;
    overlayPe: string;
    hitInsideDialog: boolean | null;
    hitTag: string;
  }> {
    return page.evaluate(
      ([px, py]) => {
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
        const anchor = (dialog?.firstElementChild as HTMLElement | null) ?? null;
        const panel = document.querySelector('[data-settings-drawer]') as HTMLElement | null;
        const hit = document.elementFromPoint(px as number, py as number) as HTMLElement | null;
        return {
          dialog: dialog !== null,
          anchorClass: anchor?.className ?? '(无锚点)',
          anchorPe: anchor ? getComputedStyle(anchor).pointerEvents : '(无锚点)',
          panelPe: panel ? getComputedStyle(panel).pointerEvents : '(无面板)',
          overlayPe: dialog ? getComputedStyle(dialog).pointerEvents : '(无遮罩)',
          hitInsideDialog: hit ? (dialog ? dialog.contains(hit) : false) : null,
          hitTag: hit
            ? `${hit.tagName.toLowerCase()}${hit.dataset?.settingsDrawer !== undefined ? '[抽屉]' : ''}`
            : '(null)',
        };
      },
      [x, y],
    );
  }

  it(
    '① 非 reduce：关闭后元素留着播出口；出口期 elementFromPoint 命中抽屉**之外**（关闭前同一命中抽屉）',
    async () => {
      const { ctx, page } = await openApp('no-preference');
      try {
        await becomeAdmin(page);
        await openSettings(page);
        const { x, y } = await panelCenter(page);

        // 反面对照：关闭前，这个点必须命中的是**抽屉内部** —— 否则「关闭后没命中」
        // 什么也证明不了（取样点本来就压在别处）。
        const before = await probe(page, x, y);
        expect(before.dialog).toBe(true);
        expect(before.hitInsideDialog, `关闭前 (${x},${y}) 未命中抽屉，命中的是 ${before.hitTag}`).toBe(true);

        // ★ 关闭与读数放进**同一个 evaluate**：跨进程往返（几毫秒到几十毫秒）会让
        //   「出口期」这个 200ms 的窗口变成一场竞态 —— 在浏览器内部先等出口**开始**
        //   （锚点挂上 drawer-out-left），再一次性读完，时序才是确定的。
        const during = await page.evaluate(async ([px, py]) => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          const deadline = performance.now() + 150; // > cap(320)? 不，150 << 320，安全
          while (performance.now() < deadline) {
            const a = document.querySelector('[role="dialog"]')?.firstElementChild;
            if (a?.classList.contains('drawer-out-left')) break;
            await new Promise((r) => requestAnimationFrame(() => r(null)));
          }
          const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
          const anchor = (dialog?.firstElementChild as HTMLElement | null) ?? null;
          const panel = document.querySelector('[data-settings-drawer]') as HTMLElement | null;
          const hit = document.elementFromPoint(px as number, py as number);
          return {
            dialog: dialog !== null,
            anchorClass: anchor?.className ?? '(无锚点)',
            anchorPe: anchor ? getComputedStyle(anchor).pointerEvents : '(无锚点)',
            panelPe: panel ? getComputedStyle(panel).pointerEvents : '(无面板)',
            overlayPe: dialog ? getComputedStyle(dialog).pointerEvents : '(无遮罩)',
            hitInsideDialog: hit ? (dialog ? dialog.contains(hit) : false) : null,
            hitTag: hit ? hit.tagName.toLowerCase() : '(null)',
          };
        }, [x, y] as const);

        // presence：关闭已发生，但元素还在（否则出口动画根本没机会播）
        expect(during.dialog, '关闭后立刻卸载 ⇒ drawer-out-left 没机会播').toBe(true);
        expect(during.anchorClass, `没挂上 drawer-out-left（实际 ${during.anchorClass}）`).toContain(
          'drawer-out-left',
        );
        expect(during.anchorPe, '出口期锚点容器还在吃点击').toBe('none');
        expect(during.overlayPe, '出口期遮罩还在吃点击').toBe('none');
        expect(during.panelPe, '出口期面板还在吃点击（未从锚点继承到 none）').toBe('none');
        expect(
          during.hitInsideDialog,
          `出口期 (${x},${y}) 仍被浮层挡住（命中 ${during.hitTag}）—— 视觉余韵拦了输入`,
        ).toBe(false);
        expect(during.hitTag).not.toBe('(null)');

        // 出口播完后必须真的走掉
        await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, undefined, {
          timeout: 3000,
        });
      } finally {
        await ctx.close();
      }
    },
    HEAVY,
  );

  it(
    '② reduce：关闭**立即**移除（不等一个永不到来的 animationend）',
    async () => {
      const { ctx, page } = await openApp('reduce');
      try {
        await becomeAdmin(page);
        await openSettings(page);
        expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

        // 关闭与读数同一个 evaluate：两帧（≈33ms）后必须已经消失 ——
        // 若走的是「等动画」那条路，这里会白等到兜底 320ms 才消失，本断言必红。
        const gone = await page.evaluate(async () => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
          return document.querySelector('[role="dialog"]') === null;
        });
        expect(gone, 'reduce 下等了出口动画（该立即卸载）').toBe(true);
      } finally {
        await ctx.close();
      }
    },
    HEAVY,
  );

  it(
    '③ 兜底 cap：动画事件不来（animation:none）仍会留在 DOM，但在 320ms 内被强制卸载',
    async () => {
      const { ctx, page } = await openApp('no-preference');
      try {
        await becomeAdmin(page);
        await openSettings(page);
        // 把出口动画关掉：animationend 永远不会派发，只剩兜底这一条路。
        await page.addStyleTag({ content: '.drawer-out-left{animation:none !important}' });

        // 关闭与读数放进同一个 evaluate（跨进程往返会让 200ms 的出口窗口变成竞态）
        const during = await page.evaluate(async () => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          // 等两帧让 React 提交（≈33ms，远小于 cap 320ms）
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
          const dialog = document.querySelector('[role="dialog"]');
          const anchor = dialog?.firstElementChild as HTMLElement | null;
          return {
            dialog: dialog !== null,
            exiting: anchor?.classList.contains('drawer-out-left') ?? false,
          };
        });
        // 先证明「关闭真的触发了、并且真的走了出口路径」—— 否则「元素还在」是空过
        expect(during.exiting, '关闭没触发出口（那这条用例什么也没证明）').toBe(true);
        expect(during.dialog, '没等动画就直接卸载了（兜底与动画路径混了）').toBe(true);

        // 100ms < cap(320ms)：此刻必须还在，否则说明「立即卸载」而不是兜底生效
        await page.waitForTimeout(100);
        expect(
          await page.evaluate(() => document.querySelector('[role="dialog"]') !== null),
          '兜底过早触发（< cap）',
        ).toBe(true);

        await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, undefined, {
          timeout: 1200,
        });
      } finally {
        await ctx.close();
      }
    },
    HEAVY,
  );
});
