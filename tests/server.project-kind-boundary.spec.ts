/**
 * v0.8 · T04-SRV · `PATCH /api/projects/:id` 的**归属侧（kind）接管边界**验收 spec。
 *
 * ── 覆盖 ──
 * 设计 §7.4（接管双层门的「服务端 assert」一侧；D5 / TBD-9）、PRD B11/B12 的服务端前置。
 *
 * ── 这条边界到底是什么（本 spec 锁的就是这个口径，别读成「权限校验」）──
 * 服务端**没有角色模型**：`server/` 里唯一的鉴权是 Agent 通道共享密钥，人类客户端请求无鉴权。
 * 因此「校验请求者是 admin」在当前架构下不可能实现；本层实现的是**显式意图**：
 * 变更 `kind` 必须显式 `takeover === true`。它能挡住**误操作**（字段级更新顺手带上 kind），
 * 挡不住「本来就能改库的调用方」。
 *
 * ── 零回归的硬要求 ──
 * `kind` **未变化**（含完全不传）时，本路由必须与今天**逐字一致** ——
 * 故每个「拒绝」用例都配一个「同样的请求但不碰 kind → 照常生效」的对照。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';

type Db = InstanceType<typeof Database>;
type App = ReturnType<typeof Fastify>;

const PID = 'p_boundary';

let db: Db;

async function buildServer(): Promise<App> {
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
  await app.ready();
  return app;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createDb(db);
});

afterEach(() => {
  db.close();
});

type Row = Record<string, unknown>;

const row = (): Row => db.prepare('SELECT * FROM projects WHERE id = ?').get(PID) as Row;

/** 建一个人类项目（POST 不传 kind → DDL/端点默认 'human'） */
async function seedHumanProject(app: App, kind?: string): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      id: PID,
      name: '人类项目',
      type: 'dining',
      address: '某路 1 号',
      clientName: '张先生',
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-12-31',
      ...(kind === undefined ? {} : { kind }),
    },
  });
  expect(res.statusCode, `建项目失败：${res.body}`).toBe(200);
}

async function patch(
  app: App,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: { error?: { code: string; userMessage: string } } }> {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${PID}`,
    payload,
  });
  return { statusCode: res.statusCode, body: res.json() as { error?: { code: string; userMessage: string } } };
}

/** 除 kind / revision / updated_at 外，其余列必须逐一相等（证明「只有 kind 变」） */
function expectOnlyKindChanged(before: Row, after: Row, alsoChanged: readonly string[] = []): void {
  for (const key of Object.keys(after)) {
    if (key === 'kind' || key === 'revision' || key === 'updated_at') continue;
    if (alsoChanged.includes(key)) continue;
    expect(after[key], `字段 ${key} 不应变化`).toEqual(before[key]);
  }
  expect(after.revision).toBe((before.revision as number) + 1);
}

/* ======================================================================================
 * 一、变更 kind 必须有显式接管意图
 * ==================================================================================== */

describe('§7.4 · 变更 kind（接管）必须有显式意图', () => {
  it('改 kind 但无 takeover → 400 invalid_field，且该行**全部字段**逐字未变', async () => {
    const app = await buildServer();
    await seedHumanProject(app);
    const before = row();

    const res = await patch(app, { kind: 'agent' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(res.body.error?.userMessage).toContain('takeover');
    // ★ 零写入：连 revision / updated_at 都不许动（PATCH 每条都会写这两列）
    expect(row()).toEqual(before);
    expect(row().kind).toBe('human');
  });

  it('takeover:true → 200，且**只有 kind 变**（其余字段逐一相等）', async () => {
    const app = await buildServer();
    await seedHumanProject(app);
    const before = row();

    const res = await patch(app, { kind: 'agent', takeover: true });

    expect(res.statusCode).toBe(200);
    const after = row();
    expect(after.kind).toBe('agent');
    expectOnlyKindChanged(before, after);
  });

  it('接管的两个方向都要求 takeover（agent → human 同样受门禁）', async () => {
    const app = await buildServer();
    await seedHumanProject(app, 'agent');
    const before = row();

    const blocked = await patch(app, { kind: 'human' });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.body.error?.code).toBe('invalid_field');
    expect(row()).toEqual(before);

    const ok = await patch(app, { kind: 'human', takeover: true });
    expect(ok.statusCode).toBe(200);
    expect(row().kind).toBe('human');
    expectOnlyKindChanged(before, row());
  });

  it.each([
    ['字符串真值（非布尔）', 'true'],
    ['数字 1', 1],
    ['字符串 yes', 'yes'],
    ['null', null],
  ])('takeover 非严格 true（%s）→ 仍 400（只认字面量 true）', async (_label, value) => {
    const app = await buildServer();
    await seedHumanProject(app);
    const before = row();

    const res = await patch(app, { kind: 'agent', takeover: value });
    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(row()).toEqual(before);
  });
});

/* ======================================================================================
 * 二、kind 值域：脏值必须被拒（且已有 takeover 也不例外）
 * ==================================================================================== */

describe('§7.4 · kind 值域 {human, agent}', () => {
  it('kind 传脏值 → 400 invalid_field（不写进库）', async () => {
    const app = await buildServer();
    await seedHumanProject(app);
    const before = row();

    const res = await patch(app, { kind: 'agentt' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(res.body.error?.userMessage).toContain('agentt');
    expect(row()).toEqual(before);
  });

  it('脏值 + takeover:true 也 400（显式意图不能把一个非法值合法化）', async () => {
    const app = await buildServer();
    await seedHumanProject(app);
    const before = row();

    for (const dirty of ['agentt', '', 'human ', 'AGENT', 'null']) {
      const res = await patch(app, { kind: dirty, takeover: true });
      expect(res.statusCode, dirty).toBe(400);
      expect(res.body.error?.code).toBe('invalid_field');
    }
    expect(row()).toEqual(before);
  });

  it('kind:null → 400（String(null) = "null" 是脏值，现状会原样写进 NOT NULL 列）', async () => {
    const app = await buildServer();
    await seedHumanProject(app);
    const before = row();

    const res = await patch(app, { kind: null, takeover: true });
    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(row()).toEqual(before);
  });
});

/* ======================================================================================
 * 三、零回归：kind 未变化时，行为与今天逐字一致
 * ==================================================================================== */

describe('★ 零回归 · kind 未变化（含不传）时不引入任何新校验', () => {
  it('不带 kind 的普通 PATCH → 改别的字段照常生效，kind 不动', async () => {
    const app = await buildServer();
    await seedHumanProject(app);

    const res = await patch(app, { name: '改名后', shortLabel: '改' });

    expect(res.statusCode).toBe(200);
    expect(row().name).toBe('改名后');
    expect(row().short_label).toBe('改');
    expect(row().kind).toBe('human');
  });

  it('kind 与现值相同（不带 takeover）→ 200，且不报「必须有接管意图」', async () => {
    const app = await buildServer();
    await seedHumanProject(app);

    const res = await patch(app, { kind: 'human', name: '改名后' });

    expect(res.statusCode).toBe(200);
    expect(row().kind).toBe('human');
    expect(row().name).toBe('改名后');
  });

  it('takeover:true 但不涉及 kind → 与不带 takeover 的请求逐字同效（takeover 不是布尔列，不落库）', async () => {
    const app = await buildServer();
    await seedHumanProject(app);
    const before = row();

    const res = await patch(app, { takeover: true, clientName: '李女士' });

    expect(res.statusCode).toBe(200);
    const after = row();
    expect(after.client_name).toBe('李女士');
    expect(after.kind).toBe(before.kind);
    // takeover 不是 projects 的列：不得出现在行里
    expect(Object.keys(after)).not.toContain('takeover');
    // 只有被显式改动的 client_name（＋ kind/revision/updated_at）变，其余逐字未变
    expectOnlyKindChanged(before, after, ['client_name']);
  });

  it('其它既有行为不受影响：未知项目 404 文案不变', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/projects/not-exist',
      payload: { kind: 'agent', takeover: true },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('not_found');
  });
});

/* ======================================================================================
 * 四、与建板通道的耦合：Agent 通道建的看板，人类侧仍只能经显式接管离开 Agent 侧
 * ==================================================================================== */

describe('★ 边界与建板端点的一致口径', () => {
  it('建板落 kind=agent（不经 PATCH），把它「接管」回人类侧仍需 takeover:true', async () => {
    const app = await buildServer();
    await seedHumanProject(app, 'agent');
    const before = row();

    // 没有 takeover 的普通字段更新：Agent 看板不会被顺手拖回人类侧
    const edit = await patch(app, { name: 'AI 看板改名' });
    expect(edit.statusCode).toBe(200);
    expect(row().kind).toBe('agent');
    expect(row().name).toBe('AI 看板改名');

    // 接管回人类侧：必须显式声明
    const blocked = await patch(app, { kind: 'human' });
    expect(blocked.statusCode).toBe(400);
    const ok = await patch(app, { kind: 'human', takeover: true });
    expect(ok.statusCode).toBe(200);
    expect(row().kind).toBe('human');
    void before;
  });
});

/* ======================================================================================
 * 五、★ 建项目侧（`POST /api/projects`）的 kind 值域校验 —— 与 PATCH 门**对称**
 *
 * ── 为什么这一段必须存在（这是被复核查出的真缺陷）──
 * PATCH 拒脏值、POST 却 `String(body.kind ?? 'human')` 静默落库 ⇒ 同一字段两条路两种口径。
 * 后果不是洁癖：服务端 `listProjectCandidates()` 用**等值**（2026-09-20 用户裁决后再反转后
 * 为 `kind = 'agent'`，此前是 `kind = 'human'`）—— 等值的反面就是「任何非目标值都被排除」。
 * 值得如实记一笔：反转**顺带修掉了**脏值最刺眼的那种两侧相反（`kind=''` 曾「前端算人类、
 * 候选清单却排除它」—— 那时候选列的是人类项目；现在候选只列 Agent 看板，脏值项目在两侧
 * 一致地归人类侧）。但拒脏值本身没有过时：全仓判据（`projectKindOf` / 候选等值 / 建板
 * 落点）都只认 `'human' | 'agent'` 两个字面量，静默落一个第三值就是把「哪边都不是」的
 * 项目塞进库 —— 比当场 400 危险得多。
 *
 * ── ⚠️ 本段同时锁住「不许把 takeover 加到这里」──
 * 建项目不是接管。若有人把 takeover 要求复制到 POST，本段的「不传 kind → 201」与
 * 「kind='agent' → 201（无 takeover）」会当场红。
 * ==================================================================================== */

/** 建项目（自带完整必填字段），只让 kind 可控 */
async function postProject(
  app: App,
  kind?: unknown,
  extra: Record<string, unknown> = {},
): Promise<{ statusCode: number; body: { error?: { code: string; userMessage: string }; id?: string } }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      id: 'p_post_kind',
      name: 'POST 归属侧校验',
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-12-31',
      ...(kind === undefined ? {} : { kind }),
      ...extra,
    },
  });
  return {
    statusCode: res.statusCode,
    body: res.json() as { error?: { code: string; userMessage: string }; id?: string },
  };
}

const postRow = (): Row => db.prepare('SELECT * FROM projects WHERE id = ?').get('p_post_kind') as Row;
const projectCount = (): number =>
  (db.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c;

describe('★ 建项目侧 · POST /api/projects 的 kind 值域校验（与 PATCH 门对称）', () => {
  it('kind: "" → 400 invalid_field，且**零写入**', async () => {
    const app = await buildServer();
    const before = projectCount();

    const res = await postProject(app, '');

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(res.body.error?.userMessage).toContain('human');
    // ★ 零写入：脏值项目绝不许落库（否则会出现「前端算人类、服务端排除」的幽灵记录）
    expect(projectCount()).toBe(before);
    expect(db.prepare('SELECT * FROM projects WHERE id = ?').get('p_post_kind')).toBeUndefined();
  });

  it('kind: "agentt"（拼写脏值）→ 400 invalid_field，且零写入', async () => {
    const app = await buildServer();
    const before = projectCount();

    const res = await postProject(app, 'agentt');

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(res.body.error?.userMessage).toContain('agentt');
    expect(projectCount()).toBe(before);
  });

  it('kind: null → 400（显式 null 不是「不传」，不得被 String(null) 落成 "null"）', async () => {
    const app = await buildServer();
    const before = projectCount();

    const res = await postProject(app, null);

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    // '"null"' 落库的话，前端按人类侧显示、服务端候选清单排除它 —— 正是要防的幽灵记录
    expect(projectCount()).toBe(before);
    void before;
  });

  it('★ 不传 kind → 201 且落库为 \'human\'（行为与今天逐字一致，回归铁律）', async () => {
    const app = await buildServer();

    const res = await postProject(app);

    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(postRow().kind).toBe('human');
  });

  it('★ kind: \'agent\' → 201 且落库为 \'agent\'（建板通道依赖这条，**不得**把建板打红）', async () => {
    const app = await buildServer();

    const res = await postProject(app, 'agent');

    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(postRow().kind).toBe('agent');
  });

  it('★ 建项目**不需要** takeover：带了 kind=\'agent\' 但无 takeover 仍 201（创建 ≠ 接管）', async () => {
    const app = await buildServer();

    const res = await postProject(app, 'agent');

    // 若有人把 PATCH 的 takeover 要求复制到 POST，这里会红 —— 本断言就是那道护栏
    expect(res.statusCode, '建项目不该要求 takeover（创建不是接管）').toBe(200);
    expect(postRow().kind).toBe('agent');
    // takeover 不是 projects 的列，也不得被带进任何列
    expect(Object.keys(postRow())).not.toContain('takeover');
  });

  it('合法 kind 之外的其它字段照旧透传（校验只收窄 kind，不波及其余）', async () => {
    const app = await buildServer();

    const res = await postProject(app, 'human', {
      address: '某路 2 号',
      clientName: '王先生',
      type: 'dining',
    });

    expect(res.statusCode).toBe(200);
    const r = postRow();
    expect(r.kind).toBe('human');
    expect(r.address).toBe('某路 2 号');
    expect(r.client_name).toBe('王先生');
    expect(r.type).toBe('dining');
  });
});
