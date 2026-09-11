/**
 * ID Plan · Electron 预加载脚本
 * 通过 contextBridge 向渲染进程暴露最小化、安全的能力。
 *
 * v0.3 版本号收敛：打包后 process.env.npm_package_version 不存在，旧写法会恒落到 '0.2.0'
 * 旧默认值。故真实版本号改由主进程通过 additionalArguments 注入，preload 从 process.argv 读取——
 * 比 sendSync 稳：不会在 preload 顶层同步阻塞渲染进程，也不依赖主进程 handler 已注册。
 *
 * sandbox: true 下 preload 不能 require node 模块，网络请求一律在主进程（main.cjs）完成；
 * 这里只暴露「调用主进程能力的桥」与「接收主进程推送的事件」，最小暴露面。
 */
const { contextBridge, ipcRenderer } = require('electron');

// 真实版本号（--idplan-version=<v>，由 main.cjs 创建窗口时注入，与 GitHub Release tag 一致）
const VERSION_ARG = '--idplan-version=';
const versionArg = process.argv.find((a) => typeof a === 'string' && a.startsWith(VERSION_ARG));
const version = versionArg ? versionArg.slice(VERSION_ARG.length) : '0.3.0.0018';

contextBridge.exposeInMainWorld('idplan', {
  /** 应用标识（供前端识别运行在桌面端） */
  isDesktop: true,
  platform: process.platform,
  version,
  /** 主动检查更新（设置面板「检查更新」调用），返回更新负载；失败抛错由调用方处理 */
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  /** 订阅主进程「发现新版本」推送，返回取消订阅函数 */
  onUpdateAvailable: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  /**
   * 通知主进程同步**自绘标题栏叠加层**（Windows titleBarOverlay）的配色与高度，
   * 让原生三键区与顶栏内容区同色一体（画板 02 亮 / 板 12 暗）。
   *
   * 入参由渲染进程从 CSS 变量的**实际计算值**取出（见 src/lib/titleBarTheme.ts）：
   *   color      顶栏底色（亮 #FFFFFF / 暗 #1F2126，即 --paper）
   *   symbolColor 顶栏前景（即 --ink）
   *   height      顶栏高度（<xl 56 / ≥xl 64，与 TopBar 的 h-14 xl:h-16 同口径）
   * 单向 send 即可：主进程无需回执，且非 Windows 时主进程会静默忽略。
   */
  setTitleBarTheme: (theme) =>
    ipcRenderer.send('theme:set', {
      color: theme?.color,
      symbolColor: theme?.symbolColor,
      height: theme?.height,
    }),
});
