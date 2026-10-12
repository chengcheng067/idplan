// @vitest-environment node
/**
 * 设置抽屉「关闭频闪」回归闸 · **真 Chromium**（用户 2026-10-12：呼出设置后再关闭会有频闪）。
 *
 * ══════════════════ 被锁住的那一帧 ══════════════════
 * 出口动画跑在**锚点容器**上（`drawer-out-left`：opacity 1→0、translateX 0→-24px，
 * `fill-mode: both`）。`usePresence.finish()` 原来在动画结束时**立刻摘掉出口类**，
 * 而摘掉类 = 元素回到**动画前**的样式 = `opacity: 1`。于是「动画结束」与「React 真正
 * 卸载」之间那一帧，屏幕上就是**整块面板从几乎透明弹回全不透明** —— 用户说的频闪。
 *
 * 真机实测（修复前，逐帧）：出口 200ms 里 opacity 1→0.987→…→0.130 单调下降，
 * 动画结束那一帧直接跳回 **1.0**，再下一帧才随卸载消失；冻结动画后只做"摘类"这一步，
 * 同一像素 rgb(200,202,206)L=202/op0.0082 → rgb(255,255,255)L=255/op1.0，**ΔL=+53**。
 *
 * ══════════════════ 为什么必须真浏览器 / 为什么判据是离散的 ══════════════════
 * 这一帧只存在于**真实的动画时序**里：jsdom 不跑 CSS 动画、`animationend` 不会自己来、
 * 也没有合成帧，`opacity` 是不是被绘制过根本无从判定。所以这里用真产物 + 真 Chromium，
 * 且逐帧采样放在**页面内**用 rAF 做（跨进程往返会让 200ms 的窗口变成竞态）。
 * 判据一律**不带容差**：opacity 阈值取 0.5（修复前那一帧恰好是 1.0，20 倍余量）、
 * `animationstart` 取**次数**、几何取**完全相等**。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import { startServer, CAN_RUN_FRESH, CHROMIUM_PATH } from './helpers/board-env';

const HEAVY = 60000;

/** 页面内逐帧记录器：动画事件 + 元素在场/类名/透明度 + 几何 */
const INSTALL = `
window.__rec = { frames: [], events: [] };
window.__now = function () { return performance.timeOrigin + performance.now(); };
window.__install = function () {
  if (window.__inst) return; window.__inst = 1;
  var onEv = function (type) { return function (e) {
    if (!window.__recording) return;
    var el = e.target;
    window.__rec.events.push({
      t: +window.__now().toFixed(1), type: type, name: e.animationName,
      isAnchor: !!(el && el.classList && el.classList.contains('outline-none')),
    });
  }; };
  document.addEventListener('animationstart', onEv('start'), true);
  document.addEventListener('animationend', onEv('end'), true);
  document.addEventListener('animationcancel', onEv('cancel'), true);
};
window.__start = function () {
  window.__install();
  window.__rec = { frames: [], events: [] };
  window.__recording = true;
  var loop = function () {
    if (!window.__recording) return;
    var mask = document.querySelector('[role="dialog"][aria-label="设置"]');
    var anchor = mask ? mask.firstElementChild : null;
    var main = document.querySelector('main');
    var s = anchor ? getComputedStyle(anchor) : null;
    var mr = mask ? mask.getBoundingClientRect() : null;
    window.__rec.frames.push({
      t: +window.__now().toFixed(1),
      connected: anchor !== null,
      hasExit: anchor ? anchor.classList.contains('drawer-out-left') : false,
      opacity: s ? +Number(s.opacity).toFixed(4) : null,
      maskPresent: mask !== null,
      maskLeft: mr ? +mr.left.toFixed(2) : null,
      maskWidth: mr ? +mr.width.toFixed(2) : null,
      contentLeft: main ? +main.getBoundingClientRect().left.toFixed(2) : null,
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};
window.__stop = function () { window.__recording = false; return window.__rec; };
window.__closeXY = function () {
  var b = document.querySelector('button[aria-label="关闭设置"]');
  if (!b) return null;
  var r = b.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
};
window.__maskCorner = function () {
  var m = document.querySelector('[role="dialog"][aria-label="设置"]');
  if (!m) return null;
  var r = m.getBoundingClientRect();
  return { x: Math.round(r.right - 40), y: Math.round(r.top + 40) };
};
`;

async function passFirstRun(page: Page): Promise<void> {
  if (await page.locator('button', { hasText: '我是管理员' }).count()) {
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '我是管理员')?.click();
    });
    await page.waitForTimeout(400);
    await page.locator('input[placeholder="你的姓名"]').fill('探针官');
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

interface Frame {
  t: number;
  connected: boolean;
  hasExit: boolean;
  opacity: number | null;
  maskPresent: boolean;
  maskLeft: number | null;
  maskWidth: number | null;
  contentLeft: number | null;
}
interface Rec {
  frames: Frame[];
  events: { t: number; type: string; name: string; isAnchor: boolean }[];
}

/** 关一次、逐帧录完，返回记录（关闭方式：x / esc / mask） */
async function closeAndRecord(page: Page, how: 'x' | 'esc' | 'mask'): Promise<Rec> {
  await openSettings(page);
  const coords = await page.evaluate(() => ({
    close: (window as any).__closeXY(),
    mask: (window as any).__maskCorner(),
  }));
  expect(coords.close, '抽屉头部应有「关闭设置」按钮').not.toBeNull();
  expect(coords.mask, '取不到遮罩取样点').not.toBeNull();

  await page.evaluate(() => (window as any).__start());
  if (how === 'x') await page.mouse.click(coords.close!.x, coords.close!.y);
  else if (how === 'esc') await page.keyboard.press('Escape');
  else await page.mouse.click(coords.mask!.x, coords.mask!.y);
  await page.waitForTimeout(700);
  return (await page.evaluate(() => (window as any).__stop())) as Rec;
}

describe.skipIf(!CAN_RUN_FRESH)('关闭频闪 · 真 Chromium 逐帧', () => {
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

  /**
   * ★ 本批主判据：**出口期透明度必须单调不增**（逐帧、rAF 精度、不带容差）。
   *
   * 为什么是"单调"而不是"小于某个阈值"：出口动画的 `from` 就是 `opacity: 1`
   * （踩过——按阈值判会把开口那几帧正常的高透明度全判成违规），所以要抓的是
   * **回落**：修复前 `…0.130 → 1.0`（动画结束那一帧 `finish()` 提前摘掉出口类，
   * 元素弹回动画前样式），修复后 `1 → 0.987 → … → 0.008` 一路不回头。
   *
   * ⚠️ 为什么不用"像素时序单调"当闸：那一帧只存在 ~17ms（60Hz 一帧），而
   * `page.screenshot` 单点采样的间隔约 35ms ⇒ 抓到与否全靠运气，断言会变成
   * "看着在测、其实测不到"的假闸。像素证据改为**打印**（见 ⑤），判红交给这条
   * 帧同步的 opaque 判据。
   */
  function assertMonotoneExit(rec: Rec): { frames: Frame[]; lowest: number } {
    let exitStarted = false;
    const seq: Frame[] = [];
    for (const f of rec.frames) {
      if (f.hasExit) exitStarted = true;
      if (!exitStarted) continue;
      if (!f.connected) continue;
      if (f.opacity === null) continue;
      seq.push(f);
    }
    expect(seq.length, '出口期在场帧数太少（判据空过）').toBeGreaterThan(3);
    for (let i = 1; i < seq.length; i += 1) {
      expect(
        seq[i].opacity,
        `★ 出口期透明度**回升**了（元素仍挂在 DOM 上就弹回动画前样式 = 用户报的「频闪」）：` +
          `t=${seq[i].t.toFixed(1)} ${seq[i - 1].opacity} → ${seq[i].opacity}`,
      ).toBeLessThanOrEqual(seq[i - 1].opacity!);
    }
    const lowest = Math.min(...seq.map((f) => f.opacity!));
    return { frames: seq, lowest };
  }

  it('① 三种关闭方式：出口期透明度**单调不增**（无回弹帧）', async () => {
    const { ctx, page } = await openApp();
    try {
      for (const how of ['x', 'esc', 'mask'] as const) {
        const rec = await closeAndRecord(page, how);
        const withExit = rec.frames.filter((f) => f.hasExit).length;
        const exitEnd = rec.events.find((e) => e.type === 'end' && e.name === 'drawer-out-left');
        console.log(
          `[${how}] 帧=${rec.frames.length} 含出口类的帧=${withExit} 出口事件=${rec.events
            .map((e) => `${e.type}:${e.name}`)
            .join(',')}`,
        );
        expect(withExit, `[${how}] 出口类从未挂上 ⇒ 出口路径没走`).toBeGreaterThan(0);
        expect(exitEnd, `[${how}] drawer-out-left 没有 animationend，出口没播完`).toBeTruthy();
        const { lowest } = assertMonotoneExit(rec);
        console.log(`[${how}] 出口期最低透明度=${lowest}`);
      }
    } finally {
      await ctx.close();
    }
  }, 180000);

  it('⑤ 出口动画结束后元素仍持有出口类，直到被卸载（不许提前摘掉 ⇒ 不许弹回）', async () => {
    const { ctx, page } = await openApp();
    try {
      await openSettings(page);
      const px = async (): Promise<number> => {
        const buf = await page.screenshot({ clip: { x: 560, y: 500, width: 1, height: 1 } });
        let pos = 8;
        let colorType = 0;
        const idat: Buffer[] = [];
        while (pos < buf.length) {
          const len = buf.readUInt32BE(pos);
          const type = buf.toString('ascii', pos + 4, pos + 8);
          const data = buf.subarray(pos + 8, pos + 8 + len);
          if (type === 'IHDR') colorType = data[9];
          else if (type === 'IDAT') idat.push(data);
          else if (type === 'IEND') break;
          pos += 12 + len;
        }
        const raw = require('node:zlib').inflateSync(Buffer.concat(idat)) as Buffer;
        const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
        const p = raw.subarray(1, 1 + bpp);
        return Math.round(0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]);
      };
      const before = await px();
      await page.evaluate(() => (window as any).__start());
      await page.evaluate(() => {
        (document.querySelector('button[aria-label="关闭设置"]') as HTMLButtonElement | null)?.click();
      });
      await page.waitForTimeout(700);
      const rec = (await page.evaluate(() => (window as any).__stop())) as Rec;
      const afterGone = await px();

      // ★ 判据（离散）：出口动画**开始之后**，只要元素还 connected，出口类就必须还在。
      //   修复前那一帧正是「类已摘掉、元素还在」⇒ 必红（元素随即弹回动画前的 opacity:1）。
      expect(rec.frames.some((f) => f.hasExit), '出口类从未出现 ⇒ 本用例空过').toBe(true);
      let seenExit = false;
      const stripped: Frame[] = [];
      for (const f of rec.frames) {
        if (f.hasExit) { seenExit = true; continue; }
        if (seenExit && f.connected) stripped.push(f);
      }
      expect(
        stripped.length,
        `★ 出口类在元素仍挂载时被摘掉了 ⇒ 元素会弹回动画前的样式（那一帧就是频闪）。违规帧：` +
          stripped.map((f) => `t=${f.t.toFixed(1)} opacity=${f.opacity}`).join(' | '),
      ).toBe(0);

      // 像素证据（打印，不判红）：修复前这里是 255（弹回全白）；修复后应一路 ≤ 关闭前
      console.log(
        `[⑤ 像素证据] 关闭前=${before} 卸载后=${afterGone} 出口期透明度序列=${JSON.stringify(
          rec.frames.filter((f) => f.hasExit).map((f) => f.opacity),
        )}`,
      );
    } finally {
      await ctx.close();
    }
  }, 120000);

  it('② 同一个出口动画在同一个元素上只 start 一次（不是重放造成的闪）', async () => {
    const { ctx, page } = await openApp();
    try {
      const rec = await closeAndRecord(page, 'x');
      const starts = rec.events.filter((e) => e.type === 'start' && e.name === 'drawer-out-left' && e.isAnchor);
      console.log(`drawer-out-left 在锚点上的 animationstart 次数 = ${starts.length}`);
      expect(starts.length, '出口动画重放了（同一动画名同一元素多次 start）').toBe(1);
    } finally {
      await ctx.close();
    }
  }, 90000);

  it('③ 关闭全过程：内容区左边缘与遮罩几何**零位移**', async () => {
    const { ctx, page } = await openApp();
    try {
      const rec = await closeAndRecord(page, 'x');
      const contentLefts = Array.from(new Set(rec.frames.map((f) => f.contentLeft)));
      const maskLefts = Array.from(new Set(rec.frames.filter((f) => f.maskPresent).map((f) => f.maskLeft)));
      const maskWidths = Array.from(new Set(rec.frames.filter((f) => f.maskPresent).map((f) => f.maskWidth)));
      console.log(`内容区 left 取值=${JSON.stringify(contentLefts)}；遮罩 left=${JSON.stringify(maskLefts)}；遮罩宽=${JSON.stringify(maskWidths)}`);
      expect(contentLefts.length, `内容区左边缘在关闭过程中动了：${JSON.stringify(contentLefts)}`).toBe(1);
      expect(maskLefts.length, `遮罩左缘在关闭过程中被重算：${JSON.stringify(maskLefts)}`).toBe(1);
      expect(maskWidths.length, `遮罩宽度在关闭过程中被重算：${JSON.stringify(maskWidths)}`).toBe(1);
    } finally {
      await ctx.close();
    }
  }, 90000);

  it('④ 关闭后元素确实卸载（不许用"留在 DOM"来消症状）', async () => {
    const { ctx, page } = await openApp();
    try {
      await openSettings(page);
      await page.evaluate(() => {
        (document.querySelector('button[aria-label="关闭设置"]') as HTMLButtonElement | null)?.click();
      });
      await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="设置"]') === null, undefined, {
        timeout: 2000,
      });
      expect(
        await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="设置"]')),
        '关闭后 2s 内抽屉仍留在 DOM',
      ).toBeNull();
    } finally {
      await ctx.close();
    }
  }, 90000);

});
