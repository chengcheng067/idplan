#!/usr/bin/env node
/**
 * 清理 build-dist 里的孤儿产物（打包前必跑）。
 *
 * ── 为什么需要它 ──
 * vite.config.ts 刻意设了 `emptyOutDir: false`，因为本机沙箱的安全删除 shim 会在清空目录时
 * ETIMEDOUT，且系统会锁住新生成的 hash 文件（EPERM）。代价是：每次构建只**新增**带哈希的
 * 产物，从不删除旧的。实测跑了几轮后 `build-dist/assets/` 里堆了 5 个 CSS + 49 个 JS，
 * 而 `index.html` 只引用其中 1 个 CSS + 1 个 JS —— 其余 52 个是永不加载的死文件，约 13MB。
 *
 * 这不是「磁盘有点脏」这么轻：electron-builder 的 `files` 配置是 `build-dist/**\/*`，
 * 也就是**死文件会被原样打进安装包**。后果有两条：
 *   1) 安装包体积无谓膨胀（用户下载更慢，且每次发版都在涨）；
 *   2) 排查问题时无法用「看产物里有没有某个文件」来判断该文件是否属于当前版本 ——
 *      因为历史版本的残留也在里面，会直接得出错误结论（这个坑实际踩过）。
 *
 * ── 判定口径（保守，只删「确定没被引用」的）──
 * 以 build-dist/index.html 为准，提取它引用的所有 `/assets/...` 路径，
 * 凡在 build-dist/assets 下**不在**该集合内、且扩展名属于构建产物
 * （.js / .css / .map）的文件才删。其余一律保留：
 *   · 非 assets 目录的文件（logo.png 等静态资源）不动
 *   · 不在 index.html 里但被 JS 动态 import 的分包**不会误删** ——
 *     它们仍会出现在 index.html 引用的入口 JS 里，因此本脚本额外扫描
 *     所有「保留文件」的文本内容，把它们引用的 ./xxx-hash.js 也纳入保留集合（引用闭包）。
 *
 * 用法：
 *   node scripts/prune-build-dist.mjs            # 真删
 *   node scripts/prune-build-dist.mjs --dry-run  # 只报告，不删
 */

import { readFileSync, readdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'build-dist');
const ASSETS = resolve(DIST, 'assets');
const INDEX = resolve(DIST, 'index.html');

const DRY_RUN = process.argv.includes('--dry-run');

if (!existsSync(INDEX) || !existsSync(ASSETS)) {
  console.error('[prune] 找不到 build-dist/index.html 或 build-dist/assets，请先构建。');
  process.exit(1);
}

// 构建产物扩展名白名单 —— 只有这些才会被考虑删除，静态资源（图片/字体）一律不动。
const PRUNABLE = /\.(js|css|map)$/i;

const allAssets = readdirSync(ASSETS);
const html = readFileSync(INDEX, 'utf8');

/** 从文本里提取 build-dist/assets 下的文件名引用（含相对形式 ./xxx.js） */
function referencedNames(text) {
  const found = new Set();
  // 形如 assets/index-abc.js、./index-abc.js、"index-abc.js"
  for (const m of text.matchAll(/assets\/([A-Za-z0-9._-]+)/g)) found.add(m[1]);
  for (const m of text.matchAll(/\.\/([A-Za-z0-9._-]+\.(?:js|css|map))/g)) found.add(m[1]);
  for (const m of text.matchAll(/["']([A-Za-z0-9._-]+\.(?:js|css|map))["']/g)) found.add(m[1]);
  return found;
}

// 入口引用 → 再对「已保留文件」做引用闭包展开（处理动态 import 的分包）
const keep = new Set();
const addFrom = (text) => {
  for (const n of referencedNames(text)) {
    if (allAssets.includes(n) && !keep.has(n)) {
      keep.add(n);
      if (PRUNABLE.test(n)) {
        try {
          addFrom(readFileSync(resolve(ASSETS, n), 'utf8'));
        } catch {
          /* 二进制/读不到就跳过 */
        }
      }
    }
  }
};
addFrom(html);

const doomed = allAssets.filter((n) => PRUNABLE.test(n) && !keep.has(n));

const sizeOf = (names) =>
  names.reduce((sum, n) => {
    try {
      return sum + statSync(resolve(ASSETS, n)).size;
    } catch {
      return sum;
    }
  }, 0);

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

console.log(`[prune] build-dist/assets 共 ${allAssets.length} 个文件`);
console.log(`[prune] index.html 引用闭包保留 ${keep.size} 个`);
console.log(`[prune] 待删除孤儿产物 ${doomed.length} 个（${mb(sizeOf(doomed))}）`);
if (doomed.length) {
  for (const n of doomed.slice(0, 12)) console.log(`         - ${n}`);
  if (doomed.length > 12) console.log(`         … 其余 ${doomed.length - 12} 个`);
}

if (DRY_RUN) {
  console.log('[prune] --dry-run，未做任何删除。');
  process.exit(0);
}

let removed = 0;
for (const n of doomed) {
  try {
    unlinkSync(resolve(ASSETS, n));
    removed += 1;
  } catch (err) {
    // 被系统锁住（本机已知问题）时跳过而不是中断 —— 少删几个不影响正确性，
    // 但中断会让整个打包流程失败，代价不成比例。
    console.warn(`[prune] 跳过 ${n}（${err.code || err.message}）`);
  }
}
console.log(`[prune] 已删除 ${removed}/${doomed.length} 个，回收约 ${mb(sizeOf(doomed))}`);
console.log(`[prune] 剩余 assets：${basename(ASSETS)} 下 ${readdirSync(ASSETS).length} 个文件`);
