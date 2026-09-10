import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * v0.7 阶段 B · 人话/技术双模式看板验收（T06–T08；真实构建产物 + 真 Chromium 实测）。
 *
 * ── 为什么必须真浏览器（与阶段 A `layout-walkthrough.spec.ts` 同一理由，此处更甚）──
 *   本批验收点几乎全部是**「界面上到底出现了什么」**：
 *     · 人话模式是否真的没有英文 status（DOM 里有没有角标元素、可见文本有没有那些词）；
 *     · 四组分区是否真的按 `HUMAN_BOARD_GROUP_ORDER` 渲染、每条任务是否落在正确的组；
 *     · `?mode=` 深链是否改的是 **history.replaceState**（`history.length` 不变）；
 *     · 抽屉里的「技术详情」是否**折叠而非删除**（原生 `<details>` 的 `open` 状态 +
 *       折叠态下内容是否真的不可见）。
 *   前两条在 jsdom 里勉强能测，后两条**测不了**：`<details>` 的折叠语义是
 *   「内容不进入渲染树/可见文本」，jsdom 既不实现布局也不实现 `innerText` 的
 *   可见性语义（`innerText` 在 jsdom 里等同 `textContent`，会把折叠内容也算进来
 *   → 「折叠可见」这条会**假绿**）。故必须真浏览器 + 真 CSS + 真历史栈。
 *
 * ── 为什么跑 `build-dist` 而不是 dev server ──
 *   同阶段 A：产物是发布形态（Tailwind JIT 已固化的 CSS + 路由 base '/'），
 *   且能在「发布前走查」里顺带覆盖「构建产物能不能跑起来」。
 *
 * ── 前置 ──
 *   `npm run build` 必须先跑过（产物 `build-dist/index.html`）。
 *   产物或 Chromium 缺失 → 本 spec **跳过**（skip）而非失败：属于发布前走查，
 *   不该让「没构建」把默认 `npm test` 染红。强制验收：`npm run build && npm test`。
 *
 * ── 数据从哪来（关键设计）──
 *   四组分区要有内容才有意义，而看板没有「新建任务」入口。故本 spec 用**应用自己的
 *   备份导入链路**（顶栏/侧栏隐藏 file input → `validateBackupJson` 预检 → 二次确认
 *   → `BackupService.importAndReplace` → `window.location.reload()`）灌入
 *   `tests/fixtures/v07-board-seed.json`。
 *   为什么不直接往 IndexedDB 里 `put`：
 *     ① 手写 raw IDB 要复刻 Dexie 的索引串（`&externalId` 唯一索引等）与版本号，
 *        一旦 Dexie 升级定义，这里就静默退化（`.where()` 报错或索引丢失）；
 *     ② 走导入链路顺带把「备份格式 ↔ zod 归一 ↔ 落库」整条真实路径也覆盖了——
 *        种子数据本身就是一次端到端验证，比自造 fixture 更有价值。
 *
 * ── 种子数据的期望分布（断言里的数字全部由它推出）──
 *   总 11 条（本项目）。四组：
 *     待我确认 2 = review(整理汇报材料) + blocked(补齐缺失的照片)
 *     可开工   3 = ready(确认材料清单 / 复核尺寸) + draft∧依赖已满足(拟定采买计划)
 *     进行中   2 = in_progress(绘制平面初稿) + claimed(核对预算表)
 *     已完成   1 = done(需求访谈记录)
 *     隐藏     3 = draft∧依赖未满足(输出交付清单) + 依赖环(环任务甲/乙)
 *   设计意图：
 *     · 「可开工」组(3) 严格 ⊇ `computeReadyTasks().ready`(2) —— 超集的那一条
 *       （拟定采买计划：draft 且前置已完成）是人话模式相对技术 Ready 队列多出来的，
 *       断言「现在该做什么」的小字为「可开工 2 项」而组内计数为 3，正是该包含关系；
 *     · 隐藏组 3 条在技术模式的 draft 泳道里**必须仍可见**（技术模式不降级，
 *       只是不参与人话分组），这是 T06 分流的关键不变量；
 *     · 依赖环两条 → `cyclicIds.size === 2` → 人话模式 amber 告警条出现
 *       （环成员被归入 hidden，若无告警等于无声消失）。
 *
 * ── 截图 ──
 *   落在 `qa-scratch/v07-stageB/`（8 项验收各自的证据；B-08 折叠/展开各一张，
 *   故共 10 张）。
 */

/** 构建产物入口 */
const DIST_INDEX = resolve(__dirname, '..', 'build-dist', 'index.html');
/** 种子备份包（应用自身 zod schema 校验通过的真备份格式） */
const SEED_FIXTURE = resolve(__dirname, 'fixtures', 'v07-board-seed.json');
/** 截图目录（8 项验收的证据） */
const SHOT_DIR = resolve(__dirname, '..', 'qa-scratch', 'v07-stageB');

/** 探测已安装的 chromium 可执行文件（跨平台；与阶段 A 同一实现） */
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

/**
 * 产物须经 **HTTP** 提供，不能走 `file://`。
 *
 * `vite.config.ts` 的 `base: '/'` 使产物内资源引用为绝对路径 `/assets/*.js`，
 * 在 `file://` 下会解析到盘根 → 404 → 应用根本不挂载（DOM 里连 header 都没有），
 * 表现为「所有断言全部返回 null」这种极具误导性的失败。
 * 故起一个零依赖的只读静态服务器（node:http），只服务 `build-dist/`，
 * 端口用 0 让内核分配（避免并发冲突），测试结束即关闭。SPA 回退与 nginx
 * `try_files` 同语义——这正是 `/agent` 这种前端路由能直达的前提。
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

/* ------------------------------ 常量（种子数据的期望值） ------------------------------ */

/** 用户可见的英文状态词（人话模式必须一个都不出现） */
const STATUS_WORDS = ['draft', 'ready', 'claimed', 'in_progress', 'blocked', 'review', 'done'];
/** 技术模式 7 列泳道顺序（与 `ALL_TASK_STATUSES` 同序） */
const LANE_ORDER = ['draft', 'ready', 'claimed', 'in_progress', 'blocked', 'review', 'done'];
/** 四组标题顺序（与 `HUMAN_BOARD_GROUP_ORDER` 同序；标题写死在 BOARD 组件） */
const GROUP_ORDER = ['待我确认', '可开工', '进行中', '已完成'];
/** 四组计数（由 fixture 推出；见文件头「种子数据的期望分布」） */
const GROUP_COUNTS: Record<string, number> = { 待我确认: 2, 可开工: 3, 进行中: 2, 已完成: 1 };
/** 任务标题 → 应落入的人话组 */
const TITLE_TO_GROUP: Record<string, string> = {
  整理汇报材料: '待我确认',
  补齐缺失的照片: '待我确认',
  确认材料清单: '可开工',
  复核尺寸: '可开工',
  拟定采买计划: '可开工',
  绘制平面初稿: '进行中',
  核对预算表: '进行中',
  需求访谈记录: '已完成',
};
/** 隐藏组（人话模式不渲染；技术模式 draft 泳道可见） */
const HIDDEN_TITLES = ['输出交付清单', '环任务甲', '环任务乙'];
/** 技术模式 draft 泳道条数 = 隐藏 3 + 拟定采买计划 1 */
const LANE_COUNTS: Record<string, number> = {
  draft: 4,
  ready: 2,
  claimed: 1,
  in_progress: 1,
  blocked: 1,
  review: 1,
  done: 1,
};
/** 加载屏障：这条任务在两种模式、两种主题下都可见 */
const READY_BARRIER_TITLE = '确认材料清单';
const PROJECT_NAME = '验收样例项目';

/* ------------------------------ 页面读取工具（纯数据，不传 DOM 对象） ------------------------------ */

interface GroupView {
  label: string;
  count: number | null;
  titles: string[];
}

/** 读四组：标题 / 计数 / 组内卡片标题（人话模式） */
async function readGroups(page: Page): Promise<GroupView[]> {
  return page.evaluate((order) => {
    return order.map((label) => {
      const sec = document.querySelector(`main section[aria-label="${label}"]`);
      if (!sec) return { label, count: null, titles: [] as string[] };
      const countEl = sec.querySelector('h2 + span');
      // 卡片根 = div.glass-light；其第一个 <button> 即「标题按钮」（人话卡片是
      // div 容器 + 标题按钮 + 主按钮；技术卡片整卡单按钮，不走本分支）
      const titles = Array.from(sec.querySelectorAll('div.glass-light')).map((card) => {
        const b = card.querySelector('button');
        return (b?.textContent ?? '').trim();
      });
      return {
        label,
        count: countEl ? Number((countEl.textContent ?? '').trim()) : null,
        titles,
      };
    });
  }, GROUP_ORDER);
}

/** 每条标题落在哪个 `section[aria-label]` 内（组归属；与渲染顺序无关，更稳） */
async function readTitleSections(
  page: Page,
  titles: string[],
): Promise<Record<string, string | null>> {
  return page.evaluate((list) => {
    const out: Record<string, string | null> = {};
    const buttons = Array.from(document.querySelectorAll('main button'));
    for (const t of list) {
      const btn = buttons.find((b) => (b.textContent ?? '').trim() === t);
      if (!btn) {
        out[t] = null;
        continue;
      }
      const sec = btn.closest('section[aria-label]');
      out[t] = sec ? sec.getAttribute('aria-label') : '(no-section)';
    }
    return out;
  }, titles);
}

/** `main` 内带 font-mono 且文本恰好是一个 status 的 span —— 即 `StatusBadge` 的像素级特征 */
async function readStatusBadges(page: Page): Promise<string[]> {
  return page.evaluate((words) => {
    const spans = Array.from(document.querySelectorAll('main span'));
    return spans
      .filter((el) => {
        const text = (el.textContent ?? '').trim();
        return words.includes(text) && (el.className || '').toString().includes('font-mono');
      })
      .map((el) => (el.textContent ?? '').trim());
  }, STATUS_WORDS);
}

/** 技术模式 7 列泳道：h2 文本 + 计数（含置顶的 Ready 队列 section 标题） */
async function readLanes(page: Page): Promise<Array<{ title: string; count: number | null }>> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('main section')).map((s) => {
      const h2 = s.querySelector('h2');
      const countEl = s.querySelector('h2 + div span, h2 + span');
      return {
        title: (h2?.textContent ?? '').trim(),
        count: countEl ? Number((countEl.textContent ?? '').trim()) : null,
      };
    });
  });
}

/** 当前 aria-selected=true 的 tab 文本（模式切换的唯一真相源在 store，这是它的 UI 投影） */
async function readSelectedTabs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"]'))
      .filter((t) => t.getAttribute('aria-selected') === 'true')
      .map((t) => (t.textContent ?? '').trim()),
  );
}

/** localStorage 里的布局偏好（`idplan.layout`，persist 的 partialize 白名单） */
async function readLayoutPrefs(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('idplan.layout');
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as { state?: Record<string, unknown> }).state ?? null;
    } catch {
      return null;
    }
  });
}

/** 依序点击组标题为 `name` 的 tab */
async function clickTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await page.waitForTimeout(250);
}

describe.skipIf(!CAN_RUN)('v0.7 阶段 B · T06–T08 人话/技术双模式看板验收（真实构建产物）', () => {
  let browser: Browser;
  /** 整个 spec 共用一个 context：localStorage（模式偏好）与 IndexedDB（种子数据）都在其中 */
  let ctx: BrowserContext;
  let server: { url: string; close(): Promise<void> };
  let base = '';
  /**
   * 「同源操作页」：只在需要**在下一个文档脚本执行前**改 localStorage 时用
   * （清 `idplan.layout` 以验证默认模式）。
   *
   * 为什么不用 `page.addInitScript(... removeItem ...)`：
   *   init script 对该 page 的**每一次导航**都生效。B-06「重载后仍是所选」需要在
   *   切到技术模式后重新加载页面并断言持久化生效——若 init script 还在清，
   *   断言会被自己清掉（首轮实测即栽在此处：`goto` 后仍回到人话）。
   *   故「清偏好」必须是一次性动作，落在另一个常驻的同源页面上执行。
   */
  let control: Page;

  beforeAll(async () => {
    mkdirSync(SHOT_DIR, { recursive: true });
    server = await startStaticServer(resolve(__dirname, '..', 'build-dist'));
    base = server.url.replace(/index\.html$/, ''); // http://127.0.0.1:<port>/
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
    ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });

    /**
     * 预置「已进入身份」。
     * `useFirstRunGate` 的触发条件是 `currentMemberId === null ∧ 无管理员 ∧ …`：
     * 全新空库首次打开会弹 admin_prompt 引导框（identityFlow 状态机）。
     * 该框本身不阻断 `setInputFiles`（走 DOM 赋值而非点击），但会让「页面是不是
     * 正常进入」的判定变浑浊。故在**任何页面脚本之前**写入 localStorage 的
     * `changxia.currentMemberId`（键名唯一出处 `useSettingsStore.ts:24`）指向
     * 种子里的管理员；导入完成后该成员真实存在，身份即成立。
     * 这里用 `addInitScript` 是合适的：它是「每次加载都要成立的前置状态」，
     * 与该页的导航次数无关（不会像清偏好那样自我抵消）。
     */
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('changxia.currentMemberId', 'm-admin');
      } catch {
        /* 隐私模式下 localStorage 不可写——种子导入随后会失败并给出清晰报错 */
      }
    });

    const seedPage = await ctx.newPage();
    await seedViaBackupImport(seedPage);
    await seedPage.close();

    // 常驻同源页：仅用于「一次性清 localStorage」（见 control 字段注释）
    control = await ctx.newPage();
    await control.goto(`${base}index.html`);
    await control.waitForSelector('header', { timeout: 20000 });
  });

  afterAll(async () => {
    await ctx?.close();
    await browser?.close();
    await server?.close();
  });

  /** 清掉布局偏好（`idplan.layout`）——下一个打开的页面即走「无持久偏好 → 默认人话」 */
  async function clearModePref(): Promise<void> {
    await control.evaluate(() => localStorage.removeItem('idplan.layout'));
  }

  /**
   * 灌种子数据：走应用自己的备份导入链路（隐藏 file input → 预检 → 二次确认 → 整库替换 → reload）。
   * 任何一步失败都抛出**带页面原文**的错误，避免「卡在 waitFor 超时」这种无信息失败。
   */
  async function seedViaBackupImport(page: Page): Promise<void> {
    await page.goto(`${base}index.html`);
    await page.waitForSelector('header', { timeout: 20000 });

    // 侧栏里那个 `input[type=file].hidden`（useBackupIo）——它 `display:none`，
    // 故必须 `force` 绕过可见性检查（setInputFiles 本身是赋 value，不需要真点击）
    await page
      .locator('input[type="file"][accept*="json"]')
      .first()
      .setInputFiles(SEED_FIXTURE, { force: true });

    const confirm = page.getByRole('button', { name: '确认恢复' });
    try {
      await confirm.waitFor({ state: 'attached', timeout: 15000 });
    } catch {
      const text = await page.locator('body').innerText();
      throw new Error(
        '备份导入未进入二次确认：fixture 可能未通过 zod 预检（页面会 toast「备份文件校验失败」）。' +
          `页面文本片段：${text.slice(0, 500)}`,
      );
    }
    await confirm.click({ force: true });

    // 导入成功 → `window.location.reload()`；用「项目名出现在页面里」作为新文档就绪的信号
    try {
      await page.waitForFunction(
        (name) => document.body.innerText.includes(name),
        PROJECT_NAME,
        { timeout: 20000 },
      );
    } catch {
      const text = await page.locator('body').innerText();
      throw new Error(
        `备份导入后未观察到种子项目「${PROJECT_NAME}」。页面文本片段：${text.slice(0, 500)}`,
      );
    }
  }

  /**
   * 开一个看板页并等到数据装载完成。
   * @param route     相对路由（默认 `agent`，可带 query 做深链）
   * @param resetMode true = **开页前**清掉 `idplan.layout`，用于验证「无持久偏好 → 默认人话」
   */
  async function openBoard(opts: { route?: string; resetMode?: boolean } = {}): Promise<Page> {
    // 必须在目标页创建之前清：persist 的同步 hydration 发生在模块求值期（早于首帧）
    if (opts.resetMode) await clearModePref();
    const page = await ctx.newPage();
    await page.goto(base + (opts.route ?? 'agent'));
    await page.waitForSelector('main', { timeout: 20000 });
    // 数据装载屏障：这条任务在两种模式、两种主题下都渲染，出现即代表 loadProject 已回填
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      READY_BARRIER_TITLE,
      { timeout: 20000 },
    );
    await page.waitForTimeout(250);
    return page;
  }

  async function shot(page: Page, name: string): Promise<void> {
    await page.screenshot({ path: resolve(SHOT_DIR, name), fullPage: true });
  }

  /* ===================================================================================
   * 验收 1 · 默认进入 = 人话模式，且不出现任何英文状态
   * =================================================================================== */
  it('B-01 · 默认进入人话模式；`main` 内零英文状态（文本 + 角标元素双查）', async () => {
    const page = await openBoard({ resetMode: true });

    // 默认模式 = DEFAULT_AGENT_TERM_MODE = 'human'（无持久偏好时）
    expect(await readSelectedTabs(page)).toEqual(['人话']);
    expect(await page.evaluate(() => location.search)).toBe('');

    // ① 可见文本：`main` 内不得出现任何英文状态词
    const mainText = await page.locator('main').innerText();
    for (const w of STATUS_WORDS) {
      expect(mainText, `人话模式 main 内出现了英文状态「${w}」`).not.toMatch(
        new RegExp(`\\b${w}\\b`),
      );
    }

    // ② 元素级：不得存在 StatusBadge 特征（font-mono + 文本恰为 status）
    //    只查文本会漏掉「角标存在但被 CSS 隐藏」；只查元素会漏掉别处的裸文本。
    expect(await readStatusBadges(page)).toEqual([]);

    // ③ 人话标题存在（证明页面真的渲染了数据，而不是空态蒙对）
    expect(mainText).toContain('现在该做什么');
    expect(mainText).toContain(READY_BARRIER_TITLE);

    await shot(page, '01-human-default.png');
    await page.close();
  });

  /* ===================================================================================
   * 验收 2 · 四组标题齐全 + 分组正确（含隐藏组不出现在主列表）
   * =================================================================================== */
  it('B-02 · 四组标题齐全且顺序固定；每条任务落在正确组；隐藏组不进主列表', async () => {
    const page = await openBoard({ resetMode: true });

    const groups = await readGroups(page);
    expect(groups.map((g) => g.label)).toEqual(GROUP_ORDER);
    for (const g of groups) {
      expect(g.count, `${g.label} 组计数`).toBe(GROUP_COUNTS[g.label]);
      expect(g.titles.length, `${g.label} 组内卡片数`).toBe(GROUP_COUNTS[g.label]);
    }

    // 组归属逐条核对（与渲染顺序解耦：看每条标题的最近的 section[aria-label] 祖先）
    const where = await readTitleSections(page, Object.keys(TITLE_TO_GROUP));
    for (const [title, group] of Object.entries(TITLE_TO_GROUP)) {
      expect(where[title], `「${title}」应落在「${group}」组`).toBe(group);
    }

    // 隐藏组（draft ∧ 依赖未满足 / 依赖环）一条都不许漏进主列表
    const hiddenWhere = await readTitleSections(page, HIDDEN_TITLES);
    for (const t of HIDDEN_TITLES) {
      expect(hiddenWhere[t], `隐藏任务「${t}」不应出现在人话主列表`).toBeNull();
    }

    // 依赖环告警：环成员被归入 hidden，若无提示等于在界面上无声消失
    const alert = await page.locator('main [role="alert"]').innerText();
    expect(alert).toContain('2 条任务存在依赖环');

    await shot(page, '02-human-four-groups.png');
    await page.close();
  });

  /* ===================================================================================
   * 验收 3 · 「现在该做什么」= computeReadyTasks 置顶条
   * =================================================================================== */
  it('B-03 · 「现在该做什么」取 computeReadyTasks 置顶条（可开工 2 项 ⊂ 组内 3 条）', async () => {
    const page = await openBoard({ resetMode: true });

    const top = page.locator('main section[aria-label="现在该做什么"]');
    const topText = await top.innerText();
    // 置顶条 = ready[0]：两条 ready 中 dueDate 更早的那条（2099-12-30 < 2099-12-31）
    expect(topText).toContain(READY_BARRIER_TITLE);
    expect(topText).not.toContain('复核尺寸');

    // 小字计数取的是 computeReadyTasks().ready.length（= 2），
    // 而人话「可开工」组是它的**超集**（多出 draft∧依赖已满足的「拟定采买计划」= 3）
    expect(topText).toContain('可开工 2 项');
    const readyGroup = (await readGroups(page)).find((g) => g.label === '可开工');
    expect(readyGroup?.count).toBe(3);
    expect(readyGroup?.titles).toContain('拟定采买计划');

    // 置顶条可点开抽屉（不是装饰性文本）
    await top.locator('button').first().click();
    await page.waitForSelector('[role="dialog"][aria-label="任务详情"]', { timeout: 10000 });
    expect(await page.locator('[role="dialog"][aria-label="任务详情"] h2').innerText()).toBe(
      READY_BARRIER_TITLE,
    );

    await shot(page, '03-now-what-pinned.png');
    await page.close();
  });

  /* ===================================================================================
   * 验收 4 · 切到技术模式：7 列泳道仍在（不降级）+ Ready 队列回归 + 隐藏任务可见
   * =================================================================================== */
  it('B-04 · 技术模式：Ready 队列 + 7 列 status 泳道不降级，隐藏任务在 draft 泳道仍可见', async () => {
    const page = await openBoard({ resetMode: true });
    await clickTab(page, '技术');

    const lanes = await readLanes(page);
    // 第 1 个 section = Ready 队列置顶区（人话模式刻意不渲染它，避免与「可开工」组重复）
    expect(lanes).toHaveLength(1 + LANE_ORDER.length);
    expect(lanes[0]!.title).toContain('Ready');
    expect(lanes.slice(1).map((l) => l.title)).toEqual(LANE_ORDER);
    for (const lane of lanes.slice(1)) {
      expect(lane.count, `${lane.title} 泳道条数`).toBe(LANE_COUNTS[lane.title]);
    }

    // 四组视图退场
    expect(await page.locator('main section[aria-label="待我确认"]').count()).toBe(0);

    // 技术模式完整显示 7 值状态（人话模式隐藏的英文状态，在这里是本体）
    const mainText = await page.locator('main').innerText();
    for (const w of STATUS_WORDS) expect(mainText).toContain(w);
    expect((await readStatusBadges(page)).length).toBeGreaterThan(0);

    // 隐藏组 3 条在 draft 泳道仍可见（技术模式「不降级」的核心含义）
    for (const t of HIDDEN_TITLES) expect(mainText).toContain(t);

    await shot(page, '04-tech-seven-lanes.png');
    await page.close();
  });

  /* ===================================================================================
   * 验收 5 · `?mode=tech` 深链直达 + 切换用 replace（history.length 不变）
   * =================================================================================== */
  it('B-05 · ?mode=tech 深链直达；切换模式用 replaceState（history.length 不变）', async () => {
    const page = await openBoard({ route: 'agent?mode=tech', resetMode: true });

    // 深链生效：URL 是镜像，store 是真相源 → UI 投影为「技术」选中
    expect(await readSelectedTabs(page)).toEqual(['技术']);
    expect(await page.evaluate(() => location.search)).toBe('?mode=tech');
    expect((await readLanes(page)).slice(1).map((l) => l.title)).toEqual(LANE_ORDER);

    const len0 = await page.evaluate(() => history.length);

    // 切到人话：URL 镜像同步更新，但**不得**新增历史条目（否则返回键在两个模式间横跳）
    await clickTab(page, '人话');
    expect(await readSelectedTabs(page)).toEqual(['人话']);
    expect(await page.evaluate(() => location.search)).toBe('?mode=human');
    expect(await page.evaluate(() => history.length)).toBe(len0);

    // 切回技术：同样不新增
    await clickTab(page, '技术');
    expect(await readSelectedTabs(page)).toEqual(['技术']);
    expect(await page.evaluate(() => location.search)).toBe('?mode=tech');
    expect(await page.evaluate(() => history.length)).toBe(len0);

    await shot(page, '05-deeplink-tech.png');
    await page.close();
  });

  /* ===================================================================================
   * 验收 6 · 模式偏好持久化到 localStorage，重载仍是所选
   * =================================================================================== */
  it('B-06 · 模式偏好写入 localStorage（idplan.layout），重载后仍是技术模式', async () => {
    const page = await openBoard({ resetMode: true });

    await clickTab(page, '技术');
    // 落库证据：persist 的 partialize 白名单里带了 agentBoardMode
    const prefs = await readLayoutPrefs(page);
    expect(prefs?.['agentBoardMode']).toBe('tech');

    /**
     * ⚠️ 必须 `goto` 一个**不带 `?mode=` 的地址**再断言：
     *   若直接 `page.reload()`，URL 里仍有 `?mode=tech`，深链效应会自己把模式写回
     *   tech —— 那样测的是 URL，不是持久化（假绿）。
     *   去掉 query 后，模式只能来自 localStorage。
     */
    await page.goto(`${base}agent`);
    await page.waitForSelector('main', { timeout: 20000 });
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      READY_BARRIER_TITLE,
      { timeout: 20000 },
    );
    await page.waitForTimeout(250);

    expect(await page.evaluate(() => location.search)).toBe('');
    expect(await readSelectedTabs(page)).toEqual(['技术']);
    expect((await readLanes(page)).slice(1).map((l) => l.title)).toEqual(LANE_ORDER);

    await shot(page, '06-persist-after-reload.png');
    await page.close();
  });

  /* ===================================================================================
   * 验收 7 · 暗色主题两种模式都正常（token 自动换肤，无额外适配）
   * =================================================================================== */
  it('B-07 · 暗色主题下两种模式均正常渲染且走 CSS token 换肤', async () => {
    const page = await openBoard({ resetMode: true });

    /** 读「人话组标题」/「技术泳道标题」的文字色（text-ink token 的投影） */
    const readTitleColors = (): Promise<{ group: string; lane: string }> =>
      page.evaluate(() => {
        const g = document.querySelector('main section[aria-label="待我确认"] h2');
        const lanes = Array.from(document.querySelectorAll('main section h2')).find(
          (h) => (h.textContent ?? '').trim() === 'draft',
        );
        return {
          group: g ? getComputedStyle(g).color : '',
          lane: lanes ? getComputedStyle(lanes).color : '',
        };
      });

    const lightHuman = await readTitleColors();
    expect(lightHuman.group).not.toBe('');

    // 暗色机制 = `<html data-theme="dark">`（`useTheme` + 全局 CSS 覆盖 token）。
    // 注意**不能**用 classList.add('dark')：本项目不是 Tailwind darkMode:'class' 那套。
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(300);

    // 人话模式：四组仍在、顺序不变、计数不变，仅颜色换肤
    expect(await page.locator('main [role="alert"]').count()).toBe(1);
    const darkGroups = await readGroups(page);
    expect(darkGroups.map((g) => g.label)).toEqual(GROUP_ORDER);
    expect(darkGroups.map((g) => g.count)).toEqual(GROUP_ORDER.map((l) => GROUP_COUNTS[l]));
    const darkHuman = await readTitleColors();
    expect(darkHuman.group).not.toBe(lightHuman.group);

    await shot(page, '07-dark-human.png');

    // 技术模式：切过去后 7 列仍在且同样换肤
    await clickTab(page, '技术');
    expect((await readLanes(page)).slice(1).map((l) => l.title)).toEqual(LANE_ORDER);
    const darkTech = await readTitleColors();
    expect(darkTech.lane).not.toBe('');
    expect(darkTech.lane).not.toBe(lightHuman.lane);
    expect(await page.locator('html[data-theme="dark"]').count()).toBe(1);

    await shot(page, '08-dark-tech.png');
    await page.close();
  });

  /* ===================================================================================
   * 验收 8 · 人话模式抽屉：技术字段可折叠可见（不是删除）+ 不渲染英文 status 角标
   * =================================================================================== */
  it('B-08 · 人话抽屉技术字段折叠可见（details 展开前后对比）+ 不渲染 status 角标', async () => {
    const page = await openBoard({ resetMode: true });

    // 用「进行中」组的卡片开抽屉（in_progress，技术字段最全：startAt / claimedAt / status）
    await page.getByRole('button', { name: '绘制平面初稿', exact: true }).click();
    const drawer = page.locator('[role="dialog"][aria-label="任务详情"]');
    await drawer.waitFor({ state: 'visible', timeout: 10000 });

    // ① 折叠态：抽屉**概要区**（抽屉内第一个 section）不得出现英文状态
    //    （不变量 ①：状态语义由 BOARD 的组归属表达，抽屉里不再翻一遍英文角标）
    //
    //    为什么只查概要区而不是整个抽屉：产出物清单里会出现**合法**的英文单词——
    //    本 fixture 的 `artifacts[0].path = /tmp/draft.md`，全抽屉文本扫 `\bdraft\b`
    //    会命中它（首轮实测即此假红）。概要区才是人话模式原本要隐藏 status 的地方。
    const summary = drawer.locator('section').first();
    const collapsedText = await summary.innerText();
    expect(collapsedText).toContain('技术详情');
    for (const w of STATUS_WORDS) {
      expect(collapsedText, `人话抽屉概要区出现了英文状态「${w}」`).not.toMatch(
        new RegExp(`\\b${w}\\b`),
      );
    }
    // 注：本条任务为 in_progress，抽屉不渲染认领按钮（canClaim 仅 ready ∧ claimedAt=null），
    // 故「认领 / claim 文案」的断言放在下面 ③ 用 ready 任务做。
    // 元素级：概要区内（**排出 `<details>`**）不得存在 StatusBadge 特征。
    // 必须排除 details：折叠只是「不进入可见文本」，DOM 里仍有 `status` 字段的
    // font-mono 原值；不排除就会把「已折叠的技术字段」误判成「渲染了角标」。
    const summaryBadges = await drawer.evaluate((dialog, words) => {
      const sec = dialog.querySelector('section');
      if (!sec) return [] as string[];
      return Array.from(sec.querySelectorAll('span'))
        .filter((el) => !el.closest('details'))
        .filter((el) => {
          const text = (el.textContent ?? '').trim();
          return words.includes(text) && (el.className || '').toString().includes('font-mono');
        })
        .map((el) => (el.textContent ?? '').trim());
    }, STATUS_WORDS);
    expect(summaryBadges).toEqual([]);
    // 技术字段在折叠态**不进可见文本**（原生 <details> 的可见性语义；jsdom 测不出这条）
    expect(collapsedText).not.toContain('codex:run7:doing');
    expect(await drawer.locator('details').evaluate((el) => (el as HTMLDetailsElement).open)).toBe(
      false,
    );

    // ② 展开：技术字段逐项可见（折叠而非删除 —— 审计时仍能拿到原值）
    await drawer.locator('details > summary').click();
    await page.waitForTimeout(200);
    expect(await drawer.locator('details').evaluate((el) => (el as HTMLDetailsElement).open)).toBe(
      true,
    );
    const expandedText = await drawer.innerText();
    expect(expandedText).toContain('codex:run7:doing'); // externalId
    expect(expandedText).toContain('in_progress'); // status 原值
    expect(expandedText).toContain('tsk-v07b-doing'); // id
    expect(expandedText).toContain('2026-01-11'); // startAt
    expect(expandedText).toContain('流转 →'); // 状态流转按钮随技术字段一起折叠

    await shot(page, '09-drawer-tech-collapsed.png');
    await drawer.locator('details > summary').click(); // 收回折叠态再截图，便于对比
    await page.waitForTimeout(150);
    await shot(page, '10-drawer-tech-expanded.png');

    await drawer.getByRole('button', { name: '关闭任务详情' }).click();
    await page.waitForTimeout(200);

    // ③ 人话模式认领按钮文案为「认领」（PRD 要隐藏英文 claim）
    await page.getByRole('button', { name: READY_BARRIER_TITLE, exact: true }).click();
    await drawer.waitFor({ state: 'visible', timeout: 10000 });
    expect(await drawer.getByRole('button', { name: '认领', exact: true }).count()).toBe(1);
    expect(await drawer.getByRole('button', { name: 'claim', exact: true }).count()).toBe(0);

    await page.close();
  });
});

// 产物/浏览器缺失时给出可操作的提示（避免「skip 静默通过」被误读为已验收）
describe('v0.7 阶段 B · 验收前置检查', () => {
  it('构建产物、种子 fixture 与 Chromium 可用（缺失则上面的验收被跳过）', () => {
    if (!CAN_RUN) {
      // eslint-disable-next-line no-console
      console.warn(
        `[v07-board-acceptance] 跳过验收：build-dist 存在=${existsSync(DIST_INDEX)} chromium 存在=${CHROMIUM_PATH !== null}。` +
          ' 请先 npm run build（Chromium 由 playwright-core 依赖安装）。',
      );
    }
    expect(existsSync(SEED_FIXTURE)).toBe(true);
    expect(true).toBe(true);
  });
});
