/**
 * 月历甘特内联色镜像（PRD §6.2 铁律 8 + 镜像机制）：
 * 组件内一律用 Tailwind token class；色带 / 进度点 / 图例等需要内联 fill 的场景，
 * 色值必须集中镜像到本文件（与 tailwind.config / stageColors / timelineColors 同步，
 * 修改任一处三处必须同步）。禁止在组件里写裸 hex。
 *
 * ⚠️ 阶段九色 v3 起分「角色变体」（设计规格 §1.2），本文件取的是**宽面**那一套：
 *   月历色带 / ProjectBandRow 都是大块面，亮色页用 lightBar、暗色页用 darkBar，
 *   即 --stage-band-sN（暗色切换由 global.css 的主题变量承担，本文件零改动）。
 *   小色块 / 色点 / 图例点才用 --stage-sN（见 stageColors 的 STAGE_BAR_COLORS）。
 */

import { STAGE_BAND_COLORS } from '../timeline/stageColors';
import { TODAY_LINE_COLOR, RING_PROGRESS } from '../timeline/timelineColors';
import { resolveStageColorIndex } from '../../core/template/stage-fallback';

/** 未开始幽灵态底色 = --calendar-not-started（亮色 #a0a0a8 / 暗色 #9aa3b2，住 global.css，随主题换肤） */
export const NOT_STARTED_COLOR = 'var(--calendar-not-started)';

/** 逾期色带 = clay token（#f06548，复用今日线色，同一语义源） */
export const OVERDUE_COLOR = TODAY_LINE_COLOR;

/** 已完成色带 = stage.s9 的宽面变体（九段色末段，token 唯一来源） */
export const COMPLETED_COLOR = STAGE_BAND_COLORS[9];

/** 末端蓝色进度点 = pine token（#6ea8fe，复用完成度环进度色） */
export const PROGRESS_DOT_COLOR = RING_PROGRESS;

/** 按阶段取九段色「宽面」变体（时间轴色带同源，跨视图一致）。
 *  colorIndex 优先（多阶段项目 1..9 循环色板），缺失时按 orderIndex 读时回落。 */
export function stageColorOf(orderIndex: number, colorIndex?: number | null): string {
  return STAGE_BAND_COLORS[resolveStageColorIndex(orderIndex, colorIndex)] ?? COMPLETED_COLOR;
}
