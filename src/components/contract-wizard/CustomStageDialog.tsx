/**
 * 自定义阶段弹窗（v0.8 · A8：名称必填 / 占比可选 / 颜色可选）。
 *
 * ── 上下文约束：仅建档时可新增（TBD-1 覆盖 PRD A8） ──
 * 本弹窗由建档路径（向导 / 手动兜底）挂载；「建档后增删阶段」归 P1。
 *
 * ── 落库口径（不在本组件里实现，但在这里显式告知用户） ──
 *   · `Stage.templateKey === null` —— 禁止伪造模板 key（N4：`getStageLibraryItem(未知key)` **抛错**）；
 *   · `Stage.customColor` ＝ 取色器选的主色（未选 → null，用内置色号）；
 *   · 落列不崩：`templateKey=null` 时由 `stage-resolve` 按 `orderIndex` 均分到看板列。
 *
 * ── 重名校验（A9） ──
 * 同项目内阶段名不可重复（Agent 通道**按名选点** `?stageName=`，重名会让落点歧义）。
 * 本弹窗行内提示 + 阻止提交；`project.service` 落库前还有一道同样的闸门（双保险）。
 */

import { useEffect, useMemo, useState } from 'react';

import { X } from 'lucide-react';

import { Modal } from '../common/Modal';
import { ImeInput } from '../common/ImeInput';
/* ★ i18n 笔 misc：render 期取词走 `useLang()` 的 `t`（订阅语言变化）。 */
import { useLang } from '../../i18n';
import { StageColorPicker, type StageColorValue } from './StageColorPicker';

/** 弹窗产出（父组件据此落库 / 记入复用库，本组件不碰仓储） */
export interface CustomStageDraft {
  name: string;
  ratioPercent: number | null;
  customColor: string | null;
  colorIndex: number;
}

/** 重名判定（trim 后完全相同即视为重名；空名不算重名，由「名称必填」单独管） */
export function isDuplicateStageName(
  name: string,
  existingNames: readonly string[],
): boolean {
  const trimmed = name.trim();
  if (trimmed === '') return false;
  return existingNames.some((n) => n.trim() === trimmed);
}

export function CustomStageDialog({
  open,
  onClose,
  onSubmit,
  existingNames,
  defaultRatioPercent,
  defaultColorIndex,
  builtinExhausted = false,
}: {
  open: boolean;
  onClose(): void;
  onSubmit(draft: CustomStageDraft): void;
  /** 当前项目里已存在的阶段名（含模板阶段与已加的自定义阶段）——用于行内重名提示 */
  existingNames: readonly string[];
  /** 未填占比时的建议值（父组件给「已选阶段占比的平均值」） */
  defaultRatioPercent?: number;
  /** 默认内置色号（父组件给「第一个未被占用的内置色」） */
  defaultColorIndex?: number;
  /** 9 个内置色已全部占用 → 建议自定义颜色（A10 ②） */
  builtinExhausted?: boolean;
}): JSX.Element | null {
  /** 取词 + 语言变化订阅点（**必须在 `if (!open) return null` 之前**） */
  const { t } = useLang();
  const [name, setName] = useState('');
  const [ratioText, setRatioText] = useState('');
  const [color, setColor] = useState<StageColorValue>({
    customColor: null,
    colorIndex: defaultColorIndex ?? 1,
  });
  /** 提交过才显示「名称为空」提示（避免一打开就红一片） */
  const [submitted, setSubmitted] = useState(false);

  // 每次打开重置表单：上一次的残留值会让用户误以为「已经填好了」
  useEffect(() => {
    if (!open) return;
    setName('');
    setRatioText('');
    setColor({ customColor: null, colorIndex: defaultColorIndex ?? 1 });
    setSubmitted(false);
  }, [open, defaultColorIndex]);

  const duplicate = useMemo(() => isDuplicateStageName(name, existingNames), [name, existingNames]);
  const nameEmpty = name.trim() === '';
  const hasError = nameEmpty || duplicate;

  if (!open) return null;

  const submit = (): void => {
    setSubmitted(true);
    if (hasError) return;
    const parsedRatio = Number(ratioText.trim());
    const ratioPercent =
      ratioText.trim() !== '' && Number.isFinite(parsedRatio) && parsedRatio > 0
        ? parsedRatio
        : null;
    onSubmit({
      name: name.trim(),
      ratioPercent,
      customColor: color.customColor,
      colorIndex: color.colorIndex,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} ariaLabel={t('wizard.addCustomStageAria')}>
      <div className="glass-strong iridescent-border dialog-pop flex w-full max-w-md flex-col rounded-2xl shadow-soft">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-display-md">{t('wizard.addCustomStageAria')}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('wizard.cancelAddCustomStageAria')}
              className="rounded-md p-1 text-mist hover:bg-sand"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t('wizard.fieldStageName')}</span>
              <ImeInput
                value={name}
                aria-label={t('wizard.customStageNameAria')}
                // ★ 语言无关定位钩子（i18n 笔 misc 同批）：aria 已走消息表，
                //   英文态取值变了 ⇒ `[aria-label="自定义阶段名称"]` 会静默失配。
                data-custom-stage-name=""
                onChange={(e) => setName(e.target.value)}
                placeholder={t('wizard.customStageNamePlaceholder')}
                className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
              />
            </label>

            {/* 行内校验提示（A9）：重名 / 空名都阻止提交 */}
            {submitted && nameEmpty && (
              <p data-testid="custom-stage-name-error" className="text-sm leading-6 text-clay">
                {t('wizard.errStageNameRequired')}
              </p>
            )}
            {duplicate && (
              <p data-testid="custom-stage-duplicate-error" className="text-sm leading-6 text-clay">
                {t('wizard.errDuplicateName', { name: name.trim() })}
              </p>
            )}

            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t('wizard.fieldRatio')}</span>
              <ImeInput
                value={ratioText}
                aria-label={t('wizard.ratioAria')}
                inputMode="numeric"
                placeholder={
                  defaultRatioPercent !== undefined
                    ? t('wizard.ratioPlaceholderAvg', { percent: defaultRatioPercent })
                    : t('wizard.ratioPlaceholder')
                }
                onChange={(e) => setRatioText(e.target.value)}
                className="w-full rounded-md border border-line bg-cream px-2 py-1.5 text-sm text-ink outline-none focus:border-pine"
              />
            </label>

            <StageColorPicker
              value={color}
              onChange={setColor}
              builtinExhausted={builtinExhausted}
              testId="custom-stage-color"
            />

            <p className="rounded-md border border-line bg-cream/50 p-2 text-[11px] leading-4 text-mist">
              {t('wizard.customStageNotice')}
            </p>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line bg-cream px-3 py-1.5 text-sm text-ink hover:bg-sand"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              aria-label={t('wizard.confirmAddCustomStageAria')}
              /*
               * 用 `aria-disabled` 而不是原生 `disabled`：
               *   ① 原生 disabled 的按钮**不派发 click**，于是 `submitted && nameEmpty`
               *      那条行内提示永远渲染不出来 —— 用户只看到一个变灰的按钮，
               *      却读不到「为什么不能提交」（A8「行内提示」于是成了死代码）；
               *   ② aria-disabled 保留「不可用」语义与置灰外观，同时仍可聚焦、仍可点击，
               *      点击即给出原因，也便于说明性文案被读屏播报。
               * 「阻止提交」仍由 `submit()` 内的 `hasError` 早返保证（真正的闸门）。
               */
              aria-disabled={hasError}
              onClick={submit}
              className={`rounded-md px-4 py-1.5 text-sm text-white ${
                hasError
                  ? 'cursor-not-allowed bg-pine opacity-40'
                  : 'bg-pine hover:bg-pine-deep'
              }`}
            >
              {t('wizard.add')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
