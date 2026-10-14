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
import { staleInputs } from './helpers/board-env';

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
 * 产物新鲜度门控（R12 假绿教训）：真浏览器 spec 测的是 `build-dist/`，
 * 而 `npm test` 不重建。src 比产物新 ⇒ 本 spec 断言的是**旧代码**——改坏了也能全绿。
 *
 * ── ★ 口径订正（2026-10-14）：这里**有意扩大**了监视面，不是修一个笔误 ──
 * 本文件原先自带一份 `buildIsStale()`，它的判据比同族**窄**：
 *   · 只看 `src/**` 的 5 种扩展名（`.ts/.tsx/.css/.html/.json`）+ `tailwind.config.ts` + `index.html`；
 *   · **不看** `vite.config.ts`、**不看** `postcss.config.js`、**不看** `electron/**`，
 *     且对 `src/**` 里其它后缀（`.svg`/`.md` 等）也**不看**。
 * ⇒ 后果是**真的、且是静默的**：只改 `vite.config.ts`（构建行为本身，例如 alias / 插件 / 目标）
 *   再跑本 spec，它会**在旧产物上「真跑」**并给出结论 —— 那是「拿上一版界面下结论」，
 *   可能假红也可能假绿。同族其余 spec 用的是下面的共享口径，它们会正确 skip。
 *
 * 现在改为**全族唯一出处** `tests/helpers/board-env.ts` 的 `staleInputs()`：
 *   · **新增监视**：`vite.config.ts`、`postcss.config.js`、`electron/**`；
 *   · `src/**` 不再按扩展名过滤（与共享实现一致，任何文件都算输入）。
 * 扩大监视面的**代价**是多 skip 几次；而它**不再等于静默**——共享实现带
 * `warnStaleOnce`，过期时会打印「哪些输入比产物新 + 先 npm run build」。
 * （窄判据的失效方式是「在可能过期的产物上真跑」，那是**静默的错误结果**；这个方向的取舍
 *   已由 team-lead 2026-10-14 拍板接受。）
 */
const CAN_RUN_FRESH = CAN_RUN && staleInputs().length === 0;

/** 演示数据里的一个项目名（demoDataFactory.ts 的 preset 名，用于等待导入生效） */
const DEMO_PROJECT = '演示项目1';

describe.skipIf(!CAN_RUN_FRESH)('F3-BROWSER · 退出身份后侧栏不显示项目（真 Chromium）', () => {
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
    // ⚠️ 静默前置扫雷批（2026-10-14）：这两下必须**断言存在再点**。
    //    旧写法 `b?.click()` 点空时，本函数紧接着就 `return { ctx, page }`（**后续没有任何校验**）
    //    ⇒ 身份没建立也不会红，用例会带着"未进入身份"的页面继续跑 —— 那是**假绿**。
    const clickedAdminEntry = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => (x.textContent ?? '').trim() === '我是管理员',
      );
      if (!b) return false;
      b.click();
      return true;
    });
    expect(
      clickedAdminEntry,
      '身份流程里找不到「我是管理员」按钮（旧写法静默点空 ⇒ 本函数随后直接 return，用例会在"未进入身份"下继续跑）',
    ).toBe(true);
    await page.waitForTimeout(400);
    await page.locator('input[data-identity-name-input]').fill('探针甲');
    const clickedAdminConfirm = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) =>
        (x.textContent ?? '').includes('确认为管理员'),
      );
      if (!b) return false;
      b.click();
      return true;
    });
    expect(
      clickedAdminConfirm,
      '身份流程里找不到「确认为管理员」按钮（旧写法静默点空 ⇒ 身份未建立而本函数直接 return，用例假绿）',
    ).toBe(true);
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
       * 重新建立身份 —— ⚠️ 订正（2026-10-14）：本段原先点「点击进入」→ 走 name_input 填
       * 「负责人甲」，前提是「示例导入整库替换 members 后停在『未进入身份』态」。
       * **那条前提已经被有意移除**：demo 包自带 `settings.currentMemberId='demo_admin'`
       * （= 本包 members 里的「负责人甲」），而 `useRepos.bootstrapAllStores` 的身份候选
       * 阶梯（`9dd3d77`，每一档必须命中当前 members）让这条兜底真的生效
       * ⇒ 导入后**身份已被自动建立为「负责人甲」**，页面上**没有**「点击进入」可点
       *（旧写法在这里 30s 超时，且失败信息长得像「侧栏坏了」，方向是错的）。
       * ⇒ 现在改成**自检身份已建立**：目标身份没变（仍是示例包的管理员），只是不再需要人工输入。
       */
      await page.waitForFunction(
        () => (document.body.textContent ?? '').includes('负责人甲'),
        undefined,
        { timeout: 15000 },
      );
      await page.waitForTimeout(400);

      // ── 对照（有身份）：两态都有项目，断言才有判别力 ──
      const withId = await sidebarProjectCounts(page);
      expect(withId.list, '有身份时侧栏应列出示例项目（空库 ⇒ 后续断言 vacuous）').toBeGreaterThan(0);

      // 收起侧栏 → 收起态 3 枚项目方块应在
      await page.locator('[data-sidebar-collapse-toggle]').first().click();
      await page.waitForTimeout(400);
      const collapsedWithId = await sidebarProjectCounts(page);
      expect(collapsedWithId.collapsed, '有身份时收起态应有项目方块（f4acee0 之前的对照面）').toBeGreaterThan(0);

      // 展开回来 → 退出身份（侧栏左下角身份行 → 退出身份；2026-10-12 前入口在顶栏）
      await page.locator('[data-sidebar-collapse-toggle]').first().click();
      await page.waitForTimeout(300);
      await page.locator('button[data-identity-trigger]').first().click();
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
      await page.locator('[data-sidebar-collapse-toggle]').first().click();
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
