/**
 * 休息制度切换重算 · 确认弹窗（v3 §4.4，产品决策文档 §四）。
 *
 * ── 形态（需求方 10-09 拍板）──
 *   · 影响计数：「将重算 N 个工作日制项目的 M 个阶段（已完成 K 个冻结不动）」
 *     ——自然日制项目零影响，计数按此口径（§4.0）；
 *   · 逐项目可展开的 before→after 日期对照表（预览即演算：弹窗先跑纯函数
 *     出 diff，确认后应用**同一份 RecalcPlan**，不存在预览与应用不一致）；
 *   · 「工期不变（默认）/ 调整工期」二选——选调整 = 内嵌每阶段天数编辑器，
 *     复用建档 ManualFallbackForm 的时长覆盖语义（parseDurationDays 同源：
 *     key=stageId、value=天数字符串、空=未填走原工期）；
 *   · dueDate 可选对齐复选框（默认不勾）：「把到期日平移到阶段新区间内
 *     （保持阶段内相对偏移）」+「N 个任务的到期日将落在阶段新区间之外」计数；
 *   · 备份建议行（不强制，措辞硬）：「重算不可撤销（无 undo，恢复靠备份）」
 *     +「先去备份」一键导出；
 *   · 明示「重算会写进阶段流水，打印延期台账时可见」（客户可见稿）。
 *
 * ── 应用（编排）──
 * 逐阶段走**既有** StageService.reschedule()（自带 StageLogType.Rescheduled
 * 留痕 + reason 必填校验），不新开批量写口；项目 plannedEndAt 拖出时才更新；
 * 每阶段一条 reason='休息制度切换：双休→单休'（新制度名）。
 */

import { useMemo, useState } from 'react';

import { AlertTriangle, ChevronDown, ChevronRight, Save, X } from 'lucide-react';

import {
  REST_POLICY_LABELS,
  RestPolicyKind,
  ScheduleBasis,
  StageStatus,
} from '../../core/types/enums';
import type { Project, RestPolicyConfig, Stage, Task } from '../../core/types/entities';
import { StageService } from '../../core/services/stage.service';
import { withCnHolidays } from '../../core/holidays/policy';
import {
  planRestPolicyRecalc,
  parseDurationDays,
  restPolicyRecalcReason,
  type RecalcPlan,
} from '../../lib/restPolicyRecalc';
import { useRepos } from '../../hooks/useRepos';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useMembersStore } from '../../store/useMembersStore';
import { exportBackupToFile } from '../layout/useBackupIo';
import { Modal } from '../common/Modal';
import { cn } from '../../lib/cn';
import type { IRepositoryBundle } from '../../core/repositories/interfaces';

/* ------------------------------ 编排（可单测） ------------------------------ */

export interface ApplyRecalcDeps {
  repos: IRepositoryBundle;
  operatorName: string;
  reason: string;
  /** 是否把到期日平移到阶段新区间内（弹窗复选框，默认 false） */
  alignTaskDueDates: boolean;
}

export interface ApplyRecalcResult {
  updatedStages: Stage[];
  updatedProjects: Project[];
  updatedTasks: Task[];
  failed: number;
}

/**
 * 应用一份 RecalcPlan（预览即演算：弹窗把**同一份 plan** 传进来）。
 * 逐阶段走 StageService.reschedule（留痕 + reason 闸门）；失败逐条计数不中断。
 */
export async function applyRestPolicyRecalc(
  plan: RecalcPlan,
  deps: ApplyRecalcDeps,
): Promise<ApplyRecalcResult> {
  const service = new StageService({ stages: deps.repos.stages, logs: deps.repos.logs });
  const updatedStages: Stage[] = [];
  const updatedProjects: Project[] = [];
  const updatedTasks: Task[] = [];
  let failed = 0;

  for (const pp of plan.projects) {
    for (const sp of pp.stages) {
      if (!sp.changed) continue;
      try {
        updatedStages.push(
          await service.reschedule(sp.stageId, {
            newStartAt: `${sp.newStartAt}T00:00:00Z`,
            newEndAt: `${sp.newEndAt}T23:59:59Z`,
            reason: deps.reason,
            operatorName: deps.operatorName,
          }),
        );
      } catch {
        failed += 1;
      }
    }
    if (pp.plannedEndAtChanged) {
      try {
        // 竣工日与建档口径一致：纯日期 'YYYY-MM-DD'
        updatedProjects.push(
          await deps.repos.projects.update(pp.projectId, { plannedEndAt: pp.newPlannedEndAt }),
        );
      } catch {
        failed += 1;
      }
    }
    if (deps.alignTaskDueDates) {
      for (const ts of pp.taskShifts) {
        try {
          updatedTasks.push(await deps.repos.tasks.update(ts.taskId, { dueDate: ts.newDueDate }));
        } catch {
          failed += 1;
        }
      }
    }
  }

  return { updatedStages, updatedProjects, updatedTasks, failed };
}

/* ------------------------------ 弹窗 ------------------------------ */

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

const STATUS_LABELS: Record<StageStatus, string> = {
  [StageStatus.NotStarted]: '未开始',
  [StageStatus.InProgress]: '进行中',
  [StageStatus.Completed]: '已完成',
  [StageStatus.Delayed]: '延期',
};

export interface RestPolicyRecalcDialogProps {
  /** 新制度草稿（用户已选、尚未落库） */
  draft: RestPolicyConfig;
  /** 旧制度（生效口径：store.effectiveRestPolicy，已合并节假日） */
  oldPolicy: RestPolicyConfig;
  /** 取消：不保存制度、不重算 */
  onClose(): void;
  /** 已确认并完成「落库制度 + 应用重算」，通知外层关闭 */
  onConfirmed(): void;
}

export function RestPolicyRecalcDialog({
  draft,
  oldPolicy,
  onClose,
  onConfirmed,
}: RestPolicyRecalcDialogProps): JSX.Element {
  const repos = useRepos();
  const projects = useProjectsStore((s) => s.projects);
  const stages = useProjectsStore((s) => s.stages);
  const tasks = useProjectsStore((s) => s.tasks);
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  const members = useMembersStore((s) => s.members);
  const operatorName = members.find((m) => m.id === currentMemberId)?.name ?? '当前用户';

  /** 工期模式：keep=工期不变（默认）；custom=调整工期（每阶段天数覆盖） */
  const [mode, setMode] = useState<'keep' | 'custom'>('keep');
  /** 每阶段时长覆盖（key=stageId，value=天数字符串；空=未填走原工期） */
  const [durations, setDurations] = useState<Record<string, string>>({});
  const [alignDue, setAlignDue] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  const [backing, setBacking] = useState(false);

  /** 工作日制项目（自然日制零影响，§4.0——计数与 plan 同口径） */
  const inputs = useMemo(
    () =>
      projects
        .filter((p) => p.scheduleBasis === ScheduleBasis.Workday)
        .map((p) => ({
          project: p,
          stages: stages.filter((s) => s.projectId === p.id),
          tasks: tasks.filter((t) => t.projectId === p.id),
        })),
    [projects, stages, tasks],
  );

  const newPolicy = useMemo(() => withCnHolidays(draft), [draft]);

  const overrides = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(durations)) {
      const n = parseDurationDays(v);
      if (n !== null) out[k] = n;
    }
    return out;
  }, [durations]);

  /** 预览即演算：模式/天数/对齐选项任一变化都重跑同一纯函数 */
  const plan = useMemo(
    () =>
      planRestPolicyRecalc({
        projects: inputs,
        oldPolicy,
        newPolicy,
        durationOverrides: mode === 'custom' ? overrides : undefined,
      }),
    [inputs, oldPolicy, newPolicy, mode, overrides],
  );

  const confirmDisabled = applying || !plan.hasChanges;

  const onBackup = async (): Promise<void> => {
    setBacking(true);
    try {
      const ok = await exportBackupToFile(repos);
      useProjectsStore
        .getState()
        .pushToast(ok ? 'success' : 'error', ok ? '备份包已保存' : '备份导出失败。');
    } finally {
      setBacking(false);
    }
  };

  const onConfirm = async (): Promise<void> => {
    if (confirmDisabled) return;
    setApplying(true);
    try {
      // 先落库制度再应用重算：写库失败时界面保持原制度，不出现「重算了但制度没存」
      await repos.settings.set('restPolicy', draft);
      useSettingsStore.getState().setRestPolicy(draft);

      const result = await applyRestPolicyRecalc(plan, {
        repos,
        operatorName,
        reason: restPolicyRecalcReason(oldPolicy, newPolicy),
        alignTaskDueDates: alignDue,
      });
      // store 镜像（铁律 11 的乐观更新位）
      const store = useProjectsStore.getState();
      for (const s of result.updatedStages) store.putStage(s);
      for (const p of result.updatedProjects) store.putProject(p);
      for (const t of result.updatedTasks) store.putTask(t);

      const projectNames = plan.projects
        .filter((p) => p.changedStageCount > 0 || p.plannedEndAtChanged)
        .map((p) => p.projectName);
      const summary =
        `已按新制度重算 ${result.updatedStages.length} 个阶段` +
        (result.updatedProjects.length > 0
          ? `（${result.updatedProjects.length} 个项目竣工日顺延）`
          : '') +
        (alignDue && result.updatedTasks.length > 0 ? `，${result.updatedTasks.length} 个任务到期日已对齐` : '') +
        (projectNames.length > 0 ? `：${projectNames.join('、')}` : '');
      useProjectsStore
        .getState()
        .pushToast(result.failed > 0 ? 'error' : 'success',
          result.failed > 0 ? `${summary}；${result.failed} 条写入失败，请重试` : summary);

      if (result.failed === 0) onConfirmed();
    } catch (err) {
      useProjectsStore
        .getState()
        .pushToast('error', err instanceof Error ? err.message : '重算失败，制度未保存。');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal open onClose={onClose} ariaLabel="切换休息制度后重算">
      <div className="glass-strong iridescent-border dialog-pop flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl shadow-soft">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-display-md text-ink">切换休息制度后重算</h2>
              <p className="mt-1 text-xs text-mist">
                {REST_POLICY_LABELS[oldPolicy.kind]} →{' '}
                <span className="text-ink">{REST_POLICY_LABELS[draft.kind]}</span>
                {draft.kind === RestPolicyKind.SingleOff &&
                  `（单休休息日 = 周${WEEKDAY_LABELS[draft.singleRestWeekday ?? 6]}）`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="取消重算"
              className="rounded-md p-1 text-mist transition-colors hover:bg-sand"
            >
              <X size={16} />
            </button>
          </div>

          {/* 影响计数（自然日制项目零影响，按 workday 口径报） */}
          <div
            className="mb-4 rounded-[12px] border border-amber/40 bg-amber-soft px-3.5 py-3 text-sm text-ink"
            data-testid="recalc-impact"
          >
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle size={15} className="text-amber" aria-hidden />
              将重算 {plan.affectedProjectCount} 个工作日制项目的 {plan.changedStageCount} 个阶段
              （已完成 {plan.frozenStageCount} 个冻结不动）
            </p>
            {plan.taskShiftCount > 0 && (
              <p className="mt-1 text-xs text-mist" data-testid="recalc-due-count">
                {plan.taskShiftCount} 个任务的到期日将落在阶段新区间之外（默认不跟随，可在下方选择对齐）。
              </p>
            )}
          </div>

          {/* 工期模式二选 */}
          <div className="mb-4 space-y-2" data-testid="recalc-mode">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-line px-3 py-2.5 text-sm transition-colors hover:bg-sand">
              <input
                type="radio"
                name="recalc-duration-mode"
                checked={mode === 'keep'}
                onChange={() => setMode('keep')}
                className="accent-pine"
                data-testid="recalc-mode-keep"
              />
              <span className="font-medium text-ink">工期不变（默认）</span>
              <span className="text-xs text-mist">各阶段工作日工期不变，起止按新制度链式平移</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-line px-3 py-2.5 text-sm transition-colors hover:bg-sand">
              <input
                type="radio"
                name="recalc-duration-mode"
                checked={mode === 'custom'}
                onChange={() => setMode('custom')}
                className="accent-pine"
                data-testid="recalc-mode-custom"
              />
              <span className="font-medium text-ink">调整工期</span>
              <span className="text-xs text-mist">逐阶段填写新的工作日天数（留空 = 原工期不变）</span>
            </label>
          </div>

          {/* 逐项目 before→after 对照表（可展开） */}
          <div className="mb-4 space-y-2" data-testid="recalc-projects">
            {plan.projects.map((pp) => {
              const open = expanded[pp.projectId] === true;
              return (
                <div key={pp.projectId} className="rounded-[10px] border border-line">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [pp.projectId]: !open }))
                    }
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-sand"
                  >
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="font-medium text-ink">{pp.projectName}</span>
                    <span className="text-xs text-mist">
                      {pp.changedStageCount} / {pp.stages.length} 个阶段将变化
                      {pp.frozenStageCount > 0 && ` · ${pp.frozenStageCount} 个已完成冻结`}
                      {pp.plannedEndAtChanged &&
                        ` · 竣工日 ${pp.oldPlannedEndAt} → ${pp.newPlannedEndAt}`}
                    </span>
                  </button>
                  {open && (
                    <div className="border-t border-line/60">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-mist">
                            <th className="px-3 py-1.5 font-normal">阶段</th>
                            <th className="px-3 py-1.5 font-normal">原起止</th>
                            <th className="px-3 py-1.5 font-normal">新起止</th>
                            {mode === 'custom' && (
                              <th className="px-3 py-1.5 font-normal">工期（工作日）</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {pp.stages.map((sp) => (
                            <tr
                              key={sp.stageId}
                              className="border-t border-line/40"
                              data-testid={`recalc-stage-${sp.stageId}`}
                            >
                              <td className="px-3 py-1.5">
                                <span className="text-ink">{sp.name}</span>
                                <span
                                  className={cn(
                                    'ml-1.5 text-[10px]',
                                    sp.freeze === 'full' ? 'text-clay' : 'text-mist',
                                  )}
                                >
                                  {STATUS_LABELS[sp.status]}
                                  {sp.freeze === 'full' && ' · 冻结'}
                                  {sp.freeze === 'start' && ' · 冻起点'}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 tabular-nums text-mist">
                                {sp.oldStartAt} ~ {sp.oldEndAt}
                              </td>
                              <td className="px-3 py-1.5 tabular-nums">
                                {sp.changed ? (
                                  <span className="text-pine-deep">
                                    {sp.newStartAt} ~ {sp.newEndAt}
                                  </span>
                                ) : (
                                  <span className="text-mist">不变</span>
                                )}
                              </td>
                              {mode === 'custom' && (
                                <td className="px-3 py-1.5">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={durations[sp.stageId] ?? ''}
                                    placeholder={`${sp.workdays} 天`}
                                    disabled={sp.freeze === 'full'}
                                    onChange={(e) =>
                                      setDurations((prev) => ({
                                        ...prev,
                                        [sp.stageId]: e.target.value,
                                      }))
                                    }
                                    data-testid={`recalc-duration-${sp.stageId}`}
                                    className="w-16 rounded-md border border-line bg-cream px-2 py-1 text-xs text-ink outline-none focus:border-pine disabled:opacity-40"
                                  />
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            {plan.projects.length === 0 && (
              <p className="rounded-[10px] border border-line px-3 py-2.5 text-xs text-mist">
                没有工作日制项目（自然日排程项目与休息制度无关，不受影响）。
              </p>
            )}
          </div>

          {/* dueDate 可选对齐（默认不勾） */}
          {plan.taskShiftCount > 0 && (
            <label className="mb-4 flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-line px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={alignDue}
                onChange={() => setAlignDue((v) => !v)}
                className="mt-0.5 accent-pine"
                data-testid="recalc-align-due"
              />
              <span>
                <span className="font-medium text-ink">
                  把到期日平移到阶段新区间内（保持阶段内相对偏移）
                </span>
                <span className="mt-0.5 block text-xs text-mist">
                  dueDate 是任务级承诺（可能对人承诺了具体日子），默认不跟随。
                </span>
              </span>
            </label>
          )}

          {/* 备份建议（不强制，措辞硬）+ 流水告知 */}
          <div className="mb-4 space-y-2 rounded-[12px] border border-line bg-cream/60 p-3">
            <p className="flex flex-wrap items-center gap-2 text-xs text-mist">
              <span className="font-medium text-clay">重算不可撤销（无 undo，恢复靠备份）</span>
              <button
                type="button"
                onClick={() => void onBackup()}
                disabled={backing}
                data-testid="recalc-backup"
                className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2.5 py-1 text-xs text-mist transition-colors hover:bg-sand hover:text-ink disabled:opacity-40"
              >
                <Save size={12} /> {backing ? '备份中…' : '先去备份'}
              </button>
            </p>
            <p className="text-xs text-mist">
              重算会写进阶段流水（每阶段一条改期记录），<b className="text-ink">打印延期台账时可见</b>
              ——「谁把哪个阶段从哪天改到哪天、为什么」可查。
            </p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
            >
              取消
            </button>
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={() => void onConfirm()}
              data-testid="recalc-confirm"
              className={cn(
                'rounded-md px-4 py-1.5 text-sm text-white transition-colors',
                confirmDisabled ? 'bg-pine-soft text-mist' : 'bg-pine hover:bg-pine-deep',
              )}
            >
              {applying ? '重算中…' : '确认重算并保存制度'}
            </button>
          </div>
          {!plan.hasChanges && (
            <p className="mt-2 text-right text-xs text-mist">没有需要重算的阶段（新口径下零变化）。</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
