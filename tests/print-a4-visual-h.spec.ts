/**
 * H 版 A4 视觉验收（人类化后：阶段 / 任务 / 成员海报）。
 *
 * ── 这个 spec 是什么 ──
 * **H 唯一的真浏览器回归网**（真实构建 CSS + 真 Chromium + 794×1123 逐页几何）。
 * 人类化批次（规格 §1.2.2~§1.2.4）把载荷从 Agent 治理公示换成人类项目内容，
 * 版式构件一个没删 ⇒ 验收判据整体**重挂到人类三页**（规格 §1.3.3：改断言，
 * 不删测试）。本文件锁四件事：
 *   ① 逐页 794×1123 **无裁切**（页高 / 主体 scrollHeight 双口径）
 *   ② 版式台账（构件一个不少）：中轴 2px accent / 栏头 3px 规则线 /
 *      实底标签 ≥9.5px 且带文字与字形 / 标签错落 / 居中摘要大号 mono（不借巨字）
 *   ③ 人类口径（分组名、meta 行、口径行、图例态数、脚注）+ **Agent 载荷已下纸**
 *   ④ 分页压测（24 阶段 / 30 任务）逐页无裁切 + 续页不出巨字出「（续）」
 * 加上 A1/A2 的纸色与巨字几何自证（P0-17 / P0-18 / P0-23 的继任判据）。
 *
 * ── 为什么逐页要断两遍「无裁切」──
 * `.a4-page` 是 1123 的 flex 列，`.ap-body` 是 `flex: 1; min-height: 0` 的弹性项：
 * 内容比可用高度高时**不会把纸撑高**（撑高会被页高断言抓到），而是溢出到
 * 弹性项之外被 `overflow: hidden` 剪掉 —— 页高断言因此对「主体内部溢出」是瞎的。
 * 第二道用 `.ap-body` 的 `scrollHeight ≤ clientHeight`（主体里的内容全在里面），
 * 这才是「无裁切」的真判据。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';

import { AgentPosterDocument } from '../src/print/documents/AgentPosterDocument';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { formatTaskNo } from '../src/core/lib/task-no';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
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

function builtCss(): string {
  return readBuiltCss(ROOT);
}

/**
 * `#RRGGBB` → `rgb(r, g, b)`（与 getComputedStyle 的返回格式一致）。
 * 用途：断言「元素取的是 palette 里那枚色」而不把色值抄第二遍——
 * palette 是单一真值源，抄一遍色值 = 造第二真值源。
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

function makeStage(
  n: number,
  status: StageStatus,
  name: string,
  ownerId: string | null = null,
): Stage {
  return {
    id: `stg_h4_${n}`,
    projectId: PROJECT_ID,
    orderIndex: n,
    templateKey: null,
    colorIndex: (n % 6) + 1,
    customColor: null,
    name,
    ratioPercent: 20,
    startAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00Z`,
    endAt: `2026-02-${String(n).padStart(2, '0')}T23:59:59Z`,
    status,
    ownerId,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/**
 * 常态夹具：3 阶段、**两栏都有块**——待推进栏 2 块（延期 + 未开始，错落可验）、
 * 在推进栏 1 块。一页装得下（原生容量 7 块/栏）。
 */
const STAGES: Stage[] = [
  makeStage(1, StageStatus.InProgress, '现场勘查', AGENT.id),
  makeStage(2, StageStatus.Delayed, '方案深化', null),
  makeStage(3, StageStatus.NotStarted, '施工图交付', null),
];

function makeTask(
  n: number,
  taskNo: number,
  title: string,
  status: TaskStatus,
  dueDate: string | null,
  artifactCount = 0,
): Task {
  return {
    id: `tsk_h4_${n}`,
    projectId: PROJECT_ID,
    stageId: 'stg_h4_1',
    taskNo,
    title,
    status,
    assigneeIds: [HUMAN.id],
    dueDate,
    dependsOn: [],
    // 产出物走真实字段（`Task.artifacts[]`），投影层的 `artifactCount` 由它派生——
    // 夹具里直接写 `artifactCount` 会绕过适配器（第一版就是这么写错的）。
    artifacts: Array.from({ length: artifactCount }, (_, i) => ({
      id: `art_h4_${n}_${i}`,
      kind: 'doc' as const,
      title: `产出物 ${i + 1}`,
      path: null,
      url: null,
      note: null,
    })),
    source: 'manual',
    runId: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const TASKS: Task[] = [
  makeTask(1, 1042, '首轮测绘图归档', TaskStatus.InProgress, '2026-01-18', 1),
  makeTask(2, 1043, '结构复核（外部）', TaskStatus.Blocked, '2026-01-10'),
];

/**
 * 项目里**确实存在 Agent 数据**（执行单 + 写回提案）——人类化后纸面一个字都不许
 * 再出现它们（这正是「有 Agent 数据也不再上纸」的回归判据）。
 */
const EXECUTIONS = [
  {
    id: 'exec_h4_running',
    projectId: PROJECT_ID,
    taskId: 'tsk_h4_1',
    source: 'project-task',
    objective: '首批测绘图归档',
    agentMemberId: AGENT.id,
    channelKind: null,
    inputSnapshotHash: null,
    status: 'running',
    confirmation: null,
    idempotencyKey: 'exec:project-task:proj_h4:1',
    currentAttemptNo: 2,
    createdAt: '2026-10-06T01:00:00Z',
    updatedAt: '2026-10-06T05:00:00Z',
    startedAt: '2026-10-06T01:10:00Z',
    finishedAt: null,
    terminalReason: null,
    blockedReason: null,
  },
] as unknown as Execution[];

const PROPOSALS = [
  {
    id: 'wb_h4_1',
    executionId: 'exec_h4_running',
    attemptId: null,
    projectId: PROJECT_ID,
    taskId: 'tsk_h4_1',
    operations: [{ field: 'task.status', before: 'ready', after: 'in_progress' }],
    status: 'proposed',
    idempotencyKey: 'wb:exec_h4:tsk_h4:status',
    reason: '测绘图已归档，状态可推进',
    confidence: 0.82,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-10-06T02:00:00Z',
    updatedAt: '2026-10-06T02:00:00Z',
  },
] as unknown as WritebackProposal[];

/**
 * 压测夹具：24 阶段（**两栏都压满**：待推进 8 = 4 延期 + 4 未开始；在推进 16 =
 * 8 进行中 + 8 已完成）⇒ 首屏 7 + 7 = 14 块正好满页，其余进续页；
 * 30 任务（> 原生容量 12 ⇒ 任务海报回落通用渲染，规格 §1.2.3）。
 */
const MANY_STAGES: Stage[] = [
  ...Array.from({ length: 4 }, (_, i) => makeStage(i + 1, StageStatus.Delayed, `延期阶段 ${i + 1}`)),
  ...Array.from({ length: 4 }, (_, i) => makeStage(i + 5, StageStatus.NotStarted, `未开始阶段 ${i + 1}`)),
  ...Array.from({ length: 8 }, (_, i) => makeStage(i + 9, StageStatus.InProgress, `在推阶段 ${i + 1}`)),
  ...Array.from({ length: 8 }, (_, i) => makeStage(i + 17, StageStatus.Completed, `已完成阶段 ${i + 1}`)),
];

const MANY_TASKS: Task[] = [
  ...Array.from({ length: 10 }, (_, i) => makeTask(100 + i, 2000 + i, `在轨任务 ${i + 1}`, TaskStatus.InProgress, null)),
  ...Array.from({ length: 8 }, (_, i) => makeTask(200 + i, 3000 + i, `已完成任务 ${i + 1}`, TaskStatus.Done, null)),
  ...Array.from({ length: 7 }, (_, i) => makeTask(300 + i, 4000 + i, `受阻任务 ${i + 1}`, TaskStatus.Blocked, '2026-01-05')),
  ...Array.from({ length: 5 }, (_, i) => makeTask(400 + i, 5000 + i, `就绪任务 ${i + 1}`, TaskStatus.Ready, null)),
];

function buildVm(over: Partial<Parameters<typeof buildPrintViewModel>[0]> = {}): ReturnType<typeof buildPrintViewModel> {
  return buildPrintViewModel({
    project: PROJECT,
    stages: STAGES,
    tasks: TASKS,
    members: [HUMAN, AGENT],
    stageLogs: [],
    executions: EXECUTIONS,
    proposals: PROPOSALS,
    role: MemberRoleKind.Admin,
    currentMemberId: HUMAN.id,
    todayIso: TODAY,
    now: new Date('2026-10-09T07:30:00Z'),
    ...over,
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

const BASELINE = PRINT_TEMPLATE_PALETTES['agent-poster'].baseline;

function markupOf(vm: ReturnType<typeof buildPrintViewModel>, brandWord?: string): string {
  return renderToStaticMarkup(
    createElement(AgentPosterDocument, { vm, palette: BASELINE, ...(brandWord ? { brandWord } : {}) }),
  );
}

/** 逐页几何：页高 + 主体内部溢出（「无裁切」的两道判据） */
async function pageGeometry(page: import('playwright-core').Page) {
  return page.$$eval('.a4-page', (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const body = el.querySelector('.ap-body') as HTMLElement | null;
      return {
        page: el.getAttribute('data-print-page'),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
        bodyOverflow: body ? +(body.scrollHeight - body.clientHeight).toFixed(1) : null,
      };
    }),
  );
}

/* ------------------------------------------------------------------ 验收 */

describe.skipIf(!CAN_RUN)('H 版 A4 视觉验收 · 人类化后（真 Chromium + 真实构建 CSS）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('① 默认态：三页人类海报（阶段 / 任务 / 成员），彩色 3 张 + 灰度 3 张；逐页 794×1123 无裁切', async () => {
    const css = builtCss();
    const vm = buildVm();
    const markup = markupOf(vm);

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const gray of [false, true]) {
        const htmlPath = writeHtml(gray ? 'h-hum-gray.html' : 'h-hum-color.html', shell(markup, css, gray));
        await page.goto('file://' + htmlPath);
        const geo = await pageGeometry(page);
        expect(geo.map((g) => g.page), 'H 默认纸面 = 人类三页（M1 → M2 → M4）').toEqual([
          'stage-overview',
          'task-register',
          'member-roster',
        ]);
        for (const g of geo) {
          expect(Math.abs(g.w - 794), `${g.page} 页宽应 794`).toBeLessThanOrEqual(1);
          expect(g.h, `${g.page} 页高应恰 1123（溢出即红）`).toBeLessThanOrEqual(1124);
          expect(g.h, `${g.page} 页高不得低于 1123`).toBeGreaterThanOrEqual(1122);
          expect(g.bodyOverflow, `${g.page} 主体内容不得超出可用高度（内部溢出 = 被 overflow 剪掉）`).toBeLessThanOrEqual(1);
        }
        const els = await page.$$('.a4-page');
        for (let i = 0; i < els.length; i++) {
          await els[i]!.screenshot({
            path: join(OUT_DIR, `h-hum-p${i + 1}-${gray ? 'gray' : 'color'}.png`),
          });
        }
      }
    } finally {
      await page.close();
    }
  });

  it('② 版式台账：中轴 2px accent 只贯穿栏区 / 栏头 3px 规则线 / 实底标签 ≥9.5px 带字带字形 / 标签错落 / 居中摘要大号 mono', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('h-hum-color.html', shell(markupOf(vm), css, false)));

      // ── ① 中轴：容器伪元素、2px、accent、只贯穿栏区（不穿下方说明文字）──
      const axis = await page.$eval('[data-print-page="stage-overview"]', (el) => {
        const cols = el.querySelector('.ap-cols') as HTMLElement;
        const notes = el.querySelector('.ap-notes') as HTMLElement;
        const s = getComputedStyle(cols, '::before');
        const c = cols.getBoundingClientRect();
        return {
          position: s.position,
          width: s.width,
          bg: s.backgroundColor,
          leftPx: parseFloat(s.left),
          halfWidth: c.width / 2,
          colsBottom: c.bottom,
          notesTop: notes.getBoundingClientRect().top,
        };
      });
      expect(axis.position, '轴必须是双栏容器的伪元素（禁绝对定位贯穿整页，02 §6）').toBe('absolute');
      expect(axis.width, '参考稿实测轴宽 2px').toBe('2px');
      expect(axis.bg, '轴取身份色 accent').toBe(hexRgb(BASELINE.accent));
      expect(axis.leftPx, '轴居中于双栏容器').toBeCloseTo(axis.halfWidth - 1, 0);
      expect(axis.colsBottom, '栏区底边须在说明文字之上（轴穿不到说明文字，01 §7）').toBeLessThanOrEqual(
        axis.notesTop + 1,
      );

      // ── ② 栏头：3px 分组规则线走 accent（gate 组）/ ink（其余），**不许中灰** ──
      const rules = await page.$$eval('.ap-col__rule', (els) =>
        els.map((e) => {
          const s = getComputedStyle(e);
          return { h: s.height, bg: s.backgroundColor, tone: (e.closest('.ap-col') as HTMLElement).dataset.tone };
        }),
      );
      expect(rules.length, '三页都应有栏头规则线').toBeGreaterThan(0);
      for (const r of rules) {
        expect(r.h, '分组线 3px（参考稿实测 y404.5..407）').toBe('3px');
        expect(r.bg, `分组线不许中灰（tone=${r.tone}）`).not.toBe('rgb(191, 191, 191)');
      }
      expect(rules.some((r) => r.bg === hexRgb(BASELINE.accent) && r.tone === 'gate'), 'gate 组线走 accent').toBe(true);
      expect(rules.some((r) => r.bg === 'rgb(10, 10, 10)' && r.tone === 'ink'), 'ink 组线走墨').toBe(true);

      // ── ③ 实底状态标签：实底 + 文字 + 字形；字号 ≥9.5px（accent 文字下限）──
      const tags = await page.$$eval('.ap-block__tag', (els) =>
        els.map((e) => {
          const s = getComputedStyle(e);
          return {
            bg: s.backgroundColor,
            color: s.color,
            fs: parseFloat(s.fontSize),
            text: (e.textContent ?? '').trim(),
            glyph: (e.querySelector('.ap-block__glyph')?.textContent ?? '').trim(),
          };
        }),
      );
      expect(tags.length, '标签数 = 上纸的块数').toBeGreaterThan(0);
      for (const t of tags) {
        expect(t.bg, '标签必须是**实底**（不是描边卡；P0-20）').not.toBe('rgba(0, 0, 0, 0)');
        expect(t.text.length, '标签内必须有文字（宪法 4：灰度下不靠色相）').toBeGreaterThan(0);
        expect(t.glyph.length, '标签带形状互异的字形（第二重编码）').toBeGreaterThan(0);
        expect(t.fs, '标签字号 ≥9.5px（PRINT_DENSITY_FLOORS.accentFontSizeMin）').toBeGreaterThanOrEqual(9.5);
      }
      const gateTag = tags.find((t) => t.bg === hexRgb(BASELINE.accent));
      expect(gateTag, '存在 accent 实底（需人工介入）的标签').toBeTruthy();
      // 实底标签的文字色按对比度取高者：墨配橙 5.20:1（白配橙只有 3.81:1，不过 4.5）
      expect(gateTag!.color, 'accent 实底上取墨字（对比度 5.20:1 > 白字 3.81:1）').toBe('rgb(10, 10, 10)');

      // ── ④ 标签错落（参考稿 1001 左 / 1002 右 / 1003 左）：同栏相邻块标签左缘不全相等 ──
      const stagger = await page.$eval('[data-print-page="stage-overview"] .ap-col__rows', (rows) =>
        Array.from(rows.querySelectorAll('.ap-block__tag')).map(
          (e) => +(e as HTMLElement).getBoundingClientRect().left.toFixed(1),
        ),
      );
      expect(new Set(stagger).size, '相邻块标签须错落（否则退化成一列整齐的表格）').toBeGreaterThan(1);

      // ── ⑤ 居中摘要：大号 mono（**不借巨字**——借了每页都是海报）──
      const sum = await page.$eval('[data-print-page="stage-overview"] .ap-sum', (el) => {
        const big = el.querySelector('.ap-sum__big') as HTMLElement;
        const s = getComputedStyle(big);
        return {
          textAlign: getComputedStyle(el).textAlign,
          fs: parseFloat(s.fontSize),
          family: s.fontFamily,
          inGiant: big.closest('.ap-giant') !== null,
        };
      });
      expect(sum.textAlign, '居中摘要块须居中').toBe('center');
      expect(sum.fs, '主数值大号（≈40px 档）').toBeGreaterThanOrEqual(30);
      expect(sum.family.toLowerCase(), '主数值走等宽').toContain('mono');
      expect(sum.inGiant, '摘要**不许借巨字装置**（syntax.ts:80-81）').toBe(false);
    } finally {
      await page.close();
    }
  });

  it('③ 人类口径：分组名 / meta 行 / 口径行字段 / 图例态数按真实数据 / 两行脚注；**Agent 载荷已下纸**', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('h-hum-color.html', shell(markupOf(vm), css, false)));
      const text = (await page.textContent('body')) ?? '';

      // ── ① 三页页题与页签：`ID PLAN · {英文页题}` / `SHEET nn / NN · A4` ──
      expect(text).toContain('ID PLAN · STAGE POSTER');
      expect(text).toContain('ID PLAN · TASK POSTER');
      expect(text).toContain('ID PLAN · MEMBER POSTER');
      expect(text).toContain('SHEET 01 / 03 · A4');
      expect(text).toContain('SHEET 03 / 03 · A4');

      // ── ② meta 行（项目名从页眉移到巨字下方；参考稿 y≈242 那位）──
      const p1 = (await page.$('[data-print-page="stage-overview"]'))!;
      const p1Text = (await p1.textContent()) ?? '';
      expect(p1Text, 'meta 行 = 项目名 + 阶段计数').toContain('云栖·湖畔茶室综合改造项目');
      expect(p1Text).toContain('阶段 3  已完成 0  延期 1');

      // ── ③ 分组名（状态表达归双栏栏头，规格 §1.4 表格末行）──
      expect(p1Text).toContain('待推进');
      expect(p1Text).toContain('PENDING');
      expect(p1Text).toContain('在推进');
      expect(p1Text).toContain('RUNNING');
      // 块载荷 = 阶段号 + 状态标签 + 一行 meta（日期 / 占比 / 负责人）
      expect(p1Text).toContain('阶段 01');
      expect(p1Text).toContain('进行中');
      expect(p1Text).toContain('2026-01-01 → 2026-02-01 · 占比 20% · 小 Agent');
      expect(p1Text, '未指派的阶段如实写「未指派」').toContain('未指派');

      // ── ④ 口径行（一行 mono 平铺；标签末二字橙）──
      for (const f of ['Stage.status', 'Stage.ratioPercent', 'Stage.ownerId', 'StageLog.reason']) {
        expect(p1Text, `口径行应含 ${f}`).toContain(f);
      }
      const tail = await p1.$eval('.ap-scope__tail', (el) => ({
        text: (el.textContent ?? '').trim(),
        color: getComputedStyle(el).color,
      }));
      expect(tail.text).toBe('口径');
      expect(tail.color, '标签末二字着色 accent（参考稿「白名单」二字橙的同位替换）').toBe(hexRgb(BASELINE.accent));

      // ── ⑤ 图例：态数按**真实数据**算（不许写死）──
      const legend = await p1.$eval('.ap-legend', (el) => (el.textContent ?? '').trim());
      expect(legend, '图例前半是编码图例').toContain('橙标签=需人工介入');
      expect(legend, '后半写明状态域总态数与本页列示数').toContain('阶段 4 态，本页列示 3 态');
      expect(legend).toContain('进行中');
      expect(legend).toContain('未开始');

      // ── ⑥ 两行脚注：口径 + 数据来源 ──
      const notes = await p1.$$eval('.ap-notes__line', (els) => els.map((e) => (e.textContent ?? '').trim()));
      expect(notes, '脚注两行').toHaveLength(2);
      expect(notes[0]).toContain('完成度按可见阶段数统计');
      expect(notes[1]).toContain('数据来源 ID Plan 排程库');

      // ── ⑦ 任务页 / 成员页的载荷 ──
      const p2Text = (await (await page.$('[data-print-page="task-register"]'))!.textContent()) ?? '';
      // 空组不落版（诚实：本页没有该态的块就不摆空壳栏）——
      // 夹具只有「进行中 + 受阻」⇒ 命中 `在轨` / `需要人动作`，另两组不出空壳
      expect(p2Text, '有块的分组出栏头').toContain('在轨');
      expect(p2Text, '有块的分组出栏头').toContain('需要人动作');
      expect(p2Text, '空组不摆空壳栏（诚实口径）').not.toContain('起草与待命');
      expect(p2Text, '空组不摆空壳栏（诚实口径）').not.toContain('终局');
      // 读号走 `formatTaskNo`（补零规则只有一处，纸面不散拼 'T-' + n）
      expect(p2Text, '任务块 = 读号 + 状态标签').toContain(`任务 ${formatTaskNo(1042)}`);
      expect(p2Text).toContain('受阻');
      expect(p2Text).toContain('产出物 1');
      expect(p2Text, '任务口径行').toContain('Task.dueDate');
      expect(p2Text, '任务图例').toContain('任务 7 态，本页列示 2 态');

      const p3Text = (await (await page.$('[data-print-page="member-roster"]'))!.textContent()) ?? '';
      expect(p3Text, '成员分栏 = 人类 / Agent').toContain('人类成员');
      expect(p3Text, '成员分栏 = 人类 / Agent').toContain('Agent 执行体');
      expect(p3Text).toContain('负责人甲');
      expect(p3Text).toContain('小 Agent');
      expect(p3Text, '成员口径行').toContain('Member.roleKind');
      expect(p3Text, '成员图例如实写明不登 agentKind 的理由（每页可独立解释）').toContain('不登 agentKind');
      expect(p3Text, 'agentKind 值本身不上纸').not.toContain('brand-new-harness-9000');

      // ── ⑧ Agent 载荷整块下纸（项目里**确实有**执行单与写回提案）──
      expect(vm.executions.length, '夹具里确实存在 Agent 执行数据').toBeGreaterThan(0);
      for (const dead of ['run_h4_001', 'task.status', '写回', '仅供参考', 'confidence', 'runId']) {
        expect(text, `Agent 载荷「${dead}」不得再上纸（规格 §1.3）`).not.toContain(dead);
      }
      expect(text).not.toContain('当前项目暂无 Agent 执行数据');
    } finally {
      await page.close();
    }
  });

  it('④ 空态：三页各自的只读空态（阶段 / 任务 / 成员），不出巨字、不填模拟记录', async () => {
    const css = builtCss();
    const vm = buildVm({ stages: [], tasks: [], members: [] });
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('h-hum-empty.html', shell(markupOf(vm), css, false)));
      const geo = await pageGeometry(page);
      expect(geo).toHaveLength(3);
      const kinds = await page.$$eval('[data-print-empty]', (els) =>
        els.map((e) => e.getAttribute('data-print-empty')),
      );
      expect(kinds, '三页各出自己的空态口径').toEqual(['stages', 'tasks', 'members']);
      const text = (await page.textContent('body')) ?? '';
      expect(text).toContain('当前可见范围内无阶段');
      expect(text).toContain('当前可见范围内无任务');
      expect(text).toContain('当前可见范围内无相关成员');
      // 空态不出巨字（不用装饰填版）。断言要**限定在主体内**：页眉的品牌标识
      // `ID PLAN · …` 是纸面身份装置，任何页面都在，不能拿整页文本当真值源。
      const bodyText = (await page.$eval('.ap-body', (el) => el.textContent ?? '')) ?? '';
      expect(bodyText, '空态主体不出品牌巨字').not.toContain('PLAN');
      expect(await page.$('.ap-giant')).toBeNull();
      expect(await page.$('.ap-block')).toBeNull();
      // 页底品牌装置与页题仍在（纸面照常出、每页可独立解释）
      expect(await page.$('.ap-footword__word')).not.toBeNull();
      for (const g of geo) {
        expect(g.h, `${g.page} 空态页不得溢出`).toBeLessThanOrEqual(1124);
        expect(g.bodyOverflow).toBeLessThanOrEqual(1);
      }
    } finally {
      await page.close();
    }
  });

  it('⑤ 分页压测：24 阶段 + 30 任务（单栏必跨页）；续页不出巨字出「（续）」；逐页 794×1123 无裁切', async () => {
    const css = builtCss();
    const vm = buildVm({ stages: MANY_STAGES, tasks: MANY_TASKS });
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('h-hum-many.html', shell(markupOf(vm), css, false)));
      const geo = await pageGeometry(page);
      expect(geo.length, '压测数据必须分页（> 三页）').toBeGreaterThan(3);
      for (const g of geo) {
        expect(Math.abs(g.w - 794), `${g.page} 页宽应 794`).toBeLessThanOrEqual(1);
        expect(g.h, `${g.page} 页高应恰 1123（溢出即红）`).toBeLessThanOrEqual(1124);
        expect(g.h).toBeGreaterThanOrEqual(1122);
        expect(g.bodyOverflow, `${g.page} 主体不得内部溢出`).toBeLessThanOrEqual(1);
      }
      // 总页数进页签：NN = 物理页总数，nn 递增
      const tabs = await page.$$eval('.ap-head__tab', (els) => els.map((e) => (e.textContent ?? '').trim()));
      const total = String(geo.length).padStart(2, '0');
      expect(tabs[0]).toBe(`SHEET 01 / ${total} · A4`);
      expect(tabs[tabs.length - 1]).toBe(`SHEET ${total} / ${total} · A4`);

      // ── 满页密度（「没白留一整条」的正向判据）──
      // 24 阶段 ⇒ 首屏 7 块/栏 × 2 栏 = 14 块，栏区真的铺满
      const fullNotes = await page.$eval('.a4-page .ap-notes', (el) => {
        const r = el.getBoundingClientRect();
        const pg = el.closest('.a4-page')!.getBoundingClientRect();
        return +(r.bottom - pg.top).toFixed(1);
      });
      expect(fullNotes, '满页正文须铺到下半页（≥900）').toBeGreaterThanOrEqual(900);
      expect(fullNotes, '满页正文也不得进页底巨字墨迹带（≤994）').toBeLessThanOrEqual(994);
      const blockCount = await page.$eval('.a4-page', (el) => el.querySelectorAll('.ap-block').length);
      expect(blockCount, '阶段海报单页原生容量 = 7 块/栏 × 2 栏（真机实测回填）').toBe(14);

      // ── 任务海报的双轨（规格 §1.2.3）──
      // 30 条任务 > `AP_POSTER_TASK_MAX`(12) ⇒ 该页**回落通用渲染**（清单行 + 右栏面板），
      // 而不是把海报语法硬撑成一条长清单（审美标准 §2-H 的既有纪律）。
      const pageKinds = await page.$$eval('[data-print-page]', (els) =>
        els.map((e) => e.getAttribute('data-print-page')),
      );
      expect(pageKinds, '任务超容量 ⇒ 该页落通用渲染').toContain('generic-task-list');
      expect(pageKinds, '回落时不再出原生任务海报页').not.toContain('task-register');

      // 续页：不出巨字、页眉出「（续）」常规小页题
      const cont = await page.$$eval('[data-print-page="stage-overview"]', (els) =>
        els.map((el) => ({
          hasGiant: el.querySelector('.ap-giant') !== null,
          cont: (el.querySelector('.ap-head__cont')?.textContent ?? '').trim(),
        })),
      );
      expect(cont.length, '24 个同栏阶段 ⇒ 阶段海报必跨页').toBeGreaterThan(1);
      expect(cont[0]!.hasGiant, '模块首页出巨字').toBe(true);
      for (const [i, c] of cont.entries()) {
        if (i === 0) continue;
        expect(c.hasGiant, '续页不出巨字（规格 §1.2.2 分页口径）').toBe(false);
        expect(c.cont, '续页页眉出常规小页题「阶段海报（续）」').toBe('阶段海报（续）');
      }
      await page.$eval('.a4-page', () => undefined);
      const els = await page.$$('.a4-page');
      await els[0]!.screenshot({ path: join(OUT_DIR, 'h-hum-many-p1.png') });
      await els[1]!.screenshot({ path: join(OUT_DIR, 'h-hum-many-p2.png') });
    } finally {
      await page.close();
    }
  });

  it('⑥ 预设变体（朱红）：三页彩色全新取色；accent 槽位确实挂上；纸底仍是暖灰米', async () => {
    const css = builtCss();
    const vm = buildVm();
    const preset = PRINT_TEMPLATE_PALETTES['agent-poster'].presets.find((p) => p.id === 'vermilion')!;
    const markup = renderToStaticMarkup(
      createElement(AgentPosterDocument, { vm, palette: preset.palette }),
    );
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('h-hum-preset-vermilion.html', shell(markup, css, false)));
      const geo = await pageGeometry(page);
      expect(geo).toHaveLength(3);
      for (const g of geo) expect(g.h, `${g.page} 不得溢出`).toBeLessThanOrEqual(1124);
      // 预设真的挂上：gate 实底标签 + 栏头线 + 中轴都取朱红（不是默认橙）
      const accents = await page.$$eval('.ap-block__tag, .ap-col__rule, .ap-cols', (els) =>
        els.map((e) => getComputedStyle(e).backgroundColor),
      );
      expect(accents, '朱红预设应出现在实底标签/栏头线里').toContain(hexRgb(preset.palette.accent));
      const axisBg = await page.$eval('.ap-cols', (el) => getComputedStyle(el, '::before').backgroundColor);
      expect(axisBg, '中轴随预设变').toBe(hexRgb(preset.palette.accent));
      // 纸面仍是暖灰米（paper 不开槽位 = H 的身份，规格 §1.1 A1 / P0-17）
      const paper = await page.$eval('.a4-page', (el) => getComputedStyle(el).backgroundColor);
      expect(paper, '纸底应为参考稿实测暖灰米 #DEDDD4').toBe('rgb(222, 221, 212)');
      // 井字极简：确认没把 gate 标签的文字色做成白的（对比度 3.81 < 4.5）
      const gateColor = await page.$eval('.ap-block__tag[data-tone="gate"]', (el) => getComputedStyle(el).color);
      expect(gateColor, 'accent 实底取墨字').toBe('rgb(10, 10, 10)');
      const els = await page.$$('.a4-page');
      for (let i = 0; i < els.length; i++) {
        await els[i]!.screenshot({ path: join(OUT_DIR, `h-hum-preset-p${i + 1}.png`) });
      }
    } finally {
      await page.close();
    }
  });

  it('⑦ B1/B3 · 页级出血巨字：页顶 = 品牌词（模块首页）/ 页底 = 固定 IDPLAN；正文底线让出墨迹带且留 8–12px 呼吸', async () => {
    const css = builtCss();
    const vm = buildVm();
    const dir = join(OUT_DIR, 'h-hum-giant-2026-10-11');
    mkdirSync(dir, { recursive: true });

    /** 量一张纸上两块巨字（坐标 relative 纸面左上角，CSS px） */
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
      /**
       * 元素内文字的**真实墨迹**矩形（用页内 canvas 字体度量算，不抄实现系数）。
       *
       * 为什么不能只断元素矩形：巨字的**行盒**比墨迹高一圈（上有多余行距、下有
       * 过冲），行盒不相交 ≠ 墨迹不相交。要守的是「正文压到看得见的字」，
       * 判据必须落在墨迹上。算法：半行距 + 字体上下度量 ⇒ 基线，基线 ∓ 实际
       * 墨迹上下缘 ⇒ 墨迹矩形。自证：下面会拿它去复核参考稿实测的 y1004..1113，
       * canvas 与 DOM 解出不同字体时先红，不静默。
       */
      const inkOf = (sel: string) => {
        const t = el.querySelector(sel) as HTMLElement | null;
        if (!t) return null;
        const r = t.getBoundingClientRect();
        const s = getComputedStyle(t);
        const cv = document.createElement('canvas').getContext('2d')!;
        cv.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
        const mt = cv.measureText((t.textContent ?? '').trim());
        const fs = Number.parseFloat(s.fontSize);
        const lh = s.lineHeight === 'normal' ? fs * 1.2 : Number.parseFloat(s.lineHeight);
        const baseline =
          r.top -
          pg.top +
          (lh - (mt.fontBoundingBoxAscent + mt.fontBoundingBoxDescent)) / 2 +
          mt.fontBoundingBoxAscent;
        return {
          top: +(baseline - mt.actualBoundingBoxAscent).toFixed(2),
          bottom: +(baseline + mt.actualBoundingBoxDescent).toFixed(2),
          baseline: +baseline.toFixed(2),
          fs,
        };
      };
      return {
        page: { w: +pg.width.toFixed(2), h: +pg.height.toFixed(2) },
        head: box('.ap-head'),
        word: box('.ap-giant__word'),
        wordInk: inkOf('.ap-giant__word'),
        sub: box('.ap-giant__subword'),
        foot: box('.ap-footword'),
        footWord: box('.ap-footword__word'),
        footWordInk: inkOf('.ap-footword__word'),
        notes: box('.ap-notes'),
      };
    };

    const open = async (file: string, markup: string): Promise<void> => {
      await page.goto('file://' + writeHtml(file, shell(markup, css, false)));
    };

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      // ── ① 默认品牌词（不传 brandWord ⇒ 回落 PLAN）──
      await open('h-hum-giant-default.html', markupOf(vm));
      const p1 = (await page.$('[data-print-page="stage-overview"]'))!;
      const m = await p1.evaluate(measure);

      // 装置贴纸缘：出血的「画布」就是整张纸
      expect(m.word!.top, '巨字行盒须越出纸顶（出血）').toBeLessThan(0);
      expect(m.word!.left, '巨字应贴纸左缘（墨迹左缘 ≈18px，参考稿实测）').toBeGreaterThanOrEqual(0);
      expect(m.word!.left, '巨字不得被推进内容框（44px）').toBeLessThan(20);
      expect(m.word!.text, '页顶巨字载荷 = 默认品牌词 PLAN（§1.4 规则 1）').toBe('PLAN');
      expect(m.word!.tt, '巨字恒大写（§1.4 规则 4）').toBe('uppercase');
      expect(m.word!.color, '页顶巨字取身份色 accent').toBe(hexRgb(BASELINE.accent));

      // 页底：行盒越出纸底（被裁），词固定
      expect(m.foot!.bottom, '页底巨字装置贴纸底').toBeGreaterThanOrEqual(1120);
      expect(m.footWord!.bottom, '页底巨字行盒须越出纸底（出血）').toBeGreaterThan(1123);
      expect(m.footWord!.text, '页底巨字 = 固定品牌装置 IDPLAN').toBe('IDPLAN');
      expect(m.footWord!.color, '页底巨字同为身份色').toBe(hexRgb(BASELINE.accent));

      // 叠字（参考稿 Execution 的同位替换）：英文页主题词、墨色、压到巨字右下
      expect(m.sub!.text, '叠字 = 英文页主题词').toBe('Stages');
      expect(m.sub!.color, '叠字为墨色（与参考稿 Execution 同）').toBe('rgb(10, 10, 10)');
      expect(parseFloat(m.sub!.fs), '叠字 ≈41px（参考稿 cap31 反解，推断值实拍复核）').toBeCloseTo(41, 0);
      expect(m.sub!.top, '叠字压到巨字下方（与巨字基线齐平）').toBeLessThan(150);
      expect(m.sub!.left, '叠字压在巨字右侧（约 x397 起，参考稿实测）').toBeGreaterThan(300);

      // ── 自证：页底巨字墨迹复现参考稿实测 y1004..1113 ──
      expect(m.footWordInk!.top, 'IDPLAN 墨迹顶须复现参考稿实测 y≈1004').toBeGreaterThan(1000);
      expect(m.footWordInk!.top, 'IDPLAN 墨迹顶须复现参考稿实测 y≈1004').toBeLessThan(1008);
      expect(m.footWordInk!.bottom, 'IDPLAN 墨迹底须复现参考稿实测 y≈1113').toBeGreaterThan(1109);
      expect(m.footWordInk!.bottom, 'IDPLAN 墨迹底须复现参考稿实测 y≈1113').toBeLessThan(1117);

      // ── P0-23 的继任判据：正文（两行脚注）须让出页底巨字墨迹带 ──
      expect(m.notes!.bottom, '正文底线须 ≤ 994（1123 − 129 让位量）').toBeLessThanOrEqual(994);
      const breath = +(m.footWordInk!.top - m.notes!.bottom).toFixed(2);
      expect(breath, '正文↔巨字墨迹呼吸须 ≥8px（P0-23 的继任判据）').toBeGreaterThanOrEqual(8);
      // 上界不在这里断：让位量是**下限**（正文不许进墨迹带），短内容当然离得远。
      // 「没白留一整条」的正向判据放在 ⑤ 的**满页**上（notes 底须 ≥900）。

      await p1.screenshot({ path: join(dir, 'h-hum-p1-giant.png') });

      // 页顶巨字只在**模块首页**；页底是纸级品牌装置，三页同构
      const p2 = (await page.$('[data-print-page="task-register"]'))!;
      expect(await p2.$('.ap-giant__word'), '任务页是模块首页 ⇒ 也出巨字（三页各是模块首页）').not.toBeNull();
      expect(await p2.$('.ap-footword__word'), '页底品牌装置三页同构').not.toBeNull();

      // ── ② 自定义品牌词：页顶跟着变，页底**不跟着变**（§1.4 规则 5）──
      await open('h-hum-giant-custom.html', markupOf(vm, '云栖茶室'));
      const p1b = (await page.$('[data-print-page="stage-overview"]'))!;
      const m2 = await p1b.evaluate(measure);
      expect(m2.word!.text, '页顶巨字 = 自定义品牌词').toBe('云栖茶室');
      expect(m2.word!.top, '换词后仍出血').toBeLessThan(0);
      expect(m2.word!.right, '4 个汉字仍须在纸宽内').toBeLessThanOrEqual(794);
      expect(m2.footWord!.text, '页底 IDPLAN 不随自定义变（§1.4 规则 5）').toBe('IDPLAN');
      await p1b.screenshot({ path: join(dir, 'h-hum-p1-custom.png') });

      // ── ③ 超上限长词：渲染口再截断一次 + 降档后仍不撑破纸面（规则 3/6）──
      await open('h-hum-giant-long.html', markupOf(vm, '云栖·湖畔茶室综合改造项目A'));
      const p1c = (await page.$('[data-print-page="stage-overview"]'))!;
      const m3 = await p1c.evaluate(measure);
      expect(m3.word!.text, '超上限词在渲染口被截断到 12 字符').toBe('云栖·湖畔茶室综合改造项');
      expect(m3.word!.tier, '长词降到地板档 sm').toBe('sm');
      expect(m3.word!.right, '地板档仍须在纸宽内').toBeLessThanOrEqual(794);
      await p1c.screenshot({ path: join(dir, 'h-hum-p1-long.png') });

      console.log(
        `[H 人类化实测] 页顶 left=${m.word!.left} right=${m.word!.right} fs=${m.word!.fs}(${m.word!.tier}) ` +
          `越顶=${m.word!.top} 顶墨迹=${m.wordInk!.top}..${m.wordInk!.bottom}｜叠字 ${m.sub!.left}..${m.sub!.right} ` +
          `y=${m.sub!.top}..${m.sub!.bottom}｜页底 越底=${m.footWord!.bottom} ` +
          `底墨迹=${m.footWordInk!.top}..${m.footWordInk!.bottom}｜正文底线=${m.notes!.bottom} 呼吸=${breath}px｜` +
          `页头框 ${m.head!.top}..${m.head!.bottom}（顶巨字墨迹 ${m.wordInk!.top}..${m.wordInk!.bottom}）｜` +
          `自定义 right=${m2.word!.right}(${m2.word!.tier})｜长词 right=${m3.word!.right}(${m3.word!.tier})`,
      );
    } finally {
      await page.close();
    }
  });
});
