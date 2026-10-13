// @vitest-environment node
/**
 * 「载入示例项目」不动宿主策略 · **真 Chromium**（生产构建产物 + 真点击 + 真 IndexedDB）。
 *
 * ══════════════════ 为什么必须真浏览器 ══════════════════
 * jsdom 侧已有两条闸（`tests/backup.settings-plugin-state.spec.ts` ⑤ 证明**拼接**对、
 * `tests/server.backup-import-client-shaped.spec.ts` ② 证明**服务端导入**对），
 * 但它们都**不碰 React 那一层**：从「点侧栏按钮」到「`loadDemo` 真的走到那行合并」
 * 之间的链路（插件门控、二次确认弹窗、覆盖式导入、导入后 `location.reload()`、
 * 重载后重新 bootstrap）**没有任何一条 jsdom 用例覆盖**。
 * 本文件补的正是这一段 —— 它是「修复真的对用户生效」的唯一证据。
 *
 * ══════════════════ 三层判据（缺一层就是假绿）══════════════════
 *   ① **导入真的成功了**：demo 的 5 个项目确实落进 IndexedDB。
 *      （没有这一层，「插件键仍在」在导入失败/未生效时会**空转成 PASS**。）
 *   ② **前提**：本机播种的 `restPolicy` 与 demo 包里的取值**可观测地不同**。
 *      （没有这一层，反向对照可能恒判「未变」⇒ 永远得不到结论而看着像通过。）
 *   ③ **反向对照成立 + 插件键逐字节未变**：
 *      · demo 包自己的 `restPolicy` / `currentMemberId` **确实覆盖**了本机值 ⇒ 证明
 *        这次导入真做了整表替换（否则 ① 之外一切为空）；
 *      · `plugin.enabled.*` 三行**仍在且逐字节相同** ⇒ 修复生效。
 * 任一层不成立 ⇒ 直接失败，不输出「通过」。
 *
 * ══════════════════ 播种方式为何是「直写 IndexedDB」══════════════════
 * 宿主策略（`plugin.enabled.*`）本可以点设置抽屉里那枚开关来写，但那要经过
 * **别人正在迭代的 UI**，定位一漂就得放宽选择器 —— 而放宽正是假绿的开始。
 * 直写 IndexedDB 是**确定性的**（写入前先读回验证），且与「真实用户手动开过插件
 * 得到的库内状态」**逐字节等价**（同一个 store、同一套行形状）。
 * 点「载入示例项目」的那一步**仍然走真 UI 真鼠标点击**，不许放宽。
 *
 * ══════════════════ 产物过期守卫 ══════════════════
 * `src/` 比 `build-dist` 新 ⇒ 整组 skip（拿旧界面下结论 = 假绿），与
 * `tests/overlay-stack-browser.spec.ts` 同款判据。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

import { listenOnSafePort } from './helpers/safe-listen';
import { buildDemoBackup } from '../src/core/demo/demoDataFactory';
import { pluginEnabledKey } from '../src/core/plugin/types';
import { DB_NAME } from '../src/core/schema/current';

const ROOT = resolve(__dirname, '..');
/**
 * 产物目录可被 `DEMO_GATE_DIST` 覆盖 —— **只为做「真机变异自证」**：
 * 把实现改坏后用 `vite build --outDir <临时目录>` 单独构建一份（**不碰共享的
 * `build-dist`**，否则别人的浏览器 spec 会短暂跑在被我改坏的产物上），再指过来跑。
 * 平时不设该变量 ⇒ 与原行为逐字一致。
 */
const DIST_DIR = process.env.DEMO_GATE_DIST ?? join(ROOT, 'build-dist');
const DIST_INDEX = join(DIST_DIR, 'index.html');
const HEAVY = 90_000;

/** 宿主策略三行（`sample-projects` 必须为 true，否则侧栏那个入口根本不渲染） */
const AGENT_BOARD = pluginEnabledKey('agent-board');
const WEEKLY_REPORT = pluginEnabledKey('weekly-report');
const SAMPLE_PROJECTS = pluginEnabledKey('sample-projects');
/** 与 demo 包取值**刻意不同**（第 ② 层前提：反向对照必须能观测到变化） */
const SEEDED_REST_POLICY = JSON.stringify({ kind: 'single_off' });

interface SettingRow {
  key: string;
  valueJson: string;
  updatedAt: string;
}

const seeded: SettingRow[] = [
  { key: AGENT_BOARD, valueJson: 'false', updatedAt: '2026-01-01T00:00:00.000Z' },
  { key: WEEKLY_REPORT, valueJson: 'true', updatedAt: '2026-01-01T00:00:00.000Z' },
  { key: SAMPLE_PROJECTS, valueJson: 'true', updatedAt: '2026-01-01T00:00:00.000Z' },
  { key: 'restPolicy', valueJson: SEEDED_REST_POLICY, updatedAt: '2026-01-01T00:00:00.000Z' },
];

function resolveChromium(): string | null {
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  const { join: jn } = require('node:path') as typeof import('node:path');
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? jn(process.env.LOCALAPPDATA, 'ms-playwright') : null,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let dirs: string[] = [];
    try {
      dirs = readdirSync(root).filter((n) => n.startsWith('chromium-'));
    } catch {
      continue;
    }
    for (const d of dirs) {
      for (const rel of [['chrome-win64', 'chrome.exe'], ['chrome-linux', 'chrome']]) {
        const exe = jn(root, d, ...rel);
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const CHROMIUM_PATH = resolveChromium();
const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null;

const BUILD_INPUT_DIRS = ['src', 'electron'];
const BUILD_INPUT_FILES = ['index.html', 'vite.config.ts', 'tailwind.config.ts', 'postcss.config.js'];

function collectFiles(dir: string): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  const jn = (require('node:path') as typeof import('node:path')).join;
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = jn(dir, e.name);
    if (e.isDirectory()) out.push(...collectFiles(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** 产物过期守卫：src / 构建配置比 build-dist 新 ⇒ 整组 skip（拿旧界面下结论 = 假绿） */
function staleInputs(): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = fs.statSync(DIST_INDEX).mtimeMs;
  const candidates = [
    ...BUILD_INPUT_DIRS.flatMap((d) => collectFiles(resolve(ROOT, d))),
    ...BUILD_INPUT_FILES.map((f) => resolve(ROOT, f)).filter((f) => existsSync(f)),
  ];
  return candidates
    .filter((f) => fs.statSync(f).mtimeMs > distMs)
    .map((f) => f.replace(ROOT + '\\', '').replace(ROOT + '/', ''))
    .slice(0, 3);
}

const STALE = CAN_RUN ? staleInputs() : [];
const CAN_RUN_FRESH = CAN_RUN && STALE.length === 0;

async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
  const fs = require('node:fs') as typeof import('node:fs');
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  const server = createServer((req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = join(rootDir, raw);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      if (/\.(js|mjs|css|json|png|jpg|svg|ico|woff2?)$/.test(raw)) {
        res.writeHead(404).end('not found');
        return;
      }
      filePath = join(rootDir, 'index.html');
    }
    try {
      const body = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return listenOnSafePort(server);
}

/** 桌面端 stub（自绘三键 + 更新探测），与既有浏览器 spec 同口径 */
const IDPLAN_STUB = `
window.idplan = {
  isDesktop: true,
  platform: 'win32',
  version: '0.0.0.0',
  windowControls: {
    minimize: function () {}, toggleMaximize: function () {}, close: function () {},
    isMaximized: function () { return Promise.resolve(false); },
    onMaximizeChange: function () { return function () {}; },
  },
  checkUpdate: function () {
    return Promise.resolve({ current: '0.0.0.0', latest: '0.0.0.0', hasUpdate: false,
      releaseUrl: null, publishedAt: null, notes: null, exeAssetUrl: null });
  },
  onUpdateAvailable: function () { return function () {}; },
};
`;

describe.skipIf(!CAN_RUN_FRESH)('载入示例项目不动宿主策略 · 真 Chromium', () => {
  let browser: Browser;
  let server: { url: string; close(): Promise<void> };
  let DIST_URL = '';

  beforeAll(async () => {
    server = await startStaticServer(DIST_DIR);
    DIST_URL = server.url;
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
  }, HEAVY);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function open(): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(IDPLAN_STUB);
    const page = await ctx.newPage();
    await page.goto(DIST_URL);
    await page.waitForSelector('header', { timeout: 20000 });
    await page.waitForTimeout(600);
    return { ctx, page };
  }

  /** 按**可见文案精确相等**点按钮（真鼠标点，走完整命中链路）—— 不许放宽成「任意按钮」 */
  async function clickText(page: Page, text: string): Promise<boolean> {
    const point = await page.evaluate((t) => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => (x.textContent ?? '').trim() === t,
      );
      if (!b) return null;
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, text);
    if (!point) return false;
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(400);
    return true;
  }

  /** 确立管理员身份（与既有浏览器 spec 逐字同口径：真点「我是管理员」→ 填名 → 确认） */
  async function becomeAdmin(page: Page): Promise<void> {
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => (x.textContent ?? '').trim() === '我是管理员',
      );
      b?.click();
    });
    await page.waitForTimeout(400);
    await page.locator('input[placeholder="你的姓名"]').fill('严过关');
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => (x.textContent ?? '').trim() === '确认为管理员',
      );
      b?.click();
    });
    await page.waitForTimeout(1000);
    const guideSkip = page.locator('button', { hasText: '先四处看看' });
    if (await guideSkip.count()) {
      await guideSkip.first().click();
      await page.waitForTimeout(500);
    }
  }

  /** 直写 IndexedDB 的 settings 表（DB 名/store/kg 键与产品同一处出处） */
  async function seedSettings(page: Page, rows: SettingRow[]): Promise<void> {
    await page.evaluate(
      async ({ dbName, store, rows }) => {
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const req = indexedDB.open(dbName);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        await new Promise<void>((res, rej) => {
          const tx = db.transaction(store, 'readwrite');
          for (const r of rows) tx.objectStore(store).put(r);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        });
        db.close();
      },
      { dbName: DB_NAME, store: 'settings', rows },
    );
  }

  /** 读回 settings 全景（key → valueJson），外加 demo 数据是否落库的行数证据 */
  async function readState(page: Page): Promise<{
    settings: Record<string, string>;
    projects: number;
    localStorageId: string | null;
    enterIdentity: number;
  }> {
    return page.evaluate(
      async ({ dbName, lsKey }) => {
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const req = indexedDB.open(dbName);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const readAll = (store: string): Promise<Array<{ key: string; valueJson: string }>> =>
          new Promise((res, rej) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => res(req.result as Array<{ key: string; valueJson: string }>);
            req.onerror = () => rej(req.error);
          });
        const settings = await readAll('settings');
        const projects = (await readAll('projects')).length;
        db.close();
        // 身份是否已进入：未进入时身份控件会渲染一枚文案恰为「点击进入」的按钮
        const enterIdentity = Array.from(document.querySelectorAll('button')).filter(
          (b) => (b.textContent ?? '').trim() === '点击进入',
        ).length;
        return {
          settings: Object.fromEntries(settings.map((r) => [r.key, r.valueJson])),
          projects,
          localStorageId: localStorage.getItem(lsKey),
          enterIdentity,
        };
      },
      { dbName: DB_NAME, lsKey: 'changxia.currentMemberId' },
    );
  }

  it('①③ 载入示例项目后：demo 数据确实落库 + demo 的 settings 覆盖了本机值 + 插件键逐字节未变', async () => {
    const { ctx, page } = await open();
    try {
      await becomeAdmin(page);

      /*
       * ② 层前提：本机播种值与 demo 包取值**必须不同**，否则反向对照恒判「未变」而永远
       *    得不到结论（「对照本身恒过」是审计者独立发现过的同类坑，此处显式证明）。
       */
      const demoPkg = buildDemoBackup();
      const demoRest = demoPkg.data.settings.find((s) => s.key === 'restPolicy')?.valueJson;
      const demoMemberId = demoPkg.data.settings.find((s) => s.key === 'currentMemberId')?.valueJson;
      expect(demoRest, 'demo 包应带 restPolicy').toBeTruthy();
      expect(demoRest, '第②层前提不成立：播种值与包内值相同 ⇒ 反向对照会恒过').not.toBe(
        SEEDED_REST_POLICY,
      );

      await seedSettings(page, seeded);
      await page.reload();
      await page.waitForSelector('header', { timeout: 20000 });
      await page.waitForTimeout(800);
      const before = await readState(page);
      expect(before.settings[AGENT_BOARD], '播种未落库（前提失败）').toBe('false');
      expect(before.settings[WEEKLY_REPORT], '播种未落库（前提失败）').toBe('true');
      expect(before.settings[SAMPLE_PROJECTS], '播种未落库（前提失败）').toBe('true');
      console.log('[demo-gate] 播种后 =', JSON.stringify(before.settings));

      // ── 真 UI：点侧栏「载入示例项目」→ 确认弹窗 → 确认载入（定位不许放宽） ──
      const openedEntry = await clickText(page, '载入示例项目');
      expect(openedEntry, '侧栏应有「载入示例项目」入口（管理员 + 示例项目插件已启用）').toBe(true);
      await page.waitForSelector('[role="dialog"][aria-label="载入示例项目"]', { timeout: 5000 });
      expect(await clickText(page, '确认载入'), '确认框应有「确认载入」').toBe(true);

      // 导入完成会 window.location.reload()：等它重载并重新 bootstrap
      await page.waitForTimeout(4000);
      await page.waitForSelector('header', { timeout: 20000 });
      const after = await readState(page);
      console.log('[demo-gate] 载入后 =', JSON.stringify(after.settings));
      console.log(
        '[demo-gate] projects 行数 =',
        after.projects,
        '；localStorage 身份 =',
        after.localStorageId,
        '；「点击进入」按钮数 =',
        after.enterIdentity,
      );

      // ── ① 层：导入真的生效了（没有这一层，下面「插件键仍在」会空转成假绿） ──
      expect(after.projects, 'demo 数据没落库 ⇒ 本次运行对第③层无效（不得记为通过）').toBe(5);

      // ── ③ 层 a：反向对照 —— demo 包自己的两行确实覆盖了本机值 ──
      expect(after.settings['restPolicy'], 'demo 的 restPolicy 未覆盖本机值').toBe(demoRest);
      expect(after.settings['currentMemberId'], 'demo 的身份兜底行未落库').toBe(demoMemberId);

      // ── ③ 层 b：宿主策略三行仍在且逐字节未变 ──
      expect(after.settings[AGENT_BOARD], '载入示例项目把 plugin.enabled.agent-board 抹了/改了').toBe(
        'false',
      );
      expect(after.settings[WEEKLY_REPORT], '载入示例项目把 plugin.enabled.weekly-report 抹了/改了').toBe(
        'true',
      );
      expect(after.settings[SAMPLE_PROJECTS], '载入示例项目把 plugin.enabled.sample-projects 抹了/改了').toBe(
        'true',
      );
    } finally {
      await ctx.close();
    }
  }, HEAVY);
});
