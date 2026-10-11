// @vitest-environment jsdom
/**
 * F5 · 设置分区的**角色闭环**：管理员专属分区不得在成员身份下留在右栏。
 *
 * ══════════════════ 事故形态（她报的那条）══════════════════
 *   管理员 → 设置 → 左导航选「排程」→ 关闭设置 → 顶栏切成**成员** → 再打开设置
 *   ⇒ 右栏**仍然是排程内容**（休息制度编辑器、打印标识上传、品牌词编辑都在里面），
 *   而左导航里既没有「排程」这一项、也没有任何高亮 —— 用户看到一块"没有出处"的
 *   管理员界面，并且**可以直接操作**（上传 logo、改品牌词）。
 *
 * ══════════════════ 根因 ══════════════════
 *   `ZONES` 的 `adminOnly` 只喂给了 `visibleZones`（**左导航**），没喂给**内容分支**：
 *     · `zone` 只在用户点击左导航时被写（全文件仅一处 setZone 调用点）；
 *     · 关闭抽屉不复位，设置组件的挂载点（Sidebar 底部 / MobileMoreMenu）**不随
 *       身份切换卸载** ⇒ `zone` 跨会话保留。
 *   于是「把导航项藏起来」被当成了"权限已经做到了" —— 而右栏还在按同一个 `zone`
 *   分支渲染。**导航与内容是两条独立的路，只堵了一条。**
 *
 * ══════════════════ 本 spec 守什么 ══════════════════
 *   按真实操作序列走一遍（管理员选排程 → 关闭 → 切成员 → 重开），断言两件事：
 *     ① 右栏**不出现**任何管理员专属面板（不是"藏起来"，是根本没渲染）；
 *     ② 停在第一个**可见**分区（左导航第一项「外观」），且与高亮一致。
 *   另有一条更强的：**身份在抽屉开着时**切换（不经过"关闭再打开"这条路）——
 *   这条只有渲染期的 `activeZone` 兜底能过，光靠复位 effect 会先闪一帧排程面板。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/**
 * jsdom 的 Element **没有** `scrollTo`（只有 window 有）。设置面板切分区时会调它回顶，
 * 不打桩就会在 effect 里抛 `not a function` 把整条用例炸掉（与本文件要测的东西无关）。
 * 只补这一处、不做全局改写：真 Chromium 侧本来就有实现，走的是 settings-zones.spec.ts。
 */
if (typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = () => {};
}

/**
 * 顶掉真实仓储：SettingsDialog 经 `useRepos()` 读 Context，而本用例只关心
 * 分区可见性（不关心取数）。工厂被提升，故全部在工厂内定义（同 stage-drawer 的范式）。
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
    },
    members: { list: async () => [], get: async () => null, insert: ok, update: ok, remove: ok },
    settings: { all: async () => ({}), get: async () => null, set: ok, remove: ok },
    stageLogs: { listByStage: async () => [], append: ok },
    customStages: { list: async () => [], insert: ok, update: ok, remove: ok },
    dumpTables: async () => ({}),
  };
  return { useRepos: () => bundle, bootstrapAllStores: async () => undefined };
});

import { SettingsDialog } from '../src/components/layout/SettingsDialog';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import type { Member } from '../src/core/types/entities';
import { MemberActorKind, MemberRoleKind } from '../src/core/types/enums';

const ADMIN: Member = {
  id: 'mem_zone_admin',
  name: '分区探针管理员',
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

const PLAIN: Member = {
  ...ADMIN,
  id: 'mem_zone_member',
  name: '分区探针成员',
  role: '设计师',
  roleKind: MemberRoleKind.Member,
};

let host: HTMLDivElement;
let root: Root;

/** 当前渲染的分区面板（`data-settings-zone-panel` 是既有的验收钩子） */
function panelZone(): string | null {
  return document.querySelector('[data-settings-zone-panel]')?.getAttribute('data-settings-zone-panel') ?? null;
}

function navZoneKeys(): string[] {
  return Array.from(document.querySelectorAll('[data-settings-zone]')).map(
    (b) => b.getAttribute('data-settings-zone') ?? '',
  );
}

function panelText(): string {
  return document.querySelector('[data-settings-zone-panel]')?.textContent ?? '';
}

function clickZone(key: string): void {
  const btn = document.querySelector<HTMLButtonElement>(`[data-settings-zone="${key}"]`);
  if (btn === null) throw new Error(`左导航里没有分区：${key}`);
  act(() => {
    btn.click();
  });
}

function render(open: boolean): void {
  act(() => {
    root.render(<SettingsDialog open={open} onClose={() => {}} />);
  });
}

/** 切换当前身份（顶栏身份入口做的也是这一件事：写 settings store 的 currentMemberId） */
function becomeMember(id: string | null): void {
  act(() => {
    useSettingsStore.setState({ currentMemberId: id });
  });
}

beforeEach(() => {
  useMembersStore.getState().setAll([ADMIN, PLAIN]);
  useSettingsStore.setState({ currentMemberId: ADMIN.id, hydrated: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useSettingsStore.setState({ currentMemberId: null, hydrated: false });
});

describe('F5 · 设置分区的角色闭环', () => {
  it('管理员 → 选「排程」→ 关闭 → 切成员 → 重开：不出现管理员面板，停在第一可见分区', () => {
    // ① 管理员打开设置，左导航里确实有「排程」
    render(true);
    expect(navZoneKeys(), '管理员应看得到排程分区').toContain('schedule');

    // ② 选「排程」——右栏切到排程内容，且管理员专属块在里面（前置证据）
    clickZone('schedule');
    expect(panelZone()).toBe('schedule');
    expect(panelText(), '管理员在排程区应看到打印标识').toContain('打印标识');

    // ③ 关闭设置
    render(false);

    // ④ 顶栏切成成员
    becomeMember(PLAIN.id);

    // ⑤ 重开设置
    render(true);

    // 断言 ①：右栏不出现任何管理员专属面板 —— 是**根本没渲染**，不是藏起来
    expect(panelZone(), '成员身份下不该停在排程分区').not.toBe('schedule');
    expect(panelText(), '成员不该看到「打印标识」上传区').not.toContain('打印标识');
    expect(panelText(), '成员不该看到「休息制度」编辑器').not.toContain('休息制度');
    expect(navZoneKeys(), '左导航也不该有排程项（既有行为，不得回退）').not.toContain('schedule');

    // 断言 ②：停在第一个**可见**分区，且与左导航高亮一致
    expect(panelZone(), '应停在第一个可见分区').toBe('appearance');
    const active = document.querySelector('[data-settings-zone][aria-current="true"]');
    expect(active?.getAttribute('data-settings-zone'), '高亮必须与右栏一致').toBe('appearance');
  });

  it('身份在抽屉**开着**时切换：同样不得渲染管理员面板（零帧泄漏，不靠"关闭再打开"）', () => {
    render(true);
    clickZone('schedule');
    expect(panelZone()).toBe('schedule');

    // 不关抽屉，直接换身份 —— 这条只有渲染期兜底能过（复位 effect 在 paint 之后跑）
    becomeMember(PLAIN.id);
    expect(panelZone(), '换身份的当帧就该落到可见分区').toBe('appearance');
    expect(panelText()).not.toContain('打印标识');
  });

  it('切回管理员后仍能进排程（复位不能把分区锁死）', () => {
    render(true);
    clickZone('schedule');
    render(false);
    becomeMember(PLAIN.id);
    render(true);
    expect(panelZone()).toBe('appearance');

    becomeMember(ADMIN.id);
    clickZone('schedule');
    expect(panelZone(), '身份回到管理员后「排程」必须重新可用').toBe('schedule');
    expect(panelText()).toContain('打印标识');
  });
});

describe('F5 · 静态接线锁（防「只堵导航、漏了内容」复发）', () => {
  const ROOT = resolve(__dirname, '..');
  const src = readFileSync(resolve(ROOT, 'src/components/layout/SettingsDialog.tsx'), 'utf-8');

  it('内容分支必须走 activeZone —— 不许再按裸 zone 渲染', () => {
    expect(src, '渲染期兜底在位').toContain(
      'const activeZone: ZoneKey = visibleZones.some((z) => z.key === zone) ? zone : firstVisibleZone;',
    );
    /*
     * 这条是本文件的**全部意义**所在：修前的病灶正是「导航按 visibleZones 收、
     * 内容按裸 zone 分」——两条路只堵了一条。裸 `{zone === ` 出现在渲染分支里
     * 就等于 F5 原样复发（成员右栏又能看到管理员面板）。
     */
    expect(src, '内容/导航不许再按裸 zone 渲染或高亮').not.toMatch(/\{zone === '/);
    expect(src, 'data 钩子也要跟实际渲染的那块一致').toContain('data-settings-zone-panel={activeZone}');
    expect(src, '导航高亮同样按 activeZone').toContain('const active = activeZone === z.key;');
  });

  it('状态复位 effect 在位（关闭 / 身份变化都要把 zone 搬回第一可见分区）', () => {
    expect(src).toContain('if (open && visibleZones.some((z) => z.key === zone)) return;');
    expect(src).toContain('setZone(firstVisibleZone);');
    expect(src, '落点必须是第一个**可见**分区，不能写死 appearance').toContain(
      "const firstVisibleZone: ZoneKey = visibleZones[0]?.key ?? 'appearance';",
    );
  });
});
