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
// ⑩-b 的扫描器用 TypeScript AST。**必须是顶层 import 而非函数内 require**：
// `ts.Node` 这类**类型位置**的用法要求 `ts` 在类型层可见，而
// `const ts = require('typescript')` 只是**值**绑定 ⇒ tsc 报
// 「Cannot find namespace 'ts'」（tsconfig.tests.json 下实测 2 条）。
// 同仓既有写法：`tests/print-copy-no-agent.spec.ts:45` 也是顶层 `import ts from 'typescript'`。
import ts from 'typescript';
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

  /* ══════════════════════════════════════════════════════════════════════════════════
   * ⑩-b · **入口点级**门控闸门（复核者 #2b：⑩ 抓不到「漏了几处」）
   *
   * ── 为什么 ⑩ 不够（这是本条存在的全部理由）──
   *   ⑩ 的判据是 `byHook || byContribution`，即「该插件**至少**有一处消费」。
   *   实测：`sample-projects` 的 `byContribution` 为 false（manifest 没有 nav/routes
   *   这三键时它恒 false），于是 ⑩ 的绿灯**完全靠 `Sidebar.tsx` 那一处 hook 撑着**。
   *   ⇒ 同一插件有 N 个入口、只门控了 1 个，⑩ 永远看不见。「入口数 ≠ 门控数」这类
   *     漏法（实测发生过：`MobileMoreMenu` 的 ⋮ 菜单入口当时零门控）活到今天的原因就在这。
   *
   * ── 本条的三条性质（缺一条就是半假闸门）──
   *   ① **调用点集合被逐点钉死**：`src/**` 里 `loadDemo(` 的调用点集合必须与下面
   *      `LOAD_DEMO_SITES` 登记清单**严格一一对应**（文件集合 + 每文件个数 + 行内锚点）
   *      ⇒ 任何人**在别处新加一处 `loadDemo()`**（含"某文件里已有 hook 再塞第二处"）
   *      都会红，逼他显式决定「门控它，还是登记豁免并写清理由」。
   *   ② **未豁免的调用点必须受门控，且是**调用点自身作用域**内受门控**：
   *      从该调用点向上、最多穿过一层回调（handler）后，必须能取到一个含
   *      `usePluginEnabled('sample-projects')` 消费变量的条件表达式。
   *      ⚠️ 「文件里出现了 hook」不够 —— 那正是复核者要撞的半假形态。
   *   ③ **豁免点必须带得出可读理由**：理由正文逐字出现在调用点上方的注释里，
   *      删掉理由即红（豁免不许裸奔）。
   *
   * ── 判据实现用 TypeScript AST，不用 grep ──
   *   `loadDemo(` 的文本匹配会命中三类**不是调用点**的东西（实测都在仓里）：
   *   `useBackupIo.tsx` 的接口签名 `loadDemo(): Promise<void>;`、注释里的
   *   `` `useBackupIo().loadDemo` ``、以及 `x.loadDemo()` 这类成员调用。
   *   AST 天然只看「标识符 `loadDemo` 的 CallExpression」⇒ 零误报。
   *
   * ── 变异实测（本条落地时逐条撞过，记录在此供复核复现）──
   *   M1 新建一个含 `loadDemo()` 的 src 文件            ⇒ ① 红（文件集合不符）
   *   M2 在已门控文件里再塞一处未门控 `loadDemo()`      ⇒ ① 红（该文件个数 2≠1）+ ② 红
   *   M3 把某处 `sampleProjectsOn &&` 删掉              ⇒ ② 红
   *   M4 删掉首启卡那段豁免理由注释                     ⇒ ③ 红
   *   M5（复核者 `audit-nas-logic` 独立夹具）把既有站点的
   *      `{sampleProjectsOn && (` 摘成 `{isAdmin && (`  ⇒ ② 红。**引这条的理由最准**：
   *      「…的调用点作用域里没有门控项『sampleProjectsOn』：**『文件里有 hook』不算数
   *        —— 这一处调用点必须自己站在门里**」——它撞的是**真实的取消门控回归**（当初那个 bug
   *      本就是这个动作），比 M1/M2 更能说明判据强度（M1/M2 只证明「文件集合那条拦住了」）。
   *   M6（同夹具，干净读数）同文件第二个未门控调用点 ⇒ ① 红（`expected 2 to be 1`）
   *   M-A 把 `Sidebar` 的解构行改成多行（**纯格式改动**，语义等价）⇒ **绿**：
   *      判据锚的是「门控表达式」（`gateTokens` 比对调用点作用域的左式），**不读解构行** ⇒
   *      抗邻近编辑（在解构里多/少一个字段不会误红；旧形态锚「整行写法」就会红）。
   *   M-B 摘掉该入口门控里的 `isAdmin`                     ⇒ ② 红（事实没被放松）
   *
   * ── 纪律：变异探针（踩过一次，别删这段）──
   *   2026-10-14 共享工作树上曾**同时**存在多条临时探针（其中一条被直接写进了本表登记的
   *   `MobileMoreMenu.tsx`），导致一条读数（`3≠1`）**无法归因**、只能作废。⇒ 两条纪律：
   *     ① **变异探针必须带唯一可识别标记**（形如 `MUTANT-PROBE-<谁>-<序号>`）、**用完即撤**，
   *        并在收尾用 `git diff --stat -- <文件>` 自证已复原（本仓已有
   *        `scripts/verify-test-discriminative.mjs` 走「干净工作树 + finally 还原」的正规路子，
   *        手工探针只是它的降级用法）；
   *     ② **跨文件做变异要先跟该文件的负责人说一声** —— 在别人正在改的文件里插探针，
   *        等于把两个人的读数搅进同一个数里，谁都说不清哪个变异红了。
   * ══════════════════════════════════════════════════════════════════════════════════ */

  /**
   * `loadDemo()` 的**全部登记调用点**（4 处 = 门控 3 + 有意豁免 1）。
   *
   * `anchor` 是**该调用点所在行**的稳定片段（不是行号：行会漂移，文本会跟着改才对）。
   * 新增/删除/移动入口 ⇒ 本表必须同步改 ⇒ 改的人必须回答「门控它，还是豁免它」。
   */
  const LOAD_DEMO_SITES = [
    {
      file: 'src/components/layout/Sidebar.tsx',
      anchor: 'onClick={() => void loadDemo()}',
      mode: 'hook',
      // 双重门控逐字要求写在**调用点作用域**里（不是「文件里出现过」）：
      // 插件开关那一半 + isAdmin 那一半。少任何一半 ⇒ 红。
      gateTokens: ['sampleProjectsOn', 'isAdmin'],
    },
    {
      file: 'src/components/layout/MobileMoreMenu.tsx',
      anchor: 'void loadDemo();',
      mode: 'hook',
      gateTokens: ['sampleProjectsOn', 'isAdmin'],
    },
    {
      file: 'src/components/settings/SampleProjectsSettings.tsx',
      anchor: 'void loadDemo().finally(() => setBusy(false));',
      // 机制型门控：该按钮住在 `manifest.settingsSlot` 里，插件停用 ⇒
      // `PluginSettingsSlot` 返回 null ⇒ 组件根本不挂载 ⇒ 按钮不可达（见 ② 的机制断言）。
      mode: 'slot-mechanism',
    },
    {
      file: 'src/components/layout/FirstRunGuide.tsx',
      anchor: 'void loadDemo().finally(() => setImporting(false));',
      // ★ 已与产品确认的**决定**（不是待办）：本处有意豁免。理由必须逐字写在调用点上方。
      // 片段取自 FirstRunGuide 那段注释的**原文**（含正文措辞，不是自造的摘要）——
      // 谁把这段理由删了/改空了，本条即红。
      //
      // ⚠️ **依赖声明（写在这里是刻意的）**：本判据依赖 `FirstRunGuide.tsx` 里那段
      //    豁免理由注释**存在**；谁回滚那段文字，本闸门会红 —— 这是**有意**的，
      //    它防止「豁免理由被静默删掉、只剩一个没有理由的豁免点」。
      //    所以撞红时先看那段注释是不是被人删/改了，别以为是闸门坏了。
      mode: 'exempt',
      reasons: [
        '有意不受插件开关约束',
        '已与产品确认的决定，不是待办',
        '本卡只在**空库**时渲染',
        'defaultEnabled',
        '一起决定',
      ],
    },
  ] as const;

  /** 调用点自证与扫描共用的实现（抽出来才能在 ⑩-b-自证 里对合成源码断言） */
  const buildLoadDemoScanner = (): {
    scan: (files: Array<{ file: string; text: string }>) => Array<{
      file: string;
      line: number;
      lineText: string;
      gates: string[];
    }>;
  } => {
    const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
    return {
      scan: (files) => {
        const out: Array<{ file: string; line: number; lineText: string; gates: string[] }> = [];
        for (const { file, text } of files) {
          const sf = ts.createSourceFile(
            file,
            text,
            ts.ScriptTarget.ESNext,
            true,
            file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
          );
          const visit = (node: ts.Node): void => {
            if (
              ts.isCallExpression(node) &&
              ts.isIdentifier(node.expression) &&
              node.expression.text === 'loadDemo'
            ) {
              const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
              // 从调用点向上收集条件表达式，**最多穿过一层回调**（见 ② 的说明）。
              const gates: string[] = [];
              let crossedFunctions = 0;
              let cur: ts.Node | undefined = node;
              while (cur) {
                if (
                  ts.isFunctionDeclaration(cur) ||
                  ts.isFunctionExpression(cur) ||
                  ts.isArrowFunction(cur) ||
                  ts.isMethodDeclaration(cur)
                ) {
                  crossedFunctions += 1;
                  if (crossedFunctions > 1) break;
                }
                if (
                  ts.isBinaryExpression(cur) &&
                  cur.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
                ) {
                  gates.push(collapse(cur.left.getText(sf)));
                } else if (ts.isConditionalExpression(cur)) {
                  gates.push(collapse(cur.condition.getText(sf)));
                } else if (ts.isIfStatement(cur)) {
                  gates.push(collapse(cur.expression.getText(sf)));
                }
                cur = cur.parent;
              }
              out.push({ file, line: pos.line + 1, lineText: collapse(text.split('\n')[pos.line] ?? ''), gates });
            }
            ts.forEachChild(node, visit);
          };
          visit(sf);
        }
        return out;
      },
    };
  };

  it('⑩-b 自证：扫描器只认「标识符 loadDemo 的调用表达式」，且能分辨门控与未门控', () => {
    const { scan } = buildLoadDemoScanner();
    const synthetic = [
      '// 注释里的 loadDemo() 不算',
      "import { useBackupIo } from './useBackupIo';",
      'export interface Io { loadDemo(): Promise<void>; }',
      'declare const backup: { loadDemo(): void };',
      'void backup.loadDemo();',
      'export function A({ on, h }: { on: boolean; h: () => void }): null {',
      '  const loadDemo = h;',
      '  return on ? (void loadDemo(), null) : null;',
      '}',
      'export function B({ h }: { h: () => void }): null {',
      '  const loadDemo = h;',
      '  return <button onClick={() => void loadDemo()} />;',
      '}',
    ].join('\n');
    const sites = scan([{ file: 'synthetic.tsx', text: synthetic }]);
    // 只有 A 的三元 / B 的裸调用两处是真调用点：
    //   注释 ✗、interface 签名 ✗、成员调用 backup.loadDemo() ✗
    expect(sites.length, '只应识别两处真调用点').toBe(2);
    expect(sites[0]!.gates.join('|'), '三元条件必须被当成门控上下文').toContain('on');
    expect(sites[1]!.gates, 'B 处没有任何门控 ⇒ gates 必须为空（否则判据会假绿）').toEqual([]);
  });

  it('⑩-b 动作型插件的每个 loadDemo 调用点都必须受门控，或带理由登记为豁免', () => {
    const { readFileSync, readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const { join, relative, resolve, sep, posix } = require('node:path') as typeof import('node:path');
    const root = resolve(__dirname, '..');
    const absFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir)) {
        const f = join(dir, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (e.endsWith('.ts') || e.endsWith('.tsx')) absFiles.push(f);
      }
    };
    walk(join(root, 'src'));
    const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8');

    const { scan } = buildLoadDemoScanner();
    const sites = scan(
      absFiles.map((abs) => ({
        file: relative(root, abs).split(sep).join(posix.sep),
        text: readFileSync(abs, 'utf8'),
      })),
    );
    const byFile = new Map<string, number>();
    for (const s of sites) byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1);

    /* ① 调用点集合 = 登记清单（逐点一一对应；新增一处就红） */
    expect(
      [...byFile.keys()].sort(),
      'src/ 里出现 loadDemo 调用点的**文件集合**与登记清单不一致：\n' +
        '新增入口必须显式决定「门控它，还是登记豁免并写清理由」，改 tests/plugin-registry.spec.ts 的 LOAD_DEMO_SITES。',
    ).toEqual([...LOAD_DEMO_SITES.map((s) => s.file)].sort());
    for (const site of LOAD_DEMO_SITES) {
      expect(
        byFile.get(site.file) ?? 0,
        `${site.file} 的 loadDemo 调用点个数应为 1（多于 1 = 该文件里又多了未登记的入口）`,
      ).toBe(1);
    }

    for (const site of LOAD_DEMO_SITES) {
      const at = sites.find((s) => s.file === site.file)!;
      expect(at.lineText, `${site.file}:${at.line} 的行内锚点与登记不符（锚点=稳定片段，不用行号）`).toContain(
        site.anchor,
      );

      if (site.mode === 'hook') {
        // ② 调用点**自身作用域**里的门控（不是「文件里有 hook」就算数）
        const scope = at.gates.join(' | ');
        for (const token of site.gateTokens) {
          expect(
            scope,
            `${site.file}:${at.line} 的调用点作用域里没有门控项「${token}」：` +
              '「文件里有 hook」不算数 —— 这一处调用点必须自己站在门里',
          ).toContain(token);
        }
        expect(
          read(site.file),
          `${site.file} 缺少插件开关的读取点（usePluginEnabled('sample-projects')）`,
        ).toContain("usePluginEnabled('sample-projects')");
      }

      if (site.mode === 'slot-mechanism') {
        // 机制型门控不靠调用点作用域，靠「插件停用 ⇒ slot 不挂载」。两条**实现处**的锚点：
        //   ① 壳层只在启用分支渲染 slot（停用分支渲染状态说明）；
        //   ② `PluginSettingsSlot` 自判启用态后返回 null。
        // 行为面另由 tests/plugin-ui-gating.spec.tsx 的真渲染用例钉住（node 环境渲染不了）。
        expect(read('src/components/settings/PluginsSection.tsx')).toMatch(
          /enabled \? \(\s*<PluginSettingsSlot pluginId=\{manifest\.id\} \/>/,
        );
        expect(read('src/core/plugin/PluginRegistryProvider.tsx')).toContain(
          'if (!Slot || !isPluginEnabled(',
        );
      }

      if (site.mode === 'exempt') {
        // ③ 豁免必须带可读理由，且理由写在**调用点上方**（删理由即红）
        const lines = read(site.file).split('\n');
        const above = lines.slice(Math.max(0, at.line - 31), at.line - 1).join('\n');
        for (const reason of site.reasons) {
          expect(
            above,
            `${site.file}:${at.line} 上方 30 行内缺少豁免理由片段「${reason}」——豁免不许裸奔`,
          ).toContain(reason);
        }
      }
    }
  });

  it('⑨ 键名单一出处（key 形如 plugin.enabled.<id>）', () => {
    expect(pluginEnabledKey('agent-board')).toBe('plugin.enabled.agent-board');
  });
});
