import { useEffect, useRef } from 'react';

import { createPortal } from 'react-dom';

/**
 * 通用浮层底座（modal-overlay 基础设施）。
 *
 * 为什么存在：`position: fixed` 一旦祖先含非 `none` 的 `backdrop-filter` / `transform` /
 * `filter` / `perspective` / `will-change` / `contain:paint`，就会退化为相对该祖先定位，
 * 导致弹窗跑到顶部、且超出祖先高度被裁切（信息丢失）。本组件用 createPortal 挂到
 * `document.body`，彻底隔离祖先 CSS 对 fixed 的破坏，今后新增浮层一律走它即可从底层杜绝复发。
 *
 * 已替你处理的边界：
 *  - 遮罩点击关闭（`e.target === e.currentTarget`）、Escape 关闭
 *  - 焦点圈禁（打开聚焦面板，Tab 循环不逃逸到页面背后）
 *  - body 滚动锁定（overflow:hidden + 补偿 scrollbar 宽度，页面不跳动）
 *  - z-index 统一（高于顶部 toast 层），ATIA `role="dialog"` `aria-modal="true"`
 *
 * 用法（必传 open / onClose / children，placement 可省略）：
 *   <Modal open={isOpen} onClose={close}>
 *     <div className="glass-strong ...">你的弹窗面板</div>
 *   </Modal>
 *   侧滑抽屉传 placement="right"，子面板给 max-w + 自己撑满高度即可。
 *
 * 注意：`glass-strong / iridescent-border` 等玻璃样式请放在子面板（children 内）上，
 * 不要加到外层遮罩上——遮罩由本组件统一渲染，否则玻璃自身又变成新的固定包含块。
 */
export function Modal({
  open,
  onClose,
  placement = 'center',
  ariaLabel = '浮层',
  children,
}: {
  open: boolean;
  onClose(): void;
  /** 对齐方式：center（居中弹窗，默认）/ right（右侧滑出抽屉）/ right-float（右侧悬浮圆角卡片） */
  placement?: 'center' | 'right' | 'right-float';
  /** 无障碍标签，读屏用 */
  ariaLabel?: string;
  children: React.ReactNode;
}): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  // 用 ref 持有最新的 onClose，避免父组件重渲染产生新函数引用时导致下面的焦点 effect 重跑（会抢走输入框焦点、打断输入法组合）。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape 关闭 + 焦点圈禁 + 滚动锁定。
  useEffect(() => {
    if (!open) return;

    // 记录打开前的焦点元素，关闭后还原。
    lastFocusRef.current = document.activeElement as HTMLElement | null;
    // 打开后聚焦面板（保证 Tab 循环起始点 + 可读屏聚焦）。
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // 焦点圈禁：Tab / Shift+Tab 在面板内循环。
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) {
          e.preventDefault();
          panelRef.current.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);

    // 锁定 body 滚动并补偿滚动条宽度，避免打开弹窗瞬间页面横向跳动。
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    document.body.style.overflow = 'hidden';
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`;

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      // 关闭后把焦点还原给触发元素。
      lastFocusRef.current?.focus();
    };
    // 依赖只保留 open：若把 onClose 放进依赖，父组件每次重渲染产生的新函数引用会让本 effect 卸载重跑，
    // cleanup 里的焦点还原 + 重新聚焦面板会在每次击键时抢走输入框焦点，
    // 打断微软拼音的 IME 组合上下文，造成「打第二个字时第一个字消失」的吞字。
  }, [open]);
  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      // z-index 分层：居中弹窗(center)=z-[70] 最高可盖一切；右侧抽屉(right)=z-[60] 属二级浮层，
      // 让其内部冒出的更浅层浮层（如指派弹层 z-[65]）能盖在抽屉之上。抽屉自身不参与 center 的顶层竞争。
      // Soft UI 不用 backdrop-blur（玻璃拟态）；层次靠统一的主色遮罩 + 面板外凸阴影表达。
      // 去掉模糊后遮罩要略实一点，否则背景噪点会穿透、压不住层级。
      className={`fixed inset-0 ${placement === 'center' ? 'z-[70] bg-ink/45' : 'z-[60] bg-ink/25'}`}
    >
      {/* 点击关闭判定放在锚点面板（e.currentTarget）上而非遮罩：因为面板是 flex 容器且覆盖内容区，
          点面板自身的空白区域（子面板之外）即关闭，点子面板内部不关闭。这样居中/右侧抽屉一致生效，
          且子面板用受限宽度时不吞掉外围点击。padding 也放这里，让 p-6 缓冲区的点击命中关闭。
          注意必须加 h-full：父遮罩非 flex 容器，锚点面板高度默认=内容高，加 h-full 才能撑满视口，
          否则 center 模式的垂直居中失效、right 抽屉的 h-full 子面板也撑不满视口。 */}
      <div
        ref={panelRef}
        tabIndex={-1}
        /*
          移动端形态：right 抽屉在 <sm(640px) 时改为「从底部滑出、接近全屏」，符合单手操作习惯；
          平板以上恢复右侧滑出。center 弹窗保持居中 + 收缩边距（p-4 → sm:p-6）。

          ⚠️ 关于「距底不对称 / 底部圆角被推出屏幕」（v0.7 批次 A 修复）：
          这里原先是 className 给 `sm:p-6`、另用**内联 style** 给
          `paddingTop: max(env(safe-area-inset-top), 3rem)`。内联样式优先级高于类，
          于是 ≥sm 时实际是「上 48 / 其他 24」——上下不对称；
          而子面板（如 SettingsDialog）的 `max-h` 是按**容器上下对称 48** 的口径写的，
          容器顶部多吃 24px 就把面板整体下推、底部（含圆角）溢出视口被裁掉。
          修法：去掉内联 style，改由**响应式类**表达，让「手机安全区」只作用于 <sm：
            · center      → p-4 sm:p-6（对称，原样不变）
            · right-float → <sm 顶部安全区，≥sm 对称 sm:p-6（画板无此稿，按对称原则修）
            · right 抽屉  → <sm 顶部安全区，≥sm `sm:pt-12`（=48px，与改造前桌面端
                            视觉完全一致，避免引入非预期变更）
          手机档仍需避让状态栏：用 Tailwind 任意值类承载 env()，
          任意值内含逗号/括号是合法写法（JIT 静态提取到的是字面量类名）。
          ⚠️ 仅改此处 padding / className，切勿触碰下方焦点 effect 的 [open] 依赖（IME 吞字根治）。
        */
        className={`outline-none flex h-full w-full ${
          placement === 'center'
            ? 'items-center justify-center p-4 sm:p-6'
            : placement === 'right-float'
              ? 'items-end justify-center pt-[max(env(safe-area-inset-top),3rem)] sm:items-start sm:justify-end sm:p-6'
              : 'items-end justify-center pt-[max(env(safe-area-inset-top),3rem)] sm:justify-end sm:pt-12'
        }`}
        // 拦截合成 click，阻止其沿 React 组件树冒泡到背后触发器的 onClick（如项目卡片 → 跳转）。
        // 关键：Modal 用 createPortal 只改 DOM 挂载点，React 树仍是调用方的子树，
        // 故点弹窗内任意元素（输入框等）的 click 会冒泡到外层卡片的 onClick 触发跳转。
        // 这里 stopPropagation 从底座根治——所有走 Modal/ConfirmDialog 的浮层都受保护。
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
