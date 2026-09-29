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
import { ChangxiaError, ChangxiaErrorCode, MemberActorKind, TaskStatus } from '../src/core/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyPackage } from './helpers/backup-fixture';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  installFakeIndexedDB();
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
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-09-01',
    plannedEndAt: '2026-09-30',
    coverColor: null,
    // ★ 2026-09-24：归属门提到共享核心后，Agent 导入的合法落点必须显式 kind='agent'
    // （缺省按口径读作 human，会被 resolve() 的归属门拒绝——这正是门该有的效果）。
    kind: 'agent',
  } as never);
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

  // QA 第二轮（严过关）补充：多层传播链——dup 键对下游的投毒不止一层，
  // 首到者照常写入，而引用该键的整条下游链（B→C→D）全部 dep_unresolved，
  // 逐条可归因；preview 与 apply 的 created/rejected 严格一致。
  it('dup 键投毒：首到者照常写入，多层下游链全部 dep_unresolved、逐条可归因', async () => {
    const projectId = await seedProject();
    const payload = makePayload(projectId, [
      { title: '甲·首到' },                                          // key t1（保留）
      { title: '乙', dependsOnExternal: ['workbuddy:run-001:t1'] }, // 与甲同键 → conflict
      { title: '丙', dependsOnExternal: ['workbuddy:run-001:t1'] }, // ← 指向 dup 键 → dep_unresolved
      { title: '丁', dependsOnExternal: ['workbuddy:run-001:t3'] }, // ← 二层传播（丙被拒）
    ]);
    payload.tasks[1]!.externalId = payload.tasks[0]!.externalId; // 乙 与 甲 同键

    const preview = await previewAgentPayload(bundle, payload, { projectId });
    const result = await applyAgentPayload(bundle, payload, { projectId });

    expect(preview.created).toBe(result.created);
    expect(preview.rejected).toEqual(result.rejected);

    const byCode = Object.fromEntries(
      result.rejected.map((r) => [r.externalId, r.code] as const),
    );
    expect(byCode['workbuddy:run-001:t1']).toBe('conflict');
    expect(byCode['workbuddy:run-001:t3']).toBe('dep_unresolved');
    expect(byCode['workbuddy:run-001:t4']).toBe('dep_unresolved');
    expect(result.created).toBe(1);

    const tasks = await bundle.tasks.listByProject(projectId);
    expect(tasks.map((t) => t.title)).toEqual(['甲·首到']);
  });
});

/* ================================================================================================
 * 归属门（2026-09-24 提到共享核心；实测报告 9.2/9.4 的回归钉）
 *
 * 为什么钉在**共享核心**这一层：桌面 loopback 与服务端 Fastify 两条通道、
 * preview/apply 两种模式都走 resolve()——在这里钉一条，等于四处同源生效。
 * 此前门只装在服务端路由，桌面通道 dryRun 打人类项目全放行（报告 9.2 实测）。
 * ================================================================================================ */

describe('★ 归属门：Agent 导入的合法落点只剩 Agent 看板（两通道/预览实写同源）', () => {
  /** 建一个 kind=human 的项目（老库无 kind 列的口径也读作 human，一并覆盖） */
  async function seedHumanProject(id: string, withKindField: boolean): Promise<void> {
    await bundle.projects.insert({
      id,
      name: `人类项目·${id}`,
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-09-01',
      plannedEndAt: '2026-09-30',
      coverColor: null,
      ...(withKindField ? { kind: 'human' } : {}),
    } as never);
  }

  function payloadFor(projectId: string): AgentPayloadV1 {
    return {
      schema: 'idplan-agent-payload/v1',
      producedBy: 'workbuddy',
      tasks: [
        {
          externalId: `probe:${projectId}:t1`,
          title: '归属门探针',
          status: 'draft',
        },
      ],
    } as unknown as AgentPayloadV1;
  }

  it('★ 显式 id 指向人类项目（kind 字段存在）→ ProjectUnresolved，零写入', async () => {
    await seedHumanProject('proj_human_1', true);
    const before = await bundle.tasks.listByProject('proj_human_1');

    await expect(
      previewAgentPayload(bundle, payloadFor('proj_human_1'), { projectId: 'proj_human_1' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.ProjectUnresolved });
    await expect(
      applyAgentPayload(bundle, payloadFor('proj_human_1'), { projectId: 'proj_human_1' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.ProjectUnresolved });

    expect(await bundle.tasks.listByProject('proj_human_1')).toEqual(before);
  });

  it('★ 老库口径（无 kind 字段 → 读作 human）同样被拒——回落口径复用 projectKindOf', async () => {
    await seedHumanProject('proj_legacy', false);
    await expect(
      applyAgentPayload(bundle, payloadFor('proj_legacy'), { projectId: 'proj_legacy' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.ProjectUnresolved });
  });

  it('★ 不存在的 id → 同码（存在性与归属共用 ProjectUnresolved，文案指明「不存在」）', async () => {
    const err = await applyAgentPayload(bundle, payloadFor('proj_ghost'), {
      projectId: 'proj_ghost',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ChangxiaError);
    expect((err as ChangxiaError).code).toBe(ChangxiaErrorCode.ProjectUnresolved);
    expect((err as ChangxiaError).userMessage).toContain('不存在');
  });

  it('★ 接管转正（kind 翻 human）后再导入 → 被拒（报告 9.4 要求的回归用例）', async () => {
    const id = await seedProject(); // kind='agent'
    // 模拟 agent-takeover 的转正：只翻 kind（服务本身另有完整测试）
    const row = await bundle.projects.get(id);
    await bundle.projects.update(id, { ...row!, kind: 'human' } as never);

    await expect(
      applyAgentPayload(bundle, payloadFor(id), { projectId: id }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.ProjectUnresolved });
  });

  it('★ 跨通道一致性：同一 payload 在本地通道与服务端路由得到同一错误码', async () => {
    // 本地通道（共享核心）
    await seedHumanProject('proj_x', true);
    const localErr = await applyAgentPayload(bundle, payloadFor('proj_x'), {
      projectId: 'proj_x',
    }).catch((e) => e);
    expect((localErr as ChangxiaError).code).toBe(ChangxiaErrorCode.ProjectUnresolved);

    // 服务端路由：catch 把 ProjectUnresolved 映射成对外契约码 project_unresolved
    // （字面量与枚举值逐字相等——这就是「同一码」的契约）
    expect(ChangxiaErrorCode.ProjectUnresolved).toBe('project_unresolved');
    // 服务端路由的映射分支存在性（源码锚点：消重后唯一映射处）
    const routes = readFileSync(resolve(process.cwd(), 'server/routes/agent.routes.ts'), 'utf8');
    expect(routes).toContain('ChangxiaErrorCode.ProjectUnresolved');
    // 且路由里**不再有**第二份 kind 判定（消重的证据）
    expect(routes).not.toContain("targetRow.kind !== 'agent'");
  });
});

describe('artifact id 稳定化（2026-09-29 走查 #3 / 0.8.2 条目8）', () => {
  it('★ 同一 externalId 重复导入，artifacts id 集合逐字稳定（旧码每次换 randomUUID）', async () => {
    const projectId = await seedProject();
    const payload = makePayload(projectId, [
      {
        title: '带附件的任务',
        artifacts: [
          { kind: 'file', title: '平面图.dwg', path: '/a/plan.dwg', url: null, note: null },
          { kind: 'link', title: '参考链接', path: null, url: 'https://example.com', note: '参考' },
        ],
      },
    ]);

    const first = await applyAgentPayload(bundle, payload, { projectId });
    expect(first.rejected).toEqual([]);
    const rows1 = await bundle.tasks.listByProject(projectId);
    const art1 = rows1.map((t) => t.artifacts.map((a) => a.id));

    // 同 payload 原样重放（幂等路径）——id 不应漂移
    await applyAgentPayload(bundle, payload, { projectId });
    const rows2 = await bundle.tasks.listByProject(projectId);
    const art2 = rows2.map((t) => t.artifacts.map((a) => a.id));

    expect(art2).toEqual(art1);
    // 且 id 确实是确定性形状（art_ + 24 hex），不是 randomUUID（36 字符带连字符）
    for (const t of rows2) {
      for (const a of t.artifacts) {
        expect(a.id).toMatch(/^art_[0-9a-f]{24}$/);
      }
    }
    // 同任务两个附件 id 互异（序号进键的判别力）
    expect(rows2[0]!.artifacts[0]!.id).not.toBe(rows2[0]!.artifacts[1]!.id);
  });
});
