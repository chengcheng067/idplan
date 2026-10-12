// @vitest-environment jsdom
/**
 * 打印内容自定义 + 皮肤预留（v0.8.6.0002 · 反馈 #9.2 / #9.3）验收，
 * 四版模板重建（产品决策文档 §2.1/§2.2/§3.2）后适配；
 * v1.5-a 期二「外表 × 模块分离」（决策文档 §3.3）中截改**模块勾选**后再适配。
 *
 * 她的原话：
 *   ② 打印内容自定义：「希望给用户提供打印内容的选项，将选择权交给用户。
 *      例如：具体要打印哪些内容、时间轴是否作为可选打印项，以及其他相关选择。」
 *   ③ 预留皮肤功能：「预留打印日程表的皮肤功能，以便日后推出更多皮肤。」
 *
 * ── 本 spec 锁的事 ──
 * L1 行为（真实纸面）：
 *   ① 默认五块全在（未传偏好 = 视觉零变化），.print-root 挂 classic 模板类；
 *   ② 关「打印时间轴」⇒ 该 section 消失、`.schedule-table` 仍在、**第一页不留
 *      半白**（分页预留 210→92 ⇒ 首页 5 段变 6 段，纯函数口径见 L2 组）；
 *   ③ 其余四块逐块可摘：摘谁谁消失，没摘的不动；
 *   ④ 勾选写 localStorage（`changxia.printPrefs`），重 hydrate / 卸载重开
 *      仍是用户选的；脏数据（缺块键 / 未知 template）merge 兜底回落默认而不是
 *      静默少打一块；
 *   ⑤【新】模板选择器：五张卡可切，A/D 版各渲染 4 页且可打印；E/H 版已
 *      落地（批 3/批 4）——E 渲染 3 页（产出物空态）、H 渲染 3 页（无 Agent
 *      数据 ⇒ 整版只读空态），均可打印（转正后适配：不再有「建设中」）；
 *   ⑥【新】页面勾选：四版默认勾选原生签名页、可摘模块、页码/预计页数联动；
 *   ⑦【新】配色硬闸门：不达标禁存（store 层一个字节都不落库）。
 * L2（静态源码锁 + paginateSections 纯函数契约）见文件末组。
 *
 * ── v2 适配记录（skin → template，决策文档 §2.3 第 3 条；唯一必然变红的既有 spec）──
 *   改动 1：`usePrintPrefsStore` 的 `skin: 'default'` → `template: 'classic'`
 *           （旧键经 merge 迁移；L1④ 的脏数据例从「未知 skin」改演「旧 skin
 *           键迁移 + 未知 template 回落」两件事——迁移是本次新增行为，必须锁）；
 *   改动 2：持久值断言 `parsed.state.skin` → `parsed.state.template`；
 *   改动 3：「打印内容」钮升格为「模板与页面」（三截下拉），点击 helper 跟着改；
 *   改动 4：L2 静态锁里 `skin={skin}` → `skin="default"`（SchedulePaper 主体
 *           不碰，classic 恒default 皮肤；print-templates.ts 锁增补模板注册表断言）。
 *   **未动**：五块开关的 data-print-block 契约、经典纸面全部行为断言、
 *   paginateSections 纯函数口径、`.print-root` 挂类断言（classic 类名冻结）。
 *
 * ── v3（期二）适配记录（pages → modules，决策文档 §3.3）──
 *   语义真变：中截从「该模板的**页**复选框」改为「11 个**内容模块**复选框」
 *   （4 套模板 = 外表，模块跨模板可选；非原生 = 禁用态 + 原因，期三通用渲染补）。
 *   改动 1：⑥ 的标题/步骤/断言全改模块口径（默认全选**原生**模块、可摘模块、
 *          预计页数联动；原生页勾选与旧页勾选等价 = 打印零变化红线由
 *          print-selector-modules.spec.tsx 专锁）；
 *   改动 2：helper 改名（`pageCheckbox`→`moduleCheckbox`、`setPageChecked`→
 *          `setModuleChecked`、`blocksPanel`→`selectorPanel`），查询属性
 *          `data-print-page`→`data-print-module`、`data-print-pages-all/none`
 *          →`data-print-modules-all/none`、面板 `data-print-blocks-panel`
 *          →`data-print-selector-panel`，触发钮文案「模板与页面」→「模板与模块」；
 *   改动 3：L2 静态锁同步（PrintPreviewDialog 的 data-print-module、
 *          usePrintPrefsStore 的模块语义三件套）。
 *   **未动**：五块开关契约、经典纸面全部行为、④ 的持久化/脏数据口径、
 *   ⑦ 配色闸门、paginateSections 纯函数、纸面 `.a4-page[data-print-page]`
 *   （页 kind 属性在渲染侧不动，视觉 spec 照旧命中）。
 *
 * ── v4（默认态收敛）适配记录（她 10-09 23:38 反馈的修复） ──
 *   她的原话：「地板参考图的甘特图是示意图这个样子的，但是比如说现在我们
 *   做出来的东西，就完全不是这个味道，其他几个版本同理」——根因：pages
 *   缺键兜底曾是「全选可用」，D/E/H 的通用模块（M1/M2/M4）按 M1→M11 序
 *   排最前，打开预览第一页是通用表格而不是签名页。缺键兜底收敛为
 *   `printTemplateDefaultModuleIds`（= 原生模块）。
 *   改动 1：⑤ 的 D/E/H 默认页数断言随改（D 7→4、E 4→3、H 6→3），通用页
 *          的标题/口径断言改走「手动勾选后上纸」的路径（可勾选性保留的
 *          证据），并新增「D 默认第一页 = progress-matrix」断言；
 *   改动 2：L2 静态锁增补 printTemplateDefaultModuleIds 在位断言。
 *   **未动**：A/classic 的全部断言（A 无通用模块，默认形状不变）、五块
 *   开关、⑥ 的 A 路径（原生 = 可用，默认全选形状不变）。
 *
 * ── v5（H 人类化）适配记录（2026-10-11，规格 §1.2.5 / §1.3） ──
 *   H 的 Agent 治理两模块（M10/M11）下架、M1/M2/M4 升为**人类原生海报页** ⇒
 *   改动 1：⑤ 的 H 段整块重写——不再断言「无 Agent 数据 ⇒ 整版只读空态」
 *          （该空态随 Agent 载荷一起退役），改断人类三页 kind 集合 + 逐页
 *          数据驱动分页（本夹具 8 阶段 / 8 任务 ⇒ 5 页）+ Agent 载荷零上纸；
 *   改动 2：H 段不再有「手动勾通用模块 ⇒ 6 页」的路径（H 已无通用专属模块）。
 *   **未动**：A/D/E/classic 的全部断言。
 *
 * 挂载形态同 `print-preview-zoom.spec.tsx`：先 open=false 再翻 true（= 首次
 * 打开），纸面走**真实** SchedulePaper + 真实 useSchedulePaperData，stores
 * 用 replaceAll/setAll 直接 seed（jsdom + fake-indexeddb 已在 setup.ts 就位）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/** ResizeObserver：jsdom 无原生实现（Modal 与 fit 缩放 effect 都要，打桩保底） */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

import { PrintPreviewDialog } from '../src/components/print/PrintPreviewDialog';
import {
  DEFAULT_SCHEDULE_PAPER_BLOCKS,
  firstPageHeaderFor,
  paginateSections,
  type ScheduleSection,
} from '../src/lib/schedule-print';
import {
  printSkinClass,
  printTemplateClass,
  type PrintSkinId,
  type PrintTemplateId,
} from '../src/components/print/print-templates';
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
 * 夹具
 * ==================================================================================== */

const PROJECT_ID = 'proj_print_opts';
const ADMIN_ID = 'm-admin-print-opts';
/**
 * 8 段 × 每段 1 任务。2026-10-09 分页早断修复后：每段 = 数据行一行
 * （实测 34px，估高 37），第一页预算 = 972 − 头部/项目信息/时间轴
 * （213 + 8×37 = 509）− 表格 chrome 90 = 373 ⇒ 10 行 ⇒ **8 段全部
 * 一页装下**（旧估高每段 122px，被切成 5+3 两页、第一页下半部留白）。
 * 关时间轴 ⇒ 第一页预算 972 − 103 − 90 = 779 ⇒ 21 行 ⇒ 同样一页。
 */
const STAGE_COUNT = 8;
const BLOCK_KEYS = ['header', 'timeline', 'projectInfo', 'stageTable', 'footer'] as const;

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

function makeStages(n: number): Stage[] {
  const out: Stage[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      id: `stg_po_${String(i).padStart(2, '0')}`,
      projectId: PROJECT_ID,
      orderIndex: i,
      templateKey: null,
      colorIndex: ((i - 1) % 9) + 1,
      customColor: null,
      name: `阶段${i}`,
      ratioPercent: 10,
      startAt: '2026-01-05T00:00:00Z',
      endAt: '2026-01-20T23:59:59Z',
      status: i % 2 === 0 ? StageStatus.Completed : StageStatus.InProgress,
      ownerId: ADMIN_ID,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    });
  }
  return out;
}

function makeTasks(stages: Stage[]): Task[] {
  return stages.map((s, i) => ({
    id: `tsk_po_${String(i + 1).padStart(2, '0')}`,
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

/** 装数据 + 定身份（管理员 ⇒ memberView=false ⇒ 8 段全量可见）。store 写入包 act（setup.ts 要求） */
function seedStores(): void {
  const stages = makeStages(STAGE_COUNT);
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

/** 生产形态：ProjectCard 常驻挂载本面板，靠 open 切换 */
function renderDialog(open: boolean): void {
  act(() => {
    root.render(<PrintPreviewDialog projectId={PROJECT_ID} open={open} onClose={() => {}} />);
  });
}

/** flush microtask：zustand persist 的 setItem 是 thenable 链（异步一拍），读 localStorage 前必须先排空 */
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

/** 每例从「默认全开 / classic 模板」起手（含把 persist 的异步写排空） */
async function resetPrefs(): Promise<void> {
  await act(async () => {
    usePrintPrefsStore.setState({
      blocks: { ...DEFAULT_SCHEDULE_PAPER_BLOCKS },
      template: 'classic',
      modules: {},
      palette: {},
    });
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clickButton(text: string): void {
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === text,
  );
  if (!btn) throw new Error(`找不到按钮：${text}`);
  act(() => {
    btn.click();
  });
}

function selectorPanel(): HTMLElement | null {
  return document.querySelector('[data-print-selector-panel]');
}

/** 打开下拉面板（幂等：已开则不动） */
function openBlocksPanel(): void {
  if (selectorPanel()) return;
  clickButton('模板与模块');
  expect(selectorPanel(), '点「模板与模块」后下拉面板应出现').not.toBeNull();
}

/** 点模板卡（选择器上截） */
function pickTemplate(id: PrintTemplateId): void {
  const btn = document.querySelector<HTMLButtonElement>(`[data-print-template-option="${id}"]`);
  if (!btn) throw new Error(`找不到模板卡：${id}`);
  act(() => {
    btn.click();
  });
}

function checkbox(key: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[data-print-block="${key}"]`);
  if (!el) throw new Error(`找不到勾选框：${key}`);
  return el;
}

/** 模块勾选框（中截 · 期二：pages → modules） */
function moduleCheckbox(module: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[data-print-module="${module}"]`);
  if (!el) throw new Error(`找不到模块勾选框：${module}`);
  return el;
}

/** 勾 / 取消一块（幂等；校验点击后 checked 确实到位） */
function setBlockChecked(key: string, on: boolean): void {
  const el = checkbox(key);
  if (el.checked !== on) {
    act(() => {
      el.click();
    });
  }
  expect(checkbox(key).checked, `勾选 ${key} 后期望 ${on}`).toBe(on);
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

/* ---- 纸面探针 ---- */

const paperRoot = (): HTMLElement | null => document.querySelector('.print-root');
const firstPageTable = (): HTMLTableElement | null => document.querySelector('.a4-page .schedule-table');
const firstPageRows = (): number => firstPageTable()?.querySelectorAll('tbody tr').length ?? -1;
const h2Texts = (): string[] =>
  Array.from(document.querySelectorAll('.a4-page h2')).map((h) => (h.textContent ?? '').trim());
/** 纸面内文本（.print-root 子树）——五块的显隐都断言在这里，工具条 chrome 不算纸面内容 */
const containsText = (t: string): boolean => (paperRoot()?.textContent ?? '').includes(t);
/** 全 body 文本——工具条文案（预计 N 页）在 .print-root 外，走这个 */
const bodyContains = (t: string): boolean => (document.body.textContent ?? '').includes(t);
/** 打印按钮（动作条主操作） */
const printButton = (): HTMLButtonElement | null =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === '打印') ?? null;

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
 * L1 · 行为
 * ==================================================================================== */

describe('打印内容自定义 + 模板选择 · L1 行为（真实纸面）', () => {
  it('① 默认五块全在（未传偏好 ⇒ 视觉零变化），.print-root 挂 classic 模板类', () => {
    renderDialog(false);
    expect(paperRoot(), '关闭态不应渲染纸面').toBeNull();

    renderDialog(true);
    expect(paperRoot(), '打开后纸面上屏').not.toBeNull();
    expect(paperRoot()!.className, 'classic 模板类必须挂上（类名冻结：既有 spec 钉死）').toContain(
      'print-skin-default',
    );
    // 头部 / 时间轴 / 项目信息 / 清单 / 页脚 五块都在
    expect(h2Texts()).toEqual(expect.arrayContaining(['打印时间轴', '阶段清单']));
    expect(containsText('排期基准'), '项目信息块在').toBe(true);
    expect(containsText('打印日期'), '头部块在').toBe(true);
    expect(containsText('ID Plan · 项目排期与交付管理'), '页脚块在').toBe(true);
    expect(containsText(PROJECT.name), '头部块含项目名').toBe(true);
    expect(firstPageRows(), '实测校准分页：首屏限 373px ⇒ 8 段全部一页装下（旧 5 段）').toBe(8);
    expect(bodyContains('预计 1 页'), '工具条页数文案随分页（旧为 2 页）').toBe(true);

    // 打开下拉面板：五块默认全选
    openBlocksPanel();
    for (const key of BLOCK_KEYS) {
      expect(checkbox(key).checked, `${key} 默认应勾选`).toBe(true);
    }
  });

  it('② 关「打印时间轴」⇒ 甘特消失、清单还在、第一页不留半白（8 段仍一页）', () => {
    renderDialog(true);
    expect(h2Texts(), '前置：时间轴在').toContain('打印时间轴');
    expect(firstPageRows(), '前置：默认 8 段一页').toBe(8);

    openBlocksPanel();
    setBlockChecked('timeline', false);

    expect(h2Texts(), '时间轴摘掉 ⇒ 不得再有该 h2').not.toContain('打印时间轴');
    expect(h2Texts(), '阶段清单没摘 ⇒ 仍在').toContain('阶段清单');
    expect(firstPageTable(), '阶段清单表仍在').not.toBeNull();
    expect(containsText('打印日期'), '头部没摘 ⇒ 仍在').toBe(true);
    expect(containsText('排期基准'), '项目信息没摘 ⇒ 仍在').toBe(true);
    expect(
      firstPageRows(),
      '关时间轴 ⇒ 首屏限 779px ⇒ 8 段仍全部一页（比旧口径的 6 段更满）',
    ).toBe(8);
    // 只动时间轴，其余勾选不动
    expect(usePrintPrefsStore.getState().blocks).toEqual({
      header: true,
      timeline: false,
      projectInfo: true,
      stageTable: true,
      footer: true,
    });
  });

  it('③ 其余四块逐块可摘：摘谁谁消失，没摘的不动', async () => {
    for (const key of ['header', 'projectInfo', 'stageTable', 'footer'] as const) {
      // 每轮从默认偏好重来
      await resetPrefs();
      renderDialog(true);
      openBlocksPanel();
      setBlockChecked(key, false);

      if (key === 'header') {
        expect(document.querySelector('.a4-page h1'), '头部摘掉 ⇒ 项目名 h1 消失').toBeNull();
        expect(containsText('打印日期'), '头部摘掉 ⇒ 打印日期消失').toBe(false);
      }
      if (key === 'projectInfo') {
        expect(containsText('排期基准'), '项目信息摘掉 ⇒ 排期基准消失').toBe(false);
      }
      if (key === 'stageTable') {
        expect(firstPageTable(), '阶段清单摘掉 ⇒ 表格消失').toBeNull();
        expect(containsText('阶段清单'), '阶段清单摘掉 ⇒ 标题消失').toBe(false);
      }
      if (key === 'footer') {
        expect(containsText('ID Plan · 项目排期与交付管理'), '页脚摘掉 ⇒ 署名消失').toBe(false);
        expect(containsText('第 1 / 2 页'), '页脚摘掉 ⇒ 页码消失').toBe(false);
      }
      // 没摘的仍在（时间轴是每一轮都没摘的对照组；header 轮自身被摘，不能当对照组）
      expect(paperRoot(), '纸面根仍在').not.toBeNull();
      expect(h2Texts(), '时间轴（未摘）仍在').toContain('打印时间轴');
      if (key !== 'header') {
        expect(containsText(PROJECT.name), '头部（未摘）仍在').toBe(true);
        expect(containsText('打印日期'), '头部（未摘）仍在').toBe(true);
      }
    }
  });

  it('④ 勾选写 localStorage；重 hydrate / 卸载重开仍是用户选的；脏数据 merge 兜底（含旧 skin 键迁移）', async () => {
    renderDialog(true);
    openBlocksPanel();
    setBlockChecked('timeline', false);

    // 写路径：persist 落库
    await flush();
    const raw = localStorage.getItem(PRINT_PREFS_STORAGE_KEY);
    expect(raw, '勾选应写入 localStorage').not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      state: { blocks: Record<string, boolean>; template: string };
      version: number;
    };
    expect(parsed.version).toBe(0);
    expect(parsed.state.blocks.timeline, '被摘的块落库为 false').toBe(false);
    expect(parsed.state.blocks.header, '没动的块落库为 true').toBe(true);
    expect(parsed.state.template, '模板落库（默认 classic）').toBe('classic');

    // 读路径 1：rehydrate 后 store 仍是用户选的
    await rehydratePrefs();
    expect(usePrintPrefsStore.getState().blocks.timeline).toBe(false);

    // 读路径 2：卸载重开（= 刷新后回来），纸面仍无时间轴、清单仍在
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    renderDialog(true);
    expect(h2Texts(), '重开后时间轴仍被摘着').not.toContain('打印时间轴');
    expect(firstPageTable(), '重开后清单仍在').not.toBeNull();
    expect(firstPageRows(), '重开后仍按「关时间轴」预算分页 ⇒ 8 段一页').toBe(8);

    // 脏数据 A：缺四个块键的 blocks + **旧 skin 键** ⇒ merge 兜底。
    // skin:'default' 是 v0.8.6.0002 的持久形状，必须迁成 template:'classic'（决策文档 §2.3）。
    await resetPrefs();
    localStorage.setItem(
      PRINT_PREFS_STORAGE_KEY,
      JSON.stringify({ state: { blocks: { header: false }, skin: 'default' }, version: 0 }),
    );
    await rehydratePrefs();
    expect(usePrintPrefsStore.getState().blocks, '缺键回落默认全开').toEqual({
      header: false,
      timeline: true,
      projectInfo: true,
      stageTable: true,
      footer: true,
    });
    expect(usePrintPrefsStore.getState().template, '旧 skin 键迁成 classic').toBe('classic');

    // 脏数据 B：未知 template id ⇒ 回落 classic（与旧「未知 skin 回落 default」同兜底）
    await resetPrefs();
    localStorage.setItem(
      PRINT_PREFS_STORAGE_KEY,
      JSON.stringify({ state: { blocks: { header: false }, template: 'compact-x' }, version: 0 }),
    );
    await rehydratePrefs();
    expect(usePrintPrefsStore.getState().template, '未知 template 回落 classic').toBe('classic');
  });

  it('⑤【新】模板选择器：A/D/E/H 四版各自落地可打印；H 无 Agent 数据走整版空态', () => {
    renderDialog(true);
    openBlocksPanel();
    // 五张卡齐全（决策 ⑥：四套全上，选择器先看得见全貌）
    for (const id of ['classic', 'swiss-schedule', 'data-editorial', 'editorial-index', 'agent-poster']) {
      expect(
        document.querySelector(`[data-print-template-option="${id}"]`),
        `模板卡 ${id} 应在选择器里`,
      ).not.toBeNull();
    }

    // 切 A：**五块形态**（2026-10-13 批 1 · 决策 1：选择器只暴露那 5 块）
    // 本夹具 8 阶段 ⇒ 首页 B1+B2+B3 装不下清单（纸壳页）+ 第 2 页 B4 = 2 页
    pickTemplate('swiss-schedule');
    const rootEl = paperRoot()!;
    expect(rootEl.className).toContain('print-template-swiss-schedule');
    expect(document.querySelectorAll('.a4-page')).toHaveLength(2);
    expect(bodyContains('预计 2 页')).toBe(true);
    expect(printButton()!.disabled, 'A 版可打印').toBe(false);
    // 中截 = 五块清单：4 行可勾（B1「打印头部」由刊头承担 ⇒ 不可摘、不进清单）
    expect(document.querySelectorAll('input[data-print-block]')).toHaveLength(4);
    expect(document.querySelector('input[data-print-block="header"]'), 'B1 不进清单').toBeNull();
    expect(
      document.querySelector('[data-print-module-row]'),
      '批 1 后 A 的选择器中截不再是 11 个内容模块（决策 1：只暴露 5 块）',
    ).toBeNull();
    for (const k of ['timeline', 'projectInfo', 'stageTable', 'footer']) {
      expect(checkbox(k).checked, `A 的 ${k} 默认勾选`).toBe(true);
    }
    expect(selectorPanel()!.textContent, '选择器写明不可摘的原因（§2.6 纪律 1）').toContain(
      '由该模板的刊头承载项目名与页序，属版式构件',
    );
    expect(
      selectorPanel()!.textContent,
      '状态用「当前不可摘」而不是「永不」（决策 5：将来会开放勾选）',
    ).toContain('该模板当前不可摘');
    // 五块的纸面标识（每页都是五块形态的页壳）
    expect(
      Array.from(document.querySelectorAll('.a4-page')).map((el) => el.getAttribute('data-print-page')),
    ).toEqual(['blocks', 'blocks']);

    // 切 D：**五块形态**（2026-10-13 批 B · 决策 1）。本夹具 8 阶段 **无 StageLog**
    // ⇒ L3 改期记录不出 ⇒ 紧凑档 8 行正好一页（带一条改期记录时同规模是 2 页，
    // 见 print-a4-visual-d 的「决策 6」与页数表用例）
    pickTemplate('data-editorial');
    expect(paperRoot()!.className).toContain('print-template-data-editorial');
    expect(document.querySelectorAll('.a4-page')).toHaveLength(1);
    expect(bodyContains('预计 1 页')).toBe(true);
    expect(printButton()!.disabled, 'D 版可打印').toBe(false);
    // 中截 = 五块清单：4 行可勾（B1「打印头部」由刊头承担 ⇒ 不可摘、不进清单）
    expect(document.querySelectorAll('input[data-print-block]')).toHaveLength(4);
    expect(document.querySelector('input[data-print-block="header"]'), 'D 的 B1 不进清单').toBeNull();
    expect(
      document.querySelector('[data-print-module-row]'),
      '批 B 后 D 的选择器中截不再是 11 个内容模块（决策 1）',
    ).toBeNull();
    for (const k of ['timeline', 'projectInfo', 'stageTable', 'footer']) {
      expect(checkbox(k).checked, `D 的 ${k} 默认勾选`).toBe(true);
    }
    expect(selectorPanel()!.textContent, 'D 也写明不可摘的原因与版式差异').toContain(
      '由该模板的刊头承载项目名与页序，属版式构件',
    );
    // 纸面：五块形态的标识 + 巨字标题（固定类型词）+ B2 日期格矩阵 + B4 两段式清单
    const dText = paperRoot()!.textContent ?? '';
    expect(document.querySelector('.a4-page')!.getAttribute('data-print-page')).toBe('blocks');
    expect(dText, 'D 的巨字标题 = 固定类型词（§1.2 B1 乙项）').toContain('排期报告');
    expect(document.querySelector('.de-mx'), 'B2 日期格矩阵在纸面上').not.toBeNull();
    expect(document.querySelector('.de-mx__cell'), '矩阵有格').not.toBeNull();
    expect(document.querySelector('.de-row'), 'B4 两段式清单在纸面上').not.toBeNull();
    expect(dText, '口径注恒在（§2.6 原则 1）').toContain('占比=ratioPercent≠完成度');
    expect(dText, '每页的完成度横带装置（丙）').toContain('项目完成度');

    // 切 E：默认 = 3 原生签名页（M2 任务清单是通用渲染，默认不勾）
    pickTemplate('editorial-index');
    expect(paperRoot()!.className).toContain('print-template-editorial-index');
    expect(document.querySelectorAll('.a4-page')).toHaveLength(3);
    expect(bodyContains('预计 3 页')).toBe(true);
    expect(printButton()!.disabled, 'E 版可打印').toBe(false);
    expect(moduleCheckbox('task-list').checked, 'E 的 task-list 默认不勾（通用渲染）').toBe(false);
    const eText = paperRoot()!.textContent ?? '';
    for (const title of ['阶段目录', '成员执行体目录', '产出物清单']) {
      expect(eText, `E 版纸面应含页题「${title}」`).toContain(title);
    }
    // 本夹具任务无产出物 ⇒ P3 走标准空态（02 §8 文案，不造数据填版）
    expect(
      document.querySelector('[data-print-empty="artifacts"]'),
      'E P3 无产出物 ⇒ 明确空态',
    ).not.toBeNull();
    // 未上传 logo ⇒ 每页左上角发丝线下方是「ID Plan」文字标（不留空）
    const eLogos = document.querySelectorAll('.a4-page [data-print-logo="text"]');
    expect(eLogos.length, 'E 三页各一枚文字标').toBe(3);
    expect((eLogos[0]!.textContent ?? '').trim()).toBe('ID Plan');
    // 手动勾 M2 ⇒ 通用任务清单页上纸（期三通用渲染在 E 的落地）
    setModuleChecked('task-list', true);
    expect(document.querySelectorAll('.a4-page')).toHaveLength(4);
    expect(paperRoot()!.textContent, 'E 版纸面应含通用页题「任务清单」').toContain('任务清单');
    setModuleChecked('task-list', false);

    // 切 H：默认 = 3 **人类原生海报页**（阶段 / 任务 / 成员；2026-10-11 人类化批次）。
    // 上一代的「无 Agent 数据 ⇒ 整版只读空态」已作废：H 三页现在打人类内容，
    // 有没有 Agent 执行数据都与纸面无关（Agent 治理载荷整体下纸，规格 §1.3）。
    pickTemplate('agent-poster');
    expect(paperRoot()!.className).toContain('print-template-agent-poster');
    expect(printButton()!.disabled, 'H 版可打印').toBe(false);
    // 本夹具 8 阶段 / 8 任务都超单页原生容量 ⇒ 分页（页面数由数据驱动，
    // 不再写死 3 页）：阶段海报 2 页 + 任务海报 2 页 + 成员海报 1 页 = 5 页。
    const hKinds = Array.from(document.querySelectorAll('.a4-page')).map((el) =>
      el.getAttribute('data-print-page'),
    );
    expect(hKinds[0], 'H 默认首页 = 阶段海报').toBe('stage-overview');
    expect(new Set(hKinds), 'H 默认纸面只落人类三页 kind（Agent 治理页已下架）').toEqual(
      new Set(['stage-overview', 'task-register', 'member-roster']),
    );
    expect(hKinds).toContain('task-register');
    expect(hKinds).toContain('member-roster');
    expect(hKinds, '续页仍是同 kind（页眉出「（续）」），不上别的页').toHaveLength(5);
    expect(bodyContains('预计 5 页'), '预计页数 = 物理页数（分页后一致）').toBe(true);
    const hText = paperRoot()!.textContent ?? '';
    // 页眉左 = `ID PLAN · {英文页题}`（中文页题按规格移出页眉，只在续页出「（续）」页题）
    for (const kicker of ['ID PLAN · STAGE POSTER', 'ID PLAN · TASK POSTER', 'ID PLAN · MEMBER POSTER']) {
      expect(hText, `H 版页眉应含「${kicker}」`).toContain(kicker);
    }
    expect(hText, '续页页眉出「（续）」小页题').toContain('（续）');
    // Agent 载荷整体下纸（本夹具项目里确实有执行数据，纸面一个字都不许出现）
    for (const dead of ['执行宣告', '写回提案', 'runId', 'confidence', '白名单']) {
      expect(hText, `Agent 载荷「${dead}」不得再上纸`).not.toContain(dead);
    }
    // 人类内容照常上纸：不出「暂无执行数据」整版空态，巨字装置在位
    expect(document.querySelectorAll('[data-print-empty="agent"]')).toHaveLength(0);
    expect(document.querySelector('.ap-giant'), '页顶出血巨字（人类化后载荷 = 品牌词）').not.toBeNull();
    expect(document.querySelector('.ap-block'), '阶段块上纸').not.toBeNull();
  });

  it('⑥【新】五块勾选（A）：逐块可摘 = 纸面精确减掉一个可见区 + 页码/预计页数联动', async () => {
    renderDialog(true);
    openBlocksPanel();
    pickTemplate('swiss-schedule');
    // 默认四行全勾（B1 不可摘、不进清单）
    for (const k of ['timeline', 'projectInfo', 'stageTable', 'footer']) {
      expect(checkbox(k).checked, `${k} 默认应勾选`).toBe(true);
    }
    expect(document.querySelectorAll('.a4-page')).toHaveLength(2);

    // ── 决策 6：取消勾一块 = 纸面上精确减掉一个可见区（逐块巡检）──
    // ① 摘 B2 打印时间轴 ⇒ 甘特整块消失，其余不动
    setBlockChecked('timeline', false);
    expect(paperRoot()!.querySelector('.print-gantt'), 'B2 摘掉 ⇒ 甘特整块消失').toBeNull();
    expect(paperRoot()!.textContent, '其余块不动：B4 阶段卡仍在').toContain('阶段1');
    expect(paperRoot()!.textContent, 'B3 项目信息仍在').toContain('排期基准');
    expect(paperRoot()!.textContent, '口径注不随 B3 消失（§2.6）').toContain('阶段四态');
    setBlockChecked('timeline', true);
    expect(paperRoot()!.querySelector('.print-gantt'), '勾回 ⇒ 甘特回来').not.toBeNull();

    // ② 摘 B3 项目信息 ⇒ 承载区（排期基准行 + 休息制度块）消失，**口径注留下**
    setBlockChecked('projectInfo', false);
    expect(paperRoot()!.textContent, 'B3 摘掉 ⇒ 排期基准消失').not.toContain('排期基准');
    expect(paperRoot()!.textContent, '休息制度黑块随 B3 消失').not.toContain('休息制度');
    expect(paperRoot()!.textContent, '口径注锚回（原则 1）').toContain('阶段四态');
    setBlockChecked('projectInfo', true);
    expect(paperRoot()!.textContent, '勾回 ⇒ 排期基准回来').toContain('排期基准');

    // ③ 摘 B5 页脚 ⇒ 只摘「数据来源行」；黑底栏装置（署名 + 页码）永在
    setBlockChecked('footer', false);
    expect(paperRoot()!.textContent, 'B5 摘掉 ⇒ 数据来源行消失').not.toContain('数据来源');
    expect(paperRoot()!.textContent, '黑底栏装置仍在（§2.6 A·B5 = 甲）').toContain(
      'ID Plan · 项目排期与交付管理',
    );
    expect(document.body.textContent, '页码永在（原则 1）').toContain('第 1 / 2 页');
    setBlockChecked('footer', true);
    expect(paperRoot()!.textContent, '勾回 ⇒ 数据来源行回来').toContain('数据来源');

    // ④ 摘 B4 阶段清单 ⇒ 整块（含 L3 改期记录）消失 + 页码/预计页数联动到 1 页
    //    （首页只剩 B1+B2+B3；B4 是唯一跨页块 ⇒ 页数 2 → 1）
    setBlockChecked('stageTable', false);
    expect(paperRoot()!.querySelector('.swiss-stage-row'), 'B4 摘掉 ⇒ 阶段卡消失').toBeNull();
    expect(paperRoot()!.querySelector('.swiss-resched'), '附属件随 B4 一起不出（§0.5）').toBeNull();
    expect(document.querySelectorAll('.a4-page')).toHaveLength(1);
    expect(bodyContains('预计 1 页')).toBe(true);
    expect(document.body.textContent, '页码随页数重排').toContain('第 1 / 1 页');
    setBlockChecked('stageTable', true);
    expect(document.querySelectorAll('.a4-page')).toHaveLength(2);

    // 反选 / 全选（模块清单那两个按钮不属于五块清单 ⇒ 五块清单没有它们）
    expect(document.querySelector('[data-print-modules-none]'), '五块清单无模块按钮').toBeNull();
    expect(document.querySelector('[data-print-modules-all]')).toBeNull();
    // 落库形状：units[template]（正主），旧键三件不动
    await flush();
    const raw = localStorage.getItem(PRINT_PREFS_STORAGE_KEY);
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state.units).toEqual({
      'swiss-schedule': [
        'header',
        'timeline',
        'projectInfo',
        'stageTable',
        'footer',
        'swiss-topbar',
        'swiss-percent',
        'swiss-bottombar',
      ],
    });
    expect(parsed.state).toHaveProperty('blocks');
    expect(parsed.state).toHaveProperty('modules');
  });

  it('⑦【新】配色硬闸门：不达标禁存（store 一个字节都不落库）；达标才落', async () => {
    renderDialog(true);
    openBlocksPanel();
    pickTemplate('swiss-schedule');

    // 踩线组合：浅黄纸 + 白字 + 白栏 ⇒ 三对全挂
    const bad = { accent: '#FFF8E1', ink: '#FFFFFF', line: '#FFFFFF' };
    let gate = usePrintPrefsStore.getState().setPalette('swiss-schedule', bad);
    expect(gate.ok, '硬闸门必须拒绝').toBe(false);
    expect(gate.message).toContain('栏内反白字 vs 栏底');
    expect(usePrintPrefsStore.getState().palette['swiss-schedule'], '禁存 ⇒ 不落库').toBeUndefined();

    // 达标组合（预设变体）：落库 + 进纸面 CSS 变量
    const preset = { accent: '#16324F', ink: '#F2D957', line: '#F2D957' };
    let ok = usePrintPrefsStore.getState().setPalette('swiss-schedule', preset);
    expect(ok.ok).toBe(true);
    await flush();
    expect(usePrintPrefsStore.getState().palette['swiss-schedule']).toEqual(preset);
    let style = paperRoot()!.getAttribute('style') ?? '';
    expect(style, '自定义色经 .print-root inline 变量进纸面').toContain('--tpl-accent: #16324F');

    // 恢复基线 = 删键（包 act：store 变更要触发重渲染才看得到纸面变化）
    act(() => {
      usePrintPrefsStore.getState().setPalette('swiss-schedule', null);
    });
    expect(usePrintPrefsStore.getState().palette['swiss-schedule']).toBeUndefined();
    expect(paperRoot()!.getAttribute('style')).toContain('--tpl-accent: #F2D957');
  });

  it('⑧【新】灰度 toggle：纸面 wrapper 套 grayscale(1)（chrome 不灰度）', () => {
    renderDialog(true);
    expect(document.querySelector('[data-print-grayscale="on"]')).toBeNull();
    clickButton('灰度');
    const wrapper = document.querySelector('[data-print-grayscale="on"]');
    expect(wrapper).not.toBeNull();
    expect((wrapper as HTMLElement).style.filter).toBe('grayscale(1)');
    clickButton('灰度');
    expect(document.querySelector('[data-print-grayscale="on"]')).toBeNull();
  });
});

/* ====================================================================================
 * L2 · 静态源码锁 + 纯函数契约
 * ==================================================================================== */

describe('打印内容自定义 + 模板选择 · L2 静态锁与纯函数契约', () => {
  const ROOT = resolve(__dirname, '..');
  const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

  it('print-templates.ts：模板注册表 / 静态类映射在位，禁止模板拼类名；legacy 皮肤出口保留', () => {
    const src = read('src/components/print/print-templates.ts');
    // 类型契约住在 src/print/model（02 §2），注册表再导出（消费方一处取）
    expect(src).toContain('export type { PrintPageKind, PrintTemplateId }');
    expect(src).toContain('export const PRINT_TEMPLATES');
    expect(src).toContain('export function printTemplateClass');
    expect(src).toContain('print-skin-default');
    // 期二：模块能力表（外表 × 模块分离，决策文档 §3.2/§3.3）
    expect(src).toContain('export const PRINT_MODULES');
    expect(src).toContain('export function enabledPagesOf');
    expect(src).toContain('export function pageKindToModule');
    expect(src).toContain('PAGE_TO_MODULE');
    // 默认态收敛（她 10-09 23:38 反馈）：缺键兜底 = 原生签名页
    expect(src).toContain('export function printTemplateDefaultModuleIds');
    // 静态映射纪律（同 stageColors）：整个文件不允许出现模板字符串
    expect(src, '禁止模板字符串拼类名（Tailwind JIT 看不见动态串）').not.toContain('${');
    // legacy 出口（SchedulePaper 主体仍消费，未碰）
    expect(printSkinClass('default')).toBe('print-skin-default');
    expect(printSkinClass('compact' as PrintSkinId), '未知 id 回落 default').toBe(
      'print-skin-default',
    );
    // 模板类映射：四版 print-template-<id>（02 §5）；classic 冻结为既有类
    expect(printTemplateClass('swiss-schedule')).toBe('print-template-swiss-schedule');
    expect(printTemplateClass('data-editorial')).toBe('print-template-data-editorial');
    expect(printTemplateClass('editorial-index')).toBe('print-template-editorial-index');
    expect(printTemplateClass('agent-poster')).toBe('print-template-agent-poster');
    expect(printTemplateClass('classic'), 'classic 类名冻结（DOM 被既有 spec 钉死）').toBe(
      'print-skin-default',
    );
    expect(printTemplateClass('nope' as PrintTemplateId), '未知 id 回落 classic').toBe(
      'print-skin-default',
    );
  });

  it('SchedulePaper.tsx：既有选择器一个没删 + 五块条件渲染 + 皮肤类接入 + 无裸 hex', () => {
    const paper = read('src/components/print/SchedulePaper.tsx');
    for (const sel of [
      'print-root',
      'a4-page',
      'schedule-bar-segment',
      'schedule-status-dot',
      'schedule-table',
      'data-print-month-tick',
      'data-tick-left',
    ]) {
      expect(paper, `SchedulePaper 缺选择器 ${sel}`).toContain(sel);
    }
    expect(paper).toContain('printSkinClass');
    for (const key of BLOCK_KEYS) {
      expect(paper, `缺 blocks.${key} 条件渲染`).toContain(`blocks.${key}`);
    }
    expect(paper).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('PrintPreviewDialog.tsx：复用 Modal 体系（center 档 + zTier 78）+ 模板/模块/配色三截接线', () => {
    const src = read('src/components/print/PrintPreviewDialog.tsx');
    expect(src, '必须复用既有 Modal 体系（center 档），不许发明新浮层').toContain(
      'placement="center"',
    );
    // 期六：选择器弹窗盖 fullscreen 预览（z-[75]）又低于 toast（z-[80]）⇒ 78 档
    expect(src, '选择器弹窗必须用 78 档盖住预览浮层').toContain('zTier={78}');
    expect(src).toContain('data-print-block');
    expect(src).toContain('data-print-template-option');
    // 期二：中截页勾选 → 模块勾选（data-print-page 是纸面页 kind 属性，
    // 在四个 Document 组件上，不在本文件）
    expect(src).toContain('data-print-module');
    expect(src).toContain('PrintModuleSection');
    expect(src).toContain('PrintSelectorPanel');
    expect(src).toContain('data-print-selector-panel');
    // 期六：真缩略图（四张由她提供，落 public/print-thumbs/）
    expect(src).toContain('data-print-template-thumb');
    expect(src).toContain('data-print-grayscale-toggle');
    expect(src).toContain('usePrintPrefsStore');
    expect(src, '勾选即时喂给纸面').toContain('blocks={blocks}');
    // v2 适配：skin 由 store 的 template 派生，经典恒 default（SchedulePaper 主体不碰）
    expect(src).toContain('skin="default"');
    // A 版文档接入 + 配色截 + 建设中空态
    expect(src).toContain('SwissScheduleDocument');
    expect(src).toContain('PaletteSection');
    expect(src).toContain('data-print-template-building');
    expect(src).toContain('usePrintViewModel');
    // 期六退役：dropdown 锚定定位机制（selectorPos/panelHeight/resize 收起）应整体删掉
    expect(src, '居中弹窗不需要锚点定位').not.toContain('selectorPos');
    expect(src).not.toContain('panelHeight');
    expect(src).not.toContain('resolveSelectorPanelPos');
  });

  it('usePrintPrefsStore.ts：key / partialize / merge 兜底三件套 + 新字段', () => {
    const src = read('src/store/usePrintPrefsStore.ts');
    expect(src).toContain('changxia.printPrefs');
    expect(src).toContain('partialize');
    expect(src).toContain('merge:');
    // v2 增量：template / pages / palette 三字段 + 旧 skin 迁移 + 闸门
    expect(src).toContain('template');
    expect(src).toContain('pages');
    expect(src).toContain('palette');
    expect(src).toContain('legacySkinToTemplate');
    expect(src).toContain('checkPrintPalette');
    // 期二增量：pages 语义 = 模块勾选（PrintModuleId[]）+ 旧页 key 迁移
    expect(src).toContain('PrintModuleId');
    expect(src).toContain('setModuleEnabled');
    expect(src).toContain('pageKindToModule');
  });

  it('useSchedulePaperData.ts：分页随 blocks 走 paginateSections（时间轴关 ⇒ 首屏预算降）', () => {
    const src = read('src/components/print/useSchedulePaperData.ts');
    expect(src).toContain('paginateSections');
    // 分页第二参直接吃 blocks（时间轴勾选态），不再经 firstPageHeaderFor 中转
    expect(src).toContain('paginateSections(sections, blocks)');
  });

  it('paginateSections：实测校准口径（20 段 ⇒ 默认 2 页 4+16；关时间轴 ⇒ 1 页）', () => {
    // 2026-10-09 分页早断修复：每段 = 数据行一行（估高 37），可用高 972
    // （1123 − padding 118 − 页脚 33），表格 chrome 90。
    const sections: ScheduleSection[] = makeStages(20).map((_, i) => ({
      orderIndex: i + 1,
      name: `阶段${i + 1}`,
      startAt: '2026-01-05',
      endAt: '2026-01-20',
      status: StageStatus.InProgress,
      colorIndex: ((i) % 9) + 1,
      customColor: null,
      tasks: [
        {
          id: `t${i}`,
          title: `任务${i}`,
          dueDate: null,
          done: false,
          assigneeNames: [],
        },
      ],
    }));
    // 默认（时间轴在）：20 段触发时间轴紧凑档（≥20）⇒ 首屏预留
    // 213 + 20×26 = 733 ⇒ 首屏限 149 ⇒ 4 行；次页起 882 ⇒ 23 行
    const pagesDefault = paginateSections(sections);
    expect(pagesDefault[0]!.length, '默认首屏限 149 ⇒ 首页 4 段').toBe(4);
    expect(pagesDefault.length, '20 = 4+16 ⇒ 2 页（旧口径 5+7+7+1 = 4 页）').toBe(2);
    expect(pagesDefault[1]!.length, '第二页装剩余 16 段').toBe(16);
    // 行不裂：总行数守恒
    expect(pagesDefault.reduce((n, p) => n + p.length, 0), '20 段全部上纸').toBe(20);
    // 关时间轴：首屏预留 103 ⇒ 首屏限 779 ⇒ 21 行 ⇒ 20 段一页
    const pagesNoTimeline = paginateSections(sections, { ...DEFAULT_SCHEDULE_PAPER_BLOCKS, timeline: false });
    expect(pagesNoTimeline.length, '关时间轴首屏限 779 ⇒ 20 段一页').toBe(1);
    // 推导函数：时间轴在 ⇒ 213 + 段数×轨道行距（紧凑档 26 / 正常档 37）；
    // 关 ⇒ 103。20 段起走紧凑档（与 SchedulePaper 的 CSS 档同源）
    expect(firstPageHeaderFor(undefined, 8), '8 段（正常档）：213 + 8×37').toBe(509);
    expect(firstPageHeaderFor(DEFAULT_SCHEDULE_PAPER_BLOCKS, 20), '20 段（紧凑档）：213 + 20×26').toBe(733);
    expect(firstPageHeaderFor({ ...DEFAULT_SCHEDULE_PAPER_BLOCKS, timeline: false }, 8), '关时间轴：66+37').toBe(103);
  });
});
