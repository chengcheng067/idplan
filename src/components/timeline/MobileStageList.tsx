import type { Member, Stage, Task } from '../../core/types/entities';
import { StageStatus } from '../../core/types/enums';
import { STAGE_BAR_COLORS } from './stageColors';
import { resolveStageColorIndex } from '../../core/template/stage-fallback';
import { StatusPill } from '../common/StatusPill';
import { cn } from '../../lib/cn';
import { totalDaysInclusive } from '../../lib/date';

/** 阶段序号符号（①-⑨，与横向时间轴一致） */
const STAGE_NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'] as const;

/**
 * 移动端纵向「阶段卡片流」（v0.4.2 手机端重构 · 阶段 C）。
 *
 * 背景：横向时间轴（TimelineView）在手机 / iPad 竖屏下是一条横向滚动长条，
 * 用户难以一眼看出「哪个阶段什么状态、起止日、负责人」，阅读成本极高。
 * 因此在 <lg(1024px) 用本组件替换横向时间轴，改为纵向卡片堆叠：
 * 每张卡 = 阶段序号 + 名称 + 状态胶囊 + 起止日 + 进度条 + 负责人 + 任务数；点击打开阶段抽屉。
 * 平板横屏 / 桌面（≥lg）仍保留横向时间轴（更利于改期拖拽）。
 *
 * 不引入新颜色：全程复用 STAGE_BAR_COLORS / StatusPill / token（cream/paper/sand/ink/mist/pine）。
 */
export function MobileStageList({
  stages,
  tasks,
  members,
  todayIso,
  onOpen,
}: {
  stages: Stage[];
  tasks: Task[];
  members: Member[];
  todayIso: string;
  onOpen(stageId: string): void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {stages.map((s) => {
        const color =
          STAGE_BAR_COLORS[resolveStageColorIndex(s.orderIndex, s.colorIndex)] ?? STAGE_BAR_COLORS[9];
        const active = s.status === StageStatus.InProgress;
        const owner = members.find((m) => m.id === s.ownerId);
        const stageTasks = tasks.filter((t) => t.stageId === s.id);
        const taskCount = stageTasks.length;
        // v0.6 双色分层：来源标识（Agent 🤖 / Human 👤 计数）+ 未完成任务 status 角标
        const agentCount = stageTasks.filter((t) => t.source === 'agent').length;
        const humanCount = taskCount - agentCount;
        const openStatuses = stageTasks
          .filter((t) => !(t.status === 'done' || t.done === true))
          .map((t) => t.status);
        const pct = progressOf(s);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpen(s.id)}
            className={cn(
              'glass-medium flex w-full flex-col gap-1.5 rounded-[14px] border p-3 text-left shadow-soft transition-colors',
              active ? 'border-pine bg-pine-soft/20' : 'border-sand',
            )}
          >
            {/* 第一行：序号 + 名称 + 状态 */}
            <div className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-xs font-bold text-white"
                style={{ backgroundColor: color }}
              >
                {STAGE_NUM[s.orderIndex - 1] ?? s.orderIndex}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{s.name}</span>
              <StatusPill status={s.status} size="sm" />
            </div>

            {/* 第二行：起止日跨度 */}
            <div className="flex items-center gap-2 text-xs text-mist">
              <span className="tabular-nums">{s.startAt.slice(0, 10)}</span>
              <span aria-hidden>→</span>
              <span className="tabular-nums">{s.endAt.slice(0, 10)}</span>
              <span className="ml-auto tabular-nums">
                {totalDaysInclusive(s.startAt.slice(0, 10), s.endAt.slice(0, 10))} 天
              </span>
            </div>

            {/* 进度条 */}
            <div className="flex h-1 w-full overflow-hidden rounded-full bg-sand/60">
              <div
                className="rounded-full transition-[width]"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>

            {/* 第三行：负责人 + 任务数 */}
            <div className="flex items-center gap-2.5 text-[11px] text-mist">
              {owner && (
                <span className="inline-flex items-center gap-1">
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-white"
                    style={{ backgroundColor: owner.avatarColor }}
                  >
                    {owner.name[0]}
                  </span>
                  {owner.name}
                </span>
              )}
              {taskCount > 0 && <span>· {taskCount} 项任务</span>}
              <span className="ml-auto text-[10px] text-mist/70">{todayIso}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** 单阶段完成度：进行中 60%（示意），已完成 100%，未开始 0% */
function progressOf(s: Stage): number {
  return s.status === StageStatus.Completed ? 100 : s.status === StageStatus.InProgress ? 60 : 0;
}
