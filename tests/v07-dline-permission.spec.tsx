// @vitest-environment jsdom
/**
 * v0.7 · T04 D 线（外壳与权限）· jsdom 层验收。
 *
 * 覆盖三件 jsdom 判得了的事（涉及真断点/真布局的那几件在真 Chromium spec
 * `v07-dline-shell.spec.ts`）：
 *
 *   ① **UI 偏好键 `memberBoardView` 的读写与降级** —— V1-25（成员能切到月历且刷新不丢）。
 *      最要紧的一条是**键隔离**：`memberBoardView` 若复用管理员的 `idplan.homeView`，
 *      两个角色的视图状态会互相污染。故本文件**专门断言「改 A 不动 B」**，
 *      而不是只断言「能存能读」——后者在「复用了同一个键」的实现下**照样全绿**（假绿）。
 *
 *   ② **V1-28 ② · 阶段资料路径的成员门控**（P0-19-①）。
 *      以 member 身份渲染 `StageDrawer`：
 *        · `resourcePath` 有值 → **不存在**「修改」按钮；只读展示（打开 / 复制路径）保留。
 *        · `resourcePath` 为 null → `ResourcePathButton` **整体不渲染**（看不到登记入口）。
 *        · 对照组：**admin** 在同样两场景下必须**照旧**能改 / 能登记 ——
 *          没有这条对照，把「修改」按钮从所有角色删掉也能让前两条变绿（假绿）。
 *
 * ── 为什么必须带 admin 对照组 ──
 *   本次是**收紧**类改动（唯一允许收紧的一处）。收紧类改动最容易「收过头」：
 *   把管理员的写入口一起掐掉，界面上不会有任何报错，只有成员那两条用例变绿。
 *   故每个 member 断言都配一条 admin 反向断言。
 *
 *   ③ **E1 空状态的「直接手动建档」CTA 必须不渲染**（team-lead 复审发现的**死按钮**回归锁）。
 *      `CalendarEmptyStates` 的 E1 原为无条件渲染 + `onManual?.()`，只让点击失效、按钮照画，
 *      于是成员（`MemberBoardPage` 传 `onManual={undefined}`）会看到一个点了毫无反应的
 *      `variant="primary"` 主按钮。现改为 `{onManual && …}` 条件渲染，本组断言的是
 *      「**文本不存在**」（「点了没反应」在旧实现下会假绿）。
 *
 * 只依赖 react-dom/client 原生渲染，不引入 testing-library（与仓库既有组件测同款）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/**
 * 打开 React 的 act 环境开关。
 * 不设这一条时 `act()` 只发警告而不保证同步 flush，下面的「点『修改』→ 出现『保存』」
 * 这类**由事件驱动的状态更新**断言会读到更新前的 DOM（实测即为该失败）。
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 顶掉真实仓储：`ResourcePathButton` / `StageDrawer` 经 `useRepos()` 读 Context，
 * 本文件只关心**渲染出的 DOM**（有没有那个按钮），故用最小假 bundle 免去 Dexie 装配。
 * `vi.mock` 工厂被提升，不能引用模块顶层变量——全部在工厂内定义。
 */
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
    settings: {
      get: async () => null,
      set: ok,
      all: async () => [],
      replaceAll: ok,
    },
  };
  return { useRepos: (): unknown => bundle };
});

import { StageDrawer } from '../src/components/stage-detail/StageDrawer';
import { ResourcePathButton } from '../src/components/stage-detail/ResourcePathButton';
import { CalendarEmptyStates } from '../src/components/calendar/CalendarEmptyStates';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useUiStore } from '../src/store/useUiStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ProjectType,
  ScheduleBasis,
  StageStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage } from '../src/core/types/entities';

/* ====================================================================================
 * ① memberBoardView：UI 偏好键的读写、降级与**键隔离**
 * ==================================================================================== */

describe('v0.7 D 线 · memberBoardView 持久化（P0-18）', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('无存档时默认 kanban，与管理员首页视图的默认值一致（不互相影响）', async () => {
    const mod = await import('../src/store/useUiStore');
    expect(mod.useUiStore.getState().memberBoardView).toBe('kanban');
    expect(mod.useUiStore.getState().homeViewMode).toBe('kanban');
  });

  it('切到 calendar 即落盘到 idplan.memberBoardView；重新装载 store 后读回 calendar', async () => {
    const mod = await import('../src/store/useUiStore');
    expect(mod.useUiStore.getState().memberBoardView).toBe('kanban');

    mod.useUiStore.getState().setMemberBoardView('calendar');
    // 落盘键必须是**成员专用键**
    expect(localStorage.getItem('idplan.memberBoardView')).toBe('calendar');

    // 重新装载模块 = 模拟「刷新页面」重新初始化 store
    vi.resetModules();
    const fresh = await import('../src/store/useUiStore');
    expect(fresh.useUiStore.getState().memberBoardView).toBe('calendar');
  });

  it('★ 键隔离：写 memberBoardView 不动 homeViewMode，写 homeViewMode 不动 memberBoardView', async () => {
    vi.resetModules();
    const mod = await import('../src/store/useUiStore');

    // 成员切月历 → 管理员的首页键**不得**被写（否则管理员下次进首页会莫名落在月历）
    mod.useUiStore.getState().setMemberBoardView('calendar');
    expect(mod.useUiStore.getState().homeViewMode).toBe('kanban');
    expect(localStorage.getItem('idplan.homeView')).toBeNull();

    // 管理员切月历 → 成员键**不得**被写（否则成员下次进看板页会莫名落在月历）
    mod.useUiStore.getState().setHomeViewMode('calendar');
    expect(localStorage.getItem('idplan.homeView')).toBe('calendar');
    // 成员键仍是上一次自己写的值，没有被对方的操作覆盖
    expect(localStorage.getItem('idplan.memberBoardView')).toBe('calendar');

    // 交叉装载一次：只写 homeView 的场景下，成员视图必须仍是默认 kanban
    localStorage.clear();
    localStorage.setItem('idplan.homeView', 'calendar');
    vi.resetModules();
    const cross = await import('../src/store/useUiStore');
    expect(cross.useUiStore.getState().homeViewMode).toBe('calendar');
    expect(cross.useUiStore.getState().memberBoardView).toBe('kanban'); // ← 没有被连带改掉
  });

  it('存档值非法（脏数据 / 非字符串）时回落 kanban，不抛错', async () => {
    localStorage.setItem('idplan.memberBoardView', '{not-a-mode}');
    vi.resetModules();
    const mod = await import('../src/store/useUiStore');
    expect(mod.useUiStore.getState().memberBoardView).toBe('kanban');
  });

  it('存储不可用（getItem / setItem 抛错）时静默降级为「仅当前会话生效」，不抛错', async () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    try {
      vi.resetModules();
      const mod = await import('../src/store/useUiStore');
      expect(mod.useUiStore.getState().memberBoardView).toBe('kanban'); // 读失败 → 回落
      expect(() => mod.useUiStore.getState().setMemberBoardView('calendar')).not.toThrow();
      expect(mod.useUiStore.getState().memberBoardView).toBe('calendar'); // 写失败 → 内存仍生效
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
    }
  });
});

/* ====================================================================================
 * ② V1-28 ② · 阶段资料路径成员门控（P0-19-①）
 * ==================================================================================== */

const PROJECT_ID = 'proj_d1';
const STAGE_ID = 'stg_d1';
const ADMIN_ID = 'm-admin-d1';
const MEMBER_ID = 'm-member-d1';

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
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

/** 阶段工厂：`resourcePath` 是本组用例唯一的自变量 */
function makeStage(resourcePath: string | null): Stage {
  return {
    id: STAGE_ID,
    projectId: PROJECT_ID,
    orderIndex: 1,
    templateKey: null,
    colorIndex: 1,
    name: '现场勘测',
    ratioPercent: 100,
    startAt: '2026-01-01T00:00:00Z',
    endAt: '2026-01-10T23:59:59Z',
    status: StageStatus.NotStarted,
    ownerId: null,
    visible: true,
    resourcePath,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

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

/** 「修改」按钮的唯一判定：阶段抽屉内文本恰为「修改」的按钮（登记态是「保存」，不冲突） */
function findEditButton(root: ParentNode): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === '修改',
    ) ?? null
  );
}

/** 「登记本阶段资料文件夹路径…」入口（未登记态唯一的按钮） */
function hasRegisterEntry(root: ParentNode): boolean {
  return Array.from(root.querySelectorAll('button')).some((b) =>
    (b.textContent ?? '').includes('登记本阶段资料文件夹路径'),
  );
}

describe('v0.7 D 线 · 阶段资料路径成员门控（P0-19-① / V1-28 ②）', () => {
  let host: HTMLDivElement;
  let root: Root;

  /**
   * 装配一次抽屉：先关着渲染（`stageDrawerStageId=null`），再打开，
   * 与真实点击路径一致（也顺带复验 hook 顺序未被本次改动破坏）。
   */
  function renderDrawer(opts: {
    resourcePath: string | null;
    actor: 'admin' | 'member' | 'none';
  }): void {
    const stage = makeStage(opts.resourcePath);
    useProjectsStore.getState().replaceAll({
      projects: [PROJECT],
      stages: [stage],
      tasks: [],
    });
    useMembersStore.getState().setAll([
      makeMember(ADMIN_ID, '负责人甲', MemberRoleKind.Admin),
      makeMember(MEMBER_ID, '协作者乙', MemberRoleKind.Member),
    ]);
    const currentMemberId =
      opts.actor === 'admin' ? ADMIN_ID : opts.actor === 'member' ? MEMBER_ID : null;
    useSettingsStore.setState({ currentMemberId, hydrated: true });

    useUiStore.setState({ stageDrawerStageId: null });
    act(() => {
      root.render(<StageDrawer projectId={PROJECT_ID} members={[]} />);
    });
    expect(() => {
      act(() => useUiStore.getState().openStageDrawer(STAGE_ID));
    }).not.toThrow();
  }

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('成员 + 路径有值：只读展示，「修改」按钮不存在，「打开 / 复制路径」保留', () => {
    renderDrawer({ resourcePath: 'D:\\长夏项目\\某茶空间\\03-施工图', actor: 'member' });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy(); // 抽屉真的开了（否则下面的「不存在」是空过）

    // ① 唯一的写入口被摘掉
    expect(findEditButton(dialog!)).toBeNull();

    // ② 只读通道保留（两者都不写库）——否则等于把「看资料路径」也一起掐了
    const text = dialog!.textContent ?? '';
    expect(text).toContain('D:\\长夏项目\\某茶空间\\03-施工图');
    expect(text).toContain('复制路径');
    expect(text).toContain('打开');

    // ③ 点击「复制路径」不得触发任何写（假 bundle 的 stages.update 是 no-op，
    //    故这里只证明「可点、无异常」，写库与否由「修改按钮不存在」兜住）
    const copyBtn = Array.from(dialog!.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('复制路径'),
    );
    expect(copyBtn).toBeTruthy();
    expect(() => {
      act(() => {
        copyBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }).not.toThrow();
  });

  it('成员 + 路径为 null：整块不渲染（看不到「登记资料路径」入口）', () => {
    renderDrawer({ resourcePath: null, actor: 'member' });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    // 「备注与资料」标题仍在（section 是抽屉固有的），但其内的资源卡片整体缺席
    expect(dialog!.textContent).toContain('备注与资料');
    expect(hasRegisterEntry(dialog!)).toBe(false);
    expect(findEditButton(dialog!)).toBeNull();
    expect(dialog!.querySelector('code')).toBeNull(); // 也没有路径文本
  });

  it('对照组 · 管理员 + 路径有值：「修改」按钮照旧存在（收紧不得收过头）', () => {
    renderDrawer({ resourcePath: 'D:\\长夏项目\\某茶空间', actor: 'admin' });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(findEditButton(dialog!)).toBeTruthy();
  });

  it('对照组 · 管理员直挂组件：只读行三件套（打开 / 复制路径 / 修改）齐全', () => {
    useMembersStore.getState().setAll([makeMember(ADMIN_ID, '负责人甲', MemberRoleKind.Admin)]);
    useSettingsStore.setState({ currentMemberId: ADMIN_ID, hydrated: true });

    act(() => {
      root.render(<ResourcePathButton stage={makeStage('D:\\长夏项目\\某茶空间')} />);
    });

    const labels = Array.from(host.querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(labels).toContain('打开');
    expect(labels).toContain('复制路径');
    expect(labels).toContain('修改'); // ← 管理员**必须**仍有它（收紧不得收过头）
  });

  /**
   * ⚠️ 这里**刻意不断言**「点『修改』后出现『保存』」：实测该流程在当前代码里是**死的**，
   * 且与本次改动无关（属 P0-19-① 顺带发现的**既有缺陷**，已上报 team-lead）——
   *   `ResourcePathButton.tsx:73` 的三元第一支是 `stage.resourcePath ? …`
   *   （只看「有没有路径」，**不看 `editing`**），故有路径时点「修改」虽置
   *   `editing=true`，渲染仍落在只读行，编辑分支永远不可达。
   *   正确的修法是 `stage.resourcePath && !editing ? …`，但那**扩大了本次授权范围**
   *   （会把管理员一条已失效的写通道修活），故本轮只上报、不擅自修。
   * 把「点不动」写成期望会让将来修好它的人被这条用例挡住，故此处不写。
   */
  it('对照组 · 成员直挂组件：只读行只剩「打开 / 复制路径」（写入口整体摘除）', () => {
    useMembersStore.getState().setAll([makeMember(MEMBER_ID, '协作者乙', MemberRoleKind.Member)]);
    useSettingsStore.setState({ currentMemberId: MEMBER_ID, hydrated: true });

    act(() => {
      root.render(<ResourcePathButton stage={makeStage('D:\\长夏项目\\某茶空间')} />);
    });

    const labels = Array.from(host.querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(labels).toContain('打开');
    expect(labels).toContain('复制路径');
    expect(labels).not.toContain('修改');
    expect(labels).not.toContain('保存');
    expect(labels.some((l) => l.includes('登记本阶段资料文件夹路径'))).toBe(false);
  });

  it('对照组 · 管理员 + 路径为 null：登记入口照旧存在', () => {
    renderDrawer({ resourcePath: null, actor: 'admin' });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(hasRegisterEntry(dialog!)).toBe(true);
  });

  it('对照组 · 未进入身份（role=null）+ 路径为 null：与成员同档受限（不回退为 isMember 口径）', () => {
    renderDrawer({ resourcePath: null, actor: 'none' });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    // isRestrictedView(null) === true —— 未进入身份**不**享受管理员待遇（BUG-1 的教训）
    expect(hasRegisterEntry(dialog!)).toBe(false);
  });
});

/* ====================================================================================
 * ③ V1-26 · MemberBoardPage 不得向 MonthlyCalendarView 传任何项目数据
 * ==================================================================================== */

describe('v0.7 D 线 · MemberBoardPage → MonthlyCalendarView 的调用契约（V1-26）', () => {
  it('★ 只传 onManual，且必须显式为 undefined；不得传 projects/stages/tasks 等数据 props', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '..', 'src', 'pages', 'MemberBoardPage.tsx'),
      'utf8',
    );

    // 取每一处 `<MonthlyCalendarView ... />` 的调用片段
    const calls = src.match(/<MonthlyCalendarView[\s\S]*?\/>/g) ?? [];
    expect(calls, 'MemberBoardPage 里应恰好有一处 MonthlyCalendarView 调用').toHaveLength(1);

    const call = calls[0]!;
    // ① 不得传任何**数据**入参（否则与组件内部过滤形成两份过滤；
    //    若传的是全量项目，就是成员看到不属于自己项目的**权限泄漏**）
    for (const forbidden of ['projects=', 'stages=', 'tasks=', 'active=', 'entries=', 'members=']) {
      expect(call, `不得向 MonthlyCalendarView 传入 ${forbidden}`).not.toContain(forbidden);
    }
    // ② onManual 必须显式 undefined —— 漏成 openManual 会让成员点到「直接手动建档」
    //    （ManualFallbackForm 全局挂在 AppShell，成员也拦不住）
    expect(call.replace(/\s+/g, ' ')).toContain('onManual={undefined}');
    // ③ 反向：本文件不得出现 openManual 之类的管理员动作被传给月历
    expect(call).not.toContain('openManual');

    // ④ 视图切换控件：ariaLabel 与绑定 key 是本任务的验收锚点
    expect(src).toContain('ariaLabel="成员看板视图切换"');
    expect(src).toContain('value={memberBoardView}');
    expect(src).toContain('onChange={setMemberBoardView}');
  });
});

/* ====================================================================================
 * ④ E1 空状态的「直接手动建档」CTA 必须**不渲染**（不是「渲染了但点了无效」）
 * ==================================================================================== */

describe('v0.7 D 线 · E1「直接手动建档」CTA 门控（team-lead 复审缺陷的回归锁）', () => {
  let host: HTMLDivElement;
  let root: Root;

  /** E1 的判定条件与触发者是 `MonthlyCalendarView.emptyKind`（active.length === 0），
   *  与本组用例无关：这里直接以 `kind='E1'` 挂载，只验证「给了什么 props 就画什么」。 */
  function renderE1(onManual?: () => void): void {
    act(() => {
      root.render(
        <CalendarEmptyStates
          kind="E1"
          monthLabel="2026年9月"
          gridDays={[]}
          filters={{ status: new Set(), stage: new Set() }}
          memberProject={null}
          onClear={() => undefined}
          onManual={onManual}
          onToggleStatus={() => undefined}
          onToggleStage={() => undefined}
        />,
      );
    });
  }

  /** E1 里那个 CTA 的唯一判定：文本恰为「直接手动建档」的按钮 */
  const findCta = (): HTMLButtonElement | null =>
    Array.from(host.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === '直接手动建档',
    ) ?? null;

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  /**
   * ★ 本组的核心：成员视角（`MemberBoardPage` 传 `onManual={undefined}`）。
   *
   * 为什么必须断言「**不存在**」而不是「点了没反应」：
   *   初版实现写成 `<Button onClick={() => onManual?.()}>`（无条件渲染），`?.()` 只让
   *   点击无效、按钮照样画出来 —— 于是一个 `variant="primary"` 的**死按钮**出现在空状态里。
   *   而 E1 的触发条件正是「与我相关的 active 项目 = 0」，刚被拉进项目的新成员最常看到它。
   *   「点了没反应」这条断言在那个错误实现下**照样全绿**（假绿），只有「查不到该文本」
   *   才能把它钉死。此即 team-lead 复审要求的「别只断言点击无效」。
   */
  it('★ onManual=undefined（成员）：E1 里查不到「直接手动建档」文本，且不存在该按钮元素', () => {
    renderE1(undefined);

    // 前提：E1 的其余文案必须在（证明真的是 E1 空状态，而不是「什么都没渲染」的空过）
    expect(host.textContent).toContain('还没有进行中的项目');
    expect(host.textContent).toContain('新建一个项目，把阶段排期跑起来');

    // 核心断言（两重，文本 + 元素）
    expect(host.textContent, '成员视角不得出现「直接手动建档」文案').not.toContain(
      '直接手动建档',
    );
    expect(findCta(), '成员视角不得渲染该 CTA 按钮（哪怕是失效的）').toBeNull();
  });

  it('对照组 · onManual 有值（管理员首页）：CTA 照旧渲染且可点（收紧不得收过头）', () => {
    let calls = 0;
    renderE1(() => {
      calls += 1;
    });

    const cta = findCta();
    expect(cta, '管理员侧必须仍有「直接手动建档」入口').toBeTruthy();
    expect((cta?.textContent ?? '').trim()).toBe('直接手动建档');

    expect(() => {
      act(() => {
        cta!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }).not.toThrow();
    expect(calls, '点击必须真的回调 onManual（不是被去掉的黑洞）').toBe(1);
  });
});
