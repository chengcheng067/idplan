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
  /** 成功：ApplyResult（四键恒定） */
  result?: import('./core/types/agent-payload').ApplyResult;
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
   * 同步自绘标题栏叠加层配色（Windows titleBarOverlay）。
   * 可选：老版本 preload 未暴露该方法，故调用方必须做存在性判断
   * （见 src/lib/titleBarTheme.ts）。浏览器 / NAS 端 window.idplan 本身就不存在。
   */
  setTitleBarTheme?: (theme: {
    /** 顶栏底色（--paper 实际值） */
    color: string;
    /** 顶栏前景（--ink 实际值） */
    symbolColor: string;
    /** 顶栏高度（<xl 56 / ≥xl 64） */
    height: number;
  }) => void;
  /**
   * 本机 Agent loopback（v1.0 · P0）：订阅主进程转来的导入请求。
   * 渲染进程用 payload.apply + 自己的 repos 落库，再经 sendAgentImportResult 回传。
   * 可选：老版本 preload 未暴露该方法，调用方必须做存在性判断。
   */
  onAgentImport?: (cb: (payload: AgentImportRequest) => void) => () => void;
  /** 把落库结果 / 错误回传给主进程（与 onAgentImport 配对） */
  sendAgentImportResult?: (payload: AgentImportResult) => void;
  /** 把 token 告知主进程（主进程只比对，绝不回传原文） */
  setAgentToken?: (token: string) => void;
}

interface Window {
  idplan?: IdPlanBridge;
}
