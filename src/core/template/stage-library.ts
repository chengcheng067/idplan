import type {
  IndustryGroup,
  StageColumn,
  StageDomain,
  StagePreset,
  StageTemplateDomain,
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

/* ---------------------- v0.8：行业大类分组（建档第 1 层） ---------------------- */

/**
 * 全部行业大类，按 JSON 数组顺序（**数组顺序 ＝ 建档第 1 层显示顺序**）。
 *
 * 老 JSON 无 `industryGroups` 段时返回 `[]` —— 调用方据此回退到「按 domains
 * 一级平铺」，不崩（`dto.ts` 已把该字段标为可选）。
 */
export function getIndustryGroups(): IndustryGroup[] {
  return library.industryGroups ?? [];
}

/** 某大类覆盖的领域（未知 groupKey 返回空数组，不抛错） */
export function getGroupDomains(groupKey: string): StageTemplateDomain[] {
  return getIndustryGroups().find((g) => g.key === groupKey)?.domains ?? [];
}

/**
 * 大类是否「伞形」：`domains.length > 1` ⇒ 需要展开第 2 层；
 * `=== 1` ⇒ 一级平铺，点了即定主板块。
 * 用长度判定而不读第二个字段——少一套枚举就少一处漂移（§2.3）。
 */
export function isUmbrellaGroup(groupKey: string): boolean {
  return getGroupDomains(groupKey).length > 1;
}

/** 若干大类的领域并集（**去重、保序**：按大类顺序、大类内按 domains 顺序） */
export function getDomainsOfGroups(groupKeys: string[]): StageTemplateDomain[] {
  const out: StageTemplateDomain[] = [];
  for (const groupKey of groupKeys) {
    for (const d of getGroupDomains(groupKey)) {
      if (!out.includes(d)) out.push(d);
    }
  }
  return out;
}

/**
 * 建档 UI 里「可用」的领域（第 2 层 `<select>` 的候选）。
 *
 * 口径 = 出现在 `industryGroups` 里 **且** 阶段库里至少有一个阶段项：
 *   · `exhibition` 不在任何大类里（`dto.ts:323` 明文：P1 预留、当前无数据）⇒ 天然被排除；
 *   · 「有 items」这一条是**数据侧保险**——将来某个大类挂了空领域也不会在 UI 里
 *     留下一个选了没东西可挑的选项。
 * 结果恒为 9 个（见 §2.3），顺序＝大类声明顺序。
 */
export function getUsableDomains(): StageTemplateDomain[] {
  const withItems = new Set(library.items.map((item) => item.domain));
  const out: StageTemplateDomain[] = [];
  for (const group of getIndustryGroups()) {
    for (const d of group.domains) {
      if (!withItems.has(d)) continue;
      if (!out.includes(d)) out.push(d);
    }
  }
  return out;
}

/** 主板块下的全部套餐（A5：套餐只列主板块所属领域；顺序＝JSON 声明顺序） */
export function getPresetsByDomain(domain: StageTemplateDomain): StagePreset[] {
  return library.presets.filter((p) => p.domain === domain);
}

/**
 * 若干领域下的全部阶段项（A6：可见阶段池 ＝ 主板块 ∪ 关联板块）。
 * 顺序＝JSON 声明顺序；领域内重复项（同一 item 只属一个 domain）天然不重复。
 */
export function getItemsByDomains(domains: StageTemplateDomain[]): StageTemplateItem[] {
  const wanted = new Set<string>(domains);
  return library.items.filter((item) => wanted.has(item.domain));
}
