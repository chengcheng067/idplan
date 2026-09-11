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
} from '../interfaces';
import type {
  CreateMemberCmd,
  CreateProjectCmd,
  CreateTaskCmd,
  UpdateMemberCmd,
  UpdateProjectCmd,
  UpdateStageCmd,
  UpdateTaskCmd,
  BackupPackage,
} from '../../types/dto';
import type {
  AssignmentLog,
  ContractRecord,
  Member,
  Project,
  Setting,
  Stage,
  StageLog,
  Task,
} from '../../types/entities';
import { ChangxiaError, ChangxiaErrorCode, StageStatus } from '../../types/enums';
import type { ProjectQuery, TaskQuery, TaskUpsertRow } from '../interfaces';

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
      // HTTP → 业务错误码映射（v0.6 扩展 409）：404=NotFound、409=Conflict（认领
      // 争抢 / 幂等键冲突），其余归 Network。上层只 catch ChangxiaError 一种类型。
      const code =
        res.status === 404
          ? ChangxiaErrorCode.NotFound
          : res.status === 409
            ? ChangxiaErrorCode.Conflict
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

class RemoteAdminRepository implements IAdminRepository {
  public constructor(private readonly api: RestClient) {}

  fullExport(): Promise<BackupPackage> {
    return this.api.get('/backup');
  }
  /**
   * ⚠️ **已知缺口（已上报 team-lead，等待裁决，不在本轮擅自扩围）**：
   * `renumbered` 恒为 `0`，**不是**真实的包内撞号计数。
   *
   * 原因：包内号段查重与 `taskNoSeq` 追平（§2.9.1 的「三者取最大」）本轮只落在
   * **local（Dexie）路径**（§2.9 明确把改动点定在 `local.admin.repo.ts`）；
   * 服务端 `POST /api/backup/import` 只回 `{ ok: true }`，不做查重。
   *
   * 这与本项目「两套适配器语义必须逐字一致」的硬约束**相抵触**（见 interfaces.ts）。
   * 要让远端也正确，需在 `server/routes/meta.routes.ts` 的导入事务内复用
   * `resolveTaskNoCollisions`（同一个纯函数，前后端共享），并让它回传真实计数。
   * 已登记为待裁决项 —— 在本注释被删掉之前，**不要**把这里的 0 当作「服务端没撞号」的证据。
   */
  replaceAllImport(pkg: BackupPackage): Promise<{ renumbered: number }> {
    return this.api.post<unknown>('/backup/import', pkg).then(() => ({ renumbered: 0 }));
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
    members: new RemoteMembersRepository(api),
    logs: new RemoteLogsRepository(api),
    contracts: new RemoteContractsRepository(api),
    settings: new RemoteSettingsRepository(api),
    admin: new RemoteAdminRepository(api),
  };
}

/** RepositoryFactoryConfig 再导出（工厂 index.ts 引用对称） */
export type { RepositoryFactoryConfig };
