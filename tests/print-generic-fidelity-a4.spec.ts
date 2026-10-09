/**
 * 期七 · 通用渲染语法保真 A4 视觉验收（真 Chromium + 真实构建 CSS；
 * UX 研究 print-preview-ux-study-2026-10-09 §2.6）。
 *
 * 覆盖变化最大的六个组合（H×M1/M2/M4、E×M1/M4、D×M1）+ A×M1 的
 * staggered ≤9 与 >9 回落两态——截图命名
 * `fidelity-<module>-<template>-p*-{color,gray}.png`，逐页 794×1123
 * 无裁切。另锁：新变体的配色跟随（computed style 实证，硬验收点）、
 * grid/blocks/staggered 的几何与密度合规。
 *
 * 前置：`npx vite build --outDir build-dist` 与本机 chromium；缺任一整组 skip。
 * 产物落点：`outputs/print-a4-shots/fidelity-*.png`（工作区交付目录，不进 git）。
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
      id: 'proj_fid_a4',
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
        id: `stg_fa_${n}`,
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
        ownerId: n === 2 ? 'm_fa_agent' : 'm_fa_human',
        colorIndex: ((n - 1) % 9) + 1,
        customColor: null,
        taskProgress: { done: n % 3, total: 4 },
      };
    }),
    tasks: Array.from({ length: taskCount }, (_, i) => {
      const n = i + 1;
      return {
        id: `tsk_fa_${n}`,
        taskNo: 1000 + n,
        title: `任务${n}·整理测绘图与材料清单并同步给施工方确认`,
        status: (['draft', 'ready', 'claimed', 'in_progress', 'blocked', 'review', 'done'] as TaskStatus[])[n % 7]!,
        assigneeNames: n % 2 === 0 ? ['负责人甲', '小 Agent'] : ['负责人甲'],
        dueDate: n === 4 ? '2026-10-01' : null,
        dependsOn: [],
        artifactCount: n % 3,
        artifacts: [],
        stageId: `stg_fa_${((n - 1) % stageCount) + 1}`,
        overdue: n === 4,
        source: 'human' as const,
        runId: null,
      };
    }),
    members: [
      { id: 'm_fa_human', name: '负责人甲', role: '项目负责人', roleKind: MemberRoleKind.Admin, actorKind: MemberActorKind.Human, agentKind: null, taskCount: 5 },
      { id: 'm_fa_agent', name: '小 Agent', role: '自动执行体', roleKind: MemberRoleKind.Member, actorKind: MemberActorKind.Agent, agentKind: 'brand-new-harness-9000', taskCount: 2 },
      { id: 'm_fa_plain', name: '施工方乙', role: '驻场工程师', roleKind: MemberRoleKind.Member, actorKind: MemberActorKind.Human, agentKind: null, taskCount: 1 },
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

/** 截图组合（变化最大的六个 + A×M1 两态） */
const SHOTS: ReadonlyArray<{
  tag: string;
  template: DocKind;
  module: 'stage-list' | 'task-list' | 'member-roster';
  stages: number;
  tasks: number;
}> = [
  { tag: 'stage-list-agent-poster', template: 'agent-poster', module: 'stage-list', stages: 6, tasks: 8 },
  { tag: 'task-list-agent-poster', template: 'agent-poster', module: 'task-list', stages: 6, tasks: 8 },
  { tag: 'member-roster-agent-poster', template: 'agent-poster', module: 'member-roster', stages: 6, tasks: 8 },
  { tag: 'stage-list-editorial-index', template: 'editorial-index', module: 'stage-list', stages: 6, tasks: 8 },
  { tag: 'member-roster-editorial-index', template: 'editorial-index', module: 'member-roster', stages: 6, tasks: 8 },
  { tag: 'stage-list-data-editorial', template: 'data-editorial', module: 'stage-list', stages: 6, tasks: 8 },
  // A×M1 两态：≤9 三列错落 / >9 回落表格
  { tag: 'stage-list-swiss-schedule-staggered9', template: 'swiss-schedule', module: 'stage-list', stages: 9, tasks: 0 },
  { tag: 'stage-list-swiss-schedule-table10', template: 'swiss-schedule', module: 'stage-list', stages: 10, tasks: 0 },
];

/* ====================================================================================
 * S1 · 八态截图（彩 + 灰），逐页 794×1123 无裁切
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('期七 · S1 保真截图（六组合 + A×M1 两态，真 Chromium）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('fidelity-* 彩/灰全量截图；每页 794×1123 无裁切', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const s of SHOTS) {
        const vm = buildVm(s.stages, s.tasks);
        const markup = renderDoc(s.template, vm, g(s.module));
        for (const gray of [false, true]) {
          const htmlPath = writeHtml(
            `fidelity-${s.tag}-${gray ? 'gray' : 'color'}.html`,
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
              path: join(OUT_DIR, `fidelity-${s.tag}-p${i + 1}-${gray ? 'gray' : 'color'}.png`),
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
 * S2 · 新变体配色跟随（硬验收点：走模板 token，不是硬编码色）
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('期七 · S2 新变体配色跟随（切预设 ⇒ computed style 变色）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('E×M1 grid：延期巨编号/章头的焦点色随 accent 槽变；H×M1 面板延期行/大数字随槽位变', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      /* ── E×M1：朱红基线 vs 靛蓝预设 ── */
      const ePreset = PRINT_TEMPLATE_PALETTES['editorial-index'].presets.find((p) => p.id === 'indigo')!;
      const probeE = async (tag: string, palette: typeof ePreset.palette) => {
        const htmlPath = writeHtml(
          `fidelity-palette-e-${tag}.html`,
          shell(renderDoc('editorial-index', vm, g('stage-list'), palette), css, false),
        );
        await page.goto('file://' + htmlPath);
        return {
          // 延期行巨编号的焦点色（--tpl-accent）
          focusNo: await page.$eval('.gm-grid__no[data-focus]', (el) => getComputedStyle(el).color),
          // 延期章头（accent + 粗线）
          chapter: await page.$eval('.gm-chapter[data-focus]', (el) => {
            const s = getComputedStyle(el);
            return { c: s.color, rule: s.borderTopColor };
          }),
          // 行线（--tpl-line 发丝线）
          rowLine: await page.$eval('.gm-grid__row', (el) => getComputedStyle(el).borderBottomColor),
        };
      };
      const eBase = await probeE('baseline', PRINT_TEMPLATE_PALETTES['editorial-index'].baseline);
      const eIndigo = await probeE('indigo', ePreset.palette);
      expect(eBase.focusNo, 'E 基线延期编号 = 朱红').toBe('rgb(200, 16, 46)');
      expect(eIndigo.focusNo, 'E 预设延期编号 = 靛蓝（accent 槽跟随）').toBe('rgb(43, 74, 203)');
      expect(eBase.chapter.c).toBe('rgb(200, 16, 46)');
      expect(eIndigo.chapter.c).toBe('rgb(43, 74, 203)');
      expect(eIndigo.chapter.rule).toBe('rgb(43, 74, 203)');
      // 纸面不开槽位：仍是暖浅纸
      const paper = await page.$eval('.a4-page', (el) => getComputedStyle(el).backgroundColor);
      expect(paper).toBe('rgb(250, 247, 242)');

      /* ── H×M1：信号橙基线 vs 朱红预设 ── */
      const hPreset = PRINT_TEMPLATE_PALETTES['agent-poster'].presets.find((p) => p.id === 'vermilion')!;
      const probeH = async (tag: string, palette: typeof hPreset.palette) => {
        const htmlPath = writeHtml(
          `fidelity-palette-h-${tag}.html`,
          shell(renderDoc('agent-poster', vm, g('stage-list'), palette), css, false),
        );
        await page.goto('file://' + htmlPath);
        return {
          // 右栏延期行状态词（accent）
          panelDelayed: await page.$eval('.gm-panel__item[data-delayed] .gm-panel__item-state', (el) =>
            getComputedStyle(el).color,
          ),
          // 右栏大数字（ink 槽）
          big: await page.$eval('.gm-panel__big', (el) => getComputedStyle(el).color),
          // 左栏延期行状态（accent）
          rowDelayed: await page.$eval('.gm-block-row[data-delayed] .gm-block-row__state', (el) =>
            getComputedStyle(el).color,
          ),
        };
      };
      const hBase = await probeH('baseline', PRINT_TEMPLATE_PALETTES['agent-poster'].baseline);
      const hVermilion = await probeH('vermilion', hPreset.palette);
      expect(hBase.panelDelayed, 'H 基线面板延期行 = 信号橙').toBe('rgb(232, 89, 12)');
      expect(hVermilion.panelDelayed, 'H 预设面板延期行 = 朱红（accent 槽跟随）').toBe('rgb(200, 16, 46)');
      expect(hBase.rowDelayed).toBe('rgb(232, 89, 12)');
      expect(hVermilion.rowDelayed).toBe('rgb(200, 16, 46)');
      // 大数字走 ink 槽（两预设的 ink 同为近黑 ⇒ 不变，证明没被 accent 污染）
      expect(hBase.big).toBe('rgb(10, 10, 10)');
      expect(hVermilion.big).toBe('rgb(10, 10, 10)');
    } finally {
      await page.close();
    }
  });
});

/* ====================================================================================
 * S3 · 变体几何与密度合规
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('期七 · S3 变体几何与密度（真 Chromium）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('E grid 巨编号行 / H blocks 行 / A 卡片：行高合规 + 巨编号 24px 衬线 + 右栏 240px', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      /* ── E grid：巨编号 24px 衬线 + 行高（E 原生目录行同档 37-42px） ── */
      await page.goto(
        'file://' +
          writeHtml('fidelity-geo-e.html', shell(renderDoc('editorial-index', vm, g('stage-list')), css, false)),
      );
      const eNo = await page.$eval('.gm-grid__no', (el) => {
        const s = getComputedStyle(el);
        return { fs: Number.parseFloat(s.fontSize), ff: s.fontFamily };
      });
      expect(eNo.fs, 'E 巨编号 = 24px').toBe(24);
      expect(eNo.ff, 'E 巨编号 = 衬线').toContain('Serif');
      const eRowH = await page.$eval('.gm-grid__row', (el) => el.getBoundingClientRect().height);
      expect(eRowH, 'E grid 行高（原生目录行同档，≥26 且 ≤44）').toBeGreaterThanOrEqual(26);
      expect(eRowH, 'E grid 行高（原生目录行同档，≥26 且 ≤44）').toBeLessThanOrEqual(44);
      // 行 padding ≥3px（密度约束 1）
      const ePad = await page.$eval('.gm-grid__row', (el) => getComputedStyle(el).paddingTop);
      expect(Number.parseFloat(ePad)).toBeGreaterThanOrEqual(3);
      // Agent 左签 3px 朱红（left-sign）
      const eSign = await page.$eval('.gm-grid__row[data-agent]', (el) => {
        const s = getComputedStyle(el);
        return { w: s.borderLeftWidth, c: s.borderLeftColor };
      });
      expect(eSign.w).toBe('3px');
      expect(eSign.c).toBe('rgb(200, 16, 46)');

      /* ── H blocks：左栏行高 26-36 + 右栏 240px + 大数字 mono ── */
      await page.goto(
        'file://' +
          writeHtml('fidelity-geo-h.html', shell(renderDoc('agent-poster', vm, g('stage-list')), css, false)),
      );
      const hRowH = await page.$eval('.gm-block-row', (el) => el.getBoundingClientRect().height);
      expect(hRowH, 'H blocks 行高应在 L2 区间 26-36px').toBeGreaterThanOrEqual(26);
      expect(hRowH, 'H blocks 行高应在 L2 区间 26-36px').toBeLessThanOrEqual(36);
      const hPanelW = await page.$eval('.gm-panel', (el) => el.getBoundingClientRect().width);
      expect(Math.abs(hPanelW - 240), 'H 右栏 = 240px（§2.6.4）').toBeLessThanOrEqual(2);
      const hBig = await page.$eval('.gm-panel__big', (el) => {
        const s = getComputedStyle(el);
        return { fs: Number.parseFloat(s.fontSize), ff: s.fontFamily };
      });
      expect(hBig.fs, '右栏大号 mono 数字 ≥28px').toBeGreaterThanOrEqual(28);
      expect(hBig.ff, '右栏数字 = mono（不借衬线巨字）').not.toContain('Serif');

      /* ── A staggered：三列错位 34/68 + 序号 20px ── */
      await page.goto(
        'file://' +
          writeHtml(
            'fidelity-geo-a9.html',
            shell(renderDoc('swiss-schedule', buildVm(9, 0), g('stage-list')), css, false),
          ),
      );
      const aCol2 = await page.$eval('.gm-staggered__col[data-col="2"]', (el) => getComputedStyle(el).marginTop);
      const aCol3 = await page.$eval('.gm-staggered__col[data-col="3"]', (el) => getComputedStyle(el).marginTop);
      expect(aCol2, 'A 第 2 列错位 34px').toBe('34px');
      expect(aCol3, 'A 第 3 列错位 68px').toBe('68px');
      const aNo = await page.$eval('.gm-card__no', (el) => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(aNo, 'A 卡片序号 = 20px（§2.6.2 A×M1 的 giant）').toBe(20);

      /* ── A >9 回落：表格行 + tabular 序号（无卡片） ── */
      await page.goto(
        'file://' +
          writeHtml(
            'fidelity-geo-a10.html',
            shell(renderDoc('swiss-schedule', buildVm(10, 0), g('stage-list')), css, false),
          ),
      );
      expect(await page.$('.gm-staggered'), '>9 条不应三列错落').toBeNull();
      const aRows = await page.$$('.gm-row');
      expect(aRows.length, '>9 条回落 register 表（10 行）').toBe(10);
      const aRowH = await page.$eval('.gm-row', (el) => el.getBoundingClientRect().height);
      expect(aRowH, 'A 表行高应在 L2 区间 26-36px').toBeGreaterThanOrEqual(26);
      expect(aRowH, 'A 表行高应在 L2 区间 26-36px').toBeLessThanOrEqual(36);
    } finally {
      await page.close();
    }
  });

  it('D×M1 KPI 带三格 + 进度条轨道 ≥6px + 延期行进度条信号色', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto(
        'file://' +
          writeHtml('fidelity-geo-d.html', shell(renderDoc('data-editorial', vm, g('stage-list')), css, false)),
      );
      const kpiCells = await page.$$('.gm-kpi .de-stat');
      expect(kpiCells.length, 'D×M1 KPI 带三格').toBe(3);
      // KPI 大数字 mono（de-stat__value 原生样式）
      const kpiValue = await page.$eval('.de-stat__value', (el) => {
        const s = getComputedStyle(el);
        return { fs: Number.parseFloat(s.fontSize), ff: s.fontFamily };
      });
      expect(kpiValue.fs, 'KPI 大数字 = 22px（D 原生 de-stat__value）').toBe(22);
      expect(kpiValue.ff, 'KPI 大数字 = mono').toContain('Mono');
      // 进度条轨道 ≥6px（密度约束 2）
      const track = await page.$eval('.de-bar__track', (el) => el.getBoundingClientRect().height);
      expect(track, '进度条轨道 ≥6px').toBeGreaterThanOrEqual(6);
      // 延期阶段（阶段 4）进度条填充走信号色
      const delayedFill = await page.$eval(
        '.gm-row[data-delayed] .de-bar__fill',
        (el) => getComputedStyle(el).backgroundColor,
      );
      expect(delayedFill, '延期阶段进度条 = 信号橙红').toBe('rgb(239, 75, 35)');
      // 普通阶段填充 = 墨色
      const plainFill = await page.$eval(
        '.gm-row:not([data-delayed]) .de-bar__fill',
        (el) => getComputedStyle(el).backgroundColor,
      );
      expect(plainFill, '普通阶段进度条 = 近黑').toBe('rgb(10, 10, 10)');
    } finally {
      await page.close();
    }
  });
});
