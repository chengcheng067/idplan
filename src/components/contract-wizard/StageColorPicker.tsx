/**
 * 阶段取色器（v0.8 · 建档）：调色板 ＋ 原生取色器 ＋ 校验提示。
 *
 * ── 两段式语义（与数据模型一一对应，不要混为一谈） ──
 *   · **调色板**（9 个内置色号）→ 写 `Stage.colorIndex`，`customColor = null`；
 *   · **取色器**（用户任意色）→ 写 `Stage.customColor = '#RRGGBB'`，`colorIndex` 保持不变。
 * 之所以分成两个字段而不是「一律存 hex」：内置色在亮/暗/打印三态各有一套已定稿的
 * 手工调校值（`global.css` 的 `--stage-*`），把它们退化成 hex 会丢掉暗色与打印变体。
 *
 * ── 为什么用原生 `<input type="color">` 而不是第三方 picker ──
 * D3 的要求是「必须真提供取色器」；原生控件即满足，且**零新增运行时依赖**
 * （设计 §2.1 明确不引 `react-colorful` 一类包）。
 *
 * ── 零 hex、零动态类名（v0.8 铁律） ──
 * 源码里不出现任何 hex 字面量、不拼 `bg-[${hex}]` 动态类名；用户色走**内联 style ＋
 * `data-stage-key`**（令牌由 T02 的运行时注入表提供），内置色走 `var(--stage-sN)`。
 * 取色器需要 `#rrggbb` 时在**运行时**从 CSS 变量解析（`stage-color-bridge.builtinSolidHex`）。
 *
 * ── 校验（PRD A12①） ──
 * 「提示但不阻断」：警告文案一律来自 T02 的 `deriveAndValidate`（四码冻结），
 * 本组件**不自造**警告码、也不自算对比度。
 */

import { useMemo } from 'react';

import { CircleOff, Pipette } from 'lucide-react';

import {
  stageBandColor,
  stageBandInkColor,
  stageSolidColor,
} from '../timeline/stageColors';
import { stageColorAttrs } from '../timeline/stageColorKey';
import { normalizeHex } from '../../core/color/contrast';
import { deriveAndValidate } from '../../core/color/derive-stage-colors';
import { SWATCH_COLOR_INDEXES, builtinSolidHex } from './stage-color-bridge';

/** 9 个内置色全部被占用时的建议文案（PRD A10 ②：措辞是「建议自定义一个颜色」，不是「色板已用尽」） */
export const BUILTIN_COLORS_EXHAUSTED_HINT = '已用 9 个内置色，建议自定义一个颜色以便区分';

/** 取色器的受控值：内置色号与自定义主色**互斥**（后者优先） */
export interface StageColorValue {
  customColor: string | null;
  colorIndex: number;
}

export function StageColorPicker({
  value,
  onChange,
  builtinExhausted = false,
  testId = 'stage-color-picker',
}: {
  value: StageColorValue;
  onChange(next: StageColorValue): void;
  /** 已选阶段的 9 个内置色号全被占用 → 显示建议自定义色的非阻塞提示 */
  builtinExhausted?: boolean;
  testId?: string;
}): JSX.Element {
  const { customColor, colorIndex } = value;

  // 校验提示：一律取 T02 的派生结果（含「非法主色 ⇒ unresolvable」这一码）
  const warnings = useMemo(
    () => (customColor ? deriveAndValidate(customColor).warnings : []),
    [customColor],
  );

  // 预览：走与全站同一套取色出口 —— 自定义色给 var(--stage-local-*)，内置色给 var(--stage-band-sN)
  const preview = useMemo(
    () => ({
      background: stageBandColor(1, colorIndex, customColor),
      color: stageBandInkColor(1, colorIndex, customColor),
    }),
    [colorIndex, customColor],
  );
  // 自定义色时**必须**同时挂上 data-stage-key，否则上面的 var() 解析为空 ⇒ 预览变透明
  const previewAttrs = useMemo(
    () => stageColorAttrs({ customColor, colorIndex, orderIndex: 1 }),
    [customColor, colorIndex],
  );

  /** 原生取色器只吃 `#rrggbb`：自定义色优先，否则运行时解析当前内置色（解析不到则留空） */
  const pickerValue = customColor ?? builtinSolidHex(colorIndex) ?? '';

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-mist">阶段颜色</span>

        {/* 调色板：内置 9 色（点选 = 用内置色号，清掉自定义色） */}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="内置色板">
          {SWATCH_COLOR_INDEXES.map((index) => {
            const active = customColor === null && colorIndex === index;
            return (
              <button
                key={index}
                type="button"
                aria-label={`调色板 ${index}`}
                aria-pressed={active}
                onClick={() => onChange({ customColor: null, colorIndex: index })}
                style={{ backgroundColor: stageSolidColor(index, index) }}
                className={`h-5 w-5 rounded-full border transition-transform ${
                  active ? 'border-ink ring-2 ring-pine/60' : 'border-line hover:scale-110'
                }`}
              />
            );
          })}
        </div>

        {/* 取色器：任意主色（原生控件） */}
        <label className="inline-flex items-center gap-1 rounded-md border border-line bg-cream px-1.5 py-0.5">
          <Pipette size={13} className="text-mist" aria-hidden />
          <input
            type="color"
            aria-label="取色器"
            value={pickerValue}
            onChange={(e) => {
              // 脏值丢弃：原生控件正常只吐 `#rrggbb`，此处是**防御**（程序化赋值 / 异常实现）。
              // 注意不能省成 `e.target.value` 直传 —— 那会把未归一的串写进用户数据。
              const next = normalizeHex(e.target.value);
              if (next === null) return;
              onChange({ customColor: next, colorIndex });
            }}
            className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>

        {/* 清除自定义色 → 回到内置色板 */}
        {customColor !== null && (
          <button
            type="button"
            aria-label="取消自定义颜色"
            onClick={() => onChange({ customColor: null, colorIndex })}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-cream px-1.5 py-0.5 text-xs text-mist hover:bg-sand"
          >
            <CircleOff size={13} aria-hidden /> 用内置色
          </button>
        )}

        {/* 预览：色带 + 面内字（token 与 aria 属性成对，见 previewAttrs 注释） */}
        <span
          {...previewAttrs}
          data-testid={`${testId}-preview`}
          style={preview}
          className="rounded px-2 py-0.5 text-xs"
        >
          示例文字
        </span>
      </div>

      {/* 校验提示（非阻塞：只提示，不挡提交） */}
      {warnings.length > 0 && (
        <ul data-testid={`${testId}-warnings`} className="space-y-0.5">
          {warnings.map((w) => (
            <li key={w.code} className="text-[11px] leading-4 text-clay">
              {w.message}
            </li>
          ))}
        </ul>
      )}

      {/* 9 个内置色用尽 → 建议自定义色（A10 ②，措辞与「色板已用尽」区分开） */}
      {builtinExhausted && (
        <p data-testid={`${testId}-exhausted`} className="text-[11px] leading-4 text-mist">
          {BUILTIN_COLORS_EXHAUSTED_HINT}
        </p>
      )}
    </div>
  );
}
