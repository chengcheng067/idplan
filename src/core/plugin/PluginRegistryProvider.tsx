/**
 * 插件骨架 · React 装配层（v0.8.6 阶段 1）
 *
 * 职责（也只做这些）：
 *   ① 把编译期 manifest 清单与 settings KV 里的启用状态合成 `PluginRegistryState`；
 *   ② 提供 `setPluginEnabled(id, on)`——写回 settings KV（桌面/NAS 同一路径，
 *      经 `IRepositoryBundle.settings`，所以备份/迁移自动继承）；
 *   ③ 派生**启用视图**：路由数组 + 侧栏入口 + 启用中的插件。
 *
 * **没有**在这里放任何动态 import / 远程加载 / 用户代码执行——那是后面的事
 * （安全官红线：v1 只做编译期内置）。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';

import { useRepos } from '../../hooks/useRepos';
import {
  describePluginState,
  enabledPlugins,
  isPluginEnabled,
  readEnabledFromSettings,
  resolveNavItems,
  resolveRoutes,
} from './registry';
import type { PluginManifest, PluginNavItem, PluginRegistryState } from './types';

/* ── 内置插件清单（编译期）───────────────────────────────────────────────
 * 唯一一份「本构建带了哪些插件」的事实源。成员自装插件将来也从这里进
 * （同样走编译期清单，只是 source 标 'member'）——「能装什么」由构建决定，
 * 不由用户上传决定，这是 v1 的安全边界。
 */
import { sampleProjectsManifest } from './builtin/sample-projects.manifest';
import { PLUGIN_MANIFESTS } from './builtin/index';

const BUILTIN_MANIFESTS: readonly PluginManifest[] = [
  ...PLUGIN_MANIFESTS,
  sampleProjectsManifest,
];

/**
 * ⚠️ 命名消歧（这里栽过一次）：`PluginRegistryState.enabled` 是 **KV 布尔表**
 * （pluginId → boolean），而本接口要给组件的是**启用中的插件数组**。两者都叫
 * enabled 会让 TS 把数组塞进 Record 类型的位置（本次实测的报错）。故派生字段
 * 一律带 Manifests 后缀。
 */
interface PluginRegistryValue extends Omit<PluginRegistryState, 'enabled'> {
  /** 切启用状态（写 settings KV；失败时抛给 UI 提示，不改内存） */
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<void>;
  /** 派生：启用中的插件（注意与 `enabledMap`/`PluginRegistryState.enabled` 区分） */
  enabledManifests: PluginManifest[];
  /** KV 布尔表（供 stateOf 等判定；组件一般用 enabledManifests） */
  enabledMap: Readonly<Record<string, boolean>>;
  /** 派生：合并插件路由（宿主路由作首参传入） */
  routesFor(hostRoutes: readonly RouteObject[]): RouteObject[];
  /** 派生：侧栏入口 */
  navItems: PluginNavItem[];
  /** 单插件状态（UI 开关用） */
  stateOf(pluginId: string): { enabled: boolean; explicit: boolean };
}

const PluginRegistryContext = createContext<PluginRegistryValue | null>(null);

export function PluginRegistryProvider({ children }: { children: ReactNode }): JSX.Element {
  const repos = useRepos();
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  // 启动：从 settings KV 还原启用状态（与身份/休息制度同一批启动读）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = (await repos.settings.all()) as Array<{ key: string; valueJson: string }>;
        if (!alive) return;
        setEnabledMap(readEnabledFromSettings(rows));
      } catch {
        if (alive) setEnabledMap({}); // 读失败 = 全员 defaultEnabled（fail-open）
      } finally {
        if (alive) setHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [repos]);

  const setPluginEnabled = useCallback(
    async (pluginId: string, enabled: boolean) => {
      // 先落库后改内存：**关掉插件这个动作本身必须可持久化**，否则刷新就回来了
      await repos.settings.set(`plugin.enabled.${pluginId}`, enabled);
      setEnabledMap((cur) => ({ ...cur, [pluginId]: enabled }));
    },
    [repos],
  );

  const value = useMemo<PluginRegistryValue>(() => {
    const state: PluginRegistryState = { manifests: BUILTIN_MANIFESTS, enabled: enabledMap };
    return {
      manifests: BUILTIN_MANIFESTS,
      // KV 原始布尔表（无记录 = 用 defaultEnabled）
      enabledMap: enabledMap,
      // 派生：启用中的插件
      enabledManifests: enabledPlugins(state),
      routesFor: (hostRoutes) => resolveRoutes(hostRoutes, state),
      navItems: resolveNavItems(state),
      setPluginEnabled,
      stateOf: (pluginId) => describePluginState(state, pluginId),
    };
  }, [enabledMap, setPluginEnabled]);

  /**
   * ⚠️ 未 hydrate 时**也必须**提供 context（这里栽过一次：早先写
   * `if (!hydrated) return <>{children}</>`，于是 AppRouter 里的
   * `usePluginRegistry()` 在 KV 读完前就抛「必须在 Provider 内使用」⇒ 整个
   * 应用白屏，28 个真 Chromium 验收 spec 全挂在 `waiting for header`）。
   *
   * 未 hydrate 时 `enabledMap` 为空 ⇒ 谓词回落 `defaultEnabled` ⇒ 首帧就能渲染，
   * 与「身份/休息制度未读到时先用本地回落」同一套启动哲学。
   * （hydrated 变量保留：后续若要给注册表做「正在读取」态 UI 用得上。）
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void hydrated;
  return <PluginRegistryContext.Provider value={value}>{children}</PluginRegistryContext.Provider>;

  return <PluginRegistryContext.Provider value={value}>{children}</PluginRegistryContext.Provider>;
}

export function usePluginRegistry(): PluginRegistryValue {
  const v = useContext(PluginRegistryContext);
  if (!v) throw new Error('usePluginRegistry 必须在 <PluginRegistryProvider> 内使用');
  return v;
}

/** 单插件启用查询（组件里常用，省去每次解构）。 */
export function usePluginEnabled(pluginId: string): {
  enabled: boolean;
  explicit: boolean;
  toggle(next?: boolean): Promise<void>;
} {
  const reg = usePluginRegistry();
  const { enabled, explicit } = reg.stateOf(pluginId);
  return {
    enabled,
    explicit,
    toggle: (next) => reg.setPluginEnabled(pluginId, next ?? !enabled),
  };
}

/** 设置详情里可能出现的插件设置区块（声明式挂载，插件不自己渲染页面）。 */
export function PluginSettingsSlot({ pluginId }: { pluginId: string }): JSX.Element | null {
  const reg = usePluginRegistry();
  const manifest = reg.manifests.find((m) => m.id === pluginId);
  const Slot: ComponentType | undefined = manifest?.settingsSlot;
  if (!Slot || !isPluginEnabled({ manifests: reg.manifests, enabled: reg.enabledMap }, pluginId)) {
    return null;
  }
  return <Slot />;
}
