/**
 * REST 适配器：fetch 封装 + 七个远端仓储实现（路由严格照 docs/api-contract.md）。
 * HTTP/网络错误统一翻译为 ChangxiaError（铁律 5）。
 * 预留 Authorization header 位（待确认 7：局域网信任，token 留空即可）。
 */

import type {
  IRepositoryBundle,
  RepositoryFactoryConfig,
  IProjectsRepository,
  IStagesRepository,
  ITasksRepository,
  IMembersRepository,
  ILogsRepository,
  IContractsRepository,
  ISettingsRepository,
  IAdminRepository,
  IItinerariesRepository,
  IExecutionsRepository,
} from '../interfaces';
import type {
  CreateItineraryDayCmd,
  CreateMemberCmd,
  CreateProjectCmd,
  CreateTaskCmd,
  UpdateItineraryDayCmd,
  UpdateMemberCmd,
  UpdateProjectCmd,
  UpdateStageCmd,
  UpdateTaskCmd,
  BackupPackage,
} from '../../types/dto';
import type {
  AssignmentLog,
  ContractRecord,
  Execution,
  ExecutionAttempt,
  ExecutionEvent,
  Member,
  Project,
  Setting,
  Stage,
  StageLog,
  Task,
  ItineraryDay,
  WritebackProposal,
} from '../../types/entities';
import { ChangxiaError, ChangxiaErrorCode, StageStatus } from '../../types/enums';
import type { ProjectQuery, TaskQuery, TaskUpsertRow } from '../interfaces';
import type {
  AppendExecutionEventCmd,
  CreateAttemptCmd,
  CreateExecutionCmd,
  CreateProposalCmd,
  UpdateAttemptCmd,
  UpdateExecutionStatusCmd,
  UpdateProposalCmd,
} from '../interfaces';

/* --------------------------------- fetch 封装 --------------------------------- */

export class RestClient {
  public constructor(
    private readonly baseUrl: string,
    /** 预留位：未来 Docker 化后填简单 token */
    private readonly authToken: string = '',
    private readonly timeoutMs: number = 8000,
  ) {}

  public async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Network,
        '无法连接到服务器，请检查局域网地址配置。',
        err,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let userMessage = `服务端错误（HTTP ${res.status}）`;
      try {
        const payload = (await res.json()) as { error?: { userMessage?: string } };
        if (payload?.error?.userMessage) userMessage = payload.error.userMessage;
      } catch {
        /* 非 JSON 错误体保持默认文案 */
      }
      // HTTP → 业务错误码映射：404=NotFound、409=Conflict（认领争抢 / 单活 attempt /
      // 提案已落定）、400|422=Validation、其余归 Network。上层只 catch ChangxiaError 一种类型。
      //
      // ★ 400 → Validation 是 v0.8 补上的缺口（此前落进 `else` 被归为 Network）。
      //   服务端的**状态机拒绝走 400**（见 `server/routes/executions.routes.ts` 的
      //   `CODE_TO_STATUS`：`validation` → 400），于是「非法的执行状态转移」「seq 跳号」
      //   「attemptNo 与计算值不一致」「未确认不得入队」这些**确定性拒绝**会被显示成
      //   「无法连接到服务器」——文案把人指向网络排查，真因是调用方数据不合法，
      //   且 `Network` 语义上意味着「可重试」，而状态机拒绝重试多少次都一样。
      //   服务端本来就回传了权威的 `userMessage`（含 from → to 与拒绝原因），
      //   映射只有对了，那句文案才可能到达用户。
      // 422 一并归入：同属「请求形状对、语义不合法」的 4xx，服务端当前不发它，
      //   但反向代理 / 未来中间件可能用；归到 Network 同样是误导。
      const code =
        res.status === 404
          ? ChangxiaErrorCode.NotFound
          : res.status === 409
            ? ChangxiaErrorCode.Conflict
            : res.status === 400 || res.status === 422
              ? ChangxiaErrorCode.Validation
              : ChangxiaErrorCode.Network;
      throw new ChangxiaError(code, userMessage);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  public get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  public post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
  public patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }
  public put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }
  public delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}

const qs = (
  params: Record<string, string | number | boolean | readonly string[] | undefined>,
): string => {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    // 数组值（v0.6 status 多选）→ 逗号 join，服务端按逗号 split 后逐值匹配
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v] as [string, string]);
  if (entries.length === 0) return '';
  return `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`;
};

/* ------------------------------- 远端仓储实现 ------------------------------- */

export class RemoteProjectsRepository implements IProjectsRepository {
  public constructor(private readonly api: RestClient) {}

  list(query?: ProjectQuery): Promise<Project[]> {
    return this.api.get(`/projects${qs({ status: query?.status, keyword: query?.keyword })}`);
  }
  get(id: string): Promise<Project | null> {
    return this.api.get(`/projects/${id}`);
  }
  insert(cmd: CreateProjectCmd & { id?: string }): Promise<Project> {
    return this.api.post('/projects', cmd);
  }
  update(id: string, cmd: UpdateProjectCmd): Promise<Project> {
    return this.api.patch(`/projects/${id}`, cmd);
  }
  archive(id: string, archived: boolean): Promise<void> {
    return this.api.post(`/projects/${id}/archive`, { archived });
  }
  remove(id: string): Promise<void> {
    return this.api.delete(`/projects/${id}`);
  }
}

export class RemoteStagesRepository implements IStagesRepository {
  public constructor(private readonly api: RestClient) {}

  async listByProject(projectId: string): Promise<Stage[]> {
    const rows = await this.api.get<Stage[]>(`/projects/${projectId}/stages`);
    return rows.sort((a, b) => a.orderIndex - b.orderIndex);
  }
  get(id: string): Promise<Stage | null> {
    return this.api.get(`/stages/${id}`);
  }
  bulkInsert(rows: Stage[]): Promise<void> {
    return this.api.post('/stages/bulk', { rows });
  }
  update(id: string, cmd: UpdateStageCmd): Promise<Stage> {
    return this.api.patch(`/stages/${id}`, cmd);
  }
  reschedule(id: string, startAt: string, endAt: string, status?: StageStatus): Promise<Stage> {
    return this.api.post(`/stages/${id}/reschedule`, { startAt, endAt, status });
  }
}

export class RemoteTasksRepository implements ITasksRepository {
  public constructor(private readonly api: RestClient) {}

  list(query?: TaskQuery): Promise<Task[]> {
    return this.api.get(
      `/tasks${qs({
        projectId: query?.projectId,
        stageId: query?.stageId,
        assigneeId: query?.assigneeId,
        done: query?.done,
        // v0.6 新维度（status 数组由 qs 逗号 join，服务端 split 后逐值匹配）
        source: query?.source,
        agentId: query?.agentId,
        status: query?.status === undefined ? undefined : Array.isArray(query.status) ? [...query.status] : [query.status],
        externalId: query?.externalId,
      })}`,
    );
  }
  listByProject(projectId: string): Promise<Task[]> {
    return this.list({ projectId });
  }
  listByAssignee(memberId: string): Promise<Task[]> {
    return this.list({ assigneeId: memberId });
  }
  async get(id: string): Promise<Task | null> {
    try {
      return await this.api.get<Task>(`/tasks/${id}`);
    } catch (err) {
      // NotFound → null（与接口契约一致：不存在返回 null 而非抛错）
      if (err instanceof ChangxiaError && err.code === ChangxiaErrorCode.NotFound) return null;
      throw err;
    }
  }
  bulkInsert(rows: Task[]): Promise<void> {
    return this.api.post('/tasks/bulk', { rows });
  }
  insert(cmd: CreateTaskCmd): Promise<Task> {
    return this.api.post('/tasks', cmd);
  }
  update(id: string, cmd: UpdateTaskCmd): Promise<Task> {
    return this.api.patch(`/tasks/${id}`, cmd);
  }
  remove(id: string): Promise<void> {
    return this.api.delete(`/tasks/${id}`);
  }
  /**
   * 幂等批量写入：POST /tasks/upsert { rows } → { created, updated }。
   * done 恒由 status 派生（服务端同样不接受请求体的 done）。
   */
  upsertByExternalId(rows: readonly TaskUpsertRow[]): Promise<{ created: number; updated: number }> {
    return this.api.post('/tasks/upsert', { rows });
  }
  /** 原子认领：HTTP 409 已由 RestClient 翻译为 ChangxiaError(Conflict) */
  claim(taskId: string, actorMemberId: string): Promise<Task> {
    return this.api.post(`/tasks/${taskId}/claim`, { actorMemberId });
  }
}

export class RemoteItinerariesRepository implements IItinerariesRepository {
  public constructor(private readonly api: RestClient) {}

  async listByProject(projectId: string): Promise<ItineraryDay[]> {
    const rows = await this.api.get<ItineraryDay[]>(`/projects/${projectId}/itineraries`);
    return rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }

  ensureProjectDays(projectId: string, startDate: string, endDate: string): Promise<ItineraryDay[]> {
    return this.api.post(`/projects/${projectId}/itineraries/ensure`, { startDate, endDate });
  }

  insert(cmd: CreateItineraryDayCmd): Promise<ItineraryDay> {
    return this.api.post(`/projects/${cmd.projectId}/itineraries`, cmd);
  }

  update(id: string, cmd: UpdateItineraryDayCmd): Promise<ItineraryDay> {
    return this.api.patch(`/itineraries/${id}`, cmd);
  }

  remove(id: string): Promise<void> {
    return this.api.delete(`/itineraries/${id}`);
  }
}

export class RemoteMembersRepository implements IMembersRepository {
  public constructor(private readonly api: RestClient) {}

  list(includeInactive?: boolean): Promise<Member[]> {
    return this.api.get(`/members${qs({ includeInactive: includeInactive ? 1 : undefined })}`);
  }
  get(id: string): Promise<Member | null> {
    return this.api.get(`/members/${id}`);
  }
  insert(cmd: CreateMemberCmd): Promise<Member> {
    return this.api.post('/members', cmd);
  }
  update(id: string, cmd: UpdateMemberCmd): Promise<Member> {
    return this.api.patch(`/members/${id}`, cmd);
  }
  /** 密码校验：POST /api/members/verify { memberId, password } → 200/401（服务端 scrypt 比对） */
  async verifyCredentials(memberId: string, password: string): Promise<boolean> {
    try {
      await this.api.post('/members/verify', { memberId, password });
      return true;
    } catch {
      // 401（密码错误）或任何失败 → false；由调用方给出用户名/密码错误提示
      return false;
    }
  }
}

export class RemoteLogsRepository implements ILogsRepository {
  public constructor(private readonly api: RestClient) {}

  appendStageLog(log: Omit<StageLog, 'id' | 'createdAt'>): Promise<StageLog> {
    return this.api.post('/logs/stage', log);
  }
  listStageLogsByStage(stageId: string): Promise<StageLog[]> {
    return this.api.get(`/stages/${stageId}/logs`);
  }
  listStageLogsByProject(projectId: string): Promise<StageLog[]> {
    return this.api.get(`/projects/${projectId}/logs`);
  }
  appendAssignment(log: Omit<AssignmentLog, 'id' | 'createdAt'>): Promise<AssignmentLog> {
    return this.api.post('/logs/assignments', log);
  }
  listAssignmentsByTask(taskId: string): Promise<AssignmentLog[]> {
    return this.api.get(`/tasks/${taskId}/assignments`);
  }
}

export class RemoteContractsRepository implements IContractsRepository {
  public constructor(private readonly api: RestClient) {}

  insert(row: Omit<ContractRecord, 'id' | 'createdAt'> & { id?: string }): Promise<ContractRecord> {
    return this.api.post('/contracts', row);
  }
  get(id: string): Promise<ContractRecord | null> {
    return this.api.get(`/contracts/${id}`);
  }
  linkProject(contractId: string, projectId: string): Promise<void> {
    return this.api.post(`/contracts/${contractId}/link-project`, { projectId });
  }
  saveConfirmedPayload(contractId: string, confirmedJson: string): Promise<void> {
    return this.api.post(`/contracts/${contractId}/confirmed-payload`, { confirmedJson });
  }
  list(): Promise<ContractRecord[]> {
    return this.api.get('/contracts');
  }
}

export class RemoteSettingsRepository implements ISettingsRepository {
  public constructor(private readonly api: RestClient) {}

  async get<T>(key: string): Promise<T | null> {
    const row = await this.api.get<{ key: string; valueJson: string } | null>(`/settings/${key}`);
    return row ? (JSON.parse(row.valueJson) as T) : null;
  }
  set(key: string, valueJson: unknown): Promise<void> {
    return this.api.put(`/settings/${key}`, { valueJson });
  }
  all(): Promise<Setting[]> {
    return this.api.get('/settings');
  }
  replaceAll(rows: Setting[]): Promise<void> {
    return this.api.post('/settings/replace-all', { rows });
  }
}

/**
 * Agent 执行域远端适配器（v0.8 落地）。
 *
 * ── 单一事实源：存下来的是「数据」，不是「状态机」 ──
 * 本适配器**不复刻状态机校验**（`assertStatusTransition` / `assertExecutionConfirmed` /
 * `canStartAttempt` / `nextAttemptNo` / `nextSeq`）。理由不是偷懒，是三层硬事实：
 *
 *   ① **校验者必须是权威的那一个**。`server/adapters/sqlite.bundle.ts` 的 12 个方法
 *      在 `.immediate()` 写事务内完成「读 → 校验 → 写」，服务端是唯一能把这三步
 *      原子化的地方。客户端做同样的事只能「先读后写」，**必然存在竞态窗口**
 *      —— 两个标签页同时入队，两边都会读到旧状态并各自通过校验。
 *      即：客户端复刻校验**防不住它想防的并发穿透**，只多一次往返。
 *   ② **服务端覆盖与本地适配器等量的边界**（已逐条核对，见下方「逐方法对齐」表），
 *      不存在「服务端少校验一条」的缺口需要客户端补位。
 *   ③ **重复校验会产生第二个真相源**。将来加一条合法边，要改 client、server、
 *      local 三处，漏一处就出现「客户端放行、服务端拒绝」或反向的错位。
 *
 * ── 客户端**必须**做的两件事（本类实现的就是它们）──
 *   ① **错误语义原样传播**：把服务端的 `Conflict`(409) / `Validation`(400) /
 *      `NotFound`(404) 映射成同名的 `ChangxiaError.code`，**绝不吞成 `Network`**
 *      （映射在 `RestClient` L106-127；`Validation` 那一档是本次补上的缺口）。
 *      同时服务端的 `userMessage` 逐字透出 —— 它含 `from → to` 与拒绝原因，
 *      比客户端能编的任何文案都准。
 *   ② **不静默「修正」**：例如 `createAttempt` 的 `attemptNo` **原样透传**
 *      （`cmd.attemptNo ?? undefined` 都不做归一），调用方没传就不传，传错了
 *      让服务端抛 Validation。若在客户端「顺手算一个」号传过去，服务端的
 *      「号段单调」防护会被自己的客户端绕过，审计流水里的号将不再可信。
 *
 * ── 逐方法对齐（服务端端点 ↔ 服务端校验位置）──
 *   createExecution        POST /projects/:projectId/executions   （形状校验 + source 白名单）
 *   getExecution           GET  /executions/:id                   （404 → null）
 *   listExecutionsByProject GET /projects/:projectId/executions
 *   updateExecutionStatus  PATCH /executions/:id                  （sqlite.bundle L881：邻接表
 *                                                                    + completed 需 applied 提案
 *                                                                    + 合并确认快照的人工确认门槛）
 *   appendEvent            POST /executions/:id/events            （L929：seq === nextSeq）
 *   listEvents             GET  /executions/:id/events
 *   createAttempt          POST /executions/:id/attempts          （L995：外键存在性 → NotFound、
 *                                                                    canStartAttempt → Conflict、
 *                                                                    attemptNo 一致性 → Validation）
 *   updateAttempt          PATCH /attempts/:id                    （L1070：attempt 邻接表、
 *                                                                    终态盖 finishedAt）
 *   listAttempts           GET  /executions/:id/attempts
 *   createProposal         POST /executions/:id/proposals         （L1132：创建时不得为 applied/rejected）
 *   updateProposal         PATCH /proposals/:id                   （L1192：已落定不可变更 → Conflict、
 *                                                                    落定需 decidedBy → Validation）
 *   listProposals          GET  /executions/:id/proposals
 *
 * ── 时序口径两端一致 ──
 *   `listEvents` 按 `seq` 升序、`listAttempts` 按 `attemptNo` 升序
 *   （服务端 `selectEventRows` / `selectAttemptRows` 已 ORDER BY，与本地适配器等价），
 *   故这里不再二次排序 —— 重复排序只会掩盖服务端排序被改坏的事实。
 *
 * ── 路径前缀 ──
 *   全部用**相对路径**（`/executions/...`）。`createRemoteRepositories` 传入的
 *   `apiBaseUrl` 已含 `/api`（见 `VITE_API_BASE_URL` 契约与既有 Remote* 适配器），
 *   这里再写一遍 `/api` 会变成 `/api/api/...`。
 */
export class RemoteExecutionsRepository implements IExecutionsRepository {
  public constructor(private readonly api: RestClient) {}

  createExecution(cmd: CreateExecutionCmd): Promise<Execution> {
    // projectId 走路径（服务端从 `req.params` 取），**不再放进 body**：
    // 服务端 handler 显式用 `projectId` 覆盖，body 里的同名值会被忽略；
    // 放进去只会让「哪个才是真值」看起来有歧义。
    return this.api.post(`/projects/${cmd.projectId}/executions`, {
      source: cmd.source,
      objective: cmd.objective,
      taskId: cmd.taskId,
      agentMemberId: cmd.agentMemberId,
      channelKind: cmd.channelKind,
      inputSnapshotHash: cmd.inputSnapshotHash,
      idempotencyKey: cmd.idempotencyKey,
    });
  }

  /** 不存在返回 null（与接口契约一致，非抛错）——同 `RemoteTasksRepository.get` 范式 */
  async getExecution(id: string): Promise<Execution | null> {
    try {
      return await this.api.get<Execution>(`/executions/${id}`);
    } catch (err) {
      if (err instanceof ChangxiaError && err.code === ChangxiaErrorCode.NotFound) return null;
      throw err;
    }
  }

  listExecutionsByProject(projectId: string): Promise<Execution[]> {
    return this.api.get(`/projects/${projectId}/executions`);
  }

  /**
   * 状态写入。走 `PATCH /executions/:id`（REST 惯例改资源字段），
   * 与 `POST /executions/:id/status` 在服务端**共用同一个 handler**，语义完全一致。
   *
   * ⚠️ 刻意**不**在这里做 `assertStatusTransition`：见类头 ①②③。
   * 服务端会拒并回 400 `{code:'validation', userMessage:'非法的执行状态转移：…'}`，
   * `RestClient` 把它映射成 `ChangxiaError(Validation)` 原样抛出。
   */
  updateExecutionStatus(id: string, cmd: UpdateExecutionStatusCmd): Promise<Execution> {
    // confirmation 三态（undefined / null / 对象）必须原样保留：
    // 服务端用 `body.confirmation === undefined` 区分「不动既有确认」与「显式清空」，
    // 写成 `cmd.confirmation ?? null` 会把「没传」变成「清空」——那是静默改语义。
    // JSON.stringify 天然丢弃 undefined 值键，正好等于「不传该字段」。
    return this.api.patch(`/executions/${id}`, cmd);
  }

  /** 追加事件：`seq` 原样透传（服务端要求 `seq === nextSeq(events)`，跳号/乱序抛 Validation） */
  appendEvent(cmd: AppendExecutionEventCmd): Promise<ExecutionEvent> {
    return this.api.post(`/executions/${cmd.executionId}/events`, {
      attemptId: cmd.attemptId,
      seq: cmd.seq,
      type: cmd.type,
      actor: cmd.actor,
      fromStatus: cmd.fromStatus,
      toStatus: cmd.toStatus,
      reason: cmd.reason,
      idempotencyKey: cmd.idempotencyKey,
    });
  }

  listEvents(executionId: string): Promise<ExecutionEvent[]> {
    return this.api.get(`/executions/${executionId}/events`);
  }

  /**
   * 新开 attempt。`attemptNo` **原样透传**（调用方没传 → 字段不出现在 body，
   * 服务端自行计算；传了 → 由服务端校验一致性）。
   * 服务端会拒：execution 不存在 → NotFound、已存在非终态 attempt → Conflict、
   * 号不一致 → Validation。三者经 `RestClient` 各归各码，不会混成 Network。
   */
  createAttempt(cmd: CreateAttemptCmd): Promise<ExecutionAttempt> {
    return this.api.post(`/executions/${cmd.executionId}/attempts`, {
      attemptNo: cmd.attemptNo,
      status: cmd.status,
      runtimeKind: cmd.runtimeKind,
      startedAt: cmd.startedAt,
      finishedAt: cmd.finishedAt,
      inputSnapshotHash: cmd.inputSnapshotHash,
    });
  }

  /** 更新 attempt：服务端校验 attempt 邻接表 + 进终态自动盖 finishedAt（与本地适配器等价） */
  updateAttempt(id: string, cmd: UpdateAttemptCmd): Promise<ExecutionAttempt> {
    return this.api.patch(`/attempts/${id}`, cmd);
  }

  listAttempts(executionId: string): Promise<ExecutionAttempt[]> {
    return this.api.get(`/executions/${executionId}/attempts`);
  }

  /**
   * 创建写回提案。
   * `status` 原样透传：服务端会拒「创建即为 applied / rejected」（Validation），
   * 客户端不预先拦 —— 拦了就有两份判定，将来加状态值时必然分叉。
   */
  createProposal(cmd: CreateProposalCmd): Promise<WritebackProposal> {
    return this.api.post(`/executions/${cmd.executionId}/proposals`, {
      attemptId: cmd.attemptId,
      projectId: cmd.projectId,
      taskId: cmd.taskId,
      operations: cmd.operations,
      idempotencyKey: cmd.idempotencyKey,
      status: cmd.status,
    });
  }

  /**
   * 审批落定。服务端两条强制：
   *   · 已落定（applied / rejected）不可再变更 → 409 Conflict；
   *   · 落定为终态时 `decidedBy` 必填 → 400 Validation。
   * 两者都靠 `RestClient` 的码映射如实到达调用方（这是产品铁律
   * 「未经人工批准不得写回」在远端形态下唯一可见的反馈）。
   */
  updateProposal(id: string, cmd: UpdateProposalCmd): Promise<WritebackProposal> {
    return this.api.patch(`/proposals/${id}`, cmd);
  }

  listProposals(executionId: string): Promise<WritebackProposal[]> {
    return this.api.get(`/executions/${executionId}/proposals`);
  }
}

class RemoteAdminRepository implements IAdminRepository {
  public constructor(private readonly api: RestClient) {}

  fullExport(): Promise<BackupPackage> {
    return this.api.get('/backup');
  }
  /**
   * 备份整库导入（remote 侧）。
   *
   * ★ v0.7（T01-b）：本注释此前把「服务端不做号段归一」记为**待裁决的已知缺口**，
   *   现裁决为「做」并已落地 —— 服务端 `POST /api/backup/import` 现在与 local 路径
   *   **同义**地在导入事务内调用**同一个**共享纯函数 `resolveTaskNoCollisions`
   *   （见 `server/routes/meta.routes.ts`），并把真实重编号条数放在响应体的
   *   `renumbered` 字段里回传。
   *   至此两套适配器在「导入后计数器值」与「`renumbered` 含义」上给出同一个答案
   *   （硬约束见 interfaces.ts）—— 判定逻辑只有共享纯函数一处，不存在第二份实现。
   *
   * 故此处**如实回传**服务端计数；仅在字段缺失时回落 `0` —— 那只可能是**老服务端**
   * （升级前的 NAS）的响应，属版本兼容分支，**不是**「服务端没做查重」的证据。
   */
  replaceAllImport(pkg: BackupPackage): Promise<{ renumbered: number }> {
    return this.api
      .post<{ renumbered?: number }>('/backup/import', pkg)
      .then((res) => ({ renumbered: typeof res?.renumbered === 'number' ? res.renumbered : 0 }));
  }
}

/* --------------------------------- 工厂出口 --------------------------------- */

/** remote bundle 装配（rest.client 同时承担 createRemoteRepositories 职责） */
export function createRemoteRepositories(apiBaseUrl: string): IRepositoryBundle {
  if (!apiBaseUrl) {
    throw new ChangxiaError(
      ChangxiaErrorCode.Network,
      '启用 remote 数据源时必须配置 VITE_API_BASE_URL。',
    );
  }
  // v0.6：VITE_API_TOKEN 预留位启用——Docker 化局域网部署时可配简单 Bearer token；
  // 未配置时空串，与改造前行为完全一致（不发送 Authorization header）。
  const env = import.meta.env as Record<string, string | undefined>;
  const api = new RestClient(apiBaseUrl.replace(/\/+$/, ''), env.VITE_API_TOKEN ?? '');
  return {
    projects: new RemoteProjectsRepository(api),
    stages: new RemoteStagesRepository(api),
    tasks: new RemoteTasksRepository(api),
    itineraries: new RemoteItinerariesRepository(api),
    members: new RemoteMembersRepository(api),
    logs: new RemoteLogsRepository(api),
    contracts: new RemoteContractsRepository(api),
    settings: new RemoteSettingsRepository(api),
    executions: new RemoteExecutionsRepository(api),
    admin: new RemoteAdminRepository(api),
  };
}

/** RepositoryFactoryConfig 再导出（工厂 index.ts 引用对称） */
export type { RepositoryFactoryConfig };
