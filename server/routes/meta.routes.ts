/**
 * Meta 路由：流水（logs/assignments）、合同存证、设置 KV、备份/引导端点。
 * append-only 表（stage_logs/assignments）刻意不实现 UPDATE/DELETE 端点。
 */

import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

// v0.6：JSON 数组列反序列化统一走通用实现（parseJsonArray<Task>）。
// ★ 旧的本地实现内含 `filter(x => typeof x === 'string')`——对 artifacts（对象数组）
//   会把对象元素全部滤掉、静默清空，必须换成 server/lib/json-columns.ts 的版本。
import { parseJson, parseJsonArray } from '../lib/json-columns';
import { requireToken, requireWriteToken, writeAuthMode, unauthorizedBody, WRITE_AUTH_OPEN_HEADER, WRITE_AUTH_OPEN_VALUE } from '../lib/agent-auth';

// ★ v0.7（T01-b）：备份导入的号段归一走**前后端共享的同一份纯函数** —— 与 local
//   适配器的 `local.admin.repo.replaceAllImport` **逐字同义**（硬约束见 interfaces.ts）。
//   判定逻辑只此一处：本地与远端必须给出同一个「导入后计数器值」与同一个 `renumbered`
//   含义，各写一份必漂移（典型症状：本地说没撞号、远端说没撞号，但两边号段不同步）。
//   该库零 IO、无 browser/node API，可安全被 server typecheck 引用（见其文件头「纪律」）。
import {
  TASK_NO_SEQ_KEY,
  maxTaskNoOf,
  parseTaskNoSeq,
  resolveTaskNoCollisions,
} from '../../src/core/lib/task-no';
import type { Task } from '../../src/core/types/entities';

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
  /*
   * ★ v0.8.6 P0-1（安全官红牌 · 她 10-01 拍板「一定要记得修」）：业务写端点条件门。
   * 原状：settings / logs / contracts 全族**零鉴权**——LAN 任意方可覆写
   * taskNoSeq 制造重号、伪造审计流水；自定义行业一旦落 settings KV 即
   * 远程投递面（9c 上线的硬前置）。
   * 门：env 配了 token → 必须 Bearer（常量时间比较，与备份通道同口径）；
   * 未配 → 放行但响应带 x-idplan-write-auth: open 告警头。
   * 为什么不是 fail-closed 硬拒：这些是高频前端调用（阶段流转每次都写
   * log），硬拒=重演 0.8.2「点一次 401 一次」且天天发生。详见 agent-auth.ts。
   */
  const guardWrite = (
    req: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
  ): boolean => {
    if (writeAuthMode() === 'open') {
      reply.header(WRITE_AUTH_OPEN_HEADER, WRITE_AUTH_OPEN_VALUE);
      return true;
    }
    if (!requireWriteToken(req)) {
      void reply.status(401).type('application/json').send(unauthorizedBody());
      return false;
    }
    return true;
  };
  /* ------------------------------ 流水 append-only ----------------------------- */

  app.post('/api/logs/stage', async (req, reply) => {
    if (!guardWrite(req, reply)) return;
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

  app.post('/api/logs/assignments', async (req, reply) => {
    if (!guardWrite(req, reply)) return;
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

  app.post('/api/contracts', async (req, reply) => {
    if (!guardWrite(req, reply)) return;
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

  app.post('/api/contracts/:id/link-project', async (req, reply) => {
    if (!guardWrite(req, reply)) return;
    const { id } = req.params as { id: string };
    const { projectId } = req.body as { projectId: string };
    db.prepare('UPDATE contracts SET project_id=? WHERE id=?').run(projectId, id);
    return { ok: true };
  });

  app.post('/api/contracts/:id/confirmed-payload', async (req, reply) => {
    if (!guardWrite(req, reply)) return;
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

  app.put('/api/settings/:key', async (req, reply) => {
    if (!guardWrite(req, reply)) return;
    const { key } = req.params as { key: string };
    const { valueJson } = req.body as { valueJson: unknown };
    db.prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
    ).run(key, JSON.stringify(valueJson), nowIso());
    return { ok: true };
  });

  app.post('/api/settings/replace-all', async (req, reply) => {
    if (!guardWrite(req, reply)) return;
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
    // ★ v0.8 执行域：writeback_proposals.operations 是 JSON 化的 WritebackOperation[]
    //   （DDL 注释明写）。不登记 → 导出成 JSON **字符串** → 前端 zod
    //   `writebackProposalSchema.operations: z.array(z.any())` 期望数组却收到 string
    //   → **整份备份包被拒收**（tasks 表已有同类先例，注释见 JSON_ARRAY_COLUMNS 头）。
    writeback_proposals: ['operations'],
  };

  /**
   * ★ v0.8 执行域：以 JSON **对象**串存储的列——与上面的数组列**必须分开**，不可混用。
   *
   * `executions.confirmation` 是 JSON 化的 `ExecutionConfirmation`（DDL 注释明写），
   * 单个对象而非数组。若误登记进 `JSON_ARRAY_COLUMNS`，`parseJsonArray` 会走
   * `Array.isArray(v) ? v : []` 回落成 `[]` —— 把「人工确认凭据」整条**静默清空**，
   * 而它正是「未人工确认绝不执行」这条 P0 闸门（`assertExecutionConfirmed` 要求
   * `confirmedAt` 与 `planHash` 双非空）的**唯一数据来源**：确认过的执行会退化成
   * 未确认，恢复出来的记录要么再也执行不了、要么闸门形同虚设。
   *
   * 这里用 `parseJson(v, null)`：列可空，'null' 串/空串/脏数据一律回落 null，
   * 与 DTO 的 `confirmation: ExecutionConfirmation | null` 形状一致。
   */
  const JSON_OBJECT_COLUMNS: Record<string, string[]> = {
    executions: ['confirmation'],
  };

  /**
   * snake_case 行 → camelCase DTO（key 下划线转驼峰；布尔列 0/1 转 boolean；
   * JSON 数组列反序列化回数组；JSON 对象列反序列化回对象/null）
   */
  function rowToDto(table: string, o: Record<string, unknown>): Record<string, unknown> {
    const boolCols = BOOLEAN_COLUMNS[table] ?? [];
    const jsonArrCols = JSON_ARRAY_COLUMNS[table] ?? [];
    const jsonObjCols = JSON_OBJECT_COLUMNS[table] ?? [];
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      const camelKey = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      if (boolCols.includes(k)) {
        out[camelKey] = Boolean(v);
      } else if (jsonArrCols.includes(k)) {
        // 通用版（无 filter(string)）：保证 artifacts 对象数组往返保真
        out[camelKey] = parseJsonArray<unknown>(v);
      } else if (jsonObjCols.includes(k)) {
        // 对象列专用回落 null（**不可**走 parseJsonArray，见 JSON_OBJECT_COLUMNS 注释）
        out[camelKey] = parseJson<unknown>(v, null);
      } else {
        out[camelKey] = v;
      }
    }
    return out;
  }

  /**
   * 表导出（v0.6 · T14 要点 4）：`includeSecrets !== true` 时 members 表
   * **保留 passwordHash 键、值置 null** 并补 `hasPassword`——形状稳定
   * （前端 zod 期望 nullable），哈希本体绝不出无鉴权通道。
   */
  const dumpTable = (
    tableName: string,
    opts: { includeSecrets?: boolean } = {},
  ): Array<Record<string, unknown>> =>
    (db.prepare(`SELECT * FROM ${tableName}`).all() as Array<Record<string, unknown>>).map((r) => {
      const dto = rowToDto(tableName, r);
      if (tableName === 'members') {
        // 两种模式都补 hasPassword（形状恒定）；区别只在哈希本体是否下发
        return {
          ...dto,
          passwordHash: opts.includeSecrets === true ? (r.password_hash ?? null) : null,
          hasPassword: Boolean(r.password_hash),
        };
      }
      return dto;
    });

  // GET /backup —— 全量导出（T14 要点 3/5：鉴权 + 默认脱敏；?includeSecrets=1 且持
  // token 才下发真实哈希，用于 NAS→NAS 整机迁移）。
  // ⚠️ 本端点是「NAS 迁移通道」，未来的 Agent HTTP API 是独立端点 + 独立 token，
  //    绝不复用本端点（见 server/lib/agent-auth.ts 头注释与 docs/api-contract.md）。
  app.get('/api/backup', async (req, reply) => {
    if (!requireToken(req)) {
      void reply.status(401);
      return unauthorizedBody();
    }
    const includeSecrets = (req.query as { includeSecrets?: string }).includeSecrets === '1';
    return {
      // v3 = 含 Agent 任务 9 字段 / Member actorKind 2 字段（v0.6 · T14 顺带 🟡-3 修正：
      // 此前标 2 与前端 BACKUP_SCHEMA_VERSION=3 脱节）。导入侧同时接受 1/2/3，导出恒为 3。
      meta: { app: 'changxia', schemaVersion: 3, exportedAt: nowIso() },
      data: {
        projects: dumpTable('projects'),
        stages: dumpTable('stages'),
        tasks: dumpTable('tasks'),
        itineraries: dumpTable('itineraries'),
        members: dumpTable('members', { includeSecrets }),
        assignments: dumpTable('assignments'),
        logs: dumpTable('stage_logs'),
        contracts: dumpTable('contracts'),
        settings: dumpTable('settings'),
        // ★ v0.8 执行域四表：**顺序须与导入侧 `map` 的父先子后一致**（此处虽无顺序
        //   约束，但两端同序便于人工比对）。此前四表只建在 schema.sql 里、不在 dump
        //   清单中 → 服务端备份 / bootstrap / NAS 迁移时执行域数据**整片丢失**。
        executions: dumpTable('executions'),
        executionAttempts: dumpTable('execution_attempts'),
        executionEvents: dumpTable('execution_events'),
        writebackProposals: dumpTable('writeback_proposals'),
      },
    };
  });

  // POST /bootstrap —— 启动全量装载（T14 要点 7：**不加 token**——前端启动依赖它，
  // 加了会破坏既有 remote 前端；但 members 一并脱敏（Q-D 拍板：backup 修完后的
  // 漏网之鱼）。密码验证走 POST /api/members/verify，哈希不出库。
  // TODO(V1, §10-R7)：bootstrap 也应纳入鉴权（如 mTLS / 局域网白名单）。
  app.post('/api/bootstrap', async () => {
    return {
      projects: dumpTable('projects'),
      stages: dumpTable('stages'),
      tasks: dumpTable('tasks'),
      itineraries: dumpTable('itineraries'),
      members: dumpTable('members'),
      assignments: dumpTable('assignments'),
      logs: dumpTable('stage_logs'),
      contracts: dumpTable('contracts'),
      settings: dumpTable('settings'),
      // ★ v0.8 执行域四表（与 GET /api/backup 逐字同构，避免两侧清单漂移）
      executions: dumpTable('executions'),
      executionAttempts: dumpTable('execution_attempts'),
      executionEvents: dumpTable('execution_events'),
      writebackProposals: dumpTable('writeback_proposals'),
    };
  });

  // POST /backup/import —— 服务端整库替换（事务；T14 要点 6：鉴权）
  app.post('/api/backup/import', async (req, reply) => {
    if (!requireToken(req)) {
      void reply.status(401);
      return unauthorizedBody();
    }
    const pkg = req.body as {
      data: Record<string, Array<Record<string, unknown>>>;
    };
    // T14：脱敏备份回导支持——hasPassword 是导出侧派生字段（非表列），
    // 服务端导出 → 再导入的闭环必须剔除，否则 INSERT has_password 报 no such column。
    for (const m of pkg.data?.members ?? []) {
      delete m.hasPassword;
    }
    const snake = (o: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        // 数组字段必须显式 JSON 序列化：SQLite 无数组类型，
        // 直接 bind 数组会被隐式 join 成字符串（如 ['a'] → "a"），
        // 读取端 JSON.parse 失败 → 静默丢数据（曾导致 task.assigneeIds 导入后变 []）。
        // 这里统一处理，覆盖 assigneeIds 及未来任何数组字段。
        //
        // ★ v0.8 执行域：**普通对象**同理必须序列化。`executions.confirmation` 是
        //   `ExecutionConfirmation | null`，若直接 bind，better-sqlite3 会因 bind 值
        //   不是受支持类型而**抛错**（不会静默）；但即使侥幸落库也会变成
        //   "[object Object]" → 读回时 parseJson 失败回落 null → 确认凭据丢失。
        //   注意这里**不能**顺手把 Date/其他对象一概序列化：本函数逐列处理，
        //   对象只可能来自 JSON 列（备份 DTO 里没有别的对象取值），故安全。
        const val = Array.isArray(v)
          ? JSON.stringify(v)
          : typeof v === 'boolean'
            ? v
              ? 1
              : 0
            : v !== null && typeof v === 'object'
              ? JSON.stringify(v)
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

    // ★ 声明序 = **INSERT 正序**（父表在前）；DELETE 用它的**逆序**（子表在前）。
    //   顺序由 `server/schema.sql` 的 **REFERENCES 声明**决定，不是拍脑袋排的：
    //     · execution_attempts.execution_id → REFERENCES executions(id)
    //     · execution_events.execution_id   → REFERENCES executions(id)
    //     · writeback_proposals.execution_id→ REFERENCES executions(id)
    //   三张子表的唯一父表是 `executions`；子表之间**互不引用**
    //   （`writeback_proposals.attempt_id` 在 DDL 里**没有** REFERENCES，故不需要
    //   排在 execution_attempts 之后；同理 project_id / task_id 也无 REFERENCES）。
    //   → 父在前、三个子表紧随其后任意次序即可。
    //
    //   ⚠️ 顺序错了**会被发现**而不是静默出错：`server/db.ts` 的 `openDb()` 有
    //   `db.pragma('foreign_keys = ON')`（生产与本机测试一致），且三处 REFERENCES
    //   **均无 ON DELETE CASCADE**、约束亦非 deferrable —— 非空库下先删 `executions`
    //   会立刻抛 `SQLITE_CONSTRAINT_FOREIGNKEY`；反过来先插子表也会立刻抛。
    //   这是刻意要的：宁可整库替换失败，也不要留下半删半插的残缺库。
    const map: Record<string, string> = {
      projects: 'projects',
      stages: 'stages',
      tasks: 'tasks',
      itineraries: 'itineraries',
      members: 'members',
      assignments: 'assignments',
      logs: 'stage_logs',
      contracts: 'contracts',
      settings: 'settings',
      // ★ v0.8 执行域四表：`executions` 是父表，必须排在三张子表**之前**。
      //   四表放在 `settings` 之后只是因为执行域不与前述九表互引，位置本身不敏感。
      executions: 'executions',
      executionAttempts: 'execution_attempts',
      executionEvents: 'execution_events',
      writebackProposals: 'writeback_proposals',
    };

    // ★ v0.7（T01-b）：包内任务行交给共享纯函数做号段归一。
    //
    // 这里做一次**受控 cast**（**不是** `any`）：包内行此处是备份 DTO 形状（camelCase
    // 的 `Record<string, unknown>`），而共享纯函数签名收 `readonly Task[]`。
    // 它之所以安全，是因为 `resolveTaskNoCollisions` 只**读** `row.taskNo`，
    // 并用 `{ ...row, taskNo }` 原样重建行、其余字段一律透传；随后 `snake()` 再把
    // 这些行逐列转成 SQLite 的 snake_case。改成 `any` 会把「归一只依赖 taskNo 这一个
    // 字段」这个前提掩盖掉，将来有人在纯函数里多读一个字段也不会报错 —— 故显式窄化。
    const pkgTasks = (pkg.data?.tasks ?? []) as unknown as readonly Task[];

    // ★ v0.7（T01-b）：本次导入被重编号的条数（`renumbered` 的真实值）。
    //   用闭包变量带出事务，与 local 侧 `local.admin.repo` 的写法对齐，便于人工比对。
    let renumbered = 0;

    const tx = db.transaction(() => {
      // ① **本地**计数器：必须在 `DELETE FROM settings` **之前**读 —— 顺序错了就永远
      //    拿不到本地值（DELETE 之后它已经没了，随后 INSERT 进来的是**包内**的值）。
      //    这是「本机已发到 1043、导入一个老包后被拉回 1000、之后新建全部重号」
      //    这条真实可达路径的唯一防线。
      const localRow = db
        .prepare('SELECT value_json AS v FROM settings WHERE key = ?')
        .get(TASK_NO_SEQ_KEY) as { v: string } | undefined;
      const localSeq = parseTaskNoSeq(localRow?.v);

      // ② 号段归一（§2.9.1 的三者取最大）：保留先到者、后到者重编号，
      //    并算出「导入后应落的计数器值」= max(包内 max+1, 包内 seq, 本地 seq)。
      //    `existingNos` **刻意不传**：本端点是整库替换（先 DELETE 再 INSERT），
      //    导入瞬间库内无既有行，「与库内撞号」不可达，只剩**包内**查重。
      const pkgSeqRow = (pkg.data?.settings ?? []).find((s) => s.key === TASK_NO_SEQ_KEY);
      const pkgSeqRaw = pkgSeqRow?.valueJson;
      const pkgSeq = typeof pkgSeqRaw === 'string' ? parseTaskNoSeq(pkgSeqRaw) : null;
      const resolved = resolveTaskNoCollisions(pkgTasks, {
        seqFromSettings: pkgSeq,
        maxTaskNoInDb: maxTaskNoOf(pkgTasks),
        localSeq,
      });
      renumbered = resolved.renumbered;

      // ③ 计数器回写两准则（与 local.admin.repo 逐字同义，都是为了不破坏
      //    §2.15-① 的「导出→导入→再导出 逐表全等」）：
      //      · 包里**没有**该行 → **不发明一行**（否则 settings 凭空多一条，diff 必挂；
      //        且这是安全的：新建路径的 initTaskNoSeq 会用「库内 max+1」现算，不撞号）；
      //      · 包里**有**该行但归一后值未变 → **连 updatedAt 都不动**（否则同机常规往返
      //        会因一次无意义的 updatedAt 刷新而在 JSON.stringify 上不等）。
      //    走既有 `snake()` 转换，故这里仍写 camelCase 的 `valueJson`（SQLite 列是
      //    snake_case 的 `value_json`）—— 手写列名会绕过这个转换。
      const settingsRows: Array<Record<string, unknown>> =
        pkgSeqRow && resolved.next !== pkgSeq
          ? (pkg.data?.settings ?? []).map((s) =>
              s.key === TASK_NO_SEQ_KEY
                ? {
                    key: TASK_NO_SEQ_KEY,
                    valueJson: JSON.stringify(resolved.next),
                    updatedAt: nowIso(),
                  }
                : s,
            )
          : (pkg.data?.settings ?? []);

      // ★ 清库顺序 = **子表 → 父表**（即 `map` 声明序的逆序）。
      //   `foreign_keys = ON`（生产 `openDb` 与本机一致）时，先删父表 `projects`
      //   会因仍有 stages/tasks 引用它而**立刻**抛 `SQLITE_CONSTRAINT_FOREIGNKEY`
      //   （无 ON DELETE CASCADE、且约束非 deferrable）—— 任何**非空库**的导入都会撞上，
      //   整库替换在团队形态下根本走不通。
      //   刻意用「map 声明序取反」而不是另写一份表名清单：后者一旦有人给 map 加表
      //   而忘了同步，就会变成**静默漏删**（比报错危险得多）。
      for (const t of [...Object.values(map)].reverse()) db.prepare(`DELETE FROM ${t}`).run();
      for (const [key, tableName] of Object.entries(map)) {
        let rows = pkg.data?.[key] ?? [];
        // 用归一后的行集（撞号的后到者已被重编号）
        if (key === 'tasks') rows = resolved.rows as unknown as Array<Record<string, unknown>>;
        if (key === 'settings') rows = settingsRows;
        for (const r of rows) insertRow(tableName, snake(r));
      }
    });
    tx();
    // ★ `renumbered` 是新增字段，`ok` 必须保留（老客户端只读它），HTTP 状态码不变。
    return { ok: true, renumbered };
  });
}
