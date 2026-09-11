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
import type { ScheduleBasis } from '../types/enums';
import { getPresetItems } from './stage-library';

/**
 * 室内·全流程套餐 key。双重身份：
 *   1. 老数据 templateKey 反查源（其 9 项与 templates/nine-stages.default.json 逐字段等价）；
 *   2. 手动建档未指定阶段集合时的默认套餐（产出即九段，与改造前一致）。
 */
export const INTERIOR_FULL_PRESET_KEY = 'indoor_full';

/** 用户在阶段池里增删过阶段项后的套餐归属（PRD §3.2.2 / AC-09） */
export const CUSTOM_STAGE_PRESET_KEY = 'custom';

export const LEGACY_STAGE_TEMPLATE_VERSION = 0;

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

/** 读时回落：colorIndex 缺失/越界时按 orderIndex 夹取 */
export function resolveStageColorIndex(orderIndex: number, colorIndex?: number | null): number {
  if (typeof colorIndex === 'number' && Number.isFinite(colorIndex)) {
    const n = Math.trunc(colorIndex);
    if (n >= MIN_COLOR_INDEX && n <= MAX_COLOR_INDEX) return n;
  }
  return legacyColorIndexOf(orderIndex);
}

/**
 * 导入侧的行形状（zod 校验产物）：枚举字段在 schema 里是 `z.string()`（导入不做枚举收窄，
 * 保证将来新增枚举值不被旧客户端拒绝），故这里按 string 收，归一后原样透传。
 * 形状由 Project / Stage 派生（Omit），不重复声明实体（铁律 7）。
 */
export type ProjectRowInput = Omit<
  Project,
  'type' | 'status' | 'stagePresetKey' | 'stageTemplateVersion' | 'scheduleBasis' | 'shortLabel'
> & {
  type: string;
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
};

export type StageRowInput = Omit<Stage, 'status' | 'templateKey' | 'colorIndex'> & {
  status: string;
  templateKey?: string | null;
  colorIndex?: number;
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
    templateKey: resolveStageTemplateKey(row.orderIndex, row.templateKey),
    colorIndex: resolveStageColorIndex(row.orderIndex, row.colorIndex),
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
 * （键序同 entities.ts：shortLabel 紧随 coverColor，三个阶段字段再紧随其后）。
 */
export function normalizeProjectRow(row: ProjectRowInput): Project {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Project['type'],
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
    status: row.status as Project['status'],
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}
