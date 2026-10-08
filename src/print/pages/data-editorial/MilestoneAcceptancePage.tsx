/**
 * D 版 P4 · 里程碑与验收（01 文档 §5 / 02 文档 §6）。
 *
 * ── M1/M2/M3 从哪来（不造数据模型，01 §2）──
 * 软件里没有「里程碑」实体，三个节点全部由真实数据确定性派生：
 *   · M1 启动 = 首个可见阶段的计划开始日（缺阶段回落项目计划开始日）；
 *   · M2 中期 = 项目计划周期中点日（(开始+结束)/2，按日计算）；
 *   · M3 完工 = 最晚可见阶段的计划结束日（缺阶段回落项目计划结束日）。
 * 验收状态由阶段四态 / 任务完成度推导，每个节点附可核对的验收清单
 * （■ 达成 / □ 未达成，字形 + 文字双编码，灰度可读）。
 *
 * ── 隐藏阶段说明（02 §3 第 3 步）──
 * 仅管理员可见，且**只做统计性说明**：可能存在隐藏阶段、本页统计基于可见
 * 阶段。不出现隐藏阶段的数量、名称或任何内容——VM 层就没把隐藏阶段放进
 * 来（适配器 visible 过滤），这层只是把口径写在纸面上。
 *
 * ── 时间轴为什么等分三格 ──
 * 按日期等比定位在短周期项目下会让三个节点叠在一起（M1/M2/M3 可能同在
 * 一个月内）。等分格 + 每格真实日期，既不虚假暗示比例，也不会重叠。
 */

import { StageStatus } from '../../../core/types/enums';
import type { PrintViewModel } from '../../model/print-view-model';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import { stageStatusLabel, stampOf } from './shared';

/** 里程碑视觉四档（与阶段四态同款字形编码） */
type MilestoneTone = 'done' | 'active' | 'delayed' | 'pending';

const TONE_GLYPH: Record<MilestoneTone, string> = {
  done: '●',
  active: '◐',
  delayed: '▲',
  pending: '□',
};

interface MilestoneCheck {
  ok: boolean;
  text: string;
}

interface Milestone {
  key: 'M1' | 'M2' | 'M3';
  name: string;
  /** 锚点日期（YYYY-MM-DD，真实数据派生） */
  date: string;
  tone: MilestoneTone;
  statusText: string;
  anchor: string;
  checks: MilestoneCheck[];
}

/** 计划周期中点日（按日取整；结束早于开始等坏数据回落开始日） */
function midpointDate(startIso: string, endIso: string): string {
  const ta = Date.parse(startIso + 'T00:00:00Z');
  const tb = Date.parse(endIso + 'T00:00:00Z');
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || tb < ta) return startIso;
  return new Date(Math.floor((ta + tb) / 2)).toISOString().slice(0, 10);
}

function toneOfStage(status: StageStatus | undefined): MilestoneTone {
  switch (status) {
    case StageStatus.Completed:
      return 'done';
    case StageStatus.InProgress:
      return 'active';
    case StageStatus.Delayed:
      return 'delayed';
    default:
      return 'pending';
  }
}

export function MilestoneAcceptancePage({ vm }: { vm: PrintViewModel }): JSX.Element {
  const stages = vm.stages;
  const todayIso = vm.project.todayIso;
  const doneStages = stages.filter((s) => s.status === StageStatus.Completed).length;
  const doneTasks = vm.tasks.filter((t) => t.status === 'done').length;
  const totalTasks = vm.tasks.length;

  const first = stages[0];
  const last = stages[stages.length - 1];
  const midIso = midpointDate(vm.project.plannedStartAt, vm.project.plannedEndAt);
  const midStage = stages.find((s) => s.startAt <= midIso && midIso <= s.endAt);

  const allStagesDone = stages.length > 0 && doneStages === stages.length;
  const anyDelayed = stages.some((s) => s.status === StageStatus.Delayed);

  const milestones: Milestone[] = [
    {
      key: 'M1',
      name: '启动',
      date: first?.startAt ?? vm.project.plannedStartAt,
      tone: toneOfStage(first?.status),
      statusText: first
        ? `${stageStatusLabel(first.status)}（首阶段「${first.name}」）`
        : '当前可见范围内无阶段',
      anchor: '锚点：首个可见阶段计划开始日',
      checks: [
        { ok: todayIso >= (first?.startAt ?? vm.project.plannedStartAt), text: '启动锚点日已到达' },
        { ok: first?.status === StageStatus.Completed, text: '首阶段已完成' },
        {
          ok: vm.project.percent > 0,
          text: `项目完成度 ${Math.round(vm.project.percent)}%（${doneStages}/${stages.length} 可见阶段）`,
        },
      ],
    },
    {
      key: 'M2',
      name: '中期',
      date: midIso,
      tone: midStage ? toneOfStage(midStage.status) : 'pending',
      statusText: midStage
        ? `${stageStatusLabel(midStage.status)}（中点日落入「${midStage.name}」）`
        : '计划中点日无可见阶段覆盖',
      anchor: '锚点：项目计划周期中点日',
      checks: [
        { ok: todayIso >= midIso, text: '计划中点日已到达' },
        { ok: midStage?.status === StageStatus.Completed, text: '中点日落入阶段已完成' },
        {
          ok: vm.project.percent >= 50,
          text: `项目完成度 ${Math.round(vm.project.percent)}%（中期参考线 50%）`,
        },
      ],
    },
    {
      key: 'M3',
      name: '完工',
      date: last?.endAt ?? vm.project.plannedEndAt,
      tone: allStagesDone ? 'done' : anyDelayed ? 'delayed' : doneStages > 0 ? 'active' : 'pending',
      statusText: allStagesDone
        ? '已验收（全部可见阶段已完成）'
        : anyDelayed
          ? '延期（存在延期阶段）'
          : `未完成（${doneStages}/${stages.length} 可见阶段）`,
      anchor: '锚点：最晚可见阶段计划结束日',
      checks: [
        {
          ok: todayIso >= (last?.endAt ?? vm.project.plannedEndAt),
          text: '计划完工日已到达',
        },
        { ok: allStagesDone, text: `全部可见阶段已完成（${doneStages}/${stages.length}）` },
        {
          ok: totalTasks > 0 && doneTasks === totalTasks,
          text: `全部可见任务已完成（${doneTasks}/${totalTasks}）`,
        },
      ],
    },
  ];

  return (
    <section className="de-board">
      {stages.length === 0 ? (
        <EmptyPrintState kind="stages" />
      ) : (
        <>
          {/* 时间轴：等分三格 + 硬边轴线；每格真实锚点日期 */}
          <div className="de-timeline">
            <div className="de-timeline__axis" aria-hidden />
            {milestones.map((m) => (
              <div key={m.key} className="de-ms" data-tone={m.tone}>
                <div className="de-ms__head">
                  <span className="de-ms__key">{m.key}</span>
                  <span className="de-ms__name">{m.name}</span>
                </div>
                <span className="de-ms__marker" aria-hidden>
                  {TONE_GLYPH[m.tone]}
                </span>
                <div className="de-ms__date de-num">{m.date}</div>
                <div className="de-ms__status">{m.statusText}</div>
                <ul className="de-check">
                  {m.checks.map((c) => (
                    <li key={c.text} data-ok={c.ok || undefined}>
                      <span className="de-check__glyph" aria-hidden>
                        {c.ok ? '■' : '□'}
                      </span>
                      {c.text}
                    </li>
                  ))}
                </ul>
                <p className="de-ms__anchor">{m.anchor}</p>
              </div>
            ))}
          </div>

          {/* 统计范围：全员可见的口径行；隐藏阶段说明仅管理员（02 §3 第 3 步） */}
          <p className="de-note">
            统计范围：当前账号可见阶段 {stages.length} 个；里程碑锚点取自阶段计划日期与项目计划周期，
            验收状态由阶段四态与任务完成度推导。
            {vm.viewerRole === 'admin' && (
              <>
                <strong>隐藏阶段说明（仅管理员）</strong>：本项目可能包含对普通成员不可见的阶段；
                本页统计仅基于可见阶段，不含隐藏阶段的任何内容。
              </>
            )}
          </p>
        </>
      )}

      {/* 人工签署：纸面治理动作，签署行留白 */}
      <div className="de-sign">
        <p className="de-sign__note">
          本页数据截至 {stampOf(vm.generatedAt)}；签署表示对上述里程碑与验收结果的确认。
        </p>
        <table className="de-sign__table">
          <thead>
            <tr>
              <th className="de-sign__role">ROLE 角色</th>
              <th>SIGNATURE 签署</th>
              <th className="de-sign__date">DATE 日期</th>
            </tr>
          </thead>
          <tbody>
            {(['编制', '审核', '批准'] as const).map((role) => (
              <tr key={role}>
                <td className="de-sign__role">{role}</td>
                <td className="de-sign__line" />
                <td className="de-sign__line de-sign__date" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
