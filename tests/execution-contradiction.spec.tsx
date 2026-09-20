// @vitest-environment jsdom
/**
 * 「矛盾数据」判定纯函数 + 控制台开关行为（裁决 B）。
 *
 * ── 矛盾数据的定义 ──
 * 终态 execution（completed / failed / cancelled）上挂着**未启动或非终态**的 attempt
 * （queued / running）。判据的唯一出处是
 * `core/execution/execution-recovery.ts` 的 `isContradictoryExecution`。
 *
 * ── 为什么单测必须覆盖纯函数（而不只测「UI 上标记出现了」）──
 * UI 断言只能证明「某条被判成矛盾时标记显示了」，**证明不了边界没写反**：
 * 一个恒返回 true 的实现能让所有 UI 用例变绿，却会把整个列表染红。
 * 故本文件分两段：先锁死判定边界（含全部「不算矛盾」的形态），再验 UI 行为。
 *
 * ── 数据怎么造 ──
 * 矛盾的形态在**正常状态机路径下不可达**（那正是它被称为矛盾的原因：终态出边为空，
 * 无法把 attempt 挂到一个已终态的 execution 上再让它停在 queued）。
 * 故 UI 段用「伪造的仓储」直接喂数据 —— 这不是偷懒，是**唯一能造出该形态的方法**，
 * 也正是它在真实世界里出现的途径（备份恢复绕过状态校验、手改库）。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { installFakeIndexedDB } from './setup';
import {
  contradictionKind,
  isContradictoryExecution,
} from '../src/core/execution/execution-recovery';
import { AttemptStatus, ExecutionStatus } from '../src/core/types/agent-execution';
import type { Execution, ExecutionAttempt } from '../src/core/types/agent-execution';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';

/* ================================================================ *
 * 第一段：判定纯函数的边界
 * ================================================================ */

/** 只带 status 的最小执行单（判据只读这一个字段） */
const exec = (status: ExecutionStatus): Pick<Execution, 'status'> => ({ status });
/** 只带 status 的最小 attempt（判据只读这一个字段） */
const att = (status: AttemptStatus): Pick<ExecutionAttempt, 'status'> => ({ status });

describe('isContradictoryExecution：矛盾数据判定', () => {
  it('终态 execution + queued attempt → 矛盾', () => {
    expect(isContradictoryExecution(exec(ExecutionStatus.Completed), [att(AttemptStatus.Queued)])).toBe(
      true,
    );
    expect(isContradictoryExecution(exec(ExecutionStatus.Failed), [att(AttemptStatus.Queued)])).toBe(
      true,
    );
    expect(isContradictoryExecution(exec(ExecutionStatus.Cancelled), [att(AttemptStatus.Queued)])).toBe(
      true,
    );
  });

  it('终态 execution + running attempt → 矛盾', () => {
    expect(isContradictoryExecution(exec(ExecutionStatus.Completed), [att(AttemptStatus.Running)])).toBe(
      true,
    );
  });

  it('★ 终态 execution + 终态 attempt → **不算**矛盾（正常形态）', () => {
    for (const terminalAttempt of [
      AttemptStatus.Succeeded,
      AttemptStatus.Failed,
      AttemptStatus.Cancelled,
      AttemptStatus.Interrupted,
    ]) {
      expect(
        isContradictoryExecution(exec(ExecutionStatus.Completed), [att(terminalAttempt)]),
        `${terminalAttempt} 不该被判为矛盾`,
      ).toBe(false);
    }
  });

  it('★ 非终态 execution + queued attempt → **不算**矛盾（正常形态）', () => {
    for (const liveExec of [
      ExecutionStatus.Draft,
      ExecutionStatus.AwaitingConfirmation,
      ExecutionStatus.Queued,
      ExecutionStatus.Running,
      ExecutionStatus.Paused,
      ExecutionStatus.NeedsAttention,
      ExecutionStatus.AwaitingReview,
    ]) {
      expect(
        isContradictoryExecution(exec(liveExec), [att(AttemptStatus.Queued), att(AttemptStatus.Running)]),
        `${liveExec} 上的活 attempt 不该被判为矛盾`,
      ).toBe(false);
    }
  });

  it('终态 execution 无 attempt → 不算矛盾（空集合不是矛盾）', () => {
    expect(isContradictoryExecution(exec(ExecutionStatus.Completed), [])).toBe(false);
  });

  it('混合集合：只要有一条非终态 attempt 就算矛盾', () => {
    expect(
      isContradictoryExecution(exec(ExecutionStatus.Completed), [
        att(AttemptStatus.Succeeded),
        att(AttemptStatus.Failed),
        att(AttemptStatus.Queued),
      ]),
    ).toBe(true);
  });

  it('★ interrupted 不算矛盾（进程被杀的正常收尾，不能误报）', () => {
    // 这是判据必须用 ATTEMPT_NON_TERMINAL_STATUSES 而非「非 succeeded」的理由：
    // 后者会把「被中断」误报成矛盾，而 interrupted 是**兜底模块主动写的终态**。
    expect(
      isContradictoryExecution(exec(ExecutionStatus.Cancelled), [att(AttemptStatus.Interrupted)]),
    ).toBe(false);
  });
});

describe('contradictionKind：类别择取（取最强的一档）', () => {
  it('有 running → live', () => {
    expect(contradictionKind([att(AttemptStatus.Running)])).toBe('live');
  });
  it('只有 queued → pending', () => {
    expect(contradictionKind([att(AttemptStatus.Queued)])).toBe('pending');
  });
  it('queued + running 混在 → live（最强优先）', () => {
    expect(contradictionKind([att(AttemptStatus.Queued), att(AttemptStatus.Running)])).toBe('live');
  });
  it('全终态 → null', () => {
    expect(contradictionKind([att(AttemptStatus.Succeeded), att(AttemptStatus.Interrupted)])).toBeNull();
  });
  it('空集合 → null', () => {
    expect(contradictionKind([])).toBeNull();
  });
});

/* ================================================================ *
 * 第二段：控制台开关行为（开 / 关两态下标记与条目的可见性）
 * ================================================================ */

let bundle: IRepositoryBundle;
vi.mock('../src/hooks/useRepos', () => ({
  useRepos: () => bundle,
}));

import { AgentExecutionConsolePage } from '../src/pages/AgentExecutionConsolePage';
import { useUiStore } from '../src/store/useUiStore';

beforeAll(installFakeIndexedDB);

let container: HTMLDivElement;
let root: Root;

/** 一条正常执行单（终态 completed + 终态 attempt） */
function normalExecution(id: string, objective: string): Execution {
  return {
    id,
    projectId: 'proj_a',
    taskId: null,
    source: 'project-task',
    objective,
    agentMemberId: null,
    channelKind: null,
    inputSnapshotHash: null,
    status: ExecutionStatus.Completed,
    confirmation: null,
    idempotencyKey: `k:${id}`,
    currentAttemptNo: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T01:00:00.000Z',
    startedAt: '2026-09-01T00:00:00.000Z',
    finishedAt: '2026-09-01T01:00:00.000Z',
    terminalReason: '任务已全部写回',
    blockedReason: null,
  } as Execution;
}

/** 一条矛盾执行单（终态 completed + 仍 running 的 attempt） */
function contradictoryExecution(id: string): Execution {
  return { ...normalExecution(id, '矛盾：已结束却仍在跑'), terminalReason: null };
}

function attempt(id: string, executionId: string, status: AttemptStatus): ExecutionAttempt {
  return {
    id,
    executionId,
    attemptNo: 1,
    status,
    runtimeKind: null,
    startedAt: '2026-09-01T00:00:00.000Z',
    finishedAt: null,
    inputSnapshotHash: null,
    errorCode: null,
    errorSummary: null,
    terminalReason: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as ExecutionAttempt;
}

const NORMAL_ID = 'exec_normal';
const BAD_ID = 'exec_bad';

/**
 * 造一个「只返回造数据」的假 bundle。
 *
 * 为什么不用真 local Dexie 适配器：矛盾形态**在状态机下不可达**
 * （终态出边为空，装不出「终态 + running attempt」）。真适配器会拒绝造它，
 * 而假仓储能如实地把它摆出来 —— 这正是真实世界里它出现的途径。
 * 假仓储只实现本页调用的 6 个读方法，其余留空（用到即崩，不会静默返回假数据）。
 */
function fakeBundle(executions: Execution[], attemptsByExec: Map<string, ExecutionAttempt[]>): IRepositoryBundle {
  return {
    projects: {
      list: async () => [
        {
          id: 'proj_a',
          name: '矛盾数据测试项目',
          archivedAt: null,
          revision: 1,
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    },
    executions: {
      listExecutionsByProject: async () => executions,
      getExecution: async (id: string) => executions.find((e) => e.id === id) ?? null,
      listAttempts: async (id: string) => attemptsByExec.get(id) ?? [],
      listEvents: async () => [],
      listProposals: async () => [],
    },
  } as unknown as IRepositoryBundle;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // 每个用例从「显示」这个默认值起步（store 是模块级单例，会跨用例泄漏）
  localStorage.removeItem('idplan.execConsole.showContradictory');
  useUiStore.setState({ showContradictoryExecutions: true });
});

afterEach(() => {
  act(() => root.unmount());
  document.body.removeChild(container);
  localStorage.removeItem('idplan.execConsole.showContradictory');
  useUiStore.setState({ showContradictoryExecutions: true });
});

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
function qa<T extends Element>(selector: string): T[] {
  return Array.from(container.querySelectorAll<T>(selector));
}
function text(): string {
  return container.textContent ?? '';
}

/** 装好「一条正常 + 一条矛盾」的数据并渲染 */
async function renderMixed(): Promise<void> {
  bundle = fakeBundle(
    [normalExecution(NORMAL_ID, '正常：已完成的排期调整'), contradictoryExecution(BAD_ID)],
    new Map([[BAD_ID, [attempt('att_1', BAD_ID, AttemptStatus.Running)]]]),
  );
  await render();
}

async function clickToggle(): Promise<void> {
  const toggle = q<HTMLInputElement>('[data-exec-contradiction-toggle]');
  if (!toggle) throw new Error('未找到「显示矛盾数据」开关');
  await act(async () => {
    toggle.click();
  });
  await pump();
}

describe('执行控制台 · 矛盾数据标记与开关', () => {
  it('识别：矛盾条目带标记、正常条目不带（防「一律标记」的假绿）', async () => {
    await renderMixed();
    const marks = qa('[data-exec-contradiction]');
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute('data-exec-contradiction')).toBe('live');
    // 标记文案必须说清「已结束却有尝试在跑」，且指名尝试号
    expect(marks[0].textContent).toContain('数据矛盾');
    expect(marks[0].textContent).toContain('执行中');
    expect(marks[0].textContent).toContain('#1');

    // 矛盾卡片带数据属性、正常卡片不带
    const badCard = q(`[data-exec-contradiction-card="live"]`);
    expect(badCard).not.toBeNull();
    expect(badCard?.textContent).toContain('矛盾：已结束却仍在跑');
    expect(qa('[data-exec-contradiction-card]')).toHaveLength(1);
  });

  it('默认显示：开关初始为开，矛盾条目在列表中可见', async () => {
    await renderMixed();
    const toggle = q<HTMLInputElement>('[data-exec-contradiction-toggle]');
    expect(toggle?.checked).toBe(true);
    expect(text()).toContain('矛盾：已结束却仍在跑');
    expect(text()).toContain('正常：已完成的排期调整');
    expect(text()).toContain('共 2 条执行记录');
  });

  it('★ 关闭开关：矛盾条目与标记一起消失，正常条目仍在', async () => {
    await renderMixed();
    await clickToggle();

    expect(q<HTMLInputElement>('[data-exec-contradiction-toggle]')?.checked).toBe(false);
    expect(qa('[data-exec-contradiction]')).toHaveLength(0);
    expect(qa('[data-exec-contradiction-card]')).toHaveLength(0);
    expect(text()).not.toContain('矛盾：已结束却仍在跑');
    // 正常条目不受影响 —— 这是「过滤」而非「清空」
    expect(text()).toContain('正常：已完成的排期调整');
  });

  it('★ 关闭开关时计数如实说明「已隐藏 N 条」（不静默改小计数）', async () => {
    await renderMixed();
    expect(text()).toContain('共 2 条执行记录');
    await clickToggle();
    expect(text()).toContain('共 1 条执行记录');
    expect(text()).toContain('已隐藏 1 条矛盾数据');
  });

  it('重新打开开关：矛盾条目与标记一起回来（开关可逆）', async () => {
    await renderMixed();
    await clickToggle();
    expect(qa('[data-exec-contradiction]')).toHaveLength(0);

    await clickToggle();
    expect(qa('[data-exec-contradiction]')).toHaveLength(1);
    expect(text()).toContain('矛盾：已结束却仍在跑');
    expect(text()).toContain('共 2 条执行记录');
  });

  it('★ 全部是矛盾数据 + 开关关闭 → 空态明说「有 N 条被隐藏」，不说「一条都没有」', async () => {
    bundle = fakeBundle(
      [contradictoryExecution(BAD_ID)],
      new Map([[BAD_ID, [attempt('att_1', BAD_ID, AttemptStatus.Running)]]]),
    );
    await render();
    await clickToggle();

    expect(text()).toContain('当前没有可正常显示的执行记录');
    expect(text()).toContain('库中共有 1 条执行记录');
    // 关键：绝不能出现「还没有任何执行记录」这句 —— 那会让用户以为库里是空的
    expect(text()).not.toContain('还没有任何执行记录');
  });

  it('queued 型矛盾用「排队中」文案（与 running 型区分）', async () => {
    bundle = fakeBundle(
      [contradictoryExecution(BAD_ID)],
      new Map([[BAD_ID, [attempt('att_1', BAD_ID, AttemptStatus.Queued)]]]),
    );
    await render();
    const mark = q('[data-exec-contradiction]');
    expect(mark?.getAttribute('data-exec-contradiction')).toBe('pending');
    expect(mark?.textContent).toContain('排队中');
  });

  it('开关状态落 localStorage（刷新后保留）', async () => {
    await renderMixed();
    await clickToggle();
    expect(localStorage.getItem('idplan.execConsole.showContradictory')).toBe('0');
    await clickToggle();
    expect(localStorage.getItem('idplan.execConsole.showContradictory')).toBe('1');
  });

  it('首屏从 localStorage 读回开关（关状态下打开页面即不显示矛盾条目）', async () => {
    localStorage.setItem('idplan.execConsole.showContradictory', '0');
    useUiStore.setState({ showContradictoryExecutions: false });
    await renderMixed();
    expect(qa('[data-exec-contradiction]')).toHaveLength(0);
    expect(text()).not.toContain('矛盾：已结束却仍在跑');
    expect(text()).toContain('正常：已完成的排期调整');
  });

  it('单条 attempt 取数失败：不崩、不误报为矛盾、不把整页推入错误态', async () => {
    const ex = [normalExecution(NORMAL_ID, '正常：attempt 取数失败')];
    bundle = {
      projects: { list: async () => [{ id: 'proj_a', name: 'P' }] },
      executions: {
        listExecutionsByProject: async () => ex,
        getExecution: async () => ex[0],
        listAttempts: async () => {
          throw new Error('boom');
        },
        listEvents: async () => [],
        listProposals: async () => [],
      },
    } as unknown as IRepositoryBundle;
    await render();
    expect(text()).toContain('正常：attempt 取数失败');
    expect(text()).not.toContain('执行记录读取失败');
    expect(qa('[data-exec-contradiction]')).toHaveLength(0);
  });
});
