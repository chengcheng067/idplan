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
 *   · 头像组移到**委托方行**右侧（那行右侧本就是死空间 ⇒ 零高度成本）；
 *   · 平铺头像上限 `max` = **3**（不是组件默认的 4）—— 由**不变式**解出，见下；
 *   · 非 xl 档（视口 ≤1279）卡高改为本档**专属的 168**（旧：与首页共用 124；
 *     逐行实测自然高 166 ⇒ 向上取 4 的整数档。算式在 `ProjectCard` 的「非 xl 高度」注释里）。
 *
 * ── 头像上限的不变式（差口②，本次收掉）──
 *   team-lead 定的判据原本写窄了（「n=4 那格 ≥90」），真正最坏的一格是「**顶满 max 之后再多一个
 *   成员**」—— 那时会追加 `+N` 胶囊，span 数 = max + 1。正确的不变式是：
 *       **头像组处于最坏格（含 `+N`）时，委托方可用宽 ≥ 90px。**
 *   代入 170 − 18(max+1) ≥ 90 ⇒ max ≤ 3.44 ⇒ **max = 3**：
 *       max=3 ⇒ 最坏格 4 span ⇒ 组宽 78 ⇒ 委托方 **98 ≥ 90** ✓
 *       max=4 ⇒ 最坏格 5 span ⇒ 组宽 96 ⇒ 委托方 **80 < 90** ✗（旧值，即差口②）
 *   ⇒ 本闸按「实际 span 数」而非「n」给底线，且 **N-05 用真夹具构造 5 个成员**把最坏格钉住。
 *
 * ── 断言（视口 1400 = 默认窗口 ⇒ `main` 封顶 1440 ⇒ section 1096）──
 *   N-01 每行 **4 列**、轨道恒 **262**、卡片 **232 × 185**、内容宽 184
 *   N-02 头像 **n = 1/2/3/4 四档**逐元素不越界：到期日不截断、阶段胶囊不折行、
 *        头像组右缘 ≤ 卡片内容盒右缘、进度条轨道宽 = 内容宽、卡高 185、卡内无纵向溢出
 *   N-03 门控：首页（`layout=row`）卡片形态逐字节不变（头像仍在元信息行、委托方仍是单行 span）
 *   N-04 非 xl **四档（960 / 1024 / 1152 / 1279）**：卡高 **168**、卡内无纵向溢出、
 *        委托方行高 **24**（> 0，即"客户名可见"）—— 差口① 的守闸
 *   N-05 **5 个成员**的最坏格：头像 span = **4**（3 头 + `+N`）、组宽 **78**、委托方 ≥ **90**
 *
 * ⚠️ 头像合成（N-02 用；夹具每张卡只有 1 个真实头像，装不下 4 档）：n > 0 时**克隆真实的 avatar
 *   `span`**（连它自己的全部 class 一起克隆，否则量出来的宽度不算数）追加进叠放盒。
 *   因此 N-02 里「档 n」= 叠放盒内 **1 + n 个 span**：
 *     n=1 ⇒ 2 个（组宽 42，委托方可用 134）
 *     n=2 ⇒ 3 个（60 / 116）
 *     n=3 ⇒ 4 个（78 / **98**）
 *     n=4 ⇒ 5 个（96 / **80**）—— 这一格是**旧 max=4 的破损形态**，仅作"若退回 max=4 会怎样"
 *          的对照；当前实现 `max=3` 下生产数据不可能出现 5 span（见 N-05）。
 *   N-05 刻意**不用**克隆：它用派生夹具（原夹具 3 人 + 2 人、当前阶段任务指派到 5 人）
 *   走应用自己的导入链路，让 `AvatarStack` 真的收到 5 个成员、真的渲染出 `+N`
 *   —— 最坏格必须由**真实渲染**证明，不能靠手搓一个胶囊。
 *
 * ⚠️ 溢出口径（**更正一条曾经的错误因果**；team-lead 独立探针在真应用 116→168 每 4px 一档复测）：
 *   本闸原先用 `scrollHeight − clientHeight`。我最初写成「它在 flex 容器上不可靠 ⇒ 所以换几何口径」，
 *   **这条因果不成立，已作废**：真卡片上子元素 min-content 不可压缩（每档都是 [28,24,30,22]，
 *   内容只会整体下移、不会局部收缩）⇒ 两者**逐档同值**：
 *       `scrollHeight − clientHeight` ≡ `max(0, 边框盒溢出)`
 *   （`scrollHeight` 按定义不小于 `clientHeight`，负值被钳成 0）。实测：168 ⇒ 0/0、
 *   156 ⇒ 0（几何边框盒是 −6，被钳位）、148 ⇒ 2/2、124 ⇒ 26/26 —— 老口径在 124 档本来就报 26，
 *   **不是假绿**，我误把"钳位后的 0"当成了"漏报"。
 *   换几何口径的**真正理由**：一次测量能**同时**给出**边框盒**与**内容盒**两个判据，
 *   老口径只能给前者。而要钉的不变式其实是**内容盒**那条 —— 真正会坏、且只有内容盒口径看得见的
 *   形态是「**内容吃掉下内边距**」：124 档 +42、156 档 +10、168 档 **−2**。
 *   ⇒ 非 xl 档按**内容盒**钉（N-04 的两条 assertion：内容盒 ≤ 0 为主）；
 *     **边框盒 ≤ 0 只是下限保险**（防"戳出卡外压到下一张卡"这种最恶性形态），别当成堵假绿的功劳。
 *   证据：`qa-scratch/mbcols/probe17.mjs`（9 档扫描，结论已同步更正）。
 *
 * ── 变异自证（本闸不是摆设；三次变异都做了，产物还原后重建 md5 与变异前逐字节一致）──
 *   M1 · 只把 `BOARD_COLUMN_TEMPLATE` 退回 gen3 `340/360`：
 *       **N-01 红**（默认窗口 2 列 ≠ 4）、**B-01a 红**（轨道数 2 ≠ floor(1112/278)=4）、
 *       **M-01 红**（1440 档 3 列 ≠ 4）、**M-02 红**（1152 档 2 列 ≠ 3）；
 *       而纯函数单测（member-board-columns）**5 条全绿** —— 它看不见几何常量。
 *   M2″ · 只退「头像搬家」这一件事（委托方行保持 div 但不再挂头像，头像留在元信息行）：
 *       **N-02 红**，红点正是本闸的设计目标：`卡1 n=3 到期日不得截断（需 53 ≤ 可用 44）`。
 *       注意 n≤2（span≤3）仍绿 —— 实测的失效起点是 **span=4（4 个头像 / 组宽 78）**，
 *       比「所需轨道宽 = 226.5 + 18n」给出的 n=2 晚两档（那公式偏保守，按完全无省略计算）。
 *   M3 · **新断言的变异**（两处各做一次，实测结果照抄如下；两次都已还原、重建 md5 与变异前一致）：
 *       ① 把 `max={isColumn ? 3 : 4}` 改回 **4** ⇒ **N-05 红**：
 *          `5 个成员应渲染成 3 个头像 + 1 个 "+N" = 4 span（max=3）: expected 5 to be 4`
 *          （`委托方 ≥ 90` 那一条是它的下游后果，被前一条先拦住没走到）。
 *       ② 把非 xl 高度改回 **124** ⇒ **N-04 红 + M-02 红**，两条红点同源：
 *          `视口 960 非 xl 档卡高应为 168（旧：与首页共用 124）: expected 124 to be 168`
 *          / `非 xl 档卡片应为本档专属高度 168（旧：与首页共用 124 ⇒ 溢出 26px）: expected 124 to be 168`。
 *          （同为"卡高"那一条先红；几何溢出 `+26` 是紧跟着的下一条断言，未走到。）
 *   ⚠️ 还试过第三条断言「行盒 scrollWidth ≤ 内容宽」（本意是抓"元素被挤出行盒"）：
 *       探针实测在 M2″ 这种**破损态**下它恒为 0（先坏的是到期日截断与胶囊折行，
 *       左组会先收缩、行盒从不溢出）⇒ 永远红不了 = 假绿通道，**已删**，不留装饰性断言。
 *
 * 前置：`npx vite build`（产物在 build-dist/）与本机 chromium；产物缺失/过期则整组 skip。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

import { CAN_RUN_FRESH, CHROMIUM_PATH, startServer, shotDir } from './helpers/board-env';

const FIXTURE = resolve(__dirname, 'fixtures', 'member-board-columns.json');
const SHOT_DIR = shotDir('member-board-narrow-card');

/** 新几何的四个数据（与 MemberBoardPage / ProjectCard 的实现在同一批变更里定下） */
const TRACK = 262;
const CARD = 232;
const CARD_H = 185;
/** 非 xl 档（视口 ≤1279）看板列卡片的**本档专属**高度（差口① 修法；旧值与首页共用 124） */
const CARD_H_NON_XL = 168;
const CONTENT = 184;
const GAP = 16;
/** 头像组宽 = 6 + 18n（AvatarStack：h-6 w-6 + `-space-x-1.5`） */
const avatarGroupWidth = (spans: number): number => 6 + 18 * spans;

type CardMetrics = {
  cardW: number;
  cardH: number;
  contentW: number;
  contentRight: number;
  /** 几何溢出：最靠下的子元素下边缘 − 卡片**内容盒**下边缘（> 0 = 越入下内边距） */
  contentOverflow: number;
  /** 几何溢出：最靠下的子元素下边缘 − 卡片**边框盒**下边缘（> 0 = 真的戳出卡外） */
  boxOverflow: number;
  avatarSpans: number;
  /** 叠放盒内每个 span 的文本（N-05 用它钉 `+N` 胶囊的内容，如 `+2`） */
  avatarTexts: string[];
  avatarGroupW: number;
  avatarOverflow: number;
  dueNeed: number;
  dueAvail: number;
  tagH: number;
  tagOverflow: number;
  trackW: number;
  delegatorAvail: number;
  delegatorRowH: number;
  delegatorNode: string;
  titleNode: string | null;
};

/**
 * 页面内度量：把第 `index` 张看板卡的头像**克隆**到 `clones` 个（0 = 不动），再量卡内几何。
 * 克隆对象取叠放盒里的**第一个真实 avatar span**——它自带正确 class，故宽高与真实一致。
 * 给了 `title` 时按标题文本选卡（N-05 派生夹具下卡序会变，不能靠 index）。
 */
function measureCard({
  index,
  clones,
  title,
}: {
  index: number;
  clones: number;
  title?: string;
}): CardMetrics | null {
  const R = (n: number): number => Math.round(n * 10) / 10;
  const board =
    Array.from(document.querySelectorAll('main section[style*="auto-fit"]')).find((s) =>
      s.querySelector('[role="button"].group'),
    ) ?? null;
  if (!board) return null;
  const cards = Array.from(board.querySelectorAll('[role="button"].group')) as HTMLElement[];
  const card = title ? cards.find((c) => (c.textContent ?? '').includes(title)) : cards[index];
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
  const cardRect = card.getBoundingClientRect();
  const contentRight = cardRect.right - parseFloat(cs.paddingRight);
  const maxKidBottom = Math.max(...Array.from(card.children).map((k) => k.getBoundingClientRect().bottom));
  const rows = Array.from(card.children) as HTMLElement[];
  const delegatorRow = rows[1] as HTMLElement | undefined;
  const metaRow = rows[rows.length - 1] as HTMLElement | undefined;
  const stackScope = stackInner?.closest('div') as HTMLElement | null;
  const delegator = delegatorRow?.querySelector('span.truncate') as HTMLElement | null;
  const due = metaRow?.querySelector('span.truncate') as HTMLElement | null;
  const tag = metaRow?.querySelector('span.inline-flex') as HTMLElement | null;
  const track = card.querySelector('.h-2.w-full') as HTMLElement | null;
  /** ⚠️ 变量名不能叫 `title` —— 那是本函数的形参名（按标题选卡） */
  const titleEl = card.querySelector('span.min-w-0.flex-1.truncate') as HTMLElement | null;

  return {
    cardW: R(cardRect.width),
    cardH: R(cardRect.height),
    contentW: R(contentW),
    contentRight: R(contentRight),
    /*
     * 两个纵向溢出都量成**几何量**（老口径 `scrollHeight − clientHeight` 与其中的"边框盒"
     * 一条**逐档同值**，本就不是坏口径 —— 换过来是为了**一次测量同时拿到两个判据**）：
     *   · contentOverflow = 子元素下边缘 − **内容盒**下边缘 ⇒ > 0 表示「内容吃掉了下内边距」，
     *     这是真卡片上唯一会坏、且只有本口径看得见的形态（124 档 +42、156 档 +10、168 档 −2）；
     *   · boxOverflow = 子元素下边缘 − **边框盒**下边缘 ⇒ > 0 才是"戳出卡外会压到下一张卡"，
     *     作为**下限保险**保留。
     * 完整更正说明见文件头「溢出口径」段；证据 qa-scratch/mbcols/probe17.mjs。
     */
    contentOverflow: R(maxKidBottom - (cardRect.bottom - parseFloat(cs.paddingBottom))),
    boxOverflow: R(maxKidBottom - cardRect.bottom),
    avatarSpans: stackInner ? stackInner.children.length : 0,
    avatarTexts: stackInner
      ? Array.from(stackInner.children).map((s) => (s.textContent ?? '').trim())
      : [],
    avatarGroupW: stackScope ? R(stackScope.getBoundingClientRect().width) : 0,
    avatarOverflow: stackScope ? R(stackScope.getBoundingClientRect().right - contentRight) : 0,
    dueNeed: due ? due.scrollWidth : 0,
    dueAvail: due ? due.clientWidth : 0,
    tagH: tag ? R(tag.getBoundingClientRect().height) : 0,
    tagOverflow: tag ? tag.scrollHeight - tag.clientHeight : 0,
    trackW: track ? R(track.getBoundingClientRect().width) : 0,
    delegatorAvail: delegator ? R(delegator.getBoundingClientRect().width) : 0,
    delegatorRowH: delegatorRow ? R(delegatorRow.getBoundingClientRect().height) : 0,
    delegatorNode: delegatorRow ? delegatorRow.tagName.toLowerCase() : '',
    titleNode: titleEl ? titleEl.className : null,
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
     *
     * `fixtureFile` 可换（N-05 用「5 个成员」的派生夹具）；默认仍是原夹具。
     */
    async function seededPage(viewport: { width: number; height: number }, fixtureFile = FIXTURE) {
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
      await page.locator('input[type="file"][accept*="json"]').first().setInputFiles(fixtureFile);
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

    /**
     * N-05 用：把原夹具派生成「一个项目 5 个成员」的版本。
     *   · 补 2 名 active 成员（夹具原有 3 名）；
     *   · 把 `proj_indoor` **当前阶段**（`proj_indoor_s2`，2026-09-01→12-31）那条任务的
     *     `assigneeIds` 指向全部 5 人 —— 卡片成员行取的是「当前阶段未完成任务的执行人 +
     *     阶段负责人」，故这样卡片上就真的有 5 个人。
     * 写系统临时目录、用完即删（**不往 tests/fixtures 里复制第二份 19KB 夹具**）。
     */
    function buildFiveMemberFixture(): { file: string; cleanup(): void } {
      const obj = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
        data: {
          members: Array<Record<string, unknown>>;
          tasks: Array<Record<string, unknown>>;
        };
      };
      const stamp = '2026-10-12T00:00:00.000Z';
      obj.data.members.push(
        { id: 'm-lin', name: '林工', role: '软装顾问', contact: 'lin@fixture.local', avatarColor: '#8A6BB2', active: true, roleKind: 'member', passwordHash: null, actorKind: 'human', agentKind: null, revision: 1, updatedAt: stamp },
        { id: 'm-he', name: '何工', role: '机电顾问', contact: 'he@fixture.local', avatarColor: '#B2825C', active: true, roleKind: 'member', passwordHash: null, actorKind: 'human', agentKind: null, revision: 1, updatedAt: stamp },
      );
      const allIds = obj.data.members.map((m) => m.id as string);
      const task = obj.data.tasks.find((t) => t.id === 'proj_indoor_s2_t1');
      if (!task) throw new Error('夹具缺 proj_indoor_s2_t1 —— N-05 的前提被改坏了，先看夹具');
      task.assigneeIds = allIds;
      const file = join(tmpdir(), `mbcols-five-members-${process.pid}-${Date.now()}.json`);
      writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
      return {
        file,
        cleanup: () => {
          try {
            unlinkSync(file);
          } catch {
            /* 临时文件删不掉不影响判定 */
          }
        },
      };
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
        // n = 追加的**克隆**数 ⇒ span 数 = n + 1。四档里 n=4（span=5）已经**越过实现的
        // 最坏格**（`max = 3` ⇒ 生产最多 4 span，见 N-05）：留着它是当"越界档"用，
        // 检查再多的 span 也只是让委托方变窄、不会把卡撑坏（底线降到 80 那一条）。
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
            // ③-5 卡内不得纵向溢出（**几何口径的边框盒那一条**：子元素不得越过卡片边框盒，
            //      否则会压到下一张卡上）。⚠️ 这是**下限保险**，不是"堵住了假绿"——
            //      老口径 `scrollHeight` 在真卡片上与它逐档同值（见文件头「溢出口径」段）。
            expect(
              m!.boxOverflow,
              `${label} 卡内不得纵向溢出（子元素不得越过卡片边框盒）`,
            ).toBeLessThanOrEqual(0);
            // ⚠️ 这里**刻意不加**「行盒 scrollWidth ≤ 内容宽」这类断言：本轮试加过，
            //    探针实测（qa-scratch/mbcols/probe15）在**破损态**下它恒为 0 ——
            //    头像塞回元信息行时，先坏的是**到期日被截断**与**胶囊折行**
            //    （实测 span=4：到期日 53→44、胶囊 +6px；span=6：53→23、+14px），
            //    行盒本身从不溢出（左组会先收缩）。那条断言永远红不了 = 假绿通道，故删。
            // ③-6 委托方可用的底线（按实际 span 数给，见文件头「头像上限的不变式」）
            //    span ≤ 4 = **实现的最坏格**（max=3 ⇒ 3 头 + `+N`）⇒ 不变式要求 ≥ 90；
            //    span = 5 只能靠克隆合成出来（`max=3` 后 props 层已不可达），
            //    它守的是「万一有人把 max 调回去 / 未来加了 span」时**尽量不破形**：≥ 80。
            const floor = m!.avatarSpans <= 4 ? 90 : 80;
            expect(
              m!.delegatorAvail,
              `${label} 委托方可用宽应 ≥ ${floor}（span=${m!.avatarSpans}；不变式见文件头）`,
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

    it('N-04 · 非 xl 四档（960/1024/1152/1279）：卡高 168、无纵向溢出、委托方行 24 高（客户名可见）', async () => {
      /*
       * 差口① 的守闸。旧形态（非 xl 档与首页共用 `h-[124px]`）两条都是坏的：
       *   · 委托方行被 flex 压成 **0 高** ⇒ 客户名完全不可见；
       *   · 其内容越出卡片边框盒 **26px**（= 21% 卡高）⇒ 压到下一张卡上。
       * 新形态把本档高度改成**专属的 168**（= 逐行实测自然高 166 向上取 4 的整数档）。
       * 修好之后就把数字钉住 —— 先前不钉是因为"钉一个已知破损的数字等于把破损写进契约"。
       *
       * ⚠️ 两条溢出断言分工（更正后的口径，见文件头段）：
       *   · **内容盒**那条是**主判据** —— 内容吃掉下内边距是这一档真正会坏的形态
       *     （124 档 +42、156 档 +10；修好的 168 档 −2，上下内边距对称的 16/16）；
       *   · **边框盒**那条是**下限保险** —— 只有它 > 0 才是"戳出卡外、压到下一张卡"。
       *   老口径 `scrollHeight − clientHeight` 与边框盒那条**逐档同值**，换成几何量是为了
       *   一次测量同时拿到两个判据，**不是**为了堵假绿（原先那句因果已作废）。
       */
      for (const width of [960, 1024, 1152, 1279]) {
        const { ctx, page } = await seededPage({ width, height: 864 });
        try {
          await spaGo(page, '/member-board');
          const b = await page.evaluate(measureBoard);
          expect(b, `视口 ${width} 应找到看板列 section`).not.toBeNull();
          expect(
            b!.tracks.every((t) => t === TRACK),
            `视口 ${width} 轨道应恒 ${TRACK}（非 xl 档同样定宽）`,
          ).toBe(true);

          const m = await page.evaluate(measureCard, { index: 0, clones: 0 });
          expect(m, `视口 ${width} 看板列内应有项目卡`).not.toBeNull();
          // 旧数字 124（= 首页 row 档，本档曾共用）→ 新数字 168（本档专属）
          expect(m!.cardH, `视口 ${width} 非 xl 档卡高应为 ${CARD_H_NON_XL}（旧：与首页共用 124）`).toBe(
            CARD_H_NON_XL,
          );
          expect(
            m!.boxOverflow,
            `视口 ${width} 卡内不得纵向溢出（几何口径；旧 124 档实测 +26）`,
          ).toBeLessThanOrEqual(0);
          // 内容完整落在内容盒内 ⇒ 上下内边距都是设计的 16，不被内容顶穿
          expect(
            m!.contentOverflow,
            `视口 ${width} 内容应落在内容盒内（上下内边距对称；余量 2px）`,
          ).toBeLessThanOrEqual(0);
          // 委托方行不被压成 0 高（旧版实测塌陷 ⇒ 客户名不可见）
          expect(m!.delegatorRowH, `视口 ${width} 委托方行高应 > 0（客户名必须可见）`).toBeGreaterThan(0);
          expect(m!.delegatorRowH, `视口 ${width} 委托方行高应是被头像撑起的 24`).toBe(24);

          await page.screenshot({
            path: resolve(SHOT_DIR, `N-04-${width}-column-card.png`),
            fullPage: false,
          });
        } finally {
          await ctx.close();
        }
      }
    }, 240000);

    it('N-05 · 5 个成员的最坏格：头像 span = 4（3 头 + `+N`）、组宽 78、委托方可用宽 ≥ 90', async () => {
      /*
       * 差口② 的守闸，也是「max = 3」这条**不变式**的证明。
       * 最坏格不是"顶满 max"，而是"顶满 max 后**再多一个成员**"——那时会追加 `+N` 胶囊。
       * `max=4`（旧值）下最坏格是 5 span ⇒ 组宽 96 ⇒ 委托方只剩 80 < 90 ✗。
       *
       * ⚠️ 这一格**必须用真实渲染**证明，不能手搓一个胶囊：夹具每卡只有 1 个成员，
       *    N-02 那套"克隆 avatar span"合不出 `+N`（`+N` 是 `AvatarStack` 自己渲染的）。
       *    故这里把原夹具**派生**成「一个项目 5 个成员」（补 2 名成员 + 当前阶段任务的
       *    `assigneeIds` 指向全部 5 人），让 `AvatarStack` 真的收到 5 个成员。
       *    派生件写系统临时目录、用例结束即删（**不往 tests/fixtures 里加第二份 19KB 夹具**）。
       */
      const derived = buildFiveMemberFixture();
      const { ctx, page } = await seededPage({ width: 1400, height: 900 }, derived.file);
      try {
        await spaGo(page, '/member-board');
        const m = await page.evaluate(measureCard, { index: 0, clones: 0, title: '云栖·湖畔茶室' });
        expect(m, '派生夹具下应找到「云栖·湖畔茶室」的卡').not.toBeNull();

        // 3 个头像 + 1 个 `+N` = 4 span（`max = 3` 的效果；`max=4` 时这里会是 5）
        expect(m!.avatarSpans, '5 个成员应渲染成 3 个头像 + 1 个 `+N` = 4 span（max=3）').toBe(4);
        expect(
          m!.avatarTexts[m!.avatarTexts.length - 1],
          '`+N` 胶囊应显示被收起的 2 人',
        ).toBe('+2');
        expect(
          m!.avatarGroupW,
          `最坏格头像组宽应为 ${avatarGroupWidth(4)}（6 + 18×4）`,
        ).toBe(avatarGroupWidth(4));
        // 不变式本体：最坏格（含 `+N`）≥ 90
        expect(
          m!.delegatorAvail,
          '不变式：头像组处于最坏格（含 `+N`）时委托方可用宽 ≥ 90（实测 98）',
        ).toBeGreaterThanOrEqual(90);
        // 越界与溢出一起守（头像多了也不许把卡撑坏）
        expect(m!.avatarOverflow, '头像组右缘不得越过卡片内容盒').toBeLessThanOrEqual(0.5);
        expect(m!.boxOverflow, '最坏格下卡内仍不得纵向溢出').toBeLessThanOrEqual(0);
        expect(m!.cardH, `最坏格下卡高仍应为 ${CARD_H}`).toBe(CARD_H);

        await page.screenshot({
          path: resolve(SHOT_DIR, 'N-05-1400-five-members-max3.png'),
          fullPage: false,
        });
      } finally {
        await ctx.close();
        derived.cleanup();
      }
    }, 120000);
  },
);
