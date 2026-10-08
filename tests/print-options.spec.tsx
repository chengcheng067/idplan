// @vitest-environment jsdom
/**
 * 打印内容自定义 + 皮肤预留（v0.8.6.0002 · 反馈 #9.2 / #9.3）验收。
 *
 * 她的原话：
 *   ② 打印内容自定义：「希望给用户提供打印内容的选项，将选择权交给用户。
 *      例如：具体要打印哪些内容、时间轴是否作为可选打印项，以及其他相关选择。」
 *   ③ 预留皮肤功能：「预留打印日程表的皮肤功能，以便日后推出更多皮肤。」
 *
 * ── 本 spec 锁的四件事（L1 行为，主力层）──
 *   ① 默认五块全在（未传偏好 = 视觉零变化），.print-root 挂 default 皮肤类；
 *   ② 关「打印时间轴」⇒ 该 section 消失、`.schedule-table` 仍在、**第一页不留
 *      半白**（分页预留 210→92 ⇒ 首页 5 段变 6 段，纯函数口径见 L2 组）；
 *   ③ 其余四块逐块可摘：摘谁谁消失，没摘的不动；
 *   ④ 勾选写 localStorage（`changxia.printPrefs`），重 hydrate / 卸载重开
 *      仍是用户选的；脏数据（缺块键 / 未知 skin）merge 兜底回落默认而不是
 *      静默少打一块。
 * L2（静态源码锁 + paginateSections 纯函数契约）见文件末组。
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
import { printSkinClass, type PrintSkinId } from '../src/components/print/print-skins';
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

/** 打开勾选面板（幂等：已开则不动） */
function openBlocksPanel(): void {
  if (blocksPanel()) return;
  clickButton('打印内容');
  expect(blocksPanel(), '点「打印内容」后勾选面板应出现').not.toBeNull();
}

function checkbox(key: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[data-print-block="${key}"]`);
  if (!el) throw new Error(`找不到勾选框：${key}`);
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

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
  // 每例从「默认全开 / default 皮肤」起手（含把 persist 的异步写排空，避免污染后续手动写的脏数据）
  await act(async () => {
    usePrintPrefsStore.setState({ blocks: { ...DEFAULT_SCHEDULE_PAPER_BLOCKS }, skin: 'default' });
    await Promise.resolve();
    await Promise.resolve();
  });
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

describe('打印内容自定义 + 皮肤预留 · L1 行为（真实纸面）', () => {
  it('① 默认五块全在（未传偏好 ⇒ 视觉零变化），.print-root 挂 default 皮肤类', () => {
    renderDialog(false);
    expect(paperRoot(), '关闭态不应渲染纸面').toBeNull();

    renderDialog(true);
    expect(paperRoot(), '打开后纸面上屏').not.toBeNull();
    expect(paperRoot()!.className, 'default 皮肤类必须挂上（v1 无 CSS 规则，仅可观测）').toContain(
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

    // 打开勾选面板：五块默认全选
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
      await act(async () => {
        usePrintPrefsStore.setState({ blocks: { ...DEFAULT_SCHEDULE_PAPER_BLOCKS }, skin: 'default' });
        await Promise.resolve();
      });
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

  it('④ 勾选写 localStorage；重 hydrate / 卸载重开仍是用户选的；脏数据 merge 兜底', async () => {
    renderDialog(true);
    openBlocksPanel();
    setBlockChecked('timeline', false);

    // 写路径：persist 落库
    await flush();
    const raw = localStorage.getItem(PRINT_PREFS_STORAGE_KEY);
    expect(raw, '勾选应写入 localStorage').not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      state: { blocks: Record<string, boolean>; skin: string };
      version: number;
    };
    expect(parsed.version).toBe(0);
    expect(parsed.state.blocks.timeline, '被摘的块落库为 false').toBe(false);
    expect(parsed.state.blocks.header, '没动的块落库为 true').toBe(true);
    expect(parsed.state.skin).toBe('default');

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

    // 脏数据：缺四个块键的 blocks + 未知 skin ⇒ merge 兜底（缺键 = 回落默认，而不是静默少块）。
    // 先把 store 复位到默认（= 老版本数据 + 新版本首启的内存态），再让 hydrate 读旧持久值。
    await act(async () => {
      usePrintPrefsStore.setState({ blocks: { ...DEFAULT_SCHEDULE_PAPER_BLOCKS }, skin: 'default' });
      await Promise.resolve();
      await Promise.resolve();
    });
    localStorage.setItem(
      PRINT_PREFS_STORAGE_KEY,
      JSON.stringify({ state: { blocks: { header: false }, skin: 'compact-x' }, version: 0 }),
    );
    await rehydratePrefs();
    expect(usePrintPrefsStore.getState().blocks, '缺键回落默认全开').toEqual({
      header: false,
      timeline: true,
      projectInfo: true,
      stageTable: true,
      footer: true,
    });
    expect(usePrintPrefsStore.getState().skin, '未知 skin 回落 default').toBe('default');
  });
});

/* ====================================================================================
 * L2 · 静态源码锁 + 纯函数契约
 * ==================================================================================== */

describe('打印内容自定义 + 皮肤预留 · L2 静态锁与纯函数契约', () => {
  const ROOT = resolve(__dirname, '..');
  const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

  it('print-skins.ts：注册表 / 静态类映射在位，禁止模板拼类名', () => {
    const src = read('src/components/print/print-skins.ts');
    expect(src).toContain('export type PrintSkinId');
    expect(src).toContain('export const PRINT_SKINS');
    expect(src).toContain('export function printSkinClass');
    expect(src).toContain('print-skin-default');
    // 静态映射纪律（同 stageColors）：整个文件不允许出现模板字符串
    expect(src, '禁止模板字符串拼类名（Tailwind JIT 看不见动态串）').not.toContain('${');
    expect(printSkinClass('default')).toBe('print-skin-default');
    expect(printSkinClass('compact' as PrintSkinId), '未知 id 回落 default').toBe(
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

  it('PrintPreviewDialog.tsx：复用 Modal dropdown 档 + 勾选即时生效接线', () => {
    const src = read('src/components/print/PrintPreviewDialog.tsx');
    expect(src, '必须复用既有 Modal 体系（dropdown 档），不许发明新浮层').toContain(
      'placement="dropdown"',
    );
    expect(src).toContain('data-print-block');
    expect(src).toContain('usePrintPrefsStore');
    expect(src, '勾选即时喂给纸面').toContain('blocks={blocks}');
    expect(src).toContain('skin={skin}');
  });

  it('usePrintPrefsStore.ts：key / partialize / merge 兜底三件套', () => {
    const src = read('src/store/usePrintPrefsStore.ts');
    expect(src).toContain('changxia.printPrefs');
    expect(src).toContain('partialize');
    expect(src).toContain('merge:');
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
