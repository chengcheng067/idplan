/**
 * 阶段色的**建档视图适配层**（v0.8 · T03 ⇄ T02 联调）。
 *
 * ── 它是什么、不是什么 ──
 *   · **是**「T02 的取色出口 → 建档四处的 JSX」之间的一层薄封装；
 *   · **不是**取色引擎。派生 / 归一 / 注册的**唯一实现**都在 `src/core/color/**`
 *     （§5.2 冻结签名）。本文件**零业务算法**：不自己解析颜色、不自己选字色、
 *     不自己定义警告码 —— 那些一旦各写一份，亮/暗/打印三态必然对不上。
 *
 * ── 联调记录（T02 落盘后） ──
 * T03 与 T02 原本并行，本文件当时自持一份「按冻结签名调用、但暂不依赖 T02 文件存在」的
 * 极简兜底。T02 已落盘，兜底**已删除**，改为直接转发；调用点零改动。删除时修掉了
 * 兜底引入的两处**契约漂移**（这正是并行开发的典型代价，记在此处备查）：
 *   ① 兜底自定义了第 5 个警告码 `'invalid-format'` —— 而 §5.2 的 `DeriveWarning.code`
 *      是**四码冻结**联合（`unresolvable` 已覆盖「主色非法」）。多一个码会让 T02 侧
 *      的穷尽分支编译失败；
 *   ② 兜底自持了第二个归一化器（返回小写），与 T02 的 `normalizeHex`（返回大写）不一致。
 *      全仓只保留 T02 那一个（`tests/backup.roundtrip.spec.ts` 的夹具也是大写）。
 *
 * ── 两条铁律（与 T02 同款） ──
 *   ① **零 hex 字面量**：内置 9 色一律 `var(--stage-sN)`（`STAGE_BAR_COLORS`）；
 *      需要真 hex 的场合（原生 `<input type="color">` 只吃 `#rrggbb`）在**运行时**
 *      从 CSS 变量解析出来，不在源码里写死；
 *   ② **零动态类名**：不拼 `bg-[${hex}]`（BUG-05 的根因），用户色走内联 style。
 *
 * ── 自定义色为什么要「属性 + var()」成对 ──
 * 用户色的三层令牌由 T02 在运行时注入：`[data-stage-key="sc-xxx"]{ --stage-local-solid: … }`
 * （亮 / 暗 / 打印三套规则）。因此元素**必须同时**具备
 *   ① `backgroundColor: var(--stage-local-solid)`（取到令牌）
 *   ② `data-stage-key="sc-xxx"`（命中注入表的那条规则）
 * 只写 ① 而漏 ② ⇒ `var()` 解析为空 ⇒ 色块**透明**。两半件拆开写就有漏的机会，
 * 故在此合并为**单一出口** `stageColorPaint()`，让调用点没有机会只写一半。
 */

import {
  STAGE_LOCAL_SOLID_COLOR,
  STAGE_BAR_COLORS,
  stageSolidColor,
} from '../timeline/stageColors';
import { stageColorAttrs } from '../timeline/stageColorKey';
import { normalizeHex } from '../../core/color/contrast';

/* ------------------------------ 内置 9 槽 ------------------------------ */

/**
 * 调色板色号（`colorIndex` 的值域）。
 * **从权威表派生**，不另起一份字面量 —— 否则将来色板增删会两处不一致。
 */
export const SWATCH_COLOR_INDEXES: readonly number[] = Object.keys(STAGE_BAR_COLORS)
  .map(Number)
  .sort((a, b) => a - b);

/* ------------------------------ 取色出口 ------------------------------ */

/** 建档视图里的阶段最小形状（池子里的**未选项**没有 `orderIndex`，故为可选） */
export interface StageColorView {
  colorIndex?: number | null;
  customColor?: string | null;
}

/**
 * 色块 / 色点的**成对**视图输出（内联样式 ＋ 命中注入表所需的属性）。
 *
 * @param item       阶段项（只需 `colorIndex` / `customColor`）
 * @param orderIndex 该项在项目里的序号（1 起）；未落库的池中项传默认值即可 ——
 *                   T02 的取色出口在 `colorIndex` 有值时不会回落到序号，而建档项恒有 `colorIndex`。
 *
 * @returns `attrs` 在内置色时是 `{}`（铺不开任何属性），自定义色时是 `{ 'data-stage-key': 'sc-…' }`；
 *          调用点请**成对**使用：`<span {...attrs} style={style} />`。
 */
export function stageColorPaint(
  item: StageColorView,
  orderIndex = 1,
): { style: { backgroundColor: string }; attrs: Record<string, string> } {
  const colorIndex = item.colorIndex ?? 1;
  const customColor = item.customColor ?? null;
  return {
    style: { backgroundColor: stageSolidColor(orderIndex, colorIndex, customColor) },
    attrs: stageColorAttrs({ colorIndex, customColor, orderIndex }),
  };
}

/* ------------------------ 原生取色器所需的 hex ------------------------ */

/**
 * `<input type="color">` 的 `value` 只接受 `#rrggbb`，而内置色板在源码里是 CSS 变量引用。
 * 浏览器里 `getComputedStyle` 能把 `var()` 解析成 `rgb()`，这里再转成 hex；
 * jsdom / 无 CSS 环境下解析不到 → 返回 `null`，调用方回落（色块仍用 `var()` 上色，
 * 只是取色器拿不到初始值）。
 */
export function builtinSolidHex(colorIndex: number): string | null {
  const cssValue = STAGE_BAR_COLORS[colorIndex] ?? STAGE_BAR_COLORS[9];
  if (cssValue === undefined) return null;
  if (cssValue.startsWith('#')) return normalizeHex(cssValue);
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return null;
  const probe = document.createElement('div');
  probe.style.color = cssValue;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  try {
    return rgbStringToHex(getComputedStyle(probe).color);
  } catch {
    return null;
  } finally {
    probe.remove();
  }
}

/** `rgb(1, 2, 3)` / `rgba(1, 2, 3, 1)` → `#RRGGBB`；解析不了返回 `null` */
export function rgbStringToHex(value: string): string | null {
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)\s*[, ]\s*(\d+)/.exec(value.trim());
  if (!m) return null;
  const channels = [m[1], m[2], m[3]].map((s) => Math.min(255, Number(s)));
  if (channels.some((n) => !Number.isFinite(n))) return null;
  return `#${channels.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** 自定义色通路的 CSS 变量出口（供只需要背景色的调用点使用；**记得同时挂 `attrs`**） */
export { STAGE_LOCAL_SOLID_COLOR };
