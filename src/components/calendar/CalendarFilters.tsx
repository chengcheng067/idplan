import { cn } from '../../lib/cn';
import { CalendarFilterStatus, STATUS_LABELS, type CalendarFilters as Filters } from './calendarMath';

/**
 * 月历筛选（PRD §3.4）：状态组（进行中/已完成/逾期/未开始）+ 阶段组（①~⑨）。
 * 组间 AND、组内 OR；chip 选中态高亮；任一组非空时显示「清除」入口。
 */

const STAGE_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-pine bg-pine-soft text-pine-deep'
          : 'border-line bg-paper text-mist hover:bg-sand hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function CalendarFilters({
  filters,
  onToggleStatus,
  onToggleStage,
  onClear,
}: {
  filters: Filters;
  onToggleStatus(status: CalendarFilterStatus): void;
  onToggleStage(orderIndex: number): void;
  onClear(): void;
}): JSX.Element {
  const hasAny = filters.status.size > 0 || filters.stage.size > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* 状态组（横向紧凑） */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(STATUS_LABELS) as CalendarFilterStatus[]).map((s) => (
          <Chip key={s} active={filters.status.has(s)} onClick={() => onToggleStatus(s)}>
            {STATUS_LABELS[s]}
          </Chip>
        ))}
      </div>

      {/* 阶段组：标签与 9 个序号 chip 同排，chip 用固定宽度方块、序号紧凑居中，避免手机端错行跳跃 */}
      <span className="hidden h-4 w-px bg-sand sm:inline-block" aria-hidden />

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-mist">阶段</span>
        {STAGE_ORDER.map((i) => (
          <Chip key={i} active={filters.stage.has(i)} onClick={() => onToggleStage(i)}>
            <span className="tabular-nums">{'①②③④⑤⑥⑦⑧⑨'[i - 1]}</span>
          </Chip>
        ))}
      </div>

      {hasAny && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full border border-line px-3 py-1 text-xs text-mist transition-colors hover:bg-sand hover:text-ink"
        >
          清除筛选
        </button>
      )}
    </div>
  );
}
