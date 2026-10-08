/**
 * 经典版（SchedulePaper · print-skin-default）A4 视觉验收 + 密度修订锁定。
 *
 * ── 为什么补这个 spec ──
 * 四版（A/D/E/H）各有 visual spec，经典纸面一直没有——而它恰恰是**默认模板**
 * （产品决策文档 §5.1：模板选择默认值=经典），也是 2026-10-09 打印密度修订
 * （print-density-study §3「H 版 · 经典」表）的整改对象：甘特轨道 h-9→h-7、
 * 清单数据行 h-[42px]→h-[34px]、表头 h-[34px]→h-[30px]、section mt-6→mt-8、
 * 页头 pb-3→pb-4、图例 mt-3→mt-4。本 spec 用真 Chromium 把这些值钉住，
 * 并把默认态彩/灰截图落成交付物（density-classic-p*-{color,gray}.png）。
 *
 * ── 方法（与 print-a4-visual{-d,-e,-h}.spec.ts 同范式）──
 * ① 真实组件（SchedulePaper）+ 真实纯函数装配（buildScheduleSections /
 *    paginateSections，与 useSchedulePaperData 同一出口）经
 *    renderToStaticMarkup 出静态纸面；
 * ② 外挂**真实构建产物**的 CSS（build-dist/assets/*.css——Tailwind 工具类 +
 *    亮色锁 + 阶段九色板都在里面）；
 * ③ 真 Chromium 逐页截图 + 794×1123 无裁切断言 + 密度值计算样式断言。
 *
 * ⚠️ 色带几何（bandGeom）与月份刻度在本 spec 内按 useSchedulePaperData 的
 *    口径复算（纯函数、无 store）——几何不变式的**权威锁**在
 *    schedule-print-band-bounds.spec.tsx（真实渲染 SchedulePrintPage 那条），
 *    本 spec 只保证纸面视觉与分页，不重复锁几何。
 *
 * 前置：`npm run build --outDir build-dist`（产物在 build-dist/）与本机
 * chromium；缺任一则整组 skip（与另几份视觉 spec 同口径）。
 *
 * 产物落点：`outputs/print-a4-shots/density-classic-p*-{color,gray}.png`
 * （工作区交付目录，不进 git）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { SchedulePaper } from '../src/components/print/SchedulePaper';
import {
  buildScheduleSections,
  paginateSections,
  type ScheduleSection,
} from '../src/lib/schedule-print';
import { buildMonthTicks, totalDaysInclusive } from '../src/lib/date';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage, Task } from '../src/core/types/entities';

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

/** 拼接全部构建产物 CSS（Tailwind 工具类 + 主题令牌 + 亮色锁都在里面） */
function builtCss(): string {
  const assets = join(ROOT, 'build-dist', 'assets');
  return readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assets, f), 'utf-8'))
    .join('\n');
}

/* ------------------------------------------------------------------ 夹具（真实形状） */

const PROJECT_ID = 'proj_classic';

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
  id: 'm-classic-human',
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
  id: 'm-classic-agent',
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

/** 9 阶段（覆盖甘特轨道 + 清单表 + 斑马纹 + 四态） */
const STAGES: Stage[] = Array.from({ length: 9 }, (_, i) => {
  const n = i + 1;
  return {
    id: `stg_classic_${n}`,
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

const TASKS: Task[] = Array.from({ length: 14 }, (_, i) => {
  const n = i + 1;
  return {
    id: `tsk_classic_${n}`,
    taskNo: 1000 + n,
    projectId: PROJECT_ID,
    stageId: STAGES[n % STAGES.length]!.id,
    title: `任务${n}·整理测绘图与材料清单并同步给施工方确认`,
    done: false,
    assigneeId: HUMAN.id,
    assigneeIds: n % 2 === 0 ? [HUMAN.id, AGENT.id] : [HUMAN.id],
    dueDate: null,
    source: 'human',
    externalId: null,
    agentId: null,
    status: TaskStatus.InProgress,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    runId: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
});

/* ------------------------------------------------------------------ 纸面装配（纯函数，与 useSchedulePaperData 同出口） */

const SECTIONS: ScheduleSection[] = buildScheduleSections({
  project: PROJECT,
  stages: STAGES,
  tasks: TASKS,
  members: [HUMAN, AGENT],
});
const PAGES = paginateSections(SECTIONS);

/** MIN_LABEL_GAP_PCT：母本逐字（启发式阈值，轨宽变化需复核） */
const MIN_LABEL_GAP_PCT = 12;

/** bandGeom / monthTicks：useSchedulePaperData.ts 的同口径复算（见文件头说明） */
const viewStart = [PROJECT.plannedStartAt.slice(0, 10), ...SECTIONS.map((s) => s.startAt.slice(0, 10))].reduce(
  (a, b) => (a < b ? a : b),
);
const viewEnd = [PROJECT.plannedEndAt.slice(0, 10), ...SECTIONS.map((s) => s.endAt.slice(0, 10))].reduce(
  (a, b) => (a > b ? a : b),
);
const viewDays = Math.max(totalDaysInclusive(viewStart, viewEnd), 1);
const offsetDays = (iso: string): number => totalDaysInclusive(viewStart, iso) - 1;
const bandGeom = (startAt: string, endAt: string): { left: number; width: number } => {
  const lo = offsetDays(startAt);
  const hi = offsetDays(endAt);
  return { left: (lo / viewDays) * 100, width: Math.max(((hi - lo + 1) / viewDays) * 100, 2.5) };
};
const monthTicks: Array<{ label: string; leftPercent: number }> = (() => {
  const kept: Array<{ label: string; leftPercent: number }> = [];
  for (const t of buildMonthTicks(viewStart, viewEnd)) {
    const leftPercent = Math.max((offsetDays(t.start) / viewDays) * 100, 0);
    const prev = kept[kept.length - 1];
    if (prev && leftPercent - prev.leftPercent < MIN_LABEL_GAP_PCT) continue;
    kept.push({ label: t.label, leftPercent });
  }
  return kept;
})();

function buildMarkup(): string {
  return renderToStaticMarkup(
    createElement(SchedulePaper, {
      project: PROJECT,
      pages: PAGES,
      sections: SECTIONS,
      bandGeom,
      monthTicks,
      nowText: '2026-10-09 07:30',
      startAt: PROJECT.plannedStartAt.slice(0, 10),
      endAt: PROJECT.plannedEndAt.slice(0, 10),
      totalDays: totalDaysInclusive(PROJECT.plannedStartAt.slice(0, 10), PROJECT.plannedEndAt.slice(0, 10)),
      role: 'admin',
      pageRef: () => null,
      logo: null,
    }),
  );
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

describe.skipIf(!CAN_RUN)('经典版 A4 视觉验收 + 密度修订锁定（真 Chromium + 真实构建 CSS）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('经典版默认态：逐页 794×1123 无裁切 + 彩/灰截图（density-classic-*）', async () => {
    const css = builtCss();
    const markup = buildMarkup();

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const gray of [false, true]) {
        const htmlPath = writeHtml(
          gray ? 'classic-default-gray.html' : 'classic-default-color.html',
          shell(markup, css, gray),
        );
        await page.goto('file://' + htmlPath);
        const pages = await page.$$('.a4-page');
        expect(pages, '经典版应按分页估算出 ≥1 页').toHaveLength(PAGES.length);
        expect(pages.length).toBeGreaterThanOrEqual(1);
        for (let i = 0; i < pages.length; i++) {
          const el = pages[i]!;
          const box = await el.boundingBox();
          const tag = gray ? 'gray' : 'color';
          expect(box, `第 ${i + 1} 页应有布局盒`).not.toBeNull();
          expect(Math.abs(box!.width - 794), `第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
          expect(box!.height, `第 ${i + 1} 页高应恰 1123（溢出即红）`).toBeLessThanOrEqual(1124);
          expect(box!.height, `第 ${i + 1} 页高不得低于 1123`).toBeGreaterThanOrEqual(1122);
          await el.screenshot({ path: join(OUT_DIR, `density-classic-p${i + 1}-${tag}.png`) });
        }
      }
    } finally {
      await page.close();
    }
  });

  it('密度修订锁定：track 28 / 数据行 34 / 表头 30 / section mt-8 / 页头 pb-4 / 图例 mt-4', async () => {
    const css = builtCss();
    const markup = buildMarkup();

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      const htmlPath = writeHtml('classic-default-color.html', shell(markup, css, false));
      await page.goto('file://' + htmlPath);

      // ① 甘特轨道行 36→28px（细条不配宽跑道；轨道视觉厚薄由 inset-y-1.5 决定，不变）
      const track = await page.$eval('.schedule-bar-segment', (el) => {
        const row = el.parentElement as HTMLElement;
        return { h: row.getBoundingClientRect().height, cls: row.className };
      });
      expect(track.h, '甘特轨道行高应为 28px（h-7）').toBeCloseTo(28, 0);
      expect(track.cls, '轨道行结构定位类（band-bounds spec 同款）').toContain('h-7');

      // ② 清单数据行 42→34px、表头 34→30px
      const rowH = await page.$eval('.schedule-table tbody tr td', (el) => el.getBoundingClientRect().height);
      expect(rowH, '清单数据行高应为 34px').toBeCloseTo(34, 0);
      const headH = await page.$eval('.schedule-table thead th', (el) => el.getBoundingClientRect().height);
      expect(headH, '清单表头高应为 30px').toBeCloseTo(30, 0);

      // ③ section mt-6→mt-8（32px）：第一页的时间轴 + 阶段清单两个 section
      //    （第二页也有 stageTable section，故按页内查询，只量第一页）
      const sectionMt = await page.$$eval('.a4-page', (pageEls) =>
        Array.from(pageEls[0]!.querySelectorAll('section')).map((el) => getComputedStyle(el).marginTop),
      );
      expect(sectionMt, '第一页两个 section 的 margin-top 都应为 32px（mt-8）').toEqual(['32px', '32px']);

      // ④ 页头 pb-3→pb-4（16px）
      const headerPb = await page.$eval('.a4-page header', (el) => getComputedStyle(el).paddingBottom);
      expect(headerPb, '打印头部 padding-bottom 应为 16px（pb-4）').toBe('16px');

      // ⑤ 图例 mt-3→mt-4（16px）：图例在时间轴 section 内（项目信息行的 mt-4
      //    不在 section 内，不会误配）
      const legendMt = await page.$$eval('.a4-page', (pageEls) => {
        const legend = pageEls[0]!.querySelector('section .mt-4');
        return legend ? getComputedStyle(legend).marginTop : null;
      });
      expect(legendMt, '图例 margin-top 应为 16px（mt-4）').toBe('16px');

      // ⑥ 结构标记不断（既有 spec 钉的选择器族）：甘特/清单/页脚署名/页码
      expect(await page.$('.schedule-bar-segment')).not.toBeNull();
      expect(await page.$('.schedule-status-dot')).not.toBeNull();
      expect(await page.$('.schedule-table')).not.toBeNull();
      const text = (await page.textContent('body')) ?? '';
      expect(text).toContain('打印时间轴');
      expect(text).toContain('阶段清单');
      expect(text).toContain('ID Plan · 项目排期与交付管理');
      expect(text).toContain('第 1 / ');
    } finally {
      await page.close();
    }
  });
});
