/**
 * Agent 工作区术语映射（v0.6 · PRD §2A.3「必须全项目统一，写死」）。
 *
 * 原则：内部数据结构与 API 一律不改（Project / Stage / Task），只在 UI 展示层
 * 按工作区模式切换术语。铁律 7 的延伸：**文案唯一出处**，组件不得自己硬编码
 * 行业词或开发者词。
 *
 * MVP 只需 `agent`（开发者语境）/ `default`（设计师语境）两种 mode；
 * `termFor(key, mode)` 是唯一取词入口，缺词回落 default。
 */

export type AgentTermMode = 'agent' | 'default';

export type AgentTermKey =
  | 'stage' // Stage：批次（Batch） / 阶段
  | 'stageShort' // 批次 / 阶段（窄位省「（Batch）」）
  | 'applyPayload' // Apply payload / 导入任务
  | 'ready' // Ready / 待办
  | 'handoff' // handoff bundle / 交接包
  | 'artifacts' // artifacts（产出物）/ 产出物
  | 'deps' // deps（依赖）/ 依赖
  | 'timeline' // Timeline / 时间轴
  | 'client' // 客户 / 委托方（行业旧称已被 §0.5 常驻约束禁用，两模式同规）
  | 'onsite' // 现场（同上）
  | 'board' // Agent Board / 项目看板
  | 'claimedBy' // claimed by / 负责人
  | 'blockedBy'; // blocked by / 被…阻塞

/** 术语表：mode → key → 文案。新增词必须两种 mode 同时给（缺词回落不作为偷懒借口） */
export const AGENT_TERMS: Readonly<Record<AgentTermKey, Record<AgentTermMode, string>>> = {
  stage: { agent: '批次（Batch）', default: '阶段' },
  stageShort: { agent: '批次', default: '阶段' },
  applyPayload: { agent: 'Apply payload', default: '导入任务' },
  ready: { agent: 'Ready', default: '待办' },
  handoff: { agent: 'handoff bundle', default: '交接包' },
  artifacts: { agent: 'artifacts（产出物）', default: '产出物' },
  deps: { agent: 'deps（依赖）', default: '依赖' },
  timeline: { agent: 'Timeline', default: '时间轴' },
  client: { agent: '客户 / 委托方', default: '委托方' },
  onsite: { agent: '现场', default: '现场' },
  board: { agent: 'Agent Board', default: '项目看板' },
  claimedBy: { agent: 'claimed by', default: '负责人' },
  blockedBy: { agent: 'blocked by', default: '被…阻塞' },
};

/**
 * 取词唯一入口：`termFor('stage', 'agent')` → 「批次（Batch）」。
 * mode 缺省 `agent`（Agent 工作区是本表的立项理由）；key 不存在回落 key 本身（开发期兜底可发现）。
 */
export function termFor(key: AgentTermKey, mode: AgentTermMode = 'agent'): string {
  return AGENT_TERMS[key]?.[mode] ?? key;
}

/**
 * Agent 成员 agentKind 建议值（**仅建议**——datalist 下拉，允许自由输入，
 * 开放字符串硬约束：禁止 enum / z.enum 封闭，见 PRD §0.5）。
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
