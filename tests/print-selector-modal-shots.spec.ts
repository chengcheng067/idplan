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
import { printToggleableUnits } from '../src/print/model/print-units';
import type { PrintBlockId } from '../src/print/model/print-units';
import { printTemplateMeta } from '../src/components/print/print-templates';
import type { PrintTemplateId } from '../src/components/print/print-templates';
import { printTemplateModuleIds } from '../src/components/print/print-templates';
import { builtCss as readBuiltCss } from './helpers/built-css';

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
  return readBuiltCss(ROOT);
}

/**
 * 弹窗 markup（A 外表 + 五块全开）；缩略图 src 改写成 file:// 可加载的相对路径。
 *
 * ⚠️ 2026-10-13「5 块 × 4 模板」重构 · 批 1：A 走**五块清单**（决策 1），
 * 中截不再是 11 个模块复选框 ⇒ 样本的 props 与状态条读数跟着改
 * （4 行可勾：B1 由刊头承担、不可摘、不进清单）。
 */
function panelMarkup(template: PrintTemplateId = 'swiss-schedule'): string {
  const meta = printTemplateMeta(template);
  const raw = renderToStaticMarkup(
    createElement(PrintSelectorPanel, {
      template,
      pagesCount: meta.usesBlocks ? 2 : 4,
      enabledModuleCount: meta.usesBlocks
        ? printToggleableUnits(template).length
        : printTemplateModuleIds(template).length,
      enabledModules: printTemplateModuleIds(template),
      onTemplatePick: () => {},
      onToggleModule: () => {},
      onSelectAllModules: () => {},
      onSelectNoneModules: () => {},
      unitRows: printToggleableUnits(template).map((u) => ({
        id: u.id as PrintBlockId,
        label: u.label,
        hint: u.hint,
        checked: true,
      })),
      onToggleUnit: () => {},
      forcedNote:
        meta.usesBlocks && template !== 'classic'
          ? '「打印头部」由该模板的刊头承载项目名与页序，属版式构件 —— 该模板当前不可摘。'
          : '',
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
      // 状态条读数（A 的五块清单：4 行可勾 · 预计 2 页）
      const status = await page.$eval('[data-print-selector-panel]', (el) => el.textContent ?? '');
      expect(status).toContain('当前 4 块 · 预计 2 页');
      // 五块清单的纪律文案（§2.6 纪律 1/2：不可摘的原因 + 装置不在此列）
      expect(status).toContain('由该模板的刊头承载项目名与页序，属版式构件');
      expect(status).toContain('该模板当前不可摘');
      expect(status).toContain('可摘项随版式而定');

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
      // ⚠️ 批 1 把 A 改成五块清单、批 B 把 D 也改了 ⇒ 现在只剩 E/H 还在 11 模块通路。
      // 本用例的「内部滚」判据需要内容更高的样本 ⇒ 用 **H**（3 原生 + 3 通用 + 剩余
      // 禁用，行数最多）；她的原场景不变量「不裁切」因此被完整保留。
      await page.goto(
        'file://' + writeHtml('selector-modal-small.html', shell(panelMarkup('agent-poster'), css)),
      );

      // xl 仍生效 ⇒ 主从式（她的桌面场景：窗口没最大化，但不是窄屏）
      const dir = await page.$eval('[role="radiogroup"]', (el) => getComputedStyle(el).flexDirection);
      expect(dir, '1280 宽应保持左列纵列').toBe('column');

      // 弹窗完整落在视口内（她的抱怨「显示不完整」必须修好）
      const box = await (await page.$('[data-print-selector-panel]'))!.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
      expect(box!.y + box!.height, '弹窗底边不得出视口').toBeLessThanOrEqual(720);

      /*
       * 右侧内容区的**不裁切**判据。
       *
       * ⚠️ 2026-10-13 批 D 重定：原来这条写的是「内容必须高于可见区（才有滚的意义）」
       * —— 那句是**代理判据**，成立的前提是「中截有 11 行模块清单 ⇒ 一定比 720 高的
       * 弹窗内容区还高」。批 D 把四套全切成五块清单（4 行）后，内容变矮、在这个
       * 尺寸下**正好装得下** ⇒ 代理判据失效（它会把「装得下」误判成缺陷）。
       * 真实判据是**不许裁**，两种活法都合格：
       *   · 装得下 ⇒ `scrollHeight <= clientHeight`（没有东西被切掉）；
       *   · 装不下 ⇒ 内容区必须是可滚容器（`overflow-y: auto`），滚而不是裁。
       */
      const scroll = await page.$eval('[data-print-selector-content]', (el) => ({
        h: el.scrollHeight,
        c: el.clientHeight,
        overflowY: getComputedStyle(el).overflowY,
      }));
      expect(
        scroll.h <= scroll.c + 1 || scroll.overflowY === 'auto',
        `内容区不许裁（实测 scrollH=${scroll.h} clientH=${scroll.c} overflowY=${scroll.overflowY}）`,
      ).toBe(true);

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

  it('④ A 的五块清单（决策 1 之后的中截）：4 行可勾 + 一句不可摘说明 ⇒ selector-modules-a.png', async () => {
    /*
     * 这张图是给用户看的「A 现在长什么样」：11 个内容模块的清单**已从 A 消失**
     * （决策 1/2），中截只剩五块里的 4 行（B1「打印头部」由刊头承担 ⇒ 不进清单），
     * 并在清单下方写明为什么。
     */
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto('file://' + writeHtml('selector-modules-a.html', shell(panelMarkup(), css)));
      // 4 行可勾，且**没有** 11 模块行
      const rows = await page.$$('input[data-print-block]');
      expect(rows, 'A 的中截应是 4 行可勾的五块清单').toHaveLength(4);
      expect(await page.$$('[data-print-module-row]'), 'A 不该再有 11 模块行').toHaveLength(0);
      const labels = await page.$$eval('input[data-print-block]', (els) =>
        els.map((el) => (el as HTMLInputElement).dataset.printBlock),
      );
      expect(labels, '行序 = 五块里的可勾项').toEqual([
        'timeline',
        'projectInfo',
        'stageTable',
        'footer',
      ]);
      // 全部默认勾选（缺键 = 默认开）
      const checked = await page.$$eval(
        'input[data-print-block]',
        (els) => els.filter((el) => (el as HTMLInputElement).checked).length,
      );
      expect(checked, '四行默认全勾').toBe(4);
      // 那句不可摘说明（裁决第 5 条的文案）
      const note = await page.$eval('[data-print-selector-panel]', (el) => el.textContent ?? '');
      expect(note).toContain('由该模板的刊头承载项目名与页序，属版式构件');
      expect(note).toContain('该模板当前不可摘');
      expect(note).toContain('可摘项随版式而定');
      await (await page.$('[data-print-selector-panel]'))!.screenshot({
        path: join(OUT_DIR, 'selector-modules-a.png'),
      });
    } finally {
      await page.close();
    }
  });

  it('⑤ E 的五块清单（批 C 之后的中截）：4 行可勾 + 句序同为「五块」⇒ selector-modules-e.png', async () => {
    /*
     * 2026-10-13 批 C：E 也切到五块清单 —— 这张图是给用户看的「E 现在长什么样」。
     * 与 ④ 的 A 图同范式、判据**逐条同源**（4 行可勾、行序 = 五块里的可勾项、
     * 默认全勾、那句不可摘说明），差别只在左列选中的模板：
     *   · E 的巨题装置（两行 92px）是**纸张上的**身份装置，与选择器无关；
     *   · E 与 A/D 共用同一套五块清单（这正是决策 1 的目的：清单不随外表变）。
     * 同时锁死「E 的 11 模块行已消失」——批 C 之后 A/D/E/classic 四套都没有了。
     */
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(
        'file://' + writeHtml('selector-modules-e.html', shell(panelMarkup('editorial-index'), css)),
      );
      const rows = await page.$$('input[data-print-block]');
      expect(rows, 'E 的中截应是 4 行可勾的五块清单').toHaveLength(4);
      expect(await page.$$('[data-print-module-row]'), 'E 不该再有 11 模块行').toHaveLength(0);
      const labels = await page.$$eval('input[data-print-block]', (els) =>
        els.map((el) => (el as HTMLInputElement).dataset.printBlock),
      );
      expect(labels, '行序 = 五块里的可勾项（与 A/D 逐项一致）').toEqual([
        'timeline',
        'projectInfo',
        'stageTable',
        'footer',
      ]);
      const checked = await page.$$eval(
        'input[data-print-block]',
        (els) => els.filter((el) => (el as HTMLInputElement).checked).length,
      );
      expect(checked, '四行默认全勾').toBe(4);
      const note = await page.$eval('[data-print-selector-panel]', (el) => el.textContent ?? '');
      expect(note).toContain('由该模板的刊头承载项目名与页序，属版式构件');
      expect(note).toContain('该模板当前不可摘');
      expect(note).toContain('可摘项随版式而定');
      await (await page.$('[data-print-selector-panel]'))!.screenshot({
        path: join(OUT_DIR, 'selector-modules-e.png'),
      });
    } finally {
      await page.close();
    }
  });
});
