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
import {
  ATTEMPT_STATUSES,
  AttemptStatus,
  EXECUTION_SOURCES,
  ExecutionStatus,
  WRITEBACK_PROPOSAL_STATUSES,
  WritebackProposalStatus,
} from '../../types/agent-execution';
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
    // ★ 审计补齐（原缺口 1 的同源排查）：`source` 此前**本地侧不校验**，
    //   而远端侧由路由层 `EXECUTION_SOURCES.includes(source)` 拦住 ——
    //   实测确认这是一处**两端分歧**：本地 `source='whatever'` 落库、远端 400。
    //   分歧比「两端一致地不完整」更坏，故在本地侧补上（**逐字同款**的判定与文案）。
    if (!EXECUTION_SOURCES.includes(cmd.source)) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `字段 source 非法：${String(cmd.source)}；合法值为 ${EXECUTION_SOURCES.join(' / ')}。`,
      );
    }
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
      return await this.db.transaction(
        'rw',
        this.db.executions,
        this.db.writebackProposals,
        this.db.executionEvents,
        async () => {
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
        // 人工确认门槛（stale approval 收紧）：
        // 用「合并后」的确认快照校验——确认与入队常是同一步（cmd.confirmation 提供），
        // 旧行此时尚未带 confirmation，故以 cmd.confirmation ?? existing.confirmation 为准。
        // 合并后的快照要写回 execution 实体，故这里构造一份带 effectiveConfirmation 的副本给校验函数
        // （校验函数据此读 confirmation 并计算计划指纹，不影响 existing 其余字段）。
        const effectiveConfirmation =
          cmd.confirmation !== undefined ? cmd.confirmation : existing.confirmation;
        assertExecutionConfirmed(
          { ...existing, confirmation: effectiveConfirmation },
          cmd.status,
          { confirmationWrittenByCaller: cmd.confirmation !== undefined && cmd.confirmation !== null },
        );

        const next: Execution = {
          ...existing,
          ...pickDefined(cmd),
          confirmation:
            cmd.confirmation !== undefined ? cmd.confirmation : existing.confirmation,
          updatedAt: new Date().toISOString(),
        };
        await this.db.executions.put(next);

        // 审计：本次**成功写入了一个新确认对象** → 同事务内 append 一条 confirmation_granted。
        // 拒绝的写入在上方 assert 已抛错、不会走到这里；`null`（清空）不算「授予」，不落审计。
        if (cmd.confirmation !== undefined && cmd.confirmation !== null) {
          const events = await this.db.executionEvents
            .where('executionId')
            .equals(id)
            .toArray();
          await this.db.executionEvents.add({
            id: crypto.randomUUID(),
            executionId: id,
            attemptId: null,
            seq: nextSeq(events),
            type: 'confirmation_granted',
            actor: 'user',
            fromStatus: null,
            toStatus: null,
            reason: `确认已授予：planHash=${cmd.confirmation.planHash}；confirmedBy=${cmd.confirmation.confirmedBy}`,
            idempotencyKey: null,
            createdAt: new Date().toISOString(),
          });
        }
        return next;
      });
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行单状态更新失败。', err);
    }
  }

  async appendEvent(cmd: AppendExecutionEventCmd): Promise<ExecutionEvent> {
    try {
      // 读-校验-写在单 rw 事务内：父存在性 + seq 单调校验与落库原子化，防止并发乱序穿透。
      return await this.db.transaction(
        'rw',
        this.db.executions,
        this.db.executionEvents,
        async () => {
          // 父 execution 存在性 —— 与 `createAttempt` 同款、同语义（NotFound 而非 Storage）。
          // 服务端侧由外键拒掉孤儿行（`execution_events.execution_id REFERENCES executions(id)`），
          // 本地 Dexie 无外键，这条检查是本地侧**唯一**的孤儿防线；
          // 两端都必须在「入口」就把「父不存在」翻译成 NotFound，否则远端 500 → 客户端 Network，
          // 文案会指向「网络排查」而真因是父记录不存在。
          if (!(await this.db.executions.get(cmd.executionId))) {
            throw new ChangxiaError(
              ChangxiaErrorCode.NotFound,
              `未找到执行单 ${cmd.executionId}，不能追加事件。`,
            );
          }
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
        },
      );
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
    // 入参白名单：**必须早于任何 await / 事务**，这样非法 status 连一行都不落。
    // 与 `createProposal` 的「创建时不得为 applied/rejected」同位置、同理由。
    // 为什么这一步不能交给事务内部：事务里第一句就是读子表，读到一半才拒会留下
    // 「校验过了但库里已经动过」的错觉（虽然 Dexie 会回滚，但语义上校验属于入口）。
    // 与服务端 `sqlite.bundle.ts` 的 `createAttempt` 逐字同款（两端一致纪律）。
    if (cmd.status !== undefined && !ATTEMPT_STATUSES.includes(cmd.status)) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `attempt status 非法：${String(cmd.status)}；合法值为 ${ATTEMPT_STATUSES.join(' / ')}。`,
      );
    }
    try {
      // 读-校验-写在单 rw 事务内：父存在性 + canStartAttempt + attemptNo 单调在并发下闭合。
      // 父表读进事务是必须的：否则「查的时候还在、写的时候已被删」会留下孤儿 attempt。
      return await this.db.transaction(
        'rw',
        this.db.executions,
        this.db.executionAttempts,
        async () => {
          // 父 execution 存在性 —— 语义与**服务端外键**对齐：
          // 服务端 `execution_attempts.execution_id REFERENCES executions(id)` 会拒掉孤儿行，
          // 但那条错误对调用方毫无信息量；两端都把「父不存在」翻译成 NotFound（而不是 Storage）。
          // （本地 Dexie 没有外键，这条检查就是本地侧**唯一**的孤儿防线。）
          if (!(await this.db.executions.get(cmd.executionId))) {
            throw new ChangxiaError(
              ChangxiaErrorCode.NotFound,
              `未找到执行单 ${cmd.executionId}，不能为其新建 attempt。`,
            );
          }
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
            status: cmd.status ?? AttemptStatus.Queued,
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
        },
      );
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
    // ★ 审计补齐（原缺口 1 的同源排查）：`status` 此前**没有任何值域校验**（两端都没有）。
    //   实测（修复前）：`createProposal({status:'ghost'})` 在本地与远端**都**落库 ——
    //   注意这里是「两端一致地有缺口」，不是分歧；但缺口本身是真的：
    //   `updateProposal` 的两条检查（已落定不可变更 / 落定需 decidedBy）都**不是值域校验**，
    //   一个 `ghost` 提案两者都不触发 → 永久留存，界面按未知状态静默漏显。
    if (cmd.status !== undefined && !WRITEBACK_PROPOSAL_STATUSES.includes(cmd.status)) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `写回提案 status 非法：${String(cmd.status)}；合法值为 ${WRITEBACK_PROPOSAL_STATUSES.join(' / ')}。`,
      );
    }
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
    // 父存在性检查放在事务内（与 appendEvent / createAttempt 同款）：
    // 「查父 → 插子」必须在同一个事务里，否则查到之后父被删仍会留下孤儿提案。
    // ★ 只查 execution，**不查 attemptId** —— 理由见服务端 `sqlite.bundle.ts` 的同名注释：
    //   DDL 里 `writeback_proposals.attempt_id` 没有 REFERENCES、也没有任何读路径 JOIN 它，
    //   去查一个 DDL 明确不约束的东西属于**过度收紧**；那会让「提案挂在已被清理的 attempt 上」
    //   这种合法历史形态在真库上突然被拒，而两端判定还会因清理时序不同而分叉。
    try {
      return await this.db.transaction(
        'rw',
        this.db.executions,
        this.db.writebackProposals,
        async () => {
          if (!(await this.db.executions.get(cmd.executionId))) {
            throw new ChangxiaError(
              ChangxiaErrorCode.NotFound,
              `未找到执行单 ${cmd.executionId}，不能为其创建写回提案。`,
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
          await this.db.writebackProposals.add(row);
          return row;
        },
      );
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
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
