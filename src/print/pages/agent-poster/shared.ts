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

/** 巨字档位：按焦点状态词长度分三档（长词不许撑破纸面） */
export function giantTier(word: string): 'xl' | 'lg' | 'md' {
  if (word.length <= 8) return 'xl';
  if (word.length <= 13) return 'lg';
  return 'md';
}

/** 状态键 → 巨字（下划线转空格；纸面巨字语言） */
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
