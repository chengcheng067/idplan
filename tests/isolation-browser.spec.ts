/**
 * T02 · 通路 B（用户自定义阶段色）—— **真 Chromium 实测**（v0.8）。
 *
 * ══════════════════════════════ 为什么必须是真浏览器 ══════════════════════════════
 *
 * 通路 B 的正确性完全不依赖 JS 计算（那是 `tests/stage-color-derive.spec.ts` 的活），
 * 它依赖的是 **CSS 层叠**：
 *
 *   [data-stage-key="sc-x"]                                   ← 亮色（特异性 0,1,0）
 *   :root[data-theme='dark'] [data-stage-key="sc-x"]          ← 暗色（0,3,0）
 *   :root[data-theme='dark'] .print-root [data-stage-key="sc-x"]  ← 打印锁亮色（0,4,0）
 *
 * 这三条规则的**特异性递增 + 声明顺序**共同保证：暗色主题下元素自身声明了暗色值，
 * 而打印子树里的同一元素又必须解析回**亮色值**（打印稿恒浅色）。
 * 这类错误 **jsdom 完全看不见**（它不实现层叠与 `var()` 解析）——BUG-05 的教训就是
 * "tsc 与 jsdom 都发现不了的丢失"。只有真 Chromium 读 `getComputedStyle` 才可证伪。
 *
 * ── 本 spec 覆盖什么 / 不覆盖什么（诚实边界）──
 *   覆盖：**样式机制**——变量注入、三层特异性、暗/亮切换、打印锁亮色、
 *         `-rgb` 三元组（漏了它 ⇒ 发丝描边静默消失）、忘挂属性时会变透明（反证）。
 *   不覆盖：T03 把 `data-stage-key` 铺到真实月历/时间轴 DOM 上的**接线**——
 *         那是 T03 的交付面，本 spec 用同构探针元素验证的是 T02 的 CSS 契约。
 *         接线完成后，探针换成真实阶段节点即可复用本文件的全部断言。
 *
 * 前置：`build-dist/` 存在、**且不落后于 src**（否则 skip —— 见 R12 的假绿教训）、
 *      本机有 Playwright 的 Chromium。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  STAGE_COLOR_KEY_ATTR,
  STAGE_COLOR_STYLE_ID,
  STAGE_LOCAL_VAR,
  __resetRegistryForTest,
  buildStageColorCss,
  registerStageColor,
  registeredStageColorKeys,
} from '../src/core/color/custom-color-registry';
import { deriveStageColors } from '../src/core/color/derive-stage-colors';
import { stageColorAttrs, stageColorKeyOf } from '../src/components/timeline/stageColorKey';

/**
 * ⚠️ Electron 把 `ELECTRON_RUN_AS_NODE=1` 注入到环境里。
 * 若不清掉，`chromium.launch()` 拉起的进程会**按 Node 解释器启动**（表现为立即退出 /
 * 报 "Cannot find module"），是本仓库真浏览器 spec 最容易踩的一脚。
 * 必须在 launch 之前删掉。
 */
delete process.env.ELECTRON_RUN_AS_NODE;

const DIST_INDEX = resolve(__dirname, '..', 'build-dist', 'index.html');

/** 探测已安装的 chromium（与 print-light-lock.spec.ts 同口径） */
function resolveChromium(): string | null {
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

/** 收集目录下所有文件（新鲜度判定用） */
function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * 产物是否落后于源码（任一构建输入比 `build-dist/index.html` 新）。
 * R12 的教训：只判"产物存在"会让本 spec 在旧产物上变绿 —— 那是最危险的一类假绿。
 */
function staleInputs(): string[] {
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = statSync(DIST_INDEX).mtimeMs;
  const repo = resolve(__dirname, '..');
  const candidates = [
    ...collectFiles(join(repo, 'src')),
    join(repo, 'index.html'),
    join(repo, 'vite.config.ts'),
    join(repo, 'tailwind.config.ts'),
    join(repo, 'postcss.config.js'),
  ].filter((f) => existsSync(f));
  return candidates
    .filter((f) => statSync(f).mtimeMs > distMs)
    .map((f) => f.slice(repo.length + 1))
    .slice(0, 3);
}

const CHROMIUM_PATH = resolveChromium();
const STALE = existsSync(DIST_INDEX) ? staleInputs() : [];
const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null && STALE.length === 0;

/** 产物须经 HTTP 提供：`base:'/'` 的绝对资源路径在 file:// 下会 404（应用不挂载） */
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

/** 探针读到的取值 */
interface ProbeReadback {
  /** 亮色主题（无 data-theme 或 =light） */
  light: Record<string, string>;
  /** 暗色主题 */
  dark: Record<string, string>;
  /** 暗色主题 + .print-root 子树内（应当锁回亮色） */
  printUnderDark: Record<string, string>;
}

/**
 * 在页面里按"通路 B 的真实用法"插入探针，并回报 computed 值。
 *
 * 探针写法与组件层完全同构：
 *   · 元素挂 `data-stage-key="sc-…"`（`stageColorAttrs()` 的产物）
 *   · 取色走 `var(--stage-local-*)`（`stageSolidColor/Band/Ink` 的产物）
 *
 * ⚠️ 探针**保留在 DOM 里**（同名 host 会先被移除再重建），这样后续用例还能对
 * CSSOM 与命中元素数做审计（B-06 / B-08）。
 */
async function probe(page: Page, key: string, css: string): Promise<ProbeReadback> {
  return page.evaluate(
    ({ k, styleId, sheet, attr }) => {
      // 用**真实注册表产出的 CSS 文本**注入，并沿用真实 <style> id 契约
      document.getElementById(styleId)?.remove();
      const style = document.createElement('style');
      style.id = styleId;
      style.setAttribute('data-owner', 'custom-color-registry');
      style.textContent = sheet;
      document.head.appendChild(style);

      document.getElementById('__stage_local_probe')?.remove();
      const host = document.createElement('div');
      host.id = '__stage_local_probe';
      host.innerHTML = `
        <div class="c-outer">
          <div class="p-solid" ${attr}="${k}" style="background-color: var(--stage-local-solid)"></div>
          <div class="p-band"  ${attr}="${k}" style="background-color: var(--stage-local-band)"></div>
          <div class="p-ink"   ${attr}="${k}" style="color: var(--stage-local-ink)">x</div>
          <div class="p-orphan" style="background-color: var(--stage-local-band)"></div>
        </div>
        <div class="print-root">
          <div class="p-band"  ${attr}="${k}" style="background-color: var(--stage-local-band)"></div>
          <div class="p-ink"   ${attr}="${k}" style="color: var(--stage-local-ink)">x</div>
          <div class="p-rgb"   ${attr}="${k}" style="border-top-color: rgb(var(--stage-local-ink-rgb) / 0.3)"></div>
        </div>`;
      document.body.appendChild(host);

      const pick = (sel: string, prop: 'backgroundColor' | 'color'): string => {
        const el = host.querySelector(sel) as HTMLElement | null;
        return el ? getComputedStyle(el)[prop] : 'MISSING';
      };
      const readVar = (sel: string, name: string): string => {
        const el = host.querySelector(sel) as HTMLElement | null;
        return el ? getComputedStyle(el).getPropertyValue(name).trim() : 'MISSING';
      };
      const snapshot = (): Record<string, string> => ({
        solid: pick('.c-outer .p-solid', 'backgroundColor'),
        band: pick('.c-outer .p-band', 'backgroundColor'),
        ink: pick('.c-outer .p-ink', 'color'),
        printBand: pick('.print-root .p-band', 'backgroundColor'),
        printInk: pick('.print-root .p-ink', 'color'),
        printInkRgbVar: readVar('.print-root .p-rgb', '--stage-local-ink-rgb'),
        orphan: pick('.p-orphan', 'backgroundColor'),
        solidVar: readVar('.c-outer .p-solid', '--stage-local-solid'),
        bandVar: readVar('.c-outer .p-band', '--stage-local-band'),
        inkVar: readVar('.c-outer .p-ink', '--stage-local-ink'),
        inkRgbVar: readVar('.c-outer .p-ink', '--stage-local-ink-rgb'),
      });

      // ① 亮色
      document.documentElement.removeAttribute('data-theme');
      const light = snapshot();
      // ② 暗色
      document.documentElement.setAttribute('data-theme', 'dark');
      const dark = snapshot();

      return { light, dark, printUnderDark: dark };
    },
    { k: key, styleId: STAGE_COLOR_STYLE_ID, sheet: css, attr: STAGE_COLOR_KEY_ATTR },
  );
}

describe.skipIf(!CAN_RUN)('T02-BROWSER · 通路 B（自定义阶段色）真 Chromium 实测', () => {
  let browser: Browser;
  let server: { url: string; close(): Promise<void> };
  let DIST_URL = '';

  /** 本轮使用的自定义主色（与 20 色板都不相同，确保不是"碰巧等于内置色"） */
  const CUSTOM = '#7A2FD6';
  let KEY = '';
  let CSS = '';

  beforeAll(async () => {
    server = await startStaticServer(resolve(__dirname, '..', 'build-dist'));
    DIST_URL = server.url;
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });

    __resetRegistryForTest();
    KEY = registerStageColor(CUSTOM);
    CSS = buildStageColorCss();
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    __resetRegistryForTest();
  });

  async function open(theme: 'light' | 'dark'): Promise<{ close(): Promise<void>; page: Page }> {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(DIST_URL);
    await page.evaluate((t) => {
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
    }, theme);
    await page.waitForTimeout(150);
    return { close: () => ctx.close(), page };
  }

  it('B-00 · key 是纯数据（sc-<hash36>），不含 # 、不是动态类名', () => {
    expect(KEY).toMatch(/^sc-[0-9a-z]+$/);
    expect(KEY).not.toContain('#');
    expect(registeredStageColorKeys()).toContain(KEY);
    // 组件侧入口产出同一个 key（单一实现，两处不得漂移）
    expect(stageColorKeyOf({ customColor: CUSTOM, colorIndex: 1, orderIndex: 0 })).toBe(KEY);
    expect(stageColorAttrs({ customColor: CUSTOM, colorIndex: 1, orderIndex: 0 })).toEqual({
      [STAGE_COLOR_KEY_ATTR]: KEY,
    });
    // 内置色（customColor 为空）必须明确返回 null ⇒ 走通路 A
    expect(stageColorKeyOf({ customColor: null, colorIndex: 3, orderIndex: 0 })).toBeNull();
    expect(stageColorAttrs({ customColor: null, colorIndex: 3, orderIndex: 0 })).toEqual({});
    expect(stageColorKeyOf({ customColor: 'not-a-color', colorIndex: 3, orderIndex: 0 })).toBeNull();
  });

  it('B-01 · CSS 文本结构：每个 key 3 条规则，打印规则声明在暗色规则**之后**', () => {
    const rules = CSS.split('\n').filter((l) => l.includes(STAGE_COLOR_KEY_ATTR));
    expect(rules).toHaveLength(3);

    const [light, dark, print] = rules as [string, string, string];
    expect(light.startsWith(`[${STAGE_COLOR_KEY_ATTR}="${KEY}"]`)).toBe(true);
    expect(dark.startsWith(`:root[data-theme='dark'] [${STAGE_COLOR_KEY_ATTR}="${KEY}"]`)).toBe(true);
    expect(print.startsWith(`:root[data-theme='dark'] .print-root [${STAGE_COLOR_KEY_ATTR}="${KEY}"]`)).toBe(true);

    // 四条变量一条都不能少（漏 inkRgb ⇒ 发丝描边静默消失）
    for (const rule of rules) {
      for (const name of Object.values(STAGE_LOCAL_VAR)) expect(rule).toContain(`${name}:`);
    }
    // 亮色与打印用的是同一份值（打印恒浅色）
    const decls = (rule: string): string => rule.slice(rule.indexOf('{') + 1, rule.lastIndexOf('}'));
    expect(decls(print)).toBe(decls(light));
  });

  it('B-02 · 亮色主题：三层都解析出真实颜色（非 transparent、非空）', async () => {
    const { close, page } = await open('light');
    try {
      const { light } = await probe(page, KEY, CSS);
      for (const [name, value] of Object.entries(light)) {
        expect({ name, value }).toEqual({ name, value: expect.any(String) });
        expect(value).not.toBe('');
        expect(value).not.toBe('MISSING');
      }
      expect(light.solid).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(light.band).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(light.ink).toMatch(/^rgb\(/);
      // 变量值与派生结果逐字节一致（真浏览器解析出来的就是派生引擎算出的那个值）
      const derived = deriveStageColors(CUSTOM);
      expect(light.solidVar.toLowerCase()).toBe(derived.light.solid.toLowerCase());
      expect(light.bandVar.toLowerCase()).toBe(derived.light.band.toLowerCase());
      expect(light.inkVar.toLowerCase()).toBe(derived.light.ink.toLowerCase());
      expect(light.inkRgbVar).toBe(derived.light.inkRgb);
    } finally {
      await close();
    }
  });

  it('B-03 · 亮/暗切换后值**不同**（换了主题色带真的跟着换）', async () => {
    const { close, page } = await open('dark');
    try {
      const { light, dark } = await probe(page, KEY, CSS);
      expect(dark.solid).not.toBe(light.solid);
      expect(dark.band).not.toBe(light.band);
      // 暗色实心块 = 亮色宽面（R4）—— 真浏览器里也必须成立
      expect(dark.solid).toBe(light.band);
      const derived = deriveStageColors(CUSTOM);
      expect(dark.bandVar.toLowerCase()).toBe(derived.dark.band.toLowerCase());
      expect(dark.inkVar.toLowerCase()).toBe(derived.dark.ink.toLowerCase());
    } finally {
      await close();
    }
  });

  it('B-04 · ★ 暗色主题下 .print-root 子树内的值 === 亮色值（打印恒浅色）', async () => {
    const { close, page } = await open('dark');
    try {
      const { light, dark, printUnderDark } = await probe(page, KEY, CSS);

      // 暗色主题确实生效了（否则下面这条断言会是"两边都亮"的假绿）
      expect(dark.band).not.toBe(light.band);
      expect(dark.solid).not.toBe(light.solid);

      // 核心：同一元素、同一变量，仅因处在 .print-root 内就锁回亮色
      expect(printUnderDark.printBand).toBe(light.band);
      expect(printUnderDark.printInk).toBe(light.ink);
      expect(printUnderDark.printInkRgbVar).toBe(light.inkRgbVar);
      // 打印子树内的带色必须**不等于**暗色带色（反证不是"整页都一样"）
      expect(printUnderDark.printBand).not.toBe(dark.band);
    } finally {
      await close();
    }
  });

  it('B-05 · 打印子树内外的取值跨主题一致（打印稿与用户当前主题无关）', async () => {
    const lightCtx = await open('light');
    let lightPrint = '';
    try {
      lightPrint = (await probe(lightCtx.page, KEY, CSS)).printUnderDark.printBand;
    } finally {
      await lightCtx.close();
    }

    const darkCtx = await open('dark');
    try {
      const darkProbe = await probe(darkCtx.page, KEY, CSS);
      expect(darkProbe.printUnderDark.printBand).toBe(lightPrint);
      // 反证：非打印子树**必须**随主题变化
      expect(darkProbe.dark.band).not.toBe(darkProbe.light.band);
    } finally {
      await darkCtx.close();
    }
  });

  it('B-06 · ★ 三层变量在真浏览器的 CSSOM 里确实命中（含 -rgb 三元组）', async () => {
    const { close, page } = await open('dark');
    try {
      await probe(page, KEY, CSS);
      const audit = await page.evaluate(
        ({ styleId, attr, k }) => {
          const el = document.getElementById(styleId) as HTMLStyleElement | null;
          if (el === null || el.sheet === null) return { found: false, rules: [], matched: 0 };
          const sheet = el.sheet as CSSStyleSheet;
          const rules: { selector: string; band: string; inkRgb: string }[] = [];
          for (let i = 0; i < sheet.cssRules.length; i += 1) {
            const rule = sheet.cssRules[i] as CSSStyleRule;
            if (typeof rule.selectorText !== 'string') continue;
            if (!rule.selectorText.includes(`[${attr}="${k}"]`)) continue;
            rules.push({
              // ⚠️ Chromium 的 `selectorText` 会把属性选择器的引号**统一成双引号**
              // （源码里写的是单引号 `[data-theme='dark']`）。这里归一化后再断言，
              // 避免"引号风格"这种与机制无关的差异把断言弄红。
              selector: rule.selectorText.replace(/"/g, "'"),
              band: rule.style.getPropertyValue('--stage-local-band').trim(),
              inkRgb: rule.style.getPropertyValue('--stage-local-ink-rgb').trim(),
            });
          }
          const matched = document.querySelectorAll(`[${attr}="${k}"]`).length;
          return { found: true, rules, matched };
        },
        { styleId: STAGE_COLOR_STYLE_ID, attr: STAGE_COLOR_KEY_ATTR, k: KEY },
      );

      expect(audit.found).toBe(true);
      expect(audit.rules).toHaveLength(3);
      expect(audit.matched).toBeGreaterThanOrEqual(5);
      for (const rule of audit.rules) {
        expect(rule.band).not.toBe('');
        expect(rule.inkRgb).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      }
      // 三条规则必须按"亮 → 暗 → 打印"排列（否则打印锁亮色会被暗色规则压掉）
      const selectors = audit.rules.map((r) => r.selector);
      expect(selectors[0]!.startsWith(`[${STAGE_COLOR_KEY_ATTR}=`)).toBe(true);
      expect(selectors[1]!).toContain(":root[data-theme='dark']");
      expect(selectors[1]!).not.toContain('.print-root');
      expect(selectors[2]!).toContain('.print-root');
    } finally {
      await close();
    }
  });

  it('B-07 · 反证：忘挂 data-stage-key 的元素 var() 解析为空 ⇒ 透明（BUG-05 那类静默失败）', async () => {
    const { close, page } = await open('light');
    try {
      const { light } = await probe(page, KEY, CSS);
      // 这条断言解释了为什么 stageColors.ts 的三个取色出口要"顺手注册"该主色，
      // 以及为什么组件**必须**同时挂属性：只挂 var() 不挂属性 = 色带消失且不报错。
      expect(light.orphan).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(light.orphan).not.toBe(light.band);
    } finally {
      await close();
    }
  });

  it('B-08 · 内置 9 色通路不受影响（--stage-band-s1-rgb 亮/暗仍按 global.css 切换）', async () => {
    const { close, page } = await open('dark');
    try {
      await probe(page, KEY, CSS);
      const read = await page.evaluate(() => {
        const el = document.querySelector('.c-outer .p-band') as HTMLElement | null;
        return el ? getComputedStyle(el).getPropertyValue('--stage-band-s1-rgb').trim() : 'MISSING';
      });
      expect(read).toBe('23 46 48'); // 暗色值（print-light-lock.spec.ts 已有同口径断言）

      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      const lightRead = await page.evaluate(() => {
        const el = document.querySelector('.c-outer .p-band') as HTMLElement | null;
        return el ? getComputedStyle(el).getPropertyValue('--stage-band-s1-rgb').trim() : 'MISSING';
      });
      expect(lightRead).toBe('100 135 134'); // 亮色值
      // 注入的自定义色表不得污染内置令牌（两条通路变量名不同、互不覆盖）
      expect(lightRead).not.toBe('');
    } finally {
      await close();
    }
  });

  it('B-09 · 两个不同的自定义色：key 不同、取值不同（无碰撞、无串色）', async () => {
    const other = '#C44A1E';
    const otherKey = registerStageColor(other);
    expect(otherKey).not.toBe(KEY);

    const css = buildStageColorCss();
    const { close, page } = await open('light');
    try {
      const a = await probe(page, KEY, css);
      const b = await probe(page, otherKey, css);
      expect(a.light.band).not.toBe(b.light.band);
      expect(a.light.bandVar).toBe(deriveStageColors(CUSTOM).light.band);
      expect(b.light.bandVar).toBe(deriveStageColors(other).light.band);
      // 同一份注入表里两个 key 各自 3 条规则，互不干扰
      expect(css.split('\n').filter((l) => l.includes(STAGE_COLOR_KEY_ATTR))).toHaveLength(6);
    } finally {
      await close();
      __resetRegistryForTest();
      // 复位到本文件基线（供后续用例使用）
      KEY = registerStageColor(CUSTOM);
      CSS = buildStageColorCss();
    }
  });

  it('B-10 · 真实构建产物确实包含本模块（防"源码改了但产物是旧的"这类假绿）', () => {
    const assets = join(resolve(__dirname, '..'), 'build-dist', 'assets');
    const js = existsSync(assets)
      ? readdirSync(assets).filter((f) => f.endsWith('.js'))
      : [];
    expect(js.length).toBeGreaterThan(0);
    const bundle = js
      .map((f) => readFileSync(join(assets, f), 'utf8'))
      .join('\n');
    // 通路 B 的属性名与变量名必须出现在产物里（字面量常量，不是拼接出来的）
    expect(bundle).toContain(STAGE_COLOR_KEY_ATTR);
    expect(bundle).toContain('--stage-local-band');
    expect(bundle).toContain('--stage-local-ink-rgb');
    // BUG-05 的根因形态不得出现在产物里
    expect(bundle).not.toContain('bg-stage-band-s$');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════
 * L4 · Agent 隔离的真浏览器验收（v0.8 · 设计 §7.7 的 L4 行 · T04-A）
 *
 * ── 为什么 L1/L2/L3 都绿了还要这一层 ──
 * `tests/isolation-guard.spec.ts`（L1）与 `tests/isolation-census.spec.ts`（L2/L3）
 * 全部在 **JS 派生**这一层证明"过滤对了"。它们**看不见**下面三类：
 *   ① 某个页面压根没用漏斗（派生写对了，接线没接上）；
 *   ② 渲染路径绕过 JS 派生（Tailwind 类名丢失、CSS 变量没挂 —— BUG-05 的教训）；
 *   ③ 数据装载时序问题（bootstrap 之后才发生的旁路写入）。
 * 只有把**真实构建产物**在真 Chromium 里跑起来、种入两类数据、读 `innerText`，才能证伪。
 *
 * ── 种子数据怎么进去 ──
 * 走应用**自己的备份导入链路**（隐藏 file input → 预检 → 二次确认 → 整库替换 → reload），
 * 与 `tests/v07-board-acceptance.spec.ts` 同一条路。**不**直接往 IndexedDB 里写：
 * 后者会在"归一函数改了口径"时静默偏离真实导入行为（那种偏离会让本 spec 变成
 * "只验证我自己的写入器"的自证）。
 *
 * ── 夹具里刻意埋的泄漏向量 ──
 * Agent 看板的 5 条任务**全部指派给人类管理员**（`assigneeId` / `assigneeIds`）。
 * 这是 §7.2 #15 的 ★★ 关键漏点现场：只要我的任务页 / 成员看板不按 `projectId` 收窄，
 * 这个 Agent 看板就会从那两处漏出去 —— 本段对那两页的断言才有判别力。
 *
 * ── 诚实边界（本段测不到的）──
 *   · 自定义主色的 `getComputedStyle` 非透明：已由上面 T02-BROWSER 段覆盖（B-02/B-03），
 *     本段不重复；
 *   · 服务端（remote 模式）的 kind 分流：属 T04-SRV 的面，本段只跑 local 模式。
 */
describe.skipIf(!CAN_RUN)('L4-BROWSER · Agent 隔离真 Chromium 验收（真实构建产物）', () => {
  /* ────────────────────────── 具名常量（断言里只用它们，不写散字符串） ────────────────────────── */

  /** 两类名字刻意都带「L4长夏」前缀：既好认，也让"按名搜索"类的页面不会漏掉它们 */
  const HUMAN_NAME = 'L4长夏人类项目甲';
  const AGENT_NAME = 'L4长夏AI看板乙';
  const HUMAN_TASK = 'L4人类任务0';
  const AGENT_TASK = 'L4代理任务0';
  const AGENT_ACTOR = 'L4代理行为体';
  const MEMBER_NAME = 'L4验收管理员';

  const HUMAN_PROJECT_ID = 'proj_l4_human';
  const AGENT_PROJECT_ID = 'proj_l4_agent';
  const ADMIN_MEMBER_ID = 'm-admin';

  /** 与 `ProjectSourceBadge.tsx` 的 `AGENT_SOURCE_BADGE_TEXT` 逐字一致（§7.3 特判的可见产物） */
  const BADGE_TEXT = 'AI 工作区';

  const NOW_ISO = '2026-09-01T00:00:00.000Z';

  let browser: Browser;
  let server: { url: string; close(): Promise<void> };
  /** 形如 `http://127.0.0.1:<port>/`（末尾带斜杠，供 `goto(base + 'agent')` 拼相对路由） */
  let base = '';
  let fixtureDir = '';

  interface L4Env {
    ctx: import('playwright-core').BrowserContext;
  }
  /** 主环境：1 个人类项目 ＋ 1 个 Agent 看板 */
  let mainEnv: L4Env;
  /** 对照环境：**只有**人类项目（从未建过 Agent 看板）—— `/agent` 空态的现场 */
  let humanOnlyEnv: L4Env;

  /* ────────────────────────── 种子构造（纯数据，逐字段对齐备份 schema v3） ────────────────────────── */

  function projectRow(over: Record<string, unknown>): Record<string, unknown> {
    return {
      id: '',
      name: '',
      type: 'dining',
      address: 'L4 验收地址',
      clientName: 'L4 验收客户',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-09-01',
      plannedEndAt: '2026-09-30',
      coverColor: null,
      shortLabel: null,
      stagePresetKey: 'indoor_full',
      stageTemplateVersion: 2,
      scheduleBasis: 'calendar',
      domain: 'indoor',
      kind: 'human',
      status: 'active',
      revision: 1,
      updatedAt: NOW_ISO,
      ...over,
    };
  }

  function stageRows(projectId: string, tag: string): Record<string, unknown>[] {
    const spec: Array<[number, string, string, string]> = [
      [1, '2026-09-01', '2026-09-02', 'completed'],
      [2, '2026-09-03', '2026-09-04', 'in_progress'],
      [3, '2026-09-05', '2026-09-09', 'not_started'],
    ];
    return spec.map(([i, startAt, endAt, status]) => ({
      id: `stg_${tag}_${i}`,
      projectId,
      orderIndex: i,
      templateKey: null,
      colorIndex: i,
      customColor: null,
      name: `${tag}阶段${i}`,
      ratioPercent: 33,
      startAt,
      endAt,
      status,
      ownerId: null,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: NOW_ISO,
    }));
  }

  /**
   * 每个项目 5 条任务，**全部挂到人类管理员名下**（见文件头「夹具里刻意埋的泄漏向量」）。
   * `taskNo` 号段分开（人类 3xxx / Agent 31xx），避免两条链撞号。
   */
  function taskRows(
    projectId: string,
    stageIds: readonly string[],
    tag: string,
    titlePrefix: string,
    source: 'human' | 'agent',
    taskNoBase: number,
  ): Record<string, unknown>[] {
    return [0, 1, 2, 3, 4].map((i) => ({
      id: `tsk_${tag}_${i}`,
      taskNo: taskNoBase + i,
      projectId,
      stageId: stageIds[i % stageIds.length]!,
      title: `${titlePrefix}${i}`,
      done: false,
      assigneeId: ADMIN_MEMBER_ID,
      assigneeIds: [ADMIN_MEMBER_ID],
      dueDate: '2026-09-04',
      source,
      externalId: null,
      agentId: null,
      status: 'ready',
      description: null,
      dependsOn: [],
      artifacts: [],
      startAt: null,
      claimedAt: null,
      orderIndex: i,
      revision: 1,
      updatedAt: NOW_ISO,
    }));
  }

  function buildSeed(includeAgent: boolean): Record<string, unknown> {
    const projects: Record<string, unknown>[] = [
      projectRow({ id: HUMAN_PROJECT_ID, name: HUMAN_NAME, kind: 'human', domain: 'indoor' }),
    ];
    if (includeAgent) {
      projects.push(
        projectRow({
          id: AGENT_PROJECT_ID,
          name: AGENT_NAME,
          kind: 'agent',
          // custom 套餐 ⇒ 纠错③ 的现场（`getPreset('custom')` 返回 null）
          stagePresetKey: 'custom',
          domain: 'software',
          // Agent 看板的看板列与人类项目**完全不相交**（software vs indoor）
          plannedEndAt: '2026-08-20',
        }),
      );
    }

    const stages: Record<string, unknown>[] = [];
    const tasks: Record<string, unknown>[] = [];

    const humanStages = stageRows(HUMAN_PROJECT_ID, 'l4h');
    stages.push(...humanStages);
    tasks.push(
      ...taskRows(
        HUMAN_PROJECT_ID,
        humanStages.map((s) => String(s['id'])),
        'l4h',
        HUMAN_TASK.replace(/\d+$/, ''),
        'human',
        3000,
      ),
    );

    if (includeAgent) {
      const agentStages = stageRows(AGENT_PROJECT_ID, 'l4a');
      stages.push(...agentStages);
      tasks.push(
        ...taskRows(
          AGENT_PROJECT_ID,
          agentStages.map((s) => String(s['id'])),
          'l4a',
          AGENT_TASK.replace(/\d+$/, ''),
          'agent',
          3100,
        ),
      );
    }

    return {
      meta: { app: 'changxia', schemaVersion: 3, exportedAt: NOW_ISO },
      data: {
        projects,
        stages,
        tasks,
        members: [
          {
            id: ADMIN_MEMBER_ID,
            name: MEMBER_NAME,
            role: '设计总监',
            contact: null,
            avatarColor: '#5B6B5A',
            active: true,
            roleKind: 'admin',
            passwordHash: null,
            actorKind: 'human',
            agentKind: null,
            revision: 1,
            updatedAt: NOW_ISO,
          },
          {
            id: 'mem_l4_agent',
            name: AGENT_ACTOR,
            role: 'Agent',
            contact: null,
            avatarColor: '#3F4A55',
            active: true,
            roleKind: 'member',
            passwordHash: null,
            actorKind: 'agent',
            agentKind: 'workbuddy',
            revision: 1,
            updatedAt: NOW_ISO,
          },
        ],
        assignments: [],
        logs: [],
        contracts: [],
        settings: [],
      },
    };
  }

  function writeSeed(fileName: string, includeAgent: boolean): string {
    const path = join(fixtureDir, fileName);
    writeFileSync(path, JSON.stringify(buildSeed(includeAgent), null, 2), 'utf-8');
    return path;
  }

  /* ────────────────────────── 环境与页面 ────────────────────────── */

  /**
   * 建一个已灌种子的验收环境（独立 BrowserContext ⇒ 自带 localStorage + IndexedDB）。
   *
   * `addInitScript` 里预置「已进入身份」是**合适**的：首启闸门（`useFirstRunGate`）的触发
   * 条件是 `currentMemberId === null ∧ 无管理员 ∧ …`，空库首开会弹 admin_prompt 引导框。
   * 该框不阻断 `setInputFiles`（赋 value 而非点击），但会让"页面是否正常进入"的判定变浑浊。
   * 键名 `changxia.currentMemberId` 的唯一出处是 `useSettingsStore.ts`。
   */
  async function createEnv(fixturePath: string): Promise<L4Env> {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('changxia.currentMemberId', 'm-admin');
      } catch {
        /* 隐私模式下 localStorage 不可写 —— 种子导入随后会失败并给出清晰报错 */
      }
    });

    const seedPage = await ctx.newPage();
    await seedPage.goto(`${base}index.html`);
    await seedPage.waitForSelector('header', { timeout: 20000 });

    // 侧栏里那个 `input[type=file].hidden`（useBackupIo）—— `display:none`，故 force 绕过可见性
    await seedPage
      .locator('input[type="file"][accept*="json"]')
      .first()
      .setInputFiles(fixturePath, { force: true });

    const confirm = seedPage.getByRole('button', { name: '确认恢复' });
    try {
      await confirm.waitFor({ state: 'attached', timeout: 15000 });
    } catch {
      const text = await seedPage.locator('body').innerText();
      throw new Error(
        `备份导入未进入二次确认（fixture 可能未通过 zod 预检）。页面文本片段：${text.slice(0, 500)}`,
      );
    }
    await confirm.click({ force: true });

    try {
      await seedPage.waitForFunction(
        (name) => document.body.innerText.includes(name),
        HUMAN_NAME,
        { timeout: 20000 },
      );
    } catch {
      const text = await seedPage.locator('body').innerText();
      throw new Error(
        `备份导入后未观察到种子项目「${HUMAN_NAME}」。页面文本片段：${text.slice(0, 500)}`,
      );
    }
    await seedPage.close();
    return { ctx };
  }

  /** 开一个路由并等数据装载完成（`main` 出现 ＋ 静置一拍，让 zustand 的二次渲染落定） */
  async function openPage(
    env: L4Env,
    route: string,
    opts: { expectText?: string } = {},
  ): Promise<Page> {
    const page = await env.ctx.newPage();
    await page.goto(base + route);
    await page.waitForSelector('main', { timeout: 20000 });
    if (opts.expectText !== undefined) {
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        opts.expectText,
        { timeout: 20000 },
      );
    }
    await page.waitForTimeout(300);
    return page;
  }

  async function bodyText(page: Page): Promise<string> {
    return page.locator('body').innerText();
  }

  /** 出现次数（按子串切分；needle 为空时返回 0，避免除零式的假通过） */
  function countOccurrences(haystack: string, needle: string): number {
    if (needle.length === 0) return 0;
    return haystack.split(needle).length - 1;
  }

  /**
   * 命中处上下各一行 —— 贴进断言消息里。
   *
   * 为什么值得专门写一个：本段的红灯语义是「某处漏过滤了」，而**"哪一处"**才是
   * 真正要回答的问题（侧栏？下拉？面包屑？某个我没注意到的推荐位）。
   * 只报一个计数，排查者还得自己去开浏览器；带上上下文，一眼定位。
   */
  function contextOf(haystack: string, needle: string): string {
    if (needle.length === 0) return '<needle 为空>';
    const lines = haystack.split('\n');
    const out: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i]!.includes(needle)) continue;
      out.push(
        [lines[i - 1] ?? '', lines[i]!, lines[i + 1] ?? ''].join(' ｜ ').trim().slice(0, 300),
      );
    }
    return out.length === 0 ? '<未命中>' : out.join('\n');
  }

  beforeAll(async () => {
    server = await startStaticServer(resolve(__dirname, '..', 'build-dist'));
    base = server.url.replace(/index\.html$/, '');
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });

    fixtureDir = mkdtempSync(join(tmpdir(), 'idplan-isolation-l4-'));
    mainEnv = await createEnv(writeSeed('seed-main.json', true));
    humanOnlyEnv = await createEnv(writeSeed('seed-human-only.json', false));
  }, 180000);

  afterAll(async () => {
    await mainEnv?.ctx.close();
    await humanOnlyEnv?.ctx.close();
    await browser?.close();
    await server?.close();
  });

  /* ════════════════════ 人类侧：Agent 看板名一次都不许出现 ════════════════════ */

  it('L4-01 · 首页 `/`：项目网格/侧栏/顶栏里 Agent 看板名出现 0 次', async () => {
    const page = await openPage(mainEnv, '', { expectText: HUMAN_NAME });
    try {
      const text = await bodyText(page);
      expect(countOccurrences(text, HUMAN_NAME), '夹具未生效：人类项目名都没渲染出来').toBeGreaterThan(0);
      expect(
        countOccurrences(text, AGENT_NAME),
        '人类首页出现了 Agent 看板名（§7.2 #1/#2/#3/#5/#9/#10/#11/#13 任一漏过滤）',
      ).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('L4-02 · 月历视图（首页切「月历」）：Agent 看板名出现 0 次', async () => {
    const page = await openPage(mainEnv, '', { expectText: HUMAN_NAME });
    try {
      await page.getByRole('tab', { name: '月历' }).click();
      await page.waitForTimeout(400);
      const text = await bodyText(page);
      expect(countOccurrences(text, AGENT_NAME), '月历里出现了 Agent 看板（§7.2 #7）').toBe(0);
    } finally {
      await page.close();
    }
  });

  it('L4-03 · 我的任务页 `/my-tasks`：Agent 看板名与其任务名都出现 0 次', async () => {
    const page = await openPage(mainEnv, 'my-tasks');
    try {
      const text = await bodyText(page);
      expect(countOccurrences(text, AGENT_NAME), '我的任务页出现了 Agent 看板名（§7.2 #14）').toBe(0);
      // ★ 判别力：Agent 任务是**指派给这个人类成员**的 —— 若这一行没过滤，任务名会直接出现
      expect(
        countOccurrences(text, AGENT_TASK),
        '我的任务页出现了 Agent 看板名下的任务（AI 指派给人类成员的任务也不该出现）',
      ).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('L4-04 · 成员看板 `/member-board`：Agent 看板名与其任务名都出现 0 次', async () => {
    const page = await openPage(mainEnv, 'member-board', { expectText: MEMBER_NAME });
    try {
      const text = await bodyText(page);
      expect(countOccurrences(text, AGENT_NAME), '成员看板出现了 Agent 看板名（§7.2 #15 ★★ 关键漏点）').toBe(0);
      expect(countOccurrences(text, AGENT_TASK), '成员看板出现了 Agent 看板名下的任务').toBe(0);
    } finally {
      await page.close();
    }
  });

  /**
   * ⚠️ **「Agent 面」的判定范围＝`<main>`（页面内容），不含共享侧栏。**
   *
   * 实测把范围放到整页时 L4-05 会"红"，而红了的那一处是**设计要求的**：
   * 侧栏的「我的项目」列表对应 §7.2 **#11**，接法是 **P**（人类侧出口），
   * 且 PRD B14 要求 Agent 侧的侧栏是「人类项目列表 ＋ 独立的 Agent 看板列表」两段，
   * 不是"只留 Agent"。所以侧栏出现人类项目名是**正确行为**，不是泄漏。
   *
   * 于是本段这样划线，并把它写成断言而不是"心里知道"：
   *   · Agent 面对 Agent 数据 → 取 `<main>`（#20 的项目下拉 / #21 统计卡都在这里）；
   *   · 共享侧栏 → 单独断言它**确实**列人类项目（#11 = P 的正向证据），
   *     于是"人类名 0 次"这条边界的适用范围不再有歧义。
   *
   * ★ 2026-09-23 B14 后半落地后的**边界修订**：侧栏从"只有人类列表"变成
   *   「我的项目」＋ 独立「Agent 看板」两段（`data-sidebar-project-list` /
   *   `data-agent-board-sidebar` 两个锚点）。隔离划线随之**精确化**而不是放松：
   *   旧断言"侧栏整体不出现 Agent 名"会把 B14 要求的专属列表判成泄漏 ——
   *   新划线：Agent 名只准出现在**专属区块**里，「我的项目」列表（#11 的 P 出口）
   *   依旧一个都不许混入。两边都是正向+反向双侧断言，缺一边就意味着某一段串味。
   */
  const mainText = async (page: Page): Promise<string> => page.locator('main').innerText();
  const sidebarText = async (page: Page): Promise<string> =>
    page.locator('[data-app-sidebar]').first().innerText();

  /* ════════════════════ Agent 侧：人类项目名一次都不许出现 ════════════════════ */

  it('L4-05 · Agent 页 `/agent`：main 里人类项目名 0 次，且 Agent 看板**在**（判别力）', async () => {
    const page = await openPage(mainEnv, 'agent');
    try {
      const text = await mainText(page);

      // ① 页面内容里不得有人类项目
      expect(
        countOccurrences(text, HUMAN_NAME),
        `Agent 页 main 里出现了人类项目（§7.2 #20「现状最刺眼处」）。命中处上下文：\n${contextOf(text, HUMAN_NAME)}`,
      ).toBe(0);

      // ② #20 的**精确**断言：项目下拉的选项里不得有人类项目，且必须真的列着 Agent 看板
      const options = (await page.locator('main select option').allInnerTexts()).map((s) => s.trim());
      expect(options, 'Agent 页的项目下拉没渲染出来 ⇒ 本用例无判别力').not.toHaveLength(0);
      expect(options).not.toContain(HUMAN_NAME);
      expect(options).toContain(AGENT_NAME);

      // ③ 判别力：Agent 看板必须真的在 main 上（否则上面的 0 可能是"整页没渲染"造成的假绿）
      expect(
        countOccurrences(text, AGENT_NAME),
        'Agent 页 main 没渲染出 Agent 看板 ⇒ 隔离断言无判别力',
      ).toBeGreaterThan(0);

      // ④ 边界正向证据：共享侧栏按 #11（P）**应当**列人类项目
      const side = await sidebarText(page);
      expect(side, '侧栏（#11 = P）未列人类项目 ⇒ 与 #11 的接法不符').toContain(HUMAN_NAME);
      // ⑤ ★ B14（2026-09-23 落地）：Agent 路由的侧栏是**两段**，隔离按段划线：
      //    「我的项目」列表（P 出口）里一个 Agent 看板都不许混入；
      //    Agent 名只准出现在专属的「Agent 看板」区块里（且必须真的在 = 判别力）。
      const humanList = await page.locator('[data-sidebar-project-list]').first().innerText();
      expect(
        humanList,
        'Agent 看板混进了侧栏「我的项目」列表（#11 = P：人类侧列表只列人类项目）',
      ).not.toContain(AGENT_NAME);
      const agentSection = await page.locator('[data-agent-board-sidebar]').first().innerText();
      expect(
        agentSection,
        'B14：Agent 路由的侧栏应有独立的「Agent 看板」列表（没渲染 ⇒ 专属区块缺失）',
      ).toContain(AGENT_NAME);
    } finally {
      await page.close();
    }
  });

  it('L4-06 · 从未建过 Agent 看板时，`/agent` 是**明确空态**且不列人类项目', async () => {
    const page = await openPage(humanOnlyEnv, 'agent');
    try {
      expect(
        await page.locator('[data-agent-board-empty]').count(),
        '库里只有人类项目时，Agent 页必须给出明确空态（data-agent-board-empty）',
      ).toBeGreaterThan(0);
      const text = await mainText(page);
      expect(
        countOccurrences(text, HUMAN_NAME),
        `Agent 页用人类项目把空态面板填满了（v0.8 要修掉的那条）。命中处上下文：\n${contextOf(text, HUMAN_NAME)}`,
      ).toBe(0);
      expect(
        await page.locator('[data-agent-board-item]').count(),
        '空态下不得渲染任何看板项',
      ).toBe(0);
      // 下拉也必须是"暂无"而不是人类项目（#20 在空态下的形态）
      const options = (await page.locator('main select option').allInnerTexts()).map((s) => s.trim());
      expect(options).not.toContain(HUMAN_NAME);
    } finally {
      await page.close();
    }
  });

  /* ════════════════════ §7.3 特判：单项目直达必须带来源标识 ════════════════════ */

  it('L4-07 · `/project/<agent>` 详情页：渲染「AI 工作区」来源标识（穿越允许且有告知）', async () => {
    const page = await openPage(mainEnv, `project/${AGENT_PROJECT_ID}`, { expectText: AGENT_NAME });
    try {
      expect(
        await page.locator('[data-project-source-badge="agent"]').count(),
        'Agent 看板详情页缺少来源标识（§7.3 #27）',
      ).toBeGreaterThan(0);
      expect(await bodyText(page)).toContain(BADGE_TEXT);
    } finally {
      await page.close();
    }
  });

  it('L4-08 · 两个打印页：`/project/<agent>/{schedule,calendar}-print` 都带来源标识', async () => {
    for (const route of [
      `project/${AGENT_PROJECT_ID}/schedule-print`,
      `project/${AGENT_PROJECT_ID}/calendar-print`,
    ]) {
      const page = await openPage(mainEnv, route);
      try {
        // 打印页按 :id 直达、**没有列表可过滤** ⇒ 本轮的处置是"保留路由 + 补来源提示"（§7.3 #17/#18）
        await page
          .locator('[data-project-source-badge="agent"]')
          .first()
          .waitFor({ state: 'attached', timeout: 15000 })
          .catch(async () => {
            const text = await bodyText(page);
            throw new Error(`${route} 未渲染来源标识。页面文本片段：${text.slice(0, 400)}`);
          });
        expect(await bodyText(page)).toContain(BADGE_TEXT);
      } finally {
        await page.close();
      }
    }
  });

  it('L4-09 · 人类侧不给 Agent 看板任何打印入口（按钮消失；人类项目上仍在 ⇒ 判别力）', async () => {
    const printEntry = (page: Page) => page.getByRole('button', { name: '日程表' });

    const agentPage = await openPage(mainEnv, `project/${AGENT_PROJECT_ID}`, {
      expectText: AGENT_NAME,
    });
    try {
      expect(
        await printEntry(agentPage).count(),
        'Agent 看板详情页仍暴露「日程表」打印入口（§7.2 #17/#18 的入口侧收口）',
      ).toBe(0);
    } finally {
      await agentPage.close();
    }

    // 判别力：同一个按钮在**人类项目**上必须存在 —— 否则上面的 0 只说明"选择器写错了"
    const humanPage = await openPage(mainEnv, `project/${HUMAN_PROJECT_ID}`, {
      expectText: HUMAN_NAME,
    });
    try {
      expect(
        await printEntry(humanPage).count(),
        '人类项目详情页的打印入口不见了 ⇒ L4-09 的断言无判别力',
      ).toBeGreaterThan(0);
    } finally {
      await humanPage.close();
    }
  });
});
