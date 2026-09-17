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
  getDomainColumns,
  getPresetItems,
  getPresets,
  getPresetsByDomain,
  getStageLibraryItems,
} from '../src/core/template/stage-library';
import { MAX_STAGE_COUNT, MIN_STAGE_COUNT } from '../src/core/template/split';
import {
  defaultPresetKeyForDomain,
  presetKeyOfItems,
  StageSelectPanel,
} from '../src/components/contract-wizard/StageSelectPanel';
import { ScheduleBasis } from '../src/core/types/enums';
import type { StageTemplateDomain, StageTemplateItem } from '../src/core/types/dto';
import { useProjectsStore } from '../src/store/useProjectsStore';

/* ------------------------------ 纯函数契约 ------------------------------ */

describe('defaultPresetKeyForDomain：主板块 → 默认套餐（迁移「类型」职能，PRD §3.4）', () => {
  it('室内 / 展陈 / 未指定 → indoor_full', () => {
    const indoorLike: Array<StageTemplateDomain | null | undefined> = [
      'indoor',
      'exhibition',
      null,
      undefined,
    ];
    for (const d of indoorLike) {
      expect(defaultPresetKeyForDomain(d)).toBe('indoor_full');
    }
  });

  it('景观 → landscape_full；建筑 → architecture_full；软件 → software_full；活动 → marketing_full；影视 → film_full；婚礼 → wedding_full；咨询 → consulting_full', () => {
    expect(defaultPresetKeyForDomain('landscape')).toBe('landscape_full');
    expect(defaultPresetKeyForDomain('architecture')).toBe('architecture_full');
    expect(defaultPresetKeyForDomain('software')).toBe('software_full');
    expect(defaultPresetKeyForDomain('marketing')).toBe('marketing_full');
    expect(defaultPresetKeyForDomain('film')).toBe('film_full');
    expect(defaultPresetKeyForDomain('wedding')).toBe('wedding_full');
    expect(defaultPresetKeyForDomain('consulting')).toBe('consulting_full');
    expect(defaultPresetKeyForDomain('travel')).toBe('travel_fit');
  });

  it('indoor_full 套餐恰为 9 项（默认行为 = 九段回归锚点）', () => {
    expect(getPresetItems('indoor_full')).toHaveLength(9);
  });

  it('旅游模板固定为 4 列、7 阶段、3 套套餐，且引用与列归属均有效', () => {
    const columns = getDomainColumns('travel');
    const columnKeys = new Set(columns.map((column) => column.key));
    const items = getStageLibraryItems().filter((item) => item.domain === 'travel');
    const itemKeys = new Set(items.map((item) => item.key));
    const presets = getPresetsByDomain('travel');

    expect(columns).toHaveLength(4);
    expect(items).toHaveLength(7);
    expect(presets.map((preset) => preset.key)).toEqual([
      'travel_fit',
      'travel_group',
      'travel_business',
    ]);
    expect(items.every((item) => columnKeys.has(item.kanbanColumn))).toBe(true);
    expect(presets.every((preset) => preset.itemKeys.every((key) => itemKeys.has(key)))).toBe(true);
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
  domain?: StageTemplateDomain | null;
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
      domain: this.props.domain,
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
  domain?: StageTemplateDomain | null;
  scheduleBasis?: ScheduleBasis;
  onBasisChange?: (next: ScheduleBasis) => void;
}): Promise<void> {
  await act(async () => {
    root.render(
      React.createElement(Harness, {
        initialSelected: props.initialSelected,
        domain: props.domain,
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

/**
 * ★ 本组锁的是「**切换主板块绝不覆盖已选阶段**」（验收 A5）。
 *
 * ── 为什么这条必须由测试钉住 ──
 * v0.8 的「自动预选套餐」是按**已删除的 `Project.type`** 触发的 —— 类型是弹窗外的独立字段，
 * 用户改它本来就是要重选阶段，覆盖合理。但「类型」删除后若把触发字段换成 `domain`，
 * 就会踩中真实伤害：**主板块是用户在本表单里反复改的字段**，改成「婚礼」的瞬间，
 * 已选的九段室内阶段被静默换成两段婚礼阶段，用户前面挑的东西凭空消失。
 * 这与 `tests/v08-stage-wizard.spec.tsx:407`「切换主板块后已选阶段不丢」直接冲突
 * —— 两条不可能同时成立，以既有 A5 为准。
 *
 * 现在的正路：预选只发生在
 *   ① 打开表单的**初始值**（调用方按主板块给，见 `ManualFallbackForm` 的 `useState` 初值）；
 *   ② 用户**显式点击**按主板块过滤出的套餐胶囊。
 * 即**永不发生在「用户改主板块」的那一刻**。
 */
describe('StageSelectPanel：切换主板块不覆盖已选（验收 A5）', () => {
  it('domain 变化且**未**手动改过 → 已选阶段原样保留（不得自动预选）', async () => {
    const full = getPresetItems('indoor_full');
    await mountHarness({ initialSelected: full, domain: 'indoor' });
    // 首帧不触发 onChange，故 latest 为空 —— 这本身就是「未覆盖」的基线
    expect(latest).toHaveLength(0);

    await act(async () => {
      root.render(
        React.createElement(Harness, {
          initialSelected: full,
          domain: 'landscape',
          onLatest: (n) => (latest = n),
        }),
      );
    });

    // ① 切换主板块**不得**触发 onChange（触发即意味着要替换已选）
    expect(latest).toHaveLength(0);
    // ② 且绝不能被换成 landscape_full
    expect(latest.map((i) => i.key)).not.toEqual(
      getPresetItems('landscape_full').map((i) => i.key),
    );
  });

  it('用户手动改过阶段选择后 domain 变化 → 同样保留（不自作主张补回）', async () => {
    const full = getPresetItems('indoor_full');
    await mountHarness({ initialSelected: full, domain: 'indoor' });
    // 手动取消一项
    await click(btn('取消选择阶段 提案'));
    expect(latest).toHaveLength(8);
    // 主板块变化不得覆盖
    await act(async () => {
      root.render(
        React.createElement(Harness, {
          initialSelected: latest,
          domain: 'landscape',
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
