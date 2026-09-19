/**
 * v0.7 阶段C（T09/T10/T11）· 复合唯一索引的**应用层作用域**（O1）。
 *
 * ── 本文件锁的是什么 ──
 * schema 层的换轨（`&externalId` → `&[projectId+externalId]`）本身由
 * tests/dexie-schema.guard.spec.ts 守着。但「索引对了」不等于「行为对了」：
 * 前端仓储若仍按全局查重（`.where('externalId')`），要么直接抛 SchemaError
 * （keyPath 已不存在），要么越过索引把别的项目的同名键行误判为「已存在」而**改写**它。
 * 故这里用**真实仓储**（createRepositories → LocalTasksRepository）跑端到端行为：
 *   1. 跨项目隔离：同一 externalId 在 A/B 各建一行；更新 A 绝不动 B；
 *   2. 同项目幂等：同一 (projectId, externalId) 连续 upsert 3 次仍只有 1 行；
 *   3. human 任务（externalId 非字符串）多条并存，不撞复合唯一索引。
 *
 * 环境：fake-indexeddb（与既有 local spec 一致）。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle, TaskUpsertRow } from '../src/core/repositories/interfaces';
import { TaskStatus } from '../src/core/types/enums';

let bundle: IRepositoryBundle;

/** 两个不同项目——O1 的全部意义就在这一对常量上 */
const PROJ_A = 'proj_scope_A';
const PROJ_B = 'proj_scope_B';

/** 最小可用 upsert 行（同一份夹具换 projectId / title 即可覆盖三种场景） */
function upsertRow(externalId: string, overrides: Partial<TaskUpsertRow> = {}): TaskUpsertRow {
  return {
    projectId: PROJ_A,
    stageId: 'stg_scope',
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

describe('O1 复合唯一索引：跨项目隔离', () => {
  it('★ 同一 externalId 在 A/B 两个项目各建一行，更新 A 不改 B（升级前必红）', async () => {
    const ext = 'codex:run-9:t1';

    // ── ① 两次「新建」必须都成功。升级前这里是全局唯一索引，第二次会抛
    //       ConstraintError（幂等键跨项目互相误伤）——这就是 O1 的病症本身。 ──
    expect(
      await bundle.tasks.upsertByExternalId([upsertRow(ext, { projectId: PROJ_A, title: 'A 项目的任务' })]),
    ).toEqual({ created: 1, updated: 0 });
    expect(
      await bundle.tasks.upsertByExternalId([upsertRow(ext, { projectId: PROJ_B, title: 'B 项目的任务' })]),
    ).toEqual({ created: 1, updated: 0 });

    const seeded = await bundle.tasks.list();
    expect(seeded, '两个项目应各自拿到一行').toHaveLength(2);
    expect(seeded.map((t) => t.projectId).sort()).toEqual([PROJ_A, PROJ_B]);
    expect(seeded.map((t) => t.externalId)).toEqual([ext, ext]); // 键相同——这正是重点

    // ── ② 更新 A 项目的同一键：必须命中 A 那一行，B 一字不动 ──
    expect(
      await bundle.tasks.upsertByExternalId([
        upsertRow(ext, { projectId: PROJ_A, title: 'A 改过名' }),
      ]),
    ).toEqual({ created: 0, updated: 1 });

    const after = await bundle.tasks.list();
    expect(after, '更新不得新建第二行').toHaveLength(2);

    const rowA = after.find((t) => t.projectId === PROJ_A)!;
    const rowB = after.find((t) => t.projectId === PROJ_B)!;
    expect(rowA.title).toBe('A 改过名');
    expect(rowA.revision, 'A 被更新 → revision 递增').toBe(2);
    expect(rowB.title, '★ B 项目的同名键任务绝不能被 A 的更新波及').toBe('B 项目的任务');
    expect(rowB.revision, 'B 未参与本次写入 → revision 不变').toBe(1);
    // 两行 id 不同 ⇒ 确实是两条独立任务，不是同一条被搬了项目
    expect(rowA.id).not.toBe(rowB.id);
  });
});

describe('O1 复合唯一索引：项目内仍然幂等', () => {
  it('★ 同一 (projectId, externalId) 连续 upsert 3 次仍只有 1 行（唯一性不能被放宽掉）', async () => {
    const ext = 'codex:run-9:t2';

    // 第 1 次新建；第 2、3 次都必须是「命中更新」而不是「又建一行」
    expect(await bundle.tasks.upsertByExternalId([upsertRow(ext, { projectId: PROJ_A })])).toEqual({
      created: 1,
      updated: 0,
    });
    expect(
      await bundle.tasks.upsertByExternalId([
        upsertRow(ext, { projectId: PROJ_A, title: '第二次' }),
      ]),
    ).toEqual({ created: 0, updated: 1 });
    expect(
      await bundle.tasks.upsertByExternalId([
        upsertRow(ext, { projectId: PROJ_A, title: '第二次' }),
      ]),
    ).toEqual({ created: 0, updated: 1 });

    const rows = await bundle.tasks.list();
    expect(rows, '复合唯一索引若被误写成普通索引，这里会变成 3 行').toHaveLength(1);
    expect(rows[0]!.revision).toBe(3);
    expect(rows[0]!.projectId).toBe(PROJ_A);
    expect(rows[0]!.externalId).toBe(ext);
  });

  it('同项目幂等键在**同一个批次内**重复出现：只写一行、不抛冲突', async () => {
    // 批内重复走的是「逐行先查后写」的同一事务，第二行应命中刚写入的第一行。
    const res = await bundle.tasks.upsertByExternalId([
      upsertRow('codex:run-9:t3', { projectId: PROJ_A, title: '首到' }),
      upsertRow('codex:run-9:t3', { projectId: PROJ_A, title: '后到' }),
    ]);
    expect(res).toEqual({ created: 1, updated: 1 });
    const rows = await bundle.tasks.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('后到');
  });
});

describe('O1 复合唯一索引：human 任务不进唯一索引', () => {
  it('★ 同项目多条 human 任务（无 externalId）并存不冲突', async () => {
    // 生产路径：insert(cmd) 且 cmd.externalId 未提供。
    // 注：insert 构造的是 `externalId: undefined`（键存在、值为 undefined），
    // 而 IndexedDB 对「键路径求值为 undefined」的行**不入索引**，
    // 因此不会产生 [projectId, undefined] 重复 → 不会 ConstraintError。
    for (const title of ['人工甲', '人工乙', '人工丙']) {
      await expect(
        bundle.tasks.insert({
          projectId: PROJ_A,
          stageId: 'stg_scope',
          title,
          assigneeId: null,
          dueDate: null,
        }),
      ).resolves.toBeDefined();
    }

    const rows = await bundle.tasks.list();
    expect(rows, '三条 human 任务必须各自成行（旧全局唯一索引下空键也安全，此处是回归基线）').toHaveLength(3);
    for (const r of rows) {
      expect(r.externalId, 'human 任务的 externalId 必须保持「非字符串」').toBeUndefined();
    }

    // 再插一条，仍不冲突
    await bundle.tasks.insert({
      projectId: PROJ_A,
      stageId: 'stg_scope',
      title: '人工丁',
      assigneeId: null,
      dueDate: null,
    });
    expect(await bundle.tasks.list()).toHaveLength(4);
  });

  it('★ human 与 agent 混在同一项目：各归其位，互不影响', async () => {
    await bundle.tasks.insert({
      projectId: PROJ_A,
      stageId: 'stg_scope',
      title: '人工任务',
      assigneeId: null,
      dueDate: null,
    });
    await bundle.tasks.upsertByExternalId([
      upsertRow('codex:run-9:t4', { projectId: PROJ_A, title: 'Agent 任务' }),
    ]);

    const rows = await bundle.tasks.list();
    expect(rows).toHaveLength(2);
    const human = rows.find((t) => !t.externalId)!;
    const agent = rows.find((t) => t.externalId)!;
    expect(human.title).toBe('人工任务');
    expect(agent.title).toBe('Agent 任务');

    // 再重发一次 agent 行 → 仍只更新 agent 那一行，human 行不动
    await bundle.tasks.upsertByExternalId([
      upsertRow('codex:run-9:t4', { projectId: PROJ_A, title: 'Agent 任务（二次）' }),
    ]);
    const after = await bundle.tasks.list();
    expect(after).toHaveLength(2);
    expect(after.find((t) => !t.externalId)!.title).toBe('人工任务');
    expect(after.find((t) => t.externalId)!.title).toBe('Agent 任务（二次）');
  });
});
