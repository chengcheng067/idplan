/**
 * 打印甘特派生层（2026-10-13 · 5 块 × 4 模板重构 · 批 1 地基）。
 *
 * ── 它解决什么 ──
 * `PrintStageVM` 今天只有 `startAt` / `endAt`（`print-view-model.ts:112-131`），
 * 甘特要的三样（视图窗口 / 月份刻度 / 条带几何）**都不在 VM 里**，而且只活在
 * 经典纸面的**私有 hook** `components/print/useSchedulePaperData.ts:96-124`。
 * 四套模板的 B2（打印时间轴）若各自复算一遍，就是本仓出过三次事故的
 * 「第二真值源」（见 `pages/agent-poster/shared.ts` 文件头自述）。
 *
 * 故这里把那段派生**抽成与模板无关的纯函数**：输入 `project + 已过滤的
 * 阶段数组`，输出 `{ viewStart, viewEnd, viewDays, ticks[], rows[] }`。
 * **零新数据源**（`plannedStartAt/EndAt` 与阶段起止都已在 VM 里）、**零权限语义**。
 *
 * ── 与经典的等价纪律（硬要求）──
 * 本文件的三段算法是 `useSchedulePaperData.ts:92-123` 的**逐字复刻**，不是
 * 「参考它的思路」：
 *   · 视图窗口 = 计划窗口 ∪ 全部阶段起止（空串脏行先滤掉，否则 `viewStart=''`
 *     ⇒ `viewDays=NaN` ⇒ **整轴一起 NaN**——band-bounds spec 为此专门锁了一条）；
 *   · 条带几何 `left = offsetDays(start)/viewDays*100`、
 *     `width = max((hi-lo+1)/viewDays*100, 2.5)`（2.5% 最小可见宽，防 1 天阶段隐形）；
 *   · 月份刻度 = `buildMonthTicks(viewStart, viewEnd)` + 同坐标系 `leftPercent`
 *     + `MIN_LABEL_GAP_PCT = 12` 去重叠（首刻度贴左缘时钳到 0）。
 * 常量 `GANTT_MIN_VISIBLE_WIDTH_PCT` / `GANTT_MIN_LABEL_GAP_PCT` 与经典同值，
 * 且 `tests/print-gantt-derive.spec.ts` 里有一条**与经典真机 DOM 逐值对账**的
 * 等价性断言守着——改这里而不同步经典，那条会红。
 */

import type { StageStatus } from '../../core/types/enums';
import { buildMonthTicks, totalDaysInclusive } from '../../lib/date';

/** 条带最小可见宽（%）：1 天阶段在长跨度项目里会缩成不可见，经典同值 */
export const GANTT_MIN_VISIBLE_WIDTH_PCT = 2.5;
/** 相邻月份标签最小间距（%）：太挤就抽稀掉后一个，经典同值（启发式阈值） */
export const GANTT_MIN_LABEL_GAP_PCT = 12;

/**
 * 轨道行高的**设计基线**（px）与紧凑档分界。
 *
 * 行高本身由**宿主模板**按纸面预算自适应后经 `PrintGantt` 的 `rowHeight` 传入
 * （各版的第一页预算不同：A 的板头 + 项目信息就吃掉 ~450px）——本文件只定
 * 「基线 28 / 低于 24 转紧凑字体档」这两个与版式无关的口径，不复制各版预算。
 */
export const GANTT_ROW_HEIGHT = 28;
/**
 * 低于此值时切**紧凑**字体档（名称 10px / 号码 10px / 状态 9px）。
 * 阈值 = 基线档文字的行盒高（16px 号码 → 行盒 24px）：行高小于它，基线字号就会
 * 与相邻行叠字 ⇒ 必须换档。**实测值，不是审美值**（见交付报告的可读性表）。
 */
export const GANTT_COMPACT_UNDER = 24;
/**
 * 低于此值时切**最紧**字体档（名称 9px / 号码 10px；9px 是本仓的 accent 文字下限）。
 * 两档字体都是为了让**文字行盒不超出被压矮的轨道行**——实测判据见交付报告
 * 「行高可读性实测」（14px 行 + 12px 名称时，两行文字盒重叠 4px ⇒ 不可读）。
 */
export const GANTT_DENSE_UNDER = 20;

/** 派生所需的最小阶段形状（`PrintStageVM` / `ScheduleSection` 都能直接喂） */
export interface PrintGanttStageInput {
  /** 稳定 key（`PrintStageVM.id`）；缺省回落 `orderIndex` 拼名 */
  id?: string;
  orderIndex: number;
  name: string;
  /** 起止（含时间或纯日期都可；内部一律 `slice(0, 10)`，与经典同口径） */
  startAt: string;
  endAt: string;
  status: StageStatus;
  colorIndex: number;
  customColor: string | null;
}

/** 派生所需的项目窗口（`PrintProjectVM` 的子集） */
export interface PrintGanttProjectInput {
  plannedStartAt: string;
  plannedEndAt: string;
}

/** 月份刻度（已抽稀；`leftPercent` 与轨道条**同一坐标系**） */
export interface PrintGanttTick {
  label: string;
  leftPercent: number;
}

/** 一条轨道行（几何已钳制；`left` / `width` 是百分比，直接进 inline style） */
export interface PrintGanttRow {
  key: string;
  orderIndex: number;
  name: string;
  startAt: string;
  endAt: string;
  status: StageStatus;
  colorIndex: number;
  customColor: string | null;
  left: number;
  width: number;
  /** 条带 `title`（经典逐字同款：`N. 名称（起始 — 结束 · 状态）` 的日期段） */
  title: string;
}

/** 甘特模型（打印时间轴块的唯一数据形状） */
export interface PrintGanttModel {
  viewStart: string;
  viewEnd: string;
  viewDays: number;
  ticks: readonly PrintGanttTick[];
  rows: readonly PrintGanttRow[];
}

/** 空模型（无项目窗口 / 无阶段时的兜底；渲染侧据此出空态，不画 NaN 轴） */
export const EMPTY_PRINT_GANTT: PrintGanttModel = {
  viewStart: '',
  viewEnd: '',
  viewDays: 0,
  ticks: [],
  rows: [],
};

/**
 * 阶段起止 → 甘特模型。纯函数、无 React、无 store。
 *
 * `stages` 必须是**已经过可见性过滤**的阶段（VM 的 `stages` / 经典的
 * `sections`——两条通路的过滤口径已逐条对齐：
 * 经典 `useSchedulePaperData.ts:76-79` ↔ VM `project-print-adapter.ts:134-138`）。
 * 本函数**不再做可见性判断**，只做几何派生（避免第二个过滤真值源）。
 */
export function buildPrintGantt(
  project: PrintGanttProjectInput,
  stages: readonly PrintGanttStageInput[],
): PrintGanttModel {
  const plannedStart = project.plannedStartAt.slice(0, 10);
  const plannedEnd = project.plannedEndAt.slice(0, 10);
  // 脏行过滤（空串）：与经典逐字同款。**别删**——一条 `startAt=''` 的脏行会把
  // viewStart 拉成 ''（空串在字符串比较里最小）⇒ viewDays = NaN ⇒ 整轴 NaN。
  const starts = stages.map((s) => s.startAt.slice(0, 10)).filter((d) => d !== '');
  const ends = stages.map((s) => s.endAt.slice(0, 10)).filter((d) => d !== '');
  const viewStart = starts.length ? [plannedStart, ...starts].reduce((a, b) => (a < b ? a : b)) : plannedStart;
  const viewEnd = ends.length ? [plannedEnd, ...ends].reduce((a, b) => (a > b ? a : b)) : plannedEnd;
  const viewDays = Math.max(totalDaysInclusive(viewStart, viewEnd), 1);

  // 窗口本身立不住（无项目窗口）⇒ 返回空模型，不让 NaN 流进 inline style
  if (!viewStart || !viewEnd || !Number.isFinite(viewDays) || viewDays <= 0) {
    return EMPTY_PRINT_GANTT;
  }

  const offsetDays = (iso: string): number => totalDaysInclusive(viewStart, iso) - 1;

  const rows: PrintGanttRow[] = stages.map((s) => {
    const startAt = s.startAt.slice(0, 10);
    const endAt = s.endAt.slice(0, 10);
    const lo = offsetDays(startAt);
    const hi = offsetDays(endAt);
    // 脏行（日期为空）不给几何：它自己会 NaN，但**不许污染别的行**
    // （union 已在上面把空串滤掉，故其它行的几何与本行无关）
    const broken = startAt === '' || endAt === '';
    return {
      key: s.id ?? `${s.orderIndex}-${s.name}`,
      orderIndex: s.orderIndex,
      name: s.name,
      startAt,
      endAt,
      status: s.status,
      colorIndex: s.colorIndex,
      customColor: s.customColor,
      left: broken ? 0 : (lo / viewDays) * 100,
      width: broken ? 0 : Math.max(((hi - lo + 1) / viewDays) * 100, GANTT_MIN_VISIBLE_WIDTH_PCT),
      title: `${s.orderIndex}. ${s.name}（${startAt} — ${endAt}）`,
    };
  });

  const kept: PrintGanttTick[] = [];
  for (const t of buildMonthTicks(viewStart, viewEnd)) {
    const leftPercent = Math.max((offsetDays(t.start) / viewDays) * 100, 0);
    const prev = kept[kept.length - 1];
    if (prev && leftPercent - prev.leftPercent < GANTT_MIN_LABEL_GAP_PCT) continue;
    kept.push({ label: t.label, leftPercent });
  }

  return { viewStart, viewEnd, viewDays, ticks: kept, rows };
}
