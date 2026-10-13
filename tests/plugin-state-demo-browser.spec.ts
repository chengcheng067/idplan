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
 * ══════════════════ 本文件覆盖两件事 ══════════════════
 *   ①「载入示例项目不动宿主策略」（三层判据，见上）；
 *   ② 欢迎卡的「身份已完成」信号 —— `9dd3d77` 身份悬挂修复的**副作用**核实（见 ④a/④b）：
 *     实测结论是**假说证伪**（`identityDone` 是 latch、且在清 LS 之前就读了 ⇒ 无可观测差异），
 *     并把「空库 ⇒ 卡出现 / 非空库 ⇒ 卡不出现」钉成成对契约。
 *
 * ══════════════════ 产物过期守卫 ══════════════════
 * `src/` 比 `build-dist` 新 ⇒ 整组 skip（拿旧界面下结论 = 假绿），与
 * `tests/overlay-stack-browser.spec.ts` 同款判据。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 新鲜度判定 / Chromium 解析 / 静态服务器**全部接共享助手**（不自建第二套）
import {
  CAN_RUN_FRESH as SHARED_CAN_RUN_FRESH,
  CHROMIUM_PATH,
  startStaticServer,
} from './helpers/board-env';
import { buildDemoBackup } from '../src/core/demo/demoDataFactory';
import { pluginEnabledKey } from '../src/core/plugin/types';
import { DB_NAME } from '../src/core/schema/current';

const ROOT = resolve(__dirname, '..');
/**
 * 产物目录可被 `DEMO_GATE_DIST` 覆盖 —— **只为做「真机变异自证」**，不是测试后门：
 * 改 `src/**` 会让共享产物过期 ⇒ 本组整组 skip；而重建共享 `build-dist` 又会把
 * **别人的**浏览器 spec 拖到「被我改坏的产物」上。故变异一律走独立产物：
 *
 *     rm -rf qa-scratch/mut-dist                        # ★ 先删！否则可能复用上次遗留的产物
 *     npx vite build --outDir qa-scratch/mut-dist      # 单独构建（gitignore 内，不污染）
 *     DEMO_GATE_DIST=<abs>/qa-scratch/mut-dist npx vitest run tests/plugin-state-demo-browser.spec.ts
 *   「先删」不只是习惯，**本文件会主动判定**：见下面 `VARIANT_STALE` —— 若 `DEMO_GATE_DIST`
 *   指向的产物**早于本次进程启动**，直接**抛错**（而不是跳过），因为那意味着你正在用上次
 *   遗留的产物做变异，读数会答非所问。
 *
 * ★ **纪律：变异必须用独立 outDir，绝不重建共享 `build-dist`。**
 *   改完必须还原 `src`（`git diff --exit-code` 为空）**并复位其 mtime** —— 碰过 `src/**`
 *   的文件即使内容没变，mtime 被顶新也会让产物对**所有人**判过期（那段时间别人的
 *   浏览器 spec 会莫名其妙 skip）。收尾要报「过期输入计数 = 0」。
 * 平时不设该变量 ⇒ 与原行为逐字一致。
 *
 * ── ★★ 事故原文（2026-10-14，作者本人犯的；写下来是因为它比抽象规矩更拦得住人）──
 *   我当时要在一条命令里「只数一下 tsc 的报错条数」，**却多写了一个 `npm run build`**，
 *   它真的跑了 —— `build-dist` 被我一个人重建，而我在上一条信里刚承诺「不重建共享产物」。
 *   为什么后果可能很重：**若当时正好有人的 `src/**` 停在半成品**，我这一下会让**全队的
 *   浏览器 spec 集体变红**，而那些人手里没有任何信息能判断「红是因为我」。
 *   （那次侥幸没事：构建成功、我没改 `src`、同一分钟内别人也刷过两次 ⇒ 边际影响小。
 *     但「侥幸没事」不是「做法对」。）
 *   ⇒ 规矩：**重建共享 `build-dist` 是一次影响全队的动作** —— 要么事先报备，要么走独立
 *     outDir；**不需要新鲜产物时，不要顺手跑 `npm run build`**。
 *
 * ── ★★ 另一条同类现场：静默 skip 被当成通过（作者本人踩过两次）──
 *   产物过期时本组输出 `↓ … skipped` 而**没有任何说明**，我两次读到「Tests 1 passed /
 *   没有红」就差点当成通过。⇒ 新鲜度判据**必须接入共享助手**
 *   （`tests/helpers/board-env.ts` 的 `CAN_RUN_FRESH`，它自带 `warnStaleOnce` 的
 *   「每次进程只喊一次」告警），**不要自建第二套**。
 *   变异路径是唯一例外：共享判据锚在 `<repo>/build-dist/index.html`，而变异跑的是独立
 *   产物 ⇒ 只能用该产物自己的新鲜度，见下面 `variantFresh()`。
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

/** 一条最小项目行（只为把库做「非空」；欢迎卡的非空判据只看行数） */
const ONE_PROJECT: Record<string, unknown> = {
  id: 'p_one',
  name: '占位项目',
  address: '',
  clientName: '',
  contractAmount: null,
  signedAt: null,
  plannedStartAt: '2026-08-01',
  plannedEndAt: '2026-10-01',
  coverColor: null,
  stagePresetKey: null,
  stageTemplateVersion: 0,
  scheduleBasis: 'calendar',
  domain: null,
  kind: 'human',
  ownerMemberId: null,
  status: 'active',
  revision: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** 一个「不属于本机」的管理员成员（覆盖式导入后 members 会被换成这一类） */
const STRANGER_ADMIN: Record<string, unknown> = {
  id: 'stranger_admin_browser',
  name: '陌生人管理员',
  role: '负责人',
  contact: null,
  avatarColor: '#3D6B5B',
  active: true,
  roleKind: 'admin',
  passwordHash: null,
  actorKind: 'human',
  agentKind: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const seeded: SettingRow[] = [
  { key: AGENT_BOARD, valueJson: 'false', updatedAt: '2026-01-01T00:00:00.000Z' },
  { key: WEEKLY_REPORT, valueJson: 'true', updatedAt: '2026-01-01T00:00:00.000Z' },
  { key: SAMPLE_PROJECTS, valueJson: 'true', updatedAt: '2026-01-01T00:00:00.000Z' },
  { key: 'restPolicy', valueJson: SEEDED_REST_POLICY, updatedAt: '2026-01-01T00:00:00.000Z' },
];

/*
 * 新鲜度、Chromium 路径、静态服务器**全部接共享助手** `tests/helpers/board-env.ts`：
 *   · `CAN_RUN_FRESH` —— 它自带「产物过期就出声」的告警（`warnStaleOnce`，每进程只喊一次），
 *     所以本文件**不再自己 `console.warn`**（自建第二套必然与它分叉）；
 *   · `CHROMIUM_PATH` / `startStaticServer` —— 同源，免掉本文件两份重复实现。
 * ⚠️ 仓里现状（已单独报给 team-lead）：`staleInputs` 被 **19 个文件**各自定义或导出
 *    （1 份共享 + 18 份内联复制）。**本文件不再增加第 19 份**。
 */
const IS_VARIANT = Boolean(process.env.DEMO_GATE_DIST);

/**
 * 变异路径专用：产物必须**比当前 `src/**` 新**（否则是遗留产物）⇒ 返回比它新的文件样例。
 *
 * ── 为什么不是「断言产物晚于进程起点」──
 * 我第一版就是那么写的，**当场被判错**：构建**必然早于**测试进程启动（先 build 再 run），
 * 于是正常流程也被判成违规（实测产物 17:59:36 < 进程 17:59:39 —— 差的就是 npx+vitest 的启动开销）。
 * 「本次运行构建的」在本进程内**不可知**，可核的等价形式是**与源码比**：
 *   · 遗留产物（上一次的、或 src 已还原之后留下的）**必然比当前 src 旧** ⇒ 被抓；
 *   · 若 src 自构建以来没动过，那份遗留产物与原产物**等价** ⇒ 放行是对的。
 *
 * ── 为什么这是本文件唯一保留的本地新鲜度实现 ──
 * 共享助手（`helpers/board-env.ts`）的判据**锚死在 `<repo>/build-dist/index.html`**，
 * 而这里锚的是 `DEMO_GATE_DIST` 的**独立产物**。要共用就得给共享件加一个「对任意产物判新鲜度」
 * 的入口 —— 那 是改共享件，**已报 team-lead 待定**；在那之前这里是**有解释的窄例外**。
 * 用 `readdirSync({recursive:true})` 一行拿到文件树，刻意**不复制**共享助手那套递归 walk。
 *
 * ★ **退役条件**（team-lead 要求写明）：**将来共享件若加了「对任意产物判新鲜度」的通用入口
 *   （例如 `staleInputsAgainst(indexPath)`），就切过去、删掉下面这份** —— 它存在的唯一理由是
 *   共享件目前只能锚主产物；锚点一旦可参数化，这份就该退役。
 */
function variantStale(): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  const jn = (require('node:path') as typeof import('node:path')).join;
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = statSync(DIST_INDEX).mtimeMs;
  const roots = ['src', 'electron'].map((d) => resolve(ROOT, d));
  const out: string[] = [];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    for (const e of fs.readdirSync(r, { recursive: true, withFileTypes: true })) {
      if (!e.isFile()) continue;
      const full = jn((e as unknown as { parentPath: string }).parentPath, e.name);
      if (fs.statSync(full).mtimeMs > distMs) out.push(full.slice(ROOT.length + 1));
    }
  }
  return out.slice(0, 3);
}

if (IS_VARIANT) {
  const staleVariant = variantStale();
  if (staleVariant.length > 0) {
    // **抛错而不是 skip**：变异是人工动作，静默跳过只会白跑一轮（且很可能是"用了遗留产物"）
    throw new Error(
      'DEMO_GATE_DIST 指向的产物比当前 src 旧 —— 很可能是上一次遗留的独立产物（先删 outDir 再构建）。' +
        `比产物新的文件样例：${staleVariant.join(', ')}`,
    );
  }
}

/*
 * 变异路径（`DEMO_GATE_DIST`，见文件头纪律区）：产物是**刚刚由 `vite build --outDir`
 * 构出来的**，新鲜度**由构造保证**（build → 立刻 run）⇒ 只判"产物在不在"，**不做 mtime
 * 比对**。这样既够用，也**不会与共享助手形成第二套过期判定**。
 * 正常路径则**完全**走共享助手那份。
 */
const CAN_RUN_FRESH = IS_VARIANT
  ? existsSync(DIST_INDEX) && CHROMIUM_PATH !== null
  : SHARED_CAN_RUN_FRESH;

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

  /** 页面内是否存在文案精确相等的**可见**按钮（只判存在，不点击） */
  async function hasButton(page: Page, text: string): Promise<boolean> {
    return page.evaluate((t) => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => (x.textContent ?? '').trim() === t,
      );
      if (!b) return false;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }, text);
  }

  /** 直写任意 IndexedDB 表（DB 名取 `DB_NAME` 单一出处；keyPath 由产品 schema 决定） */
  async function seedStore(
    page: Page,
    store: 'settings' | 'members' | 'projects',
    rows: Array<Record<string, unknown>>,
  ): Promise<void> {
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
      { dbName: DB_NAME, store, rows },
    );
  }

  const seedSettings = (page: Page, rows: SettingRow[]): Promise<void> =>
    seedStore(page, 'settings', rows as unknown as Array<Record<string, unknown>>);

  /** 读回 settings 全景（key → valueJson），外加 demo 数据是否落库的行数证据 */
  async function readState(page: Page): Promise<{
    settings: Record<string, string>;
    projects: number;
    localStorageId: string | null;
    enterIdentity: number;
    identityRowText: string | null;
    members: number;
    cardPanel: boolean;
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
        const members = (await readAll('members')).length;
        db.close();
        /*
         * 身份证据**成对**取（缺一条都会被「页面坏了」满足，见下方断言的注释）：
         *   · 否定式 `enterIdentity`：未进入身份时身份控件渲染「点击进入」⇒ 计数应为 0；
         *   · 肯定式 `identityRowText`：**进入后才会渲染**的那枚身份行（`title` 固定为
         *     `当前身份（点击切换/退出）`）的文本 —— 它同时告诉我们是**以谁的身份**进去的。
         */
        const enterIdentity = Array.from(document.querySelectorAll('button')).filter(
          (b) => (b.textContent ?? '').trim() === '点击进入',
        ).length;
        const identityBtn = Array.from(document.querySelectorAll('button')).find(
          (b) => (b.getAttribute('title') ?? '') === '当前身份（点击切换/退出）',
        );
        /*
         * 欢迎卡是否在渲染：判据取它自己打的面板标记（`data-first-run-panel`），
         * 而不是"某段文案在不在" —— 文案会被 i18n 改，标记是留给测试的钩子。
         */
        const cardPanel = document.querySelector('[data-first-run-panel]') !== null;
        return {
          settings: Object.fromEntries(settings.map((r) => [r.key, r.valueJson])),
          projects,
          localStorageId: localStorage.getItem(lsKey),
          enterIdentity,
          identityRowText: identityBtn ? (identityBtn.textContent ?? '').trim() : null,
          members,
          cardPanel,
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

      /*
       * ③' 形态等价断言 —— 把「与用户手动开过插件得到的库内状态**逐字节等价**」从描述
       *    变成断言。可核的部分是**序列化形态**（产品写的是 `JSON.stringify(值)` 存进
       *    `valueJson`，不是裸值；键名前缀来自单一出处）：
       *      · 三个插件键都必须由 `pluginEnabledKey(...)` 产出（不手打前缀）；
       *      · `valueJson` 必须是**字符串**且能 `JSON.parse` 回布尔 —— 产品读侧
       *        `readEnabledFromSettings` 正是这么认的，写成裸值它就会**静默跳过**该行；
       *      · 行形状必须恰好是 `{key, valueJson, updatedAt}`，`updatedAt` 为 ISO 串
       *        （与 `Setting` / Dexie store 键路径一致）。
       */
      const pluginSeed = seeded.filter((r) => r.key.startsWith(pluginEnabledKey('')));
      // 注意：message 只能挂在 `expect(...)` 上 —— `toEqual(expected, message)` 不是合法签名
      // （本仓 tsc 会报 TS2554，我第一版就踩了）。
      expect(
        pluginSeed.map((r) => r.key).sort(),
        '插件键必须由 pluginEnabledKey(...) 产出（前缀单一出处），不得手打',
      ).toEqual([AGENT_BOARD, SAMPLE_PROJECTS, WEEKLY_REPORT].sort());
      for (const r of seeded) {
        expect(typeof r.valueJson, `${r.key} 的 valueJson 必须是字符串（产品写的是 JSON 串）`).toBe('string');
        expect(Object.keys(r).sort(), `${r.key} 的行形状必须恰好是 key/valueJson/updatedAt`).toEqual([
          'key',
          'updatedAt',
          'valueJson',
        ]);
        expect(Number.isNaN(Date.parse(r.updatedAt)), `${r.key} 的 updatedAt 必须是可解析的 ISO 串`).toBe(false);
      }
      for (const r of pluginSeed) {
        expect(typeof JSON.parse(r.valueJson), `${r.key} 必须是 JSON 布尔（裸值会被读侧静默跳过）`).toBe('boolean');
      }
      expect(typeof JSON.parse(seeded.find((r) => r.key === 'restPolicy')!.valueJson)).toBe('object');

      await seedSettings(page, seeded);
      await page.reload();
      await page.waitForSelector('header', { timeout: 20000 });
      await page.waitForTimeout(800);
      const before = await readState(page);
      expect(before.settings[AGENT_BOARD], '播种未落库（前提失败）').toBe('false');
      expect(before.settings[WEEKLY_REPORT], '播种未落库（前提失败）').toBe('true');
      expect(before.settings[SAMPLE_PROJECTS], '播种未落库（前提失败）').toBe('true');
      console.log('[demo-gate] 播种后 =', JSON.stringify(before.settings));

      /*
       * ③' 读侧接受（形态等价的**行为**判据）：侧栏那个入口由 `plugin.enabled.sample-projects`
       *    门控，而它使用的是产品自己的读侧（`readEnabledFromSettings`）。⇒ 入口出现了，
       *    就证明我直写的行与「产品写入的行」在读侧看来**形态一致**（不是我以为一致）。
       */
      expect(
        await hasButton(page, '载入示例项目'),
        '播种行未被产品读侧接受（形态与产品写入的不等价）：该入口由 plugin.enabled.sample-projects 门控',
      ).toBe(true);

      // ── 真 UI：点侧栏「载入示例项目」→ 确认弹窗 → 确认载入（定位不许放宽） ──
      const openedEntry = await clickText(page, '载入示例项目');
      expect(openedEntry, '侧栏应有「载入示例项目」入口（管理员 + 示例项目插件已启用）').toBe(true);
      /*
       * 等那个确认弹窗出现。
       *
       * ⚠️ 为什么不能按 `aria-label="载入示例项目"` 定位：那是**把中文当定位契约**
       *   ⇒ 被 `tests/cjk-locator-guard.spec.ts` 的棘轮咬（本仓已立为纪律：定位不许依赖语言）。
       * ⚠️ 也不能偷懒放宽成裸 `[role="dialog"]`：多弹窗时 `waitForSelector` 只认**首个**
       *   ⇒ 等错对象也照样绿，那是假绿。
       * ⇒ 取**与语言解耦**的结构判据 `[role="dialog"][aria-modal="true"]`（Modal 底座提供，
       *   见 `src/components/common/Modal.tsx` 的 `role` / `aria-modal`），
       *   并**显式断言此刻恰好一个** —— 于是"多弹窗"变成**响亮失败**而不是等错对象。
       *   （更彻底的解法是给 ConfirmDialog 加 `data-*` 钩子，但那要改共享组件 ⇒ 不为此牵动别人。）
       */
      await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
      expect(
        await page.locator('[role="dialog"][aria-modal="true"]').count(),
        '此刻应恰好只有那一个确认弹窗（多于一个 ⇒ 我在等错对象）',
      ).toBe(1);
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
        '；身份行文本 =',
        JSON.stringify(after.identityRowText),
      );

      /*
       * 身份证据**成对**（缺一条就是半截判据）：
       *   · 只看**否定式**「『点击进入』计数 = 0」是不够的 —— **页面整个坏掉、身份组件
       *     没渲染、视图不对**，它**也会是 0**（恒过）。
       *     这条批评来自 `impl-settings-hierarchy`（他们自己踩过同形坑）。
       *   · 故必须配一条**肯定式**：断言"屏幕上以**谁**的身份在" —— 那枚身份行
       *     （`title` 固定）**只在进入身份后才渲染**，它的文本里必须出现示例包的
       *     管理员「负责人甲」（`demoDataFactory` 的 `DEMO_MEMBERS[0].name`）。
       *   两条同时成立才算「身份已进入」被证明。
       */
      expect(
        after.identityRowText,
        '身份行为空 ⇒ 未进入身份（或视图没渲染出来）：肯定式判据失败',
      ).not.toBeNull();
      expect(
        after.identityRowText,
        '进入的不是示例包的管理员「负责人甲」',
      ).toContain('负责人甲');
      expect(
        after.enterIdentity,
        '未进入身份时该按钮应为 0（与上面肯定式成对；单独看它是恒过的）',
      ).toBe(0);

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
  /**
   * ④ 欢迎卡的「身份已完成」信号 —— `9dd3d77`（身份悬挂修复）的**副作用**，team-lead 指派的核实。
   *
   * ── 机制（读码，已核；本用例读的是**数值**不是推断）──
   *   `FirstRunGuide` 的可见条件是 `projects.length === 0 && !dismissed && identityDone`，
   *   而 `identityDone` 的**唯一信号**是 **localStorage 身份键非空**（外加 400ms 轮询）。
   *   身份修复会**清掉**那个键（`setCurrentMember(null)`，且**不把 KV 兜底值写回**）
   *   ⇒ 这条信号从「因悬挂 id 恒为真」变成「**可以是假**」。
   *
   * ── 造的状态 ──
   *   「覆盖式导入之后」：members 被换成**陌生人集**（含管理员）、**库为空（0 项目）**、
   *   本机 localStorage 里那份身份属于**上一个成员集** ⇒ 悬挂。
   *   （该状态就是身份修复作用的那一点；欢迎卡的可见性只取决于上面那条谓词，
   *     与"members 是怎么被换掉的"无关 —— 故直写 IDB 造状态是等价的。）
   *
   * ── team-lead 的假说是「卡从『不出现』变成『出现』」；下面 ④a/④b 把方向**读出来**。──
   */
  it('④a 悬挂身份 + 空库：欢迎卡与身份入口的读数', async () => {
    const { ctx, page } = await open();
    try {
      await seedStore(page, 'members', [STRANGER_ADMIN]);
      await page.evaluate((k) => localStorage.setItem(k, 'm_prev_gone'), 'changxia.currentMemberId');
      await page.reload();
      await page.waitForSelector('header', { timeout: 20000 });
      await page.waitForTimeout(1200); // 让 400ms 轮询至少跑两轮
      const st = await readState(page);
      console.log('[card-gate] ④a 悬挂场景 =', JSON.stringify(st));

      // 前提（三条，缺一条这条用例就测不到点上）
      expect(st.projects, '前提：库必须为空').toBe(0);
      expect(st.members, '前提：members 必须已换成陌生人集').toBe(1);
      expect(st.localStorageId, '前提：本机那份悬挂身份应已被身份修复清掉').toBeNull();

      /*
       * ★ 实测结论（**与指派时的假说方向相反的那一半**）：卡**出现了**。
       *   机制不是「信号变成假」，而是 `identityDone` 是个 **latch**：
       *   它在**挂载时读一次** localStorage（`useState(initializer)`），之后那个 400ms
       *   轮询**只可能把它从 false 变 true、永远不会变回 false**。
       *   本场景在挂载那一刻 localStorage 里**还有**那份（即将被清掉的）旧 id
       *   ⇒ latch 当场为 true ⇒ 卡出现；随后身份修复把 LS 清掉也**不会**把 latch 关回去。
       *
       * ── ⚠️ 已知脆弱机制（team-lead 已登记进「已知限制」清单，与 B / E 并列）──
       *   **`identityDone` 的实际语义是「首帧那一刻 localStorage 里有没有东西」，
       *     它不表示「身份已建立」。** 两个方向都会失真：
       *     · **正向**（身份**未**建立、信号为真）⇒ 卡照出现 —— **本用例 ④a 就是现场证据**
       *       （`enterIdentity=1` 而 `cardPanel=true`）；
       *     · **反向**（身份**已**建立、信号为假）⇒ 卡被压掉 —— 例如「载入示例数据」之后
       *       （`localStorageId=null` + KV `demo_admin` ⇒ 身份其实已进入，而 latch 为 false）。
       *   为什么**今天看不出来**：两种情况都**被「库是否为空」这条独立条件遮住**
       *     （空库时正向恰好等于期望；反向发生的时刻库必然非空、卡本来也不该出现）。
       *   ⇒ **以后谁要改这张卡的信号，先读这条注释**：别以为「信号为真 = 身份已建立」。
       *     （team-lead 裁定**当前不改产品代码**：无可观测错误、且这是 onboarding 门、
       *       影响面大而收益是修一个当前测不出差异的语义。）
       *
       * 成对判据（缺一条就是半截判据）：
       *   肯定式 —— 卡**在**；
       *   对照   —— 身份入口**在**（`点击进入`）⇒ 页面是活的、身份确实未被建立
       *            （若页面坏了，"卡在"这条也会是假绿）。
       */
      expect(st.enterIdentity, '对照：身份未建立 ⇒ 身份入口应在（页面是活的）').toBeGreaterThan(0);
      expect(st.identityRowText, '对照：未进入身份 ⇒ 身份行不该在').toBeNull();
      expect(st.cardPanel, '空库 + 未看过 ⇒ 欢迎卡出现（实测行为）').toBe(true);
    } finally {
      await ctx.close();
    }
  }, HEAVY);

  it('④b 对照：同样身份形态但**库非空** ⇒ 欢迎卡不出现', async () => {
    const { ctx, page } = await open();
    try {
      // 与 ④a 完全相同的身份形态（悬挂 LS + 陌生人集），**只加一条项目行**改变唯一变量
      await seedStore(page, 'members', [STRANGER_ADMIN]);
      await seedStore(page, 'projects', [ONE_PROJECT]);
      await page.evaluate((k) => localStorage.setItem(k, 'm_prev_gone'), 'changxia.currentMemberId');
      await page.reload();
      await page.waitForSelector('header', { timeout: 20000 });
      await page.waitForTimeout(1200);
      const st = await readState(page);
      console.log('[card-gate] ④b 非空库对照 =', JSON.stringify(st));

      expect(st.projects, '前提：库必须非空（与 ④a 的唯一变量）').toBe(1);
      // 成对：④a 断「空库 ⇒ 卡在」，这里断「非空库 ⇒ 卡不在」。
      // 两条一起才排除「卡恒定出现」与「页面坏了」两种假绿。
      expect(st.cardPanel, '非空库 ⇒ 欢迎卡不出现').toBe(false);
      // 对照仍要有：身份入口在 ⇒ 页面是活的（否则"卡不在"可能只是页面没渲染）
      expect(st.enterIdentity, '对照：身份未建立 ⇒ 身份入口应在（页面是活的）').toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  }, HEAVY);
});
