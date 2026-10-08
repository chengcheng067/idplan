/**
 * D 版 P2 · 任务依赖网络：确定性分层 DAG 布局算法（02 文档 §7）。
 *
 * ── 为什么不用力导向 / 随机布局 ──
 * 02 §7 明文要求「稳定布局」：同一份数据两次渲染必须逐像素一致——打印稿
 * 要对账、要复打、要归档。力导向的迭代起点与收敛都不可复现，随机更不用提。
 * 故本算法只有两条排序规则：**拓扑分层** + **同层按 taskNo 排序**，全部确定。
 *
 * ── 三条硬规则的落地方式 ──
 * ① 节点 id = Task 主键；只画**可见任务之间**的边。调用方传入的已是 VM
 *    权限过滤后的可见任务；`dependsOn` 里指不到的任务 = 缺失引用，**只计数、
 *    不建边、不携带目标 id**——「不可见任务的存在」本身也是权限信息
 *    （02 §7 / 决策文档 §2.4），汇总警示里不出现目标任何信息。
 * ② 环：DFS 标记**回边**（= 循环边）后，把回边从分层用的图里移除再跑
 *    Kahn。「有环 ⇔ DFS 有回边、移除全部回边后必成 DAG」是 DFS 基本定理，
 *    故分层不会卡死；回边本身**仍然绘制**（虚线 + 信号色标记异常），
 *    不假装这条依赖不存在。
 * ③ 回退：环上节点随回边移除后按 taskNo 序落层（Kahn 队列按 taskNo 出队），
 *    即需求说的「回退到任务号顺序」。
 *
 * ── 自依赖 ──
 * `dependsOn` 含自身 ⇒ 1-环，DFS 自然标记为回边，分层不受影响（入度已排除）。
 */

import type { PrintTaskVM } from '../../model/print-view-model';
import { formatTaskNo } from '../../../core/lib/task-no';
import type { TaskStatus } from '../../../core/types/enums';

/** 依赖图中的节点（id = Task 主键） */
export interface DepGraphNode {
  id: string;
  taskNo: number | null;
  /** 展示标签 = taskNo + 标题（formatTaskNo 统一格式） */
  label: string;
  title: string;
  status: TaskStatus;
  /** 拓扑层（0 起；环回退后每个节点都有层） */
  layer: number;
  /** 稳定序位（taskNo 升序，null 排最后，同号按 id） */
  rank: number;
  /** 指向不可见 / 不存在任务的依赖条数（只计数，不含目标信息） */
  missingRefs: number;
  /** 是否关联循环边（异常节点） */
  inCycle: boolean;
}

/** 依赖图中的边。from = 前驱（被依赖），to = 后继（依赖方） */
export interface DepGraphEdge {
  from: string;
  to: string;
  /** 循环边（异常）：渲染为虚线 + 信号色；分层不依赖它 */
  cycle: boolean;
}

/** 分层布局结果（纯数据；几何排布由页面组件按纸张尺寸计算） */
export interface DepGraphLayout {
  /** 全部节点，按 (layer, rank) 排序 */
  nodes: readonly DepGraphNode[];
  /** 全部边（含循环边），确定性顺序 */
  edges: readonly DepGraphEdge[];
  /** 分层结果：layers[i] = 第 i 层节点（层内按 rank 排序） */
  layers: readonly (readonly DepGraphNode[])[];
  layerCount: number;
  /** 缺失引用总条数（指向可见范围外 / 不存在的任务） */
  missingRefCount: number;
  /** 循环边条数 */
  cycleEdgeCount: number;
  /** 异常节点数（有缺失引用或关联循环边） */
  abnormalNodeCount: number;
}

/** 稳定序：taskNo 升序（老数据 null 排最后），同号按 id 字典序 */
function compareTaskNo(a: PrintTaskVM, b: PrintTaskVM): number {
  const na = a.taskNo ?? Number.MAX_SAFE_INTEGER;
  const nb = b.taskNo ?? Number.MAX_SAFE_INTEGER;
  return na !== nb ? na - nb : a.id.localeCompare(b.id);
}

/** 边键（前驱 \u0000 后继）。Task 主键不含 NUL，可安全拼接 */
function edgeKey(from: string, to: string): string {
  return from + '\u0000' + to;
}

/**
 * 环上节点集（Tarjan SCC，迭代式；确定性：起跳与邻居都走 rank 序）。
 *
 * 「在环上」的准确刻画是「所在强连通分量大小 > 1，或有自环」——只标回边
 * 两端会漏掉环途经节点（a→b→c→a 的回边是 c→a，b 同样卡在环里）。
 */
function cycleNodesOf(
  ordered: readonly PrintTaskVM[],
  succ: Map<string, string[]>,
): Set<string> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const tarjanStack: string[] = [];
  const result = new Set<string>();
  let counter = 0;

  for (const root of ordered) {
    if (index.has(root.id)) continue;
    index.set(root.id, counter);
    low.set(root.id, counter);
    counter += 1;
    tarjanStack.push(root.id);
    onStack.add(root.id);
    const callStack: Array<{ id: string; iter: number }> = [{ id: root.id, iter: 0 }];
    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!;
      const neighbors = succ.get(frame.id)!;
      if (frame.iter < neighbors.length) {
        const next = neighbors[frame.iter]!;
        frame.iter += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          tarjanStack.push(next);
          onStack.add(next);
          callStack.push({ id: next, iter: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(next)!));
        }
      } else {
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1]!;
          low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
        }
        if (low.get(frame.id) === index.get(frame.id)) {
          // SCC 根：弹出整个强连通分量
          const scc: string[] = [];
          for (;;) {
            const w = tarjanStack.pop()!;
            onStack.delete(w);
            scc.push(w);
            if (w === frame.id) break;
          }
          if (scc.length > 1) for (const w of scc) result.add(w);
        }
      }
    }
  }
  // 自环：单点 SCC 但有自边，同样算环上节点
  for (const t of ordered) {
    if (succ.get(t.id)!.includes(t.id)) result.add(t.id);
  }
  return result;
}

/**
 * 建依赖图布局（纯函数；输入 = VM 过滤后的**可见任务**）。
 *
 * 不抛异常、不卡死：任何形状的 dependsOn（空 / 缺失 / 自环 / 环 / 重边）
 * 都有确定输出。
 */
export function buildDependencyGraph(tasks: readonly PrintTaskVM[]): DepGraphLayout {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  // 稳定序：一切遍历（DFS 起跳、邻居访问、Kahn 出队）都走这个序
  const ordered = [...tasks].sort(compareTaskNo);
  const rankOf = new Map(ordered.map((t, i) => [t.id, i] as const));

  // ── 邻接表 + 缺失引用计数（缺失只计数，不建边、不记目标）──
  const succ = new Map<string, string[]>(); // 前驱 → 后继（依赖方）们
  const pred = new Map<string, string[]>(); // 后继 → 前驱（被依赖）们
  const missing = new Map<string, number>();
  for (const t of ordered) {
    succ.set(t.id, []);
    pred.set(t.id, []);
  }
  const seenEdges = new Set<string>(); // 重边去重（同一依赖写两遍只画一条）
  for (const t of ordered) {
    for (const dep of t.dependsOn) {
      if (!byId.has(dep)) {
        missing.set(t.id, (missing.get(t.id) ?? 0) + 1);
        continue;
      }
      const key = edgeKey(dep, t.id);
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      succ.get(dep)!.push(t.id);
      pred.get(t.id)!.push(dep);
    }
  }

  // ── ① DFS 标记回边（循环边）。迭代式（深链不长也不爆栈）；三色标记 ──
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(ordered.map((t) => [t.id, WHITE] as const));
  const backEdgeKeys = new Set<string>();
  const backEdges: Array<{ from: string; to: string }> = [];
  for (const root of ordered) {
    if (color.get(root.id) !== WHITE) continue;
    color.set(root.id, GRAY);
    const stack: Array<{ id: string; iter: number }> = [{ id: root.id, iter: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbors = succ.get(frame.id)!;
      if (frame.iter < neighbors.length) {
        const next = neighbors[frame.iter]!;
        frame.iter += 1;
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) {
          // 回边 = 循环边（含自环：neighbor 就是 frame 自身时也在栈上）
          const key = edgeKey(frame.id, next);
          if (!backEdgeKeys.has(key)) {
            backEdgeKeys.add(key);
            backEdges.push({ from: frame.id, to: next });
          }
        } else if (c === WHITE) {
          color.set(next, GRAY);
          stack.push({ id: next, iter: 0 });
        }
        // BLACK：前向 / 横叉边，无害，不标记
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
      }
    }
  }

  // ── ② 移除回边后跑 Kahn 分层：layer[v] = max(layer[前驱]) + 1 ──
  const layerOf = new Map<string, number>();
  const indeg = new Map<string, number>();
  for (const t of ordered) {
    let n = 0;
    for (const p of pred.get(t.id)!) if (!backEdgeKeys.has(edgeKey(p, t.id))) n += 1;
    indeg.set(t.id, n);
  }
  const queue: string[] = ordered.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  while (queue.length > 0) {
    // 稳定出队：rank 最小者（= taskNo 序；同层排序的确定性来源）
    let best = 0;
    for (let i = 1; i < queue.length; i++) {
      if (rankOf.get(queue[i]!)! < rankOf.get(queue[best]!)!) best = i;
    }
    const u = queue.splice(best, 1)[0]!;
    let layer = 0;
    for (const p of pred.get(u)!) {
      if (backEdgeKeys.has(edgeKey(p, u))) continue;
      layer = Math.max(layer, (layerOf.get(p) ?? 0) + 1);
    }
    layerOf.set(u, layer);
    for (const v of succ.get(u)!) {
      if (backEdgeKeys.has(edgeKey(u, v))) continue;
      const left = (indeg.get(v) ?? 0) - 1;
      indeg.set(v, left);
      if (left === 0) queue.push(v);
    }
  }
  // 防御性兜底（定理上不可达：移除全部回边后必成 DAG）：漏网节点落第 0 层，
  // 仍按 rank 排序——不抛、不卡死，纸张永远出得来。
  for (const t of ordered) if (!layerOf.has(t.id)) layerOf.set(t.id, 0);

  // ── ③ 汇总输出 ──
  // 环上节点 = SCC 大小 > 1 或自环（Tarjan；「在环上」的准确刻画）。
  // 不能只取回边两端——a→b→c→a 的回边是 c→a，但 b 同样卡在环里。
  const cycleNodeIds = cycleNodesOf(ordered, succ);

  const nodes: DepGraphNode[] = ordered.map((t) => ({
    id: t.id,
    taskNo: t.taskNo,
    label: formatTaskNo(t.taskNo) + ' ' + t.title,
    title: t.title,
    status: t.status,
    layer: layerOf.get(t.id) ?? 0,
    rank: rankOf.get(t.id)!,
    missingRefs: missing.get(t.id) ?? 0,
    inCycle: cycleNodeIds.has(t.id),
  }));
  // 渲染序 = (layer, rank)：层序优先，同层 taskNo 序
  nodes.sort((a, b) => a.layer - b.layer || a.rank - b.rank);

  const edges: DepGraphEdge[] = [];
  for (const t of ordered) {
    for (const dep of t.dependsOn) {
      if (!byId.has(dep)) continue;
      const key = edgeKey(dep, t.id);
      if (!seenEdges.has(key)) continue; // 重边已去重
      edges.push({ from: dep, to: t.id, cycle: backEdgeKeys.has(key) });
    }
  }

  const layers: DepGraphNode[][] = [];
  for (const n of nodes) {
    (layers[n.layer] ??= []).push(n);
  }
  for (let i = 0; i < layers.length; i++) {
    layers[i] ??= [];
    layers[i]!.sort((a, b) => a.rank - b.rank);
  }

  let missingRefCount = 0;
  for (const n of nodes) missingRefCount += n.missingRefs;

  return {
    nodes,
    edges,
    layers,
    layerCount: layers.length,
    missingRefCount,
    cycleEdgeCount: backEdges.length,
    abnormalNodeCount: nodes.filter((n) => n.missingRefs > 0 || n.inCycle).length,
  };
}
