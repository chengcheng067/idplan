/**
 * 选择器模块化 · 四套外表模块勾选态截图（v1.5-a 期二 · 产品决策文档 §3.3）。
 *
 * ── 为什么这样做验收 ──
 * 期二把选择器中截从「页勾选」升级为「11 个内容模块勾选」（外表 × 模块
 * 分离）：**原生模块**可勾选（默认全选，右侧标注归属页名），**非原生
 * 模块**禁用态 + 原因（通用渲染是期三，先立产品形态、不装能打）。
 * 本 spec 用**真实组件**（PrintModuleSection）+ **真实注册表数据**
 * （PRINT_MODULES / 能力表）经 renderToStaticMarkup 出静态面板，外挂
 * **真实构建产物**的 CSS（build-dist/assets/*.css——Tailwind JIT 生成的
 * 工具类都在里面），真 Chromium 逐外表截图并断言禁用态确实禁用。
 *
 * 前置：`npm run build --outDir build-dist`（产物在 build-dist/）与本机
 * chromium；缺任一则整组 skip（与 print-a4-visual.spec.ts 同口径）。
 *
 * 产物落点：`outputs/print-a4-shots/selector-modules-{a,d,e,h}.png`
 * （工作区交付目录，不进 git）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { PrintModuleSection } from '../src/components/print/PrintPreviewDialog';
import { printTemplateModuleIds } from '../src/components/print/print-skins';
import type { PrintTemplateId } from '../src/components/print/print-skins';

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

/* ------------------------------------------------------------------ 四套外表 */

/** 四版各一张（classic 走五块不进模块表，不在本组截图范围） */
const CASES: ReadonlyArray<{ tag: string; template: PrintTemplateId; nativeCount: number }> = [
  { tag: 'a', template: 'swiss-schedule', nativeCount: 4 },
  { tag: 'd', template: 'data-editorial', nativeCount: 4 },
  { tag: 'e', template: 'editorial-index', nativeCount: 3 },
  { tag: 'h', template: 'agent-poster', nativeCount: 2 },
];

function shell(bodyMarkup: string, css: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${css}</style></head><body style="margin:0"><div class="bg-cream" style="padding:24px"><div data-selector-shot="" class="w-[300px] rounded-md border border-line bg-paper p-1 shadow-overlay">${bodyMarkup}</div></div></body></html>`;
}

function writeHtml(name: string, html: string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const p = join(OUT_DIR, name);
  writeFileSync(p, html, 'utf-8');
  return p;
}

/* ====================================================================================
 * 截图 + 禁用态断言
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('选择器模块化 · 四套外表模块勾选态截图（真 Chromium）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('A/D/E/H 各自截图：11 行模块表单，原生可选（默认全选）+ 非原生禁用带原因', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
    try {
      for (const c of CASES) {
        // 真实组件 + 真实注册表：默认全选原生模块
        const markup = renderToStaticMarkup(
          createElement(PrintModuleSection, {
            template: c.template,
            enabledModules: printTemplateModuleIds(c.template),
          }),
        );
        const htmlPath = writeHtml(`selector-modules-${c.tag}.html`, shell(markup, css));
        await page.goto('file://' + htmlPath);

        // 11 行齐全（四套外表同一个模块表单，原生/禁用随外表变）
        const rows = await page.$$('[data-print-module-row]');
        expect(rows.length, `${c.tag} 外表应有 11 个模块行`).toBe(11);

        // 原生计数与能力表一致；原生可勾且默认全选
        const nativeCount = await page.$$eval('[data-print-module-row][data-native="on"]', (els) => els.length);
        expect(nativeCount, `${c.tag} 外表原生模块数`).toBe(c.nativeCount);
        const nativeChecked = await page.$$eval(
          '[data-print-module-row][data-native="on"] input[data-print-module]',
          (els) => els.filter((el) => (el as HTMLInputElement).checked).length,
        );
        expect(nativeChecked, `${c.tag} 原生模块默认全选`).toBe(c.nativeCount);

        // 非原生：禁用 + 不勾 + 原因文案（期三通用渲染补，不装能打）
        const offRows = await page.$$('[data-print-module-row][data-native="off"]');
        expect(offRows.length, `${c.tag} 非原生模块数`).toBe(11 - c.nativeCount);
        for (const row of offRows) {
          const disabled = await row.$eval('input[data-print-module]', (el) =>
            (el as HTMLInputElement).disabled,
          );
          expect(disabled, '非原生模块必须禁用').toBe(true);
          const text = (await row.textContent()) ?? '';
          expect(text, '禁用行带原因').toContain('该外表下暂不可用');
        }

        // 脚注：后续支持口径如实告知
        const note = await page.$eval('[data-print-module-section]', (el) => el.textContent ?? '');
        expect(note).toContain('将随通用渲染陆续支持');

        await (await page.$('[data-selector-shot]'))!.screenshot({
          path: join(OUT_DIR, `selector-modules-${c.tag}.png`),
        });
      }
    } finally {
      await page.close();
    }
  });
});
