/**
 * 打印模板注册表（v0.8.6.0002 · 反馈 #9.3「预留皮肤」的**升格**：
 * PrintSkinId → PrintTemplateId，产品决策文档 §2.3 迁移结论）。
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
 * ── 未实现模板（D/E/H）为什么也进注册表 ──
 * 决策 ⑥「四套全上」的实现顺序是分批落地：选择器要先能渲染五张卡（用户看得见
 * 全貌），点未实现的进「建设中」空态——**不许假装能打**（打印/导出禁用）。
 * `implemented: false` 就是这个开关，选择器与预览面板都读它。
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

/* ============================== 模板注册表 ============================== */

/** 选择器页面元数据（label 页名 + hint 半行内容说明，决策文档 §2.1 中截） */
export interface PrintPageMeta {
  id: PrintPageKind;
  label: string;
  hint: string;
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
  /** 经典专用：用五块开关而不是页复选框（决策文档 §2.2） */
  usesBlocks: boolean;
  /** 页面元数据（四版；经典为空，它的「页」是五块） */
  pages: readonly PrintPageMeta[];
}

export const PRINT_TEMPLATES: ReadonlyArray<PrintTemplateMeta> = [
  {
    id: 'classic',
    version: '',
    label: '经典',
    scene: '现有排程纸面：甘特摘要 + 阶段清单，五块可摘',
    implemented: true,
    usesBlocks: true,
    pages: [],
  },
  {
    id: 'swiss-schedule',
    version: 'A',
    label: 'Swiss Schedule',
    scene: '时刻表式竖读扫描：阶段 / 任务 / 延期 / 成员',
    implemented: true,
    usesBlocks: false,
    pages: [
      { id: 'stage-overview', label: '阶段总览', hint: '时刻表 · 四态 / 日期 / 占比 / 负责人' },
      { id: 'task-register', label: '任务读号表', hint: 'taskNo / 七态 / 负责人 / 产出物数' },
      { id: 'delay-ledger', label: '延期记录表', hint: 'StageLog · 旧 / 新结束日 / 原因 / 操作人' },
      { id: 'member-roster', label: '成员责任表', hint: 'human / agent · agentKind · 负责任务数' },
    ],
  },
  {
    id: 'data-editorial',
    version: 'D',
    label: 'Data Editorial',
    scene: '横读矩阵与数据图形：进度 / 依赖 / 工作量 / 验收',
    implemented: false,
    usesBlocks: false,
    pages: [
      { id: 'progress-matrix', label: '阶段进度矩阵', hint: '阶段内任务完成度 / 日期 / 占比' },
      { id: 'dependency-network', label: '任务依赖网络', hint: 'dependsOn 有向图 · 环与缺失引用' },
      { id: 'workload-composition', label: '阶段工作量构成', hint: 'ratioPercent 堆叠条 · 分期汇总' },
      { id: 'milestone-acceptance', label: '里程碑与验收', hint: 'M1 / M2 / M3 · 验收清单与签署' },
    ],
  },
  {
    id: 'editorial-index',
    version: 'E',
    label: 'Editorial Index',
    scene: '跳读大编号索引：阶段 / 成员 / 产出物归档',
    implemented: false,
    usesBlocks: false,
    pages: [
      { id: 'stage-index', label: '阶段目录', hint: '巨编号 · 双语名称 / 四态 / 占比' },
      { id: 'member-index', label: '成员执行体目录', hint: 'human / agent · 角色 · 负责任务数' },
      { id: 'artifact-index', label: '产出物清单', hint: '种类 / 关联任务 / 来源' },
    ],
  },
  {
    id: 'agent-poster',
    version: 'H',
    label: 'Agent Poster',
    scene: '海报式跳读：Agent 执行状态与写回治理公示',
    implemented: false,
    usesBlocks: false,
    pages: [
      { id: 'agent-declaration', label: 'Agent 执行宣告', hint: 'ExecutionStatus / runId / 写回白名单' },
      { id: 'execution-status', label: '执行状态全览', hint: '10 态四组流程 · running 主焦点' },
      { id: 'writeback-proposals', label: '写回提案公示', hint: '五态 · confidence · 四项白名单' },
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

/** 该模板的页面元数据（经典返回空——它的输出粒度是五块） */
export function printTemplatePages(id: PrintTemplateId): readonly PrintPageMeta[] {
  return printTemplateMeta(id).pages;
}

/** 类型守卫：任意字符串 → PrintTemplateId（store merge 兜底用） */
export function isPrintTemplateId(value: unknown): value is PrintTemplateId {
  return typeof value === 'string' && PRINT_TEMPLATE_IDS.includes(value as PrintTemplateId);
}

/**
 * 旧 skin 键 → template（prefs 迁移，决策文档 §2.3 第 3 条）：
 * `'default'` → `'classic'`；其余（含脏值）→ null（调用方回落现模板）。
 */
export function legacySkinToTemplate(skin: unknown): PrintTemplateId | null {
  return skin === 'default' ? 'classic' : null;
}
