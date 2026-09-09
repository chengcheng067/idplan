import { ChangxiaError, ChangxiaErrorCode, TaskStatus } from '../../types/enums';
import type { Task } from '../../types/entities';
import type { CreateTaskCmd, UpdateTaskCmd } from '../../types/dto';
import type { ITasksRepository, TaskQuery } from '../interfaces';
import type { ChangxiaDatabase } from './dexie.database';
import { pickDefined } from './local.projects.repo';
import { taskAssigneeIds } from '../../../hooks/useRoleGuard';

/** Dexie 实现的任务仓储 */
export class LocalTasksRepository implements ITasksRepository {
  constructor(private readonly db: ChangxiaDatabase) {}

  async list(query?: TaskQuery): Promise<Task[]> {
    try {
      let rows = await this.db.tasks.toArray();
      if (query?.projectId) rows = rows.filter((t) => t.projectId === query.projectId);
      if (query?.stageId) rows = rows.filter((t) => t.stageId === query.stageId);
      // v0.3：参与人包含语义（assigneeIds 或 assigneeId 命中即返回），与 useRoleGuard.taskAssigneeIds 同口径
      if (query?.assigneeId) rows = rows.filter((t) => taskAssigneeIds(t).includes(query.assigneeId as string));
      if (typeof query?.done === 'boolean') rows = rows.filter((t) => t.done === query.done);
      return rows.sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '任务列表读取失败。', err);
    }
  }

  async listByProject(projectId: string): Promise<Task[]> {
    return this.list({ projectId });
  }

  /** 参与人包含语义：memberId 出现在 assigneeIds 或等于 assigneeId 即命中（v0.3） */
  async listByAssignee(memberId: string): Promise<Task[]> {
    return this.list({ assigneeId: memberId });
  }

  async bulkInsert(rows: Task[]): Promise<void> {
    if (rows.length === 0) return;
    for (const r of rows) {
      if (!r.id || !r.projectId || !r.stageId || !r.title?.trim()) {
        throw new ChangxiaError(ChangxiaErrorCode.Validation, '任务草稿字段不完整，无法入库。');
      }
    }
    try {
      await this.db.tasks.bulkAdd(rows);
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '任务批量写入失败。', err);
    }
  }

  async insert(cmd: CreateTaskCmd): Promise<Task> {
    if (!cmd.title?.trim()) {
      throw new ChangxiaError(ChangxiaErrorCode.Validation, '任务标题不能为空。');
    }
    const now = new Date().toISOString();
    const siblings = await this.list({ stageId: cmd.stageId });
    // 键序铁律：9 个 v0.6 字段按 §3.1 序 9–17 插在 dueDate 后、orderIndex 前，
    // 与 entities.Task / backup.taskSchema / project.service.taskRows 四处逐字同序——
    // 漏一处或乱序 → backup.roundtrip 的 JSON.stringify 逐表 diff 直接失败。
    // ★ externalId 只在显式提供时写键（undefined/不写键）：null 不是合法 IDB key，
    //   显式 null 会干扰 &externalId 唯一索引（见 migrateTaskV2Row 注释）。
    const row: Task = {
      id: crypto.randomUUID(),
      projectId: cmd.projectId,
      stageId: cmd.stageId,
      title: cmd.title.trim(),
      done: false,
      assigneeId: cmd.assigneeId ?? null,
      assigneeIds: cmd.assigneeIds ?? (cmd.assigneeId ? [cmd.assigneeId] : []),
      dueDate: cmd.dueDate ?? null,
      source: cmd.source ?? 'human',
      externalId: cmd.externalId,
      agentId: cmd.agentId ?? null,
      status: cmd.status ?? TaskStatus.Draft,
      description: cmd.description ?? null,
      dependsOn: cmd.dependsOn ?? [],
      artifacts: cmd.artifacts ?? [],
      startAt: cmd.startAt ?? null,
      orderIndex: siblings.reduce((max, t) => Math.max(max, t.orderIndex), 0) + 1,
      revision: 1,
      updatedAt: now,
    } as Task;
    await this.db.tasks.add(row);
    return row;
  }

  async update(id: string, cmd: UpdateTaskCmd): Promise<Task> {
    const existing = await this.db.tasks.get(id);
    if (!existing) {
      throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该任务。');
    }
    const patch = pickDefined(cmd);
    // v0.6 状态双写（status ⇄ done 恒一致，写入侧唯一口径）：
    //   - 传 status → done = (status === 'done')（withStatus 语义）；
    //   - 只传 done（存量调用路径，如 @deprecated toggleDone）→ 反推 status。
    //   绝不允许两字段漂移——否则 taskIsDone 与看板状态角标会互相矛盾。
    let nextStatus = patch.status;
    if (nextStatus === undefined && patch.done !== undefined) {
      nextStatus = patch.done ? TaskStatus.Done : TaskStatus.Draft;
    }
    const next: Task = {
      ...existing,
      ...patch,
      ...(nextStatus !== undefined
        ? { status: nextStatus, done: nextStatus === TaskStatus.Done }
        : {}),
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.db.tasks.put(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    try {
      await this.db.tasks.delete(id);
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '任务删除失败。', err);
    }
  }
}
