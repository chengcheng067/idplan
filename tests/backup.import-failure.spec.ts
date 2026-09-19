/**
 * 备份导入失败路径（增量架构 4.3 手工回归重点 2 的自动化补充）：
 *   validateBackupJson 预检失败（坏 JSON 结构 / meta.app 错 / roleKind 非法）
 *   → importAndReplace 拒绝且库零写入（绝不半套写入）。
 * 运行于 node 环境（与 backup.legacy-compat.spec.ts 一致）。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { BackupService, validateBackupJson } from '../src/core/services/backup.service';
import type { BackupPackage } from '../src/core/types/dto';
import { emptyPackage } from './helpers/backup-fixture';

let bundle: IRepositoryBundle;
let svc: BackupService;

/** 预置 1 个项目 + 1 个成员，作为「导入前库内容」基线 */
async function seedBaseline(): Promise<void> {
  await bundle.projects.insert({
    name: '某茶空间',
    address: '上海',
    clientName: '客户A',
    contractAmount: 100000,
    signedAt: '2026-08-01T00:00:00.000Z',
    plannedStartAt: '2026-09-01',
    plannedEndAt: '2026-12-01',
    coverColor: null,
    status: 'active',
  });
  await bundle.members.insert({ name: '许工', role: '主案', contact: null, avatarColor: '#3D6B5B' });
}

async function snapshotCounts(): Promise<{ projects: number; members: number }> {
  const projects = await bundle.projects.list({ status: 'all' });
  const members = await bundle.members.list(true);
  return { projects: projects.length, members: members.length };
}

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // 清库重建保证隔离
  await bundle.admin?.replaceAllImport(emptyPackage(1));
  await seedBaseline();
  svc = new BackupService(bundle);
});

describe('backup 导入失败路径：预检失败 → 拒绝且零写入', () => {
  it('坏 JSON 结构（缺 data 表 / 顶层非对象）→ validateBackupJson 抛，库不变', async () => {
    const before = await snapshotCounts();

    // 顶层缺 data 字段
    const badShape = { meta: { app: 'changxia', schemaVersion: 1, exportedAt: 'x' } };
    expect(() => validateBackupJson(badShape)).toThrowError(/校验失败/);

    // data 缺表
    const badTables = {
      meta: { app: 'changxia', schemaVersion: 1, exportedAt: 'x' },
      data: { projects: [] },
    };
    expect(() => validateBackupJson(badTables)).toThrowError(/校验失败/);

    // 非对象（JSON.parse 成功但语义非法）
    expect(() => validateBackupJson('not-an-object')).toThrowError(/校验失败/);

    // importAndReplace 同路径拒绝
    await expect(svc.importAndReplace(badShape as unknown as BackupPackage)).rejects.toThrow();

    const after = await snapshotCounts();
    expect(after).toEqual(before); // 零写入：项目/成员均未被清空或改动
  });

  it('meta.app 非 changxia（改名风险点）→ 拒绝且库不变', async () => {
    const before = await snapshotCounts();
    const pkg = emptyPackage(1);
    // 模拟误用新名导出：meta.app 是契约字面量 'changxia'，这里刻意写入非法值来测运行期拒绝，
    // 故仅对 app 字段做局部放宽（不削弱断言、不改 reject 语义）。
    (pkg.meta as { app: string }).app = 'id-plan';
    await expect(svc.importAndReplace(pkg)).rejects.toThrow();
    const after = await snapshotCounts();
    expect(after).toEqual(before);
  });

  it('members.roleKind 非法值（如 super）→ 拒绝且库不变', async () => {
    const before = await snapshotCounts();
    const pkg = emptyPackage(1);
    pkg.data.members = [
      {
        id: 'mem_bad',
        name: '越权者',
        role: '',
        contact: null,
        avatarColor: '#3D6B5B',
        active: true,
        roleKind: 'super',
        revision: 1,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ] as never;
    await expect(svc.importAndReplace(pkg)).rejects.toThrow();
    const after = await snapshotCounts();
    expect(after).toEqual(before);
  });

  it('对照：合法包导入成功 → 库被整体替换（证明失败路径不是永远拒绝）', async () => {
    const pkg = emptyPackage(1);
    pkg.data.projects = [
      {
        id: 'p_imported',
        name: '导入项目',
        type: 'commercial',
        address: '',
        clientName: '',
        contractAmount: null,
        signedAt: null,
        plannedStartAt: '2026-09-01',
        plannedEndAt: '2026-12-01',
        coverColor: null,
        status: 'active',
        revision: 1,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ] as never;
    await svc.importAndReplace(pkg);
    const after = await snapshotCounts();
    expect(after).toEqual({ projects: 1, members: 0 }); // 旧数据被替换，且只有导入的 1 个项目
    const projects = await bundle.projects.list({ status: 'all' });
    expect(projects[0]!.id).toBe('p_imported');
  });
});
