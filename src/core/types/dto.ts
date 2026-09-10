/**
 * 命令对象 / 数据传输对象（CreateXxxCmd / UpdateXxxCmd 集中定义）。
 * 命名规范见共享知识铁律 7：别处不得重复声明实体形状。
 */

import {
  AssignmentAction,
  Confidence,
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ProjectType,
  ScheduleBasis,
  StageLogType,
  StageStatus,
  TaskStatus,
  type TaskSource,
} from './enums';
import type { Member, Project, Stage, Task, TaskArtifact } from './entities';

/* ------------------------------------ 项目 ----------------------------------- */

/** 手动建档命令（先建空项目后补录合同的微调诉求） */
export interface CreateProjectCmd {
  name: string;
  type: ProjectType;
  address: string;
  clientName: string;
  contractAmount: number | null;
  signedAt: string | null;
  plannedStartAt: string; // ISO date 'YYYY-MM-DD'
  plannedEndAt: string;
  coverColor: string | null;
  /**
   * 建档所选阶段套餐 key（溯源/统计）。不传 → 由 service 按 stageItems 有无推导
   * （无 stageItems 视为默认 indoor_full 九段）。
   */
  stagePresetKey?: string | null;
  /** 建档时阶段模板库版本；不传 → service 取 getStageLibraryVersion() */
  stageTemplateVersion?: number;
  /** 排期基准；不传 → DEFAULT_SCHEDULE_BASIS（自然日，与改造前口径一致） */
  scheduleBasis?: ScheduleBasis;
  /**
   * 本次服务包含的阶段项（顺序即 orderIndex 1..N，1 ≤ N ≤ 12）。
   * 不传 → previewSplit 回落到全量九段模板（行为与改造前一致）。
   * 键序/双写口径：Project 侧不冗余存 key 列表，Stage 表是唯一事实源。
   */
  stageItems?: StageTemplateItem[];
}

/** 项目信息编辑命令（不含状态与日期切分，改期走 stage.service） */
export interface UpdateProjectCmd {
  name?: string;
  type?: ProjectType;
  address?: string;
  clientName?: string;
  contractAmount?: number | null;
  signedAt?: string | null;
  coverColor?: string | null;
  status?: ProjectStatus;
}

/** 合同建档的确认载荷（向导第三步「确认」后交给 ProjectService 的完整意图） */
export interface ConfirmedContractPayload {
  projectName: string;
  projectType: ProjectType;
  address: string;
  clientName: string;
  contractAmount: number | null;
  signedAt: string | null; // ISO datetime or date
  startAt: string;
  endAt: string;
  /** 阶段草案的覆写项（含可能的人工覆写），键为 orderIndex */
  stageOverrides: Record<number, StageOverride>;
  /** 建档所选套餐 key（溯源/统计）；不传 → null（未知套餐） */
  stagePresetKey?: string | null;
  /** 建档时阶段模板库版本；不传 → service 取 getStageLibraryVersion() */
  stageTemplateVersion?: number;
  /** 排期基准；不传 → DEFAULT_SCHEDULE_BASIS（自然日） */
  scheduleBasis?: ScheduleBasis;
  createdByManual: boolean;
  sourceFileName: string | null;
  rawTextDigest: string;
  parsedResultJsonSnapshot: string;
}

/* ------------------------------------ 阶段 ------------------------------------ */

/** 向导/切分阶段的覆写项 */
export interface StageOverride {
  name?: string;
  ratioPercent?: number;
  pinnedStartAt?: string | null;
  pinnedEndAt?: string | null;
  visible?: boolean;
}

/** 切分产出的阶段草稿（确认后才入库） */
export interface StageDraft {
  orderIndex: number;
  /** 模板项 key（溯源）；null=老数据兜底。键序与 Stage 实体对齐，可直接写入 Stage 行 */
  templateKey: string | null;
  /** 色号 1..9（取色/圆圈序号/阶段筛选）。键序与 Stage 实体对齐 */
  colorIndex: number;
  name: string;
  ratioPercent: number;
  startAt: string;
  endAt: string;
  status: StageStatus; // 恒为 not_started
  ownerId: string | null;
  visible: boolean;
  resourcePath: string | null;
  defaultTasks: string[];
}

/** 改期命令：必经 StageService.reschedule() 的闸门校验 */
export interface RescheduleStageCmd {
  newStartAt: string;
  newEndAt: string;
  /** 截止日后移（newEndAt>oldEndAt）时必填；提前/平移可空 */
  reason: string | null;
  operatorName: string;
}

/** 阶段字段级更新（抽屉内行内编辑；日期变更不允许绕过 reschedule） */
export interface UpdateStageCmd {
  name?: string;
  ratioPercent?: number;
  visible?: boolean;
  ownerId?: string | null;
  resourcePath?: string | null;
}

/* ------------------------------------ 任务 ------------------------------------ */

/**
 * 任务创建命令。
 *
 * v0.6 Agent 新增块（与 Task 实体的序 9–16 对应）。注意：`claimedAt` 不在本命令里
 * ——它是**活标记**（当前是否被持有）而非可指定的入参，只能由认领路径经
 * `repo.claim()` 写入；新建行恒为 `null`（见 §B-01）。`done` 亦不可写——
 * 它由 status 派生，见 entities.taskIsDone。
 */
export interface CreateTaskCmd {
  projectId: string;
  stageId: string;
  title: string;
  assigneeId: string | null;
  /** 参与人全集（可选；未传时 repo.insert 回落 [assigneeId]） */
  assigneeIds?: string[];
  dueDate: string | null;
  /** 任务来源；缺省由 repo 落 'human' */
  source?: TaskSource;
  /** 幂等键（Agent 导入路径必填，人工路径不传） */
  externalId?: string;
  /** 产出者 Agent 的 Member.id */
  agentId?: string | null;
  /** 初始状态；缺省 repo 落 TaskStatus.Draft */
  status?: TaskStatus;
  /** Markdown 正文 */
  description?: string | null;
  /** 同项目内前驱 Task.id */
  dependsOn?: string[];
  /** 产出物清单（对象数组） */
  artifacts?: TaskArtifact[];
  /** 任务级排期起点 */
  startAt?: string | null;
}

/**
 * 任务字段级更新命令。
 *
 * @deprecated 字段 `done`：v0.6 起 `done` 由 `status` 派生（唯一事实源 = `Task.status`），
 *   传 `done` 会被仓储做双向双写（done=true ⇔ status='done'）以兼容存量调用；
 *   新代码一律传 `status` 并经 `withStatus()` 构造。**绝不允许出现两者矛盾的写入。**
 */
export interface UpdateTaskCmd {
  title?: string;
  done?: boolean;
  assigneeId?: string | null;
  /** 参与人全集（可选；集合变化时 store 层写集合级 Change 流水） */
  assigneeIds?: string[];
  dueDate?: string | null;
  orderIndex?: number;
  /** 目标状态（v0.6 起 UI 手动流转必须走 task.service 的严格通道） */
  status?: TaskStatus;
  /** Markdown 正文 */
  description?: string | null;
  /** 同项目内前驱 Task.id */
  dependsOn?: string[];
  /** 产出物清单（对象数组） */
  artifacts?: TaskArtifact[];
  /** 任务级排期起点 */
  startAt?: string | null;
  /**
   * 认领时刻 —— **活标记**（当前是否被持有），不是历史痕迹。
   *
   * 一般调用方不要手工传：认领走 `repo.claim()`（单事务内校验 + 写入）。
   * 无论谁传，写入路径都会强制不变式
   * `status === 'ready'` ⟹ `claimedAt === null`（见 `entities.normalizeClaimedAt`），
   * 故**传 `status: 'ready'` 时本字段一律被清空**，无需调用方记得手动清。
   */
  claimedAt?: string | null;
}

/* ------------------------------------ 成员 ------------------------------------ */

export interface CreateMemberCmd {
  name: string;
  role: string;
  contact: string | null;
  avatarColor: string;
  /** 可选：默认 member（repo.insert 落默认值，外部调用方零改动） */
  roleKind?: MemberRoleKind;
  /**
   * 可选：成员初始明文密码（v0.6 密码系统）。
   * 各适配器自行解释——local：Web Crypto PBKDF2 哈希后存 Dexie；
   * remote：随 body 上送，由后端 crypto.scrypt 哈希后存 SQLite。绝不落明文于客户端。
   */
  password?: string;
  /** 行为体种类；缺省 repo 落 MemberActorKind.Human（存量调用方零改动） */
  actorKind?: MemberActorKind;
  /**
   * Agent 的 Harness 种类标识。**开放字符串，不做校验**（禁 z.enum / enum 封闭）。
   * 仅当 actorKind==='agent' 时有意义；人类成员落 null。
   */
  agentKind?: string | null;
}

export interface UpdateMemberCmd {
  name?: string;
  role?: string;
  contact?: string | null;
  avatarColor?: string;
  active?: boolean;
  /** 可选：提权/降级走 update(id, { roleKind: 'admin' })，接口层零新增 */
  roleKind?: MemberRoleKind;
  /**
   * 可选：设置/重置/清除密码（v0.6）。
   *   - string → 设为该明文密码（local 哈希存 Dexie；remote 上送后端 scrypt 哈希）；
   *   - null   → 清除密码（成员无需密码即可进入，管理员可决定成员可有无密码）；
   *   - undefined → 不变（缺省）。
   */
  password?: string | null;
  /** 行为体种类（提权为 Agent 身份 / 降级回人类，可经此处修改） */
  actorKind?: MemberActorKind;
  /**
   * Agent 的 Harness 种类标识。**开放字符串，不做校验**（禁 z.enum / enum 封闭）。
   * null → 清除（回人类身份）。
   */
  agentKind?: string | null;
}

/* ------------------------------------ 备份 ------------------------------------ */

/** 备份包结构（规范见 docs/backup-format.md，zod schema 见 backup.service.ts） */
export interface BackupPackage {
  meta: {
    app: 'changxia';
    /**
     * 1 = 老备份（无 stagePresetKey / templateKey / colorIndex / scheduleBasis）；
     * 2 = 现行版本（v0.5 阶段自定义 + assigneeIds + roleKind + 密码字段）；
     * 3 = v0.6 Agent 字段版本（Task 9 字段 + Member 2 字段 + status/done 归一）。
     * 导入侧同时接受 1 / 2 / 3，导出恒为 3（BACKUP_SCHEMA_VERSION）。
     */
    schemaVersion: 1 | 2 | 3;
    exportedAt: string;
  };
  data: {
    projects: Project[];
    stages: Stage[];
    tasks: Task[];
    members: Member[];
    assignments: import('./entities').AssignmentLog[];
    logs: import('./entities').StageLog[];
    contracts: import('./entities').ContractRecord[];
    settings: import('./entities').Setting[];
  };
}

/** 导入结果摘要（供 toast 与 diff 校验展示） */
export interface ImportResultSummary {
  projects: number;
  stages: number;
  tasks: number;
  members: number;
  assignments: number;
  logs: number;
  contracts: number;
  settings: number;
}

/* ------------------------------- 九阶段模板 ---------------------------------- */

/** templates/nine-stages.default.json 的类型化形状 */
export interface NineStagesTemplateFile {
  version: 1;
  stages: Array<{
    orderIndex: number;
    name: string;
    ratioPercent: number;
    defaultResponsibility: string;
    defaultTasks: string[];
  }>;
}

/* ------------------------------ 阶段模板库 ----------------------------------- */

/**
 * 阶段项所属专业领域。
 * exhibition 为 P1 预留（展陈阶段项尚未随版本发布），当前 items 中暂无该领域数据。
 * v2 起扩展出五个跨行业领域：软件 / 市场活动 / 影视 / 婚礼 / 咨询。
 */
export type StageTemplateDomain =
  | 'indoor'
  | 'landscape'
  | 'architecture'
  | 'exhibition'
  // v2 跨行业
  | 'software'
  | 'marketing'
  | 'film'
  | 'wedding'
  | 'consulting';

/**
 * 看板分桶列。
 *
 * v2 起不再枚举取值：列由各行业在 domains 段自带声明（见 StageDomain），
 * 新增行业或导入第三方模板时无需改动本类型。下面的字面量仅作阅读提示。
 * 历史的三个值（design/deepen/build）是室内/景观/建筑三个设计行业通用的列名。
 */
export type StageKanbanColumn = string;

/** 看板列定义（某行业的一条列） */
export interface StageColumn {
  /** 列键，阶段项的 kanbanColumn 引用本行业的列键 */
  key: string;
  /** 列显示名（如「设计中」「开发中」） */
  label: string;
  /**
   * 配色 token：pine / amber / mist / stage-s1..s9。
   * 这里只存 token 名而非 Tailwind 类名——模板是数据，不该携带 UI 框架的实现细节，
   * 由 UI 层（HomePage 的 TONE_CLASSES）映射为具体类名。
   */
  tone: string;
}

/** 行业定义：一个行业 = 一个中文名 + 一套看板列 */
export interface StageDomain {
  name: string;
  columns: StageColumn[];
}

/** 阶段模板项：阶段模板库的最小可选项（templates/stage-library.json 的 items 段） */
export interface StageTemplateItem {
  /** 稳定语义键，全局唯一，格式 领域.阶段 */
  key: string;
  /** 默认展示名（落库后用户可改名） */
  name: string;
  domain: StageTemplateDomain;
  /** 默认工作量占比，切分时按子集内归一化（见 split.ts previewSplit） */
  ratioPercent: number;
  /** 色号 1..9，取 STAGE_BAR_COLORS；与项目内 orderIndex 解耦 */
  colorIndex: number;
  kanbanColumn: StageKanbanColumn;
  defaultResponsibility: string;
  defaultTasks: string[];
  /**
   * 阶段时长（天，可选）。手动建档「阶段池自定义时长」时由表单层维护：
   * 填了则按此天数顺延算竣工（见 split.ts computeEndAtByDurations）；
   * 未填则回退按 ratioPercent 归一化。仅前端表单态传递，不落库。
   */
  durationDays?: number;
}

/** 阶段套餐：若干阶段项的有序组合（itemKeys 顺序即默认 orderIndex 顺序） */
export interface StagePreset {
  key: string;
  name: string;
  domain: StageTemplateDomain;
  description: string;
  itemKeys: string[];
}

/** templates/stage-library.json 的类型化形状 */
export interface StageTemplateLibraryFile {
  /**
   * v2：新增 domains 段，看板列由行业自带定义，UI 不再硬编码列名。
   * 升级时无需迁移——老数据只需补一段 domains（三个设计行业共用 design/deepen/build）。
   */
  version: 2;
  source: string;
  /** 行业键 → 行业定义（含看板列） */
  domains: Record<string, StageDomain>;
  items: StageTemplateItem[];
  presets: StagePreset[];
}

/* ------------------------------ 切分选项 ------------------------------------- */

export interface SplitOptionsInput {
  startAt: string;
  endAt: string;
  overrides?: Partial<Record<number, StageOverride>>;
}
