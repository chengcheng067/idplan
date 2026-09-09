/**
 * handoff bundle 生成（v0.6 · Egress，设计文档 §4.3 / PRD 附录 B）。
 *
 * ★ 安全边界（HF-04 硬要求：不含 members 任何字段）——
 *   本文件从**类型层面**就不给 `Member` 形状的入参：没有 members 数组、
 *   没有 contact / passwordHash 字段，想泄露也传不进来。
 *   指派人只能以 `assigneeLabels`（memberId → 显示名/agentKind 标签）的
 *   纯字符串映射传入，且输出中绝不出现 Member.id。
 *
 * 纪律：零 IO、零 repo import；剩余天数复用 `src/lib/date.ts` 的 `remainingDays`，
 * 禁止新写日期计算（设计文档 §4.3 安全设计表）。
 */

import type { Task } from '../types/entities';
import type { BlockedTask } from './dag';
import { remainingDays } from '../../lib/date';

/**
 * 交接包输入。
 *
 * `assigneeLabels`：由调用方（store）从 members 派生的「id → 展示名」映射，
 * 值只会是成员显示名或 agentKind 标签（如 `codex`）——**绝不传 Member 实体**。
 */
export interface HandoffInput {
  projectName: string;
  /** 生成时间（ISO datetime string，展示层截取日期段） */
  generatedAt: string;
  /** Ready 任务（应已按拓扑序排好；未排时本函数按 dueDate/orderIndex 兜底排序） */
  ready: readonly Task[];
  /** 被阻塞任务（含 blockedBy 明细） */
  blocked: readonly BlockedTask[];
  /** 拓扑层号（可选，用于在条目上标注批次顺序） */
  layerIndex?: ReadonlyMap<string, number>;
  /** 本轮主责 Agent 的 Harness 标签（如 'codex'），可空 */
  agentKindLabel?: string | null;
  /** memberId / agentId → 展示名（只收纯字符串映射，见文件头安全边界说明） */
  assigneeLabels?: Readonly<Record<string, string>>;
  /**
   * 已完成任务「task.id → title」映射（可选；QA 返工 🟡-2）。
   * Ready 任务的前置中已完成的条目据此在交接包中如实列出（PRD 附录 B）：
   * 下游 Agent 需知道哪些活已干完、不必重做。缺省时前置完成信息整行省略，
   * **绝不显示兜底假文案**（旧版「（见看板依赖区）」在 ready 里找 done 前置，
   * 永远找不到，属于恒显死文案）。
   */
  doneTaskTitles?: ReadonlyMap<string, string>;
}

/** 摘录 description 的首段（截断到 maxLength，避免交接包被长文撑爆） */
function excerpt(text: string | null, maxLength = 200): string | null {
  if (!text) return null;
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const base = (firstLine ?? text).trim();
  return base.length > maxLength ? `${base.slice(0, maxLength)}…` : base;
}

/** 指派人展示标签：优先 assigneeLabels[assigneeId]，其次 agentLabels[agentId]，兜底 '未指派' */
function assigneeLabelOf(
  t: Task,
  assigneeLabels?: Readonly<Record<string, string>>,
): string {
  if (t.assigneeId) return assigneeLabels?.[t.assigneeId] ?? t.assigneeId;
  if (t.agentId) return assigneeLabels?.[t.agentId] ?? 'agent';
  return '未指派';
}

/**
 * 生成 handoff bundle（Markdown，PRD 附录 B 结构）：
 *
 * 1. `# ID Plan · Agent Board — handoff bundle` + 项目/生成时间/Ready 计数
 * 2. `## 你现在该做的事（拓扑序 + 截止日）` —— 每条 5 行（status/截止/前置/artifacts/上游留言）
 * 3. `## 暂时不要碰（被阻塞）` —— 「X ← 依赖「Y」未完成」
 * 4. `## 回填格式` —— idplan-agent-payload/v1 回写说明
 */
export function buildHandoffBundle(input: HandoffInput): string {
  const lines: string[] = [];
  const labels = input.assigneeLabels ?? {};
  const ready = [...input.ready];
  const dayOf = (iso: string): string => iso.slice(0, 10);

  // 段 1：标题头 + 项目背景
  lines.push('# ID Plan · Agent Board — handoff bundle');
  lines.push('');
  lines.push(
    `项目：${input.projectName} ｜ 生成时间：${dayOf(input.generatedAt)} ｜ ` +
      `Ready 任务：${ready.length} 条` +
      (input.agentKindLabel ? ` ｜ 主责 Agent：${input.agentKindLabel}` : ''),
  );
  lines.push('');

  // 段 2：你现在该做的事（拓扑序 + 截止日）
  lines.push('## 你现在该做的事（拓扑序 + 截止日）');
  if (ready.length === 0) {
    lines.push('');
    lines.push('_（当前没有可执行的 Ready 任务。）_');
  }
  ready.forEach((t, i) => {
    lines.push('');
    lines.push(`### ${i + 1}. [${t.id}${t.externalId ? ` | ${t.externalId}` : ''}] ${t.title}`);
    const due = t.dueDate
      ? `截止 ${dayOf(t.dueDate)}（剩余 ${remainingDays(t.dueDate, dayOf(input.generatedAt))} 天）`
      : '未设截止';
    lines.push(`- status: ${t.status} ｜ ${due} ｜ assignee: ${assigneeLabelOf(t, labels)}`);
    // 前置完成信息（QA 返工 🟡-2）：ready 数组不含 done 任务，必须经
    // doneTaskTitles 映射查全量任务；无数据或全部前置未完成 → 整行省略。
    if (t.dependsOn && t.dependsOn.length > 0 && input.doneTaskTitles) {
      const doneTitles = t.dependsOn
        .map((dep) => input.doneTaskTitles?.get(dep))
        .filter((x): x is string => !!x);
      if (doneTitles.length > 0) {
        lines.push(`- 前置已完成：${doneTitles.map((s) => `${s} ✓`).join('、')}`);
      }
    }
    if (t.artifacts && t.artifacts.length > 0) {
      lines.push(`- artifacts 要求：${t.artifacts.map((a) => a.title).join('、')}`);
    }
    const note = excerpt(t.description);
    if (note) lines.push(`- 上游留给你的话：${note}`);
    const layer = input.layerIndex?.get(t.id);
    if (layer !== undefined) lines.push(`- 拓扑层：第 ${layer + 1} 层`);
  });
  lines.push('');

  // 段 3：暂时不要碰（被阻塞）
  lines.push('## 暂时不要碰（被阻塞）');
  if (input.blocked.length === 0) {
    lines.push('');
    lines.push('_（没有被阻塞的任务。）_');
  } else {
    for (const b of input.blocked) {
      const reason = b.blockedBy.map((d) => `依赖「${d.title}」未完成`).join('、');
      lines.push(`- ${b.task.title} ← ${reason}`);
    }
  }
  lines.push('');

  // 段 4：回填格式
  lines.push('## 回填格式');
  lines.push('');
  lines.push('请用 `idplan-agent-payload/v1` 回写 status=review 并附 artifacts。');
  lines.push('');

  return lines.join('\n');
}
