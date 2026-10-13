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

import { maskComments } from './helpers/cjk-locator-guard';

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

/**
 * ⑤e 日期出口 · **共享内核纯净锁**（2026-08-27 同日回归自证）。
 *
 * ── 这两条锁守的是一个我已犯过的错，不是一个假想 ──
 * ⑤e 首版（`3433df8`）给 `buildMonthTicks` / `buildHalfMonthTicks` 的 `labelOf`
 * 一个**缺省值** = 纸面出口，代价是 `src/lib/date.ts` 里加了一行
 * `import … from '../i18n'`。而 `src/lib/date.ts` 在 `server/tsconfig.json` 的
 * include 白名单（共享内核）里，那份配置 `lib: ["ES2020"]`（**无 DOM**），
 * 于是 i18n 链上的 `src/i18n/lang.ts` 被拖进服务端程序 ⇒ **`npm run typecheck:server`
 * 连红两条**。实测（修复前原样输出）：
 *     $ npx tsc --noEmit -p server/tsconfig.json        # exit=2
 *     src/i18n/lang.ts(79,3): error TS2584: Cannot find name 'document'. …
 *     src/i18n/lang.ts(80,3): error TS2584: Cannot find name 'document'. …
 * 修复后同一命令 **exit=0，0 条**。
 *
 * ── 为什么当场被测到却当场被放过 ──
 * 我当时只跑了 `tsc -p tsconfig.json`（前端那支）。门禁是 `typecheck:all` 的**三条**
 * 命令，少跑一条就等于少一道门 ⇒ 这两条锁把「少跑的那条门」变成了**提交期就能看见的红**。
 *
 * ── 判据形状的两个讲究 ──
 *   ① 用 `maskComments` 剥注释后再匹配 —— 否则「注释里写着 `formatMonthYear`」
 *      也能让锁变绿（本仓实测过的假绿第 1 种：被注释满足）；
 *   ② 判**调用形状**而不是「文件里出现某字面量」—— `import` 行本身含 `formatMonthYear`，
 *      只判字面量的话把第三实参删掉照样绿（同族缺陷已在屏幕侧那条锁上实测过）。
 *   非空自证（**待冻结窗口执行**）：删掉第三实参后，`buildMonthTicks(`
 *   之后 200 字内不再出现该标识符（import 行距调用点远大于 200 字）⇒ 应变红。
 *   ⚠️ 本条**尚未实测**：本批（05:2x 起）team-lead 下令禁止跑任何 vitest（防污染判据），
 *     故此处只做**距离论证**，不做「已自证」的声明；窗口里跑一次即补上读数。
 */
describe('⑤e 日期出口 · 共享内核纯净锁（回归自证）', () => {
  it('★ src/lib/date.ts 不许 import i18n（否则服务端类型检查连红两条 TS2584）', () => {
    const src = maskComments(read('src/lib/date.ts'));
    const specifiers = [...src.matchAll(/['"]([^'"\n]+)['"]/g)].map((m) => m[1]!);
    const bad = specifiers.filter((s) => /(^|\/)i18n$/.test(s));
    expect(
      bad,
      'src/lib/date.ts 引了 i18n ⇒ 服务端 program 被拖进 src/i18n/lang.ts（含 document）' +
        ' ⇒ `npm run typecheck:server` 红。要用取词器请由**调用方**注入（见本文件顶部区块）。',
    ).toEqual([]);
  });

  it('★ 纸面调用点必须在同一次调用里传纸面出口（不再靠缺省值）', () => {
    const paper = ['src/components/print/useSchedulePaperData.ts', 'src/print/model/print-gantt.ts'];
    for (const f of paper) {
      const src = maskComments(read(f));
      expect(src, `${f} 没有调 buildMonthTicks？那这条锁是空的`).toContain('buildMonthTicks(');
      expect(src, `${f} 没传纸面出口 —— 打印稿的月份标签会失去出处`).toMatch(
        /buildMonthTicks\([\s\S]{0,200}?formatMonthYear\b/,
      );
    }
  });
});
