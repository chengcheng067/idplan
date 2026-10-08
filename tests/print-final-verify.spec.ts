// @vitest-environment jsdom
/**
 * 四版打印模板 · 批 5 终验（跨全套；产品决策文档「验收分批」最后一批）。
 *
 * ── 为什么整份文件挂 jsdom 环境 ──
 * ⑤ 要驱动 usePrintPrefsStore 的 persist.rehydrate()——zustand 的
 * createJSONStorage(() => localStorage) 在 node 环境拿不到 localStorage，
 * persist 中间件静默不挂（store 上没有 .persist），node 环境下该用例直接
 * 跑不了。本文件其余部分（Chromium 截图 / fake-indexeddb / 纯函数）在
 * jsdom 下照常工作，故整份挂 jsdom，不拆文件。
 *
 * ── 六项各落在哪 ──
 *   ① 14 页默认态：四版同 VM 真实渲染，逐页 794×1123 无裁切 + 结构标记
 *      （A 有顶/底栏、E/H 无底栏、D 有 3px 头线、H 有局部中轴）——「与
 *      设计稿比对」的可断言部分（逐像素比对设计稿是人工活，spec 锁几何
 *      与结构，A/D 的先例 spec 同口径）；
 *   ② 自定义配色变体跨模板抽 2-3 页：每版取一个预设，断言「槽位确实挂上
 *     （computed style 变色）+ DOM 骨架与默认态逐字节一致（除 .print-root
 *      的 CSS 变量）」——产品决策文档 §3.2-③ 的结构断言；
 *   ③ 权限 VM diff（管理员 / 成员）：clientName 仅管理员、成员可见范围
 *      收窄、执行/提案随可见任务过滤（02 §3 装配顺序）；
 *   ④ 备份 roundtrip（logo base64 完整往返）：与 print-logo.spec.ts L2
 *      同源复跑一份（批 5 自包含证据，两处都绿才算数）；
 *   ⑤ prefs 旧 skin 键脏数据迁移：旧 `skin:'default'` + 踩线 palette 同一
 *      坨脏数据 ⇒ template 迁 classic、踩线配色 hydrate 时丢弃（禁存读
 *      路径同样生效）；
 *   ⑥ 全量测试：由仓库级 `npx vitest run` 承担（本 spec 不递归跑全套），
 *      数字见交付报告。
 *
 * 前置：`npm run build --outDir build-dist` 与本机 chromium；缺任一，
 * ① ② 的浏览器部分整组 skip（纯函数部分照常跑）。
 *
 * 产物落点：`outputs/print-a4-shots/final-*.png`（工作区交付目录，不进 git）。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { SwissScheduleDocument } from '../src/print/documents/SwissScheduleDocument';
import { DataEditorialDocument } from '../src/print/documents/DataEditorialDocument';
import { EditorialIndexDocument } from '../src/print/documents/EditorialIndexDocument';
import { AgentPosterDocument } from '../src/print/documents/AgentPosterDocument';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import { PRINT_LOGO_SETTING_KEY, savePrintLogo } from '../src/print/adapters/use-print-logo';
import { BackupService, validateBackupJson } from '../src/core/services/backup.service';
import { emptyPackage } from './helpers/backup-fixture';
import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
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
import type { Execution, WritebackProposal } from '../src/core/types/agent-execution';
import { PRINT_PREFS_STORAGE_KEY, usePrintPrefsStore } from '../src/store/usePrintPrefsStore';

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

/* ------------------------------------------------------------------ 夹具（四版通吃） */

const TODAY = '2026-10-09';
const PROJECT_ID = 'proj_final';

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
  id: 'm-final-human',
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

/** 普通成员（权限 diff 用：只关联 stage 3 的任务） */
const PLAIN: Member = {
  id: 'm-final-plain',
  name: '施工方乙',
  role: '驻场工程师',
  contact: null,
  avatarColor: '#3D6B5B',
  active: true,
  roleKind: MemberRoleKind.Member,
  passwordHash: null,
  actorKind: MemberActorKind.Human,
  agentKind: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const AGENT: Member = {
  id: 'm-final-agent',
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

/** 6 个可见阶段（四态齐全）+ 1 个隐藏阶段（权限 / 依赖缺失引用用） */
const STAGES: Stage[] = Array.from({ length: 6 }, (_, i) => {
  const n = i + 1;
  return {
    id: `stg_final_${n}`,
    projectId: PROJECT_ID,
    orderIndex: n,
    templateKey: null,
    colorIndex: ((n - 1) % 9) + 1,
    customColor: null,
    name: `阶段${n}·${n % 2 === 0 ? '方案深化与图纸会审' : '现场勘查'}`,
    ratioPercent: 15,
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
    ownerId: n === 2 ? AGENT.id : n === 3 ? PLAIN.id : HUMAN.id,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
});
STAGES.push({
  id: 'stg_final_hidden',
  projectId: PROJECT_ID,
  orderIndex: 7,
  templateKey: null,
  colorIndex: 9,
  customColor: null,
  name: '隐藏阶段',
  ratioPercent: 10,
  startAt: '2026-02-01T00:00:00Z',
  endAt: '2026-02-20T23:59:59Z',
  status: StageStatus.NotStarted,
  ownerId: HUMAN.id,
  visible: false,
  resourcePath: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
});

/** 8 个任务（依赖链 + 环 + 缺失引用 + 产出物 + Agent 来源） */
function taskDependsOn(n: number): string[] {
  switch (n) {
    case 2:
      return ['tsk_final_1'];
    case 3:
      return ['tsk_final_2'];
    case 4:
      return ['tsk_final_3'];
    case 5:
      return ['tsk_final_4'];
    case 6:
      return ['tsk_final_5'];
    case 7:
      return ['tsk_final_6'];
    case 8:
      return ['tsk_final_7', 'tsk_final_ghost'];
    default:
      return [];
  }
}

const TASKS: Task[] = Array.from({ length: 8 }, (_, i) => {
  const n = i + 1;
  const agentSource = n === 2 || n === 5;
  return {
    id: `tsk_final_${n}`,
    taskNo: 2000 + n,
    projectId: PROJECT_ID,
    stageId: `stg_final_${((n - 1) % 6) + 1}`,
    title: `任务${n}·整理测绘图与材料清单并同步给施工方确认`,
    done: false,
    assigneeId: n === 3 ? PLAIN.id : HUMAN.id,
    assigneeIds: n === 3 ? [PLAIN.id] : agentSource ? [AGENT.id] : [HUMAN.id],
    dueDate: n === 4 ? '2026-10-01' : null,
    source: agentSource ? 'agent' : 'human',
    externalId: null,
    agentId: agentSource ? AGENT.id : null,
    status:
      n === 4
        ? TaskStatus.Blocked
        : n % 3 === 0
          ? TaskStatus.Done
          : n % 3 === 1
            ? TaskStatus.InProgress
            : TaskStatus.Ready,
    description: null,
    dependsOn: taskDependsOn(n),
    artifacts:
      n <= 4
        ? [
            { id: `art_final_${n}_1`, kind: n % 2 === 0 ? 'doc' : 'task_md', title: '会议纪要', path: null, url: null, note: null },
            { id: `art_final_${n}_2`, kind: 'file', title: '测绘图与工程量清单', path: null, url: null, note: null },
          ]
        : [],
    startAt: null,
    claimedAt: null,
    runId: agentSource ? `run_final_${n}` : null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
});

const LOGS: StageLog[] = [
  {
    id: 'log_final_1',
    stageId: 'stg_final_3',
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

const EXECUTIONS: Execution[] = [
  {
    id: 'exec_final_1',
    projectId: PROJECT_ID,
    taskId: 'tsk_final_2',
    source: 'project-task',
    objective: '整理测绘图与材料清单并同步给施工方确认',
    agentMemberId: AGENT.id,
    channelKind: 'loopback',
    inputSnapshotHash: null,
    status: 'running',
    confirmation: null,
    idempotencyKey: 'exec:project-task:proj_final:1',
    currentAttemptNo: 2,
    createdAt: '2026-10-08T01:00:00Z',
    updatedAt: '2026-10-08T02:00:00Z',
    startedAt: '2026-10-08T01:30:00Z',
    finishedAt: null,
    terminalReason: null,
    blockedReason: null,
  },
  {
    id: 'exec_final_2',
    projectId: PROJECT_ID,
    taskId: 'tsk_final_5',
    source: 'natural-language',
    objective: '补充主材样品清单',
    agentMemberId: AGENT.id,
    channelKind: null,
    inputSnapshotHash: null,
    status: 'needs_attention',
    confirmation: null,
    idempotencyKey: 'exec:natural-language:proj_final:2',
    currentAttemptNo: 1,
    createdAt: '2026-10-07T01:00:00Z',
    updatedAt: '2026-10-07T03:00:00Z',
    startedAt: '2026-10-07T01:10:00Z',
    finishedAt: null,
    terminalReason: null,
    blockedReason: '缺输入：客户主材样品未确认',
  },
];

const PROPOSALS: WritebackProposal[] = [
  {
    id: 'wb_final_1',
    executionId: 'exec_final_1',
    attemptId: null,
    projectId: PROJECT_ID,
    taskId: 'tsk_final_2',
    operations: [{ field: 'task.status', before: 'ready', after: 'in_progress' }],
    status: 'proposed',
    idempotencyKey: 'wb:exec_final_1:tsk_final_2:task.status',
    reason: '测绘图已归档，状态可推进',
    confidence: 0.82,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-10-08T02:00:00Z',
    updatedAt: '2026-10-08T02:00:00Z',
  },
  {
    id: 'wb_final_2',
    executionId: 'exec_final_2',
    attemptId: null,
    projectId: PROJECT_ID,
    taskId: 'tsk_final_5',
    operations: [{ field: 'task.notes.append', before: null, after: '已补充样品清单' }],
    status: 'conflict',
    idempotencyKey: 'wb:exec_final_2:tsk_final_5:task.notes.append',
    reason: null,
    confidence: 0.66,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-10-07T03:00:00Z',
    updatedAt: '2026-10-07T03:00:00Z',
  },
];

function buildVm(role: MemberRoleKind, currentMemberId: string | null) {
  return buildPrintViewModel({
    project: PROJECT,
    stages: STAGES,
    tasks: TASKS,
    members: [HUMAN, PLAIN, AGENT],
    stageLogs: LOGS,
    executions: EXECUTIONS,
    proposals: PROPOSALS,
    role,
    currentMemberId,
    todayIso: TODAY,
    now: new Date('2026-10-09T07:30:00Z'),
  });
}

/** 管理员视角 VM（四版默认态共用） */
function adminVm() {
  return buildVm(MemberRoleKind.Admin, HUMAN.id);
}

/* ------------------------------------------------------------------ HTML 装配 */

function shell(bodyMarkup: string, css: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${css}</style></head><body style="margin:0;background:#fff">${bodyMarkup}</body></html>`;
}

function writeHtml(name: string, html: string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const p = join(OUT_DIR, name);
  writeFileSync(p, html, 'utf-8');
  return p;
}

/* ====================================================================================
 * ① 14 页默认态（真 Chromium：四版同 VM，逐页无裁切 + 结构标记）
 * ==================================================================================== */

describe.skipIf(!CAN_RUN)('批 5 · ① 14 页默认态（四版同 VM 真实渲染）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('四版默认态：4 + 4 + 3 + 3 = 14 页，逐页 794×1123 无裁切，结构标记各就位', async () => {
    const css = builtCss();
    const vm = adminVm();
    const cases: Array<{ tag: string; markup: string; expected: number }> = [
      {
        tag: 'a',
        markup: renderToStaticMarkup(
          createElement(SwissScheduleDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline }),
        ),
        expected: 4,
      },
      {
        tag: 'd',
        markup: renderToStaticMarkup(
          createElement(DataEditorialDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['data-editorial'].baseline }),
        ),
        expected: 4,
      },
      {
        tag: 'e',
        markup: renderToStaticMarkup(
          createElement(EditorialIndexDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['editorial-index'].baseline }),
        ),
        expected: 3,
      },
      {
        tag: 'h',
        markup: renderToStaticMarkup(
          createElement(AgentPosterDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['agent-poster'].baseline }),
        ),
        expected: 3,
      },
    ];

    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    let totalPages = 0;
    try {
      for (const c of cases) {
        const htmlPath = writeHtml(`final-${c.tag}.html`, shell(c.markup, css));
        await page.goto('file://' + htmlPath);
        const pages = await page.$$('.a4-page');
        expect(pages.length, `${c.tag} 版应渲染 ${c.expected} 页`).toBe(c.expected);
        totalPages += pages.length;
        for (let i = 0; i < pages.length; i++) {
          const box = await pages[i]!.boundingBox();
          expect(Math.abs(box!.width - 794), `${c.tag} 第 ${i + 1} 页宽应 794`).toBeLessThanOrEqual(1);
          expect(box!.height, `${c.tag} 第 ${i + 1} 页溢出即红`).toBeLessThanOrEqual(1124);
          expect(box!.height, `${c.tag} 第 ${i + 1} 页不得低于 1123`).toBeGreaterThanOrEqual(1122);
          await pages[i]!.screenshot({ path: join(OUT_DIR, `final-${c.tag}-p${i + 1}-color.png`) });
        }
      }
      expect(totalPages, '四版合计 14 页').toBe(14);
    } finally {
      await page.close();
    }
  });

  it('四版结构标记：A 有黑顶/底栏；D 有 3px 头线；E/H 无底栏；H 有局部中轴', async () => {
    const css = builtCss();
    const vm = adminVm();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    try {
      // A：黑顶栏 + 黑底栏（01 §4：A 允许并保留）
      await page.goto('file://' + writeHtml('final-a.html', shell(renderToStaticMarkup(
        createElement(SwissScheduleDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline }),
      ), css)));
      const aBar = await page.$eval('.swiss-bottombar', (el) => getComputedStyle(el).backgroundColor);
      expect(aBar, 'A 版保留黑底栏').toBe('rgb(25, 24, 22)');

      // D：3px 近黑硬边全出血头线
      await page.goto('file://' + writeHtml('final-d.html', shell(renderToStaticMarkup(
        createElement(DataEditorialDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['data-editorial'].baseline }),
      ), css)));
      const dRule = await page.$eval('.de-head__rule', (el) => {
        const s = getComputedStyle(el);
        return { h: s.height, bg: s.backgroundColor };
      });
      expect(dRule.h).toBe('3px');
      expect(dRule.bg).toBe('rgb(10, 10, 10)');

      // E：无底部黑栏（页脚背景透明）
      await page.goto('file://' + writeHtml('final-e.html', shell(renderToStaticMarkup(
        createElement(EditorialIndexDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['editorial-index'].baseline }),
      ), css)));
      const eFoot = await page.$eval('.ei-foot', (el) => getComputedStyle(el).backgroundColor);
      expect(eFoot, 'E 版无底部黑栏').toBe('rgba(0, 0, 0, 0)');

      // H：无底部黑栏 + 双栏容器有中轴伪元素
      await page.goto('file://' + writeHtml('final-h.html', shell(renderToStaticMarkup(
        createElement(AgentPosterDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['agent-poster'].baseline }),
      ), css)));
      const hFoot = await page.$eval('.ap-foot', (el) => getComputedStyle(el).backgroundColor);
      expect(hFoot, 'H 版无底部黑栏').toBe('rgba(0, 0, 0, 0)');
      const hAxis = await page.$eval('.ap-status__cols', (el) => {
        const s = getComputedStyle(el, '::before');
        return { position: s.position, width: s.width };
      });
      expect(hAxis.position, 'H 版中轴是双栏容器伪元素').toBe('absolute');
      expect(hAxis.width).toBe('1px');
    } finally {
      await page.close();
    }
  });
});

/* ====================================================================================
 * ② 自定义配色变体跨模板（槽位挂上 + 骨架逐字节一致）
 * ==================================================================================== */

describe('批 5 · ② 自定义配色变体（槽位挂上 + DOM 骨架不变）', () => {
  /**
   * 剥掉配色派生的差异，剩下的就是骨架：
   *   ① .print-root 上的 inline style（三枚 CSS 变量——产品决策文档明列的
   *      唯一允许差异）；
   *   ② logo 的 data-tone（A 版暗栏反白 / 亮栏原样，由 palette.line 亮度
   *      判定——与 CSS 变量同性质的「配色派生值」，只是落在 DOM 属性上；
   *      两态都剥，只比较「有没有这枚 logo 标记」）。
   */
  function skeleton(markup: string): string {
    return markup
      .replace(/(<div class="print-root[^"]*")\s+style="[^"]*"/, '$1')
      .replace(/ data-tone="(on-dark|ink)"/g, '');
  }

  it('每版取一个预设：骨架与默认态逐字节一致（除 CSS 变量）', () => {
    const vm = adminVm();
    const cases: Array<{
      id: 'swiss-schedule' | 'data-editorial' | 'editorial-index' | 'agent-poster';
      presetId: string;
      render: (palette: (typeof PRINT_TEMPLATE_PALETTES)[keyof typeof PRINT_TEMPLATE_PALETTES]['baseline']) => string;
    }> = [
      {
        id: 'swiss-schedule',
        presetId: 'platform-blue',
        render: (p) =>
          renderToStaticMarkup(createElement(SwissScheduleDocument, { vm, palette: p })),
      },
      {
        id: 'data-editorial',
        presetId: 'indigo',
        render: (p) =>
          renderToStaticMarkup(createElement(DataEditorialDocument, { vm, palette: p })),
      },
      {
        id: 'editorial-index',
        presetId: 'indigo',
        render: (p) =>
          renderToStaticMarkup(createElement(EditorialIndexDocument, { vm, palette: p })),
      },
      {
        id: 'agent-poster',
        presetId: 'vermilion',
        render: (p) =>
          renderToStaticMarkup(createElement(AgentPosterDocument, { vm, palette: p })),
      },
    ];

    for (const c of cases) {
      const spec = PRINT_TEMPLATE_PALETTES[c.id];
      const preset = spec.presets.find((p) => p.id === c.presetId);
      expect(preset, `${c.id} 应有预设 ${c.presetId}`).toBeDefined();
      const defaultMarkup = c.render(spec.baseline);
      const presetMarkup = c.render(preset!.palette);
      // 结构断言：骨架逐字节一致（用户入口碰不到布局，产品决策文档 §3.2-③）
      expect(skeleton(presetMarkup), `${c.id} 骨架应不随配色变化`).toBe(skeleton(defaultMarkup));
      // 差异只在 .print-root 的三枚 CSS 变量（React 对自定义属性序列化
      // 不带空格：`--tpl-accent:#16324F`，与 DOM getAttribute 的规范化
      // 形式 `--tpl-accent: #16324F` 不同——print-options.spec ⑦ 断言的是
      // 后者，此处是静态 markup，用前者）
      expect(presetMarkup).toContain(`--tpl-accent:${preset!.palette.accent}`);
      expect(defaultMarkup).toContain(`--tpl-accent:${spec.baseline.accent}`);
    }
  });
});

/* ====================================================================================
 * ③ 权限 VM diff（管理员 / 成员）
 * ==================================================================================== */

describe('批 5 · ③ 权限 VM diff（管理员 / 普通成员）', () => {
  it('成员 VM：clientName 恒 undefined、可见范围收窄、执行/提案随可见任务过滤', () => {
    const admin = adminVm();
    const member = buildVm(MemberRoleKind.Member, PLAIN.id);

    // clientName 仅管理员（02 §3 第 5 步：普通成员 VM 里是 undefined）
    expect(admin.project.clientName).toBe('客户甲');
    expect(member.project.clientName).toBeUndefined();

    // 可见范围：成员只见与自己相关的阶段（PLAIN 是 stage 3 的负责人 + 任务指派人）
    expect(admin.stages.length, '管理员见全部 6 个可见阶段').toBe(6);
    expect(member.stages.length, '成员范围收窄').toBeLessThan(admin.stages.length);
    expect(member.stages.length).toBeGreaterThan(0);
    // 隐藏阶段任何角色都不可见
    expect(admin.stages.some((s) => s.id === 'stg_final_hidden')).toBe(false);
    expect(member.stages.some((s) => s.id === 'stg_final_hidden')).toBe(false);

    // 执行 / 提案随可见任务过滤：成员看不见 tsk_final_2（stage 2）上的执行
    const memberTaskIds = new Set(member.tasks.map((t) => t.id));
    for (const e of member.executions) {
      if (e.taskId !== null) expect(memberTaskIds.has(e.taskId), '执行不得引用不可见任务').toBe(true);
    }
    for (const p of member.proposals) {
      if (p.taskId !== null) expect(memberTaskIds.has(p.taskId), '提案不得引用不可见任务').toBe(true);
    }
    // 管理员视角两条执行都在（夹具一条在 stage 2、一条在 stage 5）
    expect(admin.executions.length).toBe(2);
    // 成员视角至少滤掉一条（范围收窄的直接后果）
    expect(member.executions.length).toBeLessThan(admin.executions.length);
  });
});

/* ====================================================================================
 * ④ 备份 roundtrip（logo base64 完整往返；与 print-logo.spec.ts L2 同源复跑）
 * ==================================================================================== */

describe('批 5 · ④ 备份 roundtrip（logo base64 随 KV 表完整往返）', () => {
  let bundle: IRepositoryBundle;

  beforeAll(async () => {
    await installFakeIndexedDB();
  });

  beforeEach(async () => {
    bundle = await createRepositories({ dataSource: 'local' });
    await bundle.admin?.replaceAllImport(emptyPackage());
  });

  it('导出 → 清库 → 导入 → 读回：printLogo 的 dataURL 逐字符不变', async () => {
    const logo =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await savePrintLogo(bundle, logo);

    const pkg = await new BackupService(bundle).exportAll();
    expect(pkg.data.settings.some((r) => r.key === PRINT_LOGO_SETTING_KEY)).toBe(true);
    expect(() => validateBackupJson(pkg)).not.toThrow();

    const fresh = await createRepositories({ dataSource: 'local' });
    await fresh.admin?.replaceAllImport(emptyPackage());
    await new BackupService(fresh).importAndReplace(pkg);
    expect(await fresh.settings.get<string>(PRINT_LOGO_SETTING_KEY)).toBe(logo);
  });
});

/* ====================================================================================
 * ⑤ prefs 旧 skin 键脏数据迁移（hydrate 时迁移 + 踩线配色丢弃）
 * ==================================================================================== */

describe('批 5 · ⑤ prefs 旧 skin 键脏数据迁移', () => {
  beforeEach(async () => {
    await usePrintPrefsStore.persist.rehydrate();
  });

  it('旧 skin 键 + 踩线 palette 同一坨脏数据 ⇒ template 迁 classic、踩线配色被丢弃', async () => {
    localStorage.setItem(
      PRINT_PREFS_STORAGE_KEY,
      JSON.stringify({
        state: {
          blocks: { header: false },
          // 旧 skin 键（v0.8.6.0002 的持久形状）
          skin: 'default',
          // 踩线配色：浅黄纸 + 白字 + 白栏 ⇒ 三对全挂（禁存）
          palette: {
            'swiss-schedule': { accent: '#FFF8E1', ink: '#FFFFFF', line: '#FFFFFF' },
          },
        },
        version: 0,
      }),
    );
    await usePrintPrefsStore.persist.rehydrate();
    const s = usePrintPrefsStore.getState();
    expect(s.template, '旧 skin:default 迁成 classic').toBe('classic');
    expect(s.blocks.header, '缺键回落默认全开之外，显式 false 仍生效').toBe(false);
    expect(s.palette['swiss-schedule'], '踩线配色 hydrate 时丢弃（禁存读路径同样生效）').toBeUndefined();

    // 干净预设则照常收（闸门只拦踩线，不拦达标）
    localStorage.setItem(
      PRINT_PREFS_STORAGE_KEY,
      JSON.stringify({
        state: {
          skin: 'default',
          palette: {
            'swiss-schedule': { accent: '#16324F', ink: '#F2D957', line: '#F2D957' },
          },
        },
        version: 0,
      }),
    );
    await usePrintPrefsStore.persist.rehydrate();
    expect(usePrintPrefsStore.getState().palette['swiss-schedule']).toEqual({
      accent: '#16324F',
      ink: '#F2D957',
      line: '#F2D957',
    });
  });
});
