/**
 * v0.7 · B1 侧栏方块外观解析层单测（src/lib/projectAccent.ts）。
 *
 * 这个模块是**唯一**的「shortLabel / coverColor 怎么显示」口径出处：
 * 侧栏折叠态方块、侧栏展开态彩条、项目卡的编辑弹窗三处都调它。
 * 因此这里的断言既是行为契约，也是「回落分支只写一遍」的守卫——
 * 若有人把 `?? 项目名首字` 抄回组件里，本文件的用例仍会绿，但
 * tests/stage-subset-split.spec.ts 的键序用例 + 组件层实现会先暴露重复。
 *
 * 顺带锁住 normalizeProjectRow 的 shortLabel 键位（四处同步铁律的第二处）：
 * 位置错了 backup roundtrip 的逐表 JSON.stringify diff 会挂，且**只在导入时暴露**。
 */
import { describe, it, expect } from 'vitest';

import {
  PROJECT_COVER_TOKENS,
  PROJECT_SHORT_LABEL_MAX_LENGTH,
  isProjectCoverToken,
  normalizeProjectCoverColor,
  normalizeProjectShortLabel,
  projectCoverColorCss,
  resolveProjectAccentColor,
  resolveProjectShortLabel,
} from '../src/lib/projectAccent';
import { normalizeProjectRow } from '../src/core/template/stage-fallback';
import type { Project } from '../src/core/types/entities';

describe('项目外观 · 简称回落（shortLabel ?? 项目名首字）', () => {
  it('未设简称（null / undefined / 空串 / 全空格）→ 项目名首字', () => {
    expect(resolveProjectShortLabel('云栖酒店改造', null)).toBe('云');
    expect(resolveProjectShortLabel('云栖酒店改造', undefined)).toBe('云');
    expect(resolveProjectShortLabel('云栖酒店改造', '')).toBe('云');
    expect(resolveProjectShortLabel('云栖酒店改造', '   ')).toBe('云');
  });

  it('设了简称 → 用简称（两侧空白先 trim）', () => {
    expect(resolveProjectShortLabel('云栖酒店改造', '云栖')).toBe('云栖');
    expect(resolveProjectShortLabel('云栖酒店改造', '  云栖  ')).toBe('云栖');
  });

  it('超长按**码点**截断到 2 字，不劈开代理对（否则渲染出半个字符）', () => {
    expect(PROJECT_SHORT_LABEL_MAX_LENGTH).toBe(2);
    expect(resolveProjectShortLabel('x', '云栖酒店')).toBe('云栖');
    // emoji 是代理对：slice(0,2) 会切出半个 → 这里必须仍是 2 个完整码点
    expect(Array.from(resolveProjectShortLabel('x', '🌿🌿🌿'))).toHaveLength(2);
  });

  it('项目名也为空 → 兜底「·」，永不返回空串（避免无法定位的空白方块）', () => {
    expect(resolveProjectShortLabel('', null)).toBe('·');
    expect(resolveProjectShortLabel('   ', null)).toBe('·');
  });

  it('写入侧归一：空 → null（= 清除，回到首字回落），超长截断', () => {
    expect(normalizeProjectShortLabel('')).toBeNull();
    expect(normalizeProjectShortLabel('   ')).toBeNull();
    expect(normalizeProjectShortLabel(null)).toBeNull();
    expect(normalizeProjectShortLabel(undefined)).toBeNull();
    expect(normalizeProjectShortLabel(' 云栖 ')).toBe('云栖');
    expect(normalizeProjectShortLabel('云栖酒店')).toBe('云栖');
  });
});

describe('项目外观 · 覆盖式取色（coverColor 有值用它，无值回落阶段色）', () => {
  /** 阶段色回落值（真实形态：STAGE_BAR_COLORS 的值就是 var() 引用） */
  const STAGE = 'var(--stage-s3)';

  it('未设 coverColor → 原样回落阶段色', () => {
    expect(resolveProjectAccentColor(null, STAGE)).toBe(STAGE);
    expect(resolveProjectAccentColor(undefined, STAGE)).toBe(STAGE);
    expect(resolveProjectAccentColor('', STAGE)).toBe(STAGE);
    expect(resolveProjectAccentColor('   ', STAGE)).toBe(STAGE);
  });

  it('白名单 token → 用自定义色（且确实不是阶段色）', () => {
    expect(PROJECT_COVER_TOKENS.length).toBeGreaterThan(0);
    expect(resolveProjectAccentColor('pine', STAGE)).toBe(projectCoverColorCss('pine'));
    expect(resolveProjectAccentColor('pine', STAGE)).not.toBe(STAGE);
  });

  it('非白名单值（v0.6 老数据残留的裸 hex / 误写的类名）→ 不抛错、放心回落阶段色', () => {
    // 本仓库测试夹具 tests/fixtures/v07-board-seed.json 里就有 "#3D6B5B"
    expect(resolveProjectAccentColor('#3D6B5B', STAGE)).toBe(STAGE);
    expect(resolveProjectAccentColor('bg-pine', STAGE)).toBe(STAGE);
    expect(resolveProjectAccentColor('MOSS', STAGE)).toBe(STAGE);
  });

  it('取色表达式零裸 hex、零 Tailwind 类名（值域唯一来源仍是 global.css）', () => {
    for (const t of PROJECT_COVER_TOKENS) {
      expect(t.css).toMatch(/^rgb\(var\(--[a-z-]+-rgb\)\)$/);
      expect(t.css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(t.css).not.toMatch(/^bg-/);
    }
  });

  it('写入侧归一：非白名单 → null，白名单原样', () => {
    expect(normalizeProjectCoverColor('#3D6B5B')).toBeNull();
    expect(normalizeProjectCoverColor('')).toBeNull();
    expect(normalizeProjectCoverColor(null)).toBeNull();
    expect(normalizeProjectCoverColor('moss')).toBe('moss');
    expect(isProjectCoverToken('moss')).toBe(true);
    expect(isProjectCoverToken('MOSS')).toBe(false);
    expect(isProjectCoverToken(null)).toBe(false);
  });
});

describe('项目行归一 · shortLabel 的键位（四处同步铁律 · 第二处）', () => {
  /** 老备份（v1/v2/v3）形态：完全没有 shortLabel 键 */
  const legacyInput = {
    id: 'proj_1',
    name: '云栖酒店改造',
    type: 'dining',
    address: '杭州市西湖区',
    clientName: '云栖',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-01-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
    status: 'active',
    revision: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('老备份缺 shortLabel → 补 null（导入后每行必有该键，运行时不会 undefined）', () => {
    const row = normalizeProjectRow(legacyInput);
    expect(row.shortLabel).toBeNull();
  });

  it('键序与 entities.Project 声明逐字一致：shortLabel 紧随 coverColor', () => {
    const row = normalizeProjectRow(legacyInput);
    const expected: Array<keyof Project> = [
      'id',
      'name',
      'type',
      'address',
      'clientName',
      'contractAmount',
      'signedAt',
      'plannedStartAt',
      'plannedEndAt',
      'coverColor',
      'shortLabel',
      'stagePresetKey',
      'stageTemplateVersion',
      'scheduleBasis',
      'status',
      'revision',
      'updatedAt',
    ];
    expect(Object.keys(row)).toEqual(expected);
  });

  it('备份里带 shortLabel → 原样保留（显式 null 也保留为 null）', () => {
    expect(normalizeProjectRow({ ...legacyInput, shortLabel: '云栖' }).shortLabel).toBe('云栖');
    expect(normalizeProjectRow({ ...legacyInput, shortLabel: null }).shortLabel).toBeNull();
  });
});
