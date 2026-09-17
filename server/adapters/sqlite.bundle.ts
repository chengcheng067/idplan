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
  IMembersRepository,
  IProjectsRepository,
  IRepositoryBundle,
  ISettingsRepository,
  IStagesRepository,
  ITasksRepository,
  IItinerariesRepository,
  ProjectQuery,
  TaskQuery,
  TaskUpsertRow,
} from '../../src/core/repositories/interfaces';
import type { ItineraryDay, Member, Project, Stage, Task } from '../../src/core/types/entities';
// ★ 策略 A：复用既有路由**已导出**的两个映射函数（单一字段口径）
import { rowToProject } from '../routes/projects.routes';
import { rowToStage } from '../routes/stages.routes';
// ★ 策略 D：幂等写入的**唯一实现**（T02 已从 handler body 抽为导出函数）
import { runTaskUpsert } from '../routes/tasks.routes';

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
 * 未实现的方法一律走这里：**显式抛错**，绝不返回 `undefined` / `[]` / `{}`。
 *
 * 用 `ChangxiaError(Storage)` 而不是裸 `Error`：本仓库的纪律是「任何失败都抛
 * `ChangxiaError{code,userMessage}`」，服务端的全局错误处理器认这个形状。
 * 文案里带 `[not-implemented]` 前缀，便于在日志里一眼区分「能力缺口」与「运行期故障」。
 */
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

  // 逐方法装配（不做整体断言）：少写一个方法 = 编译期报错，而不是运行期崩在导入路径上。
  // `admin` 为可选字段，本适配器**刻意不提供**（备份通道走既有 /api/backup*，不经这里）。
  return { projects, stages, tasks, itineraries, members, logs, contracts, settings };
}
