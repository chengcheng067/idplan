import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarRange, MoreHorizontal, Archive, Palette, Trash2 } from 'lucide-react';

import type { Member, Project, Stage, Task } from '../../core/types/entities';
import { domainLabel } from '../../core/template/stage-library';
import { taskIsDone } from '../../core/types/entities';
import { StageStatus } from '../../core/types/enums';
import { effectiveDomainOf } from '../../core/project/visibility';
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
 *   ★ 窄版（看板列内，`layout === 'column'`，v1.0.x）同一套信息换一种摆法：头像组从元信息行
 *     上移到委托方行右侧、元信息行只留「到期日 + 阶段胶囊」——见 `layout` 形参注释。
 *   ★ 窄版在**非 xl 断点有自己的一档高度**（168，不是首页的 124）：头像搬进委托方行后那行有了
 *     24px 不可压缩下限，124 会溢出 26px（21% 卡高，会压到下一张卡上）——见下方「非 xl 高度」注释。
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
  layout = 'row',
}: {
  project: Project;
  stages: Stage[];
  tasks: Task[];
  members: Member[];
  todayIso: string;
  selected?: boolean;
  onOpen(): void;
  /**
   * 卡片在外容器中的布局角色（v0.8.6.0002 · 反馈 #10.4 修复）：
   *   'row'    = 首页 flex-wrap 卡片行（默认，行为逐字节不变）：md 半宽 +
   *              xl 吃 flex 1 1 340px 基准（340 是首页 3 列布局的校准值）；
   *   'column' = 看板列内纵向堆叠（成员看板）：宽度撑满列、高度只走固定档
   *              （非 xl 档是**本档专属的 168**、xl 档仍是 185 —— 见 JSX 里的
   *              「非 xl 高度」注释；**不是**首页的 124）。**不能**把上面两个 flex 行专用类带进
   *              列容器——`xl:flex-[1_1_340px]` 的基准在 flex-col 列里会作用
   *              到**纵轴**（卡片被抅到 340px 高），`md:w-[calc(50%-10px)]`
   *              会把卡片压成列宽的一半（标题截断、头像行/Tag 挤烂）。
   *
   * ★ v1.0.x：「column」这一档**不再只是"去掉 row 专用类"**，它同时触发**窄版内部重排**
   *   （看板列 `repeat(auto-fit, minmax(min(100%, 245px), 1fr))`：真机同宽 section **1088**
   *   ⇒ 轨 **260** ⇒ 卡片 **230** / 内容宽 **182**；**最窄轨 245** ⇒ 卡片 **215** / 内容宽 **167**
   *   —— 见 `MemberBoardPage.tsx` 的 `BOARD_COLUMN_TEMPLATE` 注释）：底部元信息行只留
   *   「到期日 + 阶段胶囊」，**头像组搬到委托方行右侧**。两处形态都由本形参门控，
   *   `'row'` 档 DOM 逐字节不变。验收见 `tests/member-board-narrow-card.spec.ts`。
   */
  layout?: 'row' | 'column';
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
  /**
   * 卡片成员行（「当前有哪些人在此项目中」）的取值口径。
   *
   * ★ 2026-10-08 补 `m.active`：与上一行 `stageMembers` 的口径对齐——同文件两条
   * 成员过滤规则原本不一致（stageMembers 滤 active、这里漏了），停用成员只要还有
   * 未完成任务，头像就继续挂在卡片上（她 10-08 点名的第 4 条）。
   *
   * 为什么不是「停用时清任务指派」：本产品**没有成员删除**（唯一出口是停用
   * `setActive(false)`），任务的 assigneeIds 是历史事实，清了就丢了「这活当初
   * 派给过谁」的记录。正确解法是**展示层按当前有效成员收窄**：卡片这行回答的是
   * 「现在有谁在这个项目里」，停用的人不属于现在。
   */
  const cardMembers = members.filter(
    (m) =>
      m.active &&
      (activeMemberIds.has(m.id) || Boolean(cur?.ownerId && m.id === cur.ownerId)),
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

  /*
    ── v1.0.x · 窄版卡片（`layout === 'column'`）的两个搬家件 ──
    两处行内形态都要用到「阶段胶囊」与「头像组」，而窄版要把头像组从底部元信息行
    **搬到委托方行**。为避免同一元素在两处各写一遍（改一处漏一处的经典形态漂移），
    在这里各取一次、下行按 `isColumn` 条件摆放。
    ⚠️ 门控用 `layout === 'column'`（形参语义见上方 `layout` 注释）：本仓**唯一**
    传 `'column'` 的消费点是看板列内的卡片（`MemberBoardPage.tsx`），首页走默认 `'row'`
    ⇒ 首页卡片 DOM 逐字节不变。刻意**不用**容器查询：本仓没有容器查询基建，
    而这里要区分的只是「谁在用这张卡片」这一个已知事实。

    为什么必须搬（真机实测，不是审美偏好）：旧版把头像留在元信息行，该行需要
    「到期日 53 + gap 8 + 阶段胶囊 73.5」+ gap 8 + 头像组（6 + 18n），而窄版卡片内容宽
    只有 **182**（gen5 真机同宽）⇒ **n=2 就要 184.5 > 182**（**最窄轨 245** ⇒ 内容宽 **167**
    那一档只会更放不下：184.5 > 167），于是阶段胶囊折行、到期日被截断
    （失效阈值「所需轨道宽 = 226.5 + 18n」，见 `BOARD_COLUMN_TEMPLATE` 注释）。
    搬走之后元信息行只需 134.5 ≤ **182** ✓（167 那一档同样成立）。
  */
  const isColumn = layout === 'column';

  /** 阶段胶囊（0-based ⇒ 1-based 的口径说明随件移动，勿丢）：
     ⚠️ `stageSlotOf` 的入参口径是 **1-based**（`orderIndex` / `colorIndex` /
     `resolveStageColorIndex()` 三者同源），故这里直接传 `orderIndex`。
     历史上这里传过 `orderIndex - 1`（0-based）：那是在 `stageSlotOf` 还多做一次
     `+1` 的时候，两者**互相抵消**才碰巧正确；`stageSlotOf` 去掉多余的 +1 之后
     （见 stageColors.ts 的说明），这里必须同步去掉 `- 1`，否则本卡片的阶段色签
     会整体错位一格。净视觉：1..9 全部逐字节不变（旧 `slot(orderIndex-1)` = 新 `slot(orderIndex)`）。 */
  const stageTag = cur ? <Tag stageIndex={cur.orderIndex}>{stageLabel}</Tag> : null;

  /** 头像组（两行之间搬家）。取值口径与 `maskMemberNames` 传参**沿既有语义，不许动**：
      成员受限视图下仍走 `memberView`（不暴露其他成员姓名）。

      ── 窄版平铺上限 `max` = 3：由**不变式**解出来的，不是某一档的实测值 ──
      头像组宽 = 6 + 18k（k = 组内 span 数；头像 `h-6 w-6`、叠放 `-space-x-1.5`）。
      ⚠️ 最坏格**不是「顶满 max」**，而是「顶满 max 之后**再多一个成员**」——那时会追加
         `+N` 胶囊，span 数 = max + 1。所以判据必须写成不变式（team-lead 定）：

             **头像组处于最坏格（含 `+N`）时，委托方可用宽 ≥ 90px。**

      窄版卡片内容宽 **182**（gen5 真机同宽：section 1088 ⇒ 轨 260 ⇒ 卡片 230）、委托方行 gap 8
      ⇒ 委托方可用宽 = 182 − 8 − (6 + 18k) = **168 − 18k**。
      （本档最窄的那一格是**最窄轨 245** ⇒ 内容 **167**；下面两栏把它一并核到。）
      令 k = max + 1（最坏格）代入「≥ 90」：
          168 − 18(max + 1) ≥ 90  ⇒  18(max + 1) ≤ 78  ⇒  max + 1 ≤ 4.33  ⇒  max ≤ 3.33
      ⇒ 整数解 **max = 3**（这是满足不变式的最大取值，再小就白扔信息量）。
      逐个复核（**同代两个数都要写**，别只写常用档那一栏）：
          · 真机同宽（内容 182）⇒ 组宽 78 ⇒ 委托方 **96 ≥ 90** ✓
          · 最窄轨（内容 167）⇒ 组宽 78 ⇒ 委托方 **81 < 90** ✗ —— **已登记的取舍**，见下
          max = 4 ⇒ 最坏格 k=5 ⇒ 组宽 96 ⇒ 委托方 **78 < 90** ✗（v1.0.x 差口②，本次收掉）

      ⚠️ 两条纪律，都别丢：
      ① **适用范围是「轨道 ≥ 260」**（gen5 下 = 内容 ≥ 182）—— 上面两栏正是它的两端：轨道 260
         成立、轨道 245 **已知不成立**（team-lead 2026-10-13 定案：保持 `max = 3`，不收成 2 ——
         收窄只会让**常用档**少显示一个头像）。245 那一档只降级（委托方更早省略，它本来就是
         本卡允许单行省略的两个字段之一）、不破形，故是**取舍而非漏修**。
      ② 这是**按不变式解出来的数**：内容宽、判据线 90、或头像尺寸任何一项变了，都要**重算上面
         这条不等式**再改数字，不要只把 3 改成别的。判据线 90 的出处见卡片委托方行注释。
      'row'（首页）档显式传回组件的默认值 4 ⇒ 与不传该 prop **逐字节同渲染**，首页不受影响。 */
  const avatarStack = (
    <AvatarStack
      members={cardMembers.length > 0 ? cardMembers : stageMembers}
      max={isColumn ? 3 : 4}
      maskMemberNames={memberView}
    />
  );

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

  /*
   * 滚动 / 窗口缩放时关闭菜单（★ F9）。
   *
   * 菜单是 portal 到 body 的 **fixed** 浮层，坐标在打开那一刻由 `openMenu` 量一次
   * （`getBoundingClientRect`）算死；它不会跟着卡片走。而卡片住在 `main` 这个全站
   * 唯一滚动容器里 —— 打开菜单后滚动页面，菜单会**悬在原地**与触发按钮彻底错位
   * （用户看到的是「菜单跟卡片分家了」）。
   * 修法与既有范式一致（`TaskChecklist.tsx:111-128` 的指派浮层同款）：
   *   · `scroll` 用**捕获阶段**（`true`）挂 window —— 页面滚动的 `scroll` 事件不冒泡，
   *     只有捕获阶段能收到，否则监听形同虚设；
   *   · `resize` 同样要关（窗口尺寸变了，`menuPos` 的夹取结果也失效）。
   * 本菜单面板是 `overflow-hidden`、内部没有可滚区域，故无需像指派浮层那样再排掉
   * 「弹层内部滚动」（那一条是给 `max-h-48 overflow-y-auto` 的成员列表用的）。
   */
  useEffect(() => {
    if (!menuOpen) return;
    const onScroll = (): void => setMenuOpen(false);
    const onResize = (): void => setMenuOpen(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
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
        'rounded-md p-4 gap-[10px]',
        /*
         * ── 非 xl 高度：两档**分开取**（★ v1.0.x 差口① 修法）──
         *   · `'row'`（首页，行为**逐字节不变**）= `h-[124px]` —— 首页 flex-wrap 行的设计档；
         *   · `'column'`（看板列内）= `h-[168px]` —— 本档专属，理由见下。
         *
         * 根因：124 是**首页 row 档**的高度，看板列档**不该共用它**。窄版把头像组搬进
         * 委托方行之后，那一行有了 **24px 不可压缩下限**（头像 `h-6`），124 装不下
         * （旧版实测：溢出 26px = 21% 卡高，会直接压到下一张卡上；而"把委托方行压成 0 高"
         * 的旧形态同样不可接受——客户名完全看不见）。
         *
         * 算式（非 xl 档：`p-4` 上下 16×2 = 32、`gap-[10px]` × 3 行距 = 30）——**逐行真机实测值**：
         *     标题行 **28** + 委托方行 **24** + 进度块 **30** + 元信息行 **22** = **104**
         *     自然高度（`height: auto`）= 104 + 30 + 32 = **166**
         * 取「实测最小可行值向上取 4 的整数档」⇒ **168**。
         *   · 旧值 124：内容比卡高多 42，其中 **26 越出卡片边框盒** ⇒ 压到下一张卡上；
         *   · 中间态 160（按**估算**行高 22/24/28/22 算出来的）：仍差 6px 才让内容落回内容盒内
         *     —— 估算的两个数都偏小（标题行实际 28 不是 22、进度块实际 30 不是 28）；
         *   · 168：内容盒内余 2px、边框盒内余 18px，上下内边距恢复对称的 16/16。
         * 真机实测：960 / 1024 / 1152 / 1279 四档**均无纵向溢出**（边框盒 −18、内容盒 −2，
         * 即两条判据的实测值都是负的 —— 不是被钳成 0）、委托方行高 24
         * （见 `tests/member-board-narrow-card.spec.ts` 的 N-04，卡高与溢出口径都已钉成断言）。
         *
         * ⚠️ 判据口径（**更正过一条错误因果**，别再照旧版写）：
         *   本档的**主判据**是「**最靠下的子元素下边缘 − 卡片内容盒下边缘**」—— > 0 表示
         *   「内容吃掉了下内边距」，这才是真卡片上会坏、且只有本口径看得见的形态
         *   （156 档 +10；修好的 168 档 **−2**）。「− 卡片边框盒下边缘」（> 0 = 戳出卡外、
         *   压到下一张卡）作为**下限保险**一并留。
         *   ⚠️ `scrollHeight − clientHeight` 与后一条**逐档同值**、**不是坏口径**：真卡片上
         *   子元素 min-content 不可压缩（每档行高都是 [28,24,30,22]，内容只会整体下移）
         *   ⇒ 它 ≡ `max(0, 边框盒溢出)`（`scrollHeight` 按定义不小于 `clientHeight`，负值被钳成 0）。
         *   换几何量的真正理由是**一次测量同时拿到上述两个判据**。旧注写的「它在 flex 容器上
         *   不可靠」是**误读了自己的探针输出**，该因果已作废 —— 完整更正见
         *   `tests/member-board-narrow-card.spec.ts` 的「溢出口径」段与 `probe17.mjs` 的结论段。
         *
         * ⚠️ 写成三元而不是「在 base 里保留 h-[124px]、后面再补一个 h-[168px]」：
         *   两个 `h-*` 工具类同时出现在 class 属性里时，谁生效由 Tailwind **产物里的声明顺序**
         *   决定（不是 class 属性里的先后），靠"后者覆盖前者"是碰运气。三元保证任何时刻
         *   只有一个高度类存在（xl 档仍由 `xl:h-[185px]` 覆盖，与改前同一条通路）。
         */
        layout === 'column' ? 'h-[168px]' : 'h-[124px]',
        // 「row」档专属：首页 flex-wrap 行的半宽 + 340 基准（见 layout 形参注释）
        layout === 'row' && 'md:w-[calc(50%-10px)]',
        // 桌面列宽：规格 §2.5 明确写「卡片宽 365、高 185」，并注明
        // 「365 是 1440 下的固定稿宽，实现时用 flex: 1 1 340px 让列数随容器自适应」。
        // 这个 340 的基准是**精确校准过的**：内容区 = 1440 − 侧栏 240 − 内边距 64 = 1136，
        //   3 张：340×3 + gap 20×2 = 1060 ≤ 1136 → 放下，且各自伸展到 (1136−40)/3 = 365.3 ✓
        //   4 张：340×4 + gap 20×3 = 1420 > 1136 → 放不下，自动换行
        // 所以 1440 下恰好是 3 列 × 365。若写成 flex-1（= flex: 1 1 0%），
        // 基准宽度变 0、四张卡全挤进一行各 279px，与规格差一整列 —— 这是曾经的实现。
        'xl:h-[185px] xl:rounded-3xl xl:p-6 xl:gap-3',
        layout === 'row' && 'xl:w-auto xl:flex-[1_1_340px]',
        /*
         * ★ v0.8.5 C3（排障手实测 Bug 1）：transition-all → 只过渡 transform/box-shadow。
         *   根因：卡片是**布局容器**（xl:flex-[1_1_340px] 随断点变宽），transition-all
         *   把 width 也纳入过渡——跨断点缩放时卡片宽度动画滞后于窗口（实测拖拽
         *   1000→700：83 帧中 53 帧卡片宽度≠应有值，视觉即「挤压回弹」）。
         *   hover 只动 translate + shadow，显式列属性后 width 即时跟随，拖影消失。
         *   全仓其余 7 处 transition-all 是定尺寸小控件（width 不变），无害保留。
         */
        'transition-[transform,box-shadow] duration-slow ease-in-out hover:-translate-y-1 hover:shadow-raised-lg',
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
            className="shrink-0 rounded-full p-1.5 text-mist transition-all duration-base ease-in-out hover:-translate-y-0.5 hover:bg-sunken hover:text-pine"
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
              className="rounded-full p-1.5 text-mist transition-all duration-base ease-in-out hover:-translate-y-0.5 hover:bg-sunken hover:text-pine"
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

      {/* 委托方（成员受限视图隐藏客户名，沿用既有语义）。
          两档形态：
            · row   = 单行 `span`（首页，逐字节不变）；
            · 窄版  = 本行右侧挂**头像组**（v1.0.x 的搬家落点）。选这一行是因为它右侧
              本来就是**死空间**（单行 `span` 的右半永远空着）——
              实测代价只有行高：本行由「文本行高」抬到「头像 24」（这正是本档非 xl 高度
              必须从 124 抬到 168 的原因，见 JSX 开头的「非 xl 高度」注释）。
              判据线（team-lead 定的**不变式**）：头像组处于最坏格（= 顶满 max 后**再多一个
              成员**，那时会追加 `+N` 胶囊）时，委托方可用宽 ≥ **90px**。
              按此解出 `max = 3` ⇒ 最坏格组宽 78（= 6 + 18×4）⇒ 委托方 **96 ≥ 90** ✓
              —— 这个 **96** 是 **gen5 真机同宽**（内容宽 **182**）那一档的数；同一代**最窄轨 245**
              ⇒ 内容宽 **167** 时只有 **81 < 90**，是**已登记的取舍**（适用范围「**轨道 ≥ 260**」；
              推导与不等式在 `avatarStack` 处；max=4 的差口 78 < 90 由此收掉）。 */}
      {isColumn ? (
        <div className="flex w-full items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] text-mist">{clientText}</span>
          {avatarStack}
        </div>
      ) : (
        <span className="w-full truncate text-[13px] text-mist">{clientText}</span>
      )}

      {/* 阶段进度轨道：高 8，槽 sunken，多段按工期占比拼接（实心块 main 色）
          v0.8.6.0002 · 反馈 #10.1 / #10.2：分段上色规则重定——
            未来段（未到达）：不给了色（opacity-0），槽底透出；
            已完成段：阶段色降饱和（opacity-40）；
            当前段：阶段色全饱和 + 1px pine 内描边。
          「现在进行时 = pine」是本仓既有语义（百分比 text-pine、状态胶囊 pine）：
          给当前段描上 1px pine 内圈（rgb(var(--pine-rgb) / 1)，与 text-pine 编译
          结果同色、随 data-theme 切换），pine 就同时出现在百分比与进度条当前段上
          ——她反馈的「'现在进行时'的色彩和上方进度条的色彩有较大的色差，无法匹配上」
          即由此消除；彩虹条收敛为「淡=已过、亮=此刻、空=未来」后，「进度到底走到哪」
          也一目了然。
          ⚠️ 内联 backgroundColor 与 data-stage-key 通路**逐字节不动**
          （tests/stage-color-wiring.spec.tsx ⑦-① 钉的就是这两个值 + 段数）——
          视觉权重全部经 opacity 类与 boxShadow 表达，不改 spec 钉的任何值。 */}
      <div className="flex w-full flex-col gap-1">
        <div className="flex w-full items-center justify-between text-[12px]">
          <span className="text-mist">进度</span>
          <span className={cn('font-medium', tone.text)}>{Math.round(percent)}%</span>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-sunken">
          {segs.map((s, i) => {
            const stage = ordered[i];
            const state: 'done' | 'current' | 'future' =
              cur && stage && stage.id === cur.id
                ? 'current'
                : stage && stage.status === StageStatus.Completed
                  ? 'done'
                  : 'future';
            return (
              <div
                key={i}
                data-stage-track-seg=""
                data-stage-track-state={state}
                className={cn('h-full', state === 'done' && 'opacity-40', state === 'future' && 'opacity-0')}
                style={{
                  width: `${(s.dur / total) * 100}%`,
                  backgroundColor: s.color,
                  ...(state === 'current' ? { boxShadow: 'inset 0 0 0 1px rgb(var(--pine-rgb) / 1)' } : null),
                }}
                /* 通路 B 的第二个半件：与上面的 `s.color` 成对，缺一则 var() 解析为空 */
                {...s.attrs}
              />
            );
          })}
        </div>
      </div>

      {/* 底部元信息行。两档形态（v1.0.x）：
            · row（首页，逐字节不变）：左「周期 + 阶段胶囊」、右「成员头像组」；
            · 窄版：**只留「到期日 + 阶段胶囊」，一左一右铺满整行**（`justify-between`
              把胶囊推到右缘），头像组已上移到委托方行（见该行注释）。
              需宽实测：53 + 8 + 73.5 = 134.5 ≤ **182** ✓（真机同宽，轨 260 / 卡片 230）；
              **最窄轨 245** ⇒ 内容宽 **167** 那一档同样成立（134.5 ≤ 167 ✓）
              —— 这正是搬走头像组换来的余量。 */}
      {isColumn ? (
        <div className="flex w-full items-center justify-between gap-2">
          <span className="truncate text-[11px] text-mist">{dueText}</span>
          {stageTag}
        </div>
      ) : (
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[11px] text-mist">{dueText}</span>
            {stageTag}
          </div>
          {avatarStack}
        </div>
      )}

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
              className="soft-btn-ghost rounded-2xl px-5 py-2.5 text-sm font-medium transition-all duration-base ease-in-out hover:-translate-y-0.5"
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
