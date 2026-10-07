/**
 * F3 · 反馈 #3「退出身份后侧栏仍显示项目」的自动化覆盖（真 Chromium）。
 *
 * ── 这条用例守什么 ──
 * 她的原话：「退出身份后，左侧的边栏就不应该显示项目了」。v0.8.6.0002 两批
 * 修复（2ec2d3c 展开态 + f4acee0 收起态）把 hasIdentity 门控补齐后，
 * **一直没有自动化覆盖**——退出场景全靠人肉点，回归了没人知道。
 *
 * 本用例走真实用户旅程（不碰 IndexedDB、不预制 identity，全部走 UI）：
 *   建管理员 → 载入示例项目 → 有身份时两态都有项目（对照，防空库假绿）
 *   → 退出身份 → 展开态与收起态都必须没有项目（反馈 #3 的修复面）。
 *
 * ── 为什么用示例项目而不是自建夹具 ──
 * 「载入示例项目」是应用自带链路（buildDemoBackup → zod → 覆盖导入 →
 * reload），与首启引导同一出口；它只校验「项目在侧栏的可见性」这一件事，
 * 不需要夹具数据精细布局。备份导入链路本身由 isolation-browser.spec.ts
 * 与 useBackupIo 的既有覆盖负责，本文件不重复造夹具。
 *
 * 前置：build-dist 存在且不落后于 src（否则 skip——R12 假绿教训），
 *       本机有 Playwright 的 Chromium。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';

import { listenOnSafePort } from './helpers/safe-listen';

/**
 * ⚠️ Electron 把 `ELECTRON_RUN_AS_NODE=1` 注入到环境里。
 * 不清掉 chromium.launch() 拉起的进程会按 Node 解释器启动（立即退出）。
 */
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = resolve(__dirname, '..');
const DIST_INDEX = resolve(ROOT, 'build-dist', 'index.html');

/** 探测已安装的 chromium（与 print-light-lock.spec.ts / isolation-browser.spec.ts 同口径） */
function resolveChromium(): string | null {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.cache', 'ms-playwright') : null,
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

/**
 * 构建产物新鲜度门控（R12 假绿教训）：真浏览器 spec 测的是 `build-dist/`，
 * 而 `npm test` 不重建。src 比产物新 ⇒ 本 spec 断言的是**旧代码**——
 * 改坏了也能全绿。这里取 src 树（+ 关键配置）的最新 mtime 与
 * build-dist/index.html 比，落后即 skip（与 qa-batch-a-verify 的
 * staleInputs 同思路；真跑前请先 `npm run build`）。
 */
function latestMtime(dir: string, exts: Set<string>): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, latestMtime(p, exts));
    } else if (exts.has(extname(entry.name))) {
      newest = Math.max(newest, statSync(p).mtimeMs);
    }
  }
  return newest;
}

function buildIsStale(): boolean {
  if (!existsSync(DIST_INDEX)) return true;
  const EXT = new Set(['.ts', '.tsx', '.css', '.html', '.json']);
  const srcNewest = Math.max(
    latestMtime(resolve(ROOT, 'src'), EXT),
    statSync(resolve(ROOT, 'tailwind.config.ts')).mtimeMs,
    statSync(resolve(ROOT, 'index.html')).mtimeMs,
  );
  return srcNewest > statSync(DIST_INDEX).mtimeMs;
}

/** 演示数据里的一个项目名（demoDataFactory.ts 的 preset 名，用于等待导入生效） */
const DEMO_PROJECT = '云栖·湖畔茶室';

describe.skipIf(!CAN_RUN || buildIsStale())('F3-BROWSER · 退出身份后侧栏不显示项目（真 Chromium）', () => {
  let browser: Browser;
  let server: { url: string; close(): Promise<void> } | null = null;

  beforeAll(async () => {
    // build-dist 静态服务（SPA：未知路径回落 index.html）
    const { readFileSync: read, statSync: stat } = await import('node:fs');
    
    const MIME: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-ico',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    };
    const s = createServer((req, rsp) => {
      const raw = decodeURIComponent((req.url ?? '').split('?')[0]);
      let p = join(ROOT, 'build-dist', raw);
      // 目录 / 未知路径 → SPA 回落 index.html；资源请求缺失一律 404
      // （与 qa-batch-a-verify 的 startStaticServer 同口径——先判目录再读，
      //   否则 read(dir) 抛 EISDIR 时 writeHead(200) 已发出 ⇒ ERR_HTTP_HEADERS_SENT）
      if (!existsSync(p) || stat(p).isDirectory()) {
        if (/\.(js|mjs|css|json|png|jpg|svg|ico|woff2?)$/.test(raw)) {
          rsp.writeHead(404).end('not found');
          return;
        }
        p = DIST_INDEX;
      }
      try {
        rsp.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
        rsp.end(read(p));
      } catch {
        rsp.writeHead(404).end('not found');
      }
    });
    // listen(0) 的随机端口可能撞 Chromium 不安全端口黑名单（ERR_UNSAFE_PORT
    // 假红——2026-10-07 实测分到过 5061、咬过一次 F3-01）⇒ 走安全 listen
    server = await listenOnSafePort(s, '/');
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  /** 建管理员身份（首启闸门 flow），返回 page */
  async function becomeAdmin(): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(server!.url);
    await page.waitForSelector('header', { timeout: 20000 });
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => (x.textContent ?? '').trim() === '我是管理员',
      );
      b?.click();
    });
    await page.waitForTimeout(400);
    await page.locator('input[placeholder="你的姓名"]').fill('探针甲');
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) =>
        (x.textContent ?? '').includes('确认为管理员'),
      );
      b?.click();
    });
    await page.waitForTimeout(1000);
    return { ctx, page };
  }

  /** 侧栏项目条数（展开态 data-sidebar-project-list 的 li；收起态短标方块） */
  async function sidebarProjectCounts(page: Page): Promise<{ list: number; collapsed: number }> {
    return page.evaluate(() => ({
      list: document.querySelectorAll('[data-sidebar-project-list] li').length,
      collapsed: document.querySelectorAll('[data-project-short-label]').length,
    }));
  }

  it('F3-01 · 退出身份：展开态与收起态的侧栏项目全部消失（f4acee0 的回归位）', async () => {
    const { ctx, page } = await becomeAdmin();
    try {
      /*
       * 载入示例项目：走首启引导卡的行业卡（与 loadDemo 同一条覆盖导入 +
       * reload 链路），**不**走侧栏那枚按钮——它自 0.8.6.0002 起受
       * sample-projects 插件开关门控（默认停用 ⇒ 新库侧栏里根本不渲染），
       * 点它等于把本用例绑死在插件默认态上。引导卡无插件门控。
       * 新 context 空库 ⇒ 欢迎卡必弹，这里等卡可见再点。
       */
      const card = page.locator('[data-first-run-card="indoor"]');
      await card.first().waitFor({ state: 'visible', timeout: 10000 });
      await card.first().click();
      await page.waitForTimeout(400);
      await page.locator('button', { hasText: '确认载入' }).first().click();
      // 覆盖导入后 useBackupIo 触发 window.location.reload()，等重新装载
      await page.waitForFunction((name) => document.body.innerText.includes(name), DEMO_PROJECT, {
        timeout: 20000,
      });
      await page.waitForTimeout(600);

      /*
       * 重新进入身份：示例导入整库替换 members 后，此前手工建立的管理员
       * （m-xxx）已不在库里，localStorage 里的 currentMemberId 失效 ⇒ 应用
       * 停在「还未进入身份」态（这正是 2ec2d3c 修的空态本身）。用演示数据
       * 里的真实成员「演示负责人」走 name_input 流程进入。
       */
      await page.locator('button', { hasText: '点击进入' }).first().click();
      await page.waitForTimeout(400);
      await page.locator('input[placeholder="你的姓名"]').fill('演示负责人');
      await page.locator('button', { hasText: '下一步' }).first().click();
      await page.waitForTimeout(800);

      // ── 对照（有身份）：两态都有项目，断言才有判别力 ──
      const withId = await sidebarProjectCounts(page);
      expect(withId.list, '有身份时侧栏应列出示例项目（空库 ⇒ 后续断言 vacuous）').toBeGreaterThan(0);

      // 收起侧栏 → 收起态 3 枚项目方块应在
      await page.locator('button[aria-label="收起侧边栏"]').first().click();
      await page.waitForTimeout(400);
      const collapsedWithId = await sidebarProjectCounts(page);
      expect(collapsedWithId.collapsed, '有身份时收起态应有项目方块（f4acee0 之前的对照面）').toBeGreaterThan(0);

      // 展开回来 → 退出身份（顶栏身份菜单 → 退出身份）
      await page.locator('button[aria-label="展开侧边栏"]').first().click();
      await page.waitForTimeout(300);
      await page.locator('button[title="当前身份（点击切换/退出）"]').first().click();
      await page.waitForTimeout(300);
      await page.locator('button', { hasText: '退出身份' }).first().click();
      await page.waitForTimeout(800);

      // ── 修复面①：展开态无项目 ──
      const afterExit = await sidebarProjectCounts(page);
      expect(afterExit.list, '退出身份后展开态仍渲染项目列表（反馈 #3 复发）').toBe(0);
      const sideText = await page.locator('[data-app-sidebar]').first().innerText();
      expect(sideText, '退出身份后侧栏文本里仍出现演示项目名').not.toContain(DEMO_PROJECT);
      expect(sideText).not.toContain('查看全部');

      // ── 修复面②：收起态无项目方块（f4acee0 的门控；610 行一带） ──
      await page.locator('button[aria-label="收起侧边栏"]').first().click();
      await page.waitForTimeout(400);
      const collapsedAfterExit = await sidebarProjectCounts(page);
      expect(
        collapsedAfterExit.collapsed,
        '退出身份后收起态仍渲染项目方块（f4acee0 之前漏门的另一半）',
      ).toBe(0);
      const railText = await page.locator('[data-app-sidebar]').first().innerText();
      expect(railText, '退出身份后收起态侧栏仍出现演示项目名').not.toContain(DEMO_PROJECT);

      // 侧栏不得残留指向 /project/ 的可点链接（标题 tooltip 也算可见信息）
      const projectLinks = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('[data-app-sidebar] a[href^="/project/"]')).length,
      );
      expect(projectLinks, '退出身份后侧栏仍有项目链接').toBe(0);
    } finally {
      await ctx.close();
    }
  }, 90000);
});
