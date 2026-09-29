// @vitest-environment jsdom
/**
 * 0.8.2.0002 · NAS 备份不可用事故的修复验收。
 *
 * 事故：NAS 点「保存备份」连续 16 次 401「备份通道需要鉴权」——服务端
 * fail-closed（IDPLAN_AGENT_TOKEN 未配）+ UPK compose 无该环境位 +
 * 前端令牌构建期烤死 = 结构性不可用。
 *
 * 本文件钉住修复的三根桩：
 *   ① local / 桌面形态下「NAS 服务」区**整块不渲染**（不出现、不请求）；
 *   ② 保存令牌 = 写 localStorage `idplan.apiToken` + 派发
 *      `API_TOKEN_EVENT`（provider 据此重建 remote bundle——保存即生效，
 *      不需要「保存完再刷新页面还以为没存上」）；
 *   ③ 令牌**不回显**：输入框是 password 型，已有配置只显示状态文案。
 *      （截图/日志泄漏面最小化，与 Agent 令牌面板同纪律。）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';

import { API_TOKEN_KEY } from '../src/core/repositories/remote/rest.client';
import { API_TOKEN_EVENT } from '../src/di/repository.provider';

const dataSource = { value: 'remote' as 'remote' | 'local' };
vi.mock('../src/config/env', () => ({
  appEnv: {
    get dataSource() {
      return dataSource.value;
    },
    apiBaseUrl: 'http://nas.lan/api',
  },
}));

// logUser 落 Dexie——jsdom 里 fake-indexeddb 由 tests/setup 装好；
// 这里只关心「保存链路」，把日志打到内存替身，避免依赖库初始化时序。
const logUserSpy = vi.fn();
vi.mock('../src/core/services/log.service', () => ({
  logUser: (...args: unknown[]) => logUserSpy(...args),
}));

import { NasServiceSection } from '../src/components/settings/NasServiceSection';

async function renderInto(el: HTMLElement): Promise<void> {
  await act(async () => {
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(el);
    root.render(<NasServiceSection />);
  });
}

describe('NasServiceSection（备份令牌配置区 · 0.8.2.0002）', () => {
  let container: HTMLElement;

  beforeEach(() => {
    dataSource.value = 'remote';
    localStorage.clear();
    logUserSpy.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('① local / 桌面形态：整块不渲染', async () => {
    dataSource.value = 'local';
    await renderInto(container);
    expect(container.querySelector('section')).toBeNull();
  });

  it('② remote 形态：保存令牌 → 写 localStorage + 派发 API_TOKEN_EVENT', async () => {
    let fired = 0;
    const onEvt = (): void => {
      fired += 1;
    };
    window.addEventListener(API_TOKEN_EVENT, onEvt);

    await renderInto(container);
    const input = container.querySelector('input[type="password"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();

    await act(async () => {
      // React 受控 input：经原生 setter 派发，走 React 的 onChange 合成事件
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'idplan-test-token-123');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      /保存|已保存/.test(b.textContent ?? ''),
    );
    expect(saveBtn).toBeTruthy();
    await act(async () => {
      saveBtn?.click();
    });

    expect(localStorage.getItem(API_TOKEN_KEY)).toBe('idplan-test-token-123');
    expect(fired).toBe(1);
    expect(logUserSpy).toHaveBeenCalled();

    window.removeEventListener(API_TOKEN_EVENT, onEvt);
  });


  it('④ 测试连接：200 → 通 / 401 → 令牌不匹配 / 抛错 → 网络不通', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    await renderInto(container);

    const probeBtn = (): HTMLButtonElement | undefined =>
      Array.from(container.querySelectorAll('button')).find((b) => /测试连接/.test(b.textContent ?? ''));

    await act(async () => {
      probeBtn()?.click();
    });
    expect(fetchImpl).toHaveBeenCalled();
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/backup');
    expect(container.textContent).toContain('备份通道连通');

    fetchImpl.mockResolvedValue(new Response('{}', { status: 401 }));
    await act(async () => {
      probeBtn()?.click();
    });
    expect(container.textContent).toContain('401');

    fetchImpl.mockRejectedValue(new Error('down'));
    await act(async () => {
      probeBtn()?.click();
    });
    expect(container.textContent).toContain('连不上服务端');
    vi.unstubAllGlobals();
  });

  it('③ 已有配置：状态文案出现，但令牌值不在 DOM 里', async () => {
    localStorage.setItem(API_TOKEN_KEY, 'idplan-preset-secret');
    await renderInto(container);
    expect(container.textContent).toContain('已配置');
    // 回显面：DOM 任何角落都不出现令牌明文
    expect(container.textContent).not.toContain('idplan-preset-secret');
    const input = container.querySelector('input[type="password"]') as HTMLInputElement | null;
    expect(input?.value).toBe('');
  });
});

/* ================================================================================================
 * factory 层：token 三级优先级（抓 fetch 头实测，防「优先级写反」回退）
 *
 * UI spec 证明了「保存 → localStorage」；这里证明「localStorage → 请求头」的
 * 最后一公里：localStorage 值 > 构建期 env > 空。变异点：若将来有人把顺序
 * 写成 env 优先，用户保存的令牌会被烤死的空值盖掉——备份又 401，且毫无征兆。
 * ================================================================================================ */
import { API_TOKEN_KEY as KEY } from '../src/core/repositories/remote/rest.client';

describe('createRemoteRepositories · token 优先级（fetch 头实测）', () => {
  const fetchCalls: Array<{ url: string; headers: Record<string, string> }> = [];

  beforeEach(() => {
    fetchCalls.length = 0;
    localStorage.clear();
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      fetchCalls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function fireAndCapture(): Promise<Record<string, string>> {
    const { createRemoteRepositories } = await import('../src/core/repositories/remote/rest.client');
    const repos = createRemoteRepositories('http://nas.lan/api');
    await repos.settings.all();
    return fetchCalls[0]!.headers;
  }

  it('★ localStorage 令牌优先于 env（用户刚保存的立即生效）', async () => {
    localStorage.setItem(KEY, 'idplan-user-saved');
    vi.stubEnv('VITE_API_TOKEN', 'idplan-buildtime');
    const headers = await fireAndCapture();
    expect(headers.Authorization).toBe('Bearer idplan-user-saved');
  });

  it('无 localStorage 时回落 env（部署方烤的默认值仍生效）', async () => {
    vi.stubEnv('VITE_API_TOKEN', 'idplan-buildtime');
    const headers = await fireAndCapture();
    expect(headers.Authorization).toBe('Bearer idplan-buildtime');
  });

  it('两者都无 → 不带 Authorization 头（与服务端 fail-closed 相撞=明确 401）', async () => {
    vi.stubEnv('VITE_API_TOKEN', '');
    const headers = await fireAndCapture();
    expect(headers.Authorization).toBeUndefined();
  });
});
