/**
 * E 版 A4 视觉验收（批 3：真构建产物 + 真 Chromium 实测，不真打黑白打印机）。
 *
 * ── 为什么这样做验收 ──
 * 产品决策文档批 3 要求「E 彩色 3 + 灰度 3」，01 §9 要求「长阶段名、
 * 20+ 阶段、空产出物均有稳定处理」。灰度走「纸面套 filter:grayscale(1)」
 * ——与预览面板「灰度」toggle 同一机制（决策文档 §3.2-②）。
 *
 * ── 方法（与 print-a4-visual.spec.ts / print-a4-visual-d.spec.ts 同范式）──
 * ① 用**真实组件**（EditorialIndexDocument）+ **真实 VM 装配**
 *    （buildPrintViewModel）经 renderToStaticMarkup 出静态纸面；
 * ② 外挂 **真实构建产物**的 CSS（build-dist/assets/*.css——E 版样式与亮色
 *    锁都在里面），保证测的是打包后的规则而不是源码顺序；
 * ③ 真 Chromium 逐页截图，并断言每页 794×1123 **无裁切**（盒子超高即红）。
 *
 * 夹具覆盖批 3 点名的面：9 阶段四态齐全（默认三页）、**30 阶段长目录**
 * （跨页分页：续头 / 页码连续 / 行不裂）、Agent 行朱红 + 文字签、
 * 无产出物空态、预设变体（靛蓝）。
 *
 * 前置：`npm run build --outDir build-dist`（产物在 build-dist/）与本机
 * chromium；缺任一则整组 skip（与另两份视觉 spec 同口径）。
 *
 * 产物落点：`outputs/print-a4-shots/`（工作区交付目录，不进 git）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';

import { EditorialIndexDocument } from '../src/print/documents/EditorialIndexDocument';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { paginateEiEntries } from '../src/print/pages/editorial-index/shared';
import type { EiEntry } from '../src/print/pages/editorial-index/shared';
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

/** 拼接全部构建产物 CSS（E 版样式 + 亮色锁 + 主题令牌都在里面） */
function builtCss(): string {
  const assets = join(ROOT, 'build-dist', 'assets');
  return readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assets, f), 'utf-8'))
    .join('\n');
}

/* ------------------------------------------------------------------ 夹具（真实形状） */

const TODAY = '2026-10-09';
const PROJECT_ID = 'proj_e3';

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
  id: 'm-e3-human',
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
  id: 'm-e3-agent',
  name: '小 Agent',
  role: '自动执行体',
  contact: null,
  avatarColor: '#3D6B5B',
  active: true,
  roleKind: MemberRoleKind.Member,
  passwordHash: null,
  actorKind: MemberActorKind.Agent,
  // agentKind 开放字符串：未知值原样显示（01 §3.2）
  agentKind: 'brand-new-harness-9000',
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

/** 阶段四态轮换（9 个：3 进行中 / 2 延期 / 2 未开始 / 2 已完成） */
function stageStatusOf(n: number): StageStatus {
  switch (n % 9) {
    case 1:
    case 4:
    case 7:
      return StageStatus.InProgress;
    case 2:
    case 5:
      return StageStatus.Delayed;
    case 3:
    case 6:
      return StageStatus.NotStarted;
    default:
      return StageStatus.Completed;
  }
}

/** n 个可见阶段（orderIndex 1..n；2/5 延期，Agent 负责 2 个） */
function makeStages(n: number): Stage[] {
  return Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    return {
      id: `stg_e3_${k}`,
      projectId: PROJECT_ID,
      orderIndex: k,
      templateKey: null,
      colorIndex: ((k - 1) % 9) + 1,
      customColor: null,
      name: `阶段${k}·${k % 2 === 0 ? '方案深化与图纸会审' : '现场勘查'}`,
      ratioPercent: 10,
      startAt: '2026-01-05T00:00:00Z',
      endAt: '2026-01-20T23:59:59Z',
      status: stageStatusOf(k),
      // Agent 负责阶段 2 / 5（朱红纪律的 Agent 来源面）
      ownerId: k === 2 || k === 5 ? AGENT.id : HUMAN.id,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    };
  });
}

/** 任务（每阶段 1 条；6 条带产出物，其中 2 条 Agent 来源） */
function makeTasks(stages: Stage[]): Task[] {
  return stages.map((s, i) => {
    const n = i + 1;
    const agentSource = n === 2 || n === 5;
    const withArtifacts = n <= 6;
    return {
      id: `tsk_e3_${n}`,
      taskNo: 1000 + n,
      projectId: PROJECT_ID,
      stageId: s.id,
      title: `任务${n}·整理测绘图与材料清单并同步给施工方确认`,
      done: false,
      assigneeId: HUMAN.id,
      assigneeIds: agentSource ? [AGENT.id] : [HUMAN.id],
      dueDate: null,
      source: agentSource ? 'agent' : 'human',
      externalId: null,
      agentId: agentSource ? AGENT.id : null,
      status: TaskStatus.InProgress,
      description: null,
      dependsOn: [],
      artifacts: withArtifacts
        ? [
            { id: `art_e3_${n}_1`, kind: n % 2 === 0 ? 'doc' : 'task_md', title: '会议纪要', path: null, url: null, note: null },
            { id: `art_e3_${n}_2`, kind: 'file', title: '测绘图与工程量清单', path: null, url: null, note: null },
          ]
        : [],
      startAt: null,
      claimedAt: null,
      runId: null,
      orderIndex: 1,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    } satisfies Task;
  });
}

const LOGS: StageLog[] = [
  {
    id: 'log_e3_1',
    stageId: 'stg_e3_2',
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

/** 默认夹具 VM（9 阶段；三页各一物理页） */
function buildVm(stageCount = 9): ReturnType<typeof buildPrintViewModel> {
  const stages = makeStages(stageCount);
  return buildPrintViewModel({
    project: PROJECT,
    stages,
    tasks: makeTasks(stages),
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

/** 逐页断言 794×1123 无裁切 + 截图；返回页数 */
async function assertPagesAndShot(
  page: import('playwright-core').Page,
  tag: string,
  expected: number,
): Promise<number> {
  const pages = await page.$$('.a4-page');
  expect(pages, `E 版应渲染 ${expected} 页`).toHaveLength(expected);
  for (let i = 0; i < pages.length; i++) {
    const el = pages[i]!;
    const box = await el.boundingBox();
    expect(box, `第 ${i + 1} 页应有布局盒`).not.toBeNull();
    // 794×1123 无裁切：盒宽必须精确 794；盒高超过 1123 = 内容溢出（裁切/孤儿页脚风险）
    expect(Math.abs(box!.width - 794), `第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
    expect(box!.height, `第 ${i + 1} 页高应恰 1123（溢出即红）`).toBeLessThanOrEqual(1124);
    expect(box!.height, `第 ${i + 1} 页高不得低于 1123`).toBeGreaterThanOrEqual(1122);
    await el.screenshot({ path: join(OUT_DIR, `e-default-p${i + 1}-${tag}.png`) });
  }
  return pages.length;
}

/* ------------------------------------------------------------------ 验收 */

describe('E 版长列表分页器（纯函数：章头不孤儿 / 行不裂 / 续头只标真跨页）', () => {
  /** 造条目序列：chapters = [章名, 行数]，行内容用行名 */
  function seq(chapters: Array<[string, number]>): EiEntry<string>[] {
    const out: EiEntry<string>[] = [];
    for (const [name, rows] of chapters) {
      out.push({ kind: 'chapter', chapter: { label: name, count: rows } });
      for (let i = 1; i <= rows; i++) out.push({ kind: 'row', row: `${name}-${i}` });
    }
    return out;
  }

  const labelsOf = (page: EiEntry<string>[]): string[] =>
    page.map((e) => (e.kind === 'chapter' ? `#${e.chapter!.label}` : e.row!));

  it('章跨页 ⇒ 新页补「（续）」头且不重复原章头；章齐页边界 ⇒ 标新章头不标续', () => {
    // 容量 100：章头 20 + 行 30。chA 4 行 ⇒ 页1 装 章+2 行，页2 = 续头+2 行
    const pages = paginateEiEntries({ entries: seq([['A', 4]]), rowHeight: 30, chapterHeight: 20, bodyHeight: 100 });
    expect(pages).toHaveLength(2);
    expect(labelsOf(pages[0]!)).toEqual(['#A', 'A-1', 'A-2']);
    expect(labelsOf(pages[1]!)).toEqual(['#A（续）', 'A-3', 'A-4']);

    // 章恰好在页边界整章开始：chA 3 行正好装满页1（20+3×30=110 > 100？不，
    // 20+2×30=80 ≤ 100，+30=110 > 100 ⇒ 页1 = 章+2 行）——改用 20+30×2=80，
    // chA 2 行整章落在页1；chB 从页2 整章开始，不得标「（续）」
    const pages2 = paginateEiEntries({
      entries: seq([
        ['A', 2],
        ['B', 2],
      ]),
      rowHeight: 30,
      chapterHeight: 20,
      bodyHeight: 100,
    });
    expect(labelsOf(pages2[0]!)).toEqual(['#A', 'A-1', 'A-2']);
    expect(labelsOf(pages2[1]!)).toEqual(['#B', 'B-1', 'B-2']);
    expect(pages2[1]!.some((e) => e.kind === 'chapter' && e.chapter!.label.includes('（续）'))).toBe(false);
  });

  it('章头不孤儿 + 行不裂：每页章头后必有行；全部行一条不丢', () => {
    const chapters: Array<[string, number]> = [
      ['A', 5],
      ['B', 5],
      ['C', 5],
    ];
    const pages = paginateEiEntries({ entries: seq(chapters), rowHeight: 30, chapterHeight: 20, bodyHeight: 130 });
    const allRows: string[] = [];
    for (const p of pages) {
      const labels = labelsOf(p);
      // 章头不得是页尾最后一个元素（不孤儿）
      for (let i = 0; i < labels.length; i++) {
        if (labels[i]!.startsWith('#')) {
          expect(i, '章头后必须有行').toBeLessThan(labels.length - 1);
        }
      }
      allRows.push(...labels.filter((l) => !l.startsWith('#')));
    }
    // 15 行全部上纸（章头标签不计）
    expect(allRows).toHaveLength(15);
    expect(new Set(allRows).size).toBe(15);
  });

  it('空条目序列 ⇒ 一页空序列（不出零页纸面）', () => {
    const pages = paginateEiEntries({ entries: [], rowHeight: 30, chapterHeight: 20, bodyHeight: 100 });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual([]);
  });
});

describe.skipIf(!CAN_RUN)('E 版 A4 视觉验收 · 批 3（真 Chromium + 真实构建 CSS）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('E 版三页：默认态彩色 3 张 + 灰度 3 张；794×1123 无裁切', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['editorial-index'].baseline;
    const markup = renderToStaticMarkup(
      createElement(EditorialIndexDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const gray of [false, true]) {
        const htmlPath = writeHtml(
          gray ? 'e-default-gray.html' : 'e-default-color.html',
          shell(markup, css, gray),
        );
        await page.goto('file://' + htmlPath);
        await assertPagesAndShot(page, gray ? 'gray' : 'color', 3);
      }
    } finally {
      await page.close();
    }
  });

  it('E 版长目录分页：31 阶段 ⇒ 阶段目录跨页稳定（续头只标真跨页 / 页码连续 / 行不裂）', async () => {
    const css = builtCss();
    const vm = buildVm(31);
    const baseline = PRINT_TEMPLATE_PALETTES['editorial-index'].baseline;
    const markup = renderToStaticMarkup(
      createElement(EditorialIndexDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('e-longlist.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);

      // 物理页 > 3：阶段目录跨页（31 行紧凑档仍超一页），成员/产出物各一页
      const pages = await page.$$('.a4-page');
      expect(pages.length, '31 阶段长目录应跨页（>3 物理页）').toBeGreaterThan(3);

      // 每页无溢出 + 截图（长目录也逐页截，交付物同目录）
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(Math.abs(box!.width - 794), `长目录第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
        expect(box!.height, `长目录第 ${i + 1} 页溢出即红`).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({ path: join(OUT_DIR, `e-longlist-p${i + 1}-color.png`) });
      }

      // 跨页续头：第二阶段顶部有「（续）」章头（翻页读者看得见自己在哪一章）
      const stagePages = await page.$$('[data-print-page="stage-index"]');
      expect(stagePages.length, '阶段目录应占 ≥2 个物理页').toBeGreaterThanOrEqual(2);
      const p2Text = (await stagePages[1]!.textContent()) ?? '';
      expect(p2Text, '跨页章补「（续）」续头').toContain('（续）');
      // 续头只标真跨页：恰好一枚（未开始章跨页）；齐页边界整章开始的章不标续
      const contHeads = await stagePages[1]!.$$eval('.ei-chapter', (els) =>
        els.filter((e) => (e.textContent ?? '').includes('（续）')).length,
      );
      expect(contHeads, '续头只标真跨页的章（恰好 1 枚）').toBe(1);
      const p1Text = (await stagePages[0]!.textContent()) ?? '';
      expect(p1Text, '第一页不得出现续头').not.toContain('（续）');

      // 页码连续：第 2 阶段页的物理页码 = 2（第 1 页是阶段目录首页）
      const pageIdx = await stagePages[1]!.getAttribute('data-page-index');
      expect(pageIdx).toBe('1');
      expect(p2Text).toContain('第 2 / ');
      // 首页页码 1 / 总数一致；第二页与总数相同（连续编号）
      expect(p1Text).toContain('第 1 / ');
      const totalMatch = p1Text.match(/第 1 \/ (\d+) 页/);
      expect(totalMatch, '首页应带「第 1 / N 页」').not.toBeNull();
      expect(p2Text).toContain(`第 2 / ${totalMatch![1]} 页`);

      // 行不裂：两页的阶段行都在（31 行全部上纸，无丢行）
      const rows = await page.$$eval('[data-print-page="stage-index"] .ei-row', (els) => els.length);
      expect(rows, '31 个阶段行全部上纸').toBe(31);

      // 章头不孤儿：每个物理页的章头后面都有行（章头不是页尾最后一个元素）
      for (let i = 0; i < stagePages.length; i++) {
        const lastIsChapter = await stagePages[i]!.evaluate((el) => {
          const rowsIn = el.querySelectorAll('.ei-row');
          const chapters = el.querySelectorAll('.ei-chapter');
          return chapters.length > 0 && rowsIn.length === 0;
        });
        expect(lastIsChapter, `第 ${i + 1} 阶段页不得只有章头没有行`).toBe(false);
      }
    } finally {
      await page.close();
    }
  });

  it('E 版视觉纪律：大编号独立列 / 朱红有界 / 无底部黑栏 / 发丝线分组', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['editorial-index'].baseline;
    const markup = renderToStaticMarkup(
      createElement(EditorialIndexDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('e-default-color.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const p1 = await page.$('[data-print-page="stage-index"]');
      expect(p1, 'P1 阶段目录页应在').not.toBeNull();

      // ① 大编号是**独立 DOM 列**（02 §6 禁伪元素）：.ei-row__no 元素存在且
      //    文本 = 补零 orderIndex；伪元素生成的编号进不了 DOM（可访问性/分页稳定）
      const nos = await p1!.$$eval('.ei-row__no', (els) => els.map((e) => e.textContent ?? ''));
      expect(nos.length, '9 个阶段行各一枚编号').toBe(9);
      // 章序 = 进行中 → 延期 → 未开始 → 已完成（目录跳读优先级）；章内按 orderIndex
      expect(nos, '编号列按章序排列，巨编号即真实 orderIndex').toEqual([
        '01',
        '04',
        '07',
        '02',
        '05',
        '03',
        '06',
        '08',
        '09',
      ]);
      // 编号列的字体确实变大（视觉锚点）：≥20px
      const noFont = await p1!.$eval('.ei-row__no', (el) => parseFloat(getComputedStyle(el).fontSize));
      expect(noFont, '巨编号 ≥20px').toBeGreaterThanOrEqual(20);

      // ② 朱红有界：延期章/Agent 行走朱红，但整页不是单色红（近黑元素仍在）
      const accent = await p1!.$eval('.ei-chapter[data-focus] .ei-chapter__label', (el) =>
        getComputedStyle(el).color,
      );
      expect(accent, '延期章头应为朱红 #C8102E').toBe('rgb(200, 16, 46)');
      const inkCount = await p1!.$$eval('.ei-row__name', (els) =>
        els.filter((e) => getComputedStyle(e).color === 'rgb(20, 20, 20)').length,
      );
      expect(inkCount, '近黑正文元素仍在（整页不许单色红）').toBeGreaterThan(0);
      // Agent 负责阶段：负责人名朱红 + 「Agent」文字签（双编码，灰度可辨）
      const agentOwner = await p1!.$eval('.ei-row__owner[data-agent]', (el) => ({
        color: getComputedStyle(el).color,
        text: el.textContent ?? '',
      }));
      expect(agentOwner.color).toBe('rgb(200, 16, 46)');
      expect(agentOwner.text).toContain('Agent');

      // ③ 无底部黑栏：页脚背景透明，且页内无「通栏近黑填充」元素
      const footBg = await p1!.$eval('.ei-foot', (el) => getComputedStyle(el).backgroundColor);
      expect(footBg, '页脚无黑栏（背景透明）').toBe('rgba(0, 0, 0, 0)');
      const blackBars = await p1!.$$eval('*', (els) =>
        els.filter((e) => {
          const s = getComputedStyle(e);
          return s.backgroundColor === 'rgb(20, 20, 20)' && e.clientWidth > 600;
        }).length,
      );
      expect(blackBars, 'E 版任何页面不得出现通栏黑栏').toBe(0);

      // ④ 发丝线分组：条目行底线 1px 线色；章头 2px 近黑粗章节线
      const rowBorder = await p1!.$eval('.ei-row', (el) => {
        const s = getComputedStyle(el);
        return { w: s.borderBottomWidth, c: s.borderBottomColor };
      });
      expect(rowBorder.w).toBe('1px');
      expect(rowBorder.c).toBe('rgb(207, 200, 188)');
      const chapterBorder = await p1!.$eval('.ei-chapter', (el) => {
        const s = getComputedStyle(el);
        return { w: s.borderTopWidth, c: s.borderTopColor };
      });
      expect(chapterBorder.w).toBe('2px');
      expect(chapterBorder.c).toBe('rgb(20, 20, 20)');

      // ⑤ 纸面是暖浅纸面 #FAF7F2（模板身份，不开槽位）
      const paper = await p1!.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(paper, 'E 版纸面应为暖浅纸 #FAF7F2').toBe('rgb(250, 247, 242)');

      // ⑥ 口径注上纸：占比 ≠ 完成度（01 §3.1 防误读，每页可独立解释）
      const p1Text = (await p1!.textContent()) ?? '';
      expect(p1Text).toContain('占比 = 阶段工作量分配（ratioPercent），不等于完成度');
    } finally {
      await page.close();
    }
  });

  it('E 版预设变体（靛蓝）彩色 3 张；焦点槽位确实挂上（非默认态重截）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const preset = PRINT_TEMPLATE_PALETTES['editorial-index'].presets.find((p) => p.id === 'indigo')!;
    const markup = renderToStaticMarkup(
      createElement(EditorialIndexDocument, { vm, palette: preset.palette }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('e-preset-indigo.html', shell(markup, css, false));
        await page.goto('file://' + htmlPath);
        const pages = await page.$$('.a4-page');
        expect(pages).toHaveLength(3);
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(Math.abs(box!.width - 794)).toBeLessThanOrEqual(1);
        expect(box!.height).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({ path: join(OUT_DIR, `e-preset-p${i + 1}-color.png`) });
      }
      // 预设真的挂上了：延期章头取靛蓝 #2B4ACB（不是默认朱红）
      const accent = await page.$eval('.ei-chapter[data-focus] .ei-chapter__label', (el) =>
        getComputedStyle(el).color,
      );
      expect(accent, '靛蓝预设的焦点色应为 #2B4ACB').toBe('rgb(43, 74, 203)');
      // 纸面仍是暖浅纸（paper 不开槽位，E 的身份）
      const paper = await page.$eval('.a4-page', (el) => getComputedStyle(el).backgroundColor);
      expect(paper).toBe('rgb(250, 247, 242)');
    } finally {
      await page.close();
    }
  });

  it('E 版空态：无可见阶段 ⇒ P1 明确空态（02 §8 文案，不造数据填版）', async () => {
    const css = builtCss();
    // 空阶段 VM：项目在、阶段全隐藏
    const vm = buildPrintViewModel({
      project: PROJECT,
      stages: [],
      tasks: [],
      members: [HUMAN, AGENT],
      stageLogs: [],
      role: MemberRoleKind.Admin,
      currentMemberId: HUMAN.id,
      todayIso: TODAY,
      now: new Date('2026-10-09T07:30:00Z'),
    });
    const baseline = PRINT_TEMPLATE_PALETTES['editorial-index'].baseline;
    const markup = renderToStaticMarkup(
      createElement(EditorialIndexDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('e-empty.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      // 三个逻辑页都出纸（页头页脚齐全），主体全是标准空态文案
      const pages = await page.$$('.a4-page');
      expect(pages).toHaveLength(3);
      const empties = await page.$$('[data-print-empty]');
      expect(empties.length, '三页各一条空态').toBe(3);
      const text = (await page.textContent('body')) ?? '';
      expect(text).toContain('当前可见范围内无阶段');
      expect(text).toContain('当前可见范围内无相关成员');
      expect(text).toContain('当前可见任务暂无产出物');
      // 空态页也不许溢出
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(box!.height).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({ path: join(OUT_DIR, `e-empty-p${i + 1}-color.png`) });
      }
    } finally {
      await page.close();
    }
  });
});
