// @vitest-environment jsdom
/**
 * 客户行程单（打印页）· 反馈 #6 的交付面。
 *
 * 这份测试要证明的是「**客户拿到手能看到什么**」，而不是「组件存在」：
 *   · 每一天都有交通 / 住宿 / 安排 / 预算 / 实际，且**按日期升序**（客户照着走）；
 *   · 抬头给出周期、天数与三笔合计（预算 / 实际 / 差额）——谈钱不靠猜；
 *   · `null` 金额显示 `—`，**绝不显示 ¥0**（那会伪造「已确认零花费」）；
 *   · 非旅游项目明确说明「没有行程单」，不渲染空表格（避免用户以为数据丢了）；
 *   · 打印子树带 `.print-root`（暗色主题下也强制出浅色稿，见 global.css）。
 *
 * 只顶掉数据来源（仓储 + 当前项目 + 身份），渲染走真实组件。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import type { ItineraryDay, Project, Task } from '../src/core/types/entities';

const PROJECT = {
  id: 'proj_travel_1',
  name: '云南七日·亲子团',
  address: '昆明—大理—丽江',
  clientName: '张女士',
  plannedStartAt: '2026-10-01',
  plannedEndAt: '2026-10-03',
  domain: 'travel',
} as unknown as Project;

let project: Project | undefined = PROJECT;
let dayRows: ItineraryDay[] = [];
let taskRows: Array<Partial<Task>> = [];

/**
 * ⚠️ 仓储替身必须是**模块级常量对象**：
 *   真实 `useRepos()` 返回的是 Context 里那个稳定引用；若替身每次调用都 new 一个对象，
 *   页面的 `useEffect(..., [project, isTravel, repos])` 就会「每次渲染都依赖变化」⇒
 *   setState → 重渲染 → 新 repos → effect 再跑 ⇒ **无限循环**，
 *   表现为 `await act()` 永不返回、用例 5 秒超时（本文件曾因此整片假红）。
 */
const reposStub = {
  itineraries: { listByProject: async () => dayRows },
  tasks: { listByProject: async () => taskRows },
};

vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => reposStub,
}));

vi.mock('../src/core/project/visibility', async (orig) => {
  const actual = await orig<typeof import('../src/core/project/visibility')>();
  return { ...actual, useProjectById: () => project };
});

vi.mock('../src/hooks/useRoleGuard', () => ({
  useRoleGuard: () => ({
    role: 'admin',
    isAdmin: true,
    isMember: false,
    isEntered: true,
    currentMember: null,
    hasAdmin: true,
    hydrated: true,
  }),
}));

const { ItineraryPrintPage } = await import('../src/pages/ItineraryPrintPage');

let root: Root;
let container: HTMLDivElement;

function day(date: string, extra: Partial<ItineraryDay> = {}): ItineraryDay {
  return {
    id: `itd_${date}`,
    projectId: PROJECT.id,
    date,
    transport: null,
    accommodation: null,
    budgetAmount: null,
    actualAmount: null,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    ...extra,
  } as ItineraryDay;
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/project/${PROJECT.id}/itinerary-print`]}>
        <Routes>
          <Route path="/project/:id/itinerary-print" element={<ItineraryPrintPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  // 取数是 effect 里的异步链（Promise.all + 两次 await）：多泵两轮 microtask，
  // 让 setDays/setTasks 落地并把 DOM 刷出来。不用真实定时器 —— 免得把 flaky 引进门。
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function text(): string {
  return document.body.textContent ?? '';
}

beforeEach(() => {
  project = PROJECT;
  dayRows = [];
  taskRows = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.removeChild(container);
});

describe('客户行程单 · 内容', () => {
  it('按日期升序列出每天：交通 / 住宿 / 安排 / 预算 / 实际', async () => {
    // 故意乱序给，验证页面自己排序（客户看到的必须是顺序）
    dayRows = [
      day('2026-10-03', { transport: '丽江→昆明 动车', accommodation: '返程', budgetAmount: 800, actualAmount: 760 }),
      day('2026-10-01', { transport: '抵达昆明 航班 MU5712', accommodation: '翠湖宾馆', budgetAmount: 1200, actualAmount: 1180 }),
      day('2026-10-02', { transport: '昆明→大理 高铁', accommodation: '洱海边民宿', budgetAmount: 1500, actualAmount: 1620 }),
    ];
    taskRows = [
      { id: 't1', title: '接机并送至酒店', itineraryDate: '2026-10-01' },
      { id: 't2', title: '洱海环湖骑行', itineraryDate: '2026-10-02' },
      { id: 't3', title: '无关任务（无归属日）', itineraryDate: null },
    ];

    await render();

    const rows = [...document.querySelectorAll('[data-itinerary-day]')];
    expect(rows.map((r) => r.getAttribute('data-itinerary-day'))).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);

    // 第 1 天：交通 + 住宿 + 当天安排
    expect(rows[0]!.textContent).toContain('抵达昆明 航班 MU5712');
    expect(rows[0]!.textContent).toContain('翠湖宾馆');
    expect(rows[0]!.textContent).toContain('接机并送至酒店');
    // 第 2 天的安排只出现在第 2 天（按 itineraryDate 归日，不串行）
    expect(rows[1]!.textContent).toContain('洱海环湖骑行');
    expect(rows[0]!.textContent).not.toContain('洱海环湖骑行');
    // 无归属日的任务不上单子
    expect(text()).not.toContain('无关任务（无归属日）');
  });

  it('抬头给出周期、天数与三笔合计（预算 / 实际 / 差额）', async () => {
    dayRows = [
      day('2026-10-01', { budgetAmount: 1200, actualAmount: 1180 }),
      day('2026-10-02', { budgetAmount: 1500, actualAmount: 1620 }),
      day('2026-10-03', { budgetAmount: 800, actualAmount: 760 }),
    ];
    await render();

    expect(text()).toContain('2026-10-01 — 2026-10-03');
    expect(text()).toContain('共 3 天');
    expect(text()).toContain('¥3,500'); // 预算合计
    expect(text()).toContain('¥3,560'); // 实际合计
    expect(text()).toContain('-¥60'); // 差额（超支为负，符号不能吞）
  });

  it('未填的金额显示 —，不显示 ¥0（不伪造「已确认零花费」）', async () => {
    dayRows = [day('2026-10-01', { transport: '自驾', budgetAmount: null, actualAmount: null })];
    await render();

    const row = document.querySelector('[data-itinerary-day]')!.textContent ?? '';
    expect(row).toContain('—');
    expect(row).not.toContain('¥0');
    // 全为 null ⇒ 合计行整块不出现（没有可谈的数就别占版面）
    expect(text()).not.toContain('预算合计');
  });

  it('打印稿锁定浅色（print-root）且工具条不进打印', async () => {
    dayRows = [day('2026-10-01')];
    await render();

    expect(document.querySelector('.print-root')).not.toBeNull();
    const toolbarBtn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('打印'),
    );
    expect(toolbarBtn!.closest('.print\\:hidden')).not.toBeNull();
  });
});

describe('客户行程单 · 边界', () => {
  it('非旅游项目：明确说明没有行程单，且不渲染空表格', async () => {
    project = { ...PROJECT, domain: 'indoor' } as unknown as Project;
    dayRows = [day('2026-10-01')];
    await render();

    expect(text()).toContain('不是旅游项目，没有客户行程单');
    expect(document.querySelector('[data-itinerary-print-table]')).toBeNull();
    // 也不该把室内项目的数据当成行程单打印出来
    expect(text()).not.toContain('交通');
  });

  it('还没有每日行程：给出「先去项目详情设置行程」的引导，而不是空表', async () => {
    dayRows = [];
    await render();

    expect(text()).toContain('还没有每日行程');
    expect(document.querySelector('[data-itinerary-print-table]')).toBeNull();
  });

  it('项目不存在：给返回列表的出口', async () => {
    project = undefined;
    await render();
    expect(text()).toContain('未找到该项目');
    expect(text()).toContain('返回项目列表');
  });
});
