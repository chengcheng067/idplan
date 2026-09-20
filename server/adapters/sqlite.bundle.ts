/**
 * server/adapters/sqlite.bundle.ts（v0.7 · T02 · 设计文档 §3.7）— 服务端「复用」的前提。
 *
 * ── 本文件解决什么 ──
 * `src/core/agent/payload.apply.ts` 吃的是 `IRepositoryBundle`，而服务端路由写的是**裸 SQL**。
 * 不建这一层，「PRD §4.1 复用 `payload.apply` 全部逻辑」在 NAS 形态下**根本不成立** ——
 * 只能另写一套导入逻辑，于是自动建阶段、幂等键、环检测、两段式 upsert 全都要写第二遍。
 *
 * ── 实现范围（**刻意不追求完整**，§3.7）──
 * 只实现 `payload.apply` 与 `stage-resolve` 真正调用到的方法：
 *   `projects.get` / `projects.list`
 *   `stages.listByProject` / `stages.get` / `stages.bulkInsert`
 *   `tasks.listByProject` / `tasks.upsertByExternalId`
 *   `members.list` / `members.insert`
 *   `settings.get` / `settings.set`
 * 其余一律**显式抛 not-implemented**（不是返回空对象/空数组）。
 * 这一点是刻意的：返回空数组会让「本该有数据」静默变成「没有数据」——例如某天有人
 * 让 `payload.apply` 也去读 `logs`，若这里返回 `[]`，行为会悄悄退化成「没有流水」而
 * 不报错；抛错则当场暴露。**静默无操作比报错危险得多**。
 *
 * ── 三条实现策略（逐处标注理由，避免「以为什么都是直读」）──
 *  **A. 直读 SQL + 复用既有导出映射**（`projects` / `stages` 的读）：
 *     这两张表的行→实体映射函数已由既有路由 `export`（`rowToProject` / `rowToStage`）。
 *     直读即「复用同一份映射」，且省掉一次 HTTP 往返。
 *     若把映射函数在这里抄一遍，就会出现**第二份字段口径**（漏一个 `?? null` 就是
 *     静默的 undefined 泄漏）——正是 §3.7 表格对 `projects` 明写「导出既有内部函数，
 *     避免第二份映射」要防的事。
 *  **B. 委托既有路由处理器**（`tasks.listByProject` / `members.*` / `settings.*`）：
 *     · `tasks` 的行→实体映射函数 `rowToTask` **未导出**（与 `members.rowToMember` 同款），
 *       且这两个文件的写锁都不属 T02 → 抄一份映射违反 A 的原则，故委托既有端点；
 *     · `settings` 的读写是「JSON 字符串列 ↔ 值」的一对小转换，同样委托，与 remote
 *       适配器（`RemoteSettingsRepository`）**同一份语义**。
 *     委托走 `app.inject`（进程内、不过 socket），语义与 NAS HTTP 路径逐字相同。
 *  **D. 直接函数调用**（`tasks.upsertByExternalId`）：
 *     v0.7（T02）已把 `POST /api/tasks/upsert` 的处理器本体抽成
 *     `tasks.routes.ts` 的 `export function runTaskUpsert(db, rows)` ——
 *     幂等写入因此**只有一份实现**（含 B-01 不变式、项目作用域查找 BUG-03、
 *     `.immediate()` 事务、号计数器「整批开一次、逐行 take」），路由与适配器**共用**它。
 *     这是 §3.7 的原话（「路由与适配器共用一份」）。刻意**不**走 `app.inject`：
 *     那会引入 HTTP 层耦合、一次多余的 JSON 序列化/反序列化，以及一个针对自己的
 *     伪造请求 —— 是绕开设计意图，不是复用。
 *  **C. 唯一自写 SQL 的写路径 = `stages.bulkInsert`**：
 *     既有 `POST /api/stages/bulk`（`stages.routes.ts:71`）用的是**默认 DEFERRED 事务**
 *     （`tx(rows)`），而 §3.7 纪律 1 与本轮坑 **C8** 明定：服务端写方法必须
 *     `.immediate()`，否则「先读后写」的事务在并发下先拿读锁、升级写锁时失败
 *     （`SQLITE_BUSY`）→ Agent 拿到 500。故此处**逐字复用同一条 INSERT 语句**，
 *     只把事务模式改成 `.immediate()`。这不是「第二份实现」，是同一份 SQL 的
 *     事务模式修正（增量 = 一个后缀）。
 *
 * ── 纪律 ──
 * 1. 全部自写写方法走 `db.transaction(fn).immediate()`；
 * 2. **禁止** `return {...} as IRepositoryBundle` 这类整体断言 —— 逐方法实现，
 *    让 TS 把漏项找出来（少一个方法 = 编译期红，而不是运行期「undefined is not a function」）；
 * 3. `stages.bulkInsert` 收到的 `Stage` 行**必须带 `id`**（由 `payload.apply` 侧用
 *    `crypto.randomUUID()` 生成），本文件验一次并在缺失时**响亮失败**。
 */

import type Database from 'better-sqlite3';

import { ChangxiaError, ChangxiaErrorCode } from '../../src/core/types/enums';
import type {
  AppendExecutionEventCmd,
  CreateAttemptCmd,
  CreateExecutionCmd,
  CreateProposalCmd,
  IMembersRepository,
  IProjectsRepository,
  IRepositoryBundle,
  ISettingsRepository,
  IStagesRepository,
  ITasksRepository,
  IItinerariesRepository,
  IExecutionsRepository,
  ProjectQuery,
  TaskQuery,
  TaskUpsertRow,
  UpdateAttemptCmd,
  UpdateExecutionStatusCmd,
  UpdateProposalCmd,
} from '../../src/core/repositories/interfaces';
import type {
  Execution,
  ExecutionAttempt,
  ExecutionEvent,
  ItineraryDay,
  Member,
  Project,
  Stage,
  Task,
  WritebackProposal,
} from '../../src/core/types/entities';
// ★ 策略 A：复用既有路由**已导出**的两个映射函数（单一字段口径）
import { rowToProject } from '../routes/projects.routes';
import { rowToStage } from '../routes/stages.routes';
// ★ 策略 D：幂等写入的**唯一实现**（T02 已从 handler body 抽为导出函数）
import { runTaskUpsert } from '../routes/tasks.routes';
// ★ v0.8 执行域：JSON 列三件套。`confirmation` 是**对象**列（走 parseJson），
//   `operations` 是**数组**列（走 parseJsonArray）—— 两者不可互换，详见各自调用点注释。
import { parseJson, parseJsonArray, serializeJson } from '../lib/json-columns';
// ★ v0.8 执行域：状态机**唯一实现**（纯函数、零 Node 依赖，前后端单份编译）。
//   刻意不在此文件重写邻接表 —— 第二份真相源会让「什么算合法转移」两端漂移。
import {
  assertAttemptTransition,
  assertExecutionConfirmed,
  assertStatusTransition,
  canStartAttempt,
  nextAttemptNo,
  nextSeq,
} from '../../src/core/execution/execution-state';
// 枚举必须**值导入**（不是 `import type`）：TS1361 —— 只作类型用时无法取其成员值。
import {
  AttemptStatus,
  ExecutionStatus,
  WritebackProposalStatus,
} from '../../src/core/types/agent-execution';
import type {
  ExecutionEventActor,
  ExecutionEventType,
  ExecutionSource,
  WritebackOperation,
} from '../../src/core/types/agent-execution';

/**
 * 委托目标：一个「能把请求投给既有路由」的最小能力（结构类型，不依赖 Fastify 的完整类型）。
 *
 * 刻意收窄到 `inject` 一个方法而不是收整个 `FastifyInstance`：
 *   · 适配器不需要知道 Fastify 的其余任何东西，收到更少 = 更不可能被误用；
 *   · 测试里可以塞一个假实现（如「把所有调用记下来」的探针），不必起 Fastify。
 * `method` 目前只用到 GET / POST / PUT（settings 是 PUT）；不预留用不到的动作，
 * 新增动作时编译期就会提示（比运行期 404 好）。
 */
export interface AgentRouteDelegate {
  inject(opts: {
    method: 'GET' | 'POST' | 'PUT';
    url: string;
    payload?: Record<string, unknown>;
  }): Promise<{ statusCode: number; body: string; json<T>(): T }>;
}

/** 行类型从既有映射函数**反推**：避免在适配器里重抄一遍 ProjectRow / StageRow */
type ProjectRowShape = Parameters<typeof rowToProject>[0];
type StageRowShape = Parameters<typeof rowToStage>[0];

/**
 * 执行域四张表的行类型（v0.8）。
 *
 * 这里**只能**手写：执行域此前没有任何服务端映射函数可以反推（与上面两个形状不同）。
 * 列名逐字对齐 `server/schema.sql:187-254`；可空列用 `| null` 而非 `| undefined`
 * ——better-sqlite3 返回缺失列即 `null`，写成 `undefined` 会让 `?? null` 一类的兜底
 * 在类型上看似必要、实则掩盖真实的 null 传播路径。
 */
interface ExecutionRow {
  id: string;
  project_id: string;
  task_id: string | null;
  source: ExecutionSource;
  objective: string;
  agent_member_id: string | null;
  channel_kind: string | null;
  input_snapshot_hash: string | null;
  status: ExecutionStatus;
  /** JSON 化的 ExecutionConfirmation（对象），可空 */
  confirmation: string | null;
  idempotency_key: string;
  current_attempt_no: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  terminal_reason: string | null;
  blocked_reason: string | null;
}

interface AttemptRow {
  id: string;
  execution_id: string;
  attempt_no: number;
  status: AttemptStatus;
  runtime_kind: string | null;
  started_at: string | null;
  finished_at: string | null;
  input_snapshot_hash: string | null;
  error_code: string | null;
  error_summary: string | null;
  terminal_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  execution_id: string;
  attempt_id: string | null;
  seq: number;
  type: ExecutionEventType;
  actor: ExecutionEventActor;
  from_status: ExecutionStatus | null;
  to_status: ExecutionStatus | null;
  reason: string | null;
  idempotency_key: string | null;
  created_at: string;
}

interface ProposalRow {
  id: string;
  execution_id: string;
  attempt_id: string | null;
  project_id: string;
  task_id: string | null;
  /** JSON 化的 WritebackOperation[]（数组串） */
  operations: string;
  status: WritebackProposalStatus;
  idempotency_key: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------- 执行域：行 → 实体映射（唯一一份） ------------------------- */

/**
 * 这五个函数是**服务端执行域行映射的唯一出处**。
 *
 * 放在模块级（而非 `createSqliteBundle` 的闭包内）是因为有两个消费方：
 *   ① 本文件的 `executions` 仓储实现；
 *   ② `server/routes/executions.routes.ts` 的 `detail` 聚合端点 ——
 *      它需要在一个**同步**读事务里同时取四张表（better-sqlite3 的
 *      `db.transaction(fn)` 拒绝 async 函数体，故不能复用仓储的 async 方法）。
 * 两处共用这一份映射，「列表 / 单读 / detail」三个端点的字段口径不可能分叉。
 *
 * ★ JSON 列的反序列化必须按**列的形状**分流，不可混用：
 *   · `executions.confirmation` 是**对象** → `parseJson(..., null)`
 *     （若误用 `parseJsonArray`，对象会被 `Array.isArray` 判否而回落 `[]`，
 *      把「人工确认凭据」整条静默清空 —— P0 闸门的数据来源就此消失）；
 *   · `writeback_proposals.operations` 是**对象数组** → `parseJsonArray`
 *     （若误用 `parseJson(..., [])`，非数组脏数据会原样透出，破坏 `WritebackOperation[]` 契约）。
 */
const rowToExecution = (r: ExecutionRow): Execution => ({
  id: r.id,
  projectId: r.project_id,
  taskId: r.task_id,
  source: r.source,
  objective: r.objective,
  agentMemberId: r.agent_member_id,
  channelKind: r.channel_kind,
  inputSnapshotHash: r.input_snapshot_hash,
  status: r.status,
  // 对象列专用：**不可**换 parseJsonArray（会把对象清成 []，静默销毁确认凭据）
  confirmation: parseJson<Execution['confirmation']>(r.confirmation, null),
  idempotencyKey: r.idempotency_key,
  currentAttemptNo: r.current_attempt_no,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  terminalReason: r.terminal_reason,
  blockedReason: r.blocked_reason,
});

/**
 * 按 `currentAttemptNo` 的**权威语义**重算该字段：最近一次 attempt 的编号，
 * 一次都没跑过则为 `0`。
 *
 * ── 为什么要重算而不是读列 ──
 * `executions.current_attempt_no` 在全仓**没有任何读取方**（已实测：`grep` 全仓仅剩
 * 类型声明 `agent-execution.ts:174`、Dexie 索引声明 `current.ts:131`、备份 schema
 * `backup.service.ts:358`、创建时赋值 `local.execution.repo.ts:53` 四处，**零处读取**）。
 * 它是一个**冗余缓存列**，而「第几次尝试」的权威答案始终来自数子表。
 *
 * 服务端若去维护它，反而制造比"一致地无值"更隐蔽的问题：dump 是**字段级搬运**，
 * 服务端算出的值会被导出、再被本地导入 —— 于是本地**导入来的值是对的、
 * 本地自建的是错的（恒 0）**。这种"有时对有时错"会被误读为可信数据，
 * 比一个明确的"未启用"信号难诊断得多。故 DB 列两端一致地保持 0，读路径现算。
 *
 * ── 语义取 `max(attemptNo)`，**不是** `nextAttemptNo()` ──
 * 两者差一，务必别搞混：
 *   · `nextAttemptNo(attempts)`（`execution-state.ts:186`）返回**下一个可用**序号
 *     （空 → 1；max=3 → 4）—— 它回答的是"新开 attempt 该用几号"；
 *   · 本函数要的是"**指向最近一次** attempt"（类型注释 `agent-execution.ts:173-174`
 *     原文），即 max(attemptNo)；空 → 0。
 * 唯一的观测点也支持后者：`local.execution.repo.ts:53` 在**零 attempt** 时赋 `0`，
 * 且本地 `createAttempt` 从不更新该列 —— 若语义是 nextAttemptNo，初始值应是 1 而非 0。
 *
 * @param attempts 该 execution 的 attempt 列表（未排序也可，本函数自取 max）
 */
function withDerivedAttemptNo(execution: Execution, attempts: readonly ExecutionAttempt[]): Execution {
  const lastUsed = attempts.length === 0 ? 0 : Math.max(...attempts.map((a) => a.attemptNo));
  return { ...execution, currentAttemptNo: lastUsed };
}

const rowToAttempt = (r: AttemptRow): ExecutionAttempt => ({
  id: r.id,
  executionId: r.execution_id,
  attemptNo: r.attempt_no,
  status: r.status,
  runtimeKind: r.runtime_kind,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  inputSnapshotHash: r.input_snapshot_hash,
  errorCode: r.error_code,
  errorSummary: r.error_summary,
  terminalReason: r.terminal_reason,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const rowToEvent = (r: EventRow): ExecutionEvent => ({
  id: r.id,
  executionId: r.execution_id,
  attemptId: r.attempt_id,
  seq: r.seq,
  type: r.type,
  actor: r.actor,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  reason: r.reason,
  idempotencyKey: r.idempotency_key,
  createdAt: r.created_at,
});

const rowToProposal = (r: ProposalRow): WritebackProposal => ({
  id: r.id,
  executionId: r.execution_id,
  attemptId: r.attempt_id,
  projectId: r.project_id,
  taskId: r.task_id,
  // 数组列：走 parseJsonArray（对象数组往返保真；坏数据回落 []）
  operations: parseJsonArray<WritebackOperation>(r.operations),
  status: r.status,
  idempotencyKey: r.idempotency_key,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/* ------------------------- 执行域：SQL 读（唯一一份） ------------------------- */

/** 单行读。`SELECT *` + 上面的映射，与三个 list* 同一字段口径。 */
export function selectExecutionRow(db: Database.Database, id: string): Execution | null {
  const row = db.prepare('SELECT * FROM executions WHERE id = ?').get(id) as
    | ExecutionRow
    | undefined;
  return row ? rowToExecution(row) : null;
}

/** 提案集合（排序 `created_at, id` 与本地 Dexie 侧一致，两端列表顺序相同） */
export function selectProposalRows(
  db: Database.Database,
  executionId: string,
): WritebackProposal[] {
  const rows = db
    .prepare('SELECT * FROM writeback_proposals WHERE execution_id = ? ORDER BY created_at, id')
    .all(executionId) as ProposalRow[];
  return rows.map(rowToProposal);
}

/** attempt 集合（排序 `attempt_no, id`） */
export function selectAttemptRows(
  db: Database.Database,
  executionId: string,
): ExecutionAttempt[] {
  const rows = db
    .prepare('SELECT * FROM execution_attempts WHERE execution_id = ? ORDER BY attempt_no, id')
    .all(executionId) as AttemptRow[];
  return rows.map(rowToAttempt);
}

/** 事件集合（排序 `seq, id`；seq 由仓储保证单调，故等价于时间序） */
export function selectEventRows(db: Database.Database, executionId: string): ExecutionEvent[] {
  const rows = db
    .prepare('SELECT * FROM execution_events WHERE execution_id = ? ORDER BY seq, id')
    .all(executionId) as EventRow[];
  return rows.map(rowToEvent);
}

/** `GET /api/executions/:id/detail` 的返回形状（四份数据在同一读快照内取齐） */
export interface ExecutionDetail {
  execution: Execution;
  attempts: ExecutionAttempt[];
  events: ExecutionEvent[];
  proposals: WritebackProposal[];
}

/**
 * 同步读事务取齐四份数据（供 `detail` 端点使用）。
 *
 * ⚠️ 必须**同步**：better-sqlite3 的 `db.transaction(fn)` 检测到 async 函数体会直接抛
 * `TypeError: Transaction function cannot return a promise`（已实测，症状是 500）。
 * 故这里只调上面四个同步读函数，不碰任何 async 仓储方法。
 * 返回 `null` = 执行单不存在（由调用方映射成 404）。
 */
export function readExecutionDetail(
  db: Database.Database,
  id: string,
): ExecutionDetail | null {
  const read = db.transaction((executionId: string): ExecutionDetail | null => {
    const row = selectExecutionRow(db, executionId);
    if (!row) return null;
    const attempts = selectAttemptRows(db, executionId);
    return {
      // 与 getExecution / listExecutionsByProject 同一口径（见 withDerivedAttemptNo）：
      // 三个端点若给出不同的 currentAttemptNo，详情页与列表页会互相矛盾
      execution: withDerivedAttemptNo(row, attempts),
      attempts,
      events: selectEventRows(db, executionId),
      proposals: selectProposalRows(db, executionId),
    };
  });
  return read(id);
}

/**
 * 未实现的方法一律走这里：**显式抛错**，绝不返回 `undefined` / `[]` / `{}`。
 *
 * 用 `ChangxiaError(Storage)` 而不是裸 `Error`：本仓库的纪律是「任何失败都抛
 * `ChangxiaError{code,userMessage}`」，服务端的全局错误处理器认这个形状。
 * 文案里带 `[not-implemented]` 前缀，便于在日志里一眼区分「能力缺口」与「运行期故障」。
 */
/**
 * 「undefined 的字段不覆盖既有值」——与本地侧 `local.projects.repo.ts:138` 的
 * `pickDefined` **逐字同语义**。
 *
 * ── 为什么这里复刻一份而不是 import 原件 ──
 * 原件所在文件经 import 图带上 `dexie.database.ts`，后者直接引用 `globalThis.indexedDB`
 * （浏览器 API）。`server/tsconfig.json` 一旦纳入它，`npm run typecheck:server` 立刻报两条
 * TS7017（已实测）。这正是该配置文件头写明的纪律：**显式列出能暴露「共享内核悄悄带上
 * 浏览器 API」**——此处正是它生效的实例。
 * 另有两个更实际的理由：① 服务端运行时不该让 browser-only 的 dexie 进入模块图；
 * ② 本函数只有三行，抽到中立位置需改 `src/`（超出本切片范围）。
 *
 * ⚠️ 语义一致性靠**两处单测各自锁住**（服务端侧断言「只传 status 时其余字段不变」），
 * 而不是靠共享源码——这是本复刻唯一的风险点，已如实记录。
 */
function pickDefined<T extends object>(src: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(src) as Array<keyof T>) {
    if (src[key] !== undefined) {
      (out as Record<string, unknown>)[key as string] = src[key];
    }
  }
  return out;
}

function notImplemented(what: string): never {
  throw new ChangxiaError(
    ChangxiaErrorCode.Storage,
    `[not-implemented] sqlite.bundle 未实现 ${what}：本适配器只覆盖 payload.apply 调用到的方法（§3.7）。`,
  );
}

/**
 * 委托既有处理器并解 JSON（策略 B）。
 *
 * 非 2xx 一律抛 `ChangxiaError(Storage)` 且把响应体原文带进 userMessage ——
 * 委托的失败原因只有被委托方知道（如 `POST /api/tasks/upsert` 的
 * `{error:{code:'validation',userMessage:'任务行缺少 projectId…'}}`），
 * 丢掉它会变成一个无从排查的「导入失败」。
 */
async function delegateJson<T>(
  delegate: AgentRouteDelegate,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const res = await delegate.inject({ method, url, payload });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Storage,
      `[sqlite.bundle] 委托 ${method} ${url} 失败（HTTP ${res.statusCode}）：${res.body}`,
    );
  }
  return res.json<T>();
}

/**
 * 装配服务端 `IRepositoryBundle` 子集。
 *
 * @param db        better-sqlite3 句柄（服务端进程内同一个连接）
 * @param delegate  委托目标（见 `AgentRouteDelegate`；由 `agent.routes.ts` 传 Fastify 的 `inject`）
 */
export function createSqliteBundle(
  db: Database.Database,
  delegate: AgentRouteDelegate,
): IRepositoryBundle {
  const projects: IProjectsRepository = {
    /** 策略 A：`SELECT *` + 既有映射；`query` 在此**刻意不实现过滤**（调用方按需自筛） */
    async list(_query?: ProjectQuery): Promise<Project[]> {
      const rows = db.prepare('SELECT * FROM projects').all() as ProjectRowShape[];
      return rows.map((r) => rowToProject(r) as unknown as Project);
    },
    /** 不存在 → `null`（仓储契约口径；`payload.apply` 依赖它抛自己的 NotFound 文案） */
    async get(id: string): Promise<Project | null> {
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
        | ProjectRowShape
        | undefined;
      return row ? (rowToProject(row) as unknown as Project) : null;
    },
    insert: () => notImplemented('projects.insert'),
    update: () => notImplemented('projects.update'),
    archive: () => notImplemented('projects.archive'),
    remove: () => notImplemented('projects.remove'),
  };

  const stages: IStagesRepository = {
    /** 与 `GET /api/projects/:projectId/stages` 同序（ORDER BY order_index） */
    async listByProject(projectId: string): Promise<Stage[]> {
      const rows = db
        .prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY order_index')
        .all(projectId) as StageRowShape[];
      return rows.map((r) => rowToStage(r) as unknown as Stage);
    },
    async get(id: string): Promise<Stage | null> {
      const row = db.prepare('SELECT * FROM stages WHERE id = ?').get(id) as
        | StageRowShape
        | undefined;
      return row ? (rowToStage(row) as unknown as Stage) : null;
    },
    /**
     * 策略 C：**唯一自写 SQL 的写路径**。
     *
     * ── 为什么不复用路由（`POST /api/stages/bulk`）──
     * 两条**同时**成立的原因，缺一条都会让复用变得正确：
     *   ① 该路由的 handler **未导出**（`registerStageRoutes` 内的匿名闭包），
     *      要复用就得先把它抽成 `runStageBulkInsert` —— 那是对 T01 锁文件的改动，
     *      且 §3.7 只点名要求抽 `runTaskUpsert`（阶段那边没这要求）；
     *   ② 更关键：该路由用的是**默认 DEFERRED 事务**（`tx(rows)`），
     *      而 §3.7 纪律 1 与坑 **C8** 明定服务端写方法必须 `.immediate()` ——
     *      否则「先读后写」的事务在并发下先拿读锁、升级写锁时失败（`SQLITE_BUSY`）
     *      → Agent 拿到 500。**直接复用路由 = 把 C8 的缺陷一起引进来**，
     *      而 `stages.bulkInsert` 正是 Agent 导入在建阶段时走的路径。
     *
     * 故此处**逐字复用同一条 INSERT 语句**（列序 / 占位符个数 / 类型转换与
     * `stages.routes.ts` 的 bulk 完全一致），唯一差异是事务模式改成 `.immediate()`。
     * 这不是「第二份实现」，是同一份 SQL 的**事务模式修正**（增量 = 一个后缀）。
     */
    async bulkInsert(rows: Stage[]): Promise<void> {
      if (rows.length === 0) return; // 零行不必开事务（BEGIN/COMMIT 也是开销）
      // §3.7 纪律 3：自写 SQL 无法像仓储那样回填 id，缺 id 会在 DB 层静默写出空主键
      for (const s of rows) {
        if (!s || typeof s.id !== 'string' || s.id.length === 0) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Validation,
            '[sqlite.bundle] stages.bulkInsert 的行必须自带非空 id（自动建阶段侧用 crypto.randomUUID() 生成）。',
          );
        }
      }
      const insert = db.prepare(
        `INSERT INTO stages
          (id, project_id, order_index, template_key, color_index, name, ratio_percent, start_at, end_at,
           status, owner_id, visible, resource_path, revision, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const tx = db.transaction((list: Stage[]) => {
        for (const s of list) {
          insert.run(
            s.id,
            s.projectId,
            s.orderIndex,
            s.templateKey ?? null,
            s.colorIndex == null ? null : s.colorIndex,
            s.name,
            s.ratioPercent,
            s.startAt,
            s.endAt,
            s.status ?? 'not_started',
            s.ownerId ?? null,
            s.visible === false ? 0 : 1,
            s.resourcePath ?? null,
            s.revision ?? 1,
            s.updatedAt ?? new Date().toISOString(),
          );
        }
      });
      // ★ `.immediate()`：并发下 DEFERRED 会锁升级失败（SQLITE_BUSY）→ Agent 拿到 500（C8）
      tx.immediate(rows);
    },
    update: () => notImplemented('stages.update'),
    reschedule: () => notImplemented('stages.reschedule'),
  };

  const tasks: ITasksRepository = {
    /**
     * 策略 B：委托 `GET /api/tasks?projectId=`（`rowToTask` 未导出，见文件头 B）。
     *
     * 返回的就是 `rowToTask` 的产物 —— 与前端 remote 适配器
     * （`RemoteTasksRepository.listByProject` → `list({projectId})`）**调用同一个端点**，
     * 故 NAS 形态下「服务端内部复用」与「远端前端读取」看到的是同一个 `Task` 形状。
     */
    async listByProject(projectId: string): Promise<Task[]> {
      return delegateJson<Task[]>(
        delegate,
        'GET',
        `/api/tasks?projectId=${encodeURIComponent(projectId)}`,
      );
    },
    /**
     * 策略 D：**直接调用** `runTaskUpsert` —— 幂等写入的唯一实现（§3.7「共用一份」）。
     *
     * 为什么不在本文件里写这段 SQL：它承载三条不易察觉的纪律（项目作用域查找 BUG-03、
     * B-01 认领僵尸不变式、号计数器「整批开一次、逐行 take」）。抄一份 = 制造第二份
     * 会各自漂移的实现，而漂移的症状是「同一份 payload 在 NAS 与本地得到不同结果」。
     *
     * `runTaskUpsert` 的 `{error}` 分支（缺 projectId，路由那边回 400）在这里**转成抛错**：
     * 仓储契约是「任何失败抛 `ChangxiaError`」（`interfaces.ts` 文件头纪律），
     * 而 `payload.apply` 的行**一定**带 projectId，走到这个分支即为程序性错误。
     */
    async upsertByExternalId(
      rows: readonly TaskUpsertRow[],
    ): Promise<{ created: number; updated: number }> {
      const outcome = runTaskUpsert(db, rows as unknown as Array<Record<string, unknown>>);
      if (outcome.error) {
        throw new ChangxiaError(ChangxiaErrorCode.Validation, outcome.error.userMessage);
      }
      return { created: outcome.created, updated: outcome.updated };
    },
    list: (_query?: TaskQuery) => notImplemented('tasks.list'),
    listByAssignee: () => notImplemented('tasks.listByAssignee'),
    get: () => notImplemented('tasks.get'),
    bulkInsert: () => notImplemented('tasks.bulkInsert'),
    insert: () => notImplemented('tasks.insert'),
    update: () => notImplemented('tasks.update'),
    remove: () => notImplemented('tasks.remove'),
    claim: () => notImplemented('tasks.claim'),
  };

  // Agent payload 当前不操作行程卡；显式抛错而非空实现，防止未来通道静默跳过行程数据。
  const itineraries: IItinerariesRepository = {
    listByProject: () => notImplemented('itineraries.listByProject'),
    ensureProjectDays: () => notImplemented('itineraries.ensureProjectDays'),
    insert: () => notImplemented('itineraries.insert'),
    update: () => notImplemented('itineraries.update'),
    remove: () => notImplemented('itineraries.remove'),
  };

  const members: IMembersRepository = {
    /** 策略 B：`rowToMember` 未导出，委托既有端点（含「只下发 hasPassword、不下发哈希」的纪律） */
    async list(includeInactive?: boolean): Promise<Member[]> {
      const url = includeInactive ? '/api/members?includeInactive=1' : '/api/members';
      return delegateJson<Member[]>(delegate, 'GET', url);
    },
    /** `ensureAgentMember` 只用返回值的 `id`；其余字段顺带给出，形状与实体一致 */
    async insert(cmd): Promise<Member> {
      return delegateJson<Member>(
        delegate,
        'POST',
        '/api/members',
        cmd as unknown as Record<string, unknown>,
      );
    },
    get: () => notImplemented('members.get'),
    update: () => notImplemented('members.update'),
    verifyCredentials: () => notImplemented('members.verifyCredentials'),
  };

  const settings: ISettingsRepository = {
    /** 与 `RemoteSettingsRepository.get` 同一份语义：`{valueJson}` 字符串 → 解析为值 */
    async get<T>(key: string): Promise<T | null> {
      const row = await delegateJson<{ valueJson: string } | null>(
        delegate,
        'GET',
        `/api/settings/${encodeURIComponent(key)}`,
      );
      return row ? (JSON.parse(row.valueJson) as T) : null;
    },
    async set(key: string, valueJson: unknown): Promise<void> {
      await delegateJson<{ ok: boolean }>(delegate, 'PUT', `/api/settings/${encodeURIComponent(key)}`, {
        valueJson,
      });
    },
    all: () => notImplemented('settings.all'),
    replaceAll: () => notImplemented('settings.replaceAll'),
  };

  // append-only 的两张流水表 + 合同：`payload.apply` 完全不碰（自动建阶段**刻意不写
  // StageLog**，见 §4.3 与坑 C9）→ 全部显式抛错，防止将来有人误以为这里能用。
  const logs: IRepositoryBundle['logs'] = {
    appendStageLog: () => notImplemented('logs.appendStageLog'),
    listStageLogsByStage: () => notImplemented('logs.listStageLogsByStage'),
    listStageLogsByProject: () => notImplemented('logs.listStageLogsByProject'),
    appendAssignment: () => notImplemented('logs.appendAssignment'),
    listAssignmentsByTask: () => notImplemented('logs.listAssignmentsByTask'),
  };

  const contracts: IRepositoryBundle['contracts'] = {
    insert: () => notImplemented('contracts.insert'),
    get: () => notImplemented('contracts.get'),
    linkProject: () => notImplemented('contracts.linkProject'),
    saveConfirmedPayload: () => notImplemented('contracts.saveConfirmedPayload'),
    list: () => notImplemented('contracts.list'),
  };

  /* ======================================================================================
   * v5 Agent 执行域（v0.8 补齐服务端实现）
   *
   * 此前 12 个方法全部 `notImplemented`，执行域在服务端形态下**只有表、没有入口**。
   * 现在补齐，并且**逐条复刻本地适配器（`local.execution.repo.ts`）的存储边界强制**
   * ——否则状态机只在客户端成立，Agent 通道只要绕过 UI 直发请求就能把执行单推到任意态。
   *
   * ── 三条纪律（全部照抄本地侧语义，不发明新规则）──
   * 1. **读-校验-写必须在同一事务内**，且用 `.immediate()`。
   *    本地侧靠 Dexie 的 `transaction('rw', ...)` 保证；SQLite 侧靠 `db.transaction`。
   *    没有事务时，两个并发请求会各自读到同一 `current` 再各自 put，**相邻校验被穿透**
   *    （两次校验都基于旧状态通过，后写者覆盖先写者）。
   *    `.immediate()` 而非默认 DEFERRED：本适配器的写方法都是「先读后写」，
   *    DEFERRED 下先拿读锁、升级写锁时失败（SQLITE_BUSY）→ 调用方拿到 500（坑 C8）。
   * 2. **校验复用共享内核**，不在这里重写状态机。`src/core/execution/execution-state.ts`
   *    是纯函数、零 Node 依赖，服务端直接 import（`server/tsconfig.json` 已列入 include）。
   *    抄一份邻接表 = 制造第二份真相源，两端对「什么算合法转移」迟早不一致。
   * 3. **`ChangxiaError` 原样透出**，只在真·存储故障（SQLite 抛错）时包 Storage —— 
   *    把状态机的 Validation 包成 Storage 会丢掉 `code=validation`，
   *    路由层就无法映射成 400，状态机拒绝会伪装成服务端故障。
   *
   * ── 行 ↔ 实体映射 ──
   * 本文件自带一套（`rowToExecution` 等）。**为什么不像 projects/stages 那样复用既有路由的
   * 映射函数**：执行域此前没有任何服务端读路径，`executions.routes.ts` 走的正是本文件的
   * 仓储方法 —— 复用对象是**本文件自己**，不存在「第二份映射」。
   * `confirmation` 是 JSON 对象列、`operations` 是 JSON 数组列，两者必须分开反序列化
   * （`parseJsonArray` 会把对象清成 `[]`，见 `server/lib/json-columns.ts` 注释）。
   * ==================================================================================== */

  /**
   * 单行 / 单集合读 —— 全部委托**模块级**读函数（见下方 `selectExecutionRow` 等）。
   *
   * 为什么要抽到模块级而不是留在这里的闭包：`executions.routes.ts` 的 `detail`
   * 聚合端点需要一个**同步**的多表读事务（better-sqlite3 不接受 async 事务体，见该
   * 端点注释），而闭包只在 `createSqliteBundle` 内部可见。抽出去让路由能在自己的
   * 同步事务里复用**同一份行映射** —— 否则就会出现「列表端点与 detail 端点字段口径
   * 不同」的经典分叉（漏一个 `?? null` 就是静默的 undefined 泄漏）。
   */
  const selectExecution = (id: string): Execution | null => selectExecutionRow(db, id);
  /** 同 `local.execution.repo.ts:96-99` 的「同一事务内的提案集合」——状态机 completed 判据的输入 */
  const selectProposals = (executionId: string): WritebackProposal[] =>
    selectProposalRows(db, executionId);
  const selectAttempts = (executionId: string): ExecutionAttempt[] =>
    selectAttemptRows(db, executionId);
  const selectEvents = (executionId: string): ExecutionEvent[] =>
    selectEventRows(db, executionId);

  /**
   * 把「仓储方法体」包成「事务 + ChangxiaError 透出 + 其余包 Storage」。
   *
   * 用 `.immediate()` 的理由见本节纪律 1。`ChangxiaError` 必须原样重抛：
   * 状态机的拒绝是**预期行为**（调用方传了非法转移），不是存储故障。
   */
  function inImmediateTx<T>(fn: () => T): T {
    try {
      return db.transaction(fn).immediate();
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行域数据写入失败。', err);
    }
  }

  const executions: IExecutionsRepository = {
    /** 与本地侧同款：新建恒为 Draft，currentAttemptNo 从 0 起，全部可选字段归一 null */
    async createExecution(cmd: CreateExecutionCmd): Promise<Execution> {
      const now = new Date().toISOString();
      const row: Execution = {
        id: crypto.randomUUID(),
        projectId: cmd.projectId,
        taskId: cmd.taskId ?? null,
        source: cmd.source,
        objective: cmd.objective,
        agentMemberId: cmd.agentMemberId ?? null,
        channelKind: cmd.channelKind ?? null,
        inputSnapshotHash: cmd.inputSnapshotHash ?? null,
        status: ExecutionStatus.Draft,
        confirmation: null,
        idempotencyKey: cmd.idempotencyKey,
        currentAttemptNo: 0,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        finishedAt: null,
        terminalReason: null,
        blockedReason: null,
      };
      try {
        db.prepare(
          `INSERT INTO executions
             (id, project_id, task_id, source, objective, agent_member_id, channel_kind,
              input_snapshot_hash, status, confirmation, idempotency_key, current_attempt_no,
              created_at, updated_at, started_at, finished_at, terminal_reason, blocked_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          row.id,
          row.projectId,
          row.taskId,
          row.source,
          row.objective,
          row.agentMemberId,
          row.channelKind,
          row.inputSnapshotHash,
          row.status,
          // 对象列：显式序列化（bind 对象会被 better-sqlite3 拒绝，见 serializeJson 注释）
          serializeJson(row.confirmation),
          row.idempotencyKey,
          row.currentAttemptNo,
          row.createdAt,
          row.updatedAt,
          row.startedAt,
          row.finishedAt,
          row.terminalReason,
          row.blockedReason,
        );
        return row;
      } catch (err) {
        if (err instanceof ChangxiaError) throw err;
        throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行单创建失败。', err);
      }
    },

    /**
     * ★ `currentAttemptNo` 在**读路径现算**（不读 DB 列）。
     *
     * DB 里 `executions.current_attempt_no` 两端一致地恒为 `0`（详见
     * `withDerivedAttemptNo` 的注释：该列零读取方，本地侧从不维护，
     * 服务端单方面维护会产生「导入来的值对、本地自建的值错」的分歧）。
     * 「指向最近一次 attempt」这个语义由本处在**同一读事务**内数子表得出，
     * 因此对 API 消费者而言语义单一且始终正确。
     *
     * ⚠️ 未来若两端决定统一维护该列，需要同步改 `src/`（本地 Dexie 侧的
     * `createAttempt` / `updateAttempt`）并撤销这里的现算，否则会退化成
     * 「列里存的值」与「现算的值」两套并存 —— 那时以哪个为准将无从判断。
     */
    async getExecution(id: string): Promise<Execution | null> {
      try {
        const read = db.transaction((executionId: string): Execution | null => {
          const row = selectExecution(executionId);
          if (!row) return null;
          // 同一读事务内取 attempts，避免读到「执行单已建、attempt 还没插」的中间态
          return withDerivedAttemptNo(row, selectAttempts(executionId));
        });
        return read(id);
      } catch (err) {
        throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行单读取失败。', err);
      }
    },

    /**
     * 排序与本地侧逐字一致：createdAt → id（保证两端列表顺序相同）。
     * `currentAttemptNo` 同样在读路径现算，口径与 `getExecution` 完全一致
     * （两处若不一致，会出现「列表显示第 2 次、点进去显示第 3 次」）。
     */
    async listExecutionsByProject(projectId: string): Promise<Execution[]> {
      try {
        const read = db.transaction((pid: string): Execution[] => {
          const rows = db
            .prepare('SELECT * FROM executions WHERE project_id = ? ORDER BY created_at, id')
            .all(pid) as ExecutionRow[];
          return rows.map((r) => withDerivedAttemptNo(rowToExecution(r), selectAttempts(r.id)));
        });
        return read(projectId);
      } catch (err) {
        throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行单列表读取失败。', err);
      }
    },

    /**
     * 状态写入 —— **本文件最关键的写路径**（P0「未人工确认绝不执行」的落点）。
     *
     * 三步在同一 `.immediate()` 事务内（读 → 校验 → 写）：
     *   ① 读 current，不存在 → NotFound；
     *   ② `assertStatusTransition(current, cmd.status, proposals)`（含 completed 需 applied 提案）；
     *   ③ `assertExecutionConfirmed(合并后的确认快照, cmd.status)`。
     *
     * ③ 的入参是**合并后**的确认：`cmd.confirmation !== undefined ? cmd.confirmation : existing.confirmation`
     * ——「确认」与「入队」经常是同一步请求（前端一次提交既批计划又入队），
     * 此时旧行还没有 confirmation，只看 existing 会**永远拒绝**合法的确认入队。
     *
     * 保留 `pickDefined` 语义（undefined 的字段不覆盖既有值），与本地侧同步：
     * 用 SQL 的 `COALESCE` 做不到——它无法区分「没传」与「显式传 null」，
     * 而 `startedAt: null` 是「清空开始时间」这一真实意图。
     *
     * 返回值同样按读路径口径现算 `currentAttemptNo`（见 `withDerivedAttemptNo`）：
     * 本方法的返回值会被 `PATCH /api/executions/:id` 直接下发，若这里给 DB 列的 0
     * 而 `getExecution` 给真实值，同一个执行单在两个端点会显示不同的尝试次数。
     */
    async updateExecutionStatus(id: string, cmd: UpdateExecutionStatusCmd): Promise<Execution> {
      return inImmediateTx(() => {
        const existingRow = selectExecution(id);
        if (!existingRow) {
          throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该执行单。');
        }
        const attempts = selectAttempts(id);
        const existing = withDerivedAttemptNo(existingRow, attempts);
        assertStatusTransition(existing, cmd.status, selectProposals(id));
        const effectiveConfirmation =
          cmd.confirmation !== undefined ? cmd.confirmation : existing.confirmation;
        assertExecutionConfirmed(
          { id: existing.id, status: existing.status, confirmation: effectiveConfirmation },
          cmd.status,
        );

        const next: Execution = {
          ...existing,
          ...pickDefined(cmd),
          confirmation: effectiveConfirmation,
          updatedAt: new Date().toISOString(),
        };
        db.prepare(
          `UPDATE executions SET
             status = ?, confirmation = ?, started_at = ?, finished_at = ?,
             terminal_reason = ?, blocked_reason = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          next.status,
          serializeJson(next.confirmation),
          next.startedAt,
          next.finishedAt,
          next.terminalReason,
          next.blockedReason,
          next.updatedAt,
          id,
        );
        return next;
      });
    },

    /**
     * 追加事件（append-only）。事务内要求 `cmd.seq === nextSeq(events)`。
     *
     * 选**严格相等**而非「> max」：seq 是审计流水的规范排序键，任何缺口都会让
     * 迟到回执的去重 / 排序语义模糊；乱序写应被**拒**而不是被静默重编号
     * （与本地侧 `local.execution.repo.ts:139-144` 逐字同义）。
     */
    async appendEvent(cmd: AppendExecutionEventCmd): Promise<ExecutionEvent> {
      return inImmediateTx(() => {
        const expectedSeq = nextSeq(selectEvents(cmd.executionId));
        if (cmd.seq !== expectedSeq) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Validation,
            `执行事件 seq 非法：调用方传入 ${cmd.seq}，期望 ${expectedSeq}（execution=${cmd.executionId}）。`,
          );
        }
        const now = new Date().toISOString();
        const row: ExecutionEvent = {
          id: crypto.randomUUID(),
          executionId: cmd.executionId,
          attemptId: cmd.attemptId ?? null,
          seq: cmd.seq,
          type: cmd.type,
          actor: cmd.actor,
          fromStatus: cmd.fromStatus ?? null,
          toStatus: cmd.toStatus ?? null,
          reason: cmd.reason ?? null,
          idempotencyKey: cmd.idempotencyKey ?? null,
          createdAt: now,
        };
        db.prepare(
          `INSERT INTO execution_events
             (id, execution_id, attempt_id, seq, type, actor, from_status, to_status, reason,
              idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          row.id,
          row.executionId,
          row.attemptId,
          row.seq,
          row.type,
          row.actor,
          row.fromStatus,
          row.toStatus,
          row.reason,
          row.idempotencyKey,
          row.createdAt,
        );
        return row;
      });
    },

    async listEvents(executionId: string): Promise<ExecutionEvent[]> {
      try {
        return selectEvents(executionId);
      } catch (err) {
        throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行事件列表读取失败。', err);
      }
    },

    /**
     * 新开 attempt：事务内 `canStartAttempt` + `nextAttemptNo`。
     *
     * 两条不变量：
     *   · 同一 execution 同时**最多一个非终态** attempt（queued / running）——并发穿透与
     *     调用方重复开活都在这里拦下（Conflict，不是 Validation：这是状态冲突而非入参错）；
     *   · attemptNo 由仓储单调计算，调用方**若显式传入必须与计算值一致**，否则抛错
     *     ——防止调用方乱传导致号段错乱（如跳号后 `nextAttemptNo` 会把号抬到错误位置）。
     *
     * ⚠️ 此处**不**校验 `execution` 是否存在：外键会拒掉孤儿行（`execution_id REFERENCES
     * executions(id)` 且 `foreign_keys = ON`），但那条错误是 SQLITE_CONSTRAINT_FOREIGNKEY
     * → 会被包成 Storage/500，对调用方毫无信息量。故先显式查一次，给出 NotFound 语义。
     */
    async createAttempt(cmd: CreateAttemptCmd): Promise<ExecutionAttempt> {
      return inImmediateTx(() => {
        if (!selectExecution(cmd.executionId)) {
          throw new ChangxiaError(
            ChangxiaErrorCode.NotFound,
            `未找到执行单 ${cmd.executionId}，不能为其新建 attempt。`,
          );
        }
        const attempts = selectAttempts(cmd.executionId);
        if (!canStartAttempt(attempts)) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Conflict,
            `执行单 ${cmd.executionId} 已存在非终态 attempt，不能新开 attempt。`,
          );
        }
        const computedNo = nextAttemptNo(attempts);
        if (cmd.attemptNo !== undefined && cmd.attemptNo !== computedNo) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Validation,
            `attemptNo 非法：调用方传入 ${cmd.attemptNo}，期望 ${computedNo}（execution=${cmd.executionId}）。`,
          );
        }
        const now = new Date().toISOString();
        const row: ExecutionAttempt = {
          id: crypto.randomUUID(),
          executionId: cmd.executionId,
          attemptNo: computedNo,
          status: cmd.status ?? AttemptStatus.Queued,
          runtimeKind: cmd.runtimeKind ?? null,
          startedAt: cmd.startedAt ?? null,
          finishedAt: cmd.finishedAt ?? null,
          inputSnapshotHash: cmd.inputSnapshotHash ?? null,
          errorCode: null,
          errorSummary: null,
          terminalReason: null,
          createdAt: now,
          updatedAt: now,
        };
        db.prepare(
          `INSERT INTO execution_attempts
             (id, execution_id, attempt_no, status, runtime_kind, started_at, finished_at,
              input_snapshot_hash, error_code, error_summary, terminal_reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          row.id,
          row.executionId,
          row.attemptNo,
          row.status,
          row.runtimeKind,
          row.startedAt,
          row.finishedAt,
          row.inputSnapshotHash,
          row.errorCode,
          row.errorSummary,
          row.terminalReason,
          row.createdAt,
          row.updatedAt,
        );
        // ★ 刻意**不**回写父表（既不动 `current_attempt_no`，也不动 `updated_at`）。
        //   本地侧 `local.execution.repo.ts:180-227` 的 `createAttempt` **逐字同款**：
        //   它只读子表、校验、插子表，全程不碰 `executions` 行。两端必须一致，
        //   理由见 `withDerivedAttemptNo` 的注释（冗余缓存列 + 两端数据分歧风险）。
        return row;
      });
    },

    /**
     * 更新 attempt。事务内校验 attempt 状态机（仅当 cmd.status 提供）。
     *
     * 为什么「提供时才校验」而不是「必填」：本方法也用于写 errorCode / errorSummary
     * 这类**不动状态**的字段（如把失败原因补进已有 failed 行）。
     * 但一旦提供 status，就必须走 `assertAttemptTransition` ——
     * 它堵住的是「把 failed / succeeded / interrupted 改回 running」这条路径，
     * 那会直接绕过「同一 execution 同时最多一个非终态 attempt」的不变量。
     */
    async updateAttempt(id: string, cmd: UpdateAttemptCmd): Promise<ExecutionAttempt> {
      return inImmediateTx(() => {
        const existingRow = db.prepare('SELECT * FROM execution_attempts WHERE id = ?').get(id) as
          | AttemptRow
          | undefined;
        if (!existingRow) {
          throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该执行尝试。');
        }
        const existing = rowToAttempt(existingRow);
        if (cmd.status !== undefined) {
          assertAttemptTransition(existing.status, cmd.status);
        }
        const now = new Date().toISOString();
        const targetStatus = cmd.status ?? existing.status;
        const next: ExecutionAttempt = {
          ...existing,
          ...pickDefined(cmd),
          updatedAt: now,
        };
        // 进入终态（非 queued / running）时盖上 finishedAt：调用方没给就填当前时间，
        // 已落定则保留 —— 审计需要「每次尝试何时结束」，与本地侧同规则。
        if (targetStatus !== AttemptStatus.Queued && targetStatus !== AttemptStatus.Running) {
          next.finishedAt = cmd.finishedAt ?? existing.finishedAt ?? now;
        }
        db.prepare(
          `UPDATE execution_attempts SET
             status = ?, runtime_kind = ?, started_at = ?, finished_at = ?, input_snapshot_hash = ?,
             error_code = ?, error_summary = ?, terminal_reason = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          next.status,
          next.runtimeKind,
          next.startedAt,
          next.finishedAt,
          next.inputSnapshotHash,
          next.errorCode,
          next.errorSummary,
          next.terminalReason,
          next.updatedAt,
          id,
        );
        return next;
      });
    },

    async listAttempts(executionId: string): Promise<ExecutionAttempt[]> {
      try {
        return selectAttempts(executionId);
      } catch (err) {
        throw new ChangxiaError(ChangxiaErrorCode.Storage, '执行尝试列表读取失败。', err);
      }
    },

    /**
     * 创建写回提案。
     *
     * **不允许创建时即为 applied / rejected**：审批事实必须经由 `updateProposal` 落定。
     * 缺这条，调用方可以直接造一个 `status='applied'` 的提案，
     * 再借它把 execution 推到 `completed`（`canComplete` 只检查「存在 applied 且 decidedBy 非空」）
     * —— 「未经人工批准不得写回」的 P0 就只剩形状校验。
     * 注意 `decidedBy` 在这一步恒为 null（哪怕 status 传 applied 也已被上面拒掉）。
     */
    async createProposal(cmd: CreateProposalCmd): Promise<WritebackProposal> {
      if (
        cmd.status === WritebackProposalStatus.Applied ||
        cmd.status === WritebackProposalStatus.Rejected
      ) {
        throw new ChangxiaError(
          ChangxiaErrorCode.Validation,
          `写回提案不允许直接创建为 ${cmd.status}：提案须先创建（draft / proposed）再经由审批落定。`,
        );
      }
      const now = new Date().toISOString();
      const row: WritebackProposal = {
        id: crypto.randomUUID(),
        executionId: cmd.executionId,
        attemptId: cmd.attemptId ?? null,
        projectId: cmd.projectId,
        taskId: cmd.taskId ?? null,
        operations: cmd.operations,
        status: cmd.status ?? WritebackProposalStatus.Draft,
        idempotencyKey: cmd.idempotencyKey,
        decidedBy: null,
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        db.prepare(
          `INSERT INTO writeback_proposals
             (id, execution_id, attempt_id, project_id, task_id, operations, status,
              idempotency_key, decided_by, decided_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          row.id,
          row.executionId,
          row.attemptId,
          row.projectId,
          row.taskId,
          serializeJson(row.operations),
          row.status,
          row.idempotencyKey,
          row.decidedBy,
          row.decidedAt,
          row.createdAt,
          row.updatedAt,
        );
        return row;
      } catch (err) {
        if (err instanceof ChangxiaError) throw err;
        throw new ChangxiaError(ChangxiaErrorCode.Storage, '写回提案创建失败。', err);
      }
    },

    /**
     * 更新写回提案（审批落定点）。事务内两条强制：
     *   · 已落定（applied / rejected）的提案**不可再变更** → Conflict
     *     （堵住「审批后再换 operations」——那等于审批的是一个已被替换的载荷）；
     *   · 落定为终态时 **`decidedBy` 必填** → Validation
     *     （「由谁批准」是审批事实的本体，缺了它 `canComplete` 的 decidedBy 检查就形同虚设）。
     * `decidedAt` 由仓储盖上（调用方给了就以调用方为准，支持事后补录真实决策时间）。
     */
    async updateProposal(id: string, cmd: UpdateProposalCmd): Promise<WritebackProposal> {
      return inImmediateTx(() => {
        const existingRow = db.prepare('SELECT * FROM writeback_proposals WHERE id = ?').get(id) as
          | ProposalRow
          | undefined;
        if (!existingRow) {
          throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该写回提案。');
        }
        const existing = rowToProposal(existingRow);
        if (
          existing.status === WritebackProposalStatus.Applied ||
          existing.status === WritebackProposalStatus.Rejected
        ) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Conflict,
            `写回提案已落定为 ${existing.status}，不可再变更（execution=${existing.executionId}）。`,
          );
        }
        const targetStatus = cmd.status ?? existing.status;
        const toTerminal =
          targetStatus === WritebackProposalStatus.Applied ||
          targetStatus === WritebackProposalStatus.Rejected;
        if (toTerminal && !cmd.decidedBy) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Validation,
            `写回提案落定为 ${targetStatus} 必须由人工决策：decidedBy 必填（execution=${existing.executionId}）。`,
          );
        }
        const now = new Date().toISOString();
        const next: WritebackProposal = {
          ...existing,
          ...pickDefined(cmd),
          updatedAt: now,
        };
        if (toTerminal) {
          next.decidedBy = cmd.decidedBy!;
          next.decidedAt = cmd.decidedAt ?? now;
        }
        db.prepare(
          `UPDATE writeback_proposals SET
             operations = ?, status = ?, decided_by = ?, decided_at = ?, updated_at = ?
           WHERE id = ?`,
        ).run(
          serializeJson(next.operations),
          next.status,
          next.decidedBy,
          next.decidedAt,
          next.updatedAt,
          id,
        );
        return next;
      });
    },

    async listProposals(executionId: string): Promise<WritebackProposal[]> {
      try {
        return selectProposals(executionId);
      } catch (err) {
        throw new ChangxiaError(ChangxiaErrorCode.Storage, '写回提案列表读取失败。', err);
      }
    },
  };

  // 逐方法装配（不做整体断言）：少写一个方法 = 编译期报错，而不是运行期崩在导入路径上。
  // `admin` 为可选字段，本适配器**刻意不提供**（备份通道走既有 /api/backup*，不经这里）。
  return {
    projects,
    stages,
    tasks,
    itineraries,
    members,
    logs,
    contracts,
    settings,
    executions,
  };
}
