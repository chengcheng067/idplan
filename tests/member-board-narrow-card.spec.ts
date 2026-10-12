/**
 * 成员看板 · 窄版卡片的真机几何闸（gen5：轨道基准 245 + `1fr` ⇒ 真机 1088 宽下 4 列）。
 *
 * ── 为什么需要这条闸 ──
 * 产品负责人拍板「默认窗口就要每行 4 列」。gen4（`262/262`）在 **headless 的 1096** 下确实 4 列，
 * 但**真机是 1088**（窗口 1400 − Chrome 纵向滚动条 **8** − 侧栏 240 − 页面内边距 64）⇒
 * `floor(1104/278) = 3` ⇒ **用户看到的是 3 列**（他报的 bug）。
 * gen5 改为 `repeat(auto-fit, minmax(min(100%, 245px), 1fr))`：门槛 `4×245 + 3×16 = 1028` ≤ 1088
 * ⇒ **4 列**（余量 60px），且 `1fr` 让轨道铺满该行 ⇒ 左边缘与统计卡/任务三块对齐（他要的「工整」）。
 * 真机 1088 实测：4 轨 × **260** ⇒ 卡片 **230** ⇒ 卡内容宽 **182**。
 *
 * ── ⚠️ 假绿通道（**本闸上一轮就是在这里判绿的**）──
 * 旧版断言 `sectionW === 1096`，注释写「main 封顶 1440 − 侧栏 240 − 内边距 64」——**漏了滚动条**。
 * **headless Chromium 用 overlay 滚动条（占 0px）** ⇒ 探针量到 1096、判绿；真机 8px ⇒ 1088、3 列。
 * **凡是在 headless 里用视口 1400 量的，量的都是用户没有的宽度。**
 * ⇒ 本闸现在两件事：① 真机同宽探针改用**视口 1392**（= 1400 − 8）抵消；② 加 **N-00 零浏览器屏障**：
 *    `USER_SECTION_W = 1088`（真机实测常量）+ 纯算式断言 `4×245 + 3×16 ≤ 1088 − 48`。
 *
 * ── 卡内重排（230/215 宽的卡片凭什么还放得下：靠重排，不靠拉伸）──
 * 旧卡片的失效阈值是真机实测的 **所需轨道宽 = 226.5 + 18n**（n = 卡上头像数；头像 24px、
 * 叠放间距 −6 ⇒ 头像组宽 = 6 + 18n）：n=1 需 245、**n=2 就需 263**。
 * 根因在底部元信息行：左组要「到期日 53 + gap 8 + 阶段胶囊 73.5」= 134.5，再 + gap 8 + 头像组。
 * ⇒ 修法是**重排卡内**：元信息行只留「到期日 + 胶囊」，头像组挪到**委托方行**右侧
 * （那行右侧本就是死空间，零高度成本 ⇒ 卡高仍 185），并把窄版头像上限 `max` 定为 3。
 *
 * ── 头像上限的不变式（判据线 ≥ 90px）──
 * 最坏格**不是"顶满 max"**，而是「顶满 max 之后**再多一个成员**」（那时会追加 `+N`，span = max+1）：
 *       **头像组处于最坏格（含 `+N`）时，委托方可用宽 ≥ 90px。**
 * 真机 1088（内容宽 182）代入 `182 − 8 − (6 + 18k) ≥ 90` ⇒ `k ≤ 4.67` ⇒ k=4 ⇒ **max = 3**：
 *       max=3 ⇒ 最坏格 4 span ⇒ 组宽 78 ⇒ 委托方 **96 ≥ 90** ✓
 *       max=4 ⇒ 最坏格 5 span ⇒ 组宽 96 ⇒ 委托方 **78 < 90** ✗
 * ⚠️ **已知边界（登记，未改）**：在**最坏轨道** 245（内容宽 167，见 N-02b）下同一条不变式会破 ——
 *   k=4 ⇒ `167 − 8 − 78 =` **81 < 90**（此时委托方仍可见、只是更早省略）。该档 section = 1028
 *   **小于真机 1088**，不在用户的窗口里；是否要为它再收窄 `max` 由 team-lead 定。
 *
 * ── ⚠️ 判据纪律：**容差只属于几何连续性判据**（2026-10-13 收口）──
 *   容差（±1 / ±0.5）**只许**用在**几何连续性**判据上：盒高 ±1、贴合 ±0.5（`avatarOverflow`、
 *   `trackW ↔ contentW`、委托方可用宽与公式对表那一类）。
 *   「**截断 / 折行 / 是否单行 / 计数**」这类**离散**判据只有「有 / 没有」两面，
 *   没有"亚像素连续变化"可言 ⇒ 必须**零容差**；给它们容差等于把判据本身废掉。
 *   **实证（2026-10-12）**：有人用 `scrollWidth > clientWidth + 1` 判「单行省略文本是否被截断」，
 *   那个 **`+1` 正好吞掉 0.83px 的截断**（同一夹具真值：文本真实宽 **96.83px** / 可用 **96px**，
 *   即 gen5 用 2px 换 4 列的对价）⇒ 得出「**名字完整显示**」的**错误结论**；只有换**亚像素复测**
 *   （`getBoundingClientRect` 取小数 + `Range` 逐字量）才把它推翻。
 *   ⇒ 本闸现行两条**零容差**判据（N-02 四档 + N-02b 各一份）：到期日 `dueNeed − dueAvail ≤ 0`、
 *     胶囊折行 `tagOverflow ≤ 0`。**它们红了就是真的坏了 —— 不许改回带容差的写法。**
 *
 * ── 断言 ──
 *   N-00 防假绿（并入 N-01）：`sectionW ≤ 1088` + 纯算式 `4×245 + 3×16 ≤ 1088 − 48`（不依赖浏览器）
 *   N-01 视口 **1392**（= 真机同宽）：section **1088**、每行 **4 列**、轨道 **260**、
 *        卡片 **230×185**、内容宽 **182**、且**看板列 / 任务三块 / 统计卡三个左边缘相等**
 *   N-02 头像 **n = 1/2/3/4 四档**逐元素不越界（委托方可用宽按 `182 − 8 − 组宽` 的**公式**钉）
 *   N-02b **最坏轨道 245**（视口 1332 ⇒ section 1028 ⇒ 4×245）：卡片 **215**、内容 **167**、逐元素不越界
 *   N-03 门控：首页（`layout=row`）卡片形态逐字节不变（头像仍在元信息行、委托方仍是单行 span）
 *   N-04 非 xl **四档（960 / 1024 / 1152 / 1279）**：卡高 **168**、卡内无纵向溢出、
 *        委托方行高 **24**（> 0，即"客户名可见"）
 *   N-05 **5 个成员**的最坏格：头像 span = **4**（3 头 + `+N`）、组宽 **78**、委托方 ≥ **90**
 *
 * ⚠️ 头像合成（N-02 用；夹具每张卡只有 1 个真实头像，装不下 4 档）：n > 0 时**克隆真实的 avatar
 *   `span`**（连它自己的全部 class 一起克隆，否则量出来的宽度不算数）追加进叠放盒。
 *   因此 N-02 里「档 n」= 叠放盒内 **1 + n 个 span**：
 *     n=1 ⇒ 2 个（组宽 42，委托方可用 `182 − 8 − 42` = 132）
 *     n=2 ⇒ 3 个（60 / 114）
 *     n=3 ⇒ 4 个（78 / **96**）—— `max = 3` 的最坏格（生产可达），96 ≥ 90 ✓
 *     n=4 ⇒ 5 个（96 / **78**）—— 这一格只能靠克隆合成（`max=3` 后 props 层不可达），
 *          仅作"若把 max 调回 4 会怎样"的对照；78 < 90 就是那条不变式要拦的形态。
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
 * ── gen5 批次（2026-10-13）的变异自证（三条都做；每次还原后产物 md5 逐字节一致）──
 *   M4 · 只把 `BOARD_COLUMN_TEMPLATE` 退回 gen4 `262/262` ⇒ **7 红**（本文件 4 条 + cap B-01a + layout M-01/M-02），
 *        红点原文：`N-01 真机同宽必须 4 列（gen4 的 262 在这一档只有 3 列 —— 用户报的 bug）:
 *        expected 3 to be 4`；`B-01a realwindow-1392 看板列轨道数应为 floor((section+16)/261) = 4:
 *        expected 3 to be 4`；`M-01 真机同宽下看板应为 4 列…: expected 3 to be 4`；
 *        `M-02 1152 档（section 1088）看板应为 4 列（gen4 时是 3 列）: expected 3 to be 4`。
 *        另有两条是**派生**红：`N-02b 临界宽下仍应恰好 4 轨: expected 3 to be 4`、
 *        `N-02/N-05 委托方可用宽应等于 182−8−组宽: expected 2 to be less than or equal to 1`
 *        （三轨下卡片变成 232 ⇒ 内容 184 ⇒ 与 182 的公式差 2）。
 *   M5 · 只把 `TRIAGE_COLUMN_TEMPLATE` 退回定值 `340/340` ⇒ **1 红**：
 *        `B-01b 任务三块第 1 轨应为 (1088−32)/3 = 352（1fr 均分）: expected 340 to be 352`。
 *        ⚠️ team-lead 预期这条会打中「左边缘对齐」，**实测没有**（本文件全绿）：因为他要求删掉了
 *        `justify-center`，定值模板下 `justify-content: normal` 会把余量甩到**右侧**，
 *        左边缘照样落在 272、与统计卡齐平。⇒ 判「铺满」只能靠**轨道之和 + 间隙 = section 宽**
 *        这一条（已作为 B-01a ⑥ / B-01b 补上），不能靠左边缘。
 *   M6 · 只把基准 `245 → 262`（保留 `1fr`）⇒ **7 红**，集合与 M4 相同；
 *        其中 `N-02 委托方可用宽应等于 182−8−组宽 = 132: expected 92 to be less than or equal to 1`
 *        （3 轨 × 352 ⇒ 卡片 322 ⇒ 内容 274 ⇒ 实测 224，差 92）。
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

/**
 * gen5 几何的**不变式**（与 `MemberBoardPage.tsx` 的两个常量同源；轨道宽**不再是定值**）。
 *   · `TRACK_BASE = 245` = `minmax(min(100%, 245px), 1fr)` 里的 `min`；`1fr` 下轨道**恒 ≥ 基准**
 *     （4 轨成立的前提就是 `4·base + 3·gap ≤ W`），并随 section 宽**均分该行**。
 *   · 卡片 = 轨道 − 列盒内边距 30（`p-3.5` 14×2 + `.glass-light` 1px 边框 ×2）；
 *     卡片内容宽 = 卡片 − 卡内 `p-6` 48。
 *   · `USER_SECTION_W = 1088` = **真机**默认窗口的 section 宽
 *     （窗口 1400 − Chrome 纵向滚动条 8 − 侧栏 240 − 页面内边距 64）。headless 无滚动条 ⇒ 1096。
 */
const TRACK_BASE = 245;
const COL_BOX_PAD = 30;
const CARD_PAD = 48;
const USER_SECTION_W = 1088;
const GAP = 16;
/** 真机同宽探针视口 = 1400 − 8（用缩视口抵消 headless 的 overlay 滚动条） */
const VP_REAL_WINDOW = 1392;
/** 真机同宽（section 1088）下的实测值：轨道 260 ⇒ 卡片 230 ⇒ 内容 182 */
const TRACK_REAL = 260;
const CARD_REAL = TRACK_REAL - COL_BOX_PAD;
const CONTENT_REAL = CARD_REAL - CARD_PAD;
/** 最坏轨（= 基准 245）下的实测值：卡片 215 ⇒ 内容 167（视口 1332 ⇒ section 1028） */
const VP_WORST = 1332;
const CARD_WORST = TRACK_BASE - COL_BOX_PAD;
const CONTENT_WORST = CARD_WORST - CARD_PAD;
const CARD_H = 185;
/** 非 xl 档（视口 ≤1279）看板列卡片的**本档专属**高度（与首页共用 124 的那一档已修） */
const CARD_H_NON_XL = 168;
/** 头像组宽 = 6 + 18n（AvatarStack：h-6 w-6 + `-space-x-1.5`） */
const avatarGroupWidth = (spans: number): number => 6 + 18 * spans;

type CardMetrics = {
  cardW: number;
  cardH: number;
  /** 卡片自身的滚动宽/客户宽（`scrollWidth ≤ clientWidth + 1` = 卡内无横向溢出） */
  scrollW: number;
  clientW: number;
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
    scrollW: card.scrollWidth,
    clientW: card.clientWidth,
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

    it('N-01 · 视口 1392（= 真机同宽）：section 1088、每行 4 列、轨道 260、卡片 230×185、三个左边缘对齐', async () => {
      /*
       * ★ N-00 防假绿（零浏览器屏障）：这条**纯算式**不依赖任何浏览器测量，
       *   把「245 基准在真机 1088 下放得下 4 列」写成可判红的算术。
       *   ⚠️ 之所以要它：真机宽度**不是** headless 量到的 1096，而是 1088（少一条 8px 滚动条），
       *   而 headless 无论如何都量不出那 8px ⇒ 必须有一条与浏览器无关的屏障。
       *   改基准的人如果把它改回 260 以上，这条立刻红（260 的门槛正好 1088 = 零余量）。
       */
      expect(
        TRACK_BASE * 4 + GAP * 3,
        '不变式：4×245 + 3×16 = 1028 ≤ 真机 section 1088 − 页面内边距 48？',
      ).toBeLessThanOrEqual(USER_SECTION_W - 48);
      expect(
        USER_SECTION_W - 48 - (TRACK_BASE * 4 + GAP * 3),
        '余量必须为正（门槛恰好等于真机宽 = 下一次翻车；旧值 262 的门槛 1096 就比真机宽 8px）',
      ).toBeGreaterThan(0);

      const { ctx, page } = await seededPage({ width: VP_REAL_WINDOW, height: 900 });
      try {
        await spaGo(page, '/member-board');
        const b = await page.evaluate(measureBoard);
        expect(b, '应找到看板列 section').not.toBeNull();

        // 旧数字（gen4 探针在 headless 1400 量到 1096）：那是**用户没有的宽度**。
        // 新数字：探针用 1392 抵消 8px 滚动条 ⇒ 复现真机 1088。
        expect(
          b!.sectionW,
          `真机同宽下 section 应为 ${USER_SECTION_W}（探针视口 1392 = 1400 − 8px 滚动条；headless 量不到那 8px）`,
        ).toBe(USER_SECTION_W);
        expect(b!.sectionW, 'N-00：真机同宽断言必须 ≤ 1088，防止有人又用 headless 的 1096 当默认窗口').toBeLessThanOrEqual(
          USER_SECTION_W,
        );
        expect(b!.tracks.length, '真机同宽必须 4 列（gen4 的 262 在这一档只有 3 列 —— 用户报的 bug）').toBe(4);
        expect(
          Math.max(1, Math.floor((b!.sectionW + GAP) / (TRACK_BASE + GAP))),
          `列数应等于 floor((section+gap)/(245+gap))`,
        ).toBe(b!.tracks.length);
        for (const [i, t] of b!.tracks.entries()) {
          expect(t, `第 ${i + 1} 轨应为 ${TRACK_REAL}（1fr 均分该行），实测 ${JSON.stringify(b!.tracks)}`).toBe(TRACK_REAL);
          expect(t, `第 ${i + 1} 轨永不得低于基准 ${TRACK_BASE}`).toBeGreaterThanOrEqual(TRACK_BASE);
        }
        // 「铺满该行」= 工整的实质：Σ轨道 + (n−1)×gap === section 宽（容差 1px）
        const filledW = b!.tracks.reduce((a, t) => a + t, 0) + (b!.tracks.length - 1) * GAP;
        expect(
          Math.abs(filledW - b!.sectionW),
          `轨道之和 + 间隙应铺满 section（实测 ${Math.round(filledW * 10) / 10} vs ${b!.sectionW}）`,
        ).toBeLessThanOrEqual(1);

        const m = await page.evaluate(measureCard, { index: 0, clones: 0 });
        expect(m, '看板列内应有项目卡').not.toBeNull();
        expect(m!.cardW, `卡片宽应为 轨道 − 列盒内边距 30 = ${CARD_REAL}`).toBe(CARD_REAL);
        expect(m!.contentW, `卡片内容宽应为 ${CONTENT_REAL}（230 − 卡内 p-6 48）`).toBe(CONTENT_REAL);
        expect(m!.cardH, `卡片高应为 xl 设计档 ${CARD_H}`).toBe(CARD_H);

        // ★「工整」的零数据依赖判据：看板列 / 任务三块 / 统计卡三个左边缘必须相等。
        //   gen4 的定宽轨道 + `justify-center` 下看板列左缘是 143、任务三块 26 —— 都不等于统计卡 8/272。
        const edges = await page.evaluate(() => {
          const R = (n: number): number => Math.round(n * 10) / 10;
          const sections = Array.from(document.querySelectorAll('main section'));
          const grids = sections.filter((s) => s.classList.contains('grid'));
          const stats = sections.find((s) => (s.textContent || '').includes('进行中项目') && !s.classList.contains('grid'));
          return {
            stat: stats?.firstElementChild ? R(stats.firstElementChild.getBoundingClientRect().left) : null,
            triage: grids[0] ? R(grids[0].getBoundingClientRect().left) : null,
            kanban: grids[1] ? R(grids[1].getBoundingClientRect().left) : null,
          };
        });
        expect(edges.stat, '应找到统计卡').not.toBeNull();
        expect(edges.triage, `任务三块左缘应为 ${edges.stat}`).toBe(edges.stat);
        expect(edges.kanban, `看板列左缘应为 ${edges.stat}（这就是"工整"）`).toBe(edges.stat);

        await page.screenshot({
          path: resolve(SHOT_DIR, 'N-01-1392-realwidth-4col.png'),
          fullPage: false,
        });
      } finally {
        await ctx.close();
      }
    }, 120000);

    it('N-02 · 头像 n=1..4 四档：到期日/胶囊/头像/进度条/卡高/纵向溢出逐元素不越界', async () => {
      const { ctx, page } = await seededPage({ width: VP_REAL_WINDOW, height: 900 });
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
            //      ⚠️ **零容差**（离散判据：截断只有"有 / 没有"两面，见文件头「判据纪律」）。
            //      旧版写成 `≤ dueAvail + 1` —— 那 1px 正好吞掉亚像素截断，判据等于作废。
            //      实测（本夹具四档）：需 53 / 可用 53 ⇒ 差值 0，收紧后仍绿。
            expect(
              m!.dueNeed - m!.dueAvail,
              `${label} 到期日不得截断（需 ${m!.dueNeed} ≤ 可用 ${m!.dueAvail}）`,
            ).toBeLessThanOrEqual(0);
            // ③-2 阶段胶囊不得折行（scrollHeight > clientHeight 即折行）
            //      ⚠️ **零容差**：折行量是离散量（实测 0），1px 的容差同样会把"折了一行"吞掉。
            expect(m!.tagOverflow, `${label} 阶段胶囊不得折行`).toBeLessThanOrEqual(0);
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
            // ③-6 委托方可用宽：先用**公式**钉住布局本身（`内容宽 − gap 8 − 组宽`），
            //      再对**生产可达的最坏格**（span ≤ 4，即 max=3 顶满 + `+N`）要求 ≥ 90。
            //      span = 5 只能靠克隆合成（props 层不可达）⇒ 只验公式，不再给它一个"底线"，
            //      免得出一个永不可达的数字被后人当成契约（78 < 90 就是那条不变式要拦的形态）。
            const formulaAvail = CONTENT_REAL - 8 - avatarGroupWidth(m!.avatarSpans);
            expect(
              Math.abs(m!.delegatorAvail - formulaAvail),
              `${label} 委托方可用宽应等于 内容宽 182 − gap 8 − 组宽 ${avatarGroupWidth(m!.avatarSpans)} = ${formulaAvail}`,
            ).toBeLessThanOrEqual(1);
            if (m!.avatarSpans <= 4) {
              expect(
                m!.delegatorAvail,
                `${label} 最坏格（span=${m!.avatarSpans}）委托方可用宽应 ≥ 90（不变式见文件头）`,
              ).toBeGreaterThanOrEqual(90);
            }
            expect(m!.delegatorNode, `${label} 窄版委托方行应是 div（头像在这里）`).toBe('div');

            seen.push({ card: index + 1, n, spans: m!.avatarSpans, avail: m!.delegatorAvail });
          }
        }

        await page.screenshot({
          path: resolve(SHOT_DIR, 'N-02-1392-avatar-stack.png'),
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

    it('N-02b · 最坏轨道 245（视口 1332 ⇒ section 1028）：卡片 215、内容 167、逐元素不越界', async () => {
      /*
       * ★ 这一格**旧设计从没测过**：245 是 gen5 的**基准**，也就是「4 轨恰好成立」的那一点
       *   （`4×245 + 3×16 = 1028` = 视口 1332 下的 section 宽）。设计必须在这一格不散架 ——
       *   它比真机默认窗口（1088，轨道 260）更窄，是**下界**而不是常态。
       *   ⚠️ 已知且**登记**的降级：这一格内容宽只有 167 ⇒ 头像最坏格（4 span = 78）下
       *      委托方可用宽 = 167 − 8 − 78 = **81 < 90**（那条不变式是按真机 182 定的）。
       *      故这里只断言「委托方可见（> 0）」与公式吻合，**不放 ≥ 90** —— 不把不成立的数字写成契约。
       */
      const { ctx, page } = await seededPage({ width: VP_WORST, height: 900 });
      try {
        await spaGo(page, '/member-board');
        const b = await page.evaluate(measureBoard);
        expect(b, '应找到看板列 section').not.toBeNull();
        expect(b!.sectionW, `视口 ${VP_WORST} 的 section 应为 1028（= 4×245 + 3×16 的临界宽）`).toBe(1028);
        expect(b!.tracks.length, '临界宽下仍应恰好 4 轨（再窄一档就掉；见 N-05b/门槛）').toBe(4);
        for (const [i, t] of b!.tracks.entries()) {
          expect(t, `第 ${i + 1} 轨应正好等于基准 ${TRACK_BASE}`).toBe(TRACK_BASE);
        }

        const m = await page.evaluate(measureCard, { index: 0, clones: 0 });
        expect(m, '看板列内应有项目卡').not.toBeNull();
        expect(m!.cardW, `最坏轨下卡片应为 ${CARD_WORST}`).toBe(CARD_WORST);
        expect(m!.contentW, `最坏轨下内容宽应为 ${CONTENT_WORST}`).toBe(CONTENT_WORST);
        // 不越界四件（team-lead 点名的判据）
        expect(m!.scrollW, '卡内不得横向溢出').toBeLessThanOrEqual(m!.clientW + 1);
        expect(
          m!.titleNode,
          '标题仍应是"单行省略"那个 span（不许退回换行/溢出）',
        ).toContain('truncate');
        // ③ 到期日不截断 / ④ 胶囊不折行：两条都是**离散**判据 ⇒ **零容差**
        //    （文件头「判据纪律」；旧版 `+1` 的容差正好吞掉亚像素截断，实测需/可用 53/53）
        expect(
          m!.dueNeed - m!.dueAvail,
          `到期日不得截断（需 ${m!.dueNeed} ≤ 可用 ${m!.dueAvail}）`,
        ).toBeLessThanOrEqual(0);
        expect(m!.tagOverflow, '阶段胶囊不得折行').toBeLessThanOrEqual(0);
        expect(m!.avatarOverflow, '头像组右缘不得越过卡片内容盒右缘').toBeLessThanOrEqual(0.5);
        // 纵向与可见性
        expect(m!.boxOverflow, '卡内不得纵向溢出').toBeLessThanOrEqual(0);
        expect(m!.delegatorRowH, '委托方行必须可见').toBeGreaterThan(0);
        expect(m!.delegatorAvail, '委托方可用宽必须 > 0').toBeGreaterThan(0);

        await page.screenshot({
          path: resolve(SHOT_DIR, 'N-02b-1332-worst-track.png'),
          fullPage: false,
        });
      } finally {
        await ctx.close();
      }
    }, 120000);

    it('N-03 · 门控：首页（layout=row）卡片形态逐字节不变——头像仍在元信息行、委托方仍是单行 span', async () => {
      // 这一条守的是 `layout === 'column'` 这道门本身：窄版重排只许动看板列内的卡。
      // 若有人在共用路径上"顺手"改重排，首页卡片会跟着变——本用例当场变红。
      const { ctx, page } = await seededPage({ width: VP_REAL_WINDOW, height: 900 });
      try {
        await spaGo(page, '/');
        await page.waitForSelector('[role="button"].group', { timeout: 20000 });
        await page.waitForTimeout(600);
        const m = await page.evaluate(measureAnyCard);
        expect(m, '首页应有项目卡').not.toBeNull();
        expect(m!.delegatorNode, '首页（layout=row）的委托方仍是单行 span').toBe('span');
        expect(m!.avatarSpans, '首页卡片的头像仍在元信息行（1 个真实头像）').toBe(1);
        // 首页卡片不在看板列里，宽度由 flex-wrap 行决定（这里只钉「不是窄版 230」）
        expect(m!.cardW, '首页卡片不应变成看板列内的 230').toBeGreaterThan(260);
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
          // gen5：轨道**不再是定值**（`1fr` 均分该行），不变式是「每轨 ≥ 基准 245」+ 行内等宽。
          // 实测（探针 19）：960 ⇒ 288、1024 ⇒ 309.3、1152 ⇒ 260、1279 ⇒ 291.8（对应该档 section 宽）。
          expect(
            b!.tracks.every((t) => t >= TRACK_BASE),
            `视口 ${width} 每轨应 ≥ 基准 ${TRACK_BASE}（1fr 下轨道不低于 min），实测 ${JSON.stringify(b!.tracks)}`,
          ).toBe(true);
          expect(
            new Set(b!.tracks.map((t) => Math.round(t))).size,
            `视口 ${width} 行内各轨应等宽，实测 ${JSON.stringify(b!.tracks)}`,
          ).toBe(1);

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
       * `max=4`（旧值）下最坏格是 5 span ⇒ 组宽 96 ⇒ 委托方只剩 **78** < 90 ✗
       * （gen4 的 184 内容宽下是 80；gen5 卡片窄了 2px ⇒ 78）。
       *
       * ⚠️ 这一格**必须用真实渲染**证明，不能手搓一个胶囊：夹具每卡只有 1 个成员，
       *    N-02 那套"克隆 avatar span"合不出 `+N`（`+N` 是 `AvatarStack` 自己渲染的）。
       *    故这里把原夹具**派生**成「一个项目 5 个成员」（补 2 名成员 + 当前阶段任务的
       *    `assigneeIds` 指向全部 5 人），让 `AvatarStack` 真的收到 5 个成员。
       *    派生件写系统临时目录、用例结束即删（**不往 tests/fixtures 里加第二份 19KB 夹具**）。
       */
      const derived = buildFiveMemberFixture();
      const { ctx, page } = await seededPage({ width: VP_REAL_WINDOW, height: 900 }, derived.file);
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
        // 不变式本体：最坏格（含 `+N`）≥ 90。真机 1088（内容宽 182）实测 **96**。
        expect(
          Math.abs(m!.delegatorAvail - (CONTENT_REAL - 8 - avatarGroupWidth(4))),
          `最坏格委托方可用宽应等于 182 − 8 − 78 = ${CONTENT_REAL - 8 - avatarGroupWidth(4)}`,
        ).toBeLessThanOrEqual(1);
        expect(
          m!.delegatorAvail,
          '不变式：头像组处于最坏格（含 `+N`）时委托方可用宽 ≥ 90（实测 96）',
        ).toBeGreaterThanOrEqual(90);
        // 越界与溢出一起守（头像多了也不许把卡撑坏）
        expect(m!.avatarOverflow, '头像组右缘不得越过卡片内容盒').toBeLessThanOrEqual(0.5);
        expect(m!.boxOverflow, '最坏格下卡内仍不得纵向溢出').toBeLessThanOrEqual(0);
        expect(m!.cardH, `最坏格下卡高仍应为 ${CARD_H}`).toBe(CARD_H);

        await page.screenshot({
          path: resolve(SHOT_DIR, 'N-05-1392-five-members-max3.png'),
          fullPage: false,
        });
      } finally {
        await ctx.close();
        derived.cleanup();
      }
    }, 120000);
  },
);
