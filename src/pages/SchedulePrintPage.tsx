import { useMemo, useRef, useState } from 'react';

import { Link, Navigate, useParams } from 'react-router-dom';

import { ArrowLeft, CalendarDays, Download, FileText, Printer } from 'lucide-react';

import { useProjectsStore } from '../store/useProjectsStore';
import { useProjectById, useProjectStages, useProjectTasks } from '../core/project/visibility';
import { ProjectSourceBadge } from '../components/project/ProjectSourceBadge';
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
  /*
   * ── ★ v0.8 T04-A：本页三行原始读改走漏斗的 id 收窄出口（设计 §7.2 #17 特判 / §7.5）──
   *
   * 旧读法是三条**全量订阅 ＋ 就地 filter**：
   *     const project = useProjectsStore((s) => s.projects.find((p) => p.id === id));
   *     const stages  = useProjectsStore((s) => s.stages.filter((st) => st.projectId === id));
   *     const tasks   = useProjectsStore((s) => s.tasks.filter((t) => t.projectId === id));
   * 它是「页面直读 store.projects」这一坏样例（纪律 ①）在打印页的第三处复制品。
   *
   * 现在：`project` 走 `useProjectById`（`visibility.ts` 内唯一的 `s.projects.find`），
   * stages / tasks 走按 projectId 收窄的 `useProjectStages` / `useProjectTasks`。
   *
   * ⚠️ **本页不做 kind 排除**（与 `/project/:id` 详情页同一条口径，设计 §7.3 #17/#18）：
   *   打印路由按 `:id` 直达、没有"列表"可过滤；且删路由会破坏既有深链。
   *   本轮的处置是「人类侧不给 Agent 看板任何打印入口（`ProjectDetailPage` 隐藏按钮）
   *   ＋ 本页渲染 `ProjectSourceBadge` 来源标识」，**不是**在本页 return null。
   *   所以这里传 id、不传 kind —— 与 CalendarPrintPage 的写法逐字一致。
   *
   * 另注：`ProjectSourceBadge` 只吃 `kind`（`Pick<Project,'kind'>`），因此即便项目
   * 尚未装载（`project === undefined`）也只是不渲染徽章，不会抛错。
   */
  const project = useProjectById(id);
  const stages = useProjectStages(id);
  const tasks = useProjectTasks(id);
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

  /**
   * 时间轴甘特视图窗口 = **计划窗口 ∪ 阶段实际起止**。
   *
   * ⚠️ 这里曾是「只用计划窗口」（`viewStart/viewEnd = plannedStart/plannedEnd`），
   *    于是 `left + width = totalDaysInclusive(viewStart, endAt) / viewDays * 100`：
   *      · 阶段 `endAt > plannedEndAt` → **> 100%**；
   *      · 阶段 `startAt < plannedStartAt` → **left < 0**。
   *    色条是 `absolute`、轨道是 `relative`（无 `overflow-hidden`），越界部分就压到
   *    右侧「起止日期」文字上（用户实测截图里 9 个阶段中后 3 个全越界）。
   *    这是**脏数据的常规形态**（阶段改期超出合同工期），不是异常输入。
   *
   * 为什么取 union，而不是照抄 `TimelineView.baseRange` 的「只用阶段跨度」：
   *    打印稿头部 `:177-179` 会打出「周期：X – Y（共 N 天）」这句**合同工期**声明，
   *    轴若只按阶段跨度画，轴与这句声明会不一致；保留计划基线是有意义的信息。
   *    union 下所有阶段都落在区间内 ⇒ 不变式 `0 ≤ left` 且 `left + width ≤ 100` 恒成立。
   *
   * 参照：同一个越界 bug 详情页 `TimelineView.tsx:114-125` 早已修过（改为按阶段实际起止），
   *      月历打印页 `CalendarPrintPage.tsx:165-166` 也是「阶段跨度 ∪ 计划窗口」同款口径——
   *      本页是**第三处独立实现**，此前两处都收了，它没收，所以这个 bug 才复发。
   *
   * ⚠️ 不要在 `bandGeom` 里加 `Math.min(…, 100 - left)` 之类**钳制兜底**：那会把将来的
   *    回归静默吃掉（色条被截断但没人知道），越界重新变得不可观测。窗口扩展后已不可能越界，
   *    真越界就应该被 `tests/schedule-print-band-bounds.spec.tsx` 抓住变红。
   *
   * 注：`viewStart/viewEnd` 依赖 `sections`，而 `monthsList` 的 `useMemo` 依赖
   *     `[project, viewStart, viewEnd]`——两者都是**字符串原始值**，按值比较即会随
   *     `sections` 变化而失效重算，不存在陈旧值问题（无需把 `sections` 塞进该依赖数组）。
   *
   * ⚠️ 取 min/max 前先滤掉**空日期**：`Stage.startAt/endAt` 在类型上是必填，但备份/老数据
   *    仍可能落地 `''`。空串在字符串比较里**最小**（`'' < '2026-01-01'`），一条脏行就会把
   *    `viewStart` 拉成 `''` → `viewDays = NaN` → **整轴所有色条一起 NaN**。旧实现（只用
   *    计划窗口）没有这个放大效应，所以这行过滤是本次改动**自带的防回归**：让脏行只坏它
   *    自己那一行（旧行为），不污染其它行。见 `tests/schedule-print-band-bounds.spec.tsx`
   *    的「单条脏行不得污染整轴」用例。
   */
  const plannedStart = project ? project.plannedStartAt.slice(0, 10) : '';
  const plannedEnd = project ? project.plannedEndAt.slice(0, 10) : '';
  const sectionStarts = sections.map((s) => s.startAt.slice(0, 10)).filter((d) => d !== '');
  const sectionEnds = sections.map((s) => s.endAt.slice(0, 10)).filter((d) => d !== '');
  const viewStart = sectionStarts.length
    ? [plannedStart, ...sectionStarts].reduce((a, b) => (a < b ? a : b))
    : plannedStart;
  const viewEnd = sectionEnds.length
    ? [plannedEnd, ...sectionEnds].reduce((a, b) => (a > b ? a : b))
    : plannedEnd;
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
        {/* ★ §7.3 #17 的「来源标识」：放在 `no-print` 操作栏内 ⇒
            只对**屏幕前的人**可见，不会印进客户稿（打印稿是给客户看的，
            一行「AI 工作区」出现在客户稿上没有任何意义，反而像是排版事故）。
            位置紧挨「返回项目」：用户点进来第一眼就在这一行。 */}
        <ProjectSourceBadge project={project} />
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
