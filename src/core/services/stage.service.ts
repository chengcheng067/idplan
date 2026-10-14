/**
 * 阶段领域服务：改期（延期原因强制闸门）与四态流转（解锁提醒信号）。
 * PRD 交互规则 1 + 铁律 8/11 的落地点。
 */

import dayjs from 'dayjs';

import { ChangxiaErrorCode, StageLogType, StageStatus, coreError } from '../types/enums';
import type { Stage } from '../types/entities';
import type { RescheduleStageCmd } from '../types/dto';
import type { ILogsRepository, IStagesRepository } from '../repositories/interfaces';

export interface StageServiceDeps {
  stages: IStagesRepository;
  logs: ILogsRepository;
}

/** 解锁提示信号：transition(to completed) 后由 UI 订阅 toast，不自动改数据 */
export interface UnlockHintSignal {
  nextStageId: string | null;
  nextStageName: string | null;
}

export class StageService {
  public constructor(private readonly deps: StageServiceDeps) {}

  /**
   * 改期硬闸门：newEnd > oldEnd 时 reason 必填（铁律）；平移/提前 reason 可空。
   * 返回更新后的 Stage；流水 append-only 写入 type=rescheduled。
   */
  public async reschedule(stageId: string, cmd: RescheduleStageCmd): Promise<Stage> {
    const existing = await this.deps.stages.get(stageId);
    if (!existing) {
      throw coreError(ChangxiaErrorCode.NotFound, 'coreErr.stage.notFound');
    }

    const newStart = dayjs(cmd.newStartAt);
    const newEnd = dayjs(cmd.newEndAt);
    if (!newStart.isValid() || !newEnd.isValid()) {
      throw coreError(ChangxiaErrorCode.Validation, 'coreErr.stage.newRangeInvalid');
    }
    if (newEnd.isBefore(newStart)) {
      throw coreError(ChangxiaErrorCode.Validation, 'coreErr.stage.newEndBeforeStart');
    }

    // ---- 硬闸门 ----
    const oldEndDay = dayjs(existing.endAt).format('YYYY-MM-DD');
    const newEndDay = newEnd.format('YYYY-MM-DD');
    const isPostponed = dayjs(newEndDay).isAfter(dayjs(oldEndDay));
    if (isPostponed && (!cmd.reason || cmd.reason.trim().length === 0)) {
      throw coreError(ChangxiaErrorCode.Validation, 'coreErr.stage.postponeReasonRequired');
    }
    const reason = isPostponed ? cmd.reason!.trim() : cmd.reason?.trim() || null;

    // 延期落库时状态联动 → delayed（若尚未 completed）
    const nextStatus =
      existing.status !== StageStatus.Completed && isPostponed
        ? StageStatus.Delayed
        : existing.status;

    const updated = await this.deps.stages.reschedule(
      stageId,
      newStart.toISOString(),
      newEnd.toISOString(),
      nextStatus,
    );

    await this.deps.logs.appendStageLog({
      stageId,
      projectId: updated.projectId,
      type: StageLogType.Rescheduled,
      fromStatus: existing.status,
      toStatus: updated.status,
      oldStartAt: existing.startAt,
      newStartAt: updated.startAt,
      oldEndAt: existing.endAt,
      newEndAt: updated.endAt,
      reason,
      operatorName: cmd.operatorName || '未知操作人',
    });

    return updated;
  }

  /**
   * 四态流转。非法迁移直接拒绝：
   *   - completed 后不允许回 not_started（需先人工改期为 in_progress 场景——MVP 从简直接禁止）
   *   - 任意态可进入 delayed 或恢复 in_progress/not_started（completed 除外的源）
   */
  public async transition(
    stageId: string,
    toStatus: StageStatus,
    operatorName: string,
  ): Promise<{ stage: Stage; unlockHint: UnlockHintSignal }> {
    const existing = await this.deps.stages.get(stageId);
    if (!existing) {
      throw coreError(ChangxiaErrorCode.NotFound, 'coreErr.stage.notFound');
    }
    if (existing.status === toStatus) {
      return { stage: existing, unlockHint: { nextStageId: null, nextStageName: null } };
    }
    if (existing.status === StageStatus.Completed && toStatus !== StageStatus.InProgress) {
      throw coreError(ChangxiaErrorCode.Conflict, 'coreErr.stage.completedOnlyReopenInProgress');
    }

    const updated = await this.deps.stages.update(stageId, {});
    // update({}) 不含 status 字段——这里显式走专用方法保证 revision bump 与类型安全
    const withStatus = await this.deps.stages.reschedule(
      stageId,
      updated.startAt,
      updated.endAt,
      toStatus,
    );

    await this.deps.logs.appendStageLog({
      stageId,
      projectId: withStatus.projectId,
      type: StageLogType.StatusChanged,
      fromStatus: existing.status,
      toStatus,
      oldStartAt: null,
      newStartAt: null,
      oldEndAt: null,
      newEndAt: null,
      reason: null,
      operatorName: operatorName || '未知操作人',
    });

    // 完成态解锁提示信号（不自动改数据）
    let unlockHint: UnlockHintSignal = { nextStageId: null, nextStageName: null };
    if (toStatus === StageStatus.Completed) {
      const siblings = await this.deps.stages.listByProject(withStatus.projectId);
      const next = siblings.find((s) => s.orderIndex === withStatus.orderIndex + 1);
      unlockHint = {
        nextStageId: next?.id ?? null,
        nextStageName: next?.name ?? null,
      };
    }

    return { stage: withStatus, unlockHint };
  }
}
