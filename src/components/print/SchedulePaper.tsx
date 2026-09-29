/**
 * 排期打印纸面（0.8.4 · A 方案步骤 1：从 SchedulePrintPage 抽出的纯展示组件）。
 *
 * ── 为什么抽 ──
 * 打印内置化后同一棵纸面有两个宿主：独立打印路由（`SchedulePrintPage`，深链兜底）
 * 与应用内打印预览面板（`PrintPreviewDialog`）。两份 DOM 若各写一遍，
 * 「同一阶段两个色」这类视觉分裂必然复发（规格 §1.2 已有同型教训）。
 * 故纸面收敛为单一组件，宿主只提供数据与 ref 收集。
 *
 * ── 搬运纪律（设计规范 §7.1，硬约束） ──
 * 本文件的纸面 JSX 自 `SchedulePrintPage.tsx` **逐字搬运**（含选择器
 * `.print-root` / `.a4-page` / `.schedule-bar-segment` / `.schedule-status-dot` /
 * `.schedule-table` / `.no-print` / `data-print-month-tick` / `data-tick-left`）——
 * 它们被 print-light-lock / schedule-print-band-bounds / stage-color-wiring /
 * itinerary-print 等 spec 钉死。改动 = 现有测试变红，改前先读规范 §7.1 表。
 *
 * 取色纪律同母本：一律走静态类映射（stageSolidClass / stageBandClass /
 * stageBandOutline / customStageColor），禁止模板字符串拼类名、禁止裸 hex。
 */

import type { Ref } from 'react';

import { SCHEDULE_BASIS_LABELS, ScheduleBasis, StageStatus } from '../../core/types/enums';
import {
  STAGE_COLOR_NAMES,
  stageSolidClass,
  stageBandClass,
  stageBandOutline,
  stageSolidColor,
  stageBandColor,
} from '../timeline/stageColors';
import { customStageColor } from '../timeline/stageColorKey';
import { A4_WIDTH_PX, A4_HEIGHT_PX, type ScheduleSection } from '../../lib/schedule-print';
import type { Project, Stage } from '../../core/types/entities';

/** 母本同款：打印纸面需要的最小项目面（ Pick 而非全量，预览面板同样喂得起 ） */
export interface SchedulePaperProject {
  id: string;
  name: string;
  clientName: string | null;
  plannedStartAt: string;
  plannedEndAt: string;
  scheduleBasis: ScheduleBasis;
}

export interface SchedulePaperProps {
  project: SchedulePaperProject;
  /** 分页后的阶段清单（paginateSections 产物） */
  pages: ScheduleSection[][];
  /** 第一页时间轴用的全量 sections */
  sections: ScheduleSection[];
  /** 色带几何（母本 bandGeom：与月份刻度同坐标系） */
  bandGeom: (startAt: string, endAt: string) => { left: number; width: number };
  /** 月份刻度（与 bandGeom 同坐标系，母本 monthTicks） */
  monthTicks: Array<{ label: string; leftPercent: number }>;
  /** 打印日期文本（yyyy-MM-dd HH:mm） */
  nowText: string;
  startAt: string;
  endAt: string;
  totalDays: number;
  /** 'admin' 才显示委托方（与母本同门控） */
  role: string | null;
  /** 导出 PNG 的页面元素收集（ref callback 数组，宿主持有） */
  pageRef: (idx: number) => Ref<HTMLDivElement>;
}

/** 状态胶囊（浅色底 + 深色字：纸面与打印均清晰可读，全部走命名 token）——母本逐字 */
function statusChipCls(status: StageStatus): string {
  switch (status) {
    case StageStatus.InProgress:
      return 'bg-pine-soft text-pine';
    case StageStatus.Completed:
      return 'bg-moss-soft text-moss';
    case StageStatus.Delayed:
      return 'bg-clay-soft text-clay';
    default:
      return 'bg-sunken text-mist';
  }
}

/** 母本逐字 */
function statusLabel(status: StageStatus): string {
  switch (status) {
    case StageStatus.InProgress:
      return '进行中';
    case StageStatus.Completed:
      return '已完成';
    case StageStatus.Delayed:
      return '延期';
    default:
      return '未开始';
  }
}

/** 状态图例色点（命名 token，无裸 hex）——母本逐字 */
function statusDotCls(status: StageStatus): string {
  switch (status) {
    case StageStatus.InProgress:
      return 'bg-pine';
    case StageStatus.Completed:
      return 'bg-moss';
    case StageStatus.Delayed:
      return 'bg-clay';
    default:
      return 'bg-mist';
  }
}

export function SchedulePaper(props: SchedulePaperProps): JSX.Element {
  const {
    project,
    pages,
    sections,
    bandGeom,
    monthTicks,
    nowText,
    startAt,
    endAt,
    totalDays,
    role,
    pageRef,
  } = props;

  return (
    <div className="print-root mx-auto w-full max-w-[900px] px-6 py-8">
      {/* A4 分页纸面（画板 09：宽 900 · paper 底 · line 描边 · padding 56） */}
      {pages.map((pageSections, idx) => (
        <div
          key={idx}
          ref={pageRef(idx)}
          className="a4-page mx-auto mb-6 flex flex-col"
          style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX, padding: 56 }}
        >
          {/* 打印头部（画板 09：项目名 18/700 + 委托方·周期 13 · 右 打印日期 11） */}
          <header className="flex items-start justify-between border-b border-line pb-3">
            <div>
              <h1 className="text-[18px] font-bold leading-tight text-ink">{project.name}</h1>
              <p className="mt-0.5 text-[13px] text-mist">
                {/* 委托方：仅管理员（与 ProjectDetailPage.tsx:181 同一门控口径）。 */}
                {role === 'admin' && project.clientName && (
                  <span>委托方：{project.clientName}　</span>
                )}
                周期：{startAt} – {endAt}（共 {totalDays} 天）
              </p>
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-mist">打印日期 {nowText}</span>
          </header>

          {/* 第一页：打印时间轴（甘特）+ 阶段清单 */}
          {idx === 0 && (
            <>
              {/* 打印时间轴（画板 09：刻度行 + 每条阶段 阶段点 + 名称 + 日期区间 + 跨度色带） */}
              <section className="mt-6">
                <h2 className="mb-2 text-[15px] font-semibold text-ink">打印时间轴</h2>
                {/*
                  刻度行：**与色条同一坐标系**（母本 monthTicks 注释有完整判据，别改回去）。
                  ⚠️ 两栏结构必须与下面轨道行**逐项对齐**（`w-40` / `gap-3` / `flex-1`）。
                */}
                <div className="mb-1.5 flex gap-3 text-[11px] text-mist">
                  <div className="w-40 shrink-0" aria-hidden />
                  <div className="relative h-4 flex-1">
                    {monthTicks.map((t) => (
                      <span
                        key={t.label}
                        data-print-month-tick=""
                        data-tick-left={t.leftPercent.toFixed(2)}
                        className="absolute top-0 whitespace-nowrap tabular-nums"
                        style={{ left: `${t.leftPercent}%` }}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {sections.map((s) => {
                    const g = bandGeom(s.startAt, s.endAt);
                    // ★ v0.8 通路 B：自定义 ⇒ 描边走 --stage-local-ink(-rgb)；内置 ⇒ 逐字节不变
                    const outline = stageBandOutline(s.orderIndex, s.colorIndex, s.customColor);
                    const sc = customStageColor(s.customColor);
                    return (
                      <div key={s.orderIndex} className="flex items-center gap-3">
                        <div className="flex w-40 shrink-0 items-center gap-1.5">
                          <span
                            className={`schedule-status-dot inline-block h-2.5 w-2.5 shrink-0 rounded-full${
                              sc.isCustom ? '' : ` ${stageSolidClass(s.orderIndex)}`
                            }`}
                            style={
                              sc.isCustom
                                ? { backgroundColor: stageSolidColor(s.orderIndex, s.colorIndex, s.customColor) }
                                : undefined
                            }
                            {...sc.attrs}
                          />
                          <span className="truncate text-[13px] text-ink">{s.name}</span>
                        </div>
                        <div className="relative h-9 flex-1 rounded-lg bg-sunken">
                          <div
                            className={`schedule-bar-segment absolute inset-y-1.5 rounded-md${
                              sc.isCustom ? '' : ` ${stageBandClass(s.orderIndex)}`
                            }`}
                            style={{
                              left: `${g.left}%`,
                              width: `${g.width}%`,
                              boxShadow: outline.boxShadow,
                              ...(sc.isCustom
                                ? { backgroundColor: stageBandColor(s.orderIndex, s.colorIndex, s.customColor) }
                                : {}),
                            }}
                            {...sc.attrs}
                            title={`${s.orderIndex}. ${s.name}（${s.startAt} — ${s.endAt} · ${statusLabel(s.status)}）`}
                          />
                        </div>
                        <span className="shrink-0 tabular-nums text-[11px] text-mist">
                          {s.startAt} — {s.endAt}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {/* 图例：阶段色点（实心块）+ 状态（全部命名 token，无裸 hex） */}
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-mist">
                  <span className="inline-flex items-center gap-1.5">阶段色：</span>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <span
                      key={n}
                      className={`schedule-status-dot inline-block h-3 w-3 rounded-sm ${stageSolidClass(n)}`}
                      title={`${n} ${STAGE_COLOR_NAMES[n] ?? ''}`}
                    />
                  ))}
                  <span className="inline-flex items-center gap-1.5">
                    状态：
                    {(
                      [
                        StageStatus.NotStarted,
                        StageStatus.InProgress,
                        StageStatus.Completed,
                        StageStatus.Delayed,
                      ] as StageStatus[]
                    ).map((st) => (
                      <span key={st} className="ml-1 inline-flex items-center gap-1">
                        <span
                          className={`schedule-status-dot inline-block h-2.5 w-2.5 rounded-full ${statusDotCls(st)}`}
                        />
                        {statusLabel(st)}
                      </span>
                    ))}
                  </span>
                </div>
              </section>

              {/* 项目信息（画板 09 打印头部下方：排期基准 / 打印时间） */}
              <p className="mt-4 text-xs leading-relaxed text-mist">
                排期基准：{SCHEDULE_BASIS_LABELS[project.scheduleBasis] ?? SCHEDULE_BASIS_LABELS[ScheduleBasis.Calendar]}
                {'　·　'}打印时间：{nowText}
              </p>
            </>
          )}

          {/* 阶段清单表（画板 09：paper 底 + line 描边 · 表头 34 · 数据行 42 · 斑马纹） */}
          <section className="mt-6 break-inside-avoid">
            <h2 className="mb-2 text-[15px] font-semibold text-ink">阶段清单</h2>
            <table className="schedule-table w-full overflow-hidden rounded-lg border border-line text-[13px]">
              <thead>
                <tr className="bg-sunken text-left text-[11px] font-semibold text-mist">
                  <th className="h-[34px] px-3 font-semibold">序号</th>
                  <th className="px-3 font-semibold">阶段</th>
                  <th className="px-3 font-semibold">起止日期</th>
                  <th className="px-3 font-semibold">状态</th>
                </tr>
              </thead>
              <tbody>
                {pageSections.map((s, i) => {
                  // ★ 与时间轴摘要同一判定出口：阶段清单里的实心小块也必须跟着自定义色走
                  const sc = customStageColor(s.customColor);
                  return (
                    <tr key={s.orderIndex} className={i % 2 === 1 ? 'bg-sunken/60' : ''}>
                      <td className="h-[42px] px-3">
                        <span
                          className={`mr-1.5 inline-block h-3 w-3 rounded-sm align-middle${
                            sc.isCustom ? '' : ` ${stageSolidClass(s.orderIndex)}`
                          }`}
                          style={
                            sc.isCustom
                              ? { backgroundColor: stageSolidColor(s.orderIndex, s.colorIndex, s.customColor) }
                              : undefined
                          }
                          {...sc.attrs}
                        />
                        <span className="text-ink">{s.orderIndex}</span>
                      </td>
                      <td className="px-3 text-ink">{s.name}</td>
                      <td className="px-3 tabular-nums text-mist">{s.startAt} — {s.endAt}</td>
                      <td className="px-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusChipCls(s.status)}`}
                        >
                          {statusLabel(s.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* 打印页脚（画板 09：左 署名 · 右 页码） */}
          <footer className="mt-auto flex items-center justify-between border-t border-line pt-3 text-[11px] tabular-nums text-mist">
            <span>ID Plan · 项目排期与交付管理</span>
            <span>
              第 {idx + 1} / {pages.length} 页
            </span>
          </footer>
        </div>
      ))}
    </div>
  );
}

/** 供宿主做类型收窄的再导出（Project / Stage 全量对象可直接喂，Pick 是宽进严出） */
export type { Project, Stage };
