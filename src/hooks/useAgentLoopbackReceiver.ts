/**
 * 本机 Agent loopback · **渲染侧落库接收器（常驻）**（v1.0 · P0 接线点）。
 *
 * ── 为什么从 AgentBoardPage 抽出来、且常驻 AppShell ──
 * 旧实现把 `handleAgentImportRequest` + 订阅 `useEffect` 放在 Agent 看板页，监听器只在
 * 看板页挂载期间存在。于是「ID Plan 开着、但用户在首页 / 项目详情页」时，主进程
 * `electron/loopback.cjs` 收到的外部 `POST /api/agent/import` 找不到渲染侧监听器，
 * 要等满 10s 超时（`forwardToRenderer` 的 `REQUEST_TIMEOUT_MS`）才回 503——
 * 恰恰是本项目反复禁止的「显示已连通但写不进去」假阳性，也违背「往后一直填任务」的 v1.0 目标。
 *
 * 故：落库接收器上提为**全局常驻**——在 `AppShell`（在 `RepoProvider` 内，`useRepos()`
 * 可用）挂载一次，应用生命周期内始终在监听。Agent 看板页的那两段已删除，避免两处监听
 * 导致重复回传 / 竞态。
 *
 * ── 为什么 ping 要单独一条 IPC，且不碰库 ──
 * `health` 端点要给出「数据层是否真的就绪」的**诚实**答案（用户在任意页面都能看到），
 * 主进程发 `agent:ping`、渲染侧本 hook 立即 `agent:pong` 回（不读不写 Dexie）。
 * 若渲染侧监听器没挂（看板页才挂的旧实现），主进程 1.5s 内收不到 pong → `dataLayer='unavailable'`。
 * ping **必须短路**：它只为「监听器活着吗」这一个问题服务，绝不能走 `previewAgentPayload` /
 * `applyAgentPayload`，否则每次 health 探活都会触发一次落库（污染数据 + 拖慢探活）。
 *
 * ── 可测试性 ──
 * 所有「带副作用」的逻辑都抽成**纯函数**（`runAgentImport` / `isPingRequest` /
 * `handleAgentLoopbackMessage` / `wireLoopbackReceiver` / `pushStoredTokenToMainProcess`），
 * 不依赖 React / Electron，node env 单测即可覆盖（无需 jsdom / testing-library）。
 * 真正的 hook（`useAgentLoopbackReceiver`）只负责把 `window.idplan` 桥接进来。
 *
 * ── token 内存 / 持久化纪律（不变）──
 * token 持久化唯一出处仍是渲染进程 `localStorage['idplan.agentToken']`（见
 * `AgentBoardPage.AGENT_TOKEN_STORAGE_KEY`）；本 hook 启动即把已存的 token 经
 * `setAgentToken` 推给主进程（主进程只比对，绝不回传原文）。这样主进程重启 / 应用冷启动后
 * 立刻有 token，外部写入方不必等用户再进一次 Agent 看板页保存。
 */

import { useEffect } from 'react';

import type { IRepositoryBundle } from '../core/repositories/interfaces';
import { previewAgentPayload, applyAgentPayload } from '../core/agent/payload.apply';
import { validateAgentPayload } from '../core/types/agent-payload';
import { ChangxiaError, ChangxiaErrorCode, projectKindOf } from '../core/types/enums';
import { createProjectActions } from '../store/useProjectsStore';
import type { CreateAgentBoardCmd } from '../core/services/project.service';
// token 存储键的**唯一出处**（与 AgentBoardPage 同源，避免再散一份字面量）
import { AGENT_TOKEN_STORAGE_KEY } from '../pages/AgentBoardPage';
import { useRepos } from './useRepos';

/** 主进程经 IPC 转来的 ping（仅确认监听器活着，不携带业务数据） */
export interface AgentPingRequest {
  requestId: string;
  kind: 'ping';
}

/** 主进程转来的建板请求（POST /api/agent/boards 的桌面形态） */
export interface AgentCreateBoardRequest {
  requestId: string;
  kind: 'create-board';
  body: Record<string, unknown>;
}

/** 主进程转来的任务流读取请求（GET /api/agent/tasks 的桌面形态） */
export interface AgentListTasksRequest {
  requestId: string;
  kind: 'list-tasks';
  projectId?: string;
}

/** 渲染侧桥的最小形状（IdPlanBridge 的结构子集；所有方法可选，便于非 Electron 静默跳过） */
export interface LoopbackReceiverBridge {
  onAgentImport?: (cb: (payload: AgentImportRequest) => void) => () => void;
  onAgentPing?: (cb: (payload: AgentPingRequest) => void) => () => void;
  onCreateBoard?: (cb: (payload: AgentCreateBoardRequest) => void) => () => void;
  onListTasks?: (cb: (payload: AgentListTasksRequest) => void) => () => void;
  sendAgentImportResult?: (payload: AgentImportResult) => void;
  sendAgentPong?: (payload: { requestId: string }) => void;
  setAgentToken?: (token: string) => void;
}

/* ============================================================================================
 * 纯函数层（可单测）
 * ============================================================================================ */

/** 是否为 ping 请求（短路分支的唯一判别点；变异验证打在这里） */
export function isPingRequest(req: unknown): req is AgentPingRequest {
  return (
    !!req &&
    typeof req === 'object' &&
    (req as { kind?: unknown }).kind === 'ping'
  );
}

/**
 * 落库：校验 payload → preview（dryRun）或 apply（实写），返回 ApplyResult 或错误。
 * 与 `AgentBoardPage` 旧实现逐字一致，只是抽到纯函数，便于单测与常驻复用。
 * 依赖 `repos`（由宿主注入），**不碰任何 DOM / Electron**。
 */
export async function runAgentImport(
  repos: IRepositoryBundle,
  req: AgentImportRequest,
): Promise<AgentImportResult> {
  try {
    const validated = validateAgentPayload(req.payload);
    const applyOpts = { projectId: req.projectId, stageName: req.stageName ?? null };
    const result = req.dryRun
      ? await previewAgentPayload(repos, validated, applyOpts)
      : await applyAgentPayload(repos, validated, applyOpts);
    return { requestId: req.requestId, result };
  } catch (err) {
    const message = err instanceof ChangxiaError ? err.userMessage : '写入失败。';
    const code = err instanceof ChangxiaError ? err.code : ChangxiaErrorCode.Storage;
    const httpStatus =
      err instanceof ChangxiaError && err.code === ChangxiaErrorCode.NotFound ? 404 : 400;
    return { requestId: req.requestId, error: { code, httpStatus, userMessage: message } };
  }
}

export function isCreateBoardRequest(req: unknown): req is AgentCreateBoardRequest {
  return !!req && typeof req === 'object' && (req as { kind?: unknown }).kind === 'create-board';
}

export function isListTasksRequest(req: unknown): req is AgentListTasksRequest {
  return !!req && typeof req === 'object' && (req as { kind?: unknown }).kind === 'list-tasks';
}

/**
 * 建板（桌面通道补齐 POST /api/agent/boards 的渲染侧一半）。
 *
 * ★ 校验**不在这里重写**：直接调 `createProjectActions(repos).createAgentBoard`——
 *   与服务端 boards 路由同源的那份实现（name / 起止日期 / 阶段集合，fail fast 零写入）。
 *   主进程只转发、渲染侧只桥接，判定逻辑仍只有一份。
 * ★ 回执形状逐字镜像服务端 201 体：`{ projectId, name, stages:[{id,name,templateKey}] }`。
 */
export async function runAgentCreateBoard(
  repos: IRepositoryBundle,
  req: AgentCreateBoardRequest,
): Promise<AgentImportResult> {
  try {
    const body = req.body ?? {};
    const cmd: CreateAgentBoardCmd = {
      name: typeof body.name === 'string' ? body.name : '',
      plannedStartAt: typeof body.plannedStartAt === 'string' ? body.plannedStartAt : '',
      plannedEndAt: typeof body.plannedEndAt === 'string' ? body.plannedEndAt : '',
      ...(typeof body.presetKey === 'string' ? { presetKey: body.presetKey } : {}),
      ...(Array.isArray(body.stageNames) ? { stageNames: body.stageNames as string[] } : {}),
    };
    const project = await createProjectActions(repos).createAgentBoard(cmd);
    const stages = await repos.stages.listByProject(project.id);
    return {
      requestId: req.requestId,
      result: {
        projectId: project.id,
        name: project.name,
        stages: stages.map((st) => ({ id: st.id, name: st.name, templateKey: st.templateKey })),
      },
    };
  } catch (err) {
    const message = err instanceof ChangxiaError ? err.userMessage : '建板失败。';
    const code = err instanceof ChangxiaError ? err.code : ChangxiaErrorCode.Storage;
    return { requestId: req.requestId, error: { code, httpStatus: 400, userMessage: message } };
  }
}

/**
 * 任务流读取（桌面通道补齐 GET /api/agent/tasks 的渲染侧一半）。
 *
 * 归属口径**逐字镜像服务端**：显式 projectId 非 Agent 看板 → 拒（ProjectUnresolved）；
 * 未指定 → 只回 Agent 看板的任务（读侧隔离边界）。返回字段与服务端同形
 * （externalId / taskNo / title / status / dueDate / dependsOnExternal，
 * dependsOn 做 id→externalId 反查、人工任务剔除、去重）。
 */
export async function runAgentListTasks(
  repos: IRepositoryBundle,
  req: AgentListTasksRequest,
): Promise<AgentImportResult> {
  try {
    let scopeIds: string[];
    if (req.projectId) {
      const project = await repos.projects.get(req.projectId);
      if (!project || projectKindOf(project) !== 'agent') {
        return {
          requestId: req.requestId,
          error: {
            code: ChangxiaErrorCode.ProjectUnresolved,
            httpStatus: 400,
            userMessage: `目标项目（id=${req.projectId}）不是 Agent 看板，Agent 通道读不到它的任务。`,
          },
        };
      }
      scopeIds = [req.projectId];
    } else {
      const all = await repos.projects.list({ status: 'all' });
      scopeIds = all.filter((p) => projectKindOf(p) === 'agent').map((p) => p.id);
    }

    const rows = [];
    for (const pid of scopeIds) {
      rows.push(...(await repos.tasks.listByProject(pid)));
    }
    const idToExternal = new Map<string, string>();
    for (const r of rows) {
      if (r.externalId) idToExternal.set(r.id, r.externalId);
    }
    return {
      requestId: req.requestId,
      result: {
        tasks: rows.map((r) => {
          const deps: string[] = [];
          for (const depId of r.dependsOn ?? []) {
            const ext = idToExternal.get(depId);
            if (ext && !deps.includes(ext)) deps.push(ext);
          }
          return {
            externalId: r.externalId,
            taskNo: r.taskNo,
            title: r.title,
            status: r.status,
            dueDate: r.dueDate,
            dependsOnExternal: deps,
          };
        }),
      },
    };
  } catch (err) {
    const message = err instanceof ChangxiaError ? err.userMessage : '读取任务失败。';
    const code = err instanceof ChangxiaError ? err.code : ChangxiaErrorCode.Storage;
    return { requestId: req.requestId, error: { code, httpStatus: 400, userMessage: message } };
  }
}

/**
 * 把一条主进程转来的请求（落库 / 建板 / 读任务 / ping）桥接到渲染侧落库点。
 * ★ ping **短路**：立即 `sendPong`，绝不走落库（不读写数据库）。
 */
export async function handleAgentLoopbackMessage(opts: {
  repos: IRepositoryBundle;
  req: AgentImportRequest | AgentPingRequest | AgentCreateBoardRequest | AgentListTasksRequest;
  sendImportResult: (r: AgentImportResult) => void;
  sendPong: (p: { requestId: string }) => void;
}): Promise<void> {
  if (isPingRequest(opts.req)) {
    opts.sendPong({ requestId: opts.req.requestId });
    return;
  }
  if (isCreateBoardRequest(opts.req)) {
    opts.sendImportResult(await runAgentCreateBoard(opts.repos, opts.req));
    return;
  }
  if (isListTasksRequest(opts.req)) {
    opts.sendImportResult(await runAgentListTasks(opts.repos, opts.req));
    return;
  }
  const result = await runAgentImport(opts.repos, opts.req);
  opts.sendImportResult(result);
}

/**
 * 订阅渲染侧桥（导入 + ping）。桥缺失（非 Electron / 老 preload）→ 静默跳过，返回空 dispose。
 * 抽成纯函数：可直接单测「非 Electron 不抛错 / ping 短路 / import 走落库」，
 * 不必渲染 React 组件。
 */
export function wireLoopbackReceiver(opts: {
  repos: IRepositoryBundle;
  bridge: LoopbackReceiverBridge | undefined;
}): { dispose: () => void } {
  const { repos, bridge } = opts;
  const onImport = bridge?.onAgentImport;
  const onPing = bridge?.onAgentPing;
  const onCreateBoard = bridge?.onCreateBoard;
  const onListTasks = bridge?.onListTasks;
  if (!onImport && !onPing) {
    // 非 Electron / 老 preload：无桥可订阅，静默跳过（V1-13 诚实降级的一部分）
    return { dispose: () => {} };
  }

  type LoopbackRequest =
    | AgentImportRequest
    | AgentPingRequest
    | AgentCreateBoardRequest
    | AgentListTasksRequest;
  const handler = (req: LoopbackRequest): void => {
    void handleAgentLoopbackMessage({
      repos,
      req,
      sendImportResult: (r) => bridge?.sendAgentImportResult?.(r),
      sendPong: (p) => bridge?.sendAgentPong?.(p),
    });
  };

  const offImport = onImport?.(handler as (payload: AgentImportRequest) => void);
  const offPing = onPing?.(handler as (payload: AgentPingRequest) => void);
  // 2026-09-24 桌面通道补齐：建板 / 读任务两条新事件复用同一 handler（按 kind 分发）。
  // 老 preload 没有这两个订阅方法 → 可选链自然跳过（import/ping 不受影响）。
  const offCreateBoard = onCreateBoard?.(handler as (payload: AgentCreateBoardRequest) => void);
  const offListTasks = onListTasks?.(handler as (payload: AgentListTasksRequest) => void);
  return {
    dispose: () => {
      offImport?.();
      offPing?.();
      offCreateBoard?.();
      offListTasks?.();
    },
  };
}

/**
 * 把已存的 token 推给主进程（主进程只比对，绝不回传原文）。
 * 读写 localStorage 一律 try/catch（隐私模式 / 配额满时访问本身可能抛）。
 * 桥缺失 → 直接返回，不抛。
 */
export function pushStoredTokenToMainProcess(bridge: LoopbackReceiverBridge | undefined): void {
  if (!bridge?.setAgentToken) return;
  try {
    const token = localStorage.getItem(AGENT_TOKEN_STORAGE_KEY) ?? '';
    if (token.trim()) bridge.setAgentToken(token);
  } catch {
    /* 读不到（隐私模式 / 配额满）：本次不推，不打断应用 */
  }
}

/* ============================================================================================
 * React hook（常驻挂载于 AppShell）
 * ============================================================================================ */

/**
 * 在 `AppShell` 调用一次：应用生命周期内始终监听主进程转来的导入 / ping。
 * 非 Electron 环境（`window.idplan` 不存在）→ 两个 effect 都静默跳过，不抛错。
 */
export function useAgentLoopbackReceiver(): void {
  const repos = useRepos();

  // ③ 启动即把已存的 token 推给主进程（token 只存 localStorage，主进程仅内存比对）
  useEffect(() => {
    pushStoredTokenToMainProcess(window.idplan);
  }, []);

  // ① 常驻订阅：落库 + ping（监听器不再跟随某个页面挂载）
  useEffect(() => {
    const { dispose } = wireLoopbackReceiver({ repos, bridge: window.idplan });
    return dispose;
  }, [repos]);
}
