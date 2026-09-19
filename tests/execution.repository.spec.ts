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
