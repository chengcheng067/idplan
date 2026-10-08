/**
 * D 版四页共用的小工具（状态字形双编码 / 文案 / 时间戳格式）。
 *
 * ── 为什么状态必须「字形 + 文字」双编码 ──
 * 01 §2：灰度打印仍须可读，状态不能只靠色相。D 版的信号橙红在灰度下会变成
 * 中灰，与灰阶素材混在一起；故每个状态都配一个**形状不同**的字形（实心 /
 * 半满 / 空心 / 三角），颜色只是第三重编码。这套字形与 A 版同源（同一套
 * 纸面阅读语言），但各版自持一份——四版组件必须独立（01 §1）。
 *
 * ── 为什么时间戳格式在这层 ──
 * generatedAt 是 ISO 全串，纸面要「yyyy-MM-dd HH:mm」。A 版自带一个私有
 * stampOf；D 版不跨版 import（版本组件独立），同族小函数各持一份，三行
 * 逻辑不存在漂移风险。
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

/**
 * 任务七态 → 纸面四类视觉编码（01 §5 P2：必须能区分已完成 / 进行中 /
 * 未启动 / 异常）：
 *   · done          → 实心（ink 填充反白）
 *   · in_progress   → 粗边（2px ink 描边）
 *   · blocked       → 信号边（2px 橙红描边 + 信号字；阻塞 = 重点状态）
 *   · 其余五态      → 细边（1px 灰描边；未启动一族）
 */
export type TaskNodeTone = 'done' | 'active' | 'blocked' | 'idle';

export function taskNodeTone(status: TaskStatus): TaskNodeTone {
  switch (status) {
    case TaskStatus.Done:
      return 'done';
    case TaskStatus.InProgress:
      return 'active';
    case TaskStatus.Blocked:
      return 'blocked';
    default:
      return 'idle';
  }
}

/** 任务七态字形（与 tone 对应的形状编码） */
export function taskGlyph(status: TaskStatus): string {
  switch (taskNodeTone(status)) {
    case 'done':
      return '●';
    case 'active':
      return '◐';
    case 'blocked':
      return '▲';
    default:
      return '□';
  }
}

/** 任务七态中文标签（复用全仓唯一出处 TASK_STATUS_LABELS） */
export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

/** ISO 时间串 → 纸面用的「yyyy-MM-dd HH:mm」 */
export function stampOf(iso: string): string {
  return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
}

/** 百分比整数（四舍五入；0-100 的展示口径） */
export function pct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/**
 * 文本截断（按显示宽度估算：CJK 全宽 1、拉丁 0.56）。
 * SVG text 不换行，超宽必须截；完整文本经 <title> / title 属性保留（02 §8）。
 */
export function truncateToWidth(text: string, maxWidth: number, fontSize: number): string {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const w = (ch.codePointAt(0) ?? 0) > 0x2e7f ? fontSize : fontSize * 0.56;
    if (width + w > maxWidth) {
      return i === 0 ? '' : text.slice(0, i) + '…';
    }
    width += w;
  }
  return text;
}
