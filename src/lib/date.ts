import dayjs from 'dayjs';

import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * dayjs 封装：时间口径统一出口（铁律 2）。
 * 库里永远是 UTC ISO string / YYYY-MM-DD；展示层才转本地。
 */

export { dayjs };

/**
 * ISO date 'YYYY-MM-DD' 形状 + 语义校验（含闰年 2 月）。
 * 注意：dayjs 严格模式对 '2026-13-40' 会回卷成合法日期，因此这里用
 * UTC 回读法做硬校验——构造 Date.UTC 后回读各字段必须完全一致才算合法。
 */
export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * 规范化为 ISO date（入参支持 datetime ISO / date）；非法返回 null。
 * 铁律 2 口径：库里永远是 UTC ISO string——带 'Z'/时区偏移后缀的输入按 UTC
 * 解析并 format('YYYY-MM-DD')，避免 GMT+8 等本地时区把 UTC 时刻滚到次日；
 * 纯日期 'YYYY-MM-DD' 输入保持原行为（本地零时，无时刻可漂移）。
 */
export function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const d = dayjs.utc(trimmed);
    if (!d.isValid()) return null;
    return d.format('YYYY-MM-DD');
  }
  const d = dayjs(trimmed);
  if (!d.isValid()) return null;
  return d.format('YYYY-MM-DD');
}

/** 规范化为 UTC ISO datetime string */
export function toIsoDateTime(value: string): string {
  const d = dayjs(value);
  return d.toISOString();
}

/** 剩余自然日：target - today。当日=0，昨日=-1（逾期显红），明天=1。 */
export function remainingDays(target: string, todayIso?: string): number {
  const t = dayjs(todayIso ?? dayjs().format('YYYY-MM-DD'));
  const targetDay = dayjs(toIsoDate(target) ?? target);
  return targetDay.diff(t.startOf('day'), 'day');
}

/** 总天数（含头尾） */
export function totalDaysInclusive(startAt: string, endAt: string): number {
  return dayjs(endAt).diff(dayjs(startAt), 'day') + 1;
}

/* ------------------------------ 时间轴坐标系 ------------------------------ */

/** 时间轴可视范围配置（pxPerDay 随 zoom 档位变化，由 TimelineView 注入） */
export interface TimelineRange {
  /** 可视窗口起始日（含） */
  from: string;
  /** 可视窗口结束日（含） */
  to: string;
}

/** 区间总天数（含头尾） */
export function rangeDays(range: TimelineRange): number {
  return totalDaysInclusive(range.from, range.to);
}

/** x(date) 核心坐标公式：按天线性映射（TimelineView 必须复用本函数，禁止二次实现） */
export function xOf(date: string, range: TimelineRange, pxPerDay: number): number {
  const d = dayjs(toIsoDate(date) ?? date);
  const offset = d.diff(dayjs(range.from), 'day');
  return offset * pxPerDay;
}

/** 逆映射：px → 该位置的日期（拖拽手势换日用） */
export function dateAtX(x: number, range: TimelineRange, pxPerDay: number): string {
  const days = Math.round(x / pxPerDay);
  return dayjs(range.from).add(days, 'day').format('YYYY-MM-DD');
}

/** 平移 N 天生成新 range（clamp 到 [today-90, today+730] 合理视窗内不强制） */
export function panRange(range: TimelineRange, deltaDays: number): TimelineRange {
  return {
    from: dayjs(range.from).add(deltaDays, 'day').format('YYYY-MM-DD'),
    to: dayjs(range.to).add(deltaDays, 'day').format('YYYY-MM-DD'),
  };
}

/* ------------------------------- 月刻度生成 ------------------------------- *
 *
 * ★ 2026-08-27（⑤e）：标签不再写死中文，而是**注入一个标签格式化器**。
 *   为什么是注入而不是在这里判断语言：本函数被**屏幕**（TimelineView）与
 *   **纸面**（useSchedulePaperData / print-gantt）共用，而这两者对语言的要求**相反**
 *   —— 屏幕要跟随界面语言、纸面必须恒中文（完整理由见 `src/i18n/date.ts` 文件头）。
 *
 * ★★ 2026-08-27（同日 · 回归修复）：`labelOf` 由「有缺省值」改为**必填**。★★
 *   ⑤e 的那一版给 `labelOf` 缺省值 `formatMonthYear`（纸面出口），代价是**本文件
 *   必须 `import … from '../i18n'`**。而本文件在 `server/tsconfig.json` 的 include
 *   白名单里（共享内核：前后端同一份源码），该配置 `lib: ["ES2020"]`（**无 DOM**），
 *   文件头的原话是「将来有人在 progress.ts 里加一句 `document.*`，本配置会当场报错」。
 *   ⇒ i18n 链里的 `src/i18n/lang.ts` 引用 `document.documentElement`，被拉进服务端
 *     程序即报错。**实测（修复前，原样输出）**：
 *       $ npx tsc --noEmit -p server/tsconfig.json      # 退出码 2，共 2 条
 *       src/i18n/lang.ts(79,3): error TS2584: Cannot find name 'document'. …
 *       src/i18n/lang.ts(80,3): error TS2584: Cannot find name 'document'. …
 *   ⇒ 那个缺省值不是「纸面调用点零改动」的便利，而是**共享内核里一个静默的中文兜底**
 *     ——「默认值让错的那一支看起来是对的」，与本批查出的其余缺陷同族。
 *
 *   修法取**结构性**的那条（与 ⑤e 两条出口同源）：**副数（arity）即声明**——
 *     纸面调用点必须自己传 `formatMonthYear`，屏幕调用点必须自己传 `*Localized`；
 *     本文件零 i18n import，服务端程序恢复纯净。
 *   守卫：`tests/i18n-date-exits.spec.ts`（本文件不许 import i18n；纸面调用点必须
 *         在**同一次调用**里传纸面出口）＋ `npm run typecheck:server` 本身。
 */

export interface MonthTick {
  /** 月首日 'YYYY-MM-01'（与 HalfMonthTick.start 命名对齐，供 ScaleTick 直接消费） */
  start: string;
  label: string; // 展示文本如「2026年9月」
  daysSpan: number;
}

/**
 * 生成覆盖 [from,to] 的月份刻度（供 MonthScaleHeader 使用）。
 * `labelOf` **必填**（回归修复，理由见上方区块）：纸面传 `formatMonthYear`，
 * 屏幕传 `(iso) => formatMonthYearLocalized(iso, lang)`。
 */
export function buildMonthTicks(
  from: string,
  to: string,
  labelOf: (monthStartIso: string) => string,
): MonthTick[] {
  const ticks: MonthTick[] = [];
  const fromD = dayjs(from);
  const end = dayjs(to);
  let cursor = fromD.startOf('month');
  let first = true;
  while (!cursor.isAfter(end)) {
    const nextMonth = cursor.add(1, 'month');
    const spanEnd = nextMonth.isAfter(end) ? end : nextMonth.subtract(1, 'day');
    // 首段裁剪：from 落在月中时从 from 起算，不做整月（tick.start 仍输出月首锚点）
    const spanStart = first && fromD.isAfter(cursor) ? fromD : cursor;
    ticks.push({
      start: cursor.format('YYYY-MM-01'),
      label: labelOf(cursor.format('YYYY-MM-01')),
      daysSpan: spanEnd.diff(spanStart, 'day') + 1,
    });
    first = false;
    cursor = nextMonth;
  }
  return ticks;
}

export interface HalfMonthTick {
  start: string;
  label: string;
  daysSpan: number;
}

/**
 * 双周粒度刻度（zoom='half-month' 时使用：每月上半/下半两档）。
 * `labelOf` **必填**（回归修复，理由见上方区块）：目前只有屏幕消费
 * （`TimelineView` 的半月档），故调用点只有一处。
 */
export function buildHalfMonthTicks(
  from: string,
  to: string,
  labelOf: (monthStartIso: string, part: 'first' | 'second') => string,
): HalfMonthTick[] {
  const ticks: HalfMonthTick[] = [];
  let cursor = dayjs(from).startOf('month');
  const end = dayjs(to);
  while (!cursor.isAfter(end)) {
    const mid = cursor.date(16);
    const monthEnd = cursor.endOf('month');
    if (mid.isBefore(end)) {
      const segEnd = monthEnd.isAfter(end) ? end : monthEnd;
      const half2End = segEnd.isAfter(monthEnd) ? monthEnd : segEnd;
      void half2End;
      // 上半月
      const upperEnd = mid.subtract(1, 'day');
      if (!upperEnd.isBefore(cursor)) {
        ticks.push({
          start: cursor.format('YYYY-MM-01'),
          label: labelOf(cursor.format('YYYY-MM-01'), 'first'),
          daysSpan: upperEnd.diff(cursor, 'day') + 1,
        });
      }
      // 下半月
      const lowerStart = mid.isBefore(from) ? dayjs(from) : mid;
      const lowerEnd = monthEnd.isAfter(end) ? end : monthEnd;
      if (!lowerEnd.isBefore(lowerStart)) {
        ticks.push({
          start: lowerStart.format('YYYY-MM-DD'),
          label: labelOf(cursor.format('YYYY-MM-01'), 'second'),
          daysSpan: lowerEnd.diff(lowerStart, 'day') + 1,
        });
      }
    } else {
      const last = monthEnd.isAfter(end) ? end : monthEnd;
      ticks.push({
        start: cursor.format('YYYY-MM-01'),
        label: labelOf(cursor.format('YYYY-MM-01'), 'first'),
        daysSpan: last.diff(cursor, 'day') + 1,
      });
    }
    cursor = cursor.add(1, 'month');
  }
  return ticks;
}
