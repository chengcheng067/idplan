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
 *      （与 HomeRouteGuard 同思路，此处是最强的保险：DOM 根本不生成）
 *   ② CSS 类层：根节点 / 抽屉面板带 `print:hidden`
 *   ③ 全局 CSS 层：global.css `@media print` 段的 `[data-app-sidebar]{display:none}`
 *   注意：两条打印路由的 `max-w-[900px]` 是 A4 预览**刻意保留**的，不并入 1600。
 *
 * ── 抽屉复用 `Modal`（§3.3.4）──
 * 采纳 Modal（`createPortal` + 遮罩点击关闭 + Escape + 焦点圈禁 + body 滚动锁定
 * + `role="dialog"`），与 `TaskDrawer` 同一底座，行为一致。
 * **不用** `MobileMoreMenu` 式绝对定位 Popover：它缺焦点圈禁与滚动锁定（R7 风险）。
 *
 * ── 玻璃层次（§3.6 规范）──
 * 侧栏是**常驻结构面板**，允许用 `glass-strong`（实心 paper + raised-lg 阴影）。
 * 注意「glass-strong 是实心面板」——项目已移除 backdrop-blur，"glass" 是历史误称，
 * 层次只靠阴影表达。**浮层（抽屉）** 用 glass 由 Modal 子面板承担。
 * 暗色下 glass-strong 自动变 #1e2127 实心（--paper-rgb 30 33 39），无适配成本。
 */

/** 打印路由正则：与 main.tsx 的两条 *-print 子路由严格对应 */
const PRINT_ROUTE_RE = /\/project\/[^/]+\/(schedule|calendar)-print$/;

/** 侧栏容器 id（折叠开关的 aria-controls 目标） */
const SIDEBAR_ID = 'app-sidebar';

/**
 * 打印路由守卫（R20 保险 ① · 路由层）。
 *
 * **结构性保证**：把「命中打印路由 → 不渲染侧栏」做成**外层组件的 early return**，
 * 而不是在 Sidebar 内部中间位置 return。这样：
 *   1) 命中打印路由时，`SidebarBody` 整个子树**根本不挂载**——不跑
 *      useBackupIo / useUpdateCheck / matchMedia 监听等任何 hook 与副作用，
 *      打印页零额外开销（打印页的数据装载逻辑本就独立）；
 *   2) 不存在「hook 顺序随路由变化」的任何可讨论空间——外层组件只有 1 个 hook
 *      （useLocation），且它在两条分支下都被调用。
 *
 * 为什么需要这一层而不是只靠 `print:hidden`：
 *   打印样式是在**打印时**生效的；但用户在屏幕上浏览打印页时，
 *   `print:hidden` 不生效，侧栏会照常出现在屏幕上挡住 A4 预览。PRD §3.7.1
 *   要求「打印页不显示侧栏」在屏幕态也成立——所以路由层判定是必需的，
 *   `print:hidden` 只是防「用户从普通页直接 Ctrl+P」的第二道保险。
 */
export function Sidebar(): JSX.Element | null {
  const { pathname } = useLocation();
  if (PRINT_ROUTE_RE.test(pathname)) return null;
  return <SidebarBody pathname={pathname} />;
}

/**
 * 侧栏主体（仅在非打印路由挂载）。
 * `pathname` 由外层传入，本组件不再自行读 location——
 * 单一份路径来源，避免两处 useLocation 结果在某些过渡态下不一致。
 */
function SidebarBody({ pathname }: { pathname: string }): JSX.Element {
  const { isAdmin } = useRoleGuard();
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
   * 是否达到 xl（≥1280）。
   * 用于决定「持久栏是否真正参与布局」——虽然显隐已由 Tailwind `hidden xl:flex`
   * 承担，但折叠开关的语义（切换折叠 vs 切换抽屉）需要 JS 侧的同一口径。
   * 用 state + resize 监听而非一次性求值：视口拖动跨断点时需重新判定。
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

  /**
   * <xl 时强制收起（R13 明确要求：「xl 以下强制折叠，忽略持久值」）。
   * 注意不是「把 store 改成 false」——那会污染用户在桌面端的偏好
   * （在窄屏开一次页面，回到宽屏就变成收起了，属于状态串台）。
   * 正确做法：**只影响本档位的渲染结果**，持久值原样保留。
   */
  const collapsed = xl ? !sidebarExpanded : true;

  /**
   * 补一步：<xl 时把 DOM 属性也强制为收起。
   * 否则 data-sidebar-collapsed 会停在持久值（如展开），而实际渲染是抽屉，
   * 两者口径不一致——虽不影响本档位观感，但会让「属性即真相」的约定失真，
   * 也让 QA 的截图断言（读 data-sidebar-collapsed）产生误判。
   */
  useEffect(() => {
    if (xl) return;
    document.documentElement.dataset.sidebarCollapsed = 'true';
  }, [xl]);

  /**
   * 换页时自动收起抽屉（<1280）。
   * 否则点抽屉里的导航项跳转后，抽屉仍盖在新页面上，用户需要再点一次关闭。
   */
  useEffect(() => {
    closeDrawer();
  }, [pathname, closeDrawer]);

  /** 折叠开关：≥xl 切换折叠态；<xl 切换抽屉（同一按钮在窄屏表达"打开导航"） */
  const onToggleCollapse = (): void => {
    if (xl) toggleSidebar();
    else setSidebarExpanded(!sidebarExpanded);
  };

  const currentProjectId = matchProjectId(pathname);

  /** 侧栏主体内容（抽屉与持久栏共用同一棵子树，避免两份实现漂移） */
  const body = (opts: { inDrawer: boolean }): JSX.Element => {
    const isCollapsed = opts.inDrawer ? false : collapsed;
    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* 头：Logo + 折叠开关（抽屉内改为标题 + 显式关闭由 Modal 遮罩/Escape 承担） */}
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 px-3 pb-2 pt-4',
            isCollapsed && 'flex-col gap-1.5 px-0',
          )}
        >
          <Link
            to="/"
            aria-label="ID Plan 首页"
            className={cn(
              'flex items-center gap-2.5 rounded-[10px] outline-none',
              'focus-visible:ring-2 focus-visible:ring-pine/40',
              isCollapsed && 'justify-center',
            )}
          >
            <img
              src="/logo.png"
              alt="ID Plan logo"
              aria-hidden
              className="h-9 w-9 shrink-0 rounded-[10px] object-cover shadow-soft"
            />
            {!isCollapsed && (
              <span className="font-display text-md font-bold leading-5 text-ink">ID Plan</span>
            )}
          </Link>
          {!isCollapsed && (
            <div className="ml-auto">
              <SidebarCollapseToggle
                collapsed={false}
                onToggle={onToggleCollapse}
                controlsId={SIDEBAR_ID}
              />
            </div>
          )}
        </div>
        {isCollapsed && (
          <div className="flex shrink-0 justify-center pb-1.5">
            <SidebarCollapseToggle
              collapsed
              onToggle={onToggleCollapse}
              controlsId={SIDEBAR_ID}
            />
          </div>
        )}

        {/* 可滚动区：主导航 + 项目列表（内容多时独立滚动，底部动作区固定不动） */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <SidebarNav collapsed={isCollapsed} />

          {/* 项目列表（§3.3.2）：复用首页项目数据源，带 stage.sN 阶段彩条点缀 */}
          {!isCollapsed && projects.length > 0 && (
            <div className="mt-4 px-2">
              <div className="px-3 pb-1.5 text-xs text-mist">项目</div>
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
                        className={cn(navItemClass(active, false), 'gap-2')}
                      >
                        <span
                          aria-hidden
                          className="h-3 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: STAGE_BAR_COLORS[colorIdx] ?? 'transparent' }}
                        />
                        <span className="truncate">{p.name}</span>
                      </Link>
                    </li>
                  );
                })}
                {projects.length > SIDEBAR_PROJECT_LIMIT && (
                  <li className="px-3 pt-1 text-xs text-mist">
                    还有 {projects.length - SIDEBAR_PROJECT_LIMIT} 个项目…
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        {/* 底部固定区：设置 + 备份 + 新建（§3.3.2「底部（固定）」） */}
        <div
          className={cn(
            'shrink-0 border-t border-line px-2 py-2',
            isCollapsed ? 'flex flex-col items-center gap-1' : 'flex flex-col gap-0.5',
          )}
        >
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="设置"
            title="设置（导出日志 / 清空日志）"
            className={cn(navItemClass(false, isCollapsed), 'relative')}
          >
            <span className="relative inline-flex shrink-0">
              <Settings size={18} aria-hidden />
              {hasUpdate && (
                <span
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-clay ring-2 ring-paper"
                  aria-label="有新版本可用"
                />
              )}
            </span>
            {!isCollapsed && <span className="truncate">设置</span>}
          </button>

          {/* 备份两按钮：**管理员专属**（与原 TopBar 一致，不放开权限口径） */}
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => void save()}
                aria-label="保存备份"
                title="保存备份"
                className={cn(navItemClass(false, isCollapsed))}
              >
                <Save size={18} className="shrink-0" aria-hidden />
                {!isCollapsed && <span className="truncate">保存备份</span>}
              </button>
              <button
                type="button"
                onClick={() => pick()}
                aria-label="加载备份"
                title="加载备份"
                className={cn(navItemClass(false, isCollapsed))}
              >
                <Upload size={18} className="shrink-0" aria-hidden />
                {!isCollapsed && <span className="truncate">加载备份</span>}
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
              className={cn(
                'btn-aura flex items-center gap-2.5 text-sm text-white outline-none',
                'focus-visible:ring-2 focus-visible:ring-pine/40',
                isCollapsed ? 'h-10 w-10 justify-center self-center rounded-[10px]' : 'w-full rounded-[10px] px-3 py-2',
              )}
            >
              <PenLine size={18} className="shrink-0" aria-hidden />
              {!isCollapsed && <span className="truncate">新建项目</span>}
            </button>
          )}
        </div>

        {/* 收起态给一个「项目」入口兜底：项目列表在收起时不可见，
            但 `/`（项目首页）已由主导航项承担，故此处无需重复入口。 */}
      </div>
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

      {/* ── 抽屉（<xl）：复用 Modal placement="right"（§3.3.4）── */}
      <Modal
        open={!xl && drawerOpen}
        onClose={closeDrawer}
        placement="right"
        ariaLabel="导航菜单"
      >
        <div
          data-app-sidebar=""
          className="glass-strong h-full w-[280px] max-w-[85vw] overflow-hidden rounded-l-[20px] border-0 print:hidden"
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
