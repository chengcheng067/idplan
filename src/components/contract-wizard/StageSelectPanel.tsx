import { useMemo, useState } from 'react';

import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';

import {
  getItemsByDomains,
  getPresetItems,
  getPresets,
  getPresetsByDomain,
  getUsableDomains,
} from '../../core/template/stage-library';
import { CUSTOM_STAGE_PRESET_KEY, INTERIOR_FULL_PRESET_KEY } from '../../core/template/stage-fallback';
import { MAX_STAGE_COUNT, MIN_STAGE_COUNT } from '../../core/template/split';
import {
  firstUnusedColorIndex,
  type CustomStageDef,
} from '../../core/services/custom-stage.service';
import {
  ALL_SCHEDULE_BASIS,
  SCHEDULE_BASIS_LABELS,
  type ScheduleBasis,
} from '../../core/types/enums';
import type { StageSelectionItem, StageTemplateDomain, StageTemplateItem } from '../../core/types/dto';
import { useProjectsStore } from '../../store/useProjectsStore';
import { domainLabel } from './DomainCascade';
import { CustomStageDialog, type CustomStageDraft } from './CustomStageDialog';
import { stageColorPaint } from './stage-color-bridge';

/**
 * 阶段选择面板（建档两条路径共用的受控组件 —— 向导与手动兜底）：
 *   1. 快捷套餐：**只列主板块的套餐**（A5，`getPresetsByDomain`）；未传主板块时列全部（向后兼容）；
 *   2. 阶段池：按可见板块集过滤（`getItemsByDomains`），其余行业折叠在「显示其他行业阶段」（A6）；
 *      **已选中的阶段无论属于哪个分组都始终可见**（A6 末句），否则用户无法取消它；
 *   3. 已选顺序列表：序号即最终 orderIndex（1..N 连续），支持 ↑↓ 调序与 ✕ 移除；
 *   4. 边界：至少 1 项（清空时行内提示），最多 `MAX_STAGE_COUNT`（v0.8 起 20）项
 *      （达上限禁止勾选并 toast）；≥ 13 段给**非阻塞**提示（A10 ③）；
 *   5. 自定义阶段（仅建档时，TBD-1）：池子顶部「＋ 自定义阶段」→ 弹窗 → 追加并自动勾选（A8）；
 *   6. 重名校验（A9）：同项目内阶段名重复 → 行内提示（父组件据此阻止提交）。
 *
 * 套餐归属由父组件经 `presetKeyOfItems(selected)` 推导：与任一内置套餐的
 * itemKeys 顺序一致 → 该套餐 key；否则 'custom'（PRD §3.2.2 / AC-09）。
 */
export function StageSelectPanel({
  selected,
  onChange,
  scheduleBasis,
  onScheduleBasisChange,
  durations,
  onDurationChange,
  domain = null,
  visibleDomains,
  customStages,
  onCustomStageSubmit,
}: {
  selected: StageSelectionItem[];
  onChange(next: StageSelectionItem[]): void;
  /** 排期基准（受控）：传了才渲染切换区（自然日 / 工作日） */
  scheduleBasis?: ScheduleBasis;
  onScheduleBasisChange?(next: ScheduleBasis): void;
  /** 每阶段时长覆盖（受控，key=阶段 key，value=天数字符串）。不传则不渲染「按阶段时长」输入 */
  durations?: Record<string, string>;
  /** 某阶段时长变化回调（value 为空字符串=清除自定义） */
  onDurationChange?(key: string, value: string): void;
  /**
   * v0.8：主板块（快捷套餐只列它的套餐）。
   * `null` / 不传 ⇒ 列全部套餐 —— 保持改造前行为（既有调用点零改动）。
   */
  domain?: StageTemplateDomain | null;
  /**
   * v0.8：**可见阶段池的板块集**（＝ `DomainCascade.visibleDomainsOf(...)`）。
   * `undefined` ⇒ **不过滤**（全部行业分组平铺，改造前行为）；
   * 传数组 ⇒ 只显示这些分组，其余折叠在「显示其他行业阶段」。
   */
  visibleDomains?: StageTemplateDomain[];
  /** v0.8：自定义阶段项（建档时内存态 ＋ 复用库条目），渲染在「自定义阶段」分组（恒可见） */
  customStages?: StageSelectionItem[];
  /** v0.8：传了才渲染「＋ 自定义阶段」入口（即**仅建档路径**，TBD-1） */
  onCustomStageSubmit?(draft: CustomStageDraft): void;
}): JSX.Element {
  /*
   * ⚠️ 这里**刻意没有**「主板块一变就自动重选套餐」的 effect（2026-09-17 删，勿加回）。
   *
   * 旧实现按**已删除的 `Project.type`** 触发自动预选（`类型` 是弹窗外独立字段，用户改它
   * 本来就要重选阶段）。`类型` 删除后，若把触发字段换成 `domain`，就会踩中一个真实伤害：
   * **`domain`（主板块）是用户在本表单里会反复改的字段** —— 改成「婚礼」的瞬间，
   * 已选的九段室内阶段会被静默替换成婚礼的两段，用户前面挑的东西凭空消失。
   * 这正是验收 A5「**切换主板块后已选阶段不丢**」（`tests/v08-stage-wizard.spec.tsx:407`）
   * 锁住的行为，改按 domain 触发后该用例立刻变红。
   *
   * 取而代之的两条正路（都不丢用户已选）：
   *   ① **初始值**由调用方按主板块给（见 `ManualFallbackForm` 的 `useState` 初值）；
   *   ② 用户想换套餐时**显式点**下方按主板块过滤出的套餐胶囊（`presets`）。
   * 即「预选」发生在打开表单那一刻与用户主动点击时，**绝不发生在用户改主板块的瞬间**。
   */

  const presets = useMemo(
    () => (domain ? getPresetsByDomain(domain) : getPresets()),
    [domain],
  );

  /** 其余行业（折叠区）是否展开 */
  const [showOthers, setShowOthers] = useState(false);
  /** 自定义阶段弹窗 */
  const [dialogOpen, setDialogOpen] = useState(false);

  const usableDomains = useMemo(() => getUsableDomains(), []);
  const filtering = visibleDomains !== undefined;
  const customItems = customStages ?? [];

  const selectedKeys = useMemo(() => new Set(selected.map((s) => s.key)), [selected]);
  const selectedDomains = useMemo(
    () => new Set(selected.map((s) => s.domain)),
    [selected],
  );

  /**
   * 渲染的分组顺序（稳定：一律按 `getUsableDomains()` 声明序）：
   *   ① 可见板块（`visibleDomains`）；
   *   ② **已选中的阶段所在板块**（即使被过滤掉也要显示 —— A6 末句）；
   *   ③ 展开折叠时才追加的其余板块。
   */
  const shownDomains = useMemo(() => {
    const inPool = filtering ? (visibleDomains ?? []) : usableDomains;
    const out = usableDomains.filter((d) => inPool.includes(d));
    for (const d of usableDomains) {
      if (selectedDomains.has(d) && !out.includes(d)) out.push(d);
    }
    return out;
  }, [filtering, visibleDomains, usableDomains, selectedDomains]);

  const otherDomains = useMemo(
    () => usableDomains.filter((d) => !shownDomains.includes(d)),
    [usableDomains, shownDomains],
  );

  const renderedDomains = showOthers ? [...shownDomains, ...otherDomains] : shownDomains;

  /** 池中可见项（A6：过滤走 `getItemsByDomains`） */
  const poolGroups = useMemo(() => {
    const items = getItemsByDomains(renderedDomains);
    return renderedDomains
      .map((d) => ({ domain: d, items: items.filter((i) => i.domain === d) }))
      .filter((g) => g.items.length > 0);
  }, [renderedDomains]);

  const currentPresetKey = presetKeyOfItems(selected);
  const atMax = selected.length >= MAX_STAGE_COUNT;
  const belowMin = selected.length < MIN_STAGE_COUNT;
  const duplicates = useMemo(() => duplicateStageNames(selected), [selected]);

  /** 新加自定义阶段的默认色号 = 第一个未被占用的内置色（A10 ②）；null = 9 个都用尽了 */
  const nextFreeColorIndex = useMemo(
    () => firstUnusedColorIndex(selected.map((s) => s.colorIndex)),
    [selected],
  );
  /** 未填占比时的建议值 = 已选阶段占比的平均值（PRD §5.3 #8） */
  const averageRatio = useMemo(() => {
    if (selected.length === 0) return undefined;
    const sum = selected.reduce((acc, s) => acc + s.ratioPercent, 0);
    return Math.max(1, Math.round(sum / selected.length));
  }, [selected]);

  /** 勾选/取消池子里的阶段项；新勾选项追加到末尾 */
  const toggleItem = (item: StageTemplateItem): void => {
    if (selectedKeys.has(item.key)) {
      onChange(selected.filter((s) => s.key !== item.key));
      return;
    }
    if (atMax) {
      useProjectsStore
        .getState()
        .pushToast('error', `单次项目最多 ${MAX_STAGE_COUNT} 个阶段`);
      return;
    }
    onChange([...selected, item]);
  };

  /** 已选列表 ↑↓ 调序（移动后顺序即最终 orderIndex） */
  const move = (index: number, dir: -1 | 1): void => {
    const target = index + dir;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    onChange(next);
  };

  /** 已选列表 ✕ 移除 */
  const removeAt = (index: number): void => {
    onChange(selected.filter((_, i) => i !== index));
  };

  /** 快捷套餐：整体替换为套餐集合（显式操作，同样视为用户已手动选择） */
  const applyPreset = (presetKey: string): void => {
    onChange(getPresetItems(presetKey));
  };

  /** 自定义阶段新增：追加到已选末尾（父组件负责记入复用库 —— 本组件不碰仓储） */
  const handleCustomStageSubmit = (draft: CustomStageDraft): void => {
    if (!onCustomStageSubmit) return;
    onCustomStageSubmit(draft);
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
                    : 'border-line bg-paper text-mist hover:bg-sand'
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
        <div className="rounded-md border border-line bg-cream/40 p-2.5">
          <p className="mb-1.5 text-xs font-medium text-mist">
            按阶段时长排期（为每个阶段填天数，竣工日期自动算出）
          </p>
          <p className="text-[11px] leading-4 text-mist">
            未填的阶段按默认占比匀摊。你也可以直接在「展开设置 → 排期基准」切换自然日 / 工作日口径。
          </p>
        </div>
      )}

      {/* 快捷套餐（A5：只列主板块的套餐） */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-mist">
          快捷套餐{domain ? `（${domainLabel(domain)}）` : ''}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {presets.length === 0 && (
            <span className="text-xs text-mist">该板块暂无快捷套餐，请直接勾选阶段。</span>
          )}
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
                    : 'border-line bg-paper text-mist hover:bg-sand'
                }`}
              >
                {p.name}（{p.itemKeys.length}）
              </button>
            );
          })}
        </div>
      </div>

      {/* 阶段池（按板块分组；其余行业可折叠） */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-mist">阶段池</p>
          {onCustomStageSubmit && (
            <button
              type="button"
              aria-label="新增自定义阶段"
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-pine/40 bg-pine-soft/40 px-2 py-0.5 text-xs text-pine hover:bg-pine-soft"
            >
              <Plus size={12} aria-hidden /> 自定义阶段
            </button>
          )}
        </div>
        <div className="space-y-2.5 rounded-md border border-line bg-paper p-3">
          {/* 自定义阶段分组（恒可见：自定义项不属于任何模板分组） */}
          {(customItems.length > 0 || onCustomStageSubmit !== undefined) && (
            <div data-testid="custom-stage-group">
              <p className="mb-1 text-xs font-medium text-mist">自定义阶段</p>
              {customItems.length === 0 ? (
                <p className="text-[11px] leading-4 text-mist">
                  暂无自定义阶段。点上方的「＋ 自定义阶段」添加（如「消防报审」）。
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {customItems.map((item) => (
                    <StageChip
                      key={item.key}
                      item={item}
                      checked={selectedKeys.has(item.key)}
                      blocked={!selectedKeys.has(item.key) && atMax}
                      onToggle={() => toggleItem(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {poolGroups.map((group) => (
            <div key={group.domain} data-testid={`pool-group-${group.domain}`}>
              <p className="mb-1 text-xs font-medium text-mist">{domainLabel(group.domain)}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.items.map((item) => (
                  <StageChip
                    key={item.key}
                    item={item}
                    checked={selectedKeys.has(item.key)}
                    // 达上限时未选项点击被拒并 toast（PRD §3.3 规则 5），不做硬 disabled 以便给出提示
                    blocked={!selectedKeys.has(item.key) && atMax}
                    onToggle={() => toggleItem(item)}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* 折叠：显示其他行业阶段（A6）。已选中的项所在分组已在上面强制显示，不受折叠影响 */}
          {filtering && otherDomains.length > 0 && (
            <div className="border-t border-line pt-2">
              <button
                type="button"
                // 无障碍名可与可见文案带括号，但**必须原样包含**可见文案（WCAG 2.5.3 Label in Name：
                // 语音控制用户说的是屏幕上看到的字；若此处只写「显示其他行业阶段」，
                // 可见文案里的板块清单就成了「名不副实」的部分）
                aria-label={
                  showOthers
                    ? '收起其他行业阶段'
                    : `显示其他行业阶段（${otherDomains.map(domainLabel).join(' / ')}）`
                }
                aria-expanded={showOthers}
                onClick={() => setShowOthers((v) => !v)}
                className="text-xs text-pine hover:underline"
              >
                {showOthers
                  ? '收起其他行业阶段'
                  : `显示其他行业阶段（${otherDomains.map(domainLabel).join(' / ')}）`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 重名提示（A9：行内提示 + 阻止提交，提交按钮由父组件按同一判据禁用） */}
      {duplicates.length > 0 && (
        <p
          data-testid="duplicate-stage-warning"
          className="rounded-md border border-clay-soft bg-clay-soft/50 p-2 text-sm leading-6 text-clay"
        >
          阶段名重复：{duplicates.join('、')}。请改名后再提交（Agent 通道按名定位阶段，重名会歧义）。
        </p>
      )}

      {/* 已选顺序列表 */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-mist">已选顺序（可上下调整）</p>
        {/* ≥13 段非阻塞提示（A10 ③）：不弹窗、不阻断提交 */}
        {selected.length >= LONG_STAGE_LIST_HINT_FROM && (
          <p
            data-testid="long-stage-hint"
            className="mb-2 rounded-md border border-line bg-cream/50 p-2 text-xs leading-5 text-mist"
          >
            已选 {selected.length} 段，阶段较多：建议确认每段都有明确交付物，必要时合并或用套餐。
          </p>
        )}
        {belowMin ? (
          <p className="rounded-md border border-clay-soft bg-clay-soft/50 p-3 text-sm leading-6 text-clay">
            至少选择 {MIN_STAGE_COUNT} 个阶段
          </p>
        ) : (
          <ol className="divide-y divide-sand rounded-md border border-line bg-paper">
            {selected.map((item, index) => {
              // 序号即最终 orderIndex；色点「内联 var() ＋ data-stage-key」成对取自同一出口
              const paint = stageColorPaint(item, index + 1);
              return (
                <li
                  key={item.key}
                  className="grid grid-cols-[1.5rem_auto_minmax(0,1fr)_auto_auto_auto_auto] items-center gap-2 px-3 py-2 text-sm"
                  data-testid={`selected-row-${index + 1}`}
                >
                  {/* 序号 */}
                  <span className="flex h-6 w-6 items-center justify-center text-xs tabular-nums text-mist leading-none">
                    {index + 1}
                  </span>
                  {/* 色点（自定义色走注入表令牌；零动态类名 —— 一律内联 style） */}
                  <span
                    aria-hidden
                    {...paint.attrs}
                    className="h-2.5 w-2.5 rounded-full"
                    style={paint.style}
                  />
                  {/* 名称（可收缩截断） */}
                  <span className="flex h-6 min-w-0 items-center truncate leading-none text-ink">
                    {item.name}
                  </span>
                  {/* 时长（可选） */}
                  {durations !== undefined && onDurationChange !== undefined && (
                    <span className="flex h-6 items-center gap-1 rounded-md border border-line bg-cream px-1.5">
                      <input
                        type="number"
                        min={1}
                        value={durations[item.key] ?? ''}
                        onChange={(e) => onDurationChange(item.key, e.target.value)}
                        placeholder="天数"
                        aria-label={`${item.name} 时长（天）`}
                        className="h-6 w-10 bg-transparent text-right text-xs tabular-nums text-ink outline-none placeholder:text-mist leading-none"
                      />
                      <span className="text-[10px] leading-none text-mist">天</span>
                    </span>
                  )}
                  {/* 占比 */}
                  <span className="flex h-6 w-12 items-center justify-end text-right text-xs tabular-nums text-mist leading-none">
                    {item.ratioPercent}%
                  </span>
                  {/* 排序控制（固定三钮，左右各留 0.5 间隙） */}
                  <span className="flex h-6 items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={`上移 ${item.name}`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      className="h-6 w-6 rounded p-0 text-mist hover:bg-sand disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`下移 ${item.name}`}
                      disabled={index === selected.length - 1}
                      onClick={() => move(index, 1)}
                      className="h-6 w-6 rounded p-0 text-mist hover:bg-sand disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`移除 ${item.name}`}
                      onClick={() => removeAt(index)}
                      className="h-6 w-6 rounded p-0 text-mist hover:bg-sand hover:text-clay"
                    >
                      <X size={14} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* 自定义阶段弹窗（仅建档路径挂载；重名行内提示 + 阻止提交） */}
      {onCustomStageSubmit && (
        <CustomStageDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSubmit={handleCustomStageSubmit}
          existingNames={selected.map((s) => s.name)}
          defaultRatioPercent={averageRatio}
          defaultColorIndex={nextFreeColorIndex ?? 1}
          builtinExhausted={nextFreeColorIndex === null}
        />
      )}
    </div>
  );
}

/** 阶段池里的单个可勾选阶段（色点 + 名称） */
function StageChip({
  item,
  checked,
  blocked,
  onToggle,
  orderIndex = 1,
}: {
  item: StageSelectionItem;
  checked: boolean;
  blocked: boolean;
  onToggle(): void;
  /** 该阶段在项目里的序号（1 起）；池中未落库项无序号，取默认值即可 */
  orderIndex?: number;
}): JSX.Element {
  // 色点两半件（内联 var() ＋ data-stage-key）**必须成对**，故走单一出口取得
  const paint = stageColorPaint(item, orderIndex);
  return (
    <button
      type="button"
      aria-label={`${checked ? '取消选择' : '选择'}阶段 ${item.name}`}
      aria-pressed={checked}
      aria-disabled={blocked}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        checked
          ? 'border-pine bg-pine-soft/50 text-pine'
          : 'border-line bg-cream text-ink hover:bg-sand'
      } ${blocked ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      <span aria-hidden {...paint.attrs} className="h-2.5 w-2.5 rounded-full" style={paint.style} />
      {item.name}
    </button>
  );
}

/**
 * 同项目内重名阶段（A9）。
 * 判据：trim 后完全同名 → 记一次；只返回出现过 ≥2 次的名称（保序去重）。
 * 组件据此行内提示，父组件用同一函数**阻止提交** —— 一处口径，两处消费。
 */
export function duplicateStageNames(items: ReadonlyArray<{ name: string }>): string[] {
  const count = new Map<string, number>();
  for (const item of items) {
    const key = item.name.trim();
    if (key === '') continue;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [name, n] of count) {
    if (n > 1) out.push(name);
  }
  return out;
}

/** ≥ 该段数给「阶段较多」非阻塞提示（A10 ③） */
export const LONG_STAGE_LIST_HINT_FROM = 13;

/**
 * 主板块 → 默认预选套餐 key（迁移「类型」的唯一真实职能：主板块决定初始阶段池）。
 * 与 PRD §3.4 同口径：indoor→indoor_full、landscape→landscape_full、architecture→architecture_full、
 * software→software_full、marketing→marketing_full、film→film_full、wedding→wedding_full、
 * consulting→consulting_full；exhibition 暂无预设（P1 预留）→ 回落 indoor_full；
 * null/undefined 同样回落 indoor_full（与改造前「默认室内」一致）。
 * 确切的 preset key 以 templates/stage-library.json 的 presets[] 为准（禁止臆造）。
 */
export function defaultPresetKeyForDomain(domain: StageTemplateDomain | null | undefined): string {
  switch (domain) {
    case 'landscape':
      return 'landscape_full';
    case 'architecture':
      return 'architecture_full';
    case 'software':
      return 'software_full';
    case 'marketing':
      return 'marketing_full';
    case 'film':
      return 'film_full';
    case 'wedding':
      return 'wedding_full';
    case 'consulting':
      return 'consulting_full';
    case 'indoor':
    case 'exhibition':
    case null:
    case undefined:
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

/** 供父组件复用的类型出口（自定义阶段库条目的形状） */
export type { CustomStageDef };
