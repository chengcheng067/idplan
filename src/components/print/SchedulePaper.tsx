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
 *
 * ── v0.8.6.0002 · 反馈 #9.2/#9.3 的增量（不违反上一条）──
 * 五个内容块改为 `blocks` 可摘（默认全开 ⇒ 未传 prop 的宿主逐字不变），
 * 根 div 追加皮肤类（v1 default = 零新 CSS）。**所有既有选择器与文案
 * 一个未删**（条件渲染保留源码字符串）：print-preview.spec ④ 的七选择器、
 * v07-dline / schedule-print-band-bounds 的「阶段清单」「打印时间轴」
 * 均照旧命中。改本文件JSX结构前先读这几条 spec。
 *
 * ── 2026-10-09 · 打印密度修订（print-density-study §3「H 版 · 经典」表）──
 * 经典纸面是四版里行内最松的：甘特轨道 h-9（36px）给 6px 视觉厚薄的细条
 * 配了宽跑道，清单数据行 42px 对四列内容过剩，而章节间距（mt-6/pb-3）
 * 反而薄。按「紧 L2 数据行、松 L0/L1 界面」落：track h-9→h-7、数据行
 * h-[42px]→h-[34px]、表头 h-[34px]→h-[30px]、section mt-6→mt-8、
 * 页头 pb-3→pb-4、图例 mt-3→mt-4。轨道行间距 space-y-1.5 不动（恰是
 * 规则 2 的行内值）；图例色点 h-3 不动。分页逻辑按块预算走、不逐行估高，
 * 收紧只让每页内容更矮（页脚贴底、上方留白增多），不改变分页点。
 * ⚠️ schedule-print-band-bounds.spec 用结构选择器 `div.relative.h-7`
 * 定位轨道行——track 高度类与那条 spec 同批改（改类名 = 改定位）。
 *
 * ── 2026-10-09 · 分页早断修复（schedule-print.ts 估高实测校准）──
 * 估高模型从母本「每阶段一张任务清单」改为实测的「每阶段一行 34px」：
 * 5 阶段项目一页装下（旧 2+3 两页）、20+ 阶段第一页不再被时间轴撑爆
 * （旧 20 阶段第 1 页实测 1292px 溢出 1123）。配套两改：时间轴 20+ 阶段
 * 转紧凑档（h-7→h-5，阈值 TIMELINE_COMPACT_AT，与分页估高同源）；第一页
 * 放不下任何表格行时只出纸壳（时间轴），空页不渲染表格（不出孤单表头）。
 * band-bounds spec 的夹具 3-4 阶段走正常档，`div.relative.h-7` 不受影响。
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
import {
  A4_WIDTH_PX,
  A4_HEIGHT_PX,
  TIMELINE_COMPACT_AT,
  type ScheduleSection,
  type SchedulePaperBlocks,
  DEFAULT_SCHEDULE_PAPER_BLOCKS,
} from '../../lib/schedule-print';
import type { Project, Stage } from '../../core/types/entities';
import { printSkinClass, type PrintSkinId } from './print-templates';
import { PrintLogoMark } from '../../print/parts/PrintLogoMark';

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
  /** 打印内容勾选（反馈 #9.2；缺省 = 五块全开，默认值见 schedule-print.ts 的 DEFAULT_SCHEDULE_PAPER_BLOCKS） */
  blocks?: SchedulePaperBlocks;
  /** 皮肤（反馈 #9.3；v1 仅 'default'，缺省 = 经典） */
  skin?: PrintSkinId;
  /**
   * 全局打印 logo（产品决策文档 §3.3；null = 未上传 ⇒ 页脚署名旁显示
   * 「ID Plan」文字标）。**只加渲染，不动五块契约与任何既有选择器**——
   * 署名字样「ID Plan · 项目排期与交付管理」逐字保留（既有 spec 钉死）。
   */
  logo?: string | null;
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
    blocks = DEFAULT_SCHEDULE_PAPER_BLOCKS,
    skin = 'default',
    logo = null,
  } = props;

  /**
   * 时间轴紧凑档（2026-10-09 分页早断修复）：20+ 阶段时正常轨道
   * （h-7 + space-y-1.5 = 34px 行距）会把第一页撑爆——24 阶段起整页直奔
   * 1123 上限（旧代码 21 阶段就溢岀：20 阶段实测第 1 页 1292px）。紧凑档
   * 轨道 h-5 + space-y-1 = 24px 行距，30 阶段也能整页装下。与 A/D/E 的
   * compact 密度档同款语言；阈值与分页估高同源（TIMELINE_COMPACT_AT）。
   */
  const timelineCompact = sections.length >= TIMELINE_COMPACT_AT;

  return (
    <div className={`print-root mx-auto w-full max-w-[900px] px-6 py-8 ${printSkinClass(skin)}`}>
      {/* A4 分页纸面（画板 09：宽 900 · paper 底 · line 描边 · padding 56） */}
      {pages.map((pageSections, idx) => (
        <div
          key={idx}
          ref={pageRef(idx)}
          className="a4-page mx-auto mb-6 flex flex-col"
          style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX, padding: 56 }}
        >
          {/* 打印头部（画板 09：项目名 18/700 + 委托方·周期 13 · 右 打印日期 11） */}
          {blocks.header && (
            <header className="flex items-start justify-between border-b border-line pb-4">
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
          )}

          {/* 第一页：打印时间轴（甘特）+ 项目信息 */}
          {idx === 0 && (
            <>
              {/* 打印时间轴（画板 09：刻度行 + 每条阶段 阶段点 + 名称 + 日期区间 + 跨度色带） */}
              {blocks.timeline && (
                <section className="mt-8">
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
                  <div className={timelineCompact ? 'space-y-1' : 'space-y-1.5'}>
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
                          <div
                            className={
                              timelineCompact
                                ? 'relative h-5 flex-1 rounded-lg bg-sunken'
                                : 'relative h-7 flex-1 rounded-lg bg-sunken'
                            }
                          >
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
                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-mist">
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
              )}

              {/* 项目信息（画板 09 打印头部下方：排期基准 / 打印时间） */}
              {blocks.projectInfo && (
                <p className="mt-4 text-xs leading-relaxed text-mist">
                  排期基准：{SCHEDULE_BASIS_LABELS[project.scheduleBasis] ?? SCHEDULE_BASIS_LABELS[ScheduleBasis.Calendar]}
                  {'　·　'}打印时间：{nowText}
                </p>
              )}
            </>
          )}

          {/* 阶段清单表（画板 09：paper 底 + line 描边 · 表头 30 · 数据行 34 · 斑马纹）
              ⚠️ 空页（时间轴占满第一页时的纯纸壳页）不渲染表格——否则出
              「阶段清单」标题 + 表头 + 零行的孤单表头（2026-10-09 分页修复：
              20+ 阶段第一页只出时间轴，表格整体后移） */}
          {blocks.stageTable && pageSections.length > 0 && (
            <section className="mt-8 break-inside-avoid">
              <h2 className="mb-2 text-[15px] font-semibold text-ink">阶段清单</h2>
              <table className="schedule-table w-full overflow-hidden rounded-lg border border-line text-[13px]">
                <thead>
                  <tr className="bg-sunken text-left text-[11px] font-semibold text-mist">
                    <th className="h-[30px] px-3 font-semibold">序号</th>
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
                        <td className="h-[34px] px-3">
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
          )}

          {/* 打印页脚（画板 09：左 署名 · 右 页码） */}
          {blocks.footer && (
            <footer className="mt-auto flex items-center justify-between border-t border-line pt-3 text-[11px] tabular-nums text-mist">
              {/* logo：页脚署名旁（经典纸面的落点；≤20px；未上传 = 文字标）。
                  署名字样逐字保留（既有 spec 钉死），logo 只加在它旁边 */}
              <span className="flex items-center gap-2">
                <PrintLogoMark logo={logo} height={20} />
                <span>ID Plan · 项目排期与交付管理</span>
              </span>
              <span>
                第 {idx + 1} / {pages.length} 页
              </span>
            </footer>
          )}
        </div>
      ))}
    </div>
  );
}

/** 供宿主做类型收窄的再导出（Project / Stage 全量对象可直接喂，Pick 是宽进严出） */
export type { Project, Stage };
