import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';
import { titleBarHeight } from '../../lib/topbarMetrics';
import { resolveAnchoredPosition, type Point } from '../../lib/anchoredPosition';

type ModalPlacement =
  | 'center'
  | 'right'
  | 'left'
  | 'left-rail'
  | 'right-float'
  | 'float'
  | 'dropdown'
  | 'fullscreen';

/**
 * 遮罩 z 档 → 类名**静态映射**（纪律同 print-templates：不许拿档位数字拼类名——
 * 模板串拼出来的类名不进 Tailwind 的 JIT 内容扫描，会静默丢样式）。
 */
const OVERLAY_Z_CLASS: Record<60 | 70 | 75 | 78, string> = {
  60: 'z-[60]',
  70: 'z-[70]',
  75: 'z-[75]',
  78: 'z-[78]',
};

/**
 * 遮罩 z 档：缺省按 placement（既有四档语义不变——60 抽屉 / 70 居中 /
 * 75 全屏与下拉）；`zTier` 显式指定时覆盖。
 *
 * 为什么需要覆盖：期六打印选择器弹窗要盖在 fullscreen 预览浮层（75 档）
 * **之上**、又必须留在 toast 反馈层**之下**——既有档位里没有这个间隙，
 * 故新增 78 一档。除此之外没有任何调用方需要它。
 * （注释里不写 toast 档位的类名面——JIT 连注释都扫，且层级 spec 以源码
 * 数值比较守「toast 高于一切 Modal」，多一个字面量就多一分误判。）
 */
function overlayZClass(placement: ModalPlacement, zTier?: 60 | 70 | 75 | 78): string {
  if (zTier !== undefined) return OVERLAY_Z_CLASS[zTier];
  if (placement === 'center') return OVERLAY_Z_CLASS[70];
  if (placement === 'fullscreen' || placement === 'dropdown') return OVERLAY_Z_CLASS[75];
  return OVERLAY_Z_CLASS[60];
}

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
 *   v0.8.6.0002 · 反馈 #1 新增 `left-rail`：与 `left` 同几何（贴顶栏底缘全高、
 *   左缘滑入），但**遮罩左缘让出 `railLeft` 像素**——让出的正是常驻侧栏：
 *   设置抽屉贴侧栏右缘展开，侧栏保持可见可点（她想设置时还能切侧栏）。
 *   消费者：SettingsDialog（≥xl 侧栏宽度 240/64；<xl 传 '0px' 即全屏）。
 *   她 10-09 23:38 反馈「日程表打印预览的窗口不要超过左侧的侧边栏」：
 *   `fullscreen` 档同样接受可选 `railLeft`（≥xl 传侧栏宽度，预览从侧栏右缘
 *   起、侧栏不被压暗；不传 = 全宽，<xl 现状）。消费者：PrintPreviewDialog。
 *
 * 注意：`glass-strong / iridescent-border` 等玻璃样式请放在子面板（children 内）上，
 * 不要加到外层遮罩上——遮罩由本组件统一渲染，否则玻璃自身又变成新的固定包含块。
 */
export function Modal({
  open,
  onClose,
  placement = 'center',
  ariaLabel = '浮层',
  anchor = null,
  railLeft,
  zTier,
  children,
}: {
  open: boolean;
  onClose(): void;
  /**
   * 对齐方式：
   *   center      居中弹窗（默认，复杂表单 / 确认 / 高风险流程）
   *   right       右侧滑出抽屉（连续阅读的详情）
   *   right-float 右侧悬浮圆角卡片（长内容、无锚点的设置类面板）
   *   float       锚定浮动卡 —— 出现在**触发元素/点击点附近**，空间不足自动翻转（反馈 #3）
   *   left-rail   左侧贴缘抽屉（v0.8.6.0002 · 反馈 #1）——同 left 几何，但遮罩
   *               左缘让出 railLeft（常驻侧栏宽度）：抽屉贴侧栏右缘展开，
   *               侧栏不被遮罩压住、保持可见可点
   *   fullscreen  全屏面板（打印预览）。同样接受可选 railLeft：传了 ⇒ 遮罩
   *               （与面板）左缘让出该宽度（≥xl 侧栏宽度，侧栏可见可点）；
   *               不传 ⇒ 全宽（<xl 无持久侧栏的现状）
   */
  placement?: ModalPlacement;
  /** 无障碍标签，读屏用 */
  ariaLabel?: string;
  /**
   * 遮罩 z 档显式覆盖（缺省按 placement，见 overlayZClass）。**仅当时序
   * 冲突时用**：期六打印选择器弹窗（center 几何）要盖 fullscreen 预览
   * （预览浮层那一档）又低于 toast 反馈层 ⇒ 传 78。其余场景一律省略。
   */
  zTier?: 60 | 70 | 75 | 78;
  /**
   * 遮罩左缘让出的宽度，CSS 长度（如 '240px' / '64px' / '0px'）。
   *
   * `placement='left-rail'`（v0.8.6.0002 · 反馈 #1）：≥xl 传侧栏宽度
   * （展开 240 / 收起 64），<xl 传 '0px'（全屏，与 left 档一致）。
   *
   * `placement='fullscreen'`（她 10-09 23:38 反馈「日程表打印预览的窗口不要
   * 超过左侧的侧边栏」）：**可选**——传了就把遮罩（与全屏面板）左缘让到该
   * 宽度（≥xl 的侧栏宽度：侧栏全程可见可点、不被压暗）；不传（undefined）
   * 保持全宽（<xl 无持久侧栏 ⇒ 现状不变）。bg / z 档不随本参数变。
   */
  railLeft?: string;
  /**
   * 锚点（视口坐标）。`placement='float'` 时用它在点击位置附近展开；
   * 缺省时退回右浮动（老调用方零改动）。
   */
  anchor?: Point | null;
  children: React.ReactNode;
}): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  /** 锚定浮动卡本体（`placement='float'`）；定位需要实测它的尺寸 */
  const floatRef = useRef<HTMLDivElement>(null);
  const [floatPos, setFloatPos] = useState<{ top: number; left: number } | null>(null);
  const anchorX = anchor?.x ?? null;
  const anchorY = anchor?.y ?? null;
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

  /**
   * `placement='float'`：把面板贴到锚点（触发元素 / 点击坐标）附近。
   *
   * 用 layout effect 而非 effect —— 面板必须先量尺寸再定位，否则首帧会先闪在
   * 静态位置（左上角）再跳到锚点。`floatPos` 为 null 时面板 `visibility:hidden`，
   * 用户永远看不到那一帧。
   *
   * 监听 resize 与 visualViewport 的 scroll：窗口缩放、移动端键盘顶起视口、
   * 页面滚动都会让「原来的锚点」失准，必须重算，而不是像旧实现那样直接关闭。
   *
   * ⚠️ 还必须监听**面板自身的尺寸变化**（ResizeObserver）：
   *   浮层面板的内容常常是**异步变高**的（设置面板的本地库占用估算、授权状态、
   *   日志条数、字体加载），而定位只发生一次 —— 内容长高后底边就被推出视口，
   *   连同底部圆角一起被裁掉（用户原始投诉的那一类观感）。
   *   回归位：`tests/qa-batch-a-verify.spec.ts` 的 Q-A2-2（断言 `vh − bottom ≥ 8`）。
   *
   *   ⚠️ 不会自激：`compute` 只改 top/left，不改尺寸 ⇒ 不会再次触发 ResizeObserver；
   *   且写 state 前做等值判断，位置没变时返回原对象，避免多余渲染。
   */
  useLayoutEffect(() => {
    if (!open || placement !== 'float') return;
    const el = floatRef.current;
    if (!el) return;
    const compute = (): void => {
      /*
        ★ 必须量**布局盒**（offsetWidth/offsetHeight），不能量 getBoundingClientRect()。
        本 effect 与入场动画 `float-pop-in` 同帧启动，而动画的 from 帧带
        `transform: translateY(-4px) scale(0.98)` —— rect 量到的是**缩放后**的盒子
        （真机实测：布局 400×820 被量成 392×803.6，恰好 0.98 倍），据此算出的
        top/left 随之偏移，动画结束后真实底边越出视口：767×900 实测落在 908.39
        （视口 900，溢出 8.39px），底部圆角连同背景一起被裁掉 ——
        正是用户投诉 #2/#3 的那类观感。`translateY(-4px)` 同样会污染 rect.top。
        offsetWidth/offsetHeight 是**布局盒**尺寸，不受 transform 影响；动画结束后
        transform 归零（fill-mode: both）⇒ 最终视觉盒 == 布局盒，用布局盒定位才对。
      */
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      if (width === 0 && height === 0) return;
      const vv = window.visualViewport;
      const viewport = {
        width: vv?.width ?? window.innerWidth,
        height: vv?.height ?? window.innerHeight,
      };
      const insetTop = window.idplan?.platform === 'win32' ? titleBarHeight() : 0;
      const next = resolveAnchoredPosition({
        // 没有锚点（老调用方 / 键盘触发）：退化为「右下角」而不是右侧全高贴边
        anchor:
          anchorX === null || anchorY === null
            ? { x: viewport.width - width - 16, y: viewport.height - height - 16 }
            : { x: anchorX, y: anchorY },
        panel: { width, height },
        viewport,
        insetTop,
      });
      setFloatPos((prev) =>
        prev && prev.top === next.top && prev.left === next.left ? prev : next,
      );
    };
    compute();
    window.addEventListener('resize', compute);
    window.visualViewport?.addEventListener('resize', compute);
    window.visualViewport?.addEventListener('scroll', compute);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => compute());
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', compute);
      window.visualViewport?.removeEventListener('resize', compute);
      window.visualViewport?.removeEventListener('scroll', compute);
      ro?.disconnect();
    };
  }, [open, placement, anchorX, anchorY]);
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
      // 期六新增 78 档（overlayZClass 的 zTier 覆盖）：打印选择器弹窗要盖 fullscreen
      // 预览那一档、又留在 toast 反馈层之下——既有四档（60/70/75 + dropdown 同 75）
      // 没有这个间隙。具体档位面见 overlayZClass 上方映射表（注释不写字面量）。
      //
      // ★ v0.8.6 壳层常驻重构：遮罩从**顶栏下缘**起始（inset-0 → top-14 xl:top-16），
      //    让出自绘三键所在的顶栏带。三键并回 header（TopBar 的 WindowControls 不再是
      //    body portal）后，若遮罩仍铺满视口，它（header z-40）会被 z-60/70/75 重新吞掉
      //    ——弹窗一开连点关闭都做不到（10-01 反馈 #4 原样复发）。靠让位而非 z-index
      //    解决：顶栏与三键在任何浮层打开期间保持原色、可点，对齐原生 titleBar 语义。
      //    档位口径与 TopBar 的行高一致：<md 两行顶帽合计 100，md–xl 56，xl 64。
      //    ⚠️ 不要改回 inset-0，也不要在遮罩上动 z-index（toast/三键层级会被搅乱）。
      //    v0.8.6.0002 · 反馈 #1：`left-rail` 档在此之上把**左缘**推到 railLeft
      //    （内联 style 覆盖 inset-x-0 的 left:0）——遮罩只压内容区，常驻侧栏
      //    保持可见可点；抽屉是遮罩的 flex 首子项，随之贴侧栏右缘展开。
      //    她 10-09 23:38 反馈「日程表打印预览的窗口不要超过左侧的侧边栏」：
      //    `fullscreen` 档同样支持 railLeft（可选）——传了就把遮罩左缘让到侧栏
      //    宽度（≥xl 打印预览从侧栏右缘起，侧栏全程可见可点）；不传保持全宽
      //    （<xl 无持久侧栏的现状）。bg / z 档不随本参数变。
      className={`fixed inset-x-0 bottom-0 max-md:top-[100px] md:top-14 xl:top-16 ${
        placement === 'center'
          ? 'bg-ink/45'
          : placement === 'fullscreen'
            ? // 0.8.4 打印预览：层级压过一切 Modal、低于 Toast 反馈层（数字见本行类名），遮罩同 center 浓度
              'bg-ink/45'
            : placement === 'dropdown'
              ? // v0.8.5 A 规范 §A.4：锚定下拉浮层。z-[75] 盖得住 center 建档弹窗
                // （z-[70]；原生 select 本来就能盖），**无底色**——下拉不该把背后弹窗压暗。
                // 与打印预览同值但场景互斥（下拉只出现在建档弹窗内，打印路由独立）。
                'bg-transparent'
                : // left / left-rail 同层同浓度（z-60 / bg-ink/25）
                  'bg-ink/25'
      } ${overlayZClass(placement, zTier)}`}
      style={
        placement === 'left-rail'
          ? { left: railLeft ?? '0px' }
          : placement === 'fullscreen' && railLeft !== undefined
            ? { left: railLeft }
            : undefined
      }
    >
      {/* 点击关闭判定放在锚点面板（e.currentTarget）上而非遮罩：因为面板是 flex 容器且覆盖内容区，
          点面板自身的空白区域（子面板之外）即关闭，点子面板内部不关闭。这样居中/右侧抽屉一致生效，
          且子面板用受限宽度时不吞掉外围点击。注意必须加 h-full：父遮罩非 flex 容器，锚点面板高度默认=内容高，加 h-full 才能撑满视口，
          否则 center 模式的垂直居中失效、right 抽屉的 h-full 子面板也撑不满视口。

          ⚠️ v0.8.6 壳层常驻后的 padding 口径（重要，别改回）：
          抽屉族（left / left-rail / right）现在是 **p-0 + items-stretch**——遮罩从顶栏下缘起始
          （overlay 的 top-14 xl:top-16），抽屉贴顶栏底缘全高展开。旧口径的
          `pt-[max(env(safe-area-inset-top),3rem)] sm:pt-12` 是系统标题栏时代的避让，
          在自绘标题栏 + 遮罩让位的双重结构下只会制造悬空带（顶栏与抽屉之间一条
          遮罩沟），v0.8.6 已废。子面板的 max-h / 圆角口径随之以「全高」为准，
          不再扣容器 padding。center 档保持 p-4 sm:p-6 不变（它不贴边）。
          ⚠️ 仅改此处 padding / className，切勿触碰下方焦点 effect 的 [open] 依赖（IME 吞字根治）。 */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`outline-none flex h-full w-full ${
          placement === 'center'
            ? 'items-center justify-center p-4 sm:p-6'
            : placement === 'fullscreen'
              ? // 打印预览：全屏、无点击缓冲区（面板不透明，遮罩仅入场动画期可见）
                'p-0'
              : placement === 'left' || placement === 'left-rail'
                ? // v0.8.5 C1：左侧抽屉（right 的镜像）——触发侧感知：汉堡在左上，抽屉同侧滑出。
                  // v0.8.6 壳层常驻后几何修正：原先 pt-[max(env(safe-area-inset-top),3rem)]
                  // sm:pt-12 是系统标题栏时代的避让；现在遮罩已从顶栏下缘起始（top-14
                  // xl:top-16，见本组件 overlay），抽屉贴顶栏底缘全高展开（p-0 +
                  // items-stretch）——再留 48px 就是遮罩上的一条悬空带。
                  // 消费者：侧栏导航抽屉（264px）+ 设置抽屉（640px，反馈 #4）。
                  // left-rail（反馈 #1）：几何同 left，差别只在 overlay 左缘让出
                  // 侧栏宽度（见上方 style）；flex 首子项的抽屉随之贴侧栏右缘。
                  'items-stretch justify-start p-0'
                : placement === 'dropdown'
                  ? // v0.8.5 A 规范 §A.4：锚定下拉。外层只当点击捕获层，面板 fixed 自行定位
                    'p-0'
                  : placement === 'float'
                  ? // 锚定浮动卡：面板由内层 fixed 容器自行定位，外层只当点击捕获层
                    'items-start justify-start p-0'
                  : placement === 'right-float'
                    ? 'items-end justify-center pt-[max(env(safe-area-inset-top),3rem)] sm:items-start sm:justify-end sm:p-6'
                    : // right 抽屉：同 'left' 的几何修正（p-0 + items-stretch），镜像到右缘。
                      // v0.8.5 C1 时代的 pt-12 避让同样随壳层常驻作废。
                      'items-stretch justify-end p-0'
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
        {placement === 'float' ? (
          <div
            ref={floatRef}
            data-anchored-float=""
            className="float-pop-in fixed"
            style={{
              top: floatPos?.top ?? 0,
              left: floatPos?.left ?? 0,
              // 定位算出来之前不显示，避免首帧闪在 (0,0)
              visibility: floatPos ? 'visible' : 'hidden',
            }}
          >
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>,
    document.body,
  );
}
