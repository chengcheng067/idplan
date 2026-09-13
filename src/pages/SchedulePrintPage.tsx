import { useMemo, useRef, useState } from 'react';

import { Link, Navigate, useParams } from 'react-router-dom';

import { ArrowLeft, CalendarDays, Download, FileText, Printer } from 'lucide-react';

import { useProjectsStore } from '../store/useProjectsStore';
import { useMembersStore } from '../store/useMembersStore';
import { useRoleGuard, isRestrictedView, computeRelatedStageIds } from '../hooks/useRoleGuard';
import { StageStatus, ScheduleBasis, SCHEDULE_BASIS_LABELS } from '../core/types/enums';
import {
  STAGE_COLOR_NAMES,
  stageSolidClass,
  stageBandClass,
  stageBandOutline,
} from '../components/timeline/stageColors';
import {
  buildScheduleSections,
  paginateSections,
  exportSchedulePngPages,
  schedulePngFileName,
  A4_WIDTH_PX,
  A4_HEIGHT_PX,
  type ScheduleSection,
} from '../lib/schedule-print';
import { dayjs, totalDaysInclusive } from '../lib/date';

/**
 * 打印页 · 排期客户稿（A4 · 强制浅色 · 画板 09）：
 *   旧版把整份排期一次性 html2canvas 截成单张 PNG，内容越多图越细长；
 *   现改为按 A4 页高估算分页 → 每页独立渲染为白纸（屏幕态即所见即所得）→ 逐页导出 PNG。
 *
 * 阶段色分工（规格 §1.2 / §1.3，铁律）：
 *   · 时间轴摘要色带（宽面）→ stage-band（bg-stage-band-sN）+ 面内字 stage-ink；
 *   · 序号圆点 / 图例小方块（实心块）→ stage（bg-stage-sN）。
 *   取色一律走「静态类映射」stageBandClass / stageSolidClass（禁止模板字符串拼类名——见 stageColors.ts 注释），
 *   不写裸 hex、不写 text-white（s5 芽白 / s7 米白 压白字对比度 1.10/1.11，硬 bug）。
 *   打印子树根节点带 .print-root，global.css 已把它整棵锁回亮色，暗色主题下仍是浅稿。
 */
export function SchedulePrintPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === id));
  const stages = useProjectsStore((s) => s.stages.filter((st) => st.projectId === id));
  const tasks = useProjectsStore((s) => s.tasks.filter((t) => t.projectId === id));
  const members = useMembersStore((s) => s.members);
  // v0.7-D：页首守卫只看 role（`role === null` 与 `isRestrictedView(role)` 是**两个档位**，
  // 不可混同）；`memberView` 的口径与 ProjectDetailPage / MonthlyCalendarView **逐字一致**，
  // 不自造第三种判定。
  const { role, currentMember, hydrated } = useRoleGuard();
  const memberView = isRestrictedView(role);

  const [pngBusy, setPngBusy] = useState(false);
  const [pdfHint, setPdfHint] = useState(false);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

  // ⚠️ 所有 Hook 必须在任何条件提前 return 之前调用完成，否则不同 render 路径下
  //    React 记录的 Hook 数量不一致会触发 error #310。
  //
  // 相关阶段（v0.7-D 补漏）：**与 `ProjectDetailPage.tsx:64-77` 同一母本**——
  //   管理员（memberView=false）→ `relatedStageIds=null` → 全量；
  //   成员 → `computeRelatedStageIds` 收窄为「我负责（ownerId）或我名下有任务」的阶段；
  //   未进入 → 空集（但本页页首守卫已先把它重定向掉，接触不到这里）。
  // 补漏背景：放开成员打印时**未同时收窄范围**，导致打印页成了「成员看到项目全量阶段」
  // 的侧门（详情页与月历都收窄，打印页是唯一例外）。本轮按母本补齐。
  const relatedStageIds = useMemo(
    () =>
      computeRelatedStageIds({
        memberView,
        currentMemberId: currentMember?.id ?? null,
        stages,
        tasks,
      }),
    [memberView, currentMember, stages, tasks],
  );

  /** 收窄后的阶段集合：全量（admin）或仅与当前成员相关——后续一切取数都用它，不再直接用 `stages` */
  const visibleStages = useMemo(
    () => (relatedStageIds ? stages.filter((s) => relatedStageIds.has(s.id)) : stages),
    [relatedStageIds, stages],
  );

  const sections = useMemo(
    () => (project ? buildScheduleSections({ project, stages: visibleStages, tasks, members }) : []),
    [project, visibleStages, tasks, members],
  );
  const pages = useMemo(() => paginateSections(sections), [sections]);
  const nowIso = new Date().toISOString();

  // 时间轴甘特视图范围 = 项目计划基线（首帧即建，稳定）
  const viewStart = project ? project.plannedStartAt.slice(0, 10) : '';
  const viewEnd = project ? project.plannedEndAt.slice(0, 10) : '';
  const viewDays = Math.max(totalDaysInclusive(viewStart, viewEnd), 1);
  const offsetDays = (iso: string): number => totalDaysInclusive(viewStart, iso) - 1;
  const bandGeom = (startAt: string, endAt: string): { left: number; width: number } => {
    const lo = offsetDays(startAt);
    const hi = offsetDays(endAt);
    const left = (lo / viewDays) * 100;
    const width = Math.max(((hi - lo + 1) / viewDays) * 100, 2.5);
    return { left, width };
  };
  const monthsList = useMemo<string[]>(() => {
    if (!project) return [];
    const labels: string[] = [];
    let cur = dayjs(viewStart);
    const endYm = viewEnd.slice(0, 7);
    let guard = 0;
    while (cur.format('YYYY-MM') <= endYm && guard < 48) {
      labels.push(cur.format('YYYY年M月'));
      cur = cur.add(1, 'month');
      guard += 1;
    }
    return labels;
  }, [project, viewStart, viewEnd]);

  // bootstrap 完成前先展示加载态（首帧 members 未装载时 role 恒 null，避免误判重定向）
  if (!hydrated) {
    return <div className="py-16 text-center text-mist">正在装载日程表…</div>;
  }

  /**
   * 页内守卫（v0.7-D · 用户已拍板「放开成员打印」）：
   *   · **未进入身份（role === null）** → 仍重定向回首页。没有身份就没有可见范围，
   *     与 `ProjectDetailPage` 的「受限空态」同档，保持现状不放行。
   *   · **成员（受限）** → **允许留在页内只读导出**：本页零数据写操作
   *     （只有 `window.print()` / 读 DOM 导出 PNG / 失败时一条 toast）。
   *   · **管理员** → 行为不变。
   *
   * ⚠️ 但「放开打印权限」**只是权限，不是可见范围**：范围仍按 `computeRelatedStageIds`
   * 收窄（与 ProjectDetailPage / MonthlyCalendarView 同一口径，见上方 `visibleStages`），
   * 客户名（委托方）亦仅管理员可见。放开前打印页只对 admin 开放，故当时的无条件渲染是对的；
   * 放开成员后若不收窄，打印页就成了绕过成员可见性规则的侧门。
   *
   * 旧注释「非管理员重定向（打印内容含全员任务，敏感信息）」已作废。
   *
   * 判据口径：`role === null` ≠「成员」，**不要**把 `role === null` 并进允许档
   * （那等于让未进入身份者也拿到全员排期）。本判定是页内唯一守卫，与 `useRoleGuard()` 同源。
   */
  if (role === null) {
    return <Navigate to="/" replace />;
  }

  if (!project) {
    return (
      <div className="py-16 text-center text-mist">
        <p className="mb-3">未找到该项目。</p>
        <Link to="/" className="text-pine underline underline-offset-2">
          ← 返回项目列表
        </Link>
      </div>
    );
  }

  /**
   * 受限空态（口径与 `ProjectDetailPage.tsx:91-104` 同款）：成员且收窄后**无任何可打印阶段**
   * → 明确告知「与你无关」，**不输出白纸稿**（一张只有表头的空 A4 会被误当成
   * 「这个项目没有阶段」，比看不到更糟）。
   *
   * 判据取 `sections.length`（= 真正会上屏的阶段数，已含 `buildScheduleSections` 内部的
   * `visible !== false` 过滤）而非母本的「相关阶段数」：母本没有 `visible` 这一层，
   * 这里若只数相关阶段，会出现「相关阶段都存在但全被隐藏 → 仍输出空白 A4」的漏网。
   *
   * 注：`role === null` 走不到这里（页首守卫已重定向），故 `memberView` 在此等价于「是成员」，
   * `currentMember` 必非空（`role` 由 `currentMember.roleKind` 派生）——不存在母本里的
   * 「请先点击右上角『进入身份』」那一支。
   */
  if (memberView && sections.length === 0) {
    return (
      <div className="py-16 text-center text-mist">
        <p className="mb-3">该项目的阶段与你无关。</p>
        <Link to="/my-tasks" className="text-pine underline underline-offset-2">
          ← 返回我的任务
        </Link>
      </div>
    );
  }
  const nowText = `${nowIso.slice(0, 10)} ${nowIso.slice(11, 16)}`;
  const startAt = project.plannedStartAt.slice(0, 10);
  const endAt = project.plannedEndAt.slice(0, 10);
  const totalDays = totalDaysInclusive(startAt, endAt);

  const onPrint = (): void => window.print();

  const onExportPdf = (): void => {
    setPdfHint(true);
    window.print();
  };

  const onExportPng = async (): Promise<void> => {
    const els = pageRefs.current.filter((el): el is HTMLDivElement => el !== null);
    if (els.length === 0) return;
    setPngBusy(true);
    try {
      await exportSchedulePngPages(els, schedulePngFileName(project.name));
    } catch {
      useProjectsStore.getState().pushToast('error', 'PNG 导出失败，请改用「打印 / 另存为 PDF」。');
    } finally {
      setPngBusy(false);
    }
  };

  /** 状态胶囊（浅色底 + 深色字：纸面与打印均清晰可读，全部走命名 token） */
  const statusChipCls = (status: StageStatus): string => {
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
  };

  const statusLabel = (status: StageStatus): string => {
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
  };

  return (
    <div className="print-root mx-auto w-full max-w-[900px] px-6 py-8">
      {/* 操作栏（打印时隐藏） */}
      <div className="no-print mb-6 flex flex-wrap items-center gap-2 text-sm">
        <Link
          to={`/project/${project.id}`}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-mist transition-colors hover:bg-sunken hover:text-ink"
        >
          <ArrowLeft size={14} /> 返回项目
        </Link>
        <span className="ml-auto" />
        <span className="text-xs text-mist">共 {pages.length} 页 · A4</span>
        <button
          type="button"
          onClick={onPrint}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-mist transition-colors hover:bg-sunken hover:text-ink"
        >
          <Printer size={14} /> 打印
        </button>
        <button
          type="button"
          onClick={onExportPdf}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-mist transition-colors hover:bg-sunken hover:text-ink"
        >
          <FileText size={14} /> 导出 PDF
        </button>
        <Link
          to={`/project/${project.id}/calendar-print`}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-mist transition-colors hover:bg-sunken hover:text-ink"
        >
          <CalendarDays size={14} /> 月历视图
        </Link>
        <button
          type="button"
          onClick={() => void onExportPng()}
          disabled={pngBusy}
          className="inline-flex items-center gap-1.5 rounded-md bg-pine px-3 py-1.5 text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
        >
          <Download size={14} /> {pngBusy ? '生成中…' : `导出 PNG${pages.length > 1 ? `（${pages.length} 张）` : ''}`}
        </button>
        {pdfHint && (
          <span className="w-full text-xs text-mist">
            已在打印对话框打开：请选择「另存为 PDF」即可导出。
          </span>
        )}
      </div>

      {/* A4 分页纸面（画板 09：宽 900 · paper 底 · line 描边 · padding 56） */}
      {pages.map((pageSections, idx) => (
        <div
          key={idx}
          ref={(el) => {
            pageRefs.current[idx] = el;
          }}
          className="a4-page mx-auto mb-6 flex flex-col"
          style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX, padding: 56 }}
        >
          {/* 打印头部（画板 09：项目名 18/700 + 委托方·周期 13 · 右 打印日期 11） */}
          <header className="flex items-start justify-between border-b border-line pb-3">
            <div>
              <h1 className="text-[18px] font-bold leading-tight text-ink">{project.name}</h1>
              <p className="mt-0.5 text-[13px] text-mist">
                {/* 委托方：仅管理员（与 ProjectDetailPage.tsx:181 同一门控口径）。
                    放开成员打印前此页只对 admin 开放，无条件渲染当时是对的；
                    放开后若不门控，客户名就成了「同一条数据一处屏蔽一处敞开」的洞。 */}
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
                <div className="mb-1.5 flex justify-between text-[11px] text-mist">
                  {monthsList.map((m) => (
                    <span key={m}>{m}</span>
                  ))}
                </div>
                <div className="space-y-1.5">
                  {sections.map((s) => {
                    const g = bandGeom(s.startAt, s.endAt);
                    const outline = stageBandOutline(s.orderIndex, s.colorIndex);
                    return (
                      <div key={s.orderIndex} className="flex items-center gap-3">
                        <div className="flex w-40 shrink-0 items-center gap-1.5">
                          <span
                            className={`schedule-status-dot inline-block h-2.5 w-2.5 shrink-0 rounded-full ${stageSolidClass(s.orderIndex)}`}
                          />
                          <span className="truncate text-[13px] text-ink">{s.name}</span>
                        </div>
                        <div className="relative h-9 flex-1 rounded-lg bg-sunken">
                          <div
                            className={`schedule-bar-segment absolute inset-y-1.5 rounded-md ${stageBandClass(s.orderIndex)}`}
                            style={{
                              left: `${g.left}%`,
                              width: `${g.width}%`,
                              boxShadow: outline.boxShadow,
                            }}
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
                {pageSections.map((s, i) => (
                  <tr key={s.orderIndex} className={i % 2 === 1 ? 'bg-sunken/60' : ''}>
                    <td className="h-[42px] px-3">
                      <span
                        className={`mr-1.5 inline-block h-3 w-3 rounded-sm align-middle ${stageSolidClass(s.orderIndex)}`}
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
                ))}
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

/** 状态图例色点（命名 token，无裸 hex） */
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

export type { StageStatus };
