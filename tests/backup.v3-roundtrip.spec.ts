/**
 * backup schema v3 roundtrip（v0.6 · N22 / IN-06）。
 *
 * 锁死四件事：
 *   1. v3 导出 → 导入 → 再导出，逐表 JSON.stringify diff 为空（键序稳定）；
 *   2. artifacts（对象数组）往返保真——字段逐一相等，绝不被 filter(string) 清空；
 *   3. v2 老备份（无 9 字段、done=true）导入后 status==='done'，其余字段显式默认值；
 *   4. v2 老备份（done=false）导入后 status==='draft'（保守归一，不置 ready）。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { BackupService, BACKUP_SCHEMA_VERSION, validateBackupJson } from '../src/core/services/backup.service';
import { previewSplit } from '../src/core/template/split';
import { ProjectService } from '../src/core/services/project.service';
import type { BackupPackage } from '../src/core/types/dto';
import type { Task } from '../src/core/types/entities';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // fake-indexeddb 同 module 实例共享同名库（'changxia'），而 backup.roundtrip.spec
  // 不做启动清库——这里用空包清库重建，保证不污染其它 spec 的行数断言
  await bundle.admin?.replaceAllImport(emptyPackage());
});

afterEach(async () => {
  // 跑完同样清库：本 spec 建了项目/任务，不清会污染排在后面的 backup.roundtrip
  await bundle.admin?.replaceAllImport(emptyPackage());
});

function emptyPackage(): BackupPackage {
  return {
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      projects: [],
      stages: [],
      tasks: [],
      members: [],
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
    },
  };
}

async function seedProjectWithArtifactedTask(): Promise<{ projectId: string; taskId: string; stageId: string }> {
  const projects = new ProjectService({ projects: bundle.projects, bundle });
  const drafts = previewSplit({ startAt: '2026-08-01', endAt: '2026-12-31' });
  const project = await projects.createProjectFromContract(
    {
      projectName: 'v3 往返验证',
      projectType: 'tea_space' as never,
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      startAt: '2026-08-01',
      endAt: '2026-12-31',
      stageOverrides: {},
      createdByManual: false,
      sourceFileName: null,
      rawTextDigest: 'digest-v3',
      parsedResultJsonSnapshot: '{}',
    },
    drafts,
  );
  const tasks = await bundle.tasks.listByProject(project.id);
  const stageId = tasks[0]!.stageId;
  await bundle.tasks.update(tasks[0]!.id, {
    status: 'review',
    description: '## 做什么\n- 序列化层对接',
    artifacts: [
      { id: 'art_p1', kind: 'file', title: 'a.ts', path: 'src/a.ts', url: null, note: null },
      { id: 'art_u1', kind: 'link', title: '外链', path: null, url: 'https://example.com', note: null },
    ],
  });
  return { projectId: project.id, taskId: tasks[0]!.id, stageId };
}

function normalize(pkg: BackupPackage): string {
  const p = JSON.parse(
    JSON.stringify(pkg, (key, value) => (key === 'exportedAt' ? undefined : value)),
  ) as BackupPackage;
  for (const key of Object.keys(p.data) as Array<keyof typeof p.data>) {
    p.data[key].sort((a: { id?: string; key?: string }, b: { id?: string; key?: string }) =>
      String(a.id ?? a.key ?? '').localeCompare(String(b.id ?? b.key ?? '')),
    );
  }
  return JSON.stringify(p);
}

describe('backup v3：导出/导入/roundtrip', () => {
  it('导出恒为 v3，artifacts 对象数组往返保真，逐表 diff 为空', async () => {
    const { taskId } = await seedProjectWithArtifactedTask();
    const svc = new BackupService(bundle);

    const exported1 = await svc.exportAll();
    expect(exported1.meta.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    const t1 = exported1.data.tasks.find((t) => t.id === taskId)!;
    expect(t1.status).toBe('review');
    expect(t1.done).toBe(false);
    expect(Array.isArray(t1.artifacts)).toBe(true);
    expect(t1.artifacts).toHaveLength(2);
    // 对象数组字段逐一相等（含 path 型与 url 型各一）
    expect(t1.artifacts[0]).toEqual({
      id: 'art_p1',
      kind: 'file',
      title: 'a.ts',
      path: 'src/a.ts',
      url: null,
      note: null,
    });
    expect(t1.artifacts[1]!.url).toBe('https://example.com');

    await svc.importAndReplace(exported1);
    const exported2 = await svc.exportAll();
    expect(normalize(exported2)).toBe(normalize(exported1)); // 键序稳定的硬证明

    const t2 = exported2.data.tasks.find((t) => t.id === taskId)!;
    expect(t2.artifacts).toEqual(t1.artifacts);
  });
});

describe('backup v3：v2 老备份兼容（done → status 归一）', () => {
  /** 手工构造 v2 备份：tasks 无 9 新字段（含 externalId 键序差异场景） */
  function v2Package(tasks: Array<Record<string, unknown>>): BackupPackage {
    return {
      meta: { app: 'changxia', schemaVersion: 2, exportedAt: '2026-08-01T00:00:00.000Z' },
      data: {
        projects: [],
        stages: [],
        tasks: tasks as unknown as Task[],
        members: [],
        assignments: [],
        logs: [],
        contracts: [],
        settings: [],
      },
    };
  }

  const baseRow = {
    id: 'tsk_v2_1',
    projectId: 'proj_1',
    stageId: 'stg_1',
    title: '旧任务',
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  it('done=true → status=done，其余字段为显式默认值（非 undefined）', async () => {
    const svc = new BackupService(bundle);
    await svc.importAndReplace(v2Package([{ ...baseRow, done: true }]));
    const rows = await bundle.tasks.list();
    expect(rows).toHaveLength(1);
    const t = rows[0]!;
    expect(t.status).toBe('done');
    expect(t.done).toBe(true);
    expect(t.source).toBe('human');
    // Dexie 侧 externalId 不写键（replaceAllImport 会剥掉 null 键），读取侧 ?? null 归一；
    // zod 归一产物的显式 null 已在上面「矛盾归一」用例覆盖
    expect(t.externalId ?? null).toBeNull();
    expect(t.agentId ?? null).toBeNull();
    expect(t.description).toBeNull();
    expect(t.dependsOn).toEqual([]);
    expect(t.artifacts).toEqual([]);
    expect(t.startAt).toBeNull();
    expect(t.claimedAt).toBeNull();
  });

  it('done=false → status=draft（保守归一，不置 ready）', async () => {
    const svc = new BackupService(bundle);
    await svc.importAndReplace(v2Package([{ ...baseRow, done: false }]));
    const rows = await bundle.tasks.list();
    expect(rows[0]!.status).toBe('draft');
    expect(rows[0]!.done).toBe(false);
  });

  it('老备份 status 与 done 矛盾时（status 缺失 + done=true）→ status 反推为 done', () => {
    const parsed = validateBackupJson(v2Package([{ ...baseRow, done: true }]));
    expect(parsed.data.tasks[0]!.status).toBe('done');
    expect(parsed.data.tasks[0]!.done).toBe(true);
  });

  it('artifacts 元素缺 id → 结构不符直接拒绝（不静默补）', () => {
    const broken = v2Package([
      {
        ...baseRow,
        done: false,
        artifacts: [{ kind: 'file', title: '缺 id', path: null, url: null, note: null }],
      },
    ]);
    expect(() => validateBackupJson(broken)).toThrowError(/校验失败/);
  });

  it('memberSchema v3：actorKind/agentKind 缺省归一 human/null（agentKind 开放字符串不被封闭）', () => {
    const pkg: BackupPackage = {
      meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-08-01T00:00:00.000Z' },
      data: {
        projects: [],
        stages: [],
        tasks: [],
        members: [
          {
            id: 'mem_v3_1',
            name: 'Codex-01',
            role: '',
            contact: null,
            avatarColor: '#3D6B5B',
            active: true,
            revision: 1,
            updatedAt: '2026-08-01T00:00:00.000Z',
          } as unknown as import('../src/core/types/entities').Member,
        ],
        assignments: [],
        logs: [],
        contracts: [],
        settings: [],
      },
    };
    const parsed = validateBackupJson(pkg);
    expect(parsed.data.members[0]!.actorKind).toBe('human');
    expect(parsed.data.members[0]!.agentKind).toBeNull();

    // agentKind 传入任意新 Harness 名都通过（开放字符串硬约束）
    const weird = validateBackupJson({
      ...pkg,
      data: {
        ...pkg.data,
        members: [
          {
            ...pkg.data.members[0],
            id: 'mem_v3_2',
            actorKind: 'agent',
            agentKind: '某个全新的agent',
          },
        ],
      },
    });
    expect(weird.data.members[0]!.agentKind).toBe('某个全新的agent');
  });
});
