/**
 * 插件「从文件安装」· 渲染侧纯函数与契约常量（L2 · v0.8.6）
 *
 * ── 文件分工（为什么逻辑劈成两半）──
 * 主进程 CJS（electron/plugin-install.cjs）管**文件语义**：校验、落盘、扫描、
 * plug:// 路径——因为它要碰 fs。本文件管**合并语义与通信契约**：把扫描回来的
 * 磁盘 manifest 合并进注册表、定义宿主与沙箱 iframe 之间的 postMessage 协议。
 * 两边各自纯函数、各自有单测，接线层（PluginRegistryProvider / PluginSandboxFrame）
 * 只做「喂数据」。
 *
 * ── 三条不可动摇的合并口径 ──
 *   ① **defaultEnabled 恒 false**：磁盘 manifest 说什么都不算（合并时强制覆写）。
 *      「装」与「开」是两件事——探路实测确认 id 复用会继承上一个插件的启用态，
 *      所以「新装 = 默认关」不能靠作者自觉，得靠合并函数强制；
 *   ② **capabilities 只留 data.read**：磁盘 manifest 声明别的（写/网/文件保存）
 *      一律在此滤掉。v1 只有只读一项（types.ts 有完整论证），这不是君子协定；
 *   ③ **内置同名优先**：磁盘上躺一个 id 与随包插件相同的目录 = 内置说了算
 *      （随包插件是构建期可信代码，磁盘 JSON 不是）。
 */

import type { PluginCapability, PluginManifest } from './types';

/* ── 磁盘侧 manifest（主进程扫描/校验后的归一形状；字段与 plugin-install.cjs 对齐）── */

export interface InstalledPluginManifest {
  id: string;
  name: string;
  /** 允许为空（作者不写说明时合并层给默认文案） */
  summary: string;
  version: string;
  /** 入口文件（.html/.htm/.js/.mjs）——决定沙箱 iframe 的加载形态 */
  entry: string;
  installVersion?: string;
  minHostVersion?: string;
  /** 主进程已夹过一轮，这里再滤一次（双保险，见文件头口径②） */
  capabilities?: PluginCapability[];
}

/** 一条「扫到但没登记」的记录（坏 manifest / 版本不兼容；UI 展示计数，不静默） */
export interface SkippedPlugin {
  dir: string;
  reason: string;
}

/** 启动扫描结果（与 IPC `plugin:list` 返回值一致） */
export interface PluginScanResult {
  ok: boolean;
  installed: InstalledPluginManifest[];
  skipped: SkippedPlugin[];
  reason?: string;
}

/**
 * 合并：内置（编译期）+ 已安装（磁盘扫描）⇒ 注册表用的 manifest 数组。
 *
 * 顺序即展示序：随包在前、自装在后（与来源分层的视觉权重一致）。
 * 纯函数——「合并后 defaultEnabled 必须 false」这类口径由 spec 钉死在这里。
 */
export function mergeInstalledManifests(
  builtins: readonly PluginManifest[],
  installed: readonly InstalledPluginManifest[],
): PluginManifest[] {
  const out: PluginManifest[] = [...builtins];
  const seen = new Set(builtins.map((m) => m.id));
  for (const raw of installed) {
    if (seen.has(raw.id)) continue; // 口径③：内置同名优先
    seen.add(raw.id);
    out.push({
      id: raw.id,
      name: raw.name,
      summary: raw.summary || '（作者未提供说明）',
      version: raw.version,
      source: 'member',
      // 口径①：强制 false，磁盘 manifest 没有发言权（写它也不认）
      defaultEnabled: false,
      // 口径②：只留 data.read，其余一律滤掉
      capabilities: (raw.capabilities ?? []).filter((c) => c === 'data.read'),
      entry: raw.entry,
      ...(raw.installVersion ? { installVersion: raw.installVersion } : {}),
      ...(raw.minHostVersion ? { minHostVersion: raw.minHostVersion } : {}),
    });
  }
  return out;
}

/* ── 宿主 ⇄ 沙箱 iframe 的 postMessage 协议（author 契约见 docs/plugin-api/install.md）──
 *
 * 通道选型（探路实测）：数据面（parent DOM / window.idplan / localStorage /
 * IndexedDB）被 sandbox 挡死 ⇒ 数据只能经 postMessage 推；宿主侧推**每次现算的
 * 结构化克隆快照**（structuredClone 深拷贝，插件对返回值的任何写操作碰不到宿主）。
 * 插件不得轮询（轮询 = 隐式 CPU 出口），宿主在数据变化时主动广播。
 */

export const PLUGIN_MSG = {
  /** 宿主 → 插件：快照广播（mount 后每次数据变化都推） */
  snapshot: 'idplan-plugin-snapshot',
  /** 插件 → 宿主：开始监听了（宿主收到会立即补推当前快照，防首帧丢失） */
  ready: 'idplan-plugin-ready',
  /** 宿主 → 插件：请求卸载（停用/切插件时；插件须在 unmount 里清定时器与 DOM） */
  unmount: 'idplan-plugin-unmount',
  /** 插件 → 宿主：unmount 完成回执（宿主收到（或超时）后摘除 iframe） */
  unmountAck: 'idplan-plugin-unmount-ack',
} as const;

/** 协议版本（载荷形状变更时 +1；旧载荷直接忽略，不做兼容猜测） */
export const PLUGIN_MSG_VERSION = 1;

/** 推给插件的快照（全部字段每次现算、深拷贝后过结构化克隆边界） */
export interface PluginSnapshot {
  /** 宿主四段版本（x.y.z.build） */
  version: string;
  /** 当前生效主题（已解析 system） */
  theme: 'light' | 'dark';
  /** 人类侧项目（只读出口 useHumanProjects 的投影） */
  projects: readonly unknown[];
  stages: readonly unknown[];
  tasks: readonly unknown[];
}

/** IIFE 契约：插件产物只允许在 window 上挂这一个对象（探路报告 §9 草案） */
export interface PluginMountApi {
  /** 宿主四段版本 */
  readonly version: string;
  /** 当前主题（随快照变） */
  readonly theme: 'light' | 'dark';
  /** 最近一次广播的快照里的项目（深拷贝边界在 postMessage，改返回值不影响宿主） */
  getProjects(): readonly unknown[];
  getStages(): readonly unknown[];
  getTasks(): readonly unknown[];
  /** 订阅后续快照广播（宿主每次数据变化都会推）；返回取消订阅函数 */
  onSnapshot(cb: (snapshot: PluginSnapshot) => void): () => void;
}

export interface PluginMountHandle {
  unmount(): void;
}

export interface PluginGlobal {
  mount(api: PluginMountApi): PluginMountHandle | void;
}

/** entry 是 html？决定加载形态：html 走 plug:// src，js 宿主注入 IIFE */
export function isHtmlEntry(entry: string): boolean {
  return /\.html?$/i.test(entry);
}

/** 插件的 plug:// 入口地址（html 形态的 iframe src） */
export function pluginEntryUrl(pluginId: string, entry: string): string {
  return `plug://${pluginId}/${entry}`;
}
