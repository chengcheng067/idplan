// @vitest-environment jsdom
/**
 * 设置抽屉 · **关闭请求信号**（v1.0 · 2026-10-14）
 *
 * ══════════════════ 为什么需要这条机制 ══════════════════
 * 设置抽屉的 `open` 是 `Sidebar` / `MobileMoreMenu` 的**组件内 state**，而
 * 「打开 Agent 看板」那颗按钮住在 `manifest.settingsSlot` 里 —— 插件组件由
 * `PluginSettingsSlot` 以 `<Slot />` **无 props** 渲染，拿不到宿主的 `onClose`。
 * 没有通道 ⇒ 用户点了「打开 Agent 看板」之后，640px 的抽屉会继续盖在刚导航过去的
 * /agent 页面上（功能回退）。通道就是 `useUiStore.requestSettingsClose()`：请求方 bump
 * 一个单调计数，抽屉订阅它并调自己的 `onClose`。
 *
 * ══════════════════ 本 spec 守什么 ══════════════════
 * 这条机制最容易写错的地方**不是「不关」，而是「乱关」**：订阅 effect 的依赖里有
 * `onClose`，而两个真实挂载点传的都是**内联箭头函数**（`onClose={() => setSettingsOpen(false)}`）
 * ⇒ 每次渲染都是新引用 ⇒ effect 每次渲染都重跑。若判据写成「计数 > 0 就关」，
 * 那么用户只要在抽屉里点任何东西触发一次重渲染，抽屉就会**自己关掉**。
 * 所以四条判据里有三条是在钉「不许乱关」：
 *   ① 请求一次 ⇒ 关一次（机制本体）；
 *   ② **没有新请求**时重渲染（onClose 换新引用）⇒ **不许关**；
 *   ③ 连续两次请求 ⇒ 关两次（计数不是布尔，不去重）；
 *   ④ 抽屉本来就关着时收到请求 ⇒ 不再回调（不制造无意义的关闭）。
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/**
 * jsdom 的 Element 没有 `scrollTo`（切分区时设置面板会调它回顶）——补一处即可。
 *
 * ★ **补丁也要对称还原**（见文件末的 `afterAll`）。理由不是「这个补丁有害」（它其实
 *   只可能让别人更好过：补的是 jsdom 缺失的方法，且带 `typeof` 守卫），而是
 *   **「谁负责还原」这个问题必须一致地回答** —— 本会话另一个 spec 已经为它写的
 *   `window.__APP_ENV__` 答了这个问题（并在那里漏答一次、害别人的三条用例全红）。
 *   一旦允许「有的补丁有人负责、有的没人负责」，下一次来的人补一个**有害**的补丁时
 *   也不会有人问这句话。
 *
 * ⚠️ **口径订正（2026-10-14，实测后改）**：我写这条注释的第一版说「vitest 的 jsdom 环境
 *   按文件新建 ⇒ `Element.prototype` 本来每文件一份 ⇒ 这条还原**不可证伪**」——
 *   **那是错的**，而且与**同仓** `tests/setup.ts` 那句「jsdom 的 document 是**进程级单例**」
 *   直接矛盾（我本该先读同仓的那句话）。
 *
 *   实测（`qa-scratch/probe-globals/`，A 文件写、B 文件读，**与仓内同配置**）：
 *   B 文件读到了 A 写的 `window.__PROBE_MARK__`、`Element.prototype.__probeMethod`、
 *   `globalThis.__PROBE__` **全部存在** ⇒ **本仓配置下跨文件的全局是共享的**
 *   （`pool:'threads'` + `singleThread:true`，未显式设 `isolate`）。
 *   ⇒ `window.__matchMedia` 的泄漏能传播到下一个文件，也是同一机制（有实测支持，不再是推断）。
 *
 *   **因此本条还原属于「可证伪」的那一类**（与 `window.__APP_ENV__` 同一类：跨文件全局）：
 *   只要有后续文件依赖「上一个文件留下的补丁」，「删 / 不删」就会产生可观测差异。
 *   它**不是**「看起来更严谨但无人能证伪」的仪式。
 *
 *   ⚠️ 但**当前用例集合下**没有任何文件依赖这个补丁 ⇒ **现在**删与不删看不出差别 ⇒
 *   按「纪律 / 验证分账」的口径，它仍该记作**纪律**（缺的是「能把它打红的对照用例」），
 *   **而不是**因为它不可证伪。这两句话不一样，别混。
 *
 * `HAD_SCROLL_TO` 记住「本来有没有」：有 ⇒ 不是我们加的，**不许删**（删掉会改坏
 * 别人依赖的既有实现）；没有 ⇒ 我们加的，`afterAll` 里删掉。
 */
const HAD_SCROLL_TO = typeof Element.prototype.scrollTo === 'function';
if (!HAD_SCROLL_TO) {
  Element.prototype.scrollTo = () => {};
}

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
    },
    members: { list: async () => [], get: async () => null, insert: ok, update: ok, remove: ok },
    settings: { all: async () => [], get: async () => null, set: ok, remove: ok },
    stageLogs: { listByStage: async () => [], append: ok },
    customStages: { list: async () => [], insert: ok, update: ok, remove: ok },
    dumpTables: async () => ({}),
  };
  return { useRepos: () => bundle, bootstrapAllStores: async () => undefined };
});

import { SettingsDialog } from '../src/components/layout/SettingsDialog';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import { MemberActorKind, MemberRoleKind } from '../src/core/types/enums';

const ADMIN = {
  id: 'mem_close_admin',
  name: '关闭信号探针',
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
} as const;

let host: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn>;

/**
 * 挂载。`onClose` 刻意传**内联箭头**（与 `Sidebar` / `MobileMoreMenu` 的真实写法逐字一致）——
 * 它的引用每次渲染都会变，正是本 spec ② 要压住的那个坑。
 */
function render(open: boolean): void {
  act(() => {
    root.render(<SettingsDialog open={open} onClose={() => onClose()} />);
  });
}

/** 发一次关闭请求（Agent 面板的「打开 Agent 看板」做的就是这一件事） */
function requestClose(): void {
  act(() => {
    useUiStore.getState().requestSettingsClose();
  });
}

beforeEach(() => {
  onClose = vi.fn();
  useMembersStore.getState().setAll([{ ...ADMIN }]);
  useSettingsStore.setState({ currentMemberId: ADMIN.id, hydrated: true });
  useUiStore.setState({ settingsCloseRequest: 0 });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useUiStore.setState({ settingsCloseRequest: 0 });
  useSettingsStore.setState({ currentMemberId: null, hydrated: false });
});

/**
 * ★ 原型补丁的**对称还原**（与文件头的 `HAD_SCROLL_TO` 配对）。
 *
 * 只删「本文件加上去的」那一次：本来就有 ⇒ 原样留着（删它会改坏别人依赖的既有实现）。
 * 为什么这件事必须做：**「谁负责还原」这个问题要一致地回答** —— 本会话另一个 spec
 * （`plugin-toggle-feedback.spec.tsx`）曾经在 `vi.hoisted` 里写 `window.__APP_ENV__`
 * 却没人还原，代价是别人的三条用例整段代码不执行、全红，藏了整整一轮才被二分挖出来。
 * 补丁无害不等于可以不回答这个问题；允许「有无害的例外」，下一个有害的补丁就不会有人问。
 */
afterAll(() => {
  if (!HAD_SCROLL_TO) {
    delete (Element.prototype as unknown as { scrollTo?: unknown }).scrollTo;
  }
});

describe('设置抽屉 · 关闭请求信号', () => {
  it('① 请求一次 ⇒ 关一次', () => {
    render(true);
    expect(onClose).not.toHaveBeenCalled();
    requestClose();
    expect(onClose, '请求到了就该关').toHaveBeenCalledTimes(1);
  });

  it('★ ② 没有新请求时重渲染（onClose 换新引用）⇒ 不许关', () => {
    render(true);
    requestClose();
    expect(onClose).toHaveBeenCalledTimes(1);

    /*
     * 触发重渲染的方式**必须**让 `onClose` 的引用真的换掉 —— 这是本条的判据本身。
     * ⚠️ 只点左导航切分区是**不够**的（我第一版就是这么写的，是一条假绿的恒过断言）：
     *    `onClose={() => onClose()}` 这个元素是在**测试**的 render() 里创建的，
     *    组件内部 setState 引起的重渲染不会重新求值它 ⇒ 引用不变 ⇒ effect 不重跑
     *    ⇒ 断言恒过。真实场景里那个箭头定义在 `Sidebar` 的 JSX 里，Sidebar 一重渲染
     *    （身份变化 / 插件启停 / toast…）它就是新引用。所以这里直接再 render 一次
     *    SettingsDialog（新箭头 = 新引用），把 effect 逼着重跑。
     */
    render(true);
    const btn = document.querySelector<HTMLButtonElement>('[data-settings-zone="about"]');
    expect(btn, '前提：左导航要有分区按钮（顺带证明抽屉还开着）').not.toBeNull();
    act(() => btn!.click());
    render(true);

    expect(
      onClose,
      'onClose 每次渲染都换引用 ⇒ effect 会重跑；把判据写成「计数>0 就关」会让抽屉自己关掉',
    ).toHaveBeenCalledTimes(1);
  });

  it('③ 连续两次请求 ⇒ 关两次（计数不是布尔，不去重）', () => {
    render(true);
    requestClose();
    render(true); // 真实的关闭动作会让 `open` 变 false，这里保持开着以观察第二次
    requestClose();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('④ 抽屉本来就关着 ⇒ 收到请求也不再回调（不制造无意义的关闭）', () => {
    render(false);
    requestClose();
    expect(onClose).not.toHaveBeenCalled();
  });
});
