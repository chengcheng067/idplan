import dayjs from 'dayjs';

import type { Member, Stage } from '../../core/types/entities';
import { StageStatus } from '../../core/types/enums';
import { remainingDays } from '../../lib/date';

/**
 * 左侧锁定列（sticky）：序号圆标 / 阶段名 / 负责人 / 距截止天数。
 * v0.2 修复 + 权限矩阵 #15：
 *   - 修复旧版直接显示 ownerId raw id 的 bug；
 *   - admin 视角：负责人显示姓名（未指派 → 「未指派负责人」）；
 *   - member 视角：负责人显示角色标签（m.role 或「负责人」），不暴露其他成员姓名。
 */
export function StageRowsColumn({
  stages,
  todayIso,
  activeStageId,
  onRowClick,
  members = [],
  memberView = false,
  leftColW = 260,
}: {
  stages: Stage[];
  todayIso: string;
  activeStageId: string | null;
  onRowClick(stageId: string): void;
  members?: Member[];
  memberView?: boolean;
  leftColW?: number;
}): JSX.Element {
  const ownerLabel = (stage: Stage): string => {
    if (!stage.ownerId) return '未指派负责人';
    const owner = members.find((m) => m.id === stage.ownerId);
    if (!owner) return '未知负责人';
    return memberView ? owner.role || '负责人' : owner.name;
  };

  return (
    <div
      className="sticky left-0 z-10 shrink-0 border-r border-line bg-cream"
      style={{ width: leftColW }}
    >
      {stages.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onRowClick(s.id)}
          className={`flex w-full items-center gap-3 border-b border-line/50 px-4 text-left transition-colors hover:bg-sand/60 ${
            s.id === activeStageId ? 'bg-sand' : ''
          }`}
          style={{ height: 44, marginBottom: 8 }}
        >
          <IndexBadge stage={s} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">{s.name}</span>
            <span className="block truncate text-[11px] leading-4 text-mist">
              {ownerLabel(s)}
            </span>
          </span>
          <DueChip stage={s} todayIso={todayIso} />
        </button>
      ))}
      <div style={{ height: 0 }} />
    </div>
  );
}

function IndexBadge({ stage }: { stage: Stage }): JSX.Element {
  const base =
    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium';
  if (stage.status === StageStatus.Completed) {
    return <span className={`${base} bg-pine text-white`}>✓</span>;
  }
  if (stage.status === StageStatus.Delayed) {
    return <span className={`${base} bg-clay text-white`}>{stage.orderIndex}</span>;
  }
  if (stage.status === StageStatus.InProgress) {
    return <span className={`${base} bg-pine-soft text-pine-deep border border-pine`}>{stage.orderIndex}</span>;
  }
  return <span className={`${base} border border-mist/40 text-mist`}>{stage.orderIndex}</span>;
}

function DueChip({ stage, todayIso }: { stage: Stage; todayIso: string }): JSX.Element | null {
  if (stage.status === StageStatus.Completed) return null;
  const days = remainingDays(stage.endAt.slice(0, 10), todayIso);
  const overdue = days < 0;
  const urgent = !overdue && days <= 3;
  const cls = overdue ? 'text-clay' : urgent ? 'text-amber-deep' : 'text-mist';
  const label = overdue ? `逾期 ${Math.abs(days)} 天` : days === 0 ? '今日截止' : `${days} 天`;
  void dayjs; // 保持单一日期入口的注释位（剩余口径在 lib/date）
  return <span className={`shrink-0 text-[11px] tabular-nums ${cls}`}>{label}</span>;
}
