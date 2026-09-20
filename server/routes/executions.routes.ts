/**
 * server/routes/executions.routes.ts（v0.8）— Agent 执行域 REST 端点。
 *
 * ── 为什么需要这个文件 ──
 * `server/schema.sql` 自 v5 起就建好了执行域四张表（executions / execution_attempts /
 * execution_events / writeback_proposals），但**没有任何服务端入口读写它们**：
 * 服务端形态下执行域数据只能进不能出，Agent 控制台在 NAS 上是一块死数据。
 * 本文件补齐读写端点，让服务端与本地 Dexie 适配器具备同等的执行域能力。
 *
 * ── 本文件**不**复刻状态机 ──
 * 全部状态机校验（邻接表 / 人工确认门槛 / 单活 attempt / seq 单调 / 提案终态）
 * 集中在 `src/core/execution/execution-state.ts`，前后端单份编译。
 * 本文件只做三件事：
 *   ① HTTP 入参解析与形状校验（把非法 JSON 挡在存储层之前）；
 *   ② 调 `IExecutionsRepository`（服务端实现见 `server/adapters/sqlite.bundle.ts`）；
 *   ③ 把 `ChangxiaError` 映射成契约的 `{error:{code,userMessage}}` + 合适状态码。
 * **校验一律在存储层（仓储方法的事务内）再走一遍** —— 路由层的校验是体验，
 * 仓储层的校验才是边界；两处都要有，且以后者为准（详见 sqlite.bundle.ts 注释）。
 *
 * ── 为什么复用 bundle 的仓储方法而不是直写 SQL ──
 * 执行域的全部存储边界强制（P0「未人工确认绝不执行」、completed 需 applied 提案、
 * attempt 号段单调、事件 seq 严格单调）都写在仓储方法里。路由直写 SQL 会**绕过**
 * 这些约束 —— 那等于把闸门只在本地形态下成立。故本文件与 Agent 通道
 * （`agent.routes.ts`）走**同一个** bundle 实例，语义完全一致。
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

import { ChangxiaError, ChangxiaErrorCode } from '../../src/core/types/enums';
import type {
  AppendExecutionEventCmd,
  CreateAttemptCmd,
  CreateExecutionCmd,
  CreateProposalCmd,
  UpdateAttemptCmd,
  UpdateExecutionStatusCmd,
  UpdateProposalCmd,
} from '../../src/core/repositories/interfaces';
import type {
  Execution,
  ExecutionAttempt,
  ExecutionEvent,
  WritebackProposal,
} from '../../src/core/types/entities';
import type {
  ExecutionEventActor,
  ExecutionEventType,
  ExecutionSource,
  ExecutionStatus,
  WritebackOperation,
  WritebackProposalStatus,
  AttemptStatus,
} from '../../src/core/types/agent-execution';
import {
  EXECUTION_SOURCES,
  EXECUTION_EVENT_TYPES,
} from '../../src/core/types/agent-execution';
import {
  createSqliteBundle,
  readExecutionDetail,
  type AgentRouteDelegate,
} from '../adapters/sqlite.bundle';

/* ------------------------------ 错误 → HTTP 映射 ------------------------------ */

/**
 * `ChangxiaErrorCode` → HTTP 状态码（与既有路由的手写映射口径一致）。
 *
 * 为什么不是一张「一次写死」的表：既有路由各自手写 `reply.status(404)` 等，
 * 本文件端点较多，集中一处可避免 12 个 handler 各写一遍导致的口径漂移。
 * `storage` → 500 是刻意的：它是「不该发生」的服务端故障（磁盘/约束），
 * 不是客户端错误，归到 4xx 会把服务端 bug 说成调用方的错。
 */
const CODE_TO_STATUS: Record<ChangxiaErrorCode, number> = {
  [ChangxiaErrorCode.NotFound]: 404,
  [ChangxiaErrorCode.Validation]: 400,
  [ChangxiaErrorCode.Conflict]: 409,
  [ChangxiaErrorCode.Storage]: 500,
  [ChangxiaErrorCode.Network]: 502,
  [ChangxiaErrorCode.ParseFailed]: 400,
  [ChangxiaErrorCode.Cancelled]: 499,
};

/**
 * 调仓储方法并把异常转成 Fastify 的 reply。
 *
 * 返回 `{ ok: true, value }` / `{ ok: false }` 判别联合，而不是「抛了让上层 catch」——
 * 后者需要每个 handler 包 try/catch，漏一个就是 500 裸错（形状不合契约）。
 * 非 `ChangxiaError` 一律**原样抛出**：那是真正的程序缺陷（如 TypeError），
 * 被这里吞成 400 会让 bug 伪装成「调用方传错了」，必须让它冒到全局处理器。
 */
async function call<T>(
  reply: { status: (code: number) => unknown },
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; body: { error: { code: string; userMessage: string } } }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (!(err instanceof ChangxiaError)) throw err;
    void reply.status(CODE_TO_STATUS[err.code] ?? 500);
    return { ok: false, body: { error: { code: err.code, userMessage: err.userMessage } } };
  }
}

/* ------------------------------ 入参形状校验 ------------------------------ */

/**
 * 契约的 400 错误体（与既有路由逐字同形）。
 * 刻意不走 `ChangxiaError`：这些是「进入仓储之前」的形状错误，
 * 文案需指名是哪个字段，而仓储的校验文案描述的是状态机语义，两者受众不同。
 */
function invalidField(userMessage: string): {
  error: { code: string; userMessage: string };
} {
  return { error: { code: ChangxiaErrorCode.Validation, userMessage } };
}

/**
 * 404 错误体。
 *
 * 与 `invalidField` 分开是**必须**的：两者 HTTP 状态码不同（404 vs 400），
 * `code` 也不同（`not_found` vs `validation`）。用同一支错误体构造器会得到一个
 * 「状态码 404 但 code=validation」的自相矛盾响应 —— 调用方按 code 分支时
 * 会把它当成参数错误去重试。已在实现过程中实际踩到一次（测试抓到）。
 */
function notFoundBody(userMessage: string): {
  error: { code: string; userMessage: string };
} {
  return { error: { code: ChangxiaErrorCode.NotFound, userMessage } };
}

/** 非空字符串判定（拒绝空串与纯空白，与 agent.routes 的 isNonBlank 同义） */
const isNonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** 必填字符串字段读取；缺失/空/非串 → 抛形状错误（由调用方捕获成 400） */
function requireString(body: Record<string, unknown>, field: string): string {
  const v = body[field];
  if (!isNonBlank(v)) {
    throw new ShapeError(`字段 ${field} 必填且必须是非空字符串。`);
  }
  return v;
}

/** 可选字符串字段：`undefined` → 保持 undefined（不覆盖既有值）；`null` → 显式置空 */
function optionalString(body: Record<string, unknown>, field: string): string | null | undefined {
  const v = body[field];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') {
    throw new ShapeError(`字段 ${field} 必须是字符串或 null。`);
  }
  return v;
}

/** 可选数字字段 */
function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const v = body[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ShapeError(`字段 ${field} 必须是有限数字。`);
  }
  return v;
}

/**
 * 可选枚举字段：**只校验「是字符串」不校验「是合法枚举值」**。
 *
 * 理由：合法值集合是状态机的领域（`assertTransition` 用邻接表判定），
 * 在这里再维护一份枚举白名单就是**第二个真相源**，将来加一个状态值要改两处，
 * 漏一处就出现「路由放行、仓储报错」的错位文案。非法值一律交给状态机抛
 * Validation，文案也由它给（含 from → to 与拒绝原因，比「不是合法状态」有用得多）。
 */
function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
): T | undefined {
  const v = body[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length === 0) {
    throw new ShapeError(`字段 ${field} 必须是非空字符串。`);
  }
  return v as T;
}

/** 纯形状错误（本文件内部使用；handler 统一捕获转 400） */
class ShapeError extends Error {}

/** 把 handler body 包一层：`ShapeError` → 400 契约错误体，其余原样抛 */
function guardShape<T>(fn: () => T): T | { error: { code: string; userMessage: string } } {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ShapeError) return invalidField(err.message);
    throw err;
  }
}

/* --------------------------------- 路由注册 --------------------------------- */

/**
 * Agent 执行域路由。
 *
 * @param app  Fastify 实例（同时作为 bundle 的委托目标：`app.inject` 派发既有端点）
 * @param db   better-sqlite3 句柄
 */
export function registerExecutionRoutes(app: FastifyInstance, db: Database.Database): void {
  // 与 `agent.routes.ts` 完全同款：委托 `app.inject`（进程内、不过 socket），
  // 使执行域仓储与 Agent 通道共享**同一份** `sqlite.bundle` 实现与语义。
  const delegate: AgentRouteDelegate = {
    async inject(opts) {
      const res = await app.inject({ method: opts.method, url: opts.url, payload: opts.payload });
      return { statusCode: res.statusCode, body: res.body, json: <T>() => res.json<T>() };
    },
  };
  const bundle = createSqliteBundle(db, delegate);
  const executions = bundle.executions;

  /* ----------------------------- 读取：按项目 / 按 id ----------------------------- */

  app.get('/api/projects/:projectId/executions', async (req) => {
    const { projectId } = req.params as { projectId: string };
    return executions.listExecutionsByProject(projectId);
  });

  app.get('/api/executions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await executions.getExecution(id);
    if (!row) {
      void reply.status(404);
      return notFoundBody('未找到该执行单。');
    }
    return row;
  });

  /**
   * 执行单聚合读取（一次拿齐四个子集合）。
   *
   * 存在的理由：控制台详情页需要 execution + attempts + events + proposals 四份数据。
   * 不给这个端点，前端要发 4 个请求且**四份数据来自四个不同时刻**（无快照一致性，
   * 可能读到「attempt 已落、事件还没写」的中间态）。
   *
   * ⚠️ 事务体**必须是同步函数**：better-sqlite3 的 `db.transaction(fn)` 会检测
   * `fn.constructor.name === 'AsyncFunction'` 并直接抛
   * `TypeError: Transaction function cannot return a promise`（已实测）。
   * 故这里走 `readExecutionDetail`（**同步**函数，内部一个读事务），
   * **不**把仓储的 async 方法塞进事务体 —— 那是 500 而非「稍微慢一点」。
   */
  app.get('/api/executions/:id/detail', async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = readExecutionDetail(db, id);
    if (!detail) {
      void reply.status(404);
      return notFoundBody('未找到该执行单。');
    }
    return detail;
  });

  app.get('/api/executions/:id/attempts', async (req) => {
    const { id } = req.params as { id: string };
    return executions.listAttempts(id);
  });

  app.get('/api/executions/:id/events', async (req) => {
    const { id } = req.params as { id: string };
    return executions.listEvents(id);
  });

  app.get('/api/executions/:id/proposals', async (req) => {
    const { id } = req.params as { id: string };
    return executions.listProposals(id);
  });

  /* --------------------------------- 写入：执行单 --------------------------------- */

  app.post('/api/projects/:projectId/executions', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = guardShape((): CreateExecutionCmd => {
      const source = requireString(body, 'source') as ExecutionSource;
      // 这里**必须**校验 source 属于已知四类：它不是状态机的领域
      // （状态机只看 execution.status，不关心来源），没有任何下游会拒它。
      // 放进 Schema 的 source 合法值约束在这条通道上也要成立，否则一条
      // source='whatever' 的执行单会落库，前端按来源分组时静默漏掉。
      if (!EXECUTION_SOURCES.includes(source)) {
        throw new ShapeError(
          `字段 source 非法：${source}；合法值为 ${EXECUTION_SOURCES.join(' / ')}。`,
        );
      }
      return {
        projectId,
        source,
        objective: typeof body.objective === 'string' ? body.objective : '',
        taskId: optionalString(body, 'taskId'),
        agentMemberId: optionalString(body, 'agentMemberId'),
        channelKind: optionalString(body, 'channelKind'),
        inputSnapshotHash: optionalString(body, 'inputSnapshotHash'),
        idempotencyKey: requireString(body, 'idempotencyKey'),
      };
    });
    if ('error' in parsed) {
      void reply.status(400);
      return parsed;
    }
    const res = await call(reply, () => executions.createExecution(parsed));
    if (!res.ok) return res.body;
    return res.value;
  });

  /**
   * 状态写入。契约同时接受 PATCH /api/executions/:id 与 POST /api/executions/:id/status
   * —— 前者是 REST 惯例（改资源的一个字段），后者给不便发 PATCH 的调用方。
   * 两者**共用同一个 handler 实现**（不是两份），避免语义漂移。
   */
  const updateStatusHandler = async (
    req: { params: unknown; body: unknown },
    reply: { status: (code: number) => unknown },
  ): Promise<unknown> => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = guardShape((): UpdateExecutionStatusCmd => {
      return {
        status: requireString(body, 'status') as ExecutionStatus,
        // confirmation 是三态：undefined（不动）/ null（清空）/ 对象（写入）。
        // **不能**用 `body.confirmation ?? null` 一笔带过——那会把「没传」与
        // 「显式清空」合并成同一语义，而 `updateExecutionStatus` 正是靠这个
        // 区分「保留既有确认」与「撤销确认」（见 local.execution.repo.ts:104-105）。
        confirmation:
          body.confirmation === undefined
            ? undefined
            : body.confirmation === null
              ? null
              : (body.confirmation as UpdateExecutionStatusCmd['confirmation']),
        startedAt: optionalString(body, 'startedAt'),
        finishedAt: optionalString(body, 'finishedAt'),
        terminalReason: optionalString(body, 'terminalReason'),
        blockedReason: optionalString(body, 'blockedReason'),
      };
    });
    if ('error' in parsed) {
      void reply.status(400);
      return parsed;
    }
    const res = await call(reply, () => executions.updateExecutionStatus(id, parsed));
    if (!res.ok) return res.body;
    return res.value;
  };

  app.patch('/api/executions/:id', updateStatusHandler);
  app.post('/api/executions/:id/status', updateStatusHandler);

  /* --------------------------------- 写入：事件 --------------------------------- */

  app.post('/api/executions/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = guardShape((): AppendExecutionEventCmd => {
      const type = requireString(body, 'type') as ExecutionEventType;
      // 与 source 同理：事件类型没有任何下游校验（它只被写进流水），
      // 打错字会变成一条永远查不到的审计记录，故在入口拒掉。
      if (!EXECUTION_EVENT_TYPES.includes(type)) {
        throw new ShapeError(`字段 type 非法：${type}。`);
      }
      const seq = optionalNumber(body, 'seq');
      if (seq === undefined) {
        throw new ShapeError('字段 seq 必填：seq 由调用方经 nextSeq 计算并传入（仓储拒绝乱序/跳号）。');
      }
      return {
        executionId: id,
        attemptId: optionalString(body, 'attemptId'),
        seq,
        type,
        actor: requireString(body, 'actor') as ExecutionEventActor,
        fromStatus: optionalEnum<ExecutionStatus>(body, 'fromStatus'),
        toStatus: optionalEnum<ExecutionStatus>(body, 'toStatus'),
        reason: optionalString(body, 'reason'),
        idempotencyKey: optionalString(body, 'idempotencyKey'),
      };
    });
    if ('error' in parsed) {
      void reply.status(400);
      return parsed;
    }
    const res = await call(reply, () => executions.appendEvent(parsed));
    if (!res.ok) return res.body;
    return res.value;
  });

  /* --------------------------------- 写入：尝试 --------------------------------- */

  app.post('/api/executions/:id/attempts', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = guardShape((): CreateAttemptCmd => {
      return {
        executionId: id,
        // attemptNo 可选：传了必须与仓储计算值一致（仓储会校验并抛错）
        attemptNo: optionalNumber(body, 'attemptNo'),
        status: optionalEnum<AttemptStatus>(body, 'status'),
        runtimeKind: optionalString(body, 'runtimeKind'),
        startedAt: optionalString(body, 'startedAt'),
        finishedAt: optionalString(body, 'finishedAt'),
        inputSnapshotHash: optionalString(body, 'inputSnapshotHash'),
      };
    });
    if ('error' in parsed) {
      void reply.status(400);
      return parsed;
    }
    const res = await call(reply, () => executions.createAttempt(parsed));
    if (!res.ok) return res.body;
    return res.value;
  });

  app.patch('/api/attempts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = guardShape((): UpdateAttemptCmd => {
      return {
        status: optionalEnum<AttemptStatus>(body, 'status'),
        startedAt: optionalString(body, 'startedAt'),
        finishedAt: optionalString(body, 'finishedAt'),
        errorCode: optionalString(body, 'errorCode'),
        errorSummary: optionalString(body, 'errorSummary'),
        terminalReason: optionalString(body, 'terminalReason'),
      };
    });
    if ('error' in parsed) {
      void reply.status(400);
      return parsed;
    }
    const res = await call(reply, () => executions.updateAttempt(id, parsed));
    if (!res.ok) return res.body;
    return res.value;
  });

  /* --------------------------------- 写入：提案 --------------------------------- */

  app.post('/api/executions/:id/proposals', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = guardShape((): CreateProposalCmd => {
      const ops = body.operations;
      // operations 必须是数组：若给字符串，SQLite 会把它当**已有 JSON 文本**存进去，
      // 读回时 parseJsonArray 恰好也能解析成功 —— 于是一个「本该报错」的输入
      // 变成一条看不见问题的数据。在这里拒掉，别让它有机会蒙混。
      if (!Array.isArray(ops)) {
        throw new ShapeError('字段 operations 必填且必须是数组（WritebackOperation[]）。');
      }
      return {
        executionId: id,
        attemptId: optionalString(body, 'attemptId'),
        projectId: requireString(body, 'projectId'),
        taskId: optionalString(body, 'taskId'),
        operations: ops as WritebackOperation[],
        idempotencyKey: requireString(body, 'idempotencyKey'),
        status: optionalEnum<WritebackProposalStatus>(body, 'status'),
      };
    });
    if ('error' in parsed) {
      void reply.status(400);
      return parsed;
    }
    const res = await call(reply, () => executions.createProposal(parsed));
    if (!res.ok) return res.body;
    return res.value;
  });

  app.patch('/api/proposals/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = guardShape((): UpdateProposalCmd => {
      const ops = body.operations;
      if (ops !== undefined && !Array.isArray(ops)) {
        throw new ShapeError('字段 operations 必须是数组（WritebackOperation[]）。');
      }
      return {
        operations: ops as WritebackOperation[] | undefined,
        status: optionalEnum<WritebackProposalStatus>(body, 'status'),
        decidedBy: optionalString(body, 'decidedBy'),
        decidedAt: optionalString(body, 'decidedAt'),
      };
    });
    if ('error' in parsed) {
      void reply.status(400);
      return parsed;
    }
    const res = await call(reply, () => executions.updateProposal(id, parsed));
    if (!res.ok) return res.body;
    return res.value;
  });
}

/* --------------------------------- 类型辅助 --------------------------------- */

// 显式引用这些类型，确保 DTO 形状变更时本文件编译期即红（而不是运行期形状漂移）。
// `void` 用法刻意保留：它们只用于类型约束，不产生运行时代码。
export type _ExecutionDtoPins = [Execution, ExecutionAttempt, ExecutionEvent, WritebackProposal];
