// @vitest-environment node
/**
 * 月历 v3「当日浮层」几何验收（真 Chromium · 常驻 spec）。
 *
 * ══════════════ 为什么必须有这一篇 ══════════════
 * 浮层的「贴格右展 / 空间不足左翻 / 底部夹紧」与「格子 overflow:hidden 会不会把浮层
 * 裁掉」都是**布局盒数值**话题，jsdom 量不出来（calendar-day-popover.spec.tsx 只钉
 * 结构契约，并在头注里把几何回归显式外包给本 spec）。本 spec 全部断言实测
 * getBoundingClientRect，不靠「存在即可」。
 *
 * ══════════════ 夹具口径（为什么在演示包上追加 5 个宽跨完工项目） ══════════════
 * 直接灌 buildDemoBackup()（5 个进行中演示项目）在**桌面**档一个拥挤格都没有：
 * computeCalendarEntry 对 in_progress 项目的 bandEnd = clamp(今天, 月首, 月末)
 * （calendarMath.ts:190-191）⇒ 进行中项目的色带全部止于「今天」，当天之后无条目；
 * 当月内 ≥5 条（桌面折叠阈值 4）的日子不存在 ⇒ 桌面浮层根本点不出来。
 * （唯一天然拥挤日是各月 1 号——四个进行中项目的色带被 clamp 到 [月首, 今天]、
 *   未开始的川西落在计划开始日，月 1 视图下全部塌成单日带。）
 * 故沿用本仓既有范式（v07-board-acceptance.spec.ts 的 seedViaBackupImport）：Node 侧
 * 取 buildDemoBackup() 原包，追加 5 个 active/人类项目（各带 1 个 completed 阶段、
 * 跨度 [今天-60, 今天+120] ⇒ completed 项目 bandEnd=spanEnd，月内整月覆盖）⇒ 当月
 * **每一天**都有 ≥5 条 ⇒ 42 格全景拥挤（今天所在的 1–8 号还有 4 个演示项目叠加成 9 条，
 * 与 jsdom 夹具同量级）。导入走应用自己的隐藏 file input → zod 预检 → 二次确认 →
 * importAndReplace → reload 真链路；Node 侧先过 validateBackupJson 防夹具漂移。
 *
 * ══════════════ 判据（对应交付说明 8 条） ══════════════
 * P-01 格高恒定：42 格（含非当月）每格实测 86；最拥挤日 86；浮层打开后仍 86
 * P-02 浮层不被裁：parentElement === document.body；矩形完整在视口内；body/html 与全部
 *      非 body 祖先均无 overflow:hidden；面板中心点 elementFromPoint 命中面板内部
 *      （顺带钉死「格子本人就是 overflow:hidden」这个第一嫌疑坑真实存在）
 * P-03 默认右展：首列（周一）格的浮层 left ≥ 格 right，且精确落在 right + 8
 * P-04 边缘左翻：末列（周日）格的浮层 right ≤ 格 left，且精确落在 left − 280 − 8
 * P-05 底部夹紧：末行格的浮层 bottom ≤ 视口高 − 8，且精确贴 vh − 8（顶缘被顶上去）
 * P-06 三路关闭 + 焦点回还：Esc / ✕ / 点外部均关得上；Esc 与 ✕ 关闭后焦点停回那颗
 *      「+N」按钮。两条**已知偏差**（真 Chromium 实测，已报 team-lead 待决策，spec 不
 *      固化错误行为，详见 P-06 用例内注记）：
 *        [A] 打开时焦点未入面板——mount 焦点 effect 在面板 visibility:hidden 时调
 *            focus()（空操作）且不重试（DayItemsPopover.tsx:106 vs :252）；
 *        [B] 点外部**不可聚焦**背景关闭后焦点落在 body（浏览器默认行为覆盖回还）。
 * P-07 窄窗 bottom-sheet：视口 500 时同交互弹 data-day-popover="sheet"，左右 12、贴底、
 *      圆角 16（顶两角）、清单与桌面同一份（同日行数一致）；移动档格高 78
 * P-08 行完整：浮层行数 === 格子 aria-label 的项目数 === 「+N」数字 + 4；每行有全名/
 *      阶段/百分比；格内可见条目名 ⊆ 浮层行名；点行 → /project/:id + 详情页同名 h1
 *
 * 定位公式（与 DayItemsPopover.tsx useLayoutEffect 逐字对应，px 级 ±1 容差）：
 *   left  = anchor.right + 8；若 left+280 > vw−8 则 left = anchor.left − 280 − 8；
 *           若仍 < 8 则 left = max(8, vw − 280 − 8)
 *   top   = anchor.top；若 top+h > vh−8 则 top = max(8, vh − h − 8)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildDemoBackup } from '../src/core/demo/demoDataFactory';
import { validateBackupJson } from '../src/core/services/backup.service';
import { CAN_RUN_FRESH, CHROMIUM_PATH, shotDir, startServer } from './helpers/board-env';

/** 定稿常量（DayItemsPopover.tsx：PANEL_WIDTH / PANEL_GAP / VIEWPORT_EDGE） */
const PANEL_W = 280;
const PANEL_GAP = 8;
const VIEWPORT_EDGE = 8;
/** 折叠阈值（MonthDayCell.tsx：桌面满排 4 条） */
const DESKTOP_LIMIT = 4;
/** 移动档格高（calendarGrid.MOBILE_CELL_H） */
const MOBILE_CELL_H = 78;

const SHOT_DIR = shotDir('calendar-popover');
const SEED_FILE = resolve(SHOT_DIR, 'seed-popover.json');

/* ══════════════════════════ 夹具：演示包 + 5 个宽跨完工项目 ══════════════════════════ */

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 派生「月历浮层验收种子」：buildDemoBackup() 原包 + 5 个整月覆盖的完工项目。
 *
 * 为什么是 completed 而不是 in_progress：completed 项目 bandEnd = clamp(spanEnd, 月)
 * （calendarMath.ts:186）能覆盖到月末之后；in_progress 的 bandEnd 恒等于今天，
 * 造不出「当月每天 ≥5 条」。项目/阶段字段全部从演示包首行克隆（保 zod 形态），
 * 只覆盖 id/名称/日期/状态——与 v07 的 writeAgentSeed「构造产生差异」同纪律。
 */
function buildSeedFixture(): string {
  const pkg = JSON.parse(JSON.stringify(buildDemoBackup())) as unknown as {
    data: {
      projects: Array<Record<string, unknown>>;
      stages: Array<Record<string, unknown>>;
    };
  };
  const now = new Date().toISOString();
  const today = new Date();
  const lo = new Date(today);
  lo.setDate(lo.getDate() - 60);
  const hi = new Date(today);
  hi.setDate(hi.getDate() + 120);
  const loIso = isoDay(lo);
  const hiIso = isoDay(hi);
  const demoProj = pkg.data.projects[0]!;
  const demoStage = pkg.data.stages[0]!;
  const WUXING = ['甲', '乙', '丙', '丁', '戊'];
  for (let i = 0; i < WUXING.length; i += 1) {
    const pid = `pop_wide_${i + 1}`;
    pkg.data.projects.push({
      ...demoProj,
      id: pid,
      name: `宽跨完工·项目${WUXING[i]}`,
      plannedStartAt: loIso,
      plannedEndAt: hiIso,
      stagePresetKey: null,
      stageTemplateVersion: 0,
      revision: 1,
      updatedAt: now,
    });
    pkg.data.stages.push({
      ...demoStage,
      id: `${pid}_s1`,
      projectId: pid,
      orderIndex: 1,
      templateKey: null,
      colorIndex: i + 1, // stageSchema 要求 ≥ 1
      name: '全过程',
      ratioPercent: 100,
      startAt: loIso,
      endAt: hiIso,
      status: 'completed', // ⇒ computeProjectStatus='completed' ⇒ band 覆盖整月
      ownerId: null,
      visible: true,
      revision: 1,
      updatedAt: now,
    });
  }
  // 夹具自身先过导入预检（与 demo-data.spec.ts 同口径）：漂移当场红，不留给浏览器
  validateBackupJson(pkg);
  mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(SEED_FILE, JSON.stringify(pkg), 'utf8');
  return SEED_FILE;
}

/**
 * 进应用 → 备份导入种子 → reload → 身份即演示负责人（种子里 settings.currentMemberId）
 * → 切「月历」档。整条只走真实 UI（隐藏 file input / 二次确认 / importAndReplace）。
 */
async function seedAndEnterCalendar(page: Page, base: string, fixture: string): Promise<void> {
  await page.goto(`${base}index.html`);
  await page.waitForSelector('header', { timeout: 20000 });
  await page.locator('input[type="file"][accept*="json"]').first().setInputFiles(fixture);
  const confirm = page.getByRole('button', { name: '确认恢复' });
  try {
    await confirm.waitFor({ state: 'attached', timeout: 15000 });
  } catch {
    const text = await page.locator('body').innerText();
    throw new Error(`备份导入未进入二次确认（夹具可能没过 zod 预检）。页面文本：${text.slice(0, 400)}`);
  }
  const reloaded = page.waitForEvent('load', { timeout: 20000 });
  await confirm.click({ force: true });
  await reloaded;
  await page.waitForSelector('header', { timeout: 20000 });
  await page.getByRole('tab', { name: '月历' }).click();
  await page.waitForSelector('[data-day-cell]', { timeout: 15000 });
  await page.waitForTimeout(400);
}

/* ══════════════════════════ 页面内度量助手 ══════════════════════════ */

interface Rect { left: number; top: number; right: number; bottom: number; w: number; h: number }
interface OpenMetrics {
  cellIndex: number;
  cellLabel: string;      // 「YYYY-MM-DD，N 个项目」
  entryCount: number;     // aria-label 里的 N
  moreText: string;       // 「…+N 个项目」
  hiddenCount: number;    // +N 的 N
  panel: Rect;
  panelKind: 'panel' | 'sheet';
  cell: Rect;
  vw: number;
  vh: number;
  rowCount: number;
  rowNames: string[];
  rowPercents: string[];
  cellEntryNames: string[]; // 格内折叠显示的条目全名
  cellOverflow: string;     // 格子 computed overflow（第一嫌疑坑：应为 hidden）
}

/**
 * 打开第 cellIndex 格的「+N」浮层，等到定位算完（visibility:visible）且入场动画
 * 播完（drawer-slide-in 200ms 带 translateX，会让 getBoundingClientRect 失真），
 * 然后一次性取回全部实测数值。
 *
 * @param scrollCellToBottom 先把格的底缘对齐视口底缘（scrollIntoView block:end），
 *   再用 page.mouse.click 点「+N」中心坐标——禁 Playwright 自动滚动，保证夹紧测试的
 *   锚点位置确定（末行格贴视口底缘 ⇒ 顶缘对齐的自然位必然溢出 ⇒ 夹紧必然触发）。
 */
async function openPopoverAt(page: Page, cellIndex: number, scrollCellToBottom = false): Promise<OpenMetrics> {
  if (scrollCellToBottom) {
    await page.evaluate((idx) => {
      const cells = document.querySelectorAll('[data-day-cell]');
      (cells[idx] as HTMLElement).scrollIntoView({ block: 'end' });
    }, cellIndex);
    await page.waitForTimeout(200);
    const box = await page.evaluate((idx) => {
      const cells = document.querySelectorAll('[data-day-cell]') as unknown as HTMLElement[];
      const btn = cells[idx]!.querySelector('button[aria-label^="展开"]') as HTMLElement;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, cellIndex);
    await page.mouse.click(box.x, box.y);
  } else {
    await page.locator('[data-day-cell]').nth(cellIndex).locator('button[aria-label^="展开"]').click();
  }
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-day-popover]') as HTMLElement | null;
      if (!el) return false;
      if (getComputedStyle(el).visibility !== 'visible') return false;
      return el.getAnimations().every((a) => a.playState === 'finished');
    },
    undefined,
    { timeout: 10000 },
  );
  await page.waitForTimeout(50);
  return page.evaluate((idx): OpenMetrics => {
    const cells = Array.from(document.querySelectorAll('[data-day-cell]')) as HTMLElement[];
    const cellEl = cells[idx]!;
    const panel = document.querySelector('[data-day-popover]') as HTMLElement;
    const pr = panel.getBoundingClientRect();
    const cr = cellEl.getBoundingClientRect();
    const rows = Array.from(panel.querySelectorAll('[data-day-popover-list] button')) as HTMLElement[];
    const label = cellEl.getAttribute('aria-label') ?? '';
    const moreBtn = cellEl.querySelector('button[aria-label^="展开"]') as HTMLElement;
    return {
      cellIndex: idx,
      cellLabel: label,
      entryCount: Number(/，(\d+) 个项目/.exec(label)?.[1] ?? -1),
      moreText: moreBtn?.textContent ?? '',
      hiddenCount: Number(/\+(\d+)/.exec(moreBtn?.textContent ?? '')?.[1] ?? -1),
      panel: { left: pr.left, top: pr.top, right: pr.right, bottom: pr.bottom, w: pr.width, h: pr.height },
      panelKind: (panel.getAttribute('data-day-popover') ?? '') as 'panel' | 'sheet',
      cell: { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom, w: cr.width, h: cr.height },
      vw: window.innerWidth,
      vh: window.innerHeight,
      rowCount: rows.length,
      rowNames: rows.map((r) => r.querySelectorAll('span')[1]?.textContent ?? ''),
      rowPercents: rows.map((r) => {
        const s = r.querySelectorAll('span');
        return s[s.length - 1]?.textContent ?? '';
      }),
      cellEntryNames: Array.from(cellEl.querySelectorAll('button[aria-label^="打开项目"]')).map(
        (b) => (b.getAttribute('aria-label') ?? '').replace(/^打开项目\s*/, ''),
      ),
      cellOverflow: getComputedStyle(cellEl).overflow,
    };
  }, cellIndex);
}

/* 四个「找拥挤格」助手（各带明确失败信息，不靠 new Function 动态谓词） */

function firstCrowdedIndex(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('[data-day-cell]')) as HTMLElement[];
    return cells.findIndex((c) => !!c.querySelector('button[aria-label^="展开"]'));
  });
}
function firstCrowdedInCol(page: Page, col: number): Promise<number> {
  return page.evaluate((c) => {
    const cells = Array.from(document.querySelectorAll('[data-day-cell]')) as HTMLElement[];
    return cells.findIndex((el, i) => i % 7 === c && !!el.querySelector('button[aria-label^="展开"]'));
  }, col);
}
function firstCrowdedInLastRow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('[data-day-cell]')) as HTMLElement[];
    return cells.findIndex((el, i) => i >= 35 && !!el.querySelector('button[aria-label^="展开"]'));
  });
}

async function closePopoverByEsc(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-day-popover]'), undefined, { timeout: 5000 });
}

async function activeElt(page: Page): Promise<{ aria: string; kind: string }> {
  return page.evaluate(() => ({
    aria: document.activeElement?.getAttribute('aria-label') ?? '',
    kind: document.activeElement?.getAttribute('data-day-popover') ?? document.activeElement?.tagName ?? '',
  }));
}

/* ══════════════════════════ 用例 ══════════════════════════ */

describe.skipIf(!CAN_RUN_FRESH)(
  '月历 v3 当日浮层几何（真 Chromium · 格高/portal/右展/左翻/夹紧/关闭/窄窗/行完整）',
  () => {
    let browser: Browser;
    let server: { url: string; close(): Promise<void> };
    let ctx: BrowserContext;
    let page: Page;

    beforeAll(async () => {
      const fixture = buildSeedFixture();
      server = await startServer();
      const base = server.url.replace(/index\.html$/, '');
      browser = await chromium.launch({ executablePath: CHROMIUM_PATH ?? undefined });
      ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript(() => {
        try {
          // 压首启欢迎卡（与 v07 夹具环境同口径）；身份由种子包 settings.currentMemberId 建立
          localStorage.setItem('idplan.firstRunGuideSeen', '1');
        } catch {
          /* 隐私模式写不了 —— 随后导入会以带页面原文的报错失败 */
        }
      });
      page = await ctx.newPage();
      await seedAndEnterCalendar(page, base, fixture);
    }, 180000);

    afterAll(async () => {
      await ctx?.close();
      await browser?.close();
      await server?.close();
    });

    /* ---------- P-01：格高恒定（定稿铁律 1） ---------- */

    it('P-01 · 42 格每格实测 86px；最拥挤日不撑高；浮层打开后仍 86', async () => {
      const dump = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('[data-day-cell]')) as HTMLElement[];
        let best = { el: cells[0]!, i: 0, n: -1 };
        cells.forEach((c, i) => {
          const n = Number(/，(\d+) 个项目/.exec(c.getAttribute('aria-label') ?? '')?.[1] ?? 0);
          if (n >= best.n) best = { el: c, i, n };
        });
        return {
          count: cells.length,
          heights: cells.map((c) => c.getBoundingClientRect().height),
          maxEntryCell: { i: best.i, n: best.n },
        };
      });
      expect(dump.count, '6×7 网格应渲染 42 格（含非当月）').toBe(42);
      for (const [i, h] of dump.heights.entries()) {
        expect(Math.abs(h - 86), `第 ${i} 格高度应恒为 86（实测 ${h}）`).toBeLessThan(0.5);
      }
      // 最拥挤日（夹具下 = 1–8 号的 9 条）同样 86，不撑高
      expect(dump.maxEntryCell.n, '夹具下最拥挤日应有 9 条（4 演示 + 5 宽跨）').toBe(9);
      const maxH = await page.evaluate(
        (i) => (document.querySelectorAll('[data-day-cell]')[i] as HTMLElement).getBoundingClientRect().height,
        dump.maxEntryCell.i,
      );
      expect(Math.abs(maxH - 86), '最拥挤日同样 86，不撑高').toBeLessThan(0.5);

      // 浮层打开后格子仍 86（就地展开已从机制上废除）
      await openPopoverAt(page, dump.maxEntryCell.i);
      const still86 = await page.evaluate(
        (i) => (document.querySelectorAll('[data-day-cell]')[i] as HTMLElement).getBoundingClientRect().height,
        dump.maxEntryCell.i,
      );
      expect(Math.abs(still86 - 86), '浮层打开后格子仍应 86').toBeLessThan(0.5);
      await closePopoverByEsc(page);
    }, 60000);

    /* ---------- P-02：浮层不被裁（第一嫌疑坑）+ 矩形完整在视口内 ---------- */

    it('P-02 · 浮层 portal 到 body、完整在视口内、不被任何 overflow:hidden 裁', async () => {
      const idx = await firstCrowdedIndex(page);
      expect(idx, '当月应存在拥挤格（带「+N」按钮）').toBeGreaterThanOrEqual(0);
      const m = await openPopoverAt(page, idx);

      // ① 第一嫌疑坑真实存在：格子本人 overflow:hidden——住进去会被整块裁掉
      expect(m.cellOverflow, '日期格必须是 overflow:hidden（这正是浮层必须 portal 的原因）').toBe('hidden');
      // ② 佐证这个坑是承重的：浮层比格子高得多（247~323 vs 86）——住进格子必被裁
      expect(m.panel.h, '浮层高度应远超格高（住进 overflow:hidden 格子必被裁掉）').toBeGreaterThan(m.cell.h);
      // ② 机制：浮层是 body 的直接子节点，不在任何中间祖先里
      const parentInfo = await page.evaluate(() => {
        const panel = document.querySelector('[data-day-popover]') as HTMLElement;
        const chain: Array<{ tag: string; ox: string; oy: string }> = [];
        let el: HTMLElement | null = panel.parentElement;
        while (el && el !== document.documentElement) {
          const cs = getComputedStyle(el);
          chain.push({ tag: el.tagName, ox: cs.overflowX, oy: cs.overflowY });
          el = el.parentElement;
        }
        return {
          parentIsBody: panel.parentElement === document.body,
          chain,
          bodyOverflow: getComputedStyle(document.body).overflow,
          htmlOverflow: getComputedStyle(document.documentElement).overflow,
        };
      });
      expect(parentInfo.parentIsBody, '浮层必须 portal 到 document.body（住格子会被裁）').toBe(true);
      for (const a of parentInfo.chain) {
        expect([a.ox, a.oy], `祖先 <${a.tag}> 不得 overflow:hidden（会把浮层裁掉）`).not.toContain('hidden');
      }
      expect([parentInfo.bodyOverflow, parentInfo.htmlOverflow]).not.toContain('hidden');

      // ③ 矩形完整在视口内（含 8px 留白口径）
      expect(m.panel.left, '浮层左缘不得出视口').toBeGreaterThanOrEqual(0);
      expect(m.panel.top, '浮层上缘不得出视口').toBeGreaterThanOrEqual(0);
      expect(m.panel.right, '浮层右缘不得出视口').toBeLessThanOrEqual(m.vw);
      expect(m.panel.bottom, '浮层下缘不得出视口').toBeLessThanOrEqual(m.vh);
      expect(Math.round(m.panel.w), '浮层宽应为定稿 280').toBe(PANEL_W);

      // ④ 中心点命中的是面板自己或其后代——视觉上没被任何东西裁掉/遮掉
      const centerHitInside = await page.evaluate(() => {
        const panel = document.querySelector('[data-day-popover]') as HTMLElement;
        const r = panel.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && (hit === panel || panel.contains(hit));
      });
      expect(centerHitInside, '浮层中心点应命中面板内部（未被裁剪/遮挡）').toBe(true);

      await page.screenshot({ path: resolve(SHOT_DIR, 'P-02-popover-portal.png') });
      await closePopoverByEsc(page);
    }, 60000);

    /* ---------- 切到下个月：当月每天 ≥5 条，首列/末列/末行全有拥挤格 ---------- */

    it('P-03 · 默认右展：首列（周一）格的浮层精确贴格右缘 +8', async () => {
      await page.getByRole('button', { name: '下个月' }).click();
      await page.waitForTimeout(500);
      const idx = await firstCrowdedInCol(page, 0);
      expect(idx, '首列（周一）应存在拥挤格').toBeGreaterThanOrEqual(0);
      const m = await openPopoverAt(page, idx);
      expect(m.panelKind).toBe('panel');

      // 判据：展开在格右侧
      expect(
        m.panel.left,
        `浮层应整体在格右侧（浮层 left ${m.panel.left} ≥ 格 right ${m.cell.right}）`,
      ).toBeGreaterThanOrEqual(m.cell.right - 0.5);
      // 定稿数值：left = anchor.right + PANEL_GAP(8)
      expect(Math.abs(m.panel.left - (m.cell.right + PANEL_GAP)), 'left 应精确等于格右缘 +8').toBeLessThan(1);
      // 顶缘：不夹紧时与格对齐；夹紧时顶上去（两种都合法，公式说话）
      if (m.cell.top + m.panel.h <= m.vh - VIEWPORT_EDGE) {
        expect(Math.abs(m.panel.top - m.cell.top), '不夹紧时顶缘应与格对齐').toBeLessThan(1);
      } else {
        expect(m.panel.top, '夹紧时顶缘应被顶到视口内').toBeLessThan(m.cell.top);
      }
      expect(m.panel.bottom, '底部不得超视口').toBeLessThanOrEqual(m.vh - VIEWPORT_EDGE + 0.5);

      await page.screenshot({ path: resolve(SHOT_DIR, 'P-03-popover-right-expand.png') });
      await closePopoverByEsc(page);
    }, 60000);

    it('P-04 · 边缘左翻：末列（周日）格的浮层精确翻到格左侧（left −280 −8）', async () => {
      const idx = await firstCrowdedInCol(page, 6);
      expect(idx, '末列（周日）应存在拥挤格').toBeGreaterThanOrEqual(0);
      const m = await openPopoverAt(page, idx);
      expect(m.panelKind).toBe('panel');

      // 判据：翻到左侧（若没翻导致 right 超视口，这里会红）
      expect(
        m.panel.right,
        `浮层应翻到格左侧（浮层 right ${m.panel.right} ≤ 格 left ${m.cell.left}）`,
      ).toBeLessThanOrEqual(m.cell.left + 0.5);
      // 定稿数值：left = anchor.left − PANEL_WIDTH(280) − PANEL_GAP(8)
      expect(Math.abs(m.panel.left - (m.cell.left - PANEL_W - PANEL_GAP)), 'left 应精确等于格左缘 −280 −8').toBeLessThan(1);
      // 假绿守卫：该格右展自然位必须超视口，否则左翻逻辑根本没被触发
      expect(
        m.cell.right + PANEL_GAP + PANEL_W,
        '前置：该格右展自然位应超出视口（否则左翻未被触发）',
      ).toBeGreaterThan(m.vw - VIEWPORT_EDGE);
      expect(m.panel.bottom, '底部不得超视口').toBeLessThanOrEqual(m.vh - VIEWPORT_EDGE + 0.5);

      await page.screenshot({ path: resolve(SHOT_DIR, 'P-04-popover-left-flip.png') });
      await closePopoverByEsc(page);
    }, 60000);

    it('P-05 · 底部夹紧：末行格的浮层 bottom 精确贴视口高 −8（顶缘被顶上去）', async () => {
      const idx = await firstCrowdedInLastRow(page);
      expect(idx, '末行（第 6 行）应存在拥挤格').toBeGreaterThanOrEqual(0);
      // 手动把格滚到视口底缘 + 鼠标坐标点击（禁自动滚动）⇒ 锚点确定、夹紧必然触发
      const m = await openPopoverAt(page, idx, true);
      expect(m.panelKind).toBe('panel');

      // 判据：bottom ≤ 视口高 − 8
      expect(m.panel.bottom, `浮层底缘应 ≤ 视口高−8（${m.vh - VIEWPORT_EDGE}）`).toBeLessThanOrEqual(
        m.vh - VIEWPORT_EDGE + 0.5,
      );
      // 定稿数值：top = max(8, vh − h − 8) ⇒ bottom 精确贴 vh − 8
      const expectedTop = Math.max(VIEWPORT_EDGE, m.vh - m.panel.h - VIEWPORT_EDGE);
      expect(Math.abs(m.panel.top - expectedTop), `夹紧后 top 应精确等于 vh − h − 8（${expectedTop}）`).toBeLessThan(1);
      expect(Math.abs(m.panel.bottom - (m.vh - VIEWPORT_EDGE)), 'bottom 应精确贴 vh − 8').toBeLessThan(1);
      // 假绿守卫：自然位（贴格顶缘）必须溢出视口，否则夹紧逻辑没被触发
      expect(
        m.cell.top + m.panel.h,
        '前置：该格顶缘对齐的自然位应超出视口（否则夹紧未被触发）',
      ).toBeGreaterThan(m.vh - VIEWPORT_EDGE);
      expect(m.panel.top, '夹紧生效时浮层顶缘应高于格顶缘').toBeLessThan(m.cell.top);

      await page.screenshot({ path: resolve(SHOT_DIR, 'P-05-popover-bottom-clamp.png') });
      await closePopoverByEsc(page);
    }, 60000);

    /* ---------- P-06：三路关闭 + 焦点回还 ---------- */

    it('P-06 · 三路关闭（Esc / ✕ / 点外部）；关闭后焦点停回「+N」按钮', async () => {
      const idx = await firstCrowdedInCol(page, 0);
      expect(idx).toBeGreaterThanOrEqual(0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      const moreBtn = page.locator('[data-day-cell]').nth(idx).locator('button[aria-label^="展开"]');
      const triggerLabel = (await moreBtn.getAttribute('aria-label')) ?? '';

      // ── 路 1：Esc ──
      await moreBtn.click();
      await page.waitForSelector('[data-day-popover="panel"]', { timeout: 8000 });
      await closePopoverByEsc(page);
      expect((await activeElt(page)).aria, 'Esc 关闭后焦点应还给触发它的「+N」按钮').toBe(triggerLabel);

      // ── 路 2：右上 ✕ ──
      await moreBtn.click();
      await page.waitForSelector('[data-day-popover="panel"]', { timeout: 8000 });
      await page.locator('[data-day-popover="panel"] button[aria-label="关闭当日清单"]').click();
      await page.waitForFunction(() => !document.querySelector('[data-day-popover]'), undefined, { timeout: 5000 });
      expect((await activeElt(page)).aria, '✕ 关闭后焦点应还给「+N」按钮').toBe(triggerLabel);

      // ── 路 3：点浮层外部（mousedown 捕获）──
      await moreBtn.click();
      await page.waitForSelector('[data-day-popover="panel"]', { timeout: 8000 });
      await page.locator('h2').first().click();
      await page.waitForFunction(() => !document.querySelector('[data-day-popover]'), undefined, { timeout: 5000 });
      expect(
        await page.evaluate(() => !!document.querySelector('[data-day-popover]')),
        '点外部应关闭',
      ).toBe(false);
      /*
       * ── 两条已知偏差（真 Chromium 实测，已报 team-lead 待决策，**不在本 spec 固化错误行为**） ──
       *
       * [A] 打开时焦点**没有**入面板（规格 §5.3「打开焦点入面板」在真浏览器未兑现）：
       *     monkey-patch HTMLElement.prototype.focus 实测，挂载即跑的焦点 effect 调用
       *     `panelRef.current.focus()` 时面板仍是 `visibility:hidden`（首帧 pos=null——
       *     anchorRect 要等父组件 layout effect 同步才有值），visibility:hidden 的元素
       *     聚焦是**空操作**；该 effect 依赖 [] 只在挂载跑一次，面板可见后从不重试。
       *     根因：DayItemsPopover.tsx:106（focus 调用点）与 :252（visibility 门）时序竞争；
       *     父侧 MonthlyCalendarView.tsx:470-477 首渲染传的 anchorRect 恒为 null。
       *     连带后果：面板内 ✕/行 按钮键盘 Tab 不可达、role=dialog 焦点契约失效；
       *     jsdom spec（calendar-day-popover.spec.tsx:396）的同类断言在 jsdom 恒真
       *     （jsdom 不实现 focusability），抓不到——正是「jsdom 量不出」的那类几何/焦点话题。
       *     修复方向（实现侧定）：focus 移进定位 useLayoutEffect（pos 算出来那一刻），
       *     或加一个 pos!==null 时才跑的 focus effect。
       *     注：也因此，「关闭后焦点停回 +N」在本浏览器里恰好仍成立（焦点从未离开过触发钮），
       *     上面三条关闭断言不受影响、全部实测通过。
       *
       * [B] 点浮层外**不可聚焦**背景（h2/空白）关闭后，焦点落在 <body> 而非「+N」：
       *     React 同步刷新把焦点还给触发钮后，浏览器默认的 mousedown 行为（目标不可
       *     聚焦 ⇒ 焦点清到 body）又把它覆盖掉。点外部**可聚焦**元素（按钮/链接）时
       *     焦点随点击走，属自然行为。Esc / ✕ 两条路径焦点回还实测正常。
       */
      expect(
        (await activeElt(page)).kind,
        '点外部关闭后，焦点不得仍停留在已卸载的浮层上',
      ).not.toBe('panel');
    }, 60000);

    /* ---------- P-07：窄窗 bottom-sheet ---------- */

    it('P-07 · 视口 500：同一交互弹底部弹层（左右 12 / 贴底 / 圆角 16 / 同一份清单）；格高 78', async () => {
      // 先记桌面档同一格的清单行数（「清单是同一条」的对照基准）
      const idxDesktop = await firstCrowdedIndex(page);
      expect(idxDesktop).toBeGreaterThanOrEqual(0);
      const dateLabel = await page.evaluate(
        (i) => document.querySelectorAll('[data-day-cell]')[i]!.getAttribute('aria-label'),
        idxDesktop,
      );
      const desktop = await openPopoverAt(page, idxDesktop);
      await closePopoverByEsc(page);

      await page.setViewportSize({ width: 500, height: 860 });
      await page.waitForTimeout(400);
      expect(
        await page.evaluate(() => window.matchMedia('(max-width: 767px)').matches),
        '前置：视口 500 应命中窄窗断点',
      ).toBe(true);

      // 移动档格高 78（calendarGrid.MOBILE_CELL_H）
      const heights = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-day-cell]')).map((c) => c.getBoundingClientRect().height),
      );
      expect(heights.length).toBe(42);
      for (const [i, h] of heights.entries()) {
        expect(Math.abs(h - MOBILE_CELL_H), `移动档第 ${i} 格高度应恒为 78（实测 ${h}）`).toBeLessThan(0.5);
      }

      // 同一个日期格（按 aria-label 对齐）点「+N」
      const idxMobile = await page.evaluate((label) => {
        const cells = Array.from(document.querySelectorAll('[data-day-cell]')) as HTMLElement[];
        return cells.findIndex((c) => c.getAttribute('aria-label') === label);
      }, dateLabel);
      expect(idxMobile, '窄窗下应还能找到同一个日期格').toBeGreaterThanOrEqual(0);
      const m = await openPopoverAt(page, idxMobile);

      expect(m.panelKind, '窄窗必须是底部弹层形态').toBe('sheet');
      expect(
        await page.evaluate(() => !!document.querySelector('[data-day-popover="panel"]')),
        '窄窗不得同时出现桌面浮层',
      ).toBe(false);

      const geo = await page.evaluate(() => {
        const el = document.querySelector('[data-day-popover="sheet"]') as HTMLElement;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          parentIsBody: el.parentElement === document.body,
          left: r.left,
          right: r.right,
          bottom: r.bottom,
          vw: window.innerWidth,
          vh: window.innerHeight,
          tl: cs.borderTopLeftRadius,
          tr: cs.borderTopRightRadius,
          bl: cs.borderBottomLeftRadius,
        };
      });
      expect(geo.parentIsBody, 'sheet 同样 portal 到 body').toBe(true);
      expect(Math.abs(geo.left - 12), '左右留 12').toBeLessThan(1);
      expect(Math.abs(geo.right - (geo.vw - 12)), '左右留 12').toBeLessThan(1);
      expect(Math.abs(geo.bottom - geo.vh), '贴底（bottom-0）').toBeLessThan(1);
      expect(geo.tl, '顶部圆角 16').toBe('16px');
      expect(geo.tr, '顶部圆角 16').toBe('16px');
      expect(geo.bl, '底部不圆角').toBe('0px');
      // 清单是同一条：同日行数与桌面档一致
      expect(m.rowCount, 'sheet 清单与桌面浮层同一条（行数一致）').toBe(desktop.rowCount);
      expect(m.entryCount, 'sheet 与桌面同日条目数一致').toBe(desktop.entryCount);

      await page.screenshot({ path: resolve(SHOT_DIR, 'P-07-sheet-mobile.png') });
      await closePopoverByEsc(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300);
    }, 60000);

    /* ---------- P-08：行完整 + 行点击导航（最后一步，会离开月历页） ---------- */

    it('P-08 · 浮层行数 = 当天全部条目 = 「+N」+4；每行全名/阶段/百分比；点行进项目详情', async () => {
      const idx = await firstCrowdedIndex(page);
      expect(idx).toBeGreaterThanOrEqual(0);
      const m = await openPopoverAt(page, idx);

      // 行数 = 当天全部条目（aria-label 口径），一条不许少
      expect(m.rowCount, `浮层应全列当天 ${m.entryCount} 条`).toBe(m.entryCount);
      // 行数 = 折叠显示的 4 条 + 隐藏的 N 条（桌面阈值 4）
      expect(m.hiddenCount, '「+N」应是超出桌面阈值 4 的条数').toBe(m.entryCount - DESKTOP_LIMIT);
      expect(m.rowCount, '行数应 = 隐藏 N + 折叠显示的 4').toBe(m.hiddenCount + DESKTOP_LIMIT);

      // 每行：项目全名 + 百分比（阶段名非空由 rowPercents 前的 span 承载，行文本包含之）
      for (const [i, name] of m.rowNames.entries()) {
        expect(name.length, `第 ${i} 行应有项目全名（不是简称）`).toBeGreaterThan(1);
      }
      for (const pct of m.rowPercents) {
        expect(pct, '每行应有百分比').toMatch(/^\d+%$/);
      }
      // 格内折叠显示的条目，在浮层里必须是同一条全名（不是简称/截断）
      expect(m.cellEntryNames.length, '拥挤格应折叠显示了 4 条').toBe(DESKTOP_LIMIT);
      for (const cellName of m.cellEntryNames) {
        expect(m.rowNames, `格内条目「${cellName}」应全名出现在浮层里`).toContain(cellName);
      }

      // 点行 → 导航到该项目详情页（同名 h1），浮层随之关闭
      const firstName = m.rowNames[0]!;
      await page.locator('[data-day-popover-list] button').first().click();
      await page.waitForURL(/\/project\/[^/]+$/, { timeout: 10000 });
      await page.waitForFunction(
        (name) => Array.from(document.querySelectorAll('h1')).some((h) => (h.textContent ?? '').includes(name)),
        firstName,
        { timeout: 10000 },
      );
      expect(await page.evaluate(() => !!document.querySelector('[data-day-popover]')), '点行后浮层应关闭').toBe(false);
    }, 60000);
  },
);
