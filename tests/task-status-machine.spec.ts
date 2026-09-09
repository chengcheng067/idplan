/**
 * T09 · task.service 状态机 + payload.apply 编排（设计文档 DoD）：
 *   1. 非法流转（draft→done）被拒且文案含中文状态名；合法流转经严格通道成功；
 *   2. 环形 payload：preview 即报环，created=0，库零写入；
 *   3. 同一 payload 导入 3 次：Member 数不增、任务数不增、revision 递增；
 *   4. dependsOnExternal 引用不存在 → 该条 rejected(dep_unresolved)，其余正常写入；
 *   5. 批内依赖（A←B）第二段解析后 dependsOn 指向真实 Task.id；
 *   6. stageId 缺省 → 最后一个可见 Stage；项目无 Stage → rejected(stage_limit)；
 *   7. RestClient 409 → ChangxiaError(Conflict)（T07 错误码映射）。
 * 环境：fake-indexeddb + local 适配器。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { ChangxiaError, ChangxiaErrorCode, TaskStatus } from '../src/core/types/enums';
import type { Project, Stage } from '../src/core/types/entities';
import { AGENT_PAYLOAD_SCHEMA_ID } from '../src/core/types/agent-payload';
import type { AgentPayloadV1 } from '../src/core/types/agent-payload';
import { TaskService } from '../src/core/services/task.service';
import {
  applyAgentPayload,
  previewAgentPayload,
} from '../src/core/agent/payload.apply';
import { RestClient } from '../src/core/repositories/remote/rest.client';

let bundle: IRepositoryBundle;

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

async function seedProject(withStages = true): Promise<Project> {
  // 显式 id（CreateProjectCmd 支持）：makeStage 的 projectId 引用与 payload 直接复用
  const project = await bundle.projects.insert({
    id: 'proj_a',
    name: 'Agent 项目',
    type: 'other' as never,
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-09-01',
    plannedEndAt: '2026-09-30',
    coverColor: null,
  });
  if (withStages) {
    await bundle.stages.bulkInsert([
      makeStage('stg_v1', 1),
      makeStage('stg_v2', 2),
      makeStage('stg_hidden', 3, false),
    ]);
  }
  return project;
}

function payloadOf(projectId: string, tasks: AgentPayloadV1['tasks'], stageId: string | null = null): AgentPayloadV1 {
  return {
    schema: AGENT_PAYLOAD_SCHEMA_ID,
    projectId,
    stageId,
    producedBy: { actorKind: 'agent', agentKind: 'codex', agentName: 'Codex 值班', runId: 'run-1' },
    tasks,
  };
}

function payloadTask(externalId: string, overrides: Partial<AgentPayloadV1['tasks'][number]> = {}) {
  return {
    externalId,
    title: `任务 ${externalId}`,
    description: null,
    status: TaskStatus.Ready,
    assigneeAgentKind: null,
    assigneeHuman: null,
    dependsOnExternal: [],
    startAt: null,
    dueDate: '2026-09-20',
    artifacts: [],
    ...overrides,
  };
}

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport({
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      projects: [], stages: [], tasks: [], members: [],
      assignments: [], logs: [], contracts: [], settings: [],
    },
  });
});

describe('task.service：严格通道状态机', () => {
  it('draft→done 非法：抛 Validation 且文案含中文状态名', async () => {
    const project = await seedProject();
    const task = await bundle.tasks.insert({
      projectId: project.id,
      stageId: 'stg_v1',
      title: '流转验证',
      assigneeId: null,
      dueDate: null,
    });
    const svc = new TaskService(bundle.tasks);
    try {
      await svc.transitionStatus(task.id, TaskStatus.Done);
      expect.unreachable('应当抛出');
    } catch (err) {
      expect((err as ChangxiaError).code).toBe(ChangxiaErrorCode.Validation);
      expect((err as ChangxiaError).userMessage).toContain('草稿');
      expect((err as ChangxiaError).userMessage).toContain('已完成');
    }
  });

  it('合法流转 draft→ready→claimed(claim) 全链路；done 双写正确', async () => {
    const project = await seedProject();
    const task = await bundle.tasks.insert({
      projectId: project.id,
      stageId: 'stg_v1',
      title: '合法链路',
      assigneeId: null,
      dueDate: null,
    });
    const svc = new TaskService(bundle.tasks);
    const ready = await svc.transitionStatus(task.id, TaskStatus.Ready);
    expect(ready.status).toBe(TaskStatus.Ready);
    expect(ready.done).toBe(false);

    const claimed = await svc.claim(task.id, 'mem_x');
    expect(claimed.status).toBe(TaskStatus.Claimed);
    expect(claimed.claimedAt).not.toBeNull();
  });
});

describe('payload.apply：preview / apply 编排', () => {
  it('预览与写入一致：1 created；stageId 缺省 → 最后一个可见批次；agentId/source 落位', async () => {
    const project = await seedProject();
    const payload = payloadOf(project.id, [payloadTask('codex:run-1:t1')]);

    const preview = await previewAgentPayload(bundle, payload);
    expect(preview).toEqual({ created: 1, updated: 0, rejected: [] });
    expect(await bundle.tasks.list()).toHaveLength(0); // preview 零写入

    const result = await applyAgentPayload(bundle, payload);
    expect(result.created).toBe(1);
    const rows = await bundle.tasks.list();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.stageId).toBe('stg_v2'); // 最后一个【可见】批次（stg_hidden 被排除）
    expect(row.source).toBe('agent');
    expect(row.agentId).not.toBeNull();
    expect(row.status).toBe(TaskStatus.Ready);
    expect(row.done).toBe(false);
  });

  it('同一 payload 导入 3 次：Member 数不增、任务数不增、revision 递增', async () => {
    const project = await seedProject();
    const payload = payloadOf(project.id, [payloadTask('codex:run-1:t1')]);
    await applyAgentPayload(bundle, payload);
    const rev1 = (await bundle.tasks.list())[0]!.revision;

    await applyAgentPayload(bundle, payload);
    await applyAgentPayload(bundle, payload);

    const rows = await bundle.tasks.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revision).toBeGreaterThan(rev1);
    const agents = (await bundle.members.list(true)).filter((m) => m.actorKind === 'agent');
    expect(agents).toHaveLength(1); // ensureAgentMember 幂等（免费 3 席位安全）
  });

  it('环形 payload：preview 即报环，apply created=0 且库零写入', async () => {
    const project = await seedProject();
    const payload = payloadOf(project.id, [
      payloadTask('k:a', { dependsOnExternal: ['k:b'] }),
      payloadTask('k:b', { dependsOnExternal: ['k:a'] }),
    ]);
    const preview = await previewAgentPayload(bundle, payload);
    expect(preview.created).toBe(0);
    expect(preview.rejected.every((r) => r.code === 'cycle')).toBe(true);

    const result = await applyAgentPayload(bundle, payload);
    expect(result.created).toBe(0);
    expect(await bundle.tasks.list()).toHaveLength(0);
  });

  it('dependsOnExternal 引用不存在 → 该条 rejected(dep_unresolved)，其余正常写入', async () => {
    const project = await seedProject();
    const payload = payloadOf(project.id, [
      payloadTask('k:ok'),
      payloadTask('k:bad', { dependsOnExternal: ['k:missing'] }),
    ]);
    const result = await applyAgentPayload(bundle, payload);
    expect(result.created).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ externalId: 'k:bad', code: 'dep_unresolved' });

    const rows = await bundle.tasks.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.externalId).toBe('k:ok');
  });

  it('批内依赖：第二段解析后 dependsOn 指向批内真实 Task.id', async () => {
    const project = await seedProject();
    const payload = payloadOf(project.id, [
      payloadTask('k:first'),
      payloadTask('k:second', { dependsOnExternal: ['k:first'] }),
    ]);
    const result = await applyAgentPayload(bundle, payload);
    expect(result.created).toBe(2);
    expect(result.rejected).toHaveLength(0);

    const rows = await bundle.tasks.list();
    const first = rows.find((t) => t.externalId === 'k:first')!;
    const second = rows.find((t) => t.externalId === 'k:second')!;
    expect(second.dependsOn).toEqual([first.id]);
    // Ready 计算与 dag 一致：k:first 就绪、k:second 被阻塞（依赖未完成）
    const { computeReadyTasks } = await import('../src/core/agent/dag');
    const { ready, blocked } = computeReadyTasks(rows);
    expect(ready.map((t) => t.id)).toEqual([first.id]);
    expect(blocked.map((b) => b.task.id)).toEqual([second.id]);
  });

  it('项目无 Stage → 全部 rejected(stage_limit)，库零写入（R3：不自动建 Stage）', async () => {
    const project = await seedProject(false);
    const payload = payloadOf(project.id, [payloadTask('k:x')]);
    const result = await applyAgentPayload(bundle, payload);
    expect(result.created).toBe(0);
    expect(result.rejected[0]!.code).toBe('stage_limit');
    expect(await bundle.tasks.list()).toHaveLength(0);
    expect(await bundle.stages.listByProject(project.id)).toHaveLength(0);
  });

  it('宽松状态通道：payload 给定 review 直落（不走白名单）', async () => {
    const project = await seedProject();
    await applyAgentPayload(bundle, payloadOf(project.id, [
      payloadTask('k:rev', { status: TaskStatus.Review }),
    ]));
    const row = (await bundle.tasks.list())[0]!;
    expect(row.status).toBe(TaskStatus.Review);
    expect(row.done).toBe(false);
  });
});

describe('RestClient：HTTP 409 → Conflict（T07）', () => {
  it('409 响应被翻译为 ChangxiaError(Conflict) 并透出服务端 userMessage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { userMessage: '该任务已被认领或不处于就绪状态。' } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    try {
      const api = new RestClient('http://test.local');
      await api.post('/api/tasks/t1/claim', { actorMemberId: 'mem_a' });
      expect.unreachable('应当抛出');
    } catch (err) {
      expect(err).toBeInstanceOf(ChangxiaError);
      expect((err as ChangxiaError).code).toBe(ChangxiaErrorCode.Conflict);
      expect((err as ChangxiaError).userMessage).toContain('认领');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
