/**
 * 旅游客户行程单（打印视图）。
 *
 * ── 为什么单独一页 ──
 *   反馈 #6 要求「给客户排行程表」，并已完成竞品调研后落地旅游二期。
 *   二期落的是**内部**每日行程面板（交通/住宿/预算/实际），适合自己用；
 *   给客户的东西必须能**发出去**：按天列清当天怎么走、住哪、做什么，总量一眼可见。
 *   故这里做一个零写操作的只读打印页（与 `SchedulePrintPage` 同款「新窗口打开 + 打印」）。
 *
 * ── 与内部面板的关系（单一真相源）──
 *   数据全部来自 `itineraries` 表 + `Task.itineraryDate`，**不新增任何存储**。
 *   本页只做「读出来重新排版」，因此内部面板改了什么，行程单自动同步。
 *
 * ── 边界 ──
 *   · 仅 travel 项目可打印：非旅游项目即便手输 /project/:id/itinerary-print 也给出明确说明，
 *     不渲染空表格（避免用户以为「数据丢了」）。
 *   · 打印子树带 `.print-root`，`global.css` 已把它整棵锁回亮色 —— 暗色主题下仍是浅稿。
 *   · 未进入身份（role === null）重定向回首页，与日程表打印页同一守卫口径。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import { Printer } from 'lucide-react';

import type { ItineraryDay } from '../core/types/entities';
import { useRepos } from '../hooks/useRepos';
import { useRoleGuard } from '../hooks/useRoleGuard';
import { effectiveDomainOf, useProjectById } from '../core/project/visibility';
import { dayjs } from '../lib/date';
import { cn } from '../lib/cn';

/** 金额展示：null → `—`（不把 null 打成 ¥0，那会伪造「已确认零花费」） */
function fmtMoney(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

/**
 * 差额展示：负号提到 ¥ **前面**（`-¥60` 而不是 `¥-60`）。
 * 差额是客户最先看的一格，符号位置不对会被读成「币种符号加负号」的口误稿。
 */
function fmtDelta(n: number): string {
  return n < 0 ? `-${fmtMoney(Math.abs(n))}` : fmtMoney(n);
}

export function ItineraryPrintPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const project = useProjectById(id);
  const repos = useRepos();
  const { role, hydrated } = useRoleGuard();

  const [days, setDays] = useState<ItineraryDay[]>([]);
  const [tasks, setTasks] = useState<Array<{ id: string; title: string; itineraryDate: string | null }>>([]);
  const [loading, setLoading] = useState(true);

  const isTravel = project ? effectiveDomainOf(project) === 'travel' : false;

  /**
   * 只读取数（零写入）：与内部面板不同，这里**不调 ensureProjectDays** ——
   * 打印一张单子不应该改动任何数据（用户可能只是打开看看就关掉）。
   */
  useEffect(() => {
    if (!project || !isTravel) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [rows, taskRows] = await Promise.all([
          repos.itineraries.listByProject(project.id),
          repos.tasks.listByProject(project.id),
        ]);
        if (cancelled) return;
        setDays(rows);
        setTasks(
          taskRows.map((t) => ({ id: t.id, title: t.title, itineraryDate: t.itineraryDate ?? null })),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, isTravel, repos]);

  const ordered = useMemo(
    () => [...days].sort((a, b) => a.date.localeCompare(b.date)),
    [days],
  );

  const totals = useMemo(() => {
    const budget = ordered.reduce((sum, d) => sum + (d.budgetAmount ?? 0), 0);
    const actual = ordered.reduce((sum, d) => sum + (d.actualAmount ?? 0), 0);
    const hasAny = ordered.some((d) => d.budgetAmount !== null || d.actualAmount !== null);
    return { budget, actual, hasAny };
  }, [ordered]);

  if (!hydrated) {
    return <div className="py-16 text-center text-mist">正在装载行程单…</div>;
  }
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
  if (!isTravel) {
    return (
      <div className="py-16 text-center text-mist">
        <p className="mb-3">「{project.name}」不是旅游项目，没有客户行程单。</p>
        <Link to={`/project/${project.id}`} className="text-pine underline underline-offset-2">
          ← 返回项目详情
        </Link>
      </div>
    );
  }

  return (
    <div className="print-root mx-auto max-w-4xl bg-paper p-8">
      {/* 工具条：打印按钮本身不进打印稿（print:hidden） */}
      <div className="mb-6 flex items-center justify-end gap-2 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink hover:bg-sunken"
        >
          <Printer size={14} aria-hidden />
          打印 / 导出 PDF
        </button>
        <Link
          to={`/project/${project.id}`}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-mist hover:bg-sunken"
        >
          返回项目
        </Link>
      </div>

      {/* 抬头 */}
      <header className="mb-5 border-b border-line pb-4">
        <h1 className="font-display text-2xl font-semibold text-ink">{project.name}</h1>
        <p className="mt-1.5 text-sm text-mist">
          行程周期：{project.plannedStartAt.slice(0, 10)} — {project.plannedEndAt.slice(0, 10)}
          <span className="ml-3">共 {ordered.length} 天</span>
        </p>
        {totals.hasAny && (
          <p className="mt-2 text-sm text-ink">
            预算合计 <b>{fmtMoney(totals.budget)}</b>
            <span className="mx-3 text-line">|</span>
            实际合计 <b>{fmtMoney(totals.actual)}</b>
            <span className="mx-3 text-line">|</span>
            差额 <b>{fmtDelta(totals.budget - totals.actual)}</b>
          </p>
        )}
      </header>

      {loading ? (
        <p className="py-10 text-center text-mist">正在装载行程单…</p>
      ) : ordered.length === 0 ? (
        <p className="py-10 text-center text-mist">该项目还没有每日行程，请先在项目详情里设置行程。</p>
      ) : (
        <table className="w-full border-collapse text-sm" data-itinerary-print-table="">
          <thead>
            <tr className="border-b border-line text-left text-xs text-mist">
              <th className="w-20 py-2 pr-3 font-medium">日期</th>
              <th className="w-40 py-2 pr-3 font-medium">交通</th>
              <th className="w-44 py-2 pr-3 font-medium">住宿</th>
              <th className="py-2 pr-3 font-medium">当日安排</th>
              <th className="w-24 py-2 pr-3 text-right font-medium">预算</th>
              <th className="w-24 py-2 text-right font-medium">实际</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((day, idx) => {
              const dayTasks = tasks.filter((t) => t.itineraryDate === day.date);
              return (
                <tr key={day.id} data-itinerary-day={day.date} className="border-b border-line align-top">
                  <td className="py-2.5 pr-3 text-ink">
                    <span className="block font-medium">第 {idx + 1} 天</span>
                    <span className="text-xs text-mist">
                      {dayjs(day.date).isValid() ? dayjs(day.date).format('MM-DD') : day.date}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-ink">{day.transport ?? '—'}</td>
                  <td className="py-2.5 pr-3 text-ink">{day.accommodation ?? '—'}</td>
                  <td className="py-2.5 pr-3">
                    {dayTasks.length === 0 ? (
                      <span className="text-mist">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {dayTasks.map((t) => (
                          <li key={t.id} className="text-ink">
                            {t.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={cn('py-2.5 pr-3 text-right text-ink')}>{fmtMoney(day.budgetAmount)}</td>
                  <td className="py-2.5 text-right text-ink">{fmtMoney(day.actualAmount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
