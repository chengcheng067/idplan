/**
 * 服务端导入必须吃得下**客户端产出**的包（#15）· SQLite + Fastify inject。
 *
 * ── 本 spec 锁死什么 ──
 *  `projects.type` 是「v0.8 已下线、DDL 仍要求」的遗留列：`server/schema.sql` 里是
 *  `TEXT NOT NULL` **且无默认值**，而客户端自 v0.8 起**不再产出**它
 *  （`backup.service.ts` 的 zod 宽收 + `stage-fallback.ts` 的 `normalizeProjectRow`
 *  返回对象不含 `type`）。服务端两条写它的路，**建档路由一直写占位、导入路由没有**：
 *    ⇒ 任何客户端产出的包在导入时逐列原样插入 → `SQLITE_CONSTRAINT_NOTNULL:
 *      projects.type` → **整笔事务回滚**（导入全废；settings 一行没动）。
 *
 * ── 为什么既有的服务端导入 spec 看不见它（本文件存在的理由）──
 *  `tests/server.backup-import-taskno.spec.ts:187-197` 的夹具注释自己写着「现导出一份
 *  **真实备份**作为底包（projects/stages 形状**由导出端保证**）」⇒ 服务端导入面的夹具
 *  是**被测系统自己产的包**，**结构性不可能**覆盖「客户端产出的包」这一向；
 *  而本地往返 spec（`tests/backup.roundtrip.spec.ts`）走 Dexie、不查 NOT NULL。
 *  两条闸门叠加 ⇒ 这个洞长期隐形。故本文件**刻意引入不由被测系统产出的输入**：
 *    · ① 手写的、缺 `type` 的最小包（来源：人手，不是导出端）；
 *    · ② 客户端运行时工厂的真实产物 `buildDemoBackup()`（来源：客户端，不是服务端）；
 *    · ③ 本地（Dexie）形态**真实导出**的包（跨形态迁移，#16②）。
 *
 * ── 判别力（变异自证）──
 *  把 `meta.routes.ts` 导入循环里的 `type` 占位补偿去掉，①②③ 三条全部变红
 *  （`SQLITE_CONSTRAINT_NOTNULL` / 项目行数为 0），④ 仍绿（它锁的是「包内有值时不覆盖」）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { AGENT_TOKEN_ENV } from '../server/lib/agent-auth';
import { LEGACY_PROJECT_TYPE_PLACEHOLDER } from '../server/lib/legacy-project-type';
import { installFakeIndexedDB } from './setup';
import { pluginEnabledKey } from '../src/core/plugin/types';
import { buildDemoBackup, withHostPolicySettings } from '../src/core/demo/demoDataFactory';
import { BackupService, validateBackupJson } from '../src/core/services/backup.service';
import { createRepositories } from '../src/core/repositories';
import type { IRepositoryBundle } from '../src/core/repositories/interfaces';
import { ProjectService } from '../src/core/services/project.service';
import { emptyPackage } from './helpers/backup-fixture';

type Db = InstanceType<typeof Database>;
type App = ReturnType<typeof Fastify>;

const TOKEN = 'client-shaped-import-token-0123456789';
const H = { 'x-agent-token': TOKEN };
const AGENT_BOARD = pluginEnabledKey('agent-board');
const WEEKLY_REPORT = pluginEnabledKey('weekly-report');

let savedToken: string | undefined;
let db: Db;
let bundle: IRepositoryBundle;

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

const postImport = (app: App, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/backup/import', headers: H, payload: payload as object });

const readSettings = async (app: App): Promise<Record<string, string>> => {
  const rows = await readSettingsRaw(app);
  return Object.fromEntries(rows.map((r) => [r.key, r.valueJson]));
};

/** 原始 settings 行（含 updatedAt）—— 要喂给 `withHostPolicySettings` 的就是这个形状 */
const readSettingsRaw = async (
  app: App,
): Promise<Array<{ key: string; valueJson: string; updatedAt: string }>> => {
  const res = await app.inject({ method: 'GET', url: '/api/settings', headers: H });
  expect(res.statusCode).toBe(200);
  return res.json() as Array<{ key: string; valueJson: string; updatedAt: string }>;
};

/** 直读 projects 表（绕开服务端 DTO，直接看**落库的物理列**） */
const projectTypes = (): string[] =>
  (db.prepare('SELECT type FROM projects ORDER BY id').all() as Array<{ type: string }>).map((r) => r.type);

beforeAll(async () => {
  await installFakeIndexedDB();
});

beforeEach(async () => {
  savedToken = process.env[AGENT_TOKEN_ENV];
  process.env[AGENT_TOKEN_ENV] = TOKEN;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createDb(db);
  bundle = await createRepositories({ dataSource: 'local' });
  await bundle.admin?.replaceAllImport(emptyPackage());
});

afterEach(() => {
  if (savedToken === undefined) delete process.env[AGENT_TOKEN_ENV];
  else process.env[AGENT_TOKEN_ENV] = savedToken;
  db.close();
});

/** 一条**手写的、缺 `type`** 的项目行（客户端归一后的真实形状，见 normalizeProjectRow） */
const CLIENT_SHAPED_PROJECT = {
  id: 'p_handwritten',
  name: '手写项目',
  address: '',
  clientName: '',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: '2026-08-01',
  plannedEndAt: '2026-10-01',
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
};

function packageWith(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    meta: { app: 'changxia', schemaVersion: 3, exportedAt: '2026-01-01T00:00:00.000Z' },
    data: {
      projects: [],
      stages: [],
      tasks: [],
      itineraries: [],
      members: [],
      assignments: [],
      logs: [],
      contracts: [],
      settings: [],
      executions: [],
      executionAttempts: [],
      executionEvents: [],
      writebackProposals: [],
      ...over,
    },
  };
}

describe('服务端导入：客户端产出的包（#15 projects.type）', () => {
  it('① 手写的、缺 type 的最小包 ⇒ 导入 200、项目行落库、type 落占位', async () => {
    const app = await buildServer();
    const pkg = packageWith({
      projects: [CLIENT_SHAPED_PROJECT],
      settings: [{ key: AGENT_BOARD, valueJson: 'false', updatedAt: '2026-01-01T00:00:00.000Z' }],
    });
    // 前提断言：夹具必须**真的**不含 type，否则这条用例测不到点上
    expect('type' in CLIENT_SHAPED_PROJECT, '夹具不该带 type').toBe(false);

    const res = await postImport(app, pkg);
    expect(res.statusCode, `导入应成功，实际：${res.body}`).toBe(200);

    const rows = db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['p_handwritten']);
    expect(projectTypes()).toEqual([LEGACY_PROJECT_TYPE_PLACEHOLDER]);
    expect(await readSettings(app)).toHaveProperty(AGENT_BOARD, 'false');
  });

  it('② 客户端真实产物 buildDemoBackup() ⇒ 导入 200，且 plugin.enabled.* 仍在（第 4 条 demo 闸门）', async () => {
    const app = await buildServer();
    // 本机现状（与 demo 包取值**不同**，让「替换」可观测）
    for (const [k, v] of [
      [AGENT_BOARD, false],
      [WEEKLY_REPORT, true],
      ['restPolicy', { kind: 'single_off', anchorWeek: 7 }],
      ['currentMemberId', 'mem_admin'],
    ] as Array<[string, unknown]>) {
      const r = await app.inject({
        method: 'PUT',
        url: `/api/settings/${encodeURIComponent(k)}`,
        headers: H,
        payload: { valueJson: v },
      });
      expect(r.statusCode, `PUT ${k}`).toBe(200);
    }

    // 客户端运行时工厂 + 宿主策略合并 —— 调的就是产品那两个真函数
    const merged = withHostPolicySettings(buildDemoBackup(), await readSettingsRaw(app));
    // 应用真实做法：loadDemo 先 validateBackupJson，importAndReplace 落库的也是归一产物
    const res = await postImport(app, validateBackupJson(merged));
    expect(res.statusCode, `demo 包导入应成功，实际：${res.body}`).toBe(200);

    // 前提：demo 数据确实落库（否则下面「插件键仍在」会空转成假绿）
    const projCount = (db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n;
    expect(projCount, 'demo 的 5 个项目应落库').toBe(5);
    expect(projectTypes(), 'demo 项目行也应落占位以满足 NOT NULL').toEqual(
      Array(5).fill(LEGACY_PROJECT_TYPE_PLACEHOLDER),
    );

    const after = await readSettings(app);
    expect(after[AGENT_BOARD], '载入示例数据把插件键抹了').toBe('false');
    expect(after[WEEKLY_REPORT], '载入示例数据把插件键抹了').toBe('true');
    // 反向对照：demo 包自己的 settings 行确实覆盖了本机值 ⇒ 证明这次导入真做了整表替换
    expect(after['restPolicy']).toBe(
      merged.data.settings.find((s) => s.key === 'restPolicy')?.valueJson,
    );
    expect(after['currentMemberId']).toBe(JSON.stringify('demo_admin'));
  });

  it('③ #16②：本地（Dexie）形态**真实导出**的包 ⇒ 服务端能导入（跨形态迁移不断）', async () => {
    const app = await buildServer();
    const projects = new ProjectService({ projects: bundle.projects, bundle });
    const created = await projects.createManualProject({
      name: '跨形态项目',
      address: '',
      clientName: '',
      contractAmount: null,
      signedAt: null,
      plannedStartAt: '2026-08-01',
      plannedEndAt: '2026-10-01',
      coverColor: null,
    });
    await bundle.settings.set(AGENT_BOARD, false);

    const exported = await new BackupService(bundle).exportAll();
    // 前提断言（这条正是洞的入口）：客户端导出侧**不产** type
    expect(
      'type' in (exported.data.projects[0] as unknown as Record<string, unknown>),
      '客户端导出侧不该产 type（v0.8 已下线）',
    ).toBe(false);

    const res = await postImport(app, exported);
    expect(res.statusCode, `客户端包导入应成功，实际：${res.body}`).toBe(200);
    const rows = db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual([created.id]);
    expect(projectTypes()).toEqual([LEGACY_PROJECT_TYPE_PLACEHOLDER]);
  });

  it('④ 反向：包内**有**真实 type（服务端自产包）⇒ 原样落库，不被占位覆盖', async () => {
    const app = await buildServer();
    db.prepare(
      `INSERT INTO projects (id,name,type,address,client_name,planned_start_at,planned_end_at,status,revision,updated_at)
       VALUES ('p_srv','服务端项目','verycustom','','','2026-08-01','2026-10-01','active',1,'2026-08-01T00:00:00.000Z')`,
    ).run();

    const exported = (await app.inject({ method: 'GET', url: '/api/backup', headers: H })).json() as {
      data: { projects: Array<Record<string, unknown>> };
    };
    expect(exported.data.projects[0]?.type, '服务端导出侧应带真实 type').toBe('verycustom');

    const res = await postImport(app, exported);
    expect(res.statusCode).toBe(200);
    expect(projectTypes(), '包内有值时必须以包为准，不能被占位覆盖').toEqual(['verycustom']);
  });

  it('⑤ 反方向跨形态：服务端自产包（带 type）⇒ 客户端 local 能导入，实体侧 type 被剥离', async () => {
    const app = await buildServer();
    db.prepare(
      `INSERT INTO projects (id,name,type,address,client_name,planned_start_at,planned_end_at,status,revision,updated_at)
       VALUES ('p_srv','服务端项目','verycustom','','','2026-08-01','2026-10-01','active',1,'2026-08-01T00:00:00.000Z')`,
    ).run();
    const exported = (await app.inject({ method: 'GET', url: '/api/backup', headers: H })).json();

    // 服务端 → 客户端：zod 宽收 `type`、`normalizeProjectRow` 再把它剥掉 ⇒ 不因多出的列被拒
    await expect(new BackupService(bundle).importAndReplace(exported)).resolves.not.toThrow();
    const list = await bundle.projects.list({ status: 'all' });
    expect(list.map((p) => p.id)).toEqual(['p_srv']);
    // 确认「插件的 type」没有渗进客户端实体（v0.8 已下线，实体里不该出现）
    expect('type' in (list[0] as unknown as Record<string, unknown>)).toBe(false);
  });
});
