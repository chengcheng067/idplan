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
import { enabledSheetsOf, printTemplateClass } from '../../components/print/print-skins';
import type { PrintSheet } from '../../components/print/print-skins';

import type { PrintPageKind, PrintViewModel } from '../model/print-view-model';
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
// D 版样式（Vite 随组件 chunk 进包；全部规则带 .print-root.print-template-* 前缀）
import '../styles/data-editorial.css';
import { ProgressMatrixPage } from '../pages/data-editorial/ProgressMatrixPage';
import { DependencyNetworkPage } from '../pages/data-editorial/DependencyNetworkPage';
import { WorkloadCompositionPage } from '../pages/data-editorial/WorkloadCompositionPage';
import { MilestoneAcceptancePage } from '../pages/data-editorial/MilestoneAcceptancePage';
import { planMatrixPages, type MatrixPlan } from '../pages/data-editorial/shared';
import { stampOf } from '../pages/data-editorial/shared';

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
  'agent-declaration': { cn: 'Agent 执行宣告', en: 'AGENT DECLARATION' },
  'execution-status': { cn: '执行状态全览', en: 'EXECUTION STATUS' },
  'writeback-proposals': { cn: '写回提案公示', en: 'WRITEBACK PROPOSALS' },
};

export interface DataEditorialDocumentProps {
  vm: PrintViewModel;
  /**
   * 纸面页（期三：原生页 kind + 通用模块 id；缺省 = 默认原生模块）。
   * D 的 M1/M2/M4 无原生页 ⇒ 走通用渲染（该外表基础排版承接）。
   */
  sheets?: readonly PrintSheet[];
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
  palette,
  logo = null,
  pageRef,
}: DataEditorialDocumentProps): JSX.Element {
  const physical = dataEditorialPhysical(vm, sheets ?? enabledSheetsOf('data-editorial', undefined));
  const total = physical.length;

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
      {physical.map((p, idx) => (
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
      {/* 页头：英文栏 kicker + 完整单行中文标题；右侧项目标识与周期 */}
      <header className="de-head">
        <div className="de-head__left">
          {/* logo：每页头部左上格（≤28px；D 的 radius=0 身份 ⇒ 不加圆角不加底）。
              未上传 = 「ID Plan」文字标 */}
          <div className="de-head__logo">
            <PrintLogoMark logo={logo} height={28} />
          </div>
          <p className="de-head__kicker">
            <span className="de-head__signal" aria-hidden />
            {title.en}
          </p>
          {/* 完整单行中文标题（Noto Sans SC Black；不拆字体拼接） */}
          <h1 className="de-head__title">{title.cn}</h1>
        </div>
        <div className="de-head__right">
          {/* 项目名最多两行，超出截断；完整文本经 title 可访问（02 §8） */}
          <p className="de-head__project" title={vm.project.name}>
            {vm.project.name}
          </p>
          <p className="de-head__meta de-num">
            {vm.project.scheduleBasisLabel} · {vm.project.plannedStartAt} – {vm.project.plannedEndAt}
            {vm.project.clientName ? ` · 委托人 ${vm.project.clientName}` : ''}
          </p>
        </div>
        {/* 3px 近黑硬边全出血分隔线（D 的编辑网格身份） */}
        <div className="de-head__rule" aria-hidden />
      </header>

      <div className="de-body">
        <DePageBody page={page} vm={vm} />
      </div>

      {/* 页脚：发丝线 + 署名 + 页码/数据时间（每页可独立解释，01 §2） */}
      <footer className="de-foot">
        <span className="de-foot__brand">ID Plan · 项目排期与交付管理</span>
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
