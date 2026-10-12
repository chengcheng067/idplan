/**
 * D 版 · 页壳共用件（2026-10-13 批 B）。
 *
 * ── 为什么抽 ──
 * 5 块重构后 D 有两个宿主：legacy「原生页」路径（sheets，出选择器但代码与 spec
 * 全留）与新的「5 块形态」。两者的**页头装置 `de-head` 与页尾完成度横带
 * `de-band` 是同一件东西**（装置 · 丙：不参与勾选、每页都在），只有**巨字标题
 * 的来源**不同：
 *   · legacy：巨字标题 = 该页的页题（`阶段进度矩阵` …）；
 *   · 5 块形态：巨字标题 = **固定的类型词**（§1.2 B1 的「乙」项：从「页题」
 *     改成固定的类型词），橙色副标承担每页的英文页身份。
 * 抽出来只改 title 一处来源，DOM 与类名与今天**逐字相同**（legacy 的既有断言
 * 照旧；`print-a4-visual-d` 的 P0-8/P1-7 断言钉着这套结构）。
 */

import type { PrintViewModel } from '../../model/print-view-model';
import { PrintLogoMark } from '../../parts/PrintLogoMark';
import { reportStampOf } from './shared';

/** 5 块形态的**固定类型词**（§1.2 B1 的乙项；巨字标题不再随页变） */
export const DE_TYPE_TITLE = '排期报告';
/** 固定类型词的英文副标（与中文类型词成对，承担「这是什么文档」的英文身份） */
export const DE_TYPE_KICKER = 'PROJECT CONTROL';

/** 两位补零（`REPORT 01 / 04` 的定宽形状，P1-7 右半） */
export const dePad2 = (n: number): string => String(n).padStart(2, '0');

export interface DeHeadProps {
  vm: PrintViewModel;
  logo: string | null;
  pageIndex: number;
  pageTotal: number;
  /** 巨字标题与橙副标（legacy = 页题；5 块形态 = 固定类型词） */
  title: { cn: string; en: string };
  /**
   * 右栏排期口径行（`de-head__meta`）的**整串**。
   * 由调用方给串而不是在本组件里拼，是为了让两条路各自保持自己的字段组合：
   *   · legacy：`基准 · 周期 · 委托人`（今天逐字不变）；
   *   · 5 块形态：`周期 · 委托人`（**基准搬去 B3 的 mono 行**，见下）。
   * 组件层不判「哪条路」，只渲染给它的那串。
   */
  meta: string;
}

/**
 * 页头装置（B1 的承载 + `de-head`/`REPORT` 装置）。
 * 结构逐字沿用 2026-10-11 P0-8/P1-7 重排后的形状：
 * logo 行 → 巨字标题 → 标题下的橙副标；右栏 = REPORT + 项目名 + 排期口径；
 * 右下 3px 近黑硬边线（内缩 40px）。
 *
 * ⚠️ **逐字段自查（批 B 任务书第 8 条：任何条件组合下不许丢字段）**：
 *   · 项目名 `de-head__project` —— 恒渲染（B1 在本套是 forced，不可取消）；
 *   · 周期 `plannedStartAt – plannedEndAt` —— 恒渲染（无条件）；
 *   · 委托人 `clientName` —— **仅 admin 有值**（VM 层就为 undefined）；
 *     非 admin 时该行只剩「基准 · 周期」，**不是丢掉字段而是本来就没有**
 *     （权限语义，与 A/经典同源）；
 *   · 报告号 + 点分日期 `de-head__report` —— 恒渲染（页码唯一落点，原则 1）；
 *   · 排期基准 —— **5 块形态下搬去 B3 的 mono 行**（§3 铁律①允许 B1/B3 的分界按
 *     承载能力走；同页两处印同一个值是被用户点名过的排版病）⇒ 该形态下本行只剩
 *     「周期 · 委托人」；legacy 路径**逐字不变**（仍含基准）——串由调用方给，
 *     本组件不判路。
 */
export function DeHead({ vm, logo, pageIndex, pageTotal, title, meta }: DeHeadProps): JSX.Element {
  return (
    <header className="de-head">
      <div className="de-head__left">
        {/* logo：每页头部左上格（≤28px；D 的 radius=0 身份 ⇒ 不加圆角不加底）。
            未上传 = 「ID Plan」文字标 */}
        <div className="de-head__logo">
          <PrintLogoMark logo={logo} height={28} />
        </div>
        {/* 完整单行中文标题（Noto Sans SC Black；不拆字体拼接，01 §5） */}
        <h1 className="de-head__title">{title.cn}</h1>
        {/* 英文副标：在标题下发，橙（P0-8：原在标题上方且是 #404040 kicker） */}
        <p className="de-head__kicker">
          <span className="de-head__signal" aria-hidden />
          {title.en}
        </p>
      </div>
      <div className="de-head__right">
        {/* 报告装置右半（2026-10-11 P1-7 裁决）：`REPORT nn / nn` + 点分日期，
            mono 小字、右对齐，置于项目标识之上。**D 的页码唯一落点**（B5 不重复登）。 */}
        <p className="de-head__report de-num">
          REPORT {dePad2(pageIndex + 1)} / {dePad2(pageTotal)}　{reportStampOf(vm.generatedAt)}
        </p>
        {/* 项目名最多两行，超出截断；完整文本经 title 可访问（02 §8） */}
        <p className="de-head__project" title={vm.project.name}>
          {vm.project.name}
        </p>
        <p className="de-head__meta de-num">{meta}</p>
      </div>
      {/* 3px 近黑硬边分隔线（**内缩 40px**，P0-9 ①；原为通版出血） */}
      <div className="de-head__rule" aria-hidden />
    </header>
  );
}

/**
 * 页尾完成度横带（装置 · 丙，§2.6：每页都有、不因勾选消失）。
 * 它**不是 KPI 带**（批 B 任务书第 3 条：B2 不许再挂 KPI 带——同页两个聚合）。
 */
export function DeBand({ vm }: { vm: PrintViewModel }): JSX.Element {
  const doneStages = vm.stages.filter((s) => s.status === 'completed').length;
  return (
    <div className="de-band">
      <span className="de-band__left">
        <span className="de-band__label">项目完成度</span>
        <span className="de-band__caption">
          已完成 {doneStages} / {vm.stages.length} 个阶段
        </span>
      </span>
      <span className="de-band__pct de-num">{Math.round(vm.project.percent)}%</span>
    </div>
  );
}
