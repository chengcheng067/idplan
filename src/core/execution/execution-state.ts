/**
 * 执行域状态机（纯函数，零副作用、零 DOM / 零 Node 专属 API）。
 *
 * 与 `src/core/execution/**` 同级，随前端 tsconfig 编译；保持纯净以便将来服务端复用。
 *
 * 状态机设计要点（来自规格评审 §3）：
 *   - 状态转移用**显式邻接表**，不靠穷举 switch；新增状态只改一处。
 *   - 取消支持**二段**：`cancel_requested` 是**事件**而非状态，最终由 `cancelled` 收口
 *     （迟到的 cancel_requested 在终态下被拒，永不改写终态）。
 *   - `awaiting_review` 不允许回 `running`：重试必须新建 attempt 后从
 *     `needs_attention` / `queued` 重新进入。
 *   - `completed` 只能从 `awaiting_review` 且**存在 applied 的 WritebackProposal** 才允许
 *     （执行成功 ≠ 业务完成，只有写回成功才进完成态）。
 */

import { ChangxiaError, ChangxiaErrorCode } from '../types/enums';
import {
  ATTEMPT_NON_TERMINAL_STATUSES,
  AttemptStatus,
  type Execution,
  ExecutionStatus,
  type ExecutionAttempt,
  type ExecutionEvent,
  type WritebackProposal,
  WritebackProposalStatus,
} from '../types/agent-execution';

/**
 * 执行状态邻接表（显式，覆盖全部合法边）。
 * 终态（completed / failed / cancelled）出边为空。
 */
export const EXECUTION_TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  [ExecutionStatus.Draft]: [ExecutionStatus.AwaitingConfirmation, ExecutionStatus.Cancelled],
  [ExecutionStatus.AwaitingConfirmation]: [
    ExecutionStatus.Queued,
    ExecutionStatus.Draft,
    ExecutionStatus.Cancelled,
  ],
  [ExecutionStatus.Queued]: [
    ExecutionStatus.Running,
    ExecutionStatus.Cancelled,
    ExecutionStatus.Failed,
  ],
  [ExecutionStatus.Running]: [
    ExecutionStatus.Paused,
    ExecutionStatus.NeedsAttention,
    ExecutionStatus.AwaitingReview,
    ExecutionStatus.Failed,
    ExecutionStatus.Cancelled,
  ],
  [ExecutionStatus.Paused]: [ExecutionStatus.Running, ExecutionStatus.Cancelled],
  [ExecutionStatus.NeedsAttention]: [
    ExecutionStatus.Running,
    ExecutionStatus.Cancelled,
    ExecutionStatus.Failed,
  ],
  [ExecutionStatus.AwaitingReview]: [
    ExecutionStatus.Completed,
    ExecutionStatus.NeedsAttention,
    ExecutionStatus.Cancelled,
  ],
  [ExecutionStatus.Completed]: [],
  [ExecutionStatus.Failed]: [],
  [ExecutionStatus.Cancelled]: [],
};

/** 终态集合（出边为空） */
export function isTerminal(status: ExecutionStatus): boolean {
  return EXECUTION_TRANSITIONS[status].length === 0;
}

/** 判断 from → to 是否为合法转移（终态一律不可转移） */
export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  if (isTerminal(from)) return false;
  return EXECUTION_TRANSITIONS[from].includes(to);
}

/**
 * 断言 from → to 合法，非法抛出 ChangxiaError（错误信息包含 from/to，便于定位）。
 */
export function assertTransition(from: ExecutionStatus, to: ExecutionStatus): void {
  if (!canTransition(from, to)) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      `非法的执行状态转移：${from} → ${to}`,
    );
  }
}

/**
 * 执行尝试（Attempt）状态邻接表（显式）。
 *
 * 设计（与 Execution 同范式，但更短）：
 *   - queued 是「已入队未启动」，可启动(running) / 取消(cancelled) / 未启动即失败(failed)；
 *   - running 是「执行中」，可成功(succeeded) / 失败(failed) / 取消(cancelled) / 中断(interrupted)；
 *   - succeeded / failed / cancelled / interrupted 是终态，出边为空。
 *
 * 为什么没有 `queued → interrupted`：interrupted 语义上是「对**正在运行**的 attempt 的抢占/
 * 打断」（应用崩溃、用户强杀、调度撤回），一个从未启动(queued)的 attempt 被「打断」没有意义；
 * 未启动的 attempt 走 cancelled / failed。故不引入该边。
 */
export const ATTEMPT_TRANSITIONS: Record<AttemptStatus, readonly AttemptStatus[]> = {
  [AttemptStatus.Queued]: [
    AttemptStatus.Running,
    AttemptStatus.Cancelled,
    AttemptStatus.Failed,
  ],
  [AttemptStatus.Running]: [
    AttemptStatus.Succeeded,
    AttemptStatus.Failed,
    AttemptStatus.Cancelled,
    AttemptStatus.Interrupted,
  ],
  [AttemptStatus.Succeeded]: [],
  [AttemptStatus.Failed]: [],
  [AttemptStatus.Cancelled]: [],
  [AttemptStatus.Interrupted]: [],
};

/** Attempt 终态集合（出边为空），与 ATTEMPT_NON_TERMINAL_STATUSES 互补 */
export function isAttemptTerminal(status: AttemptStatus): boolean {
  return ATTEMPT_TRANSITIONS[status].length === 0;
}

/** 判断 from → to 是否为合法 Attempt 转移（终态一律不可转移） */
export function canAttemptTransition(from: AttemptStatus, to: AttemptStatus): boolean {
  if (isAttemptTerminal(from)) return false;
  return ATTEMPT_TRANSITIONS[from].includes(to);
}

/** 断言 Attempt 转移合法，非法抛 ChangxiaError（含 from/to） */
export function assertAttemptTransition(from: AttemptStatus, to: AttemptStatus): void {
  if (!canAttemptTransition(from, to)) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      `非法的执行尝试状态转移：${from} → ${to}`,
    );
  }
}

/**
 * 判断某 execution 是否允许进入 completed 态。
 *
 * 判据（规格 §3 / QA 门槛）：
 *   1. 当前必须处于 `awaiting_review`（其余态一律拒绝）；
 *   2. 必须存在至少一个针对本 execution、status === 'applied' 的 WritebackProposal。
 *
 * 返回 `{ ok, reason? }` 而非直接抛错——调用方据以决定拒绝文案与日志。
 */
export function canComplete(
  execution: Pick<Execution, 'id' | 'status'>,
  proposals: readonly WritebackProposal[],
): { ok: boolean; reason?: string } {
  if (execution.status !== ExecutionStatus.AwaitingReview) {
    return {
      ok: false,
      reason: `完成要求 execution 处于 awaiting_review 态（当前为 ${execution.status}）`,
    };
  }
  // 「applied」还不够：必须由人工决策落定（decidedBy 非空）。否则「未经人工批准不得写回」
  // 的 P0 只是形状校验——任何调用方都能凭空造一个 applied 提案。审批事实必须在数据上成立。
  const hasApplied = proposals.some(
    (p) =>
      p.executionId === execution.id &&
      p.status === WritebackProposalStatus.Applied &&
      !!p.decidedBy,
  );
  if (!hasApplied) {
    return {
      ok: false,
      reason: '完成要求存在由人工决策（decidedBy 非空）的 applied 写回提案（执行成功不等于业务完成）',
    };
  }
  return { ok: true };
}

/**
 * 判断是否可以**新开**一个 attempt。
 * 同一 execution 同时最多一个非终态 attempt（queued / running）。
 */
export function canStartAttempt(attempts: readonly ExecutionAttempt[]): boolean {
  return !attempts.some((a) => ATTEMPT_NON_TERMINAL_STATUSES.includes(a.status));
}

/** 下一个 attempt 编号（单调递增，从 1 开始） */
export function nextAttemptNo(attempts: readonly ExecutionAttempt[]): number {
  if (attempts.length === 0) return 1;
  return Math.max(...attempts.map((a) => a.attemptNo)) + 1;
}

/**
 * 下一个事件 seq（同一 execution 内单调递增，从 1 开始）。
 * append-only：seq 一经分配不可变，用于迟到回执的排序与去重。
 */
export function nextSeq(events: readonly ExecutionEvent[]): number {
  if (events.length === 0) return 1;
  return Math.max(...events.map((e) => e.seq)) + 1;
}

/**
 * 状态机合并校验入口（存储边界调用，不可绕过）。
 *
 * 组合两层校验：
 *   1. `assertTransition(current.status, next)` —— 邻接表合法性（终态一律拒出边）；
 *   2. 当 `next === 'completed'` 时再走 `canComplete(current, proposals)`，
 *      要求存在 applied 写回提案，否则抛错（错误信息含 from / to 与拒绝原因）。
 *
 * 错误信息必须同时携带 from→to 与拒绝原因，方便定位与上游文案生成。
 */
export function assertStatusTransition(
  current: Pick<Execution, 'id' | 'status'>,
  next: ExecutionStatus,
  proposals: readonly WritebackProposal[],
): void {
  // 先校验邻接表合法性（终态出边在这里直接被拒）。
  assertTransition(current.status, next);
  // completed 是强约束态：只有「awaiting_review + 存在 applied 提案」才放行。
  if (next === ExecutionStatus.Completed) {
    const result = canComplete(current, proposals);
    if (!result.ok) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `非法的执行状态转移：${current.status} → ${next}（${result.reason}）`,
      );
    }
  }
}

/**
 * 人工确认硬性门槛（存储边界调用，不可绕过）。
 *
 * 产品铁律：**未人工确认绝不执行**。这条不能只写在 UI 里——
 * 任何试图把执行单推进到「即将真实执行」的状态（queued / running）的写入，
 * 都必须要求 `confirmation.confirmedAt` 与 `confirmation.planHash` 同时非空。
 * 其余状态（草稿、待确认、终态等）不受此门槛约束。
 */
export function assertExecutionConfirmed(
  execution: Pick<Execution, 'id' | 'status' | 'confirmation'>,
  next: ExecutionStatus,
): void {
  if (next !== ExecutionStatus.Queued && next !== ExecutionStatus.Running) {
    return;
  }
  const confirmation = execution.confirmation;
  if (!confirmation || !confirmation.confirmedAt || !confirmation.planHash) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      `未确认的执行单不得进入 ${next} 态：要求 confirmation.confirmedAt 与 confirmation.planHash 均非空（execution=${execution.id}）`,
    );
  }
}
