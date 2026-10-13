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
import { pluginEnabledKey } from './types';
import { mergeInstalledManifests } from './installed';
import type { InstalledPluginManifest, SkippedPlugin } from './installed';

/**
 * `readEnabledFromSettings` 的**单键版**：把「服务端这一格的当前值」归一成
 * `boolean | undefined`（undefined = 没有显式记录 ⇒ 语义上游落 manifest.defaultEnabled）。
 *
 * 为什么单立一个而不是复用 `readEnabledFromSettings`：G1 的写前校验只需要**一个键**，
 * 而那条路要读全表。两者的**归一规则必须一致**（坏值/非布尔一律当「无记录」），
 * 所以这里刻意与它逐条对齐：非 boolean 一律 undefined，绝不猜。
 */
function normalizeEnabledFlag(raw: unknown): boolean | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}

/**
 * KV 布尔表**浅比较**（键序无关）—— 只给「重读结果与内存一致就别换对象」用。
 *
 * 为什么在意对象引用：`enabledMap` 是 `value` → `withReady` 这条 memo 链的输入，
 * 而 `main.tsx` 的 `AppRouter` 有一句 `useEffect(..., [reg])` 会在注册表对象变化时
 * **重建一个 router 实例**。重读是幂等的（同一个服务端值读两次），若每次都换新对象，
 * 那么「用户只是打开设置 → 切到插件区」就会白重建一次 router —— 没有可观测收益的副作用。
 * 返回 `cur` 本身能让 React 直接跳过这次更新。
 */
function sameEnabledMap(
  a: Readonly<Record<string, boolean>>,
  b: Readonly<Record<string, boolean>>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

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
 * `setPluginEnabled` 的结果 —— **不抛异常**，失败原因要能分类（见 G 项与 PluginsSection 的
 * 三态文案）。为什么不是「成功 void / 失败 throw」：调用方需要区分「写冲突」与「其它失败」，
 * 而 throw 只给一个 `unknown`，分类判据只能靠字符串猜。返回判别式联合让**分类在源头发生**。
 *
 * 三类：
 *   · `ok`        —— 已落库 + 已更新内存。
 *   · `conflict`  —— **写前校验没通过**：服务端当前值与本次点击时本客户端持有的快照不一致
 *                    ⇒ **一个字都没写、内存也没动**。多标签页/多设备下的「基于旧快照的盲写」
 *                    会静默覆盖别人的改动，这里把它拦下来，交回调用方让用户刷新后重试。
 *   · `failed`    —— 读写本身失败（网络 / 鉴权 401 / 存储不可写…）。`error` 原样交回，
 *                    由 UI 按 `ChangxiaError.code` 分类成「存储」「服务端拒绝」「其它」。
 */
export type SetPluginEnabledResult =
  | { ok: true }
  | { ok: false; reason: 'conflict'; serverValue: boolean | undefined }
  | { ok: false; reason: 'failed'; error: unknown };

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
  /**
   * 切启用状态（写 settings KV）。**先做写前冲突校验再写**（见 {@link SetPluginEnabledResult}）；
   * 成功才更新内存。失败不抛，返回可分类的结果。
   */
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<SetPluginEnabledResult>;
  /**
   * 显式重读启用状态（settings KV → 内存）。**给「打开设置抽屉」这类入口用**：
   * 挂载时重读一次，让用户看到服务端当前值，而不是本浏览器启动时的旧快照。
   *
   * 刻意**不做**轮询、不做全局订阅：那会引入新的持续噪音源，而插件开关是极低频设置，
   * 「打开设置时读一次」已经覆盖全部真实场景（多标签页/多设备切换 = 用户会重新打开设置）。
   */
  reloadEnabled(): Promise<void>;
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

  /**
   * 重读启用状态（settings KV → 内存）。**入口型调用一次**即可，见接口注释。
   *
   * 读失败**保留当前内存快照**、不回退成空表：空表在语义上等于「全员 defaultEnabled」，
   * 那会把用户看得见的开关一次性全拨回默认值（比「这次没刷新成功」严重得多）。
   */
  const reloadEnabled = useCallback(async (): Promise<void> => {
    try {
      const rows = (await repos.settings.all()) as Array<{ key: string; valueJson: string }>;
      const next = readEnabledFromSettings(rows);
      // 值没变就别换对象（理由见 sameEnabledMap）：否则「打开设置」会白重建一次 router。
      // 返回 cur 本身 = React 直接跳过这次更新，下游一个 effect 都不会重跑。
      setEnabledMap((cur) => (sameEnabledMap(cur, next) ? cur : next));
    } catch {
      /* 读失败：保留内存快照（见上）。启动那一路的 fail-open 策略不适用这里——那时没有旧值可保。 */
    }
  }, [repos]);

  const setPluginEnabled = useCallback(
    async (pluginId: string, enabled: boolean): Promise<SetPluginEnabledResult> => {
      const key = pluginEnabledKey(pluginId);
      /**
       * 本次点击时本客户端持有的快照值 = 内存 KV 表里那一格（undefined = 无显式记录，
       * 语义上等于「跟随 defaultEnabled」）。**不从 `stateOf()` 取**——那个已经把
       * defaultEnabled 折叠进来了，拿它比对会把「服务端没有记录」误判成冲突。
       */
      const expected = normalizeEnabledFlag(enabledMap[pluginId]);
      try {
        /**
         * ── 写前冲突校验（G1）──
         * 读取是**免鉴权**的（服务端 `GET /api/settings/:key` 不带 guardWrite），所以这一步
         * 不会因为「没配令牌」而失败——它失败只说明真的读不到。
         *
         * 为什么必须做：本客户端的 `enabledMap` 是**启动时读一次**的快照。另一个标签页 /
         * 另一台设备改过之后，这边仍揣着旧值；直接写 = 基于旧快照的盲写，会**静默覆盖**
         * 别人的改动。这里把差异显式挡下来，让用户刷新后重试（宁可让他多点一次，
         * 也不要不声不响抹掉别人刚改的设置）。
         */
        const serverValue = normalizeEnabledFlag(await repos.settings.get<unknown>(key));
        if (serverValue !== expected) {
          return { ok: false, reason: 'conflict', serverValue };
        }
      } catch (err) {
        return { ok: false, reason: 'failed', error: err };
      }
      try {
        // 先落库后改内存：**关掉插件这个动作本身必须可持久化**，否则刷新就回来了
        await repos.settings.set(key, enabled);
      } catch (err) {
        return { ok: false, reason: 'failed', error: err };
      }
      setEnabledMap((cur) => ({ ...cur, [pluginId]: enabled }));
      return { ok: true };
    },
    // `enabledMap` 必须进依赖：写前校验要拿「点击那一刻的快照」。它的变化本来就会重建
    // `value`（下面那个 memo 一直依赖 enabledMap），故这里不引入任何**新**的重建时机。
    [repos, enabledMap],
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
      reloadEnabled,
      stateOf: (pluginId) => describePluginState(state, pluginId),
      installedIds,
      skippedPlugins: skipped,
      // 真实值由下方 withReady 覆盖；此处给保守默认（未就绪）
      registryReady: false,
    };
  }, [enabledMap, setPluginEnabled, reloadEnabled, manifests, installedIds, skipped]);

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
 * ── 降级语义（v1.0 订正：此前是错的）──
 * **本降级档要复现的就是「Provider 在、KV 还没读完」那一帧**（生产里的未 hydrate 态）：
 * 那一帧的状态是 `manifests = 真实内置清单` + `enabled = {}` ⇒ 谓词全部回落
 * `defaultEnabled`。所以这里的回落**必须同样基于真实清单**。
 *
 * 订正前的写法是 `manifests: []` + `stateOf` 硬编码 `{enabled:false}`，与上面那句注释
 * 自相矛盾，且与生产不一致：实测（`qa-scratch/probe-no-provider.spec.tsx`）在无 Provider
 * 下渲染 `MobileMoreMenu`，`stateOf('agent-board')` 报 `enabled:false`、⋮ 菜单里
 * **Agent 项消失**——尽管它 `defaultEnabled: true`。
 * 后果不是「真机坏了」（main.tsx 恒包 Provider），而是**测试再也没法诚实地复现
 * 未 hydrate 那一帧**：任何「不包 Provider 渲染壳层」的 spec 都会看到一个比真机
 * 更少渲染的树，于是「Agent 入口在没读完 KV 时会不会闪一下」这类问题永远测不到。
 *
 * 代价（如实登记）：不包 Provider 的单测现在会看到 Agent 侧栏入口 / 插件路由——
 * 那正是**真机未 hydrate 时的样子**。若某个 spec 因此变红，要先判断它是不是
 * 依赖了「空清单」这个错的回落值，而不是先把这里改回去。
 *
 * `registryReady` 仍恒 `true`（**故意的例外**）：真机上未 hydrate 时 AppRouter 会先
 * 渲染「正在加载…」占位而不建路由；若这里也报 false，所有不包 Provider 的真 Chromium
 * spec 都会卡在 `waiting for header`（这是「我」栽过的那个坑）。
 */
export function usePluginRegistry(): PluginRegistryValue {
  const v = useContext(PluginRegistryContext);
  if (!v) {
    // 与「Provider 在、KV 空」逐字同源的派生（同一批纯函数，不另写一套判断）
    const unhydrated: PluginRegistryState = { manifests: BUILTIN_MANIFESTS, enabled: {} };
    return {
      manifests: BUILTIN_MANIFESTS,
      enabledMap: {},
      enabledManifests: enabledPlugins(unhydrated),
      routesFor: (host) => resolveRoutes(host, unhydrated),
      navItems: resolveNavItems(unhydrated),
      setPluginEnabled: async (): Promise<SetPluginEnabledResult> => ({
        ok: false,
        reason: 'failed',
        error: new Error('插件注册表不可用（无 Provider），无法保存开关'),
      }),
      // 无 Provider ⇒ 无 KV 可读 ⇒ 重读是**无害的空操作**（不是「假装成功」：
      // 本降级档的可观测状态本来就等同「未 hydrate」）。
      reloadEnabled: async () => undefined,
      stateOf: (pluginId) => describePluginState(unhydrated, pluginId),
      installedIds: new Set<string>(),
      skippedPlugins: [],
      registryReady: true,
    };
  }
  return v;
}

/** 单插件启用查询（组件里常用，省去每次解构）。 */
export function usePluginEnabled(pluginId: string): {
  enabled: boolean;
  explicit: boolean;
  toggle(next?: boolean): Promise<SetPluginEnabledResult>;
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
