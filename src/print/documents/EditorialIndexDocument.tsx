/**
 * E 版 · Editorial Index（目录索引；01 文档 §6 / 02 文档 §6）。
 *
 * ── 为什么独立组件而不是塞进 SchedulePaper ──
 * 01 §1：「不能把四版实现为同一个 DOM 骨架加不同颜色；每版主体布局必须
 * 独立」。E 的纸面是暖浅纸面 + 巨编号目录 + 发丝线/粗章节线分组，与经典
 * 纸面（白底甘特 + 清单表）、A 版（交通黄时刻表）、D 版（白底数据网格）
 * 零共享结构。可共享的只有 `.a4-page` 纸面类与打印分页规则。
 *
 * ── 视觉契约（01 §6 / 02 §6 token）──
 *   纸面 #FAF7F2（--ei-paper 固定，不开槽位——纸面性格是模板身份）
 *   主文字 #141414（= --tpl-ink 槽位）；朱红 #C8102E（= --tpl-accent 槽位）
 *   发丝线 #CFC8BC（= --tpl-line 槽位）；粗章节线 2px 近黑
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
import { printTemplateClass } from '../../components/print/print-skins';

import type { PrintMemberVM, PrintPageKind, PrintStageVM, PrintViewModel } from '../model/print-view-model';
import type { PrintPalette } from '../model/print-palette';
import { EmptyPrintState } from '../parts/EmptyPrintState';
import { PrintLogoMark } from '../parts/PrintLogoMark';
import { paginateEiEntries, stampOf, type EiEntry } from '../pages/editorial-index/shared';
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
  'agent-declaration': { cn: 'Agent 执行宣告', en: 'AGENT DECLARATION' },
  'execution-status': { cn: '执行状态全览', en: 'EXECUTION STATUS' },
  'writeback-proposals': { cn: '写回提案公示', en: 'WRITEBACK PROPOSALS' },
};

/* ------------------------------------------------------------------ 分页几何 */

/**
 * 物理纸面的固定框架高度（px；与 editorial-index.css 的页头/logo 行/页脚
 * 实测值对齐——分页估高偏大会早分页、偏小会溢出，两边必须同源）。
 * 各项取「实测值 + 余量」：估高只允许偏保守（大），不允许小于实测。
 */
const EI_HEAD_H = 112; // 实测 ≈95（刊头两行 + 发丝线）
const EI_LOGO_ROW_H = 34; // 实测 34（10 上距 + 24 内容）
const EI_FOOT_H = 46; // 实测 41（40 高 + 1 发丝线）
const EI_BODY_PADDING = 20; // 主体上下内距 12 + 8
const EI_NOTE_H = 46; // 口径注（10 上距 + 两行 16.5 + 1 线，取整）
/** 每物理页主体可用高度（纸面 1123 − 页头 − logo 行 − 页脚 − 主体内距 − 口径注） */
const EI_BODY_H =
  A4_HEIGHT_PX - EI_HEAD_H - EI_LOGO_ROW_H - EI_FOOT_H - EI_BODY_PADDING - EI_NOTE_H;

/**
 * 目录行估高（normal / compact 两档）。
 * normal 实测 37px（padding 6/6 + 巨编号 24px line-height:1 + 1px 发丝线，
 * 2026-10-09 密度修订后真 Chromium 量）；取 40 偏保守（大）= 早分页白留一截，
 * 不允许小于实测（小 = 溢出）。compact 实测 ≈30，取 31。
 */
const EI_ROW_H = {
  stage: { normal: 40, compact: 31 },
  member: { normal: 40, compact: 31 },
  artifact: { normal: 40, compact: 31 },
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
  /** 启用的页（缺省 = 三页全选；选择器勾选即时重渲染） */
  pages?: readonly PrintPageKind[];
  /** 有效配色（自定义或设计师基线；三枚 hex） */
  palette: PrintPalette;
  /** 全局打印 logo（base64 dataURL；null = 未上传，显示「ID Plan」文字标） */
  logo?: string | null;
  /** 导出 PNG 的页面元素收集（ref callback 数组，宿主持有） */
  pageRef?: (idx: number) => Ref<HTMLDivElement>;
}

export function EditorialIndexDocument({
  vm,
  pages,
  palette,
  logo = null,
  pageRef,
}: EditorialIndexDocumentProps): JSX.Element {
  const enabled = (pages ?? EDITORIAL_INDEX_PAGES).filter((p) => EDITORIAL_INDEX_PAGES.includes(p));
  const physical = buildPhysicalPages(enabled, vm);
  const total = physical.length;

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
      {physical.map((p, idx) => (
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
    </div>
  );
}

/* ------------------------------------------------------------------ 物理页装配 */

/** 一个物理纸面的内容（kind + 条目块；null = 空态纸面） */
type EiPhysical =
  | { kind: 'stage-index'; block: { entries: readonly EiEntry<PrintStageVM>[]; compact: boolean } | null }
  | { kind: 'member-index'; block: { entries: readonly EiEntry<PrintMemberVM & { seq: number }>[]; compact: boolean } | null }
  | { kind: 'artifact-index'; block: { entries: readonly EiEntry<EiArtifactRow>[]; compact: boolean } | null };

/** 逻辑页 → 物理页组（条目构造 + 分页；空逻辑页 = 一张空态纸） */
function buildPhysicalPages(enabled: readonly PrintPageKind[], vm: PrintViewModel): EiPhysical[] {
  const out: EiPhysical[] = [];

  for (const kind of enabled) {
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

/* ------------------------------------------------------------------ 纸面外壳 */

function EiPage({
  page,
  vm,
  logo,
  pageIndex,
  pageTotal,
  pageRef,
}: {
  page: EiPhysical;
  vm: PrintViewModel;
  logo: string | null;
  pageIndex: number;
  pageTotal: number;
  pageRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  const kind = page.kind;
  const title = EI_PAGE_TITLES[kind] ?? EI_PAGE_TITLES['stage-index']!;
  return (
    <div
      ref={pageRef}
      data-print-page={kind}
      data-page-index={pageIndex}
      className="a4-page ei-page"
      style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX }}
    >
      {/* 页头：中英双语刊头 + 项目标识；底部发丝线（E 的分组语言） */}
      <header className="ei-head">
        <div className="ei-head__left">
          <p className="ei-head__kicker">
            <span className="ei-head__signal" aria-hidden />
            {title.en}
          </p>
          <h1 className="ei-head__title">{title.cn}</h1>
        </div>
        <div className="ei-head__right">
          {/* 项目名最多两行，超出截断；完整文本经 title 可访问（02 §8） */}
          <p className="ei-head__project" title={vm.project.name}>
            {vm.project.name}
          </p>
          <p className="ei-head__meta">
            {vm.project.scheduleBasisLabel} · {vm.project.plannedStartAt} – {vm.project.plannedEndAt}
            {vm.project.clientName ? ` · 委托人 ${vm.project.clientName}` : ''}
          </p>
        </div>
        <div className="ei-head__rule" aria-hidden />
      </header>

      {/* logo 行：每页左上角、发丝线下方（≤22px；未上传 = 「ID Plan」文字标） */}
      <div className="ei-logo-row">
        <PrintLogoMark logo={logo} height={22} />
      </div>

      {/* 主体：目录条目（分页产物）；空逻辑页走明确空态 */}
      <div className="ei-body">{page.block === null ? <LogicalEmpty kind={kind} /> : <LogicalBody page={page} vm={vm} />}</div>

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

/** 逻辑页主体分发（每页组件独立；联合类型收窄，无 any  cast） */
function LogicalBody({ page, vm }: { page: EiPhysical; vm: PrintViewModel }): JSX.Element {
  switch (page.kind) {
    case 'stage-index':
      return (
        <StageIndexPage
          vm={vm}
          entries={page.block!.entries}
          compact={page.block!.compact}
        />
      );
    case 'member-index':
      return (
        <MemberIndexPage
          vm={vm}
          entries={page.block!.entries}
          compact={page.block!.compact}
        />
      );
    case 'artifact-index':
      return <ArtifactIndexPage vm={vm} entries={page.block!.entries} compact={page.block!.compact} />;
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
