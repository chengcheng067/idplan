/**
 * taskNo 分配器纪律（v0.7 §2.15-③/④/⑤）· 共享纯函数 + Dexie local 路径。
 *
 * ── 本 spec 锁死什么 ──
 *   ③ **分配语义**：空库首号 = T-1000（数值 1000）；**删号后不复用**
 *      （删除 T-1050 后下一次新建必须是 1051，而不是又发 1050）；
 *   ④ **并发无重号**：20 个并发 `insert` 得到 20 个互不相同的号；
 *   ⑤ **upsert 不覆写**：命中既有行的路径沿用 `existing.taskNo`，绝不重新分配。
 *
 * ── 为什么必须逐条验 ──
 * 「init 一次、之后逐条自增」这条纪律只写在注释里是防不住的：一个事务里
 * 把计数器 `init` 两次（例如在循环内重新 `openTaskNoCounter`），整批新建就会
 * **全部拿到同一个号**，而且全程不报错 —— 只有端到端验「20 条是不是 20 个号」
 * 才拦得住（§2.15-④）。
 *
 * 「删号后不复用」同理：只要有人把 `initTaskNoSeq` 改成现算 `MAX(task_no)+1`，
 * 功能测试全绿，只有「删一条再建一条」这种用例才会红。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import {
  TASK_NO_LEGACY_MAX,
  TASK_NO_SEED,
  TASK_NO_SEQ_KEY,
  allocateTaskNo,
  createTaskNoCounter,
  formatTaskNo,
  initTaskNoSeq,
  maxTaskNoOf,
  parseTaskNoSeq,
  resolveTaskNoCollisions,
} from '../src/core/lib/task-no';
import type { Task } from '../src/core/types/entities';
import type { BackupPackage } from '../src/core/types/dto';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // 每个用例从空库起：fake-indexeddb 是单例，先跑的 spec 会留下脏行与脏计数器。
  // 空包导入会清掉全部 8 张表（含 settings.taskNoSeq）→ 计数器回到 1000。
  await bundle.admin?.replaceAllImport(emptyPackage());
});

function emptyPackage(): BackupPackage {
  return {
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      projects: [],
      stages: [],
      tasks: [],
      itineraries: [],
      members: [],
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
      executions: [],
      executionAttempts: [],
      executionEvents: [],
      writebackProposals: [],
    },
  };
}

/** 直接经 repo.insert 建一条任务（Dexie 侧无外键，projectId/stageId 可为任意串） */
function insertTask(title: string, projectId = 'p1', stageId = 's1'): Promise<Task> {
  return bundle.tasks.insert({ projectId, stageId, title, assigneeId: null, dueDate: null });
}

/** 读回本机计数器（settings.taskNoSeq），未落库 → null */
async function readSeq(): Promise<number | null> {
  const raw = await bundle.settings.get<number>(TASK_NO_SEQ_KEY);
  return typeof raw === 'number' ? raw : null;
}

/** 造一个 Task（纯函数用例用；只填 taskNo + 必填 id，其余以 any 兜底） */
function mkTask(taskNo: number | null, id = `t_${String(taskNo)}`): Task {
  return { id, taskNo } as unknown as Task;
}

describe('formatTaskNo：展示归一（补零只有一处）', () => {
  it('null / undefined → —（老数据本轮不回填）', () => {
    expect(formatTaskNo(null)).toBe('—');
    expect(formatTaskNo(undefined)).toBe('—');
  });

  it('1000 → T-1000（4 位下限）；1 → T-0001', () => {
    expect(formatTaskNo(1000)).toBe('T-1000');
    expect(formatTaskNo(1)).toBe('T-0001');
    expect(formatTaskNo(1050)).toBe('T-1050');
  });

  it('9999 → T-9999；10000 → T-10000（自然进位 5 位，绝不回绕/截断）', () => {
    expect(formatTaskNo(9999)).toBe('T-9999');
    expect(formatTaskNo(10000)).toBe('T-10000');
    expect(formatTaskNo(123456)).toBe('T-123456');
  });
});

describe('initTaskNoSeq / parseTaskNoSeq：种子与回落', () => {
  it('空库（两者皆无）→ 1000（首号 T-1000）', () => {
    expect(initTaskNoSeq({ seqFromSettings: null, maxTaskNoInDb: null })).toBe(TASK_NO_SEED);
    expect(initTaskNoSeq({ seqFromSettings: undefined, maxTaskNoInDb: undefined })).toBe(1000);
  });

  it('settings 里已有值 → 原样优先（不看 max）', () => {
    expect(initTaskNoSeq({ seqFromSettings: 1043, maxTaskNoInDb: 1000 })).toBe(1043);
    // 已知边界（登记项）：落后的 seq 不会自动抬到 max+1 —— 这里锁住「现状如注释所述」
    expect(initTaskNoSeq({ seqFromSettings: 1000, maxTaskNoInDb: 1005 })).toBe(1000);
  });

  it('无 seq 时由 max+1 现算，且不小于 1000', () => {
    expect(initTaskNoSeq({ seqFromSettings: null, maxTaskNoInDb: 1005 })).toBe(1006);
    expect(initTaskNoSeq({ seqFromSettings: null, maxTaskNoInDb: 3 })).toBe(1000); // max(4,1000)
  });

  it('parseTaskNoSeq：坏 JSON / 非有限数 → null（不抛，交由 max+1 兜底）', () => {
    expect(parseTaskNoSeq('1043')).toBe(1043);
    expect(parseTaskNoSeq('null')).toBeNull();
    expect(parseTaskNoSeq('"x"')).toBeNull();
    expect(parseTaskNoSeq('{bad json')).toBeNull();
    expect(parseTaskNoSeq(null)).toBeNull();
    expect(parseTaskNoSeq(undefined)).toBeNull();
  });

  it('TASK_NO_LEGACY_MAX 恒为 999（老包 max 占位）', () => {
    expect(TASK_NO_LEGACY_MAX).toBe(999);
  });
});

describe('allocateTaskNo / createTaskNoCounter：纯算术与「init 一次逐条自增」', () => {
  it('allocateTaskNo 返回 { taskNo: next, next: next+1 }', () => {
    expect(allocateTaskNo(1000)).toEqual({ taskNo: 1000, next: 1001 });
  });

  it('counter：take() 连取 3 次 → 1000/1001/1002；peek() = 1003', () => {
    const c = createTaskNoCounter({ seqFromSettings: null, maxTaskNoInDb: null });
    expect(c.peek()).toBe(1000);
    expect(c.take()).toBe(1000);
    expect(c.take()).toBe(1001);
    expect(c.take()).toBe(1002);
    expect(c.peek()).toBe(1003);
  });

  it('maxTaskNoOf：无有效号 → null；忽略 null/undefined/NaN', () => {
    expect(maxTaskNoOf([])).toBeNull();
    expect(maxTaskNoOf([mkTask(null), mkTask(null, 'b')])).toBeNull();
    expect(maxTaskNoOf([mkTask(1000), mkTask(null, 'b'), mkTask(1005, 'c')])).toBe(1005);
    expect(maxTaskNoOf([{ id: 'x' } as unknown as Task])).toBeNull(); // 缺键（v0.7 前老行）
  });
});

describe('resolveTaskNoCollisions：导入号段归一（§2.9.1 三者取最大）', () => {
  it('包内无撞号 → 行原样保留、renumbered=0，next = max(包内max+1, 包内seq, 本地seq)', () => {
    const rows = [mkTask(1000), mkTask(1005, 'b')];
    const r = resolveTaskNoCollisions(rows, {
      seqFromSettings: null,
      maxTaskNoInDb: 1005,
      existingNos: new Set<number>(),
      localSeq: null,
    });
    expect(r.renumbered).toBe(0);
    expect(r.rows.map((x) => x.taskNo)).toEqual([1000, 1005]);
    expect(r.next).toBe(1006); // max(1006, 1000, 1000)
  });

  it('包内撞号：先到者保留，后到者从 next 起重编号，next 随之前移', () => {
    const rows = [mkTask(1000, 'a'), mkTask(1000, 'b')];
    const r = resolveTaskNoCollisions(rows, {
      seqFromSettings: null,
      maxTaskNoInDb: 1000,
      existingNos: new Set<number>(),
      localSeq: null,
    });
    expect(r.renumbered).toBe(1);
    expect(r.rows[0]!.taskNo).toBe(1000); // 先到者不动
    expect(r.rows[1]!.taskNo).toBe(1001); // 后到者重编号
    expect(r.next).toBe(1002);
  });

  it('null（老数据）行不参与查重、不重编号、不补号', () => {
    const rows = [mkTask(null, 'a'), mkTask(1000, 'b')];
    const r = resolveTaskNoCollisions(rows, {
      seqFromSettings: null,
      maxTaskNoInDb: 1000,
      existingNos: new Set<number>(),
      localSeq: null,
    });
    expect(r.renumbered).toBe(0);
    expect(r.rows[0]!.taskNo).toBeNull();
    expect(r.rows[1]!.taskNo).toBe(1000);
  });

  it('★ 三者取最大：漏任一项都会撞号 —— 本地 seq 领先时必须抬到本地值', () => {
    const r = resolveTaskNoCollisions([mkTask(1000)], {
      seqFromSettings: null, // 包内无 seq
      maxTaskNoInDb: 1000,
      existingNos: new Set<number>(),
      localSeq: 1043, // 本机已发到 1043
    });
    expect(r.next).toBe(1043);
  });

  it('★ 三者取最大：包内 seq 领先时必须抬到包内 seq', () => {
    const r = resolveTaskNoCollisions([mkTask(1000)], {
      seqFromSettings: 1043,
      maxTaskNoInDb: 1000,
      existingNos: new Set<number>(),
      localSeq: null,
    });
    expect(r.next).toBe(1043);
  });

  it('★ 三者取最大：包内 max 领先时必须抬到 max+1', () => {
    const r = resolveTaskNoCollisions([mkTask(1099)], {
      seqFromSettings: 1000,
      maxTaskNoInDb: 1099,
      localSeq: 1000,
    });
    expect(r.next).toBe(1100);
  });

  it('existingNos 命中（合并导入语义预留）→ 与库内既有号冲突的行被重编号', () => {
    const r = resolveTaskNoCollisions([mkTask(1000)], {
      seqFromSettings: null,
      maxTaskNoInDb: 1000,
      existingNos: new Set<number>([1000]), // 库内已有 1000
      localSeq: null,
    });
    expect(r.renumbered).toBe(1);
    expect(r.rows[0]!.taskNo).toBe(1001);
  });
});

describe('Dexie local 路径：insert 分配 / 删号不复用 / bulkInsert / upsert / 并发', () => {
  it('③ 空库第一条 → 1000（T-1000），计数器前移到 1001', async () => {
    const t = await insertTask('第一条');
    expect(t.taskNo).toBe(1000);
    expect(formatTaskNo(t.taskNo)).toBe('T-1000');
    expect(await readSeq()).toBe(1001);
  });

  it('③ 连续新建严格递增：1000 / 1001 / 1002', async () => {
    const a = await insertTask('a');
    const b = await insertTask('b');
    const c = await insertTask('c');
    expect([a.taskNo, b.taskNo, c.taskNo]).toEqual([1000, 1001, 1002]);
    expect(await readSeq()).toBe(1003);
  });

  it('③ 删号不复用：删掉 T-1000 后新建必须是 1001（不是又发 1000）', async () => {
    const a = await insertTask('会被删的');
    expect(a.taskNo).toBe(1000);
    await bundle.tasks.remove(a.id);
    const b = await insertTask('删后新建');
    expect(b.taskNo).toBe(1001); // 若实现改成现算 MAX(task_no)+1 → 这里会得到 1000（复用）→ 红
    expect(await readSeq()).toBe(1002);
  });

  it('bulkInsert：未带号的行逐条分配（不是全批同号）', async () => {
    const rows: Task[] = [0, 1, 2].map((i) => baseRow('p1', 's1', `批内 ${i}`, null));
    await bundle.tasks.bulkInsert(rows);
    const stored = await bundle.tasks.listByProject('p1');
    expect(stored.map((t) => t.taskNo).sort((x, y) => Number(x) - Number(y))).toEqual([
      1000, 1001, 1002,
    ]);
    expect(await readSeq()).toBe(1003);
  });

  it('bulkInsert：已带号的行原样保留，且不碰计数器（纯写入无副作用）', async () => {
    const rows: Task[] = [
      baseRow('p1', 's1', '搬运 0', 5000),
      baseRow('p1', 's1', '搬运 1', 5001),
    ];
    await bundle.tasks.bulkInsert(rows);
    const stored = await bundle.tasks.listByProject('p1');
    expect(stored.map((t) => t.taskNo).sort((x, y) => Number(x) - Number(y))).toEqual([5000, 5001]);
    // 全带号 → 连事务都没开 → settings 未被创建
    expect(await readSeq()).toBeNull();
  });

  it('bulkInsert（全带号）之后再新建：由「库内 max+1」现算，不与搬运号相撞', async () => {
    await bundle.tasks.bulkInsert([baseRow('p1', 's1', '搬运', 5001)]);
    const fresh = await insertTask('新建');
    expect(fresh.taskNo).toBe(5002); // max(5001+1, 1000)
  });

  it('⑤ upsertByExternalId：新建分配号；同键重发命中既有行 → 号不被覆写', async () => {
    const first = await bundle.tasks.upsertByExternalId([
      {
        projectId: 'p1',
        stageId: 's1',
        title: 'Agent 首投',
        externalId: 'agent:run-1:task-1',
        status: 'ready' as never,
      } as never,
    ]);
    expect(first).toEqual({ created: 1, updated: 0 });
    const afterFirst = (await bundle.tasks.listByProject('p1'))[0]!;
    expect(afterFirst.taskNo).toBe(1000);

    // 同键重发（改标题）→ 命中既有行，updated=1，taskNo 必须还是 1000
    const second = await bundle.tasks.upsertByExternalId([
      {
        projectId: 'p1',
        stageId: 's1',
        title: 'Agent 重发（改了标题）',
        externalId: 'agent:run-1:task-1',
        status: 'ready' as never,
      } as never,
    ]);
    expect(second).toEqual({ created: 0, updated: 1 });
    const afterSecond = (await bundle.tasks.listByProject('p1'))[0]!;
    expect(afterSecond.title).toBe('Agent 重发（改了标题）');
    expect(afterSecond.taskNo).toBe(1000); // ★ 不覆写

    // 计数器只被消耗了 1 个（重发不消耗号）
    expect(await readSeq()).toBe(1001);
  });

  it('⑤ upsert 批内多条新建：逐条分配（1000/1001），不是全批同号', async () => {
    const r = await bundle.tasks.upsertByExternalId([
      { projectId: 'p1', stageId: 's1', title: 'A', externalId: 'k-a' } as never,
      { projectId: 'p1', stageId: 's1', title: 'B', externalId: 'k-b' } as never,
    ]);
    expect(r).toEqual({ created: 2, updated: 0 });
    const stored = await bundle.tasks.listByProject('p1');
    expect(stored.map((t) => t.taskNo).sort((x, y) => Number(x) - Number(y))).toEqual([1000, 1001]);
  });

  it('⑤ upsert 纯更新批次不碰计数器（settings 不产生无谓写入）', async () => {
    await bundle.tasks.upsertByExternalId([
      { projectId: 'p1', stageId: 's1', title: 'A', externalId: 'k-a' } as never,
    ]);
    const seqAfterCreate = await readSeq();
    await bundle.tasks.upsertByExternalId([
      { projectId: 'p1', stageId: 's1', title: 'A2', externalId: 'k-a' } as never,
    ]);
    expect(await readSeq()).toBe(seqAfterCreate); // 更新不动计数器
  });

  it('④ 并发 20 条 insert → 20 个互不相同的号（1000..1019 恰好各一次）', async () => {
    const created = await Promise.all(
      Array.from({ length: 20 }, (_, i) => insertTask(`并发 ${i}`)),
    );
    const nos = created.map((t) => t.taskNo as number);
    expect(new Set(nos).size).toBe(20); // 无重号
    expect([...nos].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => 1000 + i),
    );
    expect(await readSeq()).toBe(1020);
  });
});

/** 一条完整 Task（bulkInsert 用；taskNo 显式给出，null = 待分配） */
function baseRow(projectId: string, stageId: string, title: string, taskNo: number | null): Task {
  return {
    id: `tsk_${projectId}_${title}_${Math.random().toString(36).slice(2, 8)}`,
    taskNo,
    projectId,
    stageId,
    title,
    done: false,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'human',
    externalId: null,
    agentId: null,
    status: 'draft',
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
  } as unknown as Task;
}
