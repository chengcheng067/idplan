// @vitest-environment jsdom
/**
 * 休息制度编辑器 · 单休自定义休息周几（v3 §4.3）。
 *
 * 覆盖：
 *   ① 七选一仅单休档出现（双休/大小休隐藏），默认选中周日（6）；
 *   ② 点选 → draft 更新 → 保存 → settings 落库 singleRestWeekday（fake repos）；
 *   ③ 已存周几读回高亮（setState 预置 restPolicy）；
 *   ④ 旧结论文案「已排定阶段日期不会因切换制度而变更」已不在 DOM（v3 作废）；
 *   ⑤ hydrate 边界归一：normalizeRestPolicy / hydrateRestPolicy 对
 *      singleRestWeekday 的保留与回落（0-6 保留；7/-1/'2'/2.5/缺省回落 undefined）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { RestPolicyEditor } from '../src/components/settings/RestPolicyDialog';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { normalizeRestPolicy, hydrateRestPolicy } from '../src/core/holidays/policy';
import { DEFAULT_REST_POLICY } from '../src/core/types/entities';
import type { RestPolicyConfig } from '../src/core/types/entities';
import { RestPolicyKind } from '../src/core/types/enums';
import { isRestDay } from '../src/lib/workdays';

/* fake repos：保存路径落点（渲染期不触达，故无需 RepoProvider） */
const hoisted = vi.hoisted(() => ({
  settingsSet: vi.fn(async (_key: string, _draft: unknown) => undefined),
}));
vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => ({
    settings: { set: hoisted.settingsSet, get: async () => null },
  }),
}));

const DOUBLE: RestPolicyConfig = { kind: RestPolicyKind.DoubleOff, anchorWeek: null };
const SINGLE_SUN: RestPolicyConfig = { kind: RestPolicyKind.SingleOff, anchorWeek: null };

let container: HTMLDivElement;
let root: Root;

function renderEditor(): void {
  act(() => {
    root.render(<RestPolicyEditor embedded />);
  });
}

/** 点三档单选里的某一项（label 文本） */
function pickKind(label: string): void {
  const labelEl = Array.from(container.querySelectorAll('label')).find((el) =>
    el.textContent?.includes(label),
  );
  const input = labelEl?.querySelector('input[type="radio"]') as HTMLInputElement | null;
  if (!input) throw new Error(`未找到制度单选：${label}`);
  act(() => {
    input.click();
  });
}

function weekdayBtn(idx: number): HTMLButtonElement {
  const btn = container.querySelector(`[data-testid="rest-weekday-${idx}"]`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`未找到休息日按钮：${idx}`);
  return btn;
}

beforeEach(() => {
  hoisted.settingsSet.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    useSettingsStore.setState({
      restPolicy: DEFAULT_REST_POLICY,
      effectiveRestPolicy: DEFAULT_REST_POLICY,
    });
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('RestPolicyEditor：单休自定义休息周几（七选一）', () => {
  it('双休档不渲染七选一', () => {
    renderEditor();
    expect(container.querySelector('[data-testid="single-rest-weekday"]')).toBeNull();
  });

  it('切到单休出现七选一，默认选中周日（6）', () => {
    renderEditor();
    pickKind('单休');
    const box = container.querySelector('[data-testid="single-rest-weekday"]');
    expect(box).not.toBeNull();
    for (let idx = 0; idx <= 6; idx += 1) {
      expect(weekdayBtn(idx)).not.toBeNull();
    }
    expect(weekdayBtn(6).getAttribute('aria-pressed')).toBe('true');
    for (const idx of [0, 1, 2, 3, 4, 5]) {
      expect(weekdayBtn(idx).getAttribute('aria-pressed')).toBe('false');
    }
    // 「恢复默认」按钮仅在非周日时出现
    expect(box?.textContent).not.toContain('恢复默认');
  });

  it('点周三 → 高亮转移 → 保存 → 落库 singleRestWeekday=2 + store 镜像更新', async () => {
    renderEditor();
    pickKind('单休');
    act(() => {
      weekdayBtn(2).click();
    });
    expect(weekdayBtn(2).getAttribute('aria-pressed')).toBe('true');
    expect(weekdayBtn(6).getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-testid="single-rest-weekday"]')?.textContent).toContain(
      '恢复默认',
    );

    // 保存（async：settings.set → store 镜像 → toast）
    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('保存'),
    );
    expect(saveBtn).not.toBeUndefined();
    await act(async () => {
      saveBtn!.click();
    });
    expect(hoisted.settingsSet).toHaveBeenCalledTimes(1);
    const call = hoisted.settingsSet.mock.calls[0];
    expect(call[0]).toBe('restPolicy');
    const draft = call[1] as RestPolicyConfig;
    expect(draft.kind).toBe(RestPolicyKind.SingleOff);
    expect(draft.singleRestWeekday).toBe(2);
    // store 镜像同步（hydrate 边界派生 effectiveRestPolicy）
    expect(useSettingsStore.getState().restPolicy.singleRestWeekday).toBe(2);
  });

  it('「恢复默认（周日）」按钮把周几重置为 6', () => {
    renderEditor();
    pickKind('单休');
    act(() => {
      weekdayBtn(0).click();
    });
    const restoreBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('恢复默认'),
    );
    expect(restoreBtn).not.toBeUndefined();
    act(() => {
      restoreBtn!.click();
    });
    expect(weekdayBtn(6).getAttribute('aria-pressed')).toBe('true');
    expect(weekdayBtn(0).getAttribute('aria-pressed')).toBe('false');
  });

  it('切到双休/大小休时七选一隐藏', () => {
    renderEditor();
    pickKind('单休');
    expect(container.querySelector('[data-testid="single-rest-weekday"]')).not.toBeNull();
    pickKind('双休');
    expect(container.querySelector('[data-testid="single-rest-weekday"]')).toBeNull();
    pickKind('单休');
    pickKind('大小休');
    expect(container.querySelector('[data-testid="single-rest-weekday"]')).toBeNull();
  });

  it('已存周几读回高亮（restPolicy.singleRestWeekday=3 → 周四选中）', () => {
    act(() => {
      useSettingsStore.setState({
        restPolicy: { kind: RestPolicyKind.SingleOff, anchorWeek: null, singleRestWeekday: 3 },
        effectiveRestPolicy: {
          kind: RestPolicyKind.SingleOff,
          anchorWeek: null,
          singleRestWeekday: 3,
        },
      });
    });
    renderEditor();
    pickKind('单休');
    expect(weekdayBtn(3).getAttribute('aria-pressed')).toBe('true');
    expect(weekdayBtn(6).getAttribute('aria-pressed')).toBe('false');
  });

  it('v3 作废旧结论：DOM 不含「已排定的阶段日期不会因切换制度」文案', () => {
    renderEditor();
    expect(container.textContent).not.toContain('不会因切换制度');
    expect(container.textContent).toContain('重算');
  });
});

/**
 * 草稿同步守门（2026-10-09 反馈：选了单休周三但月历不跟随）。
 * 根因：`useState(saved)` 是惰性初值，saved 异步 hydrate（bootstrapAllStores →
 * normalizeRestPolicy）回来后草稿不跟 ⇒ 编辑器显示的（draft）与实际生效的
 * （effectiveRestPolicy ← saved）成了两个源。修法：saved 变化且用户未编辑时
 * 同步草稿；编辑中不跟随；重挂载天然重置（打开边界无脏值残留）。
 */
describe('RestPolicyEditor：草稿与 saved 同步（hydrate / 编辑门 / 重开重置）', () => {
  const SINGLE_WED: RestPolicyConfig = {
    kind: RestPolicyKind.SingleOff,
    anchorWeek: null,
    singleRestWeekday: 2,
  };

  it('hydrate 后同步：挂载时 saved 还是出厂默认，hydrate 回来（单休周三）→ 编辑器跟上', () => {
    // 模拟挂载瞬间：saved 尚未 hydrate（bootstrap 异步）
    act(() => {
      useSettingsStore.setState({
        restPolicy: DEFAULT_REST_POLICY,
        effectiveRestPolicy: DEFAULT_REST_POLICY,
      });
    });
    renderEditor();
    // 挂载瞬间：双休选中、无七选一
    expect(container.querySelector('[data-testid="single-rest-weekday"]')).toBeNull();

    // saved hydrate 回来（settings 行 → normalizeRestPolicy → store）
    act(() => {
      useSettingsStore.setState({
        restPolicy: SINGLE_WED,
        effectiveRestPolicy: SINGLE_WED,
      });
    });
    // 草稿同步：单休档 + 周三高亮（编辑器显示的与月历生效的同一个源）
    const box = container.querySelector('[data-testid="single-rest-weekday"]');
    expect(box).not.toBeNull();
    expect(weekdayBtn(2).getAttribute('aria-pressed')).toBe('true');
    expect(weekdayBtn(6).getAttribute('aria-pressed')).toBe('false');
  });

  it('编辑中不跟随：用户动过草稿后 saved 后台变化不冲掉未保存的编辑', () => {
    act(() => {
      useSettingsStore.setState({
        restPolicy: SINGLE_WED,
        effectiveRestPolicy: SINGLE_WED,
      });
    });
    renderEditor();
    // 用户在编辑器里改选双休（dirty）
    pickKind('双休');
    expect(container.querySelector('[data-testid="single-rest-weekday"]')).toBeNull();
    // saved 后台变化（hydrate 迟到/别处改制度）→ 草稿不被冲掉
    act(() => {
      useSettingsStore.setState({
        restPolicy: { kind: RestPolicyKind.BigSmallWeek, anchorWeek: '2026-W37' },
        effectiveRestPolicy: { kind: RestPolicyKind.BigSmallWeek, anchorWeek: '2026-W37' },
      });
    });
    // 仍是用户选的「双休」（七选一隐藏 = 非单休档）
    expect(container.querySelector('[data-testid="single-rest-weekday"]')).toBeNull();
    const radio = Array.from(container.querySelectorAll('input[type="radio"]')).find(
      (el) => (el as HTMLInputElement).value === 'double_off',
    ) as HTMLInputElement | undefined;
    expect(radio?.checked).toBe(true);
  });

  it('重开重置：编辑到一半未保存 → 卸载重挂（关开设置）→ 草稿回到 saved，无脏值残留', () => {
    act(() => {
      useSettingsStore.setState({
        restPolicy: DEFAULT_REST_POLICY,
        effectiveRestPolicy: DEFAULT_REST_POLICY,
      });
    });
    renderEditor();
    // 编辑到一半（脏）：选单休 + 周三，不保存
    pickKind('单休');
    act(() => {
      weekdayBtn(2).click();
    });
    expect(weekdayBtn(2).getAttribute('aria-pressed')).toBe('true');
    // 卸载（关设置抽屉/切 zone）
    act(() => {
      root.unmount();
    });
    // saved 已是单休周三（此前保存过）→ 重挂载草稿直接取它（新 root：unmount 后不可复用）
    act(() => {
      useSettingsStore.setState({
        restPolicy: SINGLE_WED,
        effectiveRestPolicy: SINGLE_WED,
      });
    });
    root = createRoot(container);
    renderEditor();
    pickKind('单休');
    expect(weekdayBtn(2).getAttribute('aria-pressed')).toBe('true');
    expect(weekdayBtn(6).getAttribute('aria-pressed')).toBe('false');
  });
});

/* ------------------------------ 双休自定义多选（§4.6） ------------------------------ */

function doubleBtn(idx: number): HTMLButtonElement {
  const btn = container.querySelector(`[data-testid="double-rest-day-${idx}"]`) as HTMLButtonElement | null;
  if (!btn) throw new Error(`未找到双休日按钮：${idx}`);
  return btn;
}

function doubleBox(): HTMLElement | null {
  return container.querySelector('[data-testid="double-rest-weekdays"]');
}

describe('RestPolicyEditor：双休自定义两个休息日（多选，§4.6）', () => {
  it('双休档出现多选块，默认周六(5)+周日(6)选中；单休/大小休档隐藏', () => {
    renderEditor();
    expect(doubleBox()).not.toBeNull();
    expect(doubleBtn(5).getAttribute('aria-pressed')).toBe('true');
    expect(doubleBtn(6).getAttribute('aria-pressed')).toBe('true');
    for (const idx of [0, 1, 2, 3, 4]) {
      expect(doubleBtn(idx).getAttribute('aria-pressed')).toBe('false');
    }
    expect(doubleBox()?.textContent).toContain('周六 + 周日');
    pickKind('单休');
    expect(doubleBox()).toBeNull();
    pickKind('双休');
    expect(doubleBox()).not.toBeNull();
    pickKind('大小休');
    expect(doubleBox()).toBeNull();
  });

  it('满两天忽略：默认态点未选日不生效', () => {
    renderEditor();
    act(() => {
      doubleBtn(0).click(); // 周一：已满两天 → 忽略
    });
    expect(doubleBtn(0).getAttribute('aria-pressed')).toBe('false');
    expect(doubleBtn(5).getAttribute('aria-pressed')).toBe('true');
    expect(doubleBtn(6).getAttribute('aria-pressed')).toBe('true');
  });

  it('取消 + 加入：周日取消 → 周一加入 → (0,5) 升序，标题行「周一 + 周六」', () => {
    renderEditor();
    act(() => {
      doubleBtn(6).click(); // 取消周日
    });
    expect(doubleBtn(6).getAttribute('aria-pressed')).toBe('false');
    expect(doubleBtn(5).getAttribute('aria-pressed')).toBe('true');
    act(() => {
      doubleBtn(0).click(); // 加入周一
    });
    expect(doubleBtn(0).getAttribute('aria-pressed')).toBe('true');
    expect(doubleBox()?.textContent).toContain('周一 + 周六');
    // 「恢复默认」钮出现（非默认态）
    expect(container.querySelector('[data-testid="double-rest-restore"]')).not.toBeNull();
  });

  it('至少保留一天：取消到剩 1 天后再点已选 → 忽略 + 出现「需选满两天」提示', () => {
    renderEditor();
    act(() => {
      doubleBtn(6).click(); // 剩 (5,)
    });
    expect(doubleBox()?.querySelector('[data-testid="double-rest-incomplete"]')).not.toBeNull();
    act(() => {
      doubleBtn(5).click(); // 最后一个 → 忽略
    });
    expect(doubleBtn(5).getAttribute('aria-pressed')).toBe('true');
  });

  it('恢复默认（周六+周日）钮：点击后回默认且钮消失', () => {
    renderEditor();
    act(() => {
      doubleBtn(6).click();
      doubleBtn(0).click();
    });
    const restore = container.querySelector('[data-testid="double-rest-restore"]') as HTMLButtonElement;
    expect(restore).not.toBeNull();
    act(() => {
      restore.click();
    });
    expect(doubleBtn(5).getAttribute('aria-pressed')).toBe('true');
    expect(doubleBtn(6).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="double-rest-restore"]')).toBeNull();
  });

  it('保存 → settings 落库 doubleRestWeekdays=[0,5]（升序）+ store 镜像', async () => {
    renderEditor();
    act(() => {
      doubleBtn(6).click();
      doubleBtn(0).click();
    });
    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('保存'),
    );
    await act(async () => {
      saveBtn!.click();
    });
    expect(hoisted.settingsSet).toHaveBeenCalledTimes(1);
    const draft = hoisted.settingsSet.mock.calls[0][1] as RestPolicyConfig;
    expect(draft.kind).toBe(RestPolicyKind.DoubleOff);
    expect(draft.doubleRestWeekdays).toEqual([0, 5]);
    expect(useSettingsStore.getState().restPolicy.doubleRestWeekdays).toEqual([0, 5]);
  });

  it('保存闸门：1 天瞬态 → 保存按钮禁用 + 点击不落库', async () => {
    renderEditor();
    act(() => {
      doubleBtn(6).click(); // 剩 (5,)
    });
    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('保存'),
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    await act(async () => {
      saveBtn.click();
    });
    expect(hoisted.settingsSet).not.toHaveBeenCalled();
  });

  it('已存 [0,4] 读回高亮（周一+周五）', () => {
    act(() => {
      useSettingsStore.setState({
        restPolicy: { kind: RestPolicyKind.DoubleOff, anchorWeek: null, doubleRestWeekdays: [0, 4] },
        effectiveRestPolicy: {
          kind: RestPolicyKind.DoubleOff,
          anchorWeek: null,
          doubleRestWeekdays: [0, 4],
        },
      });
    });
    renderEditor();
    expect(doubleBtn(0).getAttribute('aria-pressed')).toBe('true');
    expect(doubleBtn(4).getAttribute('aria-pressed')).toBe('true');
    expect(doubleBtn(5).getAttribute('aria-pressed')).toBe('false');
    expect(doubleBtn(6).getAttribute('aria-pressed')).toBe('false');
    expect(doubleBox()?.textContent).toContain('周一 + 周五');
  });

  it('skipHolidays 脚注：重算上线后旧文案「已排定的阶段日期不变」已不在 DOM', () => {
    renderEditor();
    expect(container.textContent).not.toContain('已排定的阶段日期不变');
    expect(container.textContent).toContain('重算已排阶段');
  });
});

describe('hydrate 边界：singleRestWeekday 归一', () => {
  it('0-6 原样保留', () => {
    for (const v of [0, 1, 2, 3, 4, 5, 6]) {
      expect(
        normalizeRestPolicy({ kind: 'single_off', anchorWeek: null, singleRestWeekday: v })
          .singleRestWeekday,
      ).toBe(v);
    }
  });

  it('缺省 / 越界 / 非整数字符串 ⇒ undefined（读时回落周日）', () => {
    const base = { kind: 'single_off', anchorWeek: null };
    expect(normalizeRestPolicy(base).singleRestWeekday).toBeUndefined();
    expect(normalizeRestPolicy({ ...base, singleRestWeekday: 7 }).singleRestWeekday).toBeUndefined();
    expect(normalizeRestPolicy({ ...base, singleRestWeekday: -1 }).singleRestWeekday).toBeUndefined();
    expect(normalizeRestPolicy({ ...base, singleRestWeekday: '2' }).singleRestWeekday).toBeUndefined();
    expect(normalizeRestPolicy({ ...base, singleRestWeekday: 2.5 }).singleRestWeekday).toBeUndefined();
  });

  it('settings JSON 往返（hydrateRestPolicy）不丢周几', () => {
    const raw = { kind: 'single_off', anchorWeek: null, singleRestWeekday: 2 };
    const roundtrip = normalizeRestPolicy(JSON.parse(JSON.stringify(raw)));
    expect(roundtrip.singleRestWeekday).toBe(2);
    expect(hydrateRestPolicy(raw).singleRestWeekday).toBe(2);
  });

  it('双休档带 singleRestWeekday 不影响判定（周六仍休）', () => {
    const p = normalizeRestPolicy({
      kind: 'double_off',
      anchorWeek: null,
      singleRestWeekday: 2,
    });
    expect(isRestDay('2026-09-12', p)).toBe(true); // 周六
    expect(isRestDay('2026-09-13', p)).toBe(true); // 周日
  });

  it('出厂默认与缺省单休均按周日判定', () => {
    expect(isRestDay('2026-09-13', SINGLE_SUN)).toBe(true);
    expect(isRestDay('2026-09-12', SINGLE_SUN)).toBe(false);
    expect(isRestDay('2026-09-13', DOUBLE)).toBe(true);
  });
});
