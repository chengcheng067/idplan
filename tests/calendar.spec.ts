/**
 * 月历甘特单测（PRD §7 验收）：
 *   - lib/progress 共享派生（pickActiveStage / currentStageOf / computeProjectStatus / computeProjectPercent）
 *   - calendarMath（buildMonthMeta / shiftMonth / clampDate / dayIndexInMonth / bandGeometry / computeCalendarEntry / filterEntries）
 *   - calendarColors 镜像一致性（杜绝裸 hex 漂移）
 * 全部走纯函数，todayIso 显式注入，幂等可重放。
 */

import { describe, it, expect } from 'vitest';

import type { Project, Stage } from '../src/core/types/entities';
import { ProjectStatus, ScheduleBasis, StageStatus } from '../src/core/types/enums';
import {
  pickActiveStage,
  currentStageOf,
  computeProjectStatus,
  computeProjectPercent,
} from '../src/lib/progress';
import {
  buildMonthMeta,
  shiftMonth,
  clampDate,
  dayIndexInMonth,
  bandGeometry,
  computeCalendarEntry,
  filterEntries,
  type CalendarFilters,
  type CalendarEntry,
} from '../src/components/calendar/calendarMath';
import { STAGE_BAND_COLORS } from '../src/components/timeline/stageColors';
import { TODAY_LINE_COLOR } from '../src/components/timeline/timelineColors';
import {
  COMPLETED_COLOR,
  OVERDUE_COLOR,
  NOT_STARTED_COLOR,
  PROGRESS_DOT_COLOR,
  stageColorOf,
} from '../src/components/calendar/calendarColors';

function makeStage(p: Partial<Stage> & Pick<Stage, 'orderIndex' | 'startAt' | 'endAt'>): Stage {
  return {
    id: `stg_${p.orderIndex}`,
    projectId: 'proj_x',
    templateKey: null,
    colorIndex: p.orderIndex,
    customColor: null,
    name: `阶段${p.orderIndex}`,
    ratioPercent: 10,
    status: StageStatus.NotStarted,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...p,
  };
}

function makeProject(p: Partial<Project>): Project {
  return {
    id: 'proj_x',
    name: '示例项目',
    address: '某地址',
    clientName: '某客户',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-09-01',
    plannedEndAt: '2026-09-30',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: 'indoor',
    kind: 'human',
    // v0.8.6 归属人（null = 公共板；置于 ...p 之前，Partial 展开不致缺字段）
    ownerMemberId: null,
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...p,
  };
}

/** 9 阶段均匀铺在 9 月内（每段 3~4 天） */
function nineStages(todayIso: string): Stage[] {
  const ranges: Array<[string, string, string]> = [
    ['2026-09-01', '2026-09-04', 'completed'],
    ['2026-09-05', '2026-09-09', 'completed'],
    ['2026-09-10', '2026-09-13', 'in_progress'],
    ['2026-09-14', '2026-09-17', 'not_started'],
    ['2026-09-18', '2026-09-21', 'not_started'],
    ['2026-09-22', '2026-09-24', 'not_started'],
    ['2026-09-25', '2026-09-27', 'not_started'],
    ['2026-09-28', '2026-09-29', 'not_started'],
    ['2026-09-30', '2026-09-30', 'not_started'],
  ];
  return ranges.map(([s, e, st], i) =>
    makeStage({ orderIndex: i + 1, startAt: s, endAt: e, status: st as Stage['status'] }),
  );
}

describe('progress.pickActiveStage / currentStageOf', () => {
  const stages = [
    makeStage({ orderIndex: 1, startAt: '2026-09-01', endAt: '2026-09-10', status: StageStatus.InProgress }),
    makeStage({ orderIndex: 2, startAt: '2026-09-11', endAt: '2026-09-20', status: StageStatus.NotStarted }),
  ];

  it('今天落在阶段区间内 → 该阶段', () => {
    expect(pickActiveStage(stages, '2026-09-05')?.orderIndex).toBe(1);
  });
  it('今天在区间之后、处于未来阶段前 → 取最近未完成阶段（nextUp）', () => {
    expect(pickActiveStage(stages, '2026-09-15')?.orderIndex).toBe(2);
  });
  it('今天越过全部阶段且无未来未完成 → null', () => {
    expect(pickActiveStage(stages, '2026-09-25')).toBeNull();
  });
  it('currentStageOf 末阶段回落（全 Completed 时返回最后一条）', () => {
    const done = stages.map((s) => ({ ...s, status: StageStatus.Completed }));
    expect(currentStageOf(done, '2026-09-25')?.orderIndex).toBe(2);
  });
});

describe('progress.computeProjectStatus / computeProjectPercent', () => {
  it('全部完成 → completed，percent=100', () => {
    const stages = nineStages('2026-09-15').map((s) => ({ ...s, status: StageStatus.Completed }));
    expect(computeProjectStatus(makeProject({}), stages, '2026-09-15')).toBe('completed');
    expect(computeProjectPercent(stages)).toBe(100);
  });
  it('today < plannedStartAt → not_started', () => {
    const p = makeProject({ plannedStartAt: '2026-10-05', plannedEndAt: '2026-10-30' });
    expect(computeProjectStatus(p, nineStages('2026-09-15'), '2026-09-15')).toBe('not_started');
  });
  it('plannedEndAt < today 且未完成 → overdue', () => {
    const stages = [makeStage({ orderIndex: 1, startAt: '2026-09-01', endAt: '2026-09-10', status: StageStatus.InProgress })];
    const p = makeProject({ plannedStartAt: '2026-09-01', plannedEndAt: '2026-09-10' });
    expect(computeProjectStatus(p, stages, '2026-09-20')).toBe('overdue');
  });
  it('进行中 → in_progress，percent 按完成阶段比例', () => {
    const stages = nineStages('2026-09-15'); // 2 完成 / 9
    expect(computeProjectStatus(makeProject({}), stages, '2026-09-15')).toBe('in_progress');
    expect(computeProjectPercent(stages)).toBeCloseTo((2 / 9) * 100, 5);
  });
});

describe('calendarMath.buildMonthMeta / shiftMonth / clampDate', () => {
  it('2026-09 → 30 天，边界正确', () => {
    const m = buildMonthMeta('2026-09', '2026-09-15');
    expect(m.daysInMonth).toBe(30);
    expect(m.monthStart).toBe('2026-09-01');
    expect(m.monthEnd).toBe('2026-09-30');
    expect(m.todayInMonth).toBe(true);
    expect(m.todayIdx).toBe(14);
  });
  it('today 不在当月 → todayInMonth=false, todayIdx=-1', () => {
    const m = buildMonthMeta('2026-10', '2026-09-15');
    expect(m.todayInMonth).toBe(false);
    expect(m.todayIdx).toBe(-1);
  });
  it('shiftMonth 跨年进位', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
  it('clampDate 裁剪到 [min,max]', () => {
    expect(clampDate('2026-08-01', '2026-09-01', '2026-09-30')).toBe('2026-09-01');
    expect(clampDate('2026-10-05', '2026-09-01', '2026-09-30')).toBe('2026-09-30');
    expect(clampDate('2026-09-15', '2026-09-01', '2026-09-30')).toBe('2026-09-15');
  });
  it('dayIndexInMonth 0-based 列序号', () => {
    const m = buildMonthMeta('2026-09');
    expect(dayIndexInMonth('2026-09-01', m)).toBe(0);
    expect(dayIndexInMonth('2026-09-30', m)).toBe(29);
    expect(dayIndexInMonth('2026-08-01', m)).toBe(0); // 越界裁切
    expect(dayIndexInMonth('2026-10-31', m)).toBe(29);
  });
});

describe('calendarMath.computeCalendarEntry（PRD §4.1 / §4.2）', () => {
  const meta = buildMonthMeta('2026-09', '2026-09-15');

  it('进行中：色带起点=阶段实际首日（早于计划基线则取阶段首）、终点=clamp(今日,阶段首,阶段末)、颜色=阶段九色（宽面变体）', () => {
    const p = makeProject({ plannedStartAt: '2026-09-05', plannedEndAt: '2026-09-30' });
    const e = computeCalendarEntry(p, nineStages('2026-09-15'), meta);
    expect(e.status).toBe('in_progress');
    // today(09-15) 落在阶段3(start 09-10,end 09-13)? 越过 → nextUp=阶段4(09-14~09-17)
    expect(e.activeStage?.orderIndex).toBe(4);
    expect(e.progressDate).toBe('2026-09-15');
    // 图3修复：bandStart 现在=min(阶段实际首日 09-01, plannedStart 09-05)=09-01，不再固定用计划基线
    expect(e.bandStart).toBe('2026-09-01');
    expect(e.bandEnd).toBe('2026-09-15'); // clamp(今日 09-15, 阶段首 09-01, 阶段末 09-30)
    expect(e.color).toBe(STAGE_BAND_COLORS[4]);
    expect(e.isGhost).toBe(false);
  });

  it('未开始：幽灵态、progressDate=plannedStartAt、mist 色', () => {
    const p = makeProject({ plannedStartAt: '2026-09-20', plannedEndAt: '2026-09-30' });
    const e = computeCalendarEntry(p, nineStages('2026-09-15'), meta);
    expect(e.status).toBe('not_started');
    expect(e.progressDate).toBe('2026-09-20');
    expect(e.isGhost).toBe(true);
    expect(e.color).toBe(NOT_STARTED_COLOR);
  });

  it('全部完成：s9 色、bandEnd=plannedEndAt、percent=100', () => {
    const p = makeProject({ plannedStartAt: '2026-09-01', plannedEndAt: '2026-09-30' });
    const stages = nineStages('2026-09-15').map((s) => ({ ...s, status: StageStatus.Completed }));
    const e = computeCalendarEntry(p, stages, meta);
    expect(e.status).toBe('completed');
    expect(e.progressDate).toBe('2026-09-30');
    expect(e.bandEnd).toBe('2026-09-30');
    expect(e.percent).toBe(100);
    expect(e.color).toBe(COMPLETED_COLOR);
    expect(e.color).toBe(STAGE_BAND_COLORS[9]);
  });

  it('逾期：clay 色、bandEnd 延伸到今天', () => {
    const stages = [makeStage({ orderIndex: 1, startAt: '2026-09-01', endAt: '2026-09-10', status: StageStatus.InProgress })];
    const p = makeProject({ plannedStartAt: '2026-09-01', plannedEndAt: '2026-09-10' });
    const e = computeCalendarEntry(p, stages, meta);
    expect(e.status).toBe('overdue');
    expect(e.color).toBe(OVERDUE_COLOR);
    expect(OVERDUE_COLOR).toBe(TODAY_LINE_COLOR);
    expect(e.bandEnd).toBe('2026-09-15'); // 延伸到今天（强提示）
  });

  it('bandGeometry 百分比定位', () => {
    const p = makeProject({ plannedStartAt: '2026-09-05', plannedEndAt: '2026-09-30' });
    const e = computeCalendarEntry(p, nineStages('2026-09-15'), meta);
    const g = bandGeometry(e, meta);
    expect(g.startIdx).toBe(0); // 09-01（阶段实际首日，早于计划基线 09-05）
    expect(g.endIdx).toBe(14); // 09-15
    expect(g.leftPct).toBeCloseTo(0, 5);
    expect(g.widthPct).toBeCloseTo((15 / 30) * 100, 5);
    expect(g.dotLeftPct).toBeCloseTo((14 / 30) * 100, 5);
  });
});

describe('calendarMath.filterEntries（PRD §3.4 组间 AND / 组内 OR）', () => {
  function entry(status: CalendarEntry['status'], stageIndex: number): CalendarEntry {
    const p = makeProject({});
    const stages = nineStages('2026-09-15');
    const base = computeCalendarEntry(p, stages, buildMonthMeta('2026-09', '2026-09-15'));
    return { ...base, status, filterStageIndex: stageIndex };
  }
  const entries = [entry('in_progress', 3), entry('overdue', 5), entry('completed', 9), entry('in_progress', 7)];

  it('空筛选 → 全部', () => {
    expect(filterEntries(entries, { status: new Set(), stage: new Set() })).toHaveLength(4);
  });
  it('状态组内 OR', () => {
    const f: CalendarFilters = { status: new Set(['overdue', 'completed']), stage: new Set() };
    const r = filterEntries(entries, f);
    expect(r).toHaveLength(2);
    expect(r.every((e) => e.status === 'overdue' || e.status === 'completed')).toBe(true);
  });
  it('阶段组内 OR', () => {
    const f: CalendarFilters = { status: new Set(), stage: new Set([3, 7]) };
    const r = filterEntries(entries, f);
    expect(r).toHaveLength(2);
    expect(r.every((e) => e.filterStageIndex === 3 || e.filterStageIndex === 7)).toBe(true);
  });
  it('组间 AND', () => {
    const f: CalendarFilters = { status: new Set(['in_progress']), stage: new Set([3]) };
    const r = filterEntries(entries, f);
    expect(r).toHaveLength(1);
    expect(r[0].filterStageIndex).toBe(3);
  });
});

describe('calendarColors 镜像一致性（PRD §6.2 禁止裸 hex 漂移）', () => {
  it('完成色 = stage.s9 宽面变体，逾期色 = clay，未开始 = mist，进度点 = pine', () => {
    expect(COMPLETED_COLOR).toBe(STAGE_BAND_COLORS[9]);
    // 今日线 / 逾期色带 / 进度点改由 CSS 变量驱动（见 timelineColors.ts），
    // 未开始幽灵态改由 --calendar-not-started 驱动（见 calendarColors.ts），
    // 不再裸 hex：真实色值住在 global.css 对应变量，随主题换肤。
    // 这里守的是「引用同一变量、不各自硬编码」的镜像一致性。
    expect(TODAY_LINE_COLOR).toBe('var(--timeline-today-line)');
    expect(OVERDUE_COLOR).toBe(TODAY_LINE_COLOR);
    expect(NOT_STARTED_COLOR).toBe('var(--calendar-not-started)');
    expect(PROGRESS_DOT_COLOR).toBe('var(--timeline-ring-progress)');
  });
  it('stageColorOf 按 orderIndex 取九段色（宽面变体）', () => {
    expect(stageColorOf(3)).toBe(STAGE_BAND_COLORS[3]);
    expect(stageColorOf(99)).toBe(STAGE_BAND_COLORS[9]);
  });
});
