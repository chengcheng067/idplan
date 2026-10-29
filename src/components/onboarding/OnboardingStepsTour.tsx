import { useState } from 'react';

import { useLang } from '../../i18n';
import { Button } from '../ui';
import {
  AgentArt,
  BackupArt,
  BoardArt,
  CalendarArt,
  MembersArt,
  PluginsArt,
  PrintArt,
  TimelineArt,
} from './OnboardingArt';

/**
 * 分步引导线（设计稿 §五）：步骤条 + 上一步/下一步 + 跳过 + 步骤内容区。
 * 8 步全部按 §五清单落地（第二批）：标题 + lead + 2~3 条亮点 + 内联 SVG 配图，
 * 文案全走消息表（parts/onboarding.ts，zh+en 成对）。
 *
 * 步进切换动画（设计稿 §八-5）：内容区按 `key={stepId}` 重挂，文案块走
 * `.onb-in-copy`（120ms 先入），插画元素 `.onb-in` + 60ms 递增延迟错峰进场，
 * 总长 ≤400ms；`prefers-reduced-motion` 由 global.css 关停。
 */

/** 步骤顺序（设计稿 §八-2 拍板：按使用频率走，顺序 A） */
const STEP_IDS = ['board', 'calendar', 'timeline', 'print', 'members', 'backup', 'agent', 'plugins'] as const;
type StepId = (typeof STEP_IDS)[number];

/** 各步插画注册表（id → 组件；与 STEP_IDS 对齐） */
const STEP_ART: Record<StepId, () => JSX.Element> = {
  board: BoardArt,
  calendar: CalendarArt,
  timeline: TimelineArt,
  print: PrintArt,
  members: MembersArt,
  backup: BackupArt,
  agent: AgentArt,
  plugins: PluginsArt,
};

/** 各步亮点键（§五：2~3 条；8 步均为 3 条）。字面量元组保证模板串可推导出精确键型 */
const HIGHLIGHT_KEYS: Record<StepId, readonly ['h1', 'h2', 'h3']> = {
  board: ['h1', 'h2', 'h3'],
  calendar: ['h1', 'h2', 'h3'],
  timeline: ['h1', 'h2', 'h3'],
  print: ['h1', 'h2', 'h3'],
  members: ['h1', 'h2', 'h3'],
  backup: ['h1', 'h2', 'h3'],
  agent: ['h1', 'h2', 'h3'],
  plugins: ['h1', 'h2', 'h3'],
};

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
  const Art = STEP_ART[stepId];

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
            <p
              className="onb-in onb-in-copy mt-3 max-w-[400px] text-sm leading-7 text-mist"
              style={{ animationDelay: '40ms' }}
            >
              {t(`onboarding.step.${stepId}.lead` as const)}
            </p>
            <ul className="mt-6 space-y-2.5" data-onboarding-step-highlights={stepId}>
              {HIGHLIGHT_KEYS[stepId].map((hKey, i) => (
                <li
                  key={hKey}
                  className="onb-in onb-in-copy flex items-start gap-2.5 text-[13px] leading-6 text-ink"
                  style={{ animationDelay: `${80 + i * 40}ms` }}
                >
                  <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-pine" aria-hidden="true" />
                  {t(`onboarding.step.${stepId}.${hKey}` as const)}
                </li>
              ))}
            </ul>
          </div>

          <div className="hidden justify-center xl:flex">
            <Art />
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
