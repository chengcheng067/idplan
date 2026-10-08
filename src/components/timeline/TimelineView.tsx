import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildHalfMonthTicks,
  buildMonthTicks,
  dateAtX,
  panRange,
  rangeDays,
  xOf,
  type TimelineRange,
} from '../../lib/date';
import type { Stage, Project, Member, Task } from '../../core/types/entities';
import { ScheduleBasis } from '../../core/types/enums';
import { pickActiveStageId } from '../../lib/progress';
import { useUiStore, type TimelineZoom } from '../../store/useUiStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useKeyboardPan } from '../../hooks/useKeyboardPan';
import { useDragReschedule } from '../../hooks/useDragReschedule';
import { addWorkdaysSigned, countWorkdays, snapShiftDate } from '../../lib/workdays';
import { MonthScaleHeader } from './MonthScaleHeader';
import { StageRowsColumn } from './StageRowsColumn';
import { StageBar, TaskBar, StageBarDefs } from './StageBar';
import { TodayLine } from './TodayLine';
import { RescheduleDialog } from './RescheduleDialog';
import { ROW_BG_ACTIVE, ROW_BG_EVEN, ROW_BG_ODD } from './timelineColors';

/** 行几何常量（像素） */
const ROW_H = 44;
const ROW_GAP = 8;
const LEFT_COL_W = 260;
const HEADER_H = 36;

const ZOOM_PPD: Record<TimelineZoom, number> = {
  month: 14, // 月粒度：14px/天
  'half-month': 30, // 双周粒度：30px/天
};

/** 手机（<768px）判定：响应式左列收窄用（纯 CSR SPA，window 可用） */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const onChange = (): void => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

export interface PendingReschedule {
  stageId: string;
  stageName: string;
  oldStartAt: string;
  oldEndAt: string;
  newStartAt: string;
  newEndAt: string;
}

/** 批量改期（磁吸联动）：items 按 orderIndex 升序，primaryIndex 指向被拖动的阶段 */
export interface BatchReschedule {
  items: PendingReschedule[];
  primaryIndex: number;
}

/**
 * 时间轴主视图容器：zoom 档位、坐标系、今日线、左锁定列、拖拽改期编排。
 * x=date 映射复用 lib/date.xOf / dateAtX（架构 T10 铁则）。
 * v0.2：memberView=true 时（成员视角）：
 *   - stages 已由 ProjectDetailPage 过滤为「与自己相关」的阶段（本组件透传）；
 *   - 拖拽改期禁用（阶段改期是管理员操作，权限矩阵 #11 语义延伸）；
 *   - 左列负责人显示角色标签（StageRowsColumn）。
 */
export function TimelineView({
  project,
  stages,
  members = [],
  memberView = false,
  tasks = [],
}: {
  project: Project;
  stages: Stage[];
  members?: Member[];
  memberView?: boolean;
  /** v0.6 双色分层：任务级时间条（Agent 斜纹 / Human 素色）；缺省不画 */
  tasks?: Task[];
}): JSX.Element {
  const zoom = useUiStore((s) => s.timelineZoom);
  const setZoom = useUiStore((s) => s.setTimelineZoom);
  const openDrawer = useUiStore((s) => s.openStageDrawer);
  // 生效口径：skipHolidays 开时已合并内置法定节假日表（拖拽吸附/磁吸联动同源）
  const restPolicy = useSettingsStore((s) => s.effectiveRestPolicy);

  const pxPerDay = ZOOM_PPD[zoom];
  // 手机左列收窄（<768px 由 260 降到 180）
  const leftColW = useIsMobile() ? 180 : LEFT_COL_W;
  // T5：工作日口径开关（项目级排期基准）；Calendar/缺省走原自然日分支，逐字节不变
  const useWorkday = project.scheduleBasis === ScheduleBasis.Workday;

  // 视口宽度观测：保证画布宽度至少撑满可视区，避免月档(14px/天)下右侧留白（图1）
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(0);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setViewportW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 可视窗口：以阶段实际起止为边界，没有阶段时才回落到项目计划工期。
  // 不再以计划截止日期为终点——那会在最后阶段之后留下空白，用户会误以为数据缺失。
  const baseRange = useMemo<TimelineRange>(() => {
    const plannedStart = project.plannedStartAt.slice(0, 10);
    const plannedEnd = project.plannedEndAt.slice(0, 10);
    if (stages.length === 0) {
      return { from: plannedStart, to: plannedEnd };
    }
    const stageStart = stages.map((s) => s.startAt.slice(0, 10)).reduce((a, b) => (a < b ? a : b));
    const stageEnd = stages.map((s) => s.endAt.slice(0, 10)).reduce((a, b) => (a > b ? a : b));
    return { from: stageStart, to: stageEnd };
  }, [project.plannedStartAt, project.plannedEndAt, stages]);

  const [range, setRange] = useState<TimelineRange>(baseRange);

  // stages 变化（如磁吸联动延后）导致 baseRange 扩展时，自动扩展可视窗口
  useEffect(() => {
    setRange(baseRange);
  }, [baseRange]);

  const days = rangeDays(range);
  const chartW = days * pxPerDay;
  // 图1：SVG 画布宽度取「内容实际宽」与「可视视口宽-左列」较大者，行底纹/网格铺满右缘不空白
  const contentW = Math.max(chartW, viewportW - leftColW);

  useKeyboardPan(true, range, setRange);

  // 图3：滚轮平移。鼠标悬停时间轴即生效：横向滚轮（deltaX）优先，纵向滚轮（deltaY）兜底。
  // 将像素位移换算成天数（取 ±1 天至少一步），再复用 panRange 平移可视窗口。
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>): void => {
      const totalDays = rangeDays(range);
      const deltaPx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (deltaPx === 0) return;
      // 一个视窗宽对应 totalDays 天；deltaPx 相对视窗宽折算天数
      const viewDays = totalDays * (deltaPx / Math.max(1, viewportW));
      let deltaDays = Math.round(Math.abs(viewDays) >= 1 ? viewDays : Math.sign(deltaPx));
      if (deltaDays === 0) deltaDays = Math.sign(deltaPx);
      e.preventDefault();
      setRange(panRange(range, deltaDays));
    },
    [range, viewportW, setRange],
  );

  /* ------------------------------ 拖拽改期编排（含磁吸联动） ------------------------------ */
  const drag = useDragReschedule();
  const [batchPending, setBatchPending] = useState<BatchReschedule | null>(null);

  // StageBar 手柄 pointerdown 后挂窗级监听；up 时进入弹窗闸门（不直接落库）
  const beginEdgeDrag = useCallback(
    (
      e: React.PointerEvent,
      stage: Stage,
      edge: 'start' | 'end',
    ): void => {
      drag.onHandleDown(e, stage.id, edge, pxPerDay);
      drag.attachWindowListeners((stageId, dragEdge, delta) => {
        if (delta === 0) return; // 无位移视作点击 → 由 click 处理抽屉
        const target = stages.find((s) => s.id === stageId);
        if (!target) return;
        const dStart = target.startAt.slice(0, 10);
        const dEnd = target.endAt.slice(0, 10);
        const shift = (iso: string, dd: number): string => {
          const d = new Date(`${iso}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + dd);
          return d.toISOString().slice(0, 10);
        };
        // T5：口径化位移——Workday 项目按拖拽方向吸附到工作日，Calendar 保持自然日（逐字节不变）
        const moveDate = (iso: string, dd: number): string =>
          useWorkday ? snapShiftDate(iso, dd, restPolicy) : shift(iso, dd);
        const newStart = dragEdge === 'start' ? moveDate(dStart, delta) : dStart;
        const newEnd = dragEdge === 'end' ? moveDate(dEnd, delta) : dEnd;
        // 倒置守卫：先吸附、再判倒置（吸附只会把边界移向工作日，不会扩大倒置面）
        if (new Date(newEnd) < new Date(newStart)) return; // 倒置直接忽略（回弹）

        // 磁吸联动：主段结束日变化多少「单位」（Workday=工作日序号差 / Calendar=自然日差），后续阶段顺延多少单位
        const primary: PendingReschedule = {
          stageId,
          stageName: target.name,
          oldStartAt: dStart,
          oldEndAt: dEnd,
          newStartAt: newStart,
          newEndAt: newEnd,
        };
        const deltaEnd = useWorkday
          ? countWorkdays(dStart, newEnd, restPolicy) - countWorkdays(dStart, dEnd, restPolicy)
          : daysBetween(dEnd, newEnd);
        const sortedStages = [...stages].sort((a, b) => a.orderIndex - b.orderIndex);
        const followers: PendingReschedule[] =
          deltaEnd === 0
            ? []
            : sortedStages
                .filter((s) => s.orderIndex > target.orderIndex)
                .map((s) => {
                  const sStart = s.startAt.slice(0, 10);
                  const sEnd = s.endAt.slice(0, 10);
                  return {
                    stageId: s.id,
                    stageName: s.name,
                    oldStartAt: sStart,
                    oldEndAt: sEnd,
                    newStartAt: useWorkday ? addWorkdaysSigned(sStart, deltaEnd, restPolicy) : shift(sStart, deltaEnd),
                    newEndAt: useWorkday ? addWorkdaysSigned(sEnd, deltaEnd, restPolicy) : shift(sEnd, deltaEnd),
                  };
                });
        setBatchPending({ items: [primary, ...followers], primaryIndex: 0 });
      });
    },
    [drag, pxPerDay, stages, restPolicy, useWorkday],
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const activeStageId = pickActiveStage(stages, todayIso);

  // 成员视角禁止拖拽改期（阶段日期编辑仅管理员）
  const effectiveHandleDown = memberView ? (() => undefined) : beginEdgeDrag;

  return (
    <div className="relative">
      {/* 缩放档位切换 */}
      <div className="mb-2 hidden items-center justify-between text-xs text-mist sm:flex">
        <span>提示：拖动彩条边缘改期；←/→ 键平移时间轴（Shift 加速）</span>
        <div className="flex overflow-hidden rounded-md border border-line">
          {(
            [
              ['month', '月'],
              ['half-month', '双周'],
            ] as Array<[TimelineZoom, string]>
          ).map(([z, label]) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              className={`px-3 py-1 transition-colors ${
                zoom === z ? 'bg-pine text-white' : 'bg-paper text-mist hover:bg-sand'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={viewportRef}
        className="overflow-x-auto rounded-3xl dark:rounded-2xl border border-line bg-paper p-4 shadow-soft sm:p-6"
        onWheel={handleWheel}
      >
        {/* 宽度取「内容实际宽」与「可视视口宽」较大者：画布撑满可视区，避免图1月档下右侧留白 */}
        <div style={{ width: leftColW + contentW }}>
          {/* 表头行：左侧空置 + 刻度尺 */}
          <div className="flex" style={{ height: HEADER_H }}>
            <div
              className="sticky left-0 z-20 shrink-0 border-r border-line bg-cream"
              style={{ width: leftColW }}
            />
            <MonthScaleHeader
              ticks={
                zoom === 'month'
                  ? buildMonthTicks(range.from, range.to).map((t) => ({ ...t }))
                  : buildHalfMonthTicks(range.from, range.to).map((t) => ({ ...t }))
              }
              pxPerDay={pxPerDay}
              width={contentW}
            />
          </div>

          <div className="flex relative mt-4">
            {/* 左锁定列 */}
            <StageRowsColumn
              stages={stages}
              todayIso={todayIso}
              onRowClick={(stageId) => openDrawer(stageId)}
              activeStageId={activeStageId}
              members={members}
              memberView={memberView}
              leftColW={leftColW}
            />

            {/* 右侧 SVG 画布：宽度撑满可视区（contentW），行底纹铺满右缘，彩条仍按真实日期 xOf 定位 */}
            <div className="relative" style={{ height: stages.length * (ROW_H + ROW_GAP) }}>
              <svg
                width={contentW}
                height={stages.length * (ROW_H + ROW_GAP)}
                className="block select-none"
              role="img"
              aria-label="九阶段时间轴"
            >
              {/* 共享 defs：激活发光 + Agent 任务条斜纹 pattern
                  （此前未被渲染，导致 Agent 任务条 url(#task-agent-hatch) 解析失败、斜纹不显；
                  现挂入 SVG 根，保留「人工 / Agent 双形态」功能） */}
              <StageBarDefs />
                {/* 行底纹：激活阶段整行高亮（hex 收敛 timelineColors 常量，v0.3 暗色） */}
                {stages.map((s, i) => (
                  <g key={`rowbg-${s.id}`}>
                    <rect
                      x={0}
                      y={i * (ROW_H + ROW_GAP)}
                      width={contentW}
                      height={ROW_H + ROW_GAP}
                      fill={s.id === activeStageId ? ROW_BG_ACTIVE : i % 2 === 0 ? ROW_BG_EVEN : ROW_BG_ODD}
                    />
                  </g>
                ))}

                {/* 今日虚线 */}
                <TodayLine x={xOf(todayIso, range, pxPerDay)} height={stages.length * (ROW_H + ROW_GAP)} />

                {/* 彩条层 */}
                {stages.map((s, i) => {
                  const isDrag = drag.draggingStageId === s.id;
                  const rawDelta = isDrag ? drag.deltaDays : null;
                  // T5：Workday 口径下把实时 delta 换算成「吸附后的自然日差」，
                  // 让彩条几何与日期气泡贴吸附日（StageBar 零改动）
                  const displayDelta =
                    rawDelta !== null && drag.edge && useWorkday
                      ? (() => {
                          const edgeIso =
                            drag.edge === 'start' ? s.startAt.slice(0, 10) : s.endAt.slice(0, 10);
                          return daysBetween(edgeIso, snapShiftDate(edgeIso, rawDelta, restPolicy));
                        })()
                      : rawDelta;
                  return (
                    <StageBar
                      key={s.id}
                      stage={s}
                      rowIndex={i}
                      rowH={ROW_H}
                      rowGap={ROW_GAP}
                      range={range}
                      pxPerDay={pxPerDay}
                      active={s.id === activeStageId}
                      draggingDeltaDays={displayDelta}
                      draggingEdge={isDrag ? drag.edge : null}
                      onHandleDown={effectiveHandleDown}
                      onClick={() => openDrawer(s.id)}
                    />
                  );
                })}

                {/* v0.6 双色分层：任务级时间条层（Agent 斜纹 / Human 素色 + status 圆点）。
                    仅渲染有 startAt/dueDate 的任务；行几何与 StageBar 无碰撞（贴行底部）。 */}
                {stages.map((s, i) =>
                  tasks
                    .filter((t) => t.stageId === s.id && (t.startAt || t.dueDate))
                    .map((t) => (
                      <TaskBar
                        key={`taskbar-${t.id}`}
                        task={t}
                        rowIndex={i}
                        rowH={ROW_H}
                        rowGap={ROW_GAP}
                        range={range}
                        pxPerDay={pxPerDay}
                        onClick={() => openDrawer(s.id)}
                      />
                    )),
                )}
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* 延期原因弹窗（硬闸门在弹窗内实现；v0.5 支持磁吸联动批量改期） */}
      {batchPending && (
        <RescheduleDialog
          batch={batchPending}
          onClose={() => setBatchPending(null)}
        />
      )}
    </div>
  );
}

/** 激活阶段判定（id 版，保持旧签名避免回归）：委托到共享派生层 lib/progress */
export function pickActiveStage(stages: Stage[], todayIso: string): string | null {
  return pickActiveStageId(stages, todayIso);
}

/** 平移导出（供外部分页按钮类控件复用） */
export { panRange };

/** ISO 日期之间相差天数（end - start，可负） */
function daysBetween(startIso: string, endIso: string): number {
  const ms = new Date(`${endIso}T00:00:00Z`).getTime() - new Date(`${startIso}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

// re-export 供类型引用
export type { Stage };
