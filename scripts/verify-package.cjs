#!/usr/bin/env node
/**
 * 安装包包内验证（发版关卡，不依赖真浏览器）。
 *  0) **本次校验的是哪个产物** —— 打印 asar 完整路径 + mtime（结论可追溯到具体产物）
 *  1) asar 内 build-dist/assets 是否只剩活文件（死产物是否被清干净）
 *  1a) 自检：本次解包目录的 assets == asar 内 assets（防「固定目录残留」把结论带偏）
 *  1b) 包内 assets 文件集合 == index.html 引用闭包（逐名比对，比"数量≤4"强）
 *  2) 包内 CSS 是否真的生成了三组阶段色类名（BUG-05 的最终判据）
 *  3) 阶段色暗色换肤是否 27/27 生效，且「亮暗同值」恰为 palette2 规则允许的那 7 个
 *  4) dark 变体是否绑定 html[data-theme=dark] 而非 prefers-color-scheme（BUG-06）
 *  5) 打印锁浅色的 .print-root 是否与亮色令牌同选择器
 *
 * 用法：
 *   node scripts/verify-package.cjs                      # 自动取 release* 下 mtime 最新的 app.asar
 *   node scripts/verify-package.cjs <asar路径>            # 显式指定（覆盖自动探测）
 *   退出码 0 = 全部通过；1 = 有失败项（可直接用在发版流水线里）。
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠️ 为什么不能把 asar 路径写死（本脚本 2026-09-14 修的真实缺陷）
 * ══════════════════════════════════════════════════════════════════════════════════
 * 原实现把默认值写死为 `release-v070/win-unpacked/resources/app.asar`。换输出目录
 * （skill §3 的 safe-delete 绕法要求换 `-c.directories.output=release-vNNN`）后，
 * **那个旧文件依然存在**，于是「不带参数跑」会去校验**上一个版本的包**，
 * 而旧包若本身干净，照样打印 `ALL PASS`。
 *
 * 这比「脚本没跑」危险得多：它给出的是一个**看起来通过、实则验证了错误对象**的结论。
 * 故此处改为：
 *   · 不传参 → 自动扫描 `release*` 目录、取 app.asar **mtime 最新**的那个；
 *   · 传参   → 以显式路径为准（流水线可钉死）；
 *   · **无论哪种，都把「实际校验的 asar 完整路径 + mtime」打出来**，并把落选候选一并列出。
 * 结论必须绑定 `(产物路径, mtime)`，否则「验过了」这句话没有主语。
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠️ 为什么每次都解到一个**全新**目录（而不是先清空固定目录）
 * ══════════════════════════════════════════════════════════════════════════════════
 * `asar.extractAll(ASAR, dest)` **不会**清空 dest：它只覆盖同名文件。
 * 原实现固定解到 `qa-scratch/_asar-verify`，于是新包被解在**上一轮的残留之上**，
 * 那个目录里凭空多出历史死产物（实测出现 7 个 assets，其中 3 个是上一版遗留），
 * 任何人去翻那个目录都会误判「prune 没生效」—— 正是本脚本要防的那类错误结论。
 *
 * 修法：每次解到 `qa-scratch/_asar-verify/<ISO 时间戳>/`，**干净由构造保证**，
 * 不依赖任何删除操作成功。清空基目录仍然照做（best-effort），但**失败不影响正确性**：
 * ⚠️ 实测该删除在本机**必然失败**，原因不是「句柄被占」，而是沙箱的**批量删除守卫**：
 *     [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {count:6293, threshold:500, scope:"turn"}
 *   app.asar 内含 node_modules（共 5404 条目），解包后远超 500 文件阈值，非交互式
 *   删除一律被策略拒绝。故此处 try/catch 降级并**把原因打出来**，不再声称是「锁」。
 *
 * ⚠️ 路径注意：@electron/asar 的 listPackage 返回的是**内部反斜杠路径**，
 *    extractFile 对**原始形态 / posix 形态 / 前导斜杠形态**三种都拒绝
 *    （实测均报 `was not found in this archive`），故只能用 extractAll 解包后按普通文件读。
 *
 * 说明：真浏览器侧的「打印锁浅色」由 tests/print-light-lock.spec.ts 覆盖
 *   （本脚本只做包内静态判据，两者互补）。
 */
const asar = require('@electron/asar');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EXTRACT_BASE = path.join(ROOT, 'qa-scratch', '_asar-verify');

/* ================================================================================================
 * 0) 解析「本次校验哪个产物」
 * ================================================================================================ */

/** 本地时间 + ISO，两者都给：本地便于人读，ISO 便于机器比对 */
const stampOf = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} (${d.toISOString()})`
  );
};

/**
 * 找出所有 release* / win-unpacked / resources / app.asar，按 mtime 降序。
 * 只认「目录确实存在该 asar」的候选 —— release-0015 一类 UPK 目录不会被误选。
 */
function findAsarCandidates() {
  const out = [];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^release/.test(entry.name)) continue;
    const asarPath = path.join(ROOT, entry.name, 'win-unpacked', 'resources', 'app.asar');
    if (!fs.existsSync(asarPath)) continue;
    out.push({ asarPath, mtimeMs: fs.statSync(asarPath).mtimeMs, dirName: entry.name });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function resolveAsar() {
  const explicit = process.argv[2];
  if (explicit && explicit.trim()) {
    const abs = path.resolve(explicit);
    if (!fs.existsSync(abs)) {
      console.error(`[verify] 显式指定的 asar 不存在：${abs}`);
      process.exit(1);
    }
    return { asarPath: abs, how: 'CLI 参数（显式指定，覆盖自动探测）', candidates: [] };
  }

  const candidates = findAsarCandidates();
  if (candidates.length === 0) {
    console.error(
      '[verify] 没找到任何 release*/win-unpacked/resources/app.asar。\n' +
        '         请先打包，或显式传入路径：node scripts/verify-package.cjs <asar路径>',
    );
    process.exit(1);
  }
  return {
    asarPath: candidates[0].asarPath,
    how: `自动探测：release* 下 app.asar mtime 最新（共 ${candidates.length} 个候选）`,
    candidates,
  };
}

const { asarPath: ASAR, how: ASAR_HOW, candidates: ASAR_CANDIDATES } = resolveAsar();
const ASAR_MTIME = fs.statSync(ASAR).mtimeMs;

console.log('=== 0) 本次校验的产物（结论绑定此路径与 mtime）===');
console.log('   asar :', ASAR);
console.log('   mtime:', stampOf(ASAR_MTIME));
console.log('   来源 :', ASAR_HOW);
if (ASAR_CANDIDATES.length) {
  console.log('   候选（mtime 降序，★=本次选中）:');
  for (const c of ASAR_CANDIDATES.slice(0, 6)) {
    console.log(`     ${c === ASAR_CANDIDATES[0] ? '★' : ' '} ${c.dirName}  ${stampOf(c.mtimeMs)}`);
  }
  if (ASAR_CANDIDATES.length > 6) console.log(`       … 其余 ${ASAR_CANDIDATES.length - 6} 个`);
}
/*
 * 同批 NSIS 安装包核对（技能 §四/§六：「同批 NSIS 安装包的路径/mtime/字节也一并打印」）。
 *
 * ⚠️ 目录层数曾吃错：asar 在 `<out>/win-unpacked/resources/app.asar`，dirname 吃**两层**
 * 只到 `win-unpacked/`——那里面只有 `ID Plan.exe`（不过 /Setup/i 过滤），整段静默跳过，
 * "包与 exe 同批"的自动核对**实际从未执行**（缺功能，不产生假 PASS，但技能要求的核对
 * 一直在裸奔）。要吃**三层**才到输出目录 `<out>/`，Setup.exe 在那里。
 *
 * 三态而不是布尔：有 exe 且时序合理 → pass；有 exe 但时序不合理 → **fail**
 * （"包与 exe 不是同一次构建"正是这条要防的）；找不到 exe → skipped 并打醒目警告行
 * （unpacked-only 是合法场景，既不伪装 PASS 也不当作失败拉低总判定）。
 *
 * 窗口为什么是**有向**的：electron-builder 先落 `<out>/win-unpacked/resources/app.asar`，
 * 再由它编译 NSIS 安装包 ⇒ **同一次构建内 exe 的 mtime 必 ≥ asar**，且编译只花秒级
 * 到分钟级（实测 58.6s）。故判据取「exe 不得旧于 asar 60s 以上（陈旧包），也不得新于
 * asar 10 分钟以上（同一次构建不可能这么久）」——曾用对称 60s 窗，慢机器上会**误杀**
 * 合法的同批包（58.6s 已贴窗），那不是这道关卡的本意。
 */
const outDir = path.dirname(path.dirname(path.dirname(ASAR)));
const setupCandidates = fs.existsSync(outDir)
  ? fs
      .readdirSync(outDir)
      .filter((n) => n.endsWith('.exe') && /Setup/i.test(n))
      .map((n) => ({ name: n, mtimeMs: fs.statSync(path.join(outDir, n)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
  : [];
let exeBatch = 'skipped'; // 'pass' | 'fail' | 'skipped'
if (setupCandidates.length === 0) {
  console.log('   ⚠ 未找到同批 NSIS 安装包（<out>/*Setup*.exe）：跳过同批核对（unpacked-only 场景合法）');
} else {
  const exe = setupCandidates[0];
  const exePath = path.join(outDir, exe.name);
  const stat = fs.statSync(exePath);
  // 有向差值：exe 相对 asar 新多少秒（负数 = exe 比 asar 还旧）
  const deltaS = (exe.mtimeMs - ASAR_MTIME) / 1000;
  exeBatch = deltaS < -60 || deltaS > 600 ? 'fail' : 'pass';
  console.log(
    `   同批 NSIS: ${exePath}\n` +
      `             mtime ${stampOf(exe.mtimeMs)}  体积 ${stat.size} bytes  exe 新于 asar ${deltaS.toFixed(1)}s  ` +
      (exeBatch === 'pass'
        ? '（同批 PASS：asar 必先于 exe，间隔在打包合理区间）'
        : '（!! 不同批 FAIL：exe 旧于 asar 超过 60s（陈旧包）或新于 asar 超过 10min（非同一次构建））'),
  );
}

/* ================================================================================================
 * 解包（每次全新目录，干净由构造保证）
 * ================================================================================================ */

function prepareExtractDir() {
  // best-effort 清空基目录：让历史解包树不无限堆积。
  // 失败是**预期**的（沙箱批量删除守卫，见文件头），故只记录原因、不中断。
  let cleared = false;
  let reason = '';
  try {
    fs.rmSync(EXTRACT_BASE, { recursive: true, force: true });
    cleared = true;
  } catch (err) {
    reason = err && err.code ? err.code : String((err && err.message) || err).slice(0, 160);
  }
  // 真正的干净保证：唯一时间戳目录。不依赖上面的删除是否成功。
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(EXTRACT_BASE, stamp);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, cleared, reason };
}

const { dir: EXTRACT_DIR, cleared: BASE_CLEARED, reason: BASE_REASON } = prepareExtractDir();
console.log('\n   解包到:', EXTRACT_DIR);
console.log(
  BASE_CLEARED
    ? '   基目录已清空重建'
    : `   基目录未清空（${BASE_REASON}）→ 本次解到全新时间戳目录，仍保证无残留`,
);

asar.extractAll(ASAR, EXTRACT_DIR);
const files = asar.listPackage(ASAR);

const sep = (s) => s.split(/[\\/]/).filter(Boolean).join('/');
const isFile = (f) => /\.(js|css|map|html|png|json)$/i.test(f);
const assets = files.filter((f) => sep(f).startsWith('build-dist/assets/') && isFile(f));
const assetNames = assets.map((f) => path.posix.basename(sep(f)));
const cssRel = assets.find((f) => f.endsWith('.css'));

console.log('\n=== 1) 包内 build-dist/assets 清单 ===');
assets.forEach((f) => console.log('   ', sep(f)));
console.log('   文件数:', assets.length, '（期望 = index.html 引用闭包数）');

/* ------------------------------------------------------------------------------------------------
 * 1a) 自检：本次解包目录里的 assets 是否恰好等于 asar 内的 assets（不多不少）
 * ------------------------------------------------------------------------------------------------
 * `asar.extractAll(ASAR, dest)` **只覆盖同名文件、不清空 dest**。
 * 若 dest 是「跨次复用的固定目录」，上一版的死产物会残留其间：实测 7 个文件
 * （4 个本次 + 3 个 release-v070 遗留 index-51W3YeIN.js / index-DSVh36DA.css /
 * rest.client-BJ36so9t.js），肉眼 `ls` 那个目录就会误判「prune 没生效」。
 *
 * 本脚本的 assets **权威来源始终是 asar 列表（listPackage）**，不受残留影响；
 * 但「展示给人和后续判据读的目录」若被污染，仍会酿成错误结论。
 * 故这里把「目录 == asar」做成**显式断言**——它是唯一能挡住回归的东西：
 * 一旦有人把解包目录改回「固定目录且不清空」，本项立刻 FAIL，而不再悄无声息地通过。
 */
const extractedAssetsDirNow = path.join(EXTRACT_DIR, 'build-dist', 'assets');
const dirAssetNames = fs.existsSync(extractedAssetsDirNow)
  ? fs
      .readdirSync(extractedAssetsDirNow, { withFileTypes: true })
      .filter((d) => d.isFile() && isFile(d.name))
      .map((d) => d.name)
      .sort()
  : [];
const asarNamesSorted = [...assetNames].sort();
const sameNames =
  dirAssetNames.length === asarNamesSorted.length &&
  dirAssetNames.every((n, i) => n === asarNamesSorted[i]);
const dirOnly = dirAssetNames.filter((n) => !asarNamesSorted.includes(n)); // 目录残留（死产物）
const asarOnly = asarNamesSorted.filter((n) => !dirAssetNames.includes(n)); // 未解出（缺文件）

console.log('\n=== 1a) 自检：解包目录 assets == asar 内 assets（防「固定目录残留」误判）===');
console.log('   解包目录   :', extractedAssetsDirNow);
console.log('   目录内文件数:', dirAssetNames.length);
console.log('   asar 内文件数:', asarNamesSorted.length);
if (dirOnly.length) console.log('   !! 目录内多出（死产物残留）:', dirOnly.join(', '));
if (asarOnly.length) console.log('   !! asar 内有但未解出:', asarOnly.join(', '));
console.log('   →', sameNames ? '一致（本次解包目录干净）' : '不一致（解包目录被污染，结论不可信）');

if (!cssRel) {
  console.error('!! 包内找不到 CSS，后续判据无法验证');
  process.exit(1);
}

/* ================================================================================================
 * 1b) 包内 assets 集合 == index.html 引用闭包（逐名比对）
 *     判定逻辑与 scripts/prune-build-dist.mjs 保持一致，两边数字才可比。
 * ================================================================================================ */
const extractedDist = path.join(EXTRACT_DIR, 'build-dist');
const extractedAssetsDir = path.join(extractedDist, 'assets');
const extractedIndex = path.join(extractedDist, 'index.html');

function referencedNames(text) {
  const found = new Set();
  for (const m of text.matchAll(/assets\/([A-Za-z0-9._-]+)/g)) found.add(m[1]);
  for (const m of text.matchAll(/\.\/([A-Za-z0-9._-]+\.(?:js|css|map))/g)) found.add(m[1]);
  for (const m of text.matchAll(/["']([A-Za-z0-9._-]+\.(?:js|css|map))["']/g)) found.add(m[1]);
  return found;
}

const closure = new Set();
const addFrom = (text) => {
  for (const n of referencedNames(text)) {
    if (assetNames.includes(n) && !closure.has(n)) {
      closure.add(n);
      if (/\.(js|css|map)$/i.test(n)) {
        try {
          addFrom(fs.readFileSync(path.join(extractedAssetsDir, n), 'utf8'));
        } catch {
          /* 二进制/读不到就跳过 */
        }
      }
    }
  }
};

let closureOk = false;
if (fs.existsSync(extractedIndex)) {
  addFrom(fs.readFileSync(extractedIndex, 'utf8'));
  const orphans = assetNames.filter((n) => !closure.has(n)); // 在包里但没被引用 = 死产物
  const missing = [...closure].filter((n) => !assetNames.includes(n)); // 被引用但不在包里 = 缺文件
  closureOk = orphans.length === 0 && missing.length === 0;

  console.log('\n=== 1b) 包内 assets vs index.html 引用闭包（逐名比对）===');
  console.log('   包内 assets 文件数 :', assetNames.length);
  console.log('   index.html 闭包数  :', closure.size);
  console.log('   闭包成员           :', [...closure].sort().join(', '));
  if (orphans.length) console.log('   !! 包里存在未被引用的死产物:', orphans.join(', '));
  if (missing.length) console.log('   !! 被引用但包里缺失:', missing.join(', '));
  if (closureOk) console.log('   → 集合完全一致');
} else {
  console.error('!! 包内找不到 build-dist/index.html，无法比对引用闭包');
}

const css = fs.readFileSync(path.join(extractedAssetsDir, path.basename(cssRel)), 'utf8');
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tmp', 'asar-extracted.css'), css);
console.log('\n   已导出包内 CSS 到 tmp/asar-extracted.css，字节数:', css.length);

const cnt = (re) => (css.match(re) || []).length;

/*
 * 三个阶段色类名生成数（BUG-05 判据）。
 *
 * 判据是「每组 **≥9**」而不是「恰 9」——注释曾写"期望各 9"，与代码（n<9 才失败）
 * 和实测都不符：实心块组实测 18 = 基态 `.bg-stage-sN` 9 个 ＋ 15% 透明度变体
 * `.bg-stage-sN/15` 9 个（正则按前缀匹配，变体一并计入）。这是**预期内的重复
 * 计数**，不是生成缺陷；真要抓"多生成"得逐个精确比对类名集合，不在本判据职责内。
 */
console.log('\n=== 2) 三个阶段色类名生成数（BUG-05 判据，每组 ≥9）===');
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
for (const v of stageVars) {
  const d = readVar(darkBlock, v);
  if (d !== null) redefined += 1;
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

console.log('\n=== 2b) 桌面主进程层与离线授权公钥（反馈 #11）===');
/*
 * 反馈 #11：「增加机器码授权，同时防止别人用 agent 逆向开发我们的软件」。
 *
 * 授权能成立的前提是**验签代码与公钥真的在安装包里**；防逆向的第一步是
 * 让「打包产物里有什么」可被机器核对，而不是靠肉眼翻 asar。
 * 两项断言：
 *   ① 主进程四件套（main / preload / loopback / license）与验签公钥必须在包内 ——
 *      少一个，用户在目标机器上就是「点了导入没反应」；
 *   ② 包内**不得**出现私钥（文件名或内容任一命中即 FAIL）—— 私钥进包 = 授权归零，
 *      任何人都能自签一份许可证。
 */
const needElectron = [
  'electron/main.cjs',
  'electron/preload.cjs',
  'electron/loopback.cjs',
  'electron/license.cjs',
  'electron/licenses/public-key.pem',
];
const allNormalized = files.map(sep);
const missingElectron = needElectron.filter((n) => !allNormalized.includes(n));

/** 文件名像私钥的一律算可疑（.pem/.key 且带 private/secret） */
const suspiciousKeyFiles = allNormalized.filter(
  (f) => /\.(pem|key|pfx|p12)$/i.test(f) && /private|secret/i.test(f),
);

/** 内容级检查：解包目录下 electron/ 内任何文本文件都不该出现私钥 PEM 头 */
const extractedElectronDir = path.join(EXTRACT_DIR, 'electron');
function collectFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(abs));
    else out.push(abs);
  }
  return out;
}
const contentLeaks = [];
for (const abs of collectFiles(extractedElectronDir)) {
  if (!/\.(cjs|js|json|pem|txt|md)$/i.test(abs)) continue;
  const text = fs.readFileSync(abs, 'utf8');
  if (text.includes('-----BEGIN PRIVATE KEY-----')) contentLeaks.push(path.relative(EXTRACT_DIR, abs));
}
const publicKeyText = (() => {
  const abs = path.join(extractedElectronDir, 'licenses', 'public-key.pem');
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
})();
const publicKeyLooksEd25519 = publicKeyText.includes('-----BEGIN PUBLIC KEY-----');

console.log('   主进程四件套 + 公钥缺失项:', missingElectron.length ? missingElectron.join(', ') : '（无）');
console.log('   文件名像私钥的条目:', suspiciousKeyFiles.length ? suspiciousKeyFiles.join(', ') : '（无）');
console.log('   内容含私钥 PEM 头的文件:', contentLeaks.length ? contentLeaks.join(', ') : '（无）');
console.log('   验签公钥是 SPKI PEM:', publicKeyLooksEd25519 ? 'YES' : 'NO');

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
const passElectron =
  missingElectron.length === 0 &&
  suspiciousKeyFiles.length === 0 &&
  contentLeaks.length === 0 &&
  publicKeyLooksEd25519;
const passBug05 = bug05 && redefined === 27 && sameUnexpected.length === 0 && sameMissing.length === 0;
const passBug06 = mq === 0 && attr > 0;
const passPrint = /:root\s*,\s*\.print-root\s*\{/.test(css);
console.log('   BUG-05 阶段色类名全量生成     :', bug05 ? 'PASS' : 'FAIL');
console.log('   BUG-05 暗色换肤 27/27 且同值符合规则:', passBug05 ? 'PASS' : 'FAIL');
console.log('   BUG-06 dark 绑定应用内开关    :', passBug06 ? 'PASS' : 'FAIL');
console.log('   主进程层 + 授权公钥齐备且无私钥泄漏:', passElectron ? 'PASS' : 'FAIL');
console.log('   死产物清理（assets == 引用闭包）:', closureOk ? `PASS (${assetNames.length})` : `FAIL (assets ${assetNames.length} / 闭包 ${closure.size})`);
console.log('   解包目录无残留（目录 == asar）:', sameNames ? `PASS (${dirAssetNames.length})` : `FAIL (目录 ${dirAssetNames.length} / asar ${asarNamesSorted.length})`);
console.log(
  '   包与 exe 同批核对（asar 先于 exe，≤10min）:',
  exeBatch === 'pass' ? 'PASS' : exeBatch === 'fail' ? 'FAIL' : 'SKIP（未找到 Setup.exe，unpacked-only 合法）',
);
console.log('   打印锁浅色 .print-root 与亮色块同一选择器:', passPrint ? 'PASS' : 'FAIL');
console.log('   本结论对应产物                :', `${ASAR} @ ${stampOf(ASAR_MTIME)}`);
const allPass =
  passElectron && passBug05 && passBug06 && closureOk && sameNames && passPrint && exeBatch !== 'fail';
console.log('\n   总体:', allPass ? 'ALL PASS' : 'HAS FAILURE');
process.exitCode = allPass ? 0 : 1;
