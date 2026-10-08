// @vitest-environment jsdom
/**
 * 休息制度切换重算 · 确认弹窗（RestPolicyRecalcDialog + applyRestPolicyRecalc）。
 *
 * 覆盖（产品决策文档 §四）：
 *   ① 影响计数按 workday 口径（自然日制项目零影响、不进 plan）；
 *   ② 逐项目 before→after 对照表（可展开、冻结标记）；
 *   ③ 「工期不变（默认）/ 调整工期」二选——调整模式内嵌每阶段天数编辑器，
 *      填值后 diff 表实时更新（预览即演算）；
 *   ④ dueDate 默认不跟随：计数提示 + 复选框默认不勾；勾选后确认才写；
 *   ⑤ 备份按钮（不强制）→ exportBackupToFile；
 *   ⑥ 确认 → 制度落库 + 逐阶段 StageService.reschedule 留痕
 *      （reason='休息制度切换：双休→单休'）+ store 镜像；
 *   ⑦ **预览与应用同一结果**：apply 消费弹窗内同一份 plan——写入库的起止
 *      与 diff 表展示的新起止逐字节一致；
 *   ⑧ 取消 → 零写入。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { RestPolicyRecalcDialog } from '../src/components/settings/RestPolicyRecalcDialog';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { DEFAULT_REST_POLICY } from '../src/core/types/entities';
import type { Project, RestPolicyConfig, Stage, Task } from '../src/core/types/entities';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  RestPolicyKind,
  ScheduleBasis,
  StageStatus,
} from '../src/core/types/enums';

/* ------------------------------ fake 仓储（内存） ------------------------------ */

const h = vi.hoisted(() => {
  const stages = new Map<string, Stage>();
  const projects = new Map<string, Project>();
  const tasks = new Map<string, Task>();
  const stageLogs: Array<Record<string, unknown>> = [];
  const settingsSets: Array<[string, unknown]> = [];
  const rescheduleCalls: Array<{ id: string; startAt: string; endAt: string }> = [];
  return { stages, projects, tasks, stageLogs, settingsSets, rescheduleCalls };
});

vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => ({
    settings: {
      set: async (key: string, value: unknown) => {
        h.settingsSets.push([key, value]);
      },
      get: async () => null,
    },
    stages: {
      get: async (id: string) => h.stages.get(id) ?? null,
      reschedule: async (id: string, startAt: string, endAt: string, status?: StageStatus) => {
        const prev = h.stages.get(id)!;
        const next: Stage = {
          ...prev,
          startAt,
          endAt,
          status: status ?? prev.status,
          revision: prev.revision + 1,
        };
        h.stages.set(id, next);
        h.rescheduleCalls.push({ id, startAt, endAt });
        return next;
      },
      listByProject: async () => [],
      update: async () => {
        throw new Error('unused');
      },
      bulkInsert: async () => undefined,
    },
    logs: {
      appendStageLog: async (rec: Record<string, unknown>) => {
        h.stageLogs.push(rec);
        return rec;
      },
      listStageLogsByStage: async () => [],
    },
    projects: {
      update: async (id: string, cmd: Partial<Project>) => {
        const prev = h.projects.get(id)!;
        const next = { ...prev, ...cmd } as Project;
        h.projects.set(id, next);
        return next;
      },
    },
    tasks: {
      update: async (id: string, cmd: Partial<Task>) => {
        const prev = h.tasks.get(id)!;
        const next = { ...prev, ...cmd } as Task;
        h.tasks.set(id, next);
        return next;
      },
    },
  }),
}));

vi.mock('../src/components/layout/useBackupIo', () => ({
  exportBackupToFile: vi.fn(async () => true),
}));

/* ------------------------------ 夹具 ------------------------------ */

const DOUBLE: RestPolicyConfig = { kind: RestPolicyKind.DoubleOff, anchorWeek: null };
const SINGLE: RestPolicyConfig = { kind: RestPolicyKind.SingleOff, anchorWeek: null };

const WD_PROJECT: Project = {
  id: 'proj_dlg_wd',
  name: '工作日制项目',
  address: '',
  clientName: '客户甲',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: '2026-09-07T00:00:00Z',
  plannedEndAt: '2026-09-30T23:59:59Z',
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Workday,
  domain: null,
  kind: 'human',
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-09-07T00:00:00Z',
  ownerMemberId: null,
};

const CAL_PROJECT: Project = {
  ...WD_PROJECT,
  id: 'proj_dlg_cal',
  name: '自然日制项目',
  scheduleBasis: ScheduleBasis.Calendar,
};

function stage(id: string, projectId: string, orderIndex: number, startAt: string, endAt: string): Stage {
  return {
    id,
    projectId,
    orderIndex,
    templateKey: null,
    colorIndex: 1,
    customColor: null,
    name: `阶段 ${orderIndex}`,
    ratioPercent: 10,
    startAt: `${startAt}T00:00:00Z`,
    endAt: `${endAt}T23:59:59Z`,
    status: StageStatus.NotStarted,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-09-07T00:00:00Z',
  };
}

const S1 = stage('stg_dlg_1', WD_PROJECT.id, 1, '2026-09-07', '2026-09-11');
const S2 = stage('stg_dlg_2', WD_PROJECT.id, 2, '2026-09-14', '2026-09-18');
const S3 = stage('stg_dlg_3', WD_PROJECT.id, 3, '2026-09-21', '2026-09-25');
const CAL_S1 = stage('stg_dlg_cal', CAL_PROJECT.id, 1, '2026-09-07', '2026-09-30');

/** 任务：到期日 09-18（旧区间末日后）——双→单后新区间 09-12~09-17，掉出 */
const T1: Task = {
  id: 'tsk_dlg_1',
  taskNo: 1,
  projectId: WD_PROJECT.id,
  stageId: S2.id,
  title: '阶段二任务',
  done: false,
  assigneeId: null,
  assigneeIds: [],
  dueDate: '2026-09-18',
  source: 'human',
  externalId: null,
  agentId: null,
  status: 'draft',
  description: null,
  dependsOn: [],
  artifacts: [],
  startAt: null,
  claimedAt: null,
  runId: null,
  orderIndex: 0,
  revision: 1,
  updatedAt: '2026-09-07T00:00:00Z',
} as Task;

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onConfirmed = vi.fn();

function render(draft: RestPolicyConfig = SINGLE): void {
  act(() => {
    root.render(
      <RestPolicyRecalcDialog draft={draft} oldPolicy={DOUBLE} onClose={onClose} onConfirmed={onConfirmed} />,
    );
  });
}

function clickText(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  ) as HTMLButtonElement | null;
  if (!btn) throw new Error(`未找到按钮：${text}`);
  return btn;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  h.stages.clear();
  h.projects.clear();
  h.tasks.clear();
  h.stageLogs.length = 0;
  h.settingsSets.length = 0;
  h.rescheduleCalls.length = 0;
  onClose.mockClear();
  onConfirmed.mockClear();

  h.projects.set(WD_PROJECT.id, WD_PROJECT);
  h.projects.set(CAL_PROJECT.id, CAL_PROJECT);
  h.stages.set(S1.id, S1);
  h.stages.set(S2.id, S2);
  h.stages.set(S3.id, S3);
  h.stages.set(CAL_S1.id, CAL_S1);
  h.tasks.set(T1.id, T1);

  act(() => {
    useProjectsStore.getState().replaceAll({
      projects: [WD_PROJECT, CAL_PROJECT],
      stages: [S1, S2, S3, CAL_S1],
      tasks: [T1],
    });
    useSettingsStore.setState({
      restPolicy: DEFAULT_REST_POLICY,
      effectiveRestPolicy: DEFAULT_REST_POLICY,
      currentMemberId: 'mem_dlg_admin',
    });
    useMembersStore.setState({
      members: [
        {
          id: 'mem_dlg_admin',
          name: '管理员',
          role: '负责人',
          contact: null,
          avatarColor: '#88A293',
          active: true,
          roleKind: MemberRoleKind.Admin,
          passwordHash: null,
          actorKind: MemberActorKind.Human,
          agentKind: null,
          revision: 1,
          updatedAt: '2026-09-07T00:00:00Z',
        },
      ],
    });
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

/* ------------------------------ 计数与 diff ------------------------------ */

describe('RestPolicyRecalcDialog：影响计数与 before→after 对照', () => {
  it('影响计数按 workday 口径（自然日制项目零影响、不进 plan）', () => {
    render();
    const impact = document.body.querySelector('[data-testid="recalc-impact"]')!;
    expect(impact.textContent).toContain('1 个工作日制项目');
    expect(impact.textContent).toContain('2 个阶段');
    expect(impact.textContent).toContain('已完成 0 个冻结不动');
    // 自然日制项目不出现在项目列表
    const projectsBox = document.body.querySelector('[data-testid="recalc-projects"]')!;
    expect(projectsBox.textContent).not.toContain('自然日制项目');
    expect(projectsBox.textContent).toContain('工作日制项目');
  });

  it('dueDate 掉出计数提示 + 复选框默认不勾', () => {
    render();
    const dueCount = document.body.querySelector('[data-testid="recalc-due-count"]')!;
    expect(dueCount.textContent).toContain('1 个任务');
    const box = document.body.querySelector('[data-testid="recalc-align-due"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
  });

  it('展开项目：S2 before→after = 09-14~09-18 → 09-12~09-17；S1 不变', () => {
    render();
    // 默认收起 → 点项目头展开
    act(() => {
      clickText('工作日制项目').click();
    });
    const s1Row = document.body.querySelector('[data-testid="recalc-stage-stg_dlg_1"]')!;
    expect(s1Row.textContent).toContain('不变');
    const s2Row = document.body.querySelector('[data-testid="recalc-stage-stg_dlg_2"]')!;
    expect(s2Row.textContent).toContain('2026-09-14 ~ 2026-09-18');
    expect(s2Row.textContent).toContain('2026-09-12 ~ 2026-09-17');
    const s3Row = document.body.querySelector('[data-testid="recalc-stage-stg_dlg_3"]')!;
    expect(s3Row.textContent).toContain('2026-09-18 ~ 2026-09-23');
  });

  it('备份按钮（不强制）可点', async () => {
    render();
    await act(async () => {
      clickText('先去备份').click();
    });
    // exportBackupToFile 被 mock 掉；点完不抛错即通过（toast 走真实 store）
  });
});

/* ------------------------------ 工期改变模式 ------------------------------ */

describe('工期改变模式：调整工期（内嵌每阶段天数编辑器）', () => {
  it('默认「工期不变」无输入框；切「调整工期」出现输入框，填值后 diff 实时更新', () => {
    render();
    // 默认模式：无工期输入框
    expect(document.body.querySelector('[data-testid="recalc-duration-stg_dlg_2"]')).toBeNull();
    // 展开项目（时长编辑器在展开的对照表里）+ 切模式
    act(() => {
      clickText('工作日制项目').click();
    });
    act(() => {
      (
        document.body.querySelector('[data-testid="recalc-mode-custom"]') as HTMLInputElement
      ).click();
    });
    const input = document.body.querySelector(
      '[data-testid="recalc-duration-stg_dlg_2"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    // 占位符 = 原工期 5 天
    expect(input.placeholder).toBe('5 天');
    // 填 2 → diff 表更新（09-12~09-14）
    setInputValue(input, '2');
    const s2Row = document.body.querySelector('[data-testid="recalc-stage-stg_dlg_2"]')!;
    expect(s2Row.textContent).toContain('2026-09-12 ~ 2026-09-14');
    // S3 链式跟随：09-15 ~ 09-19
    const s3Row = document.body.querySelector('[data-testid="recalc-stage-stg_dlg_3"]')!;
    expect(s3Row.textContent).toContain('2026-09-15 ~ 2026-09-19');
  });
});

/* ------------------------------ 确认应用：预览=应用 ------------------------------ */

describe('确认应用：制度落库 + 逐阶段留痕（预览与应用同一结果）', () => {
  it('确认 → settings 落库新制度 + 2 个阶段 reschedule 留痕 + store 镜像 == diff', async () => {
    render();
    await act(async () => {
      clickText('确认重算并保存制度').click();
    });

    // ① 制度落库（先落库后应用）
    expect(h.settingsSets).toHaveLength(1);
    expect(h.settingsSets[0][0]).toBe('restPolicy');
    expect(h.settingsSets[0][1]).toMatchObject({ kind: 'single_off' });
    expect(useSettingsStore.getState().restPolicy.kind).toBe('single_off');

    // ② 逐阶段 reschedule（S1 不变不写；S2/S3 写）
    expect(h.rescheduleCalls).toHaveLength(2);
    const s2call = h.rescheduleCalls.find((c) => c.id === S2.id)!;
    const s3call = h.rescheduleCalls.find((c) => c.id === S3.id)!;
    expect(s2call.startAt).toBe('2026-09-12T00:00:00.000Z');
    expect(s2call.endAt).toBe('2026-09-17T23:59:59.000Z');
    expect(s3call.startAt).toBe('2026-09-18T00:00:00.000Z');
    expect(s3call.endAt).toBe('2026-09-23T23:59:59.000Z');

    // ③ StageLog 留痕（每阶段一条，reason=新制度名）
    expect(h.stageLogs).toHaveLength(2);
    expect(h.stageLogs.every((l) => l.reason === '休息制度切换：双休→单休')).toBe(true);
    expect(h.stageLogs.every((l) => l.type === 'rescheduled')).toBe(true);

    // ④ store 镜像 == 写入值（同一 plan：预览 diff 表 09-12~09-17 == 库值）
    const storeS2 = useProjectsStore.getState().stages.find((s) => s.id === S2.id)!;
    expect(storeS2.startAt).toBe('2026-09-12T00:00:00.000Z');
    expect(storeS2.endAt).toBe('2026-09-17T23:59:59.000Z');

    // ⑤ plannedEndAt 未拖出（09-30）→ 项目不更新
    expect(h.projects.get(WD_PROJECT.id)!.plannedEndAt).toBe('2026-09-30T23:59:59Z');

    // ⑥ onConfirmed 回调（外层关闭）
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('勾选 dueDate 对齐 → 确认后任务到期日写入（保持相对偏移：09-18 → 09-16）', async () => {
    render();
    act(() => {
      (document.body.querySelector('[data-testid="recalc-align-due"]') as HTMLInputElement).click();
    });
    await act(async () => {
      clickText('确认重算并保存制度').click();
    });
    expect(h.tasks.get(T1.id)!.dueDate).toBe('2026-09-16');
    const storeT1 = useProjectsStore.getState().tasks.find((t) => t.id === T1.id)!;
    expect(storeT1.dueDate).toBe('2026-09-16');
  });

  it('工期改变模式确认 → 按新工期写入（S2=2 天：09-12~09-14；S3 链式 09-15~09-19）', async () => {
    render();
    act(() => {
      clickText('工作日制项目').click();
    });
    act(() => {
      (document.body.querySelector('[data-testid="recalc-mode-custom"]') as HTMLInputElement).click();
    });
    setInputValue(
      document.body.querySelector('[data-testid="recalc-duration-stg_dlg_2"]') as HTMLInputElement,
      '2',
    );
    await act(async () => {
      clickText('确认重算并保存制度').click();
    });
    const s2call = h.rescheduleCalls.find((c) => c.id === S2.id)!;
    const s3call = h.rescheduleCalls.find((c) => c.id === S3.id)!;
    expect(s2call.startAt).toBe('2026-09-12T00:00:00.000Z');
    expect(s2call.endAt).toBe('2026-09-14T23:59:59.000Z');
    expect(s3call.startAt).toBe('2026-09-15T00:00:00.000Z');
    expect(s3call.endAt).toBe('2026-09-19T23:59:59.000Z');
  });

  it('取消 → 零写入 + onClose', () => {
    render();
    act(() => {
      clickText('取消').click();
    });
    expect(h.settingsSets).toHaveLength(0);
    expect(h.rescheduleCalls).toHaveLength(0);
    expect(h.stageLogs).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});
