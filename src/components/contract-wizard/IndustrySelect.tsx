/**
 * 行业 / 主板块选择器（v0.8.5 · 设计师 A 规范 §A 全量落地）。
 *
 * ── 它替代什么 ──
 * DomainCascade 第 2 层的原生 `<select>`（雯丞 10-01 截图 #8 点名：
 * 「选行业这里弹出的选项没有统一的 ui 设计」）。病灶三条：
 *   ① 原生展开是浏览器系统菜单（白底黑字系统字体），与 Soft UI 两个物种；
 *   ② `<optgroup>` 在 Windows 上渲染成不可点灰标题，group/domain 层级读不出；
 *   ③ 「（不指定板块）」占位项与真实选项同样式。
 *
 * ── 结构 ──
 * 触发钮（应用内样式）+ Modal `placement='dropdown'` 浮层（z-[75] 无底色遮罩，
 * 盖得住建档弹窗但不压暗它）。点击捕获 / Esc / 焦点圈禁 / 滚动锁定 / portal
 * 全部由 Modal 白拿（§A.4）；面板 fixed 定位（anchor rect + flip）。
 *
 * ── 可达性（§A.5.4 combobox 模式）──
 * Enter/Space/↓ 打开、↑↓ 移动游标（跨组连续）、Enter 选中关面板焦点回触发钮、
 * Esc 不写值关、Home/End 首末、字母数字 typeahead（原生 select 本来就有的
 * 能力，自定义版补回）、Tab 关面板继续表单。
 *
 * 契约不变：`value` = `StageTemplateDomain | null`，`onChange` 语义与旧
 * `<select>` 逐字一致（空串=null=不指定）——DomainCascade 的调用方零改动。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  CircleSlash,
  Clapperboard,
  Code2,
  Folder,
  Gem,
  Briefcase,
  Landmark,
  Megaphone,
  Plane,
  Search,
  Sofa,
  Trees,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Modal } from '../common/Modal';
import { cn } from '../../lib/cn';
import { getIndustryGroups, getUsableDomains, domainLabel } from '../../core/template/stage-library';
import type { StageTemplateDomain } from '../../core/types/dto';

/**
 * 图标映射（§A.6）：按 domain key 索引；未知 domain（库未来新增）回落 Folder，
 * 不崩。**不给「不指定」配行业图标**——用 CircleSlash（它不是一个行业）。
 */
const DOMAIN_ICON: Record<string, LucideIcon> = {
  indoor: Sofa,
  landscape: Trees,
  architecture: Landmark,
  software: Code2,
  marketing: Megaphone,
  film: Clapperboard,
  wedding: Gem,
  consulting: Briefcase,
  travel: Plane,
};

/** 伞形大类的分组头图标（「建筑设计行业」旁那小楼） */
const UMBRELLA_ICON: Record<string, LucideIcon> = {
  space: Building2,
};

interface DomainGroup {
  key: string;
  name: string;
  domains: StageTemplateDomain[];
}

/** 面板定位（anchor=触发钮 rect；flip：下方空间不够则向上） */
interface PanelPos {
  top: number;
  left: number;
  minWidth: number;
}

function resolvePanelPos(anchor: HTMLElement, panelHeight = 304): PanelPos {
  const r = anchor.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  const flipUp = below < panelHeight + 8 && r.top > below;
  return {
    top: flipUp ? Math.max(8, r.top - panelHeight - 4) : r.bottom + 4,
    left: r.left,
    minWidth: r.width,
  };
}

export function IndustrySelect({
  value,
  onChange,
  id,
  className,
}: {
  value: StageTemplateDomain | null;
  onChange: (d: StageTemplateDomain | null) => void;
  /** 供 label[for] 关联（DomainCascade 第 2 层原 select 的 id 语义保留） */
  id?: string;
  className?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  /** typeahead 缓冲（§A.5.4：字母数字键连续输入匹配首项） */
  const typeahead = useRef('');
  const typeaheadTimer = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<PanelPos | null>(null);

  /** 分组数据（仅含可用板块的组；exhibition 无数据天然排除） */
  const groups = useMemo<DomainGroup[]>(() => {
    const usable = new Set(getUsableDomains());
    return getIndustryGroups()
      .map((g) => ({
        key: g.key,
        name: g.name,
        domains: g.domains.filter((d) => usable.has(d)),
      }))
      .filter((g) => g.domains.length > 0);
  }, []);

  /** 扁平选项表（含分组头位置标记）——游标移动/typeahead/过滤都基于它 */
  type Row =
    | { kind: 'group'; key: string; name: string }
    | { kind: 'domain'; domain: StageTemplateDomain; groupKey: string }
    | { kind: 'none' };
  const rows = useMemo<Row[]>(
    () => [
      { kind: 'none' },
      ...groups.flatMap<Row>((g) => [
        { kind: 'group', key: g.key, name: g.name },
        ...g.domains.map<Row>((d) => ({ kind: 'domain', domain: d, groupKey: g.key })),
      ]),
    ],
    [groups],
  );
  /** 可游标行（分组头不可游走） */
  const selectable = useMemo<Row[]>(() => rows.filter((r) => r.kind !== 'group'), [rows]);
  /** 搜索过滤（>9 项才显示搜索框——§A.2 D3：阈值写 >9 不写死） */
  const showSearch = selectable.length > 9;
  /**
   * 过滤后的行表（**保留分组头结构**——v0.8.5 首次实现曾基于「已剔除组头的
   * selectable」过滤，组头永远渲染不出来、9 个板块全平铺，正是她截图 #8
   * 病灶②的复刻。现在：无 query=原样 rows；有 query=匹配项 + 其所属组的组头，
   * 空组不出现）。
   */
  const filtered = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const hitDomains = selectable.filter(
      (r) =>
        (r.kind === 'domain' && (domainLabel(r.domain).toLowerCase().includes(q) || r.domain.includes(q))) ||
        (r.kind === 'none' && '不指定'.includes(q)),
    );
    const hitGroupKeys = new Set(hitDomains.flatMap((r) => (r.kind === 'domain' ? [r.groupKey] : [])));
    const out: Row[] = [];
    if (hitDomains.some((r) => r.kind === 'none')) out.push({ kind: 'none' });
    for (const g of groups) {
      if (!hitGroupKeys.has(g.key)) continue;
      out.push({ kind: 'group', key: g.key, name: g.name });
      out.push(...hitDomains.filter((r) => r.kind === 'domain' && r.groupKey === g.key));
    }
    return out;
  }, [query, rows, selectable, groups]);

  // 打开时：定位 + 游标落到当前选中项（若有）
  useEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (el) setPos(resolvePanelPos(el));
    const idx = filtered.findIndex(
      (r) => r.kind === 'domain' && r.domain === value,
    );
    setCursor(idx >= 0 ? idx : 0);
    setQuery('');
    // 焦点移入面板容器（Modal 的焦点圈禁以面板为边界）
    const t = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (row: Row | undefined): void => {
    if (!row || row.kind === 'group') return;
    onChange(row.kind === 'none' ? null : row.domain);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onPanelKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'Tab') {
      // 关面板，让焦点继续走表单（不拦截）
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => {
        const n = filtered.length;
        if (n === 0) return 0;
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        return (c + dir + n) % n;
      });
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setCursor(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setCursor(Math.max(0, filtered.length - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(filtered[cursor]);
      return;
    }
    // typeahead：字母数字键（面板无搜索框或焦点不在搜索框时）
    const tag = (e.target as HTMLElement).tagName;
    if (tag !== 'INPUT' && e.key.length === 1 && /\S/.test(e.key)) {
      typeahead.current += e.key.toLowerCase();
      if (typeaheadTimer.current) window.clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = window.setTimeout(() => {
        typeahead.current = '';
      }, 800);
      const idx = filtered.findIndex(
        (r) => r.kind === 'domain' && domainLabel(r.domain).toLowerCase().startsWith(typeahead.current),
      );
      if (idx >= 0) setCursor(idx);
    }
  };

  const SelectedIcon = value ? DOMAIN_ICON[value] ?? Folder : CircleHelp;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="主板块"
        data-industry-select-trigger=""
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-[10px] border border-line bg-paper px-2.5 text-[13px] text-ink outline-none',
          'transition-colors hover:bg-cream focus-visible:border-pine focus-visible:ring-2 focus-visible:ring-pine/40',
          open && 'border-pine',
          className,
        )}
      >
        <SelectedIcon size={16} className={cn('shrink-0', value ? 'text-mist' : 'text-mist')} aria-hidden />
        <span className={cn('truncate', value ? 'text-ink' : 'text-mist')}>
          {value ? domainLabel(value) : '请选择主板块'}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={cn(
            'ml-auto shrink-0 text-mist transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} placement="dropdown" ariaLabel="选择主板块">
        {/* 面板：fixed 锚定触发钮；z 由 Modal overlay（z-[75]）承载 */}
        <div
          ref={panelRef}
          role="listbox"
          tabIndex={-1}
          aria-label="主板块选项"
          data-industry-select-panel=""
          onKeyDown={onPanelKeyDown}
          style={
            pos
              ? { top: pos.top, left: pos.left, minWidth: pos.minWidth }
              : { top: -9999, left: -9999 }
          }
          className="dropdown-pop-in fixed z-[1] w-[240px] max-h-[304px] overflow-y-auto rounded-md border border-line bg-paper p-1 shadow-overlay outline-none"
        >
          {showSearch && (
            <div className="sticky top-0 z-10 bg-paper pb-1">
              <div className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-sunken px-2.5">
                <Search size={14} className="shrink-0 text-mist" aria-hidden />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setCursor(0);
                  }}
                  placeholder="搜索板块…"
                  aria-label="搜索板块"
                  className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-mist"
                />
              </div>
            </div>
          )}

          {filtered.length === 0 && (
            <div className="px-2 py-3 text-center text-[13px] text-mist">没有匹配的板块</div>
          )}

          {filtered.map((row, i) => {
            if (row.kind === 'group') {
              const GIcon = UMBRELLA_ICON[row.key] ?? Building2;
              return (
                <div
                  key={`g-${row.key}`}
                  data-industry-select-group={row.key}
                  className="sticky top-0 z-10 mt-1 flex h-7 items-center gap-1.5 bg-paper px-2 text-[11px] font-medium text-mist"
                >
                  <GIcon size={12} aria-hidden />
                  {row.name}
                </div>
              );
            }
            if (row.kind === 'none') {
              const active = i === cursor;
              const selected = value === null;
              return (
                <div
                  key="none"
                  role="option"
                  aria-selected={selected}
                  data-industry-select-option=""
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => commit(row)}
                  className={cn(
                    'flex h-9 cursor-pointer items-center gap-2 rounded-sm px-2 text-[13px] transition-colors',
                    selected ? 'bg-pine-soft text-pine' : 'text-mist',
                    active && !selected && 'bg-sand ring-1 ring-inset ring-line',
                  )}
                >
                  <CircleSlash size={14} className="shrink-0" aria-hidden />
                  <span className="flex-1 truncate">不指定板块</span>
                  {selected && <Check size={14} className="shrink-0 text-pine" aria-hidden />}
                </div>
              );
            }
            const d = row.domain;
            const Icon = DOMAIN_ICON[d] ?? Folder;
            const active = i === cursor;
            const selected = value === d;
            return (
              <div
                key={d}
                role="option"
                aria-selected={selected}
                data-industry-select-option={d}
                onMouseEnter={() => setCursor(i)}
                onClick={() => commit(row)}
                className={cn(
                  'flex h-9 cursor-pointer items-center gap-2 rounded-sm px-2 text-[13px] transition-colors',
                  selected ? 'bg-pine-soft text-pine' : 'text-ink',
                  active && !selected && 'bg-sand ring-1 ring-inset ring-line',
                )}
              >
                <Icon size={14} className="shrink-0 text-mist" aria-hidden />
                <span className="flex-1 truncate">{domainLabel(d)}</span>
                {selected && <Check size={14} className="shrink-0 text-pine" aria-hidden />}
              </div>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
