/**
 * taskNo 备份往返 + 号段归一（v0.7 §2.15-①/②/⑥/⑥′）· Dexie local 路径。
 *
 * ── 本 spec 锁死什么 ──
 *   ① **备份往返后 taskNo 逐条不变**：导出 → 导入 → 再导出，`JSON.stringify` 逐表 diff 为空，
 *      且每条任务的号与导入前**逐字相等**（`normalizeTaskRow` / `taskSchema` /
 *      `local.tasks.repo.insert` / `project.service` 的「五处键序铁律」在这里被间接验证：
 *      键序漂移一格，diff 立刻挂）；
 *   ② **v3 老包兼容**：老包根本没 `taskNo` 字段 → zod `.default(null)` 归一为**显式 null**
 *      → 展示回落 `—`，且往返稳定（不因人肉补号而改写数据）；
 *   ⑥ **包内撞号归一**：同一个号在包里出现两次 → 先到者保留、后到者重编号，`renumbered` 如实返回；
 *   ⑥′ **计数器追平**：导入后 `settings.taskNoSeq` 必须 ≥「包内 max+1 / 包内 seq / 本地 seq」
 *      三者最大值 —— 漏任一项都会让下一次新建复用包里已有的号。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { BackupService } from '../src/core/services/backup.service';
import { TASK_NO_SEQ_KEY, formatTaskNo } from '../src/core/lib/task-no';
import type { BackupPackage } from '../src/core/types/dto';
import type { Task } from '../src/core/types/entities';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
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

/** 稳定的 exportedAt 剥除 + 逐表排序（与 backup.roundtrip.spec 同款归一，保证 diff 稳定） */
function normalize(pkg: unknown): string {
  const p = JSON.parse(
    JSON.stringify(pkg, (key, value) => (key === 'exportedAt' ? undefined : value)),
  ) as BackupPackage;
  for (const key of Object.keys(p.data) as Array<keyof typeof p.data>) {
    p.data[key].sort(
      (a: { id?: string; key?: string }, b: { id?: string; key?: string }) =>
        String(a.id ?? a.key ?? '').localeCompare(String(b.id ?? b.key ?? '')),
    );
  }
  return JSON.stringify(p);
}

/** 建一个项目（Dexie 无外键，任务可直接挂在任意 projectId 下） */
function seedProject(id: string): Promise<unknown> {
  return bundle.projects.insert({
    id,
    name: `项目 ${id}`,
    type: 'dining' as never,
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-08-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
  });
}

function insertTask(title: string, projectId = 'p1', stageId = 's1'): Promise<Task> {
  return bundle.tasks.insert({ projectId, stageId, title, assigneeId: null, dueDate: null });
}

async function readSeq(): Promise<number | null> {
  const raw = await bundle.settings.get<number>(TASK_NO_SEQ_KEY);
  return typeof raw === 'number' ? raw : null;
}

/**
 * 一条**老包**（v3）任务行：**刻意不含 `taskNo` 键**。
 * 其余字段尽量精简（走 zod 的 `.default()`），只留结构校验的必填项。
 */
function legacyTaskRow(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    projectId: 'p1',
    stageId: 's1',
    title: `老任务 ${id}`,
    done: false,
    assigneeId: null,
    dueDate: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 一条**新包**（v3+taskNo）任务行：显式带 taskNo */
function taskRowWithNo(
  id: string,
  taskNo: number | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...legacyTaskRow(id, overrides), taskNo };
}

/** 组装一个包（meta 恒 v3） */
function pack(data: Partial<BackupPackage['data']>): BackupPackage {
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
      ...data,
    },
  };
}

describe('① 备份往返：taskNo 与 taskNoSeq 逐条不变', () => {
  it('导出 → 导入 → 再导出：逐表 diff 为空，且每条任务号不变', async () => {
    await seedProject('p1');
    const a = await insertTask('任务 A');
    const b = await insertTask('任务 B');
    const c = await insertTask('任务 C');
    expect([a.taskNo, b.taskNo, c.taskNo]).toEqual([1000, 1001, 1002]);

    const svc = new BackupService(bundle);
    const before = await svc.exportAll();
    expect(before.data.tasks.map((t) => t.taskNo).sort((x, y) => Number(x) - Number(y))).toEqual([
      1000, 1001, 1002,
    ]);
    expect(before.data.settings.find((s) => s.key === TASK_NO_SEQ_KEY)?.valueJson).toBe('1003');

    await svc.importAndReplace(before);
    const after = await svc.exportAll();

    // 逐表逐字节相等（键序铁律的间接验证）
    expect(normalize(after)).toBe(normalize(before));

    // 号逐条不变
    const nosBefore = new Map(before.data.tasks.map((t) => [t.id, t.taskNo]));
    for (const t of after.data.tasks) {
      expect(t.taskNo).toBe(nosBefore.get(t.id));
    }
    // 计数器不变
    expect(after.data.settings.find((s) => s.key === TASK_NO_SEQ_KEY)?.valueJson).toBe('1003');
  });

  it('往返后新建：接着 1002 之后发 1003，不与既有号相撞', async () => {
    await seedProject('p1');
    await insertTask('A');
    await insertTask('B');
    await insertTask('C');

    const svc = new BackupService(bundle);
    const pkg = await svc.exportAll();
    await svc.importAndReplace(pkg);

    const fresh = await insertTask('往返后新建');
    expect(fresh.taskNo).toBe(1003);
  });
});

describe('② v3 老包兼容：无 taskNo 字段 → 显式 null → 展示 —', () => {
  it('老包导入后 taskNo === null，导出仍为显式 null，往返稳定', async () => {
    const legacy = pack({
      projects: [
        {
          id: 'p1',
          name: '老项目',
          type: 'dining',
          address: '',
          clientName: '',
          contractAmount: null,
          signedAt: null,
          plannedStartAt: '2026-08-01',
          plannedEndAt: '2026-12-31',
          coverColor: null,
          status: 'active',
          revision: 1,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      tasks: [legacyTaskRow('t1'), legacyTaskRow('t2', { orderIndex: 2 })],
    });

    const svc = new BackupService(bundle);
    await svc.importAndReplace(legacy);

    const stored = await bundle.tasks.listByProject('p1');
    expect(stored).toHaveLength(2);
    for (const t of stored) {
      expect(t.taskNo).toBeNull();
      expect(formatTaskNo(t.taskNo)).toBe('—');
    }

    // 导出 → 再导入 → 再导出：老包的 null 不被改成号
    const exported = await svc.exportAll();
    for (const t of exported.data.tasks) expect(t.taskNo).toBeNull();
    await svc.importAndReplace(exported);
    const again = await svc.exportAll();
    expect(normalize(again)).toBe(normalize(exported));
  });

  it('老包导入后新建：号从数据 max+1 现算（老数据无号 → 首号仍为 1000）', async () => {
    const svc = new BackupService(bundle);
    await svc.importAndReplace(
      pack({ tasks: [legacyTaskRow('t1')], projects: [] }) as BackupPackage,
    );
    const fresh = await insertTask('老包之后新建');
    expect(fresh.taskNo).toBe(1000);
  });
});

describe('⑥ 包内撞号归一：先到者保留、后到者重编号', () => {
  it('两行同为 1000 → renumbered=1，先到者 1000、后到者 1001', async () => {
    const pkg = pack({
      projects: [
        {
          id: 'p1',
          name: 'P',
          type: 'dining',
          address: '',
          clientName: '',
          contractAmount: null,
          signedAt: null,
          plannedStartAt: '2026-08-01',
          plannedEndAt: '2026-12-31',
          coverColor: null,
          status: 'active',
          revision: 1,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      tasks: [taskRowWithNo('t1', 1000), taskRowWithNo('t2', 1000, { orderIndex: 2 })],
    });

    const result = await bundle.admin!.replaceAllImport(pkg);
    expect(result.renumbered).toBe(1);

    const stored = (await bundle.tasks.listByProject('p1')).sort((x, y) =>
      x.id.localeCompare(y.id),
    );
    expect(stored.map((t) => t.taskNo)).toEqual([1000, 1001]);
  });

  it('撞号归一后新建不撞号（next 已随重编号前移）', async () => {
    await bundle.admin!.replaceAllImport(
      pack({ tasks: [taskRowWithNo('t1', 1000), taskRowWithNo('t2', 1000)] }),
    );
    const fresh = await insertTask('归一后新建');
    expect(fresh.taskNo).toBe(1002); // max(1001+1, ...) —— 且 1001 已被占用，从这里发才安全
  });
});

describe('⑥′ 计数器追平：导入后 taskNoSeq ≥ 三者最大值', () => {
  it('包内 seq 落后于包内 max → 抬到 max+1', async () => {
    await bundle.admin!.replaceAllImport(
      pack({
        tasks: [taskRowWithNo('t1', 1000)],
        settings: [{ key: TASK_NO_SEQ_KEY, valueJson: '1000', updatedAt: '2026-08-01T00:00:00.000Z' }],
      }),
    );
    expect(await readSeq()).toBe(1001);
    expect((await insertTask('追平后新建')).taskNo).toBe(1001);
  });

  it('包内 seq 领先于包内 max → 抬到包内 seq（不被本地值拉回）', async () => {
    await bundle.admin!.replaceAllImport(
      pack({
        tasks: [taskRowWithNo('t1', 1000)],
        settings: [{ key: TASK_NO_SEQ_KEY, valueJson: '1043', updatedAt: '2026-08-01T00:00:00.000Z' }],
      }),
    );
    expect(await readSeq()).toBe(1043);
    expect((await insertTask('包内 seq 领先')).taskNo).toBe(1043);
  });

  it('★ 本地 seq 领先 → 导入老包后不被拉回（漏「本地 seq」即复用包内号）', async () => {
    // 本机已发到 2000
    await bundle.settings.set(TASK_NO_SEQ_KEY, 2000);

    await bundle.admin!.replaceAllImport(
      pack({
        tasks: [taskRowWithNo('t1', 1000)],
        settings: [{ key: TASK_NO_SEQ_KEY, valueJson: '1000', updatedAt: '2026-08-01T00:00:00.000Z' }],
      }),
    );
    expect(await readSeq()).toBe(2000); // max(1001, 1000, 2000)
    expect((await insertTask('本地领先')).taskNo).toBe(2000);
  });

  it('包内带号但无 seq 行 → 不凭空发明 settings 行（roundtrip 才不挂）', async () => {
    await bundle.admin!.replaceAllImport(
      pack({ tasks: [taskRowWithNo('t1', 1500), taskRowWithNo('t2', 1501)] }),
    );
    // settings 未被写入
    expect(await readSeq()).toBeNull();
    // 但下一次新建会由「库内 max+1」现算，不撞号
    expect((await insertTask('无 seq 行')).taskNo).toBe(1502);
  });
});
