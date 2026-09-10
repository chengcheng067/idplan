import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FolderKanban, PenLine, Save, Settings, Upload } from 'lucide-react';

import { Modal } from '../common/Modal';
import { SettingsDialog } from './SettingsDialog';
import { useBackupIo } from './useBackupIo';
import { SidebarCollapseToggle } from './SidebarCollapseToggle';
import { navItemClass, SidebarNav } from './SidebarNav';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useUiStore } from '../../store/useUiStore';
import { useLayoutStore, isXlViewport } from '../../store/useLayoutStore';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { resolveStageColorIndex } from '../../core/template/stage-fallback';
import { STAGE_BAR_COLORS } from '../timeline/stageColors';
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
 * ── 暗色差异（§5 / 画板 22）──
 *   侧栏底色走 `bg-paper` token，暗色自动解析为 `#1F2126`（--paper-rgb 由
 *   `[data-theme="dark"]` 覆盖），不写死 hex。激活导航项底沿用 `bg-pine-soft`：
 *   该 token 在暗色下解析为 `#24264A`（= 画板 22 的 Agent 激活底），与规格一致。
 *   注：tailwind.config.ts 未配 `darkMode`（项目用 `<html data-theme>` 而非
 *   Tailwind `class="dark"`），故 `dark:` 变体不可用；暗色下「内边距 12→16、
 *   gap 10→8」的微调按纪律跳过（见报告 B3）。
 *
 * ── 新结构（v0.7 §2.2 / §2.3）──
 *   展开态三段式：头部（Logo+品牌+Beta+折叠）/ 主导航+项目列表 / 底部（设置+备份+新建+身份）。
 *   收起态：Logo("P") + 展开键 + 分隔 + 4 图标导航 + 3 项目彩条 + 弹性占位 +
 *   设置/新建/身份。所有收起态元素带 `title` tooltip。
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

  const projects = useProjectsStore((s) => s.projects);
  const stages = useProjectsStore((s) => s.stages);

  const { save, pick, fileInput, confirmDialog } = useBackupIo();
  const { status } = useUpdateCheck();
  const hasUpdate = status === 'has-update';

  const [settingsOpen, setSettingsOpen] = useState(false);
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

          {/* 项目列表（§2.2）：容器 gap 2、padding 4；标题行高 28「项目」11/500 mist；
              条目高 36、padding 8、gap 8、圆角 12，含阶段色条 + 项目名 + 状态点 */}
          {projects.length > 0 && (
            <div className="mt-3 px-3">
              <div className="pb-1 text-[11px] font-medium text-mist">项目</div>
              <ul className="flex flex-col gap-0.5">
                {projects.slice(0, SIDEBAR_PROJECT_LIMIT).map((p) => {
                  const active = currentProjectId === p.id;
                  const colorIdx = resolveStageColorIndex(projectStageOrder(p.id, stages));
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
                        {/* 阶段色条 4×16，用该项目的阶段 main 色（实心块，走 STAGE_BAR_COLORS） */}
                        <span
                          aria-hidden
                          className="h-4 w-1 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: STAGE_BAR_COLORS[colorIdx] ?? 'transparent' }}
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
                {projects.length > SIDEBAR_PROJECT_LIMIT && (
                  <li className="px-2 pt-1 text-[11px] text-mist">
                    还有 {projects.length - SIDEBAR_PROJECT_LIMIT} 个项目…
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
              {hasUpdate && (
                <span
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

  /** 收起态（§2.3 · 宽 64）：Logo("P") + 展开键 + 分隔 + 4 图标导航 + 3 项目彩条 + 占位 + 设置/新建/身份 */
  const renderCollapsed = (): JSX.Element => {
    const top3 = projects.slice(0, 3);
    return (
      <>
        {/* Logo（字面 "P"，40×40 圆角 12，pine 底白字） + 展开键（40×40 sunken 圆角 12） */}
        <div className="flex shrink-0 flex-col items-center gap-2 py-3">
          <Link
            to="/"
            title="ID Plan v0.7 Beta"
            aria-label="ID Plan 首页"
            className="flex h-10 w-10 items-center justify-center rounded-md bg-pine text-[15px] font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
          >
            P
          </Link>
          <SidebarCollapseToggle collapsed onToggle={onToggleCollapse} controlsId={SIDEBAR_ID} />
        </div>

        {/* 分隔线 40×1 */}
        <div className="mx-auto my-1 h-px w-10 bg-line" />

        {/* 4 个导航图标键（40×40 圆角 12，激活态 bg-pine-soft） */}
        <SidebarNav collapsed />

        {/* 3 条项目彩条（40×36 圆角 12，内含竖条 4×20 用阶段 main 色） */}
        {top3.length > 0 && (
          <div className="flex flex-col items-center gap-1 py-2">
            {top3.map((p) => {
              const colorIdx = resolveStageColorIndex(projectStageOrder(p.id, stages));
              return (
                <Link
                  key={p.id}
                  to={`/project/${p.id}`}
                  title={p.name}
                  aria-label={p.name}
                  className="flex h-9 w-10 items-center justify-center rounded-md bg-sunken outline-none transition-colors hover:bg-line focus-visible:ring-2 focus-visible:ring-pine/40"
                >
                  <span
                    aria-hidden
                    className="h-5 w-1 rounded-[2px]"
                    style={{ backgroundColor: STAGE_BAR_COLORS[colorIdx] ?? 'transparent' }}
                  />
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
            className="flex h-10 w-10 items-center justify-center rounded-md text-mist outline-none transition-colors hover:bg-sand focus-visible:ring-2 focus-visible:ring-pine/40"
          >
            <Settings size={18} aria-hidden />
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

/** 侧栏项目列表上限（超出提示「还有 N 个」，避免侧栏被长列表淹没） */
const SIDEBAR_PROJECT_LIMIT = 8;

/** 从 pathname 提取当前项目 id（`/project/:id[/...]`），非项目路由返回 null */
export function matchProjectId(pathname: string): string | null {
  const m = /^\/project\/([^/]+)/.exec(pathname);
  return m ? m[1] : null;
}

/** 项目相关页判定（沿用原 TopBar `onHome || pathname.startsWith('/project')` 口径） */
export function onProjectPage(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/project');
}

/** 该项目当前阶段序号（取最早 orderIndex）→ 供彩条选色；无阶段回落 0 */
export function projectStageOrder(
  projectId: string,
  stages: Array<{ projectId: string; orderIndex: number }>,
): number {
  const own = stages.filter((s) => s.projectId === projectId);
  if (own.length === 0) return 0;
  return Math.min(...own.map((s) => s.orderIndex));
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
