/**
 * F8 · 插件边界守卫：归属门必须下沉到仓储层（对抗/变异测试思路）
 *
 * ══════════════════════════ 这个 spec 在守什么 ══════════════════════════
 *
 * 插件化之后，第三方代码会拿到 `PluginContext`（含 `repos: IRepositoryBundle`）。
 * 现状：`assertAgentWritableProject`（`src/core/agent/payload.apply.ts:180`）
 * 是**两个调用点各自的门**，不是仓储层的门：
 *   · `payload.apply.ts:230`（导入通道自己调）
 *   · `src/core/agent/commands.ts:163`（命令通道自己调）
 *   全仓**仅此两处**。⇒ 插件拿 `repos.tasks.insert({ projectId: <人类项目> })`
 *   可以**完全绕过**它，直写人类工作区。
 *
 * ── 全仓唯一的正面样板（本 spec 的关键参照，也是 F8 的说服依据）──
 * `local.execution.repo.ts:57` 的 **`assertAgentOnlyProject`** 已经把 kind 门
 * 落到了 L0 仓储层，且 `server/adapters/sqlite.bundle.ts:786` 有**逐字同义**的版本
 * （`:833` / `:1276` 两处调用）。它的注释（`:48-56`）自证设计意图：
 *   「背景：执行域（S1–S5）只有 API 没有界面入口，此前本地侧同样零 kind 关卡，
 *     任意 projectId 都能挂执行单/提案。本方法把『执行域只属于 Agent 看板』
 *     落成本地存储边界」
 *
 * ⇒ **F8 不是发明新机制，是把这个已验证的模式推广到 tasks / stages 两族。**
 *
 * ── 为什么用「变异测试」思路 ──
 * 本 spec 的价值一半在**它必须能变红**：
 *   ① 正向组：已达标路径（executions）必须绿 —— 证明样板可用、没被改坏；
 *   ② 对照组：未达标路径（tasks）**当前断言「能写进去」是绿的** —— 这就是 F8 待修项本身。
 *      修门后该组会红，届时把 `resolves` 改成 `rejects`（反向迁移说明写在组末）。
 *   ③ 已实测的变异验证（见交付消息）：把 `project.kind !== 'agent'` 改成
 *      `false && …`、以及把 `assertAgentOnlyProject` 的调用整行注释掉，
 *      本 spec 都会变红 ⇒ 断言有判别力，不是假绿。
 */

import { describe, expect, it, beforeAll, beforeEach } from 'vitest';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import {
  ChangxiaError,
  ChangxiaErrorCode,
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import { assertAgentWritableProject } from '../src/core/agent/payload.apply';
import type { Project } from '../src/core/types/entities';

let bundle: IRepositoryBundle;

const NOW = '2026-10-01T00:00:00.000Z';

/** 建一个项目行；kind 由参数决定（这是本 spec 唯一要操纵的变量） */
function project(id: string, kind: 'human' | 'agent') {
  return {
    id,
    name: `${kind} 项目 ${id}`,
    address: '',
    clientName: '',
    contractAmount: null,
    signedAt: null,
    plannedStartAt: '2026-01-01',
    plannedEndAt: '2026-12-31',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: null,
    kind,
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: NOW,
  };
}

function stage(id: string, projectId: string) {
  return {
    id,
    projectId,
    orderIndex: 1,
    templateKey: null,
    colorIndex: 0,
    customColor: null,
    name: `阶段 ${id}`,
    ratioPercent: 100,
    startAt: '2026-01-01',
    endAt: '2026-12-31',
    status: StageStatus.NotStarted,
    ownerId: null,
    visible: true,
    resourcePath: null,
    revision: 1,
    updatedAt: NOW,
  };
}

function member(id: string, roleKind: MemberRoleKind) {
  return {
    id,
    name: id,
    role: '执行者',
    contact: null,
    avatarColor: '#5B8C5A',
    active: true,
    roleKind,
    passwordHash: null,
    actorKind: MemberActorKind.Human,
    agentKind: null,
    revision: 1,
    updatedAt: NOW,
  };
}

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport({
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: NOW },
    data: {
      // p_agent = Agent 看板（合法写入目标）；p_human = 人类项目（插件**不得**触碰）
      projects: [project('p_agent', 'agent'), project('p_human', 'human')],
      stages: [stage('s_agent', 'p_agent'), stage('s_human', 'p_human')],
      tasks: [],
      itineraries: [],
      members: [member('m_admin', MemberRoleKind.Admin), member('m_plain', MemberRoleKind.Member)],
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
      executions: [],
      executionAttempts: [],
      executionEvents: [],
      writebackProposals: [],
    },
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ① 正向组 · 已达标的样板（executions 族）—— 必须绿
 * ══════════════════════════════════════════════════════════════════════════ */

describe('F8 ① 正向 · assertAgentOnlyProject 是已落地的 L0 样板（防被删/被改弱）', () => {
  it('createExecution 对 kind=human 的项目必须被拒（门在仓储层，非调用方）', async () => {
    // ⚠️ 直接打 repos，**不经过任何 service / 通道层** ⇒ 验的正是「门在 L0」。
    //    若将来有人把门挪回调用方，这条会红。
    await expect(
      bundle.executions.createExecution({
        projectId: 'p_human',
        source: 'external',
        objective: '塞进人类项目的执行单',
        idempotencyKey: 'idem-human-1',
      }),
    ).rejects.toBeInstanceOf(ChangxiaError);
  });

  it('createExecution 对 kind=agent 的项目必须放行（门不能过严）', async () => {
    const exec = await bundle.executions.createExecution({
      projectId: 'p_agent',
      source: 'external',
      objective: '合法写入',
      idempotencyKey: 'idem-agent-1',
    });
    expect(exec.projectId).toBe('p_agent');
  });

  it('createProposal 对 kind=human 的项目必须被拒', async () => {
    await expect(
      bundle.executions.createProposal({
        executionId: 'x',
        projectId: 'p_human',
        operations: [],
        idempotencyKey: 'idem-prop-human',
      }),
    ).rejects.toBeInstanceOf(ChangxiaError);
  });

  it('assertAgentWritableProject 本身：human 拒 / agent 过（它是共享内核的门）', async () => {
    await expect(assertAgentWritableProject(bundle, 'p_human')).rejects.toBeInstanceOf(ChangxiaError);
    const p = await assertAgentWritableProject(bundle, 'p_agent');
    expect(p.kind).toBe('agent');
  });

  it('★ 门失败时的错误码与文案必须可判（否则插件作者无法自查）', async () => {
    try {
      await assertAgentWritableProject(bundle, 'p_human');
      throw new Error('门失效：kind=human 的项目竟然通过了 assertAgentWritableProject');
    } catch (err) {
      expect(err).toBeInstanceOf(ChangxiaError);
      expect((err as ChangxiaError).code).toBe(ChangxiaErrorCode.ProjectUnresolved);
      expect((err as ChangxiaError).userMessage).toContain('不是 Agent 看板');
    }
  });

  it('存在性门必须比归属门更早触发（不存在的 id 不得进入 kind 判定）', async () => {
    await expect(assertAgentWritableProject(bundle, '不存在的id')).rejects.toBeInstanceOf(ChangxiaError);
  });

  it('⚠️ 缺口留档：updateProposal 是**审批**动作，当前零角色判定（F8 待修项之一）', async () => {
    const exec = await bundle.executions.createExecution({
      projectId: 'p_agent',
      source: 'external',
      objective: 'g',
      idempotencyKey: 'idem-agent-approve',
    });
    const prop = await bundle.executions.createProposal({
      executionId: exec.id,
      projectId: 'p_agent',
      operations: [],
      idempotencyKey: 'idem-prop-agent',
    });
    // 任何"调用者"都能改提案状态 —— 审批权无门。修好后此处应改为 rejects。
    const updated = await bundle.executions.updateProposal(prop.id, { status: 'approved' as never });
    expect(updated.status).toBe('approved');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 对照组 · 未达标的 tasks / stages 族 —— 当前「能写进去」是绿的 = F8 待修项
 *
 * ⚠️ 反向迁移说明（修门后必做）：
 *    把下面三条的 `resolves` 改为 `rejects.toBeInstanceOf(ChangxiaError)`，
 *    并删掉「洞」注释。改完这条 spec 仍然是绿的，且含义从「记录洞」变成「守门」。
 * ══════════════════════════════════════════════════════════════════════════ */

describe('F8 ② 对照 · tasks / stages 族当前无 L0 归属门（F8 待修项）', () => {
  it('★ 洞：repos.tasks.insert 可直写 kind=human 的项目，绕过 assertAgentWritableProject', async () => {
    // 先证明「共享的门本身是有效的」——排除「是我构造错了」：
    await expect(assertAgentWritableProject(bundle, 'p_human')).rejects.toBeInstanceOf(ChangxiaError);

    // 然后证明「但仓储层不认这道门」：同一目标，插件拿 repos 直接写 → 竟然成功了
    const row = await bundle.tasks.insert({
      projectId: 'p_human',
      stageId: 's_human',
      title: '插件塞进人类项目的任务',
      assigneeId: null,
      dueDate: null,
    });

    expect(row.projectId).toBe('p_human');
    // 反查确认它真的落库了（不是只在返回对象里好看）
    const stored = await bundle.tasks.get(row.id);
    expect(stored?.projectId).toBe('p_human');
  });

  it('★ 洞：bulkInsert 同样无门（Agent 建板骨架的路径，也可被反向用于人类项目）', async () => {
    await bundle.tasks.bulkInsert([
      {
        id: 'x1',
        projectId: 'p_human',
        stageId: 's_human',
        title: '批量塞进来的任务',
        done: false,
        assigneeId: null,
        assigneeIds: [],
        dueDate: null,
        source: 'agent',
        status: TaskStatus.Draft,
        description: null,
        dependsOn: [],
        artifacts: [],
        startAt: null,
        claimedAt: null,
        runId: null,
        orderIndex: 1,
        revision: 1,
        updatedAt: NOW,
        taskNo: 1001,
      } as never,
    ]);
    const stored = await bundle.tasks.get('x1');
    expect(stored?.projectId).toBe('p_human');
  });

  it('★ 洞：stages.bulkInsert 同样无门（可改人类项目的阶段结构）', async () => {
    await bundle.stages.bulkInsert([
      { ...stage('s_injected', 'p_human'), name: '插件注入的阶段' } as never,
    ]);
    const stages = await bundle.stages.listByProject('p_human');
    expect(stages.map((s) => s.name)).toContain('插件注入的阶段');
  });

  it('★ 洞：projects.update 可改 kind（跨工作区接管在本地通路无门）', async () => {
    // 服务端 PATCH /api/projects/:id 另有 `takeover === true` 意图门
    // （server/routes/projects.routes.ts:266），但本地 Dexie 通路**无对应门**。
    const before = await bundle.projects.get('p_human');
    expect(before?.kind).toBe('human');

    const next = await bundle.projects.update('p_human', { kind: 'agent' });
    expect(next.kind).toBe('agent'); // ← 无任何阻挡
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ P0 缺口 · 自我提权与整库替换（比 kind 洞更严重，插件装上即等于 admin）
 * ══════════════════════════════════════════════════════════════════════════ */

describe('F8 ③ P0 · members.update 自我提权 / admin.replaceAllImport 整库替换', () => {
  it('★ 洞：普通成员可把自己提权成 admin（useRoleGuard 派生自 members store）', async () => {
    const before = await bundle.members.get('m_plain');
    expect(before?.roleKind).toBe(MemberRoleKind.Member);

    const after = await bundle.members.update('m_plain', { roleKind: MemberRoleKind.Admin });
    expect(after.roleKind).toBe(MemberRoleKind.Admin); // ← 零门
  });

  it('★ 洞：repos.admin.replaceAllImport 可整库清库重建（门判的是「有没有通道」不是「是不是 admin」）', async () => {
    // 现状门在 src/core/services/backup.service.ts:514 `if (!this.bundle.admin)`
    // ⇒ 判的是通道存在性。插件拿到 repos 就自带 repos.admin ⇒ 该门恒通过。
    const pkg = await bundle.admin!.fullExport();
    expect(pkg.data.projects.length).toBeGreaterThan(0);

    const res = await bundle.admin!.replaceAllImport({
      ...pkg,
      data: { ...pkg.data, projects: [], stages: [], tasks: [] },
    });
    expect(res.renumbered).toBe(0);
    expect((await bundle.projects.list()).length).toBe(0); // ← 整库已空
  });

  it('★ 洞：repos.admin.fullExport 可导出整库 13 表（含成员数据）', async () => {
    const pkg = await bundle.admin!.fullExport();
    expect(pkg.data.members.length).toBe(2);
    expect(pkg.data.projects.every((p: Project) => typeof p.kind === 'string')).toBe(true);
  });
});
