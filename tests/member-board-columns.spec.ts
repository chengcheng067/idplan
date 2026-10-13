/**
 * 成员看板「列集合不得随可见项目子集漂移」——纯函数回归闸（0.9.x）。
 *
 * 用户原话：「我进入了朴彩英的看板，为什么下面的排版会变成 3 列排版啊？管理员都是 4 列」
 * 根因（已修）：`groupByColumn` 原先用**传进来的（已过滤的）项目列表**派生列集合，
 * 于是「同一块板，看谁就换列」——列集合成了「该成员恰好参与了哪些项目」的函数。
 * 修法：列集合来源改成**板级宇宙**（成员看板传全部 active 人类项目），分桶才用过滤后的列表。
 *
 * ── 为什么这条必须与真 Chromium spec（member-board-column-consistency.spec.ts）同时存在 ──
 *   · 本文件锁**语义**：列集合对筛选不变、分桶仍严格只用传入列表、落列不走出兜底；
 *   · 那份 spec 锁**几何**：两用例的解析后轨道列表逐项相等。
 *   只锁几何的话，「列集合漂移了但恰好同宽」仍会绿；只锁语义的话，几何漂移（宽度差）
 *   不会被发现。两条互补，缺一即漏一类回归。
 *
 * 本文件是纯函数单测（jsdom/node，无浏览器、无构建产物依赖）。
 */
import { describe, it, expect } from 'vitest';

import { deriveColumns, groupByColumn } from '../src/pages/HomePage';
import { ScheduleBasis, ProjectStatus, StageStatus } from '../src/core/types/enums';
import type { Project, Stage } from '../src/core/types/entities';

/** 固定的"今天"（用例幂等可重放） */
const TODAY = '2026-09-03';

function makeProject(
  over: Partial<Project> & Pick<Project, 'id' | 'name' | 'stagePresetKey' | 'domain'>,
): Project {
  return {
    address: '示例地址',
    clientName: '示例客户',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-09-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
    shortLabel: null,
    stageTemplateVersion: 3,
    scheduleBasis: ScheduleBasis.Calendar,
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ownerMemberId: null,
    kind: 'human',
    ...over,
  } as Project;
}

/** 一条「进行中」阶段：区间覆盖 TODAY，模板项决定落哪一列 */
function makeStage(projectId: string, id: string, templateKey: string, ownerId: string): Stage {
  return {
    id,
    projectId,
    orderIndex: 1,
    templateKey,
    colorIndex: 1,
    customColor: null,
    name: '示例阶段',
    ratioPercent: 100,
    startAt: '2026-09-01',
    endAt: '2026-12-31',
    status: StageStatus.InProgress,
    ownerId,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as Stage;
}

/*
  板级宇宙（夹具）＝ 室内 + 软件 两个项目 ⇒ 列集合应为
    待启动 / 设计中 / 深化中 / 施工中（室内 3） / 规划中 / 设计中 / 开发中 / 验证中 / 已发布（软件 5）
  成员子集（夹具）＝ 只参与室内那一个项目 ⇒ 修复前列集合只剩「待启动 + 室内 3」= 4 列。
*/
const INDOOR = makeProject({
  id: 'proj_indoor',
  name: '演示项目1',
  stagePresetKey: 'indoor_full',
  domain: 'indoor',
});
const SOFTWARE = makeProject({
  id: 'proj_software',
  name: '演示项目2',
  stagePresetKey: 'software_mobile_full',
  domain: 'software',
});
const UNIVERSE = [INDOOR, SOFTWARE];

const STAGES: Stage[] = [
  makeStage(INDOOR.id, 'st_indoor_1', 'indoor.proposal', 'm-rose'),
  makeStage(SOFTWARE.id, 'st_soft_1', 'software.dev', 'm-admin'),
];
const stagesOf = (p: Project): Stage[] => STAGES.filter((s) => s.projectId === p.id);

describe('成员看板 · 列集合对「可见项目子集」不变（groupByColumn 入参契约）', () => {
  it('C-01 · 同一板级宇宙下，子集不同也给出**逐项相同**的列集合（列数与 label 全等）', () => {
    const full = groupByColumn(UNIVERSE, UNIVERSE, stagesOf, TODAY);
    const subset = groupByColumn([INDOOR], UNIVERSE, stagesOf, TODAY);
    const otherSubset = groupByColumn([SOFTWARE], UNIVERSE, stagesOf, TODAY);

    expect(subset.columns.map((c) => c.label)).toEqual(full.columns.map((c) => c.label));
    expect(otherSubset.columns.map((c) => c.label)).toEqual(full.columns.map((c) => c.label));
    // 列键序也必须逐项一致（顺序变了同样是"排版不一样"）
    expect(subset.columns.map((c) => c.key)).toEqual(full.columns.map((c) => c.key));
  });

  it('C-02 · 子集里没有软件项目，板上**仍有**软件列（列是板的属性，不是可见项目的函数）', () => {
    const subset = groupByColumn([INDOOR], UNIVERSE, stagesOf, TODAY);
    const keys = subset.columns.map((c) => c.key);
    const labels = subset.columns.map((c) => c.label);

    // 室内列（有效项目落在这里）
    expect(keys).toContain('design');
    // 软件列（这一侧一个可见项目都没有，仍必须在板上）
    expect(keys).toContain('developing');
    expect(keys).toContain('released');
    expect(labels).toEqual(
      expect.arrayContaining(['待启动', '设计中', '深化中', '施工中', '开发中', '已发布']),
    );
    // 空列存在且为空（不是"被藏掉"）
    expect(subset.buckets.developing).toEqual([]);
    expect(subset.buckets.released).toEqual([]);
  });

  it('C-03 · 分桶**仍只用**传入的列表：子集外的项目不得混进任何列', () => {
    const subset = groupByColumn([INDOOR], UNIVERSE, stagesOf, TODAY);
    const allBucketed = Object.values(subset.buckets).flat();
    expect(allBucketed.map((p) => p.id)).toEqual([INDOOR.id]);
    // 反向对照：传全集时分桶里也应有全集（证明不是"永远只分一个"）
    const full = groupByColumn(UNIVERSE, UNIVERSE, stagesOf, TODAY);
    expect(Object.values(full.buckets).flat().length).toBe(UNIVERSE.length);
  });

  it('C-04 · 落列口径与 deriveColumns 同源：每个项目都落在**已存在**的列里（不触底兜底）', () => {
    const subset = groupByColumn([INDOOR], UNIVERSE, stagesOf, TODAY);
    const columnKeys = new Set(subset.columns.map((c) => c.key));
    for (const p of [INDOOR, SOFTWARE]) {
      // 室内项目落 'design'（室内模板 item 声明的 kanbanColumn），软件项目落 'developing'
      const landed = Object.entries(subset.buckets).filter(([, rows]) => rows.some((x) => x.id === p.id));
      for (const [key] of landed) expect(columnKeys.has(key), `${p.id} 落在不存在的列 ${key}`).toBe(true);
    }
    // 软硬件两个项目的落列键都与各自模板声明一致（同源证据：都读 effectiveDomainOf + templateKey）
    expect(subset.buckets.design.map((p) => p.id)).toEqual([INDOOR.id]);
    expect(deriveColumns(UNIVERSE).map((c) => c.key)).toEqual(subset.columns.map((c) => c.key));
  });

  it('C-05 · 反例自证（修复前的形态）：列集合若从**过滤后的列表**派生，就会漂移', () => {
    // 这是"病灶"的直接刻画：把 columnSource 换成子集 ⇒ 列集合立刻缩水。
    // 本用例钉住"这条退化路径是可被观测的"，防止有人把 groupByColumn 再改回单参数。
    const drifted = groupByColumn([INDOOR], [INDOOR], stagesOf, TODAY);
    const stable = groupByColumn([INDOOR], UNIVERSE, stagesOf, TODAY);
    expect(drifted.columns.length).toBeLessThan(stable.columns.length);
    expect(drifted.columns.map((c) => c.label)).not.toEqual(stable.columns.map((c) => c.label));
  });
});
