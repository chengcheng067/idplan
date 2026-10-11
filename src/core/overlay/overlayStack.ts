import { useSyncExternalStore } from 'react';

/**
 * 浮层栈 —— 「**现在谁在最上层**」这个事实的**唯一出处**。
 *
 * ══════════════════ 为什么需要它 ══════════════════
 * 修前每个 `Modal` 都是**自持**的：自己算 z 档、自己挂 document keydown 听 Escape、
 * 自己盖一层遮罩。没有任何一处持有「当前顶层浮层是谁」这个事实 —— 于是长出三个
 * 看着互不相干、根却同一个的症状：
 *
 *   · **F3**：每个 open 的 Modal 都在自己的 keydown 里 `if (Escape) onClose()`，
 *     不判自己是不是最顶层 ⇒ 设置抽屉里开确认框，按一次 Esc **两层一起关**。
 *   · **F6-A**：侧栏的 `z-[61]` 是「按当时唯一的消费者（设置抽屉）拍的一个数」，
 *     它不知道此刻压在上面的到底是谁 ⇒ 右侧阶段抽屉（60）开着时侧栏仍浮在其上，
 *     不被压暗、还能点 ⇒ 点另一个项目就地换页，抽屉内容错位成「该阶段不存在」。
 *   · **F2**：顶栏自持的浮层（身份菜单 / ⋮ 面板）长在 header 的 `z-40` **层叠上下文**
 *     里，无论自己写多大的 z 都出不去 ⇒ 内容遮罩一开就把它们压住，而且点菜单项
 *     命中的是遮罩的点击捕获层 —— 用户想切身份，结果是抽屉关了、身份没变。
 *
 * 三条症状的共同修法只有一个：**把「谁在最上层」变成一个可以被查询的事实**，
 * 再让每个消费方（Esc 判定 / 侧栏层级 / chrome 层级）**都去问它**，而不是各自
 * 猜一个数。本模块就是那个事实。
 *
 * ══════════════════ 接口形状 ══════════════════
 *   · `pushOverlay(spec) -> id` / `popOverlay(id)`：**由 Modal 的 open effect 配对调用**
 *     （open 时 push、cleanup 时 pop）—— 与既有 `usePresence` 的「关≠立即卸载」不冲突：
 *     出口动画期元素还留在 DOM 里，但它**已经不在栈上**了（用户已经关掉它，
 *     剩下的只是视觉余韵，不该再抢 Esc）。
 *   · `isTopOverlay(id)`：**纯读**，不订阅、不触发渲染 —— 给 Esc 用。Modal 在
 *     keydown 的**当下**问一次「我是栈顶吗」，是就关自己，不是就不动。这样一次
 *     Esc 只作用于一层，符合所有人的直觉。
 *   · 「栈顶」= **tier 最大者**，同档取后进者。为什么不用纯 LIFO（后进即栈顶）：
 *     层级是**视觉**事实，而 push 顺序**不等于** z 顺序。反例就在本仓：
 *     `PrintPreviewDialog` 的预览 Modal（75）**包着**选择器 Modal（78），首次挂载
 *     时 React 的 effect 是**子先父后** ⇒ 78 先 push、75 后 push，纯 LIFO 会把
 *     压在底下的预览判成栈顶，Esc 又关错层。按 tier 判则恒等于 z 判，不会再错。
 *   · `isRailYielded()`：给常驻侧栏用 —— **顶层内容浮层**是否让出了侧栏（见下）。
 *
 * ══════════════════ 让位带口径 ══════════════════
 * 「让位」只有两处，两处的判定权都收在栈顶：
 *   · **顶栏带**（遮罩顶缘 = 顶栏底缘）：**所有**浮层一律让出，没有例外 ⇒ 它是
 *     一个常量（`TOPBAR_YIELD_CLASS`,见 Modal），不由栈顶算 —— 写在这里是为了让
 *     「让位带」这个词有唯一落点，将来真出现「某个浮层要盖住顶栏」时在这里开口子，
 *     而不是回去改每一处实例。
 *   · **侧栏带**（左缘遮罩推到侧栏右缘）：**只有** `left-rail` 档、以及传了
 *     `railLeft` 的 `fullscreen` 档让出。这条**必须**按栈顶算 —— 让侧栏"保持可点"
 *     只对「此刻压在上面那个浮层」有意义；60 档的右抽屉压上来时侧栏就该老实被压住。
 */

/**
 * 浮层档位。数值与 `Modal.tsx` 的 `OVERLAY_Z_CLASS` **同一套**（那张表是类名面，
 * 本类型是数值面，两者是同一组常量，见 Modal 的注释）。
 *
 *   60  抽屉（left / right / left-rail / float 族缺省）
 *   70  居中弹窗
 *   75  全屏面板（打印预览）/ 锚定下拉
 *   78  盖在 75 之上、留在 toast 之下的那一档（打印选择器弹窗）
 *   79  顶栏 chrome 的自持浮层（身份菜单 / ⋮ 面板）—— 见 CHROME_OVERLAY_TIER
 */
export type OverlayTier = 60 | 70 | 75 | 78 | 79;

/**
 * 顶栏 chrome 自持浮层的档位 = **高于一切内容浮层、低于 toast**。
 *
 * 为什么是「新开一档」而不是复用 78：78 已经被**内容**浮层占用了（打印选择器），
 * 而 chrome 与它是两件事 —— chrome 是常驻界面的一部分，任何时候都在最上面。
 * 挤在 78 上会变成「谁后开谁赢」，正好又是 F2 那种「没有事实、只有碰运气」。
 * 78 与 toast 之间正好空着一级，落在这一级上语义自然：**chrome 在内容之上、
 * 反馈在一切之上**（toast 的 80 由 `tests/toast-above-modal.spec.ts` 钉住）。
 */
export const CHROME_OVERLAY_TIER = 79;

/**
 * 浮层来源。
 *   · `content` 内容浮层（Modal 家族）—— 参与「顶层是谁」与侧栏让位。
 *   · `chrome`  顶栏常驻界面的自持浮层（身份菜单 / ⋮ 面板）—— 同样参与
 *     「顶层是谁」（Esc 只该关它，不该顺手关掉底下的预览），但**不参与侧栏让位**：
 *     它压不压侧栏是内容浮层的事，它自己永远只是顶栏的一小块。
 */
export type OverlayKind = 'content' | 'chrome';

/** 一个已在场的浮层实例 */
export interface OverlayEntry {
  readonly id: number;
  readonly tier: OverlayTier;
  readonly kind: OverlayKind;
  /** 是否让出常驻侧栏（`left-rail` 档 / 传了 `railLeft` 的 `fullscreen` 档）。仅 content 有意义 */
  readonly railExempt: boolean;
}

let seq = 0;
let entries: readonly OverlayEntry[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly OverlayEntry[] {
  return entries;
}

/** 入栈，返回本次实例的 id（出栈时要用它认领） */
export function pushOverlay(spec: Omit<OverlayEntry, 'id'>): number {
  seq += 1;
  entries = [...entries, { ...spec, id: seq }];
  emit();
  return seq;
}

/**
 * 出栈。**不存在的 id 静默返回** —— 因为 open 与 cleanup 是 React 的一对回调，
 * 而在并发多写者的仓库里「某个实例被卸载两次」不值得让整棵浮层栈炸掉。
 */
export function popOverlay(id: number): void {
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) return;
  entries = next;
  emit();
}

/**
 * 栈顶 = **tier 最大者**，同档取后进者（见文件头「为什么不用纯 LIFO」）。
 * 纯函数，两个用途共用：① `isTopOverlay` 的判定；② 单元的表格测试。
 */
export function topOverlayOf(list: readonly OverlayEntry[]): OverlayEntry | null {
  let top: OverlayEntry | null = null;
  for (const e of list) {
    if (top === null || e.tier >= top.tier) top = e;
  }
  return top;
}

/**
 * 本实例是不是栈顶 —— **Esc 判定的唯一依据**。
 *
 * 刻意做成「读一次、返回布尔」的普通函数（不是 hook）：Esc 是**事件时刻**的问题，
 * 在 keydown 当下问一次就够了；做成 hook 会让每层 Modal 在别人开合时白白重渲染。
 */
export function isTopOverlay(id: number): boolean {
  return topOverlayOf(entries)?.id === id;
}

/**
 * 常驻侧栏此刻是否**应保持在自己的层**（= 顶层内容浮层让出了侧栏带）。
 *
 * `true`  → 侧栏抬到内容浮层之上：保持原色可点，抽屉投影也不溅到它身上
 *           （`left-rail` 设置抽屉、带 `railLeft` 的打印预览）。
 * `false` → 侧栏落回普通流：被内容遮罩压暗、点击被遮罩吃掉（不再「开着抽屉换页」）。
 *
 * 没有任何内容浮层时返回 `true`：侧栏本来就在自己的位置上，抬不抬无所谓，
 * 保持与修前一致的 `z`（避免「没开浮层时侧栏层级变了」这种无谓扰动）。
 */
export function isRailYielded(): boolean {
  const top = topOverlayOf(entries.filter((e) => e.kind === 'content'));
  return top === null || top.railExempt;
}

/** 订阅版（消费方需要跟着栈顶变化重渲染时用，如 Sidebar 的 z 档） */
export function useRailYielded(): boolean {
  return useSyncExternalStore(subscribe, isRailYielded, () => true);
}

/**
 * 常驻侧栏的两种层态 → 类名**静态映射**（纪律同 `Modal.tsx` 的 z 档表：
 * 类名只许是字面量，JIT 扫不到动态串会静默丢样式）。
 *
 *   · `yielded`  —— 顶层内容浮层让出了侧栏带 ⇒ 侧栏抬到内容浮层之上
 *                   （61：60 抽屉之上、65 指派浮层之下 —— 既有档位不动）。
 *                   这一档是 v0.8.6.0002 为**投影互溅**测出来的，不是拍脑袋：
 *                   修前实测（暗色主题）抽屉的 glass-strong 外凸投影把侧栏右缘约
 *                   35px 压深一档（#1f2126→#181a1e），叠加接缝两道 1px line，
 *                   侧栏与抽屉像两块拼起来的面板。她的原话：「弹出的设置窗颜色和
 *                   侧边栏的颜色差别过大，我认为这个时候不应该有这个色差。」
 *                   实测两侧底色本来就是同一个 paper token —— 差别全在接缝，
 *                   所以修的是接缝（描边 + 投影），而抬层就是让投影别落到侧栏上。
 *                   抬的前提是**二者空间上零重叠**（设置抽屉贴侧栏右缘展开），
 *                   这正是 `railExempt` 表达的那件事 —— 换成压满全宽的右抽屉，
 *                   前提就不成立了，必须落回 `covered`。
 *   · `covered`  —— 其余情形 ⇒ **不带 z-index**，落回普通流被 fixed 遮罩压住。
 *                   这里刻意不是「比 60 小的一档数值」：写一个更小的数等于宣称
 *                   「侧栏本来就该参与层叠竞争」，而它其实只是被压住；不给 z
 *                   才是这件事的准确表达，也避免再制造一个需要维护的档位。
 */
export const RAIL_Z_CLASS: Record<'yielded' | 'covered', string> = {
  yielded: 'z-[61]',
  covered: '',
};

/**
 * 清空浮层栈 —— **只给测试的进程级清理用**。
 *
 * 必要性同 `tests/setup.ts` 里那条 `document.body.innerHTML = ''` 的注释：
 * vitest 配的是 `singleThread: true`，全部 spec 共用一个进程，而 jsdom 的 document
 * 是进程级单例 —— 某个 spec 渲染出的 Modal 若没被卸载（或只清了 DOM 没 unmount），
 * 它的栈条目会**残留给下一个 spec**，把后者的 `isTopOverlay` 判成 false。
 * 表现形式是「单跑绿、全量红」，且报错指向无辜的下游 spec。
 */
export function resetOverlayStack(): void {
  entries = [];
  seq = 0;
  emit();
}

/** 测试辅助：当前在栈浮层数（快照语义，勿在运行时拿它做业务判断） */
export function overlayStackSize(): number {
  return entries.length;
}
