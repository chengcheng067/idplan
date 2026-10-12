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

import { MemberActorKind, StageLogType, StageStatus, TASK_STATUS_LABELS } from '../../core/types/enums';
import { formatTaskNo } from '../../core/lib/task-no';
import { relativeLuminance } from '../../core/color/contrast';
import { A4_WIDTH_PX, A4_HEIGHT_PX, type SchedulePaperBlocks } from '../../lib/schedule-print';
import { enabledSheetsOf, printTemplateClass } from '../../components/print/print-templates';
import type { PrintSheet } from '../../components/print/print-templates';

import type {
  PrintPageKind,
  PrintStageLogVM,
  PrintStageVM,
  PrintViewModel,
} from '../model/print-view-model';
import type { PrintPalette } from '../model/print-palette';
import { buildPrintGantt, type PrintGanttModel } from '../model/print-gantt';
import {
  blockRecordOf,
  resolveUnits,
  unitEnabled,
  type PrintUnitId,
  type ResolvedPrintUnit,
} from '../model/print-units';
import { EmptyPrintState } from '../parts/EmptyPrintState';
import { PrintGantt } from '../parts/PrintGantt';
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
   * **legacy** 纸面页（期三：原生页 kind + 通用模块 id 的混合序列）。
   * 传了就一定走旧页路径——额外内容页（任务读号表 / 延期记录表 / 成员责任表）
   * 与通用模块页选中器不再暴露、但代码与 spec 全留（决策 2）。
   */
  sheets?: readonly PrintSheet[];
  /**
   * **解析好的单元**（`resolveUnits('swiss-schedule', prefs)` 的结果：5 块 + 3 件
   * 版性装置）。未传 `sheets` 时（= 应用内预览面板与所有新形态宿主）走「5 块形态」：
   * B1 打印头部 / B2 打印时间轴 / B3 项目信息 / B4 阶段清单（含 L3 改期记录）
   * / B5 页脚 + 版性装置（黑顶栏 / 板头巨字 / 黑底栏）。
   *
   * ⚠️ 为什么传「单元」而不是传「五块布尔值」（决策 5 第 2 条的硬要求）：
   * 装配与渲染必须走**同一条解析路径**——内容块与版性装置都从同一个
   * `ResolvedPrintUnit[]` 取「今天渲不渲染」。这样将来把装置开放成可勾时，
   * 只改注册表里的 `forced`（`resolveUnits` 的数据源），**本组件一行都不用动**；
   * 若这里收的是布尔值 + 装置写死渲染，那次开放就要在本文件里再开一个分支。
   *
   * 缺省 = `resolveUnits('swiss-schedule', undefined)` ⇒ 五块全开、装置全开
   * （与经典纸面「不传偏好 = 视觉零变化」同口径）。
   */
  units?: readonly ResolvedPrintUnit[];
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
  units,
  palette,
  logo = null,
  pageRef,
}: SwissScheduleDocumentProps): JSX.Element {
  // 同一条解析路径（决策 5 第 2 条）：宿主不给单元就按缺省解析一次
  const resolvedUnits = units ?? resolveUnits('swiss-schedule', undefined);
  const blocks = blockRecordOf(resolvedUnits);
  const show = (id: PrintUnitId): boolean => unitEnabled(resolvedUnits, id);
  /**
   * 两种形态的分流（**唯一分叉点**，其余全部共用/沿革）：
   *   · 传了 `sheets` ⇒ legacy 页路径（额外内容页 + 通用模块；出选择器但代码全留）；
   *   · 否则 ⇒ 5 块形态（决策 1：选择器只暴露这 5 块；缺省 = 五块全开）。
   */
  const physical = sheets ? swissSchedulePhysical(vm, sheets) : null;
  const blockPages = physical === null ? swissBlockPages(vm, blocks) : null;
  const total = physical ? physical.length : (blockPages?.length ?? 0);
  /**
   * 顶栏明暗（决定 logo 反不反白）：栏底 = --tpl-line 槽位。基线黑栏 ⇒
   * 二值化黑 logo 必须反白才看得见；自定义预设若把栏底改亮（站台蓝/赭石/
   * 松墨的 line 都是浅色）⇒ 原样即可。**按配色判定而不是写死 invert**——
   * 否则三个浅栏预设下白 logo 直接消失。
   */
  const barIsDark = relativeLuminance(palette.line) < 0.2;
  /** 甘特模型（5 块形态专用；legacy 页路径不消费——经典甘特是它自己的私有实现） */
  const gantt = physical === null ? swissGanttModel(vm) : null;
  const reschedLogs = physical === null ? swissRescheduleLogs(vm) : [];

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
      {physical &&
        physical.map((p, idx) => (
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
      {blockPages &&
        gantt &&
        blockPages.map((p, idx) => (
          <SwissBlockPage
            key={`blocks-${idx}`}
            vm={vm}
            blocks={blocks}
            show={show}
            gantt={gantt}
            reschedLogs={reschedLogs}
            page={p}
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
                    <SwissStageCard key={s.id} stage={s} />
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

/**
 * 阶段卡（三段结构：号码行 → 胶囊行 → 占比/负责人行）。
 *
 * 从 `StageDeparturePage` 的内联 JSX **逐字搬运**（DOM 与类名一字未改，
 * `swiss-schedule-document.spec` 的 ④a 断言照旧）——搬出来只为让「5 块形态」
 * 的 B4 与 legacy P1 用**同一张卡**，避免两处各长一版（第二真值源纪律）。
 */
function SwissStageCard({ stage }: { stage: PrintStageVM }): JSX.Element {
  return (
    <div className="swiss-stage-row" data-state={stage.status}>
      {/* ① 号码行（号码 + 名称） */}
      <div className="swiss-stage-row__top">
        <span className="swiss-stage-row__no swiss-num">
          {String(stage.orderIndex).padStart(2, '0')}
        </span>
        <span className="swiss-stage-row__name">{stage.name}</span>
      </div>
      {/* ② 胶囊行：状态胶囊（实心/描边 + 字形双编码）+ 右对齐日期。
          参考稿实测胶囊与日期同一行（审计把「2px 粗线」记在号码行与
          胶囊行之间，实拍里没有这条线——见施工报告 P0-6） */}
      <div className="swiss-stage-row__capsule-row">
        <span className="swiss-stage-row__capsule" data-state={stage.status}>
          <span className="swiss-state-glyph" aria-hidden>
            {STAGE_GLYPH[stage.status]}
          </span>
          {stageStatusLabel(stage.status)}
        </span>
        <span className="swiss-stage-row__date swiss-num">
          {stage.startAt} → {stage.endAt}
        </span>
      </div>
      {/* ③ 占比 + 负责人行（01 §4 P1 字段表逐项） */}
      <div className="swiss-stage-row__bottom">
        <span>占比 {stage.ratioPercent}%</span>
        <span>负责人 {stage.ownerName ?? '—'}</span>
      </div>
    </div>
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

/* ====================================================================================
 * 5 块形态（2026-10-13 · 「5 块内容 × 4 模板」重构 · 批 1）
 * ====================================================================================
 * 依据：`deliverables/gstack/print-5blocks-mapping-2026-10-13.md`
 *   · §1.1 = A 版的 5 块映射（逐格照做）；§0.5 = B4 的 L3 附属件「改期记录」；
 *   · §2.6 = 装置 vs 内容的分界（本文件里体现为：黑顶栏 / 黑底栏 / 板头巨字
 *     **恒渲染**，五块按勾选渲染；B1 因承载项目名而不可摘，由 units 层声明）。
 *
 * 分页口径（照 §0.2 经典的 5 块口径）：
 *   B1 打印头部 **每页**；B2 打印时间轴 **只第 1 页**（**唯一例外**见下）；B3 项目信息 **只第 1 页**；
 *   B4 阶段清单 **每页**（本页无承载则不出清单，与经典「空页不出表」同源）；
 *   B5 页脚 **每页**（此处可摘的载荷 = 贴底的数据来源行，见 §2.6 的 A·B5 格）。
 *
 * 严格一一对应（决策 6）：勾选只决定「打什么内容」，永不决定「这套模板长什么样」；
 * 取消一块 = 纸面上精确减掉一个可见区。
 *
 * ── 有意破例（2026-10-13 批 A 裁决，本项目登记在案）──
 * §0.2 的「时间轴只第 1 页」是照抄经典的**口径**，但经典的时间轴行便宜得多
 * （26/28px + 没有 A 的板头开销）⇒ 照抄口径不等于照抄可行性。当阶段数超过
 * `SWISS_GANTT_SINGLE_PAGE_MAX_STAGES` 时，A 的 B2 **按页续排**（每页自己的轴与
 * 刻度、同一时间坐标系、行号连续、轴尾「（续）」、图例只在首段）。
 * 依据：**「纸面上任何内容都不许被裁」是更高一级的硬规则**（逐页 ≤1123 是它的
 * 机器化断言）；宁可多出一页，也不许裁掉内容或把字压到叠字。
 * ==================================================================================== */

/**
 * 纸面几何常量（px）——纪律与 `lib/schedule-print.ts` 的 EST 同款：
 * **估高只许偏大不许偏小**（偏大 = 早分页白留一截，偏小 = 内容溢出纸面）。
 *
 * ★ 全部值来自**真 Chromium 实测**（2026-10-13 批 1，9/6/2 阶段三档夹具，
 *   逐块量 `getBoundingClientRect` + margin；探针脚本见交付报告）。
 *   实测值 → 本表取值的对照写在每条注释里；表格值 ≥ 实测值。
 */
const SWISS_BLOCK_EST = {
  /** .a4-page padding：24（顶）+ 36（底）——swiss-schedule.css */
  pagePadding: 60,
  /** 黑顶栏 --swiss-bar-height-top */
  topbar: 100,
  /** 黑底栏 --swiss-bar-height-bottom */
  bottombar: 48,
  /** 首页板头（含 margin-bottom 33）：实测 265.5 */
  masthead: 266,
  /** 续页板头（无巨字锚点，含 margin-bottom 33）：实测 250 */
  mastheadCont: 250,
  /** B2 甘特 chrome（轴 + 刻度 + 图例两行 + 行上间距）：实测 75 */
  ganttChrome: 76,
  /** B3 项目信息整块（排期基准行 + 休息制度黑块 + 口径注两行）：实测 168.25 */
  infoTotal: 170,
  /** B5 的贴底数据来源行（在 body 流里占位）：实测 20.39 */
  sourceH: 21,
  /** B4 组头（标签 + 2px 粗线 + 其下呼吸）：实测 92.75 */
  stageHead: 94,
  /** 三列错落的中列下移：实测 34（`[data-col='2']` 的 margin-top） */
  stageStagger: 34,
  /** B4 一条阶段卡（含卡间间距）：实测 95.19 */
  stagePitch: 96,
  /** B4 三列错落 */
  columns: 3,
  /** L3「改期记录」固定头（小标题 + 表头 + 「共 M 条」尾行 + 间距）：1 条记录时实测 124.5 */
  reschedHead: 106,
  /** L3 每条改期记录 */
  reschedRow: 24,
  /**
   * B2 轨道行高的**设计基线**（§1.1 的 28px 轨道行）。
   * 阶段能在一页里装下时才允许往下压，压到 `GANTT_MIN_READABLE_PITCH` 为限；
   * 压不住就**不许再压**（字会与行盒打架）——改按基线行高**续页**（见下）。
   */
  ganttMaxPitch: 28,
};

/** 纸面可用高度（= 1123 − padding − 顶栏 − 底栏） */
const SWISS_BLOCK_BODY_H =
  A4_HEIGHT_PX - SWISS_BLOCK_EST.pagePadding - SWISS_BLOCK_EST.topbar - SWISS_BLOCK_EST.bottombar;

/**
 * B2 轨道行高的**可读下限**（px）——**实测判据，不是拍脑袋**（真 Chromium，
 * 见交付报告「行高可读性实测」）：
 *
 * | 行高 | 名称行盒 | 号码行盒 | 相邻两行名称盒的净空 |
 * |---|---|---|---|
 * | 12 | 18（12px） | 21 | **−6（叠字）** |
 * | 14 | 18（12px） | 21 | **−4（叠字）** |
 * | 16 | 13.5（9px，dense 档） | 15 | +0.5 |
 * | 20 | 15（10px，compact 档） | 18 | +2 |
 * | 28 | 19.5（13px，基线档） | 24 | +8.5 |
 *
 * 结论：**判据是「文字行盒 ≤ 行高」**（净空 ≥ 0）。12/14px 无论怎么调字号都叠字
 * ⇒ 判据取行高 ≥ 16（配 dense 档的 9px/10px 字号，净空 +0.5px）。
 * 14px 是**上一版的错误假设**，被本表推翻：那一版的 ≥20 阶段其实一直在叠字。
 */
const GANTT_MIN_READABLE_PITCH = 16;

/**
 * **单页压缩的上限**（= 首页给 B2 的预算 ÷ 可读下限，实测 27）。
 *
 * 这条常量就是「什么时候不再压缩、改续页」的唯一阈值（不许让 28 这个数活在注释里）：
 *   阶段数 ≤ 本值 ⇒ 行高压缩（14–28）把整轴装进首页（今天的 v1 行为，一页一轴）；
 *   阶段数 > 本值 ⇒ 行高回到**设计基线 28**，整轴**按页续排**（每页自己的轴与刻度，
 *   行号连续 ⇒ 读者自己接得上）。费用是「B2 不再只出现在第 1 页」——
 *   **这是有意的契约变更，已在文件头与本批报告显式登记**（硬规则优先：
 *   纸面上任何内容都不许被裁，`print-a4-visual` 的逐页 ≤1123 就是这条的机器化）。
 */
export const SWISS_GANTT_SINGLE_PAGE_MAX_STAGES = Math.floor(
  (SWISS_BLOCK_BODY_H -
    SWISS_BLOCK_EST.masthead -
    SWISS_BLOCK_EST.infoTotal -
    SWISS_BLOCK_EST.sourceH -
    SWISS_BLOCK_EST.ganttChrome) /
    GANTT_MIN_READABLE_PITCH,
);

/** L3 改期记录最多登几条（§0.5：「取最近 N 条 + 行末「共 M 条」」） */
export const SWISS_RESCHED_MAX_ROWS = 6;

/** 一页的装配计划（5 块形态；`first` = 首页，B3 只认它） */
export interface SwissBlockPagePlan {
  first: boolean;
  /**
   * B2 本页承载的甘特行区间 `[ganttFrom, ganttTo)`（空区间 = 本页不出甘特）。
   *
   * ⚠️ 为什么是**区间**而不是「首页整轴」：阶段数超过
   * `SWISS_GANTT_SINGLE_PAGE_MAX_STAGES` 时整轴按页续排（行号连续、每页自己的
   * 轴与刻度、同一时间坐标系）——这是「纸面不许裁」这条硬规则对
   * 「只第 1 页」这条口径的**有意破例**，见两处常量注释与文件头登记。
   */
  ganttFrom: number;
  ganttTo: number;
  /** 本页承载的阶段（B4 的行切片；空 = 本页不出清单） */
  stages: readonly PrintStageVM[];
  /** 本页是 B4 的最后一页（L3 改期记录挂这里；§0.5：不单独成页） */
  last: boolean;
}

/** 甘特模型（VM 的可见阶段已过权限过滤 ⇒ 这里只做几何派生） */
function swissGanttModel(vm: PrintViewModel): PrintGanttModel {
  return buildPrintGantt(vm.project, vm.stages);
}

/** L3 改期记录的行（StageLog type=rescheduled，**最近的在前**，取 N 条） */
export function swissRescheduleLogs(vm: PrintViewModel): readonly PrintStageLogVM[] {
  return vm.stageLogs
    .filter((l) => l.type === StageLogType.Rescheduled)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, SWISS_RESCHED_MAX_ROWS);
}

/** B4 三列错落的切分（与 legacy P1 同一算法：按 orderIndex 顺序切三段） */
function splitColumns(stages: readonly PrintStageVM[]): PrintStageVM[][] {
  const per = Math.ceil(stages.length / SWISS_BLOCK_EST.columns);
  return [0, 1, 2]
    .map((gi) => stages.slice(gi * per, (gi + 1) * per))
    .filter((col) => col.length > 0);
}

/**
 * B2 轨道行高（px）——按阶段数在 [可读下限 14, 设计基线 28] 之间取值。
 *
 * 两档口径（阈值 = `SWISS_GANTT_SINGLE_PAGE_MAX_STAGES`，唯一出处是那条常量）：
 *   ① **阶段数 ≤ 阈值**（实测 27）⇒ 压缩行高，整轴装进首页：行高 = 首页预算 ÷ 行数，
 *      夹到可读下限。这样 ≤27 阶段永远是「一页一轴」，与 §0.2 的经典口径一致。
 *   ② **阶段数 > 阈值** ⇒ 行高**回到设计基线 28**（不再压：压到 14 以下字与行盒
 *      打架，实测 12px 已不可读），整轴按页续排（见 `swissBlockPages`）。
 *      ⇒ 「B2 只第 1 页」这条口径在超大项目上**有意破例**，理由是硬规则更高一级：
 *      **纸面上任何内容都不许被裁**（`print-a4-visual` 的逐页 ≤1123 是它的机器化）。
 */
export function swissGanttPitch(stageCount: number): number {
  if (stageCount <= 0 || stageCount > SWISS_GANTT_SINGLE_PAGE_MAX_STAGES) {
    return SWISS_BLOCK_EST.ganttMaxPitch;
  }
  const room =
    SWISS_BLOCK_BODY_H -
    SWISS_BLOCK_EST.masthead -
    SWISS_BLOCK_EST.infoTotal -
    SWISS_BLOCK_EST.sourceH -
    SWISS_BLOCK_EST.ganttChrome;
  const pitch = Math.floor(room / stageCount);
  return Math.min(Math.max(pitch, GANTT_MIN_READABLE_PITCH), SWISS_BLOCK_EST.ganttMaxPitch);
}

/**
 * 5 块形态的物理页装配（**预计页数 = 实际出纸**的唯一出处；
 * `printPhysicalPageCount` 与文档本体都读它）。
 *
 * ── 文档顺序即装箱顺序（硬规则：纸面上任何内容都不许被裁）──
 * 流 = `[B2 轨道行…][B4 阶段卡…][L3 改期记录]`，逐页贪心装：
 *   ① 每页预算 = 纸面可用高 − 板头（首页 266 / 续页 250）− B3（仅首页 170）
 *      − B5 贴底行（21）；剩余空间给 B4，再剩余留空；
 *   ② B2 每页先取满（每页自带 chrome：轴 + 刻度 + 图例），**≥1 行**；
 *   ③ B4 用剩余空间按「组」（三列错落 ⇒ 一组 = 3 条）装；一组都放不下且
 *      **本页是首页** ⇒ 首页只出纸壳（B1+B2+B3），B4 整段后移一页
 *      （与经典 `paginateSections` 的「第一页放不下任何一行 ⇒ 先出纸壳」同源；
 *      只允许首页让位一次，否则会无限出纸壳页）；
 *   ④ 收口：剩余阶段能全装下 **且** 装下后还给 L3 留得出位置 ⇒ 本页收口
 *      （`last=true`）；否则只装「给 L3 留位后能装的那一档」，L3 跟到下一页
 *      （§0.5：L3 不单独成页）。
 *
 * ── 逐档实测（真 Chromium 2026-10-13；探针一次性、跑完即删）──
 * | 阶段数 | 行高 | 预计页数 | 实际页数 | 逐页高（px） | B2 分布 | 裁切 |
 * |---|---|---|---|---|---|---|
 * | 1  | 28 | 1 | 1 | 1123 | 1/1 首页 | 无 |
 * | 2  | 28 | 2 | 2 | 1123, 1123 | 2 行首页 | 无 |
 * | 9  | 28 | 2 | 2 | 1123, 1123 | 9 行首页 | 无 |
 * | 20 | 19 | 3 | 3 | 1123×3 | 20 行首页 | 无 |
 * | 23 | 16 | 3 | 3 | 1123×3 | 23 行首页（单页档上界） | 无 |
 * | 24 | 28 | 4 | 4 | 1123×4 | 13 + 11（续） | 无 |
 * | 27 | 28 | 5 | 5 | 1123×5 | 13 + 14（续） | 无 |
 * | 28 | 28 | 5 | 5 | 1123×5 | 13 + 15（续） | 无 |
 * | 30 | 28 | 5 | 5 | 1123×5 | 13 + 17（续） | 无 |
 * | 40 | 28 | 7 | 7 | 1123×7 | 13 + 20 + 7（续） | 无 |
 * | 60 | 28 | 9 | 9 | 1123×9 | 13 + 20×2 + 7（续） | 无 |
 *
 * 对照 v1（「只第 1 页」+ 一直压到 14 为止）：27 阶段无裁切，**28 起首页 1157px
 * （超 34px）** ⇒ 本版把「压不住」的规模交给续页，裁切归零。
 */
export function swissBlockPages(vm: PrintViewModel, blocks: SchedulePaperBlocks): SwissBlockPagePlan[] {
  const stages = vm.stages;
  const total = stages.length;
  if (total === 0) return [{ first: true, ganttFrom: 0, ganttTo: 0, stages: [], last: true }];

  // B2 的行 = 阶段（一一对应）；时间轴关掉 ⇒ 没有行要排
  const ganttRows = blocks.timeline ? total : 0;
  const pitch = swissGanttPitch(total);
  const resched = blocks.stageTable ? swissRescheduleLogs(vm) : [];
  const reschedH =
    resched.length > 0 ? SWISS_BLOCK_EST.reschedHead + resched.length * SWISS_BLOCK_EST.reschedRow : 0;
  const footerH = blocks.footer ? SWISS_BLOCK_EST.sourceH : 0;

  /** B4 承载 n 条所需高度（三列错落：组头 + 错落 + 每列 ceil(n/3) 条） */
  const b4Height = (n: number): number =>
    n === 0
      ? 0
      : SWISS_BLOCK_EST.stageHead +
        SWISS_BLOCK_EST.stageStagger +
        Math.ceil(n / SWISS_BLOCK_EST.columns) * SWISS_BLOCK_EST.stagePitch;
  /** 给定预算能装几条阶段卡（0 = 一组都放不下） */
  const b4RowsFit = (budget: number): number => {
    const room = budget - SWISS_BLOCK_EST.stageHead - SWISS_BLOCK_EST.stageStagger;
    return room < SWISS_BLOCK_EST.stagePitch
      ? 0
      : Math.floor(room / SWISS_BLOCK_EST.stagePitch) * SWISS_BLOCK_EST.columns;
  };

  const pages: SwissBlockPagePlan[] = [];
  let g = 0;
  let s = 0;
  let deferredB4 = false;
  let guard = 0;
  // ⚠️ 循环的推进量必须**两个游标都算**：清单关掉时 `s` 永远等于起始值，
  // 若只看 `g` 会在「甘特已排完、但 s < total」时无限出页（实测踩过一次：
  // 8 阶段 + 关清单 ⇒ 256 页，被 guard 拦下）。
  while ((g < ganttRows || s < (blocks.stageTable ? total : 0)) && guard++ < 256) {
    const first = pages.length === 0;
    const gBefore = g;
    const sBefore = s;
    let budget =
      SWISS_BLOCK_BODY_H -
      (first ? SWISS_BLOCK_EST.masthead : SWISS_BLOCK_EST.mastheadCont) -
      (first && blocks.projectInfo ? SWISS_BLOCK_EST.infoTotal : 0) -
      footerH;

    // ① B2：本页取满（每页自带 chrome），至少 1 行
    let ganttTo = g;
    if (blocks.timeline && g < ganttRows) {
      const room = budget - SWISS_BLOCK_EST.ganttChrome;
      const fit = Math.max(Math.floor(room / pitch), 0);
      ganttTo = Math.min(g + Math.max(fit, 1), ganttRows);
      budget -= SWISS_BLOCK_EST.ganttChrome + (ganttTo - g) * pitch;
    }

    // ② B4：用剩余空间按组装
    let stageTo = s;
    if (blocks.stageTable && s < total) {
      const remaining = total - s;
      const fit = b4RowsFit(budget);
      const closes = fit >= remaining && (reschedH === 0 || budget - b4Height(remaining) >= reschedH);
      if (closes) {
        stageTo = total;
      } else {
        const withTail = b4RowsFit(budget - reschedH);
        if (withTail > 0) {
          stageTo = Math.min(s + withTail, total);
        } else if (first && fit > 0 && !deferredB4) {
          // 首页装得下清单、装不下 L3 ⇒ 整段后移（不留空壳尾页）；只让位一次
          deferredB4 = true;
          pages.push({ first: true, ganttFrom: gBefore, ganttTo, stages: [], last: false });
          g = ganttTo;
          continue;
        } else if (fit > 0) {
          // 已让位过（或已不是首页）：收下清单，L3 另起尾页（兜底，正常不触发）
          stageTo = Math.min(s + fit, total);
        }
      }
    }
    const last = blocks.stageTable && stageTo >= total;
    pages.push({ first, ganttFrom: gBefore, ganttTo, stages: stages.slice(s, stageTo), last });
    g = ganttTo;
    s = stageTo;
    // 本页什么都没装 ⇒ 兜底：把剩余阶段一次收下（防死循环；正常不可达）
    if (g === gBefore && s === sBefore && s < total && blocks.stageTable) {
      pages[pages.length - 1] = {
        first,
        ganttFrom: gBefore,
        ganttTo,
        stages: stages.slice(sBefore),
        last: true,
      };
      s = total;
    }
  }
  // 兜底：B4 有承载时**必须**有一页收口（否则 L3 改期记录会静默不上纸）
  if (blocks.stageTable && total > 0 && !pages.some((pg) => pg.last)) {
    const lastIdx = pages.length - 1;
    const tail = pages[lastIdx]!;
    pages[lastIdx] = {
      ...tail,
      stages: tail.stages.length > 0 ? tail.stages : stages.slice(0),
      last: true,
    };
  }
  return pages;
}

/**
 * B1 的 meta 三行（§1.1 A·B1：栏外板头线下左三行）。
 *
 * 字段全集不丢（§3 铁律①：B1 ∪ B3 = 同一组字段全集）——四件都在，且**行数恒 3**
 * （参考稿的板头是「线下左三行」，行数不能随角色变）：
 *   ① 可见阶段 N / M ＋（仅 admin 且非空时）委托方；
 *   ② 阶段套餐；
 *   ③ 打印日期（§1.1 的「乙 · 从底栏上移」）。
 *
 * ⚠️ 「可见阶段」不放进条件分支：普通成员 VM 里 `clientName` 恒 undefined，
 * 若把可见阶段也写进那个分支，**admin 的项目就看不到阶段计数**（第一版即如此，
 * 2026-10-13 自审时按铁律①改回）。
 */
function swissBlockMastheadMeta(vm: PrintViewModel): string[] {
  const presetKey = vm.project.stagePresetKey ?? null;
  const presetText = presetKey ? `${presetKey} v${vm.project.stageTemplateVersion ?? 0}` : '—';
  const client = vm.viewerRole === 'admin' && vm.project.clientName ? `　·　委托方 ${vm.project.clientName}` : '';
  return [
    `可见阶段 ${vm.stages.length} / ${vm.project.visibleStageCount}${client}`,
    `阶段套餐 ${presetText}（${vm.stages.length} 项）`,
    `打印日期 ${stampOf(vm.generatedAt).slice(0, 10)}`,
  ];
}

/**
 * B3 的口径注（**永远渲染**）。为什么它不跟 B3 一起被摘掉——**这不是矛盾**：
 *   · 决策 6「严格一一对应」管的是**内容块**（B1–B5）：勾/消一块 ⇒ 纸面精确
 *     增减一个**内容区**；
 *   · 口径注属 §2.6 **原则 1 的硬底线**（项目名 / 页码 / 页眉口径注 ——「每页可
 *     独立解释」，不许因勾选消失）。**底线不是块**，不在决策 6 的适用范围里。
 * 故 B3 关掉时：承载区（排期基准行 + 休息制度黑块）整块不出，口径注锚回板头
 * meta 区的口径行位（§2.6 的 B3 格）。
 *
 * 两行：① 阶段四态 + 占比口径（A P1 原有）；② 三类延期判据（§2 A-⑥ 的边界：
 * 三类延期口径块**不随台账一起搬**，它归 B3 的口径注区）。
 */
function SwissBlockNotes(): JSX.Element {
  return (
    <div className="swiss-notes">
      <p className="swiss-board__note">
        阶段四态：已完成 进行中 未开始 延期　|　占比 = Stage.ratioPercent（项目级覆写）
      </p>
      <p className="swiss-board__note swiss-board__note--sub">
        延期口径：项目逾期 = 结束日早于今天且未完成；阶段延期 = status=delayed 且有 StageLog（reason
        必填）；任务逾期 = dueDate 早于今天且未完成（三判据互不推导）
      </p>
    </div>
  );
}

/** B4 的 L3 附属件「改期记录」（§0.5：随 B4 勾选、空态整段不出、不单独成页） */
function SwissReschedule({
  rows,
  total,
}: {
  rows: readonly PrintStageLogVM[];
  total: number;
}): JSX.Element {
  return (
    <div className="swiss-resched">
      <h3 className="swiss-resched__title">改期记录</h3>
      <table className="swiss-register swiss-resched__table">
        <thead>
          <tr>
            <th>阶段</th>
            <th className="swiss-register__date">旧结束日</th>
            <th className="swiss-register__date">新结束日</th>
            <th>原因</th>
            <th className="swiss-register__date">时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>{l.stageName}</td>
              <td className="swiss-num">{l.oldEndAt ?? '—'}</td>
              <td className="swiss-num">{l.newEndAt ?? '—'}</td>
              <td className="swiss-register__reason">{l.reason ?? '—'}</td>
              <td className="swiss-num">{stampOf(l.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="swiss-resched__more swiss-num">
        共 {total} 条{rows.length < total ? `（示最近 ${rows.length} 条）` : ''}
      </p>
    </div>
  );
}

/** 黑顶栏的 5 块栏目（§2 A-⑧：四枚旧栏目里后三枚指向不存在的内容 ⇒ 缩为两枚） */
const SWISS_BLOCK_NAV: ReadonlyArray<{ id: 'timeline' | 'stageTable'; en: string }> = [
  { id: 'timeline', en: 'TIME TABLE' },
  { id: 'stageTable', en: 'STAGE DEPARTURES' },
];

/** 一根阶段卡列（组头 + 卡片；与 legacy P1 的列结构逐字同款） */
function SwissStageColumn({ col, index }: { col: readonly PrintStageVM[]; index: number }): JSX.Element {
  const phase = SWISS_PHASES[index] ?? SWISS_PHASES[SWISS_PHASES.length - 1]!;
  return (
    <div className="swiss-column" data-col={index + 1}>
      <div className="swiss-column__head">
        <span className="swiss-column__label">
          {phase.cn}
          <span className="swiss-column__en">/ {phase.en}</span>
        </span>
        <span className="swiss-column__count swiss-num">{col.length}</span>
      </div>
      {col.map((s) => (
        <SwissStageCard key={s.id} stage={s} />
      ))}
    </div>
  );
}

/** 5 块形态的一个物理页 */
function SwissBlockPage({
  vm,
  blocks,
  show,
  gantt,
  reschedLogs,
  page,
  pageIndex,
  pageTotal,
  pageRef,
  logo,
  barIsDark,
}: {
  vm: PrintViewModel;
  blocks: SchedulePaperBlocks;
  /** 单元解析结果读点（装置与内容块同一出处；今天装置恒 true） */
  show: (id: PrintUnitId) => boolean;
  gantt: PrintGanttModel;
  reschedLogs: readonly PrintStageLogVM[];
  page: SwissBlockPagePlan;
  pageIndex: number;
  pageTotal: number;
  pageRef?: Ref<HTMLDivElement>;
  logo: string | null;
  barIsDark: boolean;
}): JSX.Element {
  const nn = String(pageIndex + 1).padStart(2, '0');
  const NN = String(pageTotal).padStart(2, '0');
  const columns = splitColumns(page.stages);
  const reschedTotal = vm.stageLogs.filter((l) => l.type === StageLogType.Rescheduled).length;
  const stamp = stampOf(vm.generatedAt);
  // 栏内当前项点亮：单张纸面上两份内容块都在 ⇒ 有清单就点亮清单那一枚
  const current = blocks.stageTable ? 'stageTable' : 'timeline';
  return (
    <div
      ref={pageRef}
      data-print-page="blocks"
      data-page-index={pageIndex}
      className="a4-page swiss-page"
      style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX }}
    >
      {/* 装置 · 黑顶栏（§2.6 原则 2：装置本体从不因勾选消失）。
          注意判定走 `show()`——与 B1..B5 同一条解析结果，将来开放装置勾选
          只需改注册表（本文件零改动）。 */}
      {show('swiss-topbar') && (
        <header className="swiss-topbar">
        <div className="swiss-topbar__nav" aria-label="栏目">
          <PrintLogoMark logo={logo} height={24} tone={barIsDark ? 'on-dark' : 'ink'} />
          {SWISS_BLOCK_NAV.map((n) => (
            <span
              key={n.id}
              className="swiss-topbar__navitem"
              data-current={n.id === current ? true : undefined}
            >
              {n.en}
            </span>
          ))}
        </div>
        <div className="swiss-topbar__title">{page.first ? '阶段总览' : '阶段总览（续）'}</div>
          <div className="swiss-topbar__meta">
            <span className="swiss-num">
              ID PLAN · {nn} / {NN}
            </span>
            <span className="swiss-num">
              {vm.project.plannedStartAt.slice(0, 10)} — {vm.project.plannedEndAt.slice(0, 10)}
            </span>
          </div>
        </header>
      )}

      <div className="swiss-body">
        {/* B1 打印头部（每页；§2.6 A·B1 = 不可取消：项目名住在板头站名） */}
        <SwissMasthead
          projectName={vm.project.name}
          subtitle={
            page.first ? '阶段排期表 · PROJECT DEPARTURES' : '阶段排期表（续） · PROJECT DEPARTURES'
          }
          meta={swissBlockMastheadMeta(vm)}
          anchor={
            page.first && show('swiss-percent')
              ? {
                  value: `${Math.round(vm.project.percent)}%`,
                  // 口径：完成度按可见阶段数统计（01 §3.1），不按 ratioPercent 加权
                  caption: '项目完成度（阶段粒度）',
                }
              : undefined
          }
        />

        {/* B2 打印时间轴（§1.1：通栏运行图，A 全页唯一横读块）。
            常规规模（≤ SWISS_GANTT_SINGLE_PAGE_MAX_STAGES）只出现在首页；
            超大项目按页续排（每页自己的轴与刻度、同一时间坐标系、行号连续），
            续段只在轴尾加「（续）」、图例不重复——理由见 swissBlockPages 的注释。 */}
        {blocks.timeline && page.ganttTo > page.ganttFrom && (
          <PrintGantt
            model={{ ...gantt, rows: gantt.rows.slice(page.ganttFrom, page.ganttTo) }}
            variant="swiss"
            rowHeight={swissGanttPitch(vm.stages.length)}
            withLegend={page.first}
            continuation={page.ganttFrom > 0}
          />
        )}

        {/* B3 项目信息（只第 1 页）：排期基准行 + 休息制度黑块 */}
        {page.first && blocks.projectInfo && (
          <div className="swiss-info">
            <p className="swiss-info__line swiss-num">
              排期基准 {vm.project.scheduleBasisLabel}　·　打印时间 {stamp}
            </p>
            <div className="swiss-rest">
              <div className="swiss-rest__title">休息制度　{vm.project.restPolicyLabel ?? '—'}</div>
              <div className="swiss-rest__note">{vm.project.restPolicyNote ?? ''}</div>
            </div>
          </div>
        )}
        {/* 口径注恒在：B3 关掉时锚回板头 meta 区的口径行位（§2.6 B3 格） */}
        {page.first && <SwissBlockNotes />}

        {/* B4 阶段清单（每页；含 L3 附属件「改期记录」）
            ⚠️ 空态只在**整个项目没有可见阶段**时出（与经典 `pageSections.length > 0`
            的空页纪律同源）——「本页没有承载」（纸壳页）不出空态，否则纸壳页会
            多出一句「当前可见范围内无阶段」（真机实测 +72px，会把首页撑爆）。 */}
        {blocks.stageTable && (vm.stages.length === 0 || page.stages.length > 0) && (
          <section className="swiss-board swiss-block" data-print-block="stageTable">
            {columns.length === 0 ? (
              <EmptyPrintState kind="stages" />
            ) : (
              <div className="swiss-columns">
                {columns.map((col, ci) => (
                  <SwissStageColumn key={ci} col={col} index={ci} />
                ))}
              </div>
            )}
            {page.last && reschedLogs.length > 0 && (
              <SwissReschedule rows={reschedLogs} total={reschedTotal} />
            )}
          </section>
        )}

        {/* B5 页脚的可摘载荷 = 贴底数据来源行（§2.6 A·B5 格：黑底栏装置留着） */}
        {blocks.footer && (
          <p className="swiss-source swiss-num">数据来源 ID Plan 排程库 {stamp} 同步</p>
        )}
      </div>

      {/* 装置 · 黑底栏（署名 + 页码 + 数据时间；页码在此 ⇒ 原则 1 的落点） */}
      {show('swiss-bottombar') && (
        <footer className="swiss-bottombar">
          <span>ID Plan · 项目排期与交付管理</span>
          <span className="swiss-num">
            第 {pageIndex + 1} / {pageTotal} 页 · 数据时间 {stamp}
          </span>
        </footer>
      )}
    </div>
  );
}
