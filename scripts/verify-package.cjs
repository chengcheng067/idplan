#!/usr/bin/env node
/**
 * 安装包包内验证（发版关卡，不依赖真浏览器）。
 *  1) asar 内 build-dist/assets 是否只剩活文件（死产物是否被清干净）
 *  2) 包内 CSS 是否真的生成了三组阶段色类名（BUG-05 的最终判据）
 *  3) 阶段色暗色换肤是否 27/27 生效，且「亮暗同值」恰为 palette2 规则允许的那 7 个
 *  4) dark 变体是否绑定 html[data-theme=dark] 而非 prefers-color-scheme（BUG-06）
 *  5) 打印锁浅色的 .print-root 是否与亮色令牌同选择器
 *
 * 用法：
 *   node scripts/verify-package.cjs [asar路径]
 *   默认 asar 路径 = release-v070/win-unpacked/resources/app.asar
 *   退出码 0 = 全部通过；1 = 有失败项（可直接用在发版流水线里）。
 *
 * ⚠️ 路径注意：@electron/asar 的 listPackage 返回的是**内部反斜杠路径**，
 *    extractFile 对这两种形态都不接受，故这里用 extractAll 解包后按普通文件读。
 *
 * 说明：真浏览器侧的「打印锁浅色」由 tests/print-light-lock.spec.ts 覆盖
 *   （本脚本只做包内静态判据，两者互补）。
 */
const asar = require('@electron/asar');
const fs = require('node:fs');
const path = require('node:path');

const ASAR = process.argv[2] || 'release-v070/win-unpacked/resources/app.asar';
// 不逐文件 extractFile：@electron/asar 的路径约定在本机（反斜杠 listPackage 结果）
// 下不接受，改用 extractAll 一次性解包到 scratch 目录再按普通文件读。
const EXTRACT_DIR = 'qa-scratch/_asar-verify';
asar.extractAll(ASAR, EXTRACT_DIR);
const files = asar.listPackage(ASAR);

const sep = (s) => s.split(/[\\/]/).filter(Boolean).join('/');
// ⚠️ asar 的 listPackage 返回的是**内部原始路径（反斜杠）**，extractFile 必须吃原始形式；
// 用 sep() 归一化后的 posix 路径去 extractFile 会报 "was not found in this archive"。
const isFile = (f) => /\.(js|css|map|html|png|json)$/i.test(f);
const assets = files.filter(
  (f) => sep(f).startsWith('build-dist/assets/') && isFile(f),
);
const cssRel = assets.find((f) => f.endsWith('.css'));

console.log('=== 1) 包内 build-dist/assets 清单 ===');
assets.forEach((f) => console.log('   ', sep(f)));
console.log('   文件数:', assets.length, '（期望 4：1 css + 3 js；不含目录条目）');

if (!cssRel) {
  console.error('!! 包内找不到 CSS，后续判据无法验证');
  process.exit(1);
}

const css = fs.readFileSync(
  path.join(EXTRACT_DIR, 'build-dist', 'assets', path.basename(cssRel)),
  'utf8',
);
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync('tmp/asar-extracted.css', css);
console.log('\n   已导出包内 CSS 到 tmp/asar-extracted.css，字节数:', css.length);

const cnt = (re) => (css.match(re) || []).length;

console.log('\n=== 2) 三个阶段色类名生成数（BUG-05 判据，期望各 9）===');
const groups = [
  ['bg-stage-band-sN  (宽面)', /\.bg-stage-band-s[1-9]/g],
  ['text-stage-ink-sN (面内字)', /\.text-stage-ink-s[1-9]/g],
  ['bg-stage-sN       (实心块)', /\.bg-stage-s[1-9]/g],
];
let bug05 = true;
for (const [label, re] of groups) {
  const n = cnt(re);
  console.log(`   ${label}: ${n}`);
  if (n < 9) bug05 = false;
}
// 阶段色在暗色下**不走 dark: 工具类**，而是走 CSS 自定义属性换值
// （`:root,.print-root` 声明亮色、`:root[data-theme=dark]` 声明暗色）。
// 所以判据要查「暗色块里这 27 个阶段变量是否被重新赋值，且值与亮色不同」。
const lightBlock = (() => {
  const m = css.match(/:root\s*,\s*\.print-root\s*\{([\s\S]*?)\}/);
  return m ? m[1] : '';
})();
const darkBlock = (() => {
  const m = css.match(/:root\[data-theme=dark\]\s*\{([\s\S]*?)\}/);
  return m ? m[1] : '';
})();
const readVar = (block, name) => {
  const m = block.match(new RegExp(name.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+);'));
  return m ? m[1].trim() : null;
};

const stageVars = [];
for (let i = 1; i <= 9; i += 1) {
  stageVars.push(`--stage-s${i}-rgb`, `--stage-band-s${i}-rgb`, `--stage-ink-s${i}-rgb`);
}
let redefined = 0;
let differing = 0;
for (const v of stageVars) {
  const l = readVar(lightBlock, v);
  const d = readVar(darkBlock, v);
  if (d !== null) redefined += 1;
  if (l !== null && d !== null && l !== d) differing += 1;
}
/**
 * 亮暗同值不是缺陷：palette2.json 的 meta.rule 明文规定
 *   「亮底 = L*>80 保持原色，否则 25% 叠白；暗底 = L*>88 保持原色，否则 15% 叠白」
 * s5 芽白 #E0FFB7 / s6 蜜黄 #FFD16B / s7 米白 #FFF2D6 明度均 > 88，
 * 故 darkBar / 暗色 main 刻意保持原色；darkText.s9 与 lightText.s9 同为白字同理。
 * 因此期望的「亮暗同值」白名单恰好是这 7 个，多一个少一个都算异常。
 */
const SAME_BY_DESIGN = new Set([
  '--stage-s5-rgb', '--stage-band-s5-rgb',
  '--stage-s6-rgb', '--stage-band-s6-rgb',
  '--stage-s7-rgb', '--stage-band-s7-rgb',
  '--stage-ink-s9-rgb',
]);
const sameVars = stageVars.filter((v) => {
  const l = readVar(lightBlock, v);
  const d = readVar(darkBlock, v);
  return l !== null && d !== null && l === d;
});
const sameUnexpected = sameVars.filter((v) => !SAME_BY_DESIGN.has(v));
const sameMissing = [...SAME_BY_DESIGN].filter((v) => !sameVars.includes(v));

console.log(`   亮色块 :root,.print-root 变量数:`, (lightBlock.match(/--/g) || []).length);
console.log(`   暗色块 :root[data-theme=dark] 变量数:`, (darkBlock.match(/--/g) || []).length);
console.log(`   27 个阶段变量中，暗色块重新赋值: ${redefined}/27`);
console.log(`   亮暗取值不同（真的换肤）: ${27 - sameVars.length}/27`);
console.log(`   亮暗同值（按 palette2 规则应为 s5/s6/s7 的 main+bar 与 ink.s9，共 7 个）: ${sameVars.length}`);
if (sameUnexpected.length) console.log('   !! 非预期的亮暗同值:', sameUnexpected.join(', '));
if (sameMissing.length) console.log('   !! 预期同值却不同:', sameMissing.join(', '));
console.log('   抽样 --stage-band-s1-rgb  亮:', readVar(lightBlock, '--stage-band-s1-rgb'), ' 暗:', readVar(darkBlock, '--stage-band-s1-rgb'));
console.log('   抽样 --stage-ink-s5-rgb   亮:', readVar(lightBlock, '--stage-ink-s5-rgb'), ' 暗:', readVar(darkBlock, '--stage-ink-s5-rgb'));

console.log('\n=== 3) dark 变体判定依据（BUG-06 判据）===');
const mq = cnt(/prefers-color-scheme/g);
const attr = cnt(/html\[data-theme=["']?dark["']?\]/g);
console.log('   prefers-color-scheme 出现（期望 0）:', mq);
console.log('   html[data-theme=dark] 选择器出现（期望 > 0）:', attr);

console.log('\n=== 4) 打印锁浅色 .print-root（期望 > 0）===');
console.log('   .print-root 出现:', cnt(/\.print-root/g));
console.log('   --stage-band-s5-rgb:', cnt(/--stage-band-s5-rgb/g));
console.log('   --stage-ink-s5-rgb:', cnt(/--stage-ink-s5-rgb/g));

console.log('\n=== 结论 ===');
const passBug05 = bug05 && redefined === 27 && sameUnexpected.length === 0 && sameMissing.length === 0;
const passBug06 = mq === 0 && attr > 0;
const passPrune = assets.length <= 4;
const passPrint = /:root\s*,\s*\.print-root\s*\{/.test(css);
console.log('   BUG-05 阶段色类名全量生成     :', bug05 ? 'PASS' : 'FAIL');
console.log('   BUG-05 暗色换肤 27/27 且同值符合规则:', passBug05 ? 'PASS' : 'FAIL');
console.log('   BUG-06 dark 绑定应用内开关    :', passBug06 ? 'PASS' : 'FAIL');
console.log('   死产物清理（assets ≤ 4）      :', passPrune ? 'PASS' : `FAIL (${assets.length})`);
console.log('   打印锁浅色 .print-root 与亮色块同一选择器:', passPrint ? 'PASS' : 'FAIL');
const allPass = passBug05 && passBug06 && passPrune && passPrint;
console.log('\n   总体:', allPass ? 'ALL PASS' : 'HAS FAILURE');
process.exitCode = allPass ? 0 : 1;
