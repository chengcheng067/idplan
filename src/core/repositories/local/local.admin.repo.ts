import type { BackupPackage } from '../../types/dto';
import type {
  AssignmentLog,
  ContractRecord,
  Execution,
  ExecutionAttempt,
  ExecutionEvent,
  ItineraryDay,
  Member,
  Project,
  Setting,
  Stage,
  StageLog,
  Task,
  WritebackProposal,
} from '../../types/entities';
import { ChangxiaError, ChangxiaErrorCode } from '../../types/enums';
import { BACKUP_SCHEMA_VERSION } from '../../services/backup.service';
import type { IAdminRepository } from '../interfaces';
import { ALL_TABLE_NAMES, type AllTableName, type ChangxiaDatabase } from './dexie.database';
// ★ v0.7：号段归一与计数器追平走**共享纯函数**（与 local/remote/server 同一份算式）。
import {
  TASK_NO_SEQ_KEY,
  maxTaskNoOf,
  parseTaskNoSeq,
  resolveTaskNoCollisions,
} from '../../lib/task-no';

/**
 * local 适配器的备份/引导管理通道（admin）。
 * fullExport：并行读八张表整表（append-only 流水完整保真）。
 * replaceAllImport：单 Dexie 事务内 clear + bulkPut —— 原子性由 Dexie transaction 保证。
 */
export class LocalAdminRepository implements IAdminRepository {
  public constructor(private readonly db: ChangxiaDatabase) {}

  public async fullExport(): Promise<BackupPackage> {
    try {
      const [
        projects,
        stages,
        tasks,
        itineraries,
        members,
        assignments,
        logs,
        contracts,
        settings,
        executions,
        executionAttempts,
        executionEvents,
        writebackProposals,
      ] = await Promise.all([
        this.db.projects.toArray() as Promise<Project[]>,
        this.db.stages.toArray() as Promise<Stage[]>,
        this.db.tasks.toArray() as Promise<Task[]>,
        this.db.itineraries.toArray() as Promise<ItineraryDay[]>,
        this.db.members.toArray() as Promise<Member[]>,
        this.db.assignments.toArray() as Promise<AssignmentLog[]>,
        this.db.stageLogs.toArray() as Promise<StageLog[]>,
        this.db.contracts.toArray() as Promise<ContractRecord[]>,
        this.db.settings.toArray() as Promise<Setting[]>,
        this.db.executions.toArray() as Promise<Execution[]>,
        this.db.executionAttempts.toArray() as Promise<ExecutionAttempt[]>,
        this.db.executionEvents.toArray() as Promise<ExecutionEvent[]>,
        this.db.writebackProposals.toArray() as Promise<WritebackProposal[]>,
      ]);
      return {
        meta: {
          app: 'changxia',
          schemaVersion: BACKUP_SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
        },
        data: {
          projects,
          stages,
          tasks,
          itineraries,
          members,
          assignments,
          logs,
          contracts,
          settings,
          executions,
          executionAttempts,
          executionEvents,
          writebackProposals,
        },
      };
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '全量导出失败。', err);
    }
  }

  /**
   * 清库重建：任一步失败整体回滚，不允许半套写入。
   *
   * ★ v0.7 返回值 `renumbered` = 本次导入中因**包内号段自身冲突**被重编号的任务数
   *   （正常包恒为 0）。
   *
   * 刻意**不接 UI toast**（§11-③ 已裁定）：跨库「合并导入」路径**不可达**
   * （两端都是整库替换，见 §9-D5），故 `renumbered > 0` 只在**包自身已损坏**
   * （同一个号出现两次）时出现 —— 属异常数据而非正常业务流程。
   * 给一条不存在的路径做界面是错的。返回值保留**仅供单测断言**。
   */
  public async replaceAllImport(pkg: BackupPackage): Promise<{ renumbered: number }> {
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
        case 'itineraries':
          // 兼容仍按旧 BackupPackage 形状直接调用 admin 的存量路径：
          // validateBackupJson 会补 []，但 admin 本身也必须安全处理缺失字段。
          return pkg.data.itineraries ?? [];
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
        // v5 Agent 执行域四表：旧备份缺这些字段时安全默认 []，不整包拒绝。
        case 'executions':
          return pkg.data.executions ?? [];
        case 'executionAttempts':
          return pkg.data.executionAttempts ?? [];
        case 'executionEvents':
          return pkg.data.executionEvents ?? [];
        case 'writebackProposals':
          return pkg.data.writebackProposals ?? [];
        default:
          return [];
      }
    };

    let renumbered = 0;
    try {
      await this.db.transaction('rw', [...ALL_TABLE_NAMES], async () => {
        // ★ v0.7（§2.9.1）：**本地**计数器必须在 clear **之前**读 —— clear 会把它一起清掉。
        //   读数与 clear 同事务且早于 clear，故读到的必然是「导入前」的真实值。
        //   漏掉「本地 seq」这一项的真实撞号路径：A 机导出（seq=1043）→ B 机导入
        //   （B 机 seq=1000）→ B 机新建又发 T-1000，而包里可能本来就有 T-1000。
        const localSeq = parseTaskNoSeq((await this.db.settings.get(TASK_NO_SEQ_KEY))?.valueJson);

        // 号段归一：保留先到者、后到者重编号，并算出「导入后应落的计数器值」。
        // `existingNos` 传空集的依据：本方法先 clear 后 bulkPut，导入瞬间库内无既有行，
        // 「与库内撞号」**不可达**，只剩**包内**查重（§2.9）。参数保留以便将来
        // 新增「合并导入」模式时本函数直接可用。
        const pkgSeqRow = pkg.data.settings.find((s) => s.key === TASK_NO_SEQ_KEY);
        const pkgSeq = parseTaskNoSeq(pkgSeqRow?.valueJson);
        const resolved = resolveTaskNoCollisions(pkg.data.tasks, {
          seqFromSettings: pkgSeq,
          maxTaskNoInDb: maxTaskNoOf(pkg.data.tasks),
          existingNos: new Set<number>(),
          localSeq,
        });
        renumbered = resolved.renumbered;

        // 计数器回写两准则（都是为了不破坏 §2.15-① 的「导出→导入→再导出 逐表全等」）：
        //   · 包里**没有**该行 → **不发明一行**。否则 settings 表凭空多一条，diff 必挂；
        //     而且这是安全的：新建路径的 initTaskNoSeq 会用「库内 max+1」现算，不会撞号。
        //   · 包里**有**该行但归一后值未变 → **连 updatedAt 都不动**。否则同一台机器的
        //     常规往返会因一次无意义的 updatedAt 刷新而在 JSON.stringify 上不等。
        // 只有「确有该行」且「确实需要前进」时才改写。
        const settingsRows: Setting[] =
          pkgSeqRow && resolved.next !== pkgSeq
            ? pkg.data.settings.map((s) =>
                s.key === TASK_NO_SEQ_KEY
                  ? {
                      key: TASK_NO_SEQ_KEY,
                      valueJson: JSON.stringify(resolved.next),
                      updatedAt: new Date().toISOString(),
                    }
                  : s,
              )
            : pkg.data.settings;

        for (const name of ALL_TABLE_NAMES) {
          await tableOf(name).clear();
        }
        for (const name of ALL_TABLE_NAMES) {
          let rows = rowsFor(name);
          if (name === 'tasks') {
            // 用归一后的行集（撞号的后到者已被重编号）
            rows = resolved.rows;
            // v0.6：externalId 空值在 Dexie 侧**不写该键**（null 不是合法 IDB key，
            // 显式 null 键在 &[projectId+externalId] 唯一索引下的行为因实现而异）。
            // 备份 zod 归一会把缺失补成 null —— 这里在落库前归一回「不写键」；
            // 导出侧再经 zod 补回 null，roundtrip 的 JSON.stringify diff 不受影响。
            rows = (rows as Array<Record<string, unknown>>).map((r) => {
              if (r.externalId !== null && r.externalId !== undefined) return r;
              const { externalId: _drop, ...rest } = r;
              return rest;
            }) as unknown[];
          }
          if (name === 'settings') {
            rows = settingsRows;
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
    return { renumbered };
  }
}
