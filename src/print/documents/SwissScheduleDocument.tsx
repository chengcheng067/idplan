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

import { MemberActorKind, StageStatus, TASK_STATUS_LABELS } from '../../core/types/enums';
import { formatTaskNo } from '../../core/lib/task-no';
import { A4_WIDTH_PX, A4_HEIGHT_PX } from '../../lib/schedule-print';
import { printTemplateClass } from '../../components/print/print-skins';

import type { PrintPageKind, PrintStageLogVM, PrintStageVM, PrintViewModel } from '../model/print-view-model';
import type { PrintPalette } from '../model/print-palette';
import { EmptyPrintState } from '../parts/EmptyPrintState';
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
  /** 启用的页（缺省 = 四页全选；选择器勾选即时重渲染） */
  pages?: readonly PrintPageKind[];
  /** 有效配色（自定义或设计师基线；三枚 hex） */
  palette: PrintPalette;
  /** 导出 PNG 的页面元素收集（ref callback 数组，宿主持有） */
  pageRef?: (idx: number) => Ref<HTMLDivElement>;
}

export function SwissScheduleDocument({
  vm,
  pages,
  palette,
  pageRef,
}: SwissScheduleDocumentProps): JSX.Element {
  const enabled = (pages ?? SWISS_SCHEDULE_PAGES).filter((p) => SWISS_SCHEDULE_PAGES.includes(p));
  const total = enabled.length;

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
      {enabled.map((kind, idx) => (
        <SwissPage
          key={kind}
          kind={kind}
          vm={vm}
          pageIndex={idx}
          pageTotal={total}
          pageRef={pageRef?.(idx)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 纸面外壳 */

function SwissPage({
  kind,
  vm,
  pageIndex,
  pageTotal,
  pageRef,
}: {
  kind: PrintPageKind;
  vm: PrintViewModel;
  pageIndex: number;
  pageTotal: number;
  pageRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  const nav = SWISS_NAV.find((n) => n.kind === kind) ?? SWISS_NAV[0]!;
  return (
    <div
      ref={pageRef}
      data-print-page={kind}
      data-page-index={pageIndex}
      className="a4-page swiss-page"
      style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX }}
    >
      {/* 黑顶栏（左右内缩 40px，黄字反白；项目名居中=站名） */}
      <header className="swiss-topbar">
        <div className="swiss-topbar__nav" aria-label="栏目">
          {SWISS_NAV.map((n) => (
            <span
              key={n.kind}
              className="swiss-topbar__navitem"
              data-current={n.kind === kind || undefined}
            >
              {n.en}
            </span>
          ))}
        </div>
        {/* 项目名居中被做「站名」；超出两行截断，完整名经 title 可访问（02 §8） */}
        <div className="swiss-topbar__title" title={vm.project.name}>
          {vm.project.name}
        </div>
        <div className="swiss-topbar__meta">
          <span>{nav.en}</span>
          <span className="swiss-num">
            {vm.project.scheduleBasisLabel} · {vm.project.plannedStartAt} – {vm.project.plannedEndAt}
          </span>
        </div>
      </header>

      <div className="swiss-body">
        <SwissPageBody kind={kind} vm={vm} />
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
  // 三列错落：按 orderIndex 轮分三栏（CSS 给 2/3 栏纵向错位）
  const columns: PrintStageVM[][] = [[], [], []];
  stages.forEach((s, i) => columns[i % 3]!.push(s));
  const dense = stages.length > 15;

  return (
    <section className="swiss-board" data-density={dense ? 'compact' : undefined}>
      <div className="swiss-board__head">
        <h2 className="swiss-board__title">阶段总览 · 时刻表</h2>
        <span className="swiss-board__count swiss-num">
          {stages.length} 阶段 · 完成度 {Math.round(vm.project.percent)}%
        </span>
      </div>
      {stages.length === 0 ? (
        <EmptyPrintState kind="stages" />
      ) : (
        <div className="swiss-columns">
          {columns.map((col, ci) => (
            <div key={ci} className="swiss-column" data-col={ci + 1}>
              {col.map((s) => (
                <div key={s.id} className="swiss-stage-row" data-state={s.status}>
                  <div className="swiss-stage-row__top">
                    <span className="swiss-stage-row__no swiss-num">
                      {String(s.orderIndex).padStart(2, '0')}
                    </span>
                    <span className="swiss-stage-row__name">{s.name}</span>
                    <span className="swiss-stage-row__state">
                      <span className="swiss-state-glyph" aria-hidden>
                        {STAGE_GLYPH[s.status]}
                      </span>
                      {stageStatusLabel(s.status)}
                    </span>
                  </div>
                  <div className="swiss-stage-row__bottom">
                    <span className="swiss-num">
                      {s.startAt} — {s.endAt}
                    </span>
                    <span>占比 {s.ratioPercent}%</span>
                    <span>任务 {s.taskProgress.done}/{s.taskProgress.total}</span>
                    <span>负责人 {s.ownerName ?? '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

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
      <div className="swiss-board__head">
        <h2 className="swiss-board__title">任务读号表</h2>
        <span className="swiss-board__count swiss-num">{tasks.length} 条</span>
      </div>
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
      <div className="swiss-board__head">
        <h2 className="swiss-board__title">延期记录表</h2>
        <span className="swiss-board__count swiss-num">{logs.length} 条流水</span>
      </div>

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
      <div className="swiss-board__head">
        <h2 className="swiss-board__title">成员责任表</h2>
        <span className="swiss-board__count swiss-num">{members.length} 人</span>
      </div>
      {members.length === 0 ? (
        <EmptyPrintState kind="members" />
      ) : (
        <table className="swiss-register swiss-roster">
          <thead>
            <tr>
              <th>姓名</th>
              <th>类型</th>
              <th>agentKind</th>
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
                  <td>{isAgent ? 'Agent' : 'human'}</td>
                  {/* agentKind 是开放字符串：未知值原样显示，不收敛枚举 */}
                  <td className="swiss-num">{m.agentKind ?? '—'}</td>
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
