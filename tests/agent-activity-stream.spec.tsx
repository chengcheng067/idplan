// @vitest-environment jsdom
/**
 * 0.8.6 Agent 活动流（她反馈 #1「agent 看板粗糙」的竞品对策第一刀）。
 *
 * 抄 Linear Coding Session 范式：执行单渲染成活动流里和评论同级的卡
 * （执行目标 + 事件时间线 + 写回提案状态 chip）。钉五条：
 *   ① 有数据才渲染（空 groups → null，绝不空区块占位）；
 *   ② 卡头要素：source / objective / createdAt；
 *   ③ 事件时间线逐条渲染（reason 文案在位）；
 *   ④ 提案状态 chip 锚点 data-activity-proposal={status}（真实枚举值）；
 *   ⑤ 有待审（proposed）提案时尾注出现。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { AgentActivityStream, type ActivityExecutionGroup } from '../src/components/agent/AgentActivityStream';
import { WritebackProposalStatus, EXECUTION_SOURCES } from '../src/core/types/agent-execution';

const ex = (id: string, createdAt: string, objective: string) =>
  ({
    id,
    projectId: 'p1',
    taskId: null,
    source: EXECUTION_SOURCES[0]!,
    objective,
    agentMemberId: null,
    channelKind: 'loopback',
    createdAt,
    status: 'completed',
  }) as unknown as ActivityExecutionGroup['execution'];

const ev = (id: string, type: string, reason: string | null, createdAt: string) =>
  ({
    id,
    executionId: 'e1',
    attemptId: null,
    seq: 1,
    type,
    actor: 'agent',
    fromStatus: null,
    toStatus: null,
    reason,
    idempotencyKey: null,
    createdAt,
  }) as unknown as ActivityExecutionGroup['events'][number];

const proposal = (id: string, status: string, n = 2) =>
  ({
    id,
    executionId: 'e1',
    attemptId: null,
    projectId: 'p1',
    taskId: null,
    operations: Array.from({ length: n }, (_, i) => ({ field: `f${i}`, before: 1, after: 2 })),
    status,
    idempotencyKey: 'k',
    decidedBy: null,
    decidedAt: null,
  }) as unknown as ActivityExecutionGroup['proposals'][number];

async function renderInto(el: HTMLElement, groups: readonly ActivityExecutionGroup[]): Promise<void> {
  await act(async () => {
    createRoot(el).render(<AgentActivityStream groups={groups} />);
  });
}

describe('AgentActivityStream（Linear Coding Session 范式）', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('① 空 groups → null（不占位）', async () => {
    await renderInto(container, []);
    expect(container.innerHTML).toBe('');
  });

  it('②④ 一卡：objective 在位 + 提案 chip + 待审尾注', async () => {
    await renderInto(container, [
      {
        execution: ex('e1', '2026-10-02T10:00:00Z', '把茶室项目推两周'),
        events: [ev('v1', 'created', '创建执行单', '2026-10-02T10:00:01Z')],
        proposals: [
          proposal('p1', WritebackProposalStatus.Proposed),
          proposal('p2', WritebackProposalStatus.Applied, 1),
        ],
      },
    ]);
    const text = container.textContent ?? '';
    expect(text).toContain('把茶室项目推两周');
    expect(text).toContain('2 项变更');
    expect(text).toContain('1 项变更');
    expect(container.querySelector('[data-activity-proposal="proposed"]')).toBeTruthy();
    expect(container.querySelector('[data-activity-proposal="applied"]')).toBeTruthy();
    expect(text).toContain('写回');
  });

  it('③ 事件时间线：逐条渲染 + reason 文案在位', async () => {
    await renderInto(container, [
      {
        execution: ex('e1', '2026-10-02T10:00:00Z', '目标'),
        events: [
          ev('v1', 'created', '开始解析', '2026-10-02T10:00:01Z'),
          ev('v2', 'completed', '已平移 2 段', '2026-10-02T10:00:09Z'),
        ],
        proposals: [],
      },
    ]);
    expect(container.querySelectorAll('[data-activity-event]')).toHaveLength(2);
    expect(container.textContent).toContain('已平移 2 段');
  });

  it('⑤ 无待审提案（全 applied）→ 尾注不出现', async () => {
    await renderInto(container, [
      {
        execution: ex('e1', '2026-10-02T10:00:00Z', '目标'),
        events: [],
        proposals: [proposal('p1', WritebackProposalStatus.Applied)],
      },
    ]);
    expect(container.textContent).not.toContain('有待审提案');
  });
});
