import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Menu, Search, X } from 'lucide-react';
import type { RefObject } from 'react';

import { MemberIdentityPicker } from './MemberIdentityPicker';
import { MobileMoreMenu } from './MobileMoreMenu';
import { ImeInput } from '../common/ImeInput';
import { useUiStore } from '../../store/useUiStore';
import { useLayoutStore } from '../../store/useLayoutStore';
import { useHumanProjects } from '../../core/project/visibility';
import { isDesktop } from '../../lib/desktopBridge';
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
 * ── 右组：搜索 + 身份头像（+ 手机档 <md 的 ⋮更多）──
 *   桌面：搜索常驻 280×36（`bg-sunken` 圆角 16，复用 `ImeInput`，绑 `useUiStore.searchQuery`）；
 *   平板：40×40 图标按钮，点击展开为内联 280 搜索；
 *   手机：第⼆⾏整宽搜索框（36 / 圆角 12 / pad 0 12 / gap 8）。
 *   ⌘K / Ctrl+K / Alt+K 仍承担「聚焦 / 展开」搜索框。
 *   ⚠️ 顶栏齿轮「设置」按钮已移除（v0.7 批次 A · 画板背书）：画板 02/03/06/07/12/14
 *      的顶栏均只有「面包屑 + 搜索 + 头像」三块，设置入口在**侧栏底部**
 *      （Sidebar.tsx，展开态与收起态各一处），顶栏不再重复挂载。
 *   ⚠️ 「⋮更多」已收窄到**仅手机档**（v0.7 T04 · P0-17）：根节点 `md:hidden`，
 *      平板（768–1279）与桌面（≥1280）都不渲染 —— 依据画板 10（平板顶栏只有
 *      「汉堡 + 品牌 + 搜索入口 40×40 + 头像 32×32」，没有 ⋮）。
 *      故本文件里所有「<xl 才渲染 ⋮」的表述**均已失效**，不要再按 <xl 推断。
 *
 * ── Electron 自绘标题栏（画板 02/12 的「顶栏与主题融合」）──
 *   `titleBarStyle:'hidden'` + `titleBarOverlay`（见 electron/main.cjs）之后，
 *   **窗口失去默认可拖拽区域**，必须由 CSS 提供，否则用户无法移动窗口。
 *   故 `<header>` 声明 `.app-titlebar-drag`，其中交互元素由 global.css 的
 *   后代选择器统一回退为 `no-drag`（漏一个就表现为「那个按钮点不动」）。
 *   叠加层右侧的窗口三键浮在内容之上，故末尾留 `WINDOW_CONTROLS_WIDTH` 避让。
 */

/**
 * Electron 自绘标题栏叠加层里窗口三键（最小化/最大化/关闭）的避让宽度。
 * 三键由系统绘制、浮在网页内容**之上**，不避让就会盖住顶栏右端的搜索框 / 头像。
 * 取值：三键各约 46px（Windows 10/11 标准），合计 ≈138px。
 * 仅 Windows 桌面端生效——浏览器 / NAS 端没有原生栏，不留白（否则白丢一块宽度）。
 *
 * 注：避让清单里**不含「⋮更多」**——自绘标题栏只在桌面（≥1280）出现，而 ⋮ 自
 * v0.7 T04 起只在手机档（<768）渲染，两者档位互斥，永不重叠。
 */
const WINDOW_CONTROLS_WIDTH = 138;

/** 是否处于「自绘标题栏」环境：桌面端且平台为 win32（与 main.cjs 的判定同源） */
function usesTitleBarOverlay(): boolean {
  return isDesktop() && window.idplan?.platform === 'win32';
}

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
    <div
      className={cn(
        // app-no-drag：搜索框外壳本身不是 button/input，若不显式豁免，
        // 父级 header 的 drag 会让点它的留白区拖窗口而不是聚焦输入框。
        'app-no-drag flex h-9 items-center gap-2 rounded-2xl bg-sunken px-3',
        className,
      )}
    >
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
  /*
    ★ v0.8 T04-A · §7.2 #13 接线 ＋ §7.3 #27 的一条明文纪律。

    面包屑只在 `/project/:id`（含两个打印页）这一支里用到 project 名。它的正确口径是
    **`'human'`**，这一点是本清单里最容易"顺手写错"的地方，理由有两层：

      ① §7.3 #27 原文：详情页虽是人类侧**唯一允许穿越**的通道，但
         「详情页内任何"相关项目/兄弟项目"推荐、**面包屑回跳**、侧栏高亮**都必须走 P 出口**」。
         ⇒ 面包屑属于**人类侧 chrome**：它渲染的是"项目 / {项目名}"这条导航链，
           而不是详情页正文。正文可以渲染 Agent 看板（那是穿越），
           但导航链是**人类工作区的地标**，不该替 Agent 看板做宣传。
      ② 若这里用 `useProjectById(id)`（按 id 不分 kind），打开 Agent 看板详情时
         面包屑会显示该 Agent 看板名 —— 于是**人类侧 DOM 里出现了 Agent 看板的名字**，
         直接打穿 L4 真浏览器断言的「人类面 Agent 名出现 0 次」。这不是理论风险：
         面包屑在 ≥768 常驻渲染。

     代价（有意接受）：Agent 看板详情页的面包屑会回落成 `'项目详情'` 占位文案
     （下一行的 `?? '项目详情'` 本来就兜着），而不是显示它的真名。这是**正确**的取舍：
     用户此时看到的"我是从哪儿来的"应当是"项目详情"这个通用层级，
     而"这是一块 AI 工作区"由正文顶部的 `ProjectSourceBadge` 显式告知。
  */
  const projects = useHumanProjects();

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
    <header className="app-titlebar-drag relative z-40 flex shrink-0 flex-col border-b border-line bg-paper print:hidden md:h-14 md:flex-row xl:h-16">
      {/*
        ⚠️ 为什么 header 是 `flex-col md:flex-row` + `md:h-14 xl:h-16`（而不是原来的 `flex h-14`）：
        原来 header 是**横向** flex 且固定 56 高，而它有两个子块（主行 + 手机第二行搜索），
        于是 <768 时第二行被排到主行**右侧**而非下方——390px 实测总宽 515px 溢出视口。
        （实测证据：390px 下子块 x=0 w=260 与 x=260 w=255 并排。）
        改为列向堆叠后 <768 为「56 + 44 = 100」两行，与 §2.4 规格一致；
        ≥md 第二行 `md:hidden` 不渲染，header 回到单行 56 / ≥xl 64。
      */}
      {/*
        顶栏主行（桌面 + 平板单⾏ / 手机第⼀⾏）。
        高度：手机 56 / 平板 56 / 桌面 64。

        ⚠️ 两处宽度/高度的必要修正（v0.7 批次 A 实测发现，非风格偏好）：
        1) `w-full` —— 原来主行无宽度类，宽度=内容宽（1600 下仅 578px），
           导致右组的 `ml-auto` **完全失效**：搜索框与头像贴在面包屑后面，
           顶栏右侧留下约 800px 空白（画板 02 要求「搜索 + 头像」贴右）。
        2) `h-14 md:h-full` —— 手机档 header 已是自动高（两行），`h-full` 在
           自动高父级里退化为 auto；显式 `h-14` 保证第一行恒为 56。
      */}
      <div className="flex h-14 w-full shrink-0 items-center gap-3 px-4 md:h-full md:gap-3 xl:gap-4 xl:px-6">
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

        {/* 右组：搜索 + ⋮更多（仅手机档 <md）+ 身份头像。
            app-no-drag：本容器自身不是 button/input，若不豁免则其内边距区域会
            拖拽窗口而不是留给子按钮命中（画板 02 顶栏右组是搜索 + 头像两块）。 */}
        <div className="app-no-drag ml-auto flex shrink-0 items-center gap-3 xl:gap-4">
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

          {/* ⋮更多（**仅手机档 <768** 才渲染；≥768 由根节点 md:hidden 隐去）。
              旧表述「<xl 才渲染；≥xl 由 xl:hidden 隐去」已失效（v0.7 T04 · P0-17）：
              上界由 1280 下移到 768，被删掉的是**平板档**——画板 10 的平板顶栏
              只有「汉堡 + 品牌 + 搜索入口 + 头像」，没有 ⋮。
              顶栏齿轮「设置」按钮已移除——画板 02/03/06/07/12/14 顶栏均无该按钮，
              设置入口在侧栏底部（Sidebar.tsx），此处不再重复。 */}
          <MobileMoreMenu />
          <MemberIdentityPicker />
        </div>

        {/* Electron 自绘标题栏的窗口三键避让位（仅 Windows 桌面端渲染）。
            叠加层三键由系统绘制、浮在内容之上，不避让会盖住**头像**。
            （避让清单里不含 ⋮更多：自绘标题栏只在桌面 ≥1280 出现，而 ⋮ 现在只在
              手机档 <768 渲染，两者档位互斥，永不重叠。） */}
        {usesTitleBarOverlay() && (
          <div
            className="shrink-0"
            style={{ width: WINDOW_CONTROLS_WIDTH }}
            aria-hidden
          />
        )}
      </div>

      {/* 手机第⼆⾏（<768）：整宽搜索框，高 36 / 圆角 12 / pad 0 12 / gap 8。
          app-no-drag：整行仅一个搜索框，容器留白同样不该拖窗口。 */}
      <div className="app-no-drag flex h-11 w-full shrink-0 items-center px-4 md:hidden">
        <SearchField inputRef={mobileSearchRef} className="w-full rounded-xl" />
      </div>
    </header>
  );
}
