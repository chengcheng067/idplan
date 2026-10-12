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

/**
 * ISO 时间串 → 页头报告号的「yyyy.MM.dd」（点分，P1-7 右半）。
 *
 * 为什么另开一个函数而不是复用 `stampOf`：`stampOf` 是**数据时间**的口径
 * （`yyyy-MM-dd HH:mm`，出现在页脚与正文注里），页头报告号是**报告身份**
 * 的口径（点分日期、无时刻，与参考稿页眉 `REPORT nn / nn YYYY.MM.DD` 同形）。
 * 两者语义不同、形状不同，合并会逼着其中一处将就另一处。
 */
export function reportStampOf(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '.');
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

import type { PrintStageLogVM, PrintStageVM, PrintViewModel } from '../../model/print-view-model';
import { StageLogType } from '../../../core/types/enums';

/**
 * D 矩阵分页估高（2026-10-09「原生矩阵无分页」修复；0.8.6.0007 反馈：
 * 20 阶段第 1 页实测 1193px、30 阶段 1615px 溢出纸面）。
 *
 * 纪律与经典 `paginateSections`（schedule-print.ts，f428902）同源：**实测
 * 校准、只许偏大不许偏小、幅度 ≤+10%**（偏大 = 早分页白留一截，偏小 =
 * 内容溢出 794×1123 即红）。下列实测值均为真 Chromium 量：
 *
 * 2026-10-11 P0-7 骨架重做后重标（6 列表格 → 两段式通栏条）：
 *   页壳 chrome 合计 346 = 页头 213（3px 分隔线底）+ 主体上内距 39
 *                        + 页尾完成度横带 42 + 脚注 52（含 8px 上距）
 *   行：normal 90（段1 16 + 间隙 6 + 条 32 + 下距 36，参考稿实测节距 90）
 *       compact 49（段1 13 + 间隙 3 + 条 20 + 下距 13）
 *   **每页最后一行的下距不计**（CSS `.de-row:last-child { margin-bottom: 0 }`）
 *   ⇒ 容量判据是 `Σ行高 − 尾行下距 ≤ usable`，页壳已经把这 36px 让给了
 *   横带，所以这里必须把「尾行免下距」写进预算，否则 9 行会被切成 8+1
 *   （参考稿 P1 恰好 9 行一整页）。
 *   续表页另扣续表头 28（第一页没有）。
 *
 * ── 两档容量与切档点（2026-10-11 重算，必须一起看）──
 *   usable = 1123 − 213 − 39 − 42 − 52 = 777
 *     normal 预算 = 777 + 36 = 813 ⇒ ⌊813/90⌋ = **9 行**（= 参考稿 P1 行数）
 *     compact 预算 = 777 + 13 = 790 ⇒ ⌊790/49⌋ = **16 行**
 *   切档点 `MATRIX_COMPACT_AT = 9`：**normal 容量刚好是 9**，所以「normal 装不
 *   下」与「切 compact」是同一条线（10 阶段起走 compact）——不留任何「normal
 *   装不下却仍在 normal 档」的区间，否则 10 阶段会切成 9+1 两页、第二页只剩
 *   一行（参考稿节距 90 是硬设计值，9 行就是 normal 的上限）。
 *   compact 容量 16 ≥ 切档点 9 + 1 ⇒ 旧纪律「切档后不出现页数断崖」保持成立
 *  （原实现记的是「normal 容量 14 / compact 容量 16 / 切档 15」）。
 * ⚠️ 若将来再动行高/横带高，必须同步重估这里与 `ProgressMatrixPage` 的档位
 * 判定（后者直接 import 本常量，不再各写一份）。
 */
const MATRIX_EST = {
  /** 纸面可用高 = 1123 − 页头 213 − 主体上内距 39 − 横带 42 − 脚注 52
      （52 = 8 上距 + 44 脚注行高）。全部是 CSS 里**钉死的常数**（页头 logo 行
      28 + 下距 36 + 标题 64×1 + 副标 6+15×1.5 + 内距 40/16），
      所以这里不需要额外「字体余量」；只留 3px 收整。 */
  usable: 1123 - 213 - 39 - 42 - 52,
  /** 每页**尾行免掉的**下距（与 CSS `.de-row:last-child` 同源） */
  lastRowFree: 36,
  lastRowFreeCompact: 13,
  /** 数据行（一段 = 一个阶段的完整记录：段1 标签行 + 段2 通栏条，行不裂） */
  rowNormal: 90,
  rowCompact: 49,
  /** 续表头（仅续表页；D 硬边语法：2px 线 + kicker + 20px 下距） */
  contHead: 28,
} as const;

/**
 * 转紧凑档的阶段数阈值（> 此值即 compact）。
 * = normal 档容量（9）：normal 装不下的第一个规模就切 compact。
 * `ProgressMatrixPage` 直接 import 本常量（原先是两处各写一个 14，注释声称
 * 「同源」但没有实际同源——本轮顺手消掉）。
 */
export const MATRIX_COMPACT_AT = 9;

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
 * 每页预算 = `usable + 尾行免下距`（第一页与续表页同；续表页另扣续表头）。
 * 行数 0 ⇒ 单空块（调用方走空态，不出行区纸面）。
 */
export function planMatrixPages(stages: readonly PrintStageVM[]): MatrixPlan {
  const compact = stages.length > MATRIX_COMPACT_AT;
  const row = compact ? MATRIX_EST.rowCompact : MATRIX_EST.rowNormal;
  const free = compact ? MATRIX_EST.lastRowFreeCompact : MATRIX_EST.lastRowFree;
  // 容量口径：Σ行高 − 尾行下距 ≤ usable ⇒ 判据写成 `used + row > usable + free`
  const firstBudget = MATRIX_EST.usable + free;
  const laterBudget = firstBudget - MATRIX_EST.contHead;

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

/* ------------------------------------------------------------------ B4 通栏条（P0-10/P0-11 口径） */

/**
 * 条填充最小宽度（px；P0-11）。
 * 参考稿实测：12% / 4% / 3% / 0% 四档的填充全是 **96px**（14.1–14.7% 轨宽），
 * 即「比例再小也留一根看得见的底桩」。96 是**绝对 px**，而轨道是通栏固定
 * 682px ⇒ 安全；若将来轨道宽度可变，须改成比例式 `max(占比, 14%)`。
 * 用 CSS `max()` 表达 `max(trackWidth × pct/100, 96px)`——页组件层实现
 * （审计点名：不要写进 CSS 的固定 width）。
 *
 * 2026-10-13 批 B：本组三个出口从 `ProgressMatrixPage.tsx` 搬到本文件——B4 的
 * 行渲染被抽成 `StageBarList.tsx` 后，两个组件都要用它；留在原处会形成
 * 「StageBarList ⇄ ProgressMatrixPage」的双向 import。搬到这里（纯函数层）
 * 两边单向依赖，且口径注释随函数一起搬（未改一字）。
 */
export const DE_BAR_MIN_FILL_PX = 96;

/** 填充宽度（CSS `max()`）：小比例钳到 96px，大比例按百分比 */
export function deBarFillWidth(percent: number): string {
  return `max(${percent}%, ${DE_BAR_MIN_FILL_PX}px)`;
}

/** 条的填充档（P0-10：按阶段四态分色；进行中与延期同走重点状态橙红） */
export function deBarFillTone(status: StageStatus): 'ink' | 'signal' | 'idle' {
  switch (status) {
    case StageStatus.Completed:
      return 'ink';
    case StageStatus.InProgress:
    case StageStatus.Delayed:
      return 'signal';
    default:
      return 'idle';
  }
}

/* ------------------------------------------------------------------ L3 改期记录 */

/** L3 改期记录最多登几条（§0.5：「取最近 N 条 + 行末「共 M 条」」；D 按一页余量取 6） */
export const DE_RESCHED_MAX_ROWS = 6;

/**
 * B4 的 L3 附属件「改期记录」的行（StageLog type=rescheduled，**最近的在前**）。
 * 数据源与 A 版一字不差（`vm.stageLogs`）——§0.5 明文「四套零数据代价」。
 */
export function deRescheduleRows(vm: PrintViewModel): readonly PrintStageLogVM[] {
  return vm.stageLogs
    .filter((l) => l.type === StageLogType.Rescheduled)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, DE_RESCHED_MAX_ROWS);
}
