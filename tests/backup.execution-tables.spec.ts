/**
 * Agent 执行域四表备份往返（第一切片）。
 *
 * 锁死：
 *   1. 导出必然包含 executions / executionAttempts / executionEvents / writebackProposals；
 *   2. 带数据的四表：导出 → 清库 → 导入 → 再导出，逐表 JSON.stringify diff 为空（保真）；
 *   3. 旧备份（v1/v2/v3，完全没有这四张表）→ validateBackupJson 通过，
 *      且四表安全默认 []（不整包拒绝）；
 *   4. 不带四表的包导入后，DB 中四表为空（清库重建安全）。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { BackupService, validateBackupJson } from '../src/core/services/backup.service';
import type { BackupPackage } from '../src/core/types/dto';
import { ExecutionStatus, WritebackProposalStatus } from '../src/core/types/agent-execution';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport(emptyPackage());
});

function emptyPackage(): BackupPackage {
  return {
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
  };
}

function normalize(pkg: unknown): string {
  const p = JSON.parse(
    JSON.stringify(pkg, (key, value) => (key === 'exportedAt' ? undefined : value)),
  ) as BackupPackage;
  for (const key of Object.keys(p.data) as Array<keyof typeof p.data>) {
    p.data[key].sort((a: { id?: string; key?: string }, b: { id?: string; key?: string }) =>
      String(a.id ?? a.key ?? '').localeCompare(String(b.id ?? b.key ?? '')),
    );
  }
  return JSON.stringify(p);
}

describe('备份导出必然包含四张执行域表', () => {
  it('exportAll 产物 data 含 executions 等四表（即使为空数组）', async () => {
    const svc = new BackupService(bundle);
    const pkg = await svc.exportAll();
    expect(Array.isArray(pkg.data.executions)).toBe(true);
    expect(Array.isArray(pkg.data.executionAttempts)).toBe(true);
    expect(Array.isArray(pkg.data.executionEvents)).toBe(true);
    expect(Array.isArray(pkg.data.writebackProposals)).toBe(true);
  });
});

describe('带数据的四表往返保真', () => {
  it('执行单 + 尝试 + 事件 + 写回提案 → 导出 → 导入 → 再导出，逐表 diff 为空', async () => {
    // 建项目（让 execution 有个归属 projectId，验证过滤维度不串）
    await bundle.projects.insert({
      id: 'proj_exec',
      name: '执行域项目',
      type: 'dining' as never,
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-08-01',
      plannedEndAt: '2026-12-31',
      coverColor: null,
    });

    const exec = await bundle.executions.createExecution({
      projectId: 'proj_exec',
      source: 'project-task',
      objective: '把 T-1 推到 done',
      taskId: 't1',
      idempotencyKey: 'exec:project-task:proj_exec:t1',
    });
    // 走合法状态链（Draft → AwaitingConfirmation → Queued → Running），
    // 进入 Queued 前补齐人工确认快照（assertExecutionConfirmed 门槛）。
    await bundle.executions.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.AwaitingConfirmation,
    });
    await bundle.executions.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.Queued,
      confirmation: {
        confirmedAt: '2026-08-01T00:00:00.000Z',
        confirmedBy: 'u1',
        planHash: 'plan-hash-1',
        planRevision: 1,
      },
    });
    await bundle.executions.updateExecutionStatus(exec.id, { status: ExecutionStatus.Running });
    const attempt = await bundle.executions.createAttempt({
      executionId: exec.id,
      attemptNo: 1,
      status: 'succeeded',
    });
    await bundle.executions.appendEvent({
      executionId: exec.id,
      attemptId: attempt.id,
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
      attemptId: attempt.id,
      seq: 2,
      type: 'attempt_finished',
      actor: 'agent',
      fromStatus: null,
      toStatus: null,
      reason: null,
      idempotencyKey: null,
    });
    const proposal = await bundle.executions.createProposal({
      executionId: exec.id,
      attemptId: attempt.id,
      projectId: 'proj_exec',
      taskId: 't1',
      operations: [{ field: 'task.status', before: 'review', after: 'done' }],
      idempotencyKey: 'wb:exec_x:t1:task.status',
    });
    await bundle.executions.updateProposal(proposal.id, {
      status: WritebackProposalStatus.Applied,
      decidedBy: 'u1',
    });

    const svc = new BackupService(bundle);
    const exported1 = await svc.exportAll();
    // 四表都有数据
    expect(exported1.data.executions.length).toBeGreaterThan(0);
    expect(exported1.data.executionAttempts.length).toBeGreaterThan(0);
    expect(exported1.data.executionEvents.length).toBeGreaterThan(0);
    expect(exported1.data.writebackProposals.length).toBeGreaterThan(0);

    await svc.importAndReplace(exported1);
    const exported2 = await svc.exportAll();

    // 逐表保真（含四张执行域表）
    expect(normalize(exported2)).toBe(normalize(exported1));

    // 直接读 DB 行断言（不经由序列化）
    const reExec = await bundle.executions.getExecution(exec.id);
    expect(reExec?.status).toBe(ExecutionStatus.Running);
    const reAttempts = await bundle.executions.listAttempts(exec.id);
    expect(reAttempts).toHaveLength(1);
    const reEvents = await bundle.executions.listEvents(exec.id);
    expect(reEvents).toHaveLength(2);
    const reProposals = await bundle.executions.listProposals(exec.id);
    expect(reProposals[0]!.status).toBe(WritebackProposalStatus.Applied);
  });
});

describe('旧备份（无四表）兼容', () => {
  it('v3 老备份完全没有四张表 → 校验通过，四表安全默认 []（不整包拒绝）', () => {
    const legacyV3 = {
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
        // 故意不提供 executions / executionAttempts / executionEvents / writebackProposals
      },
    };
    expect(() => validateBackupJson(legacyV3)).not.toThrow();
    const parsed = validateBackupJson(legacyV3);
    expect(parsed.data.executions).toEqual([]);
    expect(parsed.data.executionAttempts).toEqual([]);
    expect(parsed.data.executionEvents).toEqual([]);
    expect(parsed.data.writebackProposals).toEqual([]);
  });

  it('v1 老备份无四表 → 同样安全默认 []', () => {
    const legacyV1 = {
      meta: { app: 'changxia', schemaVersion: 1, exportedAt: '2026-08-01T00:00:00.000Z' },
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
    };
    const parsed = validateBackupJson(legacyV1);
    expect(parsed.data.executions).toEqual([]);
    expect(parsed.data.executionEvents).toEqual([]);
  });

  it('不带四表的包导入后，DB 四表被清空重建（不残留旧行）', async () => {
    // 先写入一些执行域数据
    const exec = await bundle.executions.createExecution({
      projectId: 'p1',
      source: 'project-task',
      objective: 'x',
      idempotencyKey: 'k',
    });
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

    const svc = new BackupService(bundle);
    // 导入一个不带四表的空包
    await svc.importAndReplace({
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
      },
    });
    const after = await bundle.executions.listExecutionsByProject('p1');
    expect(after).toHaveLength(0);
    const events = await bundle.executions.listEvents(exec.id);
    expect(events).toHaveLength(0);
  });
});
