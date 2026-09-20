/**
 * 重启后「僵尸态」兜底单测（规格 `feature-dev-agent-board-2026-09-18.md` §12 L223 第 1 条）。
 *
 * 要锁死的是**一个正确性属性**，不是一个函数的形状：
 *   应用重启 / 备份恢复之后，库里**不允许存在**「界面显示在跑、实际没人在跑」的假活态，
 *   且收敛过程**必须走状态机已有的合法边**（不得绕过校验、不得改写终态）。
 *
 * 覆盖：
 *   1. running execution → needs_attention，updatedAt 前进、blockedReason 有值；
 *   2. 僵尸 running attempt → interrupted，finishedAt 被盖上；
 *   3. **终态（completed / failed / cancelled）绝不被改动**（含其 updatedAt 逐字不变）；
 *   4. **幂等**：连调两次，第二次零写入（逐字段 JSON 深等 + 事件数不增）；
 *   5. paused 不收敛（决策：用户主动暂停，语义上合法地停着；且无 paused→needs_attention 边）；
 *   6. needs_attention 不收敛（自身即目标态，重启没破坏它的语义）；
 *   7. draft / awaiting_confirmation / queued / awaiting_review 一律不被误改；
 *   8. 审计流水：execution 收敛留 status_changed、attempt 收敛留 attempt_finished；
 *   9. 孤立僵尸 attempt（execution 处于 paused）→ 不收敛，不制造 execution/attempt 错配；
 *  10. needs_attention 的 execution **连同其僵尸 attempt 一起**收敛（只动 attempt 层）。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import {
  AttemptStatus,
  ExecutionStatus,
  type ExecutionConfirmation,
} from '../src/core/types/agent-execution';
import { emptyPackage } from './helpers/backup-fixture';
import {
  DEFAULT_RECOVERY_REASON,
  DEFAULT_ATTEMPT_RECOVERY_REASON,
  ZOMBIE_EXECUTION_STATUSES,
  isZombieExecutionStatus,
  isZombieAttemptStatus,
  recoverZombieExecutions,
} from '../src/core/execution/execution-recovery';

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
  await bundle.admin?.replaceAllImport(emptyPackage());
});

/* ------------------------------- 夹具与助手 ------------------------------- */

async function newExecution(suffix: string): Promise<string> {
  const created = await bundle.executions.createExecution({
    projectId: 'p1',
    source: 'project-task',
    objective: 'x',
    idempotencyKey: `exec:${suffix}`,
  });
  return created.id;
}

async function setStatus(id: string, status: ExecutionStatus) {
  // queued / running 需要人工确认快照（assertExecutionConfirmed 是存储边界硬门槛）
  const needConfirm = status === ExecutionStatus.Queued || status === ExecutionStatus.Running;
  return bundle.executions.updateExecutionStatus(
    id,
    needConfirm ? { status, confirmation: CONFIRMATION } : { status },
  );
}

/** 合法推进到 running（draft → awaiting_confirmation → queued → running） */
async function toRunning(id: string): Promise<void> {
  await setStatus(id, ExecutionStatus.AwaitingConfirmation);
  await setStatus(id, ExecutionStatus.Queued);
  await setStatus(id, ExecutionStatus.Running);
}

/** 合法推进到 paused（… → running → paused） */
async function toPaused(id: string): Promise<void> {
  await toRunning(id);
  await setStatus(id, ExecutionStatus.Paused);
}

/** 合法推进到 needs_attention（… → running → needs_attention） */
async function toNeedsAttention(id: string): Promise<void> {
  await toRunning(id);
  await setStatus(id, ExecutionStatus.NeedsAttention);
}

/** 合法推进到 awaiting_review（… → running → awaiting_review） */
async function toAwaitingReview(id: string): Promise<void> {
  await toRunning(id);
  await setStatus(id, ExecutionStatus.AwaitingReview);
}

/** 合法推进到终态 cancelled */
async function toCancelled(id: string): Promise<void> {
  await setStatus(id, ExecutionStatus.AwaitingConfirmation);
  await setStatus(id, ExecutionStatus.Cancelled);
}

/** 合法推进到终态 failed */
async function toFailed(id: string): Promise<void> {
  await setStatus(id, ExecutionStatus.AwaitingConfirmation);
  await setStatus(id, ExecutionStatus.Queued);
  await setStatus(id, ExecutionStatus.Failed);
}

/** 合法推进到终态 completed（需 awaiting_review + 人工决策的 applied 提案） */
async function toCompleted(id: string): Promise<void> {
  await toAwaitingReview(id);
  const proposal = await bundle.executions.createProposal({
    executionId: id,
    projectId: 'p1',
    taskId: 't1',
    operations: [{ field: 'task.status', before: 'review', after: 'done' }],
    idempotencyKey: `wb:${id}:t1:task.status`,
  });
  await bundle.executions.updateProposal(proposal.id, { status: 'applied', decidedBy: 'u1' });
  await setStatus(id, ExecutionStatus.Completed);
}

/** 让某 execution 挂着一条 running attempt（僵尸 attempt 的标准造法） */
async function addRunningAttempt(executionId: string): Promise<string> {
  const attempt = await bundle.executions.createAttempt({
    executionId,
    status: AttemptStatus.Queued,
    startedAt: '2026-08-01T00:00:00.000Z',
  });
  await bundle.executions.updateAttempt(attempt.id, { status: AttemptStatus.Running });
  return attempt.id;
}

/** 直接以目标状态造一条执行单（跳过状态机推进，模拟「备份恢复搬进来的僵尸」） */
async function restoreAs(id: string, status: ExecutionStatus): Promise<void> {
  const row = await bundle.executions.getExecution(id);
  if (!row) throw new Error('fixture missing');
  // ★ 注意：备份恢复是**整库替换**，会把**其他所有项目的数据一起清掉**。
  //   故此法只能用来搬「同一条 execution 的新状态」，且必须在造其他夹具**之前**调用。
  await bundle.admin!.replaceAllImport({
    ...emptyPackage(),
    data: { ...emptyPackage().data, executions: [{ ...row, status }] },
  });
}

/**
 * 以目标状态造执行单并**保留其 attempt**（模拟「恢复包里的 paused + 僵尸 attempt」）。
 * 必须用整库替换：`paused → needs_attention` 这条边在状态机里**不存在**，
 * 正常路径压根造不出这个行状态（这恰恰是 paused 无法被兜底的原因）。
 */
async function restoreWithAttempts(executionId: string, status: ExecutionStatus): Promise<void> {
  const row = await bundle.executions.getExecution(executionId);
  const attempts = await bundle.executions.listAttempts(executionId);
  await bundle.admin!.replaceAllImport({
    ...emptyPackage(),
    data: { ...emptyPackage().data, executions: [{ ...row!, status }], executionAttempts: attempts },
  });
}

const scope = { projectIds: ['p1'] };

/** 逐字段快照（用于「零写入」断言——比逐字段 if 更难写出假绿） */
async function snapshot(executionId: string): Promise<{
  execution: unknown;
  attempts: unknown;
  events: unknown;
}> {
  const [execution, attempts, events] = await Promise.all([
    bundle.executions.getExecution(executionId),
    bundle.executions.listAttempts(executionId),
    bundle.executions.listEvents(executionId),
  ]);
  return { execution, attempts, events };
}

/* --------------------------------- 用例 --------------------------------- */

describe('recoverZombieExecutions：execution 层收敛', () => {
  it('running → needs_attention：状态收敛 + updatedAt 前进 + blockedReason 有值', async () => {
    const id = await newExecution('e1');
    await toRunning(id);
    const before = await bundle.executions.getExecution(id);
    expect(before?.status).toBe(ExecutionStatus.Running);

    const summary = await recoverZombieExecutions(bundle.executions, scope);

    const after = await bundle.executions.getExecution(id);
    expect(after?.status).toBe(ExecutionStatus.NeedsAttention);
    expect(after?.blockedReason).toBe(DEFAULT_RECOVERY_REASON);
    expect(after!.updatedAt >= before!.updatedAt).toBe(true);
    expect(summary.executionsRecovered).toBe(1);
    expect(summary.outcomes.find((o) => o.executionId === id)?.to).toBe(
      ExecutionStatus.NeedsAttention,
    );
  });

  it('审计流水：收敛留下 system 的 status_changed（from=running / to=needs_attention）', async () => {
    const id = await newExecution('e2');
    await toRunning(id);

    await recoverZombieExecutions(bundle.executions, scope);

    const events = await bundle.executions.listEvents(id);
    const recovery = events.filter((e) => e.type === 'status_changed' && e.actor === 'system');
    expect(recovery).toHaveLength(1);
    expect(recovery[0]!.fromStatus).toBe(ExecutionStatus.Running);
    expect(recovery[0]!.toStatus).toBe(ExecutionStatus.NeedsAttention);
    expect(recovery[0]!.reason).toBe(DEFAULT_RECOVERY_REASON);
  });

  it('僵尸 running attempt → interrupted，且 finishedAt 被盖上', async () => {
    const id = await newExecution('e3');
    await toRunning(id);
    const attemptId = await addRunningAttempt(id);

    const summary = await recoverZombieExecutions(bundle.executions, scope);

    const attempts = await bundle.executions.listAttempts(id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe(AttemptStatus.Interrupted);
    expect(attempts[0]!.finishedAt).toBeTruthy();
    expect(attempts[0]!.terminalReason).toBe(DEFAULT_ATTEMPT_RECOVERY_REASON);
    expect(summary.attemptsRecovered).toBe(1);

    const finished = await bundle.executions.listEvents(id);
    const ev = finished.filter((e) => e.type === 'attempt_finished');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.attemptId).toBe(attemptId);
    expect(ev[0]!.actor).toBe('system');
  });

  it('attempt 先于 execution 收敛（不留「已 needs_attention 但 attempt 还在 running」的错觉）', async () => {
    const id = await newExecution('e4');
    await toRunning(id);
    await addRunningAttempt(id);

    await recoverZombieExecutions(bundle.executions, scope);

    const events = await bundle.executions.listEvents(id);
    // 事件 seq 是追加顺序的规范排序键 —— attempt_finished 必须排在 status_changed 之前
    const attemptIdx = events.findIndex((e) => e.type === 'attempt_finished');
    const statusIdx = events.findIndex((e) => e.type === 'status_changed' && e.actor === 'system');
    expect(attemptIdx).toBeGreaterThanOrEqual(0);
    expect(statusIdx).toBeGreaterThan(attemptIdx);
  });
});

describe('recoverZombieExecutions：终态保护（防误伤）', () => {
  it.each([
    ['completed', toCompleted, ExecutionStatus.Completed],
    ['failed', toFailed, ExecutionStatus.Failed],
    ['cancelled', toCancelled, ExecutionStatus.Cancelled],
  ] as const)('%s 绝不被兜底改动（逐字段快照不变、无新事件）', async (_name, build, expected) => {
    const id = await newExecution(`t-${_name}`);
    await build(id);
    expect((await bundle.executions.getExecution(id))?.status).toBe(expected);
    const before = await snapshot(id);

    await recoverZombieExecutions(bundle.executions, scope);

    const after = await snapshot(id);
    // JSON 深等：任何字段（含 updatedAt / blockedReason / finishedAt）动了都会红
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('终态 cancelled 挂着的 running attempt 也不被单独收敛（attempt 级递归的边界）', async () => {
    // 造一条数据矛盾：cancelled 的 execution 上挂着 running attempt。
    // 期望：**不发明**它的归宿，原样保留（规格空白，见报告）。
    const id = await newExecution('t-orphan');
    await toRunning(id);
    const attemptId = await addRunningAttempt(id);
    const row = await bundle.executions.getExecution(id);
    const attempts = await bundle.executions.listAttempts(id);
    await bundle.admin!.replaceAllImport({
      ...emptyPackage(),
      data: {
        ...emptyPackage().data,
        executions: [{ ...row!, status: ExecutionStatus.Cancelled }],
        executionAttempts: attempts,
      },
    });
    const before = await snapshot(id);

    await recoverZombieExecutions(bundle.executions, scope);

    const after = await snapshot(id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect((await bundle.executions.getExecution(id))?.status).toBe(ExecutionStatus.Cancelled);
    const a = await bundle.executions.listAttempts(id);
    expect(a[0]!.id).toBe(attemptId);
    expect(a[0]!.status).toBe(AttemptStatus.Running);
  });
});

describe('recoverZombieExecutions：幂等', () => {
  it('连调两次：第二次零写入（快照逐字相等、事件数不增）', async () => {
    const id = await newExecution('i1');
    await toRunning(id);
    await addRunningAttempt(id);

    const first = await recoverZombieExecutions(bundle.executions, scope);
    const mid = await snapshot(id);
    const second = await recoverZombieExecutions(bundle.executions, scope);
    const end = await snapshot(id);

    expect(first.executionsRecovered).toBe(1);
    expect(first.attemptsRecovered).toBe(1);
    expect(second.executionsRecovered).toBe(0);
    expect(second.attemptsRecovered).toBe(0);
    expect(JSON.stringify(end)).toBe(JSON.stringify(mid));
    expect((await bundle.executions.listEvents(id)).length).toBe(
      (mid.events as unknown[]).length,
    );
  });

  it('空 projectIds：不扫库、不报错', async () => {
    const id = await newExecution('i2');
    await toRunning(id);

    const summary = await recoverZombieExecutions(bundle.executions, { projectIds: [] });

    expect(summary).toEqual({ executionsRecovered: 0, attemptsRecovered: 0, skipped: 0, outcomes: [] });
    expect((await bundle.executions.getExecution(id))?.status).toBe(ExecutionStatus.Running);
  });

  it('库里全是终态：一次调用后零收敛（幂等性在真实数据上的体现）', async () => {
    const a = await newExecution('i3a');
    const b = await newExecution('i3b');
    await toCompleted(a);
    await toCancelled(b);

    const summary = await recoverZombieExecutions(bundle.executions, scope);

    expect(summary.executionsRecovered).toBe(0);
    expect(summary.attemptsRecovered).toBe(0);
    expect(summary.skipped).toBe(2);
  });
});

describe('recoverZombieExecutions：非僵尸态不被误改', () => {
  it.each([
    ['draft', []],
    ['awaiting_confirmation', [ExecutionStatus.AwaitingConfirmation]],
    ['queued', [ExecutionStatus.AwaitingConfirmation, ExecutionStatus.Queued]],
    ['awaiting_review', null],
  ] as const)('%s 不被改动', async (name, steps) => {
    const id = await newExecution(`n-${name}`);
    if (name === 'awaiting_review') {
      await toAwaitingReview(id);
    } else {
      for (const s of steps) await setStatus(id, s as ExecutionStatus);
    }
    const before = await snapshot(id);
    expect((before.execution as { status: string }).status).toBe(name);

    await recoverZombieExecutions(bundle.executions, scope);

    const after = await snapshot(id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('queued 的活 attempt（从未启动）不收敛为 interrupted —— 语义是「未启动」不是「被打断」', async () => {
    const id = await newExecution('n-q');
    await setStatus(id, ExecutionStatus.AwaitingConfirmation);
    await setStatus(id, ExecutionStatus.Queued);
    await bundle.executions.createAttempt({ executionId: id, status: AttemptStatus.Queued });
    const before = await snapshot(id);

    await recoverZombieExecutions(bundle.executions, scope);

    const after = await snapshot(id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

describe('recoverZombieExecutions：paused 与 needs_attention 的决策', () => {
  it('paused **不收敛**：用户主动暂停是「合法地停着」，且状态机无 paused→needs_attention 边', async () => {
    const id = await newExecution('d-paused');
    await toPaused(id);
    const before = await snapshot(id);

    const summary = await recoverZombieExecutions(bundle.executions, scope);

    const after = await snapshot(id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect((after.execution as { status: string }).status).toBe(ExecutionStatus.Paused);
    expect(summary.executionsRecovered).toBe(0);
    expect(summary.skipped).toBe(1);
  });

  it('paused 上挂着的僵尸 running attempt 也一并留着（不制造 execution/attempt 错配）', async () => {
    // ★ 这个行状态在正常路径下**造不出来**（状态机没有 paused→needs_attention 边），
    //   只能用整库替换搬到 paused（与备份恢复的真实场景同构）。
    const id = await newExecution('d-paused-a');
    await toRunning(id);
    await addRunningAttempt(id);
    await restoreWithAttempts(id, ExecutionStatus.Paused);
    expect((await bundle.executions.getExecution(id))?.status).toBe(ExecutionStatus.Paused);
    const before = await snapshot(id);
    expect((before.attempts as Array<{ status: string }>)[0]!.status).toBe('running');

    await recoverZombieExecutions(bundle.executions, scope);

    const after = await snapshot(id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    // 决策要点：若只收敛 attempt 不收敛 execution，就会留下「paused 执行单 + 已终态 attempt」
    // ——用户点「继续」时无活 attempt 可续，是我们新引入的坏状态。
    expect((after.attempts as Array<{ status: string }>)[0]!.status).toBe('running');
  });

  it('needs_attention **不收敛**（自身即目标态，重启没破坏它的语义）', async () => {
    const id = await newExecution('d-na');
    await toNeedsAttention(id);
    const before = await snapshot(id);

    const summary = await recoverZombieExecutions(bundle.executions, scope);

    const after = await snapshot(id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect((after.execution as { status: string }).status).toBe(ExecutionStatus.NeedsAttention);
    expect(summary.executionsRecovered).toBe(0);
  });

  it('needs_attention 上挂着的僵尸 running attempt → 仅收敛 attempt，execution 状态不动', async () => {
    // 真实来源：恢复包里的 needs_attention 执行单 + 一个僵尸 running attempt（同一恢复包搬进来）。
    // 该行状态在正常路径下**造不出来**（无 running→needs_attention→挂活 attempt 的合法写法），
    // 故同样用整库替换搬运。
    const id = await newExecution('d-na-a');
    await toRunning(id);
    await addRunningAttempt(id);
    await restoreWithAttempts(id, ExecutionStatus.NeedsAttention);
    const beforeExec = await bundle.executions.getExecution(id);
    expect(beforeExec?.status).toBe(ExecutionStatus.NeedsAttention);

    const summary = await recoverZombieExecutions(bundle.executions, scope);

    const after = await bundle.executions.getExecution(id);
    expect(after?.status).toBe(ExecutionStatus.NeedsAttention);
    expect(after?.updatedAt).toBe(beforeExec!.updatedAt); // execution 行零写入
    const attempts = await bundle.executions.listAttempts(id);
    expect(attempts[0]!.status).toBe(AttemptStatus.Interrupted);
    expect(attempts[0]!.finishedAt).toBeTruthy();
    expect(summary.executionsRecovered).toBe(0);
    expect(summary.attemptsRecovered).toBe(1);
  });
});

/* ================================================================== *
 * attempt 收敛门禁的分支覆盖
 *
 * ★ 为什么单开一节：attempt 收敛门禁是 `!isTerminal(status) && status !== Paused`。
 *   若把它错误地收窄成「只处理 `execution.status === Running`」，本文件其余用例
 *   只会红 `needs_attention` 一条 —— 其余分支**零覆盖**。本节把门禁的每个分支
 *   都钉死，使任何收窄必然大面积变红。
 * ================================================================== */

describe('attempt 收敛门禁：活态 execution 的僵尸 running attempt', () => {
  /**
   * `awaiting_review` —— **正常状态机路径可达的真实场景**，不是「不该存在的数据」。
   *
   * 场景：execution 推进到 `running`、attempt 也在 `running`，此时**进程被强杀**。
   * attempt 的终态写入发生在进程内，进程没了就永远没写；而 execution 可能已经
   * 被推进到 `awaiting_review`（跑完了等人工审批）。重启后就是：
   * `awaiting_review` + 僵尸 `running` attempt（已实测复现，走的是合法状态链）。
   */
  it('awaiting_review 挂僵尸 running attempt：attempt → interrupted，execution 不动', async () => {
    const id = await newExecution('gate-review');
    // ★ 走合法状态链到 running，挂上 running attempt，**再**推进到 awaiting_review
    //   （不能复用 toAwaitingReview：它会从头再推一次链）。
    await toRunning(id);
    await addRunningAttempt(id);
    await setStatus(id, ExecutionStatus.AwaitingReview);
    const beforeExec = await bundle.executions.getExecution(id);
    expect(beforeExec?.status).toBe(ExecutionStatus.AwaitingReview);
    expect((await bundle.executions.listAttempts(id))[0]!.status).toBe(AttemptStatus.Running);

    const summary = await recoverZombieExecutions(bundle.executions, scope);

    // attempt 被收成 interrupted —— 语义上「本次已跑完，旧 attempt 不该停在 running」；
    // 这也正是「重试必须新建 attempt」（execution-state.ts:10-11）得以成立的前提。
    const attempts = await bundle.executions.listAttempts(id);
    expect(attempts[0]!.status).toBe(AttemptStatus.Interrupted);
    expect(attempts[0]!.finishedAt).toBeTruthy();
    // execution 不动：它等的是人工审批，重启没破坏这个语义（它不是僵尸态）。
    const after = await bundle.executions.getExecution(id);
    expect(after?.status).toBe(ExecutionStatus.AwaitingReview);
    expect(after?.updatedAt).toBe(beforeExec!.updatedAt);
    expect(summary.executionsRecovered).toBe(0);
    expect(summary.attemptsRecovered).toBe(1);
  });

  it('awaiting_review 收敛 attempt 后，重试路径未被堵死（可新开 attempt）', async () => {
    // 反向证据：若 attempt 不收成终态，`canStartAttempt=false` 会让「新建 attempt 重试」
    // 直接抛 Conflict —— 那才是真正的坏后果。这里断言收敛**打开**了重试路径。
    const id = await newExecution('gate-review-retry');
    await toRunning(id);
    await addRunningAttempt(id);
    await setStatus(id, ExecutionStatus.AwaitingReview);

    await recoverZombieExecutions(bundle.executions, scope);

    // 不抛 = 可以新开（若 attempt 还停在 running，仓储会抛「已存在非终态 attempt」）
    const fresh = await bundle.executions.createAttempt({
      executionId: id,
      status: AttemptStatus.Queued,
    });
    expect(fresh.attemptNo).toBe(2);
  });

  /**
   * 防御性覆盖：`draft` / `awaiting_confirmation` / `queued` 在**正常流程下不可达**
   * 「挂着 running attempt」（`running` 必须经 `queued` 且已人工确认，attempt 也只在
   * 该链路里启动）。这里用**真实仓储**构造（不绕仓储直塞 Dexie），锁住门禁的
   * **防御行为**：万一出现（手改库、恢复被篡改的包、将来新增入口），僵尸 attempt
   * 不应滞留在活态 execution 上。
   *
   * ⚠️ 不要把它们当成正常路径的特性来理解——它们锁的是「门禁边界」不是「业务语义」。
   */
  it.each([
    [ExecutionStatus.Draft, []],
    [ExecutionStatus.AwaitingConfirmation, [ExecutionStatus.AwaitingConfirmation]],
    [ExecutionStatus.Queued, [ExecutionStatus.AwaitingConfirmation, ExecutionStatus.Queued]],
  ] as const)(
    '【防御性】%s 挂僵尸 running attempt：attempt → interrupted，execution 不动',
    async (expectedStatus, steps) => {
      const id = await newExecution(`gate-def-${expectedStatus}`);
      for (const s of steps) await setStatus(id, s as ExecutionStatus);
      await addRunningAttempt(id);
      const beforeExec = await bundle.executions.getExecution(id);
      expect(beforeExec?.status).toBe(expectedStatus);

      const summary = await recoverZombieExecutions(bundle.executions, scope);

      const attempts = await bundle.executions.listAttempts(id);
      expect(attempts[0]!.status).toBe(AttemptStatus.Interrupted);
      const after = await bundle.executions.getExecution(id);
      expect(after?.status).toBe(expectedStatus); // execution 零变化
      expect(after?.updatedAt).toBe(beforeExec!.updatedAt);
      expect(summary.executionsRecovered).toBe(0);
      expect(summary.attemptsRecovered).toBe(1);
    },
  );

  it('门禁边界汇总：活态 execution 全部收敛 attempt，paused / 终态一律不动', async () => {
    // 一张表把门禁的每个分支钉死：任何收窄都会让本用例变红。
    const running = await newExecution('gate-all-running');
    await toRunning(running);
    await addRunningAttempt(running);

    const needs = await newExecution('gate-all-needs');
    await toRunning(needs);
    await addRunningAttempt(needs);
    await setStatus(needs, ExecutionStatus.NeedsAttention);

    const review = await newExecution('gate-all-review');
    await toRunning(review);
    await addRunningAttempt(review);
    await setStatus(review, ExecutionStatus.AwaitingReview);

    const paused = await newExecution('gate-all-paused');
    await toRunning(paused);
    await addRunningAttempt(paused);
    await setStatus(paused, ExecutionStatus.Paused);

    await recoverZombieExecutions(bundle.executions, scope);

    const statusOf = async (id: string) => (await bundle.executions.listAttempts(id))[0]!.status;
    // 活态（未终态、非 paused）→ 收敛
    expect(await statusOf(running)).toBe(AttemptStatus.Interrupted);
    expect(await statusOf(needs)).toBe(AttemptStatus.Interrupted);
    expect(await statusOf(review)).toBe(AttemptStatus.Interrupted);
    // paused → 刻意不收敛（execution 与 attempt 都不动）
    expect(await statusOf(paused)).toBe(AttemptStatus.Running);
    expect((await bundle.executions.getExecution(paused))?.status).toBe(ExecutionStatus.Paused);
  });
});

describe('僵尸判据：单一出处与备份恢复场景', () => {
  it('ZOMBIE_EXECUTION_STATUSES 只有 running（不是「全部非终态」）', () => {
    expect([...ZOMBIE_EXECUTION_STATUSES]).toEqual([ExecutionStatus.Running]);
    expect(isZombieExecutionStatus(ExecutionStatus.Running)).toBe(true);
    for (const s of [
      ExecutionStatus.Paused,
      ExecutionStatus.NeedsAttention,
      ExecutionStatus.Draft,
      ExecutionStatus.Queued,
    ]) {
      expect(isZombieExecutionStatus(s)).toBe(false);
    }
  });

  it('isZombieAttemptStatus：只有 running', () => {
    expect(isZombieAttemptStatus(AttemptStatus.Running)).toBe(true);
    expect(isZombieAttemptStatus(AttemptStatus.Queued)).toBe(false);
    expect(isZombieAttemptStatus(AttemptStatus.Interrupted)).toBe(false);
  });

  it('**备份恢复搬进来的 running**（绕过状态机）在同一函数下一次收敛', async () => {
    const id = await newExecution('r1');
    await toRunning(id);
    const row = await bundle.executions.getExecution(id);
    // 直接以 running 落库，模拟「恢复包里的 running」——这正是规格 §12 描述的场景
    await restoreAs(id, ExecutionStatus.Running);
    expect((await bundle.executions.getExecution(id))?.status).toBe(ExecutionStatus.Running);
    expect(row?.status).toBe(ExecutionStatus.Running);

    await recoverZombieExecutions(bundle.executions, scope);

    expect((await bundle.executions.getExecution(id))?.status).toBe(ExecutionStatus.NeedsAttention);
  });

  it('备份恢复搬进来的 paused / needs_attention 同样按决策保留', async () => {
    // 两条都要先造好（restoreWithAttempts 是整库替换，会清掉其他行）→ 一次搬运两行。
    const a = await newExecution('r2a');
    const b = await newExecution('r2b');
    await toRunning(a);
    await toRunning(b);
    const rowA = await bundle.executions.getExecution(a);
    const rowB = await bundle.executions.getExecution(b);
    await bundle.admin!.replaceAllImport({
      ...emptyPackage(),
      data: {
        ...emptyPackage().data,
        executions: [
          { ...rowA!, status: ExecutionStatus.Paused },
          { ...rowB!, status: ExecutionStatus.NeedsAttention },
        ],
      },
    });

    await recoverZombieExecutions(bundle.executions, scope);

    expect((await bundle.executions.getExecution(a))?.status).toBe(ExecutionStatus.Paused);
    expect((await bundle.executions.getExecution(b))?.status).toBe(ExecutionStatus.NeedsAttention);
  });

  it('多项目扫描：按 projectId 维度各收敛各的', async () => {
    const p1 = await bundle.executions.createExecution({
      projectId: 'p1',
      source: 'project-task',
      objective: 'a',
      idempotencyKey: 'k-p1',
    });
    const p2 = await bundle.executions.createExecution({
      projectId: 'p2',
      source: 'project-task',
      objective: 'b',
      idempotencyKey: 'k-p2',
    });
    for (const e of [p1, p2]) {
      await setStatus(e.id, ExecutionStatus.AwaitingConfirmation);
      await setStatus(e.id, ExecutionStatus.Queued);
      await setStatus(e.id, ExecutionStatus.Running);
    }

    const summary = await recoverZombieExecutions(bundle.executions, { projectIds: ['p1', 'p2'] });

    expect(summary.executionsRecovered).toBe(2);
    expect((await bundle.executions.getExecution(p1.id))?.status).toBe(
      ExecutionStatus.NeedsAttention,
    );
    expect((await bundle.executions.getExecution(p2.id))?.status).toBe(
      ExecutionStatus.NeedsAttention,
    );
  });

  it('项目 id 不在扫描范围时不动它（不会「顺手扫全库」）', async () => {
    const other = await bundle.executions.createExecution({
      projectId: 'p9',
      source: 'project-task',
      objective: 'z',
      idempotencyKey: 'k-p9',
    });
    await setStatus(other.id, ExecutionStatus.AwaitingConfirmation);
    await setStatus(other.id, ExecutionStatus.Queued);
    await setStatus(other.id, ExecutionStatus.Running);

    await recoverZombieExecutions(bundle.executions, { projectIds: ['p1'] });

    expect((await bundle.executions.getExecution(other.id))?.status).toBe(ExecutionStatus.Running);
  });
});
