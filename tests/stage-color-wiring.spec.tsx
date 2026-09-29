// @vitest-environment jsdom
/**
 * v0.8 · T05 验收（一）：A11「四处一致」自定义阶段色 —— **接线**（消费点）层。
 *
 * ══════════════════ 本文件为什么存在（一手证据）══════════════════
 *
 * T02 把「通路 B」的**机制**做完了（`src/core/color/custom-color-registry.ts` 注入表、
 * `src/components/timeline/stageColors.ts` 三个取色出口的 `customColor` 形参）。
 * 但 T02 自己的验收文件**明文声明不覆盖接线**：
 *
 *   `tests/isolation-browser.spec.ts:18-23`
 *     「本 spec 覆盖什么 / 不覆盖什么（诚实边界）……
 *       不覆盖：T03 把 `data-stage-key` 铺到真实月历/时间轴 DOM 上的**接线**——
 *       那是 T03 的交付面，本 spec 用同构探针元素验证的是 T02 的 CSS 契约。」
 *
 * 而 T03 实际只接了**建档视图**（`stageColorAttrs` 全仓仅 3 处消费者，全在
 * `src/components/contract-wizard/`）。于是四处真实消费点（时间轴 / 阶段卡 / 月历 / 打印页）
 * **一个都没接** —— 这是一次被漏掉的 T02→T03 交接，本文件即该缺口的验收面（T05）。
 *
 * ══════════════════ 断言口径：为什么是「两个半件」而不是 computed 色值 ══════════════════
 *
 * 通路 B 要成立，元素必须**同时**具备两个半件：
 *   ① `style.backgroundColor = var(--stage-local-band|solid)`  ← 取到令牌
 *   ② `data-stage-key="sc-…"`                                  ← 命中注入表那条规则
 * 只写 ① 而漏 ② ⇒ `var()` 解析为空 ⇒ 色块**透明**（T02 的 B-07 已证）。
 *
 * 但 **jsdom 从不解析 CSS 自定义属性**：`getComputedStyle(el).backgroundColor` 只会把
 * `var(--stage-local-band)` 原样吐回来（本文件落盘前已实测，见下），拿不到真值。
 * 所以在 jsdom 里只断言这两个**可观测的半件**本身：
 *   · 内联 style 字符串（`el.style.backgroundColor`）
 *   · `data-stage-key` 的存在与格式（`/^sc-[0-9a-z]+(-\d+)?$/`）
 * 「`var()` 真的解析成不透明色」这一步**只能**在真 Chromium 里证明 ——
 * 见本文件末尾 `describe.skipIf(!CAN_RUN)` 的那一段（**独立 describe，未获口令不得运行**）。
 *
 * ── 前置实测（落盘前跑过，不是推测）──
 *   `node tmp/probe-var-style.mjs`（jsdom 25.0.1）：
 *     backgroundColor            = "var(--stage-local-band)"     ← 内联 style 保留 var()
 *     boxShadow                  = "inset 0 0 0 1px rgb(var(--stage-local-ink-rgb) / 0.3)"
 *     getComputedStyle(...).backgroundColor = "var(--stage-local-band)"  ← computed 不解析
 *   即：`el.style.*` 这条口径可用；`getComputedStyle` 那条不可用。
 *
 * ══════════════════ 通路 A（内置 9 色）必须逐字节不变 ══════════════════
 *
 * 四处消费点原先走的是 **Tailwind 静态类镜像**（`bg-stage-band-sN` / `bg-stage-sN`），
 * 其 CSS 声明形如
 *   `rgb(var(--stage-band-sN-rgb) / calc(var(--stage-band-sN-a, 1) * <alpha-value>))`
 * （见 `tailwind.config.ts:20-21` 的 `c()`），而取色出口返回的是 `var(--stage-band-sN)` ——
 * **两条不同的变量名、同一个色值源**。因此「类 → 内联 var()」的换轨必须证明**解析结果相等**，
 * 这正是末尾真浏览器 describe 的 B-03（`bg-stage-sN` 与 `var(--stage-sN)` 的 computed 值逐段相等）。
 *
 * ⚠️ 本文件由 `tests/stage-color-wiring.spec.tsx` 独占，不改动 `src/` 下任何文件。
 *    （后缀必须是 `.tsx`：本文件含 JSX，`.ts` 下 `tsc` 会报 `TS1005 '>' expected`。）
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

import { StageBar } from '../src/components/timeline/StageBar';
import { StageRowsColumn } from '../src/components/timeline/StageRowsColumn';
import { MobileStageList } from '../src/components/timeline/MobileStageList';
import { MonthDayCell } from '../src/components/calendar/MonthDayCell';
import { ProjectCard } from '../src/components/project/ProjectCard';
import { ProjectAppearanceDialog } from '../src/components/project/ProjectAppearanceDialog';
import { Sidebar } from '../src/components/layout/Sidebar';
import {
  stageBandClass,
  stageBandColor,
  stageBandInkColor,
  stageBandOutline,
  stageSlotOf,
  stageSolidClass,
  stageSolidColor,
} from '../src/components/timeline/stageColors';
import {
  customStageColor,
  stageColorAttrs,
  STAGE_COLOR_KEY_ATTR,
} from '../src/components/timeline/stageColorKey';
import {
  __resetRegistryForTest,
  buildStageColorCss,
  registerStageColor,
  STAGE_COLOR_STYLE_ID,
  STAGE_LOCAL_VAR,
} from '../src/core/color/custom-color-registry';
import {
  buildMonthMeta,
  computeCalendarEntry,
  type CalendarEntry,
} from '../src/components/calendar/calendarMath';
import {
  bandOutlineOf,
  stageColorOf,
  stageSolidOf,
} from '../src/components/calendar/calendarColors';
import type { GridDay } from '../src/components/calendar/calendarGrid';
import { buildScheduleSections } from '../src/lib/schedule-print';
import { SchedulePrintPage } from '../src/pages/SchedulePrintPage';
import { CalendarPrintPage } from '../src/pages/CalendarPrintPage';
import { MyTasksPage } from '../src/pages/MyTasksPage';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useLayoutStore } from '../src/store/useLayoutStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage, Task } from '../src/core/types/entities';
import type { TimelineRange } from '../src/lib/date';

/**
 * `ProjectCard` 经 `useRepos()` 读 Context（本 spec 没有 Provider 树），
 * 故在模块边界上顶掉它 —— 与 `tests/v07-dline-print-access.spec.tsx:54-83` 同一手法。
 * 本 spec 只有「★ ProjectCard 阶段色签」那一组渲染卡片，其余组都不碰仓储。
 */
vi.mock('../src/hooks/useRepos', () => {
  const ok = async (): Promise<void> => undefined;
  const bundle = {
    projects: { list: async () => [], get: async () => null, insert: ok, update: ok, archive: ok, remove: ok },
    stages: { listByProject: async () => [], get: async () => null, bulkInsert: ok, update: ok, reschedule: ok },
    tasks: {
      list: async () => [],
      listByProject: async () => [],
      listByAssignee: async () => [],
      get: async () => null,
      bulkInsert: ok,
      insert: ok,
      update: ok,
      remove: ok,
      upsertByExternalId: async () => ({ created: 0, updated: 0 }),
      claim: ok,
    },
    members: { list: async () => [], get: async () => null, insert: ok, update: ok, verifyCredentials: async () => false },
    logs: {
      appendStageLog: ok,
      listStageLogsByStage: async () => [],
      listStageLogsByProject: async () => [],
      appendAssignment: ok,
      listAssignmentsByTask: async () => [],
    },
    contracts: { insert: ok, get: async () => null, linkProject: ok, saveConfirmedPayload: ok, list: async () => [] },
    settings: { get: async () => null, set: ok, all: async () => [], replaceAll: ok },
  };
  return { useRepos: (): unknown => bundle };
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 常量与夹具
 * ══════════════════════════════════════════════════════════════════════════════ */

/**
 * 自定义主色：刻意取一个**与内置 9 色都不相同**的紫。
 * 若与某内置色相同，`var(--stage-local-*)` 与内置色的 computed 值会撞在一起，
 * 断言就失去判别力（「碰巧等于内置色」式假绿）。
 */
const CUSTOM = '#7A2FD6';

/** `data-stage-key` 的格式契约（与 T02 的 B-00 同一正则口径：`sc-<hash36>`，可选碰撞盐 `-N`） */
const KEY_RE = /^sc-[0-9a-z]+(-\d+)?$/;

const PROJECT_ID = 'proj_wiring';
const ADMIN_ID = 'mem-wiring-admin';

const RANGE: TimelineRange = { from: '2026-06-01', to: '2026-06-30' };

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    name: '某茶空间',
    address: '',
    clientName: '客户甲',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-06-01T00:00:00Z',
    plannedEndAt: '2026-06-30T23:59:59Z',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: null,
    kind: 'human',
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  };
}

function makeStage(id: string, orderIndex: number, over: Partial<Stage> = {}): Stage {
  return {
    id,
    projectId: PROJECT_ID,
    orderIndex,
    templateKey: null,
    colorIndex: orderIndex,
    customColor: null,
    // 名字刻意含「交付」：StageBar 的交付子刻度（`line` / `text`）正是 ink 出口的消费者之一
    name: `阶段${orderIndex}交付`,
    ratioPercent: 100,
    startAt: '2026-06-01T00:00:00Z',
    endAt: '2026-06-30T23:59:59Z',
    status: StageStatus.InProgress,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  };
}

function makeMember(id: string, name: string, roleKind: MemberRoleKind): Member {
  return {
    id,
    name,
    role: roleKind === MemberRoleKind.Admin ? '项目负责人' : '协作成员',
    contact: null,
    avatarColor: '#88A293',
    active: true,
    roleKind,
    passwordHash: null,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    revision: 1,
    updatedAt: '2026-06-01T00:00:00Z',
  };
}

const ADMIN = makeMember(ADMIN_ID, '负责人甲', MemberRoleKind.Admin);

/* ══════════════════════════════════════════════════════════════════════════════
 * 渲染 / 取值脚手架（与仓库既有组件测同款：只用 react-dom/client，不引 testing-library）
 * ══════════════════════════════════════════════════════════════════════════════ */

let host: HTMLDivElement | null = null;
let root: Root | null = null;

/** 卸载当前树。**同一用例内多次挂载必须先收掉前一棵**，否则孤儿树仍订阅 store → 跨用例污染 */
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

/** 挂一棵任意 React 树 */
function mount(node: React.ReactElement): HTMLDivElement {
  unmountCurrent();
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  // 用局部常量持有 root：`root` 是模块级 `Root | null`，闭包里拿不到收窄后的类型
  const r = createRoot(h);
  root = r;
  act(() => {
    r.render(node);
  });
  return h;
}

/** 按路径挂真实路由子集（打印页要从 `useParams` 取 id） */
function renderAt(path: string): HTMLDivElement {
  return mount(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div data-home-marker="">首页占位</div>} />
        <Route path="/project/:id/schedule-print" element={<SchedulePrintPage />} />
        <Route path="/project/:id/calendar-print" element={<CalendarPrintPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 装 store（须在挂载**之前**、且包在 `act()` 里，避免 act 告警） */
/**
 * 装 store（须在挂载**之前**、且包在 `act()` 里，避免 act 告警）。
 * `tasks` 为可选第三参：既有调用点全都只给 stages（任务为空不影响它们的断言），
 * 只有 A13 的「预计页数」组需要「每段恰好 1 任务」来决定期望页数。
 */
function seedStores(stages: Stage[], project: Project = makeProject(), tasks: Task[] = []): void {
  unmountCurrent();
  act(() => {
    useProjectsStore.getState().replaceAll({ projects: [project], stages, tasks });
    useMembersStore.getState().setAll([ADMIN]);
    useSettingsStore.setState({ currentMemberId: ADMIN_ID, hydrated: true });
  });
}

/**
 * jsdom 缺 `matchMedia` / `ResizeObserver`（实测 undefined）。补最小桩：
 * matchMedia 恒 `matches:false`（= 桌面稿），ResizeObserver 为空实现。
 * `tests/v07-dline-print-access.spec.tsx:415-433` 同款。
 */
/**
 * @param xl 是否让 `matchMedia` 命中「xl 视口」。默认 false（= 桌面稿 1024–1280）。
 *   仅 Sidebar 那组需要传 `true`：它的展开态要求 `xl === true`，否则会渲染成折叠态。
 */
function installEnvStubs(xl = false): void {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: xl,
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

/** 单个元素查询（返回 `Element`，需要 `.style` 时由调用方收窄） */
function q(scope: ParentNode, sel: string): Element | null {
  return scope.querySelector(sel);
}

function qa(scope: ParentNode, sel: string): Element[] {
  return [...scope.querySelectorAll(sel)];
}

function must(scope: ParentNode, sel: string, what: string): Element {
  const el = q(scope, sel);
  if (el === null) throw new Error(`未找到${what}：${sel}`);
  return el;
}

/** 内联 style 读回（jsdom 会保留 `var()` 字面量 —— 见文件头的前置实测） */
function inline(el: Element): CSSStyleDeclaration {
  return (el as HTMLElement).style;
}

/**
 * SVG 取色属性读回：**内联样式优先，回落属性**。
 *
 * ── 为什么必须容忍两种写法（这是本 spec 落盘后补的一处不对称）──
 * `el.style.fill = 'var(--x)'` 与 `el.setAttribute('fill', 'var(--x)')` 在真浏览器里
 * **渲染等价**（SVG presentation attribute 与 CSS 属性同源，都吃 `var()`），
 * 但两者在 jsdom 里**互不写入**：写 style 则 `getAttribute('fill')` 为 `null`，
 * 写属性则 `style.fill` 为 `''`（cssstyle 支持 fill 这个属性名，只是两条通道不通）。
 *
 * 早先组① 对自定义读 `style.fill`、对内置读 `getAttribute('fill')` —— 这是把**实现写法**
 * 钉死成了契约：实现只要统一用其中一种，就必然有一条断言假红。契约应当是「这个元素取到了
 * 哪个色令牌」，而不是「它用哪条通道取的」。故统一经本函数读取。
 *
 * ⚠️ DOM 侧（`backgroundColor` / `boxShadow`）**只有内联样式一条通道**，不需要本函数。
 */
function svgPaint(el: Element, prop: 'fill' | 'stroke'): string {
  const s = (el as SVGElement).style[prop];
  return s && s.length > 0 ? s : (el.getAttribute(prop) ?? '');
}

/**
 * 「哪个元素挂了 `data-stage-key`」—— 断言**祖先链**而不是写死某一层。
 *
 * 契约是「该元素的作用域内存在注入表命中的锚点」，至于把属性挂在自己身上、
 * 还是挂在共同祖先（如 StageBar 的 `<g>`、MobileStageList 的 `<button>`）属于实现自由。
 * 用 `closest` 断言既不放松契约，也不把实现钉死。
 */
function keyAnchor(el: Element): Element | null {
  return el.closest(`[${STAGE_COLOR_KEY_ATTR}]`);
}

/**
 * 断言「该元素走了通路 B」：锚点存在、属性值与注册表一致、格式合法。
 * @param expectedKey 由 `registerStageColor(CUSTOM)` 独立算出，**不是**从 DOM 里读的
 */
function expectWired(el: Element, expectedKey: string): void {
  const anchor = keyAnchor(el);
  expect(
    anchor,
    '必须有一个挂了 data-stage-key 的祖先 —— 只写 var() 不挂属性 ⇒ 解析为空 ⇒ 透明',
  ).not.toBeNull();
  const attr = anchor!.getAttribute(STAGE_COLOR_KEY_ATTR);
  expect(attr).toMatch(KEY_RE);
  expect(attr, '组件侧算出的 key 必须与注册表同一 key（哈希同源，否则命中不了注入表）').toBe(
    expectedKey,
  );
}

/** 断言「该元素未走通路 B」（内置色） */
function expectNotWired(scope: ParentNode): void {
  expect(qa(scope, `[${STAGE_COLOR_KEY_ATTR}]`), '内置色不得挂 data-stage-key').toEqual([]);
}

/**
 * 内置 9 色的「换轨容忍」断言：类镜像 与 内联 var() 是**同一色值源的两个写法**
 * （`bg-stage-sN` → `rgb(var(--stage-sN-rgb) / …)`；出口 → `var(--stage-sN)`），
 * 故这里接受任一形态，但必须**恰好是内置 9 色那一档**、且绝不能是 `--stage-local-*`。
 */
function expectBuiltinToken(el: Element, kind: 'solid' | 'band', n: number): void {
  const styleValue = inline(el).backgroundColor;
  const cls = el.getAttribute('class') ?? '';
  const token =
    kind === 'solid' ? `var(--stage-s${n})` : `var(--stage-band-s${n})`;
  const expectedClass = kind === 'solid' ? `bg-stage-s${n}` : `bg-stage-band-s${n}`;
  const matched = styleValue === token || cls.split(/\s+/).includes(expectedClass);
  expect(
    { styleValue, expectedClass, matched },
    `内置色必须渲染为 ${token} 或 ${expectedClass}，且不得落到通路 B`,
  ).toMatchObject({ matched: true });
  expect(styleValue, '内置色绝不能出现 --stage-local-*').not.toContain('--stage-local');
}

beforeEach(() => {
  __resetRegistryForTest();
  localStorage.clear();
  installEnvStubs();
});

afterEach(() => {
  unmountCurrent();
  act(() => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  });
  __resetRegistryForTest();
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 组 0 · 通路 A 逐字节不变（改写取色出口**不得**动内置 9 色）
 *
 * 这是「把 StageBar.tsx:73-74 的查表改成 stageBandColor() 会不会改变行为」的正面回答：
 * 内置分支必须与改造前**逐字节同值**，脏值必须静默回落而不是抛。
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('通路 A 逐字节不变（四处的取色出口在 customColor 为空时必须零变化）', () => {
  it('内置 9 色：四个出口的返回值与改造前的表/公式逐字节相同', () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(stageBandColor(n, n, null)).toBe(`var(--stage-band-s${n})`);
      expect(stageBandInkColor(n, n, null)).toBe(`var(--stage-ink-s${n})`);
      expect(stageSolidColor(n, n, null)).toBe(`var(--stage-s${n})`);

      const outline = stageBandOutline(n, n, null);
      expect(outline.stroke).toBe(`var(--stage-ink-s${n})`);
      expect(outline.strokeOpacity).toBe(0.3);
      expect(outline.strokeWidth).toBe(1);
      expect(outline.boxShadow).toBe(
        `inset 0 0 0 1px rgb(var(--stage-ink-s${n}-rgb) / 0.3)`,
      );
    }
  });

  it('customColor ∈ {null, undefined, 空串} 一律走通路 A（三种"没传"的写法都要挡住）', () => {
    const empties: Array<string | null | undefined> = [null, undefined, ''];
    for (const v of empties) {
      expect(stageBandColor(3, 3, v)).toBe('var(--stage-band-s3)');
      expect(stageBandInkColor(3, 3, v)).toBe('var(--stage-ink-s3)');
      expect(stageSolidColor(3, 3, v)).toBe('var(--stage-s3)');
      expect(stageBandOutline(3, 3, v).stroke).toBe('var(--stage-ink-s3)');
      expect(stageBandOutline(3, 3, v).boxShadow).toBe(
        'inset 0 0 0 1px rgb(var(--stage-ink-s3-rgb) / 0.3)',
      );
    }
  });

  it('脏值（非 #rrggbb）静默回落通路 A，不抛（与 deriveStageColors 同口径：边界色不崩）', () => {
    expect(stageBandColor(3, 3, 'not-a-color')).toBe('var(--stage-band-s3)');
    expect(stageBandInkColor(3, 3, 'not-a-color')).toBe('var(--stage-ink-s3)');
    expect(stageSolidColor(3, 3, 'not-a-color')).toBe('var(--stage-s3)');
    expect(() => stageBandOutline(3, 3, 'not-a-color')).not.toThrow();
    expect(stageBandOutline(3, 3, 'not-a-color').stroke).toBe('var(--stage-ink-s3)');
  });

  it('通路 B 的三处出口各自给出对应令牌（solid / band / ink 不得互相串用）', () => {
    expect(stageSolidColor(3, 3, CUSTOM)).toBe('var(--stage-local-solid)');
    expect(stageBandColor(3, 3, CUSTOM)).toBe('var(--stage-local-band)');
    expect(stageBandInkColor(3, 3, CUSTOM)).toBe('var(--stage-local-ink)');
    const outline = stageBandOutline(3, 3, CUSTOM);
    expect(outline.stroke).toBe('var(--stage-local-ink)');
    // ⚠️ -rgb 三元组必须一起走：漏了它，自定义色的发丝描边会**静默消失**
    expect(outline.boxShadow).toBe(
      'inset 0 0 0 1px rgb(var(--stage-local-ink-rgb) / 0.3)',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 组 1 · ① 时间轴跨度色带（StageBar）—— 唯一同时消费三个出口的组件
 *   · fill   → stageBandColor
 *   · ink    → stageBandInkColor（交付子刻度、手柄、日期标注）
 *   · stroke → stageBandOutline
 * ══════════════════════════════════════════════════════════════════════════════ */

/** 渲染一根阶段彩条（`active=false` ⇒ 主体 rect 的 `stroke` 恰为 `"none"`，可作唯一标识） */
function renderStageBar(stage: Stage): HTMLDivElement {
  return mount(
    <svg>
      <StageBar
        stage={stage}
        rowIndex={0}
        rowH={44}
        rowGap={8}
        range={RANGE}
        pxPerDay={20}
        active={false}
        draggingDeltaDays={null}
        draggingEdge={null}
        onHandleDown={() => undefined}
        onClick={() => undefined}
      />
    </svg>,
  );
}

/**
 * 色带本体：唯一 `stroke="none"` 的 rect。
 * 用 `svgPaint` 而非属性选择器 —— 见 svgPaint 的说明（不把取色通道钉死成契约）。
 */
function bandRect(h: ParentNode): Element {
  const el = qa(h, 'rect').find((r) => svgPaint(r, 'stroke') === 'none');
  if (el === undefined) throw new Error('未找到色带本体 rect（stroke="none"）');
  return el;
}

/** 发丝描边层：唯一 `fill="none"` 的 rect */
function outlineRect(h: ParentNode): Element {
  const el = qa(h, 'rect').find((r) => svgPaint(r, 'fill') === 'none');
  if (el === undefined) throw new Error('未找到发丝描边 rect（fill="none"）');
  return el;
}

/** 取到指定 stroke 令牌的元素（交付子刻度竖虚线 / 日期标注等） */
function paintStrokes(h: ParentNode, token: string): Element[] {
  return qa(h, 'line').filter((el) => svgPaint(el, 'stroke') === token);
}

/** 取到指定 fill 令牌的元素（子刻度标签 / 手柄 / 日期标注） */
function paintFills(h: ParentNode, token: string): Element[] {
  return qa(h, 'rect, text').filter((el) => svgPaint(el, 'fill') === token);
}

describe('① 时间轴跨度色带 StageBar', () => {
  it('自定义色：fill / ink / stroke 三个出口全部走通路 B，且锚点 key 与注册表一致', () => {
    const key = registerStageColor(CUSTOM);
    const h = renderStageBar(makeStage('stg_bar', 3, { customColor: CUSTOM }));

    // 出口一：fill（宽面）
    const band = bandRect(h);
    expect(svgPaint(band, 'fill')).toBe('var(--stage-local-band)');
    expectWired(band, key);

    // 出口二：stroke（发丝描边，BUG-04 的修复层）
    expect(svgPaint(outlineRect(h), 'stroke')).toBe('var(--stage-local-ink)');

    // 出口三：ink —— 交付子刻度（line）+ 子刻度标签（text）+ 左右手柄（rect rx=3）
    // 手柄只在「非已完成」阶段渲染，本夹具是 InProgress。
    expect(
      paintStrokes(h, 'var(--stage-local-ink)').length,
      '交付子刻度的竖虚线必须用 ink 出口',
    ).toBeGreaterThan(0);
    // fill 侧：2 个手柄（rx=3）+ 子刻度标签 / 日期标注（width 足够时才有，此处 w=20*30 有）
    const inkedRects = paintFills(h, 'var(--stage-local-ink)').filter(
      (el) => el.tagName.toLowerCase() === 'rect',
    );
    expect(inkedRects.filter((el) => el.getAttribute('rx') === '3').length, '左右手柄各一').toBe(2);
  });

  it('内置色：不得挂 data-stage-key，且 fill / stroke / ink 与改造前逐字节相同', () => {
    const h = renderStageBar(makeStage('stg_bar', 3, { customColor: null }));

    expect(svgPaint(bandRect(h), 'fill')).toBe('var(--stage-band-s3)');
    expect(svgPaint(outlineRect(h), 'stroke')).toBe('var(--stage-ink-s3)');
    // 交付子刻度仍用内置 ink
    expect(paintStrokes(h, 'var(--stage-ink-s3)').length).toBeGreaterThan(0);
    expectNotWired(h);
  });

  it('★ 判别对照：两态必须真的不同（防「两条通路都返回 var(--stage-local-*)」式假绿）', () => {
    const key = registerStageColor(CUSTOM);

    const customH = renderStageBar(makeStage('stg_bar', 3, { customColor: CUSTOM }));
    const customFill = svgPaint(bandRect(customH), 'fill');
    const customStroke = svgPaint(outlineRect(customH), 'stroke');
    expectWired(bandRect(customH), key);
    // ⚠️ 锚点引用必须**在这一行**取：下面第二次 `renderStageBar` 会经 `mount()` →
    //    `unmountCurrent()`（见脚手架注释）把**同一用例上一棵树**卸载掉，React 会把
    //    `customH` 的子树清空 —— 之后再 `customH.querySelector(...)` 只会恒得 `null`
    //    （那会让本条断言变成「永远红」或「永远绿」的假断言，取决于写法）。
    //    取到的 `Element` 引用在卸载后仍然有效，故在断言处直接比较该引用。
    const customAnchor = customH.querySelector(`[${STAGE_COLOR_KEY_ATTR}]`);

    const builtinH = renderStageBar(makeStage('stg_bar', 3, { customColor: null }));
    const builtinFill = svgPaint(bandRect(builtinH), 'fill');
    const builtinStroke = svgPaint(outlineRect(builtinH), 'stroke');
    expectNotWired(builtinH);

    expect(customFill).not.toBe(builtinFill);
    expect(customStroke).not.toBe(builtinStroke);
    expect(customAnchor, '自定义态整棵子树必须有 data-stage-key 锚点').not.toBeNull();
    expect(builtinH.querySelector(`[${STAGE_COLOR_KEY_ATTR}]`), '内置态整棵子树不得有 data-stage-key').toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 组 1b · ★ 槽位恒等守卫（提交①：`stageSlotOf` 的「错位一格」防回归）
 *
 * ── 被守的那个 bug ──
 * `stageSlotOf` 原本在 `% 9` 之后多做一次 `+1` ⇒ 入 1 出 2、入 9 出 1，与
 * `stageSolidColor/stageBandColor` 走 `resolveStageColorIndex()`（1..9 恒等）**不同槽位**；
 * 而它自己的 docstring 却写着「与 stageBandColor 等函数共用同一约定」。
 * 8 个调用点全部传 1-based `orderIndex`，于是类名路径整体错位一格（打印页图例第 n 号
 * 色块标题写着色名 n、渲染的是 s(n+1)），且全仓**零测试**锁着它（`grep -rn
 * "stageSlotOf\|stageSolidClass\|stageBandClass" tests/` 在本组之前为空）。
 *
 * ── 为什么这一组同时钉 ProjectCard ──
 * ProjectCard 是本轮**唯一被动的**调用点（它原本是 0-based，靠与旧 `+1` 互相抵消才正确），
 * 修根因时必须同步把它的 `orderIndex - 1` 改成 `orderIndex`。它此前被判为「不在 T05 范围」，
 * 既然这一笔必须动它，就必须有守卫 —— 否则下一个人把 `- 1` 加回去也没人拦。
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('★ 槽位恒等：类名映射与取色函数必须同一口径（1-based，阶段 1 → s1）', () => {
  it('stageSlotOf：1..9 恒等，9 不被折回 s1，越界按周期 9 折回', () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(stageSlotOf(n), `阶段 ${n} 的槽位必须恒等为 ${n}`).toBe(n);
    }
    expect(stageSlotOf(9), '★ 9 必须留在 s9（旧实现折回 s1）').toBe(9);
    expect(stageSlotOf(10), '越界取模：10 → s1').toBe(1);
    expect(stageSlotOf(0), '0 折回周期末尾 s9').toBe(9);
    expect(stageSlotOf(-1)).toBe(8);
  });

  it('类名路径与取色函数路径必须指向**同一槽位**（两条通路不得漂移）', () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(stageSolidClass(n)).toBe(`bg-stage-s${n}`);
      expect(stageBandClass(n)).toBe(`bg-stage-band-s${n} text-stage-ink-s${n}`);
      // 同槽位对照：类名 sN 与取色 var(--stage-sN) 必须落在同一个 N 上
      expect(stageSolidColor(n, n)).toBe(`var(--stage-s${n})`);
      expect(stageBandColor(n, n)).toBe(`var(--stage-band-s${n})`);
    }
  });

  it('★ ProjectCard 阶段色签：orderIndex 1..9 必须渲染 bg-stage-band-s{orderIndex}，不得错位', () => {
    seedStores([]);
    for (let n = 1; n <= 9; n += 1) {
      const h = mount(
        <MemoryRouter>
          <ProjectCard
            project={makeProject()}
            stages={[makeStage(`stg_card_${n}`, n, { colorIndex: n })]}
            tasks={[]}
            members={[ADMIN]}
            todayIso="2026-06-10"
            onOpen={() => undefined}
          />
        </MemoryRouter>,
      );

      const badges = qa(h, 'span[class*="bg-stage-band-"]');
      expect(badges, `orderIndex=${n}：卡片上应恰有一枚阶段色签`).toHaveLength(1);

      const cls = badges[0]!.getAttribute('class') ?? '';
      expect(cls, `orderIndex=${n} 的色签槽位必须恒等`).toContain(`bg-stage-band-s${n}`);
      expect(cls).toContain(`text-stage-ink-s${n}`);

      // 反向：不得落到相邻槽位 —— 旧实现是 s(n+1)，n=9 时折回 s1
      const wrong = n === 9 ? 1 : n + 1;
      expect(cls, `orderIndex=${n} 不得错位到 s${wrong}`).not.toContain(`bg-stage-band-s${wrong}`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 组 2 · ② 阶段卡色点（桌面 StageRowsColumn ＋ 移动 MobileStageList）
 *   两处**同属"阶段卡"桌面/移动两态**，只接一个会让另一个立刻变成「改色后不一致」。
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('② 阶段卡 · 桌面 StageRowsColumn 色点', () => {
  function renderRows(stages: Stage[]): HTMLDivElement {
    return mount(
      <StageRowsColumn
        stages={stages}
        todayIso="2026-06-10"
        activeStageId={null}
        onRowClick={() => undefined}
        members={[]}
      />,
    );
  }

  /** 阶段色点：行内唯一带 `aria-hidden` 的 span（DueChip 的 span 无该属性） */
  function colorDot(h: ParentNode): Element {
    return must(h, 'button span[aria-hidden]', '阶段色点 span');
  }

  it('自定义色：色点内联背景 = var(--stage-local-solid)，且锚点 key 与注册表一致', () => {
    const key = registerStageColor(CUSTOM);
    const h = renderRows([makeStage('stg_dot', 1, { customColor: CUSTOM })]);

    const dot = colorDot(h);
    expect(inline(dot).backgroundColor).toBe('var(--stage-local-solid)');
    expectWired(dot, key);
  });

  it('内置色：色点走内置通路（类或内联 var()），且不得挂 data-stage-key', () => {
    const h = renderRows([makeStage('stg_dot', 1, { customColor: null })]);

    expectBuiltinToken(colorDot(h), 'solid', 1);
    expectNotWired(h);
  });

  it('★ 同一列表里混排：自定义那行走通路 B、内置那行走通路 A（互不影响）', () => {
    const key = registerStageColor(CUSTOM);
    const h = renderRows([
      makeStage('stg_custom', 1, { customColor: CUSTOM }),
      makeStage('stg_builtin', 2, { customColor: null }),
    ]);

    const dots = qa(h, 'button span[aria-hidden]');
    expect(dots).toHaveLength(2);

    expect(inline(dots[0]!).backgroundColor).toBe('var(--stage-local-solid)');
    expectWired(dots[0]!, key);

    expectBuiltinToken(dots[1]!, 'solid', 2);
    expect(keyAnchor(dots[1]!)).toBeNull();
  });
});

describe('② 阶段卡 · 移动 MobileStageList 序号块与进度条', () => {
  function renderMobile(stages: Stage[]): HTMLDivElement {
    return mount(
      <MobileStageList
        stages={stages}
        tasks={[]}
        members={[]}
        todayIso="2026-06-10"
        onOpen={() => undefined}
      />,
    );
  }

  it('自定义色：序号块 + 进度条**两处**都取 var(--stage-local-solid)，且都有锚点', () => {
    const key = registerStageColor(CUSTOM);
    const h = renderMobile([makeStage('stg_m', 1, { customColor: CUSTOM })]);

    // 序号块（①-⑨ 的方块）：唯一带内联 style 的 span（members=[] ⇒ 无头像 span）
    const badge = must(h, 'button span[style]', '移动端序号块 span');
    expect(inline(badge).backgroundColor).toBe('var(--stage-local-solid)');

    // 进度条内层：唯一带内联 style 的 div
    const progress = must(h, 'button div[style]', '移动端进度条内层 div');
    expect(inline(progress).backgroundColor).toBe('var(--stage-local-solid)');

    // 两处都必须落在同一个锚点作用域内（挂在 button 根上即可覆盖两者）
    expectWired(badge, key);
    expectWired(progress, key);
    expect(keyAnchor(badge)).toBe(keyAnchor(progress));
  });

  it('内置色：两处都走内置通路，且整棵子树上不得出现 data-stage-key', () => {
    const h = renderMobile([makeStage('stg_m', 1, { customColor: null })]);

    expectBuiltinToken(must(h, 'button span[style]', '移动端序号块 span'), 'solid', 1);
    expectBuiltinToken(must(h, 'button div[style]', '移动端进度条内层 div'), 'solid', 1);
    expectNotWired(h);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 组 3 · ③ 月历（calendarColors 三级穿线 → calendarMath → MonthDayCell）
 *   这条链有三个环节，任何一环没穿到 customColor，自定义色都会在月历上退回内置色：
 *     calendarMath.computeCalendarEntry → e.color
 *     calendarColors.stageColorOf / stageSolidOf / bandOutlineOf → 必须接受第 3 形参
 *     MonthDayCell 折叠态色带 + 展开态清单色点 → 必须挂 data-stage-key
 * ══════════════════════════════════════════════════════════════════════════════ */

const MONTH_META = buildMonthMeta('2026-06', '2026-06-10');

const CAL_DAY: GridDay = {
  date: '2026-06-10',
  day: 10,
  inMonth: true,
  isToday: false,
  isSelected: false,
};

/** 一个「进行中」的月历行（activeStage 落在 todayIso 内 ⇒ pickActiveStage 命中它） */
function makeEntry(pid: string, name: string, stage: Stage): CalendarEntry {
  return computeCalendarEntry(
    makeProject({ id: pid, name }),
    [{ ...stage, projectId: pid }],
    MONTH_META,
  );
}

function renderDayCell(items: CalendarEntry[], isMobile = false): HTMLDivElement {
  return mount(
    <MonthDayCell
      day={CAL_DAY}
      items={items}
      isRest={false}
      isMobile={isMobile}
      onSelect={() => undefined}
      onOpen={() => undefined}
    />,
  );
}

describe('③ 月历取色链：calendarColors 三个出口必须接受 customColor 形参', () => {
  it('通路 A：两个形参的旧写法零变化', () => {
    expect(stageColorOf(3, 3)).toBe('var(--stage-band-s3)');
    expect(stageSolidOf(3, 3)).toBe('var(--stage-s3)');
    expect(bandOutlineOf(3, 3).stroke).toBe('var(--stage-ink-s3)');
    expect(bandOutlineOf(3, 3).boxShadow).toBe('inset 0 0 0 1px rgb(var(--stage-ink-s3-rgb) / 0.3)');
  });

  it('通路 B：第三个形参给自定义色 ⇒ 三个出口全部改走本地令牌', () => {
    expect(stageColorOf(3, 3, CUSTOM)).toBe('var(--stage-local-band)');
    expect(stageSolidOf(3, 3, CUSTOM)).toBe('var(--stage-local-solid)');
    expect(bandOutlineOf(3, 3, CUSTOM).stroke).toBe('var(--stage-local-ink)');
    expect(bandOutlineOf(3, 3, CUSTOM).boxShadow).toBe(
      'inset 0 0 0 1px rgb(var(--stage-local-ink-rgb) / 0.3)',
    );
  });
});

describe('③ 月历取色链：calendarMath.computeCalendarEntry 必须把自定义色带出来', () => {
  it('activeStage.customColor 有值 ⇒ entry.color 走通路 B（否则月历色带永远退回内置色）', () => {
    const entry = makeEntry('proj_c1', '自定义项目', makeStage('stg_c1', 1, { customColor: CUSTOM }));
    expect(entry.activeStage?.customColor).toBe(CUSTOM);
    expect(entry.color).toBe('var(--stage-local-band)');
  });

  it('activeStage.customColor 为空 ⇒ entry.color 与改造前逐字节相同（通路 A 零回归）', () => {
    const entry = makeEntry('proj_c2', '内置色项目', makeStage('stg_c2', 2, { customColor: null }));
    expect(entry.color).toBe('var(--stage-band-s2)');
  });
});

describe('③ 月历 MonthDayCell：折叠态色带 + 展开态清单色点', () => {
  it('折叠态（不拥挤）：色带背景走通路 B，且描边用 --stage-local-ink-rgb 三元组', () => {
    const key = registerStageColor(CUSTOM);
    const entry = makeEntry('proj_d1', '自定义项目', makeStage('stg_d1', 1, { customColor: CUSTOM }));
    const h = renderDayCell([entry]);

    // 折叠态唯一的色带按钮（带 title）
    const band = must(h, 'button[title]', '折叠态色带按钮');
    expect(inline(band).backgroundColor).toBe('var(--stage-local-band)');
    // ⚠️ -rgb 三元组：漏了它，自定义色的月历色带描边会静默消失（BUG-04 的新通路复现）
    expect(inline(band).boxShadow).toBe(
      'inset 0 0 0 1px rgb(var(--stage-local-ink-rgb) / 0.3)',
    );
    expectWired(band, key);
  });

  it('折叠态（不拥挤）内置色：走通路 A，不得挂属性', () => {
    const entry = makeEntry('proj_d2', '内置色项目', makeStage('stg_d2', 1, { customColor: null }));
    const h = renderDayCell([entry]);

    const band = must(h, 'button[title]', '折叠态色带按钮');
    expectBuiltinToken(band, 'band', 1);
    expect(inline(band).boxShadow).toBe('inset 0 0 0 1px rgb(var(--stage-ink-s1-rgb) / 0.3)');
    expectNotWired(h);
  });

  it('展开态清单色点（桌面阈值 3）：4 项 ⇒ 出现「+N 个项目」，展开后色点也走通路 B', async () => {
    const key = registerStageColor(CUSTOM);
    const items: CalendarEntry[] = [
      makeEntry('proj_e1', '项目一', makeStage('stg_e1', 1, { customColor: CUSTOM })),
      makeEntry('proj_e2', '项目二', makeStage('stg_e2', 2, { customColor: null })),
      makeEntry('proj_e3', '项目三', makeStage('stg_e3', 3, { customColor: null })),
      makeEntry('proj_e4', '项目四', makeStage('stg_e4', 4, { customColor: null })),
    ];
    const h = renderDayCell(items);

    // 前置：4 > 3 ⇒ 必须是折叠态，否则下面的展开断言无从谈起（且会空过）
    const expandBtn = qa(h, 'button').find((b) => /^\+\d+/.test((b.textContent ?? '').trim())) as
      | HTMLElement
      | undefined;
    expect(expandBtn, '4 项（> 桌面阈值 3）应出现「+N 个项目」折叠入口').toBeDefined();

    await act(async () => {
      expandBtn!.click();
    });

    const dots = qa(h, 'span[aria-hidden][style]');
    expect(dots, '展开态应渲染 4 条清单行（各带一枚色点）').toHaveLength(4);

    expect(inline(dots[0]!).backgroundColor).toBe('var(--stage-local-solid)');
    expectWired(dots[0]!, key);

    // 同批内置色对照（同一次渲染内）：证明不是「整片都变本地令牌」
    expectBuiltinToken(dots[1]!, 'solid', 2);
    expect(keyAnchor(dots[1]!)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 组 4 · ④ 打印页（日程表 + 月历）
 *   两页都是独立路由（`main.tsx:46-47`，非模态），打印稿由 `.print-root` 锁亮色。
 *   数据层 `ScheduleSection` / `GridDay` 原本**没有** customColor 字段 ——
 *   故这一组先钉数据层，再钉渲染层。
 *
 * ⚠️ 月历打印页的夹具必须**跨真实当月**（下面 `PRINT_*` 那一组常量）：
 *   本页的 `todayIso` 取自 `new Date()`（页内写死，不接受注入），而
 *   `computeProjectStatus()` 在 `plannedEndAt < today` 时判 `overdue`、`pickActiveStage()`
 *   在今日落在阶段区间外时返回 `null`：
 *     status≠in_progress ⇒ `entry.color` 变 OVERDUE_COLOR（不走阶段色通路）；
 *     activeStage=null   ⇒ 概览色块 / 图例的实心块拿不到 customColor（只剩日格色带可断言），
 *                          本组「锚点 ≥ 2」的断言就会**永远立不住**。
 *   所以月历页的用例一律用「本月 1 日 → 本月末日」的项目与阶段（今日必然落在区间内）。
 * ══════════════════════════════════════════════════════════════════════════════ */

/** 真实当月（本地时区）—— 只给月历打印页用，理由见上 */
const PRINT_NOW = new Date();
const PRINT_MONTH = `${PRINT_NOW.getFullYear()}-${String(PRINT_NOW.getMonth() + 1).padStart(2, '0')}`;
const PRINT_MONTH_START = `${PRINT_MONTH}-01`;
const PRINT_MONTH_END = ((): string => {
  // 下月 0 日 = 本月最后一天
  const last = new Date(PRINT_NOW.getFullYear(), PRINT_NOW.getMonth() + 1, 0);
  return `${PRINT_MONTH}-${String(last.getDate()).padStart(2, '0')}`;
})();

/** 跨本月的项目（色带与阶段都覆盖整个本月 ⇒ 今日必在区间内 ⇒ in_progress + 有 activeStage） */
function printProject(): Project {
  return makeProject({
    plannedStartAt: `${PRINT_MONTH_START}T00:00:00Z`,
    plannedEndAt: `${PRINT_MONTH_END}T23:59:59Z`,
  });
}

function printStage(customColor: string | null): Stage {
  return makeStage('stg_cp', 1, {
    customColor,
    colorIndex: 1,
    startAt: `${PRINT_MONTH_START}T00:00:00Z`,
    endAt: `${PRINT_MONTH_END}T23:59:59Z`,
  });
}

describe('④ 打印 · 数据层 ScheduleSection 必须携带 customColor', () => {
  it('buildScheduleSections 透传 stage.customColor；内置色必须是 null（不是 undefined）', () => {
    const custom = buildScheduleSections({
      project: makeProject(),
      stages: [makeStage('stg_s1', 1, { customColor: CUSTOM })],
      tasks: [],
      members: [ADMIN],
    });
    expect(custom).toHaveLength(1);
    expect(custom[0]!.customColor).toBe(CUSTOM);

    const builtin = buildScheduleSections({
      project: makeProject(),
      stages: [makeStage('stg_s1', 1, { customColor: null })],
      tasks: [],
      members: [ADMIN],
    });
    expect(builtin[0]!.customColor).toBeNull();
  });
});

describe('④ 打印 · 日程表 SchedulePrintPage', () => {
  it('自定义色：时间轴色带 + 状态色点都走通路 B，描边带 -rgb 三元组', () => {
    const key = registerStageColor(CUSTOM);
    seedStores([makeStage('stg_p1', 1, { customColor: CUSTOM })]);
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);

    // 量具自检：打印子树必须真的上屏，否则下面的查询会「零命中即通过」
    expect(must(h, '.print-root', '打印子树 .print-root')).not.toBeNull();

    const band = must(h, '.schedule-bar-segment', '时间轴色带');
    expect(inline(band).backgroundColor).toBe('var(--stage-local-band)');
    expect(inline(band).boxShadow).toBe(
      'inset 0 0 0 1px rgb(var(--stage-local-ink-rgb) / 0.3)',
    );
    expectWired(band, key);

    const dot = must(h, '.schedule-status-dot', '阶段状态色点');
    expect(inline(dot).backgroundColor).toBe('var(--stage-local-solid)');
    expectWired(dot, key);
  });

  it('内置色：两处都走通路 A，且不得出现 data-stage-key', () => {
    seedStores([makeStage('stg_p1', 1, { customColor: null })]);
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);

    expect(must(h, '.print-root', '打印子树 .print-root')).not.toBeNull();

    const band = must(h, '.schedule-bar-segment', '时间轴色带');
    expectBuiltinToken(band, 'band', 1);
    expect(inline(band).boxShadow).toBe('inset 0 0 0 1px rgb(var(--stage-ink-s1-rgb) / 0.3)');

    expectBuiltinToken(must(h, '.schedule-status-dot', '阶段状态色点'), 'solid', 1);
    expectNotWired(h);
  });
});

describe('④ 打印 · 月历 CalendarPrintPage', () => {
  it('自定义色：月历格内色带走通路 B，概览/图例实心块也走通路 B', () => {
    const key = registerStageColor(CUSTOM);
    seedStores([printStage(CUSTOM)], printProject());
    const h = renderAt(`/project/${PROJECT_ID}/calendar-print`);

    const band = must(h, '.print-root .schedule-bar-segment', '月历格内色带');
    expect(inline(band).backgroundColor).toBe('var(--stage-local-band)');
    expectWired(band, key);

    // 概览/图例里的实心块也必须是通路 B（本页此前**完全**没有 outline 调用，两处都要覆盖）
    const holders = qa(h, `.print-root [${STAGE_COLOR_KEY_ATTR}]`);
    expect(holders.length, '色带 + 至少一处实心块 ⇒ 锚点数应 ≥ 2').toBeGreaterThanOrEqual(2);
    const values = new Set(
      holders.map((el) => inline(el).backgroundColor).filter((v) => v !== ''),
    );
    expect(values.size, '锚点上应至少出现一种本地令牌背景').toBeGreaterThanOrEqual(1);
    for (const v of values) {
      expect(
        ['var(--stage-local-band)', 'var(--stage-local-solid)'].includes(v),
        `锚点上的内联背景只允许本地令牌，实测 ${v}`,
      ).toBe(true);
    }
    // 概览色块（.print-root 直系那一枚 h-4 w-4）必须吃的是「实心块」令牌，不是色带令牌
    const swatches = qa(h, '.print-root span[style], .print-root div[style]').filter(
      (el) => inline(el).backgroundColor === 'var(--stage-local-solid)',
    );
    expect(swatches.length, '概览 / 图例实心块必须走 solid 令牌').toBeGreaterThanOrEqual(1);
  });

  it('内置色：整棵打印子树不得出现 data-stage-key', () => {
    seedStores([printStage(null)], printProject());
    const h = renderAt(`/project/${PROJECT_ID}/calendar-print`);

    expect(must(h, '.print-root .schedule-bar-segment', '月历格内色带')).not.toBeNull();
    expectNotWired(h);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 组 ⑥ · A13「打印前显示预计页数」（PRD v0.8 增量稿:179 / 设计文档验收标准 3）
 *
 * 逐字要求：`| A13 | P1 | 打印前显示预计页数 | 20 段时显示「预计 M 页」且 M 与实际
 *           pages.length 一致 |`
 *
 * ── 为什么这组断言不是同义反复 ──
 * 「M 与 pages.length 一致」若直接写 `expect(pages.length).toBe(pages.length)` 是废话。
 * 故这里的两侧取自**两个互相独立**的来源：
 *   · 文本侧 M  ← 从 DOM 里那段文案用正则捕获（用户真正看到的数字）；
 *   · 分页侧 N  ← 数渲染出的 `.a4-page` 容器个数（DOM 里真实存在的页数）。
 * 而期望值 4 是**按 src/lib/schedule-print.ts 的真实常量独立复算**出来的硬编码常量：
 *   可用高 = A4 1123 − padding 88 − 页眉带 58 − 页脚 48 = **929**
 *   单段高（1 任务）= sectionHeader 52 + row 46 + sectionGap 24 = **122**
 *   首页另扣 firstPageHeader 210 ⇒ 首屏限 929 − 210 = 719 → 5 段
 *   其后每页限 929                                 → 7 段
 *   20 = 5 + 7 + 7 + 1 ⇒ **4 页**（分布 5/7/7/1）
 * （复算方式：用 `node -e` 照抄上述常量重演 `paginateSections` 的循环，见交付报告。
 *   注：`emptySection` 是 44，本用例每段都有 1 任务，走 `tasks.length * EST.row` 一支，用不到它。）
 * ══════════════════════════════════════════════════════════════════════════════ */

/** A13 场景的段数（PRD 指定 20 段） */
const A13_STAGE_COUNT = 20;

/**
 * 单条任务（只需满足 `buildScheduleSections` 的 `stageId` 归组与 `taskIsDone`）。
 * `over` 供 MyTasksPage 那组用：它的列表只显示「参与人含当前成员」的任务，
 * 故必须能覆写 `assigneeIds`。
 */
function makeTask(id: string, stageId: string, over: Partial<Task> = {}): Task {
  return {
    id,
    taskNo: null,
    projectId: PROJECT_ID,
    stageId,
    title: `任务${id}`,
    done: false,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'human',
    externalId: null,
    agentId: null,
    status: TaskStatus.Draft,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    runId: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  };
}

/** 20 段 × 每段恰好 1 任务（⇒ 每个 section 高 122，期望页数 4） */
function a13Fixture(): { stages: Stage[]; tasks: Task[] } {
  const stages: Stage[] = [];
  const tasks: Task[] = [];
  for (let n = 1; n <= A13_STAGE_COUNT; n++) {
    const sid = `stg_a13_${String(n).padStart(2, '0')}`;
    // colorIndex 循环 1..9（orderIndex 会到 20，直接当 colorIndex 会越界）
    stages.push(makeStage(sid, n, { colorIndex: ((n - 1) % 9) + 1 }));
    tasks.push(makeTask(`tsk_a13_${String(n).padStart(2, '0')}`, sid));
  }
  return { stages, tasks };
}

describe('⑥ A13 · 打印前显示预计页数（文案 + 与实际分页一致）', () => {
  it('20 段 × 每段 1 任务：文案必须是「预计 M 页」，且 M === DOM 里 .a4-page 容器数', () => {
    const { stages, tasks } = a13Fixture();
    seedStores(stages, makeProject(), tasks);
    const h = renderAt(`/project/${PROJECT_ID}/schedule-print`);

    // 选择器锚在「… 页 · A4」这一处（页脚另有「第 N / M 页」，但它属 .print-root 内、且不含「· A4」）
    const labelEl = qa(h, '.no-print span').find((el) => /页\s*·\s*A4/.test(el.textContent ?? ''));
    expect(labelEl, '操作栏里必须存在「… 页 · A4」那段文案').toBeDefined();
    const label = labelEl?.textContent ?? '';

    // ① 文案逐字含「预计」—— 旧文案「共 N 页」在这一行立刻红（这就是判别力来源）
    const m = /预计\s*(\d+)\s*页/.exec(label);
    expect(m, `文案必须形如「预计 N 页」，实测「${label}」`).not.toBeNull();
    const shown = Number(m![1]);

    // ② DOM 里真实渲染出的页数（与文本侧相互独立）
    const printedPages = qa(h, '.a4-page').length;

    // ③ 20 段 ⇒ 期望 4 页（常量独立复算，见本组头部注释）
    expect(printedPages, '20 段 × 每段 1 任务 ⇒ 应为 4 页').toBe(4);

    // ④ M 必须等于真实页数（PRD 的「与 pages.length 一致」）
    expect(shown, `文案数字(${shown}) 必须等于实际页数(${printedPages})`).toBe(printedPages);

    // ⑤ 反向断言：数字不得等于段数 —— 防有人退回「按段数当页数」
    const renderedRows = qa(h, 'table.schedule-table tbody tr').length;
    expect(renderedRows, '阶段清单应渲染全部 20 段').toBe(A13_STAGE_COUNT);
    expect(shown, '页数不得等于段数（段数 20 ≠ 页数 4）').not.toBe(A13_STAGE_COUNT);
    expect(shown, '页数必须真的大于 1（否则 ⑤ 会退化成平凡断言）').toBeGreaterThan(1);
  });

  it('TS-08 · 打印页是独立路由、不是模态：该路径渲染 .print-root 且无 dialog/aria-modal，离开即消失', () => {
    seedStores([makeStage('stg_p1', 1)], makeProject(), [makeTask('tsk_p1', 'stg_p1')]);

    const at = renderAt(`/project/${PROJECT_ID}/schedule-print`);
    expect(must(at, '.print-root', '打印页根节点')).not.toBeNull();
    expect(qa(at, '[role="dialog"]').length, '打印页不得是模态对话框').toBe(0);
    expect(qa(at, '[aria-modal="true"]').length, '打印页不得带 aria-modal').toBe(0);

    // 路由化 ⇒ 离开该路径后整棵打印子树随之消失
    // （若将来有人改成常驻模态/浮层，`.print-root` 会残留 ⇒ 本断言红）
    const home = renderAt('/');
    expect(must(home, '[data-home-marker]', '首页占位'), '应已离开打印路由').not.toBeNull();
    expect(q(home, '.print-root'), '离开路由后打印页子树不得残留（模态实现会残留）').toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 组 7 · BUG-06：五处「绕过自定义色通路」的消费点补接
 *
 * T05 只接了 A11 那四处，而 `STAGE_BAR_COLORS` 另有 5 个消费点直查内置表：
 *   ① ProjectCard 进度轨道段  ② ProjectCard 强调色（→ 外观弹窗）
 *   ③ Sidebar 展开态彩条      ④ Sidebar 折叠态彩条   ⑤ MyTasksPage 行首色条
 * ⇒ 用户设了自定义阶段色后，这几处仍显示内置色（改了色一半界面不跟）。
 *
 * 每处都断言**两个方向**，缺一即假断言：
 *   · 自定义：色值 === var(--stage-local-solid) **且** 锚点存在
 *             （只测其一 ⇒ 「色块其实透明了」也照样绿）
 *   · 内置　：色值与改造前**逐字节同值** **且** 不挂锚点（本笔最重要的回归锁）
 * ══════════════════════════════════════════════════════════════════════════════ */

/** 五处共用：自定义色一侧的**两个半件**都必须在 */
function expectLocalSolid(el: Element, expectedKey: string): void {
  expect(inline(el).backgroundColor, '自定义色必须取本地 solid 令牌').toBe(
    'var(--stage-local-solid)',
  );
  expectWired(el, expectedKey);
}

/** 五处共用：内置色一侧必须**逐字节同值**且不挂锚点 */
function expectBuiltinSolid(el: Element, slot: number): void {
  expect(inline(el).backgroundColor, `内置色必须与改造前逐字节同值（s${slot}）`).toBe(
    `var(--stage-s${slot})`,
  );
  expect(keyAnchor(el), '内置色不得挂 data-stage-key').toBeNull();
}

describe('⑦ BUG-06 · ① ProjectCard 阶段进度轨道段', () => {
  function renderCard(stages: Stage[]): HTMLDivElement {
    return mount(
      <MemoryRouter>
        <ProjectCard
          project={makeProject()}
          stages={stages}
          tasks={[]}
          members={[ADMIN]}
          todayIso="2026-06-10"
          onOpen={() => undefined}
        />
      </MemoryRouter>,
    );
  }

  it('自定义色：轨道段取 var(--stage-local-solid) 且挂锚点', () => {
    const key = registerStageColor(CUSTOM);
    seedStores([]);
    const h = renderCard([makeStage('stg_seg', 3, { customColor: CUSTOM })]);

    const segs = qa(h, '[data-stage-track-seg]');
    expect(segs, '进度轨道应渲染 1 段').toHaveLength(1);
    expectLocalSolid(segs[0]!, key);
  });

  it('内置色：轨道段与改造前逐字节同值，且不挂锚点', () => {
    seedStores([]);
    const h = renderCard([makeStage('stg_seg', 3, { customColor: null })]);

    const segs = qa(h, '[data-stage-track-seg]');
    expect(segs).toHaveLength(1);
    expectBuiltinSolid(segs[0]!, 3);
  });

  it('★ 混排：自定义段走通路 B、内置段走通路 A（互不影响）', () => {
    const key = registerStageColor(CUSTOM);
    seedStores([]);
    const h = renderCard([
      makeStage('stg_seg_a', 1, { customColor: CUSTOM }),
      makeStage('stg_seg_b', 2, { customColor: null }),
    ]);

    const segs = qa(h, '[data-stage-track-seg]');
    expect(segs, '进度轨道应渲染 2 段').toHaveLength(2);
    expectLocalSolid(segs[0]!, key);
    expectBuiltinSolid(segs[1]!, 2);
  });
});

describe('⑦ BUG-06 · ② ProjectCard 强调色 → ProjectAppearanceDialog', () => {
  /**
   * 直接渲染弹窗，色值与属性按 ProjectCard 的同一口径算好传入。
   * 单独测弹窗是为了把「coverColor 命中时阶段色**根本不参与**」这一最难写对的分支钉死；
   * ProjectCard 是否真把两者一起传下去，由下面那条「接线」用例经 ⋯ 菜单实证。
   */
  function renderAccentPreview(coverColor: string | null, customColor: string | null): Element {
    const stage = makeStage('stg_accent', 1, { customColor });
    mount(
      <ProjectAppearanceDialog
        open
        project={makeProject({ coverColor })}
        stageAccentColor={stageSolidColor(stage.orderIndex, null, stage.customColor)}
        stageAccentAttrs={customStageColor(stage.customColor).attrs}
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    );
    // Modal 走 createPortal 挂到 document.body ⇒ 不能只在宿主容器里找
    return must(document.body, '[data-project-accent-preview]', '方块预览色块');
  }

  it('内置色：强调色与改造前逐字节同值，且不挂锚点', () => {
    expectBuiltinSolid(renderAccentPreview(null, null), 1);
  });

  it('coverColor 未命中 ⇒ 预览走阶段色（挂锚点）；命中 ⇒ 走封面色（不挂锚点）', () => {
    const key = registerStageColor(CUSTOM);

    // ① 未命中：预览取的就是阶段色 ⇒ 两个半件都必须在
    expectLocalSolid(renderAccentPreview(null, CUSTOM), key);

    // ② 命中白名单 token：预览取封面色，阶段色根本不参与 ⇒ 属性一个都不许挂
    const covered = renderAccentPreview('pine', CUSTOM);
    expect(inline(covered).backgroundColor, '命中 coverColor 时预览必须走封面色').toBe(
      'rgb(var(--pine-rgb))',
    );
    expect(
      keyAnchor(covered),
      'coverColor 命中时阶段色不参与 ⇒ 不得挂 data-stage-key（挂了既语义错又污染判定）',
    ).toBeNull();
  });

  it('接线：ProjectCard 真的把自定义色与属性一起传进弹窗（经 ⋯ 菜单打开）', () => {
    const key = registerStageColor(CUSTOM);
    seedStores([makeStage('stg_accent', 2, { customColor: CUSTOM })]);
    const h = mount(
      <MemoryRouter>
        <ProjectCard
          project={makeProject()}
          stages={[makeStage('stg_accent', 2, { customColor: CUSTOM })]}
          tasks={[]}
          members={[ADMIN]}
          todayIso="2026-06-10"
          onOpen={() => undefined}
        />
      </MemoryRouter>,
    );

    const menuBtn = must(h, 'button[aria-label="项目更多操作"]', '⋯ 菜单按钮') as HTMLElement;
    act(() => {
      menuBtn.click();
    });
    const trigger = must(
      document.body,
      '[data-project-appearance-trigger]',
      '「侧栏方块外观」入口',
    ) as HTMLElement;
    act(() => {
      trigger.click();
    });

    // 「跟随阶段色」那枚色块恒取阶段色 ⇒ 自定义时必须带锚点
    const swatch = must(document.body, '[data-cover-swatch="auto"] span', '「跟随阶段色」色块');
    expectLocalSolid(swatch, key);
  });
});

describe('⑦ BUG-06 · ③④ Sidebar 彩条（展开态 + 折叠态各一处）', () => {
  /**
   * 展开态的成立条件是 `collapsed = xl ? !sidebarExpanded : true` ⇒
   * 必须 `matchMedia` 命中 xl **且** `sidebarExpanded = true`，
   * 两者缺一都会渲染成折叠态 —— 那样就只测到一处、另一处静默漏掉。
   */
  function renderSidebar(xl: boolean): HTMLDivElement {
    installEnvStubs(xl);
    act(() => {
      useLayoutStore.setState({ sidebarExpanded: true });
    });
    return mount(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );
  }

  it('自定义色：展开态与折叠态**两处**都走通路 B', () => {
    const key = registerStageColor(CUSTOM);
    seedStores([makeStage('stg_side', 2, { customColor: CUSTOM })]);

    const expanded = renderSidebar(true);
    expectLocalSolid(must(expanded, '[data-project-accent-bar="expanded"]', '展开态彩条'), key);

    const collapsed = renderSidebar(false);
    expectLocalSolid(must(collapsed, '[data-project-accent-bar="collapsed"]', '折叠态彩条'), key);
  });

  it('内置色：两处都与改造前逐字节同值，且不挂锚点', () => {
    seedStores([makeStage('stg_side', 3, { customColor: null })]);

    const expanded = renderSidebar(true);
    expectBuiltinSolid(must(expanded, '[data-project-accent-bar="expanded"]', '展开态彩条'), 3);

    const collapsed = renderSidebar(false);
    expectBuiltinSolid(must(collapsed, '[data-project-accent-bar="collapsed"]', '折叠态彩条'), 3);
  });

  it('coverColor 命中 ⇒ 彩条走封面色且不挂锚点（阶段色不参与）', () => {
    registerStageColor(CUSTOM);
    seedStores(
      [makeStage('stg_side', 2, { customColor: CUSTOM })],
      makeProject({ coverColor: 'pine' }),
    );

    const bar = must(renderSidebar(true), '[data-project-accent-bar="expanded"]', '展开态彩条');
    expect(inline(bar).backgroundColor, '命中 coverColor 时彩条必须走封面色').toBe(
      'rgb(var(--pine-rgb))',
    );
    expect(keyAnchor(bar), '阶段色不参与 ⇒ 不得挂 data-stage-key').toBeNull();
  });
});

describe('⑦ BUG-06 · ⑤ MyTasksPage 任务行首阶段色条', () => {
  /** 列表只显示「参与人含当前成员」的任务 ⇒ 夹具必须给 `assigneeIds: [ADMIN_ID]` */
  function seedMyTasks(customColor: string | null): void {
    seedStores(
      [makeStage('stg_mt', 4, { customColor })],
      makeProject(),
      [makeTask('tsk_mt', 'stg_mt', { assigneeIds: [ADMIN_ID] })],
    );
  }

  it('自定义色：行首色条取本地 solid 令牌且挂锚点', () => {
    const key = registerStageColor(CUSTOM);
    seedMyTasks(CUSTOM);

    const h = mount(
      <MemoryRouter>
        <MyTasksPage />
      </MemoryRouter>,
    );
    expectLocalSolid(must(h, '[data-task-stage-bar]', '任务行首阶段色条'), key);
  });

  it('内置色：行首色条与改造前逐字节同值，且不挂锚点', () => {
    seedMyTasks(null);

    const h = mount(
      <MemoryRouter>
        <MyTasksPage />
      </MemoryRouter>,
    );
    expectBuiltinSolid(must(h, '[data-task-stage-bar]', '任务行首阶段色条'), 4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * 组 5 · 通路 B 的「另一半」只能真浏览器证明（**独立 describe，未获口令不得运行**）
 *
 * jsdom 见得到「两个半件都在」，见不到「`var()` 真的解析成不透明色」。这一组把它补齐，
 * 并顺手锁住「类 → 内联 var() 换轨在通路 A 上零视觉变化」（tailwind 的 `bg-stage-sN`
 * 走 `--stage-sN-rgb`，出口走 `--stage-sN`，两个变量名 —— 必须证明解析结果相等）。
 *
 * 守卫与 `tests/isolation-browser.spec.ts` 同款（R12 的假绿教训）：
 *   产物存在 ∧ Chromium 可用 ∧ **src 不比 dist 新**，三者缺一即整段 skip。
 * ⚠️ 运行前须确认 t04a 的 T04 闸门已结束：`vite.config.ts` 是 `singleThread` 串行，
 *    两个 vitest 进程争资源会表现成 `Test timed out in 5000ms`（无法归因的假红）。
 * ══════════════════════════════════════════════════════════════════════════════ */

delete process.env.ELECTRON_RUN_AS_NODE;

const DIST_DIR = resolve(__dirname, '..', 'build-dist');
const DIST_INDEX = resolve(DIST_DIR, 'index.html');

/** 探测已安装的 chromium（与 isolation-browser.spec.ts 同口径） */
function resolveChromium(): string | null {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  const relCandidates = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-linux64', 'chrome'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(root).filter((n) => n.startsWith('chromium-'));
    } catch {
      continue;
    }
    for (const dir of entries) {
      for (const rel of relCandidates) {
        const exe = join(root, dir, ...rel);
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** 产物是否落后于源码（R12 教训：只判「产物存在」会让本段在旧产物上变绿） */
function staleInputs(): string[] {
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = statSync(DIST_INDEX).mtimeMs;
  const repo = resolve(__dirname, '..');
  const candidates = [
    ...collectFiles(join(repo, 'src')),
    join(repo, 'index.html'),
    join(repo, 'vite.config.ts'),
    join(repo, 'tailwind.config.ts'),
    join(repo, 'postcss.config.js'),
  ].filter((f) => existsSync(f));
  return candidates
    .filter((f) => statSync(f).mtimeMs > distMs)
    .map((f) => f.slice(repo.length + 1))
    .slice(0, 3);
}

const CHROMIUM_PATH = resolveChromium();
const STALE = existsSync(DIST_INDEX) ? staleInputs() : [];
const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null && STALE.length === 0;

/** 产物须经 HTTP 提供：`base:'/'` 的绝对资源路径在 file:// 下会 404（应用不挂载） */
function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
  };
  const server = createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    let filePath = join(rootDir, rawPath);
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(rootDir, 'index.html');
    }
    try {
      const body = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((r) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      r({
        url: `http://127.0.0.1:${port}/index.html`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

interface Readback {
  customBand: string;
  customBandVar: string;
  orphanBand: string;
  printBandUnderDark: string;
  builtinInline: Record<string, string>;
  builtinClass: Record<string, string>;
}

describe.skipIf(!CAN_RUN)(
  'T05-BROWSER · 通路 B 在真实 DOM 上「var() 真的解析」（未获口令不得运行）',
  () => {
    let browser: Browser;
    let server: { url: string; close(): Promise<void> };
    let distUrl = '';
    let key = '';
    let css = '';

    beforeAll(async () => {
      server = await startStaticServer(DIST_DIR);
      distUrl = server.url;
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
      __resetRegistryForTest();
      key = registerStageColor(CUSTOM);
      css = buildStageColorCss();
    });

    afterAll(async () => {
      await browser?.close();
      await server?.close();
      __resetRegistryForTest();
    });

    async function openPage(theme: 'light' | 'dark'): Promise<{ page: Page; close(): Promise<void> }> {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(distUrl);
      await page.evaluate((t) => {
        if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
      }, theme);
      await page.waitForTimeout(150);
      return { page, close: () => ctx.close() };
    }

    async function readback(page: Page): Promise<Readback> {
      return page.evaluate(
        ({ k, styleId, sheet, attr, localBand, localInkRgb }) => {
          document.getElementById(styleId)?.remove();
          const style = document.createElement('style');
          style.id = styleId;
          style.setAttribute('data-owner', 'custom-color-registry');
          style.textContent = sheet;
          document.head.appendChild(style);

          document.getElementById('__t05_probe')?.remove();
          const host = document.createElement('div');
          host.id = '__t05_probe';
          const builtinInline: Record<string, string> = {};
          const builtinClass: Record<string, string> = {};
          let rows = '';
          for (let n = 1; n <= 9; n += 1) {
            rows += `<div class="bi b${n} bg-stage-s${n}"></div><div class="ii i${n}" style="background-color: var(--stage-s${n})"></div>`;
          }
          host.innerHTML = `
            <div class="custom-band" ${attr}="${k}" style="background-color: var(${localBand})"></div>
            <div class="orphan-band" style="background-color: var(${localBand})"></div>
            <div class="print-root">
              <div class="custom-band-print" ${attr}="${k}" style="background-color: var(${localBand})"></div>
            </div>
            ${rows}`;
          document.body.appendChild(host);

          const pick = (sel: string): string => {
            const el = host.querySelector(sel) as HTMLElement | null;
            return el === null ? 'MISSING' : getComputedStyle(el).backgroundColor;
          };
          const readVar = (sel: string, name: string): string => {
            const el = host.querySelector(sel) as HTMLElement | null;
            return el === null ? 'MISSING' : getComputedStyle(el).getPropertyValue(name).trim();
          };
          for (let n = 1; n <= 9; n += 1) {
            builtinInline[String(n)] = pick(`.i${n}`);
            builtinClass[String(n)] = pick(`.b${n}`);
          }

          return {
            customBand: pick('.custom-band'),
            customBandVar: readVar('.custom-band', localBand),
            orphanBand: pick('.orphan-band'),
            printBandUnderDark: pick('.custom-band-print'),
            builtinInline,
            builtinClass,
          };
        },
        {
          k: key,
          styleId: STAGE_COLOR_STYLE_ID,
          sheet: css,
          attr: STAGE_COLOR_KEY_ATTR,
          localBand: STAGE_LOCAL_VAR.band,
          localInkRgb: STAGE_LOCAL_VAR.inkRgb,
        },
      );
    }

    it('B-01 · 自定义色：挂了属性 ⇒ var() 解析成**不透明**的真实颜色（不是透明的空解析）', async () => {
      const { page, close } = await openPage('light');
      try {
        const r = await readback(page);
        expect(r.customBand, 'computed 应解析出具体色值').toMatch(/^rgba?\(/);
        expect(r.customBand).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
        // 注入表确实把变量写在了这个 key 上（值非空）
        expect(r.customBandVar).not.toBe('');
        expect(r.customBandVar).not.toBe('MISSING');
      } finally {
        await close();
      }
    });

    it('B-02 · 反证：同样的 inline 但不挂 data-stage-key ⇒ 解析为空、色块透明（属性是承重件）', async () => {
      const { page, close } = await openPage('light');
      try {
        const r = await readback(page);
        expect(
          r.orphanBand,
          '不挂属性却仍解析出颜色 ⇒ 说明注入表是全局泄漏的，通路 B 的隔离契约已破',
        ).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      } finally {
        await close();
      }
    });

    it('B-03 · ★ 通路 A 换轨零视觉变化：bg-stage-sN 与 var(--stage-sN) 的 computed 值逐段相等', async () => {
      const { page, close } = await openPage('light');
      try {
        const r = await readback(page);
        const mismatched: string[] = [];
        for (let n = 1; n <= 9; n += 1) {
          const cls = r.builtinClass[String(n)];
          const inl = r.builtinInline[String(n)];
          expect(cls, `bg-stage-s${n} 应解析出具体色值（Tailwind 类必须真的生成了）`).toMatch(
            /^rgba?\(/,
          );
          expect(inl, `var(--stage-s${n}) 应解析出具体色值`).toMatch(/^rgba?\(/);
          if (cls !== inl) mismatched.push(`s${n}: 类=${cls} / 内联=${inl}`);
        }
        expect(
          mismatched,
          `「类 → 内联 var()」换轨改变了内置色解析结果：\n${mismatched.join('\n')}`,
        ).toEqual([]);
      } finally {
        await close();
      }
    });

    it('B-04 · 暗色主题 + .print-root：打印子树锁回亮色（与 B-01 的亮色值一致）', async () => {
      const light = await openPage('light');
      let lightBand = '';
      try {
        lightBand = (await readback(light.page)).customBand;
      } finally {
        await light.close();
      }

      const dark = await openPage('dark');
      try {
        const r = await readback(dark.page);
        // 元素自身在暗色下解析成暗色变体（与亮色不同）……
        expect(r.customBand).not.toBe(lightBand);
        // ……但打印子树里必须锁回亮色值（`.print-root` 恒浅稿）
        expect(r.printBandUnderDark).toBe(lightBand);
      } finally {
        await dark.close();
      }
    });

    it('B-05 · 组件侧入口与注册表产出同一 key（单一实现，两处不得漂移）', () => {
      expect(stageColorAttrs({ customColor: CUSTOM, colorIndex: 1, orderIndex: 0 })).toEqual({
        [STAGE_COLOR_KEY_ATTR]: key,
      });
      expect(stageColorAttrs({ customColor: null, colorIndex: 1, orderIndex: 0 })).toEqual({});
      expect(key).toMatch(KEY_RE);
    });
  },
);
