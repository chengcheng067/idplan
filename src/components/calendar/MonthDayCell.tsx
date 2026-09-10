/**
 * 月历日期格（画板 14 日期网格 · 画板 18 方案 A · 画板 19 移动端 · 规格 §6.3）。
 *
 * ── 画板 14 原文 ──
 *   「日期网格 7 列 × 6 行 …… 每格内：日号 + 阶段色带（高 11–14，圆角 6，用 lightBar，
 *     宽度撑满格宽减内边距）」「今天：日号外加 18 × 18 圆点（pine 底，圆角 9999），数字白色」
 *
 * ── 画板 19（移动端 < 768）原文 ──
 *   「日期网格 7 × 6（不横滚）：每格 48 × 90（最小高 90）；每格色带 38 × 11，圆角 ~6；
 *     每格最多 2 条；日号 11；今天为 18 × 18 pine 圆点 + 白字；双行小字（农历 / 计数）9 mist」
 *
 * ── 画板 18 方案 A（§7.2 D2 已拍板「A 为主」）──
 *   「格内阶段超过 3 条（桌面）/ 2 条（移动端）时（§6.3 溢出策略），折叠为
 *     「+N 个项目」可点行；点击 → 就地展开清单（不跳页、不弹窗）：聚合带（高 20，
 *     圆角 10，浅底）+ 清单行（色点 12 × 12 圆角 3 取 main 值 + 「{项目名} · {阶段名}」12）
 *     + 末尾「还有 N 个项目」12」
 *   规格补充说明：画板 18 是「交互方案讨论稿，不是要 1:1 实现」，故本组件实现
 *   **方案 A 的交互 + 清单视觉**，尺寸按容器自适应，不复刻画板里的固定 px。
 *
 * ── 一处有意偏离（产品决策，已在报告中说明）──
 *   画板 14 与 画板 18-A 都把格内色带画成**纯色条**（不带项目名），项目名只在
 *   画板 18-B 的展开清单里出现。本实现遵循该设计：色带=纯色 + `title` 提示，
 *   点名信息通过「+N 个项目」就地展开的清单暴露。色带仍可点进项目详情（既有功能保留）。
 */

import { useState } from 'react';

import { cn } from '../../lib/cn';
import {
  MOBILE_CELL_MIN_H,
  DESKTOP_CELL_MIN_H,
  type GridDay,
} from './calendarGrid';
import { stageSolidOf } from './calendarColors';
import type { CalendarEntry } from './calendarMath';

/**
 * 溢出折叠阈值（规格 §6.3 表格）：
 *   月历格内阶段超过 2 条（移动端）/ 3 条（桌面）→ 折叠为「+N 个项目」，点击展开。
 * ⚠️ 注意这与「休息日」无关：这里的「拥挤」指**一个格子里有几个项目/阶段**。
 */
const COLLAPSE_LIMIT_DESKTOP = 3;
const COLLAPSE_LIMIT_MOBILE = 2;

/**
 * 展开态最多渲染的清单行数。展开后网格行会随内容变高（画板 18-B 的格子就比 A 高），
 * 但无上限会让整月网格失控跳高，故设上限，超出部分并入末尾「还有 N 个项目」。
 */
const MAX_EXPANDED_ROWS = 6;

/** 清单行里的阶段名：激活阶段优先，否则按状态给一个可读词，绝不留空 */
export function stageLabelOf(entry: CalendarEntry): string {
  if (entry.activeStage) return entry.activeStage.name;
  if (entry.status === 'completed') return '已完成';
  if (entry.status === 'not_started') return '未开始';
  return '进行中';
}

export function MonthDayCell({
  day,
  items,
  isRest,
  isMobile,
  onSelect,
  onOpen,
}: {
  day: GridDay;
  items: CalendarEntry[];
  /** 是否休息日。**由调用方走 lib/workdays.isRestDay 得出**（见文件尾「休息日口径」说明） */
  isRest: boolean;
  isMobile: boolean;
  onSelect(): void;
  onOpen(projectId: string): void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const limit = isMobile ? COLLAPSE_LIMIT_MOBILE : COLLAPSE_LIMIT_DESKTOP;
  const crowded = items.length > limit;
  const hiddenCount = Math.max(0, items.length - limit);
  const shownRows = items.slice(0, MAX_EXPANDED_ROWS);
  const restAfterRows = Math.max(0, items.length - shownRows.length);

  return (
    <div
      onClick={onSelect}
      className={cn(
        'relative flex cursor-pointer flex-col gap-[4px] overflow-hidden p-[4px] transition-colors md:p-[6px]',
        // 格底色三分（画板 14/15）：当月 paper / 休息日 rest-day / 非当月 cream
        day.inMonth ? (isRest ? 'bg-rest-day' : 'bg-paper') : 'bg-cream',
        day.inMonth ? 'text-ink' : 'text-mist',
        'hover:bg-sand/40',
        // 选中格高亮（既有功能保留）
        day.isSelected && 'ring-1 ring-inset ring-pine',
      )}
      /* 最小高走常量（单一来源）：移动端 90（画板 19 约束值 92 的贴近）/ 桌面 110（画板 14）。
         用 min-height 而非 height —— 展开清单时格子允许变高（画板 18-B 即更高的格）。 */
      style={{ minHeight: isMobile ? MOBILE_CELL_MIN_H : DESKTOP_CELL_MIN_H }}
      aria-label={`${day.date}${day.isToday ? '（今天）' : ''}，${items.length} 个项目`}
    >
      {/* 日号（画板 14：13；画板 19：11。今天 = 18×18 pine 圆点 + 白字） */}
      <div className="flex items-center justify-between gap-[2px]">
        {day.isToday ? (
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-pine text-[11px] font-medium text-white">
            {day.day}
          </span>
        ) : (
          <span className={cn('text-[11px] md:text-[13px]', day.inMonth ? 'text-ink' : 'text-mist')}>
            {day.day}
          </span>
        )}
        {/* 移动端双行小字（画板 19）：不拥挤时给一个计数，拥挤时由「+N」承担 */}
        {isMobile && items.length > 0 && !crowded && (
          <span className="whitespace-nowrap text-[9px] leading-tight text-mist">{items.length} 个</span>
        )}
      </div>

      {/* 色带区（溢出隐藏，保证任何情况下都不横向滚动） */}
      <div className={cn('flex min-w-0 flex-1 flex-col gap-[3px] overflow-hidden', !day.inMonth && 'opacity-70')}>
        {/* 折叠态：只画前 limit 条纯色带（画板 14 / 18-A） */}
        {!expanded &&
          items.slice(0, limit).map((e) => (
            <button
              key={e.project.id}
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onOpen(e.project.id);
              }}
              title={`${e.project.name} · ${stageLabelOf(e)} · ${Math.round(e.percent)}%`}
              className={cn(
                // 色带：高 11（移动端画板 19）/ 14（桌面画板 14），圆角 6，撑满格宽
                'block w-full shrink-0 rounded-[6px] transition-transform hover:scale-[1.02]',
                isMobile ? 'h-[11px]' : 'h-[14px]',
                // 未开始幽灵态（图例有「未开始」说明，此处保持语义一致）
                e.isGhost && 'opacity-40',
              )}
              style={{ backgroundColor: e.color }}
              aria-label={`打开项目 ${e.project.name}`}
            />
          ))}

        {/* 折叠入口（§6.3）：拥挤时出现，点击**就地展开**，不跳页不弹窗。
            文案分档：画板 19（移动端专版）写「折叠为「+N」」，§6.3 写「折叠为「+N 个项目」」。
            移动端格宽仅 ~48px，用长文案会折成两行把格高顶开，故移动端按画板 19 用「+N」。 */}
        {crowded && !expanded && (
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              setExpanded(true);
            }}
            className="w-full whitespace-nowrap rounded-[6px] py-[1px] text-left text-[9px] text-mist transition-colors hover:text-ink md:text-[11px]"
          >
            {isMobile ? `+${hiddenCount}` : `+${hiddenCount} 个项目`}
          </button>
        )}

        {/* 展开态（画板 18-B）：色带**被聚合带取代**（不是并列），下接清单行 */}
        {crowded && expanded && (
          <div className="flex min-w-0 flex-col gap-[3px]">
            {/* 聚合带：高 20，圆角 10，浅底（画板 18-B 的 #EEF1F5 ≈ sunken「凹陷井」token） */}
            <span aria-hidden className="block h-[20px] w-full shrink-0 rounded-[10px] bg-sunken" />
            {shownRows.map((e) => (
              <button
                key={`row-${e.project.id}`}
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onOpen(e.project.id);
                }}
                className="flex min-w-0 items-center gap-[6px] text-left"
              >
                {/* 色点 12 × 12，圆角 3，取该阶段「实心块」色（亮 = main / 暗 = lightBar） */}
                <span
                  aria-hidden
                  className="h-[12px] w-[12px] shrink-0 rounded-[3px]"
                  style={{ backgroundColor: stageSolidOf(e.filterStageIndex, e.activeStage?.colorIndex) }}
                />
                <span className="min-w-0 truncate text-[12px] text-ink">
                  {e.project.name} · {stageLabelOf(e)}
                </span>
              </button>
            ))}
            {restAfterRows > 0 && (
              <span className="text-[12px] text-mist">还有 {restAfterRows} 个项目</span>
            )}
            {/* 收起入口：展开是就地状态，必须可逆 */}
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                setExpanded(false);
              }}
              className="w-full whitespace-nowrap text-left text-[9px] text-mist transition-colors hover:text-ink md:text-[11px]"
            >
              收起
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
