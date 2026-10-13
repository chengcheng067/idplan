/**
 * lib/date 时间口径补充测试（QA 补充轮次）：
 *   铁律 2：剩余天数=自然日差，当日=0、昨日=-1（首页逾期显红）、明天=1；
 *   跨年区间、UTC 天偏移安全、时间轴 x 坐标正逆映射一致性。
 *
 * remainingDays 的 todayIso 参数显式注入，测试不依赖真实时钟（幂等可重放）。
 */

import { describe, it, expect } from 'vitest';

import {
  isIsoDate,
  toIsoDate,
  remainingDays,
  totalDaysInclusive,
  rangeDays,
  xOf,
  dateAtX,
  panRange,
  buildMonthTicks,
} from '../src/lib/date';
/* `labelOf` 是必填参数（回归修复：`src/lib/date.ts` 不许 import i18n，理由见该文件
 * 「月刻度生成」区块）。本 spec 断言的是**几何**（start / daysSpan），标签取值不参与
 * 断言 ⇒ 传**纸面出口**，与真实纸面调用点同形，避免用假 stub 掩盖调用形状。 */
import { formatMonthYear } from '../src/i18n';

describe('date.remainingDays：边界口径（当日=0）', () => {
  it('target 与 today 同日 → 0', () => {
    expect(remainingDays('2026-09-15', '2026-09-15')).toBe(0);
  });

  it('昨日 → -1（逾期），明天 → +1', () => {
    expect(remainingDays('2026-09-14', '2026-09-15')).toBe(-1);
    expect(remainingDays('2026-09-16', '2026-09-15')).toBe(1);
  });

  it('target 带 UTC datetime 后缀时按日期归一，不被时刻影响', () => {
    expect(remainingDays('2026-09-20T16:00:00.000Z', '2026-09-15')).toBe(5);
    expect(remainingDays('2026-09-20T00:00:00.000Z', '2026-09-15')).toBe(5);
  });

  it('跨年：12月底到次年1月初', () => {
    expect(remainingDays('2027-01-03', '2026-12-28')).toBe(6);
    expect(remainingDays('2026-12-31', '2027-01-01')).toBe(-1);
  });

  it('跨闰月二月（2028 为闰年）', () => {
    expect(remainingDays('2028-03-01', '2028-02-25')).toBe(5);
  });
});

describe('date 总天数与视窗', () => {
  it('totalDaysInclusive 含头尾：同日=1 天', () => {
    expect(totalDaysInclusive('2026-08-01', '2026-08-01')).toBe(1);
    expect(totalDaysInclusive('2026-08-01', '2026-08-31')).toBe(31);
  });

  it('跨月/跨年含头尾', () => {
    expect(totalDaysInclusive('2026-11-28', '2027-01-05')).toBe(39);
  });

  it('rangeDays 与 totalDaysInclusive 一致', () => {
    expect(rangeDays({ from: '2026-07-01', to: '2026-11-30' })).toBe(
      totalDaysInclusive('2026-07-01', '2026-11-30'),
    );
  });
});

describe('date.isIsoDate / toIsoDate：形状守门', () => {
  it.each([
    ['2026-09-01', true],
    ['20260901', false],
    ['2026-9-1', false],
    ['2026-13-40', false],
  ])('isIsoDate(%s) === %s', (v, want) => {
    expect(isIsoDate(v)).toBe(want);
  });

  it('toIsoDate 归一 ISO datetime 与非法值返回 null', () => {
    expect(toIsoDate('2026-09-01T08:30:00.000Z')).toBe('2026-09-01');
    expect(toIsoDate('nope')).toBeNull();
  });
});

describe('time-axis 坐标系：xOf / dateAtX 正逆映射', () => {
  const range = { from: '2026-07-01', to: '2026-11-30' };
  const pxPerDay = 8;

  it('起点日 x=0；每延一天 +pxPerDay', () => {
    expect(xOf('2026-07-01', range, pxPerDay)).toBe(0);
    expect(xOf('2026-07-02', range, pxPerDay)).toBe(pxPerDay);
    expect(xOf('2026-07-01T10:00:00.000Z', range, pxPerDay)).toBe(0);
  });

  it('dateAtX(xOf(d)) 往返恒等于 d（逐日抽样）', () => {
    for (let i = 0; i <= 152; i += 7) {
      const d = panRange({ from: '2026-07-01', to: '2026-07-01' }, i).from;
      const x = xOf(d, range, pxPerDay);
      expect(dateAtX(x, range, pxPerDay)).toBe(d);
    }
  });

  it('panRange 平移天数后首尾同步移动且跨度不变', () => {
    const panned = panRange(range, 17);
    expect(panned.from).toBe('2026-07-18');
    expect(rangeDays(panned)).toBe(rangeDays(range));
  });
});

describe('buildMonthTicks：月刻度生成', () => {
  it('覆盖完整月份时每月一档、首尾裁剪正确', () => {
    const ticks = buildMonthTicks('2026-07-15', '2026-09-05', formatMonthYear);
    expect(ticks.map((t) => t.start)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    // 7 月：从 15 日到 31 日
    expect(ticks[0]!.daysSpan).toBe(17);
    // 8 月整月
    expect(ticks[1]!.daysSpan).toBe(31);
    // 9 月：只到 5 日
    expect(ticks[2]!.daysSpan).toBe(5);
  });

  it('刻度 daysSpan 合计 == 区间总天数（无缝覆盖）', () => {
    const ticks = buildMonthTicks('2026-11-20', '2027-02-10', formatMonthYear);
    const sum = ticks.reduce((a, t) => a + t.daysSpan, 0);
    expect(sum).toBe(totalDaysInclusive('2026-11-20', '2027-02-10'));
  });
});
