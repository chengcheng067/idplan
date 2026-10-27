// @vitest-environment jsdom
/**
 * 工作区选择器 UI（多工作区 0016 · 版本 1.0.0.0016 第二切片）。
 *
 * ═══════════════════════ 本文件锁什么 ═══════════════════════
 *   ★ 0017 订正（产品负责人验收 0016 的两条取舍）：
 *     ① 「切换工作区」入口只在**没有任何身份**时出现 ⇒ 侧栏入口连同
 *        WorkspacePicker 的 modal 变体一并删除（唯一挂载点是首屏列表）；
 *     ② **从列表进入任何工作区都必须验密码**，包括当前区。
 *   P1 未进入身份 ⇒ 首屏**一律**是工作区选择列表——**只有一个默认区时也要显示**
 *       （列表里就一项，且必须能「新建工作区」）。产品心智是「先选公司，再选身份」，
 *       不再退回 0015 的「请先进入身份」引导块；
 *   P2 多区 ⇒ 首屏是工作区选择列表（区名 + Owner 名），引导块让位；
 *   P3 「进入流程已开始」（选区/建区后 reload 回来）⇒ 身份引导而不是区列表
 *       （这一条必须留，否则每次 reload 都要重选一次，死循环）；
 *   P4 跨区验密：目标区设过管理员密码 ⇒ 先出密码表单；输错不切、可重试；
 *      输对 ⇒ 当前区 id 落注册表 + 进入标记落盘 + 整页 reload；
 *   P5 同区（= 当前区）从列表进入 ⇒ **也要验密**（0016 的免密短路已删）；
 *      验对 ⇒ 回调 onEnterCurrentWorkspace 回身份引导，不重载；
 *   P6 新建工作区：表单校验（区名/Owner 名/密码 ≥4/两次一致）→ 建库+Owner
 *      入库（core 调用入参断言）→ 注册表登记 → 区级身份键落 Owner → 切区 reload；
 *   P7 目标区**没设过**闸密码 ⇒ **不直接进**，先出「给这个区设密码」表单：
 *      校验（≥4 位 / 两次一致）→ 写哈希（core 调用入参断言）→ 再进入。
 *
 * ═══════════════════════ mock 设计 ═══════════════════════
 *   · useRepos 在模块边界顶掉（与 tests/home-no-identity-guide.spec.tsx 同源手法）；
 *   · workspace.db 的三个 Dexie 出口 mock 掉（W3/W4 已在 tests/workspace-foundation.spec.ts
 *     验过真库行为，本文件只锁 UI 编排）；但 readWorkspaceGateHash 返回的是
 *     **真 hashPassword 产物**，verifyPassword 走真算法——验密断言不是 mock 陪跑；
 *     writeWorkspaceGateHash 落到同一份 h.gateHashes，写进去一定读得出来；
 *   · reload mock 成 spy：真实 reload 在 jsdom 会抛 Not implemented。
 *
 * ═══════════════════════ 变异自证（本仓纪律） ═══════════════════════
 *   以下三处均已实测变红并恢复（红色用例名逐条记录）：
 *   · 【变异 A】pick() 开头加回 0016 的同区免密短路（`ws.id === currentId` 直接
 *     onEnterCurrentWorkspace 返回）⇒ 红 4 条：
 *       P5-1 从列表点选**当前区**也要验密（不再有同区免密短路）
 *       P5-2 当前区密码输错 ⇒ 报错留在表单，不回身份引导
 *       P5-3 当前区密码输对 ⇒ 回调回身份引导，不重载（库已经装好了）
 *       P7-5 当前区没设过闸密 ⇒ 同样先设密码，设好后回身份引导（不重载）
 *   · 【变异 B】pick() 的 `!hash` 分支改回 0016 的 enterWorkspace 直接进 ⇒ 红 5 条：
 *       P7-1 无闸密的区被选中 ⇒ 出「设密码」表单，不直接进
 *       P7-2 校验：密码过短 / 两次不一致都不提交
 *       P7-3 设好 ⇒ 哈希写到该区（core 入参断言）+ 进入该区 + reload
 *       P7-4 写哈希失败 ⇒ 报错留在表单，不进区不 reload
 *       P7-5 当前区没设过闸密 ⇒ 同样先设密码，设好后回身份引导（不重载）
 *   · 【变异 C】HomePage firstScreen 判据改回 `listWorkspaces().length > 1 || …`
 *     ⇒ 红 1 条：P1 只有一个默认区 ⇒ 首屏仍是工作区选择列表（先选公司，再选身份）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  gateHashes: {} as Record<string, string | null>,
  createdWorkspaces: [] as Array<{ dbName: string; ownerName: string; password: string }>,
  /** 每次「给老区补设闸密」的调用入参（P7 断言落点） */
  setPwCalls: [] as Array<{ dbName: string; password: string }>,
  /** 置 true ⇒ writeWorkspaceGateHash 返回 false（错误分支夹具） */
  setPwFails: false,
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
    /** 写闸密：把真哈希落到 h.gateHashes —— 与读同一份，写进去一定读得出来 */
    writeWorkspaceGateHash: async (dbName: string, password: string): Promise<boolean> => {
      if (h.setPwFails) return false;
      h.gateHashes[dbName] = await hashPassword(password);
      h.setPwCalls.push({ dbName, password });
      return true;
    },
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
  h.setPwCalls = [];
  h.setPwFails = false;
  h.reloads = 0;
  installEnvStubs();
});

afterEach(() => {
  unmountCurrent();
});

describe('P1–P3 · HomePage 未进入身份的首屏二选一', () => {
  it('P1 只有一个默认区 ⇒ 首屏仍是工作区选择列表（先选公司，再选身份）', () => {
    listWorkspaces(); // 只有默认一个区
    seedHomeStores();
    const el = renderHome();

    expect(
      el.querySelector('[data-workspace-picker]'),
      '单区也必须显工作区列表——产品口径「先选公司，再选身份」',
    ).not.toBeNull();
    expect(el.querySelector('[data-home-no-identity]'), '列表态不再先渲染身份引导').toBeNull();
    expect(el.querySelectorAll('[data-workspace-item]'), '列表里就一项').toHaveLength(1);
    expect(el.querySelector('[data-workspace-new]'), '列表里必须能新建工作区').not.toBeNull();
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

describe('P4–P5 · 从列表进入必须验密（跨区 / 同区都要）', () => {
  it('P4-1 目标区设过密码 ⇒ 先出密码表单，不直接切', async () => {
    const wsB = seedTwoWorkspaces();
    h.gateHashes['idplan-ws-b'] = await hashPassword('6666');
    const onEnterCurrent = vi.fn();
    const el = renderUi(<WorkspacePicker onEnterCurrentWorkspace={onEnterCurrent} />);

    await click(el.querySelector('[data-workspace-item="ws-b"]'));

    expect(el.querySelector('[data-workspace-gate-input]'), '必须先验目标区密码').not.toBeNull();
    expect(h.reloads, '验密前绝不切区').toBe(0);
    expect(currentWorkspaceIdSync()).not.toBe(wsB);
    expect(onEnterCurrent).not.toHaveBeenCalled();
  });

  it('P4-2 密码输错 ⇒ 报错留在表单，不切区不重载', async () => {
    seedTwoWorkspaces();
    h.gateHashes['idplan-ws-b'] = await hashPassword('6666');
    const el = renderUi(<WorkspacePicker />);
    await click(el.querySelector('[data-workspace-item="ws-b"]'));

    const input = el.querySelector<HTMLInputElement>('[data-workspace-gate-input]');
    setInputValue(input!, 'wrong-pass');
    await click(el.querySelector('[data-workspace-gate-submit]'));
    await flushCrypto();

    expect(el.textContent ?? '').toContain('密码不对');
    expect(h.reloads).toBe(0);
    expect(currentWorkspaceIdSync()).toBe('ws-default');
  });

  it('P4-3 密码输对 ⇒ 当前区切换 + 进入标记落盘 + 整页 reload', async () => {
    const wsB = seedTwoWorkspaces();
    h.gateHashes['idplan-ws-b'] = await hashPassword('6666');
    const el = renderUi(<WorkspacePicker />);
    await click(el.querySelector('[data-workspace-item="ws-b"]'));

    const input = el.querySelector<HTMLInputElement>('[data-workspace-gate-input]');
    setInputValue(input!, '6666');
    await click(el.querySelector('[data-workspace-gate-submit]'));
    await flushCrypto();

    expect(currentWorkspaceIdSync(), '验密通过后当前区必须切过去').toBe(wsB);
    expect(hasWorkspaceEntryStarted(), '进入流程标记必须落盘').toBe(true);
    expect(h.reloads, '换库必须整页 reload').toBe(1);
  });

  /*
   * ★ P5 = 0017 的核心订正：0016 里「同区选中不验密不重载」是免密短路，
   *   产品负责人否掉了——从工作区列表进入**任何**区都要验密码，哪怕它就是当前区。
   */
  it('P5-1 从列表点选**当前区**也要验密（不再有同区免密短路）', async () => {
    listWorkspaces();
    h.gateHashes['changxia'] = await hashPassword('1111'); // 默认区（dbName = changxia）
    const onEnterCurrent = vi.fn();
    const el = renderUi(<WorkspacePicker onEnterCurrentWorkspace={onEnterCurrent} />);

    await click(el.querySelector('[data-workspace-item="ws-default"]'));

    expect(
      el.querySelector('[data-workspace-gate-input]'),
      '同区也必须先验密码（0016 的同区免密短路已删）',
    ).not.toBeNull();
    expect(onEnterCurrent, '验密前不许回身份引导').not.toHaveBeenCalled();
    expect(h.reloads).toBe(0);
  });

  it('P5-2 当前区密码输错 ⇒ 报错留在表单，不回身份引导', async () => {
    listWorkspaces();
    h.gateHashes['changxia'] = await hashPassword('1111');
    const onEnterCurrent = vi.fn();
    const el = renderUi(<WorkspacePicker onEnterCurrentWorkspace={onEnterCurrent} />);
    await click(el.querySelector('[data-workspace-item="ws-default"]'));

    const input = el.querySelector<HTMLInputElement>('[data-workspace-gate-input]');
    setInputValue(input!, 'wrong-pass');
    await click(el.querySelector('[data-workspace-gate-submit]'));
    await flushCrypto();

    expect(el.textContent ?? '').toContain('密码不对');
    expect(onEnterCurrent, '密码不对就不许进').not.toHaveBeenCalled();
    expect(h.reloads).toBe(0);
  });

  it('P5-3 当前区密码输对 ⇒ 回调回身份引导，不重载（库已经装好了）', async () => {
    listWorkspaces();
    h.gateHashes['changxia'] = await hashPassword('1111');
    const onEnterCurrent = vi.fn();
    const el = renderUi(<WorkspacePicker onEnterCurrentWorkspace={onEnterCurrent} />);
    await click(el.querySelector('[data-workspace-item="ws-default"]'));

    const input = el.querySelector<HTMLInputElement>('[data-workspace-gate-input]');
    setInputValue(input!, '1111');
    await click(el.querySelector('[data-workspace-gate-submit]'));
    await flushCrypto();

    expect(onEnterCurrent, '验密通过后才回身份引导').toHaveBeenCalledTimes(1);
    expect(h.reloads, '当前区不必换库，不重载').toBe(0);
    expect(currentWorkspaceIdSync()).toBe('ws-default');
  });
});

describe('P6 · 新建工作区（表单 → 建库 → 以 Owner 进入）', () => {
  it('P6-1 校验：缺区名 / 缺 Owner 名 / 密码过短 / 两次不一致都不提交', async () => {
    listWorkspaces();
    const el = renderUi(<WorkspacePicker />);
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
    const el = renderUi(<WorkspacePicker />);
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
    expect(h.reloads, '建区后整页 reload 换库').toBe(1);
  });

  it('P6-3 注册表当前区切换在 reload 前落盘（setCurrentWorkspaceId 直接写注册表）', () => {
    const wsB = seedTwoWorkspaces();
    expect(currentWorkspaceIdSync()).toBe('ws-default');
    setCurrentWorkspaceId(wsB);
    expect(currentWorkspaceIdSync()).toBe(wsB);
  });
});

/*
 * ★ P7 = 0017 的第二处订正：0016 里「该区没设过密码 ⇒ 无可验之物，直接进」
 *   是免密放行，产品负责人否掉了——老区/没设过密码的区，从列表进入时要
 *   **先设一个密码再进**（今后进入这个区都要它），而不是直接放行。
 */
describe('P7 · 目标区没设过闸密码 ⇒ 先设密码再进（不是直接进）', () => {
  it('P7-1 无闸密的区被选中 ⇒ 出「设密码」表单，不直接进', async () => {
    const wsB = seedTwoWorkspaces();
    // 故意不给 idplan-ws-b 设闸密（h.gateHashes 里没有它 ⇒ readWorkspaceGateHash 返回 null）
    const el = renderUi(<WorkspacePicker />);

    await click(el.querySelector('[data-workspace-item="ws-b"]'));

    expect(
      el.querySelector('[data-workspace-setpw-input]'),
      '没设过密码的区必须先设密码，不许直接进',
    ).not.toBeNull();
    expect(el.querySelector('[data-workspace-setpw-confirm]'), '要有确认密码输入').not.toBeNull();
    expect(el.querySelector('[data-workspace-gate-input]')).toBeNull();
    expect(h.reloads, '设密码前绝不切区').toBe(0);
    expect(currentWorkspaceIdSync(), '设密码前绝不切区').not.toBe(wsB);
    expect((el.textContent ?? '').includes('还没有工作区密码'), '要说清这个区还没密码').toBe(true);
  });

  it('P7-2 校验：密码过短 / 两次不一致都不提交', async () => {
    seedTwoWorkspaces();
    const el = renderUi(<WorkspacePicker />);
    await click(el.querySelector('[data-workspace-item="ws-b"]'));

    // 过短
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-setpw-input]')!, '12');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-setpw-confirm]')!, '12');
    await click(el.querySelector('[data-workspace-setpw-submit]'));
    expect((el.textContent ?? '').includes('至少 4 位'), '过次要报').toBe(true);
    expect(h.setPwCalls).toHaveLength(0);
    expect(h.reloads).toBe(0);

    // 两次不一致
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-setpw-input]')!, '1234');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-setpw-confirm]')!, '5678');
    await click(el.querySelector('[data-workspace-setpw-submit]'));
    expect((el.textContent ?? '').includes('不一样'), '两次不一致要报').toBe(true);
    expect(h.setPwCalls).toHaveLength(0);
    expect(h.reloads).toBe(0);
  });

  it('P7-3 设好 ⇒ 哈希写到该区（core 入参断言）+ 进入该区 + reload', async () => {
    const wsB = seedTwoWorkspaces();
    const el = renderUi(<WorkspacePicker />);
    await click(el.querySelector('[data-workspace-item="ws-b"]'));

    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-setpw-input]')!, '8899');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-setpw-confirm]')!, '8899');
    await click(el.querySelector('[data-workspace-setpw-submit]'));
    await flushCrypto();

    // 哈希真的写到**那个区**上（不是当前区）
    expect(h.setPwCalls).toHaveLength(1);
    expect(h.setPwCalls[0]!.dbName).toBe('idplan-ws-b');
    expect(h.setPwCalls[0]!.password).toBe('8899');
    expect(h.gateHashes['idplan-ws-b'], '写进去的必须是哈希，不是明文').not.toBe('8899');

    // 设好就进入该区
    expect(currentWorkspaceIdSync()).toBe(wsB);
    expect(hasWorkspaceEntryStarted()).toBe(true);
    expect(h.reloads, '换库必须整页 reload').toBe(1);
  });

  it('P7-4 写哈希失败 ⇒ 报错留在表单，不进区不 reload', async () => {
    seedTwoWorkspaces();
    h.setPwFails = true;
    const el = renderUi(<WorkspacePicker />);
    await click(el.querySelector('[data-workspace-item="ws-b"]'));

    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-setpw-input]')!, '8899');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-setpw-confirm]')!, '8899');
    await click(el.querySelector('[data-workspace-setpw-submit]'));
    await flushCrypto();

    expect((el.textContent ?? '').includes('设置工作区密码失败'), '写失败要给提示').toBe(true);
    expect(currentWorkspaceIdSync(), '写失败就不许进').toBe('ws-default');
    expect(h.reloads).toBe(0);
  });

  it('P7-5 当前区没设过闸密 ⇒ 同样先设密码，设好后回身份引导（不重载）', async () => {
    listWorkspaces();
    // 默认区也没设过密码
    const onEnterCurrent = vi.fn();
    const el = renderUi(<WorkspacePicker onEnterCurrentWorkspace={onEnterCurrent} />);

    await click(el.querySelector('[data-workspace-item="ws-default"]'));
    expect(el.querySelector('[data-workspace-setpw-input]'), '当前区也要先设密码').not.toBeNull();
    expect(onEnterCurrent).not.toHaveBeenCalled();

    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-setpw-input]')!, '4321');
    setInputValue(el.querySelector<HTMLInputElement>('[data-workspace-setpw-confirm]')!, '4321');
    await click(el.querySelector('[data-workspace-setpw-submit]'));
    await flushCrypto();

    expect(h.setPwCalls[0]!.dbName).toBe('changxia');
    expect(onEnterCurrent, '设好后才回身份引导').toHaveBeenCalledTimes(1);
    expect(h.reloads, '当前区不必换库，不重载').toBe(0);
  });
});
