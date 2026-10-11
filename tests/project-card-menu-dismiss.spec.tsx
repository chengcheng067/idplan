// @vitest-environment jsdom
/**
 * F9 · 项目卡 ⋯ 菜单的关闭契约（滚动 / 缩放 / 外点）。
 *
 * ══════════════════ 本文件为什么存在 ══════════════════
 * 菜单是 portal 到 body 的 **fixed** 浮层：坐标在打开那一刻量一次就写死，不再跟随卡片。
 * 而卡片住在 `main` 这个全站唯一滚动容器里 —— 打开菜单后滚动页面，菜单会**悬在原地**
 * 与触发按钮错位（用户看到的是「菜单跟卡片分家了」）。修前只注册了 `mousedown` 外点关闭，
 * 滚动与缩放都无人管。
 *
 * 本文件锁三件事：
 *   ① 滚动必关，且**必须是捕获阶段**：页面滚动容器抛出的 `scroll` 事件 `bubbles: false`，
 *      冒泡监听收不到（本文件刻意用 `new Event('scroll')`（不冒泡）派发在**子元素**上，
 *      就是为了让「把 capture 去掉」这个变异当场转红，而不是靠一个冒泡事件假绿）。
 *   ② 窗口缩放必关（`menuPos` 的翻转/夹取结果随视口失效）。
 *   ③ 既有两条行为一字不改：点面板内部**不关**（否则点菜单项会自杀式关闭）、
 *      点面板外部**要关**。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

/*
 * ProjectCard 会在渲染期 `useRepos()` —— 真实路径要求整棵 RepoProvider（= 真库 + bootstrap）。
 * 本文件只测菜单的关闭契约，与仓储无关：给一个空壳 bundle 让组件能渲染即可
 * （动作永不触发；`ProjectService` 只在构造时收引用，不读库）。
 */
vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => ({
    projects: {},
    stages: {},
    logs: {},
    tasks: {},
    members: {},
    // 卡片子树里挂着打印预览入口（use-print-logo 会读设置 KV 取全局 logo）
    settings: { all: async () => [] },
  }),
}));

import { ProjectCard } from '../src/components/project/ProjectCard';
import { useMembersStore } from '../src/store/useMembersStore';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { __resetRegistryForTest } from '../src/core/color/custom-color-registry';
import type { Member, Project, Stage } from '../src/core/types/entities';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
} from '../src/core/types/enums';

const ADMIN: Member = {
  id: 'mem_menu_admin',
  name: '菜单探针管理员',
  role: '负责人',
  contact: null,
  avatarColor: '#88A293',
  active: true,
  roleKind: MemberRoleKind.Admin,
  passwordHash: null,
  actorKind: MemberActorKind.Human,
  agentKind: null,
  revision: 1,
  updatedAt: '2026-10-01T00:00:00Z',
};

const PROJECT: Project = {
  id: 'proj_menu',
  name: '菜单项目',
  address: '',
  clientName: '客户甲',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: '2026-06-01T00:00:00Z',
  plannedEndAt: '2026-06-30T23:59:59Z',
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  domain: null,
  kind: 'human',
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-06-01T00:00:00Z',
  ownerMemberId: null,
};

const STAGE: Stage = {
  id: 'stg_menu',
  projectId: PROJECT.id,
  orderIndex: 2,
  templateKey: null,
  colorIndex: 2,
  customColor: null,
  name: '菜单阶段',
  ratioPercent: 100,
  startAt: '2026-06-01T00:00:00Z',
  endAt: '2026-06-30T23:59:59Z',
  status: StageStatus.InProgress,
  ownerId: null,
  visible: true,
  resourcePath: null,
  revision: 1,
  updatedAt: '2026-06-01T00:00:00Z',
};

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

function mountCard(): HTMLDivElement {
  unmountCurrent();
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  const r = createRoot(h);
  root = r;
  act(() => {
    r.render(
      <MemoryRouter>
        <ProjectCard
          project={PROJECT}
          stages={[STAGE]}
          tasks={[]}
          members={[ADMIN]}
          todayIso="2026-06-10"
          onOpen={() => undefined}
        />
      </MemoryRouter>,
    );
  });
  return h;
}

/** ⋯ 菜单面板（portal 到 body）；未打开时 null */
function menuPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]');
}

/** 打开菜单并返回面板（打开态是前置，不是结论） */
function openMenu(): HTMLElement {
  const h = host;
  if (h === null) throw new Error('卡片未挂载');
  const btn = h.querySelector<HTMLElement>('button[aria-label="项目更多操作"]');
  if (btn === null) throw new Error('未找到 ⋯ 菜单按钮');
  act(() => {
    btn.click();
  });
  const panel = menuPanel();
  if (panel === null) throw new Error('点击后菜单未出现（前置不成立，后续断言无意义）');
  return panel;
}

/** jsdom 缺 matchMedia / ResizeObserver（同 tests/stage-color-wiring.spec.tsx 的最小桩） */
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
  __resetRegistryForTest();
  installEnvStubs();
  unmountCurrent();
  act(() => {
    // 卡片读 projects store 派生阶段色；不种库会在渲染期就去碰仓储上下文
    useProjectsStore.getState().replaceAll({
      projects: [PROJECT],
      stages: [STAGE],
      tasks: [],
    });
    useMembersStore.getState().setAll([ADMIN]);
    useSettingsStore.setState({ currentMemberId: ADMIN.id, hydrated: true });
  });
});

afterEach(() => {
  unmountCurrent();
  act(() => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  });
  __resetRegistryForTest();
});

describe('F9 · 项目卡 ⋯ 菜单关闭契约', () => {
  it('卡片内滚动（scroll 不冒泡）⇒ 菜单关闭（这条同时锁住「必须捕获阶段」）', () => {
    const h = mountCard();
    openMenu();

    // 关键：`scroll` 事件的 bubbles 为 false —— 只有捕获阶段监听才收得到。
    // 派发在卡片内部的子元素上（真机就是 main 滚动容器抛这个事件）。
    const inner = h.querySelector<HTMLElement>('div');
    if (inner === null) throw new Error('卡片内无子元素可派发 scroll');
    act(() => {
      inner.dispatchEvent(new Event('scroll'));
    });
    expect(menuPanel(), '滚动后菜单必须关闭（否则 fixed 菜单与卡片错位）').toBeNull();
  });

  it('窗口 resize ⇒ 菜单关闭', () => {
    mountCard();
    openMenu();
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(menuPanel()).toBeNull();
  });

  it('点面板内部不关闭（既有行为：否则点菜单项会一闪即关）', () => {
    mountCard();
    const panel = openMenu();
    act(() => {
      panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menuPanel(), '面板内 mousedown 不是外点').not.toBeNull();
  });

  it('点面板外部关闭（既有行为）', () => {
    mountCard();
    openMenu();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menuPanel()).toBeNull();
  });
});
