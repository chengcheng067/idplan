import { ChangxiaError, ChangxiaErrorCode, coreError } from '../types/enums';
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
import { LocalWorkspacesRepo } from './local/local.workspaces.repo';

/**
 * 数据源工厂（进程启动时调用一次，见 repository.provider.tsx）。
 * local → Dexie 适配器；remote → REST 适配器（remote 目录）。
 *
 * ★ 多工作区（批 4）：`cfg.workspaceId` **只对 remote 有消费方**（→ `X-Workspace-Id`），
 *   local 的「哪个区」由 `cfg.dbName` 表达。两者都从调用方一路带下来，工厂不做二次判断。
 */
export async function createRepositories(
  cfg: RepositoryFactoryConfig,
): Promise<IRepositoryBundle> {
  if (cfg.dataSource === 'remote') {
    // 动态 import：local 构建产物不携带 remote 代码，反之亦然
    const { createRemoteRepositories } = await import('./remote/rest.client');
    return createRemoteRepositories(cfg.apiBaseUrl ?? '', cfg.workspaceId ?? '');
  }
  try {
    const db = await openDatabase(cfg.dbName);
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
      /*
       * local 的工作区仓储要「列注册表」——注册表在 `src/lib/workspace-registry.ts`，
       * 读 localStorage。工厂住在 `src/core/`，**不能**在这里 import 它（arch-boundary
       * 把浏览器存储锁在 core 之外），故回调由调用方经 `cfg.workspaceListRegistry`
       * 注入（`src/di/repository.provider.tsx` 就合法，它在 `src/di/`）。
       * 没注入时 `list()` **抛错**而不是返回空数组：空数组在首屏会被读成
       * 「这台电脑上没有工作区」，是个假空态（本仓审计明令禁止的那一类）。
       */
      workspaces: new LocalWorkspacesRepo({
        listRegistry: cfg.workspaceListRegistry,
      }),
      admin: new LocalAdminRepository(db),
    };
  } catch (err) {
    if (err instanceof ChangxiaError) throw err;
    throw coreError(ChangxiaErrorCode.Storage, 'coreErr.datasource.initFailed', undefined, err);
  }
}

export type { ChangxiaDatabase };
