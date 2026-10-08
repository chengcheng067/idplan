/**
 * 模板与页面下拉的「配色」截（产品决策文档 §3.2-④：一个入口，不造新浮层）。
 *
 * ── 形态 ──
 * 预设变体卡（横滑，每组三枚打包、已过灰度验收——主路径）+「自定义」卡
 * （展开三枚原生 `<input type="color">` + 实时校验 + 恢复基线）。
 * 预设卡只是「把三枚 hex 填进取色器的快捷方式」，保存形态与自定义完全一致
 * （都是三枚 hex），不引入第二套挂载路径。
 *
 * ── 硬闸门在这里的样子 ──
 * 实时显示每对比值与达标情况；任一对不达标 ⇒ **保存钮禁用** + 指明哪一对、
 * 当前比值多少。store 的 setPalette 是第二道闸（不达标一个字节都不落库，
 * 由 print-palette.spec / print-options.spec 单测锁）——UI 禁用是体验层，
 * store 拒绝是结构层，两层都在才叫「禁存，不是提示」。
 *
 * ── 经典模板为什么看不到本组件 ──
 * classic 的 token 是品牌资产（应用内/打印共用），不开放配色
 * （决策文档 §3.2 边界）。调用方对 classic 不渲染本截。
 */

import { useEffect, useState } from 'react';

import {
  PRINT_PALETTE_SLOTS,
  PRINT_PALETTE_SLOT_LABELS,
  PRINT_TEMPLATE_PALETTES,
  checkPrintPalette,
  formatContrastRatio,
  type PrintPalette,
  type PrintPaletteSlot,
} from '../../print/model/print-palette';
import { usePrintPrefsStore } from '../../store/usePrintPrefsStore';
import type { PrintTemplateId } from '../../print/model/print-view-model';

/** 开放配色的四版（classic 是品牌资产，调用方不渲染本截；类型上就堵住） */
export type PaletteSectionTemplate = Exclude<PrintTemplateId, 'classic'>;

/** input[type=color] 只吃 #rrggbb（小写）；内部统一大写 */
function colorInputValue(hex: string): string {
  return hex.toLowerCase();
}

/** 两组配色是否等值（归一化后逐槽位比） */
function samePalette(a: PrintPalette | undefined, b: PrintPalette): boolean {
  return a !== undefined && a.accent === b.accent && a.ink === b.ink && a.line === b.line;
}

export function PaletteSection({
  template,
  defaultOpen = false,
  initialPalette,
}: {
  template: PaletteSectionTemplate;
  /** 初始即展开自定义编辑器（默认收起；验收截图 / 将来自链接直达用） */
  defaultOpen?: boolean;
  /** 编辑器初始草稿（缺省 = 当前有效配色：自定义或设计师基线） */
  initialPalette?: PrintPalette;
}): JSX.Element {
  const spec = PRINT_TEMPLATE_PALETTES[template];
  const custom = usePrintPrefsStore((s) => s.palette[template]);
  const setPalette = usePrintPrefsStore((s) => s.setPalette);
  const [open, setOpen] = useState(defaultOpen);
  // 草稿：打开编辑器时从「当前有效配色」起手（自定义或基线）
  const [draft, setDraft] = useState<PrintPalette>(() => initialPalette ?? custom ?? spec.baseline);

  // 切模板 / 外部改了自定义（点预设卡）⇒ 草稿跟随，别留陈旧值
  useEffect(() => {
    setDraft(custom ?? spec.baseline);
  }, [template, custom, spec.baseline]);

  const gate = checkPrintPalette(template, draft);
  const activePreset = spec.presets.find((p) => samePalette(custom, p.palette));

  return (
    <section data-print-palette-section="" className="border-t border-line px-3 pb-3 pt-2">
      <div className="flex items-center justify-between pb-1.5">
        <span className="text-[11px] font-medium text-mist">配色（三枚受控 token）</span>
        <span className="text-[11px] text-mist">
          {custom ? (activePreset ? `预设 · ${activePreset.name}` : '自定义') : '设计师基线'}
        </span>
      </div>

      {/* 预设变体卡（主路径）：三枚打包，点选即用 */}
      <div className="flex gap-1.5 overflow-x-auto pb-1.5" role="group" aria-label="配色预设">
        {spec.presets.map((preset) => {
          const active = samePalette(custom, preset.palette);
          return (
            <button
              key={preset.id}
              type="button"
              data-print-palette-preset={preset.id}
              aria-pressed={active}
              onClick={() => setPalette(template, preset.palette)}
              title={`${preset.name}（三枚打包，已过灰度验收）`}
              className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                active ? 'border-pine bg-pine-soft text-pine' : 'border-line text-mist hover:text-ink'
              }`}
            >
              <span className="flex gap-0.5" aria-hidden>
                <span className="h-3 w-3 rounded-sm border border-line" style={{ background: preset.palette.accent }} />
                <span className="h-3 w-3 rounded-sm border border-line" style={{ background: preset.palette.ink }} />
                <span className="h-3 w-3 rounded-sm border border-line" style={{ background: preset.palette.line }} />
              </span>
              {preset.name}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-print-palette-custom-toggle=""
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-line px-2 py-1 text-[11px] text-mist transition-colors hover:text-ink"
        >
          {open ? '收起自定义' : '自定义'}
        </button>
        {custom && (
          <button
            type="button"
            data-print-palette-reset=""
            onClick={() => setPalette(template, null)}
            className="rounded-md px-2 py-1 text-[11px] text-mist transition-colors hover:text-ink"
          >
            恢复基线
          </button>
        )}
      </div>

      {/* 自定义编辑器：三枚取色器 + 实时闸门 + 禁存提示 */}
      {open && (
        <div data-print-palette-editor="" className="mt-2 flex flex-col gap-2">
          {PRINT_PALETTE_SLOTS.map((slot: PrintPaletteSlot) => (
            <label key={slot} className="flex items-center gap-2 text-[11px] text-ink">
              <span className="w-12 shrink-0 text-mist">{PRINT_PALETTE_SLOT_LABELS[slot]}</span>
              <input
                type="color"
                data-print-palette-input={slot}
                value={colorInputValue(draft[slot])}
                onChange={(e) => setDraft((d) => ({ ...d, [slot]: e.target.value.toUpperCase() }))}
                className="h-6 w-10 shrink-0 cursor-pointer rounded border border-line bg-transparent p-0"
              />
              <span className="swiss-num w-16 shrink-0 tabular-nums text-mist">{draft[slot]}</span>
            </label>
          ))}

          {/* 实时闸门：每对比值 + 达标情况 */}
          <ul className="flex flex-col gap-0.5">
            {gate.pairs.map((pair) => (
              <li
                key={pair.label}
                data-print-palette-pair={pair.a === 'paper' || pair.b === 'paper' ? `${pair.a}-${pair.b}` : pair.label}
                data-pass={pair.pass || undefined}
                className={`flex items-center justify-between text-[11px] ${
                  pair.pass ? 'text-mist' : 'font-medium text-clay'
                }`}
              >
                <span>{pair.label}</span>
                <span className="tabular-nums">
                  {formatContrastRatio(pair.ratio)} / 需 ≥{pair.min}:1 {pair.pass ? '✓' : '✗'}
                </span>
              </li>
            ))}
          </ul>

          {/* 禁存提示：指名哪一对、当前比值多少（硬阻断，不许打折成泛泛一句） */}
          {!gate.ok && (
            <p data-print-palette-blocked="" className="text-[11px] leading-relaxed text-clay">
              {gate.message}
            </p>
          )}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              data-print-palette-save=""
              disabled={!gate.ok}
              onClick={() => setPalette(template, draft)}
              className="rounded-md bg-pine px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-pine-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              保存自定义
            </button>
            {!gate.ok && <span className="text-[11px] text-mist">达标后才可保存</span>}
          </div>
        </div>
      )}
    </section>
  );
}
