// @vitest-environment jsdom
/**
 * 插件注册表 · **无 Provider 的降级档必须等于「Provider 在、KV 还没读完」那一帧**
 *
 * ══════════════════ 这条为什么值得单独立一条 spec ══════════════════
 * `usePluginRegistry()` 在**没有 Provider** 时降级而非抛错（让所有渲染壳层的既有 spec
 * 不必都包 Provider）。但降级值本身很容易写歪，而写歪**不会红**——它只会让
 * 「不包 Provider 的测试树」比真机**少渲染一部分**，于是：
 *   · 真机未 hydrate 那一帧的行为（谓词回落 `defaultEnabled`）**永远测不到**；
 *   · 将来某个消费点「必须有 Provider 才对」的 bug，会被降级值掩盖成「看起来正常」。
 *
 * 订正前的实测形态（`impl-plugin-gating` 的探针）：无 Provider 渲染 `MobileMoreMenu`，
 * `stateOf('agent-board')` 报 `enabled:false`、⋮ 菜单里 **Agent 项消失**——尽管该插件
 * `defaultEnabled: true`。同一个文件里那句「谓词全部回落 defaultEnabled」的注释
 * 当时是**假的**。
 *
 * ══════════════════ 判据 ══════════════════
 * ① 无 Provider：不抛错，且 `stateOf` **遵从 defaultEnabled**（agent-board=true /
 *    weekly-report=false —— 一真一假两个方向，单方向过不了这条）；
 * ② 无 Provider：`navItems` 与 `enabledManifests` 也从**真实内置清单**派生
 *    （不能只改 `stateOf` 而不改清单 —— 那会造出「stateOf 说有、navItems 说没有」
 *    的自相矛盾状态）；
 * ③ **有** Provider 且 KV 空：上述三个值与 ①② **逐个相同** —— 这就是「与生产语义
 *    对齐」的证据（真机未 hydrate 时 Provider 就在、KV 就是空的）。
 *
 * ⚠️ 反向锁：把降级档改回硬编码 `enabled:false` / `manifests: []` ⇒ ①②③ 变红。
 *    （已实测：三方向均可通过，见提交信息。）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const kv = vi.hoisted(() => ({ rows: [] as Array<{ key: string; valueJson: string }> }));

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
      get: async () => null,
      set: ok,
      remove: ok,
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

/** 被观测的三个值：状态、启用清单、侧栏入口 */
interface Snapshot {
  agentBoard: { enabled: boolean; explicit: boolean };
  weeklyReport: { enabled: boolean; explicit: boolean };
  enabledIds: string[];
  navCounts: { main: number; agent: number };
}

let seen: Snapshot | null = null;

function Probe(): JSX.Element {
  const reg = usePluginRegistry();
  seen = {
    agentBoard: reg.stateOf('agent-board'),
    weeklyReport: reg.stateOf('weekly-report'),
    enabledIds: reg.enabledManifests.map((m) => m.id).sort(),
    navCounts: {
      main: reg.navItems.filter((n) => n.group === 'main').length,
      agent: reg.navItems.filter((n) => n.group === 'agent').length,
    },
  };
  return <div data-probe="" />;
}

let host: HTMLDivElement;
let root: Root;

function registrySnapshot(): Snapshot {
  if (!seen) throw new Error('探针没挂上');
  return seen;
}

async function mount(node: React.ReactElement): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  kv.rows = [];
  seen = null;
});

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  (root as unknown as null) = null;
});

describe('插件注册表 · 无 Provider 降级档 = 未 hydrate 帧', () => {
  it('① 无 Provider：不抛错，且 stateOf 遵从 defaultEnabled（真/假两个方向）', async () => {
    await mount(<Probe />);
    const s = registrySnapshot();
    expect(s.agentBoard.enabled, 'agent-board 的 defaultEnabled 是 true ⇒ 未 hydrate 时也应为 true').toBe(
      true,
    );
    expect(s.weeklyReport.enabled, 'weekly-report 的 defaultEnabled 是 false ⇒ 应为 false').toBe(false);
    // 都没有显式记录 ⇒ explicit 恒 false（「没读过 KV」与「读了但没有这一行」在这里同形）
    expect(s.agentBoard.explicit).toBe(false);
    expect(s.weeklyReport.explicit).toBe(false);
  });

  it('② 无 Provider：清单与侧栏入口同样从真实内置清单派生（不自相矛盾）', async () => {
    await mount(<Probe />);
    const s = registrySnapshot();
    // 三个内置插件里只有 agent-board 是 defaultEnabled:true（sample-projects 与
    // weekly-report 都是 false）⇒ 未 hydrate 时启用清单**恰好**只有它。
    // 这条同时锁死了两个方向：真清单（不是空数组）且回落真的按 defaultEnabled 判。
    expect(s.enabledIds, '启用清单 = 默认启用的那些（只有 agent-board）').toEqual(['agent-board']);
    expect(
      s.navCounts.agent,
      'agent-board 贡献 1 个 agent 段入口 ⇒ 未 hydrate 时它就该在（否则就是「stateOf 说有、navItems 说没有」）',
    ).toBe(1);
  });

  it('③ 与「Provider 在、KV 空」逐值相同 —— 这就是与生产语义对齐的证据', async () => {
    await mount(<Probe />);
    const withoutProvider = registrySnapshot();

    await mount(
      <PluginRegistryProvider>
        <Probe />
      </PluginRegistryProvider>,
    );
    const withEmptyKv = registrySnapshot();

    expect(withEmptyKv, 'KV 空 + 有 Provider（= 真机未 hydrate）应与无 Provider 降级档逐值相同').toEqual(
      withoutProvider,
    );
  });
});
