import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Browser, BrowserContext, Page } from 'playwright-core';

import { listenOnSafePort } from './safe-listen';

/**
 * 成员看板 / 路由类真 Chromium spec 的共享 harness（v0.8.6.0003）。
 *
 * 为什么抽这里：member-board-layout.spec.ts 与 v07-board-acceptance.spec.ts 各自
 * 复制了一份 resolveChromium + startStaticServer + 产物过期判定（约 150 行）。
 * 本轮四个反馈（统计卡裁字 / 列宽 / 返回键 / 路由滚动）每个都要起静态服务 + 开
 * Chromium + 进成员看板，再抄四份等于给「四处漂移」埋雷。既有 spec 不动
 * （在途文件不并发改），本 helper 只服务本轮新增 spec。
 *
 * 口径与 member-board-layout.spec.ts **逐字一致**：
 *   · Chromium 探测：PLAYWRIGHT_BROWSERS_PATH → LOCALAPPDATA/HOME/USERPROFILE 下
 *     的 ms-playwright/chromium-*（chrome-win64 / chrome-win / linux / mac 四形态）；
 *   · 静态服务：SPA 必须走 HTTP（vite base '/'，file:// 下资源全 404），非资源
 *     路径回落 index.html；listen 经 listenOnSafePort 避开 Chromium 不安全端口；
 *   · 产物过期：src / electron / index.html / vite.config.ts 等比 build-dist 新
 *     ⇒ 整组 skip（避免拿旧产物制造假红/假绿）。
 */

/** 探测已安装的 chromium（与 member-board-layout.spec.ts 同一实现） */
export function resolveChromium(): string | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
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

const REPO_ROOT = resolve(__dirname, '..', '..');

/** 构建产物入口 */
export const DIST_INDEX = resolve(REPO_ROOT, 'build-dist', 'index.html');

export const CHROMIUM_PATH = resolveChromium();

export const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null;

/** 参与「产物是否过期」判定的构建输入（与 member-board-layout 同口径） */
const BUILD_INPUT_DIRS = ['src', 'electron'];
const BUILD_INPUT_FILES = ['index.html', 'vite.config.ts', 'tailwind.config.ts', 'postcss.config.js'];

function collectFiles(dir: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

/**
 * 比产物新的构建输入（非空 ⇒ 产物过期，spec 应 skip）。
 *
 * ★ 2026-10-13 语言切换批 2a · **让 skip 有声音**（team-lead 裁决 ③-b）：
 *   本函数返回非空 ⇒ 所有 `skipIf(!CAN_RUN_FRESH)` 的浏览器族**整组 skip**。
 *   而 `CAN_RUN_FRESH` 是**模块级常量**、判据又是**全仓全局**的（任何 `src/**` 的
 *   mtime 比 `build-dist/index.html` 新即触发）—— 多写者并行时，**别人的在飞编辑
 *   会静默跳过我的浏览器验收**，红灯不响（实测：我 build 完成 13 秒后另一条线改了
 *   `SettingsDialog.tsx`，我那次跑的 `i18n-browser.spec.ts` 直接 skip）。
 *
 *   ⇒ 这里只加**声音**，**不动判定逻辑**：skip 仍然是 skip。
 *     （拿旧产物跑出来的绿是**假绿**，skip 比假绿安全；问题只在「静默」二字。）
 *   为什么用 globalThis 去重：每个 spec 文件各自 import 本模块、各自求值一次
 *   `CAN_RUN_FRESH` ⇒ 不去重会刷满屏；去重后**每次跑批只说一次**，但一定说得清楚。
 */
export function staleInputs(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = fs.statSync(DIST_INDEX).mtimeMs;
  const candidates = [
    ...BUILD_INPUT_DIRS.flatMap((d) => collectFiles(resolve(REPO_ROOT, d))),
    ...BUILD_INPUT_FILES.map((f) => resolve(REPO_ROOT, f)).filter((f) => existsSync(f)),
  ];
  const stale = candidates.filter((f) => fs.statSync(f).mtimeMs > distMs);
  if (stale.length > 0) warnStaleOnce(stale, distMs);
  return stale;
}

/** 过期告警（每次进程只说一次；列出「哪些 src 文件比产物新」+ 复跑指引） */
function warnStaleOnce(stale: readonly string[], distMs: number): void {
  const g = globalThis as unknown as { __staleWarned?: boolean };
  if (g.__staleWarned) return;
  g.__staleWarned = true;
  const rel = (p: string): string => p.slice(REPO_ROOT.length + 1).split('\\').join('/');
  const shown = stale.slice(0, 8).map(rel);
  const more = stale.length > shown.length ? ` …另有 ${stale.length - shown.length} 个` : '';
  // eslint-disable-next-line no-console
  console.warn(
    [
      '',
      '⚠️  build-dist 已过期 ⇒ 浏览器族 spec 将**整组 skip**（skip ≠ 通过）。',
      `   产物 build-dist/index.html 时间：${new Date(distMs).toISOString()}`,
      `   比它新的构建输入共 ${stale.length} 个：`,
      ...shown.map((f) => `     · ${f}`),
      `     ${more}`,
      '   ⇒ 复跑前先 `npm run build`（或删掉 build-dist 重建）；',
      '   ⇒ 全量跑批时请全队冻结 src 编辑（见 docs/release-checklist.md §1）。',
      '',
    ].join('\n'),
  );
}

/** 产物存在且未过期（spec 的 skipIf 判据） */
export const CAN_RUN_FRESH = CAN_RUN && staleInputs().length === 0;

/** SPA 必须走 HTTP 服务（vite base:'/'，file:// 下资源全 404） */
export async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('node:http') as typeof import('node:http');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join, extname } = require('node:path') as typeof import('node:path');
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-ico',
  };
  const server = http.createServer((req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let p = join(rootDir, raw);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      if (/\.(js|mjs|css|json|woff2?|svg|ico)$/.test(raw)) {
        res.writeHead(404).end('nf');
        return;
      }
      p = join(rootDir, 'index.html');
    }
    try {
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(fs.readFileSync(p));
    } catch {
      res.writeHead(404).end('nf');
    }
  });
  // listen(0) 的随机端口可能撞 Chromium 不安全端口黑名单 ⇒ 安全 listen
  return listenOnSafePort(server, '/');
}

/** 截图证据目录（qa-scratch 已在 .gitignore；每个 spec 传自己的子目录名） */
export function shotDir(name: string): string {
  const dir = resolve(REPO_ROOT, 'qa-scratch', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/* ---------------------------------- 进入流程 ---------------------------------- */

/**
 * 首启建管理员 → 载入 indoor 示例（执行乙是 indoor 种子里的 stage owner，其名下必有
 * 相关项目）。与 member-board-layout.spec.ts 的 enterMemberBoard 前半段同口径。
 */
export async function bootstrapAdminWithDemo(page: Page, serverUrl: string): Promise<void> {
  await page.goto(serverUrl);
  await page.waitForSelector('header', { timeout: 20000 });

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '我是管理员');
    b?.click();
  });
  await page.waitForTimeout(400);
  await page.locator('input[placeholder="你的姓名"]').fill('探针甲');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('确认为管理员'));
    b?.click();
  });
  await page.waitForTimeout(1200);

  const card = page.locator('[data-first-run-card="indoor"]');
  await card.first().waitFor({ state: 'visible', timeout: 10000 });
  await card.first().click();
  await page.waitForTimeout(400);
  await page.locator('button', { hasText: '确认载入' }).first().click();
  await page.waitForFunction((name) => document.body.innerText.includes(name), '演示项目1', { timeout: 20000 });
  await page.waitForTimeout(1500);
}

/**
 * 确认身份已建立为示例包里的管理员「负责人甲」。
 *
 * ── ★ 语义订正（2026-10-14）：本文件两个 helper 的旧前置都建立在一条**已死**的假设上 ──
 * 旧写法是「点『点击进入』→ 走姓名流重新进入身份」，前提是**覆盖式导入后身份为空**。
 * 现状不然，且是**有意为之**的两条：
 *   · demo 包自带 `settings.currentMemberId = 'demo_admin'`（`demoDataFactory.ts`，登记为
 *     「demo 成员表的身份兜底」）；
 *   · `useRepos.bootstrapAllStores` 的身份候选阶梯（`9dd3d77`「每一档必须命中当前 members」）
 *     让这条兜底**真的生效**（并清掉悬挂的旧 id）⇒ **导入后身份已被自动建立为「负责人甲」**。
 * ⇒ 页面上**没有**「点击进入」可点。旧实现的 `b?.click()` 是**静默点空**，失败要等到下一步
 *   的 15s 超时，而那句超时话术是「等 `你的姓名` 输入框」——**看起来像成员看板坏了**，
 *   把排查指向完全错误的方向。
 *
 * ⇒ 本函数把那种静默失败换成**前置断言**：等不到就当场抛，并直说是**旧语义过期**。
 */
async function assertAdminIdentity(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () => (document.body.textContent ?? '').includes('负责人甲'),
      undefined,
      { timeout: 15000 },
    );
  } catch {
    throw new Error(
      '前置失败：身份未被示例包自动建立为「负责人甲」。' +
        '最可能的成因是「**覆盖式导入后身份为空**」这条旧假设又回来了（本文件两个 helper 的旧语义正是它）：' +
        '请先确认 (a) src/core/demo/demoDataFactory.ts 的 settings 段是否仍带 ' +
        "currentMemberId='demo_admin'，(b) src/hooks/useRepos.ts 的身份候选阶梯是否仍在生效。" +
        '若这两条都在，那就是本 helper 需要跟着改，而不是产品坏了。',
    );
  }
}

/**
 * 整库导入（loadDemo）会替换 members；**现在**（`9dd3d77` 之后）新身份会由 demo 包自带的
 * `currentMemberId` 自动建立为管理员「负责人甲」 —— 本函数因此退化为**断言这一点成立**。
 *
 * （旧语义：点「点击进入」→ 填「负责人甲」→ 认管理员。那条路的前提「导入后身份为空」已死。）
 */
export async function reenterAdmin(page: Page): Promise<void> {
  await assertAdminIdentity(page);
  await page.waitForTimeout(400);
}

/**
 * 「以成员（执行乙）身份打开成员看板」。
 *
 * ── ★ 语义订正（2026-10-14）：旧版点「点击进入」+ 填姓名，前提已死（见 assertAdminIdentity）──
 * 导入示例数据后身份**已经**是管理员「负责人甲」，页面上没有「点击进入」；
 * 而 5 份 spec 要的是**成员视角**，所以必须**真的切成成员**：
 *
 * ⚠️ 「只自检身份、不切身份」这条**捷径走不通**（`fix-settings-restore` 用探针实测过）：
 *   `SidebarNav` 的侧栏首项按角色分流（管理员 `to:'/'`、成员 `to:'/member-board'`），
 *   管理员身份下**没有** `a[href="/member-board"]`（实测 `memberBoardLink: 0`）
 *   ⇒ 本函数最后那步会**静默点空**。必须切成成员（实测切换后 `memberBoardLink: 1`）。
 *
 * 三步切换是实测验证过的（身份菜单用 `[data-identity-menu]` 钩子定位 —— 不拿中文 aria 当契约）。
 */
export async function enterMemberBoard(page: Page): Promise<void> {
  // ① 前置：身份已由示例包建立（旧假设的替代 —— 失败会直说「旧语义过期」而不是 15s 超时）
  await assertAdminIdentity(page);

  /*
   * ⚠️ 两个坑都在这里（1152 档实测，探针见 qa-scratch/probe-identity-1152.mjs）：
   *  ① **两个变体同时在 DOM 里**：收起态 `title="负责人甲 · 管理员（点击切换/退出）"`（宽 0、隐藏）
   *     与展开态 `title="当前身份（点击切换/退出）"`（宽 206、可见）**同时存在**
   *     ⇒ 只写 `title$=` + `.first()` 会**选中隐藏的那个**，`isVisible()` 永远 false。
   *     ⇒ 必须加 `:visible` 过滤。
   *  ② **<xl（1280 以下）侧栏自身是抽屉**：身份行在 DOM 里但整体不可见 ⇒ 先用顶栏汉堡
   *     `[data-nav-menu-trigger]` 把侧栏打开（≥xl 是持久左栏，不需要这一步）。
   */
  const identityTrigger = page.locator('[data-app-sidebar] button[title$="（点击切换/退出）"]:visible');
  if ((await identityTrigger.count()) === 0) {
    const burger = page.locator('[data-nav-menu-trigger]');
    if ((await burger.count()) > 0) {
      await burger.first().click();
      await page.waitForTimeout(800);
    }
  }
  if ((await identityTrigger.count()) === 0) {
    throw new Error(
      '前置失败：找不到**可见的**身份触发器（`[data-app-sidebar] button[title$="（点击切换/退出）"]:visible`）。' +
        '可能成因：(a) 身份控件又被搬回了顶栏/别处；(b) 侧栏档位变了（<xl 是抽屉，需要先开侧栏）；' +
        '(c) 本次导入后身份压根没建立（那应当由 assertAdminIdentity 先报）。',
    );
  }
  await identityTrigger.first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-identity-menu] [role="menuitem"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('input[placeholder="你的姓名"]').fill('执行乙');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '下一步');
    b?.click();
  });
  await page.waitForTimeout(1200);

  // ③ 前置断言：确实成了成员。判据用「/member-board 入口出现」——这是角色分流的直接后果，
  //    也正是旧写法会静默点空的那一步；点不到就在这里响亮地失败，而不是等到 20s 后超时。
  const memberBoardLink = await page.evaluate(
    () => document.querySelectorAll('a[href="/member-board"]').length,
  );
  if (memberBoardLink === 0) {
    throw new Error(
      '前置失败：切身份后仍看不到 /member-board 入口 ⇒ 身份没切成成员「执行乙」' +
        '（或 SidebarNav 的角色分流改了）。旧写法在这里是 `?.click()` 静默点空、' +
        '然后在 20s 后抛「等 [role=button].group 超时」——那句话会把人指向「成员看板坏了」。',
    );
  }

  // 点侧栏「成员看板」入口。按 href 而非文案：成员的侧栏首项叫「看板」、
  // 管理员的叫「项目」（SidebarNav 按角色分流），文案会漂移，href 不会。
  await page.evaluate(() => {
    document.querySelector('a[href="/member-board"]')?.click();
  });
  await page.waitForSelector('[role="button"].group', { timeout: 20000 });
  await page.waitForTimeout(600);
}

/** 起静态服务（spec 的 beforeAll 用；浏览器由 spec 自己 chromium.launch） */
export async function startServer(): Promise<{ url: string; close(): Promise<void> }> {
  return startStaticServer(resolve(REPO_ROOT, 'build-dist'));
}

/** 新开一个上下文（viewport 可指定） */
export async function newContext(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<BrowserContext> {
  return browser.newContext({ viewport });
}
