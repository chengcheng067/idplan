import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';

import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { ProjectCard } from '../components/project/ProjectCard';
import { StatCard } from '../components/project/StatCard';
import { MonthlyCalendarView } from '../components/calendar/MonthlyCalendarView';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { useMembersStore } from '../store/useMembersStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUiStore } from '../store/useUiStore';
import type { MemberBoardView } from '../store/useUiStore';
import {
  resolveMemberBoardSubject,
  taskAssigneeIds,
  useRoleGuard,
} from '../hooks/useRoleGuard';
import {
  useHumanProjects,
  useHumanStages,
  useHumanTasks,
} from '../core/project/visibility';
import { computeProjectStatus } from '../lib/progress';
import { groupByColumn } from './HomePage';
import type { ColumnKey } from './HomePage';
import type { Member, Project, Stage, Task } from '../core/types/entities';
import { taskIsDone } from '../core/types/entities';
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
  const { isAdmin, isMember } = useRoleGuard();
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  // 视图模式偏好（独立持久化键 idplan.memberBoardView，**不复用**管理员首页的 idplan.homeView）
  const memberBoardView = useUiStore((s) => s.memberBoardView);
  const setMemberBoardView = useUiStore((s) => s.setMemberBoardView);

  /*
    ★ 0.8.6.0002 反馈 #5「搜索成员直达看板」的接线点。

    「看谁」由 URL 参数 `?member=<id>` 决定（管理员视角），无参数时看自己 —— 即
    本页**今天**的行为逐字不变（成员登录后的落地页正是无参这一支）。解析收口在
    `useRoleGuard.resolveMemberBoardSubject`（权限判定一律经该 hook，不在此处自造）：

      · 管理员 + ?member=朴彩英  → 看朴彩英的相关项目与任务（搜索框/成员面板点进来）；
      · 成员身份 + ?member=别人  → denied ⇒ 下方 `<Navigate>` 剥掉参数回她自己（隐私边界）；
      · 管理员 + ?member=不存在  → missing ⇒ 显式空态（不静默回落成看自己）。

    为什么用 URL 参数而不是给 useUiStore 加「当前查看的成员」：深链可分享、
    刷新/返回键行为自然，且瞬态 store 一刷新就错——那是把导航目标当成 UI 状态。
  */
  const [searchParams] = useSearchParams();
  const subject = useMemo(
    () =>
      resolveMemberBoardSubject({
        memberParam: searchParams.get('member'),
        isAdmin,
        currentMemberId,
        members,
      }),
    [searchParams, isAdmin, currentMemberId, members],
  );
  // 观看对象：member 支 = 管理员看指定成员；self 支 = 自己（currentMemberId 可能为 null）
  const viewedMember: Member | null = subject.kind === 'member' ? subject.member : null;
  const viewedMemberId = subject.kind === 'member' ? subject.member.id : currentMemberId;

  const today = new Date();
  const todayIso = localIso(today);

  const stagesOf = (p: Project): Stage[] => stages.filter((s) => s.projectId === p.id);
  const tasksOf = (p: Project): Task[] => tasks.filter((t) => t.projectId === p.id);

  // 成员仅看自己参与的项目（阶段负责人 或 参与任务的 assigneeIds 含自己）
  // 反馈 #5 起「自己」= 观看对象（管理员看指定成员时即该成员，口径同一表达式）
  const myRelatedProjects = useMemo(() => {
    if (!viewedMemberId) return [];
    const relatedProjectIds = new Set<string>();
    for (const s of stages) {
      if (s.ownerId === viewedMemberId) relatedProjectIds.add(s.projectId);
    }
    for (const t of tasks) {
      const ids = t.assigneeIds ?? (t.assigneeId ? [t.assigneeId] : []);
      if (ids.includes(viewedMemberId)) relatedProjectIds.add(t.projectId);
    }
    return projects.filter((p) => p.status === 'active' && relatedProjectIds.has(p.id));
  }, [projects, stages, tasks, viewedMemberId]);

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

  /*
    ★ 0.8.6.0003 · 反馈「成员看板左上角没有返回键」的落点。

    她的原话：「我需要再点击左侧边栏的项目或其他位置，才能触达上一步」——
    站内其他页（项目详情）的返回在 TopBar 面包屑（`navigate(-1)`），而本页的
         面包屑只是静态文字（TopBar 的 STATIC_CRUMB 无返回箭），<768 连面包屑都不
         渲染 ⇒ 成员的回程只剩侧栏，她认为「整体交互有问题」。

    返回语义（定版，commit message 里同步说明理由）：
      ① **有会话历史**（`history.state.idx > 0`）⇒ `navigate(-1)`：与 TopBar
         项目详情的返回箭**逐字同口径**（同一个行为，不是第二套）。从项目详情/
         我的任务点进来 ⇒ 回到来的那页；管理员从首页搜索命中/成员行「看板」点
         进来（`?member=<id>`）⇒ 回到的正是首页——她的主路径无需特殊分支。
      ② **无会话历史**（`idx = 0`：直接深链 `/member-board`、刷新即落地、
         Electron 冷启动落在本页）⇒ 按身份分流兜底：
            · 管理员 / 未进入身份 ⇒ `/`（首页：搜索框与成员列表都在那里，
              是 `?member=` 深链的「逻辑来处」）；
            · 成员 ⇒ `/my-tasks`。**不能**回 `/`：HomeRouteGuard 把成员在 `/`
              的重定向回本页，点返回＝原地打转，会被读成「按钮坏了」；我的任务是
              成员除本页外的另一个主页面（侧栏对成员只有「看板 / 我的任务」）。
    为什么不放进 TopBar：反馈指定的是**标题行**；且 TopBar 的返回箭是面包屑的
    组成部分，给静态路由加箭会同时改变首页/我的任务/Agent 看板的顶栏形态——
    超出本条反馈的范围，留待全局导航决策。
  */
  const goBack = (): void => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
      return;
    }
    navigate(isMember ? '/my-tasks' : '/');
  };

  const isCalendar = memberBoardView === 'calendar';

  /*
    两个「到此为止」分支放在**所有 hook 之后**（hook 顺序铁律），语义见
    `resolveMemberBoardSubject` 的注释：
      · denied（成员身份带 ?member=）→ 剥掉参数回她自己，**不展示别人的任何数据**；
      · missing（管理员深链到已删除的成员）→ 显式空态，不静默回落成看自己。
  */
  if (subject.kind === 'denied') {
    return <Navigate to="/member-board" replace />;
  }
  if (subject.kind === 'missing') {
    return (
      <div className="flex flex-col gap-4 px-8 py-6 dark:gap-4 dark:px-6 dark:py-4">
        <div className="glass-light rounded-[16px] border border-dashed border-line p-10 text-center">
          <p className="font-display text-display-md text-mist">找不到该成员</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-mist">
            这个看板链接指向的成员已不存在（可能被删除）。可以返回成员看板查看自己的项目。
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => navigate('/member-board')}>
            返回成员看板
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-8 py-6 dark:gap-4 dark:px-6 dark:py-4">
      {/* 标题行 + 视图切换（P0-18）
          切换控件用既有 SegmentedControl 的 lg 档，与首页 `HomePage.tsx` 的
          「首页视图切换」同款（同一控件、同一档位，只是 ariaLabel 与绑定的 key 不同）。
          反馈 #5：管理员看指定成员时，标题即该成员的名字（她的预期是「这个成员的任务排表」，
          不是一个名叫「项目看板」的页面）；无参自己看的文案逐字不变。

          v0.8.6.0003 · 反馈「左上角没有返回键」：标题行补返回钮（‹ 图标 + 语义见
          `goBack` 注释）。视觉逐字复用 TopBar 面包屑返回箭的类（同一控件家族：
          h-7 w-7 rounded-md text-mist hover:bg-sand），不引新视觉语言。 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={goBack}
            aria-label="返回上一页"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-mist outline-none transition-colors hover:bg-sand hover:text-ink focus-visible:ring-2 focus-visible:ring-pine/40"
          >
            <ArrowLeft size={18} aria-hidden />
          </button>
          <h1 className="font-display text-display-lg">
            {viewedMember ? `${viewedMember.name} 的项目看板` : '项目看板'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-mist">
            {viewedMember
              ? `管理员视角 · 仅显示与「${viewedMember.name}」相关的项目与任务`
              : '仅显示与我相关的项目'}
          </span>
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

      {/* 统计概览行（两档共用；口径已是「观看对象的 active 项目」）
          v0.8.6.0002 · 反馈 #10.4：改回与 HomePage 逐字同款的 flex-wrap 行。
          此前这里是 grid-cols-2/lg:grid-cols-4，与 StatCard 自身断点（md 半宽 /
          xl flex-1）错配——lg 档（1024–1279）每张卡只有半格宽（实测 126px），
          数字和标签被挤瘪。StatCard 的设计口径就是「flex-wrap + flex 1 1 基准宽」，
          按它本来姿势用即修复，且与首页统计行严格一致。 */}
      <section className="flex flex-wrap gap-5">
        <StatCard icon="▣" tone="pine" value={active.length} label="进行中项目" trend={null} />
        <StatCard icon="▢" tone="amber" value={dueThisWeek} label="本周到期任务" trend={null} />
        <StatCard icon="▲" tone="clay" value={overdueCount} label="逾期风险" trend={null} />
        <StatCard icon="✓" tone="sage" value={doneThisMonth} label="本月完工" trend={null} />
      </section>

      {/*
        ★ 反馈 #5 的核心增量：成员任务三块（进行中 / 已逾期 / 近期完成）。

        她的原话：「我肯定就想看这个成员的任务排表，包括他近期完成了哪些任务、
        还有哪些任务」。本页此前只有**项目级**看板与统计卡，任务粒度一片空白——
        这三块就是补上的那一块。口径（与「我的任务」页同源，不发明第二套语义）：
          · 范围 = `taskAssigneeIds` 含观看对象（多人任务的任一参与人都算），
            数据仍走 `useHumanTasks()` 漏斗（Agent 看板任务不会混进来）；
          · 已逾期 = 未完成且到期日早于今天（最该被管理员看见的一块，排最左）；
          · 进行中 = 未完成且未逾期（「还有哪些任务」的主体）；
          · 近期完成 = 已完成且到期日在最近 30 天内（无到期日的也算，排尾）。
        仅看板档渲染：月历档是另一套数据视图（V1-26 纪律：只挂一棵数据树）。

        v0.8.6.0003 · 反馈「宽窗空白」：列几何从 `lg:grid-cols-3`（3×1fr 无限拉伸，
        1920 实测每列 448px）改为与看板列**同款**的 BOARD_COLUMN_TEMPLATE
        （基准 340 / 上限 360 / auto-fit 换行 + justify-center 居中消化余量）——
        同一页两处列几何必须同源，否则「看板列收窄了、任务块还抻着」更难看。
      */}
      {!isCalendar && (
        <MemberTaskTriage
          tasks={tasks}
          projects={projects}
          stages={stages}
          memberId={viewedMemberId}
          todayIso={todayIso}
          onOpenProject={openProject}
        />
      )}

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
             注释放属性位：三元括号内直接写花括号注释是表达式位，会编译错。

             v0.8.6.0002 · 反馈 #10.4：列基准 260→340。260 是「与卡片设计宽度
             脱节」的旧值——ProjectCard 的 340 是首页 3 列布局的校准基准
             （见 ProjectCard.tsx 注释），列窄于它，卡内标题/进度条/头像行/Tag
             全在超设计宽度下运行（实测 1152–1024 档卡片被压到 105–130px：
             标题截断、Tag 逐字竖绕、头像行报废）。340 下桌面 3 列、
             卡片≈340，与首页卡宽同一量级。

             v0.8.6.0003 · 反馈「宽窗空白」：列上限 360 + auto-fit 换行 +
             justify-center 居中消化余量（旧 1fr 会把 3 列抻到 448px，比设计宽
             32%，列内容顶对齐 ⇒ 大片空洞）。列几何与任务三块同源，见
             BOARD_COLUMN_TEMPLATE 注释。 */
          className="grid items-start justify-center gap-3 sm:gap-4"
          style={{ gridTemplateColumns: BOARD_COLUMN_TEMPLATE }}
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
                      /* v0.8.6.0002 · 反馈 #10.4：列内堆叠档——卡片宽度撑满列、
                         高度只走固定档，不吃首页 flex-wrap 行的 flex-basis/半宽类
                         （那些类在 flex-col 列里分别把卡片抅高、压窄，见 ProjectCard.tsx） */
                      layout="column"
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

/**
 * 看板列与「任务三块」共用的列几何（v0.8.6.0003 · 反馈「窗口拉宽后看板空白太多」）。
 *
 * 她的截图（宽窗）：看板列被横向拉得很宽、列内容顶对齐、下半大片空白。
 * 根因：列模板是 `minmax(min(100%, 340px), 1fr)`——`1fr` 让轨道**无限拉伸**：
 * 1440 以上 main 封顶 1440 ⇒ section ≤1376，只放得下 3 条 340 轨道，于是 3 列
 * 各分到 448px（1920 实测），比 ProjectCard 的设计宽 340 宽出 32%，卡片跟着被
 * 抻宽；列内内容不随宽度增长 ⇒ 又宽又空。
 *
 * 新几何（三段都有出处，不是拍脑袋）：
 *   · 基准 340 = ProjectCard 设计宽（首页 3 列布局的校准基准，见 ProjectCard.tsx
 *     注释；列窄于它，卡内标题/进度条/头像行/Tag 全在超设计宽度下运行——
 *     反馈 #10.4 的实测教训：105–130px 窄卡全面报废）；
 *   · 上限 360 = 宽窗时列**不无限拉伸**（360 下卡片 ≈332，贴设计宽；再宽就是空洞）；
 *   · auto-fit = 列数随容器宽度换行，与首页 ProjectCard 的 flex-wrap 同源，
 *     不写死列数（列集合由项目所属行业派生，见 deriveColumns）；
 *   · min(100%, …) = 容器窄于基准时坍缩为 100%（手机单列，不被 340 撑破）；
 *   · 横向余量由外层 grid 的 `justify-center` **居中消化**——刻意不用「拉伸卡片
 *     高度填满列高」那种糊法（产品负责人明令禁止；等高是数据该有的样子，不是排版）。
 */
const BOARD_COLUMN_TEMPLATE = 'repeat(auto-fit, minmax(min(100%, 340px), 360px))';

/* ------------------------------ 成员任务三块（反馈 #5） ------------------------------ */

/**
 * 「近期完成」的窗口（天）：到期日在最近 30 天内算近期。
 * 说明：Task 没有完成时刻字段（`taskIsDone` 只看 status），**不发明**新字段，
 * 以到期日作近似口径——任务通常临近截止日完工，这与统计卡「本月完工」用
 * stage.endAt 是同源的务实取舍。无到期日的已完成任务也纳入（排尾），
 * 否则「明明做完了却像没做」。
 */
const RECENT_DONE_DAYS = 30;

/** 「近期完成」最多列几条（避免长历史把看板撑爆）；超出时末尾提示「另有 N 条」 */
const DONE_PREVIEW_LIMIT = 10;

/** 到期日归一：ISO datetime 也截到自然日；无到期日返回 null */
function dueOf(t: Task): string | null {
  return t.dueDate ? t.dueDate.slice(0, 10) : null;
}

/** 日期 ±N 天（本地时区，与页内其余日期工具同口径） */
function isoShiftDays(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return localIso(d);
}

/** 三块的徽标配色（全部既有 token：clay/pine/stage-s1，不引新色） */
const GROUP_TONE = {
  clay: { dot: 'bg-clay', chip: 'bg-clay-soft text-clay' },
  pine: { dot: 'bg-pine', chip: 'bg-pine-soft text-pine' },
  // 灰绿复用九段 stage.s1（与 StatCard 的 sage 同一处理，避免新增配色体系）
  sage: { dot: 'bg-stage-s1', chip: 'bg-stage-s1/15 text-stage-s1' },
} as const;

/**
 * 成员任务三块：已逾期 / 进行中 / 近期完成（互斥穷尽，同一任务只进一块）。
 *
 * 行点击 → 打开该项目（与看板卡片、月历色带同一落点 `openProject`）。
 * 行内信息尽量说人话：任务名 + 所属项目 · 阶段 · 到期日（逾期有徽标）。
 */
function MemberTaskTriage({
  tasks,
  projects,
  stages,
  memberId,
  todayIso,
  onOpenProject,
}: {
  tasks: Task[];
  projects: Project[];
  stages: Stage[];
  memberId: string | null;
  todayIso: string;
  onOpenProject(projectId: string): void;
}): JSX.Element | null {
  const buckets = useMemo(() => {
    const overdue: Task[] = [];
    const ongoing: Task[] = [];
    const done: Task[] = [];
    if (!memberId) return { overdue, ongoing, done };
    const mine = tasks.filter((t) => taskAssigneeIds(t).includes(memberId));
    const cutoff = isoShiftDays(todayIso, -RECENT_DONE_DAYS);
    for (const t of mine) {
      const due = dueOf(t);
      if (taskIsDone(t)) {
        if (!due || due >= cutoff) done.push(t);
        continue;
      }
      if (due && due < todayIso) overdue.push(t);
      else ongoing.push(t);
    }
    const byDueAsc = (a: Task, b: Task): number => {
      const da = dueOf(a);
      const db = dueOf(b);
      if (da && db) return da < db ? -1 : da > db ? 1 : 0;
      if (da) return -1;
      if (db) return 1;
      return 0;
    };
    const byDueDesc = (a: Task, b: Task): number => -byDueAsc(a, b);
    overdue.sort(byDueAsc);
    ongoing.sort(byDueAsc);
    done.sort(byDueDesc);
    return { overdue, ongoing, done };
  }, [tasks, memberId, todayIso]);

  // 未进入身份（无观看对象）时整块不渲染：不画一个三个「暂无」的空架子
  if (!memberId) return null;

  const projectOf = (t: Task): Project | undefined => projects.find((p) => p.id === t.projectId);
  const stageOf = (t: Task): Stage | undefined => stages.find((s) => s.id === t.stageId);
  const doneHidden = Math.max(0, buckets.done.length - DONE_PREVIEW_LIMIT);

  return (
    <section
      /* v0.8.6.0003 · 反馈「宽窗空白」：三块列几何与看板列同源（BOARD_COLUMN_TEMPLATE），
         宽窗不拉伸到 448、窄窗 auto-fit 换行、余量 justify-center 居中消化。 */
      className="grid items-start justify-center gap-3 sm:gap-4"
      style={{ gridTemplateColumns: BOARD_COLUMN_TEMPLATE }}
    >
      <TaskGroup
        label="已逾期"
        tone={GROUP_TONE.clay}
        rows={buckets.overdue}
        todayIso={todayIso}
        emptyText="没有逾期的任务"
        onOpenProject={onOpenProject}
        projectOf={projectOf}
        stageOf={stageOf}
      />
      <TaskGroup
        label="进行中"
        tone={GROUP_TONE.pine}
        rows={buckets.ongoing}
        todayIso={todayIso}
        emptyText="没有进行中的任务"
        onOpenProject={onOpenProject}
        projectOf={projectOf}
        stageOf={stageOf}
      />
      <TaskGroup
        label="近期完成"
        tone={GROUP_TONE.sage}
        rows={buckets.done.slice(0, DONE_PREVIEW_LIMIT)}
        todayIso={todayIso}
        emptyText="最近没有完成的任务"
        footer={doneHidden > 0 ? `另有 ${doneHidden} 条更早完成` : null}
        onOpenProject={onOpenProject}
        projectOf={projectOf}
        stageOf={stageOf}
      />
    </section>
  );
}

/** 三块中的一块（列头 = 色点 + 标签 + 计数徽标；行 = 可点任务条目） */
function TaskGroup({
  label,
  tone,
  rows,
  todayIso,
  emptyText,
  footer,
  onOpenProject,
  projectOf,
  stageOf,
}: {
  label: string;
  tone: { dot: string; chip: string };
  rows: Task[];
  todayIso: string;
  emptyText: string;
  footer?: string | null;
  onOpenProject(projectId: string): void;
  projectOf(t: Task): Project | undefined;
  stageOf(t: Task): Stage | undefined;
}): JSX.Element {
  return (
    <div className="glass-light flex flex-col gap-2 rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${tone.dot}`} aria-hidden />
          <h2 className="text-sm font-semibold text-ink">{label}</h2>
        </div>
        <span className={`rounded-[10px] px-2.5 py-0.5 text-[12px] font-medium ${tone.chip}`}>
          {rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-1 py-2 text-xs text-mist">{emptyText}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((t) => {
            const due = dueOf(t);
            const isOverdue = !taskIsDone(t) && due !== null && due < todayIso;
            const project = projectOf(t);
            const stage = stageOf(t);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onOpenProject(t.projectId)}
                  title={`打开项目：${project?.name ?? t.projectId}`}
                  className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sand"
                >
                  <span className="truncate text-[13px] text-ink">{t.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-mist">
                    <span className="truncate">{project?.name ?? '未知项目'}</span>
                    {stage && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate">{stage.name}</span>
                      </>
                    )}
                    {due && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{due}</span>
                      </>
                    )}
                    {isOverdue && (
                      <span className="rounded-full bg-clay-soft px-1.5 text-clay">已逾期</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
          {footer && <li className="px-2 pt-1 text-[11px] text-mist">{footer}</li>}
        </ul>
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
