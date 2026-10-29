// @vitest-environment node
/**
 * 多工作区 · NAS 版 · **批 3 五端点**的 HTTP 契约（`server/routes/workspaces.routes.ts`）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 本文件守什么
 * ══════════════════════════════════════════════════════════════════════
 * 契约面（与 `src/core/repositories/remote/rest.client.ts` 的 `RemoteWorkspacesRepo` 逐条对应，
 * 改这里就是改前端契约，必须同批改那边）：
 *
 *   · `GET  /api/workspaces`                 → `{ workspaces: [{id,name,ownerMemberName,createdAt}] }`
 *   · `POST /api/workspaces`                 → 201 `{ id, ownerMemberId }`
 *   · `GET  /api/workspaces/:id/gate`         → `{ hasGate }`
 *   · `POST /api/workspaces/:id/gate/verify`  → 200 真 / **401 假**
 *   · `POST /api/workspaces/:id/gate`         → 204
 *
 * 每条端点都覆盖「正常路径 + 错误路径」，另有五组跨端点的**串味**断言：
 *   A 不存在的区一律 404（**绝不回落 ws-default**）
 *   B 建区后 `ws-*.db` 真的存在、Owner 能 verify、闸密与成员密码是同一个哈希
 *   C 跨区 gate 不串（A 区的密码不能开 B 区）
 *   D 改闸密**必须**校验旧密（无鉴权端点上这是唯一的防线）
 *   E 八条取词键都真的被用到（防「键加了没人用」）
 *
 * ── 隔离口径 ──
 * 每个用例独立 `mkdtempSync` 数据目录 + `CHANGXIA_DB` 指过去，`afterEach` 关句柄删目录
 * （与 `tests/server.workspaces.spec.ts` 同款；注册表句柄缓存按文件路径做键，天然不串）。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registerWorkspaceRoutes } from '../server/routes/workspaces.routes';
import { createDb, openDb } from '../server/db';
import {
  DEFAULT_WORKSPACE_ID,
  WorkspaceCreateError,
  closeAllWorkspaceDbs,
  findWorkspace,
  openRegistry,
  seedDefaultWorkspace,
} from '../server/workspace-registry';
import { hashPassword, verifyPassword } from '../server/lib/password-hash';
import { SERVER_ERROR_TEXT } from '../server/lib/server-error-text';

let app: FastifyInstance;
let dataDir: string;
let savedEnv: string | undefined;

/** 取错误体（形状 `{error:{code,userMessage,messageKey,...}}`） */
function errBody(res: { json: <T>() => T }): {
  error: { code: string; userMessage: string; messageKey?: string };
} {
  return res.json<{ error: { code: string; userMessage: string; messageKey?: string } }>();
}

beforeEach(async () => {
  savedEnv = process.env.CHANGXIA_DB;
  dataDir = mkdtempSync(join(tmpdir(), 'changxia-ws-api-'));
  process.env.CHANGXIA_DB = dataDir;
  closeAllWorkspaceDbs();
  seedDefaultWorkspace(openRegistry());

  app = Fastify({ logger: false });
  registerWorkspaceRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  closeAllWorkspaceDbs();
  if (savedEnv === undefined) delete process.env.CHANGXIA_DB;
  else process.env.CHANGXIA_DB = savedEnv;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* Windows 偶发占用：不影响后续用例（各自新目录） */
  }
});

/* ══════════════════════ ① GET /api/workspaces ══════════════════════ */

describe('① GET /api/workspaces', () => {
  it('★ 首发：外层包 {workspaces:[...]}，恰一条 ws-default、ownerMemberName 为 null', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ workspaces: Array<Record<string, unknown>> }>();
    // 外层包装是契约的一部分：前端 list() 只在这里解包一次
    expect(Array.isArray(body.workspaces)).toBe(true);
    expect(body.workspaces).toHaveLength(1);
    const ws = body.workspaces[0]!;
    expect(ws.id).toBe(DEFAULT_WORKSPACE_ID);
    expect(ws.name).toBe('未命名工作室');
    // 存量区没有 admin 成员 ⇒ 派生为 null（不是空串、不是 undefined）
    expect(ws.ownerMemberName).toBeNull();
    expect(typeof ws.createdAt).toBe('string');
    // 绝不外泄的字段：db_file 是本机路径，属于服务端内部结构
    expect('dbFile' in ws).toBe(false);
    expect('db_file' in ws).toBe(false);
    expect('gatePasswordHash' in ws).toBe(false);
  });

  it('★ 建区后 Owner 名按「首个 active+admin」派生（不是读注册表 owner_member_id）', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '甲公司', ownerName: '张经理', password: 'pw-1234' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/workspaces' });
    const list = res.json<{ workspaces: Array<{ name: string; ownerMemberName: string | null }> }>().workspaces;
    const co = list.find((w) => w.name === '甲公司')!;
    expect(co.ownerMemberName).toBe('张经理');
  });

  it('★ admin 被停用后 Owner 派生回 null（判据是 active=1，不是「有条 admin 记录」）', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '乙', ownerName: '李四', password: 'pw-1234' },
    });
    const id = created.json<{ id: string }>().id;

    const biz = new Database(join(dataDir, `${id}.db`));
    biz.prepare('UPDATE members SET active = 0').run();
    biz.close();
    closeAllWorkspaceDbs(); // 让句柄缓存失效，否则读到旧连接

    const res = await app.inject({ method: 'GET', url: '/api/workspaces' });
    const ws = res.json<{ workspaces: Array<{ id: string; ownerMemberName: string | null }> }>().workspaces.find(
      (w) => w.id === id,
    )!;
    expect(ws.ownerMemberName).toBeNull();
  });

  it('★ 多个区按创建时间先后排列（与注册表 listWorkspaces 同序）', async () => {
    for (const n of ['A', 'B', 'C']) {
      await app.inject({
        method: 'POST',
        url: '/api/workspaces',
        payload: { name: n, ownerName: `${n}的Owner`, password: 'pw-1234' },
      });
    }
    const res = await app.inject({ method: 'GET', url: '/api/workspaces' });
    const names = res.json<{ workspaces: Array<{ name: string }> }>().workspaces.map((w) => w.name);
    expect(names).toEqual(['未命名工作室', 'A', 'B', 'C']);
  });
});

/* ══════════════════════ ② POST /api/workspaces ══════════════════════ */

describe('② POST /api/workspaces（建区）', () => {
  it('★ 正常：201 + {id, ownerMemberId}（只有这两个字段）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '丙公司', ownerName: '王五', password: 'pw-1234' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(['id', 'ownerMemberId']);
    expect(String(body.id).startsWith('ws-')).toBe(true);
    expect(typeof body.ownerMemberId).toBe('string');
  });

  it('★ 建区后 ws-<id>.db 真的存在，且 Owner 能通过 /api/members 的 scrypt 口径验密', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '丁', ownerName: '赵六', password: 'pw-5678' },
    });
    const { id, ownerMemberId } = res.json<{ id: string; ownerMemberId: string }>();

    expect(existsSync(join(dataDir, `${id}.db`))).toBe(true);

    // 直接读该区库：Owner 是 admin、密码能被同一套 scrypt 验过
    const biz = new Database(join(dataDir, `${id}.db`), { readonly: true });
    const owner = biz.prepare('SELECT * FROM members WHERE id = ?').get(ownerMemberId) as {
      role_kind: string;
      role: string;
      password_hash: string | null;
    };
    biz.close();
    expect(owner.role_kind).toBe('admin');
    expect(owner.role).toBe('负责人');
    expect(verifyPassword('pw-5678', owner.password_hash)).toBe(true);
    expect(verifyPassword('pw-5679', owner.password_hash)).toBe(false);

    // 闸密 = Owner 密码（同一个密码只存一份哈希）
    const registry = openRegistry();
    expect(findWorkspace(id, registry)!.gate_password_hash).toBe(owner.password_hash);
    expect(findWorkspace(id, registry)!.owner_member_id).toBe(ownerMemberId);
  });

  it('★ 缺 name / ownerName / password ⇒ 400 + 各自的取词键（三条互不串）', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ownerName: 'x', password: 'pw-1234' }, 'serverErr.workspace.nameRequired'],
      [{ name: 'x', password: 'pw-1234' }, 'serverErr.workspace.ownerNameRequired'],
      [{ name: 'x', ownerName: 'y' }, 'serverErr.workspace.passwordRequired'],
      // 纯空白也拒（不是「有字段就行」）
      [{ name: '   ', ownerName: 'y', password: 'pw-1234' }, 'serverErr.workspace.nameRequired'],
    ];
    for (const [payload, key] of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/workspaces', payload });
      expect(res.statusCode, `payload=${JSON.stringify(payload)}`).toBe(400);
      const body = errBody(res);
      expect(body.error.messageKey, `payload=${JSON.stringify(payload)}`).toBe(key);
      // ★ 用户面文案必须来自载荷表，**绝不能**是内部英文诊断串
      expect(body.error.userMessage).toBe(SERVER_ERROR_TEXT[key as keyof typeof SERVER_ERROR_TEXT]);
      expect(body.error.userMessage).not.toMatch(/required|failed|refusing/i);
    }
    // 一条都没建出来（失败不落半成品）
    const list = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(list.json<{ workspaces: unknown[] }>().workspaces).toHaveLength(1);
  });

  it('★ 密码短于 4 位 ⇒ 400（与桌面版 UI 下限同值）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: 'x', ownerName: 'y', password: 'abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(errBody(res).error.messageKey).toBe('serverErr.workspace.passwordRequired');
  });

  it('★ 落盘冲突 ⇒ 400 + createFailed/dbFileConflict 键（不是 500，也不外泄路径）', async () => {
    // 注入注册表写失败（此时库文件与 Owner 已落盘 ⇒ 走回滚路径）
    const registry = openRegistry();
    registry.exec(
      `CREATE TRIGGER inject_ws_api_fail BEFORE INSERT ON workspaces
       WHEN NEW.id <> 'ws-default'
       BEGIN SELECT RAISE(ABORT, 'injected'); END;`,
    );
    const before = readdirSync(dataDir).filter((n) => n.startsWith('ws-')).sort();
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '戊', ownerName: '己', password: 'pw-1234' },
    });
    registry.exec('DROP TRIGGER inject_ws_api_fail');

    expect(res.statusCode).toBe(400);
    const body = errBody(res);
    expect(body.error.messageKey).toBe('serverErr.workspace.createFailed');
    // ★ 不外泄容器内绝对路径
    expect(body.error.userMessage).not.toContain(dataDir);
    expect(body.error.userMessage).not.toContain('.db');
    // 回滚干净
    expect(readdirSync(dataDir).filter((n) => n.startsWith('ws-')).sort()).toEqual(before);
    const list = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(list.json<{ workspaces: unknown[] }>().workspaces).toHaveLength(1);
  });
});

/* ══════════════════════ ③ GET /api/workspaces/:id/gate ══════════════════════ */

describe('③ GET /api/workspaces/:id/gate', () => {
  it('★ 存量区（未设闸密）⇒ {hasGate:false}', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ hasGate: boolean }>().hasGate).toBe(false);
  });

  it('★ 建区后（建区即设密）⇒ {hasGate:true}', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '庚', ownerName: '辛', password: 'pw-1234' },
    });
    const id = created.json<{ id: string }>().id;
    const res = await app.inject({ method: 'GET', url: `/api/workspaces/${id}/gate` });
    expect(res.json<{ hasGate: boolean }>().hasGate).toBe(true);
  });

  it('★ 不存在的区 ⇒ 404（不是 {hasGate:false} —— 那会让调用方以为「这区存在但没密码」）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces/ws-nope/gate' });
    expect(res.statusCode).toBe(404);
    expect(errBody(res).error.messageKey).toBe('serverErr.workspace.notFound');
  });
});

/* ══════════════════════ ④ POST .../gate/verify ══════════════════════ */

describe('④ POST /api/workspaces/:id/gate/verify', () => {
  it('★ 密码对 ⇒ 200；密码错 ⇒ 401（不是 400/500，前端只把 401 吞成 false）', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '壬', ownerName: '癸', password: 'pw-1234' },
    });
    const id = created.json<{ id: string }>().id;

    const ok = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/gate/verify`,
      payload: { password: 'pw-1234' },
    });
    expect(ok.statusCode).toBe(200);

    for (const wrong of ['pw-12345', 'PW-1234', '', ' ']) {
      const bad = await app.inject({
        method: 'POST',
        url: `/api/workspaces/${id}/gate/verify`,
        payload: { password: wrong },
      });
      expect(bad.statusCode, `password=${JSON.stringify(wrong)}`).toBe(401);
    }
  });

  it('★ 缺 password 字段 ⇒ 401（与密码错同形，不泄露「这里需要密码」）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate/verify`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('★ 存量区（无闸密）⇒ 任何密码都 401（hasGate:false 时前端应先去设密，不走这条路）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate/verify`,
      payload: { password: 'anything' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('★ 不存在的区 ⇒ 404（不是 401 —— 401 会让前端以为「密码输错了」）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/ws-nope/gate/verify',
      payload: { password: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('★ 跨区不串：A 区的密码开不了 B 区', async () => {
    const a = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: 'A', ownerName: 'a', password: 'pw-aaaa' },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: 'B', ownerName: 'b', password: 'pw-bbbb' },
    });
    const idA = a.json<{ id: string }>().id;
    const idB = b.json<{ id: string }>().id;

    const aPwOnB = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${idB}/gate/verify`,
      payload: { password: 'pw-aaaa' },
    });
    expect(aPwOnB.statusCode, 'A 的密码居然开了 B 的门').toBe(401);

    const bPwOnA = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${idA}/gate/verify`,
      payload: { password: 'pw-bbbb' },
    });
    expect(bPwOnA.statusCode).toBe(401);

    // 各自的密码各自能开
    expect(
      (await app.inject({ method: 'POST', url: `/api/workspaces/${idA}/gate/verify`, payload: { password: 'pw-aaaa' } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: `/api/workspaces/${idB}/gate/verify`, payload: { password: 'pw-bbbb' } }))
        .statusCode,
    ).toBe(200);
  });
});

/* ══════════════════════ ⑤ POST /api/workspaces/:id/gate ══════════════════════ */

describe('⑤ POST /api/workspaces/:id/gate（设/改闸密）', () => {
  it('★ 存量区首次设密 ⇒ 204，之后 hasGate 为 true 且新密码能验过', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
      payload: { password: 'first-pw' },
    });
    expect(res.statusCode).toBe(204);
    // 204 必须无响应体
    expect(res.body).toBe('');

    expect(
      (await app.inject({ method: 'GET', url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate` })).json<{
        hasGate: boolean;
      }>().hasGate,
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate/verify`,
          payload: { password: 'first-pw' },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('★ 已有闸密时**必须**给 currentPassword（不给 ⇒ 401 + gateCurrentRequired）', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
      payload: { password: 'first-pw' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
      payload: { password: 'second-pw' },
    });
    expect(res.statusCode).toBe(401);
    expect(errBody(res).error.messageKey).toBe('serverErr.workspace.gateCurrentRequired');
    // 旧密码仍然有效（改密被拒，闸密没被动过）
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate/verify`,
          payload: { password: 'first-pw' },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('★ currentPassword 错 ⇒ 401 + gateCurrentWrong，且闸密未变', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
      payload: { password: 'first-pw' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
      payload: { password: 'second-pw', currentPassword: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(errBody(res).error.messageKey).toBe('serverErr.workspace.gateCurrentWrong');
    // 新密码**不该**生效
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate/verify`,
          payload: { password: 'second-pw' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('★ currentPassword 对 ⇒ 204，新密码生效、旧密码失效', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
      payload: { password: 'first-pw' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
      payload: { password: 'second-pw', currentPassword: 'first-pw' },
    });
    expect(res.statusCode).toBe(204);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate/verify`,
          payload: { password: 'second-pw' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate/verify`,
          payload: { password: 'first-pw' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('★ 新密码短于 4 位 ⇒ 400（且闸密未变）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
      payload: { password: 'ab' },
    });
    expect(res.statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate` })).json<{
        hasGate: boolean;
      }>().hasGate,
    ).toBe(false);
  });

  it('★ 不存在的区 ⇒ 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/ws-nope/gate',
      payload: { password: 'pw-1234' },
    });
    expect(res.statusCode).toBe(404);
  });

  /*
   * ★★ 语义反转（批 3.5 · 老板拍板「闸密 = 管理员密码，改就一起改」）★★
   *
   * 本条在批 3 时断言的是「改闸密**不动**成员密码」（当时的设计是把闸密与成员密码
   * **解耦**：闸密守进区、成员密码守发言）。产品负责人否掉了那个设计 ——
   * 用户的心智模型只有一个密码，改完闸密就会认为登录密码也变了，解耦的真实后果是
   * 「下次用成员身份登录时发现『我明明改过密码』」，且完全静默。
   *
   * 故本条断言**反转**为：「改闸密**同步**更新所有 active admin 的成员密码」。
   * ⚠️ 这是**产品决策变更**，不是测试放松：断言强度没降（从「必须不变」变成
   *    「必须变成新值，且必须是同一个哈希字面量」），只是钉的语义换了一边。
   */
  it('★ 改闸密**同步**更新 active admin 的成员密码（批 3.5 语义反转）', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '子', ownerName: '丑', password: 'owner-pw' },
    });
    const { id, ownerMemberId } = created.json<{ id: string; ownerMemberId: string }>();

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/gate`,
      payload: { password: 'gate-pw', currentPassword: 'owner-pw' },
    });
    expect(res.statusCode).toBe(204);

    const biz = new Database(join(dataDir, `${id}.db`), { readonly: true });
    const owner = biz.prepare('SELECT password_hash FROM members WHERE id = ?').get(ownerMemberId) as {
      password_hash: string | null;
    };
    biz.close();

    // ① 新密码能验过、旧密码失效
    expect(verifyPassword('gate-pw', owner.password_hash)).toBe(true);
    expect(verifyPassword('owner-pw', owner.password_hash)).toBe(false);
    // ② ★ 与注册表闸密是**同一个哈希字面量**（不是重新算一遍的同密码哈希 ——
    //    不同盐会造成「闸密能进、成员密码不过」）
    const gateHash = openRegistry()
      .prepare('SELECT gate_password_hash FROM workspaces WHERE id = ?')
      .get(id) as { gate_password_hash: string };
    expect(owner.password_hash).toBe(gateHash.gate_password_hash);
  });
});

/* ══════════════════════ ⑤b 闸密↔管理员密码同步（批 3.5） ══════════════════════ */

describe('⑤b 改闸密 ⇒ 同步 active admin 的成员密码（批 3.5 · 老板拍板）', () => {
  /** 在读到的成员表里插一条（便于造「多个管理员 / 混合成员」场景） */
  function addMember(
    wsId: string,
    row: { id: string; name: string; roleKind: 'admin' | 'member'; password?: string; active?: 0 | 1 },
  ): void {
    const biz = new Database(join(dataDir, `${wsId}.db`));
    biz
      .prepare(
        `INSERT INTO members (id, name, role, contact, avatar_color, active, role_kind, password_hash,
           actor_kind, agent_kind, revision, updated_at)
         VALUES (?, ?, '', NULL, '#3D6B5B', ?, ?, ?, 'human', NULL, 1, ?)`,
      )
      .run(
        row.id,
        row.name,
        row.active ?? 1,
        row.roleKind,
        row.password === undefined ? null : hashForTest(row.password),
        new Date().toISOString(),
      );
    biz.close();
    // 句柄缓存里有旧连接 ⇒ 清掉，让后续 openWorkspaceDb 重开读到新行
    closeAllWorkspaceDbs();
  }

  /** 与 server/lib/password-hash.ts 同源的哈希（测试侧直接 import，不另写一份实现） */
  function hashForTest(plain: string): string {
    return hashPassword(plain);
  }

  /** 直接读某区全体成员的 (id, role_kind, active, password_hash, revision) */
  function membersOf(wsId: string): Array<{
    id: string;
    role_kind: string;
    active: number;
    password_hash: string | null;
    revision: number;
  }> {
    // ★ 库文件名**必须从注册表取**：`ws-default` 的库是 `changxia.db`，不是 `ws-default.db`。
    //   硬编码 `${wsId}.db` 对新建区碰巧成立，对存量区会「打不开数据库文件」。
    const row = findWorkspace(wsId, openRegistry())!;
    const biz = new Database(row.db_file, { readonly: true });
    const rows = biz
      .prepare('SELECT id, role_kind, active, password_hash, revision FROM members ORDER BY id')
      .all() as Array<{
      id: string;
      role_kind: string;
      active: number;
      password_hash: string | null;
      revision: number;
    }>;
    biz.close();
    return rows;
  }

  it('★ ① 改闸密后**所有** active admin 的密码都变，且都是同一个哈希字面量', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '多管', ownerName: '管理员甲', password: 'pw-orig' },
    });
    const id = created.json<{ id: string }>().id;

    // 再造两个管理员（各自不同的旧密码）+ 一条已停用的管理员（不该被改）
    addMember(id, { id: 'adm2', name: '管理员乙', roleKind: 'admin', password: 'pw-乙' });
    addMember(id, { id: 'adm3', name: '管理员丙', roleKind: 'admin', password: 'pw-丙' });
    addMember(id, { id: 'adm-off', name: '已停用管理员', roleKind: 'admin', password: 'pw-off', active: 0 });

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/gate`,
      payload: { password: 'pw-new', currentPassword: 'pw-orig' },
    });
    expect(res.statusCode).toBe(204);

    const rows = membersOf(id);
    const admins = rows.filter((r) => r.role_kind === 'admin' && r.active === 1);
    const gateHash = (
      openRegistry().prepare('SELECT gate_password_hash FROM workspaces WHERE id = ?').get(id) as {
        gate_password_hash: string;
      }
    ).gate_password_hash;

    // 三个 active admin 全被更新，且哈希字面量**完全相同**（硬要求 ①：scrypt 只算一次）
    expect(admins).toHaveLength(3);
    for (const a of admins) {
      expect(a.password_hash, `${a.id} 的密码没同步`).toBe(gateHash);
      expect(verifyPassword('pw-new', a.password_hash), `${a.id} 用新密码验不过`).toBe(true);
    }
    // 各自的旧密码**全部**失效（不是只有 Owner 的失效）
    for (const [, oldPw] of [
      ['管理员甲', 'pw-orig'],
      ['管理员乙', 'pw-乙'],
      ['管理员丙', 'pw-丙'],
    ] as const) {
      expect(verifyPassword(oldPw, admins[0]!.password_hash), `旧密码 ${oldPw} 仍然能过`).toBe(false);
    }

    // ★ 已停用的管理员**不在同步范围**（WHERE 里是 active = 1）
    const off = rows.find((r) => r.id === 'adm-off')!;
    expect(verifyPassword('pw-off', off.password_hash), '已停用管理员的密码不该被改').toBe(true);
  });

  it('★ ② role_kind=member 的成员密码**一个都不许动**', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '混合', ownerName: '管', password: 'pw-orig' },
    });
    const id = created.json<{ id: string }>().id;

    addMember(id, { id: 'm1', name: '成员一', roleKind: 'member', password: 'member-pw-1' });
    addMember(id, { id: 'm2', name: '成员二', roleKind: 'member', password: 'member-pw-2' });
    addMember(id, { id: 'm3', name: '无密成员', roleKind: 'member' }); // 本来就没密码

    const before = membersOf(id).filter((r) => r.role_kind === 'member');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/gate`,
      payload: { password: 'pw-new', currentPassword: 'pw-orig' },
    });
    expect(res.statusCode).toBe(204);

    const after = membersOf(id).filter((r) => r.role_kind === 'member');
    // 逐行比对（不只是「数量对了」）—— 连 NULL 都不许变成哈希
    expect(after.map((r) => [r.id, r.password_hash])).toEqual(before.map((r) => [r.id, r.password_hash]));
    // 且成员密码确实还是原来的
    expect(verifyPassword('member-pw-1', after.find((r) => r.id === 'm1')!.password_hash)).toBe(true);
    expect(verifyPassword('member-pw-2', after.find((r) => r.id === 'm2')!.password_hash)).toBe(true);
    expect(after.find((r) => r.id === 'm3')!.password_hash).toBeNull();
    // 反证：用新闸密去验成员，必须不过（说明没被同步）
    expect(verifyPassword('pw-new', after.find((r) => r.id === 'm1')!.password_hash)).toBe(false);
  });

  it('★ ③ 注册表写入失败 ⇒ admin 密码**逐个**回滚到各自的旧值（不是统一写回闸密）', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '回滚', ownerName: '管甲', password: 'pw-a' },
    });
    const id = created.json<{ id: string }>().id;
    // 第二个管理员**有自己的不同旧密码** —— 这条正是「统一写回闸密」会毁掉的数据
    addMember(id, { id: 'adm2', name: '管乙', roleKind: 'admin', password: 'pw-b' });

    const beforeRows = membersOf(id);
    const registry = openRegistry();
    // 注入：注册表 UPDATE 失败（BEFORE UPDATE 触发器 ABORT）。此时成员密码已经改了。
    registry.exec(
      `CREATE TRIGGER inject_gate_update_fail BEFORE UPDATE OF gate_password_hash ON workspaces
       BEGIN SELECT RAISE(ABORT, 'injected gate update failure'); END;`,
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/gate`,
      payload: { password: 'pw-new', currentPassword: 'pw-a' },
    });
    registry.exec('DROP TRIGGER inject_gate_update_fail');

    // 基础设施故障 ⇒ 500（不是 400：用户没填错任何东西）
    expect(res.statusCode).toBe(500);

    const afterRows = membersOf(id);
    // ★ 逐行回滚到**各自的**旧哈希（不是统一变成同一个值）
    expect(afterRows.map((r) => [r.id, r.password_hash])).toEqual(beforeRows.map((r) => [r.id, r.password_hash]));
    // 两个管理员各自的旧密码都能验过 —— 若实现是「统一写回闸密」，adm2 的 pw-b 会失效
    for (const r of afterRows.filter((x) => x.role_kind === 'admin')) {
      const oldPw = r.id === 'adm2' ? 'pw-b' : 'pw-a';
      expect(verifyPassword(oldPw, r.password_hash), `${r.id} 的旧密码 ${oldPw} 没被正确还原`).toBe(true);
      expect(verifyPassword('pw-new', r.password_hash), `${r.id} 的新密码没被回滚掉`).toBe(false);
    }
    // ★ revision 必须回到快照原值（`revision = revision + 1` 的回滚若写成 `- 1`，
    //   在并发/重复执行下会漂；这里钉「回滚是恢复快照值，不是做减法」）
    // ⚠️ 先断言 revision 真的是数字：否则两边都是 undefined 会变成假绿
    expect(beforeRows.every((r) => typeof r.revision === 'number')).toBe(true);
    expect(afterRows.map((r) => [r.id, r.revision])).toEqual(beforeRows.map((r) => [r.id, r.revision]));
    // 注册表列回到旧值
    const gate = (
      openRegistry().prepare('SELECT gate_password_hash FROM workspaces WHERE id = ?').get(id) as {
        gate_password_hash: string;
      }
    ).gate_password_hash;
    expect(verifyPassword('pw-a', gate)).toBe(true);
    expect(verifyPassword('pw-new', gate)).toBe(false);
  });

  it('★ ④ 首次设密（老区 ws-default，gate 为 NULL）同样同步现有 active admin', async () => {
    // ws-default 是存量区：建区流程没走过，闸密为 NULL，也没有 admin
    const before = openRegistry().prepare('SELECT gate_password_hash FROM workspaces WHERE id = ?').get(
      DEFAULT_WORKSPACE_ID,
    ) as { gate_password_hash: string | null };
    expect(before.gate_password_hash).toBeNull();

    // 手动给 ws-default 的业务库塞一个管理员（模拟老库里有管理员但没闸密）
    const biz = openDb(join(dataDir, 'changxia.db'));
    createDb(biz);
    biz
      .prepare(
        `INSERT INTO members (id, name, role, contact, avatar_color, active, role_kind, password_hash,
           actor_kind, agent_kind, revision, updated_at)
         VALUES ('old-admin','老管理员','负责人',NULL,'#3D6B5B',1,'admin',?, 'human',NULL,1,?)`,
      )
      .run(hashForTest('old-pw'), new Date().toISOString());
    biz.close();
    closeAllWorkspaceDbs();

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
      payload: { password: 'first-gate-pw' }, // 首次设密**不需要** currentPassword
    });
    expect(res.statusCode).toBe(204);

    const gate = (
      openRegistry().prepare('SELECT gate_password_hash FROM workspaces WHERE id = ?').get(DEFAULT_WORKSPACE_ID) as {
        gate_password_hash: string | null;
      }
    ).gate_password_hash;
    expect(gate).not.toBeNull();

    const admin = membersOf(DEFAULT_WORKSPACE_ID).find((r) => r.id === 'old-admin')!;
    // 老管理员的密码被同步成新闸密，且字面量相同
    expect(admin.password_hash).toBe(gate);
    expect(verifyPassword('first-gate-pw', admin.password_hash)).toBe(true);
    expect(verifyPassword('old-pw', admin.password_hash)).toBe(false);
  });

  it('★ ⑤ 该区没有任何 active admin ⇒ **不失败**，只更新闸密、跳过成员同步', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: { name: '无管', ownerName: '将停用', password: 'pw-orig' },
    });
    const id = created.json<{ id: string }>().id;

    // 把唯一的管理员停用 ⇒ active admin 归零
    const biz = new Database(join(dataDir, `${id}.db`));
    biz.prepare("UPDATE members SET active = 0 WHERE role_kind = 'admin'").run();
    biz.close();
    closeAllWorkspaceDbs();

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${id}/gate`,
      payload: { password: 'pw-new', currentPassword: 'pw-orig' },
    });

    // ★ 关键：不能因为「区里没管理员」就把进区的门锁死 —— 那是用户彻底进不去的形态
    expect(res.statusCode, '无 active admin 时改闸密不该失败').toBe(204);

    // 闸密确实更新了
    const gate = (
      openRegistry().prepare('SELECT gate_password_hash FROM workspaces WHERE id = ?').get(id) as {
        gate_password_hash: string;
      }
    ).gate_password_hash;
    expect(verifyPassword('pw-new', gate)).toBe(true);

    // 停用的管理员密码一个没动（不在 active=1 范围内）
    const off = membersOf(id).find((r) => r.role_kind === 'admin')!;
    expect(off.active).toBe(0);
    expect(verifyPassword('pw-orig', off.password_hash), '停用管理员的密码不该被改').toBe(true);
  });
});


/* ══════════════════════ ⑥ 八条键都被用到（防死键） ══════════════════════ */

describe('⑥ 八条 workspace 键都真的被路由用到（防「键加了没人用」）', () => {
  it('★ 每个 serverErr.workspace.* 键都在 http 响应里可达', async () => {
    // 逐条用一个真实请求把它打出来。键 → 触发方式（缺一条就说明键是死的）
    const triggers: Array<[string, () => Promise<{ json: <T>() => unknown }>]> = [
      ['serverErr.workspace.nameRequired', () => app.inject({ method: 'POST', url: '/api/workspaces', payload: { ownerName: 'x', password: 'pw-1234' } })],
      ['serverErr.workspace.ownerNameRequired', () => app.inject({ method: 'POST', url: '/api/workspaces', payload: { name: 'x', password: 'pw-1234' } })],
      ['serverErr.workspace.passwordRequired', () => app.inject({ method: 'POST', url: '/api/workspaces', payload: { name: 'x', ownerName: 'y' } })],
      ['serverErr.workspace.notFound', () => app.inject({ method: 'GET', url: '/api/workspaces/ws-nope/gate' })],
    ];
    for (const [key, run] of triggers) {
      const res = await run();
      expect(errBody(res as never).error.messageKey, `键 ${key} 没被任何路径用到`).toBe(key);
    }

    // 剩下四条需要前置状态（已有闸密 / 注入落盘失败）
    await app.inject({
      method: 'POST',
      url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
      payload: { password: 'set-pw' },
    });
    expect(
      errBody(
        await app.inject({
          method: 'POST',
          url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
          payload: { password: 'other-pw' },
        }),
      ).error.messageKey,
    ).toBe('serverErr.workspace.gateCurrentRequired');
    expect(
      errBody(
        await app.inject({
          method: 'POST',
          url: `/api/workspaces/${DEFAULT_WORKSPACE_ID}/gate`,
          payload: { password: 'other-pw', currentPassword: 'wrong' },
        }),
      ).error.messageKey,
    ).toBe('serverErr.workspace.gateCurrentWrong');

    const registry = openRegistry();
    registry.exec(
      `CREATE TRIGGER inject_key_probe BEFORE INSERT ON workspaces
       WHEN NEW.id <> 'ws-default' BEGIN SELECT RAISE(ABORT, 'x'); END;`,
    );
    expect(
      errBody(
        await app.inject({
          method: 'POST',
          url: '/api/workspaces',
          payload: { name: 'n', ownerName: 'o', password: 'pw-1234' },
        }),
      ).error.messageKey,
    ).toBe('serverErr.workspace.createFailed');
    registry.exec('DROP TRIGGER inject_key_probe');

    // 第八条 dbFileConflict：把 randomUUID 钉死成一个「目标文件已被占用」的 id，
    // 走**真实 HTTP** 触发（不是「键存在就算」—— 那种断言会让键死了也绿）。
    const uuid = '99999999-8888-4777-8666-555555555555';
    writeFileSync(join(dataDir, `ws-${uuid}.db`), 'occupied');
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(uuid as never);
    try {
      expect(
        errBody(
          await app.inject({
            method: 'POST',
            url: '/api/workspaces',
            payload: { name: 'n', ownerName: 'o', password: 'pw-1234' },
          }),
        ).error.messageKey,
      ).toBe('serverErr.workspace.dbFileConflict');
    } finally {
      spy.mockRestore();
    }
  });
});

/* ══════════════════════ ⑦ 两个「隐雷」守卫 ══════════════════════ */

describe('⑦ 守卫：field→键映射的唯一出处 + active 列类型对齐', () => {
  it('★ WorkspaceCreateError 的 field 取值域恰是映射表的键（少一档 = 运行时 key undefined）', () => {
    // 直接构造五个 field 的错误，确认映射表都能给出**存在**的键。
    // 为什么这条必要：`CREATE_ERROR_KEYS[err.field]` 是运行时取值，若将来给
    // WorkspaceCreateError 加了第六个 field 而忘了补映射，TypeScript **不会报错**
    // （Record 的键在遍历处是 string 化的），运行时就会 send 一个 userMessage=undefined
    // 的错误体 —— 用户看到空白提示。这里把「加档必须补映射」变成提交期红灯。
    const fields: Array<import('../server/workspace-registry').WorkspaceCreateError['field']> = [
      'name',
      'ownerName',
      'password',
      'dbFile',
      'storage',
    ];
    for (const f of fields) {
      const err = new WorkspaceCreateError(f, 'probe');
      expect(err.field).toBe(f);
    }
    // 五个 field 各对应一个**不同的**键（不许两档共用一个键，那样就没法区分了）
    const src = readFileSync(join(__dirname, '..', 'server', 'routes', 'workspaces.routes.ts'), 'utf-8');
    // 只切出 `CREATE_ERROR_KEYS` 那个对象字面量的内部，避免匹配到别处同名字样
    const block = /const CREATE_ERROR_KEYS[^{]*\{([\s\S]*?)\n\};/.exec(src)?.[1];
    expect(block, '找不到 CREATE_ERROR_KEYS 映射表 —— 它被改名或挪走了？').toBeTruthy();

    const keys = fields.map((f) => {
      // ★ 行首锚定：不能用 `\b${f}:` —— `ownerName:` 与 `name:` 之间存在词边界，
      //   `\bname:` 会先命中 `ownerName:` 里的那截，导致 name 与 ownerName 拿到同一个键。
      const re = new RegExp(String.raw`(?:^|\n)\s*${f}:\s*'(serverErr\.workspace\.[A-Za-z]+)'`);
      return re.exec(block!)?.[1];
    });
    expect(keys.filter((k) => k !== undefined)).toHaveLength(fields.length);
    // 两档共用同一个键 ⇒ 用户看到「工作区名称不能为空」但实际缺的是 Owner 名
    expect(new Set(keys).size).toBe(fields.length);
  });

  it('★ members.active 在 schema 里是 INTEGER（判据与列类型对齐，不是字符串列）', () => {
    /*
     * ── 这条守的是什么（订正过一次，如实记下）──
     * `deriveOwnerMemberName()` 的条件是 `active = 1 AND role_kind = 'admin'`。
     *
     * ⚠️ 我最初在注释里写「若把列改成 TEXT，`active = 1` 会静默查不到任何管理员」——
     *    **这句是错的**，已实测推翻（见下）：SQLite 对 INTEGER 列做**列亲和性转换**，
     *    在 INTEGER 列上写 `active = '1'` 与 `active = 1` **结果完全等价**（都命中，
     *    返回同一行）。所以「字符串字面量 vs INTEGER 列」在 SQLite 里**不会**造成静默失配。
     *
     * 那这条守什么？守**两件仍然会出事的事**：
     *   ① 列类型漂移：若 `members.active` 真被改成 TEXT 且写入方存 `'true'`/`'yes'`，
     *      那么 `active = 1` 与 `active = '1'` **都会**查不到 —— 这才是真正的失配形态。
     *      ⇒ 断言列声明类型是 INTEGER，本判据的语义前提（0/1 两值）才成立。
     *   ② 源码写法与列类型对齐：本仓的既有口径是「INTEGER 列写整数」（`members.routes.ts`
     *      的 `active: b.active ? 1 : 0`、`rowToMember` 的 `Boolean(r.active)`）。
     *      写成 `'1'` 虽然今天等价，但它会让下一个人以为这列是文本，进而写出
     *      `active = 'true'` 这类**真正**不匹配的东西。⇒ 钉住写法，防的是「错误示范」。
     */
    const biz = openDb(join(dataDir, 'typecheck.db'));
    createDb(biz);
    const col = (biz.prepare('PRAGMA table_info(members)').all() as Array<{ name: string; type: string }>).find(
      (c) => c.name === 'active',
    )!;
    expect(col.type, 'members.active 换了类型 ⇒ deriveOwnerMemberName 的 active = 1 判据要重新推导').toBe(
      'INTEGER',
    );
    biz.close();

    // 源码写法对齐（`active = '1'` 今天等价，但它是错误示范 —— 详见上面 ②）
    const src = readFileSync(join(__dirname, '..', 'server', 'workspace-registry.ts'), 'utf-8');
    expect(src).toContain('active = 1');
    expect(src).not.toContain("active = '1'");
  });
});
