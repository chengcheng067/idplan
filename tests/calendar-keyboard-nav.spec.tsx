// @vitest-environment jsdom
/**
 * F7 · 月历网格键盘可达（roving tabindex）——回归网。
 *
 * ══════════════════ 本文件为什么存在 ══════════════════
 * 修前：日格是裸 `<div onClick aria-label>` —— 没有 role / tabIndex / 键处理，
 * Tab 永远落不到格子上（真机实测：130 次 Tab 遍历整页 1.25 轮，一次都没落到）。
 * 修后是 roving tabindex：整张网格**只有一格**在 Tab 序列里（今天），方向键移动焦点，
 * Enter/Space 选中。这套机制有三条**只有真跑起来才会发现**的坑，全部在此锁死：
 *
 *   ① 停靠点必须**只在格子本体被聚焦时**迁移。React 的 onFocus 走 focusin、**会冒泡**，
 *      格内条目按钮拿到焦点也会冒到格子上；不加 `e.target === e.currentTarget` 判断的话，
 *      键盘用户从网格前面进来时停靠点会被改写到**已经在身后**的格子，正向 Tab 反而
 *      再也落不到任何日格（真机实测的原始症状）。
 *   ② ←/→ 切月是**既有功能**，它挂在 window 上、不看 defaultPrevented：
 *      焦点在网格里时必须让位给网格，否则一次按键既跳格又翻月（实测选中日期从
 *      2026-10-12 变成 2026-11-01）。焦点不在网格里时，切月必须一字不改。
 *   ③ Enter/Space 走 `onSelect`，不另开一份「当前格」真相。
 *
 * ══════════════════ 为什么是 jsdom ══════════════════
 * 断言全是**结构契约**（tabindex 驻留、aria-pressed 归属、焦点落点、store 的月份）。
 * 列数从 `getComputedStyle(grid).gridTemplateColumns` 读（月/周视图共用本组件的必然选择），
 * jsdom 无布局 ⇒ 空串 ⇒ 回落 7 —— 这正好与桌面月视图的 7 列一致，故 ↑/↓ 断言 ±7 有效；
 * 「真的是 7 列」由真机走查背书（本批已做，见交付说明），此处不重复造轮子。
 *
 * ══════════════════ 夹具口径 ══════════════════
 * 1 个管理员（全量项目可见）+ 1 个覆盖整月的进行中项目（工作日都能落到条目 ⇒
 * 「格内条目」这条路径真的存在，②③ 才测得到）。今天钉成补班工作日，周末跑也不红。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { MonthlyCalendarView } from '../src/components/calendar/MonthlyCalendarView';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import { __resetRegistryForTest } from '../src/core/color/custom-color-registry';
import type { Member, Project, Stage } from '../src/core/types/entities';
import { DEFAULT_REST_POLICY } from '../src/core/types/entities';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
} from '../src/core/types/enums';
import { dayjs } from '../src/lib/date';

/* ══════════════════════════════ 夹具 ══════════════════════════════ */

const TODAY = dayjs().format('YYYY-MM-DD');
const MONTH = TODAY.slice(0, 7);
const MONTH_START = `${MONTH}-01`;
const MONTH_END = dayjs(MONTH_START).endOf('month').format('YYYY-MM-DD');

const ADMIN: Member = {
  id: 'mem_kbd_admin',
  name: '键盘探针管理员',
  role: '负责人',
  contact: null,
  avatarColor: '#88A293',
  active: true,
  roleKind: MemberRoleKind.Admin,
  passwordHash: null,
  actorKind: MemberActorKind.Human,
  agentKind: null,
  revision: 1,
  updatedAt: '2026-10-01T00:00:00Z',
};

const PROJECT: Project = {
  id: 'proj_kbd_main',
  name: '键盘项目',
  address: '',
  clientName: '客户甲',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: `${MONTH_START}T00:00:00Z`,
  plannedEndAt: `${MONTH_END}T23:59:59Z`,
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  domain: null,
  kind: 'human',
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-10-01T00:00:00Z',
  ownerMemberId: null,
};

const STAGE: Stage = {
  id: 'stg_kbd_main',
  projectId: PROJECT.id,
  orderIndex: 1,
  templateKey: null,
  colorIndex: 1,
  customColor: null,
  name: '键盘阶段',
  ratioPercent: 100,
  startAt: `${MONTH_START}T00:00:00Z`,
  endAt: `${MONTH_END}T23:59:59Z`,
  status: StageStatus.InProgress,
  ownerId: null,
  visible: true,
  resourcePath: null,
  revision: 1,
  updatedAt: '2026-10-01T00:00:00Z',
};

/* ══════════════════════════════ 脚手架 ══════════════════════════════ */

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function unmountCurrent(): void {
  const r = root;
  if (r !== null) {
    act(() => {
      r.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
}

/** jsdom 缺 matchMedia / ResizeObserver；恒桌面稿（折叠阈值 4、桌面浮层形态） */
function installEnvStubs(): void {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  w.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

function mountView(): void {
  unmountCurrent();
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  const r = createRoot(h);
  root = r;
  act(() => {
    r.render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MonthlyCalendarView />} />
          <Route path="/project/:id" element={<div data-project-open="">项目详情占位</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

/* ══════════════════════════════ 查询助手 ══════════════════════════════ */

function cells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-day-cell]')];
}

/** 整张网格里 tabIndex=0 的格子（roving 停靠点，恒 0 或 1 个） */
function tabStopCells(): HTMLElement[] {
  return cells().filter((c) => c.getAttribute('tabindex') === '0');
}

function todayCell(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-day-cell][aria-label*="（今天）"]');
  if (el === null) throw new Error('未找到今天日期格');
  return el;
}

/** 有格内条目按钮、且不是今天的格子（用来测「焦点落在格内条目上」） */
function cellWithEntriesNotToday(): HTMLElement {
  const el = cells().find(
    (c) =>
      !c.hasAttribute('aria-label') === false &&
      (c.getAttribute('aria-label') ?? '').includes('（今天）') === false &&
      c.querySelector('button[aria-label^="打开项目"]') !== null,
  );
  if (el === undefined) throw new Error('未找到「带条目且非今天」的格子');
  return el;
}

function focusedDate(): string | null {
  return document.activeElement?.getAttribute('data-day-date') ?? null;
}

/** 在 act 里派发一次 keydown（React 18 把 onKeyDown 挂在根容器上） */
function pressKey(target: HTMLElement | Window, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/** 在 act 里聚焦（jsdom 的 focus 事件是同步派发的） */
function focusEl(el: HTMLElement): void {
  act(() => {
    el.focus();
  });
}

/** 选中格集合（aria-pressed=true） */
function selectedDates(): string[] {
  return cells()
    .filter((c) => c.getAttribute('aria-pressed') === 'true')
    .map((c) => c.getAttribute('data-day-date') ?? '');
}

/* ══════════════════════════════ 用例 ══════════════════════════════ */

beforeEach(() => {
  localStorage.clear();
  __resetRegistryForTest();
  installEnvStubs();
  unmountCurrent();
  const pinned = { ...DEFAULT_REST_POLICY, extraWorkdays: [TODAY] };
  act(() => {
    useProjectsStore.getState().replaceAll({
      projects: [PROJECT],
      stages: [STAGE],
      tasks: [],
    });
    useMembersStore.getState().setAll([ADMIN]);
    useSettingsStore.setState({
      currentMemberId: ADMIN.id,
      hydrated: true,
      restPolicy: pinned,
      effectiveRestPolicy: pinned,
    });
  });
  useUiStore.getState().setCalendarMonth(MONTH);
  useUiStore.setState({ calendarFilters: { status: new Set(), stage: new Set() } });
});

afterEach(() => {
  unmountCurrent();
  act(() => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  });
  __resetRegistryForTest();
});

describe('F7 · 月历网格键盘可达（roving tabindex）', () => {
  it('月视图 42 格：全部 role=button，但整张网格只有 1 个 Tab 停靠点（今天）', () => {
    mountView();
    const all = cells();
    expect(all, '月视图 = 6×7 网格').toHaveLength(42);
    expect(
      all.filter((c) => c.getAttribute('role') === 'button'),
      '42 格全挂 role=button（aria-label 才有可聚焦宿主）',
    ).toHaveLength(42);
    const stops = tabStopCells();
    expect(stops, '整张网格恰有 1 格进 Tab 序列（42 格全进会把键盘用户困住）').toHaveLength(1);
    expect(stops[0].getAttribute('data-day-date'), '默认停靠点 = 今天').toBe(TODAY);
  });

  it('停靠点只在格子本体被聚焦时迁移；焦点落在格内条目上不迁移（focusin 冒泡回归）', () => {
    mountView();
    const withEntries = cellWithEntriesNotToday();
    const itsDate = withEntries.getAttribute('data-day-date') as string;

    // 正向：格子本体被聚焦 ⇒ 停靠点跟过去（这条同时证明 jsdom 真的派发了 React 的 onFocus，
    // 否则下一条会因为「事件根本没到」而假绿）
    focusEl(withEntries);
    expect(focusedDate(), '格子本体确实拿到了焦点').toBe(itsDate);
    expect(tabStopCells().map((c) => c.getAttribute('data-day-date')), '停靠点迁到该格').toEqual([
      itsDate,
    ]);

    // 反向：焦点落到**格内条目按钮**上 ⇒ 停靠点不动（这是真机上「Tab 永远落不到日格」的根因）
    mountView(); // 重挂：停靠点回到今天
    const cell = cellWithEntriesNotToday();
    const entry = cell.querySelector<HTMLElement>('button[aria-label^="打开项目"]');
    if (entry === null) throw new Error('格内未找到条目按钮');
    focusEl(entry);
    expect(document.activeElement, '条目按钮拿到了焦点').toBe(entry);
    expect(
      tabStopCells().map((c) => c.getAttribute('data-day-date')),
      '格内条目获得焦点不得改写停靠点',
    ).toEqual([TODAY]);
  });

  it('方向键：←/→ 前后一格，↑/↓ 上下 7 格（列数从计算样式读，jsdom 回落 7）', () => {
    mountView();
    const all = cells();
    const start = all[8]; // 取靠前但不在首行的格，四向都不会越界
    focusEl(start);
    expect(focusedDate()).toBe(start.getAttribute('data-day-date'));

    pressKey(start, 'ArrowRight');
    expect(all.indexOf(document.activeElement as HTMLElement), '→ = +1').toBe(9);
    pressKey(document.activeElement as HTMLElement, 'ArrowDown');
    expect(all.indexOf(document.activeElement as HTMLElement), '↓ = +7').toBe(16);
    pressKey(document.activeElement as HTMLElement, 'ArrowLeft');
    expect(all.indexOf(document.activeElement as HTMLElement), '← = -1').toBe(15);
    pressKey(document.activeElement as HTMLElement, 'ArrowUp');
    expect(all.indexOf(document.activeElement as HTMLElement), '↑ = -7').toBe(8);
    expect(tabStopCells(), '走一圈后停靠点始终只有 1 个').toHaveLength(1);
  });

  it('Home/End：到本行首/尾（行 = 7 格）', () => {
    mountView();
    const all = cells();
    const start = all[11]; // 第二行中间（rowStart = 7）
    focusEl(start);
    pressKey(document.activeElement as HTMLElement, 'End');
    expect(all.indexOf(document.activeElement as HTMLElement), 'End = 行尾 13').toBe(13);
    pressKey(document.activeElement as HTMLElement, 'Home');
    expect(all.indexOf(document.activeElement as HTMLElement), 'Home = 行首 7').toBe(7);
  });

  it('Enter / Space = 选中该格（aria-pressed 跟随，且只选中一格）', () => {
    mountView();
    const all = cells();
    const target = all[9];
    const date = target.getAttribute('data-day-date') as string;
    focusEl(target);
    expect(selectedDates(), '初始选中 = 今天').toEqual([TODAY]);

    pressKey(target, 'Enter');
    expect(selectedDates(), 'Enter 选中焦点格').toEqual([date]);

    pressKey(target, ' ');
    expect(selectedDates(), 'Space 同样选中（不重复、不叠加）').toEqual([date]);
  });

  it('←/→ 切月的既有快捷键：焦点在网格外仍生效，焦点在日格里让位给网格', () => {
    mountView();
    const before = useUiStore.getState().calendarMonth;

    // 焦点在网格外（body / 工具行按钮）⇒ 切月照旧
    focusEl(document.body as unknown as HTMLElement);
    pressKey(window, 'ArrowRight');
    const afterRight = useUiStore.getState().calendarMonth;
    expect(afterRight, '网格外 ←/→ 仍然切月（既有功能不许被 F7 吃掉）').toBe(
      dayjs(`${before}-01`).add(1, 'month').format('YYYY-MM'),
    );
    pressKey(window, 'ArrowLeft');
    expect(useUiStore.getState().calendarMonth, '格子外能切回来').toBe(before);

    // 焦点在日格里 ⇒ 只跳格，不翻月。
    // 注意：必须把 keydown 派发在**被聚焦的格子**上（真机上按键的 target 就是焦点元素，
    // 再冒泡到 window）——直接派发在 window 上不会向下传到格子的 React onKeyDown。
    const all = cells();
    focusEl(all[9]);
    pressKey(all[9], 'ArrowRight');
    expect(useUiStore.getState().calendarMonth, '焦点在日格里时 ←/→ 不切月').toBe(before);
    expect(focusedDate(), '而是把焦点移到相邻格').toBe(all[10].getAttribute('data-day-date'));
  });
});
