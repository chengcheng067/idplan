// @vitest-environment jsdom
/**
 * v0.8 · T04-B 验收（接管双动作）：**「接管」落地 spec**。
 *
 * 设计依据：PRD B11（转为正式项目）/ B12（搬运任务）/ B13（可删除）/ D5（仅 admin）/
 * §7.3 #27（详情页是接管入口的宿主）；测试契约见 agent-takeover.service.ts 文件头。
 *
 * ══════════════════════════ 四层各证什么 ══════════════════════════
 *
 *  ① **纯函数层**（planTaskMove / previewMove）：落点判定、依赖改写、悬空报告。
 *     不碰 IO —— 这三条规则（taskNo 不重编号在②、悬空两侧剔除、同 externalId 走更新）
 *     是 B12 的硬性条款，必须在算法层被钉死，而不是靠端到端"看起来对"。
 *  ② **服务集成层**（真仓储 → 真 fake-indexeddb）：验证**读回**（不是"调用过了"）——
 *     目标行的 taskNo 是否原样、源行是否真删、悬空边是否真剥。只 spy 调用会漏
 *     "调了 update 但字段没带上"这类缺陷（本项目的高发区）。
 *  ③ **档位门**（mock appEnv）：remote 档必须**响亮拒绝**而不是发一个注定被
 *     服务端静默丢弃的请求（详见 useProjectsStore.assertTakeoverAllowed 注释）。
 *  ④ **DOM 层**（TransferDialog 真渲染）：预览数字与命令形状（stageId / takeover:true
 *     / taskIds）——「预览说搬 3 条、实际搬 5 条」这类缺陷只有这里能抓到。
 *
 * ⚠️ 源码级断言（末段）：TransferDialog 的**宿主接线**曾长期缺失（组件建好无人引用，
 * agent-board-create.spec.tsx 的未覆盖备注即指此）。接线是"存在性"事实，用读源码
 * 断言钉住宿主与门控条件；交互行为由 ④ 覆盖。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import type { Project, Stage, Task } from '../src/core/types/entities';
import { ChangxiaErrorCode, MemberActorKind, MemberRoleKind, ProjectStatus, ScheduleBasis, StageStatus, TaskStatus } from '../src/core/types/enums';
import {
  AgentTakeoverService,
  planTaskMove,
  previewMove,
  humanTakeoverCandidates,
} from '../src/core/services/agent-takeover.service';
import { createProjectActions } from '../src/store/useProjectsStore';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { TransferDialog, type TransferCommand } from '../src/components/agent/TransferDialog';

/* ════════════════════════════ 夹具 ════════════════════════════ */

const NOW = '2026-09-01T00:00:00.000Z';

function projectOf(over: Partial<Project> & { id: string; kind: 'human' | 'agent' }): Project {
  return {
    name: `项目 ${over.id}`,
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-09-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: null,
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: NOW,
    ...over,
  };
}

function stageOf(id: string, projectId: string, orderIndex: number): Stage {
  return {
    id,
    projectId,
    orderIndex,
    templateKey: null,
    colorIndex: 1,
    customColor: null,
    name: `阶段${orderIndex}`,
    ratioPercent: 10,
    startAt: '2026-09-01',
    endAt: '2026-09-10',
    status: StageStatus.NotStarted,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: NOW,
  };
}

function taskOf(over: Partial<Task> & { id: string }): Task {
  return {
    taskNo: 1000,
    projectId: 'b1',
    stageId: 'stg_b1',
    title: `任务 ${over.id}`,
    done: false,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    itineraryDate: null,
    source: 'agent',
    externalId: null,
    agentId: null,
    status: TaskStatus.Draft,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    orderIndex: 1,
    revision: 1,
    updatedAt: NOW,
    ...over,
  };
}

/** 进入管理员身份（useRoleGuard 的角色来源 = members + settings 两个 store） */
function enterAdmin(): void {
  useMembersStore.setState({
    members: [
      {
        id: 'mem_admin',
        name: '管理员',
        role: '',
        contact: null,
        avatarColor: '#3D6B5B',
        active: true,
        roleKind: MemberRoleKind.Admin,
        passwordHash: null,
        actorKind: MemberActorKind.Human,
        agentKind: null,
        revision: 1,
        updatedAt: NOW,
      },
    ],
  });
  useSettingsStore.setState({ currentMemberId: 'mem_admin', hydrated: true });
}

/* ════════════════════════ ① 纯函数层：planTaskMove / previewMove ════════════════════════ */

describe('planTaskMove：落点判定与依赖改写（B12 硬性条款）', () => {
  const boardTasks = [
    taskOf({ id: 't1', externalId: 'agent:x:1', dependsOn: [] }),
    taskOf({ id: 't2', externalId: 'agent:x:2', dependsOn: ['t1'] }),
    taskOf({ id: 't3', externalId: 'agent:x:3', dependsOn: ['t1', 't9'] }),
    taskOf({ id: 't9', externalId: 'agent:x:9', dependsOn: [] }),
    taskOf({ id: 't10', externalId: 'agent:x:10', dependsOn: ['t1'] }),
  ];

  it('目标项目无同 externalId → 全部 create；finalId 是新 id（不动源 id）', () => {
    const plan = planTaskMove({
      sourceTasks: boardTasks,
      targetTasks: [],
      taskIds: ['t1', 't2', 't3'],
      stageId: 'stg_p1',
      targetProjectId: 'p1',
    });
    expect(plan.moves.map((m) => m.disposition)).toEqual(['create', 'create', 'create']);
    for (const m of plan.moves) {
      expect(m.finalId).not.toBe(m.sourceId);
      expect(m.finalId.startsWith('tsk_')).toBe(true);
    }
  });

  it('★ 目标项目已有同 externalId 的行 → 该条 update，finalId = 目标既有行 id（项目内幂等）', () => {
    const plan = planTaskMove({
      sourceTasks: boardTasks,
      targetTasks: [taskOf({ id: 'pt2', projectId: 'p1', stageId: 'stg_p1', externalId: 'agent:x:2', taskNo: 55 })],
      taskIds: ['t1', 't2'],
      stageId: 'stg_p1',
      targetProjectId: 'p1',
    });
    const m2 = plan.moves.find((m) => m.sourceId === 't2')!;
    expect(m2.disposition).toBe('update');
    expect(m2.finalId).toBe('pt2'); // 用目标行 id，不新建、不改目标 taskNo
    expect(plan.moves.find((m) => m.sourceId === 't1')!.disposition).toBe('create');
  });

  it('★ 同批搬走的依赖 → 映射到对方 finalId（边不断）', () => {
    const plan = planTaskMove({
      sourceTasks: boardTasks,
      targetTasks: [],
      taskIds: ['t1', 't2', 't3'],
      stageId: 'stg_p1',
      targetProjectId: 'p1',
    });
    const t1Final = plan.moves.find((m) => m.sourceId === 't1')!.finalId;
    const m2 = plan.moves.find((m) => m.sourceId === 't2')!;
    const m3 = plan.moves.find((m) => m.sourceId === 't3')!;
    expect(m2.nextDependsOn).toEqual([t1Final]);
    // t3 依赖 t1（随批搬走 → 映射）与 t9（未搬 → 剔除）
    expect(m3.nextDependsOn).toEqual([t1Final]);
    expect(m3.droppedDeps).toEqual([{ depId: 't9', depTitle: '任务 t9' }]);
  });

  it('★ 目标侧悬空依赖逐条报告（dag 把解不到的依赖当"已满足"，静默留=任务被误判可开工）', () => {
    const plan = planTaskMove({
      sourceTasks: boardTasks,
      targetTasks: [],
      taskIds: ['t1', 't3'], // t9 未选中
      stageId: 'stg_p1',
      targetProjectId: 'p1',
    });
    const m3 = plan.moves.find((m) => m.sourceId === 't3')!;
    expect(m3.droppedDeps).toEqual([{ depId: 't9', depTitle: '任务 t9' }]);
    const preview = previewMove(plan);
    expect(preview.droppedDependencyCount).toBe(1);
  });

  it('★ 源侧重接线：留下的任务依赖了被搬走的前驱 → 剥掉该边并记录', () => {
    const plan = planTaskMove({
      sourceTasks: boardTasks,
      targetTasks: [],
      taskIds: ['t1'],
      stageId: 'stg_p1',
      targetProjectId: 'p1',
    });
    expect(plan.sourceRewires).toEqual([
      { taskId: 't2', title: '任务 t2', removedDepIds: ['t1'], nextDependsOn: [] },
      { taskId: 't3', title: '任务 t3', removedDepIds: ['t1'], nextDependsOn: ['t9'] },
      { taskId: 't10', title: '任务 t10', removedDepIds: ['t1'], nextDependsOn: [] },
    ]);
    expect(previewMove(plan).sourceDroppedDependencyCount).toBe(3);
  });

  it('previewMove 计数与 plan 严格同源（create/update/悬空两侧）', () => {
    const plan = planTaskMove({
      sourceTasks: boardTasks,
      targetTasks: [taskOf({ id: 'pt1', projectId: 'p1', externalId: 'agent:x:1' })],
      taskIds: ['t1', 't2', 't3'],
      stageId: 'stg_p1',
      targetProjectId: 'p1',
    });
    const preview = previewMove(plan);
    expect(preview.createCount).toBe(2);
    expect(preview.updateCount).toBe(1);
    expect(preview.droppedDependencyCount).toBe(1);
    expect(preview.moves).toHaveLength(3);
  });

  it('humanTakeoverCandidates：只留人类项目（漏斗谓词复用，不写第二份 kind 判定）', () => {
    const all = [
      projectOf({ id: 'h1', kind: 'human' }),
      projectOf({ id: 'a1', kind: 'agent' }),
      projectOf({ id: 'h2', kind: 'human' }),
    ];
    expect(humanTakeoverCandidates(all).map((p) => p.id)).toEqual(['h1', 'h2']);
  });
});

/* ════════════════════════ ② 服务集成层（真仓储 → 真 fake-indexeddb） ════════════════════════ */

let bundle: IRepositoryBundle;
let takeover: AgentTakeoverService;

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  takeover = new AgentTakeoverService({ bundle });
  // 清库：共享 fake-indexeddb 实例，避免行污染
  for (const p of await bundle.projects.list({ status: 'all' })) {
    await bundle.projects.remove(p.id);
  }
});

/** 种入基础场景：Agent 看板 b1（5 任务）＋ 人类项目 p1（2 阶段 + 1 条外部编号任务） */
async function seedScenario(): Promise<void> {
  await bundle.projects.insert(projectOf({ id: 'b1', name: '湖边看板', kind: 'agent' }));
  await bundle.projects.insert(projectOf({ id: 'p1', name: '人类项目', kind: 'human' }));
  await bundle.stages.bulkInsert([stageOf('stg_b1', 'b1', 1)]);
  await bundle.stages.bulkInsert([stageOf('stg_p1', 'p1', 1), stageOf('stg_p2', 'p1', 2)]);
  await bundle.tasks.bulkInsert([
    taskOf({ id: 't1', taskNo: 1001, externalId: 'agent:x:1', orderIndex: 1 }),
    taskOf({ id: 't2', taskNo: 1002, externalId: 'agent:x:2', dependsOn: ['t1'], orderIndex: 2 }),
    taskOf({ id: 't3', taskNo: 1003, externalId: 'agent:x:3', dependsOn: ['t9'], orderIndex: 3 }),
    taskOf({ id: 't9', taskNo: 1009, externalId: 'agent:x:9', orderIndex: 4 }),
    taskOf({ id: 't10', taskNo: 1010, externalId: 'agent:x:10', dependsOn: ['t1'], orderIndex: 5 }),
  ]);
  // p1 里已有一条与 t2 同 externalId 的任务（update 路径的靶子）
  await bundle.tasks.bulkInsert([
    taskOf({ id: 'pt2', projectId: 'p1', stageId: 'stg_p1', taskNo: 55, externalId: 'agent:x:2', title: '旧版改图', orderIndex: 1 }),
  ]);
}

describe('AgentTakeoverService.convertBoardToHuman（B11）', () => {
  it('非 Agent 看板 → Validation 拒绝，且该行 kind 一字未变', async () => {
    await bundle.projects.insert(projectOf({ id: 'h1', kind: 'human' }));
    await expect(takeover.convertBoardToHuman('h1')).rejects.toThrow(/已经是人类工作区/);
    const row = await bundle.projects.get('h1');
    expect(row?.kind).toBe('human');
  });

  it('不存在的看板 → NotFound', async () => {
    await expect(takeover.convertBoardToHuman('ghost')).rejects.toThrow(/未找到/);
  });

  it('★ Agent 看板 → kind 翻 human；其余字段逐一相等（除 revision/updatedAt）；任务与 taskNo 原样', async () => {
    await seedScenario();
    const before = await bundle.projects.get('b1');
    const updated = await takeover.convertBoardToHuman('b1');

    expect(updated.kind).toBe('human');
    // 只有 kind/revision/updatedAt 三个键变化，其余 15 个字段逐字相等
    const { revision: _r1, updatedAt: _u1, kind: _kb, ...beforeRest } = before!;
    const { revision: _r2, updatedAt: _u2, kind: _ka, ...afterRest } = updated;
    void _r1; void _u1; void _kb; void _r2; void _u2; void _ka;
    expect(afterRest).toEqual(beforeRest);
    expect(updated.revision).toBe(before!.revision + 1);

    // 阶段与任务原样留在项目下（taskNo 不变）
    expect((await bundle.stages.listByProject('b1')).map((s) => s.id)).toEqual(['stg_b1']);
    const tasks = await bundle.tasks.listByProject('b1');
    expect(tasks.map((t) => t.taskNo)).toEqual([1001, 1002, 1003, 1009, 1010]);
  });
});

describe('AgentTakeoverService.moveTasksToHumanProject（B12）', () => {
  it('目标是 Agent 看板 → Validation（搬进 Agent 板是无意义搬运）', async () => {
    await seedScenario();
    await bundle.projects.insert(projectOf({ id: 'a2', kind: 'agent' }));
    await expect(
      takeover.moveTasksToHumanProject({ boardId: 'b1', targetProjectId: 'a2', stageId: 'stg_b1', taskIds: ['t1'] }),
    ).rejects.toThrow(/目标必须是人类工作区/);
  });

  it('落点阶段不属于目标项目 → Validation（不提供"自动建阶段"）', async () => {
    await seedScenario();
    await expect(
      takeover.moveTasksToHumanProject({ boardId: 'b1', targetProjectId: 'p1', stageId: 'stg_b1', taskIds: ['t1'] }),
    ).rejects.toThrow(/落点阶段必须属于目标项目/);
    await expect(
      takeover.moveTasksToHumanProject({ boardId: 'b1', targetProjectId: 'p1', stageId: 'stg_ghost', taskIds: ['t1'] }),
    ).rejects.toThrow(/落点阶段必须属于目标项目/);
  });

  it('空勾选 / 勾了不属于本板的任务 → Validation / NotFound，且零写入', async () => {
    await seedScenario();
    const before = await bundle.tasks.listByProject('p1');
    await expect(
      takeover.moveTasksToHumanProject({ boardId: 'b1', targetProjectId: 'p1', stageId: 'stg_p1', taskIds: [] }),
    ).rejects.toThrow(/至少选择一条/);
    await expect(
      takeover.moveTasksToHumanProject({ boardId: 'b1', targetProjectId: 'p1', stageId: 'stg_p1', taskIds: ['pt2'] }),
    ).rejects.toThrow(/不在该看板下/);
    expect(await bundle.tasks.listByProject('p1')).toEqual(before);
    expect((await bundle.tasks.listByProject('b1')).length).toBe(5);
  });

  it('★ 全流程：taskNo 原样 / 同 externalId 走更新 / 源行删除 / 悬空两侧剥除 / 计数与预览一致', async () => {
    await seedScenario();

    // 先算预览（搬前状态），执行后对账 ——「预览与执行同源」不是口号，是对账
    const plan = planTaskMove({
      sourceTasks: await bundle.tasks.listByProject('b1'),
      targetTasks: await bundle.tasks.listByProject('p1'),
      taskIds: ['t1', 't2', 't3'],
      stageId: 'stg_p1',
      targetProjectId: 'p1',
    });
    const preview = previewMove(plan);

    const outcome = await takeover.moveTasksToHumanProject({
      boardId: 'b1',
      targetProjectId: 'p1',
      stageId: 'stg_p1',
      taskIds: ['t1', 't2', 't3'],
    });

    expect(outcome.created).toBe(preview.createCount); // t1 / t3 新建
    expect(outcome.updated).toBe(preview.updateCount); // t2 命中 pt2
    expect(outcome.droppedDependencies).toBe(preview.droppedDependencyCount); // t3 失去 t9
    expect(outcome.sourceDroppedDependencies).toBe(preview.sourceDroppedDependencyCount); // t10 失去 t1

    // ── 读回验证（不是"调用过了"） ──
    const targetTasks = await bundle.tasks.listByProject('p1');
    const newT1 = targetTasks.find((t) => t.externalId === 'agent:x:1')!;
    const newT3 = targetTasks.find((t) => t.externalId === 'agent:x:3')!;
    const updT2 = targetTasks.find((t) => t.externalId === 'agent:x:2')!;

    // ① taskNo 原样保留（不重编号）
    expect(newT1.taskNo).toBe(1001);
    expect(newT3.taskNo).toBe(1003);
    expect(updT2.taskNo).toBe(55); // update 路径沿用目标行旧号
    // ② 落点显式选择的阶段
    expect(newT1.stageId).toBe('stg_p1');
    expect(newT3.stageId).toBe('stg_p1');
    expect(updT2.stageId).toBe('stg_p1');
    // ③ create 的悬空依赖被剔除（t3 依赖未搬走的 t9）
    expect(newT3.dependsOn).toEqual([]);
    // ④ update 路径的依赖映射到对方 finalId（t2 依赖 t1 → t1 的新行 id，边不断）
    expect(updT2.dependsOn).toEqual([newT1.id]);

    // ⑤ 源行删除（不留副本）：b1 只剩未参与搬运的 t9 / t10
    const sourceLeft = await bundle.tasks.listByProject('b1');
    expect(sourceLeft.map((t) => t.id)).toEqual(['t9', 't10']);
    // ⑥ 源侧重接线：t10 失去对 t1 的依赖
    expect(sourceLeft.find((t) => t.id === 't10')!.dependsOn).toEqual([]);
    // ⑦ t9（未搬）未受影响
    expect(sourceLeft.find((t) => t.id === 't9')!.dependsOn).toEqual([]);

    // ⑧ orderIndex 在目标阶段内不撞既有行
    const inStage = targetTasks
      .filter((t) => t.stageId === 'stg_p1')
      .map((t) => t.orderIndex)
      .sort((a, b) => a - b);
    expect(new Set(inStage).size).toBe(inStage.length);
  });

  it('★ 二次重试自动收敛：第一次失败后源行未删，重试时同 externalId 转 update（不制造重复）', async () => {
    await seedScenario();
    // 第一次：stageId 合法但 taskIds 含非本板任务 → 校验失败（零写入）
    await expect(
      takeover.moveTasksToHumanProject({ boardId: 'b1', targetProjectId: 'p1', stageId: 'stg_p1', taskIds: ['t1', 'ghost'] }),
    ).rejects.toThrow(/不在该看板下/);
    expect((await bundle.tasks.listByProject('b1')).length).toBe(5);
    // 第二次：合法重试，t1 仍走 create（目标还没它的行）
    const outcome = await takeover.moveTasksToHumanProject({
      boardId: 'b1', targetProjectId: 'p1', stageId: 'stg_p1', taskIds: ['t1'],
    });
    expect(outcome.created).toBe(1);
    expect(outcome.updated).toBe(0);
  });
});

/* ════════════════════════ ③ 档位门（remote 必须响亮拒绝） ════════════════════════ */

/** appEnv 是模块级单例；mock 成可变对象，逐用例切档位 */
vi.mock('../src/config/env', () => ({
  appEnv: { dataSource: 'remote', apiBaseUrl: 'http://nas.local/api' },
}));

describe('store action 档位门：remote 档拒发接管请求', () => {
  it('★ takeoverConvert / takeoverMove 在 remote 档抛 Validation 且文案点明"仅本机档"', async () => {
    const actions = createProjectActions(bundle);
    await expect(actions.takeoverConvert('b1')).rejects.toThrow(/仅支持本机数据档/);
    await expect(
      actions.takeoverMove({ boardId: 'b1', targetProjectId: 'p1', stageId: 'stg_p1', taskIds: ['t1'] }),
    ).rejects.toThrow(/仅支持本机数据档/);
  });
});

/* ════════════════════════ ④ DOM 层：TransferDialog ════════════════════════ */

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  enterAdmin();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.removeChild(container);
  useSettingsStore.setState({ currentMemberId: null, hydrated: false });
  useMembersStore.setState({ members: [] });
});

function q<T extends Element>(selector: string): T | null {
  return document.querySelector(selector) as T | null;
}
function named<T extends Element>(selector: string, what: string): T {
  const el = q<T>(selector);
  if (!el) throw new Error(`未找到：${what}（选择器 ${selector}）`);
  return el;
}
async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
}

/** 渲染 TransferDialog（move 模式的完整候选数据；任务/目标均带 externalId 以触发 update 路径） */
async function renderDialog(onConfirm: (cmd: TransferCommand) => Promise<{ movedTaskCount: number }>): Promise<void> {
  await act(async () => {
    root.render(
      <TransferDialog
        open
        onClose={() => undefined}
        sourceBoard={{ id: 'b1', name: '湖边看板' }}
        tasks={[
          taskOf({ id: 't1', title: '写提案', externalId: 'agent:x:1', dependsOn: ['t9'], orderIndex: 1 }),
          taskOf({ id: 't2', title: '改图', externalId: 'agent:x:2', orderIndex: 2 }),
          taskOf({ id: 't9', title: '前置', externalId: 'agent:x:9', orderIndex: 3 }),
        ]}
        candidates={[projectOf({ id: 'p1', name: '人类项目A', kind: 'human' })]}
        targetStages={[stageOf('stg_p1', 'p1', 1), stageOf('stg_p2', 'p1', 2)]}
        targetTasks={[
          taskOf({ id: 'pt2', projectId: 'p1', stageId: 'stg_p1', taskNo: 55, externalId: 'agent:x:2', title: '旧版改图' }),
        ]}
        onConfirm={onConfirm}
      />,
    );
  });
}

describe('TransferDialog：接管确认交互（B11 / B12 / D5）', () => {
  it('默认 convert 模式即可确认（转正不需要选目标）', async () => {
    const onConfirm = vi.fn(
      async (_cmd: TransferCommand): Promise<{ movedTaskCount: number }> => ({ movedTaskCount: 0 }),
    );
    await renderDialog(onConfirm);
    const confirmBtn = named<HTMLButtonElement>('[data-transfer-confirm]', '确认按钮');
    expect(confirmBtn.disabled).toBe(false);
    await click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({ takeover: true, mode: 'convert', targetProjectId: null, stageId: null, taskIds: [] });
  });

  it('★ move 模式：目标/落点未选齐 → 禁用；选齐后预览实算 新建/更新/剔除 并逐条列悬空', async () => {
    const onConfirm = vi.fn(
      async (_cmd: TransferCommand): Promise<{ movedTaskCount: number }> => ({ movedTaskCount: 2 }),
    );
    await renderDialog(onConfirm);

    // 切到 move（点 label 内的 radio，避免依赖 label→control 转发）
    await click(named<HTMLInputElement>('label[data-transfer-mode="move"] input', '搬运任务单选项'));
    expect(named<HTMLButtonElement>('[data-transfer-confirm]', '确认按钮').disabled).toBe(true);

    // 选目标项目 + 落点阶段
    const targetSel = named<HTMLSelectElement>('[data-transfer-target]', '目标项目下拉');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(targetSel, 'p1');
      targetSel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const stageSel = named<HTMLSelectElement>('[data-transfer-stage]', '落点阶段下拉');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(stageSel, 'stg_p1');
      stageSel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // 默认全选；把 t9 取消勾选 → t1 对 t9 的依赖变成悬空
    await click(named<HTMLElement>('[data-transfer-task="t9"] input', 't9 勾选框'));

    // 预览实算：新建 1（t1）/ 更新 1（t2 命中 pt2）/ 剔除 1（t1 失去 t9）
    const preview = named<HTMLElement>('[data-transfer-preview]', '预览区');
    expect(preview.textContent).toContain('新建');
    expect(preview.textContent).toContain('更新');
    const dropped = named<HTMLElement>('[data-transfer-preview-dropped]', '悬空依赖列表');
    expect(dropped.textContent).toContain('写提案');
    expect(dropped.textContent).toContain('前置');

    // 确认：命令带 stageId / taskIds（t9 已取消）
    const confirmBtn = named<HTMLButtonElement>('[data-transfer-confirm]', '确认按钮');
    expect(confirmBtn.disabled).toBe(false);
    await click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const cmd = onConfirm.mock.calls[0]![0];
    expect(cmd).toMatchObject({ takeover: true, mode: 'move', targetProjectId: 'p1', stageId: 'stg_p1' });
    expect([...cmd.taskIds].sort()).toEqual(['t1', 't2']);
  });

  it('D5：非 admin → 整块不进渲染树（不是 disabled）', async () => {
    useSettingsStore.setState({ currentMemberId: null, hydrated: false });
    await renderDialog(vi.fn(async () => ({ movedTaskCount: 0 })));
    expect(q('[data-transfer-dialog]')).toBeNull();
  });

  it('落点阶段只列**选中目标**的阶段（未选目标时压根不给阶段下拉）', async () => {
    await renderDialog(vi.fn(async () => ({ movedTaskCount: 0 })));
    await click(named<HTMLInputElement>('label[data-transfer-mode="move"] input', '搬运任务单选项'));
    // 未选目标：只有"请先选择目标项目"的说明，没有阶段下拉
    expect(q('[data-transfer-stage]')).toBeNull();
    // 选目标后：阶段下拉出现，且只含占位项 + 该目标的两个阶段（3 个 option）
    const targetSel = named<HTMLSelectElement>('[data-transfer-target]', '目标项目下拉');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(targetSel, 'p1');
      targetSel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const stageSel = named<HTMLSelectElement>('[data-transfer-stage]', '落点阶段下拉');
    expect(stageSel.options.length).toBe(3);
    expect(stageSel.options[1]!.textContent).toContain('阶段1');
    expect(stageSel.options[2]!.textContent).toContain('阶段2');
  });
});

/* ════════════════════════ 源码级：宿主接线与入口存在性 ════════════════════════ */

describe('接管/删除入口的宿主接线（源码级断言）', () => {
  const read = (rel: string): string =>
    readFileSync(resolve(__dirname, '..', 'src', rel), 'utf-8');

  it('★ ProjectDetailPage 接线 TransferDialog，且门控为「Agent 看板 + 非成员视角」', () => {
    const src = read('pages/ProjectDetailPage.tsx');
    expect(src).toContain('TransferDialog');
    expect(src).toContain('data-transfer-open');
    expect(src).toContain('actions.takeoverConvert');
    expect(src).toContain('actions.takeoverMove');
    // 弹窗渲染条件同时含 !memberView 与 agent 判定
    expect(src).toMatch(/transferOpen && !memberView && projectKindOf\(project\) === 'agent'/);
    // 入口按钮也是 agent-only（与跳 Agent Board 按钮同族）
    expect(src).toMatch(/projectKindOf\(project\) === 'agent' && \([\s\S]*?data-transfer-open/);
  });

  it('★ AgentBoardPage 有删除入口（admin 门 + ConfirmDialog danger）', () => {
    const src = read('pages/AgentBoardPage.tsx');
    expect(src).toContain('data-agent-board-delete');
    expect(src).toContain('ConfirmDialog');
    expect(src).toContain('removeProject');
    // 删除按钮在 isAdmin 条件内（与接管相反：删除无服务端断言，UI 层是唯一门）
    expect(src).toMatch(/isAdmin && \([\s\S]*?data-agent-board-delete/);
  });

  it('AgentBoardPage 的看板集合对局部快照也做**当前态**谓词过滤（接管转正后不残留）', () => {
    const src = read('pages/AgentBoardPage.tsx');
    expect(src).toMatch(/visibleProjectsFor\('agent', merged\)/);
  });

  it('★ B14：侧栏在 Agent 路由显示独立的「Agent 看板」列表（漏斗取数 + 路由门控）', () => {
    const src = read('components/layout/Sidebar.tsx');
    // 数据经漏斗出口（不自己判 kind）
    expect(src).toContain('useAgentProjects()');
    // 仅 Agent 路由渲染（人类路由上侧栏零 Agent 痕迹）
    expect(src).toMatch(/onAgentRoute && agentBoards\.length > 0/);
    expect(src).toMatch(/pathname === '\/agent' \|\| pathname\.startsWith\('\/agent\/'\)/);
    // 锚点 + 选中行为（setCurrentProject）
    expect(src).toContain('data-agent-board-sidebar');
    expect(src).toContain('setCurrentProject(b.id)');
    // census #12 的不变量不能破：侧栏仍不读 tasks
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(bare).not.toContain('useHumanTasks');
  });
});
