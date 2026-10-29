import { useLang } from '../../i18n';

/**
 * 欢迎页右侧装饰插画（第一屏 · 简化版）。
 *
 * 设计稿 §八-3 拍板：插画 = 内联 SVG，词汇全部取自软件自身（看板轨道、任务卡、
 * 阶段胶囊、进度条、今天胶囊），贴 token、亮暗自动跟随。本批为竖切样板，先用
 * 打样稿 A（deliverables/onboarding-welcome-sample-A.html）的**简化版**——
 * 排版与元素语言与打样稿一致，色值全部换成 `--color-*` / `--*-rgb` token
 * （这两个族本就是「供内联 SVG 使用」的兼容旧名，见 global.css 注释），
 * 暗色主题由 token 翻转自动接管。完整插画第二批补。
 */
export function WelcomeArt(): JSX.Element {
  return (
    <svg
      viewBox="0 0 320 560"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
    >
      {/* 环境几何：品牌浅晕 + 休息日灰 */}
      <circle cx="290" cy="70" r="110" fill="rgb(var(--pine-rgb) / 0.10)" />
      <circle cx="30" cy="470" r="90" fill="var(--color-rest-day)" />

      {/* 三条看板轨道 */}
      <rect x="42" y="120" width="72" height="300" rx="10" fill="var(--color-paper)" stroke="var(--color-line)" />
      <rect x="128" y="120" width="72" height="300" rx="10" fill="var(--color-paper)" stroke="var(--color-line)" />
      <rect x="214" y="120" width="72" height="300" rx="10" fill="var(--color-paper)" stroke="var(--color-line)" />

      {/* 轨道内的占位行 */}
      <rect x="54" y="138" width="44" height="7" rx="3.5" fill="var(--color-line)" />
      <rect x="54" y="156" width="30" height="7" rx="3.5" fill="var(--color-rest-day)" />

      {/* 轨道进度条 */}
      <rect x="54" y="300" width="48" height="6" rx="3" fill="var(--color-line)" />
      <rect x="54" y="300" width="18" height="6" rx="3" fill="rgb(var(--pine-rgb))" />

      {/* 悬浮任务卡（品牌色主卡，微倾） */}
      <g transform="rotate(-4 128 210)">
        <rect x="96" y="182" width="86" height="58" rx="9" fill="rgb(var(--pine-rgb))" />
        <rect x="108" y="196" width="48" height="6" rx="3" fill="#ffffff" opacity=".9" />
        <rect x="108" y="210" width="60" height="5" rx="2.5" fill="#ffffff" opacity=".55" />
        <circle cx="170" cy="228" r="7" fill="#ffffff" opacity=".85" />
      </g>

      {/* 阶段胶囊：完成 / 临期 / 进行（moss / amber / pine 三 token 族） */}
      <rect x="140" y="176" width="40" height="16" rx="8" fill="rgb(var(--moss-soft-rgb))" />
      <rect x="140" y="176" width="40" height="16" rx="8" fill="none" stroke="rgb(var(--moss-rgb))" />
      <rect x="228" y="252" width="36" height="16" rx="8" fill="rgb(var(--amber-soft-rgb))" />
      <rect x="228" y="252" width="36" height="16" rx="8" fill="none" stroke="rgb(var(--amber-rgb))" />
      <rect x="228" y="330" width="44" height="16" rx="8" fill="rgb(var(--pine-soft-rgb))" />
      <rect x="228" y="330" width="44" height="16" rx="8" fill="none" stroke="rgb(var(--pine-rgb))" />

      {/* 月历色点 + 今天胶囊 */}
      <g>
        <circle cx="70" cy="470" r="5" fill="rgb(var(--pine-rgb))" />
        <rect x="84" y="466" width="56" height="8" rx="4" fill="var(--color-line)" />
        <circle cx="70" cy="494" r="5" fill="rgb(var(--moss-rgb))" />
        <rect x="84" y="490" width="44" height="8" rx="4" fill="var(--color-line)" />
        <circle cx="70" cy="518" r="5" fill="none" stroke="rgb(var(--pine-rgb))" strokeWidth="1.5" />
        <rect x="84" y="514" width="50" height="8" rx="4" fill="var(--color-line)" />
      </g>
      <rect x="196" y="486" width="52" height="22" rx="11" fill="rgb(var(--pine-soft-rgb))" />
      <rect x="196" y="486" width="52" height="22" rx="11" fill="none" stroke="rgb(var(--pine-rgb))" />
      <rect x="210" y="494" width="24" height="6" rx="3" fill="rgb(var(--pine-rgb))" />
    </svg>
  );
}

/** 欢迎页第一屏（设计稿 §三）：标题 + 一句话定位 + 两张对等模式卡 + 底部小字。 */
export interface OnboardingWelcomeProps {
  onChooseMode: (mode: 'quick' | 'steps') => void;
}

export function OnboardingWelcome({ onChooseMode }: OnboardingWelcomeProps): JSX.Element {
  const { t } = useLang();

  return (
    <div
      data-onboarding-screen="welcome"
      className="flex min-h-full items-center justify-center p-5 xl:p-10"
    >
      <div className="grid w-full max-w-[1060px] grid-cols-1 overflow-hidden rounded-2xl border border-line bg-paper shadow-[var(--shadow-raised-lg)] xl:grid-cols-[1fr_320px]">
        {/* 左：文案与选模式（打样稿 A 的排版：eyebrow / 大标题 / tagline / 双卡 / 小字） */}
        <div className="px-7 pb-10 pt-12 sm:px-10 xl:px-14">
          <div className="mb-5 flex items-center gap-2.5">
            <div className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-pine text-[12px] font-medium text-white">
              ID
            </div>
            <span className="text-[13px] font-medium text-ink">ID Plan</span>
            <span className="rounded-md bg-pine-soft px-[7px] py-0.5 text-[10px] text-pine">Beta</span>
          </div>

          <h1 className="mb-2.5 font-display text-[28px] font-medium tracking-[0.01em] text-ink xl:text-[30px]">
            {t('onboarding.welcome.title')}
          </h1>
          <p className="mb-11 max-w-[420px] text-sm leading-7 text-mist">
            {t('onboarding.welcome.tagline')}
            <br />
            {t('onboarding.welcome.tagline2')}
          </p>

          {/* 两张对等卡片（不搞主次；hover 轻提示可点）。
              data 钩子显式写两枚（i18n 批的口径：独立值，不共用一个匹配集） */}
          <div className="mb-9 grid gap-[18px] sm:grid-cols-2">
            <button
              type="button"
              data-onboarding-mode-quick=""
              onClick={() => onChooseMode('quick')}
              className="rounded-xl border border-line bg-paper px-5 pb-[18px] pt-[22px] text-left transition-colors hover:border-pine hover:bg-pine-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
            >
              <h2 className="mb-[7px] flex items-center gap-2 text-base font-medium text-ink">
                {t('onboarding.mode.quick.title')}
                {' '}
                <span className="rounded-md bg-pine-soft px-2 py-0.5 text-[11px] font-normal text-pine">
                  {t('onboarding.mode.quick.eta')}
                </span>
              </h2>
              <p className="text-[12.5px] leading-[1.7] text-mist">{t('onboarding.mode.quick.desc')}</p>
            </button>
            <button
              type="button"
              data-onboarding-mode-steps=""
              onClick={() => onChooseMode('steps')}
              className="rounded-xl border border-line bg-paper px-5 pb-[18px] pt-[22px] text-left transition-colors hover:border-pine hover:bg-pine-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
            >
              <h2 className="mb-[7px] flex items-center gap-2 text-base font-medium text-ink">
                {t('onboarding.mode.steps.title')}
                {' '}
                <span className="rounded-md bg-pine-soft px-2 py-0.5 text-[11px] font-normal text-pine">
                  {t('onboarding.mode.steps.eta')}
                </span>
              </h2>
              <p className="text-[12.5px] leading-[1.7] text-mist">{t('onboarding.mode.steps.desc')}</p>
            </button>
          </div>

          <p className="text-xs text-mist">{t('onboarding.welcome.foot')}</p>
        </div>

        {/* 右：装饰插画（<xl 隐藏，不挤压文案） */}
        <div className="relative hidden overflow-hidden border-l border-line bg-cream xl:block">
          <div className="absolute right-[18px] top-[14px] z-10 rounded-full border border-line bg-paper px-3 py-0.5 text-[11px] text-mist">
            {t('onboarding.welcome.artBadge')}
          </div>
          <WelcomeArt />
        </div>
      </div>
    </div>
  );
}
