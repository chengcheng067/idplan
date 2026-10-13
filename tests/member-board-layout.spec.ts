import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { listenOnSafePort } from './helpers/safe-listen';
import { staleInputs, enterMemberBoard as enterMemberBoardShared } from './helpers/board-env';


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
 * 看板列几何由「基准 340 / 上限 360」一路改到 **gen5**（`minmax(min(100%,245px), 1fr)`）
 * —— 卡片随之 330 → 232（gen4）→ **230（gen5，真机同宽）**，卡内两行重排
 * （头像组从底部元信息行移到委托方行）。
 * 于是本 spec 的两条旧数字必须换对象：
 *   · M-01 旧契约「1440 档卡片 ≥330、标题不截断」→ 新契约「**真机同宽（视口 1392 ⇒ section 1088）**
 *     下 4 列 × 260、卡片 230×185、标题**单行省略**、标题可用宽 ≥120、卡内无纵向溢出」。
 *     **「标题不截断」在新设计下不成立**（230/232 宽的卡片装不下长标题；标题与委托方是本卡仅有的
 *     两个允许单行省略的字段），护城河改由「单行 + 可用宽下限」承接 —— 下限 120 正是为了守住
 *     #10.4 的「105px 窄卡全面报废」那条线。
 *   · M-02 旧契约「1152 档 ≥280」→ 新契约「**4 列** / 卡片 230 × **168**、委托方行不被压成 0 高」。
 *     ⚠️ 1152 这一档的 section 宽**也是 1088**（<xl 时侧栏变 32px 细档 ⇒ 视口 − 64），
 *     故它与真机默认窗口同宽、同样 4 列；gen4 时它是 3 列（定宽 262 的门槛 1096 差 8px）。
 * ⚠️ **探针视口**：真机默认窗口的内容宽是 **1088**（1400 − Chrome 纵向滚动条 8 − 侧栏 240 −
 *   内边距 64），而 headless 用 overlay 滚动条（占 0px）只能给 1096 ⇒ 本 spec 用 **1392**
 *   （= 1400 − 8）复现真机宽度。旧的「1440 档 / section 1136」是**用户没有的宽度**。
 * 卡内**逐元素**约束（到期日不截断 / 胶囊不折行 / 头像不越界 / 进度条贴合 / 无纵向溢出）
 * 见 `tests/member-board-narrow-card.spec.ts`（新增，1400 档）。
 *
 * ═══ v1.0.x 补丁（差口①：非 xl 档卡片高度 + 溢出口径）═══
 * 1) 非 xl 档（视口 ≤1279）看板列卡片从**共用首页的 124** 改为**本档专属的 168**
 *    （`ProjectCard` 的「非 xl 高度」注释里有算式与四档实测）⇒ M-02 的旧数字 124 必须换。
 *    124 的实测后果是内容越出卡片边框盒 **26px**（= 21% 卡高 ⇒ 压到下一张卡上）。
 * 2) **溢出口径换成几何量**（team-lead 独立探针在真应用 116→168 每 4px 一档复测后定的口径）：
 *    ⚠️ 先更正一条**我写错的因果**：我原写「老口径 `scrollHeight − clientHeight` 在 flex 容器上
 *    不可靠 ⇒ 所以换几何口径」。**这条不成立，已作废** —— 真卡片上子元素 min-content 不可压缩
 *    （每档都是 [28,24,30,22]，内容只会整体下移、不会局部收缩），故两者**逐档同值**：
 *        `scrollHeight − clientHeight` ≡ `max(0, 边框盒溢出)`
 *    （`scrollHeight` 按定义不小于 `clientHeight`，负值被钳成 0）。实测：168 ⇒ 0/0、
 *    156 ⇒ 0（几何边框盒是 −6，被钳位）、148 ⇒ 2/2、124 ⇒ 26/26 —— 老口径在损害最重的 124 档
 *    本来就报 26，**它不是假绿通道**，我误把"钳位后的 0"当成了"漏报"。
 *    换几何口径的**真正理由**：一次测量能**同时**给出**边框盒**与**内容盒**两个判据，
 *    老口径只能给前者。
 *    ⚠️ 真卡片上真正会坏、且**只有内容盒口径看得见**的形态是「**内容吃掉下内边距**」：
 *    124 档 +42、156 档 +10、168 档 **−2**。所以本 spec 钉的是**边框盒 ≤ 0**（防"戳出卡外
 *    压到下一张卡"这种最恶性形态，属**下限保险**），而"内容盒"那条主判据钉在
 *    `member-board-narrow-card.spec.ts` 的 N-04（非 xl 档）。
 *    证据：`qa-scratch/mbcols/probe17.mjs`（9 档扫描，结论已同步更正）。
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
/*
 * 产物过期判定：**唯一出处** = `tests/helpers/board-env.ts` 的 `staleInputs()`
 * （它内部带 `warnStaleOnce`：过期时会打印「哪些构建输入比产物新 + 先 npm run build」）。
 *
 * ⚠️ 本文件原先内联了一份**语义相同、但没有告警**的复制体 ⇒ 产物过期时它**静默 skip**
 *    （skip ≠ 通过）。2026-10-13 那次「让跳过出声」只覆盖了 import 共享助手的文件，
 *    内联复制的那批漏了；本次收敛补上。
 *    判据本身**没有变**：候选集 = `BUILD_INPUT_DIRS`（src/electron）+ `BUILD_INPUT_FILES`
 *    （index.html / vite.config.ts / tailwind.config.ts / postcss.config.js），任一 mtime 比
 *    `build-dist/index.html` 新即视为过期（两份口径已逐字核对）。
 */
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
 * 进入「成员 执行乙 的成员看板」：首启建管理员 → 载入 indoor 示例 →
 * **切成成员「执行乙」** → SPA 导航到成员看板。
 *
 * ⚠️ 订正（2026-10-14）：本函数尾部原先自己点「点击进入」再填姓名，前提是
 * 「整库导入后**身份为空**」——那条前提**已经死了、且是有意移除的**：
 * demo 包自带 `settings.currentMemberId='demo_admin'`（=「负责人甲」），
 * 而 `useRepos.bootstrapAllStores` 的身份候选阶梯（`9dd3d77`）让这条兜底真的生效
 * ⇒ **导入后身份已被自动建立为管理员**，「点击进入」根本不存在。
 * ⇒ 那一段改为**复用共享 helper**（`helpers/board-env.ts` 的 `enterMemberBoard`）：
 *    它有 ① 身份自检（失败直说「旧语义过期」而不是 15s 超时）② 实测验证过的
 *    「切换身份 → 执行乙」三步 ③ 切完断言 `/member-board` 入口出现（否则响亮失败）。
 *    本函数只保留它自己的前半段（goto + 建管理员 + 载入示例）——那部分是它独有的。
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
  await page.waitForFunction((name) => document.body.innerText.includes(name), '演示项目1', { timeout: 20000 });
  await page.waitForTimeout(1500);

  // 身份已由示例包自动建立 ⇒ 交给共享 helper：切成「执行乙」并打开成员看板
  await enterMemberBoardShared(page);
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
           * 两个纵向溢出都量成**几何量**：
           *   · boxOverflow = 子元素下边缘 − **边框盒**下边缘 ⇒ > 0 才是"戳出卡外、压到下一张卡"
           *     （本 spec 两条用例钉的就是它，属**下限保险**）；
           *   · contentOverflow = 子元素下边缘 − **内容盒**下边缘 ⇒ > 0 表示"内容吃掉了下内边距"，
           *     这是真卡片上唯一会坏、且只有本口径看得见的形态（124 档 +42、156 档 +10、
           *     168 档 −2）；留给人工复核与 N-04 的主判据用。
           * ⚠️ 老口径 `scrollHeight − clientHeight` 与 boxOverflow **逐档同值**（不是坏口径），
           *    换过来只为一次测量拿到两个判据 —— 原先那句"它在 flex 容器上不可靠"的因果已作废，
           *    见文件头段 2) 与 qa-scratch/mbcols/probe17.mjs。
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


    it('M-01 · 真机同宽（探针 1392 ⇒ section 1088）：看板 4 列 × 260、卡片 230×185、标题单行省略', async () => {
      const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1392, height: 900 } });
      const page: Page = await ctx.newPage();
      try {
        await enterMemberBoard(page, server.url);
        const m = await firstCardMetrics(page);
        expect(m).not.toBeNull();
        // 数值演进（**旧 → 新**）：
        //   · 卡片宽 330（gen1/2）→ 232（gen4，headless 1096 ⇒ 轨道 262）→ **230**（gen5，section 1088 ⇒ 轨道 260）
        //   · 看板列 3 列（gen4 之前的真机档，因为门槛 1096 > 真机 1088）→ **4 列**（gen5，门槛 1028）
        //   · 探针视口 1440（section 1136，**用户没有的宽度**）→ **1392**（section 1088 = 真机同宽）
        expect(m!.colCount, '真机同宽下看板应为 4 列（gen4 在这一档只有 3 列）').toBe(4);
        expect(m!.tracks.every((t) => t === 260), `真机同宽轨道应为 260（(1088−48)/4），实测 ${JSON.stringify(m!.tracks)}`).toBe(true);
        expect(m!.h, '卡片高度应仍是 xl 设计档 185（修复前曾被抅到 340）').toBe(185);
        expect(m!.w, '卡片宽度应为 轨道 − 列盒内边距 30 = 230（旧设计 330 / gen4 232）').toBe(230);
        // 「标题不截断」这条旧断言在新设计下**不再成立**（230 宽的卡片放不下长标题，
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
        await page.screenshot({ path: resolve(SHOT_DIR, 'M-01-member-board-1392.png') });
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
        // 数值演进（**旧 → 新**）：卡片宽 ≥280（gen2 的 360 轨道 ⇒ 330）→ 232（gen4 定宽 262）
        // → **230**（gen5：section 1088 ⇒ 轨 260）；列数 **3 → 4**（gen5 门槛降到 1028）。
        // ⚠️ 这一档（视口 ≤1279）走**非 xl 档**：旧版与首页共用 `h-[124px]`，实测后果是
        //    委托方行被 flex 压成 **0 高**（客户名完全不可见）、且内容越出卡片边框盒 **26px**
        //    （= 21% 卡高 ⇒ 压到下一张卡上）。v1.0.x 差口① 已修：本档改成**专属的 168**
        //    （= 逐行实测的自然高度 166 向上取 4 的整数档，算式见 `ProjectCard` 的
        //    「非 xl 高度」注释）⇒ 旧数字 124 换 168，并把「无溢出」正式钉住
        //    （修好之后就该钉；此前不钉是因为"钉一个已知破损的数字等于把破损写进契约"）。
        // 1152 档的 section 宽与真机默认窗口同为 1088（<xl 侧栏收成 32px 细档 ⇒ 视口 − 64）
        expect(m!.colCount, '1152 档（section 1088）看板应为 4 列（gen4 时是 3 列）').toBe(4);
        expect(m!.tracks.every((t) => t === 260), `1152 档轨道应为 260，实测 ${JSON.stringify(m!.tracks)}`).toBe(true);
        expect(m!.h, '非 xl 档卡片应为本档专属高度 168（旧：与首页共用 124 ⇒ 溢出 26px）').toBe(168);
        expect(m!.w, 'xl 以下卡片同样应撑满列宽（修复前被 md:w-[50%-10px] 压到 105px）').toBe(230);
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
