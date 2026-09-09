/**
 * Markdown 兼容子集 → AgentPayloadV1（v0.6 · 设计文档 T02 第 10 条）。
 *
 * 识别范围（MVP 刻意最小化，其余一律忽略）：
 *   - `# 任务标题`           → 新任务开始；
 *   - `deps: a, b`           → dependsOnExternal（引用 externalId，逗号分隔）；
 *   - `- [ ]`                → status = draft；
 *   - `- [x]`                → status = done；
 *   - 标题下的普通文本行     → description（连续行拼接）。
 *
 * `externalId` 缺失时按 `${agentKind}:${runId}:md-${index}` 合成——保证幂等键
 * 永远存在（Markdown 没有 stable key，只能靠「同一次解析的行序」做弱幂等）。
 *
 * 纪律：零 IO、零 repo import；输出可直接交给 validateAgentPayload 校验。
 */

import { TaskStatus } from '../types/enums';
import type { AgentPayloadTask, AgentPayloadV1 } from '../types/agent-payload';
import { AGENT_PAYLOAD_SCHEMA_ID } from '../types/agent-payload';

/** Markdown 解析入参（producedBy 复用 payload 的产出者形状） */
export interface MarkdownIngestInput {
  actorKind: 'agent' | 'human';
  agentKind: string;
  agentName: string;
  runId: string;
}

/** 解析出的单条任务（含行号，供 UI 报错定位） */
export interface ParsedMarkdownTask extends AgentPayloadTask {
  /** 该任务在源文本中的 1-based 行号 */
  lineNo: number;
}

/**
 * 解析 Markdown 任务清单。
 *
 * 规则细节：
 *   - 仅 `#`（单井号）视为任务标题；`##`/`###` 等为章节标题，忽略；
 *   - `deps:` 行必须在标题之后、下一个标题之前；
 *   - `- [x]` / `- [ ]` 行决定该任务状态（一个标题只对应**一条**任务）；
 *   - 无任何任务标题时返回 `tasks: []`（由 validateAgentPayload 的 min(1) 拒绝）。
 */
export function parseMarkdownTasks(text: string, producedBy: MarkdownIngestInput): AgentPayloadV1 {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');

  const tasks: ParsedMarkdownTask[] = [];
  let current: ParsedMarkdownTask | null = null;
  let descriptionLines: string[] = [];
  let index = 0;

  const flush = (): void => {
    if (!current) return;
    current.description = descriptionLines.length > 0 ? descriptionLines.join('\n') : null;
    tasks.push(current);
    current = null;
    descriptionLines = [];
  };

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i] ?? '';
    const trimmed = line.trim();

    // 任务标题：仅单井号
    const titleMatch = /^#\s+(.+)$/.exec(trimmed);
    if (titleMatch) {
      flush();
      index += 1;
      current = {
        externalId: `${producedBy.agentKind}:${producedBy.runId}:md-${index}`,
        title: titleMatch[1]!.trim(),
        description: null,
        status: TaskStatus.Draft,
        assigneeAgentKind: null,
        assigneeHuman: null,
        dependsOnExternal: [],
        startAt: null,
        dueDate: null,
        artifacts: [],
        lineNo: i + 1,
      };
      continue;
    }

    if (!current) continue; // 标题前的内容（前言/说明）忽略

    // deps 行：`deps: a, b`（大小写不敏感的键名）
    const depsMatch = /^deps\s*:\s*(.+)$/i.exec(trimmed);
    if (depsMatch) {
      current.dependsOnExternal = depsMatch[1]!
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      continue;
    }

    // 复选框行：`- [ ]` draft / `- [x]` done（- [X] 同样接受）。
    // 复选框后的文字是清单条目内容，归入 description（承接「验收清单」语义）。
    const doneBox = /^[-*]\s+\[x\]\s*(.*)$/i.exec(trimmed);
    if (doneBox) {
      current.status = TaskStatus.Done;
      const text = doneBox[1]!.trim();
      if (text.length > 0) descriptionLines.push(text);
      continue;
    }
    const openBox = /^[-*]\s+\[\s?\]\s*(.*)$/.exec(trimmed);
    if (openBox) {
      current.status = TaskStatus.Draft;
      const text = openBox[1]!.trim();
      if (text.length > 0) descriptionLines.push(text);
      continue;
    }

    // 其余非空行为 description 素材（跳过表格/代码块围栏等明显非正文行）
    if (trimmed.length > 0 && !trimmed.startsWith('|') && !trimmed.startsWith('```')) {
      descriptionLines.push(trimmed);
    }
  }
  flush();

  return {
    schema: AGENT_PAYLOAD_SCHEMA_ID,
    projectId: null,
    stageId: null,
    producedBy: {
      actorKind: producedBy.actorKind,
      agentKind: producedBy.agentKind,
      agentName: producedBy.agentName,
      runId: producedBy.runId,
    },
    tasks: tasks.map(({ lineNo: _lineNo, ...t }) => t),
  };
}
