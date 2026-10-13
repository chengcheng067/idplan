// @vitest-environment jsdom
/**
 * 首屏装载失败 = 常驻可重试错误面，而不是「假空态 + 2 秒 toast」（审计 F1-①）。
 *
 * 缺陷原文（修复前）：
 *   `useProjectsBootstrap` 失败只推一条 2 秒 toast（还是「请刷新页面重试」——
 *   本应用是 Electron 壳，没有地址栏），页面照常按「项目数 0 / 任务数 0」渲染空态：
 *     · 首页       「还没有进行中的项目 / 你的数据自动保存在本机浏览器中，关闭浏览器不会丢失」
 *     · 我的任务   「××，目前没有分配给你的待办 🎉」
 *     · 成员看板   「还没有与你相关的项目」
 *   三句话在失败时都是假话，且把用户推向「拿旧备份覆盖」「删站点数据」这两个
 *   真会毁数据的自救动作。
 *
 * 本 spec 钉住修复后的四条：
 *   ① 三态分流：装载中 = 占位（不空态）／失败 = 常驻错误面（不空态）／已装载才允许空态；
 *   ② 失败面**不依赖 toast**：toast 过期后（本 spec 用假定时器推 5s）错误面仍在；
 *   ③ 「重新装载」**真的重跑 bootstrap**（计数 1→2 且成功后渲染出真空态），不是刷新页面；
 *   ④ 失败时 `hydrated` 保持 false（否则消费方（打印页/首启闸门）会以为数据已就绪）。
 *
 * 三页各有一条反证用例（失败时不得出现各自的假空态）——把 `<DataGate>` 摘掉即红。
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

import { HomePage } from '../src/pages/HomePage';
import { MyTasksPage } from '../src/pages/MyTasksPage';
import { MemberBoardPage } from '../src/pages/MemberBoardPage';
import { useProjectsBootstrap } from '../src/hooks/useProjectsBootstrap';
import { CURRENT_MEMBER_ID_KEY, useSettingsStore } from '../src/store/useSettingsStore';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';

/* ── fake repos：本 spec 只关心「装载成功/失败」这一条链路 ── */
const hoisted = vi.hoisted(() => ({
  /** 装载动作（被 mock 掉的 bootstrapAllStores）：测试里逐次给 resolve/reject */
  bootstrap: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => ({
    tasks: { update: async () => undefined },
    itineraries: { remove: async () => undefined },
    settings: { set: async () => undefined, get: async () => null },
  }),
  /*
   * 与真实 `bootstrapAllStores` 的**契约**保持一致（见 useRepos.ts:76-80）：
   * 装载成功 = 数据落 store + 置 hydrated。少了这句，本 spec 就测不出
   * 「重试成功后界面真的恢复」，只会测出一个永远卡在装载中的假象。
   */
  bootstrapAllStores: async (): Promise<void> => {
    await hoisted.bootstrap();
    useProjectsStore.getState().replaceAll({ projects: [], stages: [], tasks: [] });
    useMembersStore.getState().setAll([]);
    useSettingsStore.getState().hydrate(null);
  },
}));

type PageKey = 'home' | 'tasks' | 'board';

/** 被测壳：真 hook（useProjectsBootstrap）+ 真页面 + 真路由 */
function Harness({ page }: { page: PageKey }): JSX.Element {
  useProjectsBootstrap();
  return (
    <MemoryRouter>
      {page === 'home' ? <HomePage /> : page === 'tasks' ? <MyTasksPage /> : <MemberBoardPage />}
    </MemoryRouter>
  );
}

let container: HTMLDivElement;
let root: Root;

function mount(page: PageKey): void {
  act(() => {
    root.render(<Harness page={page} />);
  });
}

/** 冲干净微任务链：bootstrapAllStores → then/catch → store 写入 → 重渲染 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function text(): string {
  return container.textContent ?? '';
}

function gate(state: 'failed' | 'loading'): HTMLElement | null {
  return container.querySelector(`[data-data-gate="${state}"]`);
}

function retryButton(): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === '重新装载',
  ) as HTMLButtonElement | undefined;
  if (!btn) throw new Error('未找到「重新装载」按钮');
  return btn;
}

/** 成员夹具（「我的任务」空态文案要取 name，故必须是能命中的 active 成员） */
function memberFixture(): never {
  return {
    id: 'mem_a',
    name: '小美',
    role: '设计',
    roleKind: 'member',
    active: true,
    avatarColor: '#123456',
  } as never;
}

/** 复位 store（本 spec 逐用例自隔离）+ 清 localStorage（currentMemberId 初值来自它） */
function resetStores(opts: { memberId?: string | null; hydrateError?: string | null; hydrated?: boolean } = {}): void {
  localStorage.clear();
  // 真实场景里的「上次进过身份」：值就在 localStorage 里，装载成功后 hydrate 会读回它
  if (opts.memberId) localStorage.setItem(CURRENT_MEMBER_ID_KEY, opts.memberId);
  act(() => {
    useProjectsStore.getState().replaceAll({ projects: [], stages: [], tasks: [] });
    useMembersStore.getState().setAll([]);
    useSettingsStore.setState({
      currentMemberId: opts.memberId ?? null,
      hydrated: opts.hydrated ?? false,
      hydrateError: opts.hydrateError ?? null,
      bootstrapAttempt: 0,
    });
    useProjectsStore.setState({ toasts: [] });
  });
}

beforeEach(() => {
  hoisted.bootstrap.mockReset();
  hoisted.bootstrap.mockResolvedValue(undefined);
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  resetStores();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

/* ══════════════════════════════ ① 三态分流 ══════════════════════════════ */

describe('F1-① 数据就绪三态（首页）', () => {
  it('装载中：渲染占位，绝不渲染空态', async () => {
    // bootstrap 永不落定 = 装载中（真实场景：Dexie 读取还没回来）
    hoisted.bootstrap.mockImplementation(() => new Promise(() => undefined));
    mount('home');
    await flush();

    expect(gate('loading'), '装载中应出占位').not.toBeNull();
    expect(text()).toContain('正在装载本地数据');
    expect(text(), '装载中不得出现空态').not.toContain('还没有进行中的项目');
    expect(gate('failed')).toBeNull();
  });

  it('已装载且真的没有项目：才渲染「还没有进行中的项目」空态（空态没被删）', async () => {
    mount('home');
    await flush();

    expect(useSettingsStore.getState().hydrated).toBe(true);
    expect(gate('loading')).toBeNull();
    expect(gate('failed')).toBeNull();
    expect(text()).toContain('还没有进行中的项目');
  });

  it('装载失败：常驻错误面 ＋ 空态消失 ＋ hydrated 保持 false', async () => {
    hoisted.bootstrap.mockRejectedValue(new Error('boom: idb read failed'));
    mount('home');
    await flush();

    expect(gate('failed'), '失败应出常驻错误面').not.toBeNull();
    expect(text()).toContain('本地数据装载失败');
    // 文案不得说假话：装载失败 ≠ 数据丢失，并且要劝阻「删站点数据」这个毁数据动作
    expect(text()).toContain('不等于数据丢失');
    expect(text()).toContain('请不要删除');
    // 失败原因要露出来（可截图求助），不是只留一句「失败了」
    expect(text()).toContain('boom: idb read failed');
    // 假空态必须消失
    expect(text()).not.toContain('还没有进行中的项目');
    // 副标题里的 0 计数同样是假数字
    expect(container.querySelector('[data-home-subtitle]')).toBeNull();
    // hydrated 必须保持 false：打印页/首启闸门都以它为「数据已就绪」的唯一信号
    expect(useSettingsStore.getState().hydrated).toBe(false);
  });

  it('失败面是常驻的：toast 过期后它仍在（不靠 2 秒瞬时通道）', async () => {
    vi.useFakeTimers();
    hoisted.bootstrap.mockRejectedValue(new Error('boom'));
    mount('home');
    await flush();

    expect(gate('failed')).not.toBeNull();
    expect(useProjectsStore.getState().toasts.length).toBeGreaterThan(0); // 补充通道也在
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(useProjectsStore.getState().toasts.length, 'toast 已过期').toBe(0);
    expect(gate('failed'), '错误面必须比 toast 活得久').not.toBeNull();
    expect(text()).toContain('本地数据装载失败');
  });
});

/* ══════════════════════════════ ② 重试真的重跑 bootstap ══════════════════════════════ */

describe('F1-① 「重新装载」按钮', () => {
  it('点击 → 重跑 bootstrap（计数 1→2），成功后错误面消失、渲染出真空态', async () => {
    hoisted.bootstrap.mockRejectedValueOnce(new Error('boom'));
    mount('home');
    await flush();

    expect(hoisted.bootstrap).toHaveBeenCalledTimes(1);
    expect(gate('failed')).not.toBeNull();

    hoisted.bootstrap.mockResolvedValueOnce(undefined);
    act(() => {
      retryButton().click();
    });
    // 点击瞬间即回到「装载中」（失败态被清掉，不会停在旧错误上）
    expect(useSettingsStore.getState().hydrateError).toBeNull();
    await flush();

    expect(hoisted.bootstrap, '重试必须真的重跑装载，而不是刷新页面').toHaveBeenCalledTimes(2);
    expect(useSettingsStore.getState().hydrated).toBe(true);
    expect(gate('failed')).toBeNull();
    expect(gate('loading')).toBeNull();
    expect(text(), '重试成功后才允许出现空态').toContain('还没有进行中的项目');
  });

  it('重试再失败：错误面回来（不是静默停在装载中）', async () => {
    hoisted.bootstrap.mockRejectedValue(new Error('boom'));
    mount('home');
    await flush();

    act(() => {
      retryButton().click();
    });
    expect(gate('loading'), '点击后先回到装载中').not.toBeNull();
    await flush();

    expect(hoisted.bootstrap).toHaveBeenCalledTimes(2);
    expect(gate('failed'), '再次失败必须再出错误面').not.toBeNull();
    expect(useSettingsStore.getState().hydrated).toBe(false);
  });

  it('只跑一次装载：没有重试请求时不会因为重渲染而重复装载', async () => {
    mount('home');
    await flush();
    act(() => {
      useProjectsStore.setState({ toasts: [] });
    });
    await flush();
    expect(hoisted.bootstrap).toHaveBeenCalledTimes(1);
  });
});

/* ══════════════════════════════ ③ 同类假空态：我的任务 / 成员看板 ══════════════════════════════ */

describe('F1-① 同类假空态一并收口', () => {
  it('我的任务：装载失败时不得说「目前没有分配给你的待办」', async () => {
    // 「上次进过身份」的常见状态：currentMemberId 有值（来自 localStorage），
    // 且该成员确实在成员表里 —— 修复前 `currentMemberId && myTasks.length === 0`
    // 这条判据成立，于是渲染出「××，目前没有分配给你的待办 🎉」。
    hoisted.bootstrap.mockRejectedValue(new Error('boom'));
    resetStores({ memberId: 'mem_a' });
    act(() => {
      useMembersStore.getState().setAll([memberFixture()]);
    });
    mount('tasks');
    await flush();

    expect(gate('failed')).not.toBeNull();
    expect(text(), '不得把「没读进来」说成「没有活派给你」').not.toContain('目前没有分配给你的待办');
    expect(text()).not.toContain('未找到该身份');
  });

  it('成员看板：装载失败时不得说「还没有与你相关的项目」', async () => {
    hoisted.bootstrap.mockRejectedValue(new Error('boom'));
    mount('board');
    await flush();

    expect(gate('failed')).not.toBeNull();
    expect(text(), '不得把「没读进来」说成「本来就没有相关项目」').not.toContain(
      '还没有与你相关的项目',
    );
  });

  it('我的任务：已装载且真空时，「××，目前没有分配给你的待办」仍在（三态不是二态）', async () => {
    resetStores({ memberId: 'mem_a' });
    mount('tasks');
    await flush();
    // 装载成功后才谈得上「真空」：成员表是 bootstrap 装进来的（上面 mock 会清空它）
    act(() => {
      useMembersStore.getState().setAll([memberFixture()]);
    });
    expect(text()).toContain('小美，目前没有分配给你的待办');
  });

  it('成员看板：已装载且真空时，「还没有与你相关的项目」仍在（三态不是二态）', async () => {
    resetStores({ memberId: 'mem_a' });
    mount('board');
    await flush();
    act(() => {
      useMembersStore.getState().setAll([memberFixture()]);
    });
    expect(text()).toContain('还没有与你相关的项目');
  });
});
