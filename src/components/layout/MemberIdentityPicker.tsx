import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { createPortal } from 'react-dom';
import { ChevronsUpDown } from 'lucide-react';

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
 * 顶栏身份入口（v0.2 重写：不再渲染成员下拉——下拉会暴露全名单）。
 *   未进入：「点击进入」→ 按 hasAdmin 打开 admin_prompt 或 name_input；
 *   已进入：「当前身份：名字」（首字头像）+ admin 时「管理员」徽标 + 「切换/退出」。
 * 绝不展示其他成员姓名；切换/退出支持同机换人（待明确事项 7 默认允许）。
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
 *   · `print:hidden` 现在是**必需**的：portal 之后菜单脱离了 header 的
 *     `print:hidden` 子树，菜单开着去打印就会把菜单打进纸里。
 */
export function MemberIdentityPicker(): JSX.Element {
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
   * 菜单是 portal 到 body 的 **fixed** 浮层，坐标在打开那一刻算死；而顶栏的
   * 响应式类会随宽度改变（姓名的 `sm:inline`、管理员徽标的 `xl:inline-block`、
   * 手机档的整行搜索），触发按钮的矩形随之变化 ⇒ 菜单会与按钮错位。
   * 刻意**不监听 scroll**：顶栏不在滚动容器里（`h-screen + overflow-hidden`，
   * 滚动只发生在 `main`），触发按钮的视口坐标不随页面滚动改变 ——
   * 这里不需要 `ProjectCard` 那条 scroll(捕获) 关闭（那一条是因为卡片住在 main 里）。
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

  const toggleMenu = (): void => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    // portal 之后没有可继承的定位祖先 ⇒ 打开这一刻自己量一次视口坐标
    setAnchor(rect ? { x: rect.right - MENU_WIDTH, y: rect.bottom + MENU_GAP } : null);
    setMenuOpen(true);
  };

  if (!isEntered) {
    return (
      <button
        type="button"
        onClick={() => {
          // 无管理员 → 引导确立管理员；有管理员 → 直接姓名输入
          if (hasAdmin) openIdentityFlow('name_input', false);
          else openIdentityFlow('admin_prompt', false);
        }}
        className="rounded-md border border-pine px-3 py-1.5 text-sm text-pine transition-colors hover:bg-pine-soft"
        title="点击进入身份（我的任务按此身份过滤）"
      >
        点击进入
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative">
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
             *   `print:hidden` 必需：portal 之后它已不在 header 的 print:hidden 子树里。
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
