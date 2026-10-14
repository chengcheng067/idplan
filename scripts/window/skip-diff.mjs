#!/usr/bin/env node
/**
 * 窗口第 5.6 步：逐用例 diff —— 「过期态被跳过的」必须**恰好等于**该轮 `CAN_RUN_FRESH` 门内的用例集合。
 *
 * 判据（team-lead `e078523` 定，**不依赖任何历史清单**）：
 *   ① `skipped(过期态) ⊆ passed(新鲜态)` —— 过期态跳过的每一条，新鲜态都真的跑了且通过；
 *   ② `skipped(过期态)` 的每一条，都落在**该轮**真机门内 —— 用**源码现场提取的门标题模式**判定，
 *      不是引用历史清单；
 *   ③ 过期态确实跳了（跳 0 条 ⇒ 没复现 ⇒ 不许声称「钉死」）；
 *   ④ 同一次跑的 **stdout 汇总**与 JSON 必须互相印证（防 json reporter 不吐被跳过用例）；
 *   ⑤ **逐文件用例数两侧必须相等** —— 这条**完全与用例名字无关**，是用来一眼看穿
 *      「名字随状态变」那类问题的基础判据。
 * 集合相等才算钉死。若 diff 出「过期态跳了、新鲜态也没跑」或「跳了但从源码看不出有门」
 * ⇒ **机制不是新鲜度门** ⇒ 停窗上报。
 *
 * ★★ 2026-10-14 窗口内修正（team-lead 批准）：**匹配键必须是状态不变量** ★★
 *   原来的匹配键直接用「文件 :: 用例全名」，但**有 5 条用例的名字本身随被测状态变化** ——
 *   它们的标题里插值了 `staleInputs()` 的判定结果（过期态是 `构建产物过期：<绝对路径清单> 比 build-dist 新`，
 *   新鲜态是 `构建产物新鲜`），而那串文字**就是被测量的那个状态**。
 *   ⇒ 同一个用例在两个状态下**有两个名字**，①b 便把它读成「过期态跳了、新鲜态不存在」的**误报**
 *     （实测 5 条：3 条走「过期态/无标记」、2 条走「过期态/新鲜态」两个分支；真实机制是成立的）。
 *   ⇒ 修法见下面的 `DYNAMIC_SEGMENTS`：比对前先把这些**动态段**剥掉再归一化空白。
 *   ⚠️ **两个分支都要剔**：只剔「过期」那半边会剩 2 条误报（实测踩过）。
 *   ⇒ 通用形态：**凡标题里插值了「被测状态」的用例都会踩这个坑**；将来再有新的插值段，
 *     往 `DYNAMIC_SEGMENTS` 里加一条即可（不要散落在各处写死字面量）。
 *
 * ⚠️ **不许硬编码 148**：它来自另一个 HEAD，且推导输入（_frozen-run-r2.txt）已随 2026-10-14
 *    的 qa-scratch 清空永久丢失 ⇒ 它是**期望不是判据**。实测 ≠ 148 先归因再判（英文线在加用例是正常的），
 *    差额**用用例名单 diff 归因，不用数字差解释**。
 *    可选的 `--expect=<清单>` 只作**逐文件计数对账**的附加检查，缺省不跑。
 *
 * ★ 本文件按同族第三面口径自查过（「『0』与『未知』在读数上必须可区分」）：堵掉了一个**假绿** ——
 *   「清单为空」+「过期态 0 跳过」时原来是两条检查双双空转通过（两个「什么都没量到」合成一个「✔ 钉死」）。
 *
 * 用法：
 *   node scripts/window/skip-diff.mjs \
 *     --stale=<仓外>/_skip-stale-step2.5.json --stale-stdout=<仓外>/_skip-stale-step2.5.txt \
 *     --fresh=<仓外>/_skip-fresh-step5.5.json --fresh-stdout=<仓外>/_skip-fresh-step5.5.txt \
 *     [--expect=scripts/window/gate-expected-93dc987.txt]
 * 退出码：0 = 钉死；1 = 判据失败（停窗上报）；2 = 读数不可信/输入缺失（也停窗上报）
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
/** 仓库根：向上找 `package.json` + `tests/` 双标记（搬目录不该改代码）。 */
function findRepoRoot() {
  let d = SCRIPT_DIR;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(d, 'package.json')) && existsSync(join(d, 'tests'))) return d;
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
const ROOT = findRepoRoot();
if (!ROOT) {
  console.log('★ 找不到仓库根 ⇒ 拒绝跑。');
  process.exit(2);
}
function findFrozen(name) {
  for (const p of [join(SCRIPT_DIR, name), join(ROOT, 'qa-scratch', name)]) {
    if (existsSync(p)) return p;
  }
  return null;
}

const has = (f) => process.argv.includes(f);
const arg = (k, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : dflt;
};
const STALE = arg('stale');
const STALE_STDOUT = arg('stale-stdout');
const FRESH = arg('fresh');
const FRESH_STDOUT = arg('fresh-stdout');
const EXPECT = has('--no-expect') ? null : (arg('expect', null) ?? findFrozen('gate-expected-93dc987.txt'));

for (const [k, p] of [
  ['--stale', STALE],
  ['--fresh', FRESH],
  ['--stale-stdout', STALE_STDOUT],
  ['--fresh-stdout', FRESH_STDOUT],
]) {
  if (!p || !existsSync(p)) {
    console.log(`★ 缺输入 ${k}：${p} ⇒ 读数不可信，停窗上报。`);
    process.exit(2);
  }
}

/**
 * ★ 需要从用例名字里**剔除的动态段**（匹配键必须是状态不变量）。
 *
 * 为什么要有这张表：`skipIf(!CAN_RUN_FRESH)` 的标题里如果插值了 `staleInputs()`
 * （即「被测的那个状态」本身），同一个用例在过期态/新鲜态下就是**两个名字**。
 * 不剔除 ⇒ 判据把「同名同一条」读成「两条不同的用例」⇒ ①b 误报。
 *
 * ⚠️ 别在别处再写死这一串字面量；新的插值段一律往这张表里加。
 * ⚠️ 括号形态不止一种，实测至少两种（ASCII 一层、全角两层），故用「起始括号 +
 *    `构建产物过期` + 任意内容 + `比 build-dist 新` + 连续的收括号」来吃，两种都覆盖。
 */
const DYNAMIC_SEGMENTS = [
  {
    why: '标题插值了 staleInputs() 的绝对路径清单（= 被测状态本身）—— 三元的「过期态」分支',
    re: /[(（]\s*构建产物过期[\s\S]*?比\s*build-dist\s*新\s*[)）]+/g,
  },
  {
    why: '同一个三元的「新鲜态」分支 —— 标题同样随状态变，只是取值不同（实测形态）',
    re: /[(（]\s*构建产物新鲜\s*[)）]+/g,
  },
];

/** 归一化：先剔掉全部动态段，再折叠空白 —— 结果才是「状态不变量」的匹配键。 */
function normalizeKey(s) {
  let out = String(s);
  for (const seg of DYNAMIC_SEGMENTS) out = out.replace(seg.re, '');
  return out.replace(/\s+/g, ' ').trim();
}

/** 把 vitest json 报告摊平成「文件 :: 用例全名（已归一化） → {status, ancestors, title, file}」 */
function flatten(path) {
  let rep;
  try {
    rep = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { m: new Map(), perFile: new Map(), total: 0, files: 0, why: 'JSON 解析失败：' + String(e.message).slice(0, 80) };
  }
  if (!Array.isArray(rep.testResults)) {
    return { m: new Map(), perFile: new Map(), total: 0, files: 0, why: '`testResults` 不是数组 ⇒ 报告形状不对' };
  }
  const m = new Map();
  const perFile = new Map(); // ★ 只数条数：与用例名字完全无关（判据⑤的输入）
  let total = 0;
  for (const file of rep.testResults) {
    const base = basename(String(file.name ?? ''));
    const arr = file.assertionResults;
    if (!Array.isArray(arr)) continue;
    perFile.set(base, (perFile.get(base) ?? 0) + arr.length);
    for (const a of arr) {
      const ancestors = a.ancestorTitles ?? [];
      const title = String(a.title ?? '');
      const full = a.fullName || [...ancestors, title].join(' > ');
      m.set(`${base} :: ${normalizeKey(full)}`, { status: String(a.status), ancestors, title, file: base });
      total += 1;
    }
  }
  return { m, perFile, total, files: rep.testResults.length, why: '' };
}

/** 从**源码现场**提取该文件的真机门标题模式（`${...}` 插值 ⇒ `.*`；用于判据②） */
function gatePatterns(base, cache) {
  if (cache.has(base)) return cache.get(base);
  let src = null;
  try {
    src = readFileSync(join(ROOT, 'tests', base), 'utf8');
  } catch {
    cache.set(base, null); // null = 读不到源码 ⇒ 未知
    return null;
  }
  const pats = [];
  const re = /^[ \t]*(?:describe|it|test)\.skipIf\([ \t]*!CAN_RUN(?:_FRESH)?[ \t]*\)[ \t]*\(\s*([`'"])([\s\S]*?)\1/gm;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[2];
    const esc = raw
      .split(/\$\{[^}]*\}/)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    pats.push({ src: `^${esc}$`, re: new RegExp(`^${esc}$`) });
  }
  cache.set(base, pats);
  return pats;
}

/** 从同一次跑的 stdout 里抠出汇总读数（独立于 JSON 的第二条读数） */
function summary(path) {
  const txt = readFileSync(path, 'utf8').replace(/\u001b\[[0-9;]*m/g, '');
  const line = (label) => txt.split(/\r?\n/).find((l) => l.trim().startsWith(label)) ?? '';
  const num = (l, re) => {
    const m = re.exec(l);
    return m ? Number(m[1]) : null;
  };
  const filesLine = line('Test Files');
  const testsLine = line('Tests');
  return {
    testsSkipped: num(testsLine, /(\d+)\s+skipped/),
    hasTestsLine: testsLine !== '',
    testsLine: testsLine.trim().slice(0, 120),
  };
}

const stale = flatten(STALE);
const fresh = flatten(FRESH);

// ★ 自证：解析出 0 行 ⇒ 别当「没有失败」，一律按红处理
if (stale.total === 0 || fresh.total === 0) {
  console.log(`★ 解析出 0 行（stale=${stale.total} / fresh=${fresh.total}）⇒ 按红处理，不许当通过。`);
  if (stale.why || fresh.why) console.log('   原因：', stale.why || fresh.why);
  process.exit(2);
}

const isSkip = (s) => s === 'skipped' || s === 'pending' || s === 'todo';
const staleSkip = [...stale.m].filter(([, v]) => isSkip(v.status));
const freshSkip = [...fresh.m].filter(([, v]) => isSkip(v.status));
const freshPass = new Set([...fresh.m].filter(([, v]) => v.status === 'passed').map(([k]) => k));

const sSum = summary(STALE_STDOUT);
const fSum = summary(FRESH_STDOUT);

console.log('=== 5.6 逐用例 diff ===');
console.log('过期态 JSON ：', stale.files, '文件 /', stale.total, '用例，其中 skipped =', staleSkip.length);
console.log('过期态 stdout：', sSum.testsLine || '★ 没找到 Tests 汇总行');
console.log('新鲜态 JSON ：', fresh.files, '文件 /', fresh.total, '用例，其中 skipped =', freshSkip.length);
console.log('新鲜态 stdout：', fSum.testsLine || '★ 没找到 Tests 汇总行');

let bad = 0;
let untrusted = 0;

// ── 检查 ④：两条独立读数互相印证 ───────────────────────────────────────────
if (!sSum.hasTestsLine || !fSum.hasTestsLine) {
  untrusted += 1;
  console.log('★ 检查④失败：stdout 里抓不到 Tests 汇总行 ⇒ 少了一条独立读数，不许单靠 JSON 下结论。');
} else {
  const sStd = sSum.testsSkipped ?? 0;
  const fStd = fSum.testsSkipped ?? 0;
  if (staleSkip.length !== sStd) {
    untrusted += 1;
    console.log(`★ 检查④失败：过期态 JSON 数出 ${staleSkip.length} 条跳过，stdout 报 ${sStd} 条 ⇒ **JSON 没把被跳过的用例吐全** ⇒ 集合比对不可信。`);
  } else {
    console.log(`检查④a ✔ 过期态两条读数一致（skipped = ${staleSkip.length}）`);
  }
  if (freshSkip.length !== fStd) {
    untrusted += 1;
    console.log(`★ 检查④失败：新鲜态 JSON 数出 ${freshSkip.length} 条跳过，stdout 报 ${fStd} 条 ⇒ 同上。`);
  } else {
    console.log(`检查④b ✔ 新鲜态两条读数一致（skipped = ${freshSkip.length}）`);
  }
}

// ── 检查 ①：新鲜态不许有跳过（第 5.5 步的硬判据） ──────────────────────────
if (freshSkip.length > 0 || (fSum.testsSkipped ?? 0) > 0) {
  bad += 1;
  console.log('★ 检查①失败：新鲜态仍有跳过 ⇒ **停窗上报 team-lead**，不许自行归类。例如：');
  for (const [k] of freshSkip.slice(0, 10)) console.log('   -', k);
} else {
  console.log('检查① ✔ 新鲜态 skipped = 0');
}

// ── 检查 ③：过期态必须真的跳了（否则「钉死」是空转） ────────────────────────
if (staleSkip.length === 0) {
  bad += 1;
  console.log('★ 检查③失败：过期态 skipped = 0 ⇒ 前提没复现（没跳就没有东西可钉）⇒ 不许下「钉死」结论。');
}

// ── 检查 ⑤：逐文件用例数两侧必须相等（**完全与用例名字无关**） ──────────────
//   ★ 这条是本次误报最直接的「一眼看穿」判据：名字会随状态变，**条数不会**。
const allFiles = [...new Set([...stale.perFile.keys(), ...fresh.perFile.keys()])].sort();
const countMismatch = allFiles.filter(
  (f) => (stale.perFile.get(f) ?? 0) !== (fresh.perFile.get(f) ?? 0),
);
if (stale.perFile.size === 0 || fresh.perFile.size === 0 || countMismatch.length > 0) {
  bad += 1;
  console.log('★ 检查⑤失败：逐文件用例数两侧不一致（或一侧为空）⇒ 用例集合变了，集合比对不成立 ⇒ 停窗上报。');
  for (const f of countMismatch.slice(0, 10)) {
    console.log('   -', f, '：过期态', stale.perFile.get(f) ?? 0, '条 / 新鲜态', fresh.perFile.get(f) ?? 0, '条');
  }
} else {
  console.log(`检查⑤ ✔ 逐文件用例数两侧完全一致（${allFiles.length} 文件 / 各 ${stale.total} 条），该判据不依赖用例名字`);
}

// ── 检查 ①b：过期态跳过的，新鲜态都真跑了并通过 ───────────────────────────
const notRunFresh = staleSkip.filter(([k]) => !freshPass.has(k));
if (notRunFresh.length > 0) {
  bad += 1;
  console.log('★ 检查①b失败：过期态跳过、但新鲜态**没跑或没通过**', notRunFresh.length, '条 ⇒ 机制不是新鲜度门 ⇒ 停窗上报。例如：');
  for (const [k, v] of notRunFresh.slice(0, 10)) {
    console.log('   -', k, '（新鲜态状态 =', fresh.m.get(k)?.status ?? '不存在', '）');
  }
} else if (staleSkip.length > 0) {
  console.log('检查①b ✔ 过期态跳过的', staleSkip.length, '条，在新鲜态全部 passed');
}

// ── 检查 ②：跳过的每一条都要落在**源码现场**认得出的门内（不用历史清单） ────
const cache = new Map();
const matched = [];
const unmatched = [];
const noSource = [];
for (const [k, v] of staleSkip) {
  const pats = gatePatterns(v.file, cache);
  if (pats === null) {
    noSource.push(k);
    continue;
  }
  const segs = [...v.ancestors, v.title];
  if (pats.some((p) => segs.some((s) => p.re.test(s)))) matched.push(k);
  else unmatched.push(k);
}
if (noSource.length > 0) {
  untrusted += 1;
  console.log('★ 检查②不可信：有', noSource.length, '条跳过的用例，其源码文件读不到 ⇒ 无法判定「有没有门」：');
  for (const k of noSource.slice(0, 10)) console.log('   -', k);
}
if (unmatched.length > 0) {
  bad += 1;
  console.log('★ 检查②失败：有', unmatched.length, '条跳过的用例，在**源码现场**里找不到对应的真机门 ⇒ 机制不是新鲜度门 ⇒ 停窗上报。例如：');
  for (const k of unmatched.slice(0, 10)) console.log('   -', k);
} else if (staleSkip.length > 0) {
  console.log(`检查② ✔ 过期态跳过的 ${matched.length} 条全部落在源码现场的 skipIf(!CAN_RUN…) 门内（未使用任何历史清单）`);
}

// ── 附加（可选）：与冻结门内清单逐文件对账 ─────────────────────────────────
if (EXPECT && existsSync(EXPECT)) {
  const expect = new Map();
  let parseErr = 0;
  for (const l of readFileSync(EXPECT, 'utf8').split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const [f, n] = t.split(/\s+/);
    const val = Number(n);
    if (!f || !Number.isFinite(val)) {
      parseErr += 1;
      continue;
    }
    expect.set(f, val);
  }
  const perFile = new Map();
  for (const [, v] of staleSkip) perFile.set(v.file, (perFile.get(v.file) ?? 0) + 1);
  const expectSum = [...expect.values()].reduce((a, b) => a + b, 0);
  console.log(`附加对账（冻结清单 ${EXPECT.slice(ROOT.length + 1).replace(/\\/g, '/')}）：${expect.size} 文件 / ${expectSum} 条`);
  if (parseErr > 0) {
    untrusted += 1;
    console.log('★ 附加对账不可信：清单有', parseErr, '行解析不出条数。');
  } else if (expect.size === 0 || expectSum === 0) {
    bad += 1;
    console.log('★ 附加对账失败：清单为空/合计为 0 ⇒ 逐文件比对会空转通过 ⇒ 判红（不许把「什么都没比」当「比过了」）。');
  } else {
    const wrong = [];
    for (const [f, n] of expect) if ((perFile.get(f) ?? 0) !== n) wrong.push(`${f}: 期望 ${n} 实得 ${perFile.get(f) ?? 0}`);
    const extra = [...perFile.keys()].filter((f) => !expect.has(f));
    if (wrong.length || extra.length) {
      bad += 1;
      console.log('★ 附加对账失败（注意：这是**期望**不是判据；先归因再判，差额用名单 diff 解释）：');
      for (const w of wrong) console.log('   -', w);
      for (const e of extra) console.log('   - 清单外的文件也跳了：', e, perFile.get(e), '条');
    } else {
      console.log('附加对账 ✔ 逐文件计数与冻结清单一致，无清单外文件');
    }
  }
} else {
  console.log('（未提供 --expect 清单，跳过附加的逐文件计数对账；判据①②③④⑤ 已独立成立）');
}

if (untrusted > 0) {
  console.log(`\n=== 结论：${untrusted} 项读数不可信 ⇒ 停窗上报，不许下任何结论 ===`);
  process.exit(2);
}
console.log(
  bad === 0
    ? `\n=== 结论：集合相等 ⇒ **钉死**（这 ${staleSkip.length} 条就是该轮产物新鲜度门吞掉的） ===`
    : `\n=== 结论：${bad} 项失败 ⇒ 不许下结论，停窗上报 ===`,
);
process.exit(bad === 0 ? 0 : 1);
