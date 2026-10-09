/**
 * 全局打印 logo 验收（产品决策文档 §3.3；批 5 ④ 备份 roundtrip 的重点）。
 *
 * ── 为什么整份文件是 node 环境（不挂 @vitest-environment jsdom）──
 * L4 要在真 Chromium 里跑**真实源码**（esbuild transform + 静态服务），
 * 而 jsdom 环境的 TextEncoder 会破坏 esbuild 的不变量检查（实测报
 * "new TextEncoder().encode('') instanceof Uint8Array is incorrectly
 * false"）。L3 的 DOM 查询改用 `new JSDOM(markup)` 直接解析静态纸面，
 * 不依赖 vitest 的 jsdom 环境——一份文件一个环境，两条路都走真货。
 *
 * ── 锁的事 ──
 * L1 纯函数（node，无 canvas）：
 *   ① binarizePixels：浅底深字 / 深底浅字（反相）/ 透明像素 / 阈值边界；
 *   ② firstFittingDataUrl：体积阶梯（320→240→160→120）+ ≤200KB 闸门
 *      （踩线拒存、达标放行——决策文档把「备份 JSON 不被一张图撑爆」
 *      列为该方案唯一的真实风险）；
 *   ③ parseLogoRow：KV 脏数据（坏 JSON / 非字符串 / 空串）静默 null。
 * L2 存储与备份（fake-indexeddb）：
 *   ④ savePrintLogo 落 settings KV `printLogo`；删除 = 空串（解析为 null）；
 *   ⑤ **备份 roundtrip**：logo base64 随 KV 表整体导出 → 清库 → 导入 →
 *      再读回，dataURL 逐字符不变（批 5 ④ 的验收重点，换设备能恢复）。
 * L3 四版位置（静态纸面，jsdom）：
 *   ⑥ A = 黑顶栏左端 ≤24px（暗栏反白 data-tone；亮栏预设原样）；
 *      D = 每页头部左上格 ≤28px；E = 每页左上角发丝线下方 ≤22px；
 *      H = P1 巨字下方左侧 ≤24px、P2/P3 左上角 ≤22px；
 *      classic = 页脚署名旁（署名字样逐字保留）；
 *   ⑦ 未上传 ⇒ 四版统一「ID Plan」文字标（不留空、不占位灰块）；
 *   ⑧ 中轴区域严禁放 logo（H P2 双栏容器内无 logo）。
 * L4 Chromium 集成（真上传链路，skipIf !CAN_RUN）：
 *   ⑨ processPrintLogoFile：真 PNG → 二值化 dataURL（≤200KB、解码后
 *      只有「实心黑 / 全透明」两种像素）。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { JSDOM } from 'jsdom';

import {
  BINARIZE_THRESHOLD,
  PRINT_LOGO_MAX_CHARS,
  binarizePixels,
  firstFittingDataUrl,
  processPrintLogoFile,
} from '../src/lib/print-logo-image';
import {
  PRINT_LOGO_SETTING_KEY,
  parseLogoRow,
  savePrintLogo,
} from '../src/print/adapters/use-print-logo';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { SwissScheduleDocument } from '../src/print/documents/SwissScheduleDocument';
import { DataEditorialDocument } from '../src/print/documents/DataEditorialDocument';
import { EditorialIndexDocument } from '../src/print/documents/EditorialIndexDocument';
import { AgentPosterDocument } from '../src/print/documents/AgentPosterDocument';
import { SchedulePaper } from '../src/components/print/SchedulePaper';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { PRINT_TEMPLATE_PALETTES } from '../src/print/model/print-palette';
import { installFakeIndexedDB } from './setup';
import { listenOnSafePort } from './helpers/safe-listen';
import { createRepositories } from '../src/core/repositories';
import { BackupService, validateBackupJson } from '../src/core/services/backup.service';
import { emptyPackage } from './helpers/backup-fixture';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import type { Execution, Member, Project, Stage, Task, WritebackProposal } from '../src/core/types/entities';
import type { SchedulePaperBlocks } from '../src/lib/schedule-print';

/* ====================================================================================
 * 夹具（真实形状的最小集：四版渲染 + VM 装配各取所需）
 * ==================================================================================== */

const TODAY = '2026-10-09';
const PROJECT_ID = 'proj_logo';

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
  id: 'm-logo-human',
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
  id: 'm-logo-agent',
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
    id: 'stg_logo_1',
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
    id: 'stg_logo_2',
    projectId: PROJECT_ID,
    orderIndex: 2,
    templateKey: null,
    colorIndex: 2,
    customColor: null,
    name: '方案深化',
    ratioPercent: 60,
    startAt: '2026-01-21T00:00:00Z',
    endAt: '2026-02-20T23:59:59Z',
    status: StageStatus.Completed,
    ownerId: HUMAN.id,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const TASKS: Task[] = [
  {
    id: 'tsk_logo_1',
    taskNo: 1042,
    projectId: PROJECT_ID,
    stageId: 'stg_logo_1',
    title: '整理测绘图与材料清单',
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
    artifacts: [{ id: 'art_logo_1', kind: 'doc', title: '会议纪要', path: null, url: null, note: null }],
    startAt: null,
    claimedAt: null,
    runId: 'run_logo_001',
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const EXECUTIONS: Execution[] = [
  {
    id: 'exec_logo_1',
    projectId: PROJECT_ID,
    taskId: 'tsk_logo_1',
    source: 'project-task',
    objective: '整理测绘图与材料清单',
    agentMemberId: AGENT.id,
    channelKind: 'loopback',
    inputSnapshotHash: null,
    status: 'running',
    confirmation: null,
    idempotencyKey: 'exec:project-task:proj_logo:1',
    currentAttemptNo: 1,
    createdAt: '2026-10-08T01:00:00Z',
    updatedAt: '2026-10-08T02:00:00Z',
    startedAt: '2026-10-08T01:30:00Z',
    finishedAt: null,
    terminalReason: null,
    blockedReason: null,
  },
];

const PROPOSALS: WritebackProposal[] = [
  {
    id: 'wb_logo_1',
    executionId: 'exec_logo_1',
    attemptId: null,
    projectId: PROJECT_ID,
    taskId: 'tsk_logo_1',
    operations: [{ field: 'task.status', before: 'ready', after: 'in_progress' }],
    status: 'proposed',
    idempotencyKey: 'wb:exec_logo_1:tsk_logo_1:task.status',
    reason: '测绘图已归档',
    confidence: 0.82,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-10-08T02:00:00Z',
    updatedAt: '2026-10-08T02:00:00Z',
  },
];

function buildVm(): ReturnType<typeof buildPrintViewModel> {
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
  });
}

/** 一枚 1×1 透明 PNG dataURL（四版挂载断言用；真实二值化产物由 L4 覆盖） */
const TINY_LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/* ====================================================================================
 * L1 · 纯函数（二值化 / 体积闸门 / KV 解析）
 * ==================================================================================== */

describe('打印 logo · L1 纯函数（二值化 / 体积闸门 / KV 脏数据）', () => {
  /** 造 n 个像素（每像素 [r,g,b,a] 四元组展平） */
  function px(...pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
    return new Uint8ClampedArray(pixels.flat());
  }

  it('binarizePixels：浅底深字（不透明浅底 + 深色内容）⇒ 深色成标、底色透明', () => {
    // 4 像素：3 白底 + 1 深灰字（不透明占比 100%，均亮 ≈201 ⇒ 不反相）
    const data = px([255, 255, 255, 255], [38, 38, 38, 255], [255, 255, 255, 255], [255, 255, 255, 255]);
    binarizePixels(data, 4, 1);
    expect([...data]).toEqual([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('binarizePixels：深底浅字（不透明深底 + 白字）⇒ 反相后白字成标、底色透明', () => {
    // 4 像素：3 深底 + 1 白字（不透明占比 100%，均亮 ≈76 < 128，亮像素 25% ⇒ 反相）
    const data = px([16, 16, 16, 255], [255, 255, 255, 255], [16, 16, 16, 255], [16, 16, 16, 255]);
    binarizePixels(data, 4, 1);
    expect([...data]).toEqual([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('binarizePixels：透明底黑字 ⇒ 不反相，黑字如实成标（误反相会让 logo 消失）', () => {
    // 4 像素：1 黑字 + 3 透明（不透明占比 25% < 50% ⇒ 透明底，不反相）
    const data = px([16, 16, 16, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    binarizePixels(data, 4, 1);
    expect([...data]).toEqual([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('binarizePixels：白字透明底 ⇒ 浅色内容也转黑（亮纸面上要可见）', () => {
    const data = px([255, 255, 255, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    binarizePixels(data, 4, 1);
    expect([...data]).toEqual([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('binarizePixels：纯深色填充图（无浅色内容）⇒ 不反相，如实成实心黑块', () => {
    // 4 像素全深色不透明：均亮暗但亮像素占比 0 ⇒ 反相会把内容反没，故不反相
    const data = px([16, 16, 16, 255], [16, 16, 16, 255], [16, 16, 16, 255], [16, 16, 16, 255]);
    binarizePixels(data, 4, 1);
    expect([...data]).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  });

  it('binarizePixels：透明像素保持透明（不硬造黑边）；全透明图原样返回', () => {
    const semi = px([0, 0, 0, 0], [10, 10, 10, 64]);
    binarizePixels(semi, 2, 1);
    expect([...semi]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    const allClear = px([0, 0, 0, 0], [0, 0, 0, 0]);
    binarizePixels(allClear, 2, 1);
    expect([...allClear]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('binarizePixels：阈值边界（恰达阈值不标记，低于阈值才标记）', () => {
    const at = px([BINARIZE_THRESHOLD, BINARIZE_THRESHOLD, BINARIZE_THRESHOLD, 255]);
    const below = px([BINARIZE_THRESHOLD - 1, BINARIZE_THRESHOLD - 1, BINARIZE_THRESHOLD - 1, 255]);
    binarizePixels(at, 1, 1);
    binarizePixels(below, 1, 1);
    expect(at[3]).toBe(0);
    expect(below[3]).toBe(255);
  });

  it('firstFittingDataUrl：体积阶梯 320→240→160→120，超限降档、全超限拒绝', () => {
    const big = 'x'.repeat(PRINT_LOGO_MAX_CHARS + 1);
    const small = 'x'.repeat(1024);
    // 第三档（160）才放行 ⇒ 返回 160 档产物（前面的 320/240 超限被跳过）
    expect(firstFittingDataUrl((edge) => (edge <= 160 ? small : big))).toBe(small);
    // 四档全超限 ⇒ null（上传被拒绝，带压缩提示）
    expect(firstFittingDataUrl(() => big)).toBeNull();
  });

  it('parseLogoRow：KV 脏数据（坏 JSON / 非字符串 / 空串）静默 null', () => {
    expect(parseLogoRow([{ key: 'printLogo', valueJson: '{oops' }])).toBeNull();
    expect(parseLogoRow([{ key: 'printLogo', valueJson: '42' }])).toBeNull();
    expect(parseLogoRow([{ key: 'printLogo', valueJson: '""' }])).toBeNull();
    expect(parseLogoRow([{ key: 'other', valueJson: '"data:..."' }])).toBeNull();
    expect(parseLogoRow([{ key: 'printLogo', valueJson: JSON.stringify(TINY_LOGO) }])).toBe(TINY_LOGO);
  });
});

/* ====================================================================================
 * L2 · 存储与备份 roundtrip（fake-indexeddb）
 * ==================================================================================== */

describe('打印 logo · L2 settings KV 存储 + 备份 roundtrip（批 5 ④）', () => {
  let bundle: IRepositoryBundle;

  beforeAll(async () => {
    await installFakeIndexedDB();
  });

  beforeEach(async () => {
    bundle = await createRepositories({ dataSource: 'local' });
    await bundle.admin?.replaceAllImport(emptyPackage());
  });

  it('savePrintLogo：落 settings KV `printLogo`；删除 = 空串（读回 null）', async () => {
    await savePrintLogo(bundle, TINY_LOGO);
    const row = await bundle.settings.get<string>(PRINT_LOGO_SETTING_KEY);
    expect(row).toBe(TINY_LOGO);
    // 删除 = 写空串 ⇒ 解析为 null ⇒ 四版回落文字标
    await savePrintLogo(bundle, '');
    expect(await bundle.settings.get<string>(PRINT_LOGO_SETTING_KEY)).toBe('');
    expect(parseLogoRow([{ key: PRINT_LOGO_SETTING_KEY, valueJson: '""' }])).toBeNull();
  });

  it('备份 roundtrip：logo base64 随 KV 表整体导出 → 清库 → 导入 → 逐字符不变', async () => {
    await savePrintLogo(bundle, TINY_LOGO);

    // 导出（含 settings KV 表）
    const svc = new BackupService(bundle);
    const pkg = await svc.exportAll();
    const logoRow = pkg.data.settings.find((r) => r.key === PRINT_LOGO_SETTING_KEY);
    expect(logoRow, '备份应含 printLogo 行').toBeDefined();
    expect(JSON.parse(logoRow!.valueJson)).toBe(TINY_LOGO);

    // 结构校验通过（zod 不拒 settings 行）
    expect(() => validateBackupJson(pkg)).not.toThrow();

    // 清库（模拟换设备：全新库）
    const fresh = await createRepositories({ dataSource: 'local' });
    await fresh.admin?.replaceAllImport(emptyPackage());
    expect(await fresh.settings.get<string>(PRINT_LOGO_SETTING_KEY)).toBeNull();

    // 导入 + 读回：dataURL 逐字符不变（批 5 ④ 的验收重点）
    await new BackupService(fresh).importAndReplace(pkg);
    const restored = await fresh.settings.get<string>(PRINT_LOGO_SETTING_KEY);
    expect(restored).toBe(TINY_LOGO);
    expect(restored!.length).toBe(TINY_LOGO.length);
  });
});

/* ====================================================================================
 * L3 · 四版位置（静态纸面；node 环境用 JSDOM 直接解析 markup）
 * ==================================================================================== */

describe('打印 logo · L3 四版挂点与空态文字标（静态纸面）', () => {
  function parse(markup: string): Document {
    return new JSDOM(markup).window.document;
  }

  /** 纸面里所有 img.print-logo 的高度（px） */
  function logoHeights(doc: Document): number[] {
    return Array.from(doc.querySelectorAll('img.print-logo')).map((el) =>
      parseInt((el as HTMLElement).style.height, 10),
    );
  }

  function logoTexts(doc: Document): string[] {
    return Array.from(doc.querySelectorAll('[data-print-logo="text"]')).map(
      (el) => (el.textContent ?? '').trim(),
    );
  }

  it('A 版：logo 在黑顶栏左端 ≤24px；暗栏反白（data-tone=on-dark），亮栏预设原样', () => {
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline;
    const doc = parse(
      renderToStaticMarkup(createElement(SwissScheduleDocument, { vm, palette: baseline, logo: TINY_LOGO })),
    );
    const topbarLogo = doc.querySelector('.swiss-topbar__nav img.print-logo');
    expect(topbarLogo, 'A 版 logo 应在黑顶栏左端（nav 行首）').not.toBeNull();
    expect((topbarLogo as HTMLElement).style.height).toBe('24px');
    expect(topbarLogo!.getAttribute('data-tone'), '基线黑栏 ⇒ 反白').toBe('on-dark');
    // 四页都在顶栏左端
    expect(logoHeights(doc)).toEqual([24, 24, 24, 24]);

    // 站台蓝预设：栏底（line）改亮 ⇒ logo 原样（不反白），否则白 logo 在亮栏上消失
    const preset = PRINT_TEMPLATE_PALETTES['swiss-schedule'].presets.find((p) => p.id === 'platform-blue')!;
    const doc2 = parse(
      renderToStaticMarkup(
        createElement(SwissScheduleDocument, { vm, palette: preset.palette, logo: TINY_LOGO }),
      ),
    );
    const tone = doc2.querySelector('.swiss-topbar__nav img.print-logo')!.getAttribute('data-tone');
    expect(tone, '亮栏预设 ⇒ 原样不反白').toBe('ink');
  });

  it('D 版：logo 在每页头部左上格 ≤28px（无圆角无底由 CSS 保证，此处锁位置）', () => {
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['data-editorial'].baseline;
    const doc = parse(
      renderToStaticMarkup(createElement(DataEditorialDocument, { vm, palette: baseline, logo: TINY_LOGO })),
    );
    // 左上格：在 kicker 之前（de-head__left 的第一个子元素）
    const firstInLeft = doc.querySelector('.de-head__left')!.firstElementChild;
    expect(firstInLeft!.classList.contains('de-head__logo'), 'logo 应是头部左格第一个元素').toBe(true);
    // 她 10-09 23:38 反馈修复：D 默认 = 4 原生签名页，每页头部左上格各一枚
    // （通用 M1/M2/M4 不进默认态，可手动勾选）
    expect(logoHeights(doc)).toEqual([28, 28, 28, 28]);
  });

  it('E 版：logo 在每页左上角发丝线下方 ≤22px', () => {
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['editorial-index'].baseline;
    const doc = parse(
      renderToStaticMarkup(createElement(EditorialIndexDocument, { vm, palette: baseline, logo: TINY_LOGO })),
    );
    const rows = doc.querySelectorAll('.ei-logo-row img.print-logo');
    expect(rows.length, 'E 版每物理页一枚（默认 = 3 原生签名页；通用 M2 默认不勾）').toBe(3);
    // 发丝线下方：logo 行在页头（含 .ei-head__rule）之后
    const page = doc.querySelector('.a4-page')!;
    const rule = page.querySelector('.ei-head__rule');
    const logoRow = page.querySelector('.ei-logo-row');
    expect(rule).not.toBeNull();
    expect(logoRow).not.toBeNull();
    expect(logoHeights(doc)).toEqual([22, 22, 22]);
  });

  it('H 版：P1 logo 在巨字下方左侧 ≤24px；P2/P3 左上角 ≤22px；中轴区无 logo', () => {
    const vm = buildVm();
    const baseline = PRINT_TEMPLATE_PALETTES['agent-poster'].baseline;
    const doc = parse(
      renderToStaticMarkup(createElement(AgentPosterDocument, { vm, palette: baseline, logo: TINY_LOGO })),
    );
    const p1 = doc.querySelector('[data-print-page="agent-declaration"]')!;
    const p1Logo = p1.querySelector('.ap-declare__logo img.print-logo');
    expect(p1Logo, 'P1 logo 应在巨字下方左侧').not.toBeNull();
    expect((p1Logo as HTMLElement).style.height).toBe('24px');
    // P1 没有页级 logo 行（巨字下方那枚就是全部，不重复）
    expect(p1.querySelector('.ap-logo-row')).toBeNull();

    for (const kind of ['execution-status', 'writeback-proposals']) {
      const p = doc.querySelector(`[data-print-page="${kind}"]`)!;
      const logo = p.querySelector('.ap-logo-row img.print-logo');
      expect(logo, `${kind} 左上角应有 logo`).not.toBeNull();
      expect((logo as HTMLElement).style.height).toBe('22px');
    }
    // 中轴区域严禁放 logo：双栏容器内无任何 print-logo
    const cols = doc.querySelector('.ap-status__cols')!;
    expect(cols.querySelector('.print-logo'), '中轴区域不得放 logo').toBeNull();
  });

  it('classic：logo 在页脚署名旁 ≤20px；署名字样逐字保留', () => {
    const blocks: SchedulePaperBlocks = {
      header: true,
      timeline: true,
      projectInfo: true,
      stageTable: true,
      footer: true,
    };
    const sections = [
      {
        orderIndex: 1,
        name: '现场勘查',
        startAt: '2026-01-05',
        endAt: '2026-01-20',
        status: StageStatus.InProgress,
        colorIndex: 1,
        customColor: null,
        tasks: [],
      },
    ];
    const doc = parse(
      renderToStaticMarkup(
        createElement(SchedulePaper, {
          project: PROJECT,
          pages: [sections],
          sections,
          bandGeom: () => ({ left: 0, width: 50 }),
          monthTicks: [],
          nowText: '2026-10-09 07:30',
          startAt: '2026-01-01',
          endAt: '2026-03-01',
          totalDays: 60,
          role: 'admin',
          pageRef: () => null,
          blocks,
          skin: 'default',
          logo: TINY_LOGO,
        }),
      ),
    );
    const footer = doc.querySelector('footer')!;
    const footerLogo = footer.querySelector('img.print-logo');
    expect(footerLogo, 'classic logo 应在页脚').not.toBeNull();
    expect((footerLogo as HTMLElement).style.height).toBe('20px');
    // 署名字样逐字保留（既有 spec 钉死的那串）
    expect(footer.textContent).toContain('ID Plan · 项目排期与交付管理');
    expect(footer.textContent).toContain('第 1 / 1 页');
  });

  it('空态：未上传 ⇒ 四版统一「ID Plan」文字标（不留空、不占位灰块）', () => {
    const vm = buildVm();
    const texts: string[] = [];
    const docs = [
      renderToStaticMarkup(
        createElement(SwissScheduleDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['swiss-schedule'].baseline }),
      ),
      renderToStaticMarkup(
        createElement(DataEditorialDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['data-editorial'].baseline }),
      ),
      renderToStaticMarkup(
        createElement(EditorialIndexDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['editorial-index'].baseline }),
      ),
      renderToStaticMarkup(
        createElement(AgentPosterDocument, { vm, palette: PRINT_TEMPLATE_PALETTES['agent-poster'].baseline }),
      ),
    ];
    for (const markup of docs) {
      const doc = parse(markup);
      // 没有任何 img.print-logo（不占位灰块）
      expect(doc.querySelectorAll('img.print-logo').length).toBe(0);
      // 每页都有文字标
      const pageCount = doc.querySelectorAll('.a4-page').length;
      expect(logoTexts(doc).length, '每页一枚文字标').toBe(pageCount);
      texts.push(...logoTexts(doc));
    }
    expect(new Set(texts)).toEqual(new Set(['ID Plan']));
  });
});

/* ====================================================================================
 * L4 · Chromium 集成（真上传链路：文件 → 二值化 dataURL）
 * ==================================================================================== */

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
 * L4 怎么在真 Chromium 里跑**真实源码**：print-logo-image.ts 是零依赖的
 * 浏览器模块，静态服务器喂不了 TS。故用 esbuild CLI（**子进程**执行——
 * 不用 vite 的 transform API：vitest 的模块运行器在 vm realm 里，esbuild 的
 * `TextEncoder instanceof Uint8Array` 不变量会假红，实测踩过）把源码转成
 * ESM，落临时 .mjs，经安全端口静态服务供页面 `import()`——测的是**这份
 * 源码**，不是抄录副本。
 */
async function serveTransformedModule(): Promise<{ url: string; close(): Promise<void> }> {
  const os = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const esbuildBin = resolve(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
  const outFile = join(os.tmpdir(), `print-logo-image-${process.pid}-${Date.now()}.mjs`);
  execFileSync(process.execPath, [
    esbuildBin,
    join(ROOT, 'src', 'lib', 'print-logo-image.ts'),
    '--format=esm',
    `--outfile=${outFile}`,
  ]);
  const js = readFileSync(outFile, 'utf-8');
  const server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/print-logo-image.mjs')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(js);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  return listenOnSafePort(server, '/print-logo-image.mjs');
}

describe.skipIf(!CAN_RUN)('打印 logo · L4 上传链路（真 Chromium：文件 → 二值化 dataURL）', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH! });
  });

  it('processPrintLogoFile：真 PNG ⇒ 二值化 dataURL（≤200KB；只有黑/透明两种像素）', async () => {
    const mod = await serveTransformedModule();
    const page = await browser.newPage();
    try {
      await page.goto(mod.url);
      const result = await page.evaluate(async (moduleUrl) => {
        // 页内造一枚 200×120 的「浅底深字」PNG（深色块 + 字形的简化 logo）
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 120;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#f2f2f2';
        ctx.fillRect(0, 0, 200, 120);
        ctx.fillStyle = '#101010';
        ctx.fillRect(20, 20, 60, 80);
        ctx.fillRect(100, 20, 80, 20);
        ctx.fillRect(100, 55, 80, 20);
        ctx.fillRect(100, 90, 50, 10);
        const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
        const file = new File([blob], 'logo.png', { type: 'image/png' });

        // 经 new Function 发起 import：绕开 vitest 对 spec 源码的动态 import 重写
        // （__vite_ssr_dynamic_import__ 在页面上下文不存在），import 落在页面 realm
        const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<typeof import('../src/lib/print-logo-image')>;
        const m = await dynamicImport(moduleUrl);
        const out = await m.processPrintLogoFile(file);

        // 解码产物：统计像素形态（应只有「实心黑」与「全透明」）
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = out.dataUrl!;
        });
        const c2 = document.createElement('canvas');
        c2.width = img.naturalWidth;
        c2.height = img.naturalHeight;
        const ctx2 = c2.getContext('2d')!;
        ctx2.drawImage(img, 0, 0);
        const px = ctx2.getImageData(0, 0, c2.width, c2.height).data;
        let black = 0;
        let transparent = 0;
        let other = 0;
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3]!;
          if (a === 0) transparent++;
          else if (a === 255 && px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) black++;
          else other++;
        }
        return {
          ok: out.ok,
          len: out.dataUrl?.length ?? 0,
          w: img.naturalWidth,
          h: img.naturalHeight,
          black,
          transparent,
          other,
        };
      }, mod.url);

      expect(result.ok, '上传链路应成功').toBe(true);
      expect(result.len, `dataURL ≤200KB（实测 ${result.len}）`).toBeLessThanOrEqual(200 * 1024);
      expect(result.len).toBeGreaterThan(1024);
      // 长边不超过阶梯首档 320（200×120 原样）
      expect(Math.max(result.w, result.h)).toBeLessThanOrEqual(320);
      // 二值化彻底：除「实心黑 / 全透明」外没有第三种像素
      expect(result.other, '不应存在灰阶/彩色残留像素').toBe(0);
      expect(result.black, '深色字形应成为实心黑标记').toBeGreaterThan(100);
      expect(result.transparent, '浅底应全透明').toBeGreaterThan(100);
    } finally {
      await page.close();
      await mod.close();
    }
  });

  it('processPrintLogoFile：仅 viewBox 的 SVG ⇒ Chromium 按默认尺寸栅格化后二值化（不崩、不空图）', async () => {
    const mod = await serveTransformedModule();
    const page = await browser.newPage();
    try {
      await page.goto(mod.url);
      const result = await page.evaluate(async (moduleUrl) => {
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#101010"/></svg>';
        const file = new File([svg], 'logo.svg', { type: 'image/svg+xml' });
        // 经 new Function 发起 import：绕开 vitest 对 spec 源码的动态 import 重写
        const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<typeof import('../src/lib/print-logo-image')>;
        const m = await dynamicImport(moduleUrl);
        const out = await m.processPrintLogoFile(file);
        if (!out.ok) return { ok: false as const, reason: out.reason ?? '', other: -1, len: 0 };

        // 解码产物并统计：全黑 SVG 栅格化后是「纯深色填充图」（亮像素占比 0
        // ⇒ 不反相），如实成实心黑块；这里断言二值化彻底（只有黑/透明）
        // 与体积合规。
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = out.dataUrl!;
        });
        const c2 = document.createElement('canvas');
        c2.width = img.naturalWidth;
        c2.height = img.naturalHeight;
        const ctx2 = c2.getContext('2d')!;
        ctx2.drawImage(img, 0, 0);
        const px = ctx2.getImageData(0, 0, c2.width, c2.height).data;
        let other = 0;
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3]!;
          if (a !== 0 && !(a === 255 && px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0)) other++;
        }
        return { ok: true as const, reason: '', other, len: out.dataUrl!.length };
      }, mod.url);

      // Chromium 对仅 viewBox 的 SVG 给默认替换元素尺寸（非 0）⇒ 走栅格化 +
      // 二值化正路；0 尺寸守护分支（naturalWidth=0 的拒绝提示）在本引擎不可达，
      // 保留代码只为其它引擎的防御——这里锁实测口径：不崩、不空图、无灰阶残留。
      expect(result.ok, 'SVG 应处理成功').toBe(true);
      expect(result.other, '二值化彻底：只有黑/透明两种像素').toBe(0);
      expect(result.len).toBeLessThanOrEqual(200 * 1024);
    } finally {
      await page.close();
      await mod.close();
    }
  });
});
