import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import {
  CAN_RUN_FRESH,
  CHROMIUM_PATH,
  bootstrapAdminWithDemo,
  enterMemberBoard,
  newContext,
  reenterAdmin,
  shotDir,
  startServer,
} from './helpers/board-env';

/**
 * 反馈（2026-10-07 21:21）· Bug C：成员看板左上角没有返回键。
 *
 * 她的原话：「我需要再点击左侧边栏的项目或其他位置，才能触达上一步」——站内
 * 其他页（项目详情）左上角有「‹ 项目」返回钮，成员看板只有标题。
 *
 * 修复：标题行加返回钮，视觉逐字复用 TopBar 面包屑返回箭（同控件家族）。
 * 语义（MemberBoardPage `goBack` 注释有完整论证）：
 *   ① 有会话历史（history.state.idx > 0）⇒ navigate(-1)（与 TopBar 项目详情同口径）；
 *   ② 无会话历史（深链/刷新即落地/冷启动）⇒ 按身份兜底：
 *      管理员/未进入 ⇒ '/'；成员 ⇒ '/my-tasks'（成员回 '/' 会被 HomeRouteGuard
 *      弹回本页，等于没回）。
 *
 * 本 spec 三条路径各跑一遍真 Chromium：
 *   C-01 有历史：卡片 → 项目详情 → 侧栏回看板 → 返回 ⇒ 落回 /project/:id；
 *   C-02 深链·成员：整页重载 /member-board（idx=0）→ 返回 ⇒ /my-tasks；
 *   C-03 深链·管理员：整页重载 /member-board（idx=0）→ 返回 ⇒ /。
 */

/** 点标题行返回钮（aria-label 与 TopBar 项目详情返回箭一致） */
async function clickBack(page: Page): Promise<void> {
  await page.locator('button[aria-label="返回上一页"]').first().click();
  await page.waitForTimeout(600);
}

describe.skipIf(!CAN_RUN_FRESH)('Bug C · 成员看板返回键（真 Chromium）', () => {
  let browser: Browser;
  let server: { url: string; close(): Promise<void> };

  beforeAll(async () => {
    shotDir('member-board-back');
    server = await startServer();
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('C-00 · 返回钮存在于标题行、位于标题左侧', async () => {
    const ctx: BrowserContext = await newContext(browser, { width: 1440, height: 900 });
    const page: Page = await ctx.newPage();
    try {
      await bootstrapAdminWithDemo(page, server.url);
      await enterMemberBoard(page);

      const btn = page.locator('button[aria-label="返回上一页"]').first();
      await btn.waitFor({ state: 'visible', timeout: 10000 });
      const geom = await page.evaluate(() => {
        const b = document.querySelector('button[aria-label="返回上一页"]');
        const h1 = document.querySelector('h1');
        if (!b || !h1) return null;
        const br = b.getBoundingClientRect();
        const hr = h1.getBoundingClientRect();
        return { btnRight: br.right, h1Left: hr.left, btnW: Math.round(br.width) };
      });
      expect(geom).not.toBeNull();
      expect(geom!.btnW, '返回钮应为 28×28（TopBar 同款 h-7 w-7）').toBe(28);
      expect(geom!.btnRight, '返回钮应紧贴标题左侧').toBeLessThanOrEqual(geom!.h1Left + 0.5);
      await page.screenshot({
        path: resolve(__dirname, '..', 'qa-scratch', 'member-board-back', 'C-00-title-row.png'),
      });
    } finally {
      await ctx.close();
    }
  }, 120000);

  it('C-01 · 有会话历史：卡片 → 详情 → 回看板 → 返回，落回项目详情', async () => {
    const ctx: BrowserContext = await newContext(browser, { width: 1440, height: 900 });
    const page: Page = await ctx.newPage();
    try {
      await bootstrapAdminWithDemo(page, server.url);
      await enterMemberBoard(page);

      // 点首张项目卡 → 项目详情
      await page.locator('[role="button"].group').first().click();
      await page.waitForFunction(() => /^\/project\/[^/]+$/.test(window.location.pathname), null, {
        timeout: 15000,
      });
      const detailUrl = page.url();

      // 经侧栏回成员看板（按 href 点：成员侧栏首项叫「看板」不是「成员看板」）
      await page.evaluate(() => {
        document.querySelector('a[href="/member-board"]')?.click();
      });
      await page.waitForFunction(() => window.location.pathname === '/member-board', null, { timeout: 15000 });

      // 返回 ⇒ navigate(-1) 回到来的项目详情
      await clickBack(page);
      expect(new URL(page.url()).pathname, '有历史时应 navigate(-1) 落回项目详情').toBe(
        new URL(detailUrl).pathname,
      );
    } finally {
      await ctx.close();
    }
  }, 120000);

  it('C-02 · 深链·成员：整页重载后 idx=0，返回落 /my-tasks（不回会被弹回本页的 /）', async () => {
    const ctx: BrowserContext = await newContext(browser, { width: 1440, height: 900 });
    const page: Page = await ctx.newPage();
    try {
      await bootstrapAdminWithDemo(page, server.url);
      await enterMemberBoard(page);

      // 整页重载到 /member-board：新文档 ⇒ 会话历史归零（idx=0），身份仍在
      await page.goto(`${server.url}member-board`);
      await page.waitForFunction(() => window.location.pathname === '/member-board', null, { timeout: 20000 });
      await page.locator('button[aria-label="返回上一页"]').first().waitFor({ state: 'visible', timeout: 15000 });

      await clickBack(page);
      await page.waitForFunction(() => window.location.pathname !== '/member-board', null, { timeout: 10000 });
      expect(new URL(page.url()).pathname, '成员深链场景返回应落 /my-tasks').toBe('/my-tasks');
    } finally {
      await ctx.close();
    }
  }, 120000);

  it('C-03 · 深链·管理员：整页重载后 idx=0，返回落 /（搜索/成员列表的来处）', async () => {
    const ctx: BrowserContext = await newContext(browser, { width: 1440, height: 900 });
    const page: Page = await ctx.newPage();
    try {
      await bootstrapAdminWithDemo(page, server.url);
      await reenterAdmin(page); // 演示负责人 = admin
      await page.waitForFunction(() => window.location.pathname === '/', null, { timeout: 10000 });

      await page.goto(`${server.url}member-board`);
      await page.waitForFunction(() => window.location.pathname === '/member-board', null, { timeout: 20000 });
      await page.locator('button[aria-label="返回上一页"]').first().waitFor({ state: 'visible', timeout: 15000 });

      await clickBack(page);
      await page.waitForFunction(() => window.location.pathname === '/', null, { timeout: 10000 });
      expect(new URL(page.url()).pathname, '管理员深链场景返回应落 /').toBe('/');
    } finally {
      await ctx.close();
    }
  }, 120000);
});
