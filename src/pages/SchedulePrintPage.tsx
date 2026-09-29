import { useMemo, useRef, useState } from 'react';

import { Link, Navigate, useParams } from 'react-router-dom';

import { ArrowLeft, CalendarDays, Download, FileText, Printer } from 'lucide-react';

import { useProjectsStore } from '../store/useProjectsStore';
import { useProjectById, useProjectStages, useProjectTasks } from '../core/project/visibility';
import { ProjectSourceBadge } from '../components/project/ProjectSourceBadge';
import { SchedulePaper } from '../components/print/SchedulePaper';
import { useSchedulePaperData } from '../components/print/useSchedulePaperData';
import { exportSchedulePngPages, schedulePngFileName } from '../lib/schedule-print';

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
  // 纸面数据与算法收敛单一 hook（0.8.4：与打印预览面板共用，防第二份算法副本）
  const d = useSchedulePaperData(id);
  const project = d.project;
  const pages = d.pages;
  const sections = d.sections;
  const bandGeom = d.bandGeom;
  const monthTicks = d.monthTicks;
  const nowText = d.nowText;
  const startAt = d.startAt;
  const endAt = d.endAt;
  const totalDays = d.totalDays;
  const role = d.role;
  const hydrated = d.hydrated;
  const memberView = d.memberView;

  // 独立路由模式自持的导出/打印状态（应用内预览面板由 PrintPreviewDialog 自持）
  const [pngBusy, setPngBusy] = useState(false);
  const [pdfHint, setPdfHint] = useState(false);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

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
      await exportSchedulePngPages(els, schedulePngFileName(project?.name ?? 'project'));
    } catch {
      useProjectsStore.getState().pushToast('error', 'PNG 导出失败，请改用「打印 / 另存为 PDF」。');
    } finally {
      setPngBusy(false);
    }
  };

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

  return (
    <>
      {/* 独立路由模式的操作栏（打印时隐藏）；应用内预览面板模式由 PrintPreviewDialog 自绘工具条/动作条 */}
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
        {/* ★ A13（PRD v0.8 增量稿:179 / 设计文档验收标准 3）：「打印前显示预计页数」。
            文案必须是「**预计**」而不是「共」—— `pages` 来自 `paginateSections()`，
            而它依据的是 `estimateSectionHeight()` 的**高度估算**（常量近似，不是浏览器实际
            排版高度），故这是预估值而非承诺值。用户据此判断要不要少打几个阶段，
            写成「共」会在估算落空时变成一句假话。
            ⚠️ 数字仍取 `pages.length` 本身（同一 `useMemo` 的产物，见 :109）——
            「预计」只修饰语义，**不是**另算一个近似值；另算必然与真实分页漂移。
            下方 `导出 PNG（N 张）` 保持原样：它数的是**实际会产出的文件数**
            （`exportSchedulePngPages` 逐页导，页数就是 `pages.length`），是确定值不用「预计」。 */}
        <span className="text-xs text-mist">预计 {pages.length} 页 · A4</span>
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

      {/* 纸面：与打印预览面板共用同一组件（0.8.4 A 方案） */}
      <SchedulePaper
        project={project}
        pages={pages}
        sections={sections}
        bandGeom={bandGeom}
        monthTicks={monthTicks}
        nowText={nowText}
        startAt={startAt}
        endAt={endAt}
        totalDays={totalDays}
        role={role}
        pageRef={(idx) => (el: HTMLDivElement | null) => {
          pageRefs.current[idx] = el;
        }}
      />
    </>
  );
}

