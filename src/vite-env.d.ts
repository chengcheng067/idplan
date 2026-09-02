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
}

interface Window {
  idplan?: IdPlanBridge;
}
