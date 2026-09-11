/**
 * Projects 路由（对齐 docs/api-contract.md）。
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

interface ProjectRow {
  id: string;
  name: string;
  type: string;
  address: string;
  client_name: string;
  contract_amount: number | null;
  signed_at: string | null;
  planned_start_at: string;
  planned_end_at: string;
  cover_color: string | null;
  /** v0.7 侧栏方块简称（NULL = 未设置 → 前端读时回落项目名首字） */
  short_label: string | null;
  /** v2 阶段自定义字段（与 entities.Project 同构） */
  stage_preset_key: string | null;
  stage_template_version: number;
  schedule_basis: string;
  status: string;
  revision: number;
  updated_at: string;
}

/**
 * snake_case 行 → 前端 camelCase 实体。
 * 键序与 entities.Project 一致（shortLabel 紧随 coverColor）——前端读取侧不做键序断言，
 * 但保持同序能让「人工比对两侧字段」这件事不需要额外心智负担。
 * `?? null` 兜底：老库（未跑 createDb 的极老实例 / 测试里手搓的表）读不到该列时为 undefined。
 */
export function rowToProject(r: ProjectRow): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    address: r.address,
    clientName: r.client_name,
    contractAmount: r.contract_amount,
    signedAt: r.signed_at,
    plannedStartAt: r.planned_start_at,
    plannedEndAt: r.planned_end_at,
    coverColor: r.cover_color,
    shortLabel: r.short_label ?? null,
    stagePresetKey: r.stage_preset_key ?? null,
    stageTemplateVersion: r.stage_template_version ?? 0,
    scheduleBasis: r.schedule_basis ?? 'calendar',
    status: r.status,
    revision: r.revision,
    updatedAt: r.updated_at,
  };
}

const nowIso = (): string => new Date().toISOString();

export function registerProjectRoutes(app: FastifyInstance, db: Database.Database): void {
  // GET /projects?status=&keyword=
  app.get('/api/projects', async (req) => {
    const { status, keyword } = req.query as { status?: string; keyword?: string };
    let rows = db.prepare('SELECT * FROM projects').all() as ProjectRow[];
    if (status && status !== 'all') rows = rows.filter((r) => r.status === status);
    if (keyword) {
      const kw = keyword.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(kw) ||
          r.client_name.toLowerCase().includes(kw) ||
          r.address.toLowerCase().includes(kw),
      );
    }
    return rows.map(rowToProject);
  });

  // GET /projects/:id
  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!row) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '项目不存在' } };
    }
    return rowToProject(row);
  });

  // POST /projects
  app.post('/api/projects', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const id = (body.id as string) ?? crypto.randomUUID();
    const name = String(body.name ?? '').trim();
    if (!name) {
      void reply.status(400);
      return { error: { code: 'validation', userMessage: '项目名称不能为空' } };
    }
    // ⚠️ 列清单与占位符个数必须逐一对齐（15 个 ?）。加列时三处同改：
    //    列清单 / VALUES / .run() 实参，漏一处就是运行期 'too few/many parameters'。
    db.prepare(
      `INSERT INTO projects
        (id, name, type, address, client_name, contract_amount, signed_at,
         planned_start_at, planned_end_at, cover_color, short_label,
         stage_preset_key, stage_template_version, schedule_basis,
         status, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?)`,
    ).run(
      id,
      name,
      String(body.type ?? 'dining'),
      String(body.address ?? ''),
      String(body.clientName ?? ''),
      body.contractAmount == null ? null : Number(body.contractAmount),
      (body.signedAt as string | null) ?? null,
      String(body.plannedStartAt),
      String(body.plannedEndAt),
      (body.coverColor as string | null) ?? null,
      (body.shortLabel as string | null) ?? null,
      (body.stagePresetKey as string | null) ?? null,
      Number(body.stageTemplateVersion ?? 0),
      String(body.scheduleBasis ?? 'calendar'),
      nowIso(),
    );
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow;
    return rowToProject(row);
  });

  // PATCH /projects/:id
  app.patch('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!existing) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '项目不存在' } };
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    // undefined = 不变（字段级更新语义），null = 显式清除。两态必须分开处理，
    // 否则「只改简称」的请求会把封面/阶段溯源字段一并擦掉。
    const merged: ProjectRow = {
      ...existing,
      name: b.name !== undefined ? String(b.name) : existing.name,
      type: b.type !== undefined ? String(b.type) : existing.type,
      address: b.address !== undefined ? String(b.address) : existing.address,
      client_name: b.clientName !== undefined ? String(b.clientName) : existing.client_name,
      contract_amount:
        b.contractAmount !== undefined ? (b.contractAmount as number | null) : existing.contract_amount,
      signed_at: b.signedAt !== undefined ? (b.signedAt as string | null) : existing.signed_at,
      cover_color: b.coverColor !== undefined ? (b.coverColor as string | null) : existing.cover_color,
      short_label:
        b.shortLabel !== undefined ? (b.shortLabel as string | null) : existing.short_label,
      stage_preset_key:
        b.stagePresetKey !== undefined
          ? (b.stagePresetKey as string | null)
          : existing.stage_preset_key,
      stage_template_version:
        b.stageTemplateVersion !== undefined
          ? Number(b.stageTemplateVersion)
          : existing.stage_template_version,
      schedule_basis:
        b.scheduleBasis !== undefined ? String(b.scheduleBasis) : existing.schedule_basis,
      status: b.status !== undefined ? String(b.status) : existing.status,
      revision: existing.revision + 1,
      updated_at: nowIso(),
    };
    db.prepare(
      `UPDATE projects SET name=?, type=?, address=?, client_name=?, contract_amount=?,
        signed_at=?, cover_color=?, short_label=?, stage_preset_key=?, stage_template_version=?,
        schedule_basis=?, status=?, revision=?, updated_at=? WHERE id=?`,
    ).run(
      merged.name,
      merged.type,
      merged.address,
      merged.client_name,
      merged.contract_amount,
      merged.signed_at,
      merged.cover_color,
      merged.short_label,
      merged.stage_preset_key,
      merged.stage_template_version,
      merged.schedule_basis,
      merged.status,
      merged.revision,
      merged.updated_at,
      id,
    );
    return rowToProject(merged);
  });

  // POST /projects/:id/archive
  app.post('/api/projects/:id/archive', async (req) => {
    const { id } = req.params as { id: string };
    const { archived } = req.body as { archived: boolean };
    db.prepare(
      "UPDATE projects SET status=?, revision=revision+1, updated_at=? WHERE id=?",
    ).run(archived ? 'archived' : 'active', nowIso(), id);
    return { ok: true };
  });

  // DELETE /projects/:id —— 永久删除（级联清理阶段/任务/流水），不可恢复
  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const exists = db.prepare('SELECT id FROM projects WHERE id = ?').get(id) as
      | { id: string }
      | undefined;
    if (!exists) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '项目不存在或已删除' } };
    }
    const stageIds = (
      db.prepare('SELECT id FROM stages WHERE project_id = ?').all(id) as Array<{ id: string }>
    ).map((r) => r.id);
    const taskIds = (
      db.prepare('SELECT id FROM tasks WHERE project_id = ?').all(id) as Array<{ id: string }>
    ).map((r) => r.id);
    const tx = db.transaction(() => {
      if (stageIds.length > 0) {
        db.prepare(`DELETE FROM stage_logs WHERE stage_id IN (${stageIds.map(() => '?').join(',')})`).run(...stageIds);
      }
      if (taskIds.length > 0) {
        db.prepare(`DELETE FROM assignments WHERE task_id IN (${taskIds.map(() => '?').join(',')})`).run(...taskIds);
        db.prepare(`DELETE FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')})`).run(...taskIds);
      }
      if (stageIds.length > 0) {
        db.prepare(`DELETE FROM stages WHERE id IN (${stageIds.map(() => '?').join(',')})`).run(...stageIds);
      }
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    });
    tx();
    return { ok: true };
  });
}
