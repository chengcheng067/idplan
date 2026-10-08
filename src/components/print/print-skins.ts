/**
 * 打印模板注册表（v0.8.6.0002 · 反馈 #9.3「预留皮肤」的**升格**：
 * PrintSkinId → PrintTemplateId，产品决策文档 §2.3 迁移结论；
 * v1.5-a 期二「外表 × 模块分离」再升格：pages → 模块能力表，
 * 产品决策文档 §3.2/§3.3）。
 *
 * ── 为什么是「注册表 + 静态类映射」而不是拼类名 ──
 * 与 `stageColors.ts` 同纪律：模板 id → CSS 类名走**编译期固定的映射对象**，
 * 不许拿 id 去拼类名——拼出来的串不进 Tailwind 的 JIT 内容扫描，将来某个
 * 模板「有注册表条目但样式没生成」，表现是该模板静默退回默认外观，
 * 而不是构建期报错。本文件**任何位置不允许出现模板字符串**（有 spec 钉着）。
 *
 * ── 五套模板的类名口径（决策文档 §2.3 + 02 §5）──
 *   · A/D/E/H 四版：`.print-root.print-template-<id>`，四套样式各挂各的类；
 *   · classic（= 现有 SchedulePaper 纸面，default 皮肤原地转正，决策 ⑦）：
 *     类名**冻结为 `print-skin-default`**——它的 DOM 被 print-preview.spec ④ 的
 *     七选择器那族 spec 钉死，且 SchedulePaper.tsx 主体不在本次改动范围内
 *     （文件边界纪律）。printTemplateClass('classic') 如实返回这个类，
 *     注册表与 DOM 因此保持一致，不留「注册表说 A、DOM 挂 B」的暗坑。
 *
 * ── v1.5-a 期二：pages 语义改写为「模块能力表」（决策文档 §3.2/§3.3）──
 * 他的原话：「这 4 个新模板只是一个外表，里面的内容还是由我们 ID plan
 * 和用户来共同决定」「并不是说比如 H 版就只能是 Agent 的专属」——
 * **4 套模板 = 4 种排版外表（视觉系统 + 排版语法），11 个内容模块跨模板
 * 可选**。故 `PrintTemplateMeta.pages`（该模板的固定页列表）语义改为
 * `modules`（该模板**原生渲染**哪些模块 + 各自的原生页 kind）：
 *   · A：阶段清单 / 任务清单 / 延期台账 / 成员名册（4 原生）
 *   · D：进度矩阵 / 依赖网络 / 工作量构成 / 里程碑验收（4 原生）
 *   · E：阶段清单 / 成员名册 / 产出物清单（3 原生）
 *   · H：Agent 执行 / 写回提案（2 原生；Agent 执行 = 1 模块 2 页，1:N）
 *   · classic 不走模块表（另一套粒度：五块 blocks，决策文档 §2.2）⇒ 恒空
 * 11 个模块里不在某外表能力表中的 = **非原生**：选择器呈禁用态 + 原因
 * （通用渲染是期三分期补；本表先立「模块跨模板选」的产品形态，
 * 不装能打）。两层类型：选择器勾选 **PrintModuleId**（11 值，内容 id），
 * 纸面渲染 **PrintPageKind**（14 值，原生页 id）；勾选态按模板各存一套
 * （usePrintPrefsStore.pages，换模板不丢），纸面页序由 enabledPagesOf
 * 派生（注册表原生页序，与勾选顺序无关）。
 *
 * ── 未实现模板为什么也进注册表 ──
 * 决策 ⑥「四套全上」的实现顺序是分批落地：选择器要先能渲染五张卡（用户看得见
 * 全貌），点未实现的进「建设中」空态——**不许假装能打**（打印/导出禁用）。
 * `implemented: false` 就是这个开关，选择器与预览面板都读它。
 * D 版四页已落地（DataEditorialDocument + pages/data-editorial/）；E 版三页
 * （EditorialIndexDocument + pages/editorial-index/）与 H 版三页
 * （AgentPosterDocument + pages/agent-poster/）亦已落地，本条开关对
 * **五套全部转正**——注册表不再有「建设中」条目。
 */

import type {
  PrintPageKind,
  PrintTemplateId,
} from '../../print/model/print-view-model';

// 类型再导出（消费方从注册表一处取，不必深潜 model/；既有 import 路径零改动）
export type { PrintPageKind, PrintTemplateId };

/** 皮肤 id（legacy：v1 仅 'default'。SchedulePaper 主体仍消费它，见文件头） */
export type PrintSkinId = 'default';

export interface PrintSkin {
  id: PrintSkinId;
  /** 选择器用文案 */
  label: string;
}

/** 皮肤注册表（legacy，仅「经典」= 现有视觉） */
export const PRINT_SKINS: ReadonlyArray<PrintSkin> = [{ id: 'default', label: '经典' }];

/**
 * 皮肤 id → CSS 类名（**静态映射，禁止改成模板字符串拼接**，理由见文件头）。
 * 未知 id（含旧持久值脏数据）回落 default——纸面永远有类、永远可打印。
 */
const PRINT_SKIN_CLASS: Record<PrintSkinId, string> = {
  default: 'print-skin-default',
};

export function printSkinClass(id: PrintSkinId): string {
  return PRINT_SKIN_CLASS[id] ?? PRINT_SKIN_CLASS.default;
}

/* ============================== 模块层（期二新增） ============================== */

/**
 * 11 个内容模块（v1.5-a 期二；产品决策文档 §3.1 清单，顺序即 M1→M11）。
 * **模块 = 跨模板可选的内容件**：外表（模板）只决定排版语法，模块决定
 * 「打什么内容」。选择器勾选的是它；纸面渲染的是各外表的原生页
 * （PrintPageKind，见下方能力表）。
 */
export type PrintModuleId =
  | 'stage-list'
  | 'task-list'
  | 'delay-ledger'
  | 'member-roster'
  | 'progress-matrix'
  | 'dependency-network'
  | 'workload-composition'
  | 'milestone-acceptance'
  | 'artifact-list'
  | 'agent-execution'
  | 'writeback-proposals';

/** 模块元数据（label 模块名 + hint 一句话内容说明，选择器中截行文） */
export interface PrintModuleMeta {
  id: PrintModuleId;
  label: string;
  hint: string;
}

/** 11 个内容模块全量元数据（选择器中截按此序逐行呈现；顺序 = 决策文档 §3.1 M1→M11） */
export const PRINT_MODULES: ReadonlyArray<PrintModuleMeta> = [
  { id: 'stage-list', label: '阶段清单', hint: 'Stage 四态 / 日期 / 占比 / 负责人' },
  { id: 'task-list', label: '任务清单', hint: 'taskNo / 七态 / 负责人 / 产出物数' },
  { id: 'delay-ledger', label: '延期台账', hint: 'StageLog 改期 · 旧 / 新结束日 / 原因' },
  { id: 'member-roster', label: '成员名册', hint: 'human / agent · 角色 · 负责任务数' },
  { id: 'progress-matrix', label: '进度矩阵', hint: '阶段内任务完成度 / 日期 / 占比' },
  { id: 'dependency-network', label: '依赖网络', hint: 'dependsOn 有向图 · 环与缺失引用' },
  { id: 'workload-composition', label: '工作量构成', hint: 'ratioPercent 堆叠条 · 分期汇总' },
  { id: 'milestone-acceptance', label: '里程碑验收', hint: 'M1 / M2 / M3 · 验收清单与签署' },
  { id: 'artifact-list', label: '产出物清单', hint: '种类 / 关联任务 / 来源' },
  { id: 'agent-execution', label: 'Agent 执行', hint: '10 态四组流程 · runId / confidence' },
  { id: 'writeback-proposals', label: '写回提案', hint: '五态 · 四项白名单 · confidence' },
];

/** 全部模块 id（遍历 / 校验 / 勾选态排序用） */
export const PRINT_MODULE_IDS: readonly PrintModuleId[] = PRINT_MODULES.map((m) => m.id);

/** 模块 id → 元数据；未知 id 回落第一阶段清单（行行有元数据，不裸奔） */
export function printModuleMeta(id: PrintModuleId): PrintModuleMeta {
  return PRINT_MODULES.find((m) => m.id === id) ?? PRINT_MODULES[0]!;
}

/** 类型守卫：任意字符串 → PrintModuleId（store merge 兜底用） */
export function isPrintModuleId(value: unknown): value is PrintModuleId {
  return typeof value === 'string' && PRINT_MODULE_IDS.includes(value as PrintModuleId);
}

/* ============================== 模板注册表 ============================== */

/** 原生页（模块在某外表下的标志布局渲染：kind + 页名；M10 = 两页） */
export interface PrintNativePage {
  id: PrintPageKind;
  label: string;
}

/**
 * 模块能力表条目：某外表**原生渲染**某模块 ⇒ 它的原生页列表。
 * 模型容纳 1:N（H 的 Agent 执行 = 执行宣告 + 执行状态全览两页）。
 */
export interface PrintModuleCapability {
  module: PrintModuleId;
  pages: readonly PrintNativePage[];
}

/** 模板元数据（选择器上截卡片 + 预览面板分发都读它） */
export interface PrintTemplateMeta {
  id: PrintTemplateId;
  /** 版本名（A/D/E/H；经典为空串） */
  version: string;
  label: string;
  /** 一句话场景（选择器卡片副文案） */
  scene: string;
  /** 页面是否已实现（false ⇒ 建设中空态 + 禁打印，见文件头） */
  implemented: boolean;
  /** 经典专用：用五块开关而不是模块复选框（决策文档 §2.2） */
  usesBlocks: boolean;
  /**
   * 模块能力表（期二：原 `pages` 语义升级）——该模板**原生渲染**哪些模块
   * 及各自原生页（决策文档 §3.2/§3.3）。11 个模块里不在本表的 = 非原生
   * （选择器禁用态 + 原因；通用渲染期三补）。经典不走模块表 ⇒ 恒空。
   */
  modules: readonly PrintModuleCapability[];
}

export const PRINT_TEMPLATES: ReadonlyArray<PrintTemplateMeta> = [
  {
    id: 'classic',
    version: '',
    label: '经典',
    scene: '现有排程纸面：甘特摘要 + 阶段清单，五块可摘',
    implemented: true,
    usesBlocks: true,
    modules: [],
  },
  {
    id: 'swiss-schedule',
    version: 'A',
    label: 'Swiss Schedule',
    scene: '时刻表式竖读扫描：阶段 / 任务 / 延期 / 成员',
    implemented: true,
    usesBlocks: false,
    modules: [
      {
        module: 'stage-list',
        pages: [{ id: 'stage-overview', label: '阶段总览' }],
      },
      {
        module: 'task-list',
        pages: [{ id: 'task-register', label: '任务读号表' }],
      },
      {
        module: 'delay-ledger',
        pages: [{ id: 'delay-ledger', label: '延期记录表' }],
      },
      {
        module: 'member-roster',
        pages: [{ id: 'member-roster', label: '成员责任表' }],
      },
    ],
  },
  {
    id: 'data-editorial',
    version: 'D',
    label: 'Data Editorial',
    scene: '横读矩阵与数据图形：进度 / 依赖 / 工作量 / 验收',
    implemented: true,
    usesBlocks: false,
    modules: [
      {
        module: 'progress-matrix',
        pages: [{ id: 'progress-matrix', label: '阶段进度矩阵' }],
      },
      {
        module: 'dependency-network',
        pages: [{ id: 'dependency-network', label: '任务依赖网络' }],
      },
      {
        module: 'workload-composition',
        pages: [{ id: 'workload-composition', label: '阶段工作量构成' }],
      },
      {
        module: 'milestone-acceptance',
        pages: [{ id: 'milestone-acceptance', label: '里程碑与验收' }],
      },
    ],
  },
  {
    id: 'editorial-index',
    version: 'E',
    label: 'Editorial Index',
    scene: '跳读大编号索引：阶段 / 成员 / 产出物归档',
    implemented: true,
    usesBlocks: false,
    modules: [
      {
        module: 'stage-list',
        pages: [{ id: 'stage-index', label: '阶段目录' }],
      },
      {
        module: 'member-roster',
        pages: [{ id: 'member-index', label: '成员执行体目录' }],
      },
      {
        module: 'artifact-list',
        pages: [{ id: 'artifact-index', label: '产出物清单' }],
      },
    ],
  },
  {
    id: 'agent-poster',
    version: 'H',
    label: 'Agent Poster',
    scene: '海报式跳读：Agent 执行状态与写回治理公示',
    implemented: true,
    usesBlocks: false,
    modules: [
      {
        // M10 = 1 模块 2 页（执行宣告 + 状态全览）：模型容纳 1:N，
        // 勾选态是模块粒度，纸面落两页（决策文档 §3.3）
        module: 'agent-execution',
        pages: [
          { id: 'agent-declaration', label: 'Agent 执行宣告' },
          { id: 'execution-status', label: '执行状态全览' },
        ],
      },
      {
        module: 'writeback-proposals',
        pages: [{ id: 'writeback-proposals', label: '写回提案公示' }],
      },
    ],
  },
];

/** 模板 id → CSS 类名（**静态映射，禁止改成模板字符串拼接**，理由见文件头）。
 *   classic 冻结为 print-skin-default（DOM 被既有 spec 钉死，见文件头口径）。 */
const PRINT_TEMPLATE_CLASS: Record<PrintTemplateId, string> = {
  classic: 'print-skin-default',
  'swiss-schedule': 'print-template-swiss-schedule',
  'data-editorial': 'print-template-data-editorial',
  'editorial-index': 'print-template-editorial-index',
  'agent-poster': 'print-template-agent-poster',
};

/** 模板类名；未知 id（含旧持久值脏数据）回落 classic——纸面永远有类 */
export function printTemplateClass(id: PrintTemplateId): string {
  return PRINT_TEMPLATE_CLASS[id] ?? PRINT_TEMPLATE_CLASS.classic;
}

/** 全部模板 id（遍历 / 校验用） */
export const PRINT_TEMPLATE_IDS: readonly PrintTemplateId[] = PRINT_TEMPLATES.map((t) => t.id);

/** 取模板元数据；未知 id 回落 classic（与 printTemplateClass 同口径） */
export function printTemplateMeta(id: PrintTemplateId): PrintTemplateMeta {
  return PRINT_TEMPLATES.find((t) => t.id === id) ?? PRINT_TEMPLATES[0]!;
}

/** 选择器显示名：「A · Swiss Schedule」；经典无版本号。
 *  ⚠️ 用拼接不用模板字符串——本文件被 spec 以「零模板串」整体锁死（JIT 类名纪律的
 *  blanket 守卫），显示名拼一下无成本，别为一行字在文件里开模板串的口子。 */
export function printTemplateName(id: PrintTemplateId): string {
  const meta = printTemplateMeta(id);
  return meta.version ? meta.version + ' · ' + meta.label : meta.label;
}

/** 该模板的模块能力表（经典返回空——它的输出粒度是五块） */
export function printTemplateModules(id: PrintTemplateId): readonly PrintModuleCapability[] {
  return printTemplateMeta(id).modules;
}

/** 该模板原生渲染的模块 id（经典 ⇒ 空集） */
export function printTemplateModuleIds(id: PrintTemplateId): PrintModuleId[] {
  return printTemplateModules(id).map((c) => c.module);
}

/**
 * (template, module) → 原生页 kind 列表；**非原生 ⇒ null**。
 * 「某外表能不能原生生出某模块」只有这一个出处：选择器禁用态、
 * 期三通用渲染的分界、store 勾选归一化都读它。
 */
export function nativePagesOf(
  template: PrintTemplateId,
  module: PrintModuleId,
): readonly PrintPageKind[] | null {
  const cap = printTemplateModules(template).find((c) => c.module === module);
  return cap ? cap.pages.map((p) => p.id) : null;
}

/**
 * 勾选态 ⇒ 纸面页序（**注册表原生页序**，与模块勾选顺序无关）。
 * 缺参 / 缺键 = 默认全选 = 旧「页勾选」默认态**逐页等价**（期二回归红线：
 * 四套模板打印输出零变化）。非原生模块不在能力表 ⇒ 永不进纸面、不计页数。
 */
export function enabledPagesOf(
  template: PrintTemplateId,
  modules: readonly PrintModuleId[] | undefined,
): PrintPageKind[] {
  const caps = printTemplateModules(template);
  const on = new Set(modules ?? caps.map((c) => c.module));
  const out: PrintPageKind[] = [];
  for (const cap of caps) {
    if (!on.has(cap.module)) continue;
    for (const page of cap.pages) out.push(page.id);
  }
  return out;
}

/** 类型守卫：任意字符串 → PrintTemplateId（store merge 兜底用） */
export function isPrintTemplateId(value: unknown): value is PrintTemplateId {
  return typeof value === 'string' && PRINT_TEMPLATE_IDS.includes(value as PrintTemplateId);
}

/**
 * 旧皮肤 id → template（prefs 迁移，决策文档 §2.3 第 3 条）：
 * `'default'` → `'classic'`；其余（含脏值）→ null（调用方回落现模板）。
 */
export function legacySkinToTemplate(skin: unknown): PrintTemplateId | null {
  return skin === 'default' ? 'classic' : null;
}

/* ============================== 旧 pages 数据迁移（期二） ============================== */

/**
 * 旧页 key → 模块 key（14 → 11 **静态映射，编译期全覆盖**；
 * usePrintPrefsStore merge 的旧 pages 数据迁移专用，决策文档 §3.3）。
 * M10 是 1 模块 2 页：agent-declaration 与 execution-status 同归
 * agent-execution——页粒度升级模块粒度时这两页的独立勾选态合并
 * （默认全选下纸面输出不变；只有曾单独摘过其中一页的旧数据会合并）。
 */
const PAGE_TO_MODULE: Record<PrintPageKind, PrintModuleId> = {
  'stage-overview': 'stage-list',
  'task-register': 'task-list',
  'delay-ledger': 'delay-ledger',
  'member-roster': 'member-roster',
  'progress-matrix': 'progress-matrix',
  'dependency-network': 'dependency-network',
  'workload-composition': 'workload-composition',
  'milestone-acceptance': 'milestone-acceptance',
  'stage-index': 'stage-list',
  'member-index': 'member-roster',
  'artifact-index': 'artifact-list',
  'agent-declaration': 'agent-execution',
  'execution-status': 'agent-execution',
  'writeback-proposals': 'writeback-proposals',
};

/** 旧页 key → 模块 key；映射不了（脏值 / 非页 kind）⇒ null（调用方回落默认全选） */
export function pageKindToModule(page: unknown): PrintModuleId | null {
  return typeof page === 'string' && page in PAGE_TO_MODULE
    ? PAGE_TO_MODULE[page as PrintPageKind]
    : null;
}
