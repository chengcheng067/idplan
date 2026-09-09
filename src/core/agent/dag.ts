/**
 * 依赖图（DAG）求解与 Ready 队列计算（v0.6 · 设计文档 §3.4-N02 / §4.2）。
 *
 * 纪律：
 *   - **零 IO、零 repo import**：纯函数，只 import 类型与 lib/date（handoff 在另一文件）；
 *   - **禁止递归 DFS**：环检测用 Kahn 迭代 + 残余节点法——1000 节点深链不会栈溢出；
 *   - Ready 计算侧遇到环**不抛异常**（排除环成员即可，导入侧才整批拒绝），
 *     防止手工编辑造环后看板白屏（设计文档 §4.2 设计要点表）。
 */

import type { Task } from '../types/entities';
import { taskIsDone } from '../types/entities';
import type { TaskStatus } from '../types/enums';

/** 邻接表 + 入度表。节点 = 本批任务 id；边 = task.id ← dep（dep 是 task.id） */
export interface DependencyGraph {
  /** adjacency[dep] = 依赖 dep 的任务 id 列表（dep 的后继） */
  adjacency: Map<string, string[]>;
  /** indegree[id] = 尚未完成的前驱数量（已完成前驱不计入） */
  indegree: Map<string, number>;
}

/** 单个被阻塞任务的明细：任务本体 + 未满足的前置（供「blocked by ⟨title⟩」渲染） */
export interface BlockedTask {
  task: Task;
  blockedBy: Array<{ id: string; title: string }>;
}

/** computeReadyTasks 的输出（形状恒定，store/UI 只做编排不重复实现） */
export interface ReadyComputation {
  /** Ready 队列：已按 拓扑层 → dueDate → orderIndex 排序 */
  ready: Task[];
  /** 被阻塞（含手动 blocked / 未指派前的依赖未满足者），不与 ready 交集 */
  blocked: BlockedTask[];
  /** 环成员 id（防御性兜底：导入侧已整批拒绝环，这里是手工造环的最后防线） */
  cyclicIds: Set<string>;
  /** 拓扑层号（0 = 无前驱）；环成员不在表内 */
  layerIndex: Map<string, number>;
}

/**
 * 建图（O(V+E)）。节点集 = 传入任务（调用方应已按项目过滤）。
 * 边：`t.dependsOn` 中**存在于本批节点**的前驱才计入——跨项目 / 已删除的引用
 * 在这里被静默剔除（导入侧会在解引用阶段 rejected，此处是防御性收口）。
 *
 * indegree 只统计**尚未完成**的前驱（`taskIsDone`，绝不读 `dep.done`）：
 * 已完成的前驱不再构成约束，这正是 Ready 语义（deps 全 done）的图论表达。
 */
export function buildDependencyGraph(tasks: readonly Task[]): DependencyGraph {
  const ids = new Set(tasks.map((t) => t.id));
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const t of tasks) {
    if (!adjacency.has(t.id)) adjacency.set(t.id, []);
    if (!indegree.has(t.id)) indegree.set(t.id, 0);
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      // 不存在的引用（跨项目/已删除）不建边
      if (!ids.has(dep) || dep === t.id) continue;
      const depTask = byId.get(dep);
      if (!depTask || taskIsDone(depTask)) continue; // 已完成前驱不构成约束
      adjacency.set(dep, [...(adjacency.get(dep) ?? []), t.id]);
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
    }
  }
  return { adjacency, indegree };
}

/**
 * Kahn 迭代分层 + 残余节点法环检测。
 *
 * 返回：
 *   - layerIndex：id → 拓扑层号（0 起）；每层 = 前一层全部出队后新入度为 0 的节点；
 *   - cyclicIds：迭代结束后仍未被分层的节点 = 环成员（含环的下游），**不抛异常**。
 *
 * 复杂度 O(V+E)，迭代实现——1000 节点线性链不栈溢出（T02 DoD / N19 断言）。
 */
export function topoLayers(graph: DependencyGraph): {
  layerIndex: Map<string, number>;
  cyclicIds: Set<string>;
} {
  const { adjacency, indegree } = graph;
  const layerIndex = new Map<string, number>();

  // 工作副本：出队时给后继减 1，不污染调用方的 indegree
  const remaining = new Map(indegree);
  let frontier: string[] = [];
  for (const [id, deg] of remaining) {
    if (deg === 0) frontier.push(id);
  }

  let layer = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      layerIndex.set(id, layer);
      for (const succ of adjacency.get(id) ?? []) {
        const d = (remaining.get(succ) ?? 0) - 1;
        remaining.set(succ, d);
        if (d === 0) next.push(succ);
      }
    }
    frontier = next;
    layer += 1;
  }

  const cyclicIds = new Set<string>();
  for (const id of remaining.keys()) {
    if (!layerIndex.has(id)) cyclicIds.add(id);
  }
  return { layerIndex, cyclicIds };
}

/**
 * 是否存在依赖环（复用 topoLayers 的残余节点法，非递归 DFS）。
 * 导入侧（payload.apply）命中 → 整批拒绝；Ready 计算侧改用 topoLayers 拿明细。
 */
export function detectCycles(graph: DependencyGraph): boolean {
  return topoLayers(graph).cyclicIds.size > 0;
}

/**
 * Ready 队列计算（设计文档 §4.2 步骤 3–4）。
 *
 * Ready = `status === 'ready'` ∧ 所有前驱已完成 ∧ `claimedAt === null` ∧ 非环成员。
 * 排序 = [拓扑层号, dueDate(缺失排最后), orderIndex]。
 *
 * `blocked` = 存在未满足前驱的任务（环成员不进 blocked——它们有自己的告警通道）；
 * 只做**提示**，绝不自动改写 `status`（避免与手动 blocked 冲突，PRD §4.5）。
 */
export function computeReadyTasks(tasks: readonly Task[], _todayIso?: string): ReadyComputation {
  const graph = buildDependencyGraph(tasks);
  const { layerIndex, cyclicIds } = topoLayers(graph);

  const byId = new Map(tasks.map((t) => [t.id, t] as const));

  const ready: Task[] = [];
  const blocked: BlockedTask[] = [];

  for (const t of tasks) {
    if (cyclicIds.has(t.id)) continue; // 环成员单独告警，不进 ready/blocked

    // 未满足前驱（存在、未完成）；缺失引用不算阻塞
    const unmet = (t.dependsOn ?? [])
      .map((dep) => byId.get(dep))
      .filter((dep): dep is Task => !!dep && !taskIsDone(dep));

    if (unmet.length > 0) {
      blocked.push({
        task: t,
        blockedBy: unmet.map((d) => ({ id: d.id, title: d.title })),
      });
      continue;
    }
    if (isReadyStatus(t.status) && t.claimedAt === null) {
      ready.push(t);
    }
  }

  const layerOf = (id: string): number => layerIndex.get(id) ?? Number.MAX_SAFE_INTEGER;
  const dueKey = (t: Task): string => t.dueDate ?? '9999-12-31';
  ready.sort(
    (a, b) =>
      layerOf(a.id) - layerOf(b.id) ||
      dueKey(a).localeCompare(dueKey(b)) ||
      a.orderIndex - b.orderIndex ||
      a.id.localeCompare(b.id),
  );
  blocked.sort(
    (a, b) =>
      layerOf(a.task.id) - layerOf(b.task.id) ||
      dueKey(a.task).localeCompare(dueKey(b.task)) ||
      a.task.orderIndex - b.task.orderIndex,
  );

  return { ready, blocked, cyclicIds, layerIndex };
}

/** status 是否为 Ready（局部窄化，避免在热路径上反复 import 枚举成员比较） */
function isReadyStatus(status: TaskStatus): boolean {
  return status === 'ready';
}
