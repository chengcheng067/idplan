/**
 * v0.3 变更 C：任务多人参与收口层测试（增量架构 4.2 新增用例）：
 *   1. taskAssigneeIds 回落（旧单值）/多值/空集；
 *   2. canMemberToggleTask 多人语义（任一参与人 true、非参与人 false、null 不可勾选）；
 *   3. computeRelatedStageIds 多人任务阶段可见；
 *   4. listByAssignee / queryTasks 参与人包含；
 *   5. sameAssigneeSet 去重相等判定。
 * node 环境纯函数断言 + fake-indexeddb（listByAssignee/queryTasks 走真实 repo/store）。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import {
  taskAssigneeIds,
  canMemberToggleTask,
  computeRelatedStageIds,
  sameAssigneeSet,
} from '../src/hooks/useRoleGuard';
import { createTaskActions, useProjectsStore } from '../src/store/useProjectsStore';
import { MemberRoleKind, StageStatus, TaskStatus } from '../src/core/types/enums';
import type { Member, Stage, Task } from '../src/core/types/entities';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // fake-indexeddb 同 module 实例共享同名库（'changxia'）——每次用空包清库重建保证隔离
  await bundle.admin?.replaceAllImport({
    meta: { app: 'changxia', schemaVersion: 1, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      projects: [],
      stages: [],
      tasks: [],
      itineraries: [],
      members: [],
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
      executions: [],
      executionAttempts: [],
      executionEvents: [],
      writebackProposals: [],
    },
  });
  // useProjectsStore 是模块级单例：queryTasks 读内存，需同步重置避免跨用例污染
  useProjectsStore.setState({ projects: [], stages: [], tasks: [], stageLogs: {} });
});

/* ------------------------------ taskAssigneeIds ------------------------------ */

describe('taskAssigneeIds：有效参与人读取收口', () => {
  it('assigneeIds 多值 → 原样返回', () => {
    expect(taskAssigneeIds({ assigneeId: 'A', assigneeIds: ['A', 'B'] })).toEqual(['A', 'B']);
  });

  it('assigneeIds=[] 且 assigneeId 有值 → 回落 [assigneeId]（旧数据）', () => {
    expect(taskAssigneeIds({ assigneeId: 'A', assigneeIds: [] })).toEqual(['A']);
  });

  it('assigneeIds 缺省（undefined）→ 回落 [assigneeId]', () => {
    expect(taskAssigneeIds({ assigneeId: 'A' })).toEqual(['A']);
  });

  it('全空 → []（未指派）', () => {
    expect(taskAssigneeIds({ assigneeId: null, assigneeIds: [] })).toEqual([]);
    expect(taskAssigneeIds({ assigneeId: null })).toEqual([]);
  });
});

/* ------------------------------ canMemberToggleTask ------------------------------ */

describe('canMemberToggleTask：多人参与勾选权限', () => {
  it('旧数据单值回落：仅 assigneeId===me 可勾选', () => {
    expect(canMemberToggleTask('mem_a', { assigneeId: 'mem_a' })).toBe(true);
    expect(canMemberToggleTask('mem_b', { assigneeId: 'mem_a' })).toBe(false);
    expect(canMemberToggleTask('mem_a', { assigneeId: null })).toBe(false);
  });

  it('多人任务：任一参与人 true、非参与人 false', () => {
    const multi = { assigneeId: 'mem_a', assigneeIds: ['mem_a', 'mem_b'] };
    expect(canMemberToggleTask('mem_a', multi)).toBe(true);
    expect(canMemberToggleTask('mem_b', multi)).toBe(true);
    expect(canMemberToggleTask('mem_c', multi)).toBe(false);
  });

  it('未进入（memberId=null）不可勾选', () => {
    expect(canMemberToggleTask(null, { assigneeId: 'mem_a', assigneeIds: ['mem_a'] })).toBe(false);
  });
});

/* ------------------------------ computeRelatedStageIds ------------------------------ */

describe('computeRelatedStageIds：多人任务相关阶段可见', () => {
  const stages: Stage[] = [
    { id: 'stg_1', projectId: 'proj_1', orderIndex: 1, templateKey: null, colorIndex: 1, customColor: null, name: '提案', ratioPercent: 5, startAt: '2026-08-01', endAt: '2026-08-07', status: StageStatus.NotStarted, ownerId: null, visible: true, resourcePath: null, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
    { id: 'stg_2', projectId: 'proj_1', orderIndex: 2, templateKey: null, colorIndex: 2, customColor: null, name: '测量', ratioPercent: 4, startAt: '2026-08-08', endAt: '2026-08-13', status: StageStatus.NotStarted, ownerId: 'mem_other', visible: true, resourcePath: null, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
  ];

  it('成员仅因参与某任务（assigneeIds 含 me，assigneeId 是他人）而看到该阶段', () => {
    const tasks: Task[] = [
      { id: 'tsk_m', taskNo: null, projectId: 'proj_1', stageId: 'stg_2', title: '放线', done: false, assigneeId: 'mem_other', assigneeIds: ['mem_other', 'mem_me'], dueDate: '2026-08-13', source: 'human', externalId: null, agentId: null, status: TaskStatus.Draft, description: null, dependsOn: [], artifacts: [], startAt: null, claimedAt: null, runId: null, orderIndex: 1, revision: 1, updatedAt: '2026-08-01T00:00:00.000Z' },
    ];
    const ids = computeRelatedStageIds({
      memberView: true,
      currentMemberId: 'mem_me',
      stages,
      tasks,
    });
    expect(ids).not.toBeNull();
    expect([...(ids as Set<string>)].sort()).toEqual(['stg_2']);
  });

  it('成员无任何相关 → 空集', () => {
    const ids = computeRelatedStageIds({
      memberView: true,
      currentMemberId: 'mem_x',
      stages,
      tasks: [],
    });
    expect(ids?.size).toBe(0);
  });
});

/* ------------------------------ sameAssigneeSet ------------------------------ */

describe('sameAssigneeSet：集合级流水去重判定', () => {
  it('顺序无关 → 相等', () => {
    expect(sameAssigneeSet(['A', 'B'], ['B', 'A'])).toBe(true);
  });

  it('重复去重 → 相等', () => {
    expect(sameAssigneeSet(['A', 'A', 'B'], ['B', 'A'])).toBe(true);
  });

  it('集合不同 → false', () => {
    expect(sameAssigneeSet(['A', 'B'], ['A', 'C'])).toBe(false);
    expect(sameAssigneeSet(['A'], [])).toBe(false);
  });

  it('空集与空集 → 相等', () => {
    expect(sameAssigneeSet([], [])).toBe(true);
  });
});

/* ------------------------------ repo / store 参与人包含 ------------------------------ */

describe('参与人包含语义：listByAssignee / queryTasks', () => {
  async function seedTask(assigneeIds: string[], assigneeId: string | null): Promise<Task> {
    const created = await bundle.tasks.insert({
      projectId: 'proj_1',
      stageId: 'stg_1',
      title: '多人任务',
      assigneeId,
      assigneeIds,
      dueDate: '2026-08-20',
    });
    // 同步 store 镜像（模拟 repo 成功后 store.putTask，queryTasks 读内存）
    useProjectsStore.getState().putTask(created);
    return created;
  }

  it('listByAssignee 对任一参与人均返回（assigneeIds 包含）', async () => {
    await seedTask(['mem_a', 'mem_b'], 'mem_a');
    const forA = await bundle.tasks.listByAssignee('mem_a');
    const forB = await bundle.tasks.listByAssignee('mem_b');
    const forC = await bundle.tasks.listByAssignee('mem_c');
    expect(forA).toHaveLength(1);
    expect(forB).toHaveLength(1);
    expect(forC).toHaveLength(0);
  });

  it('旧数据单值回落：listByAssignee(assigneeId) 仍命中', async () => {
    const created = await bundle.tasks.insert({
      projectId: 'proj_1',
      stageId: 'stg_1',
      title: '单值旧任务',
      assigneeId: 'mem_a',
      dueDate: '2026-08-20',
    });
    useProjectsStore.getState().putTask(created);
    const rows = await bundle.tasks.listByAssignee('mem_a');
    expect(rows).toHaveLength(1);
  });

  it('queryTasks 内存过滤参与人包含', async () => {
    await seedTask(['mem_a', 'mem_b'], 'mem_a');
    const actions = createTaskActions(bundle);
    const forB = actions.queryTasks({ assigneeId: 'mem_b' });
    const forC = actions.queryTasks({ assigneeId: 'mem_c' });
    expect(forB).toHaveLength(1);
    expect(forC).toHaveLength(0);
  });
});

/* ------------------------------ 类型引用保持 ------------------------------ */

export type { Member, Stage, Task };
export { MemberRoleKind };
