import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { useLang } from '../../i18n';
import { cn } from '../../lib/cn';

/**
 * 侧栏折叠开关（v0.7 · 子系统 ① · T20）。
 *
 * 无障碍（T20 要点 3）：
 *   · `aria-expanded` 表达展开/收起语义（读屏可知当前状态）
 *   · `aria-label` 说明**动作结果**而非当前状态（「收起侧边栏」/「展开侧边栏」），
 *     这是按钮类控件的通行做法——读屏用户听到的是"按下会发生什么"
 *   · `aria-controls` 指向侧栏容器的 id，明确控制对象
 *   · 键盘可达（原生 `<button>`，Tab 可聚焦 + Enter/Space 触发）
 *
 * 视觉：收起态（64px 栏）下按钮与图标同宽居中，不溢出；展开态右对齐。
 * 颜色全部走命名 token（text-mist / hover:bg-sand / hover:text-ink），零裸色值。
 */
export function SidebarCollapseToggle({
  collapsed,
  onToggle,
  controlsId,
}: {
  collapsed: boolean;
  onToggle(): void;
  /** 被控制元素的 id（`aria-controls` 用） */
  controlsId: string;
}): JSX.Element {
  const { t } = useLang();
  const label = collapsed ? t('ui.sidebar.expandAria') : t('ui.sidebar.collapseAria');

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      /* ★ 语言无关定位钩子（批次⑥ 档 A₁）：真机 spec 原本按 aria-label
         「收起侧边栏 / 展开侧边栏」定位 —— 那两串是**界面文案**，走 i18n 后
         一切到英文就找不到元素（且失败会伪装成「控件不存在」）。
         一个钩子覆盖收起/展开两态（它是同一个开关，动作名随状态变）。
         aria-label / title 原样保留：无障碍契约不变，只是不再当选择器。 */
      data-sidebar-collapse-toggle=""
      aria-label={label}
      aria-controls={controlsId}
      title={label}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-mist',
        'transition-colors hover:bg-sand hover:text-ink',
        'outline-none focus-visible:ring-2 focus-visible:ring-pine/40',
      )}
    >
      {collapsed ? <PanelLeftOpen size={17} aria-hidden /> : <PanelLeftClose size={17} aria-hidden />}
    </button>
  );
}
