/**
 * H 版三页的**人类载荷**与版式小工具（人类化批次；规格 §1.2 / §1.4 / §3.2）。
 *
 * ── H 是什么（人类化拍板后）──
 * 「海报式跳读」外表。版式语法**一个构件都不删**（出血巨字 / 双栏 + 局部中轴 /
 * 大字号分组栏头 / 实底错落状态标签块 / 居中标 / 通栏橙线 / mono 平铺口径行 /
 * 图例 / 两行脚注），只把载荷从 Agent 治理公示换成人类项目内容：
 *   P1 阶段海报（M1）/ P2 任务海报（M2）/ P3 成员海报（M4）。
 * 三页消费**同一个 `PrintViewModel`**（规格 §3.2 选项 A：四套外表打同一份项目
 * 数据；参考稿 H 只贡献版式与配色权威，它那份 Agent 数据口径作废）。
 *
 * ── 颜色语义（构件不动，语义按人类口径重述）──
 *   橙 = **需要人动作**（阶段：延期 / 未开始；任务：受阻 / 待验收；成员：执行体）
 *   墨 = **在轨推进**（进行中 / 已完成 / 已认领…）
 * ⚠️ accent 在新纸底 `#DEDDD4` 上只有 **2.812:1**（< 3 的图形级阈值，
 * 见 `agent-poster.css` 头注释的「闸门与登记偏离」）⇒ 只作**实底标签 / 栏头 /
 * 粗线 / 中轴**，不承载小字正文；accent 文字一律 ≥9.5px
 * （`PRINT_DENSITY_FLOORS.accentFontSizeMin`）。
 *
 * ── 双编码（宪法 4）──
 * 每个状态块同时带**状态文字**与**形状互异的字形**（灰度打印不靠色相）；
 * 标签是实底但**里面必须有字**。字形表 / 状态标签表的唯一出处是
 * `pages/generic/shared.ts`（跨外表一份）——本文件不复制第二份
 * （「第二真值源」在本仓已出过三次事故）。
 *
 * ── 巨字载荷（规格 §1.4）──
 * 页顶 = 用户自定义品牌词（`print.brandWord`，默认 `PLAN`），**与状态解绑**：
 * 参考稿那颗 `AGENT` 是「主题词位」不是状态位，状态表达归双栏栏头。
 * 页底 = 固定品牌装置 `IDPLAN`（不随自定义变）。本文件只提供**估宽选档**
 * （`giantTier`），颜色与几何在 CSS。
 *
 * ── 分页（估高纪律）──
 * 分页常量只许**偏大**（估大 = 早分页白留一截；估小 = 内容溢出纸面）。
 * 单块估高、栏区可用高度都由真 Chromium 实测回填，见
 * `AP_POSTER_ROWS_H` / `AP_POSTER_BLOCK_H` 的注释。
 */

import { MemberActorKind, StageStatus, TaskStatus } from '../../../core/types/enums';
import type { PrintPageKind, PrintViewModel } from '../../model/print-view-model';
import {
  buildMemberRosterRows,
  buildStageListRows,
  buildTaskListRows,
  STAGE_GLYPH,
  TASK_STATUS_GLYPH,
  stageStatusLabel,
  taskStatusLabel,
  type MemberRosterRow,
  type StageListRow,
  type TaskListRow,
} from '../generic/shared';

/* ------------------------------------------------------------------ 页 kind */

/**
 * H 版三页的纸面 kind（规格 §1.2.5：复用既有 kind，**零类型改造**——
 * `PrintPageKind` 的 14 值联合与 `PAGE_TO_MODULE` 都不动）。
 * 三个 agent kind（`agent-declaration` / `execution-status` /
 * `writeback-proposals`）保留在类型里（spec 逐字锁 14 值），但在 H 下**已无
 * 渲染器**：旧 prefs 勾过 M10/M11 的用户静默降级（不落页、不报错）。
 */
export type PosterKind = 'stage-overview' | 'task-register' | 'member-roster';

/** 判别：该页 kind 是否 H 版的人类原生页 */
export function isPosterKind(kind: PrintPageKind): kind is PosterKind {
  return kind === 'stage-overview' || kind === 'task-register' || kind === 'member-roster';
}

/* ------------------------------------------------------------------ 栏头分组 */

/**
 * 栏头色调。只有两档 —— accent 撑不起小字，故只给「整条栏头 / 实底标签」用。
 * `gate` = 需要人动作（橙）；`ink` = 在轨推进（墨）。
 */
export type PosterColumnTone = 'gate' | 'ink';

/**
 * 双栏分组（规格 §1.1 C2：栏头 = 组名 + **3px 规则线**；块 = 对象 + 实底标签
 * + 一行 meta，块下 1px 发丝线）。组名 19px/900，gate 组整条（字 + 线）着色。
 */
export interface PosterStatusColumn<S> {
  key: string;
  /** 中文组名（19px/900） */
  label: string;
  /** 英文副名（栏头右，mono 大写） */
  en: string;
  /** 组内状态（顺序即组内阅读序） */
  statuses: readonly S[];
  tone: PosterColumnTone;
  /** 组注（一行口径；数字口径不写死在这里） */
  note: string;
}

/** P1 阶段四态 → 两栏（规格 §1.2.2：左「待推进」橙 = 延期 + 未开始；右「在推进」墨） */
export const STAGE_POSTER_COLUMNS: readonly PosterStatusColumn<StageStatus>[] = [
  {
    key: 'pending',
    label: '待推进',
    en: 'PENDING',
    statuses: [StageStatus.Delayed, StageStatus.NotStarted],
    tone: 'gate',
    note: '延期与未开始：要人或排期推动，不会自己前进',
  },
  {
    key: 'running',
    label: '在推进',
    en: 'RUNNING',
    statuses: [StageStatus.InProgress, StageStatus.Completed],
    tone: 'ink',
    note: '进行中与已完成：按计划在轨',
  },
];

/**
 * P2 任务七态 → 四组（规格 §1.2.3：双栏 **2×2**；第三组「需要人动作」= 橙 gate）。
 * 顺序即纸面阅读序（先左后右、先上后下）。
 */
export const TASK_POSTER_COLUMNS: readonly PosterStatusColumn<TaskStatus>[] = [
  {
    key: 'draft-ready',
    label: '起草与待命',
    en: 'DRAFT & READY',
    statuses: [TaskStatus.Draft, TaskStatus.Ready],
    tone: 'ink',
    note: '草稿与就绪：还没有主在推',
  },
  {
    key: 'inflight',
    label: '在轨',
    en: 'IN FLIGHT',
    statuses: [TaskStatus.Claimed, TaskStatus.InProgress],
    tone: 'ink',
    note: '已认领与进行中：有人 / 执行体在推',
  },
  {
    key: 'human-action',
    label: '需要人动作',
    en: 'HUMAN ACTION',
    statuses: [TaskStatus.Blocked, TaskStatus.Review],
    tone: 'gate',
    note: '受阻与待验收：等人解阻 / 等人签字',
  },
  {
    key: 'closed',
    label: '终局',
    en: 'CLOSED',
    statuses: [TaskStatus.Done],
    tone: 'ink',
    note: '已完成：归档，不再变更',
  },
];

/** P3 成员两栏（规格 §1.2.4：左「人类成员」墨 / 右「执行体」橙） */
export interface PosterMemberColumn {
  key: 'human' | 'agent';
  label: string;
  en: string;
  tone: PosterColumnTone;
  note: string;
}

export const MEMBER_POSTER_COLUMNS: readonly PosterMemberColumn[] = [
  {
    key: 'human',
    label: '人类成员',
    en: 'HUMANS',
    tone: 'ink',
    note: '人类成员：按角色与负责任务数列示',
  },
  {
    key: 'agent',
    label: '执行体',
    en: 'EXECUTORS',
    tone: 'gate',
    note: '执行体：自动产出的责任方（本页的治理焦点）',
  },
];

/** 状态 → 标签色调。**从分组表派生**（一处定义，标签与栏头不会各说一套）。 */
export function stageTagTone(status: StageStatus): PosterColumnTone {
  return STAGE_POSTER_COLUMNS.find((c) => c.statuses.includes(status))?.tone ?? 'ink';
}

export function taskTagTone(status: TaskStatus): PosterColumnTone {
  return TASK_POSTER_COLUMNS.find((c) => c.statuses.includes(status))?.tone ?? 'ink';
}

/* ------------------------------------------------------------------ 口径行 */

/**
 * 字段口径行（规格 §1.1 D3：中文标签 + **同一行 mono 平铺**字段名；
 * 参考稿把「白名单」二字着橙 ⇒ 本实现把标签**末二字**着橙，同位替换）。
 * 四项字段名取自 `print-view-model.ts` 的真实字段，不编。
 */
export interface FieldScopeLine {
  /** 标签前段（墨） */
  head: string;
  /** 标签末二字（accent；accent 小字 ≥9.5px 的登记项之一） */
  tail: string;
  /** 平铺字段名（mono） */
  items: readonly string[];
}

export const STAGE_FIELD_SCOPE: FieldScopeLine = {
  head: '阶段字段',
  tail: '口径',
  items: ['Stage.status', 'Stage.ratioPercent', 'Stage.ownerId', 'StageLog.reason'],
};

export const TASK_FIELD_SCOPE: FieldScopeLine = {
  head: '任务字段',
  tail: '口径',
  items: ['Task.status', 'Task.dueDate', 'Task.assigneeIds', 'Task.artifacts'],
};

export const MEMBER_FIELD_SCOPE: FieldScopeLine = {
  head: '成员字段',
  tail: '口径',
  items: ['Member.actorKind', 'Member.roleKind', 'Member.taskCount'],
};

/* ------------------------------------------------------------------ 统计（真实字段） */

/** P1 统计：全部来自 `vm.stages` / `vm.project`，**不新增任何字段**（宪法 7） */
export interface StagePosterStats {
  total: number;
  done: number;
  inProgress: number;
  notStarted: number;
  delayed: number;
  /** 项目完成度（可见阶段粒度，复用 VM 的 percent，不在纸面重算） */
  percent: number;
}

export function stagePosterStats(vm: PrintViewModel): StagePosterStats {
  const n = (s: StageStatus): number => vm.stages.filter((x) => x.status === s).length;
  return {
    total: vm.stages.length,
    done: n(StageStatus.Completed),
    inProgress: n(StageStatus.InProgress),
    notStarted: n(StageStatus.NotStarted),
    delayed: n(StageStatus.Delayed),
    percent: Math.round(vm.project.percent),
  };
}

/** P2 统计 */
export interface TaskPosterStats {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  /** 逾期条数（到期日早于今天且未完成 —— VM 已按同一口径算好 overdue） */
  overdue: number;
}

export function taskPosterStats(vm: PrintViewModel): TaskPosterStats {
  const n = (s: TaskStatus): number => vm.tasks.filter((x) => x.status === s).length;
  return {
    total: vm.tasks.length,
    done: n(TaskStatus.Done),
    inProgress: n(TaskStatus.InProgress),
    blocked: n(TaskStatus.Blocked),
    overdue: vm.tasks.filter((x) => x.overdue).length,
  };
}

/** P3 统计 */
export interface MemberPosterStats {
  total: number;
  humans: number;
  agents: number;
}

export function memberPosterStats(vm: PrintViewModel): MemberPosterStats {
  const agents = vm.members.filter((m) => m.actorKind === MemberActorKind.Agent).length;
  return { total: vm.members.length, humans: vm.members.length - agents, agents };
}

/* ------------------------------------------------------------------ 文案（唯一出口） */

/** P1 meta 行（参考稿 y≈242 位的单行 mono 计数行；项目名在这里，不在页眉） */
export function stagePosterMeta(vm: PrintViewModel, s: StagePosterStats): string {
  return `${vm.project.name} · 阶段 ${s.total}  已完成 ${s.done}  延期 ${s.delayed}`;
}

/** P2 meta 行 */
export function taskPosterMeta(vm: PrintViewModel, s: TaskPosterStats): string {
  return `${vm.project.name} · 任务 ${s.total}  进行中 ${s.inProgress}  受阻 ${s.blocked}`;
}

/** P3 meta 行（人类 / 执行体 构成是成员事实，不是治理面板，故照登） */
export function memberPosterMeta(vm: PrintViewModel, s: MemberPosterStats): string {
  return `${vm.project.name} · 成员 ${s.total}  人类 ${s.humans}  执行体 ${s.agents}`;
}

/** 居中摘要块（规格 §1.1 D1：主数值大号 mono，**不借巨字**——借了每页都是海报） */
export interface PosterSummary {
  label: string;
  /** 主数值（大号 mono） */
  big: string;
  /** 副行（小字，口径说明） */
  sub: string;
}

export function stagePosterSummary(s: StagePosterStats): PosterSummary {
  return {
    label: '项目完成度',
    big: `${s.percent}%`,
    sub: `已完成 ${s.done} / ${s.total} 个可见阶段（阶段粒度，不按 ratioPercent 加权）`,
  };
}

export function taskPosterSummary(s: TaskPosterStats): PosterSummary {
  return {
    label: '任务完成度',
    big: `${s.done} / ${s.total}`,
    sub: `逾期 ${s.overdue} 条（到期日早于今天且未完成）`,
  };
}

export function memberPosterSummary(s: MemberPosterStats): PosterSummary {
  return {
    label: '成员构成',
    big: `${s.humans} / ${s.agents}`,
    sub: `人类 ${s.humans} 人 · 执行体 ${s.agents} 个（共 ${s.total} 位成员）`,
  };
}

/**
 * 图例行（规格 §1.1 D4：单行 9.5px、降一档灰）。**态数按真实数据算，不写死**：
 * 前半是编码图例，后半是「状态域共 N 态，本页列示 M 态：枚举」。
 * 状态名一律走 `pages/generic/shared.ts` 的唯一标签表（不另写一份中文）。
 */
export function stagePosterLegend(vm: PrintViewModel): string {
  const domain = STAGE_POSTER_COLUMNS.flatMap((c) => c.statuses);
  const present = domain.filter((s) => vm.stages.some((x) => x.status === s));
  const names = present.map(stageStatusLabel).join(' · ');
  return `橙标签=需人工介入  黑标签=在轨推进 | 阶段 ${domain.length} 态，本页列示 ${present.length} 态：${names}`;
}

export function taskPosterLegend(vm: PrintViewModel): string {
  const domain = TASK_POSTER_COLUMNS.flatMap((c) => c.statuses);
  const present = domain.filter((s) => vm.tasks.some((x) => x.status === s));
  const names = present.map(taskStatusLabel).join(' · ');
  return `橙标签=需要人动作  黑标签=在轨推进 | 任务 ${domain.length} 态，本页列示 ${present.length} 态：${names}`;
}

export function memberPosterLegend(vm: PrintViewModel): string {
  const s = memberPosterStats(vm);
  return `橙标签=执行体  黑标签=人类成员 | 本页列示 ${s.total} 位（人类 ${s.humans} · 执行体 ${s.agents}）；不登执行体类型（2026-10-11 产品拍板）`;
}

/** 脚注（两行：口径 + 数据来源；每页可独立解释，宪法 7） */
export function stagePosterNotes(vm: PrintViewModel): readonly string[] {
  return [
    '口径：完成度按可见阶段数统计，不按 ratioPercent 加权；隐藏阶段不进入本页。',
    `数据来源 ID Plan 排程库 ${stampOf(vm.generatedAt)} 同步`,
  ];
}

export function taskPosterNotes(vm: PrintViewModel): readonly string[] {
  return [
    '口径：任务随阶段可见性收窄，隐藏阶段的任务不进本页；逾期 = 到期日早于今天且状态未完成。',
    `数据来源 ID Plan 排程库 ${stampOf(vm.generatedAt)} 同步`,
  ];
}

export function memberPosterNotes(vm: PrintViewModel): readonly string[] {
  return [
    '口径：成员为可见范围内被引用的成员（阶段负责人 / 任务指派人 / 执行体产出者）；负责任务数按可见阶段统计。',
    `数据来源 ID Plan 排程库 ${stampOf(vm.generatedAt)} 同步`,
  ];
}

/* ------------------------------------------------------------------ 分页与纸面载荷 */

/**
 * 单块估高（px）。规格 §1.2.2 推断 48；**真 Chromium 实测为 51.8**（标题行 12.5×1.35
 * + 实底标签 3+3+9.5×1.2 + 一行 meta 14.3 + 块内 padding + 块下 1px 发丝线），
 * 这里取 52（向上取整：估高只许偏大——偏大 = 早分页白留一截，偏小 = 直接溢出纸面）。
 */
export const AP_POSTER_BLOCK_H = 52;

/**
 * 单栏**栏头区**估高（px）：栏头盒 → 栏区首块顶（组名 19px/900 + 3px 规则线
 * + 组注 + 各自间距）。实测 56.8（栏头盒 y0..28.5、规则线、组注 y42.5..56.8），
 * 取 57。栏头是**每栏各一份**（2×2 的任务页要算两遍），故容量公式必须减
 * `rows × 栏头`，不能只除栏行数。
 */
export const AP_POSTER_COL_HEAD_H = 57;

/**
 * 双栏**栏区**可用总高（px，指所有栏行加起来）。
 *
 * ── 怎么算出来的（纸面 1123 竖着切，全部为真 Chromium 实测回填）──
 *   页头（kicker + meta 行，给巨字让位）        250.0
 *   logo 行（全局 logo 必登，每页一枚 22px）     30.0
 *   主体上内距                                   10.0
 *   页底巨字**墨迹带**让位量（P0-23，见 CSS）    129.0
 *   ⇒ 正文可用的总高 = 1123 − 419 = **704**
 *   再减下半页固定件（实测）：
 *     居中摘要块 105.3（上距 24 + 标签 + 40px mono 大数 + 副行）
 *     通栏 3px 橙线 25（上距 22 + 3）
 *     mono 口径行 30.3（上距 12 + 一行 18.3）
 *     图例行 22.3（上距 8 + 一行 14.3）
 *     两行脚注 53（上距 12 + 8 + 1 线 + 2×16）
 *   ⇒ 尾件合计 235.7 ⇒ 栏区 = 704 − 235.7 = **468.3**，取整向下 **468**。
 *
 * ⚠️ **与规格 §1.2.2「每页可容 ≈ 2 × 12 块」的差异（已报 team-lead）**：
 * 12/栏 需要栏区 ≈57 + 12×52 = 681px，那会把居中摘要块/通栏橙线/图例/脚注
 * 顶到纸外——参考稿自己的栏区只有 y≈407..600（**约 3-4 块/栏**，它的轴止于
 * y600 正是内容收口处）。故本常量按**参考稿的版式预算 + 真机实测**取值，分页
 * 负责消化超量数据；「2×12」那条算术与参考稿几何不可兼得（规格自相矛盾项）。
 */
export const AP_POSTER_ROWS_H = 468;

/**
 * 任务海报的**原生容量上限**（块/页 = 4 组 × 3）。
 * 超过它 ⇒ 任务页回落通用渲染（清单行 + 右栏面板），这是审美标准 §2-H 的
 * 既有纪律（原文「≤8 条任务转状态分组卡，>8 回清单行+右栏常驻」，人类任务卡
 * 的标签更宽 ⇒ 阈值 8 → 12），规格 §1.2.3 照抄。判据是**可见任务数**。
 */
export const AP_POSTER_TASK_MAX = 12;

/**
 * 每栏可装块数。`rows` = 本页栏区的**栏行数**（阶段/成员页 1 行 2 栏；
 * 任务页是 4 组 2×2 ⇒ 2 行）。
 *
 * ⚠️ 2 行模式下块高整数粒度是 `2 × 52 = 104px`，故余量可能超过 10%
 * （468 → 2×(57+3×52) = 426）——那是取整余量，不是估高偏差；多取一档
 * （k=4 → 530）会真的溢出纸面（实测 1125.5 > 1123）。
 */
export function apPosterColumnCap(rows: number): number {
  const perRow = AP_POSTER_ROWS_H / rows - AP_POSTER_COL_HEAD_H;
  return Math.max(1, Math.floor(perRow / AP_POSTER_BLOCK_H));
}

/**
 * 并行分页：每页每栏各取 `k` 块（栏内游标前进），页数 = 各栏所需页数的最大值。
 * **栏内分组不跨页拆散**（块序不变）；决定论（同输入同输出）。
 */
export function planPosterPages<T>(columns: readonly (readonly T[])[], k: number): T[][][] {
  const pages = columns.reduce((max, c) => Math.max(max, Math.ceil(c.length / k)), 1);
  const out: T[][][] = [];
  for (let p = 0; p < pages; p++) out.push(columns.map((c) => c.slice(p * k, (p + 1) * k)));
  return out;
}

/** 一个状态块（渲染层只铺版，不再做内容判断） */
export interface PosterBlock {
  key: string;
  /** 块标题（`阶段 01` / `任务 1042` / `成员 01`） */
  title: string;
  /** 状态标签文字（实底标签里**必须有字**，宪法 4） */
  tag: string;
  /** 标签色调（gate = 橙实底 / ink = 墨实底） */
  tagTone: PosterColumnTone;
  /** 状态字形（形状互异的第二重编码，灰度不靠色相） */
  glyph: string;
  /** 一行 meta（真实字段拼装，不编） */
  meta: string;
}

/** 一个栏（栏头 + 本页落在这个栏里的块） */
export interface PosterColumn {
  key: string;
  label: string;
  en: string;
  tone: PosterColumnTone;
  note: string;
  blocks: readonly PosterBlock[];
}

/** 一个物理海报页的全部载荷 */
export interface PosterSheet {
  kind: PosterKind;
  /** 本模块的块总数（跨页不变，每页自解释） */
  total: number;
  /** 本页是模块的第几页（0 起；>0 ⇒ 页眉出「（续）」、不出巨字） */
  chunkIndex: number;
  chunkTotal: number;
  /** 本页是否无数据（真值驱动：渲染层据此出空态、不出巨字） */
  empty: boolean;
  meta: string;
  columns: readonly PosterColumn[];
  summary: PosterSummary;
  scope: FieldScopeLine;
  legend: string;
  notes: readonly string[];
}

/** 阶段块：`阶段 {orderIndex 两位}` + 实底状态标签 + 日期区间 / 占比 / 负责人 */
function stageBlock(r: StageListRow): PosterBlock {
  return {
    key: r.key,
    title: `阶段 ${r.no}`,
    tag: stageStatusLabel(r.status),
    tagTone: stageTagTone(r.status),
    glyph: STAGE_GLYPH[r.status],
    meta: `${r.startAt} → ${r.endAt} · 占比 ${r.ratioPercent}% · ${r.ownerName ?? '未指派'}`,
  };
}

/** 任务块：`任务 {格式读号}` + 实底状态标签 + 负责人 / 产出物数 */
function taskBlock(r: TaskListRow): PosterBlock {
  const who = r.assigneeNames.length > 0 ? r.assigneeNames.join('、') : '未指派';
  return {
    key: r.key,
    title: `任务 ${r.no}`,
    tag: taskStatusLabel(r.status),
    tagTone: taskTagTone(r.status),
    glyph: TASK_STATUS_GLYPH[r.status],
    meta: `${r.title} · ${who} · 产出物 ${r.artifactCount}`,
  };
}

/** 成员块：`成员 {两位序号}` + 实底类型标签（人类成员 / 执行体）+ 角色 / 任务数 */
function memberBlock(r: MemberRosterRow): PosterBlock {
  return {
    key: r.key,
    title: `成员 ${r.no}`,
    tag: r.isAgent ? '执行体' : '人类成员',
    tagTone: r.isAgent ? 'gate' : 'ink',
    glyph: r.isAgent ? '◉' : '●',
    meta: `${r.name} · ${r.role} · 负责任务 ${r.taskCount}`,
  };
}

/**
 * 把「已按分组分好的栏」按容量切成页，并组装每页的载荷。
 *
 * `maxBands` = 该页**最多几行栏**（阶段/成员页 1 行 2 栏；任务页 4 组 2×2 = 2 行）。
 * 实际行数按**有内容的栏数**算：`ceil(active / 2)` 且 ≤ `maxBands`。
 * 这条不是优化而是**正确性**——任务页只有 1 组有数据时（常态：某个项目全在
 * 「在轨」），若仍按 2 行分栏，容量会被腰斩成 3 块/栏，一页只装 3 块（真机实测
 * 撞到：8 条任务被拆成 3 页），而单栏其实能装 7 块。空栏不落版（见下）已保证
 * 「有内容的栏数 = 实际栏数」，容量必须跟着它走，否则估算与纸面不同源。
 */
function assembleSheets(
  kind: PosterKind,
  columns: readonly PosterColumn[],
  maxBands: number,
  payload: Omit<PosterSheet, 'kind' | 'columns' | 'chunkIndex' | 'chunkTotal' | 'empty'>,
): PosterSheet[] {
  const active = columns.filter((c) => c.blocks.length > 0).length;
  const bands = Math.max(1, Math.min(maxBands, Math.ceil(active / 2)));
  const cap = apPosterColumnCap(bands);
  const pages = planPosterPages(
    columns.map((c) => c.blocks),
    cap,
  );
  return pages.map((pageBlocks, i) => ({
    ...payload,
    kind,
    chunkIndex: i,
    chunkTotal: pages.length,
    empty: payload.total === 0,
    // 本页空栏不落版（避免出现只有栏头没有块的「空壳栏」）；栏序不变
    columns: columns
      .map((c, ci) => ({ ...c, blocks: pageBlocks[ci] ?? [] }))
      .filter((c) => c.blocks.length > 0),
  }));
}

/** P1 阶段海报：载荷 = `vm.stages`，分组 = 阶段四态两栏 */
function stagePosterSheets(vm: PrintViewModel): PosterSheet[] {
  const rows = buildStageListRows(vm);
  const stats = stagePosterStats(vm);
  const columns: PosterColumn[] = STAGE_POSTER_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    en: c.en,
    tone: c.tone,
    note: c.note,
    blocks: rows.filter((r) => c.statuses.includes(r.status)).map(stageBlock),
  }));
  return assembleSheets('stage-overview', columns, 1, {
    total: rows.length,
    meta: stagePosterMeta(vm, stats),
    summary: stagePosterSummary(stats),
    scope: STAGE_FIELD_SCOPE,
    legend: stagePosterLegend(vm),
    notes: stagePosterNotes(vm),
  });
}

/** P2 任务海报：载荷 = `vm.tasks`，分组 = 任务七态四组（双栏 2×2） */
function taskPosterSheets(vm: PrintViewModel): PosterSheet[] {
  const rows = buildTaskListRows(vm);
  const stats = taskPosterStats(vm);
  const columns: PosterColumn[] = TASK_POSTER_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    en: c.en,
    tone: c.tone,
    note: c.note,
    blocks: rows.filter((r) => c.statuses.includes(r.status)).map(taskBlock),
  }));
  return assembleSheets('task-register', columns, 2, {
    total: rows.length,
    meta: taskPosterMeta(vm, stats),
    summary: taskPosterSummary(stats),
    scope: TASK_FIELD_SCOPE,
    legend: taskPosterLegend(vm),
    notes: taskPosterNotes(vm),
  });
}

/** P3 成员海报：载荷 = `vm.members`，分组 = 人类 / 执行体 两栏 */
function memberPosterSheets(vm: PrintViewModel): PosterSheet[] {
  const rows = buildMemberRosterRows(vm);
  const stats = memberPosterStats(vm);
  const columns: PosterColumn[] = MEMBER_POSTER_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    en: c.en,
    tone: c.tone,
    note: c.note,
    blocks: rows.filter((r) => (c.key === 'agent') === r.isAgent).map(memberBlock),
  }));
  return assembleSheets('member-roster', columns, 1, {
    total: rows.length,
    meta: memberPosterMeta(vm, stats),
    summary: memberPosterSummary(stats),
    scope: MEMBER_FIELD_SCOPE,
    legend: memberPosterLegend(vm),
    notes: memberPosterNotes(vm),
  });
}

/**
 * 页 kind ⇒ 该模块的全部物理页载荷（分页已完成）。
 * 空数据也**出一页**（`empty: true`）——纸面照常出、主体走空态，
 * **不许用模拟记录填版**（02 §8）。
 */
export function planPosterSheets(kind: PosterKind, vm: PrintViewModel): PosterSheet[] {
  if (kind === 'stage-overview') return stagePosterSheets(vm);
  if (kind === 'task-register') return taskPosterSheets(vm);
  return memberPosterSheets(vm);
}

/* ------------------------------------------------------------------ 页顶巨字 */

/**
 * 巨字估宽（em）：CJK / 全角按 1em，其余按西文大写 0.65em。
 * 系数来自参考稿实测：5 字符 `AGENT` 墨迹宽 569px ÷ 字号 175 ≈ 0.65em/字符；
 * CJK 是方块字，直接 1em。
 *
 * ⚠️ 估值**只用于选档**，不参与渲染；宁可高估（多降一档），不可低估（撑破纸面）。
 * 用码点区间判宽，不用正则字面量——E 版踩过「正则里塞全角字符」的坑。
 */
function charEm(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) || // 谚文字母
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK 部首 / 表意文字 / 假名
    (cp >= 0xac00 && cp <= 0xd7a3) || // 谚文音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK 兼容形式
    (cp >= 0xff00 && cp <= 0xff60) || // 全角形式
    (cp >= 0xffe0 && cp <= 0xffe6);
  return wide ? 1 : 0.65;
}

/** 品牌词的估宽（em）；导出供选档单测直接钉边界 */
export function estimateGiantEmWidth(word: string): number {
  return [...word].reduce((sum, ch) => sum + charEm(ch), 0);
}

/**
 * 页顶巨字档位：按**估宽**分四档（规格 §1.4 规则 6：长词不许撑破纸面，且可见
 * 部分仍要读得出词义，故必须降档而不是任其裁掉）。字号住在 `agent-poster.css`
 * 的 `.ap-giant[data-tier=…]`（xl 171 / lg 118 / md 88 / sm 61）。
 *
 * ── 边界怎么来的（不是拍的）──
 * 可用墨迹宽 ≈ 794 − 8（文字原点）≈ 786px，四档各留 ~55px 余量取 730px：
 *   xl 730/171 = 4.3em ／ lg 730/118 = 6.2em ／ md 730/88 = 8.3em ／ 其余 61px（12em 上限 ⇒ 732px）。
 * 参考稿锚点：5 字符 `AGENT` 估宽 3.25em ⇒ xl，与「参考稿那颗巨字就是 xl 档」一致。
 * 长度上限 12 字符（`PRINT_BRAND_WORD_MAX_CHARS`）保证估宽 ≤12em ⇒ sm 是地板档。
 */
export function giantTier(word: string): 'xl' | 'lg' | 'md' | 'sm' {
  const w = estimateGiantEmWidth(word);
  if (w <= 4.3) return 'xl';
  if (w <= 6.2) return 'lg';
  if (w <= 8.3) return 'md';
  return 'sm';
}

/** ISO 时间串 → 纸面用的「yyyy-MM-dd HH:mm」 */
export function stampOf(iso: string): string {
  return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
}
