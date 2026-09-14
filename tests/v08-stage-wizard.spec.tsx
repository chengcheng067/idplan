// @vitest-environment jsdom
/**
 * v0.8 · T03 验收（一）：建档三层筛选 ＋ 阶段池 ＋ 自定义阶段弹窗（jsdom 层）。
 *
 * 覆盖设计 §8 T03 的验收 1–5、7、9（验收 6/8/10/11 在
 * `v08-custom-stage.spec.ts`，那里才需要真 Dexie / 备份往返）：
 *
 *   1. 选「建筑设计行业」→ 可见分组恰 **3**；「婚礼策划」→ 恰 **1**；展开「其他行业」→ **8**；
 *   2. 不点第 1 层也能在第 2 层直接选到「室内」；5 个一级平铺板块选中后**不出现**第 2 层；
 *   3. 主板块＝室内 → 套餐恰 **4**；＝婚礼 → 恰 **2**；切换主板块后**已选阶段不丢**；
 *   4. 主板块＝室内 ＋ 关联《影视制作》→ 可见 **4** 个分组，且同大类内无重复勾选项；
 *   5. 上限 20：大类伞池（22 项）选满 20 → 允许；第 21 项 → 拒绝并 toast；
 *      单板块池（室内 9 项）→ **可见恰 9 项 ⇒ 20 在单板块内不可达**（设计 §1.3）；
 *   7. 重名 → 行内提示（`duplicate-stage-names`）＋ 弹窗阻止提交；
 *   9. 标签/板块为空也能提交（`domain === null` 的路径可用，不报错、不阻塞）。
 *
 * 只依赖 react-dom/client 原生渲染（与仓库既有组件测同款，不引 testing-library）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import {
  CustomStageDialog,
  type CustomStageDraft,
} from '../src/components/contract-wizard/CustomStageDialog';
import {
  DEFAULT_DOMAIN_CASCADE,
  DomainCascade,
  groupKeyOfDomain,
  visibleDomainsOf,
  type DomainCascadeValue,
} from '../src/components/contract-wizard/DomainCascade';
import {
  StageSelectPanel,
  duplicateStageNames,
} from '../src/components/contract-wizard/StageSelectPanel';
import {
  getItemsByDomains,
  getPresetsByDomain,
  getUsableDomains,
} from '../src/core/template/stage-library';
import { MAX_STAGE_COUNT } from '../src/core/template/split';
import type {
  StageSelectionItem,
  StageTemplateDomain,
  StageTemplateItem,
} from '../src/core/types/dto';
import { useProjectsStore } from '../src/store/useProjectsStore';

/* ------------------------------ 渲染脚手架 ------------------------------ */

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  useProjectsStore.setState({ toasts: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.removeChild(container);
  useProjectsStore.setState({ toasts: [] });
});

/** 按 aria-label 查按钮（查 `document`：Modal 走 createPortal，弹窗内容不在 container 里） */
function btn(label: string): HTMLButtonElement {
  const el = document.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`未找到按钮：${label}`);
  return el as HTMLButtonElement;
}

/** 按 testid 查元素（同样查 `document`，兼容弹窗） */
function byTestId(testId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testId}"]`);
}

/** 受控输入：用原生 setter 触发 React 的 onChange（React 受控值缓存的常见绕法） */
async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
}

/**
 * 把**未经控件规范化**的原始串塞进受控输入，用于验证「控件吐出脏值」这一防御分支。
 *
 * 为什么不能复用 `setInputValue`：`<input type="color">` 会把非法值规范化成 `'#000000'`
 * （浏览器与 jsdom 同此行为），常规 value setter 复现不出「拿到 'not-a-color'」的场景。
 * 这里临时把 `value` 取值器替换成原样返回 `raw`，从而真正走到消费方的校验分支；
 * 同时留一个空 setter，避免 React 受控值回写时抛「给只读访问器赋值」。
 */
async function setRawInputValue(input: HTMLInputElement, raw: string): Promise<void> {
  await act(async () => {
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => raw,
      set: () => undefined,
    });
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** 阶段池里**模板分组**的个数（自定义阶段分组用 `custom-stage-group`，不在此列） */
function poolGroupCount(): number {
  return container.querySelectorAll('[data-testid^="pool-group-"]').length;
}

/** 阶段池分组 key 列表（用于断言「是哪几个分组」而不只是「有几个」） */
function poolGroups(): string[] {
  return [...container.querySelectorAll('[data-testid^="pool-group-"]')].map((el) =>
    (el.getAttribute('data-testid') ?? '').replace('pool-group-', ''),
  );
}

function presetCount(): number {
  return container.querySelectorAll('button[aria-label^="套餐 "]').length;
}

/* ------------------------- ① DomainCascade（三层级联） ------------------------- */

/** 受控外壳：state 持有级联值，onChange → setState → 真实重渲染 */
function CascadeHarness({ initial }: { initial?: DomainCascadeValue }): JSX.Element {
  const [value, setValue] = React.useState<DomainCascadeValue>(initial ?? DEFAULT_DOMAIN_CASCADE);
  return <DomainCascade value={value} onChange={setValue} />;
}

describe('DomainCascade：第 1 层 / 第 2 层 / 第 3 层', () => {
  it('第 1 层恰 6 项：1 个伞形大类「建筑设计行业」＋ 5 个一级平铺板块', async () => {
    await act(async () => root.render(<CascadeHarness />));
    const layer1 = [...container.querySelectorAll('button[aria-label^="行业 "]')];
    expect(layer1).toHaveLength(6);
    expect(layer1.map((b) => b.getAttribute('aria-label'))).toEqual([
      '行业 建筑设计行业',
      '行业 软件开发',
      '行业 市场活动',
      '行业 影视制作',
      '行业 婚礼策划',
      '行业 咨询交付',
    ]);
  });

  it('默认 = 建筑设计行业 / 室内（PRD A2），池子范围恰 3 个板块', async () => {
    await act(async () => root.render(<CascadeHarness />));
    expect(visibleDomainsOf(DEFAULT_DOMAIN_CASCADE)).toEqual(['architecture', 'landscape', 'indoor']);
    expect(container.querySelector('[data-testid="domain-cascade-visible-domains"]')?.textContent).toContain(
      '建筑 / 景观 / 室内',
    );
  });

  it('A1：选「婚礼策划」（一级平铺）→ 第 2 层**不出现**，可见分组恰 1', async () => {
    await act(async () => root.render(<CascadeHarness />));
    await click(btn('行业 婚礼策划'));
    expect(container.querySelector('[data-testid="domain-cascade-layer2"]')).toBeNull();
    expect(container.querySelector('[data-testid="domain-cascade-layer3"]')).toBeNull();
    expect(container.querySelector('[data-testid="domain-cascade-visible-domains"]')?.textContent).toContain(
      '婚礼',
    );
  });

  it('A1：5 个一级平铺板块**逐个点过**都不出现第 2 层', async () => {
    await act(async () => root.render(<CascadeHarness />));
    for (const name of ['软件开发', '市场活动', '影视制作', '婚礼策划', '咨询交付']) {
      await click(btn(`行业 ${name}`));
      expect(container.querySelector('[data-testid="domain-cascade-layer2"]')).toBeNull();
    }
    // 回到伞形大类 → 第 2 层回来
    await click(btn('行业 建筑设计行业'));
    expect(container.querySelector('[data-testid="domain-cascade-layer2"]')).not.toBeNull();
  });

  it('A2：不点第 1 层也能在第 2 层直接选到「室内」（下拉恒列全部 8 个板块，按大类 optgroup 分组）', async () => {
    // 未点任何第 1 层：级联值为空，第 2 层仍需可达 → 用「已选大类但未选主板块」的真实入口验证
    await act(async () => root.render(<CascadeHarness initial={{ groupKey: 'space', domain: null, relatedDomains: [] }} />));
    const select = container.querySelector('select[aria-label="主板块"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = [...select.querySelectorAll('option')].map((o) => o.getAttribute('value'));
    // 空值项（不指定板块）+ 全部 8 个可用板块
    expect(options).toEqual(['', ...getUsableDomains()]);
    // optgroup：6 个大类分组（每个大类只挂自己的板块）
    const groups = [...select.querySelectorAll('optgroup')].map((g) => g.getAttribute('label'));
    expect(groups).toEqual(['建筑设计行业', '软件开发', '市场活动', '影视制作', '婚礼策划', '咨询交付']);

    // 直接选「室内」→ 生效（不依赖第 1 层先点过）
    await act(async () => {
      select.value = 'indoor';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="domain-cascade-visible-domains"]')?.textContent).toContain(
      '室内',
    );
  });

  it('A2：第 2 层选到「室内」→ 第 1 层**同步**成它所属大类（否则池子范围与主板块自相矛盾）', async () => {
    await act(async () => root.render(<CascadeHarness initial={{ groupKey: 'wedding', domain: 'wedding', relatedDomains: [] }} />));
    // 婚礼是一级平铺 → 无第 2 层；改回伞形大类再验证同步
    await click(btn('行业 建筑设计行业'));
    const select = container.querySelector('select[aria-label="主板块"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'landscape';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(groupKeyOfDomain('landscape')).toBe('space');
    expect(container.querySelector('[data-testid="domain-cascade-visible-domains"]')?.textContent).toContain(
      '建筑 / 景观 / 室内',
    );
  });

  it('A4：第 3 层候选**排除本大类**（同大类内不出现重复勾选项）', async () => {
    await act(async () => root.render(<CascadeHarness />));
    const related = [...container.querySelectorAll('button[aria-label^="关联板块 "]')].map((b) =>
      b.getAttribute('aria-label'),
    );
    // 本大类是 space(建筑/景观/室内) → 候选里不该出现这三个
    for (const label of ['关联板块 建筑', '关联板块 景观', '关联板块 室内']) {
      expect(related).not.toContain(label);
    }
    expect(related).toContain('关联板块 影视');
  });
});

/* ------------------------- ② StageSelectPanel（阶段池） ------------------------- */

/** 受控外壳：state 持有已选，onChange → setState → 真实重渲染 */
function PanelHarness(props: {
  initialSelected: StageSelectionItem[];
  domain?: StageTemplateDomain | null;
  visibleDomains?: StageTemplateDomain[];
  customStages?: StageSelectionItem[];
  onCustomStageSubmit?(draft: CustomStageDraft): void;
  onLatest?(next: StageSelectionItem[]): void;
}): JSX.Element {
  const [selected, setSelected] = React.useState<StageSelectionItem[]>(props.initialSelected);
  const [custom, setCustom] = React.useState<StageSelectionItem[]>(props.customStages ?? []);
  return (
    <StageSelectPanel
      selected={selected}
      onChange={(next) => {
        setSelected(next);
        props.onLatest?.(next);
      }}
      domain={props.domain}
      visibleDomains={props.visibleDomains}
      customStages={custom}
      onCustomStageSubmit={
        props.onCustomStageSubmit
          ? (draft) => {
              props.onCustomStageSubmit?.(draft);
              // 与两条真实建档路径（向导 / 手动兜底）同款：新加的项追加到已选末尾
              const item: StageSelectionItem = {
                key: `cst.${draft.name}`,
                name: draft.name,
                domain: 'indoor',
                ratioPercent: draft.ratioPercent ?? 5,
                colorIndex: draft.colorIndex,
                kanbanColumn: 'design',
                defaultResponsibility: '',
                defaultTasks: [],
                customColor: draft.customColor,
              };
              setCustom((prev) => [...prev, item]);
              setSelected((prev) => [...prev, item]);
            }
          : undefined
      }
    />
  );
}

const SPACE_DOMAINS: StageTemplateDomain[] = ['architecture', 'landscape', 'indoor'];

/**
 * 池中项目的**渲染顺序**（＝ DOM 顺序：先按板块声明序、板块内按库序）。
 *
 * 为什么不能直接用 `getItemsByDomains(...)` 的顺序去 `btn('选择阶段 X')`：
 * 该函数按 **JSON 声明顺序**返回，而池子按**板块声明顺序**分组渲染，两者不同；
 * 模板库里存在跨板块同名项（如「概念方案」在景观与建筑各有一条），
 * 顺序不一致时 `btn(name)` 会命中**另一条**同名项 —— 测试会以一种极难察觉的方式假绿/假红。
 */
function poolItemsInRenderOrder(domains: StageTemplateDomain[]): StageTemplateItem[] {
  const items = getItemsByDomains(domains);
  return getUsableDomains()
    .filter((d) => domains.includes(d))
    .flatMap((d) => items.filter((i) => i.domain === d));
}

/** 按渲染顺序取前 N 个**同名唯一**项（模板库里有 3 组跨板块重名，A9 下不能直接混用） */
function uniqueNamedPool(domains: StageTemplateDomain[]): StageTemplateItem[] {
  const pool = poolItemsInRenderOrder(domains);
  return pool.filter((item, i) => pool.findIndex((x) => x.name === item.name) === i);
}

describe('StageSelectPanel：可见分组（A1/A6）', () => {
  it('选「建筑设计行业」（可见板块 = 建筑/景观/室内）→ 可见分组恰 3 个', async () => {
    await act(async () =>
      root.render(<PanelHarness initialSelected={[]} visibleDomains={SPACE_DOMAINS} domain="indoor" />),
    );
    expect(poolGroupCount()).toBe(3);
    expect(poolGroups()).toEqual(['architecture', 'landscape', 'indoor']);
  });

  it('选「婚礼策划」→ 可见分组恰 1 个', async () => {
    await act(async () =>
      root.render(<PanelHarness initialSelected={[]} visibleDomains={['wedding']} domain="wedding" />),
    );
    expect(poolGroupCount()).toBe(1);
    expect(poolGroups()).toEqual(['wedding']);
  });

  it('展开「其他行业阶段」→ 恰 8 个分组（= 全部可用板块）', async () => {
    await act(async () =>
      root.render(<PanelHarness initialSelected={[]} visibleDomains={SPACE_DOMAINS} domain="indoor" />),
    );
    expect(poolGroupCount()).toBe(3);
    // 折叠区的无障碍名与可见文案一致（含板块清单；标签用 domainLabel 短名，
    // 与分组标题、第 3 层「关联板块 X」同一套口径）
    await click(btn('显示其他行业阶段（软件 / 活动 / 影视 / 婚礼 / 咨询）'));
    expect(poolGroupCount()).toBe(8);
    expect(poolGroups()).toEqual(getUsableDomains());
    // 收起 → 回到 3
    await click(btn('收起其他行业阶段'));
    expect(poolGroupCount()).toBe(3);
  });

  it('A6 末句：**已选中的阶段即使被过滤掉也始终可见**（否则无法取消它）', async () => {
    const weddingItems = getItemsByDomains(['wedding']).slice(0, 2);
    await act(async () =>
      root.render(
        <PanelHarness
          initialSelected={weddingItems}
          visibleDomains={SPACE_DOMAINS}
          domain="indoor"
        />,
      ),
    );
    // 主板块=室内（可见建筑/景观/室内），但已选的婚礼项所在分组必须仍渲染
    expect(poolGroups()).toEqual(['architecture', 'landscape', 'indoor', 'wedding']);
    expect(container.textContent).toContain(weddingItems[0]!.name);
  });

  it('A4：主板块＝室内 ＋ 关联《影视制作》→ 可见恰 4 个分组，且同大类内无重复勾选项', async () => {
    const cascade: DomainCascadeValue = {
      groupKey: 'space',
      domain: 'indoor',
      relatedDomains: ['film'],
    };
    const domains = visibleDomainsOf(cascade);
    expect(domains).toEqual(['architecture', 'landscape', 'indoor', 'film']);

    await act(async () =>
      root.render(<PanelHarness initialSelected={[]} visibleDomains={domains} domain="indoor" />),
    );
    expect(poolGroupCount()).toBe(4);

    // 同大类内的板块不重复出现：每个阶段项在池里**只渲染一次**
    const indoorItems = getItemsByDomains(['indoor']);
    for (const item of indoorItems) {
      const hits = [...container.querySelectorAll(`button[aria-label="选择阶段 ${item.name}"]`)];
      expect(hits).toHaveLength(1);
    }
    // 且「影视」分组确实在（跨大类扩展生效）
    expect(poolGroups()).toContain('film');
  });

  it('不过滤（不传 visibleDomains）→ 全部行业分组平铺（改造前行为，既有调用点零改动）', async () => {
    await act(async () => root.render(<PanelHarness initialSelected={[]} />));
    expect(poolGroups()).toEqual(getUsableDomains());
    expect(container.querySelector('button[aria-label="显示其他行业阶段"]')).toBeNull();
  });
});

describe('StageSelectPanel：快捷套餐只列主板块（A5）', () => {
  it('主板块＝室内 → 恰 4 个套餐；＝婚礼 → 恰 2 个；＝景观 → 恰 2 个', async () => {
    expect(getPresetsByDomain('indoor')).toHaveLength(4);
    expect(getPresetsByDomain('wedding')).toHaveLength(2);
    expect(getPresetsByDomain('landscape')).toHaveLength(2);

    await act(async () =>
      root.render(<PanelHarness initialSelected={[]} domain="indoor" visibleDomains={SPACE_DOMAINS} />),
    );
    expect(presetCount()).toBe(4);

    await act(async () =>
      root.render(<PanelHarness initialSelected={[]} domain="wedding" visibleDomains={['wedding']} />),
    );
    expect(presetCount()).toBe(2);
  });

  it('切换主板块后**已选阶段不丢**（池子换了、已选顺序原样保留）', async () => {
    const indoorFull = getItemsByDomains(['indoor']);
    await act(async () =>
      root.render(<PanelHarness initialSelected={indoorFull} domain="indoor" visibleDomains={SPACE_DOMAINS} />),
    );
    expect(container.querySelectorAll('[data-testid^="selected-row-"]')).toHaveLength(indoorFull.length);

    await act(async () =>
      root.render(<PanelHarness initialSelected={indoorFull} domain="wedding" visibleDomains={['wedding']} />),
    );
    expect(container.querySelectorAll('[data-testid^="selected-row-"]')).toHaveLength(indoorFull.length);
    expect(presetCount()).toBe(2);
    // 已选（室内）阶段即便不在可见池里也仍可见 —— 用户有办法看到并取消
    expect(container.textContent).toContain(indoorFull[0]!.name);
  });
});

describe('StageSelectPanel：上限 20 与可达性（验收 5 / 设计 §1.3）', () => {
  it('大类伞池（建筑 6 ＋ 景观 7 ＋ 室内 9 ＝ 22 项）选满 20 段 → 允许（不是上限拒绝）', async () => {
    const umbrella = uniqueNamedPool(SPACE_DOMAINS);
    expect(getItemsByDomains(SPACE_DOMAINS).length).toBeGreaterThanOrEqual(MAX_STAGE_COUNT);
    expect(umbrella.length).toBeGreaterThanOrEqual(MAX_STAGE_COUNT);

    let latest: StageSelectionItem[] = [];
    await act(async () =>
      root.render(
        <PanelHarness
          initialSelected={[]}
          visibleDomains={SPACE_DOMAINS}
          onLatest={(next) => (latest = next)}
        />,
      ),
    );
    for (const item of umbrella.slice(0, MAX_STAGE_COUNT)) {
      await click(btn(`选择阶段 ${item.name}`));
    }
    expect(latest).toHaveLength(MAX_STAGE_COUNT);
    expect(
      useProjectsStore.getState().toasts.some((t) => t.kind === 'error'),
    ).toBe(false);
  });

  it(`选满 ${MAX_STAGE_COUNT} 段后点未选项 → **拒绝并 toast**（A10 ①）`, async () => {
    const umbrella = uniqueNamedPool(SPACE_DOMAINS);
    const selected = umbrella.slice(0, MAX_STAGE_COUNT);
    const rest = umbrella[MAX_STAGE_COUNT]!;
    expect(rest).toBeDefined();

    let latest: StageSelectionItem[] = [];
    await act(async () =>
      root.render(
        <PanelHarness
          initialSelected={selected}
          visibleDomains={SPACE_DOMAINS}
          onLatest={(next) => (latest = next)}
        />,
      ),
    );
    latest = selected;
    // 第 21 项：点它必须被拒（aria-disabled + 不改动已选 + toast）
    const target = container.querySelector(
      `button[aria-label="选择阶段 ${rest.name}"]`,
    ) as HTMLButtonElement;
    expect(target?.getAttribute('aria-disabled')).toBe('true');
    await click(target);
    expect(latest).toHaveLength(MAX_STAGE_COUNT);
    expect(
      useProjectsStore
        .getState()
        .toasts.some(
          (t) => t.kind === 'error' && t.message === `单次项目最多 ${MAX_STAGE_COUNT} 个阶段`,
        ),
    ).toBe(true);
  });

  it('单板块池（室内）**可见恰 9 项 ⇒ 20 段在单板块内不可达**（§1.3 的核心结论）', async () => {
    const indoorItems = getItemsByDomains(['indoor']);
    expect(indoorItems).toHaveLength(9);
    expect(indoorItems.length).toBeLessThan(MAX_STAGE_COUNT);

    let latest: StageSelectionItem[] = [];
    await act(async () =>
      root.render(
        <PanelHarness
          initialSelected={[]}
          visibleDomains={['indoor']}
          domain="indoor"
          onLatest={(next) => (latest = next)}
        />,
      ),
    );
    // 可见池里只有 9 项：全部勾完后池里**再无未选项**（20 在这个池子里构造不出来）
    for (const item of indoorItems) {
      await click(btn(`选择阶段 ${item.name}`));
    }
    expect(latest).toHaveLength(indoorItems.length);
    expect(poolGroupCount()).toBe(1);

    // 展开其他行业后仍可继续勾（折叠只是**视觉**，不是硬边界；第 1 层只决定可见范围）
    await click(btn('显示其他行业阶段（建筑 / 景观 / 软件 / 活动 / 影视 / 婚礼 / 咨询）'));
    const outsider = getItemsByDomains(['wedding'])[0]!;
    await click(btn(`选择阶段 ${outsider.name}`));
    expect(latest).toHaveLength(indoorItems.length + 1);
  });

  it('≥13 段给**非阻塞**提示（A10 ③：不弹窗、不阻断提交）', async () => {
    const umbrella = uniqueNamedPool(SPACE_DOMAINS);
    // 13 段 → 有提示
    await act(async () =>
      root.render(
        <PanelHarness
          key="hint-at-13"
          initialSelected={umbrella.slice(0, 13)}
          visibleDomains={SPACE_DOMAINS}
        />,
      ),
    );
    const hint = container.querySelector('[data-testid="long-stage-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('13');

    // 12 段时无该提示。
    // 注意 `initialSelected` 只是**初值**（harness 内部走 useState），
    // 换 key 强制重挂载才是「换一批已选」的正确姿势，否则状态会原地保留、断言假红。
    await act(async () =>
      root.render(
        <PanelHarness
          key="hint-at-12"
          initialSelected={umbrella.slice(0, 12)}
          visibleDomains={SPACE_DOMAINS}
        />,
      ),
    );
    expect(container.querySelector('[data-testid="long-stage-hint"]')).toBeNull();
  });
});

describe('StageSelectPanel：重名校验（A9）', () => {
  it('duplicateStageNames：只返回出现 ≥2 次的名字（trim 后比较，空名忽略）', () => {
    expect(duplicateStageNames([{ name: '提案' }, { name: '提案' }, { name: ' 测量 ' }])).toEqual([
      '提案',
    ]);
    expect(duplicateStageNames([{ name: '提案' }, { name: ' 提案' }])).toEqual(['提案']);
    expect(duplicateStageNames([{ name: '提案' }, { name: '' }, { name: '  ' }])).toEqual([]);
  });

  it('已选里有重名 → 行内提示（验收 7）', async () => {
    const base = getItemsByDomains(['indoor'])[0]!;
    await act(async () =>
      root.render(
        <PanelHarness
          initialSelected={[base, { ...base, key: 'dup-x' }]}
          visibleDomains={['indoor']}
        />,
      ),
    );
    const warn = container.querySelector('[data-testid="duplicate-stage-warning"]');
    expect(warn).not.toBeNull();
    expect(warn?.textContent).toContain('阶段名重复');
  });
});

/* ------------------------- ③ 自定义阶段弹窗（A8/A9） ------------------------- */

describe('CustomStageDialog：新增自定义阶段（TBD-1：仅建档时可加）', () => {
  /** 弹窗脚手架：重名判据的 existingNames 可控 */
  function DialogHarness(props: {
    existingNames: string[];
    onSubmit?(draft: CustomStageDraft): void;
  }): JSX.Element {
    const [open, setOpen] = React.useState(true);
    return (
      <CustomStageDialog
        open={open}
        onClose={() => setOpen(false)}
        onSubmit={(d) => props.onSubmit?.(d)}
        existingNames={props.existingNames}
        defaultRatioPercent={8}
        defaultColorIndex={3}
      />
    );
  }

  async function typeName(value: string): Promise<void> {
    const input = document.querySelector('input[aria-label="自定义阶段名称"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await setInputValue(input, value);
  }

  it('空名 → 阻止提交 + 行内提示', async () => {
    let submitted: CustomStageDraft | null = null;
    await act(async () => root.render(<DialogHarness existingNames={[]} onSubmit={(d) => (submitted = d)} />));
    const submit = btn('确认新增自定义阶段');
    // 「不可用」信号（置灰 + aria-disabled）与「点击后给出原因」两件事都要成立：
    // 这就是不用原生 disabled 的原因 —— 原生 disabled 不派发 click，行内提示无从出现。
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    await click(submit);
    expect(submitted).toBeNull(); // 真正的闸门：没提交
    expect(byTestId('custom-stage-name-error')).not.toBeNull(); // 且给出了原因
    // 补一刀：填上合法名后同一按钮必须放行（否则「阻止提交」可能只是把按钮焊死）
    await typeName('消防报审');
    expect(btn('确认新增自定义阶段').getAttribute('aria-disabled')).toBe('false');
    await click(btn('确认新增自定义阶段'));
    expect(submitted).not.toBeNull();
  });

  it('重名 → 阻止提交 + 行内提示（验收 7）', async () => {
    let submitted: CustomStageDraft | null = null;
    await act(async () =>
      root.render(<DialogHarness existingNames={['提案', '测量']} onSubmit={(d) => (submitted = d)} />),
    );
    await typeName('提案');
    expect(byTestId('custom-stage-duplicate-error')).not.toBeNull();
    expect(btn('确认新增自定义阶段').getAttribute('aria-disabled')).toBe('true');
    await click(btn('确认新增自定义阶段'));
    expect(submitted).toBeNull();
  });

  it('填「消防报审」→ 产出草稿（名称/占比/内置色号；未选自定义色 ⇒ customColor=null）', async () => {
    let submitted: CustomStageDraft | null = null;
    await act(async () =>
      root.render(<DialogHarness existingNames={['提案']} onSubmit={(d) => (submitted = d)} />),
    );
    await typeName('消防报审');
    await click(btn('确认新增自定义阶段'));
    expect(submitted).not.toBeNull();
    expect(submitted!.name).toBe('消防报审');
    expect(submitted!.ratioPercent).toBeNull(); // 留空 ⇒ 父组件按平均值兜底
    expect(submitted!.colorIndex).toBe(3); // 父组件给的「第一个未占用内置色」
    expect(submitted!.customColor).toBeNull();
  });

  it('从取色器选自定义色 → 草稿携带 customColor（#rrggbb）', async () => {
    let submitted: CustomStageDraft | null = null;
    await act(async () =>
      root.render(<DialogHarness existingNames={[]} onSubmit={(d) => (submitted = d)} />),
    );
    await typeName('消防报审');
    const picker = document.querySelector('input[aria-label="取色器"]') as HTMLInputElement;
    expect(picker).not.toBeNull();
    await setInputValue(picker, '#7a1f2b');
    await click(btn('确认新增自定义阶段'));
    // 归一化后统一为**大写** `#RRGGBB`（全仓唯一归一化器 ＝ core/color 的 normalizeHex；
    // 备份往返夹具 `tests/backup.roundtrip.spec.ts` 也是大写口径）
    expect(submitted!.customColor).toBe('#7A1F2B');
  });

  it('9 个内置色用尽 → 弹窗给「建议自定义一个颜色」提示（A10 ②措辞）', async () => {
    await act(async () =>
      root.render(
        <CustomStageDialog
          open
          onClose={() => undefined}
          onSubmit={() => undefined}
          existingNames={[]}
          defaultColorIndex={1}
          builtinExhausted
        />,
      ),
    );
    const hint = byTestId('custom-stage-color-exhausted');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('已用 9 个内置色，建议自定义一个颜色以便区分');
  });

  it('取色器给出非法值（非 #rrggbb）→ 不写入自定义色（不改坏数据）', async () => {
    let submitted: CustomStageDraft | null = null;
    await act(async () =>
      root.render(<DialogHarness existingNames={[]} onSubmit={(d) => (submitted = d)} />),
    );
    await typeName('消防报审');
    const picker = document.querySelector('input[aria-label="取色器"]') as HTMLInputElement;

    // 前置（否则本用例可能假绿）：「脏值注入」这条通道必须先被证明是活的 ——
    // 用一个**合法**值走同一条路，写得进去才说明 onChange 真被调到了；
    // 否则结尾的 `customColor === null` 可能只是「通道根本没通」。
    await setRawInputValue(picker, '#7a1f2b');
    expect(document.querySelector('button[aria-label="取消自定义颜色"]')).not.toBeNull();

    // 复位成「无自定义色」（等价于用户点「用内置色」）
    await click(btn('取消自定义颜色'));
    expect(document.querySelector('button[aria-label="取消自定义颜色"]')).toBeNull();

    // 正题：非法值必须被丢弃 —— 既不写入，也不把 colorIndex 弄坏
    await setRawInputValue(picker, 'not-a-color');
    await click(btn('确认新增自定义阶段'));
    expect(submitted).not.toBeNull();
    expect(submitted!.customColor).toBeNull();
    expect(submitted!.colorIndex).toBe(3);
  });
});
