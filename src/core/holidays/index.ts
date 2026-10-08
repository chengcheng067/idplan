/**
 * 中国法定节假日内置数据表 + 纯函数加载器。
 *
 * ── 为什么数据在库里而不在服务端 ──
 * 法定节假日是**全国客观事实**（国务院办公厅年度通知），不因公司/项目而异，
 * 也不该依赖任何网络请求：离线优先的桌面/NAS 形态下，放假安排必须开机即得。
 * 故按年各存一份 JSON（源数据 = 「区间 + 名称 + 补班日」），加载时展开成索引。
 *
 * ── 数据来源纪律（硬） ──
 * 每年的放假调休安排以**国务院办公厅《关于20XX年部分节假日安排的通知》**为唯一
 * 权威来源；本仓库已核对的年份在 JSON 内 `verified: true` 并附 `source` 出处。
 * 未发布通知的年份**不建文件**（如 2027——公告未出，不许凭记忆编）：加载器对
 * 缺失年份返回空集合，排期不猜、月历不显示（降级 = 只按周休制度）。
 *
 * ── 一份数据两用 ──
 * 展开结果同时服务两个消费面：
 *   · 判定（排期跳过节假日）：喂 `holidays` / `workdays` 两个 Set，
 *     经 `policy.ts` 的 `withCnHolidays` 合并进 RestPolicyConfig 的
 *     extraHolidays / extraWorkdays——**判定链仍只走 lib/workdays.ts**，
 *     本目录绝不自行实现「哪天上班」；
 *   · 显示（月历节日名小字）：喂 `nameOf` Map（date → 节日名）。
 */

import raw2025 from './cn-2025.json';
import raw2026 from './cn-2026.json';

/** 年度放假区间（源数据形态：连续区间 + 一个名称；区间天然含其中的周末天） */
export interface CnHolidaySpan {
  name: string;
  /** 'YYYY-MM-DD'（含） */
  start: string;
  /** 'YYYY-MM-DD'（含） */
  end: string;
}

/** 单年节假日表（JSON 文件形态） */
export interface CnHolidayYear {
  year: number;
  /** 是否已按官方通知逐日核对；非 true 一律按「缺失年份」降级（不参与合并/显示） */
  verified?: boolean;
  /** 数据来源（官方通知出处，供审计） */
  source?: string;
  /** 放假区间（合并节如 2025 国庆·中秋占一条） */
  holidays: CnHolidaySpan[];
  /** 调休补班日：周末但因调休上班的日期 */
  workdays: string[];
}

/** 展开后的节假日索引：判定喂两个 Set、显示喂 nameOf */
export interface CnHolidayIndex {
  /** 放假日期集合（含区间内的周末天——显示上它们同样是节日） */
  holidays: Set<string>;
  /** 调休补班日集合（周末但上班） */
  workdays: Set<string>;
  /** 日期 → 节日名（月历小字用） */
  nameOf: Map<string, string>;
}

/** ISO 日期字面量（内置表形状自检用；不现日期字面量的一律跳过，绝不抛错） */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 已内置的年份表（缺年不建文件 ⇒ 数组里就没有 ⇒ 天然降级） */
const YEARS: CnHolidayYear[] = [raw2025, raw2026];

/** 空索引（降级形态：调用方拿到即「本年无数据」） */
function emptyIndex(): CnHolidayIndex {
  return { holidays: new Set(), workdays: new Set(), nameOf: new Map() };
}

/** UTC 安全地取次日（ISO 字面量，避开本地时区与 DST） */
function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * 展开单年数据为索引。
 * `verified !== true`（未核实）或形状不符 ⇒ 空索引——内置表不该拦住首屏，
 * 也不许把没把握的日期喂给排期。
 */
function expandYear(year: CnHolidayYear): CnHolidayIndex {
  const idx = emptyIndex();
  if (!year || year.verified !== true) return idx;

  for (const span of year.holidays ?? []) {
    if (!span || typeof span.name !== 'string' || span.name === '') continue;
    if (!ISO_DATE.test(span.start) || !ISO_DATE.test(span.end)) continue;
    // ISO 字面量的字典序 = 时间序；end < start 的坏数据整条跳过
    let cursor = span.start;
    while (cursor <= span.end) {
      idx.holidays.add(cursor);
      // 同名优先保留先声明者（合并节重叠时以首条为准）
      if (!idx.nameOf.has(cursor)) idx.nameOf.set(cursor, span.name);
      cursor = nextDay(cursor);
    }
  }

  for (const d of year.workdays ?? []) {
    if (typeof d === 'string' && ISO_DATE.test(d)) idx.workdays.add(d);
  }
  return idx;
}

/**
 * 全部已核实年份的合并索引（加载器主入口，纯函数）。
 * 缺失年份（如 2027）天然不贡献任何日期 ⇒ 降级为「只按周休」。
 */
export function cnHolidayIndex(): CnHolidayIndex {
  const out = emptyIndex();
  for (const y of YEARS) {
    const idx = expandYear(y);
    idx.holidays.forEach((d) => out.holidays.add(d));
    idx.workdays.forEach((d) => out.workdays.add(d));
    idx.nameOf.forEach((name, d) => {
      if (!out.nameOf.has(d)) out.nameOf.set(d, name);
    });
  }
  return out;
}

/** 已核实（可用）的年份列表，升序——设置文案「数据覆盖年份」用 */
export function cnHolidayYears(): number[] {
  return YEARS.filter((y) => y.verified === true)
    .map((y) => y.year)
    .sort((a, b) => a - b);
}

/**
 * 月历小字标签（显示面唯一入口）：
 * 法定节假日 ⇒ 节日名；调休补班日 ⇒ '班'；都不是 ⇒ null。
 * 与判定面解耦——用户手填覆盖时判定可能变、标签仍报全国客观安排。
 */
export function holidayLabelOf(index: CnHolidayIndex, date: string): string | null {
  const name = index.nameOf.get(date);
  if (name !== undefined) return name;
  if (index.workdays.has(date)) return '班';
  return null;
}
