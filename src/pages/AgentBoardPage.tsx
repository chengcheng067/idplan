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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AlertTriangle, ClipboardPaste, FileOutput, Info, Plug, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import type { IRepositoryBundle } from '../core/repositories/interfaces';
import type { Project, Stage, Task } from '../core/types/entities';
import { ALL_TASK_STATUSES, TASK_STATUS_TRANSITIONS, TaskStatus } from '../core/types/enums';
import { computeReadyTasks } from '../core/agent/dag';
import { probe } from '../core/agent/transport.http';
import { getAgentImportChannel } from '../core/agent/transport.contract';
import {
  HUMAN_BOARD_GROUP_ORDER,
  groupTasksForHuman,
  type HumanBoardGroup,
} from '../core/agent/board';
/*
 * ★ 第 28 处漏斗旁路修复（设计 §7.5）—— 本页的 Agent 看板集合走**单一谓词出口**。
 * `useAgentProjects` 是订阅式（随 store 更新），`visibleProjectsFor` 是纯函数
 * （给 `loadAll` 直读 repo 的结果就地收窄用）。二者共用 `visibility.ts::projectKindOf`
 * —— 全仓唯一允许判 `kind` 的地方，故本页不会出现第二份 kind 判定。
 */
import { useAgentProjects, visibleProjectsFor } from '../core/project/visibility';
import { useRepos } from '../hooks/useRepos';
import { useRoleGuard } from '../hooks/useRoleGuard';
import { useAgentStore } from '../store/useAgentStore';
import { useMembersStore } from '../store/useMembersStore';
import { createProjectActions, useProjectsStore } from '../store/useProjectsStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLayoutStore } from '../store/useLayoutStore';
import {
  AGENT_SEAT_LIMIT,
  termFor,
  type AgentTermMode,
} from '../constants/agentTerms';
import { ApplyPayloadPanel } from '../components/agent/ApplyPayloadPanel';
import { AgentBoardList } from '../components/agent/AgentBoardList';
import { AgentActivityStream, type ActivityExecutionGroup } from '../components/agent/AgentActivityStream';
import { ProposalReviewPanel } from '../components/agent/ProposalReviewPanel';
import { CreateAgentBoardDialog } from '../components/agent/CreateAgentBoardDialog';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import {
  AgentIngressPanel,
  LOOPBACK_ORIGIN,
  type IngressChannelMode,
  type IngressProbeView,
  type IngressSyncView,
} from '../components/agent/AgentIngressPanel';
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
import {
  buildIngressInstructionBlock,
  buildIngressPayload,
  generateAgentToken,
} from '../core/agent/ingress-file';

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

/* ---------------------------------------------------------------------------------------------
 * 接入面板的本地存储（v0.7 · T03-B）
 *
 * ── 为什么 token 不进 React state，而在这几个函数里直接读写 localStorage ──
 *   1. state 里的值会出现在 React DevTools、组件快照与任何 `JSON.stringify(state)` 里；
 *      token 是**共享密钥**（能往库里写任务），不该有这么多副本。
 *   2. 页面只需要知道**配没配**（布尔）就能渲染「已配置 / 未配置」——面板的 props
 *      契约本身就是这么设计的（`tokenConfigured: boolean`，**绝不收原文**）。
 *   3. 「复制」走 `onIngressCopyToken` 现取现用，不经 DOM 读值。
 *   故：原文的**唯一**落点是 `localStorage`，**唯一**出口是这几函数。
 *
 * ── 读写全部 try/catch ──
 * Safari 隐私模式 / 企业策略下 `localStorage` 的**访问本身**就可能抛
 * （不是返回 null）。裸调用会让整个看板页白屏——为了一个「记住令牌」的便利
 * 功能搭上主功能，代价完全不对称。
 * ------------------------------------------------------------------------------------------ */

/** token 存储键（单一出处） */
export const AGENT_TOKEN_STORAGE_KEY = 'idplan.agentToken';
/** NAS 地址存储键（单一出处） */
export const AGENT_BASE_URL_STORAGE_KEY = 'idplan.agentBaseUrl';

function readStoredAgentToken(): string {
  try {
    return localStorage.getItem(AGENT_TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function hasStoredAgentToken(): boolean {
  return readStoredAgentToken().trim().length > 0;
}

function writeStoredAgentToken(token: string): void {
  try {
    localStorage.setItem(AGENT_TOKEN_STORAGE_KEY, token);
  } catch {
    /* 存不下（隐私模式 / 配额满）：本次会话内仍可用，不打断用户 */
  }
}

function readStoredAgentBaseUrl(): string {
  try {
    return localStorage.getItem(AGENT_BASE_URL_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeStoredAgentBaseUrl(next: string): void {
  try {
    localStorage.setItem(AGENT_BASE_URL_STORAGE_KEY, next);
  } catch {
    /* 同 writeStoredAgentToken */
  }
}

/**
 * 剪贴板写入（统一出口）。不可用 / 权限被拒时返回 false，由调用方决定提示文案
 * —— 非安全上下文（http 非 localhost）拿不到 navigator.clipboard。
 */
async function copyText(text: string): Promise<boolean> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clip || typeof clip.writeText !== 'function') return false;
  try {
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}

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
  /**
   * ★ 第 28 处漏斗旁路修复（设计 §7.5）—— 本页的 Agent 看板集合走**单一谓词出口**。
   *
   * 旧实现是 `useProjectsStore((s) => s.projects)`：页面直接订阅**全量**项目，
   * 于是人类项目出现在 Agent 页的项目下拉里（§7.2 #20「现状最刺眼处」），
   * 而且它是"页面直读 store.projects"这一坏样例最容易被照抄的位置（§7.5 的防模仿守卫要抓的正是它）。
   *
   * 现在改为 `useAgentProjects()`：kind 判定只发生在 `visibility.ts::projectKindOf`
   * （全仓唯一），原始读点也只在那个文件里 —— 守卫 spec 的白名单内。
   */
  const funnelAgentBoards = useAgentProjects();
  const stages = useProjectsStore((s) => s.stages);
  const tasks = useProjectsStore((s) => s.tasks);
  /** 接入面板的动作反馈（保存/复制令牌）走全站既有 toast 通道，不另造提示条 */
  const pushToast = useProjectsStore((s) => s.pushToast);
  const members = useMembersStore((s) => s.members);

  const currentProjectId = useAgentStore((s) => s.currentProjectId);
  const setCurrentProject = useAgentStore((s) => s.setCurrentProject);
  const drawerTaskId = useAgentStore((s) => s.drawerTaskId);
  const openDrawer = useAgentStore((s) => s.openDrawer);
  const claimTask = useAgentStore((s) => s.claimTask);
  const transitionTask = useAgentStore((s) => s.transitionTask);

  /**
   * v0.8.6（她反馈 #1「粗糙」的竞品对策）：Agent 活动流数据。
   * 当前看板下全部执行单 + 每单事件 + 提案（三张表一次读平；页面读、组件纯展示）。
   * 切换看板 / 落库后由下方 effect 重读（依赖 currentProjectId）。
   */
  const [activityGroups, setActivityGroups] = useState<readonly ActivityExecutionGroup[]>([]);
  useEffect(() => {
    const pid = currentProjectId;
    if (!pid) {
      setActivityGroups([]);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const executions = await repos.executions.listExecutionsByProject(pid);
        const groups: ActivityExecutionGroup[] = [];
        for (const ex of executions) {
          const [events, proposals] = await Promise.all([
            repos.executions.listEvents(ex.id),
            repos.executions.listProposals(ex.id),
          ]);
          groups.push({ execution: ex, events, proposals });
        }
        // 新的在前（createdAt 倒序）
        groups.sort((a, b) => (a.execution.createdAt < b.execution.createdAt ? 1 : -1));
        if (alive) setActivityGroups(groups);
      } catch {
        if (alive) setActivityGroups([]); // 读失败=不显示活动流，不阻断看板本身
      }
    })();
    return () => {
      alive = false;
    };
  }, [repos, currentProjectId]);

  // v0.7 T04：看板模式（human/tech）——store 是唯一真相源，供全部 termFor 调用点传参
  const agentBoardMode = useLayoutStore((s) => s.agentBoardMode);
  const setAgentBoardMode = useLayoutStore((s) => s.setAgentBoardMode);

  const [searchParams, setSearchParams] = useSearchParams();
  const [loaded, setLoaded] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  /**
   * 「删除 Agent 看板」确认弹窗（PRD B13）。
   *
   * ⚠️ 与「接管」相反，删除**不按 D5 的 member/build 放行**：它是不可逆的破坏性写，
   * 对齐人类侧 `removeProject` 的既有口径（store 注释原文「危险操作，仅 admin 使用」）。
   * 门控同样双层：本页 `isAdmin &&` 决定进不进渲染树；删除动作本身没有服务端角色
   * 断言（Dexie 直写档），所以这一层不是"体验"而是**唯一门**——member 看不到即可，
   * 与 TransferDialog 的"UI 隐藏不是安全边界"不同（那条有服务端 assertAdmin 兜底）。
   */
  const [deleteOpen, setDeleteOpen] = useState(false);
  /**
   * 「新建 Agent 看板」弹窗（§6.1 时序图第 1 步）。
   *
   * ⚠️ **不用** `useRoleGuard` 拦它：§7.4 的权限表明定「创建 Agent 看板 ✅✅」
   * （member 与 admin 皆可，`createAgentBoard` 不做 admin 校验）。真正受限的是**接管**
   * （那个在 `TransferDialog` 里判 admin）。在这里加门控会造出一个设计上不存在的限制。
   */
  const [createOpen, setCreateOpen] = useState(false);
  /**
   * ★ §7.5：**本页自己的 Agent 看板集合**（局部 state），由 `loadAll` 直读 repo 后就地收窄填充。
   *
   * 为什么可以直读全量、却**不能**写回 store：
   *   · 本页需要全量才能筛出 Agent 看板（这正是 Agent 页要看的东西）；
   *   · 但 `store.projects` 的**唯一写入者**是 `useRepos.ts::bootstrapAllStores()`
   *     （设计 §7.1 纪律 2）。旧 `loadAll` 把全量 `setState` 进 store，会让 §7.2 的 27 项
   *     接线**全部白做**——此后任何一个人类侧页面忘了过滤就会拿到 Agent 数据，且**不报错**。
   *   故：全量结果只落在本 state，本页**不再**成为人类侧数据的来源。
   */
  const [loadedAgentBoards, setLoadedAgentBoards] = useState<readonly Project[]>([]);

  /* ------------------------------ 接入配置面板（v0.7 · T03-B 接线） ------------------------------ */

  /**
   * 权限唯一出口（与面板内同一 hook）。**页面侧必须再条件渲染一次**，理由：
   * 面板内部的 `useRoleGuard` 门控只能保证"成员看不到面板内容"，而
   * `{isAdmin && …}` 保证的是**这块 UI 压根不进渲染树**。两者都要有——
   * 单靠组件内部返回 null，一旦将来有人把门控挪进条件分支/hook 顺序被破坏，
   * 页面侧不会给出任何信号（本项目已因 hook 顺序栽过一次白屏）。
   */
  const { isAdmin } = useRoleGuard();

  const [ingressOpen, setIngressOpen] = useState(false);
  const [ingressMode, setIngressMode] = useState<IngressChannelMode>('local');
  /** NAS 地址（受控）。本机档位下面板不使用该值，改显示只读 LOOPBACK_ORIGIN */
  const [ingressAddress, setIngressAddress] = useState<string>(() => readStoredAgentBaseUrl());
  /**
   * ★ 只持有**布尔**。token 原文从进 `localStorage` 到出，全程**不进 React state**：
   *   state 里的值会出现在 React DevTools、组件快照和任何 `JSON.stringify(state)` 里。
   */
  const [tokenConfigured, setTokenConfigured] = useState<boolean>(() => hasStoredAgentToken());
  const [probeResult, setProbeResult] = useState<IngressProbeView | null>(null);
  /**
   * 最近同步记录（本机 loopback 档位下由通道的 `status()` 提供；当前通道不自行维护
   * 同步记录，故恒为 null → 面板显示「还没有同步记录」）。非本机档位不取。
   */
  const [ingressStatus, setIngressStatus] = useState<IngressSyncView | null>(null);

  /**
   * 真正要探测的地址：本机档位是主进程写死的事实（**不看** `ingressAddress`），
   * NAS 档位才是用户填的。这一处映射若写错，本机档位会去探测一个空地址
   * → 永远"不可连通"，而用户以为自己没配错。
   */
  const ingressBaseUrl = ingressMode === 'local' ? LOOPBACK_ORIGIN : ingressAddress;

  const onIngressModeChange = useCallback((next: IngressChannelMode): void => {
    setIngressMode(next);
    // 档位变了 = 目标地址变了，旧的探测结果对应的是**另一个**地址，留着就是误导
    setProbeResult(null);
  }, []);

  const onIngressAddressChange = useCallback((next: string): void => {
    setIngressAddress(next);
    setProbeResult(null); // 同因：地址一变，旧结果失效
    writeStoredAgentBaseUrl(next); // 持久化，下次打开不必重输
  }, []);

  /**
   * 加载最近同步记录（本机 loopback 档位）。从已注册的 loopback 通道 `status()` 读取
   * `lastSyncAt` / `lastSyncSummary`；当前通道不维护同步记录，故如实为 null。
   * 非本机档位（NAS）本通道无对应数据源 → 不取（仍显示「还没有同步记录」）。
   */
  const onIngressLoadStatus = useCallback((): void => {
    if (ingressMode !== 'local') {
      setIngressStatus(null);
      return;
    }
    const ch = getAgentImportChannel();
    if (!ch) {
      setIngressStatus(null);
      return;
    }
    void ch
      .status()
      .then((s) => {
        if (s.kind !== 'desktop-loopback') {
          setIngressStatus(null);
          return;
        }
        setIngressStatus(
          s.lastSyncAt || s.lastSyncSummary
            ? { lastSyncAt: s.lastSyncAt, lastSyncSummary: s.lastSyncSummary }
            : null,
        );
      })
      .catch(() => setIngressStatus(null));
  }, [ingressMode]);

  const onIngressProbe = useCallback((): void => {
    // probe() 契约是**永不抛**（见 transport.http.ts 文件头），故无需 try/catch
    void probe(ingressBaseUrl, readStoredAgentToken()).then((r) => {
      setProbeResult(r);
      // 本机档位：连同同步记录一并刷新（通道 status()）
      if (ingressMode === 'local') onIngressLoadStatus();
    });
  }, [ingressBaseUrl, ingressMode, onIngressLoadStatus]);

  const onIngressSaveToken = useCallback(
    (token: string): void => {
      writeStoredAgentToken(token); // 原文只落 localStorage，**不进 state**
      setTokenConfigured(true);
      // 把 token 告知主进程（主进程只比对，绝不回传原文）；非 Electron 端静默跳过
      if (window.idplan?.setAgentToken) window.idplan.setAgentToken(token);
      pushToast('success', '访问令牌已保存到本机。');
    },
    [pushToast],
  );

  /**
   * 复制令牌：**从存储取件**，不从 DOM 读（DOM 里根本没有原文）。
   * 若这里改成读 DOM，必须先让原文出现在页面上 —— 那正是要禁的做法。
   */
  const onIngressCopyToken = useCallback((): void => {
    const token = readStoredAgentToken();
    if (!token) {
      pushToast('error', '尚未配置访问令牌。');
      return;
    }
    void copyText(token).then(
      (ok) => pushToast(ok ? 'success' : 'error', ok ? '访问令牌已复制。' : '复制失败，请重试。'),
    );
  }, [pushToast]);

  /* ------------------------------ 接入文件（2026-09-23 重设计 · 用户裁决） ------------------------------
   *
   * 旧流程死锁：面板让人「粘贴访问令牌」，而全应用没有任何地方能产生令牌——用户
   * 根本不知道去哪找。重设计为「接入文件 + 指令块兜底」（用户 2026-09-23 选）：
   *   ① 令牌**自动生成**（`generateAgentToken`），用户不再发明暗号；
   *   ② 接入信息（地址/令牌/端点/payload schema/用法）由**主进程**写到固定路径
   *      （documents/ID Plan/agent-ingress.json）——渲染进程不碰 fs；
   *   ③ 文件路径一键复制（写入方读文件即接入）+ 接入指令块兜底（不能读文件的
   *      写入方，人肉粘给它）。
   * 令牌原文的传播面与旧「复制令牌」按钮同级（localStorage + 剪贴板/文件），
   * 不新增暴露面；文件是固定路径、内容机器可读，令牌轮换后重新生成即一致。
   * ------------------------------------------------------------------------------------------ */

  /** 接入文件写入结果；null = 本会话尚未生成过（持久事实以磁盘文件为准） */
  const [ingressFile, setIngressFile] = useState<{ path: string } | null>(null);

  /**
   * 生成（或轮换重生成）接入信息：令牌 → 接入文件 → 复制路径。
   *
   * 令牌策略：**有则沿用、无则生成**——重生成不是默认路径（会配过的用户没必要被
   * 强制轮换）；确实没有时才自动生成，这正是治旧流程死锁的那一步。
   * 轮换入口由面板在「已配置」状态下提供（重新生成 = 换新令牌 + 重写文件）。
   */
  const onGenerateIngress = useCallback(
    async (rotate: boolean): Promise<void> => {
      const bridge = window.idplan;
      if (!bridge?.writeAgentIngressFile) {
        pushToast('error', '当前运行环境不支持写入接入文件（仅 Windows 桌面版可用）。');
        return;
      }
      let token = readStoredAgentToken().trim();
      if (token.length === 0 || rotate) {
        token = generateAgentToken();
        writeStoredAgentToken(token); // 原文只落 localStorage
        setTokenConfigured(true);
        // 主进程只留着比对，绝不回传原文；换了令牌必须同步告知（旧令牌即失效）
        if (bridge.setAgentToken) bridge.setAgentToken(token);
      }
      const payload = buildIngressPayload({ origin: `http://${LOOPBACK_ORIGIN}`, token });
      const res = await bridge.writeAgentIngressFile(payload as unknown as Record<string, unknown>);
      if (!res.ok) {
        pushToast('error', `接入文件写入失败：${res.reason ?? '未知原因'}`);
        return;
      }
      setIngressFile({ path: res.path });
      const ok = await copyText(res.path);
      pushToast(
        'success',
        ok ? `接入信息已生成，路径已复制：${res.path}` : `接入信息已生成：${res.path}`,
      );
    },
    [pushToast],
  );

  /** 复制接入文件路径（写入方的第一步就是读它） */
  const onCopyIngressPath = useCallback((): void => {
    if (!ingressFile) {
      pushToast('error', '尚未生成接入信息，请先点「生成接入信息」。');
      return;
    }
    void copyText(ingressFile.path).then((ok) =>
      pushToast(ok ? 'success' : 'error', ok ? '文件路径已复制。' : '复制失败，请重试。'),
    );
  }, [ingressFile, pushToast]);

  /**
   * 复制接入指令块（兜底通道）。
   * 令牌明文只出现在这个块里——与旧「复制令牌」按钮同一暴露面，不新增；
   * 文件路径在前、明文令牌在后：优先引导读文件。
   */
  const onCopyIngressInstruction = useCallback((): void => {
    const token = readStoredAgentToken().trim();
    if (!token) {
      pushToast('error', '尚未生成访问令牌，请先生成接入信息。');
      return;
    }
    const payload = buildIngressPayload({ origin: `http://${LOOPBACK_ORIGIN}`, token });
    const block = buildIngressInstructionBlock({
      filePath: ingressFile?.path ?? '（尚未生成接入文件，请先在面板点「生成接入信息」）',
      payload,
    });
    void copyText(block).then((ok) =>
      pushToast(ok ? 'success' : 'error', ok ? '接入指令已复制，粘给写入方即可。' : '复制失败，请重试。'),
    );
  }, [ingressFile, pushToast]);

  /** 「手动粘贴」是**另一个入口**（离线兜底），不得与通道配置合并（主 PRD §4.1） */
  const onIngressOpenManual = useCallback((): void => {
    setIngressOpen(false);
    setApplyOpen(true);
  }, []);

  /* ------------------------------ 深链（URL 是镜像，不是真相源） ------------------------------
   *
   * ⚠️ 主进程转来的导入请求（loopback 三段式的渲染侧落库点）**已上提到
   * `useAgentLoopbackReceiver()`，常驻挂载于 `AppShell`**，本页不再持有。
   * 原因：旧实现把监听器放在本页，导致「用户在首页 / 项目详情页时外部写入要等满
   * 10s 超时」——面板却显示「可连通」。详见该 hook 文件头。
   * 若在这里再订阅一次会与主进程形成两处回传 / 竞态，**不要加回来**。
   */
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
      /*
       * ★★ 第 28 处漏斗旁路修复（设计 §7.5）★★
       *
       * 这里**删掉**了原来的一整块：
       *     useProjectsStore.setState((st) => ({ projects: projectRows, stages: st.stages, tasks: st.tasks }));
       * 它把**全量**项目（含人类项目）灌进全局 store，绕过 `visibility.ts` 的单一漏斗。
       * 危害不是"多写了一份数据"，而是**把旁路变成默认**：此后任何人类侧页面直读
       * `store.projects` 都会拿到 Agent 数据，且不报错、不崩、tsc 不管 —— §7.2 的 27 项接线
       * 只要有一处依赖"store 里只有该看的东西"就会静默失效。
       *
       * 现在：全量结果**就地按 kind 收窄**（经同一谓词 `visibleProjectsFor('agent', …)`，
       * 不自己写 `p.kind === 'agent'`，避免出现第二份 kind 判定），只进本页局部 state。
       * `stages` / `tasks` 也不再自赋自（原来那两行是 `st.stages`/`st.tasks` 原样写回 = no-op）。
       */
      setLoadedAgentBoards(visibleProjectsFor('agent', projectRows));
      useMembersStore.getState().setAll(memberRows);
      setLoaded(true);
    },
    [],
  );

  /**
   * 选中看板后，把它名下的阶段 / 任务拉进 store。
   *
   * ── 为什么这里的 `useProjectsStore.setState({ stages, tasks })` 是**保留**的（设计 §7.5）──
   * §7.5 要删的是 **`projects` 的写入**，不是 stages/tasks。三条理由：
   *   ① 形态不同：这里是**按 projectId 局部替换**（先滤掉本项目的旧行再并入新行），
   *      不是"全量灌入"；因此不存在"把别的看板的数据顺手带进来"这种失效模式。
   *   ② 不构成旁路：stages/tasks 没有 kind 字段，它们的归属靠 `projectId → projects` 反查；
   *      人类侧读它们走的是 `useVisibleStages('human')` / `useVisibleTasks('human')`
   *      （按 human 的 projectId 集合收窄），本页写这两行不会让人类侧多看到任何东西。
   *   ③ 既有契约：任务抽屉 / 交接包等既有组件读的就是 store 里的 stages / tasks。
   *      把它们改成局部 state 会把一份数据源拆成两份（同一事实两处来源），
   *      那是比"保留一次局部替换"大得多的改动，**不在本任务范围**。
   *
   * ⚠️ 若将来要把这两行也搬走，必须**同时**改掉所有读 `store.stages` / `store.tasks` 的既有
   * 消费点，并重新论证它们的 kind 收窄 —— 单独删这一处只会让抽屉与交接包读不到数据。
   */
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

  /**
   * 本页渲染用的 Agent 看板集合 = 漏斗出口 ∪ 本页装载时的局部快照（按 id 去重）。
   *
   * 为什么取并集而不是二选一：
   *   · 漏斗（`useAgentProjects`）是 `store.projects` 的**唯一合法视图**，bootstrap 后即有、
   *     且随 store 更新；
   *   · 局部快照（`loadedAgentBoards`）是本页 `loadAll` 直读 repo 的**最新**结果 ——
   *     刚建的看板已经在库里、却还没进 store（store 只在 bootstrap 时被写），只有它也认，
   *     用户才能"建完即见"。
   *
   * ★ 2026-09-23 接管接线后补的一道**当前态过滤**：并集之后再统一过一次谓词
   * （`visibleProjectsFor('agent', …)`）。原因是快照是**装载时**收窄的，而
   * 「接管 · 转为正式项目」发生在装载**之后** —— 不看板只翻 kind，store 里该行
   * 即时变 human（漏斗出口下一帧即排除），但快照还是收窄前的老副本，
   * 不这道过滤的话被接管的看板会继续显示在 Agent 页（且选中它渲染出人类项目内容，
   * 正是 #20/#21 要堵的反向泄漏）。两道来源都过谓词，故过滤不可能误伤。
   */
  const agentBoards = useMemo(() => {
    const seen = new Set(funnelAgentBoards.map((p) => p.id));
    const merged = [
      ...funnelAgentBoards,
      ...loadedAgentBoards.filter((p) => !seen.has(p.id)),
    ];
    return visibleProjectsFor('agent', merged);
  }, [funnelAgentBoards, loadedAgentBoards]);

  // 选中看板（URL 无状态；首次进入取第一块 Agent 看板）
  useEffect(() => {
    if (!loaded) return;
    // ★ 只认 Agent 看板：`currentProjectId` 可能是历史遗留 / 深链带来的**人类项目** id。
    //   若原样喂给下面的派生，Agent 页会渲染人类项目的阶段与任务 ——
    //   这正是 §7.2 #20/#21 要堵的**反向泄漏**（人类数据出现在 Agent 侧）。
    const isAgentBoard =
      currentProjectId !== null && agentBoards.some((b) => b.id === currentProjectId);
    // 陈旧选择先清掉：否则手动粘贴面板 / 交接包会拿着这个 id 去操作人类项目
    if (currentProjectId !== null && !isAgentBoard) setCurrentProject(null);
    const target = (isAgentBoard ? currentProjectId : null) ?? agentBoards[0]?.id ?? null;
    if (target && target !== currentProjectId) setCurrentProject(target);
    if (target) void loadProject(repos, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, agentBoards, currentProjectId]);

  /* ------------------------------ 派生 ------------------------------ */
  const project: Project | undefined = agentBoards.find((p) => p.id === currentProjectId);

  /*
   * ★ 反向泄漏闸门（§7.2 #20/#21，判据见 tests/isolation-census.spec.ts 的 L3「反向泄漏 · 组件级」）。
   *
   * 为什么**不能**直接拿 `currentProjectId` 去 filter：
   *   `currentProjectId` 可能是**人类项目 id**（历史遗留 / 深链 / v0.6 旧按钮）。
   *   上面 `project` 已经按漏斗收窄（只在 `agentBoards` 里找 ⇒ 人类 id ⇒ `undefined`），
   *   若两条派生仍以裸 id 过滤，两者就**自相矛盾**：`project` 是 undefined，
   *   而 `projectTasks`/`projectStages` 却装满了**人类项目**的任务与阶段 ——
   *   屏幕上表现为「Agent 工作区里列出人类任务」。
   *
   * 收窄方式：过滤 key 取 `project?.id ?? null`（即「已确认为 Agent 看板」的 id）。
   *   - 是人类 id ⇒ `project` 为 undefined ⇒ key 为 null ⇒ 两条派生**必为空**；
   *   - 是 Agent id ⇒ key 即该 id，行为与原先完全一致。
   *
   * ⚠️ 注意这里**不用** `useProjectStages`/`useProjectTasks`（那对是「只按 id 收窄、
   *   不按 kind」的详情页/打印页单项目直达特判，§7.3 #17/#18/#27）——
   *   本处的泄漏正是「id 本身是人类 id」，那对救不了。
   *
   * 上面 519-532 的 useEffect 虽然会把陈旧选择 setCurrentProject(null) 掉，
   * 但那发生在 **effect 阶段**：首帧仍会用人类 id 渲染一次。这里堵的就是那一帧。
   */
  const scopedProjectId: Project['id'] | null = project?.id ?? null;
  const projectStages = useMemo(
    () => (scopedProjectId === null ? [] : stages.filter((s) => s.projectId === scopedProjectId)),
    [stages, scopedProjectId],
  );
  const projectTasks = useMemo(
    () => (scopedProjectId === null ? [] : tasks.filter((t) => t.projectId === scopedProjectId)),
    [tasks, scopedProjectId],
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

  /**
   * v0.8.6（竞品三件套之二）：写回提案落定（单条 + 批量）。
   *
   * 纪律：① decidedBy 取当前成员名（仓储层 P0 闸门：终态必填决策人）；
   *   ② 逐条独立落库——批量不是事务（一条失败不影响其余，失败条目在 toast 里点名）；
   *   ③ 落定后重读活动流数据（事件时间线/提案 chip 同步更新）。
   */
  const [proposalBusy, setProposalBusy] = useState(false);
  const decideProposals = useCallback(
    async (ids: readonly string[], status: 'applied' | 'rejected') => {
      if (ids.length === 0) return;
      setProposalBusy(true);
      const actor = members.find((m) => m.id === currentMemberId)?.name ?? '未署名';
      let ok = 0;
      const failed: string[] = [];
      for (const id of ids) {
        try {
          await repos.executions.updateProposal(id, {
            status,
            decidedBy: actor,
            decidedAt: new Date().toISOString(),
          });
          ok += 1;
        } catch {
          failed.push(id);
        }
      }
      setProposalBusy(false);
      // 重读（活动流 + 提案列表）
      const pid = currentProjectId;
      if (pid) {
        const executions = await repos.executions.listExecutionsByProject(pid);
        const groups: ActivityExecutionGroup[] = [];
        for (const ex of executions) {
          const [events, proposals] = await Promise.all([
            repos.executions.listEvents(ex.id),
            repos.executions.listProposals(ex.id),
          ]);
          groups.push({ execution: ex, events, proposals });
        }
        groups.sort((a, b) => (a.execution.createdAt < b.execution.createdAt ? 1 : -1));
        setActivityGroups(groups);
      }
      if (ok > 0) {
        pushToast('success', `${status === 'applied' ? '已通过' : '已拒绝'} ${ok} 条提案`);
      }
      if (failed.length > 0) {
        pushToast('error', `${failed.length} 条提案落定失败（可能已被他人处理）`);
      }
    },
    [repos, members, currentMemberId, currentProjectId, pushToast],
  );


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
            {/*
              看板选择器（§7.2 #20）：**只列 Agent 看板**。

              旧实现列的是 `projects` 全量（人类项目也在里面）—— 设计 §7.2 表里
              #20 备注的原话是「现状最刺眼处：下拉里是人类项目」。收窄后：
                · 空集时给一句明确文案，而不是"（暂无项目）"（后者会让用户以为
                  自己的项目丢了，实际是他的项目在另一个工作区）；
                · `aria-label` 也从「选择项目」改成「选择 Agent 看板」，避免读屏把
                  它读成人类项目选择器。
            */}
            <select
              value={scopedProjectId ?? ''}
              onChange={(e) => setCurrentProject(e.target.value || null)}
              aria-label="选择 Agent 看板"
              className="h-[38px] min-w-0 max-w-[240px] rounded-2xl border border-line bg-paper px-3.5 text-sm text-ink outline-none focus:border-pine"
            >
              {agentBoards.length === 0 && <option value="">（暂无 Agent 看板）</option>}
              {agentBoards.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {/*
              ★ B13：「删除 Agent 看板」（danger 变体，仅 admin 可见；见 deleteOpen 注释）。

              · 只在**选中了看板**时可点（`scopedProjectId`，与交接包按钮同口径——
                不用裸 currentProjectId，那个可能是人类 id，本页拿不到目标）；
              · 不进「已归档」语义：`removeProject` 是**永久删除 + 级联清理**
                （阶段/任务/流水），PRD B13 原话「删除后不进人类"已归档"语义」；
              · 删除后当前选中若是这块，选择 effect 会自动改选第一块剩余看板
                （`isAgentBoard` 判否 → 清选择 → 取 agentBoards[0]），无需在此处理。
            */}
            {isAdmin && (
              <button
                type="button"
                data-agent-board-delete=""
                onClick={() => setDeleteOpen(true)}
                disabled={!scopedProjectId}
                className="inline-flex h-[38px] items-center gap-1.5 rounded-2xl border border-clay/50 px-3.5 text-sm text-clay transition-colors hover:bg-clay-soft disabled:opacity-40"
                title={scopedProjectId ? '永久删除当前 Agent 看板' : '先选中一块 Agent 看板'}
              >
                <Trash2 size={14} aria-hidden />
                删除看板
              </button>
            )}
            {/*
              ★ 反馈 #8 收口：工具条**不再常驻**「新建 Agent 看板」。

              ── 为什么撤掉 ──
                用户原话：「我不能理解它目前配合 Agent 来用时，到底能在看板里排什么」。
                常驻入口 = 持续承诺「这块已经能用了」，而真实能力（外部写入方自动导入）
                尚在打通、NAS 侧只有连通探测 —— 入口留在那儿本身就是误导。
                产品决定：Agent 能力暂停扩展，先把「现在能做什么」讲清楚。

              ── 还能不能建板 ──
                能。入口收进**空态**（`AgentBoardList` 的 `onCreate`，只在 0 块看板时出现）：
                一块都没有时必须留一条活路，否则页面成死胡同；已有看板后不再诱导继续建。
                底层能力（`createAgentBoard` / `CreateAgentBoardDialog`）与既有测试**全部保留**
                —— 这不是删功能，是收回「还没准备好」的入口。
            */}
            <div
              data-agent-stance=""
              className="flex items-center gap-1.5 rounded-2xl bg-sunken px-3 py-2 text-xs text-mist"
            >
              <Info size={12} className="shrink-0 text-pine" aria-hidden />
              <span>
                Agent 看板目前<strong className="text-ink">只承接外部写入方的排期</strong>
                （本机自动导入可用，NAS 远程写入尚未启用），这一块正按反馈重新定义。
              </span>
            </div>
            {/*
              「导入任务」= WorkBuddy 排期入口（画板 06/07 的第二位按钮，白底描边=次要操作）。

              ★ 本按钮打开的是**接入配置面板**（通道配置），不是手动粘贴面板。
                两个入口的分工（主 PRD §4.1 明定，不得合并）：
                  · 接入配置面板 = 外部写入方（WorkBuddy）的**服务地址与令牌** → 自动写入；
                  · 手动粘贴面板 = **离线兜底**，由接入面板底部的「改为手动粘贴」跳转进入。
                此前本按钮**直通手动粘贴**，接入面板虽然建好了却无人引用 ——
                于是「怎么把 WorkBuddy 接上」这件事用户根本看不到（P0-9 的剩余部分）。

              ⚠️ 刻意**不加** `disabled={!currentProjectId}`（此前有）：
                通道配置（地址/令牌/探活）是**项目无关**的全局设置。新装 NAS 上
                往往一个项目都还没有，若按项目禁用，用户会在最需要配通道的时刻
                看到按钮是灰的 —— 而那正是首次接入的必经一步。
            */}
            <button
              type="button"
              onClick={() => setIngressOpen(true)}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-2xl border border-line bg-paper px-4 text-sm text-ink transition-colors hover:bg-sunken"
            >
              <ClipboardPaste size={14} aria-hidden />
              {termFor('applyPayload', agentBoardMode)}
            </button>
            {/*
              ★ 这里用 `scopedProjectId` 而非 `currentProjectId`（本节开头的说明同理）：
                `currentProjectId` 可能是**人类项目 id**（历史遗留 / 深链），此时
                交接包弹窗被下面的 `project` 守卫挡住 ⇒ 按钮**亮了也点不开**，
                是个「点了没反应」的**死入口**（与详情页那处同类）。
                换用已确认的 id 后：没有 Agent 看板 ⇒ 灰；有 ⇒ 可点且一定打得开。
            */}
            <button
              type="button"
              onClick={() => setHandoffOpen(true)}
              disabled={!scopedProjectId}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-2xl bg-pine px-4 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-40"
            >
              <FileOutput size={14} aria-hidden />
              {termFor('handoff', agentBoardMode)}
            </button>
          </div>
        </div>

        {agentBoards.length === 0 ? (
          /*
           * ★ B16：库里**一块 Agent 看板都没有**时的明确空态（设计 §12.5 把这条列为
           * 「现状最刺眼的问题」）。
           *
           * 为什么必须在**页面层**判空，而不是让下面的四组 / 七列泳道自己渲染成空：
           *   空的四组会显示一排「—」，用户分不清"是我把数据弄丢了"还是"这里本来就该是空的"。
           *   空态由 `AgentBoardList` 承载 —— 同一句空态文案的**唯一出处**（侧栏复用同一个
           *   组件 ⇒ 不会出现两套措辞）。
           *
           * ★ 空态**绝不**回退去显示人类项目：库里只有人类项目时，本页就显示空态。
           *   这正是 v0.8 要修掉的那条（Agent 页曾经列出一堆人类项目、看起来像"数据串味了"）。
           *
           * ★ `onCreate` 从这里接上（§6.1 时序图第 1 步「点『新建 Agent 看板』」）：
           *   不接的话空态只会描述"外部写入方接上后会建板"，而用户手动建板这条路
           *   在界面上**根本不存在**（`createAgentBoard` 会成为一个没有入口的服务）。
           */
          <AgentBoardList
            boards={[]}
            currentId={null}
            onSelect={() => undefined}
            onCreate={() => setCreateOpen(true)}
          />
        ) : (
          <>
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
        {/* v0.8.6：Agent 活动流（Linear Coding Session 范式；有数据才渲染） */}
        <AgentActivityStream groups={activityGroups} />
        {/* v0.8.6 竞品三件套之二：写回提案审批（理由+置信度+批量；GitHub 范式） */}
        <ProposalReviewPanel
          proposals={activityGroups.flatMap((g) => g.proposals)}
          onDecide={(id, status) => void decideProposals([id], status)}
          onDecideMany={(ids, status) => void decideProposals(ids, status)}
          busy={proposalBusy}
        />

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
          </>
        )}
      </div>

      {/*
        「新建 Agent 看板」弹窗（§6.1 时序图第 1–3 步）。
        ★ **无角色门控**（与下面的接入面板正相反）：§7.4 明定创建对 member 也可。
      */}
      {createOpen && (
        <CreateAgentBoardDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          /*
           * 建完即选中（§6.1 时序图第 9 步：`P->>V: selectAgentProjects()`）。
           *
           * 只做一件事：`setCurrentProject(新 id)`。**不**在这里再调 `loadProject` ——
           * 下面的选中 effect 已经负责"选中就装阶段/任务"，此处再调就是两份装载逻辑，
           * 而后者的 `agentBoards` 派生日志恰好是"新看板能不能被认出来"的唯一判据：
           * store action 已经 `putProject` 过（同步写），故下一帧 `useAgentProjects()`
           * 就包含它，effect 会看到 `isAgentBoard === true` 并照常装载。
           */
          onCreated={(id) => setCurrentProject(id)}
        />
      )}

      {/*
        接入配置面板（v0.7 · T03-B 接线）。
        ★ 双重门控：本行 `isAdmin &&` 决定**进不进渲染树**；面板内部的
          `useRoleGuard()` 再判一次。成员/未进入身份时此处**整块不渲染** ——
          注意不是「渲染了但按钮 disabled」：不可见的功能不该在 DOM 里留痕
          （`?.()` 只保证回调不执行，不保证不渲染，本项目踩过「回调可选 → 死按钮」）。
      */}
      {isAdmin && ingressOpen && (
        <Modal open onClose={() => setIngressOpen(false)} ariaLabel="接入外部写入方">
          <AgentIngressPanel
            mode={ingressMode}
            onModeChange={onIngressModeChange}
            address={ingressAddress}
            onAddressChange={onIngressAddressChange}
            /* ★ 只传布尔。原文不出 localStorage，不进 state，更不传给面板 */
            tokenConfigured={tokenConfigured}
            onSaveToken={onIngressSaveToken}
            onCopyToken={onIngressCopyToken}
            /*
             * ★ 2026-09-23 重设计（用户裁决「接入文件 + 指令块兜底」）：
             *   本机档位主入口从「粘贴令牌」改为「生成接入信息」——令牌自动生成、
             *   接入文件写固定路径、文件路径与接入指令一键复制。令牌原文不出
             *   localStorage（生成即存、面板只见布尔与路径）。
             */
            ingressFile={ingressFile}
            onGenerateIngress={onGenerateIngress}
            onCopyIngressPath={onCopyIngressPath}
            onCopyIngressInstruction={onCopyIngressInstruction}
            /*
             * 结构兼容由**本行类型标注**兜底：`probe()` 返回 `AgentProbeView`，
             * 若它和面板的 `IngressProbeView` 字段漂移，这里当场编译失败
             * （transport.http.ts 不能 import 组件类型，原因见该文件头）。
             */
            probeResult={probeResult}
            onProbe={onIngressProbe}
            /*
             * 最近同步记录：v0.7 本轮**没有**它的数据来源（服务端三个端点里没有
             * 「最近一次同步」——`AgentChannelStatus.lastSyncAt` 目前恒为 null，
             * 见 transport.contract.ts 的 local-dexie 通道）。故如实传 null，
             * 面板会显示「还没有同步记录」。**绝不编造一条同步记录**来把面板填满。
             */
            status={ingressStatus}
            onOpenManual={onIngressOpenManual}
            onClose={() => setIngressOpen(false)}
          />
        </Modal>
      )}

      {/*
        Apply payload 面板（Modal 底座；失败保留输入由面板内部负责）。

        ★ 写入路径守卫：这里**必须**用 `scopedProjectId`，且必须与下方的 `project`
          守卫**对齐**。原因不是显示，是**写入目标** —— `ApplyPayloadPanel` 会把
          `projectId` 当作落库目标；若喂进人类项目 id，用户粘贴的 payload 会落到
          **人类项目**上（Agent 侧的反向写入泄漏）。

          可达窗口（不是理论上才有）：`:520 if (!loaded) return;` 会让上面的清理
          effect 在 `loadAll` 完成前**直接早退**（不清 id），这段时间 `currentProjectId`
          仍是人类 id；而「导入任务」按钮**刻意不加 `disabled`**（通道配置是项目无关的
          全局设置，见上方注释）⇒ 它在 `loaded=false` 时**可点**。NAS 上 `loadAll` 慢时
          这个窗口是秒级的。

          为什么之前漏了：handoff 面板有 `project` 守卫挡着（旧写法 `currentProjectId &&
          project`，靠 `project` 兜住了），apply 面板**没有** —— 两者不对称，漏的正是
          没被兜住的那个。现在统一用 `scopedProjectId`：`project` 为 undefined ⇒
          `scopedProjectId` 为 null ⇒ 面板压根不渲染；同时 `:1117` 的 `projectId` 也
          拿不到人类 id。
      */}
      {applyOpen && scopedProjectId && (
        <Modal
          open
          onClose={() => setApplyOpen(false)}
          ariaLabel={termFor('applyPayload', agentBoardMode)}
        >
          <ApplyPayloadPanel
            projectId={scopedProjectId}
            onClose={() => setApplyOpen(false)}
            onCommitted={() => {
              setApplyOpen(false);
              // 保留 `if (…)` 写法：闭包内 TS 不保留收窄，写成裸参数会被判可能为 null
              if (scopedProjectId) void loadProject(repos, scopedProjectId);
            }}
          />
        </Modal>
      )}

      {/* handoff bundle 面板 */}
      {handoffOpen && scopedProjectId && project && (
        <Modal
          open
          onClose={() => setHandoffOpen(false)}
          ariaLabel={termFor('handoff', agentBoardMode)}
        >
          <HandoffPanel
            projectId={scopedProjectId}
            projectName={project.name}
            stages={projectStages.map((s: Stage) => ({ id: s.id, name: s.name }))}
            tasks={projectTasks}
            onClose={() => setHandoffOpen(false)}
          />
        </Modal>
      )}

      {/*
        B13 · 删除确认（danger 变体）。与 ProjectCard 的永久删除确认同一形状，
        但文案多一句「不进已归档」——人类项目的删除确认建议"先归档"，
        而 Agent 看板**没有归档语义**（B18 是 P1 未做），替代路径是「接管」。
      */}
      {deleteOpen && scopedProjectId && (
        <ConfirmDialog
          open
          title="删除 Agent 看板"
          confirmText="永久删除"
          danger
          onConfirm={() => {
            void createProjectActions(repos).removeProject(scopedProjectId, project?.name);
            setDeleteOpen(false);
          }}
          onCancel={() => setDeleteOpen(false)}
        >
          确认删除「{project?.name}」？该看板下的所有阶段与任务将一并永久删除，{' '}
          <span className="font-medium text-clay">不可恢复</span>，且不会进入「已归档」。
          若只是想把它留在项目里，请改用详情页的「接管 · 转为正式项目」。
        </ConfirmDialog>
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
