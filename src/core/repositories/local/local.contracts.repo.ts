import { coreError, ChangxiaErrorCode } from '../../types/enums';
import type { ContractRecord } from '../../types/entities';
import type { IContractsRepository } from '../interfaces';
import type { ChangxiaDatabase } from './dexie.database';

/** Dexie 实现的合同存证仓储（parsedResultJson 定稿后不可变） */
export class LocalContractsRepository implements IContractsRepository {
  constructor(private readonly db: ChangxiaDatabase) {}

  async insert(
    row: Omit<ContractRecord, 'id' | 'createdAt'> & { id?: string },
  ): Promise<ContractRecord> {
    const record: ContractRecord = {
      ...row,
      id: row.id ?? crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    try {
      await this.db.contracts.add(record);
      return record;
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.contract.recognitionWriteFailed', undefined, err);
    }
  }

  async get(id: string): Promise<ContractRecord | null> {
    try {
      return (await this.db.contracts.get(id)) ?? null;
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.contract.recognitionReadFailed', undefined, err);
    }
  }

  /** 建档后回链 projectId 与最终确认载荷——两条更新均不触碰 parsedResultJson 的定稿语义 */
  async linkProject(contractId: string, projectId: string): Promise<void> {
    await this.db.contracts.update(contractId, { projectId });
  }

  async saveConfirmedPayload(contractId: string, confirmedJson: string): Promise<void> {
    await this.db.contracts.update(contractId, { confirmedPayloadJson: confirmedJson });
  }

  async list(): Promise<ContractRecord[]> {
    try {
      const rows = await this.db.contracts.toArray();
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.contract.listReadFailed', undefined, err);
    }
  }
}
