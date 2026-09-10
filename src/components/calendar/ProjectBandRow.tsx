import { useRef, useState } from 'react';

import type { Member } from '../../core/types/entities';
import { PROJECT_TYPE_LABELS, ProjectType } from '../../core/types/enums';
import { cn } from '../../lib/cn';
import { bandGeometry, type CalendarEntry, type CalendarMonthMeta } from './calendarMath';
import { PROGRESS_DOT_COLOR } from './calendarColors';

const CIRCLED = '①②③④⑤⑥⑦⑧⑨';

/**
 * 月历单行（左列项目信息 + 右侧色带 + 末端蓝进度点 + hover 玻璃浮层）。
 * 色带用 CSS 百分比定位（left/width），不依赖整图 SVG，便于 sticky 左列 / 可访问性 / 响应式。
 */

export function ProjectBandRow({
  entry,
  meta,
  colWidth,
  leftWidth,
  rowHeight,
  isAdmin,
  members,
  onOpen,
}: {
  entry: CalendarEntry;
  meta: CalendarMonthMeta;
  colWidth: number;
  leftWidth: number;
  rowHeight: number;
  isAdmin: boolean;
  members: Member[];
  onOpen(projectId: string): void;
}): JSX.Element {
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const geo = bandGeometry(entry, meta);
  const { project, activeStage, status, percent, daysElapsed, daysRemaining, filterStageIndex } = entry;

  const ownerName =
    activeStage?.ownerId && isAdmin
      ? members.find((m) => m.id === activeStage.ownerId)?.name ?? '未指派'
      : null;

  const showTooltip = (): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setHovered(true);
  };
  const scheduleHide = (): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHovered(false), 200);
  };

  const open = (): void => onOpen(project.id);
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };

  const todayPct = meta.todayInMonth ? (meta.todayIdx / meta.daysInMonth) * 100 : -1;
  const stageLabel = status === 'completed' ? '全部完成' : status === 'not_started' ? '未开始' : activeStage?.name ?? '—';
  const remainingText =
    daysRemaining < 0 ? `逾期 ${-daysRemaining} 天` : `剩余 ${daysRemaining} 天`;

  return (
    <div
      className="group flex border-b border-line/60"
      style={{ height: rowHeight }}
      onMouseEnter={showTooltip}
      onMouseLeave={scheduleHide}
    >
      {/* 左列 sticky：项目名 + 类型徽章 + 客户(admin) + 当前阶段序号 */}
      <button
        type="button"
        onClick={open}
        onKeyDown={onKey}
        aria-label={`查看 ${project.name} 详情`}
        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-paper px-3 text-left transition-colors hover:bg-sand focus-visible:outline-pine"
        style={{ width: leftWidth }}
      >
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pine-soft text-[11px] font-medium text-pine-deep"
          title={`当前阶段 ${CIRCLED[filterStageIndex - 1] ?? filterStageIndex}`}
        >
          {status === 'completed' ? '✓' : CIRCLED[filterStageIndex - 1] ?? filterStageIndex}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm text-ink">{project.name}</span>
          <span className="block truncate text-[11px] text-mist">
            {PROJECT_TYPE_LABELS[project.type as ProjectType] ?? '未分类'}
            {isAdmin && project.clientName ? ` · ${project.clientName}` : ''}
          </span>
        </span>
      </button>

      {/* 右侧色带轨道 */}
      <div className="relative" style={{ width: meta.daysInMonth * colWidth }}>
        {/* 今日线（仅当月含今天；陶土红虚线竖线，复用 clay token） */}
        {meta.todayInMonth && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 z-0 border-l border-dashed border-clay"
            style={{ left: `${todayPct}%` }}
          />
        )}

        {/* 色带 + 进度点 */}
        {entry.isGhost ? (
          <span
            aria-hidden
            className="absolute top-1/2 z-[1] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${geo.leftPct}%`, backgroundColor: entry.color, opacity: 0.35 }}
          />
        ) : (
          <button
            type="button"
            onClick={open}
            onKeyDown={onKey}
            role="button"
            aria-label={`查看 ${project.name} 详情`}
            className="absolute top-1/2 z-[1] h-3.5 -translate-y-1/2 cursor-pointer rounded-full transition-shadow hover:shadow-glow-card-hover focus-visible:outline-pine"
            style={{
              left: `${geo.leftPct}%`,
              width: `${Math.max(geo.widthPct, (colWidth / (meta.daysInMonth * colWidth)) * 100 * 1.5)}%`,
              backgroundColor: entry.color,
            }}
          >
            {/* 末端蓝进度点（pine 外环） */}
            <span
              aria-hidden
              className="absolute top-1/2 right-0 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full ring-2 ring-pine"
              style={{ backgroundColor: PROGRESS_DOT_COLOR, left: '100%' }}
            />
          </button>
        )}

        {/* hover 玻璃浮层（glass-strong，定位在色带末端上方） */}
        {hovered && (
          <div
            className="glass-strong menuFadeIn pointer-events-none absolute bottom-full z-30 mb-2 w-64 rounded-lg p-3 text-xs shadow-glass"
            style={{ left: `${geo.dotLeftPct}%`, transform: 'translateX(-50%)' }}
            role="tooltip"
          >
            <p className="font-display text-sm text-ink">{project.name}</p>
            {isAdmin && project.clientName && <p className="mt-0.5 text-mist">客户：{project.clientName}</p>}

            <div className="mt-2 flex items-center justify-between">
              <span className="text-mist">当前阶段</span>
              <span className="text-ink">
                {status === 'completed' ? '✓ ' : `${CIRCLED[filterStageIndex - 1] ?? filterStageIndex} `}
                {stageLabel}
              </span>
            </div>

            <div className="mt-1 flex items-center justify-between">
              <span className="text-mist">计划工期</span>
              <span className="text-ink">
                {project.plannedStartAt.slice(5)} — {project.plannedEndAt.slice(5)}
              </span>
            </div>

            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-mist">当前进度</span>
                <span className="text-pine">{Math.round(percent)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream">
                <div className="h-full rounded-full bg-pine" style={{ width: `${percent}%` }} />
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-mist">已进行</span>
              <span className="text-ink">{daysElapsed} 天</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-mist">{daysRemaining < 0 ? '状态' : '剩余'}</span>
              <span className={cn(daysRemaining < 0 ? 'text-clay' : 'text-ink')}>{remainingText}</span>
            </div>

            {isAdmin && ownerName && (
              <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                <span className="text-mist">负责人</span>
                <span className="text-ink">{ownerName}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
