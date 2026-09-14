import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, FolderKanban, PenLine, Save, Settings, Upload } from 'lucide-react';

import { Modal } from '../common/Modal';
import { SettingsDialog } from './SettingsDialog';
import { useBackupIo } from './useBackupIo';
import { SidebarCollapseToggle } from './SidebarCollapseToggle';
import { navItemClass, SidebarNav } from './SidebarNav';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { useHumanProjects, useHumanStages } from '../../core/project/visibility';
import { useUiStore } from '../../store/useUiStore';
import { useLayoutStore, isXlViewport } from '../../store/useLayoutStore';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { stageSolidColor } from '../timeline/stageColors';
import { customStageColor } from '../timeline/stageColorKey';
import {
  projectCoverColorCss,
  resolveProjectAccentColor,
  resolveProjectShortLabel,
} from '../../lib/projectAccent';
import { MEMBER_ROLE_LABELS } from '../../core/types/enums';
import { computeProjectStatus } from '../../lib/progress';
import type { Project, Stage } from '../../core/types/entities';
import { cn } from '../../lib/cn';

/**
 * 左侧边栏（v0.7 · 子系统 ① · N01 / T20，D3 拍板）。
 *
 * ── 三档响应式（严格锁 xl=1280，不引入新 Tailwind 断点）──
 *   ≥1280 (`xl`)   持久左栏：展开 240px / 收起 64px，可切换且**持久化**
 *   1024–1280      持久左栏，默认收起 64px（由 useLayoutStore 的 matchMedia 首启推断）
 *   <1280          **Modal 抽屉**（覆盖层，点击汉堡展开，非悬停——防误触，D3）
 *
 * 实现说明：1024–1280 与 ≥1280 共用同一棵「持久左栏」DOM（Tailwind
 * `hidden xl:flex` 控制显隐），差别只是首启默认值（JS 决定）；
 * <1280 走另一棵「Modal 抽屉」DOM。不用 CSS 断点区分 1024/1280 的原因：
 * D3 要求的是「默认值」差异，纯 CSS 无法表达「默认值 + 用户切换后持久化」的叠加。
 *
 * ── 打印页互斥（R20 · 三重保险）──
 *   ① 路由层：命中 `/project/:id/(schedule|calendar)-print` → **`return null`**
 *   ② CSS 类层：根节点 / 抽屉面板带 `print:hidden`
 *   ③ 全局 CSS 层：global.css `@media print` 段的 `[data-app-sidebar]{display:none}`
 *   注意：两条打印路由的 `max-w-[900px]` 是 A4 预览**刻意保留**的，不并入 1440。
 *
 * ── 抽屉复用 `Modal`（§3.3.4）──
 * 采纳 Modal（`createPortal` + 遮罩点击关闭 + Escape + 焦点圈禁 + body 滚动锁定
 * + `role="dialog"`），与 `TaskDrawer` 同一底座，行为一致。
 *
 * ── 暗色差异（§2.2 暗色差异段 / §5 亮暗对照表）──
 *   侧栏底色走 `bg-paper` token，暗色自动解析为 `#1F2126`（--paper-rgb 由
 *   `<html data-theme="dark">` 覆盖），不写死 hex。
 *   激活导航项**不能沿用 `bg-pine-soft`**：规格三处独立指明暗色下该底要改成
 *   **凹陷 `sunken` `#0F1217`**（§1.1 用途表「激活态导航项」、§2.2「用凹陷而非浅靛」、
 *   §5 亮暗对照表「导航激活项 #EFF0FE → #0F1217」）。原因见 SidebarNav.tsx 的注释。
 *   项目列表选中项与身份行同样是 sunken 底（画板 12 标注 `#0F1217`），
 *   这两处走 token 自动换肤，无需 dark:。
 *   暗色下「内边距 12→16、gap 10→8」是**非颜色**属性，已在 SidebarNav.tsx 的
 *   navItemClass 里用 `dark:` 显式接线（此前因 dark 变体失效而未生效）。
 *
 * ── 新结构（v0.7 §2.2 / §2.3）──
 *   展开态三段式：头部（Logo+品牌+Beta+折叠）/ 主导航+项目列表 / 底部（设置+备份+新建+身份）。
 *   收起态：Logo(/logo.png) + 展开键 + 分隔 + 4 图标导航 + 3 枚项目方块（竖条 + 简称）+
 *   弹性占位 + 设置/新建/身份。所有收起态元素带 `title` tooltip。
 *
 * ── v0.7 B1 · 折叠态增强：两处**有意偏离画板**，在此显式备案（便于日后对稿时不被当成 bug）──
 *   ① 折叠态项目方块**加文字简称**（`shortLabel` ?? 项目名首字）：画板 03 只画了色条，
 *      但 64px 栏里 3 条同阶段色的条彼此不可辨，加简称是可用性刚需。
 *      只有折叠态加；展开态仍只显示正式项目名（避免同一项目出现两个名字）。
 *   ② 色条/方块的**颜色可被项目级自定义色覆盖**（`Project.coverColor`）：
 *      画板只规定「用阶段色」，但同阶段项目必然撞色，故支持覆盖式取色。
 *      两处的取色与文字回落**唯一出处**都是 `src/lib/projectAccent.ts`：
 *      白名单 token、零裸 hex、随 <html data-theme> 自动换肤。
 */

/** 打印路由正则：与 main.tsx 的两条 *-print 子路由严格对应 */
const PRINT_ROUTE_RE = /\/project\/[^/]+\/(schedule|calendar)-print$/;

/** 侧栏容器 id（折叠开关的 aria-controls 目标） */
const SIDEBAR_ID = 'app-sidebar';

/**
 * 打印路由守卫（R20 保险 ① · 路由层）。命中打印路由 → 不渲染侧栏（DOM 根本不生成），
 * 避免用户在屏幕上浏览打印页时侧栏挡住 A4 预览（PRD §3.7.1 要求屏幕态也不显示）。
 */
export function Sidebar(): JSX.Element | null {
  const { pathname } = useLocation();
  if (PRINT_ROUTE_RE.test(pathname)) return null;
  return <SidebarBody pathname={pathname} />;
}

/**
 * 侧栏主体（仅在非打印路由挂载）。`pathname` 由外层传入，本组件不再自行读 location——
 * 单一份路径来源，避免两处 useLocation 在过渡态下不一致。
 */
function SidebarBody({ pathname }: { pathname: string }): JSX.Element {
  const { isAdmin, currentMember } = useRoleGuard();
  const openManualForm = useUiStore((s) => s.openManualForm);

  const sidebarExpanded = useLayoutStore((s) => s.sidebarExpanded);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const drawerOpen = useLayoutStore((s) => s.sidebarDrawerOpen);
  const closeDrawer = useLayoutStore((s) => s.closeSidebarDrawer);
  const setSidebarExpanded = useLayoutStore((s) => s.setSidebarExpanded);

  /*
    ★ v0.8 T04-A · §7.2 #11 接线（**P** 接法）。

    侧栏的 `projects` 有**三个**消费点，全部派生自同一份数据，所以一处收口三处同净：
      · 展开态项目列表（`projects.slice(0, visibleProjectCount(...))`）；
      · 截断提示「还有 N 个项目」的 N（`projects.length`）；
      · 收起态顶部 3 枚项目方块（`projects.slice(0, 3)`）。
    若这里不过滤，Agent 看板会**同时**出现在这三处 —— 尤其收起态那 3 枚方块是
    "最显眼的位置"，用户一眼就会觉得两个工作区混在一起了。

    ⚠️ 为什么连 `stages` 也要经漏斗（本行看起来"只是拿来算色号"）：
    `projectStageOrder(p.id)` 从 `stages` 里取该项目当前阶段的 `orderIndex` 来算色条。
    Agent 看板的阶段若混进来，虽然只影响取色、不泄漏名称，但**守卫纪律是
    "页面/组件禁止直接读 store"**（设计 §7.1 纪律 1）—— 而且这里正是最容易被
    复制粘贴出去当"坏样例"的地方（§7.5 的教训）。走漏斗是免费的。
  */
  const projects = useHumanProjects();
  const stages = useHumanStages();

  const { save, pick, fileInput, confirmDialog } = useBackupIo();
  const { status } = useUpdateCheck();
  const hasUpdate = status === 'has-update';

  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * 项目列表是否已「展开全部」（v0.7 增量 · 用户反馈「还有 N 个项目…」点不到）。
   * 默认 false：仍按 SIDEBAR_PROJECT_LIMIT 截断（画板 02/04 的截断是**刻意设计**，
   * 不是 bug）；点一下截断提示即展开全量。状态在组件内，换页不重置——
   * 用户主动展开过就认为他想一直看到全部，避免每次跳页都被收回。
   */
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  /**
   * 是否达到 xl（≥1280）。用于决定「持久栏是否真正参与布局」——虽显隐由
   * `hidden xl:flex` 承担，但折叠开关语义需 JS 侧同一口径。
   */
  const [xl, setXl] = useState<boolean>(() => isXlViewport());

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1280px)');
    const onChange = (e: MediaQueryListEvent): void => setXl(e.matches);
    setXl(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** <xl 时强制收起（R13：xl 以下强制折叠，忽略持久值，但不污染持久值本身） */
  const collapsed = xl ? !sidebarExpanded : true;

  useEffect(() => {
    if (xl) return;
    document.documentElement.dataset.sidebarCollapsed = 'true';
  }, [xl]);

  /** 换页时自动收起抽屉（<1280），否则点导航跳转后抽屉仍盖在新页面上 */
  useEffect(() => {
    closeDrawer();
  }, [pathname, closeDrawer]);

  /** 折叠开关：≥xl 切换折叠态；<xl 切换抽屉（同一按钮在窄屏表达"打开导航"） */
  const onToggleCollapse = (): void => {
    if (xl) toggleSidebar();
    else setSidebarExpanded(!sidebarExpanded);
  };

  const currentProjectId = matchProjectId(pathname);
  /** 今日 ISO（YYYY-MM-DD，UTC）。仅供侧栏状态点的临期估算，误差一日内可接受 */
  const todayIso = new Date().toISOString().slice(0, 10);

  /** 侧栏主体内容（抽屉与持久栏共用同一棵子树，避免两份实现漂移） */
  const body = ({ inDrawer }: { inDrawer: boolean }): JSX.Element => {
    const isCollapsed = inDrawer ? false : collapsed;
    return (
      <div className="flex h-full min-h-0 flex-col">
        {isCollapsed ? renderCollapsed() : renderExpanded(inDrawer)}
      </div>
    );
  };

  /** 展开 / 抽屉态：头部 + 主导航 + 项目列表 + 底部（§2.2） */
  const renderExpanded = (inDrawer: boolean): JSX.Element => {
    return (
      <>
        {/* 头部：Logo + 品牌 + Beta + 折叠键（行高 40，gap 10，横向 padding 12） */}
        <div className="flex h-10 shrink-0 items-center gap-2.5 px-3">
          <Link
            to="/"
            aria-label="ID Plan 首页"
            className="flex min-w-0 items-center gap-2.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
          >
            <img
              src="/logo.png"
              alt="ID Plan logo"
              aria-hidden
              className="h-8 w-8 shrink-0 rounded-sm object-cover shadow-soft"
            />
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-display text-[15px] font-semibold leading-5 text-ink">
                ID Plan
              </span>
              <BetaBadge />
            </span>
          </Link>
          {/* 抽屉内由 Modal 遮罩/Esc 关闭，不渲染折叠键；持久栏才需要 */}
          {!inDrawer && (
            <div className="ml-auto">
              <SidebarCollapseToggle
                collapsed={false}
                onToggle={onToggleCollapse}
                controlsId={SIDEBAR_ID}
              />
            </div>
          )}
        </div>

        {/* 可滚动区：主导航 + 项目列表（内容多时独立滚动，底部动作区固定不动） */}
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {/* 主导航（§2.2：纵向 gap 4；每项高 40、横向 padding 12、gap 10、圆角 12） */}
          <SidebarNav collapsed={false} drawer={inDrawer} />

          {/* 项目列表（§2.2）：容器 gap 2、padding 4；标题行高 28「我的项目」11/500 mist；
              条目高 36、padding 8、gap 8、圆角 12，含阶段色条 + 项目名 + 状态点 */}
          {projects.length > 0 && (
            <div className="mt-3 px-3">
              {/*
                标题行（画板 02 / 04「项目列表标题行」fill_container×28 [row pad=8]）：
                左「我的项目」11/500 mist，右「查看全部」11/Regular **主色**（画板裸 hex #6366F1 = pine）。

                ⚠️ 「查看全部」不是本轮新造：它是**画板本来就有的**（画板 02 L52-53 与画板 04 L52-53
                各一次，文案逐字为「查看全部」）。此前实现漏掉了它，于是「被截断的项目怎么看到」
                在侧栏里根本没有出口 —— 本轮补的就是这个缺口。
                为什么指向 `/` 而不是新开一个「全部项目」页：全站没有该路由，而首页
                HomeRouteGuard 对成员会重定向到 /member-board（成员看板），
                这正是成员该看到的「全部」形态，故一个 to="/" 同时满足两种身份。
              */}
              <div className="flex h-7 items-center justify-between pb-1">
                <span className="text-[11px] font-medium text-mist">项目</span>
                <Link
                  to="/"
                  data-sidebar-see-all=""
                  title="查看全部项目"
                  className="rounded-sm text-[11px] text-pine outline-none transition-colors hover:text-pine-deep focus-visible:ring-2 focus-visible:ring-pine/40"
                >
                  查看全部
                </Link>
              </div>
              {/*
                ⚠️ 容器必须可滚动，否则「展开全部」会把侧栏底部（设置/备份/新建/身份行）挤出视口。
                已由外层 `min-h-0 flex-1 overflow-y-auto py-1`（可滚动区）承担，高度约束在
                flex 布局下由 `flex-1 + min-h-0` 共同给出；展开后条目多于此区高度时内部滚动。
              */}
              <ul className="flex flex-col gap-0.5">
                {projects.slice(0, visibleProjectCount(projects.length, projectsExpanded)).map((p) => {
                  const active = currentProjectId === p.id;
                  const accentStage = projectAccentStage(p.id, stages);
                  const accentPaint = customStageColor(accentStage?.customColor ?? null);
                  return (
                    <li key={p.id}>
                      <Link
                        to={`/project/${p.id}`}
                        title={p.name}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 outline-none transition-colors',
                          'focus-visible:ring-2 focus-visible:ring-pine/40',
                          active ? 'bg-sunken' : 'hover:bg-sand',
                        )}
                      >
                        {/*
                          色条 4×16：**覆盖式**取色 —— 项目设了自定义色（coverColor，
                          白名单 token）就用它，否则回退该项目当前阶段的 main 色（实心块）。

                          ★ 有意偏离画板（B1 已备案）：画板 03 只规定「用阶段色」，
                            但两个同阶段的项目必然撞色、无法区分，故引入项目级自定义色。
                            值域白名单与取色分支的唯一出处是 src/lib/projectAccent.ts；
                            本处只做取值，绝不在此再写一遍 `coverColor || stage` 回落
                            （否则折叠态/展开态/项目卡三处会各有一套口径）。

                          ★ v0.8 BUG-06：阶段色那一路接上自定义色通路（色值 + 属性成对）。
                          注意属性**不能无条件铺**：`resolveProjectAccentColor` 是覆盖式的，
                          coverColor 命中时阶段色根本不参与，此时挂 data-stage-key 既语义错、
                          又污染判定 ⇒ 与色值按同一条件（`projectCoverColorCss(...) === null`）决定。
                        */}
                        <span
                          aria-hidden
                          data-project-accent-bar="expanded"
                          className="h-4 w-1 shrink-0 rounded-[2px]"
                          style={{
                            backgroundColor: resolveProjectAccentColor(
                              p.coverColor,
                              stageSolidColor(
                                accentStage?.orderIndex ?? 1,
                                null,
                                accentStage?.customColor ?? null,
                              ),
                            ),
                          }}
                          {...(projectCoverColorCss(p.coverColor) === null ? accentPaint.attrs : {})}
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{p.name}</span>
                        {/* 状态点 6×6：正常 moss / 临期 amber / 逾期 clay */}
                        <span
                          aria-hidden
                          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', projectStatusDotClass(p, stages, todayIso))}
                        />
                      </Link>
                    </li>
                  );
                })}
                {/*
                  截断提示（v0.7 增量 · 修真 bug）。
                  原实现是一个**纯文本 <li>，零交互** —— 用户有 9 个项目，第 9 个起
                  根本没渲染，而唯一的线索「还有 1 个项目…」点不动，等于项目不可达。
                  现在改为按钮：点击即展开全量（见 projectsExpanded）。
                  文案与视觉保持原样（11px mist 行高不变），只补可点性 + 展开后消失；
                  用 pine 主色 + ChevronDown 让「可点」这件事可见——否则修完仍像死文本。
                */}
                {projects.length > SIDEBAR_PROJECT_LIMIT && !projectsExpanded && (
                  <li>
                    <button
                      type="button"
                      data-sidebar-more-projects=""
                      onClick={() => setProjectsExpanded(true)}
                      aria-expanded={projectsExpanded}
                      title={`展开显示全部 ${projects.length} 个项目`}
                      className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-[11px] text-pine outline-none transition-colors hover:bg-sand focus-visible:ring-2 focus-visible:ring-pine/40"
                    >
                      <ChevronDown size={12} aria-hidden className="shrink-0" />
                      <span className="truncate">
                        还有 {projects.length - SIDEBAR_PROJECT_LIMIT} 个项目…
                      </span>
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        {/* 底部固定区（§2.2：设置/保存备份/加载备份 + 新建项目 + 身份行，纵向 gap 4） */}
        <div className="shrink-0 space-y-1 border-t border-line px-3 py-3">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="设置"
            title="设置（导出日志 / 清空日志）"
            className={cn(navItemClass(false, false, inDrawer), 'relative')}
          >
            <span className="relative inline-flex shrink-0">
              <Settings size={18} className="text-mist" aria-hidden />
              {/*
                「有新版本可用」红点 8×8 / 圆角 9999 / fill=clay(clay 即画板裸 hex
                #EF4444) —— 画板 02 侧栏设置项结构里**本来就有**这一枚，属**回归画板**
                而非新增设计。ring-paper 让红点从设置图标上"浮"起来（暗色自动换肤）。

                ★ 为什么红点落在这里（P0-17 配套的迁移）：`status === 'has-update'` 仅由
                  **桌面端主进程**推送，而此前唯一的渲染点是 `MobileMoreMenu`（本就只在
                  窄屏渲染）。本轮把 ⋮ 收窄到手机档后，桌面端推送将**再无可见落点**——
                  等于静默吃掉一个既有提示。故桌面/平板可见的落点定在侧栏「设置」项。
                  窄屏那份保留在 `MobileMoreMenu`（手机档仍渲染 ⋮）。
              */}
              {hasUpdate && (
                <span
                  data-update-dot="expanded"
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-clay ring-2 ring-paper"
                  aria-label="有新版本可用"
                />
              )}
            </span>
            <span className="truncate text-[13px] text-ink">设置</span>
          </button>

          {/* 备份两按钮：**管理员专属**（与原 TopBar 一致，不放开权限口径） */}
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => void save()}
                aria-label="保存备份"
                title="保存备份"
                className={cn(navItemClass(false, false, inDrawer))}
              >
                <Save size={18} className="shrink-0 text-mist" aria-hidden />
                <span className="truncate text-[13px] text-ink">保存备份</span>
              </button>
              <button
                type="button"
                onClick={() => pick()}
                aria-label="加载备份"
                title="加载备份"
                className={cn(navItemClass(false, false, inDrawer))}
              >
                <Upload size={18} className="shrink-0 text-mist" aria-hidden />
                <span className="truncate text-[13px] text-ink">加载备份</span>
              </button>
            </>
          )}

          {/* 新建项目：管理员 + 项目相关页（沿用原 TopBar 的 isAdmin && onProjectPage 口径） */}
          {isAdmin && onProjectPage(pathname) && (
            <button
              type="button"
              onClick={openManualForm}
              aria-label="新建项目"
              title="新建项目"
              className="btn-aura flex w-full items-center justify-center gap-2.5 rounded-2xl px-3 py-2.5 text-base text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
            >
              <PenLine size={18} className="shrink-0" aria-hidden />
              <span className="truncate">新建项目</span>
            </button>
          )}

          {/* 身份行（§2.2：高 52、sunken 底、圆角 12、头像 28 + 姓名/角色 13） */}
          {currentMember && (
            <div
              className="flex h-[52px] items-center gap-2 rounded-md bg-sunken px-2"
              title={`${currentMember.name} · ${MEMBER_ROLE_LABELS[currentMember.roleKind]}`}
            >
              {/*
                头像底色来自数据字段（Member.avatarColor），非设计 token——故此处允许裸 hex
                仅作 fallback（与 MemberIdentityPicker 一致），避免使用未上传头像时的占位灰。
              */}
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] text-white"
                style={{ backgroundColor: currentMember.avatarColor ?? '#8A959E' }}
                aria-hidden
              >
                {(currentMember.name ?? '?')[0]}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] text-ink">{currentMember.name}</span>
                <span className="truncate text-[11px] text-mist">
                  {MEMBER_ROLE_LABELS[currentMember.roleKind]}
                </span>
              </span>
            </div>
          )}
        </div>
      </>
    );
  };

/**
 * 收起态（§2.3 · 宽 64）：Logo(/logo.png) + 展开键 + 分隔 + 4 图标导航 +
 * 3 枚项目方块（竖条 + 简称）+ 占位 + 设置/新建/身份
 */
  const renderCollapsed = (): JSX.Element => {
    const top3 = projects.slice(0, 3);
    return (
      <>
        {/* Logo（真图 /logo.png，40×40 圆角 12） + 展开键（40×40 sunken 圆角 12） */}
        <div className="flex shrink-0 flex-col items-center gap-2 py-3">
          <Link
            to="/"
            title="ID Plan v0.7 Beta"
            aria-label="ID Plan 首页"
            className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
          >
            {/*
              ★ v0.7 B1：折叠态 logo 由写死的文本「P」换成真图 /logo.png，
                与展开态头部**同一素材**（此前两态各用一套：展开态图文、折叠态一个字母）。
                h-10 w-10 = 40×40、rounded-md = 12px —— 注意本仓库圆角刻度被重映射
                （tailwind.config.ts：md=12、xl=16，与 Tailwind 默认值不同），
                故「圆角 12」要写 rounded-md 而非 rounded-xl。
                object-cover + overflow-hidden 兜住任意比例素材，不让它撑破圆角。
            */}
            <img
              src="/logo.png"
              alt="ID Plan logo"
              aria-hidden
              className="h-10 w-10 shrink-0 rounded-md object-cover"
            />
          </Link>
          <SidebarCollapseToggle collapsed onToggle={onToggleCollapse} controlsId={SIDEBAR_ID} />
        </div>

        {/* 分隔线 40×1 */}
        <div className="mx-auto my-1 h-px w-10 bg-line" />

        {/* 4 个导航图标键（40×40 圆角 12，激活态 bg-pine-soft） */}
        <SidebarNav collapsed />

        {/* 3 枚项目方块（40×36 圆角 12）：竖条 4×20 + 简称文字（两处偏离见文件头备案） */}
        {top3.length > 0 && (
          <div className="flex flex-col items-center gap-1 py-2">
            {top3.map((p) => {
              const accentStage = projectAccentStage(p.id, stages);
              const accentPaint = customStageColor(accentStage?.customColor ?? null);
              const shortLabel = resolveProjectShortLabel(p.name, p.shortLabel);
              return (
                <Link
                  key={p.id}
                  to={`/project/${p.id}`}
                  title={p.name}
                  aria-label={p.name}
                  className="flex h-9 w-10 items-center justify-center gap-1 rounded-md bg-sunken outline-none transition-colors hover:bg-line focus-visible:ring-2 focus-visible:ring-pine/40"
                >
                  {/* 竖条颜色：覆盖式（自定义方块色优先，否则阶段 main 色；零裸 hex）
                      v0.8 BUG-06：阶段色那一路接自定义色通路，属性与展开态同条件（见上） */}
                  <span
                    aria-hidden
                    data-project-accent-bar="collapsed"
                    className="h-5 w-1 shrink-0 rounded-[2px]"
                    style={{
                      backgroundColor: resolveProjectAccentColor(
                        p.coverColor,
                        stageSolidColor(
                          accentStage?.orderIndex ?? 1,
                          null,
                          accentStage?.customColor ?? null,
                        ),
                      ),
                    }}
                    {...(projectCoverColorCss(p.coverColor) === null ? accentPaint.attrs : {})}
                  />
                  {/*
                    ★ 有意偏离画板 ①：画板 03 的折叠态方块里**只有色条、没有文字**。
                      但 64px 栏里 3 条同阶段色的条彼此不可辨，故补简称（可用性刚需）。
                      仅折叠态加：展开态仍只显示正式项目名，避免同一项目出现两个名字。
                      文字口径统一走 resolveProjectShortLabel（shortLabel ?? 项目名首字）。
                      data-project-short-label 供验收用例读取「实际渲染出的简称」，
                      免得测试去猜 max-w 下的截断结果。
                  */}
                  <span
                    data-project-short-label={shortLabel}
                    className="max-w-[24px] truncate text-[12px] font-medium leading-4 text-ink"
                  >
                    {shortLabel}
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {/* 弹性占位：把设置 + 新建压到底部 */}
        <div className="flex-1" />

        {/* 设置 + （管理员）备份 + 新建 + 身份头像 */}
        <div className="flex shrink-0 flex-col items-center gap-1 py-2">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="设置"
            title="设置"
            className="relative flex h-10 w-10 items-center justify-center rounded-md text-mist outline-none transition-colors hover:bg-sand focus-visible:ring-2 focus-visible:ring-pine/40"
          >
            <Settings size={18} aria-hidden />
            {/* 更新红点（收起态）：与展开态同一枚 8×8 clay 圆点，落点改为图标右上角。
                展开态靠文字右侧、收起态靠图标角标——两态都要有，否则用户折叠侧栏后
                红点凭空消失（V1-24 明确要求展开态 + 收起态各一次）。 */}
            {hasUpdate && (
              <span
                data-update-dot="collapsed"
                className="absolute right-1 top-1 h-2 w-2 rounded-full bg-clay ring-2 ring-paper"
                aria-label="有新版本可用"
              />
            )}
          </button>
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => void save()}
                aria-label="保存备份"
                title="保存备份"
                className="flex h-10 w-10 items-center justify-center rounded-md text-mist outline-none transition-colors hover:bg-sand focus-visible:ring-2 focus-visible:ring-pine/40"
              >
                <Save size={18} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => pick()}
                aria-label="加载备份"
                title="加载备份"
                className="flex h-10 w-10 items-center justify-center rounded-md text-mist outline-none transition-colors hover:bg-sand focus-visible:ring-2 focus-visible:ring-pine/40"
              >
                <Upload size={18} aria-hidden />
              </button>
            </>
          )}
          {isAdmin && onProjectPage(pathname) && (
            <button
              type="button"
              onClick={openManualForm}
              aria-label="新建项目"
              title="新建项目"
              className="btn-aura flex h-10 w-10 items-center justify-center rounded-md text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
            >
              <PenLine size={18} aria-hidden />
            </button>
          )}
          {currentMember && (
            <Link
              to="/"
              title={`${currentMember.name} · ${MEMBER_ROLE_LABELS[currentMember.roleKind]}`}
              aria-label={currentMember.name}
              className="mt-1 flex h-8 w-8 items-center justify-center rounded-full text-[13px] text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
              style={{ backgroundColor: currentMember.avatarColor ?? '#8A959E' }}
            >
              {(currentMember.name ?? '?')[0]}
            </Link>
          )}
        </div>
      </>
    );
  };

  return (
    <>
      {/* ── 持久左栏（≥xl；<xl 由 hidden xl:flex 隐藏，改走下方抽屉）── */}
      <aside
        id={SIDEBAR_ID}
        data-app-sidebar=""
        aria-label="主导航侧边栏"
        className={cn(
          'app-sidebar hidden shrink-0 xl:flex',
          'glass-strong print:hidden',
          // z-30（§3.3.4 分层）：低于 Modal(center z-70 / right z-60)，高于内容区
          'sticky top-0 z-30 h-screen rounded-none border-y-0 border-l-0',
        )}
      >
        <div className="flex h-full w-full min-w-0 flex-col">{body({ inDrawer: false })}</div>
      </aside>

      {/* ── 抽屉（<xl）：复用 Modal placement="right"（§3.3.4）──
          画板 10：宽 264、内 padding 16、导航项高 44；手机（<768）全屏（w-full） */}
      <Modal
        open={!xl && drawerOpen}
        onClose={closeDrawer}
        placement="right"
        ariaLabel="导航菜单"
      >
        <div
          data-app-sidebar=""
          className="glass-strong h-full w-[264px] max-w-[100vw] overflow-hidden rounded-l-[20px] border-0 p-4 print:hidden max-md:w-full"
        >
          {body({ inDrawer: true })}
        </div>
      </Modal>

      {/* 设置抽屉（侧栏底部入口） */}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* 备份 IO 的隐藏 file input + 确认对话框（与 useBackupIo 同一份逻辑） */}
      {fileInput}
      {confirmDialog}
    </>
  );
}

/** Beta 徽标（规格统一：高 18、圆角 8、横向 padding 6、文字 10/500、pine-soft 底 + pine 字） */
function BetaBadge(): JSX.Element {
  return (
    <span
      title="内测版本"
      className="inline-flex h-[18px] shrink-0 items-center rounded-sm bg-pine-soft px-1.5 text-[10px] font-medium text-pine"
    >
      Beta
    </span>
  );
}

/**
 * 项目状态点配色（§2.2）：正常 `bg-moss` / 临期 `bg-amber` / 逾期 `bg-clay`。
 * 数据模型仅有 4 态（in_progress / completed / overdue / not_started），无「临期」——
 * 用「进行中且距计划结束 ≤ 7 天」近似临期，其余归为正常（绿）。
 */
function projectStatusDotClass(project: Project, stages: Stage[], todayIso: string): string {
  const s = computeProjectStatus(project, stages, todayIso);
  if (s === 'overdue') return 'bg-clay';
  if (s === 'in_progress') {
    const end = Date.parse(project.plannedEndAt);
    const today = Date.parse(todayIso);
    if (!Number.isNaN(end) && !Number.isNaN(today) && end - today <= 7 * 86_400_000) {
      return 'bg-amber'; // 临期
    }
  }
  return 'bg-moss'; // 正常：进行中未临期 / 未开始 / 已完成
}

/* ------------------------------ 纯函数辅助 ------------------------------ */

/**
 * 侧栏项目列表上限（超出提示「还有 N 个」，避免侧栏被长列表淹没）。
 * 画板 02/04 只画了 5 条 + 截断观感，未规定具体数字；8 是既有取值，本轮不改。
 */
export const SIDEBAR_PROJECT_LIMIT = 8;

/**
 * 侧栏项目列表**实际渲染**的条目数。
 * 未展开 → 封顶 SIDEBAR_PROJECT_LIMIT（画板口径）；已展开 → 全量。
 * 抽成纯函数是为了让「第 9 个到底渲没渲染」这件事可被单测直接断言，
 * 而不必去猜 DOM（此前正是这里把第 9 个起彻底吞掉，且没有任何可见/可测信号）。
 */
export function visibleProjectCount(total: number, expanded: boolean): number {
  if (total <= 0) return 0;
  return expanded ? total : Math.min(total, SIDEBAR_PROJECT_LIMIT);
}

/** 从 pathname 提取当前项目 id（`/project/:id[/...]`），非项目路由返回 null */
export function matchProjectId(pathname: string): string | null {
  const m = /^\/project\/([^/]+)/.exec(pathname);
  return m ? m[1] : null;
}

/** 项目相关页判定（沿用原 TopBar `onHome || pathname.startsWith('/project')` 口径） */
export function onProjectPage(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/project');
}

/**
 * 该项目「当前阶段」的最小取色信息（取最早 orderIndex）→ 供彩条选色；无阶段返回 `null`。
 *
 * ── v0.8 BUG-06：为什么返回形状从 `number` 改成对象 ──
 * 彩条要走自定义色通路就必须同时拿到 `customColor`，而旧签名只吐 `orderIndex`。
 * 返回 `{ orderIndex, customColor }` 是**刻意不**带回 `colorIndex`：调用点改造前是
 * `resolveStageColorIndex(orderIndex)`（单参 ⇒ 按 orderIndex 夹取），带 colorIndex 会在
 * `colorIndex !== orderIndex` 的阶段上静默换色，超出「补接」范围。
 * （`tests/` 全目录零引用 ⇒ 本次改签名无测试锁。）
 */
export function projectAccentStage(
  projectId: string,
  stages: Array<{ projectId: string; orderIndex: number; customColor?: string | null }>,
): { orderIndex: number; customColor: string | null } | null {
  const own = stages.filter((s) => s.projectId === projectId);
  if (own.length === 0) return null;
  const minOrder = Math.min(...own.map((s) => s.orderIndex));
  const first = own.find((s) => s.orderIndex === minOrder) ?? own[0]!;
  return { orderIndex: minOrder, customColor: first.customColor ?? null };
}

/**
 * 侧栏项目列表是否可见（导出供 UI 断言/测试复用）。
 * 收起态不渲染项目列表（64px 无空间），展开态且项目非空时渲染。
 */
export function shouldRenderProjectList(collapsed: boolean, projectCount: number): boolean {
  return !collapsed && projectCount > 0;
}

/** 保留 FolderKanban 图标引用：项目列表区块的语义图标（当前用彩条替代，留作 i18n/空态扩展） */
export const SIDEBAR_PROJECT_ICON = FolderKanban;
