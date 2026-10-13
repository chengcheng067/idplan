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
 * ★ 幂等（F1-④-c）：确认时把预览的那份 plan **冻结成已批准快照**，重试复用同一份；
 *   落库前再与**当前库值**比对，已达成的条目跳过（不写、不留痕）。
 *   两件缺一不可 —— 机理与取舍见 `applyRestPolicyRecalc` 上方注释。
 */

import { useMemo, useState } from 'react';

import { AlertTriangle, ChevronDown, ChevronRight, Save, X } from 'lucide-react';

import { RestPolicyKind, ScheduleBasis, StageStatus } from '../../core/types/enums';
import type { Project, RestPolicyConfig, Stage, Task } from '../../core/types/entities';
import { StageService } from '../../core/services/stage.service';
import { useHumanProjects } from '../../core/project/visibility';
import { restPolicyLabel, stageStatusLabel, useLang, weekdayFullLabel } from '../../i18n';
import { withCnHolidays } from '../../core/holidays/policy';
import {
  planRestPolicyRecalc,
  parseDurationDays,
  restPolicyRecalcReason,
  type RecalcPlan,
} from '../../lib/restPolicyRecalc';
import { toIsoDate } from '../../lib/date';
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
  /** 逐条写入失败的条数（既有语义：逐条计数不中断） */
  failed: number;
  /**
   * 幂等跳过的条数（F1-④-c）：计划目标与**当前库值**已一致 ⇒ 不写、不留痕。
   * 重试时「上一轮已写成功的那些」走这里，所以它>0 是**正常**的，不是失败。
   */
  skipped: number;
}

/**
 * 应用一份 RecalcPlan（预览即演算：弹窗把**同一份 plan** 传进来）。
 * 逐阶段走 StageService.reschedule（留痕 + reason 闸门）；失败逐条计数不中断。
 *
 * ── ★ 幂等性（F1-④-c 验收性质，team-lead 拍板）──
 * **重试必须幂等**：同一份夹具，「第一次部分失败 → 修好 → 重试」与「第一次就全成功」
 * 两条路径，结束时的最终库状态与流水**逐字段全等**。
 *
 * 为此需要**两件一起做**（缺一不可）：
 *   ① 弹窗侧：确认时把当时预览的那份 plan **冻结成已批准快照**，重试复用同一份，
 *      不从半迁移的当前状态重算（见下方 `approvedPlan`）；
 *   ② 本函数侧：落库前与**当前库值**比一次，已一致就跳过（下方 `alreadyApplied`）。
 *   只做①不做②：回放同一份 plan 会把上一轮已写对的阶段**再写一遍**、再 append 一条
 *   Rescheduled 流水（日期对了，重复留痕仍在）。
 *   只做②不做①：plan 本身就已经漂了（见下），比的是「按漂移后的计划」算出的目标。
 *
 * ── 为什么「靠 `!sp.changed` 拦住重试」不成立（误判留痕，下一个人别再踩）──
 * 直觉是：上一轮已成功改期的阶段，其当前日期已等于目标 ⇒ `planStageShift` 应判
 * `changed === false` ⇒ 被 `continue` 跳过。**实测三种夹具形状全都不成立**：
 *   · 链游标 `prev.oldEndAt` 取的是**当前库值**（restPolicyRecalc.ts:285 的 `oldEndAt`
 *     来自 `stage.endAt`）。部分失败时前一个阶段停在旧 end，而它后面那个已迁到新日期的
 *     阶段，其 `oldStartAt` 落到了旧 end 之前 ⇒ `chainSteps` 在 restPolicyRecalc.ts:153
 *     塌成 1 步 ⇒ 该阶段 newStart 重算后与当前相同、**但 newEnd 不同** ⇒ `changed === true`
 *     ⇒ 拦不住；
 *   · 更根本的是**工期被重新计量**：`workdays` 恒按 `countWorkdays(当前起止, 旧制度)`
 *     现算（restPolicyRecalc.ts:236）。已迁到新制度日期的阶段再按**旧制度**去数，工作日
 *     天数会变（实测 3 → 2）⇒ 每重试一次工期就少一截、日期持续漂移、**不收敛**。
 *   复现见 tests/rest-policy-recalc-dialog.spec.tsx 的 F1-④-c（幂等性判定）与 F1-④-b。
 *
 * ── ★ 取舍：本闸门会让 (a)「改了期、没流水」成为**永久**（必须显式知情）──
 * 若某阶段上一次是「阶段写成功、日志写失败」，则它的当前值已等于目标 ⇒ 重试时**被跳过**
 * ⇒ 那条缺失的 Rescheduled 流水**再也不会被补上**。
 *   · 改之前：重试会重跑 reschedule ⇒ 缺的流水会被补上（代价是漂移 + 重复留痕）；
 *   · 改之后：不漂移、不重复，但**缺流水成为永久**。
 * team-lead 裁决**选后者**：日期正确 > 台账完整 —— 日期错会沿链式平移一路传染到后续阶段，
 * 而缺一条流水是单点、且可从 stage 的 revision/updatedAt 反查。
 * 未顺手「检测并补写缺失流水」的理由（评估过，见交付报告）：补写只能拿到
 * old/new 起止（计划里有），但 **`fromStatus` 与 `operatorName` 拿不回来**（原操作人未必
 * 是当前用户；stage 写成功时 status 可能已联动成 delayed，前态不可还原）⇒ 只能伪造审计
 * 记录，比缺记录更坏。(a) 的正解是 v1.1 的 `recalcJob`（在**写之前**就记下意图与操作人）。
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
  let skipped = 0;

  /** 与当前库值比：目标已达成就别写（幂等闸门，见上方注释） */
  const alreadyApplied = (current: string | null | undefined, target: string): boolean =>
    current != null && (toIsoDate(current) ?? current) === target;

  for (const pp of plan.projects) {
    for (const sp of pp.stages) {
      if (!sp.changed) continue;
      try {
        const current = await deps.repos.stages.get(sp.stageId);
        if (
          current &&
          alreadyApplied(current.startAt, sp.newStartAt) &&
          alreadyApplied(current.endAt, sp.newEndAt)
        ) {
          skipped += 1;
          continue;
        }
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
        const current = await deps.repos.projects.get(pp.projectId);
        if (current && alreadyApplied(current.plannedEndAt, pp.newPlannedEndAt)) {
          skipped += 1;
        } else {
          updatedProjects.push(
            await deps.repos.projects.update(pp.projectId, { plannedEndAt: pp.newPlannedEndAt }),
          );
        }
      } catch {
        failed += 1;
      }
    }
    if (deps.alignTaskDueDates) {
      for (const ts of pp.taskShifts) {
        try {
          const current = await deps.repos.tasks.get(ts.taskId);
          if (current && alreadyApplied(current.dueDate, ts.newDueDate)) {
            skipped += 1;
          } else {
            updatedTasks.push(await deps.repos.tasks.update(ts.taskId, { dueDate: ts.newDueDate }));
          }
        } catch {
          failed += 1;
        }
      }
    }
  }

  return { updatedStages, updatedProjects, updatedTasks, failed, skipped };
}

/* ------------------------------ 弹窗 ------------------------------ */

/*
 * ★ 2026-10-13 中英切换：这里原本有两张本地表——`WEEKDAY_LABELS`（一~日）与
 * `STATUS_LABELS`（阶段四态）。两者都已搬进 `src/i18n/messages/{zh,en}.ts`
 * （键 `weekday.full.*` / `stageStatus.*`），本文件在渲染期用
 * `weekdayFullLabel(idx)` / `stageStatusLabel(status)` 取词。
 * ⇒ 顺序号 0..6 = 周一..周日（与全仓口径一致），标签表不再有第二份。
 */

export interface RestPolicyRecalcDialogProps {
  /** 新制度草稿（用户已选、尚未落库） */
  draft: RestPolicyConfig;
  /**
   * 旧制度（生效口径：store.effectiveRestPolicy，已合并节假日）。
   * ★ **只在弹窗打开时读一次**（见下方 `oldPolicyAtOpen`）——外层传进来的值会随
   *   store 变化，本弹窗不接受「跟着变」的旧制度（审计 F1-④）。
   */
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
  // 订阅语言变化：制度名与阶段态文案在渲染期取（见 i18n 的 useLang 纪律）
  useLang();
  /**
   * ★ 旧制度快照（审计 F1-④）：**挂载时取一次**，此后不再跟随 store 变化。
   *
   * 缺陷原文：这里直接用 props.oldPolicy，而外层传的是 `savedEffective`
   * （每次渲染从 `useSettingsStore` 现取）。而 `onConfirm` 的第一步就是
   * `repos.settings.set('restPolicy', draft)` + `setRestPolicy(draft)` ——
   * **弹窗自己把 oldPolicy 改成了 newPolicy**，于是：
   *   · 重渲染后 `plan = planRestPolicyRecalc({oldPolicy: new, newPolicy: new})`
   *     ⇒ `hasChanges === false` ⇒ `confirmDisabled` 恒为 true；
   *   · 而部分写入失败（`result.failed > 0`）时弹窗**故意不关**
   *     （否则用户看不到「N 条写入失败，请重试」）—— 结果就是：提示让他重试，
   *     重试按钮却永远灰着，且预览表整片变成「无变化」。半迁移状态彻底卡死，
   *     用户只能重开设置重选一次制度（那时 oldPolicy 已是新制度，
   *     真正的旧→新 diff 再也算不出来，剩余阶段永久留在旧口径上）。
   *
   * 快照化后：确认 → 部分失败 → 预览与按钮都还在（plan 仍算出同样的变化）
   * ⇒ 「重试」这句话是真的能兑现的。快照同时保证预览表、reason 文案里的
   * 「旧制度」在确认前后逐字一致（不然用户会看到 before 列自己变了）。
   */
  const [oldPolicyAtOpen] = useState<RestPolicyConfig>(() => oldPolicy);
  // projects 走 visibility 漏斗（隔离纪律：store.projects 原始读只允许在
  // visibility.ts——公司级制度作用于人类侧项目）；stages/tasks 无 kind 字段，
  // 直读是设计认可口径（isolation-guard spec 注释明示）。
  const projects = useHumanProjects();
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
  const livePlan = useMemo(
    () =>
      planRestPolicyRecalc({
        projects: inputs,
        oldPolicy: oldPolicyAtOpen,
        newPolicy,
        durationOverrides: mode === 'custom' ? overrides : undefined,
      }),
    [inputs, oldPolicyAtOpen, newPolicy, mode, overrides],
  );

  /**
   * ★ 已批准 plan 快照（F1-④-c-①）：**确认的那一刻把预览的那份 plan 冻结下来**，
   *   此后本弹窗渲染与重试应用都用它，不再从 store 现算。
   *
   * 为什么必须有它：`livePlan` 的输入是 store 里的**当前库值**（`inputs` ← 各 store），
   * 而确认的第一步就把阶段改了 ⇒ 重渲染出来的 `livePlan` 已经是「基于半迁移状态」的
   * 另一份演算结果 —— 用户批准 A、重试却应用 B，且 B 还会漂移（机理见
   * `applyRestPolicyRecalc` 上方注释）。快照化后「预览即演算、确认后应用同一份 plan」
   * 这句话才真的成立到**重试**这一步。
   *
   * 什么时候解冻：用户**主动改**影响演算的选项（工期模式 / 每阶段天数）时 —— 那是他
   * 在重新出方案，理应在下次确认时重新取快照（见下方 `reviseInputs`）。
   * 注意 `alignDue` 不参与 `livePlan` 演算，故不需要解冻。
   */
  const [approvedPlan, setApprovedPlan] = useState<RecalcPlan | null>(null);
  /** 弹窗当前展示、也是下次确认要应用的那份（已冻结则恒为冻结的那份） */
  const plan = approvedPlan ?? livePlan;
  /** 用户改演算输入 ⇒ 解冻（下次确认重新取快照） */
  const reviseInputs = (fn: () => void): void => {
    setApprovedPlan(null);
    fn();
  };

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

  /*
    ════════════════ ★ 残局留痕：本次重算**不是原子的** ════════════════

    1) 制度先落库（:380-381），逐条重算各自独立事务；且单条 `reschedule` 自身也是两次写
       （stage → log，见 `core/services/stage.service.ts:64-83`）。
    2) ⇒ 三种残局：
       (a) 改了期、没流水 —— 下面那句「重算会写进阶段流水…打印延期台账时可见」的承诺会落空
           （stage 已落、log 未落时 reschedule 抛错，被计成「一条写入失败」，实际日期已改）；
           ★ 幂等闸门（F1-④-c，见 `applyRestPolicyRecalc` 上方注释）让这一条**成为永久**：
             这类阶段重试时当前值已等于目标 ⇒ 被跳过 ⇒ 缺失的流水再也不会被补上。
             这是知情取舍（team-lead 裁决：日期正确 > 台账完整），**未修，留 v1.1**；
       (b) 部分阶段停在旧口径（本弹窗有失败时故意不关，让用户重试，但用户在关掉弹窗 / 重启
           应用后就没有第二次机会了）—— **未修，留 v1.1**；
       (c) ~~重试本身会改坏已经写对的阶段~~ —— **已修（F1-④-c，随 v1.0 进）**：
           实测原缺陷：S2 写失败、S3 成功后重试，S3 被二次改期、留痕 2 条，且落库值从
           用户批准的 09-24~09-26 漂成 09-24~09-25。修法 = 上方 `approvedPlan` 快照
           （①）+ `applyRestPolicyRecalc` 的幂等闸门（②），验收性质是**重试幂等**
           （路径 A「部分失败→重试」与路径 B「一次全成功」逐字段全等），
           判定用例见 `tests/rest-policy-recalc-dialog.spec.tsx` 的 F1-④-c。
           机理留痕（「看着像能拦、其实拦不住」，下一个人别再踩）：详见
           `applyRestPolicyRecalc` 上方「为什么靠 `!sp.changed` 拦住重试不成立」一段。
    3) 残局在**弹窗关闭 / 应用重启后不可发现、不可续做**：`RestPolicyDialog.tsx:99` 的 `draft`
       初值取自 `saved`（此时已是新制度）、`:233` 的 `sameWorkdayPolicy(saved, draft)` 为真
       ⇒ 下次点「保存」直接落库、**永不触发重算**，剩余阶段永久停在旧口径，界面上无任何提示。

    ★ v1.1 设计已定（(a)+(b) 两项；C 方案「整批一个事务」已裁决不做）：
        加一条 `recalcJob` 记录（fromPolicy/toPolicy + 待重算 id 列表）**在写之前**落库、
        逐条成功即划掉、全部完成即删；bootstrap 检测到残留 job 就在设置页挂常驻
        「继续重算」入口，同时可据它补回 (a) 缺失的流水（job 里预先记下了 operatorName，
        这是「事后补写」做不到的那部分——见 `applyRestPolicyRecalc` 上方对取舍的说明）。
        复用现有逐条写口，不动 `StageService`，且能扛住崩溃（不只是配额错误）。
  */
  const onConfirm = async (): Promise<void> => {
    if (confirmDisabled) return;
    /**
     * ★ 冻结本次要应用的那份 plan（F1-④-c-①）：首次确认 = 用户眼前预览的那份；
     *   之后的重试 = 同一份（`plan` 已指向 `approvedPlan`）。
     * 必须在这里冻结，否则重试会拿「基于半迁移状态重算」的另一份结果去应用 ⇒ 漂移。
     */
    const applying = plan;
    setApprovedPlan(applying);
    setApplying(true);
    try {
      // 先落库制度再应用重算：写库失败时界面保持原制度，不出现「重算了但制度没存」
      await repos.settings.set('restPolicy', draft);
      useSettingsStore.getState().setRestPolicy(draft);

      const result = await applyRestPolicyRecalc(applying, {
        repos,
        operatorName,
        reason: restPolicyRecalcReason(oldPolicyAtOpen, newPolicy),
        alignTaskDueDates: alignDue,
      });
      // store 镜像（铁律 11 的乐观更新位）
      const store = useProjectsStore.getState();
      for (const s of result.updatedStages) store.putStage(s);
      for (const p of result.updatedProjects) store.putProject(p);
      for (const t of result.updatedTasks) store.putTask(t);

      const projectNames = applying.projects
        .filter((p) => p.changedStageCount > 0 || p.plannedEndAtChanged)
        .map((p) => p.projectName);
      // `skipped` 不计进「已重算」条数：那是上一轮就写好的，重复计数等于虚报
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
                {restPolicyLabel(oldPolicyAtOpen.kind)} →{' '}
                <span className="text-ink">{restPolicyLabel(draft.kind)}</span>
                {draft.kind === RestPolicyKind.SingleOff &&
                  `（单休休息日 = ${weekdayFullLabel(draft.singleRestWeekday ?? 6)}）`}
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
                onChange={() => reviseInputs(() => setMode('keep'))}
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
                onChange={() => reviseInputs(() => setMode('custom'))}
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
                                  {stageStatusLabel(sp.status)}
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
                                      reviseInputs(() =>
                                        setDurations((prev) => ({
                                          ...prev,
                                          [sp.stageId]: e.target.value,
                                        })),
                                      )
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
              {/* 这句承诺在「stage 落库成功但 log 写失败」时会落空；本次重算不是原子的，
                  残局与 v1.1 设计见上方 onConfirm 前的「残局留痕」注释块。 */}
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
