/**
 * D 版 P2 · 任务依赖网络（01 文档 §5 / 02 文档 §6/§7；本版最高风险页）。
 *
 * ── 算法与视觉的分工 ──
 * 分层 / 环 / 缺失引用全部由 dependency-graph.ts 的纯函数产出（可单测），
 * 本组件只做**几何排布**：层 → 横向条带（band），层内节点从左到右换行；
 * 边一律正交连线（打印友好），全部自上而下流动——前驱在上、后继在下。
 *
 * ── 确定性 ──
 * 节点坐标只取决于 (layer, rank) 与两个压缩档位，同数据两次渲染逐像素一致
 * （02 §7「稳定布局」）。压缩只在自然高度超预算时逐级生效（节点高 → 行距
 * → 带距），有下限；仍超限则整体回退为分层表（不出裁切页）。
 *
 * ── 权限纪律 ──
 * 指向不可见 / 不存在任务的依赖在 VM 层就已指不到（适配器按可见阶段收窄），
 * 这里只呈现算法给的**计数汇总警示**，不出现目标 id / 标题任何信息。
 */

import { useId } from 'react';

import { formatTaskNo } from '../../../core/lib/task-no';
import type { PrintViewModel } from '../../model/print-view-model';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import {
  buildDependencyGraph,
  type DepGraphLayout,
  type DepGraphNode,
} from './dependency-graph';
import { taskGlyph, taskNodeTone, taskStateTone, taskStatusLabel, truncateToWidth } from './shared';

/* ---------------------------------------------------------------- 几何常量 */

/** 内容宽（A4 794 − 左右各 40 内边距） */
const GRAPH_W = 714;
/** 图形高度预算（页头 ~118 + 页脚 ~46 + 图例/警示占位后的余量） */
const GRAPH_MAX_H = 760;
const NODE_W = 200;
const NODE_H = 30;
const GAP_X = 16;
const ROW_GAP = 8;
const BAND_GAP = 24;
/** 节点左侧「读号签」宽（mono taskNo + 状态字形） */
const TAB_W = 46;

interface BandGeom {
  y: number;
  height: number;
}

interface NodeGeom {
  node: DepGraphNode;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 所在条带（= 节点层号） */
  band: number;
}

interface GraphGeom {
  cols: number;
  nodeH: number;
  bandGap: number;
  bands: BandGeom[];
  boxes: Map<string, NodeGeom>;
  height: number;
  fits: boolean;
}

/** 分层 → 条带几何（确定性；超限逐级压缩，仍有下限） */
function computeGeom(layers: readonly (readonly DepGraphNode[])[], maxHeight: number): GraphGeom {
  const cols = Math.max(1, Math.floor((GRAPH_W + GAP_X) / (NODE_W + GAP_X)));
  let nodeH = NODE_H;
  let rowGap = ROW_GAP;
  let bandGap = BAND_GAP;
  const rowsOf = (n: number): number => Math.max(1, Math.ceil(n / cols));
  const totalH = (): number =>
    layers.reduce((sum, l) => {
      const rows = rowsOf(l.length);
      return sum + rows * nodeH + (rows - 1) * rowGap;
    }, 0) + Math.max(0, layers.length - 1) * bandGap;

  while (totalH() > maxHeight && nodeH > 20) nodeH -= 2;
  while (totalH() > maxHeight && rowGap > 5) rowGap -= 1;
  while (totalH() > maxHeight && bandGap > 8) bandGap -= 2;
  const fits = totalH() <= maxHeight;

  const bands: BandGeom[] = [];
  const boxes = new Map<string, NodeGeom>();
  let y = 0;
  layers.forEach((layer, bi) => {
    const rows = rowsOf(layer.length);
    const h = rows * nodeH + (rows - 1) * rowGap;
    bands.push({ y, height: h });
    layer.forEach((node, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      boxes.set(node.id, {
        node,
        x: col * (NODE_W + GAP_X),
        y: y + row * (nodeH + rowGap),
        w: NODE_W,
        h: nodeH,
        band: bi,
      });
    });
    y += h + bandGap;
  });

  return { cols, nodeH, bandGap, bands, boxes, height: Math.max(0, y - bandGap), fits };
}

/** 正交连线路径：源节点 → 水平通道 → 目标节点（自上而下；环边逆行同样式） */
function edgePath(from: NodeGeom, to: NodeGeom, bands: BandGeom[], bandGap: number): string {
  if (from.node.id === to.node.id) {
    // 自依赖：节点右侧一枚 C 形小钩（仍画出来，不假装没有这条依赖）
    const x = from.x + from.w;
    return `M ${x} ${from.y} C ${x + 18} ${from.y + from.h * 0.2} ${x + 18} ${from.y + from.h * 0.8} ${x} ${from.y + from.h}`;
  }
  const downward = to.band > from.band;
  const sx = from.x + from.w / 2;
  const sy = downward ? from.y + from.h : from.y;
  const tx = to.x + to.w / 2;
  const ty = downward ? to.y : to.y + to.h;
  // 水平通道：邻带边走「源带下方间隙」，跨带边走「目标带上方间隙」，逆行边走「源带上方间隙」
  const channel = downward
    ? to.band === from.band + 1
      ? bands[from.band]!.y + bands[from.band]!.height + bandGap / 2
      : bands[to.band]!.y - bandGap / 2
    : bands[from.band]!.y - bandGap / 2;
  return `M ${sx} ${sy} L ${sx} ${channel} L ${tx} ${channel} L ${tx} ${ty}`;
}

/* ---------------------------------------------------------------- 页面 */

export function DependencyNetworkPage({ vm }: { vm: PrintViewModel }): JSX.Element {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const arrowId = `de-arrow-${uid}`;
  const arrowSignalId = `de-arrow-signal-${uid}`;

  const tasks = vm.tasks;
  const graph: DepGraphLayout = buildDependencyGraph(tasks);

  if (tasks.length === 0) {
    return (
      <section className="de-board">
        <GraphSummary graph={graph} />
        <EmptyPrintState kind="tasks" />
      </section>
    );
  }

  const geom = computeGeom(graph.layers, GRAPH_MAX_H);

  return (
    <section className="de-board">
      <GraphSummary graph={graph} />

      {/* 汇总警示：只计数、不泄露目标（02 §7 权限纪律） */}
      {graph.missingRefCount > 0 && (
        <p className="de-warn" data-kind="missing">
          <strong>引用不可用</strong>：有 {graph.missingRefCount} 条依赖指向当前可见范围外或已不存在的
          任务。这些依赖未绘入网络，也不显示目标信息；请核对任务可见范围或清理无效依赖。
        </p>
      )}
      {graph.cycleEdgeCount > 0 && (
        <p className="de-warn" data-kind="cycle">
          <strong>循环依赖</strong>：检测到 {graph.cycleEdgeCount} 条边构成环（图中虚线标识）。
          分层布局已回退为任务号顺序；环上依赖保留展示，未做静默处理。
        </p>
      )}

      {graph.edges.length === 0 ? (
        <>
          {/* 02 §8：无依赖 = 明确空态 + 仍保留任务节点列表摘要 */}
          <EmptyPrintState kind="dependencies" />
          <p className="de-graph__nodes-note">
            当前可见范围共 {graph.nodes.length} 个任务节点（下方为节点摘要；建立依赖关系后将绘出网络）。
          </p>
          <NodeChips graph={graph} />
        </>
      ) : !geom.fits ? (
        <>
          <p className="de-warn" data-kind="density">
            <strong>图形密度超限</strong>：{graph.nodes.length} 个节点 / {graph.layerCount} 层超出单页
            图形容量，已按分层表呈现（结构与图形一致，无裁切）。
          </p>
          <LayerTable graph={graph} />
        </>
      ) : (
        <GraphSvg
          graph={graph}
          geom={geom}
          arrowId={arrowId}
          arrowSignalId={arrowSignalId}
        />
      )}

      <ul className="de-legend">
        <li>
          <span className="de-legend__glyph" data-tone="done">
            ●
          </span>
          已完成（实心）
        </li>
        <li>
          <span className="de-legend__glyph" data-tone="active">
            ◐
          </span>
          进行中（粗边）
        </li>
        <li>
          <span className="de-legend__glyph" data-tone="idle">
            □
          </span>
          未启动 / 其他状态（细边）
        </li>
        <li>
          <span className="de-legend__glyph" data-tone="blocked">
            ▲
          </span>
          阻塞（信号边）
        </li>
        <li>
          <span className="de-legend__flag">·!N</span> N 条依赖引用不可用
        </li>
        <li>
          <span className="de-legend__flag">·环</span> 处于循环依赖
        </li>
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- 子块 */

function GraphSummary({ graph }: { graph: DepGraphLayout }): JSX.Element {
  return (
    <p className="de-graph__summary de-num">
      {graph.nodes.length} 节点 · {graph.edges.length} 依赖边 · {graph.layerCount} 层
      {graph.abnormalNodeCount > 0 ? ` · ${graph.abnormalNodeCount} 异常节点` : ''}
    </p>
  );
}

/** 异常后缀（引用不可用计数 / 环标记）——文本编码，灰度下不依赖颜色 */
function abnormalSuffix(node: DepGraphNode): string {
  return (node.missingRefs > 0 ? ` ·!${node.missingRefs}` : '') + (node.inCycle ? ' ·环' : '');
}

function NodeChips({ graph }: { graph: DepGraphLayout }): JSX.Element {
  return (
    <div className="de-chips">
      {graph.nodes.map((n) => (
        <span
          key={n.id}
          className="de-chip"
          data-tone={taskNodeTone(n.status)}
          title={`${n.label}（${taskStatusLabel(n.status)}）${abnormalSuffix(n) ? ' ' + abnormalSuffix(n).trim() : ''}`}
        >
          <span className="de-chip__glyph" aria-hidden>
            {taskGlyph(n.status)}
          </span>
          <span className="de-chip__no de-num">{formatTaskNo(n.taskNo)}</span>
          <span className="de-chip__title">{n.title}</span>
          {abnormalSuffix(n) && <span className="de-chip__flag">{abnormalSuffix(n)}</span>}
        </span>
      ))}
    </div>
  );
}

function LayerTable({ graph }: { graph: DepGraphLayout }): JSX.Element {
  const predCount = new Map<string, number>();
  for (const e of graph.edges) predCount.set(e.to, (predCount.get(e.to) ?? 0) + 1);
  return (
    <table className="de-table de-graph-table">
      <thead>
        <tr>
          <th className="de-graph-table__layer">LAYER 层</th>
          <th className="de-graph-table__no">NO 读号</th>
          <th>TASK 任务</th>
          <th>STATUS 状态</th>
          <th className="de-graph-table__no">PRED 前驱数</th>
          <th>FLAG 异常</th>
        </tr>
      </thead>
      <tbody>
        {graph.nodes.map((n) => (
          <tr key={n.id} data-tone={taskNodeTone(n.status)}>
            <td className="de-num">{n.layer + 1}</td>
            <td className="de-num">{formatTaskNo(n.taskNo)}</td>
            <td className="de-graph-table__title" title={n.title}>
              {n.title}
            </td>
            <td>
              <span className="de-state" data-tone={taskStateTone(n.status)}>
                <span className="de-state__glyph" aria-hidden>
                  {taskGlyph(n.status)}
                </span>
                {taskStatusLabel(n.status)}
              </span>
            </td>
            <td className="de-num">{predCount.get(n.id) ?? 0}</td>
            <td className="de-graph-table__flag">
              {n.missingRefs > 0 && <span className="de-flag">引用不可用 ×{n.missingRefs}</span>}
              {n.missingRefs > 0 && n.inCycle ? ' · ' : ''}
              {n.inCycle && <span className="de-flag">循环依赖</span>}
              {n.missingRefs === 0 && !n.inCycle ? '—' : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GraphSvg({
  graph,
  geom,
  arrowId,
  arrowSignalId,
}: {
  graph: DepGraphLayout;
  geom: GraphGeom;
  arrowId: string;
  arrowSignalId: string;
}): JSX.Element {
  const titleH = geom.nodeH >= 26 ? 11 : 10;
  return (
    <svg
      className="de-graph"
      width={GRAPH_W}
      height={geom.height}
      viewBox={`0 0 ${GRAPH_W} ${geom.height}`}
      data-compact={geom.nodeH < 26 || undefined}
      role="img"
      aria-label={`任务依赖网络：${graph.nodes.length} 节点 ${graph.edges.length} 边 ${graph.layerCount} 层`}
    >
      <defs>
        {/* 打印友好箭头：实心三角，随描边缩放；常规 / 信号两枚 */}
        <marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" className="de-graph__arrow" />
        </marker>
        <marker id={arrowSignalId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" className="de-graph__arrow" data-tone="signal" />
        </marker>
      </defs>

      {/* 边在下、节点在上（连线被节点压住也符合「节点优先」的读法） */}
      <g className="de-graph__edges">
        {graph.edges.map((e) => {
          const from = geom.boxes.get(e.from);
          const to = geom.boxes.get(e.to);
          if (!from || !to) return null;
          return (
            <path
              key={`${e.from}-${e.to}`}
              d={edgePath(from, to, geom.bands, geom.bandGap)}
              className="de-graph__edge"
              data-cycle={e.cycle || undefined}
              markerEnd={e.cycle ? `url(#${arrowSignalId})` : `url(#${arrowId})`}
            />
          );
        })}
      </g>

      <g className="de-graph__nodes">
        {graph.nodes.map((n) => {
          const box = geom.boxes.get(n.id)!;
          const tone = taskNodeTone(n.status);
          const suffix = abnormalSuffix(n);
          const noY = box.y + (box.h >= 26 ? 11 : 9.5);
          const glyphY = box.y + (box.h >= 26 ? 21.5 : 19.5);
          return (
            <g key={n.id} className="de-gnode" data-tone={tone}>
              <title>{`${n.label}（${taskStatusLabel(n.status)}）${suffix}`}</title>
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={0} className="de-gnode__box" />
              <rect x={box.x} y={box.y} width={TAB_W} height={box.h} rx={0} className="de-gnode__tab" />
              <text x={box.x + TAB_W / 2} y={noY} className="de-gnode__no de-num" textAnchor="middle">
                {formatTaskNo(n.taskNo)}
              </text>
              <text x={box.x + TAB_W / 2} y={glyphY} className="de-gnode__glyph" textAnchor="middle">
                {taskGlyph(n.status)}
              </text>
              <text
                x={box.x + TAB_W + 8}
                y={box.y + box.h / 2}
                className="de-gnode__title"
                dominantBaseline="central"
              >
                {truncateToWidth(n.title, box.w - TAB_W - 16, titleH)}
                {suffix && (
                  <tspan className="de-gnode__flag">{suffix}</tspan>
                )}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
