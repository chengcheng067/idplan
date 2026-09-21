/**
 * 执行域「僵尸态」兜底（应用启动自愈）—— 共享实现，调用方只有两处。
 *
 * 问题（规格 `feature-dev-agent-board-2026-09-18.md` §12 L223 第 1 条）：
 *   一个 execution 停在 `running` / `paused` / `needs_attention` 时，应用进程被强杀 /
 *   崩溃 / 断电，重启后**没有任何调度器认领它们**；备份恢复更是整库替换、
 *   **完全绕过状态迁移校验**，把这些状态原样搬回来。
 *   用户看到「界面显示在跑、实际没人在跑」的假活态，直接击穿对控制台的信任。
 *
 * 本模块的纪律：
 *   1. **只走状态机已有的合法边**（`EXECUTION_TRANSITIONS` / `ATTEMPT_TRANSITIONS`），
 *      不新增状态、不改转移表、不绕过 `assertTransition` / `assertStatusTransition`。
 *      ⇒ 所有写入经 `IExecutionsRepository`（本地适配器内部在事务里跑校验），
 *        本模块**不直接碰 Dexie**。
 *   2. **零时间阈值**。判据是「本轮进程生命周期内不可能有执行在跑」——
 *      见 `DEFAULT_RECOVERY_REASON`。不用 `startedAt` / `updatedAt` 猜超时
 *      （执行域没有心跳 / 租约字段，猜必然出错）。
 *   3. **幂等**：重复调用（同一进程二次收敛、启动 + 导入各一次）不改动已正确的数据，
 *      不产生第二条审计事件。幂等靠「目标态不是僵尸态」这一事实，不是靠去重表。
 *   4. **不因单条失败而中断**：逐条隔离，返回逐条结果，失败向上汇总但不抛出
 *      ——「部分收敛」远好于「一条坏数据拦死启动」。
 *
 * ⚠️ 为什么不做成 `db.version(6).upgrade()`：僵尸态**不是 schema 变更**，
 *    挂 upgrade 需要无意义地 bump Dexie 版本号，而 v5 的注释已明确
 *    「新增四张表，纯增量」。启动装配流程 + 导入流程是更自然的挂载点。
 */

import { ExecutionStatus, AttemptStatus, ATTEMPT_NON_TERMINAL_STATUSES } from '../types/agent-execution';
import type { Execution, ExecutionAttempt, ExecutionEvent } from '../types/agent-execution';
import { ChangxiaError, ChangxiaErrorCode } from '../types/enums';
import type { IExecutionsRepository } from '../repositories/interfaces';
import { isTerminal, nextSeq } from './execution-state';

/**
 * 兜底的执行单写入审计流水时落的原因串（唯一的「本轮启动」标记）。
 *
 * ⚠️ 文案必须说真话（stale approval 收紧切片 · 分支乙）：
 * 本兜底把 `running` 收敛为 `needs_attention`，但**不触碰确认凭据**——
 * 因为 `needs_attention` 在状态机里**无法回到 `awaiting_confirmation`**（已实测其出边只有
 * running / cancelled / failed，无任何一条能到达 awaiting_confirmation），若在此清空确认，
 * 这条执行会陷入「凭据没了、又没有路径重新确认」的死胡同，永远跑不起来。
 * 故此处明确陈述：进程已不存在故收敛；**确认凭据保持不变**；若计划未变更，确认仍然有效，
 * 可重新进入 running（无需重新确认）。这与「同一计划重试不需要重新确认」的语义一致。
 */
export const DEFAULT_RECOVERY_REASON =
  '应用启动时发现该执行单处于运行中，但当前进程已不可能有执行在运行（进程重启 / 备份恢复绕过状态校验），收敛为待处理；确认凭据保持不变，若计划未变更则确认仍然有效、可重新进入运行（无需重新确认）。';

/** 兜底的 attempt 写入审计流水时落的原因串 */
export const DEFAULT_ATTEMPT_RECOVERY_REASON =
  '随执行单一同收敛：该 attempt 所属进程已不存在（进程重启 / 备份恢复绕过状态校验），打断为 interrupted。';

/**
 * ★ 兜底判据的**唯一出处**：哪些 execution 状态算「僵尸态」。
 *
 * 决策与理由（**刻意不是「全部非终态」**）：
 *
 *   - `running` → `needs_attention` ✅（状态机有此边：EXECUTION_TRANSITIONS.running）
 *     本轮进程刚启动，不可能有执行正在跑；而**绝不能**把用户强杀的那次执行谎报成
 *     `cancelled` / `failed`（用户没取消、也不一定失败）。`needs_attention` 的语义
 *     正是「需人工介入」，是唯一诚实且存在的归属。
 *
 *   - `paused` → **不收敛**。`paused` 是**用户主动**的暂停（合作式暂停，不启动新步骤），
 *     语义上就是「合法地停着、等着人来点继续」——它本来就要求人工介入，重启没有让它
 *     变得更糟。更要紧的是：**所有通往 `needs_attention` 的边里没有 `paused →` 这一条**
 *     （`paused` 只有 `running` / `cancelled`）。要在重启时收敛它，只剩两条路：
 *       ① `paused → cancelled`：**谎报**——用户没取消，却把它永久打成终态，
 *          且 `cancelled` 出边为空，用户**再也无法恢复**这次执行（不可逆的数据损伤）；
 *       ② `paused → running → needs_attention`：为「收敛」先把状态挪进 `running`
 *          ——而**「状态是 running 却没人跑」恰恰是本兜底要消灭的假活态**，
 *          等于用制造一次假活态来修假活态。
 *     两条路都比不收敛更坏，故**不动 `paused`**。这不是遗漏，是唯一不撒谎的选择。
 *
 *   - `needs_attention` → **不收敛**（自身，无需转移）。它**本来就是**「需要人关注」；
 *     重启既没有让它不再需要关注，也没有让「需要关注」这件事变得不成立 ——
 *     语义没有被破坏，不需要动。
 *
 *   ⇒ 故僵尸态**只有 `running`**。而「僵尸 attempt」= **`running` 的 attempt**
 *     （**不是**「非终态 attempt」：`queued` attempt 刻意不处理，
 *     理由见 `isZombieAttemptStatus` 的 docstring）。
 *
 * ⚠️ 本常量只管 **execution 层**。attempt 层的收敛门禁另有一条（见 `recoverExecution`），
 *    两者**不是同一个集合**：`needs_attention` / `awaiting_review` 不在本集合里
 *    （execution 不动），但它们的僵尸 attempt 仍会被收敛。
 */
export const ZOMBIE_EXECUTION_STATUSES: readonly ExecutionStatus[] = [ExecutionStatus.Running];

/** 某 execution 状态是否需要在启动 / 导入后被收敛 */
export function isZombieExecutionStatus(status: ExecutionStatus): boolean {
  return ZOMBIE_EXECUTION_STATUSES.includes(status);
}

/**
 * 某 attempt 是否需要在启动 / 导入后被收敛。
 *
 * **只有 `running`。** `running` 的进程已死，收敛为 `interrupted`
 * （`ATTEMPT_TRANSITIONS.running` 有这条边，`execution-state.ts:95 / 98-100` 明确
 * 它就是为「应用崩溃、用户强杀、调度撤回」预留的）。
 *
 * `queued` attempt **刻意不处理**（不是遗漏）：`ATTEMPT_TRANSITIONS` 里
 * `queued → interrupted` 这条边**根本不存在**，理由与本模块同一套 ——
 * 未启动的 attempt 没有「被打断」的语义（打断是对**正在运行**的东西的抢占），
 * 未启动的它本应走 `cancelled` / `failed`。既然启动兜底**只能走已有合法边**，
 * 也就没有一条合适的边可走：给它 `cancelled` 等于替用户取消（用户没取消），
 * 给它 `failed` 等于谎报失败（它压根没跑）。**故静默保留**，交由人来处置。
 * （另注：备份恢复进来的 `queued` attempt 若属于一个终态 execution，那是
 * 「终态 execution 却挂着未启动 attempt」的**数据矛盾**，属规格空白，本模块
 * 同样**不发明**它的归宿。）
 */
export function isZombieAttemptStatus(status: AttemptStatus): boolean {
  return status === AttemptStatus.Running;
}

/** attempt 僵尸态的收敛目标（唯一出处；改这里即改行为） */
export function recoveryTargetForAttempt(status: AttemptStatus): AttemptStatus | null {
  if (status === AttemptStatus.Running) return AttemptStatus.Interrupted;
  return null;
}

/* --------------------------- 终态 execution 上的活 attempt --------------------------- */

/**
 * ★ 「矛盾数据」判据的**唯一出处**：终态 execution 上挂着**未启动或非终态**的 attempt。
 *
 * ── 为什么算矛盾 ──
 * execution 落终态（`completed` / `failed` / `cancelled`）意味着「这次执行已经有结论」；
 * 而一个 `queued` / `running` 的 attempt 意味着「有一次尝试还没跑完」。两者不能同时为真：
 * 终态是执行单的**结论**，attempt 是结论所概括的**过程**，过程不可能在结论之后还活着。
 * 且状态机**没有任何一条边**能把它收口（下面详述），所以它会**永久留存**并持续误导。
 *
 * ── 为什么只是「识别」，不发明归宿 ──
 * 与 `isZombieAttemptStatus` 同源纪律（见其 docstring）：`ATTEMPT_TRANSITIONS` 里
 *   · `queued → interrupted` **不存在**（打断是对**正在运行**的东西的抢占）；
 *   · 给 `queued` 判 `cancelled` = 替用户取消（用户没取消）；
 *   · 给 `queued` 判 `failed` = 谎报失败（它压根没跑）；
 *   · 而 execution 已终态、出边为空，**无法**先把 execution 挪回活态再收口（那会谎报状态）。
 * 故本模块**原样保留**它，只把它**标出来给人看**——这正是本判据存在的全部理由。
 *
 * ── 为什么 `running` attempt 也算矛盾（与 `isZombieAttemptStatus` 的分工）──
 * `running` 的 attempt 会被启动兜底收成 `interrupted`（那是「进程死了」的处置）；
 * 但**兜底只在启动 / 导入时跑**，而每次兜底对终态 execution 都直接 `continue`
 * （见 `recoverZombieExecutions` 的「终态，绝不改动」硬边界）——于是终态 execution
 * 上的 `running` attempt **永远等不到收敛**，它同样是矛盾数据。
 * 即两个判据**服务不同目的、刻意不合并**：
 *   · `isZombieAttemptStatus` = 「该不该动手收敛」（只有 running，且 execution 必须活态）；
 *   · `isContradictoryAttempt` = 「该不该标给用户看」（queued 与 running 都算，不管 execution）。
 *
 * ── 边界（刻意排除的形态，附理由）──
 *   · **非终态 execution + 非终态 attempt** → 正常形态（`queued` execution 本就该挂
 *     一个 `queued` attempt）→ **不算矛盾**。
 *   · **终态 execution + 终态 attempt**（succeeded / failed / cancelled / interrupted）
 *     → 正常形态（执行跑完了，它的 attempt 也结束了）→ **不算矛盾**。
 *   · **终态 execution + `interrupted` attempt** → 正常形态：进程被杀 → 兜底把 attempt
 *     收成 `interrupted`，而 execution 可能早已是终态。**不算矛盾**。
 *     （这正是本判据必须用 `ATTEMPT_NON_TERMINAL_STATUSES` 而非「非 succeeded」的原因：
 *      后者会把「被中断」误报成矛盾。）
 *
 * @param execution 执行单（只要状态；不必传整个实体）
 * @param attempts  该执行单下的 attempt 集合
 */
export function isContradictoryExecution(
  execution: Pick<Execution, 'status'>,
  attempts: readonly Pick<ExecutionAttempt, 'status'>[],
): boolean {
  if (!isTerminal(execution.status)) return false;
  return attempts.some((a) => ATTEMPT_NON_TERMINAL_STATUSES.includes(a.status));
}

/**
 * 矛盾数据的类别标签（供界面按类别给不同文案；判据仍只有 `isContradictoryExecution` 一处）。
 *
 * `queued` 与 `running` 分开是因为**用户要采取的动作不同**：
 *   · `live`（有条 attempt 显示「执行中」）：最刺眼——界面会显示「在跑」而实际不可能在跑；
 *   · `pending`（只有未启动的 attempt）：显示「排队中」，同样不该存在但观感略轻。
 * 返回值取**最强的那一档**（有 running 就报 live）。
 */
export type ContradictionKind = 'live' | 'pending';

export function contradictionKind(
  attempts: readonly Pick<ExecutionAttempt, 'status'>[],
): ContradictionKind | null {
  if (attempts.some((a) => a.status === AttemptStatus.Running)) return 'live';
  if (attempts.some((a) => a.status === AttemptStatus.Queued)) return 'pending';
  return null;
}

/** 单条执行单的收敛结果 */
export interface ExecutionRecoveryOutcome {
  executionId: string;
  /** 收敛前的 execution 状态 */
  from: ExecutionStatus;
  /** 收敛后的 execution 状态（缺省 = 本次没动它） */
  to?: ExecutionStatus;
  /** 本次被收敛的 attempt 数 */
  attemptsRecovered: number;
  /** 该条是否在收敛过程中失败（失败原因见 reason，不抛给调用方） */
  failed: boolean;
  /** 跳过 / 失败的原因（诊断用） */
  reason?: string;
}

/** 一次兜底扫描的汇总 */
export interface RecoverySummary {
  /** 收敛的 execution 条数 */
  executionsRecovered: number;
  /** 收敛的 attempt 条数 */
  attemptsRecovered: number;
  /** 未收敛（含失败）的条数 */
  skipped: number;
  /** 逐条结果（含被跳过的，便于审计与测试断言） */
  outcomes: ExecutionRecoveryOutcome[];
}

/** 遍历全库用的 projectId 清单来源 */
export interface RecoveryScanScope {
  /** 全量 projectId（`projects.list({ status: 'all' })` 的 id 集） */
  projectIds: readonly string[];
}

function emptySummary(): RecoverySummary {
  return { executionsRecovered: 0, attemptsRecovered: 0, skipped: 0, outcomes: [] };
}

/**
 * 单条 execution 的收敛（幂等）。
 *
 * 顺序刻意如此：
 *   1. 先收敛 attempt（`interrupted`），再收敛 execution（`needs_attention`）。
 *      任一方向失败都不会留下「execution 已 needs_attention 但 attempt 还在 running」
 *      的错觉性假活态 —— 反序会。
 *   2. 每次写状态都紧跟一条审计事件（`status_changed` / `attempt_finished`），
 *      审计流水的 seq 由 `nextSeq(events)` 现算（仓储强制严格单调）。
 */
async function recoverExecution(
  repo: IExecutionsRepository,
  execution: Execution,
): Promise<ExecutionRecoveryOutcome> {
  const outcome: ExecutionRecoveryOutcome = {
    executionId: execution.id,
    from: execution.status,
    attemptsRecovered: 0,
    failed: false,
  };

  try {
    // ① attempt 层：僵尸 running → interrupted
    //
    // ★ 门禁：**执行单处于「活态」时才收敛它的 attempt**。界面上「在跑」的判据是
    //   execution **未达终态**，而不是「execution 本身需要被收敛」。逐个交代：
    //     - `running` → 要收敛（下面 ②），attempt 当然也收敛；
    //     - `needs_attention` → execution 不动（已在目标态），但它**仍是活态**：
    //       挂着的 running attempt 谁也不认领了，必须打断，否则留下
    //       「待处理 + 一个在跑的 attempt」这种误导性的半活状态；
    //     - `awaiting_review` → execution **不动**（它不是终态、也不是僵尸态：
    //       它等的是**人工审批**，重启并没有让「产物已产出、等验收」这件事变得不成立），
    //       但挂在它上面的 running attempt **必须收敛**。两条理由：
    //         ① 语义上 `awaiting_review` = 「本次执行**已经跑完**，等人工审批」，
    //            既然跑完了，那个 attempt 就不该停在 `running`（它是旧进程的遗留物，
    //            attempt 的终态写入发生在进程内，进程没了就永远没写）；
    //         ② 这正是 `execution-state.ts:10-11` 显式设计的形态 ——
    //            「`awaiting_review` 不允许回 `running`：重试必须**新建 attempt**」。
    //            故把旧 attempt 收成 `interrupted` 不新增任何非法边，反而是
    //            「重试要新建 attempt」这条纪律得以成立的前提（否则
    //            `canStartAttempt=false` 会把重试路径堵死，见下方 paused 同款后果）。
    //       ⚠️ 可达性（**不是**「不该存在的数据」）：正常状态机路径就能走到
    //          `running → awaiting_review` 而 attempt 仍为 `running`
    //          —— 进程恰在写入 attempt 终态之前被杀即可（已实测复现）。
    //     - `draft` / `awaiting_confirmation` / `queued` → 正常路径下**走不到**
    //       「挂着 running attempt」（`running` 必须经 `queued` 且已人工确认，
    //       attempt 也只在该链路里启动）。这里的收敛属**防御性覆盖**：
    //       万一出现（手改库、恢复被篡改的包、未来新增入口），不要让僵尸 attempt
    //       滞留在活态 execution 上。代价为零（这些状态下 attempt 本就该是终态）。
    //     - `paused` → **execution 与 attempt 都不动**，见下。
    //     - 终态 → 上游已 return，不会走到这里（attempt 的归属由 execution 的终态定义）。
    //
    // ★★ `paused` 的取舍及其**代价**（如实记录，结论仍是不收敛）：
    //   `paused` 是用户主动的合作式暂停，语义上就是「合法地停着、等人来点继续」，
    //   重启没有破坏它；而转移表里**没有** `paused → needs_attention` 边，强行收敛
    //   只剩两条坏路：`paused → cancelled` 是**谎报**（用户没取消，且 `cancelled`
    //   出边为空，用户**再也无法恢复**这次执行 —— 不可逆的数据损伤）；
    //   `paused → running → needs_attention` 则要先制造一次「状态是 running 却没人跑」
    //   ——**正是本兜底要消灭的假活态**。故不收敛，宁可留着。
    //
    //   **代价（实测，必须知情）**：若恢复包里的 `paused` execution 挂着一个僵尸
    //   `running` attempt，则 `canStartAttempt=false`（`createAttempt` 抛 Conflict
    //   「已存在非终态 attempt，不能新开」）且 `canComplete.ok=false`（非
    //   `awaiting_review`），即**该执行单卡住**：既不能新开 attempt，也不能进完成态。
    //   缓解路径是存在的——用户可点「继续」（`paused → running` 合法且实测成功），
    //   但此时那个僵尸 attempt 仍是 `running` 而**没有任何进展**，
    //   会一直显示为「在跑」，直到下一次启动兜底才被收成 `interrupted`。
    //   即：**不是硬死锁，但会跨一次重启才自愈**。这是为了让 `paused` 不被谎报取消
    //   而接受的代价；若将来有产品裁决允许询问用户「上次那个执行还算数吗」，
    //   应改为**交互式收敛**而不是在这里静默选一个终态。
    if (!isTerminal(execution.status) && execution.status !== ExecutionStatus.Paused) {
      const attempts = await repo.listAttempts(execution.id);
      for (const attempt of attempts) {
        if (!isZombieAttemptStatus(attempt.status)) continue;
        const target = recoveryTargetForAttempt(attempt.status);
        if (!target) continue;
        await asAttemptRecovery(repo, execution.id, attempt, target);
        outcome.attemptsRecovered += 1;
      }
    }

    // ② execution 层：僵尸态 → needs_attention
    if (!isZombieExecutionStatus(execution.status)) {
      // 合法地停着（paused / needs_attention）或尚未推进（draft / queued / awaiting_*）—— 一律不动。
      outcome.reason = '非僵尸态，无需收敛';
      return outcome;
    }

    const events = await repo.listEvents(execution.id);
    const from = execution.status;
    await repo.updateExecutionStatus(execution.id, {
      status: ExecutionStatus.NeedsAttention,
      blockedReason: DEFAULT_RECOVERY_REASON,
    });
    await repo.appendEvent({
      executionId: execution.id,
      seq: nextSeqOf(events),
      type: 'status_changed',
      actor: 'system',
      fromStatus: from,
      toStatus: ExecutionStatus.NeedsAttention,
      reason: DEFAULT_RECOVERY_REASON,
    });
    outcome.to = ExecutionStatus.NeedsAttention;
    return outcome;
  } catch (err) {
    outcome.failed = true;
    outcome.reason = err instanceof ChangxiaError ? err.userMessage : String(err);
    return outcome;
  }
}

/**
 * 收敛单条僵尸 attempt：`running → interrupted`，并把该次打断写进审计流水。
 *
 * `finishedAt` 由仓储在进入终态时统一盖上（local 适配器 L250-252），
 * 此处显式传 `now` 以便「进程被杀的那一刻」在数据上可读且与 `updatedAt` 同源。
 */
async function asAttemptRecovery(
  repo: IExecutionsRepository,
  executionId: string,
  attempt: ExecutionAttempt,
  target: AttemptStatus,
): Promise<void> {
  const now = new Date().toISOString();
  await repo.updateAttempt(attempt.id, {
    status: target,
    finishedAt: now,
    terminalReason: DEFAULT_ATTEMPT_RECOVERY_REASON,
  });
  const events = await repo.listEvents(executionId);
  await repo.appendEvent({
    executionId,
    attemptId: attempt.id,
    seq: nextSeqOf(events),
    type: 'attempt_finished',
    actor: 'system',
    fromStatus: null,
    toStatus: null,
    reason: DEFAULT_ATTEMPT_RECOVERY_REASON,
  });
}

/** nextSeq 的唯一取用点（单一出处，避免各处再写一遍 max+1） */
function nextSeqOf(events: readonly ExecutionEvent[]): number {
  return nextSeq(events);
}

/**
 * **共享兜底入口**（启动装配点与备份导入后**调用同一个函数**，不存在第二份实现）。
 *
 * 调用时机（见 `di/repository.provider.tsx` 与 `core/services/backup.service.ts`）：
 *   - `RepoSourcesReady`（仓储刚装配完成、首屏数据装载之前）；
 *   - `BackupService.importAndReplace` 落库成功之后（备份恢复绕过状态机的补位）。
 *
 * 幂等：重复调用对已收敛数据零写入（`needs_attention` / `interrupted` 都不在僵尸集合里）。
 * 不抛错：单条失败只记进 `outcomes[].failed`，`skipped` 计数。
 */
export async function recoverZombieExecutions(
  repo: IExecutionsRepository,
  scope: RecoveryScanScope,
): Promise<RecoverySummary> {
  const summary = emptySummary();
  if (scope.projectIds.length === 0) return summary;

  for (const projectId of scope.projectIds) {
    let executions: Execution[];
    try {
      executions = await repo.listExecutionsByProject(projectId);
    } catch (err) {
      summary.skipped += 1;
      summary.outcomes.push({
        executionId: `(project:${projectId})`,
        from: ExecutionStatus.Draft,
        attemptsRecovered: 0,
        failed: true,
        reason: err instanceof ChangxiaError ? err.userMessage : String(err),
      });
      continue;
    }

    for (const execution of executions) {
      // 终态 execution 一律不碰 —— 这是本兜底的硬边界（防误伤）。
      if (isTerminal(execution.status)) {
        summary.skipped += 1;
        summary.outcomes.push({
          executionId: execution.id,
          from: execution.status,
          attemptsRecovered: 0,
          failed: false,
          reason: '终态，绝不改动',
        });
        continue;
      }
      const outcome = await recoverExecution(repo, execution);
      summary.outcomes.push(outcome);
      summary.attemptsRecovered += outcome.attemptsRecovered;
      if (outcome.to) {
        summary.executionsRecovered += 1;
      } else if (!outcome.failed) {
        summary.skipped += 1;
      }
      if (outcome.failed) summary.skipped += 1;
    }
  }
  return summary;
}
