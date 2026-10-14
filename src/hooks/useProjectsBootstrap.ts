import { useEffect, useRef } from 'react';

import type { IRepositoryBundle } from '../core/repositories/interfaces';
import { bootstrapAllStores, useRepos } from './useRepos';
import { useProjectsStore } from '../store/useProjectsStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { resolveErrorText } from '../core/types/enums';
/* ★ i18n 笔 misc：三处文案都在「事件发生时算一次」的位置（成功/失败/toast），
   故用模块级 `t`（不订阅）——与 `useLang.ts` 头注释第 ③ 条同口径。 */
import { t } from '../i18n';

/**
 * 应用启动引导：全量装载活跃数据进 stores（离线单机数据量小：
 * ≤50 项目 × 9 阶段 × ~30 任务 —— 全量装载策略无需分页）。
 *
 * ── 失败不再是「2 秒 toast」事件（审计 F1-①）──
 * 原实现只在失败时推一条 2 秒 toast 就结束，页面照常渲染出「还没有进行中的项目」。
 * 于是「没读进来」被伪装成「本来就没有」——用户最可能的自救动作是拿旧备份覆盖、
 * 或删站点数据，两者都会真的毁掉数据。
 *
 * 现在失败会写进 `useSettingsStore.failHydrate()`：
 *   · `hydrated` **保持 false**（三态判据的「失败」档，见 useSettingsStore 注释）；
 *   · 各页由 `<DataGate>` 渲染**常驻、可重试**的错误面（不依赖 toast——
 *     toast 是 2 秒即散的补充通道，不是失败面的载体）。
 *
 * 重试**不是刷新页面**（Electron 壳没有地址栏）：`DataGate` 的按钮调
 * `requestBootstrapRetry()` 把 `bootstrapAttempt` +1，本 hook 监听到该计数变化
 * 后重跑同一个 `bootstrapAllStores`。重跑是幂等的（纯读 + replaceAll）。
 */
export function useProjectsBootstrap(): void {
  const repos: IRepositoryBundle | null = safeRepos();
  const attempt = useSettingsStore((s) => s.bootstrapAttempt);
  /** 已跑过的 attempt 号：保证每个计数只跑一次（兼容 StrictMode 的双调用） */
  const ranAttemptRef = useRef(-1);

  useEffect(() => {
    if (!repos || ranAttemptRef.current === attempt) return;
    ranAttemptRef.current = attempt;
    void runBootstrap(repos);
  }, [repos, attempt]);
}

/**
 * 单次装载：成功置 `hydrated`（由 bootstrapAllStores 内部在休息制度注入后完成），
 * 失败写失败态并保留瞬时通道。返回是否成功（供单测/调用方判断，UI 不看它——
 * UI 一律看 store 的三态）。
 */
async function runBootstrap(repos: IRepositoryBundle): Promise<boolean> {
  try {
    await bootstrapAllStores(repos);
    useProjectsStore.getState().pushToast('info', t('bootstrap.loaded'));
    return true;
  } catch (err: unknown) {
    useSettingsStore.getState().failHydrate(describeFailure(err));
    // 瞬时通道保留（同一失败的第二条线索）；文案不再让人「刷新页面」——
    // 真正的重试入口是页面上的常驻错误面。
    useProjectsStore.getState().pushToast('error', t('bootstrap.loadFailed'));
    return false;
  }
}

/**
 * 失败原因文案：优先用 ChangxiaError 的 userMessage（面向用户写好的），
 * 退回原生 Error.message（截断，避免超长堆栈撑破错误面）。
 */
function describeFailure(err: unknown): string {
  const real = resolveErrorText(err, t);
  if (real) return real;
  if (err instanceof Error && err.message) return err.message.slice(0, 200);
  return t('bootstrap.unknownError');
}

/** Provider 未就绪时返回 null（组件树装配期调用安全） */
function safeRepos(): IRepositoryBundle | null {
  try {
    return useRepos();
  } catch {
    return null;
  }
}
