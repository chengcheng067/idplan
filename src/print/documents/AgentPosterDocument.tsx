/**
 * H 版 · Agent Poster（Agent 执行状态与写回治理公示海报；01 文档 §7 / 02 §6）。
 *
 * ── 为什么独立组件而不是塞进 SchedulePaper ──
 * 01 §1：「不能把四版实现为同一个 DOM 骨架加不同颜色；每版主体布局必须
 * 独立」。H 的纸面是灰白底 + 出血巨字 + 双栏局部中轴的海报语言，与经典
 * 纸面、A 版时刻表、D 版数据网格、E 版目录索引零共享结构。可共享的只有
 * `.a4-page` 纸面类与打印分页规则。
 *
 * ── 视觉契约（01 §7 / 02 §6 token）──
 *   纸面 #F5F5F5 灰白底（--ap-paper 固定，不开槽位——纸面性格是模板身份）
 *   主文字 #0A0A0A 近黑（= --tpl-ink 槽位；系统推进 / 当前主状态）
 *   状态色 #E8590C 橙（= --tpl-accent 槽位；等待人工介入 / 治理焦点）
 *   分隔线 #BFBFBF（= --tpl-line 槽位）
 *   出血巨字、大字号状态分组、双栏 + 局部中轴（轴 = 双栏容器的 ::before，
 *   禁绝对定位贯穿整页——02 §6）；三页均无底部黑栏（留白与巨字收口）。
 *
 * ── 口径纪律（治理公示稿，出错是对外事故）──
 *   · ExecutionStatus 10 态按四组流程组织、running 为主焦点（P2）；
 *   · confidence **仅展示**且旁标「仅供参考」，不做任何阈值判定；
 *   · 写回白名单**仅四项**（WRITEBACK_WRITABLE_FIELDS 唯一出处）+「其余字段只读」；
 *   · WritebackProposalStatus 5 态 + 人工门控流程（P3）。
 *
 * ── 空态（02 §8：无 Agent 数据 ⇒ 整版只读空态）──
 * executions 与 proposals 皆空时，三页纸面照常出（页头页脚齐全），主体
 * 一律 EmptyPrintState——**不许用模拟记录填版**。非 Agent 项目打出来的
 * 是一份诚实的「本项目暂无 Agent 执行数据」。
 *
 * ── 配色槽位 ──
 * 三枚经 `.print-root` 的 inline CSS 变量挂载（--tpl-accent / --tpl-ink /
 * --tpl-line），inline style 经 print-frame 的 cloneNode(true) 原样进
 * iframe 打印面，无损（与 A/D/E 同一机制，print-palette.ts 文件头）。
 */

import type { CSSProperties, Ref } from 'react';

import { A4_WIDTH_PX, A4_HEIGHT_PX } from '../../lib/schedule-print';
import { printTemplateClass } from '../../components/print/print-skins';

import type { PrintPageKind, PrintViewModel } from '../model/print-view-model';
import type { PrintPalette } from '../model/print-palette';
import { EmptyPrintState } from '../parts/EmptyPrintState';
import { PrintLogoMark } from '../parts/PrintLogoMark';
import { AgentDeclarationPage } from '../pages/agent-poster/AgentDeclarationPage';
import { ExecutionStatusPage } from '../pages/agent-poster/ExecutionStatusPage';
import { WritebackProposalPage } from '../pages/agent-poster/WritebackProposalPage';
import { stampOf } from '../pages/agent-poster/shared';
// H 版样式（Vite 随组件 chunk 进包；全部规则带 .print-root.print-template-* 前缀）
import '../styles/agent-poster.css';

/** H 版三页（02 §6 组件映射；顺序即纸面顺序） */
export const AGENT_POSTER_PAGES: readonly PrintPageKind[] = [
  'agent-declaration',
  'execution-status',
  'writeback-proposals',
];

/** 页题（完整单行中文标题 + 英文栏 kicker） */
const AP_PAGE_TITLES: Record<PrintPageKind, { cn: string; en: string }> = {
  'agent-declaration': { cn: 'Agent 执行宣告', en: 'AGENT DECLARATION' },
  'execution-status': { cn: '执行状态全览', en: 'EXECUTION STATUS' },
  'writeback-proposals': { cn: '写回提案公示', en: 'WRITEBACK PROPOSALS' },
  // 其余十一页归 A/D/E；H 版只实现自己三页（类型上不可达，运行时兜底）
  'stage-overview': { cn: '阶段总览', en: 'STAGE OVERVIEW' },
  'task-register': { cn: '任务读号表', en: 'TASK REGISTER' },
  'delay-ledger': { cn: '延期记录表', en: 'DELAY LEDGER' },
  'member-roster': { cn: '成员责任表', en: 'MEMBER ROSTER' },
  'progress-matrix': { cn: '阶段进度矩阵', en: 'PROGRESS MATRIX' },
  'dependency-network': { cn: '任务依赖网络', en: 'DEPENDENCY NETWORK' },
  'workload-composition': { cn: '阶段工作量构成', en: 'WORKLOAD COMPOSITION' },
  'milestone-acceptance': { cn: '里程碑与验收', en: 'MILESTONE & ACCEPTANCE' },
  'stage-index': { cn: '阶段目录', en: 'STAGE INDEX' },
  'member-index': { cn: '成员执行体目录', en: 'MEMBER INDEX' },
  'artifact-index': { cn: '产出物清单', en: 'ARTIFACT INDEX' },
};

export interface AgentPosterDocumentProps {
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

export function AgentPosterDocument({
  vm,
  pages,
  palette,
  logo = null,
  pageRef,
}: AgentPosterDocumentProps): JSX.Element {
  const enabled = (pages ?? AGENT_POSTER_PAGES).filter((p) => AGENT_POSTER_PAGES.includes(p));
  // 整版空态判定：执行与提案皆空（非 Agent 项目 / 无 Agent 数据）
  const hasAgentData = vm.executions.length > 0 || vm.proposals.length > 0;
  const total = enabled.length;

  return (
    <div
      className={`print-root mx-auto w-fit ${printTemplateClass('agent-poster')}`}
      style={
        {
          '--tpl-accent': palette.accent,
          '--tpl-ink': palette.ink,
          '--tpl-line': palette.line,
        } as CSSProperties
      }
    >
      {enabled.map((kind, idx) => (
        <ApPage
          key={kind}
          kind={kind}
          vm={vm}
          hasAgentData={hasAgentData}
          logo={logo}
          pageIndex={idx}
          pageTotal={total}
          pageRef={pageRef?.(idx)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 纸面外壳 */

function ApPage({
  kind,
  vm,
  hasAgentData,
  logo,
  pageIndex,
  pageTotal,
  pageRef,
}: {
  kind: PrintPageKind;
  vm: PrintViewModel;
  hasAgentData: boolean;
  logo: string | null;
  pageIndex: number;
  pageTotal: number;
  pageRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  const title = AP_PAGE_TITLES[kind] ?? AP_PAGE_TITLES['agent-declaration']!;
  // P1 的 logo 在巨字下方左侧（页内自绘，≤24px）；P2/P3 走页级 logo 行
  // （左上角发丝线下方，≤22px）。空态下 P1 也走页级行——整版空态时每页
  // 都要有标识，不留空。
  const pageLevelLogo = kind !== 'agent-declaration' || !hasAgentData;

  return (
    <div
      ref={pageRef}
      data-print-page={kind}
      data-page-index={pageIndex}
      className="a4-page ap-page"
      style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX }}
    >
      {/* 页头：英文栏 kicker + 中文页题；右侧项目标识；底部发丝线 */}
      <header className="ap-head">
        <div className="ap-head__left">
          <p className="ap-head__kicker">
            <span className="ap-head__signal" aria-hidden />
            {title.en}
          </p>
          <h1 className="ap-head__title">{title.cn}</h1>
        </div>
        <div className="ap-head__right">
          <p className="ap-head__project" title={vm.project.name}>
            {vm.project.name}
          </p>
          <p className="ap-head__meta">
            {vm.project.scheduleBasisLabel} · {vm.project.plannedStartAt} – {vm.project.plannedEndAt}
          </p>
        </div>
        <div className="ap-head__rule" aria-hidden />
      </header>

      {/* logo 行：P2/P3（及空态 P1）左上角、发丝线下方（≤22px） */}
      {pageLevelLogo && (
        <div className="ap-logo-row">
          <PrintLogoMark logo={logo} height={22} />
        </div>
      )}

      {/* 主体 */}
      <div className="ap-body">
        {!hasAgentData ? (
          /* 整版只读空态：不用模拟记录填版（02 §8） */
          <EmptyPrintState kind="agent" />
        ) : (
          <ApBody kind={kind} vm={vm} logo={logo} />
        )}
      </div>

      {/* 页脚：发丝线 + 署名 + 页码（**无黑栏**——01 §7 明文，纸面留白收口） */}
      <footer className="ap-foot">
        <span className="ap-foot__brand">ID Plan · 项目排期与交付管理</span>
        <span className="ap-foot__page">
          {title.cn} · 第 {pageIndex + 1} / {pageTotal} 页 · 数据时间 {stampOf(vm.generatedAt)}
        </span>
      </footer>
    </div>
  );
}

/** 页主体分发（三页组件独立；类型上不可达的 kind 兜底空态） */
function ApBody({
  kind,
  vm,
  logo,
}: {
  kind: PrintPageKind;
  vm: PrintViewModel;
  logo: string | null;
}): JSX.Element {
  switch (kind) {
    case 'agent-declaration':
      return <AgentDeclarationPage vm={vm} logo={logo} />;
    case 'execution-status':
      return <ExecutionStatusPage vm={vm} />;
    case 'writeback-proposals':
      return <WritebackProposalPage vm={vm} />;
    default:
      return <EmptyPrintState kind="agent" text="该页属于其他版本模板" />;
  }
}
