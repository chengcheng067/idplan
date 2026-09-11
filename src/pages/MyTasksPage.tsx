import { useMemo, useState } from 'react';

import { Link } from 'react-router-dom';

import { Check } from 'lucide-react';

import { useProjectsStore } from '../store/useProjectsStore';
import { createTaskActions } from '../store/useProjectsStore';
import { useMembersStore } from '../store/useMembersStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useRepos } from '../hooks/useRepos';
import { taskAssigneeIds } from '../hooks/useRoleGuard';
import { cn } from '../lib/cn';
import { remainingDays } from '../lib/date';
import { StatCard } from '../components/project/StatCard';
import { STAGE_BAR_COLORS } from '../components/timeline/stageColors';
import type { Project, Stage, Task } from '../core/types/entities';
import { taskIsDone } from '../core/types/entities';
import { resolveStageColorIndex } from '../core/template/stage-fallback';

type FilterMode = 'by-project' | 'by-time';

/**
 * 我的任务（v0.4.1 视觉重做，对齐首页玻璃体系）：
 *   - 顶部统计概览（今天到期 / 已逾期 / 7 天内 / 未完成总数），复用首页 StatCard；
 *   - 控件改为参考稿形态（圆角12 容器 + 半透明蓝胶囊选中），去掉原生 checkbox；
 *   - 分组容器与任务行改为玻璃卡片（圆角16 / 12），行首带阶段色条；
 *   - 容器去掉 max-w-3xl，与首页 1600 宽体系一致。
 */
export function MyTasksPage(): JSX.Element {
  const repos = useRepos();
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  const members = useMembersStore((s) => s.members);
  const projects = useProjectsStore((s) => s.projects);
  const stages = useProjectsStore((s) => s.stages);
  const allTasks = useProjectsStore((s) => s.tasks);

  const [filter, setFilter] = useState<FilterMode>('by-project');
  const [showDone, setShowDone] = useState(false);

  const me = members.find((m) => m.id === currentMemberId) ?? null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const actions = createTaskActions(repos);
  const operatorName = me?.name ?? '未知';

  // 参与人包含语义（taskAssigneeIds 回落旧数据 assigneeId）
  const allMyTasks = useMemo(
    () =>
      currentMemberId
        ? allTasks.filter((t) => taskAssigneeIds(t).includes(currentMemberId))
        : [],
    [allTasks, currentMemberId],
  );
  const myTasks = useMemo(
    () => allMyTasks.filter((t) => showDone || !taskIsDone(t)),
    [allMyTasks, showDone],
  );

  const projectOf = (t: Task): Project | undefined => projects.find((p) => p.id === t.projectId);
  const stageOf = (t: Task): Stage | undefined => stages.find((s) => s.id === t.stageId);

  /** 统计概览（只统计未完成，口径与列表一致） */
  const stats = useMemo(() => {
    let today = 0;
    let overdue = 0;
    let week = 0;
    let undone = 0;
    for (const t of allMyTasks) {
      if (taskIsDone(t)) continue;
      undone += 1;
      if (!t.dueDate) continue;
      const d = remainingDays(t.dueDate.slice(0, 10), todayIso);
      if (d < 0) overdue += 1;
      else if (d === 0) today += 1;
      else if (d <= 7) week += 1;
    }
    return { today, overdue, week, undone };
  }, [allMyTasks, todayIso]);

  /** 按时间过滤：逾期 / 今天 / 7天内 / 更晚 */
  const groupedByTime = useMemo(() => {
    const groups: Record<string, Task[]> = { 已逾期: [], 今天: [], '7 天内': [], 更晚: [] };
    for (const t of myTasks) {
      if (!t.dueDate) {
        groups['更晚'].push(t);
        continue;
      }
      const d = remainingDays(t.dueDate.slice(0, 10), todayIso);
      if (d < 0) groups['已逾期'].push(t);
      else if (d === 0) groups['今天'].push(t);
      else if (d <= 7) groups['7 天内'].push(t);
      else groups['更晚'].push(t);
    }
    return Object.entries(groups).filter(([, rows]) => rows.length > 0);
  }, [myTasks, todayIso]);

  return (
    <div className="flex flex-col gap-6 px-8 py-6 dark:gap-4 dark:px-6 dark:py-4">
      {/* 标题 + 副标题 */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-display-lg">我的任务</h1>
        <span className="text-xs text-mist">只显示与我相关的内容</span>
      </div>

      {/* 分组方式 tab + 显示已完成（独立一行：tab 左、过滤右，手机不再挤在标题旁换行错乱） */}
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="任务分组方式"
          className="flex items-center gap-1 rounded-[12px] border border-line bg-cream/60 p-1"
        >
          {(
            [
              { key: 'by-project' as const, label: '按项目' },
              { key: 'by-time' as const, label: '按时间' },
            ]
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              role="tab"
              aria-selected={filter === o.key}
              onClick={() => setFilter(o.key)}
              className={cn(
                'rounded-[9px] px-3.5 py-2 text-sm font-medium transition-colors',
                filter === o.key ? 'bg-pine-soft text-pine' : 'text-mist hover:bg-sand hover:text-ink',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* 显示已完成（自定义胶囊，替换原生 checkbox） */}
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          aria-pressed={showDone}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs transition-colors',
            showDone
              ? 'border-pine bg-pine-soft text-pine'
              : 'border-line text-mist hover:bg-sand hover:text-ink',
          )}
        >
          {showDone ? '已含已完成' : '显示已完成'}
        </button>
      </div>

      {/* 统计概览（手机单列、平板双列、桌面四列，与首页统计行一致） */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard icon="▢" tone="pine" value={stats.today} label="今天到期" trend={null} />
        <StatCard icon="▲" tone="clay" value={stats.overdue} label="已逾期" trend={null} />
        <StatCard icon="▣" tone="amber" value={stats.week} label="7 天内" trend={null} />
        <StatCard icon="✓" tone="sage" value={stats.undone} label="未完成总数" trend={null} />
      </section>

      {/* 未选身份引导 */}
      {!currentMemberId && (
        <div className="glass-light rounded-[16px] border border-dashed border-line p-10 text-center">
          <p className="text-sm leading-6 text-mist">
            请点击右上角「进入身份」输入你的姓名；
            <br />
            若系统还没有管理员，请先让管理员完成首次设置后再进入。
          </p>
        </div>
      )}

      {/* 空态 */}
      {currentMemberId && myTasks.length === 0 && (
        <div className="glass-light rounded-[16px] border border-dashed border-line p-10 text-center">
          <p className="font-display text-display-md text-mist">
            {me ? `${me.name}，目前没有分配给你的待办 🎉` : '未找到该身份。'}
          </p>
        </div>
      )}

      {/* 按项目 */}
      {currentMemberId &&
        filter === 'by-project' &&
        Object.entries(
          myTasks.reduce<Record<string, Task[]>>((acc, t) => {
            (acc[t.projectId] ??= []).push(t);
            return acc;
          }, {}),
        ).map(([projectId, rows]) => {
          const p = projects.find((x) => x.id === projectId);
          const overdueCount = rows.filter(
            (t) => !taskIsDone(t) && t.dueDate && remainingDays(t.dueDate.slice(0, 10), todayIso) < 0,
          ).length;
          return (
            <section key={projectId} className="glass-light rounded-[16px] border border-line p-3.5">
              <h2 className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-pine" aria-hidden />
                {p ? (
                  <Link
                    to={`/project/${p.id}`}
                    className="font-display text-display-md transition-colors hover:text-pine"
                  >
                    {p.name}
                  </Link>
                ) : (
                  <span className="font-display text-display-md text-mist">（未知项目）</span>
                )}
                <span className="rounded-[10px] bg-sand px-2.5 py-0.5 text-[12px] font-medium text-mist">
                  {rows.length}
                </span>
                {overdueCount > 0 && (
                  <span className="rounded-[10px] bg-clay-soft px-2.5 py-0.5 text-[12px] font-medium text-clay">
                    逾期 {overdueCount}
                  </span>
                )}
              </h2>
              <ul className="flex flex-col gap-1.5">
                {[...rows]
                  .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
                  .map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      project={projectOf(t)}
                      stage={stageOf(t)}
                      todayIso={todayIso}
                      onToggle={() => void actions.toggleDone(t, operatorName)}
                    />
                  ))}
              </ul>
            </section>
          );
        })}

      {/* 按时间 */}
      {currentMemberId &&
        filter === 'by-time' &&
        groupedByTime.map(([groupLabel, rows]) => (
          <section key={groupLabel} className="glass-light rounded-[16px] border border-line p-3.5">
            <h2 className="mb-2 flex items-center gap-2">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  groupLabel === '已逾期' ? 'bg-clay' : groupLabel === '今天' ? 'bg-pine' : 'bg-mist',
                )}
                aria-hidden
              />
              <span className="font-display text-display-md">{groupLabel}</span>
              <span className="rounded-[10px] bg-sand px-2.5 py-0.5 text-[12px] font-medium text-mist">
                {rows.length}
              </span>
            </h2>
            <ul className="flex flex-col gap-1.5">
              {rows.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  project={projectOf(t)}
                  stage={stageOf(t)}
                  todayIso={todayIso}
                  onToggle={() => void actions.toggleDone(t, operatorName)}
                />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

/** 任务卡片（玻璃小卡 + 行首阶段色条；点击卡片体可跳转所属项目） */
function TaskCard({
  task,
  project,
  stage,
  todayIso,
  onToggle,
}: {
  task: Task;
  project: Project | undefined;
  stage: Stage | undefined;
  todayIso: string;
  onToggle(): void;
}): JSX.Element {
  const days = task.dueDate ? remainingDays(task.dueDate.slice(0, 10), todayIso) : null;
  const overdue = days !== null && days < 0;
  const stageColor = stage
    ? STAGE_BAR_COLORS[resolveStageColorIndex(stage.orderIndex, stage.colorIndex)] ?? STAGE_BAR_COLORS[9]
    : STAGE_BAR_COLORS[9];

  return (
    <li className="glass-medium flex items-center gap-2.5 overflow-hidden rounded-[12px] border border-line p-2.5">
      {/* 行首阶段色条 */}
      <span
        className="h-7 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: stageColor }}
        aria-hidden
      />

      <button
        type="button"
        onClick={onToggle}
        aria-label={taskIsDone(task) ? '标记未完成' : '标记完成'}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
          taskIsDone(task)
            ? 'border-pine bg-pine text-white'
            : 'border-mist/50 text-transparent hover:border-pine',
        )}
      >
        <Check size={12} />
      </button>

      <div className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm', taskIsDone(task) ? 'text-mist line-through' : 'text-ink')}>
          {task.title}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-mist">
          {project && <span className="truncate">{project.name}</span>}
          {stage && (
            <span className="shrink-0">
              {['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'][stage.orderIndex - 1]} {stage.name}
            </span>
          )}
        </span>
      </div>

      {days !== null && (
        <span
          className={cn(
            'shrink-0 text-right text-xs tabular-nums',
            overdue ? 'text-clay' : days <= 3 ? 'text-amber-deep' : 'text-mist',
          )}
        >
          {overdue ? `逾期${Math.abs(days)}天` : days === 0 ? '今天到期' : `${days} 天`}
        </span>
      )}
    </li>
  );
}

// 保持 Stage 类型引用（上方泛型注释用）
export type { Project, Stage };
