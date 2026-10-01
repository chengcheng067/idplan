// @vitest-environment node
/**
 * 0.8.5 demo 运行时工厂（路线 A）· 守门 spec。
 *
 * 替代旧版「读 public/demo-backup.json 静态文件」的断言形态——静态文件已删
 * （行业不中立+日期过期+与阶段库重复造内容三宗罪，见 demoDataFactory.ts 头注）。
 *
 * 五件事各钉一层：
 *   ① 产物过当前 backup zod schema（导入链与真实备份同一条）；
 *   ② **行业中立**：≥3 个不同 domain（旧静态包是 5 个全室内——本 spec 的存在理由）；
 *   ③ **日期动态锚**：阶段区间以 today 为基准（永不过期）；
 *   ④ 脱敏：不含任何真实姓名/邮箱（开源红线，她数据敏感度高）；
 *   ⑤ 入口链路源码守门：loadDemo 走工厂而非 fetch 静态 json（防回潮）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildDemoBackup, DEMO_PRESETS, demoPresetReadiness } from '../src/core/demo/demoDataFactory';
import { validateBackupJson } from '../src/core/services/backup.service';
import { getPresets } from '../src/core/template/stage-library';

describe('demo 运行时工厂（buildDemoBackup）', () => {
  const pkg = buildDemoBackup();

  it('① 产物过当前 backup zod schema（与真实备份同一导入链）', () => {
    const parsed = validateBackupJson(pkg);
    expect(parsed.data.projects).toHaveLength(5);
    expect(parsed.data.stages.length).toBeGreaterThanOrEqual(25);
    expect(parsed.data.tasks.length).toBeGreaterThanOrEqual(60);
    expect(parsed.data.members.length).toBeGreaterThanOrEqual(5);
  });

  it('② 行业中立：5 项目覆盖 ≥3 个不同 domain（防退回全室内）', () => {
    const domains = new Set(pkg.data.projects.map((p) => (p.stagePresetKey ?? '').split('_')[0]));
    expect(domains.size).toBeGreaterThanOrEqual(3);
    // 五种 preset 全在阶段库有定义（悬空 = 工厂会静默跳过，这里钉住不许缺）
    const libKeys = new Set(getPresets().map((p) => p.key));
    for (const { presetKey } of DEMO_PRESETS) {
      expect(libKeys.has(presetKey), `阶段库缺 preset ${presetKey}`).toBe(true);
    }
    for (const p of pkg.data.projects) {
      expect(p.stagePresetKey).toBeTruthy();
      expect(libKeys.has(p.stagePresetKey as string)).toBe(true);
    }
  });

  it('③ 日期动态锚：每段 startAt <= endAt，且 ≥3 个项目跨度跨过 today', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const s of pkg.data.stages) {
      expect(s.startAt <= s.endAt).toBe(true);
    }
    const spanning = pkg.data.projects.filter(
      (p) => p.plannedStartAt.slice(0, 10) <= today && p.plannedEndAt.slice(0, 10) >= today,
    );
    expect(spanning.length).toBeGreaterThanOrEqual(3);
  });

  it('④ 脱敏：无真实姓名/邮箱（开源产物红线）', () => {
    const text = JSON.stringify(pkg);
    expect(text).not.toContain('yangwencheng');
    expect(text).not.toContain('杨雯丞');
    expect(text).not.toContain('foxmail');
  });

  it('⑤ 入口守门：useBackupIo.loadDemo 走工厂而非 fetch 静态 json（防回潮）', () => {
    const src = readFileSync(resolve(__dirname, '..', 'src/components/layout/useBackupIo.tsx'), 'utf8');
    expect(src).toContain('buildDemoBackup()');
    expect(src).not.toContain('demo-backup.json');
    // demoPresetReadiness 全 ready（设计师 D5 demoReady 门控的数据源）
    expect(demoPresetReadiness().every((r) => r.ready)).toBe(true);
  });
});
