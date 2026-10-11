/**
 * H 版 · Agent Poster（Agent 执行状态与写回治理公示海报；01 文档 §7 / 02 §6）。
 *
 * ── 为什么独立组件而不是塞进 SchedulePaper ──
 * 01 §1：「不能把四版实现为同一个 DOM 骨架加不同颜色；每版主体布局必须
 * 独立」。H 的纸面是暖灰米底 + 出血巨字 + 双栏局部中轴的海报语言，与经典
 * 纸面、A 版时刻表、D 版数据网格、E 版目录索引零共享结构。可共享的只有
 * `.a4-page` 纸面类与打印分页规则。
 *
 * ── 视觉契约（规格 §1.1 A 组 / P0-17 改值）──
 *   纸面 #DEDDD4 暖灰米（--ap-paper 固定，不开槽位——纸面性格是模板身份）
 *       参考稿实测纸底（79% 面积）。A1：纸色是模板身份 ⇒ **取值必须精确，
 *       不许取近似灰**，旧值 #F5F5F5（中性灰）是错的。纸底**只住在 CSS**，
 *       不经 inline 变量（故它不经 palette 覆盖）。
 *   主文字 #0A0A0A 近黑（= --tpl-ink 槽位）；A3 判定「近似（可接受）」，本批不动。
 *   状态色 #E2522B 橙红（= --tpl-accent 槽位；需要人动作 = 延期 / 未开始 / 等人介入）
 *       A2 参考稿实测焦点色（8.6% 面积）。⚠️ **accent 的渲染真值源在 palette**：
 *       本组件把 palette.accent 以 inline 变量挂到 .print-root（下一段），
 *       inline 优先级高于 agent-poster.css 里的基线默认 ⇒ 改 accent 必须
 *       CSS + print-palette.ts（AGENT_POSTER_PALETTE.baseline / signal-orange
 *       预设）**两处同改**，否则纸面仍渲染旧色（P0-17 点名的三处同步）。
 *   分隔线 #BFBFBF（= --tpl-line 槽位）—— A4：**值不动、分工收紧**，只作
 *       块下 1px 发丝；分组线（3px）必须走 --tpl-ink 或 --tpl-accent。
 *   出血巨字、大字号状态分组、双栏 + 局部中轴（轴 = 双栏容器的 ::before，
 *   禁绝对定位贯穿整页——02 §6）；三页均无底部黑栏（留白与巨字收口）。
 *
 * ── 页级出血巨字（规格 §1.1 B1/B3 + P0-18；§1.4 载荷拍板）──
 * 两块巨字都是**页级装置**（绝对定位在 .a4-page 上，越出内容框与纸缘）：
 *   · 页顶 = 用户自定义**品牌词**（settings KV `print.brandWord`，缺省 `PLAN`）。
 *     载荷与状态解绑（规格 §1.4）——原 `statusToGiantWord` 不再上纸面；
 *     状态表达归页内焦点行与双栏栏头（后者属人类化批）。
 *   · 页底 = 固定品牌装置 `IDPLAN`，三页同构，**不随自定义变**（规则 5）。
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
import { enabledSheetsOf, printTemplateClass } from '../../components/print/print-templates';
import type { PrintSheet } from '../../components/print/print-templates';

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
import { AgentDeclarationPage } from '../pages/agent-poster/AgentDeclarationPage';
import { ExecutionStatusPage } from '../pages/agent-poster/ExecutionStatusPage';
import { WritebackProposalPage } from '../pages/agent-poster/WritebackProposalPage';
import { giantTier, stampOf } from '../pages/agent-poster/shared';
import { DEFAULT_PRINT_BRAND_WORD, normalizeBrandWord } from '../adapters/use-print-brand-word';
// H 版样式（Vite 随组件 chunk 进包；全部规则带 .print-root.print-template-* 前缀）
import '../styles/agent-poster.css';

/** 页底品牌装置词：固定 `IDPLAN`，不随自定义品牌词变（规格 §1.4 规则 5） */
export const AP_FOOTWORD_TEXT = 'IDPLAN';

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
  /**
   * 纸面页（期三：原生页 kind + 通用模块 id；缺省 = 默认原生模块）。
   * H 的 M1/M2/M4 无原生页 ⇒ 走通用渲染（去专属化：H 不再是 Agent 专属外表）。
   */
  sheets?: readonly PrintSheet[];
  /** 有效配色（自定义或设计师基线；三枚 hex） */
  palette: PrintPalette;
  /** 全局打印 logo（base64 dataURL；null = 未上传，显示「ID Plan」文字标） */
  logo?: string | null;
  /**
   * 页顶出血巨字的载荷 = 用户自定义品牌词（settings KV `print.brandWord`）。
   * 缺省 / 空值 ⇒ `PLAN`（规格 §1.4 规则 1-2）。页底 `IDPLAN` 不受其影响。
   */
  brandWord?: string | null;
  /** 导出 PNG 的页面元素收集（ref callback 数组，宿主持有） */
  pageRef?: (idx: number) => Ref<HTMLDivElement>;
}

/* ------------------------------------------------------------------ 物理页装配 */

/** H 版一个物理纸面（原生页 or 通用模块的一个 chunk；plan=null = 空态纸） */
export type ApPhysical =
  | { type: 'native'; kind: PrintPageKind }
  | {
      type: 'generic';
      module: 'stage-list' | 'task-list' | 'member-roster';
      plan: GenericPlan | null;
      chunkIndex: number;
      chunkTotal: number;
    };

/** sheets ⇒ H 版物理页序列（原生 1:1；通用模块经 planGenericModule 分页） */
export function agentPosterPhysical(vm: PrintViewModel, sheets: readonly PrintSheet[]): ApPhysical[] {
  const out: ApPhysical[] = [];
  for (const sheet of sheets) {
    if (sheet.type === 'native') {
      if (!AGENT_POSTER_PAGES.includes(sheet.page)) continue;
      out.push({ type: 'native', kind: sheet.page });
      continue;
    }
    if (!isGenericRenderable(sheet.module)) continue;
    const plan = planGenericModule(sheet.module, vm, 'agent-poster');
    const total = plan === null ? 1 : plan.chunks.length;
    for (let i = 0; i < total; i++) {
      out.push({ type: 'generic', module: sheet.module, plan, chunkIndex: i, chunkTotal: total });
    }
  }
  return out;
}

export function AgentPosterDocument({
  vm,
  sheets,
  palette,
  logo = null,
  brandWord = null,
  pageRef,
}: AgentPosterDocumentProps): JSX.Element {
  const physical = agentPosterPhysical(vm, sheets ?? enabledSheetsOf('agent-poster', undefined));
  // 整版空态判定：执行与提案皆空（非 Agent 项目 / 无 Agent 数据）——只作用于原生页
  const hasAgentData = vm.executions.length > 0 || vm.proposals.length > 0;
  const total = physical.length;
  // 页顶巨字载荷：同一真值源做归一（去空白 + ≤12 字符截断），空值回落缺省词。
  // 截断在**渲染口**再做一遍，保证「传进来的超长词也不会撑破纸面」——
  // 单次归一，逐页复用。
  const topWord = normalizeBrandWord(brandWord ?? '') || DEFAULT_PRINT_BRAND_WORD;

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
      {physical.map((p, idx) => (
        <ApPage
          key={p.type === 'native' ? p.kind : `generic-${p.module}-${p.chunkIndex}`}
          page={p}
          vm={vm}
          hasAgentData={hasAgentData}
          logo={logo}
          brandWord={topWord}
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
  page,
  vm,
  hasAgentData,
  logo,
  brandWord,
  pageIndex,
  pageTotal,
  pageRef,
}: {
  page: ApPhysical;
  vm: PrintViewModel;
  hasAgentData: boolean;
  logo: string | null;
  brandWord: string;
  pageIndex: number;
  pageTotal: number;
  pageRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  // 页题：原生页走 AP_PAGE_TITLES；通用模块走 GENERIC_TITLES（期三）
  const title =
    page.type === 'native'
      ? (AP_PAGE_TITLES[page.kind] ?? AP_PAGE_TITLES['agent-declaration']!)
      : GENERIC_TITLES[page.module];
  const pageAttr = page.type === 'native' ? page.kind : `generic-${page.module}`;
  // P1 的 logo 在巨字下方左侧（页内自绘，≤24px）；P2/P3 与通用页走页级 logo 行
  // （左上角发丝线下方，≤22px）。空态下 P1 也走页级行——整版空态时每页
  // 都要有标识，不留空。
  const pageLevelLogo = page.type === 'generic' || page.kind !== 'agent-declaration' || !hasAgentData;
  // 页顶出血巨字只在 P1（页锚点装置的原址，规格 §1.1 B1）；空态整版只读，
  // 不出巨字（与「空态不用模拟记录填版」同一口径）。页底巨字是纸级品牌装置，
  // 三页同构、空态照出。
  const showTopWord =
    page.type === 'native' && page.kind === 'agent-declaration' && hasAgentData;

  return (
    <div
      ref={pageRef}
      data-print-page={pageAttr}
      data-page-index={pageIndex}
      className="a4-page ap-page"
      style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX }}
    >
      {/* 页顶出血巨字：品牌词（默认 PLAN），从纸面 x=0 起、行盒越出纸顶被裁 */}
      {showTopWord && (
        <div className="ap-giant" data-tier={giantTier(brandWord)} aria-hidden>
          <span className="ap-giant__word">{brandWord}</span>
        </div>
      )}

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

      {/* logo 行：P2/P3（及空态 P1、通用页）左上角、发丝线下方（≤22px） */}
      {pageLevelLogo && (
        <div className="ap-logo-row">
          <PrintLogoMark logo={logo} height={22} />
        </div>
      )}

      {/* 主体：原生页（无 Agent 数据走整版只读空态）/ 通用模块（期三） */}
      <div className="ap-body">
        {page.type === 'generic' ? (
          page.plan === null ? (
            <GenericPosterEmpty module={page.module} />
          ) : (
            <GenericModuleBody plan={page.plan} chunkIndex={page.chunkIndex} />
          )
        ) : !hasAgentData ? (
          /* 整版只读空态：不用模拟记录填版（02 §8） */
          <EmptyPrintState kind="agent" />
        ) : (
          <ApBody kind={page.kind} vm={vm} logo={logo} />
        )}
      </div>

      {/* 页脚：发丝线 + 署名 + 页码（**无黑栏**——01 §7 明文，纸面留白收口） */}
      <footer className="ap-foot">
        <span className="ap-foot__brand">ID Plan · 项目排期与交付管理</span>
        <span className="ap-foot__page">
          {title.cn} · 第 {pageIndex + 1} / {pageTotal} 页 · 数据时间 {stampOf(vm.generatedAt)}
        </span>
      </footer>

      {/* 页底出血巨字：品牌装置 IDPLAN（固定词，不随自定义品牌词变；三页同构） */}
      <div className="ap-footword" aria-hidden>
        <span className="ap-footword__word">{AP_FOOTWORD_TEXT}</span>
      </div>
    </div>
  );
}

/** 通用模块空态（期三：无数据 ⇒ 明确空态，不用示例数据填版，01 §8） */
function GenericPosterEmpty({
  module,
}: {
  module: 'stage-list' | 'task-list' | 'member-roster';
}): JSX.Element {
  if (module === 'task-list') return <EmptyPrintState kind="tasks" />;
  if (module === 'member-roster') return <EmptyPrintState kind="members" />;
  return <EmptyPrintState kind="stages" />;
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
