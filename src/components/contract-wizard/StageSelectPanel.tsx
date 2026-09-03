import { useEffect, useMemo, useRef } from 'react';

import { ArrowDown, ArrowUp, X } from 'lucide-react';

import {
  getPresetItems,
  getPresets,
  getStageLibraryItems,
} from '../../core/template/stage-library';
import { CUSTOM_STAGE_PRESET_KEY, INTERIOR_FULL_PRESET_KEY } from '../../core/template/stage-fallback';
import { MAX_STAGE_COUNT, MIN_STAGE_COUNT } from '../../core/template/split';
import {
  ALL_SCHEDULE_BASIS,
  ProjectType,
  SCHEDULE_BASIS_LABELS,
  type ScheduleBasis,
} from '../../core/types/enums';
import type { StageTemplateDomain, StageTemplateItem } from '../../core/types/dto';
import { STAGE_BAR_COLORS } from '../timeline/stageColors';
import { useProjectsStore } from '../../store/useProjectsStore';

/**
 * 阶段选择面板（建档两条路径共用的受控组件）：
 *   1. 快捷套餐：遍历 getPresets()，点击整体替换为套餐集合；
 *   2. 阶段池：遍历 getStageLibraryItems()，按 domain 分组，勾选即追加到末尾；
 *   3. 已选顺序列表：序号即最终 orderIndex（1..N 连续），支持 ↑↓ 调序与 ✕ 移除；
 *   4. 边界：至少 1 项（清空时行内提示），最多 12 项（达上限禁止勾选并 toast）。
 *
 * 套餐归属由父组件经 `presetKeyOfItems(selected)` 推导：与任一内置套餐的
 * itemKeys 顺序一致 → 该套餐 key；否则 'custom'（PRD §3.2.2 / AC-09）。
 */
export function StageSelectPanel({
  selected,
  onChange,
  projectType,
  scheduleBasis,
  onScheduleBasisChange,
  durations,
  onDurationChange,
}: {
  selected: StageTemplateItem[];
  onChange(next: StageTemplateItem[]): void;
  /** 项目类型：变化且用户未手动改过阶段选择时，自动预选对应套餐（PRD §3.2.2） */
  projectType?: ProjectType;
  /** 排期基准（受控）：传了才渲染切换区（自然日 / 工作日） */
  scheduleBasis?: ScheduleBasis;
  onScheduleBasisChange?(next: ScheduleBasis): void;
  /** 每阶段时长覆盖（受控，key=阶段 key，value=天数字符串）。不传则不渲染「按阶段时长」输入 */
  durations?: Record<string, string>;
  /** 某阶段时长变化回调（value 为空字符串=清除自定义） */
  onDurationChange?(key: string, value: string): void;
}): JSX.Element {
  /** 用户是否已手动改过阶段选择（点套餐 / 池子勾选 / 调序 / 移除都算）。true 后不再跟随项目类型自动切换 */
  const dirtyRef = useRef(false);
  const prevTypeRef = useRef<ProjectType | undefined>(projectType);

  useEffect(() => {
    if (projectType === undefined || projectType === prevTypeRef.current) return;
    prevTypeRef.current = projectType;
    if (!dirtyRef.current) {
      onChange(getPresetItems(defaultPresetKeyFor(projectType)));
    }
  }, [projectType, onChange]);

  const items = useMemo(() => getStageLibraryItems(), []);
  const presets = useMemo(() => getPresets(), []);

  const grouped = useMemo(() => {
    const map = new Map<StageTemplateDomain, StageTemplateItem[]>();
    for (const item of items) {
      const list = map.get(item.domain) ?? [];
      list.push(item);
      map.set(item.domain, list);
    }
    return [...map.entries()];
  }, [items]);

  const selectedKeys = useMemo(() => new Set(selected.map((s) => s.key)), [selected]);
  const currentPresetKey = presetKeyOfItems(selected);
  const atMax = selected.length >= MAX_STAGE_COUNT;
  const belowMin = selected.length < MIN_STAGE_COUNT;

  const markDirty = (): void => {
    dirtyRef.current = true;
  };

  /** 勾选/取消池子里的阶段项；新勾选项追加到末尾 */
  const toggleItem = (item: StageTemplateItem): void => {
    if (selectedKeys.has(item.key)) {
      markDirty();
      onChange(selected.filter((s) => s.key !== item.key));
      return;
    }
    if (atMax) {
      useProjectsStore
        .getState()
        .pushToast('error', `单次项目最多 ${MAX_STAGE_COUNT} 个阶段`);
      return;
    }
    markDirty();
    onChange([...selected, item]);
  };

  /** 已选列表 ↑↓ 调序（移动后顺序即最终 orderIndex） */
  const move = (index: number, dir: -1 | 1): void => {
    const target = index + dir;
    if (target < 0 || target >= selected.length) return;
    markDirty();
    const next = [...selected];
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    onChange(next);
  };

  /** 已选列表 ✕ 移除 */
  const removeAt = (index: number): void => {
    markDirty();
    onChange(selected.filter((_, i) => i !== index));
  };

  /** 快捷套餐：整体替换为套餐集合（显式操作，同样视为用户已手动选择） */
  const applyPreset = (presetKey: string): void => {
    markDirty();
    onChange(getPresetItems(presetKey));
  };

  return (
    <div className="space-y-4">
      {/* 头部：已选 N / 上限 */}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-ink">选择本次服务的阶段</span>
        <span className="text-mist">
          已选 {selected.length} / 上限 {MAX_STAGE_COUNT}
        </span>
      </div>

      {/* 排期基准切换（受控；不传则不渲染） */}
      {scheduleBasis !== undefined && onScheduleBasisChange !== undefined && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">排期基准</span>
          <div className="flex flex-wrap gap-1.5">
            {ALL_SCHEDULE_BASIS.map((b) => (
              <button
                key={b}
                type="button"
                aria-label={`排期基准 ${SCHEDULE_BASIS_LABELS[b]}`}
                onClick={() => onScheduleBasisChange(b)}
                aria-pressed={b === scheduleBasis}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  b === scheduleBasis
                    ? 'border-pine bg-pine text-white'
                    : 'border-sand bg-paper text-mist hover:bg-sand'
                }`}
              >
                {SCHEDULE_BASIS_LABELS[b]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 按阶段时长排期（受控：传了 durations 才渲染；为每阶段填天数后自动顺延算竣工） */}
      {durations !== undefined && onDurationChange !== undefined && (
        <div className="rounded-md border border-sand bg-cream/40 p-2.5">
          <p className="mb-1.5 text-xs font-medium text-mist">
            按阶段时长排期（为每个阶段填天数，竣工日期自动算出）
          </p>
          <p className="text-[11px] leading-4 text-mist">
            未填的阶段按默认占比匀摊。你也可以直接在「展开设置 → 排期基准」切换自然日 / 工作日口径。
          </p>
        </div>
      )}

      {/* 快捷套餐 */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-mist">快捷套餐</p>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const active = currentPresetKey === p.key;
            return (
              <button
                key={p.key}
                type="button"
                aria-label={`套餐 ${p.name}`}
                onClick={() => applyPreset(p.key)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  active
                    ? 'border-pine bg-pine-soft/50 text-pine'
                    : 'border-sand bg-paper text-mist hover:bg-sand'
                }`}
              >
                {p.name}（{p.itemKeys.length}）
              </button>
            );
          })}
        </div>
      </div>

      {/* 阶段池（按 domain 分组） */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-mist">阶段池</p>
        <div className="space-y-2.5 rounded-md border border-sand bg-paper p-3">
          {grouped.map(([domain, list]) => (
            <div key={domain}>
              <p className="mb-1 text-xs font-medium text-mist">{DOMAIN_LABELS[domain]}</p>
              <div className="flex flex-wrap gap-1.5">
                {list.map((item) => {
                  const checked = selectedKeys.has(item.key);
                  // 达上限时未选项点击被拒并 toast（PRD §3.3 规则 5），不做硬 disabled 以便给出提示
                  const blocked = !checked && atMax;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-label={`${checked ? '取消选择' : '选择'}阶段 ${item.name}`}
                      aria-pressed={checked}
                      aria-disabled={blocked}
                      onClick={() => toggleItem(item)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        checked
                          ? 'border-pine bg-pine-soft/50 text-pine'
                          : 'border-sand bg-cream text-ink hover:bg-sand'
                      } ${blocked ? 'cursor-not-allowed opacity-40' : ''}`}
                    >
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: STAGE_BAR_COLORS[item.colorIndex] ?? '#CBD5E1' }}
                      />
                      {item.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 已选顺序列表 */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-mist">已选顺序（可上下调整）</p>
        {belowMin ? (
          <p className="rounded-md border border-clay-soft bg-clay-soft/50 p-3 text-sm leading-6 text-clay">
            至少选择 {MIN_STAGE_COUNT} 个阶段
          </p>
        ) : (
          <ol className="divide-y divide-sand rounded-md border border-sand bg-paper">
            {selected.map((item, index) => (
              <li
                key={item.key}
                className="grid grid-cols-[1.5rem_auto_minmax(0,1fr)_auto_auto_auto_auto] items-center gap-2 px-3 py-2 text-sm"
                data-testid={`selected-row-${index + 1}`}
              >
                {/* 序号 */}
                <span className="text-center text-xs tabular-nums text-mist">{index + 1}</span>
                {/* 色点 */}
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: STAGE_BAR_COLORS[item.colorIndex] ?? '#CBD5E1' }}
                />
                {/* 名称（可收缩截断） */}
                <span className="truncate text-ink">{item.name}</span>
                {/* 时长（可选） */}
                {durations !== undefined && onDurationChange !== undefined && (
                  <span className="flex items-center gap-1 rounded-md border border-sand bg-cream px-1.5 py-0.5">
                    <input
                      type="number"
                      min={1}
                      value={durations[item.key] ?? ''}
                      onChange={(e) => onDurationChange(item.key, e.target.value)}
                      placeholder="天数"
                      aria-label={`${item.name} 时长（天）`}
                      className="w-10 bg-transparent text-right text-xs tabular-nums text-ink outline-none placeholder:text-mist"
                    />
                    <span className="text-[10px] text-mist">天</span>
                  </span>
                )}
                {/* 占比 */}
                <span className="text-right text-xs tabular-nums text-mist">
                  {item.ratioPercent}%
                </span>
                {/* 排序控制（固定三钮，左右各留 0.5 间隙） */}
                <span className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={`上移 ${item.name}`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="rounded p-0.5 text-mist hover:bg-sand disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`下移 ${item.name}`}
                    disabled={index === selected.length - 1}
                    onClick={() => move(index, 1)}
                    className="rounded p-0.5 text-mist hover:bg-sand disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`移除 ${item.name}`}
                    onClick={() => removeAt(index)}
                    className="rounded p-0.5 text-mist hover:bg-sand hover:text-clay"
                  >
                    <X size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** domain → 中文标签（UI 文案，与 PROJECT_TYPE_LABELS 体例一致，仅本组件内使用） */
const DOMAIN_LABELS: Record<StageTemplateDomain, string> = {
  indoor: '室内',
  landscape: '景观',
  architecture: '建筑',
  exhibition: '展陈',
  // v2 跨行业
  software: '软件',
  marketing: '活动',
  film: '影视',
  wedding: '婚礼',
  consulting: '咨询',
};

/** 项目类型 → 默认预选套餐 key（PRD §3.4：室内类 → indoor_full 九段；景观 → landscape_full；建筑 → architecture_full） */
export function defaultPresetKeyFor(type: ProjectType): string {
  switch (type) {
    case ProjectType.LandscapeDesign:
      return 'landscape_full';
    case ProjectType.ArchitectureDesign:
      return 'architecture_full';
    default:
      return INTERIOR_FULL_PRESET_KEY;
  }
}

/** 已选阶段项 → 套餐归属：顺序敏感匹配任一内置套餐，否则 CUSTOM_STAGE_PRESET_KEY（AC-09） */
export function presetKeyOfItems(items: StageTemplateItem[]): string {
  const keys = items.map((i) => i.key);
  const hit = getPresets().find((p) => sameKeyList(p.itemKeys, keys));
  return hit ? hit.key : CUSTOM_STAGE_PRESET_KEY;
}

function sameKeyList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}
