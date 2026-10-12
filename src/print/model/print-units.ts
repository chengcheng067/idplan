/**
 * 打印「可开关单元」统一模型（2026-10-13 · 5 块 × 4 模板重构 · 批 1 地基）。
 *
 * ── 为什么需要这一层（需求依据，不是我的发明）──
 * `deliverables/gstack/print-5blocks-mapping-2026-10-13.md` 的**决策登记区**：
 *   · 决策 5：版性装置**今天不参与勾选**，但「预留接口未来肯定是会开放勾选的」
 *     （用户原话）⇒ 四条硬要求；
 *   · 决策 6：**严格一一对应**——取消勾一块 = 纸面上精确减掉一个可见区，
 *     不许「勾一块、纸上出现两块内容」。
 *
 * 决策 5 的四条落地口径与本文件逐条对应：
 *   1. **统一注册表**：5 块 = `PrintBlockId`、版性装置 = `PrintDeviceId`，
 *      两者都是「可开关单元」（`PrintUnitId`）；每套模板声明自己有哪些
 *      （`PRINT_TEMPLATE_UNITS`）。**装置不再是「无条件渲染」的散装 if**。
 *   2. **同一条解析路径**：装配与渲染一律走 `resolveUnits(template, prefs)`——
 *      装置今天在该函数里恒为 `enabled: true`、来源标记 **`forced`**（与用户
 *      勾选的 `user` 区分）。将来开放勾选 = 把 `forced` 换成读 prefs，**只换
 *      数据源、不开刀**（本文件不出现第二张「装置是否渲染」的表）。
 *   3. **选择器今天只渲染 `toggleable` 的行**：`printToggleableUnits()` 是选择器
 *      的唯一出处。装置 / 不可摘块**今天不进清单**（也不渲染成灰行禁用——
 *      灰行会给清单加 4–8 行噪音，回到「为什么点不动」的老观感）。
 *   4. **持久化形状今天就装得下**：per-template 存「单元 id 集合」，
 *      **缺失 = 默认开** ⇒ 将来开放时老用户数据天然可用、**零迁移**。
 *
 * ── 为什么 5 块的 id 不在这里重新定义 ──
 * 经典纸面的 5 块契约住在 `lib/schedule-print.ts`（`SchedulePaperBlocks`，
 * 反馈 #9.2 的原创地，且**分页纯函数依赖它**）。本文件用
 * `keyof SchedulePaperBlocks` 取 id，**不抄第二份**——两个类型的键一旦分叉，
 * 就是「同一件事有两份真相」的老事故形态（`.print-root` 类名纪律同理）。
 *
 * ── 今天的边界（批 1）──
 * 只有 classic 与 A（`usesBlocks: true` 的两套）**真的**走这套模型渲染；
 * D/E/H 的单元声明**已经在册**（注册表是一等公民，批 2/3/4 直接接消费者），
 * 但它们的文档层本批不动 ⇒ 选择器对它们仍走模块清单（见 `printTemplateUnits`
 * 之上的说明与 `PrintPreviewDialog` 的分支注释）。
 */

import { DEFAULT_SCHEDULE_PAPER_BLOCKS, type SchedulePaperBlocks } from '../../lib/schedule-print';
import type { PrintModuleId } from '../../components/print/print-templates';
import type { PrintTemplateId } from './print-view-model';

/* ------------------------------------------------------------------ 单元 id */

/** 5 块打印内容（id = 经典 `SchedulePaperBlocks` 的键，**单一真值源**） */
export type PrintBlockId = keyof SchedulePaperBlocks;

/**
 * 版性装置（审美宪法 §3「缺任一签名特征 = 不是这个模板」的那些构件）。
 *
 * 命名口径：`<模板前缀>-<装置名>`，前缀与 `printTemplateClass` 的模板 id 同族
 * （swiss / de / ei / ap），一眼能看出归属哪套模板。
 */
export type PrintDeviceId =
  /** A · 黑顶栏（logo + 栏目 + 中文页题 + 品牌·页序） */
  | 'swiss-topbar'
  /** A · 板头巨字完成度锚点 */
  | 'swiss-percent'
  /** A · 黑底栏（署名 + 页码；**页码在此** ⇒ 原则 1 的「每页独立解释」落点） */
  | 'swiss-bottombar'
  /** D · 刊头装置（mono 顶行 + 巨字标题 + 橙副标 + 3px 硬边线） */
  | 'de-head'
  /** D · 页尾完成度横带（**每页都有**；§1.2 勘误①订正过「只首页」的过期注释） */
  | 'de-band'
  /** E · 两行巨题装置（衬线，行 1 墨 / 行 2 赭红） */
  | 'ei-giant-title'
  /** E · `SHEET nn / NN · A4` 页签（刊头身份装置；与页脚页码**并存**，职责不同） */
  | 'ei-sheet-tag'
  /** H · 页顶出血巨字（品牌词 + 叠字主题词） */
  | 'ap-flood-top'
  /** H · 页底出血巨字 IDPLAN（B5 的署名由它承担，**不许摘**） */
  | 'ap-flood-bottom'
  /** H · 中轴 + 3px 栏头线（双栏语法本体） */
  | 'ap-spine'
  /** H · 居中摘要块（装置本体永不消失；B2 借它的第 4 个载荷） */
  | 'ap-sum';

/** 任意可开关单元 id */
export type PrintUnitId = PrintBlockId | PrintDeviceId;

/** 单元种类（内容块 / 版性装置；两者的解析规则不同，见 resolveUnits） */
export type PrintUnitKind = 'block' | 'device';

/** 5 块按**经典选择器的行序**（`PrintPreviewDialog.BLOCK_ROWS` 原序） */
export const PRINT_BLOCK_IDS: readonly PrintBlockId[] = [
  'header',
  'timeline',
  'projectInfo',
  'stageTable',
  'footer',
];

/** 5 块的展示元数据（label + hint；经典选择器与四版选择器**同一份文案**） */
export interface PrintBlockMeta {
  id: PrintBlockId;
  label: string;
  hint: string;
}

export const PRINT_BLOCKS: readonly PrintBlockMeta[] = [
  { id: 'header', label: '打印头部', hint: '项目名 / 周期' },
  { id: 'timeline', label: '打印时间轴', hint: '甘特图' },
  { id: 'projectInfo', label: '项目信息', hint: '排期基准' },
  { id: 'stageTable', label: '阶段清单', hint: '表格' },
  { id: 'footer', label: '页脚', hint: '署名 / 页码' },
];

/** 块 id → 元数据；未知 id 回落首块（行行有文案，不裸奔；同 printModuleMeta 手法） */
export function printBlockMeta(id: PrintBlockId): PrintBlockMeta {
  return PRINT_BLOCKS.find((b) => b.id === id) ?? PRINT_BLOCKS[0]!;
}

/* ------------------------------------------------------------------ 注册表 */

/**
 * 单元声明（每套模板声明的「我有哪些单元」）。
 *
 * `forced` = **本套模板下不可取消**（§2.6 的「丙」格）：它仍是模型上的一等
 * 单元、仍走 `resolveUnits`，只是用户勾不到（今天也不进选择器）。
 * 今天四套模板的 `header` 都是 `forced`——因为**项目名住在刊头里**，取掉就会
 * 印出一张没项目名的纸（§2.6 原则 1：项目名 / 页码 / 口径注永不因勾选消失）。
 * 经典的五块**全部可取消**（既有 spec 钉死，§2.6 明文「与经典的不一致」）。
 */
export interface PrintUnitSpec {
  id: PrintUnitId;
  kind: PrintUnitKind;
  label: string;
  hint: string;
  /** 本套模板下不可取消（今天 = 恒开、不进选择器；模型上仍是一等单元） */
  forced: boolean;
}

/** 5 块的默认声明（可取消；`forced` 由各套按 §2.6 覆写） */
function blockSpecs(forced: readonly PrintBlockId[] = []): PrintUnitSpec[] {
  return PRINT_BLOCKS.map((b) => ({
    id: b.id,
    kind: 'block' as const,
    label: b.label,
    hint: b.hint,
    forced: forced.includes(b.id),
  }));
}

/** 装置声明：label / hint 逐套给（今天只用于注册表完整性，将来进选择器时直接可用） */
function deviceSpec(id: PrintDeviceId, label: string, hint: string): PrintUnitSpec {
  return { id, kind: 'device', label, hint, forced: true };
}

/**
 * 逐套模板的单元表（**决策 5 第 1 条的唯一出处**）。
 *
 * ⚠️ 读表须知（2026-10-13 批 C 后订正）：**A / D / E / classic 四套已经在册并
 * 在跑**——它们的文档层直接消费 `resolveUnits(...)` 的结果（`usesBlocks` 分流，
 * 见 `PrintPreviewDialog`）。**H 的条目先在册、今天还不消费**（批 D 才切）：
 * `printTemplateUnits` 的调用方按 `usesBlocks` 分流，H 仍走 11 模块通路，
 * 但注册表已经写全——这样「开放装置勾选」那次改动**不必再补一轮注册表**
 * （决策 5 的「不开刀、只换数据源」）。H 的 `agent-poster` 条目今天也照样被
 * `printTemplateUnitIds` 读到，选择器分流的判据是 `usesBlocks` 而不是本表。
 */
export const PRINT_TEMPLATE_UNITS: Record<PrintTemplateId, readonly PrintUnitSpec[]> = {
  classic: [
    // 经典：五块全部可摘（§2.6 明文「经典的五块全部可摘」，既有 spec 钉死）
    ...blockSpecs(),
  ],
  'swiss-schedule': [
    // A：B1 不可取消（项目名住在板头站名，§2.6 A·B1 = 丙）
    ...blockSpecs(['header']),
    deviceSpec('swiss-topbar', '黑顶栏', 'logo / 栏目 / 页题 / 品牌·页序（版式构件）'),
    deviceSpec('swiss-percent', '板头巨字完成度', '右对齐版面锚点（版式构件）'),
    deviceSpec('swiss-bottombar', '黑底栏', '署名 / 页码 / 数据时间（版式构件）'),
  ],
  'data-editorial': [
    ...blockSpecs(['header']),
    deviceSpec('de-head', '刊头装置', 'mono 顶行 / 巨字标题 / 橙副标 / 3px 硬边线'),
    deviceSpec('de-band', '页尾完成度横带', '每页的聚合横带（版式构件）'),
  ],
  'editorial-index': [
    ...blockSpecs(['header']),
    deviceSpec('ei-giant-title', '两行巨题', '衬线巨题（目录身份装置）'),
    deviceSpec('ei-sheet-tag', 'SHEET 页签', 'SHEET nn / NN · A4（刊头身份；与页脚页码并存）'),
  ],
  'agent-poster': [
    // H：B1 **与 B5 都不可取消**（§2.6 · 丙 + 批 D 裁决第 1 条）。
    // ── B5 为什么是丙（而不是「可摘脚注行」）──
    // 该行名叫「页脚」，但 H 零页脚元素：署名 = 页底出血巨字 `IDPLAN`（装置）、
    // 页码 = 页眉 `SHEET nn / NN`（装置，§2.6 原则 1）、数据时间 = 脚注数据来源行。
    // 若把这一行做成可勾，**勾选框会承诺一个它兑不了的效果**（用户取消后巨字与
    // 页码照样印着 —— 正是「我明明取消了还在印」那类最招骂的体验）；且脚注在 H 的
    // 语汇里是**治理披露件**（H 的隐喻就是「治理公示栏」），披露不该是可选项。
    // ⇒ 与四套的「打印头部」同款处理：**不可摘 + 写清原因**（纪律 1）。
    // ⚠️ §2.6 的规则表 H·B5 格曾写「丙 ＋ 局部甲：可摘的只有脚注数据来源行」，
    // 与同节纪律 1「H 的 B5 恒为禁用行」自相矛盾；team-lead 已裁定取**禁用行**
    // 并作废规则表那句（文档已改一致）。
    ...blockSpecs(['header', 'footer']),
    deviceSpec('ap-flood-top', '页顶出血巨字', '品牌词 + 叠字主题词（页锚点）'),
    deviceSpec('ap-flood-bottom', '页底出血巨字', 'IDPLAN（B5 的署名由它承担，不许摘）'),
    deviceSpec('ap-spine', '中轴与栏头线', '双栏语法本体'),
    deviceSpec('ap-sum', '居中摘要块', '装置本体；B2 借它的第 4 个载荷'),
  ],
};

/** 该模板声明的全部单元（注册表出口；渲染侧的顺序 = 本表顺序） */
export function printTemplateUnits(template: PrintTemplateId): readonly PrintUnitSpec[] {
  return PRINT_TEMPLATE_UNITS[template] ?? PRINT_TEMPLATE_UNITS.classic;
}

/** 该模板声明的单元 id 表 */
export function printTemplateUnitIds(template: PrintTemplateId): PrintUnitId[] {
  return printTemplateUnits(template).map((u) => u.id);
}

/**
 * 今天**进选择器**的行（决策 5 第 3 条：只渲染 `toggleable` 的行）。
 * 今天 = 5 块里非 `forced` 的那些（装置恒不进：`kind === 'device'` 一律过滤）。
 * 将来开放装置勾选 = 这里加一个「已开放」判据即可，**选择器本体不动**。
 */
export function printToggleableUnits(template: PrintTemplateId): readonly PrintUnitSpec[] {
  return printTemplateUnits(template).filter((u) => u.kind === 'block' && !u.forced);
}

/* ------------------------------------------------------------------ 解析 */

/** 解析输入（store 喂进来；两个键都是**可选** ⇒ 纯函数可测、缺参 = 默认全开） */
export interface PrintUnitPrefs {
  /**
   * per-template 存「启用单元 id 集合」（决策 5 第 4 条：**缺失 = 默认开**）。
   * 落库的永远是用户显式勾选的结果（同 `modules` 的老口径），故缺键即默认。
   */
  units?: Partial<Record<PrintTemplateId, readonly PrintUnitId[]>>;
  /**
   * 经典的五块对象（**旧键，保留不动**）。新键 `units` 缺失时它是 classic 的
   * 回落源，也是 `SchedulePaper` 的既有 prop——两条路同一组布尔值。
   */
  blocks?: SchedulePaperBlocks;
}

/** 单元生效来源：`user` = 用户勾选 / `default` = 缺键默认 / `forced` = 本套不可取消 */
export type PrintUnitSource = 'user' | 'default' | 'forced';

/** 解析结果（渲染侧唯一的「这单元今天渲不渲染」出处） */
export interface ResolvedPrintUnit {
  id: PrintUnitId;
  kind: PrintUnitKind;
  label: string;
  hint: string;
  enabled: boolean;
  source: PrintUnitSource;
  /** 本套模板下不可取消（模型上仍是一等单元；今天不进选择器清单） */
  forced: boolean;
}

/**
 * **同一条解析路径**（决策 5 第 2 条）：装配与渲染一律走它，不许给装置单开
 * 「无条件渲染」分支。
 *
 * 规则（顺序即优先级）：
 *   ① 装置（`kind === 'device'`）⇒ 今天 **恒 true、来源 `forced`**
 *      ——将来开放勾选：把这一支换成「读 prefs」，其余不动；
 *   ② 本套声明为 `forced` 的块（A/D/E/H 的 B1、H 的 B5）⇒ true / `forced`；
 *   ③ 有用户勾选（`units[template]`，classic 另回落 `blocks`）⇒ 按集合判、来源 `user`；
 *   ④ 都没有 ⇒ 按 `DEFAULT_SCHEDULE_PAPER_BLOCKS`（全开）、来源 `default`。
 */
export function resolveUnits(
  template: PrintTemplateId,
  prefs?: PrintUnitPrefs | null,
): ResolvedPrintUnit[] {
  const stored = prefs?.units?.[template];
  let userSet: Set<PrintUnitId> | null = null;
  if (Array.isArray(stored)) {
    userSet = new Set(stored);
  } else if (template === 'classic' && prefs?.blocks) {
    // classic 的旧键（`blocks`）是它的历史正主：转成同一形状的集合
    userSet = new Set(PRINT_BLOCK_IDS.filter((id) => prefs.blocks![id]));
  }

  return printTemplateUnits(template).map((spec) => {
    if (spec.kind === 'device' || spec.forced) {
      return { ...spec, enabled: true, source: 'forced' as const };
    }
    if (userSet) {
      return { ...spec, enabled: userSet.has(spec.id), source: 'user' as const };
    }
    return {
      ...spec,
      enabled: DEFAULT_SCHEDULE_PAPER_BLOCKS[spec.id as PrintBlockId],
      source: 'default' as const,
    };
  });
}

/** 该单元今天是否渲染（渲染侧读点；未知 id ⇒ false，不裸奔） */
export function unitEnabled(units: readonly ResolvedPrintUnit[], id: PrintUnitId): boolean {
  return units.find((u) => u.id === id)?.enabled ?? false;
}

/**
 * 解析结果 → 经典五块对象（`SchedulePaper` 的 prop 形状）。
 * 经典与 A 的文档层都从**同一份解析结果**取布尔值，避免两处各判一次。
 */
export function blockRecordOf(units: readonly ResolvedPrintUnit[]): SchedulePaperBlocks {
  const out = { ...DEFAULT_SCHEDULE_PAPER_BLOCKS };
  for (const id of PRINT_BLOCK_IDS) {
    const u = units.find((x) => x.id === id);
    if (u) out[id] = u.enabled;
  }
  return out;
}

/**
 * 选择器状态条读数：**已勾且可勾**的块数。
 *
 * 口径 = 「与清单行数同源」：清单只列 `toggleable` 的行，读数就必须只数它们，
 * 否则 A 会出现「清单 4 行、读数 5 块」的自相矛盾（不可摘的 B1 不进清单也不进读数；
 * 它为什么不在清单里由清单下方那行说明负责，见 §2.6 的纪律 2）。
 */
export function enabledBlockCount(units: readonly ResolvedPrintUnit[]): number {
  return units.filter((u) => u.kind === 'block' && !u.forced && u.enabled).length;
}

/** 本套模板里**不可摘**的块（供选择器写明原因：§2.6「禁用无原因 = 用户以为坏了」） */
export function forcedBlockUnits(template: PrintTemplateId): readonly PrintUnitSpec[] {
  return printTemplateUnits(template).filter((u) => u.kind === 'block' && u.forced);
}

/* ------------------------------------------------------------------ 旧数据映射 */

/**
 * 旧「11 内容模块」勾选 → 新「5 块」勾选（**读出来映射到新单元、原键不删**）。
 *
 * 口径（与 §2 的「乙 · 从选择器与预览消失但不删代码」同一本账）：
 *   · **有承载位的模块**只有两个：`stage-list`（阶段清单）与 `progress-matrix`
 *     （D 的阶段进度矩阵 = 同一份阶段行的另一种画法）⇒ 都映射到 `stageTable`；
 *   · 其余 9 个模块（task-list / delay-ledger / member-roster /
 *     dependency-network / workload-composition / milestone-acceptance /
 *     artifact-list / agent-execution / writeback-proposals）⇒ **无承载位**：
 *     它们对应的额外内容页从选择器与预览消失（决策 2），代码与测试全留。
 *     「无承载位」不落进返回值 ⇒ 该块按默认（开）处置，**不把旧数据翻译成一张白纸**。
 *   · `delay-ledger` 是特例中的特例：它的**台账**按决策 3 降为 B4 的 L3 附属件
 *     （随 B4 勾选、单独不成立），故它同样不独立映射到任何块。
 *
 * 返回 `null` = 无法迁移（非数组 / 脏形）⇒ 调用方保持「缺键」（= 默认全开）。
 */
const BLOCK_CARRIERS: Partial<Record<PrintBlockId, readonly PrintModuleId[]>> = {
  stageTable: ['stage-list', 'progress-matrix'],
};

export function blocksFromLegacyModules(value: unknown): Partial<SchedulePaperBlocks> | null {
  if (!Array.isArray(value)) return null;
  const set = new Set(value);
  const out: Partial<SchedulePaperBlocks> = {};
  for (const block of PRINT_BLOCK_IDS) {
    const carriers = BLOCK_CARRIERS[block];
    if (!carriers) continue; // 无承载位 ⇒ 不表态（调用方按默认）
    out[block] = carriers.some((m) => set.has(m));
  }
  return out;
}

/** 类型守卫：任意字符串 → PrintUnitId（store merge 兜底用；含两块与装置） */
export function isPrintUnitId(value: unknown): value is PrintUnitId {
  if (typeof value !== 'string') return false;
  return (Object.keys(PRINT_TEMPLATE_UNITS) as PrintTemplateId[]).some((t) =>
    printTemplateUnits(t).some((u) => u.id === value),
  );
}
