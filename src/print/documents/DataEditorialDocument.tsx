/**
 * D 版 · Data Editorial（白底数据编辑网格；01 文档 §5 / 02 文档 §6）。
 *
 * ── 为什么独立组件而不是塞进 SchedulePaper ──
 * 01 §1：「不能把四版实现为同一个 DOM 骨架加不同颜色；每版主体布局必须
 * 独立」。D 的纸面是纯白 + 近黑 + 信号橙红的硬边编辑网格（统计带 / 矩阵
 * 表 / 分层条带 / SVG 依赖网络），与经典纸面（白底甘特 + 清单表）、A 版
 * （交通黄时刻表）零共享结构。可共享的只有 `.a4-page` 纸面类与打印分页
 * 规则（global.css 的 @media print 块，靠类名命中）。
 *
 * ── 视觉契约（01 §5 / 02 §6 token）──
 *   纸面 #FFFFFF（= --de-paper）；主文字 #0A0A0A（= --tpl-ink 槽位）；
 *   信号橙红 #EF4B23（= --tpl-accent 槽位，仅重点状态）；
 *   线色 #C9C9C9（= --tpl-line 槽位；02 §6 灰阶表的 #D4D4D4 实测 vs 白底
 *   1.48:1，过不了配色架构 1.5 硬闸门，故 line 槽取 #C9C9C9，#D4D4D4 只做
 *   填充灰——print-palette.ts 文件头有登记）；
 *   圆角一律 0（硬边矩形是 D 的身份）；中文标题 Noto Sans SC Black/Bold、
 *   英文栏 IBM Plex Sans Condensed Bold、数据 IBM Plex Mono（字体栈含
 *   离线回落，不强拉网络字体）。
 *   四页标题均为**完整单行中文标题**，不拆两种字体拼接。
 *
 * ── 配色槽位 ──
 * 三枚经 `.print-root` 的 inline CSS 变量挂载（--tpl-accent / --tpl-ink /
 * --tpl-line），inline style 经 print-frame 的 cloneNode(true) 原样进
 * iframe 打印面，无损（与 A 版同一机制，print-palette.ts 文件头）。
 */

import type { CSSProperties, Ref } from 'react';

import { A4_WIDTH_PX, A4_HEIGHT_PX } from '../../lib/schedule-print';
import { enabledSheetsOf, printTemplateClass } from '../../components/print/print-templates';
import type { PrintSheet } from '../../components/print/print-templates';

import type { PrintPageKind, PrintStageVM, PrintViewModel } from '../model/print-view-model';
import type { PrintPalette } from '../model/print-palette';
import {
  blockRecordOf,
  resolveUnits,
  unitEnabled,
  type PrintUnitId,
  type ResolvedPrintUnit,
} from '../model/print-units';
import { EmptyPrintState } from '../parts/EmptyPrintState';
import { DeBand, DeHead, DE_TYPE_KICKER, DE_TYPE_TITLE } from '../pages/data-editorial/chrome';
import { DateMatrix } from '../pages/data-editorial/DateMatrix';
import { StageBarList } from '../pages/data-editorial/StageBarList';
import { deRescheduleRows } from '../pages/data-editorial/shared';
import { GenericModuleBody } from '../pages/generic/GenericModuleBody';
import {
  GENERIC_TITLES,
  isGenericRenderable,
  planGenericModule,
  type GenericPlan,
} from '../pages/generic/shared';
// D 版样式（Vite 随组件 chunk 进包；全部规则带 .print-root.print-template-* 前缀）
import '../styles/data-editorial.css';
import { ProgressMatrixPage } from '../pages/data-editorial/ProgressMatrixPage';
import { DependencyNetworkPage } from '../pages/data-editorial/DependencyNetworkPage';
import { WorkloadCompositionPage } from '../pages/data-editorial/WorkloadCompositionPage';
import { MilestoneAcceptancePage } from '../pages/data-editorial/MilestoneAcceptancePage';
import { planMatrixPages, type MatrixPlan } from '../pages/data-editorial/shared';
import { stampOf } from '../pages/data-editorial/shared';
import type { SchedulePaperBlocks } from '../../lib/schedule-print';

/** D 版四页（02 §6 组件映射；顺序即纸面顺序） */
export const DATA_EDITORIAL_PAGES: readonly PrintPageKind[] = [
  'progress-matrix',
  'dependency-network',
  'workload-composition',
  'milestone-acceptance',
];

/** 页题（完整单行中文标题 + 英文栏 kicker；01 §5） */
const DE_PAGE_TITLES: Record<PrintPageKind, { cn: string; en: string }> = {
  'progress-matrix': { cn: '阶段进度矩阵', en: 'PROGRESS MATRIX' },
  'dependency-network': { cn: '任务依赖网络', en: 'DEPENDENCY NETWORK' },
  'workload-composition': { cn: '阶段工作量构成', en: 'WORKLOAD COMPOSITION' },
  'milestone-acceptance': { cn: '里程碑与验收', en: 'MILESTONE & ACCEPTANCE' },
  // 其余十页归 A/E/H；D 版只实现自己四页（类型上不可达，运行时兜底）
  'stage-overview': { cn: '阶段总览', en: 'STAGE OVERVIEW' },
  'task-register': { cn: '任务读号表', en: 'TASK REGISTER' },
  'delay-ledger': { cn: '延期记录表', en: 'DELAY LEDGER' },
  'member-roster': { cn: '成员责任表', en: 'MEMBER ROSTER' },
  'stage-index': { cn: '阶段目录', en: 'STAGE INDEX' },
  'member-index': { cn: '成员执行体目录', en: 'MEMBER INDEX' },
  'artifact-index': { cn: '产出物清单', en: 'ARTIFACT INDEX' },
  'agent-declaration': { cn: '执行宣告', en: 'EXECUTION DECLARATION' },
  'execution-status': { cn: '执行状态全览', en: 'EXECUTION STATUS' },
  'writeback-proposals': { cn: '写回提案公示', en: 'WRITEBACK PROPOSALS' },
};

/**
 * 页脚**单行**口径注（P0-9 ② / 规格 §3.3「口径注必登，形态收成一行」）。
 *
 * 参考稿 D 的脚注是一行图例（`深色=已完成部分 浅色=剩余 · 百分比 = 阶段任务完成度`）
 * + 右「01」；我们的产品口径注比它长，故压到 9.5px 并逐条保留**每一条**口径
 * 声明（不删内容，只压措辞）：
 *   · 完成度算式 = 已完成可见阶段 ÷ 可见阶段总数（不按占比加权）
 *   · 占比 ≠ 完成度（`01 §3.1` 防误读的硬要求）
 *   · 条的读法 = 阶段内任务完成度（产品必登字段，规格 §3.3）
 *   · 隐藏阶段的可见性口径
 * `white-space: nowrap` + ellipsis（`.de-foot__note`）保证它**恒为一行**
 * （验收判据 `getClientRects().length === 1`）。
 */
const DE_FOOT_NOTE =
  '口径：完成度=已完成可见阶段÷可见阶段（不加权）；占比=ratioPercent≠完成度；条=阶段内任务完成度；隐藏阶段不入表不计';

export interface DataEditorialDocumentProps {
  vm: PrintViewModel;
  /**
   * 纸面页（期三：原生页 kind + 通用模块 id；缺省 = 默认原生模块）。
   * D 的 M1/M2/M4 无原生页 ⇒ 走通用渲染（该外表基础排版承接）。
   */
  sheets?: readonly PrintSheet[];
  /**
   * **解析好的单元**（`resolveUnits('data-editorial', prefs)` 的结果：5 块 + 2 件
   * 版性装置 `de-head` / `de-band`）。未传 `sheets` 时走「5 块形态」。
   *
   * 与 A 版同一条路（决策 5 第 2 条）：内容块与装置都从同一个 `ResolvedPrintUnit[]`
   * 取「今天渲不渲染」⇒ 将来把装置开放成可勾时只改注册表，本文件零改动。
   * 缺省 = `resolveUnits('data-editorial', undefined)`（全开）。
   */
  units?: readonly ResolvedPrintUnit[];
  /** 有效配色（自定义或设计师基线；三枚 hex） */
  palette: PrintPalette;
  /** 全局打印 logo（base64 dataURL；null = 未上传，每页头部左上格显示「ID Plan」文字标） */
  logo?: string | null;
  /** 导出 PNG 的页面元素收集（ref callback 数组，宿主持有） */
  pageRef?: (idx: number) => Ref<HTMLDivElement>;
}

/* ------------------------------------------------------------------ 物理页装配 */

/** D 版一个物理纸面（原生页 or 通用模块的一个 chunk；plan=null = 空态纸） */
export type DePhysical =
  | {
      type: 'native';
      kind: 'progress-matrix';
      /** 矩阵分页计划（2026-10-09：阶段行按页预算 chunk，KPI 只首页） */
      plan: MatrixPlan;
      chunkIndex: number;
      chunkTotal: number;
    }
  | { type: 'native'; kind: Exclude<PrintPageKind, 'progress-matrix'> }
  | {
      type: 'generic';
      module: 'stage-list' | 'task-list' | 'member-roster';
      plan: GenericPlan | null;
      chunkIndex: number;
      chunkTotal: number;
    };

/** sheets ⇒ D 版物理页序列（原生 1:1；进度矩阵按行预算分页；通用模块经 planGenericModule 分页） */
export function dataEditorialPhysical(vm: PrintViewModel, sheets: readonly PrintSheet[]): DePhysical[] {
  const out: DePhysical[] = [];
  for (const sheet of sheets) {
    if (sheet.type === 'native') {
      if (!DATA_EDITORIAL_PAGES.includes(sheet.page)) continue;
      if (sheet.page === 'progress-matrix') {
        // 阶段行分页（行不裂；KPI 只首页；续表页带续表头）
        const plan = planMatrixPages(vm.stages);
        for (let i = 0; i < plan.chunks.length; i++) {
          out.push({ type: 'native', kind: 'progress-matrix', plan, chunkIndex: i, chunkTotal: plan.chunks.length });
        }
        continue;
      }
      out.push({ type: 'native', kind: sheet.page });
      continue;
    }
    if (!isGenericRenderable(sheet.module)) continue;
    const plan = planGenericModule(sheet.module, vm, 'data-editorial');
    const total = plan === null ? 1 : plan.chunks.length;
    for (let i = 0; i < total; i++) {
      out.push({ type: 'generic', module: sheet.module, plan, chunkIndex: i, chunkTotal: total });
    }
  }
  return out;
}

export function DataEditorialDocument({
  vm,
  sheets,
  units,
  palette,
  logo = null,
  pageRef,
}: DataEditorialDocumentProps): JSX.Element {
  // 同一条解析路径（决策 5 第 2 条；与 A 版逐字同款）
  const resolvedUnits = units ?? resolveUnits('data-editorial', undefined);
  const blocks = blockRecordOf(resolvedUnits);
  const show = (id: PrintUnitId): boolean => unitEnabled(resolvedUnits, id);
  /**
   * 两种形态的分流（**唯一分叉点**，与 A 版同款）：
   *   · 传了 `sheets` ⇒ legacy 原生页路径（四页 + 通用模块；出选择器但代码全留）；
   *   · 否则 ⇒ 5 块形态（决策 1：选择器只暴露 5 块；缺省 = 五块全开）。
   */
  const legacy = sheets ? dataEditorialPhysical(vm, sheets) : null;
  const blockPages = legacy === null ? deBlockPages(vm, blocks) : null;
  const total = legacy ? legacy.length : (blockPages?.length ?? 0);

  return (
    <div
      className={`print-root mx-auto w-fit ${printTemplateClass('data-editorial')}`}
      style={
        {
          '--tpl-accent': palette.accent,
          '--tpl-ink': palette.ink,
          '--tpl-line': palette.line,
        } as CSSProperties
      }
    >
      {legacy &&
        legacy.map((p, idx) => (
          <DePage
            key={p.type === 'native' ? p.kind : `generic-${p.module}-${p.chunkIndex}`}
            page={p}
            vm={vm}
            pageIndex={idx}
            pageTotal={total}
            pageRef={pageRef?.(idx)}
            logo={logo}
          />
        ))}
      {blockPages &&
        blockPages.map((plan, idx) => (
          <DeBlockPage
            key={`blocks-${idx}`}
            vm={vm}
            blocks={blocks}
            show={show}
            plan={plan}
            pageIndex={idx}
            pageTotal={total}
            pageRef={pageRef?.(idx)}
            logo={logo}
          />
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 纸面外壳 */

function DePage({
  page,
  vm,
  pageIndex,
  pageTotal,
  pageRef,
  logo,
}: {
  page: DePhysical;
  vm: PrintViewModel;
  pageIndex: number;
  pageTotal: number;
  pageRef?: Ref<HTMLDivElement>;
  logo: string | null;
}): JSX.Element {
  // 页题：原生页走 DE_PAGE_TITLES；通用模块走 GENERIC_TITLES（期三）
  const title =
    page.type === 'native'
      ? (DE_PAGE_TITLES[page.kind] ?? DE_PAGE_TITLES['progress-matrix']!)
      : GENERIC_TITLES[page.module];
  const pageAttr = page.type === 'native' ? page.kind : `generic-${page.module}`;
  return (
    <div
      ref={pageRef}
      data-print-page={pageAttr}
      data-page-index={pageIndex}
      className="a4-page de-page"
      style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX }}
    >
      {/* B1 的载荷在 `de-head` 装置里（批 B：抽成共享件 `DeHead`，DOM 逐字不变）。
          legacy 路径的巨字标题 = **该页的页题**（与 5 块形态的固定类型词相对）。 */}
      <DeHead
        vm={vm}
        logo={logo}
        pageIndex={pageIndex}
        pageTotal={pageTotal}
        title={title}
        /* legacy 的排期口径行**逐字不变**（含排期基准） */
        meta={`${vm.project.scheduleBasisLabel} · ${vm.project.plannedStartAt} – ${vm.project.plannedEndAt}${
          vm.project.clientName ? ` · 委托人 ${vm.project.clientName}` : ''
        }`}
      />

      <div className="de-body">
        <DePageBody page={page} vm={vm} />
      </div>

      {/* 页脚（2026-10-11 P0-9 ②）：通版 1px 发丝线 + **单行**脚注（左）+
          页序/数据时间（右）。口径注是产品必登项（§3.3），形态收成参考稿
          那样的一行（9.5px + 降一档灰）；原「口径注段落 + 品牌页脚带」两段
          在审计里被登记为「现状有、参考没有的块」，本批合并成一行。 */}
      <footer className="de-foot">
        <span className="de-foot__note">{DE_FOOT_NOTE}</span>
        <span className="de-foot__page de-num">
          第 {pageIndex + 1} / {pageTotal} 页 · 数据时间 {stampOf(vm.generatedAt)}
        </span>
      </footer>
    </div>
  );
}

function DePageBody({ page, vm }: { page: DePhysical; vm: PrintViewModel }): JSX.Element {
  if (page.type === 'generic') {
    return <GenericModuleBody plan={page.plan} chunkIndex={page.chunkIndex} />;
  }
  switch (page.kind) {
    case 'progress-matrix':
      return (
        <ProgressMatrixPage
          vm={vm}
          rows={page.plan.chunks[page.chunkIndex]?.rows ?? []}
          chunkIndex={page.chunkIndex}
          chunkTotal={page.chunkTotal}
        />
      );
    case 'dependency-network':
      return <DependencyNetworkPage vm={vm} />;
    case 'workload-composition':
      return <WorkloadCompositionPage vm={vm} />;
    case 'milestone-acceptance':
      return <MilestoneAcceptancePage vm={vm} />;
    default:
      // 其余十页归 A/E/H；本组件只实现 D 四页（类型上不可达，运行时兜底）
      return <EmptyPrintState kind="stages" text="该页属于其他版本模板" />;
  }
}

/* ====================================================================================
 * 5 块形态（2026-10-13 「5 块 × 4 模板」重构 · 批 B）
 * ====================================================================================
 * 依据 `deliverables/gstack/print-5blocks-mapping-2026-10-13.md`：
 *   · §1.2 = D 的 5 块映射（逐格照做）；§0.5 = B4 的 L3「改期记录」；
 *   · §2.6 = 装置 vs 内容（`de-head` / `de-band` / `REPORT nn/nn` 恒在、不可摘）；
 *   · §3 铁律①= B1 ∪ B3 是同一组字段全集（分界线可按各版刊头承载能力走）。
 *
 * 分页口径：
 *   B1 打印头部 **每页**；B2 日期格矩阵 与 B4 阶段清单 **共用同一批阶段切片**
 *   （每页同一批 ⇒ 两个视图能互相对照，且不会出现「矩阵翻了页、清单还在上一页」
 *   的错位）；B3 项目信息 只首页（承载区）；B5 页脚 **每页**。
 *   切片按页预算滚动 —— 与 A 版同一套贪心切法（附「收口页」与「首页让位一次」
 *   两条规则，防死循环与空壳尾页）。
 * ==================================================================================== */

/**
 * D 5 块形态的纸面几何常量（px）——纪律与 A 版 / `MATRIX_EST` 同款：
 * **实测校准、只许偏大不许偏小**。2026-10-13 批 B 真 Chromium 逐块实测后回填
 * （见各条注释里的实测值）。
 */
const DE_BLOCK_EST = {
  /** 页壳：`de-head` 213（CSS 里钉死的常数，含 3px 线）+ 主体上内距 39
      + `de-band` 42 + 页脚 52（8 上距 + 44 行高） */
  pageShell: 213 + 39 + 42 + 52,
  /** B2 矩阵 chrome：caption 行 + **2px 硬边线** + 列头行（实测 39.75 → 取 42）
      + 矩阵与清单之间的下距 24（`.de-mx` 的 margin-bottom） */
  b2Chrome: 42 + 24,
  /** B2 轨道行高（固定）：切片由 B4 的行高主导，矩阵不需要再自适应 */
  b2Row: 26,
  /** B3 项目信息簇（mono 行 + 口径注 + 上距 20）：实测 53.25 → 取 55 */
  b3: 55,
  /** B4 续表头（仅续页）：2px 线 + kicker + 下距，与 `MATRIX_EST.contHead` 同源 */
  contHead: 28,
  /** B4 两段式行：normal 90 / compact 49（与 `MATRIX_EST` 同值同源） */
  listRowNormal: 90,
  listRowCompact: 49,
  /** 每页**尾行免掉的**下距（与 CSS `.de-row:last-child` 同源） */
  lastFreeNormal: 36,
  lastFreeCompact: 13,
  /** L3 改期记录固定头 + 每条 */
  reschedHead: 106,
  reschedRow: 24,
} as const;

/** 5 块形态每页可用高 */
const DE_BLOCK_AVAIL = A4_HEIGHT_PX - DE_BLOCK_EST.pageShell;

/**
 * 5 块形态的**紧凑档切点**（> 此值即 compact）。
 *
 * ⚠️ 与 legacy 的 `MATRIX_COMPACT_AT = 9` **不同源、也不同值**：5 块形态的首页
 * 还要装 B2 的 chrome（46）与 B3 簇（42），normal 档容量因此从 9 降到 8。
 * 纪律照旧：**切档点 = normal 容量**（normal 装不下的第一个规模就切档），
 * 不留「normal 装不下却仍在 normal」的断崖（否则 9 阶段会被切成 8+1 两页，
 * 而 10 阶段反倒一页 —— 那正是 legacy 注释里点名的病）。
 * 推导：`floor((可用 − B3 − B2 chrome + 尾行免下距) ÷ (B2 行高 + 清单 normal 行高))`
 * ⇒ `floor((777 − 55 − 66 + 36) ÷ (26 + 90))` = **5**（一行阶段在 5 块形态里要占
 * 两份纵向空间：矩阵一行 + 清单一行）。
 * 这也是它与 legacy 的 `MATRIX_COMPACT_AT = 9` 差得远的原因——legacy 的页面
 * 只有清单一份。
 */
export const DE_BLOCK_COMPACT_AT = Math.floor(
  (DE_BLOCK_AVAIL - DE_BLOCK_EST.b3 - DE_BLOCK_EST.b2Chrome + DE_BLOCK_EST.lastFreeNormal) /
    (DE_BLOCK_EST.b2Row + DE_BLOCK_EST.listRowNormal),
);

/** 一页的 5 块装配计划（B2 与 B4 共用 `stages` 切片） */
export interface DeBlockPagePlan {
  first: boolean;
  /** 本页承载的阶段（B2 矩阵行 = B4 清单行 = 这一批） */
  stages: readonly PrintStageVM[];
  /** 本页是 B4 的最后一页（L3 改期记录挂这里；§0.5） */
  last: boolean;
}

/**
 * 5 块形态的物理页装配（**预计页数 = 实际出纸**的唯一出处）。
 *
 * 规则（顺序即优先级）：
 *   ① 每页预算 = 可用高 −（首页的 B3 簇 / 续页的续表头）− B2 的 chrome；
 *   ② 切片大小 = `min(B2 容量, B4 容量, 剩余)` —— 两个视图**共用同一批阶段**；
 *   ③ 本页连一行都装不下 ⇒ 出一张**纸壳页**（只允许一次，防死循环）；
 *   ④ L3 改期记录挂在 B4 的最后一页；本页装得下清单却装不下 L3 ⇒ 只装「给 L3
 *      留位」的那一档，余下顺延（**不让位**：D 的续页要另付 28px 续表头、
 *      比首页更紧，让位只会多出一页——与 A 版相反，A 的续页板头比首页矮）。
 *
 * ⚠️ 与 §3「B2 + B4；阶段多时各自 chunk 分页」的**用词差异**（有意）：
 * 我让两者**共用同一批切片**而不是各自独立 chunk —— 同一页上矩阵与清单指的是
 * 同一批阶段（可互相对照），不会出现「矩阵已翻到第 3 批、清单还在第 2 批」的错位。
 */
export function deBlockPages(vm: PrintViewModel, blocks: SchedulePaperBlocks): DeBlockPagePlan[] {
  const stages = vm.stages;
  const total = stages.length;
  if (total === 0) return [{ first: true, stages: [], last: true }];

  const dense = total > DE_BLOCK_COMPACT_AT;
  const listRow = dense ? DE_BLOCK_EST.listRowCompact : DE_BLOCK_EST.listRowNormal;
  const lastFree = dense ? DE_BLOCK_EST.lastFreeCompact : DE_BLOCK_EST.lastFreeNormal;
  const resched = blocks.stageTable ? deRescheduleRows(vm) : [];
  const reschedH =
    resched.length > 0 ? DE_BLOCK_EST.reschedHead + resched.length * DE_BLOCK_EST.reschedRow : 0;

  /**
   * 某页能装几**行阶段**。
   *
   * ⚠️ 关键对价（2026-10-13 批 B 探针实测纠正过一次）：**一行阶段在 5 块形态里
   * 要占两份纵向空间**——B2 矩阵一行 + B4 清单一行（两者共用同一切片）⇒ 每行成本
   * 是 `b2Row + listRow`，不是二者取 min。第一版按「两张表各自算容量再取 min」
   * 写，等于免费多印一整个矩阵（9 阶段实测溢出 122px）。
   */
  const capOf = (avail: number): number => {
    // ⚠️ 两个块**各自**在才算自己的行成本：清单关掉时不该再收清单的行高
    //   （第一版漏了这一条 ⇒ 关 B4 后仍按「矩阵 + 清单」估行，页数白多一页）
    const perRow = (blocks.timeline ? DE_BLOCK_EST.b2Row : 0) + (blocks.stageTable ? listRow : 0);
    if (perRow <= 0) return 0;
    return Math.max(Math.floor((avail + (blocks.stageTable ? lastFree : 0)) / perRow), 0);
  };
  /** 某页（首页 / 续页）扣掉 chrome 后留给「阶段行」的预算 */
  const availOf = (first: boolean): number =>
    DE_BLOCK_AVAIL -
    (first ? DE_BLOCK_EST.b3 : DE_BLOCK_EST.contHead) -
    (blocks.timeline ? DE_BLOCK_EST.b2Chrome : 0);

  const pages: DeBlockPagePlan[] = [];
  let cursor = 0;
  let shelled = false;
  let guard = 0;
  while (cursor < total && guard++ < 512) {
    const first = pages.length === 0;
    const avail = availOf(first);
    const remaining = total - cursor;
    const cap = capOf(avail);
    const capTail = capOf(avail - reschedH);
    // 收口：全部装得下，且给 L3 留得出位置
    if (cap >= remaining && capTail >= remaining) {
      pages.push({ first, stages: stages.slice(cursor), last: true });
      break;
    }
    // 本页装得下清单、装不下 L3 ⇒ 只装「给 L3 留位」的那一档，余下下页
    // （**不让位**：D 的续页要另付 28px 续表头、比首页更紧，让位只会多出一页
    //   —— 这与 A 版相反：A 的续页板头比首页矮，让位是划算的）
    const take = Math.max(Math.min(capTail > 0 ? capTail : cap, remaining), 0);
    if (take > 0) {
      pages.push({ first, stages: stages.slice(cursor, cursor + take), last: false });
      cursor += take;
      continue;
    }
    // 本页连一行都装不下：出一张纸壳页（只允许一次，防死循环），否则兜底收下
    if (!shelled) {
      shelled = true;
      pages.push({ first, stages: [], last: false });
      continue;
    }
    pages.push({ first, stages: stages.slice(cursor), last: true });
    break;
  }
  // 兜底：B4 有承载时**必须**有一页收口（否则 L3 会静默不上纸）
  if (blocks.stageTable && total > 0 && !pages.some((pg) => pg.last)) {
    const i = pages.length - 1;
    pages[i] = {
      ...pages[i]!,
      stages: pages[i]!.stages.length > 0 ? pages[i]!.stages : stages.slice(),
      last: true,
    };
  }
  return pages;
}

/** 5 块形态的一个物理页（B1 + B2/B3/B4 + B5；装置 `de-head` / `de-band` 恒在） */
function DeBlockPage({
  vm,
  blocks,
  show,
  plan,
  pageIndex,
  pageTotal,
  pageRef,
  logo,
}: {
  vm: PrintViewModel;
  blocks: SchedulePaperBlocks;
  show: (id: PrintUnitId) => boolean;
  plan: DeBlockPagePlan;
  pageIndex: number;
  pageTotal: number;
  pageRef?: Ref<HTMLDivElement>;
  logo: string | null;
}): JSX.Element {
  const dense = vm.stages.length > DE_BLOCK_COMPACT_AT;
  const resched = blocks.stageTable ? deRescheduleRows(vm) : [];
  const reschedTotal = vm.stageLogs.filter((l) => l.type === 'rescheduled').length;
  // 口径注**恒在**（§2.6 原则 1）：B3 开着且本页有承载时住在 B3 簇里，否则锚回页脚
  const noteInCluster = blocks.projectInfo && plan.first;
  return (
    <div
      ref={pageRef}
      data-print-page="blocks"
      data-page-index={pageIndex}
      className="a4-page de-page"
      style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX }}
    >
      {/* 装置 · `de-head`（含 `REPORT nn/nn`：D 的页码唯一落点）；B1 的载荷在里面 */}
      {show('de-head') && (
        <DeHead
          vm={vm}
          logo={logo}
          pageIndex={pageIndex}
          pageTotal={pageTotal}
          /* 巨字 = **固定类型词**（§1.2 B1 的乙项：从「页题」改成类型词）；
             每页身份交给橙副标与 REPORT 装置 */
          title={{ cn: DE_TYPE_TITLE, en: DE_TYPE_KICKER }}
          /* 排期基准搬去 B3 的 mono 行 ⇒ 本行只剩周期 · 委托人（不重复印） */
          meta={`${vm.project.plannedStartAt} – ${vm.project.plannedEndAt}${
            vm.project.clientName ? ` · 委托人 ${vm.project.clientName}` : ''
          }`}
        />
      )}

      <div className="de-body">
        {/* B2 打印时间轴（日期格矩阵）：与 B4 共用本页切片 */}
        {blocks.timeline && plan.stages.length > 0 && (
          <DateMatrix vm={vm} rows={plan.stages} rowHeight={DE_BLOCK_EST.b2Row} />
        )}

        {/* B4 阶段清单（两段式通栏条 + L3 改期记录）。
            chunkIndex 用「本页是不是首页」而不是页码：续表头只在「清单被切开」
            的续页出（首页与后续页都由同一个判定给出，与 legacy 的表意一致） */}
        {blocks.stageTable && plan.stages.length > 0 && (
          <StageBarList
            vm={vm}
            rows={plan.stages}
            chunkIndex={plan.first && pageIndex === 0 ? 0 : 1}
            chunkTotal={pageTotal}
            resched={resched}
            reschedTotal={reschedTotal}
            withResched={plan.last}
            dense={dense}
          />
        )}
        {/* 空态只在「整个项目没有可见阶段」时出（纸壳页不出空态） */}
        {blocks.stageTable && vm.stages.length === 0 && plan.stages.length === 0 && (
          <section className="de-board" data-print-block="stageTable">
            <EmptyPrintState kind="stages" />
          </section>
        )}

        {/* B3 项目信息簇（只首页）：mono 行 + 口径注。
            **口径注恒在**（§2.6 原则 1 的硬底线：口径注不是块）——B3 关掉时
            它锚回页脚 `de-foot__note`（见下方 footer）。 */}
        {noteInCluster && (
          <div className="de-info" data-print-block="projectInfo">
            <p className="de-info__line de-num">
              排期基准 {vm.project.scheduleBasisLabel}　·　打印时间 {stampOf(vm.generatedAt)}
            </p>
            <p className="de-info__note">{DE_FOOT_NOTE}</p>
          </div>
        )}

        {/* 装置 · 页尾完成度横带（每页都有；**不是** KPI 带） */}
        {show('de-band') && <DeBand vm={vm} />}
      </div>

      {/* B5 页脚：1px 发丝线 + **署名**（批 B 新增）+ 数据时间（可摘）；
          **页码不在这**（住页头 `REPORT nn/nn`，一页两个页码是排版病） */}
      <footer className="de-foot">
        <span className="de-foot__sign">ID Plan · 项目排期与交付管理</span>
        {!noteInCluster && <span className="de-foot__note">{DE_FOOT_NOTE}</span>}
        {blocks.footer && (
          <span className="de-foot__page de-num">数据时间 {stampOf(vm.generatedAt)}</span>
        )}
      </footer>
    </div>
  );
}
