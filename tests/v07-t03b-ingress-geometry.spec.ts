import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** IndexedDB 库名 —— 唯一出处 `src/core/schema/current.ts`（不在测试里硬编码） */
import { DB_NAME } from '../src/core/schema/current';

/**
 * v0.7 · T03-B **真浏览器几何验收**：接入配置面板（`AgentIngressPanel`）浮层。
 *
 * ── 为什么必须有这个文件（与 `v07-t03b-ingress-wired.spec.tsx` 的分工）──
 * 那个 spec 跑在 **jsdom**，只能判「DOM 结构 / 属性 / 文本 / 回调」；
 * jsdom **不实现布局**——`getBoundingClientRect()` 恒返回 0、
 * `getComputedStyle` 不解析 `xl:` 媒体查询、`elementFromPoint` 无命中测试。
 * 于是下面这三类事实在 jsdom 里**一条都测不到**，而那正是本面板唯一的真实风险面：
 *   ① 浮层在 xl(1280) / md(768) 两档会不会**溢出视口**（浮层定位靠 `position:fixed`
 *      + `createPortal`，`Modal.tsx` 的文件头已记录过「祖先含 backdrop-filter /
 *      transform 会让 fixed 退化为相对该祖先定位」这类事故）；
 *   ② 面板底部的「改为手动粘贴排期文件」是不是**真的点得到**——本项目有先例：
 *      元素渲染出来、`onClick` 也挂上了，但被另一个层盖住 → 用户点不动，
 *      而 jsdom 里「dispatchEvent 直接派发到该元素」**绕过命中测试**，照样绿（假绿）；
 *   ③ token 原文在**真 DOM** 里也查不到（jsdom 那条的正交复核）。
 * 故本文件的断言全部基于**真几何数字**（`getBoundingClientRect` / `elementFromPoint`），
 * **不断言任何 className 字符串**——类名在不在，既证明不了"看得见"，也证明不了"点得到"。
 *
 * ── 为什么跑 `build-dist` 而不是 dev server ──
 * 与 `layout-walkthrough.spec.ts` / `v07-dline-shell.spec.ts` 同一惯例：断点类由
 * Tailwind JIT 产出，跑真产物顺带覆盖「这些响应式类真的被生成了」——dev 模式测不出。
 * 产物缺失或**过期**时本 spec 跳过（而非失败）：几何验收属「发布前走查」，
 * 不该让「没构建」把默认 `npm test` 染红。
 *
 * ── xl 断点为什么是 1280 ──
 * 本项目的圆角/断点刻度被整体重定义过（`tailwind.config.ts`），`xl` 即
 * `min-width: 1280`。本文件不口头声明这条，而是**用真几何反证**：
 * 1280 档 `[data-app-sidebar]` 必须在（持久左栏），768 档必须不在（走抽屉）。
 * 若哪天有人把断点刻度改掉，这条会先红——避免「测试瞄着一个不存在的档位」。
 */

const DIST_INDEX = resolve(__dirname, '..', 'build-dist', 'index.html');
/**
 * 共享种子备份包（应用自身 zod schema 校验通过的真备份格式）。
 *
 * ⚠️ **本文件不得改它的 `kind`。** 这一份是**共享**的 —— `v07-dline-shell.spec.ts`
 * 也读它（`:71` 同款常量），而那份 spec 走人类侧路由（`/member-board`、
 * `/project/prj-v07b`）⇒ 那里**必须**是 human-kind；本文件跑 `/agent`
 * ⇒ **必须**是 agent-kind。两边诉求相反 ⇒ 只能**分叉**，见 `writeAgentSeed()`。
 */
const SEED_FIXTURE = resolve(__dirname, 'fixtures', 'v07-board-seed.json');
/**
 * 派生 agent-kind 种子的落点：目录 + 文件名。
 *
 * 目录在 `qa-scratch/` 下（已 gitignore），与既有排查产物同处。
 * ⚠️ 文件名与 `v07-board-acceptance` 的（`seed-agent.json`）**刻意不同**：两支 spec
 *   各写各的。若共用同一路径，vitest 并发跑两支 spec 时会出现
 *   「一支正在写、另一支正在读」的半截文件。
 */
const SEED_DIR = resolve(__dirname, '..', 'qa-scratch', 'v07-t03b');
const AGENT_SEED_FILE = 'seed-agent-geometry.json';

/** 种子夹具里的管理员成员 id（`fixtures/v07-board-seed.json` 的 `data.members[0].id`） */
const ADMIN_ID = 'm-admin';
/** 本文件专用的令牌原文（几何 spec 与 jsdom spec 各用各的，避免互相误判） */
const SECRET = 'idplan-agent-token-GEOMETRY-SECRET-xyz789';

/* ------------------------------ DOM 锚点（与 jsdom spec 同款，均为源码里的稳定属性） ------------------------------ */
const DIALOG = '[role="dialog"][aria-label="接入外部写入方"]';
const PANEL = '[data-agent-ingress-panel]';
const MANUAL = '[data-ingress-manual]';
const TOKEN_INPUT = '[data-ingress-token-input]';
const TOKEN_SAVE = '[data-ingress-token-save]';
const TOKEN_STATE = '[data-ingress-token-state]';
/** 工具行按钮：默认人话模式下 `termFor('applyPayload','human')` = 「导入任务」 */
const IMPORT_LABEL = '导入任务';

/* ================================================================================================
 * 浏览器 / 产物 / 过期判定（与 layout-walkthrough.spec.ts 同款，本仓各 Playwright spec 自持一份）
 * ================================================================================================ */

/** 探测已安装的 chromium 可执行文件（跨平台；不写死版本号，升级即失效） */
function resolveChromium(): string | null {
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  const relCandidates = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-linux64', 'chrome'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(root).filter((n) => n.startsWith('chromium-'));
    } catch {
      continue;
    }
    for (const dir of entries) {
      for (const rel of relCandidates) {
        const exe = join(root, dir, ...rel);
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const CHROMIUM_PATH = resolveChromium();
const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null;

/** 参与「产物是否过期」判定的构建输入：源码目录 + 根级构建配置（排除 build-dist 自身与 tests） */
const BUILD_INPUT_DIRS = ['src', 'electron'];
const BUILD_INPUT_FILES = ['index.html', 'vite.config.ts', 'tailwind.config.ts', 'postcss.config.js'];

function collectFiles(dir: string): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** 产物是否**已过期**（任一构建输入比 `build-dist/index.html` 新）；返回过期样例（最多 3 个） */
function staleInputs(): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  const { resolve: res } = require('node:path') as typeof import('node:path');
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = fs.statSync(DIST_INDEX).mtimeMs;

  const candidates = [
    ...BUILD_INPUT_DIRS.flatMap((d) => collectFiles(res(__dirname, '..', d))),
    ...BUILD_INPUT_FILES.map((f) => res(__dirname, '..', f)).filter((f) => existsSync(f)),
  ];

  return candidates
    .filter((f) => fs.statSync(f).mtimeMs > distMs)
    .map((f) => f.replace(res(__dirname, '..') + '\\', '').replace(res(__dirname, '..') + '/', ''))
    .slice(0, 3);
}

const STALE_INPUTS = CAN_RUN ? staleInputs() : [];
/** ★ 只有「产物存在 + Chromium 可用 + 产物不过期」三者齐备才跑；否则 skip（详见文件头） */
const CAN_RUN_FRESH = CAN_RUN && STALE_INPUTS.length === 0;

/**
 * 产物须经 **HTTP** 提供（不能走 `file://`）：`base: '/'` 让资源引用为绝对路径
 * `/assets/…`，`file://` 下会被解析成 `file:///assets/…` → 404 → 应用根本不挂载，
 * 表现为「所有断言全返回 null」这种极具误导性的失败。起一个零依赖只读静态服务器，
 * 端口用 0 让内核分配，测试结束即关闭。
 */
async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
  const http = require('node:http') as typeof import('node:http');
  const fs = require('node:fs') as typeof import('node:fs');
  const { join, extname } = require('node:path') as typeof import('node:path');

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };

  const server = http.createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    // SPA 回退：非文件请求一律返回 index.html（与 nginx try_files 同语义）
    let filePath = join(rootDir, rawPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
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

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/index.html`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/* ================================================================================================
 * 视口矩阵
 * ================================================================================================ */

/**
 * 三档：xl 桌面 / **xl 临界 1280**（本项目 xl 的唯一真值）/ md 平板 768。
 * 1280 必测：项目把断点刻度整体重定义过，临界点是「响应式类是否真的换挡」的分界，
 * 只在 1600 测会漏掉 1280 那一档的问题（`layout-walkthrough` 的 L-03 亦按此纪律）。
 */
const VIEWPORTS = [
  { w: 1600, h: 900, name: 'xl 桌面 1600' },
  { w: 1280, h: 900, name: 'xl 临界 1280' },
  { w: 768, h: 900, name: 'md 平板 768' },
] as const;

interface PanelGeometry {
  /** 是否存在接入面板根节点 */
  present: boolean;
  /** 面板四边（相对视口） */
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
  viewport: { w: number; h: number };
  /** 面板内容是否高于可视区（内容高于可视区是**正常**的——它有 overflow-y-auto，只要边框不越界） */
  scrollH: number;
  clientH: number;
  /** 「改为手动粘贴排期文件」按钮的四边与命中测试 */
  manual: {
    rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
    hitTag: string;
    hitIsSelf: boolean;
    hitIsDescendant: boolean;
    hitText: string;
  } | null;
  /** 面板中心点的命中是否落在面板内部（证明面板本身没被别的层盖住） */
  panelCenterHitInside: boolean;
  /** 该档位是否渲染持久左栏（用来反证 xl=1280） */
  sidebarPresent: boolean;
}

/**
 * 页面内测量：**只返回纯 JSON**（不传 DOM 对象回 Node 侧）。
 * 全部数字取整到 2 位小数，避免浮点尾差让断言在「差 0.0001」上抖动。
 */
async function measure(page: Page): Promise<PanelGeometry> {
  return page.evaluate(
    (sels: { panel: string; manual: string }) => {
      const r2 = (n: number): number => Math.round(n * 100) / 100;
      const rectOf = (el: Element) => {
        const r = el.getBoundingClientRect();
        return {
          left: r2(r.left),
          top: r2(r.top),
          right: r2(r.right),
          bottom: r2(r.bottom),
          width: r2(r.width),
          height: r2(r.height),
        };
      };

      const panel = document.querySelector(sels.panel) as HTMLElement | null;
      const manualEl = document.querySelector(sels.manual) as HTMLElement | null;
      const sidebar = document.querySelector('[data-app-sidebar]') as HTMLElement | null;

      // 侧栏「存在」= 真的占位可见（display:none / 0 宽 0 高都算不存在）
      const sidebarPresent = ((): boolean => {
        if (!sidebar) return false;
        const cs = getComputedStyle(sidebar);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = sidebar.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })();

      let manual: PanelGeometry['manual'] = null;
      if (manualEl) {
        const mr = manualEl.getBoundingClientRect();
        const cx = mr.left + mr.width / 2;
        const cy = mr.top + mr.height / 2;
        // ★ 命中测试：这才是「点得到吗」的真判据。jsdom 里 `dispatchEvent` 直接派发到
        //   目标元素，**绕过**命中测试，所以「回调被调用」证明不了用户点得到。
        const hit = document.elementFromPoint(cx, cy) as HTMLElement | null;
        manual = {
          rect: rectOf(manualEl),
          hitTag: hit ? hit.tagName : 'NONE',
          hitIsSelf: hit === manualEl,
          hitIsDescendant: hit !== null && manualEl.contains(hit),
          hitText: (hit?.textContent ?? '').trim().slice(0, 40),
        };
      }

      let panelCenterHitInside = false;
      if (panel) {
        const pr = panel.getBoundingClientRect();
        const hit = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
        panelCenterHitInside = hit !== null && panel.contains(hit);
      }

      return {
        present: !!panel,
        rect: panel ? rectOf(panel) : null,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        scrollH: panel ? panel.scrollHeight : 0,
        clientH: panel ? panel.clientHeight : 0,
        manual,
        panelCenterHitInside,
        sidebarPresent,
      };
    },
    { panel: PANEL, manual: MANUAL },
  );
}

/** 把测量的几何数字打进输出：**红的时候 team-lead 需要的是具体数字，不是「不满足断言」** */
function logGeometry(label: string, g: PanelGeometry): void {
  if (!g.rect) {
    // eslint-disable-next-line no-console
    console.log(`[t03b-geom] ${label}: 面板不存在（present=${g.present}）`);
    return;
  }
  const { rect: r, viewport: v } = g;
  // eslint-disable-next-line no-console
  console.log(
    `[t03b-geom] ${label}: 视口 ${v.w}×${v.h} | 面板 L${r.left} T${r.top} R${r.right} B${r.bottom} ` +
      `(${r.width}×${r.height}) | 内容高 ${g.scrollH}/可视 ${g.clientH} | ` +
      `手动按钮 ${g.manual ? `L${g.manual.rect.left} T${g.manual.rect.top} 命中=${g.manual.hitTag}${g.manual.hitIsSelf ? '(自身)' : g.manual.hitIsDescendant ? '(后代)' : '(被遮挡)'}` : '缺失'}`,
  );
}

/* ================================================================================================
 * 种子：从共享夹具**派生** agent-kind 副本（v0.8 夹具适配）
 *
 * ── 为什么必须派生 ──
 *   ① **不能直改共享夹具**：`tests/fixtures/v07-board-seed.json` 被本文件与
 *      `v07-dline-shell.spec.ts` 共用，后者走人类侧路由 ⇒ 要求 human-kind；
 *      本文件跑 `/agent` ⇒ 要求 agent-kind。两边诉求相反。
 *   ② **不能手抄一份**：下面所有几何断言不依赖任务明细，但「这个项目在库里、
 *      且是 Agent 看板」是本 spec 的**前提**；抄一份必然与共享夹具漂移。
 *   故：读共享夹具 → **只翻 `projects[].kind` 一位** → 落盘。
 *
 * ── 为什么 kind 必须是 agent（这才是本次红转绿的真因）──
 *   测试 ③ 真点「改为手动粘贴排期文件」后，手动粘贴面板（`ApplyPayloadPanel`）的
 *   渲染条件是 `applyOpen && scopedProjectId`，而 `scopedProjectId` 取自
 *   **已确认的 Agent 看板**（v0.8 §7.2 #20/#21 收窄）。夹具无 `kind` ⇒ 归一为
 *   `'human'` ⇒ 库里一块 Agent 看板都没有 ⇒ `scopedProjectId` 恒为 null
 *   ⇒ 面板**压根不渲染** ⇒ `waitFor` 超时。这不是几何缺陷，是种子侧的前提缺失。
 * ================================================================================================ */

/** 从共享夹具派生一份 agent-kind 种子并落盘，返回路径（任务数据一字未复制）。 */
function writeAgentSeed(): string {
  const pkg = JSON.parse(readFileSync(SEED_FIXTURE, 'utf8')) as {
    data: { projects: Array<Record<string, unknown>> };
  };
  if (pkg.data.projects.length === 0) {
    throw new Error('[t03b-geom] 共享夹具里没有 projects[]，无法派生 agent 种子。');
  }
  for (const p of pkg.data.projects) p['kind'] = 'agent';
  const out = resolve(SEED_DIR, AGENT_SEED_FILE);
  writeFileSync(out, JSON.stringify(pkg, null, 2), 'utf8');
  return out;
}

/**
 * 读一份种子备份里**声明**的项目（id / name / 归一后的 kind）。
 *
 * `kind` 的归一口径与 `normalizeProjectRow`（`stage-fallback.ts`）一致：只有字面量
 * `'agent'` 算 agent，其余（含缺列）算 `'human'` ⇒ 同一条判据对 human / agent 都成立。
 */
function readSeedProjects(fixturePath: string): Array<{ id: string; name: string; kind: string }> {
  const pkg = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    data: { projects: Array<{ id?: unknown; name?: unknown; kind?: unknown }> };
  };
  return pkg.data.projects
    .filter((p): p is { id: string } & Record<string, unknown> => typeof p.id === 'string')
    .map((p) => ({
      id: p.id,
      name: String(p.name ?? ''),
      kind: p.kind === 'agent' ? 'agent' : 'human',
    }));
}

/**
 * 页面内：读 IndexedDB `projects` 表里 `wanted` 那几行（**只读，绝不建库**）。
 *
 * ⚠️ 必须定义在**模块级**：Playwright 把函数**序列化**后送进页面，闭包变量不可用。
 *
 * 返回 `[]` 表示「库还不存在」或「库在但没有这几行」（对调用方语义相同：还没到）。
 *
 * ⚠️ 先问「库在不在」再 `open`：不带版本号的 `indexedDB.open(name)` 对**不存在的库**
 *   会顺手把它**建出来**（空库、v1），而 Dexie 的 v1 `stores()` 只在「首次建库」那次
 *   生效 —— 被抢先建成空 v1 后，后续升级不会补建 `projects` 表，应用会读不到数据。
 */
function readSeedProjectsInPage(arg: {
  dbName: string;
  wanted: string[];
}): Promise<Array<{ id: string; name: string; kind: string | null }>> {
  const { dbName, wanted } = arg;
  return new Promise((resolve) => {
    const read = async (): Promise<void> => {
      const dbs = indexedDB.databases;
      if (typeof dbs === 'function') {
        try {
          const list = await dbs();
          if (!list.some((d) => d.name === dbName)) {
            resolve([]);
            return;
          }
        } catch {
          /* 拿不到名单就按「在」处理（下面只读，不建表） */
        }
      }
      const req = indexedDB.open(dbName);
      req.onerror = () => resolve([]);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.close();
          resolve([]);
          return;
        }
        const storeReq = db.transaction('projects', 'readonly').objectStore('projects').getAll();
        storeReq.onerror = () => {
          db.close();
          resolve([]);
        };
        storeReq.onsuccess = () => {
          const result = (storeReq.result ?? []) as Array<Record<string, unknown>>;
          db.close();
          resolve(
            result
              .filter((r) => wanted.includes(String(r['id'])))
              .map((r) => ({
                id: String(r['id']),
                name: String(r['name'] ?? ''),
                kind: r['kind'] == null ? null : String(r['kind']),
              })),
          );
        };
      };
    };
    void read();
  });
}

/**
 * 等「种子项目真的落进 IndexedDB」——**与 kind 无关**的「导入成功」判据。
 *
 * 为什么不再用「页面文本里出现项目名」：v0.8 起 Agent 看板与人类侧物理隔离，
 * 导入 agent-kind 项目时人类首页**不会**渲染它的名字 ⇒ 那个判据必然超时。
 * 为什么用 Node 侧轮询而非 `page.waitForFunction`：导入成功会 `reload()`，
 * 跨导航的 page 函数会得到「Execution context destroyed」这种掩盖真因的报错；
 * 这里先等 `load` 事件，再普通 `evaluate` 轮询，并容忍导航窗口内的瞬时异常。
 */
async function pollSeedInDb(
  page: Page,
  expected: Array<{ id: string; name: string; kind: string }>,
  timeoutMs = 30000,
): Promise<Array<{ id: string; name: string; kind: string | null }>> {
  const ids = expected.map((p) => p.id);
  const deadline = Date.now() + timeoutMs;
  let rows: Array<{ id: string; name: string; kind: string | null }> = [];
  for (;;) {
    try {
      rows = await page.evaluate(readSeedProjectsInPage, { dbName: DB_NAME, wanted: ids });
    } catch {
      /* 导航窗口内的瞬时失败 = 「还没到」，下一轮再试；真失败由 deadline 兜底 */
    }
    if (ids.every((id) => rows.some((r) => r.id === id))) return rows;
    if (Date.now() >= deadline) return rows;
    await page.waitForTimeout(200);
  }
}

/* ================================================================================================
 * 前置检查（**单列一组**，理由：`describe.skipIf` 的 skip 在输出里长得像「通过」，
 * 极易被读成「已验收」。本仓已有先例，故照 `v07-dline-shell.spec.ts` 的做法显式提示。）
 * ================================================================================================ */

describe('v0.7 · T03-B 真 Chromium 几何验收前置检查', () => {
  it('产物存在、Chromium 可用且产物未过期（否则上面的验收被跳过 → 本批不算验过）', () => {
    if (!CAN_RUN_FRESH) {
      // eslint-disable-next-line no-console
      console.warn(
        `[t03b-geom] 跳过验收：build-dist=${existsSync(DIST_INDEX)} chromium=${CHROMIUM_PATH !== null} ` +
          `过期输入=${STALE_INPUTS.join(', ') || '(无)'}。请先 npm run build 再跑 npm test ` +
          `——否则测的是上一版界面，可能误报红、更危险的是误报绿。`,
      );
      expect(CAN_RUN_FRESH).toBe(false);
      return;
    }
    expect(existsSync(DIST_INDEX)).toBe(true);
    expect(CHROMIUM_PATH).not.toBeNull();
    expect(STALE_INPUTS).toEqual([]);
    // 派生 agent 种子的**源头**必须在（缺了它 writeAgentSeed 会在 beforeAll 抛 ENOENT）
    expect(existsSync(SEED_FIXTURE)).toBe(true);
  });
});

/* ================================================================================================
 * ① 浮层不溢出视口 + xl 断点反证
 * ================================================================================================ */

describe.skipIf(!CAN_RUN_FRESH)(
  'v0.7 · T03-B 接入面板真 Chromium 几何验收（真实构建产物）',
  () => {
    let browser: Browser;
    let server: { url: string; close(): Promise<void> };
    /** `http://127.0.0.1:<port>/`（含尾斜杠，供 `base + 'agent'` 拼接） */
    let BASE = '';
    let adminCtx: BrowserContext;

    beforeAll(async () => {
      server = await startStaticServer(resolve(__dirname, '..', 'build-dist'));
      BASE = server.url.replace(/index\.html$/, '');
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
      /*
       * ★ v0.8 夹具适配：种子必须是 **agent-kind**（从共享夹具派生，只翻 kind 一位）。
       *   本 spec 全部用例都在 `/agent`；且测试 ③ 需要**已存在的 Agent 看板** ——
       *   手动粘贴面板的渲染条件是 `applyOpen && scopedProjectId`，而 `scopedProjectId`
       *   取自「已确认的 Agent 看板」（§7.2 #20/#21 收窄）。human-kind 种子下它恒为
       *   null ⇒ 面板压根不渲染 ⇒ ③ 以「等 textarea 超时」这种看不出真因的方式红。
       */
      mkdirSync(SEED_DIR, { recursive: true });
      const agentSeed = writeAgentSeed();
      adminCtx = await createSeededAdminEnv(agentSeed);
    }, 240000);

    afterAll(async () => {
      await adminCtx?.close();
      await browser?.close();
      await server?.close();
    });

    /**
     * 建一个「已灌种子 + 管理员身份」的 context（独立 context 自带 localStorage + IndexedDB）。
     *
     * 走应用自己的备份导入链路（隐藏 file input → 预检 → 二次确认 → 整库替换 → reload），
     * **不往 IndexedDB 里手写 raw**（要复刻 Dexie 索引串与版本号，一旦升级就静默退化）。
     *
     * `currentMemberId` 在**任何页面脚本之前**写入：`useSettingsStore` 在模块求值期同步读回，
     * 既确立刻身份（`isAdmin` → 页侧 `{isAdmin && …}` 才可能放行），也顺带关掉首启引导弹窗
     * （`useFirstRunGate` 条件含 `currentMemberId === null`），免得遮罩干扰点击。
     */
    /**
     * @param fixture 要导入的种子备份路径。**必须是 agent-kind**（本 spec 跑 `/agent`）：
     *   测试 ③ 需要一块**已存在的 Agent 看板**（手动粘贴面板的渲染条件是
     *   `applyOpen && scopedProjectId`，后者取自「已确认的 Agent 看板」）。
     *   传共享夹具（human-kind）会让该面板不渲染、③ 以「等 textarea 超时」红
     *   —— 真因见 `writeAgentSeed()` 的说明。
     */
    async function createSeededAdminEnv(fixture: string): Promise<BrowserContext> {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addInitScript((id: string) => {
        try {
          localStorage.setItem('changxia.currentMemberId', id);
        } catch {
          /* 隐私模式：种子导入会随之失败并给出清晰报错 */
        }
      }, ADMIN_ID);

      const page = await ctx.newPage();
      await page.goto(`${BASE}index.html`);
      await page.waitForSelector('header', { timeout: 30000 });

      // 侧栏里那个 `input[type=file].hidden`（useBackupIo）——它 display:none，
      // 故必须 `force` 绕过可见性检查（setInputFiles 本身是赋 value，不需要真点击）
      await page
        .locator('input[type="file"][accept*="json"]')
        .first()
        .setInputFiles(fixture, { force: true });

      const confirm = page.getByRole('button', { name: '确认恢复' });
      try {
        await confirm.waitFor({ state: 'attached', timeout: 30000 });
      } catch {
        const text = await page.locator('body').innerText();
        throw new Error(
          '备份导入未进入二次确认：fixture 可能未通过 zod 预检（页面会 toast「备份文件校验失败」）。' +
            `页面文本片段：${text.slice(0, 500)}`,
        );
      }
      /*
       * 导入成功 → `BackupService.importAndReplace` 后 `window.location.reload()`。
       * `load` 监听**必须在 click 之前**注册，否则 reload 可能先发生（竞态）。
       */
      const reloaded = page.waitForEvent('load', { timeout: 30000 });
      await confirm.click({ force: true });
      try {
        await reloaded;
      } catch {
        const text = await page.locator('body').innerText();
        throw new Error(
          '备份导入未触发页面重载：可能未通过 zod 预检，或 `importAndReplace` 抛错' +
            `（页面会 toast 失败原因，且本地数据未受影响）。页面文本片段：${text.slice(0, 500)}`,
        );
      }

      /*
       * ★ 导入成功的**直接证据** = 种子项目已落 IndexedDB（**与 kind 无关**）。
       *   旧判据是「人类首页文本里出现项目名」—— 对 agent-kind 项目恒不成立
       *   （物理隔离 ⇒ 人类首页压根不渲染它），会以「屏障超时」的形式假红。
       */
      const seedExpected = readSeedProjects(fixture);
      const rows = await pollSeedInDb(page, seedExpected);
      const missing = seedExpected.filter((p) => !rows.some((r) => r.id === p.id));
      if (missing.length > 0) {
        const text = await page.locator('body').innerText();
        throw new Error(
          `备份导入后未在 IndexedDB 中观察到种子项目 [${missing.map((p) => p.id).join(', ')}]` +
            `（判据 = 种子行已落库，与项目 kind 无关）。页面文本片段：${text.slice(0, 500)}`,
        );
      }
      // 落库行必须与夹具声明逐字段一致 —— 顺带钉住 §7.2 #22：`kind` 经整库替换后仍在
      for (const p of seedExpected) {
        const row = rows.find((r) => r.id === p.id);
        expect(row?.name, `项目 ${p.id} 的 name 落库应为「${p.name}」`).toBe(p.name);
        expect(row?.kind, `项目 ${p.id} 的 kind 落库应为「${p.kind}」（夹具声明）`).toBe(p.kind);
      }

      await page.close();
      return ctx;
    }

    /**
     * 在指定视口打开 `/agent` 并**真点**「导入任务」打开接入面板。
     *
     * 每档都用 `page.goto` 做一次**全新加载**（而不是只 `setViewportSize`）：
     * 组件里有若干「按 `matchMedia` 在挂载时定值」的窄屏判定，只改视口不重新挂载
     * 会读到上一个档位的陈旧状态 —— 那测的不是断点，是测试自己的时序。
     */
    async function openIngressAt(
      page: Page,
      width: number,
      height: number,
    ): Promise<void> {
      await page.setViewportSize({ width, height });
      await page.goto(`${BASE}agent`);
      await page.waitForSelector('header', { timeout: 30000 });
      await page.waitForTimeout(350); // 等 CSS 应用完，避免读到过渡中的中间值

      // 先确认按钮真在（否则「面板不存在」可能是空过：按钮都没渲染出来）
      const importBtn = page.getByRole('button', { name: IMPORT_LABEL, exact: true });
      await importBtn.waitFor({ state: 'visible', timeout: 15000 });
      await importBtn.click();

      // 面板必须真的开出来（页侧 isAdmin 门控 + 内部门控都通过）
      await page.waitForSelector(DIALOG, { timeout: 10000 });
      await page.waitForSelector(PANEL, { timeout: 10000 });
      await page.waitForTimeout(250); // 等浮层入场动画结束再量几何
    }

    it('① 接入面板在 xl(1280) / md(768) / 桌面(1600) 三档均不溢出视口；并反证 xl=1280', async () => {
      const page = await adminCtx.newPage();

      for (const vp of VIEWPORTS) {
        await openIngressAt(page, vp.w, vp.h);
        const g = await measure(page);
        logGeometry(vp.name, g);

        // 反空过：面板必须真的量到了非零尺寸（否则下面「四边在视口内」对 0×0 也成立）
        expect(g.present, `${vp.name}：接入面板未渲染`).toBe(true);
        expect(g.rect, `${vp.name}：量不到面板几何`).not.toBeNull();
        expect(g.rect!.width, `${vp.name}：面板宽度为 0，几何无效`).toBeGreaterThan(0);
        expect(g.rect!.height, `${vp.name}：面板高度为 0，几何无效`).toBeGreaterThan(0);

        // ★ 核心：四边全在视口内（真几何，不看 className）
        expect(g.rect!.left, `${vp.name}：面板左边越界 L=${g.rect!.left}`).toBeGreaterThanOrEqual(0);
        expect(g.rect!.top, `${vp.name}：面板上边越界 T=${g.rect!.top}`).toBeGreaterThanOrEqual(0);
        expect(
          g.rect!.right,
          `${vp.name}：面板右边越界 R=${g.rect!.right} > ${g.viewport.w}`,
        ).toBeLessThanOrEqual(g.viewport.w);
        expect(
          g.rect!.bottom,
          `${vp.name}：面板下边越界 B=${g.rect!.bottom} > ${g.viewport.h}`,
        ).toBeLessThanOrEqual(g.viewport.h);

        // 面板自身没被别的层盖住（中心点命中仍在面板内部）
        expect(g.panelCenterHitInside, `${vp.name}：面板中心被其它层遮挡`).toBe(true);

        // 内容可以高于可视区（面板自带 overflow-y-auto），但**不能**因此把边框顶出视口——
        // 上面四边断言已覆盖；这里只留一条关系式，防止将来有人把 max-h 删掉后仍靠
        // 「四边恰好贴合」蒙混过关。
        if (g.scrollH > g.clientH) {
          expect(g.rect!.height, `${vp.name}：内容溢出时面板高度应被裁到不超过视口`).toBeLessThanOrEqual(
            g.viewport.h,
          );
        }

        // ★ 反证 xl=1280（本项目断点刻度被重定义过）：
        //   1280 与 1600 必须渲染持久左栏；768 必须不渲染（走抽屉）。
        //   若将来断点被改，这条先红——避免「测试瞄着一个不存在的档位」。
        if (vp.w >= 1280) {
          expect(g.sidebarPresent, `${vp.name}：xl 档应渲染持久左栏（xl=1280）`).toBe(true);
        } else {
          expect(g.sidebarPresent, `${vp.name}：<1280 不应渲染持久左栏（走抽屉）`).toBe(false);
        }

        // 关闭面板，进入下一档（重新 goto 会重置，这里顺手点掉以免浮层叠加）
        await page.keyboard.press('Escape');
        await page.waitForSelector(PANEL, { state: 'detached', timeout: 10000 });
      }

      await page.close();
    }, 180000);

    it('② 「改为手动粘贴排期文件」三档均未被遮挡（elementFromPoint 命中自身/后代）', async () => {
      const page = await adminCtx.newPage();

      for (const vp of VIEWPORTS) {
        await openIngressAt(page, vp.w, vp.h);

        /*
         * 面板内容允许高于面板可视区（面板自带 `overflow-y-auto`，是**设计**不是缺陷）。
         * 故先把手动按钮滚进可视区再量几何：这样命中测试测的是**遮挡**
         * （被别的层盖住 → 点不动），而不是"按钮在当前折线以下"。
         * 后者（按钮是否可达）由 ③ 的**真点击**端到端覆盖 —— Playwright 的 click
         * 自身会做滚动 + 命中检查，被遮挡时直接抛错。
         */
        await page.locator(MANUAL).scrollIntoViewIfNeeded();
        const g = await measure(page);
        logGeometry(vp.name, g);

        expect(g.manual, `${vp.name}：面板内找不到「改为手动粘贴排期文件」按钮`).not.toBeNull();
        const m = g.manual!;

        // 按钮自身必须可见且非零（0 尺寸时 elementFromPoint 的中心点落在别处）
        expect(m.rect.width, `${vp.name}：手动粘贴按钮宽度为 0`).toBeGreaterThan(0);
        expect(m.rect.height, `${vp.name}：手动粘贴按钮高度为 0`).toBeGreaterThan(0);

        // 按钮四边也在视口内（它可能因为面板滚动而跑到可视区外——那同样是「点不到」）
        expect(m.rect.left, `${vp.name}：手动按钮左边越界`).toBeGreaterThanOrEqual(0);
        expect(m.rect.top, `${vp.name}：手动按钮上边越界`).toBeGreaterThanOrEqual(0);
        expect(m.rect.right, `${vp.name}：手动按钮右边越界`).toBeLessThanOrEqual(g.viewport.w);
        expect(m.rect.bottom, `${vp.name}：手动按钮下边越界`).toBeLessThanOrEqual(g.viewport.h);

        // ★★ 核心命中测试：按钮中心的「最上层元素」必须是它自己或其后代。
        //   若被别的层（遮罩 / 装饰层 / 拖拽区）截获，这里会红 —— 而 jsdom 里
        //   `dispatchEvent` 直接派发到目标元素、绕过命中测试，**照样全绿**（假绿）。
        expect(
          m.hitIsSelf || m.hitIsDescendant,
          `${vp.name}：手动粘贴按钮被遮挡——elementFromPoint 命中的是 <${m.hitTag}>` +
            `（文本「${m.hitText}」），不是按钮自身或其后代`,
        ).toBe(true);

        await page.keyboard.press('Escape');
        await page.waitForSelector(PANEL, { state: 'detached', timeout: 10000 });
      }

      await page.close();
    }, 180000);

    it('③ 真点击「改为手动粘贴排期文件」→ 接入面板关闭、手动粘贴面板打开（两入口不合并）', async () => {
      const page = await adminCtx.newPage();
      await openIngressAt(page, 1280, 900); // xl 临界，本项目的基准档

      // 真点击（不是 dispatchEvent）：Playwright 会做命中检查，被遮挡时直接抛错
      await page.locator(MANUAL).click({ timeout: 10000 });

      // 接入面板必须关闭；两个入口若被合并（例如都指向同一 state），这里会红
      await page.waitForSelector(PANEL, { state: 'detached', timeout: 10000 });
      expect(await page.locator(DIALOG).count()).toBe(0);

      // 手动粘贴面板打开（标志物 = 它的粘贴框；接入面板内不含 textarea）
      const manualDialog = page.locator('[role="dialog"]').filter({ has: page.locator('textarea') });
      await manualDialog.first().waitFor({ state: 'visible', timeout: 10000 });
      expect(await page.locator('textarea').count()).toBeGreaterThan(0);

      await page.close();
    }, 120000);

    it('④ ★ token 原文在真 DOM 任意角落都不出现（jsdom 那条的正交复核）', async () => {
      const page = await adminCtx.newPage();
      await openIngressAt(page, 1280, 900);

      // 前置：初始应为「未配置」（独立 context，localStorage 干净）
      expect(await page.locator(TOKEN_STATE).getAttribute('data-ingress-token-state')).toBe('unset');

      await page.locator(TOKEN_INPUT).fill(SECRET);
      await page.locator(TOKEN_SAVE).click();
      await page.waitForTimeout(400);

      // ★ 正向对照（防假绿）：先证明「保存」这条链路**真的跑过** ——
      //   否则「DOM 里没有原文」在「什么都没发生」的实现下也成立，断言等于没写。
      const stored = await page.evaluate(
        (key: string) => localStorage.getItem(key),
        'idplan.agentToken',
      );
      expect(stored, '令牌未落 localStorage —— 保存链路没跑，下面的「查不到原文」是空过').toBe(
        SECRET,
      );
      expect(await page.locator(TOKEN_STATE).getAttribute('data-ingress-token-state')).toBe(
        'configured',
      );

      // ★ 核心：整页 DOM（含 Modal 的 portal 挂点 document.body）里查不到原文
      const leaked = await page.evaluate((secret: string) => {
        const inHtml = document.documentElement.innerHTML.includes(secret);
        const inText = (document.body.textContent ?? '').includes(secret);
        // 输入框的**属性**与**当前值**也单独查（React 受控 input 的 value 是 DOM 属性，
        // 不一定出现在 innerHTML 里 —— 只查 innerHTML 会漏这一处）
        const inputEl = document.querySelector(
          '[data-ingress-token-input]',
        ) as HTMLInputElement | null;
        const inInputValue = (inputEl?.value ?? '').includes(secret);
        const inInputAttr = (inputEl?.getAttribute('value') ?? '').includes(secret);
        // localStorage 之外的持久面：只查得到两个（storage 本身是**预期**落点，不算泄漏）
        const inLocalStorageOther = Object.keys(localStorage)
          .filter((k) => k !== 'idplan.agentToken')
          .some((k) => (localStorage.getItem(k) ?? '').includes(secret));
        return { inHtml, inText, inInputValue, inInputAttr, inLocalStorageOther };
      }, SECRET);

      expect(leaked.inHtml, 'token 原文出现在页面 HTML 里').toBe(false);
      expect(leaked.inText, 'token 原文出现在页面可见文本里').toBe(false);
      expect(leaked.inInputValue, 'token 原文仍留在输入框值里（保存后应清空）').toBe(false);
      expect(leaked.inInputAttr, 'token 原文出现在输入框 value 属性里').toBe(false);
      expect(leaked.inLocalStorageOther, 'token 原文泄漏到了其它 localStorage 键').toBe(false);

      await page.close();
    }, 120000);
  },
);
