/**
 * Ready 队列置顶区（v0.6 · 设计文档 T11 要点 4 / PRD V2）。
 *
 * ── v0.7 T08：本组件的**渲染路径归属技术模式** ──
 * 人话模式下它的内容已由 `board.ts` 的「可开工」组涵盖（`ready ∪ (draft ∧ depsDone)`，
 * 是 `computeReadyTasks().ready` 的**超集**，见设计文档 §2.3.4 与
 * `tests/agent-board.spec.ts` 的包含关系断言）。两者同时渲染会让同一批 ready 任务
 * 在「Ready 队列」与人话「可开工」组**各出现一次**，故由 `AgentBoardPage` 只在
 * 技术模式挂载本组件（team-lead 明确要求「别与可开工组重复展示」）。
 * **计算未重写**——本文件仍是 `computeReadyTasks` 的唯一渲染出口，符合设计文档
 * :345「计算复用，不重写」。
 *
 * 纪律：
 *   - 计算全部委托 `dag.computeReadyTasks`（store/UI 只编排不重复实现）；
 *   - **computeReadyTasks 遇环不抛异常**——cyclicIds 非空时渲染黄色（amber）告警条，
 *     绝不 try/catch 当异常处理、绝不白屏；
 *   - Ready 拓扑序渲染；受阻区显示 `blocked by ⟨title⟩`。
 */

import { useMemo } from 'react';

import { Zap } from 'lucide-react';

import type { Task } from '../../core/types/entities';
import { computeReadyTasks } from '../../core/agent/dag';
import { termFor } from '../../constants/agentTerms';
import { useLayoutStore } from '../../store/useLayoutStore';
import { AgentTaskCard } from './AgentTaskCard';

export function ReadyQueue({
  tasks,
  assigneeLabels,
  onOpenTask,
  onClaim,
}: {
  tasks: readonly Task[];
  /** memberId → 展示名（human 成员名 / agent 的 agentKind） */
  assigneeLabels: Readonly<Record<string, string>>;
  onOpenTask(taskId: string): void;
  onClaim(taskId: string): void;
}): JSX.Element {
  const { ready, blocked, cyclicIds } = useMemo(
    () => computeReadyTasks([...tasks]),
    [tasks],
  );

  /** 术语模式（human 人话 / tech 技术）：T04 起必须显式传入，无缺省（§4.4） */
  const termMode = useLayoutStore((s) => s.agentBoardMode);

  return (
    <section className="glass-light rounded-[16px] border border-line p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Zap size={14} className="text-pine" aria-hidden />
        <h2 className="text-sm font-semibold text-ink">
          ⚡ {termFor('ready', termMode)} —— 下一步该做什么
        </h2>
        <span className="rounded-md bg-sand px-1.5 py-0.5 font-mono text-[10px] text-mist">
          {ready.length}
        </span>
      </div>

      {/* 环告警：黄色提示条（amber token），不白屏、不阻塞其余渲染 */}
      {cyclicIds.size > 0 && (
        <div
          role="alert"
          className="mb-2 rounded-[10px] border border-amber/50 bg-amber-soft px-3 py-2 text-xs text-amber"
        >
          检测到 {cyclicIds.size} 条任务存在依赖环（deps 相互引用），已从 Ready
          队列排除。请在任务详情中修正 deps 后刷新。
        </div>
      )}

      {ready.length === 0 && blocked.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-line px-3 py-4 text-center text-xs text-mist">
          当前没有可执行的 Ready 任务。通过「{termFor('applyPayload', termMode)}」导入或把任务流转到
          ready 即可出现在这里。
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {ready.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <AgentTaskCard
                  task={t}
                  assigneeLabel={
                    t.assigneeId ? assigneeLabels[t.assigneeId] : undefined
                  }
                  onOpen={onOpenTask}
                />
              </div>
              <button
                type="button"
                onClick={() => onClaim(t.id)}
                className="shrink-0 rounded-[8px] border border-pine px-2.5 py-1.5 text-xs text-pine transition-colors hover:bg-pine-soft"
              >
                claim
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 受阻区：blocked by ⟨title⟩ */}
      {blocked.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1.5 text-[11px] font-medium text-mist">
            暂时不要碰（被阻塞 {blocked.length}）
          </h3>
          <ul className="flex flex-col gap-1">
            {blocked.map(({ task, blockedBy }) => (
              <li
                key={task.id}
                className="flex flex-wrap items-center gap-x-2 rounded-[8px] bg-sand/50 px-2.5 py-1.5 text-[11px] text-mist"
              >
                <button
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="min-w-0 truncate text-ink hover:text-pine"
                >
                  {task.title}
                </button>
                <span className="text-clay">
                  ← {termFor('blockedBy', termMode)} {blockedBy.map((d) => `「${d.title}」`).join('、')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
