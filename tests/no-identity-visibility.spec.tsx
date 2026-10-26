// @vitest-environment jsdom
/**
 * 未进入身份 ⇒ 人类侧零可见（2026-10-27）。
 *
 * ═══════════════════════ 这一批在修什么（她的原话） ═══════════════════════
 *   「我退出了以后项目看板居然能显示本周到期任务，什么本周到期任务跟我有什么关系？」
 *   「项目周报在没有任何身份的情况下居然能看到项目周报，这个也是不合理完全不合理的地方。」
 *
 * 根因是**一个**，不是三个：`src/core/project/visibility.ts` 的漏斗只回答「人类侧还是
 * Agent 侧」（kind），**不回答「有没有人该看」**。于是 role=null（未进入 / 停用成员 /
 * 指向已删除 id）时 `useHumanProjects()` 照样吐全库 ⇒
 *   · 成员看板统计卡把**全库**阶段的「本周到期 / 本月完工」报给一个没有身份的人；
 *   · 周报插件列出全部项目（含客户名与逾期数）；
 *   · 侧栏仍列「项目周报」「我的任务」这些"要有身份才有意义"的入口。
 *
 * ═══════════════════════ 四条判据（本文件的四个 describe） ═══════════════════════
 *   A · 漏斗层：未进入 ⇒ `useHumanProjects/Stages/Tasks` 全空；进入 ⇒ **同一份 store**
 *       立刻恢复（不重载、不刷新）；**停用成员 / 悬挂 id 也算未进入**（最易漏的边界）。
 *   B · 成员看板统计卡：四个数只能由「观看对象的相关项目」派生。核心断言是
 *       **A 自己的本周到期=1、本月完工=1，而不是把 B 的那份也数进来（2/2）** ——
 *       这条能让"不收窄"的旧实现直接变红（见文件尾 §变异自证）。
 *   C · 侧栏：未进入 ⇒ 不渲染「我的任务」与插件 main 组入口；「看板」保留（他得有个地方点进去）。
 *   D · 插件页：**一行都没改**的 `WeeklyReportPanel` 在未进入时必须变空。
 *       这是「单一出口」的强信号 —— 它证明修的是漏斗，不是给每个页面打补丁。
 *
 * ═══════════════════════ 三档边界（别把「装载中」当「未进入」） ═══════════════════════
 *   `hydrated === false` 期间漏斗返回空，但页面**不得**据此渲染「请先选择身份」引导
 *   （那是 <DataGate> 的装载占位职责）。A-05 与 B-01 成对钉住这条：
 *   装载中 ⇒ 只有 DataGate 的 loading 面，没有引导语；已装载且未进入 ⇒ 才有引导语。
 *
 * 手法与仓库既有组件测同款（`tests/member-board-viewer.spec.tsx`）：React 18
 * `createRoot` + `act`，不引 testing-library；`useRepos` 在模块边界顶掉。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/* ProjectCard / 设置链读 Context（本文件没有 Provider 树）⇒ 模块边界顶掉。
   形状与 tests/member-board-viewer.spec.tsx 逐字同源，避免两处各写一份假仓库。 */
vi.mock('../src/hooks/useRepos', () => {
  const ok = async (): Promise<void> => undefined;
  const bundle = {
    projects: {
      list: async () => [],
      get: async () => null,
      insert: ok,
      update: ok,
      archive: ok,
      remove: ok,
    },
    stages: {
      listByProject: async () => [],
      get: async () => null,
      bulkInsert: ok,
      update: ok,
      reschedule: ok,
    },
    tasks: {
      list: async () => [],
      listByProject: async () => [],
      listByAssignee: async () => [],
      get: async () => null,
      bulkInsert: ok,
      insert: ok,
      update: ok,
      remove: ok,
      upsertByExternalId: async () => ({ created: 0, updated: 0 }),
      claim: ok,
    },
    members: {
      list: async () => [],
      get: async () => null,
      insert: ok,
      update: ok,
      verifyCredentials: async () => false,
    },
    logs: {
      appendStageLog: ok,
      listStageLogsByStage: async () => [],
      listStageLogsByProject: async () => [],
      appendAssignment: ok,
      listAssignmentsByTask: async () => [],
    },
    contracts: {
      insert: async () => null,
      get: async () => null,
      linkProject: ok,
      saveConfirmedPayload: ok,
      list: async () => [],
    },
    settings: { get: async () => null, set: ok, all: async () => [], replaceAll: ok },
  };
  return { useRepos: (): unknown => bundle };
});

/*
 * 插件注册表：本文件要验的是「侧栏 render 不 render 那几条入口」，不是注册表本身的实现。
 * 给一份**固定的** navItems（一枚 main 组 = 周报、一枚 agent 组），使 C 段的断言只受
 * 「isEntered」这一个变量影响。其余导出走 actual（`usePluginEnabled` 等仍是真的）。
 */
vi.mock('../src/core/plugin/PluginRegistryProvider', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/core/plugin/PluginRegistryProvider')>();
  return {
    ...actual,
    usePluginRegistry: () => ({
      manifests: [],
      enabledMap: { 'weekly-report': true, 'agent-board': true },
      enabledManifests: [],
      registryReady: true,
      routesFor: () => [],
      setPluginEnabled: async () => ({ ok: true }),
      reloadEnabled: async () => undefined,
      navItems: [
        { to: '/weekly-report', label: '项目周报', icon: 'fileText', group: 'main' },
        { to: '/agent', label: 'Agent 工作区', icon: 'bot', group: 'agent' },
      ],
    }),
  };
});

import { MemberBoardPage } from '../src/pages/MemberBoardPage';
import { SidebarNav } from '../src/components/layout/SidebarNav';
import { FirstRunGuide } from '../src/components/layout/FirstRunGuide';
import { WeeklyReportPanel } from '../src/plugins/weekly-report/WeeklyReportPanel';
import {
  useAgentProjects,
  useAgentStages,
  useAgentTasks,
  useHumanProjects,
  useHumanStages,
  useHumanTasks,
} from '../src/core/project/visibility';
import { ProjectDetailPage } from '../src/pages/ProjectDetailPage';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { CURRENT_MEMBER_ID_KEY } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage, Task } from '../src/core/types/entities';

/* ══════════════════════════════════════════════════════════════════════════════
 * 夹具
 *
 * 关键设计（B 段的核心断言靠它）：**两个成员各有一个"本周到期"阶段 + 一个"本月完工"阶段**。
 * 于是"只看自己"= 1/1，"看全库"= 2/2 —— 两种实现给出**不同**的数，断言才有判别力。
 * 若只放一个成员的数据，全库数与自己数会相等，那条断言就成了永远绿的摆设。
 * ══════════════════════════════════════════════════════════════════════════════ */

const ADMIN_ID = 'mem_admin';
const A_ID = 'mem_a';
const B_ID = 'mem_b';
const OFF_ID = 'mem_off';

const P_A = 'proj_a';
const P_B = 'proj_b';
const P_AGENT = 'proj_agent';
const P_A_NAME = '项目甲';
const P_B_NAME = '项目乙';
const P_AGENT_NAME = 'Agent 演示板';

/** 今天 ±N 天的本地时区 ISO 日（测试不写死日期，避免随时间腐化） */
function isoDaysFromToday(delta: number): string {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** 今天所在自然周内的一天（周一=0）——保证落在「本周到期」区间里 */
function isoThisWeek(): string {
  return isoDaysFromToday(0);
}

function makeMember(id: string, name: string, over: Partial<Member> = {}): Member {
  return {
    id,
    name,
    role: '协作',
    contact: null,
    avatarColor: '#88A293',
    active: true,
    roleKind: MemberRoleKind.Member,
    passwordHash: null,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    revision: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

function makeProject(id: string, name: string, over: Partial<Project> = {}): Project {
  return {
    id,
    name,
    address: '',
    clientName: `客户-${name}`,
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-10-01T00:00:00Z',
    plannedEndAt: '2026-12-31T23:59:59Z',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: null,
    kind: 'human',
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    ownerMemberId: null,
    ...over,
  };
}

function makeStage(
  id: string,
  projectId: string,
  orderIndex: number,
  over: Partial<Stage> = {},
): Stage {
  return {
    id,
    projectId,
    orderIndex,
    templateKey: null,
    colorIndex: orderIndex,
    customColor: null,
    name: `阶段${orderIndex}`,
    ratioPercent: 100,
    startAt: '2026-10-01T00:00:00Z',
    endAt: '2026-12-31T23:59:59Z',
    status: StageStatus.InProgress,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

function makeTask(id: string, title: string, over: Partial<Task> = {}): Task {
  return {
    id,
    taskNo: null,
    projectId: P_A,
    stageId: 'stg_a_week',
    title,
    done: false,
    assigneeId: null,
    assigneeIds: [],
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
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

interface Fixtures {
  members: Member[];
  projects: Project[];
  stages: Stage[];
  tasks: Task[];
}

function buildFixtures(): Fixtures {
  const week = `${isoThisWeek()}T12:00:00.000Z`;
  return {
    members: [
      makeMember(ADMIN_ID, '管理员甲', { roleKind: MemberRoleKind.Admin, role: '负责人' }),
      makeMember(A_ID, '成员甲'),
      makeMember(B_ID, '成员乙'),
      makeMember(OFF_ID, '已停用', { active: false }),
    ],
    projects: [
      makeProject(P_A, P_A_NAME),
      makeProject(P_B, P_B_NAME),
      /* Agent 侧同族夹具：未进入身份时它也一个字都不许出现（team-lead 裁决 1） */
      makeProject(P_AGENT, P_AGENT_NAME, { kind: 'agent' }),
    ],
    stages: [
      // 成员甲：一个本周到期的进行中阶段 + 一个本月完工
      makeStage('stg_a_week', P_A, 1, { ownerId: A_ID, endAt: week }),
      makeStage('stg_a_done', P_A, 2, {
        ownerId: A_ID,
        endAt: week,
        status: StageStatus.Completed,
      }),
      // 成员乙：同形的两份 —— 「不看库就收窄」的旧实现会把它们也算给甲
      makeStage('stg_b_week', P_B, 1, { ownerId: B_ID, endAt: week }),
      makeStage('stg_b_done', P_B, 2, {
        ownerId: B_ID,
        endAt: week,
        status: StageStatus.Completed,
      }),
      makeStage('stg_agent', P_AGENT, 1, { ownerId: A_ID, endAt: week }),
    ],
    tasks: [
      makeTask('tsk_a', '甲乙都该看到的活', { assigneeId: A_ID, assigneeIds: [A_ID] }),
      makeTask('tsk_agent', 'Agent 看板下的活', {
        projectId: P_AGENT,
        stageId: 'stg_agent',
        assigneeId: A_ID,
        assigneeIds: [A_ID],
      }),
    ],
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 脚手架
 * ══════════════════════════════════════════════════════════════════════════════ */

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function unmountCurrent(): void {
  const r = root;
  if (r !== null) {
    act(() => {
      r.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
}

function mount(node: React.ReactElement): HTMLDivElement {
  unmountCurrent();
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  const r = createRoot(h);
  root = r;
  act(() => {
    r.render(node);
  });
  return h;
}

/** jsdom 缺 matchMedia / ResizeObserver（ProjectCard 链会碰），补最小桩 */
function installEnvStubs(): void {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  w.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

/**
 * 装库（**必须在挂载前**，包在 act 里）。
 *
 * `hydrated` 默认 true：本文件的绝大多数用例描述的是「装载完成之后」，
 * 只有 A-05 显式把它拨成 false 来验「装载中不下判决」。
 * 历史上正是「夹具漏写 hydrated」让旧口径看起来一切正常 —— 这里默认值取真实态。
 */
function seedStores(opts: { currentMemberId: string | null; hydrated?: boolean }): void {
  unmountCurrent();
  const f = buildFixtures();
  act(() => {
    useProjectsStore.getState().replaceAll({
      projects: f.projects,
      stages: f.stages,
      tasks: f.tasks,
    });
    useMembersStore.getState().setAll(f.members);
    useSettingsStore.setState({
      currentMemberId: opts.currentMemberId,
      hydrated: opts.hydrated ?? true,
      hydrateError: null,
    });
    useUiStore.getState().setMemberBoardView('kanban');
  });
}

/** 漏斗探针：把三个 hook 的长度拼成 `项目/阶段/任务` 一行文本（人类侧） */
function Probe(): JSX.Element {
  const projects = useHumanProjects();
  const stages = useHumanStages();
  const tasks = useHumanTasks();
  return (
    <span data-funnel-probe="">{`${projects.length}/${stages.length}/${tasks.length}`}</span>
  );
}

/** 同一个探针，Agent 侧（team-lead 裁决 1：两侧同一判决，故同一套断言） */
function AgentProbe(): JSX.Element {
  const projects = useAgentProjects();
  const stages = useAgentStages();
  const tasks = useAgentTasks();
  return (
    <span data-agent-probe="">{`${projects.length}/${stages.length}/${tasks.length}`}</span>
  );
}

function probeText(sel = '[data-funnel-probe]'): string {
  const el = document.querySelector(sel);
  return (el?.textContent ?? '').trim();
}

/** 按 `/member-board` 挂 MemberBoardPage（真路由，`?member=` 深链必需） */
function renderBoard(path = '/member-board'): HTMLDivElement {
  return mount(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/member-board" element={<MemberBoardPage />} />
        <Route path="*" element={<div data-fallback="" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 读某张统计卡的数值（`StatCard` 的标签 span 与数值 span 是相邻兄弟） */
function statValue(h: HTMLDivElement, label: string): string {
  const spans = Array.from(h.querySelectorAll('span'));
  const labelEl = spans.find((s) => (s.textContent ?? '').trim() === label);
  if (!labelEl) return '(缺失)';
  return (labelEl.nextElementSibling?.textContent ?? '').trim();
}

const textOf = (h: HTMLElement): string => h.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  installEnvStubs();
});

afterEach(() => {
  unmountCurrent();
});

/* ══════════════════════════════════════════════════════════════════════════════
 * A · 漏斗层
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('A · 漏斗层：未进入身份 ⇒ 人类侧三个 hook 全空', () => {
  it('A-01 未进入（已装载、currentMemberId=null）⇒ 项目/阶段/任务全空（库里明明有 2/4/1）', () => {
    seedStores({ currentMemberId: null });
    mount(<Probe />);
    expect(probeText(), '未进入身份时人类侧必须零可见').toBe('0/0/0');
    // 反证：数据仍在 store 里（不是被删了，只是不给看）
    expect(useProjectsStore.getState().projects).toHaveLength(3);
    expect(useProjectsStore.getState().stages).toHaveLength(5);
    expect(useProjectsStore.getState().tasks).toHaveLength(2);
  });

  it('A-02 同一份 store 里进入管理员 ⇒ 立刻全量恢复（不重载、不刷新）', () => {
    seedStores({ currentMemberId: null });
    mount(<Probe />);
    expect(probeText()).toBe('0/0/0');

    // ⚠️ 只切身份，**不**再调 replaceAll / 不重挂组件 ⇒ 验「同一份 store 立即恢复」
    act(() => {
      useSettingsStore.getState().setCurrentMember(ADMIN_ID);
    });
    expect(probeText(), '进入身份后必须立刻看到数据').toBe('2/4/1');
    expect(useProjectsStore.getState().projects, '库没被换过（同一份数据）').toHaveLength(3);
  });

  it('A-03 ★ 停用成员当 currentMemberId ⇒ 也算未进入（最易漏的边界）', () => {
    seedStores({ currentMemberId: OFF_ID });
    mount(<Probe />);
    expect(
      probeText(),
      '只判 currentMemberId != null 会在这里放行；正确口径是「指向一条 active 成员」',
    ).toBe('0/0/0');
  });

  it('A-04 指向已被删除的 id（悬挂身份）⇒ 也算未进入', () => {
    seedStores({ currentMemberId: 'mem_ghost' });
    mount(<Probe />);
    expect(probeText()).toBe('0/0/0');
  });

  it('A-05 ★ Agent 侧同一判决：未进入 ⇒ 空；进入 ⇒ 恢复（不是两套 if）', () => {
    /*
     * team-lead 裁决 1：`useAgentProjects()` 修前只按 kind 收窄
     * （`currentMemberId || null` ⇒ 谓词 `null` 分支「只按 kind」）⇒ 未进入身份时返回
     * **全部** agent 看板（含无主公共板）。它与人类侧是同一族泄漏，故同一个判决收口。
     * ⚠️ 判据复用的是 `visibility.ts` 里那**一个** `useViewerGate()`，不是各判一次。
     */
    seedStores({ currentMemberId: null });
    mount(<AgentProbe />);
    expect(probeText('[data-agent-probe]'), '未进入身份 ⇒ Agent 侧同样零可见').toBe('0/0/0');

    act(() => {
      useSettingsStore.getState().setCurrentMember(ADMIN_ID);
    });
    expect(probeText('[data-agent-probe]'), '进入身份后同一份 store 立即恢复').toBe('1/1/1');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * B · 成员看板统计卡（她的抱怨 #2）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('B · 成员看板：四张统计卡必须与「我在看谁」同口径', () => {
  const L_ACTIVE = '进行中项目';
  const L_WEEK = '本周到期任务';
  const L_OVERDUE = '逾期风险';
  const L_DONE = '本月完工';

  it('B-01 未进入身份 ⇒ 四个数全 0 + 「请先选择身份」引导（不是 0/3/0/0 那种组合）', () => {
    seedStores({ currentMemberId: null });
    const h = renderBoard();

    expect(statValue(h, L_ACTIVE)).toBe('0');
    expect(statValue(h, L_WEEK), '「本周到期」不得把全库阶段数报给一个没有身份的人').toBe('0');
    expect(statValue(h, L_OVERDUE)).toBe('0');
    expect(statValue(h, L_DONE), '「本月完工」同上').toBe('0');

    expect(textOf(h), '引导态：请先选择身份').toContain('请先选择身份');
    expect(
      textOf(h),
      '未进入时「还没有与你相关的项目」是假话（他不是没有，是还没说明自己是谁）',
    ).not.toContain('还没有与你相关的项目');
  });

  it('B-02 ★ 普通成员自看 ⇒ 本周到期 / 本月完工只算自己的（1/1，不是 2/2）', () => {
    seedStores({ currentMemberId: A_ID });
    const h = renderBoard();

    expect(statValue(h, L_ACTIVE)).toBe('1');
    expect(
      statValue(h, L_WEEK),
      '成员乙也有一个本周到期的阶段；把全库算进来就会变成 2（旧实现的症状）',
    ).toBe('1');
    expect(statValue(h, L_OVERDUE)).toBe('0');
    expect(
      statValue(h, L_DONE),
      '成员乙也有一个本月完工的阶段；全库口径会给出 2',
    ).toBe('1');
    expect(textOf(h), '已进入身份 ⇒ 不该出现引导态').not.toContain('请先选择身份');
  });

  it('B-03 管理员看该成员（?member=）⇒ 与 B-02 完全同一组数（同一个口径，不是第二套）', () => {
    seedStores({ currentMemberId: ADMIN_ID });
    const h = renderBoard(`/member-board?member=${A_ID}`);

    expect(textOf(h), '标题应是该成员的名字').toContain('成员甲');
    expect(statValue(h, L_ACTIVE)).toBe('1');
    expect(statValue(h, L_WEEK)).toBe('1');
    expect(statValue(h, L_DONE)).toBe('1');
  });

  it('B-04 装载中（hydrated=false）⇒ 只有 DataGate 装载面，**不得**下「未进入」判决', () => {
    seedStores({ currentMemberId: null, hydrated: false });
    const h = renderBoard();

    expect(h.querySelector('[data-data-gate="loading"]'), '装载中应渲染占位').not.toBeNull();
    expect(
      textOf(h),
      '装载中不能把「还没读完」说成「你没进入身份」',
    ).not.toContain('请先选择身份');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * C · 侧栏入口（她的抱怨 #3 的入口面）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('C · 侧栏：未进入身份 ⇒ 不出现"要有身份才有意义"的入口', () => {
  function renderNav(): HTMLDivElement {
    return mount(
      <MemoryRouter initialEntries={['/member-board']}>
        <SidebarNav collapsed={false} />
      </MemoryRouter>,
    );
  }

  function navText(h: HTMLDivElement): string {
    return (h.querySelector('[data-main-nav]')?.textContent ?? '').trim();
  }

  it('C-01 未进入 ⇒ 没有「我的任务」、没有插件 main 组入口；「看板」保留', () => {
    seedStores({ currentMemberId: null });
    const h = renderNav();
    const txt = navText(h);

    expect(txt, '「我的任务」需要身份才有意义').not.toContain('我的任务');
    expect(txt, '插件 main 组入口同理（它点进去就是全库数据）').not.toContain('项目周报');
    expect(txt, '「看板」必须留着：他得有个地方点进去看引导态').toContain('看板');
    expect(txt, 'Agent 段与它们同一判据（裁决 1）：数据面已空，入口不该留着').not.toContain(
      'Agent',
    );
  });

  it('C-02 进入管理员 ⇒ 三枚入口都在（收窄不是永久隐藏）', () => {
    seedStores({ currentMemberId: ADMIN_ID });
    const h = renderNav();
    const txt = navText(h);

    expect(txt).toContain('项目');
    expect(txt).toContain('我的任务');
    expect(txt).toContain('项目周报');
    expect(txt, '进入身份后 Agent 段必须回来（收窄不是永久隐藏）').toContain('Agent');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * D · 插件页零改动即变空（单一出口的强信号）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('D · 项目周报插件：一行未改，未进入身份时自己就空了', () => {
  function renderWeekly(): HTMLDivElement {
    return mount(
      <MemoryRouter initialEntries={['/weekly-report']}>
        <WeeklyReportPanel />
      </MemoryRouter>,
    );
  }

  it('D-01 未进入身份 ⇒ 项目名与客户名一个都不出现', () => {
    seedStores({ currentMemberId: null });
    const h = renderWeekly();
    const txt = textOf(h);

    expect(txt, '不应出现任何项目名').not.toContain(P_A_NAME);
    expect(txt, '不应出现任何项目名').not.toContain(P_B_NAME);
    expect(txt, '不应出现任何客户名').not.toContain('客户-');
  });

  it('D-02 进入管理员 ⇒ 项目名照常出现（证明 D-01 不是"页面坏了"）', () => {
    seedStores({ currentMemberId: ADMIN_ID });
    const h = renderWeekly();
    const txt = textOf(h);

    expect(txt).toContain(P_A_NAME);
    expect(txt).toContain(P_B_NAME);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * E · 回归位：「空库」判据不能被身份门带偏
 *
 * 本轮改动会让 `useHumanProjects()` 在未进入身份时返回空 —— 而 `FirstRunGuide` 的
 * 显示条件正是「库为空」。未进入身份又是**新库首启的常态** ⇒ 一度把"有 2 个项目的库"
 * 判成空库、弹出首次欢迎卡（实测：`tests/plugin-state-demo-browser.spec.ts` ④b 变红）。
 * 修法是给漏斗加一个**非可见性**出口 `useHasHumanProjects()`（只回答"库里有没有"），
 * 本用例把这颗回归钉在 jsdom 层，免得只能靠真 Chromium 才发现。
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('F · 项目详情页：未进入身份整页不放行（team-lead 裁决 2）', () => {
  /** 挂 `/project/:id` 真路由 + 一个首页标记（`<Navigate to="/">` 的落点判据） */
  function renderDetail(id: string): HTMLDivElement {
    return mount(
      <MemoryRouter initialEntries={[`/project/${id}`]}>
        <Routes>
          <Route path="/" element={<div data-home-marker="" />} />
          <Route path="/project/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('F-01 未进入 ⇒ 重定向回首页，详情页一个字都不渲染', () => {
    seedStores({ currentMemberId: null });
    const h = renderDetail(P_A);

    expect(
      h.querySelector('[data-home-marker]'),
      '未进入身份 ⇒ 不应落在详情页（形态与 CalendarPrintPage 同一条守卫）',
    ).not.toBeNull();
    expect(textOf(h), '不得渲染项目名').not.toContain(P_A_NAME);
    expect(textOf(h), '不得渲染客户名').not.toContain('客户-');
  });

  it('F-02 进入成员身份 ⇒ 照常进详情页（收窄不是对所有人关门）', () => {
    seedStores({ currentMemberId: A_ID });
    const h = renderDetail(P_A);

    expect(h.querySelector('[data-home-marker]'), '成员不得被重定向').toBeNull();
    expect(textOf(h), '成员应能看到自己参与的项目').toContain(P_A_NAME);
  });

  it('F-03 装载中（hydrated=false）⇒ 渲染占位，**不得**抢先重定向', () => {
    seedStores({ currentMemberId: null, hydrated: false });
    const h = renderDetail(P_A);

    expect(
      h.querySelector('[data-home-marker]'),
      '冷载首帧 role 必然是 null；先判身份会把管理员的深链一起弹回首页',
    ).toBeNull();
    expect(h.querySelector('[data-data-gate="loading"]'), '装载中应出占位').not.toBeNull();
  });
});

describe('E · 欢迎卡：库里有数据就不该弹（哪怕还没进入身份）', () => {
  it('E-01 库里有 2 个项目 + 未进入身份 ⇒ 欢迎卡不出现', () => {
    seedStores({ currentMemberId: null });
    /* 欢迎卡的身份信号是「首帧 localStorage 里有没有那个键」（只读一次）——
       模拟「这台机器以前进过身份、现在退出了」，即她的抱怨场景。 */
    localStorage.setItem(CURRENT_MEMBER_ID_KEY, A_ID);
    const h = mount(
      <MemoryRouter initialEntries={['/']}>
        <FirstRunGuide />
      </MemoryRouter>,
    );

    /* ⚠️ 必须查 `document.body` 而不是挂载容器：欢迎卡在 `<Modal>` 里，是 **portal**
       到 body 的（第一版写成 `h.querySelector` ⇒ 永远 null ⇒ 断言空转，变异时
       依旧全绿。这类"假绿"正是本仓反复踩的坑，注释留在这里免得下一个人重犯）。 */
    expect(
      document.querySelector('[data-first-run-panel]'),
      '库非空 ⇒ 不是首次使用；身份未进入不能把库说成空的',
    ).toBeNull();
  });
});
