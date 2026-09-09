/**
 * Repository 接口契约核心（★ 业务代码唯一依赖的数据访问抽象）。
 *
 * 纪律（铁律 4/6）：
 * - 全部方法 async（Promise 签名），local(Dexie)/remote(fetch) 两套适配器逐一对应实现；
 * - append-only 表（stageLogs/assignments）刻意不暴露 update/delete —— 用类型系统锁死；
 * - 任何失败抛 ChangxiaError{code,userMessage}。
 */

import { ChangxiaErrorCode, StageStatus } from '../types/enums';
import type { TaskSource, TaskStatus } from '../types/enums';
import type {
  AssignmentLog,
  ContractRecord,
  Member,
  Project,
  Setting,
  Stage,
  StageLog,
  Task,
} from '../types/entities';
import type {
  CreateMemberCmd,
  CreateProjectCmd,
  CreateTaskCmd,
  UpdateMemberCmd,
  UpdateProjectCmd,
  UpdateStageCmd,
  UpdateTaskCmd,
} from '../types/dto';

/** 查询过滤条件（尽量简单——全量装载策略下仅需这些维度） */
export interface ProjectQuery {
  status?: 'active' | 'archived' | 'all';
  keyword?: string;
}

export interface TaskQuery {
  projectId?: string;
  stageId?: string;
  /**
   * 参与人包含语义（v0.3 变更 C）：命中条件 = taskAssigneeIds(task) 包含该成员
   * （即 assigneeIds 含之 或 assigneeId 等于之）。接口签名不变，仅语义扩展。
   */
  assigneeId?: string;
  /**
   * @deprecated v0.6 起「是否完成」的唯一事实源是 `Task.status`（done 为派生）。
   *   该维度保留仅为兼容既有调用方（如 TaskChecklist 的未完成过滤）；
   *   新代码一律用 `status`（如 `status: [TaskStatus.Done]` 取反即可表达未完成）。
   */
  done?: boolean;
  /** 任务来源（v0.6）：human=人工 / agent=Agent 导入 */
  source?: TaskSource;
  /** 产出者 Agent 的 Member.id */
  agentId?: string;
  /** 状态过滤（v0.6）：支持单值或数组（数组 = 任一命中） */
  status?: TaskStatus | readonly TaskStatus[];
  /** 幂等键精确匹配（v0.6） */
  externalId?: string;
}

/** 仓储层通用约束注释：写方法统一 bump revision(+1) 并刷新 updatedAt。 */

export interface IProjectsRepository {
  list(query?: ProjectQuery): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  insert(cmd: CreateProjectCmd & { id?: string }): Promise<Project>;
  update(id: string, cmd: UpdateProjectCmd): Promise<Project>;
  archive(id: string, archived: boolean): Promise<void>;
  /** 永久删除（级联清理该项目下 stages/tasks/流水），不可恢复 */
  remove(id: string): Promise<void>;
}

export interface IStagesRepository {
  listByProject(projectId: string): Promise<Stage[]>;
  get(id: string): Promise<Stage | null>;
  bulkInsert(rows: Stage[]): Promise<void>;
  update(id: string, cmd: UpdateStageCmd): Promise<Stage>;
  /** 改期专用入口（days 无需计算，由 service 层给定新起止）；不在此处写流水 */
  reschedule(id: string, startAt: string, endAt: string, status?: StageStatus): Promise<Stage>;
}

/**
 * 幂等批量写入行（v0.6 · §3.5）：Agent payload 导入的唯一写入形状。
 * `id` 由仓储生成（命中既有行时忽略）、`revision`/`updatedAt` 由仓储统一 bump；
 * `externalId` 必填（非空字符串）——它是幂等键。
 * `orderIndex` 为**仅新建语义**：命中既有行时保持既有排序（防止重导入反复重排），
 * 两套适配器（local/remote）与该语义逐字一致。
 */
export type TaskUpsertRow = Omit<
  Task,
  'id' | 'revision' | 'updatedAt' | 'externalId' | 'done'
> & {
  externalId: string;
  /** 可省：省略时仓储按 `status === 'done'` 派生（唯一事实源纪律） */
  done?: boolean;
};

export interface ITasksRepository {
  list(query?: TaskQuery): Promise<Task[]>;
  listByProject(projectId: string): Promise<Task[]>;
  listByAssignee(memberId: string): Promise<Task[]>;
  /** 按 id 取单条（v0.6 新增：task.service 流转校验需要权威的当前 status）；不存在返回 null */
  get(id: string): Promise<Task | null>;
  bulkInsert(rows: Task[]): Promise<void>;
  insert(cmd: CreateTaskCmd): Promise<Task>;
  update(id: string, cmd: UpdateTaskCmd): Promise<Task>;
  remove(id: string): Promise<void>;
  /**
   * 幂等批量写入（v0.6 · §3.5，payload 导入**唯一写入出口**）：
   * 逐行按 `externalId` 查找——命中则合并 patch 并 bump revision（updated），
   * 未命中则新建（created）。**整个调用是单事务**：任一行失败则全部回滚，
   * 不允许出现「半套写入」。
   * 返回 `{ created, updated }` 计数（rejected 行不在此列，由调用方先行过滤）。
   */
  upsertByExternalId(rows: readonly TaskUpsertRow[]): Promise<{ created: number; updated: number }>;
  /**
   * 原子认领（v0.6 · §3.5）：单事务内 校验 status==='ready' 且 claimedAt===null
   * → 置 status='claimed'、assigneeId=actorMemberId、claimedAt=now。
   * 并发争抢只有一个成功，其余抛 `ChangxiaError(Conflict)`；
   * 非 ready 态认领同样抛 Conflict（文案：「该任务已被认领或不处于就绪状态。」）。
   */
  claim(taskId: string, actorMemberId: string): Promise<Task>;
}

export interface IMembersRepository {
  list(includeInactive?: boolean): Promise<Member[]>;
  get(id: string): Promise<Member | null>;
  insert(cmd: CreateMemberCmd): Promise<Member>;
  update(id: string, cmd: UpdateMemberCmd): Promise<Member>;
  /**
   * 校验成员密码（v0.6 密码系统）。
   * local：Web Crypto PBKDF2 比对（见 src/lib/password.ts）；
   * remote：POST /api/members/verify 由后端 crypto.scrypt 比对。密码绝不下发客户端。
   */
  verifyCredentials(memberId: string, password: string): Promise<boolean>;
}

/** append-only：只进不出 */
export interface ILogsRepository {
  appendStageLog(log: Omit<StageLog, 'id' | 'createdAt'>): Promise<StageLog>;
  listStageLogsByStage(stageId: string): Promise<StageLog[]>;
  listStageLogsByProject(projectId: string): Promise<StageLog[]>;
  appendAssignment(
    log: Omit<AssignmentLog, 'id' | 'createdAt'>,
  ): Promise<AssignmentLog>;
  listAssignmentsByTask(taskId: string): Promise<AssignmentLog[]>;
}

export interface IContractsRepository {
  insert(row: Omit<ContractRecord, 'id' | 'createdAt'> & { id?: string }): Promise<ContractRecord>;
  get(id: string): Promise<ContractRecord | null>;
  linkProject(contractId: string, projectId: string): Promise<void>;
  saveConfirmedPayload(contractId: string, confirmedJson: string): Promise<void>;
  list(): Promise<ContractRecord[]>;
}

export interface ISettingsRepository {
  get<T>(key: string): Promise<T | null>;
  set(key: string, valueJson: unknown): Promise<void>;
  all(): Promise<Setting[]>;
  /** 仅备份导入使用：整表替换 */
  replaceAll(rows: Setting[]): Promise<void>;
}

/** 备份/引导用管理通道（不走日常业务路径；remote 对应 /api/backup 与导入端点） */
export interface IAdminRepository {
  /** 全量导出（含 append-only 流水表整表） */
  fullExport(): Promise<import('../types/dto').BackupPackage>;
  /** 校验后的清库重建导入 */
  replaceAllImport(pkg: import('../types/dto').BackupPackage): Promise<void>;
}

/** 七接口捆绑：DI 唯一下发的对象 */
export interface IRepositoryBundle {
  projects: IProjectsRepository;
  stages: IStagesRepository;
  tasks: ITasksRepository;
  members: IMembersRepository;
  logs: ILogsRepository;
  contracts: IContractsRepository;
  settings: ISettingsRepository;
  admin?: IAdminRepository;
}

/** 创建工厂配置 */
export interface RepositoryFactoryConfig {
  dataSource: import('../types/enums').DataSourceMode;
  apiBaseUrl?: string;
}
