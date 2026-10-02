/**
 * 写回提案审批面板（v0.8.6 · 竞品三件套之二 · GitHub 审批流范式）。
 *
 * ── 抄的是谁 ──
 * GitHub 的 review 面板：变更项（diff）+ **理由** + 逐条接受/拒绝 + 批量操作。
 * 产品调研结论：Plane/Vikunja/Focalboard 只有「一个 checkbox 改状态」，
 * 新生 AI-PM 品类（GitHub 审批流）已给标准答案——**「为什么改」与「改成什么」
 * 同权**，且审批要能批量（agent 一次交 8 条提案，逐条点=劝退）。
 *
 * ── 纪律 ──
 * ① **置信度只展示、不自动决策**：低置信度 ≠ 错提案；按阈值自动过/拒 = 替人
 *    做审批决定（越权）。UI 刻意不给「一键全通过」这种无差别按钮之外的
 *    自动判定——批量只作用于**人选出来的**那些。
 * ② 落定终态必须 decidedBy（仓储层既有 P0 闸门：applied/rejected 必填）——
 *    本面板的批量动作都走同一条 updateProposal，不开后门。
 * ③ 纯展示 + 回调：数据与落库由页面/store 负责（AgentActivityStream 同款）。
 */

import { useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import type { WritebackProposal } from '../../core/types/agent-execution';
import { WritebackProposalStatus } from '../../core/types/agent-execution';

/** 落定两态（applied / rejected）——UI 只允许这两种终态，语义与仓储闸门一致 */
type TerminalDecision = 'applied' | 'rejected';

export interface ProposalReviewPanelProps {
  proposals: readonly WritebackProposal[];
  /** 落定单条（status 传 applied/rejected；decidedBy 由 store 层补当前身份） */
  onDecide(proposalId: string, status: TerminalDecision): void;
  /** 批量落定（ids 非空才渲染按钮） */
  onDecideMany?(ids: readonly string[], status: TerminalDecision): void;
  busy?: boolean;
}

/** 置信度展示（0..1 → 百分比；无值显示「未提供」——不猜、不补 100%） */
function confidenceText(c: number | null): string {
  if (c === null || !Number.isFinite(c)) return '未提供';
  return `${Math.round(c * 100)}%`;
}

/** 置信度条色：≥0.8 pine / ≥0.5 amber / <0.5 clay（纯展示，不驱动任何动作） */
function confidenceTone(c: number | null): string {
  if (c === null || !Number.isFinite(c)) return 'bg-line';
  if (c >= 0.8) return 'bg-pine';
  if (c >= 0.5) return 'bg-amber';
  return 'bg-clay';
}

function valueText(v: unknown): string {
  if (v === null || v === undefined) return '（空）';
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  } catch {
    return String(v);
  }
}

export function ProposalReviewPanel({
  proposals,
  onDecide,
  onDecideMany,
  busy = false,
}: ProposalReviewPanelProps): JSX.Element | null {
  /** 只列待审（proposed / draft）；已落定的由活动流负责显示 */
  const pending = useMemo(
    () => proposals.filter((p) => p.status === 'proposed' || p.status === 'draft'),
    [proposals],
  );
  const [picked, setPicked] = useState<readonly string[]>([]);
  /** 展开的 diff（默认全展开——审批人有权看到每一条改了什么） */
  const [expanded, setExpanded] = useState<readonly string[]>([]);

  if (pending.length === 0) return null;

  const toggle = (id: string): void =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const decideMany = (status: TerminalDecision): void => {
    if (!onDecideMany || picked.length === 0) return;
    onDecideMany(picked, status);
    setPicked([]);
  };

  return (
    <section data-proposal-review="" aria-label="写回提案审批" className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-ink">待审提案（{pending.length}）</h3>
        {onDecideMany && picked.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5" data-proposal-batch="">
            <span className="text-[11px] text-mist">已选 {picked.length}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => decideMany('applied')}
              className="flex items-center gap-1 rounded-md border border-pine/40 bg-pine-soft/50 px-2 py-0.5 text-[11px] text-pine transition-colors hover:bg-pine-soft disabled:opacity-40"
            >
              <Check size={11} aria-hidden />
              批量通过
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decideMany('rejected')}
              className="flex items-center gap-1 rounded-md border border-clay/40 bg-clay/10 px-2 py-0.5 text-[11px] text-clay transition-colors hover:bg-clay/20 disabled:opacity-40"
            >
              <X size={11} aria-hidden />
              批量拒绝
            </button>
          </div>
        )}
      </div>

      <ul className="space-y-1.5">
        {pending.map((p) => {
          const isPicked = picked.includes(p.id);
          const isOpen = expanded.includes(p.id);
          return (
            <li
              key={p.id}
              data-proposal-item={p.id}
              className={cn(
                'rounded-xl border bg-paper p-2.5',
                isPicked ? 'border-pine/50' : 'border-line',
              )}
            >
              <div className="flex items-start gap-2">
                {/* 勾选：批量入口（只有一条时也可勾——批量=处理多条的能力，不是多条专属） */}
                <input
                  type="checkbox"
                  checked={isPicked}
                  onChange={() => toggle(p.id)}
                  aria-label={`选择提案 ${p.id}`}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-pine)]"
                />
                <div className="min-w-0 flex-1">
                  {/* 理由（v0.8.6 新增字段）：与 diff 同权展示 */}
                  <p className="text-[13px] text-ink">
                    {p.reason ?? <span className="text-mist">（提案未给理由）</span>}
                  </p>
                  {/* 置信度：条 + 百分比（只展示不自动决策，见文件头纪律①） */}
                  <div className="mt-1 flex items-center gap-1.5">
                    <div className="h-1 w-16 overflow-hidden rounded-full bg-line">
                      <div
                        className={cn('h-full rounded-full', confidenceTone(p.confidence))}
                        style={{ width: p.confidence === null ? '0%' : `${Math.round(p.confidence * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-mist">置信度 {confidenceText(p.confidence)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((cur) => (isOpen ? cur.filter((x) => x !== p.id) : [...cur, p.id]))
                    }
                    aria-label={isOpen ? '收起变更明细' : '展开变更明细'}
                    className="rounded-md p-1 text-mist transition-colors hover:bg-sand"
                  >
                    <ChevronDown size={13} className={cn('transition-transform', isOpen && 'rotate-180')} aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDecide(p.id, 'applied')}
                    aria-label={`通过提案 ${p.id}`}
                    className="rounded-md border border-pine/40 bg-pine-soft/50 p-1 text-pine transition-colors hover:bg-pine-soft disabled:opacity-40"
                  >
                    <Check size={13} aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDecide(p.id, 'rejected')}
                    aria-label={`拒绝提案 ${p.id}`}
                    className="rounded-md border border-clay/40 bg-clay/10 p-1 text-clay transition-colors hover:bg-clay/20 disabled:opacity-40"
                  >
                    <X size={13} aria-hidden />
                  </button>
                </div>
              </div>

              {isOpen && (
                <ul className="mt-2 space-y-1 border-l border-line pl-2.5">
                  {p.operations.map((op, i) => (
                    <li key={i} className="text-[12px] leading-5">
                      <span className="font-mono text-mist">{op.field}</span>
                      <span className="mx-1 text-mist">：</span>
                      <span className="text-clay line-through">{valueText(op.before)}</span>
                      <span className="mx-1 text-mist">→</span>
                      <span className="text-pine">{valueText(op.after)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
