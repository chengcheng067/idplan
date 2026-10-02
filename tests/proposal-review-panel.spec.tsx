// @vitest-environment jsdom
/**
 * 0.8.6 竞品三件套之二 · 写回提案审批（GitHub 审批流范式）。
 *
 * 钉八条：
 *   ① 只列待审（proposed/draft）；applied/rejected 不进列表（已落定由活动流显示）；
 *   ② 无待审 → null（不占位）；
 *   ③ **理由与 diff 同权**：有理由显示理由、无理由显式「（提案未给理由）」
 *      （不静默隐藏——审批人有权知道 agent 没给理由）；
 *   ④ 置信度三态展示：数值百分比 / 「未提供」（不补 100%）/ 条色分档；
 *   ⑤ 逐条通过/拒绝回调带对 status；
 *   ⑥ 勾选后出现批量条 + 「已选 N」；批量回调带**选中的 ids**；
 *   ⑦ 未勾选不渲染批量条（不占位）；
 *   ⑧ 展开按钮切 diff 明细（field: before → after）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { ProposalReviewPanel } from '../src/components/agent/ProposalReviewPanel';
import type { WritebackProposal } from '../src/core/types/agent-execution';

const p = (
  id: string,
  status: string,
  reason: string | null,
  confidence: number | null,
  ops = 2,
): WritebackProposal =>
  ({
    id,
    executionId: 'e1',
    attemptId: null,
    projectId: 'p1',
    taskId: null,
    operations: Array.from({ length: ops }, (_, i) => ({ field: `f${i}`, before: `old${i}`, after: `new${i}` })),
    status,
    idempotencyKey: `k-${id}`,
    reason,
    confidence,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-10-02T10:00:00Z',
    updatedAt: '2026-10-02T10:00:00Z',
  }) as unknown as WritebackProposal;

async function renderInto(el: HTMLElement, props: Parameters<typeof ProposalReviewPanel>[0]): Promise<void> {
  await act(async () => {
    createRoot(el).render(<ProposalReviewPanel {...props} />);
  });
}

const noop = (): void => undefined;

describe('ProposalReviewPanel（GitHub 审批流范式）', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('①② 只列待审；无待审 → null', async () => {
    await renderInto(container, {
      proposals: [p('a', 'applied', 'x', 0.9), p('b', 'rejected', 'y', 0.8)],
      onDecide: noop,
    });
    expect(container.innerHTML).toBe('');
  });

  it('③ 理由在位；无理由显式占位（不隐藏）', async () => {
    await renderInto(container, {
      proposals: [p('a', 'proposed', '甲方要求把施工延后两周', 0.9), p('b', 'proposed', null, 0.7)],
      onDecide: noop,
    });
    const text = container.textContent ?? '';
    expect(text).toContain('甲方要求把施工延后两周');
    expect(text).toContain('（提案未给理由）');
  });

  it('④ 置信度：百分比 / 未提供 / 条色分档', async () => {
    await renderInto(container, {
      proposals: [p('a', 'proposed', 'r1', 0.92), p('b', 'proposed', 'r2', null), p('c', 'proposed', 'r3', 0.3)],
      onDecide: noop,
    });
    const text = container.textContent ?? '';
    expect(text).toContain('置信度 92%');
    expect(text).toContain('置信度 未提供');
    expect(text).toContain('置信度 30%');
    // 条色：92% pine / 未提供 line（宽度 0）/ 30% clay
    expect(container.innerHTML).toContain('bg-pine');
    expect(container.innerHTML).toContain('bg-clay');
  });

  it('⑤ 逐条通过/拒绝回调带对 status 与 id', async () => {
    const onDecide = vi.fn();
    await renderInto(container, { proposals: [p('a', 'proposed', 'r', 0.9)], onDecide });
    const approveBtn = container.querySelector('[aria-label="通过提案 a"]') as HTMLButtonElement;
    const rejectBtn = container.querySelector('[aria-label="拒绝提案 a"]') as HTMLButtonElement;
    await act(async () => {
      approveBtn.click();
      rejectBtn.click();
    });
    expect(onDecide).toHaveBeenNthCalledWith(1, 'a', 'applied');
    expect(onDecide).toHaveBeenNthCalledWith(2, 'a', 'rejected');
  });

  it('⑥⑦ 勾选后出现批量条；未勾选不渲染', async () => {
    const onDecideMany = vi.fn();
    await renderInto(container, {
      proposals: [p('a', 'proposed', 'r1', 0.9), p('b', 'proposed', 'r2', 0.8)],
      onDecide: noop,
      onDecideMany,
    });
    expect(container.querySelector('[data-proposal-batch]')).toBeNull(); // ⑦
    const cb = container.querySelector('[aria-label="选择提案 b"]') as HTMLInputElement;
    await act(async () => {
      cb.click();
    });
    const batch = container.querySelector('[data-proposal-batch]');
    expect(batch).toBeTruthy();
    expect(batch!.textContent).toContain('已选 1');
    const batchApprove = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('批量通过'),
    ) as HTMLButtonElement;
    await act(async () => {
      batchApprove.click();
    });
    expect(onDecideMany).toHaveBeenCalledWith(['b'], 'applied');
  });

  it('⑧ 展开 diff 明细：field: before → after', async () => {
    await renderInto(container, { proposals: [p('a', 'proposed', 'r', 0.9, 2)], onDecide: noop });
    expect(container.textContent).not.toContain('f0');
    const toggle = container.querySelector('[aria-label="展开变更明细"]') as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });
    const text = container.textContent ?? '';
    expect(text).toContain('f0');
    expect(text).toContain('old0');
    expect(text).toContain('new1');
  });

  it('批量按钮不传 onDecideMany 时不渲染（能力缺失就不摆出）', async () => {
    await renderInto(container, { proposals: [p('a', 'proposed', 'r', 0.9)], onDecide: noop });
    const cb = container.querySelector('[aria-label="选择提案 a"]') as HTMLInputElement;
    await act(async () => {
      cb.click();
    });
    expect(container.querySelector('[data-proposal-batch]')).toBeNull();
  });
});
