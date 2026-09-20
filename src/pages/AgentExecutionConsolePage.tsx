/**
 * Agent 执行控制台（只读）。
 *
 * 定位：执行域数据层（`executions` 仓储，第一切片）早已落地，但界面里完全看不到。
 * 本页把已有数据**呈现**出来——只读，不新增写操作、不改状态、不派活。
 *
 * 唯一取数入口是 `useRepos()`（铁律 4），只调用五个读方法：
 *   listExecutionsByProject / getExecution / listAttempts / listEvents / listProposals
 * 仓储没有「全项目执行单」查询，故先 list 项目、再逐项目取执行单。
 *
 * 状态→样式一律走静态映射表（BUG-05：Tailwind 静态扫描，禁用模板字符串拼类名）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  ClipboardList,
  FileDiff,
  Loader2,
  RefreshCw,
  ScrollText,
  Terminal,
} from 'lucide-react';

import { useRepos } from '../hooks/useRepos';
import { useUiStore } from '../store/useUiStore';
import { ChangxiaError, ChangxiaErrorCode } from '../core/types/enums';
import {
  AttemptStatus,
  ExecutionStatus,
  WritebackProposalStatus,
} from '../core/types/agent-execution';
import type {
  Execution,
  ExecutionAttempt,
  ExecutionEvent,
  WritebackProposal,
} from '../core/types/agent-execution';
import {
  contradictionKind,
  isContradictoryExecution,
  type ContradictionKind,
} from '../core/execution/execution-recovery';
import { isTerminal } from '../core/execution/execution-state';

/* ------------------------------------------------------------------ *
 * 语义分组：终态 / 进行中 / 需关注
 * ------------------------------------------------------------------ */

/** 终态——不会再变化，视觉上「沉下去」。 */
const TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  ExecutionStatus.Completed,
  ExecutionStatus.Failed,
  ExecutionStatus.Cancelled,
];

/** 需关注——需要人介入，视觉上「浮起来 + 暖色」。 */
const ATTENTION_STATUSES: readonly ExecutionStatus[] = [
  ExecutionStatus.NeedsAttention,
  ExecutionStatus.AwaitingConfirmation,
  ExecutionStatus.AwaitingReview,
];

/**
 * 终态判定**复用状态机的唯一出处**（`isTerminal` 由 `EXECUTION_TRANSITIONS` 出边是否为空得出），
 * 不在此处再维护一份终态清单。
 *
 * ⚠️ 本文件顶部另有一份 `TERMINAL_STATUSES`（v5 起就存在），它现在**只用于展示**，
 * **判据一律走 `isTerminal`** —— 两份清单若分叉（新增终态时漏改一处），
 * 「矛盾数据」会认错，而那正是本页最不能出错的地方。
 */
function needsAttention(s: ExecutionStatus): boolean {
  return ATTENTION_STATUSES.includes(s);
}

/* ------------------------------------------------------------------ *
 * 矛盾数据（终态 execution 上挂非终态 attempt）
 * ------------------------------------------------------------------ */

/**
 * 界面侧的矛盾数据描述。
 *
 * 判据**不在这里**：`isContradictoryExecution` / `contradictionKind` 都在
 * `core/execution/execution-recovery.ts`（那个模块的 docstring 早已把这个形态
 * 明确记为「数据矛盾 · 本模块不发明它的归宿」，只是没人把它变成可判定的函数）。
 * 放在那里而不是这里，理由有三：
 *   ① 它是**领域判定**而非界面逻辑 —— 兜底模块决定了「不收敛、原样保留」，
 *      那么「保留下来的是什么东西」理应由同一个模块定义，两处描述同一形态必分叉；
 *   ② 它要能脱离 React 被单测直接覆盖（本页的 UI 断言只能覆盖到「标记显示了」，
 *      覆盖不到边界：终态+终态 attempt 不算、非终态+queued 不算）；
 *   ③ 将来若服务端 / 备份校验也要识别它，import 路径不必反过来依赖 pages/。
 */
const CONTRADICTION_LABEL: Record<ContradictionKind, string> = {
  live: '数据矛盾：该执行单已结束，却有尝试仍显示「执行中」',
  pending: '数据矛盾：该执行单已结束，却有尝试仍处于「排队中」',
};

/** 列表顶部统计条用的固定文案（不随条目变化，故不走 label 映射） */
const CONTRADICTION_HINT =
  '这类记录是终态执行单上残留的未结束尝试（多为进程被杀或备份恢复绕过状态校验所致）。状态机没有合法转移可收口，故按原样保留、仅供识别。';

/**
 * 从 attempt 集合里挑出标记上要指名的那个号。
 *
 * 优先 `running`（矛盾最刺眼的那一条），其次 `queued`，都与 `contradictionKind`
 * 的择取口径一致 —— 两处若不一致，会出现「标记说『执行中』、括号里写的是排队中」。
 * 集合未装载（未展开详情）时返回 null，标记上就不带号，**不猜**。
 */
function firstLiveAttemptNo(attempts: readonly ExecutionAttempt[] | null): number | null {
  if (!attempts || attempts.length === 0) return null;
  const running = attempts.find((a) => a.status === AttemptStatus.Running);
  if (running) return running.attemptNo;
  const queued = attempts.find((a) => a.status === AttemptStatus.Queued);
  return queued ? queued.attemptNo : null;
}

/* ------------------------------------------------------------------ *
 * 状态→样式 静态映射表（10 个 ExecutionStatus 全覆盖）
 * ------------------------------------------------------------------ */

/**
 * 徽标配色。三组语义：
 * - 需关注：rose / amber（暖色，提示人来看）
 * - 进行中：pine / moss（冷色，自动在跑）
 * - 终态：成功 pine、失败 rose、取消 mist（沉下去）
 * 兜底项（未列举的状态）落在 mist，保证 `Record` 完整 + 运行期不崩。
 */
const EXEC_STATUS_BADGE_CLASS: Record<ExecutionStatus, string> = {
  [ExecutionStatus.Draft]: 'border-line bg-sunken text-mist',
  [ExecutionStatus.AwaitingConfirmation]: 'border-amber bg-amber-soft text-amber-deep',
  [ExecutionStatus.Queued]: 'border-line bg-paper text-ink',
  [ExecutionStatus.Running]: 'border-pine bg-pine-soft text-pine',
  [ExecutionStatus.Paused]: 'border-line bg-sand text-ink',
  [ExecutionStatus.NeedsAttention]: 'border-rose bg-rose-soft text-rose',
  [ExecutionStatus.AwaitingReview]: 'border-amber bg-amber-soft text-amber-deep',
  [ExecutionStatus.Completed]: 'border-moss bg-moss-soft text-moss',
  [ExecutionStatus.Failed]: 'border-rose bg-rose-soft text-rose',
  [ExecutionStatus.Cancelled]: 'border-line bg-sunken text-mist',
};

/** 列表左缘色条：一眼扫出「哪些要管」。 */
const EXEC_STATUS_RAIL_CLASS: Record<ExecutionStatus, string> = {
  [ExecutionStatus.Draft]: 'bg-line',
  [ExecutionStatus.AwaitingConfirmation]: 'bg-amber',
  [ExecutionStatus.Queued]: 'bg-mist',
  [ExecutionStatus.Running]: 'bg-pine',
  [ExecutionStatus.Paused]: 'bg-sand',
  [ExecutionStatus.NeedsAttention]: 'bg-rose',
  [ExecutionStatus.AwaitingReview]: 'bg-amber',
  [ExecutionStatus.Completed]: 'bg-moss',
  [ExecutionStatus.Failed]: 'bg-rose',
  [ExecutionStatus.Cancelled]: 'bg-line',
};

const EXEC_STATUS_LABEL: Record<ExecutionStatus, string> = {
  [ExecutionStatus.Draft]: '草稿',
  [ExecutionStatus.AwaitingConfirmation]: '待确认',
  [ExecutionStatus.Queued]: '排队中',
  [ExecutionStatus.Running]: '执行中',
  [ExecutionStatus.Paused]: '已暂停',
  [ExecutionStatus.NeedsAttention]: '需关注',
  [ExecutionStatus.AwaitingReview]: '待复核',
  [ExecutionStatus.Completed]: '已完成',
  [ExecutionStatus.Failed]: '已失败',
  [ExecutionStatus.Cancelled]: '已取消',
};

const ATTEMPT_STATUS_BADGE_CLASS: Record<AttemptStatus, string> = {
  [AttemptStatus.Queued]: 'border-line bg-paper text-ink',
  [AttemptStatus.Running]: 'border-pine bg-pine-soft text-pine',
  [AttemptStatus.Succeeded]: 'border-moss bg-moss-soft text-moss',
  [AttemptStatus.Failed]: 'border-rose bg-rose-soft text-rose',
  [AttemptStatus.Cancelled]: 'border-line bg-sunken text-mist',
  [AttemptStatus.Interrupted]: 'border-amber bg-amber-soft text-amber-deep',
};

const ATTEMPT_STATUS_LABEL: Record<AttemptStatus, string> = {
  [AttemptStatus.Queued]: '排队中',
  [AttemptStatus.Running]: '执行中',
  [AttemptStatus.Succeeded]: '成功',
  [AttemptStatus.Failed]: '失败',
  [AttemptStatus.Cancelled]: '已取消',
  [AttemptStatus.Interrupted]: '被中断',
};

const PROPOSAL_STATUS_BADGE_CLASS: Record<WritebackProposalStatus, string> = {
  [WritebackProposalStatus.Draft]: 'border-line bg-sunken text-mist',
  [WritebackProposalStatus.Proposed]: 'border-amber bg-amber-soft text-amber-deep',
  [WritebackProposalStatus.Applied]: 'border-moss bg-moss-soft text-moss',
  [WritebackProposalStatus.Rejected]: 'border-line bg-sand text-ink',
  [WritebackProposalStatus.Conflict]: 'border-rose bg-rose-soft text-rose',
};

const PROPOSAL_STATUS_LABEL: Record<WritebackProposalStatus, string> = {
  [WritebackProposalStatus.Draft]: '草稿',
  [WritebackProposalStatus.Proposed]: '待应用',
  [WritebackProposalStatus.Applied]: '已应用',
  [WritebackProposalStatus.Rejected]: '已驳回',
  [WritebackProposalStatus.Conflict]: '冲突',
};

const ACTOR_LABEL: Record<string, string> = {
  user: '人',
  agent: 'Agent',
  system: '系统',
  external: '外部',
};

const SOURCE_LABEL: Record<string, string> = {
  'project-task': '项目任务',
  'member-board': '成员看板',
  manual: '手动',
};

/* ------------------------------------------------------------------ *
 * 小组件
 * ------------------------------------------------------------------ */

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-2xl border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

/** 极简时间显示：只到分钟，且把 ISO 的 T 换成空格。空值显式显示「—」。 */
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ');
}

/** 持续时间（分钟）。缺开始或结束返回 null，由调用方显示占位。 */
function durationMinutes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 60000);
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-mist">{label}</span>
      <span className="truncate text-sm text-ink" title={typeof value === 'string' ? value : undefined}>
        {value}
      </span>
    </div>
  );
}

function SectionTitle({
  Icon,
  title,
  count,
}: {
  Icon: typeof Activity;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-mist" aria-hidden="true" />
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <span className="text-xs text-mist">{count}</span>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p className="rounded-2xl bg-sunken px-4 py-3 text-sm text-mist">{text}</p>
  );
}

/* ------------------------------------------------------------------ *
 * 矛盾数据标记
 * ------------------------------------------------------------------ */

/**
 * 矛盾数据的**视觉标识**：实心底 `clay`（danger）+ 圆点，**不是 Badge 同款描边**。
 *
 * ── 为什么不用 amber / rose，而用 clay ──
 * 状态徽标已经用掉三组色（见 `EXEC_STATUS_BADGE_CLASS`）：
 *   · amber  = 待确认 / 待复核（「等你点一下」）
 *   · rose   = 需关注 / 已失败（「出事了」）
 *   · pine/moss/mist = 进行中 / 成功 / 沉下去
 * 矛盾数据若再用 amber 或 rose，用户会把「数据矛盾」与「状态是 pending」混为一谈
 * ——而这两件事的处置完全不同：前者**当前无法通过界面修复**，后者**点一下就好**。
 * `clay` 在本项目里是 semantic-danger（逾期 / 危险），**从未被状态徽标占用**，
 * 是唯一不会与既有语义撞车的选择。
 *
 * ── 为什么必须与状态徽标**形态不同**（同色系也不行）──
 * 因为矛盾数据的定义本身就是「**状态徽标在撒谎**」：徽标写「已完成」而旁边有东西在跑。
 * 标记若长得像徽标，两者并排时用户会当成两个同级状态去比较，而真相是
 * 「其中一个不可信」。故标记用**实心底 + 左侧警示条**的形态（徽标一律描边淡底），
 * 一眼可辨「这不是一个状态，这是一句告示」。
 *
 * ── 文案为什么这么长 ──
 * 它必须同时说清三件事，缺一件用户就会去点它并期待能修好：
 *   ① 出了什么事（执行单已结束，却有尝试没结束）；
 *   ② 看到的是什么（`attempt` 的原始状态，逐字引用，不替用户解释）；
 *   ③ 为什么修不了（本页只读，且状态机没有合法边可收口）。
 * 短文案（如「异常」）会把用户推向「刷新一下应该就好了」的错误预期。
 */
function ContradictionMark({
  kind,
  attemptNo,
}: {
  kind: ContradictionKind;
  attemptNo: number | null;
}) {
  return (
    <span
      data-exec-contradiction={kind}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl bg-clay px-2 py-0.5 text-xs font-medium text-white"
      title={`${CONTRADICTION_LABEL[kind]}${attemptNo === null ? '' : `（尝试 #${attemptNo}）`}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/90" aria-hidden="true" />
      {CONTRADICTION_LABEL[kind]}
      {attemptNo === null ? null : `（尝试 #${attemptNo}）`}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * 详情：attempts / events / proposals
 * ------------------------------------------------------------------ */

interface ExecutionDetail {
  attempts: ExecutionAttempt[];
  events: ExecutionEvent[];
  proposals: WritebackProposal[];
}

function AttemptRow({ a }: { a: ExecutionAttempt }) {
  const mins = durationMinutes(a.startedAt, a.finishedAt);
  return (
    <li className="flex flex-col gap-1 rounded-2xl bg-sunken px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">尝试 #{a.attemptNo}</span>
        <Badge className={ATTEMPT_STATUS_BADGE_CLASS[a.status]}>
          {ATTEMPT_STATUS_LABEL[a.status]}
        </Badge>
        <span className="ml-auto text-xs text-mist">
          {fmtTime(a.startedAt)} → {fmtTime(a.finishedAt)}
          {mins === null ? '' : ` · ${mins} 分钟`}
        </span>
      </div>
      {a.errorCode || a.errorSummary ? (
        <p className="text-xs text-rose">
          {a.errorCode ? `[${a.errorCode}] ` : ''}
          {a.errorSummary ?? ''}
        </p>
      ) : null}
      {a.terminalReason ? (
        <p className="text-xs text-mist">结束原因：{a.terminalReason}</p>
      ) : null}
    </li>
  );
}

function EventRow({ e }: { e: ExecutionEvent }) {
  const transition =
    e.fromStatus || e.toStatus
      ? `${e.fromStatus ? EXEC_STATUS_LABEL[e.fromStatus] : '—'} → ${
          e.toStatus ? EXEC_STATUS_LABEL[e.toStatus] : '—'
        }`
      : null;
  return (
    <li className="flex items-start gap-3 px-1 py-2">
      <span className="mt-0.5 w-8 shrink-0 text-right text-xs tabular-nums text-mist">
        {e.seq}
      </span>
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink">{e.type}</span>
          <span className="text-xs text-mist">{ACTOR_LABEL[e.actor] ?? e.actor}</span>
          <span className="ml-auto text-xs text-mist">{fmtTime(e.createdAt)}</span>
        </div>
        {transition ? <p className="text-xs text-mist">{transition}</p> : null}
        {e.reason ? <p className="text-xs text-mist">原因：{e.reason}</p> : null}
      </div>
    </li>
  );
}

function ProposalRow({ p }: { p: WritebackProposal }) {
  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-sunken px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={PROPOSAL_STATUS_BADGE_CLASS[p.status]}>
          {PROPOSAL_STATUS_LABEL[p.status]}
        </Badge>
        <span className="text-xs text-mist">
          {p.decidedBy ? `裁决人 ${p.decidedBy}` : '尚无裁决'}
          {p.decidedAt ? ` · ${fmtTime(p.decidedAt)}` : ''}
        </span>
        <span className="ml-auto text-xs text-mist">{fmtTime(p.createdAt)}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {p.operations.map((op, i) => (
          <li key={`${op.field}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
            <code className="rounded bg-paper px-1.5 py-0.5 text-ink">{op.field}</code>
            <span className="text-mist line-through">{String(op.before ?? '—')}</span>
            <ChevronRight className="h-3 w-3 text-mist" aria-hidden="true" />
            <span className="text-ink">{String(op.after ?? '—')}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function ExecutionDetailPanel({
  missing,
  detail,
  loading,
  error,
}: {
  missing: boolean;
  detail: ExecutionDetail | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-mist" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        正在读取执行明细…
      </div>
    );
  }
  // 执行单缺失 / 读取失败时若连明细都没拿到，只渲染提示条。
  if (!detail) {
    if (!error) return null;
    return (
      <div className="px-4 py-4">
        <p
          className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${
            missing
              ? 'border-amber bg-amber-soft text-amber-deep'
              : 'border-rose bg-rose-soft text-rose'
          }`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col border-t border-line">
      {/*
        非 happy-path：执行单已被删除（getExecution 返回 null）或明细读取报错。
        提示条与已拿到的明细**同时**渲染——不静默丢弃仍可展示的数据。
      */}
      {error ? (
        <div className="px-4 pt-4">
          <p
            className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${
              missing
                ? 'border-amber bg-amber-soft text-amber-deep'
                : 'border-rose bg-rose-soft text-rose'
            }`}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-3">
        <section className="flex flex-col gap-2">
          <SectionTitle Icon={Activity} title="执行尝试" count={detail.attempts.length} />
          {detail.attempts.length === 0 ? (
            <EmptyLine text="尚无执行尝试。" />
          ) : (
            <ul className="flex flex-col gap-2">
              {detail.attempts.map((a) => (
                <AttemptRow key={a.id} a={a} />
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionTitle Icon={ScrollText} title="事件流水" count={detail.events.length} />
          {detail.events.length === 0 ? (
            <EmptyLine text="尚无事件流水。" />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {detail.events.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionTitle Icon={FileDiff} title="写回提案" count={detail.proposals.length} />
          {detail.proposals.length === 0 ? (
            <EmptyLine text="尚无写回提案。" />
          ) : (
            <ul className="flex flex-col gap-2">
              {detail.proposals.map((p) => (
                <ProposalRow key={p.id} p={p} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 单条执行单
 * ------------------------------------------------------------------ */

function ExecutionCard({
  execution,
  expanded,
  onToggle,
  detail,
  detailLoading,
  detailError,
  detailMissing,
  contradiction,
  contradictionAttemptNo,
}: {
  execution: Execution;
  expanded: boolean;
  onToggle: () => void;
  detail: ExecutionDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  detailMissing: boolean;
  /** 矛盾数据类别（null = 非矛盾）；由上层用 `contradictionKind` 算出 */
  contradiction: ContradictionKind | null;
  /**
   * 标记上要指名的 attempt 号（null = 判不出，标记不带号）。
   * 由上层从**列表装载时取到的 attemptMap** 算出，而不是从 `detail` ——
   * `detail` 只在展开时才有，用它会让标记在折叠状态下缺一个关键信息，
   * 而「折叠时也看得出是哪一次尝试」正是标记存在的意义。
   */
  contradictionAttemptNo: number | null;
}) {
  const mins = durationMinutes(execution.startedAt, execution.finishedAt);
  return (
    <li
      className="soft-card overflow-hidden"
      data-exec-contradiction-card={contradiction ?? undefined}
    >
      <div className={`flex items-stretch ${isTerminal(execution.status) ? 'opacity-90' : ''}`}>
        <span
          className={`w-1 shrink-0 ${
            contradiction !== null ? 'bg-clay' : EXEC_STATUS_RAIL_CLASS[execution.status]
          }`}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="soft-focus-halo flex flex-1 flex-col gap-3 rounded-3xl px-4 py-3 text-left transition-colors hover:bg-sand"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={EXEC_STATUS_BADGE_CLASS[execution.status]}>
              {EXEC_STATUS_LABEL[execution.status]}
            </Badge>
            {needsAttention(execution.status) ? (
              <AlertTriangle className="h-4 w-4 text-amber-deep" aria-hidden="true" />
            ) : null}
            <span className="text-xs text-mist">
              {SOURCE_LABEL[execution.source] ?? execution.source}
            </span>
            {execution.channelKind ? (
              <span className="text-xs text-mist">· {execution.channelKind}</span>
            ) : null}
            <ChevronRight
              className={`ml-auto h-4 w-4 shrink-0 text-mist transition-transform ${
                expanded ? 'rotate-90' : ''
              }`}
              aria-hidden="true"
            />
          </div>

          {contradiction !== null ? (
            <ContradictionMark kind={contradiction} attemptNo={contradictionAttemptNo} />
          ) : null}

          <p className="text-md font-medium text-ink">{execution.objective}</p>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="创建" value={fmtTime(execution.createdAt)} />
            <Field label="开始" value={fmtTime(execution.startedAt)} />
            <Field label="结束" value={fmtTime(execution.finishedAt)} />
            <Field
              label="耗时"
              value={mins === null ? '—' : `${mins} 分钟`}
            />
          </div>

          {execution.blockedReason ? (
            <p className="text-xs text-amber-deep">阻塞：{execution.blockedReason}</p>
          ) : null}
          {execution.terminalReason && isTerminal(execution.status) ? (
            <p className="text-xs text-mist">结束原因：{execution.terminalReason}</p>
          ) : null}
        </button>
      </div>

      {expanded ? (
        <ExecutionDetailPanel
          missing={detailMissing}
          detail={detail}
          loading={detailLoading}
          error={detailError}
        />
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * 页面主体
 * ------------------------------------------------------------------ */

interface ProjectBucket {
  projectId: string;
  projectName: string;
  executions: Execution[];
  /**
   * executionId → 其 attempt 集合（`null` = 该条取数失败，判定不出矛盾）。
   * 用于列表侧标记与开关过滤（详见装载 effect 的注释）。
   */
  attemptMap: Map<string, ExecutionAttempt[] | null>;
}

type LoadState = 'loading' | 'ready' | 'error';

export function AgentExecutionConsolePage() {
  const repos = useRepos();
  // 逐字段订阅（zustand 默认整 store 订阅；只取需要的两个，避免无关 UI 状态变化触发重渲）
  const showContradictory = useUiStore((s) => s.showContradictoryExecutions);
  const setShowContradictoryExecutions = useUiStore((s) => s.setShowContradictoryExecutions);

  const [state, setState] = useState<LoadState>('loading');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<ProjectBucket[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailMissing, setDetailMissing] = useState(false);

  const message = useCallback((err: unknown, fallback: string): string => {
    return err instanceof ChangxiaError ? err.userMessage : fallback;
  }, []);

  /* —— 装载列表 —— */
  useEffect(() => {
    let alive = true;
    setState('loading');
    setErrorText(null);

    (async () => {
      try {
        const projects = await repos.projects.list();
        const collected: ProjectBucket[] = [];
        /**
         * 矛盾判定需要 attempt 集合，而 `Execution` 实体里**没有**它
         * （`currentAttemptNo` 只是计数，且服务端在读路径现算，不含状态分布）。
         * 故列表装载时对每条执行单补一次 `listAttempts`。
         *
         * ── 为什么在列表装载时就取，而不是等展开 ——
         * 标记必须**在折叠状态下也可见**，否则「默认显示异常」这个立场就落空了：
         * 用户得先逐条点开才知道哪条有问题，等于没标。
         *
         * ── 代价（如实记录）──
         * 每多一条执行单多一次请求。本页是**只读控制台**，不是高频页面，
         * 且 `listAttempts` 返回的是单条 execution 的 attempt（通常 1~3 条），
         * 量级远小于列表本身。相比之下「标记看不见」是产品缺陷，不值得为省几个
         * 请求去换。若将来执行单数量真的上万，应改服务端提供批量端点
         * （`/projects/:id/executions` 带上 attempt 摘要），**不是**把判定挪到前端偷懒。
         *
         * ── 取数失败不整页崩 ──
         * 单条 attempt 读失败只记 `null`（=判定不出矛盾，标记不显示），
         * 不让一次局部故障把整页推入错误态 —— 那会连带遮住所有正常记录。
         */
        for (const p of projects) {
          const rows = await repos.executions.listExecutionsByProject(p.id);
          if (rows.length === 0) continue;
          const attemptPairs = await Promise.all(
            rows.map(async (e) => {
              try {
                return [e.id, await repos.executions.listAttempts(e.id)] as const;
              } catch {
                return [e.id, null] as const;
              }
            }),
          );
          const attemptMap = new Map<string, ExecutionAttempt[] | null>(attemptPairs);
          collected.push({ projectId: p.id, projectName: p.name, executions: rows, attemptMap });
        }

        if (!alive) return;
        setBuckets(collected);
        setState('ready');
      } catch (err) {
        if (!alive) return;
        setErrorText(message(err, '执行记录读取失败。'));
        setState('error');
      }
    })();

    return () => {
      alive = false;
    };
  }, [repos, message, reloadToken]);

  /* —— 展开装载详情 —— */
  useEffect(() => {
    if (!expandedId) {
      setDetail(null);
      setDetailError(null);
      setDetailMissing(false);
      return;
    }
    let alive = true;
    setDetail(null);
    setDetailError(null);
    setDetailMissing(false);
    setDetailLoading(true);

    (async () => {
      try {
        const [execution, attempts, events, proposals] = await Promise.all([
          repos.executions.getExecution(expandedId),
          repos.executions.listAttempts(expandedId),
          repos.executions.listEvents(expandedId),
          repos.executions.listProposals(expandedId),
        ]);
        if (!alive) return;
        // 非 happy-path：执行单可能已被删除（getExecution 返回 null）。
        // 此时不崩、不空白：给出明确提示，其余三组明细照常展示（不静默丢数据）。
        setDetail({ attempts, events, proposals });
        if (!execution) {
          setDetailMissing(true);
          setDetailError('该执行单已不存在，可能已被删除。以下为仍保留的明细数据。');
        }
      } catch (err) {
        if (!alive) return;
        setDetailError(message(err, '执行明细读取失败。'));
      } finally {
        if (alive) setDetailLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [repos, expandedId, message]);

  /**
   * 矛盾判定表：executionId → 类别（null = 非矛盾）。
   *
   * 判定**只在这里做一次**，下游（统计、开关过滤、列表标记）全部读这张表 ——
   * 若各处自行调用 `contradictionKind`，一次判据变更就要改多处，
   * 且「统计说 3 条、列表只标 2 条」这类不一致几乎必然出现。
   */
  const contradictionById = useMemo(() => {
    const map = new Map<string, ContradictionKind | null>();
    for (const b of buckets) {
      for (const e of b.executions) {
        const attempts = b.attemptMap.get(e.id) ?? null;
        map.set(
          e.id,
          attempts !== null && isContradictoryExecution(e, attempts)
            ? contradictionKind(attempts)
            : null,
        );
      }
    }
    return map;
  }, [buckets]);

  /** 仅统计**判定得出**的矛盾（取数失败的条目不冒充矛盾，也不冒充正常） */
  const contradictionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, kind] of contradictionById) {
      if (kind !== null) ids.add(id);
    }
    return ids;
  }, [contradictionById]);

  const totalCount = useMemo(() => buckets.reduce((n, b) => n + b.executions.length, 0), [buckets]);
  const attentionCount = useMemo(
    () => buckets.flatMap((b) => b.executions).filter((e) => needsAttention(e.status)).length,
    [buckets],
  );

  /** 开关关闭时实际渲染的条数（用于页头计数与空态判定，避免「说 5 条只显示 3 条」） */
  const visibleBuckets = useMemo<ProjectBucket[]>(() => {
    if (showContradictory) return buckets;
    return buckets
      .map((b) => ({ ...b, executions: b.executions.filter((e) => !contradictionIds.has(e.id)) }))
      .filter((b) => b.executions.length > 0);
  }, [buckets, showContradictory, contradictionIds]);

  const visibleCount = useMemo(
    () => visibleBuckets.reduce((n, b) => n + b.executions.length, 0),
    [visibleBuckets],
  );

  const handleToggle = useCallback((id: string) => {
    setExpandedId((cur) => (cur === id ? null : id));
  }, []);

  return (
    <div className="w-full p-6">
      <div className="flex flex-col gap-4">
        {/* 页头 */}
        <header className="soft-card flex flex-wrap items-center gap-3 px-6 py-4">
          <span className="soft-icon flex h-10 w-10 items-center justify-center rounded-2xl text-pine">
            <Terminal className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold text-ink">执行控制台</h1>
            <p className="text-xs text-mist">
              只读视图 · 共 {visibleCount} 条执行记录
              {/* 隐藏了矛盾条目时**必须**说明被隐藏了几条：否则计数悄悄变小 = 藏数据 */}
              {!showContradictory && contradictionIds.size > 0
                ? ` · 已隐藏 ${contradictionIds.size} 条矛盾数据`
                : ''}
              {attentionCount > 0 ? ` · ${attentionCount} 条需关注` : ''}
            </p>
          </div>

          {/*
            「显示矛盾数据」开关。
            用原生 <input type="checkbox" role="switch"> 而不是自绘 div：
            键盘可达 / 屏幕阅读器可读 / act() 里可直接 click，
            自绘控件要为这三件事各写一遍适配，而这里没有任何视觉需求值得那个成本。
          */}
          <label
            className="ml-auto flex cursor-pointer select-none items-center gap-2 rounded-2xl px-2 py-1 text-xs text-mist hover:bg-sand"
            title={CONTRADICTION_HINT}
          >
            <input
              type="checkbox"
              role="switch"
              data-exec-contradiction-toggle=""
              checked={showContradictory}
              onChange={(e) => setShowContradictoryExecutions(e.target.checked)}
              className="h-4 w-4 shrink-0 cursor-pointer accent-clay"
            />
            <span>
              显示矛盾数据
              {contradictionIds.size > 0 ? (
                <span className="ml-1 rounded-full bg-clay-soft px-1.5 py-0.5 text-clay-deep">
                  {contradictionIds.size}
                </span>
              ) : null}
            </span>
          </label>

          <button
            type="button"
            onClick={() => setReloadToken((n) => n + 1)}
            className="soft-btn-ghost soft-press soft-focus-halo flex items-center gap-2 rounded-2xl px-4 py-2 text-sm"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            刷新
          </button>
        </header>

        {/* 加载态 */}
        {state === 'loading' ? (
          <div
            className="soft-card flex items-center justify-center gap-2 px-6 py-16 text-sm text-mist"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            正在读取执行记录…
          </div>
        ) : null}

        {/* 错误态 */}
        {state === 'error' ? (
          <div className="soft-card flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="soft-icon flex h-12 w-12 items-center justify-center rounded-2xl text-rose">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </span>
            <p className="text-md font-medium text-ink">执行记录读取失败</p>
            <p className="max-w-[420px] text-sm text-mist">{errorText}</p>
            <button
              type="button"
              onClick={() => setReloadToken((n) => n + 1)}
              className="soft-btn-primary soft-press soft-focus-halo rounded-2xl px-4 py-2 text-sm"
            >
              重试
            </button>
          </div>
        ) : null}

        {/* 空态 */}
        {state === 'ready' && visibleCount === 0 ? (
          <div className="soft-card flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="soft-icon flex h-14 w-14 items-center justify-center rounded-2xl text-mist">
              <ClipboardList className="h-7 w-7" aria-hidden="true" />
            </span>
            {/*
              两种空态**必须分开**：
                ① 库里就没有执行记录 → 既有文案；
                ② 库里有、但全是矛盾数据且开关关着 → 若沿用 ① 的文案，
                   用户会得出「一条执行记录都没有」的错误结论（那是藏数据 + 说谎）。
            */}
            {totalCount > 0 ? (
              <>
                <p className="text-md font-medium text-ink">当前没有可正常显示的执行记录</p>
                <p className="max-w-[460px] text-sm text-mist">
                  库中共有 {totalCount} 条执行记录，全部被判定为「矛盾数据」且已按你的设置隐藏。
                  打开右上角的「显示矛盾数据」开关即可看到它们。
                </p>
              </>
            ) : (
              <>
                <p className="text-md font-medium text-ink">还没有任何执行记录</p>
                <p className="max-w-[460px] text-sm text-mist">
                  当 Agent 或人工在项目、成员看板上发起一次执行时，执行单会出现在这里。
                  你现在看到的是空视图，说明尚未有执行被创建。
                </p>
              </>
            )}
          </div>
        ) : null}

        {/* 按项目分组的执行列表 */}
        {state === 'ready' && visibleCount > 0 ? (
          <div className="flex flex-col gap-4">
            {visibleBuckets.map((bucket) => (
              <section key={bucket.projectId} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-1">
                  <h2 className="text-md font-semibold text-ink">{bucket.projectName}</h2>
                  <span className="text-xs text-mist">{bucket.executions.length} 条</span>
                </div>
                <ul className="flex flex-col gap-2">
                  {bucket.executions.map((e) => (
                    <ExecutionCard
                      key={e.id}
                      execution={e}
                      expanded={expandedId === e.id}
                      onToggle={() => handleToggle(e.id)}
                      detail={expandedId === e.id ? detail : null}
                      detailLoading={expandedId === e.id && detailLoading}
                      detailError={expandedId === e.id ? detailError : null}
                      detailMissing={expandedId === e.id && detailMissing}
                      contradiction={contradictionById.get(e.id) ?? null}
                      contradictionAttemptNo={firstLiveAttemptNo(bucket.attemptMap.get(e.id) ?? null)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default AgentExecutionConsolePage;
