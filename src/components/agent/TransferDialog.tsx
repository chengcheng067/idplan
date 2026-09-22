/**
 * 「接管」确认弹窗（v0.8 · T04-B；设计文档 §4.1 文件清单第 12 项、§7.4 / PRD D5 / TS-06 / TBD-9）。
 *
 * ══════════════════════════ 这个组件做两件事，一件都不能少 ══════════════════════════
 *
 * ① **双层门的上层（UI 隐藏）**：`useRoleGuard()` 判 admin。不是 admin ⇒ 组件返回 `null`，
 *    整个入口**不进渲染树**（不是"渲染了但按钮 disabled"）。
 *
 * ② **接管意图显式化**：确认时构造的命令里**恒带** `takeover: true`。
 *    这一点看着像冗余（弹窗本身就叫"接管"），但它防的是一条具体的失效模式：
 *    将来某个调用方把这个弹窗复用成"移动任务"的普通入口，只要忘了带这个字段，
 *    服务端就会按**普通写入**受理 —— 而接管是**跨工作区的写**，必须与服务端的
 *    `assertAdmin` 严格配对。把意图写进**命令对象**（而不是靠 UI 语境），
 *    使"漏传"变成类型层可见的缺字段。
 *
 * ══════════════════════════ ⚠️ UI 隐藏**不是**安全边界（TBD-9 原文对这条的裁决） ══════════════════════════
 *
 * `isAdmin` 这一层只是**体验**：让 member 看不到一个他点了会被拒的按钮。
 * 真正的安全边界**只在服务端**（`assertAdmin`）。本组件**不**假装自己是那道门 ——
 * 所以它不在本地拦截提交（不做"先偷偷判角色再决定发不发请求"），
 * 只要组件被渲染出来并能提交，请求照发，由服务端裁定。这样：
 *   · 若将来 UI 门控被误删，服务端仍然拦得住（失效是安全的降级，不是数据事故）；
 *   · 若有人绕过 UI 直接构造命令，服务端同样拦得住 —— UI 层从来不是唯一防线。
 *
 * ══════════════════════════ 两条接管路径（PRD「转为正式项目 / 搬运任务」） ══════════════════════════
 *
 *   · `'convert'` 转为正式项目：把这块 Agent 看板**整体**变成人类侧的项目（kind: agent → human）。
 *     选它时**不改动**看板名与阶段，故不需要"搬运哪些任务"这种选择。
 *   · `'move'`  搬运任务：把选中的任务搬进**已有**的人类项目。故必须先选目标项目、
 *     **显式选落点阶段**（不提供"自动建阶段"，PRD B12 硬性），且必须至少选中一条任务
 *     （空选择 = 什么都没搬，属于误点，直接不允许确认）。
 *
 * ══════════════════════════ 预览为什么是"算出来的"而不是写死的文案 ══════════════════════════
 *
 * 预览与执行**共用** `agent-takeover.service` 的同一对纯函数（`planTaskMove` +
 * `previewMove`）：将新建 X / 将更新 Y（目标项目已有同 externalId 的任务）/ 将剔除
 * 悬空依赖 Z 条（逐条列出"哪条任务失去哪个前驱"）。写死文案会出现"预览说搬 3 条、
 * 实际搬 5 条"——那种缺陷单看界面永远发现不了。悬空依赖必须显式列表：`dag.ts` 把
 * 解不到的依赖当作**已满足**，静默留一条空边会让任务**悄悄变成可开工**。
 *
 * ══════════════════════════ 数据来源（本组件不读任何 store） ══════════════════════════
 *
 * `sourceBoard` / `tasks` / `candidates` / `targetStages` / `targetTasks` 全部由调用方
 * 传入。特别是 `candidates`：调用方**必须**已用隔离漏斗收窄为 `'human'`
 * （`visibleProjectsFor('human', …)` 或 `humanTakeoverCandidates`）——本组件不替调用方
 * 过滤，因为"喂错数据"这件事必须在**调用点**一眼可见（同 `AgentBoardList` 的纪律）。
 * 把人类项目搬进……不，把 Agent 任务搬进 **Agent** 看板是**无意义**的搬运，
 * 那种"目标其实是另一块 Agent 看板"的错误只能由调用点的漏斗挡住。
 */

import { useMemo, useState } from 'react';

import { AlertTriangle, ArrowRight, X } from 'lucide-react';

import type { Project, Stage, Task } from '../../core/types/entities';
import { ChangxiaError } from '../../core/types/enums';
import { planTaskMove, previewMove } from '../../core/services/agent-takeover.service';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { Modal } from '../common/Modal';
import { cn } from '../../lib/cn';

/** 接管方式（PRD 的两种：转为正式项目 / 搬运任务） */
export type TransferMode = 'convert' | 'move';

/**
 * 接管命令（提交给服务端的**唯一**形状）。
 *
 * `takeover: true` 是**字面量类型**（不是 `boolean`）：调用方无法构造一个
 * `takeover: false` 的"半接管"，也不可能"忘记传" —— 少写这个字段直接编译失败。
 */
export interface TransferCommand {
  /** ★ 显式接管意图。字面量 `true`（不是 boolean）：漏传 / 传 false 都编译不过 */
  takeover: true;
  /** 来源 Agent 看板 id */
  sourceBoardId: string;
  mode: TransferMode;
  /** `mode === 'move'` 时为**人类项目** id；`convert` 时为 `null`（无目标，看板自身转正） */
  targetProjectId: string | null;
  /** `mode === 'move'` 时为目标项目里的**落点阶段** id；`convert` 时为 `null` */
  stageId: string | null;
  /** `mode === 'move'` 时要搬走的任务 id（非空）；`convert` 时为空数组 */
  taskIds: readonly string[];
}

/** 接管结果摘要（供调用方决定 toast 文案；本组件只负责展示服务端返回的条数） */
export interface TransferOutcome {
  /** 实际搬运的任务条数（`convert` 为 0） */
  movedTaskCount: number;
}

/** 预览摘要的展示行（目标侧悬空依赖，逐条） */
interface DroppedDepRow {
  taskTitle: string;
  depTitle: string;
}

export function TransferDialog({
  open,
  onClose,
  sourceBoard,
  tasks,
  candidates,
  targetStages,
  targetTasks,
  onConfirm,
}: {
  open: boolean;
  onClose(): void;
  /** 来源看板（只读展示；本组件不写它） */
  sourceBoard: { id: string; name: string };
  /** 来源看板下的任务（预览 / 勾选用） */
  tasks: readonly Task[];
  /**
   * 目标候选：**人类侧项目**。调用方必须已经用漏斗（`visibleProjectsFor('human', …)`）
   * 收窄 —— 传进来的是 Agent 看板是调用方的错，本组件不替它兜。
   */
  candidates: readonly Project[];
  /**
   * 目标项目的阶段（落点选择的数据源）。传入**人类侧全部**阶段即可——
   * 本组件内部按选中目标过滤（阶段属于项目，说什么也不能把 A 项目的阶段
   * 列给 B 项目当落点）。调用方无需为每次切换目标做异步加载。
   */
  targetStages: readonly Stage[];
  /** 目标项目的任务（预览"将更新 Y"的比对底数）。同为人类侧全量，内部按目标过滤。 */
  targetTasks: readonly Task[];
  /** 确认接管。成功返回回执；失败请抛（`ChangxiaError.userMessage` 会就地展示） */
  onConfirm(cmd: TransferCommand): Promise<TransferOutcome>;
}): JSX.Element | null {
  /* ★ 双层门的上层：非 admin ⇒ 整块不进渲染树（不是 disabled）。
   *   注意 hook 必须在任何 return 之前调用（本项目曾因 hook 顺序栽过白屏）。 */
  const { isAdmin } = useRoleGuard();

  const [mode, setMode] = useState<TransferMode>('convert');
  const [targetId, setTargetId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');
  /** 勾选的任务 id（默认**全选**：用户说"搬到人类项目"时，通常就是要搬全部） */
  const [selectedTaskIds, setSelectedTaskIds] = useState<readonly string[]>(() =>
    tasks.map((t) => t.id),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = selectedTaskIds.length;

  /** 目标与落点任一变了，旧的落点阶段选择对新目标即失效（阶段属于项目） */
  const onTargetChange = (next: string): void => {
    setTargetId(next);
    setStageId('');
  };

  /** 选中目标的阶段选项（按 orderIndex 排；没选目标 → 空） */
  const stageOptions = useMemo(
    () =>
      targetId === ''
        ? []
        : targetStages
            .filter((s) => s.projectId === targetId)
            .sort((a, b) => a.orderIndex - b.orderIndex),
    [targetStages, targetId],
  );

  /** 选中目标的任务（预览的 externalId 比对底数；没选目标 → 空） */
  const targetProjectTasks = useMemo(
    () => (targetId === '' ? [] : targetTasks.filter((t) => t.projectId === targetId)),
    [targetTasks, targetId],
  );

  /** 确认按钮的可提交条件（两条路径各有门槛，见上方"两条接管路径"） */
  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (mode === 'convert') return true;
    return targetId !== '' && stageId !== '' && selectedCount > 0;
  }, [mode, submitting, targetId, stageId, selectedCount]);

  /**
   * 搬运预览 —— 与执行共用同一对纯函数（预览/执行不可能漂移）。
   * 落点未选全时算不出计划（stageId 为空），预览区退回静态说明。
   */
  const movePreview = useMemo(() => {
    if (mode !== 'move' || targetId === '' || stageId === '') return null;
    const plan = planTaskMove({
      sourceTasks: tasks,
      targetTasks: targetProjectTasks,
      taskIds: selectedTaskIds,
      stageId,
      targetProjectId: targetId,
    });
    return previewMove(plan);
  }, [mode, targetId, stageId, tasks, targetProjectTasks, selectedTaskIds]);

  /** 悬空依赖展示行（目标侧；源侧只有计数，避免同一个弹窗里两张长列表） */
  const droppedDepRows: DroppedDepRow[] = useMemo(() => {
    if (!movePreview) return [];
    const rows: DroppedDepRow[] = [];
    for (const m of movePreview.moves) {
      for (const d of m.droppedDeps) rows.push({ taskTitle: m.title, depTitle: d.depTitle });
    }
    return rows;
  }, [movePreview]);

  const toggleTask = (taskId: string): void => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((x) => x !== taskId) : [...prev, taskId],
    );
  };

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({
        // ★ 显式意图：字面量 true。UI 语境不参与判定，服务端 assert 才是边界。
        takeover: true,
        sourceBoardId: sourceBoard.id,
        mode,
        targetProjectId: mode === 'move' ? targetId : null,
        stageId: mode === 'move' ? stageId : null,
        taskIds: mode === 'move' ? selectedTaskIds : [],
      });
      onClose();
    } catch (err) {
      // 就地展示服务端/领域的真实原因（member 被服务端拒绝时，用户看到的应当是
      // "只有管理员可以接管"这类具体文案，而不是笼统的"操作失败"）
      setError(err instanceof ChangxiaError ? err.userMessage : '接管失败，请重试。');
    } finally {
      setSubmitting(false);
    }
  };

  // 门控必须在所有 hook 调用**之后**（顺序稳定），故放在这里而不是文件顶部
  if (!isAdmin) return null;
  if (!open) return null;

  return (
    <Modal open onClose={onClose} ariaLabel="接管 Agent 看板">
      <div
        data-transfer-dialog=""
        className="glass-strong w-full max-w-lg rounded-2xl p-5 shadow-soft"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
            <ArrowRight size={18} className="text-pine" aria-hidden />
            接管「{sourceBoard.name}」
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="取消接管"
            className="rounded-md p-1 text-mist transition-colors hover:bg-sand hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/*
          为什么把"UI 隐藏不是安全边界"这句写在用户看得见的地方：
          接管是**跨工作区的写**（Agent 看板 → 人类侧）。让操作者清楚"这一下会改变数据的归属"，
          比任何二次确认的措辞都重要。
        */}
        <p className="mb-3 flex items-start gap-2 rounded-md border border-amber/40 bg-amber-soft px-3 py-2 text-xs leading-5 text-amber">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            接管会把这块看板里的数据**移入人类工作区**，此后它归「我的项目」一侧管理。
            该操作仅管理员可用。
          </span>
        </p>

        {/* 方式选择（两条路径） */}
        <fieldset className="mb-3">
          <legend className="mb-1.5 text-sm font-medium text-ink">接管方式</legend>
          <div className="flex flex-col gap-2">
            {(
              [
                {
                  key: 'convert' as const,
                  label: '转为正式项目',
                  hint: '整块看板变成人类工作区里的一个项目（名称与阶段一并保留）。',
                },
                {
                  key: 'move' as const,
                  label: '搬运任务',
                  hint: '把选中的任务搬进一个已有的人类项目（需选落点阶段）。',
                },
              ] satisfies Array<{ key: TransferMode; label: string; hint: string }>
            ).map((opt) => (
              <label
                key={opt.key}
                data-transfer-mode={opt.key}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors',
                  mode === opt.key
                    ? 'border-pine bg-pine-soft'
                    : 'border-line bg-paper hover:bg-sunken',
                )}
              >
                <input
                  type="radio"
                  name="transfer-mode"
                  className="mt-1"
                  checked={mode === opt.key}
                  onChange={() => setMode(opt.key)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{opt.label}</span>
                  <span className="block text-xs text-mist">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* 搬运任务：目标项目 + 落点阶段 + 任务勾选 */}
        {mode === 'move' && (
          <>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium text-ink">
                目标项目
                <span className="text-clay"> *（仅列人类工作区的项目）</span>
              </span>
              {candidates.length === 0 ? (
                <p
                  data-transfer-no-target=""
                  className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-mist"
                >
                  人类工作区里还没有项目。请先建一个项目，或改选「转为正式项目」。
                </p>
              ) : (
                <select
                  data-transfer-target=""
                  value={targetId}
                  onChange={(e) => onTargetChange(e.target.value)}
                  className="h-[38px] w-full rounded-md border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-pine"
                >
                  <option value="">（请选择目标项目）</option>
                  {candidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </label>

            {/*
              落点阶段（PRD B12 硬性：**显式选**，且**不提供"自动建阶段"**）。
              阶段属于项目 ⇒ 换目标必须清空重选（见 onTargetChange）。
              目标项目的阶段由调用方异步加载；未加载完时给明确文案而不是空下拉。
            */}
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium text-ink">
                落点阶段
                <span className="text-clay"> *（不自动新建阶段）</span>
              </span>
              {targetId === '' ? (
                <p className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-mist">
                  请先选择目标项目。
                </p>
              ) : stageOptions.length === 0 ? (
                <p
                  data-transfer-no-stage=""
                  className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-mist"
                >
                  目标项目还没有阶段，请先在其详情页添加阶段后再搬运。
                </p>
              ) : (
                <select
                  data-transfer-stage=""
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  className="h-[38px] w-full rounded-md border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-pine"
                >
                  <option value="">（请选择落点阶段）</option>
                  {stageOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.orderIndex}. {s.name}
                    </option>
                  ))}
                </select>
              )}
            </label>

            <div className="mb-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium text-ink">
                  搬运任务<span className="text-clay"> *</span>
                </span>
                <span className="text-xs tabular-nums text-mist">
                  已选 {selectedCount} / {tasks.length}
                </span>
              </div>
              {tasks.length === 0 ? (
                <p
                  data-transfer-no-task=""
                  className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-mist"
                >
                  这块看板下还没有任务，没有可搬运的内容。
                </p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-md border border-line bg-cream/50 p-2">
                  {tasks.map((t) => {
                    const checked = selectedTaskIds.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        data-transfer-task={t.id}
                        className="flex cursor-pointer items-center gap-2 border-b border-line/40 py-1.5 text-sm last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTask(t.id)}
                        />
                        <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* 预览（确认前把"将发生什么"讲清楚；搬运模式用与服务端同源的计划函数实算） */}
        <div
          data-transfer-preview=""
          className="mb-3 rounded-md border border-line bg-cream/50 px-3 py-2.5 text-xs leading-5 text-mist"
        >
          {mode === 'convert' ? (
            <>
              预览：把看板「{sourceBoard.name}」整体转为人类工作区的正式项目
              （其中 {tasks.length} 条任务一并转入）。
            </>
          ) : movePreview ? (
            <div className="flex flex-col gap-1.5">
              <p>
                预览：把选中的 <strong className="text-ink">{selectedCount}</strong> 条任务从「
                {sourceBoard.name}」搬入{' '}
                <strong className="text-ink">
                  {candidates.find((p) => p.id === targetId)?.name ?? '（未选择目标项目）'}
                </strong>
                ，其中新建 <strong className="text-ink">{movePreview.createCount}</strong> 条、
                更新既有 <strong className="text-ink">{movePreview.updateCount}</strong> 条
                （目标项目已有同外部编号的任务）。
              </p>
              {movePreview.droppedDependencyCount > 0 && (
                <p data-transfer-preview-dropped="" className="text-clay">
                  将剔除 {movePreview.droppedDependencyCount} 条悬空依赖（前驱未随本批搬走，
                  留着会让任务被误判为可开工）：
                  {droppedDepRows.map((r, i) => (
                    <span key={`${r.taskTitle}-${r.depTitle}-${i}`} className="block pl-2">
                      · 「{r.taskTitle}」不再依赖「{r.depTitle}」
                    </span>
                  ))}
                </p>
              )}
              {movePreview.sourceDroppedDependencyCount > 0 && (
                <p className="text-amber">
                  源看板中另有 {movePreview.sourceDroppedDependencyCount} 条依赖指向被搬走的任务，
                  将一并剥除（涉及 {movePreview.sourceRewires.length} 条留下的任务）。
                </p>
              )}
              {selectedCount === 0 && <p className="text-clay">请至少勾选一条任务。</p>}
            </div>
          ) : (
            <>
              预览：把选中的 <strong className="text-ink">{selectedCount}</strong> 条任务
              从「{sourceBoard.name}」搬入{' '}
              <strong className="text-ink">
                {candidates.find((p) => p.id === targetId)?.name ?? '（未选择目标项目）'}
              </strong>
              。选好目标项目与落点阶段后，这里会列出将新建 / 将更新 / 将剔除的悬空依赖。
            </>
          )}
        </div>

        {error && (
          <p role="alert" className="mb-2 text-xs leading-5 text-clay">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand"
          >
            取消
          </button>
          <button
            type="button"
            data-transfer-confirm=""
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="rounded-md bg-pine px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-pine-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? '处理中…' : '确认接管'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
