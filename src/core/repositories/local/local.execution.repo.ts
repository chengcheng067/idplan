import { ChangxiaError, ChangxiaErrorCode } from '../../types/enums';
import type {
  Execution,
  ExecutionAttempt,
  ExecutionEvent,
  WritebackProposal,
} from '../../types/entities';
import type {
  AppendExecutionEventCmd,
  CreateAttemptCmd,
  CreateExecutionCmd,
  CreateProposalCmd,
  IExecutionsRepository,
  UpdateAttemptCmd,
  UpdateExecutionStatusCmd,
  UpdateProposalCmd,
} from '../interfaces';
import { ExecutionStatus, WritebackProposalStatus, AttemptStatus } from '../../types/agent-execution';
import {
  assertAttemptTransition,
  assertExecutionConfirmed,
  assertStatusTransition,
  canStartAttempt,
  nextAttemptNo,
  nextSeq,
} from '../../execution/execution-state';
import type { ChangxiaDatabase } from './dexie.database';
import { pickDefined } from './local.projects.repo';

/**
 * 本地 Agent 执行域仓储（Dexie 适配器）。
 *
 * 与 local.itineraries.repo 同范式：全量装载策略下只需按 projectId / executionId 维度查询；
 * executionEvents 是 append-only 审计流水，本文件不提供任何 update/delete 入口。
 */
export class LocalExecutionsRepository implements IExecutionsRepository {
  constructor(private readonly db: ChangxiaDatabase) {}

  async createExecution(cmd: CreateExecutionCmd): Promise<Execution> {
    const now = new Date().toISOString();
    const row: Execution = {
      id: crypto.randomUUID(),
      projectId: cmd.projectId,
      taskId: cmd.taskId ?? null,
      source: cmd.source,
      objective: cmd.objective,
      agentMemberId: cmd.agentMemberId ?? null,
      channelKind: cmd.channelKind ?? null,
      inputSnapshotHash: cmd.inputSnapshotHash ?? null,
      status: ExecutionStatus.Draft,
      confirmation: null,
      idempotencyKey: cmd.idempotencyKey,
      currentAttemptNo: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      terminalReason: null,
      blockedReason: null,
    };
    try {
      await this.db.executions.add(row);
      return row;
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行单创建失败。', err);
    }
  }

  async getExecution(id: string): Promise<Execution | null> {
    try {
      return (await this.db.executions.get(id)) ?? null;
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行单读取失败。', err);
    }
  }

  async listExecutionsByProject(projectId: string): Promise<Execution[]> {
    try {
      const rows = await this.db.executions.where('projectId').equals(projectId).toArray();
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行单列表读取失败。', err);
    }
  }

  async updateExecutionStatus(id: string, cmd: UpdateExecutionStatusCmd): Promise<Execution> {
    try {
      // 读-校验-写三步放进单 rw 事务：状态机校验与落库原子化，防止并发穿透
      // （两个请求同时读到同一 current 并各自 put 会绕过相邻校验）。
      return await this.db.transaction('rw', this.db.executions, this.db.writebackProposals, async () => {
        const existing = await this.db.executions.get(id);
        if (!existing) {
          throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该执行单。');
        }
        // 存储边界强制状态机：读 current 后用同一事务内的提案集合校验 next。
        const proposals = await this.db.writebackProposals
          .where('executionId')
          .equals(id)
          .toArray();
        assertStatusTransition(existing, cmd.status, proposals);
        // 人工确认门槛：推进到 queued / running 前必须已确认。
        // 注意用「合并后」的确认快照：确认与入队常是同一步（cmd.confirmation 提供），
        // 旧行此时尚未带 confirmation，故以 cmd.confirmation ?? existing.confirmation 为准。
        const effectiveConfirmation =
          cmd.confirmation !== undefined ? cmd.confirmation : existing.confirmation;
        assertExecutionConfirmed(
          { id: existing.id, status: existing.status, confirmation: effectiveConfirmation },
          cmd.status,
        );

        const next: Execution = {
          ...existing,
          ...pickDefined(cmd),
          confirmation:
            cmd.confirmation !== undefined ? cmd.confirmation : existing.confirmation,
          updatedAt: new Date().toISOString(),
        };
        await this.db.executions.put(next);
        return next;
      });
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行单状态更新失败。', err);
    }
  }

  async appendEvent(cmd: AppendExecutionEventCmd): Promise<ExecutionEvent> {
    try {
      // 读-校验-写在单 rw 事务内：seq 单调校验与落库原子化，防止并发乱序穿透。
      return await this.db.transaction('rw', this.db.executionEvents, async () => {
        const events = await this.db.executionEvents
          .where('executionId')
          .equals(cmd.executionId)
          .toArray();
        const expectedSeq = nextSeq(events);
        // 严格单调：调用方必须传入 nextSeq（迟到 / 乱序 / 跳号一律拒绝）。
        // 选严格相等而非「> max」：seq 是审计流水的规范排序键，任何缺口都会让
        // 迟到回执的去重 / 排序语义模糊；乱序写应被拒而非被静默重编号。
        if (cmd.seq !== expectedSeq) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Validation,
            `执行事件 seq 非法：调用方传入 ${cmd.seq}，期望 ${expectedSeq}（execution=${cmd.executionId}）。`,
          );
        }
        const now = new Date().toISOString();
        const row: ExecutionEvent = {
          id: crypto.randomUUID(),
          executionId: cmd.executionId,
          attemptId: cmd.attemptId ?? null,
          seq: cmd.seq,
          type: cmd.type,
          actor: cmd.actor,
          fromStatus: cmd.fromStatus ?? null,
          toStatus: cmd.toStatus ?? null,
          reason: cmd.reason ?? null,
          idempotencyKey: cmd.idempotencyKey ?? null,
          createdAt: now,
        };
        await this.db.executionEvents.add(row);
        return row;
      });
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行事件写入失败。', err);
    }
  }

  async listEvents(executionId: string): Promise<ExecutionEvent[]> {
    try {
      const rows = await this.db.executionEvents
        .where('executionId')
        .equals(executionId)
        .toArray();
      return rows.sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行事件列表读取失败。', err);
    }
  }

  async createAttempt(cmd: CreateAttemptCmd): Promise<ExecutionAttempt> {
    try {
      // 读-校验-写在单 rw 事务内：canStartAttempt 与 attemptNo 单调在并发下闭合。
      return await this.db.transaction('rw', this.db.executionAttempts, async () => {
        const attempts = await this.db.executionAttempts
          .where('executionId')
          .equals(cmd.executionId)
          .toArray();
        // 同一 execution 同时最多一个非终态 attempt（并发穿透 / 调用方重复开活都拦下）。
        if (!canStartAttempt(attempts)) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Conflict,
            `执行单 ${cmd.executionId} 已存在非终态 attempt，不能新开 attempt。`,
          );
        }
        // attemptNo 由仓储统一计算（单调），调用方若显式传入则必须与计算值一致，
        // 否则抛错（防止调用方乱传导致号段错乱）。
        const computedNo = nextAttemptNo(attempts);
        if (cmd.attemptNo !== undefined && cmd.attemptNo !== computedNo) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Validation,
            `attemptNo 非法：调用方传入 ${cmd.attemptNo}，期望 ${computedNo}（execution=${cmd.executionId}）。`,
          );
        }
        const now = new Date().toISOString();
        const row: ExecutionAttempt = {
          id: crypto.randomUUID(),
          executionId: cmd.executionId,
          attemptNo: computedNo,
          status: cmd.status ?? 'queued',
          runtimeKind: cmd.runtimeKind ?? null,
          startedAt: cmd.startedAt ?? null,
          finishedAt: cmd.finishedAt ?? null,
          inputSnapshotHash: cmd.inputSnapshotHash ?? null,
          errorCode: null,
          errorSummary: null,
          terminalReason: null,
          createdAt: now,
          updatedAt: now,
        };
        await this.db.executionAttempts.add(row);
        return row;
      });
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行尝试创建失败。', err);
    }
  }

  async updateAttempt(id: string, cmd: UpdateAttemptCmd): Promise<ExecutionAttempt> {
    try {
      // 读-校验-写在单 rw 事务内闭合：attempt 状态机校验与落库原子化，防并发穿透。
      return await this.db.transaction('rw', this.db.executionAttempts, async () => {
        const existing = await this.db.executionAttempts.get(id);
        if (!existing) {
          throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该执行尝试。');
        }
        // attempt 状态机：未提供 status 时跳过校验；提供时校验合法邻接
        // （堵住把 failed / succeeded / interrupted 改回 running 从而绕过「单活 attempt」不变量）。
        if (cmd.status !== undefined) {
          assertAttemptTransition(existing.status, cmd.status);
        }
        const now = new Date().toISOString();
        const targetStatus = cmd.status ?? existing.status;
        const next: ExecutionAttempt = {
          ...existing,
          ...pickDefined(cmd),
          updatedAt: now,
        };
        // 进入终态（非 queued / running）时盖上 finishedAt（调用方没给就填当前时间，已落定则保留），审计需要。
        if (targetStatus !== AttemptStatus.Queued && targetStatus !== AttemptStatus.Running) {
          next.finishedAt = cmd.finishedAt ?? existing.finishedAt ?? now;
        }
        await this.db.executionAttempts.put(next);
        return next;
      });
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行尝试更新失败。', err);
    }
  }

  async listAttempts(executionId: string): Promise<ExecutionAttempt[]> {
    try {
      const rows = await this.db.executionAttempts
        .where('executionId')
        .equals(executionId)
        .toArray();
      return rows.sort((a, b) => a.attemptNo - b.attemptNo || a.id.localeCompare(b.id));
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行尝试列表读取失败。', err);
    }
  }

  async createProposal(cmd: CreateProposalCmd): Promise<WritebackProposal> {
    // 提案不允许在创建时就落成终态（applied / rejected）：审批事实必须经由 updateProposal 落定，
    // 否则「未经人工批准不得写回」的 P0 只是形状校验——调用方可直接造一个 applied 提案。
    if (
      cmd.status === WritebackProposalStatus.Applied ||
      cmd.status === WritebackProposalStatus.Rejected
    ) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `写回提案不允许直接创建为 ${cmd.status}：提案须先创建（draft / proposed）再经由审批落定。`,
      );
    }
    const now = new Date().toISOString();
    const row: WritebackProposal = {
      id: crypto.randomUUID(),
      executionId: cmd.executionId,
      attemptId: cmd.attemptId ?? null,
      projectId: cmd.projectId,
      taskId: cmd.taskId ?? null,
      operations: cmd.operations,
      status: cmd.status ?? WritebackProposalStatus.Draft,
      idempotencyKey: cmd.idempotencyKey,
      decidedBy: null,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.db.writebackProposals.add(row);
      return row;
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '写回提案创建失败。', err);
    }
  }

  async updateProposal(id: string, cmd: UpdateProposalCmd): Promise<WritebackProposal> {
    try {
      // 读-校验-写在单 rw 事务内闭合，与 updateExecutionStatus 同原子性要求。
      return await this.db.transaction('rw', this.db.writebackProposals, async () => {
        const existing = await this.db.writebackProposals.get(id);
        if (!existing) {
          throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该写回提案。');
        }
        // 已落定的提案（applied / rejected）不可再变更：堵住「审批后再换 operations」。
        if (
          existing.status === WritebackProposalStatus.Applied ||
          existing.status === WritebackProposalStatus.Rejected
        ) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Conflict,
            `写回提案已落定为 ${existing.status}，不可再变更（execution=${existing.executionId}）。`,
          );
        }
        const targetStatus = cmd.status ?? existing.status;
        const toTerminal =
          targetStatus === WritebackProposalStatus.Applied ||
          targetStatus === WritebackProposalStatus.Rejected;
        // 落定为终态（applied / rejected）时，审批事实必须成立：decidedBy 必填。
        if (toTerminal && !cmd.decidedBy) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Validation,
            `写回提案落定为 ${targetStatus} 必须由人工决策：decidedBy 必填（execution=${existing.executionId}）。`,
          );
        }
        const now = new Date().toISOString();
        const next: WritebackProposal = {
          ...existing,
          ...pickDefined(cmd),
          updatedAt: now,
        };
        // 落定时由仓储盖上 decidedAt（调用方没给就填当前时间，给了就以调用方为准）。
        if (toTerminal) {
          next.decidedBy = cmd.decidedBy!;
          next.decidedAt = cmd.decidedAt ?? now;
        }
        await this.db.writebackProposals.put(next);
        return next;
      });
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '写回提案更新失败。', err);
    }
  }

  async listProposals(executionId: string): Promise<WritebackProposal[]> {
    try {
    const rows = await this.db.writebackProposals
      .where('executionId')
      .equals(executionId)
      .toArray();
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '写回提案列表读取失败。', err);
    }
  }
}
