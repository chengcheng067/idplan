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
  Execution,
  ExecutionAttempt,
  ExecutionEvent,
  ItineraryDay,
  Member,
  Project,
  Setting,
  Stage,
  StageLog,
  Task,
  WritebackProposal,
} from '../types/entities';
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
} from '../types/dto';
import type {
  AttemptStatus,
  ExecutionConfirmation,
  ExecutionEventActor,
  ExecutionEventType,
  ExecutionSource,
  ExecutionStatus,
  WritebackOperation,
  WritebackProposalStatus,
} from '../types/agent-execution';

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
 * ★ `taskNo` 由仓储分配，调用方不得提供（新建必分配、更新不覆写）——故一并 Omit。
 * `orderIndex` 为**仅新建语义**：命中既有行时保持既有排序（防止重导入反复重排），
 * 两套适配器（local/remote）与该语义逐字一致。
 *
 * 为什么 `taskNo` **必须**进 Omit 列表：它与 `id`/`revision`/`updatedAt` 同属
 * 「仓储分配」字段。不 Omit 则 `payload.apply.ts` 的 `rows.push({...})`、
 * `remote/rest.client.ts` 以及各 spec 夹具会全部编译报错，逼调用方传号 ——
 * 而调用方（Agent 通道）根本无从知道该发什么号（号是本地/服务端的全局状态）。
 */
export type TaskUpsertRow = Omit<
  Task,
  'id' | 'taskNo' | 'revision' | 'updatedAt' | 'externalId' | 'done'
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

/** 旅游每日行程仓储。日期在单项目内唯一，确保按日卡永远只有一张。 */
export interface IItinerariesRepository {
  listByProject(projectId: string): Promise<ItineraryDay[]>;
  /** 在 [startDate, endDate] 内补齐缺失日期；绝不删除已有行（改期安全）。 */
  ensureProjectDays(projectId: string, startDate: string, endDate: string): Promise<ItineraryDay[]>;
  insert(cmd: CreateItineraryDayCmd): Promise<ItineraryDay>;
  update(id: string, cmd: UpdateItineraryDayCmd): Promise<ItineraryDay>;
  remove(id: string): Promise<void>;
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
  /**
   * 整表替换（清表 + 批量写入）。
   *
   * ★ 订正：此处原写「仅备份导入使用」，**与实情不符** —— 备份恢复走的是
   *   `IAdminRepository.replaceAllImport`（`backup.service.ts` 的 `importAndReplace`），
   *   不经本方法。**当前前端零调用点**；它在两档适配器里仍有实现
   *   （local `local.settings.repo.ts` 的 clear+bulkPut、remote 的
   *   `POST /api/settings/replace-all`），属已暴露的写端点。
   *   语义就是「整表替换」：调用方若交来**部分集**，未含的行会被清掉
   *   （`plugin.enabled.*` 不是例外 —— 那是刻意的「全量快照」语义）。
   */
  replaceAll(rows: Setting[]): Promise<void>;
}

/* --------------------------------- Agent 执行域 --------------------------------- */

/** 创建执行单的输入（id / 时间戳 / 状态等由仓储统一生成） */
export interface CreateExecutionCmd {
  projectId: string;
  source: ExecutionSource;
  objective: string;
  taskId?: string | null;
  agentMemberId?: string | null;
  channelKind?: string | null;
  inputSnapshotHash?: string | null;
  /** 幂等键（必填，由 makeExecutionIdempotencyKey 生成） */
  idempotencyKey: string;
}

/** 更新执行单状态的输入（仅状态机允许的字段，由调用方先经 assertTransition 校验） */
export interface UpdateExecutionStatusCmd {
  status: ExecutionStatus;
  confirmation?: ExecutionConfirmation | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  terminalReason?: string | null;
  blockedReason?: string | null;
}

/** 追加执行事件的输入（seq / id 由调用方经 nextSeq / 仓储生成；append-only） */
export interface AppendExecutionEventCmd {
  executionId: string;
  attemptId?: string | null;
  seq: number;
  type: ExecutionEventType;
  actor: ExecutionEventActor;
  fromStatus?: ExecutionStatus | null;
  toStatus?: ExecutionStatus | null;
  reason?: string | null;
  idempotencyKey?: string | null;
}

/** 创建执行尝试的输入 */
export interface CreateAttemptCmd {
  executionId: string;
  /**
   * attemptNo 由仓储统一计算（单调，nextAttemptNo 保证）。
   * 调用方可选传；若传入则必须与仓储计算值一致，否则抛错（防止乱传）。
   */
  attemptNo?: number;
  status?: AttemptStatus;
  runtimeKind?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  inputSnapshotHash?: string | null;
}

/** 更新执行尝试的输入 */
export interface UpdateAttemptCmd {
  status?: AttemptStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  terminalReason?: string | null;
}

/** 创建写回提案的输入 */
export interface CreateProposalCmd {
  executionId: string;
  attemptId?: string | null;
  projectId: string;
  taskId?: string | null;
  operations: WritebackOperation[];
  /** 幂等键（必填，由 makeWritebackIdempotencyKey 生成） */
  idempotencyKey: string;
  status?: WritebackProposalStatus;
  /** v0.8.6：提案理由（≤200 字，写入侧校验；可空） */
  reason?: string | null;
  /** v0.8.6：Agent 自报置信度 0..1（可空；UI 只展示不据此自动决策） */
  confidence?: number | null;
}

/** 更新写回提案的输入 */
export interface UpdateProposalCmd {
  operations?: WritebackOperation[];
  status?: WritebackProposalStatus;
  decidedBy?: string | null;
  decidedAt?: string | null;
  /** v0.8.6：补填/修订提案理由（≤200 字，可空） */
  reason?: string | null;
  /** v0.8.6：补填/修订置信度 0..1（可空） */
  confidence?: number | null;
}

/**
 * Agent 执行域仓储（第一切片）。
 *
 * 聚合承载 executions / executionAttempts / executionEvents / writebackProposals 四类读写，
 * 与旅游 itineraries 仓储同范式：全量装载策略下仅需 projectId / executionId 维度查询。
 *
 * 纪律（铁律 4/6）：
 * - 全部方法 async；local(Dexie) / remote(fetch) 两套适配器逐一对应实现；
 * - executionEvents 刻意不暴露 update/delete（append-only 审计流水，用类型系统锁死）；
 * - 任何失败抛 ChangxiaError{code,userMessage}。
 */
export interface IExecutionsRepository {
  createExecution(cmd: CreateExecutionCmd): Promise<Execution>;
  getExecution(id: string): Promise<Execution | null>;
  listExecutionsByProject(projectId: string): Promise<Execution[]>;
  updateExecutionStatus(id: string, cmd: UpdateExecutionStatusCmd): Promise<Execution>;
  appendEvent(cmd: AppendExecutionEventCmd): Promise<ExecutionEvent>;
  listEvents(executionId: string): Promise<ExecutionEvent[]>;
  createAttempt(cmd: CreateAttemptCmd): Promise<ExecutionAttempt>;
  updateAttempt(id: string, cmd: UpdateAttemptCmd): Promise<ExecutionAttempt>;
  listAttempts(executionId: string): Promise<ExecutionAttempt[]>;
  createProposal(cmd: CreateProposalCmd): Promise<WritebackProposal>;
  updateProposal(id: string, cmd: UpdateProposalCmd): Promise<WritebackProposal>;
  listProposals(executionId: string): Promise<WritebackProposal[]>;
}

/** 备份/引导用管理通道（不走日常业务路径；remote 对应 /api/backup 与导入端点） */
export interface IAdminRepository {
  /** 全量导出（含 append-only 流水表整表） */
  fullExport(): Promise<import('../types/dto').BackupPackage>;
  /**
   * 校验后的清库重建导入。
   *
   * 返回值 `renumbered` = 本次导入中因**包内号段自身冲突**被重编号的任务数
   * （0 = 包内无撞号）。
   *
   * ★ 为什么返回它却**不接 UI toast**（§11-③ 已裁定）：跨库「合并导入」路径
   * **不可达**（两端都是整库替换，见 §9-D5），故 `renumbered > 0` 只在
   * **包自身已损坏**（同一号出现两次）时出现 —— 属异常数据而非正常业务流程。
   * 给一条不存在的路径做界面是错的。返回值保留**仅供单测断言**「撞号确实被修掉了」。
   */
  replaceAllImport(pkg: import('../types/dto').BackupPackage): Promise<{ renumbered: number }>;
}

/**
 * 工作区列表项（`IWorkspaceRepository.list()` 的元素）。
 *
 * ★ 为什么只有这四个字段（不是把 `src/lib/workspace-registry.ts` 的 `WorkspaceEntry`
 *   搬过来）：`dbName` 是 **local 专属**的实现细节（每个区一个 Dexie 库），remote
 *   形态下工作区是服务端的一张表、没有「库名」这个概念。接口层不许让调用方看见
 *   「库名」，否则 UI 会退化成按实现分支（那正是本次抽象要消灭的东西）。
 *   local 实现的 `listRegistry` 注入回调负责把 `WorkspaceEntry` 映射成这四项。
 */
export interface WorkspaceSummary {
  id: string;
  name: string;
  /** Owner（最高管理员）成员名；存量区在首次解析出首个管理员前为 null */
  ownerMemberName: string | null;
  /** 建区时刻（ISO 8601 字符串，与注册表 `WorkspaceEntry.createdAt` 同口径） */
  createdAt: string;
}

/** 建工作区入参（两套实现的语义必须一致：建空白区 + Owner 管理员入库） */
export interface CreateWorkspaceCmd {
  name: string;
  /** Owner 管理员姓名 */
  ownerName: string;
  /** 工作区闸密码明文（≥4 位校验在 UI 层；落库一律是哈希） */
  password: string;
}

/** 设/改工作区闸密码的选项 */
export interface SetWorkspaceGateOptions {
  /**
   * 当前密码（remote 形态的「改密」需要服务端校验旧密；local 形态只在显式改密时用到）。
   * 首次设密（该区本来没有闸密）时缺省。
   */
  currentPassword?: string;
}

/**
 * 工作区能力仓储（多工作区抽象层 · 前端工作区能力的唯一数据访问面）。
 *
 * ── 它解决什么问题 ──
 * 桌面版的工作区能力（列区 / 建区 / 读闸密 / 验闸密 / 写闸密）此前是**组件直连**：
 * `WorkspacePicker` 同时 import `src/lib/workspace-registry`（localStorage 注册表）
 * 与 `src/core/repositories/local/workspace.db`（Dexie 建库/闸密）。remote（NAS）
 * 形态要复用同一个选择器，就必须把这五件事抽成接口——否则 UI 只能按 `dataSource`
 * 分叉，长出第二套界面。
 *
 * ── 纪律（与其它仓储同口径）──
 *   · 全部方法 async；local(Dexie + 注册表) / remote(fetch) 两套适配器逐一对应实现；
 *   · 任何失败抛 `ChangxiaError{code, userMessage}`；
 *   · **接口本身不引任何平台 API**（不碰 `window` / `document` / `localStorage` /
 *     `indexedDB`）：`src/core/**` 的纯净性由 `tests/arch-boundary.spec.ts` 锁定，
 *     且本文件是服务端 tsconfig 的 include 面内的共享内核文件。
 *
 * ── 语义要点（两套实现必须逐条一致，否则同一段 UI 在两种形态下行为分裂）──
 *   ① `verifyGate` 的「密码不对」是**正常返回 false**，不是异常：输错密码是用户
 *      日常操作，抛错会把「密码不对」和「网络断了」混成同一条错误路径。
 *   ② `gateOf` 的 `hasGate:false` 表示该区还没设过闸密 ⇒ 调用方应引导「先设一个
 *      再进」（0017 产品口径），**不得**当成「无需验密、直接进」（0016 的旧做法已废止）。
 *   ③ 本接口**不**包含「同区免验密」这类判断：那是调用方的事，曾经写在这里的
 *      免密短路已被产品负责人否掉（详见 `WorkspacePicker` 文件头）。
 */
export interface IWorkspaceRepository {
  /** 全部工作区（按创建时间先后，与注册表顺序一致） */
  list(): Promise<WorkspaceSummary[]>;

  /**
   * 建一个空白工作区，并把 Owner 管理员写进它的成员表。
   *
   * 返回值 `ownerMemberId` 供调用方落「区级身份键」，实现「建区即以 Owner 身份进入」。
   */
  create(cmd: CreateWorkspaceCmd): Promise<{ id: string; ownerMemberId: string }>;

  /** 该区是否设过闸密码（`hasGate:false` ⇒ 调用方走「先设一个再进」） */
  gateOf(id: string): Promise<{ hasGate: boolean }>;

  /** 校验明文密码是否是该区的闸密码（**错密码返回 false，不抛**） */
  verifyGate(id: string, password: string): Promise<boolean>;

  /**
   * 设 / 改该区闸密码。
   *
   * 该区尚无闸密时 `opts.currentPassword` 可缺省；已有闸密时由实现方决定是否校验旧密
   * （remote 交给服务端裁决，local 形态当前只用于「补设」，改密走成员管理）。
   */
  setGate(id: string, password: string, opts?: SetWorkspaceGateOptions): Promise<void>;
}

/** 七接口捆绑：DI 唯一下发的对象 */
export interface IRepositoryBundle {
  projects: IProjectsRepository;
  stages: IStagesRepository;
  tasks: ITasksRepository;
  itineraries: IItinerariesRepository;
  members: IMembersRepository;
  logs: ILogsRepository;
  contracts: IContractsRepository;
  settings: ISettingsRepository;
  /** Agent 执行域仓储（第一切片） */
  executions: IExecutionsRepository;
  /**
   * 工作区能力仓储（多工作区抽象层 · 批 4）。
   *
   * ── 为什么是可选字段（与 `admin` 同一处理）──
   * 本接口有**三类**装配方：前端 local 工厂、前端 remote 工厂、**服务端 SQLite 适配器**
   * （`server/adapters/sqlite.bundle.ts`，供 `payload.apply` 在 Node 侧跑共享内核）。
   * 服务端那个适配器只实现共享内核真正消费的那几个域，工作区能力**不在其中**
   * （NAS 的工作区是它自己的一张表，由 server 路由直接读写，不经仓储）。
   * 设成必填会让服务端 tsc 直接红，而正确的修法不是逼服务端补一个用不上的实现。
   *
   * ⚠️ 但「类型可选」不等于「前端可以不给」：**两个前端工厂都必须给出实现**，
   * 这条由 `tests/workspace-repository.spec.ts` 的「装配完备性」用例钉死
   * （它会对两个工厂的产物断言 `workspaces` 存在且五个方法齐全）。
   * 这样缺实现的失配会在提交期红，而不是等到首屏工作区列表打不开。
   */
  workspaces?: IWorkspaceRepository;
  admin?: IAdminRepository;
}

/** 创建工厂配置 */
export interface RepositoryFactoryConfig {
  dataSource: import('../types/enums').DataSourceMode;
  apiBaseUrl?: string;
  /**
   * local 模式的 Dexie 库名（多工作区 0016：按工作区分库）。
   * 缺省 = 存量主库 `changxia`（= ws-default 绑定的库，行为零变化）。
   * remote 模式忽略本字段。
   */
  dbName?: string;
  /**
   * 当前工作区 id（多工作区 · 批 4）。
   *
   * **只有 remote 形态消费它**：作为 `X-Workspace-Id` 请求头注入，服务端据此
   * 把请求路由到该区的数据。local 形态忽略它 —— 那边的「当前区」由 `dbName`
   * 表达（每个区一个 Dexie 库），两者是同一件事的两种载体。
   *
   * 缺省空串 ⇒ 不发该头（老服务端 / 单区部署的行为与改造前逐字节一致）。
   */
  workspaceId?: string;
  /**
   * local 形态的**工作区列表来源**（`IWorkspaceRepository.list()` 的实现）。
   *
   * 为什么是注入而不是在 core 里 import：注册表住在 `src/lib/workspace-registry.ts`，
   * 读 localStorage，而 `src/core/**` 不许碰浏览器存储（`tests/arch-boundary.spec.ts`）。
   * 注入方是 `src/di/repository.provider.tsx`（在 `src/di/`，无此约束）。
   * remote 形态忽略本字段（那边的列表来自 `GET /api/workspaces`）。
   */
  workspaceListRegistry?: () => WorkspaceSummary[];
}
