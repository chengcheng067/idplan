/**
 * 备份夹具共享：13 键全空集的 BackupPackage。
 *
 * 为什么存在：多个 spec 用「空包」做 fake-indexeddb 的清库重建基线，但 `BackupPackage`
 * 已经演进到 13 张表（新增 itineraries / executions / executionAttempts / executionEvents /
 * writebackProposals）。逐文件复制字面量必然在「下次再加表」时漏键 → 编译错误。
 * 集中到这里，新增表只需改一处。
 *
 * schemaVersion 透传：legacy / import-failure 类用例需要造「旧版 (v1)」备份，故开放参数；
 * 其余清库基线默认 v3（现行导出版本）。
 */
import type { BackupPackage } from '../../src/core/types/dto';

export function emptyPackage(schemaVersion: 1 | 2 | 3 = 3): BackupPackage {
  return {
    meta: { app: 'changxia', schemaVersion, exportedAt: '2026-09-01T00:00:00.000Z' },
    data: {
      projects: [],
      stages: [],
      tasks: [],
      itineraries: [],
      members: [],
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
      executions: [],
      executionAttempts: [],
      executionEvents: [],
      writebackProposals: [],
    },
  };
}
