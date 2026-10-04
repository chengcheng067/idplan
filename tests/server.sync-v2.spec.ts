/**
 * 后端（remote 数据源 / NAS 部署）v2 同步链路集成测试。
 *
 * 存在意义：后端此前零测试覆盖，导致 SQLite schema 长期停留在 v1、
 * 与前端 backup schemaVersion=2 悄然脱节而不自知——直接后果是
 * 「备份导入 NAS 后端」第一道关卡就 500。本 spec 锁死三条防线：
 *   1. schema 含 v2 全字段（projects/stages/tasks/members）
 *   2. 数组字段（task.assigneeIds）导入不被 SQLite 隐式 join 吞掉
 *   3. 导入→导出往返闭环，且导出能被前端 zod 校验通过
 *
 * 用内存 SQLite + Fastify inject，不起端口、不依赖网络。
 */
import { describe, expect, it, beforeEach, afterEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

// T14：备份通道已 fail-closed——本 spec 全部 backup 请求需带 token。
// ★ v0.8.6 修正（调查员发现）：原注释「vitest 每文件独立进程/环境，不外泄」在
//   `singleThread:true` 下不成立——`process.env` 进程级共享，须清理（长注释见
//   tests/server.agent-json-columns.spec.ts 同处修正）
process.env.IDPLAN_AGENT_TOKEN = 'test-token';
afterAll(() => {
  delete process.env.IDPLAN_AGENT_TOKEN;
});

import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';
import { registerTaskRoutes } from '../server/routes/tasks.routes';
import { registerMemberRoutes } from '../server/routes/members.routes';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { validateBackupJson } from '../src/core/services/backup.service';

/** 建一个内存库 + 注册全量路由的 Fastify 实例 */
async function buildServer() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createDb(db);

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
  await app.ready();
  return { app, db };
}

/** 最小可用的 v2 备份包（含全部 v2 字段 + 多人指派） */
function samplePackage() {
  const now = '2026-08-29T02:30:00.000Z';
  return {
    meta: { app: 'changxia' as const, schemaVersion: 2, exportedAt: now },
    data: {
      projects: [
        {
          id: 'p1',
          name: '测试项目',
          type: 'dining',
          address: '成都',
          clientName: '甲方',
          contractAmount: 1000,
          signedAt: '2026-08-01T00:00:00.000Z',
          plannedStartAt: '2026-08-01',
          plannedEndAt: '2026-10-01',
          coverColor: 'clay',
          stagePresetKey: 'indoor_full',
          stageTemplateVersion: 1,
          scheduleBasis: 'calendar',
          status: 'active',
          revision: 1,
          updatedAt: now,
        },
      ],
      stages: [
        {
          id: 's1',
          projectId: 'p1',
          orderIndex: 1,
          templateKey: 'indoor.proposal',
          colorIndex: 1,
          name: '提案',
          ratioPercent: 10,
          startAt: '2026-08-01',
          endAt: '2026-08-10',
          status: 'in_progress',
          ownerId: 'm1',
          visible: true,
          resourcePath: null,
          revision: 1,
          updatedAt: now,
        },
      ],
      tasks: [
        {
          id: 't1',
          projectId: 'p1',
          stageId: 's1',
          title: '需求沟通',
          done: true,
          assigneeId: 'm1',
          // 多人指派：这条数据曾因 SQLite 无数组类型被隐式 join 吞成字符串
          assigneeIds: ['m1', 'm2'],
          dueDate: '2026-08-10',
          // v0.6 Agent 字段（M36：samplePackage 补 9 字段，status 与 done 一致）
          source: 'human',
          externalId: null,
          agentId: null,
          status: 'done',
          description: null,
          dependsOn: [],
          artifacts: [
            { id: 'art_1', kind: 'file', title: '平面图.pdf', path: '/docs/plan.pdf', url: null, note: null },
          ],
          startAt: null,
          claimedAt: null,
          runId: null,
          orderIndex: 1,
          revision: 1,
          updatedAt: now,
        },
      ],
      members: [
        {
          id: 'm1',
          name: '甲',
          role: '主案',
          contact: null,
          avatarColor: '#5B8C5A',
          active: true,
          roleKind: 'admin',
          // v0.6 Member 2 字段
          actorKind: 'human',
          agentKind: null,
          revision: 1,
          updatedAt: now,
        },
      ],
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
    },
  };
}

describe('后端 v2 同步链路（NAS remote 数据源）', () => {
  let ctx: Awaited<ReturnType<typeof buildServer>>;

  const nowIso = (): string => new Date().toISOString();

  beforeEach(async () => {
    ctx = await buildServer();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.db.close();
  });

  it('schema 含 v2 全字段（projects/stages/tasks/members）', () => {
    const pCols = (ctx.db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(pCols).toEqual(
      expect.arrayContaining(['stage_preset_key', 'stage_template_version', 'schedule_basis']),
    );

    const sCols = (ctx.db.prepare('PRAGMA table_info(stages)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(sCols).toEqual(expect.arrayContaining(['template_key', 'color_index']));

    const tCols = (ctx.db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(tCols).toEqual(expect.arrayContaining(['assignee_ids']));
    // v0.6（M36）：schema 断言补 11 列（tasks 9 + members 2），既有断言不改
    expect(tCols).toEqual(
      expect.arrayContaining([
        'source',
        'external_id',
        'agent_id',
        'status',
        'description',
        'depends_on',
        'artifacts',
        'start_at',
        'claimed_at',
      ]),
    );

    const mCols = (ctx.db.prepare('PRAGMA table_info(members)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(mCols).toEqual(expect.arrayContaining(['role_kind', 'password_hash']));
    expect(mCols).toEqual(expect.arrayContaining(['actor_kind', 'agent_kind']));
  });

  it('stages.order_index 上限放宽到 99（前端备份 schema 已放宽，老库 CHECK 1-9 会拒写）', async () => {
    // 先建父项目：stages.project_id 有外键约束，缺父行会 FOREIGN KEY constraint failed
    const pRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        id: 'p1',
        name: '外键父项目',
        type: 'dining',
        address: '',
        clientName: '',
        plannedStartAt: '2026-08-01',
        plannedEndAt: '2026-10-01',
      },
    });
    expect(pRes.statusCode).toBe(200);

    // 直接验证 CHECK 约束：order_index=12 在 v1 schema 下会被 CHECK(BETWEEN 1 AND 9) 拒绝
    expect(() =>
      ctx.db
        .prepare(
          `INSERT INTO stages
            (id, project_id, order_index, name, ratio_percent, start_at, end_at,
             status, owner_id, visible, resource_path, revision, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          's12',
          'p1',
          12,
          '第十二阶段',
          5,
          '2026-08-01',
          '2026-08-05',
          'not_started',
          null,
          1,
          null,
          1,
          '2026-08-29T00:00:00.000Z',
        ),
    ).not.toThrow();

    // 同时验证 bulk 路由（含 v2 字段）也能写入 >9 的序号
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/stages/bulk',
      payload: {
        rows: [
          {
            id: 's11',
            projectId: 'p1',
            orderIndex: 11,
            templateKey: 'indoor.custom',
            colorIndex: 9,
            name: '第十一阶段',
            ratioPercent: 5,
            startAt: '2026-08-01',
            endAt: '2026-08-05',
            status: 'not_started',
            ownerId: null,
            visible: true,
            resourcePath: null,
            revision: 1,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const stages = (
      await ctx.app.inject({ method: 'GET', url: '/api/projects/p1/stages' })
    ).json() as Array<Record<string, unknown>>;
    expect(stages.some((s) => s.orderIndex === 12)).toBe(true);
    expect(stages.some((s) => s.orderIndex === 11 && s.templateKey === 'indoor.custom')).toBe(true);
  });

  it('导入 v2 备份不 500，且 v2 字段正确落库', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: { 'x-agent-token': 'test-token' },
      payload: samplePackage(),
    });
    expect(res.statusCode).toBe(200);
    // ★ v0.7（T01-b）：响应体新增 `renumbered` = 真实重编号条数（`ok` 保留，老客户端仍能读）。
    //   本包内无撞号 → 期望 0；顺带把「正常包不误报重编号」这条锁在这里。
    expect(res.json()).toEqual({ ok: true, renumbered: 0 });

    const projects = (await ctx.app.inject({ method: 'GET', url: '/api/projects' })).json() as Array<
      Record<string, unknown>
    >;
    expect(projects).toHaveLength(1);
    expect(projects[0].stagePresetKey).toBe('indoor_full');
    expect(projects[0].stageTemplateVersion).toBe(1);
    expect(projects[0].scheduleBasis).toBe('calendar');

    const stages = (
      await ctx.app.inject({ method: 'GET', url: '/api/projects/p1/stages' })
    ).json() as Array<Record<string, unknown>>;
    expect(stages[0].templateKey).toBe('indoor.proposal');
    expect(stages[0].colorIndex).toBe(1);

    const members = (await ctx.app.inject({ method: 'GET', url: '/api/members' })).json() as Array<
      Record<string, unknown>
    >;
    expect(members[0].roleKind).toBe('admin');
  });

  it('task.assigneeIds 多人指派不被 SQLite 隐式 join 吞掉（回归防线）', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: { 'x-agent-token': 'test-token' },
      payload: samplePackage(),
    });

    const tasks = (await ctx.app.inject({ method: 'GET', url: '/api/tasks?stageId=s1' })).json() as Array<
      Record<string, unknown>
    >;
    expect(tasks).toHaveLength(1);
    // 关键：必须是真正的数组且保留全部成员，不能是 'm1' 字符串或 []
    expect(Array.isArray(tasks[0].assigneeIds)).toBe(true);
    expect(tasks[0].assigneeIds).toEqual(['m1', 'm2']);
  });

  it('v0.6 密码系统：POST /api/members/verify 服务端 scrypt 比对（不泄露密码哈希）', async () => {
    // 创建带密码的成员（后端 scrypt 哈希）
    const created = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/members',
        payload: { name: '暗号员', role: '绘图', avatarColor: '#3D6B5B', password: 'secret-9' },
      })
    ).json() as Record<string, unknown>;
    // v0.6.1：实时接口只下发 hasPassword 布尔值，哈希本体绝不下发
    // （scrypt 虽不可逆，但下发哈希 + 无鉴权 + 无限流 = 递出离线爆破的原料）
    expect(created.hasPassword).toBe(true);
    expect(created.passwordHash).toBeUndefined();
    // 明文更不可能出现在响应里
    expect(JSON.stringify(created)).not.toContain('secret-9');

    // 正确密码 → 200
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/members/verify',
      payload: { memberId: created.id, password: 'secret-9' },
    });
    expect(ok.statusCode).toBe(200);

    // 错误密码 → 401（模糊提示，防成员枚举）
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/members/verify',
      payload: { memberId: created.id, password: 'wrong' },
    });
    expect(bad.statusCode).toBe(401);

    // 无密码成员无需验证（无密码成员直接进入语义）
    const noPwd = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/members',
        payload: { name: '无密码员', role: '', avatarColor: '#3D6B5B' },
      })
    ).json() as Record<string, unknown>;
    expect(noPwd.hasPassword).toBe(false);

    // 清除密码后，旧密码不再通过
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/members/${created.id}`,
      payload: { password: null },
    });
    const cleared = await ctx.app.inject({
      method: 'POST',
      url: '/api/members/verify',
      payload: { memberId: created.id, password: 'secret-9' },
    });
    expect(cleared.statusCode).toBe(401);
  });

  it('导入 → 导出往返闭环，且导出可被前端 zod 校验通过', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: { 'x-agent-token': 'test-token' },
      payload: samplePackage(),
    });

    const exported = (await ctx.app.inject({ method: 'GET', url: '/api/backup', headers: { 'x-agent-token': 'test-token' } })).json() as Record<
      string,
      unknown
    >;

    // 导出必须标 v2，否则前端走 v1 归一路径会把 v2 新字段视作缺失
    expect((exported.meta as Record<string, unknown>).schemaVersion).toBe(3);

    // 导出仍必须是数组（rowToDto 需反序列化 JSON 数组列）
    const data = exported.data as Record<string, Array<Record<string, unknown>>>;
    expect(Array.isArray(data.tasks[0].assigneeIds)).toBe(true);
    expect(data.tasks[0].assigneeIds).toEqual(['m1', 'm2']);

    // 终极校验：导出物必须能被前端真实 zod schema 接受（否则导入前端会被拒）
    expect(() => validateBackupJson(exported)).not.toThrow();
    const parsed = validateBackupJson(exported);
    expect(parsed.data.projects).toHaveLength(1);
    expect(parsed.data.tasks[0].assigneeIds).toEqual(['m1', 'm2']);
  });

  it('老库（v1 表结构）自动迁移补齐 v2 列，无需删库', () => {
    // 手工建一个 v1 老库
    const legacy = new Database(':memory:');
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
    `);
    // 跑 v2 迁移（createDb 内含幂等 ALTER）
    createDb(legacy);

    const pCols = (legacy.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(pCols).toEqual(
      expect.arrayContaining(['stage_preset_key', 'stage_template_version', 'schedule_basis']),
    );

    const tCols = (legacy.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(tCols).toEqual(expect.arrayContaining(['assignee_ids']));

    legacy.close();
  });

  it('DELETE /projects/:id 级联删除项目及其阶段/任务/流水', async () => {
    // 建父项目
    const pRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        id: 'p-del',
        name: '待删除项目',
        type: 'dining',
        address: '',
        clientName: '',
        plannedStartAt: '2026-08-01',
        plannedEndAt: '2026-10-01',
      },
    });
    expect(pRes.statusCode).toBe(200);

    // 插入阶段 + 任务（模拟服务端真实写入）
    ctx.db.prepare(
      `INSERT INTO stages (id, project_id, order_index, name, ratio_percent, start_at, end_at, status, owner_id, visible, resource_path, revision, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('s-del', 'p-del', 1, '方案设计', 30, '2026-08-01', '2026-08-10', 'not_started', null, 1, null, 1, nowIso());
    ctx.db.prepare(
      `INSERT INTO tasks (id, project_id, stage_id, title, done, assignee_id, assignee_ids, due_date, order_index, revision, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('t-del', 'p-del', 's-del', '出平面图', 0, null, '[]', '2026-08-05', 1, 1, nowIso());
    ctx.db.prepare(
      `INSERT INTO stage_logs (id, stage_id, project_id, type, operator_name, created_at)
       VALUES (?,?,?,?,?,?)`,
    ).run('log-del', 's-del', 'p-del', 'created', 'system', nowIso());

    // 删除前数量
    expect((ctx.db.prepare('SELECT COUNT(*) c FROM stages WHERE project_id=?').get('p-del') as { c: number }).c).toBe(1);
    expect((ctx.db.prepare('SELECT COUNT(*) c FROM tasks WHERE project_id=?').get('p-del') as { c: number }).c).toBe(1);
    expect((ctx.db.prepare('SELECT COUNT(*) c FROM stage_logs WHERE project_id=?').get('p-del') as { c: number }).c).toBe(1);

    // DELETE
    const del = await ctx.app.inject({ method: 'DELETE', url: '/api/projects/p-del' });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });

    // 级联清空
    expect((ctx.db.prepare('SELECT COUNT(*) c FROM projects WHERE id=?').get('p-del') as { c: number }).c).toBe(0);
    expect((ctx.db.prepare('SELECT COUNT(*) c FROM stages WHERE project_id=?').get('p-del') as { c: number }).c).toBe(0);
    expect((ctx.db.prepare('SELECT COUNT(*) c FROM tasks WHERE project_id=?').get('p-del') as { c: number }).c).toBe(0);
    expect((ctx.db.prepare('SELECT COUNT(*) c FROM stage_logs WHERE project_id=?').get('p-del') as { c: number }).c).toBe(0);
  });

  it('DELETE /projects/:id 对不存在项目返回 404', async () => {
    const del = await ctx.app.inject({ method: 'DELETE', url: '/api/projects/no-such-id' });
    expect(del.statusCode).toBe(404);
  });
});
