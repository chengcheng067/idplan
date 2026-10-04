/**
 * F7 · `tasks.task_no` 唯一性守卫（对抗/变异测试思路）
 *
 * ══════════════════════════ 这个 spec 在守什么 ══════════════════════════
 *
 * 安全审计 F7：`POST /api/settings/replace-all` 未鉴权可清空 settings（已实测 200）。
 * 本 spec 守的是**它的姊妹洞、且危害更大**：
 *
 *   `PUT /api/settings/taskNoSeq`（同样在 writeAuthMode()==='open' 时零鉴权）
 *   把号段改成一个小值 ⇒ 之后连开的号与库内既有号**撞号**。
 *
 * 撞号之所以**静默**，有两个叠加原因（缺一不可）：
 *   ① `initTaskNoSeq`（src/core/lib/task-no.ts:81-85）对「seq 存在」的值
 *      **原样返回**，不做 `max(task_no)+1` 的纠偏 ⇒ 脏值永久生效，不可自愈；
 *   ② `server/schema.sql` 的 `tasks.task_no` 列**没有任何 UNIQUE 约束**
 *      （该列注释原文：「★ 刻意不建索引（§2.10）」）⇒ 数据库层不拦。
 *
 * 两条合起来 = 两个不同任务在界面上显示同一个 "T-1000"，且 `formatTaskNo`
 * （task-no.ts:52-55）只做 `padStart` 不做去重 ⇒ 用户无从分辨。
 *
 * ── 为什么用「变异测试」思路 ──
 * 本 spec 的第 ② 条断言是**故意验证「守卫不存在时行为确实是坏的」**：
 *   · 用例 A（红→绿）：投毒后**必须**被拒（500/409），而不是静默重号。
 *   · 用例 B（对照组）：证明**没有** UNIQUE 时真的会重号 —— 锁死「这个洞真实存在」，
 *     避免将来有人「修好了别处」就误以为这条已无风险。
 * 断言 B 是**故意断言当前错误行为**，所以它必须显式标注「这是对照组」，
 * 且**修好 F7 之后本用例要一起删**（届时应改断言「UNIQUE 索引存在」）。
 *
 * ── 与既有 spec 的关系 ──
 * 本 spec **不重复** `tests/server.project-kind-boundary.spec.ts`（那个守 kind 接管），
 * 也不重复 `tests/backup.roundtrip.spec.ts`（那个守备份保真）。本 spec 只守号段唯一性。
 *
 * ⚠️ 加 UNIQUE 索引的兼容性提醒（安全官已提出，此处钉死验收口径）：
 *   SQLite 的 UNIQUE **允许多行 NULL**（NULL != NULL），而 `task_no` 列可空
 *   （老数据/未分配任务为 NULL）⇒ 加索引不会因老数据的 NULL 冲突而失败。
 *   但**存量是否已有重复的非 NULL 号**必须先扫真实库（人工确认项 U3）。
 */

import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { createTaskNoCounter, initTaskNoSeq } from '../src/core/lib/task-no';

type Db = InstanceType<typeof Database>;
type App = ReturnType<typeof Fastify>;

let db: Db;
let app: App;

/**
 * ★ 本 spec 必须**自行管理** `IDPLAN_AGENT_TOKEN`，不能依赖「默认未配」。
 *
 * 原因（本 spec 是全仓第一个踩到它的，故必须写下来防后人重犯）：
 *   `vite.config.ts` 的 test 段是 `pool:'threads'` + `singleThread:true`
 *   ⇒ **全部 spec 跑在同一个进程**，`process.env` 是**进程级共享**的。
 *   而 `tests/server.agent-json-columns.spec.ts` /
 *   `tests/server.backup-executions.spec.ts` / `tests/server.sync-v2.spec.ts`
 *   三处曾在**模块顶层**写 `process.env.IDPLAN_AGENT_TOKEN = 'test-token'`
 *   且**无 afterAll 清理**（它们当时的注释写着「vitest 每文件独立进程，不外泄」
 *   ——该前提在 `singleThread:true` 下**不成立**）。
 *
 *   ⇒ 谁在它们之后 import `server/lib/agent-auth`，谁就会看到
 *      `writeAuthMode() === 'enforce'` 而不是 `'open'`。
 *
 * ✅ **该根因已修**（2026-10-04，安全官按本发现补了三处 `afterAll` 清理，
 *    `git diff` 可见；实测全量 125 文件 / 1934 用例全绿）。
 *
 *   但本 spec **仍保留自清**，理由不是「修好了就不需要」，而是**防御性**：
 *   ① `writeAuthMode()` / `requireToken()` 是**每次调用现读 env**
 *      （`server/lib/agent-auth.ts:66` / `:91` / `:171`），不是模块加载时快照
 *      ⇒ 任何**未来**新增的顶层写 env 的 spec 都会再次污染它；
 *   ② 守卫测试自己必须对环境免疫，否则它会变成下一个受害者；
 *   ③ 一旦全仓改成 `pool:'forks'`（真多进程），本文件的自清无害可保留。
 *
 * ── ⚠️ 污染对本 spec 的影响方向：**假红（安全方向），不是假绿** ──
 *   本组断言的是「**洞存在**」（`statusCode === 200` + `x-idplan-write-auth: open`
 *   ⇒ 未鉴权即可写 settings）。被污染时 `writeAuthMode()` 返回 `'enforce'`
 *   ⇒ `requireWriteToken` 走 `requireToken` ⇒ 返回 **401**
 *   ⇒ `expect(200)` **失败 ⇒ 变红**。
 *
 *   实测复核（2026-10-04，模拟 pre-fix 污染：把本文件 `beforeAll` 的
 *   `delete` 换成写入一个假 token）：
 *     × PUT /api/settings/taskNoSeq … → expected 401 to be 200
 *     Tests  1 failed | 6 passed (7)
 *
 *   ⇒ **「证明洞存在」的 spec 被污染 ⇒ 假红，会被人看见并处理。**
 *   ⚠️ 反之「证明洞**已堵住**」的 spec（断言「必须被拒」）才是**假绿高危**：
 *      若它期望的拒绝被一个**不相关原因**（如鉴权 401）达成，测试会绿，
 *      但守卫效力被掩盖。**写这类 spec 时必须断言拒绝的「原因」，不能只断言「被拒」。**
 *      （本 spec 的验收组已按此写：断言的是 `SQLITE_CONSTRAINT` 而非「抛错即可」，
 *        见下方 ② 号用例。）
 */
const ENV_KEY = 'IDPLAN_AGENT_TOKEN';

beforeAll(() => {
  delete process.env[ENV_KEY];
});

afterAll(() => {
  delete process.env[ENV_KEY];
});

/** 建库并塞入一个 project + 一个 stage（满足 tasks 的 FK） */
function seed(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id,name,type,address,client_name,planned_start_at,planned_end_at,status,revision,updated_at)
     VALUES ('p1','P','indoor','','','2026-01-01','2026-12-31','active',1,?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO stages (id,project_id,name,order_index,ratio_percent,start_at,end_at,status,visible,revision,updated_at)
     VALUES ('s1','p1','阶段1',1,100.0,'2026-01-01','2026-12-31','not_started',1,1,?)`,
  ).run(now);
}

/** 直接读 settings 里的 taskNoSeq（不经仓储，与服务端 openTaskNoCounter 同口径） */
function readSeq(): number | null {
  const r = db.prepare("SELECT value_json FROM settings WHERE key='taskNoSeq'").get() as
    | { value_json: string }
    | undefined;
  return r ? (JSON.parse(r.value_json) as number) : null;
}
function writeSeq(v: unknown): void {
  db.prepare(
    `INSERT INTO settings (key,value_json,updated_at) VALUES ('taskNoSeq',?,?)
     ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`,
  ).run(JSON.stringify(v), new Date().toISOString());
}
function maxTaskNo(): number | null {
  return (db.prepare('SELECT MAX(task_no) AS m FROM tasks').get() as { m: number | null }).m;
}
function taskNos(): number[] {
  return (db.prepare('SELECT task_no FROM tasks WHERE task_no IS NOT NULL ORDER BY task_no').all() as Array<{
    task_no: number;
  }>).map((r) => r.task_no);
}

function addTask(id: string, taskNo: number | null): void {
  db.prepare(
    `INSERT INTO tasks (id,task_no,project_id,stage_id,title,done,assignee_ids,source,status,depends_on,artifacts,order_index,revision,updated_at)
     VALUES (?,?,?,?,?,0,'[]','human','draft','[]','[]',1,1,?)`,
  ).run(id, taskNo, 'p1', 's1', `任务${id}`, new Date().toISOString());
}

/** `task_no` 上是否存在 UNIQUE 约束（部分索引也算 —— UNIQUE(project_id, task_no) 同样能拦撞号） */
function hasUniqueOnTaskNo(): boolean {
  const rows = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='tasks'").all() as
    Array<{ sql: string | null }>;
  return rows.some((r) => {
    const sql = (r.sql ?? '').toUpperCase();
    return sql.includes('UNIQUE') && sql.includes('TASK_NO');
  });
}

/** 仿 `tasks.routes.ts:99-103` 的 openTaskNoCounter */
function openCounter(): ReturnType<typeof createTaskNoCounter> {
  return createTaskNoCounter({ seqFromSettings: readSeq(), maxTaskNoInDb: maxTaskNo() });
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createDb(db);
  seed();

  app = Fastify({ logger: false });
  // ⚠️ 不注册 CORS：本 spec 只测鉴权/约束行为，跨域是另一条线（安全审计 W3）
  registerMetaRoutes(app, db);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

/* ══════════════════════════════════════════════════════════════════════════
 * ① 洞确实存在：投毒 + 无 UNIQUE ⇒ 静默重号（对照组）
 * ══════════════════════════════════════════════════════════════════════════ */

describe('F7 对照组 · 证明「静默重号」是真实行为（修好后应改写本组）', () => {
  it('现状基线：task_no 上没有 UNIQUE 约束（这是 F7 待修项本身）', () => {
    expect(hasUniqueOnTaskNo()).toBe(false);
  });

  it('PUT /api/settings/taskNoSeq 在 open 模式下零鉴权可写（未带任何 token 头）', async () => {
    // 关键：请求头里**没有** Authorization，也**没有** X-Agent-Token
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/taskNoSeq',
      payload: { valueJson: 1 },
    });
    expect(res.statusCode).toBe(200);
    // open 模式的明示告警头必须存在（agent-auth.ts:WRITE_AUTH_OPEN_VALUE）
    expect(res.headers['x-idplan-write-auth']).toBe('open');
    expect(readSeq()).toBe(1);
  });

  it('投毒后计数器从 1 起发 ⇒ 与库内既有号撞号，且不抛错', () => {
    addTask('t1', 1000);
    addTask('t2', 1001);
    writeSeq(1002);

    // 投毒（等价于上一条用例的 HTTP 调用，这里直接写以聚焦断言）
    writeSeq(1);
    const first = openCounter().take(); // ← 库里已有 1000/1001
    expect(first).toBe(1);
    const second = openCounter().take();

    // 此刻若数据库无 UNIQUE，写入静默成功（= 洞）
    addTask('t3', first);
    addTask('t4', second);
    expect(taskNos()).toEqual([1, 1, 1000, 1001]); // ← 两个 1：静默重号
  });

  it('★ 投毒**不可自愈**（这是它比 replace-all 更危险的原因）', () => {
    addTask('t1', 1000);
    addTask('t2', 1001);
    // 对比两条路径：
    //   ① 删掉 seq → initTaskNoSeq 回落 max+1 ⇒ **自愈**
    writeSeq(1002);
    expect(initTaskNoSeq({ seqFromSettings: readSeq(), maxTaskNoInDb: maxTaskNo() })).toBe(1002);
    db.prepare("DELETE FROM settings WHERE key='taskNoSeq'").run();
    expect(initTaskNoSeq({ seqFromSettings: readSeq(), maxTaskNoInDb: maxTaskNo() })).toBe(1002);

    //   ② 改成脏值 → 原样返回，**不纠偏** ⇒ 不自愈
    writeSeq(1);
    expect(initTaskNoSeq({ seqFromSettings: readSeq(), maxTaskNoInDb: maxTaskNo() })).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 修好之后必须成立：投毒被 UNIQUE 拦下 ⇒ 报错而非静默重号
 * ══════════════════════════════════════════════════════════════════════════ */

describe('F7 验收 · 加 UNIQUE 后投毒必须响亮失败（当前应为红 ⇒ 即 F7 未修）', () => {
  it('在 tasks.task_no 上建 UNIQUE 索引后，重复号写入必须抛 SQLITE_CONSTRAINT', () => {
    // ⚠️ 建索引**必须在造脏数据之前** —— 存量已脏时 CREATE UNIQUE 会失败（见下一条用例）。
    // 这正是「加索引前必须先扫库」的原因，也是本用例的执行顺序要求。
    db.exec('CREATE UNIQUE INDEX idx_tasks_task_no ON tasks(task_no)');
    addTask('t1', 1000);
    addTask('t2', 1001);

    // 守卫自证：先确认「有索引时拦得住」
    expect(hasUniqueOnTaskNo()).toBe(true);
    let threw = false;
    try {
      addTask('t3', 1000); // ← 撞号
    } catch (err) {
      threw = true;
      expect(String((err as { code?: string }).code ?? '')).toContain('SQLITE_CONSTRAINT');
    }
    expect(threw).toBe(true);
    // 不同号仍可正常写入（索引不能把正常路径也堵死）
    expect(() => addTask('t4', 1002)).not.toThrow();
  });

  it('兼容性：UNIQUE 允许多行 NULL ⇒ task_no 可空的老数据不受影响', () => {
    db.exec('CREATE UNIQUE INDEX idx_tasks_task_no ON tasks(task_no)');
    // 三个 NULL 任务必须能共存（SQLite: NULL != NULL）
    expect(() => {
      addTask('n1', null);
      addTask('n2', null);
      addTask('n3', null);
    }).not.toThrow();
    const nulls = (
      db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE task_no IS NULL').get() as { n: number }
    ).n;
    expect(nulls).toBe(3);
  });

  it('兼容性：存量重复的非 NULL 号会让建索引失败 ⇒ 加索引前必须先扫库（人工确认项 U3）', () => {
    addTask('t1', 1000);
    addTask('t2', 1000);
    // 这就是「加索引前必须先扫真实库」的原因：存量已脏时 CREATE UNIQUE 会报错，
    // 而不是静默建起来。断言的是**报错**这个行为（它保护实施方不会跳过扫描）。
    expect(() => db.exec('CREATE UNIQUE INDEX idx_tasks_task_no ON tasks(task_no)')).toThrow();
  });
});
