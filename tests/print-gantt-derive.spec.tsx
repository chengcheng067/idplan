// @vitest-environment jsdom
/**
 * 打印甘特派生层（`src/print/model/print-gantt.ts`）验收 —— **批 1 地基的第二半**。
 *
 * 这一层是四套模板共用的「时间轴 B2」的数据源，它必须与经典纸面的私有派生
 * （`components/print/useSchedulePaperData.ts:92-123`）**数学恒等**，否则同一份
 * 项目在经典纸上与 A 纸上会画出两把尺子（同仓已出过三次「第二真值源」事故）。
 *
 * ── 等价性断言的取数方式（为什么不是「调两次同一个函数」）──
 * 经典那条路**故意不复用**本函数（红线：`tests/print-options.spec.tsx:757-775`
 * 与 `print-preview.spec.tsx:99-115` 钉着 `SchedulePaper.tsx` 的源码文本，
 * 经典甘特的 JSX 原地不动）。故等价性只能**跨 DOM 对账**：
 *   ① 真挂经典打印页（`SchedulePrintPage` + MemoryRouter + store 夹具）；
 *   ② 从 DOM 读**经典算出来的**结果：色条 `style.left/width`、月份刻度
 *      `data-tick-left`；
 *   ③ 用同一份阶段数据跑 `buildPrintGantt`；
 *   ④ 逐值比相等，并且**由经典 DOM 的条宽反解出 viewDays**（`viewDays =
 *      (hi−lo+1)×100/width`）再与 `buildPrintGantt().viewDays` 比 —— 这样
 *      连「窗口天数」也被独立重建了一次，而不是信同一个公式两遍。
 *
 * 夹具沿用 `tests/schedule-print-band-bounds.spec.tsx` 的**越界窗口**脏数据
 * （阶段起止同时越出计划窗口的两侧）：它是最能暴露窗口口径差异的输入。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { SchedulePrintPage } from '../src/pages/SchedulePrintPage';
import { buildPrintGantt, EMPTY_PRINT_GANTT } from '../src/print/model/print-gantt';
import { totalDaysInclusive } from '../src/lib/date';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage } from '../src/core/types/entities';

/* ====================================================================================
 * 夹具：计划窗口 2026-01-01 → 2026-03-01；三条阶段同时**双侧越界**
 * ==================================================================================== */

const PROJECT_ID = 'proj_gantt_derive';
const ADMIN_ID = 'm-gantt-derive';

const ADMIN: Member = {
  id: ADMIN_ID,
  name: '负责人甲',
  role: '项目负责人',
  contact: null,
  avatarColor: '#3D6B5B',
  active: true,
  roleKind: MemberRoleKind.Admin,
  passwordHash: null,
  actorKind: MemberActorKind.Human,
  agentKind: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const PROJECT: Project = {
  id: PROJECT_ID,
  name: '某茶空间',
  address: '',
  clientName: '客户甲',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: '2026-01-01T00:00:00Z',
  plannedEndAt: '2026-03-01T23:59:59Z',
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: ScheduleBasis.Calendar,
  status: ProjectStatus.Active,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeStage(
  id: string,
  orderIndex: number,
  name: string,
  startAt: string,
  endAt: string,
): Stage {
  return {
    id,
    projectId: PROJECT_ID,
    orderIndex,
    templateKey: null,
    colorIndex: orderIndex,
    customColor: null,
    name,
    ratioPercent: 100,
    startAt,
    endAt,
    status: StageStatus.NotStarted,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const STAGE_INSIDE = makeStage('stg_in', 1, '提案', '2026-01-05T00:00:00Z', '2026-01-20T23:59:59Z');
const STAGE_OVER_END = makeStage(
  'stg_over_end',
  2,
  '灯光专项深化',
  '2026-02-20T00:00:00Z',
  '2026-03-20T23:59:59Z',
);
const STAGE_OVER_START = makeStage(
  'stg_over_start',
  3,
  '前置踏勘',
  '2025-12-20T00:00:00Z',
  '2025-12-31T23:59:59Z',
);
const STAGES: Stage[] = [STAGE_INSIDE, STAGE_OVER_END, STAGE_OVER_START];

/** 「计划窗口 ∪ 阶段实际起止」——与实现在数学上独立地重算一遍 */
const EXPECTED_VIEW_START = '2025-12-20';
const EXPECTED_VIEW_END = '2026-03-20';

/** `buildPrintGantt` 的输入（与经典同源：可见阶段的起止 + 项目窗口） */
const GANTT_INPUT = STAGES.map((s) => ({
  id: s.id,
  orderIndex: s.orderIndex,
  name: s.name,
  startAt: s.startAt,
  endAt: s.endAt,
  status: s.status,
  colorIndex: s.colorIndex,
  customColor: s.customColor,
}));

/* ====================================================================================
 * 纯函数组
 * ==================================================================================== */

describe('批 1 地基 · print-gantt 纯函数口径', () => {
  it('视图窗口 = 计划窗口 ∪ 全部阶段起止；两端贴合 0% / 100%', () => {
    const m = buildPrintGantt(PROJECT, GANTT_INPUT);
    expect(m.viewStart).toBe(EXPECTED_VIEW_START);
    expect(m.viewEnd).toBe(EXPECTED_VIEW_END);
    expect(m.viewDays).toBe(totalDaysInclusive(EXPECTED_VIEW_START, EXPECTED_VIEW_END));
    const viewDays = m.viewDays;
    const byName = new Map(m.rows.map((r) => [r.name, r]));
    const earliest = byName.get(STAGE_OVER_START.name)!;
    const latest = byName.get(STAGE_OVER_END.name)!;
    expect(earliest.left, '最早阶段起点贴左缘').toBeCloseTo(0, 6);
    expect(latest.left + latest.width, '最晚阶段终点贴右缘').toBeCloseTo(100, 6);
    // 与经典公式逐项同形（独立重算，不用被测代码）
    const inside = byName.get(STAGE_INSIDE.name)!;
    expect(inside.left).toBeCloseTo(
      ((totalDaysInclusive(EXPECTED_VIEW_START, '2026-01-05') - 1) / viewDays) * 100,
      6,
    );
    expect(inside.width).toBeCloseTo(
      (totalDaysInclusive('2026-01-05', '2026-01-20') / viewDays) * 100,
      6,
    );
  });

  it('最小可见宽 2.5%：1 天阶段在长窗口里不隐形', () => {
    const project = { plannedStartAt: '2026-01-01T00:00:00Z', plannedEndAt: '2026-12-31T23:59:59Z' };
    const oneDay = {
      id: 'x',
      orderIndex: 1,
      name: '一天',
      startAt: '2026-06-15T00:00:00Z',
      endAt: '2026-06-15T23:59:59Z',
      status: StageStatus.NotStarted,
      colorIndex: 1,
      customColor: null,
    };
    const m = buildPrintGantt(project, [oneDay]);
    expect(m.rows[0]!.width, '1 天 / 365 天 ≈ 0.27% ⇒ 被钳到 2.5%').toBeCloseTo(2.5, 6);
  });

  it('月份刻度同坐标系 + 抽稀阈值 12%（相邻标签不得挤在一起）', () => {
    const m = buildPrintGantt(PROJECT, GANTT_INPUT);
    expect(m.ticks.length, '本夹具跨 4 个自然月 ⇒ 有刻度').toBeGreaterThan(0);
    for (const t of m.ticks) {
      expect(t.leftPercent).toBeGreaterThanOrEqual(0);
      expect(t.leftPercent).toBeLessThanOrEqual(100);
    }
    for (let i = 1; i < m.ticks.length; i++) {
      expect(
        m.ticks[i]!.leftPercent - m.ticks[i - 1]!.leftPercent,
        '相邻刻度间距不得小 12%（MIN_LABEL_GAP_PCT 的去重叠口径）',
      ).toBeGreaterThanOrEqual(12);
    }
    // 长窗口（>12 个月）时抽稀**确实会吞掉**中间标签 ⇒ 刻度数 < 月份数
    const long = buildPrintGantt(
      { plannedStartAt: '2026-01-01T00:00:00Z', plannedEndAt: '2028-12-31T23:59:59Z' },
      [],
    );
    expect(long.ticks.length, '36 个月的窗口必须被抽稀').toBeLessThan(12);
  });

  it('空串脏行不污染整轴（viewStart 不被拉成空串 ⇒ 全轴非 NaN）', () => {
    const dirty = [
      ...GANTT_INPUT,
      {
        id: 'dirty',
        orderIndex: 4,
        name: '脏行',
        startAt: '',
        endAt: '',
        status: StageStatus.NotStarted,
        colorIndex: 4,
        customColor: null,
      },
    ];
    const clean = buildPrintGantt(PROJECT, GANTT_INPUT);
    const m = buildPrintGantt(PROJECT, dirty);
    expect(m.viewStart, '脏行不得改变视图窗口').toBe(clean.viewStart);
    expect(m.viewDays).toBe(clean.viewDays);
    const dirtyRow = m.rows.find((r) => r.key === 'dirty')!;
    expect(Number.isFinite(dirtyRow.left) && Number.isFinite(dirtyRow.width)).toBe(true);
    for (const r of m.rows.filter((x) => x.key !== 'dirty')) {
      const c = clean.rows.find((x) => x.key === r.key)!;
      expect(Math.abs(r.left - c.left), `${r.name}：脏行不得改变 left`).toBeLessThan(0.01);
      expect(Math.abs(r.width - c.width), `${r.name}：脏行不得改变 width`).toBeLessThan(0.01);
    }
  });

  it('无项目窗口 / 无阶段：给可渲染的空模型，不把 NaN 流进 inline style', () => {
    const m = buildPrintGantt({ plannedStartAt: '', plannedEndAt: '' }, []);
    expect(m).toEqual(EMPTY_PRINT_GANTT);
    expect(m.viewDays).toBe(0);
    expect(m.ticks).toEqual([]);
    expect(m.rows).toEqual([]);
  });
});

/* ====================================================================================
 * 等价性 · 与经典真机 DOM 对账
 * ==================================================================================== */

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function unmountCurrent(): void {
  const r = root;
  if (r) {
    act(() => {
      r.unmount();
    });
  }
  host?.remove();
  root = null;
  host = null;
}

/** 挂经典打印页（admin 身份 ⇒ 不做成员收窄） */
function renderClassic(): HTMLDivElement {
  unmountCurrent();
  act(() => {
    useProjectsStore.getState().replaceAll({ projects: [PROJECT], stages: STAGES, tasks: [] });
    useMembersStore.getState().setAll([ADMIN]);
    useSettingsStore.setState({ currentMemberId: ADMIN_ID, hydrated: true });
  });
  const h = document.createElement('div');
  document.body.appendChild(h);
  host = h;
  root = createRoot(h);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[`/project/${PROJECT_ID}/schedule-print`]}>
        <Routes>
          <Route path="/" element={<div data-home-marker="" />} />
          <Route path="/project/:id/schedule-print" element={<SchedulePrintPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return h;
}

interface ClassicBand {
  name: string;
  left: number;
  width: number;
}

/**
 * 读**经典算出来的**几何：轨道行 = `div.relative.h-7`（结构选择器，与
 * band-bounds spec 同一量具），其带 `title` 的子元素 = 色条。
 */
function readClassicBands(h: ParentNode): ClassicBand[] {
  const rows = Array.from(h.querySelectorAll('div.relative.h-7'));
  return rows.map((row) => {
    const bar = Array.from(row.children).find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('title'),
    );
    if (!bar) throw new Error('经典轨道行内找不到色条');
    const titleHead = (bar.getAttribute('title') ?? '').split('（')[0] ?? '';
    return {
      name: titleHead.replace(/^\d+\.\s*/, ''),
      left: Number.parseFloat(bar.style.left),
      width: Number.parseFloat(bar.style.width),
    };
  });
}

/** 读经典算出来的月份刻度（`data-print-month-tick` + `data-tick-left`） */
function readClassicTicks(h: ParentNode): Array<{ label: string; leftPercent: number }> {
  return Array.from(h.querySelectorAll('[data-print-month-tick]')).map((el) => ({
    label: (el.textContent ?? '').trim(),
    leftPercent: Number.parseFloat(el.getAttribute('data-tick-left') ?? 'NaN'),
  }));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  unmountCurrent();
  act(() => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  });
});

describe('批 1 地基 · 等价性：新派生层 ≡ 经典私有派生（跨真 DOM 对账）', () => {
  it('★ 逐值：条带 left/width、月份刻度 label/left、viewDays 与经典完全一致', () => {
    const h = renderClassic();
    const classicBands = readClassicBands(h);
    const classicTicks = readClassicTicks(h);
    // 量具自检：匹配不到就**先红**，不退化成「0 条全过」的假绿
    expect(classicBands.length, '经典应画 3 条色条').toBe(STAGES.length);
    expect(classicTicks.length, '经典应画月份刻度').toBeGreaterThan(0);

    const mine = buildPrintGantt(PROJECT, GANTT_INPUT);
    expect(mine.rows.length).toBe(classicBands.length);

    // ① 条带几何逐值相等
    for (const cb of classicBands) {
      const mr = mine.rows.find((r) => r.name === cb.name)!;
      expect(mr, `未预期的经典色条：${cb.name}`).toBeDefined();
      expect(mr.left, `${cb.name}：left 与经典逐值相等`).toBeCloseTo(cb.left, 9);
      expect(mr.width, `${cb.name}：width 与经典逐值相等`).toBeCloseTo(cb.width, 9);
    }
    // ② 月份刻度逐值相等（label 精确；leftPercent 受经典 `toFixed(2)` 的
    //    data 属性精度限制 ⇒ 容差 = 半个最小位 = 0.005，不是「放宽判据」）
    expect(mine.ticks.map((t) => t.label)).toEqual(classicTicks.map((t) => t.label));
    for (let i = 0; i < classicTicks.length; i++) {
      expect(
        Math.abs(mine.ticks[i]!.leftPercent - classicTicks[i]!.leftPercent),
        `刻度 ${classicTicks[i]!.label} 的 leftPercent 与经典一致`,
      ).toBeLessThanOrEqual(0.005);
    }
    // ③ 由经典 DOM 的条宽**反解** viewDays，与纯函数的 viewDays 相等
    const insideStage = STAGES.find((s) => s.name === STAGE_INSIDE.name)!;
    const insideBand = classicBands.find((b) => b.name === STAGE_INSIDE.name)!;
    const spanDays = totalDaysInclusive(
      insideStage.startAt.slice(0, 10),
      insideStage.endAt.slice(0, 10),
    );
    const viewDaysFromClassicDom = (spanDays * 100) / insideBand.width;
    expect(
      Math.abs(mine.viewDays - viewDaysFromClassicDom),
      `经典 DOM 反解的 viewDays=${viewDaysFromClassicDom}，新函数 viewDays=${mine.viewDays}`,
    ).toBeLessThan(1e-9);
  });
});

/* ====================================================================================
 * 批 B 裁决「顺带补一件」：**A 与 D 的视图窗口等价**（跨实现比对）
 * ====================================================================================
 * 裁决原文（批 B 落地后的裁决区）：
 *   「A 与 D 的窗口等价性断言：`deMatrixWindow` 与 `buildPrintGantt` 的视图窗口
 *    （计划窗口 ∪ 阶段起止、空串脏行过滤）**逐值相等**，落成常驻断言。口径同你在
 *    A 批做过的那条（同一夹具、**跨实现比对**，不是调两次同一个函数）。」
 *
 * 为什么必须两处同口径：A 用**条**表达时间、D 用**格**表达时间，两者是同一张纸族
 * 的两把尺子——窗口差一天，同一个项目在两套模板上画出的时间范围就不一样，读者按
 * D 的格去读 A 的条会错位。两个实现各自独立（`buildPrintGantt` 走 reduce 求 union、
 * `deMatrixWindow` 走独立的 min/max），故这里是**真·跨实现比对**。
 * 变异自证：把 `deMatrixWindow` 的空串过滤删掉（或改成不取 union）⇒ 本组转红。
 */
import { deMatrixWindow } from '../src/print/pages/data-editorial/matrix';

describe('批 B 裁决 · A 与 D 的视图窗口等价（跨实现，含空串脏行）', () => {
  /** 夹具：双侧越出计划窗口 + 一条空串脏行（与 A 组同一构造思路） */
  const dirty = [
    ...GANTT_INPUT,
    {
      id: 'dirty-row',
      orderIndex: 9,
      name: '脏行',
      startAt: '',
      endAt: '',
      status: StageStatus.NotStarted,
      colorIndex: 9,
      customColor: null,
    },
  ];
  const project = { plannedStartAt: PROJECT.plannedStartAt, plannedEndAt: PROJECT.plannedEndAt };

  it('★ 同一夹具下 viewStart / viewEnd 逐值相等（空串脏行不得改变窗口）', () => {
    for (const [label, stages] of [
      ['干净夹具', GANTT_INPUT],
      ['带空串脏行', dirty],
    ] as const) {
      const gantt = buildPrintGantt(project, stages);
      const matrix = deMatrixWindow(project, stages);
      expect(matrix.viewStart, `${label}：viewStart 与 buildPrintGantt 逐值相等`).toBe(
        gantt.viewStart,
      );
      expect(matrix.viewEnd, `${label}：viewEnd 与 buildPrintGantt 逐值相等`).toBe(
        gantt.viewEnd,
      );
      // 两侧都被 union 撑开（不是只取计划窗口）：越界阶段确实参与取 min/max
      expect(gantt.viewStart, `${label}：窗口左端被越界阶段撑开`).toBe(EXPECTED_VIEW_START);
      expect(gantt.viewEnd, `${label}：窗口右端被越界阶段撑开`).toBe(EXPECTED_VIEW_END);
    }
  });

  it('★ 脏行不参与窗口：带脏行与不带脏行的两个实现**同时**给出同一个窗口', () => {
    const clean = deMatrixWindow(project, GANTT_INPUT);
    const withDirty = deMatrixWindow(project, dirty);
    expect(withDirty).toEqual(clean);
    expect(withDirty.viewStart, '空串脏行不得把 viewStart 拉成空串').not.toBe('');
    // 两实现交叉：A 的实现（脏行）与 D 的实现（干净）也须一致
    expect(buildPrintGantt(project, dirty).viewStart).toBe(clean.viewStart);
    expect(buildPrintGantt(project, dirty).viewEnd).toBe(clean.viewEnd);
  });
});
