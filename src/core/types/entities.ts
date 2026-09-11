/**
 * 实体形状唯一定义（所有实体均携带 revision+updatedAt 以支撑未来增量同步）。
 * 注意：一切时间字段均为 UTC ISO string（铁律 2），绝不出现 Date 对象。
 */

import {
  AssignmentAction,
  MemberActorKind,
  MemberRoleKind,
  ProjectStatus,
  ProjectType,
  RestPolicyKind,
  ScheduleBasis,
  StageLogType,
  StageStatus,
  TaskStatus,
  type TaskSource,
} from './enums';

/**
 * 任务产出物（v0.6 · PRD §6.2 / AF-02）。
 * `artifacts` 是**对象数组**——序列化时绝不可经过任何
 * `filter(x => typeof x === 'string')` 的函数（会把对象元素静默清空），
 * 必须走通用 `serializeJson` / `parseJson`（见 docs/backup-format.md v3 章节）。
 */
export interface TaskArtifact {
  id: string; // art_xxx
  /**
   * 产出物种类。未知值归一为 'other'（前向兼容：将来新增种类时老数据不被拒绝）。
   * 注意：这是**封闭枚举**（前端渲染需要穷举图标），与 `Member.agentKind` 的
   * 开放字符串策略不同——后者是 Harness 名，迭代极快，禁止封闭。
   */
  kind: 'task_md' | 'doc' | 'file' | 'diff' | 'link' | 'other';
  title: string;
  /** 本地路径（浏览器沙箱内无法验证存在性，UI 降级为「复制路径」） */
  path: string | null;
  /** 外链 */
  url: string | null;
  /** 备注 */
  note: string | null;
}

/** 阶段任务条目 */
export interface Task {
  id: string; // tsk_xxx
  projectId: string;
  stageId: string;
  title: string;
  /**
   * ⚠️ **派生字段（v0.6 起降级）**：唯一事实源是 `status`，`done ≡ (status === 'done')`。
   * @deprecated 禁止直接读 `t.done`（含本字段的任何读取点），一律用 `taskIsDone(t)`；
   *   禁止单独写 `done`，一律用 `withStatus(row, next)` 或在仓储内 `done = status === 'done'` 双写。
   *   字段保留仅为兼容既有备份格式与老数据迁移。
   */
  done: boolean;
  /** 主负责人/兼容字段（保留）：UI 保存时自动同步为 assigneeIds[0] ?? null */
  assigneeId: string | null;
  /**
   * 参与人全集（v0.3 新增，必填）：写入路径统一默认 []。
   * 旧数据/旧备份无该字段 → zod .default([]) 归一 → 运行时 taskAssigneeIds() 回落 [assigneeId]，
   * 行为与 v0.2 完全一致（键序铁律：本字段插在 assigneeId 之后、dueDate 之前，与 taskSchema/repo insert 同步）。
   */
  assigneeIds: string[];
  /** 自然日截止日，YYYY-MM-DD 或 ISO datetime 均以 string 存库，可空 */
  dueDate: string | null;
  /* ------------------------- v0.6 Agent 新增块（序 9–17） ------------------------- */
  /**
   * 任务来源。键序铁律：下面 9 个字段在 entities / backup taskSchema /
   * local.tasks.repo.insert / project.service.taskRows **四处必须逐字同序**
   * （顺序即 §3.1 序 9–17：source → externalId → agentId → status → description →
   *   dependsOn → artifacts → startAt → claimedAt，位于 dueDate 后、orderIndex 前）。
   */
  source: TaskSource;
  /**
   * 幂等键，建议格式 `${agentKind}:${runId}:${localKey}`。
   * ⚠️ Dexie 侧人工任务**不写该键**（`null` 不是合法 IDB key，会干扰 `&externalId` 唯一索引）；
   * 序列化（备份导出）侧由 zod `.nullable().default(null)` 归一回 `null`，保证备份形状稳定。
   */
  externalId: string | null;
  /** 产出者 Agent 的 Member.id（人类任务为 null） */
  agentId: string | null;
  /** ★ 唯一事实源。7 值见 TaskStatus；老数据迁移：done=true→'done'，否则 'draft' */
  status: TaskStatus;
  /** Markdown 正文（承接 handoff bundle 的「上游留给你的话」） */
  description: string | null;
  /** 同项目内前驱 Task.id（跨项目引用在解引用阶段被剔除） */
  dependsOn: string[];
  /** 产出物清单（对象数组，序列化必须走 serializeJson） */
  artifacts: TaskArtifact[];
  /** 任务级排期起点（Timeline 画条用），UTC ISO string 或 'YYYY-MM-DD' */
  startAt: string | null;
  /**
   * 认领时刻（V1 的 TTL 回收用）。
   *
   * ⚠️ **语义 = 活标记「当前是否被持有」，不是历史事件痕迹**（B-01 订正）。
   *
   * 旧注释写的是「只在认领路径产生」，读起来像「曾认领过」的时间戳，于是写入侧
   * 从不回退它。但那与**两个消费方的实际读法**矛盾——三处都在问「**现在**是否
   * 被持有」：
   *   · `local.tasks.repo.claim()`  `claimedAt !== null` → Conflict（并发互斥）
   *   · `dag.computeReadyTasks()`   `claimedAt === null` 才是 Ready
   *   · `TaskDrawer.canClaim`       `claimedAt === null` 才允许点认领
   *
   * 而「释放」是**合法流转**（`Claimed → Ready` = 超时回收/主动释放；
   * `Blocked → Ready` = 解除受阻，见 `TASK_STATUS_TRANSITIONS`）。只写 status、
   * 不回退 claimedAt → 释放后留下 `status=ready ∧ claimedAt=<旧值>` 的僵尸行：
   * 谁也认领不了（Conflict）、也不在任何待办队列里（被 computeReadyTasks 排除）。
   *
   * 故本字段的**不变式**：
   *   `status === 'ready'` ⟹ `claimedAt === null`
   * 由 {@link normalizeClaimedAt} 在所有写入路径强制（前端仓储 + 服务端
   * PATCH/upsert 共用同一实现），规则文本只有一处。
   * 不改两个消费方语义的原因：改它们会破坏 claim 的并发互斥地基。
   */
  claimedAt: string | null;
  /* ------------------------------- v0.6 新增块结束 ------------------------------ */
  orderIndex: number;
  revision: number;
  updatedAt: string;
}

/**
 * ★ 全项目唯一「任务是否完成」入口（v0.6 起）。
 *
 * 禁用 `t.done` 直读的原因：迁移期与老备份导入后，`status` 与 `done` 可能短暂不一致，
 * 直接读 `done` 会与看板状态角标自相矛盾。这里以 `status` 为准，并对
 * 「status 缺失（Dexie 升级前的内存态 / 老备份 / 测试夹具）」保留 `done===true` 兜底。
 */
export function taskIsDone(t: Pick<Task, 'status' | 'done'>): boolean {
  return t.status === TaskStatus.Done || t.done === true;
}

/**
 * ★ 写入侧唯一「改状态」入口：任何写 status 的路径都必须经此构造，保证 done 不漂移。
 * 用法：`repo.put(withStatus(row, TaskStatus.Done))`。
 */
export function withStatus<T extends { status: TaskStatus; done: boolean }>(
  row: T,
  next: TaskStatus,
): T {
  return { ...row, status: next, done: next === TaskStatus.Done };
}

/**
 * ★ B-01 不变式的**唯一出处**：`status === 'ready'` ⟹ `claimedAt === null`。
 *
 * ── 为什么需要它 ──
 * `claimedAt` 是**活标记**（当前是否被持有，见 `Task.claimedAt` 注释）。而「回到
 * ready」不止「初始 ready」一条路，`TASK_STATUS_TRANSITIONS` 里**有三条边**都
 * 落在 ready：`Draft → Ready`、`Claimed → Ready`（释放/超时回收）、
 * `Blocked → Ready`（解除受阻）。后两条的上游必然已认领过 → `claimedAt` 非空。
 * 旧实现改 status 时从不回退它，于是产生僵尸行：
 *   · `claim()` 因 `claimedAt !== null` 判 Conflict → **没有任何 Agent 能接手**
 *   · `computeReadyTasks()` 因同一条件排除它 → 也不在任何待办队列里
 *   · `TaskDrawer.canClaim` 为 false → 认领按钮直接消失
 * 症状：界面看着「可开工」，实际无人能认领、也无处可查。v0.7 的核心卖点正是
 * 「认领 → 遇阻 → 释放 → 由另一 Agent 接手」，此 bug 把交接链掐断在第一步。
 *
 * ── 为什么是「字段级」函数（status + claimedAt 两个标量）──
 * 两侧行形状不同：前端是 camelCase `Task`（`claimedAt`），服务端是 snake_case
 * `TaskRow`（`claimed_at`）。只有「status 与该字段」这一对是双方共有的，
 * 行级函数无法同时服务两端。参数取 `string` 而非 `TaskStatus` 同理——
 * `TaskStatus` 是字符串枚举可赋给 `string`，而服务端 PATCH 拿到的是裸 string。
 *
 * 幂等：已是 `null` 时原值返回（不制造无意义的写入差异）。
 *
 * @param status 变更**之后**的 status（语义是「这个 status 配得上什么 claimedAt」）
 * @param claimedAt 候选 claimedAt（可能是 patch 带来的新值，也可能是存量值）
 * @returns 应落库的 claimedAt：`status === 'ready'` 时为 `null`，否则原样保留
 */
export function normalizeClaimedAt(
  status: string,
  claimedAt: string | null,
): string | null {
  return status === TaskStatus.Ready ? null : claimedAt;
}

/** 项目 */
export interface Project {
  id: string; // proj_xxx
  name: string;
  type: ProjectType;
  address: string;
  clientName: string;
  /** 元为单位整数金额，可空（后补录合同） */
  contractAmount: number | null;
  /** UTC ISO string，可空 */
  signedAt: string | null;
  plannedStartAt: string;
  plannedEndAt: string;
  /** 卡片封面色 token 名（cream/pine/amber/clay 系），可空 */
  coverColor: string | null;
  /**
   * 侧栏方块简称（v0.7 · 侧栏折叠态增强新增），可空。
   *
   * 用途单一：折叠态侧栏（64px）里那枚 40×36「项目方块」上的文字。
   * 展开态侧栏与其它所有视图一律显示 `name`，本字段不参与——避免同一侧栏里
   * 同一个项目出现「两个名字」，用户无从判断哪个是正式项目名。
   *
   * null / 空串 → **读时回落**「项目名首字」（`src/lib/projectAccent.ts` 的
   * `resolveProjectShortLabel`），故老数据无需任何迁移脚本即可正确显示；
   * 这也是与 `assigneeIds` / `roleKind` / `stagePresetKey` 一致的历史手法。
   *
   * 键序铁律：插在 `coverColor` 之后 —— 两者同为**外观类**字段，紧邻可读性最好。
   * 与下面四处必须逐字同序（漏一处 backup roundtrip 的逐表 JSON diff 就挂）：
   *   entities.Project / backup.service projectSchema /
   *   local.projects.repo insert 字面量 / stage-fallback.normalizeProjectRow
   */
  shortLabel: string | null;
  /**
   * 建档时所选阶段套餐 key（templates/stage-library.json 的 presets[].key）。
   * 仅作溯源与统计使用——**不冗余存阶段 key 列表**：Stage 表已是「本阶段集合」的
   * 唯一事实源，Project 侧再存一份必然产生双写不一致。老数据回落 null。
   */
  stagePresetKey: string | null;
  /** 建档时阶段模板库版本（将来模板升级的兼容判定用）；老数据回落 0（未知版本） */
  stageTemplateVersion: number;
  /**
   * 排期基准（自然日 / 工作日），项目级。默认自然日——
   * 与改造前口径逐字节一致，tests/stage-split.spec.ts 的自然日契约才不受影响。
   */
  scheduleBasis: ScheduleBasis;
  status: ProjectStatus;
  revision: number;
  updatedAt: string;
}

/**
 * 阶段（每项目 N 条：N = 建档时所选阶段数，1 ≤ N ≤ 12）。
 * orderIndex 是**项目内排序序号 1..N，连续无空缺**（不再是固定门牌号 1..9）——
 * stage.service 的 orderIndex+1 取下一段、TimelineView 的 orderIndex> 取后继段、
 * project.service 的 orderIndex===i+1 校验，全部依赖这个连续性。
 */
export interface Stage {
  id: string; // stg_xxx
  projectId: string;
  orderIndex: number;
  /**
   * 阶段模板项 key（templates/stage-library.json 的 items[].key）；null=老数据。
   * 老数据按 orderIndex 反查 indoor_full 套餐对应项（1..9 一一对应），见 stage-fallback.ts。
   */
  templateKey: string | null;
  /**
   * 色号 1..9：取 STAGE_BAR_COLORS / 圆圈序号 / 阶段筛选器，跨项目可比。
   * 与 orderIndex 解耦——老数据回落 clamp(orderIndex,1,9)，与改造前口径完全一致。
   */
  colorIndex: number;
  name: string;
  /** 设计工作量占比 %（项目级可覆写模板默认值） */
  ratioPercent: number;
  startAt: string;
  endAt: string;
  status: StageStatus;
  ownerId: string | null;
  /** false=隐藏（如纯设计项目隐藏交付段个案处理） */
  visible: boolean;
  /** 本地资料路径（F12 资料入口） */
  resourcePath: string | null;
  revision: number;
  updatedAt: string;
}

/** 成员（v0.6 支持密码登录，可选——管理员决定成员可有/可无密码） */
export interface Member {
  id: string; // mem_xxx
  name: string;
  role: string;
  contact: string | null;
  /** 头像底色 hex（仅头像底色场景允许 hex，来源仍集中在模板常量） */
  avatarColor: string;
  active: boolean;
  /** 角色（admin=设计师本人 / member=成员）；写入路径统一补默认值，运行时必有值 */
  roleKind: MemberRoleKind;
  /**
   * 密码哈希（可空，null=无密码）。
   * local 模式：Web Crypto PBKDF2-SHA256 派生的 hex（前缀 salt:hash），存在本地 Dexie，
   *   身份进入时由前端自行比对（单机版数据本就在用户机器上，无从也不需要隔离）；
   * remote 模式：**恒为 null** —— 服务端自 v0.6.1 起不再下发哈希，比对一律走
   *   POST /api/members/verify。两个模式都由 hasPassword 表达「是否设过密码」。
   * 仅存哈希，绝不落明文。
   */
  passwordHash: string | null;
  /**
   * 是否设置过登录密码（v0.6.1 新增）。
   * 为什么需要它、而不是直接用 Boolean(passwordHash)：remote 模式下服务端不再下发哈希，
   * passwordHash 恒为 null，前端就无法判断「这个成员进入时要不要弹密码框」——
   * 缺了这个字段会导致所有成员免密直入。故由服务端下发布尔值。
   * local 模式不填此字段，由 passwordHash 派生（见 memberHasPassword）。
   */
  hasPassword?: boolean;
  /* ----------------------- v0.6 Agent 新增块（2 字段） ----------------------- */
  /**
   * 行为体种类：Agent 是 Member 的一种（PRD §0.4-1），不新增顶层实体。
   * 键序铁律：与 `agentKind` 一起插在 `passwordHash` 之后、`revision` 之前，
   * 与 backup.service.memberSchema / local.members.repo.insert 三处同步。
   */
  actorKind: MemberActorKind;
  /**
   * Agent 的 Harness 种类标识（workbuddy / deepseek / codex / claude / copilot /
   * gemini / other …… 仅作 UI 下拉建议值，**不做任何校验**）。
   * ⚠️ 硬约束：这是**开放字符串**——Harness 迭代极快，任何 `enum` / `z.enum` /
   * `Record<AgentKind, …>` 的封闭结构都会导致每次接新 Agent 都要发版（PRD §0.5）。
   * 人类成员恒为 null。
   */
  agentKind: string | null;
  /* ----------------------------- v0.6 新增块结束 ---------------------------- */
  revision: number;
  updatedAt: string;
}

/**
 * 成员是否设过登录密码（跨 local / remote 两种数据源的统一判据）。
 * remote 模式服务端下发 hasPassword；local 模式无此字段，由本地哈希派生。
 * UI 判断「要不要弹密码输入框」一律走这里，不要直接读 passwordHash——
 * 否则 remote 模式下会永远判为「无密码」。
 */
export function memberHasPassword(m: Pick<Member, 'passwordHash' | 'hasPassword'>): boolean {
  return m.hasPassword ?? Boolean(m.passwordHash);
}

/** 任务指派流水（append-only，本期只写不读，F17 同步底座） */
export interface AssignmentLog {
  id: string; // log_xxx
  taskId: string;
  projectId: string;
  memberId: string | null;
  action: AssignmentAction;
  operatorName: string;
  createdAt: string;
}

/** 阶段变更流水（append-only：建档/改期/状态史） */
export interface StageLog {
  id: string; // log_xxx
  stageId: string;
  projectId: string;
  type: StageLogType;
  fromStatus: StageStatus | null;
  toStatus: StageStatus | null;
  oldStartAt: string | null;
  newStartAt: string | null;
  oldEndAt: string | null;
  newEndAt: string | null;
  /** rescheduled 且 newEndAt>oldEndAt 时必填（StageService 强制） */
  reason: string | null;
  operatorName: string;
  createdAt: string;
}

/** 合同识别存证（定稿后 parsedResultJson 不再修改——append-only 语义） */
export interface ContractRecord {
  id: string; // ctt_xxx
  /** 建档前解析可为空，建档后回链 */
  projectId: string | null;
  fileName: string | null;
  /** 原文 sha256 前 16 位摘要 */
  rawTextDigest: string;
  /** ContractParseResult 序列化 JSON */
  parsedResultJson: string;
  /** 用户最终确认的 payload JSON */
  confirmedPayloadJson: string | null;
  createdByManual: boolean;
  createdAt: string;
}

/** KV 设置表 */
export interface Setting {
  key: string;
  valueJson: string;
  updatedAt: string;
}

/**
 * 公司休息制度配置（settings 表 key='restPolicy'）。
 * 决定全系统排期的工作日口径——切分、改期、磁吸一律经由 src/lib/workdays.ts 消费。
 */
export interface RestPolicyConfig {
  kind: RestPolicyKind;
  /**
   * 大小休锚点周，格式 'YYYY-Www'（ISO 周，如 '2026-W35'）。
   * 仅 BigSmallWeek 有意义：该周为大休周（周六休息），其后逐周交替。
   * 双休/单休为 null。
   */
  anchorWeek: string | null;
  /** 法定节假日预留扩展点（MVP 不接数据）：命中即休息，优先级低于 extraWorkdays */
  extraHolidays?: string[];
  /** 调休上班日预留扩展点（MVP 不接数据）：命中即上班，优先级最高 */
  extraWorkdays?: string[];
}

/** 出厂默认：双休（与改造前的 businessdays.ts 口径完全一致） */
export const DEFAULT_REST_POLICY: RestPolicyConfig = {
  kind: RestPolicyKind.DoubleOff,
  anchorWeek: null,
};

/**
 * 出厂默认排期基准：自然日（Calendar）。
 * 硬约束——默认口径必须与改造前逐字节一致，现有 tests/stage-split.spec.ts 的自然日契约才不受影响。
 * 用户在建档时可切换为 Workday（项目级，存 Project.scheduleBasis）。
 */
export const DEFAULT_SCHEDULE_BASIS: ScheduleBasis = ScheduleBasis.Calendar;
