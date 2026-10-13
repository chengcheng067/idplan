/**
 * 日期语言出口（⑤e）· 判别力夹具 + 结构性锁。
 *
 * 本文件守两件不同的事，别混：
 *   ① **取值锁**：日期格式化的中文/英文**取值**逐字固定（改了立刻红，
 *      因为日历刻度与打印纸面都靠它对齐视觉节奏）；
 *   ② **结构锁**：纸面出口与屏幕出口是**两个函数**（arity 不同），
 *      且**纸面调用点不许碰 Localized 那一支** —— 这条是产品规则
 *      「打印稿语言不随界面语言变」，不是风格偏好（完整理由见 `src/i18n/date.ts`）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  formatMonthPart,
  formatMonthPartLocalized,
  formatMonthYear,
  formatMonthYearLocalized,
  formatSelectedDateLocalized,
} from '../src/i18n';

const read = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('⑤e 日期出口 · 取值锁（zh 逐字 + en 稳定）', () => {
  it('月刻度：zh「2026年9月」/ en「Sep 2026」', () => {
    expect(formatMonthYear('2026-09-01')).toBe('2026年9月');
    expect(formatMonthYearLocalized('2026-09-01', 'zh')).toBe('2026年9月');
    expect(formatMonthYearLocalized('2026-09-01', 'en')).toBe('Sep 2026');
  });

  it('半月刻度：zh「9月·上 / 9月·下」/ en「Sep · 1st half / Sep · 2nd half」', () => {
    expect(formatMonthPart('2026-09-01', 'first')).toBe('9月·上');
    expect(formatMonthPart('2026-09-01', 'second')).toBe('9月·下');
    expect(formatMonthPartLocalized('2026-09-01', 'first', 'en')).toBe('Sep · 1st half');
    expect(formatMonthPartLocalized('2026-09-01', 'second', 'en')).toBe('Sep · 2nd half');
  });

  it('选中日期行：zh「8月28日，星期五」/ en「Aug 28, Friday」', () => {
    expect(formatSelectedDateLocalized('2026-08-28', 'zh')).toBe('8月28日，星期五');
    expect(formatSelectedDateLocalized('2026-08-28', 'en')).toBe('Aug 28, Friday');
  });
});

describe('⑤e 日期出口 · 结构锁（两条出口不是一回事）', () => {
  it('arity 不同：纸面出口 1 参（拿不到 lang），屏幕出口 2 参（必须给 lang）', () => {
    expect(formatMonthYear.length, '纸面月刻度 ≤1 参：它不该有语言入口').toBe(1);
    expect(formatMonthPart.length, '纸面半月刻度 2 参：日期 + 上半/下半').toBe(2);
    expect(formatMonthYearLocalized.length, '屏幕月刻度必须显式接 lang').toBe(2);
    expect(formatMonthPartLocalized.length).toBe(3);
    expect(formatSelectedDateLocalized.length).toBe(2);
  });

  it('★ 纸面调用点不碰 Localized 那一支（零豁免）', () => {
    const paper = ['src/components/print/useSchedulePaperData.ts', 'src/print/model/print-gantt.ts'];
    for (const f of paper) {
      const src = read(f);
      expect(src, `${f} 用了屏幕出口 —— 打印稿会跟着界面语言变`).not.toContain('Localized');
      expect(src, `${f} 根本没调 buildMonthTicks？那这条锁是空的`).toContain('buildMonthTicks(');
    }
  });

  it('★ 屏幕调用点必须用 Localized（否则刻度不随语言，⑤e 等于没做）', () => {
    const screen = 'src/components/timeline/TimelineView.tsx';
    const src = read(screen);
    /*
     * ⚠️ 第一版这条锁是**空的**，靠变异自证当场抓出来的：
     *   我原先只断言「源码里出现 `formatMonthYearLocalized` 这个字面量」——
     *   而 **import 行本身**就含它 ⇒ 把调用点的第三个实参删掉（= ⑤e 白做），
     *   断言照样绿（实测：变异 M2 之后 6 passed）。
     *   ⇒ 改成判**调用形状**：`buildMonthTicks(` 之后 160 字内必须出现那个函数名，
     *     即「同一次调用里真的把它当实参传进去了」。
     */
    expect(src, '月刻度调用点应传本地化格式化器').toMatch(
      /buildMonthTicks\([\s\S]{0,160}?formatMonthYearLocalized/,
    );
    expect(src, '半月刻度调用点应传本地化格式化器').toMatch(
      /buildHalfMonthTicks\([\s\S]{0,160}?formatMonthPartLocalized/,
    );
  });
});
