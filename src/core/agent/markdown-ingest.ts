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
 * `externalId` 由**任务身份**合成：`${agentKind}:md-${titleHash}`（v0.7 P0-2）。
 *
 * ⚠️ **为什么不能用 `runId` / 行序当幂等键**（v0.7 P0-1 / P0-2，务必别改回去）：
 * 旧实现是 `${agentKind}:${runId}:md-${index}`，两个成分都是**运行时属性而非任务身份**：
 *   - `runId` 每次运行都变 → 同一批逻辑任务每天拿到**新 externalId** → 幂等全部落空；
 *   - `index` 是标题出现序 → 在文档开头插一条任务，后续**全部 index 后移** → 整批重建。
 * 合起来的后果不是「没帮忙」而是**帮倒忙**：用户每次同步都得到一份重复任务，
 * 清理脏数据的成本高于不用这个通道。
 * 因此键只保留**标题**这一人类可维护、且天然稳定的身份；`runId` 只进
 * `producedBy.runId`（用于溯源/批次统计），**绝不进 externalId**。
 *
 * 标题冲突（同一文档里两条同名标题）：首条用 base，其后**追加 `-2` / `-3`**。
 * 这是刻意保留的确定性行为——同名标题本身无法区分，只能靠出现序消歧，
 * 且仅在这种情况下才引入序依赖（旧实现是**无条件**依赖序）。
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
 * 标题规范化 —— 只做**不会改变语义**的归一，保证「同一标题永远得到同一哈希」：
 *   - NFKC（全角/半角、兼容字符统一，中文标题基本不变，但 `Ａ`→`A` 这类要归一）；
 *   - 首尾空白去除；
 *   - 内部连续空白（含全角空格、Tab）压成单个半角空格。
 *
 * ⚠️ **不做**大小写折叠：`Fix bug` 与 `fix bug` 视为两条不同任务。
 * 理由：大小写在本工具的语境里可能承载语义（模块名、专有名词），
 * 静默合并两条标题只差大小写的任务，比「少合并一次」危险得多。
 */
function normalizeTitle(title: string): string {
  return title.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/**
 * FNV-1a 32 位哈希 → 8 位十六进制。
 *
 * 为什么手写而不引依赖：需**同步**、**跨进程稳定**、且对同一标题跨版本永不变值
 * （幂等键一旦换算法，历史任务会整批变成"新任务"）。FNV-1a 实现只有几行、
 * 无平台差异，适合承担这个「一次定终身」的角色。
 *
 * 用码点遍历（`for..of`）而非下标：中文标题若含代理对（emoji 等），
 * 按 UTF-16 码元遍历会把一个字符拆成两半，导致同一标题在不同环境哈希不一致。
 */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    hash ^= cp;
    // 32 位 FNV 质数 16777619 的乘法用移位累加，避免超出双精度整数精度
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * 由「任务身份」合成幂等键。
 *
 * 组成：`${agentKind}:md-${标题哈希}`，冲突时追加 `-2` / `-3`……
 * **不含 `runId`、不含行序**（详见文件头 P0-1/P0-2 说明）。
 */
function buildExternalId(agentKind: string, title: string, seen: Map<string, number>): string {
  const base = `${agentKind}:md-${fnv1aHex(normalizeTitle(title))}`;
  const hit = seen.get(base) ?? 0;
  seen.set(base, hit + 1);
  // 首条用 base 本体；第 2 条起 `-2`、`-3`（人类可读的消歧后缀，不是哈希）
  return hit === 0 ? base : `${base}-${hit + 1}`;
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
  /** base 幂等键 → 已出现次数（仅同名标题消歧用；不存在跨运行状态，每次解析从零开始） */
  const seenExternalIds = new Map<string, number>();
  let descriptionLines: string[] = [];

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
      const title = titleMatch[1]!.trim();
      current = {
        externalId: buildExternalId(producedBy.agentKind, title, seenExternalIds),
        title,
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
