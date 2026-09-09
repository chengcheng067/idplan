/**
 * T06 · local tasks 仓储：幂等 upsert + 原子 claim（设计文档 §3.5 DoD）：
 *   1. 同 externalId 连续 upsert 3 次 → 任务数 1、revision 3、created/updated 计数正确；
 *   2. claim 并发两次（Promise.allSettled）→ 恰一次成功、一次 Conflict；
 *   3. 非 ready 态 claim → Conflict；
 *   4. update(id,{status}) 后 done 双写正确（status 是唯一事实源）；
 *   5. orderIndex 仅新建语义：更新路径不重排。
 * 环境：fake-indexeddb（与既有 local spec 一致）。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle, TaskUpsertRow } from '../src/core/repositories/interfaces';
import { ChangxiaError, ChangxiaErrorCode, TaskStatus } from '../src/core/types/enums';

let bundle: IRepositoryBundle;

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
      projects: [], stages: [], tasks: [], members: [],
      assignments: [], logs: [], contracts: [], settings: [],
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
