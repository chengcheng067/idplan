/**
 * Agent Board 任务卡（v0.7 · T07 双模式重写；T04 起 mode 显式传入）。
 *
 * ── 两种模式，两套呈现（同组件内分派，不拆文件）──
 *
 * **人话模式**（默认，PRD §4.1.3 卡片信息层级）——每条卡**只四件事**：
 *   ① 人话标题（`task.title`）
 *   ② 负责人（色点 + 展示名；agent → agentKind，human → 成员名）
 *   ③ 时间（`剩余 N 天` / `逾期 N 天`）
 *   ④ **一个**主按钮（按组派生：见 `humanPrimaryOf`）
 *   外加「受阻原因」一行（受阻时才出现，用人话标题而非 id）。
 *
 * **技术模式**（PRD §4.2「保留现有形态」）——原 v0.6 高密度范式原样保留：
 *   status 英文角标 + `externalId` 等宽 + `⛓ N` 依赖计数 + 剩余天数。
 *
 * ── 三项不变量（team-lead 裁定，违反即回归）──
 *   ① 人话模式**不渲染** `StatusBadge`（PRD §4.6 :409「隐藏」+ 验收 S3「零英文状态」）；
 *   ② 状态语义由**组归属**表达，**不额外翻译**（「这个任务在进行中」由它落在
 *      「进行中」组表达，不需要角标再说一遍）；
 *   ③ 因此本组件在 human 分支**不调用任何状态文案映射**。将来若某处确需人话
 *      状态文本，唯一合法来源是 `core/types/enums.ts` 的 `TASK_STATUS_LABELS`，
 *      **禁止**在 `agentTerms.ts` 建第三处（那会造成两份真相）。
 *
 * ── 为什么 human 分支的卡片不再是单个 `<button>` ──
 * 卡片要同时提供「点开详情」与「一个主按钮」两个动作。HTML 不允许 `<button>`
 * 嵌套 `<button>`（校验器报错 + 键盘焦点行为混乱），故 human 分支改为
 * `<div>` 容器 + 两个并列 `<button>`（标题区按钮负责开抽屉，主按钮负责本组动作）。
 * tech 分支保持整卡单按钮（它只有一个动作 = 开抽屉），形态与 v0.6 逐字一致。
 *
 * 零新色：全部走既有 token（cream/paper/sand/ink/mist/pine/amber/clay）。
 */

import type { Task } from '../../core/types/entities';
import { taskIsDone } from '../../core/types/entities';
import { ChangxiaError, ChangxiaErrorCode } from '../../core/types/enums';
import type { HumanBoardGroup } from '../../core/agent/board';
import { termFor } from '../../constants/agentTerms';
import { useLayoutStore } from '../../store/useLayoutStore';
import { remainingDays } from '../../lib/date';
import { cn } from '../../lib/cn';

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
 *   可开工   → 「认领开工」（claim）
 *   进行中   → 「查看进度」（打开抽屉）
 *   已完成   → 「查看/复用」（打开抽屉）
 *
 * `hidden` 组不渲染卡片，故此处不需要分支（防御性返回 open）。
 */
export function humanPrimaryOf(
  task: Task,
  group: HumanBoardGroup,
): { label: string; intent: HumanPrimaryIntent } {
  switch (group) {
    case 'ready':
      return { label: '认领开工', intent: 'claim' };
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

/** 负责人色点（agent → pine，human → mist；只映射既有 token） */
function AssigneeDot({ task }: { task: Task }): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        task.source === 'agent' ? 'bg-pine' : 'bg-mist',
      )}
    />
  );
}

/** 剩余 / 逾期天数（tech 与人话模式共用的文案，避免两处算法漂移） */
function dueText(task: Task): { text: string; overdue: boolean } | null {
  if (!task.dueDate) return null;
  const days = remainingDays(task.dueDate.slice(0, 10));
  if (taskIsDone(task)) return { text: `剩余 ${days} 天`, overdue: false };
  return days < 0
    ? { text: `逾期 ${Math.abs(days)} 天`, overdue: true }
    : { text: `剩余 ${days} 天`, overdue: false };
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

  const due = dueText(task);

  /* ------------------------------ 人话模式 ------------------------------ */
  if (human) {
    const primary = humanPrimaryOf(task, group);
    const blocked = blockedByTitles.length > 0;
    return (
      <div
        className={cn(
          'glass-light w-full rounded-[12px] border p-2.5 transition-colors hover:border-pine/50',
          blocked ? 'border-clay/40' : 'border-line',
        )}
      >
        {/* ① 人话标题（点开详情） */}
        <button
          type="button"
          onClick={() => onOpen(task.id)}
          className="block w-full truncate text-left text-sm font-medium text-ink hover:text-pine"
        >
          {task.title}
        </button>

        {/* ②+③ 负责人 + 时间 */}
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-mist">
          <span className="flex min-w-0 items-center gap-1">
            <AssigneeDot task={task} />
            <span className="truncate">{assigneeLabel ?? '未指派'}</span>
          </span>
          {due && (
            <span
              className={cn('ml-auto shrink-0 tabular-nums', due.overdue && 'text-clay')}
            >
              {due.text}
            </span>
          )}
        </div>

        {/* 受阻原因：人话标题（PRD §4.1.3 :339「次」层，但受阻是决策信息故留在卡面） */}
        {blocked && (
          <p className="mt-1 truncate text-[10px] text-clay">
            受阻：{blockedByTitles.join('、')}
          </p>
        )}

        {/* ④ 一个主按钮 */}
        <button
          type="button"
          onClick={() => (onPrimary ? onPrimary(task, primary.intent) : onOpen(task.id))}
          className="mt-2 w-full rounded-[8px] border border-pine px-2.5 py-1 text-xs text-pine transition-colors hover:bg-pine-soft"
        >
          {primary.label}
        </button>
      </div>
    );
  }

  /* ------------------------------ 技术模式（v0.6 原样） ------------------------------ */
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className={cn(
        'glass-light w-full rounded-[12px] border p-2.5 text-left transition-colors hover:border-pine/50',
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

      {/* 第二行：id + 来源徽标（等宽，开发者向高密度） */}
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-mist">
        <span className="truncate font-mono">{task.externalId ?? task.id}</span>
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
        {due && (
          <span className={cn('ml-auto tabular-nums', due.overdue ? 'text-clay' : 'text-mist')}>
            {due.text}
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
