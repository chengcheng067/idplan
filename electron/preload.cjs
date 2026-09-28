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
   * 自绘窗口三键（2026-09-23 起；此前是 setTitleBarTheme 给原生叠加层下发配色）。
   *
   * 为什么换：原生 titleBarOverlay 由系统合成器画在网页之上，DOM 模态遮罩盖不住它 ——
   * 弹窗一开背景压暗、三键亮度不变，像贴上去的（用户 2026-09-23 投诉）。
   * 自绘三键与内容同层同源，随主题/遮罩自然变暗，一类问题整类消失。
   *
   * 暴露面：三个动作（send）+ 最大化态查询（invoke）+ 最大化态变更推送（on）。
   * `onMaximizeChange` 返回取消订阅函数（与 onUpdateAvailable 同款最小暴露）。
   * 非 Windows（macOS/Linux）走系统装饰，`windowControls` 仍暴露但主进程无对应
   * 窗口语义时调用方应以 `isDesktop && platform === 'win32'` 先行判断（TopBar 已做）。
   */
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (cb) => {
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on('window:maximize-change', handler);
      return () => ipcRenderer.removeListener('window:maximize-change', handler);
    },
  },

  /**
   * Agent 接入文件（v0.8 · T04-B「接入外部写入方」重设计）。
   *
   * 渲染进程**不碰 fs**（sandbox preload 也不能）：由主进程把接入信息
   * （{origin, token, endpoints, payloadSchema, 用法}）写到固定路径
   * （documents/ID Plan/agent-ingress.json），外部写入方（如 WorkBuddy）
   * 读这一个文件即完成接入；令牌轮换后重新生成、写方重读。
   * `writeAgentIngressFile` 返回实际写入路径（目录不存在时创建）。
   */
  writeAgentIngressFile: (payload) => ipcRenderer.invoke('agent-ingress:write', payload),
  /** 只查固定路径（不触发写入；供面板展示「上次生成到哪」） */
  agentIngressFilePath: () => ipcRenderer.invoke('agent-ingress:path'),

  /**
   * 本机 Agent loopback（v1.0 · P0）：订阅主进程转来的导入请求。
   *
   * 外部写入方 → 主进程 HTTP server（127.0.0.1:17788）→ IPC 转发到渲染进程；
   * 渲染进程用 `payload.apply` + 自己的 repos 落库，再把结果经 `sendAgentImportResult`
   * 回传。返回**取消订阅函数**（页面卸载时调用），与 `onUpdateAvailable` 同款最小暴露。
   * 绝不经此桥暴露 ipcRenderer 本体。回调收到的负载形状见 src/vite-env.d.ts 的
   * `AgentImportRequest`。`onAgentImport` 不存在 = 老 preload，调用方须做存在性判断。
   */
  onAgentImport: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('agent:import-request', handler);
    return () => ipcRenderer.removeListener('agent:import-request', handler);
  },
  /** 把落库结果 / 错误回传给主进程（经 IPC），与 `onAgentImport` 配对 */
  sendAgentImportResult: (payload) => ipcRenderer.send('agent:import-result', payload),
  /**
   * 建板 / 读任务两条新事件（2026-09-24 桌面通道补齐 boards/tasks）。
   * 与 onAgentImport 同形：订阅主进程转发、渲染侧按 kind 分发；老版本 preload
   * 没有这两个键时，渲染侧 wireLoopbackReceiver 用可选链自然跳过。
   */
  onCreateBoard: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('agent:create-board-request', handler);
    return () => ipcRenderer.removeListener('agent:create-board-request', handler);
  },
  onListTasks: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('agent:list-tasks-request', handler);
    return () => ipcRenderer.removeListener('agent:list-tasks-request', handler);
  },
  /**
   * 订阅主进程 `health` 探活的 ping（`dataLayer` 真实判定的渲染侧一半）。
   *
   * ★ 收到 ping **只回 pong，不碰数据库** —— 探活每天会被打很多次，若让它走落库
   *   会污染数据。渲染侧的短路实现见 `useAgentLoopbackReceiver.handleAgentLoopbackMessage`。
   */
  onAgentPing: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('agent:ping', handler);
    return () => ipcRenderer.removeListener('agent:ping', handler);
  },
  /** 回复 ping（经 IPC），与 `onAgentPing` 配对 */
  sendAgentPong: (payload) => ipcRenderer.send('agent:pong', payload),
  /**
   * 把 token 告知主进程（主进程只留着比对，绝不回传原文）。渲染进程是 token 的
   * 持久化唯一出处（localStorage 的 `idplan.agentToken`），主进程仅内存持有。
   */
  setAgentToken: (token) => ipcRenderer.send('agent:token:set', token),
});
