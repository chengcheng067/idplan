/// <reference types="vite/client" />

/**
 * 环境变量类型声明（.env / .env.local）。
 * 切换数据源属于进程启动时的冷切换，不支持运行中热切换（架构决策）。
 */
interface ImportMetaEnv {
  /** local | remote，非法值回落 local */
  readonly VITE_DATA_SOURCE?: string;
  /** remote 模式的 API 前缀，如 http://192.168.1.10:7788/api */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Agent 导入请求（主进程 loopback 经 IPC 转发到渲染进程；见 electron/loopback.cjs） */
interface AgentImportRequest {
  requestId: string;
  dryRun: boolean;
  projectId?: string;
  stageName?: string;
  /** 原始 payload JSON（未经结构校验，渲染进程侧用 validateAgentPayload 收口） */
  payload: unknown;
}

/** 渲染进程回传的落库结果 / 错误（与主进程 loopback.cjs 解析严格一致） */
interface AgentImportResult {
  requestId: string;
  /**
   * 成功体（多态，按请求 kind 区分）：
   *   · import  → `ApplyResult`（四键恒定）
   *   · boards  → `{ projectId, name, stages:[{id,name,templateKey}] }`（镜像服务端 201 体）
   *   · tasks   → `{ tasks:[{externalId,taskNo,title,status,dueDate,dependsOnExternal}] }`
   * 2026-09-24 桌面通道补齐 boards/tasks 后由单一 ApplyResult 放宽为 unknown——
   * 主进程只透传不解析，形状契约在渲染侧 runAgent* 与服务端路由两处同源镜像。
   */
  result?: unknown;
  /** 失败：机器码 + HTTP 状态码 + 用户可读中文 */
  error?: { code: string; httpStatus?: number; userMessage: string };
}

/**
 * 渲染进程通过 preload（electron/preload.cjs）经 contextBridge 注入的桌面端桥接。
 * 仅 Electron 运行时会存在；浏览器 / NAS 端 window.idplan 永不存在，
 * 这是「NAS 版不加载更新功能」的判定开关（见 src/lib/desktopBridge.ts）。
 *
 * 字段须与 preload.cjs 暴露对象严格一致；负载结构镜像 src/lib/update.types.ts。
 */
interface IdPlanBridge {
  isDesktop: boolean;
  platform: string;
  version: string;
  /** 主动检查更新，返回更新负载；失败抛错由调用方处理（仅手动检查才反馈失败） */
  checkUpdate: () => Promise<{
    current: string;
    latest: string;
    hasUpdate: boolean;
    releaseUrl: string | null;
    publishedAt: string | null;
    notes: string | null;
    exeAssetUrl: string | null;
  }>;
  /** 订阅主进程「发现新版本」推送，返回取消订阅函数 */
  onUpdateAvailable: (
    cb: (payload: {
      current: string;
      latest: string;
      hasUpdate: boolean;
      releaseUrl: string | null;
      publishedAt: string | null;
      notes: string | null;
      exeAssetUrl: string | null;
    }) => void,
  ) => () => void;
  /**
   * 自绘窗口三键（2026-09-23 起，取代原 setTitleBarTheme 叠加层配色下发）。
   * 原生 titleBarOverlay 由系统合成器画在网页之上，DOM 遮罩盖不住它——
   * 自绘三键与内容同层同源，随主题/遮罩自然变暗。
   * 可选：老版本 preload 未暴露，调用方须做存在性判断（TopBar 的 WindowControls 已做）。
   */
  windowControls?: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
  };
  /**
   * 写入 Agent 接入文件（固定路径 documents/ID Plan/agent-ingress.json）。
   * 外部写入方读该文件即完成接入；返回实际路径或失败原因。老版本 preload 可选。
   */
  writeAgentIngressFile?: (payload: Record<string, unknown>) => Promise<{ ok: boolean; path: string; reason?: string }>;
  /** 只查接入文件固定路径（不触发写入）；老版本 preload 可选 */
  agentIngressFilePath?: () => Promise<string>;
  /**
   * 本机 Agent loopback（v1.0 · P0）：订阅主进程转来的导入请求。
   * 渲染进程用 payload.apply + 自己的 repos 落库，再经 sendAgentImportResult 回传。
   * 可选：老版本 preload 未暴露该方法，调用方必须做存在性判断。
   */
  onAgentImport?: (cb: (payload: AgentImportRequest) => void) => () => void;
  /** 把落库结果 / 错误回传给主进程（与 onAgentImport 配对） */
  sendAgentImportResult?: (payload: AgentImportResult) => void;
  /**
   * 订阅主进程 `health` 探活用的 ping（`dataLayer` 真实判定的一半）。
   * 收到即回 pong，**不碰数据库**；老版本 preload 未暴露时可选。
   */
  onAgentPing?: (cb: (payload: { requestId: string; kind: 'ping' }) => void) => () => void;
  /** 回复 ping（与 onAgentPing 配对） */
  sendAgentPong?: (payload: { requestId: string }) => void;
  /** 把 token 告知主进程（主进程只比对，绝不回传原文） */
  setAgentToken?: (token: string) => void;
  /**
   * 插件「从文件安装」（L2 · v0.8.6 · 刻意最小四方法）。
   * 老版本 preload 未暴露 ⇒ 可选；调用方（设置 → 插件面板）做存在性判断，
   * 不存在时「从文件安装」入口整个不渲染（浏览器 / NAS 端同理）。
   */
  pluginInstall?: {
    /** 打开文件选择器（只让选 manifest.json）；取消时 canceled=true */
    pickManifestFile: () => Promise<{
      ok: boolean;
      canceled?: boolean;
      filePath?: string;
      reason?: string;
    }>;
    /** 校验 + 整目录落盘；成功返回归一 manifest 与文件数，失败带中文 reason */
    installFromFile: (
      filePath: string,
    ) => Promise<
      | { ok: true; manifest: import('./core/plugin/installed').InstalledPluginManifest; fileCount: number }
      | { ok: false; reason: string }
    >;
    /** 启动扫描（登记入口唯一；坏 manifest fail-open 跳过并随 skipped 返回） */
    listInstalled: () => Promise<import('./core/plugin/installed').PluginScanResult>;
    /** 删除插件目录（幂等；KV 由渲染侧清） */
    uninstall: (pluginId: string) => Promise<{ ok: boolean; reason?: string }>;
  };
}

interface Window {
  idplan?: IdPlanBridge;
}
