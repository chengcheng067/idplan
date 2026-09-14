/**
 * 自定义色的**稳定 key**（v0.8 · T02）—— 组件侧的薄适配层。
 *
 * 为什么不把这一层直接写进组件里：
 *   · key 必须是**纯数据**（`sc-<hash36>`），不能是 hex（`#` 不是合法标识符字符）、
 *     更不能是"动态拼出来的 Tailwind 类名"（BUG-05：Tailwind 是静态文本扫描，
 *     模板字符串拼出的类名**一条 CSS 都不会生成**，tsc 与 jsdom 都发现不了）；
 *   · 同一主色必须永远得到同一个 key（memo ⇒ 不重复派生、不重复插入 `<style>`）；
 *   · 组件只需要三件事：属性名、key、以及"内置色返回 null"的明确信号。
 *
 * 唯一实现落在 `src/core/color/custom-color-registry.ts`（本文件只做转出与组件友好封装，
 * 保证 key 的算法**只有一处**）。
 */

import {
  STAGE_COLOR_KEY_ATTR,
  STAGE_COLOR_KEY_PREFIX,
  stageColorAttr,
  stageColorKey as hashStageColorKey,
} from '../../core/color/custom-color-registry';
import type { Stage } from '../../core/types/entities';

export { STAGE_COLOR_KEY_ATTR, STAGE_COLOR_KEY_PREFIX };

/** 阶段上的自定义色字段（`null` = 用内置 9 色） */
export type StageColorSource = Pick<Stage, 'customColor' | 'colorIndex' | 'orderIndex'>;

/**
 * 主色 → 稳定 key（纯函数；非法输入返回 `null`）。
 * 只算 key，**不注册**（需要注入 CSS 时请用 `stageColorKeyOf`）。
 */
export function stageColorKey(mainHex: string): string | null {
  return hashStageColorKey(mainHex);
}

/**
 * 阶段 → 稳定 key；**内置色（`customColor` 为 null / 非法）返回 `null`**。
 * 副作用：首次见到该主色时会注册并重建运行时注入表（幂等、按主色记忆化）。
 */
export function stageColorKeyOf(stage: StageColorSource): string | null {
  return stageColorAttr(stage);
}

/** 该阶段是否走自定义色通路（组件据此决定"挂属性 + var()" 还是"Tailwind 静态类"） */
export function isCustomStageColor(stage: StageColorSource): boolean {
  return stageColorAttr(stage) !== null;
}

/**
 * 直接铺开到 JSX 的属性对象：`{ 'data-stage-key': 'sc-xxx' }`；内置色返回 `{}`。
 * 用法：`<rect {...stageColorAttrs(stage)} fill={stageBandColor(...)} />`
 */
export function stageColorAttrs(stage: StageColorSource): Record<string, string> {
  const key = stageColorAttr(stage);
  return key === null ? {} : { [STAGE_COLOR_KEY_ATTR]: key };
}
