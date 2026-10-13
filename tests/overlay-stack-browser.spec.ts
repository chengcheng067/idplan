// @vitest-environment node
/**
 * 浮层层级/遮罩交互模型 · **真 Chromium** 实测（F2 / F3 / F6）。
 *
 * ══════════════════ 为什么必须真浏览器 ══════════════════
 * 这三条的症状全都长在**层叠与命中测试**上，而 jsdom 两样都没有：
 *   · jsdom 不跑层叠（`z-index` 只是字符串），也**没有 hit-test**
 *     （`document.elementFromPoint` 不可用）⇒ 「遮罩有没有压住顶栏菜单」
 *     「点菜单项到底命中了谁」在 jsdom 里**无论对错都测不出来**。
 *   · 形态断言（"菜单带着 z-[79] 这个类"）只能证明声明在，证明不了它**赢**了。
 * 所以本文件用真构建产物 + 真 Chromium，判据一律取 `getComputedStyle` 的**实际
 * 生效值**与 `elementFromPoint` 的**实际命中元素**。
 *
 * ══════════════════ 三条各测什么 ══════════════════
 *   F3 · 一次 Esc 只关栈顶（设置抽屉 60 + 清空日志确认框 70）
 *        —— 修前：按一次 Esc，确认框**和**抽屉一起关（两层各挂一个 document keydown）。
 *   F2 · 顶栏 chrome 浮层永远在内容遮罩之上（设置抽屉开着时点身份头像）
 *        —— 修前是条**死路**：菜单确实打开了，但被 60 档遮罩压住；点「切换身份」
 *           命中的是遮罩的点击捕获层 ⇒ **抽屉被关掉、身份却没换**。用户想切身份，
 *           得到的是"抽屉关了"。
 *   F6 · ① 右侧阶段抽屉（60）压上来时侧栏必须被压住（修前侧栏 z-61 浮在它上面，
 *          不被压暗、还能点 ⇒ 点另一个项目就换页，抽屉内容错位）
 *        ② 打开阶段抽屉后路由离开，再进**另一个**项目详情页不得自动弹出抽屉
 *          （修前 StageDrawer 按新 projectId 收窄后渲染「该阶段不存在或已被移除」）
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
 * （它内部带 `warnStaleOnce`）。
 *
 * ⚠️ 本文件原先内联了一份语义相同、**但没有告警**的复制体 ⇒ 产物过期时它**静默 skip**。
 *    2026-10-13 那次「让跳过出声」只覆盖了 import 共享助手的文件；内联复制的那批漏了。
 *    ⇒ 改为 import。判据本身没变（候选集与 mtime 比法逐字核对过）。
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

const SETTINGS_DRAWER = '[data-settings-drawer]';
const CONFIRM_CLEAR = '[role="dialog"][aria-label="清空日志"]';
const IDENTITY_MENU = '[role="menu"][aria-label="身份操作"]';
const AVATAR = 'button[title="当前身份（点击切换/退出）"]';
const STAGE_DRAWER = '[role="dialog"][aria-label^="阶段详情"]';

describe.skipIf(!CAN_RUN_FRESH)('浮层层级 / 遮罩交互模型 · 真 Chromium（F2 / F3 / F6）', () => {
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

  /** 真鼠标点侧栏「设置」（取可见的那枚） */
  async function clickSidebarSettings(page: Page): Promise<void> {
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
    await page.waitForTimeout(500);
  }

  /** 载入示例数据（5 个项目 + 阶段）——「示例项目」是插件开关控制的，先打开它 */
  async function loadDemo(page: Page): Promise<void> {
    // ① 设置 → 插件 → 启用「示例项目」（入口受插件开关门控，见 Sidebar.tsx 的 sampleProjectsOn）
    await clickSidebarSettings(page);
    await page.click('[data-settings-zone="plugins"]');
    await page.waitForTimeout(300);
    const toggle = page.locator('[data-plugin-toggle="sample-projects"]');
    expect(await toggle.count(), '插件区应有「示例项目」开关').toBeGreaterThan(0);
    if ((await toggle.first().getAttribute('aria-checked')) !== 'true') {
      await toggle.first().click();
      await page.waitForTimeout(600);
    }
    // ② 关掉设置（此刻栈顶就是它，Esc 一下即可）
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // ③ 侧栏底部点「载入示例项目」→ 它走**覆盖式导入的二次确认**（ConfirmDialog）
    const ok = await clickText(page, '载入示例项目');
    expect(ok, '侧栏应有「载入示例项目」入口（管理员 + 插件已启用）').toBe(true);
    await page.waitForSelector('[role="dialog"][aria-label="载入示例项目"]', { timeout: 5000 });
    expect(await clickText(page, '确认载入'), '确认框应有「确认载入」').toBe(true);
    await page.waitForTimeout(3000);
    // 首页应出现演示项目卡（前置：数据确实落库了，否则后续断言空转成假绿）
    const hasProject = await page.evaluate(() =>
      (document.body.textContent ?? '').includes('演示项目1'),
    );
    expect(hasProject, '示例数据应已落库并出现在首页').toBe(true);

    /*
     * ④ 确认身份已重新建立。
     *
     * 这一步的**意图没变**：示例包是覆盖式导入，它把 members 整表换掉，刚才那个
     * 「严过关」管理员随之不存在；必须确认身份已回到「示例包里的管理员」，
     * 否则详情页只会显示「请先到左侧导航最下方进入身份」，后面所有步骤都会在
     * 一片空页面上"通过"——那是标准的假绿。
     *
     * ⚠️ 订正（2026-10-14）：**机制变了**，原来的写法（点「点击进入」→ 输姓名
     *    「负责人甲」→ 下一步）建立在「覆盖导入后身份为空」这个前提上，
     *    而那个前提已经**有意地**被移除了：
     *      · demo 包自带 `settings.currentMemberId = 'demo_admin'`，而 `demo_admin`
     *        就是本包 members 里的「负责人甲」（`demoDataFactory.ts` 登记为
     *        「demo 成员表的身份兜底」，属数据集自身语义）；
     *      · `useRepos.bootstrapAllStores` 的身份候选阶梯（`9dd3d77` 引入，每一档
     *        必须**命中当前 members**）让这条兜底**真的生效** ⇒ 覆盖式导入后
     *        **不再静默掉身份**，而是自动进入「负责人甲」。
     *    ⇒ 导入后页面上**根本没有**「点击进入」（旧写法在这里 30s 超时，实测可复现）。
     *    归因已用 A/B 切片确认：把身份阶梯变异回 `9dd3d77` 之前 ⇒ 导入后身份不再
     *    兜底成负责人甲（详见 tests/settings-zones.spec.ts 的 becomeMember 订正说明，
     *    同一根因、同一取证）。**这是前置的假设过期，不是产品回归。**
     *
     * 现在这一步反而**更强**：不再只是「有头像就算进去了」（AVATAR 计数只看"有身份"），
     * 而是先钉住**进去的是谁**——必须正是示例包的管理员「负责人甲」。名字与被替换掉的
     * 那段 `fill('负责人甲')` 逐字相同 ⇒ 目标身份没有变，只是不再需要人工输入。
     */
    await page.waitForFunction(() => document.body.innerText.includes('负责人甲'), undefined, {
      timeout: 8000,
    });
    expect(
      await page.evaluate(() => (document.body.textContent ?? '').includes('负责人甲')),
      '导入后身份应自动回到示例包的管理员「负责人甲」（不再是「点击进入」空态）',
    ).toBe(true);
    expect(
      await page.locator(AVATAR).count(),
      '应以示例包里的管理员身份进入（否则后续全在空页面上跑）',
    ).toBeGreaterThan(0);
  }

  /**
   * 点第 n 个阶段行打开阶段抽屉。
   * 阶段行的判据取源码里的**内联样式**（`height:44; margin-bottom:8`，
   * 见 StageRowsColumn.tsx）—— 找不到就当场炸，不让后续断言空转成假绿。
   */
  async function openStageDrawer(page: Page, nth = 0): Promise<void> {
    const point = await page.evaluate((i) => {
      const rows = Array.from(document.querySelectorAll('button')).filter((b) => {
        const s = b.getAttribute('style') ?? '';
        return s.includes('height: 44px') && s.includes('margin-bottom: 8px');
      });
      const row = rows[i];
      if (!row) return null;
      const r = row.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, total: rows.length };
    }, nth);
    if (!point) throw new Error('找不到阶段行（前置：已在项目详情页且时间轴已渲染）');
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(600);
  }

  /** 按可见文案点**顶栏内**的按钮（顶栏在遮罩顶缘之上，是「抽屉开着时仍可操作」的唯一出口） */
  async function clickHeaderText(page: Page, text: string): Promise<boolean> {
    const point = await page.evaluate((t) => {
      const header = document.querySelector('header');
      if (!header) return null;
      const b = Array.from(header.querySelectorAll('button')).find(
        (x) => (x.textContent ?? '').trim() === t,
      );
      if (!b) return null;
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, text);
    if (!point) return false;
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(600);
    return true;
  }

  async function pathname(page: Page): Promise<string> {
    return page.evaluate(() => window.location.pathname);
  }

  /** 进入指定项目的详情页（从首页点卡片名） */
  async function openProjectByName(page: Page, name: string): Promise<void> {
    const point = await page.evaluate((n) => {
      const el = Array.from(document.querySelectorAll('*')).find(
        (x) => x.children.length === 0 && (x.textContent ?? '').trim() === n,
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, name);
    expect(point, `首页应有项目卡「${name}」`).not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
    await page.waitForTimeout(900);
  }

  /* ==================================================================================
   * F3 · 一次 Esc 只关栈顶
   * ================================================================================== */
  it('F3：设置抽屉里开确认框，按一次 Esc 只关确认框，抽屉仍存活；再按一次才关抽屉', async () => {
    const { ctx, page } = await open(1440, 900);
    try {
      await becomeAdmin(page);
      await clickSidebarSettings(page);
      expect(await page.locator(SETTINGS_DRAWER).count(), '设置抽屉应打开').toBeGreaterThan(0);

      // 切到「数据与备份」——「清空日志」在这个分区里
      await page.click('[data-settings-zone="data"]');
      await page.waitForTimeout(300);
      expect(await clickText(page, '清空日志'), '数据区应有「清空日志」').toBe(true);
      await page.waitForSelector(CONFIRM_CLEAR, { timeout: 5000 });
      expect(await page.locator(CONFIRM_CLEAR).count()).toBe(1);

      // —— 按一次 Esc ——
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600); // center 档出口动画 200ms + 余量
      expect(
        await page.locator(CONFIRM_CLEAR).count(),
        '第一次 Esc 应关掉栈顶（确认框）',
      ).toBe(0);
      expect(
        await page.locator(SETTINGS_DRAWER).count(),
        '★ 第一次 Esc 之后下层的设置抽屉必须**仍存活** —— 修前这里会跟着一起关掉（F3）',
      ).toBeGreaterThan(0);

      // —— 再按一次 Esc：这次轮到抽屉 ——
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600); // drawer-out-left 200ms + 余量
      expect(await page.locator(SETTINGS_DRAWER).count(), '第二次 Esc 才关掉下层抽屉').toBe(0);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  /* ==================================================================================
   * F2 · 顶栏 chrome 浮层在内容遮罩之上（本条修前是**死路**）
   * ================================================================================== */
  it('F2：设置抽屉开着时点身份头像 → 菜单在最上层、点「切换身份」真的换了身份且抽屉仍开着', async () => {
    const { ctx, page } = await open(1440, 900);
    try {
      await becomeAdmin(page);
      await clickSidebarSettings(page);
      expect(await page.locator(SETTINGS_DRAWER).count()).toBeGreaterThan(0);

      // 点顶栏头像打开身份菜单（顶栏在遮罩顶缘之上，本来就点得到 —— 菜单也确实"打开"了）
      await page.click(AVATAR);
      await page.waitForSelector(IDENTITY_MENU, { timeout: 5000 });

      /*
       * 四项证据**分别采集、最后一起断言**。
       *
       * 为什么不写成「一条断言不满足就抛」的串行形状：F2 是一整条**死路**，
       * 它的价值在于把四个环节**一次说全**（菜单开了→被压住→点不到→抽屉被关且
       * 身份没换）。串行形状只会在第一个环节就断掉，剩下的环节永远没人看见 ——
       * 而"改前到底坏成什么样"正是这条用例要留档的东西（反面对照）。
       */
      const zs = await page.evaluate(
        ([menu, drawer]) => {
          const m = document.querySelector(menu) as HTMLElement | null;
          const overlay = document.querySelector(drawer) as HTMLElement | null;
          // 抽屉的 Modal 遮罩 = dialog 根节点（带 z 档类名的那个）
          const dlg = overlay?.closest('[role="dialog"]') as HTMLElement | null;
          const zOf = (el: HTMLElement | null): number =>
            el ? Number(window.getComputedStyle(el).zIndex || '0') : -1;
          return { menu: zOf(m), drawerOverlay: zOf(dlg) };
        },
        [IDENTITY_MENU, SETTINGS_DRAWER] as const,
      );

      // 命中测试：菜单中心点命中的到底是谁
      const hit = await page.evaluate((menu) => {
        const m = document.querySelector(menu) as HTMLElement;
        const r = m.getBoundingClientRect();
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { insideMenu: !!(el && m.contains(el)), tag: el?.tagName ?? null };
      }, IDENTITY_MENU);

      // 点「切换身份」（修前：这一步命中的是遮罩 ⇒ 抽屉被关掉、身份却没换）
      const clicked = await clickText(page, '切换身份');
      await page.waitForTimeout(700);

      const identityStillEntered = (await page.locator(AVATAR).count()) > 0;
      const drawerStillOpen = (await page.locator(SETTINGS_DRAWER).count()) > 0;

      /*
       * 四项证据用 `expect.soft` 断言 —— 一次跑完整条死路，而不是在第一个环节就断。
       * F2 的价值在于把四个环节**一次说全**（菜单开了 → 被遮罩压住 → 点不到 →
       * 抽屉被关且身份没换）；串行硬断言只会在第一环节抛出，剩下三环永远没人看见，
       * 而"改前到底坏成什么样"正是这条用例要留档的东西（反面对照）。
       * soft 不会放水：任一条不满足，用例照样红。
       */
      expect.soft(zs.drawerOverlay, '设置抽屉遮罩应有层叠档位（前置）').toBeGreaterThan(0);
      expect
        .soft(zs.menu, `身份菜单的 z（${zs.menu}）必须高于内容遮罩（${zs.drawerOverlay}）`)
        .toBeGreaterThan(zs.drawerOverlay);
      expect
        .soft(
          hit.insideMenu,
          `菜单中心的命中元素应是菜单自己（实际命中 ${hit.tag}）—— 修前这里是遮罩的点击捕获层`,
        )
        .toBe(true);
      expect.soft(clicked, '菜单里应有「切换身份」').toBe(true);
      expect
        .soft(
          identityStillEntered,
          '★ 身份必须真的被清掉（顶栏不该还是那个头像）—— 修前是"抽屉关了、身份没换"',
        )
        .toBe(false);
      expect
        .soft(drawerStillOpen, '★ 切身份不该把设置抽屉关掉 —— 修前它恰好被关掉了，这正是那条死路')
        .toBe(true);
      // 身份流程确实起来了（姓名输入框），不是"什么都没发生"
      expect.soft(await page.locator('input[placeholder="你的姓名"]').count()).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  /* ==================================================================================
   * F6 · ① 右抽屉压住侧栏 ② 阶段抽屉不跨路由残留
   * ================================================================================== */
  it('F6-①：右侧阶段抽屉压上来时侧栏被压住（点侧栏不换页）', async () => {
    const { ctx, page } = await open(1440, 900);
    try {
      await becomeAdmin(page);
      await loadDemo(page);
      await openProjectByName(page, '演示项目1');
      await openStageDrawer(page, 0);
      expect(await page.locator(STAGE_DRAWER).count(), '阶段抽屉应打开').toBe(1);

      const before = await pathname(page);
      expect(before).toMatch(/^\/project\//);

      /*
       * 证据 ①：命中测试 —— 侧栏里某个**项目导航项**的中心点必须**不再命中它自己**
       * （修前侧栏 z-61 浮在 60 档遮罩之上，命中就是它自己）。
       */
      const probe = await page.evaluate((current) => {
        const links = Array.from(
          document.querySelectorAll('[data-app-sidebar] a[href^="/project/"]'),
        ).filter((a) => !a.getAttribute('href')!.includes(current));
        const target = links.find((a) => {
          const r = a.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (!target) return null;
        const r = target.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const el = document.elementFromPoint(cx, cy);
        return {
          x: cx,
          y: cy,
          href: target.getAttribute('href'),
          hitsSelf: !!(el && (target === el || target.contains(el))),
          hitTag: el?.tagName ?? null,
        };
      }, before);
      expect(probe, '侧栏应有另一个项目的导航项（前置）').not.toBeNull();
      expect(
        probe!.hitsSelf,
        `侧栏项目项在多浮层下不该还可点（实际命中 ${probe!.hitTag}）—— 修前它是可点的`,
      ).toBe(false);

      // 真点它：不得换页
      await page.mouse.click(probe!.x, probe!.y);
      await page.waitForTimeout(700);
      expect(
        await pathname(page),
        '★ 点被遮罩压住的侧栏不得换页（修前会换到另一个项目）',
      ).toBe(before);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('F6-②：打开阶段抽屉后离开该项目，再进**另一个**项目详情页不得自动弹出抽屉', async () => {
    const { ctx, page } = await open(1440, 900);
    try {
      await becomeAdmin(page);
      await loadDemo(page);
      await openProjectByName(page, '演示项目1');
      const first = await pathname(page);
      expect(first, '应进到第一个项目的详情页').toMatch(/^\/project\//);
      await openStageDrawer(page, 0);
      expect(await page.locator(STAGE_DRAWER).count(), '阶段抽屉应打开').toBe(1);

      /*
       * 从**顶栏面包屑**离开（顶栏在遮罩顶缘之上，是抽屉开着时唯一仍可操作的出口）：
       * 面包屑那格是「← 我的项目 / <项目名>」—— 可点的是**「我的项目」**那个按钮
       * （`navigate('/')`），项目名只是它右邻的静态 span。只搜 header 内的按钮 ——
       * 侧栏里也有同名项目项，而它此刻正被遮罩压着，点它什么也不会发生
       * （那正是 F6-① 的结论，不要在这里混用）。
       */
      expect(
        await clickHeaderText(page, '我的项目'),
        '顶栏面包屑应有「我的项目」回跳按钮',
      ).toBe(true);
      await page.waitForTimeout(700);
      expect(await pathname(page), '面包屑应回到首页').toBe('/');

      // 进**另一个**项目的详情页
      await openProjectByName(page, '演示项目2');
      const other = await pathname(page);
      expect(other, '应进到另一个项目的详情页').toMatch(/^\/project\//);
      expect(other, '必须确实换到了另一个项目（否则这条什么也没测）').not.toBe(first);

      /*
       * ★ 关掉的那个抽屉**不得**自己冒出来。
       * 修前这里会出现一个 `[role="dialog"]`：要么是那个阶段（若是同一项目），
       * 要么是「该阶段不存在或已被移除」——两种都不该发生。
       */
      expect(
        await page.locator(STAGE_DRAWER).count(),
        '★ 换项目后不该自动弹出阶段抽屉（修前会渲染"该阶段不存在或已被移除"）',
      ).toBe(0);
      const errText = await page.evaluate(() =>
        document.body.textContent?.includes('该阶段不存在或已被移除') ?? false,
      );
      expect(errText, '那句错误提示已从渲染路径上退役').toBe(false);
    } finally {
      await ctx.close();
    }
  }, HEAVY);
});
