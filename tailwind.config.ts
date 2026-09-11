import type { Config } from 'tailwindcss';

/**
 * ID 系列「Soft UI」design token 映射层（v0.5 双主题）
 *
 * 职责边界（重要）：
 *   - **色值本身不在本文件**，全部住在 src/styles/global.css 的 CSS 变量里
 *     （:root = 亮色默认，:root[data-theme='dark'] = 暗色）；
 *   - 本文件只负责「旧 token 名 → rgb(var(--x-rgb) / …)」的映射，
 *     因此 30+ 组件里的 bg-cream / bg-paper / border-line / text-pine 一个 className 都不用改，
 *     随 <html data-theme> 整体换肤。
 *   - 组件内仍禁写裸色值 hex，一律引用这里的命名 token。
 *
 * 透明度修饰符（bg-pine/20、border-line/60 等 50 处用法）如何生效：
 *   颜色值里预留 <alpha-value> 占位符，Tailwind 遇到 /20 就把它替换成 0.2，无修饰符时替换为 1。
 *   变量 --{name}-a 是该色的「默认 alpha」，让 sand 这类本就半透明的底纹
 *   在不写修饰符时也是正确的淡度，写 /60 时则变成 0.07×0.6 的相对淡度。
 *   v0.7 起 line 与 *-soft 都是实色（--{name}-a: 1），不带修饰符时即渲染规格实色。
 */
const c = (name: string, fallbackAlpha = 1): string =>
  `rgb(var(--${name}-rgb) / calc(var(--${name}-a, ${fallbackAlpha}) * <alpha-value>))`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', './tests/**/*.{ts,tsx}'],

  /**
   * safelist —— 阶段色的「保命名单」（BUG-05 的第二道防线）。
   *
   * 背景：Tailwind 只做**静态文本扫描**，模板字符串拼出来的类名（`bg-stage-band-s${n}`）
   * 一条 CSS 都不会生成。项目里确实踩过这个坑：构建产物 CSS 中
   * `bg-stage-band-s1..s9` / `text-stage-ink-s1..s9` / `bg-stage-s1..s9` 生成条数**全为 0**，
   * 导致阶段色带 / chip / 色点在亮暗两套主题下都不显色。
   *
   * 根因已在调用点修掉（统一改为 src/components/timeline/stageColors.ts 里的静态映射表索引），
   * 这里再把三类 × 九段的**实际组合**显式列进 safelist 兜底：
   * 万一以后有人又写回动态拼接，至少 CSS 里这些类还在，不会立刻变成隐形色块。
   *
   * 注意列的是「会真实出现的组合」而非穷举全集 —— safelist 是逃生舱，不是主力。
   *   实心块   bg-stage-sN            （色点 / 细竖条 / 小方块 / 图例点）
   *   宽面     bg-stage-band-sN       （跨度色带 / 月历色带 / 大横条 / 阶段条 / chip 底）
   *   面内字   text-stage-ink-sN      （压在宽面上的文字）
   *   色点淡底 bg-stage-sN/15 + text-stage-sN（首页看板列头 chip）
   */
  /**
   * blocklist —— 排除扫描器误报。
   *
   * Tailwind 的 content 扫描是**纯文本正则**，不区分代码语境，于是会把
   * 「长得像 CSS 类名的字符串」当成真的类名：
   *   · src/core/services/backup.service.ts:386 等三处的 `now.toISOString()…replace(/[-:T]/g, '')`
   *     → 被读成类名 `[-:T]`，生成 `.\[\-\:T\]{-: T}`（一条语法非法的规则）
   *   · tests/agent-dag.spec.ts:199 注释里的 `[changxia:validation]`
   *     → 生成 `.[changxia\:validation]{changxia:validation}`
   * 二者都进不了实际渲染（浏览器直接丢弃非法声明），但会在每次构建时刷一条 CSS 语法警告，
   * 长期会训练出「警告无视」的习惯，掩盖真正的 CSS 问题。故在此显式排除。
   */
  blocklist: ['[-:T]', '[changxia:validation]'],

  safelist: [
    ...Array.from({ length: 9 }, (_, i) => `bg-stage-s${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `bg-stage-s${i + 1}/15`),
    ...Array.from({ length: 9 }, (_, i) => `text-stage-s${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `bg-stage-band-s${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `text-stage-ink-s${i + 1}`),
  ],

  /**
   * 暗色变体的**判定依据**：本项目的主题开关是 `<html data-theme="dark">`
   * （由主题 store 写在 documentElement 上），**不是** Tailwind 默认的
   * `prefers-color-scheme` 媒体查询，也不是 `.dark` class。
   *
   * ⚠️ 这里必须显式声明。Tailwind 默认的 dark 变体是**跟随操作系统的**——
   * 若不声明，`dark:xxx` 会生成在 `@media (prefers-color-scheme: dark)` 里，
   * 于是出现「系统是深色但用户在应用里选了浅色 → 样式错乱」这种极难排查的问题。
   * 用 `['variant', …]` 形式把判定改成属性选择器，与应用内开关严格一致。
   *
   * 背景：此前代码里散着 4 处自创的「祖先属性任意变体」写法，且两处写坏（一处缺最外层
   * `[`、一处字符串里夹了真实空格），导致「暗色下时间轴卡圆角 16」「暗色首页内边距收紧」
   * 从未生效过。Tailwind 对这类坏类名不报错，只是静默不生成 CSS。
   * 现在统一成标准 `dark:` 前缀，可读、可搜、不可能写错。
   *
   * 注意：绝大多数换肤仍由 CSS 变量自动完成（见 global.css 的 token 层）；
   * 只有「同一元素在暗色下要换**非颜色**属性」（圆角、间距）时才需要 dark:。
   */
  darkMode: ['variant', 'html[data-theme="dark"] &'],

  theme: {
    extend: {
      colors: {
        /** surface-base 应用底色（亮 #f8fafc / 暗 #14161a） */
        cream: c('cream'),
        /** surface-raised 卡片/面板底（亮 #fff / 暗 #1e2127） */
        paper: c('paper'),
        /** surface-sunken 输入框 / 内凹井（亮 #f1f5f9 / 暗 #101216） */
        sunken: c('sunken'),
        /** hover 底纹 / 极弱叠加（默认 alpha 0.07 / 暗 0.08）；v0.7 起**不再用于描边**，描边走 line */
        sand: c('sand', 0.07),
        /**
         * 描边实色（v0.7 规格 §1.1：亮 #E8EAED / 暗 #333840）。
         * 卡片 / 控件 / 分隔线边框的**唯一**描边色，全站 border-* 一律用它；
         * 实色不参与 alpha 混合，故不传 fallbackAlpha。
         * 分工边界：**描边走 line，hover 底纹走 sand**，两者不可互串。
         */
        line: c('line'),
        /** text-primary 主文字 */
        ink: c('ink'),
        /** text-secondary 弱文字 */
        mist: c('mist'),
        /** accent 主色 Indigo（亮 #6366f1 / 暗 #818cf8） */
        pine: {
          DEFAULT: c('pine'),
          soft: c('pine-soft', 0.1),
          deep: c('pine-deep'),
        },
        /** accent-2 辅色 Pink（用户选定：Indigo 主 + Pink 辅） */
        rose: {
          DEFAULT: c('rose'),
          soft: c('rose-soft', 0.1),
        },
        /** semantic-warning 临期 */
        amber: {
          DEFAULT: c('amber'),
          soft: c('amber-soft', 0.12),
          deep: c('amber-deep'),
        },
        /** semantic-success 完成 / 正常 */
        moss: {
          DEFAULT: c('moss'),
          soft: c('moss-soft', 0.1),
        },
        /**
         * 休息日底纹（公司休息制度 · 渲染层专用，T7）：低饱和中性色，
         * 语义只走 src/lib/workdays.ts 的 isRestDay，此处仅提供颜色。
         *   DEFAULT —— 月历休息日格 / 时间轴条带（不透明）
         *   band    —— 时间轴 SVG 竖向条带（半透明叠加在行底纹之上，不遮挡阶段彩条）
         */
        'rest-day': {
          DEFAULT: c('rest-day'),
          band: c('rest-day-band', 0.04),
        },
        /** semantic-danger 逾期/危险 */
        clay: {
          DEFAULT: c('clay'),
          soft: c('clay-soft', 0.1),
          deep: c('clay-deep'),
        },
        /**
         * 时间轴九段阶段色 v3（松墨 → 栗褐 · 冷暖重排 · 2026-09-10 UNLOCKED）。
         * 数值唯一来源是 global.css 的 --stage-sN-rgb（亮 = main / 暗 = lightBar），
         * 本文件只做映射，因此这里**不出现任何 hex**。
         *
         * 三套变体对应三个角色，别混用（映射表见设计规格 §1.2）：
         *   stage.sN      实心块 —— 侧栏彩条 / 细竖条 / 小方块 / 色点 / 图例点 / 阶段点
         *   stage-band.sN 宽面   —— 时间轴跨度色带 / 月历色带 / 大横条 / 阶段条
         *   stage-ink.sN  面内字 —— 压在 stage-band.sN 上的文字
         * TS/SVG 里取不到 Tailwind 类的场景走
         * src/components/timeline/stageColors.ts 的同名别名（那里镜像 var() 引用）。
         */
        stage: {
          s1: c('stage-s1'),
          s2: c('stage-s2'),
          s3: c('stage-s3'),
          s4: c('stage-s4'),
          s5: c('stage-s5'),
          s6: c('stage-s6'),
          s7: c('stage-s7'),
          s8: c('stage-s8'),
          s9: c('stage-s9'),
        },
        /** 宽面色带（亮 = lightBar / 暗 = darkBar）；用法 bg-stage-band-s3 */
        'stage-band': {
          s1: c('stage-band-s1'),
          s2: c('stage-band-s2'),
          s3: c('stage-band-s3'),
          s4: c('stage-band-s4'),
          s5: c('stage-band-s5'),
          s6: c('stage-band-s6'),
          s7: c('stage-band-s7'),
          s8: c('stage-band-s8'),
          s9: c('stage-band-s9'),
        },
        /** 色带内文字（亮 = lightText / 暗 = darkText）；用法 text-stage-ink-s3 */
        'stage-ink': {
          s1: c('stage-ink-s1'),
          s2: c('stage-ink-s2'),
          s3: c('stage-ink-s3'),
          s4: c('stage-ink-s4'),
          s5: c('stage-ink-s5'),
          s6: c('stage-ink-s6'),
          s7: c('stage-ink-s7'),
          s8: c('stage-ink-s8'),
          s9: c('stage-ink-s9'),
        },
      },
      fontFamily: {
        // Soft UI 明令禁用 Inter/Roboto/Geist —— 一律走系统无衬线栈（离线优先，不强拉网络字体）
        display: [
          'Noto Sans SC',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'Helvetica Neue',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        body: [
          'Noto Sans SC',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'Helvetica Neue',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        // 旧键名保留（组件里已有 shadow-soft / shadow-glass / shadow-glow-card-hover 的用法）
        soft: 'var(--shadow-soft)',
        glass: 'var(--shadow-raised)',
        'glow-card-hover': 'var(--shadow-raised-lg)',
        // Soft UI 新键名：raised（浮起）/ raised-lg（悬浮）/ overlay（弹层）/ pressed（内凹）/ accent（主色）
        raised: 'var(--shadow-raised)',
        'raised-lg': 'var(--shadow-raised-lg)',
        overlay: 'var(--shadow-overlay)',
        pressed: 'var(--shadow-pressed)',
        accent: 'var(--shadow-accent)',
      },
      borderRadius: {
        // Soft UI 大圆角：卡片 rounded-3xl(24) / 按钮·输入 rounded-2xl(16) / 图标 rounded-full
        sm: '8px',
        DEFAULT: '12px',
        md: '12px',
        lg: '16px',
        xl: '16px',
        '2xl': '16px',
        '3xl': '24px',
        full: '9999px',
      },
      fontSize: {
        // 规范字号阶梯（11/13/14/15/18/24）+ 保留 display-lg/md 键名（值随规范微调）
        xs: '11px',
        sm: '13px',
        base: '14px',
        md: '15px',
        lg: '18px',
        xl: '24px',
        'display-lg': ['1.5rem', { lineHeight: '1.35' }],
        'display-md': ['1.125rem', { lineHeight: '1.4' }],
      },
    },
  },
  plugins: [],
} satisfies Config;
