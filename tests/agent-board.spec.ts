/**
 * 人话看板四组判定（v0.7 · 阶段 B · T05 / 设计文档 §2.3）。
 *
 * 本文件测的是**不变量**而非实现细节——分组逻辑若被后人改动，只要破坏了下述
 * 任一条，测试即红：
 *
 *   1. **判定链优先级**（先命中先归组，顺序不可调换）
 *   2. **互斥性**——任意两组的任务 id 集合交集为空
 *   3. **完备性**——五组（含 hidden）并集 == 输入全集（无任务凭空消失）
 *   4. **关键裁决**——`review`/`blocked` 只进「待我确认」，绝不进「进行中」
 *      （这是设计文档 §2.3.2 专门要消除的 B.4 重叠点）
 *   5. **hidden 语义**——`draft ∧ 依赖未满足` 不进任何可见组
 *   6. **边界与防御**——空集 / 全 done / 缺失引用 / 孤儿 blocked / 依赖环
 *   7. **与 `computeReadyTasks` 对齐**——两条计算路径不得各说各话
 *
 * 为什么「互斥 + 完备」要用集合运算而不是逐条断言：逐条断言只能覆盖写测试的人
 * 想到的用例；集合运算是对**全部输入**成立的结构性证明，新增状态值时仍有效。
 */
import { describe, it, expect } from 'vitest';

import {
  HUMAN_BOARD_GROUP_ORDER,
  buildDepsDone,
  groupTasksForHuman,
  humanGroupOf,
  type HumanBoardGroup,
} from '../src/core/agent/board';
import { computeReadyTasks } from '../src/core/agent/dag';
import { TaskStatus } from '../src/core/types/enums';
import type { Task } from '../src/core/types/entities';

let seq = 0;
function makeTask(partial: Partial<Task> & { title: string }): Task {
  seq += 1;
  const id = partial.id ?? `tsk_board_${seq}`;
  return {
    id,
    projectId: 'p1',
    stageId: 's1',
    taskNo: null,
    done: false,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'agent',
    externalId: null,
    agentId: null,
    status: TaskStatus.Draft,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    runId: null,
    orderIndex: seq,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

/** 全部 5 个组 key（显式列出，避免用 Object.keys 自证） */
const ALL_GROUPS: readonly HumanBoardGroup[] = [
  'confirm',
  'ready',
  'doing',
  'done',
  'hidden',
];

/** 把某组的任务 id 收成 Set，供集合运算 */
function idSet(view: ReturnType<typeof groupTasksForHuman>, g: HumanBoardGroup): Set<string> {
  return new Set(view.groups[g].map((t) => t.id));
}

/** 断言：互斥（两两交集为空）+ 完备（并集 == 全集） */
function expectPartition(tasks: readonly Task[]): void {
  const view = groupTasksForHuman(tasks);

  // 完备：并集规模 == 输入规模（id 唯一，故规模相等即并集相等）
  const union = new Set<string>();
  for (const g of ALL_GROUPS) for (const id of idSet(view, g)) union.add(id);
  expect(union.size, '完备性：五组并集应等于输入全集').toBe(tasks.length);

  // 互斥：两两求交为空
  for (let i = 0; i < ALL_GROUPS.length; i += 1) {
    for (let j = i + 1; j < ALL_GROUPS.length; j += 1) {
      const a = idSet(view, ALL_GROUPS[i]!);
      const b = idSet(view, ALL_GROUPS[j]!);
      const overlap = [...a].filter((id) => b.has(id));
      expect(
        overlap,
        `互斥性：${ALL_GROUPS[i]} 与 ${ALL_GROUPS[j]} 不应有交集`,
      ).toEqual([]);
    }
  }
}

describe('board：humanGroupOf 判定链优先级', () => {
  const depsDone = (): boolean => true;
  const depsUnmet = (): boolean => false;

  it('优先级 1：status === done → done', () => {
    expect(humanGroupOf(makeTask({ title: 'x', status: TaskStatus.Done }), depsDone)).toBe('done');
  });

  it('优先级 1：老数据 done === true 但 status 非 done → 仍归 done（taskIsDone 派生）', () => {
    const legacy = makeTask({ title: 'legacy', status: TaskStatus.Draft, done: true });
    expect(humanGroupOf(legacy, depsUnmet)).toBe('done');
  });

  it('优先级 2：review / blocked → confirm', () => {
    expect(humanGroupOf(makeTask({ title: 'r', status: TaskStatus.Review }), depsDone)).toBe('confirm');
    expect(humanGroupOf(makeTask({ title: 'b', status: TaskStatus.Blocked }), depsDone)).toBe('confirm');
  });

  it('优先级 3：in_progress / claimed → doing', () => {
    expect(humanGroupOf(makeTask({ title: 'ip', status: TaskStatus.InProgress }), depsDone)).toBe('doing');
    expect(humanGroupOf(makeTask({ title: 'c', status: TaskStatus.Claimed }), depsDone)).toBe('doing');
  });

  it('优先级 4：ready → ready', () => {
    expect(humanGroupOf(makeTask({ title: 'rd', status: TaskStatus.Ready }), depsDone)).toBe('ready');
  });

  it('优先级 4：draft 且依赖全 done → ready', () => {
    const t = makeTask({ title: 'd', status: TaskStatus.Draft, dependsOn: ['tsk_up'] });
    expect(humanGroupOf(t, depsDone)).toBe('ready');
  });

  it('优先级 4：draft 且无依赖（dependsOn 空）→ ready（空集 .every() 为真）', () => {
    const t = makeTask({ title: 'd0', status: TaskStatus.Draft, dependsOn: [] });
    expect(humanGroupOf(t, depsDone)).toBe('ready');
  });

  it('优先级 5：draft 且存在未满足依赖 → hidden', () => {
    const t = makeTask({ title: 'dh', status: TaskStatus.Draft, dependsOn: ['tsk_up'] });
    expect(humanGroupOf(t, depsUnmet)).toBe('hidden');
  });

  it('★ 关键裁决：review 即使依赖未满足，也只进 confirm（优先级先命中）', () => {
    const t = makeTask({ title: 'r+unmet', status: TaskStatus.Review, dependsOn: ['tsk_up'] });
    expect(humanGroupOf(t, depsUnmet)).toBe('confirm');
    expect(humanGroupOf(t, depsUnmet)).not.toBe('hidden');
  });

  it('★ 关键裁决：in_progress 依赖未满足 → 仍归 doing（不因依赖掉进 hidden）', () => {
    const t = makeTask({ title: 'ip+unmet', status: TaskStatus.InProgress, dependsOn: ['tsk_up'] });
    expect(humanGroupOf(t, depsUnmet)).toBe('doing');
  });

  it('★ 关键裁决：review 绝不进 doing（消除 B.4 原建议的重叠）', () => {
    const t = makeTask({ title: 'r', status: TaskStatus.Review });
    expect(humanGroupOf(t, depsDone)).not.toBe('doing');
    const b = makeTask({ title: 'b', status: TaskStatus.Blocked });
    expect(humanGroupOf(b, depsDone)).not.toBe('doing');
  });

  it('防脏数据：非法 status 兜底为 hidden（绝不谎称 done）', () => {
    const rogue = makeTask({ title: 'rogue', status: 'archived' as TaskStatus });
    expect(humanGroupOf(rogue, depsDone)).toBe('hidden');
  });
});

describe('board：7 状态 × 依赖情形的全矩阵互斥完备', () => {
  /**
   * 7 个 status × {无依赖, 依赖已满足, 依赖未满足} = 21 条，一次性验证
   * 互斥性与完备性。这是对**状态机全集**的覆盖，而非抽样。
   */
  it('21 条组合全部可归组，且互斥完备', () => {
    const up = makeTask({ id: 'tsk_up_done', title: 'up', status: TaskStatus.Done });
    const un = makeTask({ id: 'tsk_up_todo', title: 'up-todo', status: TaskStatus.Draft });
    const tasks: Task[] = [up, un];

    for (const status of [
      TaskStatus.Draft,
      TaskStatus.Ready,
      TaskStatus.Claimed,
      TaskStatus.InProgress,
      TaskStatus.Blocked,
      TaskStatus.Review,
      TaskStatus.Done,
    ]) {
      tasks.push(makeTask({ title: `${status}-nodeps`, status }));
      tasks.push(makeTask({ title: `${status}-depsdone`, status, dependsOn: ['tsk_up_done'] }));
      tasks.push(makeTask({ title: `${status}-depsunmet`, status, dependsOn: ['tsk_up_todo'] }));
    }

    expectPartition(tasks);
    expect(tasks.length).toBe(23); // 2 个上游 + 21 条矩阵
  });

  it('矩阵归组结果符合 §2.3.2 判定表（逐状态抽查）', () => {
    const upDone = makeTask({ id: 'tsk_upd', title: 'upd', status: TaskStatus.Done });
    const upTodo = makeTask({ id: 'tsk_upt', title: 'upt', status: TaskStatus.Draft });
    const depsDone = buildDepsDone([upDone, upTodo]);

    // confirm：review/blocked，与依赖无关
    expect(humanGroupOf(makeTask({ title: 'a', status: TaskStatus.Review, dependsOn: ['tsk_upt'] }), depsDone)).toBe('confirm');
    expect(humanGroupOf(makeTask({ title: 'b', status: TaskStatus.Blocked, dependsOn: ['tsk_upt'] }), depsDone)).toBe('confirm');
    // doing：claimed/in_progress，与依赖无关
    expect(humanGroupOf(makeTask({ title: 'c', status: TaskStatus.Claimed, dependsOn: ['tsk_upt'] }), depsDone)).toBe('doing');
    expect(humanGroupOf(makeTask({ title: 'd', status: TaskStatus.InProgress, dependsOn: ['tsk_upt'] }), depsDone)).toBe('doing');
    // ready：status=ready 或 draft+依赖满足
    expect(humanGroupOf(makeTask({ title: 'e', status: TaskStatus.Ready, dependsOn: ['tsk_upt'] }), depsDone)).toBe('ready');
    expect(humanGroupOf(makeTask({ title: 'f', status: TaskStatus.Draft, dependsOn: ['tsk_upd'] }), depsDone)).toBe('ready');
    // hidden：仅 draft+依赖未满足
    expect(humanGroupOf(makeTask({ title: 'g', status: TaskStatus.Draft, dependsOn: ['tsk_upt'] }), depsDone)).toBe('hidden');
  });
});

describe('board：边界与防御', () => {
  it('空列表 → 五组皆空，hiddenCount = 0', () => {
    const view = groupTasksForHuman([]);
    for (const g of ALL_GROUPS) expect(view.groups[g]).toEqual([]);
    expect(view.hiddenCount).toBe(0);
    expect(view.groupById.size).toBe(0);
  });

  it('全部 done → 全在 done 组，其余四组空', () => {
    const tasks = [
      makeTask({ title: 'a', status: TaskStatus.Done }),
      makeTask({ title: 'b', status: TaskStatus.Done }),
      makeTask({ title: 'c', status: TaskStatus.Done }),
    ];
    const view = groupTasksForHuman(tasks);
    expect(view.groups.done).toHaveLength(3);
    expect(view.groups.confirm).toHaveLength(0);
    expect(view.groups.ready).toHaveLength(0);
    expect(view.groups.doing).toHaveLength(0);
    expect(view.groups.hidden).toHaveLength(0);
    expectPartition(tasks);
  });

  it('依赖指向不存在的任务 → 视为已满足（与 dag.ts「缺失引用不算阻塞」同口径）', () => {
    const t = makeTask({ title: 'orphan-dep', status: TaskStatus.Draft, dependsOn: ['tsk_missing'] });
    // buildDepsDone 对未知 id 返回 true
    expect(buildDepsDone([t])('tsk_missing')).toBe(true);
    expect(humanGroupOf(t, buildDepsDone([t]))).toBe('ready');
  });

  it('blocked 但无 dependsOn 的孤儿 → 仍归 confirm（按 status，不看依赖）', () => {
    const orphan = makeTask({ title: 'blocked-orphan', status: TaskStatus.Blocked, dependsOn: [] });
    expect(humanGroupOf(orphan, buildDepsDone([orphan]))).toBe('confirm');
  });

  it('依赖环（读取侧防御）：不抛异常、不无限循环，全员归 hidden', () => {
    const a = makeTask({ id: 'tsk_ca', title: 'A', status: TaskStatus.Draft, dependsOn: ['tsk_cc'] });
    const b = makeTask({ id: 'tsk_cb', title: 'B', status: TaskStatus.Draft, dependsOn: ['tsk_ca'] });
    const c = makeTask({ id: 'tsk_cc', title: 'C', status: TaskStatus.Draft, dependsOn: ['tsk_cb'] });
    const tasks = [a, b, c];

    expect(() => groupTasksForHuman(tasks)).not.toThrow();
    const view = groupTasksForHuman(tasks);
    expect(view.groups.hidden).toHaveLength(3);
    expectPartition(tasks);
  });

  it('环中若有一条已 done → 其余两条不再被它阻塞（环被打破，不误判）', () => {
    // A(done) ← B ← C ← B（B/C 之间互引，A 已完成）
    const a = makeTask({ id: 'tsk_da', title: 'A', status: TaskStatus.Done });
    const b = makeTask({ id: 'tsk_db', title: 'B', status: TaskStatus.Draft, dependsOn: ['tsk_da', 'tsk_dc'] });
    const c = makeTask({ id: 'tsk_dc', title: 'C', status: TaskStatus.Draft, dependsOn: ['tsk_db'] });
    const view = groupTasksForHuman([a, b, c]);
    expect(view.groups.done.map((t) => t.id)).toEqual(['tsk_da']);
    // B/C 互引且都未完成 → 都 hidden（不抛异常即可，不要求解环）
    expect(view.groups.hidden.map((t) => t.id).sort()).toEqual(['tsk_db', 'tsk_dc']);
  });

  it('1000 节点线性深链不栈溢出（board 侧无递归，`.every` 为迭代）', () => {
    const chain: Task[] = [];
    for (let i = 0; i < 1000; i += 1) {
      chain.push(
        makeTask({
          id: `tsk_chain_${i}`,
          title: `n${i}`,
          status: TaskStatus.Draft,
          dependsOn: i === 0 ? [] : [`tsk_chain_${i - 1}`],
        }),
      );
    }
    expect(() => groupTasksForHuman(chain)).not.toThrow();
    const view = groupTasksForHuman(chain);
    // 头节点无依赖 → ready；其余全部依赖未满足 → hidden
    expect(view.groups.ready.map((t) => t.id)).toEqual(['tsk_chain_0']);
    expect(view.groups.hidden).toHaveLength(999);
    expectPartition(chain);
  });

  it('groupById 与 groups 保持一致（缓存表不得与桶脱节）', () => {
    const tasks = [
      makeTask({ title: 'a', status: TaskStatus.Done }),
      makeTask({ title: 'b', status: TaskStatus.Review }),
      makeTask({ title: 'c', status: TaskStatus.Draft, dependsOn: ['tsk_missing'] }),
    ];
    const view = groupTasksForHuman(tasks);
    for (const t of tasks) {
      const g = view.groupById.get(t.id);
      expect(g, `${t.id} 应在反查表内`).toBeDefined();
      expect(view.groups[g!].some((x) => x.id === t.id)).toBe(true);
    }
    expect(view.groupById.size).toBe(tasks.length);
  });

  it('保持输入相对顺序（本函数不排序，排序是渲染层的事）', () => {
    const tasks = [
      makeTask({ id: 'tsk_o1', title: '1', status: TaskStatus.Ready }),
      makeTask({ id: 'tsk_o2', title: '2', status: TaskStatus.Ready }),
      makeTask({ id: 'tsk_o3', title: '3', status: TaskStatus.Ready }),
    ];
    const view = groupTasksForHuman(tasks);
    expect(view.groups.ready.map((t) => t.id)).toEqual(['tsk_o1', 'tsk_o2', 'tsk_o3']);
  });
});

describe('board：组契约（可见顺序 / hidden 不属可见组）', () => {
  /**
   * ★ 这里原本还有一条 `isVisibleGroup()` 用例，v0.7 收口时随该谓词一起删除。
   *
   * 删得掉的原因是**它锁的事实已被上一行完全覆盖**：`isVisibleGroup('hidden') === false`
   * 等价于「`hidden` 不在 `HUMAN_BOARD_GROUP_ORDER` 里」，而下面这条 `not.toContain('hidden')`
   * 已经断言了同一件事——且断的是**唯一真相源本身**（数组内容），比经谓词间接推断更直接。
   * 保留谓词 = 在同一个模块里放两份回答「哪些组可见」的真相，将来加组时极易一改一漏。
   */
  it('显示顺序 = 待我确认 → 可开工 → 进行中 → 已完成，且不含 hidden', () => {
    expect(HUMAN_BOARD_GROUP_ORDER).toEqual(['confirm', 'ready', 'doing', 'done']);
    expect(HUMAN_BOARD_GROUP_ORDER).not.toContain('hidden');
  });
});

describe('board：与 computeReadyTasks 对齐（防同任务两处显示）', () => {
  it('「可开工」组 ⊇ computeReadyTasks().ready（文档 §2.3.4 包含关系）', () => {
    const upDone = makeTask({ id: 'tsk_adone', title: 'up-done', status: TaskStatus.Done });
    const upTodo = makeTask({ id: 'tsk_atodo', title: 'up-todo', status: TaskStatus.Draft });
    const tasks = [
      upDone,
      upTodo,
      makeTask({ id: 'tsk_r1', title: 'r1', status: TaskStatus.Ready }),
      makeTask({ id: 'tsk_r2', title: 'r2', status: TaskStatus.Ready, dependsOn: ['tsk_adone'] }),
      makeTask({ id: 'tsk_d1', title: 'd1', status: TaskStatus.Draft, dependsOn: ['tsk_adone'] }),
      makeTask({ id: 'tsk_d2', title: 'd2', status: TaskStatus.Draft }),
      makeTask({ id: 'tsk_h1', title: 'h1', status: TaskStatus.Draft, dependsOn: ['tsk_atodo'] }),
    ];

    const dagReady = new Set(computeReadyTasks(tasks).ready.map((t) => t.id));
    const humanReady = idSet(groupTasksForHuman(tasks), 'ready');

    // 每一个 DAG 认定的 ready 都必须在人话「可开工」组里
    for (const id of dagReady) {
      expect(humanReady.has(id), `${id} 在 dag.ready 但不在「可开工」组`).toBe(true);
    }
    // 且人话组严格更大（draft+deps-done 是补集，文档 §2.3.4）
    expect(humanReady.size).toBeGreaterThan(dagReady.size);
    expect(humanReady.has('tsk_d1')).toBe(true);
    expect(humanReady.has('tsk_d2')).toBe(true);
    // 依赖未满足的 draft 不在「可开工」组
    expect(humanReady.has('tsk_h1')).toBe(false);
  });

  it('已知差异：claimedAt 非空的 ready 任务算「可开工」但不算 dag.ready（记录在案）', () => {
    // computeReadyTasks 额外要求 claimedAt === null；humanGroupOf 只看 status。
    // 这是**有意保留**的差异：human 视角下 status=ready 就是「可以开工」，
    // 而 claimedAt 是 tech 侧的认领留痕。此处锁定该差异，防止有人「顺手对齐」
    // 而在两处引入隐式耦合。
    const t = makeTask({ id: 'tsk_claim', title: 'claimed-ish', status: TaskStatus.Ready, claimedAt: '2026-09-01T00:00:00.000Z' });
    expect(humanGroupOf(t, buildDepsDone([t]))).toBe('ready');
    expect(computeReadyTasks([t]).ready).toHaveLength(0);
  });
});
