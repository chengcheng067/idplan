import { useLang } from '../../i18n';

/**
 * 分步引导各步的内联 SVG 插画（设计稿 §八-3：词汇取自软件自身组件语言）。
 *
 * 统一范式（与步骤 1「看板」同款，第二批 2~8 步沿用）：
 *   · viewBox 360×300，元素挂 `onb-in` + 60ms 递增延迟（错峰淡入 + 上移 8px，
 *     每段 --dur-base=200ms，末元素 ~400ms 收尾）；`prefers-reduced-motion`
 *     由 global.css 关停清单统一退化为直接呈现；
 *   · 色值**全部**走 `--color-*` / `--*-rgb` / 阶段色 token（亮暗自动跟随，零写死）；
 *   · 插画 aria-hidden，定位一律 data-onboarding-step-art={stepId}；
 *   · ⚠️ 不在 SVG 里写任何中文文案（源码硬编码中文棘轮）：需要「文字」的语义
 *     一律用抽象线条/色块表达，拉丁字母（A/D/E/H、{ }）豁免。
 */
const d = (i: number): { animationDelay: string } => ({ animationDelay: `${i * 60}ms` });

/* ══════════ 步骤 1 · 看板 ══════════ */

export function BoardArt(): JSX.Element {
  return (
    <svg
      viewBox="0 0 360 300"
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

/* ══════════ 步骤 2 · 月历 ══════════ */

export function CalendarArt(): JSX.Element {
  // 7 列 × 4 行月历网格（格高恒定的意象）；今天格用品牌浅底突出
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

      {/* 网格（第一行先入，其后逐行错峰） */}
      <g className="onb-in" style={d(1)}>
        {[0, 1, 2, 3, 4, 5, 6].map((c) => cell(c, 0))}
      </g>
      <g className="onb-in" style={d(2)}>
        {[0, 1, 2, 3, 4, 5, 6].map((c) => cell(c, 1))}
      </g>
      <g className="onb-in" style={d(3)}>
        {[0, 1, 2, 3, 4, 5, 6].map((c) => cell(c, 2))}
      </g>
      <g className="onb-in" style={d(4)}>
        {[0, 1, 2, 3, 4, 5, 6].map((c) => cell(c, 3, c === 3))}
      </g>

      {/* 色点条目（色点 + 项目名线条）：三个不同阶段色 */}
      <g className="onb-in" style={d(5)}>
        <circle cx="36" cy="46" r="4" fill="rgb(var(--stage-s2-rgb))" />
        <rect x="46" y="42" width="16" height="7" rx="3.5" fill="var(--color-line)" />
        <circle cx="82" cy="46" r="4" fill="rgb(var(--stage-s4-rgb))" />
        <circle cx="128" cy="92" r="4" fill="rgb(var(--stage-s6-rgb))" />
        <rect x="138" y="88" width="18" height="7" rx="3.5" fill="var(--color-line)" />
      </g>

      {/* 节假日标注：节日名胶囊（线条代字）+ 休息底纹格；调休补班 = 小琥珀方块标 */}
      <g className="onb-in" style={d(6)}>
        <rect x="198" y="150" width="34" height="14" rx="7" fill="rgb(var(--moss-soft-rgb))" />
        <rect x="204" y="155" width="22" height="4" rx="2" fill="rgb(var(--moss-rgb))" />
        <rect x="244" y="122" width="42" height="42" rx="8" fill="var(--color-rest-day)" stroke="var(--color-line)" />
        <rect x="336" y="122" width="42" height="42" rx="8" fill="rgb(var(--amber-soft-rgb))" stroke="rgb(var(--amber-rgb))" />
        <rect x="352" y="128" width="8" height="8" rx="2" fill="rgb(var(--amber-rgb))" />
      </g>

      {/* 当日浮层（点开任何一天）：今天格上浮出的小面板 */}
      <g className="onb-in" style={d(7)}>
        <rect x="150" y="196" width="120" height="52" rx="10" fill="var(--color-paper)" stroke="rgb(var(--pine-rgb))" />
        <rect x="162" y="208" width="40" height="7" rx="3.5" fill="var(--color-mist)" opacity=".6" />
        <circle cx="166" cy="228" r="4" fill="rgb(var(--stage-s2-rgb))" />
        <rect x="176" y="224" width="48" height="7" rx="3.5" fill="var(--color-line)" />
        <circle cx="166" cy="240" r="4" fill="rgb(var(--stage-s6-rgb))" />
        <rect x="176" y="236" width="36" height="7" rx="3.5" fill="var(--color-line)" />
      </g>
    </svg>
  );
}

/* ══════════ 步骤 3 · 甘特 / 时间轴 ══════════ */

export function TimelineArt(): JSX.Element {
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="timeline">
      {/* 行底纹（偶数行 sunken，与时间轴页同语义） */}
      <rect className="onb-in" style={d(0)} x="16" y="40" width="328" height="44" rx="8" fill="var(--color-paper)" stroke="var(--color-line)" />
      <rect className="onb-in" style={d(0)} x="16" y="96" width="328" height="44" rx="8" fill="var(--color-rest-day)" />
      <rect className="onb-in" style={d(0)} x="16" y="152" width="328" height="44" rx="8" fill="var(--color-paper)" stroke="var(--color-line)" />

      {/* 项目名行（左端线条代字） */}
      <rect className="onb-in" style={d(1)} x="28" y="58" width="44" height="8" rx="4" fill="var(--color-line)" />
      <rect className="onb-in" style={d(1)} x="28" y="114" width="36" height="8" rx="4" fill="var(--color-line)" />
      <rect className="onb-in" style={d(1)} x="28" y="170" width="50" height="8" rx="4" fill="var(--color-line)" />

      {/* 阶段条：三行错落起止，阶段色 token（band 宽面 + 实色描边） */}
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

      {/* 里程碑菱形 */}
      <rect className="onb-in" style={d(5)} x="250" y="168" width="14" height="14" transform="rotate(45 257 175)" fill="rgb(var(--pine-rgb))" />

      {/* 今天竖线（clay 竖线 + 顶帽，时间轴页同语义） */}
      <g className="onb-in" style={d(6)}>
        <rect x="316" y="30" width="2.5" height="176" fill="rgb(var(--clay-rgb))" />
        <rect x="306" y="20" width="22" height="12" rx="6" fill="rgb(var(--clay-soft-rgb))" stroke="rgb(var(--clay-rgb))" />
      </g>
    </svg>
  );
}

/* ══════════ 步骤 4 · 打印 ══════════ */

export function PrintArt(): JSX.Element {
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="print">
      {/* A4 纸张（竖版，微投影） */}
      <rect className="onb-in" style={d(0)} x="104" y="16" width="152" height="210" rx="6" fill="var(--color-paper)" stroke="var(--color-line)" />

      {/* 页内块 1：巨字标题区（两行粗题线 + 页头细线） */}
      <rect className="onb-in" style={d(1)} x="118" y="34" width="96" height="12" rx="3" fill="var(--color-ink)" opacity=".85" />
      <rect className="onb-in" style={d(1)} x="118" y="52" width="64" height="12" rx="3" fill="var(--color-ink)" opacity=".55" />
      <rect className="onb-in" style={d(2)} x="118" y="76" width="124" height="2" fill="var(--color-line)" />

      {/* 页内块 2：表格线（两段式数据主体意象） */}
      <g className="onb-in" style={d(3)}>
        <rect x="118" y="88" width="124" height="14" rx="3" fill="var(--color-rest-day)" />
        <rect x="118" y="108" width="90" height="6" rx="3" fill="var(--color-line)" />
        <rect x="118" y="122" width="110" height="6" rx="3" fill="var(--color-line)" />
        <rect x="118" y="136" width="74" height="6" rx="3" fill="var(--color-line)" />
      </g>

      {/* 页内块 3：甘特条带（排期块） */}
      <g className="onb-in" style={d(4)}>
        <rect x="118" y="156" width="70" height="12" rx="6" fill="rgb(var(--stage-band-s2-rgb))" stroke="rgb(var(--stage-s2-rgb))" />
        <rect x="196" y="156" width="46" height="12" rx="6" fill="rgb(var(--stage-band-s4-rgb))" stroke="rgb(var(--stage-s4-rgb))" />
      </g>

      {/* 模板胶囊：经典（宽片）+ A/D/E/H 字片（拉丁字母豁免硬编码中文棘轮） */}
      <g className="onb-in" style={d(5)}>
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
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="members">
      {/* 身份卡 1：管理员（品牌浅底 + 权杖圆点徽） */}
      <g className="onb-in" style={d(0)}>
        <rect x="24" y="28" width="140" height="88" rx="12" fill="rgb(var(--pine-soft-rgb))" stroke="rgb(var(--pine-rgb))" />
        <circle cx="56" cy="60" r="14" fill="rgb(var(--pine-rgb))" />
        <circle cx="56" cy="56" r="5" fill="#ffffff" opacity=".9" />
        <path d="M48 66 a8 6 0 0 1 16 0" fill="#ffffff" opacity=".9" />
        <rect x="82" y="50" width="56" height="8" rx="4" fill="rgb(var(--pine-rgb))" opacity=".85" />
        <rect x="82" y="66" width="40" height="6" rx="3" fill="rgb(var(--pine-rgb))" opacity=".45" />
        <rect x="40" y="92" width="44" height="12" rx="6" fill="rgb(var(--pine-rgb))" opacity=".9" />
      </g>

      {/* 身份卡 2：成员（纸面 + 人形） */}
      <g className="onb-in" style={d(1)}>
        <rect x="196" y="28" width="140" height="88" rx="12" fill="var(--color-paper)" stroke="var(--color-line)" />
        <circle cx="228" cy="60" r="14" fill="var(--color-rest-day)" stroke="var(--color-line)" />
        <circle cx="228" cy="56" r="5" fill="var(--color-mist)" />
        <path d="M220 66 a8 6 0 0 1 16 0" fill="var(--color-mist)" />
        <rect x="254" y="50" width="56" height="8" rx="4" fill="var(--color-line)" />
        <rect x="254" y="66" width="40" height="6" rx="3" fill="var(--color-rest-day)" />
        <rect x="212" y="92" width="44" height="12" rx="6" fill="var(--color-line)" />
      </g>

      {/* 区闸密码输入框：圆点掩码 + 光标 */}
      <g className="onb-in" style={d(2)}>
        <rect x="24" y="140" width="200" height="40" rx="10" fill="var(--color-paper)" stroke="var(--color-line)" />
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} cx={48 + i * 20} cy="160" r="4.5" fill="var(--color-mist)" />
        ))}
        <rect x="130" y="152" width="2" height="16" fill="rgb(var(--pine-rgb))" />
      </g>

      {/* 头像圆点组（成员色板意象）+ 停用置灰的一枚 */}
      <g className="onb-in" style={d(3)}>
        <circle cx="60" cy="220" r="12" fill="rgb(var(--pine-rgb))" />
        <circle cx="92" cy="220" r="12" fill="rgb(var(--moss-rgb))" />
        <circle cx="124" cy="220" r="12" fill="rgb(var(--amber-rgb))" />
        <circle cx="156" cy="220" r="12" fill="rgb(var(--rose-rgb))" />
        <circle cx="188" cy="220" r="12" fill="var(--color-rest-day)" stroke="var(--color-line)" strokeDasharray="3 3" />
      </g>
    </svg>
  );
}

/* ══════════ 步骤 6 · 数据与备份 ══════════ */

export function BackupArt(): JSX.Element {
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="backup">
      {/* 本机数据库圆柱（离线优先的「数据就在这」） */}
      <g className="onb-in" style={d(0)}>
        <path d="M40 70 a56 18 0 0 1 112 0 v96 a56 18 0 0 1 -112 0 z" fill="var(--color-paper)" stroke="var(--color-line)" />
        <ellipse cx="96" cy="70" rx="56" ry="18" fill="var(--color-rest-day)" stroke="var(--color-line)" />
        <path d="M40 118 a56 18 0 0 0 112 0" fill="none" stroke="var(--color-line)" />
        <path d="M40 166 a56 18 0 0 0 112 0" fill="none" stroke="var(--color-line)" />
      </g>

      {/* 导出箭头 */}
      <g className="onb-in" style={d(1)}>
        <rect x="176" y="128" width="56" height="3" rx="1.5" fill="rgb(var(--pine-rgb))" />
        <path d="M226 120 l16 9.5 -16 9.5 z" fill="rgb(var(--pine-rgb))" />
      </g>

      {/* JSON 备份文件卡（折角 + { } 括号 + 数据行） */}
      <g className="onb-in" style={d(2)}>
        <path d="M252 56 h56 l28 28 v116 a6 6 0 0 1 -6 6 h-78 a6 6 0 0 1 -6 -6 v-138 a6 6 0 0 1 6 -6 z" fill="var(--color-paper)" stroke="var(--color-line)" />
        <path d="M308 56 l28 28 h-24 a4 4 0 0 1 -4 -4 z" fill="var(--color-rest-day)" stroke="var(--color-line)" />
        <text x="266" y="130" fontSize="20" fill="rgb(var(--pine-rgb))" fontWeight="500">{'{ }'}</text>
        <rect x="266" y="146" width="56" height="6" rx="3" fill="var(--color-line)" />
        <rect x="266" y="160" width="40" height="6" rx="3" fill="var(--color-rest-day)" />
        <rect x="266" y="174" width="48" height="6" rx="3" fill="var(--color-line)" />
      </g>

      {/* 多工作区隔离：两枚独立小库并排（NAS 意象） */}
      <g className="onb-in" style={d(3)}>
        <rect x="60" y="236" width="70" height="26" rx="8" fill="var(--color-paper)" stroke="rgb(var(--pine-rgb))" />
        <rect x="74" y="246" width="42" height="6" rx="3" fill="rgb(var(--pine-rgb))" opacity=".8" />
        <rect x="150" y="236" width="70" height="26" rx="8" fill="var(--color-paper)" stroke="rgb(var(--moss-rgb))" />
        <rect x="164" y="246" width="42" height="6" rx="3" fill="rgb(var(--moss-rgb))" opacity=".8" />
      </g>
    </svg>
  );
}

/* ══════════ 步骤 7 · Agent 通道与行业库 ══════════ */

export function AgentArt(): JSX.Element {
  return (
    <svg viewBox="0 0 360 300" aria-hidden="true" className="h-auto w-full max-w-[420px]" data-onboarding-step-art="agent">
      {/* 自然语言输入：对话气泡（一句需求 = 两行线条） */}
      <g className="onb-in" style={d(0)}>
        <rect x="24" y="40" width="180" height="64" rx="14" fill="var(--color-paper)" stroke="var(--color-line)" />
        <path d="M56 104 l-8 18 22 -18 z" fill="var(--color-paper)" stroke="var(--color-line)" />
        <rect x="40" y="58" width="120" height="8" rx="4" fill="var(--color-ink)" opacity=".7" />
        <rect x="40" y="76" width="88" height="8" rx="4" fill="var(--color-line)" />
        <circle cx="182" cy="52" r="10" fill="rgb(var(--pine-soft-rgb))" stroke="rgb(var(--pine-rgb))" />
        <rect x="178" y="48" width="8" height="8" rx="2" fill="rgb(var(--pine-rgb))" />
      </g>

      {/* 处理中 → 确认：箭头 + 校验对勾 */}
      <g className="onb-in" style={d(1)}>
        <rect x="222" y="66" width="40" height="3" rx="1.5" fill="rgb(var(--pine-rgb))" />
        <path d="M256 58 l16 9.5 -16 9.5 z" fill="rgb(var(--pine-rgb))" />
      </g>

      {/* 产出：排期卡（标题行 + 阶段胶囊 + 甘特条 + 进度条），你确认后才入库 */}
      <g className="onb-in" style={d(2)}>
        <rect x="170" y="128" width="166" height="110" rx="12" fill="var(--color-paper)" stroke="var(--color-line)" />
        <rect x="186" y="144" width="72" height="9" rx="4.5" fill="var(--color-ink)" opacity=".75" />
        <rect x="186" y="162" width="52" height="14" rx="7" fill="rgb(var(--pine-soft-rgb))" />
        <rect x="252" y="164" width="60" height="10" rx="5" fill="rgb(var(--stage-band-s2-rgb))" stroke="rgb(var(--stage-s2-rgb))" />
        <rect x="186" y="188" width="120" height="10" rx="5" fill="rgb(var(--stage-band-s4-rgb))" stroke="rgb(var(--stage-s4-rgb))" />
        <rect x="186" y="212" width="134" height="6" rx="3" fill="var(--color-line)" />
        <rect x="186" y="212" width="58" height="6" rx="3" fill="rgb(var(--pine-rgb))" />
      </g>

      {/* 行业库三步：三枚小步骤片（复制 Prompt → 生成 → 导回校验） */}
      <g className="onb-in" style={d(3)}>
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x={24 + i * 78} y="236" width="64" height="26" rx="8" fill="var(--color-paper)" stroke={i === 2 ? 'rgb(var(--moss-rgb))' : 'var(--color-line)'} />
            <circle cx={38 + i * 78} cy="249" r="5" fill={i === 2 ? 'rgb(var(--moss-rgb))' : 'rgb(var(--pine-rgb))'} opacity=".8" />
            <rect x={48 + i * 78} y="246" width="28" height="6" rx="3" fill="var(--color-line)" />
          </g>
        ))}
      </g>
    </svg>
  );
}

/* ══════════ 步骤 8 · 插件 ══════════ */

export function PluginsArt(): JSX.Element {
  // 三张插件卡：图标方块 + 名称行 + 独立开关胶囊（on×2 / off×1）
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

      {/* 从文件安装：虚线卡 + 上传箭头 */}
      <g className="onb-in" style={d(3)}>
        <rect x="186" y="96" width="150" height="56" rx="12" fill="var(--color-rest-day)" stroke="var(--color-line)" strokeDasharray="6 5" />
        <rect x="206" y="110" width="28" height="28" rx="8" fill="var(--color-paper)" stroke="rgb(var(--pine-rgb))" />
        <path d="M220 128 v-8 m0 0 l-5 5 m5 -5 l5 5" stroke="rgb(var(--pine-rgb))" strokeWidth="2" fill="none" strokeLinecap="round" />
        <rect x="244" y="118" width="72" height="7" rx="3.5" fill="var(--color-line)" />
      </g>

      {/* 每插件自带设置：齿轮 */}
      <g className="onb-in" style={d(4)}>
        <circle cx="96" cy="216" r="26" fill="var(--color-paper)" stroke="var(--color-mist)" />
        <circle cx="96" cy="216" r="10" fill="var(--color-rest-day)" stroke="var(--color-mist)" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect key={deg} x="94" y="182" width="4" height="10" rx="2" fill="var(--color-mist)" transform={`rotate(${deg} 96 216)`} />
        ))}
      </g>
    </svg>
  );
}
