/**
 * Agent 导入通道 · **本机 loopback 的 Electron 桥检测 + 注册**（v1.0 · P0）。
 *
 * ── 只在这一处有「是否 Electron」的判定 ──
 * `createLoopbackChannel()` 是渲染侧客户端，理论上任何环境都能 new；但把它**注册进
 * 注册表**会让 `useAgentStore` 的 `routeViaChannel` 把写入委托给它。而 loopback 通道
 * 依赖主进程 `electron/loopback.cjs`（绑 127.0.0.1:17788）——**只有 Electron 运行时才有**。
 *
 * 故：仅当检测到 Electron 桥（`window.idplan?.onAgentImport` 存在）才注册；
 * 非 Electron 环境（web / jsdom 单测 / NAS 端）**必须静默跳过**：不抛错、不注册、
 * 不给假阳性。否则 web / 单测里会路由到一个永远连不上的 127.0.0.1:17788，把用户的
 * 导入静默吞掉或恒 401。
 *
 * ── 与 `src/di/agent-channel.ts` 的关系 ──
 * 二者都是组合根侧接线。`agent-channel.ts` 注册 `local-dexie`（默认、权威）；
 * 本文件在 Electron 下**覆盖**注册 `desktop-loopback`（需真实传输）。
 * 注册表后注册者覆盖先注册者（见 transport.contract.ts 的 `registerAgentImportChannel`），
 * 故 Electron 下 loopback 胜出、写入走 loopback；非 Electron 下仍是 local-dexie。
 *
 * ── 为什么放 `src/di/` 而不是 `src/core/agent/` ──
 * 同 `src/di/agent-channel.ts`：本文件 import 了 `channels/agent-loopback`（用浏览器 API
 * 实现层），一旦落入 `server/tsconfig.json` 的 `../src/core/agent/**` 通配会拖回 DOM 依赖
 * → `typecheck:server` 红。放 `src/di/` 两边都干净。
 */

import { registerAgentImportChannel } from '../core/agent/transport.contract';
import { createLoopbackChannel } from '../channels/agent-loopback';

/** 是否运行在 Electron（渲染侧桥存在） */
function hasElectronBridge(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window &&
    !!(window as unknown as { idplan?: { onAgentImport?: unknown } }).idplan?.onAgentImport
  );
}

/**
 * 仅 Electron 桥存在时注册本机 loopback 通道；否则静默跳过。
 * 返回是否注册成功（非 Electron / 无桥 → false，便于单测断言）。
 */
export function installDesktopLoopbackChannel(): boolean {
  if (!hasElectronBridge()) return false;
  registerAgentImportChannel(createLoopbackChannel());
  return true;
}

// 模块顶层执行一次：import 本文件 = 完成 loopback 通道的（条件）注册。
installDesktopLoopbackChannel();
