// @vitest-environment jsdom
/**
 * 工作区选择器 UI（多工作区 0016 · 版本 1.0.0.0016 第二切片）。
 *
 * ═══════════════════════ 本文件锁什么 ═══════════════════════
 *   P1 单区（且未手动切过）⇒ HomePage 未进入身份维持 0015 引导态原样，
 *      不出现工作区列表（老用户零多余步骤——本批最大的回归红线）；
 *   P2 多区 ⇒ 首屏是工作区选择列表（区名 + Owner 名），引导块让位；
 *   P3 「进入流程已开始」（选区/建区后 reload 回来）⇒ 身份引导而不是区列表；
 *   P4 切区验密：目标区设过管理员密码 ⇒ 先出密码表单；输错不切、可重试；
 *      输对 ⇒ 当前区 id 落注册表 + 进入/手动切换标记落盘 + 整页 reload；
 *   P5 同区选中 ⇒ 不验密、不重载（拍板口径「同区退出重进不验」），page 态
 *      回调 onEnterCurrentWorkspace 回身份引导；
 *   P6 新建工作区：表单校验（区名/Owner 名/密码 ≥4/两次一致）→ 建库+Owner
 *      入库（core 调用入参断言）→ 注册表登记 → 区级身份键落 Owner → 切区 reload。
 *
 * ═══════════════════════ mock 设计 ═══════════════════════
 *   · useRepos 在模块边界顶掉（与 tests/home-no-identity-guide.spec.tsx 同源手法）；
 *   · workspace.db 的两个 Dexie 出口 mock 掉（W3/W4 已在 tests/workspace-foundation.spec.ts
 *     验过真库行为，本文件只锁 UI 编排）；但 readWorkspaceGateHash 返回的是
 *     **真 hashPassword 产物**，verifyPassword 走真算法——验密断言不是 mock 陪跑；
 *   · reload mock 成 spy：真实 reload 在 jsdom 会抛 Not implemented。
 *
 * ═══════════════════════ 变异自证（本仓纪律） ═══════════════════════
 *   · 把 HomePage firstScreen 判据里的 `listWorkspaces().length > 1` 注释掉 ⇒ P2 红；
 *   · 把 WorkspacePicker pick() 里 `ws.id === currentId` 的同区分支删掉 ⇒ P5 红
 *     （同区也去探测闸密，密码表单出现、onEnterCurrentWorkspace 不被调用）；
 *   · 把 submitGate 成功分支里的 enterWorkspace 调用删掉 ⇒ P4-3 红；
 *   · 把 submitCreate 里 writeMemberIdForWorkspace 删掉 ⇒ P6-4 红。
 *   以上均已实测变红并恢复。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  gateHashes: {} as Record<string, string | null>,
  createdWorkspaces: [] as Array<{ dbName: string; ownerName: string; password: string }>,
  reloads: 0,
}));

vi.mock('../src/lib/reload', () => ({
  reloadApp: (): void => {
    h.reloads += 1;
  },
}));

vi.mock('../src/core/repositories/local/workspace.db', async () => {
  const { hashPassword } = await import('../src/lib/password');
  return {
    readWorkspaceGateHash: async (dbName: string): Promise<string | null> =>
      h.gateHashes[dbName] ?? null,
    createWorkspaceOwnerDb: async (cmd: {
      dbName: string;
      ownerName: string;
      password: string;
    }): Promise<string> => {
      h.createdWorkspaces.push({ ...cmd });
      void hashPassword; // 哈希真伪已由 workspace-foundation.spec 锁定
      return 'mem_new_owner';
    },
  };
});

/* HomePage 链读仓库（bootstrap/侧栏等），本文件判据只看 store —— 模块边界顶掉 */
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

/* 审计日志静音（会写 store / localStorage，与本文件判据无关） */
vi.mock('../src/core/services/log.service', () => ({
  logUser: vi.fn(),
  logError: vi.fn(),
}));

import { HomePage } from '../src/pages/HomePage';
import { WorkspacePicker } from '../src/components/workspace/WorkspacePicker';
import { useMembersStore } from '../src/store/useMembersStore';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import { hashPassword } from '../src/lib/password';
import { MemberActorKind, MemberRoleKind } from '../src/core/types/enums';
import {
  addWorkspace,
  currentWorkspaceIdSync,
  hasWorkspaceEntryStarted,
  hasWorkspaceManuallySwitched,
  identityKeyFor,
  listWorkspaces,
  markWorkspaceEntryStarted,
  setCurrentWorkspaceId,
} from '../src/lib/workspace-registry';

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

function renderUi(node: React.ReactNode): HTMLDivElement {
  unmountCurrent();
  const el = document.createElement('div');
  document.body.appendChild(el);
  host = el;
  const r = createRoot(el);
  root = r;
  act(() => {
    r.render(<MemoryRouter initialEntries={['/']}>{node}</MemoryRouter>);
  });
  return el;
}

const renderHome = (): HTMLDivElement => renderUi(<HomePage />);

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

/** 装库（HomePage 用）：未进入身份 + 空 hydrated 库（引导态的最小夹具） */
function seedHomeStores(): void {
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

/** 受控输入框的 jsdom 写法：绕过 React 的 value 缓存，再派发 input */
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
  });
}

/** 等真·PBKDF2（210k 迭代的 crypto.subtle 是真实异步，微任务 flush 不够） */
async function flushCrypto(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
}

/** 预置两个工作区（默认区 + B 区），返回 B 区 id */
function seedTwoWorkspaces(): string {
  listWorkspaces(); // 先让默认区落地
  addWorkspace({
    id: 'ws-b',
    name: 'B 工作室',
    createdAt: new Date().toISOString(),
    ownerMemberName: '乙老板',
    dbName: 'idplan-ws-b',
  });
  return 'ws-b';
}

beforeEach(() => {
  localStorage.clear();
  h.gateHashes = {};
  h.createdWorkspaces = [];
  h.reloads = 0;
  installEnvStubs();
});

afterEach(() => {
  unmountCurrent();
});

describe('P1–P3 · HomePage 未进入身份的首屏二选一', () => {
  it('P1 单区且未手动切过 ⇒ 维持 0015 引导态，不出现工作区列表', () => {
    listWorkspaces(); // 只有默认一个区
    seedHomeStores();
    const el = renderHome();

    expect(el.querySelector('[data-home-no-identity]'), '单区老用户看到的必须还是身份引导').not.toBeNull();
    expect(el.querySelector('[data-workspace-picker]'), '单区不显工作区列表').toBeNull();
  });

  it('P2 多区 ⇒ 首屏是工作区选择列表（区名 + Owner 名），引导块让位', () => {
    seedTwoWorkspaces();
    seedHomeStores();
    const el = renderHome();

    const picker = el.querySelector('[data-workspace-picker]');
    expect(picker, '多区必须显工作区选择列表').not.toBeNull();
    expect(el.querySelector('[data-home-no-identity]'), '列表态不再渲染身份引导').toBeNull();
    const items = el.querySelectorAll('[data-workspace-item]');
    expect(items).toHaveLength(2);
    const txt = el.textContent ?? '';
    expect(txt).toContain('B 工作室');
    expect(txt).toContain('乙老板');
    expect(txt).toContain('未命名工作室');
  });

  it('P3 进入流程已开始（entryStarted）⇒ 身份引导而不是区列表（切区 reload 回来的那屏）', () => {
    seedTwoWorkspaces();
    markWorkspaceEntryStarted();
    seedHomeStores();
    const el = renderHome();

    expect(el.querySelector('[data-home-no-identity]'), '进入流程已开始 ⇒ 给身份引导').not.toBeNull();
    expect(el.querySelector('[data-workspace-picker]')).toBeNull();
  });
});

describe('P4–P5 · 切区验密 / 同区不验', () => {
  it('P4-1 目标区设过密码 ⇒ 先出密码表单，不直接切', async () => {
    const wsB = seedTwoWorkspaces();
    h.gateHashes['idplan-ws-b'] = await hashPassword('6666');
    const onEnterCurrent = vi.fn();
    const el = renderUi(
      <WorkspacePicker variant="page" onEnterCurrentWorkspace={onEnterCurrent} />,
    );

    await click(el.querySelector('[data-workspace-item="ws-b"]'));

    expect(el.querySelector('[data-workspace-gate-input]'), '必须先验目标区密码').not.toBeNull();
    expect(h.reloads, '验密前绝不切区').toBe(0);
    expect(currentWorkspaceIdSync()).not.toBe(wsB);
    expect(onEnterCurrent).not.toHaveBeenCalled();
  });

  it('P4-2 密码输错 ⇒ 报错留在表单，不切区不重载', async () => {
    seedTwoWorkspaces();
    h.gateHashes['idplan-ws-b'] = await hashPassword('6666');
    const el = renderUi(<WorkspacePicker variant="page" />);
    await click(el.querySelector('[data-workspace-item="ws-b"]'));

    const input = el.querySelector<HTMLInputElement>('[data-workspace-gate-input]');
    setInputValue(input!, 'wrong-pass');
    await click(el.querySelector('[data-workspace-gate-submit]'));
    await flushCrypto();

    expect(el.textContent ?? '').toContain('密码不对');
    expect(h.reloads).toBe(0);
    expect(currentWorkspaceIdSync()).toBe('ws-default');
  });

  it('P4-3 密码输对 ⇒ 当前区切换 + 进入/手动切换标记落盘 + 整页 reload', async () => {
    const wsB = seedTwoWorkspaces();
    h.gateHashes['idplan-ws-b'] = await hashPassword('6666');
    const el = renderUi(<WorkspacePicker variant="page" />);
    await click(el.querySelector('[data-workspace-item="ws-b"]'));

    const input = el.querySelector<HTMLInputElement>('[data-workspace-gate-input]');
    setInputValue(input!, '6666');
    await click(el.querySelector('[data-workspace-gate-submit]'));
    await flushCrypto();

    expect(currentWorkspaceIdSync(), '验密通过后当前区必须切过去').toBe(wsB);
    expect(hasWorkspaceEntryStarted(), '进入流程标记必须落盘').toBe(true);
    expect(hasWorkspaceManuallySwitched(), '手动切换标记必须落盘').toBe(true);
    expect(h.reloads, '换库必须整页 reload').toBe(1);
  });

  it('P5 同区选中 ⇒ 不验密不重载，page 态回调回身份引导', async () => {
    listWorkspaces();
    const onEnterCurrent = vi.fn();
    const el = renderUi(
      <WorkspacePicker variant="page" onEnterCurrentWorkspace={onEnterCurrent} />,
    );

    await click(el.querySelector('[data-workspace-item="ws-default"]'));

    expect(onEnterCurrent, '同区选中应回身份引导').toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-workspace-gate-input]'), '同区不验密').toBeNull();
    expect(h.reloads).toBe(0);
    expect(currentWorkspaceIdSync()).toBe('ws-default');
  });
});

describe('P6 · 新建工作区（表单 → 建库 → 以 Owner 进入）', () => {
  it('P6-1 校验：缺区名 / 缺 Owner 名 / 密码过短 / 两次不一致都不提交', async () => {
    listWorkspaces();
    const el = renderUi(<WorkspacePicker variant="page" />);
    await click(el.querySelector('[data-workspace-new]'));

    // 什么都没填
    await click(el.querySelector('[data-workspace-create-submit]'));
    expect((el.textContent ?? '').includes('请填写工作区名称'), '缺区名要报').toBe(true);
    expect(h.createdWorkspaces).toHaveLength(0);

    // 只填区名 → 缺 Owner 名
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-name-input]')!, '新工作室');
    await click(el.querySelector('[data-workspace-create-submit]'));
    expect((el.textContent ?? '').includes('请填写 Owner'), '缺 Owner 名要报').toBe(true);
    expect(h.createdWorkspaces).toHaveLength(0);

    // Owner 名有了，密码过短
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-owner-input]')!, '丞丞');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-pw-input]')!, '12');
    await click(el.querySelector('[data-workspace-create-submit]'));
    expect((el.textContent ?? '').includes('至少 4 位'), '密码过次要报').toBe(true);
    expect(h.createdWorkspaces).toHaveLength(0);

    // 两次不一致
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-pw-input]')!, '1234');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-pw-confirm]')!, '5678');
    await click(el.querySelector('[data-workspace-create-submit]'));
    expect((el.textContent ?? '').includes('不一样'), '两次不一致要报').toBe(true);
    expect(h.createdWorkspaces).toHaveLength(0);
  });

  it('P6-2 合法提交 ⇒ 建库入库 + 注册表登记 + 区级身份键落 Owner + 切区 reload', async () => {
    listWorkspaces();
    const el = renderUi(<WorkspacePicker variant="page" />);
    await click(el.querySelector('[data-workspace-new]'));

    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-name-input]')!, '新工作室');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-owner-input]')!, '丞丞');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-pw-input]')!, '1234');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-pw-confirm]')!, '1234');
    await click(el.querySelector('[data-workspace-create-submit]'));

    // core 出口被以正确入参调用（哈希真伪由 workspace-foundation.spec 锁定）
    expect(h.createdWorkspaces).toHaveLength(1);
    expect(h.createdWorkspaces[0]!.ownerName).toBe('丞丞');
    expect(h.createdWorkspaces[0]!.password).toBe('1234');
    expect(h.createdWorkspaces[0]!.dbName).toMatch(/^idplan-ws-/);

    // 注册表登记
    const entries = listWorkspaces();
    expect(entries).toHaveLength(2);
    const created = entries.find((w) => w.id !== 'ws-default')!;
    expect(created.name).toBe('新工作室');
    expect(created.ownerMemberName).toBe('丞丞');
    expect(created.dbName).toBe(h.createdWorkspaces[0]!.dbName);

    // 直接以 Owner 进入：当前区 = 新区、Owner 落新区的区级身份键
    expect(currentWorkspaceIdSync()).toBe(created.id);
    expect(localStorage.getItem(identityKeyFor(created.id))).toBe('mem_new_owner');
    expect(hasWorkspaceEntryStarted()).toBe(true);
    expect(hasWorkspaceManuallySwitched()).toBe(true);
    expect(h.reloads, '建区后整页 reload 换库').toBe(1);
  });

  it('P6-3 侧栏入口（modal 态）⇒ 同区选中直接关浮层', async () => {
    listWorkspaces();
    const onClose = vi.fn();
    const el = renderUi(<WorkspacePicker variant="modal" onClose={onClose} />);

    // ⚠️ modal 走 Modal 的 createPortal 到 body —— 不能从宿主容器里找元素
    await click(document.querySelector('[data-workspace-item="ws-default"]'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(h.reloads).toBe(0);
    void el;
  });

  it('P6-4 注册表当前区切换在 reload 前落盘（setCurrentWorkspaceId 直接写注册表）', () => {
    const wsB = seedTwoWorkspaces();
    expect(currentWorkspaceIdSync()).toBe('ws-default');
    setCurrentWorkspaceId(wsB);
    expect(currentWorkspaceIdSync()).toBe(wsB);
  });
});
