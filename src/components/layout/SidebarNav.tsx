import { Link, useLocation } from 'react-router-dom';
import { Bot, CalendarRange, ChevronRight, History, LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';

import { useRoleGuard } from '../../hooks/useRoleGuard';
import { usePluginRegistry } from '../../core/plugin/PluginRegistryProvider';
import { cn } from '../../lib/cn';

/**
 * 侧栏主导航项列表（v0.7 · N02/T20 起；v0.8.5 按雯丞设想重构 Agent 区）。
 *
 * ── v0.8.5 重构（她 10-01 截图反馈 #5：「agent 在边栏上只给一个按钮，
 *    点击以后显示工作区和执行记录的二级侧边栏」）──
 * 一级 4 项收窄为 3 项：Agent 区合并为一个**父项**（Bot 图标 + chevron），
 * 展开显示二级子组（工作区 / 执行记录）。设计规范见
 * `deliverables/research/v0.8.5-选择器与引导与二级侧栏-视觉规范.md` §C。
 *
 * 行为契约（规范 C.5）：
 *   · 点父项 = 展开/收起子组（**不导航**），aria-expanded 同步；
 *   · 路由进入 `/agent*` → 自动展开；离开 Agent 区 → 自动收起；
 *   · 收起态（64px）父项仍是 40×40 图标键，点击 = 导航到 /agent（原行为不变）；
 *   · 子项 = Link 导航 + 精确高亮；抽屉态点完子项由 Sidebar 关抽屉（现成机制）。
 *
 * 高亮口径**零改动**（pine-soft / 暗色 sunken）；`navItemClass` 加第 4 参
 * size（默认 'md'，既有调用点不受影响）；Sidebar.tsx 主体零改动。
 */

interface NavEntry {
  to: string;
  label: string;
  Icon: LucideIcon;
  /** 命中判定的 pathname 谓词（首页用精确匹配，避免 `/` 命中所有路径） */
  match(pathname: string): boolean;
}

/** Agent 二级子项（工作区 / 执行记录） */
const AGENT_CHILDREN: ReadonlyArray<{ to: string; label: string; Icon: LucideIcon }> = [
  { to: '/agent', label: '工作区', Icon: LayoutGrid },
  { to: '/agent/executions', label: '执行记录', Icon: History },
];

/** 是否处于 Agent 区（自动展开/收起的路由判据） */
const inAgentArea = (p: string): boolean => p.startsWith('/agent');

export function SidebarNav({
  collapsed,
  drawer = false,
}: {
  collapsed: boolean;
  /** 抽屉态（<xl 的 Modal 抽屉）：导航项放大到 h44 / pad16 / 圆角 8（画板 10） */
  drawer?: boolean;
}): JSX.Element {
  const { isAdmin } = useRoleGuard();
  const { pathname } = useLocation();
  // 展开态：组件内 state，不持久化；挂载时按路由判据定初值（进 Agent 区即展开）。
  // 切页若整栏重渲染，此 state 重置——按同一路由判据重算，行为一致（规范 C.5）。
  const [agentOpen, setAgentOpen] = useState<boolean>(() => inAgentArea(pathname));
  const agentActive = inAgentArea(pathname);

  /**
   * v0.8.6 阶段 2：Agent 段改为**从插件注册表派生**。
   *
   * 她 10-04：「插件要能手动在设置里面去开关」——侧栏入口是开关最直接的
   * 可见面。所以这里不再无条件渲染 `{ group: 'agent' }`：只有当注册表里存在
   * **启用中的、group==='agent' 的导航项**时才占位。
   *
   *  ⇒ 停用 agent-board 插件 = 侧栏 Agent 段整段消失（不是禁用样式、不是
   *     空标题），与「路由不进 router 数组」是同一个停用语义。
   */
  const agentNav = usePluginRegistry().navItems.filter((n) => n.group === 'agent');
  const agentNavActive = agentNav.length > 0;

  const entries: Array<NavEntry | { group: 'agent' }> = [
    isAdmin
      ? {
          to: '/',
          label: '项目',
          Icon: LayoutGrid,
          match: (p) => p === '/',
        }
      : {
          to: '/member-board',
          label: '看板',
          Icon: LayoutGrid,
          match: (p) => p === '/member-board',
        },
    {
      to: '/my-tasks',
      label: '我的任务',
      Icon: CalendarRange,
      match: (p) => p === '/my-tasks',
    },
    // 插件停用 ⇒ 不占位 ⇒ Agent 段不渲染（与路由摘除同一个开关）
    ...(agentNavActive ? ([{ group: 'agent' }] as const) : []),
  ];

  return (
    <nav aria-label="主导航" className="flex flex-col gap-1 px-2">
      {entries.map((entry) =>
        'group' in entry ? (
          <div key="agent" data-sidebar-nav-sub="">
            {/* 父项：展开态 = button（只展开不导航）；收起态 = 图标键 Link 到 /agent（原行为） */}
            {collapsed ? (
              <Link
                to="/agent"
                aria-label="Agent 工作区"
                aria-current={agentActive ? 'page' : undefined}
                title="Agent 工作区"
                className={cn(navItemClass(agentActive, collapsed, drawer))}
              >
                <Bot size={18} className="shrink-0" aria-hidden />
              </Link>
            ) : (
              <button
                type="button"
                data-sidebar-nav-parent=""
                aria-expanded={agentOpen}
                onClick={() => setAgentOpen((v) => !v)}
                className={cn(navItemClass(agentActive, collapsed, drawer), 'w-full')}
              >
                <Bot size={18} className="shrink-0" aria-hidden />
                <span className="truncate">Agent</span>
                <ChevronRight
                  size={14}
                  aria-hidden
                  className={cn(
                    'ml-auto shrink-0 transition-transform duration-[120ms]',
                    agentOpen && 'rotate-90',
                  )}
                />
              </button>
            )}
            {/* 子组：展开且非收起态才渲染（规范 C.5：直接卸载，不做淡出竞态） */}
            {!collapsed && agentOpen && (
              <div className="sidebar-sub-in ml-[26px] border-l border-line pl-2">
                <div className="flex flex-col gap-0.5 pt-0.5">
                  {AGENT_CHILDREN.map((child) => {
                    const childActive =
                      child.to === '/agent'
                        ? pathname === '/agent'
                        : pathname.startsWith(child.to);
                    return (
                      <Link
                        key={child.to}
                        to={child.to}
                        data-sidebar-nav-sub-item={child.to}
                        aria-current={childActive ? 'page' : undefined}
                        className={cn(navItemClass(childActive, false, drawer, 'sm'))}
                      >
                        <child.Icon size={16} className="shrink-0" aria-hidden />
                        <span className="truncate">{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <SidebarNavItem
            key={entry.to}
            to={entry.to}
            label={entry.label}
            Icon={entry.Icon}
            active={entry.match(pathname)}
            collapsed={collapsed}
            drawer={drawer}
          />
        ),
      )}
    </nav>
  );
}

/**
 * 单个导航项（导出供其它区块复用，如「项目列表」区块的分类项）。
 *
 * `active` 由调用方计算后传入（而非组件内读 `useLocation`）：
 *   1) 让高亮规则集中在上面的 `entries` 表里，一眼可比对迁移前后是否一致；
 *   2) 便于项目详情页等「非导航项」复用同一视觉规范（`navItemClass`）。
 */
export function SidebarNavItem({
  to,
  label,
  Icon,
  active,
  collapsed,
  drawer = false,
}: {
  to: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  /** 抽屉态：放大点击区到 h44 / pad16（画板 10），便于触屏点按 */
  drawer?: boolean;
}): JSX.Element {
  return (
    <Link
      to={to}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={cn(navItemClass(active, collapsed, drawer))}
    >
      <Icon size={18} className="shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

/**
 * 导航项视觉规范（唯一出处）。
 * 迁移纪律：与 `TopBar.tsx` 原 `navClass` 的选中/未选中色**逐字对齐**
 * （text-pine 选中、text-mist 未选中、hover:bg-sand）。
 * 抽屉态（`drawer=true`）：点击区放大到 h44 / px-4 / rounded-md。
 *
 * ★ v0.8.5：加第 4 参 `size`（规范 C.4）——二级子项用 'sm' 小一档
 *   （h-8 px-2.5 rounded-sm）。**默认 'md'**：既有三处调用点（Sidebar.tsx /
 *   SidebarNavItem / 父项 button）逐字复用旧视觉，零回归。
 */
export function navItemClass(
  active: boolean,
  collapsed: boolean,
  drawer = false,
  size: 'md' | 'sm' = 'md',
): string {
  return cn(
    'flex items-center text-sm transition-colors outline-none',
    'focus-visible:ring-2 focus-visible:ring-pine/40',
    // 暗色差异（规格 §2.2）：内边距 12→16、gap 10→8（暗色板更松一档）。
    'gap-2.5 dark:gap-2',
    collapsed
      ? 'h-10 w-10 justify-center self-center rounded-[10px]'
      : size === 'sm'
        ? 'h-8 px-2.5 py-1 rounded-sm'
        : drawer
          ? 'w-full px-4 py-2.5 rounded-md'
          : 'w-full px-3 py-2 rounded-[10px] dark:px-4',
    // 激活态：亮色浅靛 pine-soft；暗色改凹陷 sunken（规格明确的刻意设计）。
    active
      ? 'bg-pine-soft text-pine dark:bg-sunken'
      : 'text-mist hover:bg-sand hover:text-ink',
  );
}
