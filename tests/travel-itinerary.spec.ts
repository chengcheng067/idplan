/**
 * 旅游二期数据底座行为测试（v0.9）。
 *
 * 锁四件事：
 *   1. 创建 travel 项目 → 按 plannedStartAt/plannedEndAt 生成连续每日卡（含首尾日）；
 *   2. ensureProjectDays **只补不删**：扩展日期补新卡；缩小日期后旧行（含有内容行）保留；
 *   3. 备份导出含 itineraries，导入往返保真；旧包缺 itineraries 键 → 安全归一 [] 不崩；
 *   4. store 的 updateProject 对 travel 项目改期 → 自动补卡；非 travel 项目零行程副作用。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { BackupService, validateBackupJson } from '../src/core/services/backup.service';
import { ProjectService } from '../src/core/services/project.service';
import { createProjectActions, useProjectsStore } from '../src/store/useProjectsStore';
import { getPresetItems } from '../src/core/template/stage-library';
import type { BackupPackage } from '../src/core/types/dto';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport(emptyPackage());
});

afterEach(async () => {
  await bundle.admin?.replaceAllImport(emptyPackage());
});

function emptyPackage(): BackupPackage {
  return {
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-09-17T00:00:00.000Z' },
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

async function seedTravelProject(startAt = '2026-10-01', endAt = '2026-10-08'): Promise<string> {
  const projects = new ProjectService({ projects: bundle.projects, bundle });
  // 短区间（如 2 天小旅行）时用 2 段的自定义阶段组合，避免阶段切分"每天至少 1 段"约束
  const spanDays = Math.round((Date.parse(endAt) - Date.parse(startAt)) / 86400000) + 1;
  const items = spanDays < 6
    ? getPresetItems('travel_fit').slice(0, 2)
    : getPresetItems('travel_fit');
  const project = await projects.createManualProject({
    name: '九寨沟自由行',
    address: '阿坝州',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: startAt,
    plannedEndAt: endAt,
    coverColor: null,
    domain: 'travel',
    stagePresetKey: 'travel_fit',
    stageItems: items,
  });
  return project.id;
}

function eachDate(startAt: string, endAt: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${startAt}T00:00:00Z`); d <= new Date(`${endAt}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

describe('旅游二期 · 每日行程', () => {
  it('创建 travel 项目自动生成连续每日卡（含首尾日）', async () => {
    const projectId = await seedTravelProject('2026-10-01', '2026-10-03');
    const days = await bundle.itineraries.listByProject(projectId);
    expect(days.map((d) => d.date)).toEqual(eachDate('2026-10-01', '2026-10-03'));
    expect(days[0]).toMatchObject({ transport: null, accommodation: null, budgetAmount: null, actualAmount: null });
  });

  it('非 travel 项目不生成任何行程卡', async () => {
    const projects = new ProjectService({ projects: bundle.projects, bundle });
    const project = await projects.createManualProject({
      name: '普通茶空间',
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-10-01',
      plannedEndAt: '2026-10-09',
      coverColor: null,
    });
    expect(await bundle.itineraries.listByProject(project.id)).toEqual([]);
  });

  it('ensureProjectDays 只补不删：扩展日期补新卡，缩小日期旧行（含有内容行）保留', async () => {
    const projectId = await seedTravelProject('2026-10-01', '2026-10-03');

    // 扩展到 10-05 → 补 10-04、10-05
    await bundle.itineraries.ensureProjectDays(projectId, '2026-10-01', '2026-10-05');
    let days = await bundle.itineraries.listByProject(projectId);
    expect(days.map((d) => d.date)).toEqual(eachDate('2026-10-01', '2026-10-05'));

    // 给 10-05 填内容，再缩小到 10-02 → 全部保留
    const last = days[days.length - 1]!;
    await bundle.itineraries.update(last.id, { transport: '返程高铁', budgetAmount: 500 });
    await bundle.itineraries.ensureProjectDays(projectId, '2026-10-02', '2026-10-02');
    days = await bundle.itineraries.listByProject(projectId);
    expect(days.map((d) => d.date)).toEqual(eachDate('2026-10-01', '2026-10-05'));
    expect(days[days.length - 1]).toMatchObject({ transport: '返程高铁', budgetAmount: 500 });
  });

  it('备份导出含 itineraries，往返保真', async () => {
    const projectId = await seedTravelProject('2026-10-01', '2026-10-02');
    const days = await bundle.itineraries.listByProject(projectId);
    await bundle.itineraries.update(days[0]!.id, { accommodation: '沟口酒店', budgetAmount: 800, actualAmount: 760 });

    const svc = new BackupService(bundle);
    const exported = await svc.exportAll();
    expect(exported.data.itineraries).toHaveLength(2);
    expect(exported.data.itineraries.find((d) => d.date === '2026-10-01')).toMatchObject({
      accommodation: '沟口酒店',
      budgetAmount: 800,
      actualAmount: 760,
    });

    await svc.importAndReplace(exported);
    const reexported = await svc.exportAll();
    expect(reexported.data.itineraries).toEqual(exported.data.itineraries);
  });

  it('旧备份缺 itineraries 键 → 校验归一为 []，导入不崩', async () => {
    // v3 时代的包没有 itineraries 键（zod .default([]) 归一）
    const legacy = {
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
    const normalized = validateBackupJson(legacy);
    expect(normalized.data.itineraries).toEqual([]);

    const svc = new BackupService(bundle);
    await svc.importAndReplace(normalized); // 不抛 = 通过
  });

  it('store.updateProject 对 travel 项目改期 → 只补新增日期卡', async () => {
    const projectId = await seedTravelProject('2026-10-01', '2026-10-03');
    const actions = createProjectActions(bundle);
    await actions.updateProject(projectId, { plannedEndAt: '2026-10-04T00:00:00Z' });

    const days = await bundle.itineraries.listByProject(projectId);
    expect(days.map((d) => d.date)).toEqual(eachDate('2026-10-01', '2026-10-04'));
    // store 镜像也更新了
    expect(useProjectsStore.getState().projectById(projectId)?.plannedEndAt).toContain('2026-10-04');
  });

  it('domain=null 但 stagePresetKey=travel_fit 的存量项目改期也会补卡', async () => {
    const projectId = await seedTravelProject('2026-10-01', '2026-10-03');
    const project = await bundle.projects.get(projectId);
    expect(project).not.toBeNull();
    await bundle.projects.update(projectId, { domain: null });
    useProjectsStore.getState().putProject({ ...project!, domain: null, stagePresetKey: 'travel_fit' });

    const actions = createProjectActions(bundle);
    await actions.updateProject(projectId, { plannedEndAt: '2026-10-05T00:00:00Z' });

    const days = await bundle.itineraries.listByProject(projectId);
    expect(days.map((d) => d.date)).toEqual(eachDate('2026-10-01', '2026-10-05'));
  });
});
