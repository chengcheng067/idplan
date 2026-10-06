/** wc-replica-preload.tmp.cjs —— 复刻窗口的 preload（与真 preload 的 windowControls 同形） */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('idplan', {
  isDesktop: true,
  platform: process.platform,
  version: '0.0.0.0',
  windowControls: {
    minimize: () => ipcRenderer.send('wc:noop'),
    toggleMaximize: () => ipcRenderer.send('wc:toggle'),
    close: () => ipcRenderer.send('wc:noop'),
    isMaximized: () => ipcRenderer.invoke('wc:noop').then(() => false),
    onMaximizeChange: () => () => {},
  },
});
