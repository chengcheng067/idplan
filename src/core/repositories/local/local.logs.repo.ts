import { ChangxiaErrorCode, coreError } from '../../types/enums';
import type { AssignmentLog, StageLog } from '../../types/entities';
import type { ILogsRepository } from '../interfaces';
import type { ChangxiaDatabase } from './dexie.database';

/**
 * Dexie 实现的流水仓储（stage_logs + assignments）。
 * append-only（铁律 6）：仅暴露 append/list —— 类型系统层面锁死 UPDATE/DELETE。
 */
export class LocalLogsRepository implements ILogsRepository {
  constructor(private readonly db: ChangxiaDatabase) {}

  async appendStageLog(log: Omit<StageLog, 'id' | 'createdAt'>): Promise<StageLog> {
    const row: StageLog = {
      ...log,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    try {
      await this.db.stageLogs.add(row);
      return row;
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.log.stageAppendFailed', undefined, err);
    }
  }

  async listStageLogsByStage(stageId: string): Promise<StageLog[]> {
    try {
      const rows = await this.db.stageLogs.where('stageId').equals(stageId).toArray();
      // 升序（旧→新）：消费方以 logs[length-1] 取最新一条（QA 验收口径）
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.log.stageReadFailed', undefined, err);
    }
  }

  async listStageLogsByProject(projectId: string): Promise<StageLog[]> {
    try {
      const rows = await this.db.stageLogs.where('projectId').equals(projectId).toArray();
      // 升序（旧→新），与 listStageLogsByStage 口径一致
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.log.projectReadFailed', undefined, err);
    }
  }

  async appendAssignment(
    log: Omit<AssignmentLog, 'id' | 'createdAt'>,
  ): Promise<AssignmentLog> {
    const row: AssignmentLog = {
      ...log,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    try {
      await this.db.assignments.add(row);
      return row;
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.log.assignmentAppendFailed', undefined, err);
    }
  }

  async listAssignmentsByTask(taskId: string): Promise<AssignmentLog[]> {
    try {
      const rows = await this.db.assignments.where('taskId').equals(taskId).toArray();
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch (err) {
      throw coreError(ChangxiaErrorCode.Storage, 'coreErr.log.assignmentReadFailed', undefined, err);
    }
  }
}
