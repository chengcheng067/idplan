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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
