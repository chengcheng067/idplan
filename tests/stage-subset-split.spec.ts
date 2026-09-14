/**
 * 阶段子集切分（PRD 11 · 阶段自定义）：
 *   1. 传 N 个阶段项 → 输出 N 段，orderIndex 1..N 连续无空缺；
 *   2. 占比在子集内归一化，Σ段长恒等于总工期；
 *   3. **不传 stageItems → 输出与全量九段完全一致**（零回归锚点，比对全部关键字段）；
 *   4. 阶段数上/下限校验；
 *   5. Stage 行落库后 templateKey / colorIndex 正确写入；
 *   6. 老数据（无 templateKey / colorIndex）读时回落。
 *
 * 环境：node + fake-indexeddb（与既有 spec 一致）。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { ProjectService } from '../src/core/services/project.service';
import { getPresetItems, getStageLibraryItems } from '../src/core/template/stage-library';
import { MAX_STAGE_COUNT, MIN_STAGE_COUNT, addDaysIso, previewSplit } from '../src/core/template/split';
import {
  legacyColorIndexOf,
  legacyTemplateKeyOf,
  normalizeStageRow,
  resolveStageColorIndex,
  resolveStageTemplateKey,
} from '../src/core/template/stage-fallback';
import type { StageTemplateItem } from '../src/core/types/dto';
import type { Stage } from '../src/core/types/entities';

/** 室内·方案止（5 段） */
const CONCEPT5 = getPresetItems('indoor_concept');
/** 室内·仅深化（2 段） */
const DEEPEN2 = getPresetItems('indoor_deepen_only');
/** 景观·全流程（7 段） */
const LANDSCAPE7 = getPresetItems('landscape_full');

beforeAll(async () => {
  await installFakeIndexedDB();
});

/** 含头尾天数（与 tests/stage-split.spec.ts 同口径） */
function dayCount(startIso: string, endIso: string): number {
  return (
    Math.round(
      (new Date(`${endIso}T00:00:00Z`).getTime() -
        new Date(`${startIso}T00:00:00Z`).getTime()) /
        86400000,
    ) + 1
  );
}

function totalOf(drafts: Array<{ startAt: string; endAt: string }>): number {
  return drafts.reduce((acc, d) => acc + dayCount(d.startAt, d.endAt), 0);
}

describe('stage-subset：子集切分产出 N 段且 orderIndex 连续', () => {
  it('传 3 个阶段项 → 输出 3 段，orderIndex 1..3 连续无空缺', () => {
    const items = CONCEPT5.slice(0, 3);
    const drafts = previewSplit({
      startAt: '2026-03-01',
      endAt: '2026-05-29',
      stageItems: items,
    });

    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => d.orderIndex)).toEqual([1, 2, 3]);
    expect(drafts.map((d) => d.name)).toEqual(items.map((i) => i.name));
    // 连续无缝
    for (let i = 1; i < drafts.length; i += 1) {
      expect(drafts[i]!.startAt).toBe(addDaysIso(drafts[i - 1]!.endAt, 1));
    }
    // 首尾锚定项目起止
    expect(drafts[0]!.startAt).toBe('2026-03-01');
    expect(drafts[2]!.endAt).toBe('2026-05-29');
  });

  it('传 1 个阶段项 → 输出 1 段，占满整个工期', () => {
    const drafts = previewSplit({
      startAt: '2026-01-01',
      endAt: '2026-03-31',
      stageItems: [getStageLibraryItems()[0]!],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.orderIndex).toBe(1);
    expect(drafts[0]!.startAt).toBe('2026-01-01');
    expect(drafts[0]!.endAt).toBe('2026-03-31');
    expect(dayCount(drafts[0]!.startAt, drafts[0]!.endAt)).toBe(90);
  });

  it(`传 ${MAX_STAGE_COUNT} 个阶段项（上限）→ 正常切分不报错`, () => {
    const pool = getStageLibraryItems();
    expect(pool.length).toBeGreaterThanOrEqual(MAX_STAGE_COUNT);
    const drafts = previewSplit({
      startAt: '2026-01-01',
      endAt: '2026-12-31',
      stageItems: pool.slice(0, MAX_STAGE_COUNT),
    });
    expect(drafts).toHaveLength(MAX_STAGE_COUNT);
    expect(drafts.map((d) => d.orderIndex)).toEqual(
      Array.from({ length: MAX_STAGE_COUNT }, (_, i) => i + 1),
    );
  });
});

describe('stage-subset：不传 stageItems → 与全量九段完全一致（零回归锚点）', () => {
  it('各段 orderIndex / name / ratioPercent / 起止 / defaultTasks 逐字段一致', () => {
    const omitted = previewSplit({ startAt: '2026-03-01', endAt: '2026-06-08' });
    const explicitFull = previewSplit({
      startAt: '2026-03-01',
      endAt: '2026-06-08',
      stageItems: getPresetItems('indoor_full'),
    });
    const undefinedPassed = previewSplit({
      startAt: '2026-03-01',
      endAt: '2026-06-08',
      stageItems: undefined,
    });

    expect(omitted).toHaveLength(9);
    // 关键字段快照：锁死自然日契约（与 tests/stage-split.spec.ts 同口径）
    expect(omitted.map((d) => d.orderIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(omitted.map((d) => d.name)).toEqual([
      '提案',
      '测量',
      '平面方案',
      'SU 建模',
      '效果图',
      '施工图深化',
      '材料表',
      '交付',
      '实景',
    ]);
    expect(omitted.map((d) => d.ratioPercent)).toEqual([5, 4, 11, 10, 14, 22, 10, 19, 5]);
    expect(omitted[0]!.startAt).toBe('2026-03-01');
    expect(omitted[8]!.endAt).toBe('2026-06-08');
    expect(totalOf(omitted)).toBe(100);

    // 显式传入室内·全流程套餐 → 与省略时逐字段一致（indoor_full 即九段锚点）
    expect(explicitFull).toEqual(omitted);
    expect(undefinedPassed).toEqual(omitted);
  });

  it('不传 stageItems 时 templateKey/colorIndex 按老数据口径回填（colorIndex == orderIndex）', () => {
    const drafts = previewSplit({ startAt: '2026-03-01', endAt: '2026-06-08' });
    expect(drafts.map((d) => d.templateKey)).toEqual([
      'indoor.proposal',
      'indoor.measure',
      'indoor.concept_plan',
      'indoor.su_model',
      'indoor.rendering',
      'indoor.construction_drawing',
      'indoor.material_list',
      'indoor.handover',
      'indoor.photography',
    ]);
    expect(drafts.map((d) => d.colorIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('stage-subset：子集内占比归一化（Σ段长 == 总工期）', () => {
  const cases: Array<{ label: string; items: StageTemplateItem[]; start: string; end: string }> = [
    { label: '室内·方案止 5 段', items: CONCEPT5, start: '2026-03-01', end: '2026-07-29' },
    { label: '室内·仅深化 2 段', items: DEEPEN2, start: '2026-03-01', end: '2026-04-29' },
    { label: '景观·全流程 7 段', items: LANDSCAPE7, start: '2026-03-01', end: '2026-09-27' },
    { label: '跨专业混搭 4 段', items: getStageLibraryItems().filter((i) => [0, 9, 15, 16].includes(getStageLibraryItems().indexOf(i))), start: '2026-05-01', end: '2026-06-29' },
    { label: '极短工期 3 天', items: CONCEPT5.slice(0, 2), start: '2026-05-01', end: '2026-05-03' },
  ];

  for (const c of cases) {
    it(`${c.label}：Σ段长 == totalDays 且无缝连续`, () => {
      const drafts = previewSplit({ startAt: c.start, endAt: c.end, stageItems: c.items });
      const totalDays = dayCount(c.start, c.end);

      expect(drafts).toHaveLength(c.items.length);
      expect(totalOf(drafts)).toBe(totalDays);
      for (const d of drafts) {
        expect(dayCount(d.startAt, d.endAt)).toBeGreaterThanOrEqual(1);
      }
      for (let i = 1; i < drafts.length; i += 1) {
        expect(drafts[i]!.startAt).toBe(addDaysIso(drafts[i - 1]!.endAt, 1));
      }
      expect(drafts[0]!.startAt).toBe(c.start);
      expect(drafts[drafts.length - 1]!.endAt).toBe(c.end);
    });
  }

  it('子集占比按子集内合计归一化（5%:4%:11%:10%:14% → 44 合计归一）', () => {
    const drafts = previewSplit({
      startAt: '2026-01-01',
      endAt: addDaysIso('2026-01-01', 99), // 100 天
      stageItems: CONCEPT5,
    });
    // 残差吸收段（施工图深化 orderIndex=6）不在子集内 → 兜底给最长段（效果图 14%）
    const lens = drafts.map((d) => dayCount(d.startAt, d.endAt));
    const theory = CONCEPT5.map((i) => Math.floor((100 * i.ratioPercent) / 44));
    expect(theory).toEqual([11, 9, 25, 22, 31]);
    // 仅残差段可能偏离理论值，其余逐段相等
    expect(lens.slice(0, 4)).toEqual(theory.slice(0, 4));
    expect(lens.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('stage-subset：阶段数边界校验', () => {
  it(`传 ${MAX_STAGE_COUNT + 1} 个阶段项 → 拒绝（超出上限 ${MAX_STAGE_COUNT}）`, () => {
    const pool = getStageLibraryItems();
    // 阶段库有 50+ 项，取 MAX+1 项无需重复——上限校验本身只看长度
    const tooMany = Array.from({ length: MAX_STAGE_COUNT + 1 }, (_, i) => pool[i % pool.length]!);
    expect(tooMany).toHaveLength(MAX_STAGE_COUNT + 1);

    expect(() =>
      previewSplit({ startAt: '2026-01-01', endAt: '2026-12-31', stageItems: tooMany }),
    ).toThrowError(new RegExp(`最多 ${MAX_STAGE_COUNT} 个阶段`));
  });

  it('传空数组 → 拒绝（至少 1 个阶段）', () => {
    expect(() =>
      previewSplit({ startAt: '2026-01-01', endAt: '2026-12-31', stageItems: [] }),
    ).toThrowError(/至少选择 1 个阶段/);
  });

  it('MIN/MAX 常量与产品裁定一致（1..20，v0.8 由 12 放宽）', () => {
    expect(MIN_STAGE_COUNT).toBe(1);
    expect(MAX_STAGE_COUNT).toBe(20);
  });
});

/* ---------------------- 落库路径：Stage 行的 templateKey / colorIndex ---------------------- */

let bundle: IRepositoryBundle;

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // fake-indexeddb 同 module 实例共享同名库——每次用空包清库重建保证隔离（与既有 spec 同手法）
  await bundle.admin?.replaceAllImport({
    meta: { app: 'changxia', schemaVersion: 2, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      projects: [],
      stages: [],
      tasks: [],
      members: [],
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
    },
  });
});

function makeService(): ProjectService {
  return new ProjectService({ projects: bundle.projects, bundle });
}

describe('stage-subset：落库后 Stage 行的 templateKey / colorIndex 正确写入', () => {
  it('手动建档传 3 个阶段项 → 落库 3 行，两字段逐行正确', async () => {
    const svc = makeService();
    const items = CONCEPT5.slice(0, 3);

    const project = await svc.createManualProject({
      name: '望江楼 · 方案委托',
      type: 'dining' as never,
      address: '成都市青羊区',
      clientName: '测试甲方',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-05-29',
      coverColor: null,
      stageItems: items,
    });

    const rows = await bundle.stages.listByProject(project.id);
    expect(rows).toHaveLength(3);
    expect(rows.map((s) => s.orderIndex)).toEqual([1, 2, 3]);
    expect(rows.map((s) => s.templateKey)).toEqual(items.map((i) => i.key));
    expect(rows.map((s) => s.colorIndex)).toEqual(items.map((i) => i.colorIndex));
    // 项目侧溯源字段
    expect(project.stagePresetKey).toBe('custom');
    expect(project.scheduleBasis).toBe('calendar');
    // 色号跨项目可比：与模板库声明一致，不等于 orderIndex
    expect(rows[2]!.colorIndex).toBe(items[2]!.colorIndex);
  });

  it('不传 stageItems → 落库 9 行，templateKey/colorIndex 与老数据口径一致', async () => {
    const svc = makeService();
    const project = await svc.createManualProject({
      name: '望江楼 · 全流程',
      type: 'dining' as never,
      address: '成都市青羊区',
      clientName: '测试甲方',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-06-08',
      coverColor: null,
    });

    expect(project.stagePresetKey).toBe('indoor_full');
    const rows = await bundle.stages.listByProject(project.id);
    expect(rows).toHaveLength(9);
    expect(rows.map((s) => s.templateKey)).toEqual([
      'indoor.proposal',
      'indoor.measure',
      'indoor.concept_plan',
      'indoor.su_model',
      'indoor.rendering',
      'indoor.construction_drawing',
      'indoor.material_list',
      'indoor.handover',
      'indoor.photography',
    ]);
    expect(rows.map((s) => s.colorIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('键序铁律：Stage 行的键序与 entities / schema / insert 四处一致', async () => {
    const svc = makeService();
    const project = await svc.createManualProject({
      name: '键序校验项目',
      type: 'dining' as never,
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-03-31',
      coverColor: null,
      stageItems: DEEPEN2,
    });

    const rows = await bundle.stages.listByProject(project.id);
    expect(Object.keys(rows[0]!)).toEqual([
      'id',
      'projectId',
      'orderIndex',
      'templateKey',
      'colorIndex',
      // v0.8：Stage 链新增 customColor（colorIndex 之后、name 之前）
      'customColor',
      'name',
      'ratioPercent',
      'startAt',
      'endAt',
      'status',
      'ownerId',
      'visible',
      'resourcePath',
      'revision',
      'updatedAt',
    ]);
    expect(Object.keys(project)).toEqual([
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
      // v0.8：Project 链新增两列（scheduleBasis 之后、status 之前）
      'domain',
      'kind',
      'status',
      'revision',
      'updatedAt',
    ]);
  });

  it(`${MAX_STAGE_COUNT} 段项目可落库（解除 9 阶段硬约束）`, async () => {
    const svc = makeService();
    const project = await svc.createManualProject({
      name: '十二段项目',
      type: 'dining' as never,
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-12-31',
      coverColor: null,
      stageItems: getStageLibraryItems().slice(0, MAX_STAGE_COUNT),
    });

    const rows = await bundle.stages.listByProject(project.id);
    expect(rows).toHaveLength(MAX_STAGE_COUNT);
    expect(rows.map((s) => s.orderIndex)).toEqual(
      Array.from({ length: MAX_STAGE_COUNT }, (_, i) => i + 1),
    );
  });

  it(`草稿 0 段 / ${MAX_STAGE_COUNT + 1} 段 → assertDraftsValid 拒绝`, async () => {
    const svc = makeService();
    await expect(
      svc.createProjectFromContract(
        {
          projectName: '空阶段项目',
          projectType: 'dining' as never,
          address: '',
          clientName: '',
          contractAmount: null,
          signedAt: null,
          startAt: '2026-01-01',
          endAt: '2026-12-31',
          stageOverrides: {},
          createdByManual: true,
          sourceFileName: null,
          rawTextDigest: '',
          parsedResultJsonSnapshot: '{}',
        },
        [],
      ),
    ).rejects.toThrowError(/至少选择 1 个阶段/);

    // previewSplit 已在上游拦截超限项，这里手工构造 MAX+1 条草稿验证 service 侧闸门同样生效
    const base = previewSplit({ startAt: '2026-01-01', endAt: '2026-12-31' })[0]!;
    const overLimit = Array.from({ length: MAX_STAGE_COUNT + 1 }, (_, i) => ({
      ...base,
      orderIndex: i + 1,
    }));
    await expect(
      svc.createProjectFromContract(
        {
          projectName: '超限段项目',
          projectType: 'dining' as never,
          address: '',
          clientName: '',
          contractAmount: null,
          signedAt: null,
          startAt: '2026-01-01',
          endAt: '2026-12-31',
          stageOverrides: {},
          createdByManual: true,
          sourceFileName: null,
          rawTextDigest: '',
          parsedResultJsonSnapshot: '{}',
        },
        overLimit,
      ),
    ).rejects.toThrowError(new RegExp(`最多 ${MAX_STAGE_COUNT} 个阶段`));
  });
});

/* ------------------------------ 老数据读时回落（零迁移） ------------------------------ */

describe('stage-subset：老数据（无 templateKey / colorIndex）读时回落', () => {
  it('orderIndex 1..9 → 反查 indoor_full 套餐的 key；越界 → null', () => {
    expect(legacyTemplateKeyOf(1)).toBe('indoor.proposal');
    expect(legacyTemplateKeyOf(6)).toBe('indoor.construction_drawing');
    expect(legacyTemplateKeyOf(9)).toBe('indoor.photography');
    expect(legacyTemplateKeyOf(10)).toBeNull();
    expect(legacyTemplateKeyOf(0)).toBeNull();
  });

  it('colorIndex 缺失 → clamp(orderIndex, 1, 9)，与改造前口径一致', () => {
    expect(legacyColorIndexOf(1)).toBe(1);
    expect(legacyColorIndexOf(9)).toBe(9);
    expect(legacyColorIndexOf(10)).toBe(9);
    expect(legacyColorIndexOf(0)).toBe(1);
    expect(legacyColorIndexOf(-3)).toBe(1);
  });

  it('resolveStageTemplateKey / resolveStageColorIndex：显式值优先，缺失才回落', () => {
    expect(resolveStageTemplateKey(1, 'landscape.survey')).toBe('landscape.survey');
    expect(resolveStageTemplateKey(1, null)).toBe('indoor.proposal');
    expect(resolveStageTemplateKey(1, undefined)).toBe('indoor.proposal');
    expect(resolveStageColorIndex(1, 7)).toBe(7);
    expect(resolveStageColorIndex(1, null)).toBe(1);
    expect(resolveStageColorIndex(1, undefined)).toBe(1);
    // 越界/非法值也回落，杜绝渲染层取到 undefined 色号
    expect(resolveStageColorIndex(3, 99)).toBe(3);
    expect(resolveStageColorIndex(3, 0)).toBe(3);
  });

  it('normalizeStageRow 补齐缺失字段且不改动其余字段（键序保持稳定）', () => {
    const legacy = {
      id: 'stg_legacy_1',
      projectId: 'proj_1',
      orderIndex: 4,
      name: 'SU 建模',
      ratioPercent: 10,
      startAt: '2026-04-01',
      endAt: '2026-04-10',
      status: 'not_started',
      ownerId: null,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-04-01T00:00:00.000Z',
    } as unknown as Parameters<typeof normalizeStageRow>[0];

    const row: Stage = normalizeStageRow(legacy);
    expect(row.templateKey).toBe('indoor.su_model');
    expect(row.colorIndex).toBe(4);
    expect(row.name).toBe('SU 建模');
    expect(row.orderIndex).toBe(4);
    expect(Object.keys(row)).toEqual([
      'id',
      'projectId',
      'orderIndex',
      'templateKey',
      'colorIndex',
      // v0.8：Stage 链新增 customColor（colorIndex 之后、name 之前）
      'customColor',
      'name',
      'ratioPercent',
      'startAt',
      'endAt',
      'status',
      'ownerId',
      'visible',
      'resourcePath',
      'revision',
      'updatedAt',
    ]);
  });
});
