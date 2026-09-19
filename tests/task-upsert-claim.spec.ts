/**
 * T06 · local tasks 仓储：幂等 upsert + 原子 claim（设计文档 §3.5 DoD）：
 *   1. 同 externalId 连续 upsert 3 次 → 任务数 1、revision 3、created/updated 计数正确；
 *   2. claim 并发两次（Promise.allSettled）→ 恰一次成功、一次 Conflict；
 *   3. 非 ready 态 claim → Conflict；
 *   4. update(id,{status}) 后 done 双写正确（status 是唯一事实源）；
 *   5. orderIndex 仅新建语义：更新路径不重排。
 *
 * v0.7 B-01 追加（见文件末尾那一组）：`status=ready ⟹ claimedAt=null` 不变式，
 * 修「释放后永远无法再认领」的认领僵尸。
 *
 * 环境：fake-indexeddb（与既有 local spec 一致）。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle, TaskUpsertRow } from '../src/core/repositories/interfaces';
import {
  ChangxiaError,
  ChangxiaErrorCode,
  TASK_STATUS_TRANSITIONS,
  TaskStatus,
} from '../src/core/types/enums';
import type { Task } from '../src/core/types/entities';
import { TaskService } from '../src/core/services/task.service';
import { computeReadyTasks } from '../src/core/agent/dag';

let bundle: IRepositoryBundle;

/** 认领时刻夹具：非空即代表「曾/正被持有」 */
const DIRTY_CLAIMED_AT = '2026-08-01T00:00:00.000Z';

/**
 * 构造一条**修复前版本会写下的**脏行：`status='ready'` 但 `claimedAt` 非空。
 *
 * 为什么必须造脏而不是走正常写入：修复后的写入路径已会把 claimedAt 归一，
 * 走 `insert`/`update` 永远造不出这种行。只有 `bulkInsert`（仓储里唯一不做
 * 状态归一化的入口）能忠实复现「老版本留下的存量数据」，这正是真实用户库里的形态。
 */
function legacyDirtyRow(id: string, title: string, status: TaskStatus): Task {
  return {
    id,
    taskNo: null,
    projectId: 'proj_b01',
    stageId: 'stg_b01',
    title,
    done: status === TaskStatus.Done,
    assigneeId: 'mem_legacy',
    assigneeIds: ['mem_legacy'],
    dueDate: null,
    source: 'agent',
    externalId: null,
    agentId: null,
    status,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: DIRTY_CLAIMED_AT,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

/** 最小可用 upsert 行（stageId/projectId 无外键约束，Dexie 层直接可写） */
function upsertRow(externalId: string, overrides: Partial<TaskUpsertRow> = {}): TaskUpsertRow {
  return {
    projectId: 'proj_u',
    stageId: 'stg_u',
    title: `任务 ${externalId}`,
    assigneeId: null,
    assigneeIds: [],
    dueDate: '2026-09-30',
    source: 'agent',
    externalId,
    agentId: null,
    status: TaskStatus.Ready,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    orderIndex: 1,
    ...overrides,
  };
}

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // fake-indexeddb 同 module 实例共享同名库（'changxia'）——每次空包清库保证隔离
  await bundle.admin?.replaceAllImport({
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      projects: [], stages: [], tasks: [], itineraries: [], members: [],
      assignments: [], logs: [], contracts: [], settings: [],
      executions: [], executionAttempts: [], executionEvents: [], writebackProposals: [],
    },
  });
});

describe('upsertByExternalId：幂等批量写入', () => {
  it('同 externalId 连续 upsert 3 次：任务数为 1，revision === 3，计数正确', async () => {
    const first = await bundle.tasks.upsertByExternalId([upsertRow('codex:run-1:t1')]);
    expect(first).toEqual({ created: 1, updated: 0 });

    // 全行替换语义（真实 payload 恒携带完整行）：第二次带新 title/status 整行覆盖
    const changed = upsertRow('codex:run-1:t1', {
      title: '改名后',
      status: TaskStatus.InProgress,
    });
    const second = await bundle.tasks.upsertByExternalId([changed]);
    expect(second).toEqual({ created: 0, updated: 1 });
    const afterSecond = (await bundle.tasks.list())[0]!;
    expect(afterSecond.title).toBe('改名后');
    expect(afterSecond.status).toBe(TaskStatus.InProgress);
    expect(afterSecond.done).toBe(false);

    // 第三次：同一行再导入（Agent 重发同 payload）→ revision 继续递增、title 保持
    const third = await bundle.tasks.upsertByExternalId([changed]);
    expect(third).toEqual({ created: 0, updated: 1 });

    const all = await bundle.tasks.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.revision).toBe(3);
    expect(all[0]!.title).toBe('改名后');
  });

  it('混批：命中与否同批各归其位；空数组零副作用', async () => {
    await bundle.tasks.upsertByExternalId([upsertRow('k:1')]);
    const res = await bundle.tasks.upsertByExternalId([
      upsertRow('k:1', { title: '更新版' }),
      upsertRow('k:2'),
    ]);
    expect(res).toEqual({ created: 1, updated: 1 });
    expect(await bundle.tasks.upsertByExternalId([])).toEqual({ created: 0, updated: 0 });
  });

  it('externalId 缺失 → Validation 拒绝（幂等键纪律）', async () => {
    await expect(
      bundle.tasks.upsertByExternalId([upsertRow('  ')]),
    ).rejects.toMatchObject({ code: ChangxiaErrorCode.Validation });
  });

  it('orderIndex 仅新建语义：更新路径不重排', async () => {
    await bundle.tasks.upsertByExternalId([upsertRow('k:o', { orderIndex: 7 })]);
    await bundle.tasks.upsertByExternalId([upsertRow('k:o', { orderIndex: 99 })]);
    const row = (await bundle.tasks.list())[0]!;
    expect(row.orderIndex).toBe(7);
  });
});

describe('claim：原子认领', () => {
  it('并发两次（Promise.allSettled）：一次成功、一次 Conflict', async () => {
    await bundle.tasks.upsertByExternalId([upsertRow('k:c', { status: TaskStatus.Ready })]);
    const task = (await bundle.tasks.list())[0]!;

    const results = await Promise.allSettled([
      bundle.tasks.claim(task.id, 'mem_a'),
      bundle.tasks.claim(task.id, 'mem_b'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ChangxiaError);
    expect(((rejected[0] as PromiseRejectedResult).reason as ChangxiaError).code).toBe(
      ChangxiaErrorCode.Conflict,
    );

    const after = (await bundle.tasks.list())[0]!;
    expect(after.status).toBe(TaskStatus.Claimed);
    expect(after.claimedAt).not.toBeNull();
    // assigneeId = 赢得争抢的成员
    expect(['mem_a', 'mem_b']).toContain(after.assigneeId);
  });

  it('非 ready 态（claimed 后再 claim / draft 态）→ Conflict', async () => {
    await bundle.tasks.upsertByExternalId([upsertRow('k:d', { status: TaskStatus.Draft })]);
    const draft = (await bundle.tasks.list())[0]!;
    await expect(bundle.tasks.claim(draft.id, 'mem_a')).rejects.toMatchObject({
      code: ChangxiaErrorCode.Conflict,
    });

    await bundle.tasks.upsertByExternalId([upsertRow('k:r', { status: TaskStatus.Ready })]);
    const ready = (await bundle.tasks.list()).find((t) => t.externalId === 'k:r')!;
    await bundle.tasks.claim(ready.id, 'mem_a');
    await expect(bundle.tasks.claim(ready.id, 'mem_b')).rejects.toMatchObject({
      code: ChangxiaErrorCode.Conflict,
    });
  });
});

describe('update：status ⇄ done 双写纪律', () => {
  it('status=done → done=true；status=ready → done=false', async () => {
    const row = await bundle.tasks.insert({
      projectId: 'proj_u',
      stageId: 'stg_u',
      title: '双写验证',
      assigneeId: null,
      dueDate: null,
    });
    const doneRow = await bundle.tasks.update(row.id, { status: TaskStatus.Done });
    expect(doneRow.done).toBe(true);

    const readyRow = await bundle.tasks.update(row.id, { status: TaskStatus.Ready });
    expect(readyRow.done).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * v0.7 · B-01：认领僵尸（「释放」之后没有任何 Agent 能接手）
 *
 * ── 缺陷 ──
 * `claimedAt` 是**活标记**（当前是否被持有），而「回到 ready」不是只有「初始
 * ready」一条路——`TASK_STATUS_TRANSITIONS` 里**有三条边**都落在 ready：
 *   `Draft → Ready`、`Claimed → Ready`（释放/超时回收）、`Blocked → Ready`（解除受阻）
 * 后两条的上游必然已认领过 → claimedAt 非空。旧写入路径只写 status、从不回退
 * claimedAt，于是留下 `status=ready ∧ claimedAt≠null` 的僵尸行，后果三连：
 *   · `claim()`        因 `claimedAt !== null` 判 Conflict → **无人能接手**
 *   · `computeReadyTasks()` 因同一条件排除它   → 也不在任何待办队列里
 *   · `TaskDrawer.canClaim` 为 false          → 认领按钮直接消失
 * 症状：界面看着「可开工」，实际没人能认领、也无处可查。v0.7 的核心卖点正是
 * 「认领 → 遇阻 → 释放 → 由另一 Agent 接手」，此 bug 把交接链掐断在第一步。
 *
 * ── 修复 ──
 * 不变式 `status === 'ready'` ⟹ `claimedAt === null`，由共享纯函数
 * `entities.normalizeClaimedAt()` 在所有写入路径强制（前端仓储 + 服务端
 * PATCH/upsert 用**同一份**实现——两端各写一遍 `if (status==='ready')` 正是
 * 本 bug 的产生方式，故本组测试同时是「规则只有一处」的守卫）。
 * 取活标记语义而非事件痕迹语义：改两个消费方会破坏 claim 的并发互斥地基。
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('B-01 不变式：status=ready ⟹ claimedAt=null', () => {
  /** 建一条正常 ready 任务（status=ready、claimedAt=null） */
  async function seedReady(ext: string): Promise<Task> {
    await bundle.tasks.upsertByExternalId([upsertRow(ext, { status: TaskStatus.Ready })]);
    return (await bundle.tasks.list()).find((t) => t.externalId === ext)!;
  }

  it('★ 主路径复现：claim → 释放(Claimed→Ready) → 可再次 claim 成功', async () => {
    const svc = new TaskService(bundle.tasks);
    const task = await seedReady('b01:release');

    const claimed = await bundle.tasks.claim(task.id, 'mem_a');
    expect(claimed.status).toBe(TaskStatus.Claimed);
    expect(claimed.claimedAt).not.toBeNull();

    // 释放：合法流转（enums: Claimed → Ready = 超时回收 / 主动释放）
    const released = await svc.transitionStatus(task.id, TaskStatus.Ready);
    expect(released.status).toBe(TaskStatus.Ready);
    expect(released.claimedAt, '释放后 claimedAt 必须被清空').toBeNull();

    // 另一个 Agent 必须能接手——这才是修复的意义
    const reclaimed = await bundle.tasks.claim(task.id, 'mem_b');
    expect(reclaimed.status).toBe(TaskStatus.Claimed);
    expect(reclaimed.assigneeId).toBe('mem_b');
  });

  it('★ 第二路径复现：claim → in_progress → blocked → Ready → 可再次 claim 成功', async () => {
    const svc = new TaskService(bundle.tasks);
    const task = await seedReady('b01:blocked');

    await bundle.tasks.claim(task.id, 'mem_a');
    await svc.transitionStatus(task.id, TaskStatus.InProgress);
    const blocked = await svc.transitionStatus(task.id, TaskStatus.Blocked);
    expect(blocked.claimedAt, '受阻期间是「被持有」，标记应保留').not.toBeNull();

    // 解除受阻 → 回到 ready（enums: Blocked → Ready）——此处是旧版僵尸的产生点
    const unblocked = await svc.transitionStatus(task.id, TaskStatus.Ready);
    expect(unblocked.claimedAt, '解除受阻后 claimedAt 必须被清空').toBeNull();

    const reclaimed = await bundle.tasks.claim(task.id, 'mem_b');
    expect(reclaimed.assigneeId).toBe('mem_b');
  });

  it('★ 释放后该任务重新出现在 computeReadyTasks 结果里', async () => {
    const svc = new TaskService(bundle.tasks);
    const task = await seedReady('b01:queue');

    await bundle.tasks.claim(task.id, 'mem_a');
    const claimedIds = computeReadyTasks(await bundle.tasks.list()).ready.map((t) => t.id);
    expect(claimedIds, '认领期间不应在 Ready 队列').not.toContain(task.id);

    await svc.transitionStatus(task.id, TaskStatus.Ready);
    const releasedIds = computeReadyTasks(await bundle.tasks.list()).ready.map((t) => t.id);
    expect(releasedIds, '释放后必须回到 Ready 队列（否则任务从系统里消失）').toContain(
      task.id,
    );
  });

  it('★ 表驱动：遍历 TASK_STATUS_TRANSITIONS 每条合法边 —— 落到 ready 的边必须清空 claimedAt', async () => {
    const svc = new TaskService(bundle.tasks);

    const edges: Array<[TaskStatus, TaskStatus]> = [];
    for (const from of Object.values(TaskStatus)) {
      for (const to of TASK_STATUS_TRANSITIONS[from] ?? []) edges.push([from, to]);
    }
    expect(edges.length, '状态机边集不应为空').toBeGreaterThan(0);

    let edgesLandingOnReady = 0;
    for (const [from, to] of edges) {
      const id = `tsk_b01_${from}_to_${to}`;
      // 用 bulkInsert 绕过写入侧归一化，模拟**修复前版本留下的存量脏行**
      await bundle.tasks.bulkInsert([legacyDirtyRow(id, `b01 ${from}→${to}`, from)]);

      // 夹具自检：若这里不脏，下面 to=ready 的断言就永远为真、毫无区分力
      const before = await bundle.tasks.get(id);
      expect(before?.claimedAt, `造脏失败：${from} 的夹具应带非空 claimedAt`).toBe(
        DIRTY_CLAIMED_AT,
      );

      const after = await svc.transitionStatus(id, to);
      if (to === TaskStatus.Ready) {
        edgesLandingOnReady += 1;
        expect(after.claimedAt, `${from} → ${to} 后 claimedAt 应被清空`).toBeNull();
      }
      // 回归：非 ready 的落点不得误清（审查改宽了就会在这里红）
      if (to !== TaskStatus.Ready && to !== TaskStatus.Done) {
        expect(after.claimedAt, `${from} → ${to} 不得误清 claimedAt（并发互斥地基）`).toBe(
          DIRTY_CLAIMED_AT,
        );
      }
    }
    // 落在 ready 的边恰好 3 条（Draft→Ready / Claimed→Ready / Blocked→Ready）。
    // 断言这个数字，是为了让「夹具/状态机被改动后本测试静默变空」不可能发生。
    expect(edgesLandingOnReady).toBe(3);
  });

  it('存量脏行：只改非状态字段也应顺手订正（否则一次改名就把僵尸「固化」）', async () => {
    const id = 'tsk_b01_dirty_ready';
    await bundle.tasks.bulkInsert([legacyDirtyRow(id, '脏 ready', TaskStatus.Ready)]);

    const updated = await bundle.tasks.update(id, { title: '改个名（不动状态）' });
    expect(updated.status).toBe(TaskStatus.Ready);
    expect(updated.claimedAt, '非状态字段写入也要归一，不能把僵尸留成正常行').toBeNull();
  });

  it('回归：非 ready 状态的 claimedAt 不得被误清（并发互斥地基）', async () => {
    const task = await seedReady('b01:keep');
    await bundle.tasks.claim(task.id, 'mem_a');

    const renamed = await bundle.tasks.update(task.id, { title: '改名但不动状态' });
    expect(renamed.status).toBe(TaskStatus.Claimed);
    expect(renamed.claimedAt, 'claimed 状态的持有标记是互斥依据，清掉会导致可被二次认领').not.toBeNull();

    // 双保险：确实仍然认领不了
    await expect(bundle.tasks.claim(task.id, 'mem_b')).rejects.toMatchObject({
      code: ChangxiaErrorCode.Conflict,
    });
  });

  it('回归：Agent 重发 payload 把状态带回 ready 时同样清空（upsert 路径）', async () => {
    const task = await seedReady('b01:upsert');
    await bundle.tasks.claim(task.id, 'mem_a');

    // Agent 重发同一 externalId 的行，status 回到 ready
    await bundle.tasks.upsertByExternalId([
      upsertRow('b01:upsert', { status: TaskStatus.Ready, claimedAt: DIRTY_CLAIMED_AT }),
    ]);
    const after = (await bundle.tasks.list()).find((t) => t.externalId === 'b01:upsert')!;
    expect(after.status).toBe(TaskStatus.Ready);
    expect(after.claimedAt).toBeNull();

    // 重发后必须可被接手
    const reclaimed = await bundle.tasks.claim(after.id, 'mem_b');
    expect(reclaimed.assigneeId).toBe('mem_b');
  });
});
