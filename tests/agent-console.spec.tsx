// @vitest-environment jsdom
/**
 * Agent 执行控制台（只读）——页面行为锁定。
 *
 * 覆盖：
 *   1. 空态：无任何执行记录时给出明确友好文案（最可能的初始状态）；
 *   2. 列表：造 3 条不同状态的执行单，逐条断言状态标签可见；
 *   3. 详情：展开后 attempts / events / proposals 正确显示；
 *   4. 非 happy-path A：`getExecution` 返回 null（执行单被删）→ 不崩，给出明确提示；
 *   5. 非 happy-path B：仓储抛错 → 页面降级为错误态并透出 userMessage，不白屏。
 *
 * 范式同 tests/agent-board-create.spec.tsx：原生 react-dom（项目无 @testing-library）。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { ChangxiaError, ChangxiaErrorCode } from '../src/core/types/enums';
import { ExecutionStatus, WritebackProposalStatus } from '../src/core/types/agent-execution';
import { emptyPackage } from './helpers/backup-fixture';

// 本页只依赖 useRepos 这一个 DI 入口，顶掉它即可（同既有 spec）。
let bundle: IRepositoryBundle;
vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => bundle,
}));

// 必须在 vi.mock 之后导入被测页
import { AgentExecutionConsolePage } from '../src/pages/AgentExecutionConsolePage';

beforeAll(installFakeIndexedDB);

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport(emptyPackage());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  document.body.removeChild(container);
  await bundle.admin?.replaceAllImport(emptyPackage());
});

/* ------------------------------ 小工具 ------------------------------ */

async function pump(times = 12): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(<AgentExecutionConsolePage />);
  });
  await pump();
}

function q<T extends Element>(selector: string): T | null {
  return container.querySelector<T>(selector);
}

function text(): string {
  return container.textContent ?? '';
}

/** 找到包含指定文案的按钮（用于点击展开某条执行单）。 */
function buttonByText(needle: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button'));
  const hit = buttons.find((b) => (b.textContent ?? '').includes(needle));
  if (!hit) throw new Error(`未找到含「${needle}」的按钮`);
  return hit as HTMLButtonElement;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await pump();
}

/* ------------------------------ 造数据 ------------------------------ */

/** 建一个项目（insert 会自动补齐 shortLabel/domain/kind 等默认字段）。 */
async function seedProject(id: string, name: string): Promise<void> {
  await bundle.projects.insert({
    id,
    name,
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-08-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
  });
}

/**
 * 造一条执行单并把它推到目标状态。
 *
 * 严格遵守真实状态机 `EXECUTION_TRANSITIONS`（存储边界强制，不可绕过）：
 *   draft → awaiting_confirmation → queued → running → {paused, needs_attention,
 *   awaiting_review, failed, cancelled}
 *   awaiting_review → completed（且要求存在**由人工决策**的 applied 写回提案）
 * 进入 queued 前还须补齐 confirmation（`assertExecutionConfirmed` 门槛）。
 */
async function seedExecution(input: {
  projectId: string;
  objective: string;
  idempotencyKey: string;
  status: ExecutionStatus;
}): Promise<string> {
  const exec = await bundle.executions.createExecution({
    projectId: input.projectId,
    source: 'project-task',
    objective: input.objective,
    idempotencyKey: input.idempotencyKey,
  });

  const target = input.status;
  if (target === ExecutionStatus.Draft) return exec.id;

  // 所有非 draft 状态都必经 confirmation（draft → awaiting_confirmation）
  await bundle.executions.updateExecutionStatus(exec.id, {
    status: ExecutionStatus.AwaitingConfirmation,
  });
  if (target === ExecutionStatus.AwaitingConfirmation) return exec.id;

  if (target === ExecutionStatus.Cancelled) {
    // draft 终止：直接取消即可，不必走完确认链
    await bundle.executions.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.Cancelled,
      terminalReason: '用户取消',
    });
    return exec.id;
  }

  // awaiting_confirmation → queued（补确认快照）
  await bundle.executions.updateExecutionStatus(exec.id, {
    status: ExecutionStatus.Queued,
    confirmation: {
      confirmedAt: '2026-08-01T00:00:00.000Z',
      confirmedBy: 'u1',
      planHash: 'plan-hash-1',
      planRevision: 1,
    },
  });
  if (target === ExecutionStatus.Queued) return exec.id;

  // queued → running
  await bundle.executions.updateExecutionStatus(exec.id, { status: ExecutionStatus.Running });

  if (target === ExecutionStatus.Running) return exec.id;

  if (target === ExecutionStatus.Paused) {
    await bundle.executions.updateExecutionStatus(exec.id, { status: ExecutionStatus.Paused });
    return exec.id;
  }

  if (target === ExecutionStatus.NeedsAttention) {
    await bundle.executions.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.NeedsAttention,
      blockedReason: '写回目标字段已被他人修改',
    });
    return exec.id;
  }

  if (target === ExecutionStatus.Failed) {
    await bundle.executions.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.Failed,
      terminalReason: '运行时异常',
    });
    return exec.id;
  }

  // 剩下 completed / awaiting_review 都必经 awaiting_review
  if (target === ExecutionStatus.AwaitingReview) {
    await bundle.executions.updateExecutionStatus(exec.id, {
      status: ExecutionStatus.AwaitingReview,
    });
    return exec.id;
  }

  // completed：必须先有「decidedBy 非空 + applied」的写回提案，再进 awaiting_review
  const proposal = await bundle.executions.createProposal({
    executionId: exec.id,
    projectId: input.projectId,
    operations: [{ field: 'task.status', before: 'review', after: 'done' }],
    idempotencyKey: `wb:${input.idempotencyKey}`,
  });
  await bundle.executions.updateProposal(proposal.id, {
    status: WritebackProposalStatus.Applied,
    decidedBy: 'u1',
    decidedAt: '2026-08-01T01:00:00.000Z',
  });
  await bundle.executions.updateExecutionStatus(exec.id, {
    status: ExecutionStatus.AwaitingReview,
  });
  await bundle.executions.updateExecutionStatus(exec.id, {
    status: ExecutionStatus.Completed,
    terminalReason: '任务已全部写回',
  });
  return exec.id;
}

/* ================================================================== *
 * 1. 空态
 * ================================================================== */

describe('Agent 执行控制台 · 空态', () => {
  it('无任何执行记录时渲染明确友好的空态文案', async () => {
    await seedProject('p_empty', '空项目');
    await render();

    expect(text()).toContain('还没有任何执行记录');
    // 空态不能只是「没内容」，要解释「为什么空 + 什么时候会有」
    expect(text()).toContain('尚未有执行被创建');
    // 计数为 0
    expect(text()).toContain('共 0 条执行记录');
    // 不该出现任何执行单标题
    expect(q('ul li.soft-card')).toBeNull();
  });
});

/* ================================================================== *
 * 2. 列表渲染 + 状态标签
 * ================================================================== */

describe('Agent 执行控制台 · 执行列表', () => {
  it('按项目分组渲染执行单，并显示各自的状态标签', async () => {
    await seedProject('p_a', '甲项目');
    await seedProject('p_b', '乙项目');

    await seedExecution({
      projectId: 'p_a',
      objective: '把阶段「方案」推进到完成',
      idempotencyKey: 'k1',
      status: ExecutionStatus.Completed,
    });
    await seedExecution({
      projectId: 'p_a',
      objective: '重排本周任务顺序',
      idempotencyKey: 'k2',
      status: ExecutionStatus.NeedsAttention,
    });
    await seedExecution({
      projectId: 'p_b',
      objective: '为成员生成今日待办',
      idempotencyKey: 'k3',
      status: ExecutionStatus.Running,
    });

    await render();

    // 项目分组标题
    expect(text()).toContain('甲项目');
    expect(text()).toContain('乙项目');

    // objective 可见
    expect(text()).toContain('把阶段「方案」推进到完成');
    expect(text()).toContain('重排本周任务顺序');
    expect(text()).toContain('为成员生成今日待办');

    // 三种不同状态的标签都要出现（10 个 status 走静态映射表，这里抽查 3 个不同语义组）
    expect(text()).toContain('已完成'); // 终态
    expect(text()).toContain('需关注'); // 需关注
    expect(text()).toContain('执行中'); // 进行中

    // 总数与需关注数
    expect(text()).toContain('共 3 条执行记录');
    expect(text()).toContain('1 条需关注');
  });

  it('全部 10 个 ExecutionStatus 都能渲染出各自的中文标签（映射表无漏项）', async () => {
    await seedProject('p_all', '全状态项目');

    // 每个状态一条执行单（走合法状态链）
    const statuses: ExecutionStatus[] = [
      ExecutionStatus.Draft,
      ExecutionStatus.AwaitingConfirmation,
      ExecutionStatus.Queued,
      ExecutionStatus.Running,
      ExecutionStatus.Paused,
      ExecutionStatus.NeedsAttention,
      ExecutionStatus.AwaitingReview,
      ExecutionStatus.Completed,
      ExecutionStatus.Failed,
      ExecutionStatus.Cancelled,
    ];
    for (const [i, s] of statuses.entries()) {
      await seedExecution({
        projectId: 'p_all',
        objective: `目标 ${s}`,
        idempotencyKey: `kall-${i}`,
        status: s,
      });
    }

    await render();

    expect(text()).toContain('共 10 条执行记录');

    // 10 个标签逐一可见——若映射表漏项会退化成兜底色，但仍会渲染「草稿」等原文，
    // 故这里同时断言 Rail/Badge 映射表对每个状态都取到了非 undefined 的类名。
    const labels = [
      '草稿',
      '待确认',
      '排队中',
      '执行中',
      '已暂停',
      '需关注',
      '待复核',
      '已完成',
      '已失败',
      '已取消',
    ];
    for (const label of labels) {
      expect(text()).toContain(label);
    }

    // 每个执行单都渲染了左缘色条（Rail 映射表命中，无 undefined 类名）
    const cards = container.querySelectorAll('li.soft-card');
    expect(cards.length).toBe(10);
    const rails = container.querySelectorAll('li.soft-card > div > span:first-child');
    expect(rails.length).toBe(10);
    rails.forEach((r) => {
      const cls = r.className;
      expect(cls).not.toContain('undefined');
      expect(cls.trim().length).toBeGreaterThan(0);
    });
  });
});

/* ================================================================== *
 * 3. 详情展开
 * ================================================================== */

describe('Agent 执行控制台 · 详情展开', () => {
  it('展开执行单后显示 attempts / events / proposals 明细', async () => {
    await seedProject('p_detail', '明细项目');
    const execId = await seedExecution({
      projectId: 'p_detail',
      objective: '写回任务状态',
      idempotencyKey: 'kd',
      status: ExecutionStatus.Completed,
    });

    const attempt = await bundle.executions.createAttempt({
      executionId: execId,
      attemptNo: 1,
      status: 'queued',
    });
    // errorCode / errorSummary 不在 createAttempt 的入参里（创建时恒为 null），
    // 必须经 updateAttempt 写入。
    await bundle.executions.updateAttempt(attempt.id, {
      status: 'failed',
      finishedAt: '2026-08-01T02:00:00.000Z',
      errorCode: 'E_WRITE_CONFLICT',
      errorSummary: '目标字段已被他人修改',
      terminalReason: '写回冲突',
    });
    await bundle.executions.appendEvent({
      executionId: execId,
      attemptId: attempt.id,
      seq: 1,
      type: 'created',
      actor: 'user',
      fromStatus: null,
      toStatus: ExecutionStatus.Draft,
      reason: null,
      idempotencyKey: null,
    });
    await bundle.executions.appendEvent({
      executionId: execId,
      attemptId: attempt.id,
      seq: 2,
      type: 'status_changed',
      actor: 'agent',
      fromStatus: ExecutionStatus.Draft,
      toStatus: ExecutionStatus.Running,
      reason: '开始执行',
      idempotencyKey: null,
    });
    const proposal = await bundle.executions.createProposal({
      executionId: execId,
      attemptId: attempt.id,
      projectId: 'p_detail',
      operations: [
        { field: 'task.status', before: 'review', after: 'done' },
        { field: 'task.assigneeId', before: null, after: 'm2' },
      ],
      idempotencyKey: 'wb1',
    });
    await bundle.executions.updateProposal(proposal.id, {
      status: WritebackProposalStatus.Conflict,
      decidedBy: 'reviewer-7',
    });

    await render();

    // 展开前：明细不该在
    expect(text()).not.toContain('执行尝试');

    await click(buttonByText('写回任务状态'));

    // 三块明细标题
    expect(text()).toContain('执行尝试');
    expect(text()).toContain('事件流水');
    expect(text()).toContain('写回提案');

    // attempts：序号 + 状态 + errorCode
    expect(text()).toContain('尝试 #1');
    expect(text()).toContain('失败');
    expect(text()).toContain('E_WRITE_CONFLICT');
    expect(text()).toContain('目标字段已被他人修改');

    // events：seq + type + actor + from→to
    expect(text()).toContain('created');
    expect(text()).toContain('status_changed');
    expect(text()).toContain('草稿');
    expect(text()).toContain('执行中');
    expect(text()).toContain('开始执行');

    // proposals：status + decidedBy + 操作前后值
    expect(text()).toContain('冲突');
    expect(text()).toContain('reviewer-7');
    expect(text()).toContain('task.status');
    expect(text()).toContain('task.assigneeId');
    expect(text()).toContain('review');

    // 再点一次收起
    await click(buttonByText('写回任务状态'));
    expect(text()).not.toContain('执行尝试');
  });

  it('执行单无明细时三块各自给出明确的空提示（不静默留白）', async () => {
    await seedProject('p_bare', '无明细项目');
    await seedExecution({
      projectId: 'p_bare',
      objective: '一次未产生明细的执行',
      idempotencyKey: 'kbare',
      status: ExecutionStatus.Draft,
    });

    await render();
    await click(buttonByText('一次未产生明细的执行'));

    expect(text()).toContain('尚无执行尝试。');
    expect(text()).toContain('尚无事件流水。');
    expect(text()).toContain('尚无写回提案。');
  });
});

/* ================================================================== *
 * 4. 非 happy-path A：getExecution 返回 null
 * ================================================================== */

describe('Agent 执行控制台 · 执行单缺失', () => {
  it('getExecution 返回 null 时降级提示，不崩溃，且明细仍照常展示', async () => {
    await seedProject('p_gone', '缺失项目');
    const execId = await seedExecution({
      projectId: 'p_gone',
      objective: '会被删掉的执行单',
      idempotencyKey: 'kgone',
      status: ExecutionStatus.Completed,
    });
    await bundle.executions.createAttempt({
      executionId: execId,
      attemptNo: 1,
      status: 'succeeded',
    });

    // 只在展开时让 getExecution 返回 null，模拟「列表有、单查没有」的竞态/删除
    const realGet = bundle.executions.getExecution.bind(bundle.executions);
    let callCount = 0;
    vi.spyOn(bundle.executions, 'getExecution').mockImplementation(async (id: string) => {
      callCount += 1;
      if (callCount === 1) return null;
      return realGet(id);
    });

    await render();
    await click(buttonByText('会被删掉的执行单'));

    // 不崩，且给出明确提示
    expect(text()).toContain('该执行单已不存在');
    // 明细其余三组照常展示（不因单条缺失就整块空白）
    expect(text()).toContain('执行尝试');
    expect(text()).toContain('尝试 #1');

    vi.restoreAllMocks();
  });
});

/* ================================================================== *
 * 5. 非 happy-path B：仓储抛错
 * ================================================================== */

describe('Agent 执行控制台 · 读取失败', () => {
  it('列表装载抛 ChangxiaError 时渲染错误态并透出 userMessage', async () => {
    const spy = vi
      .spyOn(bundle.executions, 'listExecutionsByProject')
      .mockRejectedValue(new ChangxiaError(ChangxiaErrorCode.Storage, '执行单读取失败。'));

    // 先建立项目（透过 spy 前的真实仓储），确保页面会走到 executions 查询
    await seedProject('p_err', '出错项目');
    spy.mockRejectedValue(new ChangxiaError(ChangxiaErrorCode.Storage, '执行单读取失败。'));

    await render();

    expect(spy).toHaveBeenCalled();
    expect(text()).toContain('执行记录读取失败');
    expect(text()).toContain('执行单读取失败。');
    // 错误态必须提供重试入口
    expect(buttonByText('重试')).toBeTruthy();

    vi.restoreAllMocks();
  });

  it('非 ChangxiaError 的异常走兜底文案，不把原始信息透给用户', async () => {
    const spy = vi
      .spyOn(bundle.executions, 'listExecutionsByProject')
      .mockRejectedValue(new Error('TypeError: x is not a function'));
    await seedProject('p_err2', '出错项目2');
    spy.mockRejectedValue(new Error('TypeError: x is not a function'));

    await render();

    expect(spy).toHaveBeenCalled();
    expect(text()).toContain('执行记录读取失败');
    expect(text()).toContain('执行记录读取失败。');
    expect(text()).not.toContain('x is not a function');

    vi.restoreAllMocks();
  });
});

/* ================================================================== *
 * 6. 只读纪律（源码级）
 * ================================================================== */

describe('Agent 执行控制台 · 只读纪律', () => {
  it('页面源码不出现任何执行域写方法', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '..', 'src/pages/AgentExecutionConsolePage.tsx'),
      'utf8',
    );

    const forbidden = [
      'createExecution',
      'updateExecutionStatus',
      'createAttempt',
      'updateAttempt',
      'appendEvent',
      'createProposal',
      'updateProposal',
      'deleteExecution',
    ];
    for (const name of forbidden) {
      expect(src).not.toContain(name);
    }
  });
});

/* ================================================================== *
 * 7. 导航接线（路由 + 侧栏 match 冲突）
 * ================================================================== */

describe('Agent 执行控制台 · 导航接线', () => {
  it('路由表在 /agent 之后注册 /agent/executions，且排在 * 通配之前', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '..', 'src/main.tsx'), 'utf8');

    const iAgent = src.indexOf("path: 'agent'");
    const iConsole = src.indexOf("path: 'agent/executions'");
    const iWildcard = src.indexOf("path: '*'");

    expect(iAgent).toBeGreaterThan(-1);
    expect(iConsole).toBeGreaterThan(-1);
    expect(iWildcard).toBeGreaterThan(-1);
    // 顺序：agent < agent/executions < *
    expect(iAgent).toBeLessThan(iConsole);
    expect(iConsole).toBeLessThan(iWildcard);
  });

  it('侧栏「工作区」不再用前缀匹配，避免与控制台项同时点亮', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '..', 'src/components/layout/SidebarNav.tsx'),
      'utf8',
    );

    // 只看代码，不看注释——注释里会**引用**这个反例字符串做说明。
    const code = src
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');

    expect(code).not.toContain("startsWith('/agent')");
    // 两个 Agent 侧入口都必须存在
    expect(code).toContain("to: '/agent'");
    expect(code).toContain("to: '/agent/executions'");
  });

  it('两个 Agent 侧导航项在同一批路径上互斥（恰有一个点亮）', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '..', 'src/components/layout/SidebarNav.tsx'),
      'utf8',
    );

    // 从源码中抽出两项的 match 谓词表达式，按真实语义求值——
    // 若将来有人把任一项改回前缀匹配，本用例会红。
    const predicates = Array.from(src.matchAll(/match: \(p\) => ([^,]+),/g)).map(
      (m) => m[1].trim(),
    );
    const agentPred = predicates.find((e) => e.includes("'/agent'"));
    const consolePred = predicates.find((e) => e.includes("'/agent/executions'"));
    expect(agentPred).toBeTruthy();
    expect(consolePred).toBeTruthy();

    // eslint-disable-next-line no-new-func
    const toFn = (expr: string) => new Function('p', `return (${expr});`) as (p: string) => boolean;
    const mAgent = toFn(agentPred!);
    const mConsole = toFn(consolePred!);

    for (const p of ['/agent', '/agent/executions']) {
      const hits = [mAgent(p), mConsole(p)].filter(Boolean).length;
      expect(hits, `路径 ${p} 应恰好点亮 1 项，实际 ${hits} 项`).toBe(1);
    }
    expect(mAgent('/agent')).toBe(true);
    expect(mConsole('/agent/executions')).toBe(true);
  });
});
