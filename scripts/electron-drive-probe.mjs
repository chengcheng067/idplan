/**
 * 最小可行性探测：能否用 playwright-core 的 _electron 驱动本项目 Electron 应用。
 *
 * 只验证「驱动链路是否成立」，不做任何走查断言。用完即可删。
 */
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const t0 = Date.now();
const step = (msg) => console.log(`[${String(Date.now() - t0).padStart(6)}ms] ${msg}`);

/**
 * ★ 关键：必须从子进程环境里剔除 ELECTRON_RUN_AS_NODE。
 *
 * 本机（agent shell）预设了 `ELECTRON_RUN_AS_NODE=1`。该变量会让 electron.exe
 * **以纯 Node 运行**：`--version` 打印内嵌 Node 版本（v24.19.0）而非 Electron 版本
 * （v44.1.0），`require('electron')` 不返回 electron API（`ipcMain` 为 undefined），
 * 于是 playwright 的 _electron 协商失败并报含糊的 "Process failed to launch!"。
 *
 * 实测判据（同一二进制、只差该变量）：
 *   ELECTRON_RUN_AS_NODE=1 electron.exe --version        → v24.19.0
 *   env -u ELECTRON_RUN_AS_NODE electron.exe --version   → v44.1.0
 * 而该 exe 与官方缓存 electron-v44.1.0-win32-x64.zip 内的 electron.exe
 * **sha256 逐字节相同**（83f26fba…），故二进制本身无损坏，纯属环境变量污染。
 */
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

let app;
try {
  step(`启动 ${electronPath}（已剔除 ELECTRON_RUN_AS_NODE）`);
  app = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    cwd: process.cwd(),
    env: cleanEnv,
    timeout: 30000,
  });
  step('launch 返回');

  const win = await app.firstWindow({ timeout: 30000 });
  step(`firstWindow 拿到：title="${await win.title()}" url=${win.url()}`);

  // 等首屏渲染（main.cjs 是 ready-to-show 才 show）
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  step('domcontentloaded');

  const counts = await win.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    hasBridge: typeof window.idplan === 'object' && window.idplan !== null,
    isDesktop: window.idplan?.isDesktop ?? null,
    theme: document.documentElement.getAttribute('data-theme'),
    bodyChildren: document.body.children.length,
  }));
  step(`渲染进程：${JSON.stringify(counts)}`);

  // ★ 关键：主进程侧能不能程序化读到 titleBarOverlay
  const mainSide = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return { windows: 0 };
    let overlay = 'API 不存在';
    try {
      if (typeof w.getTitleBarOverlay === 'function') overlay = w.getTitleBarOverlay();
    } catch (e) {
      overlay = `抛错: ${String(e && e.message)}`;
    }
    return {
      windows: BrowserWindow.getAllWindows().length,
      bounds: w.getBounds(),
      isMaximized: w.isMaximized(),
      minimumSize: w.getMinimumSize(),
      titleBarOverlay: overlay,
    };
  });
  step(`主进程侧：${JSON.stringify(mainSide, null, 2)}`);

  step('探测完成 → 驱动链路成立 ✓');
  process.exitCode = 0;
} catch (err) {
  step(`失败：${err && err.message}`);
  console.error(err);
  process.exitCode = 1;
} finally {
  if (app) {
    await app.close().catch(() => {});
    step('已关闭');
  }
}
