import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { listenOnSafePort } from './helpers/safe-listen';

/**
 * v0.8 · 用户真机反馈第 7 条 ·「已选顺序」行内控件真几何验收（真实构建产物 + 真 Chromium）。
 *
 * ── 背景 ──
 *   用户在 Windows 真机指出「新建项目 → 手动建档 → 已选顺序」区块，填天数的地方
 *   UI 上下没对齐。本 spec 用**真浏览器 + 真产物 CSS** 直接量同一行内各控件的
 *   getBoundingClientRect，先打印三档视口（xl 1280 / md 768 / 桌面 1600）的真实数值，
 *   再据此修复，并以写死的验收判据断言修复后「垂直中心一致 / 高度一致 / 基线与『天』齐平」。
 *
 * ── 为什么必须真浏览器（与 ui-batch-a-geometry 同理由）──
 *   jsdom 的 getBoundingClientRect 恒 0、getComputedStyle 对 Tailwind 工具类恒空串，
 *   「上下没对齐」是**布局几何**问题，只能在真渲染里读到真像素。
 *
 * ── 前置（与 layout-walkthrough / ui-batch-a-geometry 同口径）──
 *   `npm run build` 必须先跑过，且产物不得早于任一构建输入；否则整组 skip
 *   （几何验收属「发布前走查」，不该让「没构建」把默认 npm test 染红；但产物过期时的
 *   skip 是必须的，否则测的是上一版界面、会「误报绿」）。
 *
 * ── 变异验证 ──
 *   把输入组高度改回不统一 / 把「天」移出输入组，本 spec 必须变红；修复后必须全绿。
 *   （见下方注释与最终报告）
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
    if (!existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
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

const IDPLAN_STUB = `
window.__tbCalls = [];
window.idplan = {
  isDesktop: true,
  platform: 'win32',
  version: '0.0.0.0',
  setTitleBarTheme: function (t) { window.__tbCalls.push(t); },
  checkUpdate: function () {
    return Promise.resolve({ current: '0.0.0.0', latest: '0.0.0.0', hasUpdate: false,
      releaseUrl: null, publishedAt: null, notes: null, exeAssetUrl: null });
  },
  onUpdateAvailable: function () { return function () {}; },
};
`;

const HEAVY = 30000;

/** 量一行内所有关键控件的几何（垂直中心与高度），返回结构化明细 */
function probeRow(page: Page, rowIndex: number) {
  return page.evaluate((idx) => {
    const li = document.querySelector(`li[data-testid="selected-row-${idx}"]`);
    if (!li) return { error: 'row-not-found' };
    const r2 = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top * 100) / 100,
        height: Math.round(r.height * 100) / 100,
        centerY: Math.round((r.top + r.height / 2) * 100) / 100,
        width: Math.round(r.width * 100) / 100,
      };
    };
    const liRect = li.getBoundingClientRect();
    const rowCenter = Math.round((liRect.top + liRect.height / 2) * 100) / 100;

    const indexEl = li.children[0] as HTMLElement | null; // 序号 span
    const dotEl = li.children[1] as HTMLElement | null; // 色点 span
    const nameEl = li.children[2] as HTMLElement | null; // 名称 span（truncate）
    const input = li.querySelector('input[type="number"]') as HTMLInputElement | null;
    const durOuter = input ? (input.parentElement as HTMLElement | null) : null; // 时长输入组外层
    const tian = input ? (input.nextElementSibling as HTMLElement | null) : null; // 「天」span
    const ratioEl = Array.from(li.querySelectorAll('span')).find((s) =>
      (s.textContent ?? '').trim().endsWith('%'),
    ) as HTMLElement | null; // 占比
    const sortCtrl = li.lastElementChild as HTMLElement | null; // 排序控制 span
    const sortBtn = sortCtrl ? (sortCtrl.querySelector('button') as HTMLElement | null) : null; // 排序钮

    return {
      rowCenter,
      index: r2(indexEl),
      dot: r2(dotEl),
      name: r2(nameEl),
      durOuter: r2(durOuter),
      input: r2(input),
      tian: r2(tian),
      ratio: r2(ratioEl),
      sortCtrl: r2(sortCtrl),
      sortBtn: r2(sortBtn),
    };
  }, rowIndex);
}

describe.skipIf(!CAN_RUN_FRESH)('v0.8 · 已选顺序行内控件真几何（真实构建产物 + 真 Chromium）', () => {
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

  /** 开首页 → 确立管理员身份（消掉首次引导弹窗，免得挡住点击）→ 进手动建档面板 */
  async function openPanel(w: number, h: number): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(IDPLAN_STUB);
    const page = await ctx.newPage();
    await page.goto(DIST_URL);
    await page.waitForSelector('header', { timeout: 20000 });

    // 首次引导弹窗：存在才消（已预置身份的环境没有，直接跳过）
    const gateBtn = page.locator('button', { hasText: '我是管理员' });
    if (await gateBtn.count()) {
      await gateBtn.first().click();
      await page.waitForTimeout(400);
      await page.locator('input[placeholder="你的姓名"]').fill('严过关');
      const confirm = page.locator('button', { hasText: '确认为管理员' });
      if (await confirm.count()) await confirm.first().click();
      await page.waitForTimeout(800);
    }
    // 0.8.3：身份流走完后 FirstRunGuide 欢迎卡紧接出现（空库环境必弹）——
    // 不消掉会遮住后续所有点击。本族测的是控件几何，走「先四处看看」线；
    // 示例分支由 first-run-guide.spec.tsx / demo-data.spec.ts 覆盖。
    const guideSkip = page.locator('button', { hasText: '先四处看看' });
    if (await guideSkip.count()) {
      await guideSkip.first().click();
      await page.waitForTimeout(500);
    }


    // 打开「新建项目」→ ManualFallbackForm
    //   ≥xl：侧栏常驻（[data-app-sidebar] 内可见按钮；汉堡在 ≥xl 是 xl:hidden，仅留 DOM）
    //   <xl：侧栏收成 Modal 抽屉，先点（可见的）汉堡「打开导航菜单」展开抽屉，再点抽屉里的「新建项目」
    //   ⚠️ 必须用 isVisible 判定：≥xl 时汉堡仍是 DOM 节点（count=1）但 display:none，
    //      若按 count 走会去 click 一个不可见元素 → Playwright 等到 30s 超时。
    const hamburger = page.locator('button[aria-label="打开导航菜单"]');
    const hbVisible = await hamburger.first().isVisible().catch(() => false);
    if (hbVisible) {
      await hamburger.first().click();
      await page.waitForTimeout(400);
      const drawerNew = page.locator('[role="dialog"] button[aria-label="新建项目"]');
      await drawerNew.first().click();
    } else {
      const sideNew = page.locator('[data-app-sidebar] button[aria-label="新建项目"]');
      await sideNew.first().click();
    }
    await page.waitForTimeout(600);

    /*
      ★ 反馈 #5 之后的口径变化（本 spec 必须跟着改，否则必然超时）：
        · 手动建档**首开不预选任何行业/主板块**，阶段池因此为空（已选 0 项）；
        · 「已选顺序」是「已选项」的列表 ⇒ 0 项时 `li[data-testid="selected-row-N"]`
          一个都不渲染，直接等它只会等到超时。
      这里显式选定主板块「室内」——选中即触发 `ManualFallbackForm` 的
      「主板块 → 套餐」联动（自动带出该板块默认套餐），行才会渲染出来。
      这也是用户真实操作路径：先点行业/板块，再展开阶段折叠区挑阶段。
    */
    // v0.8.5：IndustrySelect 自定义下拉替换原生 select（她截图 #8）——改点击流程
await page.click('[data-industry-select-trigger]');
await page.click('[data-industry-select-option="indoor"]');
    await page.waitForTimeout(300);

    // 展开「本次服务阶段」折叠区 → StageSelectPanel 可见
    const fold = page.locator('button', { hasText: '本次服务阶段' });
    await fold.first().click();
    await page.waitForTimeout(500);

    // 等到第 1 行已选顺序渲染
    await page.waitForSelector('li[data-testid="selected-row-1"]', { timeout: 10000 });
    await page.waitForTimeout(300); // 等 CSS 应用完
    return { ctx, page };
  }

  const VIEWPORTS: Array<[number, number, string]> = [
    [1280, 900, 'xl 1280 (临界)'],
    [768, 900, 'md 768'],
    [1600, 900, '桌面 1600'],
  ];

  for (const [w, h, label] of VIEWPORTS) {
    it(`真几何 · ${label} · 行内控件垂直中心/高度/「天」基线对齐`, async () => {
      const { ctx, page } = await openPanel(w, h);
      try {
        const m = await probeRow(page, 1);
        // 也量第 5 行，确认不是单行特例
        const m5 = await probeRow(page, 5);

        // eslint-disable-next-line no-console
        console.log(`[stage-rows-geom][${label}] row1=`, JSON.stringify(m));
        // eslint-disable-next-line no-console
        console.log(`[stage-rows-geom][${label}] row5=`, JSON.stringify(m5));

        expect(m.error).toBeUndefined();
        expect(m5.error).toBeUndefined();

        const EPS = 1; // 垂直中心容差（px）
        const HE = 0.5; // 高度一致容差（px，防 sub-pixel 取整抖动）

        // ① 垂直中心一致：各控件与行中心之差 ≤ 1px
        for (const [name, box] of Object.entries({
          序号: m.index,
          色点: m.dot,
          名称: m.name,
          时长输入组: m.durOuter,
          input: m.input,
          天: m.tian,
          占比: m.ratio,
          排序控制: m.sortCtrl,
          排序钮: m.sortBtn,
        })) {
          expect(Math.abs((box as any).centerY - m.rowCenter), `${label} ${name} 垂直中心偏移`).toBeLessThanOrEqual(EPS);
        }

        // ② 高度一致：输入组 / 占比单元 / 排序钮 三者 height 相等且为同一值
        const hDur = m.durOuter!.height;
        const hRatio = m.ratio!.height;
        const hSort = m.sortCtrl!.height;
        expect(Math.abs(hDur - hRatio), `${label} 输入组 vs 占比 高度`).toBeLessThanOrEqual(HE);
        expect(Math.abs(hDur - hSort), `${label} 输入组 vs 排序钮 高度`).toBeLessThanOrEqual(HE);
        expect(Math.abs(hRatio - hSort), `${label} 占比 vs 排序钮 高度`).toBeLessThanOrEqual(HE);

        // ③ input 与「天」同一基线：垂直中心之差 ≤ 1px
        expect(Math.abs(m.input!.centerY - m.tian!.centerY), `${label} input 与『天』基线偏移`).toBeLessThanOrEqual(EPS);
      } finally {
        await ctx.close();
      }
    }, HEAVY);
  }
});

describe('v0.8 · 已选顺序真几何前置检查（跳过时给出可操作提示）', () => {
  it('构建产物、Chromium 可用且产物未过期（否则上面的几何验收被跳过）', () => {
    if (!CAN_RUN_FRESH) {
      // eslint-disable-next-line no-console
      console.warn(
        `[stage-select-rows-geometry] 跳过几何验收：build-dist=${existsSync(DIST_INDEX)} ` +
          `chromium=${CHROMIUM_PATH !== null} 过期输入=${STALE.join(', ') || '(无)'}。` +
          ' 请先 npm run build 再跑 npm test ——否则测的是上一版界面。',
      );
    }
    expect(true).toBe(true);
  });
});
