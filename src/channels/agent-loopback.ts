/**
 * 渲染侧 Agent 导入通道 · **本机 loopback（desktop-loopback）形态**（v1.0 · P0）。
 *
 * ── 为什么放在 `src/channels/`（**不在** `src/core/agent/`）──
 * `server/tsconfig.json` 的 `include` 通配 `../src/core/agent/**` 全目录，本仓共享内核
 * 受此约束（lib 仅 ES2020、无 DOM）。本文件用 `localStorage` / `fetch` / `window` 等
 * 浏览器 API，一旦落进 `src/core/agent/` 会被服务端编译单元吃掉 → `typecheck:server` 红。
 * 故放在组合根侧（`src/channels/`），与 `src/di/agent-channel.ts`（默认接线点）同档。
 *
 * ── 三段式的「渲染侧客户端」这一段 ──
 * 本通道的 `import()` 是**渲染侧客户端**：它向主进程已起的 loopback server
 * （`electron/loopback.cjs` @ 127.0.0.1:17788）发 `POST /api/agent/import`；
 * 主进程再经 IPC 把请求转给渲染进程的落库处理器（`AgentBoardPage` 注册的
 * `window.idplan.onAgentImport`），落库结果沿 IPC 回传、由主进程转成 HTTP 响应。
 * 即「用户/外部写入方 → 渲染 fetch → 主进程 → 渲染落库 → 主进程 → 渲染 fetch 拿到结果」。
 *
 * ── token ──
 * 只从 `localStorage` 的 `idplan.agentToken` 读（try/catch），与主进程比对；
 * **绝不回显原文**。未配置 → 不带 Authorization 头，主进程回 401。
 *
 * ── 只依赖原生 fetch（零新增依赖）── 浏览器与 Node18+ 均为内置全局。
 * 本文件在**前端** tsconfig 下编译（带 DOM lib），故可直接用 `fetch` / `localStorage` /
 * `window`，无需像 `transport.http.ts` 那样从 `globalThis` 取最小形状。
 */

import { ChangxiaError, ChangxiaErrorCode } from '../core/types/enums';
import type { AgentChannelStatus, AgentImportChannel } from '../core/agent/transport.contract';
import type { ApplyResult } from '../core/types/agent-payload';

/** 本机 loopback 基址（严格 127.0.0.1，绝不 0.0.0.0） */
export const LOOPBACK_BASE_URL = 'http://127.0.0.1:17788';

const HEALTH_PATH = '/api/agent/health';
const IMPORT_PATH = '/api/agent/import';
const TOKEN_STORAGE_KEY = 'idplan.agentToken';

/** 读 token（全程 try/catch：隐私模式 / 配额满时 localStorage 访问本身可能抛） */
function readStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** 把 loopback 的 HTTP 错误映射成 ChangxiaError（import 必须抛，让调用方展示原因） */
function mapLoopbackError(status: number, body: unknown): ChangxiaError {
  const parsed = typeof body === 'object' && body !== null
    ? (body as { error?: { code?: unknown; userMessage?: unknown } }).error
    : undefined;
  const message =
    typeof parsed?.userMessage === 'string' && parsed.userMessage.length > 0
      ? parsed.userMessage
      : `Agent loopback 请求失败（HTTP ${status}）。`;
  if (status === 401) return new ChangxiaError(ChangxiaErrorCode.Validation, message);
  if (status === 400) return new ChangxiaError(ChangxiaErrorCode.Validation, message);
  if (status === 404) return new ChangxiaError(ChangxiaErrorCode.NotFound, message);
  if (status === 413) return new ChangxiaError(ChangxiaErrorCode.ParseFailed, message);
  if (status === 415) return new ChangxiaError(ChangxiaErrorCode.Validation, message);
  return new ChangxiaError(ChangxiaErrorCode.Storage, message);
}

/**
 * 构造本机 loopback 通道（kind='desktop-loopback'）。
 *
 * `status()` / `probe()`：打 `/api/agent/health` 并映射成 `AgentChannelStatus`。
 *   · `reachable` = 服务活着（HTTP 2xx 且 `body.ok===true`）；
 *   · `baseUrl` = http://127.0.0.1:17788；
 *   · `hasToken` = localStorage 里是否配了 token（绝不透露原文）；
 *   · `lastSyncAt` / `lastSyncSummary` 本通道不自行维护（无同步记录数据源），
 *     如实留 null，由面板渲染「还没有同步记录」。
 * 探活**永不抛**：网络不通 / 畸形响应一律降级 `reachable:false`，与 `transport.http.ts`
 * 的 `probe()` 同语义（见 transport.http.ts 文件头「错误语义」）。
 *
 * `import()`：**必须抛**（失败不让调用方以为写成功）。200/400/401/404/413/415/5xx/网络
 * 异常全部有明确去向，无静默分支（与 `transport.http.ts` 的 `importTasks` 同语义）。
 */
export function createLoopbackChannel(): AgentImportChannel {
  const base = LOOPBACK_BASE_URL;

  const status = async (): Promise<AgentChannelStatus> => {
    const hasToken = readStoredToken().trim().length > 0;
    const fallback: AgentChannelStatus = {
      kind: 'desktop-loopback',
      reachable: false,
      baseUrl: base,
      hasToken,
      lastSyncAt: null,
      lastSyncSummary: null,
    };
    try {
      const res = await fetch(`${base}${HEALTH_PATH}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
      const reachable = res.ok && !!body && body.ok === true;
      return { ...fallback, reachable };
    } catch {
      // 探活的「答不上来」是正常结果，不是异常 → 降级不可达
      return fallback;
    }
  };

  return {
    status,
    probe: status,
    async import(payload: unknown, opts: { dryRun: boolean; projectId?: string; stageName?: string }) {
      const params = new URLSearchParams();
      if (opts.dryRun) params.set('dryRun', '1');
      if (opts.projectId) params.set('project', opts.projectId);
      if (opts.stageName) params.set('stageName', opts.stageName);

      const token = readStoredToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (token.trim()) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${base}${IMPORT_PATH}?${params.toString()}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) throw mapLoopbackError(res.status, body);
      return body as ApplyResult;
    },
  };
}
