/**
 * T14 备份通道安全（v0.6 · 设计文档 T14 DoD 逐条 + T15 spec 清单 #9）。
 *
 * 锁死五条防线：
 *   1. 无 token 请求 /api/backup → 401（fail-closed）
 *   2. 带正确 token → 200，且 members 默认脱敏（passwordHash=null + hasPassword 布尔）
 *   3. ?includeSecrets=1 + token → 真实哈希下发（NAS→NAS 整机迁移场景）
 *   4. env 未配置 token → 所有 backup 请求 401（fail-closed 验证）
 *   5. 脱敏后的备份仍能通过前端 validateBackupJson（键序未变、形状稳定）
 *
 * 附带锁定：/api/bootstrap 不鉴权但 members 一并脱敏（Q-D 拍板）；
 *           /api/backup/import 必须鉴权（防匿名整库替换——比泄露更危险的写通道）。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerMemberRoutes } from '../server/routes/members.routes';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { validateBackupJson } from '../src/core/services/backup.service';
import { AGENT_TOKEN_ENV } from '../server/lib/agent-auth';

const TOKEN = 'drill-token-0123456789abcdef';

let app: Awaited<ReturnType<typeof buildServer>>;
let db: Database.Database;
let savedToken: string | undefined;

async function buildServer() {
  const fastify = Fastify({ logger: false });
  fastify.setErrorHandler((err, _req, reply) => {
    void reply.status(err.statusCode ?? 500).send({
      error: {
        code: String((err as { code?: string }).code ?? 'internal'),
        userMessage: (err as { userMessage?: string }).userMessage ?? '服务器内部错误',
      },
    });
  });
  // 复用 beforeEach 建好并 seed 过的同一个内存库（此前各自建库导致 seed 落空）
  registerProjectRoutes(fastify, db);
  registerMemberRoutes(fastify, db);
  registerMetaRoutes(fastify, db);
  await fastify.ready();
  return fastify;
}

/** 预置一名带密码哈希的管理员 + 一个项目 */
function seed(): void {
  db.prepare(
    `INSERT INTO projects (id, name, type, planned_start_at, planned_end_at, updated_at)
     VALUES ('p1', '安全演练', 'dining', '2026-09-01', '2026-12-31', '2026-09-01T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO members (id, name, role, contact, avatar_color, active, role_kind, password_hash, revision, updated_at)
     VALUES ('m1', '甲', '主案', NULL, '#3D6B5B', 1, 'admin', 'scrypt$fake-hash-not-real', 1, '2026-09-01T00:00:00.000Z')`,
  ).run();
}

beforeEach(() => {
  savedToken = process.env[AGENT_TOKEN_ENV];
  process.env[AGENT_TOKEN_ENV] = TOKEN;
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createDb(db);
  seed();
});

afterEach(() => {
  if (savedToken === undefined) delete process.env[AGENT_TOKEN_ENV];
  else process.env[AGENT_TOKEN_ENV] = savedToken;
  db.close();
});

describe('T14 · /api/backup 鉴权（fail-closed）', () => {
  it('无 token → 401，错误体形状 {error:{code,userMessage}}', async () => {
    app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/backup' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string; userMessage: string } };
    expect(body.error.code).toBe('Unauthorized');
    expect(body.error.userMessage).toContain('IDPLAN_AGENT_TOKEN');
  });

  it('env 未配置 token → 401（fail-closed，不是放行）', async () => {
    delete process.env[AGENT_TOKEN_ENV];
    app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/backup' });
    expect(res.statusCode).toBe(401);
  });

  it('错误 token → 401；正确 token（Bearer 与 X-Agent-Token 两种头）→ 200', async () => {
    app = await buildServer();
    const wrong = await app.inject({
      method: 'GET',
      url: '/api/backup',
      headers: { 'x-agent-token': 'wrong-token' },
    });
    expect(wrong.statusCode).toBe(401);

    const viaHeader = await app.inject({
      method: 'GET',
      url: '/api/backup',
      headers: { 'x-agent-token': TOKEN },
    });
    expect(viaHeader.statusCode).toBe(200);

    const viaBearer = await app.inject({
      method: 'GET',
      url: '/api/backup',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(viaBearer.statusCode).toBe(200);
  });

  it('POST /api/backup/import 无 token → 401（写通道比泄露更危险，必须同样设防）', async () => {
    app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      payload: { meta: {}, data: {} },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('T14 · members 脱敏', () => {
  it('带 token 默认导出：passwordHash=null、hasPassword=true（布尔）', async () => {
    app = await buildServer();
    const pkg = (
      await app.inject({
        method: 'GET',
        url: '/api/backup',
        headers: { 'x-agent-token': TOKEN },
      })
    ).json() as { data: { members: Array<Record<string, unknown>> } };
    const m = pkg.data.members[0] as Record<string, unknown>;
    expect(m.passwordHash).toBeNull();
    expect(m.hasPassword).toBe(true);
    // 绝不下发真实哈希
    expect(JSON.stringify(pkg)).not.toContain('scrypt$fake-hash-not-real');
  });

  it('?includeSecrets=1 + token → 真实哈希下发（整机迁移专用）', async () => {
    app = await buildServer();
    const pkg = (
      await app.inject({
        method: 'GET',
        url: '/api/backup?includeSecrets=1',
        headers: { 'x-agent-token': TOKEN },
      })
    ).json() as { data: { members: Array<Record<string, unknown>> } };
    const m = pkg.data.members[0] as Record<string, unknown>;
    expect(m.passwordHash).toBe('scrypt$fake-hash-not-real');
    expect(m.hasPassword).toBe(true);
  });

  it('POST /api/bootstrap 不鉴权但 members 脱敏（Q-D 拍板）', async () => {
    app = await buildServer();
    const res = await app.inject({ method: 'POST', url: '/api/bootstrap' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { members: Array<Record<string, unknown>> };
    expect(body.members[0].passwordHash).toBeNull();
    expect(body.members[0].hasPassword).toBe(true);
    expect(JSON.stringify(body)).not.toContain('scrypt$fake-hash-not-real');
  });

  it('脱敏后的备份仍通过前端 validateBackupJson（键序/形状稳定）', async () => {
    app = await buildServer();
    // 先放一个最小项目使 backup 形状完整（members 已预置）
    const pkg = (
      await app.inject({
        method: 'GET',
        url: '/api/backup',
        headers: { 'x-agent-token': TOKEN },
      })
    ).json() as unknown;
    // 前端 zod 校验不抛 = 形状稳定（passwordHash nullable、hasPassword 被忽略）
    expect(() => validateBackupJson(pkg)).not.toThrow();
  });
});
