/**
 * Meta 路由：流水（logs/assignments）、合同存证、设置 KV、备份/引导端点。
 * append-only 表（stage_logs/assignments）刻意不实现 UPDATE/DELETE 端点。
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

// v0.6：JSON 数组列反序列化统一走通用实现（parseJsonArray<Task>）。
// ★ 旧的本地实现内含 `filter(x => typeof x === 'string')`——对 artifacts（对象数组）
//   会把对象元素全部滤掉、静默清空，必须换成 server/lib/json-columns.ts 的版本。
import { parseJsonArray } from '../lib/json-columns';

interface StageLogRow {
  id: string;
  stage_id: string;
  project_id: string;
  type: string;
  from_status: string | null;
  to_status: string | null;
  old_start_at: string | null;
  new_start_at: string | null;
  old_end_at: string | null;
  new_end_at: string | null;
  reason: string | null;
  operator_name: string;
  created_at: string;
}

interface AssignmentRow {
  id: string;
  task_id: string;
  project_id: string;
  member_id: string | null;
  action: string;
  operator_name: string;
  created_at: string;
}

/** 请求体 DTO（camelCase，与前端 api-contract.md 对齐；行存食用 snake_case） */
interface StageLogInput {
  stageId?: string;
  projectId?: string;
  type?: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  oldStartAt?: string | null;
  newStartAt?: string | null;
  oldEndAt?: string | null;
  newEndAt?: string | null;
  reason?: string | null;
  operatorName?: string;
}

interface AssignmentInput {
  taskId?: string;
  projectId?: string;
  memberId?: string | null;
  action?: string;
  operatorName?: string;
}

interface ContractInput {
  id?: string;
  projectId?: string | null;
  fileName?: string | null;
  rawTextDigest?: string;
  parsedResultJson?: string;
  confirmedPayloadJson?: string | null;
  createdByManual?: boolean;
}

interface ContractRow {
  id: string;
  project_id: string | null;
  file_name: string | null;
  raw_text_digest: string;
  parsed_result_json: string;
  confirmed_payload_json: string | null;
  created_by_manual: number;
  created_at: string;
}

const nowIso = (): string => new Date().toISOString();

function rowToStageLog(r: StageLogRow): Record<string, unknown> {
  return {
    id: r.id,
    stageId: r.stage_id,
    projectId: r.project_id,
    type: r.type,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    oldStartAt: r.old_start_at,
    newStartAt: r.new_start_at,
    oldEndAt: r.old_end_at,
    newEndAt: r.new_end_at,
    reason: r.reason,
    operatorName: r.operator_name,
    createdAt: r.created_at,
  };
}

export function registerMetaRoutes(app: FastifyInstance, db: Database.Database): void {
  /* ------------------------------ 流水 append-only ----------------------------- */

  app.post('/api/logs/stage', async (req) => {
    const b = req.body as StageLogInput;
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO stage_logs
        (id, stage_id, project_id, type, from_status, to_status,
         old_start_at, new_start_at, old_end_at, new_end_at, reason, operator_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      String(b.stageId),
      String(b.projectId),
      String(b.type),
      (b.fromStatus as string | null) ?? null,
      (b.toStatus as string | null) ?? null,
      (b.oldStartAt as string | null) ?? null,
      (b.newStartAt as string | null) ?? null,
      (b.oldEndAt as string | null) ?? null,
      (b.newEndAt as string | null) ?? null,
      (b.reason as string | null) ?? null,
      String(b.operatorName ?? '未知'),
      nowIso(),
    );
    const row = db.prepare('SELECT * FROM stage_logs WHERE id = ?').get(id) as StageLogRow;
    return rowToStageLog(row);
  });

  app.get('/api/stages/:stageId/logs', async (req) => {
    const { stageId } = req.params as { stageId: string };
    const rows = db
      .prepare('SELECT * FROM stage_logs WHERE stage_id = ? ORDER BY created_at ASC')
      .all(stageId) as StageLogRow[];
    return rows.map(rowToStageLog);
  });

  app.get('/api/projects/:projectId/logs', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const rows = db
      .prepare('SELECT * FROM stage_logs WHERE project_id = ? ORDER BY created_at ASC')
      .all(projectId) as StageLogRow[];
    return rows.map(rowToStageLog);
  });

  app.post('/api/logs/assignments', async (req) => {
    const b = req.body as AssignmentInput;
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO assignments
        (id, task_id, project_id, member_id, action, operator_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      String(b.taskId),
      String(b.projectId),
      (b.memberId as string | null) ?? null,
      String(b.action ?? 'assign'),
      String(b.operatorName ?? '未知'),
      nowIso(),
    );
    const row = db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) as AssignmentRow;
    return {
      id: row.id,
      taskId: row.task_id,
      projectId: row.project_id,
      memberId: row.member_id,
      action: row.action,
      operatorName: row.operator_name,
      createdAt: row.created_at,
    };
  });

  app.get('/api/tasks/:taskId/assignments', async (req) => {
    const { taskId } = req.params as { taskId: string };
    const rows = db
      .prepare('SELECT * FROM assignments WHERE task_id = ? ORDER BY created_at')
      .all(taskId) as AssignmentRow[];
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      projectId: r.project_id,
      memberId: r.member_id,
      action: r.action,
      operatorName: r.operator_name,
      createdAt: r.created_at,
    }));
  });

  /* --------------------------------- 合同存证 --------------------------------- */

  app.post('/api/contracts', async (req) => {
    const b = req.body as ContractInput;
    const id = b.id ?? crypto.randomUUID();
    db.prepare(
      `INSERT INTO contracts
        (id, project_id, file_name, raw_text_digest, parsed_result_json,
         confirmed_payload_json, created_by_manual, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      (b.projectId as string | null) ?? null,
      (b.fileName as string | null) ?? null,
      String(b.rawTextDigest ?? ''),
      String(b.parsedResultJson ?? '{}'),
      (b.confirmedPayloadJson as string | null) ?? null,
      b.createdByManual ? 1 : 0,
      nowIso(),
    );
    const row = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id) as ContractRow;
    return contractToDto(row);
  });

  app.get('/api/contracts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id) as ContractRow | undefined;
    if (!row) {
      void reply.status(404);
      return { error: { code: 'not_found', userMessage: '合同记录不存在' } };
    }
    return contractToDto(row);
  });

  app.post('/api/contracts/:id/link-project', async (req) => {
    const { id } = req.params as { id: string };
    const { projectId } = req.body as { projectId: string };
    db.prepare('UPDATE contracts SET project_id=? WHERE id=?').run(projectId, id);
    return { ok: true };
  });

  app.post('/api/contracts/:id/confirmed-payload', async (req) => {
    const { id } = req.params as { id: string };
    const { confirmedJson } = req.body as { confirmedJson: string };
    db.prepare('UPDATE contracts SET confirmed_payload_json=? WHERE id=?').run(confirmedJson, id);
    return { ok: true };
  });

  app.get('/api/contracts', async () => {
    const rows = db.prepare('SELECT * FROM contracts ORDER BY created_at DESC').all() as ContractRow[];
    return rows.map(contractToDto);
  });

  function contractToDto(r: ContractRow): Record<string, unknown> {
    return {
      id: r.id,
      projectId: r.project_id,
      fileName: r.file_name,
      rawTextDigest: r.raw_text_digest,
      parsedResultJson: r.parsed_result_json,
      confirmedPayloadJson: r.confirmed_payload_json,
      createdByManual: Boolean(r.created_by_manual),
      createdAt: r.created_at,
    };
  }

  /* ---------------------------------- 设置 KV ---------------------------------- */

  app.get('/api/settings', async () => {
    const rows = db.prepare('SELECT * FROM settings').all() as Array<{
      key: string;
      value_json: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({ key: r.key, valueJson: r.value_json, updatedAt: r.updated_at }));
  });

  app.get('/api/settings/:key', async (req, reply) => {
    const { key } = req.params as { key: string };
    const row = db.prepare('SELECT * FROM settings WHERE key = ?').get(key) as
      | { key: string; value_json: string; updated_at: string }
      | undefined;
    if (!row) return null;
    return { key: row.key, valueJson: row.value_json, updatedAt: row.updated_at };
  });

  app.put('/api/settings/:key', async (req) => {
    const { key } = req.params as { key: string };
    const { valueJson } = req.body as { valueJson: unknown };
    db.prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
    ).run(key, JSON.stringify(valueJson), nowIso());
    return { ok: true };
  });

  app.post('/api/settings/replace-all', async (req) => {
    const { rows } = req.body as { rows: Array<{ key: string; valueJson: string; updatedAt: string }> };
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM settings').run();
      for (const r of rows) {
        db.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
          r.key,
          r.valueJson,
          r.updatedAt,
        );
      }
    });
    tx();
    return { ok: true };
  });

  /* -------------------------------- 备份 / 引导 -------------------------------- */

  /** 各表布尔列清单：SQLite 存 0/1，DTO 需要 boolean（与本地 Dexie 导出形状一致） */
  const BOOLEAN_COLUMNS: Record<string, string[]> = {
    tasks: ['done'],
    // stages.visible 在 SQLite 存 0/1，导出需还原为 boolean，
    // 否则前端 zod（stageSchema.visible: z.boolean()）会拒绝整份备份。
    stages: ['visible'],
    members: ['active'],
    contracts: ['created_by_manual'],
  };

  /**
   * 以 JSON 数组串存储的列（SQLite 无数组类型）。
   * 导出时必须反序列化回真正的数组——否则前端 zod 期望 array 却收到 string，
   * 备份导入会被整体拒绝（曾导致 NAS 导出的备份无法导回前端）。
   * v0.6：depends_on / artifacts 是对象/字符串数组列，走通用 parseJsonArray（无 filter）。
   */
  const JSON_ARRAY_COLUMNS: Record<string, string[]> = {
    tasks: ['assignee_ids', 'depends_on', 'artifacts'],
  };

  /** snake_case 行 → camelCase DTO（key 下划线转驼峰；布尔列 0/1 转 boolean；JSON 数组列反序列化） */
  function rowToDto(table: string, o: Record<string, unknown>): Record<string, unknown> {
    const boolCols = BOOLEAN_COLUMNS[table] ?? [];
    const jsonArrCols = JSON_ARRAY_COLUMNS[table] ?? [];
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      const camelKey = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      if (boolCols.includes(k)) {
        out[camelKey] = Boolean(v);
      } else if (jsonArrCols.includes(k)) {
        // 通用版（无 filter(string)）：保证 artifacts 对象数组往返保真
        out[camelKey] = parseJsonArray<unknown>(v);
      } else {
        out[camelKey] = v;
      }
    }
    return out;
  }

  const dumpTable = (tableName: string): Array<Record<string, unknown>> =>
    (db.prepare(`SELECT * FROM ${tableName}`).all() as Array<Record<string, unknown>>).map((r) =>
      rowToDto(tableName, r),
    );

  // GET /backup —— 全量导出（与前端 BackupPackage 形状一致，可直接过 zod 校验）
  app.get('/api/backup', async () => {
    return {
      // v2 = 含 stagePresetKey / templateKey / colorIndex / scheduleBasis / assigneeIds / roleKind，
      // 与前端 BACKUP_SCHEMA_VERSION 对齐；标 1 会让前端走老版本归一路径（v2 字段被视作缺失）。
      meta: { app: 'changxia', schemaVersion: 2, exportedAt: nowIso() },
      data: {
        projects: dumpTable('projects'),
        stages: dumpTable('stages'),
        tasks: dumpTable('tasks'),
        members: dumpTable('members'),
        assignments: dumpTable('assignments'),
        logs: dumpTable('stage_logs'),
        contracts: dumpTable('contracts'),
        settings: dumpTable('settings'),
      },
    };
  });

  // POST /bootstrap —— 启动全量装载
  app.post('/api/bootstrap', async () => {
    return {
      projects: dumpTable('projects'),
      stages: dumpTable('stages'),
      tasks: dumpTable('tasks'),
      members: dumpTable('members'),
      assignments: dumpTable('assignments'),
      logs: dumpTable('stage_logs'),
      contracts: dumpTable('contracts'),
      settings: dumpTable('settings'),
    };
  });

  // POST /backup/import —— 服务端整库替换（事务）
  app.post('/api/backup/import', async (req) => {
    const pkg = req.body as {
      data: Record<string, Array<Record<string, unknown>>>;
    };
    const snake = (o: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        // 数组字段必须显式 JSON 序列化：SQLite 无数组类型，
        // 直接 bind 数组会被隐式 join 成字符串（如 ['a'] → "a"），
        // 读取端 JSON.parse 失败 → 静默丢数据（曾导致 task.assigneeIds 导入后变 []）。
        // 这里统一处理，覆盖 assigneeIds 及未来任何数组字段。
        const val = Array.isArray(v)
          ? JSON.stringify(v)
          : typeof v === 'boolean'
            ? v
              ? 1
              : 0
            : v;
        out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = val;
      }
      return out;
    };

    const insertRow = (table: string, o: Record<string, unknown>): void => {
      const cols = Object.keys(o);
      db.prepare(
        `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      ).run(...cols.map((c) => o[c]));
    };

    const map: Record<string, string> = {
      projects: 'projects',
      stages: 'stages',
      tasks: 'tasks',
      members: 'members',
      assignments: 'assignments',
      logs: 'stage_logs',
      contracts: 'contracts',
      settings: 'settings',
    };

    const tx = db.transaction(() => {
      for (const t of Object.values(map)) db.prepare(`DELETE FROM ${t}`).run();
      for (const [key, tableName] of Object.entries(map)) {
        const rows = pkg.data?.[key] ?? [];
        for (const r of rows) insertRow(tableName, snake(r));
      }
    });
    tx();
    return { ok: true };
  });
}
