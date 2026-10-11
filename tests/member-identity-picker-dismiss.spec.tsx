// @vitest-environment jsdom
/**
 * F10 · 顶栏身份菜单的关闭与语义契约。
 *
 * ══════════════════ 本文件为什么存在 ══════════════════
 * 修前这个菜单只有 mousedown 外点关闭：键盘用户按 Esc 关不掉（只能 Tab 走开或用鼠标点别处），
 * 且触发按钮上没有任何「我是菜单入口 / 现在是展开还是收起」的可访问语义 ——
 * 同样的顶栏菜单 `MobileMoreMenu` 两样都有。本文件把补齐后的三条锁死：
 *   ① Esc 关闭；② `aria-expanded` 随开合翻转；③ 面板里确实是 `role="menu"`（
 *   `aria-haspopup="menu"` 必须有真实落点，否则读屏播报「菜单」却找不到菜单）。
 * 另附一条**既有行为不回退**：点面板内部不关（否则点菜单项会一闪即关）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

import { MemberIdentityPicker } from '../src/components/layout/MemberIdentityPicker';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import type { Member } from '../src/core/types/entities';
import { MemberActorKind, MemberRoleKind } from '../src/core/types/enums';

const ADMIN: Member = {
  id: 'mem_picker_admin',
  name: '身份探针管理员',
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

function mountPicker(): void {
  unmountCurrent();
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  const r = createRoot(h);
  root = r;
  act(() => {
    r.render(
      <MemoryRouter>
        <MemberIdentityPicker />
      </MemoryRouter>,
    );
  });
}

/** 触发按钮（已进入身份时的那个：title 稳定，改文案也不会让本 spec 失效） */
function trigger(): HTMLButtonElement {
  const b = document.querySelector<HTMLButtonElement>('button[title="当前身份（点击切换/退出）"]');
  if (b === null) throw new Error('未找到身份触发按钮（前置：已进入身份）');
  return b;
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]');
}

/** 打开菜单（打开态是前置，失败要当场炸，不能让后续断言空转成假绿） */
function openMenu(): HTMLElement {
  act(() => {
    trigger().click();
  });
  const p = panel();
  if (p === null) throw new Error('点击后身份菜单未出现');
  return p;
}

beforeEach(() => {
  localStorage.clear();
  unmountCurrent();
  act(() => {
    useMembersStore.getState().setAll([ADMIN]);
    useSettingsStore.setState({ currentMemberId: ADMIN.id, hydrated: true });
  });
});

afterEach(() => {
  unmountCurrent();
  act(() => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  });
});

describe('F10 · 顶栏身份菜单', () => {
  it('Esc 关闭菜单（修前按 Esc 毫无反应）', () => {
    mountPicker();
    openMenu();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(panel(), 'Esc 后菜单必须关闭').toBeNull();
  });

  it('触发按钮带 aria-haspopup="menu"，aria-expanded 随开合翻转；面板是 role="menu"', () => {
    mountPicker();
    const btn = trigger();
    expect(btn.getAttribute('aria-haspopup'), '触发器要声明它会开菜单').toBe('menu');
    expect(btn.getAttribute('aria-expanded'), '收起态 = false').toBe('false');

    openMenu();
    expect(trigger().getAttribute('aria-expanded'), '展开态 = true').toBe('true');
    expect(panel()?.getAttribute('role'), 'aria-haspopup=menu 必须有真实落点').toBe('menu');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(trigger().getAttribute('aria-expanded'), '关闭后回到 false').toBe('false');
  });

  it('点面板内部不关闭（既有行为：否则点菜单项会一闪即关）', () => {
    mountPicker();
    const p = openMenu();
    act(() => {
      p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(panel(), '面板内 mousedown 不是外点').not.toBeNull();
  });

  it('点面板外部关闭（既有行为）', () => {
    mountPicker();
    openMenu();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(panel()).toBeNull();
  });
});
