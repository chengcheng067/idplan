import { useEffect, useRef } from 'react';

import { useExitRetained } from '../../hooks/useExitRetained';
import { usePresence } from '../../hooks/usePresence';
import { useProjectsStore, type ToastSignal } from '../../store/useProjectsStore';
import { cn } from '../../lib/cn';

/**
 * 单个 Toast 的**生命周期**（进出场自己管，皮肤由调用方给）。
 *
 * 为什么抽出来：AppShell（常驻全局层，玻璃皮肤）与 ToastHost（独立挂载场景，
 * 实心皮肤）是同一段 JSX 的两份复制，出口接线要碰的正是这段生命周期 ——
 * 复制两份就是给「两处漂移」埋雷。
 *
 * 出口怎么发生的：调用方的列表由 `useExitRetained` 提供。Toast 被 `dismissToast`
 * 从 store 摘掉之后并不会立刻从列表里消失，而是带着 `leaving: true` 再渲染一帧；
 * 本组件据此把 presence 的 `active` 翻成 false ⇒ 挂上 `toast-exit`、打上
 * `pointer-events: none`、等 `animationend`（或兜底 cap）⇒ 卸载 ⇒ 回调 `onGone`
 * 交还给列表，这时它才真正从列表里消失。
 *
 * `pointer-events: none` 的意义（team-lead 2026-10-11 定的规矩）：出场的 200ms 里
 * 用户可能正在点下一个操作，**视觉余韵绝不允许拦输入**。
 */
export function ToastItem({
  toast,
  leaving,
  onDismiss,
  onGone,
  variant,
  className,
}: {
  toast: ToastSignal;
  /** 数据源已删、正在播出口动画 */
  leaving: boolean;
  onDismiss(id: number): void;
  /** 出口结束（含兜底强制结束）后交还列表 */
  onGone(): void;
  /** 皮肤档：`solid` 实心（ToastHost）/ `glass` 玻璃（AppShell） */
  variant: 'solid' | 'glass';
  /** 皮肤：AppShell 传玻璃档，ToastHost 传实心档 */
  className?: string;
}): JSX.Element | null {
  const p = usePresence(!leaving, { enterClass: 'toast-enter', exitClass: 'toast-exit' });

  // onGone 用 ref 持有：调用方常在 map 里写内联箭头函数（每次渲染都是新引用），
  // 直接进依赖会让这个 effect 每帧都跑一遍。
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  useEffect(() => {
    if (!p.mounted) onGoneRef.current();
  }, [p.mounted]);

  if (!p.mounted) return null;

  return (
    <button
      type="button"
      ref={p.exitRef}
      onClick={() => onDismiss(toast.id)}
      className={cn(
        'toast-enter pointer-events-auto px-4 py-2 text-sm shadow-soft',
        toastSkin(toast.kind, variant),
        className,
      )}
    >
      {toast.message}
    </button>
  );
}

/**
 * kind → 配色。两套皮肤共用这一张表（`solid` = ToastHost 实心，`glass` = AppShell 玻璃）。
 *
 * 为什么由调用方给而不是 ToastItem 内定：`cn` 是 clsx 直通、**不做冲突消解**，
 * 把两套配色都塞进 ToastItem 会同时产出 `bg-pine` 与 `glass-medium`（背景打架）。
 * 沿用接线前的两套原样配色，一个色值都没动。
 */
export function toastSkin(kind: ToastSignal['kind'], variant: 'solid' | 'glass'): string {
  if (variant === 'glass') {
    return kind === 'success' ? 'text-moss' : kind === 'error' ? 'text-clay' : 'text-ink';
  }
  return kind === 'success'
    ? 'bg-pine text-cream'
    : kind === 'error'
      ? 'bg-clay text-white'
      : 'bg-ink text-cream';
}

/**
 * 瞬时操作反馈 Toast 容器（PRD 交互规则 2）：
 * 全部写操作成功只弹瞬时 toast（≤2s 自动消失，由 store.pushToast 驱动），
 * 绝不出现全屏 loading 圈。AppShell 已内联同款实现——本组件供独立挂载场景复用。
 */
export function ToastHost(): JSX.Element {
  const storeToasts = useProjectsStore((s) => s.toasts);
  const dismiss = useProjectsStore((s) => s.dismissToast);
  const { rows, forget } = useExitRetained(storeToasts);

  // 计时器只认数据源（含出口期保留的条目会重复上表 → 去重交给 store 的 id 过滤）
  useEffect(() => {
    if (storeToasts.length === 0) return;
    const timers = storeToasts.map((t) => window.setTimeout(() => dismiss(t.id), 2000));
    return () => timers.forEach(clearTimeout);
  }, [storeToasts, dismiss]);

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {rows.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          leaving={t.leaving}
          onDismiss={dismiss}
          onGone={() => forget(t.id)}
          variant="solid"
          className="rounded-md"
        />
      ))}
    </div>
  );
}
