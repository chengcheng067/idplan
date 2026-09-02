/**
 * 桌面端更新检测的负载类型定义（渲染进程侧）。
 *
 * 该结构与 electron/preload.cjs 暴露的 window.idplan 桥以及 electron/main.cjs 的
 * update:check / update:available 返回的负载严格一致。改结构须三处同步。
 */
export interface UpdatePayload {
  /** 当前已装版本（四段，来自 version.json / BUILD_VERSION） */
  current: string;
  /** GitHub latest release 的 tag（如 v0.3.0.0019） */
  latest: string;
  /** 是否发现更新（仅当 latest 是合法桌面版 tag 且确实更新时才为 true） */
  hasUpdate: boolean;
  /** release 页面地址，供「前往下载」跳转 */
  releaseUrl: string | null;
  /** 发布时间（ISO 字符串） */
  publishedAt: string | null;
  /** release 说明（changelog） */
  notes: string | null;
  /** 第一个 .exe 资源的下载地址；找不到则为 null（这时退回 releaseUrl） */
  exeAssetUrl: string | null;
}
