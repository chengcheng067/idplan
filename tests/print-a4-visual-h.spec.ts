/**
 * H 版 A4 视觉验收（批 4：真构建产物 + 真 Chromium 实测，不真打黑白打印机）。
 *
 * ── 为什么这样做验收 ──
 * 产品决策文档批 4 要求「H 彩色 3 + 灰度 3（重点看空态、confidence 标注、
 * 中轴不穿说明文字）」。灰度走「纸面套 filter:grayscale(1)」——与预览面板
 * 「灰度」toggle 同一机制（决策文档 §3.2-②）。
 *
 * ── 方法（与 print-a4-visual{-d,-e}.spec.ts 同范式）──
 * ① 真实组件（AgentPosterDocument）+ 真实 VM 装配（buildPrintViewModel，
 *    executions / proposals 经适配器入 VM）；② 外挂真实构建产物 CSS；
 * ③ 真 Chromium 逐页截图 + 794×1123 无裁切断言。
 *
 * 夹具覆盖批 4 点名的面：七态执行（running 主焦点）、四态提案（含
 * confidence 值）、**非 Agent 项目整版空态**、中轴几何（只贯穿栏区）、
 * 口径文案（仅供参考 / 白名单四项 / 其余字段只读）。
 *
 * 前置：`npm run build --outDir build-dist` 与本机 chromium；缺任一整组 skip。
 *
 * 产物落点：`outputs/print-a4-shots/`（工作区交付目录，不进 git）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';

import { AgentPosterDocument } from '../src/print/documents/AgentPosterDocument';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import { WRITEBACK_WRITABLE_FIELDS } from '../src/core/types/agent-execution';
import type { WritebackProposalStatus } from '../src/core/types/agent-execution';
import type { Execution, WritebackProposal } from '../src/core/types/agent-execution';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage, Task } from '../src/core/types/entities';
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

function builtCss(): string {
  const assets = join(ROOT, 'build-dist', 'assets');
  return readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assets, f), 'utf-8'))
    .join('\n');
}

/* ------------------------------------------------------------------ 夹具（真实形状） */

const TODAY = '2026-10-09';
const PROJECT_ID = 'proj_h4';

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
  kind: 'agent',
  ownerMemberId: null,
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const HUMAN: Member = {
  id: 'm-h4-human',
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
  id: 'm-h4-agent',
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

const STAGES: Stage[] = [
  {
    id: 'stg_h4_1',
    projectId: PROJECT_ID,
    orderIndex: 1,
    templateKey: null,
    colorIndex: 1,
    customColor: null,
    name: '现场勘查',
    ratioPercent: 40,
    startAt: '2026-01-05T00:00:00Z',
    endAt: '2026-01-20T23:59:59Z',
    status: StageStatus.InProgress,
    ownerId: AGENT.id,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'stg_h4_2',
    projectId: PROJECT_ID,
    orderIndex: 2,
    templateKey: null,
    colorIndex: 2,
    customColor: null,
    name: '方案深化',
    ratioPercent: 60,
    startAt: '2026-01-21T00:00:00Z',
    endAt: '2026-02-20T23:59:59Z',
    status: StageStatus.NotStarted,
    ownerId: HUMAN.id,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const TASKS: Task[] = [
  {
    id: 'tsk_h4_1',
    taskNo: 1042,
    projectId: PROJECT_ID,
    stageId: 'stg_h4_1',
    title: '整理测绘图与材料清单并同步给施工方确认',
    done: false,
    assigneeId: AGENT.id,
    assigneeIds: [AGENT.id],
    dueDate: null,
    source: 'agent',
    externalId: null,
    agentId: AGENT.id,
    status: TaskStatus.InProgress,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    runId: 'run_h4_001',
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'tsk_h4_2',
    taskNo: 1043,
    projectId: PROJECT_ID,
    stageId: 'stg_h4_2',
    title: '输出深化方案文档',
    done: false,
    assigneeId: AGENT.id,
    assigneeIds: [AGENT.id],
    dueDate: null,
    source: 'agent',
    externalId: null,
    agentId: AGENT.id,
    status: TaskStatus.Ready,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    runId: 'run_h4_002',
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

/** 七态执行（覆盖四组中的七态；running = 主焦点） */
const EXECUTIONS: Execution[] = [
  {
    id: 'exec_h4_running',
    projectId: PROJECT_ID,
    taskId: 'tsk_h4_1',
    source: 'project-task',
    objective: '整理测绘图与材料清单并同步给施工方确认',
    agentMemberId: AGENT.id,
    channelKind: 'loopback',
    inputSnapshotHash: null,
    status: 'running',
    confirmation: null,
    idempotencyKey: 'exec:project-task:proj_h4:1',
    currentAttemptNo: 2,
    createdAt: '2026-10-08T01:00:00Z',
    updatedAt: '2026-10-08T02:00:00Z',
    startedAt: '2026-10-08T01:30:00Z',
    finishedAt: null,
    terminalReason: null,
    blockedReason: null,
  },
  {
    id: 'exec_h4_attention',
    projectId: PROJECT_ID,
    taskId: 'tsk_h4_1',
    source: 'natural-language',
    objective: '补充主材样品清单',
    agentMemberId: AGENT.id,
    channelKind: null,
    inputSnapshotHash: null,
    status: 'needs_attention',
    confirmation: null,
    idempotencyKey: 'exec:natural-language:proj_h4:2',
    currentAttemptNo: 1,
    createdAt: '2026-10-07T01:00:00Z',
    updatedAt: '2026-10-07T03:00:00Z',
    startedAt: '2026-10-07T01:10:00Z',
    finishedAt: null,
    terminalReason: null,
    blockedReason: '缺输入：客户主材样品未确认',
  },
  {
    id: 'exec_h4_review',
    projectId: PROJECT_ID,
    taskId: 'tsk_h4_2',
    source: 'project-task',
    objective: '输出深化方案文档',
    agentMemberId: AGENT.id,
    channelKind: null,
    inputSnapshotHash: null,
    status: 'awaiting_review',
    confirmation: null,
    idempotencyKey: 'exec:project-task:proj_h4:3',
    currentAttemptNo: 1,
    createdAt: '2026-10-06T01:00:00Z',
    updatedAt: '2026-10-06T05:00:00Z',
    startedAt: '2026-10-06T01:10:00Z',
    finishedAt: '2026-10-06T04:00:00Z',
    terminalReason: null,
    blockedReason: null,
  },
  {
    id: 'exec_h4_draft',
    projectId: PROJECT_ID,
    taskId: null,
    source: 'external',
    objective: '外部接入的批量整理',
    agentMemberId: null,
    channelKind: 'http',
    inputSnapshotHash: null,
    status: 'draft',
    confirmation: null,
    idempotencyKey: 'exec:external:proj_h4:4',
    currentAttemptNo: 0,
    createdAt: '2026-10-05T01:00:00Z',
    updatedAt: '2026-10-05T01:00:00Z',
    startedAt: null,
    finishedAt: null,
    terminalReason: null,
    blockedReason: null,
  },
  {
    id: 'exec_h4_queued',
    projectId: PROJECT_ID,
    taskId: 'tsk_h4_2',
    source: 'template',
    objective: '模板触发的图档整理',
    agentMemberId: AGENT.id,
    channelKind: null,
    inputSnapshotHash: null,
    status: 'queued',
    confirmation: null,
    idempotencyKey: 'exec:template:proj_h4:5',
    currentAttemptNo: 0,
    createdAt: '2026-10-05T02:00:00Z',
    updatedAt: '2026-10-05T02:00:00Z',
    startedAt: null,
    finishedAt: null,
    terminalReason: null,
    blockedReason: null,
  },
  {
    id: 'exec_h4_done',
    projectId: PROJECT_ID,
    taskId: 'tsk_h4_1',
    source: 'project-task',
    objective: '首批测绘图归档',
    agentMemberId: AGENT.id,
    channelKind: null,
    inputSnapshotHash: null,
    status: 'completed',
    confirmation: null,
    idempotencyKey: 'exec:project-task:proj_h4:6',
    currentAttemptNo: 1,
    createdAt: '2026-10-04T01:00:00Z',
    updatedAt: '2026-10-04T06:00:00Z',
    startedAt: '2026-10-04T01:10:00Z',
    finishedAt: '2026-10-04T05:00:00Z',
    terminalReason: null,
    blockedReason: null,
  },
  {
    id: 'exec_h4_failed',
    projectId: PROJECT_ID,
    taskId: null,
    source: 'external',
    objective: '外部通道同步（失败）',
    agentMemberId: AGENT.id,
    channelKind: 'http',
    inputSnapshotHash: null,
    status: 'failed',
    confirmation: null,
    idempotencyKey: 'exec:external:proj_h4:7',
    currentAttemptNo: 3,
    createdAt: '2026-10-03T01:00:00Z',
    updatedAt: '2026-10-03T04:00:00Z',
    startedAt: '2026-10-03T01:10:00Z',
    finishedAt: '2026-10-03T03:30:00Z',
    terminalReason: '通道超时',
    blockedReason: null,
  },
];

/** 四态提案（含 confidence 值；Proposed / Conflict = 治理焦点） */
function makeProposal(
  n: number,
  status: WritebackProposalStatus,
  field: string,
  confidence: number | null,
  decided: { by: string; at: string } | null,
): WritebackProposal {
  return {
    id: `wb_h4_${n}`,
    executionId: n <= 2 ? 'exec_h4_running' : 'exec_h4_review',
    attemptId: null,
    projectId: PROJECT_ID,
    taskId: n <= 2 ? 'tsk_h4_1' : 'tsk_h4_2',
    operations: [{ field, before: 'ready', after: 'in_progress' }],
    status,
    idempotencyKey: `wb:exec_h4:tsk_h4:${field}`,
    reason: n === 1 ? '测绘图已归档，状态可推进' : null,
    confidence,
    decidedBy: decided?.by ?? null,
    decidedAt: decided?.at ?? null,
    createdAt: `2026-10-0${n}T02:00:00Z`,
    updatedAt: `2026-10-0${n}T02:00:00Z`,
  };
}

const PROPOSALS: WritebackProposal[] = [
  makeProposal(1, 'proposed', 'task.status', 0.82, null),
  makeProposal(2, 'applied', 'task.notes.append', 0.91, { by: '负责人甲', at: '2026-10-01T06:00:00Z' }),
  makeProposal(3, 'rejected', 'task.comment', 0.4, { by: '负责人甲', at: '2026-10-02T06:00:00Z' }),
  makeProposal(4, 'conflict', 'task.attachment.ref', 0.66, null),
];

function buildVm(withAgentData = true): ReturnType<typeof buildPrintViewModel> {
  return buildPrintViewModel({
    project: PROJECT,
    stages: STAGES,
    tasks: TASKS,
    members: [HUMAN, AGENT],
    stageLogs: [],
    executions: withAgentData ? EXECUTIONS : [],
    proposals: withAgentData ? PROPOSALS : [],
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

describe.skipIf(!CAN_RUN)('H 版 A4 视觉验收 · 批 4（真 Chromium + 真实构建 CSS）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('H 版三页：默认态彩色 3 张 + 灰度 3 张；794×1123 无裁切', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['agent-poster'].baseline;
    const markup = renderToStaticMarkup(
      createElement(AgentPosterDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const gray of [false, true]) {
        const htmlPath = writeHtml(
          gray ? 'h-default-gray.html' : 'h-default-color.html',
          shell(markup, css, gray),
        );
        await page.goto('file://' + htmlPath);
        const pages = await page.$$('.a4-page');
        expect(pages, 'H 版应渲染 3 页').toHaveLength(3);
        for (let i = 0; i < pages.length; i++) {
          const el = pages[i]!;
          const box = await el.boundingBox();
          expect(box, `第 ${i + 1} 页应有布局盒`).not.toBeNull();
          expect(Math.abs(box!.width - 794), `第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
          expect(box!.height, `第 ${i + 1} 页高应恰 1123（溢出即红）`).toBeLessThanOrEqual(1124);
          expect(box!.height, `第 ${i + 1} 页高不得低于 1123`).toBeGreaterThanOrEqual(1122);
          await el.screenshot({ path: join(OUT_DIR, `density-h-p${i + 1}-${gray ? 'gray' : 'color'}.png`) });
        }
      }
    } finally {
      await page.close();
    }
  });

  it('H 版空态：非 Agent 项目 ⇒ 整版只读空态（无巨字 / 无状态卡 / 不填模拟记录）', async () => {
    const css = builtCss();
    const vm = buildVm(false);
    const baseline = PRINT_TEMPLATE_PALETTES['agent-poster'].baseline;
    const markup = renderToStaticMarkup(
      createElement(AgentPosterDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('h-empty.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      // 三页照常出纸（页头页脚齐全），主体全是同一条只读空态
      const pages = await page.$$('.a4-page');
      expect(pages).toHaveLength(3);
      const empties = await page.$$('[data-print-empty="agent"]');
      expect(empties.length, '三页整版只读空态').toBe(3);
      const text = (await page.textContent('body')) ?? '';
      expect(text).toContain('当前项目暂无 Agent 执行数据');
      // 不许拿模拟记录填版：空态下没有任何状态卡 / 巨字 / 流程盒
      expect(await page.$('.ap-giant')).toBeNull();
      expect(await page.$('.ap-status__card')).toBeNull();
      expect(await page.$('.ap-flow-box')).toBeNull();
      // 页头页脚仍在（每页可独立解释，01 §2）
      expect(text).toContain('Agent 执行宣告');
      expect(text).toContain('执行状态全览');
      expect(text).toContain('写回提案公示');
      // 空态页也不溢出
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(box!.height).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({ path: join(OUT_DIR, `h-empty-p${i + 1}-color.png`) });
      }
    } finally {
      await page.close();
    }
  });

  it('H 版中轴几何：轴只贯穿双栏栏区，不穿下方说明文字；门控标题不压状态卡', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['agent-poster'].baseline;
    const markup = renderToStaticMarkup(
      createElement(AgentPosterDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('h-default-color.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const p2 = await page.$('[data-print-page="execution-status"]');
      expect(p2, 'P2 执行状态全览页应在').not.toBeNull();

      // ① 轴是双栏容器的 ::before（02 §6：禁绝对定位贯穿整页）
      const axis = await p2!.$eval('.ap-status__cols', (el) => {
        const s = getComputedStyle(el, '::before');
        const r = el.getBoundingClientRect();
        return {
          position: s.position,
          width: s.width,
          top: s.top,
          bottom: s.bottom,
          // Chromium 把 left:50% 解析成 used value（px，相对容器内宽）⇒ 轴左缘 = 容器半宽
          leftPx: parseFloat(s.left),
          halfWidth: r.width / 2,
        };
      });
      expect(axis.position, '轴必须是容器伪元素（absolute 相对栏区容器）').toBe('absolute');
      expect(axis.width).toBe('1px');
      expect(axis.top, '轴顶端 = 栏区顶端').toBe('0px');
      expect(axis.bottom, '轴底端 = 栏区底端（贯穿栏区）').toBe('0px');
      expect(axis.leftPx, '轴左缘居中于双栏容器（left:50%）').toBeCloseTo(axis.halfWidth, 0);

      // ② 几何断言：栏区容器整体在说明文字**上方**⇒ 轴（inset-block:0）穿不到说明
      const geom = await p2!.evaluate((el) => {
        const cols = el.querySelector('.ap-status__cols') as HTMLElement;
        const note = el.querySelector('.ap-status__note') as HTMLElement;
        const c = cols.getBoundingClientRect();
        const n = note.getBoundingClientRect();
        return { colsBottom: c.bottom, noteTop: n.top, colsTop: c.top };
      });
      expect(
        geom.colsBottom,
        '栏区底边必须在说明文字顶边之上（中轴不穿说明文字，01 §7）',
      ).toBeLessThanOrEqual(geom.noteTop + 1);

      // ③ 人工门控标题不压状态卡：组头底边 ≤ 首卡顶边
      const gateGeom = await p2!.evaluate((el) => {
        const head = el.querySelector('[data-group="gate"] .ap-status__group-head') as HTMLElement;
        const card = el.querySelector('[data-group="gate"] .ap-status__card') as HTMLElement;
        return {
          headBottom: head.getBoundingClientRect().bottom,
          cardTop: card.getBoundingClientRect().top,
        };
      });
      expect(
        gateGeom.headBottom,
        '人工门控组头不得压住状态卡（01 §7 P2）',
      ).toBeLessThanOrEqual(gateGeom.cardTop + 1);
    } finally {
      await page.close();
    }
  });

  it('H 版口径断言：10 态四组 / running 主焦点 / confidence 仅供参考 / 白名单四项', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['agent-poster'].baseline;
    const markup = renderToStaticMarkup(
      createElement(AgentPosterDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('h-default-color.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);

      // ① P2：十态四组流程 + running 主焦点（实心黑卡）
      const p2 = await page.$('[data-print-page="execution-status"]');
      const p2Text = (await p2!.textContent()) ?? '';
      for (const status of [
        'draft',
        'awaiting_confirmation',
        'queued',
        'running',
        'paused',
        'needs_attention',
        'awaiting_review',
        'completed',
        'failed',
        'cancelled',
      ]) {
        expect(p2Text, `P2 应含十态之 ${status}`).toContain(status);
      }
      for (const group of ['准备', '执行', '人工门控', '终局']) {
        expect(p2Text, `P2 应含四组之「${group}」`).toContain(group);
      }
      // running 卡 = 实心黑（当前主焦点）；计数 1（夹具一条 running）
      const runningCard = await p2!.$eval('[data-testid="ap-status-card-running"]', (el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, focus: el.hasAttribute('data-focus'), count: el.textContent ?? '' };
      });
      expect(runningCard.focus, 'running 为主焦点卡').toBe(true);
      expect(runningCard.bg, 'running 卡应为近黑实心 #0A0A0A').toBe('rgb(10, 10, 10)');
      expect(runningCard.count).toContain('1');
      // needs_attention 卡 = 橙边橙字（等待人工介入）
      const gateCard = await p2!.$eval('[data-testid="ap-status-card-needs_attention"]', (el) => {
        const s = getComputedStyle(el);
        return { border: s.borderTopColor, color: s.color };
      });
      expect(gateCard.border, '人工门控卡应为橙边 #E8590C').toBe('rgb(232, 89, 12)');

      // ② P1：confidence 仅展示 + 旁标「仅供参考」；白名单四项 + 其余字段只读
      const p1 = await page.$('[data-print-page="agent-declaration"]');
      const p1Text = (await p1!.textContent()) ?? '';
      expect(p1Text, 'confidence 旁标「仅供参考」').toContain('仅供参考');
      expect(p1Text, '巨字 = 焦点执行状态 RUNNING').toContain('RUNNING');
      expect(p1Text).toContain('run_h4_001');
      expect(p1Text).toContain('第 2 次');
      for (const field of WRITEBACK_WRITABLE_FIELDS) {
        expect(p1Text, `P1 白名单应含 ${field}`).toContain(field);
      }
      expect(p1Text).toContain('其余字段只读');
      // 白名单恰好四项（ol 四行，不多不少）
      const wlCount = await p1!.$$eval('.ap-whitelist__item', (els) => els.length);
      expect(wlCount, '写回白名单仅四项').toBe(4);
      // 巨字颜色 = 近黑（running = 系统推进/当前主状态，非橙）
      const giantColor = await p1!.$eval('.ap-giant__word', (el) => getComputedStyle(el).color);
      expect(giantColor, 'running 巨字应为近黑（当前主状态）').toBe('rgb(10, 10, 10)');

      // ③ P3：五态 + confidence 列 + 白名单 + 只读注 + 提案四行
      const p3 = await page.$('[data-print-page="writeback-proposals"]');
      const p3Text = (await p3!.textContent()) ?? '';
      for (const status of ['draft', 'proposed', 'applied', 'rejected', 'conflict']) {
        expect(p3Text, `P3 应含五态之 ${status}`).toContain(status);
      }
      expect(p3Text).toContain('人工门控流程');
      expect(p3Text).toContain('其余字段只读');
      for (const field of WRITEBACK_WRITABLE_FIELDS) {
        expect(p3Text, `P3 白名单应含 ${field}`).toContain(field);
      }
      const proposalRows = await p3!.$$eval('.ap-wb-table tbody tr', (els) => els.length);
      expect(proposalRows, '四条提案全部上纸').toBe(4);
      // confidence 值 + 「仅供参考」旁标在清单里
      expect(p3Text).toContain('82%');
      expect(p3Text).toContain('（仅供参考）');
      // 提案表字段列出现白名单字段名（task.status 等）
      expect(p3Text).toContain('task.status');
      expect(p3Text).toContain('task.attachment.ref');
    } finally {
      await page.close();
    }
  });

  it('H 版预设变体（朱红）彩色 3 张；状态槽位确实挂上（非默认态重截）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const preset = PRINT_TEMPLATE_PALETTES['agent-poster'].presets.find((p) => p.id === 'vermilion')!;
    const markup = renderToStaticMarkup(
      createElement(AgentPosterDocument, { vm, palette: preset.palette }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('h-preset-vermilion.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const pages = await page.$$('.a4-page');
      expect(pages).toHaveLength(3);
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(Math.abs(box!.width - 794)).toBeLessThanOrEqual(1);
        expect(box!.height).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({ path: join(OUT_DIR, `h-preset-p${i + 1}-color.png`) });
      }
      // 预设真的挂上了：人工门控卡描边取朱红 #C8102E（不是默认橙）
      const border = await page.$eval('[data-testid="ap-status-card-needs_attention"]', (el) =>
        getComputedStyle(el).borderTopColor,
      );
      expect(border, '朱红预设的状态色应为 #C8102E').toBe('rgb(200, 16, 46)');
      // 纸面仍是灰白底（paper 不开槽位，H 的身份）
      const paper = await page.$eval('.a4-page', (el) => getComputedStyle(el).backgroundColor);
      expect(paper).toBe('rgb(245, 245, 245)');
    } finally {
      await page.close();
    }
  });
});
