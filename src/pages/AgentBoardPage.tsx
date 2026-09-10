/**
 * Agent Board 主页（v0.6 · 设计文档 T11 / PRD §6.1，路由 /agent）。
 *
 * 信息架构：顶部项目选择器 + 指标卡行（SourceStatCard）→ Ready 队列置顶区
 * （ReadyQueue）→ status 分列看板（7 列，ALL_TASK_STATUSES 遍历）。
 * 列渲染复用 HomePage 的 TONE_CLASSES 范式（token → 类名），不硬编码颜色。
 *
 * 数据装载：mount 时经 repos 全量拉取 projects/members + 当前项目 tasks/stages，
 * 写入 useProjectsStore 镜像（与既有页面同款「store 即缓存」模式）；
 * 写操作全部经 useAgentStore actions（commitPayload 内已刷新镜像）。
 *
 * 移动端：单列纵向堆叠，列标题吸顶（sticky top-0）；抽屉/面板全屏化（T12）。
 * 术语：全部经 termFor('agent')；状态英文原样显示。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ClipboardPaste, FileOutput } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { IRepositoryBundle } from '../core/repositories/interfaces';
import type { Project, Stage, Task } from '../core/types/entities';
import { ALL_TASK_STATUSES } from '../core/types/enums';
import { useRepos } from '../hooks/useRepos';
import { useAgentStore } from '../store/useAgentStore';
import { useMembersStore } from '../store/useMembersStore';
import { useProjectsStore } from '../store/useProjectsStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { AGENT_SEAT_LIMIT, termFor } from '../constants/agentTerms';
import { ApplyPayloadPanel } from '../components/agent/ApplyPayloadPanel';
import { HandoffPanel } from '../components/agent/HandoffPanel';
import { ReadyQueue } from '../components/agent/ReadyQueue';
import { AgentTaskCard } from '../components/agent/AgentTaskCard';
import { SourceStatCard } from '../components/agent/SourceStatCard';
import { TaskDrawer } from '../components/agent/TaskDrawer';
import { Modal } from '../components/common/Modal';

export function AgentBoardPage(): JSX.Element {
  const repos = useRepos();
  const projects = useProjectsStore((s) => s.projects);
  const stages = useProjectsStore((s) => s.stages);
  const tasks = useProjectsStore((s) => s.tasks);
  const putProject = useProjectsStore((s) => s.putProject);
  const members = useMembersStore((s) => s.members);

  const currentProjectId = useAgentStore((s) => s.currentProjectId);
  const setCurrentProject = useAgentStore((s) => s.setCurrentProject);
  const drawerTaskId = useAgentStore((s) => s.drawerTaskId);
  const openDrawer = useAgentStore((s) => s.openDrawer);
  const claimTask = useAgentStore((s) => s.claimTask);

  const [loaded, setLoaded] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);

  /* ------------------------------ 数据装载 ------------------------------ */
  const loadAll = useCallback(
    async (bundle: IRepositoryBundle): Promise<void> => {
      const [projectRows, memberRows] = await Promise.all([
        bundle.projects.list({ status: 'all' }),
        bundle.members.list(true),
      ]);
      useProjectsStore.setState((st) => ({
        projects: projectRows,
        stages: st.stages, // stages/tasks 按选中项目在 loadProject 中刷新
        tasks: st.tasks,
      }));
      useMembersStore.getState().setAll(memberRows);
      setLoaded(true);
    },
    [],
  );

  const loadProject = useCallback(
    async (bundle: IRepositoryBundle, projectId: string): Promise<void> => {
      const [stageRows, taskRows] = await Promise.all([
        bundle.stages.listByProject(projectId),
        bundle.tasks.listByProject(projectId),
      ]);
      useProjectsStore.setState((st) => ({
        stages: [...st.stages.filter((s) => s.projectId !== projectId), ...stageRows],
        tasks: [...st.tasks.filter((t) => t.projectId !== projectId), ...taskRows],
      }));
    },
    [],
  );

  useEffect(() => {
    void loadAll(repos);
  }, [loadAll, repos]);

  // 选中项目（URL 无状态；首次进入取第一个项目）
  useEffect(() => {
    if (!loaded) return;
    const target = currentProjectId ?? projects[0]?.id ?? null;
    if (target && target !== currentProjectId) setCurrentProject(target);
    if (target) void loadProject(repos, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, projects, currentProjectId]);

  /* ------------------------------ 派生 ------------------------------ */
  const project: Project | undefined = projects.find((p) => p.id === currentProjectId);
  const projectStages = useMemo(
    () => stages.filter((s) => s.projectId === currentProjectId),
    [stages, currentProjectId],
  );
  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === currentProjectId),
    [tasks, currentProjectId],
  );

  /** memberId → 展示名（human 成员名 / agent 的 agentKind；与 HandoffPanel 同口径） */
  const assigneeLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      map[m.id] = m.actorKind === 'agent' && m.agentKind ? m.agentKind : m.name;
    }
    return map;
  }, [members]);

  const agentSeatUsed = members.filter((m) => m.actorKind === 'agent').length;
  const currentMemberId = useSettingsStore((s) => s.currentMemberId);

  /** 列分桶：按 status 分组（列内 Ready 区之外的任务） */
  const columns = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const status of ALL_TASK_STATUSES) map.set(status, []);
    for (const t of projectTasks) map.get(t.status)?.push(t);
    return map;
  }, [projectTasks]);

  const onOpenTask = useCallback((taskId: string) => openDrawer(taskId), [openDrawer]);

  return (
    /* v0.7 T18（R12 对策 · 容器收口）：**删除**了此处原有的
       `mx-auto w-full max-w-[1600px]` —— 宽度约束已统一由 AppShell 的 <main>
       提供（全局唯一出处）。保留重复约束会造成「侧栏 + main 内又一层 1600 容器」
       的双重留白（工程核查 A.1 / L-08 验收点）。
       本处只保留页面级的内边距与纵向节奏，不再碰宽度。
       注意：本改动**仅容器收口**，页内编排（双模式等）归子系统 ② 后续批次。 */
    <div className="w-full pb-10 pt-4">
      {/* 页头：返回 + 项目选择器 + 两个主 CTA */}
      <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
        <Link
          to="/"
          className="rounded-[8px] px-2 py-1.5 text-sm text-mist transition-colors hover:bg-sand hover:text-ink"
        >
          ← 项目
        </Link>
        <h1 className="font-display text-lg font-bold text-ink">{termFor('board')}</h1>
        <select
          value={currentProjectId ?? ''}
          onChange={(e) => setCurrentProject(e.target.value || null)}
          aria-label="选择项目"
          className="min-w-0 max-w-[240px] rounded-[10px] border border-sand bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-pine"
        >
          {projects.length === 0 && <option value="">（暂无项目）</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setApplyOpen(true)}
            disabled={!currentProjectId}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-pine px-3 py-1.5 text-sm text-pine transition-colors hover:bg-pine-soft disabled:opacity-40"
          >
            <ClipboardPaste size={14} aria-hidden />
            {termFor('applyPayload')}
          </button>
          <button
            type="button"
            onClick={() => setHandoffOpen(true)}
            disabled={!currentProjectId}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-pine px-3 py-1.5 text-sm text-white transition-colors hover:bg-pine-deep disabled:opacity-40"
          >
            <FileOutput size={14} aria-hidden />
            {termFor('handoff')}
          </button>
        </div>
      </div>

      {/* 指标卡行 */}
      <div className="mb-4">
        <SourceStatCard
          tasks={projectTasks}
          assigneeLabels={assigneeLabels}
          agentSeatUsed={agentSeatUsed}
          agentSeatLimit={AGENT_SEAT_LIMIT}
        />
      </div>

      {/* Ready 队列置顶区 */}
      <div className="mb-4">
        <ReadyQueue
          tasks={projectTasks}
          assigneeLabels={assigneeLabels}
          onOpenTask={onOpenTask}
          onClaim={(taskId) => claimTask(repos, taskId, currentMemberId ?? '')}
        />
      </div>

      {/* status 分列看板（7 列；移动端纵向堆叠、列标题吸顶） */}
      <div className="flex gap-3 overflow-x-auto pb-2 max-lg:flex-col lg:overflow-visible">
        {ALL_TASK_STATUSES.map((status) => {
          const list = columns.get(status) ?? [];
          return (
            <section
              key={status}
              className="glass-light w-[280px] shrink-0 rounded-[16px] border border-sand p-3 max-lg:w-full"
            >
              <div className="sticky top-0 -mx-3 mb-2 bg-inherit px-3 pb-1 pt-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-mono text-xs font-semibold text-ink">{status}</h2>
                  <span className="rounded-md bg-sand px-1.5 py-0.5 font-mono text-[10px] text-mist">
                    {list.length}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {list.map((t) => (
                  <AgentTaskCard
                    key={t.id}
                    task={t}
                    assigneeLabel={t.assigneeId ? assigneeLabels[t.assigneeId] : undefined}
                    onOpen={onOpenTask}
                  />
                ))}
                {list.length === 0 && (
                  <p className="rounded-[10px] border border-dashed border-sand px-2 py-3 text-center text-[10px] text-mist/70">
                    —
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Apply payload 面板（Modal 底座；失败保留输入由面板内部负责） */}
      {applyOpen && currentProjectId && (
        <Modal open onClose={() => setApplyOpen(false)} ariaLabel={termFor('applyPayload')}>
          <ApplyPayloadPanel
            projectId={currentProjectId}
            onClose={() => setApplyOpen(false)}
            onCommitted={() => {
              setApplyOpen(false);
              if (currentProjectId) void loadProject(repos, currentProjectId);
            }}
          />
        </Modal>
      )}

      {/* handoff bundle 面板 */}
      {handoffOpen && currentProjectId && project && (
        <Modal open onClose={() => setHandoffOpen(false)} ariaLabel={termFor('handoff')}>
          <HandoffPanel
            projectId={currentProjectId}
            projectName={project.name}
            stages={projectStages.map((s: Stage) => ({ id: s.id, name: s.name }))}
            tasks={projectTasks}
            onClose={() => setHandoffOpen(false)}
          />
        </Modal>
      )}

      {/* 任务详情抽屉 */}
      <TaskDrawer
        task={drawerTaskId ? (projectTasks.find((t) => t.id === drawerTaskId) ?? null) : null}
        projectStages={projectStages.map((s) => ({ id: s.id, name: s.name }))}
        onClose={() => openDrawer(null)}
      />
    </div>
  );
}
