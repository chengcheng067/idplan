// @vitest-environment node
/**
 * 无障碍「减弱动效」关停清单 · **纯静态锁**（不启浏览器、不读 build-dist）。
 *
 * ══════════════════ 为什么需要它 ══════════════════
 * 仓库既有纪律：**每个出口/入口动效类都必须出现在 `@media (prefers-reduced-motion: reduce)`
 * 的关停清单里**。漏了的后果不是"动效还在跑"，而是**无障碍回归**：`reduce` 档下
 * `animation: none`，而 `usePresence` 是**靠 `animationend` 决定何时卸载**的 ——
 * 出口动画被关停却没进清单之外的兜底路径，元素就会滞留在 DOM 上。
 *
 * 但在此之前，这条纪律**只活在人的记忆里**：全仓没有任何 spec 检查它。
 * 2026-10-12 新增遮罩出口 `scrim-out` 时，是人手工记得去清单里补一条的 ——
 * 手工记得住一次，记不住下一次。本文件把它变成**机器可判**。
 *
 * ══════════════════ 两个方向都锁 ══════════════════
 * ① **漏保护**：每个出口类都必须在关停清单里；
 * ② **假保护**：清单里的每一项都必须是**真实存在的类** —— 防"类改名了、清单留残骸"：
 *    那种残骸看起来像有保护，其实保护的是空气（比漏保护更难发现）。
 *
 * ══════════════════ 出口类怎么枚举（不用名字约定，用语义） ══════════════════
 * **不按 `*-out` 后缀枚举** —— 那会漏掉 `drawer-out-left` / `drawer-out-right`
 * （它们以 `-left`/`-right` 结尾，不以 `-out` 结尾）与 `menuFadeOut`（camelCase 的无后缀写法）。
 * 改用**语义判据**：一个 `@keyframes` 的**末帧**（`to` 或 `100%`）把 `opacity` 落到 `0`
 * ⇒ 它就是出口动画；再找哪条类规则 `animation: <它>` ⇒ 那就是出口类。
 * 这样将来新增出口动效**自动纳管**，不依赖有人记得起对名字。
 *
 * ══════════════════ 判据 ══════════════════
 * 全部是**集合相等/包含**，离散、零容差。
 * ⚠️ 也刻意加了"**不许空过**"的哨兵：出口集合必须至少含 7 个已知成员 —— 否则
 *    解析器一旦失灵（比如 CSS 改了书写格式），上面那些包含断言会**全绿**，
 *    而实际上什么都没检查。**判据空过比红更危险**（本批的真实教训）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_PATH = resolve(__dirname, '..', 'src', 'styles', 'global.css');
const css = readFileSync(CSS_PATH, 'utf8');

/** 从 `idx` 起找到第一个 `{`，返回其**配平**的块体（嵌套 `{}` 也算） */
function balancedBlock(src: string, idx: number): { body: string; start: number; end: number } {
  const open = src.indexOf('{', idx);
  if (open < 0) throw new Error('找不到 {');
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: src.slice(open + 1, i), start: open, end: i };
    }
  }
  throw new Error('括号不配平');
}

/* ── 1. 枚举全部 `@keyframes` 及其块体 ── */
const keyframes = new Map<string, string>();
for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*/g)) {
  const { body } = balancedBlock(css, m.index + m[0].length);
  keyframes.set(m[1], body);
}
expect(keyframes.size, '@keyframes 一个都没解析到 ⇒ 解析器失灵').toBeGreaterThan(5);

/* ── 2. 末帧把 opacity 落到 0 的 keyframes = 出口动画 ── */
const exitKeyframes = new Set<string>();
for (const [name, body] of keyframes) {
  if (/(^|\n)\s*(to|100%)\s*\{[^}]*opacity:\s*0\s*;/m.test(body)) exitKeyframes.add(name);
}

/* ── 3. 每个出口 keyframes 对应的**便捷类**（哪条类规则 animation: 它） ── */
const exitClasses = new Set<string>();
for (const m of css.matchAll(/\.([A-Za-z][\w-]*)\s*\{([^}]*)\}/g)) {
  const [, cls, body] = m;
  for (const kf of exitKeyframes) {
    if (new RegExp(`animation:\\s*${kf}(\\s|;)`).test(body)) exitClasses.add(cls);
  }
}

/* ── 4. 关停清单：所有 `@media (prefers-reduced-motion: reduce)` 里**关动画**的块 ── */
const killBodies: string[] = [];
for (const m of css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*/g)) {
  const { body } = balancedBlock(css, m.index + m[0].length);
  if (/animation:\s*none/.test(body)) killBodies.push(body);
}
/** 清单里的**简单类选择器**（跳过 `.x:hover` / `.x [attr]` / `:where(...)` 这类复合形态） */
const killClasses = new Set<string>();
for (const body of killBodies) {
  for (const m of body.matchAll(/(^|\n)\s*\.([A-Za-z][\w-]*)\s*[,{]/g)) killClasses.add(m[2]);
}

/* ── 5. 反向检查用：清单**之外**定义过的全部类名 ── */
let cssWithoutKill = css;
for (const body of killBodies) cssWithoutKill = cssWithoutKill.replace(body, '');
const definedClasses = new Set<string>();
for (const m of cssWithoutKill.matchAll(/\.([A-Za-z][\w-]*)/g)) definedClasses.add(m[1]);

/* ── 6. 出口类**没有便捷类**的情况也要暴露（否则第 3 步漏了就没人发现） ── */
const coveredKeyframes = new Set<string>();
for (const cls of exitClasses) {
  const body = css.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  for (const kf of exitKeyframes) {
    if (new RegExp(`animation:\\s*${kf}(\\s|;)`).test(body)) coveredKeyframes.add(kf);
  }
}

/** 已知必须一直是出口的 7 个便捷类（解析器的哨兵；产品删动效时要**显式**改这一行） */
const KNOWN_EXIT_CLASSES = [
  'menuFadeOut',
  'toast-exit',
  'dialog-pop-out',
  'drawer-out-right',
  'drawer-out-left',
  'float-pop-out',
  'scrim-out',
];

describe('无障碍 · prefers-reduced-motion 关停清单（纯静态）', () => {
  it('解析结果自检：出口动画与出口类都认得出来（防判据空过）', () => {
    console.log(`@keyframes 共 ${keyframes.size} 个；其中出口动画 ${exitKeyframes.size} 个：${[...exitKeyframes].join(', ')}`);
    console.log(`出口便捷类 ${exitClasses.size} 个：${[...exitClasses].join(', ')}`);
    console.log(`关停清单里的类 ${killClasses.size} 个：${[...killClasses].join(', ')}`);
    expect(exitClasses.size, '没解析到任何出口类 ⇒ 下面两条断言会空过').toBeGreaterThanOrEqual(7);
    for (const c of KNOWN_EXIT_CLASSES) {
      expect(exitClasses.has(c), `已知出口类 ${c} 没被解析出来（解析器失灵或该动效被删）`).toBe(true);
    }
    // 每个出口 keyframes 都得有便捷类，不能只定义了 keyframes 却没人用
    for (const kf of exitKeyframes) {
      expect(coveredKeyframes.has(kf), `出口动画 ${kf} 没有任何便捷类在用 ⇒ 它不会被任何类挂上`).toBe(true);
    }
  });

  it('★ 方向一：每个出口类都必须在关停清单里（漏一条就是无障碍回归）', () => {
    const missing = [...exitClasses].filter((c) => !killClasses.has(c)).sort();
    expect(
      missing.length,
      `这些出口类没进 @media (prefers-reduced-motion: reduce) 的关停清单：${missing.join(', ')}` +
        ` —— reduce 档下动画被关掉，而 usePresence 靠 animationend 卸载，元素会滞留 DOM`,
    ).toBe(0);
  });

  it('★ 方向二：清单里的每一项都必须是真实存在的类（防改名后留残骸）', () => {
    const ghosts = [...killClasses].filter((c) => !definedClasses.has(c)).sort();
    expect(
      ghosts.length,
      `关停清单里这些类在 CSS 里**并不存在**（改名后的残骸）：${ghosts.join(', ')}` +
        ` —— 它们看起来像有保护，其实保护的是空气`,
    ).toBe(0);
  });
});
