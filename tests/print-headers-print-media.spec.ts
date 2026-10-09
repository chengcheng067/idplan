/**
 * 纸面页头 print 媒体豁免验收（预存 bug 修复 · 2026-10-09 期三收尾）。
 *
 * ── bug 事实 ──
 * global.css 的 `@media print { header { display: none !important } }`
 * （v0.4 `4924734` 为隐藏应用 TopBar 引入）会命中四版模板纸面内的语义
 * `<header>`（A 黑顶栏 / D·E·H 页头 / H P2 分组头）——真机打印、另存 PDF
 * 与 print-frame iframe 路径（整包拷贝样式表）下页头整块消失。既有视觉
 * spec 全走 screen 媒体截图，故一直未红（探针实证：screen=flex / print=none）。
 *
 * ── 修法 ──
 * ① 四套模板 CSS 各自 @media print 块加页头豁免（两类选择器 + !important ⇒
 *   特异性高者胜，与同块内「纸面背景压过 global」同一手法）：
 *   A .swiss-topbar / D .de-head / E .ei-head / H .ap-head ⇒ display:flex
 *   H .ap-status__group-head ⇒ display:block（h3 组题 + p 组注**纵排**，
 *     不能跟 blanket-flex 否则并排压坏 P2 双栏——按元素显式还原的理由）
 * ② global.css 的 @media print 块加两条纸面豁免（经典/月历无自有样式表，
 *   落点选 global.css：一条 `.print-root .a4-page header ⇒ flex` 覆盖经典
 *   SchedulePaper + 月历打印页（均 flex 布局）；行程打印页的抬头是
 *   `.print-root` 直接子元素且 block 布局，单独一条 `.print-root > header
 *   ⇒ block`）。block 布局的纸面 header 一律按实际布局接条，不默认 flex。
 * screen 态零变化；应用级 header（TopBar，在 .print-root 外）print 态仍
 * none（global 裸规则的本职保留）。
 *
 * ── 本文件锁什么 ──
 *   P1 四版页头 print 态可见（display 非 none + 有布局盒）；
 *   P2 A 黑顶栏 print 态背景色 computed 仍在（print-color-adjust 链路未破）；
 *   P3 H 分组头 print 态 block 且组题/组注仍纵排（没被 flex 化）；
 *   P4 screen 态四版页头不变（豁免只作用于 print 媒体）；
 *   P5 应用级 header print 态仍 none（裸规则本职：TopBar 不进打印件）；
 *   P6 经典（默认模板，断言最全）：真实 SchedulePaper 渲染，screen 不变 +
 *      print 可见 + 打印头部四个信息位（项目名/委托方/周期/打印日期）都在；
 *   P7 月历打印页 / P8 行程打印页：真实类名骨架（源码锁钉住 DOM 契约）
 *      screen 不变 + print display 与各自既有布局一致且有布局盒、页题在纸面。
 *
 * 前置：`npx vite build --outDir build-dist` 与本机 chromium；缺任一整组 skip。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { SwissScheduleDocument } from '../src/print/documents/SwissScheduleDocument';
import { DataEditorialDocument } from '../src/print/documents/DataEditorialDocument';
import { EditorialIndexDocument } from '../src/print/documents/EditorialIndexDocument';
import { AgentPosterDocument } from '../src/print/documents/AgentPosterDocument';
import { SchedulePaper } from '../src/components/print/SchedulePaper';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import type { PrintViewModel } from '../src/print/model/print-view-model';
import { MemberActorKind, MemberRoleKind, StageStatus, TaskStatus } from '../src/core/types/enums';

/* ------------------------------------------------------------------ 前置探测 */

const ROOT = resolve(__dirname, '..');
const DIST_INDEX = join(ROOT, 'build-dist', 'index.html');

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

/* ------------------------------------------------------------------ 夹具（最小 VM） */

/** 2 阶段 / 2 任务 / 2 成员（含 Agent）/ 2 执行（H P2 分组头需要 Agent 数据） */
function buildVm(): PrintViewModel {
  return {
    project: {
      id: 'proj_hdr',
      name: '云栖·湖畔茶室综合改造项目',
      address: '城区某路 1 号',
      clientName: '客户甲',
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-03-01',
      scheduleBasisLabel: '自然日',
      percent: 50,
      visibleStageCount: 2,
      projectOverdue: false,
      todayIso: '2026-10-09',
    },
    stages: [
      {
        id: 'stg_hdr_1',
        orderIndex: 1,
        name: '现场勘查',
        ratioPercent: 50,
        startAt: '2026-01-05',
        endAt: '2026-01-20',
        status: StageStatus.InProgress,
        ownerName: '负责人甲',
        ownerId: 'm_hdr_human',
        colorIndex: 1,
        customColor: null,
        taskProgress: { done: 1, total: 2 },
      },
      {
        id: 'stg_hdr_2',
        orderIndex: 2,
        name: '方案深化',
        ratioPercent: 50,
        startAt: '2026-01-21',
        endAt: '2026-02-05',
        status: StageStatus.Delayed,
        ownerName: '小 Agent',
        ownerId: 'm_hdr_agent',
        colorIndex: 2,
        customColor: null,
        taskProgress: { done: 0, total: 1 },
      },
    ],
    tasks: [
      {
        id: 'tsk_hdr_1',
        taskNo: 1001,
        title: '整理测绘图与材料清单',
        status: TaskStatus.InProgress,
        assigneeNames: ['负责人甲'],
        dueDate: null,
        dependsOn: [],
        artifactCount: 1,
        artifacts: [],
        stageId: 'stg_hdr_1',
        overdue: false,
        source: 'human',
        runId: null,
      },
      {
        id: 'tsk_hdr_2',
        taskNo: 1002,
        title: '同步施工方确认',
        status: TaskStatus.Done,
        assigneeNames: ['小 Agent'],
        dueDate: null,
        dependsOn: [],
        artifactCount: 0,
        artifacts: [],
        stageId: 'stg_hdr_2',
        overdue: false,
        source: 'agent',
        runId: 'run_hdr_1',
      },
    ],
    members: [
      {
        id: 'm_hdr_human',
        name: '负责人甲',
        role: '项目负责人',
        roleKind: MemberRoleKind.Admin,
        actorKind: MemberActorKind.Human,
        agentKind: null,
        taskCount: 1,
      },
      {
        id: 'm_hdr_agent',
        name: '小 Agent',
        role: '自动执行体',
        roleKind: MemberRoleKind.Member,
        actorKind: MemberActorKind.Agent,
        agentKind: 'brand-new-harness-9000',
        taskCount: 1,
      },
    ],
    stageLogs: [],
    executions: [
      {
        id: 'exec_hdr_1',
        taskId: 'tsk_hdr_2',
        source: 'project-task',
        objective: '整理测绘图与材料清单',
        agentName: '小 Agent',
        status: 'running',
        currentAttemptNo: 1,
        runId: 'run_hdr_1',
        createdAt: '2026-10-08T01:00:00Z',
        startedAt: '2026-10-08T01:30:00Z',
        finishedAt: null,
        terminalReason: null,
        blockedReason: null,
      },
    ],
    proposals: [],
    generatedAt: '2026-10-09T07:30:00Z',
    viewerRole: 'admin',
  };
}

/* ------------------------------------------------------------------ HTML 装配 */

/**
 * 纸面外壳 + 一个**应用级** header（.print-root 外，模拟 TopBar）——用于断言
 * global 裸规则的本职未被破坏（应用 chrome 仍不进打印件）。
 */
function shell(bodyMarkup: string, css: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${css}</style></head><body style="margin:0;background:#fff"><header data-app-header="" style="display:flex;height:56px">应用顶栏（模拟 TopBar）</header>${bodyMarkup}</body></html>`;
}

type DocKind = 'swiss-schedule' | 'data-editorial' | 'editorial-index' | 'agent-poster';

function renderDoc(template: DocKind, vm: PrintViewModel): string {
  const palette = PRINT_TEMPLATE_PALETTES[template].baseline;
  switch (template) {
    case 'swiss-schedule':
      return renderToStaticMarkup(createElement(SwissScheduleDocument, { vm, palette }));
    case 'data-editorial':
      return renderToStaticMarkup(createElement(DataEditorialDocument, { vm, palette }));
    case 'editorial-index':
      return renderToStaticMarkup(createElement(EditorialIndexDocument, { vm, palette }));
    case 'agent-poster':
      return renderToStaticMarkup(createElement(AgentPosterDocument, { vm, palette }));
  }
}

/** 四版页头选择器（纸面内的语义 <header>） */
const HEAD_SEL: Record<DocKind, string> = {
  'swiss-schedule': '.swiss-topbar',
  'data-editorial': '.de-head',
  'editorial-index': '.ei-head',
  'agent-poster': '.ap-head',
};

/** 经典（默认模板）最小夹具：1 阶段 1 任务，blocks 默认全开 */
const CLASSIC_SECTIONS = [
  {
    orderIndex: 1,
    name: '现场勘查',
    startAt: '2026-01-05',
    endAt: '2026-01-20',
    status: StageStatus.InProgress,
    colorIndex: 1,
    customColor: null,
    tasks: [{ id: 'tsk_cls_1', title: '复核尺寸', dueDate: null, done: false, assigneeNames: [] }],
  },
];

function renderClassic(vm: PrintViewModel): string {
  return renderToStaticMarkup(
    createElement(SchedulePaper, {
      project: vm.project,
      pages: [CLASSIC_SECTIONS],
      sections: CLASSIC_SECTIONS,
      bandGeom: () => ({ left: 0, width: 50 }),
      monthTicks: [],
      nowText: '2026-10-09 07:30',
      startAt: '2026-01-01',
      endAt: '2026-03-01',
      totalDays: 60,
      role: 'admin',
      pageRef: () => null,
      skin: 'default',
      logo: null,
    }),
  );
}

/**
 * 月历 / 行程打印页是 store/router 耦合组件（useParams + useRepos +
 * useRoleGuard + 异步装载），Chromium spec 里真实渲染要整套 mock 戏法；
 * 且本 spec 的被测 unit 是 **CSS 豁免规则**（global.css），不是页面组件。
 * 故用「真实类名骨架 + 源码锁」：骨架逐字复刻两页抬头与容器的真实类名
 * （从源码读出），源码锁钉住这些类名不漂移——结构漂移 ⇒ 源码锁先红。
 * 两页自身的 DOM 渲染由 itinerary-print.spec.tsx 等既有 jsdom spec 覆盖。
 */
const CALENDAR_SKELETON = `<div class="print-root mx-auto w-full max-w-[900px] px-6 py-8"><div class="a4-page mx-auto mb-6 flex flex-col" style="width:794px;min-height:1123px;padding:40"><header class="flex items-start justify-between border-b border-line pb-2"><div><h1 class="text-[26px] font-bold leading-tight text-ink">云栖·湖畔茶室综合改造项目</h1><p class="mt-0.5 text-[13px] text-mist">委托方：客户甲</p><p class="text-[13px] text-mist">周期：2026-01-01 – 2026-03-01</p></div><span class="shrink-0 text-[13px] text-mist">ID Plan 月历</span></header></div></div>`;

const ITINERARY_SKELETON = `<div class="print-root mx-auto max-w-4xl bg-paper p-8"><header class="mb-5 border-b border-line pb-4"><h1 class="font-display text-2xl font-semibold text-ink">云南七日·亲子团</h1><p class="mt-1.5 text-sm text-mist">行程周期：2026-10-01 — 2026-10-03<span class="ml-3">共 3 天</span></p></header><table class="w-full border-collapse text-sm"><tbody><tr><td class="py-2.5 pr-3 text-ink">第 1 天</td></tr></tbody></table></div>`;

/* ====================================================================================
 * 验收
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('纸面页头 print 媒体豁免（真 Chromium + 真实构建 CSS）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('P1 四版页头：screen 态 flex 不变 + print 态可见（display 非 none 且有布局盒）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const t of Object.keys(HEAD_SEL) as DocKind[]) {
        await page.setContent(shell(renderDoc(t, vm), css));
        const sel = HEAD_SEL[t];
        // screen 态：豁免不作用（基线形态）
        await page.emulateMedia({ media: 'screen' });
        const screenDisplay = await page.$eval(sel, (el) => getComputedStyle(el).display);
        expect(screenDisplay, `${t} screen 态页头应为 flex`).toBe('flex');
        // print 态：豁免生效（修复前为 none，页头整块消失）
        await page.emulateMedia({ media: 'print' });
        const printDisplay = await page.$eval(sel, (el) => getComputedStyle(el).display);
        expect(printDisplay, `${t} print 态页头应可见（豁免生效）`).not.toBe('none');
        const box = await page.$eval(sel, (el) => {
          const r = el.getBoundingClientRect();
          return { w: r.width, h: r.height };
        });
        expect(box.h, `${t} print 态页头应有布局盒（高 > 0）`).toBeGreaterThan(0);
        expect(box.w, `${t} print 态页头应通栏`).toBeGreaterThan(600);
        // 页题/项目名文本仍在纸面上（每页可独立解释）
        const text = (await page.textContent('body')) ?? '';
        expect(text, `${t} print 态应含页题`).toContain(t === 'agent-poster' ? 'Agent 执行宣告' : t === 'data-editorial' ? '阶段进度矩阵' : t === 'editorial-index' ? '阶段目录' : 'PROJECT');
      }
    } finally {
      await page.close();
    }
  });

  it('P2 A 版黑顶栏：print 态背景色 computed 仍在（exact 链路未破）+ 栏目导航可见', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.setContent(shell(renderDoc('swiss-schedule', vm), css));
      await page.emulateMedia({ media: 'print' });
      const bar = await page.$eval('.swiss-topbar', (el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, color: s.color };
      });
      expect(bar.bg, 'print 态黑顶栏栏底 = --tpl-line 基线黑').toBe('rgb(25, 24, 22)');
      expect(bar.color, 'print 态栏内黄字反白').toBe('rgb(242, 217, 87)');
      // 栏目导航（PROJECT/TASK/DELAY/TEAM DEPARTURES）有布局盒
      const navH = await page.$eval('.swiss-topbar__nav', (el) => el.getBoundingClientRect().height);
      expect(navH, '栏目导航行应有高度').toBeGreaterThan(0);
      // 项目名（站名）仍在
      const titleH = await page.$eval('.swiss-topbar__title', (el) => el.getBoundingClientRect().height);
      expect(titleH, '项目名站名应有高度').toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('P3 H 版分组头：print 态 block 且组题/组注仍纵排（没被 blanket-flex 并排）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.setContent(shell(renderDoc('agent-poster', vm), css));
      await page.emulateMedia({ media: 'print' });
      const heads = await page.$$('.ap-status__group-head');
      expect(heads.length, 'P2 执行状态全览应有分组头（四组流程）').toBeGreaterThan(0);
      const display = await page.$eval('.ap-status__group-head', (el) => getComputedStyle(el).display);
      expect(display, '分组头 print 态应为 block（纵排布局，不是 flex）').toBe('block');
      // 组题（h3）与组注（p）纵排：p 的顶边不低于 h3 的底边
      const stack = await page.$eval('.ap-status__group-head', (el) => {
        const h3 = el.querySelector('h3')!.getBoundingClientRect();
        const p = el.querySelector('p')!.getBoundingClientRect();
        return { h3Bottom: h3.bottom, pTop: p.top, h3H: h3.height, pH: p.height };
      });
      expect(stack.h3H, '组题应有高度').toBeGreaterThan(0);
      expect(stack.pH, '组注应有高度').toBeGreaterThan(0);
      expect(stack.pTop, '组注应在组题下方（纵排未被并排化）').toBeGreaterThanOrEqual(stack.h3Bottom - 1);
    } finally {
      await page.close();
    }
  });

  it('P4/P5 应用级 header：print 态仍 none（裸规则本职保留）、screen 态正常', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.setContent(shell(renderDoc('data-editorial', vm), css));
      // screen：应用顶栏正常显示
      await page.emulateMedia({ media: 'screen' });
      const screenDisplay = await page.$eval('[data-app-header]', (el) => getComputedStyle(el).display);
      expect(screenDisplay).toBe('flex');
      // print：应用顶栏仍被隐藏（TopBar 不进打印件——global 规则的本职）
      await page.emulateMedia({ media: 'print' });
      const printDisplay = await page.$eval('[data-app-header]', (el) => getComputedStyle(el).display);
      expect(printDisplay, '应用级 header print 态应仍为 none（豁免只罩 .a4-page 内）').toBe('none');
      const appBox = await page.$eval('[data-app-header]', (el) => el.getBoundingClientRect().height);
      expect(appBox, 'print 态应用顶栏应无布局盒').toBe(0);
      // 同时纸面页头仍可见（两个断言同页，证明豁免与本职共存）
      const paperHead = await page.$eval('.de-head', (el) => getComputedStyle(el).display);
      expect(paperHead, '同页纸面页头应可见').not.toBe('none');
    } finally {
      await page.close();
    }
  });

  it('P6 经典（默认模板）：真实 SchedulePaper——screen 不变 + print 可见 + 打印头部四信息位齐全', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.setContent(shell(renderClassic(vm), css));
      const headSel = '.a4-page header';
      // screen 态：flex 不变（豁免只作用 print）
      await page.emulateMedia({ media: 'screen' });
      expect(await page.$eval(headSel, (el) => getComputedStyle(el).display), 'screen 态应为 flex').toBe('flex');
      // print 态：豁免生效（修复前 none，整个打印头部消失）
      await page.emulateMedia({ media: 'print' });
      expect(await page.$eval(headSel, (el) => getComputedStyle(el).display), 'print 态应可见').toBe('flex');
      const headH = await page.$eval(headSel, (el) => el.getBoundingClientRect().height);
      expect(headH, 'print 态打印头部应有布局盒').toBeGreaterThan(0);
      // 打印头部四个信息位（SchedulePaper.tsx:169 块内）print 态都有布局盒
      const bits = await page.$eval(headSel, (el) => {
        const h1 = el.querySelector('h1')!.getBoundingClientRect();
        const ps = Array.from(el.querySelectorAll('p')).map((p) => ({
          text: p.textContent ?? '',
          h: p.getBoundingClientRect().height,
        }));
        // 打印日期是 header 的直接子 span（委托方是 p 内的嵌套 span，别取错）
        const dateSpan = Array.from(el.children).find((c) => c.tagName === 'SPAN');
        return {
          h1H: h1.height,
          h1Text: el.querySelector('h1')!.textContent ?? '',
          ps,
          dateH: dateSpan ? dateSpan.getBoundingClientRect().height : 0,
        };
      });
      expect(bits.h1H, '项目名应有高度').toBeGreaterThan(0);
      expect(bits.h1Text, '项目名文本').toContain('云栖·湖畔茶室综合改造项目');
      const client = bits.ps.find((p) => p.text.includes('委托方：'));
      expect(client, '委托方行应在').toBeDefined();
      expect(client!.h, '委托方行应有高度').toBeGreaterThan(0);
      const period = bits.ps.find((p) => p.text.includes('周期：'));
      expect(period, '周期行应在').toBeDefined();
      expect(period!.h, '周期行应有高度').toBeGreaterThan(0);
      expect(bits.dateH, '打印日期应有高度').toBeGreaterThan(0);
      const text = (await page.textContent('body')) ?? '';
      expect(text, '委托方（admin 视角）').toContain('委托方：客户甲');
      expect(text, '打印日期').toContain('打印日期 2026-10-09 07:30');
    } finally {
      await page.close();
    }
  });

  it('P7 月历打印页：骨架（真实类名）+ 源码锁——screen flex 不变 + print 可见', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      // 源码锁：豁免规则依赖的 DOM 契约（flex 布局 + .a4-page 容器）不漂移
      const calSrc = readFileSync(resolve(ROOT, 'src/pages/CalendarPrintPage.tsx'), 'utf-8');
      expect(calSrc, '月历公文头应是 flex 布局（豁免还原 flex 的依据）').toContain(
        '<header className="flex items-start justify-between border-b border-line pb-2">',
      );
      expect(calSrc, '月历纸面容器应是 .a4-page（global 豁免的命中路径）').toContain(
        'className="a4-page mx-auto mb-6 flex flex-col"',
      );
      await page.setContent(shell(CALENDAR_SKELETON, css));
      const headSel = '.a4-page header';
      await page.emulateMedia({ media: 'screen' });
      expect(await page.$eval(headSel, (el) => getComputedStyle(el).display), 'screen 态应为 flex').toBe('flex');
      await page.emulateMedia({ media: 'print' });
      expect(await page.$eval(headSel, (el) => getComputedStyle(el).display), 'print 态应可见').toBe('flex');
      const box = await page.$eval(headSel, (el) => el.getBoundingClientRect().height);
      expect(box, 'print 态公文头应有布局盒').toBeGreaterThan(0);
      const text = (await page.textContent('body')) ?? '';
      expect(text, '项目名上纸').toContain('云栖·湖畔茶室综合改造项目');
      expect(text, '周期上纸').toContain('周期：2026-01-01 – 2026-03-01');
    } finally {
      await page.close();
    }
  });

  it('P8 行程打印页：骨架（真实类名）+ 源码锁——screen block 不变 + print 还原 block', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      // 源码锁：行程抬头无 flex 类（block 布局）+ 是 .print-root 直接子元素
      const itiSrc = readFileSync(resolve(ROOT, 'src/pages/ItineraryPrintPage.tsx'), 'utf-8');
      expect(itiSrc, '行程抬头无 flex 类（block 布局——豁免还原 block 的依据）').toContain(
        '<header className="mb-5 border-b border-line pb-4">',
      );
      expect(itiSrc, '行程纸面根是 .print-root（.print-root > header 的命中路径）').toContain(
        'className="print-root mx-auto max-w-4xl bg-paper p-8"',
      );
      await page.setContent(shell(ITINERARY_SKELETON, css));
      const headSel = '.print-root > header';
      await page.emulateMedia({ media: 'screen' });
      expect(await page.$eval(headSel, (el) => getComputedStyle(el).display), 'screen 态应为 block').toBe('block');
      await page.emulateMedia({ media: 'print' });
      expect(await page.$eval(headSel, (el) => getComputedStyle(el).display), 'print 态应还原 block').toBe('block');
      const box = await page.$eval(headSel, (el) => el.getBoundingClientRect().height);
      expect(box, 'print 态抬头应有布局盒').toBeGreaterThan(0);
      const text = (await page.textContent('body')) ?? '';
      expect(text, '项目名上纸').toContain('云南七日·亲子团');
      expect(text, '行程周期上纸').toContain('行程周期：2026-10-01 — 2026-10-03');
      // 抬头内 h1 与 p 仍纵排（block 还原没被 flex 化）
      const stack = await page.$eval(headSel, (el) => {
        const h1 = el.querySelector('h1')!.getBoundingClientRect();
        const p = el.querySelector('p')!.getBoundingClientRect();
        return { h1Bottom: h1.bottom, pTop: p.top };
      });
      expect(stack.pTop, '周期行应在项目名下方（纵排）').toBeGreaterThanOrEqual(stack.h1Bottom - 1);
    } finally {
      await page.close();
    }
  });
});
