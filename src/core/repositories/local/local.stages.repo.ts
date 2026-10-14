import dayjs from 'dayjs';

import { ChangxiaErrorCode, StageStatus, coreError } from '../../types/enums';
import type { Stage } from '../../types/entities';
import type { UpdateStageCmd } from '../../types/dto';
import type { IStagesRepository } from '../interfaces';
import type { ChangxiaDatabase } from './dexie.database';
import { pickDefined } from './local.projects.repo';

/** Dexie 实现的阶段仓储 */
export class LocalStagesRepository implements IStagesRepository {
  constructor(private readonly db: ChangxiaDatabase) {}

  async listByProject(projectId: string): Promise<Stage[]> {
    try {
      const rows = await this.db.stages.where('projectId').equals(projectId).toArray();
      return rows.sort((a, b) => a.orderIndex - b.orderIndex);
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.stage.listReadFailed', undefined, err);
    }
  }

  async get(id: string): Promise<Stage | null> {
    try {
      return (await this.db.stages.get(id)) ?? null;
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.stage.readFailed', undefined, err);
    }
  }

  async bulkInsert(rows: Stage[]): Promise<void> {
    if (rows.length === 0) return;
    for (const r of rows) {
      if (!r.projectId || !r.id || typeof r.orderIndex !== 'number') {
        throw coreError(ChangxiaErrorCode.Validation, 'coreErr.stage.draftIncomplete');
      }
      if (dayjs(r.endAt).isBefore(dayjs(r.startAt))) {
        throw coreError(ChangxiaErrorCode.Validation, 'coreErr.stage.rangeReversed', { name: r.name });
      }
    }
    try {
      await this.db.stages.bulkAdd(rows);
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.stage.bulkWriteFailed', undefined, err);
    }
  }

  async update(id: string, cmd: UpdateStageCmd): Promise<Stage> {
    const existing = await this.db.stages.get(id);
    if (!existing) {
      throw coreError(ChangxiaErrorCode.NotFound, 'coreErr.stage.notFound');
    }
    const next: Stage = {
      ...existing,
      ...pickDefined(cmd),
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.db.stages.put(next);
    return next;
  }

  /** 改期落库（状态联动由 service 决定）；流水写入在 service 层编排 */
  async reschedule(
    id: string,
    startAt: string,
    endAt: string,
    status?: StageStatus,
  ): Promise<Stage> {
    const existing = await this.db.stages.get(id);
    if (!existing) {
      throw coreError(ChangxiaErrorCode.NotFound, 'coreErr.stage.notFound');
    }
    const start = dayjs(startAt);
    const end = dayjs(endAt);
    if (!start.isValid() || !end.isValid()) {
      throw coreError(ChangxiaErrorCode.Validation, 'coreErr.stage.badDate');
    }
    if (end.isBefore(start)) {
      throw coreError(ChangxiaErrorCode.Validation, 'coreErr.stage.endBeforeStart');
    }
    const next: Stage = {
      ...existing,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      ...(status ? { status } : {}),
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.db.stages.put(next);
    return next;
  }
}
