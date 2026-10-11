/**
 * H 版 · Agent Poster（人类化后：**阶段 / 任务 / 成员海报**）。
 *
 * ── 这一个外表是什么（规格 §1.0 拍板 + §3.2 选项 A）──
 * 「海报式跳读」外表：出血巨字 / 双栏 + 局部中轴 / 大字号分组栏头 / 实底错落
 * 状态标签块 / 居中标 / 通栏橙线 / mono 平铺口径行 / 图例 / 两行脚注。
 * 人类化 = **版式语法一个构件都不删，只把载荷从 Agent 治理公示换成人类项目
 * 内容**；三页消费**同一个 `PrintViewModel`**（与 A/D/E 同一份项目数据）。
 *
 * ── 为什么独立组件而不是塞进 SchedulePaper ──
 * 01 §1：「不能把四版实现为同一个 DOM 骨架加不同颜色；每版主体布局必须
 * 独立」。H 纸面与经典纸面、A 版时刻表、D 版数据网格、E 版目录索引零共享
 * 结构；可共享的只有 `.a4-page` 纸面类与打印分页规则。
 *
 * ── 视觉契约（§1.1 A 组 / P0-17 改值）──
 *   纸面 #DEDDD4 暖灰米（--ap-paper 固定，**只住在 CSS**、不经 inline 变量
 *       ⇒ 不受 palette 覆盖；纸面性格是模板身份）
 *   主文字 #0A0A0A 近黑（= --tpl-ink 槽位）；A3 判定「近似（可接受）」，本批不动。
 *   焦点色 #E2522B 橙红（= --tpl-accent 槽位；**需要人动作**）
 *       ⚠️ **accent 的渲染真值源在 palette**：本组件把 palette.accent 以 inline
 *       变量挂到 .print-root，inline 优先级高于 CSS 里的基线默认 ⇒ 改 accent
 *       必须 CSS + print-palette.ts（AGENT_POSTER_PALETTE.baseline / 预设）
 *       **两处同改**，否则纸面仍渲染旧色。
 *       ⚠️ **闸门登记（2026-10-11 P1-3 复核后只剩一条）**：H 基线在新纸底上
 *       accent **2.812**（<3）跌破——规格 P0-17 裁决为**已登记的有意偏离**（闸门管
 *       用户自定义配色，不管设计师基线），故 `checkPrintPalette('agent-poster',
 *       baseline).ok === false` 是故意的，**别当 bug 修**；line 已在 P1-3 归队
 *       （参考稿实测 `#91918A`，2.3258 过闸，不再是例外）；四个**预设**全部过闸。
 *   分隔线 #91918A（= --tpl-line 槽位；参考稿实测值）—— 只作 **1px 分隔**：
 *       块底行间分隔（每栏各一条）与内容框全宽线（页眉下 / 脚注上）；
 *       分组线（3px）走 --tpl-ink / --tpl-accent，不许中灰承担分组职责。
 *
 * ── 页级出血巨字（§1.1 B1/B3 + P0-18；§1.4 载荷拍板）──
 * 两块巨字都是**页级装置**（绝对定位在 .a4-page 上，越出内容框与纸缘）：
 *   · 页顶 = 用户自定义**品牌词**（settings KV `print.brandWord`，缺省 `PLAN`）。
 *     载荷与状态解绑（§1.4）——参考稿那颗 `AGENT` 是「主题词位」不是状态位；
 *     状态表达归**双栏栏头**与块内实底标签（§1.4 表格末行）。
 *   · 页底 = 固定品牌装置 `IDPLAN`，三页同构，**不随自定义变**（规则 5）。
 * 巨字右下另有一枚 41px 黑色**叠字**（英文页主题词 `Stages/Tasks/Members`，
 * 参考稿 `Execution` 的同位替换，§1.1 B2）。
 *
 * ── 三页共享的载荷渲染器 ──
 * 主体的构件与铺版在 `pages/agent-poster/PosterSheetBody.tsx`（三页同一套语法，
 * 差异全在 `shared.ts` 的 `planPosterSheets` 产出的 `PosterSheet` 里）。
 * 本文件负责：纸面外壳 + 页级巨字 + 页眉（kicker / 页签 / meta 行）+ logo 行 +
 * 物理页装配（含分页）。
 *
 * ── 页眉口径（§1.2.2）──
 *   左 = `ID PLAN · {英文页题}`（参考稿 `ID PLAN · AGENT EXECUTION REPORT` 的同位替换）；
 *   右 = `SHEET {nn} / {NN} · A4`（nn = 本页序号，NN = 物理页总数）；
 *   中文页题**移出页眉**——它只在**续页**上作为常规小页题出现（`{页题}（续）`）。
 *   项目名移到巨字下方的 meta 行（参考稿 y≈242 那行）。
 *   ⚠️ 页眉**被巨字压住是设计如此**（§1.1 明写，参考原稿同款）：页眉在 z 序上
 *   压在巨字墨迹之上，别按「重叠」当缺陷修（P0-23 的同族反向确认）。
 *
 * ── 页脚已整块移除（§1.2.2 末行）──
 * 参考稿无品牌页脚带，且页序已在页眉右、数据时间已在脚注。原
 * `--ap-footword-reserve: 129px`（P0-23 让位量）**搬到正文流**（`.ap-body` 的
 * margin-bottom）——落点不能改 `.ap-page` 的 padding-bottom：padding 会把绝对
 * 定位子元素（`.ap-footword { bottom: 0 }`）的包含块从 border-box 缩到
 * padding-box，巨字跟着上移 129px、直接毁掉页底出血（已实测）。
 *
 * ── 配色槽位 ──
 * 三枚经 `.print-root` 的 inline CSS 变量挂载（--tpl-accent / --tpl-ink /
 * --tpl-line），inline style 经 print-frame 的 cloneNode(true) 原样进 iframe
 * 打印面，无损（与 A/D/E 同一机制，print-palette.ts 文件头）。
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
import { PosterSheetBody } from '../pages/agent-poster/PosterSheetBody';
import {
  AP_POSTER_TASK_MAX,
  giantTier,
  isPosterKind,
  planPosterSheets,
  type PosterSheet,
} from '../pages/agent-poster/shared';
import { DEFAULT_PRINT_BRAND_WORD, normalizeBrandWord } from '../adapters/use-print-brand-word';
// H 版样式（Vite 随组件 chunk 进包；全部规则带 .print-root.print-template-* 前缀）
import '../styles/agent-poster.css';

/** 页底品牌装置词：固定 `IDPLAN`，不随自定义品牌词变（规格 §1.4 规则 5） */
export const AP_FOOTWORD_TEXT = 'IDPLAN';

/**
 * H 版三页（人类化批次：M1 阶段 / M2 任务 / M4 成员；顺序即纸面顺序）。
 * 复用的是**既有页 kind** ⇒ `PrintPageKind` 的 14 值联合与 `PAGE_TO_MODULE`
 * 都不动；页 kind 的分发由各 document 自己 switch。
 */
export const AGENT_POSTER_PAGES: readonly PrintPageKind[] = [
  'stage-overview',
  'task-register',
  'member-roster',
];

/**
 * 页题。`Record<PrintPageKind, …>` 的**全量键必须保留**（类型契约），
 * 本版实际用到的是前三键；其余十一键归 A/D/E（运行时不可达，兜底用）。
 * 三个 agent kind 是 H 上一代「治理公示稿」的页 kind——**本版已无渲染器**
 * （规格 §3.1 选项 A：从 H 的能力表移除即止），类型值保留（spec 逐字锁 14 值），
 * 旧 prefs 勾过 M10/M11 的用户经 `enabledSheetsOf` 静默忽略（不落页、不报错）。
 */
const AP_PAGE_TITLES: Record<PrintPageKind, { cn: string; en: string }> = {
  'stage-overview': { cn: '阶段海报', en: 'STAGE POSTER' },
  'task-register': { cn: '任务海报', en: 'TASK POSTER' },
  'member-roster': { cn: '成员海报', en: 'MEMBER POSTER' },
  // —— 以下十一键 H 不可达（A/D/E 的页；末三键为 legacy）——
  'delay-ledger': { cn: '延期记录表', en: 'DELAY LEDGER' },
  'progress-matrix': { cn: '阶段进度矩阵', en: 'PROGRESS MATRIX' },
  'dependency-network': { cn: '任务依赖网络', en: 'DEPENDENCY NETWORK' },
  'workload-composition': { cn: '阶段工作量构成', en: 'WORKLOAD COMPOSITION' },
  'milestone-acceptance': { cn: '里程碑与验收', en: 'MILESTONE & ACCEPTANCE' },
  'stage-index': { cn: '阶段目录', en: 'STAGE INDEX' },
  'member-index': { cn: '成员执行体目录', en: 'MEMBER INDEX' },
  'artifact-index': { cn: '产出物清单', en: 'ARTIFACT INDEX' },
  // legacy kind（无渲染器）
  'agent-declaration': { cn: 'Agent 执行宣告', en: 'AGENT DECLARATION' },
  'execution-status': { cn: '执行状态全览', en: 'EXECUTION STATUS' },
  'writeback-proposals': { cn: '写回提案公示', en: 'WRITEBACK PROPOSALS' },
};

/**
 * 页顶巨字右下的**叠字**（规格 §1.1 B2：41px、黑色、英文页主题词，压到巨字右下）。
 * 参考稿是 `Execution`（主题词位），不是状态词位——状态表达归栏头。
 */
const AP_PAGE_SUBWORD: Partial<Record<PrintPageKind, string>> = {
  'stage-overview': 'Stages',
  'task-register': 'Tasks',
  'member-roster': 'Members',
};

export interface AgentPosterDocumentProps {
  vm: PrintViewModel;
  /**
   * 纸面页（原生页 kind + 通用模块 id；缺省 = 默认原生模块 = 人类三页）。
   * 通用模块仍可手动勾选（`generic` 标记保留，P2 的回落路径也靠它）。
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

/** H 版一个物理纸面（原生海报页的一个分页 chunk；plan=null = 空态纸） */
export type ApPhysical =
  | {
      type: 'native';
      sheet: PosterSheet;
      /** 模块内第几页（0 起；>0 ⇒ 页眉出「（续）」且不出巨字） */
      chunkIndex: number;
      chunkTotal: number;
    }
  | {
      type: 'generic';
      module: 'stage-list' | 'task-list' | 'member-roster';
      plan: GenericPlan | null;
      chunkIndex: number;
      chunkTotal: number;
    };

/**
 * sheets ⇒ H 版物理页序列。
 * 原生页经 `planPosterSheets` **按容量分页**（`AP_POSTER_*` 常量；估高只许偏大）；
 * 通用模块走 `planGenericModule`（期三路径，勾选通用模块时才走）。
 */
export function agentPosterPhysical(vm: PrintViewModel, sheets: readonly PrintSheet[]): ApPhysical[] {
  const out: ApPhysical[] = [];
  const pushGeneric = (module: 'stage-list' | 'task-list' | 'member-roster'): void => {
    const plan = planGenericModule(module, vm, 'agent-poster');
    const total = plan === null ? 1 : plan.chunks.length;
    for (let i = 0; i < total; i++) {
      out.push({ type: 'generic', module, plan, chunkIndex: i, chunkTotal: total });
    }
  };
  for (const sheet of sheets) {
    if (sheet.type === 'native') {
      if (!isPosterKind(sheet.page)) continue;
      // ── 任务海报的**双轨**（规格 §1.2.3 / 审美标准 §2-H 既有纪律）──
      // 原生海报的块容量只有 4 组 × 3 = 12 块/页（`apPosterColumnCap(2)`，真机实测）；
      // 任务常态 20-30 条 ⇒ 超限时本页回落通用渲染（清单行 + 右栏面板），
      // 而不是把海报硬撑成一条长清单——「>8（人类卡更宽 ⇒ 12）回清单行+右栏常驻」。
      if (sheet.page === 'task-register' && vm.tasks.length > AP_POSTER_TASK_MAX) {
        pushGeneric('task-list');
        continue;
      }
      const planned = planPosterSheets(sheet.page, vm);
      planned.forEach((s, i) => {
        out.push({ type: 'native', sheet: s, chunkIndex: i, chunkTotal: planned.length });
      });
      continue;
    }
    if (!isGenericRenderable(sheet.module)) continue;
    pushGeneric(sheet.module);
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
  const total = physical.length;
  // 页顶巨字载荷：同一真值源做归一（去空白 + ≤12 字符截断），空值回落缺省词。
  // 截断在**渲染口**再做一遍，保证「传进来的超长词也不会撑破纸面」——单次归一，逐页复用。
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
          key={p.type === 'native' ? `${p.sheet.kind}-${p.chunkIndex}` : `generic-${p.module}-${p.chunkIndex}`}
          page={p}
          vm={vm}
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
  logo,
  brandWord,
  pageIndex,
  pageTotal,
  pageRef,
}: {
  page: ApPhysical;
  vm: PrintViewModel;
  logo: string | null;
  brandWord: string;
  pageIndex: number;
  pageTotal: number;
  pageRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  // 页题：原生海报页走 AP_PAGE_TITLES；通用模块走 GENERIC_TITLES（期三）
  const title =
    page.type === 'native'
      ? (AP_PAGE_TITLES[page.sheet.kind] ?? AP_PAGE_TITLES['stage-overview']!)
      : GENERIC_TITLES[page.module];
  const pageAttr = page.type === 'native' ? page.sheet.kind : `generic-${page.module}`;
  // 原生页续页（chunkIndex > 0）：页眉出常规小页题「{中文页题}（续）」，**不出巨字**
  const continued = page.type === 'native' && page.chunkIndex > 0;
  // 页顶出血巨字：**模块首页**才出血（续页不出，规格 §1.2.2 分页口径）；
  // 空态页也不出（空态不用装饰填版，与「不许用模拟记录填版」同一口径）。
  const showTopWord = page.type === 'native' && page.chunkIndex === 0 && !page.sheet.empty;
  const subWord = page.type === 'native' ? AP_PAGE_SUBWORD[page.sheet.kind] : undefined;
  // meta 行：原生页每页都出（跨页不变，每页自解释）；通用页出**项目名**——
  // H 的页眉是报告装置（`ID PLAN · {页题}` + 页签），项目名只能由这一行承担，
  // 否则通用页（M2 超容量的回落页）会缺「这是哪个项目」而无法独立解释。
  // 通用页的计数口径在它自己的模块头（`.gm-head__count`），这里不重复。
  const meta = page.type === 'native' ? page.sheet.meta : vm.project.name;

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
          {/* 巨字右下叠字 = 英文页主题词（参考稿 `Execution` 的同位替换，规格 §1.1 B2 /
              §1.2.2 行 184）。载荷是**页主题**而不是状态——状态表达已归双栏栏头（§1.4）。 */}
          {subWord !== undefined && <span className="ap-giant__subword">{subWord}</span>}
        </div>
      )}

      {/* 页眉：左 `ID PLAN · 英文页题`，右 `SHEET nn / NN · A4`；续页在下方出小页题。
          data-first 由「本页是否出巨字」驱动 —— 出巨字时页眉给它让出墨迹高度。 */}
      <header className="ap-head" data-first={showTopWord || undefined}>
        <div className="ap-head__top">
          <p className="ap-head__kicker">{`ID PLAN · ${title.en}`}</p>
          <p className="ap-head__tab">{`SHEET ${String(pageIndex + 1).padStart(2, '0')} / ${String(pageTotal).padStart(2, '0')} · A4`}</p>
        </div>
        {continued && <p className="ap-head__cont">{`${title.cn}（续）`}</p>}
        <p className="ap-head__meta">{meta}</p>
        <div className="ap-head__rule" aria-hidden />
      </header>

      {/* logo 行：每页一枚（左上角、发丝线下方 ≤22px）——全局 logo 是产品必登项，
          参考稿没有不等于可以不登（§3.3「内容必登、形态服从参考稿」） */}
      <div className="ap-logo-row">
        <PrintLogoMark logo={logo} height={22} />
      </div>

      {/* 主体：原生海报页（无数据走该页自己的空态）/ 通用模块（显式勾选时） */}
      <div className="ap-body">
        {page.type === 'generic' ? (
          page.plan === null ? (
            <GenericPosterEmpty module={page.module} />
          ) : (
            <GenericModuleBody plan={page.plan} chunkIndex={page.chunkIndex} />
          )
        ) : (
          <PosterSheetBody sheet={page.sheet} />
        )}
      </div>

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
