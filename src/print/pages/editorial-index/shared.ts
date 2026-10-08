/**
 * E 版三页共用的小工具（状态字形双编码 / 刊头文案 / 时间戳 / 长列表分页器）。
 *
 * ── 为什么状态必须「字形 + 文字」双编码 ──
 * 01 §2：灰度打印仍须可读，状态不能只靠色相。E 版的朱红在灰度下变中灰，
 * 与发丝线灰混在一起；故每个状态都配一个**形状不同**的字形（实心 / 半满 /
 * 空心 / 三角），颜色只是第三重编码。各版自持一份（四版组件独立，01 §1）。
 *
 * ── 为什么分页器在这一层 ──
 * E 的阅读方式是「目录跳读」，长目录（20+ 阶段 / 多成员 / 多产出物）必须
 * **跨页稳定**（01 §9）：一页装不下就干净地分成多个物理纸面，章节头不
 * 孤儿、页码连续、每页可独立解释。分页器是纯函数（估高 + 贪心装页），
 * 单测可钉——视觉 spec 再用真 Chromium 断言每个物理页 794×1123 无溢出。
 */

import { StageStatus, TASK_STATUS_LABELS, TaskStatus } from '../../../core/types/enums';

/** 阶段四态标签（全仓无既有中文出处，打印纸面专用） */
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

/** 阶段四态字形（灰度可辨：实心 / 半满 / 空心 / 三角） */
export const STAGE_GLYPH: Record<StageStatus, string> = {
  [StageStatus.NotStarted]: '□',
  [StageStatus.InProgress]: '◐',
  [StageStatus.Completed]: '●',
  [StageStatus.Delayed]: '▲',
};

/** 章节顺序（目录跳读：进行中 → 延期 → 未开始 → 已完成；延期章是朱红焦点） */
export const EI_CHAPTER_ORDER: readonly StageStatus[] = [
  StageStatus.InProgress,
  StageStatus.Delayed,
  StageStatus.NotStarted,
  StageStatus.Completed,
];

/** 任务七态中文标签（复用全仓唯一出处 TASK_STATUS_LABELS） */
export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

/** 产出物种类标签（封闭枚举六值；全仓无既有中文出处，打印纸面专用——同 A 版台账标签自持） */
export const ARTIFACT_KIND_LABELS: Record<TaskArtifactKind, string> = {
  task_md: '任务档',
  doc: '文档',
  file: '文件',
  diff: '差异',
  link: '链接',
  other: '其他',
};

/** 产出物种类（entities.TaskArtifact.kind 的封闭枚举，此处只引类型） */
export type TaskArtifactKind = 'task_md' | 'doc' | 'file' | 'diff' | 'link' | 'other';

/** ISO 时间串 → 纸面用的「yyyy-MM-dd HH:mm」 */
export function stampOf(iso: string): string {
  return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
}

/** 任务来源标签（TaskSource 二值：human / agent；01 §3.2） */
export function taskSourceLabel(source: 'human' | 'agent'): string {
  return source === 'agent' ? 'Agent' : 'human';
}

/* ------------------------------------------------------------------ 长列表分页 */

/**
 * 章头载荷。`status`（阶段章）/ `kind`（成员章）/ `no`（产出物章的关联
 * 任务读号）是各页自己的判别键，共用 label + count；未知判别键的章按普通
 * 章渲染（不发焦点色）。
 */
export interface EiChapter {
  status?: StageStatus;
  kind?: 'agent' | 'human';
  /** 产出物章的关联任务读号（T-1001 形式；label 同时承载任务标题） */
  no?: string;
  label: string;
  count: number;
}

/** 一个可分页条目（目录行）。kind 供渲染层分发 */
export interface EiEntry<T> {
  kind: 'chapter' | 'row';
  /** 章节头（kind='chapter'） */
  chapter?: EiChapter;
  /** 目录行（kind='row'） */
  row?: T;
}

/** 分页输入：条目序列 + 每类条目的估高 + 每物理页可用高度 */
export interface EiPaginateInput<T> {
  entries: readonly EiEntry<T>[];
  /** 行估高（px；compact 档由调用方给小值） */
  rowHeight: number;
  /** 章节头估高（px） */
  chapterHeight: number;
  /** 每物理页主体可用高度（px = 纸面高 − 页头 − logo 行 − 页脚） */
  bodyHeight: number;
}

/**
 * 贪心装页（确定性：同输入同输出，无随机、无测量）。
 *
 * 三条不变量：
 *   ① 章节头不孤儿——页尾剩余放不下「章头 + 至少一行」时，章头连同整章
 *      推到下一页（读者不会在页脚边看到一个没有条目的章头）；
 *   ② 单行超高不裂行——行是最小原子单位，装不下就整行去下一页；
 *   ③ 跨页章续头——**只有该章在当前页已有行**（真跨页）时，新页顶部才
 *      补「（续）」章头；章恰好在页边界整章开始（当前页一行都没有）时
 *      标新章头，不标续（不被误导）。
 */
export function paginateEiEntries<T>(input: EiPaginateInput<T>): EiEntry<T>[][] {
  const { entries, rowHeight, chapterHeight, bodyHeight } = input;
  const pages: EiEntry<T>[][] = [];
  let current: EiEntry<T>[] = [];
  let used = 0;

  const flush = (): void => {
    if (current.length > 0) {
      pages.push(current);
      current = [];
      used = 0;
    }
  };

  /** 当前行的所属章（跨页续头判定用；null = 还没有任何章） */
  let activeChapter: EiEntry<T> | null = null;
  /** 当前页是否已有 activeChapter 的行（决定翻页后补不补续头） */
  let pageHasActiveRow = false;

  for (const entry of entries) {
    if (entry.kind === 'chapter') {
      activeChapter = entry;
      // 新章开张：本页对「这一章」还没有任何行（续头判定随章重置）
      pageHasActiveRow = false;
      continue;
    }
    // 本页还没落过这一章的行 ⇒ 这一行要先带章头（占位计入容量检查）
    const needHead = activeChapter !== null && !pageHasActiveRow;
    if (used + (needHead ? chapterHeight : 0) + rowHeight > bodyHeight && current.length > 0) {
      // 翻页前留住「本页有没有这一章的行」——决定新页补不补续头
      const hadActiveRow = pageHasActiveRow;
      flush();
      pageHasActiveRow = false;
      // 不变量 ③：仅当该章在刚翻过去的页上已有行，才补「（续）」头
      if (activeChapter !== null && hadActiveRow) {
        current.push(continuationChapter(activeChapter));
        used += chapterHeight;
        pageHasActiveRow = true;
      }
    }
    if (activeChapter !== null && !pageHasActiveRow) {
      current.push(activeChapter);
      used += chapterHeight;
      pageHasActiveRow = true;
    }
    current.push(entry);
    used += rowHeight;
  }
  // 尾巴：只剩章头没有行（空章不进 VM，防御性兜底）⇒ 丢弃，不出孤儿章头
  flush();
  return pages.length > 0 ? pages : [[]];
}

/** 跨页续头：复制章头并把标签加上「（续）」后缀（原章头条目不改） */
function continuationChapter<T>(chapter: EiEntry<T>): EiEntry<T> {
  const c = chapter.chapter;
  if (!c) return chapter;
  return {
    kind: 'chapter',
    chapter: { ...c, label: `${c.label}（续）` },
  };
}
