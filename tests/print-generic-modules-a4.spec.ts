/**
 * 期三第一批 · 通用渲染 A4 视觉验收（真构建产物 + 真 Chromium 实测）。
 * 产品决策文档 §3.2 候选 3 / §3.5 期三 v1.5-b / 决策 ⑭；
 * 验收口径：M1/M2/M4 × A/D/E/H 十二组合默认态 794×1123 无裁切。
 *
 * ── 方法（同 print-a4-visual 族先例） ──
 * ① 真实组件（四版 Document + 通用模块组件）+ VM 字面量夹具，经
 *    renderToStaticMarkup 出静态纸面（每组合**隔离渲染**：只开该模块）；
 * ② 外挂**真实构建产物**的 CSS（build-dist/assets/*.css——通用模块样式 +
 *    亮色锁 + 各版 token 都在里面）；
 * ③ 真 Chromium 逐页截图，断言每页 794×1123 **无裁切**（盒高超 1124 即红）。
 *
 * ── 本文件锁什么 ──
 *   V1 十二组合：彩 / 灰各 12 张（generic-<module>-<template>-p*-{color,gray}.png），
 *      逐页 794×1123 无裁切；
 *   V2 配色跟随实证（硬验收点）：切预设变体 ⇒ 通用渲染的 computed style
 *      跟着变（走模板 token，不是硬编码色）；骨架除 CSS 变量外逐字节一致；
 *   V3 长目录分页：60 任务跨页稳定（页码联动 / 行不裂 / 续头 / 无溢出）；
 *   V4 密度合规 + 四套外表的基础排版承接（行高 L2 区间 / compact padding
 *      ≥3px / accent 文字 ≥9.5px / 各版表格形态差异落地）。
 *
 * 前置：`npx vite build --outDir build-dist` 与本机 chromium；缺任一整组 skip。
 * 产物落点：`outputs/print-a4-shots/generic-*.png`（工作区交付目录，不进 git）。
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
import type { PrintModuleId } from '../src/components/print/print-skins';
import type {
  PrintMemberVM,
  PrintSheet,
  PrintStageVM,
  PrintTaskVM,
  PrintViewModel,
} from '../src/print/model/print-view-model';
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

/* ------------------------------------------------------------------ 夹具（VM 字面量） */

const PROJECT_ID = 'proj_generic_a4';

function stageVm(n: number): PrintStageVM {
  return {
    id: `stg_ga_${n}`,
    orderIndex: n,
    name: `阶段${n}·现场勘查与方案深化`,
    ratioPercent: 11,
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
    ownerId: n === 2 ? 'm_ga_agent' : 'm_ga_human',
    colorIndex: ((n - 1) % 9) + 1,
    customColor: null,
    taskProgress: { done: n % 3, total: 4 },
  };
}

function taskVm(n: number): PrintTaskVM {
  return {
    id: `tsk_ga_${n}`,
    taskNo: 1000 + n,
    title: `任务${n}·整理测绘图与材料清单并同步给施工方确认`,
    status: (['draft', 'ready', 'claimed', 'in_progress', 'blocked', 'review', 'done'] as TaskStatus[])[
      n % 7
    ]!,
    assigneeNames: n % 2 === 0 ? ['负责人甲', '小 Agent'] : ['负责人甲'],
    dueDate: n === 4 ? '2026-10-01' : null,
    dependsOn: [],
    artifactCount: n % 3,
    artifacts: [],
    stageId: `stg_ga_${((n - 1) % 6) + 1}`,
    overdue: n === 4,
    source: 'human',
    runId: null,
  };
}

const MEMBERS: PrintMemberVM[] = [
  {
    id: 'm_ga_human',
    name: '负责人甲',
    role: '项目负责人',
    roleKind: MemberRoleKind.Admin,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    taskCount: 5,
  },
  {
    id: 'm_ga_agent',
    name: '小 Agent',
    role: '自动执行体',
    roleKind: MemberRoleKind.Member,
    actorKind: MemberActorKind.Agent,
    agentKind: 'brand-new-harness-9000',
    taskCount: 2,
  },
  {
    id: 'm_ga_plain',
    name: '施工方乙',
    role: '驻场工程师',
    roleKind: MemberRoleKind.Member,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    taskCount: 1,
  },
];

/** 6 阶段（四态齐全）/ 8 任务（七态轮换 + 1 逾期）/ 3 成员（含 Agent） */
function buildVm(taskCount = 8): PrintViewModel {
  return {
    project: {
      id: PROJECT_ID,
      name: '云栖·湖畔茶室综合改造项目',
      address: '城区某路 1 号',
      clientName: '客户甲',
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-03-01',
      scheduleBasisLabel: '自然日',
      percent: 50,
      visibleStageCount: 6,
      projectOverdue: false,
      todayIso: '2026-10-09',
    },
    stages: Array.from({ length: 6 }, (_, i) => stageVm(i + 1)),
    tasks: Array.from({ length: taskCount }, (_, i) => taskVm(i + 1)),
    members: MEMBERS,
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

type DocKind = 'swiss-schedule' | 'data-editorial' | 'editorial-index' | 'agent-poster';

function renderDoc(template: DocKind, vm: PrintViewModel, sheets: readonly PrintSheet[], palette = PRINT_TEMPLATE_PALETTES[template].baseline): string {
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

/** 十二组合（隔离渲染：只开该模块；A/E 的 M1/M4 是原生页） */
const COMBOS: ReadonlyArray<{ module: PrintModuleId; template: DocKind; pageAttr: string }> = [
  { module: 'stage-list', template: 'swiss-schedule', pageAttr: 'stage-overview' },
  { module: 'stage-list', template: 'data-editorial', pageAttr: 'generic-stage-list' },
  { module: 'stage-list', template: 'editorial-index', pageAttr: 'stage-index' },
  { module: 'stage-list', template: 'agent-poster', pageAttr: 'generic-stage-list' },
  { module: 'task-list', template: 'swiss-schedule', pageAttr: 'task-register' },
  { module: 'task-list', template: 'data-editorial', pageAttr: 'generic-task-list' },
  { module: 'task-list', template: 'editorial-index', pageAttr: 'generic-task-list' },
  { module: 'task-list', template: 'agent-poster', pageAttr: 'generic-task-list' },
  { module: 'member-roster', template: 'swiss-schedule', pageAttr: 'member-roster' },
  { module: 'member-roster', template: 'data-editorial', pageAttr: 'generic-member-roster' },
  { module: 'member-roster', template: 'editorial-index', pageAttr: 'member-index' },
  { module: 'member-roster', template: 'agent-poster', pageAttr: 'generic-member-roster' },
];

const sheetsOf = (c: { module: PrintModuleId; pageAttr: string }): PrintSheet[] =>
  c.pageAttr.startsWith('generic-')
    ? [{ type: 'generic', module: c.module }]
    : [{ type: 'native', page: c.pageAttr as 'stage-overview' }];

/* ====================================================================================
 * V1 · 十二组合默认态：彩 / 灰各 12 张，逐页 794×1123 无裁切
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('期三 · V1 十二组合默认态（真 Chromium + 真实构建 CSS）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('M1/M2/M4 × A/D/E/H：每组合一页，彩 + 灰全量截图，794×1123 无裁切', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const c of COMBOS) {
        const markup = renderDoc(c.template, vm, sheetsOf(c));
        for (const gray of [false, true]) {
          const htmlPath = writeHtml(
            `generic-${c.module}-${c.template}-${gray ? 'gray' : 'color'}.html`,
            shell(markup, css, gray),
          );
          await page.goto('file://' + htmlPath);
          const pages = await page.$$('.a4-page');
          expect(pages.length, `${c.module} × ${c.template} 应恰好一页`).toBe(1);
          const el = pages[0]!;
          expect(await el.getAttribute('data-print-page'), '页属性').toBe(c.pageAttr);
          const box = await el.boundingBox();
          expect(box, '应有布局盒').not.toBeNull();
          expect(Math.abs(box!.width - 794), `${c.module} × ${c.template} 页宽应 794`).toBeLessThanOrEqual(1);
          expect(box!.height, `${c.module} × ${c.template} 溢出即红`).toBeLessThanOrEqual(1124);
          expect(box!.height, `${c.module} × ${c.template} 不得低于 1123`).toBeGreaterThanOrEqual(1122);
          await el.screenshot({
            path: join(
              OUT_DIR,
              `generic-${c.module}-${c.template}-p1-${gray ? 'gray' : 'color'}.png`,
            ),
          });
        }
      }
    } finally {
      await page.close();
    }
  });
});

/* ====================================================================================
 * V2 · 配色跟随实证（硬验收点：通用渲染走模板 token，不是硬编码色）
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('期三 · V2 配色跟随（切预设 ⇒ computed style 变色）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('D 外表阶段清单：基线 vs 靛蓝预设 vs 自定义三槽——通用渲染 computed style 全跟随槽位', async () => {
    const css = builtCss();
    const vm = buildVm();
    const combo = COMBOS[1]!; // stage-list × data-editorial
    const preset = PRINT_TEMPLATE_PALETTES['data-editorial'].presets.find((p) => p.id === 'indigo')!;
    // 自定义三槽全换（accent/ink/line 各不同）——证三枚槽位都接进去了
    const custom = { accent: '#3B5BDB', ink: '#1A1A2E', line: '#B8B8B8' };

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const probe = async (tag: string, palette: typeof preset.palette) => {
        const htmlPath = writeHtml(
          `generic-palette-${tag}.html`,
          shell(renderDoc('data-editorial', vm, sheetsOf(combo), palette), css, false),
        );
        await page.goto('file://' + htmlPath);
        const p1 = (await page.$('.a4-page'))!;
        return {
          signal: await p1.$eval('.gm-state[data-tone="signal"]', (el) => getComputedStyle(el).color),
          headRule: await p1.$eval('.gm-head', (el) => getComputedStyle(el).borderBottomColor),
          rowLine: await p1.$eval('.gm-table td', (el) => getComputedStyle(el).borderBottomColor),
          numFont: await p1.$eval('.gm-num', (el) => getComputedStyle(el).fontFamily),
          paper: await p1.evaluate((el) => getComputedStyle(el).backgroundColor),
        };
      };

      const base = await probe('baseline', PRINT_TEMPLATE_PALETTES['data-editorial'].baseline);
      const indigo = await probe('indigo', preset.palette);
      const full = await probe('custom', custom);

      // 基线：信号橙红 #EF4B23 / 墨 #0A0A0A / 线 #C9C9C9
      expect(base.signal, '基线延期态 = 信号橙红').toBe('rgb(239, 75, 35)');
      expect(base.headRule, '基线模块头线 = 近黑').toBe('rgb(10, 10, 10)');
      expect(base.rowLine, '基线行线 = #C9C9C9').toBe('rgb(201, 201, 201)');
      expect(base.paper, '纸面纯白不开槽位').toBe('rgb(255, 255, 255)');
      // 预设（只换 accent）：延期态跟换，ink/line 两槽该预设未动故保持基线
      expect(indigo.signal, '预设延期态 = 靛蓝（accent 槽跟随）').toBe('rgb(59, 91, 219)');
      expect(indigo.headRule, '该预设未换 ink 槽').toBe(base.headRule);
      expect(indigo.rowLine, '该预设未换 line 槽').toBe(base.rowLine);
      // 自定义三槽全换：三处 computed style 全部跟随
      expect(full.signal, '自定义 accent 槽').toBe('rgb(59, 91, 219)');
      expect(full.headRule, '自定义 ink 槽 ⇒ 模块头线跟随').toBe('rgb(26, 26, 46)');
      expect(full.rowLine, '自定义 line 槽 ⇒ 行线跟随').toBe('rgb(184, 184, 184)');
      // 纸面仍纯白（paper 不开槽位 = D 的身份）
      expect(full.paper).toBe('rgb(255, 255, 255)');
      // 等宽数字族仍在（排版形态不随配色变）
      expect(base.numFont).toContain('IBM Plex Mono');
      expect(full.numFont).toBe(base.numFont);

      // 结构断言：骨架除 .print-root 的 CSS 变量外逐字节一致
      const strip = (s: string): string =>
        s.replace(/(<div class="print-root[^"]*")\s+style="[^"]*"/, '$1');
      expect(strip(renderDoc('data-editorial', vm, sheetsOf(combo), preset.palette))).toBe(
        strip(renderDoc('data-editorial', vm, sheetsOf(combo), PRINT_TEMPLATE_PALETTES['data-editorial'].baseline)),
      );
    } finally {
      await page.close();
    }
  });
});

/* ====================================================================================
 * V3 · 长目录分页：60 任务跨页稳定
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('期三 · V3 长目录分页（60 任务 · D 外表）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('跨页：页码联动 / 行不裂 / 续头只标真跨页 / 每页无溢出', async () => {
    const css = builtCss();
    const vm = buildVm(60);
    const combo = COMBOS[5]!; // task-list × data-editorial
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml(
        'generic-task-list-longlist.html',
        shell(renderDoc('data-editorial', vm, sheetsOf(combo)), css, false),
      );
      await page.goto('file://' + htmlPath);
      const pages = await page.$$('.a4-page');
      expect(pages.length, '60 任务应跨页（>1 物理页）').toBeGreaterThan(1);

      let totalRows = 0;
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(Math.abs(box!.width - 794), `第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
        expect(box!.height, `第 ${i + 1} 页溢出即红`).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({ path: join(OUT_DIR, `generic-task-list-longlist-p${i + 1}-color.png`) });
        totalRows += await pages[i]!.$$eval('.gm-row', (els) => els.length);
        // 页码联动：第 i / N 页，N 同源
        const text = (await pages[i]!.textContent()) ?? '';
        expect(text, `第 ${i + 1} 页页码`).toContain(`第 ${i + 1} / ${pages.length} 页`);
        // 每页自解释：表头 + 口径注齐全
        expect(await pages[i]!.$('.gm-table thead'), `第 ${i + 1} 页表头`).not.toBeNull();
        expect(await pages[i]!.$('.gm-note'), `第 ${i + 1} 页口径注`).not.toBeNull();
      }
      expect(totalRows, '60 行全部上纸（行不裂）').toBe(60);
      // 续头只标真跨页：第 2 页起模块头带「（续）」，第 1 页不带
      const first = (await pages[0]!.textContent()) ?? '';
      expect(first, '第一页不得出现续头').not.toContain('（续）');
      const second = (await pages[1]!.textContent()) ?? '';
      expect(second, '第二页应带「（续）」').toContain('任务清单（续）');
    } finally {
      await page.close();
    }
  });
});

/* ====================================================================================
 * V4 · 密度合规 + 四套外表的基础排版承接
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('期三 · V4 密度合规 + 外表承接（真 Chromium）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('L2 行高区间 26-36px / compact padding ≥3px / accent 文字 ≥9.5px / 口径注 ≤10px', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      // normal 档（D · 阶段清单）
      await page.goto(
        'file://' +
          writeHtml(
            'generic-density-normal.html',
            shell(renderDoc('data-editorial', vm, sheetsOf(COMBOS[1]!)), css, false),
          ),
      );
      const rowH = await page.$eval('.gm-row', (el) => el.getBoundingClientRect().height);
      expect(rowH, 'normal 行高应在 L2 区间 26-36px').toBeGreaterThanOrEqual(26);
      expect(rowH, 'normal 行高应在 L2 区间 26-36px').toBeLessThanOrEqual(36);
      const pad = await page.$eval('.gm-table td', (el) => getComputedStyle(el).padding);
      const padTop = Number.parseFloat(pad);
      expect(padTop, 'normal 行 padding 上侧 ≥3px（密度 §4 约束 1）').toBeGreaterThanOrEqual(3);
      const signalFs = await page.$eval('.gm-state[data-tone="signal"]', (el) =>
        Number.parseFloat(getComputedStyle(el).fontSize),
      );
      expect(signalFs, 'accent 文字 ≥9.5px（密度 §4 约束 3）').toBeGreaterThanOrEqual(9.5);
      const noteFs = await page.$eval('.gm-note', (el) => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(noteFs, '口径注 ≤10px（L3 附属层）').toBeLessThanOrEqual(10);

      // compact 档（60 任务）
      await page.goto(
        'file://' +
          writeHtml(
            'generic-density-compact.html',
            shell(renderDoc('data-editorial', buildVm(60), sheetsOf(COMBOS[5]!)), css, false),
          ),
      );
      const cpad = await page.$eval('.gm-table td', (el) => getComputedStyle(el).padding);
      expect(Number.parseFloat(cpad), 'compact 行 padding 上侧 ≥3px（压线，不再出第三档）').toBeGreaterThanOrEqual(3);
      const crowH = await page.$eval('.gm-row', (el) => el.getBoundingClientRect().height);
      expect(crowH, 'compact 行高应整体紧于 normal').toBeLessThan(rowH);
    } finally {
      await page.close();
    }
  });

  it('期七四套外表语法承接落地：A 三列错落卡片 / D KPI 带 + 进度条 / E grid 巨编号分章 / H blocks 右栏面板', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      /* ── A：stage-list 6 条 ≤9 ⇒ staggered 三列错落卡片（A 原生 P1 语法） ── */
      await page.goto(
        'file://' +
          writeHtml(
            'generic-tpl-a.html',
            shell(renderDoc('swiss-schedule', vm, [{ type: 'generic', module: 'stage-list' }]), css, false),
          ),
      );
      const aHead = await page.$eval('.gm-head', (el) => {
        const s = getComputedStyle(el);
        return { w: s.borderBottomWidth, c: s.borderBottomColor };
      });
      expect(aHead.w, 'A 模块头 = 2px 粗线').toBe('2px');
      expect(aHead.c, 'A 头线 = 墨色（line 槽）').toBe('rgb(25, 24, 22)');
      // staggered：三列 + 列 2/3 纵向错位 34/68（同原生 swiss-column）
      const aCols = await page.$$('.gm-staggered__col');
      expect(aCols.length, 'A×M1 ≤9 应三列错落').toBe(3);
      const aCol2Mt = await page.$eval('.gm-staggered__col[data-col="2"]', (el) => getComputedStyle(el).marginTop);
      const aCol3Mt = await page.$eval('.gm-staggered__col[data-col="3"]', (el) => getComputedStyle(el).marginTop);
      expect(aCol2Mt, '第 2 列错位 34px').toBe('34px');
      expect(aCol3Mt, '第 3 列错位 68px').toBe('68px');
      // 序号 20px 粗体锚点（§2.6.2 A×M1 的 giant = 20px，不是 E 的 24px 衬线）
      const aNo = await page.$eval('.gm-card__no', (el) => {
        const s = getComputedStyle(el);
        return { fs: Number.parseFloat(s.fontSize), fw: s.fontWeight };
      });
      expect(aNo.fs, 'A 卡片序号 = 20px').toBe(20);
      expect(Number(aNo.fw), 'A 卡片序号加粗').toBeGreaterThanOrEqual(700);
      // A 的延期态不走 accent 色（accent = 纸面黄，作文字色不可读）——加重 + 字形
      const aSignal = await page.$eval('.gm-card[data-state="delayed"] .gm-card__state', (el) => {
        const s = getComputedStyle(el);
        return { c: s.color, fw: s.fontWeight };
      });
      expect(aSignal.c, 'A 延期态文字仍是墨色（accent 是纸面色）').toBe('rgb(25, 24, 22)');
      expect(Number(aSignal.fw), 'A 延期态加重（双编码）').toBeGreaterThanOrEqual(700);

      /* ── D：merged 表 + KPI 带 + 行内进度条（D 原生 ProgressMatrix 语法） ── */
      await page.goto(
        'file://' +
          writeHtml(
            'generic-tpl-d.html',
            shell(renderDoc('data-editorial', vm, [{ type: 'generic', module: 'stage-list' }]), css, false),
          ),
      );
      const dRow = await page.$eval('.gm-table td', (el) => getComputedStyle(el).borderBottomColor);
      expect(dRow, 'D 行线 = #C9C9C9').toBe('rgb(201, 201, 201)');
      const dTh = await page.$eval('.gm-table th', (el) => getComputedStyle(el).borderBottomColor);
      expect(dTh, 'D 表头线 = 近黑硬边').toBe('rgb(10, 10, 10)');
      // KPI 带三格（复用原生 de-stat 视觉）
      const kpiCells = await page.$$('.gm-kpi .de-stat');
      expect(kpiCells.length, 'D×M1 KPI 带三格').toBe(3);
      // 行内进度条（复用原生 de-bar；轨道 8px ≥ 密度约束 2 的 6px 下限）
      const track = await page.$eval('.de-bar__track', (el) => el.getBoundingClientRect().height);
      expect(track, '进度条轨道 8px（≥6px 下限）').toBeGreaterThanOrEqual(6);

      /* ── E：grid 行 + 24px 衬线巨编号 + 按状态分章 + 发丝线 ── */
      await page.goto(
        'file://' +
          writeHtml(
            'generic-tpl-e.html',
            shell(renderDoc('editorial-index', vm, [{ type: 'generic', module: 'stage-list' }]), css, false),
          ),
      );
      const eRow = await page.$eval('.gm-grid__row', (el) => {
        const s = getComputedStyle(el);
        return { w: s.borderBottomWidth, c: s.borderBottomColor, display: s.display };
      });
      expect(eRow.display, 'E 行是 grid（不是 table）').toBe('grid');
      expect(eRow.w, 'E 行线 = 1px 发丝线').toBe('1px');
      expect(eRow.c, 'E 行线 = #CFC8BC').toBe('rgb(207, 200, 188)');
      // 巨编号：24px 衬线（E 的目录身份装置）
      const eNo = await page.$eval('.gm-grid__no', (el) => {
        const s = getComputedStyle(el);
        return { fs: Number.parseFloat(s.fontSize), ff: s.fontFamily };
      });
      expect(eNo.fs, 'E 巨编号 = 24px').toBe(24);
      expect(eNo.ff, 'E 巨编号 = 衬线').toContain('Serif');
      // 分章：章头 2px 粗章节线 + 计数
      const eChapter = await page.$eval('.gm-chapter', (el) => {
        const s = getComputedStyle(el);
        return { w: s.borderTopWidth, c: s.borderTopColor };
      });
      expect(eChapter.w, 'E 章头 = 2px 粗章节线').toBe('2px');
      expect(eChapter.c, 'E 章线 = 近黑').toBe('rgb(20, 20, 20)');
      // Agent 左签：3px 朱红（left-sign）
      const eSign = await page.$eval('.gm-grid__row[data-agent]', (el) => {
        const s = getComputedStyle(el);
        return { w: s.borderLeftWidth, c: s.borderLeftColor };
      });
      expect(eSign.w, 'E Agent 行 = 3px 粗左边签').toBe('3px');
      expect(eSign.c, 'E 左签 = 朱红').toBe('rgb(200, 16, 46)');

      /* ── H：blocks 双栏 + 右栏面板（大号 mono，不借衬线巨字） ── */
      await page.goto(
        'file://' +
          writeHtml(
            'generic-tpl-h.html',
            shell(renderDoc('agent-poster', vm, [{ type: 'generic', module: 'member-roster' }]), css, false),
          ),
      );
      const hHead = await page.$eval('.gm-head', (el) => {
        const s = getComputedStyle(el);
        return { w: s.borderTopWidth, c: s.borderTopColor };
      });
      expect(hHead.w, 'H 模块头 = 2px 粗上线').toBe('2px');
      expect(hHead.c, 'H 头线 = 近黑').toBe('rgb(10, 10, 10)');
      // 双栏：左明细 + 右 240px 摘要
      const hPanelW = await page.$eval('.gm-panel', (el) => el.getBoundingClientRect().width);
      expect(Math.abs(hPanelW - 240), 'H 右栏 = 240px').toBeLessThanOrEqual(2);
      // 右栏大号 mono 数字（不借衬线巨字：字体族是 mono 不含 Serif）
      const hBig = await page.$eval('.gm-panel__big', (el) => {
        const s = getComputedStyle(el);
        return { fs: Number.parseFloat(s.fontSize), ff: s.fontFamily };
      });
      expect(hBig.fs, '右栏大号数字 ≥28px').toBeGreaterThanOrEqual(28);
      expect(hBig.ff, '右栏数字 = mono（非衬线巨字）').not.toContain('Serif');
      expect(hBig.ff, '右栏数字 = IBM Plex Mono').toContain('IBM Plex Mono');
    } finally {
      await page.close();
    }
  });
});
