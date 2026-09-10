import dayjs from 'dayjs';

import type { StageLog } from '../../core/types/entities';
import { StageLogType } from '../../core/types/enums';

/** 延期档案时间线（append-only 渲染：只增不改） */
export function DelayHistoryTimeline({ logs }: { logs: StageLog[] }): JSX.Element {
  const reschedules = logs.filter((l) => l.type === StageLogType.Rescheduled);

  if (reschedules.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line p-4 text-sm leading-6 text-mist">
        暂无改期记录。拖拽彩条边缘或修改日期并确认后，将在此追加一条不可篡改的档案。
      </p>
    );
  }

  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {reschedules.map((l) => {
        const oldEnd = l.oldEndAt ? dayjs(l.oldEndAt).format('YYYY-MM-DD') : '—';
        const newEnd = l.newEndAt ? dayjs(l.newEndAt).format('YYYY-MM-DD') : '—';
        const postponed =
          l.newEndAt && l.oldEndAt
            ? dayjs(l.newEndAt).isAfter(dayjs(l.oldEndAt))
            : false;
        return (
          <li key={l.id} className="relative">
            {/* Soft UI：圆点用 ring（box-shadow 实现，不占布局空间）替代 border-2 硬描边 */}
            <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-mist ring-2 ring-paper" />
            <p className="text-sm leading-6">
              <span className={postponed ? 'font-medium text-clay' : 'text-pine-deep'}>
                {oldEnd} → {newEnd}
              </span>
              {l.reason && <span className="text-ink/80"> · {l.reason}</span>}
            </p>
            <p className="text-xs text-mist">
              {dayjs(l.createdAt).format('YYYY-MM-DD HH:mm')} · 操作人 {l.operatorName}
              {!postponed && ' · 平移/提前'}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
