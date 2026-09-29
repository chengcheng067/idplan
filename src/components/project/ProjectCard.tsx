import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarRange, MoreHorizontal, Archive, Palette, Trash2 } from 'lucide-react';

import type { Member, Project, Stage, Task } from '../../core/types/entities';
import { taskIsDone } from '../../core/types/entities';
import { effectiveDomainOf } from '../../core/project/visibility';
import { domainLabel } from '../contract-wizard/DomainCascade';
import { DOMAIN_LABELS } from '../contract-wizard/DomainCascade';
import { useRoleGuard, isRestrictedView, taskAssigneeIds } from '../../hooks/useRoleGuard';
import { currentStageOf, computeProjectPercent, computeProjectStatus } from '../../lib/progress';
import { useRepos } from '../../hooks/useRepos';
import { createProjectActions } from '../../store/useProjectsStore';
import { useNavigate } from 'react-router-dom';
import { AvatarStack } from '../common/AvatarStack';
import { PrintPreviewDialog } from '../print/PrintPreviewDialog';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ImeInput } from '../common/ImeInput';
import { Modal } from '../common/Modal';
import { Tag } from '../ui/Tag';
import { stageSolidColor } from '../timeline/stageColors';
import { customStageColor } from '../timeline/stageColorKey';
import { ProjectAppearanceDialog } from './ProjectAppearanceDialog';
import { cn } from '../../lib/cn';
import { ANCHOR_GAP, resolveAnchoredPosition } from '../../lib/anchoredPosition';

/**
 * 项目卡片（规格 §2.5 项目卡片网格 + 画板 02）：
 *   bg-paper + shadow-raised；桌面 圆角24 / 高185，平板 圆角12 / 高124（flex-wrap，不写死列数）；
 *   信息架构 = 项目名(15/600) → 委托方(13 次级) → 阶段进度轨道(高8，多段按比例拼接，槽 sunken) →
 *   底部元信息行(周期 11 + 阶段标签 + 成员头像组)。
 * 阶段色走 STAGE_BAR_COLORS（实心块 main 色），阶段标签走 Tag（stageIndex 取 lightBar + lightText）。
 * 状态语义色全部走 token，禁止裸 hex。选中态 = 主色环。
 *
 * ⋯ 更多菜单（仅 admin）：重命名 / 导出日程表 / 归档 / 删除，复用既有 Modal / ConfirmDialog。
 * 卡片原 <button> 改 div[role=button] + keydown 可达，⋯ 触发器独立 <button> 并 stopPropagation。
 *
 * ── v0.7-D：成员导出日程表入口 ──
 *   用户已拍板「放开成员打印（只读导出）」，故成员侧需有自己的入口。管理员的 ⋯ 菜单
 *   **整体保持 admin-only**（内含重命名 / 侧栏方块外观 / 归档 / 删除四个**写操作**，
 *   放开容器等于把四个写口一起暴露给成员），因此这里为成员单独渲染一个图标按钮，
 *   只做「新窗口打开 /project/:id/schedule-print」（与详情页「日程表」按钮同目标）。
 *   判据用 `isMember`（= role === 'member'，useRoleGuard 的既有导出）：
 *   未进入身份（role=null）**不**渲染，与打印页守卫的「未进入不放行」同档。
 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨';

/** ⋯ 菜单声明宽度（`w-44` = 176px）。尺寸实测前用它做锚定兜底，保证首帧不越界 */
const MENU_WIDTH = 176;
/** 菜单**内容高度**兜底（5 项 × ~36 + padding）。仅用于首帧预判是否翻转，实测后即被替换 */
const MENU_FALLBACK_HEIGHT = 208;

/** 状态 → 文字语义色（用于进度百分比与逾期日期文字） */
const STATUS_TONE = {
  in_progress: { text: 'text-pine' },
  completed: { text: 'text-stage-s1' },
  overdue: { text: 'text-clay' },
  not_started: { text: 'text-mist' },
} as const;

function daysBetween(fromIso: string, toIso: string): number {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / MS);
}

export function ProjectCard({
  project,
  stages,
  tasks,
  members,
  todayIso,
  selected = false,
  onOpen,
}: {
  project: Project;
  stages: Stage[];
  tasks: Task[];
  members: Member[];
  todayIso: string;
  selected?: boolean;
  onOpen(): void;
}): JSX.Element {
  const { role, isAdmin, isMember } = useRoleGuard();
  const memberView = isRestrictedView(role);
  const repos = useRepos();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  // 0.8.4 打印内置化：卡片与下拉的日程表入口改应用内预览面板
  const [printPreviewId, setPrintPreviewId] = useState<string | null>(null);
  /**
   * 菜单锚点（视口坐标，portal 到 body 后必须自己算位置）。
   * ★ 反馈 #3：菜单必须出现在**触发点**附近 —— 左键取按钮矩形、右键取本次点击坐标。
   *   此前右键分支只 `setMenuOpen(true)`，沿用上一次的 `menuPos`（或 null ⇒ 直接不渲染），
   *   右键在卡片空白处时菜单会跑到别处甚至不出现。
   */
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  /** 菜单实测尺寸：锚定定位需要它才能翻转/夹取 */
  const [menuSize, setMenuSize] = useState<{ width: number; height: number } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** v0.7 B1：侧栏方块外观（简称 + 自定义色）编辑弹窗 */
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  /** portal 出去的菜单面板本体：外点判定必须**同时**看触发包裹与面板，否则点菜单项会自杀式关闭 */
  const menuPanelRef = useRef<HTMLDivElement>(null);

  const actions = createProjectActions(repos);

  const cur = currentStageOf(stages, todayIso);
  const percent = computeProjectPercent(stages);
  const status = computeProjectStatus(project, stages, todayIso);
  const tone = STATUS_TONE[status];

  // 参与人：当前阶段未完成任务的执行人 + 阶段负责人（沿用 v0.3 口径，成员受限时 mask 姓名）
  const stageMembers = members.filter((m) => m.active && (!cur?.ownerId || m.id === cur.ownerId));
  const activeMemberIds = new Set(
    tasks
      .filter((t) => cur && t.stageId === cur.id && !taskIsDone(t))
      .flatMap((t) => taskAssigneeIds(t)),
  );
  const cardMembers = members.filter(
    (m) => activeMemberIds.has(m.id) || (cur?.ownerId && m.id === cur.ownerId),
  );

  /*
   * 原来这里显示「类型」（`Project.type`）—— 那是「业态（餐饮/民宿…）+ 设计专业（室内/景观…）」
   * 混在一个字段里的旧模型，已按用户决策删除（统一到三层分类：行业大类 → 主板块 → 关联板块）。
   * 改为显示**主板块名**：`effectiveDomainOf` 是 domain 的唯一出口（见 `core/project/visibility.ts`），
   * 中文化走 `domainLabel`（`DOMAIN_LABELS` 的唯一出处，未覆盖的将来领域原样显示不崩）。
   * ★ 刻意**不是**直接删掉标签：删了会让卡片少一个信息位，用户就再也看不出这个项目属哪个板块。
   */
  const domainText = domainLabel(effectiveDomainOf(project));
  const clientText = !memberView && project.clientName
    ? `${domainText} · ${project.clientName}`
    : domainText;

  const stageLabel = cur ? `${CIRCLED[cur.orderIndex - 1] ?? cur.orderIndex} ${cur.name}` : '全部完成';
  const dueIso = cur?.endAt.slice(0, 10) ?? project.plannedEndAt;
  const dueMd = dueIso.slice(5).replace('-', '-');
  const overdueDays = daysBetween(dueIso, todayIso);
  const dueText = overdueDays > 0 ? `逾期 ${overdueDays} 天` : `${dueMd} 到期`;

  // 阶段进度轨道：可见阶段按工期占比拼接多段（实心块 main 色）
  const visibleStages = stages.filter((s) => s.visible !== false);
  const ordered = [...visibleStages].sort((a, b) => a.orderIndex - b.orderIndex);
  const segs = ordered.map((s) => {
    const s0 = Date.parse(s.startAt ?? '');
    const e0 = Date.parse(s.endAt ?? '');
    const dur = Number.isFinite(s0) && Number.isFinite(e0) ? Math.max(e0 - s0, 1) : 1;
    /*
      v0.8 BUG-06：进度轨道段接上自定义色通路。
      色值与属性必须**成对**取（只写一半 ⇒ var() 解析为空 ⇒ 整段透明），
      故用 `customStageColor()` 一次取齐，不拆成两次判定。

      ⚠️ 第二个形参刻意传 `null`（**不**传 `s.colorIndex`）：本处改造前是
      `STAGE_BAR_COLORS[s.orderIndex]`，而 `stageSolidColor` 内部走
      `resolveStageColorIndex(orderIndex, colorIndex)` —— 只有传 null 才会回落到
      「按 orderIndex 夹取」，与改造前**逐字节同值**。传 colorIndex 会在
      `colorIndex !== orderIndex` 的阶段上静默换色（超出本笔「补接」范围）。
    */
    const paint = customStageColor(s.customColor);
    return { dur, color: stageSolidColor(s.orderIndex, null, s.customColor), attrs: paint.attrs };
  });
  const total = segs.reduce((a, s) => a + s.dur, 0) || 1;

  /**
   * 本项目当前阶段色 —— 侧栏方块「跟随阶段色」时的取值（v0.7 B1）。
   * 与 Sidebar 折叠态方块的回落口径一致：取最早可见阶段的实心块色。
   * 本文件既有 segs 也用「按 orderIndex 取实心块」的口径，故此处沿用同一口径，
   * 不额外引入 resolveStageColorIndex（避免同一文件出现两套取色约定）。
   *
   * v0.8 BUG-06：本值唯一的消费方是 ProjectAppearanceDialog 里的两个色块，
   * 而真正的 DOM 元素在那边 ⇒ **属性必须跟着色值一起传过去**，只传色值会让它变透明。
   * 故这里同时算出 `accentPaint.attrs`，与 segs 走同一套成对口径。
   */
  const accentStage = ordered[0] ?? null;
  const accentPaint = customStageColor(accentStage?.customColor ?? null);
  const stageAccentColor = stageSolidColor(
    accentStage?.orderIndex ?? 1,
    null,
    accentStage?.customColor ?? null,
  );

  // 菜单打开后量一次尺寸（锚定定位需要）；尺寸不变则不 setState，避免重渲染循环
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const el = menuPanelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuSize((prev) =>
      prev && prev.width === rect.width && prev.height === rect.height
        ? prev
        : { width: rect.width, height: rect.height },
    );
  }, [menuOpen]);

  // 外点关闭菜单
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      const t = e.target as Node;
      // ⚠️ 菜单现在是 portal 到 body 的，**不在 `menuRef` 内部**：
      //    只判 `menuRef` 会把「点菜单项」当成外点 → 菜单一闪即关（自杀式关闭）。
      //    故触发包裹与面板本体的命中都要算「内部」。
      const insideTrigger = !!menuRef.current?.contains(t);
      const insidePanel = !!menuPanelRef.current?.contains(t);
      if (!insideTrigger && !insidePanel) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const confirmRename = (): void => {
    const v = renameValue.trim();
    if (v && v !== project.name) void actions.updateProject(project.id, { name: v });
    setRenameOpen(false);
    setMenuOpen(false);
  };

  const openMenu = (e: React.MouseEvent): void => {
    e.stopPropagation();
    /*
     * portal 出去的菜单没有可继承的定位祖先，必须在**打开时**自己量一次视口坐标。
     * 锚点取触发按钮的左下角（与旧 `right-0 top-full` 观感一致：从按钮下方展开）。
     */
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuAnchor({ x: rect.right - MENU_WIDTH, y: rect.bottom + ANCHOR_GAP });
    setMenuOpen((v) => !v);
  };

  // 右键直接打开菜单（仅 admin 可见卡片场景）；阻止默认浏览器上下文菜单
  const openContextMenu = (e: React.MouseEvent): void => {
    if (!isAdmin) return;
    e.preventDefault();
    e.stopPropagation();
    // ★ 用**本次**指针坐标当锚点：菜单出现在鼠标处，而不是沿用上一次的位置
    setMenuAnchor({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  };

  /**
   * 菜单最终位置：以锚点为「希望起始处」，空间不足翻转、越界夹取。
   * 尺寸未量到之前用菜单的声明宽度兜底（w-44 = 176），保证首帧也在视口内。
   */
  const menuPos = useMemo(() => {
    if (!menuAnchor) return null;
    const vv = window.visualViewport;
    return resolveAnchoredPosition({
      anchor: menuAnchor,
      panel: menuSize ?? { width: MENU_WIDTH, height: MENU_FALLBACK_HEIGHT },
      viewport: {
        width: vv?.width ?? window.innerWidth,
        height: vv?.height ?? window.innerHeight,
      },
    });
  }, [menuAnchor, menuSize]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      onContextMenu={openContextMenu}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        // Soft UI 卡片：bg-paper + shadow-raised；Cloud Float 悬浮上浮 + 选中态主色环
        'group flex w-full min-w-0 cursor-pointer flex-col bg-paper shadow-raised',
        'rounded-md p-4 gap-[10px] h-[124px]',
        'md:w-[calc(50%-10px)]',
        // 桌面列宽：规格 §2.5 明确写「卡片宽 365、高 185」，并注明
        // 「365 是 1440 下的固定稿宽，实现时用 flex: 1 1 340px 让列数随容器自适应」。
        // 这个 340 的基准是**精确校准过的**：内容区 = 1440 − 侧栏 240 − 内边距 64 = 1136，
        //   3 张：340×3 + gap 20×2 = 1060 ≤ 1136 → 放下，且各自伸展到 (1136−40)/3 = 365.3 ✓
        //   4 张：340×4 + gap 20×3 = 1420 > 1136 → 放不下，自动换行
        // 所以 1440 下恰好是 3 列 × 365。若写成 flex-1（= flex: 1 1 0%），
        // 基准宽度变 0、四张卡全挤进一行各 279px，与规格差一整列 —— 这是曾经的实现。
        'xl:w-auto xl:flex-[1_1_340px] xl:h-[185px] xl:rounded-3xl xl:p-6 xl:gap-3',
        'transition-all duration-300 ease-in-out hover:-translate-y-1 hover:shadow-raised-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/50',
        /*
         * 菜单已改为 `createPortal` 送到 `document.body`（见 `renderMenu`），
         * 故**卡片本身不需要再提升层级** —— 这里刻意不加 `relative z-30`。
         *
         * 为什么不能用「给卡片加 z-index」这种就地提升：
         *   ① 它只解决「同级卡片」这一个场景，卡片外还有 Sidebar(z-30)/TopBar(z-40)/Toast(z-50)
         *      等一堆浮层，正整数 z-index 一旦叠上去就要和它们排队，属于换个地方埋雷；
         *   ② 菜单离开卡片子树后，**祖先的任何层叠上下文都管不到它**，才是根治。
         * 判据（不变式）：菜单 DOM 必须挂在 `document.body` 下，且 z-index 落在
         *   「浮层专用档位」内（本仓约定：Modal center=70 / 指派浮层=65 / 抽屉=60，见 Modal.tsx）。
         */
        selected && 'ring-2 ring-pine/50',
      )}
    >
      {/* 标题行：项目名 + ⋯ 更多菜单（独立 button + stopPropagation） */}
      <div className="flex w-full items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink group-hover:text-pine">
          {project.name}
        </span>
        {/* v0.7-D：成员（role==='member'）的「导出日程表」入口——只读导出，与详情页同目标。
            stopPropagation 必需：外层 role=button 的 onClick 会跳详情页，不拦就变成"点导出跳详情"。 */}
        {isMember && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPrintPreviewId(project.id);
            }}
            aria-label="导出日程表"
            title="打印预览（应用内面板，只读导出）"
            className="shrink-0 rounded-full p-1.5 text-mist transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:bg-sunken hover:text-pine"
          >
            <CalendarRange size={16} aria-hidden />
          </button>
        )}
        {isAdmin && (
          <div ref={menuRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={openMenu}
              aria-label="项目更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="rounded-full p-1.5 text-mist transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:bg-sunken hover:text-pine"
            >
              <MoreHorizontal size={16} aria-hidden />
            </button>

            {menuOpen &&
              menuPos &&
              createPortal(
                <div
                  ref={menuPanelRef}
                  role="menu"
                  /*
                   * ★ portal 到 body + fixed 定位（本仓既有范式：`Modal.tsx:107`、
                   *   `TaskChecklist.tsx:202` 的指派浮层）。这样菜单**脱离卡片子树**，
                   *   相邻卡片 hover 时新建的层叠上下文再也盖不到它（用户反馈 #1）。
                   * z-[65] = 浮层专用档位（Modal center 70 / 指派浮层 65 / 抽屉 60），
                   *   刻意低于居中弹窗 70，避免菜单压在确认框之上。
                   * `print:hidden`：打印路由绝不出现浮层。
                   */
                  className="glass-medium menuFadeIn print:hidden fixed z-[65] w-44 overflow-hidden rounded-2xl border border-line py-1.5 shadow-overlay"
                  // ★ 反馈 #3：改用锚点算出的 left/top（含翻转与夹取），不再用 right 反推
                  style={{ top: menuPos.top, left: menuPos.left }}
                >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setRenameValue(project.name);
                    setMenuOpen(false);
                    setRenameOpen(true);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-sunken"
                >
                  项目重命名
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-project-appearance-trigger=""
                  onClick={() => {
                    setMenuOpen(false);
                    setAppearanceOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-sunken"
                >
                  <Palette size={14} className="text-mist" aria-hidden />
                  侧栏方块外观
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setPrintPreviewId(project.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-sunken"
                >
                  <CalendarRange size={14} className="text-mist" aria-hidden />
                  导出日程表
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={project.status !== 'active'}
                  onClick={() => {
                    setMenuOpen(false);
                    setArchiveOpen(true);
                  }}
                  className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm text-ink hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Archive size={14} className="text-mist" aria-hidden />
                  归档项目
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteOpen(true);
                  }}
                  className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm text-clay hover:bg-clay-soft"
                >
                  <Trash2 size={14} aria-hidden />
                  删除项目
                </button>
                </div>,
                document.body,
              )}
          </div>
        )}
      </div>

      {/* 委托方（成员受限视图隐藏客户名，沿用既有语义） */}
      <span className="w-full truncate text-[13px] text-mist">{clientText}</span>

      {/* 阶段进度轨道：高 8，槽 sunken，多段按工期占比拼接（实心块 main 色） */}
      <div className="flex w-full flex-col gap-1">
        <div className="flex w-full items-center justify-between text-[12px]">
          <span className="text-mist">进度</span>
          <span className={cn('font-medium', tone.text)}>{Math.round(percent)}%</span>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-sunken">
          {segs.map((s, i) => (
            <div
              key={i}
              data-stage-track-seg=""
              className="h-full"
              style={{ width: `${(s.dur / total) * 100}%`, backgroundColor: s.color }}
              /* 通路 B 的第二个半件：与上面的 `s.color` 成对，缺一则 var() 解析为空 */
              {...s.attrs}
            />
          ))}
        </div>
      </div>

      {/* 底部元信息行：周期 + 阶段标签 + 成员头像组 */}
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11px] text-mist">{dueText}</span>
          {cur && (
            /* ⚠️ `stageSlotOf` 的入参口径是 **1-based**（`orderIndex` / `colorIndex` /
               `resolveStageColorIndex()` 三者同源），故这里直接传 `orderIndex`。
               历史上这里传过 `orderIndex - 1`（0-based）：那是在 `stageSlotOf` 还多做一次
               `+1` 的时候，两者**互相抵消**才碰巧正确；`stageSlotOf` 去掉多余的 +1 之后
               （见 stageColors.ts 的说明），这里必须同步去掉 `- 1`，否则本卡片的阶段色签
               会整体错位一格。净视觉：1..9 全部逐字节不变（旧 `slot(orderIndex-1)` = 新 `slot(orderIndex)`）。 */
            <Tag stageIndex={cur.orderIndex}>{stageLabel}</Tag>
          )}
        </div>
        <AvatarStack
          members={cardMembers.length > 0 ? cardMembers : stageMembers}
          maskMemberNames={memberView}
        />
      </div>

      {/* 重命名弹窗 */}
      <Modal open={renameOpen} onClose={() => setRenameOpen(false)} ariaLabel="项目重命名">
        <div className="glass-strong iridescent-border dialog-pop w-full max-w-md rounded-3xl p-6 shadow-overlay outline-none">
          <h2 className="font-display text-display-md">项目重命名</h2>
          <p className="mt-1 text-xs text-mist">修改后将同步到项目详情与所有视图。</p>
          <ImeInput
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename();
            }}
            placeholder="输入新的项目名称"
            aria-label="新的项目名称"
            className="soft-input mt-4 w-full rounded-2xl px-4 py-3 text-sm text-ink outline-none placeholder:text-mist"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRenameOpen(false)}
              className="soft-btn-ghost rounded-2xl px-5 py-2.5 text-sm font-medium transition-all duration-200 ease-in-out hover:-translate-y-0.5"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmRename}
              disabled={!renameValue.trim() || renameValue.trim() === project.name}
              className="soft-btn-primary rounded-2xl px-5 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:shadow-none"
            >
              保存
            </button>
          </div>
        </div>
      </Modal>

      {/* 侧栏方块外观编辑（v0.7 B1）：简称 + 自定义方块色，独立弹窗（刻意与重命名分开） */}
      <ProjectAppearanceDialog
        open={appearanceOpen}
        project={project}
        stageAccentColor={stageAccentColor}
        stageAccentAttrs={accentPaint.attrs}
        onClose={() => setAppearanceOpen(false)}
        onSave={(patch) => void actions.updateProject(project.id, patch)}
      />

      {/* 归档确认（danger 变体） */}
      <ConfirmDialog
        open={archiveOpen}
        title="归档项目"
        confirmText="归档"
        danger
        onConfirm={() => {
          void actions.setArchived(project.id, true);
          setArchiveOpen(false);
        }}
        onCancel={() => setArchiveOpen(false)}
      >
        确认归档「{project.name}」？归档后将从首页列表隐藏（可在「已归档」区恢复）。
      </ConfirmDialog>

      {/* 永久删除确认（danger 变体，明确不可恢复） */}
      <ConfirmDialog
        open={deleteOpen}
        title="删除项目"
        confirmText="删除"
        danger
        onConfirm={() => {
          void actions.removeProject(project.id, project.name);
          setDeleteOpen(false);
        }}
        onCancel={() => setDeleteOpen(false)}
      >
        确认删除「{project.name}」？该项目下的所有阶段、任务与操作记录将一并永久删除，{' '}
        <span className="font-medium text-clay">不可恢复</span>。建议先归档而非删除。
      </ConfirmDialog>
      {/* 0.8.4 打印内置化：应用内打印预览（日程表纸面与独立路由共用） */}
      <PrintPreviewDialog
        projectId={printPreviewId ?? ''}
        open={printPreviewId !== null}
        onClose={() => setPrintPreviewId(null)}
      />
    </div>
  );
}
