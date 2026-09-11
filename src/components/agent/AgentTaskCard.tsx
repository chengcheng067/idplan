/**
 * Agent Board 任务卡（v0.7 · T07 双模式重写；T04 起 mode 显式传入）。
 *
 * ── 两种模式，两套呈现（同组件内分派，不拆文件）──
 *
 * **人话模式**（默认，PRD §5.4.3 画板 06「全宽行卡」）——每条卡**两栏**：
 *   左「任务文字列」`[col gap=3]`：
 *     ① 人话标题 14/SemiBold（点开详情）
 *     ② 元信息 13/Regular **一行**：`负责人：王琳 · 剩余 3 天`
 *        （无负责人 → `负责人：待认领`；受阻 → `… · 受阻：等待水电图`）
 *   右「主按钮」`hug×34 [row pad=14] r=12`，**有且只有一个**（按组派生，见 `humanPrimaryOf`）。
 *
 * 卡根 `[row gap=12 pad=12] fill=paper stroke=line r=16`（画板 06 取值）。
 *
 * **技术模式**（PRD §4.2「保留现有形态」）——v0.6 高密度范式，按画板 07 收紧：
 *   卡 `[col gap=4 pad=10] r=10`（原 `p-4` = 16 偏松）；status 英文角标 + `externalId`
 *   等宽 + `⛓ N` 依赖计数 + 剩余天数**全部保留**（技术模式的编排价值就在这些字段）。
 *
 * ── 四条不变量（team-lead 裁定，违反即回归）──
 *   ① 人话模式**不渲染** `StatusBadge`（PRD §4.6 :409「隐藏」+ 验收 S3「零英文状态」）；
 *   ② 状态语义由**组归属**表达，**不额外翻译**（「这个任务在进行中」由它落在
 *      「进行中」组表达，不需要角标再说一遍）；
 *   ③ 人话模式**不显示来源**（画板 06/22 卡片无 `human`/`agent` 标签；PRD §5.3）。
 *      —— 故 human 分支既不渲染 `SourceBadge`，也不渲染 `AssigneeDot`（那个圆点按
 *      `task.source` 取色，等于在卡面上偷偷把来源标出来）；来源只在**技术模式**
 *      与**任务详情抽屉**出现；
 *   ④ 因此本组件在 human 分支**不调用任何状态文案映射**。将来若某处确需人话
 *      状态文本，唯一合法来源是 `core/types/enums.ts` 的 `TASK_STATUS_LABELS`，
 *      **禁止**在 `agentTerms.ts` 建第三处（那会造成两份真相）。
 *
 * ── 为什么 human 分支的卡片不再是单个 `<button>` ──
 * 卡片要同时提供「点开详情」与「一个主按钮」两个动作。HTML 不允许 `<button>`
 * 嵌套 `<button>`（校验器报错 + 键盘焦点行为混乱），故 human 分支为
 * `<div>` 容器 + 两个并列 `<button>`（标题区按钮负责开抽屉，主按钮负责本组动作）。
 * tech 分支保持整卡单按钮（它只有一个动作 = 开抽屉），形态与 v0.6 逐字一致。
 *
 * ── `data-agent-task-card` 为什么存在（验收锚点，勿删）──
 * 人话行卡的根此前靠**样式类** `div.glass-light` 被验收 spec 定位。两个问题：
 *   ① `.glass-light` 的语义是「内凹井」（`global.css` 里 `background: sunken`），
 *      而画板 06 要的是 `fill=#FFFFFF`（paper）的**浮起行卡** —— 语义与画板相反；
 *   ② 样式类是可自由重构的实现细节，把它当测试锚点会让「换皮」变成「改测试」。
 * 故改为语义化的 `data-agent-task-card`（与既有 `data-board-hidden-hint` 同一惯例），
 * 卡面填充按画板走 `bg-paper`。**这是 DOM 契约，不是装饰**。
 *
 * 零新色：全部走既有 token（cream/paper/sunken/sand/line/ink/mist/pine/amber/moss/clay）。
 */

import type { Task } from '../../core/types/entities';
import { taskIsDone } from '../../core/types/entities';
import { ChangxiaError, ChangxiaErrorCode } from '../../core/types/enums';
import type { HumanBoardGroup } from '../../core/agent/board';
import { taskMetaText } from './taskMetaText';
import { termFor } from '../../constants/agentTerms';
import { useLayoutStore } from '../../store/useLayoutStore';
import { remainingDays } from '../../lib/date';
import { cn } from '../../lib/cn';

/**
 * 「临期」口径（PRD §5.4.3 元信息一行文案规范）：剩余天数 ≤ 3 视为临期 → amber。
 *
 * 唯一出处：卡面元信息与（将来的）置顶条脚注共用同一常量，避免两处各写一个 3。
 * 口径来源见 `CountdownNumber` / `Sidebar` 的既有「≤ 阈值即临期」惯例。
 */
export const HUMAN_DUE_SOON_DAYS = 3;

/** 来源徽标：agent → agentKind（等宽）；human → 成员名/负责人 */
export function SourceBadge({ task, label }: { task: Task; label?: string }): JSX.Element {
  if (task.source === 'agent') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-pine-soft px-1.5 py-0.5 text-[10px] text-pine">
        <span aria-hidden>🤖</span>
        <span className="font-mono">{label ?? 'agent'}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-sand px-1.5 py-0.5 text-[10px] text-mist">
      <span aria-hidden>👤</span>
      <span>{label ?? 'human'}</span>
    </span>
  );
}

/**
 * status 角标：英文原样显示（draft / ready / claimed / …），不翻译。
 *
 * ⚠️ **只在技术模式渲染**（人话模式不渲染角标，见文件头不变量 ①）。
 * `TaskDrawer` 引用本组件渲染角标——它在人话模式同样必须跳过（由调用方判定）。
 */
export function StatusBadge({ status }: { status: Task['status'] }): JSX.Element {
  return (
    <span
      className={cn(
        'shrink-0 rounded-[6px] px-1.5 py-0.5 font-mono text-[10px] leading-4',
        taskDoneClass(status),
      )}
    >
      {status}
    </span>
  );
}

/** status → 角标配色（只映射既有 token，零新色） */
function taskDoneClass(status: Task['status']): string {
  switch (status) {
    case 'done':
      return 'bg-sand text-mist line-through';
    case 'blocked':
      return 'bg-clay/15 text-clay';
    case 'review':
      return 'bg-amber-soft text-amber';
    case 'ready':
      return 'bg-pine-soft text-pine';
    default:
      return 'bg-sand text-mist';
  }
}

/**
 * 人话模式主按钮的**动作意图**。
 *
 * 卡片按 `group + status` 派生文案与意图（映射只此一处），父级只负责**执行**——
 * 这样「按钮写什么」与「按下去做什么」不会在两处各写一套而漂移。
 */
export type HumanPrimaryIntent = 'claim' | 'unblock' | 'approve' | 'open';

/**
 * 按组派生主按钮（PRD §4.1.3 :341-345 逐字）：
 *   待我确认 → 「验收」（review→done）/「解阻塞」（blocked→ready）
 *   可开工   → 「开始处理」（claim）
 *   进行中   → 「查看进度」（打开抽屉）
 *   已完成   → 「查看/复用」（打开抽屉）
 *
 * **与 `source` 无关**（PRD §5.3 纪律 1）：同样的组 + 同样的状态 → 同样的按钮，
 * 不因为是 Agent 派的任务就换个说法。
 *
 * `hidden` 组不渲染卡片，故此处不需要分支（防御性返回 open）。
 */
export function humanPrimaryOf(
  task: Task,
  group: HumanBoardGroup,
): { label: string; intent: HumanPrimaryIntent } {
  switch (group) {
    case 'ready':
      return { label: '开始处理', intent: 'claim' };
    case 'confirm':
      return task.status === 'review'
        ? { label: '验收', intent: 'approve' }
        : { label: '解阻塞', intent: 'unblock' };
    case 'doing':
      return { label: '查看进度', intent: 'open' };
    case 'done':
      return { label: '查看/复用', intent: 'open' };
    default:
      return { label: '查看', intent: 'open' };
  }
}

/** 剩余 / 逾期天数（tech 与人话模式共用的文案，避免两处算法漂移） */
function dueText(task: Task): { text: string; overdue: boolean; days: number } | null {
  if (!task.dueDate) return null;
  const days = remainingDays(task.dueDate.slice(0, 10));
  if (taskIsDone(task)) return { text: `剩余 ${days} 天`, overdue: false, days };
  return days < 0
    ? { text: `逾期 ${Math.abs(days)} 天`, overdue: true, days }
    : { text: `剩余 ${days} 天`, overdue: false, days };
}

/**
 * 人话模式元信息的**语气**（PRD §5.4.3）：
 *   clay  受阻 / 逾期（要人立刻看一眼）
 *   amber 临期（≤ HUMAN_DUE_SOON_DAYS 天）
 *   mist  正常
 *
 * 颜色承载紧急度，**取代**英文状态角标（S3）——这是「状态改由组归属表达」的配套：
 * 组说「这条归谁处理」，元信息颜色说「有多急」。
 */
export type HumanMetaTone = 'clay' | 'amber' | 'mist';

/** 语气 → 文字色（静态映射表；禁用模板字符串拼类名，BUG-05） */
const META_TONE_CLASS: Record<HumanMetaTone, string> = {
  clay: 'text-clay',
  amber: 'text-amber',
  mist: 'text-mist',
};

/**
 * 人话模式元信息一行（PRD §5.4.3 表逐行落地）。
 *
 * 优先级：受阻 > 逾期 > 临期 > 正常。受阻优先于逾期——「被卡住」比「快到期」
 * 更需要人动手，且受阻时剩余天数往往已无意义（任务根本推不动）。
 *
 * 导出以便验收用例与（将来的）移动端复用同一口径，避免第三处拼装。
 */
export function humanMetaOf(
  task: Task,
  assigneeLabel: string | undefined,
  blockedByTitles: readonly string[],
): { text: string; tone: HumanMetaTone } {
  const who = `负责人：${assigneeLabel ?? '待认领'}`;

  if (blockedByTitles.length > 0) {
    return { text: `${who} · 受阻：${blockedByTitles.join('、')}`, tone: 'clay' };
  }

  const due = dueText(task);
  if (!due) return { text: who, tone: 'mist' };

  if (due.overdue) return { text: `${who} · ${due.text}`, tone: 'clay' };
  if (!taskIsDone(task) && due.days <= HUMAN_DUE_SOON_DAYS) {
    return { text: `${who} · ${due.text}`, tone: 'amber' };
  }
  return { text: `${who} · ${due.text}`, tone: 'mist' };
}

export function AgentTaskCard({
  task,
  assigneeLabel,
  blockedByTitles = [],
  onOpen,
  group,
  onPrimary,
}: {
  task: Task;
  /** 指派人展示名（human 显示成员名；agent 显示 agentKind） */
  assigneeLabel?: string;
  /** 未满足前置的标题（非空 = 视觉高亮受阻） */
  blockedByTitles?: string[];
  onOpen(taskId: string): void;
  /**
   * 人话模式：所属组。决定主按钮文案与意图；不传则按技术模式渲染
   * （用「传了 group」而非「再传一个 mode」作开关，避免两个可变来源打架）。
   */
  group?: HumanBoardGroup;
  /** 人话模式：主按钮回调（意图由卡片派生，父级只执行） */
  onPrimary?(task: Task, intent: HumanPrimaryIntent): void;
}): JSX.Element {
  const termMode = useLayoutStore((s) => s.agentBoardMode);
  /** 人话模式 = 调用方给了 group（四组视图才传 group） */
  const human = group !== undefined;

  /* ------------------------------ 人话模式（画板 06 全宽行卡） ------------------------------ */
  if (human) {
    const primary = humanPrimaryOf(task, group);
    const blocked = blockedByTitles.length > 0;
    const meta = humanMetaOf(task, assigneeLabel, blockedByTitles);

    return (
      <div
        data-agent-task-card=""
        className={cn(
          'flex w-full items-center gap-3 rounded-2xl border bg-paper p-3 transition-colors hover:border-pine/50',
          blocked ? 'border-clay/40' : 'border-line',
        )}
      >
        {/* 左：任务文字列 [col gap=3]（标题 14/SemiBold + 元信息 13/Regular 一行） */}
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            className="block w-full truncate text-left text-base font-semibold text-ink transition-colors hover:text-pine"
          >
            {task.title}
          </button>
          {/* 紧急度由**这一行的颜色**承载（受阻/逾期 clay · 临期 amber · 正常 mist） */}
          <span className={cn('truncate text-sm', META_TONE_CLASS[meta.tone])} title={meta.text}>
            {meta.text}
          </span>
        </div>

        {/* 右：**唯一**主按钮 hug×34 [row pad=14] r=12（按组 + 状态派生，与来源无关） */}
        <button
          type="button"
          onClick={() => (onPrimary ? onPrimary(task, primary.intent) : onOpen(task.id))}
          className="inline-flex h-[34px] shrink-0 items-center rounded-[12px] border border-pine px-3.5 text-sm text-pine transition-colors hover:bg-pine-soft"
        >
          {primary.label}
        </button>
      </div>
    );
  }

  /* ------------------------------ 技术模式（v0.6 原样 · 画板 07 收紧内边距） ------------------------------ */
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className={cn(
        'glass-light flex w-full flex-col rounded-[10px] p-2.5 text-left transition-colors hover:border-pine/50',
        blockedByTitles.length > 0 ? 'border-clay/40' : 'border-line',
      )}
    >
      {/* 第一行：标题 + status 角标 */}
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {task.title}
        </span>
        <StatusBadge status={task.status} />
      </div>

      {/*
        第二行：短号 · 来源 + 来源徽标（等宽，开发者向高密度；人话模式**没有**这一行）。

        v0.7 T03 · P0-15 / V1-10：此格此前渲染 `task.externalId ?? task.id`
        （幂等键，如 `workbuddy:run1:local3`）—— 那是**给机器看的**，人读不出
        「这是第几条」。改为人读短号 `T-1042 · agent`（V1-14 ① 的正则口径）。

        补零/进位/老数据归一**全部**由 `taskMetaText` → `formatTaskNo` 负责，
        本处**不**拼 `'T-' + n`（该串的唯一出处纪律见 `core/lib/task-no.ts`）。
        品牌级来源（`agentKind`：workbuddy / deepseek / …）仍由右侧 `SourceBadge`
        承载，故本次改动**不丢信息**。
      */}
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-mist">
        <span className="truncate font-mono" data-task-no="">
          {taskMetaText(task)}
        </span>
        <span className="ml-auto shrink-0">
          <SourceBadge task={task} label={assigneeLabel} />
        </span>
      </div>

      {/* 第三行：deps 计数 + dueDate 剩余天数 */}
      <div className="mt-1 flex items-center gap-2 text-[10px]">
        {(task.dependsOn?.length ?? 0) > 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5',
              blockedByTitles.length > 0 ? 'text-clay' : 'text-mist',
            )}
            title={
              blockedByTitles.length > 0
                ? `${termFor('blockedBy', termMode)}：${blockedByTitles.join('、')}`
                : termFor('deps', termMode)
            }
          >
            ⛓ {task.dependsOn.length}
            {blockedByTitles.length > 0 && <span>（受阻）</span>}
          </span>
        )}
        {dueText(task) && (
          <span
            className={cn(
              'ml-auto tabular-nums',
              dueText(task)?.overdue ? 'text-clay' : 'text-mist',
            )}
          >
            {dueText(task)?.text}
          </span>
        )}
      </div>
    </button>
  );
}

/** 供 ReadyQueue / 看板列共用的受阻标题解析（纯派生，不进 store） */
export function unmetDepTitles(
  task: Task,
  byId: ReadonlyMap<string, Task>,
): string[] {
  return (task.dependsOn ?? [])
    .map((dep) => byId.get(dep))
    .filter((d): d is Task => !!d && !taskIsDone(d))
    .map((d) => d.title);
}

/** 冲突错误是否为「认领争抢」类（TaskDrawer claim 按钮文案分支用） */
export function isClaimConflict(err: unknown): boolean {
  return err instanceof ChangxiaError && err.code === ChangxiaErrorCode.Conflict;
}
