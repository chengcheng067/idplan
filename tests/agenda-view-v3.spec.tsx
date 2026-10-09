// @vitest-environment jsdom
/**
 * 月历 v3「B 方案」· 日程视图形态归一 + 周视图 v3 链路冒烟（2026-10-08 派工）。
 *
 * ══════════════════ 本文件为什么存在 ══════════════════
 * 月历 v3（画布定稿 2026-10-08）把格内条目改成「小色点 + 项目名」后，
 * **周视图自动随 v3 生效**（复用 MonthDayCell），而**日程视图**是唯一没进 v3 的
 * 分支——它在 MonthlyCalendarView 的 agenda 分支里手写 list rows，三处不一致：
 *   ① 色块用 `e.color`（宽面带角色 `var(--stage-band-sN`）而非 `stageSolidOf`
 *      （实心块角色 `var(--stage-sN`）——小面积色点用宽面变体会在亮/暗格底上
 *      漂移对比度（色带变体本就是为宽面设计的）；
 *   ② 未开始幽灵态是**实心**色块，而 v3 幽灵 = **空心描边点**（同色 1.5px
 *      描边、内部透明）；
 *   ③ 没有 `data-stage-key` / `customStageColor` attrs——自定义色透传缺半边
 *      （只写 var() 不挂属性 ⇒ 解析为空 ⇒ 色点**透明**，通路 B 已反复证明）。
 * 本文件即这三处归一 + 「周视图 v3 链路还活着」的回归网（此前没有任何 spec
 * 锁周/日程形态）。
 *
 * ══════════════════ 为什么是 jsdom ══════════════════
 * 全部断言都是**结构契约**（内联色令牌字面量、data-stage-key、空心描边、
 * portal 亲缘、行数），没有一条需要真实布局盒数值。jsdom 保留 `var()` 字面量
 * （见 tests/stage-color-wiring.spec.tsx:35-40 的前置实测），`el.style.*`
 * 这条口径可用；「var() 真的解析成不透明色」由真 Chromium 段背书（那边已有
 * describe.skipIf 的同族断言），本 spec 不重复造轮子。
 *
 * ══════════════════ 夹具口径 ══════════════════
 * 6 个 active 人类项目（真实当月，今天必在区间内 ⇒ in_progress + 有 activeStage）：
 *   · 自定义项目 —— InProgress，阶段 customColor = 自定义紫（≠ 内置 9 色，
 *     否则「碰巧等于内置色」式假绿）
 *   · 内置色项目 —— InProgress，customColor = null（orderIndex=2 ⇒ s2）
 *   · 未开始项目 —— plannedStart 落在月末 ⇒ status=not_started ⇒ 幽灵行
 *   · 3 个填充项目 —— 把「今天」格堆到 5 条（> 桌面折叠阈值 4）⇒ 月/周视图
 *     都出现「+N」入口（周视图冒烟要用）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MonthlyCalendarView } from '../src/components/calendar/MonthlyCalendarView';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import {
  registerStageColor,
  __resetRegistryForTest,
} from '../src/core/color/custom-color-registry';
import { STAGE_COLOR_KEY_ATTR } from '../src/components/timeline/stageColorKey';
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

/** 自定义主色：刻意取一个与内置 9 色都不相同的紫（防「碰巧等于内置色」假绿） */
const CUSTOM = '#7A2FD6';

/** 填充项目数：3 = 今天格 5 条（自定义 + 内置 + 3）> 桌面折叠阈值 4 ⇒ 出「+N」 */
const FILLER_COUNT = 3;

const ADMIN: Member = {
  id: 'mem_agenda_admin',
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

function makeProject(id: string, name: string, over: Partial<Project> = {}): Project {
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
    ...over,
  };
}

function makeStage(
  id: string,
  projectId: string,
  orderIndex: number,
  over: Partial<Stage> = {},
): Stage {
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
    ...over,
  };
}

/** 装库（须在挂载前、包在 act 里）。管理员身份 ⇒ isRestrictedView=false ⇒ 全量人类项目可见 */
function seedStores(): void {
  unmountCurrent();
  const projects: Project[] = [
    // ① 自定义色（进行中，今天落在阶段区间内 ⇒ 有 activeStage，实心点 + data-stage-key）
    makeProject('proj_agenda_custom', '自定义项目'),
    // ② 内置色（orderIndex=2 ⇒ 实心块 var(--stage-s2)，不挂属性）
    makeProject('proj_agenda_builtin', '内置色项目'),
    // ③ 未开始（plannedStart 在月末 ⇒ not_started ⇒ 幽灵行：空心描边点）
    makeProject('proj_agenda_ghost', '未开始项目', {
      plannedStartAt: `${MONTH_END}T00:00:00Z`,
      plannedEndAt: `${MONTH_END}T23:59:59Z`,
    }),
  ];
  const stages: Stage[] = [
    makeStage('stg_agenda_custom', 'proj_agenda_custom', 1, {
      name: '自定义阶段',
      customColor: CUSTOM,
    }),
    makeStage('stg_agenda_builtin', 'proj_agenda_builtin', 2, { name: '内置阶段' }),
    makeStage('stg_agenda_ghost', 'proj_agenda_ghost', 1, {
      name: '未来阶段',
      status: StageStatus.NotStarted,
      startAt: `${MONTH_END}T00:00:00Z`,
      endAt: `${MONTH_END}T23:59:59Z`,
    }),
  ];
  for (let i = 0; i < FILLER_COUNT; i += 1) {
    const pid = `proj_agenda_fill_${i}`;
    projects.push(makeProject(pid, `填充项目${String.fromCharCode(65 + i)}`));
    stages.push(makeStage(`stg_agenda_fill_${i}`, pid, 3 + i));
  }
  act(() => {
    useProjectsStore.getState().replaceAll({ projects, stages, tasks: [] });
    useMembersStore.getState().setAll([ADMIN]);
    /*
     * 0.8.6.0009 起月历条目只渲染在工作日（她 10-09 反馈「国庆格排满」，
     * 见 calendarMath.entryShowsOnDate）。周视图冒烟的前提是「今天格真的是
     * 工作日」——把 TODAY 钉成补班工作日（extraWorkdays 优先级最高）让用例
     * 与运行日期解耦：周末跑也不会因今天格零条目而红。
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

/** 挂真实路由子集（「查看」点击 → /project/:id 占位） */
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
 * jsdom 缺 matchMedia / ResizeObserver。恒桌面稿（`matches:false`）——
 * 日程/周视图的断言全是桌面档口径（折叠阈值 4、桌面浮层 panel）。
 */
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

beforeEach(() => {
  localStorage.clear();
  __resetRegistryForTest();
  installEnvStubs();
  seedStores();
});

afterEach(() => {
  unmountCurrent();
  act(() => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  });
  __resetRegistryForTest();
});

/* ══════════════════════════════ 查询助手 ══════════════════════════════ */

/** 工具行密度分段按钮（tablist「月历视图密度」：月 / 周 / 日程） */
function densityTab(label: string): HTMLButtonElement {
  const b = [...document.querySelectorAll('button[role="tab"]')].find(
    (el) => (el.textContent ?? '').trim() === label,
  ) as HTMLButtonElement | undefined;
  if (b === undefined) throw new Error(`未找到密度分段「${label}」`);
  return b;
}

/** 切视图密度（点分段 ⇒ onChange ⇒ 重渲染） */
function switchDensity(label: string): void {
  act(() => {
    densityTab(label).click();
  });
}

/** 日程视图清单行（v3 归一后新增的测试锚点） */
function agendaRows(): Element[] {
  return [...document.querySelectorAll('[data-agenda-row]')];
}

/** 按项目名找日程行（排序/夹具顺序不该成为断言的依赖） */
function agendaRowByName(name: string): Element {
  const row = agendaRows().find((r) => (r.textContent ?? '').includes(name));
  if (row === undefined) throw new Error(`日程视图未找到项目「${name}」的行`);
  return row;
}

/** 行内色点（B 方案唯一带 aria-hidden 的 span） */
function dotOf(row: ParentNode): HTMLElement {
  const dot = row.querySelector<HTMLElement>('span[aria-hidden]');
  if (dot === null) throw new Error('行内未找到色点 span[aria-hidden]');
  return dot;
}

/** 今天格（aria-label 形如「YYYY-MM-DD（今天），N 个项目」） */
function todayCell(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-day-cell][aria-label*="（今天）"]');
  if (el === null) throw new Error('未找到今天日期格');
  return el;
}

/** 今天格的「+N」入口（aria-label「展开 N 个项目的当日清单」） */
function moreBtn(): HTMLElement {
  const b = todayCell().querySelector<HTMLElement>('button[aria-label^="展开"]');
  if (b === null) throw new Error('今天格未出现「+N」入口');
  return b;
}

/** 当日浮层（body portal；桌面 panel / 窄窗 sheet 两种形态） */
function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-day-popover]');
}

/** 浮层内的条目行（排除右上 ✕ 关闭钮） */
function popoverRows(p: HTMLElement): HTMLElement[] {
  return [...p.querySelectorAll('button')].filter(
    (b) => b.getAttribute('aria-label') !== '关闭当日清单',
  ) as HTMLElement[];
}

/** 从今天格 aria-label 解析当天条目数（用于「浮层全列不截断」的动态期望值） */
function todayEntryCount(): number {
  const label = todayCell().getAttribute('aria-label') ?? '';
  const m = /，(\d+) 个项目/.exec(label);
  if (m === null) throw new Error(`今天格 aria-label 解析不出条目数：${label}`);
  return Number(m[1]);
}

function readSrc(file: string): string {
  return readFileSync(resolve(__dirname, '..', 'src', 'components', 'calendar', file), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 日程视图行：v3「B 方案」实心块色点（三处不一致逐项归一）
 * ═════════════════════════════════════════════════════════════════════════ */

describe('① 日程视图行：实心块色点 + 幽灵空心 + 自定义色 attrs（v3 形态）', () => {
  it('自定义色日程行：色点取实心块 var(--stage-local-solid)，且挂 data-stage-key（注册表同 key）', () => {
    const key = registerStageColor(CUSTOM);
    mountView();
    switchDensity('日程');

    const dot = dotOf(agendaRowByName('自定义项目'));
    // 不一致 ① 的归一：e.color（宽面带 var(--stage-local-band）→ 实心块 var(--stage-local-solid）
    expect(dot.style.backgroundColor).toBe('var(--stage-local-solid)');
    expect(dot.style.backgroundColor, '小面积色点不得取宽面带角色').not.toContain('-band');
    // 不一致 ③ 的归一：两个半件成对（只写 var() 不挂属性 ⇒ 解析为空 ⇒ 透明）
    expect(dot.getAttribute(STAGE_COLOR_KEY_ATTR), '自定义色必须挂 data-stage-key').toBe(key);
    // 发丝描边（BUG-04）随宽面角色退役：色点不得有 boxShadow
    expect(dot.style.boxShadow ?? '').toBe('');
  });

  it('内置色日程行：色点取实心块 var(--stage-s2)，且不挂 data-stage-key', () => {
    mountView();
    switchDensity('日程');

    const dot = dotOf(agendaRowByName('内置色项目'));
    expect(dot.style.backgroundColor).toBe('var(--stage-s2)');
    expect(dot.style.backgroundColor, '不得落到宽面带或本地令牌').not.toContain('-band');
    expect(dot.getAttribute(STAGE_COLOR_KEY_ATTR)).toBeNull();
  });

  it('未开始（幽灵）日程行：色点空心（1.5px 同色描边、内部透明）', () => {
    mountView();
    switchDensity('日程');

    const dot = dotOf(agendaRowByName('未开始项目'));
    // 不一致 ② 的归一：幽灵态从实心块改为空心描边点
    expect(dot.style.backgroundColor ?? '', '幽灵点内部必须透明（不发实心底）').not.toContain(
      'var(--stage',
    );
    expect(dot.style.border, '幽灵点必须 1.5px 描边').toContain('1.5px');
    // 描边色取「实心块」角色（内置通路时即 filterStageIndex 对应槽位 s1）
    expect(dot.style.border).toContain('var(--stage-s1');
  });

  it('日程行信息面不动：全名 / 阶段 / 起止 / 百分比 / 查看按钮', () => {
    mountView();
    switchDensity('日程');

    const row = agendaRowByName('自定义项目');
    expect(row.textContent).toContain('自定义项目');
    expect(row.textContent).toContain('自定义阶段');
    expect(row.textContent).toContain(`${MONTH_START} – ${TODAY}`);
    expect(row.textContent).toMatch(/%/);

    const view = [...row.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '查看');
    expect(view, '日程行必须保留「查看」按钮').toBeDefined();
    act(() => {
      view!.click();
    });
    expect(document.querySelector('[data-project-open]'), '「查看」应能点进项目详情').not.toBeNull();
  });

  it('三态判别对照：自定义 / 内置 / 幽灵三枚色点两两不同（防「都渲染成同一种」式假绿）', () => {
    mountView();
    switchDensity('日程');

    const custom = dotOf(agendaRowByName('自定义项目'));
    const builtin = dotOf(agendaRowByName('内置色项目'));
    const ghost = dotOf(agendaRowByName('未开始项目'));
    expect(custom.style.backgroundColor).not.toBe(builtin.style.backgroundColor);
    expect(custom.style.backgroundColor).not.toBe(ghost.style.backgroundColor);
    expect(builtin.style.backgroundColor).not.toBe(ghost.style.backgroundColor);
    // 幽灵点与实心点的判别不只在色值：形态上一个描边、一个铺底
    expect(ghost.style.border).toContain('1.5px');
    expect(custom.style.border ?? '').toBe('');
    expect(builtin.style.border ?? '').toBe('');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 源码级回归锁：色点逻辑收口在 EntryDot（单一天来源，防再漂移）
 * ═════════════════════════════════════════════════════════════════════════ */

describe('② 源码锁：三处色点经同一枚 EntryDot，日程行不得再用 e.color 宽面带', () => {
  it('MonthlyCalendarView 的色点不得再用 e.color 上色', () => {
    const src = readSrc('MonthlyCalendarView.tsx');
    expect(
      /backgroundColor:\s*e\.color/.test(src),
      '日程行色点必须走 EntryDot（stageSolidOf 实心块角色），不得用 e.color 宽面带',
    ).toBe(false);
  });

  it('格内行与浮层行不得再直接调 stageSolidOf / customStageColor（提取后只经 EntryDot）', () => {
    expect(/stageSolidOf\(/.test(readSrc('MonthDayCell.tsx'))).toBe(false);
    expect(/customStageColor\(/.test(readSrc('MonthDayCell.tsx'))).toBe(false);
    expect(/stageSolidOf\(/.test(readSrc('DayItemsPopover.tsx'))).toBe(false);
    expect(/customStageColor\(/.test(readSrc('DayItemsPopover.tsx'))).toBe(false);
  });

  it('EntryDot 持三态唯一实现，三个消费点全部引用它', () => {
    const dot = readSrc('EntryDot.tsx');
    expect(/stageSolidOf\(/.test(dot), 'EntryDot 必须走实心块取色出口').toBe(true);
    expect(/customStageColor\(/.test(dot), 'EntryDot 必须拿自定义色 attrs').toBe(true);
    expect(/isGhost/.test(dot), 'EntryDot 必须统一幽灵空心态').toBe(true);
    for (const f of ['MonthDayCell.tsx', 'DayItemsPopover.tsx', 'MonthlyCalendarView.tsx']) {
      expect(readSrc(f), `${f} 必须引用 EntryDot`).toContain('EntryDot');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 周视图冒烟：切「周」密度 → 点「+N」→ 当日浮层出来（v3 链路活着）
 *    周视图复用 MonthDayCell，进 v3 是自动的；本组是它的**活的**回归网——
 *    一旦有人把周视图改回自成一套（或打断 onOpenDay → DayItemsPopover 接线），
 *    这里立刻红。
 * ══════════════════════════════════════════════════════════════════════════ */

describe('③ 周视图冒烟：切周密度 → +N → 当日浮层（v3 链路是活的）', () => {
  it('周视图渲染 7 格一行；点今天格「+N」弹出当日浮层且全列不截断', () => {
    mountView();
    switchDensity('周');

    const cells = [...document.querySelectorAll('[data-day-cell]')];
    expect(cells, '周视图 = 7 列一行（同一套日期格）').toHaveLength(7);
    expect(todayCell(), '本周必须含今天格').not.toBeNull();

    const expected = todayEntryCount();
    expect(expected, '夹具前置：今天格条目数应 > 桌面折叠阈值 4（否则没有「+N」可点）').toBeGreaterThan(4);

    const btn = moreBtn();
    act(() => {
      btn.click();
    });

    const p = panel();
    expect(p, '点「+N」应弹出当日浮层（周视图没有自成一套清单）').not.toBeNull();
    expect(popoverRows(p!), '浮层必须全列当天条目，一条不许少').toHaveLength(expected);
  });

  it('周视图浮层里自定义色条目的色点同样走 v3 通路（实心块 + data-stage-key）', () => {
    const key = registerStageColor(CUSTOM);
    mountView();
    switchDensity('周');
    act(() => {
      moreBtn().click();
    });
    const p = panel()!;

    const row = popoverRows(p).find((b) => (b.textContent ?? '').includes('自定义项目'));
    expect(row, '今天格应含自定义项目').toBeDefined();
    const dot = dotOf(row!);
    expect(dot.style.backgroundColor).toBe('var(--stage-local-solid)');
    expect(dot.getAttribute(STAGE_COLOR_KEY_ATTR)).toBe(key);

    // 同批内置色对照：证明不是「整片都变本地令牌」
    const builtinRow = popoverRows(p).find((b) => (b.textContent ?? '').includes('内置色项目'));
    const builtinDot = dotOf(builtinRow!);
    expect(builtinDot.style.backgroundColor).toBe('var(--stage-s2)');
    expect(builtinDot.closest(`[${STAGE_COLOR_KEY_ATTR}]`)).toBeNull();
  });

  it('切回月视图后仍是 42 格（密度切换不破坏月网格）', () => {
    mountView();
    switchDensity('周');
    expect([...document.querySelectorAll('[data-day-cell]')]).toHaveLength(7);
    switchDensity('月');
    expect([...document.querySelectorAll('[data-day-cell]')], '月视图 = 6×7 网格').toHaveLength(42);
  });
});
