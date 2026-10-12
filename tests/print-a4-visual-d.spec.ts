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
 * ⚠️ 构建产物残留（2026-10-11 已治本，此处保留来龙去脉）：`vite.config.ts` 是
 * `emptyOutDir: false`（沙箱环境的删除 shim 会 ETIMEDOUT，见那里的注释），
 * 所以上一轮的哈希 CSS 会留在 `build-dist/assets/` 里。历史上 `builtCss()` 是
 * 「assets 下所有 .css 拼起来」，旧文件排在后面时会把同一选择器的规则覆盖回旧值
 * （实测踩到：compact 轨道被旧文件的 6px 规则盖掉；E 版巨字 92→79px 静默全绿）。
 * 现在 `builtCss()` 收敛到 `tests/helpers/built-css.ts`：**只读 index.html 引用的
 * 那几份**，并对残留 CSS loud fail。故不再要求跑前手工 `rm -rf build-dist`。
 *
 * ── 2026-10-11 P0-7~P0-11（批次 5 · D 骨架重做）后的断言迁移 ──
 * `.de-matrix__date` / `.de-matrix thead th` / `.de-stats`（页头 4 宫格 KPI 带）
 * 这些选择器**已按参考稿移除**（审计 §1.2「现状有、参考没有的块」），相关断言
 * 改为新语义：行首 [号码+阶段名]/[日期·占比] 不溢出 + 通栏条 682×32 + 节距 90
 * + `<table>` 不存在 + 页尾完成度横带 + 单行口径注。
 * 分页容量随之重算：normal 容量 9（= 参考稿 P1 行数）、紧凑档容量 16，切档点 9。
 *
 * 产物落点：`outputs/print-a4-shots/`（工作区交付目录，不进 git）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';

import { DataEditorialDocument, deBlockPages, DE_BLOCK_COMPACT_AT } from '../src/print/documents/DataEditorialDocument';
import { deMatrixColumns, deMatrixColumnUnit } from '../src/print/pages/data-editorial/matrix';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { planMatrixPages } from '../src/print/pages/data-editorial/shared';
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
import type { PrintStageVM } from '../src/print/model/print-view-model';
import type { PrintSheet } from '../src/components/print/print-templates';
import { DEFAULT_SCHEDULE_PAPER_BLOCKS } from '../src/lib/schedule-print';
import {
  blockRecordOf,
  printTemplateUnitIds,
  resolveUnits,
} from '../src/print/model/print-units';
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

/**
 * legacy 原生页清单（期三的 sheets 形状）。
 * 2026-10-13 批 B 起 D 走**五块形态**（`usesBlocks`）；原来的四页与通用模块渲染
 * **代码与 spec 全留**（决策 2），只是不再有暴露面 —— 本 spec 里凡是要验「原生页
 * 那套版式」的用例，都显式传它，走 legacy 路径（与 UI 真实路径区分开）。
 */
const NATIVE_SHEETS: readonly PrintSheet[] = [
  { type: 'native', page: 'progress-matrix' },
  { type: 'native', page: 'dependency-network' },
  { type: 'native', page: 'workload-composition' },
  { type: 'native', page: 'milestone-acceptance' },
];

/** 拼接全部构建产物 CSS（D 版样式 + 亮色锁 + 主题令牌都在里面） */
function builtCss(): string {
  return readBuiltCss(ROOT);
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

  it('D 版默认态 = 五块形态：预计页数 = 实际出纸，逐页 794×1123 无裁切；legacy 四页仍可复现', async () => {
    /*
     * 2026-10-13 批 B（决策 1/6）：D 的默认输出从「4 个原生签名页」改为**五块形态**
     * （B1 打印头部 / B2 日期格矩阵 / B3 项目信息 / B4 两段式清单 / B5 页脚）。
     * 原「4 页 + 第一页 = 进度矩阵」的断言不是被删掉，而是**分成两半**：
     *   · 本用例前半 = 五块形态（页数由 `deBlockPages` 给出，逐页无裁切）；
     *   · 本用例后半 = 显式 `NATIVE_SHEETS` 复现 legacy 四页（第一页仍是进度矩阵）
     *     ——「代码与 spec 全留」的直接证据。
     */
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['data-editorial'].baseline;
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, { vm, palette: baseline }),
    );
    const expectedPages = deBlockPages(vm, DEFAULT_SCHEDULE_PAPER_BLOCKS).length;

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const gray of [false, true]) {
        const htmlPath = writeHtml(
          gray ? 'd-default-gray.html' : 'd-default-color.html',
          shell(markup, css, gray),
        );
        await page.goto('file://' + htmlPath);
        const pages = await page.$$('.a4-page');
        expect(pages, `五块形态应渲染 ${expectedPages} 页（装配层同源）`).toHaveLength(expectedPages);
        expect(
          await pages[0]!.getAttribute('data-print-page'),
          '五块形态的纸面标识',
        ).toBe('blocks');
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

      // ── 后半：legacy 四页仍可复现（决策 2「代码与 spec 全留」的证据）──
      const legacyMarkup = renderToStaticMarkup(
        createElement(DataEditorialDocument, { vm, palette: baseline, sheets: NATIVE_SHEETS }),
      );
      await page.goto('file://' + writeHtml('d-legacy-four.html', shell(legacyMarkup, css, false)));
      const legacyPages = await page.$$('.a4-page');
      expect(legacyPages, 'legacy 四原生页仍可渲染（显式 sheets）').toHaveLength(4);
      expect(
        await legacyPages[0]!.getAttribute('data-print-page'),
        'legacy 第一页仍是进度矩阵',
      ).toBe('progress-matrix');
    } finally {
      await page.close();
    }
  });

  it('D 版矩阵骨架（P0-7，legacy 原生页）：行首 [号码+阶段名]/[日期·占比] 不溢出、通栏条 682×32、节距 90、<table> 不存在', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['data-editorial'].baseline;
    // 批 B：本用例验的是**原生页那套版式**（P0-7 骨架）⇒ 显式走 legacy sheets
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, { vm, palette: baseline, sheets: NATIVE_SHEETS }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('d-default-color.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const p1 = await page.$('[data-print-page="progress-matrix"]');
      expect(p1, 'P1 阶段进度矩阵页应在').not.toBeNull();

      // ① 骨架：本页不得再有 <table>（P0-7 验收判据「<table> 元素不存在」）；
      //    P3 的构成表不在这页，故整页断言即可。
      const tableCount = await p1!.$$eval('table', (els) => els.length);
      expect(tableCount, '进度矩阵页不得再有 <table>（6 列表格已重做为两段式）').toBe(0);

      // ② 行首右侧 [日期 · 占比]：9 个可见阶段各一条，且不被截断
      const metas = await p1!.$$eval('.de-row__meta', (els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          const row = el.closest('.de-row')!.getBoundingClientRect();
          return {
            text: el.textContent ?? '',
            // nowrap + 无省略 ⇒ 文字宽必须 ≤ 自身盒宽（盒宽即文字宽，除非被压缩）
            overflow: el.scrollWidth - el.clientWidth,
            rightGap: +(row.right - r.right).toFixed(1),
          };
        }),
      );
      expect(metas, '9 个可见阶段行各一条 [日期 · 占比]').toHaveLength(9);
      for (const m of metas) {
        expect(m.overflow, `[日期 · 占比] 被截断：「${m.text}」`).toBeLessThanOrEqual(1);
        expect(m.text, '日期 · 占比 形态').toMatch(/^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2} · \d+%$/);
      }
      // 行首两段贴相同一侧边缘（左 = 号码左缘，右 = 占比右缘）⇒ 右段贴行块右缘 0px
      for (const m of metas) expect(m.rightGap, '右段应贴行块右缘').toBeLessThanOrEqual(1);

      // ③ 阶段名单行省略在自家盒内（不越出行块）
      const nameCollision = await p1!.$$eval('.de-row__name', (names) =>
        names.filter((n) => {
          const row = n.closest('.de-row')!.getBoundingClientRect();
          return n.getBoundingClientRect().right > row.right + 0.5;
        }).length,
      );
      expect(nameCollision, '阶段名不得越出行块（截断在盒内）').toBe(0);

      // ④ 通栏条几何：682×32（参考稿实测），起点比内容框再内缩 16px
      const bar = await p1!.$$eval('.de-bar__track', (els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          const row = el.closest('.de-row')!.getBoundingClientRect();
          return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), left: +(r.left - row.left).toFixed(1) };
        }),
      );
      expect(bar, '9 条通栏轨道').toHaveLength(9);
      for (const b of bar) {
        expect(b.w, '条宽应 682（≥670）').toBeGreaterThanOrEqual(670);
        expect(b.h, '条高应恰 32px').toBe(32);
        expect(b.left, '条与行块同左缘').toBeLessThanOrEqual(0.5);
      }

      // ⑤ 行节距 90px ±6（参考稿实测节距）
      const tops = await p1!.$$eval('.de-row', (els) =>
        els.map((el) => +el.getBoundingClientRect().top.toFixed(1)),
      );
      for (let i = 1; i < tops.length; i++) {
        const pitch = tops[i]! - tops[i - 1]!;
        expect(Math.abs(pitch - 90), `第 ${i + 1} 行节距应 90±6（实测 ${pitch}）`).toBeLessThanOrEqual(6);
      }

      // ⑥ P0-11 最小填充宽：所有填充 ≥96px（0%/小比例也留可见底桩），且不超轨道
      const fills = await p1!.$$eval('.de-bar__fill', (els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            w: +r.width.toFixed(1),
            track: +el.closest('.de-bar__track')!.getBoundingClientRect().width.toFixed(1),
            tone: el.getAttribute('data-fill'),
          };
        }),
      );
      expect(fills, '9 条填充').toHaveLength(9);
      for (const f of fills) {
        expect(f.w, '最小填充宽 ≈96px（P0-11）').toBeGreaterThanOrEqual(96 - 2);
        expect(f.w, '填充不得超轨道').toBeLessThanOrEqual(f.track + 0.5);
        expect(['ink', 'signal', 'idle'], '填充分四档').toContain(f.tone);
      }

      // ⑦ P0-10 橙红用量回到「图形重点」量级：进行中/延期阶段的条是橙红，
      //    轨道一律 #E5E5E5（现状列内条用的是 #F5F5F5，审计 §1.2③）
      const trackColors = await p1!.$$eval('.de-bar__track', (els) =>
        els.map((el) => getComputedStyle(el).backgroundColor),
      );
      for (const c of trackColors) expect(c, '轨道应 #E5E5E5').toBe('rgb(229, 229, 229)');
      const signalFills = await p1!.$$eval(
        '.de-bar__fill[data-fill="signal"]',
        (els) => els.map((el) => getComputedStyle(el).backgroundColor),
      );
      expect(signalFills.length, '夹具含进行中阶段 ⇒ 至少一条信号色填充').toBeGreaterThan(0);
      for (const c of signalFills) expect(c, '进行中/延期条的填充 = 信号橙红 #EF4B23').toBe('rgb(239, 75, 35)');
    } finally {
      await page.close();
    }
  });

  it('D 矩阵分页（30 阶段 · legacy 原生页）：2 页 16+14、续表头只第 2 页、页尾横带每页都有、页码联动、无溢出', async () => {
    const css = builtCss();
    // 长 VM：9 个可见夹具阶段轮值扩到 30 个（隐藏夹具阶段不进来）
    const stages: Stage[] = Array.from({ length: 30 }, (_, i) => {
      const tpl = STAGES[i % 9]!;
      return {
        ...tpl,
        id: `stg_d4_l_${i + 1}`,
        orderIndex: i + 1,
        name: `阶段${i + 1}·${i % 2 === 0 ? '方案深化' : '现场勘查'}`,
      };
    });
    const tasks: Task[] = stages.map((s, i) => ({
      ...TASKS[i % TASKS.length]!,
      id: `tsk_d4_l_${i + 1}`,
      stageId: s.id,
      taskNo: 3000 + i + 1,
    }));
    const vm = buildPrintViewModel({
      project: PROJECT,
      stages,
      tasks,
      members: [HUMAN, AGENT],
      stageLogs: LOGS,
      role: MemberRoleKind.Admin,
      currentMemberId: HUMAN.id,
      todayIso: TODAY,
      now: new Date('2026-10-09T07:30:00Z'),
    });
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, {
        vm,
        sheets: [{ type: 'native', page: 'progress-matrix' }],
        palette: PRINT_TEMPLATE_PALETTES['data-editorial'].baseline,
      }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      const htmlPath = writeHtml('d-matrix-pagination-30.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const pages = await page.$$('.a4-page');
      // 30 阶段走紧凑档（>9），容量 16 ⇒ 16 + 14
      expect(pages.length, '30 阶段应拆 2 页（16+14）').toBe(2);

      let totalRows = 0;
      const perPage: number[] = [];
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(Math.abs(box!.width - 794), `第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
        expect(box!.height, `第 ${i + 1} 页溢出即红（修复前 30 阶段单页 1615px）`).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({
          path: join(OUT_DIR, `d-matrix-pagination-30-after-p${i + 1}-color.png`),
        });
        const rows = await pages[i]!.$$eval('.de-row', (els) => els.length);
        perPage.push(rows);
        totalRows += rows;
        // 每页自解释（01 §2）：页尾完成度横带 + 单行口径注 齐全（续表也有）
        expect(await pages[i]!.$('.de-band'), `第 ${i + 1} 页页尾完成度横带`).not.toBeNull();
        expect(await pages[i]!.$('.de-foot__note'), `第 ${i + 1} 页口径注`).not.toBeNull();
        const noteRects = await pages[i]!.$eval('.de-foot__note', (el) => el.getClientRects().length);
        expect(noteRects, `第 ${i + 1} 页口径注应为单行（P0-9 ②/P1-5）`).toBe(1);
        // 页码联动：第 i / 2 页
        const text = (await pages[i]!.textContent()) ?? '';
        expect(text, `第 ${i + 1} 页页码`).toContain(`第 ${i + 1} / 2 页`);
      }
      expect(perPage, '分页容量：紧凑档 16 + 续表 14').toEqual([16, 14]);
      expect(totalRows, '30 行全部上纸（行不裂）').toBe(30);

      // ④ 紧凑档几何与估高**同源**（CSS 节距 49 / 条高 20 ↔ MATRIX_EST.rowCompact），
      //    且行区不得压到页尾横带上（估高偏小的唯一表现形态）
      const compact = await pages[0]!.$$eval('.de-row', (els) => {
        const pageRect = els[0]!.closest('.a4-page')!.getBoundingClientRect();
        const band = els[0]!.closest('.de-board')!.querySelector('.de-band')!.getBoundingClientRect();
        return {
          tops: els.map((el) => +el.getBoundingClientRect().top.toFixed(1)),
          tracks: els.map((el) => +el.querySelector('.de-bar__track')!.getBoundingClientRect().height.toFixed(1)),
          lastBottom: +(els[els.length - 1]!.getBoundingClientRect().bottom - pageRect.top).toFixed(1),
          bandTop: +(band.top - pageRect.top).toFixed(1),
        };
      });
      for (let i = 1; i < compact.tops.length; i++) {
        const pitch = compact.tops[i]! - compact.tops[i - 1]!;
        expect(Math.abs(pitch - 49), `紧凑档行节距应 49±5（实测 ${pitch}）`).toBeLessThanOrEqual(5);
      }
      for (const h of compact.tracks) expect(h, '紧凑档条高应 20px').toBe(20);
      expect(
        compact.lastBottom,
        `紧凑档 16 行的末行底 ${compact.lastBottom} 不得越过页尾横带顶 ${compact.bandTop}（估高偏小即红）`,
      ).toBeLessThanOrEqual(compact.bandTop + 0.5);

      // ① 页头 4 宫格 KPI 带已整块移除（审计 §1.2「现状有、参考没有的块」）
      expect(await page.$('.de-stats'), 'KPI 摘要带不得再出现（P0-7 删块）').toBeNull();
      // ② 续表模块头：仅第二页有，带「（续）」与部分序号
      expect(await pages[0]!.$('.de-matrix__cont'), '第一页不得有续表头').toBeNull();
      const cont = await pages[1]!.$('.de-matrix__cont');
      expect(cont, '第二页应有续表模块头').not.toBeNull();
      const contText = (await pages[1]!.textContent()) ?? '';
      expect(contText, '续表头带「（续）」标识').toContain('阶段进度矩阵（续）');
      expect(contText, '续表头带部分序号').toContain('第 2 / 2 部分');
      // ③ 结构标记不断：3px 页头线两页都在，且内缩 40px（P0-9 ①）
      for (let i = 0; i < pages.length; i++) {
        const rule = await pages[i]!.$eval('.de-head__rule', (el) => {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const pageRect = el.closest('.a4-page')!.getBoundingClientRect();
          return {
            h: s.height,
            bg: s.backgroundColor,
            left: +(r.left - pageRect.left).toFixed(1),
            right: +(pageRect.right - r.right).toFixed(1),
          };
        });
        expect(rule.h, `第 ${i + 1} 页 3px 头线`).toBe('3px');
        expect(rule.bg, `第 ${i + 1} 页头线近黑`).toBe('rgb(10, 10, 10)');
        expect(rule.left, `第 ${i + 1} 页头线左内缩 40px`).toBe(40);
        expect(rule.right, `第 ${i + 1} 页头线右内缩 40px`).toBe(40);
      }
    } finally {
      await page.close();
    }
  });

  it('D 版页头报告装置（P1-7 右半）：REPORT nn / nn + 点分日期，mono 小字、逐页联动、不改变页头高', async () => {
    const css = builtCss();
    // 用 30 阶段长夹具：矩阵 2 页 ⇒ 能同时验「首页 01 / 02」与「次页 02 / 02」
    const stages: Stage[] = Array.from({ length: 30 }, (_, i) => {
      const tpl = STAGES[i % 9]!;
      return {
        ...tpl,
        id: `stg_d4_r_${i + 1}`,
        orderIndex: i + 1,
        name: `阶段${i + 1}·${i % 2 === 0 ? '方案深化' : '现场勘查'}`,
      };
    });
    const tasks: Task[] = stages.map((s, i) => ({
      ...TASKS[i % TASKS.length]!,
      id: `tsk_d4_r_${i + 1}`,
      stageId: s.id,
      taskNo: 4000 + i + 1,
    }));
    const vm = buildPrintViewModel({
      project: PROJECT,
      stages,
      tasks,
      members: [HUMAN, AGENT],
      stageLogs: LOGS,
      role: MemberRoleKind.Admin,
      currentMemberId: HUMAN.id,
      todayIso: TODAY,
      now: new Date('2026-10-09T07:30:00Z'),
    });
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, {
        vm,
        sheets: [{ type: 'native', page: 'progress-matrix' }],
        palette: PRINT_TEMPLATE_PALETTES['data-editorial'].baseline,
      }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      const htmlPath = writeHtml('d-head-report.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const pages = await page.$$('.a4-page');
      expect(pages.length, '30 阶段矩阵应 2 页（本用例只需多页夹具）').toBe(2);

      // 点分日期：与 generatedAt 同源（不是另造的时刻）
      const ymd = vm.generatedAt.slice(0, 10).replace(/-/g, '.');
      for (let i = 0; i < pages.length; i++) {
        const el = pages[i]!;
        const rp = await el.$eval('.de-head__report', (node) => {
          const s = getComputedStyle(node);
          const r = node.getBoundingClientRect();
          return {
            text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
            ff: s.fontFamily,
            fs: s.fontSize,
            color: s.color,
            align: s.textAlign,
            x: r.left,
            right: r.right,
            bw: node.parentElement!.getBoundingClientRect().right,
          };
        });
        // ① 文本形状：`REPORT 01 / 02 2026.10.09`（两位补零 + 空格分隔 + 点分日期）
        expect(rp.text, `第 ${i + 1} 页报告号形状`).toMatch(
          new RegExp(`^REPORT 0${i + 1} / 02 ${ymd.replace(/\./g, '\\.')}$`),
        );
        // ② 它是「报告身份」那一档：等宽数字 + 小字 + 右下角退后一档灰
        expect(rp.ff, `第 ${i + 1} 页报告号等宽族`).toContain('mono');
        expect(rp.fs, `第 ${i + 1} 页报告号 9.5px`).toBe('9.5px');
        expect(rp.color, `第 ${i + 1} 页报告号退后一档灰`).toBe('rgb(115, 115, 115)');
        // ③ 右对齐：右缘与右栏同缘（页心右边界 − 40px 内距）
        expect(Math.abs(rp.right - rp.bw), `第 ${i + 1} 页报告号右对齐`).toBeLessThanOrEqual(1);
      }

      // ④ 纯加法：页头总高仍是 210px（P0-8 定下的常数，估高与 CSS 同源的前提）
      for (let i = 0; i < pages.length; i++) {
        const head = await pages[i]!.$eval('.de-head', (el) =>
          +(el.getBoundingClientRect().bottom - el.closest('.a4-page')!.getBoundingClientRect().top).toFixed(1),
        );
        expect(head, `第 ${i + 1} 页页头高不得因报告行变化（P0-8 常数 210）`).toBeCloseTo(210, 0);
      }
      // ⑤ 原有右侧两行仍在（是加法不是替换）
      expect(await pages[0]!.$('.de-head__project'), '项目标识行必须保留').not.toBeNull();
      expect(await pages[0]!.$('.de-head__meta'), '排期口径行必须保留').not.toBeNull();
    } finally {
      await page.close();
    }
  });

  it('D 版 P2 依赖网络（legacy 原生页）：环、缺失引用、20+ 任务全部上纸（DOM 断言）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['data-editorial'].baseline;
    // 依赖网络页在五块模型里**无承载位**（决策 2：从界面消失、代码与 spec 全留）
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, { vm, palette: baseline, sheets: NATIVE_SHEETS }),
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

  it('D 版 legacy 原生页：套预设变体（靛蓝）彩色 4 张；信号槽位确实挂上（非默认态重截）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const preset = PRINT_TEMPLATE_PALETTES['data-editorial'].presets.find((p) => p.id === 'indigo')!;
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, { vm, palette: preset.palette, sheets: NATIVE_SHEETS }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('d-preset-indigo.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const pages = await page.$$('.a4-page');
      expect(pages).toHaveLength(4);
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

  it('D 版口径断言（legacy 原生页 P3）：占比不等于完成度 + 合计 ≠100% 不归一化', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['data-editorial'].baseline;
    const markup = renderToStaticMarkup(
      createElement(DataEditorialDocument, { vm, palette: baseline, sheets: NATIVE_SHEETS }),
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

/* ====================================================================================
 * M1 · 矩阵分页计划（纯函数：2026-10-09「原生矩阵无分页」修复；不依赖 build-dist）
 * 锁四件：行不裂（总数守恒）/ 页容量（估高只许偏大）/ 切档点（normal 容量 = 9，
 * 10 阶段起走紧凑档）/ 空阶段单空块。视觉侧（续表头、页码、页尾横带、无溢出）
 * 见上方 V5 真 Chromium 用例。
 *
 * ── 容量数字 2026-10-11 重算的出处（P0-7 骨架重做）──
 *   参考稿行节距 90px 是硬设计值 ⇒ normal 容量 = ⌊(777+36)/90⌋ = 9（= 参考稿
 *   P1 的行数）。切档点因此定在 9（>9 即紧凑档），不留「normal 装不下却仍在
 *   normal 档」的区间。紧凑档节距 49px ⇒ 容量 ⌊(777+13)/49⌋ = 16（旧实现是
 *   14/16/15 那一组，容量关系不变：切档后不出现页数断崖）。
 * ==================================================================================== */

function matrixStages(n: number): PrintStageVM[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `stg_mp_${i + 1}`,
    orderIndex: i + 1,
    name: `阶段${i + 1}·现场勘查与方案深化`,
    ratioPercent: 11,
    startAt: '2026-01-05',
    endAt: '2026-01-20',
    status: (i + 1) % 4 === 0 ? StageStatus.Delayed : StageStatus.InProgress,
    ownerName: '负责人甲',
    ownerId: HUMAN.id,
    colorIndex: (i % 9) + 1,
    customColor: null,
    taskProgress: { done: 1, total: 4 },
  }));
}

describe.skipIf(!CAN_RUN)('D 版 · 五块形态（批 B：决策 6 / 列粒度 / 格阵 / 署名 / 口径注）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  /** 用显式单元集合渲一版（模拟选择器的勾选 ⇒ `resolveUnits` 的结果） */
  function markupWith(ids: readonly string[], vm = buildVm()): string {
    const units = resolveUnits('data-editorial', {
      units: { 'data-editorial': ids as never },
    });
    return renderToStaticMarkup(
      createElement(DataEditorialDocument, {
        vm,
        units,
        palette: PRINT_TEMPLATE_PALETTES['data-editorial'].baseline,
      }),
    );
  }

  const ALL_UNITS = () => printTemplateUnitIds('data-editorial');
  const blocksOf = (ids: readonly string[]) =>
    blockRecordOf(resolveUnits('data-editorial', { units: { 'data-editorial': ids as never } }));

  it('★ 决策 6 三条（严格一一对应）：关 B2 只矩阵消失、关 B4 只清单消失，页数各自联动', async () => {
    const css = builtCss();
    const vm = buildVm();
    const all = ALL_UNITS();
    const withoutB2 = all.filter((id) => id !== 'timeline');
    const withoutB4 = all.filter((id) => id !== 'stageTable');
    const expected = {
      all: deBlockPages(vm, blocksOf(all)).length,
      noB2: deBlockPages(vm, blocksOf(withoutB2)).length,
      noB4: deBlockPages(vm, blocksOf(withoutB4)).length,
    };
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      // 全开：每页各有矩阵与清单（本夹具 2 页 ⇒ 2 个矩阵）
      await page.goto('file://' + writeHtml('d-blocks-all.html', shell(markupWith(all), css, false)));
      expect(await page.$$('.a4-page')).toHaveLength(expected.all);
      expect(await page.$$('.de-mx'), 'B2 每页一份（与切片同步）').toHaveLength(expected.all);
      expect((await page.$$('.de-row')).length, 'B4 在').toBeGreaterThan(0);
      // 全开态的两个基线（后面两轮各自的「没摘的那块」要与它们逐值相等）
      const rowsBefore = (await page.$$('.de-row')).length;
      const cellsBefore = (await page.$$('.de-mx__cell')).length;

      // 关 B2：**只有**矩阵消失，清单原样
      await page.goto('file://' + writeHtml('d-blocks-no-b2.html', shell(markupWith(withoutB2), css, false)));
      expect(await page.$$('.de-mx'), '关 B2 ⇒ 矩阵整块消失').toHaveLength(0);
      expect((await page.$$('.de-row')).length, '关 B2 不得动清单').toBe(rowsBefore);
      expect(await page.$$('.a4-page'), '关 B2 的页数联动').toHaveLength(expected.noB2);

      // 关 B4：**只有**清单消失，矩阵原样
      await page.goto('file://' + writeHtml('d-blocks-no-b4.html', shell(markupWith(withoutB4), css, false)));
      expect(await page.$$('.de-row'), '关 B4 ⇒ 清单整块消失').toHaveLength(0);
      expect(await page.$$('.de-bar'), '关 B4 ⇒ 条也消失').toHaveLength(0);
      expect((await page.$$('.de-mx__cell')).length, '关 B4 不得动矩阵').toBe(cellsBefore);
      expect(await page.$$('.a4-page'), '关 B4 的页数联动').toHaveLength(expected.noB4);
      // 两条页数各自成立（本夹具 9 阶段：全开 2 页，各自关掉都回 1 页）
      expect(expected).toEqual({ all: 2, noB2: 1, noB4: 1 });
    } finally {
      await page.close();
    }
  });

  it('B2 日期格矩阵：列数恒在 [4,14]；填充**不越格**（像素级）+ 三档分色', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      await page.goto('file://' + writeHtml('d-blocks-matrix.html', shell(markupWith(ALL_UNITS()), css, false)));
      const geom = await page.evaluate(() => {
        const mx = document.querySelector('.de-mx') as HTMLElement;
        const cols = Array.from(mx.querySelectorAll('.de-mx__col')) as HTMLElement[];
        const headCells = Array.from(mx.querySelectorAll('.de-mx__head .de-mx__cols > *')) as HTMLElement[];
        const firstRow = mx.querySelector('.de-mx__row') as HTMLElement;
        const cells = Array.from(firstRow.querySelectorAll('.de-mx__cell')) as HTMLElement[];
        const r = (el: HTMLElement): DOMRect => el.getBoundingClientRect();
        const wrap = firstRow.querySelector('.de-mx__cols') as HTMLElement;
        const wr = r(wrap);
        // 每个填充分格是否落在自己的列里：用列头的 x 区间做参照（同一 grid 模板）
        const colRects = headCells.map((el) => r(el));
        const bad: number[] = [];
        cells.forEach((c, i) => {
          const cr = r(c);
          const owner = colRects[i];
          if (!owner) return;
          if (cr.x < owner.x - 1 || cr.x + cr.width > owner.x + owner.width + 1) bad.push(i);
        });
        const fills = cells.map((c) => c.getAttribute('data-cell'));
        return {
          cols: cols.length,
          gridColumns: getComputedStyle(wrap).gridTemplateColumns,
          cellsPerRow: cells.length,
          cellW: Math.round(r(cells[0]!).width * 10) / 10,
          wrapW: Math.round(wr.width * 10) / 10,
          badCells: bad,
          tones: Array.from(new Set(fills)),
          rowHeight: Math.round(r(firstRow).height),
          radius: getComputedStyle(cells[0]!).borderRadius,
          // 无竖线纪律：单元格之间是间隙而不是线 ⇒ 相邻两格 x 之差 = 格宽 + 1
          gap: cells.length > 1 ? Math.round((r(cells[1]!).x - (r(cells[0]!).x + r(cells[0]!).width)) * 10) / 10 : -1,
        };
      });
      expect(geom.cols, '列数 ≥ 下限 4').toBeGreaterThanOrEqual(4);
      expect(geom.cols, '列数 ≤ 上限 14').toBeLessThanOrEqual(14);
      expect(geom.cellsPerRow, '每行格数 = 列数').toBe(geom.cols);
      expect(geom.cellW, '格宽应撑得住填充（>20px）').toBeGreaterThan(20);
      expect(geom.badCells, '填充不得越出自己的列').toEqual([]);
      expect(geom.radius, '零圆角（D 的身份）').toBe('0px');
      expect(geom.gap, '格与格之间是 1px 间隙（无竖线纪律）').toBeCloseTo(1, 1);
      // 三档分色至少出现 ink（本夹具含进行中/已完成）
      expect(geom.tones).toContain('ink');
      void vm;
    } finally {
      await page.close();
    }
  });

  it('B2 列粒度阶梯：4 ≤ 列数 ≤ 14，粒度随窗口长度自动升降（含 3 年窗口 = 12 季列）', () => {
    const cases: Array<{ from: string; to: string; unit: string; cols: number }> = [
      { from: '2026-01-05', to: '2026-01-16', unit: 'day', cols: 12 },
      { from: '2026-01-01', to: '2026-03-01', unit: 'week', cols: 9 },
      { from: '2026-01-01', to: '2026-06-30', unit: 'month', cols: 6 },
      { from: '2026-01-01', to: '2028-12-31', unit: 'quarter', cols: 12 },
      { from: '2026-01-01', to: '2035-12-31', unit: 'year', cols: 10 },
    ];
    for (const c of cases) {
      const cols = deMatrixColumns(c.from, c.to);
      expect(deMatrixColumnUnit(c.from, c.to), `${c.from}→${c.to} 的粒度`).toBe(c.unit);
      expect(cols.length, `${c.from}→${c.to} 列数应 4..14`).toBeGreaterThanOrEqual(4);
      expect(cols.length, `${c.from}→${c.to} 列数应 4..14`).toBeLessThanOrEqual(14);
      expect(cols.length, `${c.from}→${c.to} 列数`).toBe(c.cols);
    }
    // 窗口不足 4 天 ⇒ 外扩到 4 列（约束①的下限不破）
    expect(deMatrixColumns('2026-01-05', '2026-01-06')).toHaveLength(4);
    // ⚠️ 已知边界：> 14 年窗口会越出上限（如实登记，不静默改语义）
    expect(deMatrixColumns('2026-01-01', '2045-12-31').length).toBeGreaterThan(14);
  });

  it('B5 页脚：1px 发丝线 + 署名（新）+ 数据时间可摘；**页码只在页头 REPORT**', async () => {
    const css = builtCss();
    const vm = buildVm();
    const all = ALL_UNITS();
    const noB5 = all.filter((id) => id !== 'footer');
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      await page.goto('file://' + writeHtml('d-blocks-foot.html', shell(markupWith(all), css, false)));
      const info = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll('.a4-page')) as HTMLElement[];
        return {
          signs: pages.map((p) => (p.querySelector('.de-foot__sign')?.textContent ?? '').trim()),
          dataTimes: pages.map((p) => p.querySelector('.de-foot__page')?.textContent ?? ''),
          reports: pages.map((p) => (p.querySelector('.de-head__report')?.textContent ?? '').trim()),
          borderTop: getComputedStyle(pages[0]!.querySelector('.de-foot')!).borderTopWidth,
          // 「第 n / N 页」这套口径不该出现在 D 的任何一页（页码唯一落点是页头）
          hasPageWord: pages.some((p) => (p.textContent ?? '').includes(' 页')),
        };
      });
      expect(info.signs.every((x) => x === 'ID Plan · 项目排期与交付管理'), '每页都有署名').toBe(true);
      expect(info.dataTimes.every((x) => x.startsWith('数据时间 ')), 'B5 开着 ⇒ 每页都有数据时间').toBe(true);
      expect(info.reports[0], '页码唯一落点 = 页头 REPORT').toContain('REPORT 01 / 02');
      expect(info.borderTop, 'B5 的 1px 发丝线').toBe('1px');
      expect(info.hasPageWord, 'D 的纸面不该再出现「第 n / N 页」').toBe(false);

      // 关 B5 ⇒ **只**摘数据时间，发丝线与署名留着（§2.6 D·B5 = 甲）
      await page.goto('file://' + writeHtml('d-blocks-no-b5.html', shell(markupWith(noB5), css, false)));
      const off = await page.evaluate(() => {
        const p1 = document.querySelector('.a4-page') as HTMLElement;
        return {
          dataTime: p1.querySelector('.de-foot__page') ? 1 : 0,
          sign: (p1.querySelector('.de-foot__sign')?.textContent ?? '').trim(),
          report: (p1.querySelector('.de-head__report')?.textContent ?? '').trim(),
        };
      });
      expect(off.dataTime, '关 B5 ⇒ 数据时间消失').toBe(0);
      expect(off.sign, '关 B5 ⇒ 署名还在').toBe('ID Plan · 项目排期与交付管理');
      expect(off.report, '关 B5 不动页码（住页头）').toContain('REPORT 01 / 02');
    } finally {
      await page.close();
    }
  });

  it('口径注恒在（§2.6 原则 1）：B3 开 ⇒ 主体底部成簇；B3 关 ⇒ 锚回页脚（含续页）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const all = ALL_UNITS();
    const noB3 = all.filter((id) => id !== 'projectInfo');
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      await page.goto('file://' + writeHtml('d-blocks-info-on.html', shell(markupWith(all), css, false)));
      const on = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll('.a4-page')) as HTMLElement[];
        return {
          cluster: pages.map((p) => p.querySelectorAll('.de-info').length),
          noteInCluster: pages.map((p) => p.querySelectorAll('.de-info__note').length),
          noteInFoot: pages.map((p) => p.querySelectorAll('.de-foot__note').length),
          line: (pages[0]!.querySelector('.de-info__line')?.textContent ?? '').trim(),
        };
      });
      expect(on.cluster, 'B3 簇只首页').toEqual([1, 0]);
      expect(on.noteInCluster, '口径注在 B3 簇里').toEqual([1, 0]);
      expect(on.noteInFoot, 'B3 开着时续页的口径注锚回页脚（原则 1）').toEqual([0, 1]);
      expect(on.line, 'B3 的 mono 行 = 排期基准 + 打印时间').toContain('排期基准');
      expect(on.line).toContain('打印时间');

      // 关 B3 ⇒ 承载区整块不出，但口径注**每页**都在页脚（§2.6 的锚回）
      await page.goto('file://' + writeHtml('d-blocks-info-off.html', shell(markupWith(noB3), css, false)));
      const off = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll('.a4-page')) as HTMLElement[];
        return {
          cluster: pages.reduce((n, p) => n + p.querySelectorAll('.de-info').length, 0),
          noteInFoot: pages.map((p) => p.querySelectorAll('.de-foot__note').length),
          basis: pages.some((p) => (p.textContent ?? '').includes('排期基准')),
        };
      });
      expect(off.cluster, '关 B3 ⇒ 承载区整块不出').toBe(0);
      expect(off.noteInFoot, '关 B3 ⇒ 口径注每页都在（底线不是块）').toEqual([1, 1]);
      expect(off.basis, '关 B3 ⇒ 排期基准随之消失（口径注除外）').toBe(false);
    } finally {
      await page.close();
    }
  });
});

describe('D 矩阵分页计划（纯函数：行不裂 / 容量 / compact 边界）', () => {
  it('9 阶段（= 参考稿 P1 的行数与 normal 容量上限）⇒ 1 块不拆页；行数守恒', () => {
    const plan = planMatrixPages(matrixStages(9));
    expect(plan.chunks).toHaveLength(1);
    expect(plan.compact, '9 阶段刚好吃满 normal 档（容量 9）').toBe(false);
    expect(plan.chunks[0]!.rows).toHaveLength(9);
  });

  it('10 阶段 ⇒ 切紧凑档、仍守一页（normal 装不下的第一个规模就切档，不留 9+1 断崖）', () => {
    const plan = planMatrixPages(matrixStages(10));
    expect(plan.compact, '>9 阶段走紧凑档').toBe(true);
    expect(plan.chunks, '10 阶段应一页装下').toHaveLength(1);
    expect(plan.chunks[0]!.rows).toHaveLength(10);
  });

  it('15/16 阶段 ⇒ 紧凑档都守一页（compact 容量 16 ≥ 切档点 9 + 1）', () => {
    for (const n of [15, 16]) {
      const plan = planMatrixPages(matrixStages(n));
      expect(plan.compact, `${n} 阶段应走 compact 档`).toBe(true);
      expect(plan.chunks, `${n} 阶段应一页装下`).toHaveLength(1);
      expect(plan.chunks[0]!.rows).toHaveLength(n);
    }
  });

  it('20 阶段 ⇒ 2 块 16+4；30 阶段 ⇒ 2 块 16+14（compact 容量 16／续表 15）', () => {
    const p20 = planMatrixPages(matrixStages(20));
    expect(p20.compact).toBe(true);
    expect(p20.chunks.map((c) => c.rows.length)).toEqual([16, 4]);
    const p30 = planMatrixPages(matrixStages(30));
    expect(p30.chunks.map((c) => c.rows.length)).toEqual([16, 14]);
    // 行不裂：总行数守恒（两规模）
    expect(p30.chunks.reduce((n, c) => n + c.rows.length, 0)).toBe(30);
  });

  it('5 块形态的页数表（1/2/6/7/8/9/20/30/40/60 阶段；预计 = 实测，真机逐档跑过）', () => {
    /*
     * 夹具 = 本 spec 的 buildVm() 9 阶段轮值扩到 n（与真机探针同一构造）。
     * 实测（真 Chromium，批 B 探针）：
     *   n=1/2/3/4/6 → 1 页；n=8/9/10 → 2 页；20 → 3；30 → 5；40 → 6；60 → 9。
     * 行成本 = B2 一行(26) + B4 一行(compact 49) = 75 ⇒ 紧凑档每页 7 行左右。
     */
    const mk = (n: number) => {
      const stages: Stage[] = Array.from({ length: n }, (_, i) => {
        const tpl = STAGES[i % 9]!;
        return { ...tpl, id: `stg_b_${i + 1}`, orderIndex: i + 1, name: `阶段${i + 1}` };
      });
      return buildPrintViewModel({
        project: PROJECT,
        stages,
        tasks: [],
        members: [HUMAN, AGENT],
        stageLogs: LOGS,
        role: MemberRoleKind.Admin,
        currentMemberId: HUMAN.id,
        todayIso: TODAY,
        now: new Date('2026-10-09T07:30:00Z'),
      });
    };
    const pages = (n: number) => deBlockPages(mk(n), DEFAULT_SCHEDULE_PAPER_BLOCKS).length;
    expect([1, 2, 3, 4, 6].map(pages), '小项目恒 1 页').toEqual([1, 1, 1, 1, 1]);
    expect(pages(DE_BLOCK_COMPACT_AT), '切点处仍 1 页（normal 容量 = 切点）').toBe(1);
    // ⚠️ 本 spec 的夹具在 `mk()` 里重写了阶段 id ⇒ 那条 StageLog(rescheduled)
    // 因引用不到可见阶段而**不进 VM**（L3 不出）⇒ 8 行正好一页（探针夹具 ID 对齐，
    // 带一条改期记录时是 8 → 2 页；L3 的影响由「决策 6」用例单独覆盖）。
    expect([8, 9, 10].map(pages), '8/9/10 阶段').toEqual([1, 2, 2]);
    const long = [20, 30, 40, 60].map(pages);
    expect(long, '长项目逐档（每页 8–9 行）').toEqual([3, 4, 5, 7]);
    for (let i = 1; i < long.length; i++) {
      expect(long[i]!, '页数随阶段数单调不减').toBeGreaterThanOrEqual(long[i - 1]!);
    }
    // 紧凑档切点 = normal 容量（不留断崖：7 阶段 1 页、8 阶段 2 页都是单调的）
    expect(DE_BLOCK_COMPACT_AT, '5 块形态的紧凑切点（≠ legacy 的 9）').toBe(5);
  });

  it('空阶段 ⇒ 单空块（调用方走空态，不出零页纸面）', () => {
    const plan = planMatrixPages([]);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]!.rows).toHaveLength(0);
  });
});
