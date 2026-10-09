/**
 * 通用渲染 · 三模块共用的小工具（期三第一批 + 期七语法保真；
 * 产品决策文档 §3.2 候选 3 / §3.5，UX 研究 print-preview-ux-study §2.4/§2.6）。
 *
 * ── 通用模块是什么 ──
 * 4 套模板 = 4 种排版外表；11 个内容模块跨模板可选。外表的**原生页**
 * （pages/<template>/，标志布局）之外，其余模块用该外表的**基础排版**
 * 渲染。期三落地是「一份内容组件 + 四套皮肤」（结构同一张 table）；
 * 期七按 UX 研究 §2.4 把每模板的**结构语法**提成声明式 token
 * （syntax.ts：rowForm/numberForm/chaptering/divider/focusRow/
 * extraEncodings），组件按 token 选渲染变体——A 的三列错落（staggered）
 * 不再是原生专属，A×M1 通用路径同样可用（§2.6.2 设计师提议的新枚举值）。
 *
 * ── 为什么状态字形在这里再持一份 ──
 * A/D/E 各自在组件里自持 STAGE_GLYPH（01 §1：四版组件独立）。通用模块
 * 是**第五套组件家族**（跨外表复用同一份内容组件），不隶属任何一版，
 * 故自持一份——值与四版一致（□◐●▲，灰度可辨的形状双编码）。
 *
 * ── 分页估高纪律（与 E 版 paginateEiEntries 同族） ──
 * 纯函数常量，估高只允许偏保守（大）：偏大 = 早分页白留一截，偏小 = 内容
 * 溢出纸面（794×1123 断言即红）。期七行估高按**行形态**（rowForm）分档：
 * grid 巨编号行比 table 行高（24px 衬线编号定行高），blocks 行是单行明细；
 * 分章组合另计章头高（同 E 原生 EI_CHAPTER_H）。视觉 spec 用真 Chromium
 * 复核实际行高，实测超出估高时回调常量（只许往大调）。
 */

import type { PrintModuleId, PrintTemplateId } from '../../../components/print/print-skins';
import { formatTaskNo } from '../../../core/lib/task-no';
import { MemberActorKind, StageStatus, TASK_STATUS_LABELS, TaskStatus } from '../../../core/types/enums';
import type { PrintMemberVM, PrintStageVM, PrintTaskVM, PrintViewModel } from '../../model/print-view-model';
import { paginateEiEntries, type EiEntry } from '../editorial-index/shared';
import { resolveSyntax, type TemplateSyntax } from './syntax';

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

/** 任务七态字形（形状互异的双编码；与 H 原生执行十态同一套字形语言） */
export const TASK_STATUS_GLYPH: Record<TaskStatus, string> = {
  [TaskStatus.Draft]: '○',
  [TaskStatus.Ready]: '□',
  [TaskStatus.Claimed]: '◔',
  [TaskStatus.InProgress]: '◐',
  [TaskStatus.Blocked]: '▲',
  [TaskStatus.Review]: '△',
  [TaskStatus.Done]: '●',
};

/** 任务七态分章顺序（E×M2 目录跳读：进行中 → 受阻 → 评审 → … → 已完成） */
export const GENERIC_TASK_CHAPTER_ORDER: readonly TaskStatus[] = [
  TaskStatus.InProgress,
  TaskStatus.Blocked,
  TaskStatus.Review,
  TaskStatus.Claimed,
  TaskStatus.Ready,
  TaskStatus.Draft,
  TaskStatus.Done,
];

/** 章节顺序（E 目录跳读：进行中 → 延期 → 未开始 → 已完成；延期章是朱红焦点） */
export const GENERIC_CHAPTER_ORDER: readonly StageStatus[] = [
  StageStatus.InProgress,
  StageStatus.Delayed,
  StageStatus.NotStarted,
  StageStatus.Completed,
];

/* ------------------------------------------------------------------ 行视图模型 */

/** M1 行：序号 / 阶段名 / 四态 / 计划日期 / 占比 / 负责人 / 任务进度 */
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
  /** 负责人是否 Agent（E grid 的 Agent 左签判定消费） */
  ownerIsAgent: boolean;
  /** 阶段内任务完成度（done/total；D 进度条与 A 卡片 meta 消费） */
  taskProgress: { done: number; total: number };
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
  /** 到期日（H blocks 右栏「最早逾期日」消费；null = 未设） */
  dueDate: string | null;
}

/** M4 行：序号 / 姓名 / 类型 / agentKind / 角色 / 负责任务数 */
export interface MemberRosterRow {
  key: string;
  /** 补零序号（'01'；E 巨编号与 H mono 编号列消费） */
  no: string;
  name: string;
  isAgent: boolean;
  agentKind: string | null;
  role: string;
  taskCount: number;
}

/** M1 行序列（按 orderIndex；VM 已过 visible 过滤，这里不重算权限） */
export function buildStageListRows(vm: PrintViewModel): StageListRow[] {
  const agentOwnerIds = new Set(
    vm.members.filter((m) => m.actorKind === MemberActorKind.Agent).map((m) => m.id),
  );
  return vm.stages.map((s: PrintStageVM) => ({
    key: s.id,
    no: String(s.orderIndex).padStart(2, '0'),
    name: s.name,
    status: s.status,
    startAt: s.startAt,
    endAt: s.endAt,
    ratioPercent: s.ratioPercent,
    ownerName: s.ownerName,
    ownerIsAgent: s.ownerId !== null && agentOwnerIds.has(s.ownerId),
    taskProgress: s.taskProgress,
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
    dueDate: t.dueDate,
  }));
}

/** M4 行序列（VM 序；agentKind 开放字符串原样携带，不收敛枚举） */
export function buildMemberRosterRows(vm: PrintViewModel): MemberRosterRow[] {
  return vm.members.map((m: PrintMemberVM, i) => ({
    key: m.id,
    no: String(i + 1).padStart(2, '0'),
    name: m.name,
    isAgent: m.actorKind === MemberActorKind.Agent,
    agentKind: m.agentKind,
    role: m.role,
    taskCount: m.taskCount,
  }));
}

/* ------------------------------------------------------------------ 分页条目与几何 */

/**
 * 一个可分页条目：目录行 / 章节头（分章组合；continued = 跨页续头）。
 * 非分章组合的 chunk 全是 row 条目。
 */
export type GenericItem<T> =
  | { kind: 'row'; row: T }
  | { kind: 'chapter'; label: string; count: number; continued: boolean };

/**
 * 行估高（normal / compact 两档；px），按**行形态**分：
 *   table   11.5-12.5px 字号 ×1.35 + padding 5/5 + 1px 行线 ≈ 27-28，取 30-32 偏保守；
 *   grid    E 目录行：24px 衬线巨编号定行高 ≈ 36-40，取 40（同 E 原生 EI_ROW_H）；
 *   blocks  H 单行明细（mono 编号 + 名 + 状态）≈ 27，取 30；
 *   staggered A 三列错落卡片：序号 20px + 名称 + meta 三行（日期/占比/任务/
 *   负责人换行）≈ 60-74，取 74 偏保守（≤9 条恒一页，估大只白留一截）。
 * compact 档行 padding 压到 3px（密度研究 §4 约束 1 下限），行高同步降。
 */
export const GENERIC_ROW_H: Record<
  'stage-list' | 'task-list' | 'member-roster',
  Partial<Record<TemplateSyntax['rowForm'], { normal: number; compact: number }>>
> = {
  'stage-list': {
    table: { normal: 32, compact: 26 },
    grid: { normal: 40, compact: 31 },
    blocks: { normal: 30, compact: 24 },
    staggered: { normal: 74, compact: 60 },
  },
  'task-list': {
    table: { normal: 30, compact: 24 },
    // grid：E 目录行 12.5px 字 ×1.4 ≈ 17.5 + padding 6/6 + 1px 行线 ≈ 30.5 ⇒ 32；
    // compact padding 4/4 ≈ 26.5 ⇒ 27（期七实测：24 会累积溢出，已回调）
    grid: { normal: 32, compact: 27 },
    blocks: { normal: 30, compact: 24 },
  },
  'member-roster': {
    table: { normal: 30, compact: 24 },
    grid: { normal: 40, compact: 31 },
    blocks: { normal: 30, compact: 24 },
  },
};

/** 章头估高（同 E 原生 EI_CHAPTER_H：normal 实测 59.75 取 60 偏保守；compact 38） */
export const GENERIC_CHAPTER_H = { normal: 60, compact: 38 } as const;

/** 超过该行数转紧凑档（分页照旧——紧凑只是让每页多装几行；同 E 版口径） */
export const GENERIC_COMPACT_THRESHOLD = 16;

/**
 * 每物理页**行区**可用高度（px；= 纸面 1123 − 各版页壳 chrome − 模块头 − 口径注）。
 * 各版页壳 chrome 实测后取保守值；blocks 双栏的右栏与左栏同高，不另占行区。
 * 估高偏大只白留一截，偏小直接溢出（红）。
 */
export const GENERIC_ROWS_H: Record<PrintTemplateId, number> = {
  classic: 0, // 经典不走模块表（五块 blocks 另一套粒度）；不会进本表，占位
  'swiss-schedule': 820,
  'data-editorial': 840,
  'editorial-index': 780,
  'agent-poster': 800,
};

/* ------------------------------------------------------------------ 分页计划 */

/** 一个通用模块的分页计划（按模块判别联合；渲染层按 module 分发到对应组件） */
export type GenericPlan =
  | {
      module: 'stage-list';
      syntax: TemplateSyntax;
      compact: boolean;
      count: string;
      /** 全量行（H blocks 右栏摘要消费；不随分页变化） */
      rows: readonly StageListRow[];
      chunks: readonly (readonly GenericItem<StageListRow>[])[];
    }
  | {
      module: 'task-list';
      syntax: TemplateSyntax;
      compact: boolean;
      count: string;
      rows: readonly TaskListRow[];
      chunks: readonly (readonly GenericItem<TaskListRow>[])[];
    }
  | {
      module: 'member-roster';
      syntax: TemplateSyntax;
      compact: boolean;
      count: string;
      rows: readonly MemberRosterRow[];
      chunks: readonly (readonly GenericItem<MemberRosterRow>[])[];
    };

/** 本批通用渲染覆盖的三个模块（期三第一批；其余模块等后续批次） */
export type GenericRenderableModule = 'stage-list' | 'task-list' | 'member-roster';

/** 判别：任意模块 id 是否本批可通用渲染（注册表 generic 标记的渲染侧镜像） */
export function isGenericRenderable(module: PrintModuleId): module is GenericRenderableModule {
  return module === 'stage-list' || module === 'task-list' || module === 'member-roster';
}

/** 章条目序列（分章组合；章序 = GENERIC_CHAPTER_ORDER，空章不进序列） */
function chapterEntries<T extends { status: StageStatus }>(rows: readonly T[]): EiEntry<T>[] {
  const out: EiEntry<T>[] = [];
  for (const status of GENERIC_CHAPTER_ORDER) {
    const inChapter = rows.filter((r) => r.status === status);
    if (inChapter.length === 0) continue;
    out.push({
      kind: 'chapter',
      chapter: { status, label: stageStatusLabel(status), count: inChapter.length },
    });
    for (const row of inChapter) out.push({ kind: 'row', row });
  }
  return out;
}

/** EiEntry ⇒ GenericItem（续头判定：章头 label 带「（续）」后缀） */
function toItems<T>(entries: readonly EiEntry<T>[]): GenericItem<T>[] {
  return entries.map((e) =>
    e.kind === 'chapter'
      ? {
          kind: 'chapter' as const,
          label: e.chapter!.label,
          count: e.chapter!.count,
          continued: e.chapter!.label.endsWith('（续）'),
        }
      : { kind: 'row' as const, row: e.row! },
  );
}

/** 行条目序列（非分章组合） */
function rowItems<T>(rows: readonly T[]): GenericItem<T>[] {
  return rows.map((row) => ({ kind: 'row' as const, row }));
}

/** 贪心装页（确定性：同输入同输出）。单行是原子单位——装不下就整行去下一页 */
function paginateFlat<T>(rows: readonly T[], rowHeight: number, rowsHeight: number): T[][] {
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

/** M4 分章序列（人类 / Agent 两章——E 原生 MemberIndexPage 的章法） */
function paginateMemberChapters(
  rows: readonly MemberRosterRow[],
  rowHeight: number,
  chapterHeight: number,
  bodyHeight: number,
): GenericItem<MemberRosterRow>[][] {
  const entries: EiEntry<MemberRosterRow>[] = [];
  const humans = rows.filter((r) => !r.isAgent);
  const agents = rows.filter((r) => r.isAgent);
  if (humans.length > 0) {
    entries.push({ kind: 'chapter', chapter: { kind: 'human', label: '人类成员', count: humans.length } });
    for (const row of humans) entries.push({ kind: 'row', row });
  }
  if (agents.length > 0) {
    entries.push({ kind: 'chapter', chapter: { kind: 'agent', label: 'Agent 执行体', count: agents.length } });
    for (const row of agents) entries.push({ kind: 'row', row });
  }
  return paginateEiEntries({ entries, rowHeight, chapterHeight, bodyHeight }).map(toItems);
}

/** M2 分章序列（按任务七态；章序 = GENERIC_TASK_CHAPTER_ORDER，空章不进序列） */
function paginateTaskChapters(
  rows: readonly TaskListRow[],
  rowHeight: number,
  chapterHeight: number,
  bodyHeight: number,
): GenericItem<TaskListRow>[][] {
  const entries: EiEntry<TaskListRow>[] = [];
  for (const status of GENERIC_TASK_CHAPTER_ORDER) {
    const inChapter = rows.filter((r) => r.status === status);
    if (inChapter.length === 0) continue;
    // 章头只带 label + count（EiChapter.status 是 StageStatus 槽位，任务态不走它；
    // 组件的字形按章名查 TASK_STATUS_GLYPH）
    entries.push({
      kind: 'chapter',
      chapter: { label: taskStatusLabel(status), count: inChapter.length },
    });
    for (const row of inChapter) entries.push({ kind: 'row', row });
  }
  return paginateEiEntries({ entries, rowHeight, chapterHeight, bodyHeight }).map(toItems);
}

/**
 * 模块 → 分页计划（语法解析 + 行构造 + 紧凑档判定 + 分页）。
 * 行数 0 ⇒ null（调用方渲染 EmptyPrintState，不出表格纸面）。
 * count 从**全量 VM** 算（不是 chunk 行数）——跨页不变，每页自解释。
 */
export function planGenericModule(
  module: GenericRenderableModule,
  vm: PrintViewModel,
  template: PrintTemplateId,
): GenericPlan | null {
  if (module === 'stage-list') {
    const rows = buildStageListRows(vm);
    if (rows.length === 0) return null;
    const syntax = resolveSyntax(template, module, rows.length)!;
    const compact = rows.length > GENERIC_COMPACT_THRESHOLD;
    const rowHeight = GENERIC_ROW_H[module][syntax.rowForm]![compact ? 'compact' : 'normal'];
    const chunks = syntax.chaptering
      ? paginateEiEntries({
          entries: chapterEntries(rows),
          rowHeight,
          chapterHeight: GENERIC_CHAPTER_H[compact ? 'compact' : 'normal'],
          bodyHeight: GENERIC_ROWS_H[template],
        }).map(toItems)
      : paginateFlat(rows, rowHeight, GENERIC_ROWS_H[template]).map((c) => rowItems(c));
    return { module, syntax, compact, count: stageListCount(vm), rows, chunks };
  }
  if (module === 'task-list') {
    const rows = buildTaskListRows(vm);
    if (rows.length === 0) return null;
    const syntax = resolveSyntax(template, module, rows.length)!;
    const compact = rows.length > GENERIC_COMPACT_THRESHOLD;
    const rowHeight = GENERIC_ROW_H[module][syntax.rowForm]![compact ? 'compact' : 'normal'];
    const chunks = syntax.chaptering
      ? paginateTaskChapters(rows, rowHeight, GENERIC_CHAPTER_H[compact ? 'compact' : 'normal'], GENERIC_ROWS_H[template])
      : paginateFlat(rows, rowHeight, GENERIC_ROWS_H[template]).map((c) => rowItems(c));
    return { module, syntax, compact, count: taskListCount(vm), rows, chunks };
  }
  const rows = buildMemberRosterRows(vm);
  if (rows.length === 0) return null;
  const syntax = resolveSyntax(template, module, rows.length)!;
  const compact = rows.length > GENERIC_COMPACT_THRESHOLD;
  const rowHeight = GENERIC_ROW_H[module][syntax.rowForm]![compact ? 'compact' : 'normal'];
  const chunks = syntax.chaptering
    ? paginateMemberChapters(rows, rowHeight, GENERIC_CHAPTER_H[compact ? 'compact' : 'normal'], GENERIC_ROWS_H[template])
    : paginateFlat(rows, rowHeight, GENERIC_ROWS_H[template]).map((c) => rowItems(c));
  return { module, syntax, compact, count: memberRosterCount(vm), rows, chunks };
}

/* ------------------------------------------------------------------ 行内文案 */

/** M1 头部元信息行（新稿 E P1：「可见阶段 9 / 9 · 完成度 67%」口径；VM 不产
 *  总阶段数（含隐藏）⇒ 用可见阶段数单值，任务进度由 D KPI 带 / A 卡片 meta /
 *  H 右栏各自承载，不在此重复） */
export function stageListCount(vm: PrintViewModel): string {
  return `可见阶段 ${vm.stages.length} · 完成度 ${Math.round(vm.project.percent)}%`;
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
