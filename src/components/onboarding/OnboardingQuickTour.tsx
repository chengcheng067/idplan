import { CalendarDays, DatabaseBackup, Kanban, Printer, Sparkles, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useLang } from '../../i18n';
import { Button } from '../ui';

/**
 * 简单介绍线（设计稿 §四）：单屏 6 卡（2×3，窄窗自动换行）+ 底部双按钮。
 * 卡片文案 = §四表格逐字落键；看完「开始使用」写 onboarding.done；
 * 「改看详细引导」切线（不丢进度——进度本来就只在这一个 done 键上）。
 */
export interface OnboardingQuickTourProps {
  onStart: () => void;
  onSwitchToSteps: () => void;
}

interface FeatureCard {
  icon: LucideIcon;
  titleKey: 'onboarding.feature.board.title' | 'onboarding.feature.calendar.title' | 'onboarding.feature.print.title' | 'onboarding.feature.members.title' | 'onboarding.feature.backup.title' | 'onboarding.feature.agent.title';
  descKey: 'onboarding.feature.board.desc' | 'onboarding.feature.calendar.desc' | 'onboarding.feature.print.desc' | 'onboarding.feature.members.desc' | 'onboarding.feature.backup.desc' | 'onboarding.feature.agent.desc';
  hook: string;
}

const CARDS: FeatureCard[] = [
  { icon: Kanban, titleKey: 'onboarding.feature.board.title', descKey: 'onboarding.feature.board.desc', hook: 'board' },
  { icon: CalendarDays, titleKey: 'onboarding.feature.calendar.title', descKey: 'onboarding.feature.calendar.desc', hook: 'calendar' },
  { icon: Printer, titleKey: 'onboarding.feature.print.title', descKey: 'onboarding.feature.print.desc', hook: 'print' },
  { icon: Users, titleKey: 'onboarding.feature.members.title', descKey: 'onboarding.feature.members.desc', hook: 'members' },
  { icon: DatabaseBackup, titleKey: 'onboarding.feature.backup.title', descKey: 'onboarding.feature.backup.desc', hook: 'backup' },
  { icon: Sparkles, titleKey: 'onboarding.feature.agent.title', descKey: 'onboarding.feature.agent.desc', hook: 'agent' },
];

export function OnboardingQuickTour({ onStart, onSwitchToSteps }: OnboardingQuickTourProps): JSX.Element {
  const { t } = useLang();

  return (
    <div data-onboarding-screen="quick" className="mx-auto w-full max-w-[880px] px-6 py-12">
      <h1 className="font-display text-2xl font-medium text-ink">{t('onboarding.quick.heading')}</h1>
      <p className="mt-1.5 text-sm text-mist">{t('onboarding.quick.lead')}</p>

      {/* 6 卡 2×3（<sm 单列；窄窗自动换行是设计稿 §四的明列要求） */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map(({ icon: Icon, titleKey, descKey, hook }) => (
          <div
            key={hook}
            data-onboarding-feature={hook}
            className="rounded-xl border border-line bg-paper p-5"
          >
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-pine-soft text-pine">
              <Icon size={18} aria-hidden />
            </div>
            <h2 className="text-sm font-medium text-ink">{t(titleKey)}</h2>
            <p className="mt-1 text-xs leading-relaxed text-mist">{t(descKey)}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={onStart} data-onboarding-quick-start="">
          {t('onboarding.quick.start')}
        </Button>
        <Button size="lg" variant="secondary" onClick={onSwitchToSteps} data-onboarding-quick-switch="">
          {t('onboarding.quick.switch')}
        </Button>
      </div>
    </div>
  );
}
