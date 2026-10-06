/**
 * wc-probe-runner.tmp.mjs —— 一次性探针（跑完即删）。
 * 启动真实 ID Plan（build-dist + electron/main.cjs），挂 CDP，
 * 在三键位置真实派发鼠标事件，记录 DOM 是否收到 + elementFromPoint 结果。
 *
 * 判别逻辑：
 *  - elementFromPoint=按钮 但 DOM 收不到事件 ⇒ 被 OS/合成层拦截（如 resize border）
 *  - elementFromPoint≠按钮                         ⇒ 图层/pointer-events 问题
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = 'E:/workbuddy/2026-08-27-15-18-25/changxia';
const EXE = `${REPO}/node_modules/electron/dist/electron.exe`;
const OUT = `${REPO}/wc-probe-result.tmp.json`;

const LOG = (...a) => console.log('[probe]', ...a);

const child = spawn(EXE, ['.', '--remote-debugging-port=0', `--user-data-dir=${REPO}/tmp/wc-probe-profile`], {
  cwd: REPO,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: (() => { const e = { ...process.env }; delete e.ELECTRON_RUN_AS_NODE; return e; })(),
});

let wsUrl = '';
const grab = (s) => { const m = String(s).match(/DevTools listening on (ws:\/\/\S+)/); if (m) wsUrl = m[1]; };
child.stdout.on('data', (d) => grab(d));
child.stderr.on('data', (d) => grab(d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getBrowser() {
  for (let i = 0; i < 120 && !wsUrl; i++) await sleep(200);
  if (!wsUrl) throw new Error('DevTools ws url not found');
  LOG('ws:', wsUrl);
  return chromium.connectOverCDP(wsUrl);
}

const browser = await getBrowser();
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];
page.on('pageerror', (e) => LOG('pageerror:', String(e).slice(0, 200)));

// 种子身份（fresh profile 免首启闸门），再重载
await page.evaluate(() => localStorage.setItem('changxia.currentMemberId', 'probe-1'));
await page.reload({ waitUntil: 'load' });
await sleep(2500);

// 等三键渲染（win32 + isDesktop 门控）
await page.waitForSelector('[data-window-control]', { timeout: 40000 });
LOG('three buttons rendered');
await sleep(1500);

// 关掉可能的首启弹窗（空库欢迎卡）
for (let i = 0; i < 3; i++) {
  const dialogs = await page.locator('[role="dialog"]').count();
  if (dialogs === 0) break;
  await page.keyboard.press('Escape');
  await sleep(600);
}
await sleep(500);

// 安装 capture 阶段全量鼠标事件日志
await page.evaluate(() => {
  window.__ev = [];
  for (const t of ['mousedown', 'mouseup', 'click']) {
    document.addEventListener(
      t,
      (e) => {
        const path = e
          .composedPath()
          .slice(0, 4)
          .map((n) =>
            n && n.nodeType === 1
              ? `${n.nodeName.toLowerCase()}${n.getAttribute && n.getAttribute('data-window-control') ? '[' + n.getAttribute('data-window-control') + ']' : ''}${n.className && typeof n.className === 'string' && n.className ? '.' + n.className.split(' ').slice(0, 3).join('.') : ''}`
              : String(n && n.nodeName),
          );
        window.__ev.push({ t, x: Math.round(e.clientX), y: Math.round(e.clientY), path });
      },
      true,
    );
  }
});

const vw = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
LOG('client area:', JSON.stringify(vw));

const results = [];
async function probe(label, x, y) {
  await page.evaluate(() => { window.__ev.length = 0; });
  // elementFromPoint 在该坐标的命中
  const hit = await page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (!el) return 'NULL';
    const wc = el.getAttribute && el.getAttribute('data-window-control');
    return wc ? `WC[${wc}]` : `${el.nodeName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 4).join('.') : ''}`;
  }, [x, y]);
  try {
    await page.mouse.click(x, y);
  } catch (e) {
    results.push({ label, x, y, hit, err: String(e).slice(0, 120) });
    return;
  }
  await sleep(150);
  const evs = await page.evaluate(() => window.__ev.slice());
  const bounds = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, sw: window.scrollX, sy: window.scrollY }));
  results.push({
    label,
    x,
    y,
    hit,
    received: evs.length,
    kinds: evs.map((e) => `${e.t}@${e.x},${e.y}`),
    paths: evs.length ? evs[0].path : null,
    bounds,
  });
  LOG(`${label} (${x},${y}) hit=${hit} received=${evs.length} ${evs.length ? JSON.stringify(evs[0].path) : ''} bounds=${JSON.stringify(bounds)}`);
}

// ── 状态 A：无弹窗 ──────────────────────────────
await probe('A.center-minimize', vw.w - 115, 33);
await probe('A.center-maximize', vw.w - 69, 33);
await probe('A.center-close', vw.w - 23, 33);
await probe('A.close.top0', vw.w - 23, 0);
await probe('A.close.top1', vw.w - 23, 1);
await probe('A.close.top2', vw.w - 23, 2);
await probe('A.close.top4', vw.w - 23, 4);
await probe('A.close.top6', vw.w - 23, 6);
await probe('A.close.top8', vw.w - 23, 8);
await probe('A.close.top12', vw.w - 23, 12);
await probe('A.close.right1', vw.w - 1, 33);
await probe('A.close.right2', vw.w - 2, 33);
await probe('A.close.right4', vw.w - 4, 33);
await probe('A.min.top1', vw.w - 115, 1);
await probe('A.max.top1', vw.w - 69, 1);
await probe('A.corner1x1', vw.w - 1, 1);
await probe('A.corner2x2', vw.w - 2, 2);
await probe('A.corner4x4', vw.w - 4, 4);

// ── 状态 B：设置弹窗打开 ──────────────────────────
const opened = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '设置');
  if (!btn) return 'no-settings-btn';
  btn.click();
  return 'clicked';
});
LOG('open settings:', opened);
await sleep(900);
const modalCount = await page.locator('[role="dialog"]').count();
LOG('dialog count:', modalCount);
await probe('B.center-close', vw.w - 23, 33);
await probe('B.center-minimize', vw.w - 115, 33);
await probe('B.close.top2', vw.w - 23, 2);

// ── 状态 C：页面滚动后 ──────────────────────────
await page.keyboard.press('Escape');
await sleep(600);
await page.evaluate(() => window.scrollTo(0, 1600));
await sleep(800);
const sy = await page.evaluate(() => window.scrollY);
LOG('scrolled to:', sy);
await probe('C.center-close', vw.w - 23, 33);
await probe('C.center-minimize', vw.w - 115, 33);

// ── maximize 广播验证 ──────────────────────────
const maximizeBroadcast = await page.evaluate(async () => {
  const seen = [];
  const off = window.idplan?.windowControls?.onMaximizeChange?.((v) => seen.push(v));
  const before = await window.idplan.windowControls.isMaximized();
  window.idplan.windowControls.toggleMaximize();
  await new Promise((r) => setTimeout(r, 900));
  const after = await window.idplan.windowControls.isMaximized();
  await new Promise((r) => setTimeout(r, 400));
  off && off();
  return { before, after, seen };
});
LOG('maximize broadcast:', JSON.stringify(maximizeBroadcast));
results.push({ label: 'D.maximize-broadcast', ...maximizeBroadcast });

// ── window blur 后再点击（移开焦点再回来）──────────
// 用 CDP 把另一个窗口带前台不可行，改为最小化再还原后点击
try {
  await page.evaluate(() => window.idplan.windowControls.toggleMaximize()); // 还原尺寸
  await sleep(400);
} catch {}
await probe('E.after-restore.close', vw.w - 23, 33);

writeFileSync(OUT, JSON.stringify(results, null, 2));
LOG('written:', OUT);

await browser.close().catch(() => {});
child.kill();
await sleep(500);
process.exit(0);
