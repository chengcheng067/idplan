/**
 * 月历四种空状态（画板 16 亮色 / 画板 17 暗色 · 规格 §3.5 · §7.2 D4）。
 *
 * ── 画板 16 原文（四态统一结构）──
 *   E1 还没有进行中的项目：图标底 64 × 64（圆角 20，内 `+` 30 pine）→ 标题 16/600
 *      → 说明 13 mist → 主按钮「直接手动建档」
 *   E2 当月无在途项目：星期表头（一–日 12）→ 幽灵网格 6×7（每格 84 × 48；
 *      当月格 paper，周末格浅灰）→ 浮层提示卡（「2026年8月 暂无在途项目」14/600
 *      +「试试切换到相邻月份看看」12 mist）
 *   E3 没有符合筛选条件的项目：筛选 chip 行 → 幽灵网格 → 提示卡（标题 14/600
 *      +「清除筛选」按钮）
 *   E4 该项目的阶段与你无关：顶部「{项目名} · 阶段时间轴」15/600 +「委托方：{客户} ·
 *      周期 {区间}」12 mist；居中块（图标底 56 × 56 圆角 18 → 标题 16/600 → 说明 13 mist）
 *
 * ── ⚠️ E3 的 chip 色（§7.2 D4 已拍板）──
 *   画板 16 里 E3 的 chip 用了 `#E6F0EB`（绿）/ `#F2E5E5`（红）——规格 §7.2 判定为
 *   **旧版阶段色残留**，必须改用新的 `lightBar` 变体（阶段③ → s3、阶段⑦ → s7）。
 *   本实现渲染的是**当前真实生效的筛选条件**，并统一走
 *   `--stage-band-sN` / `--stage-ink-sN`，故天然满足 D4，且不会出现「画着③⑦、
 *   实际选的是别的阶段」这种假信息。
 *
 * ── 与画板的两处有意偏离（均已上报）──
 *   1) 容器底色：画板 16 展示框是 `#F7F8FA`（≈ `bg-cream`），但画板 16 的 700×420
 *      按规格 §3.5 自述是「规范样张的展示框」；若空状态真的也用 `cream`，它会与
 *      同为 `cream` 的页面底糊在一起、边界全无。故保留 `bg-cream` 的规格色，
 *      同时补 `border border-line` 让容器**在两种主题下都可辨**（画板 17 的提示卡
 *      外框 `#E9EDF3` 也正是 `line` token 的近值）。
 *   2) 空状态的**判定条件与触发时机一律未改**（那是业务语义）：仍由
 *      MonthlyCalendarView 依 active / baseEntries / finalEntries / memberView 选择，
 *      本文件只做视觉。
 */

import { type ReactNode } from 'react';
import { EyeOff, Plus } from 'lucide-react';

import { Button } from '../ui/Button';
import { isRestDay } from '../../lib/workdays';
import { useSettingsStore } from '../../store/useSettingsStore';
import type { Project } from '../../core/types/entities';
import { cn } from '../../lib/cn';
import { WEEKDAYS, formatPeriod, type GridDay } from './calendarGrid';
import { CIRCLED_NUMBERS } from './calendarColors';
import { STAGE_BAND_COLORS, STAGE_BAND_INK_COLORS } from '../timeline/stageColors';
import { CHIP_BASE } from './CalendarFilters';
import { STATUS_LABELS, type CalendarFilters } from './calendarMath';

export type EmptyKind = 'E1' | 'E2' | 'E3' | 'E4' | null;

/** 四态统一容器：`max-w-[700px]` 自适应（画板 16 的 700 × 420 是样张尺寸，不写死） */
function EmptyShell({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-[700px] flex-col items-center gap-[12px] rounded-[24px] border border-line bg-cream px-[24px] py-[32px] text-center',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * 幽灵网格（画板 16 E2/E3）：6 行 × 7 列空壳，让人看得出「这里是日历，只是没内容」。
 * 格底色与真实月历同口径：当月 paper / 休息日 rest-day / 非当月 cream。
 * 休息日仍走 isRestDay（与真实网格同一口径，不硬编码周六周日）。
 */
function GhostGrid({ gridDays }: { gridDays: GridDay[] }): JSX.Element {
  const restPolicy = useSettingsStore((s) => s.restPolicy);
  return (
    <div className="w-full">
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-[6px] text-center text-[12px] text-mist">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[2px] overflow-hidden rounded-[12px]">
        {gridDays.map((d) => {
          const rest = d.inMonth && isRestDay(d.date, restPolicy);
          return (
            <div
              key={d.date}
              aria-hidden
              className={cn(
                'h-[48px]',
                !d.inMonth ? 'bg-cream' : rest ? 'bg-rest-day' : 'bg-paper',
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

/** 浮层提示卡（画板 16 E2/E3）：外框 line + 内层 paper 卡 */
function HintCard({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="w-full max-w-[322px] rounded-[13px] border border-line p-[1px]">
      <div className="flex flex-col items-center gap-[10px] rounded-[12px] bg-paper px-[16px] py-[14px]">
        {children}
      </div>
    </div>
  );
}

/** 图标底（E1 64×64 圆角 20 / E4 56×56 圆角 18） */
function IconTile({
  size,
  radius,
  children,
}: {
  size: number;
  radius: number;
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      className="flex shrink-0 items-center justify-center bg-pine-soft text-pine"
      style={{ width: size, height: size, borderRadius: radius }}
      aria-hidden
    >
      {children}
    </span>
  );
}

export function CalendarEmptyStates({
  kind,
  monthLabel,
  gridDays,
  filters,
  memberProject,
  onClear,
  onManual,
  onToggleStatus,
  onToggleStage,
}: {
  kind: Exclude<EmptyKind, null>;
  monthLabel: string;
  gridDays: GridDay[];
  filters: CalendarFilters;
  /** E4 的顶部项目语境：受限成员视图下第一个进行中项目（仅用于给出项目名/客户/周期） */
  memberProject: Project | null;
  onClear(): void;
  onManual?(): void;
  onToggleStatus(status: keyof typeof STATUS_LABELS): void;
  onToggleStage(orderIndex: number): void;
}): JSX.Element {
  if (kind === 'E1') {
    return (
      <EmptyShell className="py-[40px]">
        <IconTile size={64} radius={20}>
          <Plus size={30} />
        </IconTile>
        <p className="text-[16px] font-semibold text-ink">还没有进行中的项目</p>
        <p className="text-[13px] text-mist">新建一个项目，把阶段排期跑起来</p>
        <div className="mt-[4px]">
          <Button variant="primary" onClick={() => onManual?.()}>
            直接手动建档
          </Button>
        </div>
      </EmptyShell>
    );
  }

  if (kind === 'E2') {
    return (
      <EmptyShell className="gap-[16px] py-[24px]">
        <GhostGrid gridDays={gridDays} />
        <HintCard>
          <p className="text-[14px] font-semibold text-ink">{monthLabel} 暂无在途项目</p>
          <p className="text-[12px] text-mist">试试切换到相邻月份看看</p>
        </HintCard>
      </EmptyShell>
    );
  }

  if (kind === 'E3') {
    const statuses = [...filters.status];
    const stages = [...filters.stage].sort((a, b) => a - b);
    return (
      <EmptyShell className="gap-[16px] py-[24px]">
        {/* 筛选 chip 行：展示**当前真实生效**的条件（可点，直接就地取消，省一次跳转） */}
        <div className="flex flex-wrap items-center justify-center gap-[8px]">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed
              onClick={() => onToggleStatus(s)}
              className={cn(CHIP_BASE, 'bg-pine-soft text-pine transition-colors')}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
          {stages.map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed
              onClick={() => onToggleStage(i)}
              className={cn(CHIP_BASE, 'border border-transparent transition-colors')}
              /* D4：用新 lightBar 变体，不用画板 16 的旧色 */
              style={{
                backgroundColor: STAGE_BAND_COLORS[i],
                color: STAGE_BAND_INK_COLORS[i],
              }}
            >
              阶段 {CIRCLED_NUMBERS[i - 1]}
            </button>
          ))}
        </div>

        <GhostGrid gridDays={gridDays} />

        <HintCard>
          <p className="text-[14px] font-semibold text-ink">没有符合筛选条件的项目</p>
          <Button variant="secondary" size="sm" onClick={onClear}>
            清除筛选
          </Button>
        </HintCard>
      </EmptyShell>
    );
  }

  // E4：该项目的阶段与你无关
  return (
    <EmptyShell className="gap-[16px] py-[24px]">
      <div className="flex flex-col items-center gap-[4px]">
        <p className="text-[15px] font-semibold text-ink">
          {memberProject ? `${memberProject.name} · 阶段时间轴` : `${monthLabel} · 阶段时间轴`}
        </p>
        {memberProject && (
          <p className="text-[12px] text-mist">
            委托方：{memberProject.clientName || '—'} · 周期{' '}
            {formatPeriod(memberProject.plannedStartAt, memberProject.plannedEndAt)}
          </p>
        )}
      </div>

      {/* 居中块（画板 16 E4：400 × 210，底 #F7F8FA ≈ cream）。
          规格里外层展示框是白底，故内块可直接用 cream 区分；本实现的统一容器本身就是
          cream，若内块也用裸 cream 会完全糊在一起，故补 line 描边划出层次。 */}
      <div className="flex w-full max-w-[400px] flex-col items-center gap-[12px] rounded-[16px] border border-line bg-cream py-[24px]">
        <IconTile size={56} radius={18}>
          <EyeOff size={26} />
        </IconTile>
        <p className="text-[16px] font-semibold text-ink">该项目的阶段与你无关</p>
        <p className="text-[13px] text-mist">你可以查看项目概况，或联系项目负责人</p>
      </div>
    </EmptyShell>
  );
}
