import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * v0.7 阶段 A · L-01~L-08 布局验收（真实构建产物 + 真 Chromium 实测）。
 *
 * ── 为什么是「加载真实产物」而不是 jsdom 渲染组件 ──
 *   本组验收点全部是**布局/响应式**事实（顶栏常驻块数、侧栏宽度随视口变化、
 *   暗色 token 换肤、双重留白）。jsdom **不实现布局**——`getBoundingClientRect`
 *   恒返回 0，`getComputedStyle` 不回解析 `xl:` 媒体查询。在 jsdom 里断言这些
 *   等于断言空气。故必须真浏览器 + 真 CSS + 真视口。
 *
 * ── 为什么跑 `build-dist` 而不是 dev server ──
 *   dev server 需额外进程与端口编排，且 `xl:` 断点类在 dev 下由 JIT 按需产出，
 *   「类名在产物里存在」这一层事实测不到。跑构建产物顺带覆盖了
 *   「Tailwind JIT 是否真的生成了这些响应式类」——这是 dev 模式测不出的回归。
 *
 * ── 前置 ──
 *   `npm run build` 必须先跑过（产物 `build-dist/index.html`）。
 *   产物缺失时本 spec **跳过**（`skip`）而非失败：布局验收属于「发布前走查」，
 *   不应该让「没构建」把默认 `npm test` 染红（CI 里 test 与 build 顺序可变）。
 *   若需强制验收，跑 `npm run build && npm test`。
 *
 * ── 浏览器解析 ──
 *   playwright-core 不自带下载逻辑，需显式指定 executablePath。
 *   本机已在 `%LOCALAPPDATA%/ms-playwright/chromium-*` 安装 chromium（既有依赖
 *   链引入），此处按目录探测取第一个可用版本，避免写死版本号（升级即失效）。
 */
const DIST_INDEX = resolve(__dirname, '..', 'build-dist', 'index.html');

/** 探测已安装的 chromium 可执行文件（跨平台） */
function resolveChromium(): string | null {
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  const relCandidates = [
    // playwright 现行 Windows 产物目录（chrome-win64 / chrome-win 两个历史命名都兼容）
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
 * 产物须经 **HTTP** 提供，不能走 `file://`。
 *
 * `vite.config.ts` 的 `base: '/'`（UGOS nginx 根路径直连模型）使产物内资源引用为
 * 绝对路径 `/assets/index-*.js`。在 `file://` 下这些绝对路径会被解析成
 * `file:///assets/...`（盘根）→ 404 → 应用根本不挂载（DOM 里连 header 都没有），
 * 表现为「所有布局断言全部返回 null」这种极具误导性的失败。
 *
 * 故此处起一个极小的只读静态服务器（零依赖，node:http），
 * 只服务 `build-dist/`，测试结束即关闭。端口用 0 让内核分配，避免并发冲突。
 */
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
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    // SPA 回退：非文件请求一律返回 index.html（与 nginx try_files 同语义）
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

/** 视口矩阵：覆盖 L-03 三档 + xl 临界（严格锁 1280，故 1280 本身必须测） */
const VIEWPORTS = [
  { w: 1600, h: 900, name: 'xl 桌面 1600' },
  { w: 1280, h: 900, name: 'xl 临界 1280' },
  { w: 1194, h: 900, name: 'iPad Pro 1194' },
  { w: 1024, h: 900, name: 'iPad 横屏 1024' },
  { w: 768, h: 900, name: '平板 768' },
  { w: 390, h: 844, name: '手机 390' },
];

/** 页面内测量：返回纯 JSON（不传 DOM 对象） */
async function measure(page: Page): Promise<{
  headerVisibleInteractive: number;
  subtitle: string | null;
  sidebarPresent: boolean;
  sidebarWidth: number;
  sidebarClasses: string;
  sidebarHasPrintHidden: boolean;
  dataSidebarCollapsed: string | null;
  mainWidth: number;
  headerHasGlass: boolean;
  headerBg: string;
  headerBorderBottom: string;
}> {
  return page.evaluate(() => {
    const q = (s: string): HTMLElement | null => document.querySelector(s);
    const header = q('header');
    const sidebar = q('[data-app-sidebar]');
    const main = q('main');

    const isVisible = (el: Element): boolean => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // L-01：顶栏内「可见叶子级交互单元」计数（button/a/img/select）
    const headerVisibleInteractive = header
      ? Array.from(header.querySelectorAll('*')).filter(
          (el) =>
            isVisible(el) && ['BUTTON', 'A', 'IMG', 'SELECT'].includes(el.tagName),
        ).length
      : 0;

    // L-06：副标题（行业中性文案）
    const subtitleEl = header
      ? Array.from(header.querySelectorAll('span')).find((s) =>
          /室内设计项目管理|项目排期与交付管理/.test(s.textContent ?? ''),
        )
      : null;

    return {
      headerVisibleInteractive,
      subtitle: subtitleEl ? subtitleEl.textContent : null,
      sidebarPresent: !!sidebar && isVisible(sidebar),
      sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0,
      sidebarClasses: sidebar ? sidebar.className : '',
      sidebarHasPrintHidden: sidebar ? sidebar.className.includes('print:hidden') : false,
      dataSidebarCollapsed: document.documentElement.dataset.sidebarCollapsed ?? null,
      mainWidth: main ? Math.round(main.getBoundingClientRect().width) : 0,
      headerHasGlass: /glass/.test(header ? header.innerHTML : ''),
      headerBg: header ? getComputedStyle(header).backgroundColor : '',
      headerBorderBottom: header ? getComputedStyle(header).borderBottomWidth : '',
    };
  });
}

describe.skipIf(!CAN_RUN)('v0.7 阶段 A · L-01~L-08 布局验收（真实构建产物）', () => {
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

  /** 每个用例自建 context（视口不同），用完即关——互不污染 viewport 与 localStorage */
  async function openAt(width: number, height: number): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto(DIST_URL);
    // 等应用真正挂载（首屏有 header + main），比固定 sleep 稳
    await page.waitForSelector('header', { timeout: 15000 });
    await page.waitForSelector('main', { timeout: 15000 });
    await page.waitForTimeout(300);
    return { ctx, page };
  }

  it('L-01 · 顶栏常驻视觉块 ≤4（xl 档）', async () => {
    const { ctx, page } = await openAt(1600, 900);

    // 结构性断言（比纯计数更稳）：4 类代表元素都在
    expect(await page.locator('header img[alt="ID Plan logo"]').count()).toBe(1);
    expect(await page.locator('header [aria-label="设置"]').count()).toBe(1);
    // 顶栏默认不渲染**可见**的常驻搜索输入框（已改图标，去 480px 框）。
    // 注意必须按「可见」判定：DOM 里恒有两个隐藏 input——
    //   ① 手机档搜索框（`sm:hidden`，xl 下 display:none）；
    //   ② 备份用的 `input[type=file].hidden`。
    // 只数 `count()` 会把它们算进来，得到「顶栏还有输入框」的假阳性。
    const visibleHeaderInputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('header input')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).length,
    );
    expect(visibleHeaderInputs).toBe(0);
    // 顶栏内不得再出现导航链接文字（已迁侧栏）
    const headerText = (await page.locator('header').innerText()).replace(/\s+/g, '');
    expect(headerText).not.toContain('我的任务');
    expect(headerText).not.toContain('Agent');
    // 顶栏内不得再有「看板/月历」视图切换（已沉内容区顶部 tab）
    expect(headerText).not.toContain('月历');

    await ctx.close();
  });

  it('L-02 · 侧栏折叠态持久化（写入 localStorage → 重载后保持）', async () => {
    const { ctx, page } = await openAt(1600, 900);

    const before = await measure(page);
    expect(before.sidebarPresent).toBe(true);

    // 写入收起态（key 与 LAYOUT_STORAGE_KEY='idplan.layout' 一致）
    await page.evaluate(() => {
      localStorage.setItem('idplan.layout', JSON.stringify({ state: { sidebarExpanded: false }, version: 0 }));
    });
    await page.reload();
    await page.waitForSelector('header', { timeout: 15000 });
    await page.waitForTimeout(400);
    const after = await measure(page);

    // 持久化生效：宽度应为收起 64，且 DOM 属性标为收起
    expect(after.sidebarWidth).toBe(64);
    expect(after.dataSidebarCollapsed).toBe('true');
    await ctx.close();
  });

  it('L-03 · <1280 一律走抽屉（无持久侧栏）；<768 靠汉堡打开', async () => {
    /**
     * ⚠️ 与设计文档 §3.3 表格的**已知偏差**（实测确认，非测试缺陷）：
     *   文档 §3.3 写「1024–1280 → 默认 64 图标条」（持久左栏存在，仅默认收起）；
     *   实测：1024px 下 `[data-app-sidebar]` 的 `display:none`、宽度 0 ——
     *   因为显隐类只有 `hidden xl:flex`，而 `xl` = min-width:1280，
     *   故 **<1280 根本没有持久侧栏**，1024–1280 与 <768 同档，都走 Modal 抽屉。
     *
     *   判断：**以实测实现为准**（与 T01/T03 落地一致，且更简单）——
     *   §3.3 表格那一行要求「持久栏存在但默认收起」，需要额外的
     *   「1024–1280 显示持久栏」CSS 类（不能复用 xl:flex），
     *   等于引入第二个断点档位，与同节「严格锁 xl，不新增断点」自相矛盾。
     *   本批不改实现，只在验收中记录该偏差，交 team-lead 决定是否补档。
     */
    // 1024（1024–1280 档）：实测无持久侧栏，靠汉堡走抽屉
    {
      const { ctx, page } = await openAt(1024, 900);
      const m = await measure(page);
      expect(m.sidebarPresent).toBe(false);
      expect(await page.locator('header [aria-label="打开导航菜单"]').count()).toBe(1);
      await ctx.close();
    }
    // 1280（xl 临界）：持久左栏存在，默认展开 240
    {
      const { ctx, page } = await openAt(1280, 900);
      const m = await measure(page);
      expect(m.sidebarPresent).toBe(true);
      expect(m.sidebarWidth).toBe(240);
      await ctx.close();
    }
    // 390（<768）：无持久侧栏，汉堡存在
    {
      const { ctx, page } = await openAt(390, 844);
      const m = await measure(page);
      expect(m.sidebarPresent).toBe(false);
      expect(await page.locator('header [aria-label="打开导航菜单"]').count()).toBe(1);
      await ctx.close();
    }
  });

  it('L-04 · 侧栏显隐严格锁 xl，无新增断点', async () => {
    const { ctx, page } = await openAt(1600, 900);
    const m = await measure(page);

    // 侧栏显隐类只允许 xl:flex / xl:hidden，不得出现 sm/md/lg/2xl 的 flex|hidden
    expect(/(?:^|\s)(?:sm|md|lg|2xl):(?:flex|hidden)/.test(m.sidebarClasses)).toBe(false);
    expect(/xl:flex/.test(m.sidebarClasses)).toBe(true);
    await ctx.close();
  });

  it('L-05 · 侧栏带 print:hidden 且打印媒体下 display:none', async () => {
    const { ctx, page } = await openAt(1600, 900);
    const m = await measure(page);
    expect(m.sidebarHasPrintHidden).toBe(true);

    // print media 模拟：打印时侧栏 display 应为 none（第二道保险）
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(200);
    const printDisplay = await page.evaluate(() => {
      const el = document.querySelector('[data-app-sidebar]');
      return el ? getComputedStyle(el).display : 'MISSING';
    });
    expect(printDisplay).toBe('none');
    await ctx.close();
  });

  it('L-06 · 副标题改为行业中性表述', async () => {
    const { ctx, page } = await openAt(1600, 900);

    /**
     * 精确断言「副标题那个 span 的**直接文本**」。
     * 不用 `header.textContent.includes(...)`：品牌块外层 span 会拼成
     * 「ID Plan项目排期与交付管理」，既易误判也测不到「副标题单独是什么」。
     * 用 `:scope` 取「自身直接文本」——在 span 集合里找满足正则的**最内层**元素。
     */
    const subtitle = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('header span')).filter(
        (s) =>
          Array.from(s.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && /室内设计项目管理|项目排期与交付管理/.test(n.textContent ?? ''),
          ),
      );
      const target = spans[spans.length - 1];
      return target
        ? Array.from(target.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? '')
            .join('')
            .trim()
        : null;
    });

    expect(subtitle).toBe('项目排期与交付管理');
    // 旧文案必须彻底消失（全页范围，防止别处残留）
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('室内设计项目管理');
    await ctx.close();
  });

  it('L-07 · 暗色主题顶栏/侧栏 token 自动换肤（无额外适配）', async () => {
    const { ctx, page } = await openAt(1600, 900);

    const readColors = (): Promise<{ header: string; sidebar: string; theme: string | null }> =>
      page.evaluate(() => {
        const h = document.querySelector('header');
        const s = document.querySelector('[data-app-sidebar]');
        return {
          header: h ? getComputedStyle(h).backgroundColor : '',
          sidebar: s ? getComputedStyle(s).backgroundColor : '',
          theme: document.documentElement.getAttribute('data-theme'),
        };
      });

    const light = await readColors();
    expect(light.theme).toBe('light');

    /**
     * 主题切换的**正确机制**是 `<html data-theme="dark">`（`src/hooks/useTheme.ts`），
     * 全局 CSS 用 `:root[data-theme='dark']` 覆盖 token。
     * 注意：**不能**用 `classList.add('dark')` —— 本项目的暗色不是 Tailwind
     * `darkMode: 'class'` 那套，加 class 不会换肤（首版探针即栽在此处，
     * 表现为「暗色下颜色不变」的假阴性）。
     */
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(400);
    const dark = await readColors();

    expect(dark.theme).toBe('dark');
    // token 换肤：两个常驻表面都应变化（说明走 CSS 变量而非硬编码色）
    expect(light.header).not.toBe('');
    expect(dark.header).not.toBe(light.header);
    expect(dark.sidebar).not.toBe(light.sidebar);
    await ctx.close();
  });

  it('L-08 · 无双重留白（main 是宽度唯一锚点，≈视口宽 − 侧栏宽）', async () => {
    const { ctx, page } = await openAt(1600, 900);
    const m = await measure(page);

    const expected = 1600 - m.sidebarWidth;
    expect(m.sidebarWidth).toBe(240);
    expect(Math.abs(m.mainWidth - expected)).toBeLessThanOrEqual(2);

    // 顶栏内不应再有第二层 max-w 容器（原 :124 的 max-w-[1600px] 已删）
    const headerHasMaxW = await page.evaluate(() =>
      Array.from(document.querySelectorAll('header *')).some((el) =>
        (el.className || '').toString().includes('max-w-[1600px]'),
      ),
    );
    expect(headerHasMaxW).toBe(false);
    await ctx.close();
  });

  it('§3.5 · 顶栏去 glass 浮起 + 保留底部 sand 分隔线', async () => {
    const { ctx, page } = await openAt(1600, 900);
    const m = await measure(page);
    expect(m.headerHasGlass).toBe(false);
    expect(parseFloat(m.headerBorderBottom)).toBeGreaterThan(0);
    await ctx.close();
  });
});

// 产物/浏览器缺失时给出可操作的提示（避免「skip 静默通过」被误读为已验收）
describe('v0.7 阶段 A · 验收前置检查', () => {
  it('构建产物与 Chromium 可用（缺失则上面的验收被跳过）', () => {
    if (!CAN_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        `[layout-walkthrough] 跳过验收：build-dist 存在=${existsSync(DIST_INDEX)} chromium 存在=${CHROMIUM_PATH !== null}。` +
          ' 请先 npm run build（Chromium 由 playwright-core 依赖安装）。',
      );
    }
    expect(true).toBe(true);
  });
});
