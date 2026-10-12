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
 * ═══ v1.0.x 契约重定（产品拍板「默认窗口就要每行 4 列」）═══
 *
 * **旧契约（0.9.x）**：一个 B-01 用例，把看板列与任务三块**当成同一件事**量
 * ——「两处列宽 ∈[339,372]」。因为那两处当时共用同一个常量（基准 340 / 上限 360），
 * 事实上也确实同宽同轨数。
 *
 * **新设计**：两处**解耦**，各用各的定宽（`max` = `min` ⇒ 永不被拉伸）：
 *   · 看板列 `BOARD_COLUMN_TEMPLATE` = `262px`：默认窗口 1400 ⇒ section 1096 ⇒
 *     **4 列**（旧：`360` ⇒ 2 列）。262 是「1096 宽下出 4 轨」的临界值
 *     （`(1096+16)/(t+16) ≥ 4 ⇒ t ≤ 262`），卡片随之 232（= 262 − 列盒 30）。
 *   · 任务三块 `TRIAGE_COLUMN_TEMPLATE` = `340px`：默认窗口 ⇒ **3 轨并排**（旧：2 轨）。
 *     三块恒 3 个，若沿用 262 会排 4 轨、第 4 轨永远空着。
 *
 * **为什么旧数字两边都不成立**（不是"放宽"，是契约本身换了对象）：
 *   旧契约要求「列宽 ≥339」——那是**卡片设计宽 340 的护城河**（反馈 #10.4 的教训：
 *   105–130px 窄卡全面报废）。新设计把看板列主动压到 262（产品要 4 列），
 *   所以「列宽 ≥339」对看板列**必须作废**；但护城河的**本意**（卡内不许报废）
 *   没有作废，它改由 `tests/member-board-narrow-card.spec.ts` 下的**卡内逐元素断言**
 *   承接（到期日不截断 / 胶囊不折行 / 头像不越界 / 进度条贴合 / 无纵向溢出）。
 *   任务三块则仍按 340 设计宽呈现（它没有"要 4 列"的约束）。
 *
 * 本 spec 的职责（拆成三条契约，各自给数）：
 *   B-01a 看板列：轨道恒 **262**、默认窗口 **4 列**、且**轨道宽不随容器宽增长**
 *         （新增的反拉伸断言：1600 与 1920 的 section 不同、轨道必须同值）
 *   B-01b 任务三块：轨道恒 **340**、默认窗口 **3 轨**、**三块等高**（2026-10-12 拍板）
 *   B-01c 守闸：**两条纪律方向相反且同时成立** —— 看板列不许被拉齐、任务三块必须等高
 *   「**列盒贴合内容**（内部空洞 ≤2px）」这条只留给 **B-01a**：看板列每列贴合自己的内容，
 *   它正是"看板列没被拉伸"的**零数据依赖**表达式（任务三块那一边刻意不贴合，见 B-01b）。
 *   两条都仍然要求**页面无横向溢出**。
 *
 * ── 2026-10-12 用户拍板「任务三块等高」（本批新增，方案 B）──
 * 他附截图 + 三个红箭头圈出「任务三块」下方的两片空洞：「成员的窗口看板，在这个界面下把这个
 * 部分做成四列非常难吗？**为什么一直在拒绝我**」。根因不是列数（默认窗口早就是 3 轨并排），
 * 而是**纵向**：三块内容量 4 / 9 / 1 条 ⇒ 第 1、3 块的盒子比最高的「进行中」矮，下面各空一片。
 * 做法：任务三块那个 `section` 去掉 `items-start` ⇒ grid 默认 `align-items: stretch` ⇒
 * 三块拉齐到行高（= 最高块），空洞从"块外"挪进"块内"，三块底边对齐。
 * ⚠️ 看板列那个 `section` 的 `items-start` **一个字母都不许动**（两条纪律刻意相反，见 B-01c）。
 *
 * ── 变异自证（产物还原后重建 md5 与变异前逐字节一致）──
 *   M1 · 只把 `BOARD_COLUMN_TEMPLATE` 退回 gen3 `340/360`：
 *     **B-01a 红** —— 红点是 `默认窗口 1400 看板列轨道数应为 floor((section+16)/278) = 4`，
 *     实测 **2**（断言按序执行，故第 ⑤ 条反拉伸断言没轮到；它守的是另一段：
 *     旧模板在宽档会被抻宽，新模板恒 262）。
 *   纯函数单测（`member-board-columns.spec.ts`）在此变异下 **5 条全绿**——它看不见几何常量，
 *   这就是为什么几何必须有真机闸。
 *   M2 · 把 `items-start` 加回**任务三块**那个 `section` ⇒ **两条红**（实测原文）：
 *       `B-01b 任务三块第 1 块盒高应等于三块最大值 864（实测各块 96.5 / 864 / 264；不等高即
 *        用户 2026-10-12 圈出的空洞）: expected 767.5 to be less than or equal to 1`
 *       `B-01c 任务三块必须**不带** items-start…: expected 'flex-start' not to be 'flex-start'`
 *       （96.5 / 864 / 264 这三个数就是用户截图里那三块的高度。）
 *   M3 · 把**看板列** `section` 的 `items-start` 删掉 ⇒ **两条红**（实测原文）：
 *       `B-01a default-1400 看板第 2 列盒应贴合内容（内部空洞 ≤2px；被拉伸即红）:
 *        expected 152.5 to be less than or equal to 2`
 *       `B-01c 看板列必须保留 items-start…: expected 'normal' to be 'flex-start'`
 *   ⚠️ 诚实登记（**实测证明的假绿**）：**「看板列各列盒高不全相等」这个写法在 M3 下仍然成立**
 *     —— M3 变异态实测各列高 = `[249 ×16, 96.5 ×5]` ⇒ 仍有 **2 个取值**（全空行照旧矮、
 *     有卡行照旧高）⇒ 那条断言永远红不了。能判红的只有
 *     `align-items` 计算值（`flex-start` → `normal`）与**行内**是否被拉齐、
 *     以及 B-01a ③ 的 `voidPx`（0 → 152.5）。证据：`qa-scratch/mbcols/probe18-m2.log`。
 *   ⚠️ 编号对照（避免误读）：team-lead 本批派单里点名的「M1 = 把 `items-start` 加回任务三块」
 *     与「M2 = 删掉看板列的 `items-start`」，在本文件里分别记作 **M2 / M3** —— 因为
 *     **M1 这个编号在本文件已属"退回 gen3 几何"那条历史变异**（见上），不改它的编号免得
 *     与既有提交信息、其他 spec 的引用对不上。
 */

/** 一列一度量：宽 / 盒高 / 顶边 / 内容底缘差 / 卡片是否撑满列宽 */
async function columnMetrics(
  page: Page,
  sectionIndex: number,
): Promise<{
  cols: Array<{ w: number; h: number; top: number; voidPx: number; cardW: number | null }>;
  found: boolean;
  tracks: number[];
  sectionW: number;
  align: string;
}> {
  return page.evaluate((idx: number) => {
    const R = (n: number): number => Math.round(n * 10) / 10;
    const sections = Array.from(document.querySelectorAll('section.grid'));
    const sec = sections[idx];
    if (!sec) return { found: false, cols: [], tracks: [], sectionW: 0, align: '' };
    const cols = Array.from(sec.children) as HTMLElement[];
    const tracks = getComputedStyle(sec)
      .gridTemplateColumns.split(' ')
      .filter(Boolean)
      .map((t) => R(parseFloat(t)));
    return {
      found: true,
      tracks,
      sectionW: R(sec.getBoundingClientRect().width),
      /*
       * `align-items` 的**计算值**：写 `items-start` 时是 `flex-start`；不写（= grid 默认
       * `stretch`）时现代浏览器算成 `normal`。本 spec 用它做「两条纪律方向相反」的结构判据
       * —— 它**零数据依赖**，比"量出来高不一样"更硬（见 B-01c 注释）。
       */
      align: getComputedStyle(sec).alignItems,
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
          w: R(cr.width),
          h: R(cr.height),
          top: R(cr.top),
          voidPx: R(cr.bottom - padB - bordB - contentBottom),
          cardW: card ? R(card.getBoundingClientRect().width) : null,
        };
      }),
    };
  }, sectionIndex);
}

/** 把逐列度量按**行**分组（同一行的列共享同一个 top 值）——用于判断行内是否被拉齐 */
function rowsOf(cols: Array<{ h: number; top: number }>): Array<Array<{ h: number; top: number }>> {
  const byTop = new Map<number, Array<{ h: number; top: number }>>();
  for (const c of cols) {
    const key = Math.round(c.top);
    const bucket = byTop.get(key);
    if (bucket) bucket.push(c);
    else byTop.set(key, [c]);
  }
  return [...byTop.values()];
}

/** DOM 次序：section.grid[0] = 成员任务三块，[1] = 看板列 */
const TRIAGE_SECTION = 0;
const KANBAN_SECTION = 1;

/** 新设计的两个定宽（与 MemberBoardPage 的两个常量同值；这里显式写数是为了让本 spec 能独立判红） */
const KANBAN_TRACK = 262;
/** 看板列盒内边距 30 = p-3.5(14×2) + .glass-light 边框(1×2) ⇒ 卡片宽 = 轨道 − 30 */
const KANBAN_CARD = 232;
const TRIAGE_TRACK = 340;

/** 页面无横向溢出（两条契约都要） */
async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflowX, `${label} 页面不应横向溢出`).toBeLessThanOrEqual(0);
}

describe.skipIf(!CAN_RUN_FRESH)(
  'Bug B · 成员看板列几何（真 Chromium，宽视口）——v1.0.x：看板列 262 / 任务三块 340 两条契约',
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

    it('B-01a · 看板列：轨道恒 262、默认窗口 1400 出 4 列、轨道宽不随容器宽增长', async () => {
      // 三个宽度一次测完：「反拉伸」只有在**同一轨道尺寸跨不同 section 宽**时才可判
      // （单宽度只能证明"恰好 262"，证明不了"不随容器增长"）。
      const measured: Array<{ vp: number; sectionW: number; tracks: number[] }> = [];
      for (const vp of [
        { w: 1400, h: 900, name: 'default-1400' },
        { w: 1600, h: 900, name: 'wide-1600' },
        { w: 1920, h: 1080, name: 'wide-1920' },
      ] as const) {
        const ctx: BrowserContext = await newContext(browser, { width: vp.w, height: vp.h });
        const page: Page = await ctx.newPage();
        try {
          await bootstrapAdminWithDemo(page, server.url);
          await enterMemberBoard(page);
          await page.waitForTimeout(400);

          const m = await columnMetrics(page, KANBAN_SECTION);
          expect(m.found, `${vp.name} 应找到「看板列」section`).toBe(true);
          expect(m.cols.length, `${vp.name}「看板列」应有列`).toBeGreaterThan(0);

          // ① 轨道数按定值 262 计（floor((W+16)/278)）：默认窗口 4 列、1600 ⇒ 4、1920 ⇒ 5
          const expected = Math.max(1, Math.floor((m.sectionW + 16) / (KANBAN_TRACK + 16)));
          expect(m.tracks.length, `${vp.name} 看板列轨道数应为 floor((section+16)/278) = ${expected}`).toBe(expected);
          if (vp.w === 1400) {
            expect(m.tracks.length, '默认窗口（1400 ⇒ section 1096）必须是 4 列——这是产品拍板的那一格').toBe(4);
          }

          // ② 轨道恒 262：既不被拉伸（>262），也不被压窄（<262）
          for (const [i, t] of m.tracks.entries()) {
            expect(t, `${vp.name} 看板第 ${i + 1} 轨应恒为 ${KANBAN_TRACK}（定宽 min=max，永不被拉伸）`).toBe(KANBAN_TRACK);
          }
          measured.push({ vp: vp.w, sectionW: m.sectionW, tracks: m.tracks });

          // ③ 旧契约里仍然有效的一件：列盒贴合内容（内部空洞 ≤2px）。
          //    ⚠️ 这条**只对看板列成立**（任务三块那一边被刻意拉伸，见 B-01b）。
          //    它同时是"看板列没被拉伸"的**零数据依赖**表达式：删掉 `items-start` 后，
          //    矮列的盒底会被拉到行底 ⇒ voidPx 立刻变成上百 px（见 B-01c 与 M3）。
          for (const [i, col] of m.cols.entries()) {
            expect(
              col.voidPx,
              `${vp.name} 看板第 ${i + 1} 列盒应贴合内容（内部空洞 ≤2px；被拉伸即红）`,
            ).toBeLessThanOrEqual(2);
          }

          // ④ 卡片跟着列走（撑满列宽 − 列盒内边距 30）
          const filled = m.cols.filter((c) => c.cardW !== null);
          expect(filled.length, `${vp.name} 至少一列应含项目卡`).toBeGreaterThan(0);
          for (const [i, col] of filled.entries()) {
            expect(col.cardW!, `${vp.name} 看板第 ${i + 1} 列卡片宽应为 轨道 − 30 = ${KANBAN_CARD}`).toBe(KANBAN_CARD);
          }

          await expectNoHorizontalOverflow(page, vp.name);
          await page.screenshot({
            path: resolve(__dirname, '..', 'qa-scratch', 'member-board-column-cap', `B-01a-${vp.name}.png`),
            fullPage: true,
          });
        } finally {
          await ctx.close();
        }
      }

      // ⑤ ★ 反拉伸（team-lead 点名的跨宽契约）：section 变宽 ⇒ 轨道**必须不变**。
      //    旧模板（`1fr` 或大上限）在宽档会把轨道抻大（1920 曾实测 448px）。
      //    ⚠️ 诚实登记：这条与 ② 的判别力**重叠** —— ② 已在每个宽度上要求「轨道恒 262」，
      //    凡轨道会被抻宽的写法都会先在 ② 处红；⑤ 只在「列数恰好对齐、但轨道宽度偷偷长」
      //    这种更窄的假想里成为第一红点。保留它是因为它是**跨宽**的表述（一条断言里同时
      //    看到 section 变宽与轨道不变），可读性上比逐宽断言更直接；不做独立判别力声明。
      const wide = measured.find((m) => m.vp === 1600)!;
      const wider = measured.find((m) => m.vp === 1920)!;
      expect(wider.sectionW, '1920 的 section 必须确实比 1600 宽（否则本断言无判别力）').toBeGreaterThan(wide.sectionW);
      expect(
        wider.tracks.slice(0, wide.tracks.length),
        `section 从 ${wide.sectionW} 增到 ${wider.sectionW}，轨道宽不得跟着变（反拉伸）`,
      ).toEqual(wide.tracks);
      // 且列数只允许增加（多出来的宽度用于**多一列**，不是把已有列抻宽）
      expect(wider.tracks.length, '更宽只应多出一列').toBeGreaterThan(wide.tracks.length);
    }, 180000);

    it('B-01b · 任务三块：轨道恒 340、默认窗口 3 轨并排、三块等高（2026-10-12 拍板）', async () => {
      const ctx: BrowserContext = await newContext(browser, { width: 1400, height: 900 });
      const page: Page = await ctx.newPage();
      try {
        await bootstrapAdminWithDemo(page, server.url);
        await enterMemberBoard(page);
        await page.waitForTimeout(400);

        const m = await columnMetrics(page, TRIAGE_SECTION);
        expect(m.found, '应找到「任务三块」section').toBe(true);
        expect(m.cols.length, '任务三块应有 3 块').toBe(3);

        // 旧数字：同一档位下任务三块走 340/360 定值 max ⇒ floor((1096+16)/376) = **2 轨**
        // （两块一行、第三块换行）。新数字：定宽 340 ⇒ floor(1112/356) = **3 轨** ⇒ 三块一处并排。
        expect(m.tracks.length, '默认窗口（section 1096）任务三块必须是 3 轨并排（旧：2 轨）').toBe(3);
        for (const [i, t] of m.tracks.entries()) {
          expect(t, `任务三块第 ${i + 1} 轨应恒为 ${TRIAGE_TRACK}（定宽 min=max，永不被拉伸）`).toBe(TRIAGE_TRACK);
        }

        /*
         * ★ 纵向：三块**等高**（2026-10-12 用户拍板；旧断言是「列盒贴合内容 voidPx ≤ 2」，本批换掉）。
         *
         * 旧断言 → 新断言 → 为什么：
         *   · 旧：`col.voidPx ≤ 2`「列盒应贴合内容」——量的是「盒底缘 − 最后子元素底缘」。
         *     它**对任务三块不再成立**：三块被刻意拉伸到行高后，矮的两块底部必然留白
         *     （实测 1400 档：已逾期空洞 767.5、近期完成 600、最高的进行中 0）——
         *     那不是"盒子没贴合"，那**正是设计意图**。
         *   · 新：三块盒高**逐项相等**（容差 1px）**且都等于三块里的最大值**。
         *     "等于最大值"这一半是必要的：只要求"彼此相等"的话，三块一起塌成 0 高也算过；
         *     而"都等于最大值"同时钉住了「没有被压扁」与「确实被拉齐到最高块」。
         *   · 为什么这么定：用户 2026-10-12 附截图圈出三块下方的两片空洞，拍板「三块等高」；
         *     判据是**这一格代表排版**（分类面板并排 ⇒ 底边对齐是意图），而看板列那一边
         *     每格代表**数据**（项目卡 ⇒ 高度随信息量，禁止拉伸）——两条方向相反、同时成立，
         *     守闸见 B-01c。详见 `MemberBoardPage.tsx` 两个 section 的注释。
         */
        const heights = m.cols.map((c) => c.h);
        const maxH = Math.max(...heights);
        expect(heights.length, '应有 3 块的高度可量').toBe(3);
        for (const [i, h] of heights.entries()) {
          expect(
            Math.abs(h - maxH),
            `任务三块第 ${i + 1} 块盒高应等于三块最大值 ${maxH}（实测各块 ${heights.join(' / ')}；不等高即用户 2026-10-12 圈出的空洞）`,
          ).toBeLessThanOrEqual(1);
        }
        // 逐对比较也写出来：失败时能直接看到是哪两块不一致
        for (let i = 0; i < heights.length; i += 1) {
          for (let j = i + 1; j < heights.length; j += 1) {
            expect(
              Math.abs(heights[i] - heights[j]),
              `任务三块第 ${i + 1} 块与第 ${j + 1} 块盒高差应 ≤1px（实测 ${heights[i]} vs ${heights[j]}）`,
            ).toBeLessThanOrEqual(1);
          }
        }

        await expectNoHorizontalOverflow(page, 'default-1400 任务三块');
        await page.screenshot({
          path: resolve(__dirname, '..', 'qa-scratch', 'member-board-column-cap', 'B-01b-default-1400.png'),
          fullPage: true,
        });
      } finally {
        await ctx.close();
      }
    }, 120000);

    it('B-01c · 守闸：两条纪律方向相反且同时成立（看板列不许被拉齐 / 任务三块必须等高）', async () => {
      /*
       * ★ 这一条是防「顺手统一」的守闸。两个 section 的 `align-items` 刻意相反：
       *     · 看板列（`BOARD_COLUMN_TEMPLATE`）**必须** `items-start`（计算值 `flex-start`）——
       *       每格是一张**项目卡**，「卡片高度是数据该有的样子」，**禁止**拉伸填满列高
       *       （历史教训：反馈 #10.4 那批窄卡报废之外，宽窗"卡片被抻高 + 下半空白"也是这么来的）；
       *     · 任务三块（`TRIAGE_COLUMN_TEMPLATE`）**刻意不带** `items-start`（计算值 `normal`,
       *       即 grid 默认 `stretch`）—— 每格是一块**分类面板**，等高是**排版意图**。
       *   判据只有一条：「**这一格代表数据，还是代表排版？**」数据 ⇒ 不拉伸；排版 ⇒ 等高。
       *
       * ⚠️ 为什么把结构（计算样式）也钉住，而不只量高度：**"看板列各列高不全相等"这个写法
       *   本身是假绿的**。见 B-01c 的行为佐证那段注释 —— 变异 M2 下（看板列被拉齐）仍然成立。
       */
      const ctx: BrowserContext = await newContext(browser, { width: 1400, height: 900 });
      const page: Page = await ctx.newPage();
      try {
        await bootstrapAdminWithDemo(page, server.url);
        await enterMemberBoard(page);
        await page.waitForTimeout(400);

        const kanban = await columnMetrics(page, KANBAN_SECTION);
        const triage = await columnMetrics(page, TRIAGE_SECTION);
        expect(kanban.found && triage.found, '两个 section 都应找到').toBe(true);

        // ① 结构不变式（零数据依赖）：看板列顶对齐、任务三块拉齐
        expect(
          kanban.align,
          '看板列必须保留 `items-start`（每格是项目卡：卡片高度是数据该有的样子，不许被拉伸填满列高）',
        ).toBe('flex-start');
        expect(
          triage.align,
          '任务三块必须**不带** `items-start`（每格是分类面板：等高是排版意图）',
        ).not.toBe('flex-start');

        // ② 行为佐证 A：看板列**行内不被拉齐**
        //    （结构对了但被别的 CSS 覆盖时，这一条会先红）
        const kanbanRows = rowsOf(kanban.cols);
        expect(kanbanRows.length, '看板列应至少排成 2 行（否则本断言无判别力）').toBeGreaterThanOrEqual(2);
        const unevenRows = kanbanRows.filter((r) => new Set(r.map((c) => c.h)).size > 1);
        expect(
          unevenRows.length,
          '看板列应存在「行内各列盒高不等」的行（每列贴合自己的内容）；若所有行都被拉齐 = items-start 被删',
        ).toBeGreaterThanOrEqual(1);

        // ③ 行为佐证 B：任务三块**行内被拉齐**（同一行内三块等高）
        const triageRows = rowsOf(triage.cols);
        expect(triageRows.length, '任务三块应排在同一行').toBe(1);
        expect(
          new Set(triageRows[0].map((c) => c.h)).size,
          `任务三块同一行内盒高应只有一个取值（实测 ${triageRows[0].map((c) => c.h).join(' / ')}）`,
        ).toBe(1);

        await page.screenshot({
          path: resolve(__dirname, '..', 'qa-scratch', 'member-board-column-cap', 'B-01c-guard-1400.png'),
          fullPage: true,
        });
      } finally {
        await ctx.close();
      }
    }, 120000);
  },
);
