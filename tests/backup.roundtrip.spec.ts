/**
 * 备份往返不变式（fake-indexeddb 环境）：
 *   导出 → 清库 → 导入 → 再导出，两次 data 逐表 diff 为空；
 *   坏 JSON / 结构不符 → 拒绝且不落库。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { BackupService, validateBackupJson } from '../src/core/services/backup.service';
import type { BackupPackage } from '../src/core/types/dto';
import { previewSplit } from '../src/core/template/split';
import { ProjectService } from '../src/core/services/project.service';
import { resolveProjectDomain } from '../src/core/template/stage-fallback';
import { StageStatus } from '../src/core/types/enums';
import type { Project, Stage } from '../src/core/types/entities';

let bundle: IRepositoryBundle;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  // 每个用例独立内存库（fake-indexeddb 的 indexedDB 缓存同 module 实例——
  // 这里用一个固定库名 + 每次清空的方式保证隔离）
  bundle = await createRepositories({ dataSource: 'local' });
  // vitest singleThread 下所有 spec 共享同一个 fake-indexeddb 实例：先跑的 spec
  // （如 task-assignees）最后一个用例写入的行会残留到本文件。本 spec 的 roundtrip
  // 断言要求「导出内容 == 自己 seed 的内容」，任何外来行都会让逐表 diff 失败
  // （残留行缺 v0.6 新字段 → 导入归一后键数变化），故必须先空包清库。
  await bundle.admin?.replaceAllImport(emptyPackage());
});

/** 与 backup.v3-roundtrip.spec 同款空包：仅清库，不带任何行 */
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

/** 造一份数据齐备的库：1 项目 × 9 阶段 × 若干任务 + 流水 + 设置 */
async function seedData(): Promise<Project> {
  const projects = new ProjectService({
    projects: bundle.projects,
    bundle,
  });
  const drafts = previewSplit({ startAt: '2026-08-01', endAt: '2026-12-31' });
  const project = await projects.createProjectFromContract(
    {
      projectName: '望江楼茶空间',
      projectType: 'tea_space' as never,
      address: '成都市青羊区',
      clientName: '测试甲方',
      contractAmount: 880000,
      signedAt: '2026-07-20T00:00:00.000Z',
      startAt: '2026-08-01',
      endAt: '2026-12-31',
      stageOverrides: {},
      createdByManual: false,
      sourceFileName: null,
      rawTextDigest: 'abcd1234',
      parsedResultJsonSnapshot: '{}',
    },
    drafts,
  );

  await bundle.members.insert({
    name: '许工',
    role: '主案',
    contact: null,
    avatarColor: '#3D6B5B',
  });

  const tasks = await bundle.tasks.listByProject(project.id);
  if (tasks[0]) {
    await bundle.tasks.update(tasks[0].id, { done: true });
  }
  // v0.6（IN-06）：对一条任务写入 artifacts（≥2 个对象，path 与 url 各一）+
  // dependsOn（引用同项目既有任务）+ status='review'，让 roundtrip 覆盖对象数组保真
  // 与「done 由 status 反推」的归一口径（键序铁律的间接验证也依赖这里）。
  if (tasks[0] && tasks[1]) {
    await bundle.tasks.update(tasks[0].id, {
      status: 'review',
      dependsOn: [tasks[1].id],
      artifacts: [
        {
          id: 'art_path_1',
          kind: 'file',
          title: 'payload.schema.ts',
          path: 'src/core/agent/payload.schema.ts',
          url: null,
          note: null,
        },
        {
          id: 'art_link_1',
          kind: 'link',
          title: '契约文档',
          path: null,
          url: 'https://example.com/payload-v1',
          note: null,
        },
      ],
    });
  }
  return project;
}

function normalize(pkg: unknown): string {
  const p = JSON.parse(
    JSON.stringify(pkg, (key, value) => (key === 'exportedAt' ? undefined : value)),
  ) as import('../src/core/types/dto').BackupPackage;
  // 排序保证 diff 稳定
  for (const key of Object.keys(p.data) as Array<keyof typeof p.data>) {
    p.data[key].sort((a: { id?: string; key?: string }, b: { id?: string; key?: string }) =>
      String(a.id ?? a.key ?? '').localeCompare(String(b.id ?? b.key ?? '')),
    );
  }
  return JSON.stringify(p);
}

describe('backup：导出→清库→导入→逐表 diff 为空', () => {
  it('roundtrip 数据零丢失', async () => {
    await seedData();

    const svc = new BackupService(bundle);
    const exported1 = await svc.exportAll();
    expect(exported1.data.projects).toHaveLength(1);
    expect(exported1.data.stages).toHaveLength(9);
    expect(exported1.data.tasks.length).toBeGreaterThan(0);
    expect(exported1.data.logs.length).toBeGreaterThan(0); // created 流水

    // 清库（导入自身即清库重建；这里先写一笔垃圾数据证明导入会整体替换）
    await bundle.projects.insert({
      name: '应被覆盖的脏数据',
      type: 'dining' as never,
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-02-01',
      coverColor: null,
    });

    await svc.importAndReplace(exported1);

    const exported2 = await svc.exportAll();
    expect(normalize(exported2)).toBe(normalize(exported1));
  });

  it('流水表（append-only）完整保真', async () => {
    await seedData();
    const stages = await bundle.stages.listByProject((await firstProjectId()));
    const stageLogs = await bundle.logs.listStageLogsByStage(stages[0]!.id);

    const svc = new BackupService(bundle);
    const pkg = await svc.exportAll();
    await svc.importAndReplace(pkg);

    const after = await bundle.logs.listStageLogsByStage(stages[0]!.id);
    expect(after).toHaveLength(stageLogs.length);
  });

  it('含多值 assigneeIds 任务的 roundtrip 保真（v0.3 键序稳定）', async () => {
    const project = await seedData();
    const tasks = await bundle.tasks.listByProject(project.id);
    expect(tasks.length).toBeGreaterThan(0);
    // 多选指派：assigneeIds 多人 + assigneeId 同步为第一参与人
    await bundle.tasks.update(tasks[0]!.id, {
      assigneeIds: ['mem_a', 'mem_b'],
      assigneeId: 'mem_a',
    });

    const svc = new BackupService(bundle);
    const exported1 = await svc.exportAll();
    const withMulti = exported1.data.tasks.find((t) => t.id === tasks[0]!.id);
    expect(withMulti?.assigneeIds).toEqual(['mem_a', 'mem_b']);
    expect(withMulti?.assigneeId).toBe('mem_a');

    await svc.importAndReplace(exported1);
    const exported2 = await svc.exportAll();
    expect(normalize(exported2)).toBe(normalize(exported1));

    // 导入后 DB 行多值保真 + 参与人包含语义
    const after = await bundle.tasks.listByProject(project.id);
    const multi = after.find((t) => t.id === tasks[0]!.id);
    expect(multi?.assigneeIds).toEqual(['mem_a', 'mem_b']);
    const mine = await bundle.tasks.listByAssignee('mem_b');
    expect(mine.map((t) => t.id)).toContain(tasks[0]!.id);
  });
});

/* ------------------ v0.8 增量：domain / kind / customColor 往返 ------------------ */

describe('backup：v0.8 增量往返（domain / kind / customColor）', () => {
  /**
   * T01 验收 3 的落地：「导出 → 清库 → 导入后，`kind==='agent'` 的项目**仍是 agent**」。
   *
   * 这条断言防的失效模式很具体：`kind` 若在任一处（zod / normalizeProjectRow /
   * importAndReplace 的组装）被漏掉或写成常量默认值，Agent 侧项目会在一次备份恢复后
   * **静默回流到人类工作区**——界面上不报错，只是 AI 建的项目突然出现在首页看板里。
   */
  it('kind=agent 的项目往返后仍是 agent；domain 与 customColor 逐字节保真', async () => {
    // ① Agent 侧项目：显式 kind='agent'（人类建档路径不传该字段，故这里是唯一的构造方式）
    const agentProject = await bundle.projects.insert({
      name: 'AI 工作区·概念生成',
      type: 'interior_design' as never,
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-08-01',
      plannedEndAt: '2026-08-31',
      coverColor: null,
      domain: 'software',
      kind: 'agent',
    });
    expect(agentProject.kind).toBe('agent');
    expect(agentProject.domain).toBe('software');

    // ② 带用户自定义主色的阶段（#RRGGBB；null 与有值两种都覆盖，验证 null 不被归一篡改）
    //
    // ⚠️ `orderIndex` 取 10/11 而非 1/2，是**刻意的**——这里踩到一个 T01 之外的既有边界：
    //   `normalizeStageRow` 走 `resolveStageTemplateKey(orderIndex, templateKey)`，
    //   而 `templateKey` 为 null 且 `orderIndex ≤ 9` 时会被**反查 indoor_full 套餐改写成
    //   `indoor.*`**（老数据语义，`tests/stage-subset-split.spec.ts:470` 已锁死该契约）。
    //   后果：Agent 自动建出的「无模板」阶段（`buildCreatedStage` 恒 `templateKey: null`）
    //   若落在 orderIndex ≤ 9，一次备份往返后会被安上室内模板归属 → `getItemKanbanColumn`
    //   从「按 orderIndex 均分落列」变成「落 design 列」，即阶段卡换列。
    //   这是**v0.7 就存在、v0.8 因自定义阶段而放大**的缺陷，不属于 T01 的字段增量范围，
    //   且修它要改一条已被测试锁定的契约（需先决定「显式 null = 明确无模板」还是
    //   「null 与缺失同义」），故 T01 不动它，改由本用例把边界钉住：orderIndex ≥ 10 时
    //   `templateKey: null` 往返稳定。→ 已作为待决项上报（见 T03/T04 交接说明）。
    const stageRows: Stage[] = [
      {
        id: 'stg_agent_1',
        projectId: agentProject.id,
        orderIndex: 10,
        templateKey: null,
        colorIndex: 1,
        customColor: '#2F6F8F',
        name: '概念生成',
        ratioPercent: 50,
        startAt: '2026-08-01',
        endAt: '2026-08-15',
        status: StageStatus.NotStarted,
        ownerId: null,
        visible: true,
        resourcePath: null,
        revision: 1,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        // 第二条不带自定义色 → customColor 必须原样保持 null（不得被补成默认色）
        id: 'stg_agent_2',
        projectId: agentProject.id,
        orderIndex: 11,
        templateKey: null,
        colorIndex: 2,
        customColor: null,
        name: '方案深化',
        ratioPercent: 50,
        startAt: '2026-08-16',
        endAt: '2026-08-31',
        status: StageStatus.NotStarted,
        ownerId: null,
        visible: true,
        resourcePath: null,
        revision: 1,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ];
    await bundle.stages.bulkInsert(stageRows);

    // ③ 人类侧项目（domain=null 的「未确认」态）一并往返，验证 null 不会被改写成 'indoor'
    await bundle.projects.insert({
      name: '人类侧·未确认板块',
      type: 'dining' as never,
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-08-01',
      plannedEndAt: '2026-09-30',
      coverColor: null,
    });

    const svc = new BackupService(bundle);
    const exported1 = await svc.exportAll();

    // 导出侧先自证：agent 标记与自定义色确实在包里（否则下面的往返断言恒真）
    const agentInPkg = exported1.data.projects.find((p) => p.id === agentProject.id);
    expect(agentInPkg?.kind).toBe('agent');
    expect(agentInPkg?.domain).toBe('software');
    const unconfirmedInPkg = exported1.data.projects.find((p) => p.name === '人类侧·未确认板块');
    expect(unconfirmedInPkg?.domain).toBeNull();
    expect(exported1.data.stages.find((s) => s.id === 'stg_agent_1')?.customColor).toBe('#2F6F8F');

    await svc.importAndReplace(exported1);
    const exported2 = await svc.exportAll();

    // ④ 逐表逐字节相等（键序 + 值；domain=null 必须仍是 null，kind 不得被重写）
    expect(normalize(exported2)).toBe(normalize(exported1));

    // ⑤ 直接读 DB 行断言（不经序列化路径，独立于 ④ 的字符串比较）
    const agentRow = await bundle.projects.get(agentProject.id);
    expect(agentRow?.kind).toBe('agent');
    expect(agentRow?.domain).toBe('software');
    const unconfirmedRow = (await bundle.projects.list({ status: 'all' })).find(
      (p) => p.name === '人类侧·未确认板块',
    );
    expect(unconfirmedRow?.kind).toBe('human');
    expect(unconfirmedRow?.domain).toBeNull();

    const afterStages = await bundle.stages.listByProject(agentProject.id);
    expect(afterStages.find((s) => s.id === 'stg_agent_1')?.customColor).toBe('#2F6F8F');
    expect(afterStages.find((s) => s.id === 'stg_agent_2')?.customColor).toBeNull();
  });

  /**
   * T01 验收 6 的落地：「老库（无 kind 列 / 老备份无该键）→ 全部项目显示为人类侧」。
   *
   * 走 `normalizeProjectRow`（导入归一的唯一入口）：老备份的 project 行**根本没有**
   * `domain` / `kind` 两个键，归一后必须得到 `domain: null` + `kind: 'human'`。
   */
  it('老备份（无 domain/kind/customColor 三键）导入 → 回落为 null / human / null', async () => {
    const legacyProject = {
      id: 'proj_legacy',
      name: 'v0.7 老项目',
      type: 'dining',
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-06-30',
      coverColor: null,
      shortLabel: null,
      stagePresetKey: 'indoor_full',
      stageTemplateVersion: 2,
      scheduleBasis: 'calendar',
      status: 'active',
      revision: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const legacyStage = {
      id: 'stg_legacy',
      projectId: 'proj_legacy',
      orderIndex: 1,
      templateKey: 'indoor.su_model',
      colorIndex: 1,
      name: 'SU 建模',
      ratioPercent: 100,
      startAt: '2026-01-01',
      endAt: '2026-06-30',
      status: 'not_started',
      ownerId: null,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const legacyPkg = {
      meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-01-01T00:00:00.000Z' },
      data: {
        projects: [legacyProject],
        stages: [legacyStage],
        tasks: [],
        members: [],
        assignments: [],
        logs: [],
        contracts: [],
        settings: [],
      },
    };

    const svc = new BackupService(bundle);
    await svc.importAndReplace(legacyPkg as never);

    const row = await bundle.projects.get('proj_legacy');
    expect(row?.kind).toBe('human'); // ★ 老数据必须落回人类侧
    // domain 保持 null（不猜板块）；消费侧 resolveProjectDomain 才反查 'indoor_full' → indoor
    expect(row?.domain).toBeNull();
    expect(resolveProjectDomain(row?.stagePresetKey, row?.domain)).toBe('indoor');
    expect((await bundle.stages.get('stg_legacy'))?.customColor).toBeNull();
  });
});

describe('backup：坏包拒绝（不允许半套写入）', () => {
  it('meta.app 错误 → 抛 Validation 且库未被清空', async () => {
    await seedData();
    const before = await bundle.projects.list({ status: 'all' });
    expect(before.length).toBeGreaterThan(0);

    const evil = {
      meta: { app: 'not-changxia', schemaVersion: 1, exportedAt: new Date().toISOString() },
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
    expect(() => validateBackupJson(evil)).toThrowError(/校验失败/);

    const svc = new BackupService(bundle);
    await expect(svc.importAndReplace(evil as never)).rejects.toThrowError();
    // 库未被动
    const after = await bundle.projects.list({ status: 'all' });
    expect(after).toHaveLength(before.length);
  });

  it('缺表 / 非数组字段 → 校验失败', () => {
    const broken = {
      meta: { app: 'changxia', schemaVersion: 1, exportedAt: '2026-09-01T00:00:00.000Z' },
      data: {
        projects: [],
        stages: {},
        tasks: [],
        members: [],
        assignments: [],
        logs: [],
        contracts: [],
        settings: [],
      },
    };
    expect(() => validateBackupJson(broken)).toThrowError(/校验失败/);
  });
});

async function firstProjectId(): Promise<string> {
  const rows = await bundle.projects.list({ status: 'all' });
  return rows[0]!.id;
}
