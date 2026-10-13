// @vitest-environment jsdom
/**
 * 插件开关 · **写前冲突校验**（G1）与「打开设置时重读」（G2）
 *
 * ══════════════════ 事故形态（为什么要有这一条）══════════════════
 * 注册表的 `enabledMap` 是**启动时读一次**的快照，之后永不重读。于是：
 *   · 甲标签页 / 甲设备打开着设置，乙那边把插件关掉了；
 *   · 甲再拨一下开关 ⇒ 写入是**基于旧快照的盲写**，乙的改动被**静默覆盖**；
 *   · 而且甲界面上显示的还是旧值——用户完全看不出来发生过什么。
 * 这是「多浏览器一人一个」的 NAS 形态下必然出现的场景（卖点即此），不是边角。
 *
 * ══════════════════ 本 spec 守什么 ══════════════════
 * 两条**离散判据，零容差**（team-lead 指定）：
 *   ① 服务端值未变 ⇒ 写入通过，落库 + 内存都变；
 *   ② 服务端值已被他处改过 ⇒ **拒绝写入**（一个字都没写）+ **内存不变**。
 * 另加三条同族的（都是同一机制的边界，一并钉住）：
 *   ③ 写库本身抛错 ⇒ `{ok:false,reason:'failed'}` 且内存不变（失败不许假装成功）；
 *   ④ `reloadEnabled()` 能读到服务端最新值（G2 的机制本体）；
 *   ⑤ 无显式记录（服务端没有这一行）时，快照也必须是「无记录」——
 *      否则「服务端没记录 vs 本地声称 false」会被误判成冲突，把正常开关全部锁死。
 *
 * ⚠️ 为什么不用 mock 的 `settings.get: async () => null`（多数 spec 的写法）：
 *   那样「服务端值」永远是 null，**证不出**任何冲突语义。本 spec 的 mock 是一张
 *   真会记账的 KV 表（`set` 写进去、`get` 读出来），与 LocalSettingsRepository 的
 *   「set 写 Dexie / get 读同一张表」同构；「别的设备改过」= 直接改表里那一行。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/** 一张会记账的 settings KV 表（`vi.mock` 工厂被提升 ⇒ 共享态必须走 `vi.hoisted`） */
const kv = vi.hoisted(() => ({
  rows: [] as Array<{ key: string; valueJson: string }>,
  /** 置 true 后 `set` 抛错（模拟存储不可写 / 服务端拒绝） */
  failWrites: false,
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
    /**
     * 与 LocalSettingsRepository 同构：`set` 写出 valueJson、`get` 读回来并 JSON.parse、
     * 没有这一行则返回 null。**不用真仓储**（那要 Dexie + fake-indexeddb），但语义一致。
     */
    settings: {
      all: async () => kv.rows.map((r) => ({ ...r })),
      get: async (key: string): Promise<unknown> => {
        const row = kv.rows.find((r) => r.key === key);
        return row ? JSON.parse(row.valueJson) : null;
      },
      set: async (key: string, value: unknown): Promise<void> => {
        if (kv.failWrites) throw new Error('存储不可写（测试注入）');
        kv.rows = [...kv.rows.filter((r) => r.key !== key), { key, valueJson: JSON.stringify(value) }];
      },
      remove: async (key: string): Promise<void> => {
        kv.rows = kv.rows.filter((r) => r.key !== key);
      },
    },
    stageLogs: { listByStage: async () => [], append: ok },
    customStages: { list: async () => [], insert: ok, update: ok, remove: ok },
    dumpTables: async () => ({}),
  };
  return { useRepos: () => bundle, bootstrapAllStores: async () => undefined };
});

import {
  PluginRegistryProvider,
  usePluginRegistry,
} from '../src/core/plugin/PluginRegistryProvider';
import { pluginEnabledKey } from '../src/core/plugin/types';

type Registry = ReturnType<typeof usePluginRegistry>;

/** 探针：把注册表本体捞出来给断言用（渲染期赋值，测试夹具的常规做法） */
let reg: Registry | null = null;
function Probe(): JSX.Element {
  reg = usePluginRegistry();
  return <div data-probe="" />;
}

const PLUGIN = 'sample-projects'; // defaultEnabled:false ⇒ 「无记录」时 enabled === false
const KEY = pluginEnabledKey(PLUGIN);

let host: HTMLDivElement;
let root: Root;

function registry(): Registry {
  if (!reg) throw new Error('探针没挂上（Provider 未渲染？）');
  return reg;
}

/** 挂载 + 把两个异步 effect（启动读 KV / 扫描已装插件）跑完 */
async function mountAndFlush(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PluginRegistryProvider>
        <Probe />
      </PluginRegistryProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 直接改表里那一行 = 「别的设备/标签页刚改过」 */
function externalWrite(value: boolean): void {
  kv.rows = [...kv.rows.filter((r) => r.key !== KEY), { key: KEY, valueJson: JSON.stringify(value) }];
}

function storedValue(): boolean | undefined {
  const row = kv.rows.find((r) => r.key === KEY);
  return row ? (JSON.parse(row.valueJson) as boolean) : undefined;
}

beforeEach(() => {
  kv.rows = [];
  kv.failWrites = false;
  reg = null;
});

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  (root as unknown as null) = null;
});

describe('G1 · 写前冲突校验（离散判据，零容差）', () => {
  it('① 服务端值未变 ⇒ 写入通过：落库 + 内存都跟着变', async () => {
    externalWrite(false); // 服务端已有显式 false，本客户端读到的快照就是它
    await mountAndFlush();
    expect(registry().stateOf(PLUGIN).enabled).toBe(false);

    let result: unknown;
    await act(async () => {
      result = await registry().setPluginEnabled(PLUGIN, true);
    });

    expect(result, '值没变就该放行').toEqual({ ok: true });
    expect(storedValue(), '必须真的落库').toBe(true);
    expect(registry().stateOf(PLUGIN).enabled, '内存也必须跟着变').toBe(true);
  });

  it('★ ② 服务端值已被他处改过 ⇒ 拒绝写入、内存不变（一个字都没写）', async () => {
    externalWrite(false);
    await mountAndFlush();
    // 前置：此刻本客户端认为它是关的
    expect(registry().stateOf(PLUGIN).enabled).toBe(false);

    // 另一个标签页 / 另一台设备把它打开了（本客户端毫不知情）
    externalWrite(true);

    let result: unknown;
    await act(async () => {
      // 用户在这边想把它「关掉」——基于旧快照的盲写会覆盖别人刚打开的状态
      result = await registry().setPluginEnabled(PLUGIN, false);
    });

    expect(result, '快照不一致必须判成冲突，而不是照写').toEqual({
      ok: false,
      reason: 'conflict',
      serverValue: true,
    });
    expect(storedValue(), '拒绝写入 ⇒ 服务端那一格必须原封不动（仍是别人写的 true）').toBe(true);
    expect(
      registry().stateOf(PLUGIN).enabled,
      '内存也不许动：不能把「没写成」显示成「已关掉」',
    ).toBe(false);
  });

  it('③ 写库抛错 ⇒ {ok:false,reason:failed}，且内存不变（失败不假装成功）', async () => {
    externalWrite(false);
    await mountAndFlush();

    kv.failWrites = true;
    let result: unknown;
    await act(async () => {
      result = await registry().setPluginEnabled(PLUGIN, true);
    });

    expect((result as { ok: boolean }).ok).toBe(false);
    expect((result as { reason: string }).reason).toBe('failed');
    expect((result as { error: Error }).error).toBeInstanceOf(Error);
    expect(storedValue()).toBe(false); // 没写成
    expect(registry().stateOf(PLUGIN).enabled, '内存必须留在原值').toBe(false);
  });

  it('④ reloadEnabled()：把服务端最新值读进内存（G2 的机制本体）', async () => {
    externalWrite(false);
    await mountAndFlush();
    expect(registry().stateOf(PLUGIN).enabled).toBe(false);

    externalWrite(true); // 他处改过
    await act(async () => {
      await registry().reloadEnabled();
    });
    expect(registry().stateOf(PLUGIN).enabled, '重读后应与服务端一致').toBe(true);
  });

  it('⑤ 「服务端没有这一行」不算冲突：快照也是「无记录」，开关照常可拨', async () => {
    // 一条记录都不写：服务端 get → null（归一成 undefined），本地快照同为 undefined
    await mountAndFlush();
    expect(registry().stateOf(PLUGIN).explicit, '前置：确实没有显式记录').toBe(false);

    let result: unknown;
    await act(async () => {
      result = await registry().setPluginEnabled(PLUGIN, true);
    });

    expect(result, '「两边都没有记录」必须判成一致，否则所有首次开关都会被锁死').toEqual({ ok: true });
    expect(storedValue()).toBe(true);
  });

  it('⑥ 重读结果与内存一致 ⇒ 注册表对象**不许换**（它一变，AppRouter 会白重建 router）', async () => {
    externalWrite(false);
    await mountAndFlush();

    const before = registry();
    await act(async () => {
      await registry().reloadEnabled(); // 服务端值没变的一次重读
    });
    const after = registry();

    expect(
      after,
      'KV 内容没变却换了注册表对象 ⇒ main.tsx 的 useEffect([reg]) 会再建一个 router 实例：' +
        '「打开设置」这种只读动作不该有这种副作用（幂等重读必须返回同一个对象）',
    ).toBe(before);
  });
});
