// @vitest-environment jsdom
/**
 * 插件门控守卫（v0.8.6 阶段 2 · 界面面收口）—— **渲染级**判据 + 一条架构守卫。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 本文件守什么（每条都对应一处「UI 面零插件门控」的实测缺陷）
 * ══════════════════════════════════════════════════════════════════════════════
 *   A. `ProjectDetailPage` 的「Agent Board」按钮：`window.location.assign('/agent')`，
 *      而 `/agent` 是 **agent-board 插件贡献的路由**（`registry.ts::resolveRoutes`
 *      只取启用中的）⇒ 插件停用后该按钮 = 点了回首页的死链。
 *   B. `MobileMoreMenu`（手机档 ⋮）的「Agent」项：同上，同一颗死链。
 *   C. `MobileMoreMenu` 的「载入示例项目」：与 `Sidebar.tsx` 底部同名条目是**同一功能
 *      的两个入口**，此前本入口零插件门控 ⇒ 出现「侧栏没了、手机档还在」的双开关打架。
 *   D. `Sidebar` 的「Agent 看板」列表段：此前只有路由条件，靠「停用后 /agent 不达」
 *      的**连带效应**顺带消失（不是自己受管），本组把它改成显式门控后钉住。
 *   E. 架构：宿主常驻壳层 hook `useAgentLoopbackReceiver` 不得 import 归插件所有的
 *      `pages/**` / `components/agent/**`（否则插件停用后其模块仍被宿主 bundle 执行）。
 *
 * ── 为什么每条都要「开 / 关」成对，且必须先断言「页面真的渲染了」 ──
 * 这些判据的**否定形态**（"按钮不在"）有一个致命陷阱：页面整个没渲染、或组件压根没挂，
 * 也会让「不在」成立。故每组都配：
 *   ① 前提断言（页面主体 / 菜单本体真的上屏了）；
 *   ② on 用例（门控放行时确实在）——若把门控写成恒 false，②会红。
 * 二者同时成立时，「off 消失」才真的是门控造成的行为差异（而不是空过）。
 *
 * ── 开关真值怎么造 ──
 * 走**真** `PluginRegistryProvider`（不 mock 它），只把 `useRepos` 顶掉，让
 * `settings.all()` 返回我们给的 KV 行 —— 即 `plugin.enabled.<id>` 的真实读法。
 * 「无记录」= 回落 `defaultEnabled`（agent-board 是 true、sample-projects 是 false），
 * 这正是产品里「默认开 / 默认关」两条口径的实测点。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * settings KV 行（`vi.mock` 工厂被提升到文件顶部 ⇒ 共享状态必须走 `vi.hoisted`，
 * 不能引用下方 `let`）。
 */
const kv = vi.hoisted(() => ({ rows: [] as Array<{ key: string; valueJson: string }> }));

/** 顶掉真实仓储（同 tests/v07-dline-print-access.spec.tsx 口径；`settings.all` 可造）。 */
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
    // ★ 本 spec 的自变量：插件启用态就住在这张表里
    settings: {
      get: async () => null,
      set: ok,
      all: async () => kv.rows,
      replaceAll: ok,
    },
  };
  return { useRepos: (): unknown => bundle };
});

import { PluginRegistryProvider, PluginSettingsSlot } from '../src/core/plugin/PluginRegistryProvider';
import { MobileMoreMenu } from '../src/components/layout/MobileMoreMenu';
import { Sidebar } from '../src/components/layout/Sidebar';
import { ProjectDetailPage } from '../src/pages/ProjectDetailPage';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import { t } from '../src/i18n';
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

const AGENT_PROJECT_ID = 'proj_gate_agent';
const HUMAN_PROJECT_ID = 'proj_gate_human';
const STAGE_ID = 'stg_gate';
const ADMIN_ID = 'm-gate-admin';
const MEMBER_ID = 'm-gate-member';

function makeProject(id: string, name: string, kind: 'agent' | 'human'): Project {
  return {
    id,
    name,
    address: null,
    clientName: null,
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-01-01T00:00:00Z',
    plannedEndAt: '2026-03-01T23:59:59Z',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: null,
    kind,
    // null = 公共板：`visibleProjectsFor` 的归属收窄对公共板一视同仁（两种身份都能看到）
    ownerMemberId: null,
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const AGENT_PROJECT = makeProject(AGENT_PROJECT_ID, '某测试工作区', 'agent');
const HUMAN_PROJECT = makeProject(HUMAN_PROJECT_ID, '某人类项目', 'human');

const STAGE: Stage = {
  id: STAGE_ID,
  projectId: AGENT_PROJECT_ID,
  orderIndex: 1,
  templateKey: null,
  colorIndex: 1,
  customColor: null,
  name: '阶段一',
  ratioPercent: 100,
  startAt: '2026-01-05T00:00:00Z',
  endAt: '2026-01-20T23:59:59Z',
  status: StageStatus.InProgress,
  ownerId: ADMIN_ID,
  visible: true,
  resourcePath: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const TASK: Task = {
  id: 'tsk_gate',
  taskNo: 1,
  projectId: AGENT_PROJECT_ID,
  stageId: STAGE_ID,
  title: '首项任务',
  done: false,
  assigneeId: ADMIN_ID,
  assigneeIds: [ADMIN_ID],
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
  runId: null,
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

/** 装数据 + 定身份（写 store 必须包 `act()`，否则真实告警——见 tests/setup.ts 纪律）。 */
function seed(opts: {
  actor: Actor;
  projects?: Project[];
  stages?: Stage[];
  tasks?: Task[];
}): void {
  act(() => {
    useProjectsStore.getState().replaceAll({
      projects: opts.projects ?? [AGENT_PROJECT],
      stages: opts.stages ?? [STAGE],
      tasks: opts.tasks ?? [TASK],
    });
    useMembersStore.getState().setAll([ADMIN, MEMBER]);
    const currentMemberId =
      opts.actor === 'admin' ? ADMIN_ID : opts.actor === 'member' ? MEMBER_ID : null;
    useSettingsStore.setState({ currentMemberId, hydrated: true });
    useUiStore.setState({ stageDrawerStageId: null });
  });
}

/**
 * 造插件 KV 行。
 *   · `undefined` ⇒ **不写记录**：走 `defaultEnabled`（agent-board=true / sample-projects=false）
 *   · `true` / `false` ⇒ 写显式记录（= 用户在设置里点过开关）
 */
function setPluginKv(
  entries: Partial<Record<'agent-board' | 'sample-projects', boolean>>,
): void {
  kv.rows = Object.entries(entries).map(([id, enabled]) => ({
    key: `plugin.enabled.${id}`,
    valueJson: JSON.stringify(enabled),
  }));
}

/* ====================================================================================
 * 渲染 / 清理 / 环境桩
 * ==================================================================================== */

let host: HTMLDivElement | null = null;
let root: Root | null = null;

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

/** 挂一棵 React 树，外层恒为真 `PluginRegistryProvider`（门控真值来源）。 */
function mount(node: React.ReactElement): HTMLDivElement {
  unmountCurrent();
  const el = document.createElement('div');
  document.body.appendChild(el);
  host = el;
  root = createRoot(el);
  act(() => {
    root!.render(<PluginRegistryProvider>{node}</PluginRegistryProvider>);
  });
  return el;
}

/**
 * 把注册表的**异步 hydrate**（`settings.all()` → `setEnabledMap`）跑完。
 * 不 flush 的话读到的是首帧回落值（空表 ⇒ defaultEnabled），
 * 「显式关掉」的用例就会假绿成「开着」。
 */
async function flushRegistry(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * jsdom 缺 `matchMedia` / `ResizeObserver`（实测 undefined）。
 *
 * ★ 这里**必须按查询分档**，不能一律 `matches:false`（v07-dline-print-access 的
 *   一律 false 桩在本 spec 会**把侧栏压成收起态**）：
 *     · `(min-width: 1280px)`（`useXlViewport` / `isXlViewport` / `defaultExpanded`）
 *       → **true**：≥xl 才是「持久左栏展开态」；否则 `Sidebar` 走
 *       `const collapsed = xl ? !sidebarExpanded : true` 的 **<xl 强制收起**分支，
 *       而 Agent 看板列表**只存在于展开态子树** ⇒ D 组会「因为侧栏收起了」而假绿。
 *     · `(max-width: 1023px)`（`useIsNarrowViewport`，详情页窄屏分流）
 *       → **false**：走桌面稿（横向时间轴），与真实桌面一致。
 */
function installEnvStubs(): void {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: !/max-width/.test(query),
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
  installEnvStubs();
  kv.rows = [];
  seed({ actor: 'admin' });
});

afterEach(() => {
  unmountCurrent();
  kv.rows = [];
});

/* ====================================================================================
 * A · ProjectDetailPage「Agent Board」按钮
 * ==================================================================================== */

const findButtonByText = (h: ParentNode, text: string): HTMLElement | null =>
  Array.from(h.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text) ??
  null;

describe('A · ProjectDetailPage「Agent Board」按钮受 agent-board 开关门控', () => {
  /**
   * ⚠️ 必须走**真路由表**：`useParams()` 只在 `<Routes>` 子树里才有值。
   * 直接把页面挂在 `MemoryRouter` 下（省掉 Routes）会让 `id` 恒为 `''` ⇒
   * 页面渲染 `project.notFound` 空态 ⇒ 「按钮不在」**恒成立**（假绿）。
   */
  const renderDetail = (): HTMLDivElement =>
    mount(
      <MemoryRouter initialEntries={[`/project/${AGENT_PROJECT_ID}`]}>
        <Routes>
          <Route path="/project/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('前提：Agent 看板详情页真的上屏（阶段名在屏，否则下方两条都是空过）', async () => {
    const h = renderDetail();
    await flushRegistry();
    expect(h.textContent, '详情页主体必须渲染出来').toContain(STAGE.name);
    expect(h.textContent).toContain(AGENT_PROJECT.name);
  });

  it('★ 插件启用（无关闭记录 ⇒ defaultEnabled=true）→ 按钮在', async () => {
    setPluginKv({}); // 不写记录 = 默认态
    const h = renderDetail();
    await flushRegistry();
    expect(h.textContent, '前提：详情页已上屏').toContain(STAGE.name);
    expect(
      findButtonByText(h, 'Agent Board'),
      '插件开着时，这颗入口必须在（否则下一条的「不在」就说明不了任何事）',
    ).not.toBeNull();
  });

  it('★ 插件停用 → 按钮**不渲染**（不是置灰：置灰仍在承诺一个不存在的去处）', async () => {
    setPluginKv({ 'agent-board': false });
    const h = renderDetail();
    await flushRegistry();
    expect(h.textContent, '前提：详情页已上屏（页面没渲染的话这条是空过）').toContain(STAGE.name);
    expect(findButtonByText(h, 'Agent Board'), '插件停用后不得留下 /agent 死链入口').toBeNull();
  });

  it('对照：同一次停用不误伤「归档」（按钮块里的邻居仍在）', async () => {
    setPluginKv({ 'agent-board': false });
    const h = renderDetail();
    await flushRegistry();
    expect(h.textContent).toContain(STAGE.name);
    expect(
      findButtonByText(h, '归档'),
      '门控必须只落在 Agent Board 这一颗上（把整段操作栏关掉是回归）',
    ).not.toBeNull();
  });
});

/* ====================================================================================
 * B / C · MobileMoreMenu（手机档 ⋮）
 * ==================================================================================== */

const MORE_BTN = 'button[aria-label="更多操作"]';

/** 打开 ⋮ 菜单并返回菜单项文案（已 trim）。**返回空数组 = 菜单没开**，调用方须先断言非空。 */
async function openMoreMenu(): Promise<HTMLDivElement> {
  const h = mount(
    <MemoryRouter initialEntries={['/']}>
      <MobileMoreMenu />
    </MemoryRouter>,
  );
  await flushRegistry();
  const btn = h.querySelector<HTMLButtonElement>(MORE_BTN);
  expect(btn, '前提：⋮ 触发按钮必须在（否则下面的菜单项判据全是空过）').not.toBeNull();
  await act(async () => {
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return h;
}

/**
 * 菜单项文案。面板经 `createPortal` 挂在 `document.body`（`MobileMoreMenu` 文件头 F2），
 * 故必须从 body 取，不能从挂载容器取。
 */
const menuItems = (): string[] =>
  Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) =>
    (el.textContent ?? '').trim(),
  );

describe('B · MobileMoreMenu 的「Agent」项受 agent-board 开关门控', () => {
  it('前提：菜单能打开（设置项在屏）', async () => {
    setPluginKv({});
    await openMoreMenu();
    expect(menuItems(), '前提：⋮ 面板必须真的打开').toContain(t('settings.title'));
  });

  it('★ 插件启用 → 「Agent」项在', async () => {
    setPluginKv({});
    await openMoreMenu();
    expect(menuItems()).toContain(t('settings.title')); // 前提
    expect(menuItems(), '插件开着时必须有 Agent 入口').toContain('Agent');
  });

  it('★ 插件停用 → 「Agent」项不渲染（修前是点了回首页的死链）', async () => {
    setPluginKv({ 'agent-board': false });
    await openMoreMenu();
    expect(menuItems(), '前提：面板已打开').toContain(t('settings.title'));
    expect(menuItems(), '插件停用后不得留下 /agent 死链菜单项').not.toContain('Agent');
  });

  it('对照：停用 agent-board 不影响「我的任务」等宿主项', async () => {
    setPluginKv({ 'agent-board': false });
    await openMoreMenu();
    expect(menuItems()).toContain(t('nav.myTasks'));
  });
});

describe('C · MobileMoreMenu 的「载入示例项目」与 Sidebar 同判据（插件 ∧ isAdmin）', () => {
  const LOAD_DEMO = t('sidebar.loadDemo');

  it('★ admin + 插件启用 → 项在', async () => {
    seed({ actor: 'admin' });
    setPluginKv({ 'sample-projects': true });
    await openMoreMenu();
    expect(menuItems(), '前提：面板已打开').toContain(t('settings.title'));
    expect(menuItems()).toContain(LOAD_DEMO);
  });

  it('★ admin + 插件停用 → 项消失（修前这一半门控是缺的）', async () => {
    seed({ actor: 'admin' });
    setPluginKv({ 'sample-projects': false });
    await openMoreMenu();
    expect(menuItems(), '前提：面板已打开').toContain(t('settings.title'));
    expect(menuItems(), '插件停用后手机档不得还留着示例项目入口').not.toContain(LOAD_DEMO);
  });

  it('★ member + 插件启用 → 项仍消失（`isAdmin` 那一半没有被插件门控顶掉）', async () => {
    seed({ actor: 'member' });
    setPluginKv({ 'sample-projects': true });
    await openMoreMenu();
    expect(menuItems(), '前提：面板已打开').toContain(t('settings.title'));
    expect(menuItems(), 'loadDemo 是覆盖式导入，管理员门槛必须保留').not.toContain(LOAD_DEMO);
  });
});

/* ====================================================================================
 * D · Sidebar「Agent 看板」列表段 —— 显式门控（不再依赖路由连带效应）
 * ==================================================================================== */

describe('D · Sidebar 的 Agent 看板列表显式受插件开关管', () => {
  /**
   * ★ 自变量设计的要点：**两条用例的 pathname 都是 `/agent`**。
   * 于是「路由连带效应」这一路在两条用例里**同时成立**（`onAgentRoute` 恒 true），
   * 唯一的差异只剩插件开关 ⇒ 只有**显式门控**能让 off 那条变红/变绿。
   * 若哪天有人删掉显式门控，off 用例会红（这就是本项目要的判别力）。
   */
  const renderSidebarAtAgent = (): HTMLDivElement =>
    mount(
      <MemoryRouter initialEntries={['/agent']}>
        <Sidebar />
      </MemoryRouter>,
    );

  it('前提：/agent 路由下侧栏渲染出 Agent 看板列表（数据与路由都成立）', async () => {
    seed({ actor: 'admin', projects: [AGENT_PROJECT, HUMAN_PROJECT] });
    setPluginKv({});
    const h = renderSidebarAtAgent();
    await flushRegistry();
    expect(
      h.querySelector('[data-agent-board-sidebar]'),
      '前提：公共 Agent 看板必须出现在侧栏（否则「停用后消失」是空过）',
    ).not.toBeNull();
  });

  it('★ 插件停用（pathname 仍是 /agent）→ 列表不渲染', async () => {
    seed({ actor: 'admin', projects: [AGENT_PROJECT, HUMAN_PROJECT] });
    setPluginKv({ 'agent-board': false });
    const h = renderSidebarAtAgent();
    await flushRegistry();
    expect(
      h.querySelector('[data-agent-board-sidebar]'),
      '插件停用后侧栏不得再列 Agent 看板（这一条只能由显式门控解释）',
    ).toBeNull();
  });

  it('对照：停用后人类项目列表不受影响（门控只落在 Agent 段）', async () => {
    seed({ actor: 'admin', projects: [AGENT_PROJECT, HUMAN_PROJECT] });
    setPluginKv({ 'agent-board': false });
    const h = renderSidebarAtAgent();
    await flushRegistry();
    expect(h.textContent, '人类项目必须照常显示').toContain(HUMAN_PROJECT.name);
  });
});

/* ====================================================================================
 * F · settingsSlot 机制：插件停用 ⇒ 设置面板**不挂载**
 *
 * 这是「入口 ③」（`SampleProjectsSettings` 里的载入按钮）的门控机制 ——
 * `tests/plugin-registry.spec.ts` ⑩-b 用源码锚点钉住「壳层只在启用分支渲染 slot」
 * 与「`PluginSettingsSlot` 自判启用态后返回 null」，但那两条是**实现处**的锚；
 * 机制**真的**把面板摘掉了没有，只有真渲染能回答。本组就补这一半。
 * ==================================================================================== */

/** 槽位宿主：带一枚**恒渲染**的锚，用来在「面板不在」时证明宿主本身确实挂了 */
function SlotHost({ pluginId }: { pluginId: string }): JSX.Element {
  return (
    <div data-slot-host="">
      <span data-slot-host-mounted="" />
      <PluginSettingsSlot pluginId={pluginId} />
    </div>
  );
}

describe('F · PluginSettingsSlot：停用的插件不挂载自己的设置面板', () => {
  /** 宿主的子元素数：恒渲染的锚 span + （启用时的）面板根 = 2；停用时 = 1 */
  const slotChildCount = (h: ParentNode): number => {
    const host = h.querySelector('[data-slot-host]');
    expect(host, '前提：槽位宿主必须真的渲染出来（否则下面的计数恒为 0）').not.toBeNull();
    return host!.childElementCount;
  };

  const renderSlot = async (pluginId: string): Promise<HTMLDivElement> => {
    const h = mount(
      <MemoryRouter initialEntries={['/']}>
        <SlotHost pluginId={pluginId} />
      </MemoryRouter>,
    );
    await flushRegistry();
    expect(
      h.querySelector('[data-slot-host-mounted]'),
      '前提：宿主锚必须在（证明这棵树真的挂上了）',
    ).not.toBeNull();
    return h;
  };

  it('★ 示例项目：启用 ⇒ 面板挂载，且按钮锚点在（停用时它是不可达的）', async () => {
    setPluginKv({ 'sample-projects': true });
    const h = await renderSlot('sample-projects');
    expect(slotChildCount(h), '启用时槽位里应有面板根节点').toBe(2);
    expect(
      h.querySelector('[data-sample-projects-load]'),
      '启用时面板里的载入按钮必须在',
    ).not.toBeNull();
  });

  it('★ 示例项目：停用 ⇒ 面板**不挂载**（不是渲染成空壳）', async () => {
    setPluginKv({ 'sample-projects': false });
    const h = await renderSlot('sample-projects');
    expect(slotChildCount(h), '停用时槽位里只剩恒渲染的锚').toBe(1);
    expect(h.querySelector('[data-sample-projects-load]'), '停用后这颗按钮不得存在').toBeNull();
  });

  it('★ Agent 看板：启用（默认态）⇒ 面板挂载；停用 ⇒ 不挂载', async () => {
    setPluginKv({}); // 无记录 ⇒ defaultEnabled（agent-board = true）
    const on = await renderSlot('agent-board');
    expect(slotChildCount(on), 'agent-board 默认启用 ⇒ 面板应在').toBe(2);

    setPluginKv({ 'agent-board': false });
    const off = await renderSlot('agent-board');
    expect(slotChildCount(off), '停用后 agent-board 的设置面板不得挂载').toBe(1);
  });
});

/* ====================================================================================
 * E · 架构守卫：宿主壳层不得反向 import 插件所有的模块
 * ==================================================================================== */

/** 与 `tests/arch-boundary.spec.ts` 的 `importedModules` 同口径（含 `import type` / 动态 import）。 */
function importedModules(source: string): string[] {
  const modules: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|\n)\s*export\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) modules.push(m[1]!);
  }
  return modules;
}

const ROOT = join(__dirname, '..');
const readSrc = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8');

describe('E · 宿主壳层对插件模块的反向依赖（v0.8.6 阶段 2 架构债）', () => {
  const HOOK = 'src/hooks/useAgentLoopbackReceiver.ts';

  it('扫描器自证：它能看见 import（含 type-only / 动态 import）', () => {
    const sample = [
      "import { A } from '../pages/AgentBoardPage';",
      "import type { B } from '../components/agent/X';",
      "const m = await import('../pages/Y');",
      "export { C } from '../pages/Z';",
    ].join('\n');
    expect(importedModules(sample)).toEqual([
      '../pages/AgentBoardPage',
      '../components/agent/X',
      '../pages/Y',
      '../pages/Z',
    ]);
  });

  it('★ 本文件确有被扫的 import（正向对照：守卫不是「扫了个空字符串」）', () => {
    const mods = importedModules(readSrc(HOOK));
    expect(mods.length).toBeGreaterThan(5);
    expect(mods).toContain('../constants/agentTerms'); // token 键的新家（宿主中立）
  });

  it('★ useAgentLoopbackReceiver 不得 import 任何 pages/** 或 components/agent/**', () => {
    const offenders = importedModules(readSrc(HOOK)).filter(
      (m) => /(^|\/)pages\//.test(m) || /(^|\/)components\/agent\//.test(m),
    );
    expect(
      offenders,
      `宿主常驻 hook 反向依赖了插件所有的模块（插件停用后其代码仍会被宿主 bundle 执行）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('token 存储键的唯一出处是宿主中立常量，且插件页保留了 re-export（既有消费点不破）', () => {
    const terms = readSrc('src/constants/agentTerms.ts');
    expect(terms).toContain("export const AGENT_TOKEN_STORAGE_KEY = 'idplan.agentToken'");
    const page = readSrc('src/pages/AgentBoardPage.tsx');
    // 页面自身不再定义字面量，而是 re-export（tests/v07-t03b-ingress-wired.spec.tsx 仍从这里 import）
    expect(page, 'AgentBoardPage 不得再自行定义该字面量').not.toContain(
      "export const AGENT_TOKEN_STORAGE_KEY = 'idplan.agentToken'",
    );
    expect(page).toContain('export { AGENT_TOKEN_STORAGE_KEY }');
  });
});
