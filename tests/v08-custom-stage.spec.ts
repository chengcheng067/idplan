/**
 * v0.8 · T03 验收（二）：自定义阶段的**持久化面**（fake-indexeddb ＋ 真仓储，不 mock）。
 *
 * 覆盖设计 §8 T03 的验收 **6 / 8 / 10 / 11**（验收 1–5 / 7 / 9 在 `v08-stage-wizard.spec.tsx`）：
 *
 *   6.  新增「消防报审」→ 落库 `templateKey === null`、`customColor` 按选择落值、落列不崩；
 *   8.  `CUSTOM_STAGES_PERSIST_ACROSS_PROJECTS = false` ⇒ `listReusableCustomStages()` 恒 `[]`
 *       （TS-07 的「一行回退」——回退点只有一处，**不改任何组件**）；
 *   10. 持久化往返（TBD-7b 核心）：记入复用库 → 导出备份 → 清库 → 导入 → 复用池仍有它
 *       （借 `backup.service` 的 `settings` 整表往返，**不改备份代码**）；
 *   11. `settings` 脏值兜底：键 `'customStages'` 被手工改成非数组 ⇒ 不崩、复用池为空、
 *       **其它 settings 键不受影响**。
 *
 * 为什么这些必须放在这里而不是 jsdom 用例里：验收 6 要断言的是**真落库的行**，
 * 10/11 要断言的是**真 KV 与真备份包**——mock 掉仓储等于把要验的东西验空了。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { BackupService } from '../src/core/services/backup.service';
import { ProjectService } from '../src/core/services/project.service';
import {
  CUSTOM_STAGES_PERSIST_ACROSS_PROJECTS,
  CUSTOM_STAGES_SETTING_KEY,
  __setPersistAcrossProjectsForTest,
  createCustomStageDef,
  customStageToSelectionItem,
  forgetCustomStage,
  listReusableCustomStages,
  normalizeCustomStageDefs,
  rememberCustomStage,
} from '../src/core/services/custom-stage.service';
import { getDomainColumns, getItemKanbanColumn, getPresetItems, getStageLibraryItem } from '../src/core/template/stage-library';
import { ProjectType, StageStatus } from '../src/core/types/enums';
import type { ConfirmedContractPayload, StageDraft, StageSelectionItem } from '../src/core/types/dto';
import type { BackupPackage } from '../src/core/types/dto';

let bundle: IRepositoryBundle;

/** 空包：仅用于清库（与 backup.roundtrip.spec 同款） */
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

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  // vitest 共享同一个 fake-indexeddb 实例：先清库，避免前序 spec 的残留行串进来
  await bundle.admin?.replaceAllImport(emptyPackage());
  __setPersistAcrossProjectsForTest(null); // 复位回退开关
});

afterEach(() => {
  __setPersistAcrossProjectsForTest(null);
});

/* ------------------------------ 夹具 ------------------------------ */

/** 选中项 → 草稿（键序与 `Stage` 实体对齐，逐字段显式给值） */
function draftOf(
  item: StageSelectionItem,
  orderIndex: number,
  startAt: string,
  endAt: string,
): StageDraft {
  return {
    orderIndex,
    templateKey: item.key,
    colorIndex: item.colorIndex,
    customColor: item.customColor ?? null,
    name: item.name,
    ratioPercent: item.ratioPercent,
    startAt,
    endAt,
    status: StageStatus.NotStarted,
    ownerId: null,
    visible: true,
    resourcePath: null,
    defaultTasks: item.defaultTasks,
  };
}

function payload(domain: string | null): ConfirmedContractPayload {
  return {
    projectName: 'T03 验收项目',
    projectType: ProjectType.InteriorDesign,
    address: '成都市高新区',
    clientName: '验收委托方',
    contractAmount: null,
    signedAt: null,
    startAt: '2026-09-01',
    endAt: '2026-12-31',
    stageOverrides: {},
    stagePresetKey: 'indoor_full',
    scheduleBasis: undefined,
    domain: domain as ConfirmedContractPayload['domain'],
  };
}

/**
 * 造一份「9 段室内套餐 ＋ 1 段自定义『消防报审』」的草稿集。
 *
 * 自定义段的 `templateKey` 故意用 `cst.<id>`（**不是**模板库 key）——这正是
 * `normalizeDraftTemplateKey` 要收口的情况：伪造 key 会让下游
 * `getStageLibraryItem(未知key)` **抛错**（N4）。
 */
function draftsWithCustomStage(colorMain: string | null): {
  drafts: StageDraft[];
  customDefId: string;
  customKey: string;
  customName: string;
} {
  const preset = getPresetItems('indoor_full');
  expect(preset.length).toBe(9);

  const def = createCustomStageDef({ name: '消防报审', ratioPercent: 6, colorMain });
  const customItem = customStageToSelectionItem(def, { domain: 'indoor', colorIndex: 9 });

  const items = [...preset, customItem];
  const drafts = items.map((item, i) =>
    draftOf(item, i + 1, '2026-09-01', `2026-1${(i % 2) + 1}-15`),
  );
  return {
    drafts,
    customDefId: def.id,
    customKey: customItem.key,
    customName: customItem.name,
  };
}

/* ------------------------------ 验收 6 ------------------------------ */

describe('验收 6 · 新增「消防报审」落库（A8/B8）', () => {
  it('templateKey === null（不伪造模板库 key）、customColor 按选择落值、落列不崩', async () => {
    const { drafts, customKey } = draftsWithCustomStage('#7A1F2B');
    // 前置：伪造 key 若真的落库，下游会炸 —— 这条断言就是「为什么必须收口」的证明
    expect(() => getStageLibraryItem(customKey)).toThrow();

    const service = new ProjectService({ projects: bundle.projects, bundle });
    const project = await service.createProjectFromContract(payload('indoor'), drafts, undefined);

    const rows = await bundle.stages.listByProject(project.id);
    expect(rows).toHaveLength(10);

    const customRow = rows.find((r) => r.orderIndex === 10);
    expect(customRow).toBeDefined();
    expect(customRow!.name).toBe('消防报审');
    // ① 收口：非模板库 key ⇒ null（`Stage.templateKey` 只允许「真 key | null」两种取值）
    expect(customRow!.templateKey).toBeNull();
    // ② 用户主色按选择落值（大写归一，与 core/color 的唯一归一化器同口径）
    expect(customRow!.customColor).toBe('#7A1F2B');
    // ③ 模板段仍持有真 key（没被误伤成 null）
    const firstRow = rows.find((r) => r.orderIndex === 1);
    expect(firstRow!.templateKey).toBe(getPresetItems('indoor_full')[0]!.key);

    // ④ 落列不崩：templateKey=null 走「按 orderIndex 均分」兜底 ——
    //    取列访问器对 null 输入必须安全返回，且兜底目标（本板块的列）非空
    expect(getItemKanbanColumn(customRow!.templateKey)).toBeNull();
    expect(getDomainColumns(project.domain).length).toBeGreaterThan(0);
  });

  it('未选自定义色 ⇒ customColor 落 null（用内置色号，不是空串/undefined）', async () => {
    const { drafts } = draftsWithCustomStage(null);
    const service = new ProjectService({ projects: bundle.projects, bundle });
    const project = await service.createProjectFromContract(payload('indoor'), drafts, undefined);

    const rows = await bundle.stages.listByProject(project.id);
    const customRow = rows.find((r) => r.orderIndex === 10)!;
    expect(customRow.templateKey).toBeNull();
    expect(customRow.customColor).toBeNull();
    expect(customRow.colorIndex).toBe(9);
  });

  it('主板块写入 Project.domain（建档第 2 层结果落库）', async () => {
    const { drafts } = draftsWithCustomStage(null);
    const service = new ProjectService({ projects: bundle.projects, bundle });
    const project = await service.createProjectFromContract(payload('landscape'), drafts, undefined);
    expect(project.domain).toBe('landscape');
  });

  it('重名阶段被落库闸门拒绝（A9 的第二道闸门 —— 绕过 UI 也拦得住）', async () => {
    const { drafts } = draftsWithCustomStage(null);
    // 把第 10 段（自定义）改成与第 1 段同名
    drafts[9] = { ...drafts[9]!, name: drafts[0]!.name };

    const service = new ProjectService({ projects: bundle.projects, bundle });
    await expect(
      service.createProjectFromContract(payload('indoor'), drafts, undefined),
    ).rejects.toThrow(/阶段名不能重复/);
    // 且**零写入**：闸门在 `projects.insert` **之前**（`assertDraftsValid` 是第一句），
    // 所以项目主体与阶段行都不该存在 —— 断言项目表为空，而不是断言「查一个不存在的项目得到 0 行」
    expect(await bundle.projects.list({ status: 'all' })).toHaveLength(0);
  });
});

/* ------------------------------ 验收 8 ------------------------------ */

describe('验收 8 · TS-07 一行回退（CUSTOM_STAGES_PERSIST_ACROSS_PROJECTS = false）', () => {
  it('默认值 = true（生产口径：跨项目持久化复用）', () => {
    expect(CUSTOM_STAGES_PERSIST_ACROSS_PROJECTS).toBe(true);
  });

  it('置 false ⇒ listReusableCustomStages() 恒 []，且 rememberCustomStage() 不写库', async () => {
    const deps = { settings: bundle.settings };
    const def = createCustomStageDef({ name: '消防报审', ratioPercent: 6, colorMain: null });

    // 开：写入并读回
    await rememberCustomStage(deps, def);
    expect((await listReusableCustomStages(deps)).map((d) => d.name)).toEqual(['消防报审']);

    // 关（**只翻这一个常量/开关，不动任何组件**）：复用池立刻空
    __setPersistAcrossProjectsForTest(false);
    expect(await listReusableCustomStages(deps)).toEqual([]);

    // 且「关」时写入是空操作 —— KV 里仍是关之前那条，不会被污染
    await rememberCustomStage(deps, createCustomStageDef({ name: '测量复核', colorMain: null }));
    __setPersistAcrossProjectsForTest(null);
    expect((await listReusableCustomStages(deps)).map((d) => d.name)).toEqual(['消防报审']);
  });

  it('回退开关是**唯一**回退点：组件层不出现第二处分支（源码守卫）', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const files = [
      'src/components/contract-wizard/ManualFallbackForm.tsx',
      'src/components/contract-wizard/StageSelectPanel.tsx',
      'src/components/contract-wizard/CustomStageDialog.tsx',
    ];
    for (const rel of files) {
      const code = readFileSync(join(process.cwd(), rel), 'utf8');
      // 组件层不得自行判断「是否持久化」——一旦分散，回退就不再是一行
      expect(code).not.toMatch(/CUSTOM_STAGES_PERSIST_ACROSS_PROJECTS\s*===/);
      expect(code).not.toMatch(/CUSTOM_STAGES_PERSIST_ACROSS_PROJECTS\s*\?/);
    }
  });
});

/* ------------------------------ 验收 10 ------------------------------ */

describe('验收 10 · 持久化往返（TBD-7b 核心验收）', () => {
  it('记入复用库 → 导出 → 清库 → 导入 → 复用池仍出现「消防报审」', async () => {
    const deps = { settings: bundle.settings };
    const def = createCustomStageDef({
      name: '消防报审',
      ratioPercent: 6,
      colorMain: '#7A1F2B',
      now: new Date('2026-09-01T00:00:00.000Z'),
    });
    await rememberCustomStage(deps, def);
    expect(await listReusableCustomStages(deps)).toHaveLength(1);

    // 导出：**不改备份代码** —— 自定义阶段库住在 settings KV 里，
    // 而 backup 的 settings 表是整表全量往返，于是它自动跟着走
    const backup = new BackupService(bundle);
    const pkg = await backup.exportAll();
    const settingsRows = pkg.data.settings ?? [];
    expect(settingsRows.some((s) => s.key === CUSTOM_STAGES_SETTING_KEY)).toBe(true);

    // 清库 → 池子空
    await bundle.admin?.replaceAllImport(emptyPackage());
    expect(await listReusableCustomStages(deps)).toEqual([]);

    // 导入 → 池子回来（字段逐个还原，不只是「有一条」）
    await bundle.admin?.replaceAllImport(pkg);
    const restored = await listReusableCustomStages(deps);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      id: def.id,
      name: '消防报审',
      ratioPercent: 6,
      colorMain: '#7A1F2B',
      createdAt: def.createdAt,
      updatedAt: def.updatedAt,
    });
  });

  it('复用库条目可再入建档（customStageToSelectionItem 产出可落库的选中项）', async () => {
    const deps = { settings: bundle.settings };
    await rememberCustomStage(deps, createCustomStageDef({ name: '消防报审', colorMain: '#7A1F2B' }));
    const [def] = await listReusableCustomStages(deps);

    const item = customStageToSelectionItem(def!, { domain: 'indoor', colorIndex: 7 });
    // key 带 cst. 前缀 ⇒ 与模板库 key 天然不冲突（否则会撞到同名模板项）
    expect(item.key.startsWith('cst.')).toBe(true);
    expect(item.customColor).toBe('#7A1F2B');
    expect(item.domain).toBe('indoor');

    const service = new ProjectService({ projects: bundle.projects, bundle });
    const project = await service.createProjectFromContract(
      payload('indoor'),
      [draftOf(item, 1, '2026-09-01', '2026-09-30')],
      undefined,
    );
    const rows = await bundle.stages.listByProject(project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.templateKey).toBeNull();
    expect(rows[0]!.customColor).toBe('#7A1F2B');
  });

  it('forgetCustomStage：按 id 摘除一条，其余保留', async () => {
    const deps = { settings: bundle.settings };
    const a = createCustomStageDef({ name: '消防报审' });
    const b = createCustomStageDef({ name: '测量复核' });
    await rememberCustomStage(deps, a);
    await rememberCustomStage(deps, b);
    expect((await listReusableCustomStages(deps)).map((d) => d.name)).toEqual([
      '消防报审',
      '测量复核',
    ]);

    await forgetCustomStage(deps, a.id);
    expect((await listReusableCustomStages(deps)).map((d) => d.name)).toEqual(['测量复核']);
  });

  it('同名再记一次 = 替换（不会在复用池里堆两条同名 —— 那会直接撞 A9 重名闸门）', async () => {
    const deps = { settings: bundle.settings };
    await rememberCustomStage(deps, createCustomStageDef({ name: '消防报审', ratioPercent: 5 }));
    await rememberCustomStage(deps, createCustomStageDef({ name: '消防报审', ratioPercent: 9 }));
    const list = await listReusableCustomStages(deps);
    expect(list).toHaveLength(1);
    expect(list[0]!.ratioPercent).toBe(9);
  });
});

/* ------------------------------ 验收 11 ------------------------------ */

describe('验收 11 · settings 脏值兜底', () => {
  it('键被改成非数组（{"a":1}）⇒ 不崩、复用池为空', async () => {
    await bundle.settings.set(CUSTOM_STAGES_SETTING_KEY, { a: 1 });
    const deps = { settings: bundle.settings };
    await expect(listReusableCustomStages(deps)).resolves.toEqual([]);
  });

  it('数组里混入脏条目 ⇒ 只丢弃脏的，好的照常读出（不是「一条脏全盘空」）', async () => {
    const good = createCustomStageDef({ name: '消防报审' });
    await bundle.settings.set(CUSTOM_STAGES_SETTING_KEY, [
      good,
      null,
      42,
      { name: '' }, // 无名 → 丢弃
      { id: 'cst_x', name: '测量复核' }, // 缺字段 → 按兜底补全后保留
    ]);
    const deps = { settings: bundle.settings };
    const list = await listReusableCustomStages(deps);
    expect(list.map((d) => d.name)).toEqual(['消防报审', '测量复核']);
  });

  it('脏值不影响**其它** settings 键（兜底必须就地，不能整张表重置）', async () => {
    await bundle.settings.set('restPolicy', { kind: 'double_rest' });
    await bundle.settings.set(CUSTOM_STAGES_SETTING_KEY, 'not-an-array');

    const deps = { settings: bundle.settings };
    expect(await listReusableCustomStages(deps)).toEqual([]);

    // 其它键原样可读
    const restPolicy = await bundle.settings.get<{ kind: string }>('restPolicy');
    expect(restPolicy).toEqual({ kind: 'double_rest' });
    // 且脏值**不被静默改写**（兜底只作用于读取视图，不产生写副作用）
    expect(await bundle.settings.get<string>(CUSTOM_STAGES_SETTING_KEY)).toBe('not-an-array');
  });

  it('normalizeCustomStageDefs 是纯函数：任意脏输入都不抛错', () => {
    const inputs: unknown[] = [
      null,
      undefined,
      0,
      '',
      'x',
      {},
      [],
      [1],
      [{ name: 1 }],
      [{ name: 'ok', ratioPercent: 'not-a-number', colorMain: 'garbage' }],
      [{ name: '  ' }],
    ];
    for (const raw of inputs) {
      expect(() => normalizeCustomStageDefs(raw)).not.toThrow();
      expect(Array.isArray(normalizeCustomStageDefs(raw))).toBe(true);
    }
    // 数值/颜色脏值就地归零，而不是把整条丢掉（名字才是唯一必填）
    const [kept] = normalizeCustomStageDefs([
      { id: 'cst_1', name: '消防报审', ratioPercent: 'zzz', colorMain: 'zzz' },
    ]);
    expect(kept).toBeDefined();
    expect(kept!.ratioPercent).toBeNull();
    expect(kept!.colorMain).toBeNull();
  });
});
