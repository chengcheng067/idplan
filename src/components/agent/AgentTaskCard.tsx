/**
 * Agent Board 任务卡（v0.6 · 设计文档 T11 要点 3）。
 *
 * 高信息密度范式：标题 + 来源徽标 + status 角标（英文原样，不翻译——PRD §2A.3）
 * + 依赖计数（被阻塞时 clay 高亮）+ dueDate 剩余天数。ID / externalId 一律等宽字体。
 * 零新色：全部走既有 token（cream/paper/sand/ink/mist/pine/amber/clay）。
 */

import type { Task } from '../../core/types/entities';
import { taskIsDone } from '../../core/types/entities';
import { ChangxiaError, ChangxiaErrorCode } from '../../core/types/enums';
import { termFor } from '../../constants/agentTerms';
import { useLayoutStore } from '../../store/useLayoutStore';
import { remainingDays } from '../../lib/date';
import { cn } from '../../lib/cn';

/** 来源徽标：agent → agentKind（等宽）；human → 成员名/负责人 */
export function SourceBadge({ task, label }: { task: Task; label?: string }): JSX.Element {
  if (task.source === 'agent') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-pine-soft px-1.5 py-0.5 text-[10px] text-pine">
        <span aria-hidden>🤖</span>
        <span className="font-mono">{label ?? 'agent'}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-sand px-1.5 py-0.5 text-[10px] text-mist">
      <span aria-hidden>👤</span>
      <span>{label ?? 'human'}</span>
    </span>
  );
}

/** status 角标：英文原样显示（draft / ready / claimed / …），不翻译 */
export function StatusBadge({ status }: { status: Task['status'] }): JSX.Element {
  return (
    <span
      className={cn(
        'shrink-0 rounded-[6px] px-1.5 py-0.5 font-mono text-[10px] leading-4',
        taskDoneClass(status),
      )}
    >
      {status}
    </span>
  );
}

/** status → 角标配色（只映射既有 token，零新色） */
function taskDoneClass(status: Task['status']): string {
  switch (status) {
    case 'done':
      return 'bg-sand text-mist line-through';
    case 'blocked':
      return 'bg-clay/15 text-clay';
    case 'review':
      return 'bg-amber-soft text-amber';
    case 'ready':
      return 'bg-pine-soft text-pine';
    default:
      return 'bg-sand text-mist';
  }
}

export function AgentTaskCard({
  task,
  assigneeLabel,
  blockedByTitles = [],
  onOpen,
}: {
  task: Task;
  /** 指派人展示名（human 显示成员名；agent 显示 agentKind） */
  assigneeLabel?: string;
  /** 未满足前置的标题（非空 = 视觉高亮受阻） */
  blockedByTitles?: string[];
  onOpen(taskId: string): void;
}): JSX.Element {
  const done = taskIsDone(task);
  const overdue =
    !done && task.dueDate && remainingDays(task.dueDate.slice(0, 10)) < 0;
  const dueDays = task.dueDate ? remainingDays(task.dueDate.slice(0, 10)) : null;
  /** 术语模式（human 人话 / tech 技术）：T04 起必须显式传入，无缺省（§4.4） */
  const termMode = useLayoutStore((s) => s.agentBoardMode);

  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className={cn(
        'glass-light w-full rounded-[12px] border p-2.5 text-left transition-colors hover:border-pine/50',
        blockedByTitles.length > 0 ? 'border-clay/40' : 'border-sand',
      )}
    >
      {/* 第一行：标题 + status 角标 */}
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {task.title}
        </span>
        <StatusBadge status={task.status} />
      </div>

      {/* 第二行：id + 来源徽标（等宽，开发者向高密度） */}
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-mist">
        <span className="truncate font-mono">{task.externalId ?? task.id}</span>
        <span className="ml-auto shrink-0">
          <SourceBadge task={task} label={assigneeLabel} />
        </span>
      </div>

      {/* 第三行：deps 计数 + dueDate 剩余天数 */}
      <div className="mt-1 flex items-center gap-2 text-[10px]">
        {(task.dependsOn?.length ?? 0) > 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5',
              blockedByTitles.length > 0 ? 'text-clay' : 'text-mist',
            )}
            title={
              blockedByTitles.length > 0
                ? `${termFor('blockedBy', termMode)}：${blockedByTitles.join('、')}`
                : termFor('deps', termMode)
            }
          >
            ⛓ {task.dependsOn.length}
            {blockedByTitles.length > 0 && <span>（受阻）</span>}
          </span>
        )}
        {task.dueDate && (
          <span className={cn('ml-auto tabular-nums', overdue ? 'text-clay' : 'text-mist')}>
            {overdue
              ? `逾期 ${Math.abs(dueDays ?? 0)} 天`
              : `剩余 ${dueDays ?? 0} 天`}
          </span>
        )}
      </div>
    </button>
  );
}

/** 供 ReadyQueue / 看板列共用的受阻标题解析（纯派生，不进 store） */
export function unmetDepTitles(
  task: Task,
  byId: ReadonlyMap<string, Task>,
): string[] {
  return (task.dependsOn ?? [])
    .map((dep) => byId.get(dep))
    .filter((d): d is Task => !!d && !taskIsDone(d))
    .map((d) => d.title);
}

/** 冲突错误是否为「认领争抢」类（TaskDrawer claim 按钮文案分支用） */
export function isClaimConflict(err: unknown): boolean {
  return err instanceof ChangxiaError && err.code === ChangxiaErrorCode.Conflict;
}
