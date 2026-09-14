// @vitest-environment jsdom
/**
 * v0.7 · 打印日程表页「甘特色条不得越出轨道」不变式（回归锁）。
 *
 * ── 为什么单独立一个 spec（而不是塞进 `tests/schedule-print.spec.ts`）──
 * `tests/schedule-print.spec.ts` 的头部契约写明是「**node 环境纯函数断言，无需 DOM/canvas**」，
 * 测的是 `buildScheduleSections` 的**数据组装**；而本文件的断言对象是**渲染后的内联几何值**
 * （`style.left` / `style.width`），必须有 jsdom + MemoryRouter + store 夹具。两者环境与
 * 关注点都不同，混在一个文件里就得把整份纯函数 spec 一起切到 jsdom，得不偿失。
 * 单独立文件还能让「色条边界」这条不变式**按文件名可检索**。
 *
 * ── 它锁的 bug（真实复发过一次）──
 * 打印页的甘特图用**项目计划窗口**（`plannedStartAt … plannedEndAt`）当百分比基准：
 *   `left = offsetDays(startAt) / viewDays * 100`，`width = (hi - lo + 1) / viewDays * 100`。
 * 阶段一旦越出计划窗口（脏数据很常见：阶段结束日 > 计划结束日，或阶段开始日 < 计划开始日），
 * `left + width > 100`（或 `left < 0`），`absolute` 定位的色条就溢出 `relative` 轨道，
 * 盖到右侧「起止日期」文字上。**同一个 bug 详情页 `TimelineView` 早已修过**
 * （改为以阶段实际起止为边界），打印页是另一套内联实现、没跟上，所以这里用机器断言钉死。
 *
 * ⚠️ 断言必须读**真实数值**（`parseFloat(el.style.left)`）。本项目有过「`toContain` 查
 * className 字符串恒真」的先例，禁止再用字符串包含当断言。
 *
 * ⚠️ 定位方式说明：用**结构**定位（轨道行 `div.relative.h-9` → 其内联样式子元素），
 * 而不是「按 class 名断言」。若将来行结构改了导致匹配不到，第 1 条前置断言会先红，
 * 不会退化成「0 条色条全部通过」的假绿。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { SchedulePrintPage } from '../src/pages/SchedulePrintPage';
import { useProjectsStore } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ProjectType,
  ScheduleBasis,
  StageStatus,
} from '../src/core/types/enums';
import { totalDaysInclusive } from '../src/lib/date';
import type { Member, Project, Stage } from '../src/core/types/entities';

/* ====================================================================================
 * 夹具：**故意**构造「阶段越出计划窗口」的脏数据（否则测不出这个 bug）
 * ==================================================================================== */

const PROJECT_ID = 'proj_band';

const ADMIN_ID = 'm-band-admin';

function makeMember(id: string, name: string, roleKind: MemberRoleKind): Member {
  return {
    id,
    name,
    role: roleKind === MemberRoleKind.Admin ? '项目负责人' : '协作成员',
    contact: null,
    avatarColor: null,
    active: true,
    roleKind,
    passwordHash: null,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}
const ADMIN = makeMember(ADMIN_ID, '负责人甲', MemberRoleKind.Admin);

/** 计划窗口：2026-01-01 → 2026-03-01（不含闰日；`totalDaysInclusive` = 60 天） */
const PROJECT: Project = {
  id: PROJECT_ID,
  name: '某茶空间',
  type: ProjectType.TeaSpace,
  address: null,
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

/** ① 完全落在计划窗口内（对照基准：修不修它都不该越界） */
const STAGE_INSIDE = makeStage('stg_in', 1, '提案', '2026-01-05T00:00:00Z', '2026-01-20T23:59:59Z');
/** ② 结束日晚于计划结束日 → 旧公式下 `left + width = 131.67%`（截图里那类越界） */
const STAGE_OVER_END = makeStage('stg_over_end', 2, '灯光专项深化', '2026-02-20T00:00:00Z', '2026-03-20T23:59:59Z');
/** ③ 开始日早于计划开始日 → 旧公式下 `left = -20%`（向**左**溢出，另一个方向） */
const STAGE_OVER_START = makeStage('stg_over_start', 3, '前置踏勘', '2025-12-20T00:00:00Z', '2025-12-31T23:59:59Z');

const STAGES: Stage[] = [STAGE_INSIDE, STAGE_OVER_END, STAGE_OVER_START];

/** 「计划窗口 ∪ 阶段实际起止」——本不变式的期望视图窗口（与实现口径独立地重算一遍） */
const EXPECTED_VIEW_START = '2025-12-20';
const EXPECTED_VIEW_END = '2026-03-20';

/* ====================================================================================
 * 渲染 / 取值
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

/** 挂载打印日程表页（admin 身份 → 不做成员收窄，全量阶段上屏） */
function renderPage(opts: { extraStage?: Stage } = {}): HTMLDivElement {
  unmountCurrent();

  act(() => {
    useProjectsStore.getState().replaceAll({
      projects: [PROJECT],
      stages: opts.extraStage ? [...STAGES, opts.extraStage] : STAGES,
      tasks: [],
    });
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
          <Route path="/" element={<div data-home-marker="">首页占位</div>} />
          <Route path="/project/:id/schedule-print" element={<SchedulePrintPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return h;
}

interface Band {
  /** 阶段名（从色条 `title` 里剥掉 `「序号. 」` 前缀，仅用于报错信息） */
  name: string;
  left: number;
  width: number;
  right: number;
}

/**
 * 从 DOM 读出**打印时间轴**里每个色条的内联几何值。
 * 结构定位：轨道行 = `div.relative.h-9`；其带 `title` 的子元素 = 色条。
 *
 * ⚠️ 不用「`style.left` 非空」当识别条件：CSSOM 会**静默丢弃**非法值（如 `NaN%`），
 *    `style.left` 于是变成空串——那样脏行会被误判为「不是色条」，把「脏行是否渲染」
 *    这件事测不出来。故按 `title` 结构识别，解析失败的几何值如实保留为 `NaN` 上报。
 */
function readBands(h: ParentNode): Band[] {
  const rows = Array.from(h.querySelectorAll('div.relative.h-9'));
  return rows.map((row) => {
    const bar = Array.from(row.children).find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('title'),
    );
    if (!bar) throw new Error('轨道行内找不到色条（带 title 的子元素）');
    const titleHead = (bar.getAttribute('title') ?? '').split('（')[0] ?? '';
    const left = Number.parseFloat(bar.style.left);
    const width = Number.parseFloat(bar.style.width);
    return {
      // title 形如 `2. 灯光专项深化（…）`，剥掉 `序号. ` 前缀便于用阶段名做期望表 key
      name: titleHead.replace(/^\d+\.\s*/, ''),
      left,
      width,
      right: left + width,
    };
  });
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

/* ====================================================================================
 * 不变式
 * ==================================================================================== */

describe('打印日程表页 · 甘特色条不越出轨道（v0.7 回归锁）', () => {
  it('前置：3 个阶段都上屏，且每个轨道行都读到真实的内联 left/width', () => {
    const h = renderPage();

    expect(h.querySelector('.print-root'), '打印内容应已上屏').not.toBeNull();
    expect(h.textContent, '应是日程表打印页').toContain('打印时间轴');

    const bands = readBands(h);
    // 这条是「量具自检」：匹配不到色条时**先红**，不会退化成 0 条全部通过的假绿
    expect(bands.length, '时间轴色条数应等于阶段数（3）').toBe(STAGES.length);

    for (const b of bands) {
      expect(Number.isFinite(b.left), `${b.name}：left 应是可解析的数值`).toBe(true);
      expect(Number.isFinite(b.width), `${b.name}：width 应是可解析的数值`).toBe(true);
      expect(b.name, '每条色条都应带上阶段名（证明读的是色条而不是别的元素）').not.toBe('');
    }
  });

  it('★ 不变式：每个色条都落在轨道内（left ≥ 0 且 left + width ≤ 100）', () => {
    const h = renderPage();
    const bands = readBands(h);
    expect(bands.length).toBe(STAGES.length); // 前置：否则下面的巡检是空过

    // 收集**全部**越界（而不是 fail-fast 只报第一条）：左右两个方向一次看全，
    // 否则「先断言的左侧越界」会把「右侧越界」的证据吃掉，得跑两轮才知道全貌。
    const violations: string[] = [];
    for (const b of bands) {
      if (b.left < 0) {
        violations.push(`${b.name}：向**左**越界（left ${b.left}% < 0）`);
      }
      if (b.right > 100) {
        violations.push(`${b.name}：向**右**越界（left ${b.left}% + width ${b.width}% = ${b.right}% > 100%）`);
      }
    }

    expect(violations, `色条越出轨道：\n${violations.join('\n')}`).toEqual([]);
  });

  it('★ 视图窗口 = 计划窗口 ∪ 阶段实际起止（最早起点贴 0%、最晚终点贴 100%，无溢出也无冗余留白）', () => {
    const h = renderPage();
    const bands = readBands(h);
    expect(bands.length).toBe(STAGES.length);

    const viewDays = totalDaysInclusive(EXPECTED_VIEW_START, EXPECTED_VIEW_END);
    // 独立重算：不走被测代码的 bandGeom，避免「用错公式去验证错的公式」
    const expected = new Map<string, { left: number; width: number }>([
      [
        STAGE_OVER_START.name,
        {
          left: 0,
          width: (totalDaysInclusive(EXPECTED_VIEW_START, '2025-12-31') / viewDays) * 100,
        },
      ],
      [
        STAGE_INSIDE.name,
        {
          left: ((totalDaysInclusive(EXPECTED_VIEW_START, '2026-01-05') - 1) / viewDays) * 100,
          width: ((totalDaysInclusive('2026-01-05', '2026-01-20')) / viewDays) * 100,
        },
      ],
      [
        STAGE_OVER_END.name,
        {
          left: ((totalDaysInclusive(EXPECTED_VIEW_START, '2026-02-20') - 1) / viewDays) * 100,
          width: ((totalDaysInclusive('2026-02-20', '2026-03-20')) / viewDays) * 100,
        },
      ],
    ]);

    for (const b of bands) {
      const e = expected.get(b.name);
      expect(e, `未预期的色条：${b.name}`).toBeDefined();
      expect(Math.abs(b.left - e!.left), `${b.name}：left 应等于按 union 窗口重算的值`).toBeLessThan(0.01);
      expect(Math.abs(b.width - e!.width), `${b.name}：width 应等于按 union 窗口重算的值`).toBeLessThan(0.01);
    }

    // 两端贴合：最早起点恰在 0%、最晚终点恰在 100%（既没溢出，也没被额外留白撑开）
    const earliest = bands.find((b) => b.name === STAGE_OVER_START.name)!;
    const latest = bands.find((b) => b.name === STAGE_OVER_END.name)!;
    expect(earliest.left, '最早阶段起点应贴住轨道左缘').toBeCloseTo(0, 6);
    expect(latest.right, '最晚阶段终点应贴住轨道右缘（不越界、也不留白）').toBeCloseTo(100, 6);
  });

  /**
   * ⚠️ 这条锁的是「本次改动**自带**的放大风险」：union 要对所有阶段日期取 min/max，
   *    而空串在字符串比较里最小 → 一条 `startAt === ''` 的脏行会把 `viewStart` 拉成 `''`
   *    → `viewDays = NaN` → **整轴所有色条一起 NaN**（旧实现只用计划窗口，没有这个放大效应）。
   *    故实现里先滤掉空日期；本用例保证那条过滤**删不掉**（删掉 → 其它行集体 NaN → 红）。
   */
  it('★ 单条脏行（阶段日期为空串）不得污染整轴：其它色条仍按 union 窗口正确出图', () => {
    const h = renderPage({ extraStage: makeStage('stg_dirty', 4, '脏行', '', '') });
    const bands = readBands(h);
    expect(bands.length, '前提：脏行本身也要上屏（4 行）').toBe(STAGES.length + 1);

    const others = bands.filter((b) => b.name !== '脏行');
    expect(others.length, '前提：除脏行外应仍有 3 条色条').toBe(STAGES.length);
    for (const b of others) {
      expect(
        Number.isFinite(b.left) && Number.isFinite(b.width),
        `${b.name}：不该被脏行带成 NaN（left ${b.left} / width ${b.width}）`,
      ).toBe(true);
    }

    // 其它行的几何必须与「没有脏行时」完全一致（脏行不得改变视图窗口）
    const clean = readBands(renderPage());
    for (const b of clean) {
      const same = others.find((o) => o.name === b.name)!;
      expect(Math.abs(same.left - b.left), `${b.name}：脏行不得改变 left`).toBeLessThan(0.01);
      expect(Math.abs(same.width - b.width), `${b.name}：脏行不得改变 width`).toBeLessThan(0.01);
    }
  });
});
