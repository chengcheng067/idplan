/**
 * 备份恢复**不得静默重置插件开关**（v0.8.6 · 数据完整性）· SQLite + Fastify inject。
 *
 * ── 本 spec 锁死什么 ──
 *   `plugin.enabled.<id>`（键前缀单一出处：`src/core/plugin/types.ts` 的
 *   `pluginEnabledKey()`）是**能力域的启用态**，不是用户数据 —— 插件本体（含自装
 *   插件）装在设备侧（`userData/plugins/<id>/`，见 `electron/plugin-install.cjs`），
 *   **不在备份包里**。而「载入示例数据」造的 demo 包 settings 固定只有 2 行
 *   （`demoDataFactory`），异机 / 旧版包也可能没有这些键。
 *
 *   原先 `POST /api/backup/import`（与 `POST /api/settings/replace-all`）都是
 *   `DELETE FROM settings` **整表**清空后再插包内行 ⇒ 包内没有该族时，整族开关
 *   静默回落 `manifest.defaultEnabled`：用户手动开过的插件被关掉、侧栏入口消失，
 *   且**没有任何提示**。
 *
 *   选定语义：**包里有的以包为准，包里没有的保留本机**（只收窄 DELETE，不改 INSERT）。
 *
 * ── 为什么只靠 typecheck 抓不到 ──
 *   两个方向都完全合法：SQL 语法对、导入返回 `{ok:true}`、读取端拿不到键就按
 *   `defaultEnabled` 回落。只有**真的发一次导入、再真的读一次 settings** 才看得见。
 *   故本 spec 全部走端到端 HTTP（`app.inject`），不调仓储内部函数。
 *
 * ── 判别力（本 spec 的自证 / 修复前实测值）──
 *   修复前（HEAD 的 `meta.routes.ts`）用同一份夹具实测：
 *     · ①②③ 三条用例**全部变红**：导入后 `plugin.enabled.*` 行数 = 0（整族被抹）；
 *     · ④ 仍绿（同机往返本来就不缺键）—— 它是**防回归的护栏**，不是判别本 bug 的用例，
 *       作用是证明「保留本机」没有破坏 §2.15-① 的「导出→导入→再导出 逐行全等」。
 *
 * ── 与 local（Dexie）侧的关系 ──
 *   本 spec 只覆盖**服务端**通道。Dexie 侧 `LocalAdminRepository.replaceAllImport`
 *   的 `for (const name of ALL_TABLE_NAMES) await tableOf(name).clear()`
 *   （`src/core/repositories/local/local.admin.repo.ts`）是**同一类**整表清空，
 *   本轮**刻意未改**（超出本次改动面），已在此登记为同类缺口。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { createDb } from '../server/db';
import { registerMetaRoutes } from '../server/routes/meta.routes';
import { AGENT_TOKEN_ENV } from '../server/lib/agent-auth';
import { pluginEnabledKey } from '../src/core/plugin/types';

type Db = InstanceType<typeof Database>;
type App = ReturnType<typeof Fastify>;

const TOKEN = 'plugin-restore-token-0123456789';
const AUTH = { 'x-agent-token': TOKEN };

let savedToken: string | undefined;
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
  registerMetaRoutes(app, db);
  await app.ready();
  return app;
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

/* --------------------------------- 夹具工具 --------------------------------- */

async function putSetting(app: App, key: string, valueJson: unknown): Promise<void> {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/settings/${encodeURIComponent(key)}`,
    headers: AUTH,
    payload: { valueJson },
  });
  expect(res.statusCode, `PUT ${key} 失败`).toBe(200);
}

/** 读回 settings 全景（key → valueJson 原始串，便于逐字节比对） */
async function readSettings(app: App): Promise<Record<string, string>> {
  const res = await app.inject({ method: 'GET', url: '/api/settings', headers: AUTH });
  expect(res.statusCode, '读 settings 失败').toBe(200);
  const rows = res.json() as Array<{ key: string; valueJson: string }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.valueJson]));
}

/** 本机已有的 `plugin.enabled.*` 键集合 */
const pluginKeysIn = (settings: Record<string, string>): string[] =>
  Object.keys(settings)
    .filter((k) => k.startsWith(pluginEnabledKey('')))
    .sort();

/**
 * 导入一个**只带这些 settings 行**的备份包（其余表空）。
 * 形状照抄「载入示例数据」产出的 demo 包：settings 只有 2 行、无任何 plugin 行。
 */
async function importPackage(
  app: App,
  settingsRows: Array<{ key: string; valueJson: string; updatedAt: string }>,
): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/backup/import',
    headers: AUTH,
    payload: {
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
        settings: settingsRows,
        executions: [],
        executionAttempts: [],
        executionEvents: [],
        writebackProposals: [],
      },
    },
  });
  expect(res.statusCode, '导入失败').toBe(200);
}

const row = (key: string, value: unknown, updatedAt = '2026-01-01T00:00:00.000Z') => ({
  key,
  valueJson: JSON.stringify(value),
  updatedAt,
});

/** demo 包真实形状：settings 只有 2 行，无任何 plugin 行 */
const DEMO_SETTINGS = [row('currentMemberId', 'demo_admin'), row('restPolicy', { mode: 'single', restDays: [7] })];

/* ---------------------------------- 用例 ---------------------------------- */

describe('备份恢复保留本机插件启用态', () => {
  it('① 包内无插件键 ⇒ 本机 plugin.enabled.* 原样保留；非插件行照旧被包内行替换', async () => {
    const app = await buildServer();

    // 本机现状：手动关掉 Agent 看板、打开项目周报（两个方向都覆盖）
    await putSetting(app, pluginEnabledKey('agent-board'), false);
    await putSetting(app, pluginEnabledKey('weekly-report'), true);
    await putSetting(app, 'currentMemberId', 'local-admin');
    await putSetting(app, 'restPolicy', { mode: 'double', restDays: [6, 0] });

    const before = await readSettings(app);
    expect(pluginKeysIn(before)).toEqual([
      pluginEnabledKey('agent-board'),
      pluginEnabledKey('weekly-report'),
    ]);

    await importPackage(app, DEMO_SETTINGS);
    const after = await readSettings(app);

    // 核心断言（修复前实测：整族消失 ⇒ 这里会是 []）
    expect(pluginKeysIn(after)).toEqual([
      pluginEnabledKey('agent-board'),
      pluginEnabledKey('weekly-report'),
    ]);
    expect(after[pluginEnabledKey('agent-board')]).toBe('false');
    expect(after[pluginEnabledKey('weekly-report')]).toBe('true');

    // 反向对照：证明保护**没有**把整表删除一起废掉 —— 非插件行必须仍按包内内容替换
    expect(after['currentMemberId']).toBe(JSON.stringify('demo_admin'));
    expect(after['restPolicy']).toBe(JSON.stringify({ mode: 'single', restDays: [7] }));
  });

  it('② 前缀判定边界：只有 plugin.enabled.<id> 受保护，形近键一律照删', async () => {
    const app = await buildServer();

    await putSetting(app, pluginEnabledKey('agent-board'), false);
    // 前缀本身（空前 id：`readEnabledFromSettings` 会跳过它，保留无害）
    await putSetting(app, pluginEnabledKey(''), true);
    // 以下四条形近但**不是**该前缀，必须照旧被整表替换删掉
    await putSetting(app, 'plugin.enabled', true); // 缺尾点
    await putSetting(app, 'plugin.enabledX', true); // 尾字符不对
    await putSetting(app, 'xplugin.enabled.a', true); // 前缀不在开头
    await putSetting(app, 'plugin.disabled.a', true); // 另一个前缀
    await putSetting(app, 'currentMemberId', 'local-admin');

    await importPackage(app, []); // 空包：本次导入不提供任何 settings 行
    const after = await readSettings(app);

    expect(pluginKeysIn(after)).toEqual([pluginEnabledKey(''), pluginEnabledKey('agent-board')]);
    for (const gone of [
      'plugin.enabled',
      'plugin.enabledX',
      'xplugin.enabled.a',
      'plugin.disabled.a',
      'currentMemberId',
    ]) {
      expect(after, `${gone} 不该被保留`).not.toHaveProperty(gone);
    }
  });

  it('③ POST /api/settings/replace-all 与导入同口径', async () => {
    const app = await buildServer();

    await putSetting(app, pluginEnabledKey('agent-board'), false);
    await putSetting(app, pluginEnabledKey('weekly-report'), true);
    await putSetting(app, 'currentMemberId', 'local-admin');

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/replace-all',
      headers: AUTH,
      payload: { rows: [row('currentMemberId', 'member-x', '2026-02-02T00:00:00.000Z')] },
    });
    expect(res.statusCode).toBe(200);

    const after = await readSettings(app);
    expect(pluginKeysIn(after)).toEqual([
      pluginEnabledKey('agent-board'),
      pluginEnabledKey('weekly-report'),
    ]);
    // 反向对照：整表替换对非插件行仍然生效
    expect(after['currentMemberId']).toBe(JSON.stringify('member-x'));
  });

  it('④ 同机「导出 → 导入 → 再导出」settings 逐行全等（含 updatedAt）', async () => {
    const app = await buildServer();

    await putSetting(app, pluginEnabledKey('agent-board'), false);
    await putSetting(app, pluginEnabledKey('weekly-report'), true);
    await putSetting(app, 'currentMemberId', 'local-admin');
    await putSetting(app, 'restPolicy', { mode: 'double', restDays: [6, 0] });

    const sorted = (rows: Array<{ key: string }>) =>
      [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const exp1 = (await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH })).json() as {
      data: { settings: Array<{ key: string; valueJson: string; updatedAt: string }> };
    };
    // 同机自导的全量包**是带** plugin.enabled.* 的（导出侧 dumpTable('settings') 全表），
    // 忠实往返：包内值 == 本机值 ⇒ 既不该多行也不该少行、连 updatedAt 都不该动。
    expect(pluginKeysIn(Object.fromEntries(exp1.data.settings.map((s) => [s.key, s.valueJson])))).toEqual([
      pluginEnabledKey('agent-board'),
      pluginEnabledKey('weekly-report'),
    ]);

    await importPackage(app, exp1.data.settings);

    const exp2 = (await app.inject({ method: 'GET', url: '/api/backup', headers: AUTH })).json() as {
      data: { settings: Array<{ key: string; valueJson: string; updatedAt: string }> };
    };
    expect(JSON.stringify(sorted(exp2.data.settings))).toBe(JSON.stringify(sorted(exp1.data.settings)));
  });
});
