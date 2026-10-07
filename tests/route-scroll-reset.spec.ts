import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import {
  CAN_RUN_FRESH,
  CHROMIUM_PATH,
  bootstrapAdminWithDemo,
  newContext,
  reenterAdmin,
  shotDir,
  startServer,
} from './helpers/board-env';

/**
 * 反馈（2026-10-07 21:21）· Bug D：首页成员列表点「看板」后页面不回到顶部。
 *
 * 她的原话：「点击选择看板后，页面并不会回到顶栏，而是在相应位置的下方，
 * 整体交互有问题」。实测记录（mb-probe，修复前）：首页滚到成员区（scrollTop=458）
 * → 点成员行「看板」→ 跳转 /member-board?member=… 后 scrollTop **仍是 458**。
 * 根因：SPA 路由切换不重置滚动位；壳层常驻化（v0.8.6）后滚动容器从 window
 * 收进 <main>（overflow-y-auto），浏览器原生「导航即回顶」对自定义容器不生效。
 *
 * 修复：AppShell 的 useLayoutEffect 盯 pathname，变化即把 <main> 滚顶
 * （唯一持有滚动容器、且覆盖全部路由的位置，逐页修必漏）。
 *
 * 路径说明（本 spec 的导航都走**真实入口**）：管理员的侧栏没有 /member-board
 * 链接（首项「项目」→/），去成员看板的真实路径只有成员行「看板」钮与搜索命中；
 * 回首页走侧栏「项目」链接（a[href="/"]）。
 *
 * 本 spec 钉四件事（第一件是她的报障路径，后三件防回归）：
 *   D-01 她的原路径：首页滚到成员区 → 点成员行「看板」⇒ 视口回顶（scrollTop=0）；
 *   D-02 另一条路由：看板 → 侧栏「我的任务」⇒ 回顶；
 *   D-03 反向：看板滚一段 → 侧栏回首页 ⇒ 回顶；
 *   D-04 既有行为不破坏：页面内视图切换（看板⇄月历，非路由变化）滚动位**保持**。
 */

/** 当前 main 滚动容器的 scrollTop */
async function mainScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('main')?.scrollTop ?? -1);
}

describe.skipIf(!CAN_RUN_FRESH)('Bug D · 路由切换回顶（真 Chromium）', () => {
  let browser: Browser;
  let server: { url: string; close(): Promise<void> };

  beforeAll(async () => {
    shotDir('route-scroll-reset');
    server = await startServer();
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
  }, 60000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  /** 管理员（演示负责人）+ indoor 示例 ⇒ 首页含成员区，1440×700 保证可滚 */
  async function adminHome(page: Page): Promise<void> {
    await bootstrapAdminWithDemo(page, server.url);
    await reenterAdmin(page);
    await page.waitForFunction(() => window.location.pathname === '/', null, { timeout: 10000 });
  }

  /** 管理员去成员看板的真实路径：成员行「看板」钮（title 精确锁定，排除视图切换同名钮） */
  async function openBoardViaMemberRow(page: Page): Promise<void> {
    await page.locator('button[title="查看该成员的看板"]').first().click();
    await page.waitForFunction(() => window.location.pathname === '/member-board', null, { timeout: 15000 });
    await page.waitForTimeout(500);
  }

  it('D-01 · 她的原路径：首页滚到成员区 → 点成员行「看板」⇒ 视口回顶', async () => {
    const ctx: BrowserContext = await newContext(browser, { width: 1440, height: 700 });
    const page: Page = await ctx.newPage();
    try {
      await adminHome(page);

      // 滚到首页中下部（成员区所在高度）
      await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 900));
      await page.waitForTimeout(300);
      const before = await mainScrollTop(page);
      expect(before, '首页应已向下滚动（否则本用例无意义）').toBeGreaterThan(0);

      await openBoardViaMemberRow(page);

      const after = await mainScrollTop(page);
      expect(after, '跳转成员看板后视口必须回顶（修复前保持 ' + before + '）').toBe(0);
      await page.screenshot({
        path: resolve(__dirname, '..', 'qa-scratch', 'route-scroll-reset', 'D-01-board-top.png'),
      });
    } finally {
      await ctx.close();
    }
  }, 120000);

  it('D-02 · 另一条路由：看板 → 侧栏「我的任务」⇒ 回顶', async () => {
    const ctx: BrowserContext = await newContext(browser, { width: 1440, height: 700 });
    const page: Page = await ctx.newPage();
    try {
      await adminHome(page);
      await openBoardViaMemberRow(page);
      await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 600));
      await page.waitForTimeout(300);
      expect(await mainScrollTop(page), '看板应已向下滚动').toBeGreaterThan(0);

      // 侧栏「我的任务」（a[href="/my-tasks"]，管理员与成员都有这一项）
      await page.evaluate(() => {
        document.querySelector('a[href="/my-tasks"]')?.click();
      });
      await page.waitForFunction(() => window.location.pathname === '/my-tasks', null, { timeout: 15000 });
      await page.waitForTimeout(500);
      expect(await mainScrollTop(page), '跳转我的任务应回顶').toBe(0);
    } finally {
      await ctx.close();
    }
  }, 120000);

  it('D-03 · 反向：看板滚一段 → 侧栏「项目」回首页 ⇒ 回顶', async () => {
    const ctx: BrowserContext = await newContext(browser, { width: 1440, height: 700 });
    const page: Page = await ctx.newPage();
    try {
      await adminHome(page);
      await openBoardViaMemberRow(page);
      await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 600));
      await page.waitForTimeout(300);
      expect(await mainScrollTop(page), '看板应已向下滚动').toBeGreaterThan(0);

      // 侧栏「项目」（a[href="/"]，管理员首项）
      await page.evaluate(() => {
        document.querySelector('a[href="/"]')?.click();
      });
      await page.waitForFunction(() => window.location.pathname === '/', null, { timeout: 15000 });
      await page.waitForTimeout(500);
      expect(await mainScrollTop(page), '回首页同样应回顶（修复前保持原滚动位）').toBe(0);
    } finally {
      await ctx.close();
    }
  }, 120000);

  it('D-04 · 既有行为不破坏：页面内视图切换（看板⇄月历）不触发回顶', async () => {
    const ctx: BrowserContext = await newContext(browser, { width: 1440, height: 700 });
    const page: Page = await ctx.newPage();
    try {
      await adminHome(page);
      // 首页：看板 → 月历（页面内切换，非路由变化）。首页的分段控件在视口内
      // （y≈250），点击聚焦不会把它滚入视口 ⇒ 滚动位应原样保持。
      await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 120));
      await page.waitForTimeout(250);
      await page.getByRole('tab', { name: '月历' }).click();
      await page.waitForTimeout(700);
      expect(await mainScrollTop(page), '首页内切月历不应弹顶（视图切换 ≠ 路由切换）').toBe(120);

      // 成员看板：切视图后**路由必须未变**——回顶 effect 的触发条件只有 pathname
      // 变化，这里证明它没有被误触发。
      // （实测备注：成员看板切视图会把视口弹到顶——真因是 SegmentedControl 住在
      // 标题行、点击聚焦被浏览器滚入视口的既有行为，用 DOM click 不聚焦实测保持
      // 120。该现象与本修复无关，且不属本轮四条反馈，故只钉路由不变、不钉滚动位。）
      await openBoardViaMemberRow(page);
      await page.getByRole('tab', { name: '月历' }).click();
      await page.waitForTimeout(600);
      const afterSwitch = await page.evaluate(() => window.location.pathname);
      expect(afterSwitch, '视图切换不得改变路由（否则会被回顶 effect 误伤）').toBe('/member-board');
    } finally {
      await ctx.close();
    }
  }, 120000);
});
