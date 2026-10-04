/**
 * 阶段自定义的老数据回落（零迁移脚本，读时回落范式）。
 *
 * 与 `assigneeIds` / `roleKind` 两次历史增量同一手法：
 *   - 导入侧（backup.service）用 zod `.optional()` + `.transform()` 补齐显式值，
 *     保证落库后每行都有字段，运行时不会读到 undefined；
 *   - 运行侧（老 IndexedDB 数据，从未走过导入）用本文件的纯函数回落，
 *     纯函数可直接单测，且不开启动期迁移事务。
 *
 * 回落口径（PRD §6.1）：
 *   Stage.templateKey 缺失/null → 按 orderIndex 反查 indoor_full 套餐（1..9 一一对应）
 *   Stage.colorIndex  缺失      → clamp(orderIndex, 1, 9)（与 split.ts stageColorIndex 同口径）
 *   Project.stagePresetKey      → null（未知套餐）
 *   Project.stageTemplateVersion→ 0（未知版本）
 *   Project.scheduleBasis       → DEFAULT_SCHEDULE_BASIS（自然日）
 *   Project.shortLabel          → null（v0.7 侧栏增强；「项目名首字」的文字级回落
 *                                 在 src/lib/projectAccent.ts，属展示层，不进本文件）
 *   Project.domain              → null（v0.8；**不在归一里反查**，见 normalizeProjectRow 注释。
 *                                 消费侧用 resolveProjectDomain() 反查套餐 domain 再退 'indoor'）
 *   Project.kind                → DEFAULT_PROJECT_KIND（'human'；v0.8）
 *   Stage.customColor           → null（v0.8；null = 用 colorIndex 的内置色）
 *
 * ── v0.7 B1 决策留痕：`Project.shortLabel` **刻意不升 Dexie 版本** ──
 *   判据是「有没有索引变化」：
 *     · projects 的索引串是 `id, status, name, updatedAt`（schema/current.ts 的
 *       DEXIE_V1_STORES），shortLabel 是纯展示字段、**不进任何索引** →
 *       `version(n).stores()` 无需改动 → 没有新版本可言；
 *     · 老库的行只是**缺这个键**（读到 undefined），本文件不负责、由展示层
 *       `resolveProjectShortLabel(name, shortLabel)` 的 `?? 首字` 兜住；
 *     · 反过来，为了「补齐一个展示字段」去 bump SCHEMA_VERSION 的代价是：
 *       每个存量用户下次启动都被 `needsPreMigrationBackup()` 拦下、被迫先导出一次
 *       迁移前备份（L1 闸门）。零收益、有真实打扰，故明确不做。
 *   将来若 shortLabel 需要被 `.where()` 查询而建索引，**那时才**按
 *   schema/current.ts 的规则增量声明 DEXIE_V4_STORES（并保留历史串不动）。
 */

import { DEFAULT_SCHEDULE_BASIS, type Project, type Stage } from '../types/entities';
import {
  DEFAULT_PROJECT_KIND,
  type ProjectKind,
  type ScheduleBasis,
} from '../types/enums';
import type { StageTemplateDomain } from '../types/dto';
import { getPreset, getPresetItems } from './stage-library';

/**
 * 室内·全流程套餐 key。双重身份：
 *   1. 老数据 templateKey 反查源（其 9 项与 templates/nine-stages.default.json 逐字段等价）；
 *   2. 手动建档未指定阶段集合时的默认套餐（产出即九段，与改造前一致）。
 */
export const INTERIOR_FULL_PRESET_KEY = 'indoor_full';

/** 用户在阶段池里增删过阶段项后的套餐归属（PRD §3.2.2 / AC-09） */
export const CUSTOM_STAGE_PRESET_KEY = 'custom';

export const LEGACY_STAGE_TEMPLATE_VERSION = 0;

/**
 * 主板块（`Project.domain`）的最终回落值（v0.8）。
 *
 * 为什么是 `'indoor'`：改造前 `HomePage.deriveColumns()` 的逻辑就是
 * 「项目所属段落为空时落到 indoor 三列」（`getDomains()` 把 indoor 声明在最前，
 * 且 indoor 是历史默认行业）。**存量项目必须观感零变化** ⇒ 回落值只能是 indoor。
 *
 * ⚠️ `'custom'` 套餐的项目 `getPreset('custom')` 返回 `null`（`stage-library.ts:41-43`），
 * 反查失败 ⇒ 也落 indoor。这正是纠错③ 的老 BUG，**对存量数据有意不自动修**
 * （不猜 = 与今天逐字一致；自动猜 = 违反「绝不猜测」纪律）。补救入口见
 * v0.8 §3.2.1（`visibility.needsDomainConfirm` ＋ 用户点「确认」才写）。
 *
 * 调用点：**消费侧**（`resolveProjectDomain(project.stagePresetKey, project.domain)`），
 * 不是归一函数——理由见 `normalizeProjectRow` 内的长注释（保 roundtrip 幂等）。
 */
export const DEFAULT_PROJECT_DOMAIN: StageTemplateDomain = 'indoor';

/** 色号下限/上限（STAGE_BAR_COLORS 只有 1..9） */
export const MIN_COLOR_INDEX = 1;
export const MAX_COLOR_INDEX = 9;

/** 老数据回落：orderIndex → indoor_full 套餐对应项的 templateKey */
export function legacyTemplateKeyOf(orderIndex: number): string | null {
  if (!Number.isInteger(orderIndex) || orderIndex < 1 || orderIndex > 9) return null;
  return getPresetItems(INTERIOR_FULL_PRESET_KEY)[orderIndex - 1]?.key ?? null;
}

/** 老数据回落：orderIndex → 色号（与 split.ts stageColorIndex 同口径） */
export function legacyColorIndexOf(orderIndex: number): number {
  const n = Number.isFinite(orderIndex) ? Math.trunc(orderIndex) : MIN_COLOR_INDEX;
  return Math.min(Math.max(n, MIN_COLOR_INDEX), MAX_COLOR_INDEX);
}

/** 读时回落：templateKey 为空时按 orderIndex 反查（显式 null 也回落，老数据语义） */
export function resolveStageTemplateKey(orderIndex: number, templateKey?: string | null): string | null {
  return templateKey ?? legacyTemplateKeyOf(orderIndex);
}

/**
 * **导入归一**专用的 `templateKey` 回落（v0.8.1 修「Agent 阶段备份往返后换列」）。
 *
 * ── 为什么不能直接用 `resolveStageTemplateKey()` ──
 * 那是**读时**回落（显式 null 也回落），是给消费侧用的。拿它做**写时**归一，会把
 * 「显式声明无模板」的阶段**改写成 `indoor.*` 并落库**，而 v0.7 起就有两类阶段
 * 是靠「templateKey = null」表达「我没有模板」的：
 *   · Agent 自动建出的阶段（`stage-resolve.buildCreatedStage` 恒写 `templateKey: null`）；
 *   · 用户自定义阶段（`custom-stage.service` 明文落库 `templateKey = null`）。
 * 后果（用户可见）：一次备份往返后 `getItemKanbanColumn(templateKey)` 从
 * 「按 orderIndex 均分落列」变成「落 indoor 模板声明的那一列」⇒ 阶段卡**换列**；
 * 同时破坏 roundtrip 幂等（导出→导入→再导出，`templateKey` 由 null 变成 `indoor.*`，
 * 逐表 diff 非空）。
 *
 * ── 本函数的判据 ──
 * 只给「**键缺失**」回落 —— 那才是老备份（v1/v2，压根没有这个字段）的语义；
 * 显式 `null` 是「明确无模板」的声明，必须原样保留。
 * 纪律与 `normalizeProjectRow` 对 `domain` 的处理同构（只 `?? null`、不反查，
 * 反查留给消费侧的 `resolveProjectDomain`）—— 详见 `DEFAULT_PROJECT_DOMAIN` 的注释。
 */
export function resolveImportedTemplateKey(
  orderIndex: number,
  templateKey?: string | null,
): string | null {
  return templateKey === undefined ? legacyTemplateKeyOf(orderIndex) : templateKey;
}

/** 读时回落：colorIndex 缺失/越界时按 orderIndex 夹取 */
export function resolveStageColorIndex(orderIndex: number, colorIndex?: number | null): number {
  if (typeof colorIndex === 'number' && Number.isFinite(colorIndex)) {
    const n = Math.trunc(colorIndex);
    if (n >= MIN_COLOR_INDEX && n <= MAX_COLOR_INDEX) return n;
  }
  return legacyColorIndexOf(orderIndex);
}

/**
 * 读时回落：`Project.domain` 缺失时（v0.8 前落库的数据、或 v0.8 前导出的备份）
 * 按 `stagePresetKey` 反查套餐的 domain，反查不到再退 `DEFAULT_PROJECT_DOMAIN`。
 *
 * 反查而不是一律 indoor：`stagePresetKey` 是 v2 起就有的字段，景观/软件等非室内项目
 * 的套餐 key 一直存在 ⇒ 反查能让**这些**存量项目落回正确的板块，
 * 观感与改造前 `deriveColumns()`（同样读 `getPreset(...).domain`）**逐字一致**。
 *
 * 显式 `null` 也走回落——语义是「未确认」，与「缺失」同待遇（v0.8 §3.2.1：
 * 未确认的存量项目行为必须与今天一致，不得因为多了个 null 就换列）。
 */
export function resolveProjectDomain(
  stagePresetKey: string | null | undefined,
  domain?: string | null,
): StageTemplateDomain {
  if (domain) return domain as StageTemplateDomain;
  const preset = getPreset(stagePresetKey ?? '');
  return preset?.domain ?? DEFAULT_PROJECT_DOMAIN;
}

/**
 * 导入侧的行形状（zod 校验产物）：枚举字段在 schema 里是 `z.string()`（导入不做枚举收窄，
 * 保证将来新增枚举值不被旧客户端拒绝），故这里按 string 收，归一后原样透传。
 * 形状由 Project / Stage 派生（Omit），不重复声明实体（铁律 7）。
 */
export type ProjectRowInput = Omit<
  Project,
  | 'type'
  | 'status'
  | 'stagePresetKey'
  | 'stageTemplateVersion'
  | 'scheduleBasis'
  | 'shortLabel'
  | 'domain'
  | 'kind'
  | 'ownerMemberId'
> & {
  status: string;
  /**
   * v0.7 侧栏方块简称：必须与 Project 一样 Omit 后重声明为**可选**——
   * 老备份（v1/v2/v3）根本没有这个键，zod 侧是 `.optional()` 产物。
   * 若直接继承 Project 的必填 `string | null`，normalizeProjectRow 的入参会与
   * zod 的解析产物类型不符（tsc 会报，但更危险的是有人顺手把它改成非空断言）。
   */
  shortLabel?: string | null;
  stagePresetKey?: string | null;
  stageTemplateVersion?: number;
  scheduleBasis?: ScheduleBasis;
  /**
   * v0.8 主板块：同样 Omit 后重声明为**可选**（v0.8 前的备份没有这个键）。
   *
   * ⚠️ 这里收的是 `string` 而非 `StageTemplateDomain`——与 `type` 同理由：
   * zod schema 用 `z.string()` 宽收（不做枚举收窄，保证将来新增行业不被旧客户端拒绝），
   * 故入参类型必须与解析产物一致，归一函数体内再 `as` 回窄类型。
   */
  domain?: string | null;
  /**
   * v0.8 归属侧：同上，`z.string()` 宽收 → 这里收 `string`。
   * 归一保证产出的 `Project.kind` 恒有值（回落 DEFAULT_PROJECT_KIND）。
   */
  kind?: string | null;
  /**
   * v0.8.6 归属人：老备份无此键 → 可选。归一出 null（公共板）。
   */
  ownerMemberId?: string | null;
};

export type StageRowInput = Omit<Stage, 'status' | 'templateKey' | 'colorIndex' | 'customColor'> & {
  status: string;
  templateKey?: string | null;
  colorIndex?: number;
  /** v0.8 用户自定义主色：v0.8 前的备份没有这个键 → 可选，归一补 null */
  customColor?: string | null;
};

/**
 * 整行归一：补齐 templateKey / colorIndex，并**按 entities.ts 的键序重建对象**。
 * 键序不是洁癖——backup roundtrip 用 JSON.stringify 做逐表 diff，
 * 归一产物必须和 repo insert 行字面量的键序一致（键序铁律）。
 */
export function normalizeStageRow(row: StageRowInput): Stage {
  return {
    id: row.id,
    projectId: row.projectId,
    orderIndex: row.orderIndex,
    /*
      ⚠️ 这里**必须**用 `resolveImportedTemplateKey`，不能用 `resolveStageTemplateKey`：
      后者是读时回落（显式 null 也回落），在写时归一条 `templateKey: null` 的阶段会把它
      永久改写成 `indoor.*` ⇒ 备份往返后换列 + roundtrip 逐表 diff 非空。
      详见 `resolveImportedTemplateKey` 的注释。
    */
    templateKey: resolveImportedTemplateKey(row.orderIndex, row.templateKey),
    colorIndex: resolveStageColorIndex(row.orderIndex, row.colorIndex),
    customColor: row.customColor ?? null,
    name: row.name,
    ratioPercent: row.ratioPercent,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status as Stage['status'],
    ownerId: row.ownerId,
    visible: row.visible,
    resourcePath: row.resourcePath,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

/**
 * 整行归一：补齐 shortLabel / stagePresetKey / stageTemplateVersion / scheduleBasis
 * / domain / kind（键序同 entities.ts：shortLabel 紧随 coverColor，
 * 三个阶段字段 + v0.8 的 domain/kind 再紧随其后）。
 */
export function normalizeProjectRow(row: ProjectRowInput): Project {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    clientName: row.clientName,
    contractAmount: row.contractAmount,
    signedAt: row.signedAt,
    plannedStartAt: row.plannedStartAt,
    plannedEndAt: row.plannedEndAt,
    coverColor: row.coverColor,
    shortLabel: row.shortLabel ?? null,
    stagePresetKey: row.stagePresetKey ?? null,
    stageTemplateVersion: row.stageTemplateVersion ?? LEGACY_STAGE_TEMPLATE_VERSION,
    scheduleBasis: row.scheduleBasis ?? DEFAULT_SCHEDULE_BASIS,
    /**
     * ⚠️ **此处刻意不做 domain 反查**（偏离 v0.8 设计文档 §3.2 的字面表达式）。
     *
     * 文档原文写的是 `row.domain ?? getPreset(row.stagePresetKey ?? '')?.domain ?? 'indoor'`。
     * 照抄会破坏「导出 → 导入 → 再导出 逐表 diff 为空」这条**既有已测不变量**
     * （`tests/task-no.roundtrip.spec.ts` 与 `tests/backup.roundtrip.spec.ts` 都断言它）：
     *   · 建档侧 `repo.insert` 落的是 `cmd.domain ?? null` ⇒ 首次导出 `domain: null`；
     *   · 导入侧走本函数 ⇒ 若在此反查，落库变 'indoor' ⇒ 二次导出 `domain: "indoor"`；
     *   · 两次导出不等 ⇒ 往返被判定不稳定（实测 4 个 roundtrip 用例同时红）。
     * 对照 `scheduleBasis`：它能在此补默认值，是因为**建档侧也写同一个默认值**，
     * 两侧口径一致才幂等。domain 满足不了这个前提（建档侧写 null）。
     *
     * 更关键的是语义：`null` = 「**不知道**」，而 'indoor' = 「**知道是室内**」。
     * 在归一里把 null 改写成 'indoor' 属于**伪造数据**，直接废掉 §3.2.1 的
     * `needsDomainConfirm`（它判的正是 `domain == null`）——存量 custom 项目一点「确认」
     * 就被静默当成已确认，用户永远看不到提示条。
     *
     * ⇒ 反查移到**消费侧**：由 `resolveProjectDomain(p.stagePresetKey, p.domain)` 在
     * 派生时完成（`deriveColumns` / `columnOf` / 详情页）。实体里保持 null，
     * 与 `shortLabel`（实体 null、展示层 `resolveProjectShortLabel` 回落）同一手法。
     */
    domain: (row.domain as StageTemplateDomain | null | undefined) ?? null,
    kind: (row.kind as ProjectKind | null | undefined) ?? DEFAULT_PROJECT_KIND,
    // v0.8.6 归属人：缺键/空值一律 null（公共板）——不推断、不改写（同 domain 的
    // 「null = 不知道」语义：把别人的板猜成某个人的，比留空危险得多）
    ownerMemberId: row.ownerMemberId ?? null,
    status: row.status as Project['status'],
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}
