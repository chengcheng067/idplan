import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { listenOnSafePort } from './helpers/safe-listen';

/**
 * 设置抽屉 · 六区分区（v0.8.6 · 反馈 #7）——真构建产物 + 真 Chromium。
 *
 * 她的原话：「设置里面有非常混乱每个部分应该属于哪一个栏，这些都是看不清楚的」，
 * 并授权「按我们软件自己的需求分区，不必对齐 ID-Aura」。落地为「左导航 168 +
 * 右侧内容」双栏、六个分区按序：外观 / 排程 / 数据与备份 / Agent 与自动化 /
 * 行业与模板 / 关于。
 *
 * 本 spec 守五件用户能看见的事：
 *   ① 分区导航切换后，右侧内容**确实跟着换**（默认「外观」；点「数据与备份」
 *      见日志与备份、点「插件」见插件开关；当前区 aria-current 高亮移动）；
 *   ② <xl 窄视口**不断裂**：左导航退化为顶部横向条，位于内容上方、可点可见，
 *      点完内容切换；抽屉自身不横向溢出视口；
 *   ③ 768–1279（<xl 非手机档）：七个导航按钮同屏可点，不依赖横滑；
 *   ④ ≥xl 贴缘几何（v0.8.6.0002 · 反馈 #1）：抽屉左缘 = 侧栏右缘（展开 240 /
 *      收起 64，折叠后随缘移动），遮罩不压侧栏（侧栏中心命中测试仍是侧栏自己）；
 *   ⑤ 按角色收分区（v0.8.6.0002 · 反馈 #11）：管理员看得到「行业与模板」，
 *      成员看不到（整分区消失，不是禁用；插件对成员保留）。
 *
 * 为什么不走 jsdom：②③ 是 flex 断点几何 + 横滑容器的事实，jsdom 的
 * getBoundingClientRect 恒 0、overflow-x-auto 无概念，只有真 Chromium 能验。
 * 几何口径与 qa-batch-a-verify.spec.ts 的 Q-A2 同底座（build-dist + 静态服务 +
 * 过期守卫），避免两套真浏览器判据漂移。
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

/** 产物是否早于任一构建输入 → 过期守卫（过期时 skip，避免拿上一版界面误报绿） */
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
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  const server = http.createServer((req, res) => {
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
  // listen(0) 的随机端口可能撞 Chromium 不安全端口黑名单（ERR_UNSAFE_PORT 假红）⇒ 安全 listen
  return listenOnSafePort(server);
}

/** 桌面端 stub（自绘三键 + 更新探测），与 qa-batch-a-verify 同口径 */
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

/** 分区导航键（与产品 ZONES 同序；data-settings-zone 钩子值。v0.8.6.0002 反馈 #2 起为七区） */
const ZONE_KEYS = [
  'appearance',
  'schedule',
  'data',
  'plugins',
  'agent',
  'industry',
  'about',
] as const;

describe.skipIf(!CAN_RUN_FRESH)('设置抽屉 · 分区与贴缘几何（反馈 #7 / #1 · 真 Chromium）', () => {
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
  ): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(IDPLAN_STUB);
    const page = await ctx.newPage();
    await page.goto(DIST_URL);
    await page.waitForSelector('header', { timeout: 20000 });
    await page.waitForTimeout(500);
    return { ctx, page };
  }

  /** 确立管理员身份（同 qa-batch-a-verify 口径） */
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

  /** 真鼠标点侧栏「设置」（取可见的那枚：展开/收起两态各一） */
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

  /** 等左滑入场动画播完再量几何（drawer-in-left 200ms） */
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

  /** <md 走「⋮ 更多 → 设置」入口 */
  async function openSettingsViaMoreMenu(page: Page): Promise<void> {
    await page.locator('button[aria-label="更多操作"]').first().click();
    await page.waitForTimeout(400);
    await page
      .locator('[role="menu"] [role="menuitem"]', { hasText: '设置' })
      .first()
      .click();
    await waitSettingsDrawer(page);
  }

  /**
   * 走真实旅程成为**成员**身份（v0.8.6.0002 · 反馈 #11 的对照组）。
   * 全走 UI、不预制 IndexedDB（与 f3-sidebar-identity 同口径）：
   *   ① 先确立管理员（前几步同 becomeAdmin，但**不**跳过首启引导卡）；
   *   ② 点引导卡「室内」⇒ 覆盖导入示例数据（buildDemoBackup 含 demo 成员：
   *      陈工/周工/吴工/郑工 均为 member）+ reload；
   *   ③ reload 后身份为空（示例数据整库替换了 members）⇒ 姓名输入「陈工」
   *      进入成员身份。
   */
  async function becomeMember(page: Page): Promise<void> {
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
    // ② 引导卡 → 覆盖导入二次确认（「确认载入」）→ 示例数据导入 + reload
    //    （示例项目名出现 = 导入生效；与 f3-sidebar-identity 同口径）
    const card = page.locator('[data-first-run-card="indoor"]');
    await card.first().waitFor({ state: 'visible', timeout: 10000 });
    await card.first().click();
    await page.waitForTimeout(400);
    await page.locator('button', { hasText: '确认载入' }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes('云栖·湖畔茶室'), undefined, {
      timeout: 20000,
    });
    await page.waitForTimeout(800);
    // ③ 以成员姓名进入（hasAdmin ⇒ 直接姓名输入流，adminIntent=false）
    await page.locator('button', { hasText: '点击进入' }).first().click();
    await page.waitForTimeout(400);
    await page.locator('input[placeholder="你的姓名"]').fill('陈工');
    await page.locator('button', { hasText: '下一步' }).first().click();
    await page.waitForTimeout(1200);
    // 自检：顶栏出现的是成员姓名（不是「点击进入」），否则后续断言 vacuous
    await page.waitForFunction(() => document.body.innerText.includes('陈工'), undefined, {
      timeout: 8000,
    });
  }

  it('S-Z1 · 分区导航：默认「外观」，点击切换后右侧内容确实跟着换、高亮跟着走（插件为独立一级分区）', async () => {
    const { ctx, page } = await open(1600, 900);
    try {
      await becomeAdmin(page);
      await clickSidebarSettings(page);
      await waitSettingsDrawer(page);

      const drawer = page.locator('[data-settings-drawer]');
      const panel = page.locator('[data-settings-zone-panel]');

      // 默认区 = 外观：主题三选在场（「侧栏 展开/折叠」选项已于 0.8.6.0002
      // 反馈 #4 后半拿掉——侧栏上本来就有折叠开关，不设两个真相源）
      expect(await drawer.innerText(), '默认应落在「外观」区').toContain('主题');
      expect(await drawer.innerText()).toContain('跟随系统');
      expect(
        await drawer.innerText(),
        '外观区不得再出现「侧栏 展开/折叠」两选（反馈 #4 后半）',
      ).not.toContain('宽屏（≥xl）下侧栏的默认形态');
      expect(await panel.getAttribute('data-settings-zone-panel')).toBe('appearance');
      expect(
        await page.locator('[data-settings-zone="appearance"]').getAttribute('aria-current'),
      ).toBe('true');

      // 切「排程」：休息制度（管理员）+ 排期基准说明；主题应随分区 disappear
      await page.locator('[data-settings-zone="schedule"]').click();
      expect(await panel.getAttribute('data-settings-zone-panel')).toBe('schedule');
      expect(await drawer.innerText()).toContain('休息制度');
      expect(await drawer.innerText()).toContain('排期基准');
      expect(await drawer.innerText(), '切区后上一区内容不得残留').not.toContain('跟随系统');

      // 切「数据与备份」：日志 + 备份两枚 + 数据存在哪
      await page.locator('[data-settings-zone="data"]').click();
      const dataText = await drawer.innerText();
      expect(dataText).toContain('前端日志');
      expect(dataText).toContain('保存备份');
      expect(dataText).toContain('导入备份');
      expect(dataText).toContain('数据存在哪');
      expect(dataText).not.toContain('休息制度');

      // 切「插件」（v0.8.6.0002 · 反馈 #2：插件升为一级分区）：
      // 插件开关 + 从文件安装/卸载入口都在这里（桌面端渲染安装钮）
      await page.locator('[data-settings-zone="plugins"]').click();
      const pluginsText = await drawer.innerText();
      expect(pluginsText).toContain('插件');
      expect(pluginsText).toContain('从文件安装');
      expect(pluginsText).toContain('已装');
      expect(pluginsText).not.toContain('前端日志');

      // 切「Agent 与自动化」：席位/本地库 + 自然语言通道 + 看板入口；
      // 插件已拆去独立分区，本区不得再出现插件开关（层级修正的判别力）
      await page.locator('[data-settings-zone="agent"]').click();
      const agentText = await drawer.innerText();
      expect(agentText).toContain('Agent 与本地库');
      expect(agentText).toContain('自然语言通道');
      expect(agentText).toContain('打开 Agent 看板');
      expect(agentText, '插件应只在「插件」分区，Agent 区不得残留').not.toContain('从文件安装');
      expect(agentText).not.toContain('保存备份');

      // 切「行业与模板」：行业库三步流
      await page.locator('[data-settings-zone="industry"]').click();
      const industryText = await drawer.innerText();
      expect(industryText).toContain('行业库（自定义）');
      expect(industryText).toContain('复制提示词');
      expect(industryText).toContain('导回这里');

      // 切「关于」：版本 + 开源许可 + 两张预留卡（图片待补）
      await page.locator('[data-settings-zone="about"]').click();
      const aboutText = await drawer.innerText();
      expect(aboutText).toContain('版本号');
      expect(aboutText).toContain('开源许可');
      expect(aboutText).toContain('赞赏支持');
      expect(aboutText).toContain('反馈建议');
      expect(aboutText).toContain('图片待补');
      expect(aboutText).not.toContain('复制提示词');

      // 高亮跟着走：about 当前、appearance 不再是 current
      expect(await page.locator('[data-settings-zone="about"]').getAttribute('aria-current')).toBe(
        'true',
      );
      expect(
        await page.locator('[data-settings-zone="appearance"]').getAttribute('aria-current'),
      ).toBeNull();

      // 七个导航键一个不少（顺序即分区顺序）
      const keys = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-settings-zone]')).map((b) =>
          b.getAttribute('data-settings-zone'),
        ),
      );
      expect(keys).toEqual([...ZONE_KEYS]);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('S-Z2 · <md 手机档（390）：左导航退化为顶部横条，位于内容上方、可点，内容跟着换；抽屉不横向溢出', async () => {
    const { ctx, page } = await open(390, 844);
    try {
      await becomeAdmin(page);
      await openSettingsViaMoreMenu(page);

      const geo = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="设置分区"]') as HTMLElement | null;
        const panel = document.querySelector('[data-settings-zone-panel]') as HTMLElement | null;
        const drawer = document.querySelector('[data-settings-drawer]') as HTMLElement | null;
        if (!nav || !panel || !drawer) return null;
        const nr = nav.getBoundingClientRect();
        const pr = panel.getBoundingClientRect();
        const dr = drawer.getBoundingClientRect();
        return {
          navBottom: nr.bottom,
          panelTop: pr.top,
          panelWidth: pr.width,
          panelHeight: pr.height,
          drawerRight: dr.right,
          vw: window.innerWidth,
          navScrollable: nav.scrollWidth > nav.clientWidth,
        };
      });
      expect(geo).not.toBeNull();
      // 横条在内容上方（<xl 是上下堆叠，不是左右分栏）
      expect(geo!.navBottom).toBeLessThanOrEqual(geo!.panelTop + 1);
      // 内容区有实际宽高（没被导航压没）
      expect(geo!.panelWidth).toBeGreaterThan(200);
      expect(geo!.panelHeight).toBeGreaterThan(200);
      // 抽屉不横向溢出视口（不断裂）
      expect(geo!.drawerRight).toBeLessThanOrEqual(geo!.vw + 1);
      // 390 档导航横滑是预期形态（七个区分横排放不下），不视为断裂
      expect(geo!.navScrollable).toBe(true);

      // 可点：点横条里的「数据与备份」，右侧内容真的换成日志/备份
      const dataBtn = page.locator('[data-settings-zone="data"]');
      await dataBtn.scrollIntoViewIfNeeded();
      await dataBtn.click();
      const text = await page.locator('[data-settings-drawer]').innerText();
      expect(text).toContain('前端日志');
      expect(text).toContain('保存备份');
      expect(await page.locator('[data-settings-zone-panel]').getAttribute('data-settings-zone-panel')).toBe(
        'data',
      );
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('S-Z3 · <xl 非手机档（767）：七个导航按钮同屏可点（不依赖横滑），点完内容跟着换', async () => {
    const { ctx, page } = await open(767, 900);
    try {
      await becomeAdmin(page);
      await openSettingsViaMoreMenu(page);

      const fits = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="设置分区"]') as HTMLElement | null;
        if (!nav) return null;
        const btns = Array.from(nav.querySelectorAll<HTMLElement>('[data-settings-zone]'));
        return {
          count: btns.length,
          // 每个按钮完整落在导航容器视框内（不需要横滑即可点）
          allVisible: btns.every((b) => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.left >= nav.getBoundingClientRect().left - 1;
          }),
          navScrollable: nav.scrollWidth > nav.clientWidth + 1,
          navBottomOverPanel: nav.getBoundingClientRect().bottom,
          panelTop: (document.querySelector('[data-settings-zone-panel]') as HTMLElement).getBoundingClientRect().top,
        };
      });
      expect(fits).not.toBeNull();
      expect(fits!.count).toBe(7);
      expect(fits!.allVisible, '767 档七个导航按钮应同屏完整可见').toBe(true);
      expect(fits!.navScrollable, '767 档不需要横滑').toBe(false);
      expect(fits!.navBottomOverPanel).toBeLessThanOrEqual(fits!.panelTop + 1);

      // 逐区点一遍，内容都换得动（真点击，不是 evaluate 空转）
      await page.locator('[data-settings-zone="appearance"]').click();
      expect(await page.locator('[data-settings-drawer]').innerText()).toContain('跟随系统');
      await page.locator('[data-settings-zone="about"]').click();
      expect(await page.locator('[data-settings-drawer]').innerText()).toContain('图片待补');
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('S-Z4 · ≥xl 抽屉贴侧栏右缘展开：侧栏保持可见可点，折叠后抽屉随缘到 64（反馈 #1）', async () => {
    /*
     * v0.8.6.0002 · 反馈 #1（她的原话见文件头）：设置面板不再盖住侧栏，而是
     * 从侧栏右缘开始、紧贴侧栏右侧展开——侧栏保持可见可点（她想设置时还能切侧栏）。
     * 判据全部是可证伪的实测几何：
     *   ① 抽屉左缘 = 侧栏右缘（展开 240）；
     *   ② 遮罩不压侧栏：elementFromPoint 点侧栏中心，命中的是侧栏自己；
     *   ③ 真点侧栏上的折叠开关 ⇒ 抽屉左缘随缘到 64，侧栏仍不被压。
     */
    const { ctx, page } = await open(1600, 900);
    try {
      await becomeAdmin(page);
      await clickSidebarSettings(page);
      await waitSettingsDrawer(page);

      const probe = () =>
        page.evaluate(() => {
          const drawer = document.querySelector('[data-settings-drawer]') as HTMLElement | null;
          const sidebar = document.querySelector('[data-app-sidebar]') as HTMLElement | null;
          if (!drawer || !sidebar) return null;
          const dr = drawer.getBoundingClientRect();
          const sr = sidebar.getBoundingClientRect();
          const hit = document.elementFromPoint(sr.x + sr.width / 2, sr.y + sr.height / 2);
          return {
            drawerLeft: dr.left,
            drawerWidth: dr.width,
            drawerRight: dr.right,
            sidebarWidth: sr.width,
            sidebarRight: sr.right,
            sidebarCenterHit: !!hit && sidebar.contains(hit),
            vw: window.innerWidth,
          };
        });

      // ① 展开态：抽屉左缘 = 侧栏右缘（240），宽 640，右缘不越界
      const m = await probe();
      expect(m).not.toBeNull();
      expect(Math.round(m!.sidebarWidth)).toBe(240);
      expect(Math.abs(m!.drawerLeft - m!.sidebarRight), '抽屉左缘应贴合侧栏右缘').toBeLessThanOrEqual(1);
      expect(Math.round(m!.drawerWidth)).toBe(640);
      expect(m!.drawerRight).toBeLessThanOrEqual(m!.vw + 0.5);
      // ② 侧栏保持可见可点：中心命中的是侧栏自己（不是抽屉/遮罩）
      expect(m!.sidebarCenterHit, '抽屉或遮罩盖住了侧栏（反馈 #1 的形态要件）').toBe(true);

      // ③ 折叠侧栏（真点侧栏上的折叠开关，设置在打开期间也能点）⇒ 随缘到 64
      await page.locator('[data-app-sidebar] button[aria-label="收起侧边栏"]').first().click();
      await page.waitForTimeout(600); // 侧栏宽度过渡 180ms + 余量
      const c = await probe();
      expect(c).not.toBeNull();
      expect(Math.round(c!.sidebarWidth)).toBe(64);
      expect(Math.abs(c!.drawerLeft - c!.sidebarRight), '折叠后抽屉应随缘到 64').toBeLessThanOrEqual(1);
      expect(c!.sidebarCenterHit, '折叠态侧栏仍不被压').toBe(true);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('S-Z5 · 按角色收分区：管理员看得到「行业与模板」，成员看不到（插件保留）（反馈 #11）', async () => {
    /*
     * v0.8.6.0002 · 反馈 #11，她的原话：「成员看板的设置界面，是不是'行业与
     * 模板'这个位置就可以让它消失掉，不需要有吧」。

     * 规则（实现侧口径）：行业库是**管理职能**（导入的自定义阶段/套餐会进
     * 所有人的建档器）⇒ 成员身份下「行业与模板」**整分区从左导航消失**
     * （不是禁用占位）；插件**保留给成员**（她明确「插件给成员保留」）；
     * 其余分区两角色均可见。对照组全走真 UI（becomeMember 走示例数据 +
     * 姓名进入），管理员/成员各起一个 context。
     */
    // ① 管理员：行业与模板在导航里，内容可点开
    {
      const { ctx, page } = await open(1600, 900);
      try {
        await becomeAdmin(page);
        await clickSidebarSettings(page);
        await waitSettingsDrawer(page);
        expect(await page.locator('[data-settings-zone="industry"]').count()).toBe(1);
        await page.locator('[data-settings-zone="industry"]').click();
        expect(await page.locator('[data-settings-drawer]').innerText()).toContain('行业库（自定义）');
      } finally {
        await ctx.close();
      }
    }

    // ② 成员：行业与模板整分区消失；插件区仍在
    {
      const { ctx, page } = await open(1600, 900);
      try {
        await becomeMember(page);
        await clickSidebarSettings(page);
        await waitSettingsDrawer(page);

        expect(
          await page.locator('[data-settings-zone="industry"]').count(),
          '成员身份下「行业与模板」应整分区消失（不是禁用）',
        ).toBe(0);
        // 插件保留给成员（她明确「插件给成员保留」）
        expect(await page.locator('[data-settings-zone="plugins"]').count()).toBe(1);
        await page.locator('[data-settings-zone="plugins"]').click();
        const pluginsText = await page.locator('[data-settings-drawer]').innerText();
        expect(pluginsText).toContain('从文件安装');
        expect(pluginsText, '成员看不到行业库').not.toContain('行业库（自定义）');

        // 导航键集合 = 七区减去行业与模板（顺序不变）
        const keys = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-settings-zone]')).map((b) =>
            b.getAttribute('data-settings-zone'),
          ),
        );
        expect(keys).toEqual(['appearance', 'schedule', 'data', 'plugins', 'agent', 'about']);
      } finally {
        await ctx.close();
      }
    }
  }, 90000);
});
