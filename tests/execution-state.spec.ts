/**
 * Agent 执行域状态机（纯函数）单测（第一切片）。
 *
 * 锁死：
 *   1. 邻接表逐边合法：每个 from 的 to 集合与规格 §3 完全一致；终态出边为空；
 *   2. canTransition / assertTransition：合法边过、非法边拒（含终态不可转出、
 *      awaiting_review 不允许回 running）；
 *   3. canComplete：必须 awaiting_review 且存在 applied 写回提案，否则拒；
 *   4. 单执行同时最多一个非终态 attempt（canStartAttempt）+ attemptNo / seq 单调递增；
 *   5. 幂等键稳定（同输入恒同串）；
 *   6. 写回白名单：四字段可写、其余拒。
 */

import { describe, it, expect } from 'vitest';

import {
  EXECUTION_TRANSITIONS,
  canComplete,
  canStartAttempt,
  isTerminal,
  nextAttemptNo,
  nextSeq,
  assertTransition,
  canTransition,
} from '../src/core/execution/execution-state';
import {
  ATTEMPT_NON_TERMINAL_STATUSES,
  EXECUTION_TERMINAL_STATUSES,
  ExecutionStatus,
  WRITEBACK_WRITABLE_FIELDS,
  isFieldWritable,
  makeExecutionIdempotencyKey,
  makeWritebackIdempotencyKey,
} from '../src/core/types/agent-execution';
import type { Execution, ExecutionAttempt, ExecutionEvent, WritebackProposal } from '../src/core/types/entities';

/** 规格 §3 的合法边（逐字落地为期望邻接表） */
const EXPECTED_TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  [ExecutionStatus.Draft]: [ExecutionStatus.AwaitingConfirmation, ExecutionStatus.Cancelled],
  [ExecutionStatus.AwaitingConfirmation]: [
    ExecutionStatus.Queued,
    ExecutionStatus.Draft,
    ExecutionStatus.Cancelled,
  ],
  [ExecutionStatus.Queued]: [ExecutionStatus.Running, ExecutionStatus.Cancelled, ExecutionStatus.Failed],
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

describe('EXECUTION_TRANSITIONS 邻接表（规格 §3 逐边）', () => {
  it('每个 from 的 to 集合与期望完全一致（含顺序）', () => {
    for (const from of Object.keys(EXPECTED_TRANSITIONS) as ExecutionStatus[]) {
      expect([...EXECUTION_TRANSITIONS[from]].sort(), `from=${from}`).toEqual(
        [...EXPECTED_TRANSITIONS[from]].sort(),
      );
    }
  });

  it('10 个状态一个不少', () => {
    expect(Object.keys(EXECUTION_TRANSITIONS).sort()).toEqual(
      Object.keys(EXPECTED_TRANSITIONS).sort(),
    );
  });

  it('终态出边为空', () => {
    for (const t of EXECUTION_TERMINAL_STATUSES) {
      expect(EXECUTION_TRANSITIONS[t]).toEqual([]);
      expect(isTerminal(t)).toBe(true);
    }
  });

  it('非终态不是终态', () => {
    expect(isTerminal(ExecutionStatus.Running)).toBe(false);
    expect(isTerminal(ExecutionStatus.AwaitingReview)).toBe(false);
  });

  it('awaiting_review 不允许回 running（重试必须新建 attempt 后从 needs_attention/queued 重新进入）', () => {
    expect(EXECUTION_TRANSITIONS[ExecutionStatus.AwaitingReview]).not.toContain(
      ExecutionStatus.Running,
    );
    expect(canTransition(ExecutionStatus.AwaitingReview, ExecutionStatus.Running)).toBe(false);
  });

  it('取消的二段：cancel_requested 是事件不是状态；cancelled 是唯一收口终态', () => {
    // 没有从任何状态直接跳到 cancelled 之外的「取消中」状态；终态只有 completed/failed/cancelled。
    expect(EXECUTION_TERMINAL_STATUSES).toEqual([
      ExecutionStatus.Completed,
      ExecutionStatus.Failed,
      ExecutionStatus.Cancelled,
    ]);
  });
});

describe('canTransition / assertTransition', () => {
  it('合法边 canTransition=true', () => {
    expect(canTransition(ExecutionStatus.Draft, ExecutionStatus.AwaitingConfirmation)).toBe(true);
    expect(canTransition(ExecutionStatus.Running, ExecutionStatus.AwaitingReview)).toBe(true);
    expect(canTransition(ExecutionStatus.Paused, ExecutionStatus.Running)).toBe(true);
  });

  it('非法边 canTransition=false（含终态不可转出）', () => {
    expect(canTransition(ExecutionStatus.Completed, ExecutionStatus.Running)).toBe(false);
    expect(canTransition(ExecutionStatus.Running, ExecutionStatus.Completed)).toBe(false);
    expect(canTransition(ExecutionStatus.Draft, ExecutionStatus.Running)).toBe(false);
  });

  it('assertTransition 合法边不抛，非法边抛 Validation', () => {
    expect(() =>
      assertTransition(ExecutionStatus.Queued, ExecutionStatus.Running),
    ).not.toThrow();
    expect(() => assertTransition(ExecutionStatus.Running, ExecutionStatus.Completed)).toThrow(
      /非法的执行状态转移/,
    );
  });
});

describe('canComplete（完成门槛）', () => {
  const baseExecution: Pick<Execution, 'id' | 'status'> = {
    id: 'exec_1',
    status: ExecutionStatus.AwaitingReview,
  };

  // 注意：applied 提案必须通过人工决策落定（decidedBy 非空）才算数——这是 P0 防线，
  // 故该 fixture 须带 decidedBy（此前为 null，属未落定的形状，已按新契约收紧）。
  const appliedProposal: WritebackProposal = {
    id: 'wb_1',
    executionId: 'exec_1',
    attemptId: null,
    projectId: 'p1',
    taskId: null,
    operations: [],
    status: 'applied',
    idempotencyKey: 'k',
    decidedBy: 'u1',
    decidedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '',
    updatedAt: '',
  };

  it('非 awaiting_review 一律拒绝', () => {
    const r = canComplete({ id: 'e', status: ExecutionStatus.Running }, [appliedProposal]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/awaiting_review/);
  });

  it('awaiting_review 但无 applied 提案拒绝（执行成功 ≠ 业务完成）', () => {
    const r = canComplete(baseExecution, [
      { ...appliedProposal, status: 'proposed' },
      { ...appliedProposal, status: 'rejected', id: 'wb_2' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/applied/);
  });

  it('awaiting_review + 存在 applied 提案 → 允许', () => {
    const r = canComplete(baseExecution, [appliedProposal]);
    expect(r.ok).toBe(true);
  });

  it('applied 提案但 decidedBy 为空 → 拒绝（审批事实必须在数据上成立）', () => {
    const noDecision: WritebackProposal = { ...appliedProposal, decidedBy: null, decidedAt: null };
    const r = canComplete(baseExecution, [noDecision]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/decidedBy/);
  });

  it('applied 提案必须针对本 execution（其它 execution 的提案不算数）', () => {
    const other: WritebackProposal = { ...appliedProposal, executionId: 'exec_other' };
    const r = canComplete(baseExecution, [other]);
    expect(r.ok).toBe(false);
  });
});

describe('单执行 attempt 唯一性 + 序号单调', () => {
  const mkAttempt = (attemptNo: number, status: ExecutionAttempt['status']): ExecutionAttempt => ({
    id: `a_${attemptNo}`,
    executionId: 'exec_1',
    attemptNo,
    status,
    runtimeKind: null,
    startedAt: null,
    finishedAt: null,
    inputSnapshotHash: null,
    errorCode: null,
    errorSummary: null,
    terminalReason: null,
    createdAt: '',
    updatedAt: '',
  });

  it('nextAttemptNo：空 → 1；否则 max+1', () => {
    expect(nextAttemptNo([])).toBe(1);
    expect(nextAttemptNo([mkAttempt(1, 'succeeded'), mkAttempt(3, 'failed')])).toBe(4);
  });

  it('nextSeq：空 → 1；否则 max+1', () => {
    const events: ExecutionEvent[] = [
      { id: 'e1', executionId: 'x', attemptId: null, seq: 2, type: 'created', actor: 'system', fromStatus: null, toStatus: null, reason: null, idempotencyKey: null, createdAt: '' },
      { id: 'e2', executionId: 'x', attemptId: null, seq: 5, type: 'status_changed', actor: 'agent', fromStatus: null, toStatus: null, reason: null, idempotencyKey: null, createdAt: '' },
    ];
    expect(nextSeq([])).toBe(1);
    expect(nextSeq(events)).toBe(6);
  });

  it('canStartAttempt：无 queued/running 才允许（单执行最多一个非终态 attempt）', () => {
    expect(canStartAttempt([])).toBe(true);
    expect(canStartAttempt([mkAttempt(1, 'succeeded')])).toBe(true);
    expect(canStartAttempt([mkAttempt(1, 'failed')])).toBe(true);
    expect(canStartAttempt([mkAttempt(1, 'queued')])).toBe(false);
    expect(canStartAttempt([mkAttempt(1, 'running')])).toBe(false);
    // 已有一个非终态，再加一个终态仍不允许（仍存在一个活的）
    expect(canStartAttempt([mkAttempt(1, 'running'), mkAttempt(2, 'succeeded')])).toBe(false);
  });

  it('ATTEMPT_NON_TERMINAL_STATUSES 仅含 queued / running', () => {
    expect([...ATTEMPT_NON_TERMINAL_STATUSES].sort()).toEqual(['queued', 'running']);
  });
});

describe('幂等键稳定（不随机）', () => {
  it('makeExecutionIdempotencyKey：同输入恒同串', () => {
    const a = makeExecutionIdempotencyKey({
      projectId: 'p1',
      source: 'project-task',
      naturalKey: 'task-123',
    });
    const b = makeExecutionIdempotencyKey({
      projectId: 'p1',
      source: 'project-task',
      naturalKey: 'task-123',
    });
    expect(a).toBe(b);
    expect(a).toBe('exec:project-task:p1:task-123');
  });

  it('makeExecutionIdempotencyKey：不同 naturalKey 不同串', () => {
    const a = makeExecutionIdempotencyKey({ projectId: 'p1', source: 'natural-language', naturalKey: 'x' });
    const b = makeExecutionIdempotencyKey({ projectId: 'p1', source: 'natural-language', naturalKey: 'y' });
    expect(a).not.toBe(b);
  });

  it('makeWritebackIdempotencyKey：同输入恒同串（taskId=null 回落 -）', () => {
    const a = makeWritebackIdempotencyKey({ executionId: 'e1', taskId: null, field: 'task.status' });
    const b = makeWritebackIdempotencyKey({ executionId: 'e1', taskId: null, field: 'task.status' });
    expect(a).toBe(b);
    expect(a).toBe('wb:e1:-:task.status');
    const c = makeWritebackIdempotencyKey({ executionId: 'e1', taskId: 't1', field: 'task.status' });
    expect(c).toBe('wb:e1:t1:task.status');
  });
});

describe('写回白名单', () => {
  it('白名单四项可写，其余一律拒', () => {
    for (const f of WRITEBACK_WRITABLE_FIELDS) {
      expect(isFieldWritable(f), f).toBe(true);
    }
    // 明确禁止的破坏性/越权字段
    expect(isFieldWritable('task.delete')).toBe(false);
    expect(isFieldWritable('stage.reorder')).toBe(false);
    expect(isFieldWritable('task.assignee')).toBe(false);
    expect(isFieldWritable('task.status')).toBe(true);
    expect(isFieldWritable('task.notes.append')).toBe(true);
    expect(isFieldWritable('task.comment')).toBe(true);
    expect(isFieldWritable('task.attachment.ref')).toBe(true);
  });
});

/**
 * 可达性事实（stale approval 收紧切片的**决策依据**，不是装饰）。
 *
 * 「确认凭据只能在授予点（awaiting_confirmation）写入」这条收紧带来一个必须写下来的
 * 边界：一旦离开授予点，就**没有任何合法路径回去**。这直接决定了两件事：
 *   ① 僵尸兜底（execution-recovery）在把 running 收敛为 needs_attention 时
 *      **绝不能清空 confirmation** —— 清了就再没法重新确认，这条执行永远跑不起来；
 *   ② 未来若引入「可编辑计划 / 计划版本化」，必须同时开一条回到 awaiting_confirmation
 *      的合法边，否则「计划一变 → 凭据失效 → 卡死」是必然结果。
 */
describe('可达性事实（授予点限制的边界）', () => {
  function reachableFrom(start: ExecutionStatus): Set<ExecutionStatus> {
    const seen = new Set<ExecutionStatus>([start]);
    const queue: ExecutionStatus[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of EXECUTION_TRANSITIONS[cur]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  }

  it('needs_attention 无法到达 awaiting_confirmation（故僵尸兜底绝不能清空确认凭据）', () => {
    // 变红 = 有人给状态机加了新边 → 请重新审视 execution-recovery.ts 里
    // 「保留凭据、只改文案」的决定（DEFAULT_RECOVERY_REASON 与 recoverExecution）。
    expect(
      reachableFrom(ExecutionStatus.NeedsAttention).has(ExecutionStatus.AwaitingConfirmation),
    ).toBe(false);
  });

  it('离开 awaiting_confirmation 后各态均无法回到授予点（计划若变更则只能取消/失败）', () => {
    for (const s of [
      ExecutionStatus.Queued,
      ExecutionStatus.Running,
      ExecutionStatus.Paused,
      ExecutionStatus.NeedsAttention,
      ExecutionStatus.AwaitingReview,
    ]) {
      expect(reachableFrom(s).has(ExecutionStatus.AwaitingConfirmation), s).toBe(false);
    }
  });
});
