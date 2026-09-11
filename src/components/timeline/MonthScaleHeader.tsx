/**
 * 月份刻度尺（zoom=half-month 时切为半月刻度）。
 * 纯展示：宽度 = daysSpan × pxPerDay（与 TimelineView 同一坐标系）。
 */

export interface ScaleTick {
  start: string;
  label: string;
  daysSpan: number;
}

export function MonthScaleHeader({
  ticks,
  pxPerDay,
  width,
}: {
  ticks: ScaleTick[];
  pxPerDay: number;
  /** 表头区总宽度：与画布 contentW 对齐，尾部空出延伸区保持底色（图1右侧不突兀） */
  width?: number;
}): JSX.Element {
  return (
    <div className="flex h-full items-stretch" style={{ width }}>
      {ticks.map((t) => (
        <div
          key={`${t.start}-${t.label}`}
          style={{ width: t.daysSpan * pxPerDay }}
          className="flex items-center border-r border-line/70 bg-cream px-2 text-[11px] text-mist last:border-r-0"
        >
          <span className="truncate">{t.label}</span>
        </div>
      ))}
    </div>
  );
}
