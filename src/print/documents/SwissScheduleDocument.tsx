/**
 * A 版 · Swiss Schedule（交通黄时刻表；01 文档 §4 / 02 文档 §6）。
 *
 * ── 为什么独立组件而不是塞进 SchedulePaper ──
 * 01 §1：「不能把四版实现为同一个 DOM 骨架加不同颜色；每版主体布局必须独立」。
 * A 的纸面就是交通黄整幅 + 黑顶/底栏 + 密集横线三列错落，与经典纸面
 * （白底甘特 + 清单表）零共享结构。可共享的只有 `.a4-page` 纸面类与
 * 打印分页规则（global.css 的 @media print 块，靠类名命中）。
 *
 * ── 视觉契约（02 §6 token）──
 *   --swiss-yellow #F2D957（纸面 = --tpl-accent 槽位）
 *   --swiss-black #191816（主文字 = --tpl-ink；顶/底栏栏底 = --tpl-line）
 *   顶/底栏左右内缩 40px、黄字反白；项目名居中被做「站名」；英文栏目
 *   PROJECT / TASK / DELAY / TEAM DEPARTURES。三列错落、数字优先、
 *   不用卡片堆叠。状态一律「文字 + 字形（实心/空心/形状）」双编码——
 *   灰度打印下不靠色相（01 §2）。
 *
 * ── 配色槽位 ──
 * 三枚经 `.print-root` 的 inline CSS 变量挂载（--tpl-accent / --tpl-ink /
 * --tpl-line；A 的 accent 兼纸面，见 print-palette.ts 文件头）。inline style
 * 经 print-frame 的 cloneNode(true) 原样进 iframe 打印面，无损。
 */

import type { CSSProperties, Ref } from 'react';

import { MemberActorKind, StageStatus, TASK_STATUS_LABELS } from '../../core/types/enums';
import { formatTaskNo } from '../../core/lib/task-no';
import { relativeLuminance } from '../../core/color/contrast';
import { A4_WIDTH_PX, A4_HEIGHT_PX } from '../../lib/schedule-print';
import { enabledSheetsOf, printTemplateClass } from '../../components/print/print-templates';
import type { PrintSheet } from '../../components/print/print-templates';

import type {
  PrintPageKind,
  PrintStageLogVM,
  PrintStageVM,
  PrintViewModel,
} from '../model/print-view-model';
import type { PrintPalette } from '../model/print-palette';
import { EmptyPrintState } from '../parts/EmptyPrintState';
import { PrintLogoMark } from '../parts/PrintLogoMark';
import { GenericModuleBody } from '../pages/generic/GenericModuleBody';
import {
  GENERIC_TITLES,
  isGenericRenderable,
  planGenericModule,
  type GenericPlan,
} from '../pages/generic/shared';
// A 版样式（Vite 随组件 chunk 进包；全部规则带 .print-root.print-template-* 前缀）
import '../styles/swiss-schedule.css';

/** A 版四页（02 §6 组件映射；顺序即纸面顺序） */
export const SWISS_SCHEDULE_PAGES: readonly PrintPageKind[] = [
  'stage-overview',
  'task-register',
  'delay-ledger',
  'member-roster',
];

/** 英文栏目（01 §4：项目名居中被做站名，栏目用这四枚） */
const SWISS_NAV: ReadonlyArray<{ kind: PrintPageKind; en: string }> = [
  { kind: 'stage-overview', en: 'PROJECT' },
  { kind: 'task-register', en: 'TASK' },
  { kind: 'delay-ledger', en: 'DELAY' },
  { kind: 'member-roster', en: 'TEAM DEPARTURES' },
];

/**
 * 页题（黑顶栏中文页题 + 板头副标题）。
 *
 * 参考稿 A P1 的站位（`A-swiss-schedule-p1.png` 实测）：
 *   · 黑顶栏左端 = **中文页题**（`阶段总览`），右端 = 品牌 + 页序（`ID PLAN · 01/04`）；
 *   · 栏外居中「站名」= **项目名**（52px 级巨字），其下才是页副标题
 *     （`阶段排期表 · PROJECT DEPARTURES`）。
 * 故项目名从栏内移到栏外板头（P0-3），栏内改登页题——与参考稿逐位对位，
 * 且消除「同一页项目名出现两次」。
 */
const SWISS_PAGE_TITLES: Record<string, { cn: string; subtitle: string }> = {
  'stage-overview': { cn: '阶段总览', subtitle: '阶段排期表 · PROJECT DEPARTURES' },
  'task-register': { cn: '任务读号表', subtitle: '任务读号表 · TASK' },
  'delay-ledger': { cn: '延期记录表', subtitle: '延期记录表 · DELAY' },
  'member-roster': { cn: '成员责任表', subtitle: '成员责任表 · TEAM DEPARTURES' },
};

/** 阶段四态的字形双编码（灰度可读：文字 + 实心/空心/形状，01 §2） */
const STAGE_GLYPH: Record<StageStatus, string> = {
  [StageStatus.NotStarted]: '□',
  [StageStatus.InProgress]: '◐',
  [StageStatus.Completed]: '●',
  [StageStatus.Delayed]: '▲',
};

/** StageLog 类型展示名（本模块自持：全仓无既有出处，打印台账专用） */
const STAGE_LOG_TYPE_LABELS: Record<PrintStageLogVM['type'], string> = {
  created: '建档',
  rescheduled: '改期',
  status_changed: '状态流转',
};

/** generatedAt（ISO）→ 纸面用的「yyyy-MM-dd HH:mm」 */
function stampOf(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export interface SwissScheduleDocumentProps {
  vm: PrintViewModel;
  /**
   * 纸面页（期三：原生页 kind + 通用模块 id 的混合序列；缺省 = 默认原生模块）。
   * 选择器勾选即时重渲染；A 的 M1/M2/M4 是原生页，通用页在本版不会出现
   * （期三第一批里 A 无 generic 标记模块），装配链仍统一走 sheets。
   */
  sheets?: readonly PrintSheet[];
  /** 有效配色（自定义或设计师基线；三枚 hex） */
  palette: PrintPalette;
  /** 全局打印 logo（base64 dataURL；null = 未上传，黑顶栏左端显示「ID Plan」文字标） */
  logo?: string | null;
  /** 导出 PNG 的页面元素收集（ref callback 数组，宿主持有） */
  pageRef?: (idx: number) => Ref<HTMLDivElement>;
}

/* ------------------------------------------------------------------ 物理页装配 */

/** A 版一个物理纸面（原生页 or 通用模块的一个 chunk；plan=null = 空态纸） */
export type SwissPhysical =
  | { type: 'native'; kind: PrintPageKind }
  | {
      type: 'generic';
      module: 'stage-list' | 'task-list' | 'member-roster';
      plan: GenericPlan | null;
      chunkIndex: number;
      chunkTotal: number;
    };

/**
 * sheets ⇒ A 版物理页序列（原生 1:1；通用模块经 planGenericModule 分页）。
 * 外来页 kind / 非本批通用模块静默滤掉（纸面不因此多页）。
 */
export function swissSchedulePhysical(vm: PrintViewModel, sheets: readonly PrintSheet[]): SwissPhysical[] {
  const out: SwissPhysical[] = [];
  for (const sheet of sheets) {
    if (sheet.type === 'native') {
      if (!SWISS_SCHEDULE_PAGES.includes(sheet.page)) continue;
      out.push({ type: 'native', kind: sheet.page });
      continue;
    }
    if (!isGenericRenderable(sheet.module)) continue;
    const plan = planGenericModule(sheet.module, vm, 'swiss-schedule');
    const total = plan === null ? 1 : plan.chunks.length;
    for (let i = 0; i < total; i++) {
      out.push({ type: 'generic', module: sheet.module, plan, chunkIndex: i, chunkTotal: total });
    }
  }
  return out;
}

export function SwissScheduleDocument({
  vm,
  sheets,
  palette,
  logo = null,
  pageRef,
}: SwissScheduleDocumentProps): JSX.Element {
  const physical = swissSchedulePhysical(vm, sheets ?? enabledSheetsOf('swiss-schedule', undefined));
  const total = physical.length;
  /**
   * 顶栏明暗（决定 logo 反不反白）：栏底 = --tpl-line 槽位。基线黑栏 ⇒
   * 二值化黑 logo 必须反白才看得见；自定义预设若把栏底改亮（站台蓝/赭石/
   * 松墨的 line 都是浅色）⇒ 原样即可。**按配色判定而不是写死 invert**——
   * 否则三个浅栏预设下白 logo 直接消失。
   */
  const barIsDark = relativeLuminance(palette.line) < 0.2;

  return (
    <div
      className={`print-root mx-auto w-fit ${printTemplateClass('swiss-schedule')}`}
      style={
        {
          '--tpl-accent': palette.accent,
          '--tpl-ink': palette.ink,
          '--tpl-line': palette.line,
        } as CSSProperties
      }
    >
      {physical.map((p, idx) => (
        <SwissPage
          key={p.type === 'native' ? p.kind : `generic-${p.module}-${p.chunkIndex}`}
          page={p}
          vm={vm}
          pageIndex={idx}
          pageTotal={total}
          pageRef={pageRef?.(idx)}
          logo={logo}
          barIsDark={barIsDark}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 纸面外壳 */

function SwissPage({
  page,
  vm,
  pageIndex,
  pageTotal,
  pageRef,
  logo,
  barIsDark,
}: {
  page: SwissPhysical;
  vm: PrintViewModel;
  pageIndex: number;
  pageTotal: number;
  pageRef?: Ref<HTMLDivElement>;
  logo: string | null;
  barIsDark: boolean;
}): JSX.Element {
  // 原生页 = 栏内当前项（nav 点亮）；通用页 = 模块英文栏名（nav 不点亮）
  const nav = page.type === 'native' ? SWISS_NAV.find((n) => n.kind === page.kind) : undefined;
  const navEn = page.type === 'native' ? (nav ?? SWISS_NAV[0]!).en : GENERIC_TITLES[page.module].en;
  // 页题：原生页走页题表；通用页走模块名（黑顶栏中文页题位）
  const pageCn =
    page.type === 'native'
      ? SWISS_PAGE_TITLES[page.kind]?.cn ?? navEn
      : GENERIC_TITLES[page.module].cn;
  const pageAttr = page.type === 'native' ? page.kind : `generic-${page.module}`;
  const nn = String(pageIndex + 1).padStart(2, '0');
  const NN = String(pageTotal).padStart(2, '0');
  return (
    <div
      ref={pageRef}
      data-print-page={pageAttr}
      data-page-index={pageIndex}
      className="a4-page swiss-page"
      style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX }}
    >
      {/* 黑顶栏（左右内缩 40px，黄字反白）：logo + 四枚英文栏目 + 中文页题 + 品牌·页序 */}
      <header className="swiss-topbar">
        <div className="swiss-topbar__nav" aria-label="栏目">
          {/* logo：黑顶栏左端（≤24px，黄字旁）。暗栏反白、亮栏原样（按栏底
              亮度判定，见文档层 barIsDark）；未上传 = 「ID Plan」文字标（黄字） */}
          <PrintLogoMark logo={logo} height={24} tone={barIsDark ? 'on-dark' : 'ink'} />
          {SWISS_NAV.map((n) => (
            <span
              key={n.kind}
              className="swiss-topbar__navitem"
              data-current={page.type === 'native' && n.kind === page.kind ? true : undefined}
            >
              {n.en}
            </span>
          ))}
        </div>
        {/* 中文页题（参考稿黑顶栏左端站位；项目名已移到栏外板头的「站名」位） */}
        <div className="swiss-topbar__title">{pageCn}</div>
        {/* 品牌 + 页序（参考稿右端 `ID PLAN · 01/04`）+ 项目周期 */}
        <div className="swiss-topbar__meta">
          <span className="swiss-num">
            ID PLAN · {nn} / {NN}
          </span>
          <span className="swiss-num">
            {vm.project.plannedStartAt} — {vm.project.plannedEndAt}
          </span>
        </div>
      </header>

      <div className="swiss-body">
        {page.type === 'native' ? (
          <SwissPageBody kind={page.kind} vm={vm} />
        ) : (
          <>
            {/* 通用模块页同样有「站名 + 副标题 + 通栏线」（每页可独立解释，01 §2） */}
            <SwissMasthead
              projectName={vm.project.name}
              subtitle={`${GENERIC_TITLES[page.module].cn} · ${GENERIC_TITLES[page.module].en}`}
              meta={[]}
            />
            <GenericModuleBody plan={page.plan} chunkIndex={page.chunkIndex} />
          </>
        )}
      </div>

      {/* 黑底栏（左右内缩 40px）：署名 + 页码 + 数据时间（每页可独立解释，01 §2） */}
      <footer className="swiss-bottombar">
        <span>ID Plan · 项目排期与交付管理</span>
        <span className="swiss-num">
          第 {pageIndex + 1} / {pageTotal} 页 · 数据时间 {stampOf(vm.generatedAt)}
        </span>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ 栏外板头（站名） */

/**
 * 栏外板头（P0-3）：居中的「站名」项目名 → 副标题 → 2px 通栏线 → 元信息行。
 *
 * 参考稿实测（A P1，794×1123 CSS px）：
 *   站名 y162..199（cap 37.5 ⇒ 字号 ≈40px，**不是**审计报告的 52px——那个值
 *     是按拉丁 cap 比推的，中文方块字的字面/字宽比不同，实测 4 字墨宽 157.5px
 *     ⇒ 每字 39.4px ⇒ 字号 ≈40px）；副标 y216..232；2px 通栏线 y268；
 *   左元信息 3 行 y293.5 / 310.5 / 327.5；右巨字完成度 y268..328（cap 60 ⇒ 82px）；
 *   巨字说明行 y341.5..349.5。
 *
 * 为什么做共享件而不是只在 P1 里写：项目名是「每页可独立解释」的项目标识
 * （01 §2 + 宪法 7），它从黑顶栏移出后必须每页都有落点；且 01 §4 A 视觉系统
 * 原文就是「标题：项目名居中，像站名」（版本级规则，不是 P1 专属）。
 */
function SwissMasthead({
  projectName,
  subtitle,
  meta,
  anchor,
}: {
  projectName: string;
  subtitle: string;
  meta: readonly string[];
  /** 右侧版面锚点（P1 = 巨字完成度；其余页无——巨字不借，审美标准 §2-H 同律） */
  anchor?: { value: string; caption: string };
}): JSX.Element {
  return (
    <div className="swiss-masthead">
      <div className="swiss-masthead__name" title={projectName}>
        {projectName}
      </div>
      {/* 板头标题 = 页副标题（参考稿 `阶段排期表 · PROJECT DEPARTURES`）；
          仍是 h2 + 原类名，故 P0-1 的「纸面 h2 墨色」在 DOM 上可直接断言 */}
      <h2 className="swiss-board__title swiss-masthead__subtitle">{subtitle}</h2>
      <div className="swiss-masthead__rule" />
      <div className="swiss-masthead__row">
        <div className="swiss-masthead__meta">
          {meta.map((line) => (
            <div key={line} className="swiss-masthead__meta-line swiss-num">
              {line}
            </div>
          ))}
        </div>
        {anchor && (
          <div className="swiss-masthead__anchor">
            <div className="swiss-masthead__pct swiss-num">{anchor.value}</div>
            <div className="swiss-masthead__pct-caption">{anchor.caption}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function SwissPageBody({ kind, vm }: { kind: PrintPageKind; vm: PrintViewModel }): JSX.Element {
  switch (kind) {
    case 'stage-overview':
      return <StageDeparturePage vm={vm} />;
    case 'task-register':
      return <TaskDeparturePage vm={vm} />;
    case 'delay-ledger':
      return <DelayDeparturePage vm={vm} />;
    case 'member-roster':
      return <TeamDeparturePage vm={vm} />;
    default:
      // 其余十页归 D/E/H；本组件只实现 A 四页（类型上不可达，运行时兜底）
      return <EmptyPrintState kind="stageLog" text="该页属于其他版本模板" />;
  }
}

/* ------------------------------------------------------------------ P1 阶段总览 */

function StageDeparturePage({ vm }: { vm: PrintViewModel }): JSX.Element {
  const stages = vm.stages;
  // 三列错落：按 orderIndex 顺序切三组（前期/中期/后期——新稿 A P1 的分组语义，
  // 组即分期；CSS 给 2/3 栏纵向错位）。轮分会打散分期，列首加组头标签
  const per = Math.ceil(stages.length / 3);
  const columns: PrintStageVM[][] = [0, 1, 2]
    .map((gi) => stages.slice(gi * per, (gi + 1) * per))
    .filter((col) => col.length > 0);
  const dense = stages.length > 15;
  // 「阶段套餐」：套餐键 + 模板版本（纯增量 VM 字段）；未套用套餐时只登版本位
  const presetKey = vm.project.stagePresetKey ?? null;
  const presetText = presetKey
    ? `${presetKey} v${vm.project.stageTemplateVersion ?? 0}`
    : '—';

  return (
    <section className="swiss-board" data-density={dense ? 'compact' : undefined}>
      {/* 栏外板头（P0-3）：站名 + 副标题 + 2px 通栏线 + 左元信息 3 行 + 右巨字完成度 */}
      <SwissMasthead
        projectName={vm.project.name}
        subtitle={SWISS_PAGE_TITLES['stage-overview']!.subtitle}
        meta={[
          `排期基准 ${vm.project.scheduleBasisLabel}`,
          `阶段套餐 ${presetText}（${stages.length} 项）`,
          `可见阶段 ${stages.length} / ${vm.project.visibleStageCount}`,
        ]}
        anchor={{
          value: `${Math.round(vm.project.percent)}%`,
          // 口径：完成度按可见阶段数统计（01 §3.1），不按 ratioPercent 加权
          caption: '项目完成度（阶段粒度）',
        }}
      />
      {stages.length === 0 ? (
        <EmptyPrintState kind="stages" />
      ) : (
        <div className="swiss-columns">
          {columns.map((col, ci) => (
            <div key={ci} className="swiss-column" data-col={ci + 1}>
              {/* 组头：分期标签（新稿「前期 / PREP」式；组间分隔靠粗线） */}
              <div className="swiss-column__head">
                <span className="swiss-column__label">
                  {SWISS_PHASES[ci]!.cn}
                  <span className="swiss-column__en">/ {SWISS_PHASES[ci]!.en}</span>
                </span>
                <span className="swiss-column__count swiss-num">{col.length}</span>
              </div>
              {col.map((s) => (
                <div key={s.id} className="swiss-stage-row" data-state={s.status}>
                  {/* ① 号码行（号码 + 名称） */}
                  <div className="swiss-stage-row__top">
                    <span className="swiss-stage-row__no swiss-num">
                      {String(s.orderIndex).padStart(2, '0')}
                    </span>
                    <span className="swiss-stage-row__name">{s.name}</span>
                  </div>
                  {/* ② 胶囊行：状态胶囊（实心/描边 + 字形双编码）+ 右对齐日期。
                      参考稿实测胶囊与日期同一行（审计把「2px 粗线」记在号码行与
                      胶囊行之间，实拍里没有这条线——见施工报告 P0-6） */}
                  <div className="swiss-stage-row__capsule-row">
                    <span className="swiss-stage-row__capsule" data-state={s.status}>
                      <span className="swiss-state-glyph" aria-hidden>
                        {STAGE_GLYPH[s.status]}
                      </span>
                      {stageStatusLabel(s.status)}
                    </span>
                    <span className="swiss-stage-row__date swiss-num">
                      {s.startAt} → {s.endAt}
                    </span>
                  </div>
                  {/* ③ 占比 + 负责人行（01 §4 P1 字段表逐项） */}
                  <div className="swiss-stage-row__bottom">
                    <span>占比 {s.ratioPercent}%</span>
                    <span>负责人 {s.ownerName ?? '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 口径行（01 §2 + 宪法 7：口径注每页独立解释，空态同样登；参考 y799.5..809.5 单行） */}
      <p className="swiss-board__note">
        阶段四态：已完成 进行中 未开始 延期　|　占比 = Stage.ratioPercent（项目级覆写）
      </p>

      {/* 休息制度黑块（P0-4；参考稿 y832..915.5 h84） */}
      <div className="swiss-rest">
        <div className="swiss-rest__title">休息制度　{vm.project.restPolicyLabel ?? '—'}</div>
        <div className="swiss-rest__note">{vm.project.restPolicyNote ?? ''}</div>
      </div>

      {/* 数据来源行（P0-4；参考稿 y1025.5..1033，贴底栏） */}
      <p className="swiss-source swiss-num">
        数据来源 ID Plan 排程库 {stampOf(vm.generatedAt)} 同步
      </p>
    </section>
  );
}

/** 三组阶段分期（新稿 A P1：前期 / 中期 / 后期） */
const SWISS_PHASES: ReadonlyArray<{ cn: string; en: string }> = [
  { cn: '前期', en: 'PREP' },
  { cn: '中期', en: 'BUILD' },
  { cn: '后期', en: 'CLOSE' },
];

function stageStatusLabel(status: StageStatus): string {
  switch (status) {
    case StageStatus.InProgress:
      return '进行中';
    case StageStatus.Completed:
      return '已完成';
    case StageStatus.Delayed:
      return '延期';
    default:
      return '未开始';
  }
}

/* ------------------------------------------------------------------ P2 任务读号表 */

function TaskDeparturePage({ vm }: { vm: PrintViewModel }): JSX.Element {
  const tasks = vm.tasks;
  const dense = tasks.length > 22;
  return (
    <section className="swiss-board" data-density={dense ? 'compact' : undefined}>
      {/* 板头（页题进黑顶栏；此处只登站名与页副标题 + 本页计数） */}
      <SwissMasthead
        projectName={vm.project.name}
        subtitle={SWISS_PAGE_TITLES['task-register']!.subtitle}
        meta={[`${tasks.length} 条任务`]}
      />
      {tasks.length === 0 ? (
        <EmptyPrintState kind="tasks" />
      ) : (
        <table className="swiss-register">
          <thead>
            <tr>
              <th className="swiss-register__no">读号</th>
              <th>任务</th>
              <th className="swiss-register__state">状态</th>
              <th>负责人</th>
              <th className="swiss-register__no">产出物</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className="swiss-num">{formatTaskNo(t.taskNo)}</td>
                <td className="swiss-register__title">{t.title}</td>
                <td>
                  <span className="swiss-task-state" data-overdue={t.overdue || undefined}>
                    {TASK_STATUS_LABELS[t.status]}
                    {t.overdue ? ' · 逾期' : ''}
                  </span>
                </td>
                <td>{t.assigneeNames.length > 0 ? t.assigneeNames.join('、') : '—'}</td>
                <td className="swiss-num">{t.artifactCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ P3 延期记录表 */

function DelayDeparturePage({ vm }: { vm: PrintViewModel }): JSX.Element {
  const delayedStages = vm.stages.filter((s) => s.status === StageStatus.Delayed);
  const overdueTasks = vm.tasks.filter((t) => t.overdue);
  const logs = vm.stageLogs;
  const dense = logs.length > 12;

  return (
    <section className="swiss-board" data-density={dense ? 'compact' : undefined}>
      <SwissMasthead
        projectName={vm.project.name}
        subtitle={SWISS_PAGE_TITLES['delay-ledger']!.subtitle}
        meta={[`${logs.length} 条流水`]}
      />

      {/* 三类延期口径（01 §3.3）：判据分列、互不推导 */}
      <div className="swiss-delay-types">
        <div className="swiss-delay-type" data-kind="project">
          <span className="swiss-delay-type__name">项目逾期</span>
          <span className="swiss-delay-type__rule">项目结束日早于今天且未完成（不附原因）</span>
          <span className="swiss-delay-type__value swiss-num">
            {vm.project.projectOverdue ? `是 · 结束日 ${vm.project.plannedEndAt}` : '否'}
          </span>
        </div>
        <div className="swiss-delay-type" data-kind="stage">
          <span className="swiss-delay-type__name">阶段延期</span>
          <span className="swiss-delay-type__rule">Stage.status=delayed 且有 StageLog（reason 必填）</span>
          <span className="swiss-delay-type__value swiss-num">{delayedStages.length} 个阶段</span>
        </div>
        <div className="swiss-delay-type" data-kind="task">
          <span className="swiss-delay-type__name">任务逾期</span>
          <span className="swiss-delay-type__rule">dueDate 早于今天且状态未完成（不附原因）</span>
          <span className="swiss-delay-type__value swiss-num">{overdueTasks.length} 条任务</span>
        </div>
        <p className="swiss-delay-note">
          三种延期口径互不推导：项目逾期不归因阶段，任务逾期不标记阶段延期；原因仅来自真实 StageLog。
        </p>
      </div>

      <h3 className="swiss-board__subtitle">阶段延期台账（StageLog）</h3>
      {logs.length === 0 ? (
        <EmptyPrintState kind="stageLog" />
      ) : (
        <table className="swiss-register">
          <thead>
            <tr>
              <th>阶段</th>
              <th>类型</th>
              <th className="swiss-register__date">旧结束日</th>
              <th className="swiss-register__date">新结束日</th>
              <th>原因</th>
              <th>操作人</th>
              <th className="swiss-register__date">时间</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{l.stageName}</td>
                <td>{STAGE_LOG_TYPE_LABELS[l.type]}</td>
                <td className="swiss-num">{l.oldEndAt ?? '—'}</td>
                <td className="swiss-num">{l.newEndAt ?? '—'}</td>
                <td className="swiss-register__reason">{l.reason ?? '—'}</td>
                <td>{l.operatorName}</td>
                <td className="swiss-num">{stampOf(l.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ P4 成员责任表 */

function TeamDeparturePage({ vm }: { vm: PrintViewModel }): JSX.Element {
  const members = vm.members;
  return (
    <section className="swiss-board">
      <SwissMasthead
        projectName={vm.project.name}
        subtitle={SWISS_PAGE_TITLES['member-roster']!.subtitle}
        meta={[`${members.length} 人`]}
      />
      {members.length === 0 ? (
        <EmptyPrintState kind="members" />
      ) : (
        <table className="swiss-register swiss-roster">
          <thead>
            <tr>
              <th>姓名</th>
              {/* 「类型」（human / agent）与 agentKind 两列已按需求方要求下架：
                  打印不出 Agent 板块。区分仍由角色列 + Agent 行反色焦点承载 */}
              <th>角色</th>
              <th className="swiss-register__no">负责任务数</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isAgent = m.actorKind === MemberActorKind.Agent;
              return (
                <tr
                  key={m.id}
                  // Agent 行 = 全页唯一强焦点（反色处理；灰度下靠反相+字重仍可辨）
                  data-agent={isAgent || undefined}
                  className={isAgent ? 'swiss-roster__row--agent' : undefined}
                >
                  <td>{m.name}</td>
                  <td>{m.role}</td>
                  <td className="swiss-num">{m.taskCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
