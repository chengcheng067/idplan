/**
 * Agent Board 主页（v0.7 · T06 双模式重写；路由 /agent）。
 *
 * ── 两种模式（D2）──
 *
 * **人话模式（默认，PRD §4.1 / §5.4.3 画板 06）**：
 *   ① 顶部一句话「**现在该做什么**」= `computeReadyTasks()` 置顶条（人话标题 + 剩余/逾期
 *      + 脚注「同类可开工 N 项 · 已逾期 M 项」）。
 *      小字计数取**可开工组的桶长度**（不是 `ready.length`）——同一个词在同一屏必须
 *      同一个含义，详见 `现在该做什么` 区块内的注释与验收用例。
 *   ② 四组分区：`待我确认 / 可开工 / 进行中 / 已完成`（顺序恒为 `HUMAN_BOARD_GROUP_ORDER`）
 *      —— **纵向全宽四段**（不是横向多列）。
 *   ③ 埋在组外的 `hidden` 条（`draft ∧ 依赖未满足` = 上游 Agent 还在跑）**不进主列表**，
 *      但**必须给出汇总出口**：四组下方一行「另有 N 条在上游准备中，切到「技术」可查看全部」
 *      —— 否则这类任务在人话模式下凭空消失、用户无从排查（team-lead 裁决必补）。
 *   ④ 依赖环仍给 amber 告警条 —— 环成员同样被归入 hidden，无告警等于在界面上无声消失
 *      （与 ③ 的出口提示互补：③ 解决「还没轮到」，④ 解决「数据坏了」）
 *
 * **技术模式（PRD §4.2「保留现有 7 列泳道，不降级」；画板 07）**：
 *   `ReadyQueue` 置顶区 + `ALL_TASK_STATUSES` 遍历的 7 列 status 泳道（**等宽**）。
 *
 * ── S1：为什么人话四组从「横向 4 列」改成「纵向全宽四段」（PRD §5.4）──
 *   旧实现是 `grid gap-3 md:grid-cols-2 xl:grid-cols-4`。在 1600px 视口下每列只有
 *   约 300px，而卡片里挤着标题 + 负责人 + 剩余天数 + 主按钮 —— 于是换行、截断、
 *   层层堆叠，用户看到的正是「泡泡挤在一起」。根因不是间距不够，是**容器形态错了**：
 *   任务清单是**列表**，不是**矩阵**。
 *   画板 06 给的是纵向：内容区 `[col gap=16]` → 分组纵向排列（每组 `[col gap=10]`，
 *   组间 `gap=16`）→ 卡片拿到**整行宽度**，压缩随之消失。
 *
 * ── S3：来源（human/agent）不进人话模式（PRD §5.3，三条纪律）──
 *   ① 卡片主按钮**不因来源分叉**（claim/unblock/approve/open 按「组 + 状态」派生）；
 *   ② 置顶条 `computeReadyTasks` **不按 source 过滤**（跨来源取全局最优，禁止加
 *      `source === 'agent'` 之类过滤）；
 *   ③ 人话模式不新增英文状态角标、不新增来源色。
 *   配套：人话模式**不渲染** `SourceStatCard`（它按 agentKind 聚合、字样含
 *   `human` / `agent`，与 V1-9「人话模式看不到 agent / human 字样」正面冲突）——
 *   该指标条只在**技术模式**出现。来源的正式出处是技术卡与任务详情抽屉。
 *
 * ── 为什么人话模式**不**渲染 `ReadyQueue`（避免重复展示）──
 *   `ReadyQueue` 的内容 = `computeReadyTasks().ready` + blocked-by 区。而人话「可开工」
 *   组 = `ready ∪ (draft ∧ depsDone)`，**是 `dag.ready` 的超集**（`board.ts` 已按
 *   §2.3.4 对齐并单测锁定包含关系）。两者同时渲染会让同一批 `ready` 任务在
 *   「Ready 队列」与人话「可开工」组**各出现一次**。
 *   team-lead 明确要求「别与『可开工』组重复展示」，故：
 *     人话模式 → 四组视图（已涵盖 ReadyQueue 的全部内容，且多出 draft-depsDone 条）
 *     技术模式 → ReadyQueue 原样（该模式的编排价值在置顶条与 claim 快捷入口）
 *   计算**复用** `computeReadyTasks`（未重写，符合设计文档 :345），只是渲染路径分流。
 *
 * ── 模式切换：store 是唯一真相源，URL 是镜像（PRD §4.3）──
 *   · 默认人话（`DEFAULT_AGENT_TERM_MODE`），持久化在 `useLayoutStore`（刷新后保持）；
 *   · `?mode=human|tech` 深链：**挂载时**读 query → 写入 store；之后 URL 只跟随 store；
 *   · 切换写 URL 用 **`replace`**（`setSearchParams(..., { replace: true })`）而非 push
 *     —— 否则用户按返回键会在两个模式间反复横跳（每次切换都进历史栈）。
 *
 * ── 不新增宽度锚点 ──
 *   本页**不得**再包 `max-w-[1600px]`：阶段 A 已把宽度约束唯一收敛到 `AppShell` 的
 *   `<main>`（L-08）。页内只保留内边距与纵向节奏。
 *
 * 术语：全部经 `termFor(key, mode)` 显式传 mode（T04：禁缺省），mode 取自
 * `useLayoutStore.agentBoardMode`。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { AlertTriangle, ClipboardPaste, FileOutput } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import type { IRepositoryBundle } from '../core/repositories/interfaces';
import type { Project, Stage, Task } from '../core/types/entities';
import { ALL_TASK_STATUSES, TASK_STATUS_TRANSITIONS, TaskStatus } from '../core/types/enums';
import { computeReadyTasks } from '../core/agent/dag';
import {
  HUMAN_BOARD_GROUP_ORDER,
  groupTasksForHuman,
  type HumanBoardGroup,
} from '../core/agent/board';
import { useRepos } from '../hooks/useRepos';
import { useAgentStore } from '../store/useAgentStore';
import { useMembersStore } from '../store/useMembersStore';
import { useProjectsStore } from '../store/useProjectsStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLayoutStore } from '../store/useLayoutStore';
import {
  AGENT_SEAT_LIMIT,
  termFor,
  type AgentTermMode,
} from '../constants/agentTerms';
import { ApplyPayloadPanel } from '../components/agent/ApplyPayloadPanel';
import { HandoffPanel } from '../components/agent/HandoffPanel';
import { ReadyQueue } from '../components/agent/ReadyQueue';
import {
  AgentTaskCard,
  unmetDepTitles,
  type HumanPrimaryIntent,
} from '../components/agent/AgentTaskCard';
import { SourceStatCard } from '../components/agent/SourceStatCard';
import { TaskDrawer } from '../components/agent/TaskDrawer';
import { Modal } from '../components/common/Modal';
import { remainingDays } from '../lib/date';
import { cn } from '../lib/cn';

/**
 * 四组标题 —— **写死在 BOARD 组件**（设计文档 :459 / PRD §4.5）。
 *
 * 刻意**不进 `AGENT_TERMS`**：那是「同一术语在人话/技术两模式下的对照表」，
 * 而四组标题是人话模式独有的**分组名**，在技术模式下根本没有对应物
 * （技术模式是 7 列 status 泳道，不是四组）。塞进术语表会逼出一个
 * 「tech 列填什么」的伪问题，还会把它误标成「可切换术语」。
 * 措辞全部行业中性，不含任何行业黑话（HF-05 守卫会扫本文件，注释也算）。
 */
const HUMAN_GROUP_TITLES: Record<HumanBoardGroup, string> = {
  confirm: '待我确认',
  ready: '可开工',
  doing: '进行中',
  done: '已完成',
  hidden: '隐藏',
};

/** 模式展示名的**唯一出处**：切换 tab 与隐藏提示行里的「切到「技术」」共用同一份 */
const MODE_LABELS: Record<AgentTermMode, string> = { human: '人话', tech: '技术' };

/** 模式切换 tab 的展示顺序（人话 / 技术，PRD §4.3 D2） */
const MODE_TAB_ORDER: readonly AgentTermMode[] = ['human', 'tech'];

/**
 * 技术模式 7 条泳道的**表面**配色（画板 07 逐条取值）。
 *
 * 静态映射表 —— **严禁模板字符串拼类名**（BUG-05：Tailwind 只做静态文本扫描，
 * `bg-${x}` 一条 CSS 都不会生成，阶段色带曾经整类不显色就是这个原因）。
 * 画板 07 取值：
 *   draft/claimed/in_progress/review → `paper` + `line`
 *   ready                           → `pine-soft` + `pine`
 *   blocked                         → `clay-soft` + `clay`
 *   done                            → `moss-soft` + `moss`
 */
const LANE_SURFACE_CLASS: Record<TaskStatus, string> = {
  [TaskStatus.Draft]: 'border border-line bg-paper',
  [TaskStatus.Ready]: 'border border-pine bg-pine-soft',
  [TaskStatus.Claimed]: 'border border-line bg-paper',
  [TaskStatus.InProgress]: 'border border-line bg-paper',
  [TaskStatus.Blocked]: 'border border-clay bg-clay-soft',
  [TaskStatus.Review]: 'border border-line bg-paper',
  [TaskStatus.Done]: 'border border-moss bg-moss-soft',
};

/** 泳道头状态名的前景色（画板 07：blocked → clay / done → moss，其余 ink） */
const LANE_HEAD_CLASS: Record<TaskStatus, string> = {
  [TaskStatus.Draft]: 'text-ink',
  [TaskStatus.Ready]: 'text-ink',
  [TaskStatus.Claimed]: 'text-ink',
  [TaskStatus.InProgress]: 'text-ink',
  [TaskStatus.Blocked]: 'text-clay',
  [TaskStatus.Review]: 'text-ink',
  [TaskStatus.Done]: 'text-moss',
};

/** 剩余 / 逾期文案（与卡片同口径；此处只用于「现在该做什么」条） */
function topDueText(task: Task): { text: string; overdue: boolean } | null {
  if (!task.dueDate) return null;
  const days = remainingDays(task.dueDate.slice(0, 10));
  return days < 0
    ? { text: `逾期 ${Math.abs(days)} 天`, overdue: true }
    : { text: `剩余 ${days} 天`, overdue: false };
}

/**
 * 「人话 / 技术」模式切换（`role="tablist"` + `aria-selected`，对齐 `HomeViewTabs`
 * 的既有写法）。纯受控组件：不自己持有状态，也不碰 URL —— 均由页面统一处置。
 *
 * 画板 06/07 取值：分段控件 `200×44 [row gap=4 pad=4] sunken r=16`；
 * 单个 tab `96×36 r=12`，激活态 `paper`。
 */
function BoardModeTabs({
  mode,
  onChange,
}: {
  mode: AgentTermMode;
  onChange(next: AgentTermMode): void;
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="看板模式切换"
      className="flex w-fit items-center gap-1 rounded-2xl bg-sunken p-1"
    >
      {MODE_TAB_ORDER.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={mode === key}
          onClick={() => onChange(key)}
          className={cn(
            'h-9 w-24 rounded-[12px] text-sm font-medium transition-colors',
            mode === key ? 'bg-paper text-pine shadow-soft' : 'text-mist hover:text-ink',
          )}
        >
          {MODE_LABELS[key]}
        </button>
      ))}
    </div>
  );
}

export function AgentBoardPage(): JSX.Element {
  const repos = useRepos();
  const projects = useProjectsStore((s) => s.projects);
  const stages = useProjectsStore((s) => s.stages);
  const tasks = useProjectsStore((s) => s.tasks);
  const members = useMembersStore((s) => s.members);

  const currentProjectId = useAgentStore((s) => s.currentProjectId);
  const setCurrentProject = useAgentStore((s) => s.setCurrentProject);
  const drawerTaskId = useAgentStore((s) => s.drawerTaskId);
  const openDrawer = useAgentStore((s) => s.openDrawer);
  const claimTask = useAgentStore((s) => s.claimTask);
  const transitionTask = useAgentStore((s) => s.transitionTask);

  // v0.7 T04：看板模式（human/tech）——store 是唯一真相源，供全部 termFor 调用点传参
  const agentBoardMode = useLayoutStore((s) => s.agentBoardMode);
  const setAgentBoardMode = useLayoutStore((s) => s.setAgentBoardMode);

  const [searchParams, setSearchParams] = useSearchParams();
  const [loaded, setLoaded] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);

  /* ------------------------------ 深链（URL 是镜像，不是真相源） ------------------------------ */
  useEffect(() => {
    const q = searchParams.get('mode');
    if (q !== 'human' && q !== 'tech') return;
    // 只在与 store 不一致时写入（避免多余渲染）；URL 已是正确值，无需回写
    if (q !== useLayoutStore.getState().agentBoardMode) setAgentBoardMode(q);
    // 依赖 searchParams 是安全的：切换时 URL 被写成同一值 → 本效应再跑一次即 no-op，
    // 不会与「写 URL」形成循环。
  }, [searchParams, setAgentBoardMode]);

  /** 切换模式：先写 store（真相源），再 replace 镜像 URL（**不可用 push**） */
  const changeMode = useCallback(
    (next: AgentTermMode): void => {
      setAgentBoardMode(next);
      const params = new URLSearchParams(searchParams);
      params.set('mode', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setAgentBoardMode, setSearchParams],
  );

  /* ------------------------------ 数据装载 ------------------------------ */
  const loadAll = useCallback(
    async (bundle: IRepositoryBundle): Promise<void> => {
      const [projectRows, memberRows] = await Promise.all([
        bundle.projects.list({ status: 'all' }),
        bundle.members.list(true),
      ]);
      useProjectsStore.setState((st) => ({
        projects: projectRows,
        stages: st.stages, // stages/tasks 按选中项目在 loadProject 中刷新
        tasks: st.tasks,
      }));
      useMembersStore.getState().setAll(memberRows);
      setLoaded(true);
    },
    [],
  );

  const loadProject = useCallback(
    async (bundle: IRepositoryBundle, projectId: string): Promise<void> => {
      const [stageRows, taskRows] = await Promise.all([
        bundle.stages.listByProject(projectId),
        bundle.tasks.listByProject(projectId),
      ]);
      useProjectsStore.setState((st) => ({
        stages: [...st.stages.filter((s) => s.projectId !== projectId), ...stageRows],
        tasks: [...st.tasks.filter((t) => t.projectId !== projectId), ...taskRows],
      }));
    },
    [],
  );

  useEffect(() => {
    void loadAll(repos);
  }, [loadAll, repos]);

  // 选中项目（URL 无状态；首次进入取第一个项目）
  useEffect(() => {
    if (!loaded) return;
    const target = currentProjectId ?? projects[0]?.id ?? null;
    if (target && target !== currentProjectId) setCurrentProject(target);
    if (target) void loadProject(repos, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, projects, currentProjectId]);

  /* ------------------------------ 派生 ------------------------------ */
  const project: Project | undefined = projects.find((p) => p.id === currentProjectId);
  const projectStages = useMemo(
    () => stages.filter((s) => s.projectId === currentProjectId),
    [stages, currentProjectId],
  );
  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === currentProjectId),
    [tasks, currentProjectId],
  );

  /** memberId → 展示名（human 成员名 / agent 的 agentKind；与 HandoffPanel 同口径） */
  const assigneeLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      map[m.id] = m.actorKind === 'agent' && m.agentKind ? m.agentKind : m.name;
    }
    return map;
  }, [members]);

  const agentSeatUsed = members.filter((m) => m.actorKind === 'agent').length;
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);

  /** 任务 id → 任务（受阻标题解析用） */
  const taskById = useMemo(
    () => new Map(projectTasks.map((t) => [t.id, t] as const)),
    [projectTasks],
  );

  /** 列分桶：按 status 分组（技术模式 7 列泳道用） */
  const columns = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const status of ALL_TASK_STATUSES) map.set(status, []);
    for (const t of projectTasks) map.get(t.status)?.push(t);
    return map;
  }, [projectTasks]);

  /**
   * 人话四组（T05 纯函数）。`computeReadyTasks` 同源复用：
   *   ① 「现在该做什么」置顶条取 `ready[0]`（拓扑层 → dueDate → orderIndex 已排好）；
   *   ② 环告警取 `cyclicIds`（hidden 组里的环成员必须有出口提示）。
   */
  const readyComputation = useMemo(() => computeReadyTasks([...projectTasks]), [projectTasks]);
  const humanView = useMemo(() => groupTasksForHuman(projectTasks), [projectTasks]);
  const topReady = readyComputation.ready[0] ?? null;
  const topDue = topReady ? topDueText(topReady) : null;

  /** 置顶条脚注里的「已逾期 M 项」（口径与卡面一致：dueDate < 今天） */
  const readyOverdueCount = useMemo(
    () =>
      humanView.groups.ready.filter(
        (t) => !!t.dueDate && remainingDays(t.dueDate.slice(0, 10)) < 0,
      ).length,
    [humanView],
  );

  const onOpenTask = useCallback((taskId: string) => openDrawer(taskId), [openDrawer]);

  /**
   * 人话模式主按钮执行（卡片只给**意图**，映射留在一处）。
   *   claim   → 走 useAgentStore.claimTask（原子认领，Conflict 由 store toast）
   *   unblock → blocked → ready（白名单内的合法边）
   *   approve → review → done（白名单内的合法边）
   *   open    → 打开抽屉（进行中 / 已完成 的「查看进度 / 查看复用」）
   * 合法边由 `TASK_STATUS_TRANSITIONS` 兜底断言：若将来状态机删掉某条边，
   * 这里会静默变成无效按钮——故加 dev 期守卫，避免「点了没反应」的哑按钮。
   */
  const onPrimary = useCallback(
    (task: Task, intent: HumanPrimaryIntent): void => {
      switch (intent) {
        case 'claim':
          void claimTask(repos, task.id, currentMemberId ?? '');
          return;
        case 'unblock':
          assertEdge(task.status, TaskStatus.Ready);
          void transitionTask(repos, task.id, TaskStatus.Ready);
          return;
        case 'approve':
          assertEdge(task.status, TaskStatus.Done);
          void transitionTask(repos, task.id, TaskStatus.Done);
          return;
        default:
          openDrawer(task.id);
      }
    },
    [claimTask, currentMemberId, openDrawer, repos, transitionTask],
  );

  return (
    /*
     * 容器：**不**加 max-w（宽度锚点唯一出处是 AppShell 的 <main>，见 L-08）。
     * 画板 06/07 内容区 = `[col gap=16 pad=24]` → 外层 `p-6` + 内层 `flex flex-col gap-4`。
     * 模态框放在**纵向流之外**：它们虽然多为 fixed 定位，但保持在流内会让
     * 「打开面板」这件事与纵向节奏耦合（将来换成非 portal 的实现就会多出一段空白）。
     */
    <div className="w-full p-6">
      <div className="flex flex-col gap-4">
        {/* 工具行（画板 06/07：左=模式切换分段控件，右=项目选择器 + 导入任务 + 生成交接包） */}
        <div className="flex flex-wrap items-center gap-4">
          <Link
            to="/"
            className="rounded-[10px] px-2 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
          >
            ← 项目
          </Link>
          <h1 className="font-display text-base font-bold text-ink">
            {termFor('board', agentBoardMode)}
          </h1>
          <BoardModeTabs mode={agentBoardMode} onChange={changeMode} />
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <select
              value={currentProjectId ?? ''}
              onChange={(e) => setCurrentProject(e.target.value || null)}
              aria-label="选择项目"
              className="h-[38px] min-w-0 max-w-[240px] rounded-2xl border border-line bg-paper px-3.5 text-sm text-ink outline-none focus:border-pine"
            >
              {projects.length === 0 && <option value="">（暂无项目）</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {/*
              「导入任务」= WorkBuddy 排期入口（手动兜底 + 接入配置面板）。
              画板 06/07 的第二位按钮，白底描边（次要操作）。
              本轮只做**按钮与交互占位**：渠道本身（HTTP 端点 / token / 自动写入）
              不在本批，面板内以说明行标注「后续接入」，不伪造任何已连通的假象。
            */}
            <button
              type="button"
              onClick={() => setApplyOpen(true)}
              disabled={!currentProjectId}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-2xl border border-line bg-paper px-4 text-sm text-ink transition-colors hover:bg-sunken disabled:opacity-40"
            >
              <ClipboardPaste size={14} aria-hidden />
              {termFor('applyPayload', agentBoardMode)}
            </button>
            <button
              type="button"
              onClick={() => setHandoffOpen(true)}
              disabled={!currentProjectId}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-2xl bg-pine px-4 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-40"
            >
              <FileOutput size={14} aria-hidden />
              {termFor('handoff', agentBoardMode)}
            </button>
          </div>
        </div>

        {/*
          指标卡行 —— **仅技术模式**。
          它按 agentKind 聚合、字样含 `human` / `agent`，与人话模式的铁律
          「不显示来源」（画板 06/22 卡片无来源标签；PRD §5.3 表 + V1-9）正面冲突。
          技术模式需要席位占用与 agentKind 聚合来排查，故保留在这里。
        */}
        {agentBoardMode === 'tech' && (
          <SourceStatCard
            tasks={projectTasks}
            assigneeLabels={assigneeLabels}
            agentSeatUsed={agentSeatUsed}
            agentSeatLimit={AGENT_SEAT_LIMIT}
          />
        )}

        {agentBoardMode === 'human' ? (
          <>
            {/* ① 现在该做什么（PRD S5：取 computeReadyTasks 置顶条） */}
            {/*
              ⚠️ 小字计数取的是**可开工组的桶长度**，不是 `computeReadyTasks().ready.length`。

              为什么（team-lead 裁决）：`可开工组 = ready ∪ (draft ∧ 依赖全 done)` 是
              `computeReadyTasks().ready` 的**严格超集**，两者数字天然不同（种子场景 3 vs 2）。
              两边单看都「对」，但**同一个词在同一屏指两个集合**是硬缺陷——用户只会
              当成 bug。硬原则：同一屏同一个词必须同一个含义；故让置顶条随组计数。

              数学上不会自相矛盾：`ready ⊆ 可开工组`（`ready` 真包含于 `ready ∪ …`），
              所以置顶条那条任务**永远**是该组的成员（B-01 缺陷修复后 `claimedAt`
              条件自动对齐：`status==='ready' ⟹ claimedAt===null`，PRD :327 那句
              「且 未被认领」的额外约束已被不变式覆盖）。
              该包含关系由验收用例锁死（「置顶条计数 == 组计数 ∧ 置顶条任务 ∈ 该组」），
              防的是将来有人把两个源改成不同集合。

              文案复用 `HUMAN_GROUP_TITLES.ready` 而非再写一遍字面量：让「同一个词」
              在类型层就无法分叉（改标题即改脚注）。
              （原先 agentTerms.ts 另有一个同值的 `READY_NOW_LABEL` 常量，零组件消费，
              属同类「两份真相」，已随本批收口删除——详见 agentTerms.ts 内的说明。）
            */}
            <section
              aria-label="现在该做什么"
              className="flex flex-col gap-3 rounded-3xl border border-pine bg-pine-soft p-6"
            >
              {/* 标签 11/SemiBold（画板 06）：这里的主角是**任务标题**，不是这个标签 */}
              <h2 className="text-xs font-semibold text-pine dark:text-ink">现在该做什么</h2>

              {topReady ? (
                <>
                  {/* 内容行：文字列（标题 + 剩余/逾期）+ 操作 */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onOpenTask(topReady.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink transition-colors hover:text-pine">
                        {topReady.title}
                      </span>
                      {topDue && (
                        <span
                          className={cn(
                            'shrink-0 text-sm tabular-nums',
                            topDue.overdue ? 'text-clay' : 'text-mist',
                          )}
                        >
                          {topDue.text}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onPrimary(topReady, 'claim')}
                      className="inline-flex h-[34px] shrink-0 items-center rounded-[12px] bg-pine px-3.5 text-sm font-medium text-white transition-colors hover:bg-pine-deep"
                    >
                      开始处理
                    </button>
                  </div>
                  <p className="text-sm text-mist">
                    认领后即可开始处理，相关前置依赖都已就绪。
                  </p>
                </>
              ) : (
                <p className="text-sm text-mist">
                  暂时没有可开工的任务。导入新任务或解除受阻后会出现在这里。
                </p>
              )}

              {/* 脚注 13/Regular（画板 06）：同类 与 逾期 两个数都取自同一屏的同一批任务 */}
              {humanView.groups.ready.length > 0 && (
                <p className="text-sm text-mist">
                  同类{HUMAN_GROUP_TITLES.ready}{' '}
                  <span className="font-semibold tabular-nums">
                    {humanView.groups.ready.length}
                  </span>{' '}
                  项
                  {readyOverdueCount > 0 && (
                    <>
                      {' · 已逾期 '}
                      <span className="font-semibold tabular-nums text-clay">
                        {readyOverdueCount}
                      </span>{' '}
                      项
                    </>
                  )}
                </p>
              )}
            </section>

            {/* 环告警：环成员被归入 hidden 组（不可见），若无提示等于无声消失 */}
            {readyComputation.cyclicIds.size > 0 && (
              <div
                role="alert"
                className="flex items-center gap-2.5 rounded-2xl border border-amber/40 bg-amber-soft px-4 py-3 text-sm text-amber"
              >
                <AlertTriangle size={16} className="shrink-0" aria-hidden />
                <span>检测到 {readyComputation.cyclicIds.size} 条任务存在依赖环，已移出主列表。请修正依赖后刷新。</span>
              </div>
            )}

            {/*
              ② 四组分区 —— **纵向全宽四段**（S1）。
              标题写死在本组件；顺序取 HUMAN_BOARD_GROUP_ORDER（hidden 不在内）。
              组容器 `[col gap=10]`（`gap-2.5`）、组间 `gap=16`（外层 `gap-4`），
              卡内两栏由 AgentTaskCard 负责。
            */}
            <div className="flex flex-col gap-4">
              {HUMAN_BOARD_GROUP_ORDER.map((group) => {
                const list = humanView.groups[group];
                return (
                  <section
                    key={group}
                    aria-label={HUMAN_GROUP_TITLES[group]}
                    className="flex min-w-0 flex-col gap-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <h2 className="text-md font-semibold text-ink">
                        {HUMAN_GROUP_TITLES[group]}
                      </h2>
                      <span className="text-sm font-semibold tabular-nums text-mist">
                        {list.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {list.map((t) => (
                        <AgentTaskCard
                          key={t.id}
                          task={t}
                          group={group}
                          assigneeLabel={t.assigneeId ? assigneeLabels[t.assigneeId] : undefined}
                          blockedByTitles={unmetDepTitles(t, taskById)}
                          onOpen={onOpenTask}
                          onPrimary={onPrimary}
                        />
                      ))}
                      {list.length === 0 && (
                        <p className="rounded-[10px] border border-dashed border-line px-2 py-3 text-center text-xs text-mist/70">
                          —
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>

            {/*
              ③ 隐藏任务出口提示（team-lead 裁决必补）。

              为什么必须补：`hidden` 组（`draft ∧ 依赖未满足`）**在四组里一条都不渲染**，
              加上依赖环成员也归 hidden，这类任务在人话模式下**凭空消失且无从排查**。
              设计文档 :344 本就承诺「仅在 tech 模式 7 列**或「查看全部」可见**」——
              「查看全部」是承诺过的入口，此前未落地；`groupTasksForHuman().hiddenCount`
              也一直算好却无人消费，等于欠着这个入口。

              为什么不是「把 hidden 摊进四组」：隐藏是**有意的**（上游 Agent 还在跑，
              human 不需要逐条看），摊开会把「我现在该动手什么」稀释掉。故只给
              **一行汇总 + 去处**，把「有没有东西被我漏掉」这个疑问一次性答掉。

              UI 纪律：
                · `hiddenCount === 0` 时**不渲染**（不出现「另有 0 条」这种噪音）；
                · 数字取真实值，不用「若干」；
                · 去处必须给出（技术模式 7 列），且**直接可点**——复用 `changeMode('tech')`，
                  不引入任何新的状态分支（模式切换的真相源仍是 store + URL 镜像）；
                · 文案零英文、零行业词（HF-05 守卫会扫本文件，注释也算）。
                · `data-board-hidden-hint` 是验收用的稳定锚点（与既有 `data-app-sidebar`
                  同一惯例），避免测试靠中文文案或样式类定位。
              依赖环的 amber 告警**保留**：它覆盖的是另一类问题（数据坏了，不是还没轮到）。
            */}
            {humanView.hiddenCount > 0 && (
              <p
                data-board-hidden-hint=""
                className="flex items-center gap-2 rounded-[12px] bg-sunken px-3.5 py-2.5 text-sm text-mist"
              >
                另有 {humanView.hiddenCount} 条在上游准备中，
                <button
                  type="button"
                  onClick={() => changeMode('tech')}
                  className="text-pine underline-offset-2 transition-colors hover:underline"
                >
                  切到「{MODE_LABELS.tech}」
                </button>
                可查看全部
              </p>
            )}
          </>
        ) : (
          <>
            {/* Ready 队列置顶区（**仅技术模式**：人话模式由「可开工」组涵盖，不重复展示） */}
            <ReadyQueue
              tasks={projectTasks}
              onOpenTask={onOpenTask}
              onClaim={(taskId) => claimTask(repos, taskId, currentMemberId ?? '')}
            />

            {/*
              status 分列看板（7 列，画板 07）——**等宽**（`flex-1`，不再是写死的 280px，
              否则宽屏上留白、窄屏上挤压）；移动端纵向堆叠、列标题吸顶。不降级。
            */}
            <div className="flex gap-3 overflow-x-auto pb-2 max-lg:flex-col lg:overflow-visible">
              {ALL_TASK_STATUSES.map((status) => {
                const list = columns.get(status) ?? [];
                return (
                  <section
                    key={status}
                    className={cn(
                      'flex max-h-[70vh] min-w-0 flex-1 flex-col overflow-y-auto rounded-[20px] p-3 max-lg:w-full',
                      LANE_SURFACE_CLASS[status],
                    )}
                  >
                    {/*
                      吸顶头用 `bg-inherit` 取所在泳道的底色：泳道底色按状态分叉，
                      若写死一个颜色，滚动时会出现「纸条压在异色底上」的透底叠字。
                    */}
                    <div className="sticky top-0 z-10 -mx-3 mb-2 bg-inherit px-3 pb-1 pt-1">
                      <div className="flex items-center gap-2">
                        <h2
                          className={cn(
                            'font-mono text-[12px] font-semibold',
                            LANE_HEAD_CLASS[status],
                          )}
                        >
                          {status}
                        </h2>
                        <span className="rounded-md bg-sand px-1.5 py-0.5 font-mono text-[11px] text-mist">
                          {list.length}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      {list.map((t) => (
                        <AgentTaskCard
                          key={t.id}
                          task={t}
                          assigneeLabel={t.assigneeId ? assigneeLabels[t.assigneeId] : undefined}
                          blockedByTitles={unmetDepTitles(t, taskById)}
                          onOpen={onOpenTask}
                        />
                      ))}
                      {list.length === 0 && (
                        <p className="rounded-[10px] border border-dashed border-line px-2 py-3 text-center text-xs text-mist/70">
                          —
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Apply payload 面板（Modal 底座；失败保留输入由面板内部负责） */}
      {applyOpen && currentProjectId && (
        <Modal
          open
          onClose={() => setApplyOpen(false)}
          ariaLabel={termFor('applyPayload', agentBoardMode)}
        >
          <ApplyPayloadPanel
            projectId={currentProjectId}
            onClose={() => setApplyOpen(false)}
            onCommitted={() => {
              setApplyOpen(false);
              if (currentProjectId) void loadProject(repos, currentProjectId);
            }}
          />
        </Modal>
      )}

      {/* handoff bundle 面板 */}
      {handoffOpen && currentProjectId && project && (
        <Modal
          open
          onClose={() => setHandoffOpen(false)}
          ariaLabel={termFor('handoff', agentBoardMode)}
        >
          <HandoffPanel
            projectId={currentProjectId}
            projectName={project.name}
            stages={projectStages.map((s: Stage) => ({ id: s.id, name: s.name }))}
            tasks={projectTasks}
            onClose={() => setHandoffOpen(false)}
          />
        </Modal>
      )}

      {/* 任务详情抽屉 */}
      <TaskDrawer
        task={drawerTaskId ? (projectTasks.find((t) => t.id === drawerTaskId) ?? null) : null}
        projectStages={projectStages.map((s) => ({ id: s.id, name: s.name }))}
        onClose={() => openDrawer(null)}
      />
    </div>
  );
}

/**
 * dev 期守卫：断言 `from → to` 是状态机白名单内的合法边。
 *
 * 为什么需要：人话模式的「解阻塞 / 验收」按钮按**组 + status** 派生目标态，
 * 若将来 `TASK_STATUS_TRANSITIONS` 删掉 `blocked→ready` 或 `review→done`，
 * 按钮会变成「点了没反应」的哑按钮（`transitionStatus` 抛 Validation，被 store
 * 吞成 toast）。这里在 dev 期直接暴露该不一致，生产环境不打断用户操作。
 */
function assertEdge(from: TaskStatus, to: TaskStatus): void {
  if (import.meta.env.DEV) {
    const allowed = TASK_STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      // eslint-disable-next-line no-console
      console.warn(`[board] 非法流转 ${from} → ${to}：状态机白名单已不含该边，按钮需同步调整`);
    }
  }
}
