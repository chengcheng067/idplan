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
import type { StageLog } from '../src/core/types/entities';
import { StageLogType } from '../src/core/types/enums';
import { agentPosterBlockPages } from '../src/print/documents/AgentPosterDocument';
import { DEFAULT_SCHEDULE_PAPER_BLOCKS } from '../src/lib/schedule-print';
import { blockRecordOf, printTemplateUnitIds, resolveUnits } from '../src/print/model/print-units';
import type { PrintSheet } from '../src/components/print/print-templates';
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
  name: '演示项目1·多阶段协作演示',
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
    // `TaskSource = 'human' | 'agent'`（src/core/types/enums.ts:205）——历史夹具误写
    // `'manual'`，只是被这个 spec 不在 tsconfig 的检查范围内掩盖了。
    source: 'human',
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

/**
 * legacy 原生页清单（期三的 sheets 形状：人类三页海报）。
 * 2026-10-13 批 D 起 H 走**五块形态**（`usesBlocks`）；原来的三页与通用模块渲染
 * **代码与 spec 全留**（决策 2），只是不再有暴露面 —— 本 spec 里凡要验「原生海报
 * 页那套版式 / 分页」的用例，都显式传它走 legacy 路径。
 */
const NATIVE_SHEETS: readonly PrintSheet[] = [
  { type: 'native', page: 'stage-overview' },
  { type: 'native', page: 'task-register' },
  { type: 'native', page: 'member-roster' },
];

/** legacy 原生页的纸面（本 spec 既有用例全走这条；断言逐字未改） */
function markupOf(vm: ReturnType<typeof buildPrintViewModel>, brandWord?: string): string {
  return renderToStaticMarkup(
    createElement(AgentPosterDocument, {
      vm,
      sheets: NATIVE_SHEETS,
      palette: BASELINE,
      ...(brandWord ? { brandWord } : {}),
    }),
  );
}

/** 5 块形态的纸面（`units` = `resolveUnits` 的结果；缺省 = 五块全开） */
function blocksMarkupOf(
  vm: ReturnType<typeof buildPrintViewModel>,
  ids?: readonly string[],
  brandWord?: string,
): string {
  return renderToStaticMarkup(
    createElement(AgentPosterDocument, {
      vm,
      units: resolveUnits('agent-poster', ids ? { units: { 'agent-poster': ids as never } } : undefined),
      palette: BASELINE,
      ...(brandWord ? { brandWord } : {}),
    }),
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

      // ── ⓪ 横向几何：三轨 340+38+336 = **714** 必须恰好落满内容框（P1-3 修 8px 溢出）──
      // 三轨与橙色通栏线都是**参考稿 40px 内缩下的绝对坐标**（内容区 x40..754）。
      // `--ap-pad-x` 曾取 44 ⇒ 内容框只有 706，右栏右缘溢出 8px（实测 x1001 vs x993），
      // 表现为「右栏块底分隔线比页眉线/脚注线长 8px」。改回 40 后两者必须逐位对齐。
      //
      // ⚠️ 坐标系：getBoundingClientRect() 给的是**视口坐标**，而 794 宽的 a4 页在 shell 里
      // 被居中（1000 视口 ⇒ 每侧留白 103）。所以「x40/x754/x396.5」这类参考稿数字只能与
      // **页内坐标**（减去 pageLeft）比，不能直接与视口坐标比 —— 首版这里写成视口值 397，
      // 实测 500 而误报红（103 的差正好是 shell 留白）。下面一律用 pageLeft 归一化。
      const geo = await page.$eval('[data-print-page="stage-overview"] .ap-cols', (cols) => {
        const bodyEl = cols.closest('.ap-body') as HTMLElement;
        const bs = getComputedStyle(bodyEl);
        const bodyBox = bodyEl.getBoundingClientRect();
        const box = cols.getBoundingClientRect();
        const tracks = [...cols.children].map((c) => c.getBoundingClientRect());
        const pg = cols.closest('.a4-page') as HTMLElement;
        const pgBox = pg.getBoundingClientRect();
        const fullWidth = (sel: string) => {
          const el = pg.querySelector(sel) as HTMLElement | null;
          return el ? el.getBoundingClientRect() : null;
        };
        return {
          padX: parseFloat(bs.paddingLeft),
          pageLeft: +pgBox.left.toFixed(2),
          pageRight: +pgBox.right.toFixed(2),
          contentLeft: +(bodyBox.left + parseFloat(bs.paddingLeft)).toFixed(2),
          contentRight: +(bodyBox.right - parseFloat(bs.paddingRight)).toFixed(2),
          colsLeft: +box.left.toFixed(2),
          colsWidth: +box.width.toFixed(2),
          // 参考稿口径（页内坐标）
          contentLeftRel: +(bodyBox.left + parseFloat(bs.paddingLeft) - pgBox.left).toFixed(2),
          contentRightRel: +(bodyBox.right - parseFloat(bs.paddingRight) - pgBox.left).toFixed(2),
          rightColRightRel: +(tracks[1]!.right - pgBox.left).toFixed(2),
          axisCxRel: +(box.left - pgBox.left + box.width / 2).toFixed(2),
          headRuleRightRel: fullWidth('.ap-head__rule')
            ? +(fullWidth('.ap-head__rule')!.right - pgBox.left).toFixed(2)
            : null,
          notesRightRel: fullWidth('.ap-notes')
            ? +(fullWidth('.ap-notes')!.right - pgBox.left).toFixed(2)
            : null,
          leftTrack: +tracks[0]!.width.toFixed(2),
          rightTrack: +tracks[1]!.width.toFixed(2),
          gutter: +(tracks[1]!.left - tracks[0]!.right).toFixed(2),
          rightColRight: +tracks[1]!.right.toFixed(2),
          notesRight: fullWidth('.ap-notes') ? +fullWidth('.ap-notes')!.right.toFixed(2) : null,
          headRuleRight: fullWidth('.ap-head__rule')
            ? +fullWidth('.ap-head__rule')!.right.toFixed(2)
            : null,
          ruleWidth: fullWidth('.ap-head__rule') ? +fullWidth('.ap-head__rule')!.width.toFixed(2) : null,
        };
      });
      // eslint-disable-next-line no-console
      console.log(
        `[H 横向几何] pad-x=${geo.padX}｜页内内容框 ${geo.contentLeftRel}..${geo.contentRightRel}` +
          `（宽 ${geo.colsWidth}）｜三轨 左 ${geo.leftTrack} + 栏间 ${geo.gutter} + 右 ${geo.rightTrack}` +
          `｜页内右栏右缘 ${geo.rightColRightRel}｜页内轴心 ${geo.axisCxRel}` +
          `｜页内全宽件右缘 页眉线 ${geo.headRuleRightRel} / 脚注 ${geo.notesRightRel}` +
          `｜视口坐标 内容框 ${geo.contentLeft}..${geo.contentRight}（页左缘 ${geo.pageLeft}）`,
      );
      expect(geo.padX, '版心内缩 = 参考稿 40px（三轨的绝对坐标基准）').toBe(40);
      expect(geo.colsWidth, '内容框全宽 = 794 − 2×40 = 714').toBeCloseTo(714, 1);
      expect(geo.leftTrack, '左栏 = 参考稿 x40..380').toBeCloseTo(340, 1);
      expect(geo.gutter, '栏间 = 参考稿 38').toBeCloseTo(38, 1);
      expect(geo.rightTrack, '右栏 = 参考稿 x418..754').toBeCloseTo(336, 1);
      // 参考稿对齐（页内坐标）：内容区 x40..754、轴心 x396.5
      expect(geo.contentLeftRel, '内容框左缘 = 参考稿 x40').toBeCloseTo(40, 1);
      expect(geo.contentRightRel, '内容框右缘 = 参考稿 x754').toBeCloseTo(754, 1);
      expect(
        geo.axisCxRel,
        '轴心 = 内容区左缘 40 + 714/2 = 397（参考稿 x396.5）⇒ 中轴居中于内容框',
      ).toBeCloseTo(397, 0);
      // 溢出判据（P1-3：修前这里差 8px）
      expect(geo.rightColRight, '右栏右缘不得超内容框右缘（修前超 8px）').toBeLessThanOrEqual(
        geo.contentRight + 0.5,
      );
      expect(geo.rightColRight, '右栏右缘须与内容框右缘对齐').toBeCloseTo(geo.contentRight, 1);
      expect(geo.headRuleRight, '页眉全宽线右缘须与内容框右缘对齐').toBeCloseTo(geo.contentRight, 1);
      expect(geo.notesRight, '脚注全宽线右缘须与内容框右缘对齐').toBeCloseTo(geo.contentRight, 1);
      expect(geo.ruleWidth, '页眉全宽线宽 = 内容框 714').toBeCloseTo(714, 1);

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
        // 中灰 = line 槽（2026-10-11 P1-3 起为参考稿实测 #91918A）——从 palette 取，
        // 不抄色值：分组线一旦用上「线色槽」就已经退化成中灰承担分组职责。
        expect(r.bg, `分组线不许中灰/线色（tone=${r.tone}）`).not.toBe(hexRgb(BASELINE.line));
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
      expect(p1Text, 'meta 行 = 项目名 + 阶段计数').toContain('演示项目1·多阶段协作演示');
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
      expect(p3Text, '成员分栏 = 人类 / 执行体').toContain('人类成员');
      expect(p3Text, '成员分栏 = 人类 / 执行体').toContain('执行体');
      expect(p3Text).toContain('负责人甲');
      expect(p3Text).toContain('小 Agent');
      expect(p3Text, '成员口径行').toContain('Member.roleKind');
      expect(p3Text, '成员图例如实写明不登执行体类型的理由（每页可独立解释）').toContain('不登执行体类型');
      expect(p3Text, 'agentKind 值本身不上纸').not.toContain('brand-new-harness-9000');

      // ── ⑧ Agent 载荷整块下纸（项目里**确实有**执行单与写回提案）──
      expect(vm.executions.length, '夹具里确实存在 Agent 执行数据').toBeGreaterThan(0);
      for (const dead of ['run_h4_001', 'task.status', '写回', '仅供参考', 'confidence', 'runId']) {
        expect(text, `Agent 载荷「${dead}」不得再上纸（规格 §1.3）`).not.toContain(dead);
      }
      expect(text, 'H 纸面不得回落整版空态文案').not.toContain('当前项目暂无执行数据');
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
      createElement(AgentPosterDocument, { vm, sheets: NATIVE_SHEETS, palette: preset.palette }),
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
      expect(m.word!.left, '巨字不得被推进内容框（--ap-pad-x = 40px）').toBeLessThan(20);
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
      await open('h-hum-giant-custom.html', markupOf(vm, '演示品牌'));
      const p1b = (await page.$('[data-print-page="stage-overview"]'))!;
      const m2 = await p1b.evaluate(measure);
      expect(m2.word!.text, '页顶巨字 = 自定义品牌词').toBe('演示品牌');
      expect(m2.word!.top, '换词后仍出血').toBeLessThan(0);
      expect(m2.word!.right, '4 个汉字仍须在纸宽内').toBeLessThanOrEqual(794);
      expect(m2.footWord!.text, '页底 IDPLAN 不随自定义变（§1.4 规则 5）').toBe('IDPLAN');
      await p1b.screenshot({ path: join(dir, 'h-hum-p1-custom.png') });

      // ── ③ 超上限长词：渲染口再截断一次 + 降档后仍不撑破纸面（规则 3/6）──
      await open('h-hum-giant-long.html', markupOf(vm, '演示项目1·多阶段协作演示A'));
      const p1c = (await page.$('[data-print-page="stage-overview"]'))!;
      const m3 = await p1c.evaluate(measure);
      expect(m3.word!.text, '超上限词在渲染口被截断到 12 字符').toBe('演示项目1·多阶段协作演');
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

/* ====================================================================================
 * 5 块形态（2026-10-13「5 块 × 4 模板」重构 · 批 D）
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('H 版 · 五块形态（批 D：双栏分段轴甘特 / 两栏等宽 / 条长对账）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  const ALL = (): readonly string[] => printTemplateUnitIds('agent-poster');
  const blocksOf = (ids: readonly string[]) =>
    blockRecordOf(resolveUnits('agent-poster', { units: { 'agent-poster': ids as never } }));

  /**
   * n 阶段夹具（批 D 页数表用）。⚠️ 不能复用既有 `makeStage`：它的日期是
   * `2026-01-{n}`（n ≤ 28 才合法），40 阶段直接造出 `2026-01-40` 这种脏日期。
   * 这里按 3 天阶梯铺开、跨度 4–19 天不一，状态四态轮换。
   */
  function stagesN(n: number): Stage[] {
    return Array.from({ length: n }, (_, i) => {
      const k = i + 1;
      const start = new Date(Date.UTC(2026, 0, 1 + i * 3));
      const end = new Date(Date.UTC(2026, 0, 1 + i * 3 + 4 + (i % 4) * 5));
      return {
        ...makeStage(
          k,
          k % 3 === 0
            ? StageStatus.NotStarted
            : k % 4 === 0
              ? StageStatus.Delayed
              : k % 5 === 0
                ? StageStatus.Completed
                : StageStatus.InProgress,
          `阶段${k}·现场勘查与方案深化`,
        ),
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      };
    });
  }

  /** 一条改期记录（L3 的正面锁要它才可能上纸；既有夹具的 stageLogs 是空数组） */
  const RESCHED_LOGS: readonly StageLog[] = [
    {
      id: 'log_h4_1',
      stageId: 'stg_h4_2',
      projectId: PROJECT_ID,
      type: StageLogType.Rescheduled,
      fromStatus: null,
      toStatus: null,
      oldStartAt: null,
      newStartAt: null,
      oldEndAt: '2026-02-02T23:59:59Z',
      newEndAt: '2026-02-09T23:59:59Z',
      reason: '等客户确认主材样品，延期 7 天',
      operatorName: '负责人甲',
      createdAt: '2026-01-19T02:00:00Z',
    },
  ];

  /** 逐页几何 + 页形（「无裁切」两道判据，同既有组） */
  async function pageGeometry(page: import('playwright-core').Page) {
    return page.$$eval('.a4-page', (els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const body = el.querySelector('.ap-body') as HTMLElement | null;
        return {
          page: el.getAttribute('data-print-page'),
          form: el.getAttribute('data-page-form'),
          w: +r.width.toFixed(1),
          h: +r.height.toFixed(1),
          bodyOverflow: body ? +(body.scrollHeight - body.clientHeight).toFixed(1) : null,
        };
      }),
    );
  }

  it('★ 默认态 = 五块形态：预计 = 实际、逐页 794×1123（彩 + 灰）、页形序列 span → list', async () => {
    const css = builtCss();
    const vm = buildVm();
    const markup = blocksMarkupOf(vm);
    const planned = agentPosterBlockPages(vm, DEFAULT_SCHEDULE_PAPER_BLOCKS).length;

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const gray of [false, true]) {
        const path = writeHtml(gray ? 'h-blocks-gray.html' : 'h-blocks-color.html', shell(markup, css, gray));
        await page.goto('file://' + path);
        const geo = await pageGeometry(page);
        expect(geo, `五块形态应渲染 ${planned} 页（装配层同源）`).toHaveLength(planned);
        expect(geo.every((g) => g.page === 'blocks'), '五块形态的纸面标识').toBe(true);
        // B2 页在前、B4 页在后（同一批阶段：先「何时」后「什么状态」）
        expect(geo.map((g) => g.form)[0], '首页是 B2 甘特页').toBe('span');
        expect(geo.map((g) => g.form)).toContain('list');
        for (const g of geo) {
          expect(Math.abs(g.w - 794), `${g.form} 页宽应 794`).toBeLessThanOrEqual(1);
          expect(g.h, `${g.form} 页高应恰 1123（溢出即红）`).toBeLessThanOrEqual(1124);
          expect(g.h, `${g.form} 页高不得低于 1123`).toBeGreaterThanOrEqual(1122);
          expect(g.bodyOverflow, `${g.form} 主体不得内部溢出`).toBeLessThanOrEqual(1);
        }
        const els = await page.$$('.a4-page');
        for (let i = 0; i < els.length; i++) {
          await els[i]!.screenshot({
            path: join(OUT_DIR, `density-h-blocks-p${i + 1}-${gray ? 'gray' : 'color'}.png`),
          });
        }
      }
      // 巨字只在**文档第一张纸**上（分页口径；续页/后续页形都不出）
      await page.goto('file://' + writeHtml('h-blocks-color.html', shell(markup, css, false)));
      const giants = await page.$$eval('.a4-page', (els) =>
        els.map((el) => el.querySelectorAll('.ap-giant').length),
      );
      expect(giants[0], '第一张纸出页顶巨字').toBe(1);
      expect(giants.slice(1).every((n) => n === 0), '其余页不出巨字').toBe(true);
    } finally {
      await page.close();
    }
  });

  it('★ B2 三段式逐段落点：① 通栏覆盖带 ② 双栏 + 栏内标尺 + 条 + 内嵌标签 ③ ap-sum「跨度总天数」', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('h-blocks-color.html', shell(blocksMarkupOf(vm), css, false)));
      const m = await page.evaluate(() => {
        const spanPage = document.querySelector('.a4-page[data-page-form="span"]') as HTMLElement;
        const rects = (sel: string) =>
          Array.from(spanPage.querySelectorAll(sel)).map((e) => {
            const r = (e as HTMLElement).getBoundingClientRect();
            return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
          });
        return {
          // ① 通栏覆盖带：刻度 + 合并覆盖段
          bandSegs: spanPage.querySelectorAll('.ap-span-band__seg').length,
          bandTicks: spanPage.querySelectorAll('.ap-span-band__tick').length,
          bandW: +(spanPage.querySelector('.ap-span-band') as HTMLElement).getBoundingClientRect().width.toFixed(1),
          // ② 双栏 + 栏内标尺 + 条 + 内嵌标签
          cols: spanPage.querySelectorAll('.ap-cols[data-gantt] .ap-col').length,
          rulers: spanPage.querySelectorAll('.ap-col__ruler').length,
          colTicks: spanPage.querySelectorAll('.ap-col__ruler-tick').length,
          rows: spanPage.querySelectorAll('.ap-span-row').length,
          bars: spanPage.querySelectorAll('.ap-span-row__bar').length,
          tags: spanPage.querySelectorAll('.ap-span-row__bar .ap-block__tag').length,
          rowRects: rects('.ap-span-row'),
          // ③ ap-sum 第四载荷
          sumLabel: spanPage.querySelector('.ap-sum__label')?.textContent ?? '',
          sumBig: spanPage.querySelector('.ap-sum__big')?.textContent ?? '',
          sumSub: spanPage.querySelector('.ap-sum__sub')?.textContent ?? '',
          note: spanPage.querySelector('.ap-span-note')?.textContent ?? '',
          // 刻度不许越出自己的盒（覆盖带的刻度不许出 714 通栏、栏内刻度不许出栏）
          bandTickOverflow: (() => {
            const track = spanPage.querySelector('.ap-span-band__track') as HTMLElement;
            const right = track.getBoundingClientRect().right;
            return Array.from(spanPage.querySelectorAll('.ap-span-band__tick')).filter(
              (e) => (e as HTMLElement).getBoundingClientRect().right > right + 1,
            ).length;
          })(),
          colTickOverflow: (() => {
            const cols = Array.from(spanPage.querySelectorAll('.ap-cols[data-gantt] .ap-col')) as HTMLElement[];
            let bad = 0;
            for (const col of cols) {
              const right = col.getBoundingClientRect().right;
              for (const t of Array.from(col.querySelectorAll('.ap-col__ruler-tick'))) {
                if ((t as HTMLElement).getBoundingClientRect().right > right + 1) bad++;
              }
            }
            return bad;
          })(),
          // 覆盖段的几何（测试侧独立复算，见下）
          cover: Array.from(spanPage.querySelectorAll('.ap-span-band__seg')).map((e) => ({
            tone: (e as HTMLElement).getAttribute('data-tone'),
            left: Number.parseFloat((e as HTMLElement).getAttribute('data-cover-left') ?? 'NaN'),
            width: Number.parseFloat((e as HTMLElement).getAttribute('data-cover-width') ?? 'NaN'),
          })),
        };
      });
      expect(m.bandSegs, '① 覆盖带有合并覆盖段').toBeGreaterThan(0);
      expect(m.bandTicks, '① 覆盖带有月份刻度').toBeGreaterThan(0);
      expect(m.bandW, '① 覆盖带是**通栏**（714px 内容框）').toBe(714);
      expect(m.cols, '② 双栏').toBe(2);
      expect(m.rulers, '② 每栏一条栏内标尺').toBe(2);
      expect(m.colTicks, '② 栏内标尺有月份刻度').toBeGreaterThan(0);
      expect(m.rows, '② 每阶段一行').toBe(m.bars);
      expect(m.bars, '② 每行一条跨度条').toBeGreaterThan(0);
      expect(m.tags, '② 条左端内嵌实底状态标签').toBe(m.bars);
      for (const r of m.rowRects) expect(r.h, '② 行高 = 42 的实测（41.5）').toBeLessThanOrEqual(42);
      expect(m.sumLabel, '③ ap-sum 载荷 = 跨度总天数（与 B4 的「项目完成度」分工）').toBe('跨度总天数');
      expect(Number(m.sumBig), '③ 大数 = 各阶段跨度天数之和').toBeGreaterThan(0);
      expect(m.sumSub, '③ 副行写明口径').toContain('条 = 时间跨度，非完成度');
      // 刻度不许越盒（第一版把刻度放在盒外用 padding 让位，实测骑到栏注上）
      expect(m.bandTickOverflow, '覆盖带刻度不得越出通栏').toBe(0);
      expect(m.colTickOverflow, '栏内刻度不得越出本栏').toBe(0);

      // ①的**独立复算**：测试侧自己按「阶段起止 → 天偏移 → 合并同色调区间」算一遍
      // 覆盖带，与 DOM 的 data-cover-* 逐段对账（不调源码的派生函数，避免自证）。
      const day = 86400000;
      const iso = (s: string): number => Date.parse(s.slice(0, 10) + 'T00:00:00Z');
      const viewStart = Math.min(iso(vm.project.plannedStartAt), ...vm.stages.map((s) => iso(s.startAt)));
      const viewEnd = Math.max(iso(vm.project.plannedEndAt), ...vm.stages.map((s) => iso(s.endAt)));
      const viewDays = Math.round((viewEnd - viewStart) / day) + 1;
      const merge = (xs: [number, number][]): [number, number][] => {
        const out: [number, number][] = [];
        for (const [lo, hi] of [...xs].sort((a, b) => a[0] - b[0])) {
          const last = out[out.length - 1];
          if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
          else out.push([lo, hi]);
        }
        return out;
      };
      const byTone = new Map<string, [number, number][]>();
      for (const s of vm.stages) {
        const tone =
          s.status === StageStatus.Delayed || s.status === StageStatus.NotStarted ? 'gate' : 'ink';
        const lo = Math.round((iso(s.startAt) - viewStart) / day);
        const hi = Math.round((iso(s.endAt) - viewStart) / day);
        byTone.set(tone, [...(byTone.get(tone) ?? []), [lo, hi]]);
      }
      const expected: { tone: string; left: number; width: number }[] = [];
      for (const tone of ['gate', 'ink']) {
        for (const [lo, hi] of merge(byTone.get(tone) ?? [])) {
          expected.push({
            tone,
            left: Number(((lo / viewDays) * 100).toFixed(4)),
            width: Number((((hi - lo + 1) / viewDays) * 100).toFixed(4)),
          });
        }
      }
      expect(
        [...m.cover].sort((a, b) => a.left - b.left || a.width - b.width),
        '① 覆盖段 = 独立复算的「阶段区间按色调合并」（逐段逐值）',
      ).toEqual(expected.sort((a, b) => a.left - b.left || a.width - b.width));
    } finally {
      await page.close();
    }
  });

  it('★★ 四条几何硬约束实测：两栏 1fr 等宽逐值相等 / B2 关 stagger / 口径注写明栏间不可比 / 两张同族页', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('h-blocks-color.html', shell(blocksMarkupOf(vm), css, false)));
      const m = await page.evaluate(() => {
        const spanPage = document.querySelector('.a4-page[data-page-form="span"]') as HTMLElement;
        const listPage = document.querySelector('.a4-page[data-page-form="list"]') as HTMLElement;
        const cols = Array.from(spanPage.querySelectorAll('.ap-cols[data-gantt] .ap-col')) as HTMLElement[];
        const tracks = Array.from(spanPage.querySelectorAll('.ap-span-row__track')) as HTMLElement[];
        const colRule = getComputedStyle(spanPage.querySelector('.ap-cols[data-gantt]') as Element)
          .gridTemplateColumns;
        return {
          colW: cols.map((c) => +c.getBoundingClientRect().width.toFixed(2)),
          trackW: tracks.map((t) => +t.getBoundingClientRect().width.toFixed(2)),
          colRule,
          // ② B2 页的行不许有交错；B4 页必须仍有（交错是 H 的签名）
          spanStagger: spanPage.querySelectorAll('.ap-span-row[data-stagger]').length,
          listStagger: listPage.querySelectorAll('.ap-block[data-stagger]').length,
          note: spanPage.querySelector('.ap-span-note')?.textContent ?? '',
          // ④ 两张同族页：B2 有跨度条无字段 meta；B4 有字段 meta 无跨度条
          spanBars: spanPage.querySelectorAll('.ap-span-row__bar').length,
          spanMeta: spanPage.querySelectorAll('.ap-block__meta').length,
          listBars: listPage.querySelectorAll('.ap-span-row__bar').length,
          listMeta: listPage.querySelectorAll('.ap-block__meta').length,
          listSum: listPage.querySelector('.ap-sum__label')?.textContent ?? '',
          sumVariants: Array.from(document.querySelectorAll('.ap-sum')).map((e) =>
            e.getAttribute('data-print-sum'),
          ),
        };
      });
      // ① 两栏 1fr 等宽（约束①）：逐值相等，且轨宽也相等（同一 % 的条在两栏等长）
      expect(m.colRule, '约束①：B2 页强制 1fr 1fr').toContain('338px');
      expect(m.colW[0], '约束①：两栏实测宽逐值相等').toBe(m.colW[1]);
      expect(m.colW[0], '约束①：栏宽 = (714 − 38) / 2').toBe(338);
      expect(new Set(m.trackW).size, '约束①：两栏轨道同宽').toBe(1);
      // ② 关交错（约束②）
      expect(m.spanStagger, '约束②：B2 页的行没有 data-stagger').toBe(0);
      expect(m.listStagger, '约束②：B4 页的交错**保留**（H 的签名）').toBeGreaterThan(0);
      // ③ 口径注必须写明「栏间位置不可直接互比」
      expect(m.note, '约束③：口径注写明两条独立轴、栏间不可比').toContain('两栏是两个独立轴');
      expect(m.note).toContain('栏间位置不可直接互比');
      // ④ 两张同族页靠「条 / 字段 meta / ap-sum 载荷」三样区分
      expect([m.spanBars > 0, m.spanMeta], 'B2 有跨度条、没有字段 meta').toEqual([true, 0]);
      expect([m.listBars, m.listMeta > 0], 'B4 有字段 meta、没有跨度条').toEqual([0, true]);
      expect(m.sumVariants, '两张页各有一个 ap-sum，载荷由页形决定').toEqual(['span', 'list']);
      expect(m.listSum, 'B4 的 ap-sum 载荷 = 项目完成度（与 B2 的跨度总天数分工）').toBe('项目完成度');
    } finally {
      await page.close();
    }
  });

  it('★ 条长 = 跨度% × 栏宽（两栏各测，像素级逐条对账；标签不许把条撑长）', async () => {
    const css = builtCss();
    // 夹具必须**含一条短跨度阶段**（2 天）/ 一条长跨度（整窗），否则「标签比条宽」
    // 这个最容易出错的分支根本没被触发（第一版用默认夹具时 9 条条全宽于标签 ⇒
    // 对账是空转，判据自证为「没测到」）。
    const shortStage: Stage = {
      ...makeStage(21, StageStatus.Delayed, '短跨度·现场复测'),
      startAt: '2026-01-20T00:00:00Z',
      endAt: '2026-01-21T23:59:59Z',
    };
    const vm = buildVm({ stages: [...STAGES, shortStage] });
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('h-blocks-color.html', shell(blocksMarkupOf(vm), css, false)));
      const m = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.ap-span-row')) as HTMLElement[];
        return rows.map((row) => {
          const bar = row.querySelector('.ap-span-row__bar') as HTMLElement;
          const tag = row.querySelector('.ap-block__tag') as HTMLElement;
          const track = row.querySelector('.ap-span-row__track') as HTMLElement;
          const col = row.closest('.ap-col') as HTMLElement;
          return {
            colIdx: Array.from(document.querySelectorAll('.ap-cols[data-gantt] .ap-col')).indexOf(col),
            barPx: +bar.getBoundingClientRect().width.toFixed(2),
            barH: +bar.getBoundingClientRect().height.toFixed(2),
            tagPx: +tag.getBoundingClientRect().width.toFixed(2),
            tagSameTop: Math.abs(tag.getBoundingClientRect().top - bar.getBoundingClientRect().top) < 0.5,
            trackW: +track.getBoundingClientRect().width.toFixed(2),
            width: Number.parseFloat(bar.getAttribute('data-span-width') ?? 'NaN'),
            days: Number.parseInt(bar.getAttribute('data-span-days') ?? '0', 10),
          };
        });
      });
      expect(m.length, '两栏加起来 = 全部阶段').toBeGreaterThan(0);
      expect(new Set(m.map((r) => r.colIdx)).size, '两栏都有条（左右各测）').toBe(2);
      for (const r of m) {
        expect(
          Math.abs(r.barPx - (r.width / 100) * r.trackW),
          `条长 = 跨度% × 栏宽（第 ${r.colIdx + 1} 栏，width=${r.width}%）`,
        ).toBeLessThanOrEqual(1.5);
        expect(r.barH, '条高 12px（实测值）').toBe(12);
        expect(r.tagSameTop, '标签与条同顶（内嵌不是另起一行）').toBe(true);
      }
      // 标签**溢出不改父盒宽度**：至少有一条标签比它的条宽（否则这条判据没被触发）
      expect(
        m.some((r) => r.tagPx > r.barPx + 1),
        '夹具里确实存在「标签比条宽」的行（否则对账是空转）',
      ).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('★ 块独立（严格一一对应）：关 B2 只少 span 页、关 B4 只少 list 页（L3 随它走）、两块都关只剩页壳', async () => {
    const css = builtCss();
    const vm = buildVm();
    const all = ALL();
    const noB2 = all.filter((id) => id !== 'timeline');
    const noB4 = all.filter((id) => id !== 'stageTable');
    const noBoth = all.filter((id) => id !== 'timeline' && id !== 'stageTable');
    expect(agentPosterBlockPages(vm, blocksOf(all)).map((p) => p.sub.kind), '默认 = span → list').toEqual([
      'span',
      'list',
    ]);
    expect(agentPosterBlockPages(vm, blocksOf(noB2)).map((p) => p.sub.kind), '关 B2 ⇒ 只剩 list').toEqual([
      'list',
    ]);
    expect(agentPosterBlockPages(vm, blocksOf(noB4)).map((p) => p.sub.kind), '关 B4 ⇒ 只剩 span').toEqual([
      'span',
    ]);
    expect(agentPosterBlockPages(vm, blocksOf(noBoth)).map((p) => p.sub.kind), '两块都关 ⇒ 一张页壳').toEqual([
      'shell',
    ]);

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const [tag, ids] of [
        ['no-b2', noB2],
        ['no-b4', noB4],
        ['no-both', noBoth],
      ] as const) {
        await page.goto(
          'file://' + writeHtml(`h-blocks-${tag}.html`, shell(blocksMarkupOf(vm, ids), css, false)),
        );
        const m = await page.evaluate(() => ({
          pages: document.querySelectorAll('.a4-page').length,
          forms: Array.from(document.querySelectorAll('.a4-page')).map((e) =>
            e.getAttribute('data-page-form'),
          ),
          bars: document.querySelectorAll('.ap-span-row__bar').length,
          band: document.querySelectorAll('.ap-span-band').length,
          blocks: document.querySelectorAll('.ap-block').length,
          resched: document.querySelectorAll('[data-print-resched]').length,
          // 原则 1/2：页壳件不许消失
          giant: document.querySelectorAll('.ap-footword').length,
          tab: document.querySelectorAll('.ap-head__tab').length,
          notes: document.querySelectorAll('.ap-notes__line').length,
        }));
        expect(m.pages, `${tag}：页数 = 装配层同源`).toBe(
          agentPosterBlockPages(vm, blocksOf(ids)).length,
        );
        if (tag === 'no-b2') {
          expect(m.bars, '关 B2 ⇒ 跨度条全没了').toBe(0);
          expect(m.band, '关 B2 ⇒ 覆盖带也没了（整块不出）').toBe(0);
          expect(m.blocks, '关 B2 不得动 B4').toBeGreaterThan(0);
        }
        if (tag === 'no-b4') {
          expect(m.blocks, '关 B4 ⇒ 状态块全没了').toBe(0);
          expect(m.resched, '关 B4 ⇒ L3 随它一起不出（§0.5）').toBe(0);
          expect(m.bars, '关 B4 不得动 B2').toBeGreaterThan(0);
        }
        if (tag === 'no-both') {
          expect([m.blocks, m.bars], '两块都关 ⇒ 主体没有内容块').toEqual([0, 0]);
        }
        // 页壳装置恒在（原则 1/2）
        expect(m.giant, '页底 IDPLAN 巨字恒在').toBe(m.pages);
        expect(m.tab, '页眉 SHEET 页序恒在').toBe(m.pages);
        // 口径句恒在：**每页至少一行**（B5 开着时还有第二行「数据来源」）
        expect(m.notes, '脚注口径句恒在（每页至少一行）').toBeGreaterThanOrEqual(m.pages);
      }
    } finally {
      await page.close();
    }
  });

  it('★ B1 meta 逐字段自查：项目名 / 排期基准 / 周期 / 打印日期 四段任何组合都不丢', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      // 管理员 + 有委托人 / 普通成员（VM 里 clientName 是 undefined）两种身份
      for (const [tag, role] of [
        ['admin', MemberRoleKind.Admin],
        ['member', MemberRoleKind.Member],
      ] as const) {
        const vm = buildVm({ role, currentMemberId: HUMAN.id });
        await page.goto(
          'file://' + writeHtml(`h-blocks-meta-${tag}.html`, shell(blocksMarkupOf(vm), css, false)),
        );
        const metas = await page.$$eval('.ap-head__meta', (els) => els.map((e) => e.textContent ?? ''));
        expect(metas.length, `${tag}：每页都有 meta 行`).toBeGreaterThan(0);
        for (const text of metas) {
          expect(text, `${tag}：项目名（原则 1）`).toContain(vm.project.name);
          expect(text, `${tag}：排期基准`).toContain('排期基准');
          expect(text, `${tag}：周期起点`).toContain(vm.project.plannedStartAt);
          expect(text, `${tag}：周期终点`).toContain(vm.project.plannedEndAt);
          expect(text, `${tag}：打印日期`).toContain(vm.generatedAt.slice(0, 10));
        }
      }
    } finally {
      await page.close();
    }
  });

  it('★ L3 与 ap-sum 载荷的正面锁：带 StageLog ⇒ 改期记录一定上纸；L3 在 B4 收口页', async () => {
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      // ── ① 无改期记录 ⇒ L3 整段不出（§0.5 空态纪律：不出孤单表头）──
      const vmNoLog = buildVm();
      await page.goto(
        'file://' + writeHtml('h-blocks-nolog.html', shell(blocksMarkupOf(vmNoLog), css, false)),
      );
      const noLog = await page.evaluate(() => ({
        resched: document.querySelectorAll('[data-print-resched]').length,
        sum: document.querySelectorAll('.ap-sum').length,
        pages: document.querySelectorAll('.a4-page').length,
        labels: Array.from(document.querySelectorAll('.ap-sum__label')).map((e) => e.textContent ?? ''),
      }));
      expect(noLog.resched, '无改期记录 ⇒ L3 整段不出').toBe(0);
      expect(noLog.sum, 'ap-sum 装置每页都在（装置本体永不消失，§2.6 原则 2）').toBe(noLog.pages);
      expect(
        noLog.labels.sort(),
        'ap-sum 的两个载荷分工都在（B2 跨度总天数 / B4 项目完成度）',
      ).toEqual(['项目完成度', '跨度总天数'].sort());

      // ── ② 带一条改期记录 ⇒ L3 **必须**上纸（正面锁）──
      const vmLog = buildVm({ stageLogs: RESCHED_LOGS as never });
      await page.goto(
        'file://' + writeHtml('h-blocks-log.html', shell(blocksMarkupOf(vmLog), css, false)),
      );
      const withLog = await page.evaluate(() => {
        const l3 = document.querySelector('[data-print-resched]') as HTMLElement | null;
        const rowsHost = l3?.closest('.a4-page') as HTMLElement | null;
        return {
          count: document.querySelectorAll('[data-print-resched]').length,
          rows: document.querySelectorAll('.ap-l3__row').length,
          title: document.querySelector('.ap-l3__title')?.textContent ?? '',
          foot: document.querySelector('.ap-l3__foot')?.textContent ?? '',
          meta: document.querySelector('.ap-l3__meta')?.textContent ?? '',
          form: rowsHost?.getAttribute('data-page-form'),
          // L3 只挂 B4 的**收口页**（§0.5：B4 的末尾）
          isLastList: (() => {
            const lists = Array.from(document.querySelectorAll('.a4-page[data-page-form="list"]'));
            return lists.length > 0 && rowsHost === lists[lists.length - 1];
          })(),
        };
      });
      expect(withLog.count, '带改期记录 ⇒ L3 上纸（正面锁）').toBe(1);
      expect(withLog.rows, 'L3 有 1 条明细').toBe(1);
      expect(withLog.title).toBe('改期记录');
      expect(withLog.foot).toBe('共 1 条');
      expect(withLog.meta, 'L3 行含「旧结束日 → 新结束日 · 原因」').toContain('2026-02-02');
      expect(withLog.meta).toContain('2026-02-09');
      expect(withLog.meta).toContain('等客户确认主材样品');
      expect(withLog.form, 'L3 挂在 B4 页上').toBe('list');
      expect(withLog.isLastList, 'L3 挂 B4 的**收口页**（§0.5）').toBe(true);
    } finally {
      await page.close();
    }
  });

  it('★ B5 不可摘（裁决第 1 条）：显式关掉也**恒开**（脚注 + 页码 + 巨字都在）；B3 关掉时口径句锚回', async () => {
    const css = builtCss();
    const vm = buildVm();
    const all = ALL();
    const noB5 = all.filter((id) => id !== 'footer');
    const noB3 = all.filter((id) => id !== 'projectInfo');
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('h-blocks-color.html', shell(blocksMarkupOf(vm, all), css, false)));
      const on = await page.evaluate(() => ({
        hasSource: (document.body.textContent ?? '').includes('数据来源'),
        scope: document.querySelectorAll('.ap-scope').length,
        legend: document.querySelectorAll('.ap-legend').length,
      }));
      expect(on.hasSource, 'B5 开着 ⇒ 脚注有数据来源行').toBe(true);
      expect(on.scope, 'B3 开着 ⇒ 首页有 mono 平铺口径行').toBe(1);
      expect(on.legend, 'B3 开着 ⇒ 首页有图例').toBe(1);

      // ── 裁决第 1 条：B5 = 丙（不可摘）⇒ 显式从勾选集里拿掉，纸面也**一行不少** ──
      // 判据手法同 A 的「B1 恒开」：`resolveUnits` 对 forced 单元恒开、source='forced'
      // （H 的 B5 若做成可勾，会承诺一个它兑不了的效果 —— 页底巨字与页眉页码按
      // 原则 1 永在，勾选框却说自己能关掉这一块）。
      await page.goto('file://' + writeHtml('h-blocks-no-b5.html', shell(blocksMarkupOf(vm, noB5), css, false)));
      const off5 = await page.evaluate(() => ({
        hasSource: (document.body.textContent ?? '').includes('数据来源'),
        notes: document.querySelectorAll('.ap-notes__line').length,
        giants: document.querySelectorAll('.ap-footword').length,
        tabs: Array.from(document.querySelectorAll('.ap-head__tab')).map((e) => e.textContent ?? ''),
        pages: document.querySelectorAll('.a4-page').length,
        forms: Array.from(document.querySelectorAll('.a4-page')).map((e) => e.getAttribute('data-page-form')),
      }));
      expect(off5.hasSource, 'B5 不可摘：显式关掉 → 数据来源行照旧在（恒开）').toBe(true);
      expect(off5.notes, '脚注两行都在').toBe(off5.pages * 2);
      expect(off5.giants, '页底 IDPLAN 巨字在（装置）').toBe(off5.pages);
      expect(off5.tabs.every((t) => t.includes('SHEET')), '页眉页序在（原则 1）').toBe(true);
      // 与「全开」逐页形同构（拿掉 footer 不该改变任何一页的形态）
      expect(off5.forms, 'B5 恒开 ⇒ 页形序列与全开一致').toEqual(['span', 'list']);

      // ── B3 = 乙：承载区整块不出，**口径句锚回**（原则 1） ──
      await page.goto('file://' + writeHtml('h-blocks-no-b3.html', shell(blocksMarkupOf(vm, noB3), css, false)));
      const off3 = await page.evaluate(() => ({
        scope: document.querySelectorAll('.ap-scope').length,
        legend: document.querySelectorAll('.ap-legend').length,
        notes: document.querySelectorAll('.ap-notes__line').length,
        pages: document.querySelectorAll('.a4-page').length,
      }));
      expect([off3.scope, off3.legend], '关 B3 ⇒ 承载区（口径行 + 图例）整块不出').toEqual([0, 0]);
      expect(off3.notes, '关 B3 ⇒ 口径句锚回脚注（每页两行，含数据来源）').toBe(off3.pages * 2);
    } finally {
      await page.close();
    }
  });

  it('★★ 条/标签混合规则：条够长才内嵌；条太短 ⇒ 标签外移 + 纸缝 ≥2px（不许同色无间断相连）', async () => {
    /*
     * 批 D 裁决第 4 条。为什么这不是观感问题：条与标签**同色** ⇒ 12px 的条 +
     * 52.3px 的内嵌标签，合并图形读出来是**52px 的跨度** —— **会印错事实**。
     * 规则：`barPx ≥ tagPx` 内嵌（标签完全落在条内 ⇒ 并集 == 条）；否则外移
     * （右外侧优先、右侧放不下则左外侧）+ **2px 纸缝**。
     */
    const css = builtCss();
    /** 2 天阶段：barPx ≈ 10px ≪ tagPx ≈ 54px ⇒ 必走外移档 */
    const twoDayStage: Stage = {
      ...makeStage(21, StageStatus.Delayed, '短跨度·两日复测'),
      startAt: '2026-01-20T00:00:00Z',
      endAt: '2026-01-21T23:59:59Z',
    };
    const vm = buildVm({ stages: [...STAGES, twoDayStage] });
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('h-blocks-tagplace.html', shell(blocksMarkupOf(vm), css, false)));
      const m = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.ap-span-row')) as HTMLElement[];
        return rows.map((row) => {
          const bar = row.querySelector('.ap-span-row__bar') as HTMLElement;
          const tag = row.querySelector('.ap-block__tag') as HTMLElement;
          const track = row.querySelector('.ap-span-row__track') as HTMLElement;
          const b = bar.getBoundingClientRect();
          const t = tag.getBoundingClientRect();
          return {
            no: row.getAttribute('data-testid'),
            place: tag.getAttribute('data-tag-place'),
            barPx: +b.width.toFixed(2),
            tagPx: +t.width.toFixed(2),
            /** 两者的水平重叠长度（>0 = 同色图形相连） */
            overlap: +Math.max(0, Math.min(b.right, t.right) - Math.max(b.left, t.left)).toFixed(2),
            gapRight: +(t.left - b.right).toFixed(2),
            gapLeft: +(b.left - t.right).toFixed(2),
            tagRight: +t.right.toFixed(2),
            trackRight: +track.getBoundingClientRect().right.toFixed(2),
            /** 标签越出条之外的墨迹长度（内嵌档必须为 0 —— 那才是「印错事实」的根因） */
            inkBeyondBar:
              tag.getAttribute('data-tag-place') === 'in'
                ? +Math.max(0, t.right - b.right).toFixed(2)
                : 0,
          };
        });
      });
      expect(m.length, '每阶段一行').toBeGreaterThan(1);

      /*
       * 逐行判据**放在「两档都出现」的前置检查之前** —— 顺序有意：
       * 前置检查是防「判据空转」的哨兵（夹具全落一档就没测到），而逐行判据是
       * **核心不变量**。若先跑哨兵，「永远内嵌」这种突变会先撞哨兵、核心判据
       * 根本不执行 —— 那自证就只能证明哨兵有效，证明不了不变量有效（踩过一次）。
       */
      for (const r of m) {
        // ★ 合取判据：**任何阶段下标签与条不得同色无间断相连**
        expect(
          r.inkBeyondBar,
          `${r.no}（${r.place}）：标签墨迹不得越出条之外（越出 = 合并图形比条长）`,
        ).toBe(0);
        if (r.place === 'in') {
          expect(r.barPx, `${r.no}：内嵌档的充要条件是 barPx ≥ tagPx`).toBeGreaterThanOrEqual(
            r.tagPx - 0.5,
          );
          expect(r.overlap, `${r.no}：内嵌档允许重叠（标签在条内）`).toBeGreaterThan(0);
        } else {
          expect(r.overlap, `${r.no}（${r.place}）：外移档不许与条水平重叠`).toBe(0);
          const gap = r.place === 'out-right' ? r.gapRight : r.gapLeft;
          expect(gap, `${r.no}（${r.place}）：纸缝 ≥2px（实测 ${gap}）`).toBeGreaterThanOrEqual(1.9);
          if (r.place === 'out-right') {
            expect(r.tagRight, `${r.no}：外移的标签不许越出本栏`).toBeLessThanOrEqual(
              r.trackRight + 1,
            );
          }
        }
      }

      // 哨兵（防判据空转 —— 上一版夹具全落内嵌档，自证「没测到」）
      expect(
        new Set(m.map((r) => r.place)).size,
        `夹具须同时覆盖内嵌与外移两档（实测档位：${[...new Set(m.map((r) => r.place))].join(' / ')}）`,
      ).toBeGreaterThanOrEqual(2);
      // 2 天阶段那行：必然外移（10px 的条放不下 54px 的标签）
      const tiny = m.find((r) => r.no === 'ap-span-row-21');
      expect(tiny, '2 天阶段那行应在').toBeDefined();
      expect(tiny!.place, '2 天阶段（≈10px 的条）必走外移档').not.toBe('in');
      expect(tiny!.barPx, '外移档的条本身**不许被标签撑长**').toBeLessThan(tiny!.tagPx);
      // 截图留档：2 天阶段那一行 + B2 整页
      await (await page.$('[data-testid="ap-span-row-21"]'))!.screenshot({
        path: join(OUT_DIR, 'd-h-bar-tag-outer-row.png'),
      });
      await (await page.$('.a4-page[data-page-form="span"]'))!.screenshot({
        path: join(OUT_DIR, 'd-h-bar-tag-outer-page.png'),
      });
    } finally {
      await page.close();
    }
  });

  it('★ 页数表（1/2/4/5/8/9/10/14/16/20/30/40 阶段）：预计 = 实际、逐页 ≤1123、页数单调不减', async () => {
    const css = builtCss();
    const ns = [1, 2, 4, 5, 8, 9, 10, 11, 12, 13, 14, 16, 20, 30, 40];
    const vmOf = (n: number) => buildVm({ stages: stagesN(n) });
    const planned = ns.map(
      (n) => agentPosterBlockPages(vmOf(n), DEFAULT_SCHEDULE_PAPER_BLOCKS).length,
    );
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i]!;
        await page.goto(
          'file://' + writeHtml(`h-blocks-${n}.html`, shell(blocksMarkupOf(vmOf(n)), css, false)),
        );
        const geo = await pageGeometry(page);
        expect(geo.length, `${n} 阶段：预计页数 = 实际出纸`).toBe(planned[i]!);
        for (const g of geo) expect(g.h, `${n} 阶段：逐页溢出即红`).toBeLessThanOrEqual(1124);
        if (n === 20) {
          const els = await page.$$('.a4-page');
          for (let k = 0; k < els.length; k++) {
            await els[k]!.screenshot({ path: join(OUT_DIR, `density-h-many-p${k + 1}.png`) });
          }
        }
      }
      for (let i = 1; i < planned.length; i++) {
        expect(planned[i]!, `页数单调不减（${ns[i - 1]} → ${ns[i]}）`).toBeGreaterThanOrEqual(
          planned[i - 1]!,
        );
      }
      // 实测页数表（回填到 `agent-poster/shared.ts` 的常量注释；控制台留档供复核）
      console.log(
        '\n[H 五块实测页数表] ' +
          ns.map((n, i) => `${n}→${planned[i]}`).join(' | '),
      );
    } finally {
      await page.close();
    }
  });

  /**
   * ★★ 月份刻度不得叠字 —— **跨 5 个月**的真实跨度（`lead`→`tail` 跃迁的判据盲区）。
   *
   * ── 这条用例存在的理由（是补盲区，不是补一条好看的）──
   * 本文件既有夹具的 stage 全落在 2026-01 内 ⇒ 栏内轴只有 1–2 枚月份刻度 ⇒
   * `layoutTicks` 里「末尾那枚贴右缘 ⇒ 切 `tail` 档」这条路径**从来没被走到过**。
   * 而 `tail` 档的含义是**整枚标签左移自身宽度**（右对齐于刻度）——它与**上一枚
   * `lead` 档**标签的右缘是否相交，旧实现根本没查（`pruneTicks` 只比刻度位置）。
   * 真实后果（2026-10-13 实测，跨度 2026-08-03 → 2026-12-17）：栏内标尺上
   * 「2026年11月」盒 [224,280] 与「2026年12月」盒 [242,298] 相交 ⇒ 渲染成
   * 一团「2026年2?年12月」。
   *
   * 跨月项目是**常态**（本文件那个只跨 1 月的夹具才是特例）⇒ 这不是边角，
   * 用户点「载入示例项目」就会撞到。故夹具必须覆盖真实跨度，断言必须落在
   * **标签盒**（不是刻度位置）上。
   */
  it('★★ 月份刻度不叠字：跨 5 个月的真实跨度（末枚切 tail 档那一次）', async () => {
    const css = builtCss();
    /** 8 个阶段首尾相接铺满 2026-08-03 → 2026-12-17（= 跨 5 个月的常态跨度） */
    const LONG_SPANS: ReadonlyArray<readonly [string, string]> = [
      ['2026-08-03', '2026-08-19'],
      ['2026-08-20', '2026-09-05'],
      ['2026-09-06', '2026-09-22'],
      ['2026-09-23', '2026-10-09'],
      ['2026-10-10', '2026-10-26'],
      ['2026-10-27', '2026-11-12'],
      ['2026-11-13', '2026-11-30'],
      ['2026-12-01', '2026-12-17'],
    ];
    const longStages: Stage[] = LONG_SPANS.map(([startAt, endAt], i) => ({
      ...makeStage(i + 1, StageStatus.NotStarted, `阶段${i + 1}`),
      startAt,
      endAt,
    }));
    const vm = buildVm({
      project: { ...PROJECT, plannedStartAt: '2026-08-03', plannedEndAt: '2026-12-17' },
      stages: longStages,
      tasks: [],
    });

    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      await page.goto(
        'file://' +
          writeHtml('h-blocks-month-ticks-long.html', shell(blocksMarkupOf(vm), css, false)),
      );

      /*
       * 按**轴容器**分组量：月份刻度在三处各有一份（① 通栏覆盖带 1 条 + 栏内标尺 2 条）。
       * 必须分组比 —— 跨容器比会拿「带上的 12 月」去撞「左栏的 9 月」，那是假阳性。
       */
      const axes = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.ap-span-band__axis, .ap-col__ruler-axis')).map((host) =>
          Array.from(host.querySelectorAll('[data-print-month-tick]')).map((el) => {
            const r = el.getBoundingClientRect();
            return {
              label: (el.textContent ?? '').trim(),
              left: +r.left.toFixed(2),
              right: +r.right.toFixed(2),
              align: (el as HTMLElement).dataset.tickAlign ?? '',
              track: +((el.closest('.ap-span-band__axis, .ap-col__ruler-axis') as HTMLElement)
                .getBoundingClientRect().width).toFixed(2),
            };
          }),
        ),
      );
      console.log(
        '[H 月份刻度实测] ' +
          axes
            .map(
              (ticks, i) =>
                `轴${i + 1}(w=${ticks[0]?.track ?? 0}): ` +
                ticks.map((t) => `${t.label}[${t.left},${t.right}]/${t.align}`).join(' '),
            )
            .join('\n                 '),
      );

      // 轴容器共 4 条：通栏覆盖带 ×2（span 页 + list 页各一条）+ 栏内标尺 ×2（左右栏）
      expect(axes.length, '纸面应有 4 条轴：通栏覆盖带 ×2（span/list 页）+ 栏内标尺 ×2').toBe(4);

      /*
       * 反假绿：本夹具**必须真的走到 `tail` 档**。
       * 没有这一条，将来有人把夹具换回 1 月内（只有 1–2 枚刻度、一枚都不落 tail），
       * 下面的「不叠字」会在**根本没覆盖该路径**的情况下继续绿 —— 那正是本次要堵的洞。
       */
      const tails = axes.flat().filter((t) => t.align === 'tail');
      expect(
        tails.length,
        '夹具必须走到 lead→tail 跃迁（否则本用例空转）：至少一枚刻度落 tail 档',
      ).toBeGreaterThan(0);
      expect(
        axes.flat().length,
        '夹具必须是多枚刻度（跨 5 个月 ⇒ 5 枚月份刻度 × 3 条轴，去重后 ≥8）',
      ).toBeGreaterThanOrEqual(8);

      // 判据本体：同一条轴内，相邻两枚**标签盒**不得相交
      for (let i = 0; i < axes.length; i++) {
        const ticks = axes[i]!;
        for (let k = 1; k < ticks.length; k++) {
          const a = ticks[k - 1]!;
          const b = ticks[k]!;
          expect(
            a.right <= b.left + 0.5,
            `轴${i + 1} 相邻刻度标签不得叠字：` +
              `「${a.label}」右缘 ${a.right}（${a.align}）越过了「${b.label}」左缘 ${b.left}（${b.align}）`,
          ).toBe(true);
        }
      }

      await (await page.$('.a4-page'))!.screenshot({
        path: join(OUT_DIR, 'h-blocks-month-ticks-long.png'),
      });
    } finally {
      await page.close();
    }
  });
});
