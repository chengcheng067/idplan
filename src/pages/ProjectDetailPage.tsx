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
      <div className="py-16 text-center text-mist">
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
      <div className="py-16 text-center text-mist">
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
    <div>
      {/* 返回行 */}
      <div className="mb-3 flex items-center justify-between">
        <Link
          to={memberView ? (currentMember ? '/my-tasks' : '/') : '/'}
          className="inline-flex items-center gap-1 text-sm text-mist transition-colors hover:text-pine"
        >
          <ArrowLeft size={14} /> {memberView ? (currentMember ? '我的任务' : '首页') : '全部项目'}
        </Link>
        <div className="flex items-center gap-2 text-sm">
          {!memberView && (
            <>
              {/* v0.3 变更 E：日程表打印视图（仅 admin；新窗口打开，打印完可关） */}
              <button
                type="button"
                onClick={() => window.open(`/project/${project.id}/schedule-print`, '_blank')}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-mist hover:bg-sand"
                title="打开日程表打印视图（新窗口）"
              >
                <CalendarRange size={14} /> 日程表
              </button>
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
