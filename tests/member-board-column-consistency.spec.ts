/**
 * 成员看板 · 「自己的看板」与「看某成员的看板」必须**同一套列、同一套几何**（真 Chromium）。
 *
 * ── 用户原话（0.9.x 反馈，同一处第 N 次）──
 *   「我不明白成员的看板。比如说现在我进入了朴彩英的看板，为什么下面的排版会变成 3 列
 *     排版啊？管理员都是 4 列。成员看板这个地方是一直不修，留着干什么？你也不检查」
 *
 * ── 为什么这条断言必须是「两用例逐项相等」而不是「看起来是几列」──
 *   钉的是**一致性性质**：同一块板（同一份数据、同一视口）不论看谁，列集合与解析后的
 *   轨道列表都必须逐项相同。将来谁再加一层过滤（相关项目/搜索/角色）、再加一个行业包，
 *   只要让两用例分叉，本 spec 立刻红——而不是等用户再骂一次。
 *
 * ── 病灶与修法（详见 HomePage.groupByColumn 的注释）──
 *   旧 `groupByColumn(active, …)` 用**已过滤**的列表派生列 ⇒ 列集合 = 「该成员恰好参与了
 *   哪些项目」的函数。本夹具刻意让两个用例行业集合不同：
 *     m-admin 相关 = 室内项目 + 软件项目 ⇒ 9 列；m-rose 相关 = 只有室内项目 ⇒ 修复前 4 列。
 *   修法：列集合取自**板级宇宙**（全部 active 人类项目），分桶仍用过滤后的列表。
 *
 * ── ⚠️ 为什么 `?member=` 必须走 **SPA 导航**（pushState + popstate）而不是 `page.goto` ──
 *   本仓现状：**冷载首帧** `isAdmin` 仍为 false（members/settings 都是 IndexedDB 异步装载），
 *   `resolveMemberBoardSubject` 于是判 `denied` ⇒ `MemberBoardPage` 渲染
 *   `<Navigate to="/member-board" replace/>` ⇒ **`?member=` 被静默吃掉**，落地成"看自己"。
 *   （真机实测：goto 后 400ms，href 已是 `/member-board`，h1 是「项目看板」而非「朴彩英 的项目看板」。）
 *   这是独立缺陷（本 spec 不修、但用 A-00 断言钉住"参数确实生效"，避免本 spec 变成
 *   "同一页量两遍"的假绿）。用户实际路径（首页搜索点成员 → `navigate()`）是客户端路由，
 *   不受影响，故这里用同一条客户端路由路径复现。
 *
 * ── 变异自证（两条断言不是摆设：把修复分别退回两步，看谁红）──
 *   M1 把实现退回 `deriveColumns(projects)`（列集合重新变成「可见子集」的函数）：
 *      本 spec **两条红** —— 红在 `expect(b.columnCount).toBe(a.columnCount)`，
 *      报错是 `expected 4 to be 9`；同时纯函数单测（member-board-columns.spec.ts）红 4 条。
 *   M2 **只**把调用点退回 `groupByColumn(active, active, …)`（= 她原本看到的世界）：
 *      本 spec **两条红**，而纯函数单测 **5 条全绿** —— 单测看不见「调用点怎么接线」。
 *   ⇒ 两条闸缺一不可：只锁几何的话「列集合漂移但两用例恰好同宽」仍会绿；
 *     只锁语义的话 M2 这种接线错误单测抓不到。（两次变异构建产物均已还原，
 *     重建产物 md5 与修复后首次构建逐字节一致。）
 *
 * 前置：`npx vite build`（产物在 build-dist/）与本机 chromium；产物缺失/过期则整组 skip。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';

import {
  CAN_RUN_FRESH,
  CHROMIUM_PATH,
  startServer,
  shotDir,
} from './helpers/board-env';

const FIXTURE = resolve(__dirname, 'fixtures', 'member-board-columns.json');
const SHOT_DIR = shotDir('member-board-column-consistency');

type BoardMetrics = {
  href: string;
  h1: string;
  columnCount: number;
  labels: string[];
  tracks: number[];
  perRow: number[];
  boardWidth: number;
};

/** 页面内度量：看板列 section = main 里「grid + 含项目卡」的那一个 section */
function measureBoard(): BoardMetrics {
  const board =
    Array.from(document.querySelectorAll('main section[style*="auto-fit"]')).find((s) =>
      s.querySelector('[role="button"].group'),
    ) ?? null;
  if (!board) {
    return { href: location.pathname + location.search, h1: '', columnCount: 0, labels: [], tracks: [], perRow: [], boardWidth: 0 };
  }
  const cs = getComputedStyle(board);
  const tracks = cs.gridTemplateColumns
    .split(' ')
    .filter(Boolean)
    .map((t) => Math.round(parseFloat(t)));
  const kids = Array.from(board.children);
  const rows: number[] = [];
  let lastTop = Number.NaN;
  for (const k of kids) {
    const top = Math.round(k.getBoundingClientRect().top);
    if (!Number.isNaN(lastTop) && Math.abs(lastTop - top) <= 2) rows[rows.length - 1] += 1;
    else rows.push(1);
    lastTop = top;
  }
  const labels = kids.map(
    (k) =>
      Array.from(k.querySelectorAll('span, h2'))
        .map((x) => (x.textContent || '').trim())
        .filter((t) => t.length > 0)[0] ?? '',
  );
  return {
    href: location.pathname + location.search,
    h1: (document.querySelector('h1')?.textContent ?? '').trim(),
    columnCount: kids.length,
    labels,
    tracks,
    perRow: rows,
    boardWidth: Math.round(board.getBoundingClientRect().width),
  };
}

describe.skipIf(!CAN_RUN_FRESH)(
  '成员看板 · 自己的板 vs 看某成员（列集合 + 轨道几何必须逐项相等，真 Chromium）',
  () => {
    let browser: Browser;
    let server: { url: string; close(): Promise<void> };

    beforeAll(async () => {
      mkdirSync(SHOT_DIR, { recursive: true });
      server = await startServer();
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
    }, 60000);

    afterAll(async () => {
      await browser?.close();
      await server?.close();
    });

    /**
     * 建一个"已灌夹具"的环境：独立 context + SPA 导航页。
     * 身份刻意在**页面脚本之前**压进 localStorage（`changxia.currentMemberId`，键名唯一出处
     * `useSettingsStore.ts`）：导入完成后该成员真实存在，身份即成立——与 v07 夹具 spec 同法。
     */
    async function seededPage(viewport: { width: number; height: number }) {
      const ctx = await browser.newContext({ viewport });
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('changxia.currentMemberId', 'm-admin');
          localStorage.setItem('idplan.firstRunGuideSeen', '1');
        } catch {
          /* 隐私模式下 localStorage 不可写 ⇒ 后面的整库导入会报清晰错误 */
        }
      });
      const page = await ctx.newPage();
      await page.goto(server.url);
      await page.waitForSelector('header', { timeout: 20000 });

      // 走应用自己的备份导入链路（隐藏 file input → 预检 → 二次确认 → 整库替换 → reload）
      await page.locator('input[type="file"][accept*="json"]').first().setInputFiles(FIXTURE);
      const confirm = page.getByRole('button', { name: '确认恢复' });
      try {
        await confirm.waitFor({ state: 'attached', timeout: 15000 });
      } catch {
        const text = await page.locator('body').innerText();
        throw new Error(`备份导入未进入二次确认（夹具可能未过 zod 预检）。页面文本：${text.slice(0, 400)}`);
      }
      const reloaded = page.waitForEvent('load', { timeout: 20000 });
      await confirm.click({ force: true });
      await reloaded;
      await page.waitForSelector('main', { timeout: 20000 });
      await page.waitForTimeout(1200);

      // 导入成功判据：侧栏项目列表里出现夹具项目名（比等超时更有信息量）
      await page.waitForFunction(
        () => document.body.innerText.includes('云栖·湖畔茶室'),
        null,
        { timeout: 20000 },
      );
      return { ctx, page };
    }

    /** 客户端路由跳转（与首页搜索点成员同一条路径；见文件头 ⚠️） */
    async function spaGo(page: import('playwright-core').Page, route: string): Promise<void> {
      await page.evaluate((r) => {
        window.history.pushState({}, '', r);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, route);
      await page.waitForTimeout(1200);
    }

    for (const vp of [
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      it(`K-${vp.width} · 同一视口下两用例的列集合与解析轨道列表逐项相等（${vp.width}×${vp.height}）`, async () => {
        const { ctx, page } = await seededPage(vp);
        try {
          // A：自己的看板
          await spaGo(page, '/member-board');
          const a = (await page.evaluate(measureBoard)) as BoardMetrics;
          await page.screenshot({ path: resolve(SHOT_DIR, `K-${vp.width}-A-self.png`) });

          // B：管理员看某成员
          await spaGo(page, '/member-board?member=m-rose');
          const b = (await page.evaluate(measureBoard)) as BoardMetrics;
          await page.screenshot({ path: resolve(SHOT_DIR, `K-${vp.width}-B-view-member.png`) });

          // ① 参数确实生效——否则下面两条相等毫无意义（"同一页量两遍"是假绿）
          expect(b.href, '?member= 必须保留在 URL 上（无参时本用例不成立）').toContain('member=m-rose');
          expect(b.h1, '标题必须是「朴彩英 的项目看板」，否则说明看到的是自己的板').toContain('朴彩英');

          // ② 列集合逐项相等（列数 + 按序 label）
          expect(b.columnCount).toBe(a.columnCount);
          expect(b.labels).toEqual(a.labels);

          // ③ 解析后的轨道宽度列表逐项相等（几何一致：不只"几列"，还有每列多宽）
          expect(b.tracks).toEqual(a.tracks);
          expect(b.perRow).toEqual(a.perRow);
          expect(b.boardWidth).toBe(a.boardWidth);

          // ④ 反假绿：夹具下板必须是**多行业**（室内 + 软件），且软件侧列在"看朴彩英"时也在
          expect(a.columnCount).toBeGreaterThanOrEqual(4);
          expect(a.labels).toEqual(
            expect.arrayContaining(['待启动', '设计中', '深化中', '施工中', '开发中', '已发布']),
          );
          // 列集合不随"看谁"漂移的直接否证：软件列在 B（她与之无关）里同样必须存在
          expect(b.labels).toEqual(expect.arrayContaining(['开发中', '已发布']));

          // ⑤ 诊断快照落盘（每次跑都会更新，便于回归时一眼看出"哪一侧变了"）
          writeFileSync(
            resolve(SHOT_DIR, `K-${vp.width}-metrics.json`),
            JSON.stringify({ A: a, B: b }, null, 2),
          );
        } finally {
          await ctx.close();
        }
      }, 90000);
    }
  },
);
