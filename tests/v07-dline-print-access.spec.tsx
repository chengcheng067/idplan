// @vitest-environment jsdom
/**
 * v0.7 · D 线收尾 · 打印页「成员放开」验收（只读导出）—— jsdom 层验收。
 *
 * 用户已拍板「**放开**成员打印」：两份打印 / 导出页（日程表打印 `SchedulePrintPage`、
 * 项目月历打印 `CalendarPrintPage`）由「非管理员一律重定向回首页」改为**两档**：
 *   · **未进入身份（role === null）** → 仍重定向（无身份即无可见范围，保持现状）；
 *   · **成员（受限）**              → 允许留在页内**只读导出**；
 *   · **管理员**                    → 行为不变。
 * `role === null` 与「成员」是**两个不同档位**，绝不可混同（把前者并进允许档
 * = 未进入者也能拿到全员排期）。
 *
 * ── 本文件锁的三件事 ──
 *   ① **行为**：用 MemoryRouter 真挂载两条打印路由，按三种身份断言「被重定向 / 留在页内」。
 *      刻意**不**用「源码 grep 到 `role === null` 就算过」——那只证明写了这行字，
 *      证明不了渲染期的实际效果（早退位置、hook 顺序、Navigate 是否真的生效都在这一层）。
 *   ② **入口**：路由放开了但**入口**没放开 = 成员照样进不去，这是本轮最容易
 *      「改了却没用」的地方，故逐条断言：
 *        · `ProjectDetailPage` 的「日程表」按钮原被 `!memberView` 包住 → 成员现在必须看得到；
 *        · `ProjectCard` 的「导出日程表」原在 `isAdmin &&` 的 ⋯ 菜单里 → 成员现在必须有独立入口；
 *        并**反向断言成员看不到「归档」**（放开打印 ≠ 放开写）。
 *   ③ **只读性**：打印页对成员只读的正确实现不是「把写入口禁用」，而是**页内没有写入口**。
 *      故断言页内无任何表单控件、交互控件只剩只读集合，且点「打印 / 导出 PDF」前后
 *      store 的引用完全不变（真消费一次，而不是只看有没有按钮）。
 *
 * ── 为什么必须带 admin / none 对照组 ──
 *   旧实现是「非管理员一律重定向」。若只断言「成员不重定向」，那么**把守卫整个删掉**
 *   （谁都能进，含未进入身份）也会全绿（假绿）。故每条「成员放行」断言都配
 *   「未进入身份必须被挡」与「管理员行为不变」两条对照。
 *
 * 只依赖 react-dom/client + react-router-dom 原生渲染，不引入 testing-library（与仓库既有组件测同款）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/* act 环境开关由 `tests/setup.ts` 统一置位（本文件不再自行置位）——
 * 逐文件置位会把告警 / 状态转嫁给同进程的下游 spec，理由详见 setup.ts。 */

/**
 * 顶掉真实仓储：`ProjectCard` / `ProjectDetailPage` 经 `useRepos()` 读 Context，
 * 本文件只关心**渲染出的 DOM 与 store 的影响**，故用最小假 bundle 免去 Dexie 装配。
 * `vi.mock` 工厂被提升，不能引用模块顶层变量——全部在工厂内定义。
 */
vi.mock('../src/hooks/useRepos', () => {
  const ok = async (): Promise<void> => undefined;
  const bundle = {
    projects: { list: async () => [], get: async () => null, insert: ok, update: ok, archive: ok, remove: ok },
    stages: { listByProject: async () => [], get: async () => null, bulkInsert: ok, update: ok, reschedule: ok },
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
    members: { list: async () => [], get: async () => null, insert: ok, update: ok, verifyCredentials: async () => false },
    logs: {
      appendStageLog: ok,
      listStageLogsByStage: async () => [],
      listStageLogsByProject: async () => [],
      appendAssignment: ok,
      listAssignmentsByTask: async () => [],
    },
    contracts: { insert: ok, get: async () => null, linkProject: ok, saveConfirmedPayload: ok, list: async () => [] },
    settings: { get: async () => null, set: ok, all: async () => [], replaceAll: ok },
  };
  return { useRepos: (): unknown => bundle };
});

import { SchedulePrintPage } from '../src/pages/SchedulePrintPage';
import { CalendarPrintPage } from '../src/pages/CalendarPrintPage';
import { ProjectDetailPage } from '../src/pages/ProjectDetailPage';
import { ProjectCard } from '../src/components/project/ProjectCard';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ProjectType,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage, Task } from '../src/core/types/entities';

/* ====================================================================================
 * 夹具
 * ==================================================================================== */

const PROJECT_ID = 'proj_dl2';
const STAGE_ID = 'stg_dl2';
const ADMIN_ID = 'm-admin-dl2';
const MEMBER_ID = 'm-member-dl2';
const TODAY = '2026-02-01';

const PROJECT: Project = {
  id: PROJECT_ID,
  name: '某茶空间',
  type: ProjectType.TeaSpace,
  address: '城区某路 1 号',
  clientName: '客户甲',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: '2026-01-01T00:00:00Z',
  plannedEndAt: '2026-03-01T23:59:59Z',
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

/** 阶段负责人 = 成员本人 → 成员在详情页有「相关阶段」（否则会先撞受限空态，看不到操作栏） */
const STAGE: Stage = {
  id: STAGE_ID,
  projectId: PROJECT_ID,
  orderIndex: 1,
  templateKey: null,
  colorIndex: 1,
  name: '现场勘测',
  ratioPercent: 100,
  startAt: '2026-01-05T00:00:00Z',
  endAt: '2026-01-20T23:59:59Z',
  status: StageStatus.InProgress,
  ownerId: MEMBER_ID,
  visible: true,
  resourcePath: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const TASK: Task = {
  id: 'tsk_dl2',
  taskNo: 1,
  projectId: PROJECT_ID,
  stageId: STAGE_ID,
  title: '放线',
  done: false,
  assigneeId: MEMBER_ID,
  assigneeIds: [MEMBER_ID],
  dueDate: '2026-01-15',
  source: 'human',
  externalId: null,
  agentId: null,
  status: TaskStatus.Todo,
  description: null,
  dependsOn: [],
  artifacts: [],
  startAt: null,
  claimedAt: null,
  orderIndex: 1,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeMember(id: string, name: string, roleKind: MemberRoleKind): Member {
  return {
    id,
    name,
    role: roleKind === MemberRoleKind.Admin ? '项目负责人' : '协作成员',
    contact: null,
    avatarColor: null,
    active: true,
    roleKind,
    passwordHash: null,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const ADMIN = makeMember(ADMIN_ID, '负责人甲', MemberRoleKind.Admin);
const MEMBER = makeMember(MEMBER_ID, '协作者乙', MemberRoleKind.Member);

type Actor = 'admin' | 'member' | 'none';

/**
 * 装数据 + 定身份。`hydrated` 默认 true（否则命中「正在装载…」闸门，测的就不是守卫了）。
 *
 * ⚠️ store 写入必须包在 `act()` 里：若已有树挂载着（同一用例内二次 `setActor`），
 * 裸写会触发「update … not wrapped in act」告警 —— 那是真实信号（`tests/setup.ts`
 * 明确要求不得靠关开关压回去），故在**源头**包住，而不是在每个调用点补。
 */
function setActor(actor: Actor, opts: { hydrated?: boolean } = {}): void {
  act(() => {
    useProjectsStore.getState().replaceAll({
      projects: [PROJECT],
      stages: [STAGE],
      tasks: [TASK],
    });
    useMembersStore.getState().setAll([ADMIN, MEMBER]);
    const currentMemberId =
      actor === 'admin' ? ADMIN_ID : actor === 'member' ? MEMBER_ID : null;
    useSettingsStore.setState({ currentMemberId, hydrated: opts.hydrated ?? true });
    useUiStore.setState({ stageDrawerStageId: null });
  });
}

/* ====================================================================================
 * 渲染 / 清理
 * ==================================================================================== */

let host: HTMLDivElement | null = null;
let root: Root | null = null;

/**
 * 卸载当前挂载的树。**同一用例内多次 render 必须先收掉前一棵**，否则孤儿树仍订阅 store，
 * 同进程（vitest `singleThread: true`）后续 spec 的 setState 会把它唤醒 → 跨文件污染。
 */
function unmountCurrent(): void {
  const r = root;
  if (r) {
    act(() => {
      r.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
}

/** 挂一棵任意 React 树（已在 MemoryRouter 内） */
function mount(node: React.ReactElement): HTMLDivElement {
  unmountCurrent();
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  root = createRoot(h);
  act(() => {
    root!.render(node);
  });
  return h;
}

/**
 * 按路径挂载真实路由表（子集）。
 * `/` 是重定向靶：`Navigate to="/"` 生效时页面上会出现 `[data-home-marker]`。
 */
function renderAt(path: string): HTMLDivElement {
  return mount(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div data-home-marker="">首页占位</div>} />
        <Route path="/project/:id" element={<ProjectDetailPage />} />
        <Route path="/project/:id/schedule-print" element={<SchedulePrintPage />} />
        <Route path="/project/:id/calendar-print" element={<CalendarPrintPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 是否被重定向到首页（`Navigate` 生效的唯一判据） */
const redirectedHome = (h: ParentNode): boolean => h.querySelector('[data-home-marker]') !== null;

/** 打印子树是否真的上屏（两页共同的稳定锚点：`.print-root`） */
const printed = (h: ParentNode): boolean => h.querySelector('.print-root') !== null;

/**
 * jsdom 缺 `matchMedia` / `ResizeObserver`（实测 undefined），而 `ProjectDetailPage`
 * 的窄屏判定与 `TimelineView` 的宽度观测都要它们。补最小桩：matchMedia 恒 `matches:false`
 * （= 桌面稿，渲染横向时间轴），ResizeObserver 为空实现。
 */
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

beforeEach(() => {
  localStorage.clear();
  installEnvStubs();
});

afterEach(() => {
  unmountCurrent();
  act(() => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  });
});

/* ====================================================================================
 * ① 行为：三档身份 × 两条打印路由
 * ==================================================================================== */

describe('v0.7-D · 打印页三档守卫（成员放开为只读导出）', () => {
  it('★ 成员访问 /schedule-print：不重定向，且真的渲染出打印内容', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);

    expect(redirectedHome(h), '成员不得被重定向回首页').toBe(false);
    expect(printed(h), '成员应看到打印子树').toBe(true);
    // 内容锚点：阶段清单表 + 打印时间轴（证明不是「留在了页内但渲染成空壳」）
    expect(h.textContent).toContain('阶段清单');
    expect(h.textContent).toContain('打印时间轴');
    expect(h.textContent).toContain(PROJECT.name);
    expect(h.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });

  it('★ 成员访问 /calendar-print：不重定向，且真的渲染出月历', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}/calendar-print`);

    expect(redirectedHome(h), '成员不得被重定向回首页').toBe(false);
    expect(printed(h)).toBe(true);
    expect(h.textContent).toContain('ID Plan 月历');
    expect(h.textContent).toContain('阶段色泽');
    expect(h.textContent).toContain(PROJECT.name);
  });

  it('★ 未进入身份（role=null）访问 /schedule-print：仍重定向回首页（不得并进允许档）', () => {
    setActor('none');
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);

    expect(redirectedHome(h), '未进入身份必须被挡回首页').toBe(true);
    expect(printed(h), '未进入身份不得看到打印子树').toBe(false);
  });

  it('★ 未进入身份（role=null）访问 /calendar-print：仍重定向回首页', () => {
    setActor('none');
    const h = renderAt(`/project/${PROJECT_ID}/calendar-print`);

    expect(redirectedHome(h)).toBe(true);
    expect(printed(h)).toBe(false);
  });

  it('对照组 · 管理员访问两条打印路由：均不重定向且渲染出内容（未被放开改动波及）', () => {
    setActor('admin');

    const sch = renderAt(`/project/${PROJECT_ID}/schedule-print`);
    expect(redirectedHome(sch)).toBe(false);
    expect(printed(sch)).toBe(true);
    expect(sch.textContent).toContain('阶段清单');

    const cal = renderAt(`/project/${PROJECT_ID}/calendar-print`);
    expect(redirectedHome(cal)).toBe(false);
    expect(printed(cal)).toBe(true);
    expect(cal.textContent).toContain('ID Plan 月历');
  });

  /**
   * 「装载闸门」与「身份闸门」是**两道**，顺序不能混：
   *   `!hydrated` → 加载态（不重定向）；`role === null` → 重定向。
   * 若有人把 `role === null` 并进 `!hydrated` 分支（或反过来），本用例会红。
   */
  it('闸门分档 · hydrated=false 时不重定向也不出内容，只出加载态（不得与身份闸门合并）', () => {
    setActor('member', { hydrated: false });
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);

    expect(redirectedHome(h), '装载未完成时不得重定向').toBe(false);
    expect(printed(h), '装载未完成时不得渲染打印内容').toBe(false);
    expect(h.textContent).toContain('正在装载日程表');
  });
});

/* ====================================================================================
 * ② 入口：成员真的进得去（路由放开 ≠ 入口放开）
 * ==================================================================================== */

/** 详情页「日程表」按钮：唯一判据 = 文本恰为「日程表」的按钮 */
const findScheduleEntry = (h: ParentNode): HTMLButtonElement | null =>
  Array.from(h.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === '日程表') ??
  null;

/** 卡片「导出日程表」入口：成员档是图标按钮，故按 aria-label 判 */
const findCardExportEntry = (h: ParentNode): HTMLButtonElement | null =>
  h.querySelector('button[aria-label="导出日程表"]');

describe('v0.7-D · 打印入口门控（ProjectDetailPage / ProjectCard）', () => {
  it('★ 成员在项目详情页看得到「日程表」入口，且看不到「归档」（放开打印 ≠ 放开写）', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}`);

    // 前提：详情页真的渲染了操作栏（否则下面的「看不到归档」是空过）
    expect(h.textContent).toContain(STAGE.name);

    expect(findScheduleEntry(h), '成员必须能看到日程表打印入口').toBeTruthy();

    const labels = Array.from(h.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());
    expect(labels, '成员不得看到归档（写操作仍 admin-only）').not.toContain('归档');
    expect(labels, '成员不得看到 Agent Board 入口（本轮未放开）').not.toContain('Agent Board');
  });

  it('对照组 · 管理员在项目详情页仍有「日程表」与「归档」', () => {
    setActor('admin');
    const h = renderAt(`/project/${PROJECT_ID}`);

    expect(findScheduleEntry(h)).toBeTruthy();
    const labels = Array.from(h.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());
    expect(labels).toContain('归档'); // ← 放开打印不得把管理员既有能力改掉
  });

  it('★ 未进入身份（role=null）在项目详情页看不到「日程表」入口（与打印页守卫同档）', () => {
    setActor('none');
    const h = renderAt(`/project/${PROJECT_ID}`);

    // 未进入身份命中受限空态（无任何相关阶段）
    expect(h.textContent).toContain('请先点击右上角「进入身份」');
    expect(findScheduleEntry(h), '未进入身份不得看到打印入口').toBeNull();
  });

  it('★ 成员在项目卡片上有独立的「导出日程表」入口；未进入身份没有', () => {
    setActor('member');
    const h = mount(
      <MemoryRouter>
        <ProjectCard
          project={PROJECT}
          stages={[STAGE]}
          tasks={[TASK]}
          members={[ADMIN, MEMBER]}
          todayIso={TODAY}
          onOpen={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(h.textContent).toContain(PROJECT.name); // 前提：卡片真的画了
    expect(findCardExportEntry(h), '成员必须能从卡片直接导出日程表').toBeTruthy();
    // 反向：管理员的 ⋯ 菜单（含重命名 / 外观 / 归档 / 删除四个写操作）不得下放给成员
    expect(h.querySelector('button[aria-label="项目更多操作"]'), '成员的卡片不得出现 ⋯ 写操作菜单').toBeNull();

    setActor('none');
    const h2 = mount(
      <MemoryRouter>
        <ProjectCard
          project={PROJECT}
          stages={[STAGE]}
          tasks={[TASK]}
          members={[ADMIN, MEMBER]}
          todayIso={TODAY}
          onOpen={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(findCardExportEntry(h2), '未进入身份不得看到导出入口').toBeNull();
  });

  it('对照组 · 管理员在项目卡片上仍有 ⋯ 菜单（且不混入成员的那个图标入口）', () => {
    setActor('admin');
    const h = mount(
      <MemoryRouter>
        <ProjectCard
          project={PROJECT}
          stages={[STAGE]}
          tasks={[TASK]}
          members={[ADMIN, MEMBER]}
          todayIso={TODAY}
          onOpen={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(h.querySelector('button[aria-label="项目更多操作"]'), '管理员必须仍有 ⋯ 菜单').toBeTruthy();
    expect(findCardExportEntry(h), '管理员走 ⋯ 菜单，不应再多一个重复入口').toBeNull();
  });
});

/* ====================================================================================
 * ③ 只读性：页内没有写入口，且点打印 / 导出不产生任何写
 * ==================================================================================== */

/** 打印页操作栏的只读控件白名单（前缀匹配，PNG 按钮文案带张数） */
const READONLY_LABELS = ['打印', '导出 PDF', '导出 PNG'];

describe('v0.7-D · 打印页对成员为只读（页内零写入口 + 点按钮零写库）', () => {
  it('★ 成员在日程表打印页：无任何表单控件，交互控件只剩只读集合', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);

    expect(printed(h)).toBe(true); // 前提：页面上屏了
    expect(
      h.querySelectorAll('input, select, textarea, [contenteditable="true"]').length,
      '打印页不得出现任何表单控件（成员会以为能改）',
    ).toBe(0);

    const labels = Array.from(h.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());
    expect(labels.length, '操作栏应有控件，否则下面的「全部只读」是空过').toBeGreaterThan(0);
    for (const l of labels) {
      expect(
        READONLY_LABELS.some((ok) => l === ok || l.startsWith(ok)),
        `打印页出现非只读控件：「${l}」`,
      ).toBe(true);
    }
  });

  it('★ 成员点「打印 / 导出 PDF」：真回调（不是死按钮），且 store 引用完全不变', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);

    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    try {
      const before = {
        projects: useProjectsStore.getState().projects,
        stages: useProjectsStore.getState().stages,
        tasks: useProjectsStore.getState().tasks,
        members: useMembersStore.getState().members,
      };

      const clickByLabel = (label: string): void => {
        const btn = Array.from(h.querySelectorAll('button')).find(
          (b) => (b.textContent ?? '').trim() === label,
        );
        expect(btn, `找不到「${label}」按钮`).toBeTruthy();
        act(() => {
          btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
      };

      clickByLabel('打印');
      clickByLabel('导出 PDF');

      // 真消费：两次点击都必须真的调到 window.print（否则是点了没反应的死按钮）
      expect(printSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

      const after = useProjectsStore.getState();
      expect(after.projects, '打印不得改写项目').toBe(before.projects);
      expect(after.stages, '打印不得改写阶段').toBe(before.stages);
      expect(after.tasks, '打印不得改写任务').toBe(before.tasks);
      expect(useMembersStore.getState().members, '打印不得改写成员').toBe(before.members);
    } finally {
      printSpy.mockRestore();
    }
  });

  it('★ 成员在月历打印页：同样零表单控件、交互控件只剩只读集合', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}/calendar-print`);

    expect(printed(h)).toBe(true);
    expect(h.querySelectorAll('input, select, textarea, [contenteditable="true"]').length).toBe(0);

    const labels = Array.from(h.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      expect(
        READONLY_LABELS.some((ok) => l === ok || l.startsWith(ok)),
        `月历打印页出现非只读控件：「${l}」`,
      ).toBe(true);
    }
  });
});

/* ====================================================================================
 * ④ 源码锁：守卫判据必须是 `role === null`，不得回落成 `!isAdmin` / `isRestrictedView(role)`
 *   （这两条正是本轮的两个高危变异方向，静态锁让它们**永久**红，不依赖人工复跑）
 * ==================================================================================== */

/** 读页面源码并**剥掉注释**（注释里会引用反面写法来解释为什么不那样写） */
function readCode(file: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { resolve } = require('node:path') as typeof import('node:path');
  const src = readFileSync(resolve(__dirname, '..', 'src', 'pages', file), 'utf8');
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('v0.7-D · 打印页守卫判据源码锁（变异方向永久红）', () => {
  for (const file of ['SchedulePrintPage.tsx', 'CalendarPrintPage.tsx']) {
    it(`★ ${file}：守卫为 role === null（不得 !isAdmin / 不得 isRestrictedView）`, () => {
      const code = readCode(file);

      // 正向：两档判据必须落在 role 上
      expect(code, '必须按 role === null 判定「未进入身份」').toContain('if (role === null)');
      expect(code).toContain('return <Navigate to="/" replace />;');

      // 反向（本轮两个高危变异方向）：
      //   ① 改回「受限即重定向」（isRestrictedView）→ 成员又被挡
      //   ② 用 !isAdmin 当判据 → 与 isRestrictedView 等价，同样的错
      expect(code, '不得用 isRestrictedView 作重定向判据').not.toContain('isRestrictedView');
      expect(code, '不得用 !isAdmin 作重定向判据').not.toContain('!isAdmin');
      // 铁律：页面内不得自写 !isMember 之类的派生
      expect(code, '不得自写 isMember 派生').not.toContain('isMember');
    });
  }
});
