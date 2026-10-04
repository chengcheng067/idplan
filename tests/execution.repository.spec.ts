/**
 * Agent 执行域本地仓储（Dexie 适配器）单测（第一切片）。
 *
 * 锁死：
 *   1. createExecution：状态落 draft、currentAttemptNo=0、幂等键透传、id 生成；
 *   2. getExecution：命中 / 缺失（null）；
 *   3. listExecutionsByProject：只返回该 projectId 的执行单；
 *   4. updateExecutionStatus：只改传参与状态、保留其余字段；
 *   5. appendEvent / listEvents：append-only、按 seq 排序；
 *   6. createAttempt / listAttempts：按 attemptNo 排序；
 *   7. createProposal / updateProposal / listProposals：按 createdAt 排序、update 合并。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { ChangxiaError, ChangxiaErrorCode, ProjectStatus, ScheduleBasis } from '../src/core/types/enums';
import { ExecutionStatus, WritebackProposalStatus } from '../src/core/types/agent-execution';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport({
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      // ★ 2026-09-20 执行域归属关卡：`createExecution` / 提案的 projectId 必须指向
      //   `kind='agent'` 的项目（存储侧强制）。本 spec 的 p1/p2 是执行单宿主，
      //   故一律建成 Agent 看板（此前是幻影 id，现在会被关卡拒）。
      projects: [
        {
          id: 'p1',
          name: 'Agent 看板 p1',
          address: '',
          clientName: '',
          contractAmount: null,
          signedAt: null,
          plannedStartAt: '2026-08-01',
          plannedEndAt: '2026-12-31',
          coverColor: null,
          shortLabel: null,
          stagePresetKey: null,
          stageTemplateVersion: 0,
          scheduleBasis: ScheduleBasis.Calendar,
          domain: null,
          kind: 'agent',
          // v0.8.6 归属人（null = 公共板；这些 spec 不测归属）
          ownerMemberId: null,
          status: ProjectStatus.Active,
          revision: 1,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 'p2',
          name: 'Agent 看板 p2',
          address: '',
          clientName: '',
          contractAmount: null,
          signedAt: null,
          plannedStartAt: '2026-08-01',
          plannedEndAt: '2026-12-31',
          coverColor: null,
          shortLabel: null,
          stagePresetKey: null,
          stageTemplateVersion: 0,
          scheduleBasis: ScheduleBasis.Calendar,
          domain: null,
          kind: 'agent',
          // v0.8.6 归属人（null = 公共板；这些 spec 不测归属）
          ownerMemberId: null,
          status: ProjectStatus.Active,
          revision: 1,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      stages: [],
      tasks: [],
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
});

describe('Execution 主实体 CRUD + 过滤', () => {
  it('createExecution：draft 落库、currentAttemptNo=0、幂等键透传', async () => {
    const created = await bundle.executions.createExecution({
      projectId: 'p1',
      source: 'project-task',
      objective: '把任务 T-1 推到 done',
      taskId: 't1',
      idempotencyKey: 'exec:p1:t1',
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe(ExecutionStatus.Draft);
    expect(created.currentAttemptNo).toBe(0);
    expect(created.idempotencyKey).toBe('exec:p1:t1');
    expect(created.projectId).toBe('p1');

    const got = await bundle.executions.getExecution(created.id);
    expect(got?.id).toBe(created.id);
  });

  it('getExecution：缺失返回 null', async () => {
    expect(await bundle.executions.getExecution('nope')).toBeNull();
  });

  it('listExecutionsByProject：只返回该项目的执行单', async () => {
    await bundle.executions.createExecution({ projectId: 'p1', source: 'project-task', objective: 'a', idempotencyKey: 'k1' });
    await bundle.executions.createExecution({ projectId: 'p1', source: 'project-task', objective: 'b', idempotencyKey: 'k2' });
    await bundle.executions.createExecution({ projectId: 'p2', source: 'project-task', objective: 'c', idempotencyKey: 'k3' });

    const p1 = await bundle.executions.listExecutionsByProject('p1');
    expect(p1).toHaveLength(2);
    expect(p1.every((e) => e.projectId === 'p1')).toBe(true);
    const p2 = await bundle.executions.listExecutionsByProject('p2');
    expect(p2).toHaveLength(1);
  });

  it('updateExecutionStatus：只改传参与状态、保留其余字段', async () => {
    const created = await bundle.executions.createExecution({
      projectId: 'p1',
      source: 'project-task',
      objective: 'x',
      idempotencyKey: 'k',
    });
    // Draft → AwaitingConfirmation 是合法边（状态机在存储边界强制，非法边会被拒）。
    const updated = await bundle.executions.updateExecutionStatus(created.id, {
      status: ExecutionStatus.AwaitingConfirmation,
    });
    expect(updated.status).toBe(ExecutionStatus.AwaitingConfirmation);
    expect(updated.id).toBe(created.id);
    expect(updated.projectId).toBe('p1');
    expect(updated.objective).toBe('x');
    expect(updated.idempotencyKey).toBe('k');

    const reread = await bundle.executions.getExecution(created.id);
    expect(reread?.status).toBe(ExecutionStatus.AwaitingConfirmation);
  });
});

describe('ExecutionEvent（append-only 审计流水）', () => {
  it('appendEvent / listEvents：按 seq 排序、attemptId 可选', async () => {
    const exec = await bundle.executions.createExecution({ projectId: 'p1', source: 'project-task', objective: 'x', idempotencyKey: 'k' });
    // seq 必须严格单调（存储边界强制）；这里按 1,2,3 顺序写入。
    await bundle.executions.appendEvent({
      executionId: exec.id,
      attemptId: null,
      seq: 1,
      type: 'created',
      actor: 'user',
      fromStatus: null,
      toStatus: null,
      reason: null,
      idempotencyKey: null,
    });
    await bundle.executions.appendEvent({
      executionId: exec.id,
      attemptId: null,
      seq: 2,
      type: 'confirmation_granted',
      actor: 'user',
      fromStatus: null,
      toStatus: null,
      reason: null,
      idempotencyKey: null,
    });
    await bundle.executions.appendEvent({
      executionId: exec.id,
      attemptId: null,
      seq: 3,
      type: 'status_changed',
      actor: 'system',
      fromStatus: ExecutionStatus.Draft,
      toStatus: ExecutionStatus.AwaitingConfirmation,
      reason: null,
      idempotencyKey: null,
    });

    const events = await bundle.executions.listEvents(exec.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events[0]!.type).toBe('created');
    expect(events[0]!.actor).toBe('user');
  });
});

describe('ExecutionAttempt（每次实际执行新建一条）', () => {
  it('createAttempt / listAttempts：按 attemptNo 排序（attemptNo 由仓储计算）', async () => {
    const exec = await bundle.executions.createExecution({ projectId: 'p1', source: 'project-task', objective: 'x', idempotencyKey: 'k' });
    // 不传 attemptNo：仓储按 nextAttemptNo 单调分配（1, 2）。
    // 注意「同一 execution 同时最多一个非终态 attempt」：a1 直接落终态，a2 保持非终态。
    const a1 = await bundle.executions.createAttempt({ executionId: exec.id, status: 'succeeded' });
    const a2 = await bundle.executions.createAttempt({ executionId: exec.id, status: 'queued' });

    const attempts = await bundle.executions.listAttempts(exec.id);
    expect(attempts.map((a) => a.attemptNo)).toEqual([1, 2]);
    expect(attempts[0]!.id).toBe(a1.id);
    // 更新 attempt：queued → running 是合法边（终态 attempt 不允许再转出，见 execution-enforcement.spec.ts）
    const updated = await bundle.executions.updateAttempt(a2.id, { status: 'running', errorCode: 'e1' });
    expect(updated.status).toBe('running');
    expect(updated.errorCode).toBe('e1');
  });

  it('createAttempt：非法 status → Validation，且**一行都不落**', async () => {
    // 缺口 1 的本地侧：修复前 `status: cmd.status ?? 'queued'` 直接把任意值落库，
    // 非法值会绕过 `ATTEMPT_NON_TERMINAL_STATUSES.includes()` 的判定（详见
    // `tests/server.executions.spec.ts` 同名用例的说明与 `ATTEMPT_STATUSES` 注释）。
    const exec = await bundle.executions.createExecution({ projectId: 'p1', source: 'project-task', objective: 'x', idempotencyKey: 'k' });
    const err = await bundle.executions
      .createAttempt({ executionId: exec.id, status: 'not-a-status' as never })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);
    expect((err as ChangxiaError).userMessage).toContain('not-a-status');

    // ★ 「拒绝了」不等于「什么都没写」：本地侧尤其要查，因为 Dexie 没有外键兜底
    expect(await bundle.executions.listAttempts(exec.id)).toHaveLength(0);
  });

  it('createAttempt：六个合法值逐个放行，其余拒绝（与远端逐值同款）', async () => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    const payloads = [
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
      'QUEUED',
      'Queued',
      'done',
      'complete',
      'canceled', // 美式拼写：不是枚举值（枚举是双 l 的 cancelled）
      'queued ',
    ];
    for (const [i, s] of payloads.entries()) {
      const exec = await bundle.executions.createExecution({
        projectId: 'p1',
        source: 'project-task',
        objective: `x${i}`,
        idempotencyKey: `k${i}`,
      });
      const res = await bundle.executions
        .createAttempt({ executionId: exec.id, status: s as never })
        .then(() => 'ok')
        .catch(() => 'rejected');
      if (res === 'ok') accepted.push(s);
      else rejected.push(s);
    }
    expect(accepted).toEqual([
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
    ]);
    expect(rejected).toEqual(['QUEUED', 'Queued', 'done', 'complete', 'canceled', 'queued ']);
  });

  it('createAttempt：父 execution 不存在 → NotFound（不是 Storage）', async () => {
    // 本地 Dexie 没有外键，这条检查是本地侧**唯一**的孤儿防线；
    // 服务端侧由 `execution_attempts.execution_id REFERENCES executions(id)` 兜底，
    // 但两端都必须把「父不存在」翻译成同一个码 NotFound（否则远端 500 → 客户端 Network）。
    const err = await bundle.executions
      .createAttempt({ executionId: 'exec_not_exist' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.NotFound);
  });

  it('appendEvent：父 execution 不存在 → NotFound，且不落任何事件', async () => {
    const err = await bundle.executions
      .appendEvent({ executionId: 'exec_not_exist', seq: 1, type: 'created', actor: 'user' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.NotFound);
    expect(await bundle.executions.listEvents('exec_not_exist')).toHaveLength(0);
  });

  it('createProposal：父 execution 不存在 → NotFound，且不落任何提案', async () => {
    const err = await bundle.executions
      .createProposal({
        executionId: 'exec_not_exist',
        projectId: 'p1',
        operations: [],
        idempotencyKey: 'wb:orphan',
      })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.NotFound);
    expect(await bundle.executions.listProposals('exec_not_exist')).toHaveLength(0);
  });

  it('appendEvent / createProposal：父存在时照常成功（确认没过度收紧）', async () => {
    const exec = await bundle.executions.createExecution({ projectId: 'p1', source: 'project-task', objective: 'x', idempotencyKey: 'k' });
    const ev = await bundle.executions.appendEvent({
      executionId: exec.id,
      seq: 1,
      type: 'created',
      actor: 'user',
    });
    expect(ev.seq).toBe(1);
    const pr = await bundle.executions.createProposal({
      executionId: exec.id,
      projectId: 'p1',
      operations: [],
      idempotencyKey: 'wb:ok',
    });
    expect(pr.status).toBe(WritebackProposalStatus.Draft);
  });
});

describe('WritebackProposal（字段级写回提案）', () => {
  it('createProposal / updateProposal / listProposals：合并更新、按 createdAt 排序', async () => {
    const exec = await bundle.executions.createExecution({ projectId: 'p1', source: 'project-task', objective: 'x', idempotencyKey: 'k' });
    const p1 = await bundle.executions.createProposal({
      executionId: exec.id,
      projectId: 'p1',
      taskId: 't1',
      operations: [{ field: 'task.status', before: 'review', after: 'done' }],
      idempotencyKey: 'wb:p1:t1:task.status',
    });
    expect(p1.status).toBe(WritebackProposalStatus.Draft);

    const updated = await bundle.executions.updateProposal(p1.id, {
      status: WritebackProposalStatus.Applied,
      decidedBy: 'u1',
    });
    expect(updated.status).toBe(WritebackProposalStatus.Applied);
    expect(updated.decidedBy).toBe('u1');
    // operations 不传 → 保留原值
    expect(updated.operations).toHaveLength(1);

    const proposals = await bundle.executions.listProposals(exec.id);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.status).toBe(WritebackProposalStatus.Applied);
  });
});

/**
 * 审计补齐（原缺口 1 的**同源排查**，两处都实测确认过）：
 *   · `createExecution` 的 `source`——本地侧原先**不校验**（远端路由层拦），
 *     实测是一处**两端分歧**：`source='whatever'` 本地落库、远端 400；
 *   · `createProposal` 的 `status`——两端**都**不校验（`status='ghost'` 都落库）。
 */
describe('审计补齐：source 与 proposal status 的值域校验', () => {
  it('createExecution：非法 source → Validation（修复前的两端分歧）', async () => {
    for (const s of ['whatever', '', 'PROJECT-TASK']) {
      const err = await bundle.executions
        .createExecution({
          projectId: 'p1',
          source: s as never,
          objective: 'x',
          idempotencyKey: `k-${s}`,
        })
        .then(() => null)
        .catch((e: unknown) => e);
      expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);
    }
    // 四个合法来源逐个放行
    for (const [i, s] of ['project-task', 'natural-language', 'external', 'template'].entries()) {
      const e = await bundle.executions.createExecution({
        projectId: 'p1',
        source: s as never,
        objective: 'x',
        idempotencyKey: `ok-${i}`,
      });
      expect(e.source).toBe(s);
    }
    expect(await bundle.executions.listExecutionsByProject('p1')).toHaveLength(4);
  });

  it('createProposal：非法 status → Validation，且一行不落', async () => {
    const exec = await bundle.executions.createExecution({
      projectId: 'p1',
      source: 'project-task',
      objective: 'x',
      idempotencyKey: 'k',
    });
    for (const s of ['ghost', 'DRAFT', 'done', '']) {
      const err = await bundle.executions
        .createProposal({
          executionId: exec.id,
          projectId: 'p1',
          operations: [],
          idempotencyKey: `wb-${s}`,
          status: s as never,
        })
        .then(() => null)
        .catch((e: unknown) => e);
      expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);
    }
    expect(await bundle.executions.listProposals(exec.id)).toHaveLength(0);

    // draft / proposed / conflict 放行；applied / rejected 仍被既有 P0 拒
    for (const [i, s] of ['draft', 'proposed', 'conflict'].entries()) {
      const p = await bundle.executions.createProposal({
        executionId: exec.id,
        projectId: 'p1',
        operations: [],
        idempotencyKey: `wb-ok-${i}`,
        status: s as never,
      });
      expect(p.status).toBe(s);
    }
    for (const s of ['applied', 'rejected']) {
      const err = await bundle.executions
        .createProposal({
          executionId: exec.id,
          projectId: 'p1',
          operations: [],
          idempotencyKey: `wb-p0-${s}`,
          status: s as never,
        })
        .then(() => null)
        .catch((e: unknown) => e);
      expect((err as ChangxiaError | null)?.code).toBe(ChangxiaErrorCode.Validation);
    }
    expect(await bundle.executions.listProposals(exec.id)).toHaveLength(3);
  });
});
