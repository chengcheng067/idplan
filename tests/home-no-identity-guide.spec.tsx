// @vitest-environment jsdom
/**
 * 未进入身份 ⇒ 首页整页引导态（2026-10-27 权限修复 1）。
 *
 * ═══════════════════════ 这一批在堵什么洞 ═══════════════════════
 *   修前：`HomePage` 在 `useHumanProjects()` 为空时渲染 EmptyState，其中挂着
 *   「直接手动建档」按钮（`t('home.openManual')` → `openManual`）。未进入身份的用户
 *   点它就会经 `projects.insert` 插进一个 `ownerMemberId: null` 的公共项目——
 *   归属不明，绕过了「建档必须先说明自己是谁」的闸。
 *
 *   修后（team-lead 已拍板的新口径，见 HomePage 文件头 ⚠️⚠️ 段）：
 *   `hydrated && !isEntered` 时整页**只**渲染 `data-home-no-identity` 引导块
 *   （文案 + 「进入身份」按钮，打开身份弹层）——统计卡 / 视图切换 / 项目网格 /
 *   月历 / 归档区 / 成员管理区一概不渲染，建档 CTA 自然不可达。
 *
 * ═══════════════════════ 本文件锁什么 ═══════════════════════
 *   G-1 未进入 ⇒ 引导块在、「直接手动建档」不在、网格/视图切换/统计卡都不在；
 *   G-2 装载中（hydrated=false）⇒ **不**下「未进入」判决，只有 DataGate 装载面
 *       （与 tests/no-identity-visibility.spec.tsx 的 B-04 同一口径，两页不许各判各的）；
 *   G-3 进入管理员 ⇒ 引导块消失、项目网格回来（收窄不是永久关门）；
 *   G-4 引导块按钮真的打开身份流（identityFlow === 'admin_prompt'，与
 *       useFirstRunGate 的调用同款）。
 *
 * ═══════════════════════ 变异自证（本仓纪律） ═══════════════════════
 *   把 HomePage 里 `if (hydrated && !isEntered) { return … }` 引导闸注释掉再跑：
 *   G-1 当场红（引导块消失、EmptyState 的「直接手动建档」回来）。已实测并恢复。
 *
 * 手法与 tests/no-identity-visibility.spec.tsx 同源：React 18 `createRoot` + `act`，
 * `useRepos` 在模块边界顶掉，不引 testing-library。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

/* HomePage 链读仓库（bootstrap/侧栏等），本文件判据只看 store —— 模块边界顶掉。
   形状与 tests/no-identity-visibility.spec.tsx 逐字同源，不另造第二份假仓库。 */
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

import { HomePage } from '../src/pages/HomePage';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import { MemberActorKind, MemberRoleKind, ProjectStatus, ScheduleBasis, StageStatus, TaskStatus } from '../src/core/types/enums';
import type { Member, Project, Stage, Task } from '../src/core/types/entities';

const ADMIN_ID = 'mem_admin';

const PROJECT_NAME = '引导态验证项目';

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

function makeProject(id: string, name: string): Project {
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
  };
}

function makeStage(id: string, projectId: string, orderIndex: number): Stage {
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
  };
}

function makeTask(id: string, projectId: string): Task {
  return {
    id,
    taskNo: null,
    projectId,
    stageId: 'stg_1',
    title: '引导态验证任务',
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

function renderHome(): HTMLDivElement {
  unmountCurrent();
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  const r = createRoot(h);
  root = r;
  act(() => {
    r.render(
      <MemoryRouter initialEntries={['/']}>
        <HomePage />
      </MemoryRouter>,
    );
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
 * 装库（挂载前调用）。
 * 库里**有** 1 个进行中项目 —— 这正是她的场景：退出身份后库里明明有数据，
 * 旧实现会渲染 EmptyState +「直接手动建档」，把人引去建无主项目。
 */
function seedStores(opts: { currentMemberId: string | null; hydrated?: boolean }): void {
  unmountCurrent();
  const project = makeProject('proj_guide', PROJECT_NAME);
  act(() => {
    useProjectsStore.getState().replaceAll({
      projects: [project],
      stages: [makeStage('stg_1', project.id, 1)],
      tasks: [makeTask('tsk_1', project.id)],
    });
    useMembersStore.getState().setAll([
      makeMember(ADMIN_ID, '管理员甲', { roleKind: MemberRoleKind.Admin, role: '负责人' }),
    ]);
    useSettingsStore.setState({
      currentMemberId: opts.currentMemberId,
      hydrated: opts.hydrated ?? true,
      hydrateError: null,
    });
    useUiStore.getState().setHomeViewMode('kanban');
    useUiStore.getState().setSearchQuery('');
  });
}

const textOf = (h: HTMLElement): string => h.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  installEnvStubs();
});

afterEach(() => {
  unmountCurrent();
});

describe('首页 · 未进入身份 ⇒ 整页引导态', () => {
  it('G-1 未进入（库里有 1 个项目）⇒ 引导块在、建档 CTA 与全部数据块都不在', () => {
    seedStores({ currentMemberId: null });
    const h = renderHome();

    expect(
      h.querySelector('[data-home-no-identity]'),
      '未进入身份必须只有引导态',
    ).not.toBeNull();

    const txt = textOf(h);
    expect(
      txt,
      '「直接手动建档」在未进入态不可达（这就是本次要堵的洞）',
    ).not.toContain('直接手动建档');
    expect(
      txt,
      '库里明明有项目，未进入也不许渲染出来（visibility 漏斗口径）',
    ).not.toContain(PROJECT_NAME);
    expect(
      h.querySelector('[data-home-view-switch]'),
      '视图切换也不该在（整页引导态，不是空态）',
    ).toBeNull();
  });

  it('G-2 装载中（hydrated=false）⇒ 不下「未进入」判决，只有 DataGate 装载面', () => {
    seedStores({ currentMemberId: null, hydrated: false });
    const h = renderHome();

    expect(
      h.querySelector('[data-home-no-identity]'),
      '装载中不能把「还没读完」说成「你没进入身份」',
    ).toBeNull();
    expect(h.querySelector('[data-data-gate="loading"]'), '装载中应渲染占位').not.toBeNull();
  });

  it('G-3 进入管理员 ⇒ 引导块消失、项目网格回来', () => {
    seedStores({ currentMemberId: ADMIN_ID });
    const h = renderHome();

    expect(
      h.querySelector('[data-home-no-identity]'),
      '已进入身份不该再看到引导态',
    ).toBeNull();
    expect(textOf(h), '项目网格必须回来（收窄不是永久关门）').toContain(PROJECT_NAME);
  });

  it('G-4 引导块按钮 ⇒ 打开身份流（admin_prompt，与首启闸同款调用）', async () => {
    seedStores({ currentMemberId: null });
    const h = renderHome();
    expect(useSettingsStore.getState().identityFlow).toBe('closed');

    const btn = h.querySelector<HTMLButtonElement>('[data-home-no-identity] button');
    expect(btn, '引导块必须带「进入身份」按钮').not.toBeNull();
    await act(async () => {
      btn!.click();
      await Promise.resolve();
    });

    expect(
      useSettingsStore.getState().identityFlow,
      '点按钮必须打开身份弹层（这是引导态给的唯一出路）',
    ).toBe('admin_prompt');
  });
});
