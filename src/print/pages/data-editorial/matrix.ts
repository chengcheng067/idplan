/**
 * D 版 · B2 打印时间轴 = **日期格矩阵**（2026-10-13 「5 块 × 4 模板」重构 · 批 B）。
 *
 * ── 为什么是「日期格」而不是甘特条 ──
 * 映射文档 §1.2 的 B2 格定的就是这件：D 的语言是「数据编辑网格」（硬边矩形、
 * 零圆角、无竖线、图形即正文），一根一根的条是 A/H 的语法；D 表达时间的方式是
 * **格子在不在轨**。故本块不接入 `PrintGantt`（那是 A/H 的横读件），
 * 而是用 D 自己的格阵语法从零造——这与 §1.2 的「版式侧中」代价一致。
 *
 * ── 三件语法纪律（§1.2 / 审美宪法 §2-D）──
 *   ① **零圆角**；② **无竖线**：格子之间靠 1px 间隙分列，不是画线；③ 列头是
 *      **英文小字帽 + letter-spacing .08em**（mono），如 `W01 W02 …`。
 *   ④ 分色只三档（§1.2 原文）：在轨 = 近黑 / 延期 = 信号橙 / 未开始 = 填充灰。
 *      注意这与 B4 的条（P0-10：进行中也走橙）**不同**——D 的橙在 §1.2 里是
 *      「只给异常」，B2 只让**延期**吃橙。两处差异各自成常量并写明出处。
 *
 * ── 列粒度（设计文档 §五留的空白，批 B 任务书用可测约束定边界）──
 * 约束：**列数必须落在 [DE_MATRIX_COL_MIN, DE_MATRIX_COL_MAX] = [4, 14]**。
 * 做法：按**窗口长度**从最细到最粗挑第一档列数 ≤14 的粒度（见 `deMatrixColumns`），
 * 于是「3 年窗口 = 36 个月」不会落进 36 列，而是自动降到**季度 = 12 列** ✓。
 * 与阶段数无关——列是时间的函数，不是阶段的函数（阶段数只决定**行数**）。
 */

import { StageStatus } from '../../../core/types/enums';
import type { PrintStageVM } from '../../model/print-view-model';

/** 列数下限（约束①）：少于 4 列不成矩阵（§1.2 的格阵需要横读） */
export const DE_MATRIX_COL_MIN = 4;
/** 列数上限（约束①）：多于 14 列格宽撑不住填充（实测：14 列时格宽 ≈43px） */
export const DE_MATRIX_COL_MAX = 14;

/** 列粒度（从细到粗；挑到第一个列数 ≤ 上限的档） */
export type DeColumnUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** 一列（`from`/`to` 是闭区间日期串 `YYYY-MM-DD`，已裁到窗口内） */
export interface DeMatrixColumn {
  key: string;
  /** 列头标签（英文小字帽：`05` / `W01` / `01` / `Q1` / `2026`） */
  label: string;
  from: string;
  to: string;
}

/** 列粒度的中文名（矩阵 caption 用） */
export const DE_COLUMN_UNIT_LABEL: Record<DeColumnUnit, string> = {
  day: '按天',
  week: '按周',
  month: '按月',
  quarter: '按季',
  year: '按年',
};

const UNITS: readonly DeColumnUnit[] = ['day', 'week', 'month', 'quarter', 'year'];

/** `YYYY-MM-DD` 加减天数（纯字符串进、纯字符串出，不引外部库的计算口径） */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO 串 → `YYYY-MM-DD` */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** 天数（含头尾） */
function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

/** 月序号（年 × 12 + 月，0 起）——季度/月份的档数都从它推 */
function monthIndex(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return y * 12 + (m - 1);
}

function monthStart(index: number): string {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
}

function monthEnd(index: number): string {
  return addDays(monthStart(index + 1), -1);
}

const minDate = (a: string, b: string): string => (a < b ? a : b);
const maxDate = (a: string, b: string): string => (a > b ? a : b);

/** 某个粒度铺满 `[from,to]` 的列序列（已裁到窗口内；`from`/`to` 用日期串） */
function buildColumns(from: string, to: string, unit: DeColumnUnit): DeMatrixColumn[] {
  const cols: DeMatrixColumn[] = [];
  if (unit === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      cols.push({ key: d, label: d.slice(8, 10), from: d, to: d });
    }
    return cols;
  }
  if (unit === 'week') {
    // 窗口相对的 7 天一周（W01 = 窗口首日起 7 天）：不引 ISO 周插件，序号自明，
    // 真实区间由矩阵 caption 给出（`时间列 9 格 · 按周 · 2026-01-05 → 2026-03-08`）
    for (let i = 0, s = from; s <= to; i += 1, s = addDays(s, 7)) {
      cols.push({
        key: s,
        label: `W${String(i + 1).padStart(2, '0')}`,
        from: s,
        to: minDate(addDays(s, 6), to),
      });
    }
    return cols;
  }
  if (unit === 'month' || unit === 'quarter') {
    const step = unit === 'quarter' ? 3 : 1;
    const startIdx = monthIndex(from);
    const endIdx = monthIndex(to);
    for (let i = startIdx; i <= endIdx; i += step) {
      cols.push({
        key: monthStart(i),
        label:
          unit === 'quarter' ? `Q${Math.floor((i % 12) / 3) + 1}` : String((i % 12) + 1).padStart(2, '0'),
        from: maxDate(monthStart(i), from),
        to: minDate(monthEnd(Math.min(i + step - 1, endIdx)), to),
      });
    }
    return cols;
  }
  // year
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y += 1) {
    const yStart = `${String(y).padStart(4, '0')}-01-01`;
    const yEnd = `${String(y).padStart(4, '0')}-12-31`;
    cols.push({ key: yStart, label: String(y), from: maxDate(yStart, from), to: minDate(yEnd, to) });
  }
  return cols;
}

/**
 * 选列粒度并铺列。
 *
 * 规则（可测）：
 *   从 `day` 起往粗挑，取**第一个列数 ≤ DE_MATRIX_COL_MAX(=14)** 的档；
 *   若最粗的 `year` 也 >14（窗口 > 14 年）⇒ 仍用 `year`（**已知边界**，见下）；
 *   若最细的 `day` < `DE_MATRIX_COL_MIN(=4)`（窗口不足 4 天）⇒ 把窗口右端外扩到
 *   4 天，凑满下限列（外扩的列没有阶段填充，矩阵仍是四格）。
 *
 * ⚠️ **已知边界（如实登记，不假装解决）**：窗口 > 14 年时列数会 >14，越出约束①
 * 的上限。产品里的项目排期不以十年计，且这条边界不影响任何一档实测夹具
 * （1/9/20/60 阶段都远在 14 年内）⇒ 不放大区间、不静默改语义。
 */
export function deMatrixColumns(viewStart: string, viewEnd: string): DeMatrixColumn[] {
  const from = dayOf(viewStart);
  let to = dayOf(viewEnd);
  if (!from || !to || to < from) return [];
  if (daysInclusive(from, to) < DE_MATRIX_COL_MIN) {
    to = addDays(from, DE_MATRIX_COL_MIN - 1);
  }
  for (const unit of UNITS) {
    const cols = buildColumns(from, to, unit);
    if (cols.length <= DE_MATRIX_COL_MAX) return cols;
  }
  return buildColumns(from, to, 'year');
}

/** 实际用到的粒度（caption 与测试用；与 `deMatrixColumns` 同源） */
export function deMatrixColumnUnit(viewStart: string, viewEnd: string): DeColumnUnit {
  const from = dayOf(viewStart);
  let to = dayOf(viewEnd);
  if (!from || !to || to < from) return 'month';
  if (daysInclusive(from, to) < DE_MATRIX_COL_MIN) to = addDays(from, DE_MATRIX_COL_MIN - 1);
  for (const unit of UNITS) {
    if (buildColumns(from, to, unit).length <= DE_MATRIX_COL_MAX) return unit;
  }
  return 'year';
}

/**
 * 阶段在某列里的填充档（§1.2 B2 原文三档）。
 *
 * ⚠️ 与 B4 的 `deBarFillTone` **有意不同**：B4 的条沿用 P0-10 的四态分色
 * （进行中与延期同走橙），B2 的格按 §1.2 的「橙只给异常」只让**延期**吃橙，
 * 进行中/已完成都是近黑。两处差异都在注释里给出处，不合并成一份。
 */
export function deMatrixCellTone(status: StageStatus): 'ink' | 'signal' | 'idle' {
  switch (status) {
    case StageStatus.Delayed:
      return 'signal';
    case StageStatus.NotStarted:
      return 'idle';
    default:
      return 'ink';
  }
}

/** 阶段是否落在该列（闭区间相交；日期串比较，`YYYY-MM-DD` 字典序即时间序） */
export function deMatrixCellOn(
  stage: Pick<PrintStageVM, 'startAt' | 'endAt'>,
  col: DeMatrixColumn,
): boolean {
  const s = dayOf(stage.startAt);
  const e = dayOf(stage.endAt);
  if (!s || !e) return false;
  return s <= col.to && e >= col.from;
}

/**
 * 矩阵的窗口（列序列的输入）：与 A 的甘特**同一口径**（计划窗口 ∪ 阶段起止，
 * 空串脏行先滤掉）——四套的 B2 必须用同一把尺子，否则同一个项目在两套模板上
 * 画出的时间范围不一样（§0.3 公共派生层的纪律）。
 */
export function deMatrixWindow(
  project: Pick<{ plannedStartAt: string; plannedEndAt: string }, 'plannedStartAt' | 'plannedEndAt'>,
  stages: readonly Pick<PrintStageVM, 'startAt' | 'endAt'>[],
): { viewStart: string; viewEnd: string } {
  const plannedStart = dayOf(project.plannedStartAt);
  const plannedEnd = dayOf(project.plannedEndAt);
  const starts = stages.map((s) => dayOf(s.startAt)).filter((d) => d !== '');
  const ends = stages.map((s) => dayOf(s.endAt)).filter((d) => d !== '');
  const viewStart = starts.length ? [plannedStart, ...starts].reduce(minDate) : plannedStart;
  const viewEnd = ends.length ? [plannedEnd, ...ends].reduce(maxDate) : plannedEnd;
  return { viewStart, viewEnd };
}
