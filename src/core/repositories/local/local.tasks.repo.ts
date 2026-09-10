import { ChangxiaError, ChangxiaErrorCode, TaskStatus } from '../../types/enums';
import type { Task } from '../../types/entities';
import { taskIsDone, withStatus, normalizeClaimedAt } from '../../types/entities';
import type { CreateTaskCmd, UpdateTaskCmd } from '../../types/dto';
import type { ITasksRepository, TaskQuery, TaskUpsertRow } from '../interfaces';
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
      // @deprecated 兼容维度：读取侧统一走 taskIsDone（status 是唯一事实源）
      if (typeof query?.done === 'boolean') rows = rows.filter((t) => taskIsDone(t) === query.done);
      // v0.6 新维度：source / agentId / status（单值或数组）/ externalId（内存 filter，与既有风格一致）
      if (query?.source) rows = rows.filter((t) => t.source === query.source);
      if (query?.agentId) rows = rows.filter((t) => t.agentId === query.agentId);
      if (query?.status) {
        const wanted = Array.isArray(query.status) ? query.status : [query.status];
        rows = rows.filter((t) => wanted.includes(t.status));
      }
      if (query?.externalId) rows = rows.filter((t) => t.externalId === query.externalId);
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

  async get(id: string): Promise<Task | null> {
    try {
      const row = await this.db.tasks.get(id);
      return row ?? null;
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '任务读取失败。', err);
    }
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
      claimedAt: null, // §3.1 序 17：缺省 null（非 undefined）——claim 校验 `claimedAt === null` 依赖显式键
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
    // ★ B-01 不变式：status=ready ⟹ claimedAt=null（规则唯一出处：normalizeClaimedAt）。
    // 判定用**生效后**的 status（patch.status ?? 存量 status）而非只判 patch.status：
    //   ① 只传 status='ready' 的释放动作 → 必须清掉旧 claimedAt；
    //   ② 只传 title 这类**非状态**字段时，存量 status 若已是 ready 且 claimedAt
    //      残留（历史脏数据），也要顺手清掉——否则一次普通改名就会把僵尸行
    //      「固化」为正常行，让问题永远查不出来。
    const effectiveStatus = nextStatus ?? existing.status;
    const nextClaimedAt = normalizeClaimedAt(
      effectiveStatus,
      patch.claimedAt !== undefined ? patch.claimedAt : existing.claimedAt,
    );
    const next: Task = {
      ...existing,
      ...patch,
      ...(nextStatus !== undefined
        ? { status: nextStatus, done: nextStatus === TaskStatus.Done }
        : {}),
      claimedAt: nextClaimedAt,
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.db.tasks.put(next);
    return next;
  }

  /**
   * 幂等批量写入（§3.5）：单 rw 事务，逐行按 externalId 先查后写。
   * 命中 → put({...existing, ...patch, revision+1, updatedAt})；未命中 → add。
   * done 恒由 status 派生（withStatus 语义），绝不接受「两者矛盾」的行。
   * Dexie 唯一索引冲突（同 externalId 并发抢建）→ ConstraintError → Conflict。
   */
  async upsertByExternalId(rows: readonly TaskUpsertRow[]): Promise<{ created: number; updated: number }> {
    if (rows.length === 0) return { created: 0, updated: 0 };
    for (const r of rows) {
      if (!r.externalId?.trim()) {
        throw new ChangxiaError(ChangxiaErrorCode.Validation, '幂等键 externalId 不能为空。');
      }
      if (!r.projectId || !r.stageId || !r.title?.trim()) {
        throw new ChangxiaError(ChangxiaErrorCode.Validation, '任务字段不完整，无法写入。');
      }
    }
    try {
      return await this.db.transaction('rw', this.db.tasks, async () => {
        let created = 0;
        let updated = 0;
        const now = new Date().toISOString();
        for (const r of rows) {
          const externalId = r.externalId.trim();
          const existing = await this.db.tasks.where('externalId').equals(externalId).first();
          if (existing) {
            // 命中 → 合并 patch（done 由 status 重派生，防双字段漂移）。
            // orderIndex 仅新建语义：更新路径保持既有排序，防止重导入反复重排。
            const { orderIndex: _ignoredOrder, ...patch } = r;
            void _ignoredOrder;
            const nextStatus = r.status ?? existing.status;
            const next: Task = {
              ...existing,
              ...patch,
              id: existing.id, // 幂等：以既有行为准，忽略 row 自带的任何 id 形状
              orderIndex: existing.orderIndex,
              externalId,
              status: nextStatus,
              done: nextStatus === TaskStatus.Done,
              // ★ B-01 不变式：Agent 重发同 payload 时若把状态带回 ready，
              // 必须同时清掉 claimedAt，否则一次重导入就再制造一个认领僵尸。
              claimedAt: normalizeClaimedAt(nextStatus, patch.claimedAt),
              revision: existing.revision + 1,
              updatedAt: now,
            };
            await this.db.tasks.put(next);
            updated += 1;
          } else {
            const row: Task = {
              ...r,
              id: crypto.randomUUID(),
              externalId,
              status: r.status ?? TaskStatus.Draft,
              done: (r.status ?? TaskStatus.Draft) === TaskStatus.Done,
              // ★ B-01 不变式（新建路径同样适用）：status=ready 的行不得带 claimedAt
              claimedAt: normalizeClaimedAt(r.status ?? TaskStatus.Draft, r.claimedAt),
              revision: 1,
              updatedAt: now,
            };
            await this.db.tasks.add(row);
            created += 1;
          }
        }
        return { created, updated };
      });
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
      // 唯一索引（&externalId）竞态冲突 → ConstraintError → 语义化 Conflict
      if (err instanceof Error && err.name === 'ConstraintError') {
        throw new ChangxiaError(ChangxiaErrorCode.Conflict, '任务幂等键冲突，请重试导入。', err);
      }
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '任务幂等写入失败。', err);
    }
  }

  /**
   * 原子认领（§3.5）：单 rw 事务内 校验 ready 且未认领 → 置 claimed + 记 claimedAt。
   * 并发争抢由 Dexie rw 事务串行化保证：后到者读到 claimedAt !== null → Conflict。
   */
  async claim(taskId: string, actorMemberId: string): Promise<Task> {
    if (!actorMemberId?.trim()) {
      throw new ChangxiaError(ChangxiaErrorCode.Validation, '认领人不能为空。');
    }
    try {
      return await this.db.transaction('rw', this.db.tasks, async () => {
        const existing = await this.db.tasks.get(taskId);
        if (!existing) {
          throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该任务。');
        }
        if (existing.status !== TaskStatus.Ready || existing.claimedAt !== null) {
          throw new ChangxiaError(
            ChangxiaErrorCode.Conflict,
            '该任务已被认领或不处于就绪状态。',
          );
        }
        const next = withStatus(
          {
            ...existing,
            assigneeId: actorMemberId,
            claimedAt: new Date().toISOString(),
          },
          TaskStatus.Claimed,
        );
        await this.db.tasks.put(next);
        return next;
      });
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '任务认领失败。', err);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.db.tasks.delete(id);
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '任务删除失败。', err);
    }
  }
}
