// @vitest-environment jsdom
/**
 * 回归测试：阶段详情抽屉（StageDrawer）hook 调用顺序必须稳定。
 *
 * ── 症状 ──
 *   在甘特图/时间轴上点击阶段彩条 → 白屏（React error #310：
 *   "Rendered more hooks than during the previous render"）。
 *
 * ── 根因 ──
 *   StageDrawer 里 `const project = useProjectsStore(...)` 原先写在两个
 *   提前 return（`if (!stageId) return null;` / `if (!stage) {...}`）**之后**：
 *     · 首次渲染 stageDrawerStageId=null → 提前 return，该 hook **未执行**；
 *     · 点击彩条 openStageDrawer(id) → stageId 变非空 → 通过提前 return →
 *       该 hook **首次执行** → 本次渲染的 hook 数量比上次多 1 → React 抛错白屏。
 *
 *   修复：把该 hook 提到所有提前 return 之前，与其余 hook 同段、无条件执行。
 *
 * ── 为什么这样断言就能拦住回归 ──
 *   本用例刻意复刻真实触发路径：先「关着抽屉」渲染，再切到「打开抽屉」触发
 *   第二次渲染。若有人再把 hook 放到提前 return 之后，第二次渲染即抛出 ——
 *   断言 not.toThrow 必红。这是对「hook 数量在两次渲染间保持一致」的直接检验。
 *
 * 只依赖 react-dom/client 原生渲染，不引入 testing-library。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/**
 * 顶掉真实仓储：StageDrawer 经 useRepos() 读 Context，而本用例只关心
 * hook 顺序（不关心取数），故用最小假 bundle，免去 Dexie/Context 装配。
 * 注意 vi.mock 工厂被提升，不能引用模块顶层变量——故全部在工厂内定义。
 */
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
      insert: ok,
      get: async () => null,
      linkProject: ok,
      saveConfirmedPayload: ok,
      list: async () => [],
    },
    settings: {
      get: async () => null,
      set: ok,
      all: async () => [],
      replaceAll: ok,
    },
  };
  return { useRepos: (): unknown => bundle };
});

import { StageDrawer } from '../src/components/stage-detail/StageDrawer';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useUiStore } from '../src/store/useUiStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { ProjectStatus, ScheduleBasis, StageStatus } from '../src/core/types/enums';
import type { Project, Stage } from '../src/core/types/entities';

const PROJECT_ID = 'proj_1';
const STAGE_ID = 'stg_1';

const PROJECT: Project = {
  id: PROJECT_ID,
  name: '某茶空间',
  address: '城区某路 1 号',
  clientName: '客户甲',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: '2026-01-01T00:00:00Z',
  plannedEndAt: '2026-03-01T23:59:59Z',
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  domain: null,
  kind: 'human',
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const STAGE: Stage = {
  id: STAGE_ID,
  projectId: PROJECT_ID,
  orderIndex: 1,
  templateKey: null,
  colorIndex: 1,
  customColor: null,
  name: '现场勘测',
  ratioPercent: 10,
  startAt: '2026-01-01T00:00:00Z',
  endAt: '2026-01-10T23:59:59Z',
  status: StageStatus.NotStarted,
  ownerId: null,
  visible: true,
  resourcePath: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('StageDrawer 点击彩条不得因 hook 顺序变化而崩溃', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // 关键前置：抽屉初始为「关闭」（stageDrawerStageId=null），与真实首屏一致
    useUiStore.setState({ stageDrawerStageId: null });
    useProjectsStore.getState().replaceAll({
      projects: [PROJECT],
      stages: [STAGE],
      tasks: [],
    });
    useSettingsStore.setState({ currentMemberId: null });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('核心：stageDrawerStageId 从 null 切到有值时，组件不抛错且抽屉正常渲染', () => {
    act(() => {
      root.render(<StageDrawer projectId={PROJECT_ID} members={[]} />);
    });
    // 关闭态：组件返回 null，不渲染对话框
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // 复刻真实点击路径：store 更新 → 订阅触发第二次渲染（hook 数量在此被校验）
    expect(() => {
      act(() => {
        useUiStore.getState().openStageDrawer(STAGE_ID);
      });
    }).not.toThrow();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain('现场勘测');
  });

  it('反复开合（null ↔ 有值）不得累积性破坏 hook 顺序', () => {
    act(() => {
      root.render(<StageDrawer projectId={PROJECT_ID} members={[]} />);
    });

    for (let i = 0; i < 3; i += 1) {
      expect(() => {
        act(() => useUiStore.getState().openStageDrawer(STAGE_ID));
      }).not.toThrow();
      expect(() => {
        act(() => useUiStore.getState().closeStageDrawer());
      }).not.toThrow();
    }

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('打开不存在的阶段仍走占位分支，且不抛 hook 顺序错误', () => {
    act(() => {
      root.render(<StageDrawer projectId={PROJECT_ID} members={[]} />);
    });

    expect(() => {
      act(() => useUiStore.getState().openStageDrawer('stg_not_exist'));
    }).not.toThrow();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain('该阶段不存在或已被移除');
  });
});
