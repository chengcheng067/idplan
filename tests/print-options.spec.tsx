// @vitest-environment jsdom
/**
 * 打印内容自定义 + 皮肤预留（v0.8.6.0002 · 反馈 #9.2 / #9.3）验收，
 * 四版模板重建（产品决策文档 §2.1/§2.2/§3.2）后适配。
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
 *   ⑥【新】页面勾选：四版默认全选、可摘单页、页码/预计页数联动；
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
 *           不碰，classic 恒default 皮肤；print-skins.ts 锁增补模板注册表断言）。
 *   **未动**：五块开关的 data-print-block 契约、经典纸面全部行为断言、
 *   paginateSections 纯函数口径、`.print-root` 挂类断言（classic 类名冻结）。
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
  FIRST_PAGE_HEADER_NO_TIMELINE,
  firstPageHeaderFor,
  paginateSections,
  type ScheduleSection,
} from '../src/lib/schedule-print';
import {
  printSkinClass,
  printTemplateClass,
  type PrintSkinId,
  type PrintTemplateId,
} from '../src/components/print/print-skins';
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
 * 8 段 × 每段 1 任务 ⇒ 每段估算高 122px（52+46+24），可用高 929：
 *   · 默认（时间轴在，首屏限 719）⇒ 首页 5 段（6×122=732 > 719）
 *   · 关时间轴（首屏限 929−92=837）⇒ 首页 6 段（7×122=854 > 837）
 * 两档页数都是 2 ⇒ 「页数合理」不变量不被本夹具破坏，只有首页段数变。
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
      pages: {},
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

function blocksPanel(): HTMLElement | null {
  return document.querySelector('[data-print-blocks-panel]');
}

/** 打开下拉面板（幂等：已开则不动） */
function openBlocksPanel(): void {
  if (blocksPanel()) return;
  clickButton('模板与页面');
  expect(blocksPanel(), '点「模板与页面」后下拉面板应出现').not.toBeNull();
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

function pageCheckbox(page: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[data-print-page="${page}"]`);
  if (!el) throw new Error(`找不到页勾选框：${page}`);
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

/** 勾 / 取消一页（幂等） */
function setPageChecked(page: string, on: boolean): void {
  const el = pageCheckbox(page);
  if (el.checked !== on) {
    act(() => {
      el.click();
    });
  }
  expect(pageCheckbox(page).checked, `勾选页 ${page} 后期望 ${on}`).toBe(on);
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
    expect(firstPageRows(), '母本分页口径：首屏限 929−210=719 ⇒ 首页 5 段').toBe(5);
    expect(bodyContains('预计 2 页'), '工具条页数文案随分页').toBe(true);

    // 打开下拉面板：五块默认全选
    openBlocksPanel();
    for (const key of BLOCK_KEYS) {
      expect(checkbox(key).checked, `${key} 默认应勾选`).toBe(true);
    }
  });

  it('② 关「打印时间轴」⇒ 甘特消失、清单还在、第一页不留半白（首页 5 段变 6 段）', () => {
    renderDialog(true);
    expect(h2Texts(), '前置：时间轴在').toContain('打印时间轴');
    expect(firstPageRows(), '前置：默认首页 5 段').toBe(5);

    openBlocksPanel();
    setBlockChecked('timeline', false);

    expect(h2Texts(), '时间轴摘掉 ⇒ 不得再有该 h2').not.toContain('打印时间轴');
    expect(h2Texts(), '阶段清单没摘 ⇒ 仍在').toContain('阶段清单');
    expect(firstPageTable(), '阶段清单表仍在').not.toBeNull();
    expect(containsText('打印日期'), '头部没摘 ⇒ 仍在').toBe(true);
    expect(containsText('排期基准'), '项目信息没摘 ⇒ 仍在').toBe(true);
    expect(
      firstPageRows(),
      '第一页预留 210→92 ⇒ 首屏限 837 ⇒ 首页 6 段（不是母本的 5 段 = 半白锁）',
    ).toBe(6);
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
    expect(firstPageRows(), '重开后仍按 92 预留分页').toBe(6);

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

    // 切 A：纸面换成 A 版四页 + 模板类
    pickTemplate('swiss-schedule');
    const rootEl = paperRoot()!;
    expect(rootEl.className).toContain('print-template-swiss-schedule');
    expect(document.querySelectorAll('.a4-page')).toHaveLength(4);
    expect(bodyContains('预计 4 页')).toBe(true);
    expect(printButton()!.disabled, 'A 版可打印').toBe(false);

    // 切 D：D 版四页落地（批 2），纸面 4 页 + 模板类 + 可打印
    pickTemplate('data-editorial');
    expect(paperRoot()!.className).toContain('print-template-data-editorial');
    expect(document.querySelectorAll('.a4-page')).toHaveLength(4);
    expect(bodyContains('预计 4 页')).toBe(true);
    expect(printButton()!.disabled, 'D 版可打印').toBe(false);
    // 四页标题（完整单行中文）与关键内容在纸面上
    const dText = paperRoot()!.textContent ?? '';
    for (const title of ['阶段进度矩阵', '任务依赖网络', '阶段工作量构成', '里程碑与验收']) {
      expect(dText, `D 版纸面应含页题「${title}」`).toContain(title);
    }
    expect(dText).toContain('占比不等于完成度');
    // 本夹具 8 任务 dependsOn 全空 ⇒ 依赖网络走「无依赖」空态 + 节点摘要
    expect(document.querySelector('[data-print-empty="dependencies"]'), '无依赖空态').not.toBeNull();

    // 切 E：三页落地（批 3）⇒ 纸面 3 页 + 模板类 + 可打印
    pickTemplate('editorial-index');
    expect(paperRoot()!.className).toContain('print-template-editorial-index');
    expect(document.querySelectorAll('.a4-page')).toHaveLength(3);
    expect(bodyContains('预计 3 页')).toBe(true);
    expect(printButton()!.disabled, 'E 版可打印').toBe(false);
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

    // 切 H：三页落地（批 4）；本夹具无 Agent 数据 ⇒ 整版只读空态（不许假装有执行）
    pickTemplate('agent-poster');
    expect(paperRoot()!.className).toContain('print-template-agent-poster');
    expect(document.querySelectorAll('.a4-page')).toHaveLength(3);
    expect(bodyContains('预计 3 页')).toBe(true);
    expect(printButton()!.disabled, 'H 版可打印').toBe(false);
    const hEmpty = document.querySelectorAll('[data-print-empty="agent"]');
    expect(hEmpty.length, '无 Agent 数据 ⇒ 三页整版只读空态').toBe(3);
    expect(paperRoot()!.textContent).toContain('当前项目暂无 Agent 执行数据');
    // 空态下不许出现任何执行状态卡（不拿模拟记录填版）
    expect(document.querySelector('[data-testid="ap-status-columns"]')).toBeNull();
    expect(document.querySelector('.ap-giant')).toBeNull();
  });

  it('⑥【新】页面勾选：四版默认全选、可摘单页、页码/预计页数联动', () => {
    renderDialog(true);
    openBlocksPanel();
    pickTemplate('swiss-schedule');
    // 默认全选（01 §8）
    for (const p of ['stage-overview', 'task-register', 'delay-ledger', 'member-roster']) {
      expect(pageCheckbox(p).checked, `${p} 默认应勾选`).toBe(true);
    }
    // 摘一页 ⇒ 纸面 3 页 + 页码重排 + 预计联动
    setPageChecked('task-register', false);
    expect(document.querySelectorAll('.a4-page')).toHaveLength(3);
    expect(bodyContains('预计 3 页')).toBe(true);
    expect(document.querySelector('.a4-page')!.getAttribute('data-print-page')).toBe('stage-overview');
    expect(document.body.textContent).toContain('第 1 / 3 页');

    // 反选 ⇒ 0 页；全选 ⇒ 回 4 页
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-print-pages-none]')!.click();
    });
    expect(document.querySelectorAll('.a4-page')).toHaveLength(0);
    expect(bodyContains('预计 0 页')).toBe(true);
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-print-pages-all]')!.click();
    });
    expect(document.querySelectorAll('.a4-page')).toHaveLength(4);
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

  it('print-skins.ts：模板注册表 / 静态类映射在位，禁止模板拼类名；legacy 皮肤出口保留', () => {
    const src = read('src/components/print/print-skins.ts');
    // 类型契约住在 src/print/model（02 §2），注册表再导出（消费方一处取）
    expect(src).toContain('export type { PrintPageKind, PrintTemplateId }');
    expect(src).toContain('export const PRINT_TEMPLATES');
    expect(src).toContain('export function printTemplateClass');
    expect(src).toContain('print-skin-default');
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

  it('PrintPreviewDialog.tsx：复用 Modal dropdown 档 + 模板/页面/配色三截接线', () => {
    const src = read('src/components/print/PrintPreviewDialog.tsx');
    expect(src, '必须复用既有 Modal 体系（dropdown 档），不许发明新浮层').toContain(
      'placement="dropdown"',
    );
    expect(src).toContain('data-print-block');
    expect(src).toContain('data-print-template-option');
    expect(src).toContain('data-print-page');
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
  });

  it('useSchedulePaperData.ts：分页随 blocks 走 firstPageHeaderFor', () => {
    const src = read('src/components/print/useSchedulePaperData.ts');
    expect(src).toContain('firstPageHeaderFor');
  });

  it('paginateSections 可选参：默认 = 母本 210（老调用方/A13 全绿）；关时间轴 ⇒ 92', () => {
    // 每段 1 任务 ⇒ 122px；可用高 929（A13 spec 的复算口径）
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
    // 老行为：719 ⇒ 首页 5 段（A13 期望 4 页：5/7/7/1）
    const pagesDefault = paginateSections(sections);
    expect(pagesDefault[0]!.length, '默认首屏限 719 ⇒ 首页 5 段').toBe(5);
    expect(pagesDefault.length, 'A13 复算：20 = 5+7+7+1 ⇒ 4 页').toBe(4);
    // 关时间轴：837 ⇒ 首页 6 段
    const pagesNoTimeline = paginateSections(sections, FIRST_PAGE_HEADER_NO_TIMELINE);
    expect(pagesNoTimeline[0]!.length, '关时间轴首屏限 837 ⇒ 首页 6 段').toBe(6);
    // 推导函数：缺省 / 时间轴在 ⇒ 210；关 ⇒ 92
    expect(firstPageHeaderFor(undefined)).toBe(210);
    expect(firstPageHeaderFor(null)).toBe(210);
    expect(firstPageHeaderFor(DEFAULT_SCHEDULE_PAPER_BLOCKS)).toBe(210);
    expect(firstPageHeaderFor({ ...DEFAULT_SCHEDULE_PAPER_BLOCKS, timeline: false })).toBe(
      FIRST_PAGE_HEADER_NO_TIMELINE,
    );
  });
});
