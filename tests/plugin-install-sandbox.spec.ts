// @vitest-environment node
/**
 * 插件「从文件安装」· 守卫 spec（L2 · v0.8.6）
 *
 * ══════════════════════ 这个 spec 在守什么 ══════════════════════
 * 从文件安装 = 让第三方代码在本机跑起来。安全官红线 + 探路实测判决凝成七条锁：
 *
 *   ① **沙箱属性静态锁**：`sandbox` 只允许 `allow-scripts`，永远不许出现
 *      `allow-same-origin`（同世界 IIFE 实测能 indexedDB.open 直读宿主私有数据；
 *      沙箱 iframe 五项全 SecurityError，加 same-origin 即全裸）。锁法仿
 *      third-party-plugin-readonly.spec.ts：读源码文本断言（跑一遍只能证明
 *      「这次没写」，提交时静态扫才能拦住「将来有人写」）；
 *   ② **协议与通道锁**：main.cjs 注册 plug:// 的 five privileges、preload 只
 *      暴露四个插件方法；四个 IPC 通道在主进程与 preload **双侧存在**
 *      （少一侧 = 装了假死：按钮点了没反应）；
 *   ③ **MIME 锁**：`.js` 必须 text/javascript（坏 MIME 让 import 静默失败——
 *      探路实测踩过），未知扩展名绝不回退 text/html（404 伪装成白屏更难查）；
 *   ④ **协议路径锁**：plug:// 防穿越（含编码 .. 的跨插件读取）、404 不回落；
 *   ⑤ **文件语义锁**：同名 id 整目录覆盖写（无孤儿文件）、坏 id / 坏 entry /
 *      体积超限一律拒、卸载幂等且只删自家目录；
 *   ⑥ **扫描口径锁**：登记入口唯一、坏 manifest fail-open 跳过并带理由、
 *      minHostVersion 门、写能力在扫描侧就夹掉；
 *   ⑦ **合并口径锁**：合并进注册表后 defaultEnabled **恒 false**（isPluginEnabled
 *      首见即 false）、capabilities 只留 data.read、内置同名优先、自装插件
 *      **不可能**带 routes/nav/settingsSlot（磁盘 JSON 变不出 React 组件）。
 *
 * 纪律：CJS 主进程模块直 require（与 ingress-file.main.spec.ts 同一范式）；
 * 合并纯函数从 src 直接 import；静态断言全部基于真实文件路径，不 mock。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  PLUGIN_MSG,
  isHtmlEntry,
  mergeInstalledManifests,
  pluginEntryUrl,
} from '../src/core/plugin/installed';
import type { InstalledPluginManifest } from '../src/core/plugin/installed';
import { isPluginEnabled } from '../src/core/plugin/registry';
import type { PluginManifest } from '../src/core/plugin/types';

// CJS 主进程模块（node 环境直 require）
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pluginInstall = require('../electron/plugin-install.cjs') as {
  MAX_PLUGIN_TOTAL_BYTES: number;
  pluginsRoot(userDataDir: string): string;
  validatePluginManifest(raw: unknown): { ok: boolean; manifest?: Record<string, unknown>; reason?: string };
  isHostAtLeast(host: string, min: string): boolean;
  installPluginFromDirectory(
    userDataDir: string,
    manifestFilePath: string,
  ): { ok: boolean; manifest?: Record<string, unknown>; fileCount?: number; reason?: string };
  uninstallPlugin(userDataDir: string, id: unknown): { ok: boolean; reason?: string };
  scanInstalledPlugins(
    userDataDir: string,
    hostVersion: string,
  ): {
    ok: boolean;
    installed: Array<Record<string, unknown>>;
    skipped: Array<{ dir: string; reason: string }>;
  };
  plugMimeFor(ext: string): string;
  resolvePlugFile(userDataDir: string, url: string): { status: number; filePath?: string; mime?: string };
};

const REPO = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

/* ══════════════════════════════════════════════════════════════════════════
 * ① 沙箱属性静态锁（本 spec 的第一红线）
 * ══════════════════════════════════════════════════════════════════════════ */

/** 剥掉块注释与行注释后再做「源码不得出现某字面量」断言——注释里解释红线为什么存在不误伤 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('① 沙箱 iframe：sandbox 串静态锁', () => {
  const src = read('src/core/plugin/PluginSandboxFrame.tsx');
  const code = stripComments(src);

  it('sandbox 属性钉死为 allow-scripts（v1 唯一加载形态）', () => {
    expect(code).toContain("setAttribute('sandbox', 'allow-scripts')");
  });

  it('★ 代码里永远不许出现 allow-same-origin（加了它沙箱即刻逃逸，Chromium 自己都警告）', () => {
    expect(code).not.toContain('allow-same-origin');
    // 引号变体也拦掉：不允许该字面量以任何引号形态出现在代码里
    expect(code.replace(/'/g, '"')).not.toContain('allow-same-origin');
  });

  it('宿主侧不得给 iframe 开 allow 属性之类的旁路', () => {
    expect(code).not.toMatch(/iframe\.allow\s*=/);
    expect(code).not.toContain('allow-downloads');
    expect(code).not.toContain('allow-forms');
  });

  it('插件宿主必须真的被 AppShell 常驻挂载（锁的不是死代码）', () => {
    const shell = read('src/components/layout/AppShell.tsx');
    expect(shell).toContain('<PluginFrameHost');
    expect(shell).toContain('useActiveInstalledPlugin');
    // 常驻（不停用即卸载）是 unmount 握手成立的前提：宿主的 div 不能随停用被 React 摘掉
    const host = read('src/core/plugin/PluginSandboxFrame.tsx');
    expect(host).toContain('data-plugin-host');
    expect(host).toMatch(/const hostRef = useRef<HTMLDivElement \| null>\(null\);/);
  });

  it('IIFE 契约四件套在宿主注入代码里（mount(api) / unmount / 快照 / ready 握手）', () => {
    expect(code).toContain('window.IDPlanPlugin');
    expect(code).toContain('P.mount(api)');
    expect(code).toContain('handle.unmount');
    // ready 握手的消息类型必须走单一出处（installed.ts 的 PLUGIN_MSG）
    expect(PLUGIN_MSG.ready).toBe('idplan-plugin-ready');
    expect(code).toContain('JSON.stringify(PLUGIN_MSG)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 协议与 IPC 通道静态锁
 * ══════════════════════════════════════════════════════════════════════════ */

describe('② plug:// 协议与 IPC 通道', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');

  it('main.cjs 注册 plug 为特权协议，privileges 与 app:// 同组（five privileges ×2）', () => {
    expect(main).toContain("const PLUGIN_PROTOCOL = 'plug'");
    expect(main).toContain('scheme: PLUGIN_PROTOCOL');
    for (const priv of [
      'standard: true',
      'secure: true',
      'supportFetchAPI: true',
      'corsEnabled: true',
      'stream: true',
    ]) {
      // app:// 与 plug:// 各一份 ⇒ 至少出现两次
      expect(main.split(priv).length - 1, `${priv} 应出现两次`).toBeGreaterThanOrEqual(2);
    }
  });

  it('plug 协议处理器在 whenReady 里真的注册了', () => {
    expect(main).toContain('function registerPlugProtocol()');
    expect(main).toContain('registerPlugProtocol();');
  });

  it('四个 IPC 通道在主进程与 preload 双侧存在（少一侧 = 假死）', () => {
    for (const ch of ['plugin:pick-file', 'plugin:install', 'plugin:uninstall', 'plugin:list']) {
      expect(main, `main.cjs 缺 ${ch}`).toContain(ch);
      expect(preload, `preload.cjs 缺 ${ch}`).toContain(ch);
    }
  });

  it('preload 的插件桥只暴露四个方法，且不泄露 ipcRenderer 本体', () => {
    expect(preload).toContain('pluginInstall: {');
    expect(preload).not.toMatch(/exposeInMainWorld\('ipcRenderer'/);
    const start = preload.indexOf('pluginInstall: {');
    const end = preload.indexOf('},', start);
    const block = preload.slice(start, end);
    const keys = [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
    expect(keys).toEqual(['pickManifestFile', 'installFromFile', 'listInstalled', 'uninstall']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ MIME 与协议路径
 * ══════════════════════════════════════════════════════════════════════════ */

describe('③ plugMimeFor：.js 必须 text/javascript', () => {
  it('.js / .mjs ⇒ text/javascript（坏 MIME 被 Chromium 严格校验直接拒）', () => {
    expect(pluginInstall.plugMimeFor('.js')).toBe('text/javascript; charset=utf-8');
    expect(pluginInstall.plugMimeFor('.mjs')).toBe('text/javascript; charset=utf-8');
    expect(pluginInstall.plugMimeFor('.JS')).toBe('text/javascript; charset=utf-8');
  });

  it('.html / .json / .css 各自正确', () => {
    expect(pluginInstall.plugMimeFor('.html')).toBe('text/html; charset=utf-8');
    expect(pluginInstall.plugMimeFor('.json')).toBe('application/json');
    expect(pluginInstall.plugMimeFor('.css')).toBe('text/css; charset=utf-8');
  });

  it('★ 未知扩展名一律 octet-stream，绝不回退 text/html（404 伪装成白屏比报错更难查）', () => {
    expect(pluginInstall.plugMimeFor('.xyz')).toBe('application/octet-stream');
    expect(pluginInstall.plugMimeFor('')).toBe('application/octet-stream');
    expect(pluginInstall.plugMimeFor('.xyz').startsWith('text/html')).toBe(false);
  });
});

describe('④ resolvePlugFile：防穿越 + 404 不回落', () => {
  let userData: string;
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'idplan-plugfs-'));
    const dir = join(pluginInstall.pluginsRoot(userData), 'demo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.js'), 'window.IDPlanPlugin={};');
    writeFileSync(join(dir, 'manifest.json'), '{"id":"demo"}');
    const other = join(pluginInstall.pluginsRoot(userData), 'other');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'secret.json'), '{"id":"other"}');
  });
  afterEach(() => rmSync(userData, { recursive: true, force: true }));

  it('合法请求 200 且 MIME 正确', () => {
    const r = pluginInstall.resolvePlugFile(userData, 'plug://demo/index.js');
    expect(r.status).toBe(200);
    expect(r.mime).toBe('text/javascript; charset=utf-8');
  });

  it('★ 编码 .. 的跨插件读取被挡（WHATWG URL 解析即归一化，落点也必须在自家目录内 ⇒ 非 200）', () => {
    const r = pluginInstall.resolvePlugFile(userData, 'plug://demo/%2e%2e/other/secret.json');
    // 不允许 200（绝不能把 other 的 secret 服出来）；403/404 都算挡住
    expect(r.status).not.toBe(200);
    expect([403, 404]).toContain(r.status);
  });

  it('裸 .. 同样被挡（URL 规范化 + 目录校验双重）', () => {
    const r = pluginInstall.resolvePlugFile(userData, 'plug://demo/../other/secret.json');
    expect([403, 404]).toContain(r.status);
    expect(r.status).not.toBe(200);
  });

  it('不存在的文件 404（不回落 index.html）', () => {
    expect(pluginInstall.resolvePlugFile(userData, 'plug://demo/missing.js').status).toBe(404);
  });

  it('目录根无默认文档 ⇒ 404', () => {
    expect(pluginInstall.resolvePlugFile(userData, 'plug://demo/').status).toBe(404);
    expect(pluginInstall.resolvePlugFile(userData, 'plug://demo').status).toBe(404);
  });

  it('非法 hostname（大写 / 空）⇒ 403', () => {
    expect(pluginInstall.resolvePlugFile(userData, 'plug://Demo/index.js').status).toBe(403);
    expect(pluginInstall.resolvePlugFile(userData, 'plug:///index.js').status).toBe(403);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 安装 / 卸载的文件语义（探路实测 6/6 的那一组，升级为常驻单测）
 * ══════════════════════════════════════════════════════════════════════════ */

const GOOD_MANIFEST = {
  id: 'demo-iife',
  name: '演示插件',
  summary: '守卫 spec 用',
  version: '1.0.0',
  entry: 'index.js',
  capabilities: ['data.read'],
};

/** 在 srcBase 下写一个最小插件目录，返回 manifest.json 路径 */
function writePluginSrc(
  base: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): string {
  const dir = join(base, 'src-plugin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(dir, 'index.js'),
    'window.IDPlanPlugin={mount:function(){return{unmount:function(){}};}};',
  );
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return join(dir, 'manifest.json');
}

describe('⑤ 安装 / 卸载文件语义', () => {
  let userData: string;
  let srcBase: string;
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'idplan-pluginstall-'));
    srcBase = mkdtempSync(join(tmpdir(), 'idplan-plugsrc-'));
  });
  afterEach(() => {
    rmSync(userData, { recursive: true, force: true });
    rmSync(srcBase, { recursive: true, force: true });
  });

  it('合法安装：manifest + 产物整目录落盘', () => {
    const p = writePluginSrc(srcBase, GOOD_MANIFEST, { 'extra.css': 'body{}' });
    const res = pluginInstall.installPluginFromDirectory(userData, p);
    expect(res.ok).toBe(true);
    const dir = join(pluginInstall.pluginsRoot(userData), 'demo-iife');
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(dir, 'index.js'))).toBe(true);
    expect(existsSync(join(dir, 'extra.css'))).toBe(true);
    expect(res.fileCount).toBe(3);
  });

  it('★ 同名 id 覆盖写 = 整目录替换（merge 会留孤儿文件，这里不许）', () => {
    const p1 = writePluginSrc(srcBase, GOOD_MANIFEST, { 'obsolete.js': 'old' });
    expect(pluginInstall.installPluginFromDirectory(userData, p1).ok).toBe(true);
    // 换一个不带 obsolete.js 的源目录再装一次（版本也变）
    const src2 = mkdtempSync(join(tmpdir(), 'idplan-plugsrc2-'));
    const p2 = writePluginSrc(src2, { ...GOOD_MANIFEST, version: '2.0.0' });
    const res = pluginInstall.installPluginFromDirectory(userData, p2);
    expect(res.ok).toBe(true);
    const dir = join(pluginInstall.pluginsRoot(userData), 'demo-iife');
    expect(existsSync(join(dir, 'obsolete.js'))).toBe(false); // 旧版产物必须消失
    const onDisk = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(onDisk.version).toBe('2.0.0'); // 版本号即「用户看得出装了哪版」的载体
    rmSync(src2, { recursive: true, force: true });
  });

  it('坏 id 一律拒（穿越 / 大写 / 空 / 超长 / 首字符中划线），且不落任何目录', () => {
    const badIds = ['..', 'a/b', 'a\\b', 'Demo', '', 'x'.repeat(65), '-lead', '.', 'a b', '../evil'];
    for (const id of badIds) {
      const p = writePluginSrc(srcBase, { ...GOOD_MANIFEST, id });
      const res = pluginInstall.installPluginFromDirectory(userData, p);
      expect(res.ok, `id="${id}" 必须被拒`).toBe(false);
      expect(res.reason, `id="${id} 要带中文理由`).toBeTruthy();
    }
    // plugins 根下什么都没落下
    const root = pluginInstall.pluginsRoot(userData);
    const left = existsSync(root) ? readdirSafe(root) : [];
    expect(left).toEqual([]);
  });

  it('entry 缺失 / 带路径 / 文件不在目录里 ⇒ 拒', () => {
    const noEntry = writePluginSrc(srcBase, { ...GOOD_MANIFEST, entry: undefined });
    expect(pluginInstall.installPluginFromDirectory(userData, noEntry).ok).toBe(false);
    const slashEntry = writePluginSrc(srcBase, { ...GOOD_MANIFEST, entry: 'sub/index.js' });
    expect(pluginInstall.installPluginFromDirectory(userData, slashEntry).ok).toBe(false);
    const missingFile = writePluginSrc(srcBase, { ...GOOD_MANIFEST, entry: 'nope.js' });
    expect(pluginInstall.installPluginFromDirectory(userData, missingFile).ok).toBe(false);
  });

  it('manifest.json 不是合法 JSON ⇒ 拒且带中文理由', () => {
    const dir = join(srcBase, 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), '{ not json');
    const res = pluginInstall.installPluginFromDirectory(userData, join(dir, 'manifest.json'));
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('manifest.json');
  });

  it('体积超 5MB ⇒ 拒（v1 粗限，防病态安装）', () => {
    const big = writePluginSrc(srcBase, GOOD_MANIFEST, { 'big.bin': 'x'.repeat(6 * 1024 * 1024) });
    const res = pluginInstall.installPluginFromDirectory(userData, big);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('5MB');
  });

  it('从已安装目录里重装被拒（先 rm 再复制会连源一起删）', () => {
    const p = writePluginSrc(srcBase, GOOD_MANIFEST);
    expect(pluginInstall.installPluginFromDirectory(userData, p).ok).toBe(true);
    const inside = join(pluginInstall.pluginsRoot(userData), 'demo-iife', 'manifest.json');
    expect(pluginInstall.installPluginFromDirectory(userData, inside).ok).toBe(false);
  });

  it('卸载：删目录（幂等）；坏 id 拒；绝不碰 plugins 之外', () => {
    const p = writePluginSrc(srcBase, GOOD_MANIFEST);
    pluginInstall.installPluginFromDirectory(userData, p);
    const dir = join(pluginInstall.pluginsRoot(userData), 'demo-iife');
    expect(existsSync(dir)).toBe(true);
    expect(pluginInstall.uninstallPlugin(userData, 'demo-iife').ok).toBe(true);
    expect(existsSync(dir)).toBe(false);
    // 再卸一次仍然 ok（幂等：崩在中点最坏是幽灵目录，启动扫描自然不管它）
    expect(pluginInstall.uninstallPlugin(userData, 'demo-iife').ok).toBe(true);
    // 穿越 id 拒
    expect(pluginInstall.uninstallPlugin(userData, '..').ok).toBe(false);
    // plugins 根目录本身还在（父目录保留）
    expect(existsSync(pluginInstall.pluginsRoot(userData))).toBe(true);
  });
});

/** readdirSync 的薄封装（spec 里少一处 import 噪音） */
function readdirSafe(dir: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsx = require('node:fs') as typeof import('node:fs');
  return fsx.readdirSync(dir);
}

/* ══════════════════════════════════════════════════════════════════════════
 * ⑥ 启动扫描：登记入口唯一，坏 manifest fail-open 跳过
 * ══════════════════════════════════════════════════════════════════════════ */

describe('⑥ 启动扫描（坏 manifest 不拖垮整个插件系统）', () => {
  let userData: string;
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'idplan-plugscan-'));
    const root = pluginInstall.pluginsRoot(userData);
    const put = (id: string, manifest: unknown): void => {
      const dir = join(root, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'manifest.json'),
        typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
      );
    };
    put('good', { ...GOOD_MANIFEST, id: 'good' });
    put('good-html', { ...GOOD_MANIFEST, id: 'good-html', entry: 'index.html' });
    put('bad-json', '{ 坏');
    put('no-manifest', {});
    rmSync(join(root, 'no-manifest', 'manifest.json')); // 空目录：没有 manifest
    put('future', { ...GOOD_MANIFEST, id: 'future', minHostVersion: '9.9.9.9' });
    put('compatible', { ...GOOD_MANIFEST, id: 'compatible', minHostVersion: '0.0.0.1' });
    put('evil', { ...GOOD_MANIFEST, id: 'evil', capabilities: ['data.read', 'data.write.proposal'] });
    // 目录名与 manifest.id 不一致（手拷目录的典型事故）：装上是死的，跳过并说明
    put('mismatched', GOOD_MANIFEST);
  });
  afterEach(() => rmSync(userData, { recursive: true, force: true }));

  it('好的登记；坏的跳过且带理由（bad-json / future / no-manifest / mismatched 四类）', () => {
    const scan = pluginInstall.scanInstalledPlugins(userData, '0.8.6.0000');
    const ids = scan.installed.map((m) => m.id).sort();
    expect(ids).toEqual(['compatible', 'evil', 'good', 'good-html']);
    const skippedDirs = scan.skipped.map((s) => s.dir).sort();
    expect(skippedDirs).toEqual(['bad-json', 'future', 'mismatched', 'no-manifest']);
    expect(scan.skipped.find((s) => s.dir === 'future')?.reason).toContain('9.9.9.9');
    expect(scan.skipped.find((s) => s.dir === 'mismatched')?.reason).toContain('不一致');
  });

  it('扫描出来的 manifest：capabilities 已夹到 data.read（写能力 v1 不存在）', () => {
    const scan = pluginInstall.scanInstalledPlugins(userData, '0.8.6.0000');
    const evil = scan.installed.find((m) => m.id === 'evil');
    expect(evil?.capabilities).toEqual(['data.read']);
  });

  it('plugins 目录不存在 = 什么都没装（常态，不抛错）', () => {
    const empty = mkdtempSync(join(tmpdir(), 'idplan-plugempty-'));
    const scan = pluginInstall.scanInstalledPlugins(empty, '0.8.6.0000');
    expect(scan.installed).toEqual([]);
    expect(scan.skipped).toEqual([]);
    rmSync(empty, { recursive: true, force: true });
  });

  it('isHostAtLeast：min 无法解析时放行（不因我方解析不了拦住用户的插件）', () => {
    expect(pluginInstall.isHostAtLeast('0.8.6.0000', '0.8.6.0000')).toBe(true);
    expect(pluginInstall.isHostAtLeast('0.8.6.0000', '0.8.7')).toBe(false);
    expect(pluginInstall.isHostAtLeast('0.9.0.0000', '0.8.7')).toBe(true);
    expect(pluginInstall.isHostAtLeast('0.8.6.0000', 'not-a-version')).toBe(true);
    expect(pluginInstall.isHostAtLeast('0.8.6.0000', '0.8')).toBe(true); // 补段比较：0.8.0.0 <= 0.8.6
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑦ 合并口径（合并进注册表后 defaultEnabled 必须 false）
 * ══════════════════════════════════════════════════════════════════════════ */

function builtin(id: string, over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id,
    name: `内置 ${id}`,
    summary: '随包分发',
    version: '1.0.0',
    source: 'builtin',
    defaultEnabled: true,
    routes: [{ path: 'builtin-page', element: null as never }],
    nav: [{ to: '/builtin', label: '内置', icon: 'bot', group: 'main' }],
    ...over,
  };
}

function installed(
  id: string,
  over: Partial<InstalledPluginManifest> = {},
): InstalledPluginManifest {
  return {
    id,
    name: `自装 ${id}`,
    summary: '从文件安装',
    version: '2.0.0',
    entry: 'index.js',
    ...over,
  };
}

describe('⑦ mergeInstalledManifests：装与开是两件事', () => {
  it('★ defaultEnabled 恒 false——磁盘 manifest 连该字段都没有发言权', () => {
    const merged = mergeInstalledManifests([], [
      installed('x', {
        // 磁盘侧塞 defaultEnabled: true（恶意/手滑）也必须被合并层覆写
        defaultEnabled: true,
      } as unknown as Partial<InstalledPluginManifest>),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].defaultEnabled).toBe(false);
    expect(merged[0].source).toBe('member');
    // 与真实注册表谓词同一口径：首见（无显式 KV）⇒ false
    expect(isPluginEnabled({ manifests: merged, enabled: {} }, 'x')).toBe(false);
  });

  it('capabilities 只留 data.read（写/网/文件保存都不在 v1）', () => {
    const merged = mergeInstalledManifests([], [
      installed('y', {
        capabilities: ['data.read', 'data.write.proposal', 'net.outbound'] as unknown as InstalledPluginManifest['capabilities'],
      }),
    ]);
    expect(merged[0].capabilities).toEqual(['data.read']);
  });

  it('内置同名优先（随包插件是构建期可信代码，磁盘 JSON 不是）', () => {
    const merged = mergeInstalledManifests([builtin('dup')], [installed('dup')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('builtin');
    expect(merged[0].defaultEnabled).toBe(true); // 内置的默认启用不被自装覆写
  });

  it('自装插件不可能带 routes/nav/settingsSlot（磁盘 JSON 变不出 React 组件）', () => {
    const merged = mergeInstalledManifests([], [
      installed('z', {
        routes: [{ path: 'x' }],
      } as unknown as Partial<InstalledPluginManifest>),
    ]);
    expect(merged[0].routes).toBeUndefined();
    expect(merged[0].nav).toBeUndefined();
    expect(merged[0].settingsSlot).toBeUndefined();
  });

  it('entry / installVersion / minHostVersion 透传；summary 空则给默认文案', () => {
    const merged = mergeInstalledManifests([], [
      installed('a', { entry: 'index.html', installVersion: '3.1.4', minHostVersion: '0.8.6' }),
      installed('b', { summary: '' }),
    ]);
    expect(merged[0].entry).toBe('index.html');
    expect(merged[0].installVersion).toBe('3.1.4');
    expect(merged[0].minHostVersion).toBe('0.8.6');
    expect(merged[1].summary).toBe('（作者未提供说明）');
  });

  it('内置清单原样在前、自装在后（顺序即展示序：随包在前、第三方在后）', () => {
    const merged = mergeInstalledManifests(
      [builtin('b1'), builtin('b2')],
      [installed('m1'), installed('m2')],
    );
    expect(merged.map((m) => m.id)).toEqual(['b1', 'b2', 'm1', 'm2']);
    // 内置的贡献（routes/nav）不被合并动过
    expect(merged[0].routes).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑧ 入口形态纯函数
 * ══════════════════════════════════════════════════════════════════════════ */

describe('⑧ 入口形态：html 走 plug:// src，js 宿主注入 IIFE', () => {
  it('isHtmlEntry 只认 .html/.htm', () => {
    expect(isHtmlEntry('index.html')).toBe(true);
    expect(isHtmlEntry('INDEX.HTML')).toBe(true);
    expect(isHtmlEntry('index.htm')).toBe(true);
    expect(isHtmlEntry('index.js')).toBe(false);
    expect(isHtmlEntry('index.mjs')).toBe(false);
  });

  it('pluginEntryUrl：plug://<id>/<entry>（iframe src 与注入 script 同源）', () => {
    expect(pluginEntryUrl('demo-iife', 'index.js')).toBe('plug://demo-iife/index.js');
    expect(pluginEntryUrl('demo-iife', 'index.html')).toBe('plug://demo-iife/index.html');
  });
});
