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
// B-01 不变式的共享纯函数（与前端的 local.tasks.repo 用的是**同一份**实现，
// 故「status=ready ⟹ claimedAt=null」的规则文本只有一处）。
import { normalizeClaimedAt } from '../../src/core/types/entities';
// ★ v0.7：号的分配规则与前端的 local.tasks.repo **共享同一份纯函数**。
//   若两端各写一遍，「init 一次、逐条自增」这条纪律必有一端写成「每条重新 init」
//   → 整批新建拿到同一个号（且全程不报错）。
import {
  TASK_NO_SEQ_KEY,
  createTaskNoCounter,
  parseTaskNoSeq,
  type TaskNoCounter,
} from '../../src/core/lib/task-no';
import {
  parseJsonArray,
  serializeAssigneeIds,
  serializeJson,
} from '../lib/json-columns';

interface TaskRow {
  id: string;
  /**
   * ★ v0.7：任务人读号。可空（老数据/未分配 → 前端由 `formatTaskNo` 展示 `'—'`）。
   * 键序与 `entities.Task` 一致：紧接 `id` 之后。
   */
  task_no: number | null;
  project_id: string;
  stage_id: string;
  title: string;
  done: number;
  assignee_id: string | null;
  /** v0.3 参与人全集，JSON 数组串（SQLite 无数组类型） */
  assignee_ids: string;
  due_date: string | null;
  itinerary_date: string | null;
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
  run_id: string | null;
  order_index: number;
  revision: number;
  updated_at: string;
}

const nowIso = (): string => new Date().toISOString();

/* ------------------------- v0.7 号计数器（服务端侧） ------------------------- */

/**
 * 读计数器（**事务内**调用）。
 *
 * 取数方式与前端不同（SQLite 直接 `SELECT`，Dexie 要先整表读出来再归约 ——
 * 因为 Dexie 侧 `taskNo` **刻意无索引**），但「怎么算下一个号」走同一份共享纯函数。
 */
function readTaskNoSeq(db: Database.Database): number | null {
  const row = db
    .prepare('SELECT value_json AS v FROM settings WHERE key = ?')
    .get(TASK_NO_SEQ_KEY) as { v: string } | undefined;
  return parseTaskNoSeq(row?.v);
}

/** 回写计数器（**事务内**调用）。`settings.key` 是 PRIMARY KEY，故用 UPSERT。 */
function writeTaskNoSeq(db: Database.Database, next: number): void {
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run(TASK_NO_SEQ_KEY, JSON.stringify(next), nowIso());
}

/**
 * 打开计数器（**事务内**调用；事务须是 `.immediate()`，见各调用点注释）。
 *
 * `max_task_no` 直接用 SQL：SQLite 全表扫一次即可，无需前端那套内存归约。
 * 老库刚补列时该列全为 NULL → `MAX` 返回 NULL → `parseTaskNoSeq` 之外无需特殊处理，
 * `initTaskNoSeq` 会得到 999+1=1000（首个号 T-1000）。
 */
function openTaskNoCounter(db: Database.Database): TaskNoCounter {
  const maxRow = db.prepare('SELECT MAX(task_no) AS m FROM tasks').get() as { m: number | null };
  return createTaskNoCounter({
    seqFromSettings: readTaskNoSeq(db),
    maxTaskNoInDb: maxRow.m,
  });
}

/** status 缺省时的保守推导：done=1 → 'done'，否则 'draft'（与前端 normalizeTaskRow 同口径） */
function deriveStatus(raw: { status?: unknown; done?: unknown }): string {
  if (typeof raw.status === 'string' && raw.status.length > 0) return raw.status;
  return raw.done === true || raw.done === 1 ? 'done' : 'draft';
}

function rowToTask(r: TaskRow): Record<string, unknown> {
  return {
    id: r.id,
    // ★ v0.7：键序与 entities.Task 同序（紧接 id）。漏这一行 → 前端拿不到号，
    //   且 remote 侧产出的 Task 形状与 local 不一致（两套适配器语义必须逐字一致）。
    taskNo: r.task_no,
    projectId: r.project_id,
    stageId: r.stage_id,
    title: r.title,
    done: Boolean(r.done),
    assigneeId: r.assignee_id,
    assigneeIds: parseJsonArray<string>(r.assignee_ids),
    dueDate: r.due_date,
    itineraryDate: r.itinerary_date ?? null,
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
    runId: r.run_id ?? null,
    orderIndex: r.order_index,
    revision: r.revision,
    updatedAt: r.updated_at,
  };
}

/**
 * INSERT 列清单。
 *
 * ★ v0.7：`task_no` 追加在**第 2 位**（紧跟 `id`，与 `entities.Task` 键序同序），
 *   占位符 20 → **21** 个 `?`。列数与占位符数不等会在**运行期**才报
 *   「N values for M columns」—— 那时可能已经写坏了一半数据，故改动此处务必同改两处。
 */
const TASK_INSERT_COLUMNS = `(
  id, task_no, project_id, stage_id, title, done, assignee_id, assignee_ids, due_date, itinerary_date,
  source, external_id, agent_id, status, description, depends_on, artifacts,
  start_at, claimed_at, run_id, order_index, revision, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

interface TaskInsertValues {
  id: string;
  /** ★ v0.7：由调用方在**事务内**分配（仅新建路径；更新路径不经此处） */
  taskNo: number | null;
  projectId: string;
  stageId: string;
  title: string;
  assigneeId: string | null;
  assigneeIds: unknown;
  dueDate: string | null;
  itineraryDate: string | null;
  source: string;
  externalId: string | null;
  agentId: string | null;
  status: string;
  description: string | null;
  dependsOn: unknown;
  artifacts: unknown;
  startAt: string | null;
  claimedAt: string | null;
  /** v0.8.2：Agent 写入批次追溯（payload.producedBy.runId；null=人类路径） */
  runId: string | null;
  orderIndex: number;
  revision: number;
  updatedAt: string;
}

/**
 * 单条 INSERT 的 **21** 列值（done 恒由 status 派生，绝不取请求体的 done）。
 *
 * ★ 本函数是**全部 4 条 INSERT 路径的唯一收口**（bulk / POST、upsert 的 insert
 *   分支、未来新增的 INSERT），故 B-01 不变式（`status='ready'` ⟹ `claimed_at`
 *   为 null）在此施加一次即覆盖全部——避免在四个调用点各写一遍而漏掉其一。
 *
 * ★ v0.7：`v.taskNo` 必须落在**第 2 位**（与 `TASK_INSERT_COLUMNS` 的列序严格对齐）。
 *   注意本函数**只负责摆位，不负责分配** —— 号的分配必须在各调用点的**事务内**
 *   逐行完成（见 `openTaskNoCounter`）。把分配也塞进这里会让「一个事务里分配几次」
 *   变成隐式行为，而 bulk 路径要的恰恰是「每行分配一次」。
 */
function insertValues(v: TaskInsertValues): unknown[] {
  return [
    v.id,
    v.taskNo,
    v.projectId,
    v.stageId,
    v.title,
    v.status === 'done' ? 1 : 0,
    v.assigneeId,
    serializeAssigneeIds(v.assigneeIds),
    v.dueDate,
    v.itineraryDate,
    v.source,
    v.externalId,
    v.agentId,
    v.status,
    v.description,
    serializeJson(v.dependsOn),
    serializeJson(v.artifacts),
    v.startAt,
    normalizeClaimedAt(v.status, v.claimedAt),
    // v0.8.2：runId 溯源（claimedAt 后、orderIndex 前，与列清单/键序铁律同位）
    v.runId ?? null,
    v.orderIndex,
    v.revision,
    v.updatedAt,
  ];
}

/**
 * 幂等批量写入的**唯一实现**（v0.7 · §3.7：「路由与适配器共用一份」）。
 *
 * ★ 为什么抽成导出函数（T02）：
 *   `server/adapters/sqlite.bundle.ts` 的 `tasks.upsertByExternalId` 必须与
 *   `POST /api/tasks/upsert` **跑同一段代码**。若适配器改走 `app.inject`
 *   （HTTP 自调用），会引入 HTTP 层耦合、一次多余的 JSON 序列化/反序列化，
 *   以及一个针对自己的伪造请求 —— 那是在绕开 §3.7 的设计意图，不是复用它。
 *   抽出来之后：路由是个薄壳（校验 → 调本函数 → 回响应），适配器直接调本函数。
 *
 * ★ 本函数**自带事务外壳**（`db.transaction(...)` + `.immediate()`），调用方不要再套一层：
 *   better-sqlite3 不支持嵌套事务，重复 BEGIN 会直接抛错。
 *
 * 返回 `{ created, updated }`；**校验失败时返回 `{ error }`**（而不是抛）——
 * 「缺 projectId」是**可预期的调用方错误**（400），不是运行期故障（500）。
 * 用返回值而不是异常表达它，路由与适配器都能各自决定怎么处理（一个回 400、
 * 一个抛 `ChangxiaError`），而不必去 catch 一个「其实不是异常」的异常。
 *
 * ⚠️ 校验**先于事务**：拒绝时全库零写入，不留半套数据。
 */
export type TaskUpsertOutcome =
  | { created: number; updated: number; error?: undefined }
  | { error: { code: string; userMessage: string } };

export function runTaskUpsert(
  db: Database.Database,
  rows: readonly Record<string, unknown>[],
): TaskUpsertOutcome {
  // 形参收 `readonly`（调用方不该被本函数改写行），但 `.immediate()` 的签名要可变数组
  // → 拷一份**数组外壳**即可（行对象仍共享引用，零深拷贝开销）。
  const batch: Array<Record<string, unknown>> = rows ? Array.from(rows) : [];

  // ── 前置校验：缺 projectId 的行必须**显式拒绝**（fail-closed），绝不能猜 ──
  // 缺失时无法确定幂等查找的作用域，退回全局查找就会重演 BUG-03 的跨项目污染；
  // 而 `String(undefined)` 会写出 project_id='undefined' 的幽灵行（外键报 500）。
  // 选择 400 而不是「跳过并计入 skipped」的理由：
  //   ① 与 local（Dexie）适配器同语义 —— 那边对 !r.projectId 直接抛
  //      ChangxiaError(Validation, '任务字段不完整，无法写入。')。两端若一个抛错、
  //      一个静默跳过，同一份 payload 在 NAS 与本地会得到不同结果，而「两套适配器
  //      语义逐字一致」是本项目的硬约束（见 interfaces.ts 的 TaskUpsertRow 注释）。
  //   ② 与本路由既有的 400 约定一致（POST /tasks 空标题 → 400 code:'validation'）。
  //   ③ 静默跳过本身就是 BUG-03 的失效模式（数据静默分叉）；此处刻意选择响亮失败。
  for (const t of batch) {
    const projectId = t.projectId;
    if (typeof projectId !== 'string' || projectId.length === 0) {
      return {
        error: {
          code: 'validation',
          userMessage: '任务行缺少 projectId，无法确定幂等键的项目作用域。',
        },
      };
    }
  }

  let created = 0;
  let updated = 0;
  const tx = db.transaction((list: Array<Record<string, unknown>>) => {
    // 语句提到循环外：本循环逐行执行，每行都重新 prepare 是纯开销（无行为差异）
    const selectExisting = db.prepare(
      'SELECT * FROM tasks WHERE external_id = ? AND project_id = ?',
    );
    const updateExisting = db.prepare(
      `UPDATE tasks SET title=?, status=?, done=?, description=?, depends_on=?,
         artifacts=?, start_at=?, due_date=?, assignee_id=?, assignee_ids=?,
         agent_id=?, source=?, claimed_at=?, order_index=?, revision=?, updated_at=?
       WHERE id=?`,
    );
    const insertNew = db.prepare(`INSERT INTO tasks ${TASK_INSERT_COLUMNS}`);

    // ★ v0.7：号计数器**整批只开一次**（懒开 —— 纯 UPDATE 批次既不读也不写计数器）。
    //   两种写法都会坏：① 循环外一次性求值再给每行 → 全批同号；② 每行重新
    //   openTaskNoCounter → 仍全批同号（都取到第一条的号）。全程不报错。
    let counter: TaskNoCounter | null = null;
    let allocated = 0;
    const ensureCounter = (): TaskNoCounter => {
      if (counter === null) counter = openTaskNoCounter(db);
      return counter;
    };

    for (const t of list) {
      const externalId = (t.externalId as string | null) ?? null;
      // ★ 项目作用域查找：与 idx_tasks_external_id 的复合列形 (project_id, external_id) 对齐
      const projectId = String(t.projectId);
      const existing = externalId
        ? (selectExisting.get(externalId, projectId) as TaskRow | undefined)
        : undefined;
      if (existing) {
        // 命中 → UPDATE，bump revision（即使字段未变，保留「被 Agent 触碰过几次」的溯源）
        const nextStatus = String(t.status ?? existing.status);
        updateExisting.run(
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
          // ★ B-01 不变式：Agent 重发 payload 时若把状态带回 ready，必须同时清掉
          // claimed_at，否则一次重导入就再制造一个认领僵尸。
          normalizeClaimedAt(nextStatus, (t.claimedAt as string | null) ?? existing.claimed_at),
          // order_index 仅新建语义：更新路径保持既有排序，防止重导入反复重排
          existing.order_index,
          existing.revision + 1,
          nowIso(),
          existing.id,
        );
        updated += 1;
      } else {
        const status = deriveStatus(t);
        // ★ v0.7：号是仓储分配字段 —— 请求体里带了也一律忽略（TaskUpsertRow 已用
        //   Omit 放行，这里再兜一层：谁能提供号，谁就能制造重号）。
        //   `.take()` 逐行自增，绝不能提到循环外求值一次（否则全批同号）。
        const taskNo = ensureCounter().take();
        allocated += 1;
        insertNew.run(
          ...insertValues({
            id: String(t.id ?? crypto.randomUUID()),
            taskNo,
            projectId,
            stageId: String(t.stageId),
            title: String(t.title ?? ''),
            assigneeId: (t.assigneeId as string | null) ?? null,
            assigneeIds: t.assigneeIds ?? [],
            dueDate: (t.dueDate as string | null) ?? null,
            itineraryDate: (t.itineraryDate as string | null) ?? null,
            source: String(t.source ?? 'agent'),
            externalId,
            agentId: (t.agentId as string | null) ?? null,
            status,
            description: (t.description as string | null) ?? null,
            dependsOn: t.dependsOn ?? [],
            artifacts: t.artifacts ?? [],
            startAt: (t.startAt as string | null) ?? null,
            claimedAt: (t.claimedAt as string | null) ?? null,
            runId: (t.runId as string | null) ?? null,
            orderIndex: Number(t.orderIndex ?? 1),
            revision: 1,
            updatedAt: nowIso(),
          }),
        );
        created += 1;
      }
    }
    // 仅当真的分配过号才回写计数器：纯 UPDATE 批次不该无谓改写 settings
    // （保持「备份往返后 settings 逐字节不变」的往返判据）。
    if (allocated > 0) writeTaskNoSeq(db, ensureCounter().peek());
  });
  // ★ `.immediate()`：本事务**先读后写**（读计数器 → 写任务与计数器）。
  //   默认 DEFERRED 在并发下先拿读锁、升级写锁时失败（SQLITE_BUSY）。
  tx.immediate(batch);
  return { created, updated };
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
  // ★ v0.7：改 `.immediate()` 且**逐行**分配 taskNo（见下两处注释）。
  app.post('/api/tasks/bulk', async (req) => {
    const { rows } = req.body as { rows: Array<Record<string, unknown>> };
    const insert = db.prepare(`INSERT INTO tasks ${TASK_INSERT_COLUMNS}`);
    const tx = db.transaction((list: Array<Record<string, unknown>>) => {
      // ★ v0.7：计数器在**事务内只开一次**，之后逐行 `take()` 自增。
      //   两种写法都会坏：① 循环外一次性求值再给每行 → 全表同号（§2.12 点名）；
      //   ② 每行重新 open → 整批仍同号（都取到第一条的号）。
      const counter = openTaskNoCounter(db);
      let highestSeen = counter.peek() - 1;
      for (const t of list) {
        const ids = serializeAssigneeIds(t.assigneeIds);
        const idsArr = parseJsonArray<string>(ids);
        const status = deriveStatus(t);
        // 行自带号（备份/跨库搬运）→ 沿用，不重编号；未带号 → 分配
        const provided = typeof t.taskNo === 'number' && Number.isFinite(t.taskNo) ? t.taskNo : null;
        const taskNo = provided ?? counter.take();
        highestSeen = Math.max(highestSeen, taskNo);
        insert.run(
          ...insertValues({
            id: String(t.id),
            taskNo,
            projectId: String(t.projectId),
            stageId: String(t.stageId),
            title: String(t.title),
            assigneeId: (t.assigneeId as string | null) ?? idsArr[0] ?? null,
            assigneeIds: t.assigneeIds,
            dueDate: (t.dueDate as string | null) ?? null,
            itineraryDate: (t.itineraryDate as string | null) ?? null,
            source: String(t.source ?? 'human'),
            externalId: (t.externalId as string | null) ?? null,
            agentId: (t.agentId as string | null) ?? null,
            status,
            description: (t.description as string | null) ?? null,
            dependsOn: t.dependsOn ?? [],
            artifacts: t.artifacts ?? [],
            startAt: (t.startAt as string | null) ?? null,
            claimedAt: (t.claimedAt as string | null) ?? null,
            runId: (t.runId as string | null) ?? null,
            orderIndex: Number(t.orderIndex ?? 1),
            revision: Number(t.revision ?? 1),
            updatedAt: String(t.updatedAt ?? nowIso()),
          }),
        );
      }
      // 回写取「分配器下一个」与「本批最大号 + 1」的较大者。
      // 后者专防「本批带的号比计数器还大」（跨库搬运的号段领先）：
      // 只看 counter.peek() 会把计数器留在数据**之下**，下一次新建立刻撞号。
      if (list.length > 0) writeTaskNoSeq(db, Math.max(counter.peek(), highestSeen + 1));
    });
    // ★ `.immediate()`：本事务**先读后写**（读计数器 → 写任务与计数器）。
    //   默认的 DEFERRED 在并发下先拿读锁、升级写锁时失败（SQLITE_BUSY）。
    tx.immediate(rows ?? []);
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
    const status = deriveStatus(b);
    const insert = db.prepare(`INSERT INTO tasks ${TASK_INSERT_COLUMNS}`);
    // ★ v0.7：单条创建也要在**同一事务内**「开计数器 → 分配 → 写行 → 回写计数器」。
    //   放到事务外，两个并发 POST 会读到同一个 next → 拿到同一个号（且不报错）。
    // ★ 请求体里若带了 `taskNo` 一律**忽略**：它是仓储分配字段（见 interfaces.ts
    //   的 TaskUpsertRow 注释），谁能提供号就等于谁能制造重号。
    const tx = db.transaction(() => {
      const maxRow = db
        .prepare('SELECT MAX(order_index) AS m FROM tasks WHERE stage_id = ?')
        .get(String(b.stageId)) as { m: number | null };
      const counter = openTaskNoCounter(db);
      insert.run(
        ...insertValues({
          id,
          taskNo: counter.take(),
          projectId: String(b.projectId),
          stageId: String(b.stageId),
          title,
          assigneeId: (b.assigneeId as string | null) ?? parseJsonArray<string>(serializeAssigneeIds(b.assigneeIds))[0] ?? null,
          assigneeIds: b.assigneeIds,
          dueDate: (b.dueDate as string | null) ?? null,
          itineraryDate: (b.itineraryDate as string | null) ?? null,
          source: String(b.source ?? 'human'),
          externalId: (b.externalId as string | null) ?? null,
          agentId: (b.agentId as string | null) ?? null,
          status,
          description: (b.description as string | null) ?? null,
          dependsOn: b.dependsOn ?? [],
          artifacts: b.artifacts ?? [],
          startAt: (b.startAt as string | null) ?? null,
          claimedAt: (b.claimedAt as string | null) ?? null,
          runId: (b.runId as string | null) ?? null,
          orderIndex: (maxRow.m ?? 0) + 1,
          revision: 1,
          updatedAt: nowIso(),
        }),
      );
      writeTaskNoSeq(db, counter.peek());
    });
    // `.immediate()`：先读（计数器）后写，DEFERRED 在并发下会锁升级失败（SQLITE_BUSY）
    tx.immediate();
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
    return rowToTask(row);
  });

  // POST /tasks/upsert —— v0.6 新增：幂等批量写入（externalId 幂等键）
  // 先查后写（非 ON CONFLICT）：① 需精确区分 created/updated 计数；② 整个循环已在
  // db.transaction 内，先查后写无竞态。done 恒由 status 派生，绝不接受请求体的 done。
  //
  // ★ BUG-03（v0.7 必修）：幂等查找的作用域是**项目内** `(project_id, external_id)`。
  //   v0.7 §6.1（O1）已把唯一索引从「全局 external_id」换轨为复合唯一（见 server/db.ts
  //   migrateAgentIndex / schema.sql 的 idx_tasks_external_id），查找口径必须与之逐字对齐。
  //   若仍按全局 `WHERE external_id = ?` 查：A 项目已有键 k、B 项目再 upsert 同一个 k
  //   （Agent 生成的键在项目间复用是常态，如都叫 `stage-1-task-1`）→ 会**命中 A 的行**，
  //   随即走下面 `UPDATE ... WHERE id = <A 的行 id>` 把 A 的任务内容整体改写成 B 的，
  //   而 B 该有的行根本没建。全程不报错、计数还显示 updated:1 —— 静默跨项目数据污染。
  //   回归防线：tests/server.upsert-scope.spec.ts（跨项目同键 / 各自重发 / 批内同键）。
  //
  // ★ v0.7（T02）：处理器本体已抽成 `runTaskUpsert`（见上方导出），路由只剩薄壳 ——
  //   这样 `server/adapters/sqlite.bundle.ts` 能**直接调用同一份实现**（§3.7 的
  //   「路由与适配器共用一份」），而不是靠 HTTP 自调用绕开设计意图。
  app.post('/api/tasks/upsert', async (req, reply) => {
    const { rows } = req.body as { rows: Array<Record<string, unknown>> };
    const outcome = runTaskUpsert(db, rows ?? []);
    if (outcome.error) {
      void reply.status(400);
      return { error: outcome.error };
    }
    return { created: outcome.created, updated: outcome.updated };
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
      itinerary_date:
        b.itineraryDate !== undefined ? (b.itineraryDate as string | null) : existing.itinerary_date,
      source: b.source !== undefined ? String(b.source) : existing.source,
      external_id: b.externalId !== undefined ? (b.externalId as string | null) : existing.external_id,
      agent_id: b.agentId !== undefined ? (b.agentId as string | null) : existing.agent_id,
      description: b.description !== undefined ? (b.description as string | null) : existing.description,
      depends_on: b.dependsOn !== undefined ? serializeJson(b.dependsOn) : existing.depends_on,
      artifacts: b.artifacts !== undefined ? serializeJson(b.artifacts) : existing.artifacts,
      start_at: b.startAt !== undefined ? (b.startAt as string | null) : existing.start_at,
      // ★ B-01 不变式：PATCH 把 status 改成 ready（释放/解除受阻）时清掉 claimed_at。
      // 共享 normalizeClaimedAt 与前端 local.tasks.repo.update 同一份实现——
      // 两端各写一遍 if (status === 'ready') 正是本 bug 的产生方式。
      claimed_at: normalizeClaimedAt(
        nextStatus,
        b.claimedAt !== undefined ? (b.claimedAt as string | null) : existing.claimed_at,
      ),
      order_index: b.orderIndex !== undefined ? Number(b.orderIndex) : existing.order_index,
      revision: existing.revision + 1,
      updated_at: nowIso(),
    };
    db.prepare(
      `UPDATE tasks SET title=?, status=?, done=?, assignee_id=?, assignee_ids=?, due_date=?, itinerary_date=?,
         source=?, external_id=?, agent_id=?, description=?, depends_on=?, artifacts=?,
         start_at=?, claimed_at=?, order_index=?, revision=?, updated_at=? WHERE id=?`,
    ).run(
      merged.title,
      merged.status,
      merged.done,
      merged.assignee_id,
      merged.assignee_ids,
      merged.due_date,
      merged.itinerary_date,
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
