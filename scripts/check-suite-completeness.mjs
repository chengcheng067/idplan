#!/usr/bin/env node
/**
 * 测试套件**完备性**判据（「报告的 spec 份数对不对得上」这道闸）。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── 为什么需要它（起因是一次「绿着绿着就没了」的跑批）──
 * ══════════════════════════════════════════════════════════════════════════════
 * 2026-10-15 实测：`npx vitest run --reporter=default --reporter=json
 * --outputFile.json=<path>` 在本仓**可复现段错误**，崩在 **158/244** 份 spec。
 * 崩溃前**零失败**、无堆栈，summary 与 JSON **都不落地** —— 一次「跑了一半」的跑批，
 * 在任何人眼里都长得和「全绿」一模一样：没有 ✗、没有 error、退出码之外毫无异常。
 * 如果没有「报告的 spec 份数 == 仓内 spec 份数」这道判据，这种跑批会被当成一次全绿。
 * **与本仓一直在抓的「假绿」是同一族**，所以这道闸按「门」的纪律做：
 *   · 结论行 `VERDICT: PASS` / `VERDICT: FAIL`；
 *   · 任一项不符 ⇒ 指名 + 期望 vs 实测 + 退出码 1；
 *   · 「量不出来」（文件不存在 / 解析不出 / 自相矛盾）⇒ 退出码 2，
 *     **绝不把「量不出来」当成「0 份」或「PASS」**。
 *
 * ── 它判什么 ──
 *   K1  spec 份数：报告里实际执行的 spec 份数 == 仓内 `tests` 下全部 `.spec.ts/.spec.tsx` 份数
 *       （口径同 vite.config.ts 的 test.include；仓内份数**脚本自己数**，不写死 244 ——
 *        写死就成了「只会认一个版本」的钝尺）
 *   K2  失败为零：报告里没有失败用例 / 失败 spec（stdout 模式下没有失败证据时判 OK，
 *       因为「没有失败证据」不等于「有失败」；截断跑批由 K1 拦）
 *   K3  跑批完整：没有「起了头没结尾」的 spec（stdout 的 `❯` 行没有对应的结果行）
 *   K4  自洽：stdout 有汇总行时，汇总的份数 == 逐行数出来的份数（防「汇总在、行被截」）
 *   K5  自洽：JSON 模式下 `numTotalTests` == 逐条 assertionResults 之和（防报告被动手脚）
 *
 * ── 输入（自动判别 JSON / stdout）──
 *   · vitest JSON 报告：`--reporter=json --outputFile=<path>` 或 `--outputFile.json=<path>` 的产物
 *     （⚠️ 后者在本仓会段错误，见文件头；要 JSON 请用 `--outputFile=` 不带键的形态）
 *   · stdout 捕获：默认 reporter 的终端输出（`2>&1 | tee x.stdout.txt`），ANSI 色码会自动剥
 *
 * ── 用法 ──
 *   node scripts/check-suite-completeness.mjs <报告.json 或 .stdout.txt>
 *
 *   怎么生成输入报告（可复跑）：
 *     # ① stdout 形态（默认 reporter，本仓 `npm test` 原样）：
 *     npx vitest run 2>&1 | tee /path/full.stdout.txt
 *     # ② JSON 形态（★ 用不带键的 --outputFile=，别用 --outputFile.json=）：
 *     npx vitest run --reporter=json --outputFile=/path/full.json
 *
 * ── 退出码 ──
 *   0 = VERDICT: PASS（份数对得上且无失败）
 *   1 = VERDICT: FAIL（份数不符 / 有失败 / 跑批被截 / 报告自相矛盾）
 *   2 = 量不出来（输入不存在、不是 vitest 报告、解析矛盾）—— 这不是 PASS
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = 'tests';
/** 与 vite.config.ts 的 test.include 一致（口径不许漂） */
const SPEC_RE = /\.spec\.tsx?$/;
/** 失败项最多列多少个（全列会把终端刷满，反而没人看） */
const SHOW_LIMIT = 20;

/* ─────────────────────────────────────────────────────────────────────────────
 * 仓内 spec 份数：自己数，不许写死。
 * 口径 = vite.config.ts `test.include`（tests 下所有 .spec.ts / .spec.tsx）。
 * ──────────────────────────────────────────────────────────────────────────── */
function countRepoSpecs() {
  const base = join(ROOT, SPEC_DIR);
  if (!existsSync(base)) return { ok: false, why: `${SPEC_DIR}/ 目录不存在（cwd 或 --root 不对？）` };
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (SPEC_RE.test(name)) files.push(relative(ROOT, p).split(sep).join('/'));
    }
  };
  walk(base);
  return { ok: true, files: files.sort() };
}

/** 剥 ANSI 色码（vitest 输出带色；管道到文件时部分行有色部分行没有，必须剥） */
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

/* ─────────────────────────────────────────────────────────────────────────────
 * 解析：JSON 报告
 * ──────────────────────────────────────────────────────────────────────────── */
/** JSON 报告里的 name 可能是绝对路径（实测：E:/…/changxia/tests/x.spec.ts）⇒ 归一成仓内相对路径 */
function normReportName(n) {
  let s = String(n ?? '').replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(s) || s.startsWith('/')) {
    try {
      s = relative(ROOT, resolve(s)).split(sep).join('/');
    } catch {
      /* 相对化失败就原样留着，K1 会把它算成「仓外文件」报出来 */
    }
  }
  return s;
}

function parseJsonReport(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    return null; // 不是 JSON ⇒ 交还给 stdout 解析
  }
  if (!j || typeof j !== 'object' || !Array.isArray(j.testResults)) {
    return { ok: false, why: 'JSON 解析成功但没有 testResults 数组 ⇒ 不是 vitest json 报告' };
  }
  const files = j.testResults.map((r) => normReportName(r.name));
  const perFileTests = j.testResults.reduce((n, r) => n + (Array.isArray(r.assertionResults) ? r.assertionResults.length : 0), 0);
  // 失败名单：status==='failed' 的文件，或任一用例失败的（双口径，宁可多认）
  const failedNames = j.testResults
    .filter((r) => r.status === 'failed' || (Array.isArray(r.assertionResults) && r.assertionResults.some((a) => a.status === 'failed')))
    .map((r) => normReportName(r.name));
  return {
    ok: true,
    mode: 'JSON',
    files,
    fileCount: files.length,
    tests: typeof j.numTotalTests === 'number' ? j.numTotalTests : perFileTests,
    perFileTests,
    failedTests: typeof j.numFailedTests === 'number' ? j.numFailedTests : null,
    failedSuites: typeof j.numFailedTestSuites === 'number' ? j.numFailedTestSuites : null,
    success: j.success === true,
    failedFiles: failedNames,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 解析：stdout（默认 reporter 的终端输出）
 *
 * 行形态（剥色后）：
 *   ✓ tests/xxx.spec.ts (18 tests) 6214ms        —— 完成且过
 *   × tests/xxx.spec.ts (5 tests | 2 failed) 1ms  —— 完成但有失败
 *   ❯ tests/xxx.spec.ts (18 tests)               —— 起了头、没有结果行（被截的记号）
 *   FAIL  tests/xxx.spec.ts > 套件名 …            —— Failed Suites 段（suite 级失败）
 *   stderr | tests/xxx.spec.ts                    —— 日志行，不是结果行（不认）
 *   Test Files  1 failed | 243 passed (244)       —— 汇总（被截的跑批没有这行）
 *   Tests  3791 passed (3791)
 * ──────────────────────────────────────────────────────────────────────────── */
function parseStdoutReport(text) {
  const clean = stripAnsi(text);
  const done = new Map();   // file -> { tests, failed }
  const started = new Set(); // ❯ 起了头的
  const failSection = new Set();
  let summaryFiles = null;
  let summaryTests = null;
  let summaryFailedFiles = null;

  const RESULT_RE = /^\s*[✓×❯]\s+(tests\/\S+\.spec\.tsx?)\s+\((\d+)\s+tests?([^)]*)\)/;
  const FAILSEC_RE = /^\s*FAIL\s+(tests\/\S+\.spec\.tsx?)\s*>/;
  const FILES_SUM_RE = /^\s*Test Files\s+(.+)\((\d+)\)\s*$/;
  const TESTS_SUM_RE = /^\s*Tests\s+(.+)\((\d+)\)\s*$/;

  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    let m = RESULT_RE.exec(line);
    if (m) {
      const [, file, n, tail] = m;
      const fm = /(\d+)\s+failed/.exec(tail);
      const failed = fm ? Number(fm[1]) : 0;
      if (line.trimStart().startsWith('❯')) started.add(file);
      else done.set(file, { tests: Number(n), failed });
      continue;
    }
    m = FAILSEC_RE.exec(line);
    if (m) {
      failSection.add(m[1]);
      continue;
    }
    m = FILES_SUM_RE.exec(line);
    if (m) {
      summaryFiles = Number(m[2]);
      const fm = /(\d+)\s+failed/.exec(m[1]);
      summaryFailedFiles = fm ? Number(fm[1]) : 0;
      continue;
    }
    m = TESTS_SUM_RE.exec(line);
    if (m) summaryTests = Number(m[2]);
  }

  const executed = new Set([...done.keys(), ...failSection]);
  const unfinished = [...started].filter((f) => !executed.has(f));
  const failedFromLines = [...done.entries()].filter(([, v]) => v.failed > 0);
  const perFileTestSum = [...done.values()].reduce((n, v) => n + v.tests, 0);

  return {
    ok: true,
    mode: 'stdout',
    files: [...executed],
    fileCount: executed.size,
    tests: summaryTests ?? perFileTestSum,
    perFileTestSum,
    failedFiles: [
      ...failedFromLines.map(([f, v]) => `${f}（${v.failed} 个用例失败）`),
      ...[...failSection].map((f) => `${f}（suite 级失败：Failed Suites 段）`),
    ],
    summaryFailedFiles,
    unfinished,
    summaryFiles,
    summaryTests,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 门：登记判据 → 汇总 → VERDICT → 退出码
 * ──────────────────────────────────────────────────────────────────────────── */
const checks = [];
function check(id, name, ok, expected = '', actual = '') {
  checks.push({ id, name, ok: !!ok, expected, actual });
  if (ok) {
    console.log(`  [OK  ] ${id} ${name}`);
  } else {
    console.log(`  [FAIL] ${id} ${name}`);
    if (expected) console.log(`           期望: ${expected}`);
    if (actual) console.log(`           实测: ${actual}`);
  }
}

const inputArg = process.argv[2];
if (!inputArg) {
  console.error('用法: node scripts/check-suite-completeness.mjs <vitest JSON 报告 | stdout 捕获>');
  console.error('  （输入不存在 / 解析不出 ⇒ 退出码 2，绝不当成 PASS）');
  process.exit(2);
}
const inputPath = resolve(process.cwd(), inputArg);
if (!existsSync(inputPath) || !statSync(inputPath).isFile()) {
  console.error(`❌ 量不出来：输入文件不存在或不是文件：${inputPath}`);
  console.error('   ⇒ 这**不是**「0 份 spec」。先确认报告路径。');
  process.exit(2);
}

console.log('='.repeat(78));
console.log('测试套件完备性判据（报告的 spec 份数对不对得上）');
console.log('='.repeat(78));
console.log('报告:', inputPath);
console.log('仓内 spec 口径:', `${SPEC_DIR}/**/*.spec.{ts,tsx}（脚本自数，不写死）`);

const repo = countRepoSpecs();
if (!repo.ok) {
  console.error(`❌ 量不出来：${repo.why}`);
  console.error('   ⇒ 这**不是**「0 份 spec」。请从仓库根运行，或先确认 tests/ 在。');
  process.exit(2);
}
const repoFiles = new Set(repo.files);
console.log('仓内 spec 份数:', repoFiles.size);

const text = readFileSync(inputPath, 'utf8');
const parsed = parseJsonReport(text) ?? parseStdoutReport(text);
if (!parsed || parsed.ok === false) {
  console.error(`❌ 量不出来：${parsed ? parsed.why : '既不是 vitest JSON 报告、也不是可解析的 stdout'}`);
  console.error('   ⇒ 这**不是**「0 份 spec」。先确认输入是一份完整的 vitest 报告。');
  process.exit(2);
}
// ★ 一份「什么 vitest 标记都没有」的输入（比如传错了文件）⇒ 量不出来，不是「0 份」。
//   判据：stdout 形态下既没有结果行、也没有汇总行、没有 Failed Suites 段、没有起了头的行。
if (
  parsed.mode === 'stdout' &&
  parsed.fileCount === 0 &&
  (parsed.summaryFiles === null || parsed.summaryFiles === undefined) &&
  parsed.failedFiles.length === 0 &&
  (parsed.unfinished ?? []).length === 0
) {
  console.error('❌ 量不出来：输入文件里没有任何 vitest 输出标记（结果行 / 汇总行 / Failed Suites 段）。');
  console.error('   ⇒ 这**不是**「0 份 spec」——大概是传错了文件。先确认输入是一份 vitest 跑批输出。');
  process.exit(2);
}
console.log('报告形态:', parsed.mode);
console.log('报告内实际执行 spec 份数:', parsed.fileCount);
console.log(
  '报告内用例数:',
  parsed.tests,
  parsed.mode === 'JSON'
    ? '（numTotalTests）'
    : parsed.summaryTests != null
      ? `（汇总值；逐行加总 ${parsed.perFileTestSum}）`
      : `（无汇总行，逐行加总）`,
);

const reportFiles = new Set(parsed.files);
const missing = repo.files.filter((f) => !reportFiles.has(f));   // 仓里有、报告里没有
const extra = [...reportFiles].filter((f) => !repoFiles.has(f)); // 报告里有、仓里没有

/* ── K1 份数（本判据的钱） ── */
check(
  'K1',
  '报告内实际执行的 spec 份数 == 仓内 spec 份数',
  parsed.fileCount === repoFiles.size && missing.length === 0 && extra.length === 0,
  `仓内 ${repoFiles.size} 份全部出现在报告里，且报告没有仓外文件`,
  `报告 ${parsed.fileCount} 份 / 仓内 ${repoFiles.size} 份` +
    (missing.length ? `；缺 ${missing.length} 份${missing.length <= SHOW_LIMIT ? `：${missing.join(', ')}` : `（前 ${SHOW_LIMIT}：${missing.slice(0, SHOW_LIMIT).join(', ')} …）`}` : '') +
    (extra.length ? `；多 ${extra.length} 份：${extra.slice(0, SHOW_LIMIT).join(', ')}` : ''),
);

/* ── K2 失败为零 ── */
const failedFiles = parsed.failedFiles ?? [];
check(
  'K2',
  '报告内没有失败用例 / 失败 spec',
  failedFiles.length === 0 && (parsed.summaryFailedFiles ?? 0) === 0 && parsed.success !== false,
  '失败 spec 0 份',
  failedFiles.length
    ? `失败 ${failedFiles.length} 份：${failedFiles.slice(0, SHOW_LIMIT).join('；')}${failedFiles.length > SHOW_LIMIT ? ' …' : ''}`
    : parsed.success === false
      ? 'JSON 报告 success=false'
      : '无失败证据（stdout 无 ✗/FAIL 段/汇总失败项；截断跑批由 K1 拦）',
);

/* ── K3 跑批完整（stdout 的 ❯ 起了头没结尾） ── */
check(
  'K3',
  '没有「起了头没结尾」的 spec（跑批没被截在半路）',
  (parsed.unfinished ?? []).length === 0,
  '每个 `❯` 行都有对应的结果行 / Failed Suites 记录',
  (parsed.unfinished ?? []).length
    ? `${parsed.unfinished.length} 份只有开始没有结果：${parsed.unfinished.slice(0, SHOW_LIMIT).join(', ')}`
    : '无（stdout 模式）／不适用（JSON 模式）',
);

/* ── K4 自洽：汇总份数 vs 逐行数出来的份数 ── */
check(
  'K4',
  'stdout 汇总的 spec 份数 == 逐行数出来的份数',
  parsed.summaryFiles === null || parsed.summaryFiles === undefined
    ? true
    : parsed.summaryFiles === parsed.fileCount,
  '汇总 (N) 与逐行计数一致',
  parsed.summaryFiles === null || parsed.summaryFiles === undefined
    ? '报告无汇总行（被截的跑批就是这样）⇒ 本项不适用，完备性由 K1 判'
    : `汇总 ${parsed.summaryFiles} vs 逐行 ${parsed.fileCount}`,
);

/* ── K5 自洽：JSON numTotalTests vs 逐条之和 ── */
check(
  'K5',
  'JSON 的 numTotalTests == 逐条 assertionResults 之和',
  parsed.mode !== 'JSON' || parsed.tests === parsed.perFileTests,
  'numTotalTests 与逐条加总一致',
  parsed.mode !== 'JSON'
    ? '不适用（stdout 模式）'
    : `numTotalTests=${parsed.tests} vs 逐条加总=${parsed.perFileTests}`,
);

/* ── 汇总 ── */
const failed = checks.filter((c) => !c.ok);
console.log('\n' + '='.repeat(78));
console.log(`汇总: 通过 ${checks.length - failed.length} 项 / 失败 ${failed.length} 项（共登记 ${checks.length} 项）`);
if (failed.length > 0) {
  console.log('失败项（指名 + 期望 vs 实测）:');
  for (const c of failed) {
    console.log(`  - [${c.id}] ${c.name}`);
    if (c.expected) console.log(`     期望: ${c.expected}`);
    if (c.actual) console.log(`     实测: ${c.actual}`);
  }
  console.log('VERDICT: FAIL');
  console.log('='.repeat(78));
  process.exit(1);
}
console.log('VERDICT: PASS');
console.log('='.repeat(78));
process.exit(0);
