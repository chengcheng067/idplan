/**
 * 建档阶段多选 UI（PRD 11 · 阶段自定义，T8 建档多选）：
 *   1. 纯函数契约：defaultPresetKeyFor（项目类型 → 默认套餐）与 presetKeyOfItems（增删后 → custom）；
 *   2. StageSelectPanel 组件交互：勾选追加 / 取消移除 / ↑↓ 调序 / ✕ 移除 / 套餐整体替换 /
 *      12 项上限 toast / 清空提示 / 项目类型自动预选 / 排期基准切换；
 *   3. 建档路径：UI 选 N 项 → service 落库 N 行；13 项与 0 项被拒。
 *
 * 运行于 jsdom（渲染组件）；建档路径复用 fake-indexeddb（setup.ts 已全局注入）。
 */
// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';

import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { ProjectService } from '../src/core/services/project.service';
import {
  getPresetItems,
  getPresets,
  getStageLibraryItems,
} from '../src/core/template/stage-library';
import { MAX_STAGE_COUNT, MIN_STAGE_COUNT } from '../src/core/template/split';
import {
  defaultPresetKeyFor,
  presetKeyOfItems,
  StageSelectPanel,
} from '../src/components/contract-wizard/StageSelectPanel';
import { ProjectType, ScheduleBasis } from '../src/core/types/enums';
import type { StageTemplateItem } from '../src/core/types/dto';
import { useProjectsStore } from '../src/store/useProjectsStore';

/* ------------------------------ 纯函数契约 ------------------------------ */

describe('defaultPresetKeyFor：项目类型 → 默认套餐（PRD §3.4）', () => {
  it('室内类（餐饮/住宅/办公/茶空间/书店/民宿/零售/室内设计/综合/其他）→ indoor_full', () => {
    const indoorTypes = [
      ProjectType.Dining,
      ProjectType.TeaSpace,
      ProjectType.Bookstore,
      ProjectType.Homestay,
      ProjectType.Retail,
      ProjectType.InteriorDesign,
      ProjectType.Residential,
      ProjectType.Office,
      ProjectType.MixedUse,
      ProjectType.Other,
    ];
    for (const t of indoorTypes) {
      expect(defaultPresetKeyFor(t)).toBe('indoor_full');
    }
  });

  it('景观设计 → landscape_full；建筑设计 → architecture_full', () => {
    expect(defaultPresetKeyFor(ProjectType.LandscapeDesign)).toBe('landscape_full');
    expect(defaultPresetKeyFor(ProjectType.ArchitectureDesign)).toBe('architecture_full');
  });

  it('indoor_full 套餐恰为 9 项（默认行为 = 九段回归锚点）', () => {
    expect(getPresetItems('indoor_full')).toHaveLength(9);
  });
});

describe('presetKeyOfItems：套餐归属推导（AC-09）', () => {
  it('与内置套餐 itemKeys 顺序一致 → 该套餐 key', () => {
    for (const p of getPresets()) {
      expect(presetKeyOfItems(getPresetItems(p.key))).toBe(p.key);
    }
  });

  it('从套餐删去一项 → custom', () => {
    const items = getPresetItems('indoor_full');
    const dropped = items.filter((i) => i.key !== 'indoor.rendering');
    expect(dropped).toHaveLength(8);
    expect(presetKeyOfItems(dropped)).toBe('custom');
  });

  it('调整已选顺序 → custom（顺序敏感）', () => {
    const items = getPresetItems('indoor_full');
    const reordered = [items[1], items[0], ...items.slice(2)];
    expect(presetKeyOfItems(reordered)).toBe('custom');
  });

  it('空集合 → custom', () => {
    expect(presetKeyOfItems([])).toBe('custom');
  });
});

/* ------------------------------ 组件交互（jsdom） ------------------------------ */

/**
 * 受控父容器：state 持有 selected，onChange → setState → 真实重渲染。
 * 这样每次交互后按钮位置/禁用态与实际 DOM 一致（等价真实父组件）。
 */
class Harness extends React.Component<{
  initialSelected: StageTemplateItem[];
  projectType?: ProjectType;
  scheduleBasis?: ScheduleBasis;
  onLatest?(next: StageTemplateItem[]): void;
  onBasisChange?(next: ScheduleBasis): void;
}> {
  state: { selected: StageTemplateItem[]; basis: ScheduleBasis | undefined };

  constructor(props: Harness['props']) {
    super(props);
    this.state = { selected: props.initialSelected, basis: props.scheduleBasis };
  }

  override render(): React.ReactElement {
    return React.createElement(StageSelectPanel, {
      selected: this.state.selected,
      onChange: (next: StageTemplateItem[]) => {
        this.setState({ selected: next });
        this.props.onLatest?.(next);
      },
      projectType: this.props.projectType,
      scheduleBasis: this.state.basis,
      onScheduleBasisChange: this.props.onBasisChange
        ? (b: ScheduleBasis) => {
            this.setState({ basis: b });
            this.props.onBasisChange?.(b);
          }
        : undefined,
    });
  }
}

let root: Root;
let container: HTMLDivElement;
/** 最新一次 onChange 的快照（断言用） */
let latest: StageTemplateItem[];

beforeEach(() => {
  useProjectsStore.setState({ toasts: [] });
  latest = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.removeChild(container);
  useProjectsStore.setState({ toasts: [] });
});

async function mountHarness(props: {
  initialSelected: StageTemplateItem[];
  projectType?: ProjectType;
  scheduleBasis?: ScheduleBasis;
  onBasisChange?: (next: ScheduleBasis) => void;
}): Promise<void> {
  await act(async () => {
    root.render(
      React.createElement(Harness, {
        initialSelected: props.initialSelected,
        projectType: props.projectType,
        scheduleBasis: props.scheduleBasis,
        onLatest: (n) => (latest = n),
        onBasisChange: props.onBasisChange,
      }),
    );
  });
}

/** 按 aria-label 查按钮 */
function btn(label: string): HTMLButtonElement {
  const el = container.querySelector(`button[aria-label="${label}"]`);
  if (!el) {
    throw new Error(`未找到按钮：${label}`);
  }
  return el as HTMLButtonElement;
}

/** 点击并 flush React 更新 */
async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
}

describe('StageSelectPanel：套餐 / 阶段池 / 已选列表', () => {
  it(`默认预选 indoor_full 时，已选列表渲染 9 行，头部显示「已选 9 / 上限 ${MAX_STAGE_COUNT}」`, async () => {
    const items = getPresetItems('indoor_full');
    await mountHarness({ initialSelected: items });
    const rows = container.querySelectorAll('[data-testid^="selected-row-"]');
    expect(rows).toHaveLength(9);
    expect(container.textContent).toContain(`已选 9 / 上限 ${MAX_STAGE_COUNT}`);
  });

  it('阶段池渲染全部模板项（按 domain 分组，室内/景观/建筑齐全）', async () => {
    await mountHarness({ initialSelected: [] });
    for (const item of getStageLibraryItems()) {
      expect(container.textContent).toContain(item.name);
    }
    expect(container.textContent).toContain('室内');
    expect(container.textContent).toContain('景观');
    expect(container.textContent).toContain('建筑');
  });

  it('勾选池中新项 → 追加到已选末尾', async () => {
    const items = getPresetItems('indoor_concept'); // 5 项
    await mountHarness({ initialSelected: items });
    await click(btn('选择阶段 施工图深化'));
    expect(latest).toHaveLength(6);
    expect(latest[5]!.key).toBe('indoor.construction_drawing');
  });

  it('取消勾选已选项 → 从已选列表移除', async () => {
    const items = getPresetItems('indoor_full');
    await mountHarness({ initialSelected: items });
    await click(btn('取消选择阶段 提案'));
    expect(latest).toHaveLength(8);
    expect(latest.some((i) => i.key === 'indoor.proposal')).toBe(false);
  });

  it('已选列表 ✕ 移除 → 后继项前移补位', async () => {
    const items = getPresetItems('indoor_full');
    await mountHarness({ initialSelected: items });
    await click(btn('移除 提案'));
    expect(latest).toHaveLength(8);
    expect(latest[0]!.key).toBe('indoor.measure');
  });

  it('↑ 上移 / ↓ 下移 调序 → 顺序即最终 orderIndex', async () => {
    const items = getPresetItems('indoor_full');
    await mountHarness({ initialSelected: items });
    await click(btn('上移 测量'));
    expect(latest[0]!.key).toBe('indoor.measure');
    expect(latest[1]!.key).toBe('indoor.proposal');
    await click(btn('下移 测量'));
    expect(latest[0]!.key).toBe('indoor.proposal');
    expect(latest[1]!.key).toBe('indoor.measure');
  });

  it('点击套餐按钮 → 整体替换为套餐集合，归属为该套餐 key', async () => {
    const items = getPresetItems('indoor_full');
    await mountHarness({ initialSelected: items });
    await click(btn('套餐 室内·方案止（含效果图）'));
    expect(latest.map((i) => i.key)).toEqual(getPresetItems('indoor_concept').map((i) => i.key));
    expect(presetKeyOfItems(latest)).toBe('indoor_concept');
  });
});

describe(`StageSelectPanel：边界（下限 1 / 上限 ${MAX_STAGE_COUNT}）`, () => {
  it('清空全部 → 行内提示「至少选择 1 个阶段」', async () => {
    await mountHarness({ initialSelected: [] });
    expect(container.textContent).toContain(`至少选择 ${MIN_STAGE_COUNT} 个阶段`);
  });

  it(`达到上限 ${MAX_STAGE_COUNT} 项后点击未选项 → 拒绝勾选并 toast`, async () => {
    const pool = getStageLibraryItems();
    const selected = pool.slice(0, MAX_STAGE_COUNT);
    await mountHarness({ initialSelected: selected });
    // mount 不触发 onChange，快照对齐初始选择
    latest = selected;
    // 未选中的下一个阶段标记 aria-disabled（点击被拒并 toast）
    const nextBtn = btn(`选择阶段 ${pool[MAX_STAGE_COUNT]!.name}`);
    expect(nextBtn.getAttribute('aria-disabled')).toBe('true');
    await click(nextBtn);
    expect(latest).toHaveLength(MAX_STAGE_COUNT); // 未接受
    expect(
      useProjectsStore
        .getState()
        .toasts.some((t) => t.kind === 'error' && t.message === `单次项目最多 ${MAX_STAGE_COUNT} 个阶段`),
    ).toBe(true);
  });

  it(`达到上限后取消勾选已选项仍可用（可降到 ${MAX_STAGE_COUNT - 1} 项）`, async () => {
    const pool = getStageLibraryItems();
    const selected = pool.slice(0, MAX_STAGE_COUNT);
    await mountHarness({ initialSelected: selected });
    await click(btn(`取消选择阶段 ${pool[0]!.name}`));
    expect(latest).toHaveLength(MAX_STAGE_COUNT - 1);
  });
});

describe('StageSelectPanel：项目类型自动预选（PRD §3.2.2）', () => {
  it('projectType 变化且未手动改过 → 自动预选对应套餐', async () => {
    const full = getPresetItems('indoor_full');
    await mountHarness({ initialSelected: full, projectType: ProjectType.Dining });
    await act(async () => {
      root.render(
        React.createElement(Harness, {
          initialSelected: latest.length ? latest : full,
          projectType: ProjectType.LandscapeDesign,
          onLatest: (n) => (latest = n),
        }),
      );
    });
    expect(latest.map((i) => i.key)).toEqual(
      getPresetItems('landscape_full').map((i) => i.key),
    );
  });

  it('用户手动改过阶段选择后 projectType 变化 → 不再自动覆盖', async () => {
    const full = getPresetItems('indoor_full');
    await mountHarness({ initialSelected: full, projectType: ProjectType.Dining });
    // 手动取消一项 → dirty
    await click(btn('取消选择阶段 提案'));
    expect(latest).toHaveLength(8);
    // 类型变化不再自动覆盖
    await act(async () => {
      root.render(
        React.createElement(Harness, {
          initialSelected: latest,
          projectType: ProjectType.LandscapeDesign,
          onLatest: (n) => (latest = n),
        }),
      );
    });
    expect(latest).toHaveLength(8);
  });
});

describe('StageSelectPanel：排期基准切换（自然日 / 工作日）', () => {
  it('默认自然日；点「按工作日」→ 回调收到 workday', async () => {
    let basis: ScheduleBasis = ScheduleBasis.Calendar;
    await mountHarness({
      initialSelected: [],
      scheduleBasis: basis,
      onBasisChange: (b) => (basis = b),
    });
    await click(btn('排期基准 按工作日'));
    expect(basis).toBe(ScheduleBasis.Workday);
  });
});

/* ------------------------------ 建档路径：UI 选择 → 落库 ------------------------------ */

async function freshBundle(): Promise<IRepositoryBundle> {
  const bundle = await createRepositories({ dataSource: 'local' });
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
  return bundle;
}

describe('建档路径：所选阶段数决定落库阶段数', () => {
  it('选 3 项 → 建档后该项目只有 3 个阶段，套餐归属 custom', async () => {
    const bundle = await freshBundle();
    const svc = new ProjectService({ projects: bundle.projects, bundle });
    const items = getPresetItems('indoor_concept').slice(0, 3);
    const project = await svc.createManualProject({
      name: '三阶段项目',
      type: ProjectType.Dining,
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-05-29',
      coverColor: null,
      stageItems: items,
      stagePresetKey: presetKeyOfItems(items),
    });
    const rows = await bundle.stages.listByProject(project.id);
    expect(rows).toHaveLength(3);
    expect(rows.map((s) => s.orderIndex)).toEqual([1, 2, 3]);
    expect(project.stagePresetKey).toBe('custom');
  });

  it('选 1 项 → 建档后该项目只有 1 个阶段，占满整个工期', async () => {
    const bundle = await freshBundle();
    const svc = new ProjectService({ projects: bundle.projects, bundle });
    const items = [getStageLibraryItems()[0]!];
    const project = await svc.createManualProject({
      name: '单阶段项目',
      type: ProjectType.Residential,
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-03-31',
      coverColor: null,
      stageItems: items,
      stagePresetKey: presetKeyOfItems(items),
    });
    const rows = await bundle.stages.listByProject(project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startAt).toBe('2026-01-01');
    expect(rows[0]!.endAt).toBe('2026-03-31');
  });

  it(`选 ${MAX_STAGE_COUNT + 1} 项被拒（超出上限）`, async () => {
    const bundle = await freshBundle();
    const svc = new ProjectService({ projects: bundle.projects, bundle });
    const pool = getStageLibraryItems();
    const tooMany = Array.from({ length: MAX_STAGE_COUNT + 1 }, (_, i) => pool[i % pool.length]!);
    await expect(
      svc.createManualProject({
        name: '超限段项目',
        type: ProjectType.Dining,
        address: '',
        clientName: '',
        contractAmount: null,
        signedAt: null,
        plannedStartAt: '2026-01-01',
        plannedEndAt: '2026-12-31',
        coverColor: null,
        stageItems: tooMany,
      }),
    ).rejects.toThrowError(new RegExp(`最多 ${MAX_STAGE_COUNT} 个阶段`));
  });

  it('清空被拒（0 项）', async () => {
    const bundle = await freshBundle();
    const svc = new ProjectService({ projects: bundle.projects, bundle });
    await expect(
      svc.createManualProject({
        name: '空阶段项目',
        type: ProjectType.Dining,
        address: '',
        clientName: '',
        contractAmount: null,
        signedAt: null,
        plannedStartAt: '2026-01-01',
        plannedEndAt: '2026-03-31',
        coverColor: null,
        stageItems: [],
      }),
    ).rejects.toThrowError(/至少选择 1 个阶段/);
  });

  it('手动建档不传 stageItems → 默认产出九段（与改造前一致）', async () => {
    const bundle = await freshBundle();
    const svc = new ProjectService({ projects: bundle.projects, bundle });
    const project = await svc.createManualProject({
      name: '默认九段项目',
      type: ProjectType.Dining,
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-06-08',
      coverColor: null,
    });
    expect(project.stagePresetKey).toBe('indoor_full');
    const rows = await bundle.stages.listByProject(project.id);
    expect(rows).toHaveLength(9);
  });
});
