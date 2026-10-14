// @vitest-environment node
/**
 * 浮层关闭「频闪」回归闸 · **真 Chromium**（用户 2026-10-12：呼出设置后关闭设置会有频闪）。
 *
 * ══════════════════ 被锁住的两记亮度跳变 ══════════════════
 * 出口动画跑在**锚点容器**上（`drawer-out-left` / `dialog-pop-out`：opacity 1→0，
 * `fill-mode: both`）；遮罩（portal 根）是它的父级。修复前有两处缺陷、两记跳变：
 *   ① `usePresence.finish()` 在动画结束时**立刻摘掉出口类** ⇒ 元素回到动画前的
 *      `opacity: 1` ⇒ 卸载前那一帧面板整块弹回全亮（真机实测：冻在出口终态
 *      op 0.0082 / L 202，摘类后 op 1.0 / L 255，**ΔL = +53**，且元素仍 connected）。
 *   ② 遮罩**完全不参与出口** ⇒ portal 卸载那一帧整块遮罩消失，内容区亮度一帧跳变
 *      （实测 **L 202 → 255，ΔL = +53**）。
 * 修法：① 不再提前摘类；② 遮罩与面板**同帧起跑**一起淡出（`scrim-out`，只有 opacity）。
 *
 * ══════════════════ ⚠️ 判据的边界：像素「单调不回升」**不是**本族的正确判据 ══════════════════
 *
 * 这条独立成段，因为它**被写错过一次**，而写在仓库里的错判据比一句错代码更贵 ——
 * 它会被**读**，会被下一批照着抄。
 *
 * · 「出口期某点像素单调不回升」**只在「单层淡出」时成立**。
 *   team-lead 2026-10-12 最初给本批定的完成判据就是它，实测**抽屉那一块不成立**。
 * · 本族是**双层同时淡出**：面板（`*-out`）与遮罩（`scrim-out`）同速同缓动一起向
 *   **明亮的底层内容**透过去。合成色中途必然经过「面板白已退、遮罩暗还在」的
 *   **最暗混合点**，所以抽屉点必然是 **V 形**：真机实测
 *   255 → 243（t≈100–150 触底）→ 247 → 251 → 255。这是**数学必然，不是回归**。
 * · **正确判据是「无单帧阶跃」**：逐帧步进 ≤4 L（分散在 200ms 里），
 *   对上一帧 **+53**（修复前面板弹回 / 遮罩瞬消的那一帧）。
 *   「闪」与「淡」的分界线就在这儿：**同一个总变化量，摊在 200ms 里是淡，压进一帧是闪。**
 *
 * 🔴 **谁要是为了让抽屉点"单调"而去改遮罩时长（比如让遮罩只播 120ms），谁就是改坏了。**
 *    那是拿「动效语言的同源性」（`scrim-out` 与六组兄弟逐字同源：`--dur-base` +
 *    `--ease-exit` + `both`）去换一条写错的判据。本文件的所有断言都不依赖"单调"这个
 *    错误判据；下面 `assertMonotone` 之所以仍成立，是因为它量的是**单层**的
 *    `opacity`（面板一层、遮罩一层各自单调），**不是**合成像素。
 *    要改本族的观感，先改这条注释 —— 它是这一族判据的唯一出处。
 *
 * 附：本族正确的观感判据（如需再加闸，照这三条写）
 *   ① 两层各自 `opacity` 单调不增（`assertMonotone`，已锁）；
 *   ② 卸载前后**相邻两帧像素相等**（台阶 = 0，已锁：`assertMaskFadedBeforeGone` + 逐帧表）；
 *   ③ 任意相邻帧的像素差有上界（"无单帧阶跃"）—— 目前只有 freeze-at-t 的逐帧表为证，未固化成断言
 *      （原因：`page.screenshot` 采样间隔 ≈35ms > 单帧 17ms，做成断言会变成"看着在测、
 *      其实测不到"的假闸，见下方 ⑤ 的说明）。
 *
 * ══════════════════ 为什么必须真浏览器 / 判据为什么是离散的 ══════════════════
 * 这一帧只存在于**真实动画时序**里：jsdom 不跑 CSS 动画、`animationend` 不会自己来、
 * 也没有合成帧，opacity 是否被绘制过无从判定。所以用真产物 + 真 Chromium，逐帧采样放在
 * **页面内**用 rAF 做（跨进程往返会让 200ms 的窗口变成竞态）。
 * 判据一律**不带容差**：单调性是"后一帧 ≤ 前一帧"、离场是"类必须还在"、
 * 同帧起跑是"两层动画首次出现的**帧序号相等**"。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import { startServer, CAN_RUN_FRESH, CHROMIUM_PATH } from './helpers/board-env';

const HEAVY = 60000;

/** 页面内逐帧记录器：面板 + 遮罩两份读数、动画事件、几何 */
const INSTALL = `
window.__rec = { frames: [], events: [] };
window.__now = function () { return performance.timeOrigin + performance.now(); };
window.__pick = function (label) {
  var dlg = document.querySelector('[role="dialog"][aria-label="' + label + '"]');
  if (!dlg) return { dlg: null, anchor: null };
  return { dlg: dlg, anchor: dlg.firstElementChild };
};
window.__install = function () {
  if (window.__inst) return; window.__inst = 1;
  var onEv = function (type) { return function (e) {
    if (!window.__recording) return;
    var el = e.target;
    var cls = (el && el.classList) ? el.className : '';
    window.__rec.events.push({
      t: +window.__now().toFixed(1), type: type, name: e.animationName,
      onAnchor: String(cls).indexOf('outline-none') >= 0,
      onMask: !!(el && el.getAttribute && el.getAttribute('role') === 'dialog'),
    });
  }; };
  document.addEventListener('animationstart', onEv('start'), true);
  document.addEventListener('animationend', onEv('end'), true);
  document.addEventListener('animationcancel', onEv('cancel'), true);
};
window.__start = function (label, outClass) {
  window.__install();
  window.__label = label;
  window.__outClass = outClass;
  window.__rec = { frames: [], events: [] };
  window.__recording = true;
  var loop = function () {
    if (!window.__recording) return;
    var p = window.__pick(window.__label);
    var main = document.querySelector('main');
    var rd = function (el, cls) {
      if (!el) return null;
      var s = getComputedStyle(el);
      var an = [];
      try { an = el.getAnimations().map(function (a) { return a.animationName; }); } catch (e) {}
      return {
        opacity: +Number(s.opacity).toFixed(4),
        anims: an,
        hasOut: cls ? el.classList.contains(cls) : false,
      };
    };
    var dr = p.dlg ? p.dlg.getBoundingClientRect() : null;
    window.__rec.frames.push({
      t: +window.__now().toFixed(1),
      // ⚠️ 面板那一侧也要把**本档的出口类名**传进去 —— 传 null 会让 hasOut 恒为 false，
      //    使「出口类不得提前摘」这条判据永远空过（自己踩过：重写 recorder 时漏了这个参数）
      anchor: rd(p.anchor, window.__outClass),
      mask: rd(p.dlg, 'scrim-out'),
      maskRect: dr ? { left: +dr.left.toFixed(2), width: +dr.width.toFixed(2) } : null,
      contentLeft: main ? +main.getBoundingClientRect().left.toFixed(2) : null,
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};
window.__stop = function () { window.__recording = false; return window.__rec; };
window.__maskCorner = function (label) {
  var p = window.__pick(label);
  if (!p.dlg) return null;
  var r = p.dlg.getBoundingClientRect();
  return { x: Math.round(r.right - 40), y: Math.round(r.top + 40) };
};
`;

async function passFirstRun(page: Page): Promise<void> {
  if (await page.locator('button', { hasText: '我是管理员' }).count()) {
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '我是管理员')?.click();
    });
    await page.waitForTimeout(400);
    await page.locator('input[data-identity-name-input]').fill('探针官');
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('确认为管理员'))?.click();
    });
    await page.waitForTimeout(1000);
  }
  const skip = page.locator('button', { hasText: '先四处看看' });
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(600); }
}

async function openSettings(page: Page): Promise<void> {
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('[data-app-sidebar] button')).find((x) => x.getAttribute('aria-label') === '设置')?.click();
  });
  await page.waitForSelector('[data-settings-drawer]', { timeout: 10000 });
  await page.waitForTimeout(600); // 入场动画（200ms）播完并停在 both 终态
}

/** 打开设置 → 数据区 → 清空日志（center 档确认框） */
async function openClearLogConfirm(page: Page): Promise<void> {
  await openSettings(page);
  await page.click('[data-settings-zone="data"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '清空日志')?.click();
  });
  await page.waitForSelector('[data-settings-log-confirm]', { timeout: 5000 });
  await page.waitForTimeout(600);
}

interface Side {
  opacity: number;
  anims: string[];
  hasOut: boolean;
}
interface Frame {
  t: number;
  anchor: Side | null;
  mask: Side | null;
  maskRect: { left: number; width: number } | null;
  contentLeft: number | null;
}
interface Rec {
  frames: Frame[];
  events: { t: number; type: string; name: string; onAnchor: boolean; onMask: boolean }[];
}

/**
 * ★ 主判据（离散、无容差）：**出口期透明度单调不增**。
 *
 * 为什么不是"低于某阈值"：出口动画的 `from` 就是 `opacity: 1`，按阈值判会把开口那几帧
 * 正常的高透明度全判成违规（踩过）。真正要抓的是**回落**：修复前 `…0.130 → 1.0`。
 */
function assertMonotone(seq: Frame[], pick: (f: Frame) => Side | null, label: string): void {
  const rows = seq.map((f) => ({ t: f.t, s: pick(f) })).filter((r): r is { t: number; s: Side } => r.s !== null);
  expect(rows.length, `${label}：在场帧太少（判据空过）`).toBeGreaterThan(3);
  for (let i = 1; i < rows.length; i += 1) {
    expect(
      rows[i].s.opacity,
      `★ ${label} 透明度**回升**了（元素仍挂在 DOM 上就弹回动画前样式 = 用户报的「频闪」）：` +
        `t=${rows[i].t.toFixed(1)} ${rows[i - 1].s.opacity} → ${rows[i].s.opacity}`,
    ).toBeLessThanOrEqual(rows[i - 1].s.opacity);
  }
}

/** ★ 出口类不得在元素仍挂载时被摘掉（提前摘掉 ⇒ 弹回动画前样式） */
function assertClassHeld(seq: Frame[], pick: (f: Frame) => Side | null, label: string): void {
  let seen = false;
  const stripped: string[] = [];
  for (const f of seq) {
    const s = pick(f);
    if (s === null) break; // 卸载之后不再管
    if (s.hasOut) { seen = true; continue; }
    if (seen) stripped.push(`t=${f.t.toFixed(1)} opacity=${s.opacity}`);
  }
  expect(seen, `${label}：出口类从未出现 ⇒ 本用例空过`).toBe(true);
  expect(
    stripped.length,
    `★ ${label} 出口类在元素仍挂载时被摘掉了 ⇒ 会弹回动画前的样式（那一帧就是频闪）。违规帧：` +
      stripped.join(' | '),
  ).toBe(0);
}

/** ★ 两层必须**同帧起跑**：两个出口动画首次出现的帧序号必须相等 */
function assertSameFrameStart(seq: Frame[], aName: string, bName: string): void {
  const aIdx = seq.findIndex((f) => f.anchor !== null && f.anchor.anims.includes(aName));
  const bIdx = seq.findIndex((f) => f.mask !== null && f.mask.anims.includes(bName));
  expect(aIdx, `面板出口动画 ${aName} 从未出现`).toBeGreaterThanOrEqual(0);
  expect(bIdx, `遮罩出口动画 ${bName} 从未出现`).toBeGreaterThanOrEqual(0);
  expect(
    bIdx,
    `★ 遮罩与面板的出口动画没有同帧起跑（${aName} 首帧 #${aIdx} vs ${bName} 首帧 #${bIdx}）` +
      ` ⇒ 卸载时其中一层还停在半透明上，仍留台阶`,
  ).toBe(aIdx);
}

/** ★ 遮罩必须在被卸载前淡到几乎全透明（否则卸载那一帧就是那记 ΔL=+53 的台阶） */
function assertMaskFadedBeforeGone(seq: Frame[]): void {
  const last = [...seq].reverse().find((f) => f.mask !== null);
  expect(last, '遮罩从未出现在场帧').toBeTruthy();
  expect(
    last!.mask!.opacity,
    `★ 遮罩在被卸载前只淡到 ${last!.mask!.opacity}（应 ≈0）⇒ 卸载那一帧内容区会突然变亮`,
  ).toBeLessThanOrEqual(0.05);
}

async function closeAndRecord(
  page: Page,
  label: string,
  how: 'x' | 'esc' | 'mask',
  closeLabel: string,
  outClass: string,
): Promise<Rec> {
  const coords = await page.evaluate(
    ([l, cl]) => ({
      close: ((): { x: number; y: number } | null => {
        const dlg = document.querySelector(`[role="dialog"][aria-label="${l}"]`);
        const b = dlg?.querySelector(`button[aria-label="${cl}"]`);
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      })(),
      mask: (window as any).__maskCorner(l) as { x: number; y: number } | null,
    }),
    [label, closeLabel] as const,
  );
  await page.evaluate(([l, o]) => (window as any).__start(l, o), [label, outClass] as const);
  if (how === 'x') await page.mouse.click(coords.close!.x, coords.close!.y);
  else if (how === 'esc') await page.keyboard.press('Escape');
  else await page.mouse.click(coords.mask!.x, coords.mask!.y);
  await page.waitForTimeout(700);
  return (await page.evaluate(() => (window as any).__stop())) as Rec;
}

describe.skipIf(!CAN_RUN_FRESH)('浮层关闭频闪 · 真 Chromium 逐帧', () => {
  let browser: Browser;
  let server: { url: string; close(): Promise<void> };

  beforeAll(async () => {
    server = await startServer();
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
  }, HEAVY);
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function openApp(): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(server.url);
    await page.waitForSelector('header', { timeout: 20000 });
    await page.waitForTimeout(800);
    await passFirstRun(page);
    await page.addScriptTag({ content: INSTALL });
    return { ctx, page };
  }

  it('① 设置抽屉（left-rail）：三种关闭方式，面板与遮罩透明度**均单调不增**', async () => {
    const { ctx, page } = await openApp();
    try {
      for (const how of ['x', 'esc', 'mask'] as const) {
        await openSettings(page);
        const rec = await closeAndRecord(page, '设置', how, '关闭设置', 'drawer-out-left');
        const starts = rec.events.filter((e) => e.type === 'start').map((e) => e.name);
        console.log(`[${how}] 帧=${rec.frames.length} 出口起点=${JSON.stringify(starts)}`);
        expect(starts, `[${how}] 出口类从未挂上 ⇒ 出口路径没走`).toContain('drawer-out-left');
        assertMonotone(rec.frames, (f) => f.anchor, `[${how}] 面板`);
        assertMonotone(rec.frames, (f) => f.mask, `[${how}] 遮罩`);
        assertMaskFadedBeforeGone(rec.frames);
      }
    } finally {
      await ctx.close();
    }
  }, 180000);

  it('② 两层同帧起跑（面板 + 遮罩），且各自只 start 一次', async () => {
    const { ctx, page } = await openApp();
    try {
      await openSettings(page);
      const rec = await closeAndRecord(page, '设置', 'x', '关闭设置', 'drawer-out-left');
      assertSameFrameStart(rec.frames, 'drawer-out-left', 'scrim-out');
      const a = rec.events.filter((e) => e.type === 'start' && e.name === 'drawer-out-left' && e.onAnchor);
      const s = rec.events.filter((e) => e.type === 'start' && e.name === 'scrim-out' && e.onMask);
      console.log(`animationstart：面板 drawer-out-left=${a.length}，遮罩 scrim-out=${s.length}`);
      expect(a.length, '面板出口动画重放').toBe(1);
      expect(s.length, '遮罩出口动画重放').toBe(1);
    } finally {
      await ctx.close();
    }
  }, 90000);

  it('③ 关闭全过程：内容区左边缘与遮罩几何**零位移**', async () => {
    const { ctx, page } = await openApp();
    try {
      await openSettings(page);
      const rec = await closeAndRecord(page, '设置', 'x', '关闭设置', 'drawer-out-left');
      const contentLefts = Array.from(new Set(rec.frames.map((f) => f.contentLeft)));
      const maskLefts = Array.from(new Set(rec.frames.filter((f) => f.maskRect).map((f) => f.maskRect!.left)));
      const maskWidths = Array.from(new Set(rec.frames.filter((f) => f.maskRect).map((f) => f.maskRect!.width)));
      console.log(
        `内容区 left=${JSON.stringify(contentLefts)}；遮罩 left=${JSON.stringify(maskLefts)}；遮罩宽=${JSON.stringify(maskWidths)}`,
      );
      expect(contentLefts.length, `内容区左边缘动了：${JSON.stringify(contentLefts)}`).toBe(1);
      expect(maskLefts.length, `遮罩左缘被重算：${JSON.stringify(maskLefts)}`).toBe(1);
      expect(maskWidths.length, `遮罩宽度被重算：${JSON.stringify(maskWidths)}`).toBe(1);
    } finally {
      await ctx.close();
    }
  }, 90000);

  it('④ 关闭后元素确实卸载（不许用"留在 DOM"消症状）', async () => {
    const { ctx, page } = await openApp();
    try {
      await openSettings(page);
      await page.evaluate(() => {
        (document.querySelector('button[aria-label="关闭设置"]') as HTMLButtonElement | null)?.click();
      });
      await page.waitForFunction(() => document.querySelector('[data-settings-drawer]') === null, undefined, {
        timeout: 2000,
      });
      expect(await page.evaluate(() => document.querySelector('[data-settings-drawer]'))).toBeNull();
    } finally {
      await ctx.close();
    }
  }, 90000);

  it('⑤ 面板与遮罩的出口类都不得在仍挂载时被摘掉', async () => {
    const { ctx, page } = await openApp();
    try {
      await openSettings(page);
      const rec = await closeAndRecord(page, '设置', 'esc', '关闭设置', 'drawer-out-left');
      assertClassHeld(rec.frames, (f) => f.anchor, '面板 drawer-out-left');
      assertClassHeld(rec.frames, (f) => f.mask, '遮罩 scrim-out');
    } finally {
      await ctx.close();
    }
  }, 90000);

  it('⑥ center 档（dialog-pop-out）：形态不同、同一路径，判据同样成立', async () => {
    const { ctx, page } = await openApp();
    try {
      await openClearLogConfirm(page);
      const rec = await closeAndRecord(page, '清空日志', 'esc', '关闭', 'dialog-pop-out');
      const starts = rec.events.filter((e) => e.type === 'start').map((e) => e.name);
      console.log(`[center] 帧=${rec.frames.length} 出口起点=${JSON.stringify(starts)}`);
      expect(starts, '[center] 出口类没挂上 ⇒ 出口路径没走').toContain('dialog-pop-out');
      assertMonotone(rec.frames, (f) => f.anchor, '[center] 面板');
      assertMonotone(rec.frames, (f) => f.mask, '[center] 遮罩');
      assertClassHeld(rec.frames, (f) => f.anchor, '[center] 面板 dialog-pop-out');
      assertClassHeld(rec.frames, (f) => f.mask, '[center] 遮罩 scrim-out');
      assertSameFrameStart(rec.frames, 'dialog-pop-out', 'scrim-out');
      assertMaskFadedBeforeGone(rec.frames);
    } finally {
      await ctx.close();
    }
  }, 120000);
});
