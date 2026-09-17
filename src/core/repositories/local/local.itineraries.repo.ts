import { ChangxiaError, ChangxiaErrorCode } from '../../types/enums';
import type { ItineraryDay } from '../../types/entities';
import type { CreateItineraryDayCmd, UpdateItineraryDayCmd } from '../../types/dto';
import type { IItinerariesRepository } from '../interfaces';
import type { ChangxiaDatabase } from './dexie.database';
import { pickDefined } from './local.projects.repo';
import { dayjs, isIsoDate } from '../../../lib/date';

/**
 * 本地旅游每日行程仓储。
 *
 * 每个 projectId + date 只能有一行（Dexie 复合唯一索引）。ensureProjectDays 只补缺失日期，
 * 永不删除旧行：项目缩短、行程改期都不能静默清掉用户已经填的交通/住宿/费用和挂载任务。
 */
export class LocalItinerariesRepository implements IItinerariesRepository {
  constructor(private readonly db: ChangxiaDatabase) {}

  async listByProject(projectId: string): Promise<ItineraryDay[]> {
    try {
      const rows = await this.db.itineraries.where('projectId').equals(projectId).toArray();
      return rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '每日行程读取失败。', err);
    }
  }

  async ensureProjectDays(projectId: string, startDate: string, endDate: string): Promise<ItineraryDay[]> {
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
      throw new ChangxiaError(ChangxiaErrorCode.Validation, '旅游项目的起止日期无效，无法生成每日行程。');
    }
    try {
      await this.db.transaction('rw', this.db.itineraries, async () => {
        const existing = await this.db.itineraries.where('projectId').equals(projectId).toArray();
        const dates = new Set(existing.map((row) => row.date));
        const createdAt = new Date().toISOString();
        const missing: ItineraryDay[] = [];
        for (let cursor = dayjs(startDate); !cursor.isAfter(dayjs(endDate), 'day'); cursor = cursor.add(1, 'day')) {
          const date = cursor.format('YYYY-MM-DD');
          if (dates.has(date)) continue;
          missing.push({
            id: crypto.randomUUID(),
            projectId,
            date,
            transport: null,
            accommodation: null,
            budgetAmount: null,
            actualAmount: null,
            revision: 1,
            updatedAt: createdAt,
          });
        }
        if (missing.length > 0) await this.db.itineraries.bulkAdd(missing);
      });
      return this.listByProject(projectId);
    } catch (err) {
      if (err instanceof ChangxiaError) throw err;
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '每日行程生成失败。', err);
    }
  }

  async insert(cmd: CreateItineraryDayCmd): Promise<ItineraryDay> {
    if (!cmd.projectId || !isIsoDate(cmd.date)) {
      throw new ChangxiaError(ChangxiaErrorCode.Validation, '每日行程缺少有效项目或日期。');
    }
    const now = new Date().toISOString();
    const row: ItineraryDay = {
      id: crypto.randomUUID(),
      projectId: cmd.projectId,
      date: cmd.date,
      transport: cmd.transport ?? null,
      accommodation: cmd.accommodation ?? null,
      budgetAmount: cmd.budgetAmount ?? null,
      actualAmount: cmd.actualAmount ?? null,
      revision: 1,
      updatedAt: now,
    };
    try {
      await this.db.itineraries.add(row);
      return row;
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '每日行程创建失败。', err);
    }
  }

  async update(id: string, cmd: UpdateItineraryDayCmd): Promise<ItineraryDay> {
    const existing = await this.db.itineraries.get(id);
    if (!existing) {
      throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该每日行程。');
    }
    const next: ItineraryDay = {
      ...existing,
      ...pickDefined(cmd),
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    try {
      await this.db.itineraries.put(next);
      return next;
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '每日行程更新失败。', err);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.db.itineraries.delete(id);
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '每日行程删除失败。', err);
    }
  }
}
