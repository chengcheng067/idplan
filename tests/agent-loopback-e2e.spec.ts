// @vitest-environment node
/**
 * Agent 接入 **端到端**（渲染层落库半程；2026-09-24 用户要求「自己测一下能不能接入、
 * 接入以后是什么效果」的测试化落地）。
 *
 * ══════════════════════ 覆盖到哪、没覆盖到哪（诚实标注） ══════════════════════
 * 覆盖：`handleAgentLoopbackMessage` 的**完整分发链**——建板 → 导入（含 dryRun
 *   预览对照）→ 读回，全部走与 IPC 转发端**逐字相同**的函数
 *   （runAgentCreateBoard / runAgentImport / runAgentListTasks），仓储用真
 *   fake-indexeddb。写入方视角的 HTTP 半程由 agent-loopback-server.spec.ts
 *   （真起 server、真 fetch）覆盖；两半合起来 = 除 OS 进程层外的全链路。
 * 未覆盖：OS 进程层（Electron 启动、IPC 管道）——那需要真窗口，由用户实机
 *   验证（本环境无交互式 GUI 启动能力，实测 unpacked 实例秒退）。
 *
 * ══════════════════════ 这条 spec 钉的「接入效果」 ══════════════════════
 * ① 建板：201 形状回执（projectId/name/stages 九段骨架）+ 库里真有一块 kind=agent；
 * ② 导入：dryRun 先预览（created 数与实写一致）→ 实写后任务在列、taskNo 连续、
 *    依赖按 externalId 解析成批内 Task.id；
 * ③ 读回：tasks 清单只含 Agent 看板、dependsOnExternal 反查回 externalId；
 * ④ 归属门：同一份 payload 打人类项目 → ProjectUnresolved、零写入（承诺=行为）。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import {
  handleAgentLoopbackMessage,
  type AgentCreateBoardRequest,
  type AgentListTasksRequest,
} from '../src/hooks/useAgentLoopbackReceiver';
// AgentImportRequest 是 vite-env.d.ts 的**全局**接口（不经 receiver 导出）
import { emptyPackage } from './helpers/backup-fixture';
import { ChangxiaErrorCode } from '../src/core/types/enums';

let bundle: IRepositoryBundle;
/** 渲染层「回传」收集器：等价于主进程收到的 agent:import-result */
const replies: Array<{ requestId: string; result?: unknown; error?: unknown }> = [];

async function send(req: AgentCreateBoardRequest | AgentImportRequest | AgentListTasksRequest) {
  replies.length = 0;
  await handleAgentLoopbackMessage({
    repos: bundle,
    req,
    sendImportResult: (r) => replies.push(r as never),
    sendPong: () => undefined,
  });
  return replies[0]!;
}

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport(emptyPackage());
});

describe('接入 E2E · 建板 → 导入 → 读回（写入方视角的完整一轮）', () => {
  const boardReq = (id: string): AgentCreateBoardRequest => ({
    requestId: id,
    kind: 'create-board',
    body: {
      name: 'WorkBuddy 接入自测板',
      plannedStartAt: '2026-10-01',
      plannedEndAt: '2026-10-31',
      presetKey: 'indoor_full',
    },
  });

  it('① 建板：回执 201 形状 + 库里真有一块 kind=agent 的板（九段骨架）', async () => {
    const r = await send(boardReq('req-board-1'));
    expect(r.error).toBeUndefined();
    const res = r.result as { projectId: string; name: string; stages: unknown[] };
    expect(res.name).toBe('WorkBuddy 接入自测板');
    expect(res.stages).toHaveLength(9); // indoor_full 套餐九段

    const project = await bundle.projects.get(res.projectId);
    expect(project?.kind).toBe('agent');
    const stages = await bundle.stages.listByProject(res.projectId);
    expect(stages).toHaveLength(9);
  });

  it('② 导入：dryRun 预览与实写 created 一致；任务在列、依赖解析成批内 Task.id', async () => {
    const board = (await send(boardReq('req-board-2'))).result as { projectId: string };

    const payload = {
      schema: 'idplan-agent-payload/v1',
      producedBy: { agentKind: 'workbuddy', agentName: 'WorkBuddy', runId: 'run-e2e-1' },
      tasks: [
        { externalId: 'wb:t1', title: '量房复尺', status: 'draft' },
        {
          externalId: 'wb:t2',
          title: '平面方案',
          status: 'draft',
          dependsOnExternal: ['wb:t1'],
        },
      ],
    };

    // 先预览（写入方的标准姿势：dryRun 看影响面再实写）
    const preview = await send({
      requestId: 'req-preview',
      kind: 'import' as never,
      dryRun: true,
      projectId: board.projectId,
      payload,
    } as unknown as AgentImportRequest);
    const pv = (preview.result as { created: number }).created;
    expect(pv).toBe(2);

    // 实写
    const applied = await send({
      requestId: 'req-apply',
      kind: 'import' as never,
      dryRun: false,
      projectId: board.projectId,
      payload,
    } as unknown as AgentImportRequest);
    const ar = applied.result as { created: number; rejected: unknown[] };
    expect(ar.created).toBe(pv); // 所见即所写（preview/apply 同 resolve）
    expect(ar.rejected).toEqual([]);

    const tasks = await bundle.tasks.listByProject(board.projectId);
    expect(tasks.map((t) => t.externalId).sort()).toEqual(['wb:t1', 'wb:t2']);
    // taskNo 由系统分配、**连续**（项目内号段起点由 task-no 规范定，不硬编码），
    // 不由写入方指定——写入方给号会被忽略（幂等键是 externalId）
    const nos = tasks.map((t) => t.taskNo).sort((a, b) => (a ?? 0) - (b ?? 0)) as number[];
    expect(nos[1] - nos[0]).toBe(1);
    // 依赖：payload 的 externalId → 批内真实 Task.id
    const t2 = tasks.find((t) => t.externalId === 'wb:t2')!;
    const t1 = tasks.find((t) => t.externalId === 'wb:t1')!;
    expect(t2.dependsOn).toEqual([t1.id]);
  });

  it('③ 读回：tasks 清单只含 Agent 看板；dependsOnExternal 反查回 externalId', async () => {
    const board = (await send(boardReq('req-board-3'))).result as { projectId: string };
    await send({
      requestId: 'req-apply-3',
      kind: 'import' as never,
      dryRun: false,
      projectId: board.projectId,
      payload: {
        schema: 'idplan-agent-payload/v1',
        producedBy: { agentKind: 'workbuddy', agentName: 'WorkBuddy', runId: 'run-e2e-1' },
        tasks: [
          { externalId: 'a', title: '甲', status: 'draft' },
          { externalId: 'b', title: '乙', status: 'draft', dependsOnExternal: ['a'] },
        ],
      },
    } as unknown as AgentImportRequest);

    const listed = await send({ requestId: 'req-list', kind: 'list-tasks' } as AgentListTasksRequest);
    const tasks = (listed.result as { tasks: Array<{ externalId: string; dependsOnExternal: string[] }> }).tasks;
    expect(tasks.map((t) => t.externalId).sort()).toEqual(['a', 'b']);
    expect(tasks.find((t) => t.externalId === 'b')!.dependsOnExternal).toEqual(['a']);

    // 显式 projectId 指向这块板 → 同内容
    const scoped = await send({
      requestId: 'req-list-scoped',
      kind: 'list-tasks',
      projectId: board.projectId,
    } as AgentListTasksRequest);
    expect((scoped.result as { tasks: unknown[] }).tasks).toHaveLength(2);
  });

  it('④ 归属门：同一份 payload 打人类项目 → ProjectUnresolved 且零写入（承诺=行为）', async () => {
    // 建一块人类项目作靶子
    await bundle.projects.insert({
      id: 'proj_human_e2e',
      name: '人类项目靶子',
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-10-01',
      plannedEndAt: '2026-10-31',
      coverColor: null,
      kind: 'human',
    } as never);

    const r = await send({
      requestId: 'req-human',
      kind: 'import' as never,
      dryRun: false,
      projectId: 'proj_human_e2e',
      payload: {
        schema: 'idplan-agent-payload/v1',
        producedBy: { agentKind: 'workbuddy', agentName: 'WorkBuddy', runId: 'run-e2e-1' },
        tasks: [{ externalId: 'x', title: '不该落库', status: 'draft' }],
      },
    } as unknown as AgentImportRequest);

    const err = r.error as { code: string; userMessage: string };
    expect(err.code).toBe(ChangxiaErrorCode.ProjectUnresolved);
    expect(err.userMessage).toContain('不是 Agent 看板');
    expect(await bundle.tasks.listByProject('proj_human_e2e')).toEqual([]);

    // 读侧同门：显式人类项目 id → 同码拒绝
    const listed = await send({
      requestId: 'req-list-human',
      kind: 'list-tasks',
      projectId: 'proj_human_e2e',
    } as AgentListTasksRequest);
    expect((listed.error as { code: string }).code).toBe(ChangxiaErrorCode.ProjectUnresolved);
  });
});
