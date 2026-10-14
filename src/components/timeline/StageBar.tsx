import type { PointerEvent as ReactPointerEvent } from 'react';

import { xOf, type TimelineRange } from '../../lib/date';
import type { Stage } from '../../core/types/entities';
import { StageStatus } from '../../core/types/enums';
import { stageBandColor, stageBandInkColor, stageBandOutline } from './stageColors';
import { customStageColor } from './stageColorKey';
import { STAGE_ACTIVE_STROKE, STAGE_GLOW_COLOR } from './timelineColors';
import { useLang, type MessageKey } from '../../i18n';

/**
 * 交付阶段子刻度三标签（三等分浅色竖线上的「交底 / 中期 / 验收」）。
 * ⚠️ 与下面 `isDeliveryStageName()` **毫无关系**：那一条是**行为耦合**
 *    （拿用户数据里的阶段名当分支条件），不是文案 —— 翻不了、也不该翻，只登记不删。
 */
const STAGE_SEG_KEYS: readonly MessageKey[] = [
  'timeline.stageSeg.handover',
  'timeline.stageSeg.midterm',
  'timeline.stageSeg.acceptance',
];

/**
 * 「交付阶段」判据 —— ⚠️ 这是**行为耦合**，不是文案，别当文案删 / 别「顺手重构」。
 *
 * ── 沿革 ──
 * 原判据是 `stage.name.includes('交付')`（i18n 笔 3-C 登记「刻意不改」）。
 * 2026-10-15 夜批（D1）把它放宽为「中英两种写法都认」：
 *     name.includes('交付') || /delivery/i.test(name)
 * 动因（用户可感知缺陷）：阶段名改成英文/别称（如 `Delivery`）后，子刻度会
 * **静默消失**，且消失时没有任何东西会红。
 *
 * ── ★ 这是行为变更，待产品确认（不是等价重构，不许粉饰成顺手修的）──
 * · 内置库全量数据（templates/stage-library.json 74 项 + templates/nine-stages.default.json
 *   9 段，共 83 条阶段行，覆盖 9 个 domain）上逐条比对：放宽前后 **100% 一致** ——
 *   内置阶段名没有任何一条含 'delivery'（不区分大小写）。
 * · 会变的是**用户数据**：名字里带 'delivery'/'Delivery' 的阶段（即此前子刻度
 *   静默消失的那批）现在显示子刻度；其余阶段行为不变。
 * · 放宽面：子串匹配（与 '交付' 同款判据形态，不是新引入的性质），
 *   'Delivery rehearsal' 这类名字也会命中。
 * · **未覆盖**：'Handover' 拼写（室内段 templateKey 是 indoor.handover，中文名「交付」）。
 *   产品若认为室内项目的英文惯例是 Handover，需再议——本次不擅自扩。
 *
 * ── 为什么不改成按结构判（templateKey / kanbanColumn / orderIndex）：证不出等价 ──
 * 在内置库全量数据上逐条比对过「按名字判」与各结构判据，**没有一条 100% 一致**：
 *   · kanbanColumn === 'delivery'：多命中 consulting.landing/close/train
 *     （落地辅导/结项复盘/培训赋能），且漏掉 indoor.handover（它的列是 'build'）；
 *   · templateKey === 'indoor.handover'：漏 film.deliver / wedding.deliver；
 *   · templateKey ∈ {indoor.handover, film.deliver, wedding.deliver}：内置库上虽
 *     100% 一致，但那是**从名字反推的集合**（循环论证）；且 templateKey 对
 *     「用户自定义阶段 / Agent 建的阶段」恒为 null（custom-stage.service 与
 *     stage-resolve.buildCreatedStage 明文落 null）⇒ 换成它会把这些阶段名里
 *     带「交付」的子刻度**静默删掉** —— 正是本缺陷的同款失效模式，只是换了个方向
 *     （tests/stage-color-wiring.spec.tsx 的夹具 `阶段N交付` + templateKey:null
 *      就是活证据：它靠名字判据才能覆盖 ink 出口的子刻度消费点）。
 * 根本原因：数据模型里没有「这是交付阶段」的结构化身份。正确的修法是产品把
 * 「交付阶段」做成显式字段；在那之前只能拿名字判，故保留名字判并放宽写法。
 */
function isDeliveryStageName(name: string): boolean {
  return name.includes('交付') || /delivery/i.test(name);
}

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
  /* 取词 + 订阅语言变化（子刻度三标签 / 拖拽气泡随语言变） */
  const { t } = useLang();
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

      {/*
        ★ 行为耦合登记（D1，2026-10-15 夜批）：判据在 `isDeliveryStageName()`（文件顶部），
          拿**用户数据里**的阶段名（中文「交付」或英文 delivery，不区分大小写）当分支条件。
          历史：原样 `stage.name.includes('交付')`，曾登记「刻意不改」（i18n 笔 3-C）；
          现已放宽为兼容中英两种写法 —— **这是行为变更，待产品确认**，理由、比对数据、
          未覆盖面（'Handover' 拼写）与「为什么不改结构判据」全部登记在函数注释里。
          残留缺陷（与放宽前同款）：阶段名若改成第三种写法（如 `Handover`），子刻度
          仍会**静默消失**，没有任何东西会红。
        ⚠️ 这不是文案，别当文案删。
      */}
      {/* 交付阶段子刻度（三等分浅色竖线；三标签文案见 STAGE_SEG_KEYS） */}
      {isDeliveryStageName(stage.name) && w > pxPerDay * 6 && (
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
              {t(STAGE_SEG_KEYS[i] ?? STAGE_SEG_KEYS[0]!)}
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
  /* 取词 + 订阅语言变化（气泡里那两个字随语言变；宽度按取值长度算 ⇒ 自动适配） */
  const { t } = useLang();
  const label =
    edge === 'start'
      ? t('timeline.dragBubble.start', { date })
      : t('timeline.dragBubble.end', { date });
  const width = label.length * 6.5 + 10;
  const height = 18;
  const rx = 4;
  return (
    <g transform={`translate(${x - width / 2}, ${y - height})`} pointerEvents="none">
      <rect x={0} y={0} width={width} height={height} rx={rx} fill="var(--color-ink)" />
      <text
        x={width / 2}
        y={12}
        textAnchor="middle"
        fontSize={9}
        fill="var(--color-paper)"
      >
        {label}
      </text>
    </g>
  );
}

/** SVG filter defs（激活发光）——挂在 TimelineView 的 svg 内 */export function StageBarDefs(): JSX.Element {
  return (
    <defs>
      <filter id="stage-glow" x="-15%" y="-40%" width="130%" height="180%">
        <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={STAGE_GLOW_COLOR} floodOpacity="0.45" />
      </filter>
    </defs>
  );
}
