import { useMemo, useRef, useState } from 'react';

import { Link, Navigate, useParams } from 'react-router-dom';

import { ArrowLeft, Download, FileText, Printer } from 'lucide-react';

import { useProjectsStore } from '../store/useProjectsStore';
import { useMembersStore } from '../store/useMembersStore';
import { useRoleGuard } from '../hooks/useRoleGuard';
import {
  buildMonthMeta,
  computeCalendarEntry,
  dayIndexInMonth,
  shiftMonth,
  stageSpan,
  type CalendarMonthMeta,
} from '../components/calendar/calendarMath';
import { stageColorOf } from '../components/calendar/calendarColors';
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
  covered: boolean;
  coverColor?: string;
}

function buildCalendarGrid(meta: CalendarMonthMeta, entry: ReturnType<typeof computeCalendarEntry>): GridDay[] {
  const first = new Date(meta.year, meta.month - 1, 1);
  const startOffset = mondayFirst(first);
  const start = new Date(meta.year, meta.month - 1, 1 - startOffset);

  const days: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = localIso(d);
    const inMonth = d.getMonth() + 1 === meta.month;
    const covered = inMonth && iso >= entry.bandStart && iso <= entry.bandEnd;
    days.push({
      date: iso,
      day: d.getDate(),
      inMonth,
      isToday: iso === meta.todayIso,
      covered,
      coverColor: covered ? entry.color : undefined,
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
 * 项目月历导出视图：
 * 按 A4 逐月渲染项目阶段在日历上的覆盖，支持打印 / PDF / PNG 导出。
 */
export function CalendarPrintPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === id));
  const stages = useProjectsStore((s) => s.stages.filter((st) => st.projectId === id));
  const members = useMembersStore((s) => s.members);
  const { isAdmin, currentMember, hydrated } = useRoleGuard();

  const [pngBusy, setPngBusy] = useState(false);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

  // 所有 Hook 必须在任何条件提前 return 之前调用完成
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
      return { meta, entry, grid: buildCalendarGrid(meta, entry) };
    });
  }, [project, stages, months, todayIso]);
  const nowIso = new Date().toISOString();
  const nowText = `${nowIso.slice(0, 10)} ${nowIso.slice(11, 16)}`;

  if (!hydrated) {
    return <div className="py-16 text-center text-mist">正在装载月历…</div>;
  }

  if (!isAdmin) {
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
          className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-mist transition-colors hover:bg-sand hover:text-ink"
        >
          <ArrowLeft size={14} /> 返回项目
        </Link>
        <span className="ml-auto" />
        <span className="text-xs text-mist">共 {entries.length} 页 · A4</span>
        <button
          type="button"
          onClick={onPrint}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-mist transition-colors hover:bg-sand hover:text-ink"
        >
          <Printer size={14} /> 打印
        </button>
        <button
          type="button"
          onClick={onExportPdf}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-mist transition-colors hover:bg-sand hover:text-ink"
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
          {/* 页眉 */}
          <div className="mb-4 flex items-baseline justify-between border-b border-slate-200 pb-2">
            <span className="text-[13px] font-semibold text-slate-800">{project.name}</span>
            <span className="text-[11px] text-slate-500">
              {meta.label} · 工期 {project.plannedStartAt.slice(0, 10)} — {project.plannedEndAt.slice(0, 10)}
            </span>
          </div>

          {/* 项目概览 */}
          <div className="mb-4 flex items-center gap-4">
            <div
              className="h-4 w-4 rounded-sm"
              style={{ backgroundColor: entry.color }}
            />
            <div>
              <h1 className="text-xl font-bold text-slate-900">{project.name}</h1>
              <p className="text-xs text-slate-500">
                当前阶段：{entry.activeStage?.name ?? '—'} · 进度 {Math.round(entry.percent)}% · 剩余 {entry.daysRemaining} 天
              </p>
            </div>
          </div>

          {/* 月历网格 */}
          <div className="flex-1">
            <div className="grid grid-cols-7 border border-slate-300 bg-slate-50 text-center text-xs font-medium text-slate-600">
              {WEEKDAYS.map((w) => (
                <div key={w} className="border-r border-slate-200 py-2 last:border-r-0">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 border-x border-b border-slate-300">
              {grid.map((day) => (
                <div
                  key={day.date}
                  className={`relative min-h-[110px] border-r border-b border-slate-200 p-2 last:border-r-0 ${
                    !day.inMonth ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-700'
                  }`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      day.isToday ? 'bg-pine text-white' : ''
                    }`}
                  >
                    {day.day}
                  </span>
                  {day.covered && day.inMonth && (
                    <div
                      className="absolute bottom-2 left-2 right-2 top-8 rounded-sm opacity-80"
                      style={{ backgroundColor: day.coverColor }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 图例 */}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: entry.color }} />
              项目覆盖
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-sm bg-pine" />
              今天
            </span>
          </div>

          {/* 页脚 */}
          <footer className="mt-4 flex items-center justify-between border-t border-slate-200 pt-2 text-[11px] text-slate-500">
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
