import { Link, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Search, X } from 'lucide-react';

import { NewProjectMenu } from '../project/NewProjectMenu';
import { MemberIdentityPicker } from './MemberIdentityPicker';
import { MobileMoreMenu } from './MobileMoreMenu';
import { SaveBackupButton } from './SaveBackupButton';
import { LoadBackupButton } from './LoadBackupButton';
import { SettingsButton } from './SettingsButton';
import { ImeInput } from '../common/ImeInput';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { useUiStore } from '../../store/useUiStore';
import { cn } from '../../lib/cn';

/**
 * 窄屏搜索输入区（手机常驻整行 / 平板点击展开为内联）。
 * 抽成局部组件的原因：手机与平板各渲染一份（靠 CSS 断点二选一），
 * 若不复用会出现「两份输入框、ref 互相覆盖、⌘K 聚焦到看不见的那个」这类问题。
 */
function CompactSearchField({
  inputRef,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement>;
  onClose?(): void;
}): JSX.Element {
  const searchQuery = useUiStore((s) => s.searchQuery);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);

  return (
    <div className="flex w-full max-w-[360px] items-center gap-2 rounded-[14px] border border-sand bg-cream/60 px-3 py-2">
      <Search size={15} className="shrink-0 text-mist" aria-hidden />
      <ImeInput
        ref={inputRef}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="搜索项目、任务或客户…"
        aria-label="搜索项目、任务或客户"
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-mist"
      />
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="清空并关闭搜索"
          className="shrink-0 text-mist transition-colors hover:text-ink"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/**
 * 应用栏（严格对齐参考稿 §应用栏）：
 *   浮起 glass-strong / 圆角 20 / padding 16 卡片（不再是通栏 sticky + border-b）；
 *   左 = logo（40×40 圆角12，产品「蓝 P 白色圆角方块」logo.png，非 ▦ 占位）+ 品牌名 18/700 + 副标 11 次级；
 *   中 = 搜索框（真实过滤项目名 / 客户名，非占位）；
 *   右 = 导航 + 备份 + 视图切换（参考稿 toggle 形态）+ 新建 + 身份入口。
 *
 * v0.4 手机端重构 · 阶段 A：顶栏三档响应式
 *   - ≥1280（xl）：桌面完整形态，480 宽搜索框 + 全部控件平铺；
 *   - 640～1279（sm～lg）：单行，搜索折叠为图标、其余控件收进「⋮ 更多」；
 *   - <640（手机）：两行——第一行 logo + ⋮ + 身份头像，第二行搜索框独占整行。
 * 断点统一取 xl：iPad 横屏（1024）与 iPad Pro 11"（1194）都进「更多」档，不会卡临界。
 */
export function TopBar(): JSX.Element {
  const location = useLocation();
  const { isAdmin } = useRoleGuard();
  const homeViewMode = useUiStore((s) => s.homeViewMode);
  const setHomeViewMode = useUiStore((s) => s.setHomeViewMode);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);

  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const phoneSearchRef = useRef<HTMLInputElement>(null);
  const tabletSearchRef = useRef<HTMLInputElement>(null);
  // 平板档（640～1279）的搜索框是否展开；手机档常驻展开，桌面档常驻完整框
  const [tabletSearchOpen, setTabletSearchOpen] = useState(false);

  /**
   * ⌘K / Ctrl+K / Alt+K 全局快捷键：按当前视口聚焦对应的搜索框。
   * 兼容桌面（⌘K 徽标文案）与用户习惯的 Alt+K 触发方式。
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey || e.altKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.innerWidth >= 1280) {
          desktopSearchRef.current?.focus();
          desktopSearchRef.current?.select();
        } else if (window.innerWidth >= 640) {
          setTabletSearchOpen(true);
          window.setTimeout(() => {
            tabletSearchRef.current?.focus();
            tabletSearchRef.current?.select();
          }, 0);
        } else {
          phoneSearchRef.current?.focus();
          phoneSearchRef.current?.select();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onHome = location.pathname === '/';
  const onProjectPage = onHome || location.pathname.startsWith('/project');
  // 成员看板路由（仅成员视角首页）
  const onMemberBoard = location.pathname === '/member-board';

  const navClass = (active: boolean): string =>
    cn(
      'rounded-[8px] px-3 py-1.5 text-sm transition-colors hover:bg-sand',
      active ? 'text-pine' : 'text-mist',
    );

  return (
    <header className="relative z-40 print:hidden">
      <div className="mx-auto w-full max-w-[1600px] px-4 pt-6 sm:px-6 lg:px-8">
        <div className="glass-strong flex flex-wrap items-center gap-3 rounded-[20px] border border-sand p-4 sm:gap-6">
          {/* 左：logo + 品牌（手机上副标题隐藏，给搜索行让位） */}
          <Link to="/" className="order-1 flex shrink-0 items-center gap-3">
            {/* 品牌 P logo：白色圆角方块 + 蓝色 P，直接展示产品图 */
            /* 复用源码提供的 logo.png，天然带白底圆角方块，无需 btn-aura 渐变 */}
            <img
              src="/logo.png"
              alt="ID Plan logo"
              aria-hidden
              className="h-10 w-10 rounded-[12px] object-cover shadow-soft"
            />
            <span className="flex flex-col">
              <span className="font-display text-lg font-bold leading-6 text-ink">ID Plan</span>
              <span className="hidden text-xs leading-[14px] text-mist sm:block">
                室内设计项目管理
              </span>
            </span>
          </Link>

          {/*
            中：搜索。
            - 手机：basis-full 强制换行，独占第二行整行；
            - sm 以上：basis-0 + grow，吸收剩余空间，内部再由 max-w-full / max-w-[360px] 收敛。
          */}
          <div className="order-3 flex min-w-0 grow basis-full justify-center sm:order-2 sm:basis-0">
            {/* 桌面端（xl 以上）：完整搜索框 */}
            <div className="hidden w-[480px] max-w-full items-center gap-2.5 rounded-[14px] border border-sand bg-cream/60 p-3 xl:flex">
              <span className="text-sm text-mist" aria-hidden>
                ⌕
              </span>
              <ImeInput
                ref={desktopSearchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索项目、任务或客户…"
                aria-label="搜索项目、任务或客户"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-mist"
              />
              <button
                type="button"
                onClick={() => {
                  desktopSearchRef.current?.focus();
                  desktopSearchRef.current?.select();
                }}
                aria-label="聚焦搜索（快捷键 ⌘K / Ctrl+K / Alt+K）"
                className="shrink-0 rounded-[8px] border border-sand px-2 py-1 text-xs text-mist transition-colors hover:bg-sand hover:text-ink"
              >
                ⌘K
              </button>
            </div>

            {/* 手机端（<sm）：搜索框常驻，独占整行 */}
            <div className="flex w-full justify-center sm:hidden">
              <CompactSearchField inputRef={phoneSearchRef} onClose={() => setSearchQuery('')} />
            </div>

            {/* 平板端（sm～xl）：折叠为图标，点击展开内联输入框 */}
            <div className="hidden w-full items-center justify-center sm:flex xl:hidden">
              {tabletSearchOpen ? (
                <CompactSearchField
                  inputRef={tabletSearchRef}
                  onClose={() => {
                    setSearchQuery('');
                    setTabletSearchOpen(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setTabletSearchOpen(true);
                    window.setTimeout(() => {
                      tabletSearchRef.current?.focus();
                      tabletSearchRef.current?.select();
                    }, 0);
                  }}
                  aria-label="打开搜索"
                  className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-sand text-mist transition-colors hover:bg-sand hover:text-ink"
                >
                  <Search size={18} />
                </button>
              )}
            </div>
          </div>

          {/* 右：桌面完整控件组（xl+） / 移动端「⋮ 更多」+ 身份 */}
          <div className="order-2 ml-auto flex shrink-0 items-center gap-2 sm:order-3 sm:gap-3">
            {/* 桌面端（xl 以上）：导航 + 备份 + 视图切换 + 新建 */}
            <div className="hidden items-center gap-2 sm:gap-3 xl:flex">
              {isAdmin ? (
                <Link to="/" className={navClass(location.pathname === '/')}>
                  项目
                </Link>
              ) : (
                <Link to="/member-board" className={navClass(onMemberBoard)}>
                  看板
                </Link>
              )}
              <Link to="/my-tasks" className={navClass(location.pathname === '/my-tasks')}>
                我的任务
              </Link>
              {/* v0.6：Agent Board 独立 Tab（所有角色可见，沿用既有 nav 规则不自创） */}
              <Link to="/agent" className={navClass(location.pathname === '/agent')}>
                Agent
              </Link>

              {isAdmin && (
                <div className="flex items-center gap-1">
                  <SaveBackupButton />
                  <LoadBackupButton />
                </div>
              )}

              {/* 设置：入口按钮，所有角色可用；导出日志收进设置面板 */}
              <SettingsButton />

              {/* 视图切换（仅首页）：圆角12 容器内 padding4，选中项 圆角9 半透明蓝底蓝字 */}
              {onHome && (
                <div
                  role="tablist"
                  aria-label="首页视图切换"
                  className="flex items-center gap-1 rounded-[12px] border border-sand bg-cream/60 p-1"
                >
                  {(
                    [
                      { key: 'kanban' as const, label: '看板', icon: '▤' },
                      { key: 'calendar' as const, label: '月历', icon: '▥' },
                    ]
                  ).map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      role="tab"
                      aria-selected={homeViewMode === o.key}
                      onClick={() => setHomeViewMode(o.key)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-sm font-medium transition-colors',
                        homeViewMode === o.key
                          ? 'bg-pine-soft text-pine'
                          : 'text-mist hover:bg-sand hover:text-ink',
                      )}
                    >
                      <span aria-hidden>{o.icon}</span>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}

              {isAdmin && onProjectPage && <NewProjectMenu />}
            </div>

            {/* 平板 / 手机：全部次要控件收进「⋮ 更多」（组件内部 xl:hidden） */}
            <MobileMoreMenu />

            <MemberIdentityPicker />
          </div>
        </div>
      </div>
    </header>
  );
}
