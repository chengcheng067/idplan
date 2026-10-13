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

import { MemberActorKind, StageLogType, StageStatus, TaskStatus } from '../../../core/types/enums';
import { totalDaysInclusive } from '../../../lib/date';
import { buildPrintGantt, GANTT_MIN_LABEL_GAP_PCT } from '../../model/print-gantt';
import type { PrintPageKind, PrintStageLogVM, PrintViewModel } from '../../model/print-view-model';
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

/**
 * 5 块形态的 meta 行（B1 的载荷，**每页都出**；批 D）。
 *
 * 与 legacy 的 `stagePosterMeta` 不同源，且有意不同：legacy 的 meta 登的是
 * 「阶段 N / 已完成 n / 延期 n」这套**计数**，而 5 块形态里计数已经由 B4 的
 * 栏头 `ap-col__count` 与 `ap-sum` 承担（同页两处印同一个值正是用户在 P0-3
 * 点名过的排版病）。5 块形态的 meta 登**只有它才有的四样**：
 * 项目名（原则 1）· 排期基准 · 周期 · 打印日期。
 *
 * ⚠️ 这是**高风险的多字段归并**（批 D 移交项点名）：四个字段分别来自
 * `vm.project.name` / `scheduleBasisLabel` / `plannedStartAt`+`EndAt` /
 * `generatedAt`，**没有任何条件分支**——四段恒在，不因权限 / 数据空而少一段。
 * `print-a4-visual-h` 有一条逐字段自查断言守着。
 */
export function stageBlockMeta(vm: PrintViewModel): string {
  return (
    `${vm.project.name} · 排期基准 ${vm.project.scheduleBasisLabel}` +
    ` · ${vm.project.plannedStartAt} – ${vm.project.plannedEndAt}` +
    ` · 打印日期 ${vm.generatedAt.slice(0, 10)}`
  );
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

/* ====================================================================================
 * B2 · 三段式甘特（2026-10-13「5 块 × 4 模板」重构 · 批 D）
 * ====================================================================================
 * 依据 §1.4 的 H·B2 行（定稿形态）+ team-lead 批 D 任务书的四条几何硬约束。
 *
 * ── 三段式 ──
 *   ① 通栏覆盖带 `ap-span-band`：全部阶段区间的**合并覆盖**（gate 橙 / ink 墨分色段）
 *      + 1px 墨色基线 + 月份 mono 刻度压线 —— 一眼看全项目时间轮廓的**页级基准**。
 *   ② 双栏分段轴甘特：H 的签名双栏 + 中轴，每栏一条**栏内时间标尺**（与①同一
 *      0→100% 映射）+ 每阶段一行（`NN 名称` + 跨度条 + 条左端内嵌实底状态标签
 *      + 右端两端日期）。
 *   ③ `ap-sum` 的**第四个载荷**「跨度总天数」（B4 页的载荷是「阶段健康度」⇒ 两张
 *      同族双栏页靠 ap-sum 载荷分工 + 条/字段 meta 区分）。
 *
 * ── 四条几何硬约束（team-lead 批 D）──
 *   ① `.ap-cols` 在 B2 页强制 `1fr 1fr`（今天 `340px 336px` 两栏不等宽 ⇒ 同一 %
 *      的条在两栏不等长）；CSS 侧见 `.ap-cols[data-gantt]`。
 *   ② B2 页**关 `data-stagger`**（交错会让条错位）。
 *   ③ 栏间位置**不可直接互比**（双栏 = 两条独立轴）⇒ 这条必须写进 B2 的口径注，
 *      靠栏内标尺 + 通栏覆盖带缓解。**保双栏**是 team-lead 的裁定：要一条共享轴
 *      就得砍双栏 ⇒ H 不再是 H。
 *   ④ B2 与 B4 是**两张同族双栏页**（各自占物理页），两块**共用同一批切片**。
 *
 * ── 窗口来源 ──
 * 与 A/D/E **同一套派生**（批 B 裁决：尺子必须同口径）：直接用
 * `buildPrintGantt`（`print-gantt.ts`）的 `rows[].left/width` 与 `ticks`。
 * 本文件不自己算几何——它是 H 对同一份模型的**另一种画法**（条 → 双栏块）。
 */

/**
 * B2 一行的高度（px）：块头行（NN + 名称 + 日期）+ 轨道行（条）+ 块下 1px 发丝线。
 * **实测 41.5**（padding-top 6 + 块头行 12.5px/700 的行盒 19.5 + 轨道 12 + 上距 3
 * + 1px 发丝线），取 42 向上取整 —— 估高只许偏大（估小 = 内容溢出纸面）。
 * 第一版取 40 时实测 n≥14 的第一页长出 **1127.8px**（超 4.8px），本值据此回填。
 */
export const AP_SPAN_ROW_H = 42;
/** ① 通栏覆盖带占高（px）：带高 10 + 基线 + 月份刻度行为一体 */
export const AP_SPAN_BAND_H = 40;
/** ② 栏内时间标尺占高（px）：1px 基线 + 月份 mono 小字 */
export const AP_SPAN_RULER_H = 22;
/** B2 口径注（与「条 = 时长跨度」同处；几何约束③必须写在这） */
export const AP_SPAN_NOTE =
  '条 = 时间跨度，非完成度；两栏是两个独立轴（刻度相同），栏间位置不可直接互比。';

/**
 * 刻度抽稀阈值（%）。**两处刻度各用各的**（同一份映射、不同密度）：
 *   · 通栏覆盖带 714px 宽 ⇒ 12% ≈ 86px，沿用 `print-gantt.ts` 的同值；
 *   · 栏内标尺只有 338px 宽（`1fr 1fr` 的一半）⇒ 12% 只有 40px，比月份标签
 *     本身还窄（实测「2026年1月」9.5px mono ≈ 52px）⇒ 必须放到 18%（≈61px）。
 * 这是**可读性下限**，不是审美值：放到 12% 会让相邻两个月标签叠字。
 */
export const AP_SPAN_BAND_MIN_TICK_GAP_PCT = GANTT_MIN_LABEL_GAP_PCT;
export const AP_SPAN_COL_MIN_TICK_GAP_PCT = 18;

/**
 * 月份标签的**实测宽度**（px）：`2026年1月` 在 9.5px mono + 0.04em 字距下 ≈52px，
 * 取 56 留余量。用来判「这枚刻度贴右缘了吗」——贴了就要**右对齐**（否则标签
 * 越出盒外：实测 9 阶段夹具里覆盖带最后一枚越出 714 通栏，被真机断言抓到）。
 */
export const AP_SPAN_TICK_PX = 56;
/** 覆盖带轨宽 = 内容框 714（实测 `.ap-body` 的 40px 右边距下的内容宽） */
export const AP_SPAN_BAND_TRACK_PX = 714;
/** 栏内轨宽 = (714 − 38 栏间) / 2 = **338**（`1fr 1fr` 实测；几何约束①） */
export const AP_SPAN_COL_TRACK_PX = (AP_SPAN_BAND_TRACK_PX - 38) / 2;

/** 刻度对齐：`lead` = 左对齐于刻度位置（默认）；`tail` = 右对齐（贴右缘时防越盒） */
export interface ApTick {
  label: string;
  leftPercent: number;
  align: 'lead' | 'tail';
}

/** 按最小间距抽稀刻度（保留第一枚；`ticks` 已按位置升序） */
export function pruneTicks(
  ticks: readonly { label: string; leftPercent: number }[],
  minGapPct: number,
): readonly { label: string; leftPercent: number }[] {
  const kept: { label: string; leftPercent: number }[] = [];
  for (const t of ticks) {
    const prev = kept[kept.length - 1];
    if (prev && t.leftPercent - prev.leftPercent < minGapPct) continue;
    kept.push(t);
  }
  return kept;
}

/**
 * 抽稀 + 标贴右缘的对齐档 + **按标签盒去叠**（三步必须一起，少一步纸上就是一团）。
 *
 * ── 第 ③ 步（按标签盒去叠）为什么必须有（2026-10-13 修，判据盲区）──
 * 前两步各自只解决一半，交集处漏了一档：`pruneTicks` 比的是**刻度位置**间距
 * （≥minGap%），而第 ② 步给末枚标 `tail` 时会把它**整枚左移自身宽度**（右对齐于
 * 刻度）。于是「上一枚 `lead` 的右缘」与「本枚 `tail` 的左缘」**没人查**：
 *
 *   跨度 2026-08-03 → 2026-12-17、栏内轨宽 338 时实测（真机，DPR 无关的 CSS px）：
 *     `2026年11月` 盒 [365.03, 418.42] / lead
 *     `2026年12月` 盒 [385.66, 439.05] / tail   ← 左缘 385.66 < 418.42 ⇒ 相交 32.76px
 *   渲染出来是「2026年2?年12月」——不是观感问题，是**读不出月份**。
 *
 * 旧注释里「贴右缘那一段会连续标成 tail（彼此不叠）」只覆盖了 **tail→tail**，
 * 漏掉了 **lead→tail 这一次跃迁**。既有 spec 的夹具全在 1 个月以内 ⇒ 栏内轴只有
 * 1–2 枚刻度、一枚都不落 tail ⇒ 这条路径**从来没被走到过**（盲区的形态：
 * 断言在，夹具不在）。跨月项目是常态，所以这是产品缺陷而不是夹具问题。
 *
 * ── 去叠策略：留**后一枚**（即那枚 tail），回退掉被它压住的**前一枚** ──
 * 与 `pruneTicks` 的「位置太近就丢后一枚」刻意不同，理由有两条：
 *   ① `align` 机制本身就是为**末枚**存在的（它不切 tail 就会越出盒子）——
 *      把末枚丢掉等于让这个机制白做；
 *   ② 末枚标的是**时间轴的收尾月份**，丢了读者不知道轴画到哪里。
 * 于是判据是「标签盒不相交」而不是「刻度位置间距 ≥ X」——盒宽（`AP_SPAN_TICK_PX`）
 * 才是真正决定看不看得清的量。
 *
 * 自证：`tests/print-a4-visual-h.spec.ts` 的「★★ 月份刻度不叠字：跨 5 个月的真实
 * 跨度」用例（修复前红点原文可从 git 历史取；该用例另带反假绿断言「必须走到 tail 档」）。
 */
export function layoutTicks(
  ticks: readonly { label: string; leftPercent: number }[],
  minGapPct: number,
  trackPx: number,
): readonly ApTick[] {
  // ① 位置抽稀 → ② 标对齐档（贴右缘的末枚切 tail，否则整枚越出盒子）
  const anchored: ApTick[] = pruneTicks(ticks, minGapPct).map((t) => ({
    label: t.label,
    leftPercent: t.leftPercent,
    align: (t.leftPercent / 100) * trackPx + AP_SPAN_TICK_PX > trackPx ? 'tail' : 'lead',
  }));

  /** 标签盒（轨内 px）：`lead` 左对齐于刻度位置、`tail` 右对齐于刻度位置 */
  const boxOf = (t: ApTick): { left: number; right: number } => {
    const x = (t.leftPercent / 100) * trackPx;
    return t.align === 'tail'
      ? { left: x - AP_SPAN_TICK_PX, right: x }
      : { left: x, right: x + AP_SPAN_TICK_PX };
  };

  // ③ 从左往右按盒收，压住前一枚就把它回退掉（可能连续回退多枚）
  const kept: ApTick[] = [];
  for (const t of anchored) {
    const box = boxOf(t);
    while (kept.length > 0 && boxOf(kept[kept.length - 1]!).right > box.left) kept.pop();
    kept.push(t);
  }
  return kept;
}

/** 双栏分段轴甘特的一行 */
export interface ApSpanRow {
  key: string;
  /** 两位阶段号（mono） */
  no: string;
  name: string;
  /** 阶段四态（分组 / 标签 / 字形都由它派生，一处定义） */
  status: StageStatus;
  tone: PosterColumnTone;
  /** 实底标签文字（状态名） */
  tag: string;
  glyph: string;
  /** 条左缘 / 宽度（%；与 ① 覆盖带、栏内标尺同一坐标系） */
  left: number;
  width: number;
  startAt: string;
  endAt: string;
  /** 单阶段跨度天数（含首尾；1 天阶段 = 1） */
  days: number;
  /**
   * 状态标签的落位（**混合规则**，批 D 裁决第 4 条）：
   *   · `in`        —— 条够长（`barPx ≥ tagPx`）⇒ 标签**内嵌**在条左端（签名形态）；
   *   · `out-right` —— 条太短 ⇒ 标签移到条的**右外侧** + 2px 纸缝；
   *   · `out-left`  —— 条太短且右边没地方 ⇒ 移到**左外侧** + 2px 纸缝（防越盒）。
   * 为何必须有这条：条与标签**同色**，短条 + 内嵌标签合并读出来是「**52px 的跨度**」
   * —— 那不是观感问题，是**会印错事实**（12px 的条被读成 52px）。
   */
  tagPlace: ApSpanTagPlacement;
}

/** 状态标签的落位（见 `ApSpanRow.tagPlace`） */
export type ApSpanTagPlacement = 'in' | 'out-right' | 'out-left';

/**
 * 标签外移时与条之间的**纸缝**（px；2px 是批 D 裁决给的下限）。
 *
 * ⚠️ 这个值与 CSS 里三条分支的 `margin-left/right: 2px` 是**有意双写**（不升级成变量注入：
 * 那要给每行挂 inline 变量，收益不抵成本）。**这张双写由 `print-a4-visual-h` 的
 * 「条/标签混合规则」用例兜住** —— 那条断言要求外移档「纸缝 ≥2px（实测值）」，
 * CSS 若被人改成 0 会立刻红，不会静默。
 */
export const AP_SPAN_TAG_GAP_PX = 2;

/**
 * 状态标签的**估宽**（px）。**只许偏大**：估大 ⇒ 多一些标签判成「放外面」（安全，
 * 不会误读）；估小 ⇒ 有些内嵌标签仍然溢出条（误读风险照旧）。
 *
 * 公式来自实测：「未开始」（3 字）在 9.5px mono + 0.04em 字距下**实测 52.3px**；
 * 结构 = 左右 padding 12 + 字形 9.5 + 与文字间隔 4 + 每字 9.5。
 * 3 字 ⇒ 54（比实测大 1.7，方向正确）；2 字（延期）⇒ 44.5。
 */
export function apSpanTagPx(label: string): number {
  return 12 + 9.5 + 4 + [...label].length * 9.5;
}

/**
 * 混合规则（纯函数、确定性）：条与标签谁宽决定标签内嵌还是外移。
 * 右侧放不下（`barRight + 2 + tagPx > 轨宽`）就改放左侧 —— 与「刻度不许越盒」
 * 同一条纪律：**纸面上的件不许越出它所在的栏**。
 *
 * 口径：**标签优先内嵌；放不下时外移，先右后左，任何情况下与条之间必须有缝。**
 * （为什么必须有缝：条与标签**同色**，相连时合并图形会被读成更长的跨度 —— 2 天阶段的
 * 12px 条曾与 42px 标签连成 52px 的假跨度。缝是这件事的机器判据，不是装饰。）
 */
export function apSpanTagPlacement(
  leftPct: number,
  widthPct: number,
  tagPx: number,
): ApSpanTagPlacement {
  const track = AP_SPAN_COL_TRACK_PX;
  const barPx = (widthPct / 100) * track;
  if (barPx >= tagPx) return 'in';
  const barRightPx = ((leftPct + widthPct) / 100) * track;
  return barRightPx + AP_SPAN_TAG_GAP_PX + tagPx <= track ? 'out-right' : 'out-left';
}

/** 一栏（栏头 + 本页落在该栏的行）——沿用 B4 的双栏分组语义（两页同族） */
export interface ApSpanColumn {
  key: string;
  label: string;
  en: string;
  tone: PosterColumnTone;
  note: string;
  rows: readonly ApSpanRow[];
}

/** ① 通栏覆盖带的一段（合并后的区间；tone 分色） */
export interface ApCoverSegment {
  left: number;
  width: number;
  tone: PosterColumnTone;
}

/** 一个 B2 物理页的载荷 */
export interface ApSpanPage {
  /** 本模块第几页（0 起） */
  index: number;
  total: number;
  columns: readonly ApSpanColumn[];
  /** 覆盖带**全量**（跨页不变：它是页级基准，不是本页切片） */
  cover: readonly ApCoverSegment[];
  ticks: readonly { label: string; leftPercent: number }[];
  /** ③ ap-sum 第四载荷 */
  summary: PosterSummary;
  /** B2 口径注（含几何约束③） */
  note: string;
}

/** 一栏能装几行（`bands` = 本页栏行数：B2 恒 1 行 2 栏） */
export function apSpanColumnCap(bands: number, availH: number): number {
  const perRow = availH / bands - AP_POSTER_COL_HEAD_H - AP_SPAN_RULER_H;
  return Math.max(1, Math.floor(perRow / AP_SPAN_ROW_H));
}

/**
 * 把同一色调的区间合并成互不重叠的段（升序）。输入 / 输出都以**天偏移**为单位，
 * 便于先按真实天数合并、再一次性换算成 %（先换算后合并会把相邻段算断）。
 */
function mergeIntervals(input: readonly [number, number][]): [number, number][] {
  const sorted = [...input].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) {
      // 相邻（lo === last.hi + 1）也算连成一段——中间空一天不该断成两截
      last[1] = Math.max(last[1], hi);
      continue;
    }
    out.push([lo, hi]);
  }
  return out;
}

/** 单阶段跨度天数（含首尾）；脏行（空日期）记 0 */
export function spanDays(startAt: string, endAt: string): number {
  const s = startAt.slice(0, 10);
  const e = endAt.slice(0, 10);
  if (s === '' || e === '') return 0;
  return Math.max(totalDaysInclusive(s, e), 1);
}

/**
 * B2 页的载荷派生（纯函数；确定性）。
 *
 * `availH` = B2 页**栏区可用总高**（扣除页眉 / 巨字让位 / 覆盖带 / 口径注 /
 * ap-sum / 通栏线 / 口径行 / 图例 / 脚注）。
 */
export function planApSpanPages(vm: PrintViewModel, availH: number): ApSpanPage[] {
  const gantt = buildPrintGantt(vm.project, vm.stages);
  const geo = new Map(gantt.rows.map((r) => [r.key, r]));
  const rows: ApSpanRow[] = vm.stages.map((s) => {
    const g = geo.get(s.id) ?? geo.get(`${s.orderIndex}-${s.name}`);
    const left = g?.left ?? 0;
    const width = g?.width ?? 0;
    const tag = stageStatusLabel(s.status);
    return {
      key: s.id,
      no: String(s.orderIndex).padStart(2, '0'),
      name: s.name,
      status: s.status,
      tone: stageTagTone(s.status),
      tag,
      glyph: STAGE_GLYPH[s.status],
      left,
      width,
      startAt: s.startAt.slice(0, 10),
      endAt: s.endAt.slice(0, 10),
      days: spanDays(s.startAt, s.endAt),
      // 混合规则（裁决第 4 条）：条与标签谁宽，决定标签内嵌还是外移
      tagPlace: apSpanTagPlacement(left, width, apSpanTagPx(tag)),
    };
  });

  // ① 覆盖带：按色调合并**全部**阶段的真实区间（用真实天数，不用 2.5% 最小可见宽
  //    ——覆盖带表达的是「项目有没有空窗」，把 1 天阶段撑成 2.5% 会把空窗抹掉）
  const offsetOf = (iso: string): number =>
    totalDaysInclusive(gantt.viewStart, iso.slice(0, 10)) - 1;
  const byTone = new Map<PosterColumnTone, [number, number][]>();
  for (const s of vm.stages) {
    const lo = offsetOf(s.startAt);
    const hi = offsetOf(s.endAt);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    const tone = stageTagTone(s.status);
    const list = byTone.get(tone) ?? [];
    list.push([Math.max(lo, 0), Math.max(hi, 0)]);
    byTone.set(tone, list);
  }
  const cover: ApCoverSegment[] = [];
  for (const tone of ['gate', 'ink'] as const) {
    for (const [lo, hi] of mergeIntervals(byTone.get(tone) ?? [])) {
      cover.push({
        left: (lo / gantt.viewDays) * 100,
        width: ((hi - lo + 1) / gantt.viewDays) * 100,
        tone,
      });
    }
  }
  cover.sort((a, b) => a.left - b.left || a.width - b.width);

  const columns: ApSpanColumn[] = STAGE_POSTER_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    en: c.en,
    tone: c.tone,
    note: c.note,
    rows: rows.filter((r) => c.statuses.includes(r.status)),
  }));

  const cap = apSpanColumnCap(1, availH);
  const slices = planPosterPages(
    columns.map((c) => c.rows),
    cap,
  );
  const totalDays = rows.reduce((n, r) => n + r.days, 0);
  const summary: PosterSummary = {
    label: '跨度总天数',
    big: String(totalDays),
    sub: `${gantt.viewStart || '—'} → ${(gantt.viewEnd || '—').slice(5)} · ${rows.length} 个阶段跨度合计 · 条 = 时间跨度，非完成度`,
  };
  return slices.map((pageRows, i) => ({
    index: i,
    total: slices.length,
    // 本页空栏不落版（与 B4 的 assembleSheets 同纪律：不出只有栏头没有行的空壳栏）
    columns: columns
      .map((c, ci) => ({ ...c, rows: pageRows[ci] ?? [] }))
      .filter((c) => c.rows.length > 0),
    cover,
    ticks: gantt.ticks.map((t) => ({ label: t.label, leftPercent: t.leftPercent })),
    summary,
    note: AP_SPAN_NOTE,
  }));
}

/** B2 的**栏区可用总高**（px）：由 `AP_POSTER_ROWS_H` 扣掉 B2 页独有件（实测回填见 CSS 头） */
export const AP_SPAN_ROWS_H = AP_POSTER_ROWS_H - AP_SPAN_BAND_H;

/* ── 5 块形态的实测表（2026-10-13 批 D · 真 Chromium 794×1123 · 预计 = 实际逐档核过）──
 *
 * 夹具：`print-a4-visual-h.spec.ts` 的 `stagesN(n)`（3 天阶梯、跨度 4–19 天、
 * 状态四态轮换、**无**改期记录）。表由该 spec 的页数表用例控制台打印留档。
 *
 *   | 阶段 n | 物理页 | 页形序列             |
 *   |-------:|-------:|----------------------|
 *   |  1–13  |      2 | span ×1 → list ×1    |
 *   | 14–20  |      4 | span ×2 → list ×2    |
 *   | 30     |      6 | span ×3 → list ×3    |
 *   | 40     |      6 | span ×3 → list ×3    |
 *
 * 两条读表须知：
 *   ① **两张页形各自连续**（先「何时」页、后「什么状态」页），各自页数由自己的
 *      容量决定 ⇒ 总页数 = B2 页数 + B4 页数（两张同族页各占自己的纸）；
 *   ② 有改期记录时 B4 的收口页要多装 L3（`apReschedHeight`），容量下调
 *      ⇒ 同规模可能多出一页（`apListPages` 的两段式分页只在这种时候多开一张）。
 *
 * 分块高度实测（B2 页，9 阶段夹具）：覆盖带 25（刻度行 14 + 段 10 + 基线 1）、
 * 栏内标尺 18（刻度行 14 + 3 呼吸 + 1 基线）、阶段行 **41.5**（取常量 42）、
 * 条高 **12**、栏宽 **338**（`1fr 1fr` 于 714 内容框、栏间 38）。
 */

/* ====================================================================================
 * L3 · 改期记录（§0.5 的公共附加件；B4 的附属层，随 B4 一起不出）
 * ==================================================================================== */

/** 一页最多列几条改期记录（§0.5 建议 5-8；H 的块高 52 取 6） */
export const AP_RESCHED_MAX_ROWS = 6;

/**
 * 最近 N 条 `StageLog(rescheduled)`（新在前）。
 * ⚠️ 与 D/E 同一口径（`deRescheduleRows` / `eiRescheduleRows` 三处逐字同款）——
 * 「第二真值源」在本仓出过三次事故，L3 的取数规则只许有一套。
 */
export function apRescheduleRows(vm: PrintViewModel): readonly PrintStageLogVM[] {
  return vm.stageLogs
    .filter((l) => l.type === StageLogType.Rescheduled)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, AP_RESCHED_MAX_ROWS);
}

/** L3 一行（走 H 的 `ap-block` 清单行语法：块头 2px 粗上线 + mono meta 行，§0.5） */
export interface ApReschedRow {
  key: string;
  stageName: string;
  /** `旧结束日 → 新结束日`（两端 mono；缺一端就只写有的那端） */
  span: string;
  reason: string;
  /** `2026-01-19 02:00 · 负责人甲` */
  at: string;
}

/** L3 的块高常量（px）：标题行 + 每条 + 收口行（实测回填见 CSS 头） */
export const AP_RESCHED_HEAD_H = 96;
export const AP_RESCHED_ROW_H = 38;
export const AP_RESCHED_FOOT_H = 18;

/** L3 明细行（缺日期的一端写 `—`；reason 为 null 时写「未记原因」，**不编原因**） */
export function apReschedRowsOf(vm: PrintViewModel): readonly ApReschedRow[] {
  return apRescheduleRows(vm).map((l) => ({
    key: l.id,
    stageName: l.stageName,
    span: `${(l.oldEndAt ?? '').slice(0, 10) || '—'} → ${(l.newEndAt ?? '').slice(0, 10) || '—'}`,
    reason: l.reason ?? '未记原因',
    at: `${stampOf(l.createdAt)} · ${l.operatorName}`,
  }));
}

/** L3 整块占高（px；0 = 整段不出，§0.5 的空态纪律） */
export function apReschedHeight(rows: readonly ApReschedRow[]): number {
  return rows.length === 0
    ? 0
    : AP_RESCHED_HEAD_H + rows.length * AP_RESCHED_ROW_H + AP_RESCHED_FOOT_H;
}

/* ====================================================================================
 * 5 块形态的页装配（「5 块 × 4 模板」重构 · 批 D）
 * ====================================================================================
 * ── 两张同族双栏页各自占物理页（§1.4 明写「B4 的清单页另有它自己的双栏」）──
 *   · B2 页（`span`）= ① 通栏覆盖带 + ② 双栏分段轴甘特 + ③ `ap-sum`「跨度总天数」
 *   · B4 页（`list`）= 双栏状态分组块（今天 H P1 原样）+ `ap-sum`「项目完成度」
 *     + L3 改期记录（只挂 B4 的**收口页**）
 * 两块**共用同一批切片**（同一批阶段先出「何时」页、再出「什么状态」页）。
 * 读者靠三样区分这对同族页：`ap-sum` 载荷措辞 / B2 有跨度条 / B4 有字段 meta。
 *
 * ── 为什么不做成「同页上下两半」──
 * 704px 正文装不下两套双栏 + 两个 ap-sum（实测：覆盖带 38 + 甘特 8 行 + 状态块 7 行
 * + 两个摘要块 ≈ 1200px）。team-lead 的任务书也把「若这条分工在连续翻页里撑不住，
 * 停下报我，别自己合并两块」写成了硬约束 —— 故本实现**不合并**。
 */

/** B2 页的栏区可用总高（px）= 通用栏区 − 覆盖带 − 口径注行 */
export const AP_SPAN_NOTE_H = 22;
export const AP_SPAN_AVAIL = AP_POSTER_ROWS_H - AP_SPAN_BAND_H - AP_SPAN_NOTE_H;

/** 一个 5 块物理页的子形态 */
export type ApBlockSub =
  /** B2 页：三段式甘特 */
  | { kind: 'span'; span: ApSpanPage }
  /** B4 页：双栏状态分组块（复用 `PosterSheetBody`，今天 H 的阶段海报原样） */
  | { kind: 'list'; sheet: PosterSheet }
  /** 页壳：两块都被摘掉（或本就没有阶段）时，仍出一张「B1 + B3 + B5」的纸 */
  | { kind: 'shell' };

export interface ApBlockPage {
  sub: ApBlockSub;
  /** 本页是 B4 的**收口页**（L3 改期记录挂这；§0.5） */
  lastList: boolean;
}

/**
 * B4 页的分页（带 L3 预留）。
 *
 * ⚠️ **与 legacy 的 `planPosterSheets` 不同源，且这是有意的**：5 块形态里 B4 的
 * 收口页要额外装下 L3（`apReschedHeight`），legacy 路径不装 L3 ⇒ 容量分界线不同。
 * 硬合并会算错（批 B 裁决第 4 条同款理由：`DE_BLOCK_COMPACT_AT` 与 legacy 的 9
 * 不同源）。
 *
 * 做法（两段式，**只在真装不下时才多出一页**）：
 *   ① 先按**不留 L3** 的容量 `cap` 正常分页；
 *   ② 若最后一页的栏高 > `capTail`（留了 L3 的容量），把最后一页每栏超出
 *      `capTail` 的**尾部行**挪进新的一页 —— 新页带着这些行 + L3，是真正的
 *      「续页尾段」（§0.5 明文：不单独成页，不与 L3 单独成一张纸）。
 * 全程确定性，且渲染侧与装配侧读同一个切片 ⇒ 预计 = 实际。
 */
function apListPages(vm: PrintViewModel, reschedH: number): PosterSheet[] {
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
  const capOf = (avail: number): number =>
    Math.max(1, Math.floor((avail - AP_POSTER_COL_HEAD_H) / AP_POSTER_BLOCK_H));
  const cap = capOf(AP_POSTER_ROWS_H);
  const capTail = capOf(AP_POSTER_ROWS_H - reschedH);
  const pageBlocks = planPosterPages(
    columns.map((c) => c.blocks),
    cap,
  );
  // ② 收口页塞不下 L3 ⇒ 把最后一页的尾部行挪到新的一页（那一页才挂 L3）
  if (reschedH > 0 && pageBlocks.length > 0) {
    const last = pageBlocks[pageBlocks.length - 1]!;
    if (Math.max(...last.map((b) => b.length)) > capTail) {
      pageBlocks[pageBlocks.length - 1] = last.map((b) => b.slice(0, capTail));
      pageBlocks.push(last.map((b) => b.slice(capTail)));
    }
  }
  return pageBlocks.map((blocksOfPage, i) => ({
    kind: 'stage-overview' as PosterKind,
    total: rows.length,
    chunkIndex: i,
    chunkTotal: pageBlocks.length,
    empty: rows.length === 0,
    meta: stagePosterMeta(vm, stats),
    columns: columns
      .map((c, ci) => ({ ...c, blocks: blocksOfPage[ci] ?? [] }))
      .filter((c) => c.blocks.length > 0),
    summary: stagePosterSummary(stats),
    scope: STAGE_FIELD_SCOPE,
    legend: stagePosterLegend(vm),
    notes: stagePosterNotes(vm),
  }));
}

/**
 * 5 块形态的 H 物理页序列（**预计页数 = 实际出纸**的唯一出处）。
 *
 * `blocks` = 用户在五块清单里的勾选态（B1 / B5 在 H 是装置级，见 §2.6）。
 */
export function agentPosterBlockPages(
  vm: PrintViewModel,
  blocks: { timeline: boolean; stageTable: boolean },
): ApBlockPage[] {
  const out: ApBlockPage[] = [];
  const reschedH = blocks.stageTable ? apReschedHeight(apReschedRowsOf(vm)) : 0;

  // ── 无可见阶段：两块都无非画不可的东西（B2 的覆盖带更是「装饰填版」）⇒ 只出一张
  //    空态纸（B4 的空态载体，02 §8 的明确空态），不造数据填版。
  if (vm.stages.length === 0) {
    const sheets = apListPages(vm, 0);
    return [{ sub: { kind: 'list', sheet: sheets[0]! }, lastList: true }];
  }

  if (blocks.timeline) {
    for (const span of planApSpanPages(vm, AP_SPAN_AVAIL)) {
      out.push({ sub: { kind: 'span', span }, lastList: false });
    }
  }
  if (blocks.stageTable) {
    const sheets = apListPages(vm, reschedH);
    sheets.forEach((sheet, i) => {
      out.push({ sub: { kind: 'list', sheet }, lastList: i === sheets.length - 1 });
    });
  }
  // 两块都被摘掉 ⇒ 仍出一张页壳（B1 + B3 + B5；原则 1 的三件不许消失）
  if (out.length === 0) out.push({ sub: { kind: 'shell' }, lastList: false });
  return out;
}
