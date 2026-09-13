/**
 * Agent payload v1 契约（v0.6 · PRD 附录 A / 设计文档 §3.4）。
 *
 * 职责：
 *   - 定义 `idplan-agent-payload/v1` 的 TS 类型 + zod schema（本文件是唯一出处）；
 *   - `validateAgentPayload()` 是结构校验唯一入口，错误文案口径**逐字对齐**
 *     `backup.service.validateBackupJson`（`payload 校验失败：<path> <message>`）。
 *
 * 纪律（铁律 4/6）：本文件零 IO、零 repo import——纯类型与纯函数，
 * 由 `src/core/agent/payload.apply.ts`（T09）负责编排写库。
 */

import { z } from 'zod';

import { ChangxiaError, ChangxiaErrorCode, ProjectStatus, TaskStatus } from './enums';

export const AGENT_PAYLOAD_SCHEMA_ID = 'idplan-agent-payload/v1' as const;

/* ------------------------------- TS 类型 ------------------------------- */

/** payload 的产出者身份（溯源 + 幂等）。agentKind 是开放字符串，只校验非空。 */
export interface AgentPayloadProducer {
  actorKind: 'agent' | 'human';
  /** 开放字符串：workbuddy|deepseek|codex|claude|copilot|gemini|other…… */
  agentKind: string;
  agentName: string;
  runId: string;
}

/** payload 内嵌的产出物（落库时由 apply 层补 `art_<uuid>` 的 id） */
export interface AgentPayloadArtifact {
  kind: 'task_md' | 'doc' | 'file' | 'diff' | 'link' | 'other';
  title: string;
  path: string | null;
  url: string | null;
  note: string | null;
}

export interface AgentPayloadTask {
  /** 必填幂等键，建议格式 `${agentKind}:${runId}:${localKey}` */
  externalId: string;
  title: string;
  description: string | null;
  /** 缺省 draft */
  status: TaskStatus;
  /** 二者互斥优先级：assigneeHuman 优先于 assigneeAgentKind */
  assigneeAgentKind: string | null;
  assigneeHuman: string | null;
  /**
   * 引用**本批或历史** externalId；解引用失败 → 该条 rejected（code:'dep_unresolved'），
   * 不静默丢弃；跨项目引用一律解不到 → 同样 rejected。
   */
  dependsOnExternal: string[];
  startAt: string | null;
  dueDate: string | null;
  artifacts: AgentPayloadArtifact[];
}

export interface AgentPayloadV1 {
  schema: typeof AGENT_PAYLOAD_SCHEMA_ID;
  /** null = 未指定项目（apply 层拒绝或由 UI 引导选择） */
  projectId: string | null;
  /**
   * 可选：落到哪个批次；null → 落该项目 orderIndex 最大的可见批次。
   * ★ 绝不静默自动建 Stage；仅当导入请求显式声明落点阶段名（query `?stageName=`）
   *   且该项目无同名阶段时才创建。未声明 → 行为与 v0.6 逐字节一致。
   *   （用户 2026-09-09 拍板 / 设计文档 §10-R3：MAX_STAGE_COUNT 只在建档时校验、
   *   DB 层无约束，自动建会让反复导入静默造出 20+ Stage 拉垮 Timeline，且破坏
   *   orderIndex 1..N 连续无空缺的既有假设。）
   */
  stageId: string | null;
  producedBy: AgentPayloadProducer;
  tasks: AgentPayloadTask[];
}

/* ------------------------------ 写入结果 ------------------------------ */

/** 单条拒绝原因。code 为机器可读；reason 为可直接 toast 的中文。 */
export interface ApplyRejection {
  externalId: string;
  /** 机器可读原因码 */
  code: 'dep_unresolved' | 'cycle' | 'invalid_field' | 'conflict' | 'stage_limit';
  /** 用户可读中文 */
  reason: string;
}

/* ---------------------- 阶段落点（v0.7 · 契约冻结） ---------------------- */

/**
 * 本批最终落在哪个阶段 —— 四种互斥结果。
 *
 * | mode | 触发条件 | `id` |
 * | --- | --- | --- |
 * | `existing` | 落到**已存在**的阶段（`stageId` 指定命中，或缺省 → 最后一个可见批次） | 非空 |
 * | `planned` | **预览**中「将会新建」的阶段（dryRun 专用，尚未落库） | `null` |
 * | `created` | **已新建并落库**（仅 T02 在显式声明 `?stageName=` 且无同名阶段时产出） | 非空 |
 * | `none` | **无落点**：项目无可见批次且未声明落点阶段名 → 整批拒绝、零写入 | `null` |
 *
 * ★ 本批（T01 契约冻结）**只产出 `existing` 与 `none`**；
 *   `planned` / `created` 依赖「按名判重 + 新建分支」，属 **T02**，本批不产出
 *   （§10.2 裁定 A 引入第 4 值 `'none'`）。
 */
export type ApplyStageMode = 'existing' | 'planned' | 'created' | 'none';

/**
 * 新建阶段带来的连带效应（**仅供预览**渲染「完成度 62% → 56%」，§4.8）。
 *
 * ★ `statusBefore` / `statusAfter` 取 **ProjectStatus**（项目整体状态），
 *   不是 `StageStatus` —— 「项目整体完成 → 新建阶段后回进行中」是项目级语义
 *   （§2.4 L217 口径；§3.1.1 样本里的 StageStatus 是文档笔误）。
 */
export interface ApplyStageImpact {
  percentBefore: number;
  percentAfter: number;
  statusBefore: ProjectStatus;
  statusAfter: ProjectStatus;
}

/**
 * 落点阶段的解析结果。
 *
 * **R1**：`mode` / `id` / `name` / `orderIndex` **四键恒定** —— 无论成功、部分失败、
 * 全拒、无落点，键集合与顺序都不漂移。
 *
 * **R4（`id` 与 `mode` 自洽的四态表）**：`existing`/`created` → 非空；
 * `planned`/`none` → `null`。
 */
export interface ApplyStageResolution {
  mode: ApplyStageMode;
  /** `planned` / `none` → `null`（R4，不透支推断） */
  id: string | null;
  /** `none` → `''`（空串，不给例外） */
  name: string;
  /** `none` → `-1`（哨兵：仅 `'none'` 下出现，表示「无位置」，不是笔误） */
  orderIndex: number;
  /**
   * **可选属性，不是 `| null`**（R3：「无 impact」只能用「键不存在」表达，
   * 禁止 `null` / `{}`）。
   *
   * 出现 ⟺ `mode === 'planned' || mode === 'created'`（**R5 正向白名单**）。
   * ★ 不得写成 `mode !== 'existing'` —— 枚举一扩张就会把新取值误卷进来
   *   （新增 `'none'` 时已踩过一次）。
   */
  impact?: ApplyStageImpact;
}

/**
 * 导入请求的 query 契约（**typing only**；解析与校验属 T02）。
 *
 * - `stageName` 为主名，`createStageIfMissing` 为其**同义别名**；
 * - 空值 → `400 invalid_field`（**不静默降级**）；
 * - 与 `stageId` **互斥**。
 */
export interface AgentImportQuery {
  dryRun?: '1';
  projectId?: string;
  projectName?: string;
  stageId?: string;
  stageName?: string;
  createStageIfMissing?: string;
}

/**
 * 写入响应（PRD 附录 A 规则 4）：**形状恒定**，无论成功 / 部分拒绝 / 整批拒绝 /
 * 无落点，四个键永远存在且顺序不变。
 */
export interface ApplyResult {
  created: number;
  updated: number;
  rejected: ApplyRejection[];
  /** v0.7 恒定字段：本批最终落在哪个阶段（含「无落点」这一态） */
  stage: ApplyStageResolution;
}

/* ------------------------------ zod schema ------------------------------ */

const payloadArtifactSchema = z.object({
  kind: z.enum(['task_md', 'doc', 'file', 'diff', 'link', 'other']).default('other'),
  title: z.string().min(1),
  path: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
});

const payloadTaskSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.Draft),
  assigneeAgentKind: z.string().nullable().default(null),
  assigneeHuman: z.string().nullable().default(null),
  dependsOnExternal: z.array(z.string()).default([]),
  startAt: z.string().nullable().default(null),
  dueDate: z.string().nullable().default(null),
  artifacts: z.array(payloadArtifactSchema).default([]),
});

export const agentPayloadSchema = z.object({
  schema: z.literal(AGENT_PAYLOAD_SCHEMA_ID),
  projectId: z.string().nullable().default(null),
  stageId: z.string().nullable().default(null),
  producedBy: z.object({
    actorKind: z.enum(['agent', 'human']).default('agent'),
    // ★ 开放字符串，只校验非空。禁止 z.enum —— Harness 迭代极快，
    //   封闭结构会让每次接新 Agent 都要发版（PRD §0.5 / 设计文档 §3.2 硬约束）。
    agentKind: z.string().min(1),
    agentName: z.string().min(1),
    runId: z.string().min(1),
  }),
  tasks: z.array(payloadTaskSchema).min(1),
});

/**
 * 校验入口（供 store / UI 在落库前调用）。
 * 结构不符抛 `ChangxiaError(Validation)`，**绝不半套写入**；
 * 通过即返回已按 `.default()` 归一的完整 AgentPayloadV1（缺省字段显式存在）。
 */
export function validateAgentPayload(json: unknown): AgentPayloadV1 {
  const parsed = agentPayloadSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ChangxiaError(
      ChangxiaErrorCode.Validation,
      `payload 校验失败：${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
      parsed.error,
    );
  }
  return parsed.data as AgentPayloadV1;
}

/** 非抛错版校验（UI 需要逐条展示 issue 时用，避免先 catch 再拆结构） */
export function tryValidateAgentPayload(json: unknown):
  | { ok: true; payload: AgentPayloadV1 }
  | { ok: false; issues: Array<{ path: string; message: string }> } {
  const parsed = agentPayloadSchema.safeParse(json);
  if (parsed.success) return { ok: true, payload: parsed.data as AgentPayloadV1 };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    })),
  };
}
