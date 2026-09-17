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
 *   ④ **范围收窄 + 任务支**（v0.7-D 补漏 / 补锁）：成员在打印页只能看到「与自己相关」的阶段，
 *      相关性的**两支撑**（`ownerId` = 我 / 该阶段下有我参与的任务）各配**唯一自变量**，
 *      使任一支失效都会**变红**（详见「任务支」组的补锁背景）。
 *   ⑤ **不直读成员列表**（v0.7-D 收尾）：月历打印页历史上多一行
 *      `const members = useMembersStore((s) => s.members);` 而**整页从未读过** → 死订阅。
 *      角色派生已经由 `useRoleGuard()` 收口（`useRoleGuard.ts` 明文禁止组件直读 members），
 *      故锁「打印页除收口外**不得再读**成员列表」。判别式见 ⑦ 组（运行期计数，非源码 contain）。
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

/**
 * 成员列表 selector **调用计数**（⑦ 组「不直读成员列表」判别式的量具）。
 *
 * 为什么必须用 `vi.mock` 包一层、而不能 spy `useMembersStore.subscribe`：
 *   zustand 的 `create()` 返回的是 `useBoundStore`（`Object.assign(useBoundStore, api)`），
 *   而 `useStore(api, selector)` 订阅的是**闭包里捕获的 `api.subscribe`**。
 *   改写 `useMembersStore.subscribe` 只换掉了 bound hook 上的那份**拷贝**，
 *   `api.subscribe` 纹丝不动 → 计数恒 0，**任何变异都量不出来**（实测：删掉与保留该行
 *   都得 `subs: 0`）。故此处改为在模块边界上计数 selector 调用，实测能区分 2 ≠ 1。
 *
 * 包装是**透明**的：`Object.assign` 保留 `getState/setState/subscribe/setAll` 等全部成员，
 * 既有 32 条用例对 store 的读写与断言语义不变。
 */
const membersHookCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../src/store/useMembersStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/store/useMembersStore')>();
  const real = actual.useMembersStore;
  const counted = ((selector?: unknown) => {
    membersHookCalls.count += 1;
    return (real as unknown as (s?: unknown) => unknown)(selector);
  }) as unknown as typeof real;
  Object.assign(counted, real);
  return { ...actual, useMembersStore: counted };
});

import { SchedulePrintPage } from '../src/pages/SchedulePrintPage';
import { CalendarPrintPage } from '../src/pages/CalendarPrintPage';
import { ProjectDetailPage } from '../src/pages/ProjectDetailPage';
import { ProjectCard } from '../src/components/project/ProjectCard';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import { useRoleGuard } from '../src/hooks/useRoleGuard';
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

const PROJECT_ID = 'proj_dl2';
const STAGE_ID = 'stg_dl2';
const OTHER_STAGE_ID = 'stg_dl2_other';
const TASK_ONLY_STAGE_ID = 'stg_dl2_taskonly';
const ADMIN_ID = 'm-admin-dl2';
const MEMBER_ID = 'm-member-dl2';
const TODAY = '2026-02-01';

/** 成员相关的阶段名（成员应看到） */
const MY_STAGE_NAME = '现场勘测';
/** 与成员**无关**的阶段名（阶段负责人是管理员，其下也无成员的任务）——成员绝不应看到 */
const OTHER_STAGE_NAME = '幕墙专项深化';
/** 「任务支专供」阶段名：负责人是管理员，但成员在该阶段下有一条任务 → 成员**必须**看到 */
const TASK_ONLY_STAGE_NAME = '灯光专项深化';

const PROJECT: Project = {
  id: PROJECT_ID,
  name: '某茶空间',
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
  name: MY_STAGE_NAME,
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

/**
 * 「与我无关」的阶段（v0.7-D 补漏组的**核心自变量**）：
 *   · `ownerId = ADMIN_ID`（不是成员）且其下无成员参与的任务 → `computeRelatedStageIds` 不收它；
 *   · **`endAt` 刻意伸到项目计划基线之后（2026-06-20 vs 基线 2026-03-01）**——
 *     这是为了能钉死「月份范围也必须按收窄后的集合推算」：
 *     若只看 `visibleStages` 而漏改 `stageSpan(stages)`，成员月历仍会多出 4–6 月（空白页 + 跨度泄漏）。
 */
const OTHER_STAGE: Stage = {
  id: OTHER_STAGE_ID,
  projectId: PROJECT_ID,
  orderIndex: 2,
  templateKey: null,
  colorIndex: 2,
  name: OTHER_STAGE_NAME,
  ratioPercent: 100,
  startAt: '2026-05-01T00:00:00Z',
  endAt: '2026-06-20T23:59:59Z',
  status: StageStatus.NotStarted,
  ownerId: ADMIN_ID,
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

/**
 * ★「任务支专供」阶段（v0.7-D **补锁**组的新自变量，spec-only）：
 *   · `ownerId = ADMIN_ID` → `computeRelatedStageIds` 的「我负责」支**不成立**；
 *   · 其下有一条任务（`TASK_ONLY_TASK`）`assigneeIds` 含成员 → 「该阶段下有我参与的任务」支**成立**。
 *
 * 为什么必须单独造它（**结构性证明**，team-lead 复核给出）：
 *   `STAGE.ownerId = MEMBER_ID` 且其下也有成员任务 → **两支同时成立**，故它**无法区分**
 *   到底是哪一支在起作用；`OTHER_STAGE.ownerId = ADMIN_ID` 且其下无任务 → 两队支都不成立。
 *   于是「任务支」在旧夹具里**从不作为任何阶段被纳入的唯一理由** → 把 `tasks` 恒置空，
 *   相关性判定结果**一点不变** → 检查恒绿（**无效测试**）。本夹具是补上这个唯一理由。
 *
 * ⚠️ `endAt`（2026-02-28）刻意**留在项目计划基线内**（基线 2026-01-01 – 2026-03-01）：
 *   「月份范围收窄」那条断言（成员月历不得出现 `2026年6月`）必须由 `OTHER_STAGE` 独占自变量；
 *   若此处也伸出基线，两条断言会互相污染（改一处会同时动另一条）。
 */
const TASK_ONLY_STAGE: Stage = {
  id: TASK_ONLY_STAGE_ID,
  projectId: PROJECT_ID,
  orderIndex: 3,
  templateKey: null,
  colorIndex: 3,
  name: TASK_ONLY_STAGE_NAME,
  ratioPercent: 100,
  startAt: '2026-02-01T00:00:00Z',
  endAt: '2026-02-28T23:59:59Z',
  status: StageStatus.NotStarted,
  ownerId: ADMIN_ID,
  visible: true,
  resourcePath: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

/** 任务支的唯一凭据：分派给成员、但落在「负责人不是我」的阶段下 */
const TASK_ONLY_TASK: Task = {
  id: 'tsk_dl2_taskonly',
  taskNo: 2,
  projectId: PROJECT_ID,
  stageId: TASK_ONLY_STAGE_ID,
  title: '灯具选型',
  done: false,
  assigneeId: MEMBER_ID,
  assigneeIds: [MEMBER_ID],
  dueDate: '2026-02-10',
  source: 'human',
  externalId: null,
  agentId: null,
  status: TaskStatus.Todo,
  description: null,
  dependsOn: [],
  artifacts: [],
  startAt: null,
  claimedAt: null,
  orderIndex: 2,
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
function setActor(
  actor: Actor,
  opts: { hydrated?: boolean; stages?: Stage[]; tasks?: Task[] } = {},
): void {
  act(() => {
    useProjectsStore.getState().replaceAll({
      projects: [PROJECT],
      // 默认三段，**刻意覆盖两支撑的全部三种组合**（这是「范围收窄」组的自变量完整性）：
      //   · STAGE           → ownerId 支 ✅ + 任务支 ✅（两支都成立，无法单独归因）
      //   · TASK_ONLY_STAGE → ownerId 支 🚫 + 任务支 ✅（**仅任务支成立** → 任务的唯一自变量）
      //   · OTHER_STAGE     → ownerId 支 🚫 + 任务支 🚫（两支都不成立 → 必须被收掉）
      // 少了中间这段，`tasks` 订阅就是**无行为差异的必要输入**（删掉检查不会红）= 无效测试。
      stages: opts.stages ?? [STAGE, TASK_ONLY_STAGE, OTHER_STAGE],
      tasks: opts.tasks ?? [TASK, TASK_ONLY_TASK],
    });
    useMembersStore.getState().setAll([ADMIN, MEMBER]);
    const currentMemberId =
      actor === 'admin' ? ADMIN_ID : actor === 'member' ? MEMBER_ID : null;
    useSettingsStore.setState({ currentMemberId, hydrated: opts.hydrated ?? true });
    useUiStore.setState({ stageDrawerStageId: null });
  });
}

/** 「成员零相关阶段」场景：项目里只有与成员无关的阶段（负责人是管理员，其下无成员任务） */
const ZERO_RELATED: { stages: Stage[]; tasks: Task[] } = { stages: [OTHER_STAGE], tasks: [] };

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
  it('闸门分档 · hydrated=false 时**两页**都不重定向也不出内容，只出加载态（不得与身份闸门合并）', () => {
    // ⚠️ 补锁（消融普查发现）：原用例只跑了 `schedule-print` → CalendarPrintPage 的
    //    装载闸门消融后**全绿**（未锁住）。两页都有这道闸门，故两页都断言。
    setActor('member', { hydrated: false });

    for (const [path, loadingText] of [
      ['schedule-print', '正在装载日程表'],
      ['calendar-print', '正在装载月历'],
    ] as const) {
      const h = renderAt(`/project/${PROJECT_ID}/${path}`);

      expect(redirectedHome(h), `${path}：装载未完成时不得重定向`).toBe(false);
      expect(printed(h), `${path}：装载未完成时不得渲染打印内容`).toBe(false);
      expect(h.textContent, `${path}：应出加载态`).toContain(loadingText);
    }
  });

  it('★ 未知项目 id：两页均出「未找到该项目」（不是崩溃、不是白页、也不是重定向）', () => {
    // ⚠️ 补锁（消融普查发现）：去掉 `if (!project)` 空态后**全绿**（未锁住）。
    //    这条分支是「成员点了一个已被删除 / 别人发来的失效链接」的真实路径。
    setActor('member');

    for (const path of ['schedule-print', 'calendar-print']) {
      const h = renderAt(`/project/__not_exist__/${path}`);

      expect(h.textContent, `${path}：未知项目应给出明确空态`).toContain('未找到该项目');
      expect(printed(h), `${path}：未知项目不得渲染打印稿`).toBe(false);
      expect(
        redirectedHome(h),
        `${path}：未知项目**不是**「未进入身份」，不得被重定向（两档不可混同）`,
      ).toBe(false);
    }
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

/**
 * 取 `marker` 之后的 `len` 个字符（= 该调用点的**实参窗口**）。
 * 用于「某项必须出现在**这个调用**里」，避免全文 `contain` 被同名的无关位置假绿。
 * `marker` 不存在时返回空串 → 断言必然失败（漏了 marker 也算红）。
 */
function windowAfter(code: string, marker: string, len: number): string {
  const i = code.indexOf(marker);
  return i === -1 ? '' : code.slice(i, i + len);
}

describe('v0.7-D · 打印页守卫判据源码锁（变异方向永久红）', () => {
  for (const file of ['SchedulePrintPage.tsx', 'CalendarPrintPage.tsx']) {
    it(`★ ${file}：守卫为 role === null（不得 !isAdmin / 不得用受限判定作重定向条件）`, () => {
      const code = readCode(file);

      // 正向：两档判据必须落在 role 上
      expect(code, '必须按 role === null 判定「未进入身份」').toContain('if (role === null)');
      expect(code).toContain('return <Navigate to="/" replace />;');

      // 反向（本轮两个高危变异方向）——注意锁的是「当重定向条件用」，而不是「文件里出现过」：
      //   v0.7-D 补漏后两页**合法地**导入了 isRestrictedView（用来算 memberView 收窄范围），
      //   故这里只禁 `if (isRestrictedView(` / `if (!isAdmin)` 这种**当守卫用**的写法。
      expect(code, '不得用 isRestrictedView 当重定向判据').not.toContain('if (isRestrictedView(');
      expect(code, '不得用 !isAdmin 当重定向判据').not.toContain('if (!isAdmin)');
      // 铁律：页面内不得自写 !isMember 之类的派生
      expect(code, '不得自写 isMember 派生').not.toContain('isMember');
    });
  }
});

/* ====================================================================================
 * ⑤ 阶段范围 + 委托方（v0.7-D 补漏 · team-lead 复审认定「真漏」）
 *
 * 事实依据（team-lead 核出，本轮按此修）：
 *   ① `ProjectDetailPage.tsx:60,64-77` 与 `MonthlyCalendarView.tsx:131,162-172` **都**按
 *      `computeRelatedStageIds` 收窄；两个打印页原先是**唯一例外**（全量 `visible !== false`）
 *      → 成员只要打开打印页就能看到项目全量阶段 = 绕过成员可见性规则的侧门。
 *   ② `ProjectDetailPage.tsx:181` 明确 `{!memberView && project.clientName && …}`，
 *      而打印页原先**无条件**渲染 `委托方：`（放开前只对 admin 开放，故当时是对的；
 *      放开后就成了「同一条数据一处屏蔽一处敞开」的洞）。
 *
 * ⚠️ 为什么不能只断言「成员看不到无关阶段」：
 *   把打印页整页删掉、或者让成员又撞回重定向，都能让这条变绿（假绿）。
 *   故每组都配 **admin 对照组**（必须照旧看到全量 + 委托方），并另断言「成员仍看得到自己的阶段」。
 * ==================================================================================== */

/** 某段阶段名是否出现在页面上（日历页以 `（阶段名）` 形态落在「阶段色泽」行） */
const showsStage = (h: ParentNode, name: string): boolean => (h.textContent ?? '').includes(name);

describe('v0.7-D 补漏 · 打印页阶段范围按成员收窄（与详情页 / 月历同一口径）', () => {
  it('★ 成员 · 日程表打印页：看得到自己的阶段，看不到与自己无关的阶段', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);

    expect(printed(h), '前提：成员仍在页内（不是又撞回重定向）').toBe(true);
    expect(showsStage(h, MY_STAGE_NAME), '成员必须看得到自己的阶段（ownerId 支）').toBe(true);
    expect(showsStage(h, TASK_ONLY_STAGE_NAME), '成员必须看得到自己的阶段（任务支）').toBe(true);
    expect(showsStage(h, OTHER_STAGE_NAME), '成员不得看到与自己无关的阶段').toBe(false);

    // 阶段清单表的行数必须恰为「我的相关阶段」数（2 = STAGE + TASK_ONLY_STAGE），而非全量（3）
    expect(h.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('★ 成员 · 月历打印页：图例只列自己的阶段，不含无关阶段名', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}/calendar-print`);

    expect(printed(h)).toBe(true);
    expect(showsStage(h, MY_STAGE_NAME), '成员必须看得到自己的阶段（ownerId 支）').toBe(true);
    expect(showsStage(h, TASK_ONLY_STAGE_NAME), '成员必须看得到自己的阶段（任务支）').toBe(true);
    expect(showsStage(h, OTHER_STAGE_NAME), '成员不得看到与自己无关的阶段').toBe(false);
  });

  it('★ 成员 · 月历打印页：月份范围也只按收窄后的阶段推算（无关阶段不得撑开月份）', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}/calendar-print`);

    // OTHER_STAGE 伸到 2026-06，项目基线只到 2026-03。
    // 若只改 `visibleStages` 而漏改 `stageSpan(stages)` / `computeCalendarEntry(project, stages, …)`，
    // 成员月历会多出 4–6 月（既泄漏「项目跨度到此」的事实，又多出空白页）。
    expect(showsStage(h, '2026年6月'), '成员月历不得出现无关阶段撑开的月份').toBe(false);
    expect(showsStage(h, '2026年3月'), '项目基线内的月份照旧要有').toBe(true);
  });

  it('对照组 · 管理员 · 两页均照旧看到全量阶段（含无关阶段）——收紧不得收过头', () => {
    setActor('admin');

    const sch = renderAt(`/project/${PROJECT_ID}/schedule-print`);
    expect(showsStage(sch, MY_STAGE_NAME)).toBe(true);
    expect(showsStage(sch, TASK_ONLY_STAGE_NAME), '管理员必须仍看到全量阶段').toBe(true);
    expect(showsStage(sch, OTHER_STAGE_NAME), '管理员必须仍看到全量阶段').toBe(true);
    expect(sch.querySelectorAll('tbody tr').length).toBe(3);

    const cal = renderAt(`/project/${PROJECT_ID}/calendar-print`);
    expect(showsStage(cal, TASK_ONLY_STAGE_NAME), '管理员必须仍看到全量阶段').toBe(true);
    expect(showsStage(cal, OTHER_STAGE_NAME), '管理员必须仍看到全量阶段').toBe(true);
    expect(showsStage(cal, '2026年6月'), '管理员月历照旧覆盖到无关阶段所在月份').toBe(true);
  });

  it('★ 成员 · 零相关阶段：两页均走受限空态（不输出白纸稿、不输出全量）', () => {
    setActor('member', ZERO_RELATED);

    for (const path of ['schedule-print', 'calendar-print']) {
      const h = renderAt(`/project/${PROJECT_ID}/${path}`);
      expect(printed(h), `${path}：零相关阶段时不得输出打印稿`).toBe(false);
      expect(h.textContent, `${path}：应明确告知与成员无关`).toContain('该项目的阶段与你无关');
      expect(showsStage(h, OTHER_STAGE_NAME), `${path}：空态里也不得泄漏无关阶段`).toBe(false);
      // 反向：不是「把页面搞崩了」——要能看到返回入口
      expect(h.textContent).toContain('返回我的任务');
    }
  });
});

/* ------------------------------------------------------------------------------------
 * ★ 补锁组：打印页「任务支」（阶段负责人**不是我**，但任务分派给我）
 *
 * 补锁背景（本轮自查发现的**无效测试**，team-lead 定夺必须补）：
 *   旧夹具里成员相关性只由 `STAGE.ownerId = MEMBER_ID` 满足，任务支从不作为
 *   **任何阶段被纳入的唯一理由** → 把两页的 `tasks` 订阅恒置空，检查**全绿**。
 *   即：一行**必要**的订阅（删掉 → 成员被误判「零相关阶段」→ 看到用户可见的错误空态）
 *   完全没有用例锁住，将来任何一次重构都能顺手删掉而无人察觉。
 *   这两个用例把「任务支」变成唯一自变量，并配 `OTHER_STAGE` 反向断言
 *   （防止把「收窄」写成「不过滤」——若写成不过滤，OTHER_STAGE 会一起冒出来变红）。
 * ------------------------------------------------------------------------------------ */
describe('v0.7-D 补锁 · 打印页「任务支」（负责人不是我、任务分派给我）', () => {
  it('★ 成员 · 日程表打印页：仅任务支成立的阶段必须被纳入（恒空 tasks → 本用例红）', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);

    expect(printed(h), '前提：成员仍在页内').toBe(true);
    expect(
      showsStage(h, TASK_ONLY_STAGE_NAME),
      '「任务分派给我、但阶段负责人不是我」的阶段必须出现在日程表打印稿上',
    ).toBe(true);
    // 反向：收窄仍在生效（不是被写成「不过滤」）
    expect(showsStage(h, OTHER_STAGE_NAME), '两支都不成立的阶段仍不得出现').toBe(false);
    // 行数 = 相关阶段数 2（STAGE + TASK_ONLY_STAGE），不是全量 3、也不是只有 STAGE 的 1
    expect(h.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('★ 成员 · 月历打印页：仅任务支成立的阶段必须被纳入（恒空 tasks → 本用例红）', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}/calendar-print`);

    expect(printed(h), '前提：成员仍在页内').toBe(true);
    expect(
      showsStage(h, TASK_ONLY_STAGE_NAME),
      '「任务分派给我、但阶段负责人不是我」的阶段必须出现在月历打印稿的色泽说明里',
    ).toBe(true);
    expect(showsStage(h, OTHER_STAGE_NAME), '两支都不成立的阶段仍不得出现').toBe(false);
  });

  it('反向对照 · 若该阶段改为「负责人是我」（ownerId 支也成立）：原本两条用例仍应绿', () => {
    // 本用例是把「任务支是唯一理由」变成可复核的事实：
    // `TASK_ONLY_STAGE.ownerId` 换成成员后，阶段**依然可见**（改由 ownerId 支成立），
    // 故上面两条仍绿 → 证明它们**不是**被 ownerId 支顺带满足的（M5 方向）。
    setActor('member', {
      stages: [
        STAGE,
        { ...TASK_ONLY_STAGE, ownerId: MEMBER_ID },
        OTHER_STAGE,
      ],
      tasks: [TASK, TASK_ONLY_TASK],
    });
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);

    expect(showsStage(h, TASK_ONLY_STAGE_NAME), 'ownerId 支成立时同样可见（反向对照）').toBe(true);
    expect(showsStage(h, OTHER_STAGE_NAME)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------
 * ★ 补锁组：月历打印页页脚「打印人」
 *   消融普查发现：把页脚的 `{currentMember?.name ?? '—'}` 恒置空 → 全绿（未锁住）。
 *   team-lead 判定该署名**本就正常**（署打印者自己的名；对外交付物上属正常行为），
 *   故它不是「要改名」而是「要锁住」：锁「印的是**本人**」且「不露他人姓名」。
 * ------------------------------------------------------------------------------------ */
describe('v0.7-D 补锁 · 月历打印页页脚「打印人」只印本人（不露他人姓名）', () => {
  it('★ 成员 · 页脚出现「打印人：本人姓名」，且不含他人姓名', () => {
    setActor('member');
    const h = renderAt(`/project/${PROJECT_ID}/calendar-print`);

    expect(printed(h), '前提：成员仍在页内').toBe(true);
    expect(h.textContent, '页脚应有「打印人」署名').toContain('打印人：');
    expect(h.textContent, '应印本人姓名').toContain(MEMBER.name);
    expect(h.textContent, '不得印出他人姓名').not.toContain(ADMIN.name);
  });
});

describe('v0.7-D 补漏 · 打印页「委托方」仅管理员可见（与详情页同一门控）', () => {
  it('★ 成员 · 两页均不出现「委托方」字样（客户名不因打印而敞开）', () => {
    setActor('member');

    const sch = renderAt(`/project/${PROJECT_ID}/schedule-print`);
    expect(sch.textContent, '日程表打印页不得出现委托方').not.toContain('委托方');
    expect(sch.textContent, '客户名本身也不得出现').not.toContain(PROJECT.clientName);

    const cal = renderAt(`/project/${PROJECT_ID}/calendar-print`);
    expect(cal.textContent, '月历打印页不得出现委托方').not.toContain('委托方');
    expect(cal.textContent, '客户名本身也不得出现').not.toContain(PROJECT.clientName);
  });

  it('对照组 · 管理员 · 两页均照旧出现「委托方：客户甲」', () => {
    setActor('admin');

    const sch = renderAt(`/project/${PROJECT_ID}/schedule-print`);
    expect(sch.textContent).toContain('委托方');
    expect(sch.textContent).toContain(PROJECT.clientName);

    const cal = renderAt(`/project/${PROJECT_ID}/calendar-print`);
    expect(cal.textContent).toContain('委托方');
    expect(cal.textContent).toContain(PROJECT.clientName);
  });
});

/* ====================================================================================
 * ⑦ 死订阅锁（v0.7-D 收尾）：打印页除**收口**外不得再直读成员列表
 *
 * 事实：`CalendarPrintPage.tsx` 历史上有一行 `const members = useMembersStore((s) => s.members);`，
 * 而该变量在整页**零引用**（grep 只有 import 与这一行）→ 死订阅。
 * 角色派生已由 `useRoleGuard()` 收口（`useRoleGuard.ts:8-9` 明文「禁止组件直接读 members
 * 比对 roleKind」），故删掉它同时满足「去死代码」与「收口纪律」。
 *
 * ⚠️ 两处**必须更正**的常见说法（都有实测依据，不要照抄）：
 *   ① 它不是「无谓的重渲染触发源」：实测「改成员列表 → 该页多渲染 1 次」在**删前删后都一样**
 *      （`React.Profiler` 计数：删前 `1→2`，删后仍 `1→2`）——因为 `useRoleGuard()` 订阅的是
 *      **同一个 `members` slice**，重渲染照旧发生。删它是「收口 + 去死代码」，**不是性能优化**。
 *   ② 判别式**不能**用「源码 contain/not-contain」（本项目明令禁止的恒真写法），
 *      也**不能**用「订阅数」（改 `useMembersStore.subscribe` 量不到，恒 0，见上方 mock 注释）；
 *      能用的是「运行期 selector 调用次数」。而调用次数**不能**断言为 0：`useRoleGuard()`
 *      本身就要读一次（正是允许的那次）。故采用**差分**：与「只走收口的对照组件」逐次比对，
 *      多出任何一次 = 有人又加了一条直读。
 * ------------------------------------------------------------------------------------ */

/** 只走收口的对照组件：它读成员列表的次数 = 「合法基线」 */
function RoleGuardOnlyProbe(): React.ReactElement {
  useRoleGuard();
  return <div data-role-guard-probe="" />;
}

/**
 * 量一次「渲染 `node` 期间，成员列表 selector 被调用了几次」。
 * 用 `mount`（会对齐前一棵树做 unmount）保证计数不被上一棵树的残留影响。
 */
function countMembersHookCalls(node: React.ReactElement): number {
  membersHookCalls.count = 0;
  mount(node);
  return membersHookCalls.count;
}

describe('v0.7-D 收尾 · 打印页不得直读成员列表（角色派生只经 useRoleGuard 收口）', () => {
  it('★ 月历打印页：成员列表 selector 调用次数 == 仅走收口的次数（多一次 = 死订阅回来了）', () => {
    setActor('member');

    const baseline = countMembersHookCalls(<RoleGuardOnlyProbe />);
    // 前提：基线必须真的 >0，否则「相等」是 0==0 的假绿（判别式自身有效性）
    expect(
      baseline,
      '前提：useRoleGuard 必须真的读一次成员列表（基线为 0 说明量具失效）',
    ).toBeGreaterThan(0);

    membersHookCalls.count = 0;
    const h = renderAt(`/project/${PROJECT_ID}/calendar-print`);
    expect(printed(h), '前提：页面真的渲染了（否则计数无意义）').toBe(true);
    const pageCalls = membersHookCalls.count;

    expect(
      pageCalls,
      `月历打印页除 useRoleGuard 外不得再直读成员列表：实测 ${pageCalls} 次，收口基线 ${baseline} 次` +
        `（多出的 ${pageCalls - baseline} 次即那行死订阅）`,
    ).toBe(baseline);
  });

  it('★ 日程表打印页：同样不得多读一次（该页的 members 是喂给组装函数的**在用**输入，另见下注）', () => {
    // 说明：`SchedulePrintPage` 的 `members` **不是**死代码——它被传给
    // `buildScheduleSections({ …, members })` 组装 `assigneeNames`（grep 可证）。
    // 但打印渲染层从不读 `assigneeNames`（§5.3 登记在案的「不可观测输入」），
    // 故本轮**不动源码**、也不锁成 2 次（那会把「可以优化」误锁成「必须如此」）。
    // 本用例只钉住它的**下界**：不得出现「又多一条纯死直读」。
    setActor('member');

    const baseline = countMembersHookCalls(<RoleGuardOnlyProbe />);
    expect(baseline).toBeGreaterThan(0);

    membersHookCalls.count = 0;
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);
    expect(printed(h), '前提：页面真的渲染了').toBe(true);

    expect(
      membersHookCalls.count,
      '日程表打印页最多只应有「收口 1 次 + 组装用 1 次」，多出即新增死直读',
    ).toBeLessThanOrEqual(baseline + 1);
  });
});

/* ====================================================================================
 * ⑥ 源码锁（补漏组）：范围收窄与委托方门控的静态钉死
 * ==================================================================================== */

/**
 * 找出**未被 `role === 'admin'` 门控**的「委托方」出现点。
 * 做法：全文扫 `委托方`，回溯 400 字符窗口，要求窗口里出现 `role === 'admin'`。
 * （注释已由 `readCode` 剥掉，故注释里引用「委托方」不会误伤。）
 */
function ungatedClientNameSpots(code: string): string[] {
  const spots: string[] = [];
  let idx = code.indexOf('委托方');
  while (idx !== -1) {
    const window = code.slice(Math.max(0, idx - 400), idx);
    if (!window.includes("role === 'admin'")) spots.push(code.slice(idx, idx + 40));
    idx = code.indexOf('委托方', idx + 1);
  }
  return spots;
}

describe('v0.7-D 补漏 · 源码锁（范围收窄 / 委托方门控）', () => {
  it('★ SchedulePrintPage：走 computeRelatedStageIds，且阶段入参是收窄后的集合', () => {
    const code = readCode('SchedulePrintPage.tsx');

    expect(code, '必须走既有唯一口径 computeRelatedStageIds').toContain('computeRelatedStageIds');
    expect(code, 'memberView 口径必须与详情页一致').toContain('isRestrictedView(role)');
    // 反向：不得把**全量** stages 直接喂给打印数据组装（退回全量 → 红）
    expect(code, '不得把全量 stages 喂给 buildScheduleSections').not.toContain(
      'buildScheduleSections({ project, stages,',
    );
    // 空态必须存在（零相关阶段时不得输出白纸稿）
    expect(code).toContain('该项目的阶段与你无关');
  });

  it('★ CalendarPrintPage：三处取数同源吃 `scopedStages`（漏改一处即半成品修法）', () => {
    const code = readCode('CalendarPrintPage.tsx');

    expect(code, '必须走既有唯一口径 computeRelatedStageIds').toContain('computeRelatedStageIds');
    expect(code, 'memberView 口径必须与详情页一致').toContain('isRestrictedView(role)');
    // 反向：不得用**全量** stages 推算月份跨度（只改 visibleStages 漏改这处 → 红）
    expect(code, 'stageSpan 必须吃收窄后的集合').not.toContain('stageSpan(stages)');
    expect(code, 'computeCalendarEntry 必须吃收窄后的集合').not.toContain(
      'computeCalendarEntry(project, stages,',
    );
    // 正向：收窄后的集合变量必须真的被用于可见阶段过滤
    expect(code).toContain('scopedStages.filter((s) => s.visible !== false)');
    expect(code).toContain('该项目的阶段与你无关');
  });

  /**
   * ★ 补锁：订阅本身。
   *
   * 这条用例是修一个**「名字强于断言」**的问题：原用例名写作「订阅 `tasks`（收窄判定需要）」，
   * 但断言里**从未检查 `tasks`** —— 名字承诺的东西没被验证，属于「我以为锁住了」。
   * 现把「订阅存在」变成真断言，且两页各锁一遍（两页都依赖它）。
   *
   * ⚠️ 这是**静态**锁，只证明源码里放着这行订阅；**行为**由上面「任务支」组的两个用例保证。
   *    两者缺一不可：静态锁防「顺手删掉」，行为用例防「订阅写了但没用上」（如接错 projectId）。
   */
  it('★ 两页：必须按 projectId 订阅 tasks（收窄的「任务支」唯一输入）', () => {
    for (const file of ['SchedulePrintPage.tsx', 'CalendarPrintPage.tsx']) {
      const code = readCode(file);
      /*
       * ⚠️ v0.8 同批更新（设计 §9.1「会被本版改动的现有测试必须与源码同批改」）：
       *   本用例原先锁的是**订阅的写法** `useProjectsStore((s) => s.tasks.filter((t) => t.projectId === id))`。
       *   v0.8 把这两页的原始读收口到单一漏斗（§7.1 纪律 1 / §7.5），
       *   现在锁的是**同一件事的新写法**：`useProjectTasks(id)` ——
       *   `visibility.ts` 里那个按 projectId 收窄的唯一出口。
       *
       *   这不是"为了让用例变绿而放宽"：**两个方向都还在**——
       *     ① 正向：必须存在按 id 收窄的订阅（`useProjectTasks(id)`）；
       *     ② 反向：不得退回**不按项目收窄**的原始 `s.tasks` 订阅
       *        （退回即"收窄的『任务支』全空 → 成员被误判零相关阶段"，正是本用例要防的那条）。
       *   行为面（computeRelatedStageIds 的实参窗口）由下面几行继续保证，未改动。
       */
      expect(
        code,
        `${file}：必须按 projectId 订阅 tasks（恒空 → 成员被误判零相关阶段）`,
      ).toContain('useProjectTasks(id)');
      expect(
        code,
        `${file}：不得退回不按项目收窄的全量 tasks 订阅（v0.8 §7.1 纪律 1）`,
      ).not.toContain('.tasks');
      // 反向：订阅了却把它排除在收窄判定之外 = 白订阅。
      // 注意**必须**只看 `computeRelatedStageIds(` 的实参窗口——`tasks,` 在整份文件里
      // 还出现在 `buildScheduleSections({ … tasks … })` 等无关位置，全文 contain 会假绿。
      const callWindow = windowAfter(code, 'computeRelatedStageIds({', 300);
      expect(callWindow, `${file}：computeRelatedStageIds 的实参窗口应被截到`).toContain(
        'currentMemberId',
      );
      expect(callWindow, `${file}：tasks 必须真的喂给 computeRelatedStageIds`).toContain('tasks');
    }
  });

  it('★ 两页：「委托方」必须被 role === "admin" 门控（不得无条件渲染）', () => {
    for (const file of ['SchedulePrintPage.tsx', 'CalendarPrintPage.tsx']) {
      const code = readCode(file);
      // 前提：该文件确实渲染了委托方（否则下面的「全部有门控」是空过）
      expect(code, `${file} 应包含「委托方」`).toContain('委托方');
      expect(ungatedClientNameSpots(code), `${file} 存在无门控的「委托方：」`).toEqual([]);
    }
  });
});
