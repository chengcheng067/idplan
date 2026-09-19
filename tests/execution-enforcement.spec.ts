/**
 * Agent 执行域**存储边界强制层**单测（第一切片补强）。
 *
 * 目标：状态机不再是「只活在纯函数层」——`LocalExecutionsRepository` 的写路径
 * 必须在事务内闭合校验，且**拒绝时零写入**（不能只看抛没抛，必须断言库未变）。
 *
 * 覆盖（team-lead 验收清单）：
 *   1. updateExecutionStatus → completed（无 applied 提案）→ 抛错 + 行未变；
 *   2. 终态出边（cancelled → running / failed → completed）→ 抛错；
 *   3. 未确认时 → queued / → running → 抛错（确认门槛）；
 *   4. 连续两次 createAttempt({status:'running'}) → 第二次抛错 + 仅 1 条活 attempt；
 *   5. 调用方传入错误 attemptNo → 抛错；
 *   6. appendEvent 乱序 seq → 抛错 + 事件数未增。
 *   另含正向用例：条件齐备时 completed / queued→running 放行，证明门槛不误杀。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import {
  ExecutionStatus,
  WritebackProposalStatus,
  type ExecutionConfirmation,
} from '../src/core/types/agent-execution';
import { ChangxiaError, ChangxiaErrorCode } from '../src/core/types/enums';
import {
  assertExecutionConfirmed,
} from '../src/core/execution/execution-state';

let bundle: IRepositoryBundle;

const CONFIRMATION: ExecutionConfirmation = {
  confirmedAt: '2026-08-01T00:00:00.000Z',
  confirmedBy: 'u1',
  planHash: 'plan-hash-1',
  planRevision: 1,
};

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport({
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      projects: [],
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

async function newExecution(): Promise<string> {
  const created = await bundle.executions.createExecution({
    projectId: 'p1',
    source: 'project-task',
    objective: 'x',
    idempotencyKey: `exec:${Math.random()}`,
  });
  return created.id;
}

async function setStatus(id: string, status: ExecutionStatus, confirmation?: ExecutionConfirmation) {
  return bundle.executions.updateExecutionStatus(
    id,
    confirmation ? { status, confirmation } : { status },
  );
}

/** 合法推进到终态 cancelled */
async function toCancelled(id: string) {
  await setStatus(id, ExecutionStatus.AwaitingConfirmation);
  await setStatus(id, ExecutionStatus.Cancelled);
}

/** 合法推进到终态 failed（需先确认才能进 queued） */
async function toFailed(id: string) {
  await setStatus(id, ExecutionStatus.AwaitingConfirmation);
  await setStatus(id, ExecutionStatus.Queued, CONFIRMATION);
  await setStatus(id, ExecutionStatus.Failed);
}

/** 合法推进到 awaiting_review（completed 的前置态） */
async function toAwaitingReview(id: string) {
  await setStatus(id, ExecutionStatus.AwaitingConfirmation);
  await setStatus(id, ExecutionStatus.Queued, CONFIRMATION);
  await setStatus(id, ExecutionStatus.Running);
  await setStatus(id, ExecutionStatus.AwaitingReview);
}

describe('updateExecutionStatus：completed 强约束', () => {
  it('awaiting_review 无 applied 提案 → completed 抛错且行未变', async () => {
    const id = await newExecution();
    await toAwaitingReview(id);

    await expect(setStatus(id, ExecutionStatus.Completed)).rejects.toBeInstanceOf(ChangxiaError);

    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.AwaitingReview); // 零写入：状态未推进
  });

  it('awaiting_review 有 applied 提案 → completed 放行', async () => {
    const id = await newExecution();
    await toAwaitingReview(id);

    const proposal = await bundle.executions.createProposal({
      executionId: id,
      projectId: 'p1',
      taskId: 't1',
      operations: [{ field: 'task.status', before: 'review', after: 'done' }],
      idempotencyKey: `wb:${id}:t1:task.status`,
    });
    await bundle.executions.updateProposal(proposal.id, {
      status: WritebackProposalStatus.Applied,
      decidedBy: 'u1',
    });

    const updated = await setStatus(id, ExecutionStatus.Completed);
    expect(updated.status).toBe(ExecutionStatus.Completed);
    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.Completed);
  });
});

describe('updateExecutionStatus：终态出边一律拒绝', () => {
  it('cancelled → running 抛错（终态不可转移）', async () => {
    const id = await newExecution();
    await toCancelled(id);

    await expect(setStatus(id, ExecutionStatus.Running)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.Cancelled); // 零写入
  });

  it('failed → completed 抛错（终态不可转移）', async () => {
    const id = await newExecution();
    await toFailed(id);

    await expect(setStatus(id, ExecutionStatus.Completed)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.Failed); // 零写入
  });
});

describe('updateExecutionStatus：人工确认门槛（未确认绝不进入 queued/running）', () => {
  it('AwaitingConfirmation → queued 未带 confirmation → 抛错', async () => {
    const id = await newExecution();
    await setStatus(id, ExecutionStatus.AwaitingConfirmation); // 合法、无需确认

    // AwaitingConfirmation → Queued 本身是合法边，但确认门槛应拦下（无 confirmation）。
    await expect(setStatus(id, ExecutionStatus.Queued)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.AwaitingConfirmation); // 零写入
  });

  it('已确认：Queued(confirmation) → Running 放行（门槛不误杀合法路径）', async () => {
    const id = await newExecution();
    await setStatus(id, ExecutionStatus.AwaitingConfirmation);
    await setStatus(id, ExecutionStatus.Queued, CONFIRMATION); // 带确认进入 queued
    const updated = await setStatus(id, ExecutionStatus.Running); // 确认已就位 → 放行
    expect(updated.status).toBe(ExecutionStatus.Running);
  });

  it('纯函数 assertExecutionConfirmed：未确认 next=running 抛错、确认后放行', async () => {
    const base = {
      id: 'e1',
      status: ExecutionStatus.Queued,
      confirmation: null,
    };
    expect(() => assertExecutionConfirmed(base, ExecutionStatus.Running)).toThrow(ChangxiaError);
    expect(() => assertExecutionConfirmed(base, ExecutionStatus.Queued)).toThrow(ChangxiaError);
    // 确认快照齐备后不抛
    expect(() =>
      assertExecutionConfirmed(
        { ...base, confirmation: CONFIRMATION },
        ExecutionStatus.Running,
      ),
    ).not.toThrow();
    // 非 queued/running 的态不受门槛约束
    expect(() =>
      assertExecutionConfirmed(base, ExecutionStatus.Cancelled),
    ).not.toThrow();
  });
});

describe('createAttempt：单活 attempt + attemptNo 计算', () => {
  it('连续两次 createAttempt({status:"running"}) → 第二次抛错且只有 1 条活 attempt', async () => {
    const id = await newExecution();
    const first = await bundle.executions.createAttempt({ executionId: id, status: 'running' });
    expect(first.attemptNo).toBe(1);
    expect(first.status).toBe('running');

    await expect(
      bundle.executions.createAttempt({ executionId: id, status: 'running' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Conflict });

    const attempts = await bundle.executions.listAttempts(id);
    expect(attempts).toHaveLength(1); // 第二次零写入
    expect(attempts[0]!.status).toBe('running');
  });

  it('调用方传入错误 attemptNo（与计算值不一致）→ 抛错', async () => {
    const id = await newExecution();
    // 先放一条「终态」attempt，使下次可新开且计算值为 2。
    await bundle.executions.createAttempt({ executionId: id, status: 'succeeded' });

    await expect(
      bundle.executions.createAttempt({ executionId: id, attemptNo: 99, status: 'queued' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    const attempts = await bundle.executions.listAttempts(id);
    expect(attempts).toHaveLength(1); // 错误 attemptNo 未落库
  });

  it('不传 attemptNo 时由仓储单调分配', async () => {
    const id = await newExecution();
    const a1 = await bundle.executions.createAttempt({ executionId: id, status: 'succeeded' });
    const a2 = await bundle.executions.createAttempt({ executionId: id, status: 'running' });
    expect(a1.attemptNo).toBe(1);
    expect(a2.attemptNo).toBe(2);
  });
});

describe('appendEvent：seq 严格单调', () => {
  it('乱序 seq（期望 2 却传 3）→ 抛错且事件数未增', async () => {
    const id = await newExecution();
    await bundle.executions.appendEvent({
      executionId: id,
      attemptId: null,
      seq: 1,
      type: 'created',
      actor: 'user',
      fromStatus: null,
      toStatus: null,
      reason: null,
      idempotencyKey: null,
    });

    await expect(
      bundle.executions.appendEvent({
        executionId: id,
        attemptId: null,
        seq: 3, // 期望 2
        type: 'status_changed',
        actor: 'system',
        fromStatus: null,
        toStatus: null,
        reason: null,
        idempotencyKey: null,
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    const events = await bundle.executions.listEvents(id);
    expect(events).toHaveLength(1); // 乱序事件零写入
  });

  it('顺序 seq（1 → 2）正常落库', async () => {
    const id = await newExecution();
    await bundle.executions.appendEvent({
      executionId: id,
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
      executionId: id,
      attemptId: null,
      seq: 2,
      type: 'confirmation_granted',
      actor: 'user',
      fromStatus: null,
      toStatus: null,
      reason: null,
      idempotencyKey: null,
    });
    const events = await bundle.executions.listEvents(id);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });
});

/** 建一条 draft 写回提案（可选覆盖状态，用于验证「创建即终态」被拒） */
async function newProposal(executionId: string, status?: WritebackProposalStatus) {
  return bundle.executions.createProposal({
    executionId,
    projectId: 'p1',
    taskId: 't1',
    operations: [{ field: 'task.status', before: 'review', after: 'done' }],
    idempotencyKey: `wb:${executionId}:task.status`,
    ...(status ? { status } : {}),
  });
}

describe('写回提案：审批权威必须在数据上成立', () => {
  it('createProposal 不允许创建即 applied → 抛错且零写入', async () => {
    const id = await newExecution();
    await expect(newProposal(id, WritebackProposalStatus.Applied)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    expect(await bundle.executions.listProposals(id)).toHaveLength(0);
  });

  it('createProposal 不允许创建即 rejected → 抛错且零写入', async () => {
    const id = await newExecution();
    await expect(newProposal(id, WritebackProposalStatus.Rejected)).rejects.toMatchObject({
      code: ChangxiaErrorCode.Validation,
    });
    expect(await bundle.executions.listProposals(id)).toHaveLength(0);
  });

  it('落定 applied 缺 decidedBy → 抛错，状态与 decidedAt 均未变', async () => {
    const id = await newExecution();
    const p = await newProposal(id);

    await expect(
      bundle.executions.updateProposal(p.id, { status: WritebackProposalStatus.Applied }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    const rows = await bundle.executions.listProposals(id);
    expect(rows[0]!.status).toBe(WritebackProposalStatus.Draft); // 零写入
    expect(rows[0]!.decidedBy).toBeNull();
    expect(rows[0]!.decidedAt).toBeNull();
  });

  it('落定 applied 带 decidedBy → 放行且 decidedAt 由仓储盖上', async () => {
    const id = await newExecution();
    const p = await newProposal(id);

    const updated = await bundle.executions.updateProposal(p.id, {
      status: WritebackProposalStatus.Applied,
      decidedBy: 'u1',
    });
    expect(updated.status).toBe(WritebackProposalStatus.Applied);
    expect(updated.decidedBy).toBe('u1');
    expect(updated.decidedAt).toBeTruthy();
  });

  it('已 applied 的提案不可再改（含换 operations）→ Conflict 且内容未变', async () => {
    const id = await newExecution();
    const p = await newProposal(id);
    await bundle.executions.updateProposal(p.id, {
      status: WritebackProposalStatus.Applied,
      decidedBy: 'u1',
    });

    await expect(
      bundle.executions.updateProposal(p.id, {
        operations: [{ field: 'task.status', before: 'review', after: 'archived' }],
      }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Conflict });

    const rows = await bundle.executions.listProposals(id);
    expect(rows[0]!.operations[0]!.after).toBe('done'); // 审批后换内容被拦
    expect(rows[0]!.status).toBe(WritebackProposalStatus.Applied);
  });

  it('已 rejected 的提案不可再改状态 → Conflict', async () => {
    const id = await newExecution();
    const p = await newProposal(id);
    await bundle.executions.updateProposal(p.id, {
      status: WritebackProposalStatus.Rejected,
      decidedBy: 'u1',
    });

    await expect(
      bundle.executions.updateProposal(p.id, { status: WritebackProposalStatus.Applied, decidedBy: 'u2' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Conflict });

    const rows = await bundle.executions.listProposals(id);
    expect(rows[0]!.status).toBe(WritebackProposalStatus.Rejected);
  });

  it('draft → proposed 仍放行（合法路径不被误杀）', async () => {
    const id = await newExecution();
    const p = await newProposal(id);
    const updated = await bundle.executions.updateProposal(p.id, {
      status: WritebackProposalStatus.Proposed,
    });
    expect(updated.status).toBe(WritebackProposalStatus.Proposed);
    expect(updated.decidedAt).toBeNull(); // 未落定，不算审批
  });
});

describe('updateAttempt：attempt 状态机强制', () => {
  it('succeeded → running → 抛错且状态未变', async () => {
    const id = await newExecution();
    const a = await bundle.executions.createAttempt({ executionId: id, status: 'succeeded' });

    await expect(
      bundle.executions.updateAttempt(a.id, { status: 'running' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    const rows = await bundle.executions.listAttempts(id);
    expect(rows[0]!.status).toBe('succeeded'); // 终态不可复活
  });

  it('failed → running → 抛错且状态未变', async () => {
    const id = await newExecution();
    const a = await bundle.executions.createAttempt({ executionId: id, status: 'failed' });

    await expect(
      bundle.executions.updateAttempt(a.id, { status: 'running' }),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });

    expect((await bundle.executions.listAttempts(id))[0]!.status).toBe('failed');
  });

  it('queued → running 放行（合法边不被误杀）', async () => {
    const id = await newExecution();
    const a = await bundle.executions.createAttempt({ executionId: id, status: 'queued' });
    const updated = await bundle.executions.updateAttempt(a.id, { status: 'running' });
    expect(updated.status).toBe('running');
  });

  it('running → succeeded 放行且盖上 finishedAt', async () => {
    const id = await newExecution();
    const a = await bundle.executions.createAttempt({ executionId: id, status: 'running' });
    const updated = await bundle.executions.updateAttempt(a.id, { status: 'succeeded' });
    expect(updated.status).toBe('succeeded');
    expect(updated.finishedAt).toBeTruthy(); // 终态必须有结束时间
  });
});

describe('端到端：completed 的真实防线是「有审批人落定的 applied 提案」', () => {
  it('缺 decidedBy 的 applied 提案无法凑出 → 执行单停在待验收', async () => {
    const id = await newExecution();
    await toAwaitingReview(id);
    const p = await newProposal(id);

    // 1) 试图不带审批人直接落定 applied → 被拒（这就是本次新增的核心防线）
    await expect(
      bundle.executions.updateProposal(p.id, { status: WritebackProposalStatus.Applied }),
    ).rejects.toBeInstanceOf(ChangxiaError);
    // 2) 制造 applied 失败后，completed 前置仍不成立
    await expect(setStatus(id, ExecutionStatus.Completed)).rejects.toBeInstanceOf(ChangxiaError);

    const reread = await bundle.executions.getExecution(id);
    expect(reread?.status).toBe(ExecutionStatus.AwaitingReview); // 零写入，没假装完成
  });

  it('带审批人正常落定后 completed 可达（门槛不误杀合法路径）', async () => {
    const id = await newExecution();
    await toAwaitingReview(id);
    const p = await newProposal(id);
    await bundle.executions.updateProposal(p.id, {
      status: WritebackProposalStatus.Applied,
      decidedBy: 'u1',
    });

    const done = await setStatus(id, ExecutionStatus.Completed);
    expect(done.status).toBe(ExecutionStatus.Completed);
  });
});
