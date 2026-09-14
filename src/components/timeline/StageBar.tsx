import type { PointerEvent as ReactPointerEvent } from 'react';

import { xOf, type TimelineRange } from '../../lib/date';
import type { Stage, Task } from '../../core/types/entities';
import { StageStatus } from '../../core/types/enums';
import { stageBandColor, stageBandInkColor, stageBandOutline } from './stageColors';
import { customStageColor } from './stageColorKey';
import {
  STAGE_ACTIVE_STROKE,
  STAGE_GLOW_COLOR,
  TASK_BAR_AGENT,
  TASK_BAR_AGENT_HATCH,
  TASK_BAR_HUMAN,
} from './timelineColors';

/**
 * 彩条本体：SVG rect + 左右手柄 + 激活发光 + 交付段子刻度。
 * 坐标一律经 lib/date.xOf 计算（T10 铁则）。
 */
export function StageBar({
  stage,
  rowIndex,
  rowH,
  rowGap,
  range,
  pxPerDay,
  active,
  draggingDeltaDays,
  draggingEdge,
  onHandleDown,
  onClick,
}: {
  stage: Stage;
  rowIndex: number;
  rowH: number;
  rowGap: number;
  range: TimelineRange;
  pxPerDay: number;
  active: boolean;
  /** 实时拖拽位移（天）；非拖拽为 null */
  draggingDeltaDays: number | null;
  draggingEdge: 'start' | 'end' | null;
  onHandleDown(e: ReactPointerEvent, stage: Stage, edge: 'start' | 'end'): void;
  onClick(): void;
}): JSX.Element {
  const y = rowIndex * (rowH + rowGap);
  // 画板 04：跨度色带高 36（行高 44 - 上下各 4px 留白）；band 在行内垂直居中
  const barH = rowH - 8;
  const bandY = y + 4;

  const dStart = stage.startAt.slice(0, 10);
  const dEnd = stage.endAt.slice(0, 10);

  let xStart = xOf(dStart, range, pxPerDay);
  let xEnd = xOf(dEnd, range, pxPerDay) + pxPerDay; // 含头尾：终点日右缘

  // 拖拽实时形变预览（daily snap 后的整数天）
  if (draggingDeltaDays !== null && draggingEdge === 'end') {
    xEnd += draggingDeltaDays * pxPerDay;
    if (xEnd < xStart + pxPerDay) xEnd = xStart + pxPerDay; // 至少一天
  }
  if (draggingDeltaDays !== null && draggingEdge === 'start') {
    xStart += draggingDeltaDays * pxPerDay;
    if (xStart > xEnd - pxPerDay) xStart = xEnd - pxPerDay;
  }

  const w = Math.max(pxPerDay, xEnd - xStart);
  // ── 三条取色出口（v0.8 A11 · ① 时间轴跨度色带；唯一同时消费三个出口的组件）──
  // 颜色与 orderIndex 解耦：三个出口内部都先 `resolveStageColorIndex(orderIndex, colorIndex)`
  // （多阶段项目 1..9 循环色板，缺失/越界时读时回落到 orderIndex 对应色）。
  // 阶段条是**宽面**（设计规格 §1.2）：亮色页 lightBar / 暗色页 darkBar —— 即 --stage-band-sN；
  // 条内文字 / 子刻度线必须配 --stage-ink-sN，否则「芽白 / 米白」段上的白字会彻底看不见。
  // 第三个形参是 v0.8 通路 B 的入口：传了合法 customColor 即改走 --stage-local-band / -ink，
  // 内置色（null / undefined / 空串 / 脏值）与改造前**逐字节同值**。
  // ⚠️ 三条都必须传同一个 customColor —— 漏掉任一条，自定义色会出现
  //    「带面变色、描边还是内置色」这类半截状态。
  const fill = stageBandColor(stage.orderIndex, stage.colorIndex, stage.customColor);
  const ink = stageBandInkColor(stage.orderIndex, stage.colorIndex, stage.customColor);
  // 色带发丝描边（BUG-04）：规格 §1.2 未定义「色带 vs 行底」对比度，导致浅带（s5 芽白 /
  // s7 米白）在亮色行底、深带（s1 松墨 / s9 栗褐）在暗色行底双双隐形（对比度 ~1.1）。
  // 描边色取本阶段的 --stage-ink-sN（天生与带面明度对立），一个公式通吃九色与两套主题。
  // 通路 B 下走 `-rgb` 三元组（global.css 的九色各有 --stage-ink-sN-rgb；注入表同构地备了
  // 一份 --stage-local-ink-rgb）—— 漏了它，自定义色的描边会**静默消失**。
  const outline = stageBandOutline(stage.orderIndex, stage.colorIndex, stage.customColor);
  // 自定义色的 `data-stage-key`：挂在最外层 `<g>` 上一次覆盖全部子元素（主体 rect / 描边 rect /
  // 交付子刻度 line + text / 左右手柄 / 日期标注）—— 它们共用同一个阶段色，没有理由各挂一次。
  // 内置色时是 `{}`（铺不开任何属性），本组件对内置色**一个类名都不加**（颜色全走 var() 属性）。
  const { attrs: colorAttrs } = customStageColor(stage.customColor);

  // 拖拽时显示的新日期（用于气泡提示）
  const previewDate =
    draggingDeltaDays !== null && draggingEdge
      ? shiftIsoDate(draggingEdge === 'start' ? dStart : dEnd, draggingDeltaDays)
      : null;

  // 状态透明度
  const opacity =
    stage.status === StageStatus.Completed ? 0.35 : stage.status === StageStatus.NotStarted ? 0.8 : 1;

  const handleW = 7;

  return (
    <g
      style={{ cursor: 'pointer' }}
      {...colorAttrs}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {/* 彩条主体（画板 04：宽面 lightBar / 暗色 darkBar，圆角 8；进行中阶段额外 1px pine 描边） */}
      <rect
        x={xStart}
        y={bandY}
        width={w}
        height={barH}
        rx={8}
        ry={8}
        fill={fill}
        opacity={opacity}
        stroke={active ? STAGE_ACTIVE_STROKE : 'none'}
        strokeWidth={active ? 1 : 0}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      />

      {/* 发丝描边（BUG-04）：单独一层 rect，因为同一个 <rect> 只有一个 stroke 通道，
          而激活态已经占用它画 STAGE_ACTIVE_STROKE。fill=none 只描边，不影响带面与透明度。
          圆角与主体保持一致（8）。 */}
      <rect
        x={xStart}
        y={bandY}
        width={w}
        height={barH}
        rx={8}
        ry={8}
        fill="none"
        stroke={outline.stroke}
        strokeOpacity={outline.strokeOpacity * opacity}
        strokeWidth={outline.strokeWidth}
        pointerEvents="none"
      />

      {/* 交付阶段子刻度（交底 / 中期 / 验收 三等分浅色竖线） */}
      {stage.name.includes('交付') && w > pxPerDay * 6 && (
        <>
          {[1, 2].map((i) => (
            <line
              key={`seg-${stage.id}-${i}`}
              x1={xStart + (w * i) / 3}
              x2={xStart + (w * i) / 3}
              y1={bandY + 3}
              y2={bandY + barH - 1}
              stroke={ink}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              opacity={0.55}
            />
          ))}
          {/* 子刻度标签 */}
          {[0, 1, 2].map((i) => (
            <text
              key={`lab-${stage.id}-${i}`}
              x={xStart + (w * i) / 3 + w / 9}
              y={bandY + barH - 3}
              textAnchor="middle"
              fontSize={9}
              fill={ink}
              opacity={0.85}
            >
              {['交底', '中期', '验收'][i]}
            </text>
          ))}
        </>
      )}

      {/* 左右手柄（仅未完成阶段可拖） */}
      {stage.status !== StageStatus.Completed && (
        <>
          <rect
            x={xStart + 1}
            y={bandY + 8}
            width={handleW}
            height={barH - 16}
            rx={3}
            fill={ink}
            opacity={0.5}
            style={{ cursor: 'ew-resize' }}
            onPointerDown={(e) => onHandleDown(e, stage, 'start')}
          />
          <rect
            x={xEnd - handleW - 1}
            y={bandY + 8}
            width={handleW}
            height={barH - 16}
            rx={3}
            fill={ink}
            opacity={0.5}
            style={{ cursor: 'ew-resize' }}
            onPointerDown={(e) => onHandleDown(e, stage, 'end')}
          />
        </>
      )}

      {/* 条内日期标注（宽度足够时） */}
      {w > pxPerDay * 20 && (
        <text
          x={xStart + w / 2}
          y={bandY + 22}
          textAnchor="middle"
          fontSize={9.5}
          fill={ink}
          opacity={0.92}
          pointerEvents="none"
        >
          {dStart} → {dEnd}
        </text>
      )}

      {/* 拖拽时日期气泡（跟随边缘，显示精准日期） */}
      {previewDate && draggingEdge && (
        <DateBubble
          x={draggingEdge === 'start' ? xStart : xEnd}
          y={y - 8}
          date={previewDate}
          edge={draggingEdge}
        />
      )}
    </g>
  );
}

/** 日期偏移（天，可负） */
function shiftIsoDate(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** 拖拽日期气泡：深色小卡片，跟随鼠标所拖边缘 */
function DateBubble({
  x,
  y,
  date,
  edge,
}: {
  x: number;
  y: number;
  date: string;
  edge: 'start' | 'end';
}): JSX.Element {
  const label = edge === 'start' ? `开始 ${date}` : `截止 ${date}`;
  const width = label.length * 6.5 + 10;
  const height = 18;
  const rx = 4;
  return (
    <g transform={`translate(${x - width / 2}, ${y - height})`} pointerEvents="none">
      <rect x={0} y={0} width={width} height={height} rx={rx} fill="var(--ink)" />
      <text
        x={width / 2}
        y={12}
        textAnchor="middle"
        fontSize={9}
        fill="var(--paper)"
      >
        {label}
      </text>
    </g>
  );
}

/**
 * 任务条 status 圆点色（受控例外：hex 集中在 TS 常量，与 stageColors.ts 同款范式，
 * 不散落在 JSX；语义 ready=绿 / review=琥珀 / blocked=红陶 / 其余=灰绿）。
 */
const TASK_STATUS_DOT: Record<string, string> = {
  draft: '#88A293',
  ready: '#5B8C5B',
  claimed: '#D9A441',
  in_progress: '#5B8C5B',
  blocked: '#C4553B',
  review: '#D9A441',
  done: '#88A293',
};

/** SVG filter defs（激活发光）——挂在 TimelineView 的 svg 内 */export function StageBarDefs(): JSX.Element {
  return (
    <defs>
      <filter id="stage-glow" x="-15%" y="-40%" width="130%" height="180%">
        <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={STAGE_GLOW_COLOR} floodOpacity="0.45" />
      </filter>
      {/* v0.6 双色分层：Agent 任务条斜纹 pattern（hex 只经 CSS 变量，铁律 8） */}
      <pattern id="task-agent-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill={TASK_BAR_AGENT} />
        <line x1="0" y1="0" x2="0" y2="6" stroke={TASK_BAR_AGENT_HATCH} strokeWidth="2" />
      </pattern>
    </defs>
  );
}

/**
 * 任务级时间条（v0.6 双色分层，设计文档 T13 要点 3/4）：
 *   - Agent 任务 → 斜纹填充（url(#task-agent-hatch)）；Human 任务 → 素色；
 *   - 左端 status 小圆点（英文状态 token 映射：ready=pine / review=amber /
 *     blocked=clay / 其余=mist）；
 *   - 条高比阶段彩条矮（贴行底部），与 StageBar 拖拽手柄无碰撞；
 *   - 仅当任务有 startAt/dueDate 时渲染（调用方过滤）。
 */
export function TaskBar({
  task,
  rowIndex,
  rowH,
  rowGap,
  range,
  pxPerDay,
  onClick,
}: {
  task: Task;
  rowIndex: number;
  rowH: number;
  rowGap: number;
  range: TimelineRange;
  pxPerDay: number;
  onClick(): void;
}): JSX.Element {
  const start = (task.startAt ?? task.dueDate ?? '').slice(0, 10);
  const end = (task.dueDate ?? task.startAt ?? '').slice(0, 10);
  if (!start || !end) return <g />;
  const x1 = xOf(start, range, pxPerDay);
  const x2 = xOf(end, range, pxPerDay) + pxPerDay; // 含头尾
  const w = Math.max(pxPerDay, x2 - x1);

  // 贴行底部：阶段彩条占 y+7..y+rowH-7，任务条放 y+rowH-9 起的细条
  const y = rowIndex * (rowH + rowGap) + rowH - 10;
  const barH = 5;

  const isAgent = task.source === 'agent';
  const dotFill = TASK_STATUS_DOT[task.status] ?? '#88A293';

  return (
    <g style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <rect
        x={x1}
        y={y}
        width={w}
        height={barH}
        rx={2.5}
        ry={2.5}
        fill={isAgent ? 'url(#task-agent-hatch)' : TASK_BAR_HUMAN}
        opacity={0.9}
      >
        <title>{`${task.title} · ${task.status}${isAgent ? ' · agent' : ' · human'}`}</title>
      </rect>
      {/* status 圆点（小、贴条左端） */}
      <circle cx={x1 + 2.5} cy={y + barH / 2} r={2.5} fill={dotFill} />
    </g>
  );
}
