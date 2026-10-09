/**
 * 工作日历核心算法（公司休息制度）。
 *
 * 全系统「哪天上班」的唯一判定入口（铁律：排期/切分/改期一律经由本文件消费，
 * 禁止在调用方二次实现周末判定）。
 *
 * 三种制度：
 *   DoubleOff    双休   doubleRestWeekdays 两个休息日（缺省=[5,6] 周六+周日，可自选）
 *   SingleOff    单休   仅 singleRestWeekday 那天休息（缺省=周日，可自选周几）
 *   BigSmallWeek 大小休 周日固定休息，周六按 ISO 周交替（大休周休息 / 小休周上班）
 *
 * 大小休的交替由 anchorWeek（'YYYY-Www'，如 '2026-W35'）锚定：锚点周为大休周，
 * 之后逐周交替。用 ISO 周而非自然日差 /7，是为了保证：
 *   1) 同一周的周一~周日得到同一个偏移（/7 直除会让同周不同天得到不同结果）；
 *   2) 跨年不断档（2025-W52 → 2026-W01 连续）。
 *
 * 法定节假日：extraHolidays / extraWorkdays 为预留扩展点，MVP 不接数据，
 * 但判定优先级已就位——extraWorkdays（调休上班）最高，extraHolidays（放假）次之，
 * 制度本身的周末判定最低。后续接入法定节假日表时只需填充这两个数组。
 *
 * 日期口径：'YYYY-MM-DD' 字符串，与 src/lib/date.ts 一致。
 */

import isoWeek from 'dayjs/plugin/isoWeek';

import { RestPolicyKind } from '../core/types/enums';
import type { RestPolicyConfig } from '../core/types/entities';
import { dayjs } from './date';

dayjs.extend(isoWeek);

/** 吸附扫描上限：极端配置（如 extraHolidays 覆盖全年）下的死循环护栏 */
const MAX_SNAP_SCAN_DAYS = 3650;

/** ISO 周锚点格式：'YYYY-Www' */
const ISO_WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;

/**
 * 该 ISO 年是否为 53 周年。
 * 判定式：p(y)=4 或 p(y-1)=3，其中 p(y) 为 1 月 1 日的星期序号（0=周日）。
 */
function isoWeeksInYear(year: number): number {
  const p = (y: number): number =>
    (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400)) % 7;
  return p(year) === 4 || p(year - 1) === 3 ? 53 : 52;
}

/** 线性周序号的原点年份（仅作换算基准，无业务含义） */
const SERIAL_ORIGIN_YEAR = 2000;

/**
 * (ISO 年, ISO 周) → 单调递增的线性周序号。
 * 保证：相邻 ISO 周相差恰好 1（跨年也连续），同周内任意一天得到同一序号。
 * 以 SERIAL_ORIGIN_YEAR 为原点逐年累加，避免浮点除法与 52/53 周跳变。
 */
function isoWeekSerial(year: number, week: number): number {
  let serial = week - 1;
  let cursor = SERIAL_ORIGIN_YEAR;
  const step = year >= SERIAL_ORIGIN_YEAR ? 1 : -1;
  while (cursor !== year) {
    serial += step * isoWeeksInYear(step > 0 ? cursor : cursor - 1);
    cursor += step;
  }
  return serial;
}

/** 解析 'YYYY-Www' 锚点；非法或超出该年周数时返回 null */
function parseIsoWeek(anchorWeek: string | null): { year: number; week: number } | null {
  if (!anchorWeek) return null;
  const m = ISO_WEEK_PATTERN.exec(anchorWeek.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > isoWeeksInYear(year)) return null;
  return { year, week };
}

/**
 * date 相对 anchorWeek 的 ISO 周序号偏移（整数，可为负）。
 * 同一 ISO 周内的周一~周日返回同一个值。
 * anchorWeek 非法时返回 0（视作落在锚点周本身）。
 */
export function isoWeekOffset(date: string, anchorWeek: string): number {
  const anchor = parseIsoWeek(anchorWeek);
  if (!anchor) return 0;
  const d = dayjs(date);
  return isoWeekSerial(d.isoWeekYear(), d.isoWeek()) - isoWeekSerial(anchor.year, anchor.week);
}

/** 大小休下该周六是否休息（大休周）。锚点缺失/非法时回落 false（按上班处理）。 */
function isBigRestWeek(date: string, anchorWeek: string | null): boolean {
  if (!parseIsoWeek(anchorWeek)) return false;
  return isoWeekOffset(date, anchorWeek as string) % 2 === 0;
}

/**
 * 单休的自定义休息周几（RestPolicyConfig.singleRestWeekday，0=周一…6=周日，
 * 缺省/非法 = 6=周日）→ dayjs day() 口径（0=周日…6=周六）。
 *
 * 字段口径与仓库周一始终口径一致（CalendarPrintPage.tsx WEEKDAYS 一~日）；
 * dayjs 的 day() 是 0=周日 开头，故这里做一次换算。旧数据缺省 = 周日
 * ⇒ 与改造前「单休=周日休」逐字节一致，无迁移脚本。
 */
function singleRestDayjsDow(singleRestWeekday: number | undefined): number {
  const v = singleRestWeekday ?? 6;
  if (!Number.isInteger(v) || v < 0 || v > 6) return 0; // 非法值回落周日
  return v === 6 ? 0 : v + 1;
}

/**
 * 双休的自定义休息日（RestPolicyConfig.doubleRestWeekdays，0=周一…6=周日；
 * 缺省/非法 = [5,6] 周六+周日）→ dayjs day() 口径集合（0=周日…6=周六）。
 *
 * 换算同 singleRestDayjsDow（字段是周一始终口径，dayjs 的 day() 是周日开头）。
 * 缺省 = [5,6] ⇒ 与改造前「双休=周六+周日休」逐字节一致，无迁移脚本。
 * 容忍编辑器「取消到剩 1 天」的编辑瞬态（length===1 ⇒ 单元素集合）；
 * 存盘形状由 normalize 边界保证恒为两整数升序。
 */
function doubleRestDayjsDows(doubleRestWeekdays: number[] | undefined): Set<number> {
  const out = new Set<number>();
  for (const v of doubleRestWeekdays ?? [5, 6]) {
    if (!Number.isInteger(v) || v < 0 || v > 6) continue;
    out.add(v === 6 ? 0 : v + 1);
  }
  // 全非法（理论上 normalize 边界已拦，这里双保险）⇒ 回落周六+周日
  if (out.size === 0) {
    out.add(5);
    out.add(0);
  }
  return out;
}

/**
 * 该日是否休息。
 * 优先级：extraWorkdays 命中 → 上班（最高，短路）；extraHolidays 命中 → 休息；
 * 否则按 kind 判定周末。单休读 singleRestWeekday（缺省=周日）；双休读
 * doubleRestWeekdays 集合（缺省=[5,6] 周六+周日）；大小休的周日固定 +
 * 周六锚点逻辑不变。
 */
export function isRestDay(date: string, policy: RestPolicyConfig): boolean {
  if (policy.extraWorkdays?.includes(date)) return false;
  if (policy.extraHolidays?.includes(date)) return true;

  const dow = dayjs(date).day(); // 0=周日 … 6=周六
  if (policy.kind === RestPolicyKind.SingleOff) {
    // 单休：仅自定义休息日那天休息（缺省=周日，保持历史行为）
    return dow === singleRestDayjsDow(policy.singleRestWeekday);
  }
  if (policy.kind === RestPolicyKind.DoubleOff) {
    // 双休：两个自定义休息日（缺省=周六+周日，与改造前逐字节一致）
    return doubleRestDayjsDows(policy.doubleRestWeekdays).has(dow);
  }

  // 大小休：周日固定休息，周六按 ISO 周交替（大休周休息 / 小休周上班）
  if (dow === 0) return true;
  if (dow !== 6) return false;
  return isBigRestWeek(date, policy.anchorWeek);
}

/** 该日是否上班 */
export function isWorkday(date: string, policy: RestPolicyConfig): boolean {
  return !isRestDay(date, policy);
}

/**
 * 把 date 吸附到最近的工作日：本身是工作日则原样返回，
 * 否则沿 dir（forward=向后、backward=向前）逐日找第一个工作日。
 */
export function snapToWorkday(
  date: string,
  policy: RestPolicyConfig,
  dir: 'forward' | 'backward' = 'forward',
): string {
  const step = dir === 'backward' ? -1 : 1;
  let cursor = dayjs(date);
  for (let scanned = 0; scanned < MAX_SNAP_SCAN_DAYS; scanned += 1) {
    if (isWorkday(cursor.format('YYYY-MM-DD'), policy)) break;
    cursor = cursor.add(step, 'day');
  }
  return cursor.format('YYYY-MM-DD');
}

/**
 * 从 date 起加 n 个工作日。
 * n=0 时返回 snapToWorkday 后的当日（起始日落在休息日则向后吸附）。
 */
export function addWorkdays(date: string, n: number, policy: RestPolicyConfig): string {
  let cursor = dayjs(snapToWorkday(date, policy, 'forward'));
  let remaining = Math.trunc(n);
  while (remaining > 0) {
    cursor = cursor.add(1, 'day');
    if (isWorkday(cursor.format('YYYY-MM-DD'), policy)) remaining -= 1;
  }
  return cursor.format('YYYY-MM-DD');
}

/**
 * 有符号加工作日（T5：拖拽改期按工作日顺延）。
 * n>=0 与 addWorkdays 完全一致（起点向后吸附）；n<0 反向减工作日（起点向前吸附）。
 * 修复 addWorkdays 只处理正数、缩短手势静默失效的问题。
 */
export function addWorkdaysSigned(date: string, n: number, policy: RestPolicyConfig): string {
  const steps = Math.trunc(n);
  if (steps >= 0) return addWorkdays(date, steps, policy);
  let cursor = dayjs(snapToWorkday(date, policy, 'backward'));
  let remaining = -steps;
  while (remaining > 0) {
    cursor = cursor.add(-1, 'day');
    if (isWorkday(cursor.format('YYYY-MM-DD'), policy)) remaining -= 1;
  }
  return cursor.format('YYYY-MM-DD');
}

/**
 * 方向感知吸附位移（T5）：先按自然日位移，再把结果吸附到工作日。
 * 吸附方向 = 拖拽方向（delta>=0 向后、delta<0 向前），保证前拖缩短不会回卷到原日。
 */
export function snapShiftDate(date: string, deltaDays: number, policy: RestPolicyConfig): string {
  const shifted = dayjs(date).add(Math.trunc(deltaDays), 'day').format('YYYY-MM-DD');
  const dir = deltaDays >= 0 ? 'forward' : 'backward';
  return snapToWorkday(shifted, policy, dir);
}

/** 两日期间的工作日天数（含头尾；end<start 时返回负数，口径同 countBusinessDays） */
export function countWorkdays(
  start: string,
  end: string,
  policy: RestPolicyConfig,
): number {
  let a = dayjs(start);
  let b = dayjs(end);
  const sign = b.isBefore(a) ? -1 : 1;
  if (sign < 0) {
    const tmp = a;
    a = b;
    b = tmp;
  }
  let count = 0;
  let cursor = a;
  while (!cursor.isAfter(b)) {
    if (isWorkday(cursor.format('YYYY-MM-DD'), policy)) count += 1;
    cursor = cursor.add(1, 'day');
  }
  return sign * count;
}

/** 区间内所有工作日的 ISO 日期数组（升序）；end<start 为空数组 */
export function listWorkdays(
  start: string,
  end: string,
  policy: RestPolicyConfig,
): string[] {
  const out: string[] = [];
  const a = dayjs(start);
  const b = dayjs(end);
  if (b.isBefore(a)) return out;
  let cursor = a;
  while (!cursor.isAfter(b)) {
    const iso = cursor.format('YYYY-MM-DD');
    if (isWorkday(iso, policy)) out.push(iso);
    cursor = cursor.add(1, 'day');
  }
  return out;
}
