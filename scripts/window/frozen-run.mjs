#!/usr/bin/env node
/**
 * 出包冻结窗口 · 真机族跑批读数器
 * ⚠️ **事故后重建版**（2026-10-14）。原件 331 行随 qa-scratch 被清空而永久丢失，
 *    无法逐字复原 ⇒ 本版按**旧口径复刻**，但**旧的自证一条都不继承**，全部重跑。
 *    测量主体是 vitest 本身（单线程、44 文件 / 329 用例、集合冻结），本器只做**包裹与记录**，
 *    故 r1/r2 的时间读数仍与 93dc987 基线（568.84s / 565.94s）可比 —— 但这句话要写进读数，不能默认。
 *
 * 用法:
 *   node scripts/window/frozen-run.mjs --label=r1 [--baseline-wall=568 --baseline-scope="44files/329tests"]
 *   node scripts/window/frozen-run.mjs --dry --raw-fixture=<file> [--label=dry]   # 不跑批，只验解析器
 *
 * 开关:
 *   --label=<s>            轮次标签 ⇒ 输出落 <仓外读数目录>/_frozen-run-<s>.txt（**按轮次命名，不覆盖**）
 *   --out-dir=<dir>        改读数落点（默认 = <repo>/../deliverables/release-1.0.0.0009-窗口证据）
 *                          ★ 默认落**仓外**：既不在任何清理器的射程内，也**不脏工作树**（不破第 2 步判据）。
 *   --baseline-wall=<n>    同规模基线 wall-clock（秒）；只在 `--baseline-scope` 同时给出时生效
 *   --baseline-scope=<s>   该基线的**规模口径**（如 44files/329tests）—— 换集合即不可比，必须写明
 *   --touch-src-during     跑批**中途** touch src/main.tsx（验「产物过期」自检会不会报）
 *   --touch-tests-during   跑批**中途** touch 一个 tests/ 文件（验「代码代判据」会不会报）
 *   --allow-auto-family    基线缺失时**允许**退回自动发现（默认：**拒绝跑**）
 *   --archive-dir=<dir>    跑完再复制一份到该目录（默认落点已是仓外，此项通常不需要）
 *   --dry                  不 spawn vitest，用 --raw-fixture 的文本喂解析器
 *
 * 集合冻结（团队口径：跑批集合不许中途换）:
 *   冻结件查找顺序：本脚本所在目录 → qa-scratch/。找到 `browser-family-baseline-93dc987.txt` ⇒ **按它定集合**；
 *   找不到 ⇒ **拒绝跑**（自动发现会让族规模静默变化 ⇒ 与基线不可比），除非显式 --allow-auto-family。
 */
import { execSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
/** 仓库根：从脚本所在目录**向上找** `package.json` + `tests/` 双标记。
 *  不用 `resolve(SCRIPT_DIR,'..')` —— 脚本若从 qa-scratch/ 搬到 scripts/window/，
 *  那个写法会把「仓库根」算成 `scripts/`。搬文件不该改代码。 */
function findRepoRoot() {
  let d = SCRIPT_DIR;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(d, 'package.json')) && existsSync(join(d, 'tests'))) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  console.log('★ 找不到仓库根（向上 6 层没见到 package.json + tests/）⇒ 拒绝跑。');
  process.exit(2);
}
const ROOT = findRepoRoot();
/** 冻结件查找：先看**本脚本所在目录**（耐久落点），再看 qa-scratch（会被随时抹掉）。
 *  这样入库搬到 scripts/window/ 时只需搬文件，不用改代码。 */
function findFrozen(name) {
  for (const p of [join(SCRIPT_DIR, name), join(ROOT, 'qa-scratch', name)]) {
    if (existsSync(p)) return p;
  }
  return null;
}
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (k, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : dflt;
};

const LABEL = val('label', '');
const BASELINE_WALL = val('baseline-wall', '');
const BASELINE_SCOPE = val('baseline-scope', '');
const TOUCH_SRC_DURING = has('--touch-src-during');
const TOUCH_TESTS_DURING = has('--touch-tests-during');
const ALLOW_AUTO = has('--allow-auto-family');
const ARCHIVE_DIR = val('archive-dir', '');
const DRY = has('--dry');
const RAW_FIXTURE = val('raw-fixture', '');
const given = args.filter((a) => !a.startsWith('--'));

const OUT_DIR = val('out-dir', resolve(ROOT, '..', 'deliverables', 'release-1.0.0.0009-窗口证据'));
const OUT = join(OUT_DIR, `_frozen-run-${LABEL || 'nolabel'}.txt`);
const FAMILY_BASELINE = findFrozen('browser-family-baseline-93dc987.txt');

/* ── 集合：冻结 or 自动发现 ───────────────────────────────────────────── */
function browserFamily() {
  return readdirSync(join(ROOT, 'tests'))
    .filter((f) => /\.spec\.(ts|tsx)$/.test(f))
    .map((f) => join(ROOT, 'tests', f))
    .filter((p) => readFileSync(p, 'utf8').includes('playwright-core'))
    .map((p) => 'tests/' + p.split(/[\\/]/).pop())
    .sort();
}
function pinnedFamily() {
  const lines = readFileSync(FAMILY_BASELINE, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((l) => l && !l.startsWith('#'));
  const files = [];
  const counts = new Map();
  let tests = 0;
  for (const l of lines) {
    const m = /^(tests\/[a-z0-9-]+\.spec\.tsx?) \((\d+) tests?\)$/.exec(l);
    if (!m) {
      console.log('★ 基线文件有一行解析不出 ⇒ 集合冻结不可信，拒绝按它跑：', JSON.stringify(l));
      process.exit(2);
    }
    files.push(m[1]);
    counts.set(m[1].split('/').pop(), Number(m[2]));
    tests += Number(m[2]);
  }
  return { files, counts, tests };
}

/* ── 读数件 ───────────────────────────────────────────────────────────── */
function newestSrc() {
  let newest = 0;
  let who = '';
  const walk = (d) => {
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else {
        let m;
        try {
          m = statSync(f).mtimeMs;
        } catch {
          continue;
        }
        if (m > newest) {
          newest = m;
          who = f;
        }
      }
    }
  };
  for (const d of ['src', 'electron']) walk(join(ROOT, d));
  return { newest, who };
}
/** 过期输入数；产物不存在 ⇒ null（**未知**，不是 0） */
function staleInputCount() {
  const idx = join(ROOT, 'build-dist', 'index.html');
  if (!existsSync(idx)) return null;
  const dm = statSync(idx).mtimeMs;
  let n = 0;
  const walk = (d) => {
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else {
        try {
          if (statSync(f).mtimeMs > dm) n += 1;
        } catch {
          /* 读不到就不计，且由调用方看 null/异常 */
        }
      }
    }
  };
  for (const d of ['src', 'electron']) walk(join(ROOT, d));
  for (const f of ['index.html', 'vite.config.ts', 'tailwind.config.ts', 'postcss.config.js']) {
    const p = join(ROOT, f);
    try {
      if (statSync(p).mtimeMs > dm) n += 1;
    } catch {
      /* 缺文件不算过期 */
    }
  }
  return n;
}
function gitHead() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '(未知)';
  }
}
function mtimeSumUnder(dir) {
  // ★ 目录读不出来 ⇒ 返回 **null（未知）**，不是 0。否则「tests/ 整个不见了」会
  //   算成 0，而 0 === 0 会被读成「未变」——又一个「0 冒充查过」。
  const root = join(ROOT, dir);
  if (!existsSync(root)) return null;
  let s = 0;
  const walk = (d) => {
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else {
        try {
          s += statSync(f).mtimeMs;
        } catch {
          /* 读不到就不计 */
        }
      }
    }
  };
  try {
    readdirSync(root);
  } catch {
    return null;
  }
  walk(root);
  return Math.round(s);
}
/** 产物代（**内容判据**，不是 mtime）：index.html 的 blob 哈希 + assets 名称与大小 */
function artifactId() {
  const idx = join(ROOT, 'build-dist', 'index.html');
  if (!existsSync(idx)) return '(产物不存在)';
  let blob = '(未知)';
  try {
    blob = execSync(`git hash-object "${idx}"`, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    /* 保持未知 */
  }
  let assets = '';
  const dir = join(ROOT, 'build-dist', 'assets');
  try {
    assets = readdirSync(dir)
      .map((n) => {
        try {
          return `${n}:${statSync(join(dir, n)).size}`;
        } catch {
          return `${n}:?`;
        }
      })
      .sort()
      .join(' | ');
  } catch {
    assets = '(assets 目录不存在)';
  }
  return `${blob} ‖ ${assets}`;
}
function otherVitest() {
  // wmic 不可用；PowerShell Get-CimInstance 实测可用。查不到 ⇒ -1 = **未知**，绝不当 0。
  try {
    const ps = 'power' + 'shell';
    const out = execSync(
      `${ps} -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Select-Object -ExpandProperty CommandLine"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const lines = out.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) return -1; // node.exe 至少有一个（本进程）⇒ 空输出 = 量不出来
    return lines.filter((l) => l.includes('vitest') && !l.includes('frozen-run')).length;
  } catch {
    return -1;
  }
}

/* ── 解析器（--dry 也能验） ───────────────────────────────────────────── */
function parseRaw(raw) {
  const clean = raw.replace(/\u001b\[[0-9;]*m/g, '');
  const lines = clean.split(/\r?\n/);
  const p = { files: null, tests: null, perFile: [], rows: 0 };
  for (const l of lines) {
    const t = l.trim();
    if (t.startsWith('Test Files')) {
      p.files = { passed: g(t, /(\d+)\s+passed/), skipped: g(t, /(\d+)\s+skipped/), failed: g(t, /(\d+)\s+failed/), total: g(t, /\((\d+)\)/) };
    } else if (t.startsWith('Tests')) {
      p.tests = { passed: g(t, /(\d+)\s+passed/), skipped: g(t, /(\d+)\s+skipped/), failed: g(t, /(\d+)\s+failed/), total: g(t, /\((\d+)\)/) };
    }
    const m = /^[✓✗×]\s+(tests\/[a-z0-9-]+\.spec\.tsx?)\s+\((\d+) tests?\)\s+(\d+)ms/.exec(t);
    if (m) {
      p.perFile.push({ file: m[1].split('/').pop(), tests: Number(m[2]), ms: Number(m[3]) });
      p.rows += 1;
    }
  }
  p.dur = (clean.match(/Duration\s+([0-9.]+)s/) || [])[1] ?? null;
  return p;
}
function g(s, re) {
  const m = re.exec(s);
  return m ? Number(m[1]) : 0;
}

/* ── 主流程 ───────────────────────────────────────────────────────────── */
const pinned = FAMILY_BASELINE ? pinnedFamily() : null;
if (!pinned && !ALLOW_AUTO && given.length === 0 && !DRY) {
  console.log('★ 集合冻结文件缺失 ⇒ **拒绝跑**（自动发现会让族规模静默变化，读数与基线不可比）。');
  console.log('   若确实要临时用自动发现，加 --allow-auto-family（并会在读数里标注「集合未冻结」）。');
  process.exit(2);
}
const specs = given.length > 0 ? given : pinned ? pinned.files : browserFamily();

console.log('=== 跑前 ===');
console.log('读数器版本 = 事故后重建版（2026-10-14）');
console.log('族规模 =', specs.length, '个文件', pinned && !given.length ? '（集合已冻结）' : given.length ? '（显式给定）' : '★ 集合未冻结：自动发现');
if (pinned) {
  const rel = FAMILY_BASELINE.slice(ROOT.length + 1).split('\\').join('/');
  console.log('集合出处 =', rel, '｜基线期望 =', pinned.tests, '条用例');
  const disk = browserFamily();
  const pinSet = new Set(pinned.files);
  const added = disk.filter((f) => !pinSet.has(f));
  const gone = pinned.files.filter((f) => !disk.includes(f));
  if (added.length || gone.length) {
    console.log('★ 磁盘实测族与冻结集合不一致（**按冻结集合跑**，下列文件不并入/不计入）：');
    if (added.length) console.log('   磁盘新增（未并入）：', added.join(', '));
    if (gone.length) console.log('   基线有但磁盘已无：', gone.join(', '));
  } else {
    console.log('磁盘实测族与冻结集合逐文件一致 =', disk.length, '个文件');
  }
  if (specs.length !== 44 || pinned.tests !== 329) {
    console.log('★ 族规模/用例数与基线不符 ⇒ 本读数**不可**与 93dc987 基线比较：', specs.length, '/', pinned.tests);
  }
}
const before = newestSrc();
const artifactBefore = artifactId();
const headBefore = gitHead();
const testsSumBefore = mtimeSumUnder('tests');
const staleBefore = staleInputCount();
const others = otherVitest();
console.log('src 最新 mtime =', before.newest ? new Date(before.newest).toISOString() : '(未知)', before.who.split(/[\\/]/).pop());
console.log('过期输入计数（跑前）=', staleBefore === null ? '未知（产物不存在）' : staleBefore);
console.log('其它 vitest 进程 =', others < 0 ? '未知（查不到）' : others, others > 0 ? '★ 有并跑 ⇒ 读数不可比' : '');
console.log('代码代（跑前）HEAD =', headBefore, '｜ tests mtime 合计 =', testsSumBefore);
console.log('产物代（跑前）=', artifactBefore);

let raw = '';
let wallTotal = 0;
let exitCode = 0;
if (DRY) {
  raw = readFileSync(RAW_FIXTURE, 'utf8');
  console.log('【--dry】不 spawn vitest，用夹具喂解析器：', RAW_FIXTURE);
} else {
  const t0 = Date.now();
  const child = spawn('npx', ['vitest', 'run', ...specs], { cwd: ROOT, shell: true });
  child.stdout.on('data', (b) => (raw += b.toString()));
  child.stderr.on('data', (b) => (raw += b.toString()));
  if (TOUCH_SRC_DURING) {
    setTimeout(() => {
      const f = join(ROOT, 'src', 'main.tsx');
      const now = new Date();
      try {
        utimesSync(f, now, now);
        console.log('[probe] 跑批中途 touch src/main.tsx（验「产物过期」自检）');
      } catch {
        console.log('[probe] touch src/main.tsx 失败');
      }
    }, 1200);
  }
  if (TOUCH_TESTS_DURING) {
    setTimeout(() => {
      const f = join(ROOT, 'tests', 'calendar-anchor.spec.ts');
      const now = new Date();
      try {
        utimesSync(f, now, now);
        console.log('[probe] 跑批中途 touch tests/calendar-anchor.spec.ts（验「代码代判据」）');
      } catch {
        console.log('[probe] touch tests 失败');
      }
    }, 1200);
  }
  exitCode = await new Promise((r) => child.on('close', (c) => r(c)));
  wallTotal = Date.now() - t0;
  try {
    mkdirSync(OUT_DIR, { recursive: true });
  } catch {
    console.log('★ 读数目录建不出来：', OUT_DIR);
  }
  if (existsSync(OUT)) rmSync(OUT);
  writeFileSync(OUT, raw, 'utf8');
}

const p = parseRaw(raw);
console.log('\n=== 读数 ===');
if (p.rows === 0) {
  console.log('★ 解析出 0 行逐文件结果 ⇒ **别当「没有失败」**，先查跑批是不是根本没起来。');
}
console.log('文件维：passed =', p.files?.passed ?? '?', '；skipped =', p.files?.skipped ?? '?', '（**单独报，不许并进 passed**）；failed =', p.files?.failed ?? '?', '；total =', p.files?.total ?? '?');
console.log('用例维（口径：徽章取 passed）：passed =', p.tests?.passed ?? '?', '；skipped =', p.tests?.skipped ?? '?', '（**单独报**）；failed =', p.tests?.failed ?? '?', '；total =', p.tests?.total ?? '?');
if (p.tests) {
  const sum = p.tests.passed + p.tests.skipped + p.tests.failed;
  console.log(`（自洽核对：passed + skipped + failed = ${sum}，应等于 total ${p.tests.total} ⇒ ${sum === p.tests.total ? '✔' : '✘ 不自洽，按红处理'}）`);
}
console.log('vitest 自报 Duration =', p.dur === null ? '?' : `${p.dur}s`, '｜ 本器 wall-clock =', DRY ? '(dry)' : `${(wallTotal / 1000).toFixed(2)}s`);

if (p.perFile.length > 0) {
  console.log('\n=== 逐文件 wall-clock（降序）===');
  const sorted = [...p.perFile].sort((a, b) => b.ms - a.ms);
  for (const r of sorted) console.log(`   ${String(r.ms).padStart(6)}ms  ${String(r.tests).padStart(3)} 例  ${r.file}`);
  console.log(`   合计 ${p.perFile.reduce((a, b) => a + b.ms, 0)}ms，${p.perFile.length} 个文件`);
}

// ★ 用本轮读数复核冻结基线的逐文件用例数（事故后重建的 44 个数字靠这一步转正）
if (pinned && p.perFile.length > 0) {
  const mism = p.perFile.filter((r) => pinned.counts.get(r.file) !== undefined && pinned.counts.get(r.file) !== r.tests);
  const missing = p.perFile.filter((r) => pinned.counts.get(r.file) === undefined);
  // ★ 只有**基线里每个文件都出现在本轮结果里且逐个相符**，才配说「已现场复核通过」。
  //   （否则「只出现了 3 个文件、3 个都对」会被读成整份基线都验过了 —— 这是同一族假绿。）
  const absent = pinned.files.filter((f) => !p.perFile.some((r) => `tests/${r.file}` === f));
  if (mism.length) {
    console.log('\n★ **冻结基线的逐文件用例数与本轮不符**（重建版基线用的是事故前留档，必须当场纠正）：');
    for (const m of mism) console.log(`   - ${m.file}: 基线 ${pinned.counts.get(m.file)} 实得 ${m.tests}`);
  } else if (absent.length === 0 && missing.length === 0) {
    console.log('\n✔ 冻结基线 44 个文件全部出现在本轮结果里、且逐文件用例数相符 ⇒ 事故后重建的数字**已现场复核通过**。');
  } else {
    console.log(`\n★ 本轮结果不足以复核整份基线：缺 ${absent.length} 个基线文件、${missing.length} 个基线外文件。`);
    if (absent.length) console.log('   未出现的基线文件：', absent.slice(0, 8).join(', '), absent.length > 8 ? '…' : '');
    if (missing.length) console.log('   基线外的文件（集合漂移？）：', missing.map((m) => m.file).join(', '));
  }
  if (specs.length === 44 && pinned.tests !== 329) console.log('★ 基线合计不是 329 ⇒ 基线可能被改过，报 team-lead。');
}

console.log('\n=== 跑后 ===');
const after = newestSrc();
const staleAfter = staleInputCount();
const testsSumAfter = mtimeSumUnder('tests');
const artifactAfter = artifactId();
const headAfter = gitHead();
console.log('退出码 =', DRY ? '(dry)' : exitCode);
console.log('src 最新 mtime =', new Date(after.newest).toISOString(), after.who.split(/[\\/]/).pop(), after.newest !== before.newest ? '★ 变了（跑批期间有人改 src）' : '未变');
console.log('过期输入计数（跑后）=', staleAfter === null ? '未知' : staleAfter, staleAfter !== staleBefore ? '★ 变了' : '未变');
console.log('代码代（跑后）HEAD =', headAfter, headAfter !== headBefore ? '★ HEAD 变了（跑批期间有人提交）' : '未变');
console.log('tests mtime 合计 =', testsSumAfter === null ? '未知（tests/ 读不出来）' : testsSumAfter, testsSumAfter !== testsSumBefore ? '★ 变了（跑批期间有人改 tests）' : '未变');
console.log('产物代（跑后）=', artifactAfter);
// ★ 产物代的「变没变」只有在两侧都**真的量到了**才算结论：
//   两侧都是「(未知) / 产物不存在」时字符串相等，会被误读成「✔ 未变」。这是同一族假绿。
const artOk = (v) => !v.includes('(未知)') && !v.includes('产物不存在');
if (!artOk(artifactBefore) || !artOk(artifactAfter)) {
  console.log('★ ARTIFACT 判不了：产物代含「未知/不存在」⇒ 本轮**不许**声称「产物未变」，按不可信处理。');
} else {
  console.log(artifactAfter === artifactBefore ? '✔ ARTIFACT_UNCHANGED（产物代未变）' : '★ ARTIFACT_CHANGED ⇒ **该轮作废、不出结论**（环境破坏类，不进 flaky 清单）');
}

if (BASELINE_WALL && BASELINE_SCOPE) {
  const ratio = wallTotal / 1000 / Number(BASELINE_WALL);
  console.log(`同规模基线比对：基线 ${BASELINE_WALL}s（口径 ${BASELINE_SCOPE}）｜本轮 ${(wallTotal / 1000).toFixed(2)}s｜比 = ${ratio.toFixed(2)}×${ratio > 1.5 ? ' ★ >1.5× ⇒ 疑似争用' : ''}`);
} else if (BASELINE_WALL || BASELINE_SCOPE) {
  console.log('★ --baseline-wall 与 --baseline-scope 必须同时给（换集合即不可比），本次**不比**。');
}

if (!DRY) console.log('\n原始读数已落盘（按轮次命名，不覆盖）：', OUT.replace(ROOT, '.'));

if (ARCHIVE_DIR) {
  try {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
    const dst = join(ARCHIVE_DIR, `_frozen-run-${LABEL || 'nolabel'}.txt`);
    copyFileSync(OUT, dst);
    const sum = [
      `label=${LABEL}`,
      `reader=事故后重建版`,
      `head=${headBefore}`,
      `files=${JSON.stringify(p.files)}`,
      `tests=${JSON.stringify(p.tests)}`,
      `wall_ms=${wallTotal}`,
      `artifact_before=${artifactBefore}`,
      `artifact_after=${artifactAfter}`,
      `artifact_changed=${artifactAfter !== artifactBefore}`,
    ].join('\n');
    writeFileSync(join(ARCHIVE_DIR, `_frozen-run-${LABEL || 'nolabel'}.summary.txt`), sum, 'utf8');
    console.log('已归档到耐久落点：', ARCHIVE_DIR);
  } catch (e) {
    console.log('★ 归档失败（不改结论，但要报）：', String(e.message).slice(0, 120));
  }
}
process.exit(DRY ? 0 : exitCode);
