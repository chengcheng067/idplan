import { useLang } from '../../i18n';
import { RING_PROGRESS, RING_TEXT, RING_TRACK } from '../timeline/timelineColors';

/**
 * SVG 完成度环（首页卡片/详情顶条共用）。
 * v0.3 视觉修复（QA BUG-1）：v0.2 米白主题 hex 残留收敛——
 * 外圈 stroke 走暗色 border 弱描边、进度走 accent(#6ea8fe)、文字走 text-primary(#f0edff)，
 * 与 T07 hex 收敛策略一致（集中常量 timelineColors.ts）。
 */
export function CompletionRing({
  percent,
  size = 44,
  strokeWidth = 4,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}): JSX.Element {
  const { t } = useLang();
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t('ui.completionRing.aria', { percent: clamped })}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={RING_TRACK}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={RING_PROGRESS}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={size >= 40 ? 11 : 9}
        fill={RING_TEXT}
      >
        {clamped}%
      </text>
    </svg>
  );
}
