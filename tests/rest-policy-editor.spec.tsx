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
  settingsSet: vi.fn(async () => undefined),
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
    const [key, draft] = hoisted.settingsSet.mock.calls[0] as [string, RestPolicyConfig];
    expect(key).toBe('restPolicy');
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
