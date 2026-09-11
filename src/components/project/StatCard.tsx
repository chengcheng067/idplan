/**
 * 首页统计概览指标卡（规格 §2.5 统计卡行）：
 *   等宽 4 卡，高 156（桌面）/ 92（平板），圆角 24（桌面）/ 12（平板），bg-paper + shadow-raised；
 *   内含：标签 13 / 大数字 18·700 / 环比小字 11。
 *   响应式：flex-wrap + flex:1 1 基准宽，不写死列数；平板 2×2、手机单列（断点 xl/md，不用 lg）。
 * 配色走 token（pine / amber / clay / sage=stage-s1），禁止裸 hex。
 */

import { cn } from '../../lib/cn';

export type StatTone = 'pine' | 'amber' | 'clay' | 'sage';

const TONE_TEXT: Record<StatTone, string> = {
  pine: 'text-pine',
  amber: 'text-amber',
  clay: 'text-clay',
  // 灰绿（「本月完工」）复用九段 stage.s1，避免新增配色体系
  sage: 'text-stage-s1',
};

export function StatCard({
  tone,
  value,
  label,
  trend,
  trendDown = false,
  icon,
}: {
  /** 保留字段（历史参考稿遗留的极简字形）；规格 §2.5 不再渲染独立图标底 */
  icon?: string;
  tone: StatTone;
  value: number | string;
  label: string;
  /** 趋势文本；为 null 时不渲染趋势胶囊（无历史数据不伪造） */
  trend?: string | null;
  trendDown?: boolean;
}): JSX.Element {
  const tClass = TONE_TEXT[tone];
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-md bg-paper p-4 shadow-raised',
        'h-[92px] w-full md:w-[calc(50%-10px)] xl:w-auto xl:flex-1',
        'xl:h-[156px] xl:rounded-3xl xl:p-6 xl:gap-4',
      )}
    >
      <span className="truncate text-[13px] text-mist">{label}</span>
      <span className="text-[18px] font-bold leading-tight text-ink">{value}</span>
      {trend ? (
        <span className={cn('flex items-center gap-1 text-[11px] font-medium', tClass)}>
          <span aria-hidden>{trendDown ? '↘' : '↗'}</span>
          {trend}
        </span>
      ) : (
        <span className="text-[11px] text-mist/70">—</span>
      )}
    </div>
  );
}
