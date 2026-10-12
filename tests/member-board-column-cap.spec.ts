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
 * **gen4（上一版）**：两处解耦、各用各的**定宽**（`max` = `min`）：
 *   · 看板列 `262px`（headless 1096 下 4 列）；· 任务三块 `340px`（3 轨）。
 *   ⚠️ gen4 在 **headless 的 1096** 成立，但**真机是 1088**（少一条 8px 纵向滚动条）⇒
 *   `floor(1104/278) = 3` ⇒ 用户看到 3 列（**他报的 bug**）。定宽还留下两个副作用：
 *   余量靠 `justify-center` 消化 ⇒ 看板列左边缘 143、任务三块 26，**都与统计卡不齐**（"不工整"）。
 *
 * **gen5（本版，2026-10-13）**：两处都改成 `repeat(auto-fit, minmax(min(100%, base), 1fr))`
 * 并删掉 `justify-center`：
 *   · 看板列 `base = 245`：门槛 `4×245 + 3×16 = 1028 ≤ 1088` ⇒ **真机 4 列**（余量 60px）；
 *     轨道由 `1fr` **均分该行** ⇒ 1088 下每轨 **260**、卡片 **230**、内容宽 **182**；
 *     **轨道恒 ≥ 245**（4 轨成立的前提）。
 *   · 任务三块 `base = 340`：真机 1088 ⇒ `floor(1104/356) = 3` 轨 × **352**（铺满整行）。
 *   · 两处左边缘都落在 **272** = 统计卡左缘（"工整"的可测定义）。
 *
 * **契约变更（必须点名，因为它把一条旧断言作废了）**：
 *   gen4 的跨宽契约是「**轨道宽不随容器宽增长**」；gen5 用 `1fr` ⇒ 轨道**会**随 section
 *   变宽而变宽（这是"铺满该行 ⇒ 左边缘对齐"的目的）。⇒ 旧 ⑤ 整条重定成三条：
 *   列数按 `floor((section+16)/261)`、每轨 ≥ 245 且行内等宽、更宽 ⇒ 轨道更宽且列数不减。
 *   旧数字「列宽 ≥339（卡片设计宽护城河）」对看板列早已作废（gen4 起就是 262/232），
 *   护城河的**本意**（卡内不许报废）由 `tests/member-board-narrow-card.spec.ts` 的
 *   **卡内逐元素断言**承接（到期日不截断 / 胶囊不折行 / 头像不越界 / 无纵向溢出），
 *   并在 gen5 的**最坏轨道 245**（N-02b）上补测 —— 那一格旧设计从没测过。
 *
 * 本 spec 的职责（三条契约，各自给数）：
 *   B-01a 看板列（gen5）：真机 1088 ⇒ **4 列 × 260**、每轨 ≥ 245、行内等宽、`justify-center` 已去、
 *         列盒贴合内容（`voidPx ≤ 2`）、卡片 = 轨道 − 30、页面无横向溢出；另含跨宽三条（见上）
 *   B-01b 任务三块：真机 1088 ⇒ **3 轨 × 352**、每轨 ≥ 340、**三块等高**（2026-10-12 拍板）
 *   B-01c 守闸：**两条纪律方向相反且同时成立** —— 看板列不许被拉齐、任务三块必须等高
 *   「**列盒贴合内容**（内部空洞 ≤2px）」只留给 **B-01a**：看板列每列贴合自己的内容，
 *   它正是"看板列没被纵向拉伸"的**零数据依赖**表达式（任务三块那一边刻意不贴合，见 B-01b）。
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
 *   M1 · **gen4 时代**的变异：只把 `BOARD_COLUMN_TEMPLATE` 退回 gen3 `340/360`：
 *     当时 **B-01a 红** —— 红点是 `默认窗口 1400 看板列轨道数应为 floor((section+16)/278) = 4`，
 *     实测 **2**。（gen5 重定后这条断言的文字已换成 `floor((section+16)/261)`，
 *     但判别力同源：模板退回大基准 ⇒ 列数不足 ⇒ 红点仍在列数那一句。）
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
 *   ── gen5 批次（2026-10-13）的变异自证（三条都做；每次还原后产物 md5 逐字节一致）──
 *     M4 · 看板退回 `262/262` ⇒ **B-01a 红**：`realwindow-1392 看板列轨道数应为
 *          floor((section+16)/261) = 4: expected 3 to be 4`（另带 narrow 4 条 + layout 2 条）。
 *     M5 · 任务三块退回定值 `340/340` ⇒ **B-01b 红**：`任务三块第 1 轨应为 (1088−32)/3 = 352
 *          （1fr 均分）: expected 340 to be 352`。
 *          ⚠️ team-lead 预期这条打中「左边缘对齐」，**实测没红** —— 删掉 `justify-center` 后，
 *          定值模板的余量被甩到**右侧**，左边缘照样与统计卡齐平。⇒「铺满」只能靠
 *          **Σ轨道 + (n−1)×gap = section 宽** 判定（B-01a ⑥ / B-01b 里已补，M5 也红在那一条的下游）。
 *     M6 · 看板基准 `245 → 262`（保留 `1fr`）⇒ **B-01a 红**，红点同 M4。
 *   ⚠️ 编号对照（避免误读）：team-lead 上一批派单里点名的「M1 = 把 `items-start` 加回任务三块」
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
  justify: string;
}> {
  return page.evaluate((idx: number) => {
    const R = (n: number): number => Math.round(n * 10) / 10;
    const sections = Array.from(document.querySelectorAll('section.grid'));
    const sec = sections[idx];
    if (!sec) return { found: false, cols: [], tracks: [], sectionW: 0, align: '', justify: '' };
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
      /** gen5 删掉了 `justify-center`：`1fr` 下没有余量可居中，留着会掩盖"轨道没铺满" */
      justify: getComputedStyle(sec).justifyContent,
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
/** gen5：看板列的**基准**（`minmax(min(100%, 245px), 1fr)` 的 min）；轨道恒 ≥ 它 */
const KANBAN_BASE = 245;
/** 看板列盒内边距 30 = p-3.5(14×2) + .glass-light 边框(1×2) ⇒ 卡片宽 = 轨道 − 30 */
const COL_BOX_PAD = 30;
const TRIAGE_BASE = 340;
/** 真机默认窗口的 section 宽 = 窗口 1400 − Chrome 纵向滚动条 8 − 侧栏 240 − 内边距 64 */
const USER_SECTION_W = 1088;
/** 真机同宽探针视口 = 1400 − 8（headless 是 overlay 滚动条，占 0px） */
const VP_REAL_WINDOW = 1392;
/** 真机同宽实测：轨道 260（= (1088 − 3×16)/4） */
const TRACK_REAL = 260;

/** 页面无横向溢出（两条契约都要） */
async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflowX, `${label} 页面不应横向溢出`).toBeLessThanOrEqual(0);
}

describe.skipIf(!CAN_RUN_FRESH)(
  'Bug B · 成员看板列几何（真 Chromium）——gen5：看板列 245/1fr、任务三块 340/1fr（含 B-01c 守闸）',
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

    it('B-01a · 看板列（gen5）：真机 1088 下 4 列、轨道 ≥ 基准 245、行内等宽、左边缘与统计卡对齐', async () => {
      /*
       * ★ gen5 把「轨道恒 262 / 不随容器宽增长」这条**主动作废**了 —— 换成 `1fr` 后
       *   轨道**会**随 section 变宽而变宽（这是"铺满该行 ⇒ 左边缘对齐"的代价与目的）。
       *   新的跨宽契约是三条：① 每档列数 = `floor((section+16)/261)`（按基准 245 计数）；
       *   ② 每档每轨 ≥ 基准 245（`1fr` 不会低于 min）且**行内等宽**；
       *   ③ 更宽 ⇒ 轨道更宽、列数不减（旧的"不变"改成"按公式变"）。
       * ⚠️ 旧 ⑤「轨道宽不得跟着变」若照抄，会在 gen5 下**必然红**（那是旧口径的断言），
       *   故本条整体重定；看板列真正要守的东西（不许被纵向拉伸、列盒贴合内容）留在 ③。
       */
      const measured: Array<{ vp: number; sectionW: number; tracks: number[] }> = [];
      for (const vp of [
        { w: VP_REAL_WINDOW, h: 900, name: 'realwindow-1392' },
        { w: 1332, h: 900, name: 'worst-1332' },
        { w: 1320, h: 900, name: 'below-threshold-1320' },
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

          // ① 列数按**基准 245** 计（`1fr` 是"不定 max" ⇒ 计数退回 min）
          const expected = Math.max(1, Math.floor((m.sectionW + 16) / (KANBAN_BASE + 16)));
          expect(
            m.tracks.length,
            `${vp.name} 看板列轨道数应为 floor((section+16)/261) = ${expected}`,
          ).toBe(expected);

          // ② 每轨 ≥ 基准、行内等宽
          for (const [k, t] of m.tracks.entries()) {
            expect(t, `${vp.name} 看板第 ${k + 1} 轨不得低于基准 ${KANBAN_BASE}`).toBeGreaterThanOrEqual(KANBAN_BASE);
          }
          expect(
            new Set(m.tracks.map((t) => Math.round(t))).size,
            `${vp.name} 行内各轨应等宽（1fr 均分该行），实测 ${JSON.stringify(m.tracks)}`,
          ).toBe(1);

          // ③ 列盒贴合内容（看板列**不许**被纵向拉伸；删 items-start 即红，见 B-01c）
          for (const [k, col] of m.cols.entries()) {
            expect(
              col.voidPx,
              `${vp.name} 看板第 ${k + 1} 列盒应贴合内容（内部空洞 ≤2px；被拉伸即红）`,
            ).toBeLessThanOrEqual(2);
          }

          // ④ 卡片跟着轨道走（撑满轨道 − 列盒内边距 30）
          //    ⚠️ 用容差而不是相等：`1fr` 均分出来的轨道宽可能是**小数**（1920 档实测 262.4），
          //    卡片宽随之是 232.4 —— 那是正确的"铺满"，不是误差。
          const filled = m.cols.filter((c) => c.cardW !== null);
          expect(filled.length, `${vp.name} 至少一列应含项目卡`).toBeGreaterThan(0);
          for (const [k, col] of filled.entries()) {
            expect(
              Math.abs(col.cardW! - (m.tracks[0] - COL_BOX_PAD)),
              `${vp.name} 看板第 ${k + 1} 列卡片宽应为 轨道 − 30 = ${Math.round((m.tracks[0] - COL_BOX_PAD) * 10) / 10}，实测 ${col.cardW}`,
            ).toBeLessThanOrEqual(1);
          }

          // ⑤ gen5：`justify-center` 已删（`1fr` 铺满该行 ⇒ 没有余量可居中）
          expect(m.justify, `${vp.name} 看板列不应再有 justify-center（1fr 下无余量可居中）`).not.toBe('center');

          /*
           * ⑥ ★「铺满该行」的可测定义（这才是"工整"的实质，也是**定值模板的判红点**）：
           *      Σ轨道 + (n−1)×gap === sectionW（容差 1px）
           *    ⚠️ 别用"左边缘对齐"去判定值模板会不会破 —— 删掉 `justify-center` 之后，
           *    `justify-content: normal` 会把余量甩到**右侧**，左边缘**照样对齐**（实测：
           *    定值 340 时三块左缘仍是 272）。真正会露馅的是"没铺满"这一条。
           */
          const filledW = m.tracks.reduce((a, t) => a + t, 0) + (m.tracks.length - 1) * 16;
          expect(
            Math.abs(filledW - m.sectionW),
            `${vp.name} 轨道之和 + 间隙应为 section 宽（铺满该行），实测 ${Math.round(filledW * 10) / 10} vs ${m.sectionW}`,
          ).toBeLessThanOrEqual(1);

          if (vp.w === VP_REAL_WINDOW) {
            expect(m.sectionW, `真机同宽下 section 应为 ${USER_SECTION_W}`).toBe(USER_SECTION_W);
            expect(m.tracks.length, '真机 1088 必须是 **4 列** —— 这就是用户报的 bug 那一格').toBe(4);
            for (const [k, t] of m.tracks.entries()) {
              expect(t, `真机同宽第 ${k + 1} 轨应为 ${TRACK_REAL}`).toBe(TRACK_REAL);
            }
          }
          if (vp.w === 1332) {
            // 临界格：section 1028 = 4×245 + 3×16 ⇒ 4 轨、每轨正好等于基准
            expect(m.sectionW, '视口 1332 ⇒ section 1028（4 轨的临界宽）').toBe(1028);
            expect(m.tracks.length, '临界宽下仍应 4 轨').toBe(4);
            for (const [k, t] of m.tracks.entries()) {
              expect(t, `临界宽第 ${k + 1} 轨应正好是基准 ${KANBAN_BASE}`).toBe(KANBAN_BASE);
            }
          }
          if (vp.w === 1320) {
            // 判别性：section 1016 < 1028 ⇒ 必须掉成 3 轨（证明 1088 的 4 列不是撞上的）
            expect(m.sectionW, '视口 1320 ⇒ section 1016 < 1028').toBe(1016);
            expect(m.tracks.length, '门槛以下必须掉成 3 轨（证明门槛就在 1028）').toBe(3);
          }

          measured.push({ vp: vp.w, sectionW: m.sectionW, tracks: m.tracks });
          await expectNoHorizontalOverflow(page, vp.name);
          await page.screenshot({
            path: resolve(__dirname, '..', 'qa-scratch', 'member-board-column-cap', `B-01a-${vp.name}.png`),
            fullPage: true,
          });
        } finally {
          await ctx.close();
        }
      }

      /*
       * ⑥ ★ 跨宽契约（gen5 版）：更宽 ⇒ 轨道**更宽**、列数不减、且每档都 ≥ 基准。
       *    （旧版这条写的是「轨道必须不变」——那是 `min=max` 时代的契约，`1fr` 下已作废。）
       */
      const real = measured.find((m) => m.vp === VP_REAL_WINDOW)!;
      const wide = measured.find((m) => m.vp === 1920)!;
      expect(wide.sectionW, '1920 的 section 必须确实更宽（否则本断言无判别力）').toBeGreaterThan(real.sectionW);
      expect(wide.tracks.length, '更宽只应多列（不得少列）').toBeGreaterThanOrEqual(real.tracks.length);
      expect(
        wide.tracks[0],
        `更宽的 section 下轨道应更宽（1fr 均分），实测 ${real.tracks[0]} → ${wide.tracks[0]}`,
      ).toBeGreaterThan(real.tracks[0]);
      for (const m of measured) {
        expect(m.tracks[0], `vp ${m.vp} 的轨道不得低于基准 ${KANBAN_BASE}`).toBeGreaterThanOrEqual(KANBAN_BASE);
      }
    }, 240000);

    it('B-01b · 任务三块（gen5）：真机 1088 下 3 轨 × 352 铺满整行、三块等高', async () => {
      const ctx: BrowserContext = await newContext(browser, { width: VP_REAL_WINDOW, height: 900 });
      const page: Page = await ctx.newPage();
      try {
        await bootstrapAdminWithDemo(page, server.url);
        await enterMemberBoard(page);
        await page.waitForTimeout(400);

        const m = await columnMetrics(page, TRIAGE_SECTION);
        expect(m.found, '应找到「任务三块」section').toBe(true);
        expect(m.cols.length, '任务三块应有 3 块').toBe(3);

        // gen5 数字：真机 section 1088、基准 340 + `1fr` ⇒ floor(1104/356) = **3 轨**、
        // 每轨 (1088 − 2×16)/3 = **352** ⇒ 三块一行**铺满整行**，左边缘落在 272（与统计卡齐平）。
        // 旧数字（gen4）：定值 340 ⇒ floor(1112/356) = 3 轨、每轨恒 340、余 36 被 justify-center 居中。
        expect(m.sectionW, `真机同宽下 section 应为 ${USER_SECTION_W}`).toBe(USER_SECTION_W);
        expect(m.tracks.length, '任务三块在真机 1088 下必须是 3 轨并排').toBe(3);
        for (const [i, t] of m.tracks.entries()) {
          expect(t, `任务三块第 ${i + 1} 轨应为 (1088−32)/3 = 352（1fr 均分）`).toBe(352);
          expect(t, `任务三块第 ${i + 1} 轨不得低于基准 ${TRIAGE_BASE}`).toBeGreaterThanOrEqual(TRIAGE_BASE);
        }
        expect(m.justify, '任务三块不应再有 justify-center').not.toBe('center');
        // 「三块铺满整行」的可测定义：Σ轨道 + 2×gap = section 宽（容差 1px）。
        // ⚠️ 这条是**定值模板（`340/340`）的判红点** —— 删掉 `justify-center` 后余量甩到右侧，
        // 左边缘仍对齐，故只有"有没有铺满"能区分 `1fr` 与定值（M5 就红在这一条）。
        const filled = m.tracks.reduce((a, t) => a + t, 0) + (m.tracks.length - 1) * 16;
        expect(
          Math.abs(filled - m.sectionW),
          `三块轨道之和 + 间隙应铺满 section（实测 ${Math.round(filled * 10) / 10} vs ${m.sectionW}）`,
        ).toBeLessThanOrEqual(1);

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
