import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Maximize2, Menu, Minus, Minimize2, Search, X } from 'lucide-react';
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
 * ── Electron 自绘标题栏（2026-09-23 起：自绘三键，告别原生叠加层）──
 *   `titleBarStyle:'hidden'`（见 electron/main.cjs）之后，**窗口失去默认可拖拽区域**，
 *   必须由 CSS 提供，否则用户无法移动窗口。故 `<header>` 声明 `.app-titlebar-drag`，
 *   其中交互元素由 global.css 的后代选择器统一回退为 `no-drag`（漏一个就表现为
 *   「那个按钮点不动」）。
 *   窗口三键（最小化/最大化/关闭）由本文件末尾的 `WindowControls` **自绘**：
 *   · 为什么不再用原生 titleBarOverlay：叠加层由系统合成器画在网页之上，DOM 模态
 *     遮罩盖不住它——弹窗一开背景压暗、三键亮度不变，像贴上去的（2026-09-23 用户
 *     投诉；此前的 0.55× 压暗近似方案见 git 历史，必然修不好，原因是结构性的）。
 *   · 自绘后三键与内容同层同源：随主题换色、随遮罩变暗，一类问题整类消失。
 *   · 三键总宽 138px（3×46，Windows 10/11 标准命中宽），与旧避让位同宽——
 *     头像等右组元素位置因此**零位移**。
 *   · 仅 Windows 自绘；macOS（红绿灯）/ Linux（桌面装饰）维持系统原生，不渲染。
 */

/**
 * 自绘窗口三键的总宽（3 × 46px，Windows 10/11 标准命中宽）。
 * 该宽度即三键容器自身占位——旧实现是「给原生叠加层留避让位」（三键系统绘制、
 * 浮在内容之上），现在三键就是 DOM，占位与绘制合一，右组元素位置零位移。
 * 仅 Windows 桌面端渲染；浏览器 / NAS 端没有窗口三键，不留白。
 */
const WINDOW_CONTROLS_WIDTH = 138;

/** 是否处于「自绘窗口三键」环境：桌面端且平台为 win32（与 main.cjs 的判定同源） */
function usesSelfDrawnWindowControls(): boolean {
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
    <header
      // 双击顶栏空白处 = 最大化/还原切换（Windows 原生标题栏的标配行为；
      // 自绘后必须自己补上，否则用户失去这条肌肉记忆）。
      // 守卫：落在交互元素上的双击不放行（按钮点两次是点击，不是拖拽意图）——
      // 交互元素本就被 CSS 标为 no-drag，语义上也不该触发窗口操作。
      onDoubleClick={(e) => {
        if (!usesSelfDrawnWindowControls()) return;
        const el = e.target as HTMLElement;
        if (el.closest('button, a, input, select, textarea, [role="button"], [role="tab"], [role="menu"]')) return;
        window.idplan?.windowControls?.toggleMaximize();
      }}
      className="app-titlebar-drag relative z-40 flex shrink-0 flex-col border-b border-line bg-paper print:hidden md:h-14 md:flex-row xl:h-16"
    >
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

        {/* 自绘窗口三键（仅 Windows 桌面端渲染）。
            DOM 按钮、总宽 138px——与旧「原生叠加层避让位」同宽，右组元素零位移。
            三键是 button，被 global.css 的 `.app-titlebar-drag button` 规则自动
            回退为 no-drag，点它们不会误拖窗口。 */}
        {usesSelfDrawnWindowControls() && (
          <WindowControls width={WINDOW_CONTROLS_WIDTH} />
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

/**
 * 自绘窗口三键（最小化 / 最大化⇄还原 / 关闭）。
 *
 * ── 为什么自绘（2026-09-23，用户投诉「弹窗一开三键像贴上去的」）──
 * 此前三键是 Windows 原生 titleBarOverlay：系统合成器画在网页**之上**，DOM 模态
 * 遮罩盖不住它，背景压暗时它仨亮度不变。压暗近似方案（0.55× 乘）修不好——
 * 乘出来的灰 ≠ 遮罩合成的灰，仍是两块色。自绘后三键与内容同层同源，
 * 随主题/遮罩自然变暗，一类问题整类消失（文件头有完整说明）。
 *
 * ── 行为契约 ──
 *   · 每键 46×全高（Windows 10/11 标准命中宽），总宽 138px 由入参给定；
 *   · 最大化态图标联动：初值 `isMaximized()` 查询 + `onMaximizeChange` 订阅
 *     （双击标题栏 / 系统快捷键改态时同样走推送，图标不与实际状态漂移）；
 *   · 关闭键悬停用 clay 白字（Windows 惯例：唯一红色警示键），其余两键悬停 sand；
 *   · 桥不存在（老 preload / 非 Electron）时按钮**照样渲染**但点击空转——
 *     调用方（TopBar）已按 `usesSelfDrawnWindowControls()` 平台门控，正常情况下
 *     桥必然存在；这层兜底防的是「桥被热更新换掉」这类边界，不承担主门控。
 *   · 键盘可达性：原生 button + aria-label + 焦点环（global.css 焦点环统一）。
 */
function WindowControls({ width }: { width: number }): JSX.Element {
  const controls = window.idplan?.windowControls;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!controls) return;
    let alive = true;
    void controls
      .isMaximized()
      .then((v) => {
        if (alive) setMaximized(v);
      })
      .catch(() => undefined);
    const off = controls.onMaximizeChange((v) => setMaximized(v));
    return () => {
      alive = false;
      off();
    };
  }, [controls]);

  const btnBase = 'flex h-full w-[46px] items-center justify-center text-mist transition-colors';

  return (
    <div
      data-window-controls=""
      role="group"
      aria-label="窗口控制"
      /*
       * `bg-paper` + 高 calc(100% + 1px)：顶栏 h-14/h-16 含 1px 底边框，行内容盒
       * 因此是 55/63——若只拿 h-full，三键比原生标题栏矮 1px，且边框线会从按钮
       * 底下穿过（原生叠加层时代系统按 64 高绘制、连边框段一起覆盖，观感无分割）。
       * 这里把按钮组向下多绘 1px 并以纸面底色盖住边框段：悬停高亮也随之覆盖整段，
       * 与 Windows 原生Caption 观感一致。QA 几何验收（Q-A1-4/5）钉 64/56 两个值。
       */
      className="flex shrink-0 items-stretch bg-paper"
      style={{ width, height: 'calc(100% + 1px)' }}
    >
      <button
        type="button"
        data-window-control="minimize"
        aria-label="最小化"
        title="最小化"
        onClick={() => controls?.minimize()}
        className={cn(btnBase, 'hover:bg-sand hover:text-ink')}
      >
        <Minus size={16} aria-hidden />
      </button>
      <button
        type="button"
        data-window-control="maximize"
        aria-label={maximized ? '还原' : '最大化'}
        title={maximized ? '还原' : '最大化'}
        onClick={() => controls?.toggleMaximize()}
        className={cn(btnBase, 'hover:bg-sand hover:text-ink')}
      >
        {maximized ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
      </button>
      <button
        type="button"
        data-window-control="close"
        aria-label="关闭"
        title="关闭"
        onClick={() => controls?.close()}
        className={cn(btnBase, 'hover:bg-clay hover:text-white')}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
