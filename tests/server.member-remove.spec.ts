// @vitest-environment node
/**
 * 服务端 · `DELETE /api/members/:id`（v1.0.0.0020 · 删除成员）。
 *
 * ══════════════════ 这个端点为什么单独测 ══════════════════
 * NAS 形态下前端只发一个 HTTP 请求，真正的三表改写全在服务端发生。local 侧的
 * `member-remove.spec.ts` 绿了**推不出**这条也绿——两份实现各自独立（Dexie 事务
 * vs better-sqlite3 事务），尤其是 `assignee_ids` 这个 JSON 数组列：local 侧拿到的是
 * 反序列化后的 `string[]`，服务端拿到的是**文本**，必须先「解析 → 过滤 → 回写」。
 *
 * 钉五条：
 *   ① 正常路径（`reassignTo=null` ⇒ 置空）＋ 返回改写的行数；
 *   ② 转移路径：`assignee_ids` 里逐项替换并**去重**（不是字符串替换）；
 *   ③ **`assignee_ids` 只移除该项、保留其余**（JSON 解析-过滤的核心判据）；
 *   ④ 不存在 id ⇒ 404；接收人不存在 / 自指 ⇒ 400；
 *   ⑤ `assignments` 表逐字节不变（append-only 审计）。
 *
 * 另外一条**形态判据**：`assignee_ids` 里若出现 `m1` 与 `m12` 两个前缀相同的 id，
 * 字符串 `replace` 会把 `m12` 一起改坏 —— 用例 ③ 就是拿这个形态钉的。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerMemberRoutes } from '../server/routes/members.routes';

import type { FastifyInstance } from 'fastify';

let db: import('better-sqlite3').Database;
let app: FastifyInstance;

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createDb(db);
  app = Fastify({ logger: false });
  registerMemberRoutes(app, db);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

/* ──────────────────────────── 播种工具 ──────────────────────────── */

const NOW = '2026-10-01T00:00:00.000Z';

function seedMember(id: string, name: string): void {
  db.prepare(
    `INSERT INTO members (id, name, role, contact, avatar_color, active, role_kind, password_hash, actor_kind, agent_kind, revision, updated_at)
     VALUES (?, ?, '协作', NULL, '#3D6B5B', 1, 'member', NULL, 'human', NULL, 1, ?)`,
  ).run(id, name, NOW);
}

function seedProject(id: string, ownerMemberId: string | null): void {
  db.prepare(
    `INSERT INTO projects (id, name, type, address, client_name, contract_amount, signed_at, planned_start_at, planned_end_at, cover_color, kind, owner_member_id, status, revision, updated_at)
     VALUES (?, ?, 'dining', '', '', NULL, NULL, '2026-10-01', '2026-10-31', NULL, 'human', ?, 'active', 1, ?)`,
  ).run(id, `项目 ${id}`, ownerMemberId, NOW);
}

function seedStage(id: string, projectId: string, ownerId: string | null): void {
  db.prepare(
    `INSERT INTO stages (id, project_id, name, order_index, ratio_percent, start_at, end_at, status, owner_id, visible, resource_path, revision, updated_at)
     VALUES (?, ?, ?, 1, 10, '2026-10-01', '2026-10-07', 'not_started', ?, 1, NULL, 1, ?)`,
  ).run(id, projectId, `阶段 ${id}`, ownerId, NOW);
}

function seedTask(id: string, projectId: string, stageId: string, assigneeId: string | null, assigneeIds: string[]): void {
  db.prepare(
    `INSERT INTO tasks (id, project_id, stage_id, title, done, assignee_id, assignee_ids, status, revision, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, 'draft', 1, ?)`,
  ).run(id, projectId, stageId, `任务 ${id}`, assigneeId, JSON.stringify(assigneeIds), NOW);
}

function seedAssignment(id: string, taskId: string, projectId: string, memberId: string | null): void {
  db.prepare(
    `INSERT INTO assignments (id, task_id, project_id, member_id, action, operator_name, created_at)
     VALUES (?, ?, ?, ?, 'assign', '管理员', ?)`,
  ).run(id, taskId, projectId, memberId, NOW);
}

function row(sql: string, ...args: unknown[]): Record<string, unknown> | undefined {
  return db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
}

async function del(id: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'DELETE',
    url: `/api/members/${id}`,
    headers: { 'content-type': 'application/json' },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

/* ══════════════════════════ ① 正常路径（置空） ══════════════════════════ */

describe('① 正常路径：reassignTo=null ⇒ 三处引用置空、成员行被删、返回改写行数', () => {
  it('无引用 ⇒ 全 0，成员消失', async () => {
    seedMember('m1', '走的人');
    const { status, json } = await del('m1');
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, deletedId: 'm1', reassignTo: null, tasks: 0, stages: 0, projects: 0 });
    expect(row('SELECT id FROM members WHERE id = ?', 'm1')).toBeUndefined();
  });

  it('有引用 ⇒ 置空并报出改写行数', async () => {
    seedMember('m1', '走的人');
    seedProject('p1', 'm1');
    seedStage('s1', 'p1', 'm1');
    seedTask('t1', 'p1', 's1', 'm1', ['m1']);

    const { status, json } = await del('m1');
    expect(status).toBe(200);
    expect(json).toMatchObject({ tasks: 1, stages: 1, projects: 1 });

    const t = row('SELECT * FROM tasks WHERE id = ?', 't1')!;
    expect(t.assignee_id).toBeNull();
    expect(JSON.parse(String(t.assignee_ids))).toEqual([]);
    expect(row('SELECT owner_id FROM stages WHERE id = ?', 's1')!.owner_id).toBeNull();
    expect(row('SELECT owner_member_id FROM projects WHERE id = ?', 'p1')!.owner_member_id).toBeNull();
    expect(row('SELECT id FROM members WHERE id = ?', 'm1')).toBeUndefined();
  });
});

/* ══════════════════════════ ② 转移路径 ══════════════════════════ */

describe('② 转移路径：reassignTo=某人 ⇒ 引用改到接收人并去重', () => {
  it('三处都改到接收人；重复项被去重', async () => {
    seedMember('m1', '走的人');
    seedMember('m2', '接手的人');
    seedProject('p1', 'm1');
    seedStage('s1', 'p1', 'm1');
    seedTask('t1', 'p1', 's1', 'm1', ['m1']);
    seedTask('t2', 'p1', 's1', 'm1', ['m1', 'm2']);

    const { status, json } = await del('m1', { reassignTo: 'm2' });
    expect(status).toBe(200);
    expect(json).toMatchObject({ tasks: 2, stages: 1, projects: 1, reassignTo: 'm2' });

    expect(row('SELECT assignee_id FROM tasks WHERE id = ?', 't1')!.assignee_id).toBe('m2');
    expect(JSON.parse(String(row('SELECT assignee_ids FROM tasks WHERE id = ?', 't1')!.assignee_ids))).toEqual(['m2']);
    // t2 原本就是 [m1, m2] ⇒ 转移后必须去重成 ['m2']，不能是 ['m2','m2']
    expect(JSON.parse(String(row('SELECT assignee_ids FROM tasks WHERE id = ?', 't2')!.assignee_ids))).toEqual(['m2']);
    expect(row('SELECT owner_member_id FROM projects WHERE id = ?', 'p1')!.owner_member_id).toBe('m2');
    expect(row('SELECT owner_id FROM stages WHERE id = ?', 's1')!.owner_id).toBe('m2');
    expect(row('SELECT id FROM members WHERE id = ?', 'm1')).toBeUndefined();
    expect(row('SELECT id FROM members WHERE id = ?', 'm2')).toBeDefined();
  });
});

/* ══════════════════════════ ③ JSON 数组只移除该项 ══════════════════════════ */

describe('③ assignee_ids 是 JSON 数组：解析→过滤→回写，只摘该项、保留其余', () => {
  it('★ 多人任务只摘掉被删的人；★ 前缀相同的 id（m1 / m12）不被串改', async () => {
    seedMember('m1', '走的人');
    seedMember('m12', '名字前缀相同的人');
    seedMember('m2', '第三方');
    seedProject('p1', null);
    seedStage('s1', 'p1', null);
    // t1 三人：# 关键形态 —— 'm1' 是 'm12' 的字符串前缀，字符串 replace 会把 m12 改坏
    seedTask('t1', 'p1', 's1', 'm1', ['m1', 'm12', 'm2']);
    // t2：集合为空、只有主负责人（存量老形态）
    seedTask('t2', 'p1', 's1', 'm1', []);
    // t3：只在集合里、主负责人是别人
    seedTask('t3', 'p1', 's1', 'm2', ['m2', 'm1']);

    const { status } = await del('m1');
    expect(status).toBe(200);

    const t1 = JSON.parse(String(row('SELECT assignee_ids FROM tasks WHERE id = ?', 't1')!.assignee_ids));
    expect(t1, '★ 其余参与人必须留着，且 m12 不能被 m1 的替换串改').toEqual(['m12', 'm2']);
    expect(row('SELECT assignee_id FROM tasks WHERE id = ?', 't1')!.assignee_id, '主负责人重算为新的第一参与人').toBe('m12');

    const t2 = row('SELECT assignee_id, assignee_ids FROM tasks WHERE id = ?', 't2')!;
    expect(t2.assignee_id, '老形态（集合空、只有主负责人）也要被摘掉').toBeNull();
    expect(JSON.parse(String(t2.assignee_ids))).toEqual([]);

    const t3 = row('SELECT assignee_id, assignee_ids FROM tasks WHERE id = ?', 't3')!;
    expect(JSON.parse(String(t3.assignee_ids))).toEqual(['m2']);
    expect(t3.assignee_id).toBe('m2');
  });

  it('脏 JSON（坏数据）不 500：按空数组处理，不阻塞删人', async () => {
    seedMember('m1', '走的人');
    seedProject('p1', null);
    seedStage('s1', 'p1', null);
    db.prepare(
      `INSERT INTO tasks (id, project_id, stage_id, title, done, assignee_id, assignee_ids, status, revision, updated_at)
       VALUES ('t1', 'p1', 's1', '坏数据任务', 0, 'm1', 'not-json', 'draft', 1, ?)`,
    ).run(NOW);

    const { status } = await del('m1');
    expect(status).toBe(200);
    // 主负责人命中了 ⇒ 仍要处理；集合解析失败按 [] 处理
    const t = row('SELECT assignee_id, assignee_ids FROM tasks WHERE id = ?', 't1')!;
    expect(t.assignee_id).toBeNull();
    expect(JSON.parse(String(t.assignee_ids))).toEqual([]);
  });
});

/* ══════════════════════════ ④ 错误路径 ══════════════════════════ */

describe('④ 错误路径：404 / 400', () => {
  it('不存在的 id ⇒ 404 + serverErr.member.notFound', async () => {
    const { status, json } = await del('mem_ghost');
    expect(status).toBe(404);
    expect((json.error as Record<string, unknown>).messageKey).toBe('serverErr.member.notFound');
  });

  it('接收人不存在 ⇒ 400（不静默置空：否则界面那句「已转移」是假的）', async () => {
    seedMember('m1', '走的人');
    const { status, json } = await del('m1', { reassignTo: 'mem_nobody' });
    expect(status).toBe(400);
    expect((json.error as Record<string, unknown>).messageKey).toBe('coreErr.member.notFound');
    // 成员仍在（事务未执行）
    expect(row('SELECT id FROM members WHERE id = ?', 'm1')).toBeDefined();
  });

  it('reassignTo 指向自己 ⇒ 400（引用会原地打转）', async () => {
    seedMember('m1', '走的人');
    const { status, json } = await del('m1', { reassignTo: 'm1' });
    expect(status).toBe(400);
    expect((json.error as Record<string, unknown>).messageKey).toBe('coreErr.member.reassignToSelf');
    expect(row('SELECT id FROM members WHERE id = ?', 'm1')).toBeDefined();
  });
});

/* ══════════════════════════ ⑤ assignments 不变 ══════════════════════════ */

describe('⑤ assignments 是 append-only 审计：删人后逐字节不变', () => {
  it('转移与置空两条路径都不动历史流水', async () => {
    seedMember('m1', '走的人');
    seedMember('m2', '接手的人');
    seedProject('p1', null);
    seedStage('s1', 'p1', null);
    seedTask('t1', 'p1', 's1', 'm1', ['m1']);
    seedAssignment('log1', 't1', 'p1', 'm1');
    seedAssignment('log2', 't1', 'p1', 'm1');
    seedAssignment('log3', 't1', 'p1', null);

    const before = JSON.stringify(db.prepare('SELECT * FROM assignments ORDER BY id').all());
    expect(JSON.parse(before)).toHaveLength(3);

    expect((await del('m1', { reassignTo: 'm2' })).status).toBe(200);
    expect(JSON.stringify(db.prepare('SELECT * FROM assignments ORDER BY id').all())).toBe(before);

    // 再来一次（置空路径）
    seedMember('m3', '第二个走的人');
    seedTask('t2', 'p1', 's1', 'm3', ['m3']);
    seedAssignment('log4', 't2', 'p1', 'm3');
    const before2 = JSON.stringify(db.prepare('SELECT * FROM assignments ORDER BY id').all());
    expect((await del('m3')).status).toBe(200);
    expect(JSON.stringify(db.prepare('SELECT * FROM assignments ORDER BY id').all())).toBe(before2);
    // 行数只增不减
    expect((db.prepare('SELECT * FROM assignments').all() as unknown[]).length).toBe(4);
  });
});

/* ══════════════════════════ ⑥ 与软停用并存 ══════════════════════════ */

describe('⑥ 与软停用并存：PATCH {active:false} 仍是「行还在、引用不动」', () => {
  it('停用不删行、不改写引用（既有行为零变化）', async () => {
    seedMember('m1', '被停用的人');
    seedProject('p1', 'm1');
    seedStage('s1', 'p1', 'm1');
    seedTask('t1', 'p1', 's1', 'm1', ['m1']);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/members/m1',
      headers: { 'content-type': 'application/json' },
      payload: { active: false },
    });
    expect(res.statusCode).toBe(200);

    expect(row('SELECT active FROM members WHERE id = ?', 'm1')!.active).toBe(0);
    expect(row('SELECT assignee_id FROM tasks WHERE id = ?', 't1')!.assignee_id).toBe('m1');
    expect(JSON.parse(String(row('SELECT assignee_ids FROM tasks WHERE id = ?', 't1')!.assignee_ids))).toEqual(['m1']);
    expect(row('SELECT owner_id FROM stages WHERE id = ?', 's1')!.owner_id).toBe('m1');
    expect(row('SELECT owner_member_id FROM projects WHERE id = ?', 'p1')!.owner_member_id).toBe('m1');
  });
});
