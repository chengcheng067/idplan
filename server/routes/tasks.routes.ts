/**
 * Tasks 路由：组合过滤 CRUD + bulk（对齐 api-contract.md）。
 * v0.6：Task 增 9 字段；新增幂等批量 upsert（externalId 幂等键）与原子 claim。
 *
 * ★ 序列化纪律（设计文档 §9.2 硬禁令）：
 *   - assignee_ids（string[]）→ serializeAssigneeIds（保留 filter 语义）；
 *   - depends_on（string[]）  → serializeJson；
 *   - artifacts（**对象数组**）→ serializeJson / parseJsonArray —— 绝不可经过任何
 *     `filter(x => typeof x === 'string')` 的函数（会把对象元素静默清空成 '[]'）。
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

import type { TaskArtifact } from '../../src/core/types/entities';
import {
  parseJsonArray,
  serializeAssigneeIds,
  serializeJson,
} from '../lib/json-columns';

interface TaskRow {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  done: number;
  assignee_id: string | null;
  /** v0.3 参与人全集，JSON 数组串（SQLite 无数组类型） */
  assignee_ids: string;
  due_date: string | null;
  /** v0.6 Agent 字段（external_id / agent_id / description / start_at / claimed_at 可空） */
  source: string;
  external_id: string | null;
  agent_id: string | null;
  status: string;
  description: string | null;
  depends_on: string;
  artifacts: string;
  start_at: string | null;
  claimed_at: string | null;
  order_index: number;
  revision: number;
  updated_at: string;
}

const nowIso = (): string => new Date().toISOString();

/** status 缺省时的保守推导：done=1 → 'done'，否则 'draft'（与前端 normalizeTaskRow 同口径） */
function deriveStatus(raw: { status?: unknown; done?: unknown }): string {
  if (typeof raw.status === 'string' && raw.status.length > 0) return raw.status;
  return raw.done === true || raw.done === 1 ? 'done' : 'draft';
}

function rowToTask(r: TaskRow): Record<string, unknown> {
  return {
    id: r.id,
    projectId: r.project_id,
    stageId: r.stage_id,
    title: r.title,
    done: Boolean(r.done),
    assigneeId: r.assignee_id,
    assigneeIds: parseJsonArray<string>(r.assignee_ids),
    dueDate: r.due_date,
    source: r.source,
    externalId: r.external_id,
    agentId: r.agent_id,
    status: r.status,
    description: r.description,
    dependsOn: parseJsonArray<string>(r.depends_on),
    // ★ 对象数组走通用 parseJsonArray（绝不走含 filter(string) 的旧函数）
    artifacts: parseJsonArray<TaskArtifact>(r.artifacts),
    startAt: r.start_at,
    claimedAt: r.claimed_at,
    orderIndex: r.order_index,
    revision: r.revision,
    updatedAt: r.updated_at,
  };
}

const TASK_INSERT_COLUMNS = `(
  id, project_id, stage_id, title, done, assignee_id, assignee_ids, due_date,
  source, external_id, agent_id, status, description, depends_on, artifacts,
  start_at, claimed_at, order_index, revision, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

interface TaskInsertValues {
  id: string;
  projectId: string;
  stageId: string;
  title: string;
  assigneeId: string | null;
  assigneeIds: unknown;
  dueDate: string | null;
  source: string;
  externalId: string | null;
  agentId: string | null;
  status: string;
  description: string | null;
  dependsOn: unknown;
  artifacts: unknown;
  startAt: string | null;
  claimedAt: string | null;
  orderIndex: number;
  revision: number;
  updatedAt: string;
}

/** 单条 INSERT 的 20 列值（done 恒由 status 派生，绝不取请求体的 done） */
function insertValues(v: TaskInsertValues): unknown[] {
  return [
    v.id,
    v.projectId,
    v.stageId,
    v.title,
    v.status === 'done' ? 1 : 0,
    v.assigneeId,
    serializeAssigneeIds(v.assigneeIds),
    v.dueDate,
    v.source,
    v.externalId,
    v.agentId,
    v.status,
    v.description,
    serializeJson(v.dependsOn),
    serializeJson(v.artifacts),
    v.startAt,
    v.claimedAt,
    v.orderIndex,
    v.revision,
    v.updatedAt,
  ];
}

export function registerTaskRoutes(app: FastifyInstance, db: Database.Database): void {
  // GET /tasks?projectId=&stageId=&assigneeId=&done=&source=&agentId=&status=&externalId=
  // （status 支持逗号分隔多值，与 remote 适配器 qs() 约定一致）
  app.get('/api/tasks', async (req) => {
    const q = req.query as {
      projectId?: string;
      stageId?: string;
      assigneeId?: string;
      done?: string;
      source?: string;
      agentId?: string;
      status?: string;
      externalId?: string;
    };
    let rows = db.prepare('SELECT * FROM tasks').all() as TaskRow[];
    if (q.projectId) rows = rows.filter((r) => r.project_id === q.projectId);
    if (q.stageId) rows = rows.filter((r) => r.stage_id === q.stageId);
    if (q.assigneeId) rows = rows.filter((r) => r.assignee_id === q.assigneeId);
    if (q.done === 'true' || q.done === 'false') {
      const wantDone = q.done === 'true';
      rows = rows.filter((r) => Boolean(r.done) === wantDone);
    }
    if (q.source) rows = rows.filter((r) => r.source === q.source);
    if (q.agentId) rows = rows.filter((r) => r.agent_id === q.agentId);
    if (q.externalId) rows = rows.filter((r) => r.external_id === q.externalId);
    if (q.status) {
      const wanted = q.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (wanted.length > 0) rows = rows.filter((r) => wanted.includes(r.status));
    }
    return rows.map(rowToTask);
  });

  // GET /tasks/:id —— v0.6 新增：task.service 流转校验需要权威的当前 status；
  // 404 走统一错误体（remote 适配器翻译为 ChangxiaError(NotFound) → null）。
  app.get('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!row) {
      void reply.status(404).send({ error: { userMessage: '未找到该任务。' } });
      return;
    }
    return rowToTask(row);
  });

  // POST /tasks/bulk —— 备份导入通道：接受 done（v1/v2 备份无 status），双写归一
  app.post('/api/tasks/bulk', async (req) => {
    const { rows } = req.body as { rows: Array<Record<string, unknown>> };
    const insert = db.prepare(`INSERT INTO tasks ${TASK_INSERT_COLUMNS}`);
    const tx = db.transaction((list: Array<Record<string, unknown>>) => {
      for (const t of list) {
        const ids = serializeAssigneeIds(t.assigneeIds);
        const idsArr = parseJsonArray<string>(ids);
        const status = deriveStatus(t);
        insert.run(
          ...insertValues({
            id: String(t.id),
            projectId: String(t.projectId),
            stageId: String(t.stageId),
            title: String(t.title),
            assigneeId: (t.assigneeId as string | null) ?? idsArr[0] ?? null,
            assigneeIds: t.assigneeIds,
            dueDate: (t.dueDate as string | null) ?? null,
            source: String(t.source ?? 'human'),
            externalId: (t.externalId as string | null) ?? null,
            agentId: (t.agentId as string | null) ?? null,
            status,
            description: (t.description as string | null) ?? null,
            dependsOn: t.dependsOn ?? [],
            artifacts: t.artifacts ?? [],
            startAt: (t.startAt as string | null) ?? null,
            claimedAt: (t.claimedAt as string | null) ?? null,
            orderIndex: Number(t.orderIndex ?? 1),
            revision: Number(t.revision ?? 1),
            updatedAt: String(t.updatedAt ?? nowIso()),
          }),
        );
      }
    });
    tx(rows ?? []);
    return { ok: true, count: rows?.length ?? 0 };
  });

  // POST /tasks
  app.post('/api/tasks', async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    const title = String(b.title ?? '').trim();
    if (!title) {
      void reply.status(400);
      return { error: { code: 'validation', userMessage: '任务标题不能为空' } };
    }
    const id = crypto.randomUUID();
    const maxRow = db
      .prepare('SELECT MAX(order_index) AS m FROM tasks WHERE stage_id = ?')
      .get(String(b.stageId)) as { m: number | null };
    const status = deriveStatus(b);
    db.prepare(`INSERT INTO tasks ${TASK_INSERT_COLUMNS}`).run(
      ...insertValues({
        id,
        projectId: String(b.projectId),
        stageId: String(b.stageId),
        title,
        assigneeId: (b.assigneeId as string | null) ?? parseJsonArray<string>(serializeAssigneeIds(b.assigneeIds))[0] ?? null,
        assigneeIds: b.assigneeIds,
        dueDate: (b.dueDate as string | null) ?? null,
        source: String(b.source ?? 'human'),
        externalId: (b.externalId as string | null) ?? null,
        agentId: (b.agentId as string | null) ?? null,
        status,
        description: (b.description as string | null) ?? null,
        dependsOn: b.dependsOn ?? [],
        artifacts: b.artifacts ?? [],
        startAt: (b.startAt as string | null) ?? null,
        claimedAt: (b.claimedAt as string | null) ?? null,
        orderIndex: (maxRow.m ?? 0) + 1,
        revision: 1,
        updatedAt: nowIso(),
      }),
    );
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
    return rowToTask(row);
  });

  // POST /tasks/upsert —— v0.6 新增：幂等批量写入（externalId 幂等键）
  // 先查后写（非 ON CONFLICT）：① 需精确区分 created/updated 计数；② 整个循环已在
  // db.transaction 内，先查后写无竞态。done 恒由 status 派生，绝不接受请求体的 done。
  app.post('/api/tasks/upsert', async (req) => {
    const { rows } = req.body as { rows: Array<Record<string, unknown>> };
    let created = 0;
    let updated = 0;
    const tx = db.transaction((list: Array<Record<string, unknown>>) => {
      for (const t of list) {
        const externalId = (t.externalId as string | null) ?? null;
        const existing = externalId
          ? (db.prepare('SELECT * FROM tasks WHERE external_id = ?').get(externalId) as TaskRow | undefined)
          : undefined;
        if (existing) {
          // 命中 → UPDATE，bump revision（即使字段未变，保留「被 Agent 触碰过几次」的溯源）
          const nextStatus = String(t.status ?? existing.status);
          db.prepare(
            `UPDATE tasks SET title=?, status=?, done=?, description=?, depends_on=?,
               artifacts=?, start_at=?, due_date=?, assignee_id=?, assignee_ids=?,
               agent_id=?, source=?, claimed_at=?, order_index=?, revision=?, updated_at=?
             WHERE id=?`,
          ).run(
            String(t.title ?? existing.title),
            nextStatus,
            nextStatus === 'done' ? 1 : 0, // ★ done 由 status 派生
            (t.description as string | null) ?? existing.description,
            serializeJson(t.dependsOn ?? parseJsonArray<string>(existing.depends_on)),
            serializeJson(t.artifacts ?? parseJsonArray<TaskArtifact>(existing.artifacts)),
            (t.startAt as string | null) ?? existing.start_at,
            (t.dueDate as string | null) ?? existing.due_date,
            (t.assigneeId as string | null) ?? existing.assignee_id,
            serializeAssigneeIds(t.assigneeIds ?? parseJsonArray<string>(existing.assignee_ids)),
            (t.agentId as string | null) ?? existing.agent_id,
            String(t.source ?? existing.source),
            (t.claimedAt as string | null) ?? existing.claimed_at,
            // order_index 仅新建语义：更新路径保持既有排序，防止重导入反复重排
            existing.order_index,
            existing.revision + 1,
            nowIso(),
            existing.id,
          );
          updated += 1;
        } else {
          const status = deriveStatus(t);
          db.prepare(`INSERT INTO tasks ${TASK_INSERT_COLUMNS}`).run(
            ...insertValues({
              id: String(t.id ?? crypto.randomUUID()),
              projectId: String(t.projectId),
              stageId: String(t.stageId),
              title: String(t.title ?? ''),
              assigneeId: (t.assigneeId as string | null) ?? null,
              assigneeIds: t.assigneeIds ?? [],
              dueDate: (t.dueDate as string | null) ?? null,
              source: String(t.source ?? 'agent'),
              externalId,
              agentId: (t.agentId as string | null) ?? null,
              status,
              description: (t.description as string | null) ?? null,
              dependsOn: t.dependsOn ?? [],
              artifacts: t.artifacts ?? [],
              startAt: (t.startAt as string | null) ?? null,
              claimedAt: (t.claimedAt as string | null) ?? null,
              orderIndex: Number(t.orderIndex ?? 1),
              revision: 1,
              updatedAt: nowIso(),
            }),
          );
          created += 1;
        }
      }
    });
    tx(rows ?? []);
    return { created, updated };
  });

  // POST /tasks/:id/claim —— v0.6 新增：原子认领（仅 status='ready' 可认领；
  // 单语句 UPDATE 自带原子性，无需显式事务；changes===0 → 409 conflict）
  app.post('/api/tasks/:id/claim', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { actorMemberId } = req.body as { actorMemberId?: string };
    const result = db
      .prepare(
        `UPDATE tasks SET status='claimed', done=0, assignee_id=?, claimed_at=?,
           revision=revision+1, updated_at=?
         WHERE id=? AND status='ready'`,
      )
      .run(actorMemberId ?? null, nowIso(), nowIso(), id);
    if (result.changes === 0) {
      void reply.status(409);
      return {
        error: {
          code: 'conflict',
          userMessage: '该任务已被认领或不处于就绪状态。',
        },
      };
    }
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
    return rowToTask(row);
  });

  // PATCH /tasks/:id
  app.patch('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!existing) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '任务不存在' } };
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    // 参与人全集变更时，主负责人同步为 assigneeIds[0]（与前端 UI 保存语义一致）
    const nextIds = b.assigneeIds !== undefined ? serializeAssigneeIds(b.assigneeIds) : existing.assignee_ids;
    const nextAssigneeId =
      b.assigneeId !== undefined
        ? (b.assigneeId as string | null)
        : b.assigneeIds !== undefined
          ? parseJsonArray<string>(nextIds)[0] ?? null
          : existing.assignee_id;
    // 状态双写：status 优先；只传 done（存量路径）→ 反推 status。两字段永不漂移。
    const nextStatus =
      b.status !== undefined
        ? String(b.status)
        : b.done !== undefined
          ? (b.done ? 'done' : 'draft')
          : existing.status;
    const merged: TaskRow = {
      ...existing,
      title: b.title !== undefined ? String(b.title) : existing.title,
      status: nextStatus,
      done: nextStatus === 'done' ? 1 : 0,
      assignee_id: nextAssigneeId,
      assignee_ids: nextIds,
      due_date: b.dueDate !== undefined ? (b.dueDate as string | null) : existing.due_date,
      source: b.source !== undefined ? String(b.source) : existing.source,
      external_id: b.externalId !== undefined ? (b.externalId as string | null) : existing.external_id,
      agent_id: b.agentId !== undefined ? (b.agentId as string | null) : existing.agent_id,
      description: b.description !== undefined ? (b.description as string | null) : existing.description,
      depends_on: b.dependsOn !== undefined ? serializeJson(b.dependsOn) : existing.depends_on,
      artifacts: b.artifacts !== undefined ? serializeJson(b.artifacts) : existing.artifacts,
      start_at: b.startAt !== undefined ? (b.startAt as string | null) : existing.start_at,
      claimed_at: b.claimedAt !== undefined ? (b.claimedAt as string | null) : existing.claimed_at,
      order_index: b.orderIndex !== undefined ? Number(b.orderIndex) : existing.order_index,
      revision: existing.revision + 1,
      updated_at: nowIso(),
    };
    db.prepare(
      `UPDATE tasks SET title=?, status=?, done=?, assignee_id=?, assignee_ids=?, due_date=?,
         source=?, external_id=?, agent_id=?, description=?, depends_on=?, artifacts=?,
         start_at=?, claimed_at=?, order_index=?, revision=?, updated_at=? WHERE id=?`,
    ).run(
      merged.title,
      merged.status,
      merged.done,
      merged.assignee_id,
      merged.assignee_ids,
      merged.due_date,
      merged.source,
      merged.external_id,
      merged.agent_id,
      merged.description,
      merged.depends_on,
      merged.artifacts,
      merged.start_at,
      merged.claimed_at,
      merged.order_index,
      merged.revision,
      merged.updated_at,
      id,
    );
    return rowToTask(merged);
  });

  // DELETE /tasks/:id
  app.delete('/api/tasks/:id', async (req) => {
    const { id } = req.params as { id: string };
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return { ok: true };
  });
}
