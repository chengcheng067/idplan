import type { BackupPackage } from '../../types/dto';
import type {
  AssignmentLog,
  ContractRecord,
  Member,
  Project,
  Setting,
  Stage,
  StageLog,
  Task,
} from '../../types/entities';
import { ChangxiaError, ChangxiaErrorCode } from '../../types/enums';
import { BACKUP_SCHEMA_VERSION } from '../../services/backup.service';
import type { IAdminRepository } from '../interfaces';
import { ALL_TABLE_NAMES, type AllTableName, type ChangxiaDatabase } from './dexie.database';

/**
 * local 适配器的备份/引导管理通道（admin）。
 * fullExport：并行读八张表整表（append-only 流水完整保真）。
 * replaceAllImport：单 Dexie 事务内 clear + bulkPut —— 原子性由 Dexie transaction 保证。
 */
export class LocalAdminRepository implements IAdminRepository {
  public constructor(private readonly db: ChangxiaDatabase) {}

  public async fullExport(): Promise<BackupPackage> {
    try {
      const [projects, stages, tasks, members, assignments, logs, contracts, settings] =
        await Promise.all([
          this.db.projects.toArray() as Promise<Project[]>,
          this.db.stages.toArray() as Promise<Stage[]>,
          this.db.tasks.toArray() as Promise<Task[]>,
          this.db.members.toArray() as Promise<Member[]>,
          this.db.assignments.toArray() as Promise<AssignmentLog[]>,
          this.db.stageLogs.toArray() as Promise<StageLog[]>,
          this.db.contracts.toArray() as Promise<ContractRecord[]>,
          this.db.settings.toArray() as Promise<Setting[]>,
        ]);
      return {
        meta: {
          app: 'changxia',
          schemaVersion: BACKUP_SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
        },
        data: { projects, stages, tasks, members, assignments, logs, contracts, settings },
      };
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '全量导出失败。', err);
    }
  }

  /** 清库重建：任一步失败整体回滚，不允许半套写入 */
  public async replaceAllImport(pkg: BackupPackage): Promise<void> {
    const tableOf = (name: AllTableName) =>
      this.db[name as keyof ChangxiaDatabase] as unknown as {
        clear(): Promise<void>;
        bulkPut(rows: unknown[]): Promise<unknown>;
      };

    const rowsFor = (name: AllTableName): unknown[] => {
      switch (name) {
        case 'projects':
          return pkg.data.projects;
        case 'stages':
          return pkg.data.stages;
        case 'tasks':
          return pkg.data.tasks;
        case 'members':
          return pkg.data.members;
        case 'assignments':
          return pkg.data.assignments;
        case 'stageLogs':
          return pkg.data.logs;
        case 'contracts':
          return pkg.data.contracts;
        case 'settings':
          return pkg.data.settings;
        default:
          return [];
      }
    };

    try {
      await this.db.transaction('rw', [...ALL_TABLE_NAMES], async () => {
        for (const name of ALL_TABLE_NAMES) {
          await tableOf(name).clear();
        }
        for (const name of ALL_TABLE_NAMES) {
          let rows = rowsFor(name);
          if (name === 'tasks') {
            // v0.6：externalId 空值在 Dexie 侧**不写该键**（null 不是合法 IDB key，
            // 显式 null 键在 &externalId 唯一索引下的行为因实现而异）。
            // 备份 zod 归一会把缺失补成 null —— 这里在落库前归一回「不写键」；
            // 导出侧再经 zod 补回 null，roundtrip 的 JSON.stringify diff 不受影响。
            rows = (rows as Array<Record<string, unknown>>).map((r) => {
              if (r.externalId !== null && r.externalId !== undefined) return r;
              const { externalId: _drop, ...rest } = r;
              return rest;
            }) as unknown[];
          }
          if (rows.length > 0) await tableOf(name).bulkPut(rows);
        }
      });
    } catch (err) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Storage,
        '备份导入失败：已整体回滚，本地数据未受影响。',
        err,
      );
    }
  }
}
