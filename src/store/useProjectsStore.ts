import { create } from 'zustand';

import type {
  AssignmentLog,
  Member,
  Project,
  Stage,
  StageLog,
  Task,
} from '../core/types/entities';
import type {
  CreateProjectCmd,
  RescheduleStageCmd,
  StageDraft,
  StageTemplateDomain,
  UpdateProjectCmd,
  UpdateTaskCmd,
  UpdateStageCmd,
} from '../core/types/dto';
import {
  AssignmentAction,
  ChangxiaError,
  ChangxiaErrorCode,
  ProjectType,
  StageStatus,
  TaskStatus,
} from '../core/types/enums';
import { taskIsDone, withStatus } from '../core/types/entities';
import type { TaskQuery } from '../core/repositories/interfaces';
import { previewSplit } from '../core/template/split';
import {
  digestOf,
  ProjectService,
  type CreateAgentBoardCmd,
} from '../core/services/project.service';
import { StageService } from '../core/services/stage.service';
import type { UnlockHintSignal } from '../core/services/stage.service';
import { sameAssigneeSet, taskAssigneeIds } from '../hooks/useRoleGuard';

/**
 * 项目主数据镜像：projects + stages + tasks + 流水缓存。
 * Action 模式：调 repo/service 成功后做 Store 局部 patch（铁律 11 的乐观更新位）。
 */

export interface ToastSignal {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

export interface ProjectsState {
  projects: Project[];
  stages: Stage[];
  tasks: Task[];
  stageLogs: Record<string, StageLog[]>; // stageId -> logs 缓存（抽屉渲染用）
  /** 全局瞬时 Toast 队列（≤2s 自动清除，绝无全屏 loading） */
  toasts: ToastSignal[];

  // ---- 装载 ----
  replaceAll(payload: { projects: Project[]; stages: Stage[]; tasks: Task[] }): void;

  // ---- 读 ----
  projectById(id: string): Project | undefined;
  stagesOf(projectId: string): Stage[];
  tasksOf(projectId: string): Task[];
  taskById(id: string): Task | undefined;

  // ---- 写（同步镜像；异步持久化由页面层调用本文件尾部服务方法） ----
  putProject(p: Project): void;
  removeProjectLocal(id: string): void;
  putStage(s: Stage): void;
  setStages(projectId: string, stages: Stage[]): void;
  putTask(t: Task): void;
  addTaskLocal(t: Task): void;
  removeTaskLocal(id: string): void;
  setStageLogs(stageId: string, logs: StageLog[]): void;

  // ---- toast ----
  pushToast(kind: ToastSignal['kind'], message: string): number;
  dismissToast(id: number): void;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  stages: [],
  tasks: [],
  stageLogs: {},
  toasts: [],

  replaceAll: ({ projects, stages, tasks }) => set({ projects, stages, tasks }),

  projectById: (id) => get().projects.find((p) => p.id === id),
  stagesOf: (projectId) =>
    get()
      .stages.filter((s) => s.projectId === projectId)
      .sort((a, b) => a.orderIndex - b.orderIndex),
  tasksOf: (projectId) => get().tasks.filter((t) => t.projectId === projectId),
  taskById: (id) => get().tasks.find((t) => t.id === id),

  putProject: (p) =>
    set((st) => ({
      projects: st.projects.some((x) => x.id === p.id)
        ? st.projects.map((x) => (x.id === p.id ? p : x))
        : [p, ...st.projects],
    })),

  removeProjectLocal: (id) =>
    set((st) => ({ projects: st.projects.filter((p) => p.id !== id) })),

  putStage: (s) =>
    set((st) => ({
      stages: st.stages.some((x) => x.id === s.id)
        ? st.stages.map((x) => (x.id === s.id ? s : x))
        : [...st.stages, s],
    })),

  setStages: (projectId, stages) =>
    set((st) => ({
      stages: [...st.stages.filter((s) => s.projectId !== projectId), ...stages],
    })),

  putTask: (t) =>
    set((st) => ({
      tasks: st.tasks.some((x) => x.id === t.id)
        ? st.tasks.map((x) => (x.id === t.id ? t : x))
        : [...st.tasks, t],
    })),

  addTaskLocal: (t) => set((st) => ({ tasks: [...st.tasks, t] })),

  removeTaskLocal: (id) => set((st) => ({ tasks: st.tasks.filter((t) => t.id !== id) })),

  setStageLogs: (stageId, logs) =>
    set((st) => ({ stageLogs: { ...st.stageLogs, [stageId]: logs } })),

  pushToast: (kind, message) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    set((st) => ({ toasts: [...st.toasts.slice(-2), { id, kind, message }] }));
    // 瞬时反馈：2s 自动消失（PRD 禁长驻提示与全屏 loading）
    setTimeout(() => get().dismissToast(id), 2000);
    return id;
  },

  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),
}));

/* ------------------------------- 服务编排 API ------------------------------- */

/** 构造 ProjectService（bundle 由 React 层传入，见 useProjectActions hook） */
function makeServices(repos: import('../core/repositories/interfaces').IRepositoryBundle): {
  projects: ProjectService;
  stages: StageService;
} {
  return {
    projects: new ProjectService({
      projects: repos.projects,
      bundle: repos,
    }),
    stages: new StageService({ stages: repos.stages, logs: repos.logs }),
  };
}

/** 页面级动作集合（React 组件经 useRepos() 拿 bundle 后调用这些函数） */
export function createProjectActions(repos: import('../core/repositories/interfaces').IRepositoryBundle) {
  const store = useProjectsStore.getState();
  const services = makeServices(repos);

  return {
    /** 合同建档（向导确认后调用） */
    async createFromContract(
      confirmed: Parameters<ProjectService['createProjectFromContract']>[0],
      drafts: StageDraft[],
      contractRecordId?: string,
    ): Promise<Project> {
      try {
        const project = await services.projects.createProjectFromContract(confirmed, drafts, contractRecordId);
        // 刷新项目全景（stages/tasks 由各自的 list 补齐）
        store.putProject(project);
        const freshStages = await repos.stages.listByProject(project.id);
        store.setStages(project.id, freshStages);
        const freshTasks = await repos.tasks.listByProject(project.id);
        useProjectsStore.setState((st) => ({
          tasks: [...st.tasks.filter((t) => t.projectId !== project.id), ...freshTasks],
        }));
        store.pushToast('success', `「${project.name}」建档完成`);
        return project;
      } catch (err) {
        // 向上抛真实原因（含 userMessage），由调用方表单展示，避免笼统的「请检查日期」误导文案
        const msg = err instanceof ChangxiaError ? err.userMessage : '建档失败，请重试。';
        store.pushToast('error', msg);
        throw err instanceof ChangxiaError ? err : new ChangxiaError(ChangxiaErrorCode.Storage, msg);
      }
    },

    /** 手动建档 */
    async createManual(cmd: CreateProjectCmd): Promise<Project> {
      try {
        const project = await services.projects.createManualProject(cmd);
        store.putProject(project);
        const freshStages = await repos.stages.listByProject(project.id);
        store.setStages(project.id, freshStages);
        const freshTasks = await repos.tasks.listByProject(project.id);
        useProjectsStore.setState((st) => ({
          tasks: [...st.tasks.filter((t) => t.projectId !== project.id), ...freshTasks],
        }));
        store.pushToast('success', `「${project.name}」手动建档完成`);
        return project;
      } catch (err) {
        // 向上抛真实原因（含 userMessage），由调用方表单展示，避免笼统的「请检查日期」误导文案
        const msg = err instanceof ChangxiaError ? err.userMessage : '建档失败，请重试。';
        store.pushToast('error', msg);
        throw err instanceof ChangxiaError ? err : new ChangxiaError(ChangxiaErrorCode.Storage, msg);
      }
    },

    /** 更新项目信息（编辑弹窗用） */
    async updateProject(id: string, cmd: UpdateProjectCmd): Promise<void> {
      try {
        const updated = await repos.projects.update(id, cmd);
        store.putProject(updated);
        store.pushToast('success', '项目信息已更新');
      } catch (err) {
        store.pushToast('error', err instanceof ChangxiaError ? err.userMessage : '更新失败');
      }
    },

    /**
     * ★ v0.8 T04-A · TBD-10：确认存量「自定义阶段」项目的主板块（设计 §3.2.1）。
     *
     * 这是 `confirmProjectDomain` 的**唯一入口**（页面只调它，不直接碰 service/repo）。
     * 它比其他 action 少两件常规动作，是刻意的：
     *   · **不 reload 阶段/任务** —— 本次写入只动 `domain` 一个字段，项目下的阶段与
     *     任务表一字未变。补一次 `listByProject` 会让"只写一个字段"这件事在**运行时成本**
     *     上看起来像"重建了项目"，也把验收 9 的"只有 domain 变化"从语义层污染到实现层。
     *   · **不猜、不批量** —— 一次调用对应用户在提示条上的一次点击，只处理一个 id。
     *     `needsDomainConfirm` 是**读时派生**（`visibility.ts`），未确认的项目**永不**被
     *     自动改写 —— 所以这里天然没有"扫描存量库"的入口。
     *
     * 返回 `boolean` 而不是 `void`：提示条要在成功后**就地消失**，而提示条的显隐由
     * `needsDomainConfirm(project.domain)` 派生 —— 只要 `store.putProject(updated)`
     * 落了新 domain，下一帧提示条自己就没条件了。返回值供调用方做二段反馈（如关闭确认浮层）。
     */
    async confirmProjectDomain(id: string, domain: StageTemplateDomain): Promise<boolean> {
      try {
        const updated = await services.projects.confirmProjectDomain(id, domain);
        store.putProject(updated);
        store.pushToast('success', '项目板块已确认');
        return true;
      } catch (err) {
        store.pushToast(
          'error',
          err instanceof ChangxiaError ? err.userMessage : '板块确认失败，请重试。',
        );
        return false;
      }
    },

    /**
     * ★ v0.8 T04-B · 建 Agent 看板（设计 §6.1 第 3 条建档路径 / PRD B7–B10 / TS-08）。
     *
     * 这是 `ProjectService.createAgentBoard` 的**唯一页面入口**：组件只调本 action，
     * 不直接碰 `services.projects.*`（与 `createManual` / `createFromContract` 同一分层纪律，
     * 见 `ManualFallbackForm.tsx` 只调 `actions.createManual`）。
     *
     * ── 为什么返回 `Project` 而不是 service 的 `string` ──
     * service 只回新 id（领域层不需要认识 Project 之外的形态）；而本 action 的调用方是
     * **表单**，它要「关弹窗 → 选中新看板」——所以这里把刚落的行读回来一并返回，
     * 省掉调用方自己再查一次，也让"建完即选中"只依赖一个返回值。
     *
     * ── 为什么必须 `putProject` 且它**不构成**漏斗旁路（§7.5）──
     * `createAgentBoard` 恒落 `kind:'agent'`，所以 `putProject` 往 `store.projects` 里加的
     * **只有这一块 Agent 看板**，没有夹带任何人类项目 ⇒ 与 §7.5 要删的「全量灌入」是两回事
     * （那个是把 `bundle.projects.list()` 的**全量**结果写回 store）。
     * 而这里必须写，否则 `AgentBoardPage` 经 `useAgentProjects()` 拿到的新看板要等下次
     * bootstrap 才出现 —— §6.1 时序图第 9 步（`P->>V: selectAgentProjects()`）要求**建完即见**。
     * 另：`store.projects` 的写入白名单本就包含本文件（`tests/isolation-guard.spec.ts`）。
     *
     * ── 不刷 tasks ──
     * `createAgentBoard` **不生成任务**（§6.1 时序图只有 insert + bulkInsert 两步）。
     * 补一次 `tasks.listByProject` 会返回空数组，除了多一次 IO 与一帧无意义渲染外没有语义。
     * 阶段要刷：它是本次真正新建的从表数据，抄 `createManual` 的 `setStages` 口径。
     *
     * ── 错误处理与 `createManual` 逐字同款（刻意，别简化）──
     * `createAgentBoard` 的校验文案**就是"不猜"设计的一部分**（「请提供看板的开始日期与
     * 结束日期（不会自动填充默认日期）」）。若在这里被吞成笼统的「创建失败」，
     * 用户就不知道到底缺哪一个字段 —— 那正是 B9 要避免的。故：toast 用 `userMessage`，
     * 并**向上抛**真实原因供表单就地展示。
     */
    async createAgentBoard(cmd: CreateAgentBoardCmd): Promise<Project> {
      try {
        const id = await services.projects.createAgentBoard(cmd);
        const project = await repos.projects.get(id);
        // 刚 insert 成功却读不回来 = 仓储层出了真问题。**必须抛**：
        // 若在这里静默跳过 putProject，用户会看到"提示成功但没有新看板"，
        // 那是个查不出来的假成功（比直接报错坏得多）。
        if (!project) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Storage,
            '看板已创建，但读取新看板失败。请刷新后查看。',
          );
        }
        store.putProject(project);
        const freshStages = await repos.stages.listByProject(project.id);
        store.setStages(project.id, freshStages);
        store.pushToast('success', `「${project.name}」看板已创建`);
        return project;
      } catch (err) {
        // 向上抛真实原因（含 userMessage），由调用方表单展示，避免笼统的「创建失败」误导文案
        const msg = err instanceof ChangxiaError ? err.userMessage : '创建看板失败，请重试。';
        store.pushToast('error', msg);
        throw err instanceof ChangxiaError ? err : new ChangxiaError(ChangxiaErrorCode.Storage, msg);
      }
    },

    /** 归档/取消归档 */
    async setArchived(id: string, archived: boolean): Promise<void> {
      try {
        await repos.projects.archive(id, archived);
        if (archived) {
          store.removeProjectLocal(id);
          store.pushToast('success', archived ? '已归档' : '已恢复');
        } else {
          const fresh = await repos.projects.get(id);
          if (fresh) store.putProject(fresh);
          store.pushToast('success', '已恢复为进行中');
        }
      } catch (err) {
        store.pushToast('error', err instanceof ChangxiaError ? err.userMessage : '操作失败');
      }
    },

    /** 永久删除项目（级联清理其下阶段/任务/流水），危险操作，仅 admin 使用 */
    async removeProject(id: string, projectName?: string): Promise<void> {
      try {
        await repos.projects.remove(id);
        // 同步清理项目镜像：项目 + 其下 stages + tasks（stageLogs 缓存按需丢弃）
        useProjectsStore.setState((st) => ({
          projects: st.projects.filter((p) => p.id !== id),
          stages: st.stages.filter((s) => s.projectId !== id),
          tasks: st.tasks.filter((t) => t.projectId !== id),
        }));
        store.pushToast('success', `「${projectName ?? '项目'}」已删除`);
      } catch (err) {
        store.pushToast('error', err instanceof ChangxiaError ? err.userMessage : '删除失败');
      }
    },

    /** 改期（弹窗闸门确认后调用）——成功返回 null，失败抛出供弹窗展示 */
    async rescheduleStage(stageId: string, cmd: RescheduleStageCmd): Promise<boolean> {
      try {
        const updated = await services.stages.reschedule(stageId, cmd);
        store.putStage(updated);
        const logs = await repos.logs.listStageLogsByStage(stageId);
        store.setStageLogs(stageId, logs);
        store.pushToast('success', '已改期并留痕');
        return true;
      } catch (err) {
        store.pushToast('error', err instanceof ChangxiaError ? err.userMessage : '改期失败');
        return false;
      }
    },

    /** 四态流转；completed 返回解锁提示信号 */
    async transitionStage(
      stageId: string,
      toStatus: StageStatus,
      operatorName: string,
    ): Promise<UnlockHintSignal | null> {
      try {
        const { stage, unlockHint } = await services.stages.transition(stageId, toStatus, operatorName);
        store.putStage(stage);
        const logs = await repos.logs.listStageLogsByStage(stageId);
        store.setStageLogs(stageId, logs);
        store.pushToast('success', '状态已更新');
        return unlockHint;
      } catch (err) {
        store.pushToast('error', err instanceof ChangxiaError ? err.userMessage : '状态流转失败');
        return null;
      }
    },

    /** 抽屉里行内编辑阶段字段（名称/负责人/资料路径等，非日期） */
    async updateStageFields(stageId: string, cmd: UpdateStageCmd): Promise<void> {
      try {
        const updated = await repos.stages.update(stageId, cmd);
        store.putStage(updated);
      } catch (err) {
        store.pushToast('error', err instanceof ChangxiaError ? err.userMessage : '保存失败');
      }
    },

    async loadStageLogs(stageId: string): Promise<void> {
      const logs = await repos.logs.listStageLogsByStage(stageId);
      store.setStageLogs(stageId, logs);
    },
  };
}

/** 任务级动作（含指派流水 append，满足铁律 6 与 PRD F5/F11） */
export function createTaskActions(repos: import('../core/repositories/interfaces').IRepositoryBundle) {
  const store = useProjectsStore.getState();

  return {
    async toggleDone(task: Task, operatorName: string): Promise<void> {
      // v0.6 收敛（M23/useAgentStore 前置）：done 是派生字段——勾选/取消一律改 status
      // （taskIsDone 求反 → withStatus 双写），不再直接写 done。
      const nextDone = !taskIsDone(task);
      const optimistic = withStatus(task, nextDone ? TaskStatus.Done : TaskStatus.Draft);
      store.putTask(optimistic);
      try {
        const updated = await repos.tasks.update(task.id, {
          status: nextDone ? TaskStatus.Done : TaskStatus.Draft,
        });
        await repos.logs.appendAssignment({
          taskId: task.id,
          projectId: task.projectId,
          memberId: task.assigneeId,
          action: AssignmentAction.Assign,
          operatorName: operatorName || '未知',
        });
        store.putTask(updated);
      } catch (err) {
        store.putTask(task); // 回滚
        store.pushToast(
          'error',
          err instanceof ChangxiaError ? err.userMessage : '任务状态保存失败，已回滚。',
        );
      }
    },

    async updateTask(id: string, cmd: UpdateTaskCmd, operatorName?: string): Promise<void> {
      const existing = useProjectsStore.getState().taskById(id);
      try {
        const updated = await repos.tasks.update(id, cmd);
        // 主负责人变更 → assignments 留痕（保留 v0.2 逻辑，memberId=新 assigneeId）
        if (existing && cmd.assigneeId !== undefined && cmd.assigneeId !== existing.assigneeId) {
          await repos.logs.appendAssignment({
            taskId: id,
            projectId: updated.projectId,
            memberId: cmd.assigneeId,
            action: AssignmentAction.Change,
            operatorName: operatorName ?? useMemberName(cmd.assigneeId),
          });
        }
        // 参与人集合变化 → 追加一条集合级 Change 流水（memberId=null，避免多人逐条刷屏）
        if (
          existing &&
          cmd.assigneeIds !== undefined &&
          !sameAssigneeSet(taskAssigneeIds(existing), cmd.assigneeIds)
        ) {
          await repos.logs.appendAssignment({
            taskId: id,
            projectId: updated.projectId,
            memberId: null,
            action: AssignmentAction.Change,
            operatorName: operatorName ?? useMemberName(null),
          });
        }
        store.putTask(updated);
        store.pushToast('success', '任务已保存');
      } catch (err) {
        store.pushToast('error', err instanceof ChangxiaError ? err.userMessage : '任务保存失败');
      }
    },

    async addTask(stage: Stage, title: string, assigneeId: string | null): Promise<void> {
      try {
        const created = await repos.tasks.insert({
          projectId: stage.projectId,
          stageId: stage.id,
          title,
          assigneeId,
          dueDate: stage.endAt.slice(0, 10),
        });
        if (assigneeId) {
          await repos.logs.appendAssignment({
            taskId: created.id,
            projectId: created.projectId,
            memberId: assigneeId,
            action: AssignmentAction.Assign,
            operatorName: useMemberName(assigneeId),
          });
        }
        store.addTaskLocal(created);
        store.pushToast('success', '条目已添加');
      } catch (err) {
        store.pushToast('error', err instanceof ChangxiaError ? err.userMessage : '添加失败');
      }
    },

    async removeTask(id: string): Promise<void> {
      const snapshot = useProjectsStore.getState().tasks.find((t) => t.id === id);
      store.removeTaskLocal(id); // 乐观删除
      try {
        await repos.tasks.remove(id);
        store.pushToast('success', '条目已删除');
      } catch (err) {
        if (snapshot) store.addTaskLocal(snapshot);
        store.pushToast(
          'error',
          err instanceof ChangxiaError ? err.userMessage : '删除失败，已还原。',
        );
      }
    },

    async listByAssignee(memberId: string): Promise<Task[]> {
      return repos.tasks.listByAssignee(memberId);
    },

    queryTasks(query: TaskQuery): Task[] {
      let rows = useProjectsStore.getState().tasks;
      if (query.projectId) rows = rows.filter((t) => t.projectId === query.projectId);
      if (query.stageId) rows = rows.filter((t) => t.stageId === query.stageId);
      // v0.3：参与人包含语义（与 taskAssigneeIds 同口径）
      if (query.assigneeId) rows = rows.filter((t) => taskAssigneeIds(t).includes(query.assigneeId as string));
      // @deprecated 兼容维度：读取统一 taskIsDone（status 是唯一事实源）
      if (typeof query.done === 'boolean') rows = rows.filter((t) => taskIsDone(t) === query.done);
      // v0.6 新维度（与仓储 list() 同语义：status 单值或数组）
      if (query.source) rows = rows.filter((t) => t.source === query.source);
      if (query.agentId) rows = rows.filter((t) => t.agentId === query.agentId);
      if (query.status) {
        const wanted = Array.isArray(query.status) ? query.status : [query.status];
        rows = rows.filter((t) => wanted.includes(t.status));
      }
      if (query.externalId) rows = rows.filter((t) => t.externalId === query.externalId);
      return rows;
    },
  };
}

function useMemberName(memberId: string | null): string {
  if (!memberId) return '未知';
  const m = findMemberCached(memberId);
  return m?.name ?? memberId;
}

let memberCache: Member[] = [];
export function setMemberCacheForNames(list: Member[]): void {
  memberCache = list;
}
function findMemberCached(id: string): Member | undefined {
  return memberCache.find((m) => m.id === id);
}

/** 导出副作用零依赖的工具（测试友好） */
export function splitPreview(startAt: string, endAt: string): StageDraft[] {
  return previewSplit({ startAt, endAt });
}

/** 导出副作用零依赖的纯函数（测试友好；纯函数无 IO） */
export { digestOf };

export type { AssignmentLog, StageLog, ProjectType };
