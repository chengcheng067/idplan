/**
 * 备份服务：exportAll() → BackupPackage；importAndReplace() → zod 校验 + 清库重建。
 * 格式规范见 docs/backup-format.md；往返不变式由 tests/backup.roundtrip.spec.ts 保证。
 */

import { z } from 'zod';

import type { BackupPackage } from '../types/dto';
import type {
  AssignmentLog,
  StageLog,
  TaskArtifact,
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
    type: z.string(),
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
  source: TaskSource;
  externalId: string | null;
  agentId: string | null;
  status?: TaskStatus;
  description: string | null;
  dependsOn: string[];
  artifacts: TaskArtifact[];
  startAt: string | null;
  claimedAt: string | null;
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
    source: t.source,
    externalId: t.externalId,
    agentId: t.agentId,
    status,
    description: t.description,
    dependsOn: t.dependsOn,
    artifacts: t.artifacts,
    startAt: t.startAt,
    claimedAt: t.claimedAt,
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
    members: z.array(memberSchema),
    assignments: z.array(assignmentSchema),
    logs: z.array(stageLogSchema),
    contracts: z.array(contractSchema),
    settings: z.array(settingSchema),
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
    const [projects, stages, tasks, members, contracts, settings] = await Promise.all([
      b.projects.list({ status: 'all' }),
      this.listAllStages(),
      this.listAllTasks(),
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
      data: { projects, stages, tasks, members, assignments: [], logs: [], contracts, settings },
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
    };
    await this.bundle.admin.replaceAllImport({ ...pkg, data });
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
  a.click();
  URL.revokeObjectURL(url);
}

export type { AssignmentLog, StageLog };
