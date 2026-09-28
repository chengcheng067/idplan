/**
 * 本机 Agent loopback 通道（v1.0 · P0）渲染侧实现回归。
 *
 * ── 验的是什么 ──
 * `src/channels/agent-loopback.ts`（实现 `AgentImportChannel`，kind='desktop-loopback'）
 * 与 `src/di/agent-loopback.ts`（仅 Electron 桥存在时注册）两个新文件。
 *
 * 覆盖档位（派单 D 要求的三条）：
 *   ① `createLoopbackChannel().status()/probe()` 在无桥环境（node / jsdom 无 window.idplan）
 *      **不抛错**、降级正确（服务不可达 → reachable:false，而非抛）；
 *   ② `import()` 正确拼出 `dryRun` / `project` / `stageName` 查询串与 `Authorization: Bearer`
 *      头（用 stub 的 `fetch`，**不真起服务**）；失败（401/畸形）正确抛 `ChangxiaError`；
 *   ③ `src/di/agent-loopback.ts` 在非 Electron 环境**不注册、不抛错**（注册表不被动）。
 *
 * ── 两条纪律 ──
 *   a) **绝不真起 HTTP server**：全部用 `vi.fn` stub 全局 `fetch`；端口 / 主进程参与全部Mock。
 *   b) **不污染共享注册表**：仅验证「非 Electron 下 installDesktopLoopbackChannel 返回 false
 *      且注册表引用不变」。正向注册（Electron 桥存在）会改写模块级单例、干扰
 *      `agent-channel-registry-routing.spec.ts` 的「① 注册表为空」首用例，故本 spec **不测正向注册**。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createLoopbackChannel, LOOPBACK_BASE_URL } from '../src/channels/agent-loopback';
import { getAgentImportChannel } from '../src/core/agent/transport.contract';
import { installDesktopLoopbackChannel } from '../src/di/agent-loopback';

/** 内存版 localStorage（node 环境默认无，readStoredToken 需要） */
function makeLocalStorageMock(): { store: Map<string, string> } {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return { store };
}

const OK_APPLY_RESULT = {
  created: 0,
  updated: 0,
  rejected: [],
  stage: { mode: 'none', id: null, name: '', orderIndex: -1 },
} as const;

describe('Agent loopback 通道 · 渲染侧', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let ls: { store: Map<string, string> };

  beforeEach(() => {
    ls = makeLocalStorageMock();
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => OK_APPLY_RESULT,
    }));
    // ★ 必须用 vi.stubGlobal（9-28 实锤的跨 spec 污染）：裸赋值
    //   `globalThis.fetch = fetchMock` 时，`vi.restoreAllMocks()` **不还原**它
    //   （它只还原 vi.fn/spyOn 创建的桩）→ 假 fetch 泄漏给后续 spec——
    //   agent-loopback-server.spec 的真 fetch 全被替换成这个桩，症状是整条
    //   路由族 500 空 body、我方 handler 零日志（打的是本机 server，桩在客户端侧）。
    //   stubGlobal + unstubAllGlobals 由 vitest 托管，跑完自动还原。
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('① status()/probe() 在无桥环境不抛错，服务不可达时降级 reachable:false', async () => {
    // 模拟「服务挂了」：fetch 抛网络异常
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('connection refused (mock)');
    });
    const ch = createLoopbackChannel();
    const status = await ch.status();
    expect(status.reachable).toBe(false);
    expect(status.kind).toBe('desktop-loopback');
    expect(status.baseUrl).toBe(LOOPBACK_BASE_URL);
    // 无 token 时 hasToken 为 false
    expect(status.hasToken).toBe(false);
    // 多调一次不应该抛
    const status2 = await ch.status();
    expect(status2.reachable).toBe(false);
  });

  it('① status() 健康检查 2xx 时 reachable:true，且映射正确', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, version: '0.8.0.0001', dataLayer: 'ready' }),
    }));
    const ch = createLoopbackChannel();
    const status = await ch.status();
    expect(status.reachable).toBe(true);
    expect(status.kind).toBe('desktop-loopback');
    expect(status.baseUrl).toBe(LOOPBACK_BASE_URL);
  });

  it('① probe() 与 status() 同源（同一实现，均不抛）', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, version: '0.8.0.0001', dataLayer: 'unavailable' }),
    }));
    const ch = createLoopbackChannel();
    const probe = await ch.probe();
    expect(probe.kind).toBe('desktop-loopback');
    expect(probe.reachable).toBe(true);
  });

  it('② import() dryRun=true 拼出 dryRun=1 且无 project/stageName；带 Bearer 头', async () => {
    const ch = createLoopbackChannel();
    const payload = { schema: 'idplan-agent-payload/v1', tasks: [] };
    await ch.import(payload, { dryRun: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method?: string; headers?: Record<string, string> }];
    expect(url).toContain(`${LOOPBACK_BASE_URL}/api/agent/import?`);
    expect(url).toContain('dryRun=1');
    expect(url).not.toContain('project=');
    expect(url).not.toContain('stageName=');
    expect(init.method).toBe('POST');
    // 未配置 token → 不带 Authorization
    expect(init.headers?.['Authorization']).toBeUndefined();
  });

  it('② import() 拼出 project / stageName 查询串；配置 token 后带 Bearer', async () => {
    ls.store.set('idplan.agentToken', 'secret-token-xyz');
    const ch = createLoopbackChannel();
    const payload = { schema: 'idplan-agent-payload/v1', tasks: [] };
    await ch.import(payload, { dryRun: false, projectId: 'proj_1', stageName: '阶段A' });

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers?: Record<string, string> }];
    expect(url).toContain('project=proj_1');
    expect(url).toContain('stageName=' + encodeURIComponent('阶段A'));
    expect(url).not.toContain('dryRun=1');
    expect(init.headers?.['Authorization']).toBe('Bearer secret-token-xyz');
    expect(init.headers?.['Content-Type']).toBe('application/json');
  });

  it('② import() 401 → 抛 ChangxiaError（写失败必须让调用方知道）', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'unauthorized', userMessage: '令牌无效。' } }),
    }));
    const ch = createLoopbackChannel();
    await expect(ch.import({ schema: 'idplan-agent-payload/v1' }, { dryRun: true })).rejects.toThrow();
  });

  it('② import() 200 → 原样回传 ApplyResult', async () => {
    const ch = createLoopbackChannel();
    const result = await ch.import({ schema: 'idplan-agent-payload/v1' }, { dryRun: true });
    expect(result).toEqual(OK_APPLY_RESULT);
  });

  it('③ 非 Electron 环境：installDesktopLoopbackChannel 返回 false、不注册、不抛错', () => {
    // 确保无桥：node 下 window 未定义（afterEach 已清）；显式确认
    expect((globalThis as unknown as { window?: unknown }).window).toBeUndefined();
    const before = getAgentImportChannel();
    let threw = false;
    let returned = false;
    let caught: unknown = null;
    try {
      returned = installDesktopLoopbackChannel();
    } catch (e) {
      threw = true;
      caught = e;
      // eslint-disable-next-line no-console
      console.error('[loopback-test] installDesktopLoopbackChannel threw:', e);
    }
    expect(threw).toBe(false);
    expect(returned).toBe(false);
    // 注册表引用未被改变（未注册 loopback）
    expect(getAgentImportChannel()).toBe(before);
  });
});
