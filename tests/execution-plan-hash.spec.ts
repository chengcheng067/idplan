/**
 * 执行单「计划指纹」单测（stale approval 收紧切片 · 绑定载体）。
 *
 * 要锁死的**不是哈希函数长什么样**，而是「绑定集合的完整性」——因为绑定失效的唯一
 * 形式就是「计划改了，但指纹没变，于是旧确认继续放行」。故用**双边钉子**：
 *
 *   ① `EXECUTION_PLAN_FIELDS` 里的**每一个**字段都必须影响指纹
 *      （漏一个 = 那一项改了仍算「同一版计划」，确认白绑）；
 *   ② **不在**集合里的**每一个**字段都**不得**影响指纹
 *      （尤其生命周期字段：`status` 若参与指纹，`awaiting_confirmation → queued`
 *        这一步会自相矛盾——刚确认完指纹立刻对不上）。
 *
 * 两个方向都从常量 / 实体**展开遍历**，不手抄字段名：将来给 `Execution` 加字段，
 * 它会自动落进 ② 的检查范围；把它加进 `EXECUTION_PLAN_FIELDS`，则自动落进 ①。
 */

import { describe, it, expect } from 'vitest';

import { EXECUTION_PLAN_FIELDS, computePlanHash } from '../src/core/execution/plan-hash';
import { assertExecutionConfirmed } from '../src/core/execution/execution-state';
import { ExecutionStatus } from '../src/core/types/agent-execution';
import type { Execution } from '../src/core/types/entities';

/** 全字段基线执行单（18 个字段一个不少，便于双边遍历） */
const BASE: Execution = {
  id: 'e1',
  projectId: 'p1',
  taskId: 't1',
  source: 'project-task',
  objective: '把 T-1 推到 done',
  agentMemberId: null,
  channelKind: null,
  inputSnapshotHash: null,
  status: ExecutionStatus.AwaitingConfirmation,
  confirmation: null,
  idempotencyKey: 'exec:project-task:p1:t1',
  currentAttemptNo: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  terminalReason: null,
  blockedReason: null,
};

/** 造一个「与原值不同但同字段」的变体值 */
function mutate(key: keyof Execution, cur: unknown): unknown {
  if (typeof cur === 'string') return `${cur}~mutated`;
  if (typeof cur === 'number') return cur + 1;
  if (typeof cur === 'boolean') return !cur;
  if (cur === null) return `${String(key)}:filled`;
  // 对象（confirmation）——用不同但仍是对象的值
  return { confirmedAt: 'X', confirmedBy: 'X', planHash: 'X', planRevision: 9 };
}

describe('computePlanHash：确定性与规范序列化', () => {
  it('同输入恒同串（纯函数，不含随机/时间）', () => {
    expect(computePlanHash(BASE)).toBe(computePlanHash({ ...BASE }));
    expect(computePlanHash(BASE)).toHaveLength(16); // 两轮 FNV-1a 拼接
  });

  it('对象键序不影响结果（序列化前按字段名排序）', () => {
    const reversed = Object.fromEntries(Object.entries(BASE).reverse()) as Execution;
    // 先证明两个对象的键序确实不同，否则本用例是空的
    expect(Object.keys(reversed)).not.toEqual(Object.keys(BASE));
    expect(computePlanHash(reversed)).toBe(computePlanHash(BASE));
  });
});

describe('绑定集合完整性（双边钉子 · 从常量展开，不手抄字段名）', () => {
  it('① EXECUTION_PLAN_FIELDS 每一个字段都必须影响指纹', () => {
    const base = computePlanHash(BASE);
    for (const f of EXECUTION_PLAN_FIELDS) {
      const mutated = { ...BASE, [f]: mutate(f, (BASE as unknown as Record<string, unknown>)[f as string]) } as Execution;
      expect(computePlanHash(mutated), `计划字段 ${String(f)} 未参与指纹（漏绑）`).not.toBe(base);
    }
  });

  it('② 不在集合里的字段一律不得影响指纹（防生命周期字段渗入）', () => {
    const base = computePlanHash(BASE);
    const excluded = (Object.keys(BASE) as (keyof Execution)[]).filter(
      (k) => !EXECUTION_PLAN_FIELDS.includes(k),
    );
    // 排除集至少要有 10 个（id / status / confirmation / currentAttemptNo /
    // createdAt / updatedAt / startedAt / finishedAt / terminalReason / blockedReason）
    expect(excluded.length).toBeGreaterThanOrEqual(10);
    // 关键的生命周期字段必须在排除集里，否则 await→queued 会自相矛盾
    for (const mustExclude of ['status', 'updatedAt', 'confirmation', 'currentAttemptNo'] as const) {
      expect(EXECUTION_PLAN_FIELDS.includes(mustExclude), mustExclude).toBe(false);
    }
    for (const f of excluded) {
      const mutated = { ...BASE, [f]: mutate(f, (BASE as unknown as Record<string, unknown>)[f as string]) } as Execution;
      expect(computePlanHash(mutated), `字段 ${String(f)} 不应参与指纹`).toBe(base);
    }
  });
});

describe('planRevision：已废弃，不作为门槛（决策已钉死，不是沉默的遗留）', () => {
  it('planRevision 取 0 / 取任意值都不影响放行 —— 绑定只看 planHash', () => {
    const confirmation = {
      confirmedAt: '2026-08-01T00:00:00.000Z',
      confirmedBy: 'u1',
      planHash: computePlanHash(BASE),
      planRevision: 0, // 若是门槛，0 会被 falsy 判定误杀
    };
    const exec = { ...BASE, confirmation };
    const pure = { confirmationWrittenByCaller: false };

    expect(() =>
      assertExecutionConfirmed(exec, ExecutionStatus.Queued, pure),
    ).not.toThrow();
    expect(() =>
      assertExecutionConfirmed(
        { ...exec, confirmation: { ...confirmation, planRevision: 999 } },
        ExecutionStatus.Running,
        pure,
      ),
    ).not.toThrow();
  });
});
