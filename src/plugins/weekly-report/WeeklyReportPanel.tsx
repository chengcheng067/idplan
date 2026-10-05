/**
 * 第三方样板插件 · 项目周报（v0.8.6 阶段 3 · 她 10-04「阶段三推了一并出包」）
 *
 * ── 这个插件是干什么的 ──
 * 它是**第一个「非随包分发」的插件样本**（source: 'member'），用来说明：
 * 装一个别人写的功能是什么样子、开关在哪里、它凭什么被信任（以及**凭什么不被
 * 完全信任**）。
 *
 * ── 功能为什么选「只读摘要」──
 * 安全官对第一个第三方插件的硬约束：**只读**。理由：
 *   ① 只读插件的爆炸半径 = 「它能读到的数据」，而它能读到的只有宿主愿意
 *      通过 `useHumanProjects/Stages/Tasks` 这些**已经按 kind/归属收窄过的**
 *      出口给它的东西——它拿不到 repos、拿不到 window.idplan；
 *   ② 写能力要等能力模型（capability）+ 归属门下沉（F8）都落地后才能开，
 *      那之前任何「能写数据的第三方插件」都是在没有边界的沙箱里跑别人的代码。
 *
 * ── 它**(刻意)不做**的事 ──
 * 不写任何数据、不调 `useRepos()`、不 import 任何 service。这是样板：**下一个
 * 第三方插件作者照抄这个形状就是安全的**。该约束由
 * `tests/third-party-plugin-readonly.spec.ts` 静态钉死（见那个文件）。
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange, FileText } from 'lucide-react';

import { useHumanProjects, useHumanStages, useVisibleTasks } from '../../core/project/visibility';
import { cn } from '../../lib/cn';

/** 本周（自然周）的起止 ISO date——纯函数，无 IO（便于单测/复现） */
function thisWeek(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay() === 0 ? 7 : now.getDay(); // 周一=1 … 周日=7
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  return { from: iso(monday), to: iso(sunday) };
}

function overdue(tasks: ReturnType<typeof useVisibleTasks>): number {
  const today = new Date().toISOString().slice(0, 10);
  return tasks.filter((t) => t.status !== 'done' && (t.dueDate ?? '9999') < today).length;
}

/**
 * 周报面板——**只读**。
 * 	data来自三个已收窄的 hook（kind + 归属），没有别的入口。
 */
export function WeeklyReportPanel(): JSX.Element {
  const projects = useHumanProjects();
  const stages = useHumanStages();
  const tasks = useVisibleTasks('human');
  const week = useMemo(thisWeek, []);
  const [open, setOpen] = useState(true);

  const rows = useMemo(
    () =>
      projects
        .map((p) => {
          const pStages = stages.filter((s) => s.projectId === p.id);
          const pTasks = tasks.filter((t) => t.projectId === p.id);
          const done = pTasks.filter((t) => t.status === 'done').length;
          return {
            id: p.id,
            name: p.name,
            client: p.clientName,
            stageCount: pStages.length,
            taskCount: pTasks.length,
            done,
            overdue: overdue(pTasks),
          };
        })
        .sort((a, b) => b.overdue - a.overdue || b.taskCount - a.taskCount),
    [projects, stages, tasks],
  );

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-pine" aria-hidden />
            <h1 className="text-[20px] font-semibold tracking-tight text-ink">项目周报</h1>
            <span className="font-mono text-[10px] text-mist">member plugin · read-only</span>
          </div>
          <p className="mt-1 text-[13px] text-mist">
            本周 {week.from} → {week.to} · 共 {projects.length} 个进行中项目 ·
            逾期任务 {rows.reduce((n, r) => n + r.overdue, 0)} 条
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="h-8 shrink-0 rounded-md border border-line bg-paper px-3 text-[12px] text-ink outline-none transition-colors hover:bg-sand focus-visible:ring-2 focus-visible:ring-pine/40"
        >
          {open ? '收起明细' : '展开明细'}
        </button>
      </div>

      {!open ? (
        <div className="rounded-lg border border-line bg-paper px-4 py-8 text-center text-[13px] text-mist">
          明细已收起。
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-paper px-4 py-8 text-center text-[13px] text-mist">
          本周还没有进行中的项目。
        </div>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-mist">
              <th className="py-2 pr-4 font-medium">项目</th>
              <th className="py-2 pr-4 font-medium">客户</th>
              <th className="py-2 pr-4 text-right font-medium">阶段</th>
              <th className="py-2 pr-4 text-right font-medium">任务</th>
              <th className="py-2 pr-4 text-right font-medium">已完成</th>
              <th className="py-2 text-right font-medium">逾期</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0">
                <td className="py-2.5 pr-4">
                  <Link
                    to={`/project/${r.id}`}
                    className="text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/40"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="py-2.5 pr-4 text-mist">{r.client || '—'}</td>
                <td className="py-2.5 pr-4 text-right font-mono text-mist">{r.stageCount}</td>
                <td className="py-2.5 pr-4 text-right font-mono text-mist">{r.taskCount}</td>
                <td className="py-2.5 pr-4 text-right font-mono text-pine">{r.done}</td>
                <td
                  className={cn(
                    'py-2.5 text-right font-mono',
                    r.overdue > 0 ? 'text-clay' : 'text-mist',
                  )}
                >
                  {r.overdue}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-6 flex items-center gap-1.5 text-[11px] text-mist">
        <CalendarRange size={12} aria-hidden />
        本面板只读项目数据，不写入、不修改任何内容。
      </p>
    </div>
  );
}
