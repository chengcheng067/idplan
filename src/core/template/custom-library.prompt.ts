/**
 * 自定义行业包 · 给用户 Agent 的 prompt 生成器 + 失败路径人话化（v0.8.6 · 她反馈 #6.2）。
 *
 * ── 为什么 prompt 必须是代码生成、不能手写字符串 ──
 * 她反馈 #6.2 原话：「用户不可能在莫名其妙的情况下就拥有一个导入的行业包……
 * 应该有一个能够复制 prompt 或 skill 的按钮」。旧流程是「先有文件再找入口」——
 * 用户手里根本没有那个 JSON。新流程：复制 prompt → 用户在自己的 Agent 里生成 →
 * 导回校验。prompt 的实质是「schema 的人话版」，手写字符串 = 第二份契约，
 * schema 一改 prompt 就悄悄漂移。故本文件的全部规则（schema 字面量、字节上限、
 * key 前缀、条数上下限、看板列白名单、domain 白名单）都从
 * custom-library.schema / stage-library 的**常量**生成，唯一例外是最小示例
 * （它同时被 `CUSTOM_LIBRARY_MINIMAL_EXAMPLE` 的 TS 类型钉在 schema 上，改坏
 * schema 会让 tsc 先红）。
 *
 * ── 明确不放内置 74 阶段清单 ──
 * prompt 只给「约束的形状」不给「内置的答案」：附上内置 74 个阶段会让 Agent
 * 去模仿内置库，而不是生成用户自己的流程。测试 tests/custom-library-prompt.spec.ts
 * 有一条反向断言钉住这件事。
 *
 * ── 失败路径人话化（⑥ 四层之一）──
 * 导入失败的 zod 行话（`items.3.key: 阶段 key 必须以…`）对外行用户是天书：
 *   ① 路径翻译 translateCustomLibraryIssue（`items.3` → 第 4 个阶段）；
 *   ② 预告卡 CUSTOM_LIBRARY_ERROR_HINTS（最常见三种错误的自救指引）；
 *   ③④ 两层由 CustomLibrarySection 的 UI 承担（一键复制全部错误 / 不落半包）。
 * 三者都在纯函数层，可单测、可变异验证。
 */

import { DOMAIN_LABELS } from './stage-library';
import {
  CUSTOM_LIBRARY_KEY_PREFIX,
  CUSTOM_LIBRARY_MAX_BYTES,
  CUSTOM_LIBRARY_SCHEMA,
  KANBAN_COLUMN_VALUES,
} from './custom-library.schema';
import type { CustomLibraryFile, CustomLibraryIssue } from './custom-library.schema';
import type { StoredCustomLibrary } from './custom-library.service';

/* ---------- 结构常量（镜像 custom-library.schema 的约束；行为锚点在 spec） ---------- */

/** 阶段条数上下限（schema：items min(1).max(200)） */
const ITEMS_MIN = 1;
const ITEMS_MAX = 200;
/** 套餐条数上下限（schema：presets min(1).max(20)） */
const PRESETS_MIN = 1;
const PRESETS_MAX = 20;
/** 套餐引用阶段 key 条数上限（schema：itemKeys max(50)） */
const ITEM_KEYS_MAX = 50;
/** key 字符数上下限（schema：min(4).max(64)） */
const KEY_MIN = 4;
const KEY_MAX = 64;
/** 名称类字段上限（schema：name min(1).max(50)） */
const NAME_MAX = 50;
/** 套餐说明上限（schema：description max(200)） */
const DESCRIPTION_MAX = 200;
/** 单阶段默认任务条数上限（schema：defaultTasks max(20)） */
const TASKS_MAX = 20;

/* ---------- 最小完整示例（真实可导入；TS 类型钉死在 CustomLibraryFile 上） ---------- */

/**
 * 2 阶段 + 1 套餐的骨架。用户/Agent 照这个形状写即可过校验。
 * 类型标注 = CustomLibraryFile ⇒ 这个示例若与 schema 不再兼容，tsc 先红，
 * 不会出现「prompt 里的示例导入被拒」的漂移。
 */
export const CUSTOM_LIBRARY_MINIMAL_EXAMPLE: CustomLibraryFile = {
  schema: CUSTOM_LIBRARY_SCHEMA,
  name: '我的茶空间流程',
  domain: 'indoor',
  items: [
    {
      key: 'usr.site',
      name: '选址',
      ratioPercent: 30,
      colorIndex: 1,
      kanbanColumn: 'design',
      defaultResponsibility: '',
      defaultTasks: ['看场', '谈租金'],
    },
    {
      key: 'usr.open',
      name: '开业筹备',
      ratioPercent: 70,
      colorIndex: 2,
      kanbanColumn: 'promo',
      defaultResponsibility: '',
      defaultTasks: [],
    },
  ],
  presets: [
    {
      key: 'usr.tea-full',
      name: '茶空间全流程',
      description: '从选址到开业的最小闭环',
      itemKeys: ['usr.site', 'usr.open'],
    },
  ],
};

/* ---------- prompt 生成（纯函数：输入 = 用户的一句话 + 可选的参照库） ---------- */

export interface BuildCustomLibraryPromptOptions {
  /** UI 上「用一句话说你的行业」的输入（空 = 不追加该段） */
  userNote?: string;
  /** 勾选「附上我当前的行业库（N 个）作参照」时传入现有 customLibraries */
  referenceLibraries?: StoredCustomLibrary[];
}

/**
 * 生成给用户 Agent 的 prompt。拼接顺序（规格 ①②③）：
 * 规则主体（②，从常量生成）→ 用户的一句话描述（①）→ 参照库 JSON（③）。
 */
export function buildCustomLibraryPrompt(options: BuildCustomLibraryPromptOptions = {}): string {
  const { userNote, referenceLibraries } = options;

  const kbKb = Math.floor(CUSTOM_LIBRARY_MAX_BYTES / 1024);
  const domains = Object.entries(DOMAIN_LABELS)
    .map(([key, label]) => `${key}（${label}）`)
    .join(' / ');

  const parts: string[] = [
    `你是行业流程包生成助手。请按下面的规格，生成一个可以导入「ID Plan」（跨行业项目排程工具）的自定义行业库 JSON 文件。

【硬规则 · 违反任何一条都会被拒收】
- schema 字段必须严格等于 "${CUSTOM_LIBRARY_SCHEMA}"
- 整个文件不超过 ${kbKb}KB
- 阶段 key 和套餐 key 都必须以 "${CUSTOM_LIBRARY_KEY_PREFIX}" 开头（${KEY_MIN}-${KEY_MAX} 字符，只跟小写字母、数字、连字符）
- items 阶段 ${ITEMS_MIN}-${ITEMS_MAX} 个；presets 套餐 ${PRESETS_MIN}-${PRESETS_MAX} 个

【字段表】
- schema：固定 "${CUSTOM_LIBRARY_SCHEMA}"
- name：行业包名字，不超过 ${NAME_MAX} 字（如「我的茶空间流程」）
- domain：挂靠的主板块，只能是以下 10 个之一：${domains}
- items[]：阶段，每个包含
  - key："${CUSTOM_LIBRARY_KEY_PREFIX}" 开头的唯一键
  - name：阶段名，不超过 ${NAME_MAX} 字
  - ratioPercent：工作量占比，大于 0 且不超过 100 的数字
  - colorIndex：色号，1-9 的整数
  - kanbanColumn：看板列，只能是以下 24 个之一：${KANBAN_COLUMN_VALUES.join(' / ')}
  - defaultResponsibility：默认责任人，可省，不超过 ${NAME_MAX} 字
  - defaultTasks：默认任务清单，可省，最多 ${TASKS_MAX} 条、每条不超过 ${NAME_MAX} 字
  - customColor：自定义主色，#RRGGBB 十六进制，可省
- presets[]：套餐，每个包含
  - key："${CUSTOM_LIBRARY_KEY_PREFIX}" 开头的唯一键
  - name：套餐名，不超过 ${NAME_MAX} 字
  - description：套餐说明，可省，不超过 ${DESCRIPTION_MAX} 字
  - itemKeys：本套餐包含的阶段 key 列表，1-${ITEM_KEYS_MAX} 个，顺序即阶段顺序

【引用完整性 · 最常见的生成错误】
presets[].itemKeys 里的每个 key，必须能在同一个文件的 items[] 里找到；引用不存在的 key，整个文件会被拒收。生成后自查一遍：把每个套餐 itemKeys 的每一项，和 items 的 key 逐一比对。

【最小完整示例 · 真实可导入的形状，照这个骨架写】
\`\`\`json
${JSON.stringify(CUSTOM_LIBRARY_MINIMAL_EXAMPLE, null, 2)}
\`\`\`

【输出格式 · 硬性要求】
只输出一个 JSON 代码块，内容就是这个行业库文件本身。不要任何前言、解释、总结。用户会把它整体保存为 .json 文件后导入 ID Plan。`,
  ];

  const note = userNote?.trim();
  if (note) {
    parts.push(`【用户的一句话描述】\n${note}`);
  }

  if (referenceLibraries && referenceLibraries.length > 0) {
    parts.push(
      `【用户当前的行业库 · 仅供参考，不要照抄】\n${JSON.stringify(referenceLibraries, null, 2)}`,
    );
  }

  return parts.join('\n\n');
}

/* ---------- ⑥ 失败路径人话化：路径翻译 ---------- */

/** zod 字段名 → 人话（字段名是 JSON 契约的一部分，本来就要给用户看） */
const FIELD_LABELS: Record<string, string> = {
  key: 'key',
  name: '名称',
  domain: '主板块',
  schema: '版本标识',
  ratioPercent: '占比',
  colorIndex: '色号',
  kanbanColumn: '看板列',
  defaultResponsibility: '默认责任人',
  defaultTasks: '默认任务',
  customColor: '自定义主色',
  description: '说明',
  itemKeys: '阶段 key 列表',
  items: '阶段列表',
  presets: '套餐列表',
};

/** 根级字段的人话（与 FIELD_LABELS 分工：根上的 name 是「包名」，条目里的 name 是「名称」） */
const ROOT_LABELS: Record<string, string> = {
  name: '包名',
  domain: '主板块',
  schema: '版本标识',
  items: '阶段列表',
  presets: '套餐列表',
};

/** 从原始 JSON 里取第 N 个阶段/套餐的名字或 key（翻译里「它是谁」的出处） */
function entryLabelOf(raw: unknown, list: 'items' | 'presets', index: number): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const arr = (raw as Record<string, unknown>)[list];
  if (!Array.isArray(arr)) return null;
  const entry = arr[index];
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const name = typeof e.name === 'string' && e.name.trim() ? e.name.trim() : null;
  if (name) return name;
  const key = typeof e.key === 'string' && e.key.trim() ? e.key.trim() : null;
  return key;
}

function isIndex(s: string | undefined): boolean {
  return typeof s === 'string' && /^\d+$/.test(s);
}

function labelOf(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * 路径 → 人话位置。返回 '' 表示「消息本身就自明，不需要加前缀」。
 *
 * 覆盖三类：
 *   · `(root)` / ''        → 整个文件
 *   · `items.N[.field[.K]]` → 第 N+1 个阶段（的名字）的[第 M+1 条默认任务]
 *   · `presets.N[.field[.K]]` 同理；`presets.<key>`（引用完整性错误）自明 → ''
 * 未知形状原样给出路径（宁可暴露路径，不许把位置吞了）。
 */
export function describeCustomLibraryPath(path: string, raw?: unknown): string {
  if (!path || path === '(root)') return '整个文件';
  const t = path.split('.');
  const [head, idxRaw] = t;

  if (head === 'items' || head === 'presets') {
    const human = head === 'items' ? '阶段' : '套餐';
    if (t.length === 1) return labelOf(head);
    if (!isIndex(idxRaw)) {
      // presets.<key> 形式的引用完整性错误：message 已带「套餐「X」引用了…」→ 不自加前缀
      return '';
    }
    const n = Number(idxRaw);
    const who = entryLabelOf(raw, head, n);
    const base = who ? `第 ${n + 1} 个${human}（${who}）` : `第 ${n + 1} 个${human}`;
    const field = t[2];
    if (t.length === 2 || !field) return base;
    if (field === 'defaultTasks' && isIndex(t[3])) {
      return `${base}的第 ${Number(t[3]) + 1} 条默认任务`;
    }
    if (field === 'itemKeys' && isIndex(t[3])) {
      return `${base}引用的第 ${Number(t[3]) + 1} 个阶段 key`;
    }
    return `${base}的${labelOf(field)}`;
  }

  if (t.length === 1) {
    return ROOT_LABELS[head] ?? (labelOf(head) !== head ? labelOf(head) : head);
  }
  return path;
}

/**
 * ⑥-1 路径翻译：一条 issue → 一句人话。
 * 位置（第 N 个阶段…）+ 原消息（保留具体原因，不改写）。
 */
export function translateCustomLibraryIssue(issue: CustomLibraryIssue, raw?: unknown): string {
  const where = describeCustomLibraryPath(issue.path, raw);
  return where ? `${where}：${issue.message}` : issue.message;
}

/* ---------- ⑥ 预告卡：最常见三种错误的自救指引（静态三张，置于错误列表上方） ---------- */

export interface CustomLibraryErrorHint {
  id: 'json-only' | 'key-prefix' | 'dangling-reference';
  /** 错误名 */
  title: string;
  /** 自救动作 */
  fix: string;
}

/**
 * 最常见三种 Agent 生成错误的预告卡。**静态**（不按错误内容过滤）——
 * 导入失败时三张一起置于错误列表上方，用户对照着看。文案要求：
 * 只给动作，不说 zod/schema。
 */
export const CUSTOM_LIBRARY_ERROR_HINTS: readonly CustomLibraryErrorHint[] = [
  {
    id: 'json-only',
    title: 'Agent 多输出了说明文字，不是纯 JSON',
    fix: '回到 Agent 回复里，从第一个 { 复制到最后一个 }，存成 .json 再导入。',
  },
  {
    id: 'key-prefix',
    title: '阶段 key 忘了 usr. 前缀',
    fix: `所有 key 都要以 ${CUSTOM_LIBRARY_KEY_PREFIX} 开头，如 ${CUSTOM_LIBRARY_KEY_PREFIX}site。`,
  },
  {
    id: 'dangling-reference',
    title: '套餐引用了本包没有的阶段 key',
    fix: '检查每个套餐 itemKeys 里的 key，是否都写进了同一个文件的阶段里。',
  },
];

/**
 * ⑥-3「一键复制全部错误，贴回给 Agent」的文案（纯函数，UI 只负责复制）。
 * 给人看的翻译版 = 给 Agent 看的修正单（不吞信息、不分裂两套口径）。
 */
export function buildAgentFeedbackText(issues: readonly CustomLibraryIssue[], raw?: unknown): string {
  const lines = issues.map((i) => translateCustomLibraryIssue(i, raw));
  return [
    '我的行业包导入失败了，请按下面每一条修正，然后重新只输出一个 JSON 代码块：',
    ...lines.map((l, i) => `${i + 1}. ${l}`),
  ].join('\n');
}
