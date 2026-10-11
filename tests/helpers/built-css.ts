/**
 * 构建产物 CSS 的**唯一**读取口径（13 份视觉验收 spec 共用）。
 *
 * ── 为什么不再「把 assets 目录下所有 .css 拼起来」──
 * `vite.config.ts` 的 `emptyOutDir: false` 是**故意**的（那里的注释写明：
 * 沙箱的安全删除 shim(genie-trash) 在 emptyOutDir 时 ETIMEDOUT，且本机持续
 * 锁住新生成的 hash js 文件(EPERM)）——所以每次 `vite build` 都会在
 * `build-dist/assets/` 里**再落一份新哈希 CSS**，上一轮那份不会被清掉。
 *
 * 旧的「读全目录」口径会把新旧两份按 `readdirSync` 的目录序拼起来。旧文件
 * 恰好排在后面时（实测：`index-C3Rrr3NE.css` 在前、`index-Dk7YWIln.css` 在后），
 * 同一选择器的旧规则会**覆盖**新规则 ⇒ 断言读到的是**上一轮的样式**。
 *
 * 后果是「变异静默吞掉」：2026-10-11 独立验证 worker 把 E 版巨字
 * `.ei-head__title` 从 `92px` 改成 `79px`（规格断言 `fs ≥ 80`），
 * **不清理 build-dist 直接 build ⇒ E spec 8/8 全绿（假绿）**；
 * 清空 `build-dist/assets/*.css` 后重跑才正确转红。
 *
 * ── 现在的口径（两道，互补）──
 * ① 治本：只读 `build-dist/index.html` 里 `<link rel="stylesheet">` 引用的那几份
 *    —— 那才是本次构建真正会加载的样式；目录里其它的都是残渣。
 * ② 门禁：资产目录里**存在 index.html 没引用的 .css** 就 loud fail，
 *    点名文件名并给出清理命令（fail-closed：宁可响亮报错，也不静默读错样式）。
 *
 * 门禁为何是「集合包含」而不是「恰好 1 个」：真正的腐坏条件是
 * 「盘上的 CSS 里有 index.html 不引用的」，而不是数量。写死 `=== 1`
 * 会在将来 Vite 合法拆出两份 stylesheet 时误报。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** 从 index.html 里抠出所有 `<link rel="stylesheet">` 的 href */
function referencedCssHrefs(indexHtmlPath: string): string[] {
  const html = readFileSync(indexHtmlPath, 'utf-8');
  const out: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
    const m = /\bhref\s*=\s*["']([^"']+\.css)["']/i.exec(tag);
    if (m) out.push(m[1]!);
  }
  return out;
}

/**
 * 读取本次构建**真正会加载**的构建产物 CSS（唯一入口）。
 *
 * @param projectRoot 仓库根（spec 里的 `ROOT`）
 */
export function builtCss(projectRoot: string): string {
  const dist = join(projectRoot, 'build-dist');
  const indexPath = join(dist, 'index.html');
  const assetsDir = join(dist, 'assets');

  if (!existsSync(indexPath)) {
    throw new Error(
      `[built-css] 找不到构建入口 ${indexPath}。请先 \`npx vite build\`（产物落 build-dist/）。`,
    );
  }

  const hrefs = referencedCssHrefs(indexPath);
  if (hrefs.length === 0) {
    throw new Error(
      `[built-css] ${indexPath} 里没有任何 <link rel="stylesheet"> —— ` +
        '构建产物形状变了，读取口径需要跟着改（别再退回「读全目录」）。',
    );
  }

  // href 形如 '/assets/index-xxx.css'（vite base '/'）：剥掉前导 '/' 后相对 dist 解析
  const files = hrefs.map((href) => join(dist, href.replace(/^\/+/, '')));

  for (const f of files) {
    if (!existsSync(f)) {
      throw new Error(`[built-css] index.html 引用了 ${basename(f)}，但 ${f} 不存在 —— 产物不完整。`);
    }
  }

  assertNoStaleCss(assetsDir, files);
  return files.map((f) => readFileSync(f, 'utf-8')).join('\n');
}

/**
 * 门禁：资产目录里不得有 index.html 未引用的 .css 残留。
 *
 * 残留 = 上一轮 build 的哈希文件（`emptyOutDir: false` 的已知副产物）。
 * 它在场时「读全目录」的旧口径会静默取到旧规则，故这里 fail-closed。
 */
function assertNoStaleCss(assetsDir: string, referenced: string[]): void {
  if (!existsSync(assetsDir)) return;
  const referencedNames = new Set(referenced.map((f) => basename(f)));
  const stale = readdirSync(assetsDir)
    .filter((f) => f.endsWith('.css'))
    .filter((f) => !referencedNames.has(f));
  if (stale.length === 0) return;

  throw new Error(
    [
      `[built-css] build-dist/assets/ 里有 ${stale.length} 份**本次构建不会加载**的残留 CSS：`,
      ...stale.map((f) => `  · ${f}`),
      `本次构建真正加载的：${[...referencedNames].map((f) => basename(f)).join(', ')}`,
      '',
      '成因：vite.config.ts 的 emptyOutDir:false 是有意的（沙箱删除 shim 会 ETIMEDOUT），',
      '旧哈希 CSS 不会被自动清掉。残留会在场时把「读全目录」的旧口径变成假绿——',
      '2026-10-11 实测：E 版巨字 92px→79px 因残留而 8/8 全绿。',
      '',
      '处理：清干净再 build ——',
      '  rm -f build-dist/assets/*.css && npx vite build',
    ].join('\n'),
  );
}
