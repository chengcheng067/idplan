import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { listenOnSafePort } from './helpers/safe-listen';


/**
 * 0.8.6.0002 · 反馈 #10.4（成员看板 UI 完全出错）—— 真 Chromium 布局度量回归。
 *
 * 她的原话：「切换到群成员的看板位置，UI 会完全出错……1. 字体显示不完整；
 * 2. 图标各方面都有问题」（她标注「这个 bug 需要深度修复」）。
 *
 * 根因（修复前实测记录，详见 fix 提交）：ProjectCard 的 `xl:flex-[1_1_340px]` 与
 * `md:w-[calc(50%-10px)]` 是首页 flex-wrap **行**的专用类，成员看板把它们放进了
 * flex-col 看板列——340 基准作用到纵轴（卡片 340px 高，规格 185）、半宽类把卡片
 * 压成列宽一半（1152/1024 档实测 105–130px：标题截断、Tag 逐字竖绕、头像行报废）；
 * 另统计卡行断点与 StatCard 自身错配（lg 档半格宽）。jsdom 不实现布局，这类座标
 * 只能真 Chromium 量 getBoundingClientRect。
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
  // listen(0) 的随机端口可能撞 Chromium 不安全端口黑名单（ERR_UNSAFE_PORT 假红）⇒ 安全 listen
  return listenOnSafePort(server, '/');
}

/** 截图证据目录（qa-scratch 已在 .gitignore） */
const SHOT_DIR = resolve(__dirname, '..', 'qa-scratch', 'member-board-layout');

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
  '反馈 #10.4 · 成员看板卡片尺寸/截断/头像行（真 Chromium）',
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

    /** 成员看板首卡度量（宽/高/标题截断/头像行形态） */
    async function firstCardMetrics(page: Page) {
      return page.evaluate(() => {
        const card = document.querySelector('[role="button"].group') as HTMLElement | null;
        if (!card) return null;
        const title = card.querySelector('span.truncate') as HTMLElement | null;
        const av = card.querySelector('.flex.items-center.justify-between > div:last-child') as HTMLElement | null;
        const avInner = av?.firstElementChild as HTMLElement | null;
        const avatars = avInner ? Array.from(avInner.children) : [];
        return {
          w: card.clientWidth,
          h: card.clientHeight,
          titleTruncated: title ? title.scrollWidth > title.clientWidth + 1 : null,
          avatarDir: avInner ? getComputedStyle(avInner).flexDirection : null,
          avatarsSameRow:
            avatars.length >= 2
              ? avatars[0].getBoundingClientRect().top === avatars[1].getBoundingClientRect().top
              : null,
        };
      });
    }


    it('M-01 · 1440 档：卡片回到设计尺寸（≈340×185）、标题不截断、头像横排', async () => {
      const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page: Page = await ctx.newPage();
      try {
        await enterMemberBoard(page, server.url);
        const m = await firstCardMetrics(page);
        expect(m).not.toBeNull();
        // 修复前：232×340（flex-basis 作用到纵轴）且标题在窄列下截断
        expect(m!.h, '卡片高度应回到 xl 设计档 185（修复前被抅到 340）').toBe(185);
        expect(m!.w, '卡片宽度应≈340（列基准 340 减列内边距）').toBeGreaterThanOrEqual(330);
        expect(m!.titleTruncated, '标题不应被截断（修复前 105px 窄卡必截断）').toBe(false);
        expect(m!.avatarDir).toBe('row');
        expect(m!.avatarsSameRow, '头像必须横排（修复前被挤成竖排/报废）').toBe(true);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, '页面不应出现横向滚动').toBeLessThanOrEqual(0);
        await page.screenshot({ path: resolve(SHOT_DIR, 'M-01-member-board-1440.png') });
      } finally {
        await ctx.close();
      }
    }, 60000);

    it('M-02 · 1152 档（xl 以下）：半宽类不得把卡片压窄（修复前 105px 全面报废）', async () => {
      const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1152, height: 864 } });
      const page: Page = await ctx.newPage();
      try {
        await enterMemberBoard(page, server.url);
        const m = await firstCardMetrics(page);
        expect(m).not.toBeNull();
        expect(m!.w, 'xl 以下卡片也应撑满列宽（修复前被 md:w-[50%-10px] 压到 105px）').toBeGreaterThanOrEqual(280);
        expect(m!.titleTruncated, '标题不应被截断').toBe(false);
        expect(m!.avatarsSameRow, '头像必须横排').toBe(true);
        await page.screenshot({ path: resolve(SHOT_DIR, 'M-02-member-board-1152.png') });
      } finally {
        await ctx.close();
      }
    }, 60000);

  },
);
