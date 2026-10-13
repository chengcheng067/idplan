/**
 * A 版 A4 视觉验收（批 1：真构建产物 + 真 Chromium 实测，不真打黑白打印机）。
 *
 * ── 2026-10-13「5 块 × 4 模板」重构 · 批 1 的重定（逐条）──
 *   · 「A 版四页」⇒ **五块形态的物理页**（页数由数据驱动：本夹具 9 阶段 = 2 页），
 *     判据从「恰好 4 页」改为「**逐页 794×1123 无裁切** + 页数 === 文档层装配数」；
 *   · 新增 **B2 甘特的实测几何**（本批唯一的横读块）：月份刻度不被抽稀吞掉、
 *     条带不越轨道（`left ≥ 0` 且 `left + width ≤ 100`）、条带最小可见宽 ≥2.5%；
 *   · 「板头巨字 82px」断言原样保留（它锁的是 A 的版面锚点，与块数无关）。
 *   旧四页的视觉证据仍可由显式 `sheets` 复现（代码与 spec 全留，决策 2）。
 *
 * ── 为什么这样做验收 ──
 * 产品决策文档批 1 要求「A 彩色 4 + 灰度 4；同时首次验证配色槽位（默认态 vs
 * 一个预设变体 vs 一个踩线禁存用例）」，02 §9 要求「794×1123 预览截图…无裁切」。
 * 灰度走「纸面套 filter:grayscale(1)」——与预览面板「灰度」toggle 同一机制
 * （决策文档 §3.2-②），不必也不该真打一台黑白打印机。
 *
 * ── 方法 ──
 * ① 用**真实组件**（SwissScheduleDocument / PaletteSection）+ **真实 VM 装配**
 *    （buildPrintViewModel）经 renderToStaticMarkup 出静态纸面；
 * ② 外挂 **真实构建产物**的 CSS（build-dist/assets/*.css——A 版样式与亮色锁
 *    都在里面），保证测的是打包后的规则而不是源码顺序；
 * ③ 真 Chromium 逐页截图，并断言每页 794×1123 **无裁切**（盒子超高即红）。
 *
 * 前置：`npm run build`（产物在 build-dist/）与本机 chromium；缺任一则整组 skip
 * （与 print-light-lock.spec.ts 同口径——CI 无浏览器时不误报）。
 *
 * 产物落点：`outputs/print-a4-shots/`（工作区交付目录，不进 git）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';

import { SwissScheduleDocument, swissBlockPages } from '../src/print/documents/SwissScheduleDocument';
import { DEFAULT_SCHEDULE_PAPER_BLOCKS } from '../src/lib/schedule-print';
import { PaletteSection } from '../src/print/parts/PaletteSection';
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

/** 拼接全部构建产物 CSS（A 版样式 + 亮色锁 + 主题令牌都在里面） */
function builtCss(): string {
  return readBuiltCss(ROOT);
}

/* ------------------------------------------------------------------ 夹具（真实形状） */

const TODAY = '2026-10-09';
const PROJECT_ID = 'proj_a4';

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
  kind: 'human',
  ownerMemberId: null,
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const HUMAN: Member = {
  id: 'm-a4-human',
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
  id: 'm-a4-agent',
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

/** 9 阶段（覆盖三列错落 + 密度档），四态齐全 */
const STAGES: Stage[] = Array.from({ length: 9 }, (_, i) => {
  const n = i + 1;
  return {
    id: `stg_a4_${n}`,
    projectId: PROJECT_ID,
    orderIndex: n,
    templateKey: null,
    colorIndex: ((n - 1) % 9) + 1,
    customColor: null,
    name: `阶段${n}·${n % 2 === 0 ? '方案深化' : '现场勘查'}`,
    ratioPercent: n === 9 ? 12 : 11,
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

/** 14 任务（覆盖七态中的多数 + 逾期 + 老数据无号） */
const TASK_STATUSES = [
  TaskStatus.Draft,
  TaskStatus.Ready,
  TaskStatus.Claimed,
  TaskStatus.InProgress,
  TaskStatus.Blocked,
  TaskStatus.Review,
  TaskStatus.Done,
];
const TASKS: Task[] = Array.from({ length: 14 }, (_, i) => {
  const n = i + 1;
  return {
    id: `tsk_a4_${n}`,
    taskNo: n <= 12 ? 1000 + n : null,
    projectId: PROJECT_ID,
    stageId: STAGES[n % STAGES.length]!.id,
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
    dependsOn: [],
    artifacts: n % 3 === 0 ? [
      { id: `art_a4_${n}_1`, kind: 'doc', title: '会议纪要', path: null, url: null, note: null },
      { id: `art_a4_${n}_2`, kind: 'file', title: '测绘图', path: null, url: null, note: null },
    ] : [],
    startAt: null,
    claimedAt: null,
    runId: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
});

const LOGS: StageLog[] = [
  {
    id: 'log_a4_1',
    stageId: 'stg_a4_3',
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
  {
    id: 'log_a4_2',
    stageId: 'stg_a4_3',
    projectId: PROJECT_ID,
    type: StageLogType.StatusChanged,
    fromStatus: StageStatus.InProgress,
    toStatus: StageStatus.Delayed,
    oldStartAt: null,
    newStartAt: null,
    oldEndAt: null,
    newEndAt: null,
    reason: null,
    operatorName: '负责人甲',
    createdAt: '2026-01-19T02:05:00Z',
  },
  {
    id: 'log_a4_3',
    stageId: 'stg_a4_1',
    projectId: PROJECT_ID,
    type: StageLogType.Created,
    fromStatus: null,
    toStatus: null,
    oldStartAt: null,
    newStartAt: null,
    oldEndAt: null,
    newEndAt: null,
    reason: null,
    operatorName: '负责人甲',
    createdAt: '2026-01-01T00:00:00Z',
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

describe.skipIf(!CAN_RUN)('A 版 A4 视觉验收 · 批 1（真 Chromium + 真实构建 CSS）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('A 版五块形态：默认态彩色 + 灰度各一轮；逐页 794×1123 无裁切', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline;
    const markup = renderToStaticMarkup(
      createElement(SwissScheduleDocument, { vm, palette: baseline }),
    );
    // 页数 = 文档层装配的页数（「预计页数 = 实际出纸」的对价：两边同源）
    const expectedPages = swissBlockPages(vm, DEFAULT_SCHEDULE_PAPER_BLOCKS).length;

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const gray of [false, true]) {
        const htmlPath = writeHtml(
          gray ? 'a-default-gray.html' : 'a-default-color.html',
          shell(markup, css, gray),
        );
        await page.goto('file://' + htmlPath);
        const pages = await page.$$('.a4-page');
        expect(pages, `A 版五块形态应渲染 ${expectedPages} 页（装配层同源）`).toHaveLength(
          expectedPages,
        );
        for (let i = 0; i < pages.length; i++) {
          const el = pages[i]!;
          const box = await el.boundingBox();
          const tag = gray ? 'gray' : 'color';
          expect(box, `第 ${i + 1} 页应有布局盒`).not.toBeNull();
          // 794×1123 无裁切：盒宽必须精确 794；盒高超过 1123 = 内容溢出（裁切/孤儿页脚风险）
          expect(Math.abs(box!.width - 794), `第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
          expect(box!.height, `第 ${i + 1} 页高应恰 1123（溢出即红）`).toBeLessThanOrEqual(1124);
          expect(box!.height, `第 ${i + 1} 页高不得低于 1123`).toBeGreaterThanOrEqual(1122);
          // 内容不得越过纸面下缘（页脚压底：底栏底边 ≤ 页底）
          const bottomBar = await el.$('.swiss-bottombar');
          expect(bottomBar, `第 ${i + 1} 页应有黑底栏（每页装置）`).not.toBeNull();
          const barBox = await bottomBar!.boundingBox();
          expect(barBox!.y + barBox!.height, `第 ${i + 1} 页底栏不越出纸底`).toBeLessThanOrEqual(
            box!.y + box!.height + 0.5,
          );
          await el.screenshot({ path: join(OUT_DIR, `density-a-p${i + 1}-${tag}.png`) });
        }
      }
    } finally {
      await page.close();
    }
  });

  it('★ A 版 9 阶段（参考稿档位）几何**冻结**：a+b 小规模优化后逐值不变', async () => {
    /*
     * 批 A 裁决第 4 条（批准的**前提条件**）：a（组头呼吸 71→40，门控 ≤6 阶段）与
     * b（错落只在三列齐全时施加，≥7 阶段）**只许影响小规模档**；参考稿档位
     * （9 阶段 = 三列各三张卡）必须**逐像素不变**。
     *
     * 证据取法：同一夹具（`buildVm()` 的 9 阶段 / 1 条 resched）在改动**前后各量一次**，
     * 逐块 `getBoundingClientRect().height`（不含 margin）+ 每页总高 + 页数，
     * 逐值放进下表并成为常驻断言（下表 = 改动**前**在 commit `a960693` 上实测，
     * 改动后在 `swissStageScale(9) === 'normal'` 下重测，两次数值相同）。
     *
     * | 页 | 页高 | masthead | gantt | info | notes | board | columns | colHead | card | resched | source | bottombar |
     * |---|---|---|---|---|---|---|---|---|---|---|---|---|
     * | 1 | 1123 | 232.5 | 327 | 121 | 31.25 | — | — | — | — | — | 15.39 | 48 |
     * | 2 | 1123 | 217 | — | — | — | 624.61 | 404.81 | 21.75 | 87.69 | 102.5 | 15.39 | 48 |
     */
    const css = builtCss();
    const vm = buildVm();
    const markup = renderToStaticMarkup(
      createElement(SwissScheduleDocument, {
        vm,
        palette: PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline,
      }),
    );
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('a-frozen-9.html', shell(markup, css, false)));
      const snap = await page.evaluate(() => {
        const val = (el: Element | null): number =>
          el ? Math.round(el.getBoundingClientRect().height * 100) / 100 : -1;
        const pages = Array.from(document.querySelectorAll('.a4-page'));
        const pick = (pg: Element) => ({
          masthead: val(pg.querySelector('.swiss-masthead')),
          gantt: val(pg.querySelector('.print-gantt')),
          info: val(pg.querySelector('.swiss-info')),
          notes: val(pg.querySelector('.swiss-notes')),
          board: val(pg.querySelector('.swiss-block')),
          columns: val(pg.querySelector('.swiss-columns')),
          colHead: val(pg.querySelector('.swiss-column__head')),
          card: val(pg.querySelector('.swiss-stage-row')),
          resched: val(pg.querySelector('.swiss-resched')),
          source: val(pg.querySelector('.swiss-source')),
          bottombar: val(pg.querySelector('.swiss-bottombar')),
        });
        return {
          pages: pages.length,
          pageHeights: pages.map((el) => Math.round(el.getBoundingClientRect().height * 100) / 100),
          perPage: pages.map(pick),
          // 规模档：9 阶段必须落在「错落施加」档（= 参考稿档位）
          scale: (pages[1]?.querySelector('.swiss-columns') as HTMLElement | null)?.dataset.scale ?? '',
        };
      });
      expect(snap.pages, '页数冻结：2').toBe(2);
      expect(snap.pageHeights, '每页总高冻结：1123 / 1123').toEqual([1123, 1123]);
      expect(snap.scale, '9 阶段 = 错落档（不落 small）').toBe('normal');
      expect(snap.perPage[0], '首页逐块冻结').toEqual({
        masthead: 232.5,
        gantt: 327,
        info: 121,
        notes: 31.25,
        board: -1,
        columns: -1,
        colHead: -1,
        card: -1,
        resched: -1,
        source: 15.39,
        bottombar: 48,
      });
      expect(snap.perPage[1], '次页逐块冻结（含 B4 三列错落 + L3）').toEqual({
        masthead: 217,
        gantt: -1,
        info: -1,
        notes: -1,
        board: 624.61,
        columns: 404.81,
        colHead: 21.75,
        card: 87.69,
        resched: 102.5,
        source: 15.39,
        bottombar: 48,
      });
    } finally {
      await page.close();
    }
  });

  it('A 版大项目（20 阶段）：甘特行高自适应、逐页无裁切、预计页数 = 实际出纸', async () => {
    const css = builtCss();
    // 复用同一夹具，扩到 20 阶段（触发 B2 的行高自适应：28 → 19）
    const vm = buildVm();
    const many = {
      ...vm,
      stages: Array.from({ length: 20 }, (_, i) => {
        const base = vm.stages[i % vm.stages.length]!;
        const n = i + 1;
        return { ...base, id: `stg_many_${n}`, orderIndex: n, name: `${n}·${base.name}` };
      }),
    } as typeof vm;
    const markup = renderToStaticMarkup(
      createElement(SwissScheduleDocument, {
        vm: many,
        palette: PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline,
      }),
    );
    const expectedPages = swissBlockPages(many, DEFAULT_SCHEDULE_PAPER_BLOCKS).length;

    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      const htmlPath = writeHtml('a-many-stages.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const pages = await page.$$('.a4-page');
      expect(pages, '20 阶段：预计页数 = 实际出纸').toHaveLength(expectedPages);
      // 首页的甘特行高被压下来（没有把纸撑爆的唯一原因）
      const rowH = await page.$eval('.print-gantt__row', (el) =>
        Math.round((el as HTMLElement).getBoundingClientRect().height),
      );
      expect(rowH, '20 阶段 ⇒ 行高自适应到设定值以下').toBeLessThan(28);
      expect(rowH, '行高不低于可读下限').toBeGreaterThanOrEqual(14);
      expect(
        await page.$eval('.print-gantt__row', (el) => (el as HTMLElement).style.height),
        '行高经内联几何落到 DOM（各版预算不同，不在组件里写死）',
      ).toBe(rowH + 'px');
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(Math.abs(box!.width - 794), `第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
        expect(box!.height, `第 ${i + 1} 页溢出即红（实测 ${box!.height}）`).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({ path: join(OUT_DIR, `density-a-many-p${i + 1}.png`) });
      }
    } finally {
      await page.close();
    }
  });

  it('A 版超阈值（28 阶段）：B2 按页续排（首页 13 行 + 续页 15 行 + 轴首「（续）」），逐页无裁切', async () => {
    /*
     * 批 A 裁决第 1 条的**降级路径甲**在真机上的样子：28 阶段（> 阈值 23）⇒
     * 行高回设计基线 28、整轴分两页；续段自带轴与刻度（同一时间坐标系）、
     * 轴尾有「（续）」、图例只在首段，行号连续（01..13 → 14..28）。
     */
    const css = builtCss();
    const base = buildVm();
    const n = 28;
    const vm = {
      ...base,
      stages: Array.from({ length: n }, (_, i) => {
        const b = base.stages[i % base.stages.length]!;
        return { ...b, id: `stg_cont_${i + 1}`, orderIndex: i + 1, name: `${i + 1}·${b.name}` };
      }),
    } as typeof base;
    const markup = renderToStaticMarkup(
      createElement(SwissScheduleDocument, {
        vm,
        palette: PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline,
      }),
    );
    const expectedPages = swissBlockPages(vm, DEFAULT_SCHEDULE_PAPER_BLOCKS).length;
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      await page.goto('file://' + writeHtml('a-gantt-cont.html', shell(markup, css, false)));
      const pages = await page.$$('.a4-page');
      expect(pages, '28 阶段：预计页数 = 实际出纸').toHaveLength(expectedPages);
      const info = await page.evaluate(() => {
        const gantts = Array.from(document.querySelectorAll('.print-gantt')) as HTMLElement[];
        return gantts.map((g) => ({
          cont: g.getAttribute('data-gantt-cont') === 'true',
          rows: g.querySelectorAll('.print-gantt__row').length,
          firstNo: g.querySelector('.print-gantt__no')?.textContent ?? '',
          lastNo:
            Array.from(g.querySelectorAll('.print-gantt__no')).pop()?.textContent ?? '',
          ticks: g.querySelectorAll('[data-print-month-tick]').length,
          legend: g.querySelectorAll('.print-gantt__legend').length,
          // 「（续）」标记住**轴首列**（轴尾列会被靠右缘的月份刻度文字越界占用，
          // 实测叠字 ⇒ 挪到永远空的站号位）
          contMark: g.querySelector('.print-gantt__cont')?.textContent ?? '',
          tail: g.querySelector('.print-gantt__tail')?.textContent ?? '',
          height: Math.round(g.getBoundingClientRect().height),
        }));
      });
      expect(info, 'B2 分两段（首页 + 续页）').toHaveLength(2);
      expect(info[0], '首段：13 行、有图例、无「（续）」').toMatchObject({
        cont: false,
        rows: 13,
        firstNo: '01',
        lastNo: '13',
        legend: 1,
        contMark: '',
        tail: '',
      });
      expect(info[1], '续段：15 行、无图例、轴首「（续）」、行号接得上').toMatchObject({
        cont: true,
        rows: 15,
        firstNo: '14',
        lastNo: '28',
        legend: 0,
        contMark: '（续）',
        tail: '',
      });
      expect(info[0]!.ticks, '两段都带自己的月份刻度（同一坐标系）').toBeGreaterThan(0);
      expect(info[1]!.ticks).toBe(info[0]!.ticks);
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(Math.abs(box!.width - 794)).toBeLessThanOrEqual(1);
        expect(box!.height, `第 ${i + 1} 页溢出即红`).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({ path: join(OUT_DIR, `density-a-cont-p${i + 1}.png`) });
      }
    } finally {
      await page.close();
    }
  });

  it('A 版 B2 行高可读性：**文字行盒不超出被压矮的轨道行**（净空 ≥ 0，20 / 23 阶段两档）', async () => {
    /*
     * 这条锁的是 2026-10-13 批 A 裁决里的「实测可读下限」：行高被压缩时，
     * 若字号不跟着降，相邻两行的文字行盒会**叠在一起**（真机实测 12px 行 +
     * 12px 名称 ⇒ 净空 −6px；14px ⇒ −4px）。故判据写死为机器可测的形式：
     *   `.print-gantt__no` / `.print-gantt__name` 的行盒 ≤ 该行行高（+0.5px 亚像素容差）
     * 覆盖两档：20 阶段（pitch 19，compact 档）与 23 阶段（pitch 16，单页档下界）。
     */
    const css = builtCss();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      for (const n of [20, 23]) {
        const base = buildVm();
        const vm = {
          ...base,
          stages: Array.from({ length: n }, (_, i) => {
            const b = base.stages[i % base.stages.length]!;
            return { ...b, id: `stg_read_${i + 1}`, orderIndex: i + 1, name: `${i + 1}·${b.name}` };
          }),
        } as typeof base;
        const markup = renderToStaticMarkup(
          createElement(SwissScheduleDocument, {
            vm,
            palette: PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline,
          }),
        );
        await page.goto('file://' + writeHtml(`a-readability-${n}.html`, shell(markup, css, false)));
        const r = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('.print-gantt__row')) as HTMLElement[];
          const first = rows[0];
          if (!first) return null;
          const h = (sel: string): number => {
            const el = first.querySelector(sel) as HTMLElement | null;
            return el ? Math.round(el.getBoundingClientRect().height * 100) / 100 : -1;
          };
          // 相邻两行的名称文字盒之间的净空（负值 = 叠字）
          const nameOf = (i: number): DOMRect | null => {
            const el = rows[i]?.querySelector('.print-gantt__name') as HTMLElement | null;
            return el ? el.getBoundingClientRect() : null;
          };
          const a = nameOf(0);
          const b = nameOf(1);
          return {
            rowH: Math.round(first.getBoundingClientRect().height * 100) / 100,
            nameBox: h('.print-gantt__name'),
            noBox: h('.print-gantt__no'),
            density: (first.closest('.print-gantt') as HTMLElement).getAttribute('data-density') ?? '',
            pitch: first.style.height,
            gap: a && b ? Math.round((b.y - (a.y + a.height)) * 100) / 100 : -999,
            rows: rows.length,
          };
        });
        expect(r, `${n} 阶段应有甘特行`).not.toBeNull();
        expect(r!.rows, `${n} 阶段：全部轨道行都在首页`).toBe(n);
        // 判据：文字行盒 ≤ 行高（+0.5 亚像素），且相邻两行名称盒净空 ≥ 0
        expect(r!.noBox, `${n} 阶段：号码行盒 ${r!.noBox} ≤ 行高 ${r!.rowH}`).toBeLessThanOrEqual(
          r!.rowH + 0.5,
        );
        expect(r!.nameBox, `${n} 阶段：名称行盒 ${r!.nameBox} ≤ 行高 ${r!.rowH}`).toBeLessThanOrEqual(
          r!.rowH + 0.5,
        );
        expect(r!.gap, `${n} 阶段：相邻两行名称盒净空不得为负（叠字）`).toBeGreaterThanOrEqual(0);
        expect(r!.pitch, '行高经内联几何落到 DOM').toBe(r!.rowH + 'px');
      }
    } finally {
      await page.close();
    }
  });

  it('A 版 B2 甘特实测几何：刻度不被抽稀吞掉、条带不越轨道、最小可见宽 ≥2.5%', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline;
    const markup = renderToStaticMarkup(
      createElement(SwissScheduleDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('a-gantt-geom.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);

      const geom = await page.evaluate(() => {
        const first = document.querySelector('.a4-page')!;
        const gantt = first.querySelector('.print-gantt') as HTMLElement;
        if (!gantt) throw new Error('B2 甘特不在首页上');
        const tickEls = Array.from(gantt.querySelectorAll('[data-print-month-tick]')) as HTMLElement[];
        const trackEls = Array.from(gantt.querySelectorAll('.print-gantt__track')) as HTMLElement[];
        const barEls = Array.from(gantt.querySelectorAll('[data-print-gantt-bar]')) as HTMLElement[];
        const rectOf = (el: HTMLElement): DOMRect => el.getBoundingClientRect();
        return {
          viewDays: Number(gantt.getAttribute('data-view-days')),
          trackWidth: rectOf(trackEls[0]!).width,
          ticks: tickEls.map((el) => ({
            text: (el.textContent ?? '').trim(),
            left: Number.parseFloat(el.getAttribute('data-tick-left') ?? 'NaN'),
            // 刻度**可见性**：真实盒宽 > 0 且左缘落在轨道内（抽稀吞掉时这条会红）
            boxW: rectOf(el).width,
            xInTrack: rectOf(el).x - rectOf(trackEls[0]!).x,
          })),
          bars: barEls.map((el) => {
            const style = el.style;
            const r = rectOf(el);
            const t = rectOf(el.parentElement as HTMLElement);
            return {
              title: el.getAttribute('title') ?? '',
              left: Number.parseFloat(style.left),
              width: Number.parseFloat(style.width),
              // 实测像素级：条不越出轨道（含 1px 边框的容差）
              overflowLeftPx: t.x - r.x,
              overflowRightPx: r.x + r.width - (t.x + t.width),
              widthPx: r.width,
            };
          }),
        };
      });

      expect(geom.viewDays, 'B2 的窗口天数应由派生层给出').toBeGreaterThan(0);
      expect(geom.trackWidth, '轨道应有可测宽度').toBeGreaterThan(100);
      expect(geom.ticks.length, '9 阶段的项目应有月份刻度').toBeGreaterThan(0);
      for (const t of geom.ticks) {
        expect(t.text, '刻度应有文案（不被抽稀吞成空）').toMatch(/^\d{4}年\d{1,2}月$/);
        expect(t.boxW, `刻度「${t.text}」的盒宽应 > 0`).toBeGreaterThan(0);
        expect(t.xInTrack, `刻度「${t.text}」不得不合理地左越轨道`).toBeGreaterThanOrEqual(-1);
        expect(Number.isFinite(t.left), `刻度「${t.text}」的 left 应是数值`).toBe(true);
      }
      expect(geom.bars.length, '每月阶段一条轨道条').toBe(9);
      for (const b of geom.bars) {
        const name = b.title.split('（')[0] ?? '';
        // 内联几何（%）：不越轨道
        expect(b.left, `${name}：left ≥ 0`).toBeGreaterThanOrEqual(0);
        expect(b.left + b.width, `${name}：left + width ≤ 100（不越轨道）`).toBeLessThanOrEqual(
          100.0001,
        );
        expect(b.width, `${name}：最小可见宽 ≥ 2.5%`).toBeGreaterThanOrEqual(2.5);
        expect(Number.isFinite(b.left) && Number.isFinite(b.width), `${name}：几何非 NaN`).toBe(true);
        // 实测像素：条不越出它的轨道（容差 1.5px = 边框 + 亚像素）
        expect(b.overflowLeftPx, `${name}：左端不越出轨道`).toBeLessThanOrEqual(1.5);
        expect(b.overflowRightPx, `${name}：右端不越出轨道`).toBeLessThanOrEqual(1.5);
      }
    } finally {
      await page.close();
    }
  });

  it('A 版五块形态：套预设变体（站台蓝）逐页彩色；深色纸仍 794×1123 无裁切', async () => {
    const css = builtCss();
    const vm = buildVm();
    const preset = PRINT_TEMPLATE_PALETTES['swiss-schedule'].presets.find((p) => p.id === 'platform-blue')!;
    const markup = renderToStaticMarkup(
      createElement(SwissScheduleDocument, { vm, palette: preset.palette }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('a-preset-platform-blue.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const pages = await page.$$('.a4-page');
      expect(pages, '预设变体不改变页数（装配层同源）').toHaveLength(
        swissBlockPages(vm, DEFAULT_SCHEDULE_PAPER_BLOCKS).length,
      );
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(Math.abs(box!.width - 794)).toBeLessThanOrEqual(1);
        expect(box!.height).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({ path: join(OUT_DIR, `a-preset-p${i + 1}-color.png`) });
      }
      // 预设真的挂上了（深色纸 + 浅色字），不是默认态重截
      const bg = await page.$eval('.a4-page', (el) => getComputedStyle(el).backgroundColor);
      expect(bg, '站台蓝预设的纸面应为深蓝 #16324F').toBe('rgb(22, 50, 79)');
    } finally {
      await page.close();
    }
  });

  it('A 版板头完成度巨字（P0-3）：82px 定值 / 右对齐至内容框右缘 / 等宽数字', async () => {
    const css = builtCss();
    const vm = buildVm();
    const markup = renderToStaticMarkup(
      createElement(SwissScheduleDocument, {
        vm,
        palette: PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline,
      }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('a-masthead-anchor.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);

      // 坐标一律换算到「页内原点」（页左上为 0,0），免得受视口/外框影响
      const m = await page.evaluate(() => {
        const first = document.querySelector('.a4-page')!;
        const pct = first.querySelector('.swiss-masthead__pct') as HTMLElement;
        const anchor = first.querySelector('.swiss-masthead__anchor') as HTMLElement;
        const rule = first.querySelector('.swiss-masthead__rule') as HTMLElement;
        const cs = getComputedStyle(pct);
        const pageX = first.getBoundingClientRect().x;
        return {
          text: pct.textContent ?? '',
          fontSize: Number.parseFloat(cs.fontSize),
          fontVariantNumeric: cs.fontVariantNumeric,
          anchorTextAlign: getComputedStyle(anchor).textAlign,
          rightEdge: pct.getBoundingClientRect().right - pageX,
          ruleRightEdge: rule.getBoundingClientRect().right - pageX,
        };
      });

      expect(m.text, '板头巨字应是完成度百分数').toMatch(/^\d+%$/);
      // 定值断言（不是 ≥ 下界）：参考稿 A P1 实测巨字 cap 61px ⇒ 规格 §2.A P0-3 落值 82px。
      // 此前这条值**没有任何断言守着**——2026-10-11 独立验证 worker 把它腰斩到 40px，
      // print-a4-visual + swiss-schedule-document + print-final-verify + print-palette
      // 4 文件 / 32 tests 全绿。故这里钉死，不用区间。
      expect(m.fontSize, '板头完成度巨字应 82px（参考稿 cap 61px ⇒ 82px，规格 §2.A P0-3）').toBe(82);
      expect(m.fontVariantNumeric, '巨字应等宽数字（P0-3 数字纪律）').toBe('tabular-nums');
      expect(m.anchorTextAlign, '巨字块应右对齐（P0-3）').toBe('right');
      // 右缘：参考稿实测 x753.5（页面 794 宽 − 内容框内缩 40 ⇒ 754），容差 1px
      expect(
        Math.abs(m.rightEdge - 753.5),
        `巨字右缘应在参考稿的 x753.5 上（实测 ${m.rightEdge}）`,
      ).toBeLessThanOrEqual(1);
      // 与 2px 通栏线右端齐平：这是「右对齐」的版面判据，比绝对坐标更抗布局微调
      expect(
        Math.abs(m.rightEdge - m.ruleRightEdge),
        '巨字右缘应与 2px 通栏线右端齐平（同一内容框右缘）',
      ).toBeLessThanOrEqual(0.5);
    } finally {
      await page.close();
    }
  });

  it('配色硬闸门：踩线组合被禁存（UI 呈现 + store 拒绝，双证据）', async () => {
    const css = builtCss();
    // 踩线草稿：三枚都取浅色（浅黄纸 + 白字 + 白栏）。经 initialPalette 进编辑器——
    // SSR 下 zustand 读 getInitialState，store setState 不进渲染，故草稿走 prop
    // （保存路径的 store 级拒绝由 print-options.spec ⑦ 经真实 action 锁）。
    const failing = { accent: '#FFF8E1', ink: '#FFFFFF', line: '#FFFFFF' };
    const markup = renderToStaticMarkup(
      createElement(PaletteSection, {
        template: 'swiss-schedule',
        defaultOpen: true,
        initialPalette: failing,
      }),
    );

    const page = await browser.newPage({ viewport: { width: 480, height: 720 } });
    try {
      const htmlPath = writeHtml('a-palette-gate-blocked.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const blocked = await page.$('[data-print-palette-blocked]');
      expect(blocked, '踩线组合必须显示禁存提示').not.toBeNull();
      const msg = (await blocked!.textContent()) ?? '';
      // 指名哪一对不达标 + 当前比值多少（决策文档 §3.2：不许打折成泛泛一句）
      expect(msg).toContain('已禁止保存');
      expect(msg).toContain('栏内反白字 vs 栏底');
      expect(msg).toMatch(/\d+\.\d+:1/);
      // 保存钮禁用（硬阻断）
      const saveDisabled = await page.$eval('[data-print-palette-save]', (el) =>
        (el as HTMLButtonElement).disabled,
      );
      expect(saveDisabled).toBe(true);
      await (await page.$('[data-print-palette-section]'))!.screenshot({
        path: join(OUT_DIR, 'a-palette-gate-blocked.png'),
      });
    } finally {
      await page.close();
    }
  });
});
