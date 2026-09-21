/**
 * Agent 执行域（Execution Domain）核心类型与常量（v1 第一切片）。
 *
 * 本文件是**纯类型 + 常量 + 纯函数**，零运行时副作用、零 DOM / 零 Node 专属 API
 * （与 `src/core/types/**` 同属共享内核，前后端单份编译，见 server/tsconfig.json）。
 *
 * 设计约束（来自 feature-dev-agent-board 规格评审）：
 *   - 执行状态是**独立实体**，绝不污染现有 `Task.status`（7 值，不能承担暂停/取消/失败）。
 *   - 一个 Execution 可有多个 Attempt（每次实际执行新建一条，不覆盖旧记录）。
 *   - 所有状态变化、用户动作、Agent 事件、写回都进 append-only 的 ExecutionEvent。
 *   - 写回先生成字段级 before/after diff（WritebackProposal），经人工批准后才落库。
 */

/* ----------------------------------- 来源 ----------------------------------- */

/** Execution 的四类入口：统一收敛成同一个 Execution，不允许各自拥有状态 */
export type ExecutionSource =
  | 'project-task'
  | 'natural-language'
  | 'external'
  | 'template';

export const EXECUTION_SOURCES: readonly ExecutionSource[] = [
  'project-task',
  'natural-language',
  'external',
  'template',
];

/* ------------------------------- 执行状态（10 值） ------------------------------- */

/**
 * Execution 生命周期状态（10 个，id 严格固定，不得增删或改名）。
 * 与 TaskStatus 完全解耦——它描述「Agent 执行」这一独立生命周期，
 * 不回写、不覆盖项目任务的 status。
 */
export const ExecutionStatus = {
  /** 草稿（四类入口统一产出） */
  Draft: 'draft',
  /** 待确认（计划已生成，等待人工批准） */
  AwaitingConfirmation: 'awaiting_confirmation',
  /** 排队中（已批准，等待调度） */
  Queued: 'queued',
  /** 执行中 */
  Running: 'running',
  /** 已暂停（合作式暂停，不启动新步骤） */
  Paused: 'paused',
  /** 待处理（缺输入/权限/通道/冲突等，需人工介入） */
  NeedsAttention: 'needs_attention',
  /** 待验收（产物已产出，等待人工验收） */
  AwaitingReview: 'awaiting_review',
  /** 已完成（验收通过且写回成功，终态） */
  Completed: 'completed',
  /** 执行失败（终态） */
  Failed: 'failed',
  /** 已取消（终态，迟到回执不得再改写） */
  Cancelled: 'cancelled',
} as const;

export type ExecutionStatus = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];

/** 终态集合（出边为空） */
export const EXECUTION_TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  ExecutionStatus.Completed,
  ExecutionStatus.Failed,
  ExecutionStatus.Cancelled,
];

/* ------------------------------- Attempt 状态（6 值） ------------------------------- */

/** 每一次实际执行 Attempt 的状态 */
export const AttemptStatus = {
  Queued: 'queued',
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Interrupted: 'interrupted',
} as const;

export type AttemptStatus = (typeof AttemptStatus)[keyof typeof AttemptStatus];

/** Attempt 非终态集合（同一 execution 同时最多一个非终态 attempt） */
export const ATTEMPT_NON_TERMINAL_STATUSES: readonly AttemptStatus[] = [
  AttemptStatus.Queued,
  AttemptStatus.Running,
];

/**
 * Attempt 的**全部合法值**（白名单，用于入参校验）。
 *
 * ── 为什么需要这个常量（`AttemptStatus` 本身不够用）──
 * `AttemptStatus` 是「运行期对象」，`Object.values(AttemptStatus)` 也能枚举出同样的值，
 * 但那要求调用方**显式写 `Object.values`** —— 一个忘记写的调用方就会「看起来在校验、
 * 实际没校验」（`includes` 拿到非数组会抛、写成 `in` 又会把原型链上的键放进来）。
 * 此处落一个**逐字展开**的只读数组：它与 `AttemptStatus` 同文件、同段，
 * 任何一侧增删值都会在 `readonly AttemptStatus[]` 这个类型上**编译期报错**
 * （少写一个值 → 数组字面量不缺元素但语义残缺，靠就近 reviewers 一眼可比）。
 *
 * ── 为什么不给 `ExecutionStatus` / `WritebackProposalStatus` 也落一份 ──
 * 那两个走的是**状态机**（`assertStatusTransition` 用邻接表判定、`updateProposal`
 * 有终态封闭），非法值在存储边界已有一处权威判定（`server/routes/executions.routes.ts:166-184`
 * 的 `optionalEnum` 注释详述了这个取舍）。
 * 而 **attempt 的创建路径不经过任何状态机** —— `createAttempt` 直接把 status 落库，
 * 没有 `assertAttemptTransition` 兜底（那条边只在 `updateAttempt` 上）。
 * 故这里是「没有下游校验」的特例，必须自带白名单。
 */
export const ATTEMPT_STATUSES: readonly AttemptStatus[] = [
  AttemptStatus.Queued,
  AttemptStatus.Running,
  AttemptStatus.Succeeded,
  AttemptStatus.Failed,
  AttemptStatus.Cancelled,
  AttemptStatus.Interrupted,
];

/* ------------------------------- 事件类型 ------------------------------- */

/** ExecutionEvent 类型（覆盖规格要求的全部事件种类） */
export type ExecutionEventType =
  | 'created'
  | 'status_changed'
  | 'confirmation_granted'
  | 'attempt_started'
  | 'attempt_finished'
  | 'artifact_registered'
  | 'writeback_proposed'
  | 'writeback_applied'
  | 'cancel_requested'
  | 'canceled'
  | 'blocked'
  | 'resumed'
  | 'error';

export const EXECUTION_EVENT_TYPES: readonly ExecutionEventType[] = [
  'created',
  'status_changed',
  'confirmation_granted',
  'attempt_started',
  'attempt_finished',
  'artifact_registered',
  'writeback_proposed',
  'writeback_applied',
  'cancel_requested',
  'canceled',
  'blocked',
  'resumed',
  'error',
];

/** 事件行为体（谁触发了这条事件） */
export type ExecutionEventActor = 'user' | 'agent' | 'system' | 'external';

/* ------------------------------- 写回提案状态 ------------------------------- */

/** WritebackProposal 状态 */
export const WritebackProposalStatus = {
  Draft: 'draft',
  Proposed: 'proposed',
  Applied: 'applied',
  Rejected: 'rejected',
  Conflict: 'conflict',
} as const;

export type WritebackProposalStatus =
  (typeof WritebackProposalStatus)[keyof typeof WritebackProposalStatus];

/**
 * 写回提案状态的**全部合法值**（白名单，用于入参校验）。
 *
 * ── 为什么它也需要（与 `ATTEMPT_STATUSES` 不同的理由）──
 * `updateProposal` 确实有边界强制（已落定不可再变更、落定终态需 decidedBy），
 * 但那**不是值域校验**：一个 `status='ghost'` 的提案会被 `updateProposal` 正常接受
 * （它既不等于 applied 也不等于 rejected，所以两条检查都不触发），
 * `createProposal` 同样原样落库。实测确认（修复前）：
 *   · 本地侧 `createProposal({status:'ghost'})` → 落库；
 *   · 远端侧 `POST /proposals {"status":"ghost"}` → 200，落库 `status='ghost'`。
 * 危害与 attempt 同源：`canComplete` 只看「存在 applied 且 decidedBy 非空」，
 * 而一个非法状态的提案在 `listProposals` 里会让界面按未知状态渲染（静默漏显）。
 */
export const WRITEBACK_PROPOSAL_STATUSES: readonly WritebackProposalStatus[] = [
  WritebackProposalStatus.Draft,
  WritebackProposalStatus.Proposed,
  WritebackProposalStatus.Applied,
  WritebackProposalStatus.Rejected,
  WritebackProposalStatus.Conflict,
];

/* ----------------------------------- 实体 ----------------------------------- */

/**
 * 人工确认快照（计划不可变，修改计划必须生成新版本）。
 *
 * 绑定关系（stale approval 收紧切片后的唯一真相）：
 *   确认是否仍然有效，由 `planHash === computePlanHash(execution)` 决定——
 *   计划一旦变更，旧确认的 hash 必然对不上，门槛直接拒绝。这正是「批准的是这一版计划」。
 *
 * @deprecated `planRevision` 在此切片后**明确废弃，且不再作为任何门槛**。
 *   理由：内容绑定（`planHash`）已经覆盖了它宣称的能力——计划一旦变更 hash 就变，
 *   重放旧凭据必然被拒；因此再维护一个单调版本号是冗余基础设施。
 *   「留着字段但没人读」比删掉更危险：它会误导后来人以为计划版本化已实现。
 *   保留该字段只为兼容既有（备份导入）形状，新代码**不得**把它当门槛或读它做判定。
 */
export interface ExecutionConfirmation {
  confirmedAt: string;
  confirmedBy: string;
  planHash: string;
  /** @deprecated 不再作为门槛；内容绑定（planHash）已覆盖其能力。 */
  planRevision: number;
}

/** 执行单（Execution）：Agent 的一次「可追踪执行」的主实体 */
export interface Execution {
  id: string;
  /** 归属项目（执行发生在某个人类/ Agent 项目内） */
  projectId: string;
  /** 关联任务（可空：natural-language / external / template 可能不直接挂任务） */
  taskId: string | null;
  /** 来源入口 */
  source: ExecutionSource;
  /** 目标（自然语言目标） */
  objective: string;
  /** 执行该 execution 的 Agent Member.id（可空） */
  agentMemberId: string | null;
  /** 通道种类（可空，如 loopback / nas / http） */
  channelKind: string | null;
  /** 输入快照哈希（可空；用于幂等与迟到回执拒绝） */
  inputSnapshotHash: string | null;
  /** 当前执行状态（见 ExecutionStatus） */
  status: ExecutionStatus;
  /** 人工确认快照（awaiting_confirmation 之后才有），可空 */
  confirmation: ExecutionConfirmation | null;
  /** 幂等键（稳定字符串，由 makeExecutionIdempotencyKey 生成） */
  idempotencyKey: string;
  /** 当前 attempt 编号（指向最近一次 attempt） */
  currentAttemptNo: number;
  createdAt: string;
  updatedAt: string;
  /** 开始时刻（进入 running 时写入），可空 */
  startedAt: string | null;
  /** 结束时刻（进入终态时写入），可空 */
  finishedAt: string | null;
  /** 终态原因（failed/cancelled 等），可空 */
  terminalReason: string | null;
  /** 阻塞原因（needs_attention 时），可空 */
  blockedReason: string | null;
}

/** 执行尝试（ExecutionAttempt）：每次实际执行新建一条，不覆盖旧记录 */
export interface ExecutionAttempt {
  id: string;
  executionId: string;
  /** 单调递增，从 1 开始（nextAttemptNo 保证） */
  attemptNo: number;
  status: AttemptStatus;
  /** 运行时种类（可空，如 local-loopback / remote-http） */
  runtimeKind: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  inputSnapshotHash: string | null;
  /** 错误码（failed 时），可空 */
  errorCode: string | null;
  /** 错误摘要（failed 时），可空 */
  errorSummary: string | null;
  terminalReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 执行事件（ExecutionEvent）：append-only 审计流水 */
export interface ExecutionEvent {
  id: string;
  executionId: string;
  /** 关联 attempt（可空，非 attempt 维度的事件如 created 无 attempt） */
  attemptId: string | null;
  /** 同一 execution 内单调递增，从 1 开始（nextSeq 保证） */
  seq: number;
  type: ExecutionEventType;
  actor: ExecutionEventActor;
  /** 状态变化事件的起点状态（可空） */
  fromStatus: ExecutionStatus | null;
  /** 状态变化事件的终点状态（可空） */
  toStatus: ExecutionStatus | null;
  /** 原因（可空） */
  reason: string | null;
  /** 幂等键（可空，用于迟到回执/重复事件的幂等拒绝） */
  idempotencyKey: string | null;
  createdAt: string;
}

/** 单次写回操作：字段级 before/after diff */
export interface WritebackOperation {
  /** 目标字段（必须为白名单字段，否则提案整体非法） */
  field: string;
  /** 写入前的值（执行域只读，不改动既有业务表） */
  before: unknown;
  /** 写入后的值（执行域只读，不改动既有业务表） */
  after: unknown;
}

/** 写回提案（WritebackProposal）：执行成功不代表业务完成，只有写回成功才进完成态 */
export interface WritebackProposal {
  id: string;
  executionId: string;
  /** 关联 attempt（可空） */
  attemptId: string | null;
  projectId: string;
  /** 目标任务（可空） */
  taskId: string | null;
  /** 字段级 before/after 操作集合 */
  operations: WritebackOperation[];
  status: WritebackProposalStatus;
  /** 幂等键（由 makeWritebackIdempotencyKey 生成） */
  idempotencyKey: string;
  /** 决策人（approved/rejected 时），可空 */
  decidedBy: string | null;
  /** 决策时刻（可空） */
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* --------------------------------- 写回白名单 --------------------------------- */

/**
 * v1 写回白名单（字段级，集中一处，后续可配置）。
 * 首版只允许安全、明确、低风险的字段；明确禁止 task.delete / stage.reorder /
 * task.assignee 这类破坏性/越权字段。
 */
export const WRITEBACK_WRITABLE_FIELDS: readonly string[] = [
  'task.status',
  'task.notes.append',
  'task.comment',
  'task.attachment.ref',
];

/**
 * 判断某字段是否允许写回（白名单校验的唯一出口）。
 * @param field 形如 'task.status' 的点分字段名
 */
export function isFieldWritable(field: string): boolean {
  return (WRITEBACK_WRITABLE_FIELDS as readonly string[]).includes(field);
}

/* --------------------------------- 幂等键工具 --------------------------------- */

/**
 * 生成 Execution 的稳定幂等键（不随机）。
 * 同一 (source, projectId, naturalKey) 必然得到同一字符串，便于重复导入/触发去重。
 */
export function makeExecutionIdempotencyKey(parts: {
  projectId: string;
  source: ExecutionSource;
  naturalKey: string;
}): string {
  return `exec:${parts.source}:${parts.projectId}:${parts.naturalKey}`;
}

/**
 * 生成 WritebackProposal 的稳定幂等键（不随机）。
 * 同一 (executionId, taskId, field) 必然得到同一字符串。
 */
export function makeWritebackIdempotencyKey(parts: {
  executionId: string;
  taskId: string | null;
  field: string;
}): string {
  return `wb:${parts.executionId}:${parts.taskId ?? '-'}:${parts.field}`;
}
