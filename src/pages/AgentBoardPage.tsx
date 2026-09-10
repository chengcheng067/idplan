/**
 * Agent Board 主页（v0.7 · T06 双模式重写；路由 /agent）。
 *
 * ── 两种模式（D2）──
 *
 * **人话模式（默认，PRD §4.1）**：
 *   ① 顶部一句话「**现在该做什么**」= `computeReadyTasks()` 置顶条（人话标题 + 剩余/逾期）。
 *      小字计数取**可开工组的桶长度**（不是 `ready.length`）——同一个词在同一屏必须
 *      同一个含义，详见 `现在该做什么` 区块内的注释与验收用例。
 *   ② 四组分区：`待我确认 / 可开工 / 进行中 / 已完成`（顺序恒为 `HUMAN_BOARD_GROUP_ORDER`）
 *   ③ 埋在组外的 `hidden` 条（`draft ∧ 依赖未满足` = 上游 Agent 还在跑）**不进主列表**，
 *      但**必须给出汇总出口**：四组下方一行「另有 N 条在上游准备中，切到「技术」可查看全部」
 *      —— 否则这类任务在人话模式下凭空消失、用户无从排查（team-lead 裁决必补）。
 *   ④ 依赖环仍给 amber 告警条 —— 环成员同样被归入 hidden，无告警等于在界面上无声消失
 *      （与 ③ 的出口提示互补：③ 解决「还没轮到」，④ 解决「数据坏了」）
 *
 * **技术模式（PRD §4.2「保留现有 7 列泳道，不降级」）**：
 *   `ReadyQueue` 置顶区 + `ALL_TASK_STATUSES` 遍历的 7 列 status 泳道，形态与 v0.6 一致。
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

import { ClipboardPaste, FileOutput } from 'lucide-react';
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
      className="flex w-fit items-center gap-1 rounded-[12px] border border-line bg-cream/60 p-1"
    >
      {MODE_TAB_ORDER.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={mode === key}
          onClick={() => onChange(key)}
          className={cn(
            'rounded-[9px] px-3.5 py-1.5 text-sm font-medium transition-colors',
            mode === key ? 'bg-pine-soft text-pine' : 'text-mist hover:bg-sand hover:text-ink',
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
    /* 容器：**不**加 max-w（宽度锚点唯一出处是 AppShell 的 <main>，见 L-08） */
    <div className="w-full pb-10 pt-4">
      {/* 页头：返回 + 项目选择器 + 两个主 CTA */}
      <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
        <Link
          to="/"
          className="rounded-[8px] px-2 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
        >
          ← 项目
        </Link>
        <h1 className="font-display text-lg font-bold text-ink">
          {termFor('board', agentBoardMode)}
        </h1>
        <select
          value={currentProjectId ?? ''}
          onChange={(e) => setCurrentProject(e.target.value || null)}
          aria-label="选择项目"
          className="min-w-0 max-w-[240px] rounded-[10px] border border-line bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-pine"
        >
          {projects.length === 0 && <option value="">（暂无项目）</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setApplyOpen(true)}
            disabled={!currentProjectId}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-pine px-3 py-1.5 text-sm text-pine transition-colors hover:bg-pine-soft disabled:opacity-40"
          >
            <ClipboardPaste size={14} aria-hidden />
            {termFor('applyPayload', agentBoardMode)}
          </button>
          <button
            type="button"
            onClick={() => setHandoffOpen(true)}
            disabled={!currentProjectId}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-pine px-3 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-40"
          >
            <FileOutput size={14} aria-hidden />
            {termFor('handoff', agentBoardMode)}
          </button>
        </div>
      </div>

      {/* 模式切换（人话 / 技术） */}
      <div className="mb-4">
        <BoardModeTabs mode={agentBoardMode} onChange={changeMode} />
      </div>

      {/* 指标卡行（两种模式共用；PRD §4.1.2「保留在页脚/可复用」） */}
      <div className="mb-4">
        <SourceStatCard
          tasks={projectTasks}
          assigneeLabels={assigneeLabels}
          agentSeatUsed={agentSeatUsed}
          agentSeatLimit={AGENT_SEAT_LIMIT}
        />
      </div>

      {agentBoardMode === 'human' ? (
        <>
          {/* ① 现在该做什么（PRD S5：取 computeReadyTasks 置顶条） */}
          <section
            aria-label="现在该做什么"
            className="mb-4 rounded-[16px] border border-pine/30 bg-pine-soft/40 p-3.5"
          >
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-pine">现在该做什么</h2>
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
                在类型层就无法分叉（改标题即改小字）。
                （原先 agentTerms.ts 另有一个同值的 `READY_NOW_LABEL` 常量，零组件消费，
                属同类「两份真相」，已随本批收口删除——详见 agentTerms.ts 内的说明。）
              */}
              {humanView.groups.ready.length > 0 && (
                <span className="rounded-md bg-paper/70 px-1.5 py-0.5 text-[10px] text-mist">
                  {HUMAN_GROUP_TITLES.ready} {humanView.groups.ready.length} 项
                </span>
              )}
            </div>
            {topReady ? (
              <button
                type="button"
                onClick={() => onOpenTask(topReady.id)}
                className="mt-1.5 flex w-full items-center gap-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:text-pine">
                  {topReady.title}
                </span>
                {topDue && (
                  <span
                    className={cn(
                      'shrink-0 text-[11px] tabular-nums',
                      topDue.overdue ? 'text-clay' : 'text-mist',
                    )}
                  >
                    {topDue.text}
                  </span>
                )}
              </button>
            ) : (
              <p className="mt-1.5 text-sm text-mist">
                暂时没有可开工的任务。导入新任务或解除受阻后会出现在这里。
              </p>
            )}
          </section>

          {/* 环告警：环成员被归入 hidden 组（不可见），若无提示等于无声消失 */}
          {readyComputation.cyclicIds.size > 0 && (
            <div
              role="alert"
              className="mb-4 rounded-[10px] border border-amber/50 bg-amber-soft px-3 py-2 text-xs text-amber"
            >
              检测到 {readyComputation.cyclicIds.size} 条任务存在依赖环，已移出主列表。请修正依赖后刷新。
            </div>
          )}

          {/* ② 四组分区（标题写死在本组件；顺序取 HUMAN_BOARD_GROUP_ORDER，hidden 不在内） */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {HUMAN_BOARD_GROUP_ORDER.map((group) => {
              const list = humanView.groups[group];
              return (
                <section
                  key={group}
                  aria-label={HUMAN_GROUP_TITLES[group]}
                  className="glass-light rounded-[16px] border border-line p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink">
                      {HUMAN_GROUP_TITLES[group]}
                    </h2>
                    <span className="rounded-md bg-sand px-1.5 py-0.5 text-[10px] text-mist">
                      {list.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
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
                      <p className="rounded-[10px] border border-dashed border-line px-2 py-3 text-center text-[10px] text-mist/70">
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
            <p data-board-hidden-hint="" className="mt-3 text-xs text-mist">
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
          <div className="mb-4">
            <ReadyQueue
              tasks={projectTasks}
              assigneeLabels={assigneeLabels}
              onOpenTask={onOpenTask}
              onClaim={(taskId) => claimTask(repos, taskId, currentMemberId ?? '')}
            />
          </div>

          {/* status 分列看板（7 列；移动端纵向堆叠、列标题吸顶）——不降级 */}
          <div className="flex gap-3 overflow-x-auto pb-2 max-lg:flex-col lg:overflow-visible">
            {ALL_TASK_STATUSES.map((status) => {
              const list = columns.get(status) ?? [];
              return (
                <section
                  key={status}
                  className="glass-light w-[280px] shrink-0 rounded-[16px] border border-line p-3 max-lg:w-full"
                >
                  <div className="sticky top-0 -mx-3 mb-2 bg-inherit px-3 pb-1 pt-1">
                    <div className="flex items-center gap-2">
                      <h2 className="font-mono text-xs font-semibold text-ink">{status}</h2>
                      <span className="rounded-md bg-sand px-1.5 py-0.5 font-mono text-[10px] text-mist">
                        {list.length}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
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
                      <p className="rounded-[10px] border border-dashed border-line px-2 py-3 text-center text-[10px] text-mist/70">
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
