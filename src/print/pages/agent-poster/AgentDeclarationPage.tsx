/**
 * H 版 P1 · Agent 执行宣告（01 文档 §7 / 02 文档 §6）。
 *
 * ── 海报读法（载荷已按规格 §1.4 拍板改口径）──
 * 页顶出血巨字**不再承担状态**——它是页级品牌装置，载荷 = 用户自定义品牌词
 * （`print.brandWord`，默认 `PLAN`，规格 §1.4）。焦点执行的状态改由本页
 * 「焦点行」陈述（`ap-declare__focus`）；分组栏头承担状态表达属人类化批
 * （§1.2.2）。焦点执行的选取仍是**确定性**的（pickFocusExecution：
 * running → needs_attention → … → 终态），治理公示稿的「当前主状态」
 * 必须唯一，不随排序漂移。
 *
 * ── 口径纪律（出错是对外事故）──
 *   · confidence **仅展示**，旁标「仅供参考」，不做任何阈值判定（01 §3.3）；
 *   · 写回白名单**仅四项**（WRITEBACK_WRITABLE_FIELDS 唯一出处），旁标
 *     「其余字段只读」（01 §7 P1/P3）；
 *   · attempt / runId / 来源 / 目标全部来自 VM 真实投影，无字段不编。
 *
 * ── 空态 ──
 * 无 Agent 数据时本页不出巨字、不出宣告块——整版只读空态由文档层统一渲染
 * （EmptyPrintState kind='agent'），**不许用模拟记录填版**（02 §8）。
 */

import { formatTaskNo } from '../../../core/lib/task-no';
import type { PrintViewModel } from '../../model/print-view-model';
import { PrintLogoMark } from '../../parts/PrintLogoMark';
import {
  CONFIDENCE_DISPLAY_NOTE,
  EXECUTION_SOURCE_LABELS,
  EXECUTION_STATUS_GLYPH,
  EXECUTION_STATUS_LABELS,
  EXECUTION_STATUS_TONE,
  formatConfidence,
  pickFocusExecution,
  stampOf,
  WRITEBACK_READONLY_NOTE,
  WRITEBACK_WHITELIST_ITEMS,
} from './shared';

export function AgentDeclarationPage({
  vm,
  logo,
}: {
  vm: PrintViewModel;
  logo: string | null;
}): JSX.Element {
  const focus = pickFocusExecution(vm.executions);
  // 无数据：文档层已渲染整版空态，这里不出内容（防御性双保险）
  if (!focus) return <></>;

  const tone = EXECUTION_STATUS_TONE[focus.status];
  // confidence 住在提案上（执行单无此字段，01 §3.3）：取该执行最新提案的
  // 自报置信度；无提案 ⇒ '—'。仅展示，旁标「仅供参考」。
  const focusTask = vm.tasks.find((t) => t.id === focus.taskId) ?? null;
  const latestProposal = vm.proposals
    .filter((p) => p.executionId === focus.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  return (
    <div className="ap-declare">
      {/* 焦点行：当前主状态（黑）/ 等待人工介入（橙）。
          页顶出血巨字是**页级品牌装置**（载荷 = 品牌词，规格 §1.4），
          它住在文档层（AgentPosterDocument 的 .ap-giant），不在这里出。 */}
      <p className="ap-declare__focus" data-tone={tone}>
        <span className="ap-declare__glyph" aria-hidden>
          {EXECUTION_STATUS_GLYPH[focus.status]}
        </span>
        {EXECUTION_STATUS_LABELS[focus.status]} · 当前主状态
      </p>

      {/* logo：巨字下方左侧（≤24px；未上传 = 「ID Plan」文字标） */}
      <div className="ap-declare__logo">
        <PrintLogoMark logo={logo} height={24} />
      </div>

      {/* 双栏：左 = 执行单宣告（真实字段）；右 = 写回白名单（治理公示） */}
      <div className="ap-declare__cols">
        <section className="ap-declare__block">
          <h3 className="ap-declare__block-title">执行单宣告</h3>
          <dl className="ap-fields">
            <Field label="执行状态" value={`${EXECUTION_STATUS_LABELS[focus.status]}（${focus.status}）`} tone={tone} />
            <Field label="尝试次数" value={`第 ${focus.currentAttemptNo} 次`} />
            <Field
              label="关联任务"
              value={focusTask ? `${formatTaskNo(focusTask.taskNo)} · ${focusTask.title}` : '—'}
              wide
            />
            <Field label="runId" value={focus.runId ?? '—'} mono />
            <Field label="执行来源" value={EXECUTION_SOURCE_LABELS[focus.source] ?? focus.source} />
            <Field label="Agent" value={focus.agentName ?? '—'} />
            <Field
              label="confidence"
              value={`${formatConfidence(latestProposal?.confidence ?? null)}（${CONFIDENCE_DISPLAY_NOTE}）`}
              note
            />
            <Field label="目标" value={focus.objective} wide />
            <Field label="创建时间" value={stampOf(focus.createdAt)} mono />
          </dl>
        </section>

        <section className="ap-declare__block" data-focus="gate">
          <h3 className="ap-declare__block-title">
            写回白名单
            <span className="ap-declare__block-note">Agent 可提议改写的字段仅此四项</span>
          </h3>
          <ol className="ap-whitelist">
            {WRITEBACK_WHITELIST_ITEMS.map((f) => (
              <li key={f} className="ap-whitelist__item">
                <span className="ap-whitelist__no">{WRITEBACK_WHITELIST_ITEMS.indexOf(f) + 1}</span>
                <span className="ap-whitelist__field">{f}</span>
              </li>
            ))}
          </ol>
          <p className="ap-whitelist__readonly">
            <strong>{WRITEBACK_READONLY_NOTE}</strong>：白名单外的字段任何执行都无权改写；
            全部写回先产字段级 before/after 提案，经人工批准后才落库。
          </p>
        </section>
      </div>

      {/* 页底口径注（中轴不穿说明文字——本注在双栏容器之外） */}
      <p className="ap-declare__note">
        本页为治理公示稿：状态口径以执行域状态机为准；confidence 仅展示、不参与任何自动决策；
        共 {vm.executions.length} 条执行记录进入本版（数据时间 {stampOf(vm.generatedAt)}）。
      </p>
    </div>
  );
}

/** 宣告字段行（label + value；mono = 等宽；note = 「仅供参考」旁标字段） */
function Field({
  label,
  value,
  tone,
  mono,
  note,
  wide,
}: {
  label: string;
  value: string;
  tone?: 'gate' | 'run' | 'sys' | 'term';
  mono?: boolean;
  note?: boolean;
  wide?: boolean;
}): JSX.Element {
  return (
    <div className="ap-field" data-wide={wide || undefined} data-note={note || undefined}>
      <dt className="ap-field__label">{label}</dt>
      <dd className="ap-field__value" data-tone={tone} data-mono={mono || undefined}>
        {value}
      </dd>
    </div>
  );
}
