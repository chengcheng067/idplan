/**
 * Agent 导入通道注册表 —— **生产侧消费端**回归（v1.0 · P1-1）。
 *
 * ── 验的是什么 ──
 * `transport.contract.ts` 的 `registerAgentImportChannel / getAgentImportChannel`
 * 早在 v0.7 就落地了，但 `src/` 内**零生产消费者**：`useAgentStore` 的
 * `previewPayload` / `commitPayload` 一律直调 `payload.apply`。于是「换通道」没有
 * 统一落点 —— loopback / NAS 接进来后每处调用点要各自记得改一遍，必然漂移。
 * 本 spec 锁死「store 的两个写入口**确实读注册表**」这一事实。
 *
 * ── ★ 优先级规则（与 `useAgentStore.routeViaChannel` 的注释同源，勿分叉）──
 *   注入的 `repos` 对 `local-dexie` 保持权威；只有注册通道的 kind **不是**
 *   `local-dexie`（即需要真实传输的 `desktop-loopback` / `nas-http`）时，
 *   才把写入委托给通道。
 *   理由：`repos` 是本 store 的既有 DI 契约，若一律走注册表，注册表的
 *   `local-dexie` 通道会去开真 Dexie，等于推翻「可注入假仓储」的测试基线。
 *
 * ── 覆盖档位 ──
 *   ① 注册表为空（未注册）      → 走注入的 repos
 *   ② kind='nas-http'          → 走通道，本地 repos 不参与、零写入
 *   ③ kind='local-dexie'       → 仍走注入的 repos（真实落库）
 *   ④ 通道 status() 抛错        → 降级回本地分支（不把用户的导入吞掉）
 *   ⑤ preview 走通道时 dryRun=true 且零写入
 *   ⑥ commit  走通道时 dryRun=false
 *
 * ── 两条必须遵守的夹具纪律（踩过一次就会得到假绿）──
 *   a) **用例① 必须在文件里第一个跑**：注册表是模块级单例且**没有 unregister**，
 *      一旦注册过就回不到 `null`。所以「未注册」这一档只能靠执行顺序保证。
 *      （若将来给注册表加了 unregister，请把它改成显式复位，别再依赖顺序。）
 *   b) **每个用例前清空 fake-indexeddb**：同名库在 vitest 单文件内跨用例共享，
 *      不清库会让 ③ 建的任务把 ④ 的 `created=1` 顶成 `updated=1`，断言失去意义。
 *
 * ⚠️ 本 spec **不** import `src/di/agent-channel.ts` —— 那个组合根会懒开真 Dexie，
 *    与本 spec 的「注入仓储 / 假通道」语义正交，混进来只会让断言失去判别力。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installFakeIndexedDB } from './setup';

import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import {
  registerAgentImportChannel,
  type AgentChannelKind,
  type AgentChannelStatus,
  type AgentImportChannel,
} from '../src/core/agent/transport.contract';
import type { AgentPayloadV1, ApplyResult } from '../src/core/types/agent-payload';
import { TaskStatus } from '../src/core/types/enums';
import type { Stage } from '../src/core/types/entities';
import { useAgentStore } from '../src/store/useAgentStore';
import { emptyPackage } from './helpers/backup-fixture';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // 同名 fake-indexeddb 库在单文件内跨用例共享 —— 空包清库重建，保证零污染
  await bundle.admin?.replaceAllImport(emptyPackage());
  useAgentStore.setState({ previewResult: null });
});

/** 造一个带一个可见阶段的项目（固定 id 'proj_a'） */
async function seedProject(): Promise<string> {
  await bundle.projects.insert({
    id: 'proj_a',
    name: '通道注册表演练',
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
  await bundle.stages.bulkInsert([
    {
      id: 'stg_v1',
      projectId: 'proj_a',
      orderIndex: 1,
      templateKey: null,
      customColor: null,
      colorIndex: 1,
      name: '阶段一',
      ratioPercent: 10,
      startAt: '2026-09-01',
      endAt: '2026-09-10',
      status: 'not_started',
      ownerId: null,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-09-01T00:00:00.000Z',
    } as unknown as Stage,
  ]);
  return 'proj_a';
}

function makePayload(projectId: string): AgentPayloadV1 {
  return {
    schema: 'idplan-agent-payload/v1',
    projectId,
    stageId: null,
    producedBy: {
      actorKind: 'agent',
      agentKind: 'workbuddy',
      agentName: 'WorkBuddy 编排器',
      runId: 'run-routing-001',
    },
    tasks: [
      {
        externalId: 'workbuddy:run-routing-001:t1',
        title: '通道路由任务一',
        status: TaskStatus.Ready,
        dependsOnExternal: [],
        description: null,
        artifacts: [],
        startAt: null,
        dueDate: null,
        externalPath: null,
      },
    ],
  } as unknown as AgentPayloadV1;
}

/** 假通道：记录 `status()` / `import()` 调用，返回一个「零写入」回执 */
function fakeChannel(kind: AgentChannelKind, opts?: { statusThrows?: boolean }) {
  const status = vi.fn(async (): Promise<AgentChannelStatus> => {
    if (opts?.statusThrows) throw new Error('probe 失败（模拟通道未启动）');
    return {
      kind,
      reachable: true,
      baseUrl: kind === 'local-dexie' ? null : 'https://nas.example.com:7788',
      hasToken: false,
      lastSyncAt: null,
      lastSyncSummary: null,
    };
  });
  const importPayload = vi.fn(
    async (_payload: unknown, _o: unknown): Promise<ApplyResult> => ({
      created: 0,
      updated: 0,
      rejected: [],
      // R4 / 哨兵约定：mode='none' ⇒ id=null、name=''、orderIndex=-1
      stage: { mode: 'none', id: null, name: '', orderIndex: -1 },
    }),
  );
  const channel: AgentImportChannel = { status, probe: status, import: importPayload };
  registerAgentImportChannel(channel);
  return { status, importPayload };
}

describe('Agent 通道注册表 · 生产侧消费（useAgentStore 写入口）', () => {
  /* ★ 必须第一个跑：注册表无 unregister，注册过就回不到 null（见文件头纪律 a） */
  it('① 注册表为空（未注册）→ 走注入的 repos，真实落库', async () => {
    const projectId = await seedProject();

    const result = await useAgentStore
      .getState()
      .commitPayload(bundle, makePayload(projectId), projectId);

    expect(result?.created).toBe(1);
    expect(await bundle.tasks.listByProject(projectId)).toHaveLength(1);
  });

  it('② kind=nas-http → 写入委托给通道，注入的 repos 不参与、零写入', async () => {
    const projectId = await seedProject();
    const ch = fakeChannel('nas-http');

    const result = await useAgentStore
      .getState()
      .commitPayload(bundle, makePayload(projectId), projectId);

    expect(ch.importPayload).toHaveBeenCalledTimes(1);
    expect(result?.created).toBe(0); // 回执来自假通道，不是本地落库结果
    // ★ 本地仓储确实没被写
    expect(await bundle.tasks.listByProject(projectId)).toHaveLength(0);
  });

  it('③ kind=local-dexie → 仍走注入的 repos（真实落库），通道不被调用', async () => {
    const projectId = await seedProject();
    const ch = fakeChannel('local-dexie');

    const result = await useAgentStore
      .getState()
      .commitPayload(bundle, makePayload(projectId), projectId);

    expect(ch.importPayload).not.toHaveBeenCalled();
    expect(result?.created).toBe(1);
    expect(await bundle.tasks.listByProject(projectId)).toHaveLength(1);
  });

  it('④ 通道 status() 抛错 → 降级回本地分支，导入不被吞掉', async () => {
    const projectId = await seedProject();
    const ch = fakeChannel('nas-http', { statusThrows: true });

    const result = await useAgentStore
      .getState()
      .commitPayload(bundle, makePayload(projectId), projectId);

    expect(ch.importPayload).not.toHaveBeenCalled();
    expect(result?.created).toBe(1); // 降级后真实落库成功
  });

  it('⑤ previewPayload 同规则：nas-http 走通道且 dryRun=true、零写入', async () => {
    const projectId = await seedProject();
    const ch = fakeChannel('nas-http');

    await useAgentStore.getState().previewPayload(bundle, makePayload(projectId), projectId);

    expect(ch.importPayload).toHaveBeenCalledTimes(1);
    const opts = ch.importPayload.mock.calls[0]?.[1] as { dryRun: boolean };
    expect(opts.dryRun).toBe(true); // ★ 预览绝不能落库
    expect(await bundle.tasks.listByProject(projectId)).toHaveLength(0);
  });

  it('⑥ commit 走通道时 dryRun=false', async () => {
    const projectId = await seedProject();
    const ch = fakeChannel('nas-http');

    await useAgentStore.getState().commitPayload(bundle, makePayload(projectId), projectId);

    const opts = ch.importPayload.mock.calls[0]?.[1] as { dryRun: boolean };
    expect(opts.dryRun).toBe(false);
  });
});
