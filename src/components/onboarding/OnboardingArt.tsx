import { useLang } from '../../i18n';

/**
 * 步骤 1「看板」的内联 SVG 插画（设计稿 §八-3：词汇取自软件自身）。
 * 三条看板轨道 + 任务卡（三块：标题行 / 阶段胶囊 / 进度条）+ 今天胶囊。
 * 每个元素挂 `onb-in` + 60ms 递增延迟（错峰淡入 + 上移 8px，总长 ≤400ms），
 * `prefers-reduced-motion` 由 global.css 关停清单统一退化为直接呈现。
 * 颜色全部走 `--color-*` / `--*-rgb` token（亮暗自动跟随，零写死色值）。
 */
export function BoardArt(): JSX.Element {
  const d = (i: number): { animationDelay: string } => ({ animationDelay: `${i * 60}ms` });

  return (
    <svg
      viewBox="0 0 360 300"
      role="img"
      aria-hidden="true"
      className="h-auto w-full max-w-[420px]"
      data-onboarding-step-art="board"
    >
      {/* 三条看板轨道 */}
      <rect className="onb-in" style={d(0)} x="16" y="24" width="100" height="252" rx="12" fill="var(--color-paper)" stroke="var(--color-line)" />
      <rect className="onb-in" style={d(1)} x="130" y="24" width="100" height="252" rx="12" fill="var(--color-paper)" stroke="var(--color-line)" />
      <rect className="onb-in" style={d(2)} x="244" y="24" width="100" height="252" rx="12" fill="var(--color-paper)" stroke="var(--color-line)" />

      {/* 轨道 1：项目名行 + 任务卡（标题行 / 阶段胶囊 / 进度条） */}
      <rect className="onb-in" style={d(3)} x="30" y="42" width="52" height="8" rx="4" fill="var(--color-line)" />
      <rect className="onb-in" style={d(4)} x="30" y="62" width="72" height="64" rx="9" fill="var(--color-paper)" stroke="var(--color-line)" />
      <rect className="onb-in" style={d(5)} x="40" y="74" width="40" height="6" rx="3" fill="var(--color-mist)" opacity=".5" />
      <rect className="onb-in" style={d(6)} x="40" y="88" width="44" height="13" rx="6.5" fill="rgb(var(--pine-soft-rgb))" />
      <rect className="onb-in" style={d(7)} x="40" y="110" width="52" height="5" rx="2.5" fill="var(--color-line)" />
      <rect className="onb-in" style={d(8)} x="40" y="110" width="20" height="5" rx="2.5" fill="rgb(var(--pine-rgb))" />

      {/* 轨道 2：品牌色主任务卡（悬浮感，带头像圆点） */}
      <g className="onb-in" style={d(5)}>
        <rect x="144" y="70" width="72" height="72" rx="9" fill="rgb(var(--pine-rgb))" />
        <rect x="156" y="84" width="36" height="6" rx="3" fill="#ffffff" opacity=".9" />
        <rect x="156" y="98" width="48" height="5" rx="2.5" fill="#ffffff" opacity=".55" />
        <circle cx="200" cy="126" r="7" fill="#ffffff" opacity=".85" />
      </g>
      <rect className="onb-in" style={d(6)} x="144" y="156" width="40" height="14" rx="7" fill="rgb(var(--moss-soft-rgb))" />
      <rect className="onb-in" style={d(6)} x="144" y="156" width="40" height="14" rx="7" fill="none" stroke="rgb(var(--moss-rgb))" />
      <rect className="onb-in" style={d(7)} x="144" y="184" width="30" height="8" rx="4" fill="var(--color-line)" />

      {/* 轨道 3：临期胶囊 + 空槽 */}
      <rect className="onb-in" style={d(7)} x="258" y="70" width="44" height="14" rx="7" fill="rgb(var(--amber-soft-rgb))" />
      <rect className="onb-in" style={d(7)} x="258" y="70" width="44" height="14" rx="7" fill="none" stroke="rgb(var(--amber-rgb))" />
      <rect className="onb-in" style={d(8)} x="258" y="98" width="72" height="40" rx="9" fill="var(--color-rest-day)" />

      {/* 今天胶囊（月历词汇的呼应） */}
      <g className="onb-in" style={d(9)}>
        <rect x="244" y="212" width="64" height="26" rx="13" fill="rgb(var(--pine-soft-rgb))" />
        <rect x="244" y="212" width="64" height="26" rx="13" fill="none" stroke="rgb(var(--pine-rgb))" />
        <rect x="260" y="222" width="32" height="6" rx="3" fill="rgb(var(--pine-rgb))" />
      </g>
    </svg>
  );
}

/** 步骤进度插画占位（2~8 步第二批补内容前的中性空位，不假装有内容） */
export function StepArtPlaceholder(): JSX.Element {
  const d = (i: number): { animationDelay: string } => ({ animationDelay: `${i * 60}ms` });
  return (
    <svg
      viewBox="0 0 360 300"
      aria-hidden="true"
      className="h-auto w-full max-w-[420px]"
      data-onboarding-step-art="placeholder"
    >
      <rect className="onb-in" style={d(0)} x="60" y="60" width="240" height="180" rx="12" fill="var(--color-paper)" stroke="var(--color-line)" strokeDasharray="6 6" />
      <rect className="onb-in" style={d(1)} x="110" y="130" width="140" height="8" rx="4" fill="var(--color-line)" />
      <rect className="onb-in" style={d(2)} x="130" y="150" width="100" height="8" rx="4" fill="var(--color-rest-day)" />
    </svg>
  );
}
