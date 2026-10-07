import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';


/**
 * 0.8.6.0002 · 反馈 #7（日历看板左右上下没对齐）—— 真 Chromium 锚点度量回归。
 *
 * 她的原话：「日历看板这个位置，它左右两侧和上下 UI 没有对齐，我希望使其是对齐的」。
 *
 * 根因（修复前实测记录，详见 fix 提交）：MonthlyCalendarView 根节点在页级 px-8
 * 之内又自带 px-16/md:px-36，而页面底色与该处 bg-cream 同值 ⇒ 双重锚点，可见的
 * sunken 日历卡比同页统计卡行内缩 36px（1440 档实测：统计左缘 272 vs 日历左缘 308）。
 * jsdom 不实现布局，锚点错位只能真 Chromium 量左右缘。
 *
 * 前置：`npm run build` 先跑过；产物/Chromium 缺失或产物过期 → 整组 skip。
 */

/** 探测已安装的 chromium（与 v07-board-acceptance.spec.ts 同一实现） */
function resolveChromium(): string | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('node:path') as typeof import('node:path');
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  const relCandidates = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
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
      for (const rel of relCandidates) {
        const exe = join(root, dir, ...rel);
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

/** 构建产物入口 */
const DIST_INDEX = resolve(__dirname, '..', 'build-dist', 'index.html');

const CHROMIUM_PATH = resolveChromium();
const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null;

/** 参与「产物是否过期」判定的构建输入（与 v07-board-acceptance 同口径） */
const BUILD_INPUT_DIRS = ['src', 'electron'];
const BUILD_INPUT_FILES = ['index.html', 'vite.config.ts', 'tailwind.config.ts', 'postcss.config.js'];

function collectFiles(dir: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('node:path') as typeof import('node:path');
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function staleInputs(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = fs.statSync(DIST_INDEX).mtimeMs;
  const candidates = [
    ...BUILD_INPUT_DIRS.flatMap((d) => collectFiles(resolve(__dirname, '..', d))),
    ...BUILD_INPUT_FILES.map((f) => resolve(__dirname, '..', f)).filter((f) => existsSync(f)),
  ];
  return candidates.filter((f) => fs.statSync(f).mtimeMs > distMs);
}

const CAN_RUN_FRESH = CAN_RUN && staleInputs().length === 0;

/** SPA 必须走 HTTP 服务（vite base:'/'，file:// 下资源全 404） */
async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('node:http') as typeof import('node:http');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join, extname } = require('node:path') as typeof import('node:path');
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-ico',
  };
  const server = http.createServer((req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let p = join(rootDir, raw);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      if (/\.(js|mjs|css|json|woff2?|svg|ico)$/.test(raw)) {
        res.writeHead(404).end('nf');
        return;
      }
      p = join(rootDir, 'index.html');
    }
    try {
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(fs.readFileSync(p));
    } catch {
      res.writeHead(404).end('nf');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** 截图证据目录（qa-scratch 已在 .gitignore） */
const SHOT_DIR = resolve(__dirname, '..', 'qa-scratch', 'calendar-anchor');

/**
 * 进入「成员 陈工 的成员看板」：首启建管理员 → 载入 indoor 示例 → 退出后以
 * 演示成员「陈工」进入 → SPA 导航到成员看板。
 * （陈工是 indoor 种子里的 stage owner，其名下必有相关项目；整库导入会替换
 * members，管理员身份随之失效，故导入后重新进入身份。）
 */
async function enterMemberBoard(page: Page, serverUrl: string): Promise<void> {
  await page.goto(serverUrl);
  await page.waitForSelector('header', { timeout: 20000 });

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '我是管理员');
    b?.click();
  });
  await page.waitForTimeout(400);
  await page.locator('input[placeholder="你的姓名"]').fill('探针甲');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('确认为管理员'));
    b?.click();
  });
  await page.waitForTimeout(1200);

  const card = page.locator('[data-first-run-card="indoor"]');
  await card.first().waitFor({ state: 'visible', timeout: 10000 });
  await card.first().click();
  await page.waitForTimeout(400);
  await page.locator('button', { hasText: '确认载入' }).first().click();
  await page.waitForFunction((name) => document.body.innerText.includes(name), '云栖', { timeout: 20000 });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '点击进入');
    b?.click();
  });
  await page.waitForSelector('input[placeholder="你的姓名"]', { timeout: 15000 });
  await page.locator('input[placeholder="你的姓名"]').fill('陈工');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '下一步');
    b?.click();
  });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const l = Array.from(document.querySelectorAll('a')).find((x) => (x.textContent ?? '').includes('成员看板'));
    l?.click();
  });
  await page.waitForSelector('[role="button"].group', { timeout: 20000 });
  await page.waitForTimeout(500);
}

describe.skipIf(!CAN_RUN_FRESH)(
  '反馈 #7 · 月历卡与统计卡行共用左右锚点（真 Chromium）',
  () => {
    let browser: import('playwright-core').Browser;
    let server: { url: string; close(): Promise<void> };

    beforeAll(async () => {
      mkdirSync(SHOT_DIR, { recursive: true });
      server = await startStaticServer(resolve(__dirname, '..', 'build-dist'));
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
    }, 60000);

    afterAll(async () => {
      await browser?.close();
      await server?.close();
    });


    it('C-01 · 月历卡与统计卡行共用左右锚点（修复前内缩 36px）', async () => {
      for (const vp of [
        { width: 1440, height: 900 },
        { width: 1152, height: 864 },
      ]) {
        const ctx: BrowserContext = await browser.newContext({ viewport: vp });
        const page: Page = await ctx.newPage();
        try {
          await enterMemberBoard(page, server.url);
          // 切「月历」档（SegmentedControl 真按钮）
          await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '月历');
            b?.click();
          });
          await page.waitForSelector('main .bg-cream .rounded-\\[24px\\]', { timeout: 10000 });
          await page.waitForTimeout(400);
          const m = await page.evaluate(() => {
            const sunken = document.querySelector('main .bg-cream .rounded-\\[24px\\]') as HTMLElement | null;
            const stats = Array.from(document.querySelectorAll('main section.flex.flex-wrap > *'));
            const r = (el: Element | null | undefined) =>
              el ? { l: Math.round(el.getBoundingClientRect().left), r: Math.round(el.getBoundingClientRect().right) } : null;
            return { sunken: r(sunken), statFirst: r(stats[0]), statLast: r(stats[stats.length - 1]) };
          });
          expect(m.sunken, `${vp.width} 档应渲染出月历卡`).not.toBeNull();
          // 同一条左右竖线（±2px 抗亚像素）
          expect(
            Math.abs(m.sunken!.l - m.statFirst!.l),
            `${vp.width} 档：月历卡左缘应与统计卡左缘同线（修复前内缩 36px）`,
          ).toBeLessThanOrEqual(2);
          expect(
            Math.abs(m.sunken!.r - m.statLast!.r),
            `${vp.width} 档：月历卡右缘应与统计卡右缘同线`,
          ).toBeLessThanOrEqual(2);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, '页面不应出现横向滚动').toBeLessThanOrEqual(0);
          await page.screenshot({ path: resolve(SHOT_DIR, `C-01-calendar-anchor-${vp.width}.png`) });
        } finally {
          await ctx.close();
        }
      }
    }, 120000);
  },
);
