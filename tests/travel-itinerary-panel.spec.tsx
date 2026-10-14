// @vitest-environment jsdom
/**
 * 旅游每日行程卡 · 删除路径（审计 F1-⑤）。
 *
 * 缺陷原文：面板上那个垃圾桶按钮点一下就 `await repos.itineraries.remove(day.id)`
 *   · **没有二次确认** —— 同仓所有 danger 操作（ProjectCard 的归档/删除）都走
 *     ConfirmDialog，只有这里一下就没；而这张卡上的交通/住宿/预算/实际是**手输后
 *     没有别处可查**的记录（删掉只剩备份里有）；
 *   · **没有 try/catch** —— 写库失败时 Promise 静默 reject、`setDays` 不执行，
 *     界面连一条 toast 都没有，用户看到「点了没反应」，会以为是自己没点中，
 *     于是再点一次（还是没反应）。
 *
 * 本 spec 钉住五条：
 *   ① 点垃圾桶**不落库**，先出 danger 确认框；
 *   ② 确认框**复述该日已填内容**（金额/交通/住宿），空卡则不复述；
 *   ③ 取消 → 零写入、卡片还在；
 *   ④ 确认 → 恰好一次 remove，卡片消失；
 *   ⑤ remove 抛错 → 有错误 toast、**卡片不被假删**（乐观更新不越界）。
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { TravelItineraryPanel } from '../src/components/travel/TravelItineraryPanel';
import { useProjectsStore } from '../src/store/useProjectsStore';
import type { ItineraryDay, Project } from '../src/core/types/entities';
import { ProjectStatus, ScheduleBasis } from '../src/core/types/enums';

const h = vi.hoisted(() => ({
  days: [] as ItineraryDay[],
  remove: vi.fn(async (_id: string): Promise<void> => undefined),
  update: vi.fn(async (id: string) => ({ id }) as unknown as ItineraryDay),
}));

/*
  ⚠️ repos 替身必须是**稳定对象**：面板的 `reload = useCallback(..., [repos, ...])`
  直接吃它的身份。每次渲染发新对象 ⇒ useCallback 每轮都变 ⇒ useEffect 自触发无限循环
  （表现是 act 永不 resolve，整份 spec 跑到超时）。真实 useRepos 返回的是稳定 context 值。
*/
const REPOS_STUB = {
  itineraries: {
    ensureProjectDays: async (): Promise<void> => undefined,
    listByProject: async (): Promise<ItineraryDay[]> => h.days,
    insert: (): Promise<ItineraryDay> => Promise.resolve(h.days[0]!),
    update: (id: string): Promise<ItineraryDay> => h.update(id),
    remove: (id: string): Promise<void> => h.remove(id),
  },
  tasks: { update: async (): Promise<void> => undefined },
};

vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => REPOS_STUB,
}));

const PROJECT: Project = {
  id: 'proj_travel',
  name: '九寨沟自由行',
  address: '',
  clientName: '',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: '2026-10-01T00:00:00Z',
  plannedEndAt: '2026-10-02T23:59:59Z',
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  domain: 'travel',
  kind: 'human',
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-09-07T00:00:00Z',
  ownerMemberId: null,
};

function day(id: string, date: string, patch: Partial<ItineraryDay> = {}): ItineraryDay {
  return {
    id,
    projectId: PROJECT.id,
    date,
    transport: null,
    accommodation: null,
    budgetAmount: null,
    actualAmount: null,
    note: null,
    revision: 1,
    updatedAt: '2026-09-07T00:00:00Z',
    ...patch,
  } as ItineraryDay;
}

const FILLED = day('itd_1', '2026-10-01', {
  transport: '高铁 G1234',
  accommodation: '九寨民宿',
  budgetAmount: 800,
  actualAmount: 650,
});
const EMPTY = day('itd_2', '2026-10-02');

let container: HTMLDivElement;
let root: Root;

async function render(): Promise<void> {
  await act(async () => {
    root.render(<TravelItineraryPanel project={PROJECT} />);
  });
}

function bodyText(): string {
  return document.body.textContent ?? '';
}

function trashButton(date: string): HTMLButtonElement {
  const btn = document.body.querySelector(
    `[data-testid="itinerary-day-${date}"] button[data-itinerary-remove]`,
  ) as HTMLButtonElement | null;
  if (!btn) throw new Error(`未找到 ${date} 的删除按钮`);
  return btn;
}

function confirmButton(label: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === label,
  ) as HTMLButtonElement | undefined;
  if (!btn) throw new Error(`未找到按钮：${label}`);
  return btn;
}

function cardExists(date: string): boolean {
  return document.body.querySelector(`[data-testid="itinerary-day-${date}"]`) !== null;
}

beforeEach(async () => {
  h.days = [FILLED, EMPTY];
  h.remove.mockClear();
  h.remove.mockResolvedValue(undefined);
  h.update.mockClear();
  act(() => {
    useProjectsStore.getState().replaceAll({ projects: [PROJECT], stages: [], tasks: [] });
    useProjectsStore.setState({ toasts: [] });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('F1-⑤ 行程卡删除', () => {
  it('点垃圾桶不落库：先出 danger 确认框，并复述该日已填内容', async () => {
    await render();
    expect(cardExists(FILLED.date)).toBe(true);

    await act(async () => {
      trashButton(FILLED.date).click();
    });

    expect(h.remove, '确认之前一次都不能写入').not.toHaveBeenCalled();
    expect(cardExists(FILLED.date), '取消前卡片不许提前消失').toBe(true);
    const text = bodyText();
    expect(text).toContain('删除行程卡');
    expect(text).toContain('确认删除 2026-10-01 的行程卡？');
    // 复述已填内容：交通 / 住宿 / 预算 / 实际（金额格式与汇总条同源）
    expect(text).toContain('高铁 G1234');
    expect(text).toContain('九寨民宿');
    expect(text).toContain('预算 ¥800');
    expect(text).toContain('实际 ¥650');
    expect(text).toContain('删除后不可恢复');
  });

  it('空卡：确认文案照旧，但**不**复述「该日已填」', async () => {
    await render();
    await act(async () => {
      trashButton(EMPTY.date).click();
    });
    const text = bodyText();
    expect(text).toContain('确认删除 2026-10-02 的行程卡？');
    expect(text).not.toContain('该日已填');
  });

  it('取消：零写入，卡片还在', async () => {
    await render();
    await act(async () => {
      trashButton(FILLED.date).click();
    });
    await act(async () => {
      confirmButton('取消').click();
    });
    expect(h.remove).not.toHaveBeenCalled();
    expect(cardExists(FILLED.date)).toBe(true);
    expect(bodyText()).not.toContain('确认删除 2026-10-01');
  });

  it('确认：恰好一次 remove，卡片从面板消失', async () => {
    await render();
    await act(async () => {
      trashButton(FILLED.date).click();
    });
    await act(async () => {
      confirmButton('删除').click();
    });
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.remove).toHaveBeenCalledWith(FILLED.id);
    expect(cardExists(FILLED.date)).toBe(false);
    expect(cardExists(EMPTY.date), '别的卡不受影响').toBe(true);
  });

  it('落库失败：有错误 toast，且**不假删**（卡片留在原地）', async () => {
    h.remove.mockRejectedValueOnce(new Error('idb write failed'));
    await render();
    await act(async () => {
      trashButton(FILLED.date).click();
    });
    await act(async () => {
      confirmButton('删除').click();
    });

    const toasts = useProjectsStore.getState().toasts;
    expect(toasts.map((t) => t.message)).toContain('删除行程卡失败，请重试。');
    expect(cardExists(FILLED.date), '失败时不许把卡片从界面抹掉').toBe(true);
  });

  it('该日已排任务时按钮仍是禁用的（既有守卫不回退）', async () => {
    act(() => {
      useProjectsStore.getState().replaceAll({
        projects: [PROJECT],
        stages: [],
        tasks: [
          {
            id: 'tsk_x',
            taskNo: 1,
            projectId: PROJECT.id,
            stageId: 'stg_x',
            title: '接机',
            done: false,
            assigneeId: null,
            assigneeIds: [],
            dueDate: null,
            source: 'human',
            itineraryDate: FILLED.date,
          } as never,
        ],
      });
    });
    await render();
    expect(trashButton(FILLED.date).disabled).toBe(true);
    await act(async () => {
      trashButton(FILLED.date).click();
    });
    expect(h.remove).not.toHaveBeenCalled();
  });
});
