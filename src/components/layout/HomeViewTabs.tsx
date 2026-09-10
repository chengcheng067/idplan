import { LayoutGrid, CalendarRange } from 'lucide-react';

import { useUiStore } from '../../store/useUiStore';
import { cn } from '../../lib/cn';

/**
 * 首页「看板 / 月历」视图切换 tab（v0.7 · 子系统 ① · T02 位移）。
 *
 * ── 为什么从 TopBar 移到内容区顶部（PRD §3.1 + §3.2）──
 *   PRD §3.1 把信息架构定为三级锚点：
 *     全局层（空间）→ 侧栏高亮；项目层 → 面包屑 + 页面标题；
 *     **视图层（看板/月历/列表/时间轴）→ 内容区顶部 tab**。
 *   §3.2 迁移清单进一步写明：「看板/月历视图切换 → 首页内容区顶部 tab
 *   （**保留现有 `homeViewMode` 逻辑，仅位移**）」。
 *   语义上也更自洽：它是**同一份数据（项目集合）的两种呈现**，属于「视图层」
 *   而非「全局层」——放顶栏会让它看起来像全局导航项，与 4 个真导航项混淆。
 *
 * ── 行为逐字保留（仅位移，不改逻辑）──
 *   store 字段仍是 `useUiStore.homeViewMode` / `setHomeViewMode`（未迁移 store，
 *   因为该 store 不持久化、`Set` 类型字段不能整体 JSON 化——见 `useLayoutStore`
 *   文件头「为什么不塞进 useUiStore」的裁决说明）。
 *   交互语义不变：不跳路由（故 `button` + `role="tab"` 而非 `Link`），
 *   `aria-selected` 标记当前档，选中态沿用 `bg-pine-soft text-pine`。
 *
 * ── 形状说明 ──
 *   横排胶囊 tab，与迁移前 TopBar 内的形态**完全一致**（圆角12 容器 padding4、
 *   选中项圆角9 半透明蓝底蓝字）——只换了挂载位置，不做视觉再设计
 *   （§3 开头：只动骨架，不动视觉 token）。
 */
export function HomeViewTabs(): JSX.Element {
  const homeViewMode = useUiStore((s) => s.homeViewMode);
  const setHomeViewMode = useUiStore((s) => s.setHomeViewMode);

  const options = [
    { key: 'kanban' as const, label: '看板', Icon: LayoutGrid },
    { key: 'calendar' as const, label: '月历', Icon: CalendarRange },
  ];

  return (
    <div
      role="tablist"
      aria-label="首页视图切换"
      className="flex w-fit items-center gap-1 rounded-[12px] border border-line bg-cream/60 p-1"
    >
      {options.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={homeViewMode === key}
          onClick={() => setHomeViewMode(key)}
          className={cn(
            'flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-sm font-medium transition-colors',
            homeViewMode === key
              ? 'bg-pine-soft text-pine'
              : 'text-mist hover:bg-sand hover:text-ink',
          )}
        >
          <Icon size={15} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
