// @vitest-environment jsdom
/**
 * 插件开关 · **失败反馈必须说清是哪一类失败**（G1 冲突 / #17 401 误报 / 真存储错误 / G3 门控）
 *
 * ══════════════════ #17 的事故形态（本 spec 的主要由来）══════════════════
 * 服务端配了 `IDPLAN_AGENT_TOKEN`、浏览器**没填** `idplan.apiToken` 时：
 * 拨插件开关 → 服务端 `PUT /api/settings/:key` 被 `guardWrite` **401** 掉 →
 * 界面红字写的是「**本地存储可能不可写**」。
 * 诊断方向**完全指错**：用户会去查浏览器存储权限，而真因是没带令牌。
 * 误导性的错误文案比没有文案更坏 —— 它把人送去查错的地方。
 *
 * ══════════════════ 本 spec 守什么 ══════════════════
 * 四条**用户可见文案**的离散判据（零容差，全部断言文案里的判别性子串）：
 *   ① 写冲突（别的设备改过）⇒ 提示「已被其他设备修改，请刷新后重试」，且**一个字不含存储**；
 *   ② 服务端 401（remote 形态 + 本浏览器没填令牌）⇒ 指向 **设置 → NAS 服务 填令牌**；
 *   ③ 真的存储写失败（`ChangxiaErrorCode.Storage`）⇒ 才出现「本地存储不可写」；
 *   ④ 成员身份 ⇒ 开关**置灰**且给可见说明（G3 的 UI 半门）。
 * 外加一条反向锁：②③ 的文案**必须不同**（把两类并成一句通用话就红）—— 正是 #17 的病灶。
 *
 * ⚠️ 环境：`appEnv.dataSource` 必须在**模块加载前**是 `remote`（`src/config/env.ts` 是
 *    模块级单例，读 `window.__APP_ENV__`）。`vi.hoisted` 的回调在**整个模块图求值之前**
 *    运行 ⇒ 只有在那里注入才来得及；写在 `beforeAll` 里是**来不及**的（本文件顶部
 *    任意一个 import 都可能已经把 env.ts 拉起来定型成 local —— 我第一版就是这么错的，
 *    上面那条「前置自证」当场把它抓了出来）。
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/** ★ 必须在任何 import 被求值之前注入运行环境（见文件头「环境」） */
vi.hoisted(() => {
  (window as unknown as { __APP_ENV__?: unknown }).__APP_ENV__ = {
    VITE_DATA_SOURCE: 'remote',
    VITE_API_BASE_URL: 'http://nas.local/api',
  };
});

/** 会记账的 settings KV 表 + 可注入的写失败（与 tests/plugin-toggle-conflict.spec.tsx 同构） */
const kv = vi.hoisted(() => ({
  rows: [] as Array<{ key: string; valueJson: string }>,
  /** `set` 要抛的错（null = 正常写） */
  writeError: null as unknown,
}));

vi.mock('../src/hooks/useRepos', () => {
  const ok = async (): Promise<void> => undefined;
  const bundle = {
    projects: { list: async () => [], get: async () => null, insert: ok, update: ok, archive: ok, remove: ok },
    stages: { listByProject: async () => [], get: async () => null, bulkInsert: ok, update: ok, reschedule: ok },
    tasks: {
      list: async () => [],
      listByProject: async () => [],
      listByAssignee: async () => [],
      get: async () => null,
      bulkInsert: ok,
      insert: ok,
      update: ok,
      remove: ok,
    },
    members: { list: async () => [], get: async () => null, insert: ok, update: ok, remove: ok },
    settings: {
      all: async () => kv.rows.map((r) => ({ ...r })),
      get: async (key: string): Promise<unknown> => {
        const row = kv.rows.find((r) => r.key === key);
        return row ? JSON.parse(row.valueJson) : null;
      },
      set: async (key: string, value: unknown): Promise<void> => {
        if (kv.writeError) throw kv.writeError;
        kv.rows = [...kv.rows.filter((r) => r.key !== key), { key, valueJson: JSON.stringify(value) }];
      },
      remove: ok,
    },
    stageLogs: { listByStage: async () => [], append: ok },
    customStages: { list: async () => [], insert: ok, update: ok, remove: ok },
    dumpTables: async () => ({}),
  };
  return { useRepos: () => bundle, bootstrapAllStores: async () => undefined };
});

import { PluginRegistryProvider } from '../src/core/plugin/PluginRegistryProvider';
import { PluginsSection } from '../src/components/settings/PluginsSection';
import { useMembersStore } from '../src/store/useMembersStore';
import { useSettingsStore } from '../src/store/useSettingsStore';
import { API_TOKEN_KEY } from '../src/core/repositories/remote/rest.client';
import { ChangxiaError, ChangxiaErrorCode, MemberActorKind, MemberRoleKind } from '../src/core/types/enums';
import { appEnv } from '../src/config/env';
import { pluginEnabledKey } from '../src/core/plugin/types';

let host: HTMLDivElement;
let root: Root;

const PLUGIN = 'sample-projects';
const KEY = pluginEnabledKey(PLUGIN);

const ADMIN = {
  id: 'mem_fb_admin',
  name: '反馈探针管理员',
  role: '负责人',
  contact: null,
  avatarColor: '#88A293',
  active: true,
  roleKind: MemberRoleKind.Admin,
  passwordHash: null,
  actorKind: MemberActorKind.Human,
  agentKind: null,
  revision: 1,
  updatedAt: '2026-10-01T00:00:00Z',
} as const;

const MEMBER = { ...ADMIN, id: 'mem_fb_member', roleKind: MemberRoleKind.Member };

async function mount(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PluginRegistryProvider>
        <PluginsSection />
      </PluginRegistryProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function toggle(): HTMLButtonElement {
  const b = document.querySelector<HTMLButtonElement>(`[data-plugin-toggle="${PLUGIN}"]`);
  if (!b) throw new Error('找不到插件开关');
  return b;
}

/** 点开关并等写入链跑完 */
async function flip(): Promise<void> {
  await act(async () => {
    toggle().click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function bodyText(): string {
  return document.body.textContent ?? '';
}

beforeEach(() => {
  kv.rows = [{ key: KEY, valueJson: 'false' }];
  kv.writeError = null;
  try {
    localStorage.removeItem(API_TOKEN_KEY);
  } catch {
    /* jsdom 存储不可用：忽略 */
  }
  useMembersStore.getState().setAll([{ ...ADMIN }, { ...MEMBER }]);
  useSettingsStore.setState({ currentMemberId: ADMIN.id, hydrated: true });
});

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  (root as unknown as null) = null;
});

/**
 * ★ 必须**自己**还原 `window.__APP_ENV__`（本文件是全仓唯一写它的地方）。
 *
 * 为什么由本文件负责：注入点在 `vi.hoisted`（**必须在整张模块图求值之前**，否则
 * `src/config/env.ts` 那个模块级单例已经被定型成 `local`，本 spec 的 401 分支根本
 * 到不了）。既然只能「在模块加载前注入」，那**还原也只能由这里做** —— 没有任何
 * 全局复位能替它。
 *
 * 为什么不能省：`window.__APP_ENV__` 是**进程级全局**。vitest 按文件重建模块图，
 * 下一个 spec 文件重新求值 `src/config/env.ts` 时会读到这个残留 ⇒ `appEnv.dataSource`
 * 恒为 `'remote'` ⇒ 所有依赖 `dataSource === 'local'` 的代码路径**根本不会执行**。
 * 实测（最小复现，同一进程按顺序跑）：本文件 + `tests/db-version-ahead.spec.tsx`
 * ⇒ 后者三条「本地版本闸门」全红（`expected '已进入应用' to contain '本地数据比当前应用更新'`、
 * `创建仓储 … expected "spy" to be called +0 times, but got 1 times`），而**单跑它全绿**。
 *
 * ⇒ 记一条纪律：**「我自己的 spec 是绿的」不等于「我没有影响别人」。**
 *    凡是在 spec 里给 `window` / `globalThis` 赋值，都要问一句「谁负责还原它」。
 *    （这里踩的第三种代价：自己的绿是对的，代价是别人的红，而且藏了整整一轮才被二分挖出来。）
 */
afterAll(() => {
  delete (window as unknown as { __APP_ENV__?: unknown }).__APP_ENV__;
});

describe('插件开关 · 失败反馈分类（#17 + G1）', () => {
  it('前置自证：本 spec 确实跑在 remote 形态（否则 401 那条分支根本到不了）', () => {
    expect(appEnv.dataSource, 'appEnv 必须是 remote——它决定了「网络码」能否被解释成 401').toBe(
      'remote',
    );
    expect(appEnv.apiBaseUrl).toBe('http://nas.local/api');
  });

  it('★ ① 写冲突 ⇒ 文案指「已被其他设备修改」，且**不得**提本地存储', async () => {
    await mount();
    // 别的设备把它打开了（本客户端毫不知情）
    kv.rows = [{ key: KEY, valueJson: 'true' }];

    await flip();
    const text = bodyText();
    expect(text, '冲突必须如实说').toContain('已被其他设备修改');
    expect(
      text,
      '冲突与存储失败是两个原因，冲突文案里不得出现「本地存储」这类的错误指向',
    ).not.toContain('本地存储');
  });

  it('★ ② 服务端 401（remote + 未填令牌）⇒ 指向「设置 → NAS 服务」填令牌', async () => {
    kv.writeError = new ChangxiaError(ChangxiaErrorCode.Network, '服务端错误（HTTP 401）');
    await mount();

    await flip();
    const text = bodyText();
    expect(text, '#17：这正是原来被误报成「本地存储不可写」的那一类').toContain('未配置访问令牌');
    expect(text, '要给出正确的去处').toContain('NAS 服务');
    expect(
      text,
      '★ 反向锁：401 不许被讲成存储问题（#17 的病灶就在这句话上）',
    ).not.toContain('本地存储不可写');
  });

  it('③ 真的存储写失败 ⇒ 才出现「本地存储不可写」（只对存储错误成立）', async () => {
    kv.writeError = new ChangxiaError(ChangxiaErrorCode.Storage, '设置项写入失败。');
    await mount();

    await flip();
    expect(bodyText(), '存储错误是唯一配说这句话的一类').toContain('本地存储不可写');
  });

  it('★ ④ 反向锁：②③ 两条文案必须**不同**（并成一句通用话就红）', async () => {
    kv.writeError = new ChangxiaError(ChangxiaErrorCode.Network, '服务端错误（HTTP 401）');
    await mount();
    await flip();
    const unauthorized = bodyText();
    act(() => root.unmount());
    host.remove();

    kv.writeError = new ChangxiaError(ChangxiaErrorCode.Storage, '设置项写入失败。');
    await mount();
    await flip();
    const storage = bodyText();

    expect(unauthorized).not.toBe(storage);
    expect(unauthorized).toContain('未配置访问令牌');
    expect(storage).toContain('本地存储不可写');
    expect(storage).not.toContain('未配置访问令牌');
  });

  it('⑤ 令牌已填但被拒 ⇒ 走「服务端拒绝」那条，不再说「未配置」', async () => {
    localStorage.setItem(API_TOKEN_KEY, 'token-from-nas-section');
    kv.writeError = new ChangxiaError(ChangxiaErrorCode.Network, '服务端错误（HTTP 401）');
    await mount();

    await flip();
    const text = bodyText();
    expect(text, '填了令牌还失败 ⇒ 不该再说「未配置」').not.toContain('未配置访问令牌');
    expect(text).toContain('写入被服务端拒绝或服务端不可达');
    expect(text, '服务端原话要带出来，便于定位').toContain('HTTP 401');
  });

  it('⑥ G3：成员身份 ⇒ 开关置灰 + 可见说明（全局设置仅管理员可改）', async () => {
    useSettingsStore.setState({ currentMemberId: MEMBER.id, hydrated: true });
    await mount();

    expect(toggle().disabled, '成员不许拨全局开关').toBe(true);
    expect(toggle().getAttribute('title')).toContain('仅管理员可改');
    expect(document.querySelector('[data-plugins-admin-notice]'), '还要有可见说明（触屏看不到 tooltip）').not.toBeNull();
  });

  it('⑦ 对照：管理员身份下开关可拨（门控只挡成员，不误伤管理员）', async () => {
    await mount();
    expect(toggle().disabled).toBe(false);
    expect(document.querySelector('[data-plugins-admin-notice]')).toBeNull();
  });
});
