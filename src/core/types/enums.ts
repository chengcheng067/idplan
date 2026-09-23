/**
 * 全局枚举与错误码定义（core/types 唯一出处）。
 */

/** 数据源模式：local=IndexedDB(Dexie)，remote=REST(Fastify 预留) */
export type DataSourceMode = 'local' | 'remote';

/** 项目状态 */
export enum ProjectStatus {
  Active = 'active',
  Archived = 'archived',
}

/**
 * 项目**日历态**（月历/卡片色带与筛选口径，PRD §3.4 筛选、§4.2 颜色一一对应）。
 *
 * ★ v0.7 契约修订 R1：为 `ApplyStageImpact` 引入本定义并**收口到这里**。
 *
 * ── 为什么必须与 `ProjectStatus` 分开（两者不可互换）──
 * `ProjectStatus` 只有 `active | archived`，回答的是「这个项目在不在归档区」；
 * 本类型回答的是「这个项目现在处于排期的哪一阶段」。§3.1.1 样例 B/B′ 要求
 * `"statusBefore": "completed", "statusAfter": "in_progress"`，而 §8-V1-21 亦断言
 * `statusBefore === 'completed'` —— 一个 `active | archived` 的类型**不可能**同时成立。
 * v0.7 契约冻结时把 `ApplyStageImpact.statusBefore/After` 误记为 `ProjectStatus`，
 * 经主理人裁定按**验收口径**更正为本类型（R1）。
 *
 * ── 为什么定义在 enums 而不是留在 lib/progress ──
 * 它属于**契约**（`src/core/types/agent-payload.ts` 的 `ApplyStageImpact` 直接引用它），
 * 而 `lib/progress.ts` 是**派生层**。契约类型放在派生层会出现「契约 → 派生」的反向依赖，
 * 于是 `agent-payload.ts`（纯类型文件）被迫 import 一个 400 行的派生模块。
 * `lib/progress.ts` 改为从本文件 **re-export** —— 导出名与全部消费点零改动。
 */
export type ProjectCalendarStatus = 'in_progress' | 'completed' | 'overdue' | 'not_started';

/** 阶段四态流转：未开始 → 进行中 → 已完成；延期可自任意态进入（重置回未开始亦允许） */
export enum StageStatus {
  NotStarted = 'not_started',
  InProgress = 'in_progress',
  Completed = 'completed',
  Delayed = 'delayed',
}

/** 全部阶段状态集合（遍历渲染/校验用） */
export const ALL_STAGE_STATUSES: readonly StageStatus[] = [
  StageStatus.NotStarted,
  StageStatus.InProgress,
  StageStatus.Completed,
  StageStatus.Delayed,
];

/** 合同解析字段置信度三档 */
export enum Confidence {
  High = 'high',
  Mid = 'mid',
  Low = 'low',
}

/**
 * ⛔ 这里曾有 `ProjectType` 枚举与 `PROJECT_TYPE_LABELS`（餐饮/茶空间/书店/民宿/零售 +
 * 室内设计/景观设计/建筑设计/展陈设计 …），2026-09-17 **整块删除**，不要加回来。
 *
 * ── 为什么删 ──
 * 它把**两套互不相干的分类法混在一个字段里**：前半是业态（餐饮/民宿…），后半是设计专业
 * （室内/景观…）。用户在真机上看到的就是它的直接后果 —— 建档弹窗里「行业」已经选了
 * 「建筑设计行业 / 室内」，而「类型」下拉却默认停在「餐饮」（`ManualFallbackForm` 默认
 * `Dining`，与三层级联的默认 `indoor` 各自独立、互不相干）。
 *
 * 它的分类职责已由 v0.8 的**三层分类**（行业大类 → 主板块 → 关联板块，见
 * `core/template/stage-library.ts` 与 `Project.domain`）完全取代；
 * 它唯一还活着的职能「决定弹窗初始阶段池」已迁到**主板块**：
 * 见 `StageSelectPanel.defaultPresetKeyForDomain`。
 *
 * 现在投影/详情页显示的是**主板块名**（`domainLabel(effectiveDomainOf(project))`）。
 * 删字段的兼容处理见 `backup.service.ts` 的项目 schema（宽收 + 显式剥离）
 * 与 `tests/backup.legacy-compat.spec.ts` 的「含 type 的老备份仍可导入」三条用例。
 */

/**
 * 项目归属侧（v0.8 新增）：人类工作区 / Agent 工作区。
 *
 * 为什么是**字符串字面量联合**而不是 `enum`：`kind` 是对外契约——它会出现在
 * 备份 JSON、服务端 `projects.kind` 列、以及 Agent 通道的 payload 里，必须与字符串
 * 稳定对应。本项目同类开放标记（`Member.agentKind`、`TaskSource`）已确立该风格。
 *
 * 隔离语义：`'agent'` 的项目只出现在 Agent 工作区，**绝不出现在**首页看板 / 月历 /
 * 我的任务 / 成员看板 / 打印稿（见 v0.8 设计文档 §7 单一谓词出口）。
 * 老数据（无该列）回落 `DEFAULT_PROJECT_KIND`，即全部项目仍显示在人类侧。
 */
export type ProjectKind = 'human' | 'agent';

/** 出厂默认归属侧。⚠️ **绝不改为 'agent'** —— 老库无该列时必须落回人类侧。 */
export const DEFAULT_PROJECT_KIND: ProjectKind = 'human';

/**
 * 读时回落：`Project.kind` ⇒ `'human' | 'agent'`。**唯一允许判 kind 的地方。**
 *
 * 只认**字面量** `'agent'`，其余（`undefined` / `null` / 脏值）一律按人类侧处理。
 *
 * 为什么不写成 `p.kind ?? DEFAULT_PROJECT_KIND`（那样脏值会原样透出成一个非法 kind）：
 *   ① **与 T01 的落库口径一致** —— `normalizeProjectRow` 对缺列就是落 `'human'`，
 *      老备份导入后 kind 一定是 `'human'`，不会停留在 `undefined`；
 *   ② **两种"猜错"的代价不对称**，这里选代价小的那个：
 *      · 脏值（如手工改库写成 `'agentt'`）按人类侧 ⇒ 多出一个可见的 Agent 看板，
 *        **看得见、能改**；
 *      · 若是把"其实不是 agent 的东西"当中 agent ⇒ 项目从人类侧**凭空消失**，
 *        用户会以为数据丢了，**看不见、难排查**。
 *
 * ── 为什么实现落在 enums 而不是 visibility（2026-09-24 迁移）──
 * 服务端（server/routes、sqlite.bundle）需要同一口径判 kind，而 visibility.ts
 * 经 import 图带上 react/zustand store，**服务端 tsconfig 不能纳入**。把实现放在
 * 零依赖的 enums（types 层，两端 tsconfig 都已纳入）后，服务端与共享核心、渲染侧
 * 共用同一份判定；visibility.ts 保留 re-export，既有消费方零改动。
 * 纪律不变：**判 kind 只准调本函数**（就地写 `kind === 'agent'` 一律视为违规）。
 */
export function projectKindOf(p: { kind?: ProjectKind | null } | null | undefined): ProjectKind {
  return p?.kind === 'agent' ? 'agent' : DEFAULT_PROJECT_KIND;
}

/** 公司休息制度（决定排期的工作日口径） */
export enum RestPolicyKind {
  /** 双休：周六 + 周日休息 */
  DoubleOff = 'double_off',
  /** 单休：仅周日休息 */
  SingleOff = 'single_off',
  /** 大小休：周日固定休息，周六按周交替（大休周休息、小休周上班） */
  BigSmallWeek = 'big_small_week',
}

/** 休息制度展示名映射（唯一 UI 文案源，铁律 7） */
export const REST_POLICY_LABELS: Record<RestPolicyKind, string> = {
  [RestPolicyKind.DoubleOff]: '双休',
  [RestPolicyKind.SingleOff]: '单休',
  [RestPolicyKind.BigSmallWeek]: '大小休',
};

/** 全部休息制度集合（遍历渲染/校验用） */
export const ALL_REST_POLICIES: readonly RestPolicyKind[] = [
  RestPolicyKind.DoubleOff,
  RestPolicyKind.SingleOff,
  RestPolicyKind.BigSmallWeek,
];

/**
 * 排期基准（**项目级**属性，与公司级 RestPolicyConfig 正交，切勿合并）：
 * 决定「工期 N 天」中的「天」按什么口径切分阶段。
 *   - Calendar：自然日（日历天），默认。合同写 90 天就是 90 个日历天，竣工日不后延。
 *   - Workday：工作日，按 RestPolicyConfig 跳过休息日。
 *     同样「90 天」= 90 个工作日，实际日历跨度会拉长约 40%，竣工日后延。
 *
 * 默认 Calendar 是硬约束：现有 tests/stage-split.spec.ts 锁死自然日契约，
 * 默认口径必须与其逐字节一致，否则老项目与既有断言全部受影响。
 */
export enum ScheduleBasis {
  /** 自然日（日历天，默认） */
  Calendar = 'calendar',
  /** 工作日（按休息制度跳过休息日） */
  Workday = 'workday',
}

/** 排期基准展示名映射（唯一 UI 文案源，铁律 7） */
export const SCHEDULE_BASIS_LABELS: Record<ScheduleBasis, string> = {
  [ScheduleBasis.Calendar]: '按自然日',
  [ScheduleBasis.Workday]: '按工作日',
};

/** 全部排期基准集合（遍历渲染/校验用） */
export const ALL_SCHEDULE_BASIS: readonly ScheduleBasis[] = [
  ScheduleBasis.Calendar,
  ScheduleBasis.Workday,
];

/** 成员角色（无密码信任模型）：admin=设计师本人（系统所有者），member=被指派的执行者 */
export enum MemberRoleKind {
  Admin = 'admin',
  Member = 'member',
}

/** 成员角色展示名映射（唯一 UI 文案源，铁律 7） */
export const MEMBER_ROLE_LABELS: Record<MemberRoleKind, string> = {
  [MemberRoleKind.Admin]: '管理员',
  [MemberRoleKind.Member]: '成员',
};

/** 任务指派流水动作 */
export enum AssignmentAction {
  Assign = 'assign',
  Unassign = 'unassign',
  Change = 'change',
}

/** 阶段流水类型 */
export enum StageLogType {
  Created = 'created',
  Rescheduled = 'rescheduled',
  StatusChanged = 'status_changed',
}

/**
 * 任务来源（v0.6 Agent 任务排期）。
 *   - human：人工在 App 内建立的任务（存量数据全部归此类）；
 *   - agent：由 Agent payload 导入产出的任务。
 * 用开放的字符串联合而非新增实体：Agent 本身就是一种 Member（PRD §0.4-1），
 * 不新增顶层实体（守全行业原则）。
 */
export type TaskSource = 'human' | 'agent';

/** 全部任务来源集合（遍历渲染/校验用） */
export const ALL_TASK_SOURCES: readonly TaskSource[] = ['human', 'agent'];

/**
 * 任务状态（v0.6 · PRD §4.4）。
 * ★ `Task.status` 是「是否完成」的唯一事实源；`Task.done` 降级为派生字段
 *   （读取一律走 `taskIsDone()`，写入一律走 `withStatus()`）。
 */
export enum TaskStatus {
  Draft = 'draft',
  Ready = 'ready',
  Claimed = 'claimed',
  InProgress = 'in_progress',
  Blocked = 'blocked',
  Review = 'review',
  Done = 'done',
}

/** 全部任务状态集合（遍历渲染 7 列看板用） */
export const ALL_TASK_STATUSES: readonly TaskStatus[] = [
  TaskStatus.Draft,
  TaskStatus.Ready,
  TaskStatus.Claimed,
  TaskStatus.InProgress,
  TaskStatus.Blocked,
  TaskStatus.Review,
  TaskStatus.Done,
];

/** 任务状态展示名映射（唯一 UI 文案源，铁律 7） */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.Draft]: '草稿',
  [TaskStatus.Ready]: '就绪',
  [TaskStatus.Claimed]: '已认领',
  [TaskStatus.InProgress]: '进行中',
  [TaskStatus.Blocked]: '受阻',
  [TaskStatus.Review]: '待验收',
  [TaskStatus.Done]: '已完成',
};

/**
 * 合法流转白名单（PRD §4.4 状态图的代码化，共 9 条边）。
 *
 * 纪律：
 *   - `task.service.assertTransition()` 是**严格通道**（UI 手动改状态必须走它）；
 *   - payload 导入走**宽松通道**（直落 Agent 给定的 status，因为上游 Agent 是事实源）；
 *   - 本期不新增错误码：非法流转复用 `Validation`，claim 冲突复用 `Conflict`。
 */
export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  [TaskStatus.Draft]: [TaskStatus.Ready],
  // Ready → Claimed 是唯一出口：Ready 语义是「可被认领的下一步」
  [TaskStatus.Ready]: [TaskStatus.Claimed],
  // Claimed → Ready = 超时回收 / 主动释放
  [TaskStatus.Claimed]: [TaskStatus.InProgress, TaskStatus.Ready],
  [TaskStatus.InProgress]: [TaskStatus.Blocked, TaskStatus.Review],
  [TaskStatus.Blocked]: [TaskStatus.Ready],
  // Review → Claimed = 打回重做
  [TaskStatus.Review]: [TaskStatus.Done, TaskStatus.Claimed],
  [TaskStatus.Done]: [],
};

/**
 * 成员行为体种类（v0.6）：Agent 是 Member 的一种，不新增顶层实体。
 *   - human：人类成员（存量数据全部归此类）
 *   - agent：Agent 身份（占 Agent 席位，见 PRD 附录 C）
 */
export enum MemberActorKind {
  Human = 'human',
  Agent = 'agent',
}

/** 全部行为体种类集合（遍历渲染/校验用） */
export const ALL_MEMBER_ACTOR_KINDS: readonly MemberActorKind[] = [
  MemberActorKind.Human,
  MemberActorKind.Agent,
];

/** 行为体种类展示名映射（唯一 UI 文案源，铁律 7） */
export const MEMBER_ACTOR_KIND_LABELS: Record<MemberActorKind, string> = {
  [MemberActorKind.Human]: '人类',
  [MemberActorKind.Agent]: 'Agent',
};

/**
 * 统一业务错误码。
 * 仓储层任何失败抛 ChangxiaError{code,userMessage}；REST client 将网络/HTTP
 * 错误翻译为同一类型（共享知识铁律 5），上层只 catch 一个类。
 */
export enum ChangxiaErrorCode {
  NotFound = 'not_found',
  Validation = 'validation',
  Conflict = 'conflict',
  Storage = 'storage',
  Network = 'network',
  ParseFailed = 'parse_failed',
  Cancelled = 'cancelled',
  /**
   * Agent 导入落点不可解析（2026-09-24 新增）：id 不存在、或存在但 kind 非 agent。
   *
   * 为什么单立一码而不是复用 Validation：这是**对外契约码**——接入文件/指令块
   * 向写入方承诺「人类项目一律拒绝（project_unresolved）」，写入方（如 WorkBuddy）
   * 按码分支（打错 id vs 打错归属 vs 参数格式错）。服务端路由此前直接返回该字面量
   * 码，但共享核心（payload.apply.resolve）没有对应枚举 ⇒ 桌面通道压根没这道门
   * （实测报告 9.2：dryRun 打人类项目全放行）。补码后两通道同源抛此错。
   */
  ProjectUnresolved = 'project_unresolved',
}

/** 统一业务异常：上层只需捕获此类型并向 toast 展示 userMessage */
export class ChangxiaError extends Error {
  public readonly code: ChangxiaErrorCode;
  /** 可直接展示给用户的中文文案（为空时 UI 回落到兜底文案） */
  public readonly userMessage: string;

  constructor(code: ChangxiaErrorCode, userMessage: string, cause?: unknown) {
    super(`[changxia:${code}] ${userMessage}`);
    this.name = 'ChangxiaError';
    this.code = code;
    this.userMessage = userMessage;
    if (cause !== undefined) {
      // 现代运行环境支持 cause 透传，兼容性不足时静默忽略
      try {
        (this as { cause?: unknown }).cause = cause;
      } catch {
        /* 忽略 */
      }
    }
  }
}
