/**
 * 备份服务：exportAll() → BackupPackage；importAndReplace() → zod 校验 + 清库重建。
 * 格式规范见 docs/backup-format.md；往返不变式由 tests/backup.roundtrip.spec.ts 保证。
 */

import { z } from 'zod';

import type { BackupPackage } from '../types/dto';
import type {
  AssignmentLog,
  Execution,
  ExecutionAttempt,
  ExecutionEvent,
  StageLog,
  TaskArtifact,
  WritebackProposal,
} from '../types/entities';
import {
  ChangxiaError,
  ChangxiaErrorCode,
  MemberActorKind,
  ScheduleBasis,
  TaskStatus,
  type TaskSource,
} from '../types/enums';
import type { IRepositoryBundle } from '../repositories/interfaces';
import { recoverZombieExecutions } from '../execution/execution-recovery';
import { normalizeProjectRow, normalizeStageRow } from '../template/stage-fallback';

/**
 * 现行备份 schema 版本。
 * v1 = 老备份（缺阶段自定义字段）；v2 = 阶段自定义 + assigneeIds + roleKind + 密码；
 * v3 = v0.6 Agent 字段（Task 9 字段 + Member 2 字段 + status/done 归一，见 docs/backup-format.md）。
 */
export const BACKUP_SCHEMA_VERSION = 3;

/** 仍可导入的历史版本（导出恒为现行版本，绝不降级产出） */
const LEGACY_BACKUP_SCHEMA_VERSIONS = [1, 2] as const;

/* ------------------------------ zod 实体 schema ------------------------------ */

const isoString = z.string().min(1);
const nullableIso = isoString.nullable();
const dateLike = z.string().regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/);

/**
 * 项目 schema。三个新增字段用 `.optional()` + `.transform()` 而非裸 optional：
 * 老备份（v1）无这些字段 → 校验通过并显式补齐默认值（stagePresetKey=null /
 * stageTemplateVersion=0 / scheduleBasis=自然日），导入后 DB 行必有值，运行时不会 undefined。
 * 键序铁律：插在 coverColor 之后、status 之前（与 entities.Project / repo insert 三处同步）。
 */
const projectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    // 老备份（v0.7 及更早）仍带 `type` 字段（商务细分）→ 用 `.nullable().optional()` 宽收，
    // 导入后由 normalizeProjectRow 显式剥离（Project 实体自 v0.8 起已无 type 字段）。
    // 与下方 domain/kind 同一兜底手法：枚举字段一律 `z.string()` 宽收，保证旧客户端不被拒绝。
    type: z.string().nullable().optional(),
    address: z.string(),
    clientName: z.string(),
    contractAmount: z.number().nullable(),
    signedAt: nullableIso,
    plannedStartAt: dateLike,
    plannedEndAt: dateLike,
    coverColor: z.string().nullable(),
    /**
     * v0.7 侧栏方块简称。老备份（v1/v2/v3）无此字段 → `.optional()` + transform 补 null，
     * 与 coverColor / stagePresetKey 同一手法（读时回落，不做导入期数据改写）。
     */
    shortLabel: z.string().nullable().optional(),
    stagePresetKey: z.string().nullable().optional(),
    stageTemplateVersion: z.number().int().nonnegative().optional(),
    scheduleBasis: z.nativeEnum(ScheduleBasis).optional(),
    /**
     * v0.8 主板块。**用 `z.string()` 而非设计文档 §3.3 写的 `z.nativeEnum(...)`**——
     * `StageTemplateDomain`（`dto.ts:326`）是**字符串字面量联合类型**而不是 TS enum，
     * `z.nativeEnum()` 只吃 `enum` 对象，写上去直接**编译不过**。
     * 改用宽收也正合本文件既有策略：枚举字段一律 `z.string()`（见 `type` / `status`），
     * 保证将来新增行业值时旧客户端不被拒绝；窄化在 `normalizeProjectRow` 内完成。
     */
    domain: z.string().nullable().optional(),
    /**
     * v0.8 归属侧。同上用 `z.string()`：`ProjectKind` 是字面量联合（承载对外契约的
     * Agent 通道标记，刻意**不封闭**，与 `Member.agentKind` 同策略）。
     * 归一后恒有值（回落 DEFAULT_PROJECT_KIND）——故实体侧 `kind` 是必填。
     */
    kind: z.string().nullable().optional(),
    status: z.string(),
    revision: z.number().int().nonnegative(),
    updatedAt: isoString,
  })
  .transform(normalizeProjectRow);

/**
 * 阶段 schema。要点：
 *   1. orderIndex 上限 9 → 99 —— 否则阶段数 >9 的项目备份一导出就再也导不回来；
 *   2. templateKey / colorIndex 老备份缺失 → transform 内按 orderIndex 回落
 *      （templateKey 反查 indoor_full 套餐，colorIndex = clamp(orderIndex,1,9)）。
 * 键序铁律：两字段插在 orderIndex 之后、name 之前（与 entities.Stage / project.service 同步）。
 */
const stageSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    orderIndex: z.number().int().min(1).max(99),
    templateKey: z.string().nullable().optional(),
    colorIndex: z.number().int().min(1).max(9).optional(),
    /**
     * v0.8 用户自定义主色（#RRGGBB）。v0.8 前的备份没有这个键 → 可选，归一补 null。
     * 不收窄成 hex 正则：主色是**用户数据**，格式异常不该让整份备份导不回来
     * （与 `colorIndex` 越界走读时夹取同一取向——排版层有 `deriveStageColors` 兜底）。
     */
    customColor: z.string().nullable().optional(),
    name: z.string(),
    ratioPercent: z.number(),
    startAt: dateLike,
    endAt: dateLike,
    status: z.string(),
    ownerId: z.string().nullable(),
    visible: z.boolean(),
    resourcePath: z.string().nullable(),
    revision: z.number().int().nonnegative(),
    updatedAt: isoString,
  })
  .transform(normalizeStageRow);

/** 产出物 schema：对象数组逐字段归一（v3 新增；id 缺失 → 结构不符直接拒绝，不静默补） */
const artifactSchema = z.object({
  id: z.string(),
  kind: z.enum(['task_md', 'doc', 'file', 'diff', 'link', 'other']).default('other'),
  title: z.string(),
  path: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
});

/** normalizeTaskRow 的入参形状（= zod 解析产物；status 可缺省，由 transform 决定） */
export interface TaskRowInput {
  id: string;
  /** v0.7：老包经 `.default(null)` 归一后恒有该键（显式 null） */
  taskNo: number | null;
  projectId: string;
  stageId: string;
  title: string;
  done: boolean;
  assigneeId: string | null;
  assigneeIds: string[];
  dueDate: string | null;
  itineraryDate: string | null;
  source: TaskSource;
  externalId: string | null;
  agentId: string | null;
  status?: TaskStatus;
  description: string | null;
  dependsOn: string[];
  artifacts: TaskArtifact[];
  startAt: string | null;
  claimedAt: string | null;
  runId: string | null;
  orderIndex: number;
  revision: number;
  updatedAt: string;
}

/**
 * ★ status 用 `.optional()` + transform 而非 `.default('draft')`：
 *   v2 老备份没有 status，但有 done。若用 `.default('draft')`，done=true 的行会被
 *   归一成 draft → taskIsDone 仍返回 true（done===true 兜底），但看板会显示「草稿」，
 *   与「已完成」不符。必须由 done 推导。
 *
 * 键序铁律：v0.6 的 9 个新字段按 §3.1 序 9–17 插在 dueDate 后、orderIndex 前；
 * normalizeTaskRow 内**按 schema 键序重建对象**（与 normalizeProjectRow 同范式），
 * 否则 roundtrip 的 JSON.stringify 逐表 diff 会失败。
 */
const taskSchema = z
  .object({
    id: z.string(),
    /**
     * ★ v0.7：任务人读号。
     *
     * **必须 `.nullable().default(null)`** —— 不能用 `.optional()` / `.nullish()`：
     * 老备份（v3 及以前）根本没有该字段，而下面 `normalizeTaskRow` 需要拿到**显式
     * `null`** 才能把键落进重建对象。用 `.optional()` 时键会缺失 → 导出/导入键序
     * 不一致 → `backup.roundtrip` 的 `JSON.stringify` 逐表 diff 直接失败。
     *
     * ⚠️ `BACKUP_SCHEMA_VERSION` **保持 3，不 bump**：本轮只是追加一个可空字段
     * （`default(null)` 让 v3 老包照常可读）。bump 会让老客户端拒收新包，收益为零。
     *
     * 键序铁律：紧接 `id` 之后（与 `entities.Task` / `normalizeTaskRow` /
     * `local.tasks.repo.insert` / `project.service.taskRows` 五处逐字同序）。
     */
    taskNo: z.number().int().nullable().default(null),
    projectId: z.string(),
    stageId: z.string(),
    title: z.string(),
    done: z.boolean(),
    assigneeId: z.string().nullable(),
    // v0.3 新增：参与人全集。用 .default([]) 而非裸 optional——旧备份无该字段 → 归一 [] → 通过；
    // 且保证导入后 DB 行必有显式 assigneeIds（否则运行时 assigneeIds.length 读 undefined 抛错）。
    // 键序铁律：插在 assigneeId 之后、dueDate 之前（与 repo insert / project.service 默认字面量三处同步）。
    assigneeIds: z.array(z.string()).default([]),
    dueDate: z.string().nullable(),
    // 旅游二期新增：老备份缺失时归一为显式 null，保持任务键序与导出稳定。
    itineraryDate: z.string().nullable().default(null),
    // ↓↓↓ v0.6 Agent 新增（键序与 entities.Task 逐字对齐）↓↓↓
    source: z.enum(['human', 'agent']).default('human'),
    externalId: z.string().nullable().default(null),
    agentId: z.string().nullable().default(null),
    status: z.nativeEnum(TaskStatus).optional(), // ← 不给 .default()，由 transform 决定
    description: z.string().nullable().default(null),
    dependsOn: z.array(z.string()).default([]),
    artifacts: z.array(artifactSchema).default([]),
    startAt: z.string().nullable().default(null),
    claimedAt: z.string().nullable().default(null),
    // v0.8.2：runId 溯源元数据（老备份缺 → null；绝不进幂等键）
    runId: z.string().nullable().default(null),
    // ↑↑↑ v0.6 Agent 新增 ↑↑↑
    orderIndex: z.number().int(),
    revision: z.number().int().nonnegative(),
    updatedAt: isoString,
  })
  .transform(normalizeTaskRow);

/**
 * 任务行归一：done 由 status 反向对齐（消除历史不一致），并**按 schema 键序重建对象**。
 * 导入后恒有 `done === (status === 'done')`——即使老备份里两者矛盾。
 */
export function normalizeTaskRow(t: TaskRowInput): import('../types/entities').Task {
  const status = t.status ?? (t.done === true ? TaskStatus.Done : TaskStatus.Draft);
  return {
    id: t.id,
    // ★ v0.7：键序铁律第 2 处落点。老包经 `.default(null)` 归一 → 此处恒有显式 null，
    //   故导出/导入的键序逐字一致（roundtrip 的 JSON.stringify diff 才成立）。
    taskNo: t.taskNo,
    projectId: t.projectId,
    stageId: t.stageId,
    title: t.title,
    done: status === TaskStatus.Done, // ★ done 由 status 反推
    assigneeId: t.assigneeId,
    assigneeIds: t.assigneeIds,
    dueDate: t.dueDate,
    itineraryDate: t.itineraryDate,
    source: t.source,
    externalId: t.externalId,
    agentId: t.agentId,
    status,
    description: t.description,
    dependsOn: t.dependsOn,
    artifacts: t.artifacts,
    startAt: t.startAt,
    claimedAt: t.claimedAt,
    runId: t.runId,
    orderIndex: t.orderIndex,
    revision: t.revision,
    updatedAt: t.updatedAt,
  };
}

/**
 * 成员 schema：roleKind 用 z.enum([...]).default('member')（不是裸 optional）。
 * 旧备份无该字段 → undefined → 校验通过并归一为 'member'，保证导入后每行都有显式 roleKind
 * （否则 TS 类型要求必填，导入后行缺字段运行时 undefined）。
 *
 * passwordHash（v0.6 密码系统）：null=无密码（管理员决定成员可有/可无），
 * local 模式为 Web Crypto PBKDF2 hex，remote 模式为服务端 scrypt hex。绝不回传明文。
 * 老备份无该字段 → .nullable().default(null) 归一为 null，导入后行为与现状一致。
 */
const itineraryDaySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  date: z.string(),
  transport: z.string().nullable().default(null),
  accommodation: z.string().nullable().default(null),
  budgetAmount: z.number().nullable().default(null),
  actualAmount: z.number().nullable().default(null),
  revision: z.number().int().nonnegative(),
  updatedAt: isoString,
});

const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  contact: z.string().nullable(),
  avatarColor: z.string(),
  active: z.boolean(),
  roleKind: z.enum(['admin', 'member']).default('member'),
  passwordHash: z.string().nullable().default(null),
  // v0.6 Agent 新增（键序：passwordHash 后、revision 前，与 entities.Member / repo insert 同步）。
  // ★ agentKind 严禁 z.enum —— Harness 迭代极快，封闭结构会让每次接新 Agent 都要发版。
  actorKind: z.nativeEnum(MemberActorKind).default(MemberActorKind.Human),
  agentKind: z.string().nullable().default(null),
  revision: z.number().int().nonnegative(),
  updatedAt: isoString,
});

const assignmentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  projectId: z.string(),
  memberId: z.string().nullable(),
  action: z.string(),
  operatorName: z.string(),
  createdAt: isoString,
});

const stageLogSchema = z.object({
  id: z.string(),
  stageId: z.string(),
  projectId: z.string(),
  type: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  oldStartAt: nullableIso,
  newStartAt: nullableIso,
  oldEndAt: nullableIso,
  newEndAt: nullableIso,
  reason: z.string().nullable(),
  operatorName: z.string(),
  createdAt: isoString,
});

const contractSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  fileName: z.string().nullable(),
  rawTextDigest: z.string(),
  parsedResultJson: z.string(),
  confirmedPayloadJson: z.string().nullable(),
  createdByManual: z.boolean(),
  createdAt: isoString,
});

const settingSchema = z.object({
  key: z.string(),
  valueJson: z.string(),
  updatedAt: isoString,
});

/**
 * Agent 执行域四张表 schema（v5 第一切片）。
 *
 * 设计口径与既有表一致：旧备份（v1/v2/v3）**没有**这四张表 → 用 `.default([])` 安全默认，
 * 绝不整包拒绝（见规格「老备份没有这些字段时必须安全默认 []」）。
 * 字段级用 `z.string()` 宽收枚举（`status`/`type`/`source`/`actor` 等），防止将来新增枚举值
 * 时老客户端被拒；嵌套对象（`ExecutionConfirmation` / `WritebackOperation[]`）用 `z.any()`
 * 保留原值，往返不丢字段。
 */
const executionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  taskId: z.string().nullable(),
  source: z.string(),
  objective: z.string(),
  agentMemberId: z.string().nullable(),
  channelKind: z.string().nullable(),
  inputSnapshotHash: z.string().nullable(),
  status: z.string(),
  confirmation: z.any().nullable(),
  idempotencyKey: z.string(),
  currentAttemptNo: z.number().int(),
  createdAt: isoString,
  updatedAt: isoString,
  startedAt: nullableIso,
  finishedAt: nullableIso,
  terminalReason: z.string().nullable(),
  blockedReason: z.string().nullable(),
});

const executionAttemptSchema = z.object({
  id: z.string(),
  executionId: z.string(),
  attemptNo: z.number().int(),
  status: z.string(),
  runtimeKind: z.string().nullable(),
  startedAt: nullableIso,
  finishedAt: nullableIso,
  inputSnapshotHash: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorSummary: z.string().nullable(),
  terminalReason: z.string().nullable(),
  createdAt: isoString,
  updatedAt: isoString,
});

const executionEventSchema = z.object({
  id: z.string(),
  executionId: z.string(),
  attemptId: z.string().nullable(),
  seq: z.number().int(),
  type: z.string(),
  actor: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  reason: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  createdAt: isoString,
});

const writebackProposalSchema = z.object({
  id: z.string(),
  executionId: z.string(),
  attemptId: z.string().nullable(),
  projectId: z.string(),
  taskId: z.string().nullable(),
  operations: z.array(z.any()),
  status: z.string(),
  idempotencyKey: z.string(),
  decidedBy: z.string().nullable(),
  decidedAt: nullableIso,
  createdAt: isoString,
  updatedAt: isoString,
});

const backupSchema = z.object({
  meta: z.object({
    app: z.literal('changxia'),
    // 导入侧同时接受 v1 / v2 / v3（缺失时按现行版本归一）；导出恒为 BACKUP_SCHEMA_VERSION
    schemaVersion: z
      .union([
        z.literal(LEGACY_BACKUP_SCHEMA_VERSIONS[0]),
        z.literal(LEGACY_BACKUP_SCHEMA_VERSIONS[1]),
        z.literal(BACKUP_SCHEMA_VERSION),
      ])
      .default(BACKUP_SCHEMA_VERSION),
    exportedAt: isoString,
  }),
  data: z.object({
    projects: z.array(projectSchema),
    stages: z.array(stageSchema),
    tasks: z.array(taskSchema),
    itineraries: z.array(itineraryDaySchema).default([]),
    members: z.array(memberSchema),
    assignments: z.array(assignmentSchema),
    logs: z.array(stageLogSchema),
    contracts: z.array(contractSchema),
    settings: z.array(settingSchema),
    executions: z.array(executionSchema).default([]),
    executionAttempts: z.array(executionAttemptSchema).default([]),
    executionEvents: z.array(executionEventSchema).default([]),
    writebackProposals: z.array(writebackProposalSchema).default([]),
  }),
});

/** 导入前置校验（供测试直接调用）；结构不符抛 ChangxiaError，绝不半套写入 */
export function validateBackupJson(json: unknown): BackupPackage {
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      `备份文件结构校验失败：${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
      parsed.error,
    );
  }
  return parsed.data as BackupPackage;
}

/* --------------------------------- 服务本体 --------------------------------- */

export class BackupService {
  public constructor(private readonly bundle: IRepositoryBundle) {}

  /** 并行读全部表组装 BackupPackage（admin.fullExport 含 append-only 流水整表） */
  public async exportAll(): Promise<BackupPackage> {
    if (this.bundle.admin) {
      return this.bundle.admin.fullExport();
    }
    // 无 admin 通道时的降级路径：主表可导出，流水表置空并告警
    const b = this.bundle;
    const [projects, stages, tasks, itineraries, members, contracts, settings] = await Promise.all([
      b.projects.list({ status: 'all' }),
      this.listAllStages(),
      this.listAllTasks(),
      this.listAllItineraries(),
      b.members.list(true),
      b.contracts.list(),
      b.settings.all(),
    ]);
    return {
      meta: {
        app: 'changxia',
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
      },
      data: {
        projects,
        stages,
        tasks,
        itineraries,
        members,
        assignments: [],
        logs: [],
        contracts,
        settings,
        // 降级路径（无 admin 通道）：执行域四张表暂置空，导入端 zod 仍会 `.default([])` 兜底。
        executions: [],
        executionAttempts: [],
        executionEvents: [],
        writebackProposals: [],
      },
    };
  }

  /** 导入 = 校验 + 清库重建。结构不符直接拒绝（原子性由 admin.replaceAllImport 保证） */
  public async importAndReplace(pkg: BackupPackage): Promise<void> {
    // 1) 结构校验（含 roleKind 枚举归一）
    const normalized = validateBackupJson(pkg);
    if (!this.bundle.admin) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Storage,
        '当前数据源不支持备份导入。',
      );
    }
    // 2) 落库前组装：一律用 zod 归一产物，保证「老备份缺字段 → 落库后必有显式值」。
    //    - members：roleKind / actorKind / agentKind .default() 补齐（v0.2 / v0.6 范式）；
    //    - tasks：assigneeIds .default([]) 补齐（v0.3 范式）+ v0.6 九字段归一
    //      （status 缺省时由 done 推导，done 由 status 反向对齐——normalizeTaskRow）；
    //    - projects / stages（v2 范式）：stagePresetKey / scheduleBasis / templateKey /
    //      colorIndex 由 .transform() 补齐并**按 schema 键序重建对象**——
    //      该键序与 entities 定义、repo insert 字面量三处对齐，故 roundtrip 的
    //      JSON.stringify 逐表 diff 依然成立（键序铁律）。
    const data = {
      ...pkg.data,
      projects: normalized.data.projects,
      stages: normalized.data.stages,
      members: normalized.data.members,
      tasks: normalized.data.tasks,
      itineraries: normalized.data.itineraries,
      executions: normalized.data.executions,
      executionAttempts: normalized.data.executionAttempts,
      executionEvents: normalized.data.executionEvents,
      writebackProposals: normalized.data.writebackProposals,
    };
    await this.bundle.admin.replaceAllImport({ ...pkg, data });

    // 3) 僵尸态兜底（规格 §12 L223 第 1 条）：**备份恢复是整库替换，完全绕过状态迁移校验**，
    //    包里的 running / paused / needs_attention 执行单会原样落库。若不在这里收敛，
    //    「界面显示在跑、实际没人在跑」的假活态会一直挂到**下一次应用启动**才被清掉
    //    —— 而用户此刻正盯着这个界面（`useBackupIo` 恢复后 `window.location.reload()`）。
    //    调用**与启动装配点同一个** `recoverZombieExecutions`（无第二份实现）。
    //    非致命：收敛失败不得让一次成功的恢复变成「失败」（导入已落库，回滚不了），
    //    故吞掉异常 —— 下次启动仍会兜底，不存在永久漏网。
    try {
      await recoverZombieExecutions(this.bundle.executions, {
        projectIds: data.projects.map((p) => p.id),
      });
    } catch {
      // 见上：兜底是**尽力而为**的补位，不承担数据完整性责任（那是 replaceAllImport 的事务责任）
    }
  }

  /* --------------------------- 降级导出的跨项目聚合 --------------------------- */

  private async listAllStages() {
    const projects = await this.bundle.projects.list({ status: 'all' });
    const chunks = await Promise.all(
      projects.map((p) => this.bundle.stages.listByProject(p.id)),
    );
    return chunks.flat();
  }

  private async listAllTasks() {
    const projects = await this.bundle.projects.list({ status: 'all' });
    const chunks = await Promise.all(
      projects.map((p) => this.bundle.tasks.listByProject(p.id)),
    );
    return chunks.flat();
  }

  private async listAllItineraries() {
    const projects = await this.bundle.projects.list({ status: 'all' });
    const chunks = await Promise.all(
      projects.map((p) => this.bundle.itineraries.listByProject(p.id)),
    );
    return chunks.flat();
  }
}

/** 备份下载文件名（用户可见物）：改名 ID Plan 后前缀同步；内容校验走 meta.app，与文件名解耦 */
export function backupFileName(now: Date = new Date()): string {
  const ts = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `id-plan-backup-${ts}.json`;
}

/** 序列化下载（浏览器环境专用） */
export function downloadBackup(pkg: BackupPackage): void {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
  // ★ 挂载式 anchor + revoke 让出一拍。两点理由，请勿「顺手整理」回去：
  //
  //  (1) 挂载式 anchor 是标准做法（appendChild → click → removeChild），
  //      与用户真实点击行为一致。
  //
  //  (2) revoke 让出一拍属**防御性硬化，不是已证实的缺陷修复**：
  //      「紧跟 click 同步 revoke」理论上与下载启动存在竞态，但按规范，revoke 只是
  //      从 URL 映射表里摘除条目，**已持有 blob 引用的下载不受影响** —— 也就是说
  //      我们**从未观测到它真的坏过**。改成 setTimeout 0 成本为零、且是业界通行写法，
  //      故保留；但请勿把它当成「修好了一个 bug」引用。
  //      同一写法已同步到 log.service.ts / schedule-print.ts(×2) / HandoffPanel.tsx，
  //      它们同样是硬化，不是缺陷修复。
  //
  //  ⚠️ 切勿沿用「detached <a> 导致 Chromium 不发起可捕获下载」这个解释 —— 已被证伪：
  //     挂载式改法（commit ce74d9f）确已进包（可在 build-dist 里抠到
  //     appendChild→click→removeChild 字节），而实机走查 B3 依然恒红。
  //     B3 恒红的真因在**观测侧**：Electron 由主进程处理下载（打包形态实测会弹 OS 原生
  //     「另存为」对话框），Playwright 的 page 级 download 事件在 _electron 下收不到。
  //     现 B3 已改为从主进程观察 session 的 will-download（见 scripts/electron-funcwalk.mjs）。
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export type { AssignmentLog, StageLog };
