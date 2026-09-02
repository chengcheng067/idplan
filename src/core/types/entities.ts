/**
 * 实体形状唯一定义（所有实体均携带 revision+updatedAt 以支撑未来增量同步）。
 * 注意：一切时间字段均为 UTC ISO string（铁律 2），绝不出现 Date 对象。
 */

import {
  AssignmentAction,
  MemberRoleKind,
  ProjectStatus,
  ProjectType,
  RestPolicyKind,
  ScheduleBasis,
  StageLogType,
  StageStatus,
} from './enums';

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

/** 阶段任务条目 */
export interface Task {
  id: string; // tsk_xxx
  projectId: string;
  stageId: string;
  title: string;
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
  orderIndex: number;
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
