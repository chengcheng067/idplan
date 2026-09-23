/**
 * projectId 冲突 fail-closed（安全门禁）验收 spec。
 *
 * 覆盖两层：
 *   ① 纯函数 `resolveAgentProjectId`（payload.apply 导出）：5 个主场景 + 边界（空白 / 大小写）；
 *   ② 落库内核 `applyAgentPayload` / `previewAgentPayload`：冲突时**抛错且零写入**（不只是抛错，
 *      要证明库里一行没多）。
 *
 * 零写入怎么证明：冲突请求前后两张项目各自的 tasks 行数逐一相等（都仍是 0），
 * 而不是只断言「抛了异常」——抛了异常但偷偷写了半行，是这种缺口最典型的失效模式。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installFakeIndexedDB } from './setup';

import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import {
  applyAgentPayload,
  previewAgentPayload,
  resolveAgentProjectId,
} from '../src/core/agent/payload.apply';
import type { AgentPayloadV1 } from '../src/core/types/agent-payload';
import { ChangxiaError, ChangxiaErrorCode, TaskStatus } from '../src/core/types/enums';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // fake-indexeddb 同 module 实例共享同名库——空包清库重建，保证 spec 间零污染（与 agent-payload.apply.spec 同款）
  await bundle.admin?.replaceAllImport({
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-09-01T00:00:00.000Z' },
    data: {
      projects: [], stages: [], tasks: [], members: [], assignments: [], logs: [], contracts: [], settings: [],
    },
  } as never);
});

/** 构造 v1 payload（schema 字段与 agent-payload zod 对齐） */
function makePayload(
  projectId: string | null,
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
    tasks: [
      {
        externalId: 'workbuddy:run-001:t1',
        title: '任务一',
        status: TaskStatus.Ready,
        dependsOnExternal: [],
        description: null,
        artifacts: [],
        startAt: null,
        dueDate: null,
        externalPath: null,
      },
    ],
    ...overrides,
  } as AgentPayloadV1;
}

/** 显式建一个 **Agent 看板**（固定 id），带一个可见批次。
 * 2026-09-24：归属门提到共享核心后，人类项目作落点会在冲突逻辑之前被归属门拒——
 * 本 spec 测的是「projectId 冲突 fail-closed」，落点必须合法（agent）才摸得到冲突分支。 */
async function seedProject(id: string): Promise<void> {
  await bundle.projects.insert({
    id,
    name: `项目 ${id}`,
    type: 'other' as never,
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-09-01',
    plannedEndAt: '2026-09-30',
    coverColor: null,
    kind: 'agent',
  });
  await bundle.stages.bulkInsert([
    {
      id: `stg_${id}`,
      projectId: id,
      orderIndex: 1,
      templateKey: null,
      colorIndex: 1,
      name: '批次1',
      ratioPercent: 10,
      startAt: '2026-09-01',
      endAt: '2026-09-10',
      status: 'not_started',
      ownerId: null,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-09-01T00:00:00.000Z',
    } as unknown as never,
  ]);
}

/* ============================ ① 纯函数 ============================ */

describe('resolveAgentProjectId（纯函数）', () => {
  it('query 与 payload 一致 → 返回该 id', () => {
    expect(resolveAgentProjectId({ payloadProjectId: 'p1', externalProjectId: 'p1' })).toBe('p1');
  });

  it('query 与 payload 不一致 → 抛 Validation', () => {
    let thrown: unknown;
    try {
      resolveAgentProjectId({ payloadProjectId: 'p1', externalProjectId: 'p2' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ChangxiaError);
    const ce = thrown as ChangxiaError;
    expect(ce.code).toBe(ChangxiaErrorCode.Validation);
    expect(ce.userMessage).toContain('query 与 payload 的 projectId 不一致');
  });

  it('只有 payload 提供 → 返回 payload', () => {
    expect(resolveAgentProjectId({ payloadProjectId: 'p1', externalProjectId: undefined })).toBe('p1');
  });

  it('只有 external 提供 → 返回 external', () => {
    expect(resolveAgentProjectId({ payloadProjectId: null, externalProjectId: 'p2' })).toBe('p2');
  });

  it('两者都未提供 → 返回 null', () => {
    expect(resolveAgentProjectId({ payloadProjectId: null, externalProjectId: undefined })).toBeNull();
  });

  it('边界：仅首尾空白不同 → 判为一致（trim 后相等）', () => {
    expect(resolveAgentProjectId({ payloadProjectId: ' p1 ', externalProjectId: 'p1' })).toBe('p1');
    expect(resolveAgentProjectId({ payloadProjectId: 'p1', externalProjectId: '  p1' })).toBe('p1');
  });

  it('边界：仅大小写不同 → 判为不一致（不折叠大小写）', () => {
    let thrown: unknown;
    try {
      resolveAgentProjectId({ payloadProjectId: 'p1', externalProjectId: 'P1' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ChangxiaError);
    expect((thrown as ChangxiaError).code).toBe(ChangxiaErrorCode.Validation);
  });

  it('边界：空串 / 仅空白视为未提供', () => {
    expect(resolveAgentProjectId({ payloadProjectId: '   ', externalProjectId: undefined })).toBeNull();
    expect(resolveAgentProjectId({ payloadProjectId: null, externalProjectId: '' })).toBeNull();
  });
});

/* ======================== ② 落库内核：冲突零写入 ======================== */

describe('applyAgentPayload / previewAgentPayload：projectId 冲突 fail-closed', () => {
  it('query 与 payload 一致 → 正常写入', async () => {
    await seedProject('proj_a');
    const payload = makePayload('proj_a');
    const result = await applyAgentPayload(bundle, payload, { projectId: 'proj_a' });
    expect(result.rejected).toEqual([]);
    expect(await bundle.tasks.listByProject('proj_a')).toHaveLength(1);
  });

  it('两者不一致 → 抛 Validation，且**零写入**（证明两项目 tasks 仍为 0）', async () => {
    await seedProject('proj_a');
    await seedProject('proj_b');
    const payload = makePayload('proj_a'); // payload 写 proj_a

    let thrown: unknown;
    try {
      // external（query / opts）指向 proj_b —— 与 payload 冲突
      await applyAgentPayload(bundle, payload, { projectId: 'proj_b' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ChangxiaError);
    expect((thrown as ChangxiaError).code).toBe(ChangxiaErrorCode.Validation);
    expect((thrown as ChangxiaError).userMessage).toContain('query 与 payload 的 projectId 不一致');

    // 关键：没有任务被写进任何一个项目
    expect(await bundle.tasks.listByProject('proj_a')).toHaveLength(0);
    expect(await bundle.tasks.listByProject('proj_b')).toHaveLength(0);
  });

  it('preview（dryRun）冲突时同样抛错且零写入', async () => {
    await seedProject('proj_a');
    await seedProject('proj_b');
    const payload = makePayload('proj_a');
    let thrown: unknown;
    try {
      await previewAgentPayload(bundle, payload, { projectId: 'proj_b' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ChangxiaError);
    expect((thrown as ChangxiaError).code).toBe(ChangxiaErrorCode.Validation);
    expect(await bundle.tasks.listByProject('proj_a')).toHaveLength(0);
    expect(await bundle.tasks.listByProject('proj_b')).toHaveLength(0);
  });

  it('只有 payload 提供 → 正常写入', async () => {
    await seedProject('proj_a');
    const payload = makePayload('proj_a');
    const result = await applyAgentPayload(bundle, payload, {}); // 不传 opts.projectId
    expect(result.rejected).toEqual([]);
    expect(await bundle.tasks.listByProject('proj_a')).toHaveLength(1);
  });

  it('只有 external（opts）提供 → 正常写入', async () => {
    await seedProject('proj_a');
    const payload = makePayload(null); // payload 不带 projectId
    const result = await applyAgentPayload(bundle, payload, { projectId: 'proj_a' });
    expect(result.rejected).toEqual([]);
    expect(await bundle.tasks.listByProject('proj_a')).toHaveLength(1);
  });
});
