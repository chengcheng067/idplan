/**
 * Agent 工作区术语映射（v0.7 · T04 根因修复 · PRD §4.5 / §2A.3）。
 *
 * 原则：内部数据结构与 API 一律不改（Project / Stage / Task），只在 UI 展示层
 * 按**显式声明的模式**切换术语。铁律 7 的延伸：**文案唯一出处**，
 * 组件不得自己硬编码行业词或开发者词。
 *
 * ── v0.7 T04 根因修复（强制，非可选）──
 * 旧版签名 `termFor(key, mode: AgentTermMode = 'agent')` 带**缺省值**，
 * 全站调用点一律写 `termFor('stage')` —— 于是 `default`（人话）模式
 * **从未生效过**，术语表的一半是死代码。这是「文档说支持双模式、
 * 实际只有单模式」的根因，不是文案问题。
 *
 * 修复方式不是「把缺省值改成 human」（那只是把死代码换成另一半），
 * 而是**从类型层根绝漏传**：
 *   `termFor(key: AgentTermKey, mode: AgentTermMode)` —— mode **必填**。
 * 开发期若误写 `termFor('stage')`，`tsc --noEmit` 直接编译失败
 * （v0.6 起 typecheck 零错误是合并门禁，故此处没有「漏网」空间）。
 *
 * ── 模式命名（D2 对齐）──
 * 旧 `'default' | 'agent'` 的命名本身是问题的一部分：「default」不说明
 * 它对谁 default（对设计师？对首次访问者？），「agent」把**一种读者**当成
 * **一种视图**。v0.7 改名 `'human' | 'tech'`，直接描述「写给谁看」：
 *   · `human` —— 人话：给设计师/项目经理看（「阶段」「待办」「交接包」）
 *   · `tech`  —— 技术：给 Agent/工程师看（「批次（Batch）」「Ready」「handoff bundle」）
 * 文案值**一字未改**（仅列名 default→human、agent→tech），
 * 保证这是纯粹的重命名 + 强制显式化，不夹带任何措辞调整。
 */

export type AgentTermMode = 'human' | 'tech';

/** 模式默认值（唯一出处）：首次进入与人读优先，故 human */
export const DEFAULT_AGENT_TERM_MODE: AgentTermMode = 'human';

export type AgentTermKey =
  | 'stage' // human: 阶段        / tech: 批次（Batch）
  | 'stageShort' // human: 阶段        / tech: 批次（窄位省「（Batch）」）
  | 'applyPayload' // human: 导入任务    / tech: Apply payload
  | 'ready' // human: 待办        / tech: Ready
  | 'handoff' // human: 交接包      / tech: handoff bundle
  | 'artifacts' // human: 产出物      / tech: artifacts（产出物）
  | 'deps' // human: 依赖        / tech: deps（依赖）
  | 'timeline' // human: 时间轴      / tech: Timeline
  | 'client' // human: 委托方      / tech: 客户 / 委托方（行业旧称已被 §0.5 常驻约束禁用）
  | 'onsite' // human: 现场        / tech: 现场（同上）
  | 'board' // human: 项目看板    / tech: Agent Board
  | 'claimedBy' // human: 负责人      / tech: claimed by
  | 'blockedBy'; // human: 被…阻塞    / tech: blocked by

/**
 * 术语表：key → mode → 文案。新增词必须**两种 mode 同时给**
 * （类型 `Record<AgentTermMode, string>` 强制，缺一列编译失败——
 * 「缺词回落」不作为偷懒借口，回落仅用于未知 key 的开发期兜底）。
 */
export const AGENT_TERMS: Readonly<Record<AgentTermKey, Record<AgentTermMode, string>>> = {
  stage: { human: '阶段', tech: '批次（Batch）' },
  stageShort: { human: '阶段', tech: '批次' },
  applyPayload: { human: '导入任务', tech: 'Apply payload' },
  ready: { human: '待办', tech: 'Ready' },
  handoff: { human: '交接包', tech: 'handoff bundle' },
  artifacts: { human: '产出物', tech: 'artifacts（产出物）' },
  deps: { human: '依赖', tech: 'deps（依赖）' },
  timeline: { human: '时间轴', tech: 'Timeline' },
  client: { human: '委托方', tech: '客户 / 委托方' },
  onsite: { human: '现场', tech: '现场' },
  board: { human: '项目看板', tech: 'Agent Board' },
  claimedBy: { human: '负责人', tech: 'claimed by' },
  blockedBy: { human: '被…阻塞', tech: 'blocked by' },
};

/**
 * 取词唯一入口：`termFor('stage', 'tech')` → 「批次（Batch）」。
 *
 * `mode` **必填**（T04 根因修复核心）：无缺省值，漏传即编译失败。
 * 未知 key 回落 key 本身（开发期兜底：新术语未登记时不至于白屏，
 * 且渲染出的 key 名在界面上一眼可辨，便于发现遗漏）。
 */
export function termFor(key: AgentTermKey, mode: AgentTermMode): string {
  return AGENT_TERMS[key]?.[mode] ?? key;
}

/**
 * 建议的可开工标签（**不复用 `ready` key**）。
 *
 * 文档 §4.3 注：`ready` 的 human 文案「待办」偏泛，不足以表达
 * 「依赖已满足、现在就能动手」这层语义，且「可开工」需全行业中性
 * （不带任何行业词）。故在 BOARD 组件内用本常量而非 `termFor('ready', ...)`。
 */
export const READY_NOW_LABEL = '可开工';

/**
 * Agent 成员 agentKind 建议值（**仅建议**，不是白名单）。
 *
 * ── 开放字符串铁律（PRD §0.5 / §2A.4，违反即功能退化）──
 * agentKind 是**自由输入字符串**，本数组只喂给 `<datalist>` 做输入联想，
 * 让新建 Agent 席位时少打字。**任何形式的封闭都禁止**：
 *   ✗ `z.enum([...])` / `z.nativeEnum(...)` —— zod 校验会拒绝未知厂商；
 *   ✗ TS `enum AgentKind { ... }` —— 类型层封闭，新增厂商要改类型定义；
 *   ✗ 提交前 `if (!AGENT_KIND_SUGGESTIONS.includes(kind)) reject` —— 白名单校验；
 *   ✗ 数据库 CHECK 约束 / 迁移里枚举化该列。
 *
 * 为什么必须开放：这是**功能需求**而非风格偏好——Agent 生态（workbuddy /
 * deepseek / codex / claude / copilot / gemini / 自研 / 未来新厂商）无法穷举，
 * 封闭一处就等于「今天能用的 Agent，明天出了新品用户加不进来」。
 * 正确做法：`agentKind: string`（非空即合法），本数组仅作 UI 联想。
 */
export const AGENT_KIND_SUGGESTIONS: readonly string[] = [
  'workbuddy',
  'deepseek',
  'codex',
  'claude',
  'copilot',
  'gemini',
];

/** Agent 席位上限（PRD 附录 C B5：免费 3 席位；MVP 只展示不拦截，BIZ-01 校验 V1 落地） */
export const AGENT_SEAT_LIMIT = 3;
