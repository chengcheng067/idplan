import { useCallback, useState } from 'react';

/**
 * 出口期保留（presence 的**列表版**）：已经离开数据源的条目，继续留在渲染列表里，
 * 直到它自己的出口动画播完。
 *
 * ── 为什么 `usePresence` 一个人不够 ──────────────────────────────────
 * `usePresence` 管的是「**一个**元素什么时候卸载」，前提是**调用方还在渲染它**。
 * 列表场景里条目的消失是**数据源**决定的（Toast 被 `dismissToast` 从 store 的数组里
 * 摘掉、筛选把某行过滤掉）—— 它一旦从数组里消失，调用方的 `map` 就不再渲染它，
 * `usePresence` 根本没有机会介入，出口动画永远播不出来。本 hook 做的就是
 * 「把刚消失的那几个先扣在手里」。
 *
 * ── 契约 ────────────────────────────────────────────────────────
 * 返回的 `rows` = 数据源现役条目（`leaving: false`）+ 刚消失、出口还没播完的条目
 * （`leaving: true`）。调用方把 `leaving` 透给条目（用 `!leaving` 当 `usePresence`
 * 的 `active`），条目出口结束时回调 `forget(id)` 交还 —— 交还之后它才真正消失。
 *
 * ⚠️ 分工：本 hook **只负责保留**，不碰 `pointer-events`、不挂出口类、不做兜底超时。
 *    那些是条目自己调 `usePresence` 的事（出口类、禁点、cap 都在那儿）。
 *    反过来说：条目如果永远不调 `forget`，它会永久留在 `rows` 里 —— 这正是
 *    `usePresence` 的兜底 cap（动画事件不来也强制卸载 → 触发 forget）要兜的另一半。
 *
 * ⚠️ `rows` 里每个对象都是**每次渲染新建**的（带 `leaving` 标志的副本），
 *    别把它塞进依赖数组当稳定引用用。
 */
export function useExitRetained<T extends { id: number | string }>(
  items: T[],
): { rows: Array<T & { leaving: boolean }>; forget: (id: T['id']) => void } {
  /** 上一帧的数据源数组（引用比较即可：store 每次改动都换新数组） */
  const [prevItems, setPrevItems] = useState<T[]>(items);
  /** 数据源已删、出口还没播完的条目 */
  const [retained, setRetained] = useState<T[]>([]);

  /*
   * 「渲染期派生」而不是放进 effect 同步：effect 要到**下一帧**才把消失的条目补进来，
   * 中间那一帧数据源里已经没有了、rows 里也还没有 ⇒ 条目会先闪掉再冒出来。
   * （React 官方支持的「props 变化时调整 state」写法：在同一次渲染里同步补齐。）
   */
  if (prevItems !== items) {
    setPrevItems(items);
    const liveNow = new Set(items.map((i) => i.id));
    const gone = prevItems.filter((i) => !liveNow.has(i.id));
    if (gone.length > 0) {
      setRetained((r) => [...r, ...gone.filter((g) => !r.some((x) => x.id === g.id))]);
    }
  }

  const liveIds = new Set(items.map((i) => i.id));
  const rows: Array<T & { leaving: boolean }> = [
    ...items.map((i) => ({ ...i, leaving: false })),
    // 回来的条目（同 id 又被加回来）不算 leaving，去重交给 liveIds
    ...retained.filter((r) => !liveIds.has(r.id)).map((r) => ({ ...r, leaving: true })),
  ];

  const forget = useCallback((id: T['id']) => {
    // ★ 必须做「没变化就返回原数组」的等值短路：交还回调常常挂在 effect 里
    //   （`if (!mounted) onGone()`），每次都返回新数组 ⇒ 每次渲染都触发一次
    //   状态更新 ⇒ 自激成死循环。
    setRetained((r) => {
      const next = r.filter((x) => x.id !== id);
      return next.length === r.length ? r : next;
    });
  }, []);

  return { rows, forget };
}
