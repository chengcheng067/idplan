/**
 * H 版 P3 · 写回提案公示（01 文档 §7 / 02 文档 §6）。
 *
 * ── 公示结构（全部静态治理信息 + 真实计数）──
 *   ① 五态带：Draft / Proposed / Applied / Rejected / Conflict（计数来自 VM）；
 *   ② 人工门控流程：Proposed →（人工批准）→ Applied / Rejected；
 *      Conflict →（人工处理）→ 重新提案。盒式流程图（打印友好箭头）；
 *   ③ 白名单四项 + 「其余字段只读」（WRITEBACK_WRITABLE_FIELDS 唯一出处）；
 *   ④ confidence 仅展示、旁标「仅供参考」（01 §3.3）；
 *   ⑤ 提案清单（有则列：字段 / 状态 / confidence / 决策人；无则明示暂无）。
 *
 * ── 空态口径 ──
 * 无提案但确有执行 ⇒ 本页照常公示（五态全零 + 「当前暂无写回提案」）——
 * 公示的是治理规则，不是编造记录；完全无 Agent 数据时文档层走整版空态。
 */

import { formatTaskNo } from '../../../core/lib/task-no';
import { WritebackProposalStatus } from '../../../core/types/agent-execution';
import type { PrintViewModel } from '../../model/print-view-model';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import {
  CONFIDENCE_DISPLAY_NOTE,
  formatConfidence,
  stampOf,
  WRITEBACK_READONLY_NOTE,
  WRITEBACK_STATUS_GLYPH,
  WRITEBACK_STATUS_LABELS,
  WRITEBACK_STATUS_TONE,
  WRITEBACK_WHITELIST_ITEMS,
} from './shared';

export function WritebackProposalPage({ vm }: { vm: PrintViewModel }): JSX.Element {
  const counts = new Map<WritebackProposalStatus, number>();
  for (const p of vm.proposals) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);

  return (
    <div className="ap-writeback">
      {/* ① 五态带（大字号状态分组；Proposed / Conflict 橙色 = 治理焦点） */}
      <div className="ap-wb-states">
        {(Object.keys(WRITEBACK_STATUS_LABELS) as WritebackProposalStatus[]).map((status) => (
          <div
            key={status}
            className="ap-wb-state"
            data-status={status}
            data-tone={WRITEBACK_STATUS_TONE[status]}
            data-testid={`ap-wb-state-${status}`}
          >
            <span className="ap-wb-state__glyph" aria-hidden>
              {WRITEBACK_STATUS_GLYPH[status]}
            </span>
            <span className="ap-wb-state__count">{counts.get(status) ?? 0}</span>
            <span className="ap-wb-state__name">{WRITEBACK_STATUS_LABELS[status]}</span>
            <span className="ap-wb-state__key">{status}</span>
          </div>
        ))}
      </div>

      {/* ② 人工门控流程（盒式流程图；打印友好：实线盒 + 粗箭头 + 文字标注） */}
      <section className="ap-wb-flow">
        <h3 className="ap-wb-flow__title">人工门控流程</h3>
        <div className="ap-wb-flow__row">
          <FlowBox label="Proposed" sub="待批准" tone="gate" />
          <FlowArrow label="人工批准" />
          <FlowBranch>
            <FlowBox label="Applied" sub="已落库" tone="term" />
            <FlowBox label="Rejected" sub="已拒绝" tone="term" />
          </FlowBranch>
        </div>
        <div className="ap-wb-flow__row">
          <FlowBox label="Conflict" sub="冲突" tone="gate" />
          <FlowArrow label="人工处理" />
          <FlowBox label="重新提案" sub="回到 Proposed" tone="gate" />
        </div>
        <p className="ap-wb-flow__note">
          Agent 不自行落库：每一笔写回都是字段级 before/after 提案，人工在门控点批准或拒绝；
          冲突态必须人工处理后才可再次提案。
        </p>
      </section>

      {/* ③ 白名单 + 只读注（与 P1 同一出处；公示稿两页都看得到） */}
      <section className="ap-wb-whitelist">
        <h3 className="ap-wb-whitelist__title">写回白名单（仅四项）</h3>
        <ol className="ap-wb-whitelist__list">
          {WRITEBACK_WHITELIST_ITEMS.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ol>
        <p className="ap-wb-whitelist__readonly">
          <strong>{WRITEBACK_READONLY_NOTE}</strong>：白名单外字段任何执行都无权改写。
          confidence 仅展示（{CONFIDENCE_DISPLAY_NOTE}），不触发任何自动决策。
        </p>
      </section>

      {/* ⑤ 提案清单（无则明示；02 §8 不用示例数据填版） */}
      <section className="ap-wb-list">
        <h3 className="ap-wb-list__title">提案清单（{vm.proposals.length} 条）</h3>
        {vm.proposals.length === 0 ? (
          <EmptyPrintState kind="agent" text="当前暂无写回提案" />
        ) : (
          <table className="ap-wb-table">
            <thead>
              <tr>
                <th>关联任务</th>
                <th>字段</th>
                <th>状态</th>
                <th>confidence</th>
                <th>决策人 / 时间</th>
              </tr>
            </thead>
            <tbody>
              {vm.proposals.map((p) => {
                const task = vm.tasks.find((t) => t.id === p.taskId) ?? null;
                const fields = p.operations.map((op) => op.field).join('、') || '—';
                return (
                  <tr key={p.id} data-status={p.status}>
                    <td className="ap-wb-table__task">
                      {task ? formatTaskNo(task.taskNo) : '—'}
                    </td>
                    <td className="ap-wb-table__fields">{fields}</td>
                    <td>
                      <span className="ap-wb-table__status" data-tone={WRITEBACK_STATUS_TONE[p.status]}>
                        <span aria-hidden>{WRITEBACK_STATUS_GLYPH[p.status]}</span>
                        {WRITEBACK_STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td className="ap-wb-table__conf">
                      {formatConfidence(p.confidence)}
                      {p.confidence !== null && <span className="ap-wb-table__conf-note">（{CONFIDENCE_DISPLAY_NOTE}）</span>}
                    </td>
                    <td className="ap-wb-table__decided">
                      {p.decidedBy ?? '—'}
                      {p.decidedAt ? ` · ${stampOf(p.decidedAt)}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** 流程盒（实线硬边；tone: gate=橙 / term=黑） */
function FlowBox({
  label,
  sub,
  tone,
}: {
  label: string;
  sub: string;
  tone: 'gate' | 'term' | 'run' | 'sys';
}): JSX.Element {
  return (
    <span className="ap-flow-box" data-tone={tone}>
      <span className="ap-flow-box__label">{label}</span>
      <span className="ap-flow-box__sub">{sub}</span>
    </span>
  );
}

/** 流程箭头（粗箭头 + 动作标注；打印友好不依赖颜色） */
function FlowArrow({ label }: { label: string }): JSX.Element {
  return (
    <span className="ap-flow-arrow">
      <span className="ap-flow-arrow__line" aria-hidden />
      <span className="ap-flow-arrow__label">{label}</span>
    </span>
  );
}

/** 分叉组（批准 → 落库/拒绝 两个出口，并排） */
function FlowBranch({ children }: { children: React.ReactNode }): JSX.Element {
  return <span className="ap-flow-branch">{children}</span>;
}
