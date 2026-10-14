/**
 * 备份两条通道的**主板块（domain）值域门**验收 spec。
 *
 * ── 两条通道分别是 ──
 *   ① **浏览器侧**：`backup.service.ts::validateBackupJson()` 的 zod（本地 Dexie 形态只有这一道；
 *      remote 形态下它是落库前的第一道）。
 *   ② **服务端侧**：`POST /api/backup/import`（NAS → NAS 整机迁移通道，与 `/api/backup` 共用
 *      `x-agent-token`）。直连调用**不经**浏览器的 zod ⇒ 服务端必须自己有一道，
 *      否则「库里的 domain ⊆ 合法集」这条不变式只在浏览器形态成立。
 *
 * ── 口径（产品负责人 2026-10-14 拍板）：**拒收**，不归一化 ──
 * 归一化会静默改写用户数据、并抹掉「脏值从哪来」的线索。代价是「含脏值的老备份包导不进来」，
 * 已接受 —— 因此本 spec 的核心断言不是「失败」，而是**失败信息能让人自己修那份包**：
 * 第几条 + 项目 id + 实际值 + 允许的取值全表，一处都不能少。
 *
 * ── 为什么必须断言「库未改动」 ──
 * 服务端导入是「先 DELETE 全表、再 INSERT」的整库替换。校验若放在事务里，非法包会走到
 * 「库已清空」的中间态再回滚；用户看到的是「导入失败」而库里已经空了一半。故校验必须在
 * `db.transaction()` **之前** —— 这条断言就是钉它的位置。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { AGENT_TOKEN_ENV } from '../server/lib/agent-auth';
import { usableProjectDomains } from '../server/lib/project-domain';
import { validateBackupJson } from '../src/core/services/backup.service';
import { ChangxiaError } from '../src/core/types/enums';
import { emptyPackage } from './helpers/backup-fixture';

type Db = InstanceType<typeof Database>;
type App = ReturnType<typeof Fastify>;

const TOKEN = 'domain-whitelist-token-0123456789';
const H = { 'x-agent-token': TOKEN };
/** 典型越界值：在 `StageTemplateDomain` 类型里，却不在 `stage-library.json` 的 domains 里 */
const OUT_OF_RANGE = 'exhibition';

const USABLE = usableProjectDomains();

let savedToken: string | undefined;
let db: Db;

async function buildServer(): Promise<App> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) => {
    void reply.status(err.statusCode ?? 500).send({
      error: {
        code: String((err as { code?: string }).code ?? 'internal'),
        userMessage: String((err as { message?: string }).message ?? '服务器内部错误'),
      },
    });
  });
  registerMetaRoutes(app, db);
  await app.ready();
  return app;
}

/** 一条**客户端归一后形状**的项目行（与 `normalizeProjectRow` 的产物同形） */
const project = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'p1',
  name: '项目 1',
  address: '',
  clientName: '',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: '2026-01-01',
  plannedEndAt: '2026-12-31',
  coverColor: null,
  shortLabel: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: 'calendar',
  domain: null,
  kind: 'human',
  ownerMemberId: null,
  status: 'active',
  revision: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

/** 带 n 条项目的最小包（第 i 条的 id 是 `p<i>`，1 基） */
function pkgWith(projects: Array<Record<string, unknown>>): Record<string, unknown> {
  return { ...emptyPackage(), data: { ...emptyPackage().data, projects } };
}

beforeEach(() => {
  savedToken = process.env[AGENT_TOKEN_ENV];
  process.env[AGENT_TOKEN_ENV] = TOKEN;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createDb(db);
});

afterEach(() => {
  if (savedToken === undefined) delete process.env[AGENT_TOKEN_ENV];
  else process.env[AGENT_TOKEN_ENV] = savedToken;
  db.close();
});

const domainOf = (id: string): string | null =>
  (db.prepare('SELECT domain FROM projects WHERE id = ?').get(id) as { domain: string | null } | undefined)
    ?.domain ?? null;

const projectIds = (): string[] =>
  (db.prepare('SELECT id FROM projects ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);

const postImport = (app: App, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/backup/import', headers: H, payload: payload as object });

/* ======================================================================================
 * 一、浏览器侧 zod（`validateBackupJson`）
 * ==================================================================================== */

describe('① 浏览器侧 · validateBackupJson 的主板块值域', () => {
  it('白名单里的每个值 + null + 缺键 → 全部通过（正例，不许误伤）', () => {
    for (const d of USABLE) {
      expect(() => validateBackupJson(pkgWith([project({ domain: d })])), d).not.toThrow();
    }
    expect(() => validateBackupJson(pkgWith([project({ domain: null })]))).not.toThrow();
    const noDomain = project();
    delete noDomain.domain;
    expect(() => validateBackupJson(pkgWith([noDomain]))).not.toThrow();
  });

  it('★ 第 3 条项目的 domain 越界 → 拒绝，且信息定位到「第 3 条 + id + 值 + 合法值全表」', () => {
    const pkg = pkgWith([
      project({ id: 'p1', domain: 'indoor' }),
      project({ id: 'p2', domain: null }),
      project({ id: 'p3', domain: OUT_OF_RANGE }),
      project({ id: 'p4', domain: 'travel' }),
    ]);

    let caught: unknown;
    try {
      validateBackupJson(pkg);
    } catch (e) {
      caught = e;
    }

    expect(caught, '越界 domain 必须被拒（修复前这里是宽收通过）').toBeInstanceOf(ChangxiaError);
    const msg = (caught as Error).message;
    expect(msg).toContain('第 3 条'); // ← 用户能数得出来的 1 基序号
    expect(msg).toContain('p3'); // ← 项目 id（比下标更好用）
    expect(msg).toContain(OUT_OF_RANGE); // ← 实际值
    expect(msg).toContain('indoor'); // ← 允许的取值（用户照着改）
    expect(msg).toContain('travel');
    expect(msg).toContain(`共 ${USABLE.length} 个`);
  });

  it('★ 多条越界 → 一次性全部报出（不必「修一条、再导一次」）', () => {
    const pkg = pkgWith([
      project({ id: 'p1', domain: OUT_OF_RANGE }),
      project({ id: 'p2', domain: 'indoor' }),
      project({ id: 'p3', domain: 'nonsense' }),
    ]);

    let caught: unknown;
    try {
      validateBackupJson(pkg);
    } catch (e) {
      caught = e;
    }

    const msg = (caught as Error).message;
    expect(msg).toContain('第 1 条');
    expect(msg).toContain('p1');
    expect(msg).toContain('第 3 条');
    expect(msg).toContain('p3');
    expect(msg).toContain('nonsense');
    // 合法的那条不得被点名
    expect(msg).not.toContain('第 2 条');
  });

  it('非字符串 domain（结构错）同样被拒（走字段级形状校验）', () => {
    expect(() => validateBackupJson(pkgWith([project({ domain: 123 })]))).toThrow();
    expect(() => validateBackupJson(pkgWith([project({ domain: {} })]))).toThrow();
  });

  it('零回归：整包往返仍逐字保真（合法 domain / null 不被改写）', () => {
    const pkg = pkgWith([
      project({ id: 'p1', domain: 'software' }),
      project({ id: 'p2', domain: null }),
    ]);
    const out = validateBackupJson(pkg);
    expect(out.data.projects[0]!.domain).toBe('software');
    expect(out.data.projects[1]!.domain).toBeNull(); // null = 「未确认」，不得被猜成 indoor
  });
});

/* ======================================================================================
 * 二、服务端侧（`POST /api/backup/import`）
 * ==================================================================================== */

describe('② 服务端侧 · POST /api/backup/import 的主板块值域', () => {
  it('合法包 → 200 ok（正例，不许误伤迁移通道）', async () => {
    const app = await buildServer();
    const res = await postImport(app, pkgWith([project({ id: 'p1', domain: 'landscape' })]));
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
    expect(domainOf('p1')).toBe('landscape');
  });

  it('★ 越界包 → 400，信息含「第 2 条」+ id + 值 + 合法值全表，且**库未改动**', async () => {
    const app = await buildServer();
    // 先用一份合法包把库填上（证明「拒绝」不顺手清库）
    expect((await postImport(app, pkgWith([project({ id: 'p_keep', domain: 'indoor' })]))).statusCode).toBe(200);
    expect(projectIds()).toEqual(['p_keep']);

    const res = await postImport(
      app,
      pkgWith([
        project({ id: 'p1', domain: 'travel' }),
        project({ id: 'p2', domain: OUT_OF_RANGE }),
      ]),
    );

    expect(res.statusCode, '服务端必须自己拒（直连迁移通道不经浏览器 zod）').toBe(400);
    const body = res.json() as { error: { code: string; userMessage: string } };
    expect(body.error.code).toBe('invalid_field');
    expect(body.error.userMessage).toContain('第 2 条');
    expect(body.error.userMessage).toContain('p2');
    expect(body.error.userMessage).toContain(OUT_OF_RANGE);
    expect(body.error.userMessage).toContain('indoor');
    expect(body.error.userMessage).toContain(`共 ${USABLE.length} 个`);

    // ★ 库未改动：原项目还在，非法包里的行一条都没进来
    expect(projectIds()).toEqual(['p_keep']);
    expect(domainOf('p_keep')).toBe('indoor');
  });

  it('★ 多条越界 → 全部点名（含 1 基序号与 id）', async () => {
    const app = await buildServer();
    const res = await postImport(
      app,
      pkgWith([
        project({ id: 'a', domain: 'nonsense' }),
        project({ id: 'b', domain: 'indoor' }),
        project({ id: 'c', domain: OUT_OF_RANGE }),
      ]),
    );
    expect(res.statusCode).toBe(400);
    const msg = (res.json() as { error: { userMessage: string } }).error.userMessage;
    expect(msg).toContain('第 1 条');
    expect(msg).toContain('id=a');
    expect(msg).toContain('第 3 条');
    expect(msg).toContain('id=c');
    expect(msg).not.toContain('第 2 条');
    expect(projectIds()).toEqual([]);
  });

  it('domain 缺键 / null 的包照常导入（老备份兼容：null = 未确认）', async () => {
    const app = await buildServer();
    const noDomain = project({ id: 'p_nokey' });
    delete noDomain.domain;
    const res = await postImport(
      app,
      pkgWith([noDomain, project({ id: 'p_null', domain: null })]),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(projectIds()).toEqual(['p_nokey', 'p_null']);
    expect(domainOf('p_nokey')).toBeNull();
    expect(domainOf('p_null')).toBeNull();
  });

  it('★ 不变式：连续灌 9 个合法值 + 一轮非法值后，库里的 domain 仍未越界', async () => {
    const app = await buildServer();
    const legal = USABLE.map((d, i) => project({ id: `p_${i}`, domain: d }));
    expect((await postImport(app, pkgWith(legal))).statusCode).toBe(200);

    for (const dirty of [OUT_OF_RANGE, 'nonsense', '', 'INDOOR', 'indoor ']) {
      const res = await postImport(app, pkgWith([project({ id: 'p_bad', domain: dirty })]));
      expect(res.statusCode, dirty).toBe(400);
    }

    const rows = db.prepare('SELECT id, domain FROM projects').all() as Array<{
      id: string;
      domain: string | null;
    }>;
    expect(rows.length).toBe(USABLE.length);
    for (const r of rows) {
      if (r.domain === null) continue;
      expect(USABLE, `库里出现了越界行业值：${r.domain}`).toContain(r.domain);
    }
  });
});
