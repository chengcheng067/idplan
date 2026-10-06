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

/**
 * 宿主根路由（两层结构：根 → AppShell → children）。
 * children 里**必须有** `path:'*'` 通配（与真实 buildHostRoutes 一致）——
 * 插件路由要插在它前面，否则永远走不到。
 */
/** 本构建附带的插件 id（与 PluginRegistryProvider 的清单一致；加插件时同步） */
const BUILTIN_IDS = ['agent-board', 'sample-projects', 'weekly-report'] as const;

const HOST: RouteObject[] = [
  {
    path: '/',
    element: null as never,
    children: [
      { path: 'my-tasks', element: null as never },
      { path: '*', element: null as never },
    ],
  },
];

/** 取 AppShell 的 children（断言都落在这一层——插件是子页面不是平铺路由） */
function childrenOf(routes: RouteObject[]): Array<string | undefined> {
  return (routes[0]?.children ?? []).map((c) => c.path);
}

describe('插件注册表 · 停用语义', () => {
  const state: PluginRegistryState = {
    manifests: [
      manifest('on', { defaultEnabled: true, routes: [{ path: 'on-page', element: null as never }] }),
      manifest('off', { routes: [{ path: 'off-page', element: null as never }] }),
    ],
    enabled: {},
  };

  it('① 启用中的插件路由进宿主 children（**子页面**，不是平铺路由）', () => {
    const paths = childrenOf(resolveRoutes(HOST, state));
    expect(paths).toContain('on-page');
    // 顶层仍是宿主那一条根路由（未被插件摊平）
    expect(resolveRoutes(HOST, state)).toHaveLength(1);
  });

  it('② 停用的插件路由**不在数组里**（不是重定向/null 渲染）', () => {
    const paths = childrenOf(resolveRoutes(HOST, state));
    expect(paths).not.toContain('off-page');
  });

  it('③ 通配符仍排在最后（插件路由插在它前面，否则永远走不到）', () => {
    const paths = childrenOf(resolveRoutes(HOST, state));
    expect(paths[paths.length - 1]).toBe('*');
    expect(paths).toEqual(['my-tasks', 'on-page', '*']);
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

  it('⑪ nav 的 main 组必须有宿主消费者（产品官 10-07 走查发现的第二个死开关）', () => {
    // 缺口：`PluginNavItem.group` 声明 'main' | 'agent'，但 SidebarNav 只 filter 了
    // 'agent' ⇒ weekly-report 那类 main 组插件启用后侧栏无入口（路由仍可达），
    // 表现就是「设置里开着、侧栏什么都没有」。
    // 锁法：读 SidebarNav 源码，必须同时出现 main 与 agent 两族的 filter。
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { resolve } = require('node:path') as typeof import('node:path');
    const src = readFileSync(resolve(__dirname, '..', 'src/components/layout/SidebarNav.tsx'), 'utf8');
    expect(src).toContain("filter((n) => n.group === 'main')");
    expect(src).toContain("filter((n) => n.group === 'agent')");
  });

  it('⑩ 每个内置插件的开关都有真实消费者（防再出现「死开关」）', () => {
    // 产品官 10-06 走查发现：sample-projects 的 manifest 在、设置里有开关，但
    // 全仓没有任何地方问过它 ⇒ 用户拨开关没有任何反应（死开关）。
    // 锁法：扫 src/ 全部 ts/tsx，每个内置插件 id 必须以 usePluginEnabled('<id>')
    // 的形态被显式消费至少一次。manifest 的 nav/routes 由 ①②③④ 条覆盖。
    const { readFileSync, readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const { join, resolve } = require('node:path') as typeof import('node:path');
    const srcFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir)) {
        const f = join(dir, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (e.endsWith('.ts') || e.endsWith('.tsx')) srcFiles.push(f);
      }
    };
    walk(join(resolve(__dirname, '..'), 'src'));
    const allSrc = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
    // 每个插件必须落进下面**至少一类**（真实的两种合法消费形态）：
    //   A. 显式 hook：`usePluginEnabled('<id>')`（入口型消费者，如侧栏的示例项目）
    //   B. manifest 声明贡献：nav/routes（页面型消费者，注册表统一装配）
    // 两类都没有 ⇒ 那枚开关拨过去没有任何反应 = 死开关。
    const contributionRe = /(nav|routes|settingsSlot):/;
    for (const id of BUILTIN_IDS) {
      const byHook = allSrc.includes(`usePluginEnabled('${id}')`);
      const manifestFile = srcFiles.find(
        (f) => /manifest\.tsx?$/.test(f) && readFileSync(f, 'utf8').includes(`id: '${id}'`),
      );
      const byContribution =
        manifestFile !== undefined && contributionRe.test(readFileSync(manifestFile!, 'utf8'));
      expect(
        byHook || byContribution,
        `插件 ${id} 既没有显式消费者也没有 manifest 贡献（死开关）`,
      ).toBe(true);
    }
  });

  it('⑨ 键名单一出处（key 形如 plugin.enabled.<id>）', () => {
    expect(pluginEnabledKey('agent-board')).toBe('plugin.enabled.agent-board');
  });
});
