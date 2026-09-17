/**
 * 点按浮层的锚定定位（纯函数，可单测）。
 *
 * 用户反馈：点「设置」时窗口在右侧固定弹出，不在点击位置附近。
 * 根因是浮层用固定的 placement 对齐，而不是用**触发点**。
 * 本模块给出唯一一份定位口径：靠近锚点 → 空间不足则翻转 → 最后 clamp 回可视区。
 *
 * 之所以先做纯函数：翻转/夹取是几何逻辑，jsdom 量不到 rect（恒 0），
 * 只能靠纯函数 + 真浏览器几何测试两层覆盖。
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/** 浮层相对锚点的安全间距（与菜单 `rect.bottom + 8` 同口径） */
export const ANCHOR_GAP = 8;
/** 距视口边缘的最小留白，任何情况下浮层不得贴边 */
export const VIEWPORT_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * 由触发元素矩形求「优先在下方、空间不足翻到上方」的锚点。
 * 返回值直接可当 `resolveAnchoredPosition` 的 anchor。
 */
export function anchorFromRect(rect: Rect, prefer: 'below' | 'above' = 'below'): Point {
  return prefer === 'below'
    ? { x: rect.left, y: rect.bottom + ANCHOR_GAP }
    : { x: rect.left, y: rect.top - ANCHOR_GAP };
}

/**
 * 把锚点固化为浮层左上角坐标。
 *
 * 规则（顺序即优先级，不可调换）：
 *   1. 先按锚点放（锚点本身是「希望浮层起始于何处」）；
 *   2. 水平方向：放不下就向左回退，仍放不下才贴边夹取；
 *   3. 垂直方向：下方空间不足且上方更宽裕 → 整块翻到锚点上方；
 *   4. 最后统一 clamp 到 [margin, viewport - size - margin]。
 *
 * `viewport` 由调用方给（用 visualViewport 优先，键盘/缩放下更准）。
 * `insetTop` 用于避让 Windows 原生标题栏叠加层（三键浮在网页之上）。
 */
export function resolveAnchoredPosition({
  anchor,
  panel,
  viewport,
  insetTop = 0,
  margin = VIEWPORT_MARGIN,
}: {
  anchor: Point;
  panel: { width: number; height: number };
  viewport: ViewportSize;
  insetTop?: number;
  margin?: number;
}): { top: number; left: number } {
  const minX = margin;
  const maxX = viewport.width - panel.width - margin;

  // 水平：优先左对齐锚点（视觉上从点击处展开），超出右边界则回退到贴右
  let left = anchor.x;
  if (left > maxX) left = Math.max(minX, anchor.x - panel.width);

  // 垂直：先看下方余量，不足再看上方
  const spaceBelow = viewport.height - anchor.y - margin;
  const spaceAbove = anchor.y - ANCHOR_GAP - margin - insetTop;
  let top = anchor.y;
  if (panel.height > spaceBelow && spaceAbove > spaceBelow) {
    // 翻到上方：浮层底边贴着锚点上沿
    top = anchor.y - ANCHOR_GAP - panel.height;
  }

  const minY = margin + insetTop;
  const maxY = viewport.height - panel.height - margin;

  return {
    top: clamp(top, minY, maxY),
    left: clamp(left, minX, maxX),
  };
}
