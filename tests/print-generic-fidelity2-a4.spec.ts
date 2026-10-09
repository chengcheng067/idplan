/**
 * 期七深化 · A4 视觉验收（真 Chromium + 真实构建 CSS；对照四张新稿的签名特性）。
 *
 * 覆盖四张重点截图（A×M1 分组态 / D×M1 双色条 / E×M1 元信息行 / H×M1 右栏块）
 * + H×M2 双栏卡，命名 `fidelity2-<module>-<template>-p*-{color,gray}.png`，
 * 逐页 794×1123 无裁切。另锁每处新特性的 computed style 实证（分组粗线 /
 * 双色两值 / 元信息行文本 / 右栏橙线与双栏中轴 / 状态标签底色）。
 *
 * 前置：`npx vite build --outDir build-dist` 与本机 chromium；缺任一整组 skip。
 * 产物落点：`outputs/print-a4-shots/fidelity2-*.png`（工作区交付目录，不进 git）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { SwissScheduleDocument } from '../src/print/documents/SwissScheduleDocument';
import { DataEditorialDocument } from '../src/print/documents/DataEditorialDocument';
import { EditorialIndexDocument } from '../src/print/documents/EditorialIndexDocument';
import { AgentPosterDocument } from '../src/print/documents/AgentPosterDocument';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import type { PrintSheet, PrintViewModel } from '../src/print/model/print-view-model';
import { MemberActorKind, MemberRoleKind, StageStatus, TaskStatus } from '../src/core/types/enums';

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

function builtCss(): string {
  const assets = join(ROOT, 'build-dist', 'assets');
  return readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assets, f), 'utf-8'))
    .join('\n');
}

/* ------------------------------------------------------------------ 夹具 */

type DocKind = 'swiss-schedule' | 'data-editorial' | 'editorial-index' | 'agent-poster';

function buildVm(stageCount = 6, taskCount = 8): PrintViewModel {
  return {
    project: {
      id: 'proj_fid2',
      name: '云栖·湖畔茶室综合改造项目',
      address: '城区某路 1 号',
      clientName: '客户甲',
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-03-01',
      scheduleBasisLabel: '自然日',
      percent: 50,
      visibleStageCount: stageCount,
      projectOverdue: false,
      todayIso: '2026-10-09',
    },
    stages: Array.from({ length: stageCount }, (_, i) => {
      const n = i + 1;
      return {
        id: `stg_f2_${n}`,
        orderIndex: n,
        name: `阶段${n}·现场勘查与方案深化`,
        ratioPercent: 10,
        startAt: '2026-01-05',
        endAt: '2026-01-20',
        status:
          n % 4 === 0
            ? StageStatus.Delayed
            : n % 3 === 0
              ? StageStatus.Completed
              : n % 3 === 1
                ? StageStatus.InProgress
                : StageStatus.NotStarted,
        ownerName: n === 2 ? '小 Agent' : '负责人甲',
        ownerId: n === 2 ? 'm_f2_agent' : 'm_f2_human',
        colorIndex: ((n - 1) % 9) + 1,
        customColor: null,
        taskProgress: { done: n % 3, total: 4 },
      };
    }),
    tasks: Array.from({ length: taskCount }, (_, i) => {
      const n = i + 1;
      return {
        id: `tsk_f2_${n}`,
        taskNo: 1000 + n,
        title: `任务${n}·整理测绘图与材料清单并同步给施工方确认`,
        status: (['draft', 'ready', 'claimed', 'in_progress', 'blocked', 'review', 'done'] as TaskStatus[])[n % 7]!,
        assigneeNames: n % 2 === 0 ? ['负责人甲', '小 Agent'] : ['负责人甲'],
        dueDate: n === 4 ? '2026-10-01' : null,
        dependsOn: [],
        artifactCount: n % 3,
        artifacts: [],
        stageId: `stg_f2_${((n - 1) % stageCount) + 1}`,
        overdue: n === 4,
        source: 'human' as const,
        runId: null,
      };
    }),
    members: [
      { id: 'm_f2_human', name: '负责人甲', role: '项目负责人', roleKind: MemberRoleKind.Admin, actorKind: MemberActorKind.Human, agentKind: null, taskCount: 5 },
      { id: 'm_f2_agent', name: '小 Agent', role: '自动执行体', roleKind: MemberRoleKind.Member, actorKind: MemberActorKind.Agent, agentKind: 'brand-new-harness-9000', taskCount: 2 },
      { id: 'm_f2_plain', name: '施工方乙', role: '驻场工程师', roleKind: MemberRoleKind.Member, actorKind: MemberActorKind.Human, agentKind: null, taskCount: 1 },
    ],
    stageLogs: [],
    executions: [],
    proposals: [],
    generatedAt: '2026-10-09T07:30:00Z',
    viewerRole: 'admin',
  };
}

/* ------------------------------------------------------------------ HTML 装配 */

function shell(bodyMarkup: string, css: string, grayscale: boolean): string {
  const gray = grayscale ? '<style>.print-root{filter:grayscale(1);}</style>' : '';
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${css}</style>${gray}</head><body style="margin:0;background:#fff">${bodyMarkup}</body></html>`;
}

function writeHtml(name: string, html: string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const p = join(OUT_DIR, name);
  writeFileSync(p, html, 'utf-8');
  return p;
}

function renderDoc(
  template: DocKind,
  vm: PrintViewModel,
  sheets: readonly PrintSheet[],
  palette = PRINT_TEMPLATE_PALETTES[template].baseline,
): string {
  switch (template) {
    case 'swiss-schedule':
      return renderToStaticMarkup(createElement(SwissScheduleDocument, { vm, sheets, palette }));
    case 'data-editorial':
      return renderToStaticMarkup(createElement(DataEditorialDocument, { vm, sheets, palette }));
    case 'editorial-index':
      return renderToStaticMarkup(createElement(EditorialIndexDocument, { vm, sheets, palette }));
    case 'agent-poster':
      return renderToStaticMarkup(createElement(AgentPosterDocument, { vm, sheets, palette }));
  }
}

const g = (module: 'stage-list' | 'task-list' | 'member-roster'): PrintSheet[] => [
  { type: 'generic', module },
];

/** 四张重点 + H×M2 双栏卡 */
const SHOTS: ReadonlyArray<{ tag: string; template: DocKind; module: 'stage-list' | 'task-list'; stages: number; tasks: number }> = [
  { tag: 'stage-list-swiss-schedule', template: 'swiss-schedule', module: 'stage-list', stages: 9, tasks: 0 },
  { tag: 'stage-list-data-editorial', template: 'data-editorial', module: 'stage-list', stages: 6, tasks: 8 },
  { tag: 'stage-list-editorial-index', template: 'editorial-index', module: 'stage-list', stages: 6, tasks: 8 },
  { tag: 'stage-list-agent-poster', template: 'agent-poster', module: 'stage-list', stages: 6, tasks: 8 },
  { tag: 'task-list-agent-poster', template: 'agent-poster', module: 'task-list', stages: 6, tasks: 8 },
];

/* ====================================================================================
 * D1 · 五态截图（彩 + 灰），逐页 794×1123 无裁切
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('期七深化 · D1 保真截图（四重点 + 双栏卡，真 Chromium）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('fidelity2-* 彩/灰全量截图；每页 794×1123 无裁切', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const s of SHOTS) {
        const vm = buildVm(s.stages, s.tasks);
        const markup = renderDoc(s.template, vm, g(s.module));
        for (const gray of [false, true]) {
          const htmlPath = writeHtml(
            `fidelity2-${s.tag}-${gray ? 'gray' : 'color'}.html`,
            shell(markup, css, gray),
          );
          await page.goto('file://' + htmlPath);
          const pages = await page.$$('.a4-page');
          expect(pages.length, `${s.tag} 应至少一页`).toBeGreaterThanOrEqual(1);
          for (let i = 0; i < pages.length; i++) {
            const box = await pages[i]!.boundingBox();
            expect(Math.abs(box!.width - 794), `${s.tag} 第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
            expect(box!.height, `${s.tag} 第 ${i + 1} 页溢出即红`).toBeLessThanOrEqual(1124);
            expect(box!.height, `${s.tag} 第 ${i + 1} 页不得低于 1123`).toBeGreaterThanOrEqual(1122);
            await pages[i]!.screenshot({
              path: join(OUT_DIR, `fidelity2-${s.tag}-p${i + 1}-${gray ? 'gray' : 'color'}.png`),
            });
          }
        }
      }
    } finally {
      await page.close();
    }
  });
});

/* ====================================================================================
 * D2 · 新特性 computed style 实证
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('期七深化 · D2 新特性 computed style（真 Chromium）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('A 分组头：三组「前期/中期/后期」+ 2px 墨色粗线（组间分隔）', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto(
        'file://' +
          writeHtml('fidelity2-geo-a.html', shell(renderDoc('swiss-schedule', buildVm(9, 0), g('stage-list')), css, false)),
      );
      const phases = await page.$$eval('.gm-phase__label', (els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, '')));
      expect(phases).toEqual(['前期/PREP', '中期/BUILD', '后期/CLOSE']);
      const rule = await page.$eval('.gm-phase', (el) => {
        const s = getComputedStyle(el);
        return { w: s.borderBottomWidth, c: s.borderBottomColor };
      });
      expect(rule.w, '组头粗线 = 2px').toBe('2px');
      expect(rule.c, '组头线 = 墨色（line 槽）').toBe('rgb(25, 24, 22)');
      // 三组卡片归属：01-03 / 04-06 / 07-09
      const cols = await page.$$eval('.gm-staggered__col', (els) =>
        els.map((col) => Array.from(col.querySelectorAll('.gm-card__no')).map((n) => n.textContent)),
      );
      expect(cols).toEqual([
        ['01', '02', '03'],
        ['04', '05', '06'],
        ['07', '08', '09'],
      ]);
    } finally {
      await page.close();
    }
  });

  it('D 双色进度条：fill 近黑（已完成）+ track 浅灰（剩余）+ 段内白字 9.5px', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto(
        'file://' +
          writeHtml('fidelity2-geo-d.html', shell(renderDoc('data-editorial', buildVm(), g('stage-list')), css, false)),
      );
      // 双色编码：fill = 已完成部分（近黑）/ track = 剩余（浅灰）——computed 两值实证
      const fill = await page.$eval('.gm-row:not([data-delayed]) .de-bar__fill', (el) =>
        getComputedStyle(el).backgroundColor,
      );
      const track = await page.$eval('.de-bar__track', (el) => getComputedStyle(el).backgroundColor);
      expect(fill, '已完成部分 = 近黑').toBe('rgb(10, 10, 10)');
      expect(track, '剩余部分 = 浅灰（de-gray-100 #F5F5F5）').toBe('rgb(245, 245, 245)');
      expect(fill, '双色 ≠ 同色').not.toBe(track);
      // 延期阶段 fill 走信号色（重点状态双编码仍成立）
      const dFill = await page.$eval('.gm-row[data-delayed] .de-bar__fill', (el) =>
        getComputedStyle(el).backgroundColor,
      );
      expect(dFill, '延期阶段已完成部分 = 信号橙红').toBe('rgb(239, 75, 35)');
      // 段内白字百分比：25% 行有嵌段白字（9.5px）
      const num = await page.$eval('.gm-bar__num', (el) => {
        const s = getComputedStyle(el);
        return { text: el.textContent, fs: Number.parseFloat(s.fontSize), color: s.color };
      });
      expect(num.text).toBe('25%');
      expect(num.color, '段内字 = 白').toBe('rgb(255, 255, 255)');
      expect(num.fs, '段内字 ≥9.5px').toBeGreaterThanOrEqual(9.5);
    } finally {
      await page.close();
    }
  });

  it('E 元信息行：原生页「可见阶段 6 · 完成度 50%」+ 上下发丝线', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto(
        'file://' +
          writeHtml('fidelity2-geo-e.html', shell(renderDoc('editorial-index', buildVm(), [{ type: 'native', page: 'stage-index' }]), css, false)),
      );
      const meta = await page.$eval('.ei-meta', (el) => {
        const s = getComputedStyle(el);
        return { text: el.textContent ?? '', top: s.borderTopWidth, topColor: s.borderTopColor, bottom: s.borderBottomWidth };
      });
      expect(meta.text).toBe('可见阶段 6 · 完成度 50%');
      expect(meta.top, '元信息行上发丝线 = 1px').toBe('1px');
      expect(meta.bottom, '元信息行下发丝线 = 1px').toBe('1px');
      expect(meta.topColor, '发丝线 = line 槽').toBe('rgb(207, 200, 188)');
    } finally {
      await page.close();
    }
  });

  it('H 右栏橙线权重 + 双栏卡中轴 2px 橙 + 状态标签墨/橙底色', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      // H×M1 右栏：2px 橙顶线（向新稿「置信度块」靠）
      await page.goto(
        'file://' +
          writeHtml('fidelity2-geo-h1.html', shell(renderDoc('agent-poster', buildVm(), g('stage-list')), css, false)),
      );
      const panel = await page.$eval('.gm-panel', (el) => {
        const s = getComputedStyle(el);
        return { w: s.borderTopWidth, c: s.borderTopColor };
      });
      expect(panel.w, '右栏顶线 = 2px').toBe('2px');
      expect(panel.c, '右栏顶线 = 治理焦点橙（置信度块权重）').toBe('rgb(232, 89, 12)');

      // H×M2 双栏卡：中轴 2px 橙 + 标签底色（门控橙 / 其他墨）
      await page.goto(
        'file://' +
          writeHtml('fidelity2-geo-h2.html', shell(renderDoc('agent-poster', buildVm(), g('task-list')), css, false)),
      );
      const axis = await page.$eval('.gm-task-cols', (el) => {
        const s = getComputedStyle(el, '::before');
        return { w: s.width, bg: s.backgroundColor };
      });
      expect(axis.w, '双栏中轴 = 2px').toBe('2px');
      expect(axis.bg, '中轴 = 橙').toBe('rgb(232, 89, 12)');
      const sysTag = await page.$eval('.gm-task-tag[data-tone="sys"]', (el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, color: s.color, fs: Number.parseFloat(s.fontSize) };
      });
      expect(sysTag.bg, '普通态标签 = 墨底').toBe('rgb(10, 10, 10)');
      expect(sysTag.color, '标签字 = 白').toBe('rgb(255, 255, 255)');
      expect(sysTag.fs, '标签 mono ≥9.5px').toBeGreaterThanOrEqual(9.5);
      const gateTag = await page.$eval('.gm-task-tag[data-tone="gate"]', (el) =>
        getComputedStyle(el).backgroundColor,
      );
      expect(gateTag, '门控态标签 = 橙底').toBe('rgb(232, 89, 12)');
    } finally {
      await page.close();
    }
  });
});
