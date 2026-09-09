/**
 * 服务端 JSON 列 + createDb 三段式 + upsert/claim（v0.6 三件套③ · N25 / IN-07 / R1）。
 *
 * 回归防线：
 *   - artifacts（对象数组）经 upsert → GET 往返**保真**（旧 parseAssigneeIds 的
 *     filter(typeof x === 'string') 会把它静默清空成 []，本 spec 锁死不许复发）；
 *   - 重复 upsert 同一 externalId：{created:0, updated:N}，行数不增（幂等）；
 *   - claim 二次调用 → 409 conflict（单语句原子性）;
 *   - 老库（v1 表结构 + done=1 数据）createDb 不抛错（表 → 补列 → 索引 三段式），
 *     且一次性数据迁移把 done=1 归一为 status='done'。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

// T14：备份通道已 fail-closed——本 spec 全部 backup 请求需带 token。
// 模块级设置（vitest 每文件独立进程/环境，不外泄）。
process.env.IDPLAN_AGENT_TOKEN = 'test-token';

import { createDb, sectionOf, openDb } from '../server/db';
import { registerTaskRoutes } from '../server/routes/tasks.routes';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { serializeJson, parseJson, parseJsonArray, serializeAssigneeIds } from '../server/lib/json-columns';
import { readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'server');

async function buildServer(db: Database.Database) {
  const app = Fastify({ logger: false });
  registerTaskRoutes(app, db);
  registerMetaRoutes(app, db);
  await app.ready();
  return app;
}

describe('server/lib/json-columns（序列化 roundtrip 纯函数）', () => {
  it('serializeJson/parseJson：对象数组往返保真，绝不 filter(string)', () => {
    const artifacts = [
      { id: 'art_1', kind: 'file', title: 'a.ts', path: 'src/a.ts', url: null, note: null },
      { id: 'art_2', kind: 'link', title: '外链', path: null, url: 'https://example.com', note: null },
    ];
    const raw = serializeJson(artifacts);
    expect(parseJsonArray<typeof artifacts[number]>(raw)).toEqual(artifacts);
    // 反例锁定：serializeAssigneeIds 会把对象元素清空（这就是禁令存在的原因）
    expect(JSON.parse(serializeAssigneeIds(artifacts))).toEqual([]);
  });

  it('parseJson 坏数据回落 fallback，绝不抛错', () => {
    expect(parseJson('not-json', { ok: false })).toEqual({ ok: false });
    expect(parseJson('', [])).toEqual([]);
    expect(parseJson(null, [])).toEqual([]);
    expect(parseJsonArray('{"a":1}')).toEqual([]); // 非数组 → []
    expect(serializeJson(undefined)).toBe('null');
  });
});

describe('server 三件套③：JSON 列 + 幂等 upsert + claim', () => {
  let db: Database.Database;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createDb(db);
    // 外键父行
    db.exec(`INSERT INTO projects (id, name, type, planned_start_at, planned_end_at, updated_at)
      VALUES ('p1','父项目','dining','2026-08-01','2026-12-31','2026-08-01T00:00:00.000Z')`);
    db.exec(`INSERT INTO stages (id, project_id, order_index, name, ratio_percent, start_at, end_at, updated_at)
      VALUES ('s1','p1',1,'批次一',10,'2026-08-01','2026-08-10','2026-08-01T00:00:00.000Z')`);
    app = await buildServer(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const payloadRow = {
    externalId: 'codex:run-1:t1',
    projectId: 'p1',
    stageId: 's1',
    title: '实现 payload 校验器',
    status: 'in_progress',
    description: '## 做什么\n- zod schema',
    dependsOn: [],
    artifacts: [
      { id: 'art_1', kind: 'file', title: 'payload.schema.ts', path: 'src/core/agent/payload.schema.ts', url: null, note: null },
      { id: 'art_2', kind: 'link', title: '契约', path: null, url: 'https://example.com', note: null },
    ],
    startAt: null,
    dueDate: null,
    source: 'agent',
  };

  it('artifacts 经 upsert → GET 往返保真（对象数组，非 []）', async () => {
    const up = await app.inject({ method: 'POST', url: '/api/tasks/upsert', payload: { rows: [payloadRow] } });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toEqual({ created: 1, updated: 0 });

    const tasks = (await app.inject({ method: 'GET', url: '/api/tasks?projectId=p1' })).json();
    expect(tasks).toHaveLength(1);
    expect(Array.isArray(tasks[0].artifacts)).toBe(true);
    expect(tasks[0].artifacts).toHaveLength(2);
    expect(tasks[0].artifacts[0]).toEqual(payloadRow.artifacts[0]);
    expect(tasks[0].artifacts[1]).toEqual(payloadRow.artifacts[1]);
    expect(tasks[0].status).toBe('in_progress');
    // done 恒由 status 派生，绝不接受请求体的 done
    expect(tasks[0].done).toBe(false);
  });

  it('重复 upsert 同一 externalId → {created:0,updated:N}，行数不增，revision 递增', async () => {
    await app.inject({ method: 'POST', url: '/api/tasks/upsert', payload: { rows: [payloadRow] } });
    const second = await app.inject({
      method: 'POST',
      url: '/api/tasks/upsert',
      payload: { rows: [{ ...payloadRow, status: 'review' }] },
    });
    expect(second.json()).toEqual({ created: 0, updated: 1 });

    const count = (db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c;
    expect(count).toBe(1);
    const row = db.prepare('SELECT * FROM tasks WHERE external_id=?').get('codex:run-1:t1') as {
      revision: number;
      status: string;
      done: number;
    };
    expect(row.revision).toBe(2);
    expect(row.status).toBe('review');
    // done 恒由 status 派生：review ≠ done → 0
    expect(row.done).toBe(0);
  });

  it('claim：ready 可认领；二次调用 409 conflict；非 ready 拒绝', async () => {
    db.prepare(
      `INSERT INTO tasks (id, project_id, stage_id, title, done, status, source, order_index, updated_at)
       VALUES ('t_ready','p1','s1','就绪任务',0,'ready','human',1,'2026-08-01T00:00:00.000Z')`,
    ).run();
    const first = await app.inject({
      method: 'POST',
      url: '/api/tasks/t_ready/claim',
      payload: { actorMemberId: 'mem_1' },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json() as Record<string, unknown>;
    expect(body.status).toBe('claimed');
    expect(body.claimedAt).not.toBeNull();
    expect(body.assigneeId).toBe('mem_1');

    const second = await app.inject({
      method: 'POST',
      url: '/api/tasks/t_ready/claim',
      payload: { actorMemberId: 'mem_2' },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as Record<string, unknown>).error).toMatchObject({ code: 'conflict' });

    // 非 ready 态
    db.prepare(`UPDATE tasks SET status='done', done=1 WHERE id='t_ready'`).run();
    const third = await app.inject({
      method: 'POST',
      url: '/api/tasks/t_ready/claim',
      payload: { actorMemberId: 'mem_3' },
    });
    expect(third.statusCode).toBe(409);
  });

  it('备份导入通道：前端归一后的 v3 行（含 status）导入后字段保真，数组不被吞', async () => {
    // 先清掉 beforeEach 预置的父行（import 会按表序 DELETE，先删 projects 会撞外键）
    db.exec('DELETE FROM tasks; DELETE FROM stages; DELETE FROM projects;');
    // 说明：真实导入链路是「前端 zod normalizeTaskRow（done→status 归一）→
    // /api/backup/import」，故 payload 自带 status；此处按真实形状构造。
    // 外键：import 先清库再插入，payload 必须自带父项目与批次行。
    const now = '2026-08-01T00:00:00.000Z';
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: { 'x-agent-token': 'test-token' },
      payload: {
        meta: { app: 'changxia', schemaVersion: 3, exportedAt: now },
        data: {
          projects: [
            { id: 'p1', name: '父项目', type: 'dining', address: '', clientName: '', contractAmount: null, signedAt: null, plannedStartAt: '2026-08-01', plannedEndAt: '2026-12-31', coverColor: null, stagePresetKey: null, stageTemplateVersion: 1, scheduleBasis: 'calendar', status: 'active', revision: 1, updatedAt: now },
          ],
          stages: [
            { id: 's1', projectId: 'p1', orderIndex: 1, templateKey: null, colorIndex: 1, name: '批次一', ratioPercent: 10, startAt: '2026-08-01', endAt: '2026-08-10', status: 'not_started', ownerId: null, visible: true, resourcePath: null, revision: 1, updatedAt: now },
          ],
          tasks: [
            {
              id: 't_norm',
              projectId: 'p1',
              stageId: 's1',
              title: '旧任务',
              done: true,
              status: 'done',
              source: 'human',
              externalId: null,
              agentId: null,
              description: null,
              dependsOn: [],
              artifacts: [],
              startAt: null,
              claimedAt: null,
              assigneeId: null,
              assigneeIds: ['m1', 'm2'],
              dueDate: null,
              orderIndex: 1,
              revision: 1,
              updatedAt: now,
            },
          ],
          members: [],
          assignments: [],
          logs: [],
          contracts: [],
          settings: [],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const tasks = (await app.inject({ method: 'GET', url: '/api/tasks' })).json();
    expect(tasks[0].status).toBe('done');
    expect(tasks[0].done).toBe(true);
    expect(tasks[0].assigneeIds).toEqual(['m1', 'm2']);
    expect(tasks[0].externalId).toBeNull();
  });
});

describe('R1 顺序修复：老库 createDb 不崩（表 → 补列 → 索引）', () => {
  it('v1 表结构老库 + done=1 数据 → createDb 成功、索引齐备、status 归一 done', () => {
    const legacy = new Database(':memory:');
    // 手工建 v1 老库（无 v2/v3 任何新列）
    legacy.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '', client_name TEXT NOT NULL DEFAULT '',
        contract_amount INTEGER, signed_at TEXT, planned_start_at TEXT NOT NULL,
        planned_end_at TEXT NOT NULL, cover_color TEXT, status TEXT NOT NULL DEFAULT 'active',
        revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, stage_id TEXT NOT NULL,
        title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, assignee_id TEXT, due_date TEXT,
        order_index INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL);
      INSERT INTO tasks (id, project_id, stage_id, title, done, order_index, updated_at)
        VALUES ('t1','p1','s1','老任务',1,1,'2026-08-01T00:00:00.000Z');
    `);
    // 升级前索引列不存在 —— 旧实现（先全量 DDL 后补列）在这里抛 no such column
    expect(() => createDb(legacy)).not.toThrow();

    const tCols = (legacy.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(tCols).toEqual(expect.arrayContaining(['external_id', 'status', 'artifacts']));
    const indexes = legacy.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual(
      expect.arrayContaining(['idx_tasks_external_id', 'idx_tasks_status', 'idx_tasks_agent']),
    );
    // 一次性数据迁移：done=1 → status='done'
    const row = legacy.prepare('SELECT status, done FROM tasks WHERE id=?').get('t1') as {
      status: string;
      done: number;
    };
    expect(row.status).toBe('done');
    expect(row.done).toBe(1);
    legacy.close();
  });

  it('sectionOf：正确切出 TABLES / INDEXES 段，表段内不含 CREATE INDEX', () => {
    const ddl = readFileSync(join(serverDir, 'schema.sql'), 'utf-8');
    const tables = sectionOf(ddl, 'TABLES');
    const indexes = sectionOf(ddl, 'INDEXES');
    expect(tables).toContain('CREATE TABLE IF NOT EXISTS tasks');
    expect(tables).not.toContain('CREATE INDEX');
    expect(indexes).toContain('idx_tasks_external_id');
    expect(indexes).not.toContain('CREATE TABLE');
    expect(() => sectionOf(ddl, 'NOPE')).toThrowError(/分段标记/);
  });

  it('openDb 返回连接且 WAL 生效（冒烟，测试后清理）', () => {
    const tmp = join(serverDir, '..', 'tmp', `json-columns-${process.pid}-${Date.now()}.db`);
    const db = openDb(tmp);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
    rmSync(tmp, { force: true });
    rmSync(`${tmp}-wal`, { force: true });
    rmSync(`${tmp}-shm`, { force: true });
  });
});
