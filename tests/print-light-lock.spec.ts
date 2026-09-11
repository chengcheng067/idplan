import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * v0.7 · 打印锁浅色验收（真实构建产物 + 真 Chromium 实测）
 *
 * ── 为什么需要这个 spec ──
 *   产品要求「打印稿恒为浅色」，即便用户当前处于暗色主题。实现机制是：
 *   `global.css` 把整套亮色令牌同时声明在 `:root, .print-root` 上，
 *   而 CSS 自定义属性按「取最近祖先」解析 —— 于是 `.print-root` 子树的每个后代
 *   都解析回亮色值，哪怕 `<html data-theme="dark">` 就在它外面。
 *
 *   这一条此前**只有静态分析证据**（在构建产物的 CSS 文本里 grep 到 `.print-root`
 *   亮色令牌块存在）。静态分析能证明「规则在」，但证明不了「浏览器真的这样解析」。
 *   本 spec 直接在真浏览器里读 computed style，把这条机制变成实测事实。
 *
 * ── 为什么用注入 DOM 而不是真的打开打印页 ──
 *   真打印页需要先有项目/阶段数据（走 Dexie 或远端接口），准备成本高且脆弱；
 *   而本 spec 要验证的是**样式解析机制**，与业务数据无关。注入两个同色类元素
 *   —— 一个在 .print-root 外、一个在内 —— 再比对 computed 颜色，
 *   是对该机制的**最小充分**验证：外层取暗色值、内层取亮色值 ⇒ 机制成立。
 *
 * 前置：`npm run build` 已产出 `build-dist/`；缺产物或浏览器时本 spec 跳过。
 */

const DIST_INDEX = resolve(__dirname, '..', 'build-dist', 'index.html');

/** 探测已安装的 chromium（与 layout-walkthrough.spec.ts 同口径） */
function resolveChromium(): string | null {
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
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
      for (const rel of relCandidates) {
        const exe = join(root, dir, ...rel);
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const CHROMIUM_PATH = resolveChromium();
const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null;

/** 产物必须以 HTTP 提供：base:'/' 的绝对资源路径在 file:// 下会 404（应用不挂载） */
async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
  const http = require('node:http') as typeof import('node:http');
  const fs = require('node:fs') as typeof import('node:fs');
  const { extname } = require('node:path') as typeof import('node:path');

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };

  const server = http.createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = join(rootDir, rawPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
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

/**
 * 在页面里插入探针 DOM 并回报 computed 颜色。
 *
 * 选取的角色覆盖三个变体，避免只测到一条路径：
 *   · bg-stage-band-sN（宽面）/ bg-stage-sN（实心块）/ text-stage-ink-sN（面内字）
 * 每个角色各插一个「.print-root 外」与一个「.print-root 内」的样本。
 */
async function probe(page: Page, stageN: number): Promise<{
  darkOutside: string[];
  lightInside: string[];
  printRootTokenSample: string;
  darkRootTokenSample: string;
}> {
  return page.evaluate((n: number) => {
    const host = document.createElement('div');
    host.id = '__print_lock_probe';
    host.innerHTML = `
      <div class="dark-host">
        <div class="probe-band bg-stage-band-s${n}"></div>
        <div class="probe-solid bg-stage-s${n}"></div>
        <div class="probe-ink text-stage-ink-s${n}">x</div>
      </div>
      <div class="print-root">
        <div class="probe-band bg-stage-band-s${n}"></div>
        <div class="probe-solid bg-stage-s${n}"></div>
        <div class="probe-ink text-stage-ink-s${n}">x</div>
      </div>`;
    document.body.appendChild(host);

    const pick = (sel: string, prop: 'backgroundColor' | 'color'): string => {
      const el = host.querySelector(sel) as HTMLElement | null;
      return el ? getComputedStyle(el)[prop] : 'MISSING';
    };
    const readToken = (sel: string, name: string): string => {
      const el = host.querySelector(sel) as HTMLElement | null;
      return el ? getComputedStyle(el).getPropertyValue(name).trim() : 'MISSING';
    };

    const result = {
      darkOutside: [
        pick('.dark-host .probe-band', 'backgroundColor'),
        pick('.dark-host .probe-solid', 'backgroundColor'),
        pick('.dark-host .probe-ink', 'color'),
      ],
      lightInside: [
        pick('.print-root .probe-band', 'backgroundColor'),
        pick('.print-root .probe-solid', 'backgroundColor'),
        pick('.print-root .probe-ink', 'color'),
      ],
      printRootTokenSample: readToken('.print-root .probe-band', '--stage-band-s1-rgb'),
      darkRootTokenSample: readToken('.dark-host .probe-band', '--stage-band-s1-rgb'),
    };
    host.remove();
    return result;
  }, stageN);
}

describe.skipIf(!CAN_RUN)('v0.7 · 打印锁浅色验收（暗色主题下打印子树仍为浅色）', () => {
  let browser: Browser;
  let server: { url: string; close(): Promise<void> };
  let DIST_URL = '';

  beforeAll(async () => {
    server = await startStaticServer(resolve(__dirname, '..', 'build-dist'));
    DIST_URL = server.url;
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  /** 开到暗色主题的真实产品页（data-theme 是属性，不是 class） */
  async function openDark(): Promise<{ close(): Promise<void>; page: Page }> {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(DIST_URL);
    await page.evaluate(() => {
      // ⚠️ 项目用 <html data-theme="dark">，**不是** classList.add('dark')
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(200);
    return { close: () => ctx.close(), page };
  }

  it('P-01 · 暗色下 .print-root 外取暗色值、内取亮色值（三变体全覆盖）', async () => {
    const { close, page } = await openDark();
    try {
      // 先确认暗色确实生效：暗色令牌块应已覆盖根变量
      const themeOk = await page.evaluate(
        () => document.documentElement.getAttribute('data-theme'),
      );
      expect(themeOk).toBe('dark');

      const { darkOutside, lightInside } = await probe(page, 1);

      // 三变体都必须拿到真实颜色
      for (const v of [...darkOutside, ...lightInside]) {
        expect(v).not.toBe('MISSING');
        expect(v).toMatch(/^rgba?\(/);
      }

      // 核心断言：同一个类，print-root 内外的解析值不同 ⇒ 锁浅色机制在真浏览器里成立
      expect(lightInside).not.toEqual(darkOutside);
    } finally {
      await close();
    }
  });

  it('P-02 · 同元素的 CSS 变量解析随 .print-root 边界切换（机制根因）', async () => {
    const { close, page } = await openDark();
    try {
      const { printRootTokenSample, darkRootTokenSample } = await probe(page, 1);

      // --stage-band-s1-rgb 亮色 = "100 135 134"、暗色 = "23 46 48"（见 global.css）
      expect(darkRootTokenSample).not.toBe(printRootTokenSample);
      expect(darkRootTokenSample).toBe('23 46 48');
      expect(printRootTokenSample).toBe('100 135 134');
    } finally {
      await close();
    }
  });

  it('P-03 · 亮色带上的文字取 stage-ink（杜绝浅色阶段压白字）', async () => {
    const { close, page } = await openDark();
    try {
      // s5 芽白是「浅色带」代表：面内字必须走 stage-ink 变体，而非白色
      const { lightInside } = await probe(page, 5);
      const inkColor = lightInside[2];
      expect(inkColor).toMatch(/^rgba?\(/);

      // 解析出 RGB，确认不是白字（浅底白字对比度仅 1.10，是硬 bug）
      const m = inkColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      expect(m).not.toBeNull();
      const [r, g, b] = [Number(m![1]), Number(m![2]), Number(m![3])];
      const isWhite = r > 250 && g > 250 && b > 250;
      expect(isWhite).toBe(false);
    } finally {
      await close();
    }
  });

  it('P-04 · 亮暗两主题下 .print-root 解析出的颜色完全一致（打印稿与主题无关）', async () => {
    // 亮色上下文
    const lightCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const lightPage = await lightCtx.newPage();
    await lightPage.goto(DIST_URL);
    await lightPage.waitForTimeout(200);
    const lightResult = await probe(lightPage, 1);
    await lightCtx.close();

    // 暗色上下文
    const { close, page } = await openDark();
    try {
      const darkResult = await probe(page, 1);
      // 打印子树内的取值必须跨主题一致（这正是「打印恒浅色」的定义）
      expect(darkResult.lightInside).toEqual(lightResult.lightInside);
      // 而 print-root 之外则应随主题变化（反证：不是所有元素都不变）
      expect(darkResult.darkOutside).not.toEqual(lightResult.lightInside);
    } finally {
      await close();
    }
  });
});
