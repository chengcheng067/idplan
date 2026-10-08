/**
 * A 版 A4 视觉验收（批 1：真构建产物 + 真 Chromium 实测，不真打黑白打印机）。
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

import { SwissScheduleDocument } from '../src/print/documents/SwissScheduleDocument';
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
  const assets = join(ROOT, 'build-dist', 'assets');
  return readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assets, f), 'utf-8'))
    .join('\n');
}

/* ------------------------------------------------------------------ 夹具（真实形状） */

const TODAY = '2026-10-09';
const PROJECT_ID = 'proj_a4';

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

  it('A 版四页：默认态彩色 4 张 + 灰度 4 张；794×1123 无裁切', async () => {
    const css = builtCss();
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline;
    const markup = renderToStaticMarkup(
      createElement(SwissScheduleDocument, { vm, palette: baseline }),
    );

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      for (const gray of [false, true]) {
        const htmlPath = writeHtml(
          gray ? 'a-default-gray.html' : 'a-default-color.html',
          shell(markup, css, gray),
        );
        await page.goto('file://' + htmlPath);
        const pages = await page.$$('.a4-page');
        expect(pages, 'A 版应渲染 4 页').toHaveLength(4);
        for (let i = 0; i < pages.length; i++) {
          const el = pages[i]!;
          const box = await el.boundingBox();
          const tag = gray ? 'gray' : 'color';
          expect(box, `第 ${i + 1} 页应有布局盒`).not.toBeNull();
          // 794×1123 无裁切：盒宽必须精确 794；盒高超过 1123 = 内容溢出（裁切/孤儿页脚风险）
          expect(Math.abs(box!.width - 794), `第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
          expect(box!.height, `第 ${i + 1} 页高应恰 1123（溢出即红）`).toBeLessThanOrEqual(1124);
          expect(box!.height, `第 ${i + 1} 页高不得低于 1123`).toBeGreaterThanOrEqual(1122);
          await el.screenshot({ path: join(OUT_DIR, `density-a-p${i + 1}-${tag}.png`) });
        }
      }
    } finally {
      await page.close();
    }
  });

  it('A 版四页：套预设变体（站台蓝）彩色 4 张；深色纸仍 794×1123 无裁切', async () => {
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
      expect(pages).toHaveLength(4);
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
