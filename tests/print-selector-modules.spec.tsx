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
 *   L1-b 打印零变化红线：默认（缺键）= **原生签名页**
 *        （printTemplateDefaultModuleIds；她 10-09 23:38 反馈「做出来的
 *        东西完全不是参考稿那个味道」的修复——旧兜底是全选可用，D/E/H 的
 *        通用模块按 M1→M11 序排最前，打开第一页是通用表格而不是签名页）
 *        ⇒ 原生页序与旧「页勾选」默认态**逐页等价**（四版模板原生输出
 *        零变化，编译期锚点）；通用模块另落通用页（显式勾选时，
 *        enabledSheetsOf）；
 *   L1-c 选择器中截：11 模块逐行三态（原生 = 原生页名 / 通用 = 「通用渲染」/
 *        暂不可用 = 禁用 + 原因）；**原生默认勾选、通用默认不勾**（可手动
 *        勾选 / 全选），勾选联动纸面与「预计 N 页」；按模板各存一套，
 *        换外表不丢失；
 *   L1-d 旧 pages 数据迁移：旧页 key → 模块 key（merge 兜底手法照旧）；有一条
 *        映射不了 ⇒ 该模板回落默认；反选意图保留；classic 键不收；
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

import { PrintModuleSection, PrintPreviewDialog } from '../src/components/print/PrintPreviewDialog';
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
  printTemplateDefaultModuleIds,
  printTemplateGenericModuleIds,
  printTemplateModuleIds,
  printTemplateModules,
  printTemplateNativeModuleIds,
} from '../src/components/print/print-templates';
import type { PrintModuleId, PrintTemplateId } from '../src/components/print/print-templates';
import { AGENT_POSTER_PAGES, agentPosterPhysical } from '../src/print/documents/AgentPosterDocument';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import { DATA_EDITORIAL_PAGES } from '../src/print/documents/DataEditorialDocument';
import { EDITORIAL_INDEX_PAGES } from '../src/print/documents/EditorialIndexDocument';
import { SWISS_SCHEDULE_PAGES } from '../src/print/documents/SwissScheduleDocument';
import type { PrintPageKind } from '../src/print/model/print-view-model';
import { PRINT_PREFS_STORAGE_KEY, usePrintPrefsStore } from '../src/store/usePrintPrefsStore';
import { useLayoutStore } from '../src/store/useLayoutStore';
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

/**
 * 挂上预览对话框。
 *
 * `onClose` 可选（2026-10-12 · F3 浮层栈）：预览的 `open` 由本 spec 的入参控制、
 * 不是自持 state，所以「Esc 打到预览身上了吗」**不能**靠 DOM 消失来观察 ——
 * 得从 onClose 被调用这件事上看。默认仍是空实现，既有调用点零改动。
 */
function renderDialog(open: boolean, onClose: () => void = () => {}): void {
  act(() => {
    root.render(<PrintPreviewDialog projectId={PROJECT_ID} open={open} onClose={onClose} />);
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
      modules: {},
      palette: {},
    });
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 打开三截选择器弹窗（幂等；期六起是居中弹窗不是下拉） */
function openSelector(): void {
  if (document.querySelector('[data-print-selector-panel]')) return;
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === '模板与模块',
  );
  if (!btn) throw new Error('找不到「模板与模块」按钮');
  act(() => {
    btn.click();
  });
  expect(document.querySelector('[data-print-selector-panel]'), '点后选择器弹窗应出现').not.toBeNull();
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

/**
 * 五块清单行（中截；走五块清单的外表 —— 批 1 的 A、批 B 的 D、批 C 的 E 与 classic）。
 * 属性名 `data-print-block` 从经典时代就在，本 refactor 一个字没动。
 */
function blockCheckbox(key: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(`input[data-print-block="${key}"]`);
}

/** 勾 / 消一个五块（幂等；校验点击后 checked 确实到位） */
function setBlockChecked(key: string, on: boolean): void {
  const el = blockCheckbox(key);
  if (!el) throw new Error(`找不到五块勾选框：${key}`);
  if (el.checked !== on) {
    act(() => {
      el.click();
    });
  }
  expect(blockCheckbox(key)!.checked, `勾选五块 ${key} 后期望 ${on}`).toBe(on);
}

const paperPages = (): number => document.querySelectorAll('.a4-page').length;

/**
 * ★★ 2026-10-13 批 D（team-lead 任务书第 8 条）：**11 模块清单从此没有任何模板载体**。
 *
 * 批 D 把 H 也切成五块清单后，`PrintTemplates` 里 `usesBlocks` 全为 true
 * ⇒ 「11 行模块表单」在选择器里**一个载体都不剩**（A/D/E/H/classic 五套都没有）。
 * 通报口径是**不删断言、也不放宽判据**：把它改成对 `PrintModuleSection` **组件
 * 本体**的直接渲染断言 —— 组件留着、能力表与 `enabledSheetsOf` 的派页账本留着
 * （决策 2：代码与 spec 全留，只是不再有暴露面）。
 *
 * 本助手把该组件挂进**独立容器**（不碰 `container`：那一份留给真实对话框），
 * 用例结束由 `afterEach` 一并卸载。
 */
let moduleSectionHost: HTMLDivElement | null = null;
let moduleSectionRoot: Root | null = null;

function renderModuleSection(template: PrintTemplateId): void {
  moduleSectionHost = document.createElement('div');
  document.body.appendChild(moduleSectionHost);
  moduleSectionRoot = createRoot(moduleSectionHost);
  act(() => {
    moduleSectionRoot!.render(
      <PrintModuleSection
        template={template}
        enabledModules={printTemplateDefaultModuleIds(template)}
      />,
    );
  });
}

/** 从 seed 好的 stores 装一份 VM（批 D：模块勾选联动用例改走通路级断言时用） */
function buildVmFromStores(): ReturnType<typeof buildPrintViewModel> {
  const { stages, tasks } = useProjectsStore.getState();
  const { members } = useMembersStore.getState();
  return buildPrintViewModel({
    project: PROJECT,
    stages,
    tasks,
    members,
    stageLogs: [],
    role: MemberRoleKind.Admin,
    currentMemberId: ADMIN_ID,
    todayIso: '2026-10-09',
    now: new Date('2026-10-09T07:30:00Z'),
  });
}
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
  // 组件级渲染的独立宿主（批 D 重挂用）一并在每例后清掉
  if (moduleSectionRoot) {
    act(() => {
      moduleSectionRoot!.unmount();
    });
    if (moduleSectionHost?.parentNode) document.body.removeChild(moduleSectionHost);
    moduleSectionRoot = null;
    moduleSectionHost = null;
  }
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

  it('四套外表的原生模块集：A/D 各 4、E 3、H 3；classic 不走模块表', () => {
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
    // H 人类化（2026-10-11）：Agent 治理两模块下架 ⇒ 原生三页变成 M1/M2/M4
    // （阶段海报 / 任务海报 / 成员海报，规格 §1.2.5）；页序 = M1→M2→M4
    expect(printTemplateNativeModuleIds('agent-poster')).toEqual([
      'stage-list',
      'task-list',
      'member-roster',
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
    // H：人类化后 M1/M2/M4 **升为原生**（有原生页 ⇒ 无通用条目，原生优先）
    expect(printTemplateGenericModuleIds('agent-poster')).toEqual([]);
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
    // H 人类化后的可用集 = 三个人类原生（M10/M11 已从能力表移除，见下条）
    expect(printTemplateModuleIds('agent-poster')).toEqual([
      'stage-list',
      'task-list',
      'member-roster',
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

  it('H 人类化：M1/M2/M4 = 三个原生页（阶段/任务/成员海报）；M10/M11 下架', () => {
    expect(nativePagesOf('agent-poster', 'stage-list')).toEqual(['stage-overview']);
    expect(nativePagesOf('agent-poster', 'task-list')).toEqual(['task-register']);
    expect(nativePagesOf('agent-poster', 'member-roster')).toEqual(['member-roster']);
    // 下架的 Agent 治理两模块：已不在 H 的能力表里 ⇒ 可用性 off、勾选不进纸面。
    // 旧 prefs 里勾过 M10/M11 的用户走 `enabledSheetsOf` 时**静默忽略**
    // （规格 §1.2.5 的安全降级：不落页、不报错）。
    expect(nativePagesOf('agent-poster', 'agent-execution'), 'M10 已不在 H 能力表').toBeNull();
    expect(moduleAvailability('agent-poster', 'agent-execution')).toBe('off');
    expect(moduleAvailability('agent-poster', 'writeback-proposals')).toBe('off');
    expect(
      enabledSheetsOf('agent-poster', ['agent-execution', 'writeback-proposals']),
      '旧 prefs 勾过 M10/M11 ⇒ 静默降级（不落页、不报错）',
    ).toEqual([]);
    // 无原生页的模块：nativePagesOf = null，但期三起不一定「暂不可用」
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

describe('期二+期三 · L1-b 打印零变化红线（缺键 = 原生签名页 = 旧页勾选默认态）', () => {
  it('enabledPagesOf 默认态与四个 Document 的原生页常量逐一相等', () => {
    expect(enabledPagesOf('swiss-schedule', undefined)).toEqual([...SWISS_SCHEDULE_PAGES]);
    expect(enabledPagesOf('data-editorial', undefined)).toEqual([...DATA_EDITORIAL_PAGES]);
    expect(enabledPagesOf('editorial-index', undefined)).toEqual([...EDITORIAL_INDEX_PAGES]);
    expect(enabledPagesOf('agent-poster', undefined)).toEqual([...AGENT_POSTER_PAGES]);
    expect(enabledPagesOf('classic', undefined), 'classic 无模块页').toEqual([]);
  });

  it('缺键默认态 = 默认原生模块（她 10-09 23:38 反馈：默认必须落到签名页）', () => {
    for (const t of PRINT_TEMPLATE_IDS) {
      expect(enabledSheetsOf(t, printTemplateDefaultModuleIds(t)), `${t} 默认原生`).toEqual(
        enabledSheetsOf(t, undefined),
      );
      expect(enabledPagesOf(t, printTemplateDefaultModuleIds(t)), `${t} 默认原生（原生页）`).toEqual(
        enabledPagesOf(t, undefined),
      );
      // 默认集 ≡ 原生集（通用模块不进默认态）
      expect(printTemplateDefaultModuleIds(t), `${t} 默认 = 原生`).toEqual(
        printTemplateNativeModuleIds(t),
      );
    }
    // D/E/H 的可用集严格大于默认集（通用模块可勾选但不默认）——反馈根因的形状锁
    expect(printTemplateDefaultModuleIds('data-editorial')).not.toEqual(
      printTemplateModuleIds('data-editorial'),
    );
    expect(printTemplateDefaultModuleIds('swiss-schedule')).toEqual(
      printTemplateModuleIds('swiss-schedule'),
    );
  });

  it('显式全选可用模块：只多通用页，原生页输出零变化（「全选」范围仍是可用集）', () => {
    for (const t of PRINT_TEMPLATE_IDS) {
      const all = enabledSheetsOf(t, printTemplateModuleIds(t));
      const dft = enabledSheetsOf(t, undefined);
      // 原生页序逐页等价（零变化红线核心：任何勾选路径都碰不到原生布局）
      expect(enabledPagesOf(t, printTemplateModuleIds(t)), `${t} 全选后原生页不动`).toEqual(
        enabledPagesOf(t, undefined),
      );
      // 多出来的恰是通用页（数量 = 通用模块数）
      expect(all.length - dft.length, `${t} 全选只多通用页`).toBe(
        printTemplateGenericModuleIds(t).length,
      );
    }
    // D 显式全选 = 三通用页 + 四原生页（按 M1→M11 序；期三口径的形状锁）
    expect(enabledSheetsOf('data-editorial', printTemplateModuleIds('data-editorial'))).toEqual([
      { type: 'generic', module: 'stage-list' },
      { type: 'generic', module: 'task-list' },
      { type: 'generic', module: 'member-roster' },
      { type: 'native', page: 'progress-matrix' },
      { type: 'native', page: 'dependency-network' },
      { type: 'native', page: 'workload-composition' },
      { type: 'native', page: 'milestone-acceptance' },
    ]);
  });

  it('勾选态只做筛选不改序；暂不可用 id 混入不进纸面、不计页数', () => {
    // 顺序无关：按注册表 M1→M11 序出（A：先 stage-overview 后 member-roster）
    expect(enabledSheetsOf('swiss-schedule', ['member-roster', 'stage-list'])).toEqual([
      { type: 'native', page: 'stage-overview' },
      { type: 'native', page: 'member-roster' },
    ]);
    // 脏 / 暂不可用 id 混入 ⇒ 静默滤掉（纸面不因此多页）
    // 人类化后 H 的 M10 已下架：勾了也不落页；stage-list 是原生页
    expect(
      enabledSheetsOf('agent-poster', ['agent-execution', 'stage-list', 'bogus' as PrintModuleId]),
    ).toEqual([{ type: 'native', page: 'stage-overview' }]);
    // 反选 ⇒ 空
    expect(enabledSheetsOf('swiss-schedule', [])).toEqual([]);
    // 反馈修复后：D 默认 sheets = 四原生页（通用 M1/M2/M4 不进默认态）
    expect(enabledSheetsOf('data-editorial', undefined)).toEqual([
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
  /**
   * ★ 反向锁（2026-10-13 批 A 裁决新增）：走五块清单的外表，选择器里**不存在**
   * `[data-print-module-row]`——即「11 模块不再有暴露面」这件事被**锁死**。
   *
   * 为什么必须独立成条：批 1 的三条换载体用例只证明「模块清单在 D/E 下还在」，
   * 没有证明「它在 A/classic 下**不再**出现」。少了这条，将来有人把模块清单
   * 挂回五块模板就没人拦。
   *
   * 用法：每批落地一套就把它加进下面的数组（数组是这条锁的唯一参数）。
   * 批 1 加了 A、批 B 加了 D、**批 C 加了 E**；H 落地时继续加。
   */
  it('★ 五套模板的选择器里都不存在 11 模块行（模块清单已无任何暴露面）', () => {
    const BLOCK_TEMPLATES: readonly PrintTemplateId[] = [
      'classic',
      'swiss-schedule',
      'data-editorial',
      'editorial-index',
      // 2026-10-13 批 D：H 也切成五块清单 ⇒ 至此**五套全上**
      'agent-poster',
    ];
    for (const id of BLOCK_TEMPLATES) {
      renderDialog(true);
      openSelector();
      pickTemplate(id);
      expect(
        document.querySelectorAll('[data-print-module-row]'),
        `${id} 不该再有模块清单行（决策 1：只暴露五块）`,
      ).toHaveLength(0);
      expect(
        document.querySelectorAll('input[data-print-block]').length,
        `${id} 应出五块清单`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * ★★ 三态收敛（2026-10-13 批 C 重定，**判据一条没松，只是载体用尽**）。
   *
   * 本用例的前身是「E 外表：3 原生 + 1 通用 + 7 禁用」——它验的是选择器里三态
   * **都能渲染**。批 C 把 E 也切成五块清单后，11 模块通路**只剩 H**；而 H 的通用
   * 模块早在人类化批次升格为原生 ⇒ 四套模板的暴露面里**再没有一处**能画出
   * 「通用渲染」那一态。这是决策 1 的必然后果，不是缺陷。
   *
   * 所以这条用例拆成两头锁，缺一头都不算数：
   *   ① **能力表侧**（决策 2 的账本）：E 的 M2 仍是 `generic`、`enabledSheetsOf`
   *      仍能按它派页 ⇒ 通用通路**代码与行为全留**，将来开放勾选时是数据源切换；
   *   ② **暴露面侧**：仍在 11 模块通路的 H，11 行里 `data-avail="generic"` 的行
   *      **一个都没有** ⇒ 通用态确实没有暴露面（与上面那条反向锁同向、不重复：
   *      那条锁「五块模板没有模块行」，这条锁「模块行里没有通用态行」）。
   *
   * 少了 ①，将来有人顺手把通用通路整条删掉没人拦；少了 ②，将来有人把通用行
   * 挂回五块模板也没人拦。
   */
  it('★ 三态收敛：11 模块通路已无模板载体（四套 + classic 全是五块清单）', () => {
    /*
     * ★★ 2026-10-13 批 D 重定（team-lead 任务书第 8 条）：
     * 批 C 时这条还断言「11 模块通路只剩 H」；批 D 把 H 也切成五块清单后，
     * **一套都不剩**了。判据**一条没删，只是把「载体」换成「组件」**：
     *   · 载体侧（新事实）：五套模板的 `usesBlocks` 全为 true ⇒ 选择器里
     *      `[data-print-module-row]` 一个都不会出现（反向锁，见上一条用例）；
     *   · 能力表侧（决策 2 的账本，一字未动）：模块条目仍在、可用性仍算得出、
     *     `enabledSheetsOf` 仍能按模块派页 —— 这正是「组件留着、能力表留着」
     *     的含义：**暴露面没了，通路还在**。
     */
    expect(
      PRINT_TEMPLATES.filter((t) => !t.usesBlocks).map((t) => t.id),
      '五套模板全部走五块清单（11 模块通路已无载体）',
    ).toEqual([]);
    // 能力表侧：逐套的（原生 / 通用 / 暂不可用）三态仍算得出，且与批 D 之前逐值同
    expect(moduleAvailability('agent-poster', 'stage-list')).toBe('native');
    expect(moduleAvailability('agent-poster', 'agent-execution')).toBe('off');
    expect(moduleAvailability('editorial-index', 'task-list')).toBe('generic');
    expect(
      PRINT_TEMPLATES.filter((t) => printTemplateModuleIds(t.id).length > 0).map((t) => t.id),
      '能力表条目四处都在（A/D/E/H）',
    ).toEqual(['swiss-schedule', 'data-editorial', 'editorial-index', 'agent-poster']);
    // 派页账本仍能跑：H 的默认模块 ⇒ 三张原生海报页
    expect(
      enabledSheetsOf('agent-poster', undefined),
      'enabledSheetsOf 的派页账本留着（决策 2）',
    ).toEqual([
      { type: 'native', page: 'stage-overview' },
      { type: 'native', page: 'task-register' },
      { type: 'native', page: 'member-roster' },
    ]);
  });

  it('★（组件级）人类化后的 H 三态：3 原生默认勾选 + 8 暂不可用（M10/M11 已下架）', () => {
    /*
     * ★ 2026-10-13 批 D：**判据一条没改，载体从「H 的选择器」换成
     * `PrintModuleSection` 组件本体**（H 的 `usesBlocks` 已为 true ⇒ 选择器里
     * 不再有 11 行）。这正是「不删断言、只换重挂方式」的意思。
     * 组件级渲染不涉及纸面 ⇒ 原来那半条「默认纸面 = 人类三页」的断言挪到
     * `print-a4-visual-h` 的 legacy 复现用例里（显式传 `NATIVE_SHEETS`）。
     */
    renderModuleSection('agent-poster');

    expect(document.querySelectorAll('[data-print-module-row]')).toHaveLength(11);
    // 原生 3 个（默认勾选 = 原生签名页；行带归属页名 = 人类三页）
    for (const m of ['stage-list', 'task-list', 'member-roster']) {
      const input = moduleCheckbox(m);
      expect(input.disabled, `${m} 原生应可勾`).toBe(false);
      expect(input.checked, `${m} 默认应勾选`).toBe(true);
      expect(moduleRow(m).getAttribute('data-avail')).toBe('native');
    }
    expect(moduleRow('stage-list').textContent, '原生行标注归属页名').toContain('阶段海报');
    expect(moduleRow('task-list').textContent, '原生行标注归属页名').toContain('任务海报');
    expect(moduleRow('member-roster').textContent, '原生行标注归属页名').toContain('成员海报');

    // 暂不可用 8 个：后代模块（M3/M5-M9）+ **下架的 Agent 治理两模块**（M10/M11）
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
      'agent-execution',
      'writeback-proposals',
    ]);
    for (const el of off) {
      expect(el.textContent, '禁用行带原因').toContain('该外表下暂不可用');
    }
    // 表单脚注：通用渲染口径 + 暂不可用的后续支持口径（如实告知）
    const section = document.querySelector('[data-print-module-section]');
    expect(section!.textContent).toContain('在无原生页的外表下走通用渲染');
    expect(section!.textContent).toContain('将随通用渲染陆续支持');
  });

  it('★（通路级）模块勾选联动：摘模块 ⇒ 纸面少页 + 预计 N 页重算（store → sheets → Document）', () => {
    /*
     * ★ 2026-10-13 批 D：载体从「选择器里的 H」换成**整条通路**
     * （能力表 → `enabledSheetsOf` → `agentPosterPhysical` → `.a4-page` 计数）。
     * 没有模板再暴露 11 行模块清单了，但这条链子是**决策 2 的账本**，
     * 断言原理一字未改：勾选只做筛选、页数随之重算、页序不因勾选变。
     */
    const vm = buildVmFromStores();
    const pagesOf = (mods: readonly PrintModuleId[]): number =>
      agentPosterPhysical(vm, enabledSheetsOf('agent-poster', mods)).length;
    const kindsOf = (mods: readonly PrintModuleId[]): (string | null)[] =>
      agentPosterPhysical(vm, enabledSheetsOf('agent-poster', mods)).map((p) =>
        p.type === 'native' ? p.sheet.kind : `generic-${p.module}`,
      );

    const all = printTemplateDefaultModuleIds('agent-poster');
    expect(all, '默认 = 人类原生三模块').toEqual(['stage-list', 'task-list', 'member-roster']);
    expect(pagesOf(all), '默认 = 人类原生三页').toBe(3);
    expect(kindsOf(all)).toEqual(['stage-overview', 'task-register', 'member-roster']);

    // 摘任务海报 ⇒ 2 页
    expect(pagesOf(['stage-list', 'member-roster'])).toBe(2);
    expect(kindsOf(['stage-list', 'member-roster'])).toEqual(['stage-overview', 'member-roster']);
    // 再摘成员海报 ⇒ 1 页（页序按 M1→M2→M4 不变）
    expect(pagesOf(['stage-list'])).toBe(1);
    expect(kindsOf(['stage-list'])).toEqual(['stage-overview']);
    // 反选（一个模块都不勾）⇒ 一页不出
    expect(pagesOf([])).toBe(0);
    // 勾回 ⇒ 页回
    expect(pagesOf(['stage-list', 'member-roster'])).toBe(2);
    // 暂不可用 id 混入不进纸面、不计页数（M3 在 H 是 off）
    expect(pagesOf(['stage-list', 'delay-ledger'])).toBe(1);
  });

  it('勾选态按外表各存一套：E 摘「阶段清单」→ 切 D / H → 回 E 仍摘着；两套键互不干扰', async () => {
    /*
     * ⚠️ 2026-10-13 批 C：载体换到第三次 —— A（批 1 前）→ E（批 1）→ **E 的五块清单**
     * （批 C 后 E 也改走五块，11 模块通路只剩 H）。
     *
     * 判据本身一个字没改，只是「勾选态」换了键：批 A 起 E 的正主从 `modules`
     * 迁到 `units`（决策 5 第 4 条），所以本用例现在验的是
     *   · `units['editorial-index']` 按外表分键、换模板不丢；
     *   · 五块摘除只动 E 的键，**不串到 D 的五块**、也不串到 H 的 11 模块勾选；
     *   · 落库形状是单元 id 集合（不是旧页 id，也不是模块 id）。
     */
    renderDialog(true);
    openSelector();
    pickTemplate('editorial-index');
    // 五块清单：4 行可勾（B1「打印头部」由刊头承担 ⇒ 不可摘、不进清单）
    expect(document.querySelectorAll('input[data-print-block]')).toHaveLength(4);
    expect(blockCheckbox('header'), 'E 的 B1 不进清单').toBeNull();
    const base = paperPages();
    expect(base, 'E 默认（五块全开）= 1 页').toBe(1);
    const barsBefore = document.querySelectorAll('.ei-span__bar').length;
    expect(barsBefore, 'E 的两条跨度条在').toBe(2);

    // 摘一个**可摘**块（B4 阶段清单）⇒ 只有那一个可见区消失；B2 逐值不变
    setBlockChecked('stageTable', false);
    expect(document.querySelectorAll('.ei-index .ei-row'), '摘 B4 ⇒ 巨编号目录消失').toHaveLength(0);
    expect(
      document.querySelectorAll('.ei-span__bar').length,
      '摘 B4 不得动 B2',
    ).toBe(barsBefore);

    // 切 D：D 自己的五块默认全开（E 的摘除不串台）
    pickTemplate('data-editorial');
    expect(blockCheckbox('stageTable').checked, 'D 的 stageTable 不受 E 影响').toBe(true);
    expect(blockCheckbox('timeline').checked, 'D 的 timeline 默认勾选').toBe(true);

    // 切 H：**也走五块清单了**（批 D）⇒ 中截是 **3 行**可勾，**不是** 11 模块行。
    // H 有两行不可摘（批 D 裁决第 1 条）：B1「打印头部」（项目名载体）与
    // B5「页脚」（署名 = 页底巨字 / 页码 = 页眉页序 / 脚注是治理披露）——
    // 四套里唯一一条有**两个**丙格的模板。
    pickTemplate('agent-poster');
    expect(document.querySelectorAll('input[data-print-block]'), 'H 出五块清单（3 行可勾）').toHaveLength(3);
    expect(document.querySelectorAll('[data-print-module-row]'), 'H 不再出 11 模块行').toHaveLength(0);
    expect(blockCheckbox('header'), 'H 的 B1 不进清单').toBeNull();
    expect(blockCheckbox('footer'), 'H 的 B5 不进清单（裁决第 1 条：禁用行）').toBeNull();
    // 两行不可摘的原因**逐行给**（不再是一句通用文案套所有行）
    const hNote = document.querySelector('[data-print-selector-panel]')!.textContent ?? '';
    expect(hNote, 'B1 的原因').toContain('由该模板的刊头承载项目名与页序，属版式构件');
    expect(hNote, 'B5 的原因（署名为版式构件 + 脚注是治理披露）').toContain(
      '在本模板由版式构件承担（署名 = 页底巨字、页码 = 页眉页序），脚注是治理披露，都不随勾选变化',
    );
    expect(hNote, '两行都带状态句').toContain('该模板当前不可摘');
    const hBase = paperPages();
    expect(
      Array.from(document.querySelectorAll('.a4-page')).map((el) => el.getAttribute('data-page-form')),
      'H 默认五块 = 1 张 B2 甘特页 + 1 张 B4 状态页',
    ).toEqual(['span', 'list']);
    expect(hBase, 'H 默认五块 = 2 页').toBe(2);
    expect(blockCheckbox('stageTable').checked, 'H 的 stageTable 不受 E 影响').toBe(true);

    // 回 E：stageTable 仍被摘着（按模板分键，换模板不丢）
    pickTemplate('editorial-index');
    expect(blockCheckbox('stageTable').checked, '回 E 后 stageTable 仍摘着').toBe(false);
    expect(blockCheckbox('timeline').checked, '没动的块仍勾着').toBe(true);
    expect(document.querySelectorAll('.ei-index .ei-row')).toHaveLength(0);
    expect(document.querySelectorAll('.ei-span__bar')).toHaveLength(barsBefore);

    // 落库形状：单元 id 集合（不是旧页 id、不是模块 id）；E 的键里没有 stageTable，
    // 装置（今天不可摘）也在集合里 —— 将来开放装置勾选时它们天然保持开启。
    await flush();
    const raw = localStorage.getItem(PRINT_PREFS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      state: { units: Record<string, string[]>; modules: Record<string, string[]> };
    };
    expect(parsed.state.units['editorial-index']).toEqual([
      'header',
      'timeline',
      'projectInfo',
      'footer',
      'ei-giant-title',
      'ei-sheet-tag',
    ]);
    // H 的键不受 E 影响（两套键各存一套，谁也不覆盖谁）
    expect(parsed.state.units['agent-poster'], 'H 的五块键不该被 E 的走动造出来').toBeUndefined();
    expect(parsed.state.modules['editorial-index'], 'E 不再走模块键').toBeUndefined();
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
    expect(usePrintPrefsStore.getState().modules['swiss-schedule']).toEqual(['stage-list', 'task-list']);
  });

  it('H 旧 Agent 页勾选 ⇒ 映射出的 M10 已下架 ⇒ 空集（静默降级，规格 §1.2.5）', async () => {
    await rehydrateLegacy({
      template: 'agent-poster',
      // 旧形状：只勾了执行宣告一页（状态全览被摘）
      pages: { 'agent-poster': ['agent-declaration'] },
    });
    // 迁移先做页 → 模块映射（agent-declaration → agent-execution），**再按可用性收编**；
    // M10 已不在 H 的能力表 ⇒ 收成空集：不落页、不报错。
    expect(usePrintPrefsStore.getState().modules['agent-poster']).toEqual([]);
    expect(enabledPagesOf('agent-poster', [])).toEqual([]);
    expect(enabledSheetsOf('agent-poster', ['agent-execution']), '下架模块不落页').toEqual([]);
    expect(enabledSheetsOf('agent-poster', ['writeback-proposals']), '下架模块不落页').toEqual([]);
  });

  it('有一条映射不了 ⇒ 该模板整组回落默认（照现有 merge 兜底手法）', async () => {
    await rehydrateLegacy({
      template: 'swiss-schedule',
      pages: { 'swiss-schedule': ['stage-overview', 'bogus-page'] },
    });
    expect(
      usePrintPrefsStore.getState().modules['swiss-schedule'],
      '脏页名不赌：缺键 = 默认原生（A 无通用模块，形状同全选）',
    ).toBeUndefined();
    // 另一套模板的干净数据不受牵连（逐模板独立兜底）
    await rehydrateLegacy({
      template: 'swiss-schedule',
      pages: { 'data-editorial': ['progress-matrix'], 'swiss-schedule': ['bogus'] },
    });
    expect(usePrintPrefsStore.getState().modules['data-editorial']).toEqual(['progress-matrix']);
    expect(usePrintPrefsStore.getState().modules['swiss-schedule']).toBeUndefined();
  });

  it('跨模板脏页名按可用性收编（期三：D 可用含通用 ⇒ stage-list 不再被滤掉）', async () => {
    await rehydrateLegacy({
      template: 'data-editorial',
      // stage-overview 是 A 的页，映射出的 stage-list 期三起在 D 可用（通用渲染）
      pages: { 'data-editorial': ['stage-overview', 'progress-matrix'] },
    });
    expect(usePrintPrefsStore.getState().modules['data-editorial']).toEqual([
      'stage-list',
      'progress-matrix',
    ]);
  });

  it('反选意图保留（旧「一页都不打」⇒ 空模块集，不回落全选）', async () => {
    await rehydrateLegacy({
      template: 'swiss-schedule',
      pages: { 'swiss-schedule': [] },
    });
    expect(usePrintPrefsStore.getState().modules['swiss-schedule']).toEqual([]);
    expect(enabledPagesOf('swiss-schedule', usePrintPrefsStore.getState().modules['swiss-schedule'])).toEqual([]);
  });

  it('classic 键不收（不走模块表）；未知模板 id 剔除', async () => {
    await rehydrateLegacy({
      template: 'classic',
      pages: { classic: ['stage-overview'], 'compact-x': ['stage-overview'] },
    });
    expect(usePrintPrefsStore.getState().modules['classic']).toBeUndefined();
    expect(usePrintPrefsStore.getState().modules['compact-x' as PrintTemplateId]).toBeUndefined();
  });

  it('实时设置路径：暂不可用模块不接受勾选 / 不进整组设置；可用原生模块放行', () => {
    // 暂不可用（M3 在 H）：拒
    act(() => {
      usePrintPrefsStore.getState().setModuleEnabled('agent-poster', 'delay-ledger', true);
    });
    expect(usePrintPrefsStore.getState().modules['agent-poster'], '暂不可用勾选被拒').toBeUndefined();
    // 人类原生（M1 在 H）：收（缺键时从「默认原生」起手 ⇒ 人类三页）
    act(() => {
      usePrintPrefsStore.getState().setModuleEnabled('agent-poster', 'stage-list', true);
    });
    expect(usePrintPrefsStore.getState().modules['agent-poster']).toEqual([
      'stage-list',
      'task-list',
      'member-roster',
    ]);
    // 整组设置：暂不可用 id 忽略（**含已下架的 M10/M11**），可用集按 M1→M11 序
    act(() => {
      usePrintPrefsStore.getState().setTemplateModules('agent-poster', [
        'agent-execution',
        'stage-list',
        'delay-ledger',
        'writeback-proposals',
        'member-roster',
      ]);
    });
    expect(usePrintPrefsStore.getState().modules['agent-poster']).toEqual([
      'stage-list',
      'member-roster',
    ]);
    // 经典不接模块（usesBlocks）
    act(() => {
      usePrintPrefsStore.getState().setModuleEnabled('classic', 'stage-list', true);
    });
    expect(usePrintPrefsStore.getState().modules['classic']).toBeUndefined();
  });
});

/* ====================================================================================
 * L2 · 静态源码锁（注册表纪律 + 渲染侧零改动）
 * ==================================================================================== */

describe('期二+期三 · L2 静态锁', () => {
  const ROOT = resolve(__dirname, '..');
  const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

  it('print-templates.ts：模块能力表在位 + 原生/通用两类 + 静态类映射纪律保留（零模板串）', () => {
    const src = read('src/components/print/print-templates.ts');
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
    // 默认态收敛（她 10-09 23:38 反馈）：缺键兜底 = 原生签名页
    expect(src).toContain('export function printTemplateDefaultModuleIds');
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

/* ====================================================================================
 * 期六 · 选择器弹窗化（dropdown 长条 → 主从式居中弹窗，UX 研究 §1.3）
 * ==================================================================================== */

describe('期六 · 选择器弹窗形态（真实对话框）', () => {
  it('居中弹窗契约：Modal center 档 dialog + data-print-selector-panel 锚点 + 状态条', () => {
    renderDialog(true);
    openSelector();

    // Modal center 档的 dialog 语义（role/aria-modal 由 Modal 提供）。
    // 注意页面上有两个 dialog：外层 fullscreen 预览 + 本选择器弹窗——按 aria-label 取本弹窗
    const dialog = document.querySelector('[role="dialog"][aria-label="模板与模块"]');
    expect(dialog, '应是 Modal 居中被弹窗').not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    // 面板锚点属性保留（spec 锚点，期二起就在）
    const panel = document.querySelector('[data-print-selector-panel]');
    expect(panel, '面板锚点属性保留').not.toBeNull();
    expect(panel!.getAttribute('role')).toBe('group');

    // 左列模板 radiogroup：5 个单选卡（经典占位 + 四版真缩略图）
    const group = document.querySelector('[role="radiogroup"][aria-label="阅读方式"]');
    expect(group, '左列模板列表应在').not.toBeNull();
    expect(group!.querySelectorAll('[data-print-template-option]')).toHaveLength(5);

    // 状态条：当前 N 个模块 · 预计 M 页（M 与工具条同源；夹具经典纸面 1 页）
    const status = panel!.textContent ?? '';
    expect(status, '状态条应报块数与预计页数').toMatch(/当前 5 块 · 预计 \d+ 页/);
    // 即时生效明示（无应用/取消，Esc 即纯关闭）
    expect(status).toContain('即时生效');
    expect(status).toContain('Esc / 点遮罩 / ✕ 均为纯关闭');

    // 无「应用 / 取消 / 确定」按钮（即时重渲染已生效，不设待确认态；
    // 只在弹窗内查——动作条的「取消」是关整个预览，另一回事）
    for (const label of ['应用', '取消', '确定', '保存']) {
      const btn = Array.from(panel!.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').trim() === label,
      );
      expect(btn, `弹窗内不应有「${label}」按钮`).toBeUndefined();
    }
  });

  it('四版真缩略图落位（img + data 属性 + alt）；经典无真图沿用字母占位', () => {
    renderDialog(true);
    openSelector();

    // 四张真图（她 10-09 提供，落 public/print-thumbs/）
    for (const id of ['swiss-schedule', 'data-editorial', 'editorial-index', 'agent-poster']) {
      const img = document.querySelector<HTMLImageElement>(`img[data-print-template-thumb="${id}"]`);
      expect(img, `${id} 应有真缩略图`).not.toBeNull();
      expect(img!.getAttribute('src'), 'src 走 public 静态资源（同 /logo.png 范式）').toMatch(
        /^\/print-thumbs\/[ADEH]-.+\.png$/,
      );
      expect(img!.getAttribute('alt'), 'alt 指名模板与页').toContain('第 1 页预览');
    }
    // 经典无真图 ⇒ 占位（版本字母「经」），不出现 img
    const classicCard = document.querySelector('[data-print-template-option="classic"]');
    expect(classicCard!.querySelector('img'), '经典不应有真缩略图').toBeNull();
    expect(classicCard!.textContent, '经典占位含版本字母').toContain('经');
  });

  it('焦点入弹窗：打开后焦点落模板列表首项', async () => {
    renderDialog(true);
    openSelector();
    // 首项焦点延一帧（让位 Modal 的面板焦点）——排空一帧
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const active = document.activeElement;
    expect(
      active?.getAttribute('data-print-template-option'),
      '打开后焦点应在模板列表首项（classic）',
    ).toBe('classic');
  });

  /**
   * 关闭三路的公共收尾：**替浏览器把出口动画播完**，让浮层真正退场。
   *
   * 2026-10-11 出口接线后，「关闭」不再等于「立刻从 DOM 消失」——元素会活到
   * `dialog-pop-out` 播完再卸载（presence 机制，见 src/hooks/usePresence.ts），
   * 否则出口动画永远没机会播。jsdom 不跑 CSS 动画、**永不派发 `animationend`**，
   * 所以这里手动派一次：比干等 320ms 兜底更快，也更贴近真实时序。
   *
   * 顺带把「关闭确实生效」的证据升级了一步：先断言浮层已进入出口期，
   * 再断言它退干净了 —— 只断言「最后没了」是分不清「关闭生效」与「压根没打开」的。
   */
  function settleExit(why: string): void {
    const dialog = document.querySelector('[role="dialog"][aria-label="模板与模块"]');
    // 出口动画落在 Modal 自己的锚点容器上（dialog 的首个子元素），不是面板本身
    const exitEl = dialog?.firstElementChild as HTMLElement | null;
    expect(exitEl?.classList.contains('dialog-pop-out'), `${why}：应进入出口期`).toBe(true);
    act(() => {
      exitEl!.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
  }

  it('Esc 关闭（纯关闭：勾选态已生效，无需应用）', () => {
    // 预览的 open 由本 spec 控制（不入 state），故用计数观察「Esc 有没有打到预览身上」
    let previewCloseCalls = 0;
    renderDialog(true, () => {
      previewCloseCalls += 1;
    });
    openSelector();
    // ⚠️ 载体换过三次：A（批 1 前）→ D（批 1 后）→ H（批 B 后）→ **H 的五块清单**
    // （批 D 后 H 也走五块 ⇒ 11 模块清单至此没有任何模板载体）
    pickTemplate('agent-poster');
    // 摘一个**可摘**的五块（即时生效；H 的 B1 与 B5 都是禁用态、不进清单
    // ⇒ 用 B4 阶段清单）
    setBlockChecked('stageTable', false);
    expect(document.querySelectorAll('input[data-print-block]'), 'H 的三行可勾').toHaveLength(3);
    expect(document.querySelectorAll('[data-print-module-row]')).toHaveLength(0);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    settleExit('Esc');
    expect(document.querySelector('[data-print-selector-panel]'), 'Esc 后面板应消失').toBeNull();
    /*
     * ★ 2026-10-12 · F3 补强的**下半句**：Esc 只该关掉栈顶（选择器），
     *   底下那层（打印预览）必须还活着。
     *
     * 修前本用例只有上面那一行断言 —— 而修前的 Modal 是「谁 open 谁响应 Esc」，
     * 一次按键把**两层一起关掉**，上面那行照样绿。也就是说：这条用例在修复前
     * 全量全绿，却完全测不出它名字里承诺的那件事（真实事故形态：「打印预览里
     * 开模板选择器，按一次 Esc 预览也一起没了」）。
     * 现在起，缺了下层存活的证据就不算关对了 —— 单独断言「选择器没了」是分不清
     * 「关对了」与「整摞一起塌了」的。
     */
    expect(
      document.querySelector('[role="dialog"][aria-label="打印预览"]'),
      'Esc 只应关掉栈顶：下层的打印预览必须仍存活',
    ).not.toBeNull();
    expect(previewCloseCalls, '第一次 Esc 不该打到预览身上').toBe(0);

    /*
     * 再按一次 Esc：选择器已退场，预览成为栈顶 ⇒ 这次才轮到它。
     * 预览的 open 是外部入参（不因 onClose 而变），所以"关了没"由 onClose 计数证明，
     * 而不是看 DOM —— 这条正是「栈顶判定随出栈而转移」的证据。
     */
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(previewCloseCalls, '第二次 Esc 才轮到下层（栈顶随出栈转移到预览）').toBe(1);

    // 关闭后纸面仍是改过的勾选态（即时重渲染，无待确认）
    // 起手 = H 的五块全开 ⇒ 摘掉 B4 后剩四条（含今天不可摘的装置），按声明序
    expect(usePrintPrefsStore.getState().units['agent-poster']).toEqual([
      'header',
      'timeline',
      'projectInfo',
      'footer',
      'ap-flood-top',
      'ap-flood-bottom',
      'ap-spine',
      'ap-sum',
    ]);
  });

  it('点遮罩关闭（Modal center 档的点击捕获层）', () => {
    renderDialog(true);
    openSelector();
    // Modal 的点击捕获层 = 本弹窗 dialog 内的 flex 容器（onMouseDown 判 target===currentTarget）
    const catcher = document.querySelector('[role="dialog"][aria-label="模板与模块"] > div');
    expect(catcher, '点击捕获层应在').not.toBeNull();
    act(() => {
      catcher!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    settleExit('点遮罩');
    expect(document.querySelector('[data-print-selector-panel]'), '点遮罩应关闭').toBeNull();
  });

  it('✕ 关闭（第三路）', () => {
    renderDialog(true);
    openSelector();
    const closeBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === '关闭模板与模块',
    );
    expect(closeBtn, '✕ 按钮应在').not.toBeUndefined();
    act(() => {
      closeBtn!.click();
    });
    settleExit('✕');
    expect(document.querySelector('[data-print-selector-panel]'), '✕ 后面板应消失').toBeNull();
  });

  it('打印预览遮罩让出侧栏（她 10-09 23:38 反馈：fullscreen + railLeft，xl 随折叠随缘）', () => {
    // jsdom 的 matchMedia.matches 恒 false ⇒ 打桩成 ≥xl（1280）再挂对话框
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('1280'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
    try {
      // 侧栏展开 ⇒ 遮罩左缘让出 240（与 CSS --sidebar-w 同值）
      act(() => {
        useLayoutStore.setState({ sidebarExpanded: true });
      });
      renderDialog(true);
      const overlay = document.querySelector<HTMLElement>('[role="dialog"][aria-label="打印预览"]');
      expect(overlay, '打印预览遮罩应在').not.toBeNull();
      expect(overlay!.style.left, '≥xl 预览遮罩应从侧栏右缘起（让出 240）').toBe('240px');
      // 折叠侧栏 ⇒ 左缘随缘到 64（活的要件：预览打开期间侧栏仍可折叠）
      act(() => {
        useLayoutStore.setState({ sidebarExpanded: false });
      });
      expect(
        document.querySelector<HTMLElement>('[role="dialog"][aria-label="打印预览"]')!.style.left,
        '侧栏折叠后遮罩左缘随缘到 64',
      ).toBe('64px');
    } finally {
      window.matchMedia = original;
    }
  });
});

/* ====================================================================================
 * 期六 · L2 静态锁（z 档 / 退役 / <xl 降级是同一棵树）
 * ==================================================================================== */

describe('期六 · L2 静态锁', () => {
  const ROOT = resolve(__dirname, '..');
  const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

  it('Modal.tsx：zTier 静态映射在位（78 档新增，既有四档语义不变）', () => {
    const src = read('src/components/common/Modal.tsx');
    expect(src).toContain("60: 'z-[60]'");
    expect(src).toContain("70: 'z-[70]'");
    expect(src).toContain("75: 'z-[75]'");
    expect(src).toContain("78: 'z-[78]'");
    // 静态映射纪律：不许拿数字拼类名（JIT 看不见动态串；拼接写法防本 spec 自咬）
    expect(src, '禁止模板字符串拼 z 档类名').not.toContain('z-[' + '${');
    expect(src).toContain('overlayZClass');
    expect(src).toContain('zTier?: 60 | 70 | 75 | 78');
  });

  it('PrintPreviewDialog：锚定定位机制整体退役（净删，标识符不在源码中出现）', () => {
    const src = read('src/components/print/PrintPreviewDialog.tsx');
    expect(src, 'selectorPos 应整体退役').not.toContain('selectorPos');
    expect(src, 'panelHeight 应整体退役').not.toContain('panelHeight');
    expect(src, 'resolveSelectorPanelPos 应整体退役').not.toContain('resolveSelectorPanelPos');
    // 退役的 resize 收起监听（居中弹窗不随窗口变化消失；文件内不应再有 resize 监听）
    expect(src, 'resize 收起机制应整体退役').not.toContain("addEventListener('resize'");
    // 正向：center 档 + zTier 78 + 弹窗体接线在位
    expect(src).toContain('placement="center"');
    expect(src).toContain('zTier={78}');
    expect(src).toContain('<PrintSelectorPanel');
  });

  it('<xl 降级是同一棵树重排（横滑类 + xl:列类同存，不是第二套设计）', () => {
    const src = read('src/components/print/PrintPreviewDialog.tsx');
    expect(src, '模板列表容器应同时带横滑（<xl）与纵列（xl+）类').toContain('overflow-x-auto');
    expect(src).toContain('xl:flex-col');
    expect(src).toContain('xl:grid-cols-[240px_minmax(0,1fr)]');
    // 右侧内容内部滚（不撑破弹窗）
    expect(src).toContain('overflow-y-auto');
  });
});
