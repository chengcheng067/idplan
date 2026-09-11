import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot } from 'lucide-react';
import {
  CalendarRange,
  LayoutGrid,
  MoreVertical,
  PenLine,
  Save,
  Settings,
  Upload,
} from 'lucide-react';

import { useRoleGuard } from '../../hooks/useRoleGuard';
import { useUiStore } from '../../store/useUiStore';
import { SettingsDialog } from './SettingsDialog';
import { useBackupIo } from './useBackupIo';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { cn } from '../../lib/cn';

/** 菜单项基础样式（玻璃面板内，hover 走 sand 半透明白，不引入新颜色；py-2 收紧提升密度） */
const ITEM =
  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-sand active:bg-sand';

const ITEM_ICON = 'shrink-0 text-mist';

/** 分组分隔线 */
function Divider(): JSX.Element {
  return <div className="my-1 border-t border-line" />;
}

/**
 * 手机端「⋮ 更多」菜单（v0.4 手机端重构 · 阶段 A）。
 *
 * 背景：顶栏右侧原本平铺「项目 / 我的任务 / 保存备份 / 加载备份 / 休息制度 / 视图切换 / 新建项目 / 身份」，
 * 在 iPad 横屏（1024）及以下会直接挤爆——搜索框被压成一条缝、按钮换行错位。
 * 因此在窄屏把这些次要控件收进本菜单，顶栏只保留 logo + 搜索 + ⋮ + 身份头像。
 *
 * ── v0.7 T04 · P0-17 按端分流（**本文件的边界已收窄到手机档**）──
 *   根节点 = `relative md:hidden`，即**仅在 <768（手机）渲染**：
 *     手机（< 768）  ✅ 渲染 —— 工作区动作入口 = ⋮ 菜单 + 汉堡全屏抽屉
 *     平板（768–1279）❌ 不渲染 —— 依据**画板 10**（iPad 横屏顶栏逐块为
 *                     「汉堡 + 品牌 + 搜索入口 40×40 + 头像 32×32」，**没有 ⋮**），
 *                     平板改用汉堡 → 侧栏 Modal 抽屉
 *     桌面（≥ 1280） ❌ 不渲染 —— 原为 `xl:hidden` 的**既有行为**，本轮零改动
 *   ⚠️ 这是本决策**唯一的断点类名改动**。旧断点是 `xl:hidden`（≥1280 桌面早就不渲染），
 *      本轮只把上界从 1280 下移到 768，删掉的是**平板档**那一段。
 *
 *   ⚠️ 平板档删渲染后的**功能等价性**（逐项核实，不允许「删了就没入口」）：
 *      菜单里的每一项在侧栏（<xl 时为 Modal 抽屉，由顶栏汉堡展开）都有等价入口 ——
 *      项目/看板（`SidebarNav` 首项，角色分流同 ⋮）、我的任务（`SidebarNav`）、
 *      Agent（`SidebarNav`）、新建项目（`Sidebar` 底部，`isAdmin && onProjectPage`）、
 *      保存备份 / 加载备份（`Sidebar` 底部，`isAdmin`）、设置（`Sidebar` 底部，所有角色）。
 *      视图切换早在 v0.7 批次 A 就已移出本菜单（见下方渲染处的注释）。
 *
 *   ⚠️ **底部的 `fileInput` / `confirmDialog` / `SettingsDialog` 三个弹层不得挪动**：
 *      它们仍处在一个 `display:none` 的容器内，按钮不可见故当前不可触发（无害）。
 *      把 `hidden` 挪到弹层自身、或为 ≥768 新开触发路径，都会让弹层被父级
 *      `display:none` 吃掉（备份导入/设置入口直接失效）。
 *
 * 边界：md（768）及以上本组件整体不渲染，桌面与平板布局、行为按各自档位不变。
 * 所有动作复用既有 store / 服务，不另起一份实现：
 *   - 新建项目 → useUiStore.openManualForm
 *   - 备份导入导出 → useBackupIo（与桌面/侧栏按钮同一份逻辑）
 *   - 设置/导出日志 → SettingsDialog
 *   - 更新红点 → useUpdateCheck（**窄屏这一份保留**；桌面/平板那份在 `Sidebar` 设置项上）
 */
export function MobileMoreMenu(): JSX.Element {
  const location = useLocation();
  const { isAdmin } = useRoleGuard();
  const openManualForm = useUiStore((s) => s.openManualForm);
  const { save, pick, fileInput, confirmDialog } = useBackupIo();
  // 仅桌面端且主进程推送过「有新版本」时为 true。
  // 注：本菜单只在手机档渲染（根节点 md:hidden），而推送只发生在桌面端 ——
  // 故这一份红点在新版 Windows 桌面端**永远不会亮**；桌面/平板可见的落点是
  // Sidebar.tsx 的「设置」项（P0-17 配套的红点迁移）。此处保留，是为了
  // 「手机档仍渲染 ⋮」这一档位不出现功能回退（日后若补移动端更新提示即在此处亮）。
  const { status } = useUpdateCheck();
  const hasUpdate = status === 'has-update';

  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const onProjectPage = location.pathname === '/' || location.pathname.startsWith('/project');

  // 外点关闭 + Escape 关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  // 换页时收起，避免在「我的任务」页看到只属于首页的视图切换项
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div ref={rootRef} className="relative md:hidden">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="更多操作"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-[10px] border border-line text-mist transition-colors hover:bg-sand hover:text-ink',
          menuOpen && 'bg-sand text-ink',
        )}
      >
        <MoreVertical size={18} />
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label="更多操作"
          className="glass-medium menuFadeIn absolute right-0 top-full z-50 mt-2 max-h-[calc(100vh-6rem)] w-56 overflow-y-auto rounded-xl border border-line py-1 shadow-soft"
        >
          {/* 导航（手机档 <768 的就近入口；与侧栏全屏抽屉互为冗余但都保留——R15 入口不丢） */}
          {isAdmin ? (
            <Link to="/" role="menuitem" className={ITEM} onClick={() => setMenuOpen(false)}>
              <LayoutGrid size={15} className={cn(ITEM_ICON, location.pathname === '/' && 'text-pine')} />
              <span className={cn(location.pathname === '/' ? 'text-pine' : 'text-ink')}>项目</span>
            </Link>
          ) : (
            <Link
              to="/member-board"
              role="menuitem"
              className={ITEM}
              onClick={() => setMenuOpen(false)}
            >
              <LayoutGrid
                size={15}
                className={cn(ITEM_ICON, location.pathname === '/member-board' && 'text-pine')}
              />
              <span className={cn(location.pathname === '/member-board' ? 'text-pine' : 'text-ink')}>
                看板
              </span>
            </Link>
          )}
          <Link to="/my-tasks" role="menuitem" className={ITEM} onClick={() => setMenuOpen(false)}>
            <CalendarRange
              size={15}
              className={cn(ITEM_ICON, location.pathname === '/my-tasks' && 'text-pine')}
            />
            <span className={cn(location.pathname === '/my-tasks' ? 'text-pine' : 'text-ink')}>
              我的任务
            </span>
          </Link>
          {/* v0.6：Agent Board（所有角色可见，与桌面 TopBar 一致） */}
          <Link to="/agent" role="menuitem" className={ITEM} onClick={() => setMenuOpen(false)}>
            <Bot
              size={15}
              className={cn(ITEM_ICON, location.pathname === '/agent' && 'text-pine')}
            />
            <span className={cn(location.pathname === '/agent' ? 'text-pine' : 'text-ink')}>
              Agent
            </span>
          </Link>

          {/* 视图切换（仅首页）——v0.7 T02 已位移到首页内容区顶部（`HomeViewTabs`）。
              此处**移除**，避免同一档位出现两个控件改同一个 `homeViewMode`
              （PRD §3.2 迁移清单：视图切换「仅位移」，位移后原位置不留副本）。 */}

          {/* 管理员专属动作 */}
          {isAdmin && (
            <>
              <Divider />
              {onProjectPage && (
                <button
                  type="button"
                  role="menuitem"
                  className={ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    openManualForm();
                  }}
                >
                  <PenLine size={15} className={ITEM_ICON} />
                  新建项目
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className={ITEM}
                onClick={() => {
                  setMenuOpen(false);
                  void save();
                }}
              >
                <Save size={15} className={ITEM_ICON} />
                保存备份
              </button>
              <button
                type="button"
                role="menuitem"
                className={ITEM}
                onClick={() => {
                  setMenuOpen(false);
                  pick();
                }}
              >
                <Upload size={15} className={ITEM_ICON} />
                加载备份
              </button>
            </>
          )}

          {/* 设置：所有角色可用（导出日志收进设置面板） */}
          <Divider />
          <button
            type="button"
            role="menuitem"
            className={ITEM}
            onClick={() => {
              setMenuOpen(false);
              setSettingsOpen(true);
            }}
          >
            <Settings size={15} className={ITEM_ICON} />
            <span className="flex items-center gap-1.5">
              设置
              {hasUpdate && (
                <span className="h-2 w-2 rounded-full bg-clay" aria-label="有新版本可用" />
              )}
            </span>
          </button>
        </div>
      )}

      {fileInput}
      {confirmDialog}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
