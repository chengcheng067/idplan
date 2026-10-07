// @vitest-environment jsdom
/**
 * 0.8.6.0002 反馈 #5「搜索成员直达看板」· jsdom 层验收。
 *
 * 她的原话：「比如我搜索了'朴彩英'，那我肯定就想看这个成员的任务排表，
 * 包括他近期完成了哪些任务、还有哪些任务。我希望作为管理员，一点击就能看到，
 * 那这就不仅仅是搜索框的问题，而是比如说我在成员面板点击了成员，那是否也会显示这个看板」。
 *
 * 本文件覆盖四件事（按她的句子逐条对）：
 *   ① **纯解析层**：`resolveMemberBoardSubject` 四条语义（self / member / denied / missing）——
 *      「看谁的看板」这个决定必须是可单测的纯函数，而不是散在 JSX 里的 if；
 *   ② **管理员搜成员 → 点 → 跳到该成员看板**（真渲染 HomePage + 真路由 + 真 store）；
 *   ③ **成员身份不放行**：搜不到别人的条目（隐私边界，不是功能缺失）；
 *      带 `?member=` 深链也被剥回她自己（`<Navigate replace>`）；
 *   ④ **看板内容三块**：进行中 / 已逾期 / 近期完成（她的「近期完成了哪些任务、
 *      还有哪些任务」），且**只含该成员的任务**（同页对照组 + Agent 工作区隔离）。
 *
 * 手法与仓库既有组件测同款：只用 react-dom/client，不引 testing-library；
 * 仓储经 `vi.mock('../src/hooks/useRepos')` 顶掉（见 tests/stage-color-wiring.spec.tsx:128）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/* ProjectCard / MembersPageSection 经 useRepos() 读 Context（本文件没有 Provider 树），
 * 故在模块边界顶掉它 —— 与 tests/stage-color-wiring.spec.tsx:128 同一手法。 */
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
      insert: ok,
      get: async () => null,
      linkProject: ok,
      saveConfirmedPayload: ok,
      list: async () => [],
    },
    settings: { get: async () => null, set: ok, all: async () => [], replaceAll: ok },
  };
  return { useRepos: (): unknown => bundle };
});

import { MemberBoardPage } from '../src/pages/MemberBoardPage';
import { HomePage } from '../src/pages/HomePage';
import {
  memberBoardHref,
  resolveMemberBoardSubject,
  searchMemberHits,
} from '../src/hooks/useRoleGuard';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
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
 * 常量与夹具
 * ══════════════════════════════════════════════════════════════════════════════ */

const ADMIN_ID = 'mem_admin';
const PCY_ID = 'mem_pcy'; // 朴彩英（她搜索的人）
const XU_ID = 'mem_xu'; // 许工（对照组：任务不得串台）
const OFF_ID = 'mem_off'; // 停用成员（搜索不命中；深链直开仍可看——历史任务还在）

const T_OVERDUE = '超期的图纸校对';
const T_ONGOING = '进行中的软装清单';
const T_DONE_RECENT = '已完成的量房';
const T_DONE_OLD = '很久以前的提案'; // 超出 30 天窗口：不得进「近期完成」
const T_XU = '许工自己的任务';
const T_AGENT = 'Agent 指派给彩英的任务'; // Agent 看板任务：人类侧一律不得出现

/** 今天 ±N 天的本地时区 ISO 日（测试不写死日期，避免随时间腐化） */
function isoDaysFromToday(delta: number): string {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    clientName: '客户甲',
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
  const status = over.status ?? TaskStatus.Draft;
  return {
    id,
    taskNo: null,
    projectId: 'proj_pcy',
    stageId: 'stg_pcy',
    title,
    done: status === TaskStatus.Done,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'human',
    externalId: null,
    agentId: null,
    status,
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

/** 全量夹具：一个人类项目归朴彩英、一个归许工、一个 Agent 看板（任务也派给彩英——隔离断言用） */
function buildFixtures(): { members: Member[]; projects: Project[]; stages: Stage[]; tasks: Task[] } {
  const members: Member[] = [
    makeMember(ADMIN_ID, '齐活林', { role: '项目负责人', roleKind: MemberRoleKind.Admin }),
    makeMember(PCY_ID, '朴彩英', { role: '设计' }),
    makeMember(XU_ID, '许工'),
    makeMember(OFF_ID, '已停用', { active: false }),
  ];
  const projects: Project[] = [
    makeProject('proj_pcy', '山茶小院'),
    makeProject('proj_xu', '海边民宿'),
    makeProject('proj_agent', 'Agent 演示板', { kind: 'agent' }),
  ];
  const stages: Stage[] = [
    makeStage('stg_pcy', 'proj_pcy', 1, { ownerId: PCY_ID }),
    makeStage('stg_xu', 'proj_xu', 1, { ownerId: XU_ID }),
    makeStage('stg_agent', 'proj_agent', 1, { ownerId: PCY_ID }),
  ];
  const tasks: Task[] = [
    makeTask('tsk_overdue', T_OVERDUE, {
      projectId: 'proj_pcy',
      stageId: 'stg_pcy',
      assigneeId: PCY_ID,
      assigneeIds: [PCY_ID],
      dueDate: isoDaysFromToday(-3),
    }),
    makeTask('tsk_ongoing', T_ONGOING, {
      projectId: 'proj_pcy',
      stageId: 'stg_pcy',
      assigneeId: PCY_ID,
      assigneeIds: [PCY_ID],
      dueDate: isoDaysFromToday(5),
      status: TaskStatus.InProgress,
    }),
    makeTask('tsk_done_recent', T_DONE_RECENT, {
      projectId: 'proj_pcy',
      stageId: 'stg_pcy',
      assigneeId: PCY_ID,
      assigneeIds: [PCY_ID],
      dueDate: isoDaysFromToday(-2),
      status: TaskStatus.Done,
    }),
    makeTask('tsk_done_old', T_DONE_OLD, {
      projectId: 'proj_pcy',
      stageId: 'stg_pcy',
      assigneeId: PCY_ID,
      assigneeIds: [PCY_ID],
      dueDate: isoDaysFromToday(-90),
      status: TaskStatus.Done,
    }),
    makeTask('tsk_xu', T_XU, {
      projectId: 'proj_xu',
      stageId: 'stg_xu',
      assigneeId: XU_ID,
      assigneeIds: [XU_ID],
      dueDate: isoDaysFromToday(1),
    }),
    // ★ 隔离夹具：Agent 看板的任务也派给朴彩英。成员看板走 useHumanTasks() 漏斗，
    //   它一个字都不许出现（与 L4 真浏览器断言同口径，这里在 jsdom 先钉一道）。
    makeTask('tsk_agent', T_AGENT, {
      projectId: 'proj_agent',
      stageId: 'stg_agent',
      assigneeId: PCY_ID,
      assigneeIds: [PCY_ID],
      dueDate: isoDaysFromToday(2),
    }),
  ];
  return { members, projects, stages, tasks };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 渲染 / 装库脚手架
 * ══════════════════════════════════════════════════════════════════════════════ */

let host: HTMLDivElement | null = null;
let root: Root | null = null;

/** 卸载当前树（同一用例内多次挂载必须先收掉前一棵，否则孤儿树仍订阅 store） */
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

/** 装三个 store + UI 偏好（必须在挂载前、包在 act 里） */
function seedStores(opts: {
  currentMemberId: string | null;
  hydrated?: boolean;
  searchQuery?: string;
}): void {
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
    });
    useUiStore.getState().setHomeViewMode('kanban');
    useUiStore.getState().setMemberBoardView('kanban');
    useUiStore.getState().setSearchQuery(opts.searchQuery ?? '');
  });
}

/**
 * 按路径挂真实路由子集，并挂一个位置探针（记录 `pathname + search`）。
 * 探针放 MemoryRouter 内、Routes 外：`<Navigate replace>` 的落点因此可断言。
 */
function renderAt(path: string): { host: HTMLDivElement; location: () => string } {
  let loc = '(none)';
  const LocationProbe = (): JSX.Element => {
    const l = useLocation();
    loc = `${l.pathname}${l.search}`;
    return <></>;
  };
  const h = mount(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/member-board" element={<MemberBoardPage />} />
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:id" element={<div data-project-open="">项目详情占位</div>} />
        <Route path="*" element={<div data-fallback="">路由回退</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return { host: h, location: () => loc };
}

const textOf = (host: HTMLDivElement): string => host.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  installEnvStubs();
});

afterEach(() => {
  unmountCurrent();
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ① 纯解析层：resolveMemberBoardSubject / searchMemberHits / memberBoardHref
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('resolveMemberBoardSubject：看板「看谁」的四条语义', () => {
  const members = [
    makeMember(ADMIN_ID, '齐活林', { roleKind: MemberRoleKind.Admin }),
    makeMember(PCY_ID, '朴彩英'),
  ];

  it('无参数 → self（观看对象 = 当前身份；今天的成员落地页正是这支，行为逐字不变）', () => {
    const s = resolveMemberBoardSubject({
      memberParam: null,
      isAdmin: false,
      currentMemberId: PCY_ID,
      members,
    });
    expect(s).toEqual({ kind: 'self', memberId: PCY_ID });
  });

  it('空白参数视同无参数（"%20" 不是「看别人」的暗道）', () => {
    const s = resolveMemberBoardSubject({
      memberParam: '   ',
      isAdmin: true,
      currentMemberId: ADMIN_ID,
      members,
    });
    expect(s).toEqual({ kind: 'self', memberId: ADMIN_ID });
  });

  it('管理员 + 命中 id → member（含停用成员：历史任务仍在库里，管理员要能回看）', () => {
    const s = resolveMemberBoardSubject({
      memberParam: PCY_ID,
      isAdmin: true,
      currentMemberId: ADMIN_ID,
      members: [...members, makeMember(OFF_ID, '已停用', { active: false })],
    });
    expect(s.kind).toBe('member');
    if (s.kind === 'member') expect(s.member.name).toBe('朴彩英');

    const off = resolveMemberBoardSubject({
      memberParam: OFF_ID,
      isAdmin: true,
      currentMemberId: ADMIN_ID,
      members: [...members, makeMember(OFF_ID, '已停用', { active: false })],
    });
    expect(off.kind).toBe('member');
  });

  it('★ 成员身份 + 带别人的 id → denied（隐私边界：不解析出任何成员信息）', () => {
    const s = resolveMemberBoardSubject({
      memberParam: ADMIN_ID,
      isAdmin: false,
      currentMemberId: PCY_ID,
      members,
    });
    expect(s).toEqual({ kind: 'denied' });
  });

  it('管理员 + 查无此人 → missing（显式空态，不静默回落成看自己）', () => {
    const s = resolveMemberBoardSubject({
      memberParam: 'mem_deleted',
      isAdmin: true,
      currentMemberId: ADMIN_ID,
      members,
    });
    expect(s).toEqual({ kind: 'missing' });
  });
});

describe('searchMemberHits：成员搜索命中（反馈 #5）', () => {
  const members = [
    makeMember(ADMIN_ID, '齐活林', { roleKind: MemberRoleKind.Admin }),
    makeMember(PCY_ID, '朴彩英', { role: '设计' }),
    makeMember('mem_park', 'Park Chaeyoung'),
    makeMember(OFF_ID, '朴彩英停用号', { active: false }),
  ];

  it('姓名包含查询词即命中（大小写不敏感、可多命中）', () => {
    expect(searchMemberHits(members, 'park').map((m) => m.id)).toEqual(['mem_park']);
    expect(searchMemberHits(members, '  PARK  ').map((m) => m.id)).toEqual(['mem_park']);
    expect(searchMemberHits(members, '朴彩英').map((m) => m.id)).toEqual([PCY_ID]);
    expect(searchMemberHits(members, '朴').map((m) => m.id)).toEqual([PCY_ID]); // 停用号不掺和
  });

  it('空查询 → 空（不在无输入时倾泻全部成员）', () => {
    expect(searchMemberHits(members, '')).toEqual([]);
    expect(searchMemberHits(members, '   ')).toEqual([]);
  });

  it('停用成员不命中（与 matchActiveMemberByName 同口径）', () => {
    expect(searchMemberHits(members, '停用')).toEqual([]);
  });
});

describe('memberBoardHref：深链唯一构造点', () => {
  it('普通 id 原样进 query；特殊字符经 encodeURIComponent', () => {
    expect(memberBoardHref(PCY_ID)).toBe('/member-board?member=mem_pcy');
    expect(memberBoardHref('a b&c')).toBe('/member-board?member=a%20b%26c');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ② 管理员 + ?member= → 看该成员的看板（含三块内容与隔离）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('成员看板：管理员看指定成员（反馈 #5 主链路）', () => {
  it('★ ?member=朴彩英：标题是她的名字，三块任务只含她的（别人/Agent 的一律不出现）', () => {
    seedStores({ currentMemberId: ADMIN_ID });
    const { host } = renderAt(`/member-board?member=${PCY_ID}`);
    const text = textOf(host);

    // 标题与视角说明（她的预期：「这个成员的任务排表」，不是一个通用页面）
    expect(text).toContain('朴彩英 的项目看板');
    expect(text).toContain('管理员视角');

    // 三块：已逾期 / 进行中 / 近期完成
    expect(text).toContain('已逾期');
    expect(text).toContain('进行中');
    expect(text).toContain('近期完成');
    expect(text).toContain(T_OVERDUE);
    expect(text).toContain(T_ONGOING);
    expect(text).toContain(T_DONE_RECENT);

    // 逾期徽标必须出现（行内 due < today），且原文案不能是「点了没反应」的死东西
    expect(text).toMatch(/已逾期/);

    // 近期窗口外 / 别人的 / Agent 工作区的，一律不许出现
    expect(text, '超出 30 天窗口的完成任务不得进「近期完成」').not.toContain(T_DONE_OLD);
    expect(text, '许工的任务不得串台到朴彩英的看板').not.toContain(T_XU);
    expect(text, '许工的项目不得串台').not.toContain('海边民宿');
    expect(text, 'Agent 看板任务不得混进人类侧成员看板（Pid 漏斗）').not.toContain(T_AGENT);
    expect(text, 'Agent 看板本身不得出现').not.toContain('Agent 演示板');
  });

  it('同页对照组：管理员无参数 → 看自己（标题与文案与今天逐字一致）', () => {
    seedStores({ currentMemberId: ADMIN_ID });
    const { host } = renderAt('/member-board');
    const text = textOf(host);

    expect(text).toContain('项目看板');
    expect(text).not.toContain('朴彩英 的项目看板'); // 不是「看别人」的标题形态
    expect(text).toContain('仅显示与我相关的项目');
    // 管理员自己没有任何指派 → 三块空态（有兜底文案，不是空白架子）
    expect(text).toContain('没有逾期的任务');
    expect(text).toContain('没有进行中的任务');
  });

  it('管理员深链到已删除的成员 → 显式「找不到该成员」，不静默回落成看自己', () => {
    seedStores({ currentMemberId: ADMIN_ID });
    const { host, location } = renderAt('/member-board?member=mem_deleted');
    const text = textOf(host);

    expect(text).toContain('找不到该成员');
    expect(text, '不得把「看别人」骗成「看自己」').not.toContain('仅显示与我相关的项目');
    // 停在本页（不是 Navigate 回自己）；文案给得出路
    expect(location()).toBe('/member-board?member=mem_deleted');
    expect(text).toContain('返回成员看板');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ③ 成员身份不放行：搜不到别人 + 深链被剥回她自己
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('成员身份：看不到别人的看板（隐私边界，不是功能缺失）', () => {
  it('★ 搜索框里搜别人 → 不出现成员条目（项目搜索照旧工作）', () => {
    seedStores({ currentMemberId: PCY_ID, searchQuery: '朴彩英' });
    const { host } = renderAt('/');
    const text = textOf(host);

    expect(text, '成员身份不得渲染成员搜索结果区').not.toContain('搜索到的成员');
    // 项目侧搜索没被带坏：查询词照常过滤（本项目名不含查询词 → 落「没有匹配」空态）
    expect(text).toContain('没有匹配「朴彩英」的项目');
  });

  it('★ 带 ?member=别人的深链 → 剥回无参 /member-board（她自己），且不渲染别人任何数据', () => {
    seedStores({ currentMemberId: PCY_ID });
    const { host, location } = renderAt(`/member-board?member=${ADMIN_ID}`);
    const text = textOf(host);

    expect(location(), 'member 参数必须被剥掉（replace，不留历史）').toBe('/member-board');
    expect(text).toContain('项目看板');
    expect(text).toContain('仅显示与我相关的项目');
    expect(text).not.toContain('齐活林 的项目看板');
    expect(text).not.toContain('管理员视角');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ②-bis 首页搜索 → 点成员 → 跳转（管理员）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('首页搜索成员直达（管理员视角）', () => {
  it('★ 搜「朴彩英」→ 出现成员条目 → 点击跳 /member-board?member=<id> 并清空搜索词', () => {
    seedStores({ currentMemberId: ADMIN_ID, searchQuery: '朴彩英' });
    const { host, location } = renderAt('/');

    expect(textOf(host)).toContain('搜索到的成员');
    const btn = Array.from(host.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('朴彩英'),
    );
    expect(btn, '管理员必须看得到可点的成员条目').toBeTruthy();

    act(() => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(location()).toBe(memberBoardHref(PCY_ID));
    // 搜索词已清空：回退路径不被查询词挡着
    expect(useUiStore.getState().searchQuery).toBe('');
  });

  it('行内显示角色（头像 + 姓名 + 角色，说人话的搜索结果）', () => {
    seedStores({ currentMemberId: ADMIN_ID, searchQuery: '朴彩英' });
    const { host } = renderAt('/');
    const btn = Array.from(host.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('朴彩英'),
    );
    expect((btn?.textContent ?? '')).toContain('设计');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ④ 源码锚点：三处接线真的接上了（防「删了组件引用只剩死代码」式假绿）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('源码锚点：反馈 #5 的接线', () => {
  const read = async (p: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    return readFileSync(resolve(__dirname, '..', p), 'utf8');
  };

  it('MemberBoardPage：读 URL 参数、经 resolveMemberBoardSubject 解析、denied 走 Navigate', async () => {
    const src = await read('src/pages/MemberBoardPage.tsx');
    expect(src).toContain('useSearchParams');
    expect(src).toContain('resolveMemberBoardSubject');
    expect(src).toContain('<Navigate to="/member-board" replace />');
    // 三块任务区是本任务的交付面
    expect(src).toContain('MemberTaskTriage');
    expect(src).toContain('近期完成');
  });

  it('HomePage：成员搜索受 isAdmin 门控，落点经 memberBoardHref', async () => {
    const src = await read('src/pages/HomePage.tsx');
    expect(src).toContain('searchMemberHits');
    expect(src).toContain('memberBoardHref');
    expect(src).toMatch(/isAdmin \? searchMemberHits/);
  });

  it('MembersPageSection：每行「看板」按钮经 memberBoardHref 跳该成员看板', async () => {
    const src = await read('src/components/member/MembersPageSection.tsx');
    expect(src).toContain('memberBoardHref');
    expect(src).toContain('查看该成员的看板');
  });
});
