// @vitest-environment jsdom
/**
 * 中国法定节假日接入（src/core/holidays）· 加载器 / 合并 / 开关持久化 / 月历渲染。
 *
 * ══════════════════ 为什么整份文件跑 jsdom ══════════════════
 * 纯函数部分（加载器 / 合并 / normalize）在 jsdom 里同样成立；月历渲染部分必须
 * jsdom（真实 MonthlyCalendarView + MonthDayCell 的 DOM 断言）。合成一个文件，
 * 避免「纯函数 spec 与组件 spec 各写一半、fixtures 漂移」。
 *
 * ══════════════════ 覆盖的四层 ══════════════════
 * ① 数据完整性：逐年对照国务院办公厅通知的总天数 / 补班日个数 / 星期几
 *    （通知原文自带「周四/周六」字样，是独立于数据录入的校验源）；
 * ② 加载器纯函数：展开（holidays/workdays/nameOf）、缺失年份降级返回空；
 * ③ 合并语义：skipHolidays 关 = 原样（同引用）；开 = 内置表进两个数组，
 *    且**用户手填优先**（冲突日内置数据让位）、补班日压周休（extraWorkdays 最高优先级）；
 * ④ 端到端：store setRestPolicy 派生 effectiveRestPolicy + settings JSON 往返
 *    重 hydrate（持久化不冻结内置表），以及月历节日名 / 「班」小字与底纹渲染。
 *
 * 数据来源（写入 commit message）：
 *   2025 — 国办发明电〔2024〕12号（2024-11-12，gov.cn/zhengce/content/202411/content_6986382.htm）
 *   2026 — 《国务院办公厅关于2026年部分节假日安排的通知》（2025-11-04，人民网/央广网/光明日报多源一致）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import {
  cnHolidayIndex,
  cnHolidayYears,
  holidayLabelOf,
} from '../src/core/holidays';
import {
  hydrateRestPolicy,
  normalizeRestPolicy,
  withCnHolidays,
} from '../src/core/holidays/policy';
import raw2025 from '../src/core/holidays/cn-2025.json';
import raw2026 from '../src/core/holidays/cn-2026.json';
import { isRestDay } from '../src/lib/workdays';
import { DEFAULT_REST_POLICY } from '../src/core/types/entities';
import type { RestPolicyConfig } from '../src/core/types/entities';
import { RestPolicyKind } from '../src/core/types/enums';
import { MonthlyCalendarView } from '../src/components/calendar/MonthlyCalendarView';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { useUiStore } from '../src/store/useUiStore';
import type { Member, Project, Stage } from '../src/core/types/entities';
import { MemberActorKind, MemberRoleKind, ProjectStatus, StageStatus } from '../src/core/types/enums';
import { dayjs } from '../src/lib/date';

/* ══════════════════════════════ ① 数据完整性（对照官方通知） ══════════════════════════════ */

describe('① 内置数据表：逐年对照国务院办公厅通知', () => {
  it('2025 / 2026 均已核实入库；2027 不建文件（公告未发布，不许凭记忆编）', () => {
    expect(cnHolidayYears()).toEqual([2025, 2026]);
    expect(raw2025.verified).toBe(true);
    expect(raw2026.verified).toBe(true);
    // 缺失年份 ⇒ 查表返回空标签（降级 = 只按周休，排期不猜、月历不显示）
    const index = cnHolidayIndex();
    expect(holidayLabelOf(index, '2027-10-01')).toBeNull();
  });

  it('2025：放假区间总天数与通知逐条一致（元旦1/春8/清明3/劳动5/端午3/国庆中秋8）', () => {
    const spans: Record<string, number> = {
      元旦: 1,
      春节: 8,
      清明节: 3,
      劳动节: 5,
      端午节: 3,
      '国庆节·中秋节': 8,
    };
    expect(raw2025.holidays).toHaveLength(6);
    for (const h of raw2025.holidays) {
      const days = dayjs(h.end).diff(dayjs(h.start), 'day') + 1;
      expect(days, `2025 ${h.name} 应 ${spans[h.name]} 天（实为 ${days}）`).toBe(spans[h.name]);
    }
    // 补班日 5 个：1/26（日）2/8（六）4/27（日）9/28（日）10/11（六）
    expect([...raw2025.workdays].sort()).toEqual([
      '2025-01-26',
      '2025-02-08',
      '2025-04-27',
      '2025-09-28',
      '2025-10-11',
    ]);
  });

  it('2026：放假区间总天数与通知逐条一致（元旦3/春9/清明3/劳动5/端午3/中秋3/国庆7）', () => {
    const spans: Record<string, number> = {
      元旦: 3,
      春节: 9,
      清明节: 3,
      劳动节: 5,
      端午节: 3,
      中秋节: 3,
      国庆节: 7,
    };
    expect(raw2026.holidays).toHaveLength(7);
    for (const h of raw2026.holidays) {
      const days = dayjs(h.end).diff(dayjs(h.start), 'day') + 1;
      expect(days, `2026 ${h.name} 应 ${spans[h.name]} 天（实为 ${days}）`).toBe(spans[h.name]);
    }
    // 补班日 6 个：1/4（日）2/14（六）2/28（六）5/9（六）9/20（日）10/10（六）
    expect([...raw2026.workdays].sort()).toEqual([
      '2026-01-04',
      '2026-02-14',
      '2026-02-28',
      '2026-05-09',
      '2026-09-20',
      '2026-10-10',
    ]);
  });

  it('锚点星期与通知原文一致（2025-01-01 周三 / 2026-01-01 周四 / 2026-10-01 周四）', () => {
    expect(dayjs('2025-01-01').day()).toBe(3);
    expect(dayjs('2026-01-01').day()).toBe(4);
    expect(dayjs('2026-10-01').day()).toBe(4);
  });

  it('每个补班日都是周末（调休补班 = 周末上班；录入成工作日即为错）', () => {
    for (const y of [raw2025, raw2026]) {
      for (const d of y.workdays) {
        const dow = dayjs(d).day();
        expect([0, 6], `${d} 应落在周六/周日（实为星期${dow}）`).toContain(dow);
      }
    }
  });
});

/* ══════════════════════════════ ② 加载器纯函数 ══════════════════════════════ */

describe('② 加载器：展开 / 标签 / 缺失年份降级', () => {
  const index = cnHolidayIndex();

  it('放假日集合含区间内的全部日期（含周末天——它们同样是节日）', () => {
    for (let d = 1; d <= 7; d += 1) {
      expect(index.holidays.has(`2026-10-0${d}`), `2026-10-0${d} 应为国庆放假日`).toBe(true);
    }
    expect(index.holidays.has('2026-10-08')).toBe(false);
    // 2025 合并节 8 天全含
    expect(index.holidays.has('2025-10-01')).toBe(true);
    expect(index.holidays.has('2025-10-08')).toBe(true);
    expect(index.holidays.has('2025-10-09')).toBe(false);
  });

  it('nameOf 覆盖每个放假日；标签 = 节日名 / 补班日 = 班 / 其余 = null', () => {
    expect(holidayLabelOf(index, '2026-10-01')).toBe('国庆节');
    expect(holidayLabelOf(index, '2026-02-23')).toBe('春节');
    expect(holidayLabelOf(index, '2025-10-01')).toBe('国庆节·中秋节');
    // 调休补班日（周末上班）
    expect(holidayLabelOf(index, '2026-09-20')).toBe('班');
    expect(holidayLabelOf(index, '2026-10-10')).toBe('班');
    // 普通工作日 / 普通周末 / 未建表年份
    expect(holidayLabelOf(index, '2026-10-08')).toBeNull();
    expect(holidayLabelOf(index, '2026-10-11')).toBeNull(); // 普通周六
    expect(holidayLabelOf(index, '2027-05-01')).toBeNull();
  });

  it('缺失年份（2027）不贡献任何日期 ⇒ 排期只按周休、月历不显示', () => {
    const only2027 = (d: string): boolean => d.startsWith('2027');
    expect([...index.holidays].some(only2027)).toBe(false);
    expect([...index.workdays].some(only2027)).toBe(false);
    // 合并进制度后，2027 的五一仍是普通周五（不被内置表命中）
    const merged = withCnHolidays({ kind: RestPolicyKind.DoubleOff, anchorWeek: null, skipHolidays: true });
    expect(merged.extraHolidays).not.toContain('2027-05-03');
    expect(isRestDay('2027-05-03', merged)).toBe(false);
  });
});

/* ══════════════════════════════ ③ 合并语义（用户手填 > 内置） ══════════════════════════════ */

const DOUBLE: RestPolicyConfig = { kind: RestPolicyKind.DoubleOff, anchorWeek: null };

describe('③ withCnHolidays：hydrate 边界合并', () => {
  it('skipHolidays 关（缺省/false）⇒ 原样返回同一引用（现状逐字节不变）', () => {
    expect(withCnHolidays(DOUBLE)).toBe(DOUBLE);
    expect(withCnHolidays({ ...DOUBLE, skipHolidays: false })).toEqual(
      expect.objectContaining({ skipHolidays: false }),
    );
    const off = { ...DOUBLE, skipHolidays: false };
    expect(withCnHolidays(off)).toBe(off);
  });

  it('开 ⇒ 内置放假日进 extraHolidays、补班日进 extraWorkdays', () => {
    const merged = withCnHolidays({ ...DOUBLE, skipHolidays: true });
    expect(merged.extraHolidays).toContain('2026-10-01');
    expect(merged.extraHolidays).toContain('2026-02-16'); // 春节内的周一
    expect(merged.extraWorkdays).toContain('2026-09-20');
    expect(merged.extraWorkdays).toContain('2026-10-10');
    // 不落库的只是合并结果；原始值不动
    expect(merged.skipHolidays).toBe(true);
  });

  it('判定链天然成立：节假日休息、补班日上班、补班日压周休', () => {
    const merged = withCnHolidays({ ...DOUBLE, skipHolidays: true });
    // 国庆周一（2026-10-05 周一）休息——extraHolidays 压过「周一~周五上班」
    expect(isRestDay('2026-10-05', merged)).toBe(true);
    // 2026-09-20 是周日：周休本就说休息，补班日经 extraWorkdays（最高优先级）改为上班
    expect(isRestDay('2026-09-20', merged)).toBe(false);
    expect(isRestDay('2026-09-20', DOUBLE)).toBe(true); // 对照：不开开关时它是休息日
  });

  it('用户手填优先①：用户把内置放假日标进 extraWorkdays ⇒ 该日不合并进 extraHolidays', () => {
    const merged = withCnHolidays({
      ...DOUBLE,
      skipHolidays: true,
      extraWorkdays: ['2026-10-01'],
    });
    expect(merged.extraHolidays).not.toContain('2026-10-01');
    expect(merged.extraWorkdays).toContain('2026-10-01');
    expect(isRestDay('2026-10-01', merged)).toBe(false); // 公司过节上班，听用户的
    // 其余节假日不受影响
    expect(isRestDay('2026-10-02', merged)).toBe(true);
  });

  it('用户手填优先②：用户把内置补班日标进 extraHolidays ⇒ 该日不合并进 extraWorkdays', () => {
    const merged = withCnHolidays({
      ...DOUBLE,
      skipHolidays: true,
      extraHolidays: ['2026-09-20'],
    });
    expect(merged.extraWorkdays).not.toContain('2026-09-20');
    expect(merged.extraHolidays).toContain('2026-09-20');
    expect(isRestDay('2026-09-20', merged)).toBe(true); // 补班日公司休息，听用户的
  });

  it('幂等：合并结果再合并一次不增长（重 hydrate 安全）', () => {
    const once = withCnHolidays({ ...DOUBLE, skipHolidays: true });
    const twice = withCnHolidays(once);
    expect(new Set(twice.extraHolidays)).toEqual(new Set(once.extraHolidays));
    expect(new Set(twice.extraWorkdays)).toEqual(new Set(once.extraWorkdays));
  });

  it('与 DEFAULT_REST_POLICY 无关：内置表绝不掺进出厂策略（双休护栏不被动摇）', () => {
    expect(DEFAULT_REST_POLICY.extraHolidays).toBeUndefined();
    expect(DEFAULT_REST_POLICY.extraWorkdays).toBeUndefined();
    expect(DEFAULT_REST_POLICY.skipHolidays).toBeUndefined();
    // 双休护栏：2026-10-05（国庆周一）在出厂策略下是普通工作日
    expect(isRestDay('2026-10-05', DEFAULT_REST_POLICY)).toBe(false);
  });
});

/* ══════════════════════ ③b normalize / hydrate（settings 行边界） ══════════════════════ */

describe('③b normalizeRestPolicy / hydrateRestPolicy：settings 行形状收敛', () => {
  it('旧行（无 skipHolidays）⇒ false；hydrate 后与原文一致（不注入任何日期）', () => {
    const norm = normalizeRestPolicy({ kind: 'double_off', anchorWeek: null });
    expect(norm.skipHolidays).toBe(false);
    expect(norm.extraHolidays).toBeUndefined();
    expect(hydrateRestPolicy({ kind: 'double_off', anchorWeek: null }).extraHolidays).toBeUndefined();
  });

  it('新行：skipHolidays 只认 true；数组元素过滤非字符串', () => {
    const norm = normalizeRestPolicy({
      kind: 'big_small_week',
      anchorWeek: '2026-W40',
      skipHolidays: true,
      extraHolidays: ['2026-10-01', 42, null],
      extraWorkdays: ['2026-09-20'],
    });
    expect(norm.skipHolidays).toBe(true);
    expect(norm.extraHolidays).toEqual(['2026-10-01']);
    expect(norm.extraWorkdays).toEqual(['2026-09-20']);
    // hydrate = normalize + 合并
    const eff = hydrateRestPolicy({
      kind: 'double_off',
      anchorWeek: null,
      skipHolidays: true,
    });
    expect(eff.extraHolidays).toContain('2026-10-01');
    expect(eff.extraWorkdays).toContain('2026-09-20');
  });

  it('坏行（null / 非对象 / kind 非法）⇒ 回落 DEFAULT_REST_POLICY', () => {
    expect(normalizeRestPolicy(null)).toBe(DEFAULT_REST_POLICY);
    expect(normalizeRestPolicy('x')).toBe(DEFAULT_REST_POLICY);
    expect(normalizeRestPolicy({ kind: 'triple_off' })).toBe(DEFAULT_REST_POLICY);
  });
});

/* ══════════════════════ ④ store：派生 + 持久化往返（重 hydrate） ══════════════════════ */

describe('④ useSettingsStore：effectiveRestPolicy 派生与持久化往返', () => {
  afterEach(() => {
    act(() => {
      useSettingsStore.setState({
        restPolicy: DEFAULT_REST_POLICY,
        effectiveRestPolicy: DEFAULT_REST_POLICY,
      });
    });
  });

  it('setRestPolicy：raw 与 effective 分离——落库的是手填值，生效的是合并值', () => {
    act(() => {
      useSettingsStore.getState().setRestPolicy({ ...DOUBLE, skipHolidays: true });
    });
    const st = useSettingsStore.getState();
    // 原始值不掺内置表（设置弹窗编辑/落库的都是它）
    expect(st.restPolicy.extraHolidays).toBeUndefined();
    expect(st.restPolicy.skipHolidays).toBe(true);
    // 生效值已合并
    expect(st.effectiveRestPolicy.extraHolidays).toContain('2026-10-01');
    expect(st.effectiveRestPolicy.extraWorkdays).toContain('2026-10-10');
  });

  it('开关关 ⇒ effective 与 raw 同一引用（现状逐字节不变）', () => {
    const off: RestPolicyConfig = { kind: RestPolicyKind.SingleOff, anchorWeek: null };
    act(() => {
      useSettingsStore.getState().setRestPolicy(off);
    });
    expect(useSettingsStore.getState().effectiveRestPolicy).toBe(off);
  });

  it('写入 settings → JSON 往返 → 重 hydrate：开关不丢、内置表不冻结', () => {
    act(() => {
      useSettingsStore.getState().setRestPolicy({ ...DOUBLE, skipHolidays: true });
    });
    // 模拟 settings 表往返（落库的是 raw 的 JSON）
    const persisted = JSON.parse(JSON.stringify(useSettingsStore.getState().restPolicy));
    expect(persisted).toEqual({ kind: 'double_off', anchorWeek: null, skipHolidays: true });
    // 模拟重启：useRepos 读入 → normalize → setRestPolicy
    const rehydrated = normalizeRestPolicy(persisted);
    expect(rehydrated.skipHolidays).toBe(true);
    act(() => {
      useSettingsStore.getState().setRestPolicy(rehydrated);
    });
    expect(useSettingsStore.getState().effectiveRestPolicy.extraHolidays).toContain('2026-10-01');
  });

  it('用户手填值在 store 层同样优先于内置表', () => {
    act(() => {
      useSettingsStore
        .getState()
        .setRestPolicy({ ...DOUBLE, skipHolidays: true, extraWorkdays: ['2026-10-01'] });
    });
    const eff = useSettingsStore.getState().effectiveRestPolicy;
    expect(eff.extraHolidays).not.toContain('2026-10-01');
    expect(isRestDay('2026-10-01', eff)).toBe(false);
  });
});

/* ══════════════════════════════ ④b 月历渲染（jsdom） ══════════════════════════════ */

const MONTH = '2026-10'; // 国庆月：10/1–10/7 放假，9/20（日）与 10/10（六）补班
const GUOQING = '2026-10-01';
const BAN = '2026-10-10'; // 周六补班日（在 10 月网格内）

const ADMIN: Member = {
  id: 'mem_hol_admin',
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

function makeProject(): Project {
  return {
    id: 'proj_hol_1',
    name: '在建项目',
    address: '',
    clientName: '客户甲',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-10-01T00:00:00Z',
    plannedEndAt: '2026-10-31T23:59:59Z',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: 'calendar',
    domain: null,
    kind: 'human',
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    ownerMemberId: null,
  };
}

function makeStage(): Stage {
  return {
    id: 'stg_hol_1',
    projectId: 'proj_hol_1',
    orderIndex: 1,
    templateKey: null,
    colorIndex: 1,
    customColor: null,
    name: '阶段1',
    ratioPercent: 100,
    startAt: '2026-10-01T00:00:00Z',
    endAt: '2026-10-31T23:59:59Z',
    status: StageStatus.InProgress,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

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

/** jsdom 缺 matchMedia / ResizeObserver：桌面档（月历手机断点恒 false） */
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

/** 装库：一个横跨 10 月的进行中项目 ⇒ 月视图正常出网格（不进空状态） */
function seedStores(restPolicy: RestPolicyConfig): void {
  unmountCurrent();
  act(() => {
    useProjectsStore.getState().replaceAll({
      projects: [makeProject()],
      stages: [makeStage()],
      tasks: [],
    });
    useMembersStore.getState().setAll([ADMIN]);
    useSettingsStore.setState({ currentMemberId: ADMIN.id, hydrated: true });
    // 走 setRestPolicy（hydrate 边界派生）：effectiveRestPolicy 自动带上内置表合并
    useSettingsStore.getState().setRestPolicy(restPolicy);
    useUiStore.getState().setCalendarMonth(MONTH);
    useUiStore.setState({ calendarFilters: { status: new Set(), stage: new Set() } });
  });
}

/** 日期格（aria-label 形如「YYYY-MM-DD…」） */
function cellOf(date: string): HTMLElement {
  const el = [...document.querySelectorAll<HTMLElement>('[data-day-cell]')].find((c) =>
    (c.getAttribute('aria-label') ?? '').startsWith(date),
  );
  if (!el) throw new Error(`未找到日期格 ${date}`);
  return el;
}

describe('④b 月历：节日名 / 「班」小字与底纹（jsdom）', () => {
  beforeEach(() => {
    localStorage.clear();
    installEnvStubs();
  });

  afterEach(() => {
    unmountCurrent();
    act(() => {
      useSettingsStore.setState({
        currentMemberId: null,
        hydrated: false,
        restPolicy: DEFAULT_REST_POLICY,
        effectiveRestPolicy: DEFAULT_REST_POLICY,
      });
    });
  });

  it('开关开：国庆格显示「国庆节」小字 + bg-rest-day；补班日显示「班」+ bg-paper', () => {
    seedStores({ ...DOUBLE, skipHolidays: true });
    mountView();

    const gq = cellOf(GUOQING);
    expect(gq.textContent, '国庆格应显示节日名小字').toContain('国庆节');
    expect(gq.getAttribute('aria-label')).toContain('国庆节');
    expect(gq.className, '节假日 isRestDay=true ⇒ 自动落休息底纹（不新增底色档）').toContain(
      'bg-rest-day',
    );
    // 小字 token：与移动端计数小字同款（text-[9px] text-mist）
    const label = [...gq.querySelectorAll('span')].find((s) => s.textContent === '国庆节');
    expect(label?.className).toContain('text-[9px]');
    expect(label?.className).toContain('text-mist');

    const ban = cellOf(BAN);
    expect(ban.textContent, '调休补班日应显示「班」').toContain('班');
    expect(ban.getAttribute('aria-label')).toContain('调休补班日');
    expect(ban.className, '补班日 isRestDay=false ⇒ bg-paper（与周末同底纹不成立）').toContain(
      'bg-paper',
    );
    expect(ban.className).not.toContain('bg-rest-day');

    // 图例补轻量文字说明
    expect(document.body.textContent).toContain('节日名 = 法定节假日 · 班 = 调休补班日');
  });

  it('开关关（默认）：网格无节日名，10/1 是普通工作日（bg-paper）、10/10 周六休息', () => {
    seedStores(DEFAULT_REST_POLICY);
    mountView();

    const gq = cellOf(GUOQING);
    expect(gq.textContent).not.toContain('国庆节');
    expect(gq.className).toContain('bg-paper');
    expect(gq.className).not.toContain('bg-rest-day');

    const ban = cellOf(BAN);
    expect(ban.textContent).not.toContain('班');
    expect(ban.className).toContain('bg-rest-day'); // 普通周六

    // 无节日名可解释 ⇒ 图例不出说明
    expect(document.body.textContent).not.toContain('节日名 = 法定节假日');
  });

  it('周视图复用同一日期格 ⇒ 同样获得节日名（开关开时）', () => {
    seedStores({ ...DOUBLE, skipHolidays: true });
    mountView();
    // 先选中 2026-09-30（周三）⇒ 周视图落到 9/28~10/4 这一周（含 10/1）
    act(() => {
      cellOf('2026-09-30').click();
    });
    // 切「周」：同一套日期格（grid(weekDays)）
    act(() => {
      const btn = [...document.querySelectorAll<HTMLElement>('button')].find(
        (b) => (b.textContent ?? '').trim() === '周',
      );
      btn?.click();
    });
    const gq = cellOf(GUOQING);
    expect(gq.textContent).toContain('国庆节');
    expect(gq.className).toContain('bg-rest-day');
  });
});
