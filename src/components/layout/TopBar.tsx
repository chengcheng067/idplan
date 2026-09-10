import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Menu, Search, X } from 'lucide-react';
import type { RefObject } from 'react';

import { MemberIdentityPicker } from './MemberIdentityPicker';
import { MobileMoreMenu } from './MobileMoreMenu';
import { SettingsButton } from './SettingsButton';
import { ImeInput } from '../common/ImeInput';
import { useUiStore } from '../../store/useUiStore';
import { useLayoutStore } from '../../store/useLayoutStore';
import { useProjectsStore } from '../../store/useProjectsStore';
import { cn } from '../../lib/cn';

/**
 * 顶栏（v0.7 · 子系统 ① · N01 / §2.4）。
 *
 * ── 高度与底色（§2.4 / 画板 02·12）──
 *   桌面（≥xl=1280）：单⾏ 64，纸面 `bg-paper`，底 1px `border-line`；
 *   平板（768–1279）：单⾏ 56，横向 padding 0/16，gap 12；
 *   手机（<768）：两⾏合计 100（56 + 44），第⼆⾏独占搜索框。
 *   暗⾊下仍是同⼀ token（paper 在 `[data-theme="dark"]` 解析为 `#1F2126`），不写死 hex。
 *
 * ── 断点纪律（严格锁 xl=1280、md=768，绝不引⼊ lg=1024）──
 *   `xl:`  → ≥1280（持久左栏，隐藏汉堡/品牌，搜索常驻 280）
 *   `md:`  → ≥768（平板，汉堡+品牌+可展开搜索图标）
 *   `max-md:` → <768（手机两⾏）
 *
 * ── 左组：面包屑（§2.4 新功能，原顶栏⽆）—— 按 `useLocation()` 的 pathname 推导：
 *   `/`                           → 我的项目
 *   `/member-board`              → 成员看板
 *   `/my-tasks`                  → 我的任务
 *   `/agent`                     → Agent 看板
 *   `/project/:id`               → [返回] 项目 / 我的项目 / {项目名}
 *   `/project/:id/schedule-print`→ 项目 / {项目名} / 日程表
 *   `/project/:id/calendar-print`→ 项目 / {项目名} / 月历
 *   项目名取自 `useProjectsStore`，取不到回落「项目详情」。
 *
 * ── 右组：搜索 + 身份头像（+ 既有的 设置 / ⋮更多，保留既有功能不丢）──
 *   桌面：搜索常驻 280×36（`bg-sunken` 圆角 16，复用 `ImeInput`，绑 `useUiStore.searchQuery`）；
 *   平板：40×40 图标按钮，点击展开为内联 280 搜索；
 *   手机：第⼆⾏整宽搜索框（36 / 圆角 12 / pad 0 12 / gap 8）。
 *   ⌘K / Ctrl+K / Alt+K 仍承担「聚焦 / 展开」搜索框。
 */

/** 单页面包屑文本映射（非项目路由） */
const STATIC_CRUMB: Record<string, string> = {
  '/': '我的项目',
  '/member-board': '成员看板',
  '/my-tasks': '我的任务',
  '/agent': 'Agent 看板',
};

/** 搜索输入区（桌面常驻 / 平板展开 / 手机整行 三处复用，避免 ref 互相覆盖）。 */
function SearchField({
  inputRef,
  onClose,
  className,
}: {
  inputRef: RefObject<HTMLInputElement>;
  /** 提供则渲染「清空并关闭」按钮（平板 / 手机展开态） */
  onClose?: () => void;
  className?: string;
}): JSX.Element {
  const searchQuery = useUiStore((s) => s.searchQuery);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);

  return (
    <div className={cn('flex h-9 items-center gap-2 rounded-2xl bg-sunken px-3', className)}>
      <Search size={16} className="shrink-0 text-mist" aria-hidden />
      <ImeInput
        ref={inputRef}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="搜索项目、任务或客户…"
        aria-label="搜索项目、任务或客户"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-mist"
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

/** 面包屑（§2.4）：返回箭头 + 逐级「/」分隔，当前级不可点。 */
function Breadcrumbs(): JSX.Element | null {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const projects = useProjectsStore((s) => s.projects);

  // 项目详情 / 打印页：/project/:id 或 /project/:id/(schedule|calendar)-print
  const projMatch = /^\/project\/([^/]+)(?:\/(schedule|calendar)-print)?$/.exec(pathname);

  if (projMatch) {
    const id = projMatch[1];
    const printKind = projMatch[2]; // 'schedule' | 'calendar' | undefined
    const project = projects.find((p) => p.id === id);
    const projectName = project?.name ?? '项目详情';

    return (
      <div className="flex min-w-0 items-center gap-2.5 text-[13px] font-medium">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="返回上一页"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-mist outline-none transition-colors hover:bg-sand hover:text-ink focus-visible:ring-2 focus-visible:ring-pine/40"
        >
          <ArrowLeft size={18} aria-hidden />
        </button>
        <span className="shrink-0 text-mist">项目</span>
        <span className="shrink-0 text-mist" aria-hidden>
          /
        </span>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="shrink-0 text-ink outline-none transition-colors hover:text-pine focus-visible:ring-2 focus-visible:ring-pine/40"
        >
          我的项目
        </button>
        <span className="shrink-0 text-mist" aria-hidden>
          /
        </span>
        {printKind ? (
          <>
            <span className="shrink-0 truncate text-ink" title={projectName}>
              {projectName}
            </span>
            <span className="shrink-0 text-mist" aria-hidden>
              /
            </span>
            <span className="shrink-0 text-ink">
              {printKind === 'schedule' ? '日程表' : '月历'}
            </span>
          </>
        ) : (
          <span className="min-w-0 truncate text-ink" title={projectName}>
            {projectName}
          </span>
        )}
      </div>
    );
  }

  const label = STATIC_CRUMB[pathname];
  if (!label) return null;
  return (
    <div className="flex min-w-0 items-center text-[13px] font-medium text-ink" title={label}>
      <span className="truncate">{label}</span>
    </div>
  );
}

export function TopBar(): JSX.Element {
  const location = useLocation();
  const openSidebarDrawer = useLayoutStore((s) => s.openSidebarDrawer);

  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const tabletSearchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  /** 平板档（768–1279）搜索框是否展开；手机档常驻展开，桌面档常驻展开 */
  const [tabletSearchOpen, setTabletSearchOpen] = useState(false);

  /**
   * ⌘K / Ctrl+K / Alt+K 全局快捷键：按当前视口聚焦 / 展开对应的搜索框。
   * 桌面档搜索常驻（直接聚焦）；平板档需先展开再聚焦；手机档直接聚焦整行框。
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey || e.altKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.innerWidth >= 1280) {
          window.setTimeout(() => {
            desktopSearchRef.current?.focus();
            desktopSearchRef.current?.select();
          }, 0);
        } else if (window.innerWidth >= 768) {
          setTabletSearchOpen(true);
          window.setTimeout(() => {
            tabletSearchRef.current?.focus();
            tabletSearchRef.current?.select();
          }, 0);
        } else {
          mobileSearchRef.current?.focus();
          mobileSearchRef.current?.select();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /** 切页时收起平板的展开态搜索框，避免挡住新页面的标题区 */
  useEffect(() => {
    setTabletSearchOpen(false);
  }, [location.pathname]);

  return (
    <header className="relative z-40 shrink-0 border-b border-line bg-paper print:hidden">
      {/*
        顶栏主行（桌面+平板单⾏ / 手机第⼀⾏）。
        高度：手机 md: 56 / 桌面 xl: 64；横向 padding 与 gap 随断点收紧（§2.4）。
      */}
      <div className="flex h-14 items-center gap-3 px-4 md:gap-3 md:px-4 xl:h-16 xl:gap-4 xl:px-6">
        {/* 左组：汉堡 + 品牌（仅 <xl）+ 面包屑（手机隐藏，避免与品牌争位） */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* 汉堡（<xl，打开侧栏抽屉）+ 品牌名——≥xl 侧栏已是持久左栏，无需此按钮 */}
          <div className="flex shrink-0 items-center gap-2 xl:hidden">
            <button
              type="button"
              onClick={openSidebarDrawer}
              aria-label="打开导航菜单"
              aria-controls="app-sidebar"
              className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line text-mist transition-colors hover:bg-sand hover:text-ink"
            >
              <Menu size={18} aria-hidden />
            </button>
            <span className="font-display text-[15px] font-semibold leading-5 text-ink">
              ID Plan
            </span>
          </div>

          {/* 面包屑：平板与桌面显示，手机隐藏（手机第⼀⾏仅汉堡+品牌） */}
          <div className="hidden min-w-0 md:flex md:flex-1">
            <Breadcrumbs />
          </div>
        </div>

        {/* 右组：搜索 + 设置 + ⋮更多 + 身份头像 */}
        <div className="ml-auto flex shrink-0 items-center gap-3 xl:gap-4">
          {/* 桌面（≥xl）：搜索常驻 280×36（bg-sunken 圆角 16） */}
          <SearchField inputRef={desktopSearchRef} className="hidden w-[280px] xl:flex" />

          {/* 平板（768–1279）：图标按钮，点击展开为内联 280 搜索 */}
          <div className="hidden md:flex xl:hidden">
            {tabletSearchOpen ? (
              <SearchField
                inputRef={tabletSearchRef}
                onClose={() => setTabletSearchOpen(false)}
                className="w-[280px]"
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
                title="搜索（⌘K）"
                className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-line text-mist transition-colors hover:bg-sand hover:text-ink"
              >
                <Search size={18} aria-hidden />
              </button>
            )}
          </div>

          {/* 设置入口 + ⋮更多（<xl 才渲染，复用既有逻辑，保留功能不丢） */}
          <SettingsButton />
          <MobileMoreMenu />
          <MemberIdentityPicker />
        </div>
      </div>

      {/* 手机第⼆⾏（<768）：整宽搜索框，高 36 / 圆角 12 / pad 0 12 / gap 8 */}
      <div className="flex h-11 items-center px-4 md:hidden">
        <SearchField inputRef={mobileSearchRef} className="w-full rounded-xl" />
      </div>
    </header>
  );
}
