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
  return <div className="my-1 border-t border-sand" />;
}

/**
 * 移动端「⋮ 更多」菜单（v0.4 手机端重构 · 阶段 A）。
 *
 * 背景：顶栏右侧原本平铺「项目 / 我的任务 / 保存备份 / 加载备份 / 休息制度 / 视图切换 / 新建项目 / 身份」，
 * 在 iPad 横屏（1024）及以下会直接挤爆——搜索框被压成一条缝、按钮换行错位。
 * 因此在 xl（1280）以下把这些次要控件收进本菜单，顶栏只保留 logo + 搜索 + ⋮ + 身份头像。
 *
 * ── v0.7 T02 定位（明确）──
 *   PRD §5.2 表把**「⋮ 更多」列为顶栏允许的 4 个常驻视觉块之一**（logo+品牌 /
 *   搜索+⌘K / 身份头像 / 设置+⋮更多），工程核查 A.2 注进一步说明
 *   「本组件挂在 TopBar 内，跟随收缩，**无需单独改**」。
 *   故 T02 对本文件**不做内容裁剪**：它仍是 <xl 档位的次要动作总收口。
 *   注意它**不是**侧栏抽屉的替代品——侧栏抽屉（`Modal` placement）覆盖
 *   <1280 且具备焦点圈禁/滚动锁定；本菜单是 <xl 的**快速动作面板**，
 *   两者职责不同（前者导航、后者动作），在 <xl 档位并存是设计预期，不是重复入口。
 *   本组件也**不**吞掉侧栏的导航职责：菜单里的导航四项属于
 *   「小屏用户的就近入口」，与侧栏抽屉互为冗余但都保留（R15：入口不丢）。
 *
 * 边界：xl 以上本组件整体不渲染（根节点 xl:hidden），桌面布局与行为完全不变。
 * 所有动作复用既有 store / 服务，不另起一份实现：
 *   - 视图切换 → useUiStore.homeViewMode
 *   - 新建项目 → useUiStore.openManualForm
 *   - 备份导入导出 → useBackupIo（与桌面按钮同一份逻辑）
 *   - 设置/导出日志 → SettingsDialog
 */
export function MobileMoreMenu(): JSX.Element {
  const location = useLocation();
  const { isAdmin } = useRoleGuard();
  const openManualForm = useUiStore((s) => s.openManualForm);
  const { save, pick, fileInput, confirmDialog } = useBackupIo();
  // 仅桌面端且主进程推送过「有新版本」时为 true；移动端菜单项照常用 ITEM/ITEM_ICON 写法
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
          {/* 导航（<xl 就近入口；与侧栏抽屉互为冗余但都保留——R15 入口不丢） */}
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
