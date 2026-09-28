/**
 * 跨通道「同参同性」断言（2026-09-28 走查后补；QA 掌门建议项）。
 *
 * ══════════════════════ 为什么需要这份 spec ══════════════════════
 * 9-27 走查的核心教训：**两侧测试各自全绿、合起来分叉**——loopback spec 钉的是
 * `?project=`、server spec 钉的是 `?projectId=`，两边都绿，分叉没人发现。同一份
 * 对外契约（接入文件 + api-contract）服务两形态，就必须有一条 spec 把**同一个
 * 请求**打到两条通道上，要求状态码与错误码逐字相同。
 *
 * ══════════════════════ 两侧链路与边界（诚实标注） ══════════════════════
 *   · server 侧 = Fastify + 真 better-sqlite3 `app.inject`（HTTP 层全含）
 *   · 桌面侧 = **进程内直调渲染落库桥**（`runAgentImport` / `runAgentCreateBoard` /
 *     `runAgentListTasks` + 真 fake-indexeddb）——即 loopback 转发**之后**的那半程
 *   · loopback 的 HTTP 层（query 解析/别名/dryRun 判定/鉴权头/CORS）由
 *     `agent-loopback-server.spec.ts`（真起 server）覆盖，本 spec 不重复起第二个
 *     HTTP server（两 spec 经 nodeRequire 共享 CJS 缓存 + 顶层 env 竞态实测会互踩，
 *     9-28 记录：全量跑时本 spec 曾拿 17999 撞 server spec 的端口）
 * 合起来 = 同一请求在「HTTP 进 → 业务出」全链上两通道同码。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { installFakeIndexedDB } from './setup';
import { createRepositories } from '../src/core/repositories';
import {
  runAgentImport,
  runAgentCreateBoard,
  runAgentListTasks,
} from '../src/hooks/useAgentLoopbackReceiver';
// AgentImportResult 是 vite-env.d.ts 的**全局**接口（不经 receiver 导出）
import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';
import { registerTaskRoutes } from '../server/routes/tasks.routes';
import { registerMemberRoutes } from '../server/routes/members.routes';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { registerAgentRoutes } from '../server/routes/agent.routes';
import { AGENT_API_TOKEN_ENV, AGENT_TOKEN_ENV } from '../server/lib/agent-auth';

const TOKEN = 'v08-parity-agent-token-0123456789abcdef';
const BACKUP_TOKEN = 'v08-parity-backup-token-0123456789';
const HUMAN_ID = 'p_human_parity';
const AGENT_ID = 'p_agent_parity';

type App = ReturnType<typeof Fastify>;

/* ---------- server 侧 ---------- */
let db: InstanceType<typeof Database>;
let app: App;
let savedAgentToken: string | undefined;
let savedBackupToken: string | undefined;

/* ---------- 桌面侧（进程内渲染桥 + 真 fake-indexeddb） ---------- */
let bundle: Awaited<ReturnType<typeof createRepositories>>;

const validPayload = (projectId?: string) => ({
  schema: 'idplan-agent-payload/v1',
  ...(projectId ? { projectId } : {}),
  producedBy: { agentKind: 'workbuddy', agentName: 'WorkBuddy', runId: 'parity' },
  tasks: [{ externalId: 'parity:1', title: '同参探针', status: 'draft', dependsOnExternal: [] }],
});

/** 把渲染侧回传归一成与 server HTTP 响应同构的 {status, code} */
function envelope(r: AgentImportResult): { status: number; code?: string } {
  if (r.error) return { status: r.error.httpStatus ?? 400, code: r.error.code };
  return { status: 200 };
}

/** 桌面侧模拟主进程 query 解析后转发渲染进程（解析口径与 loopback 逐字同源） */
function desktopImportOpts(query: string): { dryRun: boolean; projectId?: string; stageName?: string } {
  const q = new URLSearchParams(query);
  const dryRunRaw = q.get('dryRun');
  return {
    dryRun: dryRunRaw !== null && dryRunRaw !== '' && dryRunRaw !== '0' && dryRunRaw !== 'false',
    projectId: q.get('projectId') ?? q.get('project') ?? undefined,
    stageName: q.get('stageName') ?? q.get('createStageIfMissing') ?? undefined,
  };
}

/** import 两通道对照 */
async function bothImport(
  query: string,
  payload: unknown,
): Promise<[{ status: number; code?: string }, { status: number; code?: string }]> {
  const s = await app.inject({
    method: 'POST',
    url: `/api/agent/import${query}`,
    headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
    payload,
  });
  const sb = s.json() as { error?: { code?: string } };
  const r = await runAgentImport(bundle, {
    requestId: 'parity-desktop',
    ...desktopImportOpts(query),
    payload,
  });
  if (process.env.PARITY_DEBUG) {
    console.log(
      '[parity]', query, '=> server', s.statusCode, s.body.slice(0, 140),
      '| desktop', envelope(r).status, envelope(r).code ?? '',
    );
  }
  return [{ status: s.statusCode, code: sb.error?.code }, envelope(r)];
}

async function bothBoards(body: unknown): Promise<[{ status: number; code?: string }, { status: number; code?: string }]> {
  const s = await app.inject({
    method: 'POST',
    url: '/api/agent/boards',
    headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
    payload: body,
  });
  const sb = s.json() as { error?: { code?: string } };
  const r = await runAgentCreateBoard(bundle, {
    requestId: 'parity-desktop',
    kind: 'create-board',
    body: body as Record<string, unknown>,
  });
  return [{ status: s.statusCode, code: sb.error?.code }, envelope(r)];
}

beforeAll(async () => {
  savedAgentToken = process.env[AGENT_API_TOKEN_ENV];
  savedBackupToken = process.env[AGENT_TOKEN_ENV];
  process.env[AGENT_API_TOKEN_ENV] = TOKEN;
  process.env[AGENT_TOKEN_ENV] = BACKUP_TOKEN;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createDb(db);
  const a = Fastify({ logger: false });
  registerProjectRoutes(a, db);
  registerStageRoutes(a, db);
  registerTaskRoutes(a, db);
  registerMemberRoutes(a, db);
  registerMetaRoutes(a, db);
  registerAgentRoutes(a, db);
  await a.ready();
  app = a;

  await installFakeIndexedDB();
  bundle = await createRepositories({ dataSource: 'local' });

  /* 两侧同构播种：各一块人类项目 + 一块 Agent 看板（kind 是归属判定键） */
  for (const [id, name, kind] of [
    [HUMAN_ID, '人类项目·对端', 'human'],
    [AGENT_ID, 'Agent 板·对端', 'agent'],
  ] as const) {
    await bundle.projects.insert({
      id, name, address: '', clientName: '', contractAmount: null, signedAt: null,
      plannedStartAt: '2026-10-01', plannedEndAt: '2026-10-31', coverColor: null, kind,
    } as never);
    const r = await app.inject({
      method: 'POST', url: '/api/projects',
      headers: { 'x-agent-token': TOKEN, 'content-type': 'application/json' },
      payload: { id, name, type: 'dining', plannedStartAt: '2026-10-01', plannedEndAt: '2026-10-31' },
    });
    expect(r.statusCode, `播种失败：${r.body}`).toBe(200);
  }
  db.prepare("UPDATE projects SET kind = 'agent' WHERE id = ?").run(AGENT_ID);
  // 渲染侧给 Agent 板一个可见批次（与 0009 实机建板后的常态一致）
  await bundle.stages.bulkInsert([
    {
      id: 'stg_parity_1', projectId: AGENT_ID, name: '提案', orderIndex: 1,
      plannedStartAt: '2026-10-01', plannedEndAt: '2026-10-05', status: 'not_started',
      ownerId: null, visible: true, resourcePath: null, revision: 1,
      updatedAt: '2026-10-01T00:00:00.000Z',
    } as never,
  ]);
});

afterAll(async () => {
  await app.close();
  if (savedAgentToken === undefined) delete process.env[AGENT_API_TOKEN_ENV];
  else process.env[AGENT_API_TOKEN_ENV] = savedAgentToken;
  if (savedBackupToken === undefined) delete process.env[AGENT_TOKEN_ENV];
  else process.env[AGENT_TOKEN_ENV] = savedBackupToken;
});

describe('跨通道同参同性：同一请求，两通道必须同状态码同错误码', () => {
  it('★ 归属门：人类项目 dryRun import → 两通道同 400 project_unresolved', async () => {
    const [s, d] = await bothImport(`?projectId=${HUMAN_ID}&dryRun=1`, validPayload(HUMAN_ID));
    expect(s.status).toBe(400);
    expect(s.code).toBe('project_unresolved');
    expect(d.status).toBe(s.status);
    expect(d.code, '桌面侧错误码必须与服务端同码').toBe(s.code);
  });

  it('★ 落点参数契约名 projectId：两通道都认（server 侧 ?projectId / 桌面 opts.projectId）', async () => {
    const [s, d] = await bothImport(`?projectId=${AGENT_ID}&dryRun=1`, validPayload());
    expect(s.status).toBe(200);
    expect(d.status).toBe(s.status);
  });

  it('★ 桌面历史别名 project：桌面受理（服务端只认证契约名 projectId——别名本就是桌面兼容形，不要求同码）', async () => {
    // 具体分工：契约名 ?projectId= 两通道同参（上一条用例）；?project= 是 v0.8 面板
    // 自带的桌面历史别名，服务端不认——这正是「分工不同」而非分叉。桌面侧必须受理。
    const d = await runAgentImport(bundle, {
      requestId: 'parity-desktop-alias',
      dryRun: true,
      projectId: AGENT_ID,
      payload: validPayload(),
    });
    expect(envelope(d).status).toBe(200);
  });

  it('★ dryRun=yes（非 1/true 形态）：两通道都当预览处理（安全偏向语义同源）', async () => {
    const [s, d] = await bothImport(`?projectId=${AGENT_ID}&dryRun=yes`, validPayload());
    expect(s.status).toBe(200);
    expect(d.status).toBe(s.status);
  });

  it('★ payload 结构错误（缺 producedBy）：两通道同 400 同 Validation 码', async () => {
    const bad = { schema: 'idplan-agent-payload/v1', tasks: [{ externalId: 'x', title: 't' }] };
    const [s, d] = await bothImport(`?projectId=${AGENT_ID}`, bad);
    expect(s.status).toBe(400);
    expect(s.code).toBe('Validation');
    expect(d.code, '桌面侧映射后必须等同服务端契约码').toBe(s.code);
  });

  it('★ boards 缺 name：两通道同 400 invalid_field（错误码两通道对齐）', async () => {
    const [s, d] = await bothBoards({ plannedStartAt: '2026-10-01', plannedEndAt: '2026-10-31', presetKey: 'indoor_full' });
    expect(s.status).toBe(400);
    expect(s.code).toBe('invalid_field');
    expect(d.status).toBe(s.status);
    expect(d.code).toBe(s.code);
  });

  it('记档分叉（待拍板，各自钉死防漂移）：不存在 projectId 读侧——server 200 / desktop 400', async () => {
    const s = await app.inject({
      method: 'GET', url: '/api/agent/tasks?projectId=p_ghost_parity',
      headers: { 'x-agent-token': TOKEN },
    });
    const d = await runAgentListTasks(bundle, {
      requestId: 'parity-ghost', kind: 'list-tasks', projectId: 'p_ghost_parity',
    });
    expect(s.statusCode).toBe(200); // server：刻意 200 空列表
    expect(envelope(d).status).toBe(400); // desktop：project_unresolved
  });
});
