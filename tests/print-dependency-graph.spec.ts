/**
 * D 版 P2 · 依赖网络算法单测（02 文档 §7 / §9「依赖图处理无依赖、缺失引用、
 * 循环依赖」；产品决策文档「批 2」点名依赖图为最高风险，故算法先于页面锁死）。
 *
 * ── 为什么算法必须独立单测 ──
 * 分层 DAG 的 correctness 在纸面上看不出来：层算错了图还是那张图，只是
 * 连线方向可疑；环漏标了只是少一条虚线。这些「沉默的错误」只有纯函数断言
 * 能抓住。故本 spec 不碰 React / DOM（node 环境），五种图形状逐条断言。
 *
 * 锁的六条：
 *   ① 无依赖：全落第 0 层、按 taskNo 排序（输入乱序也算）、零边零异常；
 *   ② 单链：层数 = 节点数、逐层单点；
 *   ③ 菱形：同层双点按 taskNo 排序、汇点层 = max(前驱层)+1；
 *   ④ 缺失引用：只计数不建边、**输出里不出现目标 id**（权限纪律）；
 *   ⑤ 循环：不崩溃、回边标记为异常、移除回边后仍全员分层（回退 taskNo 序）；
 *   ⑥ 确定性：同数据两次构建逐字节一致（02 §7「稳定布局」的可测形式）。
 * 另加权限用例：普通成员 VM 里，指向隐藏阶段任务的依赖只出汇总警示，
 * 输出不含目标 id / 标题任何信息（与 print-view-model.spec 的 VM 过滤衔接）。
 */

import { describe, it, expect } from 'vitest';

import { buildDependencyGraph } from '../src/print/pages/data-editorial/dependency-graph';
import { buildPrintViewModel } from '../src/print/adapters/project-print-adapter';
import {
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ScheduleBasis,
  StageStatus,
  TaskStatus,
} from '../src/core/types/enums';
import type { Member, Project, Stage, Task } from '../src/core/types/entities';
import type { PrintTaskVM } from '../src/print/model/print-view-model';

/* ---------------------------------------------------------------- 合成 VM 任务 */

let seq = 0;
function vmTask(
  id: string,
  taskNo: number,
  status: TaskStatus,
  dependsOn: string[] = [],
): PrintTaskVM {
  seq += 1;
  return {
    id,
    taskNo,
    title: `任务${taskNo}`,
    status,
    assigneeNames: [],
    dueDate: null,
    dependsOn,
    artifactCount: 0,
    stageId: `stg_${seq}`,
    overdue: false,
    source: 'human',
    runId: null,
  };
}

const layerOf = (g: ReturnType<typeof buildDependencyGraph>, id: string): number =>
  g.nodes.find((n) => n.id === id)!.layer;

/* ---------------------------------------------------------------- 五种图 */

describe('依赖网络 · 确定性分层 DAG（02 §7）', () => {
  it('① 无依赖：全落第 0 层、按 taskNo 排序（输入乱序也算）、零边零异常', () => {
    // 刻意乱序输入：稳定序必须由 taskNo 决定，与输入顺序无关
    const g = buildDependencyGraph([
      vmTask('t5', 1005, TaskStatus.Done),
      vmTask('t1', 1001, TaskStatus.InProgress),
      vmTask('t3', 1003, TaskStatus.Blocked),
    ]);
    expect(g.edges).toHaveLength(0);
    expect(g.layerCount).toBe(1);
    expect(g.layers[0]!.map((n) => n.taskNo)).toEqual([1001, 1003, 1005]);
    expect(g.missingRefCount).toBe(0);
    expect(g.cycleEdgeCount).toBe(0);
    expect(g.abnormalNodeCount).toBe(0);
    for (const n of g.nodes) expect(n.layer).toBe(0);
  });

  it('② 单链：层数 = 节点数、逐层单点、边全部正常', () => {
    const g = buildDependencyGraph([
      vmTask('a', 1001, TaskStatus.Done),
      vmTask('b', 1002, TaskStatus.InProgress, ['a']),
      vmTask('c', 1003, TaskStatus.Ready, ['b']),
      vmTask('d', 1004, TaskStatus.Draft, ['c']),
    ]);
    expect(g.layerCount).toBe(4);
    expect(g.layers.map((l) => l.length)).toEqual([1, 1, 1, 1]);
    expect(layerOf(g, 'a')).toBe(0);
    expect(layerOf(g, 'b')).toBe(1);
    expect(layerOf(g, 'c')).toBe(2);
    expect(layerOf(g, 'd')).toBe(3);
    expect(g.edges).toHaveLength(3);
    expect(g.edges.every((e) => !e.cycle)).toBe(true);
    expect(g.cycleEdgeCount).toBe(0);
  });

  it('③ 菱形：同层双点按 taskNo 排序、汇点层 = max(前驱层)+1', () => {
    const g = buildDependencyGraph([
      vmTask('a', 1001, TaskStatus.Done),
      vmTask('b', 1002, TaskStatus.InProgress, ['a']),
      vmTask('c', 1003, TaskStatus.Review, ['a']),
      vmTask('d', 1004, TaskStatus.Draft, ['b', 'c']),
    ]);
    expect(g.layerCount).toBe(3);
    expect(g.layers[0]!.map((n) => n.id)).toEqual(['a']);
    // 同层排序：taskNo 升序（b 1002 在 c 1003 前），与 dependsOn 书写顺序无关
    expect(g.layers[1]!.map((n) => n.id)).toEqual(['b', 'c']);
    expect(g.layers[2]!.map((n) => n.id)).toEqual(['d']);
    expect(layerOf(g, 'd')).toBe(2);
    expect(g.edges).toHaveLength(4);
    expect(g.abnormalNodeCount).toBe(0);
  });

  it('④ 缺失引用：只计数不建边；输出不出现目标 id（权限纪律）', () => {
    const g = buildDependencyGraph([
      vmTask('a', 1001, TaskStatus.Done),
      // b 依赖一个可见任务 + 两个指不到的（不存在 / 不可见）
      vmTask('b', 1002, TaskStatus.InProgress, ['a', 'tsk_gone', 'tsk_hidden']),
      vmTask('c', 1003, TaskStatus.Draft, ['tsk_ghost']),
    ]);
    // 只画可见任务之间的边
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ from: 'a', to: 'b', cycle: false });
    // 缺失引用按节点计数、汇总
    expect(g.nodes.find((n) => n.id === 'b')!.missingRefs).toBe(2);
    expect(g.nodes.find((n) => n.id === 'c')!.missingRefs).toBe(1);
    expect(g.missingRefCount).toBe(3);
    expect(g.abnormalNodeCount).toBe(2);
    // 权限纪律：目标 id 一个字节都不进输出（警示只含计数）
    const dumped = JSON.stringify(g);
    expect(dumped).not.toContain('tsk_gone');
    expect(dumped).not.toContain('tsk_hidden');
    expect(dumped).not.toContain('tsk_ghost');
    // 层数不受缺失引用影响（a=0, b/c=1）
    expect(g.layerCount).toBe(2);
  });

  it('⑤ 循环：不崩溃；回边标记异常；移除回边后全员分层（回退 taskNo 序）', () => {
    const g = buildDependencyGraph([
      vmTask('a', 1001, TaskStatus.Done, ['c']),
      vmTask('b', 1002, TaskStatus.InProgress, ['a']),
      vmTask('c', 1003, TaskStatus.Review, ['b']),
      // d 不在环上：依赖环内节点，仍按拓扑正常分层
      vmTask('d', 1004, TaskStatus.Draft, ['b']),
    ]);
    // 边：c→a / a→b / b→c / b→d（dependsOn 语义反环）
    expect(g.edges).toHaveLength(4);
    // 恰好一条回边（DFS 从最低 taskNo 起跳、邻居按 taskNo 访问 ⇒ 确定性）
    expect(g.cycleEdgeCount).toBe(1);
    const back = g.edges.filter((e) => e.cycle);
    expect(back).toEqual([{ from: 'c', to: 'a', cycle: true }]);
    // 环上三节点全部标记异常；d 不受牵连
    expect(g.nodes.find((n) => n.id === 'a')!.inCycle).toBe(true);
    expect(g.nodes.find((n) => n.id === 'b')!.inCycle).toBe(true);
    expect(g.nodes.find((n) => n.id === 'c')!.inCycle).toBe(true);
    expect(g.nodes.find((n) => n.id === 'd')!.inCycle).toBe(false);
    expect(g.abnormalNodeCount).toBe(3);
    // 移除回边后 a→b→c 成链：层 0/1/2（回退到 taskNo 序的确定性结果）
    expect(layerOf(g, 'a')).toBe(0);
    expect(layerOf(g, 'b')).toBe(1);
    expect(layerOf(g, 'c')).toBe(2);
    expect(layerOf(g, 'd')).toBe(2);
    // 不抛异常即通过（函数在任何形状下都有确定输出）
    expect(g.nodes).toHaveLength(4);
  });

  it('⑤b 自依赖：1-环同样标记异常、不卡死', () => {
    const g = buildDependencyGraph([
      vmTask('a', 1001, TaskStatus.InProgress, ['a']),
      vmTask('b', 1002, TaskStatus.Draft, ['a']),
    ]);
    expect(g.cycleEdgeCount).toBe(1);
    expect(g.edges).toEqual(
      expect.arrayContaining([{ from: 'a', to: 'a', cycle: true }]),
    );
    expect(layerOf(g, 'a')).toBe(0);
    expect(layerOf(g, 'b')).toBe(1);
  });

  it('⑤c 环途经节点：不被回边两端漏标（SCC 刻画，非回边端点）', () => {
    // 两个环共享路径：1→2→3→1 与 1→2→4→3→1。
    // DFS 只找到一条回边（t3→t1；t4→t3 在 DFS 里是横向边），回边两端点
    // 不含 t2/t4——但四节点同属一个强连通分量，全部卡在环里。
    const g = buildDependencyGraph([
      vmTask('t1', 1001, TaskStatus.Done, ['t3']),
      vmTask('t2', 1002, TaskStatus.InProgress, ['t1']),
      vmTask('t3', 1003, TaskStatus.Review, ['t2', 't4']),
      vmTask('t4', 1004, TaskStatus.Draft, ['t2']),
    ]);
    expect(g.cycleEdgeCount).toBe(1);
    expect(g.edges.filter((e) => e.cycle)).toEqual([{ from: 't3', to: 't1', cycle: true }]);
    for (const id of ['t1', 't2', 't3', 't4']) {
      expect(g.nodes.find((n) => n.id === id)!.inCycle, `${id} 应在环上`).toBe(true);
    }
    expect(g.abnormalNodeCount).toBe(4);
    // 移除回边后 1→2→{3,4}、4→3：层 0/1/2/3（全部有层，不卡死）
    expect(layerOf(g, 't1')).toBe(0);
    expect(layerOf(g, 't2')).toBe(1);
    expect(layerOf(g, 't4')).toBe(2);
    expect(layerOf(g, 't3')).toBe(3);
  });

  it('⑥ 确定性：同数据（含乱序输入）两次构建逐字节一致', () => {
    const input = [
      vmTask('a', 1001, TaskStatus.Done),
      vmTask('b', 1002, TaskStatus.InProgress, ['a']),
      vmTask('c', 1003, TaskStatus.Review, ['a']),
      vmTask('d', 1004, TaskStatus.Draft, ['b', 'c']),
      vmTask('e', 1005, TaskStatus.Blocked, ['d', 'tsk_gone']),
    ];
    const g1 = buildDependencyGraph(input);
    const g2 = buildDependencyGraph([...input].reverse());
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  });
});

/* ---------------------------------------------------------------- 权限用例 */

describe('依赖网络 · 权限用例（普通成员 VM：不可见任务的依赖只出警示不出目标）', () => {
  const TODAY = '2026-10-09';
  const PROJECT_ID = 'proj_dep_perm';
  const ADMIN_ID = 'm-dep-admin';
  const MEMBER_ID = 'm-dep-member';

  const PROJECT: Project = {
    id: PROJECT_ID,
    name: '云栖·湖畔茶室',
    address: '城区某路 1 号',
    clientName: '客户甲',
    contractAmount: 880000,
    signedAt: '2026-01-01T00:00:00Z',
    plannedStartAt: '2026-01-01T00:00:00Z',
    plannedEndAt: '2026-03-01T23:59:59Z',
    coverColor: null,
    shortLabel: null,
    stagePresetKey: null,
    stageTemplateVersion: 0,
    scheduleBasis: ScheduleBasis.Calendar,
    domain: null,
    kind: 'human',
    ownerMemberId: null,
    status: ProjectStatus.Active,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const MEMBERS: Member[] = [
    {
      id: ADMIN_ID,
      name: '负责人甲',
      role: '项目负责人',
      contact: null,
      avatarColor: '#3D6B5B',
      active: true,
      roleKind: MemberRoleKind.Admin,
      passwordHash: null,
      actorKind: MemberActorKind.Human,
      agentKind: null,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: MEMBER_ID,
      name: '成员乙',
      role: '协作成员',
      contact: null,
      avatarColor: '#3D6B5B',
      active: true,
      roleKind: MemberRoleKind.Member,
      passwordHash: null,
      actorKind: MemberActorKind.Human,
      agentKind: null,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const STAGES: Stage[] = [
    {
      id: 'stg_dep_1',
      projectId: PROJECT_ID,
      orderIndex: 1,
      templateKey: null,
      colorIndex: 1,
      customColor: null,
      name: '阶段一',
      ratioPercent: 60,
      startAt: '2026-01-05T00:00:00Z',
      endAt: '2026-01-20T23:59:59Z',
      status: StageStatus.InProgress,
      ownerId: ADMIN_ID,
      visible: true,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'stg_dep_hidden',
      projectId: PROJECT_ID,
      orderIndex: 2,
      templateKey: null,
      colorIndex: 2,
      customColor: null,
      name: '隐藏阶段',
      ratioPercent: 40,
      startAt: '2026-01-21T00:00:00Z',
      endAt: '2026-02-20T23:59:59Z',
      status: StageStatus.NotStarted,
      ownerId: ADMIN_ID,
      // 隐藏阶段：任何角色都不进 VM（visible 过滤先于角色收窄）
      visible: false,
      resourcePath: null,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  /** 可见任务：依赖一个隐藏阶段下的任务 + 一个不存在的 id */
  const TASKS: Task[] = [
    {
      id: 'tsk_dep_1',
      taskNo: 1001,
      projectId: PROJECT_ID,
      stageId: 'stg_dep_1',
      title: '可见任务甲',
      done: false,
      assigneeId: MEMBER_ID,
      assigneeIds: [MEMBER_ID],
      dueDate: null,
      source: 'human',
      externalId: null,
      agentId: null,
      status: TaskStatus.InProgress,
      description: null,
      dependsOn: ['tsk_dep_hidden', 'tsk_dep_ghost'],
      artifacts: [],
      startAt: null,
      claimedAt: null,
      runId: null,
      orderIndex: 1,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'tsk_dep_hidden',
      taskNo: 1002,
      projectId: PROJECT_ID,
      stageId: 'stg_dep_hidden',
      title: '隐藏阶段任务',
      done: false,
      assigneeId: ADMIN_ID,
      assigneeIds: [ADMIN_ID],
      dueDate: null,
      source: 'human',
      externalId: null,
      agentId: null,
      status: TaskStatus.Ready,
      description: null,
      dependsOn: [],
      artifacts: [],
      startAt: null,
      claimedAt: null,
      runId: null,
      orderIndex: 1,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  function memberVm(): ReturnType<typeof buildPrintViewModel> {
    return buildPrintViewModel({
      project: PROJECT,
      stages: STAGES,
      tasks: TASKS,
      members: MEMBERS,
      stageLogs: [],
      role: MemberRoleKind.Member,
      currentMemberId: MEMBER_ID,
      todayIso: TODAY,
      now: new Date('2026-10-09T07:30:00Z'),
    });
  }

  it('成员 VM：隐藏阶段任务不进 VM；依赖只出汇总警示，不泄露目标 id / 标题', () => {
    const vm = memberVm();
    // 前置：VM 层就已过滤（可见范围 + visible 双重闸门）
    expect(vm.tasks.map((t) => t.id)).toEqual(['tsk_dep_1']);
    expect(vm.viewerRole).toBe('member');

    const g = buildDependencyGraph(vm.tasks);
    // 两条依赖都指不到 ⇒ 汇总警示计数
    expect(g.missingRefCount).toBe(2);
    expect(g.edges).toHaveLength(0);
    // 输出不含目标 id、标题任何信息（「引用不可用」只有计数）
    const dumped = JSON.stringify(g);
    expect(dumped).not.toContain('tsk_dep_hidden');
    expect(dumped).not.toContain('tsk_dep_ghost');
    expect(dumped).not.toContain('隐藏阶段任务');
    // 警示文案由页面层消费计数渲染；算法层保证「无可泄露字段」
    expect(g.nodes.find((n) => n.id === 'tsk_dep_1')!.missingRefs).toBe(2);
  });

  it('管理员 VM：同样看不到隐藏阶段（visible 过滤先于角色），口径一致', () => {
    const vm = buildPrintViewModel({
      project: PROJECT,
      stages: STAGES,
      tasks: TASKS,
      members: MEMBERS,
      stageLogs: [],
      role: MemberRoleKind.Admin,
      currentMemberId: ADMIN_ID,
      todayIso: TODAY,
      now: new Date('2026-10-09T07:30:00Z'),
    });
    expect(vm.tasks.map((t) => t.id)).toEqual(['tsk_dep_1']);
    const g = buildDependencyGraph(vm.tasks);
    expect(g.missingRefCount).toBe(2);
  });
});
