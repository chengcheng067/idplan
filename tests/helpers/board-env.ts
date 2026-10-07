import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Browser, BrowserContext, Page } from 'playwright-core';

import { listenOnSafePort } from './safe-listen';

/**
 * 成员看板 / 路由类真 Chromium spec 的共享 harness（v0.8.6.0003）。
 *
 * 为什么抽这里：member-board-layout.spec.ts 与 v07-board-acceptance.spec.ts 各自
 * 复制了一份 resolveChromium + startStaticServer + 产物过期判定（约 150 行）。
 * 本轮四个反馈（统计卡裁字 / 列宽 / 返回键 / 路由滚动）每个都要起静态服务 + 开
 * Chromium + 进成员看板，再抄四份等于给「四处漂移」埋雷。既有 spec 不动
 * （在途文件不并发改），本 helper 只服务本轮新增 spec。
 *
 * 口径与 member-board-layout.spec.ts **逐字一致**：
 *   · Chromium 探测：PLAYWRIGHT_BROWSERS_PATH → LOCALAPPDATA/HOME/USERPROFILE 下
 *     的 ms-playwright/chromium-*（chrome-win64 / chrome-win / linux / mac 四形态）；
 *   · 静态服务：SPA 必须走 HTTP（vite base '/'，file:// 下资源全 404），非资源
 *     路径回落 index.html；listen 经 listenOnSafePort 避开 Chromium 不安全端口；
 *   · 产物过期：src / electron / index.html / vite.config.ts 等比 build-dist 新
 *     ⇒ 整组 skip（避免拿旧产物制造假红/假绿）。
 */

/** 探测已安装的 chromium（与 member-board-layout.spec.ts 同一实现） */
export function resolveChromium(): string | null {
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

const REPO_ROOT = resolve(__dirname, '..', '..');

/** 构建产物入口 */
export const DIST_INDEX = resolve(REPO_ROOT, 'build-dist', 'index.html');

export const CHROMIUM_PATH = resolveChromium();

export const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null;

/** 参与「产物是否过期」判定的构建输入（与 member-board-layout 同口径） */
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

/** 比产物新的构建输入（非空 ⇒ 产物过期，spec 应 skip） */
export function staleInputs(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = fs.statSync(DIST_INDEX).mtimeMs;
  const candidates = [
    ...BUILD_INPUT_DIRS.flatMap((d) => collectFiles(resolve(REPO_ROOT, d))),
    ...BUILD_INPUT_FILES.map((f) => resolve(REPO_ROOT, f)).filter((f) => existsSync(f)),
  ];
  return candidates.filter((f) => fs.statSync(f).mtimeMs > distMs);
}

/** 产物存在且未过期（spec 的 skipIf 判据） */
export const CAN_RUN_FRESH = CAN_RUN && staleInputs().length === 0;

/** SPA 必须走 HTTP 服务（vite base:'/'，file:// 下资源全 404） */
export async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
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
  // listen(0) 的随机端口可能撞 Chromium 不安全端口黑名单 ⇒ 安全 listen
  return listenOnSafePort(server, '/');
}

/** 截图证据目录（qa-scratch 已在 .gitignore；每个 spec 传自己的子目录名） */
export function shotDir(name: string): string {
  const dir = resolve(REPO_ROOT, 'qa-scratch', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/* ---------------------------------- 进入流程 ---------------------------------- */

/**
 * 首启建管理员 → 载入 indoor 示例（陈工是 indoor 种子里的 stage owner，其名下必有
 * 相关项目）。与 member-board-layout.spec.ts 的 enterMemberBoard 前半段同口径。
 */
export async function bootstrapAdminWithDemo(page: Page, serverUrl: string): Promise<void> {
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
}

/**
 * 整库导入（loadDemo）会替换 members，原管理员身份失效（member-board-layout.spec.ts
 * 注释同款坑）。库里有管理员（演示负责人）⇒ 点「点击进入」直达 name_input（成员意图），
 * 填演示成员名进入 ⇒ isAdmin 复活 + 成员区（演示成员）可点。
 */
export async function reenterAdmin(page: Page): Promise<void> {
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '点击进入');
    b?.click();
  });
  await page.waitForSelector('input[placeholder="你的姓名"]', { timeout: 15000 });
  // 若落在 admin_prompt（库里无管理员时）先走「我是管理员」；name_input 直填即可
  const hasAdminPrompt = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some((x) => (x.textContent ?? '').trim() === '我是管理员'),
  );
  if (hasAdminPrompt) {
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '我是管理员');
      b?.click();
    });
    await page.waitForTimeout(300);
  }
  await page.locator('input[placeholder="你的姓名"]').fill('演示负责人');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(
      (x) => (x.textContent ?? '').includes('确认为管理员') || (x.textContent ?? '').trim() === '下一步',
    );
    b?.click();
  });
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), null, { timeout: 15000 });
  await page.waitForTimeout(800);
}

/** 退出身份 → 以「陈工」进入 → 点侧栏「成员看板」（与 member-board-layout 同口径） */
export async function enterMemberBoard(page: Page): Promise<void> {
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

  // 点侧栏「成员看板」入口。按 href 而非文案：成员的侧栏首项叫「看板」、
  // 管理员的叫「项目」（SidebarNav 按角色分流），文案会漂移，href 不会。
  await page.evaluate(() => {
    document.querySelector('a[href="/member-board"]')?.click();
  });
  await page.waitForSelector('[role="button"].group', { timeout: 20000 });
  await page.waitForTimeout(600);
}

/** 起静态服务（spec 的 beforeAll 用；浏览器由 spec 自己 chromium.launch） */
export async function startServer(): Promise<{ url: string; close(): Promise<void> }> {
  return startStaticServer(resolve(REPO_ROOT, 'build-dist'));
}

/** 新开一个上下文（viewport 可指定） */
export async function newContext(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<BrowserContext> {
  return browser.newContext({ viewport });
}
