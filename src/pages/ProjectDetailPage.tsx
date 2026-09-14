import { useEffect, useMemo, useState } from 'react';

import { Link, useParams } from 'react-router-dom';

import { ArrowLeft, Archive, Bot, CalendarRange } from 'lucide-react';

import { useProjectsStore } from '../store/useProjectsStore';
import { useAgentStore } from '../store/useAgentStore';
import { createProjectActions } from '../store/useProjectsStore';
import { useUiStore } from '../store/useUiStore';
import { useMembersStore } from '../store/useMembersStore';
import { useRepos } from '../hooks/useRepos';
import { useRoleGuard, isRestrictedView, computeRelatedStageIds } from '../hooks/useRoleGuard';
import { TimelineView, pickActiveStage } from '../components/timeline/TimelineView';
import { MobileStageList } from '../components/timeline/MobileStageList';
import { StageDrawer } from '../components/stage-detail/StageDrawer';
import { CompletionRing } from '../components/common/CompletionRing';
import { CountdownNumber } from '../components/common/CountdownNumber';
import { Badge } from '../components/common/Badge';
import { PROJECT_TYPE_LABELS, ProjectType } from '../core/types/enums';
import type { Stage } from '../core/types/entities';
import { totalDaysInclusive } from '../lib/date';

/**
 * 项目详情主视图：顶条信息环 + 九阶段时间轴 + 阶段抽屉。
 * v0.2 增量：
 *   - T05：移除旧折叠「备份」按钮（备份统一收敛顶栏 BackupMenu，仅管理员）；
 *   - T06：非管理员（含未进入身份）隐藏敏感字段（clientName / address / contractAmount——顶条只留类型/工期/倒计时/完成环）；
 *   - T07：非管理员仅渲染与自己相关的阶段（stage.ownerId===me 或该阶段存在我参与的任务
 *          ——taskAssigneeIds(task) 包含 me，v0.3 多人参与语义），
 *          完全无关 → 「该项目的阶段与你无关」空态。
 *
 * BUG-1 修复（QA 严过关）：受限判定统一为「非管理员即受限」——memberView = !isAdmin，
 * 而不是 isMember。未进入身份（role=null）时 isMember=false 但绝不能获得管理员级读
 * （敏感字段/全量阶段）与写（拖拽改期/归档）权限；未进入且无 currentMember → 无任何
 * 相关阶段 → 直接受限空态。
 */
/** 视口 <lg(1024px) 判定：手机/平板竖屏用纵向阶段卡片流，平板横屏/桌面用横向时间轴 */
function useIsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    const onChange = (): void => setNarrow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export function ProjectDetailPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const repos = useRepos();
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === id));
  const stages = useProjectsStore((s) =>
    s.stages.filter((st) => st.projectId === id).sort((a, b) => a.orderIndex - b.orderIndex),
  );
  const tasks = useProjectsStore((s) => s.tasks.filter((t) => t.projectId === id));
  const members = useMembersStore((s) => s.members);
  const { role, currentMember } = useRoleGuard();
  const memberView = isRestrictedView(role);
  const isNarrow = useIsNarrowViewport();

  // 相关阶段：管理员 → null（全量）；成员 → 自己相关阶段；未进入 → 空集（受限空态）
  const relatedStageIds = useMemo(
    () =>
      computeRelatedStageIds({
        memberView,
        currentMemberId: currentMember?.id ?? null,
        stages,
        tasks,
      }),
    [memberView, currentMember, stages, tasks],
  );

  const visibleStages = relatedStageIds
    ? stages.filter((s) => relatedStageIds.has(s.id))
    : stages;

  if (!project) {
    return (
      // px-8 与正文根节点的 p-8 同口径（画板 04 内容区 pad=32），下同
      <div className="px-8 py-16 text-center text-mist">
        <p className="mb-3">未找到该项目（可能已被归档或删除）。</p>
        <Link to="/" className="text-pine underline underline-offset-2">
          ← 返回项目列表
        </Link>
      </div>
    );
  }

  // 非管理员且无任何相关阶段 → 受限空态（未进入用户同样命中：currentMember=null → 空集）
  if (memberView && visibleStages.length === 0) {
    return (
      <div className="px-8 py-16 text-center text-mist">
        <p className="mb-3">
          {currentMember ? '该项目的阶段与你无关。' : '请先点击右上角「进入身份」，再查看项目。'}
        </p>
        <Link
          to={currentMember ? '/my-tasks' : '/'}
          className="text-pine underline underline-offset-2"
        >
          ← {currentMember ? '返回我的任务' : '返回首页'}
        </Link>
      </div>
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const activeId = pickActiveStage(visibleStages, todayIso);
  const activeStage: Stage | undefined = visibleStages.find((s) => s.id === activeId);

  // 完成度：已完成阶段数 / 可见阶段数
  const doneCount = visibleStages.filter((s) => s.visible !== false && s.status === 'completed').length;
  const percent = visibleStages.length ? (doneCount / visibleStages.length) * 100 : 0;

  const countdownTarget =
    activeStage?.endAt.slice(0, 10) ?? project.plannedEndAt.slice(0, 10);

  const actions = createProjectActions(repos);

  return (
    /*
      内容区内边距由本页根节点自持（AppShell 的 <main> 已移除全部内边距）。
      值取 **32**，出处是画板 04「项目详情 · 阶段时间轴」：
        内容区  [col gap=20 pad=32]
        顶栏    [row gap=16 pad=24]
      即「顶栏 24 / 正文 32」是设计稿**刻意不同的两档**，不是没对齐。
      为什么必须补：本页根节点原先无任何内边距，正文第一行贴在顶栏下沿 0 间距，
      用户读作「过于靠近上沿、没有上下居中」（实为整行贴顶）。gap=20 由下方
      信息环的 mb-5（20px）承担，与画板 col gap=20 同值。
    */
    <div className="p-8">
      {/*
        操作行（日程表 / Agent Board / 归档）—— **右对齐、无左侧返回链接**。

        ⚠️ v0.7 增量：这里原有一个「← 全部项目 / ← 我的任务」文字链接，**已删除**。
        依据：画板 04 顶栏只有「返回与面包屑块」（36×36 返回按钮 + 面包屑「项目 /
        {项目名}」），正文区里**根本没有这条二级栏返回行**。返回入口统一收敛到
        TopBar 的面包屑（TopBar.tsx 的 Breadcrumbs：返回箭头 + 项目 / 我的项目 / {项目名}）。
        保留两个返回箭头会指向同一目的地（原链接与面包屑的「我的项目」都 navigate('/')），
        用户原话读作「是否重复？而且它们没有对齐」——不对齐的根因是顶栏有 px-4/xl:px-6
        而本页为 0，补上 p-8 后错位自然消失。

        ⚠️ 成员视角可达性（已读码逐条核实，不是想当然）：
          · 面包屑在 TopBar 里是 `hidden min-w-0 md:flex`，即 **≥768 才渲染**。
          · ≥768 的成员：面包屑「我的项目」按钮 `navigate('/')` → HomeRouteGuard 判
            isMember 后 <Navigate to="/member-board">（homeRouteTarget(true)），
            落点是成员看板而非首页；返回箭头是 `navigate(-1)`。
            两条都在，member 仍有回程（目的地由守卫决定，不是首页）。
          · <768 的成员：面包屑整块不渲染，本页**没有**行内返回入口，
            回程只剩顶栏汉堡 → 侧栏抽屉的导航项（成员的「看板 / 我的任务」）。
          · 另外本页两处早退分支（未找到项目 / 受限空态）各自保留了专属返回链接，
            这两种情况下 member 仍有明确的回程，不受本次删除影响。
      */}
      <div className="mb-3 flex items-center justify-end">
        <div className="flex items-center gap-2 text-sm">
          {/* v0.7-D · 打印/导出入口对「已进入身份」开放（管理员 + 成员）：
              用户已拍板「放开成员打印」——成员可查看并打印/导出（只读导出），不放开编辑。
              条件是 `role !== null`（不是 `!isAdmin`、更不是 `!memberView`）：
              未进入身份（role=null）**不**渲染此入口——该档在页首已走受限空态（无可见范围），
              此处是双保险，避免「未进入」被误并进允许档。 */}
          {role !== null && (
            <button
              type="button"
              onClick={() => window.open(`/project/${project.id}/schedule-print`, '_blank')}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-mist hover:bg-sand"
              title="打开日程表打印视图（新窗口）"
            >
              <CalendarRange size={14} /> 日程表
            </button>
          )}
          {!memberView && (
            <>
              {/* v0.6 · T13 要点 9：跳 Agent Board（先锚定当前项目再导航） */}
              <button
                type="button"
                onClick={() => {
                  useAgentStore.getState().setCurrentProject(project.id);
                  window.location.assign('/agent');
                }}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-mist hover:bg-sand"
                title="在 Agent Board 中查看本项目任务"
              >
                <Bot size={14} /> Agent Board
              </button>
              {/* 归档是**写操作**，仍限管理员（v0.7-D 只放开打印，未放开任何写） */}
              <button
                type="button"
                disabled={project.status !== 'active'}
                onClick={() => void actions.setArchived(project.id, true)}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-mist hover:bg-sand disabled:opacity-40"
                title={project.status !== 'active' ? '已归档' : '归档后从首页列表隐藏'}
              >
                <Archive size={14} /> 归档
              </button>
            </>
          )}
        </div>
      </div>

      {/* 顶条信息环（v0.3 玻璃化；非管理员视角隐藏 clientName/address 等敏感字段） */}
      <div className="glass-medium mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-line p-4 shadow-soft sm:gap-x-8 sm:p-5">
        <div>
          <h1 className="font-display text-display-lg">{project.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mist">
            <Badge tone="pine">{PROJECT_TYPE_LABELS[project.type as ProjectType] ?? '未分类'}</Badge>
            {!memberView && project.clientName && <span>客户：{project.clientName}</span>}
            {!memberView && project.address && <span>· {project.address}</span>}
            <span>
              · 总工期 {totalDaysInclusive(project.plannedStartAt.slice(0, 10), project.plannedEndAt.slice(0, 10))} 天
            </span>
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3 sm:gap-6">
          <CountdownNumber target={countdownTarget} todayIso={todayIso} />
          <CompletionRing percent={percent} size={52} />
          <div className="text-xs leading-5 text-mist">
            <p>
              {project.plannedStartAt.slice(0, 10)} — {project.plannedEndAt.slice(0, 10)}
            </p>
            <p>
              当前：<b className="text-pine-deep">{activeStage ? `${activeStage.orderIndex}. ${activeStage.name}` : '—'}</b>
            </p>
          </div>
        </div>
      </div>

      {/* 时间轴：平板横屏/桌面(≥lg)用横向时间轴；手机/平板竖屏(<lg)用纵向阶段卡片流（阶段 C） */}
      {isNarrow ? (
        <MobileStageList
          stages={visibleStages}
          tasks={tasks}
          members={members}
          todayIso={todayIso}
          onOpen={(sid) => useUiStore.getState().openStageDrawer(sid)}
        />
      ) : (
        <TimelineView
          project={project}
          stages={visibleStages}
          members={members}
          memberView={memberView}
          tasks={tasks}
        />
      )}

      <StageDrawer projectId={project.id} members={members} />
    </div>
  );
}
