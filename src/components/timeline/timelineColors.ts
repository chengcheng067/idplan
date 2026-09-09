/**
 * 时间轴 SVG 配色（v0.5 双主题）。
 *
 * 之前这里硬编码深色 hex，浅色主题下甘特图行底纹 / 激活描边仍是深色，与亮色背景割裂。
 * 现改为引用 src/styles/global.css 的 CSS 变量（:root = 亮色，[data-theme='dark'] = 暗色），
 * 全站换肤时 SVG 行底纹 / 描边 / 进度环 / 今日线 / 休息条带自动跟随。
 *
 * SVG 的 fill / stroke / feDropShadow floodColor 在现代浏览器下均支持 CSS 变量，
 * React 渲染为 `fill="var(--xxx)"` 即可生效。
 *
 * 修改时三处必须同步：本文件 + global.css 的 --timeline-* 变量 +（如有）变量命名风格。
 */

/** 时间轴行底纹：激活阶段整行高亮 */
export const ROW_BG_ACTIVE = 'var(--timeline-row-active)';

/** 时间轴行底纹：偶数行 */
export const ROW_BG_EVEN = 'var(--timeline-row-even)';

/** 时间轴行底纹：奇数行 */
export const ROW_BG_ODD = 'var(--timeline-row-odd)';

/** 激活彩条描边（accent #6ea8fe，亮暗通用） */
export const STAGE_ACTIVE_STROKE = 'var(--timeline-active-stroke)';

/** 激活彩条发光（feDropShadow floodColor，accent #6ea8fe） */
export const STAGE_GLOW_COLOR = 'var(--timeline-glow)';

/** 完成度环：外圈 track（弱描边，随主题反相） */
export const RING_TRACK = 'var(--timeline-ring-track)';

/** 完成度环：进度条（accent #6ea8fe，全站主操作一致） */
export const RING_PROGRESS = 'var(--timeline-ring-progress)';

/** 完成度环：百分比文字（随主题反相） */
export const RING_TEXT = 'var(--timeline-ring-text)';

/** 今日线（semantic-danger #f06548，亮暗通用） */
export const TODAY_LINE_COLOR = 'var(--timeline-today-line)';

/**
 * 休息日竖向条带（随主题反相的半透明叠加，只做语义底纹，
 * 不改变 xOf 的自然日线性映射）。
 */
export const REST_DAY_BAND = 'var(--timeline-rest-band)';

/* --------- v0.6 双色分层（Agent vs Human 任务条；hex 只落 global.css，铁律 8） --------- */

/** Agent 任务条底色（斜纹 pattern 的底） */
export const TASK_BAR_AGENT = 'var(--timeline-agent-bar)';

/** Agent 任务条斜纹线色（<pattern> 内 line stroke） */
export const TASK_BAR_AGENT_HATCH = 'var(--timeline-agent-hatch)';

/** Human 任务条底色 */
export const TASK_BAR_HUMAN = 'var(--timeline-human-bar)';
