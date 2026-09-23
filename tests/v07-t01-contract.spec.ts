/**
 * T01 · 契约冻结验收（v0.7 · 设计文档 §2.4 / §3.1.1 / §10.2 裁定 A）。
 *
 * 锁的是「形状不漂移」，不是业务逻辑：
 *   R1 `stage` 四键恒定（mode / id / name / orderIndex），无论成功 / 全拒 / 无落点；
 *   R3 「无 impact」只能用**键不存在**表达 —— 故断言 `'impact' in stage === false`，
 *      **不用** `expect(stage.impact).toBeUndefined()`（对 `null` 也通过 = 恒真假绿）；
 *   R4 `id` 与 `mode` 自洽；`none` → `id:null` + `name:''` + `orderIndex:-1`（哨兵）；
 *   R5 `impact` 出现 ⟺ `mode ∈ {'planned','created'}`（正向白名单）；
 *   R6 未知 `mode` 必须可判定为未知，供消费方降级。
 *
 * 环境：fake-indexeddb + local 适配器；与其他 spec 同样走「空包清库重建」自隔离。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installFakeIndexedDB } from './setup';

import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { previewAgentPayload } from '../src/core/agent/payload.apply';
import {
  isKnownApplyStageMode,
  shouldShowImpact,
  getAgentImportChannel,
} from '../src/core/agent/transport.contract';
/**
 * ★ 组合根副作用导入（v0.7）。
 *
 * `transport.contract.ts` **不再**在模块顶层自动注册默认通道 —— 那句会强制它
 * `await import('../repositories/index')`，从而把实现层（Dexie / store 层）拖进
 * 服务端编译单元，使 `npm run typecheck:server` 9 条红（详见该文件头）。
 * 注册已搬到组合根 `src/di/agent-channel.ts`。
 *
 * 本文件下面那条 `expect(getAgentImportChannel()).not.toBeNull()` 依赖这个副作用，
 * 故此处显式导入组合根。语义比原来更准确：不是「import 契约文件就自动注册」，
 * 而是「**组合根被加载时会注册默认通道**」。
 */
import '../src/di/agent-channel';
import {
  AGENT_PAYLOAD_SCHEMA_ID,
  type AgentPayloadTask,
  type AgentPayloadV1,
} from '../src/core/types/agent-payload';
import type { Stage } from '../src/core/types/entities';
import { TaskStatus } from '../src/core/types/enums';
import type { BackupPackage } from '../src/core/types/dto';

let bundle: IRepositoryBundle;

beforeAll(() => {
  installFakeIndexedDB();
});

const emptyPackage = (): BackupPackage => ({
  meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-09-01T00:00:00.000Z' },
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

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // fake-indexeddb 同 module 实例共享同名库——空包清库重建，保证 spec 间零污染
  await bundle.admin?.replaceAllImport(emptyPackage());
});

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

/** 建项目；`withStages=false` 用于构造「无落点」场景 */
async function seedProject(withStages = true): Promise<string> {
  await bundle.projects.insert({
    id: 'proj_a',
    name: '契约冻结演练',
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-09-01',
    plannedEndAt: '2026-09-30',
    coverColor: null,
    // ★ 2026-09-24：归属门提到共享核心后，Agent 导入的合法落点必须显式 kind='agent'
    // （缺省按口径读作 human，会被 resolve() 的归属门拒绝——门该有的效果）。
    kind: 'agent',
  });
  if (withStages) {
    await bundle.stages.bulkInsert([makeStage('stg_v1', 1), makeStage('stg_v2', 2)]);
  }
  return 'proj_a';
}

function payloadTask(
  externalId: string,
  extra: Partial<AgentPayloadTask> = {},
): AgentPayloadTask {
  return {
    externalId,
    title: `任务 ${externalId}`,
    description: null,
    status: TaskStatus.Draft,
    assigneeAgentKind: null,
    assigneeHuman: null,
    dependsOnExternal: [],
    startAt: null,
    dueDate: null,
    artifacts: [],
    ...extra,
  };
}

function payloadOf(projectId: string, tasks: AgentPayloadTask[]): AgentPayloadV1 {
  return {
    schema: AGENT_PAYLOAD_SCHEMA_ID,
    projectId,
    stageId: null,
    producedBy: {
      actorKind: 'agent',
      agentKind: 'codex',
      agentName: 'Codex',
      runId: 'r1',
    },
    tasks,
  };
}

describe('T01 契约 · ApplyResult.stage（R1 四键恒定）', () => {
  it('有落点：键集合恒为 mode/id/name/orderIndex，且 ApplyResult 恒为四键', async () => {
    const projectId = await seedProject();
    const res = await previewAgentPayload(
      bundle,
      payloadOf(projectId, [payloadTask('k:ok')]),
    );

    // ApplyResult 形状恒定：四个键，顺序不漂移（stage 在最后）
    expect(Object.keys(res)).toEqual(['created', 'updated', 'rejected', 'stage']);
    // R1：stage 四键恒定
    expect(Object.keys(res.stage)).toEqual(['mode', 'id', 'name', 'orderIndex']);
    expect(res.stage).toEqual({
      mode: 'existing',
      id: 'stg_v2', // 缺省 → 最后一个可见批次
      name: '批次2',
      orderIndex: 2,
    });
  });

  it('无落点（项目无可见批次）：mode=none + 哨兵形状，键集合同样四键', async () => {
    const projectId = await seedProject(false);
    const res = await previewAgentPayload(
      bundle,
      payloadOf(projectId, [payloadTask('k:x')]),
    );

    expect(Object.keys(res.stage)).toEqual(['mode', 'id', 'name', 'orderIndex']);
    expect(res.stage).toEqual({
      mode: 'none',
      id: null,
      name: '',
      orderIndex: -1, // 哨兵：不是笔误，仅 'none' 下出现
    });
    expect(res.created).toBe(0);
    expect(res.rejected[0]?.code).toBe('stage_limit');
  });

  it('整批拒绝（依赖环）：stage 仍是四键、落点信息不丢', async () => {
    const projectId = await seedProject();
    const res = await previewAgentPayload(
      bundle,
      payloadOf(projectId, [
        payloadTask('k:a', { dependsOnExternal: ['k:b'] }),
        payloadTask('k:b', { dependsOnExternal: ['k:a'] }),
      ]),
    );

    expect(Object.keys(res.stage)).toEqual(['mode', 'id', 'name', 'orderIndex']);
    expect(res.stage.mode).toBe('existing'); // 环命中时落点已解析，只是不写库
    expect(res.stage.id).toBe('stg_v2');
    expect(res.created).toBe(0);
  });
});

describe('T01 契约 · impact 只以「键不存在」表达（R3 / R5）', () => {
  // 每个 it 各自 seed：beforeEach 会清库重建，同一 it 内重复 seed 会撞主键
  it('existing 不带 impact 键（不是 null，是键不存在）', async () => {
    const projectId = await seedProject();
    const a = await previewAgentPayload(
      bundle,
      payloadOf(projectId, [payloadTask('k:1')]),
    );
    expect(a.stage.mode).toBe('existing');
    expect('impact' in a.stage).toBe(false);
  });

  it('none 同样不带 impact 键', async () => {
    const projectId = await seedProject(false);
    const b = await previewAgentPayload(
      bundle,
      payloadOf(projectId, [payloadTask('k:2')]),
    );
    expect(b.stage.mode).toBe('none');
    expect('impact' in b.stage).toBe(false);
  });

  it('R5 正向白名单：仅 planned / created 显示 impact', () => {
    expect(shouldShowImpact('planned')).toBe(true);
    expect(shouldShowImpact('created')).toBe(true);
    expect(shouldShowImpact('existing')).toBe(false);
    expect(shouldShowImpact('none')).toBe(false);
  });
});

describe('T01 契约 · R6 前向兼容（未知 mode 可判定）', () => {
  it('已知四值可判定；未知值判为 false 供消费方降级', () => {
    for (const m of ['existing', 'planned', 'created', 'none']) {
      expect(isKnownApplyStageMode(m)).toBe(true);
    }
    // 枚举未来扩张出的新值：不得崩溃，判定为未知 → 消费方降级为只显示 rejected[].reason
    expect(isKnownApplyStageMode('auto_created_v2')).toBe(false);
  });
});

describe('T01 契约 · 通道注册表默认实现（§2.5）', () => {
  it('默认注册 local-dexie 通道，status 不回传 token 原文', async () => {
    const ch = getAgentImportChannel();
    expect(ch).not.toBeNull();
    const st = await ch!.status();
    expect(st.kind).toBe('local-dexie');
    expect(st.hasToken).toBe(false); // ★ 只回布尔
    expect(st.baseUrl).toBeNull();
  });
});
