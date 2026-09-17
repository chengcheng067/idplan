import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerItineraryRoutes } from '../server/routes/itineraries.routes';
import { registerProjectRoutes } from '../server/routes/projects.routes';

describe('server itineraries routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    db = new Database(':memory:');
    createDb(db);
    app = Fastify({ logger: false });
    registerProjectRoutes(app, db);
    registerItineraryRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  function insertTravelProject(id = 'travel-1', domain: string | null = 'travel'): void {
    db.prepare(
      `INSERT INTO projects
       (id, name, type, address, client_name, contract_amount, signed_at, planned_start_at, planned_end_at,
        cover_color, short_label, stage_preset_key, stage_template_version, schedule_basis, domain, kind, status, revision, updated_at)
       VALUES (?, '旅行', '', '', '', NULL, NULL, '2026-09-01', '2026-09-02', NULL, NULL,
        'travel_fit', 1, 'calendar', ?, 'human', 'active', 1, '2026-09-01T00:00:00.000Z')`,
    ).run(id, domain);
  }

  it('ensure 只补缺失日期，不覆盖既有字段也不删除范围外卡片', async () => {
    insertTravelProject();
    db.prepare(
      `INSERT INTO itineraries
       (id, project_id, date, transport, accommodation, budget_amount, actual_amount, revision, updated_at)
       VALUES ('existing', 'travel-1', '2026-09-01', '高铁', NULL, 100, NULL, 1, '2026-09-01T00:00:00.000Z'),
              ('outside', 'travel-1', '2026-09-10', NULL, NULL, NULL, NULL, 1, '2026-09-01T00:00:00.000Z')`,
    ).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/travel-1/itineraries/ensure',
      payload: { startDate: '2026-09-01', endDate: '2026-09-03' },
    });

    expect(response.statusCode).toBe(200);
    const rows = response.json<Array<{ date: string; transport: string | null }>>();
    expect(rows.map((row) => row.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10']);
    expect(rows[0]?.transport).toBe('高铁');
  });

  it('新增和更新拒绝非有限金额，合法更新可保存并删除', async () => {
    insertTravelProject();
    const badCreate = await app.inject({
      method: 'POST', url: '/api/projects/travel-1/itineraries', payload: { date: '2026-09-01', budgetAmount: 'abc' },
    });
    expect(badCreate.statusCode).toBe(400);

    const created = await app.inject({
      method: 'POST', url: '/api/projects/travel-1/itineraries', payload: { date: '2026-09-01', budgetAmount: 80 },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json<{ id: string }>().id;

    const badPatch = await app.inject({ method: 'PATCH', url: `/api/itineraries/${id}`, payload: { actualAmount: 'NaN' } });
    expect(badPatch.statusCode).toBe(400);
    const patched = await app.inject({ method: 'PATCH', url: `/api/itineraries/${id}`, payload: { actualAmount: 72.5 } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ actualAmount: number }>().actualAmount).toBe(72.5);

    expect((await app.inject({ method: 'DELETE', url: `/api/itineraries/${id}` })).statusCode).toBe(200);
    expect((db.prepare('SELECT COUNT(*) c FROM itineraries WHERE id=?').get(id) as { c: number }).c).toBe(0);
  });

  it('项目改期校验区间，并对显式或套餐回查得到的旅游项目自动补卡', async () => {
    insertTravelProject('explicit', 'travel');
    insertTravelProject('fallback', null);

    const invalid = await app.inject({
      method: 'PATCH', url: '/api/projects/explicit', payload: { plannedStartAt: '2026-09-05', plannedEndAt: '2026-09-03' },
    });
    expect(invalid.statusCode).toBe(400);
    expect((db.prepare('SELECT planned_start_at FROM projects WHERE id=?').get('explicit') as { planned_start_at: string }).planned_start_at).toBe('2026-09-01');

    for (const id of ['explicit', 'fallback']) {
      const response = await app.inject({
        method: 'PATCH', url: `/api/projects/${id}`, payload: { plannedEndAt: '2026-09-04' },
      });
      expect(response.statusCode).toBe(200);
      const dates = (db.prepare('SELECT date FROM itineraries WHERE project_id=? ORDER BY date').all(id) as Array<{ date: string }>).map((row) => row.date);
      expect(dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    }
  });
});
