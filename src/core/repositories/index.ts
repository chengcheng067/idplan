import { ChangxiaError, ChangxiaErrorCode } from '../types/enums';
import type { IRepositoryBundle, RepositoryFactoryConfig } from './interfaces';
import { ChangxiaDatabase, openDatabase } from './local/dexie.database';
import { LocalProjectsRepository } from './local/local.projects.repo';
import { LocalStagesRepository } from './local/local.stages.repo';
import { LocalTasksRepository } from './local/local.tasks.repo';
import { LocalItinerariesRepository } from './local/local.itineraries.repo';
import { LocalMembersRepository } from './local/local.members.repo';
import { LocalLogsRepository } from './local/local.logs.repo';
import { LocalContractsRepository } from './local/local.contracts.repo';
import { LocalSettingsRepository } from './local/local.settings.repo';
import { LocalAdminRepository } from './local/local.admin.repo';
import { LocalExecutionsRepository } from './local/local.execution.repo';

/**
 * 数据源工厂（进程启动时调用一次，见 repository.provider.tsx）。
 * local → Dexie 适配器；remote → REST 适配器（remote 目录）。
 */
export async function createRepositories(
  cfg: RepositoryFactoryConfig,
): Promise<IRepositoryBundle> {
  if (cfg.dataSource === 'remote') {
    // 动态 import：local 构建产物不携带 remote 代码，反之亦然
    const { createRemoteRepositories } = await import('./remote/rest.client');
    return createRemoteRepositories(cfg.apiBaseUrl ?? '');
  }
  try {
    const db = await openDatabase();
    return {
      projects: new LocalProjectsRepository(db),
      stages: new LocalStagesRepository(db),
      tasks: new LocalTasksRepository(db),
      itineraries: new LocalItinerariesRepository(db),
      members: new LocalMembersRepository(db),
      logs: new LocalLogsRepository(db),
      contracts: new LocalContractsRepository(db),
      settings: new LocalSettingsRepository(db),
      executions: new LocalExecutionsRepository(db),
      admin: new LocalAdminRepository(db),
    };
  } catch (err) {
    if (err instanceof ChangxiaError) throw err;
    throw new ChangxiaError(ChangxiaErrorCode.Storage, '本地数据源初始化失败。', err);
  }
}

export type { ChangxiaDatabase };
