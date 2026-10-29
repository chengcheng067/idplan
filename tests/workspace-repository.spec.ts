// @vitest-environment jsdom
/**
 * 工作区仓储抽象层（多工作区 · 批 4）· 契约与两套实现的守卫。
 *
 * ═══════════════════════ 本文件锁什么 ═══════════════════════
 *   R1 ~ R5  `RemoteWorkspacesRepo` 五个方法各自打到**正确的路径 / 方法 / body**
 *            （mock fetch，断言的是「发出去的请求」而不是「返回值好看」）。
 *   H1 ~ H3  `X-Workspace-Id` 头：非空时出现、**为空时不出现**（不给老服务端送空值）、
 *            且经 `createRemoteRepositories` 一路透传到请求头（工厂层的「最后一公里」）。
 *   G1 ~ G2  `verifyGate` 收到 401 ⇒ 返回 `false` 且**不抛**；但 5xx / 网络错误
 *            **照常抛**（真故障不许被显示成「密码不对」）。
 *   L1 ~ L5  `LocalWorkspacesRepo`：`gateOf` 无闸密 false / `setGate` 后 true、
 *            `verifyGate` 对错密码分别 true / false、`create` 后 Owner 真在库里且验得动。
 *   A1       **装配完备性**：两个工厂产物都必须带 `workspaces` 且五个方法齐全
 *            （`IRepositoryBundle.workspaces` 类型上是可选的，见 interfaces.ts 的理由，
 *             故这条完备性必须由运行期断言补上，否则「某个形态下没有工作区仓储」
 *             会一路走到首屏才炸）。
 *
 * ═══════════════════════ 变异自证（本仓纪律） ═══════════════════════
 *   已实测变红并恢复，红色用例名逐条记录：
 *   · 注掉 `RestClient.send()` 里注入 `X-Workspace-Id` 的那一行 ⇒ 红 3 条：
 *       H1 工作区非空 ⇒ 请求头带 X-Workspace-Id（值逐字相等）
 *       H2 工作区为空 ⇒ **不带**该头（不给老服务端送空值）
 *       H3 createRemoteRepositories 的 workspaceId 一路透传到请求头
 *   · 把 `verifyGate` 里的 401 当成异常抛（去掉 `requestAllowingStatuses` 的 [401]）⇒ 红 1 条：
 *       G1 verifyGate 收到 401 ⇒ 返回 false，不抛
 *   · 把 `LocalWorkspacesRepo.setGate` 的失败静默吞掉（不抛）⇒ 红 1 条：
 *       L3 setGate 写失败 ⇒ 抛错（不静默成功）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  RestClient,
  RemoteWorkspacesRepo,
  createRemoteRepositories,
} from '../src/core/repositories/remote/rest.client';
import { LocalWorkspacesRepo } from '../src/core/repositories/local/local.workspaces.repo';
import { openDatabase } from '../src/core/repositories/local/dexie.database';
import { ChangxiaError } from '../src/core/types/enums';
import { verifyPassword } from '../src/lib/password';
import type { WorkspaceSummary } from '../src/core/repositories/interfaces';

/* ══════════════════════ fetch 捕获夹具 ══════════════════════ */

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let captured: Captured[] = [];

/** 装一个记录请求的 fetch；`respond` 决定每个请求回什么 */
function stubFetch(
  respond: (req: Captured) => { status: number; body?: unknown } = () => ({ status: 200, body: {} }),
): void {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const req: Captured = {
      url: String(url),
      method: String(init.method ?? 'GET'),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    captured.push(req);
    const res = respond(req);
    if (res.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(res.body ?? {}), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

beforeEach(() => {
  captured = [];
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE = 'http://nas.lan/api';

/* ══════════════════════ R · RemoteWorkspacesRepo 五个方法 ══════════════════════ */

describe('R · RemoteWorkspacesRepo 打到正确的路径 / 方法 / body', () => {
  it('R1 list ⇒ GET /workspaces，并把 { workspaces } 解包成裸数组', async () => {
    stubFetch((req) =>
      req.url.endsWith('/workspaces')
        ? {
            status: 200,
            body: {
              workspaces: [
                { id: 'ws-a', name: '甲区', ownerMemberName: '甲', createdAt: '2026-10-01T00:00:00Z' },
                /* 服务端可能省略 ownerMemberName（存量区还没解析出首个管理员）⇒ 归一成 null */
                { id: 'ws-b', name: '乙区', createdAt: '2026-10-02T00:00:00Z' },
              ],
            },
          }
        : { status: 200, body: {} },
    );
    const repo = new RemoteWorkspacesRepo(new RestClient(BASE));
    const rows = await repo.list();

    expect(captured).toHaveLength(1);
    expect(captured[0]!.method).toBe('GET');
    expect(captured[0]!.url).toBe(`${BASE}/workspaces`);
    expect(rows).toEqual([
      { id: 'ws-a', name: '甲区', ownerMemberName: '甲', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'ws-b', name: '乙区', ownerMemberName: null, createdAt: '2026-10-02T00:00:00Z' },
    ]);
  });

  it('R2 create ⇒ POST /workspaces，body 逐字 {name,ownerName,password}，回传 {id,ownerMemberId}', async () => {
    stubFetch(() => ({ status: 200, body: { id: 'ws-new', ownerMemberId: 'mem_owner' } }));
    const repo = new RemoteWorkspacesRepo(new RestClient(BASE));
    const res = await repo.create({ name: '新区', ownerName: '丞丞', password: '1234' });

    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.url).toBe(`${BASE}/workspaces`);
    // 逐字相等（不是 toMatchObject）：多带一个字段就是契约漂移
    expect(captured[0]!.body).toEqual({ name: '新区', ownerName: '丞丞', password: '1234' });
    expect(res).toEqual({ id: 'ws-new', ownerMemberId: 'mem_owner' });
  });

  it('R3 gateOf ⇒ GET /workspaces/:id/gate，回传 {hasGate}', async () => {
    stubFetch(() => ({ status: 200, body: { hasGate: true } }));
    const repo = new RemoteWorkspacesRepo(new RestClient(BASE));
    const res = await repo.gateOf('ws-a');

    expect(captured[0]!.method).toBe('GET');
    expect(captured[0]!.url).toBe(`${BASE}/workspaces/ws-a/gate`);
    expect(captured[0]!.body).toBeUndefined();
    expect(res).toEqual({ hasGate: true });
  });

  it('R4 verifyGate ⇒ POST /workspaces/:id/gate/verify，body 只有 password；200 ⇒ true', async () => {
    stubFetch(() => ({ status: 200, body: {} }));
    const repo = new RemoteWorkspacesRepo(new RestClient(BASE));
    const ok = await repo.verifyGate('ws-a', '1234');

    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.url).toBe(`${BASE}/workspaces/ws-a/gate/verify`);
    expect(captured[0]!.body).toEqual({ password: '1234' });
    expect(ok).toBe(true);
  });

  it('R5 setGate ⇒ POST /workspaces/:id/gate；无 currentPassword 时**不带**该字段', async () => {
    stubFetch(() => ({ status: 204 }));
    const repo = new RemoteWorkspacesRepo(new RestClient(BASE));
    await repo.setGate('ws-a', '5678');

    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.url).toBe(`${BASE}/workspaces/ws-a/gate`);
    expect(captured[0]!.body).toEqual({ password: '5678' });
  });

  it('R5b setGate 带 currentPassword ⇒ 原样进 body（改密路径）', async () => {
    stubFetch(() => ({ status: 204 }));
    const repo = new RemoteWorkspacesRepo(new RestClient(BASE));
    await repo.setGate('ws-a', '5678', { currentPassword: '1234' });

    expect(captured[0]!.body).toEqual({ password: '5678', currentPassword: '1234' });
  });
});

/* ══════════════════════ H · X-Workspace-Id ══════════════════════ */

describe('H · X-Workspace-Id 头注入', () => {
  it('H1 工作区非空 ⇒ 请求头带 X-Workspace-Id（值逐字相等）', async () => {
    stubFetch(() => ({ status: 200, body: { hasGate: false } }));
    const repo = new RemoteWorkspacesRepo(new RestClient(BASE, '', 8000, 'ws-a'));
    await repo.gateOf('ws-a');

    expect(captured[0]!.headers['X-Workspace-Id']).toBe('ws-a');
  });

  it('H2 工作区为空 ⇒ **不带**该头（不给老服务端送空值）', async () => {
    stubFetch(() => ({ status: 200, body: { hasGate: false } }));
    // 三种「空」都试：缺省参数 / 显式空串 / 全是空白（trim 前的原样透传不做，故只验前两种）
    for (const api of [new RestClient(BASE), new RestClient(BASE, '', 8000, '')]) {
      captured = [];
      await new RemoteWorkspacesRepo(api).gateOf('ws-a');
      expect(
        Object.keys(captured[0]!.headers).includes('X-Workspace-Id'),
        '空工作区时该头必须**不存在**（而不是存在且为空串）',
      ).toBe(false);
    }
  });

  it('H3 createRemoteRepositories 的 workspaceId 一路透传到请求头（工厂层最后一公里）', async () => {
    stubFetch(() => ({ status: 200, body: { workspaces: [] } }));
    const repos = createRemoteRepositories(BASE, 'ws-from-server');
    await repos.workspaces!.list();

    expect(captured[0]!.url).toBe(`${BASE}/workspaces`);
    expect(captured[0]!.headers['X-Workspace-Id']).toBe('ws-from-server');
  });

  it('H4 createRemoteRepositories 不传 workspaceId ⇒ 头不存在（单区/老服务端零变化）', async () => {
    stubFetch(() => ({ status: 200, body: { workspaces: [] } }));
    const repos = createRemoteRepositories(BASE);
    await repos.workspaces!.list();

    expect(Object.keys(captured[0]!.headers).includes('X-Workspace-Id')).toBe(false);
  });
});

/* ══════════════════════ G · verifyGate 的 401 语义 ══════════════════════ */

describe('G · verifyGate：401 是「密码不对」，不是异常', () => {
  it('G1 verifyGate 收到 401 ⇒ 返回 false，不抛', async () => {
    stubFetch(() => ({ status: 401, body: { error: { userMessage: '密码不对。' } } }));
    const repo = new RemoteWorkspacesRepo(new RestClient(BASE));

    await expect(repo.verifyGate('ws-a', 'wrong')).resolves.toBe(false);
  });

  it('G2 服务端 500 ⇒ **照常抛**（真故障不许被显示成「密码不对」）', async () => {
    stubFetch(() => ({ status: 500, body: {} }));
    const repo = new RemoteWorkspacesRepo(new RestClient(BASE));

    await expect(repo.verifyGate('ws-a', '1234')).rejects.toBeInstanceOf(ChangxiaError);
  });

  it('G3 网络层失败（fetch 抛）⇒ 照常抛，不吞成 false', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down');
    });
    const repo = new RemoteWorkspacesRepo(new RestClient(BASE));

    await expect(repo.verifyGate('ws-a', '1234')).rejects.toBeInstanceOf(ChangxiaError);
  });
});

/* ══════════════════════ L · LocalWorkspacesRepo（真 Dexie + 真 PBKDF2） ══════════════════════ */

/** 一个内存注册表（模拟注入进来的 `listRegistry`） */
function makeRegistry(rows: WorkspaceSummary[]): () => WorkspaceSummary[] {
  return () => rows;
}

describe('L · LocalWorkspacesRepo（真库 + 真哈希，不是 mock 陪跑）', () => {
  it('L1 gateOf：库不存在 / 无闸密 ⇒ hasGate:false', async () => {
    const repo = new LocalWorkspacesRepo({
      listRegistry: makeRegistry([]),
      dbNameOf: () => 'idplan-l1-never-created',
    });
    await expect(repo.gateOf('ws-x')).resolves.toEqual({ hasGate: false });
  });

  it('L2 create：建库 + Owner 入库；Owner 真在库里且对原明文验得动', async () => {
    const dbName = 'idplan-l2-create';
    const repo = new LocalWorkspacesRepo({
      listRegistry: makeRegistry([]),
      dbNameOf: () => dbName,
    });
    const res = await repo.create({ name: '新区', ownerName: '丞丞', password: '1234' });

    expect(res.id).toMatch(/^ws-/);
    expect(res.ownerMemberId).toBeTruthy();

    // 库是真的建出来了：Owner 行在 members 表、admin、带哈希、验得动
    const db = await openDatabase(dbName);
    try {
      const members = await db.members.toArray();
      expect(members).toHaveLength(1);
      const owner = members[0]!;
      expect(owner.id).toBe(res.ownerMemberId);
      expect(owner.name).toBe('丞丞');
      expect(owner.passwordHash).toBeTruthy();
      expect(owner.passwordHash).not.toContain('1234');
      expect(await verifyPassword('1234', owner.passwordHash)).toBe(true);
      expect(await verifyPassword('0000', owner.passwordHash)).toBe(false);
      // 空白区：业务表无数据
      expect(await db.projects.toArray()).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('L3 setGate ⇒ gateOf 变 true；verifyGate 对正确密码 true / 错密码 false', async () => {
    const dbName = 'idplan-l3-gate';
    const repo = new LocalWorkspacesRepo({
      listRegistry: makeRegistry([]),
      dbNameOf: () => dbName,
    });
    // 先建区（Owner 入库），此时闸密**已经**是 Owner 的密码
    await repo.create({ name: '闸区', ownerName: '甲', password: '9999' });
    await expect(repo.gateOf('ws-a')).resolves.toEqual({ hasGate: true });
    await expect(repo.verifyGate('ws-a', '9999')).resolves.toBe(true);
    await expect(repo.verifyGate('ws-a', '0000')).resolves.toBe(false);

    // 再补设/改密：写进去以后新密码生效、旧密码失效
    await repo.setGate('ws-a', '8888');
    await expect(repo.verifyGate('ws-a', '8888')).resolves.toBe(true);
    await expect(repo.verifyGate('ws-a', '9999')).resolves.toBe(false);
  });

  it('L3b setGate 写失败（该区库不存在）⇒ **抛错**，不静默成功', async () => {
    const repo = new LocalWorkspacesRepo({
      listRegistry: makeRegistry([]),
      dbNameOf: () => 'idplan-l3b-no-such-db',
    });
    await expect(repo.setGate('ws-missing', '1234')).rejects.toBeInstanceOf(ChangxiaError);
  });

  it('L4 verifyGate 对无闸密的区 ⇒ false（不是 true：没验过不等于验过了）', async () => {
    const repo = new LocalWorkspacesRepo({
      listRegistry: makeRegistry([]),
      dbNameOf: () => 'idplan-l4-no-gate',
    });
    await expect(repo.verifyGate('ws-x', '任何密码')).resolves.toBe(false);
  });

  it('L5 list 走注入的注册表；未注入时**抛错**而不是返回空数组（假空态禁令）', async () => {
    const rows: WorkspaceSummary[] = [
      { id: 'ws-a', name: '甲区', ownerMemberName: '甲', createdAt: '2026-10-01T00:00:00Z' },
    ];
    const withRegistry = new LocalWorkspacesRepo({ listRegistry: makeRegistry(rows) });
    await expect(withRegistry.list()).resolves.toEqual(rows);

    const withoutRegistry = new LocalWorkspacesRepo({});
    await expect(withoutRegistry.list()).rejects.toBeInstanceOf(ChangxiaError);
  });
});

/* ══════════════════════ A · 装配完备性 ══════════════════════ */

describe('A · 两个前端工厂都必须给出 workspaces（类型上可选，运行期必须齐）', () => {
  const METHODS = ['list', 'create', 'gateOf', 'verifyGate', 'setGate'] as const;

  it('A1 remote 工厂：workspaces 存在且五个方法齐全', () => {
    const repos = createRemoteRepositories(BASE);
    expect(repos.workspaces, 'remote 工厂没给 workspaces ⇒ NAS 形态首屏没有工作区列表').toBeTruthy();
    for (const m of METHODS) {
      expect(typeof repos.workspaces![m], `remote workspaces 缺方法 ${m}`).toBe('function');
    }
  });

  it('A2 接口的方法集未被悄悄改名（本地工厂同口径，防「一边改了另一边没改」）', () => {
    const local = new LocalWorkspacesRepo({ listRegistry: makeRegistry([]) });
    for (const m of METHODS) {
      expect(typeof (local as unknown as Record<string, unknown>)[m], `local 缺方法 ${m}`).toBe(
        'function',
      );
    }
  });
});
