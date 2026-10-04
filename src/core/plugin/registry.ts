/**
 * 插件骨架 · 注册表纯函数（v0.8.6 阶段 1）
 *
 * 全部是**纯函数**（无 IO、无 React）：给定 manifest 清单 + 启用状态 ⇒ 派生
 * 路由数组、侧栏项、启用中的插件。装配层（`usePluginRegistry`）只负责把
 * 持久化状态喂进来。
 *
 * 为什么强调纯函数：停用语义的正确性必须可测。**「停用一个插件 = 它的路由从不
 * 进入 router」**这件事若写在组件里，就只能靠肉眼看；写成纯函数，一条 spec
 * 就能钉死（且能变异验证）。
 */

import type { RouteObject } from 'react-router-dom';

import type { PluginManifest, PluginNavItem, PluginRegistryState } from './types';
import { pluginEnabledKey } from './types';

/**
 * 解析「这个插件此刻是否启用」。
 *
 * 优先级：**显式记录**（settings KV）> manifest.defaultEnabled > false。
 * 第一次见某插件（KV 里没有）时用它的 defaultEnabled ⇒ 新装的成员自装插件
 * 默认关、内置插件默认开，都由 manifest 自己说，不由代码猜。
 */
export function isPluginEnabled(state: PluginRegistryState, pluginId: string): boolean {
  const explicit = state.enabled[pluginId];
  if (explicit !== undefined) return explicit;
  return state.manifests.find((m) => m.id === pluginId)?.defaultEnabled ?? false;
}

/** 启用中的插件（保序：manifest 声明序 = 侧栏/设置的展示序）。 */
export function enabledPlugins(state: PluginRegistryState): PluginManifest[] {
  return state.manifests.filter((m) => isPluginEnabled(state, m.id));
}

/**
 * 合并插件路由进宿主子路由数组。
 *
 * 三条纪律：
 *   ① **只合并启用中的**——停用的插件路由**不存在**（不是重定向、不是 null
 *      渲染；是 createBrowserRouter 的数组里没有这一项）；
 *   ② **不改写宿主路由**——宿主路由原样在前，插件路由追加在后；
 *   ③ **通配符留最后**——若宿主已有 `path:'*'`，插件路由必须插在它前面，
 *      否则永远走不到（这条是路由注册的经典坑，写成注释防回归）。
 */
export function resolveRoutes(
  hostRoutes: readonly RouteObject[],
  state: PluginRegistryState,
): RouteObject[] {
  const wildcardIndex = hostRoutes.findIndex((r) => r.path === '*');
  const pluginRoutes = enabledPlugins(state).flatMap((m) => m.routes ?? []);
  if (wildcardIndex === -1) return [...hostRoutes, ...pluginRoutes];
  return [
    ...hostRoutes.slice(0, wildcardIndex),
    ...pluginRoutes,
    ...hostRoutes.slice(wildcardIndex),
  ];
}

/** 合并侧栏入口（同样只取启用中的；`group` 由宿主分区渲染）。 */
export function resolveNavItems(state: PluginRegistryState): PluginNavItem[] {
  return enabledPlugins(state).flatMap((m) => m.nav ?? []);
}

/**
 * 从 settings KV 行还原启用状态表。
 *
 * 只认 `plugin.enabled.` 前缀的键（`pluginEnabledKey` 单一出处），**跳过**一切
 * 非布尔值与坏 JSON：一个坏 settings 行不该让整个插件系统失效（fail-open 到
 * 「没记录 ⇒ 用 defaultEnabled」）。
 */
export function readEnabledFromSettings(
  rows: ReadonlyArray<{ key: string; valueJson: string }>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const prefix = 'plugin.enabled.';
  for (const row of rows) {
    if (!row.key.startsWith(prefix)) continue;
    const id = row.key.slice(prefix.length);
    if (!id) continue;
    try {
      const v: unknown = JSON.parse(row.valueJson);
      if (typeof v === 'boolean') out[id] = v;
    } catch {
      /* 坏行：跳过（保持「无记录」语义，由 defaultEnabled 兜底） */
    }
  }
  return out;
}

/** 供 UI 展示：这个插件的启用状态与「是不是显式设过的」。 */
export function describePluginState(
  state: PluginRegistryState,
  pluginId: string,
): { enabled: boolean; explicit: boolean } {
  const explicit = state.enabled[pluginId];
  return {
    enabled: isPluginEnabled(state, pluginId),
    explicit: explicit !== undefined,
  };
}

export { pluginEnabledKey };
