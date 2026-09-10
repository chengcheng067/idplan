import { Link, useLocation } from 'react-router-dom';
import { Bot, CalendarRange, LayoutGrid } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useRoleGuard } from '../../hooks/useRoleGuard';
import { cn } from '../../lib/cn';

/**
 * 侧栏主导航项列表（v0.7 · 子系统 ① · N02 / T20）。
 *
 * ── R15「功能入口不能丢」的落点 ──
 * 本组三项 = 原 `TopBar.tsx:213-232` 的导航块**逐项迁移**，语义一字不改：
 *   isAdmin ? 「项目」→ `/`      : 「看板」→ `/member-board`
 *            「我的任务」→ `/my-tasks`
 *            「Agent」  → `/agent`
 *
 * `isAdmin` 决定首项（同 `TopBar.tsx:214-222` 规则）——**不是**新增逻辑，
 * 是原规则原样搬移，避免「迁移顺手改了权限口径」。
 *
 * ── 收起态可访问性 ──
 * 收起（64px 图标条）时文字被隐藏，但：
 *   · `aria-label` 始终携带文字（读屏可读）；
 *   · `title` 提供鼠标悬停提示（视觉用户可发现）；
 *   · 图标保留 `aria-hidden`，避免读屏读两遍（图标无语义，文字才是语义）。
 * 焦点环用既有 `--focus-ring` 语义（`focus-visible:ring`），键盘 Tab 可达。
 *
 * 高亮复用既有 `navClass` 视觉规范（text-pine 选中 / text-mist 未选中 +
 * hover:bg-sand），与迁移前的 TopBar 完全一致——只改容器，不改观感。
 */

interface NavEntry {
  to: string;
  label: string;
  Icon: LucideIcon;
  /** 命中判定的 pathname 谓词（首页用精确匹配，避免 `/` 命中所有路径） */
  match(pathname: string): boolean;
}

export function SidebarNav({ collapsed }: { collapsed: boolean }): JSX.Element {
  const { isAdmin } = useRoleGuard();
  const { pathname } = useLocation();

  const entries: NavEntry[] = [
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
    // v0.6：Agent Board 独立入口（所有角色可见，沿用既有 nav 规则不自创）
    {
      to: '/agent',
      label: 'Agent',
      Icon: Bot,
      match: (p) => p.startsWith('/agent'),
    },
  ];

  return (
    <nav aria-label="主导航" className="flex flex-col gap-1 px-2">
      {entries.map(({ to, label, Icon, match }) => (
        <SidebarNavItem
          key={to}
          to={to}
          label={label}
          Icon={Icon}
          active={match(pathname)}
          collapsed={collapsed}
        />
      ))}
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
}: {
  to: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
}): JSX.Element {
  return (
    <Link
      to={to}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={cn(navItemClass(active, collapsed))}
    >
      <Icon size={18} className="shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

/**
 * 导航项视觉规范（唯一出处）。
 * 迁移纪律：与 `TopBar.tsx` 原 `navClass` 的选中/未选中色**逐字对齐**
 * （text-pine 选中、text-mist 未选中、hover:bg-sand），
 * 只把形状从 `px-3 py-1.5` 的胶囊换成侧栏整行条目（`px-3 py-2` + `rounded-lg`）。
 * 收起态改为正方形容器（`h-10 w-10` 居中），保证 64px 栏内点击区不塌陷。
 */
export function navItemClass(active: boolean, collapsed: boolean): string {
  return cn(
    'flex items-center gap-2.5 text-sm transition-colors outline-none',
    'focus-visible:ring-2 focus-visible:ring-pine/40',
    collapsed ? 'h-10 w-10 justify-center self-center' : 'w-full px-3 py-2',
    collapsed ? 'rounded-[10px]' : 'rounded-[10px]',
    active ? 'bg-pine-soft text-pine' : 'text-mist hover:bg-sand hover:text-ink',
  );
}
