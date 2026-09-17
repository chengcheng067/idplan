// @vitest-environment jsdom
/**
 * v0.8 · T03 验收（三）：**两条建档路径都走一遍** ＋ 验收 9（标签可空）。
 *
 * 设计 §8 T03 的注意项原文：
 *   「`StageSelectPanel.tsx` 是**向导与手动兜底两条路径共用**（PRD §5.3 #2）
 *     ⇒ 改它等于同时改两处，验收须**两条路径都走一遍**。」
 *
 * 本仓现状（已核实）：`StageSelectPanel` 的**唯一**消费方是 `ManualFallbackForm`
 * （`AppShell:69` 全局挂载；v0.3 移除合同导入入口后它已是主入口，不再是"兜底"）。
 * 故「两条路径」在现网 = 同一个表单的**两种用法**，两者都必须在改完后照常可用：
 *
 *   · **路径甲（快速档）**：不展开阶段折叠区 → 直接提交 → 用默认「室内·全流程 9 段」，
 *     用户全程不碰阶段池。**这条路径必须逐字保持改造前行为**（零回归）。
 *   · **路径乙（完整档）**：展开折叠区 → 三层级联改主板块 ＋ 阶段池勾选 ＋ 新增自定义阶段
 *     → 提交。主板块落 `Project.domain`，自定义阶段落 `templateKey = null`。
 *
 * 验收 9：标签（原「类型」）**可空**，留空落 `ProjectType.Other`，绝不阻塞建档。
 *
 * ── 为什么这里敢用"真"链路 ──
 * 只顶掉 `useRepos()` 这一处 DI 入口（组件树外的东西），其余全是真的：
 * 真 `createProjectActions` → 真 `ProjectService` → 真 fake-indexeddb 行。
 * mock 掉 store/service 等于把"两条路径是否真的建出档案"验空。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import type { BackupPackage } from '../src/core/types/dto';
import { ManualFallbackForm } from '../src/components/contract-wizard/ManualFallbackForm';
import { DEFAULT_PROJECT_DOMAIN } from '../src/core/template/stage-fallback';
import { ProjectType } from '../src/core/types/enums';

let bundle: IRepositoryBundle;

/** 只顶掉 DI 入口；`bundle` 每个用例重建（真仓储） */
vi.mock('../src/hooks/useRepos', () => ({ useRepos: () => bundle }));

/**
 * vitest singleThread 下**所有 spec 共享同一个 fake-indexeddb 实例**，
 * 而 `createRepositories()` 拿到的是同一个库 —— 不清库的话，本文件第 N 个用例
 * 会看见前面所有用例建的项目（断言 `toHaveLength(1)` 直接假红），
 * 且**本文件建的真项目会污染后续 spec**。故进出一律清库。
 */
function emptyPackage(): BackupPackage {
  return {
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-08-01T00:00:00.000Z' },
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
  };
}

let root: Root;
let container: HTMLDivElement;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport(emptyPackage());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  document.body.removeChild(container);
  // 走人前把自己建的行收干净（否则后续 spec 的「空库」前提被破坏）
  await bundle.admin?.replaceAllImport(emptyPackage());
});

/* ------------------------------ 交互工具 ------------------------------ */

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

/** 按 aria-label 查按钮（查 `document`：Modal 走 createPortal，内容不在 container 里） */
function btn(label: string): HTMLButtonElement {
  const el = document.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`未找到按钮：${label}`);
  return el as HTMLButtonElement;
}

/** 按**文字**查按钮（表单里有几个按钮故意没有 aria-label，走可见文案定位，顺带锁住文案） */
function btnByText(fragment: string): HTMLButtonElement {
  const el = [...document.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(fragment),
  );
  if (!el) throw new Error(`未找到含文字「${fragment}」的按钮`);
  return el as HTMLButtonElement;
}

/** 折叠区开关（文案里带已选数量 —— 一并锁住"A 路径默认 9 段"这个事实） */
function foldToggle(): HTMLButtonElement {
  return btnByText('本次服务阶段');
}

async function renderForm(): Promise<void> {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ManualFallbackForm open onClose={() => undefined} />
      </MemoryRouter>,
    ),
  );
}

/** 填最小必填项：项目名称 ＋ 竣工日（开始日已默认今天） */
async function fillRequired(name: string, endAt: string): Promise<void> {
  const nameInput = document.querySelector(
    'input[placeholder="如「XX餐饮·室内设计」"]',
  ) as HTMLInputElement;
  expect(nameInput).toBeTruthy();
  await setInputValue(nameInput, name);

  const dateInputs = [...document.querySelectorAll('input[type="date"]')] as HTMLInputElement[];
  expect(dateInputs).toHaveLength(2); // [开始, 竣工]
  await setInputValue(dateInputs[1]!, endAt);
}

/** 点提交 + 把异步链路（action → service → Dexie）泵完 */
async function submitAndWait(): Promise<void> {
  await act(async () => {
    btnByText('建档（按所选').click();
  });
  for (let i = 0; i < 40; i += 1) {
    const projects = await bundle.projects.list({ status: 'all' });
    if (projects.length > 0) {
      // 阶段行是在项目行之后写入的，再多泵一轮确保落齐
      await act(async () => {
        await Promise.resolve();
      });
      return;
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  throw new Error('提交后 200ms 内未见项目落库');
}

async function onlyProject() {
  const projects = await bundle.projects.list({ status: 'all' });
  expect(projects).toHaveLength(1);
  return projects[0]!;
}

/* --------------------- 路径甲：不展开 → 默认 9 段 --------------------- */

describe('路径甲（快速档）· 不展开折叠区直接提交 —— 改造前行为零回归', () => {
  it('默认预选「室内·全流程 9 段」，提交后落库 9 段且全部带真模板 key', async () => {
    await renderForm();
    // 折叠区**未展开**时就已经是 9 段（预选，不是"展开才有"）
    expect(foldToggle().textContent).toContain('已选 9 项');
    expect(document.body.textContent).toContain('默认：室内·全流程 9 段');
    // 未展开 ⇒ 池子没渲染（用户全程不碰阶段选择）
    expect(document.querySelector('[data-testid^="pool-group-"]')).toBeNull();

    await fillRequired('路径甲项目', '2026-12-31');
    await submitAndWait();

    const project = await onlyProject();
    const stages = await bundle.stages.listByProject(project.id);
    expect(stages).toHaveLength(9);
    expect(stages.map((s) => s.orderIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // 全是模板段：templateKey 有值且能查到（没被 normalizeDraftTemplateKey 误伤成 null）
    for (const s of stages) {
      expect(s.templateKey).toBeTruthy();
      expect(s.customColor).toBeNull();
    }
    expect(project.stagePresetKey).toBe('indoor_full');
  });

  /*
   * 原用例名：「验收 9 · 标签留空也能提交（落 ProjectType.Other，不阻塞）」。
   *
   * 「类型」字段已按决策整条删除（它把业态与设计专业混在一个原生 select 里，
   * 且默认 Dining 与三层级联的默认 indoor 各自独立、互不相干）。
   * 故**不能删掉这个用例了事** —— 改写为对「删除」本身的正面断言，并保留原来的
   * 「不阻塞提交」这半条语义。若将来有人把旧字段加回来，第一条断言会立刻变红。
   */
  it('验收 9 · 原「类型」字段已删除（不再有该下拉），且不展开折叠区仍可直接提交', async () => {
    await renderForm();

    // ① 正面断言：旧字段确实不存在了
    expect(document.querySelector('select[aria-label="项目类型"]')).toBeNull();

    // ② 等价语义：不展开折叠区也能提交，不被阻塞（与改造前一致）
    await fillRequired('无类型字段项目', '2026-12-31');
    await submitAndWait();

    const project = await onlyProject();
    // 「类型」原本唯一的真实职能（决定初始阶段池）已迁到主板块 domain
    expect(project.domain).toBe('indoor');
    // 且没有冒出新校验错误
    expect(document.body.textContent).not.toContain('请填写');
  });

  it('主板块默认落 indoor（未动级联时行为与改造前一致）', async () => {
    await renderForm();
    expect(DEFAULT_PROJECT_DOMAIN).toBe('indoor');
    await fillRequired('默认板块项目', '2026-12-31');
    await submitAndWait();
    expect((await onlyProject()).domain).toBe('indoor');
  });
});

/* ----------------- 路径乙：展开 → 三层筛选 ＋ 自定义阶段 ----------------- */

describe('路径乙（完整档）· 展开折叠区 → 三层级联 ＋ 自定义阶段', () => {
  it('展开后池子按主板块过滤渲染；改主板块（无第 1 层点击）也能生效并落 Project.domain', async () => {
    await renderForm();
    await click(foldToggle());
    // 默认级联 = 建筑设计行业/室内 ⇒ 可见分组恰 3（建筑/景观/室内）
    expect(document.querySelectorAll('[data-testid^="pool-group-"]')).toHaveLength(3);

    // 第 2 层直达：不点第 1 层也改得动（A2）
    const domainSelect = document.querySelector('select[aria-label="主板块"]') as HTMLSelectElement;
    expect(domainSelect).toBeTruthy();
    await act(async () => {
      domainSelect.value = 'landscape';
      domainSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await fillRequired('路径乙板块项目', '2026-12-31');
    await submitAndWait();

    const project = await onlyProject();
    expect(project.domain).toBe('landscape'); // 第 2 层结果真的落库了
  });

  it('新增「消防报审」→ 已选从 9 变 10；提交后该段落 templateKey=null ＋ customColor 落值', async () => {
    await renderForm();
    await click(foldToggle());
    expect(foldToggle().textContent).toContain('已选 9 项');

    // 自定义阶段入口只在**建档路径**挂载（本表单就是建档路径）
    await click(btn('新增自定义阶段'));
    const nameInput = document.querySelector(
      'input[aria-label="自定义阶段名称"]',
    ) as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    await setInputValue(nameInput, '消防报审');

    // 取自定义色 → 草稿携带 customColor（大写归一）
    const picker = document.querySelector('input[aria-label="取色器"]') as HTMLInputElement;
    expect(picker).toBeTruthy();
    await setInputValue(picker, '#7a1f2b');

    await click(btn('确认新增自定义阶段'));
    // 追加到已选末尾（A8）—— 折叠区开关的计数就是用户的即时反馈
    expect(foldToggle().textContent).toContain('已选 10 项');

    await fillRequired('路径乙自定义阶段项目', '2026-12-31');
    await submitAndWait();

    const project = await onlyProject();
    const stages = await bundle.stages.listByProject(project.id);
    expect(stages).toHaveLength(10);

    const custom = stages.find((s) => s.name === '消防报审');
    expect(custom).toBeDefined();
    expect(custom!.templateKey).toBeNull(); // 收口：非模板库 key ⇒ null
    expect(custom!.customColor).toBe('#7A1F2B');
    expect(custom!.orderIndex).toBe(10);
    // 前 9 段仍是模板段（自定义阶段没有把套餐打乱）
    expect(stages.filter((s) => s.templateKey !== null)).toHaveLength(9);
  });

  it('自定义阶段落进**复用库**（建档即记，TS-07 开关默认开）', async () => {
    await renderForm();
    await click(foldToggle());
    await click(btn('新增自定义阶段'));
    await setInputValue(
      document.querySelector('input[aria-label="自定义阶段名称"]') as HTMLInputElement,
      '消防报审',
    );
    await click(btn('确认新增自定义阶段'));
    await fillRequired('复用库项目', '2026-12-31');
    await submitAndWait();

    const raw = await bundle.settings.get<unknown>('customStages');
    expect(Array.isArray(raw)).toBe(true);
    expect((raw as Array<{ name: string }>).map((d) => d.name)).toContain('消防报审');
  });

  it('A9 · 弹窗内重名即刻拦截（行内提示 ＋ 阻止提交），且**没有被写进已选**', async () => {
    await renderForm();
    await click(foldToggle());
    const firstStageName = getFirstPresetStageName();

    // 用与已选第 1 段同名的名字新增 —— 弹窗必须即刻拦住
    await click(btn('新增自定义阶段'));
    await setInputValue(
      document.querySelector('input[aria-label="自定义阶段名称"]') as HTMLInputElement,
      firstStageName,
    );
    // ① 行内提示（判据与落库闸门同源：`duplicateStageNames` / `isDuplicateStageName`）
    expect(document.querySelector('[data-testid="custom-stage-duplicate-error"]')).not.toBeNull();
    // ② 提交按钮置为「不可用」语义，且点击后不产出草稿
    expect(btn('确认新增自定义阶段').getAttribute('aria-disabled')).toBe('true');
    await click(btn('确认新增自定义阶段'));
    expect(document.querySelector('[data-testid="custom-stage-duplicate-error"]')).not.toBeNull();

    await click(btn('取消新增自定义阶段'));
    // ③ 被拦下的东西**没有**混进已选（否则用户会带着重名去提交）
    expect(foldToggle().textContent).toContain('已选 9 项');

    // ④ 而干净的 9 段照常建得出来（拦截的是重名，不是把提交功能一并焊死）
    await fillRequired('未重名项目', '2026-12-31');
    await submitAndWait();
    const project = await onlyProject();
    expect((await bundle.stages.listByProject(project.id)).length).toBe(9);
  });
});

/** 默认套餐第 1 段的名称（用于构造重名） */
function getFirstPresetStageName(): string {
  // 直接读面板上第 1 个已选行的名称，避免再引模板库造成两处口径
  const row = document.querySelector('[data-testid="selected-row-1"]');
  const name = row?.querySelector('span.truncate')?.textContent ?? '';
  expect(name.trim()).not.toBe('');
  return name.trim();
}
