/**
 * DAG 求解与 Agent 契约纯函数（v0.6 · N19 / HF-01 / HF-02 / 设计文档 T02 DoD）。
 *
 * 锁死四件事：
 *   1. 环检测（Kahn 残余节点法）：A→B→C→A 被标为环成员，**不抛异常**（防看板白屏）；
 *   2. 1000 节点线性深链：不栈溢出（禁止递归 DFS 的硬验收）、耗时 < 50ms；
 *   3. Ready 过滤与排序：deps 全 done ∧ 未认领 ∧ 非环；拓扑层 → dueDate → orderIndex；
 *   4. payload 契约：agentKind 开放字符串通过校验；错误文案口径对齐 validateBackupJson；
 *      handoff 不含 members 任何字段；Markdown 子集解析。
 */

import { describe, it, expect } from 'vitest';

import {
  buildDependencyGraph,
  computeReadyTasks,
  detectCycles,
  topoLayers,
} from '../src/core/agent/dag';
import { buildHandoffBundle } from '../src/core/agent/handoff';
import { parseMarkdownTasks } from '../src/core/agent/markdown-ingest';
import { tryValidateAgentPayload, validateAgentPayload } from '../src/core/types/agent-payload';
import { TaskStatus } from '../src/core/types/enums';
import type { Task } from '../src/core/types/entities';

let seq = 0;
function makeTask(partial: Partial<Task> & { title: string }): Task {
  seq += 1;
  const id = partial.id ?? `tsk_dag_${seq}`;
  return {
    id,
    projectId: 'p1',
    stageId: 's1',
    done: false,
    assigneeId: null,
    assigneeIds: [],
    dueDate: null,
    source: 'agent',
    externalId: null,
    agentId: null,
    status: TaskStatus.Ready,
    description: null,
    dependsOn: [],
    artifacts: [],
    startAt: null,
    claimedAt: null,
    orderIndex: seq,
    revision: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

describe('dag：环检测（Kahn 残余节点法，非递归 DFS）', () => {
  it('A→B→C→A 全员入 cyclicIds，detectCycles 命中，computeReadyTasks 不抛异常', () => {
    const a = makeTask({ id: 'tsk_a', title: 'A', dependsOn: ['tsk_c'] });
    const b = makeTask({ id: 'tsk_b', title: 'B', dependsOn: ['tsk_a'] });
    const c = makeTask({ id: 'tsk_c', title: 'C', dependsOn: ['tsk_b'] });
    const tasks = [a, b, c];
    const graph = buildDependencyGraph(tasks);
    expect(detectCycles(graph)).toBe(true);
    const { cyclicIds } = topoLayers(graph);
    expect(cyclicIds).toEqual(new Set(['tsk_a', 'tsk_b', 'tsk_c']));
    // Ready 计算侧：环命中不抛异常（导入侧才整批拒绝）
    expect(() => computeReadyTasks(tasks, '2026-09-09')).not.toThrow();
    const ready = computeReadyTasks(tasks, '2026-09-09');
    expect(ready.ready).toHaveLength(0);
    expect(ready.blocked).toHaveLength(0); // 环成员不进 blocked（有独立告警通道）
  });

  it('环外任务不受牵连（部分环 + 部分正常）', () => {
    const loopA = makeTask({ id: 'tsk_l1', title: '环1', dependsOn: ['tsk_l2'] });
    const loopB = makeTask({ id: 'tsk_l2', title: '环2', dependsOn: ['tsk_l1'] });
    const ok = makeTask({ id: 'tsk_ok', title: '正常', dependsOn: ['tsk_l1'] });
    const { cyclicIds, layerIndex } = topoLayers(buildDependencyGraph([loopA, loopB, ok]));
    expect(cyclicIds.has('tsk_l1')).toBe(true);
    expect(cyclicIds.has('tsk_l2')).toBe(true);
    // 环的下游也被困住（indegree 永不归零）——防御性正确
    expect(cyclicIds.has('tsk_ok')).toBe(true);
    expect(layerIndex.has('tsk_ok')).toBe(false);
  });

  it('无环：detectCycles=false，全部节点分层', () => {
    const a = makeTask({ id: 'tsk_1', title: 'A', dependsOn: [] });
    const b = makeTask({ id: 'tsk_2', title: 'B', dependsOn: ['tsk_1'] });
    const graph = buildDependencyGraph([a, b]);
    expect(detectCycles(graph)).toBe(false);
    expect(topoLayers(graph).cyclicIds.size).toBe(0);
  });

  it('1000 节点线性深链：不栈溢出、<50ms（禁递归的硬验收）', () => {
    const n = 1000;
    const tasks: Task[] = [];
    for (let i = 0; i < n; i += 1) {
      tasks.push(
        makeTask({
          id: `tsk_deep_${i}`,
          title: `深链 ${i}`,
          dependsOn: i === 0 ? [] : [`tsk_deep_${i - 1}`],
        }),
      );
    }
    const started = performance.now();
    const { layerIndex, cyclicIds } = topoLayers(buildDependencyGraph(tasks));
    const elapsed = performance.now() - started;
    expect(cyclicIds.size).toBe(0);
    expect(layerIndex.size).toBe(n);
    expect(layerIndex.get('tsk_deep_999')).toBe(999); // 层号 = 深度
    expect(elapsed).toBeLessThan(50);
  });

  it('已完成前驱不构成约束（taskIsDone 口径，兼容 status 缺失的老夹具）', () => {
    const a = makeTask({ id: 'tsk_d1', title: '已完成', status: TaskStatus.Done, done: true });
    const b = makeTask({ id: 'tsk_d2', title: '后续', dependsOn: ['tsk_d1'] });
    const { ready } = computeReadyTasks([a, b], '2026-09-09');
    expect(ready.map((t) => t.id)).toEqual(['tsk_d2']);
  });

  it('跨项目/不存在的引用被静默剔除（不阻塞、不报错）', () => {
    const t = makeTask({ id: 'tsk_x', title: 'X', dependsOn: ['tsk_不存在的引用'] });
    const { ready, cyclicIds } = computeReadyTasks([t], '2026-09-09');
    expect(ready).toHaveLength(1);
    expect(cyclicIds.size).toBe(0);
  });
});

describe('dag：Ready 过滤与排序', () => {
  it('ready 只含：status=ready ∧ deps 全 done ∧ claimedAt=null ∧ 非环', () => {
    const dep = makeTask({ id: 'tsk_dep', title: '前驱', status: TaskStatus.InProgress });
    const claimed = makeTask({ id: 'tsk_claimed', title: '已认领', claimedAt: '2026-09-01T00:00:00.000Z' });
    const draft = makeTask({ id: 'tsk_draft', title: '草稿', status: TaskStatus.Draft });
    const waiting = makeTask({ id: 'tsk_wait', title: '等前驱', dependsOn: ['tsk_dep'] });
    const free = makeTask({ id: 'tsk_free', title: '立即可做' });

    const { ready, blocked } = computeReadyTasks(
      [dep, claimed, draft, waiting, free],
      '2026-09-09',
    );
    expect(ready.map((t) => t.id)).toEqual(['tsk_free']);
    const waitingEntry = blocked.find((b) => b.task.id === 'tsk_wait');
    expect(waitingEntry).toBeDefined();
    expect(waitingEntry!.blockedBy).toEqual([{ id: 'tsk_dep', title: '前驱' }]);
  });

  it('排序：dueDate 优先（缺失排最后），同截止按 orderIndex；层号仅作次级稳定键', () => {
    // 注：已完成前驱不建边，故 Ready 任务的拓扑层恒为 0——层号是「同批导入
    // 未完成依赖」场景下的稳定次级键；Ready 内实际排序由 dueDate / orderIndex 决定。
    const early = makeTask({ id: 'tsk_s2', title: '早截止', dueDate: '2026-09-10', orderIndex: 9 });
    const late = makeTask({ id: 'tsk_s1', title: '晚截止', dueDate: '2026-12-31', orderIndex: 1 });
    const noDue = makeTask({ id: 'tsk_s3', title: '无截止', orderIndex: 2 });
    const tie1 = makeTask({ id: 'tsk_s4', title: '同截止A', dueDate: '2026-09-10', orderIndex: 1 });
    const tie2 = makeTask({ id: 'tsk_s5', title: '同截止B', dueDate: '2026-09-10', orderIndex: 2 });
    const { ready } = computeReadyTasks([late, early, noDue, tie2, tie1], '2026-09-09');
    expect(ready.map((t) => t.id)).toEqual(['tsk_s4', 'tsk_s5', 'tsk_s2', 'tsk_s1', 'tsk_s3']);
  });
});

describe('agent-payload：契约校验（错误文案口径对齐 validateBackupJson）', () => {
  const producer = { actorKind: 'agent' as const, agentKind: 'workbuddy', agentName: 'WorkBuddy-01', runId: 'run-007' };
  const validPayload = {
    schema: 'idplan-agent-payload/v1',
    projectId: 'proj_1',
    stageId: null,
    producedBy: producer,
    tasks: [
      {
        externalId: 'workbuddy:run-007:t12',
        title: '实现 payload 校验器',
        dependsOnExternal: [],
        artifacts: [{ title: 'a.ts', path: 'src/a.ts', url: null, note: null }],
      },
    ],
  };

  it('合法 payload 通过且缺省字段归一（status=draft / artifacts=[]）', () => {
    const payload = validateAgentPayload(validPayload);
    expect(payload.tasks[0]!.status).toBe(TaskStatus.Draft);
    expect(payload.tasks[0]!.artifacts[0]!.kind).toBe('other');
    expect(payload.tasks[0]!.description).toBeNull();
  });

  it('★ agentKind 传入全新 Harness 名仍通过校验（开放字符串硬约束）', () => {
    const payload = validateAgentPayload({
      ...validPayload,
      producedBy: { ...producer, agentKind: '某个全新的agent' },
    });
    expect(payload.producedBy.agentKind).toBe('某个全新的agent');
  });

  it('缺 externalId → 抛 Validation，文案以「payload 校验失败：<path> <message>」', () => {
    const broken = {
      ...validPayload,
      tasks: [{ title: '缺幂等键' }],
    };
    try {
      validateAgentPayload(broken);
      throw new Error('should not reach');
    } catch (err) {
      // ChangxiaError.message 前缀为 `[changxia:validation] `，文案主体须逐字对齐
      expect((err as { message?: string }).message).toContain(
        'payload 校验失败：tasks.0.externalId',
      );
      expect((err as { code?: string }).code).toBe('validation');
    }
  });

  it('schema 标识错误 → 拒绝；tryValidate 返回逐条 issue（供 UI 展示行号定位）', () => {
    expect(() => validateAgentPayload({ ...validPayload, schema: 'other/v9' })).toThrowError(/payload 校验失败/);
    const res = tryValidateAgentPayload({ ...validPayload, tasks: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.length).toBeGreaterThan(0);
  });
});

describe('handoff：五段式输出与安全边界（HF-04）', () => {
  const ready = [
    makeTask({
      id: 'tsk_h1',
      title: '实现 payload 校验器',
      externalId: 'workbuddy:run-007:t12',
      dueDate: '2026-09-16',
      description: '## 做什么\n- zod schema',
      artifacts: [{ id: 'art_1', kind: 'file', title: 'payload.schema.ts', path: 'src/a.ts', url: null, note: null }],
    }),
  ];
  const blocked = [
    {
      task: makeTask({ id: 'tsk_h2', title: '服务端序列化', dependsOn: ['tsk_h1'] }),
      blockedBy: [{ id: 'tsk_h1', title: '实现 payload 校验器' }],
    },
  ];

  it('包含标题头 / Ready 区 / 阻塞区 / 回填格式，且含依赖与 artifacts 信息', () => {
    const md = buildHandoffBundle({
      projectName: 'ID Plan v0.6',
      generatedAt: '2026-09-09T08:00:00.000Z',
      ready,
      blocked,
      assigneeLabels: { mem_1: '许清楚' },
      agentKindLabel: 'codex',
    });
    expect(md).toContain('# ID Plan · Agent Board — handoff bundle');
    expect(md).toContain('项目：ID Plan v0.6');
    expect(md).toContain('Ready 任务：1 条');
    expect(md).toContain('## 你现在该做的事（拓扑序 + 截止日）');
    expect(md).toContain('### 1. [tsk_h1 | workbuddy:run-007:t12] 实现 payload 校验器');
    expect(md).toContain('剩余 7 天');
    expect(md).toContain('artifacts 要求：payload.schema.ts');
    expect(md).toContain('上游留给你的话');
    expect(md).toContain('## 暂时不要碰（被阻塞）');
    expect(md).toContain('服务端序列化 ← 依赖「实现 payload 校验器」未完成');
    expect(md).toContain('## 回填格式');
    expect(md).toContain('idplan-agent-payload/v1');
  });

  it('★ 绝不泄露 members 字段（类型层拦截 + 输出负向断言）', () => {
    const md = buildHandoffBundle({
      projectName: 'P',
      generatedAt: '2026-09-09T08:00:00.000Z',
      ready,
      blocked,
      // 故意传一个「看起来像成员数据」的映射——也只可能是纯字符串
      assigneeLabels: { mem_1: '许清楚' },
    });
    expect(md).not.toContain('passwordHash');
    expect(md).not.toContain('contact');
    expect(md).not.toContain('members');
  });

  it('「前置已完成」按 doneTaskTitles 如实列出，无数据时整行省略（QA 返工 🟡-2）', () => {
    // ready 任务带一个已完成前置（tsk_done1 不在 ready/blocked 中——done 任务
    // 从不进入这两个区，旧版在 ready 里找它永远找不到，才有了恒显的兜底假文案）
    const readyWithDoneDep = [
      makeTask({
        id: 'tsk_h3',
        title: '联调验收',
        dependsOn: ['tsk_done1'],
      }),
    ];
    const input = {
      projectName: 'P',
      generatedAt: '2026-09-09T08:00:00.000Z',
      ready: readyWithDoneDep,
      blocked,
      assigneeLabels: { mem_1: '许清楚' },
    };

    // 传入 done 映射 → 如实列出 ✓
    const withDone = buildHandoffBundle({
      ...input,
      doneTaskTitles: new Map([['tsk_done1', '已完成的前置活']]),
    });
    expect(withDone).toContain('前置已完成：已完成的前置活 ✓');
    expect(withDone).not.toContain('（见看板依赖区）');

    // 缺省（不传 doneTaskTitles）→ 前置行整体省略，绝不回退兜底假文案
    const withoutDone = buildHandoffBundle(input);
    expect(withoutDone).not.toContain('前置已完成');
    expect(withoutDone).not.toContain('（见看板依赖区）');
  });
});

describe('markdown-ingest：兼容子集解析', () => {
  it('解析 # 标题 / deps: / - [ ] / - [x]，externalId 按「任务身份」合成（不含 runId）', () => {
    const md = `# 实现序列化层
deps: workbuddy:run-007:t09
- [ ] 待办说明一
- [x] 已完成项

# 复核看板
- [x] 验收`;

    const payload = parseMarkdownTasks(md, {
      actorKind: 'agent',
      agentKind: 'deepseek',
      agentName: 'DeepSeek-01',
      runId: 'run-042',
    });
    expect(payload.schema).toBe('idplan-agent-payload/v1');
    expect(payload.tasks).toHaveLength(2);
    // ★ v0.7 P0-2：键形如 `${agentKind}:md-${标题哈希}`，**不含 runId、不含行序**
    expect(payload.tasks[0]!.externalId).toMatch(/^deepseek:md-[0-9a-f]{8}$/);
    expect(payload.tasks[0]!.externalId).not.toContain('run-042');
    expect(payload.tasks[0]!.externalId).not.toContain('md-1');
    expect(payload.tasks[0]!.title).toBe('实现序列化层');
    expect(payload.tasks[0]!.dependsOnExternal).toEqual(['workbuddy:run-007:t09']);
    expect(payload.tasks[0]!.status).toBe(TaskStatus.Done); // 末尾 - [x] 覆盖
    expect(payload.tasks[0]!.description).toContain('待办说明一');
    expect(payload.tasks[1]!.externalId).toMatch(/^deepseek:md-[0-9a-f]{8}$/);
    expect(payload.tasks[1]!.status).toBe(TaskStatus.Done);
    // 两条不同标题 → 两个不同键
    expect(payload.tasks[1]!.externalId).not.toBe(payload.tasks[0]!.externalId);
    // runId 的归属是 producedBy（溯源用），不是幂等键
    expect(payload.producedBy.runId).toBe('run-042');
  });

  /**
   * ★ v0.7 P0-1 / P0-2 的不变量 —— 这几条才是本功能的「意义所在」。
   *
   * 为什么必须单独锁：旧实现（`${agentKind}:${runId}:md-${index}`）能通过上面那条
   * 格式测试（它只验了形状），却在真实使用里**必然翻车**：
   *   - 换一天运行 → runId 变 → 整批重建；
   *   - 文档开头插一条 → index 后移 → 整批重建。
   * 后果不是「没帮忙」而是**帮倒忙**：用户每次同步都拿到一份重复任务。
   * 所以这里直接断言「**跨 runId**」「**跨行序**」两个维度上键稳定。
   */
  describe('★ 幂等键只由任务身份决定（P0-1 / P0-2）', () => {
    const base = {
      actorKind: 'agent' as const,
      agentKind: 'workbuddy',
      agentName: 'WorkBuddy',
    };

    it('同一份文档换 runId（= 换一天同步）→ externalId 逐条不变', () => {
      const md = `# 现场勘测
- [ ] 拍照

# 出平面方案
- [ ] 初稿`;
      const day1 = parseMarkdownTasks(md, { ...base, runId: 'run-2026-09-13' });
      const day2 = parseMarkdownTasks(md, { ...base, runId: 'run-2026-09-14' });

      expect(day2.tasks.map((t) => t.externalId)).toEqual(day1.tasks.map((t) => t.externalId));
    });

    it('在文档开头插入一条新任务 → 既有任务的 externalId 不变（行序不是身份）', () => {
      const before = `# 现场勘测
- [ ] 拍照

# 出平面方案
- [ ] 初稿`;
      const after = `# 补签合同
- [ ] 盖章

${before}`;
      const a = parseMarkdownTasks(before, { ...base, runId: 'r1' });
      const b = parseMarkdownTasks(after, { ...base, runId: 'r2' });

      // 只多了一条；原有的两条键**逐条相同**（顺序也保持）
      expect(b.tasks).toHaveLength(a.tasks.length + 1);
      expect(b.tasks.map((t) => t.externalId)).toEqual([
        expect.stringMatching(/^workbuddy:md-[0-9a-f]{8}$/),
        ...a.tasks.map((t) => t.externalId),
      ]);
    });

    it('重排文档顺序 → 每条任务仍拿到自己那把键（键跟着标题走，不跟位置）', () => {
      const ab = `# 甲
- [ ]

# 乙
- [ ]`;
      const ba = `# 乙
- [ ]

# 甲
- [ ]`;
      const p1 = parseMarkdownTasks(ab, { ...base, runId: 'r1' });
      const p2 = parseMarkdownTasks(ba, { ...base, runId: 'r2' });

      const keyOf = (p: typeof p1, title: string): string =>
        p.tasks.find((t) => t.title === title)!.externalId;

      expect(keyOf(p2, '甲')).toBe(keyOf(p1, '甲'));
      expect(keyOf(p2, '乙')).toBe(keyOf(p1, '乙'));
    });

    it('标题规范化：前后空白 / 连续多空格归一，全角空格 ≡ 半角空格', () => {
      const clean = parseMarkdownTasks('# 现场 勘测\n- [ ]', { ...base, runId: 'r1' });

      // 前后空白 + 连续多个空格 → 压成单空格，与基准同键
      const messy = parseMarkdownTasks('#    现场   勘测   \n- [ ]', { ...base, runId: 'r2' });
      expect(messy.tasks[0]!.externalId).toBe(clean.tasks[0]!.externalId);

      // 全角空格经 NFKC 归一为半角空格 → 与「半角单空格」同键
      const wide = parseMarkdownTasks('# 现场　勘测\n- [ ]', { ...base, runId: 'r3' });
      expect(wide.tasks[0]!.externalId).toBe(clean.tasks[0]!.externalId);

      // ★ 反例对照组：真的多了一个词，必须**不同键**
      //   （少了这条，把 normalizeTitle 写成「删掉所有空格」也能让上面两条全绿）
      const different = parseMarkdownTasks('# 现场勘测\n- [ ]', { ...base, runId: 'r4' });
      expect(different.tasks[0]!.externalId).not.toBe(clean.tasks[0]!.externalId);
    });

    it('同名标题 → 首条用 base，其后追加 -2 / -3（**仅此情形**才引入序依赖）', () => {
      const md = `# 复核
- [ ]

# 复核
- [ ]

# 复核
- [ ]`;
      const p = parseMarkdownTasks(md, { ...base, runId: 'r1' });
      const ids = p.tasks.map((t) => t.externalId);

      expect(ids[0]).toMatch(/^workbuddy:md-[0-9a-f]{8}$/);
      expect(ids[1]).toBe(`${ids[0]}-2`);
      expect(ids[2]).toBe(`${ids[0]}-3`);
      // 三把键互不相同（若撞成同一把，三条任务会被幂等合并成一条）
      expect(new Set(ids).size).toBe(3);
    });

    it('不同 agentKind 写同名标题 → 不互相抢占（键以 agentKind 为前缀隔离）', () => {
      const md = '# 复核\n- [ ]';
      const wb = parseMarkdownTasks(md, { ...base, agentKind: 'workbuddy', runId: 'r1' });
      const cx = parseMarkdownTasks(md, { ...base, agentKind: 'codex', runId: 'r2' });

      expect(wb.tasks[0]!.externalId).not.toBe(cx.tasks[0]!.externalId);
      expect(wb.tasks[0]!.externalId.startsWith('workbuddy:')).toBe(true);
      expect(cx.tasks[0]!.externalId.startsWith('codex:')).toBe(true);
    });
  });

  it('无任务标题 → tasks 为空数组（由 validateAgentPayload 的 min(1) 拒绝）', () => {
    const payload = parseMarkdownTasks('只是一段说明文字', {
      actorKind: 'agent',
      agentKind: 'codex',
      agentName: 'Codex-01',
      runId: 'run-1',
    });
    expect(payload.tasks).toHaveLength(0);
  });
});
