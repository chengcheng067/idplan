/**
 * Agent 活动流（v0.8.6 · 她反馈 #1「agent 看板做的很粗糙」的竞品对策第一刀）。
 *
 * ── 抄的是谁 ──
 * 产品调研结论（product-review-idplan-v085 §A）：开源 PM（Plane/Vikunja/
 * Focalboard）根本没有 agent 写入层——我们的 Agent 看板领先；但 2026 新生
 * 「AI 可写 PM」品类（Linear Coding Session / GitHub 审批流 / Kanban AI）
 * 已给标准答案。本组件抄 **Linear Coding Session 卡**：agent 的每次执行
 * 渲染成活动流里和评论同级的一张卡——执行单、事件时间线、写回提案三件套。
 *
 * ── 为什么这么设计 ──
 * 数据层早在 v0.9 就备齐（executions / executionEvents / writebackProposals
 * 四张表 + repo 接口+local 实现，产品官「数据都有，差呈现语言」的坐实），
 * 差的只是界面。本组件是那层界面：**纯展示**（数据由页面经 repos 读好后
 * 喂入，自身不碰 store——AgentBoardList 同款纪律）。
 *
 * ── 视觉纪律 ──
 * 零新 token（paper/sunken/sand/line/ink/mist/pine/pine-soft/clay/amber）；
 * 锚点 data-activity-*（断言不依赖中文与类名）；状态 chip 语义对齐
 * WritebackProposalStatus（pending/approved/rejected）。
 */

import { Bot, ChevronDown, CircleDot, FileDiff } from 'lucide-react';

import { cn } from '../../lib/cn';
import type {
  Execution,
  ExecutionEvent,
  WritebackProposal,
} from '../../core/types/agent-execution';

/** 一卡 = 一个执行单 + 它的事件 + 它的提案（页面侧一次读好，避免组件内瀑布请求） */
export interface ActivityExecutionGroup {
  execution: Execution;
  events: readonly ExecutionEvent[];
  proposals: readonly WritebackProposal[];
}

/**
 * 状态标签（键 = WritebackProposalStatus 真实枚举：Draft/Proposed/Applied/
 * Rejected/Conflict——**没有 approved**，v0.8.6 首版 spec 曾按臆测的
 * 'approved' 断言、属性直接不渲染；枚举以 agent-execution.ts 为准）。
 */
const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  proposed: '待审',
  applied: '已应用',
  rejected: '已拒绝',
  conflict: '冲突',
};

function statusChipClass(status: string): string {
  if (status === 'applied') return 'border-pine/40 bg-pine-soft/50 text-pine';
  if (status === 'rejected' || status === 'conflict') return 'border-clay/40 bg-clay/10 text-clay';
  if (status === 'draft') return 'border-line bg-cream text-mist';
  return 'border-amber/40 bg-amber/10 text-amber';
}

function eventDotClass(type: string): string {
  if (type === 'failed' || type === 'rejected') return 'text-clay';
  if (type === 'completed' || type === 'applied') return 'text-pine';
  return 'text-mist';
}

export function AgentActivityStream({
  groups,
}: {
  groups: readonly ActivityExecutionGroup[];
}): JSX.Element | null {
  if (groups.length === 0) return null;
  return (
    <section data-agent-activity="" aria-label="Agent 活动流" className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
        <Bot size={14} className="text-mist" aria-hidden />
        Agent 活动
      </h3>
      <ol className="space-y-2">
        {groups.map(({ execution, events, proposals }) => (
          <li
            key={execution.id}
            data-activity-execution={execution.id}
            className="rounded-xl border border-line bg-paper p-3"
          >
            {/* 卡头：来源 chip + 目标 + 时间 */}
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 rounded-md bg-pine-soft px-1.5 py-0.5 text-[11px] font-medium text-pine">
                <Bot size={11} aria-hidden />
                {execution.source}
              </span>
              <span className="truncate text-[13px] font-medium text-ink" title={execution.objective}>
                {execution.objective}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-mist">
                {new Date(execution.createdAt).toLocaleString('zh-CN', { hour12: false })}
              </span>
            </div>

            {/* 事件时间线（Linear Coding Session 的活动流部分） */}
            {events.length > 0 && (
              <ol className="mt-2 space-y-1 border-l border-line pl-3">
                {events.map((ev) => (
                  <li key={ev.id} data-activity-event={ev.type} className="flex items-baseline gap-2">
                    <CircleDot
                      size={10}
                      aria-hidden
                      className={cn('shrink-0 translate-y-[2px]', eventDotClass(ev.type))}
                    />
                    <span className="text-[12px] text-ink">{ev.reason ?? ev.type}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-mist">
                      {new Date(ev.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {/* 写回提案（GitHub 审批流部分：diff + 状态 chip） */}
            {proposals.length > 0 && (
              <ul className="mt-2 space-y-1">
                {proposals.map((p) => (
                  <li
                    key={p.id}
                    data-activity-proposal={p.status}
                    className="flex items-center gap-2 rounded-md border border-line bg-cream/50 px-2 py-1"
                  >
                    <FileDiff size={12} className="shrink-0 text-mist" aria-hidden />
                    <span className="text-[12px] text-ink">
                      {p.operations.length} 项变更
                    </span>
                    <span
                      className={cn(
                        'ml-auto shrink-0 rounded-md border px-1.5 py-0.5 text-[11px]',
                        statusChipClass(p.status),
                      )}
                    >
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {groups.some((g) => g.proposals.some((p) => p.status === 'proposed')) && (
        <p className="flex items-center gap-1 text-[11px] text-mist">
          <ChevronDown size={11} aria-hidden />
          有待审提案——在「写回」标签页批量处理
        </p>
      )}
    </section>
  );
}
