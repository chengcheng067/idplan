import type { Config } from 'tailwindcss';

/**
 * ID 系列「Soft UI」design token 映射层（v0.5 双主题）
 *
 * 职责边界（重要）：
 *   - **色值本身不在本文件**，全部住在 src/styles/global.css 的 CSS 变量里
 *     （:root = 亮色默认，:root[data-theme='dark'] = 暗色）；
 *   - 本文件只负责「旧 token 名 → rgb(var(--x-rgb) / …)」的映射，
 *     因此 30+ 组件里的 bg-cream / bg-paper / border-sand / text-pine 一个 className 都不用改，
 *     随 <html data-theme> 整体换肤。
 *   - 组件内仍禁写裸色值 hex，一律引用这里的命名 token。
 *
 * 透明度修饰符（bg-pine/20、border-sand/60 等 50 处用法）如何生效：
 *   颜色值里预留 <alpha-value> 占位符，Tailwind 遇到 /20 就把它替换成 0.2，无修饰符时替换为 1。
 *   变量 --{name}-a 是该色的「默认 alpha」，让 sand 这类本就半透明的描边
 *   在不写修饰符时也是正确的淡描边，写 /60 时则变成 0.07×0.6 的相对淡度。
 */
const c = (name: string, fallbackAlpha = 1): string =>
  `rgb(var(--${name}-rgb) / calc(var(--${name}-a, ${fallbackAlpha}) * <alpha-value>))`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', './tests/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /** surface-base 应用底色（亮 #f8fafc / 暗 #14161a） */
        cream: c('cream'),
        /** surface-raised 卡片/面板底（亮 #fff / 暗 #1e2127） */
        paper: c('paper'),
        /** surface-sunken 输入框 / 内凹井（亮 #f1f5f9 / 暗 #101216） */
        sunken: c('sunken'),
        /** 1px 极弱描边 & hover 底纹（默认 alpha 0.07 / 暗 0.08） */
        sand: c('sand', 0.07),
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
