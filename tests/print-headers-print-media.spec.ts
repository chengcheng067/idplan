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
 * 四套模板 CSS 各自 @media print 块加页头豁免（两类选择器 + !important ⇒
 * 特异性高者胜，与同块内「纸面背景压过 global」同一手法）：
 *   A .swiss-topbar / D .de-head / E .ei-head / H .ap-head ⇒ display:flex
 *   H .ap-status__group-head ⇒ display:block（h3 组题 + p 组注**纵排**，
 *     不能跟 blanket-flex 否则并排压坏 P2 双栏——按元素显式还原的理由）
 * screen 态零变化；应用级 header（.print-root 外）print 态仍 none
 * （global 规则的本职保留）。
 *
 * ── 本文件锁什么 ──
 *   P1 四版页头 print 态可见（display 非 none + 有布局盒）；
 *   P2 A 黑顶栏 print 态背景色 computed 仍在（print-color-adjust 链路未破）；
 *   P3 H 分组头 print 态 block 且组题/组注仍纵排（没被 flex 化）；
 *   P4 screen 态四版页头不变（豁免只作用于 print 媒体）；
 *   P5 应用级 header print 态仍 none（裸规则本职：TopBar 不进打印件）。
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
});
