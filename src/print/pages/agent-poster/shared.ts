/**
 * H 版三页共用的小工具（执行十态 / 提案五态的语义分组、字形双编码、
 * 文案口径）。治理公示稿——**口径写错是对外事故**，故本文件把 01 文档
 * §3.3 / §7 的每一条口径固化成可单测的常量与纯函数。
 *
 * ── 颜色语义（01 §7）──
 *   橙 = 等待人工介入 / 治理焦点（awaiting_confirmation / needs_attention /
 *        awaiting_review / Proposed / Conflict）
 *   黑 = 系统推进 / 当前主状态（draft / queued / running / paused / Applied…）
 * 每态同时带**形状不同的字形**（灰度打印不靠色相，01 §2）。
 *
 * ── 为什么十态按「四组流程」组织 ──
 * 01 §7 P2 明文：10 态按四组流程组织、running 为主焦点。四组 =
 *   ① 准备（draft / awaiting_confirmation / queued）——从起草到待调度
 *   ② 执行（running / paused）——系统推进
 *   ③ 人工门控（needs_attention / awaiting_review）——等待人工介入
 *   ④ 终局（completed / failed / cancelled）——只读归档
 */

import { WRITEBACK_WRITABLE_FIELDS } from '../../../core/types/agent-execution';
import type { ExecutionStatus, WritebackProposalStatus } from '../../../core/types/agent-execution';

/** 执行十态中文标签（打印纸面专用；全仓无既有中文出处，同 A 版台账标签自持） */
export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  draft: '草稿',
  awaiting_confirmation: '待确认',
  queued: '排队中',
  running: '执行中',
  paused: '已暂停',
  needs_attention: '待处理',
  awaiting_review: '待验收',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/** 提案五态中文标签（同上，打印纸面专用） */
export const WRITEBACK_STATUS_LABELS: Record<WritebackProposalStatus, string> = {
  draft: '草稿',
  proposed: '待批准',
  applied: '已落库',
  rejected: '已拒绝',
  conflict: '冲突',
};

/** 色调档：gate = 橙（人工介入/治理焦点）；run = 黑（当前主焦点）；
 *  sys = 黑（系统推进）；term = 灰（终局归档）。 */
export type PosterTone = 'gate' | 'run' | 'sys' | 'term';

/** 执行十态 → 色调（颜色语义的唯一出口，三页共用） */
export const EXECUTION_STATUS_TONE: Record<ExecutionStatus, PosterTone> = {
  draft: 'sys',
  awaiting_confirmation: 'gate',
  queued: 'sys',
  running: 'run',
  paused: 'sys',
  needs_attention: 'gate',
  awaiting_review: 'gate',
  completed: 'term',
  failed: 'term',
  cancelled: 'term',
};

/** 提案五态 → 色调 */
export const WRITEBACK_STATUS_TONE: Record<WritebackProposalStatus, PosterTone> = {
  draft: 'sys',
  proposed: 'gate',
  applied: 'term',
  rejected: 'term',
  conflict: 'gate',
};

/** 执行十态字形（形状互异的双编码；灰度下不靠色相） */
export const EXECUTION_STATUS_GLYPH: Record<ExecutionStatus, string> = {
  draft: '○',
  awaiting_confirmation: '◐',
  queued: '□',
  running: '◉',
  paused: '◑',
  needs_attention: '▲',
  awaiting_review: '△',
  completed: '●',
  failed: '■',
  cancelled: '⊘',
};

/** 提案五态字形 */
export const WRITEBACK_STATUS_GLYPH: Record<WritebackProposalStatus, string> = {
  draft: '○',
  proposed: '◐',
  applied: '●',
  rejected: '■',
  conflict: '▲',
};

/** 执行来源标签（ExecutionSource 四类；打印纸面专用） */
export const EXECUTION_SOURCE_LABELS: Record<string, string> = {
  'project-task': '项目任务',
  'natural-language': '自然语言',
  external: '外部接入',
  template: '模板触发',
};

/* ------------------------------------------------ 四组流程（P2 的分组骨架） */

export interface StatusGroup {
  key: 'prepare' | 'execute' | 'gate' | 'terminal';
  /** 组名（大字号状态分组的标题） */
  label: string;
  /** 组内状态（顺序即组内阅读序） */
  statuses: readonly ExecutionStatus[];
  /** 组色调（人工门控组 = 橙；执行组 = 当前主焦点黑） */
  tone: PosterTone;
  /** 组注（一行口径说明） */
  note: string;
}

/** 四组流程（01 §7 P2 明文；顺序即纸面顺序） */
export const EXECUTION_STATUS_GROUPS: readonly StatusGroup[] = [
  {
    key: 'prepare',
    label: '准备',
    statuses: ['draft', 'awaiting_confirmation', 'queued'],
    tone: 'sys',
    note: '从起草到待调度：awaiting_confirmation 等待人工批准后进入排队',
  },
  {
    key: 'execute',
    label: '执行',
    statuses: ['running', 'paused'],
    tone: 'run',
    note: 'running 为当前主状态（本页主焦点）；paused 为合作式暂停',
  },
  {
    key: 'gate',
    label: '人工门控',
    statuses: ['needs_attention', 'awaiting_review'],
    tone: 'gate',
    note: '等待人工介入：补输入 / 处理冲突 / 验收产物，不自动推进',
  },
  {
    key: 'terminal',
    label: '终局',
    statuses: ['completed', 'failed', 'cancelled'],
    tone: 'term',
    note: '终态只读归档；迟到回执不得再改写',
  },
];

/** 人工门控状态集合（治理焦点的判定出口：giant 字/卡片配色共用） */
export const GATE_STATUSES: ReadonlySet<ExecutionStatus> = new Set<ExecutionStatus>([
  'awaiting_confirmation',
  'needs_attention',
  'awaiting_review',
]);

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

/**
 * 状态键 → 巨字（下划线转空格；全大写）。
 *
 * ⚠️ **纸面已解绑**（规格 §1.4 拍板）：页顶巨字载荷换成用户自定义品牌词
 * （`print.brandWord`，默认 `PLAN`），状态表达归双栏栏头。本函数不再被
 * agent-poster 纸面消费，**保留供其他出口使用**（不删业务常量）。
 */
export function statusToGiantWord(status: ExecutionStatus): string {
  return status.replace(/_/g, ' ').toUpperCase();
}

/** 焦点执行选取（确定性）：running → needs_attention → awaiting_review →
 *  awaiting_confirmation → 其余非终态（新→旧）→ 终态（新→旧）。
 *  治理公示稿的「当前主状态」必须有唯一确定答案，不许「看排序心情」。 */
export function pickFocusExecution<T extends { status: ExecutionStatus; createdAt: string }>(
  executions: readonly T[],
): T | null {
  const priority: ExecutionStatus[] = [
    'running',
    'needs_attention',
    'awaiting_review',
    'awaiting_confirmation',
    'queued',
    'paused',
    'draft',
    'completed',
    'failed',
    'cancelled',
  ];
  let best: T | null = null;
  let bestRank = Number.MAX_SAFE_INTEGER;
  for (const e of executions) {
    const rank = priority.indexOf(e.status);
    if (rank === -1) continue;
    if (
      best === null ||
      rank < bestRank ||
      (rank === bestRank && e.createdAt > best.createdAt)
    ) {
      best = e;
      bestRank = rank;
    }
  }
  return best;
}

/** ISO 时间串 → 纸面用的「yyyy-MM-dd HH:mm」 */
export function stampOf(iso: string): string {
  return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
}

/** confidence 展示格式（0..1 → 百分比两位；仅展示，01 §3.3） */
export function formatConfidence(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/**
 * 写回白名单四项（**直接引用执行域唯一出处** WRITEBACK_WRITABLE_FIELDS，
 * 不复制字面量——治理公示稿与写入侧校验必须同源，复制必漂移）。
 */
export const WRITEBACK_WHITELIST_ITEMS: readonly string[] = WRITEBACK_WRITABLE_FIELDS;

/** 白名单旁的口径注（01 §7 P3 明文） */
export const WRITEBACK_READONLY_NOTE = '其余字段只读';

/** confidence 旁标（01 §7 P1 明文） */
export const CONFIDENCE_DISPLAY_NOTE = '仅供参考';
