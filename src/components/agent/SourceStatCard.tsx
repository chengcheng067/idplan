/**
 * 来源指标卡（v0.6 · 设计文档 T11 要点 5 / PRD V5）。
 *
 * 按 agentKind 聚合 `source==='agent'` 的任务计数，纯派生、无状态；
 * 无数据时空态文案，**不伪造趋势线**（PRD 明文禁令）。
 */

import { useMemo } from 'react';

import type { Task } from '../../core/types/entities';
import { AGENT_SEAT_LIMIT } from '../../constants/agentTerms';

export function SourceStatCard({
  tasks,
  assigneeLabels,
  agentSeatUsed,
  agentSeatLimit = AGENT_SEAT_LIMIT,
}: {
  tasks: readonly Task[];
  /** memberId → 展示名（human 成员名 / agent 的 agentKind，与 ReadyQueue 同一映射） */
  assigneeLabels: Readonly<Record<string, string>>;
  /** 当前 Agent 成员数（已用席位，设置页同口径：actorKind==='agent' 计数） */
  agentSeatUsed: number;
  agentSeatLimit?: number;
}): JSX.Element {
  /** agentKind → 任务数（开放字符串直接作 key；空值归 'unknown'） */
  const byKind = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      if (t.source !== 'agent') continue;
      // agentKind 在 Member 上（Task 只有 agentId 指针），经 assigneeLabels 映射取回
      const key = (t.assigneeId ? assigneeLabels[t.assigneeId] : undefined) ?? 'unassigned';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  const agentTotal = byKind.reduce((sum, [, n]) => sum + n, 0);
  const humanTotal = tasks.filter((t) => t.source === 'human').length;

  return (
    <div className="glass-light flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[12px] border border-sand px-3.5 py-2.5 text-xs">
      <span className="text-mist">
        human <strong className="font-mono text-ink">{humanTotal}</strong>
      </span>
      <span className="text-mist">
        agent <strong className="font-mono text-ink">{agentTotal}</strong>
      </span>
      {byKind.map(([kind, n]) => (
        <span key={kind} className="inline-flex items-center gap-1 text-mist">
          <span aria-hidden>🤖</span>
          <span className="font-mono">{kind}</span>
          <strong className="font-mono text-ink">{n}</strong>
        </span>
      ))}
      {byKind.length === 0 && (
        <span className="text-mist/70">暂无 agent 来源任务（导入 payload 后此处按 agentKind 聚合）</span>
      )}
      <span className="ml-auto text-mist">
        Agent 席位 已用 <strong className="font-mono text-ink">{agentSeatUsed}</strong>/{agentSeatLimit}
        {agentSeatUsed > agentSeatLimit && (
          <span className="ml-1 text-amber">（超出免费额度，仅提示）</span>
        )}
      </span>
    </div>
  );
}
