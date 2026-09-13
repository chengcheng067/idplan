// @vitest-environment jsdom
/**
 * v0.7 · C2 · 成员权限两处漏网收紧（P0-19）—— jsdom 层验收。
 *
 * PM 在增量 PRD §5.4 的 21 行权限矩阵里核出 2 处**既有写权限漏网**：
 *   ① 成员能改**任务截止日**；② 成员能改**阶段资料路径**。
 * 决策 4 是「成员可看月历但**不给编辑权限**（只读）」，放开月历只读却留着这两个洞，
 * 等于把风险面扩大而不是收紧。
 *
 * ── 本文件覆盖 ①（截止日）；② 的验收在 `v07-dline-permission.spec.tsx`（T04 已收紧并留了用例），
 *    本轮用**变异验证**证明那批用例有判别力，不在此重复造一套。
 *
 * ★ 为什么断言「**渲染层不存在**」而不是「点了没反应 / readOnly」：
 *   收紧前的实现是 `<input type="date" readOnly={isRestricted}>` —— 那是**禁用档（D）**：
 *   控件照样画在成员眼前，只是点不动；而 `readOnly` 对 `input[type=date]` 的日历选择器
 *   在各浏览器下并不都拦得住。team-lead 要求的是**隐藏档（H）**：写入口根本不渲染。
 *   若只断言「readOnly === true」或「点击无效」，旧实现**照样全绿**（假绿）。
 *   同理，`?.()` 可选回调只保证不执行、不保证不渲染（`CalendarEmptyStates.tsx:161`
 *   就出过这么一个点不动的死按钮）——故一律断言「查不到该元素」。
 *
 * ── 为什么必须带 admin 对照组 ──
 *   收紧类改动最容易「收过头」：把管理员的写入口一起掐掉，界面无任何报错，
 *   只有成员那几条用例变绿。故每个受限断言都配一条 admin 反向断言。
 *
 * 只依赖 react-dom/client 原生渲染，不引入 testing-library（与仓库既有组件测同款）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/* act 环境开关由 `tests/setup.ts` 统一置位（本文件不再自行置位）——
 * 逐文件置位会把告警/状态转嫁给同进程的下游 spec，理由详见 setup.ts。 */

/**
 * 顶掉真实仓储：`TaskChecklist` 经 `useRepos()` 读 Context，本文件只关心
 * **渲染出的 DOM**（有没有那个日期输入），故用最小假 bundle 免去 Dexie 装配。
 * `vi.mock` 工厂被提升，不能引用模块顶层变量——全部在工厂内定义。
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

import { TaskChecklist } from '../src/components/stage-detail/TaskChecklist';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { MemberActorKind, MemberRoleKind, StageStatus, TaskStatus } from '../src/core/types/enums';
import type { Member, Stage, Task } from '../src/core/types/entities';

/* ------------------------------- 夹具 ------------------------------- */

const PROJECT_ID = 'proj_c2';
const STAGE_ID = 'stg_c2';
const ADMIN_ID = 'm-admin-c2';
const MEMBER_ID = 'm-member-c2';
const DUE = '2026-09-20';

const STAGE: Stage = {
  id: STAGE_ID,
  projectId: PROJECT_ID,
  orderIndex: 1,
  templateKey: null,
  colorIndex: 1,
  name: '现场勘测',
  ratioPercent: 100,
  startAt: '2026-09-01T00:00:00.000Z',
  endAt: '2026-09-30T23:59:59.000Z',
  status: StageStatus.NotStarted,
  ownerId: null,
  visible: true,
  resourcePath: null,
  revision: 1,
  updatedAt: '2026-09-01T00:00:00.000Z',
};

let seq = 0;
function makeTask(partial: Partial<Task> & { title: string }): Task {
  seq += 1;
  return {
    id: `tsk_c2_${seq}`,
    taskNo: null,
    projectId: PROJECT_ID,
    stageId: STAGE_ID,
    done: false,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'human',
    externalId: null,
    agentId: null,
    status: TaskStatus.Todo,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    orderIndex: seq,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

function makeMember(id: string, name: string, roleKind: MemberRoleKind): Member {
  return {
    id,
    name,
    role: roleKind === MemberRoleKind.Admin ? '项目负责人' : '协作成员',
    contact: null,
    avatarColor: null,
    active: true,
    roleKind,
    passwordHash: null,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

/* --------------------------- 渲染与清理 --------------------------- */

let host: HTMLDivElement | null = null;
let root: Root | null = null;

/**
 * 卸载当前挂载的树。**同一用例内多次 render 时必须先收掉前一棵**，否则：
 *   ① 旧 root 不被 unmount，其 host 也不被 remove → 孤儿树永久留在 `document.body`；
 *   ② 孤儿树仍订阅 store，同进程后续 spec 的 setState 会把它唤醒 → 跨文件污染
 *      （vitest 是 `singleThread`，所有 spec 共用一个进程，报错点会落在**无关文件**上）。
 */
function unmountCurrent(): void {
  const r = root;
  if (r) {
    act(() => {
      r.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
}

function renderChecklist(opts: { actor: 'admin' | 'member' | 'none'; tasks: Task[] }): HTMLDivElement {
  unmountCurrent();
  useMembersStore.getState().setAll([
    makeMember(ADMIN_ID, '负责人甲', MemberRoleKind.Admin),
    makeMember(MEMBER_ID, '协作者乙', MemberRoleKind.Member),
  ]);
  const currentMemberId =
    opts.actor === 'admin' ? ADMIN_ID : opts.actor === 'member' ? MEMBER_ID : null;
  act(() => {
    useSettingsStore.setState({ currentMemberId, hydrated: true });
  });

  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  root = createRoot(h);
  act(() => {
    root!.render(
      <TaskChecklist
        stage={STAGE}
        tasks={opts.tasks}
        members={[
          makeMember(ADMIN_ID, '负责人甲', MemberRoleKind.Admin),
          makeMember(MEMBER_ID, '协作者乙', MemberRoleKind.Member),
        ]}
      />,
    );
  });
  return h;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  unmountCurrent();
  act(() => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  });
});

/* ====================================================================================
 * ① 任务截止日：成员/未进入身份 → 写入口**不渲染**（H 档，不是 D 档）
 * ==================================================================================== */

describe('v0.7 C2 · 任务截止日成员只读（P0-19-①）', () => {
  it('★ 成员：不存在日期输入（data-task-due-input / input[type=date] 均无），截止日以文本展示', () => {
    const h = renderChecklist({ actor: 'member', tasks: [makeTask({ title: '放线', dueDate: DUE })] });

    // 前提：清单真的渲染了（否则「查不到」是空过）。
    // 注意：任务标题在 `<input>` 里，**textContent 取不到输入值**，故按行数判定。
    expect(h.querySelectorAll('li').length).toBe(1);

    // ① 核心断言（双重：专用锚点 + 通用标签）——写入口整体缺席
    expect(h.querySelector('[data-task-due-input]'), '成员不得渲染日期写入口').toBeNull();
    expect(h.querySelectorAll('input[type="date"]').length, '成员不得存在任何日期输入').toBe(0);

    // ② 信息仍在：截止日以**纯文本**展示（不是把「看」也一起掐了）
    const readonly = h.querySelector('[data-task-due-readonly]');
    expect(readonly, '成员应看到截止日的只读文本').toBeTruthy();
    expect((readonly?.textContent ?? '').trim()).toBe(DUE);
  });

  it('★ 成员：多条任务都无日期输入，截止日各以只读文本展示', () => {
    const h = renderChecklist({
      actor: 'member',
      tasks: [makeTask({ title: '放线', dueDate: DUE }), makeTask({ title: '复尺', dueDate: '2026-09-25' })],
    });

    expect(h.querySelectorAll('li').length).toBe(2);
    expect(h.querySelectorAll('input[type="date"]').length, '成员不得存在任何日期输入').toBe(0);

    const texts = Array.from(h.querySelectorAll('[data-task-due-readonly]')).map((e) =>
      (e.textContent ?? '').trim(),
    );
    expect(texts).toEqual([DUE, '2026-09-25']);
  });

  /**
   * 本用例**刻意不**断言「清单内不存在任何 `<input>`」：任务标题的 `ImeInput`
   * 对成员仍是 `readOnly`（禁用档 D）而非隐藏档 H —— 那是 PM 矩阵里的**另一个问题**
   * （标题的可写性），本轮授权只收紧截止日与资料路径两处，故**不在本文件锁定**它，
   * 已在回报里作为「第 3 处疑似漏网」上报，等 team-lead 定夺后再补断言。
   */

  it('未进入身份（role=null）：与成员同档受限（不回退为 isMember 口径，BUG-1 教训）', () => {
    const h = renderChecklist({ actor: 'none', tasks: [makeTask({ title: '放线', dueDate: DUE })] });

    expect(h.querySelectorAll('li').length).toBe(1);
    // isRestrictedView(null) === true —— 未进入身份**不**享受管理员待遇
    expect(h.querySelector('[data-task-due-input]')).toBeNull();
    expect(h.querySelectorAll('input[type="date"]').length).toBe(0);
    expect((h.querySelector('[data-task-due-readonly]')?.textContent ?? '').trim()).toBe(DUE);
  });

  it('成员 + 无截止日：展示占位「—」，且仍无日期输入', () => {
    const h = renderChecklist({ actor: 'member', tasks: [makeTask({ title: '待定项', dueDate: null })] });

    expect(h.querySelectorAll('input[type="date"]').length).toBe(0);
    expect((h.querySelector('[data-task-due-readonly]')?.textContent ?? '').trim()).toBe('—');
  });

  it('对照组 · 管理员：日期输入照旧存在且带当前值（收紧不得收过头）', () => {
    const h = renderChecklist({ actor: 'admin', tasks: [makeTask({ title: '放线', dueDate: DUE })] });

    const input = h.querySelector('[data-task-due-input]') as HTMLInputElement | null;
    expect(input, '管理员必须仍有截止日写入口').toBeTruthy();
    expect(input!.getAttribute('type')).toBe('date');
    expect(input!.value).toBe(DUE);
    // 管理员侧不渲染只读文本分支
    expect(h.querySelector('[data-task-due-readonly]')).toBeNull();
  });
});

/* ====================================================================================
 * ② 权限派生纪律：页面内不得自写 `!isXxx` 派生（rename 的回归锁）
 * ==================================================================================== */

describe('v0.7 C2 · 权限派生唯一出口（禁止页面内 !isXxx 派生）', () => {
  it('★ TaskChecklist 源码（去注释后）不含 !isMember / !isRestricted / !isAdmin 之类的派生', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '..', 'src', 'components', 'stage-detail', 'TaskChecklist.tsx'),
      'utf8',
    );
    // 注释里会**引用**这些反面写法（解释为什么不用），故必须先剥注释再判定
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(/!is[A-Z]/.test(code), '不得出现 !isXxx 派生判定（应写 isAdmin / isRestricted）').toBe(false);
    // 正向：必须走唯一出口
    expect(code).toContain('isRestrictedView(role)');
  });

  it('★ 成员：新增/删除条目入口不存在（!isMember → isAdmin 改名后的回归锁）', () => {
    const h = renderChecklist({ actor: 'member', tasks: [makeTask({ title: '放线', dueDate: DUE })] });

    expect(h.querySelectorAll('li').length).toBe(1); // 前提：清单渲染了
    expect(h.querySelector('[aria-label="删除条目"]'), '成员不得看到删除条目').toBeNull();
    expect(
      Array.from(h.querySelectorAll('button')).some((b) => (b.textContent ?? '').includes('添加条目')),
      '成员不得看到「添加条目」',
    ).toBe(false);
  });

  it('对照组 · 管理员：新增/删除条目入口照旧存在', () => {
    const h = renderChecklist({ actor: 'admin', tasks: [makeTask({ title: '放线', dueDate: DUE })] });

    expect(h.querySelector('[aria-label="删除条目"]'), '管理员必须仍有删除条目').toBeTruthy();
    expect(
      Array.from(h.querySelectorAll('button')).some((b) => (b.textContent ?? '').includes('添加条目')),
      '管理员必须仍有「添加条目」',
    ).toBe(true);
  });
});
