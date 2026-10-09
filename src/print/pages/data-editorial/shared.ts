/**
 * D 版四页共用的小工具（状态字形双编码 / 文案 / 时间戳格式）。
 *
 * ── 为什么状态必须「字形 + 文字」双编码 ──
 * 01 §2：灰度打印仍须可读，状态不能只靠色相。D 版的信号橙红在灰度下会变成
 * 中灰，与灰阶素材混在一起；故每个状态都配一个**形状不同**的字形（实心 /
 * 半满 / 空心 / 三角），颜色只是第三重编码。这套字形与 A 版同源（同一套
 * 纸面阅读语言），但各版自持一份——四版组件必须独立（01 §1）。
 *
 * ── 为什么时间戳格式在这层 ──
 * generatedAt 是 ISO 全串，纸面要「yyyy-MM-dd HH:mm」。A 版自带一个私有
 * stampOf；D 版不跨版 import（版本组件独立），同族小函数各持一份，三行
 * 逻辑不存在漂移风险。
 */

import { StageStatus, TASK_STATUS_LABELS, TaskStatus } from '../../../core/types/enums';

/** 阶段四态标签（全仓无既有中文出处，打印纸面专用） */
export function stageStatusLabel(status: StageStatus): string {
  switch (status) {
    case StageStatus.InProgress:
      return '进行中';
    case StageStatus.Completed:
      return '已完成';
    case StageStatus.Delayed:
      return '延期';
    default:
      return '未开始';
  }
}

/** 阶段四态字形（灰度可辨：实心 / 半满 / 空心 / 三角） */
export const STAGE_GLYPH: Record<StageStatus, string> = {
  [StageStatus.NotStarted]: '□',
  [StageStatus.InProgress]: '◐',
  [StageStatus.Completed]: '●',
  [StageStatus.Delayed]: '▲',
};

/**
 * 任务七态 → 纸面四类视觉编码（01 §5 P2：必须能区分已完成 / 进行中 /
 * 未启动 / 异常）：
 *   · done          → 实心（ink 填充反白）
 *   · in_progress   → 粗边（2px ink 描边）
 *   · blocked       → 信号边（2px 橙红描边 + 信号字；阻塞 = 重点状态）
 *   · 其余五态      → 细边（1px 灰描边；未启动一族）
 */
export type TaskNodeTone = 'done' | 'active' | 'blocked' | 'idle';

export function taskNodeTone(status: TaskStatus): TaskNodeTone {
  switch (status) {
    case TaskStatus.Done:
      return 'done';
    case TaskStatus.InProgress:
      return 'active';
    case TaskStatus.Blocked:
      return 'blocked';
    default:
      return 'idle';
  }
}

/** 任务七态字形（与 tone 对应的形状编码） */
export function taskGlyph(status: TaskStatus): string {
  switch (taskNodeTone(status)) {
    case 'done':
      return '●';
    case 'active':
      return '◐';
    case 'blocked':
      return '▲';
    default:
      return '□';
  }
}

/** 任务七态中文标签（复用全仓唯一出处 TASK_STATUS_LABELS） */
export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

/**
 * 任务七态 → `.de-state` 的 data-tone 值（CSS 只认 completed / in_progress /
 * delayed / signal 四档 + 默认灰）。done 并入 completed 档（墨色），blocked
 * 走 signal 档（橙红 = 重点状态），其余落默认灰。
 */
export function taskStateTone(status: TaskStatus): string {
  switch (taskNodeTone(status)) {
    case 'done':
      return 'completed';
    case 'active':
      return 'in_progress';
    case 'blocked':
      return 'signal';
    default:
      return 'idle';
  }
}

/** ISO 时间串 → 纸面用的「yyyy-MM-dd HH:mm」 */
export function stampOf(iso: string): string {
  return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
}

/** 百分比整数（四舍五入；0-100 的展示口径） */
export function pct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/**
 * 文本截断（按显示宽度估算：CJK 全宽 1、拉丁 0.56）。
 * SVG text 不换行，超宽必须截；完整文本经 <title> / title 属性保留（02 §8）。
 */
export function truncateToWidth(text: string, maxWidth: number, fontSize: number): string {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const w = (ch.codePointAt(0) ?? 0) > 0x2e7f ? fontSize : fontSize * 0.56;
    if (width + w > maxWidth) {
      return i === 0 ? '' : text.slice(0, i) + '…';
    }
    width += w;
  }
  return text;
}

/* ------------------------------------------------------------------ 矩阵分页 */

import type { PrintStageVM } from '../../model/print-view-model';

/**
 * D 矩阵分页估高（2026-10-09「原生矩阵无分页」修复；0.8.6.0007 反馈：
 * 20 阶段第 1 页实测 1193px、30 阶段 1615px 溢出纸面）。
 *
 * 纪律与经典 `paginateSections`（schedule-print.ts，f428902）同源：**实测
 * 校准、只许偏大不许偏小、幅度 ≤+10%**（偏大 = 早分页白留一截，偏小 =
 * 内容溢出 794×1123 即红）。下列实测值均为真 Chromium 量：
 *   页壳 chrome：de-head 125.6 + de-foot 40 + de-body 内距 26 = 191.6
 *   KPI 带：normal 74.6 / compact 51.3（阈值同 ProgressMatrixPage：15+ 阶段）
 *   表头 thead：normal 27.3 / compact 23.3
 *   数据行：normal 48.5 / compact 42.8（行高由 stage 格 no+name 行盒主导，
 *           ~35px 内容 vs 16.5px 行高——既有布局特性，分页只估不改）
 *   口径注 41；board 子项间距 20；续表头（border 2 + padding 8 + 文字）≈25
 * ⚠️ 若将来收紧矩阵行高（如给 no/name 定 line-height），必须同步重估这里。
 */
const MATRIX_EST = {
  /** 纸面可用高 = 1123 − 页头 130 − 页脚 42 − body 内距 27 */
  usable: 1123 - 130 - 42 - 27,
  /** board 子项间距（stats/续表头/table/note 之间） */
  boardGap: 21,
  /** KPI 摘要带（**仅第一页**——产品原则「焦点必须松」，续表不重复） */
  kpiNormal: 78,
  kpiCompact: 54,
  /** 表头 */
  theadNormal: 29,
  theadCompact: 25,
  /** 数据行（一行 = 一个阶段的完整记录，行不裂） */
  rowNormal: 52,
  rowCompact: 46,
  /** 口径注（每页都有——每页可独立解释，01 §2） */
  note: 44,
  /** 续表头（仅续表页；D 硬边语法：2px 线 + kicker） */
  contHead: 28,
} as const;

/** 15+ 阶段转紧凑档（与 ProgressMatrixPage 的 dense 判定同源）。
 *  为什么是 15 而不是密度批的 16：分页估高下 normal 行容量 14——15 阶段若走
 *  normal 会被切 14+1 两页，而修复前 15 阶段本来能一页装下（不回归）；紧凑档
 *  容量 16，15/16 阶段都守一页。 */
const MATRIX_COMPACT_AT = 14;

/** 一个物理纸面的矩阵行分块（行不裂：行是原子单位） */
export interface MatrixChunk {
  readonly rows: readonly PrintStageVM[];
}

export interface MatrixPlan {
  readonly chunks: readonly MatrixChunk[];
  readonly compact: boolean;
}

/**
 * 阶段行 ⇒ 分块计划（贪心装页，确定性）。
 * 第一页预算扣 KPI 带（焦点只首页）；续表页扣续表头、不扣 KPI。
 * 行数 0 ⇒ 单空块（调用方走空态，不出表格纸面）。
 */
export function planMatrixPages(stages: readonly PrintStageVM[]): MatrixPlan {
  const compact = stages.length > MATRIX_COMPACT_AT;
  const row = compact ? MATRIX_EST.rowCompact : MATRIX_EST.rowNormal;
  const thead = compact ? MATRIX_EST.theadCompact : MATRIX_EST.theadNormal;
  const kpi = compact ? MATRIX_EST.kpiCompact : MATRIX_EST.kpiNormal;
  const chrome = thead + MATRIX_EST.note + MATRIX_EST.boardGap * 2;
  const firstBudget = MATRIX_EST.usable - kpi - chrome;
  const laterBudget = MATRIX_EST.usable - MATRIX_EST.contHead - chrome;

  const chunks: MatrixChunk[] = [];
  let current: PrintStageVM[] = [];
  let used = 0;
  let isFirst = true;
  for (const s of stages) {
    const budget = isFirst ? firstBudget : laterBudget;
    if (current.length > 0 && used + row > budget) {
      chunks.push({ rows: current });
      current = [];
      used = 0;
      isFirst = false;
    }
    current.push(s);
    used += row;
  }
  if (current.length > 0 || chunks.length === 0) chunks.push({ rows: current });
  return { chunks, compact };
}
