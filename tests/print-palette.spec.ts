/**
 * 配色架构 · 对比度硬闸门单测（产品决策文档 §3.2 / §3.2-②）。
 *
 * 锁四件事：
 *   ① 三套的设计师基线 + 全部预设变体**实测过闸**（预设是主路径，必须真过，
 *      不是「应该能过」——这里用仓库现成 contrast() 逐组量）；H 的基线是**唯一
 *      一处显式登记的偏离，且只剩 accent 一条**（2026-10-11 P1-3 复核：line 的改
 *      参考稿实测值 `#91918A` 本身过闸，两条例外降到一条），由 ①c 单独钉住其值与
 *      实测比值，①d 保证该偏离**不外溢到用户可达的预设**（预设过闸 + 线色与基线同值）；
 *   ② 边界值：刚好达标放行、差一点禁存（三对各自一对边界灰度）；
 *   ③ 禁存提示**指名**哪一对不达标、当前比值多少（不许打折成泛泛一句）；
 *   ④ A 版是三对（accent 兼纸面 ⇒ accent-vs-paper 是自比对，假闸门不要），
 *      经典模板无闸门（品牌资产不开放）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PRINT_DENSITY_FLOORS,
  PRINT_TEMPLATE_PALETTES,
  PRINT_PALETTE_SLOTS,
  canSavePrintPalette,
  checkPrintPalette,
  effectivePalette,
  templatePaletteSpec,
  type PrintPalette,
} from '../src/print/model/print-palette';
import { contrast } from '../src/core/color/contrast';
import type { PrintTemplateId } from '../src/print/model/print-view-model';

const FOUR: ReadonlyArray<Exclude<PrintTemplateId, 'classic'>> = [
  'swiss-schedule',
  'data-editorial',
  'editorial-index',
  'agent-poster',
];

describe('配色架构 · 硬闸门（禁存，不是提示）', () => {
  it('① 三套基线 + 全部预设变体实测过闸（预设是主路径，逐组量；H 基线的偏离见 ①c）', () => {
    for (const id of FOUR) {
      const spec = PRINT_TEMPLATE_PALETTES[id];
      // H 基线仍带**一条**登记偏离（accent 2.812；line 已于 P1-3 归队，见 ①c）
      // —— 全表唯一豁免项
      if (id !== 'agent-poster') {
        const base = checkPrintPalette(id, spec.baseline);
        expect(base.ok, `${id} 基线应过闸：${base.message ?? ''}`).toBe(true);
      }
      for (const preset of spec.presets) {
        const r = checkPrintPalette(id, preset.palette);
        expect(r.ok, `${id} 预设「${preset.name}」应过闸：${r.message ?? ''}`).toBe(true);
      }
    }
  });

  it('①b classic 无配色规格（品牌资产不开放）；effectivePalette 对 classic 为 null', () => {
    expect(templatePaletteSpec('classic')).toBeNull();
    expect(effectivePalette('classic')).toBeNull();
    for (const id of FOUR) expect(effectivePalette(id)).not.toBeNull();
  });

  it('①c H 版基线 = 参考稿实测值，**登记偏离只剩 accent 一条**（闸门管用户自定义配色，不管设计师基线）', () => {
    // 「不许静默踩线」的落地（审美标准 §4 末条 D 的 #C9C9C9 是先例）：H 的纸底
    // #DEDDD4 一压深，accent 跌破闸门。规格 P0-17 裁决「忠于参考稿 + 显式登记偏离」，
    // 故这里把三枚值与实测比值一起钉死：谁要是把基线"修"成能过闸的值（或悄悄放行
    // 别的模板），这里先红。
    const spec = PRINT_TEMPLATE_PALETTES['agent-poster'];
    expect(spec.paper).toBe('#DEDDD4');
    expect(spec.baseline).toEqual({ accent: '#E2522B', ink: '#0A0A0A', line: '#91918A' });

    const paper = '#DEDDD4';
    expect(contrast(spec.baseline.ink, paper), '主文字 vs 纸底').toBeCloseTo(14.517879, 4);
    expect(contrast(spec.baseline.accent, paper), '状态色 vs 纸底').toBeCloseTo(2.812355, 4);
    // 2026-10-11 P1-3 复核：line 的值改成**参考稿像素实测** #91918A（对参考稿 PNG
    // 全像素扫描：该值命中全部 1px 分隔行，旧写法 #BFBFBF **0 处命中**——是取色失误
    // 不是参考稿值）。它本身即过闸（2.3258 ≥ 1.5，余量 55%）⇒ H 的偏离构成由
    // 两条降到一条，且 line 与其余三版**同口径**（不再是例外）。
    expect(contrast(spec.baseline.line, paper), '分隔线 vs 纸底').toBeCloseTo(2.325774, 4);

    const gate = checkPrintPalette('agent-poster', spec.baseline);
    expect(gate.ok, 'H 基线的偏离是**登记的**：ok 必须为 false，不是意外踩线').toBe(false);
    expect(
      gate.failures.map((f) => f.label),
      '偏离只剩「状态色 vs 纸底」一条（accent 是身份色，改它=改模板身份）；line 已归队',
    ).toEqual(['状态色 vs 纸底']);
    expect(gate.message).toContain('已禁止保存'); // 闸门语义未被"登记"稀释

    // 没跌破的两对仍要守——免得「登记偏离」变成整张闸门作废
    expect(gate.pairs.find((p) => p.label === '主文字 vs 纸底')!.pass).toBe(true);
    expect(gate.pairs.find((p) => p.label === '分隔线 vs 纸底')!.pass, 'line 不是例外').toBe(true);
  });

  it('①d H 版四个预设不许继承基线的偏离：逐个实测过闸，线色与基线同值（唯一异值在 accent）', () => {
    // 规格 P0-17：「用户在 H 上改色时拿不到 2.81 那种组合」——预设是**用户可达组合**，
    // 必须真过闸。
    const spec = PRINT_TEMPLATE_PALETTES['agent-poster'];
    for (const preset of spec.presets) {
      expect(
        checkPrintPalette('agent-poster', preset.palette).ok,
        `${preset.name} 预设应过闸`,
      ).toBe(true);
      // 2026-10-11 P1-3：线色回归「与基线同值」——line 自身已过闸（2.3258），
      // 原先那条「为过闸而同色相加深」的 #B4B4B4 由此退役（它是为 1.348 那版
      // 基线打的补丁，补丁的前提没了）。ink 同理，四张预设一律照基线的墨色。
      expect(preset.palette.line, `${preset.name} 的线色必须与基线同值（不再是例外）`).toBe(
        spec.baseline.line,
      );
      expect(preset.palette.ink, `${preset.name} 的主文字与基线同值`).toBe(spec.baseline.ink);
    }
    expect(
      spec.presets.every((p) => p.palette.line === '#91918A'),
      '四张预设的线色全是参考稿实测值 #91918A',
    ).toBe(true);

    // 唯一与基线**异值**的是 signal-orange 的 accent——这是**算术上必需**的：
    // 预设是用户可达组合，必须真过闸，而基线 accent 只有 2.812。
    const orange = spec.presets.find((p) => p.id === 'signal-orange')!;
    expect(orange.palette.accent).toBe('#DA4B21');
    expect(
      orange.palette.accent,
      '预设 accent 不得与基线同值——否则用户能直接选中 2.812 的组合',
    ).not.toBe(spec.baseline.accent);
    // 取的是**最小位移解**（不是为了好看随便挑的）：再浅一档就跌破 3
    expect(contrast('#DC4E24', '#DEDDD4')).toBeLessThan(3);
    expect(contrast(orange.palette.accent, '#DEDDD4')).toBeCloseTo(3.074012, 4);
  });

  it('② 边界：刚好达标放行、差一点禁存（D 版白底，三对各一对边界灰度）', () => {
    // 这三组灰度是踩线样本：经 contrast() 实测分别贴在 4.5 / 3 / 1.5 阈值两侧
    const pass: PrintPalette = { accent: '#949494', ink: '#767676', line: '#D2D2D2' };
    const fail: PrintPalette = { accent: '#959595', ink: '#787878', line: '#D3D3D3' };

    // 先自证样本确实踩在阈值两侧（防将来灰度表变动后样本失效还假装在测边界）
    expect(contrast(pass.ink, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fail.ink, '#FFFFFF')).toBeLessThan(4.5);
    expect(contrast(pass.accent, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contrast(fail.accent, '#FFFFFF')).toBeLessThan(3);
    expect(contrast(pass.line, '#FFFFFF')).toBeGreaterThanOrEqual(1.5);
    expect(contrast(fail.line, '#FFFFFF')).toBeLessThan(1.5);

    expect(canSavePrintPalette('data-editorial', pass)).toBe(true);

    const gate = checkPrintPalette('data-editorial', fail);
    expect(gate.ok).toBe(false);
    expect(gate.failures).toHaveLength(3);
    expect(gate.pairs).toHaveLength(3);
    // ③ 指名哪一对 + 当前比值多少
    expect(gate.message).toContain('主文字 vs 纸底');
    expect(gate.message).toContain('身份色 vs 纸底');
    expect(gate.message).toContain('线色 vs 纸底');
    expect(gate.message).toContain('已禁止保存');
    for (const f of gate.failures) {
      expect(f.ratio).toBeGreaterThan(0);
      expect(f.ratio).toBeLessThan(f.min);
      expect(f.pass).toBe(false);
    }
  });

  it('②b A 版三对：浅纸面 + 白线白字全部踩线（accent 兼纸面，自比对不当闸门）', () => {
    // 浅黄纸 + 白主文字 + 白栏底：三对全挂（含「栏内反白字 vs 栏底」= 白 vs 白）
    const bad: PrintPalette = { accent: '#FFF8E1', ink: '#FFFFFF', line: '#FFFFFF' };
    const gate = checkPrintPalette('swiss-schedule', bad);
    expect(gate.ok).toBe(false);
    expect(gate.pairs.map((p) => p.label)).toEqual([
      '主文字 vs 纸面',
      '线色 vs 纸面',
      '栏内反白字 vs 栏底',
    ]);
    expect(gate.failures).toHaveLength(3);
    expect(gate.message).toContain('栏内反白字 vs 栏底');
  });

  it('②c A 版深色纸变体过闸（站台蓝：纸/字/栏三枚全换仍可读）', () => {
    const preset = PRINT_TEMPLATE_PALETTES['swiss-schedule'].presets.find((p) => p.id === 'platform-blue')!;
    const gate = checkPrintPalette('swiss-schedule', preset.palette);
    expect(gate.ok).toBe(true);
    // 深色纸上主文字是浅色——ink 与 accent 的角色互换正是 A 版改纸面的语义
    expect(contrast(preset.palette.ink, preset.palette.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('②d D 版基线 line 用 #C9C9C9 而非 02 §6 的 #D4D4D4（后者 1.48 过不了 1.5 闸门）', () => {
    // 这是一条**实测登记**：若将来有人把 D 基线 line 改回 #D4D4D4，这里先红
    expect(PRINT_TEMPLATE_PALETTES['data-editorial'].baseline.line).toBe('#C9C9C9');
    expect(contrast('#D4D4D4', '#FFFFFF')).toBeLessThan(1.5);
    expect(contrast('#C9C9C9', '#FFFFFF')).toBeGreaterThanOrEqual(1.5);
  });

  it('③ gate 结果与 contrast() 逐对一致（闸门不私算比值）', () => {
    for (const id of FOUR) {
      const spec = PRINT_TEMPLATE_PALETTES[id];
      const probe: PrintPalette = { accent: '#123456', ink: '#654321', line: '#ABCDEF' };
      const gate = checkPrintPalette(id, probe);
      const paper = spec.paper === 'accent' ? probe.accent : spec.paper;
      for (const pair of gate.pairs) {
        const a = pair.a === 'paper' ? paper : probe[pair.a];
        const b = pair.b === 'paper' ? paper : probe[pair.b];
        expect(pair.ratio).toBeCloseTo(contrast(a, b), 10);
        expect(pair.pass).toBe(pair.ratio >= pair.min);
      }
    }
  });

  it('④ 槽位表完整（三枚，UI 遍历用）', () => {
    expect(PRINT_PALETTE_SLOTS).toEqual(['accent', 'ink', 'line']);
  });
});

describe('打印密度下限（密度研究 §4 三约束：改色后密度不失效）', () => {
  it('三条下限常量在位且取值正确（行高 2×3px / 轨道 6px / accent 文字 9.5px）', () => {
    expect(PRINT_DENSITY_FLOORS.rowPaddingMin).toBe(3);
    expect(PRINT_DENSITY_FLOORS.trackHeightMin).toBe(6);
    expect(PRINT_DENSITY_FLOORS.accentFontSizeMin).toBe(9.5);
  });

  it('四版 CSS 现状不踩任一条下限（行 padding 上下侧 ≥3px / 轨道 ≥6px）', () => {
    // 从四套模板 CSS + 通用模块 CSS 源码实读（不是复述常识）：compact 档是最紧档，取全表最小值
    const styles = ['swiss-schedule', 'data-editorial', 'editorial-index', 'generic-modules'].map((f) =>
      readFileSync(resolve(__dirname, '..', 'src', 'print', 'styles', `${f}.css`), 'utf-8'),
    );
    /** 取一条规则的 padding 四联值（CSS 简写展开：1→全同，2→[v,v]，3→[上,右,下]） */
    const verticalOf = (shorthand: string): number[] => {
      const v = shorthand
        .trim()
        .split(/\s+/)
        .map((x) => Number.parseFloat(x));
      const top = v[0]!;
      const bottom = v[2] ?? top; // 3/4 值写法第 3 项是下；1/2 值写法上下同值
      return [top, bottom];
    };
    const verticalPaddings = styles.flatMap((css) =>
      [
        '\\.swiss-stage-row\\b',
        '\\.swiss-register td',
        '\\.de-table td',
        '\\.ei-row\\b',
        // 期三通用模块（generic-modules.css 四套外表块 + compact 档都在内）
        '\\.gm-table td',
      ].flatMap((sel) =>
        Array.from(
          css.matchAll(new RegExp(`${sel}\\s*\\{[^}]*padding:\\s*([^;}]+)`, 'g')),
          (m) => verticalOf(m[1]!),
        ),
      ),
    );
    expect(verticalPaddings.length, '应读到四版的行 padding 规则').toBeGreaterThan(0);
    for (const [top, bottom] of verticalPaddings) {
      const where = `行 padding 上下侧 ${top}/${bottom}px`;
      expect(top, `${where} 上侧不得低于 ${PRINT_DENSITY_FLOORS.rowPaddingMin}px`).toBeGreaterThanOrEqual(
        PRINT_DENSITY_FLOORS.rowPaddingMin,
      );
      expect(bottom, `${where} 下侧不得低于 ${PRINT_DENSITY_FLOORS.rowPaddingMin}px`).toBeGreaterThanOrEqual(
        PRINT_DENSITY_FLOORS.rowPaddingMin,
      );
    }
    // 进度条/色带轨道高度（D 唯一定义轨道的模板；compact 6px 贴下限）
    const trackHeights = Array.from(
      styles[1]!.matchAll(/\.de-bar__track\s*\{[^}]*height:\s*(\d+)px/g),
      (m) => Number.parseInt(m[1]!, 10),
    );
    expect(trackHeights.length, '应读到 D 的轨道高度规则').toBeGreaterThan(0);
    for (const h of trackHeights) {
      expect(h, `轨道高 ${h}px 不得低于 ${PRINT_DENSITY_FLOORS.trackHeightMin}px`).toBeGreaterThanOrEqual(
        PRINT_DENSITY_FLOORS.trackHeightMin,
      );
    }
  });
});
