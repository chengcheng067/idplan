import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { createPortal } from 'react-dom';
import { ChevronsUpDown, LogIn } from 'lucide-react';

import { useSettingsStore } from '../../store/useSettingsStore';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { MEMBER_ROLE_LABELS } from '../../core/types/enums';
import { cn } from '../../lib/cn';
import { resolveAnchoredPosition } from '../../lib/anchoredPosition';
import { titleBarHeight } from '../../lib/topbarMetrics';
import { CHROME_OVERLAY_Z_CLASS } from '../common/Modal';
import {
  CHROME_OVERLAY_TIER,
  isTopOverlay,
  popOverlay,
  pushOverlay,
} from '../../core/overlay/overlayStack';

/** 菜单声明宽度（`w-44` = 176）—— 尺寸量到之前的第一帧兜底 */
const MENU_WIDTH = 176;
/** 菜单高度兜底（两项 + 内边距 + 上下描边）；量到实测值后以实测为准 */
const MENU_FALLBACK_HEIGHT = 80;
/** 与触发按钮的下间距（原 `mt-1`） */
const MENU_GAP = 4;

/**
 * 身份控件（**全站唯一**：「我是谁」的显示 + 切换/退出）。
 *   未进入：「点击进入」→ 按 hasAdmin 打开 admin_prompt 或 name_input；
 *   已进入：头像 + 姓名 + 角色 + 「切换/退出」菜单。
 * 绝不展示其他成员姓名；切换/退出支持同机换人（待明确事项 7 默认允许）。
 *
 * ── ★ 2026-10-12 身份去重：挂载点从顶栏搬到侧栏左下角 ──
 * 用户原话（21:43）：「1. 只保留左下角的『登录人是谁』显示在这里，切换身份也在左下角。
 * 2. 右上角的取消掉。」—— 顶栏胶囊与侧栏身份行**功能完全重复**，删前者。
 *
 * ★ 做法是**加 variant，不是复制一份**。本组件已经装了整套东西（portal 到 body、
 *   锚点定位含翻转与夹取、`aria-haspopup/expanded`、`role=menu`、Esc 只关栈顶、
 *   chrome 档位、外点判定同时看触发包裹与面板本体、`print:hidden`）——见下方 F2 段。
 *   把这些复制到侧栏里去，就是再造一个「下次改动只会改到一份」的孪生实现
 *   （本仓已经为这类孪生付过代价：身份菜单与 MobileMoreMenu 此前就是两份同构代码）。
 *   所以此处**只让触发器的外观可切换**，菜单、行为、层级一律共用。
 *
 *   · `topbar`          —— 顶栏胶囊（保留给 `MobileMoreMenu` 之外的既有调用与既有 spec；
 *                          本轮顶栏已不再渲染它，见 `TopBar.tsx`）
 *   · `rail`            —— 侧栏身份行（h-52 / sunken 底 / 圆角 12 / 头像 28 / 姓名 13 + 角色 11，
 *                          **逐字保持**原纯展示 div 的几何）；未进入时同位置给「点击进入」
 *   · `rail-collapsed`  —— 收起态（宽 64）那枚头像；未进入时给一枚进入图标 + tooltip
 *
 * ⚠️ 侧栏身份行住在**屏幕底部** ⇒ 菜单必须**向上**展开（顶栏那份是向下）。
 *    翻转由 `resolveAnchoredPosition` 承担，判据是「下方余量不足且上方更宽裕」——
 *    侧栏行贴着视口下沿，该条件恒成立。已真机验证底部夹紧不越界（见 spec）。
 * ⚠️ 收起态那枚**原本是 `<Link to="/">`（点头像回首页）**，改成本控件后该行为消失。
 *    这是**有意的行为变更**（头像本就该是身份控件），已在交付报告里备案给 team-lead。
 *    「回首页」在收起态**没有失联**，它另有**两处**承载（都不是这枚头像）：
 *      ① 收起态顶部 **Logo**：`Sidebar.tsx` 里 `<Link to="/" aria-label="ID Plan 首页">`；
 *      ② **导航首项**（`SidebarNav.tsx`）：管理员 `to:'/'`（「项目」）/ 成员 `to:'/member-board'`（「看板」）。
 *    ⚠️ 别把 ① 认错：**收起/展开侧栏是紧邻它的另一枚 `SidebarCollapseToggle`**
 *      （原生 button，`aria-label` 是「展开侧边栏 / 收起侧边栏」），**不是这个 Logo**。
 *      这个误判真发生过一次，所以写在这里。
 *    两处承载都有**真机断言**：`tests/identity-rail-browser.spec.ts` ⑤ 用真鼠标分别点
 *    Logo 与首枚导航，各断言 `location.pathname === '/'`。
 *
 * ── ★ F2（team-lead 2026-10-12 裁决 A / B）：菜单 portal 到 body + chrome 档 ──
 * 修前菜单是 header 内的 `absolute ... z-50`，长在 `TopBar` 的 `relative z-40`
 * **层叠上下文**里。层叠上下文是一道**墙**：里面写多大的 z 都出不去，一律按父级
 * 的 40 与外界比较。于是任何 ≥60 的内容遮罩（设置抽屉 / 打印预览 / 阶段抽屉）
 * 一开，菜单就被压住（还带 25%/45% 暗化）——而**遮罩本身**正是它的点击捕获层：
 * 用户点「切换身份」，命中的是遮罩的 `onMouseDown`（`target === currentTarget`）
 * ⇒ **抽屉被关掉、身份却没换**。用户想切身份，得到的是"抽屉关了"。
 *
 * 裁决明确否掉了两条几何 hack（给顶栏其余区域加兄弟遮罩层 / 给顶栏内容加
 * `pointer-events-none`）：那只是把当前这一层的例外写死，下次再加浮层时必然再破
 * 一次。要走**机制**，本仓已有正确范式：`ProjectCard.tsx` 的卡片菜单就是
 * `createPortal` 到 `document.body` + 固定层级，且**刻意不给卡片加 z-index**
 * （脱离层叠上下文才是根治）。
 *
 * 所以这里做两件配套的事，缺一不可：
 *   ① `createPortal(…, document.body)` + `fixed` 定位（自己的坐标：portal 之后
 *      没有可继承的定位祖先，必须在打开那一刻量一次触发按钮的矩形）；
 *   ② 取 `CHROME_OVERLAY_Z_CLASS`（79 档）—— 高于**一切**内容浮层、低于 toast。
 *      chrome 是常驻界面的一部分，任何时候都在内容之上；而 79 与 toast 的 80
 *      之间正好空着一级，语义自洽：「chrome 在内容之上、反馈在一切之上」。
 *
 * ⚠️ 两个 portal 特有的坑（都踩过，别再踩）：
 *   · **外点判定必须同时看触发包裹与面板本体**。面板已经不在 `rootRef` 里面了，
 *     只判 `rootRef` 会把「点菜单项」当成外点 ⇒ 菜单一闪即关（自杀式关闭）。
 *   · `print:hidden` 现在是**必需**的：portal 之后菜单脱离了宿主元素的
 *     `print:hidden` 子树（顶栏的 header、侧栏的 aside 都有），菜单开着去打印
 *     就会把菜单打进纸里。
 */

/** 触发器外观。菜单与行为**不随它变**（见文件头）。 */
export type IdentityPickerVariant = 'topbar' | 'rail' | 'rail-collapsed';

export interface MemberIdentityPickerProps {
  variant?: IdentityPickerVariant;
}

export function MemberIdentityPicker({
  variant = 'topbar',
}: MemberIdentityPickerProps = {}): JSX.Element {
  const { currentMember, isAdmin, isEntered, hasAdmin } = useRoleGuard();
  const openIdentityFlow = useSettingsStore((s) => s.openIdentityFlow);
  const setCurrentMember = useSettingsStore((s) => s.setCurrentMember);

  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** portal 出去的菜单面板本体（外点判定要它，见文件头第二个坑） */
  const panelRef = useRef<HTMLDivElement>(null);
  /** 打开那一刻量的视口锚点（菜单左上角的目标位置） */
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  /** 菜单实测尺寸：锚定定位要它才能翻转 / 夹取 */
  const [menuSize, setMenuSize] = useState<{ width: number; height: number } | null>(null);

  /*
   * 外点关闭 + Escape 关闭（★ F10）+ **上栈**（★ F2）。
   *
   * 三条合在一个 effect 里，因为它们共用同一份「菜单这次在场的身份」：
   *   · F10：修前这里只有 mousedown，键盘用户按 Esc 关不掉（同样形态的
   *     MobileMoreMenu 早就两样都有），本菜单补齐对齐；
   *   · F2：菜单现在压在所有内容浮层**之上**，所以它必须像 Modal 一样进浮层栈
   *     —— 否则 Esc 会同时打到它和底下的设置抽屉/打印预览（一次按键关两层，
   *     正是 F3 那类症状的翻版）。入栈后 Esc 只关栈顶那一个。
   */
  useEffect(() => {
    if (!menuOpen) return;
    const overlayId = pushOverlay({
      tier: CHROME_OVERLAY_TIER,
      kind: 'chrome',
      // chrome 浮层不参与侧栏让位：侧栏该不该被压住是内容浮层的事
      railExempt: false,
    });
    const onDocClick = (e: MouseEvent): void => {
      const t = e.target as Node;
      // 面板已 portal 出 rootRef，两处都要判（否则点菜单项会自杀式关闭）
      const insideTrigger = !!rootRef.current?.contains(t);
      const insidePanel = !!panelRef.current?.contains(t);
      if (!insideTrigger && !insidePanel) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      // 只让栈顶关自己：菜单开着时按 Esc 不该顺手关掉底下的内容浮层
      if (e.key === 'Escape' && isTopOverlay(overlayId)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
      popOverlay(overlayId);
    };
  }, [menuOpen]);

  /** 量一次面板实测尺寸（异步内容变高时也要跟得上，故盯 menuSize 自身收敛） */
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const el = panelRef.current;
    if (!el) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    setMenuSize((prev) =>
      prev && prev.width === next.width && prev.height === next.height ? prev : next,
    );
  }, [menuOpen]);

  /*
   * 窗口尺寸变化就收起菜单。
   *
   * 菜单是 portal 到 body 的 **fixed** 浮层，坐标在打开那一刻算死；而触发按钮的矩形
   * 会随宽度改变（顶栏：姓名的 `sm:inline`、管理员徽标的 `xl:inline-block`、手机档的
   * 整行搜索；侧栏：容器本身在 `xl` 上下的显隐切换）⇒ 菜单会与按钮错位。
   * 刻意**不监听 scroll**：顶栏与侧栏都不在滚动容器里（根容器 `h-screen + overflow-hidden`，
   * 滚动只发生在 `main`），触发按钮的视口坐标不随页面滚动改变 ——
   * 这里不需要 `ProjectCard` 那条 scroll(捕获) 关闭（那一条是因为卡片住在 main 里）。
   * 侧栏「展开/收起」也不必额外处理：那一枚按钮在 rootRef 之外，点它本身就命中外点关闭。
   */
  useEffect(() => {
    if (!menuOpen) return;
    const onResize = (): void => setMenuOpen(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [menuOpen]);

  /**
   * 菜单最终位置：以「触发按钮右下角往左对齐」为锚点，空间不足翻转、越界夹取。
   * 与修前 `absolute right-0 top-full mt-1` 同观感（从按钮下方展开、右缘对齐）。
   */
  const menuPos = useMemo(() => {
    if (!anchor) return null;
    const vv = window.visualViewport;
    return resolveAnchoredPosition({
      anchor,
      panel: menuSize ?? { width: MENU_WIDTH, height: MENU_FALLBACK_HEIGHT },
      viewport: {
        width: vv?.width ?? window.innerWidth,
        height: vv?.height ?? window.innerHeight,
      },
      // 别翻到自绘标题栏（Windows 三键）那块区域里去
      insetTop: window.idplan?.platform === 'win32' ? titleBarHeight() : 0,
    });
  }, [anchor, menuSize]);

  /**
   * 侧栏那两态住屏幕**底部** ⇒ 菜单向上展开；顶栏胶囊仍向下（原观感）。
   * 注意这里只决定**锚点**，真正把它抬到上方的是 `resolveAnchoredPosition` 的翻转：
   * 它的翻转判据是「下方余量不足且上方更宽裕」，而侧栏行贴着视口下沿 ⇒ 恒成立。
   */
  const opensUpward = variant !== 'topbar';

  const toggleMenu = (): void => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    /*
     * portal 之后没有可继承的定位祖先 ⇒ 打开这一刻自己量一次视口坐标。
     *   · 向下（顶栏）：从按钮下沿起、**右缘对齐**（`rect.right - MENU_WIDTH`）；
     *   · 向上（侧栏）：从按钮上沿起、**左缘对齐**（`rect.left`）。
     * 翻转后的净间距 = MENU_GAP + ANCHOR_GAP（库内固定用 ANCHOR_GAP 做翻转间距），
     * 即"浮层底边离按钮上沿 12px"——只会更远，**不会压住按钮**。
     */
    setAnchor(
      rect
        ? opensUpward
          ? { x: rect.left, y: rect.top - MENU_GAP }
          : { x: rect.right - MENU_WIDTH, y: rect.bottom + MENU_GAP }
        : null,
    );
    setMenuOpen(true);
  };

  const roleLabel = currentMember ? MEMBER_ROLE_LABELS[currentMember.roleKind] : '';

  /** 未进入身份时的动作（三处共用一个口径）：无管理员 → 引导确立；有 → 直接姓名输入 */
  const onEnterIdentity = (): void => {
    if (hasAdmin) openIdentityFlow('name_input', false);
    else openIdentityFlow('admin_prompt', false);
  };

  if (!isEntered) {
    /*
     * 未进入身份：三种外观各给一枚入口。
     * ⚠️ 「点击进入」这四个字是**载荷**：6 个 spec（calendar-anchor / f3-sidebar-identity /
     *   helpers/board-env / member-board-layout / overlay-stack-browser / settings-zones）
     *   与真机助手都按它全页搜按钮 ⇒ 展开态那枚的可见文本必须**逐字**是它，
     *   不能加图标后缀、不能改成「立即进入」之类。
     */
    if (variant === 'rail-collapsed') {
      /*
       * 收起态（64px）放不下四个字，视觉是图标 + tooltip —— 但「点击进入」这四个字
       * 必须**在 DOM 里**，用 `sr-only` 承载。理由不是"迁就测试"：
       *   · ★ 真根因：`useLayoutStore.defaultExpanded()` 是
       *     `matchMedia('(min-width: 1280px)')` ⇒ **1024–1280 这一档侧栏默认就是收起态**。
       *     于是「未进入身份」时，那四个字在窄窗上**根本不在 DOM 里**。
       *     而顶栏那枚（本轮已删）是**任何宽度都渲染文字**的 ⇒ 之前全站搜「点击进入」
       *     总能命中它。删掉顶栏之后，"用文字找入口"这件事在 1024–1280 就断了：
       *     真机实测 `member-board-layout` M-02 / `calendar-anchor` C-01 两例（均在
       *     1152×864）卡在"点完「点击进入」等姓名输入框"超时，其余视口全绿。
       *   · 图标按钮本来就**该有文字替代**（此前只有 `aria-label`，读屏能播报、
       *     但 DOM 里没有文本节点，任何"按文案找"的辅助手段都找不到它）。
       *     所以这里用 `sr-only` 文本当可访问名，比 `aria-label` 更实在：它同时
       *     服务读屏、服务自动化、也服务将来的全文检索。
       */
      return (
        <button
          type="button"
          onClick={onEnterIdentity}
          title="点击进入身份（我的任务按此身份过滤）"
          className="mt-1 flex h-8 w-8 items-center justify-center rounded-full border border-pine text-pine outline-none transition-colors hover:bg-pine-soft focus-visible:ring-2 focus-visible:ring-pine/40"
        >
          <LogIn size={14} aria-hidden />
          <span className="sr-only">点击进入</span>
        </button>
      );
    }
    if (variant === 'rail') {
      return (
        <button
          type="button"
          onClick={onEnterIdentity}
          title="点击进入身份（我的任务按此身份过滤）"
          className="flex h-[52px] w-full items-center justify-center rounded-md border border-dashed border-pine px-2 text-[13px] text-pine outline-none transition-colors hover:bg-pine-soft focus-visible:ring-2 focus-visible:ring-pine/40"
        >
          点击进入
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={onEnterIdentity}
        className="rounded-md border border-pine px-3 py-1.5 text-sm text-pine transition-colors hover:bg-pine-soft"
        title="点击进入身份（我的任务按此身份过滤）"
      >
        点击进入
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      {variant === 'rail' ? (
        /*
         * 侧栏身份行（展开态）。几何**逐字保持**原纯展示 div：
         *   `flex h-[52px] items-center gap-2 rounded-md bg-sunken px-2`
         *   + 头像 28 / 姓名 13 / 角色 11。
         * 只加了交互必需的几项：`w-full`（它在 rootRef 包裹里，不写就撑不满）、
         * `text-left`（**必需**：button 的默认 text-align 是 center，不写会把姓名/角色
         * 居中，就不是"逐字保持"了）、`text-left` 之外的 `outline-none / transition-colors /
         * hover:bg-sand / focus-visible:ring`（纯交互反馈，不动几何）。
         * 刻意**不加 chevron 箭头**：用户要的是"逐字保持"，箭头会改动这一行的视觉。
         * 可点性由 hover 底色 + `aria-haspopup` + tooltip 承载。
         * `title` 与顶栏胶囊**逐字相同** —— 它是 4 个 spec 的载荷选择器
         * （`button[title="当前身份（点击切换/退出）"]`），沿用即让它们免改。
         */
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="当前身份（点击切换/退出）"
          className="flex h-[52px] w-full items-center gap-2 rounded-md bg-sunken px-2 text-left outline-none transition-colors hover:bg-sand focus-visible:ring-2 focus-visible:ring-pine/40"
        >
          {/*
            头像底色来自数据字段（Member.avatarColor），非设计 token——故此处允许裸 hex
            仅作 fallback（与顶栏胶囊一致），避免使用未上传头像时的占位灰。
          */}
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] text-white"
            style={{ backgroundColor: currentMember?.avatarColor ?? '#8A959E' }}
            aria-hidden
          >
            {(currentMember?.name ?? '?')[0]}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] text-ink">{currentMember?.name ?? '未知'}</span>
            <span className="truncate text-[11px] text-mist">{roleLabel}</span>
          </span>
        </button>
      ) : variant === 'rail-collapsed' ? (
        /*
         * 收起态（宽 64）那枚。几何逐字保持原 `<Link to="/">`（h-8 w-8 圆头像 + mt-1），
         * 只把 Link 换成 button —— **这改掉了「点头像回首页」**，是有意的行为变更
         * （头像本就该是身份控件），已在报告里备案。
         * 「回首页」仍可达：顶部 Logo + 导航首项**两处**都指 `/`（详见文件头那条 ⚠️）。
         * tooltip 保留「姓名 · 角色」（收起态唯一能读出"我是谁"的地方），
         * 并补「（点击切换/退出）」提示它现在可点。
         */
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={`${currentMember?.name ?? ''} · ${roleLabel}（点击切换/退出）`}
          aria-label={currentMember?.name}
          className="mt-1 flex h-8 w-8 items-center justify-center rounded-full text-[13px] text-white outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
          style={{ backgroundColor: currentMember?.avatarColor ?? '#8A959E' }}
        >
          {(currentMember?.name ?? '?')[0]}
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleMenu}
          /*
           * ★ F10：这个按钮是**菜单触发器**，读屏必须能播报「菜单、已展开/已收起」
           * （修前只有 title，读屏不会把它当菜单入口）。与 MobileMoreMenu 同口径
           * （`MobileMoreMenu.tsx:114-117`），且面板侧本来就有 role="menu" 语义可配。
           * 刻意**不加 aria-label**：按钮自身的可访问名（头像首字 + 姓名 + 管理员徽标）
           * 已经足够，再写一个反而会遮掉可见文本、且会改掉既有按名字查询按钮的用例口径。
           */
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-2 rounded-md border border-line bg-paper px-2 py-1.5 text-sm shadow-soft transition-colors hover:bg-sand sm:px-3"
          title="当前身份（点击切换/退出）"
        >
          <span
            className="inline-block h-5 w-5 rounded-full text-center text-xs leading-5 text-white"
            style={{ backgroundColor: currentMember?.avatarColor ?? '#8A959E' }}
          >
            {(currentMember?.name ?? '?')[0]}
          </span>
          {/* 姓名在手机上隐藏（顶栏第一行放不下），xl 以下连管理员徽标一起收起 */}
          <span className="hidden max-w-[96px] truncate sm:inline">{currentMember?.name ?? '未知'}</span>
          {isAdmin && (
            <span className="hidden rounded-full bg-pine-soft px-1.5 py-0.5 text-[10px] font-medium text-pine-deep xl:inline-block">
              {MEMBER_ROLE_LABELS.admin}
            </span>
          )}
          <ChevronsUpDown size={14} className="text-mist" />
        </button>
      )}

      {menuOpen &&
        menuPos &&
        createPortal(
          /* role="menu"：让触发按钮上的 aria-haspopup="menu" 有真实落点（同 MobileMoreMenu /
             ProjectCard 的面板口径），否则读屏会播报「菜单」却找不到菜单 */
          <div
            ref={panelRef}
            role="menu"
            aria-label="身份操作"
            /*
             * ★ F2：portal 到 body + fixed 定位 + chrome 档（79）。
             *   详见文件头「裁决 A / B」。层级类名来自 `Modal.tsx` 的静态映射表
             *   （`CHROME_OVERLAY_Z_CLASS` 是 OVERLAY_Z_CLASS[79] 的查表结果），
             *   不许在这里手写一个 z 值 —— 那是把「chrome 高于内容浮层」这条规则
             *   复制成两份，下次调档位只会改到一份。
             *   `print:hidden` 必需：portal 之后它已不在宿主的 print:hidden 子树里
             *   （顶栏 header / 侧栏 aside 都有该子树），菜单开着打印会把菜单打进纸里。
             */
            className={`glass-medium menuFadeIn print:hidden fixed w-44 overflow-hidden rounded-lg border border-line py-1 shadow-soft ${CHROME_OVERLAY_Z_CLASS}`}
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setCurrentMember(null);
                // 退出后重走身份流程：无管理员走引导，否则直接姓名输入（同机换人）
                if (hasAdmin) openIdentityFlow('name_input', false);
                else openIdentityFlow('admin_prompt', false);
              }}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-sand"
            >
              切换身份
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setCurrentMember(null);
              }}
              className="w-full border-t border-line px-3 py-1.5 text-left text-xs text-mist hover:bg-sand"
            >
              退出身份
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
