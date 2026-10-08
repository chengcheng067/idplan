/**
 * 打印视图模型的 React 装载层（薄 hook；纯函数在 project-print-adapter.ts）。
 *
 * ── 数据来源与 useSchedulePaperData 的分工 ──
 * 经典纸面（SchedulePaper）继续走 useSchedulePaperData（分页 / 色带几何是它的
 * 算法）；四版模板走本 hook 的**只读投影**。两者读同一批 store，互不影响。
 *
 * ── stageLogs 为什么要「仓库优先 + store 缓存兜底」两级 ──
 * 阶段流水在 store 里是**按 stageId 的抽屉缓存**（useProjectsStore.stageLogs），
 * 只有打开过阶段抽屉 / 发生过改期流转的阶段才有值。打印预览从项目卡直达时缓存是
 * 冷的——若只读缓存，P3 延期台账会把「没加载过」显示成「无延期记录」，那是假空态。
 * 故有仓储上下文时整项目拉一次（listStageLogsByProject）；没有时（孤立渲染 /
 * 单测）退回缓存，保证纯函数路径可测。
 *
 * ── Agent 执行域（H 版）为什么也走「仓库拉取 + 失败回落空态」 ──
 * executions / proposals 不进任何 store（执行域是 Agent 看板的自留地，
 * 打印只读投影）。H 版批次在本 hook 补装载：listExecutionsByProject +
 * 逐单 listProposals（AgentBoardPage 同手法）；拉取失败**静默回落空态**
 * ——治理公示稿不许出现模拟记录（02 §8），空态是唯一诚实选项。
 *
 * ── 为什么用 try/catch 包 useRepos() ──
 * useRepos() 在无 RepoProvider 的环境（tests/print-options 等把本面板孤立渲染）
 * 会抛 ChangxiaError。本 hook 的装载是**尽力而为**：拿不到仓储就退回缓存，
 * 不该让「打印预览打不开」。useContext 在 try 外内已执行（抛错发生在它之后），
 * 每次渲染调用序列一致，hook 顺序稳定。
 */

import { useEffect, useMemo, useState } from 'react';

import { useMembersStore } from '../../store/useMembersStore';
import { useProjectsStore } from '../../store/useProjectsStore';
import { useProjectById, useProjectStages, useProjectTasks } from '../../core/project/visibility';
import { useRepos } from '../../hooks/useRepos';
import { useRoleGuard } from '../../hooks/useRoleGuard';
import type { Member, Project, Stage, StageLog, Task } from '../../core/types/entities';
import type { IRepositoryBundle } from '../../core/repositories/interfaces';
import type { Execution, WritebackProposal } from '../../core/types/agent-execution';

import { buildPrintViewModel } from './project-print-adapter';
import type { PrintViewModel } from '../model/print-view-model';

/** 尽力取仓储 bundle；无 Provider（孤立渲染 / 单测）时回落 null，不抛 */
function useReposOrNull(): IRepositoryBundle | null {
  try {
    return useRepos();
  } catch {
    return null;
  }
}

export interface PrintViewModelData {
  /** 视图模型（project 未就绪 / 未 hydrate 时为 null） */
  vm: PrintViewModel | null;
  project: Project | undefined;
  /** role 已 hydrate（首屏守卫闸门，与 useSchedulePaperData 同口径） */
  hydrated: boolean;
}

/** 把 store 的按阶段缓存摊平（兜底路径用） */
function flattenStageLogCache(
  cache: Record<string, StageLog[]>,
  stageIds: ReadonlySet<string>,
): StageLog[] {
  const out: StageLog[] = [];
  for (const id of stageIds) {
    const rows = cache[id];
    if (rows) out.push(...rows);
  }
  return out;
}

export function usePrintViewModel(projectId: string): PrintViewModelData {
  const project = useProjectById(projectId);
  const stages = useProjectStages(projectId);
  const tasks = useProjectTasks(projectId);
  const members = useMembersStore((s) => s.members);
  const stageLogCache = useProjectsStore((s) => s.stageLogs);
  const { role, currentMember, hydrated } = useRoleGuard();
  const repos = useReposOrNull();

  const [projectLogs, setProjectLogs] = useState<StageLog[] | null>(null);
  /**
   * Agent 执行域数据（H 版消费；地基的适配器入参已就绪，本 hook 补装载——
   * 「仓库优先、失败静默回落空态」：拉不到不进假数据，H 版走明确空态）。
   *
   * 提案按执行单逐条拉（仓储只有 listProposals(executionId) 维度），
   * 与 AgentBoardPage.tsx:347-352 同一手法。
   */
  const [agentData, setAgentData] = useState<{
    executions: Execution[];
    proposals: WritebackProposal[];
  } | null>(null);

  // 整项目拉一次流水（切项目 / bundle 就绪时重拉）；失败静默（退回缓存）
  useEffect(() => {
    if (!repos || !projectId) return;
    let alive = true;
    repos.logs
      .listStageLogsByProject(projectId)
      .then((rows) => {
        if (alive) setProjectLogs(rows);
      })
      .catch(() => {
        /* 拉取失败不阻断打印：退回 store 缓存 */
      });
    return () => {
      alive = false;
    };
  }, [repos, projectId]);

  // Agent 执行 + 写回提案（H 版数据面；失败静默 ⇒ 空态，不填模拟记录）
  useEffect(() => {
    if (!repos || !projectId) return;
    let alive = true;
    void (async () => {
      try {
        const executions = await repos.executions.listExecutionsByProject(projectId);
        const proposalRows = await Promise.all(
          executions.map((e) => repos.executions.listProposals(e.id)),
        );
        if (alive) setAgentData({ executions, proposals: proposalRows.flat() });
      } catch {
        /* 拉取失败不阻断打印：H 版回落明确空态（02 §8） */
      }
    })();
    return () => {
      alive = false;
    };
  }, [repos, projectId]);

  const vm = useMemo(() => {
    if (!project || !hydrated) return null;
    const stageIds = new Set(stages.map((s) => s.id));
    const stageLogs = projectLogs ?? flattenStageLogCache(stageLogCache, stageIds);
    return buildPrintViewModel({
      project,
      stages,
      tasks,
      members,
      stageLogs,
      executions: agentData?.executions,
      proposals: agentData?.proposals,
      role,
      currentMemberId: currentMember?.id ?? null,
    });
  }, [project, stages, tasks, members, stageLogCache, projectLogs, agentData, role, currentMember, hydrated]);

  return { vm, project, hydrated };
}
