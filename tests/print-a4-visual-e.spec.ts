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
 * 夹具覆盖批 3 点名的面：9 阶段四态齐全（默认三页）、**30+ 阶段长目录**
 * （跨页分页：行不裂 / 页码连续 / 每页自带刊头）、Agent 行赭红 + 文字签、
 * 无产出物空态、预设变体（靛蓝）。
 *
 * 2026-10-11 P0-12~P0-16 向参考稿还原后本 spec 的新语义：
 *   · 页题由单行 27px 无衬线 → **两行 92px 衬线**（行1 墨 / 行2 焦点色）；
 *   · 刊头下的章节线由 1px 发丝线 → **5px 近黑**；
 *   · 巨编号 24 → **50px**，且**行序回到 orderIndex 连续 01→09**
 *     ⇒ 阶段目录上**不再有 `.ei-chapter` 章头与「（续）」续头**，
 *        跨页身份改由「每页自带的刊头 + 页脚第 N / M 页」承担（规格 §3.3
 *        「登四态 + 行序连续」）；
 *   · 纸底 `#FAF7F2 → #F5F2EC`、焦点色 `#C8102E → #B04A2F`、
 *     发丝线 `#CFC8BC → #CFC6B4`（连带：原线色对新纸底只有 1.487:1，
 *     过不了 `PALETTE_MIN_CONTRAST.line` 的 1.5 硬闸门）；
 *   · 内容区那处多余的 `ID Plan` 文字标已删（页头左格保留唯一一枚）。
 * `paginateEiEntries` 的章头断言仍在（纯函数用例，服务成员/产出物目录页）。
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

import {
  EditorialIndexDocument,
  eiBlockIsCompact,
  eiBlockPages,
} from '../src/print/documents/EditorialIndexDocument';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { paginateEiEntries } from '../src/print/pages/editorial-index/shared';
import type { EiEntry } from '../src/print/pages/editorial-index/shared';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import { buildPrintGantt } from '../src/print/model/print-gantt';
import { DEFAULT_SCHEDULE_PAPER_BLOCKS } from '../src/lib/schedule-print';
import {
  blockRecordOf,
  printTemplateUnitIds,
  resolveUnits,
} from '../src/print/model/print-units';
import type { PrintSheet } from '../src/components/print/print-templates';
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

/**
 * legacy 原生页清单（期三的 sheets 形状）。
 * 2026-10-13 批 C 起 E 走**五块形态**（`usesBlocks`）；原来的三页与通用模块渲染
 * **代码与 spec 全留**（决策 2），只是不再有暴露面 —— 本 spec 里凡要验「原生页
 * 那套版式 / 目录分页器」的用例，都显式传它走 legacy 路径。
 */
const NATIVE_SHEETS: readonly PrintSheet[] = [
  { type: 'native', page: 'stage-index' },
  { type: 'native', page: 'member-index' },
  { type: 'native', page: 'artifact-index' },
];


/** 拼接全部构建产物 CSS（E 版样式 + 亮色锁 + 主题令牌都在里面） */
function builtCss(): string {
  return readBuiltCss(ROOT);
}

/* ------------------------------------------------------------------ 夹具（真实形状） */

const TODAY = '2026-10-09';
const PROJECT_ID = 'proj_e3';

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
    await el.screenshot({ path: join(OUT_DIR, `density3-e-p${i + 1}-${tag}.png`) });
  }
  return pages.length;
}

/* ------------------------------------------------------------------ 验收 */

describe.skipIf(!CAN_RUN)('E 版 · 五块形态（批 C：跨度条 vs 占比 / 块独立 / SHEET / 口径恒在）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  /** 用显式单元集合渲一版（模拟选择器的勾选 ⇒ `resolveUnits` 的结果） */
  function markupWith(ids: readonly string[], vm = buildVm()): string {
    const units = resolveUnits('editorial-index', { units: { 'editorial-index': ids as never } });
    return renderToStaticMarkup(
      createElement(EditorialIndexDocument, {
        vm,
        units,
        palette: PRINT_TEMPLATE_PALETTES['editorial-index'].baseline,
      }),
    );
  }
  const ALL = () => printTemplateUnitIds('editorial-index');
  const blocksOf = (ids: readonly string[]) =>
    blockRecordOf(resolveUnits('editorial-index', { units: { 'editorial-index': ids as never } }));

  /**
   * ★★ 批 C 的验收核心：让「跨度比例」与「占比」**故意不相等**的夹具。
   *   · 阶段 1：跨度 55 天（几乎整窗）/ 占比 5%；
   *   · 阶段 2：跨度 3 天（极短）/ 占比 90%。
   * 若实现把条画成「占比」，两条的长短关系就会**反过来** —— 断言当场红。
   */
  function skewVm() {
    // ⚠️ 必须从**原始实体**（Stage）造，不能从 `buildVm().stages`（那是 PrintStageVM）
    // 里 spread —— VM 阶段没有 `projectId`，适配器的 `s.projectId === project.id`
    // 那道可见性过滤会把它们全滤掉（实测：整个 B2 块不渲染，`tracks[0]` undefined）。
    const raw = makeStages(2);
    const stages: Stage[] = [
      {
        ...raw[0]!,
        id: 'stg_skew_long',
        orderIndex: 1,
        name: '长跨度·低占比',
        ratioPercent: 5,
        startAt: '2026-01-02T00:00:00Z',
        endAt: '2026-02-25T23:59:59Z',
      },
      {
        ...raw[1]!,
        id: 'stg_skew_short',
        orderIndex: 2,
        name: '短跨度·高占比',
        ratioPercent: 90,
        startAt: '2026-01-10T00:00:00Z',
        endAt: '2026-01-12T23:59:59Z',
      },
    ];
    return buildPrintViewModel({
      project: PROJECT,
      stages,
      tasks: [],
      members: [HUMAN, AGENT],
      stageLogs: [],
      role: MemberRoleKind.Admin,
      currentMemberId: HUMAN.id,
      todayIso: TODAY,
      now: new Date('2026-10-09T07:30:00Z'),
    });
  }

  it('★★ 跨度条跟**跨度**、不跟占比（故意不等的夹具）：条长与占比呈反相，且纸面写明口径', async () => {
    const css = builtCss();
    const vm = skewVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      await page.goto(
        'file://' + writeHtml('e-blocks-skew.html', shell(markupWith(ALL(), vm), css, false)),
      );
      const m = await page.evaluate(() => {
        const bars = Array.from(document.querySelectorAll('.ei-span__bar')) as HTMLElement[];
        const tracks = Array.from(document.querySelectorAll('.ei-span__track')) as HTMLElement[];
        const ratios = Array.from(document.querySelectorAll('.ei-index .ei-row__ratio')) as HTMLElement[];
        const caption = document.querySelector('.ei-span__caption')?.textContent ?? '';
        const note = document.querySelector('.ei-note')?.textContent ?? '';
        return {
          trackW: Math.round(tracks[0]!.getBoundingClientRect().width * 100) / 100,
          bars: bars.map((b) => ({
            px: Math.round(b.getBoundingClientRect().width * 10) / 10,
            left: Number.parseFloat(b.getAttribute('data-span-left') ?? 'NaN'),
            width: Number.parseFloat(b.getAttribute('data-span-width') ?? 'NaN'),
          })),
          ratios: ratios.map((r) => (r.textContent ?? '').trim()),
          caption,
          note,
        };
      });
      expect(m.bars.length, '两条跨度条').toBe(2);
      expect(m.ratios, '占比列照旧是数字（与条无关）').toEqual(['5%', '90%']);
      // ① 条长 = 跨度比例 × 轨宽（逐值对账，不是「看着像」）
      for (const b of m.bars) {
        expect(Math.abs(b.px - (b.width / 100) * m.trackW), `条长应等于宽度% × 轨宽`).toBeLessThanOrEqual(
          1.5,
        );
      }
      // ② 关系上「反相」：占比 5% 的长跨度条 ⟫ 占比 90% 的短跨度条
      expect(m.bars[0]!.px, '占比小的那条反而长（条跟跨度）').toBeGreaterThan(m.bars[1]!.px * 5);
      // ③ 与占比例的对比：若按占比画，两条之比应是 5:90 ⇒ 实测必须远大于它
      const bySpan = m.bars[0]!.px / m.bars[1]!.px;
      expect(bySpan, '条长之比 ≈ 跨度之比（不是占比之比 5:90）').toBeGreaterThan(5);
      // ④ 纸面口径：caption 与口径行都要写明「条 = 日期跨度」
      expect(m.caption, 'B2 caption 应写明口径').toContain('条 = 日期跨度');
      expect(m.note, '口径行也应写明（§2.6 原则 1 恒在）').toContain('条 = 日期跨度');
    } finally {
      await page.close();
    }
  });

  it('★ 块独立（严格一一对应）：关 B2 只跨度目录消失、关 B4 只巨编号目录消失，页数各自联动', async () => {
    const css = builtCss();
    const vm = buildVm();
    const all = ALL();
    const noB2 = all.filter((id) => id !== 'timeline');
    const noB4 = all.filter((id) => id !== 'stageTable');
    const expected = {
      all: eiBlockPages(vm, blocksOf(all)).length,
      noB2: eiBlockPages(vm, blocksOf(noB2)).length,
      noB4: eiBlockPages(vm, blocksOf(noB4)).length,
    };
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      await page.goto('file://' + writeHtml('e-blocks-all.html', shell(markupWith(all), css, false)));
      expect(await page.$$('.a4-page')).toHaveLength(expected.all);
      const rowsBefore = (await page.$$('.ei-index .ei-row')).length;
      const barsBefore = (await page.$$('.ei-span__bar')).length;
      expect(rowsBefore, 'B4 行在').toBeGreaterThan(0);
      expect(barsBefore, 'B2 条在').toBeGreaterThan(0);
      // L3 改期记录（B4 的附属件，§0.5）：本夹具带 1 条 StageLog ⇒ **必须**上纸。
      // 这条是「条件分支静默丢内容」的正面锁 —— 少了它，`plan.last` 那条闭包
      // 兜底一旦失效，页数照样对、纸面却少了整张表，没有任何断言会红。
      expect(await page.$$('[data-print-resched]'), 'L3 改期记录在（B4 开着）').toHaveLength(1);
      expect(
        await page.$$eval('[data-print-resched] .ei-l3__row:not(.ei-l3__row--head)', (els) => els.length),
        'L3 有 1 条明细行',
      ).toBe(1);

      // 关 B2 ⇒ 整块跨度目录消失（标尺 + 条都没了），B4 行**逐值不变**
      await page.goto('file://' + writeHtml('e-blocks-no-b2.html', shell(markupWith(noB2), css, false)));
      expect(await page.$$('.ei-span'), '关 B2 ⇒ 跨度目录整块消失').toHaveLength(0);
      expect(await page.$$('.ei-span__bar')).toHaveLength(0);
      expect((await page.$$('.ei-index .ei-row')).length, '关 B2 不得动 B4').toBe(rowsBefore);
      expect(await page.$$('.a4-page'), '关 B2 的页数联动').toHaveLength(expected.noB2);

      // 关 B4 ⇒ 巨编号目录消失，B2 条**逐值不变**
      await page.goto('file://' + writeHtml('e-blocks-no-b4.html', shell(markupWith(noB4), css, false)));
      expect(await page.$$('.ei-index .ei-row'), '关 B4 ⇒ 巨编号目录消失').toHaveLength(0);
      expect(await page.$$('[data-print-resched]'), '附属件随 B4 一起不出（§0.5）').toHaveLength(0);
      expect((await page.$$('.ei-span__bar')).length, '关 B4 不得动 B2').toBe(barsBefore);
      expect(await page.$$('.a4-page'), '关 B4 的页数联动').toHaveLength(expected.noB4);
    } finally {
      await page.close();
    }
  });

  it('SHEET 页签（新增）与页脚页码**并存**；关 B5 只摘数据时间', async () => {
    const css = builtCss();
    const vm = buildVm();
    const all = ALL();
    const noB5 = all.filter((id) => id !== 'footer');
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      await page.goto('file://' + writeHtml('e-blocks-sheet.html', shell(markupWith(all), css, false)));
      const on = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll('.a4-page')) as HTMLElement[];
        return {
          sheets: pages.map((p) => (p.querySelector('.ei-head__sheet')?.textContent ?? '').trim()),
          foots: pages.map((p) => (p.querySelector('.ei-foot__page')?.textContent ?? '').trim()),
          brands: pages.map((p) => (p.querySelector('.ei-foot__brand')?.textContent ?? '').trim()),
        };
      });
      expect(on.sheets[0], 'SHEET 页签 = 刊头身份装置（§1.3 乙项）').toContain('SHEET 01 / 02 · A4');
      expect(on.sheets[1]).toContain('SHEET 02 / 02 · A4');
      expect(on.foots[0], '页脚页码**并存**（裁决第 2 条：不清理）').toContain('第 1 / 2 页');
      expect(on.foots[1]).toContain('第 2 / 2 页');
      expect(on.foots[0]).toContain('数据时间');
      expect(on.brands.every((x) => x === 'ID Plan · 项目排期与交付管理'), '每页署名').toBe(true);

      // 关 B5（甲）：只摘数据时间，署名与页码永在（原则 1）
      await page.goto('file://' + writeHtml('e-blocks-no-b5.html', shell(markupWith(noB5), css, false)));
      const off = await page.evaluate(() => {
        const p1 = document.querySelector('.a4-page') as HTMLElement;
        return {
          foot: (p1.querySelector('.ei-foot__page')?.textContent ?? '').trim(),
          brand: (p1.querySelector('.ei-foot__brand')?.textContent ?? '').trim(),
          sheet: (p1.querySelector('.ei-head__sheet')?.textContent ?? '').trim(),
        };
      });
      expect(off.foot, '关 B5 ⇒ 数据时间消失').not.toContain('数据时间');
      expect(off.foot, '关 B5 ⇒ 页码还在（原则 1）').toContain('第 1 / 2 页');
      expect(off.brand, '关 B5 ⇒ 署名还在').toBe('ID Plan · 项目排期与交付管理');
      expect(off.sheet, '关 B5 不动 SHEET 页签（装置）').toContain('SHEET 01 / 02');
    } finally {
      await page.close();
    }
  });

  it('口径行恒在（§2.6 原则 1）+ B1 字段归位（基准/套餐在 B3、打印日期在刊头）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const all = ALL();
    const noB3 = all.filter((id) => id !== 'projectInfo');
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      await page.goto('file://' + writeHtml('e-blocks-info.html', shell(markupWith(all), css, false)));
      const on = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll('.a4-page')) as HTMLElement[];
        const head = pages[0]!.querySelector('.ei-head__meta')?.textContent ?? '';
        return {
          head,
          metas: pages.map((p) => p.querySelectorAll('.ei-meta').length),
          lines: pages.map((p) => p.querySelectorAll('.ei-info__line').length),
          notes: pages.map((p) => p.querySelectorAll('.ei-note').length),
          p1: pages[0]!.textContent ?? '',
        };
      });
      // B1：项目名 + 周期 + 委托人 + **打印日期**；基准与套餐**不在这里**（归 B3）
      expect(on.head, '刊头 meta 带打印日期').toContain('打印日期');
      expect(on.head, '刊头 meta 带周期').toContain('2026-');
      expect(on.head, '排期基准归 B3，刊头不重复登').not.toContain('排期基准');
      // B3：只首页的承载区（元信息行 + 排期基准行）+ 每页的口径行
      expect(on.metas, 'B3 元信息行只首页').toEqual([1, 0]);
      expect(on.lines, 'B3 排期基准行只首页').toEqual([1, 0]);
      expect(on.notes, '口径行每页都在（原则 1）').toEqual([1, 1]);
      expect(on.p1, 'B3 元信息行含可见阶段/完成度/套餐').toContain('阶段套餐');
      expect(on.p1, 'B3 含排期基准').toContain('排期基准');
      // 刊头 meta 行的**断行纪律**：右栏被巨题挤到 160px，字段片绝不许跨行断开
      // （批 C 实测过的丑：`打印日期 2026-` / `10-09` 被劈成两半）
      const metaFacts = await page.evaluate(() => {
        const meta = document.querySelector('.ei-head__meta') as HTMLElement;
        const toks = Array.from(meta.querySelectorAll('.ei-head__mtok')) as HTMLElement[];
        return {
          text: meta.textContent ?? '',
          // 每个字段片占几行：getClientRects() 一行一枚矩形
          rectsPerTok: toks.map((t) => t.getClientRects().length),
          tokTexts: toks.map((t) => t.textContent ?? ''),
        };
      });
      expect(metaFacts.rectsPerTok, '每个字段片都只占一行（不许片内断行）').toEqual(
        metaFacts.rectsPerTok.map(() => 1),
      );
      expect(metaFacts.text, 'meta 文本逐字不变（拆片只是排版，不改内容）').toBe(
        '2026-01-01 – 2026-03-01 · 委托人 客户甲 · 打印日期 2026-10-09',
      );
      expect(metaFacts.tokTexts.join(''), '三片拼起来 === 原串').toBe(metaFacts.text);

      // 项目名的**断行平衡**（批 C 裁决第 4 条）：「不出现单字行」。
      // 用 Range 逐字量行盒：13 字项目名在 160px 栏里默认断成 12/1 ⇒ 第二行
      // 只有一个孤字。判据 = 每行至少 2 个字（`text-wrap: balance` 后实测 7/6）。
      const nameLines = await page.evaluate(() => {
        const el = document.querySelector('.ei-head__project') as HTMLElement;
        const node = el.firstChild as Text;
        const text = el.textContent ?? '';
        const perLine: number[] = [];
        let lineTop: number | null = null;
        let count = 0;
        for (let i = 0; i < text.length; i++) {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 1);
          const rect = r.getClientRects()[0];
          if (!rect) continue;
          const top = Math.round(rect.top * 10) / 10;
          if (lineTop === null || Math.abs(top - lineTop) > 1) {
            if (lineTop !== null) perLine.push(count);
            lineTop = top;
            count = 1;
          } else count++;
        }
        if (lineTop !== null) perLine.push(count);
        return { text, perLine, h: Math.round(el.getBoundingClientRect().height * 10) / 10 };
      });
      expect(nameLines.text.length, '项目名本体（13 字）').toBe(13);
      expect(nameLines.perLine.length, '项目名两行').toBe(2);
      expect(
        Math.min(...nameLines.perLine),
        `不许出现单字行（实测每行字数 ${nameLines.perLine.join('/')}）`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        Math.max(...nameLines.perLine) - Math.min(...nameLines.perLine),
        `balance 应把两行断得接近（差 ≤1 字；实测 ${nameLines.perLine.join('/')}）`,
      ).toBeLessThanOrEqual(1);
      // 字号与栏宽**一格没动**（裁决第 4 条：只许重排断点）
      const nameBox = await page.evaluate(() => {
        const el = document.querySelector('.ei-head__project') as HTMLElement;
        const s = getComputedStyle(el);
        return { fs: s.fontSize, w: Math.round(el.getBoundingClientRect().width) };
      });
      expect(nameBox.fs, '字号未动（13px）').toBe('13px');
      expect(nameBox.w, '栏宽未动（160px）').toBe(160);

      // 关 B3 ⇒ 承载区（元信息行 + 基准行）整块不出，**口径行两页都还在**
      await page.goto('file://' + writeHtml('e-blocks-no-b3.html', shell(markupWith(noB3), css, false)));
      const off = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll('.a4-page')) as HTMLElement[];
        return {
          metas: pages.reduce((n, p) => n + p.querySelectorAll('.ei-meta').length, 0),
          lines: pages.reduce((n, p) => n + p.querySelectorAll('.ei-info__line').length, 0),
          notes: pages.map((p) => p.querySelectorAll('.ei-note').length),
          text: pages[0]!.textContent ?? '',
        };
      });
      expect(off.metas + off.lines, '关 B3 ⇒ 承载区整块不出').toBe(0);
      expect(off.notes, '关 B3 ⇒ 口径行锚回主体底部（每页）').toEqual([1, 1]);
      expect(off.text, '关 B3 ⇒ 排期基准消失（口径行除外）').not.toContain('排期基准');
    } finally {
      await page.close();
    }
  });

  it('★ 页数表（1/2/4/5/7/8/9/10/16/17/20/30/40 阶段）：预计 = 实际、逐页 ≤1123、页数单调不减', async () => {
    const css = builtCss();
    const ns = [1, 2, 4, 5, 7, 8, 9, 10, 16, 17, 20, 30, 40];
    const planned = ns.map((n) => eiBlockPages(buildVm(n), DEFAULT_SCHEDULE_PAPER_BLOCKS).length);
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i]!;
        const vm = buildVm(n);
        await page.goto(
          'file://' + writeHtml(`e-blocks-${n}.html`, shell(markupWith(ALL(), vm), css, false)),
        );
        const m = await page.evaluate(() => {
          const pages = Array.from(document.querySelectorAll('.a4-page'));
          return {
            count: pages.length,
            hs: pages.map((el) => Math.round(el.getBoundingClientRect().height * 10) / 10),
          };
        });
        expect(m.count, `${n} 阶段：预计页数 = 实际出纸`).toBe(planned[i]!);
        for (const h of m.hs) expect(h, `${n} 阶段：逐页溢出即红`).toBeLessThanOrEqual(1124);
        // 20 阶段（跨页的「长目录」档）逐页留档：density-e-many-p1..pN.png
        if (n === 20) {
          const els = await page.$$('.a4-page');
          for (let k = 0; k < els.length; k++) {
            await els[k]!.screenshot({ path: join(OUT_DIR, `density-e-many-p${k + 1}.png`) });
          }
        }
      }
      for (let i = 1; i < planned.length; i++) {
        expect(planned[i]!, `页数随阶段数单调不减（${ns[i - 1]} → ${ns[i]}）`).toBeGreaterThanOrEqual(
          planned[i - 1]!,
        );
      }
      // 参考稿档位（9 阶段）落在 **normal** 档（44px 巨编号的原味）
      expect(eiBlockIsCompact(buildVm(9), DEFAULT_SCHEDULE_PAPER_BLOCKS), '9 阶段 = normal 档').toBe(
        false,
      );
      expect(planned[ns.indexOf(9)]!, '9 阶段 = 2 页（B2 + B4 各行都要付）').toBe(2);
      // 长目录走紧凑档（01 §9：20+ 阶段稳定处理）
      expect(eiBlockIsCompact(buildVm(30), DEFAULT_SCHEDULE_PAPER_BLOCKS), '30 阶段 = 紧凑档').toBe(
        true,
      );
      // 40 阶段 = 6 页（实测；页数只允许随规模增长，不许倒挂）
      expect(planned[ns.indexOf(40)]!, '40 阶段 = 6 页').toBe(6);
      expect(planned[ns.indexOf(20)]!, '20 阶段 = 3 页').toBe(3);
      expect(planned[ns.indexOf(10)]!, '10 阶段 = 2 页').toBe(2);
    } finally {
      await page.close();
    }
  });

  it('★ 标尺刻度不被抽稀 + 条长 = 跨度比例（40 阶段 / 像素级逐值对账）', async () => {
    /*
     * 两条「不许糊过去」的机器判据：
     *   ① **标尺不被抽稀**：DOM 里的月份刻度数 === `buildPrintGantt` 的
     *      `ticks.length`（同一份派生，不是另算一遍），且每枚刻度都有非零
     *      宽度、`data-tick-left` 严格递增 —— 「画了但被缩成 0 宽 / 被
     *      overflow 吃掉」也算红。
     *   ② **条长 = 跨度**：逐条对账「像素宽 = width% × 轨宽」，且 40 阶段
     *      这种极端规模下仍然成立（长目录下有人偷懒改成固定宽度就会红）。
     */
    const css = builtCss();
    const vm40 = buildVm(40);
    const model = buildPrintGantt(vm40.project, vm40.stages);
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
    try {
      await page.goto('file://' + writeHtml('e-blocks-ruler.html', shell(markupWith(ALL(), vm40), css, false)));
      const m = await page.evaluate(() => {
        const ticks = Array.from(document.querySelectorAll('.ei-span__tick')) as HTMLElement[];
        const tracks = Array.from(document.querySelectorAll('.ei-span__track')) as HTMLElement[];
        const bars = Array.from(document.querySelectorAll('.ei-span__bar')) as HTMLElement[];
        return {
          tickLefts: ticks.map((t) => Number.parseFloat(t.getAttribute('data-tick-left') ?? 'NaN')),
          tickTexts: ticks.map((t) => (t.textContent ?? '').trim()),
          tickWidths: ticks.map((t) => Math.round(t.getBoundingClientRect().width * 100) / 100),
          trackWidths: tracks.map((t) => Math.round(t.getBoundingClientRect().width * 100) / 100),
          bars: bars.map((b) => ({
            px: Math.round(b.getBoundingClientRect().width * 100) / 100,
            width: Number.parseFloat(b.getAttribute('data-span-width') ?? 'NaN'),
          })),
          pages: document.querySelectorAll('.a4-page').length,
          totalBars: document.querySelectorAll('.ei-span__bar').length,
        };
      });

      // ① 标尺：**每页自带一条**（与刊头/页码同性质），刻度逐值等于派生值
      const labels = model.ticks.map((t) => t.label);
      const lefts = model.ticks.map((t) => Number.parseFloat(t.leftPercent.toFixed(2)));
      expect(m.pages, '40 阶段 = 6 页').toBe(6);
      expect(
        m.tickTexts.length % labels.length,
        '刻度总数应是「每页一套」的整数倍（不许某页悄悄不画标尺）',
      ).toBe(0);
      const rulers = m.tickTexts.length / labels.length;
      expect(rulers, '六页各一条标尺').toBe(6);
      for (let r = 0; r < rulers; r++) {
        expect(
          m.tickTexts.slice(r * labels.length, (r + 1) * labels.length),
          `第 ${r + 1} 条标尺的月份标签逐值等于派生值`,
        ).toEqual(labels);
        expect(
          m.tickLefts.slice(r * labels.length, (r + 1) * labels.length),
          `第 ${r + 1} 条标尺的刻度位置逐值等于派生值`,
        ).toEqual(lefts);
      }
      for (const w of m.tickWidths) expect(w, '刻度不得被抽稀成 0 宽').toBeGreaterThan(0);
      for (let i = 1; i < labels.length; i++) {
        expect(lefts[i]!, '刻度左缘严格递增').toBeGreaterThan(lefts[i - 1]!);
      }
      expect(new Set(labels).size, '月份标签不重复（不是同一枚被画多次）').toBe(labels.length);

      // ② 条长 = 跨度比例 × 轨宽（40 阶段下逐条对账，容差 1.5px）
      expect(m.totalBars, '40 阶段全部上纸（逐页切片的条数之和 = 40）').toBe(40);
      expect(m.bars.length).toBe(40);
      // 标尺与所有行共用同一栅格 ⇒ 轨宽应当处处相等（不等就是栅格被谁撑破了）
      expect(
        new Set(m.trackWidths.map((w) => Math.round(w * 10) / 10)).size,
        '标尺与行共用同一栅格（轨宽处处相等）',
      ).toBe(1);
      const trackW = m.trackWidths[0]!;
      for (const b of m.bars) {
        expect(
          Math.abs(b.px - (b.width / 100) * trackW),
          `条长应等于宽度% × 轨宽（width=${b.width}%）`,
        ).toBeLessThanOrEqual(1.5);
      }
    } finally {
      await page.close();
    }
  });

  it('五块形态的视觉纪律：92px 两行巨题 / 巨编号独立列 / 无黑栏 / 5px 粗线 / 暖浅纸面', async () => {
    const css = builtCss();
    const vm = buildVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      await page.goto('file://' + writeHtml('e-blocks-visual.html', shell(markupWith(ALL()), css, false)));
      const m = await page.evaluate(() => {
        const p1 = document.querySelector('.a4-page') as HTMLElement;
        const lines = Array.from(p1.querySelectorAll('.ei-head__title-line')) as HTMLElement[];
        const no = p1.querySelector('.ei-row__no') as HTMLElement | null;
        const rule = p1.querySelector('.ei-head__rule') as HTMLElement | null;
        const foot = p1.querySelector('.ei-foot') as HTMLElement | null;
        const blacks = Array.from(p1.querySelectorAll('*')).filter((e) => {
          const s = getComputedStyle(e);
          return (
            s.backgroundColor === 'rgb(20, 20, 20)' &&
            (e as HTMLElement).clientWidth > 600 &&
            !e.classList.contains('ei-head__rule')
          );
        }).length;
        return {
          lineTexts: lines.map((l) => l.textContent ?? ''),
          lineFs: lines.map((l) => Number.parseFloat(getComputedStyle(l).fontSize)),
          lineColors: lines.map((l) => getComputedStyle(l).color),
          noFs: no ? Number.parseFloat(getComputedStyle(no).fontSize) : -1,
          ruleH: rule ? getComputedStyle(rule).height : '',
          footBg: foot ? getComputedStyle(foot).backgroundColor : '',
          paper: getComputedStyle(p1).backgroundColor,
          blacks,
        };
      });
      expect(m.lineTexts, '巨题仍是内容类型词（阶段 / 目录）').toEqual(['阶段', '目录']);
      expect(m.lineFs, '巨题 92px 定值（批 C 不动装置）').toEqual([92, 92]);
      expect(m.lineColors[0]).toBe('rgb(20, 20, 20)');
      expect(m.lineColors[1], '行 2 = accent 槽位').toBe('rgb(176, 74, 47)');
      expect(m.noFs, '巨编号 ≥46px（normal 档，E 的身份）').toBeGreaterThanOrEqual(46);
      expect(m.ruleH, '刊头 5px 粗线').toBe('5px');
      expect(m.footBg, '页脚无黑栏').toBe('rgba(0, 0, 0, 0)');
      expect(m.paper, '暖浅纸面 #F5F2EC 不变').toBe('rgb(245, 242, 236)');
      expect(m.blacks, '除刊头粗线外不得有通栏近黑块').toBe(0);
    } finally {
      await page.close();
    }
  });
});

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

  it('E 版默认态 = 五块形态：预计页数 = 实际出纸，逐页 794×1123 无裁切；legacy 四页仍可复现', async () => {
    /*
     * 2026-10-13 批 C（决策 1/6）：E 的默认输出从「3 原生签名页 = 4 纸面」改为
     * **五块形态**（B1 打印头部 / B2 编年跨度目录 / B3 项目信息 / B4 巨编号目录 /
     * B5 页脚）。原「4 纸面」的断言分家：本用例前半验五块形态，后半用显式
     * `NATIVE_SHEETS` 复现 legacy 四纸面（产出物目录仍跨页）——决策 2 的证据。
     */
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['editorial-index'].baseline;
    const markup = renderToStaticMarkup(
      createElement(EditorialIndexDocument, { vm, palette: baseline }),
    );
    const expectedPages = eiBlockPages(vm, DEFAULT_SCHEDULE_PAPER_BLOCKS).length;

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const gray of [false, true]) {
        const htmlPath = writeHtml(
          gray ? 'e-default-gray.html' : 'e-default-color.html',
          shell(markup, css, gray),
        );
        await page.goto('file://' + htmlPath);
        const tag = gray ? 'gray' : 'color';
        const pages = await page.$$('.a4-page');
        expect(pages, `五块形态应渲染 ${expectedPages} 页（装配层同源）`).toHaveLength(expectedPages);
        expect(
          await pages[0]!.getAttribute('data-print-page'),
          '五块形态的纸面标识',
        ).toBe('blocks');
        for (let i = 0; i < pages.length; i++) {
          const box = await pages[i]!.boundingBox();
          expect(Math.abs(box!.width - 794), `第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
          expect(box!.height, `第 ${i + 1} 页溢出即红`).toBeLessThanOrEqual(1124);
          expect(box!.height, `第 ${i + 1} 页不得低于 1123`).toBeGreaterThanOrEqual(1122);
          await pages[i]!.screenshot({ path: join(OUT_DIR, `density-e-p${i + 1}-${tag}.png`) });
        }
      }

      // ── 后半：legacy 四纸面仍可复现（决策 2「代码与 spec 全留」）──
      const legacyMarkup = renderToStaticMarkup(
        createElement(EditorialIndexDocument, { vm, palette: baseline, sheets: NATIVE_SHEETS }),
      );
      await page.goto('file://' + writeHtml('e-legacy-four.html', shell(legacyMarkup, css, false)));
      await assertPagesAndShot(page, 'legacy', 4);
    } finally {
      await page.close();
    }
  });

  it('E 版长目录分页（legacy 原生页）：31 阶段 ⇒ 阶段目录跨页稳定（行序连续 / 每页自带刊头 / 页码连续 / 行不裂）', async () => {
    const css = builtCss();
    const vm = buildVm(31);
    const baseline = PRINT_TEMPLATE_PALETTES['editorial-index'].baseline;
    // 批 C：目录分页器属 legacy 页路径 ⇒ 显式传 sheets（断言一字未改）
    const markup = renderToStaticMarkup(
      createElement(EditorialIndexDocument, {
        vm,
        palette: baseline,
        sheets: NATIVE_SHEETS,
      }),
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

      // 跨页身份（2026-10-11 P0-14② 新语义）：行序回到 orderIndex 连续，章头
      // 分组整体退役 ⇒ 跨页断点不再靠「（续）」章头，而靠**每页自带的刊头 +
      // 页脚「第 N / M 页」**（宪法 7「每页独立解释」）。故此处改为断言：
      // ① 阶段页上不存在 .ei-chapter；② 每张物理页都带完整两行巨题刊头；
      // ③ 页脚页码连续。
      const stagePages = await page.$$('[data-print-page="stage-index"]');
      expect(stagePages.length, '阶段目录应占 ≥2 个物理页').toBeGreaterThanOrEqual(2);
      const chapterCount = await page.$$eval(
        '[data-print-page="stage-index"] .ei-chapter',
        (els) => els.length,
      );
      expect(chapterCount, 'P0-14②：行序连续后阶段目录不再有章头分组').toBe(0);
      for (let i = 0; i < stagePages.length; i++) {
        // 每页自带刊头：两行巨题 + 5px 章节粗线（跨页读者看得见自己在哪一页）
        const headLines = await stagePages[i]!.$$eval('.ei-head__title-line', (els) =>
          els.map((e) => e.textContent ?? ''),
        );
        expect(headLines, `第 ${i + 1} 阶段页应带两行巨题刊头`).toEqual(['阶段', '目录']);
        const rule = await stagePages[i]!.$eval('.ei-head__rule', (el) => {
          const s = getComputedStyle(el);
          return { h: s.height, bg: s.backgroundColor };
        });
        expect(rule.h, '每页刊头粗线 5px').toBe('5px');
        expect(rule.bg).toBe('rgb(20, 20, 20)');
      }

      // 页码连续：第 2 阶段页的物理页码 = 2（第 1 页是阶段目录首页）
      const pageIdx = await stagePages[1]!.getAttribute('data-page-index');
      expect(pageIdx).toBe('1');
      const p1Text = (await stagePages[0]!.textContent()) ?? '';
      const p2Text = (await stagePages[1]!.textContent()) ?? '';
      expect(p2Text).toContain('第 2 / ');
      // 首页页码 1 / 总数一致；第二页与总数相同（连续编号）
      expect(p1Text).toContain('第 1 / ');
      const totalMatch = p1Text.match(/第 1 \/ (\d+) 页/);
      expect(totalMatch, '首页应带「第 1 / N 页」').not.toBeNull();
      expect(p2Text).toContain(`第 2 / ${totalMatch![1]} 页`);

      // 行不裂：两页的阶段行都在（31 行全部上纸，无丢行）；行序 = orderIndex 连续
      const rows = await page.$$eval('[data-print-page="stage-index"] .ei-row', (els) => els.length);
      expect(rows, '31 个阶段行全部上纸').toBe(31);
      const stageNos = await page.$$eval('[data-print-page="stage-index"] .ei-row__no', (els) =>
        els.map((e) => e.textContent ?? ''),
      );
      expect(stageNos).toEqual(Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')));

      // 每张阶段页都有行（不出现「只有刊头没有行」的空页）
      for (let i = 0; i < stagePages.length; i++) {
        const rowsIn = await stagePages[i]!.$$eval('.ei-row', (els) => els.length);
        expect(rowsIn, `第 ${i + 1} 阶段页应有行`).toBeGreaterThan(0);
      }
    } finally {
      await page.close();
    }
  });

  it('E 版视觉纪律（legacy 原生页）：两行巨标题 / 大编号独立列 / 赭红有界 / 无底部黑栏 / 发丝线与 5px 粗线', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['editorial-index'].baseline;
    // 批 C：本用例验「原生页那套版式」⇒ 显式走 legacy（五块形态的同款纪律另有用例）
    const markup = renderToStaticMarkup(
      createElement(EditorialIndexDocument, { vm, palette: baseline, sheets: NATIVE_SHEETS }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('e-default-color.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      const p1 = await page.$('[data-print-page="stage-index"]');
      expect(p1, 'P1 阶段目录页应在').not.toBeNull();

      // ⓪ 两行巨标题（2026-10-11 P0-12）：行1 墨 / 行2 焦点色；行节距 ≈106px
      //    （参考稿 y124..210 / y230..316）；字号按规格「两行总高 192px」反推
      const titleLines = await p1!.$$eval('.ei-head__title-line', (els) =>
        els.map((e) => ({
          text: e.textContent ?? '',
          color: getComputedStyle(e).color,
          top: (e as HTMLElement).offsetTop,
          fs: Number.parseFloat(getComputedStyle(e).fontSize),
        })),
      );
      expect(titleLines.map((l) => l.text), '页题拆两行：阶段 / 目录').toEqual(['阶段', '目录']);
      expect(titleLines[0]!.color, '行1 近黑').toBe('rgb(20, 20, 20)');
      expect(titleLines[1]!.color, '行2 = accent 槽位 #B04A2F').toBe('rgb(176, 74, 47)');
      // 字号**定值**（2026-10-11 P1-3）：原判据 `≥80` 让「92 → 80~89」这类缩小仍绿，
      // 下界够不着真实值 ⇒ 变异静默（独立验证 worker 的 79px 变异正是靠它蒙混过）。
      // 两行同属一条规则（.ei-head__title），故两行各断一次。
      expect(titleLines[0]!.fs, '巨题字号 = 92px（实现唯一真值源：.ei-head__title）').toBe(92);
      expect(titleLines[1]!.fs, '行2 与行1 同字号（同一条规则）').toBe(92);
      // 行节距 = 单行槽高 = 字号 × line-height（规格判据「两行 offsetTop 差 ≈106px」）
      expect(Math.abs(titleLines[1]!.top - titleLines[0]!.top), '两行 offsetTop 差 ≈106px').toBeGreaterThanOrEqual(100);
      expect(Math.abs(titleLines[1]!.top - titleLines[0]!.top)).toBeLessThanOrEqual(112);
      // 衬线族真解析（P0-12 判据：审计 §5 明说「未验证字形是否为衬线」）
      const titleFont = await p1!.$eval('.ei-head__title', (el) => getComputedStyle(el).fontFamily);
      expect(titleFont, 'E 的页题必须落在衬线族').toMatch(/Serif|Song|Sun/i);

      // ① 大编号是**独立 DOM 列**（02 §6 禁伪元素）：.ei-row__no 元素存在且
      //    文本 = 补零 orderIndex；伪元素生成的编号进不了 DOM（可访问性/分页稳定）
      //    2026-10-11 P0-14②：行序回到 orderIndex 连续 01→09（不再被四态重排）
      const nos = await p1!.$$eval('.ei-row__no', (els) => els.map((e) => e.textContent ?? ''));
      expect(nos.length, '9 个阶段行各一枚编号').toBe(9);
      expect(nos, '编号列 = orderIndex 连续 01→09（参考稿口径；P0-14② 行序重排已退役）').toEqual([
        '01',
        '02',
        '03',
        '04',
        '05',
        '06',
        '07',
        '08',
        '09',
      ]);
      // 编号列的字体确实变大（视觉锚点）：P0-14 判据 ≥46px（参考 cap 38px ⇒ ≈50px）
      const noFont = await p1!.$eval('.ei-row__no', (el) => parseFloat(getComputedStyle(el).fontSize));
      expect(noFont, '巨编号 ≥46px（P0-14 判据）').toBeGreaterThanOrEqual(46);

      // ② 赭红有界：延期行 / Agent 行走焦点色，但整页不是单色红（近黑元素仍在）
      const accent = await p1!.$eval('.ei-row__no[data-focus]', (el) => getComputedStyle(el).color);
      expect(accent, '延期/Agent 行巨编号应为赭红 #B04A2F').toBe('rgb(176, 74, 47)');
      const inkCount = await p1!.$$eval('.ei-row__name', (els) =>
        els.filter((e) => getComputedStyle(e).color === 'rgb(20, 20, 20)').length,
      );
      expect(inkCount, '近黑正文元素仍在（整页不许单色红）').toBeGreaterThan(0);
      // 执行体负责阶段：负责人名赭红 + 「执行体」文字签（双编码，灰度可辨）
      const agentOwner = await p1!.$eval('.ei-row__owner[data-agent]', (el) => ({
        color: getComputedStyle(el).color,
        text: el.textContent ?? '',
      }));
      expect(agentOwner.color).toBe('rgb(176, 74, 47)');
      expect(agentOwner.text, '执行体行须带「执行体」文字签（双编码，灰度可辨）').toContain('执行体');

      // ③ 无底部黑栏：页脚背景透明，且页内无「通栏近黑填充」元素
      const footBg = await p1!.$eval('.ei-foot', (el) => getComputedStyle(el).backgroundColor);
      expect(footBg, '页脚无黑栏（背景透明）').toBe('rgba(0, 0, 0, 0)');
      // 刊头下的 5px 章节粗线是近黑且通栏（>600px），是唯一允许的通栏近黑块
      const blackBars = await p1!.$$eval('*', (els) =>
        els.filter((e) => {
          const s = getComputedStyle(e);
          return (
            s.backgroundColor === 'rgb(20, 20, 20)' &&
            e.clientWidth > 600 &&
            !e.classList.contains('ei-head__rule')
          );
        }).length,
      );
      expect(blackBars, 'E 版除刊头粗线外不得出现通栏黑栏').toBe(0);

      // ④ 线：条目行底线 1px 线色；刊头章节粗线 5px 近黑（P0-13：1px 发丝线 → 5px）
      const rowBorder = await p1!.$eval('.ei-row', (el) => {
        const s = getComputedStyle(el);
        return { w: s.borderBottomWidth, c: s.borderBottomColor };
      });
      expect(rowBorder.w).toBe('1px');
      expect(rowBorder.c).toBe('rgb(207, 198, 180)');
      const chapterBorder = await p1!.$eval('.ei-head__rule', (el) => {
        const s = getComputedStyle(el);
        return { w: s.height, c: s.backgroundColor };
      });
      expect(chapterBorder.w, 'P0-13：刊头章节线 5px').toBe('5px');
      expect(chapterBorder.c).toBe('rgb(20, 20, 20)');

      // ⑤ 纸面是暖浅纸面 #F5F2EC（模板身份，不开槽位；P0-15 向参考稿还原）
      const paper = await p1!.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(paper, 'E 版纸面应为暖浅纸 #F5F2EC').toBe('rgb(245, 242, 236)');

      // ⑥ 口径注上纸：占比 ≠ 完成度（01 §3.1 防误读，每页可独立解释）
      const p1Text = (await p1!.textContent()) ?? '';
      expect(p1Text).toContain('占比 = 阶段工作量分配（ratioPercent），不等于完成度');

      // ⑦ 执行体签字号 ≥9.5px（accent 文字下限，密度研究 §4 约束 3：
      //    执行体签随负责人行走朱红；原 9px 的登记项已清）
      const tagFs = await p1!.$eval('.ei-row__agent-tag', (el) => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(tagFs, '执行体签字号应 ≥9.5px（accent 文字下限）').toBeGreaterThanOrEqual(9.5);

      // ⑧ 类型签「执行体 / 人类」在成员行 92px 定宽列里不溢出、不换行（2026-10-11 team-lead 追问：
      //    改词把 `human`(5 Latin) 换成 `人类`(2 CJK)，CJK 字宽更大，须实测而非肉眼推断）。
      //    静态读 CSS 只能证明「没有 width 声明」；能不能换行、撑不撑破列由真实排版决定，
      //    所以这里量四组硬量：① 计算样式 nowrap ② Range 联合框高度 = 单行高
      //    ③ 所有 Range 矩形落在同一行带内 ④ 内容实宽 vs 列内容宽（含余量）。
      //    `rects`（矩形个数）只作账本字段**不作判据** —— 见下方注释里的反例。
      const kindLedger = await page.evaluate(() => {
        const rows = Array.from(
          document.querySelectorAll('.ei-row--member .ei-row__kind'),
        ) as HTMLElement[];
        return rows.map((el) => {
          const s = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          const padX = Number.parseFloat(s.paddingLeft) + Number.parseFloat(s.paddingRight);
          const rng = document.createRange();
          rng.selectNodeContents(el);
          const textRect = rng.getBoundingClientRect();
          const index = el.closest('.ei-index') as HTMLElement | null;
          return {
            agent: el.hasAttribute('data-agent'),
            text: (el.textContent ?? '').trim(),
            colW: +box.width.toFixed(2), // = 网格轨道宽（92px）
            contentW: +(box.width - padX).toFixed(2),
            textW: +textRect.width.toFixed(2),
            textH: +textRect.height.toFixed(2),
            lineH: Number.parseFloat(s.lineHeight) || Number.parseFloat(s.fontSize) * 1.2,
            clientW: el.clientWidth,
            scrollW: el.scrollWidth,
            clientH: el.clientHeight,
            scrollH: el.scrollHeight,
            rects: rng.getClientRects().length,
            rectTops: Array.from(rng.getClientRects()).map((r) => +r.top.toFixed(2)),
            whiteSpace: s.whiteSpace,
            overflowsIndexRight: index ? +((box.right - index.getBoundingClientRect().right).toFixed(2)) : null,
          };
        });
      });
      console.log('[E 类型签实测] ' + JSON.stringify(kindLedger));
      expect(kindLedger.length, '成员页每位成员一枚类型签').toBeGreaterThan(1);
      const agentKind = kindLedger.find((r) => r.agent)!;
      const humanKind = kindLedger.find((r) => !r.agent)!;
      expect(agentKind.text.replace(/\s+/g, ''), '执行体行的类型签 = 字形 + 「执行体」').toBe('◆执行体');
      expect(humanKind.text.replace(/\s+/g, ''), '人类行的类型签 = 字形 + 「人类」').toBe('○人类');
      expect(humanKind.text, '改词后左半边的 Latin `human` 已消失（口径：人类 / 执行体 成对）').not.toContain('human');
      // 变异自证（4 例，各注明「红了哪一条」，证明这些断言是活探针而不是恒绿）：
      //   ① `.ei-row__kind { width:40px }`      ⇒ 「无横向溢出」红（scrollW 48 > clientW 41）
      //   ② `.ei-row__kind { white-space:normal }` ⇒ 「nowrap」红
      //   ③ 收窄 30px（逼出真换行）              ⇒ 「单行高」红（textH 32.5 > 17.5）
      //   ④ `width:30px + flex-wrap:wrap`（**保持 nowrap**）⇒ 「单行高」红（textH 36）而
      //      「nowrap」仍绿 ⇒ 横向探针与换行探针**互相独立**，不是同一条断言的两种说法。
      for (const r of kindLedger) {
        const who = r.text.replace(/\s+/g, '');
        expect(r.whiteSpace, `${who}：类型签 nowrap`).toBe('nowrap');
        // 换行判据一：Range 联合框高度 ≈ 单行高（换行会变成两行高）。
        expect(r.textH, `${who}：单行高（textH ${r.textH} ≤ lineH ${r.lineH}）`).toBeLessThanOrEqual(r.lineH + 1);
        // 换行判据二：所有矩形落在同一行带内。实测标定 —— 正常态跨度 0.75px（字形 span 10px
        //    与文本 11px 在 align-items:center 下的顶差），真换行态跨度 20px（变异④实测），
        //    故取 lineH/2 ≈ 8.25px 为界：两边各有 ≈11× / 2.4× 余量，不是贴边判据。
        // ⚠️ 别拿「矩形个数」当换行判据：Range 跨「字形 span + 文本节点」本来就出多个矩形，
        //    同基线也会 >1 —— 实测正常态 ◆执行体 = 3 个矩形且全在同一行，用它判会假红。
        const topSpan = Math.max(...r.rectTops) - Math.min(...r.rectTops);
        expect(topSpan, `${who}：矩形全在同一行带内（跨度 ${topSpan} < 半行高 ${(r.lineH / 2).toFixed(2)}）`).toBeLessThan(r.lineH / 2);
        expect(r.scrollW, `${who}：无横向溢出`).toBeLessThanOrEqual(r.clientW + 1);
        expect(r.scrollH, `${who}：无纵向溢出（未换行、未撑高）`).toBeLessThanOrEqual(r.clientH + 1);
        expect(r.textW, `${who}：内容实宽 ${r.textW} ≤ 列内容宽 ${r.contentW}`).toBeLessThanOrEqual(r.contentW + 0.5);
        // 「没有 width 声明」的静态结论 → 这里补动态半边：内容实宽必须真的小于列宽（有余量）
        expect(r.contentW - r.textW, `${who}：列内留有余量（证明 92px 列不是靠临界值撑住）`).toBeGreaterThan(10);
        expect(r.overflowsIndexRight, `${who}：列右缘不越出 .ei-index 内容框`).toBeLessThanOrEqual(0.5);
      }
    } finally {
      await page.close();
    }
  });

  it('E 版 legacy 原生页：套预设变体（靛蓝）彩色 4 张；焦点槽位确实挂上（非默认态重截）', async () => {
    const css = builtCss();
    const vm = buildVm();
    const preset = PRINT_TEMPLATE_PALETTES['editorial-index'].presets.find((p) => p.id === 'indigo')!;
    const markup = renderToStaticMarkup(
      createElement(EditorialIndexDocument, {
        vm,
        palette: preset.palette,
        sheets: NATIVE_SHEETS,
      }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('e-preset-indigo.html', shell(markup, css, false));
        await page.goto('file://' + htmlPath);
        const pages = await page.$$('.a4-page');
        expect(pages).toHaveLength(4);
      for (let i = 0; i < pages.length; i++) {
        const box = await pages[i]!.boundingBox();
        expect(Math.abs(box!.width - 794)).toBeLessThanOrEqual(1);
        expect(box!.height).toBeLessThanOrEqual(1124);
        await pages[i]!.screenshot({ path: join(OUT_DIR, `e-preset-p${i + 1}-color.png`) });
      }
      // 预设真的挂上了：页题第二行（类型词）取靛蓝 #2B4ACB（不是默认赭红）
      const accent = await page.$eval('.ei-head__title-line[data-tone="accent"]', (el) =>
        getComputedStyle(el).color,
      );
      expect(accent, '靛蓝预设的类型词行应为 #2B4ACB').toBe('rgb(43, 74, 203)');
      // 且焦点行的巨编号也跟随槽位
      const noAccent = await page.$eval('.ei-row__no[data-focus]', (el) => getComputedStyle(el).color);
      expect(noAccent, '靛蓝预设的焦点巨编号应为 #2B4ACB').toBe('rgb(43, 74, 203)');
      // 纸面仍是暖浅纸（paper 不开槽位，E 的身份）
      const paper = await page.$eval('.a4-page', (el) => getComputedStyle(el).backgroundColor);
      expect(paper).toBe('rgb(245, 242, 236)');
    } finally {
      await page.close();
    }
  });

  it('E 版空态：无可见阶段 ⇒ 三页全明确空态（02 §8 文案，不造数据填版）', async () => {
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
    // 批 C：三页空态属 legacy 页路径（五块形态下只有一张纸）⇒ 显式传 sheets
    const markup = renderToStaticMarkup(
      createElement(EditorialIndexDocument, { vm, palette: baseline, sheets: NATIVE_SHEETS }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('e-empty.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);
      // 三个原生逻辑页都出纸（页头页脚齐全），主体全是标准空态文案
      const pages = await page.$$('.a4-page');
      expect(pages).toHaveLength(3);
      const empties = await page.$$('[data-print-empty]');
      expect(empties.length, '三页各一条空态（默认 = 原生签名页）').toBe(3);
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
