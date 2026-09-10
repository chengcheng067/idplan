import { Link, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Menu, Search, X } from 'lucide-react';

import { MemberIdentityPicker } from './MemberIdentityPicker';
import { MobileMoreMenu } from './MobileMoreMenu';
import { SettingsButton } from './SettingsButton';
import { ImeInput } from '../common/ImeInput';
import { useUiStore } from '../../store/useUiStore';
import { useLayoutStore } from '../../store/useLayoutStore';
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
    <div className="flex w-full max-w-[360px] items-center gap-2 rounded-[14px] border border-line bg-cream/60 px-3 py-2">
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
 * 顶栏（v0.7 · 子系统 ① · M2 / T02 瘦身至 ≤4 常驻元素）。
 *
 * ── 瘦身前后（PRD §3.2 / L-01）──
 *   瘦身前（v0.6）：浮起 glass-strong 卡片里塞了 9+ 个视觉块——logo / 品牌+副标题 /
 *     480 搜索框 / ⌘K / 4 项导航 / 保存备份 / 加载备份 / 设置 / 看板月历切换 /
 *     新建项目 / 身份头像 / ⋮ 更多。「上边栏观感重」的主因有二：
 *       ① 常驻导航占了顶栏最贵的一行横向空间（4 个文字链）；
 *       ② 整条顶栏做了玻璃浮起（玻璃层次误用于常驻导航，竞品调研结论 8）。
 *   瘦身后（v0.7）：常驻**恰 4 块**，其余全部下沉——
 *     ① 汉堡（<xl 打开抽屉）+ Logo + 品牌名；
 *     ② 搜索图标 + ⌘K（去 480px 常驻输入框，调研结论 3）；
 *     ③ 身份头像（`MemberIdentityPicker`）；
 *     ④ 设置（`SettingsButton`）+ ⋮更多（`MobileMoreMenu` 内部 xl:hidden）。
 *
 * ── 下沉去向（R15：功能入口一个都不能丢）──
 *   · 导航四项（项目/看板/我的任务/Agent）    → `SidebarNav`（T01 已迁，本文件删除）
 *   · 看板/月历视图切换                        → 首页内容区顶部 `HomeViewTabs`
 *   · 保存备份 / 加载备份                      → `Sidebar` 底部固定区（管理员专属）
 *   · 新建项目                                 → `Sidebar` 底部主 CTA
 *   · 导出日志                                 → 设置面板（`SettingsDialog` → `ExportLogButton`）
 *
 * ── 玻璃层次（§3.5）──
 *   整条顶栏**不再** `glass-strong` 浮起：改为纸白 `bg-cream` 常驻条 +
 *   底部极弱 `border-line` 分隔线。玻璃只留给浮层（命令栏/抽屉/弹窗/下拉）。
 *
 * ── 响应式三档（严格锁 xl=1280，不引入新断点；§3.3）──
 *   ≥1280（xl）：单行——汉堡隐藏、logo+品牌、搜索图标+⌘K、身份、设置+⋮；
 *   640～1279（sm～lg）：同单行，⋮更多承担全部次要控件；
 *   <640（手机）：两行——第一行 logo + ⋮ + 身份，第二行搜索框独占整行。
 *   断点统一取 xl：iPad 横屏（1024）与 iPad Pro 11"（1194）都进「更多」档，不卡临界。
 *
 * ── 宽度的唯一出处 ──
 *   **不再**有任何 `max-w-[1600px]`（原 :124 处的 `max-w-[1600px]` 已删）——
 *   全站宽度锚点唯一收敛在 `AppShell` 的 `<main>`（R12 / L-08），
 *   顶栏与其同处一个 flex 列，天然等宽。此处只保留横向内边距。
 */
export function TopBar(): JSX.Element {
  const location = useLocation();
  const searchQuery = useUiStore((s) => s.searchQuery);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const openSidebarDrawer = useLayoutStore((s) => s.openSidebarDrawer);

  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const phoneSearchRef = useRef<HTMLInputElement>(null);
  const tabletSearchRef = useRef<HTMLInputElement>(null);
  /** 桌面档（≥xl）搜索框是否展开为常驻输入框；默认收起为图标（调研结论 3） */
  const [desktopSearchOpen, setDesktopSearchOpen] = useState(false);
  /** 平板档（640～1279）的搜索框是否展开；手机档常驻展开 */
  const [tabletSearchOpen, setTabletSearchOpen] = useState(false);

  /**
   * ⌘K / Ctrl+K / Alt+K 全局快捷键：按当前视口展开并聚焦对应的搜索框。
   * 瘦身后三档的搜索**都**默认收起（顶栏不再常驻 480px 输入框），
   * 故快捷键一并承担「展开」动作——否则聚焦到未挂载的 ref 上会静默失败。
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey || e.altKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.innerWidth >= 1280) {
          setDesktopSearchOpen(true);
          window.setTimeout(() => {
            desktopSearchRef.current?.focus();
            desktopSearchRef.current?.select();
          }, 0);
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

  /** 切页时收起桌面/平板的展开态搜索框，避免挡住新页面的标题区 */
  useEffect(() => {
    setDesktopSearchOpen(false);
    setTabletSearchOpen(false);
  }, [location.pathname]);

  return (
    <header
      className={cn(
        'relative z-40 shrink-0 print:hidden',
        // §3.5：常驻导航条不做玻璃浮起 —— 纸白底 + 极弱底部分隔线
        'border-b border-line bg-cream',
      )}
    >
      <div className="px-4 pt-4 sm:px-6 lg:px-8">
        {/*
          常驻 4 块容器的 flex 布局。
          注意：这里**没有** footer 式的 flex-wrap 卡片结构了——瘦身后单行即可容纳，
          卡片圆角/padding16/玻璃背景一并去掉（原 `glass-strong ... rounded-[20px] p-4`）。
        */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          {/* ── ① 汉堡（<xl，打开侧栏抽屉）+ Logo + 品牌名 ── */}
          <div className="order-1 flex shrink-0 items-center gap-2 sm:gap-3">
            {/*
              汉堡按钮：仅 <xl 渲染（`xl:hidden`）。≥xl 时侧栏是持久左栏，
              再给一个「打开导航」按钮无处可指（抽屉在 xl 档不参与布局）。
              用 `openSidebarDrawer` 显式打开而非 toggle：语义是「打开导航」，
              不做「再次点击关闭」——关闭由 Modal 遮罩/Escape/选中项承担（D3）。
            */}
            <button
              type="button"
              onClick={openSidebarDrawer}
              aria-label="打开导航菜单"
              aria-controls="app-sidebar"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line text-mist transition-colors hover:bg-sand hover:text-ink xl:hidden"
            >
              <Menu size={18} aria-hidden />
            </button>

            <Link to="/" className="flex shrink-0 items-center gap-3">
              {/* 品牌 P logo：白色圆角方块 + 蓝色 P，直接展示产品图 */}
              <img
                src="/logo.png"
                alt="ID Plan logo"
                aria-hidden
                className="h-10 w-10 rounded-[12px] object-cover shadow-soft"
              />
              <span className="flex flex-col">
                <span className="font-display text-lg font-bold leading-6 text-ink">ID Plan</span>
                {/* L-06：副标题改行业中性表述（原「室内设计项目管理」把跨行业产品写窄了） */}
                <span className="hidden text-xs leading-[14px] text-mist sm:block">
                  项目排期与交付管理
                </span>
              </span>
            </Link>
          </div>

          {/*
            ── ② 搜索（图标 + ⌘K；展开时才渲染输入框）──
            - 手机（<sm）：basis-full 强制换行，独占第二行整行，输入框常驻；
            - sm 以上：basis-0 + grow 吸收剩余空间，图标/展开框二选一。
          */}
          <div className="order-3 flex min-w-0 grow basis-full justify-center sm:order-2 sm:basis-0">
            {/* 桌面端（≥xl）：默认图标，点击/⌘K 展开为内联输入框（去 480px 常驻框） */}
            <div className="hidden items-center justify-center xl:flex">
              {desktopSearchOpen ? (
                <div className="flex w-[480px] max-w-full items-center gap-2.5 rounded-[14px] border border-line bg-cream/60 p-2.5">
                  <Search size={15} className="shrink-0 text-mist" aria-hidden />
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
                      setSearchQuery('');
                      setDesktopSearchOpen(false);
                    }}
                    aria-label="清空并关闭搜索"
                    className="shrink-0 text-mist transition-colors hover:text-ink"
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDesktopSearchOpen(true);
                    window.setTimeout(() => {
                      desktopSearchRef.current?.focus();
                      desktopSearchRef.current?.select();
                    }, 0);
                  }}
                  aria-label="打开搜索（快捷键 ⌘K / Ctrl+K / Alt+K）"
                  title="搜索（⌘K）"
                  className="flex h-9 items-center gap-2 rounded-[10px] border border-line px-3 text-mist transition-colors hover:bg-sand hover:text-ink"
                >
                  <Search size={18} aria-hidden />
                  <span className="text-xs" aria-hidden>
                    ⌘K
                  </span>
                </button>
              )}
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
                  className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line text-mist transition-colors hover:bg-sand hover:text-ink"
                >
                  <Search size={18} />
                </button>
              )}
            </div>
          </div>

          {/* ── ③④ 身份头像 + 设置 + ⋮更多 ── */}
          <div className="order-2 ml-auto flex shrink-0 items-center gap-2 sm:order-3 sm:gap-3">
            {/* 设置：入口按钮，所有角色可用；导出日志收进设置面板 */}
            <SettingsButton />
            {/* 平板 / 手机：其余次要控件收进「⋮ 更多」（组件内部 xl:hidden） */}
            <MobileMoreMenu />
            <MemberIdentityPicker />
          </div>
        </div>
      </div>
    </header>
  );
}
