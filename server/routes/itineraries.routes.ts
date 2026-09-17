import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

import { dayjs, isIsoDate } from '../../src/lib/date';

interface ItineraryRow {
  id: string;
  project_id: string;
  date: string;
  transport: string | null;
  accommodation: string | null;
  budget_amount: number | null;
  actual_amount: number | null;
  revision: number;
  updated_at: string;
}

function rowToItinerary(row: ItineraryRow): Record<string, unknown> {
  return {
    id: row.id,
    projectId: row.project_id,
    date: row.date,
    transport: row.transport,
    accommodation: row.accommodation,
    budgetAmount: row.budget_amount,
    actualAmount: row.actual_amount,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

const nowIso = (): string => new Date().toISOString();

function optionalAmount(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}

function invalidAmount(value: unknown): boolean {
  return value !== undefined && optionalAmount(value) === undefined;
}

/** 旅游每日行程 REST 路由。日期卡独立于任务，项目内 date 唯一。 */
export function registerItineraryRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/projects/:projectId/itineraries', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const rows = db
      .prepare('SELECT * FROM itineraries WHERE project_id = ? ORDER BY date, id')
      .all(projectId) as ItineraryRow[];
    return rows.map(rowToItinerary);
  });

  app.post('/api/projects/:projectId/itineraries/ensure', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = (req.body ?? {}) as { startDate?: string; endDate?: string };
    const startDate = body.startDate ?? '';
    const endDate = body.endDate ?? '';
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
      void reply.status(400);
      return { error: { code: 'validation', userMessage: '旅游项目的起止日期无效，无法生成每日行程。' } };
    }
    const insert = db.prepare(
      `INSERT OR IGNORE INTO itineraries
       (id, project_id, date, transport, accommodation, budget_amount, actual_amount, revision, updated_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 1, ?)`,
    );
    const tx = db.transaction(() => {
      for (let cursor = dayjs(startDate); !cursor.isAfter(dayjs(endDate), 'day'); cursor = cursor.add(1, 'day')) {
        insert.run(crypto.randomUUID(), projectId, cursor.format('YYYY-MM-DD'), nowIso());
      }
    });
    tx.immediate();
    const rows = db
      .prepare('SELECT * FROM itineraries WHERE project_id = ? ORDER BY date, id')
      .all(projectId) as ItineraryRow[];
    return rows.map(rowToItinerary);
  });

  app.post('/api/projects/:projectId/itineraries', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const b = (req.body ?? {}) as Record<string, unknown>;
    const date = String(b.date ?? '');
    if (!isIsoDate(date)) {
      void reply.status(400);
      return { error: { code: 'validation', userMessage: '每日行程日期必须是 YYYY-MM-DD。' } };
    }
    if (invalidAmount(b.budgetAmount) || invalidAmount(b.actualAmount)) {
      void reply.status(400);
      return { error: { code: 'validation', userMessage: '预算和实际金额必须是有效数字或空值。' } };
    }
    const id = crypto.randomUUID();
    const now = nowIso();
    try {
      db.prepare(
        `INSERT INTO itineraries
         (id, project_id, date, transport, accommodation, budget_amount, actual_amount, revision, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ).run(
        id, projectId, date, (b.transport as string | null) ?? null, (b.accommodation as string | null) ?? null,
        optionalAmount(b.budgetAmount) ?? null, optionalAmount(b.actualAmount) ?? null, now,
      );
    } catch {
      void reply.status(409);
      return { error: { code: 'conflict', userMessage: '该日期已有每日行程卡。' } };
    }
    return rowToItinerary(db.prepare('SELECT * FROM itineraries WHERE id = ?').get(id) as ItineraryRow);
  });

  app.patch('/api/itineraries/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = db.prepare('SELECT * FROM itineraries WHERE id = ?').get(id) as ItineraryRow | undefined;
    if (!existing) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '未找到该每日行程。' } };
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (invalidAmount(b.budgetAmount) || invalidAmount(b.actualAmount)) {
      void reply.status(400);
      return { error: { code: 'validation', userMessage: '预算和实际金额必须是有效数字或空值。' } };
    }
    const next: ItineraryRow = {
      ...existing,
      transport: b.transport !== undefined ? (b.transport as string | null) : existing.transport,
      accommodation: b.accommodation !== undefined ? (b.accommodation as string | null) : existing.accommodation,
      budget_amount: b.budgetAmount !== undefined ? optionalAmount(b.budgetAmount)! : existing.budget_amount,
      actual_amount: b.actualAmount !== undefined ? optionalAmount(b.actualAmount)! : existing.actual_amount,
      revision: existing.revision + 1,
      updated_at: nowIso(),
    };
    db.prepare(
      `UPDATE itineraries SET transport=?, accommodation=?, budget_amount=?, actual_amount=?, revision=?, updated_at=? WHERE id=?`,
    ).run(next.transport, next.accommodation, next.budget_amount, next.actual_amount, next.revision, next.updated_at, id);
    return rowToItinerary(next);
  });

  app.delete('/api/itineraries/:id', async (req) => {
    const { id } = req.params as { id: string };
    db.prepare('DELETE FROM itineraries WHERE id = ?').run(id);
    return { ok: true };
  });
}
