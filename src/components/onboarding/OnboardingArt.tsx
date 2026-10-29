import { useLang } from '../../i18n';

/**
 * 分步引导各步的内联 SVG 插画（设计稿 §八-3：词汇取自软件自身组件语言）。
 *
 * 统一范式（第二批落地、第三批加标签）：
 *   · viewBox 360×300，元素挂 `onb-in` + 60ms 递增延迟（错峰淡入 + 上移 8px，
 *     每段 --dur-base=200ms，末元素 ~400ms 收尾）；`prefers-reduced-motion`
 *     由 global.css 关停清单统一退化为直接呈现；
 *   · 色值**全部**走 `--color-*` / `--*-rgb` / 阶段色 token（亮暗自动跟随，零写死）；
 *   · 插画整幅 aria-hidden（装饰性，标签不重复念给屏幕阅读器）；
 *     定位一律 data-onboarding-step-art={stepId}；
 *   · ★ 文字标签（第三批，她 2026-10-30 批注「纯图形太抽象看不懂」）：
 *     每幅 2~4 个，取自软件自身的**功能词**，全部走消息表
 *     （`onboarding.art.<stepId>.<slot>`）—— **源码不许出现中文文本字面量**
 *     （硬编码中文棘轮）。标签挂 `data-art-label=""`（spec 按它计数，语言无关），
 *     字号 9，fill 走 `--color-mist`（需强调的 `--color-ink`），亮暗自动翻转；
 *     动画挂在**对应元素的同一延迟档或紧随其后**（总长仍 ≤400ms）。
 *   · ⚠️ 例外两类**非文案**符号：模板字母 A/D/E/H 与 JSON 的 `{ }` —— 它们是符号
 *     不是语句，且属拉丁字符（中英同形），不进消息表。
 */
const d = (i: number): { animationDelay: string } => ({ animationDelay: `${i * 60}ms` });

/** 标签 <text> 的公共属性（字号 9；强调档传 ink=true） */
function label(
  x: number,
  y: number,
  ink = false,
): { x: number; y: number; fontSize: 9; fill: string; 'data-art-label': string } {
  return {
    x,
    y,
    fontSize: 9,
    fill: ink ? 'var(--color-ink)' : 'var(--color-mist)',
    'data-art-label': '',
  };
}

/* ══════════ 步骤 1 · 看板（4 条轨道 —— 我们是 4 列看板，不是 3 列） ══════════ */

export function BoardArt(): JSX.Element {
  const { t } = useLang();
  // 4 轨：x = 17 / 101 / 185 / 269，宽 74，间距 10（360×300 内均分）
  const tracks = [17, 101, 185, 269];
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="board">
      {tracks.map((x, i) => (
        <rect
          key={x}
          className="onb-in"
          style={d(i)}
          x={x}
          y="24"
          width="74"
          height="240"
          rx="12"
          fill="var(--color-paper)"
          stroke="var(--color-line)"
        />
      ))}

      {/* 轨道 1：项目名（标签即行本身）+ 任务卡（标题行 / 阶段胶囊 / 进度条） */}
      <text className="onb-in" style={d(3)} {...label(25, 48, true)}>
        {t('onboarding.art.board.project')}
      </text>
      <rect className="onb-in" style={d(4)} x="25" y="58" width="58" height="58" rx="9" fill="var(--color-paper)" stroke="var(--color-line)" />
      <rect className="onb-in" style={d(5)} x="33" y="70" width="36" height="6" rx="3" fill="var(--color-mist)" opacity=".5" />
      <rect className="onb-in" style={d(6)} x="33" y="84" width="44" height="12" rx="6" fill="rgb(var(--pine-soft-rgb))" />
      <text className="onb-in" style={d(6)} {...label(33, 108)}>
        {t('onboarding.art.board.stage')}
      </text>
      <rect className="onb-in" style={d(7)} x="33" y="196" width="46" height="5" rx="2.5" fill="var(--color-line)" />
      <rect className="onb-in" style={d(8)} x="33" y="196" width="18" height="5" rx="2.5" fill="rgb(var(--pine-rgb))" />
      <text className="onb-in" style={d(8)} {...label(33, 214)}>
        {t('onboarding.art.board.progress')}
      </text>

      {/* 轨道 2：品牌色主任务卡（标题行 + 头像圆点 = 成员） */}
      <g className="onb-in" style={d(5)}>
        <rect x="109" y="70" width="58" height="60" rx="9" fill="rgb(var(--pine-rgb))" />
        <rect x="117" y="84" width="32" height="5" rx="2.5" fill="#ffffff" opacity=".9" />
        <rect x="117" y="96" width="44" height="4" rx="2" fill="#ffffff" opacity=".55" />
        <circle cx="155" cy="120" r="6.5" fill="#ffffff" opacity=".85" />
      </g>
      <text className="onb-in" style={d(6)} {...label(109, 146)}>
        {t('onboarding.art.board.member')}
      </text>

      {/* 轨道 3：临期胶囊 + 空槽 */}
      <rect className="onb-in" style={d(7)} x="193" y="70" width="40" height="12" rx="6" fill="rgb(var(--amber-soft-rgb))" />
      <rect className="onb-in" style={d(7)} x="193" y="70" width="40" height="12" rx="6" fill="none" stroke="rgb(var(--amber-rgb))" />
      <rect className="onb-in" style={d(8)} x="193" y="110" width="58" height="36" rx="9" fill="var(--color-rest-day)" />

      {/* 轨道 4：占位行 + 今天胶囊（月历词汇的呼应） */}
      <rect className="onb-in" style={d(8)} x="277" y="48" width="44" height="7" rx="3.5" fill="var(--color-line)" />
      <rect className="onb-in" style={d(8)} x="277" y="66" width="30" height="7" rx="3.5" fill="var(--color-rest-day)" />
      <g className="onb-in" style={d(9)}>
        <rect x="277" y="196" width="58" height="22" rx="11" fill="rgb(var(--pine-soft-rgb))" />
        <rect x="277" y="196" width="58" height="22" rx="11" fill="none" stroke="rgb(var(--pine-rgb))" />
        <rect x="291" y="204" width="30" height="6" rx="3" fill="rgb(var(--pine-rgb))" />
      </g>
    </svg>
  );
}

/* ══════════ 步骤 2 · 月历 ══════════ */

export function CalendarArt(): JSX.Element {
  const { t } = useLang();
  const cell = (x: number, y: number, today = false): JSX.Element => (
    <rect
      x={24 + x * 46}
      y={30 + y * 46}
      width="42"
      height="42"
      rx="8"
      fill={today ? 'rgb(var(--pine-soft-rgb))' : 'var(--color-paper)'}
      stroke={today ? 'rgb(var(--pine-rgb))' : 'var(--color-line)'}
    />
  );
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="calendar">
      {/* 顶栏：月份行 */}
      <rect className="onb-in" style={d(0)} x="24" y="8" width="72" height="10" rx="5" fill="var(--color-line)" />

      {/* 网格 7 列 × 3 行（格高恒定的意象） */}
      <g className="onb-in" style={d(1)}>
        {[0, 1, 2, 3, 4, 5, 6].map((c) => cell(c, 0))}
      </g>
      <g className="onb-in" style={d(2)}>
        {[0, 1, 2, 3, 4, 5, 6].map((c) => cell(c, 1))}
      </g>
      <g className="onb-in" style={d(3)}>
        {[0, 1, 2, 3, 4, 5, 6].map((c) => cell(c, 2, c === 2))}
      </g>

      {/* 节假日胶囊（节日名 = 线条代字）+ 休息日格 + 补班格（琥珀方块标） */}
      <g className="onb-in" style={d(4)}>
        <rect x="212" y="128" width="34" height="14" rx="7" fill="rgb(var(--moss-soft-rgb))" />
        <rect x="218" y="133" width="22" height="4" rx="2" fill="rgb(var(--moss-rgb))" />
        <rect x="254" y="122" width="42" height="42" rx="8" fill="var(--color-rest-day)" stroke="var(--color-line)" />
        <rect x="300" y="122" width="42" height="42" rx="8" fill="rgb(var(--amber-soft-rgb))" stroke="rgb(var(--amber-rgb))" />
        <rect x="312" y="128" width="8" height="8" rx="2" fill="rgb(var(--amber-rgb))" />
      </g>

      {/* 标签：节假日 / 补班（贴各自格子下方） */}
      <text className="onb-in" style={d(5)} {...label(206, 178)}>
        {t('onboarding.art.calendar.holiday')}
      </text>
      <text className="onb-in" style={d(5)} {...label(298, 178)}>
        {t('onboarding.art.calendar.makeup')}
      </text>

      {/* 图例：色点 + 项目名 / 今日高亮格 */}
      <g className="onb-in" style={d(6)}>
        <circle cx="30" cy="190" r="4" fill="rgb(var(--stage-s2-rgb))" />
        <rect x="40" y="186" width="44" height="7" rx="3.5" fill="var(--color-line)" />
      </g>
      <text className="onb-in" style={d(6)} {...label(90, 193)}>
        {t('onboarding.art.calendar.project')}
      </text>
      <rect className="onb-in" style={d(7)} x="150" y="186" width="14" height="14" rx="4" fill="rgb(var(--pine-soft-rgb))" stroke="rgb(var(--pine-rgb))" />
      <text className="onb-in" style={d(7)} {...label(170, 193)}>
        {t('onboarding.art.calendar.today')}
      </text>

      {/* 当日浮层（点开任何一天） */}
      <g className="onb-in" style={d(8)}>
        <rect x="150" y="208" width="120" height="52" rx="10" fill="var(--color-paper)" stroke="rgb(var(--pine-rgb))" />
        <rect x="162" y="220" width="40" height="7" rx="3.5" fill="var(--color-mist)" opacity=".6" />
        <circle cx="166" cy="240" r="4" fill="rgb(var(--stage-s2-rgb))" />
        <rect x="176" y="236" width="48" height="7" rx="3.5" fill="var(--color-line)" />
        <circle cx="166" cy="252" r="4" fill="rgb(var(--stage-s6-rgb))" />
        <rect x="176" y="248" width="36" height="7" rx="3.5" fill="var(--color-line)" />
      </g>
    </svg>
  );
}

/* ══════════ 步骤 3 · 甘特 / 时间轴 ══════════ */

export function TimelineArt(): JSX.Element {
  const { t } = useLang();
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="timeline">
      {/* 行底纹（偶数行 sunken，与时间轴页同语义） */}
      <rect className="onb-in" style={d(0)} x="16" y="40" width="328" height="44" rx="8" fill="var(--color-paper)" stroke="var(--color-line)" />
      <rect className="onb-in" style={d(0)} x="16" y="96" width="328" height="44" rx="8" fill="var(--color-rest-day)" />
      <rect className="onb-in" style={d(0)} x="16" y="152" width="328" height="44" rx="8" fill="var(--color-paper)" stroke="var(--color-line)" />

      {/* 项目名（行首标签）+ 另两行保留抽象名行 */}
      <text className="onb-in" style={d(1)} {...label(28, 62, true)}>
        {t('onboarding.art.timeline.project')}
      </text>
      <rect className="onb-in" style={d(1)} x="28" y="114" width="36" height="8" rx="4" fill="var(--color-line)" />
      <rect className="onb-in" style={d(1)} x="28" y="170" width="50" height="8" rx="4" fill="var(--color-line)" />

      {/* 阶段条：三行错落起止（stage-band 宽面 + 实色描边） */}
      <g className="onb-in" style={d(2)}>
        <rect x="96" y="52" width="130" height="20" rx="10" fill="rgb(var(--stage-band-s2-rgb))" stroke="rgb(var(--stage-s2-rgb))" />
        <rect x="240" y="52" width="76" height="20" rx="10" fill="rgb(var(--stage-band-s3-rgb))" stroke="rgb(var(--stage-s3-rgb))" />
      </g>
      <g className="onb-in" style={d(3)}>
        <rect x="60" y="108" width="150" height="20" rx="10" fill="rgb(var(--stage-band-s4-rgb))" stroke="rgb(var(--stage-s4-rgb))" />
        <rect x="226" y="108" width="96" height="20" rx="10" fill="rgb(var(--stage-band-s6-rgb))" stroke="rgb(var(--stage-s6-rgb))" />
      </g>
      <g className="onb-in" style={d(4)}>
        <rect x="120" y="164" width="180" height="20" rx="10" fill="rgb(var(--stage-band-s8-rgb))" stroke="rgb(var(--stage-s8-rgb))" />
      </g>
      <text className="onb-in" style={d(2)} {...label(96, 82)}>
        {t('onboarding.art.timeline.stage')}
      </text>

      {/* 里程碑菱形 */}
      <rect className="onb-in" style={d(5)} x="250" y="168" width="14" height="14" transform="rotate(45 257 175)" fill="rgb(var(--pine-rgb))" />
      <text className="onb-in" style={d(5)} {...label(272, 178)}>
        {t('onboarding.art.timeline.milestone')}
      </text>

      {/* 今天竖线（clay 竖线 + 顶帽） */}
      <g className="onb-in" style={d(6)}>
        <rect x="316" y="30" width="2.5" height="176" fill="rgb(var(--clay-rgb))" />
        <rect x="306" y="20" width="22" height="12" rx="6" fill="rgb(var(--clay-soft-rgb))" stroke="rgb(var(--clay-rgb))" />
      </g>
      <text className="onb-in" style={d(6)} {...label(276, 29)}>
        {t('onboarding.art.timeline.today')}
      </text>
    </svg>
  );
}

/* ══════════ 步骤 4 · 打印 ══════════ */

export function PrintArt(): JSX.Element {
  const { t } = useLang();
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="print">
      {/* A4 纸张（竖版） */}
      <rect className="onb-in" style={d(0)} x="104" y="16" width="152" height="210" rx="6" fill="var(--color-paper)" stroke="var(--color-line)" />

      {/* 页内块 1：巨字标题区 + 项目名（页头） */}
      <rect className="onb-in" style={d(1)} x="118" y="34" width="96" height="12" rx="3" fill="var(--color-ink)" opacity=".85" />
      <rect className="onb-in" style={d(1)} x="118" y="52" width="64" height="12" rx="3" fill="var(--color-ink)" opacity=".55" />
      <text className="onb-in" style={d(1)} {...label(214, 42)}>
        {t('onboarding.art.print.project')}
      </text>
      <rect className="onb-in" style={d(2)} x="118" y="74" width="124" height="2" fill="var(--color-line)" />

      {/* 页内块 2：表格（阶段清单） */}
      <g className="onb-in" style={d(3)}>
        <rect x="118" y="84" width="124" height="14" rx="3" fill="var(--color-rest-day)" />
        <rect x="118" y="104" width="90" height="6" rx="3" fill="var(--color-line)" />
        <rect x="118" y="118" width="110" height="6" rx="3" fill="var(--color-line)" />
        <rect x="118" y="132" width="74" height="6" rx="3" fill="var(--color-line)" />
      </g>
      <text className="onb-in" style={d(3)} {...label(118, 148)}>
        {t('onboarding.art.print.stageList')}
      </text>

      {/* 页内块 3：甘特条带 + 页脚 */}
      <g className="onb-in" style={d(4)}>
        <rect x="118" y="160" width="70" height="12" rx="6" fill="rgb(var(--stage-band-s2-rgb))" stroke="rgb(var(--stage-s2-rgb))" />
        <rect x="196" y="160" width="46" height="12" rx="6" fill="rgb(var(--stage-band-s4-rgb))" stroke="rgb(var(--stage-s4-rgb))" />
        <rect x="118" y="184" width="124" height="2" fill="var(--color-line)" />
      </g>
      <text className="onb-in" style={d(4)} {...label(118, 200)}>
        {t('onboarding.art.print.footer')}
      </text>

      {/* 模板胶囊：经典（宽片）+ A/D/E/H 字片（拉丁符号，非文案，不进消息表） */}
      <text className="onb-in" style={d(5)} {...label(24, 240)}>
        {t('onboarding.art.print.template')}
      </text>
      <g className="onb-in" style={d(6)}>
        <rect x="24" y="248" width="72" height="26" rx="13" fill="rgb(var(--pine-soft-rgb))" stroke="rgb(var(--pine-rgb))" />
        <rect x="36" y="258" width="48" height="6" rx="3" fill="rgb(var(--pine-rgb))" />
        {['A', 'D', 'E', 'H'].map((ch, i) => (
          <g key={ch}>
            <rect x={112 + i * 34} y="248" width="28" height="26" rx="8" fill="var(--color-paper)" stroke="var(--color-line)" />
            <text x={126 + i * 34} y="266" textAnchor="middle" fontSize="13" fill="var(--color-mist)" fontWeight="500">
              {ch}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/* ══════════ 步骤 5 · 成员与身份 ══════════ */

export function MembersArt(): JSX.Element {
  const { t } = useLang();
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="members">
      {/* 身份卡 1：管理员（品牌浅底 + 权杖圆点徽） */}
      <g className="onb-in" style={d(0)}>
        <rect x="24" y="28" width="140" height="88" rx="12" fill="rgb(var(--pine-soft-rgb))" stroke="rgb(var(--pine-rgb))" />
        <circle cx="56" cy="60" r="14" fill="rgb(var(--pine-rgb))" />
        <circle cx="56" cy="56" r="5" fill="#ffffff" opacity=".9" />
        <path d="M48 66 a8 6 0 0 1 16 0" fill="#ffffff" opacity=".9" />
        <rect x="82" y="70" width="40" height="6" rx="3" fill="rgb(var(--pine-rgb))" opacity=".45" />
        <rect x="40" y="92" width="44" height="12" rx="6" fill="rgb(var(--pine-rgb))" opacity=".9" />
      </g>
      <text className="onb-in" style={d(1)} {...label(82, 54, true)}>
        {t('onboarding.art.members.admin')}
      </text>

      {/* 身份卡 2：成员（纸面 + 人形） */}
      <g className="onb-in" style={d(2)}>
        <rect x="196" y="28" width="140" height="88" rx="12" fill="var(--color-paper)" stroke="var(--color-line)" />
        <circle cx="228" cy="60" r="14" fill="var(--color-rest-day)" stroke="var(--color-line)" />
        <circle cx="228" cy="56" r="5" fill="var(--color-mist)" />
        <path d="M220 66 a8 6 0 0 1 16 0" fill="var(--color-mist)" />
        <rect x="254" y="70" width="40" height="6" rx="3" fill="var(--color-rest-day)" />
        <rect x="212" y="92" width="44" height="12" rx="6" fill="var(--color-line)" />
      </g>
      <text className="onb-in" style={d(3)} {...label(254, 54, true)}>
        {t('onboarding.art.members.member')}
      </text>

      {/* 区闸密码输入框：圆点掩码 + 光标 */}
      <g className="onb-in" style={d(4)}>
        <rect x="24" y="140" width="200" height="40" rx="10" fill="var(--color-paper)" stroke="var(--color-line)" />
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} cx={48 + i * 20} cy="160" r="4.5" fill="var(--color-mist)" />
        ))}
        <rect x="130" y="152" width="2" height="16" fill="rgb(var(--pine-rgb))" />
      </g>
      <text className="onb-in" style={d(4)} {...label(24, 196)}>
        {t('onboarding.art.members.password')}
      </text>

      {/* 头像圆点组（成员色板意象）+ 停用置灰的一枚 */}
      <g className="onb-in" style={d(5)}>
        <circle cx="60" cy="234" r="12" fill="rgb(var(--pine-rgb))" />
        <circle cx="92" cy="234" r="12" fill="rgb(var(--moss-rgb))" />
        <circle cx="124" cy="234" r="12" fill="rgb(var(--amber-rgb))" />
        <circle cx="156" cy="234" r="12" fill="rgb(var(--rose-rgb))" />
        <circle cx="188" cy="234" r="12" fill="var(--color-rest-day)" stroke="var(--color-line)" strokeDasharray="3 3" />
      </g>
    </svg>
  );
}

/* ══════════ 步骤 6 · 数据与备份 ══════════ */

export function BackupArt(): JSX.Element {
  const { t } = useLang();
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="backup">
      {/* 本机数据库圆柱（离线优先的「数据就在这」） */}
      <g className="onb-in" style={d(0)}>
        <path d="M40 70 a56 18 0 0 1 112 0 v96 a56 18 0 0 1 -112 0 z" fill="var(--color-paper)" stroke="var(--color-line)" />
        <ellipse cx="96" cy="70" rx="56" ry="18" fill="var(--color-rest-day)" stroke="var(--color-line)" />
        <path d="M40 118 a56 18 0 0 0 112 0" fill="none" stroke="var(--color-line)" />
        <path d="M40 166 a56 18 0 0 0 112 0" fill="none" stroke="var(--color-line)" />
      </g>
      <text className="onb-in" style={d(1)} {...label(40, 194)}>
        {t('onboarding.art.backup.localData')}
      </text>

      {/* 导出箭头 */}
      <g className="onb-in" style={d(2)}>
        <rect x="176" y="128" width="56" height="3" rx="1.5" fill="rgb(var(--pine-rgb))" />
        <path d="M226 120 l16 9.5 -16 9.5 z" fill="rgb(var(--pine-rgb))" />
      </g>

      {/* JSON 备份文件卡（折角 + { } 符号 + 数据行） */}
      <g className="onb-in" style={d(3)}>
        <path d="M252 56 h56 l28 28 v112 a6 6 0 0 1 -6 6 h-78 a6 6 0 0 1 -6 -6 v-134 a6 6 0 0 1 6 -6 z" fill="var(--color-paper)" stroke="var(--color-line)" />
        <path d="M308 56 l28 28 h-24 a4 4 0 0 1 -4 -4 z" fill="var(--color-rest-day)" stroke="var(--color-line)" />
        <text x="266" y="130" fontSize="20" fill="rgb(var(--pine-rgb))" fontWeight="500">{'{ }'}</text>
        <rect x="266" y="146" width="56" height="6" rx="3" fill="var(--color-line)" />
        <rect x="266" y="160" width="40" height="6" rx="3" fill="var(--color-rest-day)" />
        <rect x="266" y="174" width="48" height="6" rx="3" fill="var(--color-line)" />
      </g>
      <text className="onb-in" style={d(3)} {...label(252, 222)}>
        {t('onboarding.art.backup.json')}
      </text>

      {/* 多工作区隔离：两枚独立小库并排（NAS 意象） */}
      <g className="onb-in" style={d(4)}>
        <rect x="60" y="248" width="70" height="26" rx="8" fill="var(--color-paper)" stroke="rgb(var(--pine-rgb))" />
        <rect x="74" y="258" width="42" height="6" rx="3" fill="rgb(var(--pine-rgb))" opacity=".8" />
        <rect x="150" y="248" width="70" height="26" rx="8" fill="var(--color-paper)" stroke="rgb(var(--moss-rgb))" />
        <rect x="164" y="258" width="42" height="6" rx="3" fill="rgb(var(--moss-rgb))" opacity=".8" />
      </g>
      <text className="onb-in" style={d(4)} {...label(60, 290)}>
        {t('onboarding.art.backup.workspace')}
      </text>
    </svg>
  );
}

/* ══════════ 步骤 7 · Agent 通道与行业库 ══════════ */

export function AgentArt(): JSX.Element {
  const { t } = useLang();
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="agent">
      {/* 自然语言输入：对话气泡（一句需求 = 两行线条）+ 发送圆点 */}
      <g className="onb-in" style={d(0)}>
        <rect x="24" y="40" width="180" height="64" rx="14" fill="var(--color-paper)" stroke="var(--color-line)" />
        <path d="M56 104 l-8 18 22 -18 z" fill="var(--color-paper)" stroke="var(--color-line)" />
        <rect x="40" y="58" width="120" height="8" rx="4" fill="var(--color-ink)" opacity=".7" />
        <rect x="40" y="76" width="88" height="8" rx="4" fill="var(--color-line)" />
        <circle cx="182" cy="52" r="10" fill="rgb(var(--pine-soft-rgb))" stroke="rgb(var(--pine-rgb))" />
        <rect x="178" y="48" width="8" height="8" rx="2" fill="rgb(var(--pine-rgb))" />
      </g>
      <text className="onb-in" style={d(1)} {...label(24, 136)}>
        {t('onboarding.art.agent.request')}
      </text>

      {/* 处理中 → 产出：箭头 + 排期草稿卡（确认后才入库） */}
      <g className="onb-in" style={d(2)}>
        <rect x="222" y="66" width="40" height="3" rx="1.5" fill="rgb(var(--pine-rgb))" />
        <path d="M256 58 l16 9.5 -16 9.5 z" fill="rgb(var(--pine-rgb))" />
      </g>
      <text className="onb-in" style={d(3)} {...label(170, 122)}>
        {t('onboarding.art.agent.draft')}
      </text>
      <g className="onb-in" style={d(3)}>
        <rect x="170" y="128" width="166" height="110" rx="12" fill="var(--color-paper)" stroke="var(--color-line)" />
        <rect x="186" y="144" width="72" height="9" rx="4.5" fill="var(--color-ink)" opacity=".75" />
        <rect x="186" y="162" width="52" height="14" rx="7" fill="rgb(var(--pine-soft-rgb))" />
        <rect x="252" y="164" width="60" height="10" rx="5" fill="rgb(var(--stage-band-s2-rgb))" stroke="rgb(var(--stage-s2-rgb))" />
        <rect x="186" y="188" width="120" height="10" rx="5" fill="rgb(var(--stage-band-s4-rgb))" stroke="rgb(var(--stage-s4-rgb))" />
        <rect x="186" y="212" width="134" height="6" rx="3" fill="var(--color-line)" />
        <rect x="186" y="212" width="58" height="6" rx="3" fill="rgb(var(--pine-rgb))" />
      </g>

      {/* 行业库三步：复制 Prompt → Agent 生成 → 导回校验 */}
      <g className="onb-in" style={d(4)}>
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x={24 + i * 78} y="254" width="64" height="26" rx="8" fill="var(--color-paper)" stroke={i === 2 ? 'rgb(var(--moss-rgb))' : 'var(--color-line)'} />
            <circle cx={38 + i * 78} cy="267" r="5" fill={i === 2 ? 'rgb(var(--moss-rgb))' : 'rgb(var(--pine-rgb))'} opacity=".8" />
            <rect x={48 + i * 78} y="264" width="28" height="6" rx="3" fill="var(--color-line)" />
          </g>
        ))}
      </g>
      <text className="onb-in" style={d(4)} {...label(180, 248)}>
        {t('onboarding.art.agent.validate')}
      </text>
    </svg>
  );
}

/* ══════════ 步骤 8 · 插件 ══════════ */

export function PluginsArt(): JSX.Element {
  const { t } = useLang();
  const card = (x: number, y: number, on: boolean, i: number): JSX.Element => (
    <g className="onb-in" style={d(i)}>
      <rect x={x} y={y} width="150" height="56" rx="12" fill="var(--color-paper)" stroke="var(--color-line)" />
      <rect x={x + 14} y={y + 14} width="28" height="28" rx="8" fill="rgb(var(--pine-soft-rgb))" />
      <circle cx={x + 28} cy={y + 28} r="7" fill="rgb(var(--pine-rgb))" opacity=".8" />
      <rect x={x + 52} y={y + 16} width="52" height="7" rx="3.5" fill="var(--color-ink)" opacity=".65" />
      <rect x={x + 52} y={y + 30} width="36" height="6" rx="3" fill="var(--color-line)" />
      {/* 开关胶囊：on = pine 底白钮在右；off = line 底灰钮在左 */}
      <rect x={x + 104} y={y + 20} width="32" height="16" rx="8" fill={on ? 'rgb(var(--pine-rgb))' : 'var(--color-line)'} />
      <circle cx={on ? x + 128 : x + 112} cy={y + 28} r="6" fill="#ffffff" />
    </g>
  );
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="plugins">
      {card(24, 24, true, 0)}
      {card(186, 24, true, 1)}
      {card(24, 96, false, 2)}

      {/* 标签：已启用 / 已关闭（各贴对应卡下方） */}
      <text className="onb-in" style={d(1)} {...label(24, 92)}>
        {t('onboarding.art.plugins.enabled')}
      </text>
      <text className="onb-in" style={d(3)} {...label(24, 164)}>
        {t('onboarding.art.plugins.disabled')}
      </text>

      {/* 从文件安装：虚线卡 + 上传箭头 */}
      <g className="onb-in" style={d(4)}>
        <rect x="186" y="96" width="150" height="56" rx="12" fill="var(--color-rest-day)" stroke="var(--color-line)" strokeDasharray="6 5" />
        <rect x="206" y="110" width="28" height="28" rx="8" fill="var(--color-paper)" stroke="rgb(var(--pine-rgb))" />
        <path d="M220 128 v-8 m0 0 l-5 5 m5 -5 l5 5" stroke="rgb(var(--pine-rgb))" strokeWidth="2" fill="none" strokeLinecap="round" />
        <rect x="244" y="118" width="72" height="7" rx="3.5" fill="var(--color-line)" />
      </g>
      <text className="onb-in" style={d(4)} {...label(186, 164)}>
        {t('onboarding.art.plugins.install')}
      </text>

      {/* 每插件自带设置：齿轮 */}
      <g className="onb-in" style={d(5)}>
        <circle cx="96" cy="222" r="26" fill="var(--color-paper)" stroke="var(--color-mist)" />
        <circle cx="96" cy="222" r="10" fill="var(--color-rest-day)" stroke="var(--color-mist)" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect key={deg} x="94" y="188" width="4" height="10" rx="2" fill="var(--color-mist)" transform={`rotate(${deg} 96 222)`} />
        ))}
      </g>
    </svg>
  );
}
