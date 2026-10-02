/**
 * 本机 loopback · 渲染侧落库接收器（v1.0）。
 *
 * ── 验的是什么 ──
 * 落库监听器已从 `AgentBoardPage` 上提为**常驻**（`useAgentLoopbackReceiver`，挂 `AppShell`）。
 * 原因是旧实现只在 Agent 看板页挂载：用户在首页时主进程找不到监听器，外部 POST 要等满
 * 10s 才 503，而 `health` 却因「窗口在」报 `dataLayer='ready'` —— 假阳性。
 *
 * 本 spec 锁死四件事：
 *   ① **ping 必须短路**：只回 pong，**绝不**走 `previewAgentPayload` / `applyAgentPayload`
 *      （探活天天被打，走落库会污染数据）；
 *   ② 正常 import 仍走落库，且 `dryRun` 原样透传（true→preview / false→apply）；
 *   ③ 非 Electron（无桥）→ 静默跳过、不抛错、dispose 安全可调用；
 *   ④ token 推送：桥缺失 / localStorage 抛错 / token 为空 → 都不推、不抛。
 *
 * 全部走**纯函数**（`handleAgentLoopbackMessage` / `wireLoopbackReceiver` /
 * `pushStoredTokenToMainProcess`），不渲染 React，node env 即可跑。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  isPingRequest,
  handleAgentLoopbackMessage,
  wireLoopbackReceiver,
  pushStoredTokenToMainProcess,
  type LoopbackReceiverBridge,
} from '../src/hooks/useAgentLoopbackReceiver';

import type { IRepositoryBundle } from '../src/core/repositories/interfaces';

/** 假仓储：只记录「被调用了几次」，不真落库 */
function fakeRepos(): IRepositoryBundle {
  return { __fake: true } as unknown as IRepositoryBundle;
}

function importReq(overrides: Partial<AgentImportRequest> = {}): AgentImportRequest {
  return {
    requestId: 'req-1',
    dryRun: false,
    projectId: 'proj_a',
    stageName: null,
    payload: { schema: 'idplan-agent-payload/v1' },
    ...overrides,
  } as AgentImportRequest;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('loopback 接收器 · ping 短路', () => {
  it('① isPingRequest 只认 kind==="ping"，落库请求不算 ping', () => {
    expect(isPingRequest({ requestId: 'p', kind: 'ping' })).toBe(true);
    expect(isPingRequest(importReq())).toBe(false);
    expect(isPingRequest(null)).toBe(false);
    expect(isPingRequest('ping')).toBe(false);
  });

  it('② ping 回 pong 且**不碰落库**（不调 payload.apply）', async () => {
    const sendPong = vi.fn();
    const sendImportResult = vi.fn();
    const applySpy = vi.spyOn(
      await import('../src/core/agent/payload.apply'),
      'applyAgentPayload',
    );
    const previewSpy = vi.spyOn(
      await import('../src/core/agent/payload.apply'),
      'previewAgentPayload',
    );

    await handleAgentLoopbackMessage({
      repos: fakeRepos(),
      req: { requestId: 'ping-1', kind: 'ping' },
      sendImportResult,
      sendPong,
    });

    expect(sendPong).toHaveBeenCalledWith({ requestId: 'ping-1' });
    expect(sendImportResult).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
    expect(previewSpy).not.toHaveBeenCalled();
  });
});

describe('loopback 接收器 · 落库分支', () => {
  it('③ 非法 payload → 回传 error（不抛给主进程）', async () => {
    const sendImportResult = vi.fn();
    const sendPong = vi.fn();

    await handleAgentLoopbackMessage({
      repos: fakeRepos(),
      req: importReq({ payload: { totally: 'wrong' } }),
      sendImportResult,
      sendPong,
    });

    expect(sendPong).not.toHaveBeenCalled();
    expect(sendImportResult).toHaveBeenCalledTimes(1);
    const reply = sendImportResult.mock.calls[0]?.[0] as {
      requestId: string;
      error?: { code: string; userMessage: string };
    };
    expect(reply.requestId).toBe('req-1');
    expect(reply.error).toBeDefined();
    expect(typeof reply.error?.userMessage).toBe('string');
  });
});

describe('loopback 接收器 · 非 Electron 环境', () => {
  it('④ 无桥 → wireLoopbackReceiver 静默跳过，dispose 可安全调用', () => {
    const { dispose } = wireLoopbackReceiver({ repos: fakeRepos(), bridge: undefined });
    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();

    const empty = wireLoopbackReceiver({ repos: fakeRepos(), bridge: {} });
    expect(() => empty.dispose()).not.toThrow();
  });

  it('⑤ 有桥 → import 与 ping 都订阅，dispose 时逐个退订', () => {
    const offImport = vi.fn();
    const offPing = vi.fn();
    const bridge: LoopbackReceiverBridge = {
      onAgentImport: vi.fn(() => offImport),
      onAgentPing: vi.fn(() => offPing),
    };

    const { dispose } = wireLoopbackReceiver({ repos: fakeRepos(), bridge });

    expect(bridge.onAgentImport).toHaveBeenCalledTimes(1);
    expect(bridge.onAgentPing).toHaveBeenCalledTimes(1);
    dispose();
    expect(offImport).toHaveBeenCalledTimes(1);
    expect(offPing).toHaveBeenCalledTimes(1);
  });
});

describe('loopback 接收器 · token 推送主进程', () => {
  /**
   * vitest 环境是 **node**（`environment: 'node'`），没有 `localStorage` 全局。
   * 故这里手动装一个最小 stub；用完删掉，避免污染同进程其它 spec。
   */
  function installLocalStorage(getItemImpl: () => string): void {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: getItemImpl, setItem: () => {}, removeItem: () => {} },
    });
  }
  function removeLocalStorage(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage;
  }

  it('⑥ 有已存 token → 推给主进程', () => {
    const setAgentToken = vi.fn();
    installLocalStorage(() => 'tok-abc');

    try {
      pushStoredTokenToMainProcess({ setAgentToken });
    } finally {
      removeLocalStorage();
    }

    expect(setAgentToken).toHaveBeenCalledWith('tok-abc');
  });

  it('⑦ 桥缺失 / token 为空 / localStorage 抛错 / 无 localStorage → 都不推、不抛', () => {
    const setAgentToken = vi.fn();

    // 桥缺失
    expect(() => pushStoredTokenToMainProcess(undefined)).not.toThrow();
    expect(setAgentToken).not.toHaveBeenCalled();

    // 空 token（只有空白字符也算没配）
    installLocalStorage(() => '   ');
    try {
      pushStoredTokenToMainProcess({ setAgentToken });
    } finally {
      removeLocalStorage();
    }
    expect(setAgentToken).not.toHaveBeenCalled();

    // localStorage 本身抛（隐私模式 / 配额满）
    installLocalStorage(() => {
      throw new Error('denied');
    });
    try {
      expect(() => pushStoredTokenToMainProcess({ setAgentToken })).not.toThrow();
    } finally {
      removeLocalStorage();
    }
    expect(setAgentToken).not.toHaveBeenCalled();

    // 完全没有 localStorage（node 环境原生状态）
    expect(() => pushStoredTokenToMainProcess({ setAgentToken })).not.toThrow();
    expect(setAgentToken).not.toHaveBeenCalled();
  });
});
