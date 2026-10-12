/**
 * E 版 · Editorial Index（目录索引；01 文档 §6 / 02 文档 §6）。
 *
 * ── 为什么独立组件而不是塞进 SchedulePaper ──
 * 01 §1：「不能把四版实现为同一个 DOM 骨架加不同颜色；每版主体布局必须
 * 独立」。E 的纸面是暖浅纸面 + 巨编号目录 + 发丝线/粗章节线分组，与经典
 * 纸面（白底甘特 + 清单表）、A 版（交通黄时刻表）、D 版（白底数据网格）
 * 零共享结构。可共享的只有 `.a4-page` 纸面类与打印分页规则。
 *
 * ── 视觉契约（01 §6 / 02 §6 token；纸底与焦点色 2026-10-11 P0-15 按参考稿校准）──
 *   纸面 #F5F2EC（--ei-paper 固定，不开槽位——纸面性格是模板身份）
 *   主文字 #141414（= --tpl-ink 槽位）；赭红 #B04A2F（= --tpl-accent 槽位）
 *   发丝线 #CFC6B4（= --tpl-line 槽位）；章节粗线 5px 近黑
 *   大编号独立列（真实 DOM，禁伪元素——02 §6：分页与可访问性稳定）
 *   不用卡片；三页均无底部黑栏（页脚只有发丝线 + 署名 + 页码）。
 *
 * ── 长目录跨页（01 §9：20+ 阶段稳定处理）──
 * 每个逻辑页（阶段/成员/产出物目录）的条目序列经
 * `paginateEiEntries` 贪心分页（章头不孤儿 / 跨页续头 / 行不裂），
 * 产出**多个物理纸面**；页码按物理页连续编号，每页页头页脚齐全
 *（每页可独立解释，01 §2）。空逻辑页照样出一张纸——明确空态
 *（01 §8），不静默消失。
 *
 * ── 配色槽位 ──
 * 三枚经 `.print-root` 的 inline CSS 变量挂载（--tpl-accent / --tpl-ink /
 * --tpl-line），inline style 经 print-frame 的 cloneNode(true) 原样进
 * iframe 打印面，无损（与 A/D 同一机制，print-palette.ts 文件头）。
 */

import type { CSSProperties, Ref } from 'react';

import { A4_WIDTH_PX, A4_HEIGHT_PX } from '../../lib/schedule-print';
import { enabledSheetsOf, printTemplateClass } from '../../components/print/print-templates';
import type { PrintSheet } from '../../components/print/print-templates';

import { StageStatus } from '../../core/types/enums';
import type { PrintMemberVM, PrintPageKind, PrintStageVM, PrintViewModel } from '../model/print-view-model';
import type { PrintPalette } from '../model/print-palette';
import { buildPrintGantt, type PrintGanttModel } from '../model/print-gantt';
import {
  blockRecordOf,
  resolveUnits,
  unitEnabled,
  type PrintUnitId,
  type ResolvedPrintUnit,
} from '../model/print-units';
import { EI_SPAN_ROW_H, SpanIndex } from '../pages/editorial-index/SpanIndex';
import { EiReschedule } from '../pages/editorial-index/Reschedule';
import type { SchedulePaperBlocks } from '../../lib/schedule-print';
import { EmptyPrintState } from '../parts/EmptyPrintState';
import { PrintLogoMark } from '../parts/PrintLogoMark';
import { GenericModuleBody } from '../pages/generic/GenericModuleBody';
import {
  GENERIC_TITLES,
  isGenericRenderable,
  planGenericModule,
  type GenericPlan,
} from '../pages/generic/shared';
import {
  EI_BLOCK_NOTE,
  eiRescheduleRows,
  paginateEiEntries,
  STAGE_GLYPH,
  stageStatusLabel,
  stampOf,
  type EiEntry,
} from '../pages/editorial-index/shared';
import {
  ArtifactIndexEmpty,
  ArtifactIndexPage,
  artifactIndexIsEmpty,
  buildArtifactIndexEntries,
  type EiArtifactRow,
} from '../pages/editorial-index/ArtifactIndexPage';
import {
  buildMemberIndexEntries,
  MemberIndexEmpty,
  MemberIndexPage,
  memberIndexIsEmpty,
} from '../pages/editorial-index/MemberIndexPage';
import {
  buildStageIndexEntries,
  StageIndexEmpty,
  StageIndexPage,
  stageIndexIsEmpty,
} from '../pages/editorial-index/StageIndexPage';
// E 版样式（Vite 随组件 chunk 进包；全部规则带 .print-root.print-template-* 前缀）
import '../styles/editorial-index.css';

/** E 版三页（02 §6 组件映射；顺序即纸面顺序） */
export const EDITORIAL_INDEX_PAGES: readonly PrintPageKind[] = [
  'stage-index',
  'member-index',
  'artifact-index',
];

/** 页题（完整单行中文标题 + 英文栏 kicker；中英双语刊头是索引体的版式语言） */
const EI_PAGE_TITLES: Record<PrintPageKind, { cn: string; en: string }> = {
  'stage-index': { cn: '阶段目录', en: 'STAGE INDEX' },
  'member-index': { cn: '成员执行体目录', en: 'MEMBER INDEX' },
  'artifact-index': { cn: '产出物清单', en: 'ARTIFACT INDEX' },
  // 其余十一页归 A/D/H；E 版只实现自己三页（类型上不可达，运行时兜底）
  'stage-overview': { cn: '阶段总览', en: 'STAGE OVERVIEW' },
  'task-register': { cn: '任务读号表', en: 'TASK REGISTER' },
  'delay-ledger': { cn: '延期记录表', en: 'DELAY LEDGER' },
  'member-roster': { cn: '成员责任表', en: 'MEMBER ROSTER' },
  'progress-matrix': { cn: '阶段进度矩阵', en: 'PROGRESS MATRIX' },
  'dependency-network': { cn: '任务依赖网络', en: 'DEPENDENCY NETWORK' },
  'workload-composition': { cn: '阶段工作量构成', en: 'WORKLOAD COMPOSITION' },
  'milestone-acceptance': { cn: '里程碑与验收', en: 'MILESTONE & ACCEPTANCE' },
  'agent-declaration': { cn: '执行宣告', en: 'EXECUTION DECLARATION' },
  'execution-status': { cn: '执行状态全览', en: 'EXECUTION STATUS' },
  'writeback-proposals': { cn: '写回提案公示', en: 'WRITEBACK PROPOSALS' },
};

/* ------------------------------------------------------------------ 分页几何 */

/**
 * 物理纸面的固定框架高度（px；与 editorial-index.css 的页头/logo 行/页脚
 * 实测值对齐——分页估高偏大会早分页、偏小会溢出，两边必须同源）。
 * 各项取「实测值 + 余量」：估高只允许偏保守（大），不允许小于实测。
 */
const EI_HEAD_H = 334; // 刊头：logo 格 + 双语刊头 + 两行巨题（2×106）+ 5px 章节粗线（实测 ≈331，取 334 偏保守）
const EI_FOOT_H = 46; // 实测 41（40 高 + 1 发丝线）
const EI_BODY_PADDING = 20; // 主体上下内距 12 + 8
const EI_NOTE_H = 46; // 口径注（10 上距 + 两行 16.5 + 1 线，取整）
const EI_META_H = 37; // 元信息行（期七深化：6 上距 + 23 行高 + 10 下距，实测 ≈27+10）
/** 每物理页主体可用高度（纸面 1123 − 页头 − 页脚 − 主体内距 − 口径注 − 元信息行） */
const EI_BODY_H = A4_HEIGHT_PX - EI_HEAD_H - EI_FOOT_H - EI_BODY_PADDING - EI_NOTE_H - EI_META_H;

/**
 * 目录行估高（normal / compact 两档）。
 * normal 实测 69px（padding 9/9 + 巨编号 50px line-height:1 + 1px 发丝线，
 * 2026-10-11 P0-14 巨编号 24→50px 后真 Chromium 量）；取 70 偏保守（大）
 * = 早分页白留一截，不允许小于实测（小 = 溢出）。compact 实测 ≈30，取 31。
 */
const EI_ROW_H = {
  stage: { normal: 70, compact: 31 },
  member: { normal: 70, compact: 31 },
  artifact: { normal: 70, compact: 31 },
} as const;
/**
 * 章头估高。normal 实测槽位 59.75px（margin-top 22 + 元素 37.75：2px 粗线
 * + padding 9/8 + 12.5px 粗体文本，2026-10-09 密度修订后真 Chromium 量），
 * 取 60 偏保守。⚠️ 设计文档原案写 54——那小于实测 59.75，违反本文件「估高
 * 只允许偏保守」纪律（偏小 = 分页器多装 ⇒ 实际内容溢出纸面），故按实测取 60。
 * compact 实测 ≈37，取 38。
 */
const EI_CHAPTER_H = { normal: 60, compact: 38 } as const;

/** 超过该行数转紧凑档（分页照旧——紧凑只是让每页多装几行） */
const COMPACT_THRESHOLD = 16;

export interface EditorialIndexDocumentProps {
  vm: PrintViewModel;
  /**
   * 纸面页（期三：原生页 kind + 通用模块 id；缺省 = 默认原生模块）。
   * E 的 M2 任务清单无原生页 ⇒ 走通用渲染（该外表基础排版承接）。
   */
  sheets?: readonly PrintSheet[];
  /**
   * **解析好的单元**（`resolveUnits('editorial-index', prefs)` 的结果：5 块 + 2 件
   * 版性装置 `ei-giant-title` / `ei-sheet-tag`）。未传 `sheets` 时走「5 块形态」。
   * 与 A/D 同一条路（决策 5 第 2 条）：将来开放装置勾选只改 registry。
   */
  units?: readonly ResolvedPrintUnit[];
  /** 有效配色（自定义或设计师基线；三枚 hex） */
  palette: PrintPalette;
  /** 全局打印 logo（base64 dataURL；null = 未上传，显示「ID Plan」文字标） */
  logo?: string | null;
  /** 导出 PNG 的页面元素收集（ref callback 数组，宿主持有） */
  pageRef?: (idx: number) => Ref<HTMLDivElement>;
}

export function EditorialIndexDocument({
  vm,
  sheets,
  units,
  palette,
  logo = null,
  pageRef,
}: EditorialIndexDocumentProps): JSX.Element {
  // 同一条解析路径（决策 5 第 2 条；与 A/D 逐字同款）
  const resolvedUnits = units ?? resolveUnits('editorial-index', undefined);
  const blocks = blockRecordOf(resolvedUnits);
  const show = (id: PrintUnitId): boolean => unitEnabled(resolvedUnits, id);
  /**
   * 两种形态的分流（**唯一分叉点**）：
   *   · 传了 `sheets` ⇒ legacy 原生页路径（三页 + 通用模块；出选择器但代码全留）；
   *   · 否则 ⇒ 5 块形态（决策 1：选择器只暴露 5 块；缺省 = 五块全开）。
   */
  const legacy = sheets ? editorialIndexPhysical(vm, sheets) : null;
  const blockPages = legacy === null ? eiBlockPages(vm, blocks) : null;
  const total = legacy ? legacy.length : (blockPages?.length ?? 0);
  /** B2 的甘特模型：与 A/D 同一套派生（`buildPrintGantt`），只算一次 */
  const gantt = legacy === null ? buildPrintGantt(vm.project, vm.stages) : null;

  return (
    <div
      className={`print-root mx-auto w-fit ${printTemplateClass('editorial-index')}`}
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
          <EiPage
            key={`${p.kind}-${idx}`}
            page={p}
            vm={vm}
            logo={logo}
            pageIndex={idx}
            pageTotal={total}
            pageRef={pageRef?.(idx)}
          />
        ))}
      {blockPages &&
        gantt &&
        blockPages.map((plan, idx) => (
          <EiBlockPage
            key={`blocks-${idx}`}
            vm={vm}
            blocks={blocks}
            show={show}
            plan={plan}
            gantt={gantt}
            logo={logo}
            pageIndex={idx}
            pageTotal={total}
            pageRef={pageRef?.(idx)}
          />
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 物理页装配 */

/** 一个物理纸面的内容（原生 kind + 条目块；通用模块 + 分页计划；null = 空态纸面） */
export type EiPhysical =
  | { kind: 'stage-index'; block: { entries: readonly EiEntry<PrintStageVM>[]; compact: boolean } | null }
  | { kind: 'member-index'; block: { entries: readonly EiEntry<PrintMemberVM & { seq: number }>[]; compact: boolean } | null }
  | { kind: 'artifact-index'; block: { entries: readonly EiEntry<EiArtifactRow>[]; compact: boolean } | null }
  | {
      kind: 'generic';
      module: 'stage-list' | 'task-list' | 'member-roster';
      plan: GenericPlan | null;
      chunkIndex: number;
      chunkTotal: number;
    }
  /** 5 块形态的纸面（批 C）：B1..B5 的物理页（B2/B4 各自按页预算切片） */
  | { kind: 'blocks'; plan: EiBlockPagePlan };

/**
 * 逻辑页 → 物理页组（条目构造 + 分页；空逻辑页 = 一张空态纸）。
 * 返回类型收窄掉 'blocks'（5 块形态不走本函数）——两套粒度在同一份物理页联合类型
 * 里共存，但**装配器各管各的**，类型上就不会串。
 */
export function editorialIndexPhysical(
  vm: PrintViewModel,
  sheets: readonly PrintSheet[],
): Exclude<EiPhysical, { kind: 'blocks' }>[] {
  const out: Exclude<EiPhysical, { kind: 'blocks' }>[] = [];

  for (const sheet of sheets) {
    if (sheet.type === 'generic') {
      // 期三：通用模块（M2 任务清单）经共享分页器落多页；空模块 = 一张空态纸
      if (!isGenericRenderable(sheet.module)) continue;
      const plan = planGenericModule(sheet.module, vm, 'editorial-index');
      const total = plan === null ? 1 : plan.chunks.length;
      for (let i = 0; i < total; i++) {
        out.push({ kind: 'generic', module: sheet.module, plan, chunkIndex: i, chunkTotal: total });
      }
      continue;
    }
    const kind = sheet.page;
    if (kind === 'stage-index') {
      if (stageIndexIsEmpty(vm)) {
        out.push({ kind, block: null });
        continue;
      }
      const entries = buildStageIndexEntries(vm);
      const compact = countRows(entries) > COMPACT_THRESHOLD;
      const chunks = paginateEiEntries({
        entries,
        rowHeight: EI_ROW_H.stage[compact ? 'compact' : 'normal'],
        chapterHeight: EI_CHAPTER_H[compact ? 'compact' : 'normal'],
        bodyHeight: EI_BODY_H,
      });
      for (const c of chunks) out.push({ kind, block: { entries: c, compact } });
      continue;
    }
    if (kind === 'member-index') {
      if (memberIndexIsEmpty(vm)) {
        out.push({ kind, block: null });
        continue;
      }
      const entries = buildMemberIndexEntries(vm);
      const compact = countRows(entries) > COMPACT_THRESHOLD;
      const chunks = paginateEiEntries({
        entries,
        rowHeight: EI_ROW_H.member[compact ? 'compact' : 'normal'],
        chapterHeight: EI_CHAPTER_H[compact ? 'compact' : 'normal'],
        bodyHeight: EI_BODY_H,
      });
      for (const c of chunks) out.push({ kind, block: { entries: c, compact } });
      continue;
    }
    if (kind === 'artifact-index') {
      if (artifactIndexIsEmpty(vm)) {
        out.push({ kind, block: null });
        continue;
      }
      const entries = buildArtifactIndexEntries(vm);
      const compact = countRows(entries) > COMPACT_THRESHOLD;
      const chunks = paginateEiEntries({
        entries,
        rowHeight: EI_ROW_H.artifact[compact ? 'compact' : 'normal'],
        chapterHeight: EI_CHAPTER_H[compact ? 'compact' : 'normal'],
        bodyHeight: EI_BODY_H,
      });
      for (const c of chunks) out.push({ kind, block: { entries: c, compact } });
      continue;
    }
    // 其余十一页归 A/D/H（类型上不可达，运行时兜底：不出纸）
  }
  return out;
}

function countRows<T>(entries: readonly EiEntry<T>[]): number {
  return entries.filter((e) => e.kind === 'row').length;
}

/**
 * 页题拆行（2026-10-11 P0-12 向参考稿还原）。
 *
 * 参考稿 E P1 的刊头是**两行巨字**：「阶段」（墨）/「目录」（焦点色），
 * 行节距 106px、每行 cap ≈92px；「目录」是**类型词**，用焦点色落第二行。
 * 三页与通用模块的页题都是「<主题词> + <类型词 2 字>」结构
 * （阶段目录 / 成员执行体目录 / 产出物清单 / 阶段清单…），故按「末二字
 * 单起一行」拆——拆出的两段**顺序拼接仍等于原页题**（textContent 不变，
 * 既有「纸面应含页题『阶段目录』」一类断言继续成立）。
 * 不足 4 字的短题不拆（拆了会得到单字行）。
 */
export function eiTitleLines(cn: string): string[] {
  if (cn.length < 4) return [cn];
  return [cn.slice(0, -2), cn.slice(-2)];
}

/* ------------------------------------------------------------------ 纸面外壳 */

function EiPage({
  page,
  vm,
  logo,
  pageIndex,
  pageTotal,
  pageRef,
}: {
  /** 只接 legacy 页（5 块形态走 `EiBlockPage`）⇒ 类型收窄，'blocks' 不可达 */
  page: Exclude<EiPhysical, { kind: 'blocks' }>;
  vm: PrintViewModel;
  logo: string | null;
  pageIndex: number;
  pageTotal: number;
  pageRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  // 页题：原生逻辑页走 EI_PAGE_TITLES；通用模块走 GENERIC_TITLES（期三）
  const title =
    page.kind === 'generic'
      ? GENERIC_TITLES[page.module]
      : (EI_PAGE_TITLES[page.kind] ?? EI_PAGE_TITLES['stage-index']!);
  const pageAttr = page.kind === 'generic' ? `generic-${page.module}` : page.kind;
  const titleLines = eiTitleLines(title.cn);
  return (
    <div
      ref={pageRef}
      data-print-page={pageAttr}
      data-page-index={pageIndex}
      className="a4-page ei-page"
      style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX }}
    >
      {/* 页头：中英双语刊头 + 项目标识 + 页签；底部章节粗线（E 的分组语言）。
          logo 就住在本页头左上格（2026-10-11 P0-16：内容区那处重复 logo 已删，
          参考稿的内容区没有 logo；产品要求每页仍须有且只有一枚）。
          页题拆两行（P0-12）：行1 墨 / 行2 焦点色，衬线巨字。 */}
      {/* 刊头装置（两行巨题 + SHEET 页签；批 C 把页头抽成共享件 `EiHead`）。
          装置形态不因 5 块改造而变（批 B 裁决第 5 条的一般规则）——只换载荷。 */}
      <EiHead
        vm={vm}
        logo={logo}
        pageIndex={pageIndex}
        pageTotal={pageTotal}
        titleLines={titleLines}
        sheetTag={true}
      />

      {/* 主体：目录条目（分页产物）/ 通用模块（期三）；空逻辑页走明确空态 */}
      <div className="ei-body">
        <LogicalBody page={page} vm={vm} />
      </div>

      {/* 页脚：发丝线 + 署名 + 页码（**无黑栏**——01 §6 明文） */}
      <footer className="ei-foot">
        <span className="ei-foot__brand">ID Plan · 项目排期与交付管理</span>
        <span className="ei-foot__page">
          {title.cn} · 第 {pageIndex + 1} / {pageTotal} 页 · 数据时间 {stampOf(vm.generatedAt)}
        </span>
      </footer>
    </div>
  );
}

/** 通用模块空态（期三：无数据 ⇒ 明确空态，不用示例数据填版，01 §8） */
function GenericModuleEmpty({
  module,
}: {
  module: 'stage-list' | 'task-list' | 'member-roster';
}): JSX.Element {
  if (module === 'task-list') return <EmptyPrintState kind="tasks" />;
  if (module === 'member-roster') return <EmptyPrintState kind="members" />;
  return <EmptyPrintState kind="stages" />;
}

/** 逻辑页主体分发（每页组件独立；联合类型收窄，无 any cast；空态/通用模块同口） */
function LogicalBody({
  page,
  vm,
}: {
  page: Exclude<EiPhysical, { kind: 'blocks' }>;
  vm: PrintViewModel;
}): JSX.Element {
  if (page.kind === 'generic') {
    return page.plan === null ? (
      <GenericModuleEmpty module={page.module} />
    ) : (
      <GenericModuleBody plan={page.plan} chunkIndex={page.chunkIndex} />
    );
  }
  if (page.block === null) return <LogicalEmpty kind={page.kind} />;
  switch (page.kind) {
    case 'stage-index':
      return <StageIndexPage vm={vm} entries={page.block.entries} compact={page.block.compact} />;
    case 'member-index':
      return <MemberIndexPage vm={vm} entries={page.block.entries} compact={page.block.compact} />;
    case 'artifact-index':
      return <ArtifactIndexPage vm={vm} entries={page.block.entries} compact={page.block.compact} />;
  }
}

/** 逻辑页空态（三条标准文案；不用示例数据填版，01 §8） */
function LogicalEmpty({ kind }: { kind: PrintPageKind }): JSX.Element {
  switch (kind) {
    case 'stage-index':
      return <StageIndexEmpty />;
    case 'member-index':
      return <MemberIndexEmpty />;
    case 'artifact-index':
      return <ArtifactIndexEmpty />;
    default:
      return <EmptyPrintState kind="stages" text="该页属于其他版本模板" />;
  }
}

/* ====================================================================================
 * 刊头装置（共享件）+ 5 块形态（2026-10-13 「5 块 × 4 模板」重构 · 批 C）
 * ====================================================================================
 * 依据 `deliverables/gstack/print-5blocks-mapping-2026-10-13.md`：
 *   · §1.3 = E 的 5 块映射（逐格照做）；§0.5 = B4 的 L3「改期记录」；
 *   · §2.6 = 装置 vs 内容（E 的两行巨题 / `SHEET` 页签恒在、不可摘）；
 *   · §3 铁律①= B1 ∪ B3 是同一组字段全集（分界线按各版刊头承载能力走）。
 * ==================================================================================== */

/**
 * 刊头装置（B1 的承载 + 两行巨题 + `SHEET` 页签）。
 *
 * ── 逐字段自查（批 C 移交项：任何条件组合下不许丢字段）──
 *   · 项目名 `ei-head__project` —— 恒渲染（B1 在 E 是 forced、不可取消）；
 *   · 周期 —— 恒渲染，无任何条件分支包裹；
 *   · 打印日期 —— 恒渲染（§1.3 的乙项，本次新增登纸）；
 *   · 委托人 —— **权限语义的「本来就没有」**（VM 层对非 admin 恒 undefined），
 *     admin 且有值时与周期同排出现，不与其他字段互斥；
 *   · 排期基准 / 阶段套餐 —— **归 B3**（同页两处印同一个值是被用户点名过的排版病）。
 * ── `SHEET` 页签（批 C 新增，§1.3 乙项）──
 * 与 B5 的「阶段目录 · 第 n / N 页」**并存**：页签是刊头身份装置（参考稿有），
 * 页码在页脚是页序告知，职责不同（批 C 裁决第 2 条：不清理后者）。
 */
function EiHead({
  vm,
  logo,
  pageIndex,
  pageTotal,
  titleLines,
  sheetTag,
}: {
  vm: PrintViewModel;
  logo: string | null;
  pageIndex: number;
  pageTotal: number;
  titleLines: readonly string[];
  sheetTag: boolean;
}): JSX.Element {
  return (
    <header className="ei-head">
      <div className="ei-head__left">
        <div className="ei-head__logo">
          <PrintLogoMark logo={logo} height={22} />
        </div>
        <div className="ei-head__kicker-row">
          <p className="ei-head__kicker">
            <span className="ei-head__signal" aria-hidden />
            {EI_PAGE_TITLES['stage-index']!.en}
          </p>
          {sheetTag && (
            <span className="ei-head__sheet de-num" data-print-sheet-tag="">
              SHEET {String(pageIndex + 1).padStart(2, '0')} /{' '}
              {String(pageTotal).padStart(2, '0')} · A4
            </span>
          )}
        </div>
        <h1 className="ei-head__title">
          {titleLines.map((line, i) => (
            <span
              key={`${line}-${i}`}
              className="ei-head__title-line"
              data-tone={i === titleLines.length - 1 ? 'accent' : 'ink'}
            >
              {line}
            </span>
          ))}
        </h1>
      </div>
      <div className="ei-head__right">
        <p className="ei-head__project" title={vm.project.name}>
          {vm.project.name}
        </p>
        {/*
         * meta 行拆成**不可断的字段片**（批 C 撞见并修掉的一个「丑」）：
         * 右栏被巨题挤到 160px，整行文本会**在词内断开** —— 实测断成
         * `打印日期 2026-` / `10-09`（浏览器在连字符后就有断点，`keep-all` 也
         * 拦不住 ASCII 里的 `-`）。印在纸上的日期被劈成两半是硬伤，故把三个
         * 字段各包一层 `ei-head__mtok`（`white-space: nowrap`）。
         * ⚠️ **文本逐字不变**：分隔符「 · 」仍留在片内，`textContent` 与原串相等
         * （legacy 原生页的可访问文本因此一字未动）。
         */}
        <p className="ei-head__meta">
          <span className="ei-head__mtok">
            <span className="de-num">
              {vm.project.plannedStartAt} – {vm.project.plannedEndAt}
            </span>
            {' ·'}
          </span>
          {vm.project.clientName ? (
            <span className="ei-head__mtok">{' 委托人 '}{vm.project.clientName}{' ·'}</span>
          ) : null}
          <span className="ei-head__mtok">
            {' 打印日期 '}
            <span className="de-num">{vm.generatedAt.slice(0, 10)}</span>
          </span>
        </p>
      </div>
      <div className="ei-head__rule" aria-hidden />
    </header>
  );
}

/**
 * E 5 块形态的纸面几何常量（px；纪律同 A/D：实测校准、**只许偏大不许偏小**）。
 *
 * ── 实测对照（2026-10-13 批 C · 真 Chromium 794×1123 · 9 阶段首页）──
 *
 *   | 常量            | 取的估值 | 单件实测         | 差    |
 *   |-----------------|---------:|------------------|-------|
 *   | `pageShell`     |      400 | 刊头 330.22 + 页脚 40 + 内距 20 = 390.22 | +9.78 |
 *   | `b2Chrome`      |       44 | caption 14.25 + 标尺 19 | +10.75 |
 *   | `b3`            |       47 | 元信息行 30.5 + 基准行 15.75 = 46.25 | +0.75 |
 *   | `noteH`         |       44 | 口径行 44         |  0    |
 *   | `reschedHead`   |      106 | L3 头 101         | +5    |
 *   | `reschedRow`    |       24 | 每条 24           |  0    |
 *   | B2 行 `EI_SPAN_ROW_H` | 30 | 行实测 30        |  0    |
 *   | B4 行 `EI_ROW_H.stage.normal` | 69 | 巨编号行 69 |  0    |
 *
 * **每一项都 ≥ 实测**（`b3` 取整进位到 47）——估值偏小就会少算页数、实际出纸
 * 溢出，那是「预计 ≠ 实际」里最坏的一种（少报）。整表由
 * `print-a4-visual-e.spec.ts` 的页数表用例逐档核到「预计 = 实际 + 逐页 ≤1123」。
 */
const EI_BLOCK_EST = {
  /** 页壳：刊头 334（与 legacy 同源）+ 页脚 46 + 主体内距 20 */
  pageShell: EI_HEAD_H + EI_FOOT_H + EI_BODY_PADDING,
  /** B2 chrome：caption 行 + 时间标尺（1px + 月份小字） */
  b2Chrome: 44,
  /** B3 簇的**承载区**（元信息行 + 排期基准行）——只首页 */
  b3: 47,
  /**
   * 口径行（`.ei-note`）的高度 —— **每页都占位**（§2.6 原则 1：口径行恒在）。
   * ⚠️ 批 C 探针抓到：第一版把它算进 B3（只首页），于是续页的预算多了 44px
   * ⇒ 16 阶段第 2 页实测溢出 32px。口径行与 B3 是**两件事**：B3 关掉它也在
   * （锚回主体底部），续页它也在。
   */
  noteH: 44,
  /** L3 改期记录固定头 + 每条（与 D 同源） */
  reschedHead: 106,
  reschedRow: 24,
} as const;

const EI_BLOCK_AVAIL = A4_HEIGHT_PX - EI_BLOCK_EST.pageShell;

/** 一页的 5 块装配计划（B2 与 B4 共用 `stages` 切片） */
export interface EiBlockPagePlan {
  first: boolean;
  stages: readonly PrintStageVM[];
  /** 本页是 B4 的最后一页（L3 挂这里；§0.5） */
  last: boolean;
}

/**
 * 5 块形态的物理页装配（**预计页数 = 实际出纸**的唯一出处）。
 *
 * ⚠️ 行成本的对价（批 B 的教训）：**两个块各自在才算自己的行高** —— B2 一行
 * （`EI_SPAN_ROW_H`）与 B4 一行（`EI_ROW_H.stage`，紧凑档更小）**都要付**
 * （两者共用同一切片）；关掉任一块时只收留下那块的成本。
 *
 * ── 实测页数表（2026-10-13 批 C · 真 Chromium 794×1123 · 预计 = 实际逐档核过）──
 * 夹具：`print-a4-visual-e.spec.ts` 的 `buildVm(n)`（含 1 条改期记录 ⇒ L3 上纸）。
 *
 *   | 阶段 n | 无改期记录 | 有改期记录 | 档位      |
 *   |-------:|-----------:|-----------:|-----------|
 *   |   1–5  |          1 |          1 | normal    |
 *   |   6–7  |          1 |          1 | compact   |
 *   |   8     |          1 |          2 | normal    |
 *   |   9–10  |          2 |          2 | normal/紧凑 |
 *   |  12    |          2 |          2 | compact   |
 *   |  16–17 |          2 |          3 | compact   |
 *   |  20    |          3 |          3 | compact   |
 *   |  24    |          3 |          4 | compact   |
 *   |  30    |          4 |          4 | compact   |
 *   |  40    |          5 |          6 | compact   |
 *   |  60    |          7 |          8 | compact   |
 *
 * 两条读表须知：
 *   ① **L3 改期记录会多吃一页**（8 阶段起可见）：它是 B4 的附属件（§0.5），
 *      关掉 B4 时一并消失（§2.6「附属件随主块」）；
 *   ② 只关 B2 / 只关 B4 的页数各有一份独立表（`print-a4-visual-e` 的块独立用例
 *      逐档核过：「关 B2 只跨度目录消失、关 B4 只巨编号目录消失，页数各自联动」）。
 */
/** 某页（首页 / 续页）留给「阶段行」的预算：扣 B3 承载区（仅首页）与**口径行（每页）** */
function eiBlockAvailOf(first: boolean, blocks: SchedulePaperBlocks): number {
  return (
    EI_BLOCK_AVAIL -
    (first ? EI_BLOCK_EST.b3 : 0) -
    EI_BLOCK_EST.noteH -
    (blocks.timeline ? EI_BLOCK_EST.b2Chrome : 0)
  );
}

/** 按给定「清单行高」跑一遍贪心装页（确定性纯函数；两档各跑一次，见 `eiBlockPages`） */
function planEiBlockPages(
  vm: PrintViewModel,
  blocks: SchedulePaperBlocks,
  listRow: number,
): EiBlockPagePlan[] {
  const stages = vm.stages;
  const total = stages.length;
  if (total === 0) return [{ first: true, stages: [], last: true }];

  const resched = blocks.stageTable ? eiRescheduleRows(vm) : [];
  const reschedH =
    resched.length > 0 ? EI_BLOCK_EST.reschedHead + resched.length * EI_BLOCK_EST.reschedRow : 0;

  /**
   * 某页能装几行阶段：**两个块各自在才算自己的行高**（批 B 的教训）——
   * B2 一行（`EI_SPAN_ROW_H`）与 B4 一行（本档的 `listRow`）**都要付**
   * （两者共用同一切片）；关掉任一块时只收留下那块的成本。
   */
  const capOf = (avail: number): number => {
    const perRow = (blocks.timeline ? EI_SPAN_ROW_H : 0) + (blocks.stageTable ? listRow : 0);
    if (perRow <= 0) return 0;
    return Math.max(Math.floor(avail / perRow), 0);
  };

  const pages: EiBlockPagePlan[] = [];
  let cursor = 0;
  let shelled = false;
  let guard = 0;
  while (cursor < total && guard++ < 512) {
    const first = pages.length === 0;
    const avail = eiBlockAvailOf(first, blocks);
    const remaining = total - cursor;
    const cap = capOf(avail);
    const capTail = capOf(avail - reschedH);
    if (cap >= remaining && capTail >= remaining) {
      pages.push({ first, stages: stages.slice(cursor), last: true });
      break;
    }
    const take = Math.max(Math.min(capTail > 0 ? capTail : cap, remaining), 0);
    if (take > 0) {
      pages.push({ first, stages: stages.slice(cursor, cursor + take), last: false });
      cursor += take;
      continue;
    }
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

/**
 * 5 块形态的物理页装配（**预计页数 = 实际出纸**的唯一出处）。
 *
 * ── 档位选择：**紧凑档只在它确实少出纸时才启用**（批 C 探针后的订正）──
 * legacy 页的老纪律是「切档点 = normal 容量」（legacy 容量 9 ⇒ 9 行 normal 与
 * 10 行 compact 都一页，页数曲线单调）。5 块形态里 B2 与 B4 各行都要付，
 * normal 容量掉到 ~5、compact ~8（密 1.6 倍）⇒ **任何固定切档点都会出现
 * 「阶段多了、页数反而少了」的倒挂**（实测：16 阶段 4 页 → 17 阶段 3 页）。
 * 故改成「两档各算一遍页数、取少者」：
 *   · 页数曲线**按构造单调不减**（min 两个非减函数）；
 *   · 参考稿档位（9 阶段）两档页数相同 ⇒ 自动留在 **normal**（44px 巨编号的原味）。
 */
export function eiBlockPages(vm: PrintViewModel, blocks: SchedulePaperBlocks): EiBlockPagePlan[] {
  const normalPlan = planEiBlockPages(vm, blocks, EI_ROW_H.stage.normal);
  const compactPlan = planEiBlockPages(vm, blocks, EI_ROW_H.stage.compact);
  return compactPlan.length < normalPlan.length ? compactPlan : normalPlan;
}

/** 本套模板在本 VM 下是否走紧凑档（渲染侧读它；与 `eiBlockPages` 同一裁决） */
export function eiBlockIsCompact(vm: PrintViewModel, blocks: SchedulePaperBlocks): boolean {
  return (
    planEiBlockPages(vm, blocks, EI_ROW_H.stage.compact).length <
    planEiBlockPages(vm, blocks, EI_ROW_H.stage.normal).length
  );
}

/** 5 块形态的一个物理页（B1 + B2/B3/B4 + B5；装置 `ei-head` / `SHEET` 恒在） */
function EiBlockPage({
  vm,
  blocks,
  show,
  plan,
  gantt,
  logo,
  pageIndex,
  pageTotal,
  pageRef,
}: {
  vm: PrintViewModel;
  blocks: SchedulePaperBlocks;
  show: (id: PrintUnitId) => boolean;
  plan: EiBlockPagePlan;
  gantt: PrintGanttModel;
  logo: string | null;
  pageIndex: number;
  pageTotal: number;
  pageRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  const resched = blocks.stageTable ? eiRescheduleRows(vm) : [];
  const reschedTotal = vm.stageLogs.filter((l) => l.type === 'rescheduled').length;
  const dense = eiBlockIsCompact(vm, blocks);
  const agentOwnerIds = new Set(vm.members.filter((m) => m.actorKind === 'agent').map((m) => m.id));
  return (
    <div
      ref={pageRef}
      data-print-page="blocks"
      data-page-index={pageIndex}
      className="a4-page ei-page"
      style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX }}
    >
      {/* 刊头装置：巨题 = **内容类型词**（阶段 / 目录）——设计侧已撤回「改成项目名」
          的误读（项目名住元信息行小字位，批 C 裁决第 1 条）。 */}
      <EiHead
        vm={vm}
        logo={logo}
        pageIndex={pageIndex}
        pageTotal={pageTotal}
        titleLines={EI_TYPE_TITLE_LINES}
        sheetTag={show('ei-sheet-tag')}
      />

      <div className="ei-body">
        {/* B2 编年跨度目录（与 B4 同一批切片；条 = 日期跨度，非完成度） */}
        {blocks.timeline && plan.stages.length > 0 && (
          <SpanIndex vm={vm} rows={plan.stages} model={gantt} />
        )}

        {/* B4 巨编号目录行（今天 E P1 原样）+ L3 改期记录 */}
        {blocks.stageTable && plan.stages.length > 0 && (
          <div
            className="ei-index"
            data-density={dense ? 'compact' : undefined}
            data-print-block="stageTable"
          >
            {plan.stages.map((s) => (
              <EiStageRow
                key={s.id}
                stage={s}
                agentOwned={s.ownerId !== null && agentOwnerIds.has(s.ownerId)}
              />
            ))}
            {plan.last && resched.length > 0 && <EiReschedule rows={resched} total={reschedTotal} />}
          </div>
        )}
        {blocks.stageTable && vm.stages.length === 0 && plan.stages.length === 0 && (
          <div data-print-block="stageTable">
            <StageIndexEmpty />
          </div>
        )}

        {/* B3 项目信息簇（只首页；§1.3 的「甲 · 归并」——今天散在三处，收成一块）：
            元信息行（可见阶段 / 完成度 / 阶段套餐）+ 排期基准 · 打印时间。
            **口径行恒在**（§2.6 原则 1）：它在下面**每页**都渲染 —— B3 开着时与这两行
            同簇，B3 关掉或续页时就是主体底部那一行（E 今天的位置）。 */}
        {plan.first && blocks.projectInfo && (
          <p className="ei-meta" data-print-block="projectInfo">
            可见阶段 {vm.stages.length} / {vm.project.visibleStageCount} · 完成度{' '}
            {Math.round(vm.project.percent)}%
            {` · 阶段套餐 ${eiPresetText(vm)}（${vm.stages.length} 项）`}
          </p>
        )}
        {plan.first && blocks.projectInfo && (
          <p className="ei-info__line de-num">
            排期基准 {vm.project.scheduleBasisLabel}　·　打印时间 {stampOf(vm.generatedAt)}
          </p>
        )}
        <p className="ei-note">{EI_BLOCK_NOTE}</p>
      </div>

      {/* B5 页脚（甲·原样）：发丝线 + 署名 + 页题 · 第 n / N 页 · 数据时间。
          关 B5 ⇒ **只摘数据时间**（署名与页码永在，原则 1）。 */}
      <footer className="ei-foot">
        <span className="ei-foot__brand">ID Plan · 项目排期与交付管理</span>
        <span className="ei-foot__page">
          阶段目录 · 第 {pageIndex + 1} / {pageTotal} 页
          {blocks.footer ? ` · 数据时间 ${stampOf(vm.generatedAt)}` : ''}
        </span>
      </footer>
    </div>
  );
}

/** 阶段套餐展示串（B3 的元信息行用；与 legacy 页的口径一致） */
function eiPresetText(vm: PrintViewModel): string {
  const key = vm.project.stagePresetKey ?? null;
  return key ? `${key} v${vm.project.stageTemplateVersion ?? 0}` : '—';
}

/** B4 的目录行（**今天 E P1 原样**：巨编号独立列 + 四态 + 日期 + 负责人 + 占比） */
function EiStageRow({ stage, agentOwned }: { stage: PrintStageVM; agentOwned: boolean }): JSX.Element {
  const delayed = stage.status === StageStatus.Delayed;
  return (
    <div
      className="ei-row"
      data-state={stage.status}
      data-agent={agentOwned || undefined}
      data-testid={`ei-stage-row-${stage.orderIndex}`}
    >
      <span className="ei-row__no" data-focus={delayed || agentOwned || undefined}>
        {String(stage.orderIndex).padStart(2, '0')}
      </span>
      <span className="ei-row__name" title={stage.name}>
        {stage.name}
      </span>
      <span className="ei-row__state" data-focus={delayed || undefined}>
        <span className="ei-row__glyph" aria-hidden>
          {STAGE_GLYPH[stage.status]}
        </span>
        {stageStatusLabel(stage.status)}
      </span>
      <span className="ei-row__date">
        {stage.startAt} — {stage.endAt}
      </span>
      <span className="ei-row__owner" data-agent={agentOwned || undefined}>
        {stage.ownerName ?? '—'}
        {agentOwned && <span className="ei-row__agent-tag">执行体</span>}
      </span>
      <span className="ei-row__ratio">{stage.ratioPercent}%</span>
    </div>
  );
}

/** 5 块形态的巨题两行（内容类型词 阶段 / 目录；与 legacy 的页题拆行同构） */
const EI_TYPE_TITLE_LINES: readonly string[] = eiTitleLines(EI_PAGE_TITLES['stage-index']!.cn);
