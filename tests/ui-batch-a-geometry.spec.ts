import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * v0.7 批次 A · A4「首页视图切换（lg 档）」**真几何**验收（真构建产物 + 真 Chromium）。
 *
 * ── 为什么必须有这个文件（本文件的全部存在理由）──
 *   A4 原来的验收写在 `tests/ui-batch-a.spec.tsx`（jsdom）里，用例名写着「r12」，
 *   断言却是 `tabs[0].className).toContain('rounded-xl')`。这条断言**证明不了圆角是
 *   几像素**，而缺陷恰好藏在这个缝里：
 *
 *     `tailwind.config.ts:235-245` 重定义了 borderRadius 刻度 ——
 *       sm=8 / DEFAULT=md=12 / lg=16 / **xl=16** / 2xl=16 / 3xl=24
 *     所以 `rounded-xl` 在本仓库渲染成 **16px**（Tailwind 默认是 12px），
 *     于是「凭直觉写 rounded-xl 以为是 12」在**类名断言下永远绿**。
 *
 *   根因是「类名 ≠ 渲染值」：jsdom 既不加载 Tailwind 产物 CSS，也不做 类→像素 映射，
 *   `getComputedStyle` 对 Tailwind 工具类恒返回空串。要判定「渲染成几像素」，
 *   只能在**真浏览器 + 真产物 CSS** 里读 `getComputedStyle().borderRadius`。
 *
 *   ⚠️ 这也意味着：**任何「圆角/尺寸」类断言都是不可证伪的**。本 spec 是对该类断言的
 *   唯一替代品，改 `SegmentedControl` 的圆角键名时它必须变红（见下方「变异测试」）。
 *
 * ── 变异测试（本文件可信度的自证，已执行）──
 *   把 `SegmentedControl.tsx` 里 lg 档项的 `rounded-md` 改回 `rounded-xl` → 重跑
 *   `npm run build` → 本 spec A4-G1 **必须变红**（实测收到 `16px`，期望 `12px`）；
 *   改回 `rounded-md` 后恢复全绿。若某次改动后它不再变红，说明它已退化为空气断言。
 *
 * ── 前置 ──
 *   `npm run build` 必须先跑过，且产物不得早于任一构建输入（否则整组 skip）——
 *   几何验收属于「发布前走查」，不该让「没构建」把默认 `npm test` 染红；
 *   但**产物过期时的 skip 是必须的**：那时测的是上一版界面，可能「误报绿」，比不跑更坏。
 *
 * ── 产物必须经 HTTP 提供 ──
 *   `vite.config.ts` 的 `base: '/'` 使产物引用 `/assets/*` 绝对路径，`file://` 下会解析到
 *   盘根 → 404 → 应用根本不挂载（DOM 里连 `[role="tablist"]` 都没有），表现为极具误导性的
 *   全红。故此处起零依赖只读静态服务器（node:http）并显式设置 Content-Type
 *   （缺 Content-Type 时 Chromium 会拒绝执行 module script → 同样是不挂载的假红）。
 */

const DIST_INDEX = resolve(__dirname, '..', 'build-dist', 'index.html');

/** 首页视图切换控件的稳定锚点（`HomePage.tsx:121` 的 ariaLabel） */
const VIEW_SWITCH = '[role="tablist"][aria-label="首页视图切换"]';

/** 探测已安装的 chromium 可执行文件（跨平台；与 layout-walkthrough 同一实现） */
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

/** 参与「产物是否过期」判定的构建输入（与 layout-walkthrough 同口径） */
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

/**
 * 产物是否早于任一构建输入（过期样例最多 3 个）。
 *
 * 为什么必须挡：本 spec 读的是**产物里已编译好的 CSS**。改完 `SegmentedControl.tsx`
 * 忘了 `npm run build` 时，读到的仍是上一版圆角 —— 而这次我们要证明的恰恰是
 * 「源码里的键名 → 产物 CSS 的像素」这条链，跳过 build 等于测了个寂寞。
 */
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

const STALE_INPUTS = CAN_RUN ? staleInputs() : [];
const CAN_RUN_FRESH = CAN_RUN && STALE_INPUTS.length === 0;

/**
 * 零依赖只读静态服务器。
 *
 * 与 `layout-walkthrough.spec.ts` 的差异（有意为之）：**缺失的资源一律 404**。
 * 若对 `/assets/x.js` 这类请求回 `index.html`，浏览器会拿到 HTML 当 module script 执行，
 * 报出「Unexpected token '<'」——那是个**真正的**错误，但很容易被误读成应用 bug；
 * 而 404 会让失败点直接指向「产物/路径不对」。SPA 回退只对无扩展名的路由路径生效。
 */
async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
  const http = require('node:http') as typeof import('node:http');
  const fs = require('node:fs') as typeof import('node:fs');
  const { join, extname } = require('node:path') as typeof import('node:path');

  // Content-Type 必须显式给出：`.js` 若回 octet-stream，Chromium 拒绝以 module 执行 → 应用不挂载
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
      filePath = join(rootDir, 'index.html'); // SPA 回退（与 nginx try_files 同语义）
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

/** 单条用例的轻量超时（真浏览器 + 首屏加载） */
const HEAVY = 30000;

describe.skipIf(!CAN_RUN_FRESH)('v0.7 批次 A · A4 首页视图切换真几何（真实构建产物 + 真 Chromium）', () => {
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

  /**
   * 开首页并等到视图切换控件挂载。
   *
   * 视口 1600×900：桌面档（≥xl），首页走「项目卡片网格」布局，控件常驻。
   * 未预置身份时 `useFirstRunGate` 会弹引导弹窗——它**不影响**本 spec
   * （控件仍在 DOM 里，`getComputedStyle` 读的是计算值而非可见性），故不额外处理，
   * 免得把「控件是否存在」与「身份是否就绪」两件事耦上。
   */
  async function openHome(): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(DIST_URL);

    // 资源 404 会让应用静默不挂载（DOM 里连 header 都没有）——先给一条可读的失败信息，
    // 而不是让后面的断言抛「null 取属性」这种无信息错误。
    try {
      await page.waitForSelector('header', { timeout: 20000 });
      await page.waitForSelector(VIEW_SWITCH, { timeout: 20000 });
    } catch {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      throw new Error(
        `首页未挂载出「首页视图切换」控件（${VIEW_SWITCH}）。` +
          '常见原因：产物缺失/过期、静态服务器未设 Content-Type、或 /assets/* 返回 404。' +
          `页面文本片段：${bodyText.slice(0, 300)}`,
      );
    }
    await page.waitForTimeout(400); // 等 CSS 应用完（避免读到过渡中的中间值）
    return { ctx, page };
  }

  /* ===================================================================================
   * A4-G1 · 核心：lg 档圆角的**像素值**必须等于画板 02 的 r12
   * =================================================================================== */
  it('A4-G1 · lg 档选中段/未选段 border-radius 计算值 === 12px（画板 02；rounded-xl 会渲染 16px）', async () => {
    const { ctx, page } = await openHome();
    try {
      const m = await page.evaluate((sel) => {
        const list = document.querySelector(sel);
        const tabs = Array.from(list?.querySelectorAll('[role="tab"]') ?? []);
        return {
          containerRadius: list ? getComputedStyle(list).borderRadius : 'MISSING',
          tabs: tabs.map((t) => ({
            label: (t.textContent ?? '').trim(),
            selected: t.getAttribute('aria-selected') === 'true',
            radius: getComputedStyle(t).borderRadius,
            // 类名一并带回来：断言失败时能直接看出是「类名写错」还是「刻度被改」
            cls: (t.className || '').toString(),
          })),
        };
      }, VIEW_SWITCH);

      // 前置：必须真的取到两段，否则下面断言「空数组全过」= 假绿
      expect(m.tabs).toHaveLength(2);
      expect(m.tabs.map((t) => t.label)).toEqual(['看板', '月历']);
      expect(m.tabs.filter((t) => t.selected)).toHaveLength(1);

      for (const t of m.tabs) {
        expect(
          t.radius,
          `段「${t.label}」圆角计算值为 ${t.radius}，画板 02 要求 12px。` +
            '本仓库 borderRadius.xl = 16px（非 Tailwind 默认 12），' +
            '故该项必须写 rounded-md；写了 rounded-xl/rounded-2xl 都会渲染成 16px。' +
            `实测类名：${t.cls}`,
        ).toBe('12px');
      }

      // 反向核对：容器是 r16（画板 02），别把两者记反
      expect(m.containerRadius).toBe('16px');
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  /* ===================================================================================
   * A4-G2 · 逐元素几何：容器 高36/pad4/gap4、项 84×28、选中态 paper 底
   * =================================================================================== */
  it('A4-G2 · 逐元素几何：容器高 36 / pad 4 / gap 4；项 84×28；选中 paper 底、未选透明', async () => {
    const { ctx, page } = await openHome();
    try {
      const m = await page.evaluate((sel) => {
        const list = document.querySelector(sel);
        if (!list) return null;
        const cs = getComputedStyle(list);
        const r = list.getBoundingClientRect();
        const rows = Array.from(list.querySelectorAll('[role="tab"]')).map((t) => {
          const b = t.getBoundingClientRect();
          const tcs = getComputedStyle(t);
          return {
            label: (t.textContent ?? '').trim(),
            selected: t.getAttribute('aria-selected') === 'true',
            w: Math.round(b.width),
            h: Math.round(b.height),
            bg: tcs.backgroundColor,
            fontSize: tcs.fontSize,
          };
        });
        return {
          containerH: Math.round(r.height),
          pad: cs.padding,
          gap: cs.gap,
          rows,
        };
      }, VIEW_SWITCH);

      expect(m).not.toBeNull();
      // 画板 02：外壳 = pad4 + 项高 28 + pad4 = 36
      expect(m!.containerH).toBe(36);
      expect(m!.pad).toBe('4px');
      expect(m!.gap).toBe('4px');

      expect(m!.rows.map((t) => t.label)).toEqual(['看板', '月历']);
      for (const t of m!.rows) {
        expect(t.h, `段「${t.label}」高度`).toBe(28);
        expect(t.w, `段「${t.label}」宽度`).toBe(84);
        expect(t.fontSize, `段「${t.label}」字号`).toBe('13px'); // 画板 02：13号
      }

      const sel = m!.rows.find((t) => t.selected)!;
      const unsel = m!.rows.find((t) => !t.selected)!;
      expect(sel.label).toBe('看板');
      // 选中 = paper 浮起底；未选 = 透明（画板 02）
      expect(sel.bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(unsel.bg).toBe('rgba(0, 0, 0, 0)');
    } finally {
      await ctx.close();
    }
  }, HEAVY);
});

/**
 * 前置检查：产物/浏览器缺失或产物过期时给出**可操作**的提示。
 *
 * 为什么单列一组：`describe.skipIf` 的 skip 在输出里长得像「通过」，
 * 极易被读成「已验收」。这条用例永远执行（不参与 skipIf），把跳过原因打到控制台。
 */
describe('v0.7 批次 A · A4 真几何验收前置检查', () => {
  it('构建产物、Chromium 可用且产物未过期（否则上面的几何验收被跳过）', () => {
    if (!CAN_RUN_FRESH) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ui-batch-a-geometry] 跳过几何验收：build-dist=${existsSync(DIST_INDEX)} ` +
          `chromium=${CHROMIUM_PATH !== null} 过期输入=${STALE_INPUTS.join(', ') || '(无)'}。` +
          ' 请先 npm run build 再跑 npm test ——否则测的是上一版界面。',
      );
    }
    expect(true).toBe(true);
  });
});
