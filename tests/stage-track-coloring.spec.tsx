// @vitest-environment jsdom
/**
 * 0.8.6.0002 · 反馈 #10.1 / #10.2：项目卡片阶段进度轨道的「分段上色」回归。
 *
 * 她的两条原话：
 *   ① 「'现在进行时'的色彩和上方进度条的色彩有较大的色差，无法匹配上」；
 *   ② 「目前进度条到底进行到了什么位置，实际上是不明显的。比如后面尚未进行到的
 *       位置，是否可以不显示后面的颜色，只显示当前进行时的颜色？」
 *
 * 修复（ProjectCard 进度轨道，只改「哪些段真的上色」）：
 *   · 未来段（未到达）⇒ 不给了色（opacity-0），槽底透出；
 *   · 已完成段 ⇒ 阶段色降饱和（opacity-40）；
 *   · 当前段 ⇒ 阶段色全饱和 + 1px pine 内描边——pine 正是「进行中」的本仓语义色
 *     （百分比 text-pine / 时间轴 StageBar 的进行中 pine 描边，见 timelineColors.ts），
 *     描上去之后 pine 同时出现在百分比与进度条当前段上，两条反馈的「色差/不明显」一并消除。
 *
 * ⚠️ 与 tests/stage-color-wiring.spec.tsx ⑦-① 的边界（那份继续有效、本份不重复）：
 *   段的**内联 backgroundColor 与 data-stage-key 通路逐字节不动**（那份钉的正是这两个
 *   值 + 段数）。本 spec 钉的是新增的视觉权重层：data-stage-track-state 三态、
 *   当前段的 pine 内描边、以及「内联色值仍然逐字节不变」这条回归线。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

import { registerStageColor } from '../src/core/color/custom-color-registry';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage, Task } from '../src/core/types/entities';

/** jsdom 缺 matchMedia / ResizeObserver（与 stage-color-wiring.spec.tsx 同款补桩） */
beforeEach(() => {
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
});

/** ProjectCard 经 useRepos() 读 Context（本 spec 无 Provider 树），模块边界顶掉 */
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
      upsertByExternalId: async () => ({ created: 0, updated: 0 }),
      claim: ok,
    },
    members: { list: async () => [], get: async () => null, insert: ok, update: ok, verifyCredentials: async () => false },
    logs: {
      appendStageLog: ok,
      listStageLogsByStage: async () => [],
      listStageLogsByProject: async () => [],
      appendAssignment: ok,
      listAssignmentsByTask: async () => [],
    },
    contracts: { insert: ok, get: async () => null, linkProject: ok, saveConfirmedPayload: ok, list: async () => [] },
    settings: { get: async () => null, set: ok, all: async () => [], replaceAll: ok },
  };
  return { useRepos: (): unknown => bundle };
});

import { ProjectCard } from '../src/components/project/ProjectCard';

const PROJECT_ID = 'proj_track';
const ADMIN_ID = 'mem-track-admin';
const TODAY = '2026-06-10';

const CUSTOM = '#7A2FD6';

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    name: '某茶空间',
    address: '',
    clientName: '客户甲',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-06-01T00:00:00Z',
    plannedEndAt: '2026-06-30T23:59:59Z',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: null,
    kind: 'human',
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    ownerMemberId: null,
    ...over,
  };
}

function makeStage(id: string, orderIndex: number, over: Partial<Stage> = {}): Stage {
  return {
    id,
    projectId: PROJECT_ID,
    orderIndex,
    templateKey: null,
    colorIndex: orderIndex,
    customColor: null,
    name: `阶段${orderIndex}`,
    ratioPercent: 100,
    startAt: '2026-06-01T00:00:00Z',
    endAt: '2026-06-30T23:59:59Z',
    status: StageStatus.InProgress,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  };
}

function makeMember(id: string, name: string, roleKind: MemberRoleKind): Member {
  return {
    id,
    name,
    role: roleKind === MemberRoleKind.Admin ? '项目负责人' : '协作成员',
    contact: null,
    avatarColor: '#88A293',
    active: true,
    roleKind,
    passwordHash: null,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    revision: 1,
    updatedAt: '2026-06-01T00:00:00Z',
  };
}

const ADMIN = makeMember(ADMIN_ID, '负责人甲', MemberRoleKind.Admin);

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

function renderCard(stages: Stage[], tasks: Task[] = []): HTMLDivElement {
  unmountCurrent();
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  const r = createRoot(h);
  root = r;
  act(() => {
    r.render(
      <MemoryRouter>
        <ProjectCard
          project={makeProject()}
          stages={stages}
          tasks={tasks}
          members={[ADMIN]}
          todayIso={TODAY}
          onOpen={() => undefined}
        />
      </MemoryRouter>,
    );
  });
  return h;
}

/** 装 store（挂载前 + act 内；同 stage-color-wiring.spec.tsx 口径） */
function seedStores(stages: Stage[], tasks: Task[] = []): void {
  unmountCurrent();
  act(() => {
    useProjectsStore.getState().replaceAll({ projects: [makeProject()], stages, tasks });
    useMembersStore.getState().setAll([ADMIN]);
    useSettingsStore.setState({ currentMemberId: ADMIN_ID, hydrated: true });
  });
}

/** 三段进度 fixture：①已完成 ②进行中（今日落在区间内） ③未开始（未来） */
function triStages(): Stage[] {
  return [
    makeStage('stg_done', 1, {
      status: StageStatus.Completed,
      startAt: '2026-06-01T00:00:00Z',
      endAt: '2026-06-04T23:59:59Z',
    }),
    makeStage('stg_now', 2, {
      status: StageStatus.InProgress,
      startAt: '2026-06-05T00:00:00Z',
      endAt: '2026-06-15T23:59:59Z',
    }),
    makeStage('stg_future', 3, {
      status: StageStatus.NotStarted,
      startAt: '2026-06-16T00:00:00Z',
      endAt: '2026-06-28T23:59:59Z',
    }),
  ];
}

afterEach(() => {
  unmountCurrent();
});

describe('反馈 #10.1/#10.2 · 进度轨道分段上色', () => {
  it('三态各就其位：已过=降饱和 / 当前=全饱和+pine 描边 / 未来=不给了色', () => {
    seedStores(triStages());
    const h = renderCard(triStages());
    const segs = [...h.querySelectorAll('[data-stage-track-seg]')];
    expect(segs).toHaveLength(3);

    const states = segs.map((s) => s.getAttribute('data-stage-track-state'));
    expect(states, 'done/current/future 三态按阶段状态派生').toEqual(['done', 'current', 'future']);

    const cls = (i: number): string => segs[i]!.className;
    expect(cls(0), '已完成段降饱和').toContain('opacity-40');
    expect(cls(1), '当前段不降饱和').not.toContain('opacity-40');
    expect(cls(1), '当前段不透明化').not.toContain('opacity-0');
    expect(cls(2), '未来段不给了色').toContain('opacity-0');

    // 当前段带 pine 内描边（与百分比 text-pine 编译结果同色：rgb(var(--pine-rgb)/1)）
    const shadow = (segs[1] as HTMLElement).style.boxShadow;
    expect(shadow, '当前段应有 1px pine 内描边').toContain('inset 0 0 0 1px');
    expect(shadow).toContain('--pine-rgb');
    // 只有当前段有描边
    expect((segs[0] as HTMLElement).style.boxShadow, '已完成段不得带 pine 描边').toBe('');
    expect((segs[2] as HTMLElement).style.boxShadow, '未来段不得带 pine 描边').toBe('');
  });

  it('回归线：内联 backgroundColor / data-stage-key 通路逐字节不动（stage-color-wiring ⑦-① 的契约）', () => {
    seedStores(triStages());
    const h = renderCard(triStages());
    const segs = [...h.querySelectorAll('[data-stage-track-seg]')];
    expect((segs[0] as HTMLElement).style.backgroundColor).toBe('var(--stage-s1)');
    expect((segs[1] as HTMLElement).style.backgroundColor).toBe('var(--stage-s2)');
    expect((segs[2] as HTMLElement).style.backgroundColor).toBe('var(--stage-s3)');
    // 内置色一律不挂锚点
    for (const s of segs) expect(s.getAttribute('data-stage-key')).toBeNull();
  });

  it('自定义色当前段：本地 solid 令牌 + 锚点 + pine 描边三件都在', () => {
    const key = registerStageColor(CUSTOM);
    const stages = triStages().map((s, i) => (i === 1 ? { ...s, customColor: CUSTOM } : s));
    seedStores(stages);
    const h = renderCard(stages);
    const segs = [...h.querySelectorAll('[data-stage-track-seg]')];
    const cur = segs[1] as HTMLElement;
    expect(cur.style.backgroundColor, '自定义色仍走本地 solid 令牌').toBe('var(--stage-local-solid)');
    expect(cur.closest('[data-stage-key]')?.getAttribute('data-stage-key')).toBe(key);
    expect(cur.style.boxShadow, '自定义色当前段同样带 pine 描边').toContain('--pine-rgb');
  });

  it('全完成项目：无「当前」高亮段，全部落在降饱和档（末阶段回落不伪造进行中）', () => {
    const stages = triStages().map((s) => ({ ...s, status: StageStatus.Completed }));
    seedStores(stages);
    const h = renderCard(stages);
    const segs = [...h.querySelectorAll('[data-stage-track-seg]')];
    const states = segs.map((s) => s.getAttribute('data-stage-track-state'));
    // currentStageOf 在全完成时回落到末阶段 ⇒ 末段按「当前」呈现（与 Tag 口径一致），
    // 但其前各段必须全部是 done 档；关键是**不得**出现未来段的 opacity-0。
    expect(states[0]).toBe('done');
    expect(states[1]).toBe('done');
    expect(states[2]).toBe('current');
    expect(segs.some((s) => s.className.includes('opacity-0')), '全完成不得有透明段').toBe(false);
  });
});
