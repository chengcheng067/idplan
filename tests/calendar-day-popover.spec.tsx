// @vitest-environment jsdom
/**
 * 月历 v3「B 方案」· 「+N」当日浮层 + 恒定格高（画布定稿 2026-10-08 · 规格 §2/§5）。
 *
 * ══════════════════ 为什么是 jsdom 而不是真 Chromium ══════════════════
 * 本轮断言全部是**结构契约**（portal 亲缘、全列不截断、三路关闭、焦点回还、
 * <768 转底部弹层、恒定格高），没有一条需要真实布局盒数值：
 *   · 「浮层不被格子裁掉」的根因是 portal 到 body（§5.1），jsdom 断言
 *     `parentElement === document.body` 即钉死机制，无需量 px；
 *   · 「贴格右展/左翻/底不超视口」的几何在真浏览器才有数值，但那是
 *     `resolveAnchoredPosition` 同族的定位话题，本组件只消费 anchorRect，
 *     几何回归由画布定稿本身背书（数值权威），不在本 spec 重复造轮子；
 *   · 「超 6 条滚动而非截断」在 jsdom 里量不出 scrollHeight，改断言
 *     「滚动容器带 max-h-[236px] + overflow-y-auto」且「9 条全在 DOM 里」——
 *     后者才是「不截断」的本体（截断的表现就是行根本不在 DOM 中）。
 *
 * ══════════════════ 夹具口径 ══════════════════
 * 9 个 active 人类项目、各带一个横跨当月的进行中阶段 ⇒ 每个条目的色带区间
 * 覆盖 [当月1日, 今天] ⇒ 今天格恰好 9 条（> 桌面阈值 4 ⇒ 出现「+N」）。
 * 渲染**真实的 MonthlyCalendarView**（不是组件替身）：浮层状态住在 view 级、
 * 「+N」→ onOpenDay → DayItemsPopover 整条接线都在被测范围内。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { MonthlyCalendarView } from '../src/components/calendar/MonthlyCalendarView';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
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

/** 拥挤日条目数（需求方原话的场景：「如果还有 9 个项目……」） */
const CROWD = 9;

const ADMIN: Member = {
  id: 'mem_pop_admin',
  name: '探针管理员',
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

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    address: '',
    clientName: '客户甲',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: MONTH_START,
    plannedEndAt: MONTH_END,
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
}

/** 横跨当月的进行中阶段：今天必落在区间内 ⇒ in_progress + 有 activeStage（阶段名可断言） */
function makeStage(id: string, projectId: string, orderIndex: number): Stage {
  return {
    id,
    projectId,
    orderIndex,
    templateKey: null,
    colorIndex: orderIndex,
    customColor: null,
    name: `阶段${orderIndex}`,
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
}

/* ══════════════════════════════ 渲染脚手架 ══════════════════════════════ */

let host: HTMLDivElement | null = null;
let root: Root | null = null;

/** 卸载当前树（同一用例内多次挂载必须先收掉前一棵，否则孤儿树仍订阅 store） */
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

/** 挂真实路由子集（行点击 → /project/:id 占位，验「每行可点进项目」） */
function mountView(): HTMLDivElement {
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
  return h;
}

/**
 * jsdom 缺 matchMedia / ResizeObserver。matchMedia 桩按 query 分流：
 * `narrowMode` 只喂 `(max-width: 767px)`（月历手机断点，与组件侧同一口径），
 * 其余 query（prefers-color-scheme / pointer:coarse）恒 false = 桌面浅色稿。
 */
let narrowMode = false;
function installEnvStubs(): void {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: query === '(max-width: 767px)' ? narrowMode : false,
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

/** 装库（须在挂载前、包在 act 里）。管理员身份 ⇒ isRestrictedView=false ⇒ 全量人类项目可见 */
function seedStores(): void {
  unmountCurrent();
  const projects: Project[] = [];
  const stages: Stage[] = [];
  for (let i = 0; i < CROWD; i += 1) {
    const pid = `proj_pop_${i}`;
    projects.push(makeProject(pid, `项目${String.fromCharCode(65 + i)}`));
    stages.push(makeStage(`stg_pop_${i}`, pid, i + 1));
  }
  act(() => {
    useProjectsStore.getState().replaceAll({ projects, stages, tasks: [] });
    useMembersStore.getState().setAll([ADMIN]);
    /*
     * 0.8.6.0009 起月历条目只渲染在工作日（她 10-09 反馈「国庆格排满」，
     * 见 calendarMath.entryShowsOnDate）。本 spec 考的是拥挤/浮层/焦点，
     * 前提是「今天格真的是工作日」——把 TODAY 钉成补班工作日（extraWorkdays
     * 优先级最高）让用例与运行日期解耦：周末跑也不会因今天格零条目而红。
     */
    const pinned = { ...DEFAULT_REST_POLICY, extraWorkdays: [TODAY] };
    useSettingsStore.setState({
      currentMemberId: ADMIN.id,
      hydrated: true,
      restPolicy: pinned,
      effectiveRestPolicy: pinned,
    });
    useUiStore.getState().setCalendarMonth(MONTH);
    useUiStore.setState({ calendarFilters: { status: new Set(), stage: new Set() } });
  });
}

beforeEach(() => {
  localStorage.clear();
  narrowMode = false;
  installEnvStubs();
  seedStores();
});

afterEach(() => {
  unmountCurrent();
  act(() => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  });
});

/* ══════════════════════════════ 查询助手 ══════════════════════════════ */

/** 今天格（aria-label 形如「YYYY-MM-DD（今天），9 个项目」） */
function todayCell(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-day-cell][aria-label*="（今天）"]');
  if (el === null) throw new Error('未找到今天日期格（月历应渲染含今天的月份）');
  return el;
}

/** 今天格的「+N」入口（aria-label「展开 N 个项目的当日清单」，规格 §4） */
function moreBtn(): HTMLElement {
  const b = todayCell().querySelector<HTMLElement>('button[aria-label^="展开"]');
  if (b === null) {
    throw new Error(`今天格未出现「+N」入口（应 ${CROWD} 条 > 桌面阈值 4）`);
  }
  return b;
}

/** 浮层面板（body portal；桌面 panel / 窄窗 sheet 两种形态） */
function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-day-popover]');
}

/** 浮层内的条目行（排除右上 ✕ 关闭钮） */
function rowButtons(p: HTMLElement): HTMLButtonElement[] {
  return [...p.querySelectorAll('button')].filter(
    (b) => b.getAttribute('aria-label') !== '关闭当日清单',
  ) as HTMLButtonElement[];
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 「+N」弹出当日浮层，当天全部条目全列
 * ══════════════════════════════════════════════════════════════════════════ */

describe('① 点「+N」出当日浮层：9 条全列、不截断、头部口径正确', () => {
  it('点「+N」浮层弹出，行数 = 当天全部条目（9 条就 9 条）', () => {
    mountView();
    const btn = moreBtn();
    btn.focus();
    act(() => {
      btn.click();
    });

    const p = panel();
    expect(p, '点「+N」应弹出当日浮层').not.toBeNull();
    expect(rowButtons(p!), '浮层必须全列当天条目，一条不许少').toHaveLength(CROWD);
  });

  it('头部为「M 月 D 日 · N 个项目」；行 = 色点 + 项目全名 + 阶段 + 百分比', () => {
    mountView();
    act(() => {
      moreBtn().click();
    });
    const p = panel()!;
    const head = `${dayjs().month() + 1} 月 ${dayjs().date()} 日 · ${CROWD} 个项目`;
    expect(p.textContent, `头部应为「${head}」`).toContain(head);

    const row = rowButtons(p)[0]!;
    expect(row.textContent).toContain('项目A');
    expect(row.textContent).toContain('阶段1');
    expect(row.textContent).toContain('%');
    // 色点：内联取色（实心块通路，jsdom 保留 var() 字面量）
    const dot = row.querySelector<HTMLElement>('span[aria-hidden]')!;
    expect(dot.style.backgroundColor).toContain('var(--stage');
    // 百分比等宽数字
    const pct = [...row.querySelectorAll('span')].find((s) => /%$/.test(s.textContent ?? ''));
    expect(pct!.className).toContain('tabular-nums');
  });

  it('浮层行点击 → 打开对应项目详情（onOpenProject 接线）', () => {
    mountView();
    act(() => {
      moreBtn().click();
    });
    const first = rowButtons(panel()!)[0]!;
    expect(first.textContent).toContain('项目A');
    act(() => {
      first.click();
    });
    expect(
      document.querySelector('[data-project-open]'),
      '行点击应导航到项目详情',
    ).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 超 6 条：浮层内滚动，而不是截断
 * ══════════════════════════════════════════════════════════════════════════ */

describe('② 超 6 条在浮层内滚动（max-h 236 + overflow-y-auto），不截断', () => {
  it('滚动容器就位，且 9 条全部在 DOM 里', () => {
    mountView();
    act(() => {
      moreBtn().click();
    });
    const p = panel()!;
    const list = p.querySelector<HTMLElement>('[data-day-popover-list]')!;
    expect(list, '行清单容器应存在').not.toBeNull();
    expect(list.className, '超过 6 条必须给滚动容器').toContain('max-h-[236px]');
    expect(list.className).toContain('overflow-y-auto');
    // 「不截断」的本体：9 条一行不少地都在 DOM 中（截断的表现就是行不在）
    expect(list.querySelectorAll('button')).toHaveLength(CROWD);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 全 DOM / 月历源码：不存在不可点的「还有 N 个」死文本
 *    （需求方 0.8.6.0002 原话：「我已经点不动了，没有办法再继续展开」）
 * ══════════════════════════════════════════════════════════════════════════ */

describe('③ 不可点的「还有 N 个」死文本：DOM 与源码双重清零', () => {
  it('浮层打开后，整个 document 不得出现「还有」字样', () => {
    mountView();
    act(() => {
      moreBtn().click();
    });
    expect(panel(), '前置：浮层应已打开').not.toBeNull();
    expect(
      document.body.textContent ?? '',
      '浮层全列后不该有任何「还有 N 个」式死文本（要也是全列 + 滚动）',
    ).not.toContain('还有');
  });

  it('月历源码不得残留 `还有 {N} 个项目` 形态（就地展开清单的死文本就长那样）', () => {
    const calDir = resolve(__dirname, '..', 'src', 'components', 'calendar');
    const offenders = collectSourceFiles(calDir)
      .map((f) => [f, readFileSync(f, 'utf8')] as const)
      .filter(([, code]) => /还有\s*\{/.test(code))
      .map(([f]) => f.replace(/\\/g, '/'));
    expect(offenders, 'src/components/calendar 下不得再有「还有 {…}」模板字面量').toEqual([]);
    // 口径说明：Sidebar 也有一处「还有 {n} 个项目…」，但那是 v0.7 起**可点的展开按钮**
    // （data-sidebar-more-projects，反馈「点不到」后已修），不在本次月历清扫范围内。
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 浮层挂 body：不被 overflow:hidden 的格子/月历卡裁掉
 * ══════════════════════════════════════════════════════════════════════════ */

describe('④ 浮层 portal 到 document.body（不住格子，不被裁）', () => {
  it('parentElement === document.body，且不在今天格/月历卡内部', () => {
    mountView();
    act(() => {
      moreBtn().click();
    });
    const p = panel()!;
    expect(p.parentElement, '必须 portal 到 body：格子 overflow:hidden，住进去会被整块裁掉（§5.1 实测记录）').toBe(
      document.body,
    );
    expect(todayCell().contains(p), '浮层不得做格子的子树').toBe(false);
    // 月历卡（sunken 大卡）同样 overflow 着眼，浮层也不能挂在它里面
    const card = document.querySelector('.bg-sunken');
    expect(card === null || !card.contains(p), '浮层不得挂在月历卡内').toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 三路关闭 + 焦点回还
 * ══════════════════════════════════════════════════════════════════════════ */

describe('⑤ 三路关闭（Esc / 点外部 / ✕）与焦点回还', () => {
  it('Esc 关闭；关闭后焦点还给触发它的「+N」按钮', () => {
    mountView();
    const btn = moreBtn();
    btn.focus();
    expect(document.activeElement, '前置：焦点在「+N」上（真实浏览器里点击即聚焦）').toBe(btn);
    act(() => {
      btn.click();
    });
    /*
     * 「打开时焦点入面板」的真机断言在 calendar-popover-geometry.spec.ts 的 P-06
     * （真 Chromium）：那条契约的真 bug——挂载即聚焦那一版，focus() 调在面板
     * visibility:hidden 时是**空操作**（首帧 pos=null）——只有真浏览器量得出。
     * jsdom 不实现「hidden 元素聚焦是空操作」，这里断言恒真、无判别力，
     * 按纪律不留恒真断言误导后人（焦点回还下面那条仍保留：恢复链断了 jsdom 会红）。
     */
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(panel(), 'Esc 应关闭浮层').toBeNull();
    expect(document.activeElement, '关闭后焦点还给「+N」（用户从哪来回哪去）').toBe(btn);
  });

  it('点浮层外部（document mousedown 捕获）关闭', () => {
    mountView();
    act(() => {
      moreBtn().click();
    });
    expect(panel()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(panel(), '点外部应关闭').toBeNull();
  });

  it('右上 ✕ 关闭', () => {
    mountView();
    act(() => {
      moreBtn().click();
    });
    const x = panel()!.querySelector<HTMLButtonElement>('button[aria-label="关闭当日清单"]')!;
    expect(x, '应有关闭钮').not.toBeNull();
    act(() => {
      x.click();
    });
    expect(panel(), '✕ 应关闭').toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑥ <768px 转底部弹层（同一组件，不另写一套列表）
 * ══════════════════════════════════════════════════════════════════════════ */

describe('⑥ <768px：同一清单组件转底部弹层', () => {
  it('窄窗下「+N」文案缩成 +N，弹层贴底、左右留 12px、圆角 16，仍 9 条全列', () => {
    narrowMode = true; // 喂 matchMedia('(max-width: 767px)') = true（挂载前设，组件初次渲染即读到）
    mountView();

    const btn = moreBtn();
    expect(btn.textContent, '窄窗文案规格：+N（不带「个项目」）').toBe('+7');

    act(() => {
      btn.click();
    });
    const p = panel()!;
    expect(p.getAttribute('data-day-popover')).toBe('sheet');
    expect(p.className, '左右留 12px').toContain('inset-x-[12px]');
    expect(p.className, '贴底').toContain('bottom-0');
    expect(p.className, '圆角 16（顶部两角）').toContain('rounded-t-[16px]');
    // 同一份列表，不是另一套实现
    expect(p.querySelector('[data-day-popover-list]')).not.toBeNull();
    expect(rowButtons(p)).toHaveLength(CROWD);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑦ 格子高度恒定（定稿铁律 1：任何交互都不允许把格子撑高）
 * ══════════════════════════════════════════════════════════════════════════ */

describe('⑦ 格子高度恒定：桌面 86px，9 条拥挤日与浮层打开时都不撑高', () => {
  it('42 格一律 86px（今天 9 条也不例外）；浮层打开后仍 86', () => {
    mountView();
    const cells = [...document.querySelectorAll<HTMLElement>('[data-day-cell]')];
    expect(cells.length, '6×7 网格应渲染 42 格').toBe(42);
    const heights = new Set(cells.map((c) => c.style.height));
    expect([...heights], '所有格同一高度档（定稿桌面 86）').toEqual(['86px']);

    expect(todayCell().style.height, '9 条拥挤日同样 86，不撑高').toBe('86px');

    act(() => {
      moreBtn().click();
    });
    expect(panel(), '前置：浮层应已打开').not.toBeNull();
    expect(todayCell().style.height, '浮层打开后格子仍 86（就地展开已废除）').toBe('86px');
    expect(todayCell().className, '裁切兜底：overflow-hidden 不得丢').toContain('overflow-hidden');
  });
});
