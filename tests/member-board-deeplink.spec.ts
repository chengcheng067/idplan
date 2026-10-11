/**
 * 成员看板 · 冷载深链 `?member=<id>` 的就绪门（真 Chromium）。
 *
 * ── 病灶（真机实测，0.9.x）──
 *   `page.goto('/member-board?member=<id>')`（深链 / 刷新）时，首帧 members 还没从
 *   IndexedDB 读进来 ⇒ `isAdmin === false` ⇒ `resolveMemberBoardSubject` 判 **denied**
 *   ⇒ `MemberBoardPage` 渲染 `<Navigate to="/member-board" replace />` ⇒
 *   **参数被静默剥掉、落地成「看自己」**。不报错、无异常——一个可分享的深链静默丢掉目标。
 *   管理员在应用内点进成员看板（客户端路由，store 已就绪）不受影响，只有深链/刷新中招。
 *
 * ── 修法与不变量 ──
 *   就绪前**不下** denied / missing 两条判决（渲染占位、URL 原样保留），就绪后按真实角色重判。
 *   `readiness === 'ready'` 时 members 必已就绪（`bootstrapAllStores` 内 `setAll(members)`
 *   先于 `hydrate()`，见 useRepos.ts 的时序保证）——**不是**放宽 denied。
 *
 * 三条语义各一条用例（隐私边界一条不许松）：
 *   D-01 管理员 + 存在的 id  → 冷载落到该成员；刷新后仍在
 *   D-02 管理员 + 不存在的 id → 显式空态「找不到该成员」，**不静默回落成看自己**
 *   D-03 成员身份 + 别人的 id → 装载完成后**仍然 denied**（参数被剥、只看自己的板）
 *
 * 前置：`npx vite build`（产物在 build-dist/）与本机 chromium；产物缺失/过期则整组 skip。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

import { CAN_RUN_FRESH, CHROMIUM_PATH, startServer, shotDir } from './helpers/board-env';

const FIXTURE = resolve(__dirname, 'fixtures', 'member-board-columns.json');
const SHOT_DIR = shotDir('member-board-deeplink');

/** 夹具成员：m-admin 奚工（管理员）/ m-rose 朴彩英（成员）/ m-zhou 周工（成员） */
const ADMIN = 'm-admin';
const ROSE = 'm-rose';
const GHOST = 'mem_ghost_deleted';

describe.skipIf(!CAN_RUN_FRESH)(
  '成员看板 · 冷载深链 ?member= 就绪门（真 Chromium：装载完成前不得剥参数）',
  () => {
    let browser: Browser;
    let server: { url: string; close(): Promise<void> };

    beforeAll(async () => {
      server = await startServer();
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
    }, 60000);

    afterAll(async () => {
      await browser?.close();
      await server?.close();
    });

    /**
     * 灌夹具并**留在应用内**（不 reload 后再进）；返回一张可继续导航的页。
     * 身份用 `addInitScript` 预写 localStorage（键名唯一出处 useSettingsStore）——
     * 每次导航/刷新都会重放，故冷载与刷新两条路径的身份一致。
     */
    async function seeded(identity: string) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript((who) => {
        try {
          localStorage.setItem('changxia.currentMemberId', who as string);
          localStorage.setItem('idplan.firstRunGuideSeen', '1');
        } catch {
          /* 隐私模式下 localStorage 不可写 ⇒ 后面的导入会报清晰错误 */
        }
      }, identity);
      const page = await ctx.newPage();
      await page.goto(server.url);
      await page.waitForSelector('header', { timeout: 20000 });
      await page.locator('input[type="file"][accept*="json"]').first().setInputFiles(FIXTURE);
      const confirm = page.getByRole('button', { name: '确认恢复' });
      await confirm.waitFor({ state: 'attached', timeout: 15000 });
      const reloaded = page.waitForEvent('load', { timeout: 20000 });
      await confirm.click({ force: true });
      await reloaded;
      await page.waitForSelector('main', { timeout: 20000 });
      await page.waitForFunction(() => document.body.innerText.includes('云栖·湖畔茶室'), null, {
        timeout: 20000,
      });
      return { ctx, page };
    }

    it('D-01 · 管理员冷载深链 ?member=<存在的 id> → 落到该成员；刷新后仍在（参数不被剥）', async () => {
      const { ctx, page } = await seeded(ADMIN);
      try {
        // ★ 冷载（就是深链/刷新那条路径）：修复前这里会落地成「看自己」
        await page.goto(`${server.url}member-board?member=${ROSE}`, { waitUntil: 'load' });
        await page.waitForSelector('main', { timeout: 20000 });
        await page.waitForFunction(
          () => (document.querySelector('h1')?.textContent ?? '').includes('朴彩英'),
          null,
          { timeout: 20000 },
        );

        expect(page.url(), '深链参数必须保留（未被 <Navigate> 剥掉）').toContain(`member=${ROSE}`);
        expect(await page.locator('h1').first().innerText()).toContain('朴彩英');
        expect(await page.locator('body').innerText(), '就绪后不得停在装载占位').not.toContain(
          '正在装载本地数据',
        );

        // 刷新：深链的第二个入口（也是她实际会用的：收藏/分享后按 F5）
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(
          () => (document.querySelector('h1')?.textContent ?? '').includes('朴彩英'),
          null,
          { timeout: 20000 },
        );
        expect(page.url(), '刷新后参数仍须保留').toContain(`member=${ROSE}`);

        await page.screenshot({ path: resolve(SHOT_DIR, 'D-01-admin-deeplink.png') });
      } finally {
        await ctx.close();
      }
    }, 120000);

    it('D-02 · 管理员冷载 ?member=<不存在的 id> → 显式空态，不静默回落成看自己', async () => {
      const { ctx, page } = await seeded(ADMIN);
      try {
        await page.goto(`${server.url}member-board?member=${GHOST}`, { waitUntil: 'load' });
        await page.waitForSelector('main', { timeout: 20000 });
        await page.waitForFunction(
          () => document.body.innerText.includes('找不到该成员'),
          null,
          { timeout: 20000 },
        );

        const text = await page.locator('body').innerText();
        expect(text, '必须是显式空态').toContain('找不到该成员');
        expect(text, '不得回落成看自己（那是把「看别人的板」骗成「看自己的板」）').not.toContain(
          '仅显示与我相关的项目',
        );
        expect(page.url(), '空态下参数也不该被剥（用户可看到链接本身有问题）').toContain(
          `member=${GHOST}`,
        );

        await page.screenshot({ path: resolve(SHOT_DIR, 'D-02-admin-missing.png') });
      } finally {
        await ctx.close();
      }
    }, 120000);

    it('D-03 · 成员身份冷载 ?member=<别人的 id> → 就绪后**仍然 denied**（参数被剥，只看自己的板）', async () => {
      const { ctx, page } = await seeded(ROSE);
      try {
        await page.goto(`${server.url}member-board?member=${ADMIN}`, { waitUntil: 'load' });
        await page.waitForSelector('main', { timeout: 20000 });
        // 等「判决已下」的稳定态：标题是普通看板标题（不是「奚工 的项目看板」）
        await page.waitForFunction(
          () => (document.querySelector('h1')?.textContent ?? '').trim() === '项目看板',
          null,
          { timeout: 20000 },
        );

        expect(page.url(), '隐私边界：成员身份带别人的 id 必须被剥回无参').not.toContain('member=');
        expect(page.url()).toContain('/member-board');
        expect(await page.locator('h1').first().innerText(), '标题是看自己的板').toBe('项目看板');

        const text = await page.locator('body').innerText();
        expect(text, '不展示别人看板的标题').not.toContain('奚工 的项目看板');
        expect(text).not.toContain('正在装载本地数据');

        await page.screenshot({ path: resolve(SHOT_DIR, 'D-03-member-denied.png') });
      } finally {
        await ctx.close();
      }
    }, 120000);
  },
);
