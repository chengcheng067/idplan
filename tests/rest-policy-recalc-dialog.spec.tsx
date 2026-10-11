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
 *
 * ── ★ 变异自证纪律（全队共识，写在这里免得下次又踩）──
 * 「改坏源码，用例却没红」**不等于**代码没问题 —— 很可能是**夹具让两种实现算出同一结果**。
 * 本文件 F1-④ 就踩过：第一版夹具 S1/S2/S3 首尾相接，链式起点被新制度重新吸附，
 * 于是「旧制度有没有被快照化」在 S2 的新区间上体现不出来，两种实现结果相同 ⇒ 红不了。
 * 对策：夹具要**刻意留大间隙**，让被断言的性质真正出现在结果里；红不了时先怀疑夹具，
 * 别先下「代码没问题」的结论。
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
  /**
   * F1-④ 用：这些 stageId 的写入会**抛错**（模拟「部分写入失败」）。
   * 默认空集 ⇒ 既有用例行为零变化。
   */
  const failStageWrites = new Set<string>();
  return { stages, projects, tasks, stageLogs, settingsSets, rescheduleCalls, failStageWrites };
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
        // F1-④：可注入的写入失败（逐条失败不中断 —— applyRestPolicyRecalc 的既有语义）
        if (h.failStageWrites.has(id)) throw new Error('probe: 写入失败');
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

/**
 * F1-④ 专用：复刻外层 `RestPolicyDialog` 的真实接线 —— `oldPolicy` **取自 store**
 * （`savedEffective`）。用常量 props 渲染是测不出「弹窗自己把旧制度改掉」这个耦合的。
 */
function renderLive(draft: RestPolicyConfig = SINGLE): void {
  function LiveOldPolicyHarness(): JSX.Element {
    const liveOldPolicy = useSettingsStore((s) => s.effectiveRestPolicy);
    return (
      <RestPolicyRecalcDialog
        draft={draft}
        oldPolicy={liveOldPolicy}
        onClose={onClose}
        onConfirmed={onConfirmed}
      />
    );
  }
  act(() => {
    root.render(<LiveOldPolicyHarness />);
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
  h.failStageWrites.clear();
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

  /*
    ══════════════════════ F1-④ 旧制度快照（审计） ══════════════════════

    缺陷原文：外层 `RestPolicyDialog` 传的是 `oldPolicy={savedEffective}`
    （每次渲染从 store 现取），而 `onConfirm` 第一步就把 store 的生效制度改成新制度
    ⇒ 弹窗重渲染时 oldPolicy 已经等于 newPolicy ⇒ `plan.hasChanges === false`
    ⇒ `confirmDisabled` 恒为 true。偏偏**部分写入失败**时弹窗故意不关（要让用户看到
    「N 条写入失败，请重试」）——于是提示让他重试，按钮却永远灰着，半迁移彻底卡死。

    下面用 `LiveOldPolicyHarness` 复刻外层的真实接线（oldPolicy 取自 store），
    所以才测得出这个耦合；直接给常量 props 是测不出来的。
  */
  it('F1-④ 部分写入失败后：预览行逐字节不变、按钮还能点、重试写的就是用户批准的那份', async () => {
    /*
      本用例**自带夹具**（不动共享夹具，避免牵动上面全部既有断言的日期算术）：
        S1 09-07~09-11  →  S2 09-23~09-25（刻意留大间隙）  →  S3 09-28~09-30
      为什么必须留间隙：链式推算 chainSteps(prevEnd, thisStart, oldPolicy) 是按
      **旧制度**数工作日的（双休 09-11→09-23 = 8 步、单休 = 10 步）。只有这种形状，
      「旧制度有没有被快照化」才会体现在 S2 的**新区间**上 —— 否则两种旧制度算出同一个
      结果，测出来的是巧合，不是契约。
    */
    const s1 = stage('stg_snap_1', WD_PROJECT.id, 1, '2026-09-07', '2026-09-11');
    const s2 = stage('stg_snap_2', WD_PROJECT.id, 2, '2026-09-23', '2026-09-25');
    const s3 = stage('stg_snap_3', WD_PROJECT.id, 3, '2026-09-28', '2026-09-30');
    act(() => {
      useProjectsStore.getState().replaceAll({
        projects: [WD_PROJECT],
        stages: [s1, s2, s3],
        tasks: [],
      });
    });
    h.stages.clear();
    h.stages.set(s1.id, s1);
    h.stages.set(s2.id, s2);
    h.stages.set(s3.id, s3);
    h.failStageWrites.add(s2.id); // 只让 S2 那条写失败

    renderLive();
    act(() => {
      clickText('工作日制项目').click(); // 默认收起 → 展开逐阶段对照表
    });
    const rowText = (): string =>
      document.body.querySelector('[data-testid="recalc-stage-stg_snap_2"]')!.textContent ?? '';
    const approvedPreview = rowText();
    const ranges = approvedPreview.match(/\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/g) ?? [];
    expect(ranges, '展开行应有 before→after 两段日期').toHaveLength(2);
    const approvedNewDates = ranges[1]!;

    const confirm = (): HTMLButtonElement => clickText('确认重算并保存制度') as HTMLButtonElement;
    expect(confirm().disabled).toBe(false);
    await act(async () => {
      confirm().click();
    });

    // 制度已落库、S2 写入失败 ⇒ 弹窗不关（用户必须看得到「N 条写入失败，请重试」）
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(h.settingsSets.map(([k]) => k)).toContain('restPolicy');
    expect(
      useSettingsStore.getState().restPolicy.kind,
      '弹窗自己把 store 的生效制度改成了新制度 —— 旧制度必须靠快照才守得住',
    ).toBe(RestPolicyKind.SingleOff);

    // ★ 缺陷点（修复前）：预览行会跟着 store 一起变，用户看到的 after 列自己改了；
    //   更糟的形状下 plan 直接算成零变化 ⇒ 确认按钮灰死、toast 里的「请重试」点不动。
    expect(rowText(), '预览行必须逐字节不变').toBe(approvedPreview);
    expect(confirm().disabled, '失败后必须还能重试').toBe(false);

    // 重试真的兑现：修好写入 → 再次确认 → 写进去的正是预览里那一行
    h.failStageWrites.clear();
    await act(async () => {
      confirm().click();
    });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    const retried = h.rescheduleCalls.filter((c) => c.id === s2.id);
    expect(retried, 'S2 的写入补上了').toHaveLength(1);
    const [expStart, expEnd] = approvedNewDates.split(' ~ ');
    expect(retried[0]!.startAt.startsWith(expStart!)).toBe(true);
    expect(retried[0]!.endAt.startsWith(expEnd!)).toBe(true);
  });

  /*
    ══════════════ F1-④-b 「重试会不会给已成功阶段重复改期」判定用例 ══════════════

    【team-lead 指派】就 F1-④ 后续的两种说法做一次**判定性实测**：
      · team-lead 的说法：重试时已成功阶段会被 `if (!sp.changed) continue;`（:86）
        挡住 ⇒ 不会再 append，流水恒 1 条 ⇒ 我原报告的「重复流水」担心不成立；
      · 我原先的说法：会被再 append 一条 ⇒ 流水 2 条。

    【实测结论：两种说法都不完整 —— 真实情况比两者都糟】
      轮 1（S2 写失败、S3 写成功）：
        · S2 未被改动（写失败），无流水；S3 被正确改到**用户批准的那份** 09-24~09-26，流水 1 条。
      重试（修好写入源后再点确认）：
        · S2 补上了 09-21~09-23 ✓（这部分是好的）；
        · **S3 被二次改期**：reschedule 调用 2 次、Rescheduled 流水 **2 条**
          —— 所以 team-lead 的 `!sp.changed` 拦截**没有生效**；
        · **而且落库值漂移成 09-24~09-25**（末段少一天），**不再是用户批准的那份**
          —— 所以「重复流水」还不是最严重的，真正的问题是**重试把已经写对的阶段改错了**。

    【为什么 `!sp.changed` 拦不住】`planProject` 的链游标 `prev.oldEndAt` 取的是
      **当前库值**（restPolicyRecalc.ts:285，`oldEndAt` 来自 `stage.endAt`）：
        · S2 写失败 ⇒ 库值仍是旧 end（09-25）；
        · S3 已改到新日期（09-24~09-26），其 `oldStartAt` 变成 09-24 ⇒ 09-24 <= 09-25
          ⇒ `chainSteps` 塌成 1 步（:153）⇒ S3 的 newStart 被重算成 09-24（与当前相同，
          但 newEnd 不同）⇒ `changed === true` ⇒ 拦不住；
        · 更根本的是**工期被重新计量**：`workdays = countWorkdays(当前起止, 旧制度)`（:236）。
          S3 已在新制度日期上（09-24~09-26），再按**旧制度（双休）**去数是 2 个工作日，
          而原始 09-28~09-30 按旧制度数是 3 ⇒ 每重试一次工期就少一天 ⇒ 日期持续漂移。

    【注：这条路是 F1-④ 修复后才存在的】修复前确认按钮在失败后恒灰，重试根本点不动，
      这个 latent bug 不可达；本轮的快照修复把按钮点活了，于是它变成可达。
      ⇒ 正确修法（v1.1）：重试应当**复用用户批准的那份 plan 快照**，而不是从
      半迁移的当前状态重算（现行为 `:221-230` 的 `useMemo` 每次渲染重算）。
  */
  it('F1-④-b 判定：重试时已成功阶段被二次改期 + 落库值漂移（★ 已知缺陷，待 v1.1 修）', async () => {
    const s1 = stage('stg_retry_1', WD_PROJECT.id, 1, '2026-09-07', '2026-09-11');
    const s2 = stage('stg_retry_2', WD_PROJECT.id, 2, '2026-09-23', '2026-09-25');
    const s3 = stage('stg_retry_3', WD_PROJECT.id, 3, '2026-09-28', '2026-09-30');
    act(() => {
      useProjectsStore.getState().replaceAll({ projects: [WD_PROJECT], stages: [s1, s2, s3], tasks: [] });
    });
    h.stages.clear();
    h.stages.set(s1.id, s1);
    h.stages.set(s2.id, s2);
    h.stages.set(s3.id, s3);
    h.failStageWrites.add(s2.id); // 只让 S2 第一次写失败

    /** 仓储真值（不是 DOM 预览）：apply 实际写进去的是什么 */
    const repoVal = (s: Stage): string => {
      const cur = h.stages.get(s.id)!;
      return `${cur.startAt.slice(0, 10)} ~ ${cur.endAt.slice(0, 10)}`;
    };
    const logsOf = (s: Stage): number => h.stageLogs.filter((l) => l.stageId === s.id).length;
    const callsOf = (s: Stage): number => h.rescheduleCalls.filter((c) => c.id === s.id).length;

    renderLive();
    act(() => {
      clickText('工作日制项目').click();
    });
    const confirm = (): HTMLButtonElement => clickText('确认重算并保存制度') as HTMLButtonElement;

    /* ── 轮 1：S2 写失败、S3 成功 ── */
    await act(async () => {
      confirm().click();
    });
    expect(repoVal(s2), 'S2 写失败 → 库值未动').toBe('2026-09-23 ~ 2026-09-25');
    expect(callsOf(s2), 'S2 的写入被拒绝，没有留下调用').toBe(0);
    expect(logsOf(s2), 'S2 写失败 → 没有流水（不是「改了期没流水」，是整条没落）').toBe(0);
    expect(repoVal(s3), 'S3 已按用户批准的那份改期').toBe('2026-09-24 ~ 2026-09-26');
    expect(logsOf(s3), 'S3 轮 1 留痕 1 条').toBe(1);
    expect(repoVal(s1), 'S1 无变化 → 全程未被触碰').toBe('2026-09-07 ~ 2026-09-11');
    expect(callsOf(s1)).toBe(0);
    expect(onConfirmed).not.toHaveBeenCalled(); // 有失败 → 弹窗不关

    /* ── 重试：修好写入源，再点一次确认 ── */
    h.failStageWrites.clear();
    await act(async () => {
      confirm().click();
    });

    // ✓ 好的部分：S2 真的补上了，且写的是预览里那一份
    expect(repoVal(s2), 'S2 补上了').toBe('2026-09-21 ~ 2026-09-23');
    expect(logsOf(s2), 'S2 补留痕 1 条').toBe(1);
    expect(onConfirmed).toHaveBeenCalledTimes(1);

    // ★ 缺陷 1：已成功的 S3 被**二次**改期（team-lead 预期的 `!sp.changed` 拦截没生效）
    expect(callsOf(s3), '★ S3 被写了第二次').toBe(2);
    expect(logsOf(s3), '★ S3 留下第二条 Rescheduled 流水（重复留痕）').toBe(2);

    // ★ 缺陷 2（更严重）：S3 的落库值**漂移**，不再是用户批准的那份 09-24~09-26
    expect(repoVal(s3), '★ S3 末段落库值被改坏：批准的是 09-24~09-26').toBe('2026-09-24 ~ 2026-09-25');
    // ↑ 正确行为应为 '2026-09-24 ~ 2026-09-26'（= 用户批准的那份，重试不得改动它）。
    //   本条断言刻意钉住**当前错误行为**：它是可执行的缺陷复现，修好后此断言会红，
    //   提醒必须连同上面三条一起翻转（详见本用例上方注释块）。
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
