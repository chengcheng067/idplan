/**
 * 构建产物读取的**唯一**口径（CSS + JS；13 份视觉验收 spec 与 B-10 共用）。
 *
 * ── 为什么不再「把 assets 目录下所有同后缀文件拼起来」──
 * `vite.config.ts` 的 `emptyOutDir: false` 是**故意**的（那里的注释写明：
 * 沙箱的安全删除 shim(genie-trash) 在 emptyOutDir 时 ETIMEDOUT，且本机持续
 * 锁住新生成的 hash js 文件(EPERM)）——所以每次 `vite build` 都会在
 * `build-dist/assets/` 里**再落一份新哈希产物**，上一轮那份不会被清掉。
 *
 * 旧的「读全目录」口径会把新旧两份按 `readdirSync` 的目录序拼起来。CSS 侧
 * 旧文件恰好排在后面时（实测：`index-C3Rrr3NE.css` 在前、`index-Dk7YWIln.css`
 * 在后），同一选择器的旧规则会**覆盖**新规则 ⇒ 断言读到的是**上一轮的样式**。
 * JS 侧的症状不同但不轻：`toContain` 类断言在**并集**上做判定，任何一轮构建
 * 曾经包含过的字面量都会让断言通过 ⇒ 「这一版到底有没有」这件事根本没被验证。
 *
 * 后果是「变异静默吞掉」（两处实测，同日）：
 *   · 独立验证 worker 把 E 版巨字 `.ei-head__title` 从 `92px` 改成 `79px`
 *     （规格断言 `fs ≥ 80`），**不清理 build-dist 直接 build ⇒ E spec 8/8
 *     全绿（假绿）**；清空 `build-dist/assets/*.css` 后重跑才正确转红。
 *   · `isolation-browser.spec.ts` 的 B-10（**本身就是为了防假绿而写的**）
 *     拼全部 `.js`，而 `index.html` 只引用 1 份 ⇒ 盘上 9 份历史入口 bundle
 *     一并进入判定集合，B-10 实际验的是「**历次构建的并集**」。
 *
 * ── 现在的口径（两道，互补）──
 * ① 治本：只读 `index.html` **真正会加载**的那些产物 —— `<link rel="stylesheet">`
 *    与 `<script type="module" src>` 指向的文件，外加它们**动态 import 的分块**
 *    （见 `liveAssets` 的 fixpoint 说明）。其余都是残渣。
 * ② 门禁：资产目录里**存在本次构建不会加载的 .css / .js** 就 loud fail，
 *    点名文件名并给出清理命令（fail-closed：宁可响亮报错，也不静默读错产物）。
 *
 * 门禁为何是「集合包含」而不是「恰好 N 个」：真正的腐坏条件是
 * 「盘上的产物里有 index.html 不引用的」，而不是数量。写死数量会在将来 Vite
 * 合法拆出多份 stylesheet / 多入口时误报。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** assets 目录里参与「口径 + 门禁」的两种后缀（其它产物如图片不进判定） */
const GUARDED_EXT = ['.css', '.js'] as const;

interface IndexRefs {
  /** `<link rel="stylesheet" href>` 的文件名 */
  css: string[];
  /** `<script type="module" src>` 的文件名 */
  js: string[];
}

/** 从 index.html 里抠出真正会被加载的入口引用 */
function indexRefs(indexHtmlPath: string): IndexRefs {
  const html = readFileSync(indexHtmlPath, 'utf-8');
  const css: string[] = [];
  const js: string[] = [];

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
    const m = /\bhref\s*=\s*["']([^"']+\.css)["']/i.exec(tag);
    if (m) css.push(basename(m[1]!));
  }
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const m = /\bsrc\s*=\s*["']([^"']+\.js)["']/i.exec(tag);
    if (m) js.push(basename(m[1]!));
  }
  return { css, js };
}

/**
 * 「本次构建真正会加载的资产」= 入口引用 **+ 它们的懒加载分块**（不动点）。
 *
 * 为什么必须有第二项：Vite 把动态 `import()` 的模块拆成独立分块，`index.html`
 * 里**没有**对应的 `<script>`，它的文件名只作为**字面量**出现在引用它的 bundle
 * 里（形如 `import("./html2canvas.esm-xxxx.js")`）。本仓实测就有这么一份
 * （`html2canvas.esm-*.js`）——只看 index.html 会把它误判成残渣。
 * 于是按「文件名出现在某个已判定为活的脚本里」迭代到不动点。
 */
function liveAssets(assetsDir: string, refs: IndexRefs, available: string[]): Set<string> {
  const live = new Set<string>([...refs.css, ...refs.js].filter((n) => available.includes(n)));
  const pool = available.filter((n) => n.endsWith('.js'));

  let grew = true;
  while (grew) {
    grew = false;
    for (const host of [...live]) {
      if (!host.endsWith('.js') || !available.includes(host)) continue;
      const text = readFileSync(join(assetsDir, host), 'utf-8');
      for (const candidate of pool) {
        if (live.has(candidate)) continue;
        if (text.includes(candidate)) {
          live.add(candidate);
          grew = true;
        }
      }
    }
  }
  return live;
}

interface ArtifactRead {
  /** 本次构建会加载的该后缀文件（绝对路径，按 index.html 引用序） */
  files: string[];
  /** 盘上存在、但本次构建不会加载的残渣 */
  stale: string[];
  assetsDir: string;
}

/** 口径 + 门禁的唯一实现：两处读产物都走它 */
function readArtifacts(projectRoot: string, ext: (typeof GUARDED_EXT)[number]): ArtifactRead {
  const dist = join(projectRoot, 'build-dist');
  const indexPath = join(dist, 'index.html');
  const assetsDir = join(dist, 'assets');

  if (!existsSync(indexPath)) {
    throw new Error(
      `[built-assets] 找不到构建入口 ${indexPath}。请先 \`npx vite build\`（产物落 build-dist/）。`,
    );
  }

  const refs = indexRefs(indexPath);
  const available = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
  const live = liveAssets(assetsDir, refs, available);
  const stale = available.filter((f) => f.endsWith(ext)).filter((f) => !live.has(f));

  if (refs[ext === '.css' ? 'css' : 'js'].length === 0) {
    throw new Error(
      `[built-assets] ${indexPath} 里没有任何 <link rel="stylesheet"> / ` +
        '<script type="module"> —— 构建产物形状变了，读取口径需要跟着改' +
        '（别再退回「读全目录」）。',
    );
  }

  const files = available
    .filter((f) => f.endsWith(ext) && live.has(f))
    .map((f) => join(assetsDir, f));

  if (files.length === 0) {
    throw new Error(
      `[built-assets] index.html 引用了 ${ext}，但 build-dist/assets/ 里找不到对应文件 —— 产物不完整。`,
    );
  }

  assertNoStale(assetsDir, stale, live);
  return { files, stale, assetsDir };
}

/**
 * 门禁：资产目录里不得有本次构建不加载的 `.css` / `.js` 残留。
 *
 * 残留 = 上一轮 build 的哈希文件（`emptyOutDir: false` 的已知副产物）。
 * 它在场时「读全目录」的旧口径会静默取到旧产物：CSS 侧旧规则覆盖新规则（假绿），
 * JS 侧判定集合变成历代并集（B-10 的洞）。故这里 fail-closed。
 */
function assertNoStale(assetsDir: string, stale: string[], live: Set<string>): void {
  if (stale.length === 0) return;
  throw new Error(
    [
      `[built-assets] build-dist/assets/ 里有 ${stale.length} 份**本次构建不会加载**的残留产物：`,
      ...stale.map((f) => `  · ${f}`),
      `本次构建真正加载的：${[...live].map((f) => basename(f)).join(', ')}`,
      '',
      '成因：vite.config.ts 的 emptyOutDir:false 是有意的（沙箱删除 shim 会 ETIMEDOUT），',
      '旧哈希产物不会被自动清掉。残留会在场时把「读全目录」的旧口径变成假绿——',
      '2026-10-11 实测两例：E 版巨字 92px→79px 因残留 CSS 而 8/8 全绿；',
      'B-10 拼全部 .js 时实际判定的是历代构建的并集（盘上 9 份历史入口 bundle）。',
      '',
      '处理：清干净再 build ——',
      '  rm -f build-dist/assets/*.css build-dist/assets/*.js && npx vite build',
    ].join('\n'),
  );
}

/** 读取本次构建**真正会加载**的构建产物 CSS（视觉验收 spec 的唯一入口） */
export function builtCss(projectRoot: string): string {
  return readArtifacts(projectRoot, '.css')
    .files.map((f) => readFileSync(f, 'utf-8'))
    .join('\n');
}

/**
 * 读取本次构建**真正会加载**的构建产物 JS（B-10 这类「产物自证」用例的唯一入口）。
 *
 * 与 `builtCss` 同一套口径与门禁：只读 index.html 的入口脚本 + 其懒加载分块，
 * 盘上有不加载的 JS 残渣就 loud fail。**不要**在这里退回「拼全部 .js」——
 * B-10 本来就是防假绿的用例，它的判定集合必须是「这一版」，不是「历代并集」。
 */
export function builtJs(projectRoot: string): string {
  return readArtifacts(projectRoot, '.js')
    .files.map((f) => readFileSync(f, 'utf-8'))
    .join('\n');
}
