/**
 * 插件骨架 · React 装配层（v0.8.6 阶段 1）
 *
 * 职责（也只做这些）：
 *   ① 把编译期 manifest 清单与 settings KV 里的启用状态合成 `PluginRegistryState`；
 *   ② 提供 `setPluginEnabled(id, on)`——写回 settings KV（桌面/NAS 同一路径，
 *      经 `IRepositoryBundle.settings`，所以备份/迁移自动继承）；
 *   ③ 派生**启用视图**：路由数组 + 侧栏入口 + 启用中的插件。
 *
 * v0.8.6 · L2「从文件安装」之后新增第 ④ 项：启动时经 IPC 扫 userData/plugins 下的
 * 已安装插件，合并进注册表（默认关、只只读、内置同名优先）。扫描**只在启动做一次**
 * ——运行期不热加载，所以「装完要重启」不是偷懒，是登记入口唯一（压安装/卸载竞态）。
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
import { mergeInstalledManifests } from './installed';
import type { InstalledPluginManifest, SkippedPlugin } from './installed';

/* ── 内置插件清单（编译期）───────────────────────────────────────────────
 * 唯一一份「本构建带了哪些插件」的事实源。成员自装插件**不再**从这里进——
 * v0.8.6 L2 起它们经启动扫描（userData/plugins）登记，与编译期清单**并行两套**，
 * 由 mergeInstalledManifests 合并（内置同名优先、自装默认关）。
 */
import { sampleProjectsManifest } from './builtin/sample-projects.manifest';
import { weeklyReportManifest } from '../../plugins/weekly-report/manifest';
import { PLUGIN_MANIFESTS } from './builtin/index';

/**
 * 本构建附带的全部插件（**编译期固定**——这是 v1 的安全边界：「能装什么」由
 * 构建决定，不由用户上传决定；安全官红线：v1 无远程加载、无动态 import）。
 *
 * `PLUGIN_MANIFESTS`（随包分发，source:'builtin'）在前、`sampleProjectsManifest`
 * （标本，builtin）随后、第三方样板（source:'member'）最后——顺序即设置里与
 * 侧栏的展示序：随包的在前、第三方在后，与来源分层的视觉权重一致。
 */
const BUILTIN_MANIFESTS: readonly PluginManifest[] = [
  ...PLUGIN_MANIFESTS,
  sampleProjectsManifest,
  weeklyReportManifest,
];

/**
 * ⚠️ 命名消歧（这里栽过一次）：`PluginRegistryState.enabled` 是 **KV 布尔表**
 * （pluginId → boolean），而本接口要给组件的是**启用中的插件数组**。两者都叫
 * enabled 会让 TS 把数组塞进 Record 类型的位置（本次实测的报错）。故派生字段
 * 一律带 Manifests 后缀。
 */
interface PluginRegistryValue extends Omit<PluginRegistryState, 'enabled'> {
  /**
   * settings KV 是否已读完（未读完时路由不该建 ⇒ 见 AppRouter）。
   * 注意：**不含**启动扫描那一路——扫描允许晚上一帧（fail-open），路由正确性优先。
   */
  registryReady: boolean;
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
  /** 已安装（从文件安装）插件的 id 集合——UI 据此显示「卸载」入口（内置无此键） */
  installedIds: ReadonlySet<string>;
  /** 扫描到但未登记的插件（坏 manifest / 版本不兼容）；非空时 UI 展示计数 */
  skippedPlugins: readonly SkippedPlugin[];
}

const PluginRegistryContext = createContext<PluginRegistryValue | null>(null);

export function PluginRegistryProvider({ children }: { children: ReactNode }): JSX.Element {
  const repos = useRepos();
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  /** L2：启动扫描回来的已安装插件（合并进注册表；非桌面/扫描失败 = 空） */
  const [installed, setInstalled] = useState<readonly InstalledPluginManifest[]>([]);
  const [skipped, setSkipped] = useState<readonly SkippedPlugin[]>([]);

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

  /**
   * L2：启动扫描已安装插件（**只此一次**——运行期不热加载，装完要重启）。
   *
   * 与上面那路 KV 读并行发起、独立完成：扫描失败（老 preload / 浏览器端无桥）
   * 绝不影响 KV 那一路 ⇒ 插件系统主体功能零依赖安装链路。`registryReady` 以
   * KV 那一路为准（路由不建错比自装插件晚上一帧重要得多）。
   */
  useEffect(() => {
    let alive = true;
    const bridge = typeof window !== 'undefined' ? window.idplan?.pluginInstall : undefined;
    if (!bridge) return; // 非桌面（浏览器 / NAS）：没有本地安装这回事
    void (async () => {
      try {
        const scan = await bridge.listInstalled();
        if (!alive) return;
        if (scan && scan.ok) {
          setInstalled(scan.installed ?? []);
          setSkipped(scan.skipped ?? []);
        }
      } catch {
        /* 扫描失败 = 当作什么都没装（fail-open；启动不该被它挡住） */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const manifests = useMemo(
    () => mergeInstalledManifests(BUILTIN_MANIFESTS, installed),
    [installed],
  );
  const installedIds = useMemo(
    () => new Set(installed.map((m) => m.id)),
    [installed],
  );

  const setPluginEnabled = useCallback(
    async (pluginId: string, enabled: boolean) => {
      // 先落库后改内存：**关掉插件这个动作本身必须可持久化**，否则刷新就回来了
      await repos.settings.set(`plugin.enabled.${pluginId}`, enabled);
      setEnabledMap((cur) => ({ ...cur, [pluginId]: enabled }));
    },
    [repos],
  );

  const value = useMemo<PluginRegistryValue>(() => {
    const state: PluginRegistryState = { manifests, enabled: enabledMap };
    return {
      manifests,
      // KV 原始布尔表（无记录 = 用 defaultEnabled）
      enabledMap: enabledMap,
      // 派生：启用中的插件
      enabledManifests: enabledPlugins(state),
      routesFor: (hostRoutes) => resolveRoutes(hostRoutes, state),
      navItems: resolveNavItems(state),
      setPluginEnabled,
      stateOf: (pluginId) => describePluginState(state, pluginId),
      installedIds,
      skippedPlugins: skipped,
      // 真实值由下方 withReady 覆盖；此处给保守默认（未就绪）
      registryReady: false,
    };
  }, [enabledMap, setPluginEnabled, manifests, installedIds, skipped]);

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
  const withReady = useMemo<PluginRegistryValue>(
    () => ({ ...value, registryReady: hydrated }),
    [value, hydrated],
  );
  return <PluginRegistryContext.Provider value={withReady}>{children}</PluginRegistryContext.Provider>;
}

/**
 * 取注册表。
 *
 * ⚠️ **无 Provider 时降级而非抛错**（这里也栽过一次）：侧栏（SidebarNav）在
 * 阶段 2 接入了注册表，于是所有渲染侧栏的既有 spec 突然要包 Provider——
 * 抛错会让「加一个消费点」变成「改 N 个测试」，且下次再有人消费还是这个坑。
 *
 * 降级语义：空清单 + 空启用表 ⇒ 谓词全部回落 defaultEnabled ⇒ **没有插件时
 * 表现与「什么都没装」一致**，渲染面只少不崩。真实运行路径上 Provider 一定在
 * （main.tsx），所以降级只影响测试/故事书场景——那正是我们想要的兜底方向。
 */
export function usePluginRegistry(): PluginRegistryValue {
  const v = useContext(PluginRegistryContext);
  if (!v) {
    return {
      manifests: [],
      enabledMap: {},
      enabledManifests: [],
      routesFor: (host) => [...host],
      navItems: [],
      setPluginEnabled: async () => {
        throw new Error('插件注册表不可用（无 Provider），无法保存开关');
      },
      stateOf: () => ({ enabled: false, explicit: false }),
      installedIds: new Set<string>(),
      skippedPlugins: [],
      // 无 Provider ⇒ 无 KV 可读 ⇒ 视为「没有插件」且已就绪
      //   （若报 false 会把真 Chromium spec 卡在「正在加载…」——那是我刚修的回退）
      registryReady: true,
    };
  }
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
