import { useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';

import {
  type ConfirmedContractPayload,
  type StageSelectionItem,
  type StageTemplateDomain,
} from '../../core/types/dto';
import type { ScheduleBasis } from '../../core/types/enums';
import { DEFAULT_SCHEDULE_BASIS } from '../../core/types/entities';
import { getPresetItems } from '../../core/template/stage-library';
import { DEFAULT_PROJECT_DOMAIN } from '../../core/template/stage-fallback';
import { MAX_STAGE_COUNT, MIN_STAGE_COUNT, computeEndAtByDurations } from '../../core/template/split';
import {
  createCustomStageDef,
  customStageToSelectionItem,
  isCustomStageKey,
  rememberCustomStage,
} from '../../core/services/custom-stage.service';
import { createProjectActions, useProjectsStore } from '../../store/useProjectsStore';
import { useRepos } from '../../hooks/useRepos';
import { toIsoDate } from '../../lib/date';
import { DEFAULT_REST_POLICY } from '../../core/types/entities';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  defaultPresetKeyForDomain,
  duplicateStageNames,
  presetKeyOfItems,
  StageSelectPanel,
} from './StageSelectPanel';
import {
  EMPTY_DOMAIN_CASCADE,
  DomainCascade,
  visibleDomainsOf,
  type DomainCascadeValue,
} from './DomainCascade';
import { domainLabel } from '../../core/template/stage-library';
import {
  normalizeCustomLibraries,
  buildCustomPresetItems,
  CUSTOM_LIBRARIES_SETTING_KEY,
} from '../../core/template/custom-library.service';
import type { CustomStageDraft } from './CustomStageDialog';
import { Modal } from '../common/Modal';
import { ImeInput } from '../common/ImeInput';

/**
 * 纯手动兜底建档（与向导并列可达，任何情况下都能建好档）。
 * 受控组件：由页面/顶栏控制显隐。
 * 阶段选择：折叠区复用 StageSelectPanel；不展开直接提交 → 默认 indoor_full 九段（与改造前一致）。
 *
 * v0.8：本表单与向导**共用同一套建档构件**（`DomainCascade` ＋ `StageSelectPanel`），
 * 因此「三层筛选 / 阶段池过滤 / 自定义阶段 / 上限 20 / 重名校验」两条路径行为一致；
 * 主板块（`DomainCascadeValue.domain`）随建档写入 `Project.domain`。
 */
export function ManualFallbackForm({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}): JSX.Element | null {
  const repos = useRepos();
  const navigate = useNavigate();
  const restPolicy = useSettingsStore((s) => s.restPolicy);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [clientName, setClientName] = useState('');
  const [startAt, setStartAt] = useState(new Date().toISOString().slice(0, 10));
  const [endAt, setEndAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * v0.8 三层级联（第 1 层行业大类 / 第 2 层主板块 / 第 3 层关联板块）。
   *
   * ★ 反馈 #5：手动建档首次打开**不预选任何行业与主板块**。
   *   旧实现默认 `DEFAULT_DOMAIN_CASCADE`（建筑设计行业 / 室内），于是弹出来就是
   *   「室内·全流程九段」—— 与用户实际要服务的客户不匹配，等于替用户做了决定。
   *   现在从 `EMPTY_DOMAIN_CASCADE` 起步：先选行业/主板块，再出对应套餐。
   */
  const [cascade, setCascade] = useState<DomainCascadeValue>(EMPTY_DOMAIN_CASCADE);
  /** v0.8 建档时新增的自定义阶段（内存态；跨项目复用池另存 settings KV） */
  const [customStages, setCustomStages] = useState<StageSelectionItem[]>([]);

  /**
   * 阶段选择：**初始为空**（反馈 #5）。
   *
   * 只由用户在 `DomainCascade` 里显式选定主板块后的 effect 预选该板块的默认套餐；
   * 不再在挂载时兜底成室内九段 —— 那会让「没选板块」和「选了室内」在数据上无法区分。
   */
  const [stageItems, setStageItems] = useState<StageSelectionItem[]>([]);

  /**
   * 主板块 → 套餐联动（反馈 #5 的另一半）。
   *
   * 空起始态只有「不预选」不够：提交按钮在 `stageItems < MIN_STAGE_COUNT` 时禁用，
   * 没有这条联动，用户选完板块也没有任何阶段可选可提交 —— 表单一进来就走不通。
   * 所以显式选定主板块时，自动带出**该板块的默认套餐**（`defaultPresetKeyForDomain`，
   * 与看板列同源），未选（null）时保持空池并把提示语交给 UI。
   *
   * 自定义阶段（`templateKey === null`）不因切板块被丢掉：它们是用户刚加的，
   * 只换预设部分、保留自选项并追加到末尾，避免「换了个板块我加的段没了」。
   */
  /**
   * v0.8.6（她反馈 #9）：自定义行业包套餐组。
   * 从 settings customLibraries 读出 → 过滤**当前主板块**的包 → 每包每个 preset
   * 展开成 items（共享核心 buildCustomPresetItems）→ 传给 StageSelectPanel。
   * 读侧归一（normalizeCustomLibraries 绝不抛错）——坏包静静跳过。
   */
  const [customPresetGroups, setCustomPresetGroups] = useState<
    Array<{ key: string; name: string; libraryName: string; items: ReturnType<typeof buildCustomPresetItems> }>
  >([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const libs = normalizeCustomLibraries(
        await repos.settings.get<unknown>(CUSTOM_LIBRARIES_SETTING_KEY),
      );
      const domain = cascade.domain;
      const groups: typeof customPresetGroups = [];
      for (const lib of libs) {
        if (domain && lib.domain !== domain) continue;
        for (const p of lib.presets) {
          groups.push({
            key: p.key,
            name: p.name,
            libraryName: lib.name,
            items: buildCustomPresetItems(lib, p.key),
          });
        }
      }
      if (alive) setCustomPresetGroups(groups);
    })();
    return () => {
      alive = false;
    };
  }, [repos, cascade.domain]);

  const presetDomainRef = useRef<StageTemplateDomain | null>(null);
  useEffect(() => {
    if (presetDomainRef.current === cascade.domain) return;
    presetDomainRef.current = cascade.domain;
    if (!cascade.domain) {
      setStageItems([]);
      return;
    }
    // v0.8.5：无默认套餐的板块（展陈）→ null → 空预选，用户从阶段池自选（C4 #9）
    const presetKey = defaultPresetKeyForDomain(cascade.domain);
    setStageItems((prev) => [
      ...(presetKey ? getPresetItems(presetKey) : []),
      ...prev.filter((it) => isCustomStageKey(it.key)),
    ]);
  }, [cascade.domain]);
  const [scheduleBasis, setScheduleBasis] = useState<ScheduleBasis>(DEFAULT_SCHEDULE_BASIS);
  const [stagePanelOpen, setStagePanelOpen] = useState(false);

  /**
   * 新增自定义阶段（A8 / TBD-1：**仅建档时**可加）：
   *   ① 转成「库条目」→ 经 `custom-stage.service` 记入复用库（TS-07 开关关时自动变空操作）；
   *   ② 转成池中可勾选项 → 追加到已选末尾。
   * ⚠️ 组件层**不直接**读写 `settings` 的 `customStages` 键（读写唯一出口在 service 内）。
   */
  const handleAddCustomStage = (draft: CustomStageDraft): void => {
    if (stageItems.length >= MAX_STAGE_COUNT) {
      useProjectsStore
        .getState()
        .pushToast('error', `单次项目最多 ${MAX_STAGE_COUNT} 个阶段`);
      return;
    }
    const def = createCustomStageDef({
      name: draft.name,
      ratioPercent: draft.ratioPercent,
      colorMain: draft.customColor,
    });
    void rememberCustomStage({ settings: repos.settings }, def);
    const item = customStageToSelectionItem(def, {
      domain: cascade.domain ?? DEFAULT_PROJECT_DOMAIN,
      colorIndex: draft.colorIndex,
    });
    setCustomStages((prev) => [...prev, item]);
    setStageItems((prev) => [...prev, item]);
  };

  /** 每阶段时长覆盖（key=阶段 key，value=天数字符串）。空 string=未填，走占比兜底 */
  const [durations, setDurations] = useState<Record<string, string>>({});
  /** 是否启用「按阶段时长排期」（填了任意阶段天数即视为启用并自动算竣工） */
  const [durationEnabled, setDurationEnabled] = useState(false);

  /** 阶段时长变化：写入并标记启用（填了任意非空天数即开启顺延） */
  const handleDurationChange = (key: string, value: string): void => {
    setDurations((prev) => ({ ...prev, [key]: value }));
    if (value.trim() !== '') setDurationEnabled(true);
  };

  // 阶段时长变化 → 若启用且已选阶段 & 有开始日期，自动顺延算出竣工日期回填（图5）
  useEffect(() => {
    if (!durationEnabled || stageItems.length === 0 || !startAt) return;
    // 仅当「至少一个阶段填了天数」才自动算竣工，避免切套餐瞬间误覆盖
    const hasAnyDuration = Object.values(durations).some((v) => v.trim() !== '');
    if (!hasAnyDuration) return;
    try {
      const filled = stageItems.map((it) => ({
        ...it,
        durationDays: durations[it.key]?.trim() !== '' && Number.isFinite(Number(durations[it.key]))
          ? Number(durations[it.key])
          : undefined,
      }));
      const { endAt: computedEnd } = computeEndAtByDurations(
        startAt,
        filled,
        scheduleBasis,
        restPolicy,
      );
      setEndAt(computedEnd);
    } catch {
      // 天数非法（如 0/负）时保持原竣工值，不覆盖；提交时由校验兜底
    }
  }, [durationEnabled, durations, stageItems, startAt, scheduleBasis, restPolicy]);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    setError(null);
    if (!name.trim() || !endAt) {
      setError('项目名称与竣工日为必填。');
      return;
    }
    const startIso = toIsoDate(startAt);
    const endIso = toIsoDate(endAt);
    if (!startIso || !endIso) {
      setError('开始日或竣工日格式不正确，请选择有效日期。');
      return;
    }
    if (endIso < startIso) {
      setError('竣工日不能早于开始日。');
      return;
    }
    if (stageItems.length < MIN_STAGE_COUNT) {
      setError(`至少选择 ${MIN_STAGE_COUNT} 个阶段。`);
      return;
    }
    // A9：同项目内阶段名不可重复 → 行内提示 + **阻止提交**（与 StageSelectPanel 同一判据）
    const duplicateNames = duplicateStageNames(stageItems);
    if (duplicateNames.length > 0) {
      setError(`阶段名重复：${duplicateNames.join('、')}，请改名后再提交。`);
      return;
    }
    setSubmitting(true);
    const actions = createProjectActions(repos);
    void (0 as unknown as ConfirmedContractPayload); // 类型引用占位：payload 由 service 组装
    try {
      // 阶段时长：把用户填的天数合入 stageItems（供上层感知；未填的项不携带 durationDays）
      const itemsWithDuration: StageSelectionItem[] = stageItems.map((it) => {
        const raw = durations[it.key];
        const hasDuration = raw?.trim() !== '' && Number.isFinite(Number(raw));
        return hasDuration ? { ...it, durationDays: Number(raw) } : it;
      });
      const project = await actions.createManual({
        name: name.trim(),
        address: address.trim(),
        clientName: clientName.trim(),
        contractAmount: null, // 合同额字段已从建档 UI 移除（数据模型保留，兼容老数据）；此处恒传 null
        signedAt: null,
        plannedStartAt: startAt,
        plannedEndAt: endAt,
        coverColor: null,
        stageItems: itemsWithDuration,
        stagePresetKey: presetKeyOfItems(stageItems),
        scheduleBasis,
        // v0.8：主板块随建档落入 `Project.domain`（未指定 → null → 读时回落，行为与改造前一致）
        domain: cascade.domain,
      });
      onClose();
      void navigate(`/project/${project.id}`);
    } catch (err) {
      // 展示真实原因（含 userMessage），不再用笼统的「请检查日期是否有效」误导用户
      const userMessage = (err as { userMessage?: string })?.userMessage;
      setError(userMessage ?? '建档失败，请重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} ariaLabel="手动建档">
      <div className="glass-strong iridescent-border dialog-pop flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl shadow-soft">
        {/* 描边挂在外层固定框；滚动交给内层，避免虹彩描边伪元素随内容断层露线 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-display-md">手动建档</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭手动建档"
            className="rounded-md p-1 text-mist hover:bg-sand"
          >
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">项目名称 *</span>
            <ImeInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如「某某项目・第一阶段」"
              className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">地址</span>
            <ImeInput
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">客户名称</span>
            <ImeInput
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">开始 *</span>
              <input
                type="date"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                竣工 *
                {durationEnabled && <span className="ml-1 font-normal text-pine">（已按阶段时长算出）</span>}
              </span>
              <input
                type="date"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
              />
            </label>
          </div>
        </div>

        {/* v0.8 三层级联：行业大类 → 主板块 → 关联板块（决定阶段池可见范围与 Project.domain） */}
        <div className="mt-4 rounded-md border border-line bg-cream/40 p-3">
          <DomainCascade value={cascade} onChange={setCascade} />
        </div>

        {/* 阶段选择折叠区（复用 StageSelectPanel —— 与向导同一条路径） */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setStagePanelOpen((v) => !v)}
            aria-expanded={stagePanelOpen}
            className="flex w-full items-center justify-between rounded-md border border-line bg-cream px-3 py-2 text-sm text-ink hover:bg-sand"
          >
            <span>
              本次服务阶段 · 已选 {stageItems.length} 项
              {/*
                ★ 反馈 #5：不再写「默认：室内·全流程 9 段」——那是旧默认值留下的误导。
                未选主板块时不预置任何阶段，这里改为提示下一步该做什么。
              */}
              <span className="ml-2 text-xs text-mist">
                {cascade.domain
                  ? `套餐按「${domainLabel(cascade.domain)}」筛选，点开选择`
                  : '请先在上方选择行业与主板块'}
              </span>
            </span>
            {stagePanelOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {stagePanelOpen && (
            <div className="mt-2 rounded-md border border-line bg-paper p-3">
              {/* 未选主板块时不展示空池：先让用户明白缺哪一步（反馈 #5） */}
              {!cascade.domain && (
                <p
                  data-manual-stage-hint=""
                  className="mb-2 rounded-md bg-sunken px-3 py-2 text-xs text-mist"
                >
                  请先在上方「行业大类 → 主板块」里选定主板块，阶段池与套餐会按该板块列出。
                </p>
              )}
              <StageSelectPanel
                selected={stageItems}
                onChange={setStageItems}
                scheduleBasis={scheduleBasis}
                onScheduleBasisChange={setScheduleBasis}
                durations={durations}
                onDurationChange={handleDurationChange}
                domain={cascade.domain}
                visibleDomains={visibleDomainsOf(cascade)}
                customPresetGroups={customPresetGroups}
                customStages={customStages}
                onCustomStageSubmit={handleAddCustomStage}
              />
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm leading-6 text-clay">{error}</p>}

        <button
          type="button"
          disabled={submitting || stageItems.length < MIN_STAGE_COUNT}
          onClick={() => void submit()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-pine px-4 py-2 text-sm text-white hover:bg-pine-deep disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check size={15} /> 建档（按所选 {stageItems.length} 个阶段切分）
        </button>
        </div>
      </div>
    </Modal>
  );
}
