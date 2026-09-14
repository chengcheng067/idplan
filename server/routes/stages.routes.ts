/**
 * Stages 路由：CRUD + bulk + reschedule（对齐 api-contract.md）。
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

interface StageRow {
  id: string;
  project_id: string;
  order_index: number;
  /** v2 阶段自定义字段（与 entities.Stage 同构） */
  template_key: string | null;
  color_index: number | null;
  /** v0.8 用户自定义主色（NULL = 用内置 colorIndex 色）。键序：color_index 之后、name 之前 */
  custom_color: string | null;
  name: string;
  ratio_percent: number;
  start_at: string;
  end_at: string;
  status: string;
  owner_id: string | null;
  visible: number;
  resource_path: string | null;
  revision: number;
  updated_at: string;
}

export function rowToStage(r: StageRow): Record<string, unknown> {
  return {
    id: r.id,
    projectId: r.project_id,
    orderIndex: r.order_index,
    templateKey: r.template_key ?? null,
    colorIndex: r.color_index ?? null,
    customColor: r.custom_color ?? null,
    name: r.name,
    ratioPercent: r.ratio_percent,
    startAt: r.start_at,
    endAt: r.end_at,
    status: r.status,
    ownerId: r.owner_id,
    visible: Boolean(r.visible),
    resourcePath: r.resource_path,
    revision: r.revision,
    updatedAt: r.updated_at,
  };
}

const nowIso = (): string => new Date().toISOString();

export function registerStageRoutes(app: FastifyInstance, db: Database.Database): void {
  // GET /projects/:projectId/stages
  app.get('/api/projects/:projectId/stages', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const rows = db
      .prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY order_index')
      .all(projectId) as StageRow[];
    return rows.map(rowToStage);
  });

  // GET /stages/:id
  app.get('/api/stages/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT * FROM stages WHERE id = ?').get(id) as StageRow | undefined;
    if (!row) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '阶段不存在' } };
    }
    return rowToStage(row);
  });

  // POST /stages/bulk
  app.post('/api/stages/bulk', async (req) => {
    const { rows } = req.body as { rows: Array<Record<string, unknown>> };
    const insert = db.prepare(
      `INSERT INTO stages
        (id, project_id, order_index, template_key, color_index, custom_color,
         name, ratio_percent, start_at, end_at,
         status, owner_id, visible, resource_path, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction((list: Array<Record<string, unknown>>) => {
      for (const s of list) {
        insert.run(
          String(s.id),
          String(s.projectId),
          Number(s.orderIndex),
          (s.templateKey as string | null) ?? null,
          s.colorIndex == null ? null : Number(s.colorIndex),
          (s.customColor as string | null) ?? null,
          String(s.name),
          Number(s.ratioPercent),
          String(s.startAt),
          String(s.endAt),
          String(s.status ?? 'not_started'),
          (s.ownerId as string | null) ?? null,
          s.visible === false ? 0 : 1,
          (s.resourcePath as string | null) ?? null,
          Number(s.revision ?? 1),
          String(s.updatedAt ?? nowIso()),
        );
      }
    });
    tx(rows ?? []);
    return { ok: true, count: rows?.length ?? 0 };
  });

  // PATCH /stages/:id
  app.patch('/api/stages/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = db.prepare('SELECT * FROM stages WHERE id = ?').get(id) as StageRow | undefined;
    if (!existing) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '阶段不存在' } };
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const merged: StageRow = {
      ...existing,
      name: b.name !== undefined ? String(b.name) : existing.name,
      ratio_percent: b.ratioPercent !== undefined ? Number(b.ratioPercent) : existing.ratio_percent,
      owner_id: b.ownerId !== undefined ? (b.ownerId as string | null) : existing.owner_id,
      visible: b.visible !== undefined ? (b.visible ? 1 : 0) : existing.visible,
      resource_path:
        b.resourcePath !== undefined ? (b.resourcePath as string | null) : existing.resource_path,
      template_key:
        b.templateKey !== undefined ? (b.templateKey as string | null) : existing.template_key,
      color_index:
        b.colorIndex !== undefined
          ? (b.colorIndex as number | null)
          : existing.color_index,
      // v0.8：允许显式 null（= 回到内置色）。undefined 保持原值（字段级更新语义）。
      custom_color:
        b.customColor !== undefined ? (b.customColor as string | null) : existing.custom_color,
      revision: existing.revision + 1,
      updated_at: nowIso(),
    };
    db.prepare(
      `UPDATE stages SET name=?, ratio_percent=?, owner_id=?, visible=?, resource_path=?,
        template_key=?, color_index=?, custom_color=?, revision=?, updated_at=? WHERE id=?`,
    ).run(
      merged.name,
      merged.ratio_percent,
      merged.owner_id,
      merged.visible,
      merged.resource_path,
      merged.template_key,
      merged.color_index,
      merged.custom_color,
      merged.revision,
      merged.updated_at,
      id,
    );
    return rowToStage(merged);
  });

  // POST /stages/:id/reschedule
  app.post('/api/stages/:id/reschedule', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = db.prepare('SELECT * FROM stages WHERE id = ?').get(id) as StageRow | undefined;
    if (!existing) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '阶段不存在' } };
    }
    const b = req.body as { startAt?: string; endAt?: string; status?: string };
    const startAt = b.startAt ?? existing.start_at;
    const endAt = b.endAt ?? existing.end_at;
    if (new Date(endAt).getTime() < new Date(startAt).getTime()) {
      void reply.status(400);
      return { error: { code: 'validation', userMessage: '截止日早于开始日，已拒绝保存' } };
    }
    db.prepare(
      'UPDATE stages SET start_at=?, end_at=?, status=?, revision=revision+1, updated_at=? WHERE id=?',
    ).run(startAt, endAt, b.status ?? existing.status, nowIso(), id);
    const row = db.prepare('SELECT * FROM stages WHERE id = ?').get(id) as StageRow;
    return rowToStage(row);
  });
}
