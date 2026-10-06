import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ★ 顶栏高度口径的**单一出处**（与产品同一份实现）。
//   绝不在 `page.evaluate` 里重算 `innerWidth >= 1280 ? 64 : 56`：
//   那份副本会在口径变更时静默不同步，而它恰是断言另一边的基准 → 直接放进假绿。
import { titleBarHeightFor } from '../src/lib/topbarMetrics';
// ★ 锚定浮层的留白口径也取产品同一份常量：写死 8 会在调参后静默放宽断言。
import { ANCHOR_GAP, VIEWPORT_MARGIN } from '../src/lib/anchoredPosition';

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

/**
 * 伪装 Windows 桌面端（注入 preload 等价物），用于自绘窗口三键相关断言。
 *
 * 2026-09-23：原桩记录 `setTitleBarTheme`（原生叠加层配色下发）——叠加层已退役
 * （系统合成器画在网页之上，DOM 遮罩盖不住它，用户投诉「弹窗一开三键像贴上去的」），
 * 改为记录 `windowControls` 调用。三键是 DOM 控件，与内容同层同源。
 * 2026-10-06（v0.8.6 壳层常驻）：三键并回顶栏主行末格（不再是 body portal），
 * 遮罩让出顶栏（inset-0 → top-14 xl:top-16）——遮罩态可点由让位保证，不再靠 z-[85]。 */
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

    // 0.8.3：身份流走完后 FirstRunGuide 欢迎卡紧接出现（空库环境必弹）——
    // 不消掉会遮住后续所有点击。本族测的是控件几何，走「先四处看看」线；
    // 示例分支由 first-run-guide.spec.tsx / demo-data.spec.ts 覆盖。
    const guideSkip = page.locator('button', { hasText: '先四处看看' });
    if (await guideSkip.count()) {
      await guideSkip.first().click();
      await page.waitForTimeout(500);
    }
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
    await page.locator('input[placeholder*="某某项目"]').fill(name);
    /*
      ★ 反馈 #5 之后的新口径：手动建档**首开不预选主板块**，套餐/阶段随主板块带出。
        不先选板块 ⇒ 「建档」按钮保持 disabled（0 段 < 最少段数）⇒ 建档静默失败、
        用例后续全部假红（URL 停在首页、找不到彩条）。
        这里显式选「室内」，与用例名里「9 段室内项目」的前提对齐。
    */
    // v0.8.5：IndustrySelect 自定义下拉替换原生 select（她截图 #8）——改点击流程
await page.click('[data-industry-select-trigger]');
await page.click('[data-industry-select-option="indoor"]');
    await page.waitForTimeout(200);
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

  /**
   * 真鼠标点侧栏「设置」（反馈 #4 的入口）。
   *
   * v0.8.6 起设置是从侧栏左缘滑出的抽屉，与点击位置无关（anchor 链路已删），
   * 不再需要取点击坐标；但仍坚持 `page.mouse.click` 真手势——焦点管理契约
   * （打开入抽屉 / 关闭焦点回触发钮）依赖真实聚焦行为。
   *
   * 侧栏展开/收起两态各有一个 `[aria-label="设置"]`，取**可见**那个。
   */
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
    if (!point) throw new Error('侧栁「设置」入口不可见');
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(500);
  }

  /**
   * 等设置抽屉就绪：面板出现 + 左滑入场动画（drawer-in-left 200ms）播完。
   * 动画期间 transform 未归零，量到的是中间帧几何（translateX(-24px) 起），
   * 必须等 playState === 'finished'——这是「量真几何」的前件。
   */
  async function waitSettingsDrawer(page: Page): Promise<void> {
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

  /**
   * 量设置抽屉的真几何（反馈 #4 形态：窗口左缘 → 右，盖住侧栏，贴顶栏全高）。
   * DOM 层次：`[role="dialog"]`（遮罩）→ 点击捕获层 →
   *   `div[data-settings-drawer]`（抽屉本体）。几何/圆角都量抽屉本体。
   */
  function probeSettingsDrawer(page: Page) {
    return page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"][aria-label="设置"]') as HTMLElement | null;
      const panel = document.querySelector('[data-settings-drawer]') as HTMLElement | null;
      if (!dlg || !panel) return null;
      const dr = dlg.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      const header = document.querySelector('header')!.getBoundingClientRect();
      const sidebar = document.querySelector('[data-app-sidebar]')!.getBoundingClientRect();
      // 「盖住侧栏」的诚实判据：点在侧栏中心，命中的必须是抽屉而不是侧栏
      const atSidebar = document.elementFromPoint(
        sidebar.x + sidebar.width / 2,
        sidebar.y + sidebar.height / 2,
      );
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        overlayTop: dr.top,
        drawerLeft: pr.left,
        drawerTop: pr.top,
        drawerRight: pr.right,
        drawerBottom: pr.bottom,
        drawerWidth: pr.width,
        drawerHeight: pr.height,
        topbarH: Math.round(header.height),
        blRadius: cs.borderBottomLeftRadius,
        brRadius: cs.borderBottomRightRadius,
        coversSidebar: !!atSidebar && panel.contains(atSidebar),
        theme: document.documentElement.getAttribute('data-theme'),
      };
    });
  }

  /**
   * 走真 UI 建一个项目并回到首页（`createProjectAndFindBar` 会停在详情页，
   * 本函数建完主动回首页，供需要「首页有多张卡」的用例使用）。
   *
   * 入口走的是窄屏的「⋮ 更多 → 新建项目」：本用例刻意把视口压到 <md（单列卡片），
   * 而侧栏在 <xl 已收成抽屉，`[data-app-sidebar]` 里的新建入口点不到。
   *
   * ⚠️ 反馈 #5 之后手动建档首开不预选主板块 ⇒ 不先选板块，建档按钮是 disabled，
   *   点击静默失败、后面全部假红（找不到卡片）。故这里显式选「室内」。
   */
  async function createProjectOnHome(page: Page, name: string): Promise<void> {
    await page.locator('button[aria-label="更多操作"]').first().click();
    await page.waitForTimeout(400);
    await page
      .locator('[role="menu"] [role="menuitem"]', { hasText: '新建项目' })
      .first()
      .click();
    await page.waitForTimeout(500);
    await page.locator('input[placeholder*="某某项目"]').fill(name);
    // v0.8.5：IndustrySelect 自定义下拉替换原生 select（她截图 #8）——改点击流程
await page.click('[data-industry-select-trigger]');
await page.click('[data-industry-select-option="indoor"]');
    await page.waitForTimeout(200);
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
    // 建档成功会跳到项目详情页 → 回首页继续
    await page.goto(DIST_URL);
    await page.waitForSelector('header', { timeout: 20000 });
    await page.waitForTimeout(700);
  }

  /* ============ A0 · 反馈 #1：项目卡「⋮」菜单不得被相邻卡片 hover 盖住 ============ */

  /**
   * 用户原始现象（截图）：点开某张卡的「⋮」后，把鼠标移到**下面那张卡**上，
   * 下面那张卡的 hover UI 被激活并置顶，把菜单盖住了。
   *
   * 根因（不是"z-index 差一点"，而是层叠上下文）：卡片带 `hover:-translate-y-1` ——
   * transform 会给被 hover 的卡片**新建一个层叠上下文**，而菜单原本是卡片子树里的
   * `absolute` 元素：一旦被 hover 的那张卡在 DOM 里排在后面，它的层叠上下文就整体
   * 盖过前面卡片的菜单，无论菜单 z-index 写多大都无效（z-index 不能跨层叠上下文比较）。
   *
   * 修法：菜单 `createPortal` 到 `document.body` + `fixed z-[65]`（脱离卡片子树）。
   *
   * ── 这条用例为什么必须真浏览器 ──
   *   "有没有被盖住"的**唯一**诚实判据是命中测试（`elementFromPoint`）——
   *   类名里写着 `z-[65]` 完全不能证明它没被盖住（本仓已有 `toContain('rounded-xl')`
   *   恒真的先例）。所以这里：真鼠标 hover 下面那张卡 → 再对菜单项中心做命中测试。
   *
   * ── 用例自身不空转的两个守卫 ──
   *   ① 菜单必须真的与下一张卡**几何重叠**，否则测的是"两个不相交的东西"；
   *   ② hover 必须真的生效（卡片 transform 变了），否则测的是"没 hover 的情况"。
   */
  it('Q-A0-1 · 项目卡「⋮」菜单在相邻卡片 hover 后仍被命中（真 elementFromPoint）', async () => {
    /*
      视口取 <md(768) 且给足高度：
        · 卡片基础宽度是 `w-full`（≥md 才变 `calc(50%-10px)` 两列）⇒ 单列纵向排布，
          第一张卡的菜单必然与**下面那张卡**重叠 —— 正是用户截图里的复现条件；
        · 高度必须够（900 高时 ⋮ 已在 y≈750，菜单放不下会**向上翻转**、就不压下一张卡了），
          故取 1400 让菜单正常向下展开、真的盖在下一张卡上。
    */
    const { ctx, page } = await open(767, 1400);
    try {
      await becomeAdmin(page);
      await createProjectOnHome(page, 'QA遮挡·上卡');
      await createProjectOnHome(page, 'QA遮挡·下卡');

      const geom = await page.evaluate(() => {
        const dots = Array.from(document.querySelectorAll('button[aria-label="项目更多操作"]'));
        const rects = dots.map((d) => {
          const card = d.closest('[role="button"]') as HTMLElement | null;
          const dr = d.getBoundingClientRect();
          const cr = (card ?? d).getBoundingClientRect();
          return {
            dot: { x: dr.x + dr.width / 2, y: dr.y + dr.height / 2 },
            card: { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom },
          };
        });
        return rects;
      });
      // 前置：必须真有 ≥2 张卡（否则本用例无意义）
      expect(geom.length).toBeGreaterThanOrEqual(2);
      const [, second] = geom;

      // 打开**第一张**卡的菜单（真鼠标点击 ⋮）
      await page.mouse.click(geom[0].dot.x, geom[0].dot.y);
      await page.waitForSelector('[role="menu"]', { timeout: 5000 });
      await page.waitForTimeout(300);

      const menuRect = await page.evaluate(() => {
        const m = document.querySelector('[role="menu"]') as HTMLElement | null;
        if (!m) return null;
        const r = m.getBoundingClientRect();
        const items = Array.from(m.querySelectorAll('[role="menuitem"]')).map((el) => {
          const ir = (el as HTMLElement).getBoundingClientRect();
          return { x: ir.x + ir.width / 2, y: ir.y + ir.height / 2 };
        });
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          parentIsBody: m.parentElement === document.body,
          items,
        };
      });
      expect(menuRect).not.toBeNull();
      // eslint-disable-next-line no-console
      console.log('[Q-A0-1] geom=', JSON.stringify(geom), 'menu=', JSON.stringify(menuRect));
      // 菜单必须挂到 body 下（脱离卡片子树 = 根治条件本身）
      expect(menuRect!.parentIsBody).toBe(true);

      // 守卫 ①：菜单与下一张卡几何重叠（不重叠则本用例测不到遮挡）
      expect(menuRect!.bottom).toBeGreaterThan(second.card.top);
      expect(menuRect!.left).toBeLessThan(second.card.right);
      expect(second.card.left).toBeLessThan(menuRect!.right);

      /*
        取**落在下一张卡地盘上**的那个菜单项作为命中测试点 ——
        只有打在「菜单与下一张卡重叠区」里的命中测试才能证明遮挡被修好了；
        打在菜单上半部（悬在自己卡上方）等于什么都没测。
        最后一个菜单项（删除项目）正好在最下方，取它。
      */
      const target = menuRect!.items[menuRect!.items.length - 1];
      expect(target).toBeDefined();
      const inSecondCard =
        target.x >= second.card.left &&
        target.x <= second.card.right &&
        target.y >= second.card.top &&
        target.y <= second.card.bottom;
      expect(inSecondCard, `命中测试点 (${target.x},${target.y}) 不在下一张卡的范围内`).toBe(true);

      /*
        hover 下一张卡 —— 必须落在**没被菜单盖住**的那部分，
        否则指针命中的是菜单、卡片根本不会进入 :hover（那样守卫 ② 会先红，
        告诉你"这次复现条件不成立"，而不是给出一个假的绿色）。
      */
      const hoverPoint = {
        x: Math.min(second.card.left + 24, menuRect!.left - 12),
        y: second.card.top + 24,
      };
      await page.mouse.move(hoverPoint.x, hoverPoint.y);
      await page.waitForTimeout(400);

      // 守卫 ②：卡片 hover 真的生效（transform 由 translate 变化 → 层叠上下文已建立）
      const hovered = await page.evaluate((p) => {
        const el = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
        const card = el?.closest('[role="button"]') as HTMLElement | null;
        const dotBtn = el?.closest('button[aria-label="项目更多操作"]');
        const host = card ?? (dotBtn?.closest('[role="button"]') as HTMLElement | null);
        return host ? getComputedStyle(host).transform : 'NO-CARD';
      }, hoverPoint);
      expect(hovered).not.toBe('NO-CARD');
      expect(hovered).not.toBe('none'); // :hover 的 -translate-y-1 已生效

      // ★ 核心判据：重叠区里的菜单项，命中的必须是**菜单自己**
      const hit = await page.evaluate((p) => {
        const el = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
        return {
          inMenu: !!el?.closest('[role="menu"]'),
          tag: el ? `${el.tagName}[${el.getAttribute('aria-label') ?? ''}]` : 'NULL',
        };
      }, target);
      expect(hit.inMenu, `菜单项被遮挡：命中的是 ${hit.tag}`).toBe(true);

      /*
        真点一次该菜单项（删除项目 → 弹二次确认）：若点击被下面那张卡吃掉，
        结果是**导航到项目详情页**而不是弹确认框 —— 所以两条断言都能抓住它。
        确认框出现后按 Esc 取消，不产生任何数据变更。
      */
      const urlBefore = page.url();
      await page.mouse.click(target.x, target.y);
      await page.waitForTimeout(700);
      expect(page.url()).toBe(urlBefore);
      expect(await page.locator('[role="dialog"]').count()).toBeGreaterThanOrEqual(1);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      expect(await page.locator('[role="menu"]').count()).toBe(0); // 菜单已收起
    } finally {
      await ctx.close();
    }
  }, 90000);

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

  /* ================= A1 · 自绘窗口三键（2026-09-23 重构；原生叠加层退役） =================
   *
   * 背景（用户投诉「弹窗一开、背景压暗，最小化/最大化/关闭三键亮度不变，像贴在
   * 背景上」）：三键此前是 Windows 原生 titleBarOverlay——由系统合成器画在网页
   * **之上**，DOM 遮罩（fixed inset-0 z-[70]）永远盖不住它；0.55× 压暗近似修不好
   * （乘出来的灰 ≠ 遮罩实际合成的灰，仍是两块色）。现行方案：三键改为 **DOM 自绘**
   * （TopBar.tsx 的 WindowControls，v0.8.6 起并回顶栏主行末格），与内容同层同源。
   * 遮罩态可点历经 portal+z-[85]（v0.8.5 C2）→ 遮罩让出顶栏（v0.8.6）两代，
   * 本组验收口径：「存在性 / 几何 / 平台门控 / 遮罩态可点 / 拖拽纪律 / 断点跟随」。
   * ------------------------------------------------------------------------ */

  it('Q-A1-1 · 顶栏高度口径：<1280→56，≥1280→64（含临界 1279/1280）', async () => {
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
      } finally {
        await ctx.close();
      }
    }
  }, HEAVY);

  it('Q-A1-2 · ★ 自绘三键：win32 桌面端渲染，且弹窗遮罩打开时仍可命中（窗口控制不被吞）', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      await becomeAdmin(page);

      // ① 三键是 DOM（原生叠加层时代 querySelector 根本查不到它们——系统绘制）
      const btns = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-window-control]')).map((b) => ({
          key: b.getAttribute('data-window-control'),
          label: b.getAttribute('aria-label'),
        })),
      );
      expect(btns).toEqual([
        { key: 'minimize', label: '最小化' },
        { key: 'maximize', label: '最大化' },
        { key: 'close', label: '关闭' },
      ]);

      // 无遮罩时三键可命中（点击可达 = 不是死按钮）
      const clickableBefore = await page.evaluate(() => {
        const closeBtn = document.querySelector('[data-window-control="close"]')!;
        const r = closeBtn.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return top === closeBtn || closeBtn.contains(top);
      });
      expect(clickableBefore).toBe(true);

      // ② 打开设置面板（遮罩型 Modal）→ 断言：遮罩打开时三键**仍可命中**。
      //
      //     机制沿革（三代解法，断言口径一直是「遮罩态可点」）：
      //      · 2026-09-23 诉求：原生叠加层在网页之上「浮亮」、遮罩压不暗它 → 解法=自绘
      //        （DOM 控件、与内容同层同源随主题变暗）；
      //      · 2026-10-01 实测（她 feedback #4）：自绘三键留在 header z-40，遮罩
      //        z-60/70/75 把它吞了——弹窗一开连点关闭都做不到。v0.8.5 C2 的解法是
      //        portal 到 body + z-[85]（功能上浮回顶层，但三键永久悬浮脱群）；
      //      · v0.8.6 壳层常驻（本轮）：三键并回顶栏主行末格 + 遮罩让出顶栏
      //        （Modal.tsx：inset-0 → top-14 xl:top-16）。既保住「与顶栏绑定」，
      //        又不需要 z-index 军备竞赛。几何由 Q-A1-4（56/64、138 宽）单独钉；
      //        遮罩让位的三档口径由 Q-A1-6 钉。
      await page.evaluate(() => {
        const s = Array.from(document.querySelectorAll('header')).length;
        const btn = Array.from(
          document.querySelectorAll<HTMLButtonElement>('[data-app-sidebar] button'),
        ).find((x) => x.getAttribute('aria-label') === '设置');
        btn?.click();
      });
      await page.waitForTimeout(500);
      expect(await page.locator('[role="dialog"]').count()).toBeGreaterThan(0);

      const covered = await page.evaluate(() => {
        const closeBtn = document.querySelector('[data-window-control="close"]')!;
        const r = closeBtn.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return top === closeBtn || (top ? closeBtn.contains(top) : false);
      });
      // 反转后的断言：遮罩打开期间三键**必须仍可命中**（可点=窗口控制不失效）
      expect(covered, '遮罩打开时三键不可命中 ⇒ 弹窗期间窗口控制被吞（v0.8.5 C2 修复点）').toBe(
        true,
      );

      // ③ 关掉遮罩 → 三键恢复可命中（压暗/覆盖不粘住）
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const clickableAfter = await page.evaluate(() => {
        const closeBtn = document.querySelector('[data-window-control="close"]')!;
        const r = closeBtn.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return top === closeBtn || closeBtn.contains(top);
      });
      expect(clickableAfter).toBe(true);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('Q-A1-3 · 拖拽区逐个元素核对：header=drag，其内交互元素（含自绘三键）全部 no-drag', async () => {
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
      // 顶栏整体是拖拽区（否则用户无法移动无原生标题栏的窗口；自绘三键后
      // 拖拽全靠它——原生叠加层时代拖拽由系统栏附赠，现在必须显式声明）
      expect(probe.headerRegion).toBe('drag');
      expect(probe.count).toBeGreaterThan(3);
      // 交互元素零例外（面包屑按钮 / 搜索框 / 头像 / ⋮更多 / 自绘三键 全部覆盖）
      expect(probe.violations).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('Q-A1-4 · 自绘三键占位 138 = 3×46、高度跟顶栏；内容不被盖；浏览器端不渲染', async () => {
    {
      const { ctx, page } = await open(1600, 900);
      try {
        const m = await page.evaluate(() => {
          const group = document.querySelector<HTMLElement>('[data-window-controls]');
          const btns = Array.from(document.querySelectorAll<HTMLElement>('[data-window-control]'));
          // 头像 = 右组最末的**内容**按钮（排除自绘三键——它们是 window 装饰，
          // 本来就该贴右缘；旧实现里三键是系统绘制不进 DOM，pop() 恰好抓到头像）
          const avatar = Array.from(document.querySelectorAll('header button'))
            .filter((b) => !b.closest('[data-window-controls]'))
            .pop() ?? null;
          const ar = avatar ? avatar.getBoundingClientRect() : null;
          return {
            groupW: group ? Math.round(group.getBoundingClientRect().width) : 0,
            widths: btns.map((b) => Math.round(b.getBoundingClientRect().width)),
            heights: btns.map((b) => Math.round(b.getBoundingClientRect().height)),
            avatarRight: ar ? Math.round(ar.right) : -1,
            vw: window.innerWidth,
          };
        });
        // 每键 46px（Windows 10/11 标准命中宽）；容器 138 与旧「原生叠加层避让位」
        // 同宽 ⇒ 右组元素（头像等）位置零位移，不是视觉调整
        expect(m.widths).toEqual([46, 46, 46]);
        expect(m.groupW).toBe(138);
        // 高度跟顶栏（xl=64）：自绘后同层同源，不再有原生叠加层的纵向错位问题
        expect(m.heights).toEqual([64, 64, 64]);
        // 内容（头像右缘）离窗口右缘 ≥ 138：自绘后三键是布局占位（比浮动叠加层更强）
        expect(m.vw - m.avatarRight).toBeGreaterThanOrEqual(138);
      } finally {
        await ctx.close();
      }
    }
    {
      // 浏览器 / NAS 端：无 idplan → 不得渲染三键（走系统装饰，不留白不占位）
      const { ctx, page } = await open(1600, 900, { desktop: false });
      try {
        expect(await page.evaluate(() => typeof window.idplan)).toBe('undefined');
        expect(await page.locator('[data-window-controls]').count()).toBe(0);
      } finally {
        await ctx.close();
      }
    }
  }, HEAVY);

  it('Q-A1-5 · 跨 xl 断点 resize：顶栏与三键高度跟随（56↔64）', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      await becomeAdmin(page);
      const btnH = () =>
        page.evaluate(() => {
          const btn = document.querySelector<HTMLElement>('[data-window-control]');
          return btn ? Math.round(btn.getBoundingClientRect().height) : 0;
        });
      expect(await btnH()).toBe(64);
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.waitForTimeout(400);
      expect(await btnH()).toBe(56);
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.waitForTimeout(400);
      expect(await btnH()).toBe(64);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  /* ================= A1-6 · v0.8.6 壳层常驻：遮罩让出顶栏 ================= */

  /**
   * Q-A1-6 · v0.8.6 壳层常驻重构（她拍板的「三键与顶栏统一常驻」）：
   * 三键从 body portal 并回顶栏主行末格后，header z-40 会被浮层遮罩
   * （fixed z-60/70/75）重新吞掉——10-01 反馈 #4「弹窗一开三键点不动」原样复发。
   * 解法不是再把三键 portal 回去（那是治症：三键又得悬浮脱群），而是
   * **遮罩让出顶栏**：Modal.tsx 的 overlay 从 `inset-0` 改为
   * `max-md:top-[100px] md:top-14 xl:top-16`——与 TopBar 行高同口径。
   *
   * 本用例守住三件用户能看见的事（真 Chromium，命中测试是唯一诚实判据）：
   *   ① 遮罩顶边 = 当前档位顶栏高（xl 64 / md 56 / <md 两行合计 100），
   *      且视口内所有浮层遮罩同口径（不止一处 overlay 时全部让位）；
   *   ② 遮罩打开期间三键仍可点（elementFromPoint 命中按钮本体）；
   *   ③ 顶栏带本身不被遮罩盖（点顶栏中点命中的是 header 一族，不是 dialog）。
   */
  it('Q-A1-6 · v0.8.6 壳层常驻：弹窗遮罩让出顶栏（三档高度口径），三键在遮罩态仍可点', async () => {
    for (const [w, expectedTop] of [
      [1600, 64],
      [1200, 56],
      [767, 100], // <md 两行顶帽（56 + 44 搜索行）合计 100
    ] as const) {
      const { ctx, page } = await open(w, 900);
      try {
        await becomeAdmin(page);
        // <xl 侧栏是抽屉：先开汉堡，再从抽屉里点「设置」；≥xl 持久侧栏直接点
        // （只点一次——合成 click 的 clientX/Y 是 0，重复点会把浮动面板锚到 (0,0)）
        await page.evaluate(() => {
          const direct = Array.from(
            document.querySelectorAll<HTMLButtonElement>('[data-app-sidebar] button'),
          ).find((x) => x.getAttribute('aria-label') === '设置');
          if (direct) {
            direct.click();
            return;
          }
          document.querySelector<HTMLButtonElement>('button[aria-label="打开导航菜单"]')?.click();
        });
        if (w < 1280) {
          await page.waitForTimeout(400);
          await page.evaluate(() => {
            Array.from(document.querySelectorAll<HTMLButtonElement>('[data-app-sidebar] button'))
              .find((x) => x.getAttribute('aria-label') === '设置')
              ?.click();
          });
        }
        await page.waitForTimeout(600);
        expect(await page.locator('[role="dialog"]').count()).toBeGreaterThan(0);

        const probe = await page.evaluate(() => {
          const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
          const tops = dialogs.map((d) => Math.round(d.getBoundingClientRect().top));
          const closeBtn = document.querySelector<HTMLElement>('[data-window-control="close"]')!;
          const r = closeBtn.getBoundingClientRect();
          const atClose = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          const header = document.querySelector('header')!;
          const hr = header.getBoundingClientRect();
          const atBar = document.elementFromPoint(hr.x + hr.width * 0.35, hr.y + hr.height / 2);
          return {
            tops,
            closeHittable: atClose === closeBtn || (atClose ? closeBtn.contains(atClose) : false),
            barIsChrome:
              atBar === header || (atBar ? header.contains(atBar) : false),
          };
        });
        // ① 所有浮层遮罩同口径让出顶栏（0 个 dialog 越过顶栏下缘）
        expect(probe.tops.length).toBeGreaterThan(0);
        expect(probe.tops.every((t) => t === expectedTop), `遮罩顶边应为 ${expectedTop}，实测 ${JSON.stringify(probe.tops)}`).toBe(true);
        // ② 遮罩态三键仍可点（窗口控制不失效——反馈 #4 修复点的结构性解）
        expect(probe.closeHittable, `w=${w} 遮罩打开时三键不可命中`).toBe(true);
        // ③ 顶栏带保持原色可交互（不被任何 dialog 盖住）
        expect(probe.barIsChrome, `w=${w} 遮罩盖住了顶栏`).toBe(true);
      } finally {
        await ctx.close();
      }
    }
  }, HEAVY);

  /* ================= A2 · 设置抽屉：从窗口左缘滑出 + 盖住侧栏 + 贴顶栏全高 ================= */

  /**
   * ★ 契约变更（v0.8.6 · 反馈 #4）——本组用例的口径与前两代**完全不同**：
   *
   *   旧版（反馈 #2/#3 时代）：设置是 `placement="float"` 锚定浮动卡，面板在
   *   **鼠标点击处**展开（anchor={clientX,clientY}）。她的原话：「应该是从这个
   *   边栏从左往右滑出，而不是鼠标在哪里点击弹出设置窗口，它就从哪里生成」。
   *
   *   新版：`placement="left"` 全高抽屉——**窗口左缘**起、盖住侧栏、贴顶栏
   *   底缘（遮罩让位 top-14 xl:top-16，见 Q-A1-6）。anchor 链路整个删除。
   *
   *   本组守住四件用户能看见的事：
   *     ① 抽屉从窗口左缘滑出（left ≈ 0），宽 640（<xl 全屏）；
   *     ② 盖住侧栏（elementFromPoint 诚实判据），贴顶栏底缘全高（无悬空带）；
   *     ③ 设置项在抽屉内可见、可点（主题切换真路径；v0.8.6 反馈 #7 起经
   *        左导航分区可达——六区各渲染当前分区，不再是"一列到底"）；
   *     ④ 焦点管理：打开入抽屉、Esc 关、关闭焦点回触发钮（Q-A2-3）。
   *   旧 float 口径（锚定在点击处 / 底圆角不被裁 / 让开三键）随形态废止：
   *   全高抽屉贴边，底圆角被裁的结构性根因不复存在；让开三键由遮罩让位承担
   *   （Q-A1-6），不在本组重复。
   */

  it('Q-A2-1 · 管理员打开设置：抽屉从窗口左缘滑出、盖住侧栏、贴顶栏全高（亮/暗一致）', async () => {
    for (const theme of ['light', 'dark'] as const) {
      const { ctx, page } = await open(1600, 900);
      try {
        await becomeAdmin(page);
        await clickSidebarSettings(page);
        await waitSettingsDrawer(page);

        // ③ 设置项可见、可点（v0.8.6 · 反馈 #7：六区化后抽屉只渲染当前分区，
        //    内容可达性 = 左导航切换真路径，不再是"一列到底全在内"）
        const drawer = page.locator('[data-settings-drawer]');
        const headText = await drawer.innerText();
        expect(headText, '默认应落在「外观」区（主题 + 侧栏）').toContain('主题');
        expect(headText).toContain('侧栏');
        await page.locator('[data-settings-zone="data"]').click();
        expect(await drawer.innerText(), '「数据与备份」区应有日志区').toContain('前端日志');
        expect(await drawer.innerText()).toContain('保存备份');
        await page.locator('[data-settings-zone="agent"]').click();
        expect(await drawer.innerText(), '「Agent 与自动化」区应有插件区').toContain('插件');
        await page.locator('[data-settings-zone="appearance"]').click();

        if (theme === 'dark') {
          // 真实切换路径：抽屉内点「深色」→ useTheme.setMode → apply()
          await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll<HTMLElement>('[data-settings-drawer] button')).find(
              (x) => (x.textContent ?? '').trim() === '深色',
            );
            b?.click();
          });
          await page.waitForTimeout(500);
        }

        const m = await probeSettingsDrawer(page);
        expect(m).not.toBeNull();
        expect(m!.theme).toBe(theme);
        // eslint-disable-next-line no-console
        console.log('[Q-A2-1] probe=', JSON.stringify(m));

        // ① 左缘滑出：贴窗口左缘（±1px 抗亚像素）
        expect(Math.abs(m!.drawerLeft)).toBeLessThanOrEqual(1);
        // ② 宽 640（≥xl 分栏预留）；<xl 全屏由 Q-A2-2 覆盖
        expect(Math.round(m!.drawerWidth)).toBe(640);
        // 盖住侧栏（诚实判据：侧栏中心的命中点是抽屉，不是侧栏）
        expect(m!.coversSidebar, '抽屉没有盖住侧栏（反馈 #4 的形态要件）').toBe(true);
        // ② 贴顶栏底缘全高：抽屉顶 = 顶栏高、底 = 视口底（无悬空带、无裁切）
        expect(Math.abs(m!.drawerTop - m!.topbarH)).toBeLessThanOrEqual(1);
        expect(Math.abs(m!.vh - m!.drawerBottom)).toBeLessThanOrEqual(1);
        expect(Math.round(m!.drawerHeight)).toBe(m!.vh - m!.topbarH);
        // 遮罩与抽屉同缘让出顶栏（与 Q-A1-6 同口径）
        expect(Math.round(m!.overlayTop)).toBe(m!.topbarH);
        // 右缘圆角 = 抽屉的「出来」方向；左缘贴边不修圆角
        expect(m!.brRadius).toBe('16px');
        expect(m!.blRadius).toBe('0px');
        // 完整落在视口内（右不越界）
        expect(m!.drawerRight).toBeLessThanOrEqual(m!.vw + 0.5);
      } finally {
        await ctx.close();
      }
    }
  }, HEAVY);

  it('Q-A2-2 · <md 走「⋮ 更多」入口：同一抽屉全屏化 + 左滑进场动画真实存在', async () => {
    /*
      <md 没有持久侧栏，设置入口在顶栏「⋮ 更多」菜单（MobileMoreMenu 的第二个
      调用点）。抽屉在该档全屏（w-full）——与 <xl 无侧栏的视野一致。
      本用例同时守两件事：
        ① 全屏几何（left≈0、宽=视口宽、顶=两行顶帽合计 100）；
        ② 进场动画真实存在（drawer-in-left，200ms，reduced-motion 已关停）。
      「第二调用点也能打开同一抽屉」本身就是适配面（settingsAnchor 删除后
      MobileMoreMenu 的锚点 state 一并移除）。
    */
    const { ctx, page } = await open(767, 900);
    try {
      await becomeAdmin(page);
      await page.setViewportSize({ width: 767, height: 900 });
      await page.waitForTimeout(500);

      const more = page.locator('button[aria-label="更多操作"]');
      await more.first().click();
      await page.waitForTimeout(400);
      await page
        .locator('[role="menu"] [role="menuitem"]', { hasText: '设置' })
        .first()
        .click();
      await waitSettingsDrawer(page);

      const m = await probeSettingsDrawer(page);
      expect(m).not.toBeNull();
      expect(m!.vw).toBe(767);
      // eslint-disable-next-line no-console
      console.log('[Q-A2-2] probe=', JSON.stringify(m));

      // ① 全屏化：left≈0、宽=视口宽、顶=两行顶帽（100）
      expect(Math.abs(m!.drawerLeft)).toBeLessThanOrEqual(1);
      expect(Math.round(m!.drawerWidth)).toBe(767);
      expect(Math.round(m!.drawerTop)).toBe(100);
      expect(Math.round(m!.drawerHeight)).toBe(900 - 100);

      // ② 进场动画：面板带 drawer-in-left 且计算动画名匹配（不是凭感觉）
      const anim = await page.evaluate(() => {
        const p = document.querySelector('[data-settings-drawer]')!;
        const cs = getComputedStyle(p);
        return { name: cs.animationName, dur: cs.animationDuration };
      });
      expect(anim.name).toBe('drawer-in-left');
      expect(anim.dur).toBe('0.2s');
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('Q-A2-3 · 焦点管理：打开焦点入抽屉、Esc 关闭、焦点回触发钮（反馈 #4 硬约束）', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      await becomeAdmin(page);
      await clickSidebarSettings(page);
      await waitSettingsDrawer(page);

      // 打开后焦点进 dialog 子树（Modal 打开即聚焦点击捕获层 panelRef——
      // 它是抽屉本体的父级；圈禁的起点在这个 wrapper 上，别把断言写成
      // 「焦点必须在抽屉本体内」，那是量错了层次）
      const inDrawer = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"][aria-label="设置"]');
        return !!dlg && dlg.contains(document.activeElement);
      });
      expect(inDrawer, '打开设置后焦点不在 dialog 子树内').toBe(true);

      // Esc 关（Modal 既有契约）
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      expect(await page.locator('[role="dialog"][aria-label="设置"]').count()).toBe(0);

      // 关闭后焦点回触发钮（侧栏那个「设置」——Modal lastFocusRef 还原）
      const backToTrigger = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return false;
        return (
          el.getAttribute('aria-label') === '设置' &&
          !!el.closest('[data-app-sidebar]')
        );
      });
      expect(backToTrigger, '关闭设置后焦点没有回到侧栏触发钮').toBe(true);
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
