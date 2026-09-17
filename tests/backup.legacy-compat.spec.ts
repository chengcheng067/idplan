/**
 * 旧备份兼容（ID Plan v0.2 增量架构 4.2 表）：
 *   1. v0.1.0 旧备份（members 无 roleKind）→ validateBackupJson 通过，
 *      且每成员归一 roleKind==='member'（zod .default() 归一，非裸 optional）；
 *   2. 导入后 list(true) 每成员带 roleKind，运行时不会 undefined；
 *   3. 新备份含 roleKind=admin → roundtrip 保真；
 *   4. roleKind 非法值（如 'super'）→ 拒绝抛 Validation；
 *   5. backupFileName 前缀 id-plan-backup-*（改名后用户可见物，抽纯函数可测）。
 * 运行于 node 环境（与既有 spec 一致；jsdom 在本机安装损坏，故下载名走纯函数断言）。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import {
  BackupService,
  backupFileName,
  validateBackupJson,
} from '../src/core/services/backup.service';
import type { BackupPackage } from '../src/core/types/dto';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // fake-indexeddb 同 module 实例共享同名库（'changxia'）——每次用空包清库重建保证隔离
  await bundle.admin?.replaceAllImport(emptyPackage());
});

function emptyPackage(): BackupPackage {
  return {
    meta: { app: 'changxia', schemaVersion: 1, exportedAt: '2026-08-01T00:00:00.000Z' },
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

/** 造一份「旧版」备份包：members 无 roleKind 字段，tasks 无 assigneeIds 字段，其余表为空 */
function legacyPackage(overrides?: {
  members?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  const members = overrides?.members ?? [
    {
      id: 'mem_legacy_1',
      name: '许工',
      role: '主案',
      contact: null,
      avatarColor: '#3D6B5B',
      active: true,
      revision: 1,
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  ];
  const tasks = overrides?.tasks ?? [];
  return {
    meta: { app: 'changxia', schemaVersion: 1, exportedAt: '2026-08-01T00:00:00.000Z' },
    data: {
      projects: [],
      stages: [],
      tasks,
      members,
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
    },
  };
}

describe('backup：旧备份（members 无 roleKind）兼容', () => {
  it('validateBackupJson 通过且每成员归一 roleKind==="member"', () => {
    const pkg = legacyPackage();
    const parsed = validateBackupJson(pkg);
    expect(parsed.data.members).toHaveLength(1);
    expect(parsed.data.members[0]).toMatchObject({ name: '许工' });
    // .default('member') 在校验阶段即归一，导入后每行必有显式 roleKind
    expect(parsed.data.members[0].roleKind).toBe('member');
  });

  it('导入后 list(true) 每成员带 roleKind（运行时不会 undefined）', async () => {
    const pkg = legacyPackage() as unknown as BackupPackage;
    const svc = new BackupService(bundle);
    await svc.importAndReplace(pkg);
    const rows = await bundle.members.list(true);
    expect(rows).toHaveLength(1);
    for (const m of rows) {
      expect(m.roleKind).toBe('member');
    }
    // 成员可正常按姓名匹配（姓名匹配是进入身份的主路径）
    expect(rows[0]!.name).toBe('许工');
  });

  it('新备份含 roleKind=admin → 导出→导入→导出 roundtrip 保真', async () => {
    const pkg = legacyPackage({
      members: [
        {
          id: 'mem_admin_1',
          name: '齐活林',
          role: '设计师',
          contact: null,
          avatarColor: '#2C3E50',
          active: true,
          roleKind: 'admin',
          revision: 1,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    }) as unknown as BackupPackage;
    const svc = new BackupService(bundle);
    await svc.importAndReplace(pkg);

    const exported1 = await svc.exportAll();
    expect(exported1.data.members[0]!.roleKind).toBe('admin');

    await svc.importAndReplace(exported1);
    const exported2 = await svc.exportAll();
    expect(exported2.data.members[0]!.roleKind).toBe('admin');
    // hasAdmin 判定依赖 roleKind：导入后仍是管理员
    const rows = await bundle.members.list(true);
    expect(rows.some((m) => m.active && m.roleKind === 'admin')).toBe(true);
  });

  it('roleKind 非法值（如 super）→ 拒绝抛 Validation', () => {
    const pkg = legacyPackage({
      members: [
        {
          id: 'mem_bad_1',
          name: '越权者',
          role: '',
          contact: null,
          avatarColor: '#3D6B5B',
          active: true,
          roleKind: 'super',
          revision: 1,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });
    expect(() => validateBackupJson(pkg)).toThrowError(/校验失败/);
  });

  it('meta.app 保持 changxia：改名不破坏硬校验（数据兼容四点之一）', () => {
    const pkg = legacyPackage();
    const parsed = validateBackupJson(pkg);
    expect(parsed.meta.app).toBe('changxia');
    expect(parsed.meta.schemaVersion).toBe(1);
  });

  // ------------------- v0.3：tasks 无 assigneeIds 旧包兼容 + 键序不变式 -------------------

  it('旧备份 tasks 无 assigneeIds → 校验通过且归一 []（zod .default 补齐）', () => {
    const pkg = legacyPackage({
      tasks: [
        {
          id: 'tsk_legacy_1',
          projectId: 'proj_1',
          stageId: 'stg_1',
          title: '量房',
          done: false,
          assigneeId: 'mem_legacy_1',
          dueDate: '2026-08-10',
          orderIndex: 1,
          revision: 1,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });
    const parsed = validateBackupJson(pkg);
    expect(parsed.data.tasks).toHaveLength(1);
    // 归一产物显式带 assigneeIds=[]（而非 undefined）
    expect(parsed.data.tasks[0]).toMatchObject({ id: 'tsk_legacy_1', assigneeId: 'mem_legacy_1' });
    expect(parsed.data.tasks[0].assigneeIds).toEqual([]);
  });

  it('旧备份 tasks 无 assigneeIds → 导入后 DB 行每任务带 assigneeIds=[]（运行时不会 undefined）', async () => {
    const pkg = legacyPackage({
      tasks: [
        {
          id: 'tsk_legacy_2',
          projectId: 'proj_1',
          stageId: 'stg_1',
          title: '水电交底',
          done: false,
          assigneeId: 'mem_legacy_1',
          dueDate: '2026-08-12',
          orderIndex: 1,
          revision: 1,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    }) as unknown as BackupPackage;
    const svc = new BackupService(bundle);
    await svc.importAndReplace(pkg);
    const rows = await bundle.tasks.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assigneeIds).toEqual([]);
    // 运行时 taskAssigneeIds 回落 assigneeId → listByAssignee 参与人语义命中
    const mine = await bundle.tasks.listByAssignee('mem_legacy_1');
    expect(mine.map((t) => t.id)).toEqual(['tsk_legacy_2']);
  });

  it('旧备份 tasks 无 assigneeIds → 再导出 diff 为空（键序对齐成立）', async () => {
    const pkg = legacyPackage({
      tasks: [
        {
          id: 'tsk_legacy_3',
          projectId: 'proj_1',
          stageId: 'stg_1',
          title: '主材清单',
          done: false,
          assigneeId: null,
          dueDate: '2026-08-15',
          orderIndex: 1,
          revision: 1,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    }) as unknown as BackupPackage;
    const svc = new BackupService(bundle);
    await svc.importAndReplace(pkg);

    const exported1 = await svc.exportAll();
    expect(exported1.data.tasks[0]!.assigneeIds).toEqual([]);

    await svc.importAndReplace(exported1);
    const exported2 = await svc.exportAll();
    expect(normalizeTasks(exported2)).toBe(normalizeTasks(exported1));
  });

  it('含多值 assigneeIds 的新备份 → 导出→导入→导出 多值集合与键序保真', async () => {
    const pkg = legacyPackage({
      tasks: [
        {
          id: 'tsk_multi_1',
          projectId: 'proj_1',
          stageId: 'stg_1',
          title: '现场交底',
          done: false,
          assigneeId: 'mem_legacy_1',
          assigneeIds: ['mem_legacy_1', 'mem_legacy_2'],
          dueDate: '2026-08-20',
          orderIndex: 1,
          revision: 1,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    }) as unknown as BackupPackage;
    const svc = new BackupService(bundle);
    await svc.importAndReplace(pkg);
    const exported1 = await svc.exportAll();
    expect(exported1.data.tasks[0]!.assigneeIds).toEqual(['mem_legacy_1', 'mem_legacy_2']);
    // 参与人包含语义：任一参与人 listByAssignee 均命中
    const mine = await bundle.tasks.listByAssignee('mem_legacy_2');
    expect(mine.map((t) => t.id)).toEqual(['tsk_multi_1']);

    await svc.importAndReplace(exported1);
    const exported2 = await svc.exportAll();
    expect(normalizeTasks(exported2)).toBe(normalizeTasks(exported1));
  });
});

describe('backup：下载文件名（改名 ID Plan 后）', () => {
  it('backupFileName 以 id-plan-backup- 开头且含时间戳', () => {
    const name = backupFileName(new Date('2026-09-01T08:30:00.000Z'));
    expect(name).toMatch(/^id-plan-backup-\d{12}\.json$/);
    expect(name.startsWith('id-plan-backup-')).toBe(true);
  });

  it('exportAll 产物 members 每项带 roleKind（roundtrip 不变式支撑）', async () => {
    await bundle.members.insert({
      name: '许工',
      role: '主案',
      contact: null,
      avatarColor: '#3D6B5B',
    });
    const svc = new BackupService(bundle);
    const pkg = await svc.exportAll();
    const members = pkg.data.members;
    expect(members).toHaveLength(1);
    expect(members[0]!.roleKind).toBe('member');
  });
});

/**
 * 「类型」字段（`Project.type`）删除后的**老备份兼容**。
 *
 * ── 为什么这组必须有 ──
 * `Project.type` 已按用户决策整条删除（它把业态与设计专业混在一个原生 select 里，
 * 且默认 Dining 与三层级联的默认 indoor 各自独立、互不相干）。
 * 但**老备份（v0.7 及更早）里每一行 project 都带这个键**。
 * 若备份 schema 把它写成必填，老用户一导入就是**整包被拒**——那不是少一个标签，
 * 是**数据全丢**。所以「删字段」这件事唯一可能造成数据丢失的入口就在这里，必须由测试钉住。
 *
 * 判据三条：① 校验不得拒；② 落库后实体**不再有** type 键（显式剥离，不留半拉子）；
 * ③ 导出→导入→导出往返保真，且导出产物里也不再有 type。
 */
describe('backup：删除「类型」字段后仍兼容含 type 的老备份', () => {
  /** 老备份（v0.7 及更早）的 project 行 —— ★ **带 `type` 键**，这正是本组要考的东西 */
  function legacyProjectRow(): Record<string, unknown> {
    return {
      id: 'proj_legacy_type',
      name: '含类型字段的老项目',
      type: 'dining',
      address: '成都',
      clientName: '林女士',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-03-01',
      plannedEndAt: '2026-03-31',
      coverColor: null,
      status: 'active',
      revision: 1,
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  function pkgWithLegacyProject(): Record<string, unknown> {
    const base = legacyPackage();
    return {
      ...base,
      data: {
        ...(base.data as Record<string, unknown>),
        projects: [legacyProjectRow()],
      },
    };
  }

  it('校验必须通过（含 type 的老备份不得被拒）', () => {
    expect(() => validateBackupJson(pkgWithLegacyProject())).not.toThrow();
  });

  it('导入成功，且落库后的 Project 行**不再有** type 键', async () => {
    const svc = new BackupService(bundle);
    await svc.importAndReplace(pkgWithLegacyProject() as unknown as BackupPackage);

    const p = await bundle.projects.get('proj_legacy_type');
    expect(p).toBeTruthy();
    // 显式剥离：实体上不得残留已被删除的字段（否则「四处键序一致」立刻被打破）
    expect(Object.keys(p as object)).not.toContain('type');
  });

  it('导出→导入→导出 roundtrip 保真（导出也不再带 type，往返不抖）', async () => {
    const svc = new BackupService(bundle);
    await svc.importAndReplace(pkgWithLegacyProject() as unknown as BackupPackage);

    const exported1 = await svc.exportAll();
    expect(exported1.data.projects).toHaveLength(1);
    expect(Object.keys(exported1.data.projects[0] as object)).not.toContain('type');

    await svc.importAndReplace(exported1);
    const exported2 = await svc.exportAll();
    const strip = (p: BackupPackage): string =>
      JSON.stringify(
        JSON.parse(
          JSON.stringify(p.data.projects, (k, v) => (k === 'exportedAt' ? undefined : v)),
        ),
      );
    expect(strip(exported2)).toBe(strip(exported1));
  });
});

/** 键序 diff：只比较 tasks 表（含 assigneeIds），剔除 exportedAt 与数组顺序 */
function normalizeTasks(pkg: BackupPackage): string {
  const p = JSON.parse(
    JSON.stringify(pkg, (key, value) => (key === 'exportedAt' ? undefined : value)),
  ) as BackupPackage;
  p.data.tasks.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify(p.data.tasks);
}
