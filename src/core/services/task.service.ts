/**
 * 任务状态机服务（v0.6 · 设计文档 T09 / §3.3）。
 *
 * 两条通道纪律（铁律级）：
 *   - **严格通道**（本文件）：UI 手动改状态必须走 `transitionStatus()` ——
 *     先 `assertTransition()` 查 `TASK_STATUS_TRANSITIONS` 白名单，再经 `withStatus`
 *     双写落库（done 恒由 status 派生，绝不漂移）；
 *   - **宽松通道**（payload.apply）：Agent payload 导入直落给定 status，不走本文件——
 *     上游 Agent 是事实源，它对任务生命周期的裁断不服从 App 内的白名单。
 *
 * 依赖：只依赖 `ITasksRepository`（含 v0.6 新增的 get/claim），零直接 DB 访问。
 */

import {
  ChangxiaError,
  ChangxiaErrorCode,
  TASK_STATUS_LABELS,
  TASK_STATUS_TRANSITIONS,
  TaskStatus,
} from '../types/enums';
import { withStatus } from '../types/entities';
import type { Task } from '../types/entities';
import type { ITasksRepository } from '../repositories/interfaces';

export class TaskService {
  public constructor(private readonly tasks: ITasksRepository) {}

  /**
   * 流转合法性闸门：`from → to` 不在白名单 → 抛 Validation，文案含中文状态名
   * （如「不允许从「草稿」流转到「已完成」。」）。
   */
  public assertTransition(from: TaskStatus, to: TaskStatus): void {
    const allowed = TASK_STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Validation,
        `不允许从「${TASK_STATUS_LABELS[from]}」流转到「${TASK_STATUS_LABELS[to]}」。`,
      );
    }
  }

  /**
   * UI 手动流转（严格通道）：读取权威当前 status → assertTransition → withStatus 双写。
   * 乐观更新由 store 层负责；本方法失败即抛 ChangxiaError，store 回滚镜像。
   */
  public async transitionStatus(taskId: string, to: TaskStatus): Promise<Task> {
    const current = await this.tasks.get(taskId);
    if (!current) {
      throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该任务。');
    }
    this.assertTransition(current.status, to);
    // update() 内部按 status 重派生 done（withStatus 语义），此处无需重复双写
    return this.tasks.update(taskId, { status: to });
  }

  /**
   * 认领薄封装：直接转发 `repo.claim()`（原子性在仓储事务内保证），
   * 统一错误口径（NotFound / Conflict 的 userMessage 由 repo 给出）。
   */
  public async claim(taskId: string, memberId: string): Promise<Task> {
    return this.tasks.claim(taskId, memberId);
  }
}
