/**
 * 插件骨架 · 类型契约（v0.8.6 阶段 1）
 *
 * ── 这一版插件是什么、不是什么 ──
 * **是**：编译期内置的功能包。宿主在**构建期**就 import 它的代码，运行时可择其
 * 路由/侧栏入口/设置区块**启用或停用**（她 10-04：「插件要能手动在设置里面去开关」）。
 * **不是**：远程下载、动态 import、用户上传的任意代码。那三条各自需要签名体系/
 * CSP/沙箱，是本骨架**有意识留到后面**的东西（安全官红线：v1 只做编译期内置）。
 *
 * ── 两条硬约束（产品官定，2026-10-04 对齐）──
 *   ① **插件不自带持久化数据** —— 一切数据经 `IRepositoryBundle`（与宿主同一条路），
 *      这样备份/迁移/归属门全部自动继承，卸载插件不留孤儿表；
 *   ② **插件只声明、不回调宿主** —— manifest 是**声明式数据**（路由表、侧栏项、
 *      设置区块），没有 `activate(hooks)` 之类的活口：那是绕过审计的唯一入口。
 *
 * ── 为什么用「声明式 manifest」而不是「对象带方法」 ──
 * 因为**启停必须是摘节点，不是条件渲染**：停用一个插件 = 它的路由从不进入
 * `createBrowserRouter` 的数组、侧栏入口从不渲染。若用 `enabled ? <X/> : null`
 * 包在组件里，插件代码仍然在 bundle 里被执行到（副作用、store 订阅、定时器
 * 都活着），那不是真开关。
 */

import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router-dom';

/**
 * 能力声明（v1 只开 `data.read`）。
 *
 * 为什么 v1 只开只读：写能力需要两件事都到位后才能开——① 归属门下沉到仓储层
 * （F8，否则插件可绕门直写人类项目）；② capability 模型（代管桥，逐调用强制
 * 归属过滤）。那之前任何「能写数据的第三方插件」等于在没有边界的沙箱里跑别人
 * 的代码。安全官红线，产品官已写进 D7/D11。
 *
 * 注意：这是**声明**，不是授权。宿主仍可不给（管理员策略 cap），见
 * `capabilities` 字段注释。
 */
export type PluginCapability = 'data.read';

/** 插件来源。分层的唯一目的是**可信度视觉区分**（设计师：来源轴与能力轴正交）。 */
export type PluginSource = 'builtin' | 'member';

/**
 * 侧栏入口声明（由宿主渲染，插件只报「我要在哪、长什么样」）。
 * `adminOnly` 是**宿主级**判定（走 isAdmin），插件不自己判——判定必须单一出口。
 */
export interface PluginNavItem {
  /** 路由 path（与 routes 里某条一致，点它跳这里） */
  to: string;
  label: string;
  /** lucide 图标名（宿主侧映射表解析，避免把图标库塞进 manifest 数据） */
  icon: string;
  /** 侧栏分组（放在哪个区块里） */
  group: 'main' | 'agent';
  adminOnly?: boolean;
}

/**
 * 插件清单（manifest）——编译期内置的声明式数据。
 *
 * `id` 一旦发布**不可更改**：它是设置里启用状态的键名后缀
 * （`plugin.enabled.<id>`），也是用户认得出这条插件的唯一标识。
 */
export interface PluginManifest {
  /** 稳定 id；建议小写中划线（如 `agent-board`、`sample-projects`） */
  id: string;
  name: string;
  /** 一句话说明（设置里列表显示） */
  summary: string;
  version: string;
  source: PluginSource;
  /** 默认是否启用。新装的插件默认关还是开，**在这里说清**，不靠用户猜 */
  defaultEnabled: boolean;
  /**
   * 插件**声明**需要的能力（v1 只有 `data.read`）。
   *
   * ⚠️ 声明 ≠ 授权：管理员可用「能力上限策略（cap）」把某能力整体关掉——
   * 声明是上限请求，cap 是实际上限。缺省 = 不声明任何能力（纯展示/工具类）。
   */
  capabilities?: readonly PluginCapability[];
  /** 贡献的路由（相对 AppShell children 的 path） */
  routes?: RouteObject[];
  /** 贡献的侧栏入口 */
  nav?: PluginNavItem[];
  /** 贡献的设置区块（渲染在「设置 → 插件 → 已装」列表里点开的详情中） */
  settingsSlot?: ComponentType;
  /**
   * 推荐搭配（软依赖）：装了这个也建议装哪个。**只提示、不强制**——
   * 强制依赖会让「关掉一个插件」变成级联失效。
   */
  recommends?: string[];
  /* ── 以下三个字段仅「从文件安装」的成员自装插件使用（编译期内置永远不填）──
   * 与内置 manifest 并行两套契约：内置由构建期 import 代码，自装由磁盘 JSON 登记。
   * 作者侧产物形态与写入规范见 docs/plugin-api/install.md。 */
  /**
   * 入口文件（`'index.js'` IIFE 或 `'index.html'` 整页）。**声明了才有沙箱 iframe**；
   * 落盘 manifest 没有 entry 会被安装器拒绝（v1 自装插件的唯一界面出口就是它）。
   */
  entry?: string;
  /** 安装器写入的版本标记（覆盖写后用户在设置里看得见装了哪版） */
  installVersion?: string;
  /** 宿主最低版本要求；宿主低于它 ⇒ 启动扫描时跳过不登记 */
  minHostVersion?: string;
}

/** 设置 KV 里单个插件启用状态的键（单一出处，避免各处拼字符串漂移）。 */
export function pluginEnabledKey(pluginId: string): string {
  return `plugin.enabled.${pluginId}`;
}

/**
 * 注册表快照（纯数据，可测）：哪些插件在场、各自启用与否。
 * 组件与路由装配都从它派生 ⇒ 「同一个 manifest 不会被两处各解释一遍」。
 */
export interface PluginRegistryState {
  manifests: readonly PluginManifest[];
  /** pluginId → 是否启用。缺省按 manifest.defaultEnabled（见下面的解析函数） */
  enabled: Readonly<Record<string, boolean>>;
}
