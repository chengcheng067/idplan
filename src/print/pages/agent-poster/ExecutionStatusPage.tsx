/**
 * H 版 P2 · 执行状态全览（01 文档 §7 / 02 文档 §6）。
 *
 * ── 四组流程（01 §7 P2 明文）──
 * 十态按四组组织：准备 → 执行 → 人工门控 → 终局（shared.ts 的
 * EXECUTION_STATUS_GROUPS）。双栏排布，**中轴只贯穿双栏容器**
 * （::before 伪元素，inset-block:0；禁绝对定位贯穿整页——02 §6），
 * 轴不穿过下方说明文字（说明在容器外）。
 *
 * ── running 主焦点 / 人工门控标题不压卡 ──
 * running 卡 = 全页唯一实心黑卡（当前主状态）；「人工门控」组头用橙色大字号，
 * 但组头与状态卡之间保留固定间距（正常流布局 + spec 几何断言：
 * 组头底边 ≤ 首卡顶边，**不压住**）。
 *
 * ── 计数口径 ──
 * 每态计数 = VM 里该态执行条数（真实投影）；全零（无执行）时本页走
 * 空态（文档层决定），不用模拟记录填版（02 §8）。
 */

import type { ExecutionStatus } from '../../../core/types/agent-execution';
import type { PrintViewModel } from '../../model/print-view-model';
import {
  EXECUTION_STATUS_GLYPH,
  EXECUTION_STATUS_GROUPS,
  EXECUTION_STATUS_LABELS,
} from './shared';

export function ExecutionStatusPage({ vm }: { vm: PrintViewModel }): JSX.Element {
  const counts = new Map<ExecutionStatus, number>();
  for (const e of vm.executions) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
  const total = vm.executions.length;

  return (
    <div className="ap-status">
      {/* 摘要带：总数 + 主焦点态（大字号） */}
      <div className="ap-status__summary">
        <span className="ap-status__total">{String(total).padStart(2, '0')}</span>
        <span className="ap-status__total-label">条执行记录 · 十态四组流程</span>
      </div>

      {/* 双栏 + 局部中轴（轴作为本容器的伪元素，只贯穿栏区） */}
      <div className="ap-status__cols" data-testid="ap-status-columns">
        {EXECUTION_STATUS_GROUPS.map((group) => (
          <section
            key={group.key}
            className="ap-status__group"
            data-group={group.key}
            data-tone={group.tone}
            data-testid={`ap-status-group-${group.key}`}
          >
            <header className="ap-status__group-head">
              <h3 className="ap-status__group-title">
                <span className="ap-status__group-glyph" aria-hidden>
                  {group.tone === 'gate' ? '▲' : group.tone === 'run' ? '◉' : '○'}
                </span>
                {group.label}
              </h3>
              <p className="ap-status__group-note">{group.note}</p>
            </header>
            <div className="ap-status__cards">
              {group.statuses.map((status) => {
                const isRunning = status === 'running';
                return (
                  <div
                    key={status}
                    className="ap-status__card"
                    data-status={status}
                    data-tone={isRunning ? 'run' : group.tone}
                    data-focus={isRunning || undefined}
                    data-testid={`ap-status-card-${status}`}
                  >
                    <span className="ap-status__card-glyph" aria-hidden>
                      {EXECUTION_STATUS_GLYPH[status]}
                    </span>
                    <span className="ap-status__card-name">{EXECUTION_STATUS_LABELS[status]}</span>
                    <span className="ap-status__card-key">{status}</span>
                    <span className="ap-status__card-count">{counts.get(status) ?? 0}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* 说明文字（在轴容器之外——中轴不穿说明文字，01 §7） */}
      <p className="ap-status__note">
        口径：running 为当前主状态（本页主焦点，实心黑卡）；<strong>人工门控</strong>两态（needs_attention /
        awaiting_review）等待人工介入，橙色标示；准备组的 awaiting_confirmation 同样等待人工批准。
        终态只读归档，迟到回执不得再改写。
      </p>
    </div>
  );
}
