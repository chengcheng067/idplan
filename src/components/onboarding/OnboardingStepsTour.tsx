import { useState } from 'react';

import { useLang } from '../../i18n';
import { Button } from '../ui';
import { BoardArt, StepArtPlaceholder } from './OnboardingArt';

/**
 * 分步引导线（设计稿 §五）：步骤条 + 上一步/下一步 + 跳过 + 步骤内容区。
 *
 * ★ 竖切样板（第一批）：8 步的**顺序与标题**已按设计稿 §五清单全部注册
 * （步骤条/进度按 8 步计），但**只有第 1 步「看板」有完整内容**；
 * 第 2~8 步暂渲染中性占位（明确说「正在准备中」，不假装有内容）——
 * 这是本批的已知缺口，第二批补齐内容后把占位分支换掉即可，壳不动。
 *
 * 步进切换动画（设计稿 §八-5）：内容区按 `key={stepId}` 重挂，文案块走
 * `.onb-in-copy`（120ms 先入），插画元素 `.onb-in` + 60ms 递增延迟错峰进场，
 * 总长 ≤400ms；`prefers-reduced-motion` 由 global.css 关停。
 */
/** 步骤顺序（设计稿 §八-2 拍板：按使用频率走，顺序 A） */
const STEP_IDS = ['board', 'calendar', 'timeline', 'print', 'members', 'backup', 'agent', 'plugins'] as const;
type StepId = (typeof STEP_IDS)[number];

export interface OnboardingStepsTourProps {
  onFinish: () => void;
  onSkip: () => void;
}

export function OnboardingStepsTour({ onFinish, onSkip }: OnboardingStepsTourProps): JSX.Element {
  const { t } = useLang();
  const [index, setIndex] = useState(0);
  const stepId: StepId = STEP_IDS[index]!;
  const total = STEP_IDS.length;
  const isFirst = index === 0;
  const isLast = index === total - 1;

  const goNext = (): void => {
    if (isLast) onFinish();
    else setIndex((i) => i + 1);
  };
  const goPrev = (): void => {
    if (!isFirst) setIndex((i) => i - 1);
  };

  return (
    <div data-onboarding-screen="steps" className="mx-auto flex min-h-full w-full max-w-[900px] flex-col px-6 py-10">
      {/* 头部：标题 + 跳过（随时可以跳过） */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-medium text-ink">{t('onboarding.steps.heading')}</h1>
        <Button variant="ghost" size="sm" onClick={onSkip} data-onboarding-skip="">
          {t('onboarding.steps.skip')}
        </Button>
      </div>

      {/* 步骤条：8 段 + 进度文案 */}
      <div className="mt-6 flex items-center gap-3">
        <div className="flex flex-1 items-center gap-1.5">
          {STEP_IDS.map((id, i) => (
            <span
              key={id}
              data-onboarding-step-dot={i + 1}
              aria-hidden="true"
              className={`h-1.5 flex-1 rounded-full transition-colors duration-fast ${
                i < index ? 'bg-pine/50' : i === index ? 'bg-pine' : 'bg-line'
              }`}
            />
          ))}
        </div>
        <span className="shrink-0 text-xs text-mist">
          {t('onboarding.steps.progress', { current: index + 1, total })}
        </span>
      </div>

      {/* 内容区：key 重挂触发步进动画 */}
      <div className="flex flex-1 items-center">
        <div key={stepId} className="grid w-full items-center gap-10 py-8 xl:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="onb-in-copy onb-in font-display text-xl font-medium text-ink">
              {t(`onboarding.step.${stepId}.title` as const)}
            </h2>
            {stepId === 'board' ? (
              <>
                <p className="onb-in onb-in-copy mt-3 max-w-[400px] text-sm leading-7 text-mist" style={{ animationDelay: '40ms' }}>
                  {t('onboarding.step.board.lead')}
                </p>
                <ul className="mt-6 space-y-2.5">
                  {(['h1', 'h2', 'h3'] as const).map((k, i) => (
                    <li
                      key={k}
                      className="onb-in onb-in-copy flex items-start gap-2.5 text-[13px] leading-6 text-ink"
                      style={{ animationDelay: `${80 + i * 40}ms` }}
                    >
                      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-pine" aria-hidden="true" />
                      {t(`onboarding.step.board.${k}` as const)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="onb-in onb-in-copy mt-3 max-w-[400px] text-sm leading-7 text-mist" style={{ animationDelay: '40ms' }}>
                {t('onboarding.step.placeholder.lead')}
                <br />
                {t('onboarding.step.placeholder.tail')}
              </p>
            )}
          </div>

          <div className="hidden justify-center xl:flex">
            {stepId === 'board' ? <BoardArt /> : <StepArtPlaceholder />}
          </div>
        </div>
      </div>

      {/* 底部：上一步 / 下一步（最后一步进完成页） */}
      <div className="flex items-center justify-end gap-3 border-t border-line pt-5">
        <Button variant="secondary" onClick={goPrev} disabled={isFirst} data-onboarding-prev="">
          {t('onboarding.steps.prev')}
        </Button>
        <Button onClick={goNext} data-onboarding-next="">
          {t('onboarding.steps.next')}
        </Button>
      </div>

      {/* 单测定位锚：当前步骤内容（步骤文案与插画都挂它下面） */}
      <span className="hidden" data-onboarding-step-content={stepId} />
    </div>
  );
}
