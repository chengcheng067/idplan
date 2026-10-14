/**
 * 打印族 · i18n 边界守卫（2026-10-14 口径：**屏幕侧翻、纸面不翻**）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 口径（仓内可核的形态，不是我的转述）
 * ══════════════════════════════════════════════════════════════════════
 *   `buildMonthMeta(calendarMonth, lang, todayIso?)` 的 `lang` **必填、无缺省值**
 *   （`src/components/calendar/calendarMath.ts`），而**纸面调用点显式写 `'zh'`**
 *   （`src/pages/CalendarPrintPage.tsx` 的 `buildMonthMeta(m, 'zh', todayIso)`）——
 *   屏幕随语言、**纸面恒中文**（产品规则，见 `src/i18n/date.ts` 文件头）。
 *
 * ⇒ 所以本批把打印族按「消费点是不是 `documents/**` 的渲染树」一分为二：
 *   · **屏幕侧**（预览对话框 / 选择器 / 配色器 / 打印页外壳）⇒ 走消息表（已翻）；
 *   · **纸面**（`documents/**` / `pages/**` / `adapters/**` / 纸面构件 / 两个打印页
 *     的纸面正文）⇒ **有意不翻**。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么「有意不翻」必须有会红的反向断言
 * ══════════════════════════════════════════════════════════════════════
 *   光写注释挡不住下一个人顺手把这些中文也搬进消息表（搬了之后**不会**有任何
 *   用例红——纸面在 zh 下照样印「委托方：」）。本文件把它钉成**双向**：
 *     ① 纸面那些串**必须仍在**纸面文件里（谁搬走谁红）；
 *     ② 纸面那几个文件**必须不 import i18n**（谁接线谁红——纸面一旦订阅语言，
 *        「纸面恒中文」就不是设计决定而是巧合了）；
 *     ③ 屏幕侧那些串**必须不在**屏幕文件里（防回潮）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { catalogOf, t } from '../src/i18n';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

/** 递归收集某目录下的 .ts/.tsx */
function collect(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(resolve(ROOT, dir))) {
    const rel = dir + '/' + name;
    if (statSync(resolve(ROOT, rel)).isDirectory()) out.push(...collect(rel));
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

/** 「纸面」= 渲染进打印稿的渲染树（判据见文件头，不是「在不在 src/print 下」） */
const PAPER_FILES: readonly string[] = [
  ...collect('src/print/documents'),
  ...collect('src/print/pages'),
  ...collect('src/print/adapters'),
  'src/components/print/SchedulePaper.tsx',
  'src/print/parts/PrintGantt.tsx',
  'src/print/parts/PrintLogoMark.tsx',
  'src/print/parts/EmptyPrintState.tsx',
];

/** 「屏幕侧」= 本批改过的调用点 */
const SCREEN_FILES: readonly string[] = [
  'src/components/print/PrintPreviewDialog.tsx',
  'src/components/print/print-templates.ts',
  'src/print/model/print-units.ts',
  'src/print/model/print-palette.ts',
  'src/print/parts/PaletteSection.tsx',
  'src/pages/SchedulePrintPage.tsx',
  'src/pages/CalendarPrintPage.tsx',
  'src/pages/ItineraryPrintPage.tsx',
];

/** 剥注释（块注释 + 整行 `//`）：②③ 的判据只认**代码**，注释里提到中文名不算命中 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('打印族 · i18n 边界（屏幕侧翻 / 纸面不翻）', () => {
  it('① 纸面文件**必须不 import i18n**（订阅了语言，纸面就不再是「设计上恒中文」）', () => {
    const offenders: string[] = [];
    for (const file of PAPER_FILES) {
      const src = read(file);
      if (/from\s+'[^']*\/i18n'/.test(src) || /useLang\s*\(/.test(src)) offenders.push(file);
    }
    expect(offenders, '纸面文件不许接 i18n（口径见文件头）').toEqual([]);
  });

  it('② 纸面正文的中文**必须仍在**（反向断言：谁把它搬进消息表谁红）', () => {
    const cal = stripComments(read('src/pages/CalendarPrintPage.tsx'));
    for (const s of [
      "const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;",
      "const meta = buildMonthMeta(m, 'zh', todayIso);",
      '委托方：',
      '周期：',
      'ID Plan 月历',
      '当前阶段：',
      '阶段色泽：',
      '色带长度 = 该阶段的起止日期跨度，不代表完成百分比。',
      '项目覆盖',
      '今天',
      '打印人：',
    ]) {
      expect(cal, `CalendarPrintPage 纸面串仍在：${s}`).toContain(s);
    }

    const itin = stripComments(read('src/pages/ItineraryPrintPage.tsx'));
    for (const s of ['行程周期：', '预算合计', '实际合计', '差额', '日期', '交通', '住宿', '当日安排', '预算', '实际']) {
      expect(itin, `ItineraryPrintPage 纸面串仍在：${s}`).toContain(s);
    }
    // 纸面表格头与「第 N 天」同批留着（它进纸面，不随界面语言）
    expect(itin, '纸面「第 N 天」仍在').toContain('第 {idx + 1} 天');
  });

  it('③ 屏幕侧：本批已翻掉的中文**不许回来**（正向锁）', () => {
    const gone: ReadonlyArray<[string, string]> = [
      ['src/pages/SchedulePrintPage.tsx', '正在装载日程表…'],
      ['src/pages/SchedulePrintPage.tsx', '未找到该项目。'],
      ['src/pages/SchedulePrintPage.tsx', '← 返回项目列表'],
      ['src/pages/SchedulePrintPage.tsx', '该项目的阶段与你无关。'],
      ['src/pages/SchedulePrintPage.tsx', '← 返回我的任务'],
      ['src/pages/SchedulePrintPage.tsx', '月历视图'],
      ['src/pages/SchedulePrintPage.tsx', '已在打印对话框打开'],
      ['src/pages/CalendarPrintPage.tsx', '正在装载月历…'],
      ['src/pages/CalendarPrintPage.tsx', '未找到该项目。'],
      ['src/pages/CalendarPrintPage.tsx', '该项目的阶段与你无关。'],
      ['src/pages/ItineraryPrintPage.tsx', '正在装载行程单…'],
      ['src/pages/ItineraryPrintPage.tsx', '未找到该项目。'],
      ['src/pages/ItineraryPrintPage.tsx', '← 返回项目详情'],
      ['src/pages/ItineraryPrintPage.tsx', '打印 / 导出 PDF'],
      ['src/components/print/PrintPreviewDialog.tsx', '模板与模块'],
      ['src/components/print/PrintPreviewDialog.tsx', '输出模块'],
      ['src/components/print/PrintPreviewDialog.tsx', '关闭打印预览'],
      ['src/components/print/print-templates.ts', '阶段清单'],
      ['src/components/print/print-templates.ts', '延期台账'],
      ['src/print/model/print-units.ts', '打印头部'],
      ['src/print/model/print-units.ts', '黑顶栏'],
      ['src/print/model/print-palette.ts', '交通黄'],
      ['src/print/model/print-palette.ts', '对比度不足，已禁止保存：'],
      ['src/print/parts/PaletteSection.tsx', '保存自定义'],
      ['src/print/parts/PaletteSection.tsx', '设计师基线'],
    ];
    for (const [file, s] of gone) {
      expect(stripComments(read(file)), `${file} 不该再有硬编码「${s}」`).not.toContain(s);
    }
  });

  it('④ 屏幕侧新键：zh 取到原值、en 不含汉字（逐键，不是抽样）', () => {
    const zh = catalogOf('zh');
    const en = catalogOf('en');
    const keys = Object.keys(zh).filter((k) => k.startsWith('print.')) as Array<keyof typeof zh>;
    expect(keys.length, 'print.* 键必须真的进了表（空表 = 分片被静默吞掉）').toBeGreaterThan(100);
    const cjk = /[\u3400-\u9fff]/;
    for (const key of keys) {
      expect(zh[key].length, `${key} zh 非空`).toBeGreaterThan(0);
      expect(en[key].length, `${key} en 非空`).toBeGreaterThan(0);
      expect(cjk.test(en[key]), `${key} 的英文不该含汉字：${en[key]}`).toBe(false);
    }
    // 抽三条钉「zh 与改动前源码逐字一致」（这三条是本批最容易被顺手改口径的）
    expect(t('print.template.classic.label')).toBe('经典');
    expect(t('print.palette.pair.accentLine')).toBe('栏内反白字 vs 栏底');
    expect(t('print.page.estimatedPages', { pages: 3 })).toBe('预计 3 页 · A4');
  });

  it('⑤ 纸面串**不许**出现在消息表里（否则等于给「纸面恒中文」开后门）', () => {
    const zh = catalogOf('zh');
    const values = new Set(Object.values(zh));
    for (const s of [
      '色带长度 = 该阶段的起止日期跨度，不代表完成百分比。',
      '该项目还没有每日行程，请先在项目详情里设置行程。',
    ]) {
      expect(values.has(s), `「${s}」是纸面/C 类串，不许进消息表`).toBe(false);
    }
  });
});
