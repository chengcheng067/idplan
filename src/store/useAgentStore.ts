/**
 * Agent 工作台状态（v0.6 · 设计文档 T09 要点 11–13）。
 *
 * 职责边界：**store 只做编排，不重复实现逻辑**——
 *   - Ready/环/拓扑序全部来自 `dag.computeReadyTasks`；
 *   - 状态流转全部走 `TaskService`（严格通道）；
 *   - payload 写库全部走 `payload.apply`（唯一写出口）；
 *   - 错误一律 `ChangxiaError.userMessage` → 复用 `useProjectsStore.pushToast`，
 *     不新建通知体系；
 *   - 写成功后刷新 `useProjectsStore` 的 tasks 镜像（复用既有 putTask / 项目级替换）。
 *
 * DI 约定：actions 显式接收 `IRepositoryBundle`（与 createProjectActions 的
 * 「bundle 由 React 层传入」同款模式），保持 store 本身可脱离 React 测试。
 */

import { create } from 'zustand';

import type { IRepositoryBundle } from '../core/repositories/interfaces';
import type { AgentPayloadV1, ApplyResult } from '../core/types/agent-payload';
import { tryValidateAgentPayload } from '../core/types/agent-payload';
import { ChangxiaError, TaskStatus } from '../core/types/enums';
import type { Task } from '../core/types/entities';
import { taskIsDone } from '../core/types/entities';
import { TaskService } from '../core/services/task.service';
import {
  applyAgentPayload,
  previewAgentPayload,
} from '../core/agent/payload.apply';
import { computeReadyTasks } from '../core/agent/dag';
import { buildHandoffBundle } from '../core/agent/handoff';
import { useProjectsStore } from './useProjectsStore';

/** 看板列过滤：'all' 或单个任务状态 */
export type AgentColumnFilter = TaskStatus | 'all';

export interface AgentState {
  currentProjectId: string | null;
  /** 最近一次 preview 结果（三态 UI 的第二态数据源） */
  previewResult: ApplyResult | null;
  handoffText: string | null;
  drawerTaskId: string | null;
  columnFilter: AgentColumnFilter;

  setCurrentProject(id: string | null): void;
  setColumnFilter(filter: AgentColumnFilter): void;
  openDrawer(taskId: string | null): void;

  /** 校验 + 差异预览（零写入）。校验失败/解引用失败 → toast 并返回 null */
  previewPayload(
    repos: IRepositoryBundle,
    payloadJson: unknown,
    projectId?: string,
  ): Promise<ApplyResult | null>;
  /** 确认写入（两段式幂等 upsert）→ 刷新 tasks 镜像 → toast 摘要 */
  commitPayload(
    repos: IRepositoryBundle,
    payloadJson: unknown,
    projectId?: string,
  ): Promise<ApplyResult | null>;
  /** 生成 handoff bundle（Markdown 文本），同时写入 handoffText */
  buildHandoff(repos: IRepositoryBundle, projectId: string): Promise<string>;
  /** 认领（原子；争抢失败 toast Conflict 文案） */
  claimTask(repos: IRepositoryBundle, taskId: string, memberId: string): Promise<void>;
  /** UI 手动流转（严格通道：assertTransition 白名单） */
  transitionTask(repos: IRepositoryBundle, taskId: string, to: TaskStatus): Promise<void>;
}

export const useAgentStore = create<AgentState>((set) => ({
  currentProjectId: null,
  previewResult: null,
  handoffText: null,
  drawerTaskId: null,
  columnFilter: 'all',

  setCurrentProject: (id) => set({ currentProjectId: id }),
  setColumnFilter: (filter) => set({ columnFilter: filter }),
  openDrawer: (taskId) => set({ drawerTaskId: taskId }),

  previewPayload: async (repos, payloadJson, projectId) => {
    const projectsStore = useProjectsStore.getState();
    try {
      const validated = validateOrToast(payloadJson, projectsStore.pushToast);
      if (!validated) return null;
      const result = await previewAgentPayload(repos, validated, { projectId });
      set({ previewResult: result });
      return result;
    } catch (err) {
      projectsStore.pushToast(
        'error',
        err instanceof ChangxiaError ? err.userMessage : 'payload 预览失败。',
      );
      return null;
    }
  },

  commitPayload: async (repos, payloadJson, projectId) => {
    const projectsStore = useProjectsStore.getState();
    try {
      const validated = validateOrToast(payloadJson, projectsStore.pushToast);
      if (!validated) return null;
      const result = await applyAgentPayload(repos, validated, { projectId });
      set({ previewResult: result });
      // 刷新该项目 tasks 镜像（与 createFromContract 同款项目级替换）
      const pid = validated.projectId ?? projectId;
      if (pid) {
        const fresh = await repos.tasks.listByProject(pid);
        useProjectsStore.setState((st) => ({
          tasks: [...st.tasks.filter((t) => t.projectId !== pid), ...fresh],
        }));
      }
      projectsStore.pushToast(
        'success',
        `写入完成：新增 ${result.created} / 更新 ${result.updated}` +
          (result.rejected.length > 0 ? ` / 拒绝 ${result.rejected.length}` : ''),
      );
      return result;
    } catch (err) {
      projectsStore.pushToast(
        'error',
        err instanceof ChangxiaError ? err.userMessage : 'payload 写入失败。',
      );
      return null;
    }
  },

  buildHandoff: async (repos, projectId) => {
    const projectsStore = useProjectsStore.getState();
    try {
      const [project, tasks, members] = await Promise.all([
        repos.projects.get(projectId),
        repos.tasks.listByProject(projectId),
        repos.members.list(true),
      ]);
      const { ready, blocked, layerIndex } = computeReadyTasks(tasks);
      // 安全边界（HF-04）：只给「id → 展示名」纯字符串映射，绝不传 Member 实体
      const assigneeLabels: Record<string, string> = {};
      for (const m of members) {
        assigneeLabels[m.id] = m.actorKind === 'agent' && m.agentKind ? m.agentKind : m.name;
      }
      const text = buildHandoffBundle({
        projectName: project?.name ?? '未命名项目',
        generatedAt: new Date().toISOString(),
        ready,
        blocked,
        layerIndex,
        agentKindLabel: null,
        assigneeLabels,
      });
      set({ handoffText: text });
      return text;
    } catch (err) {
      projectsStore.pushToast(
        'error',
        err instanceof ChangxiaError ? err.userMessage : '交接包生成失败。',
      );
      return '';
    }
  },

  claimTask: async (repos, taskId, memberId) => {
    const projectsStore = useProjectsStore.getState();
    try {
      const updated = await new TaskService(repos.tasks).claim(taskId, memberId);
      projectsStore.putTask(updated);
      projectsStore.pushToast('success', '已认领，开始执行');
    } catch (err) {
      projectsStore.pushToast(
        'error',
        err instanceof ChangxiaError ? err.userMessage : '认领失败。',
      );
    }
  },

  transitionTask: async (repos, taskId, to) => {
    const projectsStore = useProjectsStore.getState();
    try {
      const updated = await new TaskService(repos.tasks).transitionStatus(taskId, to);
      projectsStore.putTask(updated);
      projectsStore.pushToast('success', '状态已更新');
    } catch (err) {
      projectsStore.pushToast(
        'error',
        err instanceof ChangxiaError ? err.userMessage : '状态流转失败。',
      );
    }
  },
}));

/** 结构校验辅助：失败 → 逐条 toast（最多 3 条）+ 返回 null；成功返回归一后的 payload */
function validateOrToast(
  payloadJson: unknown,
  pushToast: (kind: 'success' | 'error' | 'info', message: string) => number,
): AgentPayloadV1 | null {
  const res = tryValidateAgentPayload(payloadJson);
  if (res.ok) return res.payload;
  const first = res.issues.slice(0, 3);
  for (const issue of first) {
    pushToast('error', `payload 校验失败：${issue.path} ${issue.message}`);
  }
  if (res.issues.length > first.length) {
    pushToast('error', `……另有 ${res.issues.length - first.length} 条结构错误未展示。`);
  }
  return null;
}

/** 便捷派生：当前项目的任务里是否还有未完成项（供指标卡空态判断等使用） */
export function hasOpenTasks(tasks: readonly Task[]): boolean {
  return tasks.some((t) => !taskIsDone(t));
}
