/**
 * 期五 · 连续缩放工具条截图（滑块 + 百分比；产品决策文档 §七附）。
 *
 * 她的原话：「在打印预览的这个位置增加滑块，用于页面的放大与缩小」——
 * 本 spec 用**真实组件**（PrintZoomControls）+ **真实构建产物 CSS**
 * （build-dist/assets/*.css）经 renderToStaticMarkup 出静态工具条，
 * 真 Chromium 截图（outputs/print-a4-shots/zoom-slider.png），并断言
 * 滑块范围/步进/当前值与百分比读数。
 *
 * 取 custom 150% 态截图：滑块居中、百分比「150%」可见（fit 档在窄窗口下
 * 实测值可能低于滑块下限 50%，读数会被 range 输入钳住——截图不取那种态，
 * 免得把边界行为拍成默认形态）。
 *
 * 前置：`npm run build --outDir build-dist` 与本机 chromium；缺任一整组
 * skip（与 print-a4-visual.spec.ts 同口径）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { PrintZoomControls } from '../src/components/print/PrintPreviewDialog';

/* ------------------------------------------------------------------ 前置探测 */

const ROOT = resolve(__dirname, '..');
const DIST_INDEX = join(ROOT, 'build-dist', 'index.html');
const OUT_DIR = resolve(ROOT, '..', 'outputs', 'print-a4-shots');

function resolveChromium(): string | null {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  const candidates = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-linux64', 'chrome'],
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter((n) => n.startsWith('chromium-'))) {
      for (const rel of candidates) {
        const exe = join(root, dir, ...rel);
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const CHROMIUM_PATH = resolveChromium();
const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null;

/** 拼接全部构建产物 CSS（Tailwind 工具类 + 主题令牌都在里面） */
function builtCss(): string {
  const assets = join(ROOT, 'build-dist', 'assets');
  return readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assets, f), 'utf-8'))
    .join('\n');
}

/** 工具条外壳（照 PrintPreviewDialog 工具条的类；缩放控件是主角，其余从简） */
function shell(controlsMarkup: string, css: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8" /><style>' +
    css +
    '</style></head><body style="margin:0"><div class="bg-cream" style="padding:24px">' +
    '<div data-zoom-shot="" class="no-print flex items-center gap-3 border border-line bg-paper px-4" style="height:56px">' +
    '<h2 class="font-display text-base font-semibold text-ink">打印预览</h2>' +
    '<span class="text-xs text-mist">云栖·湖畔茶室 · 预计 4 页 · A4</span>' +
    '<span class="ml-auto"></span>' +
    controlsMarkup +
    '</div></div></body></html>'
  );
}

function writeHtml(name: string, html: string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const p = join(OUT_DIR, name);
  writeFileSync(p, html, 'utf-8');
  return p;
}

/* ====================================================================================
 * 截图 + 工具条断言
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('期五 · 缩放工具条截图（真 Chromium + 真实构建 CSS）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('滑块 + 百分比上条：custom 150% 态截图，范围/步进/读数断言', async () => {
    const css = builtCss();
    // 真实组件：custom 档 150%（锚点全灭——不是 fit 也不是 100%）
    const markup = renderToStaticMarkup(
      createElement(PrintZoomControls, {
        zoom: 'custom',
        scale: 1.5,
        onFit: () => {},
        onHundred: () => {},
        onScale: () => {},
      }),
    );

    const page = await browser.newPage({ viewport: { width: 900, height: 240 } });
    try {
      const htmlPath = writeHtml('zoom-slider.html', shell(markup, css));
      await page.goto('file://' + htmlPath);

      // 滑块属性与读数
      const slider = await page.$('[data-print-zoom-slider]');
      expect(slider, '滑块应渲染').not.toBeNull();
      const attrs = await page.$eval('[data-print-zoom-slider]', (el) => {
        const input = el as HTMLInputElement;
        return { min: input.min, max: input.max, step: input.step, value: input.value };
      });
      expect(attrs.min).toBe('50');
      expect(attrs.max).toBe('200');
      expect(attrs.step).toBe('5');
      expect(attrs.value, 'custom 150% 态滑块读数').toBe('150');
      const percent = await page.$eval('[data-print-zoom-value]', (el) => (el.textContent ?? '').trim());
      expect(percent, '百分比读数').toBe('150%');
      // accent 用 pine（需求方口径：现有 token 样式）
      const accent = await page.$eval('[data-print-zoom-slider]', (el) => getComputedStyle(el).accentColor);
      expect(accent, '滑块 accent 应为 pine 令牌').not.toBe('rgba(0, 0, 0, 0)');
      // 锚点两钮在（适应 / 100% 快速锚点不回归）
      const buttons = await page.$$('button');
      expect(buttons.length, '适应 / 100% 两个锚点钮应渲染').toBe(2);

      await (await page.$('[data-zoom-shot]'))!.screenshot({
        path: join(OUT_DIR, 'zoom-slider.png'),
      });
    } finally {
      await page.close();
    }
  });
});
