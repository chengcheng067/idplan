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
 * 反馈（2026-10-07 21:21）· Bug B：窗口拉宽后成员看板空白太多。
 *
 * 她的截图（宽窗）原话：「看板列被横向拉得很宽，但列内容顶对齐，下半大片空白」。
 * 实测记录（mb-probe，修复前）：列模板 `minmax(min(100%,340px), 1fr)` 的 1fr 让
 * 轨道无限拉伸——main 封顶 1440 ⇒ section ≤1376 只放得下 3 条 340 轨道，1920
 * 档三列各分到 **448px**（比 ProjectCard 设计宽 340 多 32%），任务三块同样被
 * 拉到 448；列内容不随宽度增长 ⇒ 又宽又空。
 *
 * 修复：列几何改为「基准 340 / 上限 360 / auto-fit 换行 + justify-center 居中
 * 消化余量」（MemberBoardPage 的 BOARD_COLUMN_TEMPLATE，任务三块与看板列同源）。
 * 刻意不用「拉伸卡片高度填满列高」的糊法（产品负责人明令禁止）。
 *
 * 本 spec 的职责：≥1600 宽视口下钉住三件事——
 *   ① 列宽有上限（≤372，含取整噪声）：不再出现 448 级的拉伸列；
 *   ② 列宽有下限（≥339）： cards 不被压到设计宽以下（反馈 #10.4 的教训）；
 *   ③ 列盒贴合内容（列底缘 − 内容底缘 ≤2）：items-start 未被破坏、没有
 *      「列盒很高内容很矮」的内部空洞；页面无横向溢出。
 */

/** 一列一度量：宽 / 盒高 / 内容底缘差 / 卡片是否撑满列宽 */
async function columnMetrics(
  page: Page,
  sectionIndex: number,
): Promise<{ cols: Array<{ w: number; voidPx: number; cardW: number | null }>; found: boolean }> {
  return page.evaluate((idx: number) => {
    const sections = Array.from(document.querySelectorAll('section.grid'));
    const sec = sections[idx];
    if (!sec) return { found: false, cols: [] };
    const cols = Array.from(sec.children) as HTMLElement[];
    return {
      found: true,
      cols: cols.map((c) => {
        const cr = c.getBoundingClientRect();
        const last = c.lastElementChild as HTMLElement | null;
        const contentBottom = last ? last.getBoundingClientRect().bottom : cr.bottom;
        // 列盒贴合内容 = 列内容盒底缘 − 最后子元素底缘。必须扣掉列自身的
        // padding-bottom 与 border-bottom（任务三块 p-4+1px 边框 = 17px、
        // 看板列 p-3.5+1px = 15px），否则量到的是设计内边距而非空洞。
        const cs = getComputedStyle(c);
        const padB = parseFloat(cs.paddingBottom) || 0;
        const bordB = parseFloat(cs.borderBottomWidth) || 0;
        const card = c.querySelector('[role="button"].group') as HTMLElement | null;
        return {
          w: Math.round(cr.width),
          voidPx: Math.round((cr.bottom - padB - bordB - contentBottom) * 10) / 10,
          cardW: card ? Math.round(card.getBoundingClientRect().width) : null,
        };
      }),
    };
  }, sectionIndex);
}

/** DOM 次序：section.grid[0] = 成员任务三块，[1] = 看板列 */
const TRIAGE_SECTION = 0;
const KANBAN_SECTION = 1;

describe.skipIf(!CAN_RUN_FRESH)(
  'Bug B · 成员看板列宽上限/下限与列盒贴合（真 Chromium，宽视口）',
  () => {
    let browser: Browser;
    let server: { url: string; close(): Promise<void> };

    beforeAll(async () => {
      shotDir('member-board-column-cap');
      server = await startServer();
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
    }, 60000);

    afterAll(async () => {
      await browser?.close();
      await server?.close();
    });

    for (const vp of [
      { w: 1920, h: 1080, name: 'wide-1920' },
      { w: 1600, h: 900, name: 'wide-1600' },
    ] as const) {
      it(`B-01 · ${vp.name}：看板列与任务三块列宽 ∈[339,372]、列盒贴合内容、无横向溢出`, async () => {
        const ctx: BrowserContext = await newContext(browser, { width: vp.w, height: vp.h });
        const page: Page = await ctx.newPage();
        try {
          await bootstrapAdminWithDemo(page, server.url);
          await enterMemberBoard(page);
          await page.waitForTimeout(400);

          for (const [name, idx] of [
            ['任务三块', TRIAGE_SECTION],
            ['看板列', KANBAN_SECTION],
          ] as const) {
            const m = await columnMetrics(page, idx);
            expect(m.found, `${vp.name} 应找到「${name}」section`).toBe(true);
            expect(m.cols.length, `${vp.name}「${name}」应有列`).toBeGreaterThan(0);
            for (const [i, col] of m.cols.entries()) {
              expect(col.w, `${vp.name}「${name}」第 ${i + 1} 列宽不得超过上限 372（修复前 448）`).toBeLessThanOrEqual(372);
              expect(col.w, `${vp.name}「${name}」第 ${i + 1} 列宽不得低于基准 339（保护卡内布局）`).toBeGreaterThanOrEqual(339);
              expect(col.voidPx, `${vp.name}「${name}」第 ${i + 1} 列盒应贴合内容（内部空洞 ≤2px）`).toBeLessThanOrEqual(2);
            }
          }

          // 看板列内的项目卡应撑满列宽（列−列内边距，证明卡片跟着列走、没有被留白）
          const kanban = await columnMetrics(page, KANBAN_SECTION);
          const filledCols = kanban.cols.filter((c) => c.cardW !== null);
          expect(filledCols.length, '至少一列应含项目卡').toBeGreaterThan(0);
          for (const [i, col] of filledCols.entries()) {
            expect(col.cardW!, `${vp.name} 看板第 ${i + 1} 列卡片应撑满列宽（≥列宽−40）`).toBeGreaterThanOrEqual(col.w - 40);
          }

          const overflowX = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          expect(overflowX, `${vp.name} 页面不应横向溢出`).toBeLessThanOrEqual(0);

          await page.screenshot({
            path: resolve(__dirname, '..', 'qa-scratch', 'member-board-column-cap', `B-01-${vp.name}.png`),
            fullPage: true,
          });
        } finally {
          await ctx.close();
        }
      }, 120000);
    }
  },
);
