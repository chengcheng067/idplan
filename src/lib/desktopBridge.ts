/**
 * 桌面端桥接层（渲染进程侧入口）。
 *
 * 设计意图（重要）：更新检测只在 Windows 桌面版（Electron）生效；NAS / Docker / 浏览器版
 * 不出现任何更新相关 UI、不发起任何网络请求。判定方式就是 window.idplan 是否存在——
 * 它仅由 electron/preload.cjs 经 contextBridge 注入，浏览器 / NAS 端永远不会定义 window.idplan。
 * 因此 isDesktop() 返回 false 时，所有更新代码统一短路：不渲染 UI、不调用 checkUpdate、不订阅事件。
 * 这是「NAS 版不加更新功能」的落地方式（用户明确：NAS 版每次更新手动推绿联，不需要自动检测）。
 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.idplan?.isDesktop === true;
}
