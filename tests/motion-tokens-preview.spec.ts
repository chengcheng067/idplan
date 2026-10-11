// @vitest-environment node
/**
 * 动效地基（定义层）验收 —— 2026-10-11
 *
 * ── 本批做了什么 ──
 * `src/styles/global.css` **只加定义、不改实现**：
 *   · 4 档时长 token（--dur-fast/base/slow/structural）
 *   · 4 条缓动 token（--ease-standard/enter/exit/emphasis），旧名 --liquid-ease 保留并指向标准档
 *   · 6 组「入口 ↔ 出口」成对 keyframes（几何镜像）+ 对应便捷类
 *   · 2 个持续态 keyframes（status-pulse / skeleton-pulse）
 *   · 导出目录里的可交互对照页 deliverables/motion-tokens-preview.html
 *
 * ── 这个 spec 守什么（三件事，缺一件这批就不算数）──
 * ① **零行为变化**：6 个既有入口类的 `animation` 声明逐字未变；
 *    6 组入口/出口 keyframes 的 from/to **互为镜像**（用解析出的声明集比对，
 *    不是硬编码字符串 —— 镜像关系本身就是这批的设计意图）。
 * ② **定义真的进了构建产物**：走 `builtCss()` 的唯一口径读 build-dist，
 *    不读源码（源码里有、产物里没有 = 没生效）。
 * ③ **旧名的求值没变**：把真产物 CSS 挂进真 Chromium，读
 *    `getComputedStyle().getPropertyValue('--liquid-ease')` —— 必须**求值**成
 *    `cubic-bezier(0.4, 0, 0.2, 1)`，而不是恰好长得像。
 *
 * 外加真浏览器几何自证：入口 vs 出口的**不对称**必须是量出来的 ——
 * 左栏（只有入口）关闭后中间态帧数为 0，右栏（入口+出口）有中间态帧；
 * 且右栏淡出期间 `elementFromPoint` 命中下层按钮（出口不拦输入）。
 *
 * 前置：`rm -f build-dist/assets/*.css build-dist/assets/*.js && npx vite build`。
 * 产物缺失/过期/本机无 chromium 时整组 skip（与 print-a4-visual 同口径）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

import { builtCss } from './helpers/built-css';
import { listenOnSafePort } from './helpers/safe-listen';

const ROOT = resolve(__dirname, '..');
const DIST_INDEX = join(ROOT, 'build-dist', 'index.html');
const PREVIEW_DIR = resolve(ROOT, '..', 'deliverables');
const PREVIEW_FILE = join(PREVIEW_DIR, 'motion-tokens-preview.html');
const OUT_DIR = resolve(ROOT, '..', 'outputs', 'motion-preview-shots');
const GLOBAL_CSS = join(ROOT, 'src', 'styles', 'global.css');

/* ------------------------------------------------------------------ 前置探测 */

function resolveChromium(): string | null {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright') : null,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  const rels = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-linux64', 'chrome'],
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(root).filter((n) => n.startsWith('chromium-'));
    } catch {
      continue;
    }
    for (const dir of entries) {
      for (const rel of rels) {
        const exe = join(root, dir, ...rel);
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

const CHROMIUM_PATH = resolveChromium();
const CAN_RUN = existsSync(DIST_INDEX) && CHROMIUM_PATH !== null && existsSync(PREVIEW_FILE);

const BUILD_INPUT_DIRS = ['src', 'electron'];
const BUILD_INPUT_FILES = ['index.html', 'vite.config.ts', 'tailwind.config.ts', 'postcss.config.js'];

function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectFiles(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** 构建输入里有没有比 build-dist/index.html 更新的（= 产物过期） */
function staleInputs(): string[] {
  if (!existsSync(DIST_INDEX)) return [];
  const distMs = statSync(DIST_INDEX).mtimeMs;
  return [
    ...BUILD_INPUT_DIRS.flatMap((d) => collectFiles(join(ROOT, d))),
    ...BUILD_INPUT_FILES.map((f) => join(ROOT, f)).filter((f) => existsSync(f)),
  ]
    .filter((f) => statSync(f).mtimeMs > distMs)
    .map((f) => f.slice(ROOT.length + 1))
    .slice(0, 3);
}

const STALE = CAN_RUN ? staleInputs() : ['(未构建或无 chromium)'];
const CAN_RUN_FRESH = CAN_RUN && STALE.length === 0;

/* ------------------------------------------------------- 结构解析（源码侧） */

interface KfFrame {
  /** 选择器原文（`from` / `to` / `0%, 100%` …），空白已归一化 */
  sel: string;
  /** 声明集（已归一化排序） */
  decls: string[];
}

function decls(body: string): string[] {
  return body
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .sort();
}

/**
 * 从 CSS 里抽出 `@keyframes 名 { ... }` 的各帧。
 *
 * 注意不能假设「一定有 from 和 to」—— 仓里既有 `sidebar-sub-in`（只有 from，
 * 靠隐式 to 承接元素本来的样式），也有 `status-pulse`（`0%, 100%` + `50%`）。
 * 按「有 from/to」过滤会把这两类整块漏掉，于是断言会在**解析层**假通过。
 */
function parseKeyframes(css: string): Map<string, KfFrame[]> {
  const out = new Map<string, KfFrame[]>();
  const blocks = css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)\s*\{([\s\S]*?)\n\}/g);
  for (const m of blocks) {
    const frames: KfFrame[] = [];
    for (const f of m[2]!.matchAll(/([^{}]+?)\s*\{([^}]*)\}/g)) {
      frames.push({
        sel: f[1]!.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim(),
        decls: decls(f[2]!),
      });
    }
    if (frames.length > 0) out.set(m[1]!, frames);
  }
  return out;
}

/** 取某一帧的声明集（`from` 与 `0%` 视为同一帧） */
function frameOf(kf: Map<string, KfFrame[]>, name: string, sel: 'from' | 'to'): string[] {
  const frames = kf.get(name);
  if (!frames) throw new Error(`缺 @keyframes ${name}`);
  const want = sel === 'from' ? ['from', '0%'] : ['to', '100%'];
  const hit = frames.find((f) => want.includes(f.sel));
  if (!hit) {
    throw new Error(`@keyframes ${name} 缺 ${sel} 帧（实际帧：${frames.map((f) => f.sel).join(' | ')}）`);
  }
  return hit.decls;
}

/** 抽出一个 CSS 规则体的原文（用于「逐字未变」的定性证明） */
function ruleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1]!.replace(/\s+/g, ' ').trim() : null;
}

/** 入口 → 出口 的配对表（这批的设计契约） */
const PAIRS: Array<{ in: string; out: string; inClass: string; outClass: string }> = [
  { in: 'menu-fade-in', out: 'menu-fade-out', inClass: 'menuFadeIn', outClass: 'menuFadeOut' },
  { in: 'toast-in', out: 'toast-out', inClass: 'toast-enter', outClass: 'toast-exit' },
  { in: 'dialog-pop', out: 'dialog-pop-out', inClass: 'dialog-pop', outClass: 'dialog-pop-out' },
  { in: 'drawer-slide-in', out: 'drawer-out-right', inClass: 'drawer-slide-in', outClass: 'drawer-out-right' },
  { in: 'drawer-in-left', out: 'drawer-out-left', inClass: 'drawer-in-left', outClass: 'drawer-out-left' },
  { in: 'float-pop-in', out: 'float-pop-out', inClass: 'float-pop-in', outClass: 'float-pop-out' },
];

/**
 * 6 个既有入口类的 animation 声明。
 *
 * 批次一（动效地基）这批是「一个字都不许改」的**冻结**证据；批次二（时长迁移）
 * 起，写成「时长必须引用 --dur-base」的**形态**断言 —— 冻结值里那 5 个裸 ms
 * （200/180/160）正是被迁移掉的东西，继续冻结反而会把「第五档特例」锁死。
 * 缓动仍是原样（`var(--liquid-ease)` / `ease-out`）：本批只动时长，不动缓动。
 */
const ENTRANCE_ANIMATION: Record<string, string> = {
  '.menuFadeIn': 'animation: menu-fade-in var(--dur-base) var(--liquid-ease) both;',
  '.toast-enter': 'animation: toast-in var(--dur-base) ease-out both;',
  '.dialog-pop': 'animation: dialog-pop var(--dur-base) ease-out both;',
  '.drawer-slide-in': 'animation: drawer-slide-in var(--dur-base) var(--liquid-ease) both;',
  '.drawer-in-left': 'animation: drawer-in-left var(--dur-base) var(--liquid-ease) both;',
  '.float-pop-in': 'animation: float-pop-in var(--dur-base) ease-out both;',
};

/** 允许在 animation / transition 里写裸时长的**非过渡**例外（逐条给理由） */
const LITERAL_DURATION_ALLOW: Array<{ selector: string; why: string }> = [
  { selector: '.status-pulse', why: '持续态回路（infinite），不是过渡：1.6s 是节奏不是档位' },
  { selector: '.skeleton-pulse', why: '同上，1.4s 是节奏不是档位' },
];
/** reduce 关停档把过渡压到 1ms —— 那是「关掉」的写法，不是第五档时长 */
const REDUCED_KILL = '1ms';

/* ------------------------------------------------------------------ 静态断言 */

describe('动效地基 · 源码定义', () => {
  const css = readFileSync(GLOBAL_CSS, 'utf8');
  const kf = parseKeyframes(css);

  it('4 档时长 token 存在且数值就是规定的四档', () => {
    for (const [name, value] of [
      ['--dur-fast', '120ms'],
      ['--dur-base', '200ms'],
      ['--dur-slow', '320ms'],
      ['--dur-structural', '480ms'],
    ] as const) {
      expect(new RegExp(`${name}\\s*:\\s*${value}\\s*;`).test(css), `${name} 应为 ${value}`).toBe(true);
    }
  });

  it('4 条缓动 token 的 cubic-bezier 数值与规格一致', () => {
    for (const [name, value] of [
      ['--ease-standard', 'cubic-bezier(0.4, 0, 0.2, 1)'],
      ['--ease-enter', 'cubic-bezier(0.2, 0, 0, 1)'],
      ['--ease-exit', 'cubic-bezier(0.4, 0, 1, 1)'],
      ['--ease-emphasis', 'cubic-bezier(0.2, 0.8, 0.2, 1)'],
    ] as const) {
      const re = new RegExp(`${name}\\s*:\\s*${value.replace(/[()]/g, (c) => '\\' + c)}\\s*;`);
      expect(re.test(css), `${name} 应为 ${value}`).toBe(true);
    }
  });

  it('--liquid-ease 旧名保留（9 处引用不破），且指向 --ease-standard', () => {
    expect(/--liquid-ease\s*:\s*var\(--ease-standard\)\s*;/.test(css)).toBe(true);
  });

  it('8 个既有 @keyframes 一个不少', () => {
    const ORIGINAL = [
      'preview-in',
      'sidebar-sub-in',
      'menu-fade-in',
      'toast-in',
      'dialog-pop',
      'drawer-slide-in',
      'drawer-in-left',
      'float-pop-in',
    ];
    for (const name of ORIGINAL) expect(kf.has(name), `缺 ${name}`).toBe(true);
    expect(kf.size).toBe(ORIGINAL.length + 8); // + 6 出口 + 2 持续态
  });

  it('6 组 入口/出口 的 from/to 互为镜像（入口的 to == 出口的 from，反之亦然）', () => {
    for (const p of PAIRS) {
      expect(kf.has(p.in), `缺入口 ${p.in}`).toBe(true);
      expect(kf.has(p.out), `缺出口 ${p.out}`).toBe(true);
      expect(frameOf(kf, p.out, 'from'), `${p.out} 的 from 应等于 ${p.in} 的 to`).toEqual(
        frameOf(kf, p.in, 'to'),
      );
      expect(frameOf(kf, p.out, 'to'), `${p.out} 的 to 应等于 ${p.in} 的 from`).toEqual(
        frameOf(kf, p.in, 'from'),
      );
    }
  });

  it('6 个既有入口类的 animation 声明：时长一律引用 --dur-base（不再写裸 ms）', () => {
    for (const [selector, expected] of Object.entries(ENTRANCE_ANIMATION)) {
      expect(ruleBody(css, selector), `${selector} 被改动了`).toBe(expected);
    }
  });

  it('★ 全 CSS 闸门：animation / transition 声明里不再出现裸时长（四档 token 是唯一来源）', () => {
    // 剥注释后再扫：注释里写「180ms 够用」这类说明不该算命中
    // （教训：源码级断言行扫描不剥注释 = 迟早抓到注释里的字样假红）。
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const offenders: string[] = [];
    // 只吃**最内层**规则（body 里没有花括号），@media 里嵌的规则也能被吃到
    for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2]!;
      if (!/animation\s*:|transition/.test(body)) continue;
      const sel = m[1]!.split('\n').pop()!.trim();
      if (LITERAL_DURATION_ALLOW.some((a) => sel.includes(a.selector))) continue;
      for (const t of body.matchAll(/\b\d*\.?\d+m?s\b/g)) {
        if (t[0] === REDUCED_KILL) continue;
        offenders.push(`${sel} → ${t[0]}`);
      }
    }
    expect(
      offenders,
      `这些声明还在写裸时长，应改引用 --dur-*：${offenders.join(' / ')}`,
    ).toEqual([]);
  });

  it('★ 类名层闸门：src/ 里不再出现裸数值 duration 类（只许 duration-fast/base/slow/structural）', () => {
    // 与上一条同源：CSS 层的裸 ms 与类名层的裸 duration-* 是同一件事的两种写法。
    // 只扫 src/ —— tests/ 里出现这些字样往往是**断言用的字符串**（如
    // responsive-card-track.spec 的 `transition-all duration-300`），扫进来会假红。
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const abs = join(dir, name);
        if (statSync(abs).isDirectory()) walk(abs);
        else if (/\.(ts|tsx)$/.test(name)) files.push(abs);
      }
    };
    walk(join(ROOT, 'src'));
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, ' ');
      for (const m of src.matchAll(/\bduration-(\[[^\]\s]+\]|\d+)/g)) {
        // 只放行「引用四档 token」的任意值写法
        if (/^\[var\(--dur-(fast|base|slow|structural)\)\]$/.test(m[1]!)) continue;
        offenders.push(`${f.slice(ROOT.length + 1)} → duration-${m[1]}`);
      }
    }
    expect(
      offenders,
      `这些地方还在写裸 duration，应改用四档：${offenders.join(' / ')}`,
    ).toEqual([]);
  });

  it('6 个出口类用 --dur-base + --ease-exit + fill-mode both', () => {
    for (const p of PAIRS) {
      const body = ruleBody(css, `.${p.outClass}`);
      expect(body, `缺 .${p.outClass}`).toBeTruthy();
      expect(body).toMatch(/^animation:\s*[\w-]+\s+var\(--dur-base\)\s+var\(--ease-exit\)\s+both;$/);
    }
  });

  it('2 个持续态 keyframes + 便捷类：平滑往复，且**不含** steps()/step-end 硬切', () => {
    expect(kf.has('status-pulse')).toBe(true);
    expect(kf.has('skeleton-pulse')).toBe(true);
    expect(ruleBody(css, '.status-pulse')).toBe('animation: status-pulse 1.6s ease-in-out infinite;');
    expect(ruleBody(css, '.skeleton-pulse')).toBe('animation: skeleton-pulse 1.4s ease-in-out infinite;');
    // 反例守卫：这两个块的实现里出现 steps/step-end 就是踩了「硬切」的坑
    for (const name of ['status-pulse', 'skeleton-pulse']) {
      const block = new RegExp(`@keyframes\\s+${name}\\s*\\{[\\s\\S]*?\\n\\}`).exec(css)![0];
      expect(/steps\(|step-end|step-start/.test(block), `${name} 不许用硬切`).toBe(false);
    }
    // 骨架起始值不许贴 0（贴 0 会读成「闪一下」）
    const skel = /@keyframes\s+skeleton-pulse\s*\{([\s\S]*?)\n\}/.exec(css)![1]!;
    const values = [...skel.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.3);
  });

  it('过时注释已改对：不再出现「不做退场以免阻塞交互」', () => {
    expect(css).not.toContain('不做退场以免阻塞交互');
    expect(css).toContain('出口动画**绝不允许拦输入**');
    expect(css).toContain('视觉余韵与可操作性解耦');
  });
});

/* ---------------------------------------------------- 构建产物 + 真浏览器断言 */

describe('动效地基 · 构建产物与真求值', () => {
  it('新 token 与 8 个新 keyframes 都在**构建产物**里（不是只在源码里）', () => {
    const built = builtCss(ROOT);
    for (const name of [
      '--dur-fast',
      '--dur-base',
      '--dur-slow',
      '--dur-structural',
      '--ease-standard',
      '--ease-enter',
      '--ease-exit',
      '--ease-emphasis',
      '--liquid-ease',
    ]) {
      expect(built.includes(name), `产物缺 ${name}`).toBe(true);
    }
    for (const name of PAIRS.flatMap((p) => [p.in, p.out]).concat(['status-pulse', 'skeleton-pulse'])) {
      expect(new RegExp(`@keyframes\\s+${name}\\b`).test(built), `产物缺 @keyframes ${name}`).toBe(true);
    }
  });
});

const HEAVY = 40_000;

/**
 * 单元素截图。
 *
 * 为什么要包一层：页面顶部是 `position: sticky` 的工具条，直接
 * `locator.screenshot()` 时 Playwright 把卡片滚进视口，顶栏就会**压住卡片标题**，
 * 出来一张「标题被切掉」的图（第一版实测如此）。截图期间把顶栏临时改成
 * `static`，布局不再互相遮挡；截完恢复。
 */
async function shootEl(page: Page, selector: string, file: string): Promise<void> {
  await page.evaluate(() => {
    (document.querySelector('.topbar') as HTMLElement).style.position = 'static';
  });
  await page.locator(selector).screenshot({ path: file, animations: 'allow' });
  await page.evaluate(() => {
    (document.querySelector('.topbar') as HTMLElement).style.position = '';
  });
}

describe('动效地基 · 真 Chromium', () => {
  let browser: Browser | null = null;

  beforeAll(async () => {
    if (!CAN_RUN_FRESH) return;
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH!, headless: true });
  }, HEAVY);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  const skipNote = !CAN_RUN
    ? '未构建 / 本机无 chromium / 对照页缺失'
    : STALE.length > 0
      ? `构建产物过期（${STALE.join(', ')} 比 build-dist 新）`
      : '构建产物新鲜';

  /** 归一化 cubic-bezier 文本：去空白；把 esbuild 压掉的 `0.4` 补回来（数值等价） */
  const canonBezier = (s: string) => s.replace(/\s+/g, '').replace(/(?<![.\d])\.(\d)/g, '0.$1');
  /** 归一化时长文本：esbuild 会把 120ms 压成 .12s，数值等价即可 */
  const canonDur = (s: string) => {
    const v = s.trim();
    if (v.endsWith('ms')) return `${parseFloat(v)}ms`;
    if (v.endsWith('s')) return `${parseFloat(v) * 1000}ms`;
    return v;
  };

  it.skipIf(!CAN_RUN_FRESH)(`旧名 --liquid-ease 在真产物 CSS 上**求值**等于 cubic-bezier(0.4, 0, 0.2, 1)（${skipNote}）`, async () => {
    const page = await browser!.newPage();
    await page.setContent('<!doctype html><html><head></head><body></body></html>');
    // 挂**真构建产物**的 CSS（唯一口径：builtCss()，含残留门禁）
    await page.addStyleTag({ content: builtCss(ROOT) });

    const r = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const probe = document.createElement('div');
      probe.style.transitionProperty = 'opacity';
      probe.style.transitionDuration = '1ms';
      probe.style.transitionTimingFunction = 'var(--liquid-ease)';
      document.body.appendChild(probe);
      const resolvedLiquid = getComputedStyle(probe).transitionTimingFunction;

      const probe2 = document.createElement('div');
      probe2.style.transitionProperty = 'opacity';
      probe2.style.transitionDuration = '1ms';
      probe2.style.transitionTimingFunction = 'var(--ease-exit)';
      document.body.appendChild(probe2);
      const resolvedExit = getComputedStyle(probe2).transitionTimingFunction;

      return {
        liquidVar: cs.getPropertyValue('--liquid-ease').trim(),
        standardVar: cs.getPropertyValue('--ease-standard').trim(),
        enterVar: cs.getPropertyValue('--ease-enter').trim(),
        exitVar: cs.getPropertyValue('--ease-exit').trim(),
        emphasisVar: cs.getPropertyValue('--ease-emphasis').trim(),
        dur: ['--dur-fast', '--dur-base', '--dur-slow', '--dur-structural'].map((n) =>
          cs.getPropertyValue(n).trim(),
        ),
        resolvedLiquid,
        resolvedExit,
      };
    });
    await page.close();

    // ① 自定义属性求值：var() 在 computed-value 阶段就替换掉了，不该残留 "var("
    //    （注意 esbuild 会把 0.4 压成 .4 —— 数值等价，比较前归一化）
    expect(r.liquidVar).not.toContain('var(');
    expect(canonBezier(r.liquidVar)).toBe('cubic-bezier(0.4,0,0.2,1)');
    expect(canonBezier(r.standardVar)).toBe('cubic-bezier(0.4,0,0.2,1)');
    // ② 真正落到元素上的过渡函数（浏览器归一化后就是源码里那个写法）
    expect(canonBezier(r.resolvedLiquid)).toBe('cubic-bezier(0.4,0,0.2,1)');
    // ③ 反假绿：三条缓动是**不同**的，否则上面的相等可能是「全都一样」导致的
    expect(canonBezier(r.resolvedExit)).not.toBe(canonBezier(r.resolvedLiquid));
    expect(canonBezier(r.enterVar)).toBe('cubic-bezier(0.2,0,0,1)');
    expect(canonBezier(r.exitVar)).toBe('cubic-bezier(0.4,0,1,1)');
    expect(canonBezier(r.emphasisVar)).toBe('cubic-bezier(0.2,0.8,0.2,1)');
    expect(r.dur.map(canonDur)).toEqual(['120ms', '200ms', '320ms', '480ms']);
    console.log(
      `[motion] 产物 CSS 上 --liquid-ease=${r.liquidVar}（元素过渡函数 ${r.resolvedLiquid}）、` +
        `--ease-exit=${r.exitVar}、四档时长 ${r.dur.join(' / ')}`,
    );
  }, HEAVY);

  it.skipIf(!CAN_RUN_FRESH)(`对照页：入口 vs 出口的不对称是量出来的 + 出口不拦输入（${skipNote}）`, async () => {
    const MIME: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
    };
    const server = createServer((req, res) => {
      const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
      if (raw === '/favicon.ico') {
        res.writeHead(204).end();
        return;
      }
      const isEntry = raw === '/' || raw === '/index.html';
      const file = isEntry ? join(PREVIEW_DIR, 'motion-tokens-preview.html') : join(PREVIEW_DIR, raw);
      if (!existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    const { url, close } = await listenOnSafePort(server);

    const context = await browser!.newContext({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // 页面自身的 JS 报错必须响亮 —— 否则后面只会看到一个「等不到 __motionPreview」的超时
    page.on('pageerror', (e) => console.log('[preview pageerror]', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('[preview console.error]', m.text());
    });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(
      () => Boolean((window as never as { __motionPreview?: { ready?: boolean } }).__motionPreview?.ready),
      undefined,
      { timeout: 15000 },
    );
    mkdirSync(OUT_DIR, { recursive: true });

    try {
      /* ① 对照页声明的 token 必须与 global.css 同值（镜像不能漂） */
      const tokens = await page.evaluate(() => (window as never as { __motionPreview: { tokens(): unknown } }).__motionPreview.tokens()) as {
        dur: Record<string, string>;
        ease: Record<string, string>;
      };
      expect(tokens.dur).toEqual({ fast: '120ms', base: '200ms', slow: '320ms', structural: '480ms' });
      expect(tokens.ease.standard).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
      expect(tokens.ease.liquid).toBe('cubic-bezier(0.4, 0, 0.2, 1)');

      // ①b 页面上的「定义清单 + 旧名求值自证」两块文本也必须真的写对了 ——
      //     产品负责人只看这一页，页面自己说错话就等于验收材料说错话。
      const pageTexts = await page.evaluate(() => ({
        dump: (document.getElementById('token-dump') as HTMLElement).textContent ?? '',
        proof: (document.getElementById('liquid-proof') as HTMLElement).textContent ?? '',
      }));
      for (const t of ['--dur-fast', '--dur-base', '--dur-slow', '--dur-structural', '--ease-standard', '--ease-enter', '--ease-exit', '--ease-emphasis', '--liquid-ease']) {
        expect(pageTexts.dump, `定义清单缺 ${t}`).toContain(t);
      }
      expect(pageTexts.dump).toContain('120ms');
      expect(pageTexts.dump).toContain('480ms');
      expect(pageTexts.proof).toContain('cubic-bezier(0.4, 0, 0.2, 1)');
      expect(pageTexts.proof).toContain('var(--liquid-ease)');
      console.log(`[motion] 页面自证：${pageTexts.proof}`);

      /* ② 缓动四联：**只跑一次**（同一次运行既要量、又要截、又要读页面读数）。
            跑两次会让两个采样循环并存，读数与球的真实位置对不上 —— 那是自找的混乱。 */
      await page.evaluate(() => {
        (document.getElementById('ease-banner') as HTMLElement).hidden = false;
      });
      await page.click('#ease-run');
      // 同起同落的确定性采样窗口：enter 与 exit 拉开 ≥0.2 的那一帧
      const ease = await page.evaluate(async () => {
        const lanes = Array.from(document.querySelectorAll('.ease-lane')) as HTMLElement[];
        const progress = () =>
          Object.fromEntries(
            lanes.map((lane) => {
              const track = lane.querySelector('.ease-track') as HTMLElement;
              const ball = lane.querySelector('.ease-ball') as HTMLElement;
              const tw = track.getBoundingClientRect().width - 34;
              const x = ball.getBoundingClientRect().left - track.getBoundingClientRect().left - 4;
              return [lane.dataset.ease!, Math.max(0, Math.min(1, x / tw))];
            }),
          );
        return await new Promise<{ t: number; p: Record<string, number> }>((res) => {
          const t0 = performance.now();
          const tick = () => {
            const p = progress() as Record<string, number>;
            const t = Math.round(performance.now() - t0);
            if (p.enter! - p.exit! >= 0.2 || t > 500) res({ t, p });
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      });
      expect(ease.p.enter! - ease.p.exit!).toBeGreaterThan(0.2);
      expect(ease.p.enter!).toBeGreaterThan(ease.p.standard!);
      expect(ease.p.exit!).toBeLessThan(ease.p.standard!);

      // ②b 在「四球明显错开」的那一帧截「缓动四联」图 —— 跑完再截就全是终态，什么也看不出来。
      //    读数条由页面**逐帧**刷新，所以图里的数字与图里的球位是同一帧。
      await page.waitForFunction(
        () => {
          const p = (sel: string) => {
            const lane = document.querySelector(sel) as HTMLElement;
            const track = lane.querySelector('.ease-track') as HTMLElement;
            const ball = lane.querySelector('.ease-ball') as HTMLElement;
            const tw = track.getBoundingClientRect().width - 34;
            const x = ball.getBoundingClientRect().left - track.getBoundingClientRect().left - 4;
            return Math.max(0, Math.min(1, x / tw));
          };
          return p('[data-ease="enter"]') - p('[data-ease="exit"]') >= 0.28;
        },
        undefined,
        { timeout: 5000 },
      );
      const midEase = await page.evaluate(() => {
        const read = (name: string) => {
          const lane = document.querySelector(`[data-ease="${name}"]`) as HTMLElement;
          const track = lane.querySelector('.ease-track') as HTMLElement;
          const ball = lane.querySelector('.ease-ball') as HTMLElement;
          const tw = track.getBoundingClientRect().width - 34;
          const x = ball.getBoundingClientRect().left - track.getBoundingClientRect().left - 4;
          return Math.round(Math.max(0, Math.min(1, x / tw)) * 100) / 100;
        };
        const cs = getComputedStyle(
          document.querySelector('[data-ease="enter"] .ease-ball') as HTMLElement,
        );
        return {
          standard: read('standard'),
          enter: read('enter'),
          exit: read('exit'),
          emphasis: read('emphasis'),
          dur: cs.animationDuration,
          tf: cs.animationTimingFunction,
          banner: (document.getElementById('ease-banner') as HTMLElement).textContent ?? '',
        };
      });
      expect(midEase.enter - midEase.exit).toBeGreaterThan(0.25);
      expect(midEase.enter).toBeGreaterThan(midEase.standard);
      expect(midEase.exit).toBeLessThan(midEase.standard);
      expect(midEase.dur && canonDur(midEase.dur)).toBe('900ms');
      expect(midEase.banner).toContain('enter');
      await shootEl(page, '#sec-b', join(OUT_DIR, '02-ease-quad.png'));

      // ②c 页面自己的读数也必须单调递增 —— 非单调（后一次采样反而更小）= 采样写错了
      await page.waitForFunction(
        () => (document.getElementById('ease-sample')?.textContent ?? '').split('t=').length >= 3,
        undefined,
        { timeout: 5000 },
      );
      const readout = (await page.textContent('#ease-sample')) ?? '';
      const rows = readout
        .split('\n')
        .filter((l) => l.includes('t='))
        .map((l) => Object.fromEntries([...l.matchAll(/(standard|enter|exit|emphasis) ([\d.]+)/g)].map((m) => [m[1]!, Number(m[2]!)])));
      expect(rows.length, `读数行数不足：\n${readout}`).toBe(2);
      for (const key of ['standard', 'enter', 'exit', 'emphasis']) {
        expect(rows[1]![key]!, `二次采样不该小于一次采样（${key}）：\n${readout}`).toBeGreaterThanOrEqual(rows[0]![key]!);
      }
      expect(rows[0]!.enter!).toBeGreaterThan(rows[0]!.exit!);
      expect(rows[1]!.enter!).toBeGreaterThan(rows[1]!.exit!);
      console.log(`[motion] 缓动四联实测（截图帧）：${midEase.banner}`);
      console.log(`[motion] 页面读数：${readout.replace(/\n/g, ' ｜ ')}`);
      await page.evaluate(() => {
        (document.getElementById('ease-banner') as HTMLElement).hidden = true;
      });

      /* ③ 入口 vs 出口：并排同放，量两栏的中间态帧数 */
      // ⚠️ 必须先把舞台滚进视口：`elementFromPoint` 用的是**视口坐标**，
      //    C 栏在首屏之下时它会返回 null，判定就会变成「没命中」的假红。
      await page.locator('#pair-right .pair-stage').scrollIntoViewIfNeeded();
      await page.waitForTimeout(120);
      await page.evaluate(() => (window as never as { __motionPreview: { openPair(s: string): void } }).__motionPreview.openPair('left'));
      await page.evaluate(() => (window as never as { __motionPreview: { openPair(s: string): void } }).__motionPreview.openPair('right'));
      await page.waitForTimeout(300);

      const pair = await page.evaluate(async () => {
        const api = (window as never as {
          __motionPreview: { closePair(s: string): void };
        }).__motionPreview;
        const panel = (s: string) => document.querySelector(`[data-panel="${s}"]`) as HTMLElement;
        const vis = (el: HTMLElement) => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
          return Number(cs.opacity);
        };
        const frames: Array<{ t: number; l: number; r: number }> = [];
        const hits: Array<{ tag: string; pe: string; vis: number; cx: number; cy: number; vw: number; vh: number }> = [];
        const t0 = performance.now();
        api.closePair('left');
        api.closePair('right');
        await new Promise<void>((res) => {
          const tick = () => {
            const t = Math.round(performance.now() - t0);
            const rp = panel('right');
            frames.push({ t, l: vis(panel('left')), r: vis(rp) });
            // 在右栏淡出**中途**做一次命中测试：面板还看得见，但输入必须已经让出去
            if (hits.length === 0 && vis(rp) > 0.15 && vis(rp) < 0.9) {
              const btn = document.querySelector('[data-underlay="right"]') as HTMLElement;
              const b = btn.getBoundingClientRect();
              const cx = b.left + b.width / 2;
              const cy = b.top + b.height / 2;
              const hit = document.elementFromPoint(cx, cy);
              hits.push({
                tag: hit ? (hit as HTMLElement).getAttribute('data-underlay') ?? hit.tagName : 'none',
                pe: getComputedStyle(rp).pointerEvents,
                vis: Math.round(vis(rp) * 1000) / 1000,
                cx: Math.round(cx),
                cy: Math.round(cy),
                vw: window.innerWidth,
                vh: window.innerHeight,
              });
            }
            if (t < 400) requestAnimationFrame(tick);
            else res();
          };
          requestAnimationFrame(tick);
        });
        const mid = (side: 'l' | 'r') => frames.filter((f) => f[side] > 0.02 && f[side] < 0.98).length;
        return {
          midLeft: mid('l'),
          midRight: mid('r'),
          firstLeft: frames[0]!.l,
          frames: frames.length,
          hits,
        };
      });

      // 左栏：关闭即卸载 —— 采到的第一帧就已经是 0，且全程没有任何中间态
      expect(pair.firstLeft).toBe(0);
      expect(pair.midLeft).toBe(0);
      // 右栏：有真正的淡出过程（中间态帧存在）
      expect(pair.midRight).toBeGreaterThan(3);
      // 出口不拦输入：面板还看得见（0<opacity<1）时，命中测试已经打到下层按钮
      expect(pair.hits.length).toBeGreaterThan(0);
      const hit = pair.hits[0]!;
      // 先把「取样点在视口内」这件事掰开说清：否则 elementFromPoint 返回 null 会被误读成「没命中」
      const where = `取样点 (${hit.cx}, ${hit.cy}) / 视口 ${hit.vw}×${hit.vh}`;
      expect(hit.cx > 0 && hit.cx < hit.vw && hit.cy > 0 && hit.cy < hit.vh, `取样点在视口外：${where}`).toBe(true);
      expect(hit.pe, where).toBe('none');
      expect(hit.tag, `${where} —— elementFromPoint 命中`).toBe('right');
      expect(hit.vis).toBeGreaterThan(0.15);
      expect(hit.vis).toBeLessThan(0.9);
      console.log(
        `[motion] 中间态帧数 left=${pair.midLeft} right=${pair.midRight}；右栏可见度 ${hit.vis} 时 ` +
          `${where} 处 elementFromPoint 命中 data-underlay=${hit.tag}（pointer-events=${hit.pe}）`,
      );

      // ④ 再跑一次「并排同放」，在**关闭过程**中途截核心对照图
      //    ⚠️ 不能只用「右栏 opacity 在 0.3~0.8 之间」当条件 —— 入场动画也会经过这段，
      //    那样截到的是「两边都还在」的入场帧，什么也证明不了。
      //    必须同时要求左栏已经 display:none（= 关闭已发生），才一定是退场中途。
      await page.click('#pair-both');
      await page.waitForFunction(
        () => {
          const lp = document.querySelector('[data-panel="left"]') as HTMLElement;
          const rp = document.querySelector('[data-panel="right"]') as HTMLElement;
          const o = Number(getComputedStyle(rp).opacity);
          return getComputedStyle(lp).display === 'none' && o > 0.25 && o < 0.85;
        },
        undefined,
        { timeout: 5000 },
      );
      // 图里带上「这一刻的真实读数」，别让人只能凭眼睛猜
      const midExit = await page.evaluate(() => {
        const lp = document.querySelector('[data-panel="left"]') as HTMLElement;
        const rp = document.querySelector('[data-panel="right"]') as HTMLElement;
        const vis = (el: HTMLElement) => (getComputedStyle(el).display === 'none' ? 0 : Number(getComputedStyle(el).opacity));
        const banner = document.getElementById('shot-banner') as HTMLElement;
        banner.textContent =
          `截图时刻（关闭进行中）：左栏 可见度 ${vis(lp).toFixed(2)} · 右栏 可见度 ${vis(rp).toFixed(2)} ` +
          `（右栏 opacity=${getComputedStyle(rp).opacity}、transform=${getComputedStyle(rp).transform}、pointer-events=${getComputedStyle(rp).pointerEvents}）`;
        banner.hidden = false;
        return { left: vis(lp), right: vis(rp) };
      });
      expect(midExit.left).toBe(0);
      expect(midExit.right).toBeGreaterThan(0.25);
      expect(midExit.right).toBeLessThan(0.85);
      await shootEl(page, '#sec-c', join(OUT_DIR, '03-pair-side-by-side.png'));
      await page.evaluate(() => {
        (document.getElementById('shot-banner') as HTMLElement).hidden = true;
      });
      await page.waitForTimeout(600);

      // ⑤ 全貌 + 「关掉动效是什么样」
      await shootEl(page, '#sec-c', join(OUT_DIR, '03b-pair-rest.png'));
      // fullPage 截图同样要先解掉 sticky，否则顶栏会以「滚动到中间时」的姿态印在图上
      await page.evaluate(() => {
        (document.querySelector('.topbar') as HTMLElement).style.position = 'static';
      });
      await page.screenshot({ path: join(OUT_DIR, '01-overview.png'), fullPage: true });
      await page.evaluate(() => {
        (document.querySelector('.topbar') as HTMLElement).style.position = '';
      });
      await page.evaluate(() => (window as never as { __motionPreview: { setMotion(v: boolean): void } }).__motionPreview.setMotion(false));
      await page.waitForTimeout(150);
      await page.click('#dur-play-all'); // 读出口径也要一起变成「直接落位」
      await page.waitForTimeout(120);
      await shootEl(page, '#sec-a', join(OUT_DIR, '04-motion-off.png'));
      await shootEl(page, '#sec-d', join(OUT_DIR, '05-motion-off-pulses.png'));

      /* ⑥ 全局开关：关掉后动画真的停了（animationName 为 none） */
      const off = await page.evaluate(() =>
        ['#pulse-status .status-dot', '#pulse-skeleton .skel-row'].map((sel) => {
          const el = document.querySelector(sel) as HTMLElement;
          return getComputedStyle(el).animationName;
        }),
      );
      expect(off).toEqual(['none', 'none']);

      await context.close();
    } finally {
      await close();
    }
  }, HEAVY);
});
