// @vitest-environment jsdom
/**
 * NAS 版（remote 数据源）首屏「选公司 / 新建公司」的 UI 接线 —— 批 5。
 *
 * ═══════════════════════ 这一批在堵什么洞 ═══════════════════════
 * 多工作区那套首屏（「先选公司，再选身份」）此前**只对 local 生效**：
 *   · `HomePage` 的首屏判据写着 `appEnv.dataSource === 'local' && !hasWorkspaceEntryStarted()`
 *     ⇒ NAS 远端用户永远直接看到「请先进入身份」，**根本看不到选公司这一屏**；
 *   · `WorkspacePicker` 直接 import 了四组 **local 专属**实现（注册表、
 *     `createWorkspaceOwnerDb` / `readWorkspaceGateHash`、`verifyPassword`）
 *     ⇒ 就算放开判据，它在 remote 下也接不上 NAS 上的区。
 * 本批把两者都接上：判据放开到 remote（异步三态），Picker 改为吃
 * `IWorkspaceRepository`。
 *
 * ═══════════════════════ 本文件锁什么 ═══════════════════════
 *   N1 remote 首屏渲染工作区列表（2 个区，来自假 `IWorkspaceRepository`）；
 *   N2 只有 1 个区时**也**渲染列表（不是退回身份引导）——0017 口径对 NAS 同样成立；
 *   N3 `list()` 抛错 ⇒ 渲染 `data-workspace-list-error`，**不**渲染空列表、
 *      **不**退回身份引导（空数组 ≠ 读取失败）；
 *   N4 点某个区 ⇒ `gateOf` + `verifyGate` 被调；true ⇒ 落区级键 + reload 进入；
 *      false ⇒ 显示密码错误、停在密码视图；
 *   N5 建区 ⇒ `create()` 被调，成功后以 owner 身份进入；
 *   N6 `hasWorkspaceEntryStarted()` 为 true 时 remote **仍然**渲染列表
 *      （证明 remote 不受那条 local 标记影响）。
 *
 * ═══════════════════════ 手法 ═══════════════════════
 *   · `appEnv.dataSource` 必须是 `remote`，且必须在**模块加载前**注入
 *     （`src/config/env.ts` 是模块级单例，读 `window.__APP_ENV__`）——
 *     故写在 `vi.hoisted()` 里，与本仓 `tests/plugin-toggle-feedback.spec.tsx` 同源。
 *     该注入由本文件自己的 `afterAll` 收（`tests/setup.ts` 的 afterEach 也删，
 *     这里再收一次是双保险，见 setup 文件头「模块加载前注入型例外」）。
 *   · `useRepos` 在模块边界顶掉，`workspaces` 给**可注入的假仓储**：本文件测的是
 *     「UI 有没有按契约把该调的调了」，仓储自身打到哪个端点由
 *     `tests/workspace-repository.spec.ts` 的 R1–R5 锁定。
 *   · `reloadApp` mock 成计数器（jsdom 真 reload 会抛 Not implemented）。
 *
 * ═══════════════════════ 变异自证（本仓纪律） ═══════════════════════
 *   三处均已实测变红并恢复，红色用例名逐条记录见提交说明：
 *   · 【变异 A】把 HomePage 的 remote 判据改回 `dataSource === 'local'` ⇒ N1 红；
 *   · 【变异 B】把 `list()` 的抛错处理改成静默退回 identity-guide ⇒ N3 红；
 *   · 【变异 C】忽略 `verifyGate` 的结果直接进区 ⇒ N4 红。
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

/** ★ 必须在任何 import 被求值之前注入运行环境（`src/config/env.ts` 是模块级单例） */
vi.hoisted(() => {
  (window as unknown as { __APP_ENV__?: unknown }).__APP_ENV__ = {
    VITE_DATA_SOURCE: 'remote',
    VITE_API_BASE_URL: 'http://nas.local/api',
  };
});

/* ── 假工作区仓储（可逐用例改行为） ──
 * ★ 必须整个住在 `vi.hoisted()` 里：`vi.mock` 的工厂被提升到文件顶部，工厂里
 *   引用任何**模块级 const** 都会在初始化前被求值（实测报
 *   `Cannot access 'fakeWorkspaceRepo' before initialization`）。同样的坑在
 *   `tests/plugin-toggle-feedback.spec.tsx` 头部有记录。 */
const h = vi.hoisted(() => {
  const state = {
    /** `list()` 的返回值 */
    list: [] as Array<{ id: string; name: string; ownerMemberName: string | null; createdAt: string }>,
    /** `list()` 要抛的错（null = 正常返回） */
    listError: null as unknown,
    /** 区 id → hasGate */
    gates: {} as Record<string, boolean>,
    /** `verifyGate` 的判定：给的密码 === 这个值 ⇒ true */
    correctPassword: '1234',
    /** 调用记录 */
    calls: [] as string[],
    /** `create()` 的返回值 */
    createResult: { id: 'ws-new', ownerMemberId: 'mem_owner_new' },
    /** `create()` 收到的入参 */
    createArgs: null as unknown,
    /** 「整页 reload」次数 */
    reloads: 0,
    /** 假仓储（下面立刻填好；这里先占位是为了让闭包指向**同一个** state 对象） */
    fakeRepo: undefined as unknown,
  };
  /*
   * ★ 闭包必须读 `state`（也就是最终返回出去的那个对象），不能读一个 spread 副本：
   *   spread 会把 `list` / `listError` 这些**原语**复制一份 ⇒ 用例里 `h.list = [...]`
   *   只改了副本、仓储读到的还是初始空数组，症状是「列表永远 0 项」而代码看着没错
   *   （本文件第一版就踩了这个，实测 11 红）。
   */
  state.fakeRepo = {
    list: async (): Promise<unknown> => {
      state.calls.push('list');
      if (state.listError !== null) throw state.listError;
      return state.list;
    },
    create: async (cmd: unknown): Promise<unknown> => {
      state.calls.push('create');
      state.createArgs = cmd;
      return state.createResult;
    },
    gateOf: async (id: string): Promise<unknown> => {
      state.calls.push(`gateOf:${id}`);
      return { hasGate: state.gates[id] ?? false };
    },
    verifyGate: async (id: string, pw: string): Promise<boolean> => {
      state.calls.push(`verifyGate:${id}`);
      return pw === state.correctPassword;
    },
    setGate: async (id: string, pw: string): Promise<void> => {
      state.calls.push(`setGate:${id}`);
      state.gates[id] = true;
      state.correctPassword = pw;
    },
  };
  return state;
});

vi.mock('../src/lib/reload', () => ({
  reloadApp: (): void => {
    h.reloads += 1;
  },
}));

/* HomePage 链读仓库（ProjectCard / MembersPageSection 等），本文件判据只看工作区那一屏 */
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
    /* ★ 被测的那一格：remote 形态必须提供 workspaces（运行期完备性由
       tests/workspace-repository.spec.ts 的 A1/A2 钉住） */
    workspaces: h.fakeRepo,
  };
  return { useRepos: (): unknown => bundle };
});

/* 审计日志静音（会写 store / localStorage，与本文件判据无关） */
vi.mock('../src/core/services/log.service', () => ({
  logUser: vi.fn(),
  logError: vi.fn(),
}));

import { HomePage } from '../src/pages/HomePage';
import { useMembersStore } from '../src/store/useMembersStore';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import { appEnv } from '../src/config/env';
import { MemberActorKind, MemberRoleKind } from '../src/core/types/enums';
import {
  currentWorkspaceIdSync,
  hasWorkspaceEntryStarted,
  identityKeyFor,
  markWorkspaceEntryStarted,
  selectedWorkspaceIdSync,
} from '../src/lib/workspace-registry';

/* ══════════════════════════════ 环境自证 ══════════════════════════════ */

describe('N0 · 环境前置（否则整份文件的判据都在测 local）', () => {
  it('N0 appEnv.dataSource 真的是 remote（模块加载前的注入被吃到了）', () => {
    expect(appEnv.dataSource).toBe('remote');
    expect(appEnv.apiBaseUrl).toBe('http://nas.local/api');
  });
});

/* ══════════════════════════════ 脚手架 ══════════════════════════════ */

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

/** 挂 HomePage 并**冲干净异步链**（remote 首屏要等 `list()` 回来才定档） */
async function renderHome(): Promise<HTMLDivElement> {
  unmountCurrent();
  const el = document.createElement('div');
  document.body.appendChild(el);
  host = el;
  const r = createRoot(el);
  root = r;
  await act(async () => {
    r.render(
      <MemoryRouter initialEntries={['/']}>
        <HomePage />
      </MemoryRouter>,
    );
    // `list()` 是 async ⇒ 至少两拍：Promise 落定 + 置档后的重渲染
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return el;
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

/** 未进入身份 + 已装载（首屏判据只在 hydrated && !isEntered 这一屏生效） */
function seedStores(): void {
  unmountCurrent();
  act(() => {
    useProjectsStore.getState().replaceAll({ projects: [], stages: [], tasks: [] });
    useMembersStore.getState().setAll([
      {
        id: 'mem_admin',
        name: '管理员甲',
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
      },
    ]);
    useSettingsStore.setState({ currentMemberId: null, hydrated: true, hydrateError: null });
    useUiStore.getState().setHomeViewMode('kanban');
    useUiStore.getState().setSearchQuery('');
  });
}

function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: Element | null): Promise<void> {
  expect(el, '待点击的元素必须存在').not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** NAS 上的两个区（服务端形状：无 dbName 字段 —— 接口层刻意不给 UI 看见「库名」） */
const TWO_WORKSPACES = [
  { id: 'ws-jia', name: '甲公司', ownerMemberName: '甲老板', createdAt: '2026-10-01T00:00:00Z' },
  { id: 'ws-yi', name: '乙公司', ownerMemberName: '乙老板', createdAt: '2026-10-02T00:00:00Z' },
];

const ONE_WORKSPACE = [TWO_WORKSPACES[0]!];

beforeEach(() => {
  localStorage.clear();
  h.list = TWO_WORKSPACES;
  h.listError = null;
  h.gates = {};
  h.correctPassword = '1234';
  h.calls = [];
  h.createResult = { id: 'ws-new', ownerMemberId: 'mem_owner_new' };
  h.createArgs = null;
  h.reloads = 0;
  installEnvStubs();
});

afterEach(() => {
  unmountCurrent();
});

afterAll(() => {
  delete (window as unknown as { __APP_ENV__?: unknown }).__APP_ENV__;
});

/* ══════════════════════════ N1 · 首屏渲染工作区列表 ══════════════════════════ */

describe('N1 · remote 未进入身份 ⇒ 首屏是工作区列表', () => {
  it('N1 remote + 2 个区 ⇒ 渲染工作区列表（区名 + Owner 名），不渲染身份引导', async () => {
    seedStores();
    const el = await renderHome();

    expect(
      el.querySelector('[data-workspace-picker]'),
      'NAS 版必须和桌面版一样先看到「选公司」这一屏',
    ).not.toBeNull();
    expect(el.querySelector('[data-workspace-list]'), '列表态要渲染出来').not.toBeNull();
    expect(
      el.querySelector('[data-home-no-identity]'),
      '列表档不许同时出现身份引导块',
    ).toBeNull();

    const items = el.querySelectorAll('[data-workspace-item]');
    expect(items, '服务端两个区 ⇒ 两条列表项').toHaveLength(2);
    const txt = el.textContent ?? '';
    expect(txt, '区名来自服务端 ownerMemberName 派生').toContain('甲公司');
    expect(txt).toContain('乙老板');
    expect(txt).toContain('乙公司');

    // 列表来自 `repo.list()`，且只取一次（本页取，组件不重复取）
    expect(h.calls.filter((c) => c === 'list')).toHaveLength(1);
  });

  it('N1b 列表渲染的是服务端给的形状：不依赖 dbName（接口层不暴露库名）', async () => {
    seedStores();
    const el = await renderHome();
    // 渲染出的每一项 id 与服务端给的 id 逐字一致（不是从注册表/库名反推的）
    const ids = [...el.querySelectorAll('[data-workspace-item]')].map((n) =>
      n.getAttribute('data-workspace-item'),
    );
    expect(ids).toEqual(['ws-jia', 'ws-yi']);
  });
});

/* ══════════════════════════ N2 · 只有一个区也给列表 ══════════════════════════ */

describe('N2 · 只有 1 个区也渲染列表（不退回身份引导）', () => {
  it('N2 服务端只有 1 个区 ⇒ 仍是工作区列表', async () => {
    h.list = ONE_WORKSPACE;
    seedStores();
    const el = await renderHome();

    expect(
      el.querySelector('[data-workspace-picker]'),
      '0017 口径「先选公司，再选身份」对 NAS 同样成立：单区也要给列表',
    ).not.toBeNull();
    expect(el.querySelectorAll('[data-workspace-item]'), '列表里就一项').toHaveLength(1);
    expect(
      el.querySelector('[data-home-no-identity]'),
      '单区不许退回「请先进入身份」引导块',
    ).toBeNull();
    expect(el.querySelector('[data-workspace-new]'), '列表里必须能新建公司').not.toBeNull();
  });

  it('N2b 服务端返回空数组 ⇒ 仍是列表档（空态是真空态，不是读取失败）', async () => {
    h.list = [];
    seedStores();
    const el = await renderHome();

    expect(el.querySelector('[data-workspace-picker]')).not.toBeNull();
    expect(el.querySelectorAll('[data-workspace-item]')).toHaveLength(0);
    expect(
      el.querySelector('[data-workspace-list-error]'),
      '空数组 ≠ 读取失败，不许出错误面',
    ).toBeNull();
    expect(el.querySelector('[data-home-no-identity]')).toBeNull();
  });
});

/* ══════════════════════════ N3 · 读取失败 ≠ 没有公司 ══════════════════════════ */

describe('N3 · list() 抛错 ⇒ 明确的失败面（不静默退回引导）', () => {
  it('N3 读取失败 ⇒ 渲染 data-workspace-list-error，不渲染空列表、不退回身份引导', async () => {
    h.listError = new Error('nas unreachable');
    seedStores();
    const el = await renderHome();

    expect(
      el.querySelector('[data-workspace-list-error]'),
      'NAS 读不到区列表必须是一次**可见的失败**',
    ).not.toBeNull();
    expect(
      el.querySelector('[data-workspace-list]'),
      '失败时不许渲染一张空列表（那会被读成「这台 NAS 上没有公司」）',
    ).toBeNull();
    expect(
      el.querySelector('[data-home-no-identity]'),
      '更不许静默退回身份引导 —— 用户会以为没有公司，转而去建一个重名的新区',
    ).toBeNull();
    expect((el.textContent ?? '').includes('工作区读取失败'), '要说清是读取失败').toBe(true);
    expect(el.querySelector('[data-workspace-list-retry]'), '失败面必须带重试入口').not.toBeNull();
  });

  it('N3b 点「重试」⇒ 真的重取一次；成功后渲染出列表', async () => {
    h.listError = new Error('nas unreachable');
    seedStores();
    const el = await renderHome();
    expect(h.calls.filter((c) => c === 'list')).toHaveLength(1);

    // 故障恢复
    h.listError = null;
    h.list = ONE_WORKSPACE;
    await click(el.querySelector('[data-workspace-list-retry]'));

    expect(h.calls.filter((c) => c === 'list'), '重试必须真的重取').toHaveLength(2);
    expect(el.querySelector('[data-workspace-list-error]'), '成功后错误面消失').toBeNull();
    expect(el.querySelectorAll('[data-workspace-item]')).toHaveLength(1);
  });
});

/* ══════════════════════════ N4 · 选已有的区要验密 ══════════════════════════ */

describe('N4 · 点某个区 ⇒ 验密（remote 校验走 repo.verifyGate）', () => {
  it('N4-1 设过闸密的区 ⇒ 先 `gateOf`，再出密码表单；验密前不进区不 reload', async () => {
    h.gates['ws-jia'] = true;
    seedStores();
    const el = await renderHome();

    await click(el.querySelector('[data-workspace-item="ws-jia"]'));

    expect(h.calls, '必须先问这个区有没有闸密').toContain('gateOf:ws-jia');
    expect(
      el.querySelector('[data-workspace-gate-input]'),
      '设过密码的区必须先验密',
    ).not.toBeNull();
    expect(h.calls.some((c) => c.startsWith('verifyGate')), '还没输密码就不该验').toBe(false);
    expect(h.reloads, '验密前绝不进区').toBe(0);
  });

  it('N4-2 密码输对 ⇒ 落区级身份键 + 进入标记 + 整页 reload', async () => {
    h.gates['ws-jia'] = true;
    h.correctPassword = '8888';
    seedStores();
    const el = await renderHome();
    await click(el.querySelector('[data-workspace-item="ws-jia"]'));

    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-gate-input]')!, '8888');
    await click(el.querySelector('[data-workspace-gate-submit]'));

    expect(h.calls, 'verifyGate 必须被调到，且对准那个区').toContain('verifyGate:ws-jia');
    expect(currentWorkspaceIdSync(), '验证通过后当前区落盘').toBe('ws-jia');
    expect(selectedWorkspaceIdSync(), '「本浏览器显式选过」也必须落盘').toBe('ws-jia');
    expect(hasWorkspaceEntryStarted(), '进入流程标记落盘（两种形态同构）').toBe(true);
    expect(h.reloads, '换区必须整页 reload（新 bundle + 新的 X-Workspace-Id）').toBe(1);
  });

  it('N4-3 密码输错 ⇒ 显示密码错误、停在密码视图，不切区不 reload', async () => {
    h.gates['ws-jia'] = true;
    h.correctPassword = '8888';
    seedStores();
    const el = await renderHome();
    await click(el.querySelector('[data-workspace-item="ws-jia"]'));

    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-gate-input]')!, 'wrong');
    await click(el.querySelector('[data-workspace-gate-submit]'));

    expect(h.calls).toContain('verifyGate:ws-jia');
    expect(el.textContent ?? '', '要明说密码不对').toContain('密码不对');
    expect(
      el.querySelector('[data-workspace-gate-input]'),
      '输错要停在密码视图让人重输',
    ).not.toBeNull();
    expect(h.reloads, '密码不对绝不进区').toBe(0);
    expect(currentWorkspaceIdSync(), '当前区不许被改动').toBe('');
    expect(selectedWorkspaceIdSync()).toBeNull();
  });
});

/* ══════════════════════════ N5 · 建区 ══════════════════════════ */

describe('N5 · 建区 ⇒ repo.create + 以 Owner 身份进入', () => {
  it('N5 合法提交 ⇒ 调 create（入参逐字）+ 落新区的区级身份键 + reload', async () => {
    seedStores();
    const el = await renderHome();
    await click(el.querySelector('[data-workspace-new]'));

    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-name-input]')!, '丙公司');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-owner-input]')!, '丙老板');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-pw-input]')!, '1234');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-pw-confirm]')!, '1234');
    await click(el.querySelector('[data-workspace-create-submit]'));

    expect(h.calls).toContain('create');
    expect(h.createArgs).toEqual({ name: '丙公司', ownerName: '丙老板', password: '1234' });
    expect(currentWorkspaceIdSync(), '建区后当前区 = 新区').toBe('ws-new');
    expect(
      localStorage.getItem(identityKeyFor('ws-new')),
      '建区即以 Owner 身份进入：ownerMemberId 必须落到新区的区级身份键',
    ).toBe('mem_owner_new');
    expect(h.reloads, '建区后整页 reload 换 bundle').toBe(1);
  });

  it('N5b 校验不通过时一次 create 都不发', async () => {
    seedStores();
    const el = await renderHome();
    await click(el.querySelector('[data-workspace-new]'));
    // 什么都没填
    await click(el.querySelector('[data-workspace-create-submit]'));
    expect((el.textContent ?? '').includes('请填写工作区名称')).toBe(true);
    expect(h.calls, '校验没过就不许打到服务端').not.toContain('create');
    expect(h.reloads).toBe(0);
  });
});

/* ══════════════════════════ N6 · 不受 local 标记影响 ══════════════════════════ */
describe('N6 · remote 不受 hasWorkspaceEntryStarted() 影响', () => {
  it('N6 那条 local 标记为 true 时，remote 仍然渲染工作区列表', async () => {
    markWorkspaceEntryStarted();
    expect(hasWorkspaceEntryStarted(), '前置：标记确实置位了').toBe(true);
    seedStores();
    const el = await renderHome();

    expect(
      el.querySelector('[data-workspace-picker]'),
      'NAS 多人多端下，本浏览器的「进过区」标记不该挡住「我想换公司」',
    ).not.toBeNull();
    expect(el.querySelectorAll('[data-workspace-item]')).toHaveLength(2);
    expect(el.querySelector('[data-home-no-identity]')).toBeNull();
  });

  it('N6b 本浏览器已选过区 + 已进入身份 ⇒ 不再白取列表（省一次跨网请求）', async () => {
    localStorage.setItem('idplan.currentWorkspaceId', 'ws-jia');
    seedStores();
    act(() => {
      useSettingsStore.setState({ currentMemberId: 'mem_admin' });
    });
    await renderHome();
    expect(h.calls.filter((c) => c === 'list'), '已进入身份这一屏不渲染列表').toHaveLength(0);
  });
});

/* ══════════════════════════ N7 · 退出身份 ⇒ 回区列表（remote 也成立） ══════════════════════════ */

describe('N7 · remote 退出身份 ⇒ 首屏回到工作区列表', () => {
  it('N7 本浏览器选过区 + 已进入身份 ⇒ 退出身份后回到工作区列表', async () => {
    localStorage.setItem('idplan.currentWorkspaceId', 'ws-jia');
    seedStores();
    act(() => {
      useSettingsStore.setState({ currentMemberId: 'mem_admin' });
    });
    const el = await renderHome();
    // 已进入身份：不是「未进入」那一屏（列表不渲染）
    expect(el.querySelector('[data-home-no-identity]')).toBeNull();
    expect(el.querySelector('[data-workspace-picker]'), '已进入身份时不该有选公司界面').toBeNull();

    // 退出身份（真实路径：setCurrentMember(null)，它同时清 entryStarted）
    await act(async () => {
      useSettingsStore.getState().setCurrentMember(null);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      el.querySelector('[data-workspace-picker]'),
      'NAS 上退出身份也必须回到「选公司」这一屏（批 5 之前这里永远不回）',
    ).not.toBeNull();
    expect(el.querySelector('[data-workspace-list]'), '回的是列表态').not.toBeNull();
    expect(el.querySelector('[data-home-no-identity]'), '不再卡在「请先进入身份」').toBeNull();
    // 列表数据是现取的（退出那一刻缓存可能已过期）
    expect(h.calls.filter((c) => c === 'list').length).toBeGreaterThanOrEqual(1);
  });
});
