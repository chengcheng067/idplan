/**
 * D 版 A4 视觉验收（批 2：真构建产物 + 真 Chromium 实测，不真打黑白打印机）。
 *
 * ── 为什么这样做验收 ──
 * 产品决策文档批 2 要求「D 彩色 4 + 灰度 4（依赖图重点看环、缺失引用、
 * 20+ 任务）」，02 §9 要求「794×1123 预览截图…无裁切」。灰度走「纸面套
 * filter:grayscale(1)」——与预览面板「灰度」toggle 同一机制（决策文档
 * §3.2-②），不必也不该真打一台黑白打印机。
 *
 * ── 方法（与 print-a4-visual.spec.ts 同范式）──
 * ① 用**真实组件**（DataEditorialDocument）+ **真实 VM 装配**
 *    （buildPrintViewModel）经 renderToStaticMarkup 出静态纸面；
 * ② 外挂 **真实构建产物**的 CSS（build-dist/assets/*.css——D 版样式与亮色
 *    锁都在里面），保证测的是打包后的规则而不是源码顺序；
 * ③ 真 Chromium 逐页截图，并断言每页 794×1123 **无裁切**（盒子超高即红）。
 *
 * 夹具刻意覆盖批 2 点名的三个依赖图风险面：22 个任务（20+）、一个三节点
 * 环、两条缺失引用（一条指向隐藏阶段任务——VM 层就会被过滤掉，一条指向
 * 不存在的 id），另有单链与菱形各一组。
 *
 * 前置：`npm run build --outDir build-dist`（产物在 build-dist/）与本机
 * chromium；缺任一则整组 skip（与 print-a4-visual.spec.ts 同口径）。
 *
 * 产物落点：`outputs/print-a4-shots/`（工作区交付目录，不进 git）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';

import { DataEditorialDocument } from '../src/print/documents/DataEditorialDocument';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageLogType,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage, StageLog, Task } from '../src/core/types/entities';
import { createElement } from 'react';

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

/** 拼接全部构建产物 CSS（D 版样式 + 亮色锁 + 主题令牌都在里面） */
function builtCss(): string {
  const assets = join(ROOT, 'build-dist', 'assets');
  return readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assets, f), 'utf-8'))
    .join('\n');
}

/* ------------------------------------------------------------------ 夹具（真实形状） */

const TODAY = '2026-10-09';
const PROJECT_ID = 'proj_d4';

const PROJECT: Project = {
  id: PROJECT_ID,
  name: '云栖·湖畔茶室综合改造项目',
  address: '城区某路 1 号',
  clientName: '客户甲',
  contractAmount: 880000,
  signedAt: '2026-01-01T00:00:00Z',
  plannedStartAt: '2026-01-01T00:00:00Z',
  plannedEndAt: '2026-03-01T23:59:59Z',
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  domain: null,
  kind: 'human',
  ownerMemberId: null,
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const HUMAN: Member = {
  id: 'm-d4-human',
  name: '负责人甲',
  role: '项目负责人',
  contact: null,
  avatarColor: '#3D6B5B',
  active: true,
  roleKind: MemberRoleKind.Admin,
  passwordHash: null,
  actorKind: MemberActorKind.Human,
  agentKind: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const AGENT: Member = {
  id: 'm-d4-agent',
  name: '小 Agent',
  role: '自动执行体',
  contact: null,
  avatarColor: '#3D6B5B',
  active: true,
  roleKind: MemberRoleKind.Member,
  passwordHash: null,
  actorKind: MemberActorKind.Agent,
  agentKind: 'brand-new-harness-9000',
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

/** 9 个可见阶段（四态齐全 + 一个延期重点状态）+ 1 个隐藏阶段（依赖缺失引用用） */
const STAGES: Stage[] = Array.from({ length: 9 }, (_, i) => {
  const n = i + 1;
  return {
    id: `stg_d4_${n}`,
    projectId: PROJECT_ID,
    orderIndex: n,
    templateKey: null,
    colorIndex: ((n - 1) % 9) + 1,
    customColor: null,
    name: `阶段${n}·${n % 2 === 0 ? '方案深化' : '现场勘查'}`,
    // 9 × 11 = 99：刻意让合计 ≠ 100%，验收「不静默归一化」的缺口与口径警告
    ratioPercent: 11,
    startAt: '2026-01-05T00:00:00Z',
    endAt: '2026-01-20T23:59:59Z',
    status:
      n === 3
        ? StageStatus.Delayed
        : n % 3 === 0
          ? StageStatus.Completed
          : n % 3 === 1
            ? StageStatus.InProgress
            : StageStatus.NotStarted,
    ownerId: n === 3 ? AGENT.id : HUMAN.id,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
});
STAGES.push({
  id: 'stg_d4_hidden',
  projectId: PROJECT_ID,
  orderIndex: 10,
  templateKey: null,
  colorIndex: 9,
  customColor: null,
  name: '隐藏阶段',
  ratioPercent: 1,
  startAt: '2026-02-01T00:00:00Z',
  endAt: '2026-02-20T23:59:59Z',
  status: StageStatus.NotStarted,
  ownerId: HUMAN.id,
  // 隐藏阶段：它的任务不进任何角色的 VM ⇒ 指向它的依赖变成「引用不可用」
  visible: false,
  resourcePath: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
});

const TASK_STATUSES = [
  TaskStatus.Draft,
  TaskStatus.Ready,
  TaskStatus.Claimed,
  TaskStatus.InProgress,
  TaskStatus.Blocked,
  TaskStatus.Review,
  TaskStatus.Done,
];

/** 22 个任务（20+）：单链 + 菱形 + 三节点环 + 两条缺失引用 + 其余独立 */
function taskDependsOn(n: number): string[] {
  switch (n) {
    case 1:
      // 缺失引用 ×2：隐藏阶段任务（VM 层过滤掉）+ 不存在的 id
      return ['tsk_d4_hidden', 'tsk_d4_ghost'];
    case 2:
      return ['tsk_d4_1'];
    case 3:
      return ['tsk_d4_2'];
    case 4:
      return ['tsk_d4_3'];
    case 5:
      return ['tsk_d4_hidden'];
    case 6:
      return ['tsk_d4_5'];
    case 7:
      return ['tsk_d4_5'];
    case 8:
      return ['tsk_d4_6', 'tsk_d4_7'];
    case 11:
      return ['tsk_d4_13'];
    case 12:
      return ['tsk_d4_11'];
    case 13:
      return ['tsk_d4_12'];
    default:
      return [];
  }
}

const TASKS: Task[] = Array.from({ length: 22 }, (_, i) => {
  const n = i + 1;
  return {
    id: `tsk_d4_${n}`,
    taskNo: 1000 + n,
    projectId: PROJECT_ID,
    stageId: STAGES[(n - 1) % 9]!.id,
    title: `任务${n}·${n % 3 === 0 ? '整理测绘图与材料清单并同步给施工方确认' : '现场复核尺寸'}`,
    done: false,
    assigneeId: HUMAN.id,
    assigneeIds: n % 2 === 0 ? [HUMAN.id, AGENT.id] : [HUMAN.id],
    dueDate: n === 4 ? '2026-10-01' : n === 5 ? '2026-12-20' : null,
    source: 'human',
    externalId: null,
    agentId: n % 4 === 0 ? AGENT.id : null,
    status: TASK_STATUSES[n % TASK_STATUSES.length]!,
    description: null,
    dependsOn: taskDependsOn(n),
    artifacts:
      n % 3 === 0
        ? [
            { id: `art_d4_${n}_1`, kind: 'doc', title: '会议纪要', path: null, url: null, note: null },
            { id: `art_d4_${n}_2`, kind: 'file', title: '测绘图', path: null, url: null, note: null },
          ]
        : [],
    startAt: null,
    claimedAt: null,
    runId: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
});
// 隐藏阶段下的任务：任何角色都不可见，只作为缺失引用的目标存在
TASKS.push({
  id: 'tsk_d4_hidden',
  taskNo: 1023,
  projectId: PROJECT_ID,
  stageId: 'stg_d4_hidden',
  title: '隐藏阶段任务',
  done: false,
  assigneeId: HUMAN.id,
  assigneeIds: [HUMAN.id],
  dueDate: null,
  source: 'human',
  externalId: null,
  agentId: null,
  status: TaskStatus.Ready,
  description: null,
  dependsOn: [],
  artifacts: [],
  startAt: null,
  claimedAt: null,
  runId: null,
  orderIndex: 1,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
});

const LOGS: StageLog[] = [
  {
    id: 'log_d4_1',
    stageId: 'stg_d4_3',
    projectId: PROJECT_ID,
    type: StageLogType.Rescheduled,
    fromStatus: null,
    toStatus: null,
    oldStartAt: null,
    newStartAt: null,
    oldEndAt: '2026-01-18T23:59:59Z',
    newEndAt: '2026-01-25T23:59:59Z',
    reason: '等客户确认主材样品，延期 7 天',
    operatorName: '负责人甲',
    createdAt: '2026-01-19T02:00:00Z',
  },
];

function buildVm(): ReturnType<typeof buildPrintViewModel> {
  return buildPrintViewModel({
    project: PROJECT,
    stages: STAGES,
    tasks: TASKS,
    members: [HUMAN, AGENT],
    stageLogs: LOGS,
    role: MemberRoleKind.Admin,
    currentMemberId: HUMAN.id,
    todayIso: TODAY,
    now: new Date('2026-10-09T07:30:00Z'),
  });
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

/* ------------------------------------------------------------------ 验收 */

describe.skipIf(!CAN_RUN)('D 版 A4 视觉验收 · 批 2（真 Chromium + 真实构建 CSS）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('D 版默认态：4 原生 + 3 通用 = 7 页，彩色 7 张 + 灰度 7 张；794×1123 无裁切（期三）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['data-editorial'].baseline;
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const gray of [false, true]) {
        const htmlPath = writeHtml(
          gray ? 'd-default-gray.html' : 'd-default-color.html',
          shell(markup, css, gray),
        );
        await page.goto('file://' + htmlPath);
        const pages = await page.$$('.a4-page');
        expect(pages, 'D 版应渲染 7 页（期三：+3 通用页）').toHaveLength(7);
        for (let i = 0; i < pages.length; i++) {
          const el = pages[i]!;
          const box = await el.boundingBox();
          const tag = gray ? 'gray' : 'color';
          expect(box, `第 ${i + 1} 页应有布局盒`).not.toBeNull();
          // 794×1123 无裁切：盒宽必须精确 794；盒高超过 1123 = 内容溢出（裁切/孤儿页脚风险）
          expect(Math.abs(box!.width - 794), `第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
          expect(box!.height, `第 ${i + 1} 页高应恰 1123（溢出即红）`).toBeLessThanOrEqual(1124);
          expect(box!.height, `第 ${i + 1} 页高不得低于 1123`).toBeGreaterThanOrEqual(1122);
          await el.screenshot({ path: join(OUT_DIR, `density3-d-p${i + 1}-${tag}.png`) });
        }
      }
    } finally {
      await page.close();
    }
  });

  it('D 版矩阵日期列不溢出：列宽 ≥ 最长日期串 + 2×padding（0006 缺陷修复锁）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['data-editorial'].baseline;
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('d-default-color.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const p1 = await page.$('[data-print-page="progress-matrix"]');
      expect(p1, 'P1 阶段进度矩阵页应在').not.toBeNull();

      // 每个日期单元格：文字 Range 宽 + 左右 padding ≤ 单元格宽（nowrap 不溢进进度列）。
      // 字体无关（实测当前等宽回活的渲染宽度），比硬编码 px 常量更防回潮。
      const overflows = await p1!.$$eval('.de-matrix__date', (tds) => {
        const bad: string[] = [];
        for (const td of tds) {
          const range = document.createRange();
          range.selectNodeContents(td);
          const textW = range.getBoundingClientRect().width;
          const style = getComputedStyle(td);
          const padX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
          const cellW = td.getBoundingClientRect().width;
          if (textW + padX > cellW + 0.5) {
            bad.push(`「${td.textContent}」文字 ${textW.toFixed(1)} + padding ${padX} > 列宽 ${cellW.toFixed(1)}`);
          }
        }
        return bad;
      });
      expect(overflows, '日期列溢出（会被进度列不透明底遮成截断+残字）').toEqual([]);
      // 前提自检：确实量到了日期单元格（防选择器漂移后空过）
      const dateCount = await p1!.$$eval('.de-matrix__date', (els) => els.length);
      expect(dateCount, '应读到 10 个可见阶段行的日期单元格').toBe(10);

      // 列宽配比落定：date 24% / progress 25% / stage 20%（总宽 714px）
      const colW = await p1!.$$eval('.de-matrix thead th', (ths) =>
        ths.map((th) => +th.getBoundingClientRect().width.toFixed(1)),
      );
      expect(colW[2], '日期列宽应 ≥ 最坏等宽回落（23 字符 × 0.6em + 16px padding = 167.8）').toBeGreaterThanOrEqual(
        167.8,
      );
      // 长阶段名不与日期列相撞：阶段名在自家列内省略（不越列）
      const nameCollision = await p1!.$$eval('.de-matrix__name', (names) =>
        names.filter((n) => {
          const td = n.closest('td')!;
          return n.getBoundingClientRect().right > td.getBoundingClientRect().right + 0.5;
        }).length,
      );
      expect(nameCollision, '阶段名不得越出阶段列（截断在列内）').toBe(0);
    } finally {
      await page.close();
    }
  });

  it('D 版 P2 依赖网络：环、缺失引用、20+ 任务全部上纸（DOM 断言）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['data-editorial'].baseline;
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('d-default-color.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const p2 = await page.$('[data-print-page="dependency-network"]');
      expect(p2, 'P2 依赖网络页应在').not.toBeNull();

      // 20+ 任务节点（SVG g.de-gnode）
      const nodeCount = await p2!.$$eval('.de-gnode', (els) => els.length);
      expect(nodeCount, '22 个可见任务节点（隐藏阶段任务不进 VM）').toBe(22);

      // 边全部绘出（含循环边的虚线）
      const edgeCount = await p2!.$$eval('.de-graph__edge', (els) => els.length);
      expect(edgeCount, '可见任务间的依赖边（单链 3 + 菱形 4 + 环 3 + 缺失不建边）').toBe(10);
      const cycleEdges = await p2!.$$eval('.de-graph__edge[data-cycle]', (els) => els.length);
      expect(cycleEdges, '三节点环 ⇒ 恰好 1 条回边标记为异常').toBe(1);

      // 两类警示：引用不可用（3 条：2 隐藏 + 1 不存在… 见夹具 t1×2 / t5×1）与循环依赖
      const p2Text = (await p2!.textContent()) ?? '';
      expect(p2Text).toContain('引用不可用');
      expect(p2Text).toContain('循环依赖');
      expect(p2Text).toMatch(/3 条依赖指向/);
      expect(p2Text).toMatch(/1 条边构成环/);
      // 权限纪律：纸面上不出现隐藏阶段任务的 id / 标题
      expect(p2Text).not.toContain('tsk_d4_hidden');
      expect(p2Text).not.toContain('tsk_d4_ghost');
      expect(p2Text).not.toContain('隐藏阶段任务');

      // 异常节点后缀在 SVG 文本里（·!N / ·环），不靠颜色单独表意
      const svgText = await p2!.$eval('.de-graph', (el) => el.textContent ?? '');
      expect(svgText).toContain('·!2');
      expect(svgText).toContain('·环');
    } finally {
      await page.close();
    }
  });

  it('D 版默认态：套预设变体（靛蓝）彩色 7 张；信号槽位确实挂上（非默认态重截）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const preset = PRINT_TEMPLATE_PALETTES['data-editorial'].presets.find((p) => p.id === 'indigo')!;
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, { vm, palette: preset.palette }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('d-preset-indigo.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const pages = await page.$$('.a4-page');
      expect(pages).toHaveLength(7);
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(Math.abs(box!.width - 794)).toBeLessThanOrEqual(1);
        expect(box!.height).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({ path: join(OUT_DIR, `d-preset-p${i + 1}-color.png`) });
      }
      // 预设真的挂上了：页头信号方块取靛蓝 #3B5BDB（不是默认橙红）
      const bg = await page.$eval('.de-head__signal', (el) => getComputedStyle(el).backgroundColor);
      expect(bg, '靛蓝预设的信号色应为 #3B5BDB').toBe('rgb(59, 91, 219)');
      // 纸面仍是纯白（paper 不开槽位，D 的身份）
      const paper = await page.$eval('.a4-page', (el) => getComputedStyle(el).backgroundColor);
      expect(paper).toBe('rgb(255, 255, 255)');
    } finally {
      await page.close();
    }
  });

  it('D 版口径断言：占比不等于完成度 + 合计 ≠100% 不归一化（P3 DOM）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['data-editorial'].baseline;
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('d-default-color.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const p3 = await page.$('[data-print-page="workload-composition"]');
      expect(p3, 'P3 工作量构成页应在').not.toBeNull();
      const text = (await p3!.textContent()) ?? '';
      // 01 §5 明文的防误读主声明
      expect(text).toContain('占比不等于完成度');
      // 合计 99%（9×11）：口径警告 + 未分配缺口，不静默归一化
      expect(text).toContain('口径警告');
      expect(text).toMatch(/合计为 99%/);
      expect(text).toContain('未做归一化处理');
      // 堆叠条 9 段 + 1 个未分配缺口（真实值占轨）
      const segs = await p3!.$$eval('.de-stack__seg', (els) => els.length);
      expect(segs, '9 个可见阶段各一段').toBe(9);
      const gaps = await p3!.$$eval('.de-stack__gap', (els) => els.length);
      expect(gaps, '合计 99% ⇒ 1 个未分配缺口').toBe(1);
      // 延期阶段段走信号色（重点状态）
      const delayedSeg = await p3!.$$eval('.de-stack__seg[data-delayed]', (els) => els.length);
      expect(delayedSeg, '1 个延期阶段').toBe(1);

      // 段下标号行字号 ≥9.5px（accent 文字下限，密度研究 §4 约束 3：延期
      // 段下标走信号色；原 8.5px 的登记项已清，整行同字号）
      const tickFs = await p3!.$eval('.de-stack__ticks', (el) => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(tickFs, '段下标号行字号应 ≥9.5px（accent 文字下限）').toBeGreaterThanOrEqual(9.5);
      // 延期 tick 确实是信号色（约束 3 管的就是这类文字）
      const tickColor = await p3!.$eval('.de-stack__tick[data-delayed]', (el) => getComputedStyle(el).color);
      expect(tickColor, '延期段下标应为信号橙红 #EF4B23').toBe('rgb(239, 75, 35)');
    } finally {
      await page.close();
    }
  });
});
