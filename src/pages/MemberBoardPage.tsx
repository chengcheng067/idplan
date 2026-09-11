import { useMemo } from 'react';

import { useNavigate } from 'react-router-dom';

import { ProjectCard } from '../components/project/ProjectCard';
import { StatCard } from '../components/project/StatCard';
import { useProjectsStore } from '../store/useProjectsStore';
import { useMembersStore } from '../store/useMembersStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUiStore } from '../store/useUiStore';
import { computeProjectStatus } from '../lib/progress';
import { groupByColumn } from './HomePage';
import type { ColumnKey } from './HomePage';
import type { Project, Stage, Task } from '../core/types/entities';
import { StageStatus } from '../core/types/enums';

/**
 * 成员看板（v0.6 · 仅我的相关项目看板）。
 *
 * 权限语义（用户确认的落地方案）：
 *   - 成员登录后除了「我的任务」，也能看到项目进度看板，但**只看到自己参与的项目**
 *     （自己负责的阶段 ownerId 为自己，或参与的任务 taskAssigneeIds 含自己）；
 *   - 看板隐藏成员管理区、隐藏项目卡片的指派参与人控件（成员选项框）；
 *   - 不按客户名搜索（脱敏），沿用首页「only active 项目」口径；
 *   - 项目卡片点开仍走 /project/:id，但详情内成员视角本就只读（TaskChecklist isAdmin 门控）。
 */
export function MemberBoardPage(): JSX.Element {
  const navigate = useNavigate();
  const projects = useProjectsStore((s) => s.projects);
  const stages = useProjectsStore((s) => s.stages);
  const tasks = useProjectsStore((s) => s.tasks);
  const members = useMembersStore((s) => s.members);
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);

  const today = new Date();
  const todayIso = localIso(today);

  const stagesOf = (p: Project): Stage[] => stages.filter((s) => s.projectId === p.id);
  const tasksOf = (p: Project): Task[] => tasks.filter((t) => t.projectId === p.id);

  // 成员仅看自己参与的项目（阶段负责人 或 参与任务的 assigneeIds 含自己）
  const myRelatedProjects = useMemo(() => {
    if (!currentMemberId) return [];
    const relatedProjectIds = new Set<string>();
    for (const s of stages) {
      if (s.ownerId === currentMemberId) relatedProjectIds.add(s.projectId);
    }
    for (const t of tasks) {
      const ids = t.assigneeIds ?? (t.assigneeId ? [t.assigneeId] : []);
      if (ids.includes(currentMemberId)) relatedProjectIds.add(t.projectId);
    }
    return projects.filter((p) => p.status === 'active' && relatedProjectIds.has(p.id));
  }, [projects, stages, tasks, currentMemberId]);

  const active = myRelatedProjects;

  // 看板分桶（列随项目所属行业派生，与首页同一套逻辑）
  const { columns, buckets } = groupByColumn(active, stagesOf, todayIso);

  // 指标卡（仅统计与我相关的 active 项目）
  const weekStart = startOfWeekIso(today);
  const weekEnd = endOfWeekIso(today);
  const monthPrefix = todayIso.slice(0, 7);
  const visibleStages = stages.filter((s) => s.visible !== false);
  const dueThisWeek = visibleStages.filter(
    (s) =>
      s.status !== StageStatus.Completed &&
      s.endAt.slice(0, 10) >= weekStart &&
      s.endAt.slice(0, 10) <= weekEnd,
  ).length;
  const overdueCount = active.filter(
    (p) => computeProjectStatus(p, stagesOf(p), todayIso) === 'overdue',
  ).length;
  const doneThisMonth = visibleStages.filter(
    (s) => s.status === StageStatus.Completed && s.endAt.slice(0, 7) === monthPrefix,
  ).length;

  const openProject = (id: string): void => {
    setSelectedProjectId(id);
    navigate(`/project/${id}`);
  };

  return (
    <div className="flex flex-col gap-4 px-8 py-6 dark:gap-4 dark:px-6 dark:py-4">
      {/* 标题 */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-display-lg">项目看板</h1>
        <span className="text-xs text-mist">仅显示与我相关的项目</span>
      </div>

      {/* 统计概览行 */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard icon="▣" tone="pine" value={active.length} label="进行中项目" trend={null} />
        <StatCard icon="▢" tone="amber" value={dueThisWeek} label="本周到期任务" trend={null} />
        <StatCard icon="▲" tone="clay" value={overdueCount} label="逾期风险" trend={null} />
        <StatCard icon="✓" tone="sage" value={doneThisMonth} label="本月完工" trend={null} />
      </section>

      {/* 四列看板（成员视角：无用户/客户过滤，仅自己相关的项目） */}
      {active.length === 0 ? (
        <div className="glass-light rounded-[16px] border border-dashed border-line p-10 text-center">
          <p className="font-display text-display-md text-mist">还没有与你相关的项目</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-mist">
            当管理员把阶段负责人或参与任务分派给你后，相关项目会出现在这里。
          </p>
        </div>
      ) : (
        <section
          /* 列数与 HomePage 同源（项目所属行业派生），不能写死 grid-cols-4。
             注释放属性位：三元括号内直接写花括号注释是表达式位，会编译错。 */
          className="grid items-start gap-3 sm:gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}
        >
          {columns.map((col) => {
            const items = buckets[col.key] ?? [];
            return (
              <div
                key={col.key}
                className="glass-light flex flex-col gap-3 rounded-3xl p-3.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${col.dot}`} aria-hidden />
                    <span className="text-sm font-semibold text-ink">{col.label}</span>
                  </div>
                  <span
                    className={`rounded-[10px] px-2.5 py-0.5 text-[12px] font-medium ${col.chip}`}
                  >
                    {items.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {items.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      stages={stagesOf(p)}
                      tasks={tasksOf(p)}
                      members={members}
                      todayIso={todayIso}
                      selected={selectedProjectId === p.id}
                      onOpen={() => openProject(p.id)}
                    />
                  ))}
                  {items.length === 0 && (
                    <p className="px-1 py-2 text-xs text-mist">暂无项目</p>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

/* ------------------------------ 日期工具（与 HomePage 同口径，本地时区） ------------------------------ */

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 本周一（周一为一周起点） */
function startOfWeekIso(d: Date): string {
  const day = (d.getDay() + 6) % 7;
  const s = new Date(d);
  s.setDate(d.getDate() - day);
  return localIso(s);
}

/** 本周日 */
function endOfWeekIso(d: Date): string {
  const day = (d.getDay() + 6) % 7;
  const e = new Date(d);
  e.setDate(d.getDate() + (6 - day));
  return localIso(e);
}

// 保持类型出口（v2 起列键由模板声明，不再有固定键序；此处仅为外部引用兼容）
export type { ColumnKey };
