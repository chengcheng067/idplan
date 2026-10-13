// @vitest-environment jsdom
/**
 * 「示例项目」插件的设置面板（v1.0 · 设置层级重做）
 *
 * 这个面板是**新建的入口**：把「载入示例项目」从侧栏底部一枚按钮，同时暴露成
 * plugin manifest 的 `settingsSlot`（设置 → 插件 → 「示例项目」卡的齿轮）。
 *
 * 本 spec 守的**唯一一件要紧事**：那条**管理员门槛**不能因为「换了入口」而丢掉。
 *   `loadDemo` 走的是 `BackupService.importAndReplace`——**覆盖式全量替换、不可撤销**。
 *   搬到插件设置里之后，如果只照抄按钮而忘了 `isAdmin`，成员（或未进入身份的人）
 *   就能从设置面板一键把全库顶掉。这不是样式问题，是破坏性动作的权限边界，
 *   所以用**离散断言**（按钮 disabled 的布尔值 + tooltip 文案）钉住，零容差。
 *
 * 为什么是 jsdom 而不是真 Chromium：本面板的判据是**角色派生的 DOM 属性**，
 * 与几何/真渲染无关；真机那条链路由 `settings-zones.spec.ts` 的 S-Z1 覆盖
 * （它断言齿轮展开后 `[data-plugin-settings-panel]` 的真实内容）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/** 顶掉真实仓储：本面板只在点击时取数，这里只需一个结构完整的空壳。 */
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

import { SampleProjectsSettings } from '../src/components/settings/SampleProjectsSettings';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import type { Member } from '../src/core/types/entities';
import { MemberActorKind, MemberRoleKind } from '../src/core/types/enums';

const ADMIN: Member = {
  id: 'mem_sp_admin',
  name: '示例探针管理员',
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
  id: 'mem_sp_member',
  name: '示例探针成员',
  role: '设计师',
  roleKind: MemberRoleKind.Member,
};

let host: HTMLDivElement;
let root: Root;

function render(): void {
  act(() => {
    root.render(<SampleProjectsSettings />);
  });
}

function loadButton(): HTMLButtonElement {
  const b = document.querySelector<HTMLButtonElement>('[data-sample-projects-load]');
  if (!b) throw new Error('设置面板里没有「载入示例项目」按钮');
  return b;
}

function become(id: string | null): void {
  act(() => {
    useSettingsStore.setState({ currentMemberId: id, hydrated: true });
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

describe('示例项目插件 · 设置面板', () => {
  it('管理员：按钮在、可点、tooltip 是「载入 5 个演示项目…」而不是权限提示', () => {
    render();
    const b = loadButton();
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('title')).toContain('载入 5 个演示项目');
    // 面板自带说明（覆盖式 / 不可撤销），不是一句光秃秃的按钮
    expect(document.body.textContent ?? '').toContain('覆盖式');
  });

  it('★ 成员：按钮**置灰**（覆盖式全量替换是管理员动作，不许因换入口而放开）', () => {
    become(PLAIN.id);
    render();
    const b = loadButton();
    expect(b.disabled, '成员身份下「载入示例项目」必须不可点').toBe(true);
    expect(b.getAttribute('title')).toBe('仅管理员可载入示例项目');
    // 置灰之外还要有可见的解释（只靠 tooltip 的话触屏摸不到）
    expect(document.body.textContent ?? '').toContain('仅管理员可载入示例项目');
  });

  it('未进入身份（currentMemberId=null）同样不可点——「不是管理员就不给」', () => {
    become(null);
    render();
    expect(loadButton().disabled).toBe(true);
  });

  it('身份从成员切回管理员：按钮即刻解禁（判定跟着 store 走，不是挂载时拍一次）', () => {
    become(PLAIN.id);
    render();
    expect(loadButton().disabled).toBe(true);
    become(ADMIN.id);
    expect(loadButton().disabled, '切回管理员后必须重新可用').toBe(false);
  });
});
