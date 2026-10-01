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
 * 改为记录 `windowControls` 调用。三键是 DOM：遮罩（fixed inset-0 z-[70]）打开时
 * 自然盖住 header（z-40）里的三键——"随遮罩变暗"不再需要任何近似机制。 */
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
    // 不消掉会遮住后续所有点击。本族测的是控件几何，走「从空库开始」线；
    // 示例分支由 first-run-guide.spec.tsx / demo-data.spec.ts 覆盖。
    const guideSkip = page.locator('button', { hasText: '从空库开始' });
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
    await page.locator('input[placeholder*="XX餐饮"]').fill(name);
    /*
      ★ 反馈 #5 之后的新口径：手动建档**首开不预选主板块**，套餐/阶段随主板块带出。
        不先选板块 ⇒ 「建档」按钮保持 disabled（0 段 < 最少段数）⇒ 建档静默失败、
        用例后续全部假红（URL 停在首页、找不到彩条）。
        这里显式选「室内」，与用例名里「9 段室内项目」的前提对齐。
    */
    await page.selectOption('select[aria-label="主板块"]', 'indoor');
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
   * 真鼠标点侧栏「设置」——反馈 #3 的锚定入口，返回**真实点击坐标**（= 传给
   * `SettingsDialog` 的 anchor）。
   *
   * ⚠️ 必须用 `page.mouse.click` 而不是 `evaluate(() => btn.click())`：
   *   合成 click 的 `clientX/clientY` 恒为 0，而侧栏正是把 `e.clientX/Y` 当锚点
   *   传给 SettingsDialog（`Sidebar.tsx` 的 `setSettingsAnchor({x:e.clientX,y:e.clientY})`）。
   *   用合成点击 ⇒ 锚点变 (0,0) ⇒ 面板被夹到左上角，测到的是「空锚点降级路径」，
   *   而不是用户真实遇到的「在我点的地方弹出来」（反馈 #3 的原话）。
   *
   * 侧栏展开/收起两态各有一个 `[aria-label="设置"]`，取**可见**那个（收起态是 DOM 里
   * display:none 的 40×40 图标钮，点到它会落在 (0,0)）。
   */
  async function clickSidebarSettings(page: Page): Promise<{ x: number; y: number }> {
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
    if (!point) throw new Error('侧栏「设置」入口不可见——无法取得锚点');
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(700);
    return point;
  }

  /** 等锚定定位算完：`floatPos` 未算好前浮动卡是 `visibility:hidden`（防首帧闪在 (0,0)） */
  async function waitFloatVisible(page: Page): Promise<void> {
    await page.waitForFunction(
      () => {
        const w = document.querySelector('[data-anchored-float]');
        return !!w && getComputedStyle(w).visibility === 'visible';
      },
      undefined,
      { timeout: 8000 },
    );
  }

  /**
   * 量设置面板的真几何。
   * ⚠️ DOM 层次：`[role=dialog]` → 点击捕获层 → **`div[data-anchored-float]`（定位壳）**
   *   → 设置卡片本体（`glass-strong rounded-2xl`）。
   *   量圆角/高度必须取**卡片本体**；量到定位壳会恒得 `0px` / `p-0`，
   *   断言就变成了「测一个跟视觉无关的容器」（旧用例踩过这个坑）。
   */
  function probeFloatSettings(page: Page) {
    return page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"][aria-label="设置"]');
      if (!dlg) return null;
      const wrap = dlg.querySelector('[data-anchored-float]') as HTMLElement | null;
      const panel = (wrap?.firstElementChild ?? null) as HTMLElement | null;
      if (!wrap || !panel) return null;
      const pr = panel.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        visibility: getComputedStyle(wrap).visibility,
        left: pr.left,
        top: pr.top,
        right: pr.right,
        bottom: pr.bottom,
        width: pr.width,
        height: pr.height,
        blRadius: cs.borderBottomLeftRadius,
        brRadius: cs.borderBottomRightRadius,
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
    await page.locator('input[placeholder*="XX餐饮"]').fill(name);
    await page.selectOption('select[aria-label="主板块"]', 'indoor');
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
   * （TopBar.tsx 的 WindowControls），与内容同层同源——遮罩打开时自然盖住它们，
   * 一类问题整类消失。本组验收随之从「配色下发 / 压暗系数」重构为
   * 「存在性 / 几何 / 平台门控 / 遮罩覆盖 / 拖拽纪律 / 断点跟随」。
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

  it('Q-A1-2 · ★ 自绘三键：win32 桌面端渲染，且弹窗遮罩打开时被整体盖住（原生叠加层投诉的结构性修复）', async () => {
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

      // ② 打开设置面板（遮罩型 Modal）→ ★ 2026-10-01（v0.8.5 C2）断言**反转**：
      //    遮罩打开时三键**仍可命中**（portal body + z-[85] > 遮罩 z-[70]）。
      //
      //    为什么反转（两代诉求的合成点，不是倒退）：
      //      · 2026-09-23 诉求：原生叠加层在网页之上「浮亮」、遮罩压不暗它 → 解法=自绘
      //        （DOM 控件、与内容同层同源随主题变暗）——当年断言「被盖住」即验收此点；
      //      · 2026-10-01 实测（她 feedback #4 连带头一项）：自绘三键留在 header z-40，
      //        遮罩 z-60/70/75 把它**吞了**——弹窗一开连「点关闭最小化」都做不到。
      //        elementFromPoint 在三键位置命中的是遮罩（排障手 debug 报告 Bug 2 连带实锤）。
      //    合成解 = portal 到 body + z-[85]：**仍是 DOM 控件**（继承自绘的全部收益：
      //    随主题变色、无系统叠加层），但**功能上浮回顶层**（遮罩期间可点，对齐原生
      //    titleBar 语义）。几何由 Q-A1-4（56/64、138 宽）单独钉，两轴分开验收。
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

  /* ================= A2 · 设置面板：锚定在点击处 + 完整落视口 + 让开原生三键 ================= */

  /**
   * ★ 契约变更（反馈 #2 / #3）——本组用例的口径与旧版**完全不同**，不是简单改阈值：
   *
   *   旧版：设置是「右侧全高抽屉」，断言「面板顶 ≥ 三键底、上下内边距对称、
   *         底边贴容器下内边距」。那些断言全部以 `Modal` 的 right-float 容器 padding 为前提。
   *   新版：设置改为 `placement="float"` —— 面板**在触发点旁边**弹出一张浮动卡，
   *         纵向位置连 `insetTop` 一起由 `src/lib/anchoredPosition.ts` 算好，
   *         容器沦为「只负责点击捕获」的 `p-0` 层（不再有 padding 可言）。
   *
   *   故旧断言里「容器 padding / 容器下内边距」这两条基准**已经不存在**，
   *   继续写只会：
   *     · 量到定位壳（`div[data-anchored-float]`）→ 圆角恒 `0px`、padding 恒 `0px`；
   *     · 把「恒真/恒假」当成验收 —— 正是本文件开头警告过的假绿来源。
   *
   *   新口径守住三件用户能看见的事（不碰任何已消失的容器基准）：
   *     ① 面板完整落在视口内，且顶边让开 Windows 原生三键（否则三键压住面板头部）；
   *     ② 面板**锚定在点击处**：横向从点击点展开（不再固定贴右边缘）；
   *     ③ 底圆角非 0 —— 用户原始投诉「底部圆角被推出视口裁掉」的回归位。
   */

  it('Q-A2-1 · 管理员打开设置：从点击处展开、整体在视口内、让开原生三键、底圆角可见（亮/暗一致）', async () => {
    for (const theme of ['light', 'dark'] as const) {
      const { ctx, page } = await open(1600, 900);
      try {
        await becomeAdmin(page);
        const anchor = await clickSidebarSettings(page);
        if (theme === 'dark') {
          // 真实切换路径：设置面板内点「深色」→ useTheme.setMode → apply()
          await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button')).find(
              (x) => (x.textContent ?? '').trim() === '深色',
            );
            b?.click();
          });
          await page.waitForTimeout(500);
        }
        await waitFloatVisible(page);

        const m = await probeFloatSettings(page);
        expect(m).not.toBeNull();
        expect(m!.theme).toBe(theme);
        expect(m!.visibility).toBe('visible');

        // 基准值取**单一出处**：`titleBarHeightFor(vw)`（口径一改这里自动跟着改）
        const expectedInset = titleBarHeightFor(m!.vw);

        // ① 完整落在视口内，且顶边让开原生三键（三键浮在网页之上，不让位就压住面板头部）
        expect(m!.top).toBeGreaterThanOrEqual(expectedInset - 0.5);
        expect(m!.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN - 0.5);
        // ② 底/右不越界：底圆角不得被裁（用户原始投诉），右侧留白 ≥ 视口留白口径
        expect(m!.bottom).toBeLessThanOrEqual(m!.vh - VIEWPORT_MARGIN + 0.5);
        expect(m!.right).toBeLessThanOrEqual(m!.vw - VIEWPORT_MARGIN + 0.5);

        // ③ 锚定在点击处：横向左缘对齐点击点（1180+ px 的右侧空白 ⇒ 不是「固定右侧抽屉」）
        expect(Math.abs(m!.left - anchor.x)).toBeLessThanOrEqual(2);
        expect(m!.vw - m!.right).toBeGreaterThan(VIEWPORT_MARGIN + 2);

        // ④ 纵向落位必须是锚定算法的三种结果之一（否则说明面板"漂"在无关位置）
        //    注：夹取下界是 `margin + insetTop`（resolveAnchoredPosition 的 minY），
        //    不是 insetTop 本身 —— 写 insetTop 会差 8px 而误红。
        const anchorFloor = expectedInset + VIEWPORT_MARGIN;
        const belowAnchor = Math.abs(m!.top - anchor.y) <= 2; // 下方展开
        const flippedAbove = Math.abs(m!.bottom - (anchor.y - ANCHOR_GAP)) <= 2; // 空间不足翻到上方
        const clampedToFloor = Math.abs(m!.top - anchorFloor) <= 2; // 面板高于可用空间 → 夹到避让线下沿
        expect(
          belowAnchor || flippedAbove || clampedToFloor,
          `未按锚定算法落位：anchor.y=${anchor.y} top=${m!.top} bottom=${m!.bottom} floor=${anchorFloor}`,
        ).toBe(true);

        // ⑤ 底圆角非 0（量的是卡片本体，不是 `p-0` 的定位壳）
        expect(m!.blRadius).toBe('16px');
        expect(m!.brRadius).toBe('16px');
      } finally {
        await ctx.close();
      }
    }
  }, HEAVY);

  it('Q-A2-2 · 换一个触发点（<md 的「⋮ 更多」菜单）：面板跟着新触发点走 + 进场动画真实存在', async () => {
    /*
      ★ 为什么把旧用例（「未知身份 → 内容较短 → 底部圆角仍可见」）换成这一条：
        旧场景在锚定形态下**已经不可构造**——首次身份引导弹窗是 center 档（z-70），
        设置浮动卡是非 center 档（z-60），真鼠标点击会被引导遮罩吃掉、设置根本打不开；
        即使用合成点击强行打开，面板也在遮罩之下，量到的几何没有用户可见性。
        与其留一条靠合成点击绕开遮罩的"假场景"，不如换成**反馈 #3 真正要守的两件事**：
          ① 面板锚定在**当前触发点**（换一个入口 → 面板必须换位置，而不是固定角落）；
          ② 有进场动画（用户原话：「弹窗应在鼠标附近出现且有动画」）。
        「底部圆角不被裁」已由 Q-A2-1 覆盖（那是长内容的极端档，更严）。
    */
    const { ctx, page } = await open(1600, 900);
    try {
      await becomeAdmin(page);
      // <md(768) 才会渲染「⋮ 更多」菜单（MobileMoreMenu 的容器是 md:hidden）
      await page.setViewportSize({ width: 767, height: 900 });
      await page.waitForTimeout(500);

      const more = page.locator('button[aria-label="更多操作"]');
      const mbox = await more.first().boundingBox();
      expect(mbox).not.toBeNull();
      await page.mouse.click(mbox!.x + mbox!.width / 2, mbox!.y + mbox!.height / 2);
      await page.waitForTimeout(400);

      const item = page.locator('[role="menu"] [role="menuitem"]', { hasText: '设置' });
      const ibox = await item.first().boundingBox();
      expect(ibox).not.toBeNull();
      const anchor = { x: ibox!.x + ibox!.width / 2, y: ibox!.y + ibox!.height / 2 };
      await page.mouse.click(anchor.x, anchor.y);
      await page.waitForTimeout(700);
      await waitFloatVisible(page);

      const m = await probeFloatSettings(page);
      expect(m).not.toBeNull();
      const expectedInset = titleBarHeightFor(m!.vw);
      expect(m!.vw).toBe(767);
      // eslint-disable-next-line no-console
      console.log('[Q-A2-2] anchor=', JSON.stringify(anchor), 'probe=', JSON.stringify(m));

      // ① 仍完整落在视口内、仍让开原生三键（<xl 档三键高 56，口径随视口自动变）
      expect(m!.top).toBeGreaterThanOrEqual(expectedInset - 0.5);
      expect(m!.vh - m!.bottom).toBeGreaterThanOrEqual(VIEWPORT_MARGIN - 1);
      // ② 底圆角可见
      expect(m!.blRadius).toBe('16px');
      expect(m!.brRadius).toBe('16px');

      /*
        ③ 触发点必须落在面板的横向区间内 —— 锚定结果不得把面板甩到与点击处无关的位置。
           （必要非充分：本视口下触发点右侧只有 405px < 面板 400 + 两侧留白，
             锚定算法会向左回退到贴左留白，此时左缘不再等于触发点。
             「左缘精确对齐点击点」的强判别式证据由 Q-A2-1 承担 —— 那里面板右侧有 1000+px 余量。）
      */
      expect(anchor.x).toBeGreaterThanOrEqual(m!.left - 2);
      expect(anchor.x).toBeLessThanOrEqual(m!.right + 2);

      // ④ 进场动画真实存在（不是只挂了个类名——按 computed style 读回动画名与时长）
      const anim = await page.evaluate(() => {
        const w = document.querySelector('[data-anchored-float]') as HTMLElement | null;
        if (!w) return null;
        const cs = getComputedStyle(w);
        return { name: cs.animationName, duration: cs.animationDuration, fill: cs.animationFillMode };
      });
      expect(anim).not.toBeNull();
      expect(anim!.name).toBe('float-pop-in');
      expect(anim!.duration).toBe('0.16s');
      expect(anim!.fill).toBe('both');
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
