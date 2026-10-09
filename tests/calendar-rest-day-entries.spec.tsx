// @vitest-environment jsdom
/**
 * 月历条目 · 休息日过滤（0.8.6.0009 · 她 10-09 21:35 截图反馈）。
 *
 * ══════════════════ 本文件为什么存在 ══════════════════
 * 她的原话：「设置里面已经选择了『跳过节假日』以及『休息的时间』，但是在月历
 * 看板上仍然没有跳过这些时间。这意味着，本来国庆节是休息的，但是国庆节却被
 * 排满了」——截图里国庆格是灰的（休息底纹 + 节日名小字都在）却画着 5 个项目
 * 的条目：格子底纹说「这天休息」而条目圆点说「这天有活」，同一格两套语言。
 *
 * 修法（规则本体见 calendarMath.entryShowsOnDate）：**休息日格不渲染工作条目**
 * （底纹 / 节日名照旧，只清条目）。本 spec 即该规则的回归网，覆盖三种投影形态：
 *   ① 阶段**跨**休息日（9/28–10/9 跨国庆）：不整条消失——非休息日格照常渲染；
 *   ② 阶段**整天**在休息日内（10/1–10/7）：格内零渲染（议程视图是项目清单、
 *      非逐日投影，条目仍在，信息不丢）；
 *   ③ 单日投影落休息日（未开始幽灵点 plannedStart 落周日）：当日不渲染；
 *   外加两条边界：调休补班的周六**照常渲染**（「班」就是要上班，
 *   extraWorkdays 优先级最高）；开关关着时节假日不合并 ⇒ 国庆格恢复渲染
 *   （她没要求跳过时与改造前一致）。
 *
 * ══════════════════ 为什么是 jsdom ══════════════════
 * 全部断言都是**结构契约**（某天某格有没有条目、aria-label 计数、议程行在不在），
 * 没有一条需要真实布局盒；休息日判定走真实 effectiveRestPolicy（setRestPolicy
 * 的 hydrate 边界派生，内置法定节假日表真合并）。2026 国庆安排（10/1–10/7 放假、
 * 9/20 与 10/10 补班）与国务院办公厅通知一致，已由 holidays-cn.spec.tsx 锁定。
 *
 * ══════════════════ 日期口径 ══════════════════
 * 展示月钉死 2026-10（setCalendarMonth），与运行日期解耦；条目状态（in_progress
 * / completed / not_started）对 today≥10-09 均稳定（band 覆盖关系不随今天漂移，
 * 断言只用「包含 / 为零」不用易漂的精确计数）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { MonthlyCalendarView } from '../src/components/calendar/MonthlyCalendarView';
import {
  buildMonthMeta,
  computeCalendarEntry,
  entryShowsOnDate,
  type CalendarEntry,
} from '../src/components/calendar/calendarMath';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import { withCnHolidays } from '../src/core/holidays/policy';
import type { Member, Project, Stage, RestPolicyConfig } from '../src/core/types/entities';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  RestPolicyKind,
  ScheduleBasis,
  StageStatus,
} from '../src/core/types/enums';

/* ══════════════════════════════ 夹具 ══════════════════════════════ */

/** 展示月钉死 2026-10（国庆月在列）；todayIso 注入 10-08 = 她的反馈次日 */
const MONTH = '2026-10';
const META_TODAY = '2026-10-08';

/** 内置表口径（国务院办公厅 2026 通知）：国庆 10/1–10/7；补班 9/20（日）、10/10（六） */
const GUOQING = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'];
const BAN_SAT = '2026-10-10'; // 调休补班的周六（isRestDay=false ⇒ 条目照常）
const REST_SUN = '2026-10-11'; // 普通周日（休息 ⇒ 无条目）

/** 双休 + 跳过法定节假日（她的设置） */
const POLICY_ON: RestPolicyConfig = { kind: RestPolicyKind.DoubleOff, anchorWeek: null, skipHolidays: true };
/** 生效口径（hydrate 边界派生：内置表合并进 extraHolidays/extraWorkdays） */
const EFFECTIVE_ON = withCnHolidays(POLICY_ON);

const ADMIN: Member = {
  id: 'mem_rest_admin',
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

function makeProject(id: string, name: string, plannedStartAt: string, plannedEndAt: string): Project {
  return {
    id,
    name,
    address: '',
    clientName: '客户甲',
    contractAmount: null,
    signedAt: null,
    plannedStartAt,
    plannedEndAt,
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

function makeStage(
  id: string,
  projectId: string,
  name: string,
  startAt: string,
  endAt: string,
  status: StageStatus,
  orderIndex = 1,
): Stage {
  return {
    id,
    projectId,
    orderIndex,
    templateKey: null,
    colorIndex: orderIndex,
    customColor: null,
    name,
    ratioPercent: 100,
    startAt: `${startAt}T00:00:00Z`,
    endAt: `${endAt}T23:59:59Z`,
    status,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

/**
 * 五个项目各守一种形态（全部 active/人类，月命中十月）：
 *   ① 跨国庆：阶段 9/28–10/9 进行中 ⇒ band [10-01, 今天]（10-08）跨整个国庆；
 *   ② 整段国庆：阶段 10/1–10/7 已完成 ⇒ band [10-01, 10-07] 全落假日；
 *   ③a 幽灵落休息日：plannedStart 10/11（周日）未开始 ⇒ 幽灵点落周日；
 *   ③b 幽灵落工作日：plannedStart 10/09（周五）未开始 ⇒ 幽灵点落工作日；
 *   ④ 补班日：阶段 10/9–10/11 已完成 ⇒ band [10-09, 10-11] 压过补班周六 10/10。
 */
function buildFixture(): { projects: Project[]; stages: Stage[] } {
  const projects: Project[] = [
    makeProject('proj_rest_span', '跨国庆项目', '2026-09-20', '2026-10-31'),
    makeProject('proj_rest_inner', '整段国庆项目', '2026-10-01', '2026-10-07'),
    makeProject('proj_rest_ghost_rest', '幽灵落休息日', '2026-10-11', '2026-10-20'),
    makeProject('proj_rest_ghost_work', '幽灵落工作日', '2026-10-09', '2026-10-20'),
    makeProject('proj_rest_makeup', '补班日项目', '2026-10-09', '2026-10-31'),
  ];
  const stages: Stage[] = [
    makeStage('stg_rest_span', 'proj_rest_span', '跨国庆阶段', '2026-09-28', '2026-10-09', StageStatus.InProgress),
    makeStage('stg_rest_inner', 'proj_rest_inner', '国庆全程', '2026-10-01', '2026-10-07', StageStatus.Completed),
    makeStage('stg_rest_ghost_rest', 'proj_rest_ghost_rest', '未来阶段', '2026-10-11', '2026-10-20', StageStatus.NotStarted),
    makeStage('stg_rest_ghost_work', 'proj_rest_ghost_work', '待启阶段', '2026-10-09', '2026-10-20', StageStatus.NotStarted),
    makeStage('stg_rest_makeup', 'proj_rest_makeup', '补班阶段', '2026-10-09', '2026-10-11', StageStatus.Completed),
  ];
  return { projects, stages };
}

/** 装库（须在挂载前、包在 act 里）。制度走 setRestPolicy ⇒ 真 hydrate 派生链 */
function seedStores(policy: RestPolicyConfig): void {
  unmountCurrent();
  const { projects, stages } = buildFixture();
  act(() => {
    useProjectsStore.getState().replaceAll({ projects, stages, tasks: [] });
    useMembersStore.getState().setAll([ADMIN]);
    useSettingsStore.setState({ currentMemberId: ADMIN.id, hydrated: true });
    useSettingsStore.getState().setRestPolicy(policy);
    useUiStore.getState().setCalendarMonth(MONTH);
    useUiStore.setState({ calendarFilters: { status: new Set(), stage: new Set() } });
  });
}

/* ══════════════════════════════ 渲染脚手架 ══════════════════════════════ */

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

/** jsdom 缺 matchMedia / ResizeObserver：恒桌面档 */
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
  installEnvStubs();
});

afterEach(() => {
  unmountCurrent();
  act(() => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  });
});

/* ══════════════════════════════ 查询助手 ══════════════════════════════ */

/** 日期格（aria-label 形如「YYYY-MM-DD，N 个项目[, 国庆节]」） */
function cellOf(date: string): HTMLElement {
  const el = [...document.querySelectorAll<HTMLElement>('[data-day-cell]')].find((c) =>
    (c.getAttribute('aria-label') ?? '').startsWith(date),
  );
  if (el === undefined) throw new Error(`未找到日期格 ${date}（月历应渲染 2026-10）`);
  return el;
}

/** 格内条目按钮（aria-label「打开项目 X」） */
function entryButtons(cell: HTMLElement): HTMLElement[] {
  return [...cell.querySelectorAll<HTMLElement>('button[aria-label^="打开项目"]')];
}

/** 格内条目名清单 */
function entryNames(cell: HTMLElement): string[] {
  return entryButtons(cell).map((b) => (b.getAttribute('aria-label') ?? '').replace(/^打开项目\s*/, ''));
}

/** aria-label 里的条目数（「，N 个项目」） */
function entryCount(cell: HTMLElement): number {
  const m = /，(\d+) 个项目/.exec(cell.getAttribute('aria-label') ?? '');
  if (m === null) throw new Error(`aria-label 解析不出条目数：${cell.getAttribute('aria-label')}`);
  return Number(m[1]);
}

/** 切视图密度（点分段 ⇒ onChange ⇒ 重渲染） */
function switchDensity(label: string): void {
  act(() => {
    const btn = [...document.querySelectorAll<HTMLElement>('button[role="tab"]')].find(
      (b) => (b.textContent ?? '').trim() === label,
    );
    btn?.click();
  });
}

/** 议程行（data-agenda-row） */
function agendaRows(): Element[] {
  return [...document.querySelectorAll('[data-agenda-row]')];
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 纯函数：entryShowsOnDate 三形态（不挂组件，直接钉规则）
 * ═════════════════════════════════════════════════════════════════════════ */

describe('① entryShowsOnDate：三种投影形态的纯函数判例', () => {
  const meta = buildMonthMeta(MONTH, META_TODAY);
  const entryOf = (projectId: string): CalendarEntry => {
    const { projects, stages } = buildFixture();
    const p = projects.find((x) => x.id === projectId);
    const s = stages.filter((x) => x.projectId === projectId);
    if (p === undefined) throw new Error(`夹具缺项目 ${projectId}`);
    return computeCalendarEntry(p, s, meta);
  };

  it('形态① 跨国庆阶段：band 覆盖 10/1–10/8，仅 10/8（工作日）渲染', () => {
    const e = entryOf('proj_rest_span');
    expect([e.bandStart, e.bandEnd], 'band 应被裁进当月并延伸到今天').toEqual(['2026-10-01', '2026-10-08']);
    for (const d of GUOQING) {
      expect(entryShowsOnDate(e, d, EFFECTIVE_ON), `国庆 ${d} 不渲染`).toBe(false);
    }
    expect(entryShowsOnDate(e, '2026-10-08', EFFECTIVE_ON), '10/8 是工作日 ⇒ 渲染').toBe(true);
    expect(entryShowsOnDate(e, '2026-10-09', EFFECTIVE_ON), 'band 外不渲染').toBe(false);
  });

  it('形态② 整段在国庆内：band 10/1–10/7 全落假日 ⇒ 一天都不渲染', () => {
    const e = entryOf('proj_rest_inner');
    expect([e.bandStart, e.bandEnd]).toEqual(['2026-10-01', '2026-10-07']);
    for (const d of GUOQING) {
      expect(entryShowsOnDate(e, d, EFFECTIVE_ON), `整段国庆 ${d} 不渲染`).toBe(false);
    }
  });

  it('形态③ 单日投影落休息日 vs 落工作日：幽灵点 10/11（周日）不渲染、10/9（周五）渲染', () => {
    const rest = entryOf('proj_rest_ghost_rest');
    const work = entryOf('proj_rest_ghost_work');
    expect([rest.bandStart, rest.bandEnd], '未开始 ⇒ 起点单日带').toEqual(['2026-10-11', '2026-10-11']);
    expect([work.bandStart, work.bandEnd]).toEqual(['2026-10-09', '2026-10-09']);
    expect(rest.isGhost, '未开始 ⇒ 幽灵态').toBe(true);
    expect(entryShowsOnDate(rest, REST_SUN, EFFECTIVE_ON), '幽灵点落周日 ⇒ 不渲染').toBe(false);
    expect(entryShowsOnDate(work, '2026-10-09', EFFECTIVE_ON), '幽灵点落周五 ⇒ 渲染').toBe(true);
  });

  it('边界：调休补班的周六照常渲染（extraWorkdays 优先级最高，「班」就是要上班）', () => {
    const e = entryOf('proj_rest_makeup');
    expect([e.bandStart, e.bandEnd]).toEqual(['2026-10-09', '2026-10-11']);
    expect(entryShowsOnDate(e, BAN_SAT, EFFECTIVE_ON), '补班周六 10/10 照常渲染').toBe(true);
    expect(entryShowsOnDate(e, REST_SUN, EFFECTIVE_ON), '紧邻的周日仍休息 ⇒ 不渲染').toBe(false);
  });

  it('边界：开关关着（纯双休）⇒ 节假日不合并，10/1–10/7 中的工作日恢复渲染', () => {
    const e = entryOf('proj_rest_span');
    const off = withCnHolidays({ kind: RestPolicyKind.DoubleOff, anchorWeek: null });
    expect(entryShowsOnDate(e, '2026-10-01', off), '开关关 ⇒ 10/1（周四）照旧渲染').toBe(true);
    expect(entryShowsOnDate(e, '2026-10-03', off), '周末仍休息 ⇒ 10/3（周六）不渲染').toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 真实组件：国庆格只剩节日名、零条目（她的场景）
 * ═════════════════════════════════════════════════════════════════════════ */

describe('② 月历网格：国庆七天零条目（底纹/节日名照旧），非休息日照常', () => {
  beforeEach(() => {
    seedStores(POLICY_ON);
    mountView();
  });

  it('10/1–10/7 七格：bg-rest-day + 「国庆节」小字在，条目为零', () => {
    for (const d of GUOQING) {
      const cell = cellOf(d);
      expect(cell.className, `${d} 应落休息底纹`).toContain('bg-rest-day');
      expect(cell.textContent, `${d} 应显示节日名小字`).toContain('国庆节');
      expect(entryCount(cell), `${d} 不得有工作条目（她的原话：「国庆节却被排满了」）`).toBe(0);
      expect(entryButtons(cell), `${d} 不得有条目按钮`).toHaveLength(0);
      expect(cell.querySelector('button[aria-label^="展开"]'), `${d} 不得出现「+N」`).toBeNull();
    }
  });

  it('形态①：跨国庆项目在 10/8（工作日）渲染，国庆七天不渲染', () => {
    expect(entryNames(cellOf('2026-10-08')), '10/8 工作日 ⇒ 跨国庆项目在').toContain('跨国庆项目');
    for (const d of GUOQING) {
      expect(entryNames(cellOf(d)), `国庆 ${d} 不得有跨国庆项目`).not.toContain('跨国庆项目');
    }
  });

  it('形态②：整段国庆项目在十月网格内零渲染（一格都不出现）', () => {
    for (const d of GUOQING) {
      expect(entryNames(cellOf(d))).not.toContain('整段国庆项目');
    }
  });

  it('形态③ + 边界：幽灵落周日不渲染、落周五渲染；补班周六 10/10 渲染、周日 10/11 不渲染', () => {
    expect(entryNames(cellOf(REST_SUN)), '10/11 周日：幽灵落休息日不得渲染').not.toContain('幽灵落休息日');
    expect(entryNames(cellOf(REST_SUN)), '10/11 周日：补班日项目的 band 末端也不得渲染').not.toContain('补班日项目');
    expect(entryCount(cellOf(REST_SUN)), '10/11 周日整格零条目').toBe(0);

    expect(entryNames(cellOf('2026-10-09')), '10/9 周五：幽灵落工作日渲染').toContain('幽灵落工作日');
    expect(entryNames(cellOf('2026-10-09')), '10/9 周五：补班日项目渲染').toContain('补班日项目');

    expect(entryNames(cellOf(BAN_SAT)), '10/10 补班周六照常渲染（「班」就是要上班）').toContain('补班日项目');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 议程视图不受影响（项目清单、非逐日投影，信息不丢）
 * ══════════════════════════════════════════════════════════════════════════ */

describe('③ 议程视图：整段国庆项目仍在清单里（休息日过滤只作用于逐格投影）', () => {
  it('切「日程」⇒ 5 行全列，整段国庆项目的 band 10/1–10/7 原样呈现', () => {
    seedStores(POLICY_ON);
    mountView();
    switchDensity('日程');

    const rows = agendaRows();
    expect(rows, '五个项目全部在议程清单（含整段国庆项目）').toHaveLength(5);
    const inner = rows.find((r) => (r.textContent ?? '').includes('整段国庆项目'));
    expect(inner, '整段国庆项目不得从议程消失').toBeDefined();
    expect(inner!.textContent, 'band 起止原样呈现').toContain('2026-10-01 – 2026-10-07');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 开关关着：与改造前一致（她没要求跳过时，节假日格照旧渲染）
 * ══════════════════════════════════════════════════════════════════════════ */

describe('④ skipHolidays 关：国庆格恢复渲染条目（纯周末/制度口径，现状不变）', () => {
  it('10/1（周四）有条目；10/3（周六）周末仍休息无条目', () => {
    seedStores({ kind: RestPolicyKind.DoubleOff, anchorWeek: null });
    mountView();

    expect(entryNames(cellOf('2026-10-01')), '开关关 ⇒ 跨国庆项目在 10/1 照旧渲染').toContain('跨国庆项目');
    expect(cellOf('2026-10-01').className, '无节日合并 ⇒ 10/1 是普通工作日').toContain('bg-paper');
    expect(cellOf('2026-10-01').textContent).not.toContain('国庆节');

    expect(entryCount(cellOf('2026-10-03')), '周末规则与开关无关 ⇒ 周六零条目').toBe(0);
    expect(entryCount(cellOf('2026-10-04')), '周日零条目').toBe(0);
  });
});
