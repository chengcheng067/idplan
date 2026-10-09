// @vitest-environment jsdom
/**
 * 打印选择器模块化（v1.5-a 期二 + v1.5-b 期三第一批 · 产品决策文档 §3.2/§3.3/§3.5）验收。
 *
 * 他的原话：「关于日程表选择模板，我今天给到你的 4 个模板，需要这 4 个模板
 * 都能选择输出页面下面的这几个模块。并不是说比如 H 版就只能是 Agent 的专属，
 * 不是这个意思……我们现在给的这 4 个新模板只是一个外表，里面的内容还是由
 * 我们 ID plan 和用户来共同决定。」
 *
 * 产品形态：**4 套模板 = 外表，11 个内容模块跨模板可选**。期二立形态
 * （原生可勾 + 非原生禁用）；期三第一批落地通用渲染（M1/M2/M4 在全部
 * 4 套外表可输出）。本 spec 锁：
 *   L1-a 模块能力表：原生集 A/D 各 4、E 3、H 2（M10 = 1 模块 2 页）；
 *        期三通用集 M1/M2/M4 于 D/E/H；可用集 = 原生 + 通用（按 M1→M11 序）；
 *        classic 不走模块表（五块 blocks 另一套粒度）；
 *   L1-b 打印零变化红线：默认（缺键）= 全选可用模块 ⇒ 原生页序与旧「页勾选」
 *        默认态**逐页等价**（四版模板原生输出零变化，编译期锚点）；通用模块
 *        另落通用页（enabledSheetsOf）；
 *   L1-c 选择器中截：11 模块逐行三态（原生 = 原生页名 / 通用 = 「通用渲染」/
 *        暂不可用 = 禁用 + 原因）；原生与通用默认全选，勾选联动纸面与
 *        「预计 N 页」；按模板各存一套，换外表不丢失；
 *   L1-d 旧 pages 数据迁移：旧页 key → 模块 key（merge 兜底手法照旧）；有一条
 *        映射不了 ⇒ 该模板回落默认全选；反选意图保留；classic 键不收；
 *        期三：映射成功的模块若在该外表可用（含通用）不再被滤掉。
 *
 * 挂载形态同 print-options.spec.tsx：先 open=false 再翻 true，纸面走真实
 * 组件（SchedulePaper + 四版 Document），stores 用 replaceAll/setAll 直接 seed。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/** ResizeObserver：jsdom 无原生实现（Modal 与面板定位 effect 都要，打桩保底） */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

import { PrintPreviewDialog } from '../src/components/print/PrintPreviewDialog';
import {
  PRINT_MODULES,
  PRINT_MODULE_IDS,
  PRINT_TEMPLATES,
  PRINT_TEMPLATE_IDS,
  enabledPagesOf,
  enabledSheetsOf,
  isPrintModuleId,
  moduleAvailability,
  nativePagesOf,
  pageKindToModule,
  printTemplateGenericModuleIds,
  printTemplateModuleIds,
  printTemplateModules,
  printTemplateNativeModuleIds,
} from '../src/components/print/print-skins';
import type { PrintModuleId, PrintTemplateId } from '../src/components/print/print-skins';
import { AGENT_POSTER_PAGES } from '../src/print/documents/AgentPosterDocument';
import { DATA_EDITORIAL_PAGES } from '../src/print/documents/DataEditorialDocument';
import { EDITORIAL_INDEX_PAGES } from '../src/print/documents/EditorialIndexDocument';
import { SWISS_SCHEDULE_PAGES } from '../src/print/documents/SwissScheduleDocument';
import type { PrintPageKind } from '../src/print/model/print-view-model';
import { PRINT_PREFS_STORAGE_KEY, usePrintPrefsStore } from '../src/store/usePrintPrefsStore';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage, Task } from '../src/core/types/entities';

/* ====================================================================================
 * 夹具（最小可用：1 项目 + 2 阶段 + 2 任务 + 1 管理员；四版纸面都打得出来）
 * ==================================================================================== */

const PROJECT_ID = 'proj_print_modules';
const ADMIN_ID = 'm-admin-print-modules';

const PROJECT: Project = {
  id: PROJECT_ID,
  name: '云栖·湖畔茶室',
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

const ADMIN: Member = {
  id: ADMIN_ID,
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

function makeStages(): Stage[] {
  return [1, 2].map((i) => ({
    id: `stg_pm_${i}`,
    projectId: PROJECT_ID,
    orderIndex: i,
    templateKey: null,
    colorIndex: i,
    customColor: null,
    name: `阶段${i}`,
    ratioPercent: 50,
    startAt: '2026-01-05T00:00:00Z',
    endAt: '2026-01-20T23:59:59Z',
    status: i === 1 ? StageStatus.InProgress : StageStatus.Completed,
    ownerId: ADMIN_ID,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  }));
}

function makeTasks(stages: Stage[]): Task[] {
  return stages.map((s, i) => ({
    id: `tsk_pm_${i + 1}`,
    taskNo: null,
    projectId: PROJECT_ID,
    stageId: s.id,
    title: `任务${i + 1}`,
    done: false,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'human',
    externalId: null,
    agentId: null,
    status: TaskStatus.Draft,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    runId: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  }));
}

/** 装数据 + 定身份（管理员 ⇒ memberView=false ⇒ 阶段全量可见）。store 写入包 act（setup.ts 要求） */
function seedStores(): void {
  const stages = makeStages();
  act(() => {
    useProjectsStore.getState().replaceAll({
      projects: [PROJECT],
      stages,
      tasks: makeTasks(stages),
    });
    useMembersStore.getState().setAll([ADMIN]);
    useSettingsStore.setState({ currentMemberId: ADMIN_ID, hydrated: true });
  });
}

/* ====================================================================================
 * 渲染 / 操作助手（生产形态：先挂关闭态再打开；真实纸面，不 stub）
 * ==================================================================================== */

let container: HTMLDivElement;
let root: Root;

function renderDialog(open: boolean): void {
  act(() => {
    root.render(<PrintPreviewDialog projectId={PROJECT_ID} open={open} onClose={() => {}} />);
  });
}

/** flush microtask：zustand persist 的 setItem 是 thenable 链（异步一拍），读 localStorage 前先排空 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** persist.rehydrate()（模拟「刷新后重新 hydrate」的读路径） */
async function rehydratePrefs(): Promise<void> {
  const persistApi = (usePrintPrefsStore as unknown as {
    persist: { rehydrate: () => Promise<void> };
  }).persist;
  await act(async () => {
    await persistApi.rehydrate();
  });
}

/** 每例从「默认全开 / classic 模板 / 无模块勾选」起手（含把 persist 的异步写排空） */
async function resetPrefs(): Promise<void> {
  await act(async () => {
    usePrintPrefsStore.setState({
      blocks: {
        header: true,
        timeline: true,
        projectInfo: true,
        stageTable: true,
        footer: true,
      },
      template: 'classic',
      pages: {},
      palette: {},
    });
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 打开三截下拉（幂等） */
function openSelector(): void {
  if (document.querySelector('[data-print-selector-panel]')) return;
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === '模板与模块',
  );
  if (!btn) throw new Error('找不到「模板与模块」按钮');
  act(() => {
    btn.click();
  });
  expect(document.querySelector('[data-print-selector-panel]'), '点后下拉面板应出现').not.toBeNull();
}

/** 点模板卡（选择器上截）并等中截按新外表重建 */
function pickTemplate(id: PrintTemplateId): void {
  const btn = document.querySelector<HTMLButtonElement>(`[data-print-template-option="${id}"]`);
  if (!btn) throw new Error(`找不到模板卡：${id}`);
  act(() => {
    btn.click();
  });
}

function moduleCheckbox(module: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[data-print-module="${module}"]`);
  if (!el) throw new Error(`找不到模块勾选框：${module}`);
  return el;
}

/** 勾 / 消一个模块（幂等；校验点击后 checked 确实到位） */
function setModuleChecked(module: string, on: boolean): void {
  const el = moduleCheckbox(module);
  if (el.checked !== on) {
    act(() => {
      el.click();
    });
  }
  expect(moduleCheckbox(module).checked, `勾选模块 ${module} 后期望 ${on}`).toBe(on);
}

/** 模块行（中截） */
function moduleRow(module: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-print-module-row="${module}"]`);
  if (!el) throw new Error(`找不到模块行：${module}`);
  return el;
}

const paperPages = (): number => document.querySelectorAll('.a4-page').length;
const bodyContains = (t: string): boolean => (document.body.textContent ?? '').includes(t);

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
  await resetPrefs();
  seedStores();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
});

/* ====================================================================================
 * L1-a · 模块能力表（纯函数；外表 × 模块的核心判断题，决策文档 §3.2）
 * ==================================================================================== */

describe('期二+期三 · L1-a 模块能力表', () => {
  it('11 个内容模块：id 集合与 §3.1 清单一字不差，行文元数据齐全', () => {
    expect(PRINT_MODULE_IDS).toEqual([
      'stage-list',
      'task-list',
      'delay-ledger',
      'member-roster',
      'progress-matrix',
      'dependency-network',
      'workload-composition',
      'milestone-acceptance',
      'artifact-list',
      'agent-execution',
      'writeback-proposals',
    ]);
    expect(PRINT_MODULES).toHaveLength(11);
    for (const m of PRINT_MODULES) {
      expect(m.label.length, `${m.id} 模块名非空`).toBeGreaterThan(0);
      expect(m.hint.length, `${m.id} 一句话内容说明非空`).toBeGreaterThan(0);
    }
    // 类型守卫：页 kind 不是模块 id（两层类型不许串）
    expect(isPrintModuleId('stage-list')).toBe(true);
    expect(isPrintModuleId('stage-overview'), '页 kind 不得混进模块勾选').toBe(false);
    expect(isPrintModuleId('bogus')).toBe(false);
  });

  it('四套外表的原生模块集：A/D 各 4、E 3、H 2；classic 不走模块表', () => {
    expect(printTemplateNativeModuleIds('classic'), '经典走五块 blocks，另一套粒度（§2.2）').toEqual([]);
    expect(printTemplateNativeModuleIds('swiss-schedule')).toEqual([
      'stage-list',
      'task-list',
      'delay-ledger',
      'member-roster',
    ]);
    expect(printTemplateNativeModuleIds('data-editorial')).toEqual([
      'progress-matrix',
      'dependency-network',
      'workload-composition',
      'milestone-acceptance',
    ]);
    expect(printTemplateNativeModuleIds('editorial-index')).toEqual([
      'stage-list',
      'member-roster',
      'artifact-list',
    ]);
    expect(printTemplateNativeModuleIds('agent-poster')).toEqual([
      'agent-execution',
      'writeback-proposals',
    ]);
  });

  it('期三第一批通用渲染：M1/M2/M4 于 D/E/H 进通用集；可用集 = 原生 + 通用（M1→M11 序）', () => {
    // A 的 M1/M2/M4 已有原生页 ⇒ 无通用条目（原生优先，通用标记不参与分发）
    expect(printTemplateGenericModuleIds('swiss-schedule')).toEqual([]);
    // D：M1/M2/M4 无原生页 ⇒ 通用渲染（产品决策 ⑭ 的第一批）
    expect(printTemplateGenericModuleIds('data-editorial')).toEqual([
      'stage-list',
      'task-list',
      'member-roster',
    ]);
    // E：M1/M4 已有原生目录页，只补 M2
    expect(printTemplateGenericModuleIds('editorial-index')).toEqual(['task-list']);
    // H：去专属化——M1/M2/M4 进通用集（M10/M11 仍是原生）
    expect(printTemplateGenericModuleIds('agent-poster')).toEqual([
      'stage-list',
      'task-list',
      'member-roster',
    ]);
    expect(printTemplateGenericModuleIds('classic')).toEqual([]);
    // 可用集 = 原生 + 通用，且按 PRINT_MODULES 序（页序派生依赖此不变量）
    expect(printTemplateModuleIds('swiss-schedule')).toEqual([
      'stage-list',
      'task-list',
      'delay-ledger',
      'member-roster',
    ]);
    expect(printTemplateModuleIds('data-editorial')).toEqual([
      'stage-list',
      'task-list',
      'member-roster',
      'progress-matrix',
      'dependency-network',
      'workload-composition',
      'milestone-acceptance',
    ]);
    expect(printTemplateModuleIds('editorial-index')).toEqual([
      'stage-list',
      'task-list',
      'member-roster',
      'artifact-list',
    ]);
    expect(printTemplateModuleIds('agent-poster')).toEqual([
      'stage-list',
      'task-list',
      'member-roster',
      'agent-execution',
      'writeback-proposals',
    ]);
    // 每条能力表条目至少一态（原生页 or 通用标记），不允许空跑
    for (const t of PRINT_TEMPLATE_IDS) {
      for (const cap of printTemplateModules(t)) {
        expect(
          cap.pages.length > 0 || cap.generic,
          `${t} 的 ${cap.module} 应有原生页或通用标记`,
        ).toBe(true);
        for (const p of cap.pages) expect(p.label.length, '原生页名非空').toBeGreaterThan(0);
      }
      // 能力表序 = PRINT_MODULES 序（enabledSheetsOf 的页序不变量）
      const order = printTemplateModuleIds(t).map((m) => PRINT_MODULE_IDS.indexOf(m));
      expect([...order].sort((a, b) => a - b), `${t} 能力表按 M1→M11 序`).toEqual(order);
    }
  });

  it('M10 = 1 模块 2 页（H：执行宣告 + 状态全览）；三态可用性（原生/通用/暂不可用）', () => {
    expect(nativePagesOf('agent-poster', 'agent-execution')).toEqual([
      'agent-declaration',
      'execution-status',
    ]);
    expect(nativePagesOf('agent-poster', 'writeback-proposals')).toEqual(['writeback-proposals']);
    // 无原生页的模块：nativePagesOf = null，但期三起不一定「暂不可用」
    expect(nativePagesOf('agent-poster', 'stage-list'), 'H 的 stage-list 无原生页').toBeNull();
    expect(moduleAvailability('agent-poster', 'stage-list'), '期三：走通用渲染').toBe('generic');
    expect(moduleAvailability('data-editorial', 'task-list')).toBe('generic');
    expect(moduleAvailability('editorial-index', 'task-list')).toBe('generic');
    expect(moduleAvailability('agent-poster', 'delay-ledger'), 'M3 在 H 暂不可用（后续批次）').toBe('off');
    expect(moduleAvailability('swiss-schedule', 'agent-execution'), 'M10 在 A 暂不可用').toBe('off');
    expect(moduleAvailability('swiss-schedule', 'stage-list'), 'A 的 M1 是原生').toBe('native');
    expect(moduleAvailability('classic', 'stage-list'), 'classic 不走模块表').toBe('off');
  });

  it('旧页 key → 模块 key：14 → 11 静态映射全覆盖（store 迁移的地基）', () => {
    const expected: Record<PrintPageKind, PrintModuleId> = {
      'stage-overview': 'stage-list',
      'task-register': 'task-list',
      'delay-ledger': 'delay-ledger',
      'member-roster': 'member-roster',
      'progress-matrix': 'progress-matrix',
      'dependency-network': 'dependency-network',
      'workload-composition': 'workload-composition',
      'milestone-acceptance': 'milestone-acceptance',
      'stage-index': 'stage-list',
      'member-index': 'member-roster',
      'artifact-index': 'artifact-list',
      'agent-declaration': 'agent-execution',
      'execution-status': 'agent-execution',
      'writeback-proposals': 'writeback-proposals',
    };
    for (const [page, module] of Object.entries(expected)) {
      expect(pageKindToModule(page), `旧页 ${page} 应映射 ${module}`).toBe(module);
    }
    // 14 个页 kind 全部有主（一个不漏 = 迁移无静默丢失）
    expect(Object.keys(expected)).toHaveLength(14);
    expect(new Set(Object.values(expected)).size, '映射落到 11 个模块上').toBe(11);
    // 映射不了的（脏值 / 非页 kind）⇒ null（调用方回落默认全选）
    expect(pageKindToModule('bogus')).toBeNull();
    expect(pageKindToModule(null)).toBeNull();
    expect(pageKindToModule(42)).toBeNull();
  });
});

/* ====================================================================================
 * L1-b · 打印零变化红线（默认模块勾选 ≡ 旧页勾选）
 * ==================================================================================== */

describe('期二+期三 · L1-b 打印零变化红线（缺键 = 全选可用 = 旧页勾选默认态）', () => {
  it('enabledPagesOf 默认态与四个 Document 的原生页常量逐一相等', () => {
    expect(enabledPagesOf('swiss-schedule', undefined)).toEqual([...SWISS_SCHEDULE_PAGES]);
    expect(enabledPagesOf('data-editorial', undefined)).toEqual([...DATA_EDITORIAL_PAGES]);
    expect(enabledPagesOf('editorial-index', undefined)).toEqual([...EDITORIAL_INDEX_PAGES]);
    expect(enabledPagesOf('agent-poster', undefined)).toEqual([...AGENT_POSTER_PAGES]);
    expect(enabledPagesOf('classic', undefined), 'classic 无模块页').toEqual([]);
  });

  it('显式全选可用模块 = 缺键默认态（store 落库形状不改变纸面）', () => {
    for (const t of PRINT_TEMPLATE_IDS) {
      expect(enabledSheetsOf(t, printTemplateModuleIds(t)), `${t} 全选`).toEqual(
        enabledSheetsOf(t, undefined),
      );
      expect(enabledPagesOf(t, printTemplateModuleIds(t)), `${t} 全选（原生页）`).toEqual(
        enabledPagesOf(t, undefined),
      );
    }
  });

  it('勾选态只做筛选不改序；暂不可用 id 混入不进纸面、不计页数', () => {
    // 顺序无关：按注册表 M1→M11 序出（A：先 stage-overview 后 member-roster）
    expect(enabledSheetsOf('swiss-schedule', ['member-roster', 'stage-list'])).toEqual([
      { type: 'native', page: 'stage-overview' },
      { type: 'native', page: 'member-roster' },
    ]);
    // 脏 / 暂不可用 id 混入 ⇒ 静默滤掉（纸面不因此多页）
    expect(
      enabledSheetsOf('agent-poster', ['agent-execution', 'stage-list', 'bogus' as PrintModuleId]),
    ).toEqual([
      { type: 'generic', module: 'stage-list' },
      { type: 'native', page: 'agent-declaration' },
      { type: 'native', page: 'execution-status' },
    ]);
    // 反选 ⇒ 空
    expect(enabledSheetsOf('swiss-schedule', [])).toEqual([]);
    // 期三：D 默认 sheets = 三通用页 + 四原生页（按 M1→M11 序）
    expect(enabledSheetsOf('data-editorial', undefined)).toEqual([
      { type: 'generic', module: 'stage-list' },
      { type: 'generic', module: 'task-list' },
      { type: 'generic', module: 'member-roster' },
      { type: 'native', page: 'progress-matrix' },
      { type: 'native', page: 'dependency-network' },
      { type: 'native', page: 'workload-composition' },
      { type: 'native', page: 'milestone-acceptance' },
    ]);
    // 原生页派生（enabledPagesOf）不受通用模块影响——原生输出零变化红线
    expect(enabledPagesOf('data-editorial', undefined)).toEqual([...DATA_EDITORIAL_PAGES]);
  });
});

/* ====================================================================================
 * L1-c · 选择器中截：11 模块勾选三态（原生可选 / 通用可选 / 暂不可用禁用带原因）
 * ==================================================================================== */

describe('期二+期三 · L1-c 选择器中截（真实对话框）', () => {
  it('A 外表：4 原生默认全选 + 7 暂不可用禁用（禁用态带原因）', () => {
    renderDialog(true);
    openSelector();
    pickTemplate('swiss-schedule');

    // 11 行齐全（4 套模板都是同一个 11 模块表单，三态随外表变）
    expect(document.querySelectorAll('[data-print-module-row]')).toHaveLength(11);
    // 原生：可勾选且默认全选（01 §8），行带归属页名
    for (const m of ['stage-list', 'task-list', 'delay-ledger', 'member-roster']) {
      const input = moduleCheckbox(m);
      expect(input.disabled, `${m} 原生应可勾`).toBe(false);
      expect(input.checked, `${m} 默认应勾选`).toBe(true);
      expect(moduleRow(m).getAttribute('data-avail')).toBe('native');
    }
    expect(moduleRow('stage-list').textContent, '原生行标注归属页名').toContain('阶段总览');
    expect(moduleRow('member-roster').textContent).toContain('成员责任表');
    // 暂不可用：禁用 + 不勾 + 原因文案（M3/M5-M11 等后续批次，不装能打）
    for (const m of [
      'progress-matrix',
      'dependency-network',
      'workload-composition',
      'milestone-acceptance',
      'artifact-list',
      'agent-execution',
      'writeback-proposals',
    ]) {
      const input = moduleCheckbox(m);
      expect(input.disabled, `${m} 在 A 外表下应禁用`).toBe(true);
      expect(input.checked, `${m} 禁用态不勾选`).toBe(false);
      expect(moduleRow(m).getAttribute('data-avail')).toBe('off');
      expect(moduleRow(m).textContent, '禁用行带原因').toContain('该外表下暂不可用');
    }
    // 禁用行点不动：store 不收暂不可用模块的勾选
    expect(usePrintPrefsStore.getState().pages['swiss-schedule']).toBeUndefined();
  });

  it('期三 H 外表：2 原生 + 3 通用（M1/M2/M4 默认全选）+ 6 暂不可用', () => {
    renderDialog(true);
    openSelector();
    pickTemplate('agent-poster');

    expect(document.querySelectorAll('[data-print-module-row]')).toHaveLength(11);
    // 原生 2 个（默认全选）；M10 一行标两页
    expect(moduleCheckbox('agent-execution').checked).toBe(true);
    expect(moduleCheckbox('writeback-proposals').checked).toBe(true);
    expect(moduleRow('agent-execution').textContent, 'M10 = 两页，归属页提示两枚').toContain(
      'Agent 执行宣告 + 执行状态全览',
    );
    // 期三通用 3 个：M1/M2/M4 可勾选、默认全选、行标「通用渲染」
    for (const m of ['stage-list', 'task-list', 'member-roster']) {
      expect(moduleCheckbox(m).disabled, `${m} 在 H 下应可勾（通用渲染）`).toBe(false);
      expect(moduleCheckbox(m).checked, `${m} 默认应勾选`).toBe(true);
      expect(moduleRow(m).getAttribute('data-avail')).toBe('generic');
      expect(moduleRow(m).textContent, '通用行标注渲染方式').toContain('通用渲染');
    }
    // 其余 6 个暂不可用禁用带原因
    const off = Array.from(document.querySelectorAll('[data-print-module-row]')).filter(
      (el) => el.getAttribute('data-avail') === 'off',
    );
    expect(off.map((el) => el.getAttribute('data-print-module-row'))).toEqual([
      'delay-ledger',
      'progress-matrix',
      'dependency-network',
      'workload-composition',
      'milestone-acceptance',
      'artifact-list',
    ]);
    for (const el of off) {
      expect(el.textContent, '禁用行带原因').toContain('该外表下暂不可用');
    }
    // 表单脚注：通用渲染已支持口径 + 暂不可用的后续支持口径（如实告知）
    const section = document.querySelector('[data-print-module-section]');
    expect(section!.textContent).toContain('已支持通用渲染');
    expect(section!.textContent).toContain('将随通用渲染陆续支持');
  });

  it('模块勾选联动：摘模块 ⇒ 纸面少页 + 预计 N 页重算（M10 两页同进同出）', () => {
    renderDialog(true);
    openSelector();
    pickTemplate('agent-poster');
    // 默认全选可用 ⇒ H 六页（通用 M1/M2/M4 各一页 + agent-execution 两页 + 写回一页）
    expect(paperPages()).toBe(6);
    expect(bodyContains('预计 6 页')).toBe(true);

    // 摘写回提案 ⇒ 5 页（M10 的两页不受影响）
    setModuleChecked('writeback-proposals', false);
    expect(paperPages()).toBe(5);
    expect(bodyContains('预计 5 页')).toBe(true);
    expect(
      Array.from(document.querySelectorAll('.a4-page')).map((el) =>
        el.getAttribute('data-print-page'),
      ),
    ).toEqual([
      'generic-stage-list',
      'generic-task-list',
      'generic-member-roster',
      'agent-declaration',
      'execution-status',
    ]);

    // 摘 Agent 执行 ⇒ 两页同出（1 模块 2 页，勾选粒度是模块）
    setModuleChecked('agent-execution', false);
    expect(paperPages()).toBe(3);
    expect(bodyContains('预计 3 页')).toBe(true);

    // 勾回 Agent 执行 ⇒ 两页同回
    setModuleChecked('agent-execution', true);
    expect(paperPages()).toBe(5);

    // 反选 / 全选（按模块）
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-print-modules-none]')!.click();
    });
    expect(paperPages()).toBe(0);
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-print-modules-all]')!.click();
    });
    expect(paperPages()).toBe(6);
  });

  it('勾选态按外表各存一套：A 摘任务清单 → 切 D → 回 A 仍摘着', async () => {
    renderDialog(true);
    openSelector();
    pickTemplate('swiss-schedule');
    setModuleChecked('task-list', false);
    expect(paperPages()).toBe(3);

    // 切 D：中截按 D 重建（4 原生 + 3 通用默认全选 ⇒ 7 页），A 的勾选不动
    pickTemplate('data-editorial');
    expect(paperPages()).toBe(7);
    expect(bodyContains('预计 7 页')).toBe(true);
    expect(moduleCheckbox('task-list').disabled, 'task-list 在 D 下可勾（通用渲染）').toBe(false);
    expect(moduleCheckbox('task-list').checked, 'D 的 task-list 默认全选').toBe(true);
    for (const m of ['progress-matrix', 'dependency-network', 'workload-composition', 'milestone-acceptance']) {
      expect(moduleCheckbox(m).checked, `D 的 ${m} 默认全选`).toBe(true);
    }
    // 期三：D 纸面 = 三通用页 + 四原生页（按 M1→M11 序）
    expect(
      Array.from(document.querySelectorAll('.a4-page')).map((el) =>
        el.getAttribute('data-print-page'),
      ),
    ).toEqual([
      'generic-stage-list',
      'generic-task-list',
      'generic-member-roster',
      'progress-matrix',
      'dependency-network',
      'workload-composition',
      'milestone-acceptance',
    ]);

    // 回 A：task-list 仍被摘着（按模板分键，换模板不丢）
    pickTemplate('swiss-schedule');
    expect(moduleCheckbox('task-list').checked, '回 A 后 task-list 仍摘着').toBe(false);
    expect(moduleCheckbox('stage-list').checked, '没动的模块仍勾着').toBe(true);
    expect(paperPages()).toBe(3);

    // 落库形状：模块 id（不是旧页 id）
    await flush();
    const raw = localStorage.getItem(PRINT_PREFS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { state: { pages: Record<string, string[]> } };
    expect(parsed.state.pages['swiss-schedule']).toEqual(['stage-list', 'delay-ledger', 'member-roster']);
  });
});

/* ====================================================================================
 * L1-d · 旧 pages 数据迁移（merge：旧页 key → 模块 key）
 * ==================================================================================== */

describe('期二 · L1-d 旧 pages 数据迁移（hydrate 时页粒度 → 模块粒度）', () => {
  /** 以旧持久形状（pages = PrintPageKind[]）写库并 rehydrate */
  async function rehydrateLegacy(state: Record<string, unknown>): Promise<void> {
    localStorage.setItem(PRINT_PREFS_STORAGE_KEY, JSON.stringify({ state, version: 0 }));
    await rehydratePrefs();
  }

  it('旧页 key 逐条映射模块 key（A：两页 → 两模块，顺序按注册表）', async () => {
    await rehydrateLegacy({
      template: 'swiss-schedule',
      pages: { 'swiss-schedule': ['task-register', 'stage-overview'] },
    });
    expect(usePrintPrefsStore.getState().pages['swiss-schedule']).toEqual(['stage-list', 'task-list']);
  });

  it('H 旧两页独立勾选 ⇒ 合并为一个 agent-execution 模块（1 模块 2 页）', async () => {
    await rehydrateLegacy({
      template: 'agent-poster',
      // 旧形状：只勾了执行宣告一页（状态全览被摘）
      pages: { 'agent-poster': ['agent-declaration'] },
    });
    expect(usePrintPrefsStore.getState().pages['agent-poster']).toEqual(['agent-execution']);
    // 迁移后纸面 = M10 两页（页粒度升级模块粒度的既定语义）
    expect(enabledPagesOf('agent-poster', usePrintPrefsStore.getState().pages['agent-poster'])).toEqual([
      'agent-declaration',
      'execution-status',
    ]);
  });

  it('有一条映射不了 ⇒ 该模板整组回落默认全选（照现有 merge 兜底手法）', async () => {
    await rehydrateLegacy({
      template: 'swiss-schedule',
      pages: { 'swiss-schedule': ['stage-overview', 'bogus-page'] },
    });
    expect(
      usePrintPrefsStore.getState().pages['swiss-schedule'],
      '脏页名不赌：缺键 = 默认全选',
    ).toBeUndefined();
    // 另一套模板的干净数据不受牵连（逐模板独立兜底）
    await rehydrateLegacy({
      template: 'swiss-schedule',
      pages: { 'data-editorial': ['progress-matrix'], 'swiss-schedule': ['bogus'] },
    });
    expect(usePrintPrefsStore.getState().pages['data-editorial']).toEqual(['progress-matrix']);
    expect(usePrintPrefsStore.getState().pages['swiss-schedule']).toBeUndefined();
  });

  it('跨模板脏页名按可用性收编（期三：D 可用含通用 ⇒ stage-list 不再被滤掉）', async () => {
    await rehydrateLegacy({
      template: 'data-editorial',
      // stage-overview 是 A 的页，映射出的 stage-list 期三起在 D 可用（通用渲染）
      pages: { 'data-editorial': ['stage-overview', 'progress-matrix'] },
    });
    expect(usePrintPrefsStore.getState().pages['data-editorial']).toEqual([
      'stage-list',
      'progress-matrix',
    ]);
  });

  it('反选意图保留（旧「一页都不打」⇒ 空模块集，不回落全选）', async () => {
    await rehydrateLegacy({
      template: 'swiss-schedule',
      pages: { 'swiss-schedule': [] },
    });
    expect(usePrintPrefsStore.getState().pages['swiss-schedule']).toEqual([]);
    expect(enabledPagesOf('swiss-schedule', usePrintPrefsStore.getState().pages['swiss-schedule'])).toEqual([]);
  });

  it('classic 键不收（不走模块表）；未知模板 id 剔除', async () => {
    await rehydrateLegacy({
      template: 'classic',
      pages: { classic: ['stage-overview'], 'compact-x': ['stage-overview'] },
    });
    expect(usePrintPrefsStore.getState().pages['classic']).toBeUndefined();
    expect(usePrintPrefsStore.getState().pages['compact-x' as PrintTemplateId]).toBeUndefined();
  });

  it('实时设置路径：暂不可用模块不接受勾选 / 不进整组设置；通用模块放行', () => {
    // 暂不可用（M3 在 H）：拒
    act(() => {
      usePrintPrefsStore.getState().setModuleEnabled('agent-poster', 'delay-ledger', true);
    });
    expect(usePrintPrefsStore.getState().pages['agent-poster'], '暂不可用勾选被拒').toBeUndefined();
    // 期三通用（M1 在 H）：收（缺键时从「默认全选可用」起手 ⇒ 五个可用模块）
    act(() => {
      usePrintPrefsStore.getState().setModuleEnabled('agent-poster', 'stage-list', true);
    });
    expect(usePrintPrefsStore.getState().pages['agent-poster']).toEqual([
      'stage-list',
      'task-list',
      'member-roster',
      'agent-execution',
      'writeback-proposals',
    ]);
    // 整组设置：暂不可用 id 忽略，通用 + 原生全收（按 M1→M11 序）
    act(() => {
      usePrintPrefsStore.getState().setTemplateModules('agent-poster', [
        'agent-execution',
        'stage-list',
        'delay-ledger',
        'writeback-proposals',
      ]);
    });
    expect(usePrintPrefsStore.getState().pages['agent-poster']).toEqual([
      'stage-list',
      'agent-execution',
      'writeback-proposals',
    ]);
    // 经典不接模块（usesBlocks）
    act(() => {
      usePrintPrefsStore.getState().setModuleEnabled('classic', 'stage-list', true);
    });
    expect(usePrintPrefsStore.getState().pages['classic']).toBeUndefined();
  });
});

/* ====================================================================================
 * L2 · 静态源码锁（注册表纪律 + 渲染侧零改动）
 * ==================================================================================== */

describe('期二+期三 · L2 静态锁', () => {
  const ROOT = resolve(__dirname, '..');
  const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

  it('print-skins.ts：模块能力表在位 + 原生/通用两类 + 静态类映射纪律保留（零模板串）', () => {
    const src = read('src/components/print/print-skins.ts');
    expect(src).toContain('export type PrintModuleId');
    expect(src).toContain('export const PRINT_MODULES');
    expect(src).toContain('export interface PrintModuleCapability');
    expect(src).toContain('export function enabledPagesOf');
    expect(src).toContain('export function nativePagesOf');
    // 期三增量：通用标记 + PrintSheet + enabledSheetsOf + 三态可用性
    expect(src).toContain('export type PrintSheet');
    expect(src).toContain('export function enabledSheetsOf');
    expect(src).toContain('export function moduleAvailability');
    expect(src).toContain('export function printTemplateNativeModuleIds');
    expect(src).toContain('export function printTemplateGenericModuleIds');
    // 旧「页勾选」导出已退役（语义真变，不允许留第二入口）
    expect(src, 'printTemplatePages 应随页勾选一起退役').not.toContain('printTemplatePages');
    // 静态映射纪律：整个文件不允许出现模板字符串（JIT 类名 blanket 守卫）
    expect(src).not.toContain('${');
    // id → 类名静态映射对象仍在
    expect(src).toContain('PRINT_TEMPLATE_CLASS');
  });

  it('渲染侧：四个 Document 消费 sheets 勾选（纸面页属性不动）', () => {
    for (const f of [
      'src/print/documents/SwissScheduleDocument.tsx',
      'src/print/documents/DataEditorialDocument.tsx',
      'src/print/documents/EditorialIndexDocument.tsx',
      'src/print/documents/AgentPosterDocument.tsx',
    ]) {
      const src = read(f);
      expect(src, `${f} 的 sheets prop 口径（期三：原生 + 通用混合序列）`).toContain(
        'sheets?: readonly PrintSheet[]',
      );
      expect(src, `${f} 的纸面页属性不动`).toContain('data-print-page={pageAttr}');
    }
    // 经典五块开关契约不动（SchedulePaper 主体不碰）
    const paper = read('src/components/print/SchedulePaper.tsx');
    for (const key of ['header', 'timeline', 'projectInfo', 'stageTable', 'footer']) {
      expect(paper, `SchedulePaper 的 blocks.${key} 条件渲染不动`).toContain(`blocks.${key}`);
    }
  });
});
