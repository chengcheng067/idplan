import { ChangxiaError, ChangxiaErrorCode, DEFAULT_PROJECT_KIND, ProjectStatus } from '../../types/enums';
import { DEFAULT_SCHEDULE_BASIS, type Project } from '../../types/entities';
import type {
  CreateProjectCmd,
  UpdateProjectCmd,
} from '../../types/dto';
import type { IProjectsRepository, ProjectQuery } from '../interfaces';
import type { ChangxiaDatabase } from './dexie.database';

/** Dexie 实现的项目仓储 */
export class LocalProjectsRepository implements IProjectsRepository {
  constructor(private readonly db: ChangxiaDatabase) {}

  async list(query?: ProjectQuery): Promise<Project[]> {
    try {
      let rows = await this.db.projects.toArray();
      if (query?.status && query.status !== 'all') {
        rows = rows.filter((p) => p.status === query.status);
      }
      if (query?.keyword) {
        const kw = query.keyword.trim().toLowerCase();
        if (kw) {
          rows = rows.filter(
            (p) =>
              p.name.toLowerCase().includes(kw) ||
              p.clientName.toLowerCase().includes(kw) ||
              p.address.toLowerCase().includes(kw),
          );
        }
      }
      return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '项目列表读取失败。', err);
    }
  }

  async get(id: string): Promise<Project | null> {
    try {
      return (await this.db.projects.get(id)) ?? null;
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '项目详情读取失败。', err);
    }
  }

  async insert(cmd: CreateProjectCmd & { id?: string }): Promise<Project> {
    if (!cmd.name?.trim()) {
      throw new ChangxiaError(ChangxiaErrorCode.Validation, '项目名称不能为空。');
    }
    if (!cmd.plannedStartAt || !cmd.plannedEndAt) {
      throw new ChangxiaError(ChangxiaErrorCode.Validation, '项目计划起止日期不能为空。');
    }
    const now = new Date().toISOString();
    const row: Project = {
      id: cmd.id ?? crypto.randomUUID(),
      name: cmd.name.trim(),
      address: cmd.address ?? '',
      clientName: cmd.clientName ?? '',
      contractAmount: cmd.contractAmount ?? null,
      signedAt: cmd.signedAt ?? null,
      plannedStartAt: cmd.plannedStartAt,
      plannedEndAt: cmd.plannedEndAt,
      coverColor: cmd.coverColor ?? null,
      // v0.7 侧栏折叠态增强：外观类字段紧随 coverColor（键序同 entities.Project）
      shortLabel: cmd.shortLabel ?? null,
      // 键序铁律（四处同步：entities.Project / backup.service projectSchema /
      // 本处 insert 字面量 / stage-fallback.normalizeProjectRow）：
      // 三个阶段字段紧随外观类字段之后、v0.8 的 domain/kind 再紧随其后、status 之前
      stagePresetKey: cmd.stagePresetKey ?? null,
      stageTemplateVersion: cmd.stageTemplateVersion ?? 0,
      scheduleBasis: cmd.scheduleBasis ?? DEFAULT_SCHEDULE_BASIS,
      // v0.8 主板块：可空（老项目无法推断；缺失由 resolveProjectDomain 读时回落）。
      // 建档路径一律显式带上（T03 的 domain 写入点），此处只兜底。
      domain: cmd.domain ?? null,
      // v0.8 归属侧：**非可选**，故这里必须给默认值而不是 null。
      // 人类侧建档（唯一的常规建档路径）不传 kind ⇒ 落 DEFAULT_PROJECT_KIND；
      // Agent 通道建板传 'agent'（T04）。
      kind: cmd.kind ?? DEFAULT_PROJECT_KIND,
      status: ProjectStatus.Active,
      revision: 1,
      updatedAt: now,
    };
    try {
      await this.db.projects.add(row);
      return row;
    } catch (err) {
      throw new ChangxiaError(ChangxiaErrorCode.Storage, '项目创建失败。', err);
    }
  }

  async update(id: string, cmd: UpdateProjectCmd): Promise<Project> {
    const existing = await this.db.projects.get(id);
    if (!existing) {
      throw new ChangxiaError(ChangxiaErrorCode.NotFound, '未找到该项目，可能已被删除。');
    }
    const next: Project = {
      ...existing,
      ...pickDefined(cmd),
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.db.projects.put(next);
    return next;
  }

  async archive(id: string, archived: boolean): Promise<void> {
    await this.update(id, { status: archived ? ProjectStatus.Archived : ProjectStatus.Active });
  }

  /**
   * 永久删除项目（级联清理其下 stages / tasks / stageLogs / assignments）。
   * Dexie 不加物理外键，需在本库事务内按外键顺序手工清除。
   */
  async remove(id: string): Promise<void> {
    try {
      const stageIds = (await this.db.stages.where('projectId').equals(id).primaryKeys()) as string[];
      const taskIds = (await this.db.tasks.where('projectId').equals(id).primaryKeys()) as string[];
      await this.db.transaction('rw', [this.db.tasks, this.db.itineraries, this.db.stages, this.db.stageLogs, this.db.assignments, this.db.projects], async () => {
        if (stageIds.length > 0) await this.db.stageLogs.where('stageId').anyOf(stageIds).delete();
        if (taskIds.length > 0) {
          await this.db.assignments.where('taskId').anyOf(taskIds).delete();
          await this.db.tasks.bulkDelete(taskIds);
        }
        if (stageIds.length > 0) await this.db.stages.bulkDelete(stageIds);
        await this.db.itineraries.where('projectId').equals(id).delete();
        await this.db.projects.delete(id);
      });
    } catch (err) {
      throw new ChangxiaError(
        ChangxiaErrorCode.Storage,
        '项目删除失败，数据已回滚。',
        err,
      );
    }
  }
}

/** 仅复制值为 undefined 之外的键（PUT 合并语义的基础工具） */
export function pickDefined<T extends object>(src: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(src) as Array<keyof T>) {
    if (src[key] !== undefined) {
      // undefined 检查后赋值安全
      (out as Record<string, unknown>)[key as string] = src[key];
    }
  }
  return out;
}
