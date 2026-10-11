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

/**
 * `#RRGGBB` → `rgb(r, g, b)`（与 getComputedStyle 的返回格式一致）。
 * 用途：断言「元素取的是 palette 里那枚色」而不把色值抄第二遍——
 * palette 是单一真值源，抄一遍色值 = 造第二真值源（P0-17 判据里的
 * 「accent = #E2522B」由 print-palette 侧的 spec 负责钉死）。
 */
function hexRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
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

  it('H 版默认态：3 原生签名纸面，彩色 3 张 + 灰度 3 张；794×1123 无裁切（她 10-09 23:38 反馈：默认收敛到签名页，通用 M1/M2/M4 不进默认态）', async () => {
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
        expect(pages, 'H 版应渲染 3 页（默认 = 原生签名页；M10 落两页 + 写回一页）').toHaveLength(3);
        for (let i = 0; i < pages.length; i++) {
          const el = pages[i]!;
          const box = await el.boundingBox();
          expect(box, `第 ${i + 1} 页应有布局盒`).not.toBeNull();
          expect(Math.abs(box!.width - 794), `第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
          expect(box!.height, `第 ${i + 1} 页高应恰 1123（溢出即红）`).toBeLessThanOrEqual(1124);
          expect(box!.height, `第 ${i + 1} 页高不得低于 1123`).toBeGreaterThanOrEqual(1122);
          await el.screenshot({ path: join(OUT_DIR, `density2-h-p${i + 1}-${gray ? 'gray' : 'color'}.png`) });
        }
      }
    } finally {
      await page.close();
    }
  });

  it('H 版自身密度修订锁定：状态卡 36px / card-key 9.5px / 块题下距 12px / 摘要下距 20px', async () => {
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

      // ① L2 状态卡 42→36px（padding 8→5；进密度规则 26-36px/行区间）
      const cardH = await page.$eval('.ap-status__card', (el) => el.getBoundingClientRect().height);
      expect(cardH, '状态卡高应为 36px（L2 区间上界）').toBeCloseTo(36, 0);
      const cardPad = await page.$eval('.ap-status__card', (el) => getComputedStyle(el).padding);
      expect(cardPad, '状态卡上下 padding 应为 5px').toBe('5px 11px');

      // ② card-key 9→9.5px（gate 态随卡变 accent ⇒ 密度 §4 约束 3 下限）
      const keyFs = await page.$eval('.ap-status__card-key', (el) => getComputedStyle(el).fontSize);
      expect(keyFs, '状态卡 key 字号应 ≥9.5px（accent 文字下限）').toBe('9.5px');

      // ③ P1 块题 → 字段行界面 8→12px（L1↔L2）
      const blockTitleMb = await page.$eval('.ap-declare__block-title', (el) => getComputedStyle(el).marginBottom);
      expect(blockTitleMb, '宣告块题下距应为 12px').toBe('12px');

      // ④ P2 巨号摘要 → 状态卡界面 14→20px（L0↔L2）
      const summaryPb = await page.$eval('.ap-status__summary', (el) => getComputedStyle(el).paddingBottom);
      expect(summaryPb, '摘要带下距应为 20px').toBe('20px');

      // 焦点纪律不断：running 仍是全页唯一实心黑卡
      const runningBg = await page.$eval('[data-testid="ap-status-card-running"]', (el) =>
        getComputedStyle(el).backgroundColor,
      );
      expect(runningBg, 'running 卡仍为近黑实心 #0A0A0A（焦点身份不断）').toBe('rgb(10, 10, 10)');
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
      // 三页照常出纸（页头页脚齐全）：原生三页主体是只读空态
      // （默认 = 原生签名页；通用 M1/M2/M4 可手动勾选，不进默认态）
      const pages = await page.$$('.a4-page');
      expect(pages).toHaveLength(3);
      const empties = await page.$$('[data-print-empty="agent"]');
      expect(empties.length, '三个原生页整版只读空态').toBe(3);
      const text = (await page.textContent('body')) ?? '';
      expect(text).toContain('当前项目暂无 Agent 执行数据');
      // 不许拿模拟记录填版：空态下没有任何状态卡 / 巨字 / 流程盒
      // （期七深化起 H×M2 双栏卡用 .gm-task-* 自有类名，与原生卡零碰撞）
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
      // 页顶巨字载荷 = 品牌词（规格 §1.4：与状态解绑）——不再是状态词 RUNNING
      const topWord = await p1!.$eval('.ap-giant__word', (el) => el.textContent);
      expect(topWord, '页顶巨字 = 品牌词 PLAN（规格 §1.4，不再是焦点状态词）').toBe('PLAN');
      // 状态表达归页内焦点行（§1.4 表格末行）——状态没丢，只是换了装置
      const focusRow = await p1!.$eval('.ap-declare__focus', (el) => el.textContent ?? '');
      expect(focusRow, '当前主状态归页内焦点行陈述').toContain('当前主状态');
      expect(p1Text, '状态仍在页内（执行状态字段行）').toContain('running');
      expect(p1Text).toContain('run_h4_001');
      expect(p1Text).toContain('第 2 次');
      for (const field of WRITEBACK_WRITABLE_FIELDS) {
        expect(p1Text, `P1 白名单应含 ${field}`).toContain(field);
      }
      expect(p1Text).toContain('其余字段只读');
      // 白名单恰好四项（ol 四行，不多不少）
      const wlCount = await p1!.$$eval('.ap-whitelist__item', (els) => els.length);
      expect(wlCount, '写回白名单仅四项').toBe(4);
      // 巨字颜色 = 身份色 accent（参考稿页顶 AGENT 为橙；品牌装置不随状态变，
      // 故不再有「running ⇒ 近黑」的分支）。期望值取自 palette，单一真值源。
      const giantColor = await p1!.$eval('.ap-giant__word', (el) => getComputedStyle(el).color);
      expect(giantColor, '页顶巨字 = accent（品牌装置，不随状态变）').toBe(hexRgb(baseline.accent));
      expect(giantColor, '巨字不应再是墨色近黑').not.toBe('rgb(10, 10, 10)');

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

  it('H 版预设变体（朱红）彩色 3 张；状态槽位确实挂上（非默认态重截，期三）', async () => {
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

  /**
   * B1/B3 · 页级出血巨字（规格 §1.1 B1/B3 + §1.4 载荷拍板 + P0-18）。
   *
   * ── 数值权威：参考原稿 PNG 的像素复核（本次实测，非转述）──
   * 原稿 1588×2246 ⇒ ×0.5 折算回 794×1123 CSS px：
   *   页顶巨字  墨迹左缘 x=18、顶缘 y=11、底缘 y=137
   *   页底巨字  墨迹左缘 x=24、顶缘 y=1023.5、底缘 y=1113
   *   纸底 #DEDDD4（85.7% 面积）、橙 #E2522B（10.7% 面积）
   *
   * ── 两个口径一起断（这是本 spec 的关键设计）──
   * 原稿两块巨字的**墨迹都没有真的被切**（第 0 行与末行均无墨）——所谓
   * 「被页顶/页底裁切」的本体是**行盒**越出纸缘：.ap-giant__word 的 top < 0、
   * .ap-footword__word 的 bottom > 1123；墨迹停在离纸缘约 11px 处，视觉即出血。
   * 故分两层断言：装置（.ap-giant / .ap-footword）贴纸缘；行盒越出纸缘。
   * 规格 §1.1 B1 / P0-18 写的「从 x=0 起 / left ≤ 0」指**装置**（x=0 成立）；
   * 墨迹左缘 18px 是原稿实测值（附录速查表）——两者不矛盾，别把装置当文字盒。
   *
   * ── 载荷纪律（§1.4 规则 1-6）──
   * 页顶 = 品牌词（默认 PLAN，可自定义、恒大写、超长截断）；页底 = 固定 IDPLAN，
   * **不随自定义变**（规则 5）。
   */
  it('B1/B3 · 页级出血巨字：页顶 = 品牌词 / 页底 = 固定 IDPLAN（真 Chromium 几何自证 + 截图）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['agent-poster'].baseline;
    const dir = join(OUT_DIR, 'h-giant-2026-10-11');
    mkdirSync(dir, { recursive: true });

    /** 量一张纸上两块巨字（坐标relative 纸面左上角，CSS px） */
    const measure = (el: Element) => {
      const pg = el.getBoundingClientRect();
      const box = (sel: string) => {
        const t = el.querySelector(sel) as HTMLElement | null;
        if (!t) return null;
        const r = t.getBoundingClientRect();
        const s = getComputedStyle(t);
        return {
          top: +(r.top - pg.top).toFixed(2),
          left: +(r.left - pg.left).toFixed(2),
          right: +(r.right - pg.left).toFixed(2),
          bottom: +(r.bottom - pg.top).toFixed(2),
          text: (t.textContent ?? '').trim(),
          tt: s.textTransform,
          color: s.color,
          fs: s.fontSize,
          tier: (t.closest('[data-tier]') as HTMLElement | null)?.dataset.tier ?? null,
        };
      };
      return {
        page: { w: +pg.width.toFixed(2), h: +pg.height.toFixed(2) },
        giant: box('.ap-giant'),
        word: box('.ap-giant__word'),
        foot: box('.ap-footword'),
        footWord: box('.ap-footword__word'),
      };
    };

    /** 载入一版纸面（同一 page 复用，只换 HTML） */
    const open = async (file: string, markup: string): Promise<void> => {
      await page.goto('file://' + writeHtml(file, shell(markup, css, false)));
    };

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      // ── ① 默认品牌词（不传 brandWord ⇒ 回落 PLAN）──
      await open(
        'h-giant-default.html',
        renderToStaticMarkup(createElement(AgentPosterDocument, { vm, palette: baseline })),
      );
      const p1 = (await page.$('[data-print-page="agent-declaration"]'))!;
      const m = await p1.evaluate(measure);

      // 装置贴纸缘：出血的「画布」就是整张纸
      expect(m.giant!.top, '巨字装置贴纸顶').toBeLessThanOrEqual(1);
      expect(m.giant!.left, '巨字装置从纸面 x=0 起（越出 44px 内容框）').toBeLessThanOrEqual(0);
      expect(m.giant!.right, '巨字装置满宽（右缘贴纸缘）').toBeGreaterThanOrEqual(790);
      // 行盒越出纸顶 ⇒ 被纸缘裁切（P0-18 的 DOM 判据）
      expect(m.word!.top, '巨字行盒须越出纸顶（出血）').toBeLessThan(0);
      // 墨迹级贴边：行盒左缘 = 墨迹左缘 18px − 该字号左侧边距 ⇒ 必落在 [0, 20)
      expect(m.word!.left, '巨字应贴纸左缘（墨迹左缘 ≈18px，原稿实测）').toBeGreaterThanOrEqual(0);
      expect(m.word!.left, '巨字不得被推进内容框（44px）').toBeLessThan(20);
      expect(m.word!.text, '页顶巨字载荷 = 默认品牌词 PLAN（§1.4 规则 1）').toBe('PLAN');
      expect(m.word!.tt, '巨字恒大写（§1.4 规则 4）').toBe('uppercase');
      expect(m.word!.color, '页顶巨字取身份色 accent').toBe(hexRgb(baseline.accent));

      // 页底：装置贴纸底、行盒越出纸底（被裁），词固定
      expect(m.foot!.bottom, '页底巨字装置贴纸底').toBeGreaterThanOrEqual(1120);
      expect(m.footWord!.bottom, '页底巨字行盒须越出纸底（出血）').toBeGreaterThan(1123);
      expect(m.footWord!.text, '页底巨字 = 固定品牌装置 IDPLAN').toBe('IDPLAN');
      expect(m.footWord!.tt).toBe('uppercase');
      expect(m.footWord!.color, '页底巨字同为身份色').toBe(hexRgb(baseline.accent));

      await p1.screenshot({ path: join(dir, 'h-p1-after.png') });

      // 页顶巨字只在 P1（页锚点装置原址）；页底是纸级品牌装置，三页同构
      const p2 = (await page.$('[data-print-page="execution-status"]'))!;
      expect(await p2.$('.ap-giant__word'), '页顶巨字只出在 P1').toBeNull();
      expect(await p2.$('.ap-footword__word'), '页底品牌装置三页同构').not.toBeNull();

      // ── ② 自定义品牌词：页顶跟着变，页底**不跟着变**（§1.4 规则 5）──
      await open(
        'h-giant-custom.html',
        renderToStaticMarkup(
          createElement(AgentPosterDocument, { vm, palette: baseline, brandWord: '云栖茶室' }),
        ),
      );
      const p1b = (await page.$('[data-print-page="agent-declaration"]'))!;
      const m2 = await p1b.evaluate(measure);
      expect(m2.word!.text, '页顶巨字 = 自定义品牌词').toBe('云栖茶室');
      expect(m2.word!.top, '换词后仍出血').toBeLessThan(0);
      expect(m2.word!.right, '4 个汉字仍须在纸宽内').toBeLessThanOrEqual(794);
      expect(m2.footWord!.text, '页底 IDPLAN 不随自定义变（§1.4 规则 5）').toBe('IDPLAN');
      await p1b.screenshot({ path: join(dir, 'h-p1-custom.png') });

      // ── ③ 超上限长词：渲染口再截断一次 + 降档后仍不撑破纸面（规则 3/6）──
      await open(
        'h-giant-long.html',
        renderToStaticMarkup(
          createElement(AgentPosterDocument, {
            vm,
            palette: baseline,
            brandWord: '云栖·湖畔茶室综合改造项目A', // 14 字符 > 上限 12
          }),
        ),
      );
      const p1c = (await page.$('[data-print-page="agent-declaration"]'))!;
      const m3 = await p1c.evaluate(measure);
      expect(m3.word!.text, '超上限词在渲染口被截断到 12 字符').toBe('云栖·湖畔茶室综合改造项');
      expect(m3.word!.tier, '长词降到地板档 sm').toBe('sm');
      expect(m3.word!.right, '地板档仍须在纸宽内').toBeLessThanOrEqual(794);
      await p1c.screenshot({ path: join(dir, 'h-p1-long.png') });

      console.log(
        `[H 巨字实测] 默认 left=${m.word!.left} right=${m.word!.right} fs=${m.word!.fs}` +
          `(${m.word!.tier}) 越顶=${m.word!.top}｜页底 left=${m.footWord!.left}` +
          ` right=${m.footWord!.right} 越底=${m.footWord!.bottom}｜` +
          `自定义 right=${m2.word!.right}(${m2.word!.tier})｜长词 right=${m3.word!.right}(${m3.word!.tier})`,
      );
    } finally {
      await page.close();
    }
  });
});
