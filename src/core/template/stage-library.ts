import type {
  StageColumn,
  StageDomain,
  StagePreset,
  StageTemplateItem,
  StageTemplateLibraryFile,
} from '../types/dto';
import rawLibrary from '../../../templates/stage-library.json';

/**
 * templates/stage-library.json 的强类型访问器（铁律 9）：
 * 阶段模板默认值只存在于该 JSON，代码不得硬编码第二份。
 *
 * 与 nine-stages.ts 的分工：
 *   - nine-stages.ts 仍是「固定九段」的回归锚点（过渡期保留）；
 *   - 本文件是阶段模板库的唯一出口（阶段项 + 套餐），供建档选择、取色、看板分桶使用。
 */

const library = rawLibrary as unknown as StageTemplateLibraryFile;

/** 全部阶段项（按 JSON 声明顺序：室内 → 景观 → 建筑） */
export function getStageLibraryItems(): StageTemplateItem[] {
  return library.items;
}

/** 单个阶段项（找不到抛错——阶段项 key 一旦落库即不可缺失） */
export function getStageLibraryItem(key: string): StageTemplateItem {
  const found = library.items.find((item) => item.key === key);
  if (!found) {
    throw new Error(`阶段模板库缺少 key=${key} 的定义（templates/stage-library.json）`);
  }
  return found;
}

/** 全部阶段套餐（按 JSON 声明顺序） */
export function getPresets(): StagePreset[] {
  return library.presets;
}

/** 单个套餐（找不到返回 null） */
export function getPreset(key: string): StagePreset | null {
  return library.presets.find((p) => p.key === key) ?? null;
}

/** 套餐的阶段项列表（按 itemKeys 顺序返回；未知 key 一律跳过，不抛错） */
export function getPresetItems(presetKey: string): StageTemplateItem[] {
  const preset = getPreset(presetKey);
  if (!preset) return [];
  const byKey = new Map(library.items.map((item) => [item.key, item]));
  return preset.itemKeys
    .map((key) => byKey.get(key))
    .filter((item): item is StageTemplateItem => Boolean(item));
}

/** 阶段模板库版本（Project.stageTemplateVersion 的取值来源） */
export function getStageLibraryVersion(): number {
  return library.version;
}

/* ---------------------- v2：行业与看板列 ---------------------- */

/**
 * 全部行业定义，按 JSON 声明顺序（设计三行业在前，保证既有项目的列顺序不变）。
 * 返回 [行业键, 行业定义] 数组而非对象——对象不保证遍历顺序，看板列必须有序。
 */
export function getDomains(): Array<[string, StageDomain]> {
  return Object.entries(library.domains ?? {});
}

/** 单个行业定义（未知行业返回 null，不抛错：模板数据可能滞后于用户导入的项目） */
export function getDomain(domainKey: string | null | undefined): StageDomain | null {
  if (!domainKey) return null;
  return library.domains?.[domainKey] ?? null;
}

/** 某行业的看板列（未知行业返回空数组，调用方自行回退） */
export function getDomainColumns(domainKey: string | null | undefined): StageColumn[] {
  return getDomain(domainKey)?.columns ?? [];
}

/**
 * 阶段项所属看板列。
 * 返回列键（如 'developing'），找不到阶段项时返回 null —— 老项目 templateKey 可能为 null。
 */
export function getItemKanbanColumn(itemKey: string | null | undefined): string | null {
  if (!itemKey) return null;
  return findStageLibraryItem(itemKey)?.kanbanColumn ?? null;
}

/** 阶段项的安全查找（不存在返回 null，不抛错） */
export function findStageLibraryItem(key: string): StageTemplateItem | null {
  return library.items.find((item) => item.key === key) ?? null;
}
