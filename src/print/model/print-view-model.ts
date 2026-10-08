/**
 * 四版打印模板 · 类型契约（02 文档 §2 照抄 + 视图模型形状）。
 *
 * ── 本文件为什么在 model/ 而不是组件层 ──
 * 02 文档 §1 的目录契约把「数据投影」与「视觉布局」分开：视图模型是**只读投影**，
 * 不把展示字段写回 Dexie。类型放在零依赖的 model 层，适配器（adapters/）、
 * 注册表（components/print/print-skins.ts）、store（usePrintPrefsStore）都能 import
 * 而不牵出 React / 组件。
 *
 * ── 权限口径（02 §3，实现见 adapters/project-print-adapter.ts）──
 * 装配顺序固定：角色 → computeRelatedStageIds() → visible !== false 过滤 →
 * clientName 仅 admin 进 VM（普通成员 VM 里是 undefined，**不是渲染层隐藏**）→
 * 派生统计（computeProjectPercent / computeStageTaskProgress 复用 lib/progress.ts）→
 * 页面模型。
 */

import type { ReactNode } from 'react';

import type { MemberActorKind, MemberRoleKind, StageStatus, TaskStatus } from '../../core/types/enums';
import type { StageLogType, TaskSource } from '../../core/types/enums';
import type { TaskArtifact } from '../../core/types/entities';
import type { ExecutionSource, ExecutionStatus, WritebackProposalStatus } from '../../core/types/agent-execution';

/** 模板 id（02 §2 四值 + default 纸面转正的 'classic'；决策文档 §2.3 迁移结论） */
export type PrintTemplateId =
  | 'classic'
  | 'swiss-schedule'
  | 'data-editorial'
  | 'editorial-index'
  | 'agent-poster';

/** 14 个页面种类（02 §2 照抄，一字不多一字不少） */
export type PrintPageKind =
  | 'stage-overview'
  | 'task-register'
  | 'delay-ledger'
  | 'member-roster'
  | 'progress-matrix'
  | 'dependency-network'
  | 'workload-composition'
  | 'milestone-acceptance'
  | 'stage-index'
  | 'member-index'
  | 'artifact-index'
  | 'agent-declaration'
  | 'execution-status'
  | 'writeback-proposals';

/** 页面定义（02 §2）。render 由 documents/ 侧持有——注册表只存元数据，不牵组件 */
export interface PrintPageDefinition {
  id: PrintPageKind;
  label: string;
  /** 默认启用（01 §8 明文：每套默认全选） */
  defaultEnabled: boolean;
  render: (vm: PrintViewModel) => ReactNode;
}

/** 文档定义（02 §2）。className 由 printTemplateClass(id) 提供（静态映射纪律） */
export interface PrintDocumentDefinition {
  id: PrintTemplateId;
  label: string;
  pageCount: 3 | 4;
  className: string;
  pages: PrintPageDefinition[];
}

/* ------------------------------------------------------------------ 视图模型 */

/** 观看者角色（VM 层口径；'member' 含未进入身份以外的全部非管理员） */
export type PrintViewerRole = 'admin' | 'member';

/** 项目投影。clientName **仅管理员有值**（02 §3 第 5 步） */
export interface PrintProjectVM {
  id: string;
  name: string;
  address: string;
  /** 仅 role === 'admin' 时进入 VM；普通成员恒为 undefined（不是渲染层隐藏） */
  clientName: string | undefined;
  plannedStartAt: string;
  plannedEndAt: string;
  scheduleBasisLabel: string;
  /** 项目完成度（已完成可见阶段数 / 可见阶段总数，0-100；复用 computeProjectPercent） */
  percent: number;
  /** 可见阶段总数 */
  visibleStageCount: number;
  /** 项目逾期：结束日早于今天且未全部完成（01 §3.3 口径一，无可打印原因） */
  projectOverdue: boolean;
  /** 今天（YYYY-MM-DD，VM 装配时注入，保证纯函数可测） */
  todayIso: string;
}

/** 阶段投影（已过 visible !== false 与可见范围过滤） */
export interface PrintStageVM {
  id: string;
  orderIndex: number;
  name: string;
  ratioPercent: number;
  startAt: string;
  endAt: string;
  status: StageStatus;
  /** 负责人姓名（ownerId 解析不到 → null） */
  ownerName: string | null;
  /**
   * 负责人成员 id（E 版 P1 判定「Agent 负责的阶段」用——按 id 精确解析
   * actorKind，不拿姓名猜；纯增量字段，权限语义零变化）。
   */
  ownerId: string | null;
  colorIndex: number;
  customColor: string | null;
  /** 阶段内任务完成度（复用 computeStageTaskProgress：done/total） */
  taskProgress: { done: number; total: number };
}

/** 任务投影（仅可见阶段下的任务） */
export interface PrintTaskVM {
  id: string;
  /** 人读号（null = 老数据；展示走 formatTaskNo，此处原样携带） */
  taskNo: number | null;
  title: string;
  status: TaskStatus;
  /** 负责人姓名列表（未指派 → []） */
  assigneeNames: string[];
  dueDate: string | null;
  /** 同项目内前驱 Task.id 原样集合（跨项目/不可见引用的化解由 D 版负责） */
  dependsOn: string[];
  /** 产出物数量（种类明细由 E 版消费，见 artifacts 字段） */
  artifactCount: number;
  /**
   * 产出物明细（种类 + 标题；**E 版 P3 产出物清单消费**）。
   *
   * ── 为什么加这个字段 ──
   * 地基首版只带计数，而 E P3 的口径是「产出物种类、关联任务、来源」逐行列出
   * （01 §6 P3）——没有明细，E P3 只能打出数字，版式要求做不到。故在此补
   * **纯增量**字段：只加不改，权限语义零变化（明细随任务过同一道可见性过滤，
   * 隐藏阶段/不可见任务的产出物同样不进 VM）。
   */
  artifacts: ReadonlyArray<{ kind: TaskArtifact['kind']; title: string }>;
  stageId: string;
  /** 任务逾期：dueDate < today 且 status !== done（01 §3.3 口径三） */
  overdue: boolean;
  source: TaskSource;
  /** 产出批次追溯（人类任务为 null） */
  runId: string | null;
}

/** 成员投影。agentKind 是**开放字符串**，未知值原样进入 VM（01 §3.2） */
export interface PrintMemberVM {
  id: string;
  name: string;
  role: string;
  roleKind: MemberRoleKind;
  actorKind: MemberActorKind;
  agentKind: string | null;
  /** 负责任务数（可见阶段下、被指派的任务数） */
  taskCount: number;
}

/** 阶段流水投影（仅可见阶段的日志；阶段延期才带 reason，01 §3.3） */
export interface PrintStageLogVM {
  id: string;
  stageId: string;
  stageName: string;
  type: StageLogType;
  oldEndAt: string | null;
  newEndAt: string | null;
  /** rescheduled 且 newEndAt > oldEndAt 时必填；其余类型为 null（禁造原因） */
  reason: string | null;
  operatorName: string;
  createdAt: string;
}

/** Agent 执行投影（H 版消费；A 版不渲染，VM 层照契约装载） */
export interface PrintExecutionVM {
  id: string;
  taskId: string | null;
  source: ExecutionSource;
  objective: string;
  agentName: string | null;
  status: ExecutionStatus;
  currentAttemptNo: number;
  runId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  terminalReason: string | null;
  blockedReason: string | null;
}

/** 写回提案投影（H 版消费；confidence 仅展示，01 §3.3） */
export interface PrintWritebackProposalVM {
  id: string;
  executionId: string;
  taskId: string | null;
  /** 字段级操作（field + before/after 原样） */
  operations: ReadonlyArray<{ field: string }>;
  status: WritebackProposalStatus;
  reason: string | null;
  confidence: number | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** 只读视图模型（02 §2 照抄） */
export interface PrintViewModel {
  project: PrintProjectVM;
  stages: readonly PrintStageVM[];
  tasks: readonly PrintTaskVM[];
  members: readonly PrintMemberVM[];
  stageLogs: readonly PrintStageLogVM[];
  executions: readonly PrintExecutionVM[];
  proposals: readonly PrintWritebackProposalVM[];
  generatedAt: string;
  viewerRole: PrintViewerRole;
}
