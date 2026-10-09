/**
 * 通用渲染 · 三模块共用的小工具（期三「外表 × 模块分离」第一批：
 * M1 阶段清单 / M2 任务清单 / M4 成员名册；产品决策文档 §3.2 候选 3 /
 * §3.5 期三 v1.5-b）。
 *
 * ── 通用模块是什么 ──
 * 4 套模板 = 4 种排版外表；11 个内容模块跨模板可选。外表的**原生页**
 * （pages/<template>/，标志布局）之外，其余模块用该外表的**基础排版**
 * 渲染——字体阶 / 色板 / 密度 / 表格形态走各版 CSS（generic-modules.css
 * 的 per-template 块），**不套标志布局**（A 的三栏错落时刻表、H 的出血
 * 巨字 + 中轴是原生专属，通用模块不碰）。
 *
 * ── 为什么状态字形在这里再持一份 ──
 * A/D/E 各自在组件里自持 STAGE_GLYPH（01 §1：四版组件独立）。通用模块
 * 是**第五套组件家族**（跨外表复用同一份内容组件），不隶属任何一版，
 * 故自持一份——值与四版一致（□◐●▲，灰度可辨的形状双编码）。
 *
 * ── 分页估高纪律（与 E 版 paginateEiEntries 同源） ──
 * 通用模块进分页体系：行估高 + 每物理页可用高度都是**纯函数常量**，
 * 估高只允许偏保守（大）——偏大 = 早分页白留一截，偏小 = 内容溢出
 * 纸面（794×1123 断言即红）。视觉 spec 用真 Chromium 复核实际行高，
 * 实测超出估高时回调常量（只许往大调）。
 */

import type { PrintTemplateId } from '../../../components/print/print-skins';
import type { PrintModuleId } from '../../../components/print/print-skins';
import { formatTaskNo } from '../../../core/lib/task-no';
import { MemberActorKind, StageStatus, TASK_STATUS_LABELS, TaskStatus } from '../../../core/types/enums';
import type { PrintMemberVM, PrintStageVM, PrintTaskVM, PrintViewModel } from '../../model/print-view-model';

/** 通用模块页题（中英双语刊头；与四版原生页题同一版式语言） */
export const GENERIC_TITLES: Record<'stage-list' | 'task-list' | 'member-roster', { cn: string; en: string }> = {
  'stage-list': { cn: '阶段清单', en: 'STAGE LIST' },
  'task-list': { cn: '任务清单', en: 'TASK LIST' },
  'member-roster': { cn: '成员名册', en: 'MEMBER ROSTER' },
};

/** 阶段四态标签（全仓无既有中文出处，打印纸面专用；与四版自持副本同值） */
export function stageStatusLabel(status: StageStatus): string {
  switch (status) {
    case StageStatus.InProgress:
      return '进行中';
    case StageStatus.Completed:
      return '已完成';
    case StageStatus.Delayed:
      return '延期';
    default:
      return '未开始';
  }
}

/** 阶段四态字形（灰度可辨：实心 / 半满 / 空心 / 三角；颜色只是第三重编码） */
export const STAGE_GLYPH: Record<StageStatus, string> = {
  [StageStatus.NotStarted]: '□',
  [StageStatus.InProgress]: '◐',
  [StageStatus.Completed]: '●',
  [StageStatus.Delayed]: '▲',
};

/** 任务七态中文标签（复用全仓唯一出处 TASK_STATUS_LABELS） */
export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

/* ------------------------------------------------------------------ 行视图模型 */

/** M1 行：序号 / 阶段名 / 四态 / 计划日期 / 占比 / 负责人 */
export interface StageListRow {
  key: string;
  /** 补零 orderIndex（'01'） */
  no: string;
  name: string;
  status: StageStatus;
  startAt: string;
  endAt: string;
  ratioPercent: number;
  ownerName: string | null;
}

/** M2 行：读号 / 任务标题 / 七态 / 负责人 / 产出物数；逾期双编码（文字 + 加重） */
export interface TaskListRow {
  key: string;
  /** formatTaskNo 之后的读号（老数据无号 ⇒ '—'） */
  no: string;
  title: string;
  status: TaskStatus;
  assigneeNames: readonly string[];
  artifactCount: number;
  overdue: boolean;
}

/** M4 行：姓名 / 类型 / agentKind / 角色 / 负责任务数 */
export interface MemberRosterRow {
  key: string;
  name: string;
  isAgent: boolean;
  agentKind: string | null;
  role: string;
  taskCount: number;
}

/** M1 行序列（按 orderIndex；VM 已过 visible 过滤，这里不重算权限） */
export function buildStageListRows(vm: PrintViewModel): StageListRow[] {
  return vm.stages.map((s: PrintStageVM) => ({
    key: s.id,
    no: String(s.orderIndex).padStart(2, '0'),
    name: s.name,
    status: s.status,
    startAt: s.startAt,
    endAt: s.endAt,
    ratioPercent: s.ratioPercent,
    ownerName: s.ownerName,
  }));
}

/** M2 行序列（VM 序 = taskNo 序，老数据无号沉底；适配器已排，这里不重排） */
export function buildTaskListRows(vm: PrintViewModel): TaskListRow[] {
  return vm.tasks.map((t: PrintTaskVM) => ({
    key: t.id,
    // 读号走 formatTaskNo（全仓唯一出处）：null ⇒ '—'，>9999 自然进位不截断
    no: formatTaskNo(t.taskNo),
    title: t.title,
    status: t.status,
    assigneeNames: t.assigneeNames,
    artifactCount: t.artifactCount,
    overdue: t.overdue,
  }));
}

/** M4 行序列（VM 序；agentKind 开放字符串原样携带，不收敛枚举） */
export function buildMemberRosterRows(vm: PrintViewModel): MemberRosterRow[] {
  return vm.members.map((m: PrintMemberVM) => ({
    key: m.id,
    name: m.name,
    isAgent: m.actorKind === MemberActorKind.Agent,
    agentKind: m.agentKind,
    role: m.role,
    taskCount: m.taskCount,
  }));
}

/* ------------------------------------------------------------------ 分页几何 */

/**
 * 行估高（normal / compact 两档；px）。
 * 取值 = CSS 实测上限 + 余量：normal 行 = 11.5-12.5px 字号 ×1.35 行高
 * （≈17px）+ 上下 padding 10px + 1px 行线 ≈ 28px，取 30-32 偏保守；
 * compact 行 = 11px ×1.35（≈15px）+ 6px padding + 1px ≈ 22px，取 24-26。
 * 密度研究 §4 约束 1：行 padding 任何档位不得低于上下各 3px（compact 已压线）。
 */
export const GENERIC_ROW_H: Record<'stage-list' | 'task-list' | 'member-roster', { normal: number; compact: number }> = {
  'stage-list': { normal: 32, compact: 26 },
  'task-list': { normal: 30, compact: 24 },
  'member-roster': { normal: 30, compact: 24 },
};

/** 超过该行数转紧凑档（分页照旧——紧凑只是让每页多装几行；同 E 版口径） */
export const GENERIC_COMPACT_THRESHOLD = 16;

/**
 * 每物理页**行区**可用高度（px；= 纸面 1123 − 各版页壳 chrome − 模块头 − 口径注）。
 * 各版页壳 chrome（顶栏/页头/logo 行/页脚/主体内距）实测后取保守值：
 *   A ≈ 852（顶底栏 148 + 主体内距 36 + 模块头 34 + 口径注 46 的余量和）
 *   D ≈ 867 / E ≈ 831 / H ≈ 865
 * 一律再留 10-50px 余量——估高偏大只白留一截，偏小直接溢出（红）。
 */
export const GENERIC_ROWS_H: Record<PrintTemplateId, number> = {
  classic: 0, // 经典不走模块表（五块 blocks 另一套粒度）；不会进本表，占位
  'swiss-schedule': 820,
  'data-editorial': 840,
  'editorial-index': 780,
  'agent-poster': 800,
};

/**
 * 贪心装页（确定性：同输入同输出）。单行是原子单位——装不下就整行去
 * 下一页（行不裂）；空序列返回一页空序列（不出零页纸面，与 E 版同口径）。
 */
export function paginateGenericRows<T>(rows: readonly T[], rowHeight: number, rowsHeight: number): T[][] {
  const pages: T[][] = [];
  let current: T[] = [];
  let used = 0;
  for (const row of rows) {
    if (used + rowHeight > rowsHeight && current.length > 0) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(row);
    used += rowHeight;
  }
  if (current.length > 0) pages.push(current);
  return pages.length > 0 ? pages : [[]];
}

/* ------------------------------------------------------------------ 分页计划 */

/** 一个通用模块的分页计划（按模块判别联合；渲染层按 module 分发到对应组件） */
export type GenericPlan =
  | { module: 'stage-list'; compact: boolean; count: string; chunks: readonly (readonly StageListRow[])[] }
  | { module: 'task-list'; compact: boolean; count: string; chunks: readonly (readonly TaskListRow[])[] }
  | { module: 'member-roster'; compact: boolean; count: string; chunks: readonly (readonly MemberRosterRow[])[] };

/** 本批通用渲染覆盖的三个模块（期三第一批；其余模块等后续批次） */
export type GenericRenderableModule = 'stage-list' | 'task-list' | 'member-roster';

/** 判别：任意模块 id 是否本批可通用渲染（注册表 generic 标记的渲染侧镜像） */
export function isGenericRenderable(module: PrintModuleId): module is GenericRenderableModule {
  return module === 'stage-list' || module === 'task-list' || module === 'member-roster';
}

/**
 * 模块 → 分页计划（行构造 + 紧凑档判定 + 贪心装页 + 模块头计数行）。
 * 行数 0 ⇒ null（调用方渲染 EmptyPrintState，不出表格纸面）。
 * count 从**全量 VM** 算（不是 chunk 行数）——跨页不变，每页自解释。
 */
export function planGenericModule(
  module: GenericRenderableModule,
  vm: PrintViewModel,
  template: PrintTemplateId,
): GenericPlan | null {
  const rowsHeight = GENERIC_ROWS_H[template];
  if (module === 'stage-list') {
    const rows = buildStageListRows(vm);
    if (rows.length === 0) return null;
    const compact = rows.length > GENERIC_COMPACT_THRESHOLD;
    return {
      module,
      compact,
      count: stageListCount(vm),
      chunks: paginateGenericRows(rows, GENERIC_ROW_H[module][compact ? 'compact' : 'normal'], rowsHeight),
    };
  }
  if (module === 'task-list') {
    const rows = buildTaskListRows(vm);
    if (rows.length === 0) return null;
    const compact = rows.length > GENERIC_COMPACT_THRESHOLD;
    return {
      module,
      compact,
      count: taskListCount(vm),
      chunks: paginateGenericRows(rows, GENERIC_ROW_H[module][compact ? 'compact' : 'normal'], rowsHeight),
    };
  }
  const rows = buildMemberRosterRows(vm);
  if (rows.length === 0) return null;
  const compact = rows.length > GENERIC_COMPACT_THRESHOLD;
  return {
    module,
    compact,
    count: memberRosterCount(vm),
    chunks: paginateGenericRows(rows, GENERIC_ROW_H[module][compact ? 'compact' : 'normal'], rowsHeight),
  };
}

/* ------------------------------------------------------------------ 行内文案 */

/** M1 头部计数行（占比口径不进表格，防误读留在口径注） */
export function stageListCount(vm: PrintViewModel): string {
  const done = vm.tasks.filter((t) => t.status === TaskStatus.Done).length;
  return `${vm.stages.length} 阶段 · 完成度 ${Math.round(vm.project.percent)}% · 任务 ${done}/${vm.tasks.length}`;
}

/** M2 头部计数行（逾期数双编码：文字 + 加重，不靠颜色） */
export function taskListCount(vm: PrintViewModel): string {
  const overdue = vm.tasks.filter((t) => t.overdue).length;
  return overdue > 0 ? `${vm.tasks.length} 条 · 逾期 ${overdue}` : `${vm.tasks.length} 条`;
}

/** M4 头部计数行 */
export function memberRosterCount(vm: PrintViewModel): string {
  const agents = vm.members.filter((m) => m.actorKind === MemberActorKind.Agent).length;
  return agents > 0 ? `${vm.members.length} 人 · Agent ${agents}` : `${vm.members.length} 人`;
}

/** 口径注（每页可独立解释，01 §2；L3 附属信息：9.5-10px + 灰度一档） */
export const GENERIC_NOTES: Record<'stage-list' | 'task-list' | 'member-roster', string> = {
  'stage-list':
    '口径：四态以 Stage.status 为准；占比 = 阶段工作量分配（ratioPercent），不等于完成度；隐藏阶段不进入本表，也不参与统计。',
  'task-list':
    '口径：任务随阶段可见性收窄（隐藏阶段的任务不进本表）；逾期 = 到期日早于今天且状态未完成；产出物数为该任务归档条数。',
  'member-roster':
    '口径：成员为可见范围内被引用的成员（阶段负责人 / 任务指派人 / Agent 产出者）；负责任务数按可见阶段统计。',
};
