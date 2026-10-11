import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { listenOnSafePort } from './helpers/safe-listen';


/**
 * 0.8.6.0002 · 反馈 #10.4（成员看板 UI 完全出错）—— 真 Chromium 布局度量回归。
 *
 * 她的原话：「切换到群成员的看板位置，UI 会完全出错……1. 字体显示不完整；
 * 2. 图标各方面都有问题」（她标注「这个 bug 需要深度修复」）。
 *
 * 根因（修复前实测记录，详见 fix 提交）：ProjectCard 的 `xl:flex-[1_1_340px]` 与
 * `md:w-[calc(50%-10px)]` 是首页 flex-wrap **行**的专用类，成员看板把它们放进了
 * flex-col 看板列——340 基准作用到纵轴（卡片 340px 高，规格 185）、半宽类把卡片
 * 压成列宽一半（1152/1024 档实测 105–130px：标题截断、Tag 逐字竖绕、头像行报废）；
 * 另统计卡行断点与 StatCard 自身错配（lg 档半格宽）。jsdom 不实现布局，这类座标
 * 只能真 Chromium 量 getBoundingClientRect。
 *
 * 前置：`npm run build` 先跑过；产物/Chromium 缺失或产物过期 → 整组 skip。
 *
 * ═══ v1.0.x 重定（产品拍板「默认窗口每行 4 列」）═══
 * 看板列几何由「基准 340 / 上限 360」改为**定宽 262**（默认窗口 1400 ⇒ section 1096 ⇒ 4 列），
 * 卡片随之 330 → **232**，卡内两行重排（头像组从底部元信息行移到委托方行）。
 * 于是本 spec 的两条旧数字必须换对象：
 *   · M-01 旧契约「1440 档卡片 ≥330、标题不截断」→ 新契约「4 列 / 232×185、标题**单行省略**、
 *     标题可用宽 ≥120、卡内无纵向溢出」。**「标题不截断」在新设计下不成立**（232 宽的卡片装不下
 *     长标题；标题与委托方是本卡仅有的两个允许单行省略的字段），护城河改由「单行 + 可用宽下限」
 *     承接 —— 下限 120 正是为了守住 #10.4 的「105px 窄卡全面报废」那条线。
 *   · M-02 旧契约「1152 档 ≥280」→ 新契约「3 列 / 232×**168**、委托方行不被压成 0 高」。
 * 卡内**逐元素**约束（到期日不截断 / 胶囊不折行 / 头像不越界 / 进度条贴合 / 无纵向溢出）
 * 见 `tests/member-board-narrow-card.spec.ts`（新增，1400 档）。
 *
 * ═══ v1.0.x 补丁（差口①：非 xl 档卡片高度 + 溢出口径）═══
 * 1) 非 xl 档（视口 ≤1279）看板列卡片从**共用首页的 124** 改为**本档专属的 168**
 *    （`ProjectCard` 的「非 xl 高度」注释里有算式与四档实测）⇒ M-02 的旧数字 124 必须换。
 *    124 的实测后果是内容越出卡片边框盒 **26px**（= 21% 卡高 ⇒ 压到下一张卡上）。
 * 2) ⚠️ **溢出口径换过**：原用的 `scrollHeight − clientHeight` 经真机反证**不可靠** ——
 *    卡高 156 时它报 0，而按几何算内容仍越出内容盒 10px（卡高 124 时它又恰好等于真实值 26）。
 *    现在两条用例都用几何口径：「**最靠下的子元素下边缘 − 卡片边框盒下边缘**」（> 0 = 真越界）。
 *    证据：`qa-scratch/mbcols/probe17.mjs` 的 9 档扫描。
 */

/** 探测已安装的 chromium（与 v07-board-acceptance.spec.ts 同一实现） */
function resolveChromium(): string | null {
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

/** 构建产物入口 */
const DIST_INDEX = resolve(__dirname, '..', 'build-dist', 'index.html');

const CHROMIUM_PATH = resolveChromium();
const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null;

/** 参与「产物是否过期」判定的构建输入（与 v07-board-acceptance 同口径） */
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

function staleInputs(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = fs.statSync(DIST_INDEX).mtimeMs;
  const candidates = [
    ...BUILD_INPUT_DIRS.flatMap((d) => collectFiles(resolve(__dirname, '..', d))),
    ...BUILD_INPUT_FILES.map((f) => resolve(__dirname, '..', f)).filter((f) => existsSync(f)),
  ];
  return candidates.filter((f) => fs.statSync(f).mtimeMs > distMs);
}

const CAN_RUN_FRESH = CAN_RUN && staleInputs().length === 0;

/** SPA 必须走 HTTP 服务（vite base:'/'，file:// 下资源全 404） */
async function startStaticServer(rootDir: string): Promise<{ url: string; close(): Promise<void> }> {
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
  // listen(0) 的随机端口可能撞 Chromium 不安全端口黑名单（ERR_UNSAFE_PORT 假红）⇒ 安全 listen
  return listenOnSafePort(server, '/');
}

/** 截图证据目录（qa-scratch 已在 .gitignore） */
const SHOT_DIR = resolve(__dirname, '..', 'qa-scratch', 'member-board-layout');

/**
 * 进入「成员 陈工 的成员看板」：首启建管理员 → 载入 indoor 示例 → 退出后以
 * 演示成员「陈工」进入 → SPA 导航到成员看板。
 * （陈工是 indoor 种子里的 stage owner，其名下必有相关项目；整库导入会替换
 * members，管理员身份随之失效，故导入后重新进入身份。）
 */
async function enterMemberBoard(page: Page, serverUrl: string): Promise<void> {
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
  await page.waitForFunction((name) => document.body.innerText.includes(name), '云栖', { timeout: 20000 });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '点击进入');
    b?.click();
  });
  await page.waitForSelector('input[placeholder="你的姓名"]', { timeout: 15000 });
  await page.locator('input[placeholder="你的姓名"]').fill('陈工');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '下一步');
    b?.click();
  });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const l = Array.from(document.querySelectorAll('a')).find((x) => (x.textContent ?? '').includes('成员看板'));
    l?.click();
  });
  await page.waitForSelector('[role="button"].group', { timeout: 20000 });
  await page.waitForTimeout(500);
}

describe.skipIf(!CAN_RUN_FRESH)(
  '反馈 #10.4 · 成员看板卡片尺寸/截断/头像行（真 Chromium）',
  () => {
    let browser: import('playwright-core').Browser;
    let server: { url: string; close(): Promise<void> };

    beforeAll(async () => {
      mkdirSync(SHOT_DIR, { recursive: true });
      server = await startStaticServer(resolve(__dirname, '..', 'build-dist'));
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
    }, 60000);

    afterAll(async () => {
      await browser?.close();
      await server?.close();
    });

    /** 成员看板首卡度量（宽/高/标题行/头像行/列数/纵向溢出） */
    async function firstCardMetrics(page: Page) {
      return page.evaluate(() => {
        const card = document.querySelector('[role="button"].group') as HTMLElement | null;
        if (!card) return null;
        const title = card.querySelector('span.truncate') as HTMLElement | null;
        // 头像组：新窄版把它放在**委托方行**（`layout==='column'` 的重排），
        // 该行的最后一个 div 子节点即 AvatarStack 根节点（其内层 div 才是叠放盒）。
        const av = card.querySelector('.flex.items-center.justify-between > div:last-child') as HTMLElement | null;
        const avInner = av?.firstElementChild as HTMLElement | null;
        const avatars = avInner ? Array.from(avInner.children) : [];
        // 委托方行 = 卡片第 2 个子节点（窄版是 div，行版是单个 span）
        const delegator = card.children[1] as HTMLElement | null;
        const board = Array.from(document.querySelectorAll('section.grid')).find((s) =>
          s.querySelector('[role="button"].group'),
        );
        const tracks = board
          ? getComputedStyle(board)
              .gridTemplateColumns.split(' ')
              .filter(Boolean)
              .map((t) => Math.round(parseFloat(t) * 10) / 10)
          : [];
        return {
          w: card.clientWidth,
          h: card.clientHeight,
          colCount: tracks.length,
          tracks,
          titleNeed: title ? title.scrollWidth : null,
          titleAvail: title ? title.clientWidth : null,
          titleH: title ? Math.round(title.getBoundingClientRect().height * 10) / 10 : null,
          titleLineH: title ? parseFloat(getComputedStyle(title).lineHeight) : null,
          delegatorNode: delegator ? delegator.tagName.toLowerCase() : null,
          delegatorH: delegator ? Math.round(delegator.getBoundingClientRect().height * 10) / 10 : null,
          avatarDir: avInner ? getComputedStyle(avInner).flexDirection : null,
          avatarsSameRow:
            avatars.length >= 2
              ? avatars[0].getBoundingClientRect().top === avatars[1].getBoundingClientRect().top
              : null,
          /*
           * 纵向溢出的**几何口径**（> 0 = 内容真的戳出卡外 ⇒ 压到下一张卡上）。
           * ⚠️ 刻意**不用** `scrollHeight − clientHeight`：真机反证它在 flex 容器上不可靠
           *    （卡高 156 时报 0，而几何算仍越出内容盒 10px；见 probe17 的 9 档扫描）。
           * contentOverflow 另外给出「内容是否越入下内边距」，供人工复核用。
           */
          boxOverflow:
            Math.round(
              (Math.max(...Array.from(card.children).map((k) => k.getBoundingClientRect().bottom)) -
                card.getBoundingClientRect().bottom) *
                10,
            ) / 10,
          contentOverflow:
            Math.round(
              (Math.max(...Array.from(card.children).map((k) => k.getBoundingClientRect().bottom)) -
                (card.getBoundingClientRect().bottom - parseFloat(getComputedStyle(card).paddingBottom))) *
                10,
            ) / 10,
        };
      });
    }


    it('M-01 · 1440 档：看板 4 列、卡片 232×185、标题单行省略不纵向裁切、头像横排', async () => {
      const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page: Page = await ctx.newPage();
      try {
        await enterMemberBoard(page, server.url);
        const m = await firstCardMetrics(page);
        expect(m).not.toBeNull();
        // 旧数字：卡片 330×185、看板 3 列（列基准 340 + 定值上限 360）。
        // 新数字：卡片 232×185、看板 **4 列**、轨道恒 262 —— 产品拍板「默认窗口 4 列」，
        // 262 是 section 1136 下出 4 轨的临界值（floor((1136+16)/(t+16)) ≥ 4 ⇒ t ≤ 278−16）。
        expect(m!.colCount, '1440 档看板应为 4 列（旧 3 列）').toBe(4);
        expect(m!.tracks.every((t) => t === 262), `1440 档轨道应恒 262，实测 ${JSON.stringify(m!.tracks)}`).toBe(true);
        expect(m!.h, '卡片高度应仍是 xl 设计档 185（修复前曾被抅到 340）').toBe(185);
        expect(m!.w, '卡片宽度应为 轨道 − 列盒内边距 30 = 232（旧设计 330）').toBe(232);
        // 「标题不截断」这条旧断言在新设计下**不再成立**（232 宽的卡片放不下长标题，
        // 标题与委托方是本卡**仅有的两个允许单行省略的字段**）。护城河改为：
        //   ① 标题必须是**单行**（不换行 ⇒ 行高 == line-height，不允许折成两行把卡撑变形）；
        //   ② 标题可用宽不得低于 120px（≥ 8 个汉字）——守住 #10.4「105px 窄卡全面报废」那条线。
        expect(m!.titleH, '标题必须单行（行高 == line-height）').toBeCloseTo(m!.titleLineH!, 1);
        expect(m!.titleAvail, '标题可用宽不得低于 120px（防回到 #10.4 的 105px 报废档）').toBeGreaterThanOrEqual(120);
        expect(m!.avatarDir).toBe('row');
        expect(m!.avatarsSameRow, '头像必须横排（修复前被挤成竖排/报废）').toBe(true);
        expect(m!.delegatorNode, '窄版（layout=column）的委托方行必须是 div（要挂头像组）').toBe('div');
        expect(m!.delegatorH, '委托方行不得被压成 0 高（旧 1152 档实测过这种塌陷）').toBeGreaterThanOrEqual(19);
        expect(m!.boxOverflow, 'xl 档卡内不得纵向溢出（几何口径：子元素不得越过卡片边框盒）').toBeLessThanOrEqual(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, '页面不应出现横向滚动').toBeLessThanOrEqual(0);
        await page.screenshot({ path: resolve(SHOT_DIR, 'M-01-member-board-1440.png') });
      } finally {
        await ctx.close();
      }
    }, 60000);

    it('M-02 · 1152 档（xl 以下）：卡片撑满列宽、头像横排、委托方行不被压成 0', async () => {
      const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1152, height: 864 } });
      const page: Page = await ctx.newPage();
      try {
        await enterMemberBoard(page, server.url);
        const m = await firstCardMetrics(page);
        expect(m).not.toBeNull();
        // 旧数字：≥280（当时是 360 轨道 ⇒ 卡片 330）。新数字：定宽 262 ⇒ 卡片恒 **232**。
        // ⚠️ 这一档（视口 ≤1279）走**非 xl 档**：旧版与首页共用 `h-[124px]`，实测后果是
        //    委托方行被 flex 压成 **0 高**（客户名完全不可见）、且内容越出卡片边框盒 **26px**
        //    （= 21% 卡高 ⇒ 压到下一张卡上）。v1.0.x 差口① 已修：本档改成**专属的 168**
        //    （= 逐行实测的自然高度 166 向上取 4 的整数档，算式见 `ProjectCard` 的
        //    「非 xl 高度」注释）⇒ 旧数字 124 换 168，并把「无溢出」正式钉住
        //    （修好之后就该钉；此前不钉是因为"钉一个已知破损的数字等于把破损写进契约"）。
        expect(m!.colCount, '1152 档（section 1088）看板应为 3 列').toBe(3);
        expect(m!.tracks.every((t) => t === 262), '1152 档轨道同样恒 262').toBe(true);
        expect(m!.h, '非 xl 档卡片应为本档专属高度 168（旧：与首页共用 124 ⇒ 溢出 26px）').toBe(168);
        expect(m!.w, 'xl 以下卡片同样应撑满列宽（修复前被 md:w-[50%-10px] 压到 105px）').toBe(232);
        expect(m!.delegatorH, '委托方行不得被压成 0 高（旧版实测塌陷）').toBeGreaterThanOrEqual(19);
        expect(m!.boxOverflow, '非 xl 档卡内不得纵向溢出（几何口径；旧 124 档实测 +26）').toBeLessThanOrEqual(0);
        expect(m!.avatarsSameRow, '头像必须横排').toBe(true);
        await page.screenshot({ path: resolve(SHOT_DIR, 'M-02-member-board-1152.png') });
      } finally {
        await ctx.close();
      }
    }, 60000);

  },
);
