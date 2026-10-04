// @vitest-environment node
/**
 * 插件骨架守卫（v0.8.6 阶段 1 · 她 10-04「插件要能手动在设置里面去开关」）
 *
 * 守的是**三件容易被未来改坏的事**：
 *   ① 停用 = 路由**从不进入数组**（不是重定向、不是条件渲染 null）——
 *      写成组件里就只能靠肉眼看，写成纯函数才能钉死；
 *   ② 通配符顺序：插件路由必须插在宿主 `path:'*'` **之前**，否则永远走不到
 *      （路由注册的经典坑，注释防回归不够，得有断言）；
 *   ③ KV 往返：坏 settings 行**不炸**（fail-open 到 defaultEnabled）——
 *      一个坏行让整个插件系统失效是不可接受的。
 *
 * 纪律：变异实测过（把「只取启用中」改成全量、把通配符前插改成后插、
 * 把坏行处理改成抛错 ⇒ 三条断言分别变红）。
 */

import { describe, it, expect } from 'vitest';
import type { RouteObject } from 'react-router-dom';

import {
  describePluginState,
  enabledPlugins,
  isPluginEnabled,
  readEnabledFromSettings,
  resolveNavItems,
  resolveRoutes,
} from '../src/core/plugin/registry';
import { pluginEnabledKey } from '../src/core/plugin/types';
import type { PluginManifest, PluginRegistryState } from '../src/core/plugin/types';

function manifest(id: string, over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id,
    name: `插件 ${id}`,
    summary: '测试用',
    version: '1.0.0',
    source: 'builtin',
    defaultEnabled: false,
    ...over,
  };
}

const HOST: RouteObject[] = [
  { path: '/', element: null as never },
  { path: '*', element: null as never },
];

describe('插件注册表 · 停用语义', () => {
  const state: PluginRegistryState = {
    manifests: [
      manifest('on', { defaultEnabled: true, routes: [{ path: 'on-page', element: null as never }] }),
      manifest('off', { routes: [{ path: 'off-page', element: null as never }] }),
    ],
    enabled: {},
  };

  it('① 启用中的插件路由进数组', () => {
    const out = resolveRoutes(HOST, state);
    expect(out.map((r) => r.path)).toContain('on-page');
  });

  it('② 停用的插件路由**不在数组里**（不是重定向/null 渲染）', () => {
    const out = resolveRoutes(HOST, state);
    expect(out.map((r) => r.path)).not.toContain('off-page');
  });

  it('③ 通配符仍排在最后（插件路由插在它前面）', () => {
    const out = resolveRoutes(HOST, state);
    expect(out[out.length - 1]!.path).toBe('*');
    expect(out.map((r) => r.path)).toEqual(['/', 'on-page', '*']);
  });

  it('④ 侧栏入口同样只取启用中的', () => {
    const withNav: PluginRegistryState = {
      manifests: [
        manifest('a', { defaultEnabled: true, nav: [{ to: '/a', label: 'A', icon: 'bot', group: 'agent' }] }),
        manifest('b', { nav: [{ to: '/b', label: 'B', icon: 'bot', group: 'agent' }] }),
      ],
      enabled: {},
    };
    expect(resolveNavItems(withNav).map((n) => n.to)).toEqual(['/a']);
  });

  it('⑤ 显式 KV 覆盖 defaultEnabled（开→关、关→开 两个方向）', () => {
    const flipped: PluginRegistryState = {
      manifests: [manifest('x', { defaultEnabled: true }), manifest('y', { defaultEnabled: false })],
      enabled: { x: false, y: true },
    };
    expect(isPluginEnabled(flipped, 'x')).toBe(false);
    expect(isPluginEnabled(flipped, 'y')).toBe(true);
  });

  it('⑥ describePluginState：explicit 区分「手动设过」与「用默认」', () => {
    const s: PluginRegistryState = {
      manifests: [manifest('a', { defaultEnabled: true }), manifest('b', { defaultEnabled: false })],
      enabled: { a: false },
    };
    expect(describePluginState(s, 'a')).toEqual({ enabled: false, explicit: true });
    expect(describePluginState(s, 'b')).toEqual({ enabled: false, explicit: false });
  });
});

describe('插件注册表 · settings KV 往返', () => {
  it('⑦ 布尔值还原；非本前缀的键忽略', () => {
    const map = readEnabledFromSettings([
      { key: pluginEnabledKey('a'), valueJson: 'true' },
      { key: pluginEnabledKey('b'), valueJson: 'false' },
      { key: 'restPolicy', valueJson: '{}' },
      { key: 'plugin.enabled.', valueJson: 'true' }, // 空 id：跳过
    ]);
    expect(map).toEqual({ a: true, b: false });
  });

  it('⑧ 坏行不炸：跳过后回落 defaultEnabled（fail-open）', () => {
    const map = readEnabledFromSettings([
      { key: pluginEnabledKey('x'), valueJson: '坏 JSON' },
      { key: pluginEnabledKey('y'), valueJson: '"not-bool"' },
    ]);
    expect(map).toEqual({});
    const s: PluginRegistryState = { manifests: [manifest('x', { defaultEnabled: true })], enabled: map };
    expect(enabledPlugins(s)).toHaveLength(1);
  });

  it('⑨ 键名单一出处（key 形如 plugin.enabled.<id>）', () => {
    expect(pluginEnabledKey('agent-board')).toBe('plugin.enabled.agent-board');
  });
});
