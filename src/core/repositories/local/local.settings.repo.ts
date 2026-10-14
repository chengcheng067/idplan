import { ChangxiaErrorCode, coreError } from '../../types/enums';
import type { Setting } from '../../types/entities';
import type { ISettingsRepository } from '../interfaces';
import type { ChangxiaDatabase } from './dexie.database';

/** Dexie 实现的 KV 设置仓储 */
export class LocalSettingsRepository implements ISettingsRepository {
  constructor(private readonly db: ChangxiaDatabase) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const row = await this.db.settings.get(key);
      return row ? (JSON.parse(row.valueJson) as T) : null;
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.setting.readFailed', { key }, err);
    }
  }

  async set(key: string, valueJson: unknown): Promise<void> {
    const row: Setting = {
      key,
      valueJson: JSON.stringify(valueJson),
      updatedAt: new Date().toISOString(),
    };
    try {
      await this.db.settings.put(row);
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.setting.writeFailed', { key }, err);
    }
  }

  async all(): Promise<Setting[]> {
    try {
      return await this.db.settings.toArray();
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.setting.tableReadFailed', undefined, err);
    }
  }

  async replaceAll(rows: Setting[]): Promise<void> {
    try {
      await this.db.transaction('rw', this.db.settings, async () => {
        await this.db.settings.clear();
        if (rows.length > 0) await this.db.settings.bulkPut(rows);
      });
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.setting.tableRebuildFailed', undefined, err);
    }
  }
}
