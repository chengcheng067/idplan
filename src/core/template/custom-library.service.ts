/**
 * 自定义行业库 · 读侧归一 + 存取 service（v0.8.6）。
 *
 * 分工（安全官 C.4-10）：**校验在导入侧**（custom-library.schema.ts 严格 zod），
 * **归一在读侧**（本文件，绝不抛错——与既有 custom-stage.service 同家风：
 * 坏数据安静跳过并留痕，绝不让半个坏包把建档界面搞崩）。
 *
 * 落点 = settings KV `customLibraries`（与自定义阶段 customStages 同模式；
 * remote 形态走 HTTP——P0-1 写端点鉴权已覆盖，Bearer 前端全覆盖无感）。
 */

import { normalizeHex } from '../color/contrast';
import type { CustomLibraryFile } from './custom-library.schema';
import { CUSTOM_LIBRARY_KEY_PREFIX } from './custom-library.schema';
import type { StageTemplateItem } from '../types/dto';

/** settings KV 键（与 CUSTOM_STAGES_SETTING_KEY 同模式） */
export const CUSTOM_LIBRARIES_SETTING_KEY = 'customLibraries';

/** 入库后的行业包 = 校验过的文件 + 导入时间戳 + 用户可见状态 */
export interface StoredCustomLibrary extends CustomLibraryFile {
  /** 导入时间（ISO） */
  importedAt: string;
}

/** clamp 到 1..9（复用内置 9 色口径；超出=读侧兜底，不抛错） */
function clampColorIndex(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 1;
  return Math.min(9, Math.max(1, n));
}

/**
 * 读侧归一：任意脏数据 → 可用的 StoredCustomLibrary[]。
 * 铁律：**绝不抛错**。单条坏（schema 不符/items 空/字段类型错）→ 跳过该条；
 * 整体不是数组 → 空数组。调用方（建档 UI）拿到的一定是能渲染的形状。
 */
export function normalizeCustomLibraries(raw: unknown): StoredCustomLibrary[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredCustomLibrary[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (e.schema !== 'idplan-custom-library/v1') continue;
    const name = typeof e.name === 'string' && e.name.trim() ? e.name.trim() : null;
    const domain = typeof e.domain === 'string' ? (e.domain as CustomLibraryFile['domain']) : null;
    if (!name || !domain) continue;
    if (!Array.isArray(e.items) || e.items.length === 0) continue;
    if (!Array.isArray(e.presets) || e.presets.length === 0) continue;
    out.push({
      schema: 'idplan-custom-library/v1',
      name,
      domain,
      items: e.items as CustomLibraryFile['items'],
      presets: e.presets as CustomLibraryFile['presets'],
      importedAt: typeof e.importedAt === 'string' ? e.importedAt : new Date(0).toISOString(),
    });
  }
  return out;
}

/** 自定义阶段项 → 内置形状的 StageTemplateItem（建档/切分链路直接消费） */
export function customItemToTemplateItem(item: {
  key: string;
  name: string;
  ratioPercent: number;
  colorIndex: number;
  kanbanColumn: string;
  defaultResponsibility?: string;
  defaultTasks?: string[];
  customColor?: string;
}): StageTemplateItem {
  return {
    key: item.key,
    name: item.name,
    // domain 由调用方按包 domain 覆写（这里占位，读侧已知）——见 buildCustomPresetItems
    domain: 'indoor',
    ratioPercent: Number.isFinite(item.ratioPercent) ? item.ratioPercent : 5,
    colorIndex: clampColorIndex(item.colorIndex),
    kanbanColumn: item.kanbanColumn,
    defaultResponsibility: item.defaultResponsibility ?? '',
    defaultTasks: Array.isArray(item.defaultTasks) ? item.defaultTasks : [],
    // 自定义主色：只经 normalizeHex（安全官 C.4-4：禁任意 style 串）
    ...(item.customColor ? { customColor: normalizeHex(item.customColor) } : {}),
  };
}

/** 取某包下 presets 展开的阶段项（供建档「已选阶段」预填） */
export function buildCustomPresetItems(
  lib: StoredCustomLibrary,
  presetKey: string,
): StageTemplateItem[] {
  const preset = lib.presets.find((p) => p.key === presetKey);
  if (!preset) return [];
  const byKey = new Map(lib.items.map((it) => [it.key, it]));
  const out: StageTemplateItem[] = [];
  preset.itemKeys.forEach((k, i) => {
    const item = byKey.get(k);
    if (!item) return; // 导入侧已硬校验悬空；这里是双保险
    out.push({
      ...customItemToTemplateItem(item),
      domain: lib.domain as StageTemplateItem['domain'],
      // orderIndex 语义由调用方管；这里只保证顺序 = itemKeys 顺序
      key: `${item.key}`,
    });
    void i;
  });
  return out;
}

/** key 前缀工具（UI 展示「自定义」角标用） */
export function isCustomLibraryKey(key: string): boolean {
  return key.startsWith(CUSTOM_LIBRARY_KEY_PREFIX);
}
