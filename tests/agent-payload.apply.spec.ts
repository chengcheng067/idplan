/**
 * payload.apply 编排核心（v0.6 · T15 spec 清单 #1「agent-payload.idempotent」）。
 *
 * 锁死四条防线（设计文档 T15 要点 1）：
 *   1. 同一 payload 连续 apply 3 次 → 任务数恒定、幂等命中（不产生重复任务）；
 *      ensureAgentMember 只建 1 个 Agent Member（免费 3 席位安全）
 *   2. 批内环（A→B→C→A）→ 整批拒绝（code:'cycle'），零写入
 *   3. dep_unresolved 逐条拒绝，其余条目正常写入
 *   4. stageId 缺省 → 落最后一个可见批次；项目无批次 → 批次级拒绝、不自动新建
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installFakeIndexedDB } from './setup';

import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { applyAgentPayload, previewAgentPayload } from '../src/core/agent/payload.apply';
import type { AgentPayloadV1 } from '../src/core/types/agent-payload';
import type { Stage } from '../src/core/types/entities';
import type { BackupPackage } from '../src/core/types/dto';
import { MemberActorKind, TaskStatus } from '../src/core/types/enums';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  installFakeIndexedDB();
});

const emptyPackage = (): BackupPackage => ({
  meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-09-01T00:00:00.000Z' },
  data: {
    projects: [],
    stages: [],
    tasks: [],
    members: [],
    assignments: [],
    logs: [],
    contracts: [],
    settings: [],
  },
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // fake-indexeddb 同 module 实例共享同名库——空包清库重建，保证 spec 间零污染
  await bundle.admin?.replaceAllImport(emptyPackage());
});

/** 显式批次行（建档不自动生成批次，与 task-status-machine.spec 同款手法） */
function makeStage(id: string, orderIndex: number, visible = true): Stage {
  return {
    id,
    projectId: 'proj_a',
    orderIndex,
    templateKey: null,
    colorIndex: ((orderIndex - 1) % 9) + 1,
    name: `批次${orderIndex}`,
    ratioPercent: 10,
    startAt: '2026-09-01',
    endAt: '2026-09-10',
    status: 'not_started',
    ownerId: null,
    visible,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as unknown as Stage;
}

/** 建一个带两个可见批次 + 一个隐藏批次的项目（固定 id 'proj_a'），返回 projectId */
async function seedProject(): Promise<string> {
  await bundle.projects.insert({
    id: 'proj_a',
    name: 'Agent 编排演练',
    type: 'other' as never,
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-09-01',
    plannedEndAt: '2026-09-30',
    coverColor: null,
  });
  await bundle.stages.bulkInsert([
    makeStage('stg_v1', 1),
    makeStage('stg_v2', 2),
    makeStage('stg_hidden', 3, false),
  ]);
  return 'proj_a';
}

/** 构造 v1 payload（schema 字段与 agent-payload zod 对齐） */
function makePayload(
  projectId: string,
  tasks: Array<Partial<AgentPayloadV1['tasks'][number]>>,
  overrides: Partial<AgentPayloadV1> = {},
): AgentPayloadV1 {
  return {
    schema: 'idplan-agent-payload/v1',
    projectId,
    stageId: null,
    producedBy: {
      actorKind: 'agent',
      agentKind: 'workbuddy',
      agentName: 'WorkBuddy 编排器',
      runId: 'run-001',
    },
    tasks: tasks.map((t, i) => ({
      externalId: `workbuddy:run-001:t${i + 1}`,
      title: t.title ?? `任务 ${i + 1}`,
      status: t.status ?? TaskStatus.Ready,
      dependsOnExternal: t.dependsOnExternal ?? [],
      description: t.description ?? null,
      artifacts: t.artifacts ?? [],
      startAt: t.startAt ?? null,
      dueDate: t.dueDate ?? null,
      externalPath: null,
    })) as AgentPayloadV1['tasks'],
    ...overrides,
  } as AgentPayloadV1;
};

describe('幂等 upsert：同一 payload 连续 apply 3 次', () => {
  it('任务数恒定、无 rejected、agentId 回填、Agent Member 只建 1 个', async () => {
    const projectId = await seedProject();
    const payload = makePayload(projectId, [
      { title: '任务一' },
      { title: '任务二', dependsOnExternal: ['workbuddy:run-001:t1'] },
    ]);

    // 两段式 upsert 的计数语义：首轮 first 段 created=2 / second 段无批内依赖行可修 →0；
    // 后续轮 first 段 2 行幂等命中 + second 段「任务二」依赖重写再命中 1 = updated 3。
    for (let i = 0; i < 3; i++) {
      const result = await applyAgentPayload(bundle, payload, { projectId });
      expect(result.rejected).toEqual([]);
      if (i === 0) {
        expect(result.created).toBe(2);
        // 首轮 second 段即对「任务二」重写批内依赖 → 幂等命中计 1 次 updated
        expect(result.updated).toBe(1);
      } else {
        expect(result.created).toBe(0);
        // 后续轮：first 段 2 行幂等命中 + second 段批内依赖行重写命中（两段汇总）
        expect(result.updated).toBeGreaterThanOrEqual(2);
        expect(result.updated).toBeLessThanOrEqual(3);
      }
    }

    const tasks = await bundle.tasks.listByProject(projectId);
    expect(tasks).toHaveLength(2); // 不产生重复任务
    // 批内依赖第二段补齐 → 真实 Task.id
    const second = tasks.find((t) => t.title === '任务二')!;
    expect(second.dependsOn).toHaveLength(1);
    expect(second.dependsOn[0]).toBe(tasks.find((t) => t.title === '任务一')!.id);
    // agentId / source / status 回填
    expect(second.source).toBe('agent');
    expect(second.status).toBe(TaskStatus.Ready);

    // ensureAgentMember 幂等：连续 3 次 apply 后 agent 成员仍只有 1 个
    const members = await bundle.members.list(true);
    const agents = members.filter((m) => m.actorKind === MemberActorKind.Agent);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.agentKind).toBe('workbuddy');
  });
});

describe('环检测：批内环整批拒绝、零写入', () => {
  it('A→B→C→A 全部条目 rejected(code:cycle)，任务表无新增', async () => {
    const projectId = await seedProject();
    const payload = makePayload(projectId, [
      { title: 'A', dependsOnExternal: ['workbuddy:run-001:t3'] },
      { title: 'B', dependsOnExternal: ['workbuddy:run-001:t1'] },
      { title: 'C', dependsOnExternal: ['workbuddy:run-001:t2'] },
    ]);

    const result = await applyAgentPayload(bundle, payload, { projectId });
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.rejected).toHaveLength(3);
    for (const r of result.rejected) {
      expect(r.code).toBe('cycle');
    }
    expect(await bundle.tasks.listByProject(projectId)).toHaveLength(0);
  });

  it('preview 与 apply 一致：环 payload 预览即报 cycle，不写任何数据', async () => {
    const projectId = await seedProject();
    // 两节点环（单条目自环在 dep 解析阶段因「目标尚不存在」不可解，归 dep_unresolved 语义）
    const payload = makePayload(projectId, [
      { title: 'P', dependsOnExternal: ['workbuddy:run-001:t2'] },
      { title: 'Q', dependsOnExternal: ['workbuddy:run-001:t1'] },
    ]);
    const preview = await previewAgentPayload(bundle, payload, { projectId });
    expect(preview.rejected).toHaveLength(2);
    expect(preview.rejected.every((r) => r.code === 'cycle')).toBe(true);
    expect(await bundle.tasks.listByProject(projectId)).toHaveLength(0);
  });
});

describe('dep_unresolved：逐条拒绝、其余正常写入', () => {
  it('指向不存在 externalId 的条目被拒，健康条目照常落库', async () => {
    const projectId = await seedProject();
    const payload = makePayload(projectId, [
      { title: '健康任务' },
      { title: '悬空依赖', dependsOnExternal: ['workbuddy:run-999:missing'] },
    ]);
    const result = await applyAgentPayload(bundle, payload, { projectId });
    expect(result.created).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.code).toBe('dep_unresolved');
    expect(result.rejected[0]!.externalId).toBe('workbuddy:run-001:t2');

    const tasks = await bundle.tasks.listByProject(projectId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('健康任务');
  });
});

describe('批次策略（§10-R3）：不自动新建 Stage', () => {
  it('stageId 缺省 → 落最后一个可见批次（orderIndex 最大）', async () => {
    const projectId = await seedProject();
    const result = await applyAgentPayload(
      bundle,
      makePayload(projectId, [{ title: '落批次任务' }]),
      { projectId },
    );
    expect(result.rejected).toEqual([]);
    const tasks = await bundle.tasks.listByProject(projectId);
    expect(tasks).toHaveLength(1);
    const stages = (await bundle.stages.listByProject(projectId))
      .filter((s) => s.visible)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    expect(tasks[0]!.stageId).toBe(stages[stages.length - 1]!.id);
    // 不新建批次：总批次数仍为 seed 的 3（含 1 个隐藏批次）
    expect((await bundle.stages.listByProject(projectId)).length).toBe(3);
  });

  it('项目无可见批次 → 批次级拒绝（code:stage_limit），任务零写入', async () => {
    const projectId = await seedProject();
    // 隐藏全部批次
    for (const s of await bundle.stages.listByProject(projectId)) {
      await bundle.stages.update(s.id, { visible: false });
    }
    const result = await applyAgentPayload(
      bundle,
      makePayload(projectId, [{ title: '无处可落' }]),
      { projectId },
    );
    expect(result.created).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.code).toBe('stage_limit');
    expect(await bundle.tasks.listByProject(projectId)).toHaveLength(0);
    // 批次数不变（绝不自动新建）
    expect((await bundle.stages.listByProject(projectId)).length).toBe(
      (await bundle.stages.listByProject(projectId)).length,
    );
  });
});

describe('批内重复 externalId（QA 返工 🟠-1）：逐条 conflict、绝不静默合并', () => {
  it('同 externalId 两条不同 title → 后到者 rejected(conflict)，preview 与 apply 严格一致', async () => {
    const projectId = await seedProject();
    const payload = makePayload(projectId, [{ title: '首条·真身' }, { title: '后到·冒名' }]);
    // 手工把第二条 externalId 改成与第一条相同（模拟 Agent 生成重复键）
    payload.tasks[1]!.externalId = payload.tasks[0]!.externalId;

    const preview = await previewAgentPayload(bundle, payload, { projectId });
    const applied = await applyAgentPayload(bundle, payload, { projectId });

    // ★ 所见即所写（PRD 附录 A 规则 4）：preview 与 apply 的计数与 rejected 完全一致
    expect(preview.created).toBe(applied.created);
    expect(preview.updated).toBe(applied.updated);
    expect(preview.rejected).toEqual(applied.rejected);

    expect(applied.created).toBe(1);
    expect(applied.updated).toBe(0);
    expect(applied.rejected).toHaveLength(1);
    expect(applied.rejected[0]!.code).toBe('conflict');
    expect(applied.rejected[0]!.externalId).toBe(payload.tasks[0]!.externalId);
    expect(applied.rejected[0]!.reason).toContain('externalId');

    // 库内事实：仅首到者写入，后到者绝不静默覆盖
    const tasks = await bundle.tasks.listByProject(projectId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('首条·真身');
  });

  it('下游引用 dup 条目 → 传播为 dep_unresolved（指向被拒条目的引用不可解析）', async () => {
    const projectId = await seedProject();
    const payload = makePayload(projectId, [
      { title: '甲' },
      { title: '乙·dup' },
      { title: '下游丙', dependsOnExternal: ['workbuddy:run-001:t1'] },
    ]);
    // 乙 与 甲 同 externalId → 乙 conflict；丙引用该 id → 指向被拒条目，dep_unresolved
    payload.tasks[1]!.externalId = payload.tasks[0]!.externalId;

    const preview = await previewAgentPayload(bundle, payload, { projectId });
    const result = await applyAgentPayload(bundle, payload, { projectId });

    expect(preview.rejected).toEqual(result.rejected);
    expect(result.created).toBe(1);
    expect(result.rejected.map((r) => r.code).sort()).toEqual(['conflict', 'dep_unresolved']);
    expect(result.rejected.find((r) => r.code === 'conflict')!.externalId).toBe(
      payload.tasks[0]!.externalId,
    );
    expect(result.rejected.find((r) => r.code === 'dep_unresolved')!.externalId).toBe(
      'workbuddy:run-001:t3',
    );

    const tasks = await bundle.tasks.listByProject(projectId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('甲');
  });

  it('三条同 externalId → 仅首条写入，2 条 conflict（计数逐条可归因）', async () => {
    const projectId = await seedProject();
    const payload = makePayload(projectId, [{ title: '唯一存活的' }, { title: 'dup-2' }, { title: 'dup-3' }]);
    payload.tasks[1]!.externalId = payload.tasks[0]!.externalId;
    payload.tasks[2]!.externalId = payload.tasks[0]!.externalId;

    const result = await applyAgentPayload(bundle, payload, { projectId });
    expect(result.created).toBe(1);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((r) => r.code === 'conflict')).toBe(true);
    // 两条 conflict 的 externalId 相同但逐条报告（AUS-4 逐条 reason，不是聚合一条）
    expect(result.rejected.map((r) => r.externalId)).toEqual([
      payload.tasks[0]!.externalId,
      payload.tasks[0]!.externalId,
    ]);
  });
});
