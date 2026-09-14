/**
 * TBD-10 · 存量「自定义阶段」项目的**板块待确认**提示条（v0.8 T04-A · 设计 §3.2.1）。
 *
 * ══════════════════════════ 这个组件要解决的问题 ══════════════════════════
 *
 * `stagePresetKey === 'custom'` 的**存量**项目，`getPreset('custom')` 返回 `null`
 * ⇒ 读时回落最终落到 `'indoor'` ⇒ 它们在首页看板里被塞进「室内」列。用户看到的是
 * **错的板块**，但我们**不能猜**（无依据、必出错）。
 *
 * 裁决（领队 TBD-10）：**只提示、不自动写**。于是本组件做三件、且只做三件事：
 *   ① 把"这些项目的板块可能不对"变成**看得见**（细边提示条，中性文案「待确认」）；
 *   ② 给一个**轻量**入口（不挡操作、不弹模态、不阻断主场流程）；
 *   ③ 用户主动确认后，走**唯一写点** `confirmProjectDomain`（只写 `domain` 一个字段）。
 *
 * ── 与「修 deriveColumns」的先后顺序（**顺序反了会掩盖真 bug**）──
 *   设计 §8 T04「已知坑」原文：*「先修列、再加提示，否则会把"落错列"当成"待确认"掩盖掉」*。
 *   含义：`deriveColumns` 改读 `project.domain` 之后，`domain` 有值的项目**才**会落在
 *   正确列上；此时"还落错列"的项目就**恰好**是 `domain == null && presetKey === 'custom'`
 *   的那批 —— 提示条与"落错列"的集合**逐字重合**。顺序反过来的话，提示条会替
 *   `deriveColumns` 的老 bug（读 preset.domain）背锅，看起来"这些项目在待确认"，
 *   实际其中一部分永远不会被修正。
 *   ⇒ 本组件所在的两次接线（HomePage / ProjectDetailPage）**都在** deriveColumns 的修复之后。
 *
 * ── 为什么未确认时**保持**落在「室内」列（而不是挪到"未分类"列）──
 *   零回归是硬要求（设计 §3.2.1「未确认时行为与今天逐字一致 ⇒ 零回归」）。
 *   把待确认项目挪走，等于替用户做了一个他没做的决定；而"看起来和昨天一样"是
 *   **可预期**的。提示条只负责"告诉用户这里可能不对"，**不负责换列**。
 *
 * ── 权限（双层门的下半层）──
 *   `domain` 是项目级写入 ⇒ 与归档/改期同档，**仅 admin**。成员看得见提示条的文字
 *   （被告知"这块看板的板块待确认"是事实，不构成泄漏），但**看不到按钮**。
 *   ⚠️ 这里只是**体验层**；真正的边界在仓储/服务端（本项目为本地单机部署模型，
 *   `ProjectService.confirmProjectDomain` 是唯一的领域入口）。
 *   ⚠️ 设计 §3.2.1 原文写「admin 与项目 owner 可见」—— 本仓 `Project` 实体**没有
 *   owner 字段**（已核 `entities.ts` 的 Project 定义：无 ownerId/owner 之类），
 *   故退化为「仅 admin」。这是**有依据的收窄**（宁可少给一个按钮，不可猜一个字段）。
 */

import { useMemo, useState } from 'react';

import { Info } from 'lucide-react';

import { Button } from '../ui/Button';
import { DomainCascade, domainLabel } from '../contract-wizard/DomainCascade';
import type { DomainCascadeValue } from '../contract-wizard/DomainCascade';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { useRepos } from '../../hooks/useRepos';
import { createProjectActions } from '../../store/useProjectsStore';
import { needsDomainConfirm } from '../../core/project/visibility';
import type { Project } from '../../core/types/entities';
import { cn } from '../../lib/cn';

/** 提示条文案（唯一出处） */
export const DOMAIN_CONFIRM_BAR_TEXT = '此项目板块待确认';

/**
 * 「确认」浮层里的初始级联值。
 *
 * ⚠️ **刻意不是 `DEFAULT_DOMAIN_CASCADE`**（那是 `{ groupKey:'space', domain:'indoor' }`）：
 *   预选「室内」正好等于**当前这个错误回落值** —— 用户点开看到「② 主板块 = 室内」，
 *   很容易直接点「确认」，于是"确认"变成"把错误值再写一遍"，还把 `domain` 从 `null`
 *   变成 `'indoor'`，**从此再也不会被 `needsDomainConfirm` 提示**（它要求 `domain == null`）。
 *   那是把提示条变成了一个"永久静默缺陷制造器"。
 * ⇒ 这里 `domain: null`（显示「（不指定板块）」），并把第 1 层停在伞形大类 `space` 上，
 *   这样第 2 层**可见但未选** —— 用户必须**主动**做出选择。确认按钮同时被 `domain === null` 禁用。
 */
const INITIAL_CASCADE: DomainCascadeValue = {
  groupKey: 'space',
  domain: null,
  relatedDomains: [],
};

export function DomainConfirmPrompt({
  projects,
  className,
}: {
  /** 候选集合（调用方给人类侧已收窄的集合即可；本组件内部再按 `needsDomainConfirm` 过滤） */
  projects: readonly Project[];
  className?: string;
}): JSX.Element | null {
  const repos = useRepos();
  const { isAdmin } = useRoleGuard();
  const actions = useMemo(() => createProjectActions(repos), [repos]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [value, setValue] = useState<DomainCascadeValue>(INITIAL_CASCADE);
  const [busy, setBusy] = useState(false);

  // 读时派生，不落库、不进键序链（设计 §3.2.1 的纪律：它是 visibility.ts 里的纯函数）
  const pending = useMemo(() => projects.filter((p) => needsDomainConfirm(p)), [projects]);

  if (pending.length === 0) return null;

  const open = (id: string): void => {
    setValue(INITIAL_CASCADE);
    setExpandedId((cur) => (cur === id ? null : id));
  };

  const submit = async (id: string): Promise<void> => {
    if (!value.domain) return;
    setBusy(true);
    try {
      const ok = await actions.confirmProjectDomain(id, value.domain);
      // 成功与否都由 store 的 toast 反馈；成功后收起浮层（提示条本身会因 domain 已落值而消失）
      if (ok) setExpandedId(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-domain-confirm-bar=""
      aria-label="板块待确认"
      className={cn('flex flex-col gap-2 rounded-2xl border border-dashed border-line bg-cream px-4 py-3', className)}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px]">
        <Info size={14} className="shrink-0 text-amber" aria-hidden />
        <span className="text-mist">
          有 {pending.length} 个项目的板块待确认（这些项目目前仍显示在「室内」列，确认后会立即归位）：
        </span>
        {pending.map((p) => {
          const isOpen = expandedId === p.id;
          return (
            <span key={p.id} className="inline-flex items-center gap-1.5">
              <span className="max-w-[180px] truncate font-medium text-ink" title={p.name}>
                {p.name}
              </span>
              {isAdmin && (
                <button
                  type="button"
                  data-domain-confirm-open={p.id}
                  aria-expanded={isOpen}
                  onClick={() => open(p.id)}
                  className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-[12px] text-pine transition-colors hover:bg-sand"
                >
                  {isOpen ? '收起' : '确认'}
                </button>
              )}
            </span>
          );
        })}
        {!isAdmin && <span className="text-mist">（仅管理员可修改）</span>}
      </div>

      {expandedId !== null && isAdmin && (
        <div
          data-domain-confirm-panel={expandedId}
          className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-3.5"
        >
          {/* 复用建档第 2 层的三层组件（设计 §3.2.1「确认对话框（DomainCascade 三层，复用 §2.3 组件）」）——
              不另造一个"只选板块"的下拉：两处各写一份必然漂移（选项集合、分组顺序、空值语义） */}
          <DomainCascade value={value} onChange={setValue} testId="domain-confirm-cascade" />
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-[12px] text-mist">
              {value.domain ? `将归入「${domainLabel(value.domain)}」` : '请先选择主板块'}
            </span>
            <Button variant="secondary" onClick={() => setExpandedId(null)}>
              取消
            </Button>
            <Button
              data-domain-confirm-submit={expandedId}
              disabled={value.domain === null || busy}
              onClick={() => void submit(expandedId)}
            >
              确认归入此板块
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
