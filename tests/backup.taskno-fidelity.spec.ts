/**
 * #19 · 备份往返保真（**本地 Dexie 适配器**路径；不碰 server）
 *
 * ── 本 spec 锁死三件事 ──
 *   ① **逐字段一致**：导出 → 导入 → 再导出，逐行**按字段名**比对，失败时直接报出
 *      是哪个字段从什么值变成了什么值（而不是甩一整坨 JSON 字符串让人肉眼 diff）；
 *   ② **键序稳定**：往返前后**每一行的键顺序**逐字相同，且是「规范序」的子序列；
 *   ③ **前导 taskNo 不被改写**：导入一份**已经带号**、且号**不连续**的备份，
 *      号必须**原样保留**（`renumbered === 0`），而不是被重新分配。
 *
 * ── 为什么单独建文件，不并进 `task-no.roundtrip.spec.ts` ──
 *   既有 spec 的三处覆盖**都是间接的**，本文件把它们补成「直接断言 + 可定位失败」：
 *     · ① 既有 spec 用 `JSON.stringify(整表)` 比对 —— 能抓到，但失败信息是一个
 *       几百字符的字符串，得人肉找哪一格变了；
 *     · ② 既有 spec**完全没有**键序断言，只是被 stringify 相等**顺带**覆盖；
 *       一旦有人在 `normalizeTaskRow` 里挪一格键，失败信息不会告诉你是键序问题；
 *     · ③ 既有 spec 只测了「自己导出自己」（号本来就是从 1000 连续发的），
 *       **没有**「外部导入一份带号备份」的用例 —— 而那正是「永不复用」承诺的兑现点。
 *
 * ── 一条必须绕开的坑（本地适配器专有）──
 *   `local.admin.repo` 落库时会**删掉**值为 null/undefined 的 `externalId` 键
 *   （null 不是合法 IDB key），导出侧再由 zod 补回 null。故：
 *     · 比对字段时按 `JSON.stringify` 逐值比（undefined 与「无此键」等价，不会误报）；
 *     · 比对键序时必须**先滤掉 undefined 值的键**，否则「导入前有键、导入后无键」
 *       会伪装成键序漂移。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { BackupService, validateBackupJson } from '../src/core/services/backup.service';
import { TASK_NO_SEQ_KEY, formatTaskNo } from '../src/core/lib/task-no';
import type { BackupPackage } from '../src/core/types/dto';
import type { Project, Task } from '../src/core/types/entities';
import { ProjectStatus, ScheduleBasis, TaskStatus } from '../src/core/types/enums';
import { emptyPackage } from './helpers/backup-fixture';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // vitest 是 singleThread：同进程内其它 spec 可能留了行。先空包清库，
  // 否则「导出 == 自己 seed 的内容」这类断言会被外来行带偏。
  await bundle.admin?.replaceAllImport(emptyPackage());
});

/** 组装一个备份包（meta 恒 v3，与既有 spec 同款） */
function pack(data: Partial<BackupPackage['data']>): BackupPackage {
  return {
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      ...emptyPackage().data,
      ...data,
    },
  };
}

/**
 * 一条项目行（full Project 形状；`Project.type` 已删除，故不再带该键）。
 * 仅作容器，本 spec 的断言聚焦 taskNo 保真，不依赖项目任何具体字段。
 */
function projectRow(id: string): Project {
  return {
    id,
    name: `项目 ${id}`,
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-08-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: null,
    kind: 'human',
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

/** 一条**带号**任务行（full Task 形状，显式 `taskNo`；其余字段走 zod 的 `.default()`） */
function taskRow(id: string, taskNo: number | null, orderIndex = 1): Task {
  return {
    id,
    taskNo,
    projectId: 'p1',
    stageId: 's1',
    title: `任务 ${id}`,
    done: false,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'human',
    externalId: null,
    agentId: null,
    status: TaskStatus.Draft,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    orderIndex,
    revision: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function seedProject(id = 'p1'): Promise<unknown> {
  return bundle.projects.insert({
    id,
    name: `项目 ${id}`,
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-08-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
  });
}

function insertTask(title: string): Promise<Task> {
  return bundle.tasks.insert({ projectId: 'p1', stageId: 's1', title, assigneeId: null, dueDate: null });
}

async function readSeq(): Promise<number | null> {
  const raw = await bundle.settings.get<number>(TASK_NO_SEQ_KEY);
  return typeof raw === 'number' ? raw : null;
}

/* ------------------------------- 规范键序（五处键序铁律的落点） ------------------------------- */

/**
 * `entities.Task` / `backup.taskSchema` / `normalizeTaskRow` / `local.tasks.repo.insert` /
 * `project.service.taskRows` —— **五处**必须逐字同序。此处锁第 6 处（断言侧）。
 */
const CANONICAL_TASK_KEYS = [
  'id',
  'taskNo',
  'projectId',
  'stageId',
  'title',
  'done',
  'assigneeId',
  'assigneeIds',
  'dueDate',
  // v0.9 旅游二期：itineraryDate 插在 dueDate 之后、source 之前（与 entities.Task 同步）
  'itineraryDate',
  'source',
  'externalId',
  'agentId',
  'status',
  'description',
  'dependsOn',
  'artifacts',
  'startAt',
  'claimedAt',
  'orderIndex',
  'revision',
  'updatedAt',
];

/** 同款：项目行的规范键序 */
const CANONICAL_PROJECT_KEYS = [
  'id',
  'name',
  'type',
  'address',
  'clientName',
  'contractAmount',
  'signedAt',
  'plannedStartAt',
  'plannedEndAt',
  'coverColor',
  'shortLabel',
  'stagePresetKey',
  'stageTemplateVersion',
  'scheduleBasis',
  // v0.8：Project 链新增两列，插在 scheduleBasis 之后、status 之前（§3.3 Project 链插入位置）
  'domain',
  'kind',
  'status',
  'revision',
  'updatedAt',
];

/** 取出**实际存在的**键（滤掉值为 undefined 的键，见文件头「必须绕开的坑」） */
function presentKeys(row: unknown): string[] {
  const o = row as Record<string, unknown>;
  return Object.keys(o).filter((k) => o[k] !== undefined);
}

/** `actual` 是否为 `canonical` 的**保序子序列**（允许缺键，但不允许乱序 / 多出未知键） */
function isOrderPreservingSubsequence(actual: string[], canonical: string[]): boolean {
  let i = 0;
  for (const k of actual) {
    const at = canonical.indexOf(k, i);
    if (at === -1) return false; // 未知键，或顺序倒了
    i = at + 1;
  }
  return true;
}

/** 逐字段比对，返回**人可读**的差异列表（空数组 = 完全一致） */
function fieldDiffs(before: unknown, after: unknown): string[] {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out: string[] = [];
  for (const k of keys) {
    const bv = JSON.stringify(b[k]);
    const av = JSON.stringify(a[k]);
    // 注：`JSON.stringify(undefined) === undefined`（不是字符串），
    // 故「键值为 undefined」与「无此键」在此判定下等价 —— 正是我们要的（见文件头）。
    if (bv !== av) out.push(`${k}: 往返前=${bv} 往返后=${av}`);
  }
  return out;
}

/** 走真实服务路径：zod 归一 → 落库，并返回 `renumbered`（服务层丢掉了该返回值） */
async function importAndCount(pkg: BackupPackage): Promise<number> {
  const normalized = validateBackupJson(pkg);
  const res = await bundle.admin!.replaceAllImport(normalized);
  return res.renumbered;
}

/* ----------------------------------------- ① 逐字段 ----------------------------------------- */

describe('① 备份往返：逐字段一致（失败时按字段名定位）', () => {
  it('导出 → 导入 → 再导出：每个任务的每个字段值都不变（含 taskNo）', async () => {
    await seedProject('p1');
    const a = await insertTask('任务 A');
    const b = await insertTask('任务 B');
    const c = await insertTask('任务 C');
    expect([a.taskNo, b.taskNo, c.taskNo]).toEqual([1000, 1001, 1002]);

    const svc = new BackupService(bundle);
    const before = await svc.exportAll();
    await svc.importAndReplace(before);
    const after = await svc.exportAll();

    expect(after.data.tasks).toHaveLength(before.data.tasks.length);

    const beforeById = new Map(before.data.tasks.map((t) => [t.id, t]));
    const allDiffs: string[] = [];
    for (const t of after.data.tasks) {
      const src = beforeById.get(t.id);
      expect(src).toBeDefined();
      // ★ 逐字段：任何一格漂移都会以「字段名: 前值 后值」的形式报出来
      const diffs = fieldDiffs(src, t);
      if (diffs.length > 0) allDiffs.push(`任务 ${t.id} → ${diffs.join('; ')}`);
    }
    expect(allDiffs).toEqual([]);
  });

  it('八张表行数不变，且任务表/项目表逐字段一致（不只抽查任务）', async () => {
    await seedProject('p1');
    await insertTask('任务 A');
    await insertTask('任务 B');

    const svc = new BackupService(bundle);
    const before = await svc.exportAll();
    await svc.importAndReplace(before);
    const after = await svc.exportAll();

    const tables = [
      'projects',
      'stages',
      'tasks',
      'members',
      'assignments',
      'logs',
      'contracts',
      'settings',
    ] as const;

    const countDiffs: string[] = [];
    for (const t of tables) {
      if (before.data[t].length !== after.data[t].length) {
        countDiffs.push(`${t}: ${before.data[t].length} → ${after.data[t].length}`);
      }
    }
    expect(countDiffs).toEqual([]);

    // 项目表逐字段
    const beforeProj = new Map(before.data.projects.map((p) => [p.id, p]));
    const projDiffs: string[] = [];
    for (const p of after.data.projects) {
      const d = fieldDiffs(beforeProj.get(p.id), p);
      if (d.length > 0) projDiffs.push(`项目 ${p.id} → ${d.join('; ')}`);
    }
    expect(projDiffs).toEqual([]);

    // 任务表逐字段
    const beforeTask = new Map(before.data.tasks.map((t) => [t.id, t]));
    const taskDiffs: string[] = [];
    for (const t of after.data.tasks) {
      const d = fieldDiffs(beforeTask.get(t.id), t);
      if (d.length > 0) taskDiffs.push(`任务 ${t.id} → ${d.join('; ')}`);
    }
    expect(taskDiffs).toEqual([]);
  });
});

/* ------------------------------------------ ② 键序 ------------------------------------------ */

describe('② 键序稳定：往返前后每一行的键顺序逐字相同，且是规范序的子序列', () => {
  it('任务行：键序往返不变，且与「五处键序铁律」同序', async () => {
    await seedProject('p1');
    await insertTask('任务 A');
    await insertTask('任务 B');

    const svc = new BackupService(bundle);
    const before = await svc.exportAll();
    await svc.importAndReplace(before);
    const after = await svc.exportAll();

    const beforeById = new Map(before.data.tasks.map((t) => [t.id, t]));
    expect(after.data.tasks.length).toBeGreaterThan(0);

    for (const t of after.data.tasks) {
      const keysBefore = presentKeys(beforeById.get(t.id));
      const keysAfter = presentKeys(t);
      // ★ 核心断言：键序逐字相同（任一格挪位即失败，且失败信息直接是键数组）
      expect(keysAfter, `任务 ${t.id} 的键序在往返后发生漂移`).toEqual(keysBefore);
      // 且必须是规范序的保序子序列（防止「两边一起乱成同样的序」骗过上一条）
      expect(
        isOrderPreservingSubsequence(keysAfter, CANONICAL_TASK_KEYS),
        `任务 ${t.id} 的键序不符合规范序：${keysAfter.join(',')}`,
      ).toBe(true);
      // taskNo 必须紧接 id 之后（v0.7 的「第 2 处落点」）
      expect(keysAfter[0]).toBe('id');
      expect(keysAfter[1]).toBe('taskNo');
    }
  });

  it('项目行：键序往返不变，且与规范序同序', async () => {
    await seedProject('p1');

    const svc = new BackupService(bundle);
    const before = await svc.exportAll();
    await svc.importAndReplace(before);
    const after = await svc.exportAll();

    const beforeById = new Map(before.data.projects.map((p) => [p.id, p]));
    expect(after.data.projects.length).toBeGreaterThan(0);

    for (const p of after.data.projects) {
      const keysBefore = presentKeys(beforeById.get(p.id));
      const keysAfter = presentKeys(p);
      expect(keysAfter, `项目 ${p.id} 的键序在往返后发生漂移`).toEqual(keysBefore);
      expect(
        isOrderPreservingSubsequence(keysAfter, CANONICAL_PROJECT_KEYS),
        `项目 ${p.id} 的键序不符合规范序：${keysAfter.join(',')}`,
      ).toBe(true);
    }
  });
});

/* ------------------------------------- ③ 前导 taskNo 不被改写 ------------------------------------- */

describe('③ 前导 taskNo：导入带号备份后号原样保留（不撞号就绝不重编号）', () => {
  it('导入**不连续**的前导号（1005/1010/1020）→ 逐条保留，renumbered === 0', async () => {
    const pkg = pack({
      projects: [projectRow('p1')],
      tasks: [
        taskRow('t1', 1005, 1),
        taskRow('t2', 1010, 2),
        taskRow('t3', 1020, 3),
      ],
    });

    const renumbered = await importAndCount(pkg);
    expect(renumbered).toBe(0);

    const stored = await bundle.tasks.listByProject('p1');
    const byId = new Map(stored.map((t) => [t.id, t.taskNo]));
    expect(byId.get('t1')).toBe(1005);
    expect(byId.get('t2')).toBe(1010);
    expect(byId.get('t3')).toBe(1020);

    // 展示串也守住（号变了这里最先炸）
    expect([byId.get('t1'), byId.get('t2'), byId.get('t3')].map(formatTaskNo)).toEqual([
      'T-1005',
      'T-1010',
      'T-1020',
    ]);
  });

  it('导入前导号后，本地计数器被抬到 max+1（下一次新建不与包内号相撞）', async () => {
    await importAndCount(
      pack({
        projects: [projectRow('p1')],
        tasks: [taskRow('t1', 1005, 1), taskRow('t2', 1010, 2), taskRow('t3', 1020, 3)],
        settings: [
          { key: TASK_NO_SEQ_KEY, valueJson: '1021', updatedAt: '2026-08-01T00:00:00.000Z' },
        ],
      }),
    );

    const fresh = await insertTask('前导号之后新建');
    expect(fresh.taskNo).toBe(1021);
    // 且包内的三个号一个都没被动过
    const nos = (await bundle.tasks.listByProject('p1'))
      .map((t) => t.taskNo)
      .filter((n): n is number => typeof n === 'number')
      .sort((x, y) => x - y);
    expect(nos).toEqual([1005, 1010, 1020, 1021]);
  });

  it('★ 本地计数器落后于包内号时，导入后号仍原样保留（不被拉回重编号）', async () => {
    // 本机只发到 1000
    await bundle.settings.set(TASK_NO_SEQ_KEY, 1000);

    const renumbered = await importAndCount(
      pack({
        projects: [projectRow('p1')],
        tasks: [taskRow('t1', 1500, 1), taskRow('t2', 1501, 2)],
      }),
    );

    expect(renumbered).toBe(0);
    const byId = new Map((await bundle.tasks.listByProject('p1')).map((t) => [t.id, t.taskNo]));
    expect(byId.get('t1')).toBe(1500);
    expect(byId.get('t2')).toBe(1501);

    // 计数器三者取最大 → 1502（包内 max+1 胜出），不被本地 1000 拉回
    expect(await readSeq()).toBeNull(); // 包内无 seq 行 → 不凭空发明一行
    expect((await insertTask('落后本地之后新建')).taskNo).toBe(1502);
  });
});
