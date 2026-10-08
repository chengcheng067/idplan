/**
 * D 版 P1 · 阶段进度矩阵（01 文档 §5 / 02 文档 §6）。
 *
 * ── 矩阵读法 ──
 * 行 = 阶段（orderIndex 序）；列 = 状态 / 计划日期 / 阶段内任务完成度 /
 * ratioPercent / 负责人。阶段内任务完成度**直接取 VM 的 taskProgress**
 * （适配器已复用 computeStageTaskProgress，02 §4 纪律：不重算）。
 *
 * ── 橙红纪律（01 §5：橙红仅用于重点状态）──
 * 信号色只出现在：延期阶段的状态标记与进度条、逾期/阻塞任务计数、
 * 「延期阶段」统计格。其余一律灰阶 + 近黑——灰度打印下信号色变中灰，
 * 所以每个信号色元素都同时带字形（▲）或文字，不靠色相单独表意。
 *
 * ── 占比口径 ──
 * ratioPercent 是工作量占比、不是完成度（01 §3.1）；页脚注释把这条口径
 * 与完成度算式并排写出，避免读稿人把 11% 当成「完成了 11%」。
 */

import { StageStatus } from '../../../core/types/enums';
import type { PrintStageVM, PrintTaskVM, PrintViewModel } from '../../model/print-view-model';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { STAGE_GLYPH, pct, stageStatusLabel } from './shared';

export function ProgressMatrixPage({ vm }: { vm: PrintViewModel }): JSX.Element {
  const stages = vm.stages;
  const tasks = vm.tasks;
  const dense = stages.length > 15;

  const doneStages = stages.filter((s) => s.status === StageStatus.Completed).length;
  const delayedStages = stages.filter((s) => s.status === StageStatus.Delayed);
  const doneTasks = tasks.filter((t) => t.status === 'done').length;
  const overdueTasks = tasks.filter((t) => t.overdue).length;
  const blockedTasks = tasks.filter((t) => t.status === 'blocked').length;

  return (
    <section className="de-board" data-density={dense ? 'compact' : undefined}>
      {/* 统计带：四格硬边矩形，数字优先（Data Editorial 的数据图形气质） */}
      <div className="de-stats">
        <div className="de-stat">
          <span className="de-stat__value de-num">{Math.round(vm.project.percent)}%</span>
          <span className="de-stat__caption">
            项目完成度 · 已完成可见阶段 {doneStages}/{stages.length}
          </span>
        </div>
        <div className="de-stat">
          <span className="de-stat__value de-num">{stages.length}</span>
          <span className="de-stat__caption">可见阶段 · 任务 {tasks.length} 条</span>
        </div>
        <div className="de-stat">
          <span className="de-stat__value de-num">
            {doneTasks}/{tasks.length}
          </span>
          <span className="de-stat__caption">
            任务完成 {tasks.length === 0 ? 0 : pct(doneTasks, tasks.length)}%
            {blockedTasks > 0 ? ` · 阻塞 ${blockedTasks}` : ''}
          </span>
        </div>
        <div className="de-stat" data-signal={delayedStages.length > 0 || overdueTasks > 0 || undefined}>
          <span className="de-stat__value de-num">
            {delayedStages.length + overdueTasks}
          </span>
          <span className="de-stat__caption">
            重点状态 · 延期阶段 {delayedStages.length} · 逾期任务 {overdueTasks}
          </span>
        </div>
      </div>

      {stages.length === 0 ? (
        <EmptyPrintState kind="stages" />
      ) : (
        <table className="de-table de-matrix">
          <thead>
            <tr>
              <th className="de-matrix__stage">STAGE 阶段</th>
              <th>STATUS 状态</th>
              <th className="de-matrix__date">DATES 计划日期</th>
              <th className="de-matrix__progress">TASK PROGRESS 阶段内任务完成度</th>
              <th className="de-matrix__ratio">RATIO 占比</th>
              <th>OWNER 负责人</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <MatrixRow key={s.id} stage={s} tasks={tasks} />
            ))}
          </tbody>
        </table>
      )}

      <p className="de-note">
        口径：完成度 = 已完成可见阶段数 ÷ 可见阶段总数（不按占比加权）；占比 = 阶段工作量分配
        （ratioPercent），<strong>占比不等于完成度</strong>；阶段内任务完成度 = 该阶段已完成任务数
        ÷ 任务总数。隐藏阶段不进入本表，也不参与任何统计。
      </p>
    </section>
  );
}

function MatrixRow({ stage, tasks }: { stage: PrintStageVM; tasks: readonly PrintTaskVM[] }): JSX.Element {
  const { done, total } = stage.taskProgress;
  const percent = pct(done, total);
  const delayed = stage.status === StageStatus.Delayed;
  const stageTasks = tasks.filter((t) => t.stageId === stage.id);
  const blocked = stageTasks.filter((t) => t.status === 'blocked').length;
  const overdue = stageTasks.filter((t) => t.overdue).length;
  const flags = [
    blocked > 0 ? `阻塞 ${blocked}` : '',
    overdue > 0 ? `逾期 ${overdue}` : '',
  ].filter(Boolean);

  return (
    <tr data-state={stage.status} data-delayed={delayed || undefined}>
      <td className="de-matrix__stage">
        <span className="de-matrix__no de-num">{String(stage.orderIndex).padStart(2, '0')}</span>
        <span className="de-matrix__name" title={stage.name}>
          {stage.name}
        </span>
      </td>
      <td>
        <span className="de-state" data-tone={delayed ? 'signal' : stage.status}>
          <span className="de-state__glyph" aria-hidden>
            {STAGE_GLYPH[stage.status]}
          </span>
          {stageStatusLabel(stage.status)}
        </span>
      </td>
      <td className="de-matrix__date de-num">
        {stage.startAt} — {stage.endAt}
      </td>
      <td className="de-matrix__progress">
        <span className="de-bar" role="img" aria-label={`任务完成度 ${percent}%`}>
          <span className="de-bar__track">
            <span className="de-bar__fill" data-tone={delayed ? 'signal' : 'ink'} style={{ width: `${percent}%` }} />
          </span>
          <span className="de-bar__num de-num">
            {done}/{total} · {percent}%
          </span>
        </span>
        {flags.length > 0 && <span className="de-matrix__flags">{flags.join(' · ')}</span>}
      </td>
      <td className="de-matrix__ratio de-num">{stage.ratioPercent}%</td>
      <td className="de-matrix__owner">{stage.ownerName ?? '—'}</td>
    </tr>
  );
}
