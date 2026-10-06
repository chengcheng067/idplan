/**
 * wc-replica-runner.tmp.mjs —— 一次性探针（跑完即删）。
 * 启动复刻窗口 + PowerShell 真实 OS 输入，测试三键区域的真实可达性。
 */
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPO = 'E:/workbuddy/2026-08-27-15-18-25/changxia';
const EXE = `${REPO}/node_modules/electron/dist/electron.exe`;
const PS = `${REPO}/wc-click.tmp.ps1`;
const OUT = `${REPO}/wc-replica-result.tmp.json`;
const LOG = (...a) => console.log('[p2]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EXE, ['wc-replica.tmp.cjs', '--remote-debugging-port=0', `--user-data-dir=${REPO}/tmp/wc-replica-profile`], {
  cwd: REPO,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: (() => { const e = { ...process.env }; delete e.ELECTRON_RUN_AS_NODE; return e; })(),
});
let wsUrl = '';
const grab = (s) => { const m = String(s).match(/DevTools listening on (ws:\/\/\S+)/); if (m) wsUrl = m[1]; };
child.stdout.on('data', grab);
child.stderr.on('data', grab);
for (let i = 0; i < 120 && !wsUrl; i++) await sleep(200);
if (!wsUrl) { console.error('no ws'); child.kill(); process.exit(1); }

const browser = await chromium.connectOverCDP(wsUrl);
const page = browser.contexts()[0].pages()[0];
await page.waitForSelector('[data-window-control]', { timeout: 30000 });
await sleep(1200);

const results = [];
let origin = null;

async function ps(args) {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, encoding: 'utf8' });
  if (r.error || r.stderr) LOG('PS stderr:', String(r.stderr || r.error).slice(0, 300));
  return String(r.stdout || '');
}

async function realClick(label, clientX, clientY) {
  // 阶段 1：重置窗口 + 取 client 原点
  const o = await ps(['-Mode', origin?.skipReset ? 'origin-nr' : 'origin', '-ProcId', String(child.pid)]);
  const m = o.match(/ORIGIN (\d+) (\d+) CLIENT (\d+) (\d+) FG (\w+)/);
  if (!m) { results.push({ label, error: 'origin failed: ' + o }); LOG(`${label} ORIGIN FAIL ${o}`); return; }
  const [, ox, oy, cw, ch, fg] = m;
  origin = { ox: +ox, oy: +oy, cw: +cw, ch: +ch, fg: fg === 'True' };
  const w = +cw;
  if (!origin.fg) LOG(`${label} WARN foreground=false`);
  const scrX = +ox + clientX, scrY = +oy + clientY;
  const hit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return 'NULL';
    const wc = el.getAttribute && el.getAttribute('data-window-control');
    return wc ? `WC[${wc}]` : `${el.nodeName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 3).join('.') : ''}`;
  }, [clientX, clientY]);
  await page.evaluate(() => { window.__ev.length = 0; window.__wc.length = 0; });
  // 阶段 2：真实点击
  await ps(['-Mode', 'click', '-ProcId', String(child.pid), '-X', String(scrX), '-Y', String(scrY)]);
  await sleep(750);
  const got = await page.evaluate(() => ({ ev: window.__ev.slice(), wc: window.__wc.slice(), ow: window.outerWidth, oh: window.outerHeight, sx: window.screenX, sy: window.screenY }));
  const r = {
    label, clientX, clientY, screen: [scrX, scrY], hit, fg: origin.fg,
    domEvents: got.ev.length, firstPath: got.ev[0]?.p ?? null,
    wc: got.wc,
    after: { ow: got.ow, oh: got.oh, sx: got.sx, sy: got.sy },
  };
  results.push(r);
  LOG(`${label} (${clientX},${clientY}) hit=${hit} ev=${r.domEvents} wc=${JSON.stringify(r.wc)} after=${JSON.stringify(r.after)}`);
}

// ── 状态 A：restored，无遮罩 ──────────────────────
// ★ 正向对照：页面正中大按钮（远离一切窗口边缘）
const ctrl = await page.evaluate(() => { const r = document.getElementById('controlBtn').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
LOG('control btn at:', JSON.stringify(ctrl));
await realClick('CTRL.controlBtn', ctrl.x, ctrl.y);
const w = origin.cw; // client 宽（PS 返回的 GetClientRect）
LOG('origin:', JSON.stringify(origin), 'w =', w);
// ★ 对照2：header 拖拽区空白处（真实输入下 drag 区是否收到事件）
await realClick('CTRL.header-drag', 600, 33);
await realClick('A.close.center', w - 23, 33);
await realClick('A.min.center', w - 115, 33);
await realClick('A.max.center', w - 69, 33);
await realClick('A.close.top0', w - 23, 0);
await realClick('A.close.top1', w - 23, 1);
await realClick('A.close.top2', w - 23, 2);
await realClick('A.close.top3', w - 23, 3);
await realClick('A.close.top4', w - 23, 4);
await realClick('A.close.top6', w - 23, 6);
await realClick('A.close.top8', w - 23, 8);
await realClick('A.close.top10', w - 23, 10);
await realClick('A.min.top1', w - 115, 1);
await realClick('A.min.top4', w - 115, 4);
await realClick('A.max.top2', w - 69, 2);
await realClick('A.close.right1', w - 1, 33);
await realClick('A.close.right2', w - 2, 33);
await realClick('A.close.right4', w - 4, 33);
await realClick('A.close.right8', w - 8, 33);
await realClick('A.corner1', w - 1, 1);
await realClick('A.corner2', w - 2, 2);
await realClick('A.corner4', w - 4, 4);
await realClick('A.corner8', w - 8, 8);
await realClick('A.above0', w - 23, -1); // 视口上方（不存在）—对照

// ── 状态 B：遮罩打开（Modal center 同款 inset-0 z-70）────────
await page.click('#openModal');
await sleep(500);
await realClick('B.close.center', w - 23, 33);
await realClick('B.min.center', w - 115, 33);
await realClick('B.max.center', w - 69, 33);
await realClick('B.close.top2', w - 23, 2);
await page.keyboard.press('Escape');
await sleep(400);

// ── 状态 C：页面滚动后 ─────────────────────────────
await page.evaluate(() => window.scrollTo(0, 1200));
await sleep(700);
const sy = await page.evaluate(() => window.scrollY);
LOG('scrolled:', sy);
await realClick('C.close.center', w - 23, 33);
await realClick('C.min.center', w - 115, 33);
await page.evaluate(() => window.scrollTo(0, 0));

// ── 状态 D：maximized 后再测顶部边缘 ─────────────────
// 注意：realClick 阶段1会重置窗口尺寸→会解除最大化；故状态D前先最大化，
// 且 D 组测试时跳过重置（用当前最大化后的原点）。
await page.evaluate(() => window.idplan.windowControls.toggleMaximize());
await sleep(1500);
const isMax = await page.evaluate(() => window.outerWidth >= screen.availWidth);
LOG('maximized:', isMax);
const gM = await page.evaluate(() => ({ sx: window.screenX, sy: window.screenY, cw: document.documentElement.clientWidth }));
const wM = gM.cw;
origin = { ox: gM.sx, oy: gM.sy, cw: gM.cw, ch: 0, fg: true, skipReset: true };
LOG('maximized origin:', JSON.stringify(origin));
await realClick('D.close.center', wM - 23, 33);
await realClick('D.close.top0', wM - 23, 0);
await realClick('D.close.top1', wM - 23, 1);
await realClick('D.close.top2', wM - 23, 2);
await realClick('D.close.top4', wM - 23, 4);
await realClick('D.close.top8', wM - 23, 8);
await realClick('D.close.right1', wM - 1, 33);
await realClick('D.corner2', wM - 2, 2);

writeFileSync(OUT, JSON.stringify(results, null, 2));
LOG('written:', OUT);
await browser.close().catch(() => {});
child.kill();
await sleep(400);
process.exit(0);
