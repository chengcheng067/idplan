import { Check } from 'lucide-react';

import { useLang } from '../../i18n';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import { Button } from '../ui';

/**
 * 完成页（设计稿 §五）：「你已了解 ID Plan 的核心功能」+ 两个出口。
 *
 * 「新建第一个项目」拉起现有建档向导（ManualFallbackForm，§八-4 拍板的 A 方案）
 * —— 按 2026-10-27 建档 CTA 收口口径，**非管理员不渲染建档入口**（侧栏/空态同款），
 * 此时只剩「先随便看看」一条出路；两个出口都写 `onboarding.done`。
 */
export interface OnboardingFinishProps {
  onNewProject: () => void;
  onLookAround: () => void;
}

export function OnboardingFinish({ onNewProject, onLookAround }: OnboardingFinishProps): JSX.Element {
  const { t } = useLang();
  const { isAdmin } = useRoleGuard();

  return (
    <div
      data-onboarding-screen="finish"
      className="flex min-h-full items-center justify-center p-6"
    >
      <div className="onb-in w-full max-w-md rounded-2xl border border-line bg-paper p-10 text-center shadow-[var(--shadow-raised)]">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-pine-soft text-pine">
          <Check size={22} aria-hidden />
        </div>
        <h1 className="font-display text-xl font-medium text-ink">{t('onboarding.finish.title')}</h1>
        <p className="mt-2 text-[13px] leading-6 text-mist">{t('onboarding.finish.lead')}</p>

        <div className="mt-8 flex flex-col items-center gap-3">
          {/* 建档 CTA 只给管理员（2026-10-27 收口：非管理员不渲染建档入口） */}
          {isAdmin && (
            <Button size="lg" onClick={onNewProject} data-onboarding-finish-new-project="">
              {t('onboarding.finish.newProject')}
            </Button>
          )}
          <Button
            size="lg"
            variant={isAdmin ? 'secondary' : 'primary'}
            onClick={onLookAround}
            data-onboarding-finish-look-around=""
          >
            {t('onboarding.finish.lookAround')}
          </Button>
        </div>
      </div>
    </div>
  );
}
