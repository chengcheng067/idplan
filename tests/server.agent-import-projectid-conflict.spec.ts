/**
 * NAS 服务端 `POST /api/agent/import` 的 projectId 冲突 fail-closed 验收（端到端 `app.inject`）。
 *
 * 为什么端到端：校验判序、零写入、400 映射这些集成缺口，只有真发一次 HTTP 才看得见。
 *
 * 零写入怎么证明：断言「请求前后 projects / stages / tasks 三张表的行数逐一相等」——
 * 而不是只断言「返回 400」：返回 400 但偷偷写了半行，是这种端点最典型的失效模式。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import Fastify from 'fastify';
import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';
import { registerTaskRoutes } from '../server/routes/tasks.routes';
import { registerMemberRoutes } from '../server/routes/members.routes';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { registerAgentRoutes } from '../server/routes/agent.routes';
import { AGENT_API_TOKEN_ENV, AGENT_TOKEN_ENV } from '../server/lib/agent-auth';

type Db = InstanceType<typeof Database>;
type App = ReturnType<typeof Fastify>;

const TOKEN = 'import-conflict-agent-api-token-0123456789';
const BACKUP_TOKEN = 'import-conflict-backup-token-9876543210';

let savedAgentToken: string | undefined;
let savedBackupToken: string | undefined;
let db: Db;

async function buildServer(): Promise<App> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) => {
    void reply.status(err.statusCode ?? 500).send({
      error: {
        code: String((err as { code?: string }).code ?? 'internal'),
        userMessage: (err as { userMessage?: string }).userMessage ?? '服务器内部错误',
      },
    });
  });
  registerProjectRoutes(app, db);
  registerStageRoutes(app, db);
  registerTaskRoutes(app, db);
  registerMemberRoutes(app, db);
  registerMetaRoutes(app, db);
  registerAgentRoutes(app, db);
  await app.ready();
  return app;
}

beforeEach(() => {
  savedAgentToken = process.env[AGENT_API_TOKEN_ENV];
  savedBackupToken = process.env[AGENT_TOKEN_ENV];
  process.env[AGENT_API_TOKEN_ENV] = TOKEN;
  process.env[AGENT_TOKEN_ENV] = BACKUP_TOKEN;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createDb(db);
});

afterEach(() => {
  if (savedAgentToken === undefined) delete process.env[AGENT_API_TOKEN_ENV];
  else process.env[AGENT_API_TOKEN_ENV] = savedAgentToken;
  if (savedBackupToken === undefined) delete process.env[AGENT_TOKEN_ENV];
  else process.env[AGENT_TOKEN_ENV] = savedBackupToken;
  db.close();
});

/** 建一个人类项目（kind 落 'human'），用于落点候选 */
async function createHumanProject(app: App, id: string, name = id): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { id, name, type: 'dining', plannedStartAt: '2026-01-01', plannedEndAt: '2026-12-31' },
  });
  expect(res.statusCode, `建人类项目失败：${res.body}`).toBe(200);
}

/** 给项目插一个可见批次（import 无 stageId / 无声明名时落到最后一个可见批次） */
function seedStage(projectId: string): void {
  db.prepare(
    `INSERT INTO stages (id, project_id, order_index, template_key, color_index, custom_color,
       name, ratio_percent, start_at, end_at, status, owner_id, visible, resource_path, revision, updated_at)
     VALUES (?, ?, 1, NULL, 1, NULL, '批次1', 10, '2026-01-01', '2026-12-31',
       'not_started', NULL, 1, NULL, 1, '2026-01-01T00:00:00.000Z')`,
  ).run(`stg_${projectId}`, projectId);
}

/** 三张表的行数（零写入证明用） */
function tableCounts(): { projects: number; stages: number; tasks: number } {
  const n = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
  return {
    projects: n('SELECT COUNT(*) AS c FROM projects'),
    stages: n('SELECT COUNT(*) AS c FROM stages'),
    tasks: n('SELECT COUNT(*) AS c FROM tasks'),
  };
}

/** 某项目的 tasks 行数 */
function taskCount(projectId: string): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE project_id = ?').get(projectId) as { c: number }).c;
}

/** 构造最小合法 import payload（含 stageId=null 让任务落到项目默认可见批次） */
function importPayload(projectId: string | null): Record<string, unknown> {
  return {
    schema: 'idplan-agent-payload/v1',
    projectId,
    stageId: null,
    producedBy: {
      actorKind: 'agent',
      agentKind: 'workbuddy',
      agentName: 'WorkBuddy',
      runId: 'run-import-1',
    },
    tasks: [
      {
        externalId: 'workbuddy:import-1:t1',
        title: '写提案',
        description: null,
        status: 'draft',
        dependsOnExternal: [],
        artifacts: [],
        startAt: null,
        dueDate: null,
        externalPath: null,
      },
    ],
  };
}

/** 发 import 请求（默认带 token） */
async function postImport(
  app: App,
  body: Record<string, unknown>,
  query: Record<string, string> = {},
): Promise<{ statusCode: number; body: { error?: { code: string; userMessage: string } } }> {
  const qs = new URLSearchParams(query).toString();
  const res = await app.inject({
    method: 'POST',
    url: `/api/agent/import${qs ? `?${qs}` : ''}`,
    headers: { 'content-type': 'application/json', 'x-agent-token': TOKEN },
    payload: body,
  });
  return { statusCode: res.statusCode, body: res.json() as never };
}

describe('POST /api/agent/import · projectId 冲突 fail-closed', () => {
  it('query 与 payload 不一致 → 400，且**零写入**（projects/stages/tasks 行数前后相等）', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'proj_a');
    await createHumanProject(app, 'proj_b');
    seedStage('proj_a');
    seedStage('proj_b');

    const before = tableCounts();
    const res = await postImport(app, importPayload('proj_a'), { projectId: 'proj_b' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('Validation');
    expect(res.body.error?.userMessage ?? '').toContain('query 与 payload 的 projectId 不一致');

    const after = tableCounts();
    expect(after).toEqual(before); // 三张表都没动
    expect(taskCount('proj_a')).toBe(0);
    expect(taskCount('proj_b')).toBe(0);
  });

  it('query 与 payload 一致 → 200，正常写入 1 条', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'proj_a');
    seedStage('proj_a');

    const before = tableCounts();
    const res = await postImport(app, importPayload('proj_a'), { projectId: 'proj_a' });

    expect(res.statusCode).toBe(200);
    expect(taskCount('proj_a')).toBe(1);
    // 只多了 1 条 task，projects / stages 未变
    expect(tableCounts()).toEqual({ projects: before.projects, stages: before.stages, tasks: before.tasks + 1 });
  });

  it('只有 query 提供（payload.projectId=null）→ 200，正常写入', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'proj_a');
    seedStage('proj_a');

    const res = await postImport(app, importPayload(null), { projectId: 'proj_a' });
    expect(res.statusCode).toBe(200);
    expect(taskCount('proj_a')).toBe(1);
  });

  it('只有 payload 提供（无 query）→ 200，正常写入', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'proj_a');
    seedStage('proj_a');

    const res = await postImport(app, importPayload('proj_a'));
    expect(res.statusCode).toBe(200);
    expect(taskCount('proj_a')).toBe(1);
  });

  it('边界：仅大小写不同 → 判为不一致 → 400（不折叠大小写）', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'proj_a');

    const res = await postImport(app, importPayload('proj_a'), { projectId: 'PROJ_A' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error?.userMessage ?? '').toContain('query 与 payload 的 projectId 不一致');
    expect(taskCount('proj_a')).toBe(0);
  });

  it('边界：query 带首尾空白（?projectId= proj_a ）与 payload 一致 → 200，正常写入', async () => {
    const app = await buildServer();
    await createHumanProject(app, 'proj_a');
    seedStage('proj_a');

    const res = await postImport(app, importPayload('proj_a'), { projectId: ' proj_a ' });
    expect(res.statusCode).toBe(200);
    expect(taskCount('proj_a')).toBe(1);
  });
});
