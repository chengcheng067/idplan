/**
 * D 版 P3 · 阶段工作量构成（01 文档 §5 / 02 文档 §6/§7）。
 *
 * ── 堆叠条的口径纪律（02 §7 原文：展示真实值，不静默归一化）──
 * 条带总轨 = 100%；各阶段按 ratioPercent **真实值**占轨，占比合计 ≠ 100%
 * 时轨道尾部留出「未分配」缺口并出口径警告——绝不把各段拉长凑满 100%。
 * 段内数字是真实 ratioPercent，读稿人对着表能逐段核对。
 *
 * ── 占比不等于完成度 ──
 * 01 §5 明文要求「明确标注」。这条标注放在堆叠条正下方（不放进脚注
 * 小字——它是本页的防误读主声明），汇总表头再重复一次。
 *
 * ── 灰阶与信号色 ──
 * 段色走四阶灰循环（相邻段必不同灰度，灰度打印仍可分）；延期阶段段 =
 * 信号橙红（重点状态）+ ▲ 字形，双编码。
 */

import { StageStatus } from '../../../core/types/enums';
import type { PrintViewModel } from '../../model/print-view-model';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { STAGE_GLYPH, pct, stageStatusLabel } from './shared';

export function WorkloadCompositionPage({ vm }: { vm: PrintViewModel }): JSX.Element {
  const stages = vm.stages;
  const dense = stages.length > 12;
  const totalRatio = stages.reduce((sum, s) => sum + s.ratioPercent, 0);
  const gap = Math.max(0, 100 - totalRatio);
  const doneTasks = vm.tasks.filter((t) => t.status === 'done').length;

  return (
    <section className="de-board" data-density={dense ? 'compact' : undefined}>
      {stages.length === 0 ? (
        <EmptyPrintState kind="stages" />
      ) : (
        <>
          {/* 堆叠条：轨 = 100%，段 = 真实 ratioPercent，缺口 = 未分配 */}
          <div className="de-stack" role="img" aria-label={`阶段工作量占比堆叠条，合计 ${totalRatio}%`}>
            {stages.map((s, i) => {
              const delayed = s.status === StageStatus.Delayed;
              return (
                <div
                  key={s.id}
                  className="de-stack__seg"
                  data-gray={i % 4}
                  data-delayed={delayed || undefined}
                  style={{ width: `${s.ratioPercent}%` }}
                  title={`${String(s.orderIndex).padStart(2, '0')} ${s.name} · 占比 ${s.ratioPercent}%${delayed ? ' · 延期' : ''}`}
                >
                  {s.ratioPercent >= 6 && <span className="de-stack__seg-num de-num">{s.ratioPercent}</span>}
                </div>
              );
            })}
            {gap > 0 && (
              <div className="de-stack__gap" style={{ width: `${gap}%` }} title={`未分配 ${gap}%`}>
                {gap >= 6 && <span className="de-stack__gap-num de-num">{gap}</span>}
              </div>
            )}
          </div>
          {/* 段下标号：阶段序号 + 延期标记（不与段内数字重复） */}
          <div className="de-stack__ticks" aria-hidden>
            {stages.map((s) => (
              <span
                key={s.id}
                className="de-stack__tick de-num"
                data-delayed={s.status === StageStatus.Delayed || undefined}
                style={{ width: `${s.ratioPercent}%` }}
              >
                {String(s.orderIndex).padStart(2, '0')}
                {s.status === StageStatus.Delayed ? '▲' : ''}
              </span>
            ))}
            {gap > 0 && (
              <span className="de-stack__tick de-stack__tick--gap de-num" style={{ width: `${gap}%` }}>
                未分配
              </span>
            )}
          </div>

          {/* 防误读主声明（01 §5 明文：明确「占比不等于完成度」） */}
          <p className="de-claim">
            占比不等于完成度：占比（ratioPercent）是阶段工作量分配，完成度是已完成可见阶段数 ÷
            可见阶段总数（当前 {Math.round(vm.project.percent)}%）。两者口径独立，不可互推。
          </p>

          {totalRatio !== 100 && (
            <p className="de-warn" data-kind="ratio">
              <strong>口径警告</strong>：可见阶段占比合计为 {totalRatio}%，不等于 100%
              {gap > 0 ? `（未分配 ${gap}%）` : '（超出 100%，请核对阶段占比设置）'}。
              本页按真实值展示，未做归一化处理。
            </p>
          )}

          {/* 分期汇总 */}
          <table className="de-table de-ratio">
            <thead>
              <tr>
                <th className="de-ratio__stage">STAGE 阶段</th>
                <th className="de-ratio__date">DATES 计划日期</th>
                <th className="de-ratio__ratio">RATIO 占比</th>
                <th className="de-ratio__progress">TASKS 阶段内任务</th>
                <th>STATUS 状态</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => {
                const { done, total } = s.taskProgress;
                const delayed = s.status === StageStatus.Delayed;
                return (
                  <tr key={s.id} data-state={s.status} data-delayed={delayed || undefined}>
                    <td className="de-ratio__stage">
                      <span className="de-matrix__no de-num">{String(s.orderIndex).padStart(2, '0')}</span>
                      <span className="de-matrix__name" title={s.name}>
                        {s.name}
                      </span>
                    </td>
                    <td className="de-ratio__date de-num">
                      {s.startAt} — {s.endAt}
                    </td>
                    <td className="de-ratio__ratio de-num">{s.ratioPercent}%</td>
                    <td className="de-ratio__progress de-num">
                      {done}/{total}
                      {total > 0 ? ` · ${pct(done, total)}%` : ' · 无任务'}
                    </td>
                    <td>
                      <span className="de-state" data-tone={delayed ? 'signal' : s.status}>
                        <span className="de-state__glyph" aria-hidden>
                          {STAGE_GLYPH[s.status]}
                        </span>
                        {stageStatusLabel(s.status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr data-total={totalRatio !== 100 || undefined}>
                <td className="de-ratio__stage">合计（{stages.length} 个可见阶段）</td>
                <td className="de-ratio__date de-num">
                  {vm.project.plannedStartAt} — {vm.project.plannedEndAt}
                </td>
                <td className="de-ratio__ratio de-num">{totalRatio}%</td>
                <td className="de-ratio__progress de-num">
                  {doneTasks}/{vm.tasks.length}
                </td>
                <td>{totalRatio === 100 ? '占比合计 100%' : '占比合计 ≠ 100%'}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </section>
  );
}
