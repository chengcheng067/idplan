/**
 * 配色架构 · 对比度硬闸门单测（产品决策文档 §3.2 / §3.2-②）。
 *
 * 锁四件事：
 *   ① 四套的设计师基线 + 全部预设变体**实测过闸**（预设是主路径，必须真过，
 *      不是「应该能过」——这里用仓库现成 contrast() 逐组量）；
 *   ② 边界值：刚好达标放行、差一点禁存（三对各自一对边界灰度）；
 *   ③ 禁存提示**指名**哪一对不达标、当前比值多少（不许打折成泛泛一句）；
 *   ④ A 版是三对（accent 兼纸面 ⇒ accent-vs-paper 是自比对，假闸门不要），
 *      经典模板无闸门（品牌资产不开放）。
 */
import { describe, it, expect } from 'vitest';

import {
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
  it('① 四套基线 + 全部预设变体实测过闸（预设是主路径，逐组量）', () => {
    for (const id of FOUR) {
      const spec = PRINT_TEMPLATE_PALETTES[id];
      const base = checkPrintPalette(id, spec.baseline);
      expect(base.ok, `${id} 基线应过闸：${base.message ?? ''}`).toBe(true);
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
