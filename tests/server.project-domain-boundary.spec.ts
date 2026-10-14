/**
 * v0.8 · `Project.domain`（主板块）的**值域边界**验收 spec（服务端两条写入路径）。
 *
 * ── 覆盖 ──
 *   · `PATCH /api/projects/:id` 的 domain 写入点；
 *   · `POST /api/projects` 的 domain 写入点（与前者**必须同口径** —— 同一字段一条路拒、
 *     另一条路照收就是口径漂移，`kind` 当初正是在这里出过同一个洞，见
 *     `tests/server.project-kind-boundary.spec.ts` 第五段）。
 *   · 白名单与看板列派生的耦合（「为什么必须拒收」的技术理由，见第四节）。
 *
 * ── 被锁的口径（产品负责人 2026-10-14 拍板）──
 * **拒收**越界值，不做归一化。归一化会静默改写用户数据、且抹掉「脏值从哪来」的线索；
 * 拒收的代价是「含脏值的老备份包导不进来」，已接受 —— 配套要求是备份侧错误必须定位到
 * 具体记录（那份断言在 `tests/backup.domain-whitelist.spec.ts`）。
 *
 * ── 为什么这件事不是洁癖 ──
 * 看板列集合由 `deriveColumns()`（`src/pages/HomePage.tsx`）**遍历内置行业**派生。
 * 库里若只有越界值：`used` 非空 ⇒ 「至少 indoor」的保险不触发；遍历又匹配不到该值
 * ⇒ **一个行业列都派生不出来**（整行只剩 `todo` 一个列盒），且分桶兜底把项目塞进末列
 * （此时末列就是 `todo`）⇒ 实测 `in_progress` 的项目被算进「待启动」**列**，
 * 计数与筛选同时错。故本 spec 的正例不只断言「200 + 落库」，还断言**能派生出行业列**。
 *
 * ── 夹具与断言的分工 ──
 *   · 「合法值 → 200 + 落库 + 看板有列」= 正例；
 *   · 「越界值 → 400 + **整行逐字未变**（连 revision / updated_at 都不许动）」= 反例；
 *   · 「非法值轮一遍 → 库里 domain 集合 ⊆ 合法集」= 不变式（钉住「库不可能再藏脏值」）。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerProjectRoutes } from '../server/routes/projects.routes';
import { registerStageRoutes } from '../server/routes/stages.routes';
import { usableProjectDomains } from '../server/lib/project-domain';
import { getDomains, getDomainColumns } from '../src/core/template/stage-library';
import { deriveColumns } from '../src/pages/HomePage';
import { ScheduleBasis, ProjectStatus } from '../src/core/types/enums';
import type { Project } from '../src/core/types/entities';

type Db = InstanceType<typeof Database>;
type App = ReturnType<typeof Fastify>;

const PID = 'p_domain';
let db: Db;

/** 白名单（转发 `stage-library.getUsableDomains()`，不是本文件抄的一份字面量） */
const USABLE = usableProjectDomains();
/** 一个**典型**越界值：它在 `StageTemplateDomain` 类型里、却不在 `stage-library.json` 的 domains 里 */
const OUT_OF_RANGE = 'exhibition';

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

const row = (id = PID): Row => db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row;
const projectCount = (): number =>
  (db.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number }).c;

async function postProject(
  app: App,
  over: Record<string, unknown> = {},
  id = PID,
): Promise<{ statusCode: number; body: { error?: { code: string; userMessage: string } } }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      id,
      name: '主板块值域',
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-12-31',
      ...over,
    },
  });
  return {
    statusCode: res.statusCode,
    body: res.json() as { error?: { code: string; userMessage: string } },
  };
}

async function patch(
  app: App,
  payload: Record<string, unknown>,
  id = PID,
): Promise<{ statusCode: number; body: { error?: { code: string; userMessage: string } } }> {
  const res = await app.inject({ method: 'PATCH', url: `/api/projects/${id}`, payload });
  return {
    statusCode: res.statusCode,
    body: res.json() as { error?: { code: string; userMessage: string } },
  };
}

/** 除 domain / revision / updated_at（＋显式声明也变了的列）外，其余列必须逐一相等 */
function expectOnlyDomainChanged(before: Row, after: Row, alsoChanged: readonly string[] = []): void {
  for (const key of Object.keys(after)) {
    if (key === 'domain' || key === 'revision' || key === 'updated_at') continue;
    if (alsoChanged.includes(key)) continue;
    expect(after[key], `字段 ${key} 不应变化`).toEqual(before[key]);
  }
  expect(after.revision).toBe((before.revision as number) + 1);
}

/* ======================================================================================
 * 一、PATCH：合法值放行（正例）
 * ==================================================================================== */

describe('§domain 值域 · PATCH 合法值（正例）', () => {
  it('白名单里的每个值都能经 PATCH 落库，且**只有 domain 变**', async () => {
    const app = await buildServer();
    for (const d of USABLE) {
      await postProject(app, { id: `p_${d}` });
      const before = row(`p_${d}`);
      const res = await patch(app, { domain: d }, `p_${d}`);
      expect(res.statusCode, `合法值 ${d} 被拒：${res.body.error?.userMessage ?? ''}`).toBe(200);
      const after = row(`p_${d}`);
      expect(after.domain).toBe(d);
      expectOnlyDomainChanged(before, after);
    }
  });

  it('「不动 domain」的普通 PATCH 照常生效（零回归：不传 = 不变）', async () => {
    const app = await buildServer();
    await postProject(app, { domain: 'travel' });
    const before = row();

    const res = await patch(app, { name: '改名后', shortLabel: '改' });

    expect(res.statusCode).toBe(200);
    expect(row().name).toBe('改名后');
    expect(row().domain).toBe('travel');
    expectOnlyDomainChanged(before, row(), ['name', 'short_label']);
  });

  it('domain: null → 200 且落库 null（显式清除 = 回到读时回落，不是脏值）', async () => {
    const app = await buildServer();
    await postProject(app, { domain: 'software' });
    const before = row();

    const res = await patch(app, { domain: null });

    expect(res.statusCode).toBe(200);
    expect(row().domain).toBeNull();
    expectOnlyDomainChanged(before, row());
  });
});

/* ======================================================================================
 * 二、PATCH：越界值必须被拒（反例 —— 本段就是「必须会红」的那一段）
 * ==================================================================================== */

describe('§domain 值域 · PATCH 越界值必须 400 且零写入', () => {
  it('★ `{ domain: "exhibition" }` → 400 invalid_field，整行逐字未变', async () => {
    const app = await buildServer();
    await postProject(app, { domain: 'indoor' });
    const before = row();

    const res = await patch(app, { domain: OUT_OF_RANGE });

    expect(res.statusCode, '越界行业值不得落库（修复前这里是 200）').toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    // 文案三要素：哪个值不合法 + 合法值清单（用户照着改）
    expect(res.body.error?.userMessage).toContain(OUT_OF_RANGE);
    expect(res.body.error?.userMessage).toContain('indoor');
    expect(res.body.error?.userMessage).toContain('travel');
    // ★ 零写入：连 revision / updated_at 都不许动（PATCH 每条都会写这两列）
    expect(row()).toEqual(before);
    expect(row().domain).toBe('indoor');
  });

  it.each([
    ['拼写脏值', 'indoorx'],
    ['空串', ''],
    ['尾部空格', 'indoor '],
    ['大写', 'INDOOR'],
    ['纯空格', ' '],
    ['原型链键', '__proto__'],
    ['数字（非字符串）', 5],
    ['对象（非字符串）', {}],
    ['数组（非字符串）', []],
    ['布尔', true],
  ])('%s → 400 invalid_field 且整行未变', async (_label, value) => {
    const app = await buildServer();
    await postProject(app, { domain: 'indoor' });
    const before = row();

    const res = await patch(app, { domain: value });

    expect(res.statusCode, String(value)).toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(row()).toEqual(before);
  });

  it('越界值不会「顺带」改动同一次请求里的其它字段（校验在合并之前拦下）', async () => {
    const app = await buildServer();
    await postProject(app, { domain: 'indoor' });
    const before = row();

    const res = await patch(app, { domain: OUT_OF_RANGE, name: '不该生效的名字' });

    expect(res.statusCode).toBe(400);
    expect(row()).toEqual(before);
    expect(row().name).not.toBe('不该生效的名字');
  });
});

/* ======================================================================================
 * 三、POST：建项目路径同口径（同一字段不许两条口径）
 * ==================================================================================== */

describe('§domain 值域 · POST /api/projects 与 PATCH 同口径', () => {
  it('合法值 → 200 且落库', async () => {
    const app = await buildServer();
    const res = await postProject(app, { domain: 'landscape' });
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(row().domain).toBe('landscape');
  });

  it('不传 domain → 仍 200，落库 null（现状语义：服务端不猜主板块）', async () => {
    const app = await buildServer();
    const res = await postProject(app);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(row().domain).toBeNull();
  });

  it('domain: null → 200 且落库 null（与「不传」同效）', async () => {
    const app = await buildServer();
    const res = await postProject(app, { domain: null });
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(row().domain).toBeNull();
  });

  it('★ 越界值 → 400 invalid_field 且**零写入**（不许出现幽灵项目）', async () => {
    const app = await buildServer();
    const before = projectCount();

    const res = await postProject(app, { domain: OUT_OF_RANGE });

    expect(res.statusCode, '越界行业值不得落库（修复前这里是 200）').toBe(400);
    expect(res.body.error?.code).toBe('invalid_field');
    expect(res.body.error?.userMessage).toContain(OUT_OF_RANGE);
    expect(projectCount()).toBe(before);
    expect(db.prepare('SELECT * FROM projects WHERE id = ?').get(PID)).toBeUndefined();
  });
});

/* ======================================================================================
 * 四、★ 不变式：库里的 domain 一定在合法集内
 *
 * ── 为什么这条取代了「只有越界值的库 ⇒ 看板塌陷」那条夹具 ──
 * 拒收落地后，「库里只有越界值」这个状态**结构上不可能再产生**（两条写路都 400）。
 * 于是把断言前移到**成因**：无论怎么打，库里存的 domain 只可能是三种之一 ——
 * 合法值、null（未确认）、或老库留下的历史值。前两种由本段钉死；第三种是不可能的
 * 新增（本 spec 从**空库**起，因此段末的「⊆ 合法集 ∪ {null}」是强断言，不是弱化的）。
 * ==================================================================================== */

describe('★ 不变式：库里 domain ⊆ 合法集（拒收后的结构性保证）', () => {
  const DIRTY = [
    OUT_OF_RANGE,
    'nonsense',
    '',
    ' ',
    'indoor ',
    'INDOOR',
    'landscapex',
    '__proto__',
    'toString',
  ];

  it('逐个打非法值（PATCH + POST 都试一遍）→ 全部被拒，且库内 domain 集合 ⊆ 合法集', async () => {
    const app = await buildServer();
    // 先放一条合法项目（否则「集合 ⊆ 合法集」在空集上恒真 —— 那是假绿）
    await postProject(app, { domain: 'indoor' }, 'p_legal');

    for (const dirty of DIRTY) {
      const posted = await postProject(app, { domain: dirty }, `p_post_${DIRTY.indexOf(dirty)}`);
      expect(posted.statusCode, `POST 应拒 ${dirty}`).toBe(400);
      const patched = await patch(app, { domain: dirty }, 'p_legal');
      expect(patched.statusCode, `PATCH 应拒 ${dirty}`).toBe(400);
    }

    const rows = db.prepare('SELECT id, domain FROM projects').all() as Array<{
      id: string;
      domain: string | null;
    }>;
    expect(rows.length).toBeGreaterThan(0); // 非空，避免「空集恒真」
    for (const r of rows) {
      if (r.domain === null) continue; // null = 未确认，合法态
      expect(USABLE, `库里出现了越界行业值：${r.domain}（项目 ${r.id}）`).toContain(r.domain);
    }
    // 库规模没被非法请求改变（越界值一个都没落库）
    expect(projectCount()).toBe(1);
  });

  it('白名单本身非空且不含历史预留值（防止有人把它放宽成「啥都收」）', () => {
    expect(USABLE.length).toBeGreaterThan(0);
    expect(USABLE).not.toContain(OUT_OF_RANGE);
  });
});

/* ======================================================================================
 * 五、★ 白名单 ↔ 看板列派生的耦合（「为什么必须拒收」的技术理由）
 *
 * 这一段不钉「越界值 ⇒ 列塌陷」的行为（拒收之后那个状态不可达，钉它等于给未来的
 * deriveColumns 加固工作埋一颗假红），而是钉**正向耦合**：白名单里的每个值，
 * 看板都必须能派生出该行业的列。白名单一旦漂到「板认不出的值」上，这里当场红。
 * ==================================================================================== */

describe('★ 白名单与看板列派生同源', () => {
  const boardDomainKeys = getDomains().map(([key]) => key);

  it('白名单 ⊆ 看板派生时遍历的行业集合（否则「板认不出库里的值」）', () => {
    for (const d of USABLE) {
      expect(boardDomainKeys, `白名单里的 ${d} 不在 getDomains() 里 —— 看板派生不出它的列`).toContain(d);
    }
  });

  it('白名单里的每个值都能派生出 ≥1 个行业列', () => {
    for (const d of USABLE) {
      expect(getDomainColumns(d).length, `${d} 没有任何看板列定义`).toBeGreaterThan(0);
    }
  });

  it('正例：合法 domain 的项目经 PATCH 落库后，看板派生出的列**不只 todo**', async () => {
    const app = await buildServer();
    await postProject(app, { domain: 'landscape' });
    expect((await patch(app, { domain: 'landscape' })).statusCode).toBe(200);

    const p: Project = {
      id: PID,
      name: '景观项目',
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-01-01',
      plannedEndAt: '2026-12-31',
      coverColor: null,
      shortLabel: null,
      stagePresetKey: 'landscape_full',
      stageTemplateVersion: 3,
      scheduleBasis: ScheduleBasis.Calendar,
      domain: (row().domain as Project['domain']) ?? null,
      kind: 'human',
      ownerMemberId: null,
      status: ProjectStatus.Active,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const columns = deriveColumns([p]);

    expect(columns[0].key).toBe('todo');
    expect(columns.length, '合法主板块必须能派生出行业列（越界值正是一个都派生不出）').toBeGreaterThan(1);
  });
});
