/**
 * 期六 · 选择器弹窗化截图（主从式居中弹窗；UX 研究 print-preview-ux-study §1.3）。
 *
 * 她的两条抱怨：「没有打开全屏时显示不完整」「长条形选择方式排版不美观」。
 * 本 spec 用**真实组件**（PrintSelectorPanel）+ **真实构建产物 CSS** 经
 * renderToStaticMarkup 出静态弹窗，外套 Modal center 档的遮罩几何（同 Modal
 * 渲染结构：fixed 让出顶栏 + bg-ink/45 + flex 居中 + p-4 sm:p-6），真 Chromium
 * 在三种视口下截图并断言：
 *   ① full 1440×900：主从式全貌（左列 5 模板带真缩略图 + 右侧模块/配色），
 *      四张真图**真实加载**（naturalWidth>0——顺带验证 public/print-thumbs/
 *      落库文件有效）；
 *   ② small 900×600：她的原场景（非全屏窗口）——弹窗完整在视口内、右侧
 *      内容内部滚（不裁切）；
 *   ③ narrow 720×900（<xl）：左列转弹窗顶部横向滑动卡（同一棵树重排），
 *      断言 radiogroup 的 flex-direction 由 column 变 row 且横向可滚。
 *
 * 缩略图 src 在 file://  harness 下不可用绝对路径（'/print-thumbs/...' 会
 * 解析到文件系统根），故 spec 里把 src 改写成相对 public/ 目录的路径；
 * 真实应用里绝对路径由 vite public 语义提供（同 /logo.png 范式）。
 *
 * 前置：`npm run build --outDir build-dist` 与本机 chromium；缺任一整组 skip。
 * 产物落点：`outputs/print-a4-shots/selector-modal-*.png`（不进 git）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { PrintSelectorPanel } from '../src/components/print/PrintPreviewDialog';
import { printTemplateModuleIds } from '../src/components/print/print-templates';

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

/** 弹窗 markup（A 外表 + 全选原生模块）；缩略图 src 改写成 file:// 可加载的相对路径 */
function panelMarkup(): string {
  const raw = renderToStaticMarkup(
    createElement(PrintSelectorPanel, {
      template: 'swiss-schedule',
      pagesCount: 4,
      enabledModuleCount: 4,
      enabledModules: printTemplateModuleIds('swiss-schedule'),
      onTemplatePick: () => {},
      onToggleModule: () => {},
      onSelectAllModules: () => {},
      onSelectNoneModules: () => {},
      blocks: { header: true, timeline: true, projectInfo: true, stageTable: true, footer: true },
      onToggleBlock: () => {},
      onClose: () => {},
    }),
  );
  return raw.replace(/src="\/print-thumbs\//g, 'src="../../changxia/public/print-thumbs/');
}

/**
 * 外壳 = Modal center 档的两层结构（照 Modal.tsx 渲染结构复刻：外层遮罩
 * fixed 让出顶栏 + bg-ink/45；内层 flex h-full 居中 + p-4 sm:p-6。
 * ⚠️ 两层不能合并：外层已用 top/bottom 定高，再写 h-full 会过度约束
 * （bottom 被忽略、高度按视口算，弹窗底边溢出视口——本 spec 首版踩过）。
 * z-78 在静态页里无竞争故省略。
 */
function shell(panel: string, css: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8" /><style>' +
    css +
    '</style></head><body style="margin:0">' +
    '<div class="fixed inset-x-0 bottom-0 top-14 xl:top-16 bg-ink/45">' +
    '<div class="flex h-full w-full items-center justify-center p-4 sm:p-6">' +
    panel +
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
 * 三种视口：全貌 / 她的原场景（小窗完整）/ <xl 降级
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('期六 · 选择器弹窗截图（真 Chromium + 真实构建 CSS）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('① 1440×900 主从式全貌：左列 5 模板（4 真图加载）+ 右侧模块/配色', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto('file://' + writeHtml('selector-modal-full.html', shell(panelMarkup(), css)));

      // 左列 5 个模板卡 + radiogroup 语义
      expect(await page.$$('[data-print-template-option]')).toHaveLength(5);
      // 四张真缩略图真实加载（naturalWidth>0 ⇒ public/print-thumbs/ 落库文件有效）
      const imgs = await page.$$('img[data-print-template-thumb]');
      expect(imgs.length, '四版各一张真缩略图').toBe(4);
      for (const img of imgs) {
        const w = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
        expect(w, '真缩略图应加载成功').toBeGreaterThan(0);
      }
      // xl+ 左列是纵列（flex-direction: column）
      const dir = await page.$eval('[role="radiogroup"]', (el) => getComputedStyle(el).flexDirection);
      expect(dir, 'xl+ 左列应为纵列').toBe('column');
      // 弹窗完整在视口内（不裁切）
      const box = await (await page.$('[data-print-selector-panel]'))!.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(900);
      // 状态条读数（A 外表 4 模块 · 预计 4 页）
      const status = await page.$eval('[data-print-selector-panel]', (el) => el.textContent ?? '');
      expect(status).toContain('当前 4 个模块 · 预计 4 页');

      await (await page.$('[data-print-selector-panel]'))!.screenshot({
        path: join(OUT_DIR, 'selector-modal-full.png'),
      });
    } finally {
      await page.close();
    }
  });

  it('② 1280×720 她的原场景（桌面非全屏小窗）：主从式完整 + 右侧内部滚不裁切', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      await page.goto('file://' + writeHtml('selector-modal-small.html', shell(panelMarkup(), css)));

      // xl 仍生效 ⇒ 主从式（她的桌面场景：窗口没最大化，但不是窄屏）
      const dir = await page.$eval('[role="radiogroup"]', (el) => getComputedStyle(el).flexDirection);
      expect(dir, '1280 宽应保持左列纵列').toBe('column');

      // 弹窗完整落在视口内（她的抱怨「显示不完整」必须修好）
      const box = await (await page.$('[data-print-selector-panel]'))!.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
      expect(box!.y + box!.height, '弹窗底边不得出视口').toBeLessThanOrEqual(720);

      // 右侧内容区内部滚（内容高于可见区 ⇒ 滚而不是裁）
      const scroll = await page.$eval('[data-print-selector-content]', (el) => ({
        h: el.scrollHeight,
        c: el.clientHeight,
      }));
      expect(scroll.h, '内容应高于可见区（才有滚的意义）').toBeGreaterThan(scroll.c);

      await (await page.$('[data-print-selector-panel]'))!.screenshot({
        path: join(OUT_DIR, 'selector-modal-small.png'),
      });
    } finally {
      await page.close();
    }
  });

  it('③ 720×900 <xl 降级：左列转顶部横向滑动卡（同一棵树重排）', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
    try {
      await page.goto('file://' + writeHtml('selector-modal-narrow.html', shell(panelMarkup(), css)));

      // <xl：模板列表由纵列变横排且可横向滚（降级是重排不是第二套设计）
      const strip = await page.$eval('[role="radiogroup"]', (el) => {
        const s = getComputedStyle(el);
        return { dir: s.flexDirection, overflowX: s.overflowX, sw: el.scrollWidth, cw: el.clientWidth };
      });
      expect(strip.dir, '<xl 模板条应为横排').toBe('row');
      expect(strip.overflowX).toBe('auto');
      expect(strip.sw, '5 张卡应横向可滚').toBeGreaterThan(strip.cw);
      // 模板条在弹窗顶部（右侧内容区之下）
      const stripBox = await (await page.$('[role="radiogroup"]'))!.boundingBox();
      const contentBox = await (await page.$('[data-print-selector-content]'))!.boundingBox();
      expect(stripBox!.y, '模板条应在内容区上方').toBeLessThan(contentBox!.y);
      // 弹窗仍完整在视口内
      const box = await (await page.$('[data-print-selector-panel]'))!.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(900);

      await (await page.$('[data-print-selector-panel]'))!.screenshot({
        path: join(OUT_DIR, 'selector-modal-narrow.png'),
      });
    } finally {
      await page.close();
    }
  });
});
