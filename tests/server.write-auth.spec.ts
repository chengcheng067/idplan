// @vitest-environment node
/**
 * P0-1 · NAS 业务写端点鉴权（v0.8.6 · 安全官红牌 · 她 10-01 拍板「一定要记得修」）。
 *
 * 背景：settings / logs / contracts 全族零鉴权（LAN 任意方可覆写 taskNoSeq
 * 制造重号、伪造审计流水；自定义行业落 settings KV = 远程投递面）。
 *
 * 门的设计（agent-auth.ts requireWriteToken）：
 *   · env 配了 token → 必须 Bearer（常量时间比较）；
 *   · 未配 → 放行 + 响应带 x-idplan-write-auth: open 告警头。
 *
 * 钉四条：
 *   ① 配了 token：无 Bearer → 401（七端点逐一验）；
 *   ② 配了 token：带对 Bearer → 通（200/正常响应）；
 *   ③ 未配：放行 + open 告警头（不破坏现存部署，0.8.2 事故教训：高频写
 *      端点不能硬 fail-closed）；
 *   ④ 源码锁：七端点都在 guardWrite 门下（未来新写端点忘了加会红）。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDb } from '../server/db';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { AGENT_TOKEN_ENV } from '../server/lib/agent-auth';

import type { FastifyInstance } from 'fastify';

const TOKEN = 'write-gate-token';
let saved: string | undefined;
let db: import('better-sqlite3').Database;

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerMetaRoutes(app, db);
  await app.ready();
  return app;
}

beforeEach(() => {
  saved = process.env[AGENT_TOKEN_ENV];
  process.env[AGENT_TOKEN_ENV] = TOKEN;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createDb(db);
});

afterEach(() => {
  if (saved === undefined) delete process.env[AGENT_TOKEN_ENV];
  else process.env[AGENT_TOKEN_ENV] = saved;
  db.close();
});

/** 七个业务写端点（方法 + 路径 + 一份无害的最小 body） */
const WRITE_ENDPOINTS: ReadonlyArray<{ method: 'POST' | 'PUT'; path: string; body: unknown }> = [
  { method: 'POST', path: '/api/logs/stage', body: { stageId: 's1', projectId: 'p1', type: 'rescheduled', operatorName: 'x' } },
  { method: 'POST', path: '/api/logs/assignments', body: { taskId: 't1', projectId: 'p1', assigneeId: 'm1', action: 'assign' } },
  { method: 'POST', path: '/api/contracts', body: { name: 'c', amount: 1, signedAt: null } },
  { method: 'POST', path: '/api/contracts/c1/link-project', body: { projectId: 'p1' } },
  { method: 'POST', path: '/api/contracts/c1/confirmed-payload', body: {} },
  { method: 'PUT', path: '/api/settings/currentMemberId', body: { valueJson: '"m1"' } },
  { method: 'POST', path: '/api/settings/replace-all', body: { rows: [] } },
];

describe('P0-1 · 业务写端点鉴权（settings/logs/contracts）', () => {
  it('① 配了 token：七端点无 Bearer 一律 401', async () => {
    const app = await buildServer();
    for (const ep of WRITE_ENDPOINTS) {
      const res = await app.inject({
        method: ep.method,
        url: ep.path,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(ep.body),
      });
      expect(res.statusCode, `${ep.method} ${ep.path} 无 token 必须 401`).toBe(401);
    }
  });

  it('② 配了 token：带正确 Bearer 放行（非 401）', async () => {
    const app = await buildServer();
    for (const ep of WRITE_ENDPOINTS) {
      const res = await app.inject({
        method: ep.method,
        url: ep.path,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        payload: JSON.stringify(ep.body),
      });
      expect(res.statusCode, `${ep.method} ${ep.path} 带 token 不得 401`).not.toBe(401);
    }
  });

  it('③ 配了 token：错 token 也 401（不是「有头就过」）', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/currentMemberId',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      payload: { valueJson: '"m1"' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('④ 未配 token：放行 + x-idplan-write-auth: open 告警头（0.8.2 教训：高频写不硬拒）', async () => {
    delete process.env[AGENT_TOKEN_ENV];
    const app = await buildServer();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/currentMemberId',
      headers: { 'content-type': 'application/json' },
      payload: { valueJson: '"m1"' },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.headers['x-idplan-write-auth']).toBe('open');
  });

  it('⑤ 源码锁：七端点都挂在 guardWrite 门下（新写端点漏加会红）', () => {
    const src = readFileSync(join(__dirname, '..', 'server/routes/meta.routes.ts'), 'utf8');
    const guarded = (src.match(/if \(!guardWrite\(req, reply\)\) return;/g) ?? []).length;
    expect(guarded, '七个业务写端点必须逐一加门').toBe(7);
    // 门本体在位
    expect(src).toContain('const guardWrite =');
  });
});
