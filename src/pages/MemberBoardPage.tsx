import { useMemo } from 'react';

import { useNavigate } from 'react-router-dom';

import { ProjectCard } from '../components/project/ProjectCard';
import { StatCard } from '../components/project/StatCard';
import { MonthlyCalendarView } from '../components/calendar/MonthlyCalendarView';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { useMembersStore } from '../store/useMembersStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUiStore } from '../store/useUiStore';
import type { MemberBoardView } from '../store/useUiStore';
import {
  useHumanProjects,
  useHumanStages,
  useHumanTasks,
} from '../core/project/visibility';
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
 *
 * ── v0.7 T04 · P0-18 成员只读月历（M1 方案）──
 *   用户决策：「成员能看**月历**，但不给编辑权限」。已核实月历页
 *   （`MonthlyCalendarView` / `MonthDayCell` / `CalendarFilters` / `CalendarEmptyStates`）
 *   **本身零数据写操作**（切月/筛选/选中日期只是 localStorage 偏好，点格子只做
 *   `navigate('/project/:id')` 只读跳转），故成员看不到月历的**唯一原因是路由重定向**
 *   （`HomeRouteGuard` 把成员送到本页）。所以这里只需在**本页（成员的落地页）**
 *   加一个「看板 / 月历」视图切换，权限上不需要新增任何判断分支。
 *
 *   ⚠️ 三条实现纪律（违反任一条即为缺陷，见设计文档 §5.3.3 / §5.6 次高风险）：
 *     ① **`onManual` 必须传 `undefined`**：`CalendarEmptyStates` 的 E1 空状态里有
 *        「直接手动建档」CTA，其渲染条件是 `onManual` **有值**（`{onManual && …}`）。
 *        传 `undefined` 后按钮与其包裹层**整体不渲染** —— 成员在空状态里既看不到、
 *        也点不到「新建项目」的同类入口（首页 `HomePage` 传的是 `openManual`，本页**不能**跟）。
 *        ⚠️ 口径更正（勿按旧注释误读）：初版误以为「`onManual=undefined` 只让按钮失效、
 *        按钮仍会画出来」，并据此把这个**死按钮**当成可接受项 —— **那是错的**（E1 的触发
 *        条件正是「与我相关的 active 项目 = 0」，刚被拉进项目的新成员最常看到它，一个
 *        `variant="primary"` 的主按钮点了毫无反应属必现观感缺陷）。已由 team-lead 复审
 *        定性并修正 `CalendarEmptyStates` 的 E1 分支为条件渲染。
 *        现口径：**E1 的 CTA 不渲染**，验收直接断言「该文本不存在」（而非「点了无效」）。
 *     ② **绝不向 `MonthlyCalendarView` 传任何项目/阶段/任务数据**：
 *        它内部（见其 `baseEntries` 的 memo）自己用 `isRestrictedView(role)` +
 *        `computeRelatedStageIds` 过滤，读的是**全局 store**。在调用方再传一份
 *        会形成「两份过滤」；若传成全部项目就是**权限泄漏**（成员看到不属于自己的项目）。
 *        故本页只传 `onManual`，其余一概不传。
 *     ③ **跳过看板区渲染**：`calendar` 档只渲染一份数据视图，避免两棵重树同时挂载。
 *        统计卡行（下方 section）两档共用、保留 —— 它统计的已经是「我的相关项目」。
 */
export function MemberBoardPage(): JSX.Element {
  const navigate = useNavigate();
  /*
    ★★ v0.8 T04-A · §7.2 #15 接线（**Pid** 接法）—— 设计文档把这个点标为
    「**关键漏点**」，是全表 27 项里风险最高的一处。原因值得写下来：

    本页的"只看到自己参与的项目"判定，数据源是 **`stages.ownerId`** 与
    **`tasks.assigneeIds`**，然后才去 `projects` 里按 id 反查。也就是说：
      ① 若 `projects` 不过滤 ⇒ Agent 看板会进候选（但还有 ② 的下游过滤兜着）；
      ② 若 `stages` / `tasks` **不过滤** ⇒ **AI 把任务 `assigneeHuman` 指给某个成员时，
         该 Agent 看板会被判定为"与我相关"**，于是**整个 Agent 看板出现在成员看板里**
         —— 而且它看起来完全正常（成员确实被指派了那个任务），**不报错、无异常**。
         这就是"★关键漏点"的确切含义：过滤漏在最上游的两个数据源上。

    所以三行**必须全部**改：只改 `projects` 是**不够的**（② 会漏），
    只改 `stages`/`tasks` 也不够（① 会在统计卡 `active.length` 上漏）。

    ⚠️ 本页对 `MonthlyCalendarView` **只传 `onManual`**（下方既有注释的三条纪律之二：
    绝不向它传任何项目/阶段/任务数据）。本页改成漏斗后，月历内部那份过滤**照旧**
    走它自己的 `useHuman*` —— 两处口径同源（都来自 `visibility.ts`），不会打架。
  */
  const projects = useHumanProjects();
  const stages = useHumanStages();
  const tasks = useHumanTasks();
  const members = useMembersStore((s) => s.members);
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  // 视图模式偏好（独立持久化键 idplan.memberBoardView，**不复用**管理员首页的 idplan.homeView）
  const memberBoardView = useUiStore((s) => s.memberBoardView);
  const setMemberBoardView = useUiStore((s) => s.setMemberBoardView);

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

  const isCalendar = memberBoardView === 'calendar';

  return (
    <div className="flex flex-col gap-4 px-8 py-6 dark:gap-4 dark:px-6 dark:py-4">
      {/* 标题行 + 视图切换（P0-18）
          切换控件用既有 SegmentedControl 的 lg 档，与首页 `HomePage.tsx` 的
          「首页视图切换」同款（同一控件、同一档位、只是 ariaLabel 与绑定的 key 不同）。 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-display-lg">项目看板</h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-mist">仅显示与我相关的项目</span>
          <SegmentedControl<MemberBoardView>
            size="lg"
            ariaLabel="成员看板视图切换"
            value={memberBoardView}
            onChange={setMemberBoardView}
            options={[
              { value: 'kanban', label: '看板' },
              { value: 'calendar', label: '月历' },
            ]}
          />
        </div>
      </div>

      {/* 统计概览行（两档共用；口径已是「与我相关的 active 项目」） */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard icon="▣" tone="pine" value={active.length} label="进行中项目" trend={null} />
        <StatCard icon="▢" tone="amber" value={dueThisWeek} label="本周到期任务" trend={null} />
        <StatCard icon="▲" tone="clay" value={overdueCount} label="逾期风险" trend={null} />
        <StatCard icon="✓" tone="sage" value={doneThisMonth} label="本月完工" trend={null} />
      </section>

      {/* ④ 数据视图：看板 / 月历 **二选一**（只挂载一份，避免两棵重树同时在树上）
          ⚠️ 月历只传 onManual，且必须传 undefined —— E1 的「直接手动建档」CTA 是
             `{onManual && …}` 条件渲染的：undefined ⇒ 按钮**整体不画**（成员既看不到、
             也点不到，不是「画出来但失效」）；
             **不传任何项目/阶段/任务数据**，过滤在 MonthlyCalendarView 内部完成。 */}
      {isCalendar ? (
        <MonthlyCalendarView onManual={undefined} />
      ) : active.length === 0 ? (
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
