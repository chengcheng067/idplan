import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import {
  CAN_RUN_FRESH,
  CHROMIUM_PATH,
  bootstrapAdminWithDemo,
  enterMemberBoard,
  newContext,
  shotDir,
  startServer,
} from './helpers/board-env';

/**
 * 反馈（2026-10-07 21:21）· Bug A：成员看板统计卡收窄时标题被裁。
 *
 * 她的原话：「左右收窄以后文字会缺失」——截图里「进行中项目/本周到期任务」的尾字
 * 被吃掉（红箭头圈注）。实测记录（mb-probe）：根因统计卡行曾用固定基准宽 +
 * 标签 truncate，窄窗时卡片被压到窄于文字 ⇒ nowrap 的标题尾部被静默裁掉；
 * 统计卡行改 flex-wrap（反馈 #10.4，ada81a6）后各宽度不再触发，但标签上的
 * `truncate` 仍在——「碰巧不裁」不是保证。本轮把标签改为**允许换行**（去掉
 * truncate），从结构上消灭「文字被裁」这一形态：窄到一行放不下就折两行，
 * 任何宽度下 innerText 与视觉都完整。
 *
 * 本 spec 的职责：把「四个标题完整可读」钉在两个极值视口上——
 *   1280（xl 断点下限：四卡同行最挤的桌面档）与 390（最窄手机档）。
 * 断言 = innerText 逐字完整 + 视觉未裁（scrollWidth ≤ clientWidth）+ 卡片
 * 不出血（标签底缘在卡内）+ 页面无横向溢出。
 */

/** 统计卡四个标签（与 MemberBoardPage / HomePage 的 StatCard 文案逐字一致） */
const STAT_LABELS = ['进行中项目', '本周到期任务', '逾期风险', '本月完工'] as const;

/** 单个视口下四张统计卡的标签完整性 + 几何 */
async function statLabelMetrics(page: Page): Promise<
  Array<{
    label: string;
    found: boolean;
    text: string;
    clipped: boolean;
    insideCard: boolean;
    cardW: number;
  }>
> {
  return page.evaluate((labels: readonly string[]) => {
    const out: Array<{
      label: string;
      found: boolean;
      text: string;
      clipped: boolean;
      insideCard: boolean;
      cardW: number;
    }> = [];
    for (const label of labels) {
      const el = Array.from(document.querySelectorAll('span')).find(
        (s) => (s.textContent ?? '').trim() === label,
      ) as HTMLElement | undefined;
      const card = el?.closest('div.shadow-raised') as HTMLElement | null;
      if (!el || !card) {
        out.push({ label, found: false, text: '', clipped: true, insideCard: false, cardW: 0 });
        continue;
      }
      const lr = el.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      out.push({
        label,
        found: true,
        text: el.innerText,
        // 视觉未裁：滚动内容宽 ≤ 可见宽（truncate 裁字时 scrollWidth 会超出一截）
        clipped: el.scrollWidth > el.clientWidth + 1,
        // 标签折行也不许顶出卡片（卡高固定 92/156，两行标签仍在卡内）
        insideCard: lr.bottom <= cr.bottom + 0.5 && lr.top >= cr.top - 0.5,
        cardW: Math.round(cr.width),
      });
    }
    return out;
  }, STAT_LABELS);
}

describe.skipIf(!CAN_RUN_FRESH)(
  'Bug A · 成员看板统计卡标题完整性（真 Chromium，极值视口）',
  () => {
    let browser: Browser;
    let server: { url: string; close(): Promise<void> };

    beforeAll(async () => {
      shotDir('member-board-stat-labels');
      server = await startServer();
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
    }, 60000);

    afterAll(async () => {
      await browser?.close();
      await server?.close();
    });

    /**
     * 1280（xl 断点下限：统计卡四张同行、单卡最窄的桌面档——收窄压力的来源）
     * 与 390（最窄手机档：单列堆叠）两个极值。进页一次后 setViewportSize
     * 换档（CSS 媒体查询即时重排，与重新开上下文等价且快一个数量级）。
     */
    const VIEWPORTS = [
      { w: 1280, h: 900, name: 'xl-1280' },
      { w: 390, h: 844, name: 'phone-390' },
    ] as const;

    for (const vp of VIEWPORTS) {
      it(`S-01 · ${vp.name}：四个标题 innerText 逐字完整、视觉未裁、卡片不出血`, async () => {
        const ctx: BrowserContext = await newContext(browser, { width: 1280, height: 900 });
        const page: Page = await ctx.newPage();
        try {
          await bootstrapAdminWithDemo(page, server.url);
          await enterMemberBoard(page);

          await page.setViewportSize({ width: vp.w, height: vp.h });
          await page.waitForTimeout(400);

          const metrics = await statLabelMetrics(page);
          for (const m of metrics) {
            expect(m.found, `${vp.name} 应找到统计卡「${m.label}」`).toBe(true);
            expect(m.text, `${vp.name}「${m.label}」innerText 必须逐字完整`).toBe(m.label);
            expect(m.clipped, `${vp.name}「${m.label}」不得被视觉裁切（scrollWidth 超宽）`).toBe(false);
            expect(m.insideCard, `${vp.name}「${m.label}」不得顶出卡片`).toBe(true);
            expect(m.cardW, `${vp.name}「${m.label}」应有正宽度`).toBeGreaterThan(0);
          }

          // 页面级：不出现横向滚动（统计卡行把容器撑爆的兜底断言）
          const overflowX = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          expect(overflowX, `${vp.name} 页面不应横向溢出`).toBeLessThanOrEqual(0);

          // 四张卡都落在视口内（没有被挤出右侧屏幕）
          const cardsInside = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('span')).filter((s) =>
              ['进行中项目', '本周到期任务', '逾期风险', '本月完工'].includes((s.textContent ?? '').trim()),
            );
            return spans.every((s) => {
              const c = s.closest('div.shadow-raised') as HTMLElement | null;
              if (!c) return false;
              const r = c.getBoundingClientRect();
              return r.left >= -0.5 && r.right <= window.innerWidth + 0.5;
            });
          });
          expect(cardsInside, `${vp.name} 四张统计卡应完整落在视口内`).toBe(true);

          await page.screenshot({
            path: resolveShot('member-board-stat-labels', `S-01-${vp.name}.png`),
            fullPage: false,
          });
        } finally {
          await ctx.close();
        }
      }, 120000);
    }
  },
);

/** 截图路径（qa-scratch 已在 .gitignore） */
function resolveShot(dir: string, file: string): string {
  return resolve(__dirname, '..', 'qa-scratch', dir, file);
}
