import { useMemo, useRef, useState } from 'react';

import { Link, Navigate, useParams } from 'react-router-dom';

import { ArrowLeft, Download, FileText, Printer } from 'lucide-react';

import { useProjectsStore } from '../store/useProjectsStore';
import { useMembersStore } from '../store/useMembersStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useRoleGuard } from '../hooks/useRoleGuard';
import {
  buildMonthMeta,
  computeCalendarEntry,
  stageSpan,
  type CalendarMonthMeta,
} from '../components/calendar/calendarMath';
import {
  STAGE_COLOR_NAMES,
  stageBandClass,
  stageSolidClass,
} from '../components/timeline/stageColors';
import { CIRCLED_NUMBERS } from '../components/calendar/calendarColors';
import { resolveStageColorIndex } from '../core/template/stage-fallback';
import { isRestDay } from '../lib/workdays';
import { exportSchedulePngPages, schedulePngFileName, A4_WIDTH_PX, A4_HEIGHT_PX } from '../lib/schedule-print';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** 本地时区 ISO（YYYY-MM-DD） */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 周一 = 0，周日 = 6 */
function mondayFirst(d: Date): number {
  return (d.getDay() + 6) % 7;
}

interface GridDay {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isRest: boolean;
  /** 覆盖该日的阶段（用于色带取色，宽面 lightBar） */
  coverStageIndex: number | null;
}

function buildCalendarGrid(
  meta: CalendarMonthMeta,
  todayIso: string,
  visibleStages: { orderIndex: number; colorIndex: number | null; startAt: string; endAt: string }[],
): GridDay[] {
  const first = new Date(meta.year, meta.month - 1, 1);
  const startOffset = mondayFirst(first);
  const start = new Date(meta.year, meta.month - 1, 1 - startOffset);

  const days: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = localIso(d);
    const inMonth = d.getMonth() + 1 === meta.month;
    const covered = visibleStages.find(
      (s) => iso >= s.startAt.slice(0, 10) && iso <= s.endAt.slice(0, 10),
    );
    days.push({
      date: iso,
      day: d.getDate(),
      inMonth,
      isToday: iso === todayIso,
      isRest: isRestDay(iso, useSettingsStore.getState().restPolicy),
      coverStageIndex: covered ? resolveStageColorIndex(covered.orderIndex, covered.colorIndex) : null,
    });
  }
  return days;
}

/** 生成项目覆盖到的所有月份（YYYY-MM） */
function monthsBetween(startAt: string, endAt: string): string[] {
  const months: string[] = [];
  const start = new Date(`${startAt.slice(0, 7)}-01`);
  const end = new Date(`${endAt.slice(0, 7)}-01`);
  const cur = new Date(start);
  while (cur <= end) {
    months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

/**
 * 项目月历打印视图（A4 · 强制浅色 · 画板 20）：
 * 按 A4 逐月渲染项目阶段在日历上的覆盖，支持打印 / PDF / PNG 导出。
 *
 * 阶段色分工（规格 §1.2 / §1.3，铁律）：
 *   · 每格色带（宽面）→ stage-band（bg-stage-band-sN）；取色走静态类映射 stageBandClass，禁止模板字符串拼类名；
 *   · 图例小方块（实心块）→ stage（bg-stage-sN）。
 * 休息日判定唯一真相源 = lib/workdays.isRestDay（支持单/双/大/小休），不硬编码周六周日。
 * 阶段色泽说明走动态色名 STAGE_COLOR_NAMES（D3：旧版「苔绿/橄榄/芥黄/梅紫」是莫兰迪遗留，已删）。
 * 打印子树根节点带 .print-root，global.css 已把它整棵锁回亮色，暗色主题下仍是浅稿。
 */
export function CalendarPrintPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === id));
  const stages = useProjectsStore((s) => s.stages.filter((st) => st.projectId === id));
  const members = useMembersStore((s) => s.members);
  // v0.7-D：本页守卫只看 role（`role === null` 与 `isRestrictedView(role)` 是**两个档位**）——
  // 故不取 isAdmin，也不在页内自写 `!isMember` 之类的派生。
  const { role, currentMember, hydrated } = useRoleGuard();

  const [pngBusy, setPngBusy] = useState(false);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

  // 所有 Hook 必须在任何条件提前 return 之前调用完成
  // 可见阶段（图例 / 逐日色带取色用）
  const visibleStages = useMemo(
    () => stages.filter((s) => s.visible !== false).map((s) => ({
      orderIndex: s.orderIndex,
      colorIndex: s.colorIndex,
      startAt: s.startAt,
      endAt: s.endAt,
    })),
    [stages],
  );
  // 月份覆盖范围（图3修复）：取「阶段实际起止 ∪ 项目计划基线」，避免阶段拖出计划范围后被裁剪
  const months = useMemo(() => {
    if (!project) return [];
    const span = stageSpan(stages);
    const s = span && span.minStart < project.plannedStartAt.slice(0, 10) ? span.minStart : project.plannedStartAt.slice(0, 10);
    const e = span && span.maxEnd > project.plannedEndAt.slice(0, 10) ? span.maxEnd : project.plannedEndAt.slice(0, 10);
    return monthsBetween(s, e);
  }, [project, stages]);
  const todayIso = localIso(new Date());
  const entries = useMemo(() => {
    if (!project) return [];
    return months.map((m) => {
      const meta = buildMonthMeta(m, todayIso);
      const entry = computeCalendarEntry(project, stages, meta);
      const grid = buildCalendarGrid(meta, todayIso, visibleStages);
      return { meta, entry, grid };
    });
  }, [project, stages, visibleStages, months, todayIso]);
  const nowIso = new Date().toISOString();
  const nowText = `${nowIso.slice(0, 10)} ${nowIso.slice(11, 16)}`;

  if (!hydrated) {
    return <div className="py-16 text-center text-mist">正在装载月历…</div>;
  }

  /**
   * 页内守卫（v0.7-D · 用户已拍板「放开成员打印」）：
   *   · **未进入身份（role === null）** → 仍重定向回首页（无身份即无可见范围，保持现状）；
   *   · **成员（受限）** → **允许留在页内只读导出**（本页零数据写操作：打印 / 读 DOM 导出 PNG /
   *     失败时一条 toast，`restPolicy` 仅只读）；
   *   · **管理员** → 行为不变。
   * 旧注释口径「非管理员一律重定向」已作废。`role === null` 与「成员」是两档，切勿混同。
   */
  if (role === null) {
    return <Navigate to="/" replace />;
  }

  if (!project) {
    return (
      <div className="py-16 text-center text-mist">
        <p className="mb-3">未找到该项目。</p>
        <Link to="/" className="text-pine underline underline-offset-2">
          ← 返回项目列表
        </Link>
      </div>
    );
  }

  const onPrint = (): void => window.print();

  const onExportPdf = (): void => window.print();

  const onExportPng = async (): Promise<void> => {
    const els = pageRefs.current.filter((el): el is HTMLDivElement => el !== null);
    if (els.length === 0) return;
    setPngBusy(true);
    try {
      await exportSchedulePngPages(els, schedulePngFileName(`${project.name}-月历`));
    } catch {
      useProjectsStore.getState().pushToast('error', 'PNG 导出失败，请改用「打印 / 另存为 PDF」。');
    } finally {
      setPngBusy(false);
    }
  };

  return (
    <div className="print-root mx-auto w-full max-w-[900px] px-6 py-8">
      {/* 操作栏（打印时隐藏） */}
      <div className="no-print mb-6 flex flex-wrap items-center gap-2 text-sm">
        <Link
          to={`/project/${project.id}`}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-mist transition-colors hover:bg-sunken hover:text-ink"
        >
          <ArrowLeft size={14} /> 返回项目
        </Link>
        <span className="ml-auto" />
        <span className="text-xs text-mist">共 {entries.length} 页 · A4</span>
        <button
          type="button"
          onClick={onPrint}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-mist transition-colors hover:bg-sunken hover:text-ink"
        >
          <Printer size={14} /> 打印
        </button>
        <button
          type="button"
          onClick={onExportPdf}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-mist transition-colors hover:bg-sunken hover:text-ink"
        >
          <FileText size={14} /> 导出 PDF
        </button>
        <button
          type="button"
          onClick={() => void onExportPng()}
          disabled={pngBusy}
          className="inline-flex items-center gap-1.5 rounded-md bg-pine px-3 py-1.5 text-white transition-colors hover:bg-pine-deep disabled:opacity-50"
        >
          <Download size={14} /> {pngBusy ? '生成中…' : `导出 PNG${entries.length > 1 ? `（${entries.length} 张）` : ''}`}
        </button>
      </div>

      {entries.map(({ meta, entry, grid }, idx) => (
        <div
          key={meta.monthStart}
          ref={(el) => {
            pageRefs.current[idx] = el;
          }}
          className="a4-page mx-auto mb-6 flex flex-col"
          style={{ width: A4_WIDTH_PX, minHeight: A4_HEIGHT_PX, padding: 40 }}
        >
          {/* 公文头（画板 20：项目名 26/700 · 委托方 13 · 周期 13 · 右上 ID Plan 月历 13 · 分隔线） */}
          <header className="flex items-start justify-between border-b border-line pb-2">
            <div>
              <h1 className="text-[26px] font-bold leading-tight text-ink">{project.name}</h1>
              <p className="mt-0.5 text-[13px] text-mist">
                委托方：{project.clientName || '—'}
              </p>
              <p className="text-[13px] text-mist">
                周期：{project.plannedStartAt.slice(0, 10)} – {project.plannedEndAt.slice(0, 10)}
              </p>
            </div>
            <span className="shrink-0 text-[13px] text-mist">ID Plan 月历</span>
          </header>

          {/* 项目概览（当前阶段 / 进度，命名 token） */}
          <div className="mt-3 flex items-center gap-3">
            <div
              className={`h-4 w-4 rounded-sm ${entry.filterStageIndex ? stageSolidClass(entry.filterStageIndex) : 'bg-sunken'}`}
            />
            <p className="text-[13px] text-mist">
              当前阶段：{entry.activeStage?.name ?? '—'} · 进度 {Math.round(entry.percent)}% · 剩余 {entry.daysRemaining} 天
            </p>
          </div>

          {/* 月份区 */}
          <h2 className="mt-4 text-[18px] font-semibold text-ink">{meta.label}</h2>

          {/* 星期表头（一–日，11） */}
          <div className="mt-2 grid grid-cols-7 border border-line bg-sunken text-center text-[11px] font-medium text-mist">
            {WEEKDAYS.map((w) => (
              <div key={w} className="border-r border-line py-2 last:border-r-0">
                {w}
              </div>
            ))}
          </div>

          {/* 日期网格（画板 20：每格 ~113×110；当月 paper / 休息日 rest-day / 非当月 sunken；色带 lightBar） */}
          <div className="grid grid-cols-7 border-x border-line">
            {grid.map((day) => {
              const cellBg = !day.inMonth
                ? 'bg-sunken text-mist'
                : day.isRest
                  ? 'bg-rest-day text-ink'
                  : 'bg-paper text-ink';
              const bandCls = day.coverStageIndex ? stageBandClass(day.coverStageIndex) : '';
              return (
                <div
                  key={day.date}
                  className={`relative min-h-[110px] border-b border-r border-line p-2 last:border-r-0 ${cellBg}`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[13px] ${
                      day.isToday ? 'bg-pine text-white' : ''
                    }`}
                  >
                    {day.day}
                  </span>
                  {day.inMonth && day.coverStageIndex !== null && (
                    <div
                      className={`schedule-bar-segment absolute inset-x-2 bottom-2 top-9 rounded-sm ${bandCls}`}
                      title={`${day.date} · 阶段 ${day.coverStageIndex} ${STAGE_COLOR_NAMES[day.coverStageIndex] ?? ''}`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* 阶段色泽说明（D3：动态色名，删去旧版莫兰迪遗留；延续上页提示） */}
          <div className="mt-3 text-[11px] leading-relaxed text-mist">
            <p>
              阶段色泽：
              {visibleStages.map((s, i) => {
                const nameIdx = resolveStageColorIndex(s.orderIndex, s.colorIndex);
                const label = STAGE_COLOR_NAMES[nameIdx] ?? '';
                const stage = stages.find((st) => st.orderIndex === s.orderIndex && st.visible !== false);
                return (
                  <span key={s.orderIndex}>
                    {i > 0 ? '　' : ''}
                    {CIRCLED_NUMBERS[nameIdx - 1] ?? ''}
                    {label}
                    {stage ? `（${stage.name}）` : ''}
                  </span>
                );
              })}
            </p>
            <p className="mt-1">色带长度 = 该阶段的起止日期跨度，不代表完成百分比。</p>
          </div>

          {/* 图例（项目覆盖 + 今天，命名 token） */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-mist">
            <span className="flex items-center gap-1">
              <span className={`inline-block h-3 w-3 rounded-sm ${entry.filterStageIndex ? stageSolidClass(entry.filterStageIndex) : 'bg-sunken'}`} />
              项目覆盖
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-full bg-pine" />
              今天
            </span>
          </div>

          {/* 页脚（画板 20：分隔线 + 第 N / 共 M 页 · ID Plan 月历） */}
          <footer className="mt-auto flex items-center justify-between border-t border-line pt-2 text-[11px] text-mist">
            <span>打印人：{currentMember?.name ?? '—'} · {nowText}</span>
            <span>
              第 {idx + 1} / {entries.length} 页 · ID Plan 月历
            </span>
          </footer>
        </div>
      ))}
    </div>
  );
}
