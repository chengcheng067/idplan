/**
 * 建档三层级联（v0.8 · A1–A4）：行业大类 → 主板块 → 关联板块。
 *
 * ── 三层各管什么（这决定了「第 1 层点了为什么池子变了」） ──
 *   ① **第 1 层 行业大类**（7 项：1 个伞形大类「建筑设计行业」＋ 6 个一级平铺板块）
 *      **只决定阶段池可见范围**，不写数据。（A1）
 *   ② **第 2 层 主板块**（下拉，**恒列出全部 9 个可用板块**、按大类 `optgroup` 分组）
 *      决定：快捷套餐只列该板块的（A5）＋ 写 `Project.domain`（⑧）。
 *      ⚠️ 第 2 层**不依赖第 1 层**：不点大类也能直接选到「室内」（A2）。
 *   ③ **第 3 层 关联板块**（多选，**仅伞形大类下出现**）
 *      用于跨大类扩展可见范围（如 室内 ＋ 关联影视 → 可见 4 个分组，A4）；
 *      同大类内的板块**不出现在这里**（与第 1 层冗余，A4 末句）。
 *
 * ── 判定用长度，不用第二套枚举 ──
 * `isUmbrellaGroup(key) === getGroupDomains(key).length > 1` —— 少一套枚举就少一处漂移。
 *
 * ── 为什么第 2 层「同步回填大类」 ──
 * 池子可见范围由第 1 层决定，而第 2 层允许跨越第 1 层直达；若用户在未点大类的情况
 * 直接选了「室内」，此刻必须把第 1 层同步成它所属的大类（space），否则会出现
 * 「主板块＝室内但池子只有一个分组」这种自相矛盾的状态（A6 要求恰 3 个）。
 */

import { Check, ChevronDown } from 'lucide-react';

import {
  getGroupDomains,
  getIndustryGroups,
  getUsableDomains,
  isUmbrellaGroup,
} from '../../core/template/stage-library';
import type { StageTemplateDomain } from '../../core/types/dto';

/** 板块中文标签（UI 文案唯一出处；阶段池分组标题也从这里取，避免两处各写一份） */
export const DOMAIN_LABELS: Record<StageTemplateDomain, string> = {
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
  travel: '旅游',
};

/** 未在 `DOMAIN_LABELS` 覆盖的领域（将来 JSON 新增）→ 原样显示，不崩 */
export function domainLabel(domain: StageTemplateDomain): string {
  return DOMAIN_LABELS[domain] ?? String(domain);
}

/** 三层级联的受控值 */
export interface DomainCascadeValue {
  /** 第 1 层：行业大类 key（`null` = 未选） */
  groupKey: string | null;
  /** 第 2 层：主板块（`null` = 未指定 —— 允许留空，读时回落，不影响建档，A7/验收 9） */
  domain: StageTemplateDomain | null;
  /** 第 3 层：关联板块（不含主板块、不含同大类其它板块） */
  relatedDomains: StageTemplateDomain[];
}

/** 默认值（PRD A2：默认 ＝ 建筑设计行业 / 室内） */
export const DEFAULT_DOMAIN_CASCADE: DomainCascadeValue = {
  groupKey: 'space',
  domain: 'indoor',
  relatedDomains: [],
};

/** 空值（未选板块；`Project.domain` 落 null，读时回落 —— 行为与改造前一致） */
export const EMPTY_DOMAIN_CASCADE: DomainCascadeValue = {
  groupKey: null,
  domain: null,
  relatedDomains: [],
};

/** 板块所属大类（反查；未知板块返回 null） */
export function groupKeyOfDomain(domain: StageTemplateDomain | null): string | null {
  if (!domain) return null;
  const hit = getIndustryGroups().find((g) => g.domains.includes(domain));
  return hit?.key ?? null;
}

/**
 * **可见阶段池的板块集**（A6）：`大类下全部板块 ∪ 主板块 ∪ 关联板块`（去重、保序）。
 *
 * 三级兜底：
 *   · 选了大类 → 该大类全部板块（伞下 3 个 / 一级平铺 1 个）；
 *   · 主板块不在大类里（跨越第 1 层直达）→ 补进来；
 *   · 关联板块 → 全部补进来（跨大类扩展）。
 * 全空 ⇒ `[]`（调用方据此「不过滤」或「只显示已选项」，见 StageSelectPanel）。
 */
export function visibleDomainsOf(value: DomainCascadeValue): StageTemplateDomain[] {
  const out: StageTemplateDomain[] = [];
  if (value.groupKey) {
    for (const d of getGroupDomains(value.groupKey)) out.push(d);
  }
  if (value.domain && !out.includes(value.domain)) out.push(value.domain);
  for (const d of value.relatedDomains) {
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/** 第 3 层候选：全部可用板块 − 本大类板块（同大类内不重复勾选，A4） */
export function relatedCandidatesOf(value: DomainCascadeValue): StageTemplateDomain[] {
  const inGroup = value.groupKey ? getGroupDomains(value.groupKey) : [];
  return getUsableDomains().filter((d) => !inGroup.includes(d));
}

export function DomainCascade({
  value,
  onChange,
  testId = 'domain-cascade',
}: {
  value: DomainCascadeValue;
  onChange(next: DomainCascadeValue): void;
  testId?: string;
}): JSX.Element {
  const groups = getIndustryGroups();
  const usableDomains = getUsableDomains();
  const umbrella = value.groupKey !== null && isUmbrellaGroup(value.groupKey);
  const groupDomains = value.groupKey ? getGroupDomains(value.groupKey) : [];

  /**
   * 第 1 层点击：
   *   · 伞形大类 → 展开第 2 层；主板块若不属于本大类则改为本大类首项（先维持不变）；
   *   · 一级平铺 → 该项即主板块，且**第 2 层消失**（A1）。
   * 两种情况都顺手清掉「已进入本大类的关联板块」（同大类内不该有重复项）。
   */
  const pickGroup = (groupKey: string): void => {
    const domains = getGroupDomains(groupKey);
    const isUmbrella = domains.length > 1;
    const nextDomain: StageTemplateDomain | null = isUmbrella
      ? value.domain && domains.includes(value.domain)
        ? value.domain
        : (domains[0] ?? null)
      : (domains[0] ?? null);
    onChange({
      groupKey,
      domain: nextDomain,
      relatedDomains: value.relatedDomains.filter((d) => !domains.includes(d)),
    });
  };

  /**
   * 第 2 层选择：**同步回填第 1 层**（选到「室内」时第 1 层变成它所属大类，
   * 否则池子范围与主板块会互相矛盾）；新主板块所属大类里的关联板块要清掉。
   */
  const pickDomain = (domain: StageTemplateDomain | null): void => {
    const groupKey = groupKeyOfDomain(domain) ?? value.groupKey;
    const inGroup = groupKey ? getGroupDomains(groupKey) : [];
    onChange({
      groupKey: domain === null ? value.groupKey : groupKey,
      domain,
      relatedDomains: value.relatedDomains.filter((d) => !inGroup.includes(d)),
    });
  };

  const toggleRelated = (domain: StageTemplateDomain): void => {
    const has = value.relatedDomains.includes(domain);
    onChange({
      ...value,
      relatedDomains: has
        ? value.relatedDomains.filter((d) => d !== domain)
        : [...value.relatedDomains, domain],
    });
  };

  return (
    <div className="space-y-3" data-testid={testId}>
      {/* ── 第 1 层：行业大类 / 一级板块 ── */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-mist">① 行业</p>
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => {
            const active = value.groupKey === g.key;
            const umbrellaGroup = isUmbrellaGroup(g.key);
            return (
              <button
                key={g.key}
                type="button"
                aria-label={`行业 ${g.name}`}
                aria-pressed={active}
                onClick={() => pickGroup(g.key)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  active
                    ? 'border-pine bg-pine-soft/50 text-pine'
                    : 'border-line bg-cream text-ink hover:bg-sand'
                }`}
              >
                {g.name}
                {umbrellaGroup && <ChevronDown size={12} aria-hidden className="text-mist" />}
              </button>
            );
          })}
        </div>
      </div>

      {/*
        ── 第 2 层：主板块 ──
        出现条件：**伞形大类下**，或**第 1 层尚未选择**（`groupKey === null`）。

        后者是「未选行业也能直接选主板块」（A2）在**空起始态**下的落点：
        反馈 #5 要求手动建档首开不预选行业/主板块 ⇒ `groupKey` 为 null；
        若这里仍按 `umbrella` 单条件渲染，第 2 层会整块消失，用户必须先点一次行业
        才能选到板块 —— A2 与「选定主板块后才出套餐」都会落空。
        一级平铺大类（如「旅游出行」）选中后仍不出第 2 层：该层已由第 1 层唯一定好。
      */}
      {(umbrella || value.groupKey === null) && (
        <div data-testid={`${testId}-layer2`}>
          <label className="mb-1.5 block text-xs font-medium text-mist" htmlFor={`${testId}-domain`}>
            ② 主板块（决定快捷套餐与看板归属）
          </label>
          <select
            id={`${testId}-domain`}
            aria-label="主板块"
            value={value.domain ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              pickDomain(raw === '' ? null : (raw as StageTemplateDomain));
            }}
            className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
          >
            {/* 允许留空：标签/板块为空也能建档（A7），落库 null 后由读时回落兜住 */}
            <option value="">（不指定板块）</option>
            {groups.map((g) => {
              const options = usableDomains.filter((d) => g.domains.includes(d));
              if (options.length === 0) return null;
              return (
                <optgroup key={g.key} label={g.name}>
                  {options.map((d) => (
                    <option key={d} value={d} className="bg-cream text-ink">
                      {domainLabel(d)}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
      )}

      {/* ── 第 3 层：关联板块（多选，仅伞形大类下出现；用于跨大类） ── */}
      {umbrella && (
        <div data-testid={`${testId}-layer3`}>
          <p className="mb-1.5 text-xs font-medium text-mist">
            ③ 关联板块（可选，用于同时看到别的行业阶段）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {relatedCandidatesOf(value).map((d) => {
              const active = value.relatedDomains.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-label={`关联板块 ${domainLabel(d)}`}
                  aria-pressed={active}
                  onClick={() => toggleRelated(d)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? 'border-pine bg-pine-soft/50 text-pine'
                      : 'border-line bg-cream text-ink hover:bg-sand'
                  }`}
                >
                  {active && <Check size={12} aria-hidden />}
                  {domainLabel(d)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 池子范围回显（用户能看到「现在池子里有哪些行业的阶段」） */}
      <p className="text-[11px] leading-4 text-mist" data-testid={`${testId}-visible-domains`}>
        阶段池范围：
        {visibleDomainsOf(value).length === 0
          ? '未限定（全部行业）'
          : visibleDomainsOf(value).map(domainLabel).join(' / ')}
        {groupDomains.length > 1 ? `（${groupDomains.length} 个分组）` : ''}
      </p>
    </div>
  );
}
