// @vitest-environment jsdom
/**
 * v0.8 · T04-B 验收（建板表单 ＋ store action）：**「新建 Agent 看板」**。
 *
 * 设计依据：§6.1 时序图第 1–3 步 / PRD B7–B10、TS-08、D5 / §7.4 权限表。
 *
 * ══════════════════════════ 这份 spec 要钉住的三件事 ══════════════════════════
 *
 *   ① **「缺一即拒」是零写入**，不是"报个错就完事"。
 *      B9 的原文是「缺日期 → 明确报错、**不得**默认日期」。最容易写出的假绿是
 *      「断言函数返回了错误字符串」—— 但那证明不了**库没被动过**。故本文件在
 *      纯函数层把写入方作为**入参注入**（计数器替身），直接断言
 *      「校验不过时 `create` 一次都没被调用」；在 DOM 层用**真仓储**断言
 *      `projects.list()` 仍是空的。两层各证一半，缺一层就有缝。
 *
 *   ② **`presetKey` 与 `stageNames` 永远不同时出现**（`toAgentBoardCmd`）。
 *      两样都送会让服务端把 `stagePresetKey` 记成 `'custom'`——套餐溯源**静默丢失**。
 *      两条分支各一条用例，谁把二选一改成并送，立刻红。
 *
 *   ③ **建板路径上没有角色闸门**（§7.4：member 与 admin 都能建）。
 *      这条是"没有某样东西"，行为断言天然证不了（不设身份也会过）。故用
 *      **源码级断言**把它钉住：本组件源码里不出现 `useRoleGuard` / `isAdmin`。
 *      同文件另有一条**正向对照**（页面确实把对话框接上了），避免"断言不存在"
 *      变成对空文件的假绿。
 *
 * ══════════════════════════ 诚实标注：哪一层测到了什么 ══════════════════════════
 *
 *   · **纯函数层**（`validateAgentBoardDraft` / `toAgentBoardCmd` /
 *     `submitAgentBoardDraft`）：不经组件 DOM 直接调用。这三个函数**就是**
 *     组件 `submit()` 的决策路径（组件只做一次 `if (!result.ok)` 分流），
 *     所以测它们不是测复制品；但仍属"逻辑级"，不是"点按钮级"。
 *   · **DOM 层**：真组件 ＋ 真 `createRepositories`（fake-indexeddb）＋ 真
 *     `createProjectActions` → 真 `ProjectService`。只顶掉 `useRepos()` 一个 DI 入口，
 *     其余全真（与 `v08-intake-two-paths.spec.tsx` 同一手法）。**这一层才是
 *     "点提交按钮之后库里到底有没有行"的端到端证明。**
 *   · **源码层**：`readFileSync` 读组件/页面源码做断言（同 `isolation-guard` 手法）。
 *     只用于"不存在某结构"这类行为断言覆盖不到的约束。
 *
 * ⚠️ 未覆盖（如实标注，勿当成已验）：`TransferDialog` 的宿主接线（`ProjectDetailPage.tsx`）
 * 属 T05，本文件不涉及。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import type { StageSelectionItem } from '../src/core/types/dto';
import { emptyPackage } from './helpers/backup-fixture';
import {
  CreateAgentBoardDialog,
  submitAgentBoardDraft,
  toAgentBoardCmd,
  validateAgentBoardDraft,
  type AgentBoardDraft,
} from '../src/components/agent/CreateAgentBoardDialog';
import { getPresetItems } from '../src/core/template/stage-library';
import { CUSTOM_STAGE_PRESET_KEY } from '../src/core/template/stage-fallback';
import { ChangxiaError, ChangxiaErrorCode } from '../src/core/types/enums';

/* ════════════════════════════════ 纯函数层 ════════════════════════════════ */

/** 构造一个"库里没有"的自定义阶段项（key 带 `cst_` 前缀 ⇒ 必不命中任何内置套餐） */
function customItem(name: string): StageSelectionItem {
  return {
    key: `cst_test_${name}`,
    name,
    domain: 'indoor',
    ratioPercent: 10,
    colorIndex: 1,
    kanbanColumn: 'design',
    defaultResponsibility: '',
    defaultTasks: [],
  };
}

/** 一份**填好**的草稿；用 `partial` 只改要测的那一项（其余保持合法） */
function draftOf(partial: Partial<AgentBoardDraft>): AgentBoardDraft {
  return {
    name: '池边项目 · 排期',
    plannedStartAt: '2026-09-01',
    plannedEndAt: '2026-10-01',
    stageItems: [customItem('提案')],
    ...partial,
  };
}

/** 日期取本机时区无歧义的字面量（`YYYY-MM-DD`，不经 `new Date()`） */
const START = '2026-09-01';
const END = '2026-10-01';

describe('validateAgentBoardDraft：缺一即拒，且日期不给默认值', () => {
  it('名称为空字符串 / 纯空格 → 报错（不给"未命名"之类的默认名）', () => {
    expect(validateAgentBoardDraft(draftOf({ name: '' }))).toBe('请填写看板名称。');
    expect(validateAgentBoardDraft(draftOf({ name: '   ' }))).toBe('请填写看板名称。');
  });

  it('★ 缺开始日期 → 报错，且文案**点明不会自动填默认日期**（B9）', () => {
    const msg = validateAgentBoardDraft(draftOf({ plannedStartAt: '' }));
    expect(msg).toBeTruthy();
    expect(msg).toContain('开始日期');
    // 关键：文案必须让用户知道"没有默认值"这件事，而不是以为自己漏看了
    expect(msg).toContain('不会自动填写默认日期');
  });

  it('★ 缺结束日期 → 报错，同样点明不会自动填默认日期', () => {
    const msg = validateAgentBoardDraft(draftOf({ plannedEndAt: '' }));
    expect(msg).toBeTruthy();
    expect(msg).toContain('结束日期');
    expect(msg).toContain('不会自动填写默认日期');
  });

  it('结束日期早于开始日期 → 报错（不倒挂、不静默纠正）', () => {
    expect(validateAgentBoardDraft(draftOf({ plannedStartAt: END, plannedEndAt: START }))).toBe(
      '结束日期不能早于开始日期。',
    );
  });

  it('起止同日 → 合法（不等于"早于"）', () => {
    expect(validateAgentBoardDraft(draftOf({ plannedStartAt: START, plannedEndAt: START }))).toBeNull();
  });

  it('★ 阶段集合为空 → 报错（§6.1「显式声明，缺一即拒」）', () => {
    expect(validateAgentBoardDraft(draftOf({ stageItems: [] }))).toBe('请至少选择 1 个阶段。');
  });

  it('阶段存在空名 → 报错（漏掉会落一个在看板上"看不见的一段"）', () => {
    expect(validateAgentBoardDraft(draftOf({ stageItems: [customItem('  ')] }))).toBe(
      '阶段名称不能为空。',
    );
  });

  it('阶段重名 → 报错并列出重名（`duplicateStageNames` 口径）', () => {
    const msg = validateAgentBoardDraft(
      draftOf({ stageItems: [customItem('提案'), customItem('提案')] }),
    );
    expect(msg).toBeTruthy();
    expect(msg).toContain('提案');
  });

  it('全部合法 → 返回 null（不打无用 error 文本）', () => {
    expect(validateAgentBoardDraft(draftOf({}))).toBeNull();
  });

  it('日期用 `toIsoDate` 口径：非日期文本等同缺日期（不猜、不回落）', () => {
    expect(validateAgentBoardDraft(draftOf({ plannedStartAt: '不是日期' }))).toContain('开始日期');
    expect(validateAgentBoardDraft(draftOf({ plannedEndAt: 'TBD' }))).toContain('结束日期');
  });

  it('日期口径记录在案：`YYYY/MM/DD` 会被 `toIsoDate`(dayjs) 归一为 `YYYY-MM-DD`，不视为缺失', () => {
    // ⚠️ 这不是"我们想要的行为"，而是**实现的真实宽松口径**（dayjs 接受斜杠）。
    // 钉住它有两个作用：① 后人不会误以为斜杠会被拒；② 若哪天改成严格口径，
    // 这条会红，提醒同步改文案（否则"非法格式"的报错文案会与实际不一致）。
    const cmd = toAgentBoardCmd(draftOf({ plannedStartAt: '2026/09/01' }));
    expect(cmd.plannedStartAt).toBe('2026-09-01');
  });
});

describe('toAgentBoardCmd：presetKey 与 stageNames **二选一**，绝不同时出现', () => {
  it('★ 精确命中内置套餐 → 只送 presetKey（no stageNames），保住 stagePresetKey 溯源', () => {
    const items = getPresetItems('indoor_full');
    expect(items.length).toBeGreaterThan(0);

    const cmd = toAgentBoardCmd(draftOf({ stageItems: items }));

    expect(cmd.presetKey).toBe('indoor_full');
    // 两样都送会被服务端判成 declaredNames.length>0 ⇒ stagePresetKey 变 'custom'（溯源静默丢失）
    expect(cmd.stageNames).toBeUndefined();
    expect(cmd.name).toBe('池边项目 · 排期');
    expect(cmd.plannedStartAt).toBe(START);
    expect(cmd.plannedEndAt).toBe(END);
  });

  it('★ 自由组合（含库外阶段名）→ 只送 stageNames（no presetKey），按序 trim 后送出', () => {
    const cmd = toAgentBoardCmd(
      draftOf({ stageItems: [customItem('提案'), customItem('消防报审')] }),
    );

    expect(cmd.stageNames).toEqual(['提案', '消防报审']);
    expect(cmd.presetKey).toBeUndefined();
  });

  it('阶段名两边带空格 → 送出前 trim（与 service 的 `dedupeAgentStageNames` 同口径）', () => {
    const cmd = toAgentBoardCmd(
      draftOf({ stageItems: [customItem('  提案  '), customItem(' 消防报审 ')] }),
    );
    expect(cmd.stageNames).toEqual(['提案', '消防报审']);
  });

  it('名称两边带空格 → trim 后送出', () => {
    const cmd = toAgentBoardCmd(draftOf({ name: '  池边项目 · 排期  ' }));
    expect(cmd.name).toBe('池边项目 · 排期');
  });

  it('日期非法 → 抛 ChangxiaError（最后一道兜底；正常路径由 validate 先拦）', () => {
    expect(() => toAgentBoardCmd(draftOf({ plannedStartAt: '' }))).toThrow(ChangxiaError);
  });

  it('套餐 key 是"顺序敏感"匹配：把套餐前两段对调 → 不再命中，改走 stageNames', () => {
    const items = [...getPresetItems('indoor_full')];
    const swapped = [items[1]!, items[0]!, ...items.slice(2)];
    const cmd = toAgentBoardCmd(draftOf({ stageItems: swapped }));

    expect(cmd.presetKey).toBeUndefined();
    expect(cmd.stageNames).toEqual(swapped.map((i) => i.name));
    // 顺带锁住 `CUSTOM_STAGE_PRESET_KEY` 这个常量在两种口径下指同一件事
    expect(CUSTOM_STAGE_PRESET_KEY).toBe('custom');
  });
});

describe('submitAgentBoardDraft：校验不过 ⇒ **写入方一次都不被调用**（零写入证明）', () => {
  /** 计数器替身：既记录调用次数，也保证"若被调用就会改变断言结果"（返回新 id） */
  function countingCreate(): {
    create: (cmd: unknown) => Promise<{ id: string }>;
    calls: () => number;
  } {
    let n = 0;
    return {
      create: async () => {
        n += 1;
        return { id: `p_should_not_exist_${n}` };
      },
      calls: () => n,
    };
  }

  it('★ 缺开始日期 → create **0 次**，返回 ok:false 且带可读原因', async () => {
    const { create, calls } = countingCreate();
    const res = await submitAgentBoardDraft(draftOf({ plannedStartAt: '' }), create);

    expect(calls()).toBe(0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('开始日期');
  });

  it('★ 缺结束日期 → create **0 次**', async () => {
    const { create, calls } = countingCreate();
    const res = await submitAgentBoardDraft(draftOf({ plannedEndAt: '' }), create);
    expect(calls()).toBe(0);
    expect(res.ok).toBe(false);
  });

  it('★ 缺名称 → create **0 次**', async () => {
    const { create, calls } = countingCreate();
    const res = await submitAgentBoardDraft(draftOf({ name: '   ' }), create);
    expect(calls()).toBe(0);
    expect(res.ok).toBe(false);
  });

  it('★ 阶段集合为空 → create **0 次**', async () => {
    const { create, calls } = countingCreate();
    const res = await submitAgentBoardDraft(draftOf({ stageItems: [] }), create);
    expect(calls()).toBe(0);
    expect(res.ok).toBe(false);
  });

  it('全部合法 → create **恰好 1 次**，命令含名称/起止日期三件（可加预设或阶段名）', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const res = await submitAgentBoardDraft(draftOf({}), async (cmd) => {
      seen.push(cmd as unknown as Record<string, unknown>);
      return { id: 'p_new_1' };
    });

    expect(res).toEqual({ ok: true, projectId: 'p_new_1' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.name).toBe('池边项目 · 排期');
    expect(seen[0]!.plannedStartAt).toBe(START);
    expect(seen[0]!.plannedEndAt).toBe(END);
    // 三件必填之外，阶段集合以"二选一"承载
    const hasPreset = typeof seen[0]!.presetKey === 'string';
    const hasNames = Array.isArray(seen[0]!.stageNames);
    expect(hasPreset || hasNames).toBe(true);
    expect(hasPreset && hasNames).toBe(false);
  });

  it('写入方抛 ChangxiaError → 原样取 userMessage 回传（不吞成笼统"创建失败"）', async () => {
    const res = await submitAgentBoardDraft(draftOf({}), async () => {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        '请提供看板的开始日期与结束日期（不会自动填充默认日期）。',
      );
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('不会自动填充默认日期');
  });

  it('写入方抛非 ChangxiaError → 兜底成通用可读文案（不把栈泄漏给用户）', async () => {
    const res = await submitAgentBoardDraft(draftOf({}), async () => {
      throw new Error('EIDB_CONNECTION_LOST');
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('创建看板失败，请重试。');
      expect(res.error).not.toContain('EIDB_CONNECTION_LOST');
    }
  });
});

/* ═══════════════════════ DOM 层（真组件 ＋ 真仓储） ═══════════════════════ */

let bundle: IRepositoryBundle;

/** 只顶掉 DI 入口 `useRepos()`；`bundle` 每个用例重建（真仓储 → 真 fake-indexeddb） */
vi.mock('../src/hooks/useRepos', () => ({ useRepos: () => bundle }));

/**
 * vitest `singleThread` 下所有 spec 共用一个 fake-indexeddb 实例，
 * 不清库会让本文件的行污染后续 spec（且自己的断言会看到别人的项目）。进出一律清库。
 */

let root: Root;
let container: HTMLDivElement;
let onCloseSpy: ReturnType<typeof vi.fn>;
let onCreatedSpy: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport(emptyPackage());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onCloseSpy = vi.fn();
  onCreatedSpy = vi.fn();
});

afterEach(async () => {
  act(() => root.unmount());
  document.body.removeChild(container);
  await bundle.admin?.replaceAllImport(emptyPackage());
});

/* ------------------------------ 交互工具 ------------------------------ */

/** 受控输入：用原生 setter 触发 React 的 onChange（绕开 React 受控值缓存） */
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

/** 弹窗走 `createPortal` → 内容在 `document` 上，不在 `container` 里 */
function q<T extends Element>(selector: string): T | null {
  return document.querySelector(selector) as T | null;
}

function named<T extends Element>(selector: string, what: string): T {
  const el = q<T>(selector);
  if (!el) throw new Error(`未找到：${what}（选择器 ${selector}）`);
  return el;
}

const nameInput = (): HTMLInputElement => named<HTMLInputElement>('input[aria-label="看板名称"]', '看板名称输入');
const startInput = (): HTMLInputElement => named<HTMLInputElement>('input[aria-label="开始日期"]', '开始日期输入');
const endInput = (): HTMLInputElement => named<HTMLInputElement>('input[aria-label="结束日期"]', '结束日期输入');
const submitBtn = (): HTMLButtonElement =>
  named<HTMLButtonElement>('[data-create-agent-board-submit]', '提交按钮');
const errorBox = (): HTMLElement | null => q<HTMLElement>('[data-create-agent-board-error]');

/** 阶段池里任意一个"选择阶段"芯片（不依赖具体阶段名，避免与模板库文案耦合） */
function firstStageChip(): HTMLButtonElement {
  const el = q<HTMLButtonElement>('button[aria-label^="选择阶段 "]');
  if (!el) throw new Error('阶段池里没有任何「选择阶段」按钮（可见分组为空？）');
  return el;
}

async function renderDialog(): Promise<void> {
  await act(async () => {
    root.render(
      <CreateAgentBoardDialog open onClose={onCloseSpy} onCreated={onCreatedSpy} />,
    );
  });
}

/** 把微任务泵干（真仓储是异步的：action → service → Dexie） */
async function pump(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function projectCount(): Promise<number> {
  return (await bundle.projects.list({ status: 'all' })).length;
}

/**
 * 点提交后把异步链路泵到**成功收尾**为止。
 *
 * 三个后置条件都要满足才算收尾完成：
 *   ① 项目已落库（action → service → Dexie 是真异步，行**先于**组件状态出现）；
 *   ② `onCreated` 已被调用（它是成功路径的**最后一步**，说明清空/关窗的 setState 已排队）；
 *   ③ 表单已清空且渲染进 DOM。
 * ⚠️ 只等 ① 会在"表单是否清空"这类断言上读到**过期 DOM** —— 清空发生在 ① 之后的好几个
 *    微任务（store action 还要 `get` 一次项目、`listByProject` 取阶段、`pushToast`）。
 *    这正是本 spec 头一版的红因，留此注释以防有人"简化"回去。
 */
async function submitAndWaitForProject(): Promise<void> {
  await click(submitBtn());
  for (let i = 0; i < 80; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const landed = (await projectCount()) > 0;
    const finished = onCreatedSpy.mock.calls.length > 0;
    const cleared = nameInput().value === '' && startInput().value === '';
    if (landed && finished && cleared) return;
  }
  throw new Error('提交后 400ms 内未见看板落库并完成表单收尾');
}

/* ------------------------------ 用例 ------------------------------ */

describe('CreateAgentBoardDialog ·「不预填」是这个表单的验收项（B9）', () => {
  it('★ 挂载即：两个日期输入**都是空的**（没有"今天"之类的默认值）', async () => {
    await renderDialog();
    expect(startInput().value).toBe('');
    expect(endInput().value).toBe('');
    // 对照：如果哪天有人"顺手"补个默认今天，这条立刻红
    const today = new Date().toISOString().slice(0, 10);
    expect(startInput().value).not.toBe(today);
  });

  it('★ 挂载即：名称为空、已选阶段 0 项（不预选套餐 —— 不替用户猜行业）', async () => {
    await renderDialog();
    expect(nameInput().value).toBe('');
    expect(document.body.textContent).toContain('已选 0 项');
  });

  it('界面上有一句明确说明"系统不会替你填默认值"（否则用户以为没加载完）', async () => {
    await renderDialog();
    expect(document.body.textContent).toContain('系统不会替你填默认值');
  });
});

describe('CreateAgentBoardDialog · 校验不过 ⇒ 不建项目（真仓储里的零写入）', () => {
  it('★ 全空直接点提交：显示错误 ＋ **库里 0 个项目** ＋ 未 onCreated', async () => {
    await renderDialog();
    await click(submitBtn());
    await pump();

    expect(errorBox()).not.toBeNull();
    expect(errorBox()!.textContent).toBeTruthy();
    expect(await projectCount()).toBe(0);
    expect(onCreatedSpy).not.toHaveBeenCalled();
    // 失败**不关窗**（用户填了半天的东西要留着）
    expect(onCloseSpy).not.toHaveBeenCalled();
  });

  it('★ 只填名称（缺起止日期）：仍不建项目 —— 证明**没有**被静默补默认日期', async () => {
    await renderDialog();
    await setInputValue(nameInput(), '只填了名称的看板');
    await click(firstStageChip()); // 阶段也给了，把失败点收敛到"日期"

    await click(submitBtn());
    await pump();

    expect(errorBox()).not.toBeNull();
    expect(errorBox()!.textContent).toContain('日期');
    expect(await projectCount()).toBe(0);
    expect(onCreatedSpy).not.toHaveBeenCalled();
  });

  it('★ 名称/日期都填了但**没选阶段**：不建项目（§6.1「阶段集合显式声明」）', async () => {
    await renderDialog();
    await setInputValue(nameInput(), '忘了选阶段的看板');
    await setInputValue(startInput(), START);
    await setInputValue(endInput(), END);

    await click(submitBtn());
    await pump();

    expect(errorBox()).not.toBeNull();
    expect(errorBox()!.textContent).toContain('阶段');
    expect(await projectCount()).toBe(0);
  });

  it('失败时**不清空**已填内容（与 ApplyPayloadPanel「失败保留输入」同约定）', async () => {
    await renderDialog();
    await setInputValue(nameInput(), '失败也要留着');
    await setInputValue(startInput(), START);
    await click(submitBtn());
    await pump();

    expect(nameInput().value).toBe('失败也要留着');
    expect(startInput().value).toBe(START);
  });
});

describe('CreateAgentBoardDialog · 正常填写 ⇒ 真建出一块 Agent 看板', () => {
  it('★ 名称＋起止日期＋阶段 → 落库 kind=agent，三件字段一致，且 onCreated/onClose 被调', async () => {
    await renderDialog();
    await setInputValue(nameInput(), '池边项目 · 排期');
    await setInputValue(startInput(), START);
    await setInputValue(endInput(), END);
    await click(firstStageChip());

    await submitAndWaitForProject();

    const projects = await bundle.projects.list({ status: 'all' });
    expect(projects).toHaveLength(1);
    const project = projects[0]!;
    // 归属侧恒为 agent —— 这是"人类项目一字不改"的保证在表单侧的体现
    expect(project.kind).toBe('agent');
    expect(project.name).toBe('池边项目 · 排期');
    expect(project.plannedStartAt).toBe(START);
    expect(project.plannedEndAt).toBe(END);

    // 阶段真的落了（至少 1 条，与"显式声明"一致）
    const stages = await bundle.stages.listByProject(project.id);
    expect(stages.length).toBeGreaterThanOrEqual(1);

    // 建完即选中：由页面回调负责（组件不自己发明路由）
    expect(onCreatedSpy).toHaveBeenCalledTimes(1);
    expect(onCreatedSpy).toHaveBeenCalledWith(project.id);
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('★ 成功后再开：表单是**干净的**（清空名称/日期/阶段），不是上一次的残留', async () => {
    await renderDialog();
    await setInputValue(nameInput(), '清空验证');
    await setInputValue(startInput(), START);
    await setInputValue(endInput(), END);
    await click(firstStageChip());
    await submitAndWaitForProject();

    expect(nameInput().value).toBe('');
    expect(startInput().value).toBe('');
    expect(endInput().value).toBe('');
    expect(document.body.textContent).toContain('已选 0 项');
  });

  it('阶段名可读：落库的阶段名与池中芯片同名（不是 key / 占位符）', async () => {
    await renderDialog();
    const chipName = (firstStageChip().getAttribute('aria-label') ?? '').replace('选择阶段 ', '');
    expect(chipName.trim()).not.toBe('');

    await setInputValue(nameInput(), '阶段名对照');
    await setInputValue(startInput(), START);
    await setInputValue(endInput(), END);
    await click(firstStageChip());
    await submitAndWaitForProject();

    const project = (await bundle.projects.list({ status: 'all' }))[0]!;
    const stages = await bundle.stages.listByProject(project.id);
    expect(stages.map((s) => s.name)).toContain(chipName.trim());
  });
});

/* ═══════════════════════ 源码层（"不存在某结构"类约束） ═══════════════════════ */

function readSrc(relFromTests: string): string {
  return readFileSync(resolve(__dirname, '..', relFromTests), 'utf8');
}

describe('§7.4 权限：建板路径上**没有**角色闸门', () => {
  const dialogSrc = readSrc('src/components/agent/CreateAgentBoardDialog.tsx');

  it('★ 表单组件源码里不出现 `useRoleGuard` / `isAdmin`（member 与 admin 同等可建）', () => {
    expect(dialogSrc).not.toContain('useRoleGuard');
    expect(dialogSrc).not.toContain('isAdmin');
    // 也不应该按角色把提交按钮 disabled 掉
    expect(dialogSrc).not.toMatch(/disabled=\{[^}]*role/i);
  });

  it('正向对照：它**确实**经 store action 建板（不是对空文件的假绿）', () => {
    expect(dialogSrc).toContain('createProjectActions');
    expect(dialogSrc).toContain('createAgentBoard');
  });

  it('★ 页面接线（§6.1 第 1 步）：`AgentBoardPage` 把 onCreate 接到列表 ＋ 渲染对话框', () => {
    const pageSrc = readSrc('src/pages/AgentBoardPage.tsx');
    // ① 空态里仍有入口（0 块看板时必须留活路，否则页面是死胡同）
    expect(pageSrc).toContain('onCreate={() => setCreateOpen(true)}');
    // ② 对话框被渲染，且成功后选中新看板（用页面已有的选中机制，无新路由态）
    expect(pageSrc).toContain('<CreateAgentBoardDialog');
    expect(pageSrc).toContain('onCreated={(id) => setCurrentProject(id)}');
  });

  it('★ 反馈 #8 收口：工具条**不再**常驻「新建 Agent 看板」按钮，改为现状说明', () => {
    const pageSrc = readSrc('src/pages/AgentBoardPage.tsx');
    // 常驻入口撤掉（能力还没准备好，留着就是误导）
    expect(pageSrc).not.toContain('data-agent-create-open');
    // 换成一段把现状讲明白的说明（不能只是「删了按钮」了事）
    expect(pageSrc).toContain('data-agent-stance');
    expect(pageSrc).toContain('本机自动导入');
    // 底层能力与对话框**没有被删**（收口的是入口，不是功能）
    expect(pageSrc).toContain('createAgentBoard');
    expect(pageSrc).toContain('<CreateAgentBoardDialog');
  });
});
