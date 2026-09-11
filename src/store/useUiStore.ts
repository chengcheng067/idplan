import { create } from 'zustand';

import type { CalendarFilterStatus } from '../components/calendar/calendarMath';

/**
 * UI 瞬态状态：抽屉开关、当前选中 stage、向导可见性、时间轴缩放档位、首页视图模式。
 * 与业务数据严格分离——刷新即失，不落库。
 */

export type TimelineZoom = 'month' | 'half-month';

/** 首页视图模式：看板（项目卡片网格）/ 月历（跨项目甘特） */
export type HomeViewMode = 'kanban' | 'calendar';

/**
 * homeViewMode 的 localStorage 键（v0.7 批次 A · A4）。
 *
 * 为什么持久化：用户反馈「找不到日历看板入口」。设计稿（画板 02 L143 / 板 14）确认
 * 月历是**首页的一种视图**而非独立导航目的地，故入口就是首页内容区的视图切换；
 * 但此前刷新会回落 kanban，用户切到月历后一刷新就「又不见了」，
 * 观感上等同于入口不存在。持久化后切换选择即可长期保留。
 *
 * 命名沿用本项目既有规范（`idplan-theme` / `idplan.layout`），
 * 存储不可用时静默降级为「仅当前会话生效」（与主题一致的做法）。
 */
const HOME_VIEW_STORAGE_KEY = 'idplan.homeView';

/** 读回持久化的首页视图模式；非法值 / 存储不可用一律回落 'kanban' */
function readStoredHomeView(): HomeViewMode {
  try {
    const v = localStorage.getItem(HOME_VIEW_STORAGE_KEY);
    return v === 'calendar' || v === 'kanban' ? v : 'kanban';
  } catch {
    return 'kanban';
  }
}

/** 写入持久化的首页视图模式；失败静默（隐私模式 / 禁用存储） */
function persistHomeView(mode: HomeViewMode): void {
  try {
    localStorage.setItem(HOME_VIEW_STORAGE_KEY, mode);
  } catch {
    /* 存储不可用：仅当前会话生效 */
  }
}

/** 月历筛选条件（瞬态，不落库）：状态组 + 阶段组，组间 AND、组内 OR */
export interface CalendarFilters {
  status: Set<CalendarFilterStatus>;
  stage: Set<number>; // 当前阶段 orderIndex ①~⑨
}

export interface UiState {
  stageDrawerStageId: string | null; // 打开的抽屉对应阶段
  manualFormOpen: boolean;
  timelineZoom: TimelineZoom;

  // ---- 月历甘特瞬态状态（PRD §3.1 / §3.4） ----
  /** 当前查看月份 'YYYY-MM'，默认当月 */
  calendarMonth: string;
  /** 首页视图模式：看板 / 月历 */
  homeViewMode: HomeViewMode;
  /** 月历筛选条件（状态 + 阶段多选 chip） */
  calendarFilters: CalendarFilters;

  /** 应用栏全局搜索词（按项目名 / 客户名过滤看板，对齐参考稿应用栏搜索框） */
  searchQuery: string;
  /** 最近打开的项目（返回首页时该卡片呈现参考稿 §选中态 蓝色光晕） */
  selectedProjectId: string | null;

  openStageDrawer(stageId: string): void;
  setSearchQuery(query: string): void;
  setSelectedProjectId(projectId: string | null): void;
  closeStageDrawer(): void;
  openManualForm(): void;
  closeManualForm(): void;
  setTimelineZoom(zoom: TimelineZoom): void;

  // ---- 月历 setter ----
  setCalendarMonth(month: string): void;
  setHomeViewMode(mode: HomeViewMode): void;
  toggleCalendarStatusFilter(status: CalendarFilterStatus): void;
  toggleCalendarStageFilter(orderIndex: number): void;
  clearCalendarFilters(): void;
}

function currentMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const useUiStore = create<UiState>((set) => ({
  stageDrawerStageId: null,
  manualFormOpen: false,
  timelineZoom: 'month',

  calendarMonth: currentMonthIso(),
  // 首屏即读回上次选择（A4 持久化）：刷新不再回落「看板」，月历入口因此长期可见
  homeViewMode: readStoredHomeView(),
  calendarFilters: { status: new Set(), stage: new Set() },

  searchQuery: '',
  selectedProjectId: null,
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedProjectId: (projectId) => set({ selectedProjectId: projectId }),

  openStageDrawer: (stageId) => set({ stageDrawerStageId: stageId }),
  closeStageDrawer: () => set({ stageDrawerStageId: null }),
  openManualForm: () => set({ manualFormOpen: true }),
  closeManualForm: () => set({ manualFormOpen: false }),
  setTimelineZoom: (zoom) => set({ timelineZoom: zoom }),

  setCalendarMonth: (month) => set({ calendarMonth: month }),
  setHomeViewMode: (mode) => {
    persistHomeView(mode);
    set({ homeViewMode: mode });
  },
  toggleCalendarStatusFilter: (status) =>
    set((st) => {
      const next = new Set(st.calendarFilters.status);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return { calendarFilters: { ...st.calendarFilters, status: next } };
    }),
  toggleCalendarStageFilter: (orderIndex) =>
    set((st) => {
      const next = new Set(st.calendarFilters.stage);
      if (next.has(orderIndex)) next.delete(orderIndex);
      else next.add(orderIndex);
      return { calendarFilters: { ...st.calendarFilters, stage: next } };
    }),
  clearCalendarFilters: () =>
    set({ calendarFilters: { status: new Set(), stage: new Set() } }),
}));
