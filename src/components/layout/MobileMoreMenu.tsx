import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { CalendarRange, LayoutGrid, MoreVertical, PenLine, Save, Settings, Upload } from 'lucide-react';

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
  return <div className="my-1 border-t border-sand" />;
}

/**
 * 移动端「⋮ 更多」菜单（v0.4 手机端重构 · 阶段 A）。
 *
 * 背景：顶栏右侧原本平铺「项目 / 我的任务 / 保存备份 / 加载备份 / 休息制度 / 视图切换 / 新建项目 / 身份」，
 * 在 iPad 横屏（1024）及以下会直接挤爆——搜索框被压成一条缝、按钮换行错位。
 * 因此在 xl（1280）以下把这些次要控件收进本菜单，顶栏只保留 logo + 搜索 + ⋮ + 身份头像。
 *
 * 边界：xl 以上本组件整体不渲染（根节点 xl:hidden），桌面布局与行为完全不变。
 * 所有动作复用既有 store / 服务，不另起一份实现：
 *   - 视图切换 → useUiStore.homeViewMode
 *   - 新建项目 → useUiStore.openManualForm
 *   - 备份导入导出 → useBackupIo（与桌面按钮同一份逻辑）
 *   - 休息制度 → RestPolicyDialog（弹窗本身就是逻辑载体）
 */
export function MobileMoreMenu(): JSX.Element {
  const location = useLocation();
  const { isAdmin } = useRoleGuard();
  const homeViewMode = useUiStore((s) => s.homeViewMode);
  const setHomeViewMode = useUiStore((s) => s.setHomeViewMode);
  const openManualForm = useUiStore((s) => s.openManualForm);
  const { save, pick, fileInput, confirmDialog } = useBackupIo();
  // 仅桌面端且主进程推送过「有新版本」时为 true；移动端菜单项照常用 ITEM/ITEM_ICON 写法
  const { status } = useUpdateCheck();
  const hasUpdate = status === 'has-update';

  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const onHome = location.pathname === '/';
  const onProjectPage = onHome || location.pathname.startsWith('/project');

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
    <div ref={rootRef} className="relative xl:hidden">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="更多操作"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-[10px] border border-sand text-mist transition-colors hover:bg-sand hover:text-ink',
          menuOpen && 'bg-sand text-ink',
        )}
      >
        <MoreVertical size={18} />
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label="更多操作"
          className="glass-medium menuFadeIn absolute right-0 top-full z-50 mt-2 max-h-[calc(100vh-6rem)] w-56 overflow-y-auto rounded-xl border border-sand py-1 shadow-soft"
        >
          {/* 导航 */}
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

          {/* 视图切换（仅首页） */}
          {onHome && (
            <>
              <Divider />
              <div className="px-3.5 py-1.5 text-[11px] text-mist">首页视图</div>
              <div
                role="tablist"
                aria-label="首页视图切换"
                className="mx-3 my-1 flex items-center gap-1 rounded-[10px] border border-sand bg-cream/60 p-1"
              >
                {(
                  [
                    { key: 'kanban' as const, label: '看板', Icon: LayoutGrid },
                    { key: 'calendar' as const, label: '月历', Icon: CalendarRange },
                  ]
                ).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={homeViewMode === key}
                    onClick={() => setHomeViewMode(key)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-2 text-sm font-medium transition-colors',
                      homeViewMode === key
                        ? 'bg-pine-soft text-pine'
                        : 'text-mist hover:bg-sand hover:text-ink',
                    )}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

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
