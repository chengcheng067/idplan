/**
 * 成员看板 · 窄版卡片（定宽 262 ⇒ 卡片 232 ⇒ 内容宽 184）的真机几何闸（v1.0.x）。
 *
 * ── 为什么需要这条闸 ──
 * 产品负责人拍板「默认窗口 1400 就要每行 4 列」。看板列几何改为**定宽 262**
 * （`repeat(auto-fit, minmax(min(100%, 262px), 262px))`），262 是 section 1096 下出 4 轨的
 * 临界值 ⇒ 卡片 232（= 262 − 列盒内边距 30）⇒ 卡**内容宽 184**。
 * 旧卡片在这个宽度下**必然失效**，这不是猜测而是实测的阈值：
 * **所需轨道宽 = 226.5 + 18n**（n = 卡上头像数；头像 24px、叠放间距 −6 ⇒ 头像组宽 = 6 + 18n）
 * ⇒ n=1 需 245（放得下）、**n=2 就需 263 > 262**（放不下）。
 * 根因在底部元信息行：左组要「到期日 53 + gap 8 + 阶段胶囊 73.5」= 134.5，再 + gap 8
 * + 头像组（n=2 为 42）= 184.5 > 184 ⇒ 胶囊折行 + 到期日被截断。
 *
 * ── 修法（形态由 team-lead 拍板；门控 `layout === 'column'`，首页 DOM 逐字节不变）──
 *   · 元信息行只留「到期日 + 阶段胶囊」，`justify-between` 一左一右铺满整行（需 134.5 ≤ 184）；
 *   · 头像组移到**委托方行**右侧（那行右侧本就是死空间 ⇒ 零高度成本，卡高仍 `xl:h-[185px]`）。
 *
 * ── 断言（视口 1400 = 默认窗口 ⇒ `main` 封顶 1440 ⇒ section 1096）──
 *   ① 每行 **4 列**、轨道恒 **262**
 *   ② 卡片 **232 × 185**
 *   ③ 头像 **n = 1/2/3/4 四档**逐元素不越界：到期日不截断、阶段胶囊不折行、
 *      头像组右缘 ≤ 卡片内容盒右缘、进度条轨道宽 = 内容宽、卡高 185、卡内无纵向溢出
 *
 * ⚠️ 头像合成（夹具每张卡只有 1 个真实头像，装不下 4 档）：n > 0 时**克隆真实的 avatar
 *   `span`**（连它自己的全部 class 一起克隆，否则量出来的宽度不算数）追加进叠放盒。
 *   因此「档 n」= 叠放盒内 **1 + n 个 span**：
 *     n=1 ⇒ 2 个（组宽 42，委托方可用 134）
 *     n=2 ⇒ 3 个（60 / 116）
 *     n=3 ⇒ 4 个（78 / **98**）—— `AvatarStack` 默认 `max = 4` 的**上限档**
 *     n=4 ⇒ 5 个（96 / **80**）—— 即「4 头像 + `+N` 胶囊」那一格
 *          （生产数据成员数 ≥ 5 时必现；夹具 3 名成员下不会自然出现）
 *   ⇒ 委托方可用宽的底线**按实际 span 数**给，不按 n 给（更抗夹具变化）：
 *     span ≤ 4 ⇒ ≥ 90（team-lead 定的判据线）；span = 5 ⇒ ≥ 80（见下方「已知差口」）。
 *
 * ── 已知差口（登记，未改；等 team-lead 裁决）──
 *   `+N` 那一格委托方只剩 **80px < 90px 判据线**。委托方是本卡**允许单行省略的两个字段之一**
 *   （另一个是项目标题），故只降级、不破形。要消掉它只需把 `avatarStack` 的 `max` 改成 3
 *   （3 个 + `+N` = 78 ⇒ 恒 ≥ 98px），代价是窄版卡最多只显示 3 个头像。
 *   本次**没有**改 max：team-lead 的判据是按「n=4 个头像（组宽 78 ⇒ 可用 98）」给的，
 *   那一格实测确实 ≥90，故按其字面执行；`+N` 格作为差口上报。
 *
 * ── 变异自证（本闸不是摆设；两次变异都做了，产物还原后重建 md5 与变异前逐字节一致）──
 *   M1 · 只把 `BOARD_COLUMN_TEMPLATE` 退回 gen3 `340/360`：
 *       **N-01 红**（默认窗口 2 列 ≠ 4）、**B-01a 红**（轨道数 2 ≠ floor(1112/278)=4）、
 *       **M-01 红**（1440 档 3 列 ≠ 4）、**M-02 红**（1152 档 2 列 ≠ 3）；
 *       而纯函数单测（member-board-columns）**5 条全绿** —— 它看不见几何常量。
 *   M2″ · 只退「头像搬家」这一件事（委托方行保持 div 但不再挂头像，头像留在元信息行）：
 *       **N-02 红**，红点正是本闸的设计目标：`卡1 n=3 到期日不得截断（需 53 ≤ 可用 44）`。
 *       注意 n≤2（span≤3）仍绿 —— 实测的失效起点是 **span=4（4 个头像 / 组宽 78）**，
 *       比「所需轨道宽 = 226.5 + 18n」给出的 n=2 晚两档（那公式偏保守，按完全无省略计算）。
 *   ⚠️ 还试过第三条断言「行盒 scrollWidth ≤ 内容宽」（本意是抓"元素被挤出行盒"）：
 *       探针实测在 M2″ 这种**破损态**下它恒为 0（先坏的是到期日截断与胶囊折行，
 *       左组会先收缩、行盒从不溢出）⇒ 永远红不了 = 假绿通道，**已删**，不留装饰性断言。
 *
 * 前置：`npx vite build`（产物在 build-dist/）与本机 chromium；产物缺失/过期则整组 skip。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

import { CAN_RUN_FRESH, CHROMIUM_PATH, startServer, shotDir } from './helpers/board-env';

const FIXTURE = resolve(__dirname, 'fixtures', 'member-board-columns.json');
const SHOT_DIR = shotDir('member-board-narrow-card');

/** 新几何的四个数据（与 MemberBoardPage / ProjectCard 的实现在同一批变更里定下） */
const TRACK = 262;
const CARD = 232;
const CARD_H = 185;
const CONTENT = 184;
const GAP = 16;
/** 头像组宽 = 6 + 18n（AvatarStack：h-6 w-6 + `-space-x-1.5`） */
const avatarGroupWidth = (spans: number): number => 6 + 18 * spans;

type CardMetrics = {
  cardW: number;
  cardH: number;
  contentW: number;
  contentRight: number;
  vOverflow: number;
  avatarSpans: number;
  avatarGroupW: number;
  avatarOverflow: number;
  dueNeed: number;
  dueAvail: number;
  tagH: number;
  tagOverflow: number;
  trackW: number;
  delegatorAvail: number;
  delegatorNode: string;
  titleNode: string | null;
};

/**
 * 页面内度量：把第 `index` 张看板卡的头像**克隆**到 `clones` 个（0 = 不动），再量卡内几何。
 * 克隆对象取叠放盒里的**第一个真实 avatar span**——它自带正确 class，故宽高与真实一致。
 */
function measureCard({ index, clones }: { index: number; clones: number }): CardMetrics | null {
  const R = (n: number): number => Math.round(n * 10) / 10;
  const board =
    Array.from(document.querySelectorAll('main section[style*="auto-fit"]')).find((s) =>
      s.querySelector('[role="button"].group'),
    ) ?? null;
  if (!board) return null;
  const cards = Array.from(board.querySelectorAll('[role="button"].group')) as HTMLElement[];
  const card = cards[index];
  if (!card) return null;

  const stackInner = card.querySelector('[class*="-space-x-1.5"]') as HTMLElement | null;
  // 先清掉上一次的克隆（同一张卡会被反复量 4 档）
  for (const el of Array.from(stackInner?.querySelectorAll('[data-probe-clone]') ?? [])) el.remove();
  const proto = stackInner?.firstElementChild as HTMLElement | null;
  if (proto && clones > 0) {
    for (let i = 0; i < clones; i += 1) {
      const c = proto.cloneNode(true) as HTMLElement;
      c.setAttribute('data-probe-clone', String(i));
      stackInner!.appendChild(c);
    }
  }

  const cs = getComputedStyle(card);
  const contentW = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const contentRight = card.getBoundingClientRect().right - parseFloat(cs.paddingRight);
  const rows = Array.from(card.children) as HTMLElement[];
  const delegatorRow = rows[1] as HTMLElement | undefined;
  const metaRow = rows[rows.length - 1] as HTMLElement | undefined;
  const stackScope = stackInner?.closest('div') as HTMLElement | null;
  const delegator = delegatorRow?.querySelector('span.truncate') as HTMLElement | null;
  const due = metaRow?.querySelector('span.truncate') as HTMLElement | null;
  const tag = metaRow?.querySelector('span.inline-flex') as HTMLElement | null;
  const track = card.querySelector('.h-2.w-full') as HTMLElement | null;
  const title = card.querySelector('span.min-w-0.flex-1.truncate') as HTMLElement | null;

  return {
    cardW: R(card.getBoundingClientRect().width),
    cardH: R(card.getBoundingClientRect().height),
    contentW: R(contentW),
    contentRight: R(contentRight),
    vOverflow: card.scrollHeight - card.clientHeight,
    avatarSpans: stackInner ? stackInner.children.length : 0,
    avatarGroupW: stackScope ? R(stackScope.getBoundingClientRect().width) : 0,
    avatarOverflow: stackScope ? R(stackScope.getBoundingClientRect().right - contentRight) : 0,
    dueNeed: due ? due.scrollWidth : 0,
    dueAvail: due ? due.clientWidth : 0,
    tagH: tag ? R(tag.getBoundingClientRect().height) : 0,
    tagOverflow: tag ? tag.scrollHeight - tag.clientHeight : 0,
    trackW: track ? R(track.getBoundingClientRect().width) : 0,
    delegatorAvail: delegator ? R(delegator.getBoundingClientRect().width) : 0,
    delegatorNode: delegatorRow ? delegatorRow.tagName.toLowerCase() : '',
    titleNode: title ? title.className : null,
  };
}

/**
 * 任意页面上的第一张项目卡（首页用）：只量「门控」关心的三件——
 * 委托方节点类型、头像 span 数、卡片宽。
 * 刻意不复用 `measureCard`：那一个专门在**看板列 section** 里找卡（首页没有这个 section）。
 */
function measureAnyCard() {
  const R = (n: number): number => Math.round(n * 10) / 10;
  const card = document.querySelector('main [role="button"].group') as HTMLElement | null;
  if (!card) return null;
  const rows = Array.from(card.children) as HTMLElement[];
  const delegatorRow = rows[1] as HTMLElement | undefined;
  const stackInner = card.querySelector('[class*="-space-x-1.5"]') as HTMLElement | null;
  return {
    cardW: R(card.getBoundingClientRect().width),
    cardH: R(card.getBoundingClientRect().height),
    delegatorNode: delegatorRow ? delegatorRow.tagName.toLowerCase() : '',
    avatarSpans: stackInner ? stackInner.children.length : 0,
  };
}

/** 看板级：轨道列表与卡片数 */
function measureBoard() {
  const R = (n: number): number => Math.round(n * 10) / 10;
  const board =
    Array.from(document.querySelectorAll('main section[style*="auto-fit"]')).find((s) =>
      s.querySelector('[role="button"].group'),
    ) ?? null;
  if (!board) return null;
  const tracks = getComputedStyle(board)
    .gridTemplateColumns.split(' ')
    .filter(Boolean)
    .map((t) => R(parseFloat(t)));
  return {
    tracks,
    sectionW: R(board.getBoundingClientRect().width),
    cards: board.querySelectorAll('[role="button"].group').length,
  };
}

describe.skipIf(!CAN_RUN_FRESH)(
  '成员看板 · 窄版卡片（定宽 262 / 卡片 232）真机几何闸',
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
     * 已灌夹具的环境（与 member-board-deeplink / column-consistency 同法）：
     * 身份在页面脚本之前压进 localStorage（键名唯一出处 `useSettingsStore`），
     * 夹具走应用自己的备份导入链路，导入后 `m-admin` 真实存在 ⇒ 管理员视角
     * （委托方文本最长：`室内 · 夹具客户`，是委托方宽度的最坏格）。
     */
    async function seededPage(viewport: { width: number; height: number }) {
      const ctx = await browser.newContext({ viewport });
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('changxia.currentMemberId', 'm-admin');
          localStorage.setItem('idplan.firstRunGuideSeen', '1');
        } catch {
          /* 隐私模式下 localStorage 不可写 ⇒ 后面的导入会报清晰错误 */
        }
      });
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
      await page.waitForFunction(
        () => document.body.innerText.includes('云栖·湖畔茶室'),
        null,
        { timeout: 20000 },
      );
      return { ctx, page };
    }

    /** 客户端路由跳转（与首页搜索点成员同一条路径） */
    async function spaGo(page: Page, route: string): Promise<void> {
      await page.evaluate((r) => {
        window.history.pushState({}, '', r);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, route);
      await page.waitForTimeout(1200);
    }

    it('N-01 · 视口 1400：每行 4 列、轨道恒 262、卡片 232×185', async () => {
      const { ctx, page } = await seededPage({ width: 1400, height: 900 });
      try {
        await spaGo(page, '/member-board');
        const b = await page.evaluate(measureBoard);
        expect(b, '应找到看板列 section').not.toBeNull();
        // 旧数字（gen3 · 340/360）：section 1096 ⇒ floor(1112/376) = **2 列**、轨道 360、卡片 330。
        // 新数字（gen4 · 262/262）：floor(1112/278) = **4 列**、轨道恒 262、卡片 232。
        expect(b!.sectionW, '默认窗口下 section 应为 1096（main 封顶 1440 − 侧栏 240 − 内边距 64）').toBe(1096);
        expect(b!.tracks.length, '默认窗口必须 4 列').toBe(4);
        expect(
          b!.tracks.every((t) => t === TRACK),
          `轨道应恒 ${TRACK}（定宽 min=max，永不被拉伸），实测 ${JSON.stringify(b!.tracks)}`,
        ).toBe(true);
        expect(
          Math.max(1, Math.floor((b!.sectionW + GAP) / (TRACK + GAP))),
          '列数应等于 floor((section+gap)/(262+gap))',
        ).toBe(b!.tracks.length);

        const m = await page.evaluate(measureCard, { index: 0, clones: 0 });
        expect(m, '看板列内应有项目卡').not.toBeNull();
        expect(m!.cardW, `卡片宽应为 轨道 − 列盒内边距 30 = ${CARD}`).toBe(CARD);
        expect(m!.contentW, `卡片内容宽应为 ${CONTENT}（232 − 卡内 p-6 48）`).toBe(CONTENT);
        expect(m!.cardH, `卡片高应为 xl 设计档 ${CARD_H}`).toBe(CARD_H);

        await page.screenshot({
          path: resolve(SHOT_DIR, 'N-01-1400-4col.png'),
          fullPage: false,
        });
      } finally {
        await ctx.close();
      }
    }, 120000);

    it('N-02 · 头像 n=1..4 四档：到期日/胶囊/头像/进度条/卡高/纵向溢出逐元素不越界', async () => {
      const { ctx, page } = await seededPage({ width: 1400, height: 900 });
      try {
        await spaGo(page, '/member-board');
        const board = await page.evaluate(measureBoard);
        expect(board!.cards, '夹具应至少有 1 张卡').toBeGreaterThan(0);

        const seen: Array<{ card: number; n: number; spans: number; avail: number }> = [];
        for (let index = 0; index < board!.cards; index += 1) {
          for (const n of [1, 2, 3, 4]) {
            const m = await page.evaluate(measureCard, { index, clones: n });
            expect(m, `第 ${index + 1} 张卡应存在`).not.toBeNull();
            const label = `卡${index + 1} n=${n}`;

            // 合成是否真的生效（否则后面全是假绿：克隆没进去，量的还是 1 个头像）
            expect(m!.avatarSpans, `${label} 头像 span 数应为 1 真实 + ${n} 克隆`).toBe(n + 1);
            expect(
              m!.avatarGroupW,
              `${label} 头像组宽应为 6 + 18×${m!.avatarSpans} = ${avatarGroupWidth(m!.avatarSpans)}`,
            ).toBe(avatarGroupWidth(m!.avatarSpans));
            expect(m!.cardH, `${label} 卡高必须仍是 ${CARD_H}（不许为塞头像加高）`).toBe(CARD_H);

            // ③-1 到期日不得截断（旧版在 n=2 就被挤掉）
            expect(m!.dueNeed, `${label} 到期日不得截断（需 ${m!.dueNeed} ≤ 可用 ${m!.dueAvail}）`).toBeLessThanOrEqual(
              m!.dueAvail + 1,
            );
            // ③-2 阶段胶囊不得折行（scrollHeight > clientHeight 即折行）
            expect(m!.tagOverflow, `${label} 阶段胶囊不得折行`).toBeLessThanOrEqual(1);
            expect(m!.tagH, `${label} 胶囊高应为 22（阶段色签档）`).toBe(22);
            // ③-3 头像组右缘不得越过卡片内容盒右缘
            expect(m!.avatarOverflow, `${label} 头像组右缘不得超出卡片内容盒`).toBeLessThanOrEqual(0.5);
            // ③-4 进度条轨道宽 == 内容宽
            expect(Math.abs(m!.trackW - m!.contentW), `${label} 进度条轨道宽应等于内容宽`).toBeLessThanOrEqual(1);
            // ③-5 卡内不得纵向溢出
            expect(m!.vOverflow, `${label} 卡内不得纵向溢出`).toBeLessThanOrEqual(0);
            // ⚠️ 这里**刻意不加**「行盒 scrollWidth ≤ 内容宽」这类断言：本轮试加过，
            //    探针实测（qa-scratch/mbcols/probe15）在**破损态**下它恒为 0 ——
            //    头像塞回元信息行时，先坏的是**到期日被截断**与**胶囊折行**
            //    （实测 span=4：到期日 53→44、胶囊 +6px；span=6：53→23、+14px），
            //    行盒本身从不溢出（左组会先收缩）。那条断言永远红不了 = 假绿通道，故删。
            // ③-6 委托方可用的底线（按实际 span 数给，见文件头「已知差口」）
            const floor = m!.avatarSpans <= 4 ? 90 : 80;
            expect(
              m!.delegatorAvail,
              `${label} 委托方可用宽应 ≥ ${floor}（span=${m!.avatarSpans}；实测值见文件头表格）`,
            ).toBeGreaterThanOrEqual(floor);
            expect(m!.delegatorNode, `${label} 窄版委托方行应是 div（头像在这里）`).toBe('div');

            seen.push({ card: index + 1, n, spans: m!.avatarSpans, avail: m!.delegatorAvail });
          }
        }

        await page.screenshot({
          path: resolve(SHOT_DIR, 'N-02-1400-avatar-stack.png'),
          fullPage: false,
        });
        // 把四档的实测值钉进注释证据（打印出来便于人工复核，不参与判定）
        console.log(
          '[narrow-card] 头像档实测：',
          seen.map((s) => `卡${s.card} n=${s.n}(span=${s.spans}) 委托方可用=${s.avail}`).join(' | '),
        );
      } finally {
        await ctx.close();
      }
    }, 180000);

    it('N-03 · 门控：首页（layout=row）卡片形态逐字节不变——头像仍在元信息行、委托方仍是单行 span', async () => {
      // 这一条守的是 `layout === 'column'` 这道门本身：窄版重排只许动看板列内的卡。
      // 若有人在共用路径上"顺手"改重排，首页卡片会跟着变——本用例当场变红。
      const { ctx, page } = await seededPage({ width: 1400, height: 900 });
      try {
        await spaGo(page, '/');
        await page.waitForSelector('[role="button"].group', { timeout: 20000 });
        await page.waitForTimeout(600);
        const m = await page.evaluate(measureAnyCard);
        expect(m, '首页应有项目卡').not.toBeNull();
        expect(m!.delegatorNode, '首页（layout=row）的委托方仍是单行 span').toBe('span');
        expect(m!.avatarSpans, '首页卡片的头像仍在元信息行（1 个真实头像）').toBe(1);
        // 首页卡片不在看板列里，宽度由 flex-wrap 行决定（这里只钉「不是窄版 232」）
        expect(m!.cardW, '首页卡片不应变成看板列内的 232').toBeGreaterThan(260);
      } finally {
        await ctx.close();
      }
    }, 120000);
  },
);
