// @vitest-environment jsdom
/**
 * 笔 3-B · 月历日期格 / 当日浮层头部 / 节假日徽章的**语言契约**（新 spec）。
 *
 * ══════════════════ 这个文件补的是哪一类缺口 ══════════════════
 * 笔 3-B 把四处「中文 aria 当定位/当数据源」的哑雷换成了语言无关钩子
 * （`data-day-today` / `data-day-count` / `data-entry-open` / `data-entry-name` /
 * `data-day-expand`）。换钩子这件事本身有个**副作用风险**：
 * 定位从此与文案解耦，**没有任何东西还在证明「页面确实渲染了消息表那一句」** ——
 * 把 aria 删掉、或把某个键接错，钩子断言照样绿。
 * ⇒ 本文件就是那半边：**锁定「钩子背后的人话 = 消息表那句」**，并额外给出
 *   · 每条取值的 **zh 字面锁**（`t()` 的取值逐字钉死，含分隔符与空格）；
 *   · **跨层不漂**的可执行断言（屏幕徽章字 vs 纸面出处 `holidayLabelOf`）；
 *   · **覆盖锁**（内置节假日表里每个节日名都有键，且 zh 取值 = JSON 的 `name` 逐字）；
 *   · **英文态真渲染**（切 `setLang('en')` 后徽章 / aria / 「+N」/ 浮层头部都变英文）。
 *
 * ══════════════════ 为什么用固定的 2026-10 ══════════════════
 * 节日名 / 补班徽章只在**有内置表的那个月**才出现，且月历条目按
 * `entryShowsOnDate`（休息日不渲染）过滤 —— 用「当月」会随运行日期漂。
 * `tests/holidays-cn.spec.tsx` 已用 2026-10 钉过同一件事，本文件沿用同一口径。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { MonthlyCalendarView } from '../src/components/calendar/MonthlyCalendarView';
import { buildMonthMeta } from '../src/components/calendar/calendarMath';
import { cnHolidayIndex, holidayLabelOf } from '../src/core/holidays';
import raw2025 from '../src/core/holidays/cn-2025.json';
import raw2026 from '../src/core/holidays/cn-2026.json';
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
import {
  CN_HOLIDAY_NAME_KEYS,
  catalogOf,
  cnHolidayNameLabel,
  setLang,
  t,
} from '../src/i18n';

/* ══════════════════════════════ 夹具 ══════════════════════════════ */

const MONTH = '2026-10'; // 国庆月：10/1–10/7 放假、9/20 与 10/10 补班
const MONTH_START = `${MONTH}-01`;
const MONTH_END = `${MONTH}-31`;
const GUOQING = '2026-10-01'; // 法定节假日 ⇒ 徽章 = 节日名
const BAN = '2026-10-10'; // 调休补班日 ⇒ 徽章 = 「班」

/** 项目数：多到每个工作日都拥挤（> 桌面阈值 4）⇒ 一定有「+N」入口可点 */
const CROWD = 9;

const ADMIN: Member = {
  id: 'mem_mci_admin',
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
}

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
          <Route path="/project/:id" element={<div data-project-open="" />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

/** jsdom 缺 matchMedia / ResizeObserver（桌面档） */
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

function seedStores(skipHolidays: boolean): void {
  unmountCurrent();
  const projects: Project[] = [];
  const stages: Stage[] = [];
  for (let i = 0; i < CROWD; i += 1) {
    const pid = `proj_mci_${i}`;
    projects.push(makeProject(pid, `项目${String.fromCharCode(65 + i)}`));
    stages.push(makeStage(`stg_mci_${i}`, pid, i + 1));
  }
  act(() => {
    useProjectsStore.getState().replaceAll({ projects, stages, tasks: [] });
    useMembersStore.getState().setAll([ADMIN]);
    useSettingsStore.setState({ currentMemberId: ADMIN.id, hydrated: true });
    useSettingsStore
      .getState()
      .setRestPolicy({ ...DEFAULT_REST_POLICY, skipHolidays });
    useUiStore.getState().setCalendarMonth(MONTH);
    useUiStore.setState({ calendarFilters: { status: new Set(), stage: new Set() } });
  });
}

/** 日期格：**按 `data-day-date` 定位**（日期不是文案，两种语言下同一个值） */
function cellOf(date: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-day-cell][data-day-date="${date}"]`);
  if (el === null) throw new Error(`未找到日期格 ${date}（月历应渲染 ${MONTH}）`);
  return el;
}

function badgesIn(cell: HTMLElement): string[] {
  // 节日名小字 = 格内唯一「带 title 的小 span」（与日号/计数区分）
  return [...cell.querySelectorAll<HTMLElement>('span[title]')].map((s) => s.textContent ?? '');
}

beforeEach(() => {
  localStorage.clear();
  installEnvStubs();
  setLang('zh');
});

afterEach(() => {
  unmountCurrent();
  setLang('zh'); // 语言是模块级全局状态 ⇒ 每条用例后复位，避免污染后续用例
  act(() => {
    useSettingsStore.setState({
      currentMemberId: null,
      hydrated: false,
      restPolicy: DEFAULT_REST_POLICY,
      effectiveRestPolicy: DEFAULT_REST_POLICY,
    });
  });
});

/* ══════════════ ① 取值锁（zh 字面量：含分隔符与空格，不靠分段器） ══════════════
 *
 * 为什么这些字面量必须写在 spec 里、而不是只由 `tools/zh-verbatim-check.mjs` 管：
 *   那个分段器**只在段长 ≥6 时判定**，本笔有 4 条取值（`班`/`（今天）`/`调休补班日`/
 *   `，{n} 个项目`）短于阈值 ⇒ 它一条也判不了（工具的能力边界，已如实登记）。
 *   这里的 `toBe(字面量)` 才是那几条的**低界**。
 */
describe('① zh 取值锁（字面量）', () => {
  const zh = catalogOf('zh');

  it('日期格三段：今天后缀 / 计数后缀 / 节日后缀（分隔符住在取值里）', () => {
    expect(zh['calendar.cell.todaySuffix']).toBe('（今天）');
    expect(zh['calendar.cell.countSuffix']).toBe('，{n} 个项目');
    expect(zh['calendar.cell.holidaySuffix']).toBe('，{label}');
    expect(t('calendar.cell.countSuffix', { n: 9 })).toBe('，9 个项目');
    expect(t('calendar.cell.holidaySuffix', { label: '国庆节' })).toBe('，国庆节');
  });

  it('格子内文案：条目 aria / 展开 aria / 溢出标 / 窄窗计数', () => {
    expect(t('calendar.cell.openProject', { name: '项目A' })).toBe('打开项目 项目A');
    expect(t('calendar.cell.expandAria', { n: 3 })).toBe('展开 3 个项目的当日清单');
    expect(t('calendar.cell.overflow', { n: 1 })).toBe('…+1 个项目');
    expect(t('calendar.cell.mobileCount', { n: 5 })).toBe('5 个');
  });

  it('浮层头部：zh「8 月 28 日 · 5 个项目」（日期由 date 出口填，键里不含格式串）', () => {
    expect(t('calendar.dayPopover.head', { date: '8 月 28 日', n: 5 })).toBe('8 月 28 日 · 5 个项目');
  });

  it('补班徽章两字：显示字「班」、读屏「调休补班日」', () => {
    expect(zh['calendar.holiday.makeupBadge']).toBe('班');
    expect(zh['calendar.holiday.makeupAria']).toBe('调休补班日');
  });

  it('en 取值（同一批键的另一半，钉住英文不是漏翻的占位）', () => {
    const en = catalogOf('en');
    expect(en['calendar.holiday.makeupBadge']).toBe('Work');
    expect(en['calendar.cell.openProject']).toBe('Open project {name}');
    expect(en['holiday.cn.nationalDay']).toBe('National Day');
  });
});

/* ══════════════ ② 跨层不漂（可执行断言） ══════════════
 *
 * `班` 有两个出处，语言要求**相反**：
 *   · 屏幕（月历格徽章）⇒ 随界面语言 ⇒ 消息表 `calendar.holiday.makeupBadge`；
 *   · 纸面（打印稿，恒中文）⇒ `src/core/holidays.holidayLabelOf`（核心不得 import i18n）。
 * 两边本可以各自漂成不同字 —— 所以「不漂」必须**可执行**，不能靠注释。
 */
describe('② 屏幕徽章 vs 纸面出处：zh 下逐字相同', () => {
  const idx = cnHolidayIndex();

  it('★ `班`：消息表取值 === core/holidays 的纸面取值（同一枚徽章的两个出处）', () => {
    expect(catalogOf('zh')['calendar.holiday.makeupBadge']).toBe(holidayLabelOf(idx, BAN));
  });

  it('★ 节日名：8 个去重取值全部有键，且 zh 取值 === JSON 的 `name` 逐字', () => {
    const names = new Set<string>();
    for (const y of [raw2025, raw2026]) for (const h of y.holidays) names.add(h.name);
    expect(names.size, '内置表应有 8 个去重节日名（2025 含合并条「国庆节·中秋节」）').toBe(8);
    for (const name of names) {
      const key = CN_HOLIDAY_NAME_KEYS[name];
      expect(key, `新增节日名「${name}」没有文案键 ⇒ 英文态会露中文（覆盖率锁）`).toBeDefined();
      expect(catalogOf('zh')[key!], `zh 取值必须与 JSON 的 name 逐字相同（${name}）`).toBe(name);
    }
    // 未知值回落原文（与 writebackStatusLabel 同口径）：宁可显示中文，也不显示空
    expect(cnHolidayNameLabel('未登记的新节日')).toBe('未登记的新节日');
  });

  it('节日名取词在 en 下真的换了词（不是原样回显）', () => {
    setLang('en');
    expect(cnHolidayNameLabel('国庆节')).toBe('National Day');
    expect(cnHolidayNameLabel('国庆节·中秋节')).toBe('National Day · Mid-Autumn Festival');
  });
});

/* ══════════════ ③ 结构锁：`buildMonthMeta` 的 lang 必填 ══════════════ */
describe('③ 结构锁：lang 必填、绝不给缺省值', () => {
  it('★ 运行期 arity = 3 ⇒ 三个形参都没有缺省值（给 lang 加缺省值即红）', () => {
    /*
     * `meta.label` 被屏幕（随语言）与纸面（恒中文）两类**要求相反**的读者消费。
     * 若写成 `lang = 'zh'`，漏传会静默退化成中文 —— 那正是「错的那一支看起来是对的」。
     *
     * 判据：`fn.length` 数的是「**首个带缺省值**（或 rest）参数之前」的形参个数。
     *   现在 = 3（`calendarMonth` / `lang` / `todayIso`；
     *   ⚠️ `todayIso?: string` 的 `?` **不影响**运行期 length，只有 `=` 才影响）；
     *   一旦给 `lang` 加缺省值 ⇒ length 掉到 **1**，本条当场变红。
     */
    expect(buildMonthMeta.length, '三个形参都必须无缺省值：给 lang 加缺省值 ⇒ length 掉到 1').toBe(3);
  });

  it('同一月、两种语言 ⇒ label 不同；纸面那一支必须显式写 zh', () => {
    expect(buildMonthMeta(MONTH, 'zh').label).toBe('2026年10月');
    expect(buildMonthMeta(MONTH, 'en').label).toBe('Oct 2026');
    expect(buildMonthMeta(MONTH, 'zh').label, '纸面调用点传的也是 zh ⇒ 与显式 zh 同一取值').toBe(
      buildMonthMeta(MONTH, 'zh', '2026-10-15').label,
    );
  });
});

/* ══════════════ ④ zh DOM：钩子 + 人话 = 消息表那句 ══════════════ */
describe('④ zh 渲染态：钩子背后的人话 = 消息表那句', () => {
  beforeEach(() => {
    seedStores(true); // skipHolidays 开 ⇒ 节日名与补班徽章都在场
    mountView();
  });

  it('节日格：徽章字 = 消息表 zh 取值（页面确实消费该键）', () => {
    const cell = cellOf(GUOQING);
    expect(badgesIn(cell)).toEqual([catalogOf('zh')['holiday.cn.nationalDay']]);
  });

  it('★ 补班格：徽章字 = 消息表取值 = core 的纸面取值（三处同一字）', () => {
    const cell = cellOf(BAN);
    const shown = badgesIn(cell)[0]!;
    expect(shown).toBe(catalogOf('zh')['calendar.holiday.makeupBadge']);
    expect(shown).toBe(holidayLabelOf(cnHolidayIndex(), BAN));
    // 读屏说的是另一句（整句解释），也要走消息表 —— 且**不是**用 `=== '班'` 比较出来的
    expect(cell.getAttribute('aria-label')).toContain(catalogOf('zh')['calendar.holiday.makeupAria']);
  });

  it('★ 整条 aria 的 zh 字面锁（挑一个无节日徽章的当月格 ⇒ 与运行日期解耦）', () => {
    const cell = [...document.querySelectorAll<HTMLElement>('[data-day-cell]')].find(
      (c) =>
        (c.getAttribute('data-day-date') ?? '').startsWith(MONTH) &&
        !c.hasAttribute('data-day-today') &&
        badgesIn(c).length === 0,
    );
    // 前提断言：真的挑到了这样一个格（否则下面的整条断言不成立，会变成空过）
    expect(cell, '应能在 2026-10 里挑到一个「非今天、无节日徽章」的格').toBeTruthy();
    const date = cell!.getAttribute('data-day-date')!;
    const n = Number(cell!.getAttribute('data-day-count'));
    // 字面量写在 spec 里（不是从消息表拼出来的）⇒ 这才是取值逐字的低界
    expect(cell!.getAttribute('aria-label')).toBe(`${date}，${n} 个项目`);
  });

  it('条目按钮：`data-entry-name` 是事实、`aria-label` 是人话（两者必须同源）', () => {
    const cell = cellOf('2026-10-08'); // 工作日、拥挤 ⇒ 必有条目
    const entry = cell.querySelector<HTMLElement>('button[data-entry-open]');
    expect(entry, '工作日格应有条目按钮').toBeTruthy();
    const name = entry!.getAttribute('data-entry-name')!;
    expect(name.length).toBeGreaterThan(0);
    expect(entry!.getAttribute('aria-label')).toBe(t('calendar.cell.openProject', { name }));
  });

  it('「+N」入口：aria = 消息表那句；`data-day-expand` 与 `data-day-count` 同源', () => {
    const cell = cellOf('2026-10-08');
    const expand = cell.querySelector<HTMLElement>('button[data-day-expand]');
    expect(expand, '拥挤工作日应有「+N」入口').toBeTruthy();
    const n = Number(cell.getAttribute('data-day-count'));
    expect(n, '前置：10/08 应超过桌面折叠阈值 4（否则「+N」不存在）').toBeGreaterThan(4);
    const hidden = n - 4; // 桌面阈值 4（COLLAPSE_LIMIT_DESKTOP）
    expect(expand!.getAttribute('aria-label')).toBe(t('calendar.cell.expandAria', { n: hidden }));
    expect(expand!.textContent).toBe(t('calendar.cell.overflow', { n: hidden }));
  });

  it('浮层头部：可见字 = 消息表那句（日期由 date 出口填）', () => {
    act(() => {
      cellOf('2026-10-08').querySelector<HTMLElement>('button[data-day-expand]')!.click();
    });
    const panel = document.querySelector<HTMLElement>('[data-day-popover]');
    expect(panel, '点「+N」应弹出当日浮层').toBeTruthy();
    const n = Number(cellOf('2026-10-08').getAttribute('data-day-count'));
    expect(panel!.textContent).toContain(
      t('calendar.dayPopover.head', { date: '10 月 8 日', n }),
    );
  });
});

/* ══════════════ ⑤ en DOM：切语言后真的换了一整套字 ══════════════ */
describe('⑤ en 渲染态：徽章 / aria / 「+N」/ 头部都随语言切换', () => {
  beforeEach(() => {
    seedStores(true);
    setLang('en');
    mountView();
  });

  it('节日与补班徽章换成英文（且不再是中文那两个字）', () => {
    expect(badgesIn(cellOf(GUOQING))).toEqual([catalogOf('en')['holiday.cn.nationalDay']]);
    const ban = badgesIn(cellOf(BAN))[0]!;
    expect(ban).toBe(catalogOf('en')['calendar.holiday.makeupBadge']);
    expect(ban).not.toBe(catalogOf('zh')['calendar.holiday.makeupBadge']);
  });

  it('格子 aria / 条目 aria / 「+N」aria 全部走英文键（拿中文当选择器的地方会静默失配）', () => {
    const cell = cellOf('2026-10-08');
    const n = Number(cell.getAttribute('data-day-count'));
    expect(n, '前置：10/08 应超过桌面折叠阈值 4（否则「+N」不存在）').toBeGreaterThan(4);
    expect(cell.getAttribute('aria-label')).toContain(t('calendar.cell.countSuffix', { n }));
    expect(cell.getAttribute('aria-label'), '英文态不得再出现中文单位').not.toContain('个');
    const entry = cell.querySelector<HTMLElement>('button[data-entry-open]')!;
    expect(entry.getAttribute('aria-label')).toBe(
      t('calendar.cell.openProject', { name: entry.getAttribute('data-entry-name')! }),
    );
    const expand = cell.querySelector<HTMLElement>('button[data-day-expand]')!;
    expect(expand.getAttribute('aria-label')).toBe(t('calendar.cell.expandAria', { n: n - 4 }));
    expect(expand.textContent).toBe(t('calendar.cell.overflow', { n: n - 4 }));
  });

  it('浮层头部走英文（日期也换格式：`Oct 8` 而不是 `10 月 8 日`）', () => {
    act(() => {
      cellOf('2026-10-08').querySelector<HTMLElement>('button[data-day-expand]')!.click();
    });
    const text = document.querySelector<HTMLElement>('[data-day-popover]')!.textContent ?? '';
    expect(text).toContain('Oct 8');
    expect(text, '英文态不得残留中文日期格式').not.toContain(' 月 ');
  });
});
