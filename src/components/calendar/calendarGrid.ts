/**
 * 月历「日期网格」纯工具层（v0.7 画板 14/16/19 共用）。
 *
 * ── 为什么单独一个文件 ──
 * 画板 14（亮色月历）、画板 16/17（空状态幽灵网格）、画板 19（移动端）
 * 都要「一 / 二 / … / 日 + 6×7 日期格」这套骨架；空状态组件由 MonthlyCalendarView
 * 渲染，若把工具函数写在 MonthlyCalendarView 内部，两者会形成循环 import。
 * 故把纯函数与字面量收到这里：零 DOM 依赖、零 store 依赖，可被任意子组件引用。
 *
 * ⚠️ 本文件**不含业务计算**（业务在 calendarMath.ts）。这里只有「日历排版」：
 *   一周从周一算起、6×7 定长网格、日期字面量格式化。
 *   休息日判定**不在这里**——一律走 lib/workdays.isRestDay（公司休息制度：
 *   双休 / 单休 / 大小休），调用方各自传入结果，避免此文件成为第二个周末口径。
 */

import { dayjs } from '../../lib/date';
import type { CalendarMonthMeta } from './calendarMath';

/** 星期表头（周一为起点，与系统日历一致） */
export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** 网格行数：6 行 42 格，恒定行高节奏（月历不因月长跳高） */
export const GRID_ROWS = 6;

/** 每日格可点击元素的最小高度（画板 19 约束值 92，取 90 贴近；桌面画板 14 为 110） */
export const MOBILE_CELL_MIN_H = 90;
export const DESKTOP_CELL_MIN_H = 110;

/** 网格中一天 */
export interface GridDay {
  date: string; // 'YYYY-MM-DD'
  day: number; // 公历日 1~31
  inMonth: boolean; // 是否属于当月
  isToday: boolean;
  isSelected: boolean;
}

/** 本地时区 ISO（YYYY-MM-DD）——避免 new Date(iso).getDay() 的 UTC 解析错位 */
export function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 周一 = 0，周日 = 6 */
export function mondayFirst(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** 生成系统日历风格的 6×7 日期网格（含前后月填充） */
export function buildCalendarGrid(meta: CalendarMonthMeta, selectedDate: string): GridDay[] {
  const first = new Date(meta.year, meta.month - 1, 1);
  const startOffset = mondayFirst(first);
  const start = new Date(meta.year, meta.month - 1, 1 - startOffset);

  const days: GridDay[] = [];
  for (let i = 0; i < GRID_ROWS * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = localIso(d);
    days.push({
      date: iso,
      day: d.getDate(),
      inMonth: d.getMonth() + 1 === meta.month,
      isToday: iso === meta.todayIso,
      isSelected: iso === selectedDate,
    });
  }
  return days;
}

/**
 * 含 date 的那一周（周一~周日）的 7 个日期字面量。
 * 画板 18 方案 B「允许切周」的配套视图——周视图复用同一套日期格。
 */
export function weekOf(date: string): string[] {
  const d = dayjs(date);
  const offset = mondayFirst(d.toDate());
  const monday = d.add(-offset, 'day');
  return Array.from({ length: 7 }, (_, i) => monday.add(i, 'day').format('YYYY-MM-DD'));
}

/**
 * 把 7 个日期字面量包装成 GridDay（供周视图复用日期格组件）。
 * inMonth 恒为 true：周视图不表达「当月 / 非当月」，逐日都可读。
 */
export function gridDaysOf(dates: string[], selectedDate: string, todayIso: string): GridDay[] {
  return dates.map((date) => ({
    date,
    day: dayjs(date).date(),
    inMonth: true,
    isToday: date === todayIso,
    isSelected: date === selectedDate,
  }));
}

/** 格式化选中日期："8月28日，星期五"（画板 19 的日期详情行） */
export function formatSelectedDate(iso: string): string {
  const d = dayjs(iso);
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `${d.month() + 1}月${d.date()}日，${weekdays[d.day()]}`;
}

/**
 * 农历占位（画板 19 的副行）。
 * 不手写农历换算：错误率与维护成本都不可接受，且会随闰月出错；
 * 未来接入 lunar-javascript 时只替换本函数实现，调用点不动。
 */
export function lunarLabel(): string {
  return '农历（占位）';
}

/** "2026.08.10 – 08.23" 形态的周期文案（画板 16 空状态 E4 的「周期」段） */
export function formatPeriod(startIso: string, endIso: string): string {
  const s = dayjs(startIso);
  const e = dayjs(endIso);
  return `${s.format('YYYY.MM.DD')} – ${e.format('MM.DD')}`;
}
