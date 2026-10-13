/**
 * 测试定位解耦 · 扫描核（**纯函数**，批次⑥ 的守卫底座）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么要有这个纯函数（而不是「扫一遍源码 + 打印报告」）
 * ══════════════════════════════════════════════════════════════════════
 * 只打印报告的守卫**没法证明它真的会红** —— 一个恒不命中的正则和一条真正的闸门，
 * 在「跑一遍看看输出」这件事上长得一模一样。故把判别逻辑抽成纯函数，
 * 配一组**离散、零容差**的夹具（正的必中 / 负的必不中），判别力由夹具钉住。
 * （团队内的说法：这是「防假闸门」纪律的又一次实践。）
 *
 * ── 判据口径（team-lead 批准，三形态取舍 + 四形态补齐）──
 * **锁（即红）**——「拿文案当定位契约」这四类，英文模式下会找不到元素、且失败会
 *   伪装成「控件不存在」：
 *     ① `aria-label="<含 CJK>"` 出现在 locator / querySelector / waitForSelector 里；
 *     ② `getByRole('button', { name: '<含 CJK>' })`；
 *     ③ `getByLabel('<含 CJK>')`；
 *     ④ `getByPlaceholder('<含 CJK>')`；
 *     ⑤ `getByTitle('<含 CJK>')`。
 *     （③④⑤ 目前全仓 0 处 —— 但守卫要**先立着**，否则下一个写的人会以为它们合法。）
 *
 * **有意不锁（并在本文件写明，免得下一个人以为守卫漏了）**：
 *   ⚠️ **来源（可追溯）**：这是 **team-lead 裁决**的结果，不是我自己放的行 ——
 *     他要求「三种形态分别处置」，并明示「带 allowlist 的守卫必然腐化、豁免清单会让下一个人
 *     以为中文 aria 定位是被允许的」；而规模是**实测**出来的（`getByText` / `hasText:` 合计
 *     27 处 / 11 个文件，绝大多数是渲染态内容断言 = 正确写法）。
 *     ⇒ **不锁的两类 + 锁的五类，边界都来自这次裁决与实测，不是惯例。**
 *   · **断言可访问名 / 白名单值**：如 `expect(src).toContain('aria-label="ID Plan 首页"')`
 *     或 `['打开导航菜单','更多操作']` 这种「期望的 aria 名清单」。那是对**内容本身**的
 *     断言（就是要验 a11y 名/文案），锁它会把整个测试套扫红；而且这类断言在英文模式下
 *     本就应该按语言取值。
 *   · **按可见文案定位**：`getByText('<CJK>')` / `hasText: '<CJK>'` / `textContent).toContain('<CJK>')`。
 *     它们既是定位也是内容断言，机器区分不了 —— 且它们是**渲染态**断言，
 *     正是「取值再比串」那类正确写法，锁它们是自伤。
 *     ⚠️ 「不锁」≠「没人知道有多少」：规模已单独盘点（见交付报告），供 team-lead 决定是否立项。
 *
 * ── 已知局限（如实登记，别当成「已覆盖」）──
 *   · 本核按**行**判定；跨行书写的调用（`locator(\n  'button[aria-label="中文"]'\n)`）
 *     不会命中。全仓当前无此写法，但将来出现即漏 —— 这也是为什么它只能当**兜底**，
 *     真正的纪律是「新写 spec 不用中文定位」。
 *   · 不解析 AST，故别名（`const SEL = 'button[aria-label="中文"]'` 再 `locator(SEL)`）
 *     只在**字面量出现的那一行**判定：该行若不在 locator 调用里就不命中。
 *     换句话说：**它会漏，但不会误伤**（宁可漏报也不把合法断言扫红）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

/** 一处命中 */
export interface CjkLocatorHit {
  /** 该行命中处的原文（trim 后截断），用于红灯时直接看到问题代码 */
  text: string;
  /** 命中的形态（报错文案用） */
  kind: 'aria-label-selector' | 'getByRole-name' | 'getByLabel' | 'getByPlaceholder' | 'getByTitle';
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/**
 * 把注释**内容**原地抹成空格（保留换行 ⇒ 行号/列位不漂）。
 *
 * ══════════════════════════════════════════════════════════════════════
 * ★★ 已知边界（2026-10-13 复核者交叉核对两条实现后量化出来的，**务必读**）★★
 * ══════════════════════════════════════════════════════════════════════
 * 本函数**不是**「把注释删掉」的工具，而是「**把注释内容抹白、保留注释标记与长度**」：
 *   · 保留：换行、**注释起始标记 `/*` 与 `//` 这两个字符本身**（它们是原字符，我只把
 *     内容写成空格）；长度**恒等**（这正是它能保行号/列位、供行级回溯的原因）。
 *   · 抹掉：注释**内容**、块注释的**结束标记**（星号 + 斜杠；此处不写它的字面形态，
 *     以免本段注释提前闭合 —— 这本身也是「块注释里不能写结束标记」的一个现场例子）。
 *
 * ⇒ **用途**：任何「按原文位置/长度对齐地忽略注释内容」的场景 —— 本守卫的定位扫描、
 *   以及 `tests/demo-data.spec.ts` 那条「源码 contain 锁」（只在活代码里匹配）。
 *
 * ⇒ **不可用于**：「断言某文件里**不含** `/*`」这类**要求标记也消失**的判据。
 *   那种场景必须用**删除式**剥法（本仓已有先例：`tests/v07-t03b-ingress-wired.spec.tsx:453`
 *   的 `code = source.replace(/\/\*[\s\S]*?\*\//g, '')…`）。**两者不可互换** ——
 *   若把那条 spec 的局部剥法换成我这份，它的 `expect(code).not.toContain('/*')` **会红**
 *   （因为我把 `/*` 留着）。这也正是复核者两条实现命中数 123 vs 122 的**唯一**差异来源：
 *   被锁串恰好是 `/*` 本身（`v07-t03b-ingress-wired.spec.tsx:464`）。
 *
 * ⇒ 另一条边界：**被锁串若形如注释标记**（如 `/*`、`//`），本剥法**不会**让它消失
 *   ⇒ 那类锁在「是否被注释满足」的判定上会**偏宽**（判成"有效"而不判成"被注释满足"）。
 *   该情形**目前只有一处**，且它**本就是自证**（原文确实有块注释 / 剥完后不该剩），
 *   配对的那条用的是删除式剥法 ⇒ **无需修改**；但**判定器**若以本剥法为准，需知道这个偏宽。
 *   判别力已由 `tests/cjk-locator-guard.spec.ts` 的「剥法边界」夹具钉住。
 */
export function maskComments(source: string): string {
  const out = source.split('');
  let state: 'code' | 'line' | 'block' = 'code';
  let quote: string | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const d = source[i + 1];
    if (state === 'code') {
      if (quote !== null) {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === quote) quote = null;
        i += 1;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c;
        i += 1;
        continue;
      }
      if (c === '/' && d === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') state = 'code';
      else out[i] = ' ';
      i += 1;
      continue;
    }
    // block
    if (c === '*' && d === '/') {
      out[i] = ' ';
      out[i + 1] = ' ';
      state = 'code';
      i += 2;
      continue;
    }
    if (c !== '\n') out[i] = ' ';
    i += 1;
  }
  return out.join('');
}

/** 取一行里全部含 CJK 的引号串（含其起始下标） */
function cjkStringLiterals(line: string): Array<{ value: string; from: number }> {
  const out: Array<{ value: string; from: number }> = [];
  for (const m of line.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    if (CJK.test(value)) out.push({ value, from: m.index ?? 0 });
  }
  return out;
}

/**
 * 定位类调用（字符串出现在这些调用的实参里 ⇒ 是定位契约）。
 * ⚠️ 必须允许**泛型实参**：本仓真实写法是
 *   `document.querySelector<HTMLButtonElement>('button[aria-label="打开导航菜单"]')`
 *   —— `querySelector` 与 `(` 之间隔了 `<…>`。夹具里那条正例就是为了钉住这一点
 *   （第一版漏了它，夹具当场报红 —— 这正是「先写夹具」的价值）。
 */
const LOCATOR_CALLS =
  /\b(locator|querySelector|querySelectorAll|waitForSelector|\$\$?)\s*(?:<[^<>()]*>)?\s*\(/;
/** 断言类（出现在这些上下文里 ⇒ 是「断言内容」，有意不锁） */
const CONTENT_ASSERT = /\.(toContain|toBe|toEqual|toMatch|toHaveText)\s*\(/;
/** 按可见文案定位（有意不锁，见文件头） */
const TEXT_LOCATOR = /\b(getByText|hasText\s*:|textContent\s*\)\s*\.toContain)\s*/;

/**
 * 扫一段源码，返回**必须修**的中文定位（零容差：命中即红）。
 * 输入应该是**已 mask 掉注释**的代码（本函数内部会再 mask 一次，幂等）。
 */
export function scanCjkLocators(rawSource: string): CjkLocatorHit[] {
  const masked = maskComments(rawSource);
  const hits: CjkLocatorHit[] = [];
  for (const line of masked.split(/\r?\n/)) {
    if (!CJK.test(line)) continue;
    const literals = cjkStringLiterals(line);
    if (literals.length === 0) continue;

    const isLocatorCall = LOCATOR_CALLS.test(line);
    const isContentAssert = CONTENT_ASSERT.test(line);

    for (const { value, from } of literals) {
      const head = line.slice(0, from);

      // ① aria-label="<CJK>" 出现在定位调用里
      if (isLocatorCall && !isContentAssert && /aria-label\s*=\s*$/.test(head.trimEnd() + '=')) {
        // head 以 `aria-label=` 结尾（同一字符串内），且本行是定位调用
        hits.push({ text: line.trim(), kind: 'aria-label-selector' });
        continue;
      }
      if (isLocatorCall && /aria-label=/.test(value) && !isContentAssert) {
        hits.push({ text: line.trim(), kind: 'aria-label-selector' });
        continue;
      }
      // ② getByRole(..., { name: '<CJK>' })
      if (/\bgetByRole\s*\(/.test(line) && /name\s*:\s*$/.test(head.trimEnd() + ':')) {
        hits.push({ text: line.trim(), kind: 'getByRole-name' });
        continue;
      }
      if (/\bgetByRole\s*\(/.test(line) && /name\s*:/.test(line) && !TEXT_LOCATOR.test(line)) {
        hits.push({ text: line.trim(), kind: 'getByRole-name' });
        continue;
      }
      // ③④⑤ getByLabel / getByPlaceholder / getByTitle('<CJK>')
      for (const [re, kind] of [
        [/\bgetByLabel\s*\(\s*$/, 'getByLabel'],
        [/\bgetByPlaceholder\s*\(\s*$/, 'getByPlaceholder'],
        [/\bgetByTitle\s*\(\s*$/, 'getByTitle'],
      ] as const) {
        if (re.test(head.trimEnd() + ' ')) {
          hits.push({ text: line.trim(), kind });
          break;
        }
      }
    }
  }
  return hits;
}

/* ══════════════════════════ 全仓扫描（守卫用） ══════════════════════════ */

/** 递归收集 `tests/**` 下的 spec/helper（排除 setup 与自身） */
export function specFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.(ts|tsx)$/.test(name)) out.push(abs.slice(repoRoot.length + 1).split(sep).join(posix.sep));
    }
  };
  walk(join(repoRoot, 'tests'));
  return out.filter((f) => !/cjk-locator-guard/.test(f));
}

/** 全仓扫一遍：返回 `文件:行 → 命中` 列表（空 = 干净） */
export function scanRepo(repoRoot: string): Array<{ file: string; line: number; hit: CjkLocatorHit }> {
  const out: Array<{ file: string; line: number; hit: CjkLocatorHit }> = [];
  for (const file of specFiles(repoRoot)) {
    const text = readFileSync(join(repoRoot, file), 'utf-8');
    const masked = maskComments(text);
    const lines = masked.split(/\r?\n/);
    // 逐行喂给纯函数（保持行号可回溯）
    lines.forEach((line, idx) => {
      for (const hit of scanCjkLocators(line)) out.push({ file, line: idx + 1, hit });
    });
  }
  return out;
}
