#!/usr/bin/env node
/**
 * 还原基线守卫（**共用小工具**）：把「变异/跑批之后源码确实还原了」做成**机械判据**，
 * 而不是每次靠人肉三查（`git status` + `git diff` + `hash-object`）。
 *
 * ── 为什么需要它（真实事故）──
 * 2026-10-14：一次手工变异在「报完空闲」之后**仍留在工作树上**（18 行），
 * 差点污染另一条线的表征窗口（那轮读数最后被判作废）。当时我做过人肉三查，
 * 但它**在流程上不是强制的** —— 只要有一次忘了，就会静默留在树上，
 * 而下一个人看到的是一个「说不清来源的 18 行」。
 * ⇒ 人肉三查**不是机制**；机制是：**起跑记基线 → 收尾自动复核 → 有差异就非零退出**。
 *
/**
 * ★ 观测窗口（必须知道，否则会把「判据不报」误读成「判据坏了」）
 *   判据比较的是 **`beginRestoreGuard()` 那一刻的工作树**。⇒ 起跑**之前**就已经存在的改动
 *   **不在窗口内**（它被记进基线，收尾时与基线相同 ⇒ 不报）。所以：
 *     · **反例（故意不还原）必须落在 `begin` 之后**，否则判据不报 —— 那不是判据坏了，是你把反例
 *       放在了观测窗口之外；
 *     · 反过来，这也正是本工具的**设计意图**：它只对「**本轮造成的**改动」负责，
 *       不去指控「起跑前就有的脏条目」（在共享工作树上，后者不是本轮的账）。
 *
 * ★ 证据形态：本工具**把两串哈希都打印出来**（基线 / 现在 / 以及 HEAD），而不是只打印
 *   「一致 / 不一致」—— 这样复核者可以直接拿两串去重跑比对，**不需要任何人复述哈希**。
 *   （2026-10-14 教训：一次报告里手打复述的 40 位哈希少了两个字符，那句话当场变成死证据。
 *   凡是「逐字一致」这类断言，引用的证据串必须能被人拿去重跑一遍就得到同样结果。）
 *
 * ── 与 `verify-test-discriminative.mjs` 的关系（一处机制，不留两套）──
 * 那个脚本原来自己用 `git diff --quiet` 做收尾断言（它的硬约束 ③）。本工具是**同一个判据的
 * 推广形态**：它多了三样东西 → ① 记**起跑时的脏条目快照**（区分「我造成的」与「本来就有的」）；
 * ② 逐文件记 **blob 哈希**（能指名到文件，而不是只说「有差异」）；③ 状态落**轮次/标签命名的路径**
 * （见头注释「证据落点」）。该脚本已改为**调用本工具**做收尾断言。
 *
 * ★ 证据落点（2026-10-14 口径）：**会被覆盖的路径上的产物不是证据。**
 *   本工具的状态文件写在 `qa-scratch/restore-guard/<label>-<时间戳>.json`（轮次/标签命名、
 *   且 `qa-scratch/` 在 .gitignore 内 ⇒ 不会把工作树弄脏）。**别改成固定文件名** ——
 *   固定路径的产物只能当「当前状态」，不能当「历史证据」。
 *
 * ── 用法 ──
 *   # 脚本内（推荐）：见 `verify-test-discriminative.mjs` 的收尾断言接线
 *   import { beginRestoreGuard, endRestoreGuard } from './lib/restore-guard.mjs';
 *   const guard = beginRestoreGuard({ label: 'my-mutation', paths: ['src/x.ts'] });
 *   …
 *   const r = endRestoreGuard(guard);          // 无论成败都要调到（放 finally / 信号处理里）
 *   if (!r.ok) process.exitCode = 2;
 *
 *   # 手工变异会话（CLI；起跑一次、收尾一次）
 *   node scripts/lib/restore-guard.mjs begin --label=m4 --paths=src/a.ts,src/b.ts
 *     → 打印状态文件路径（后续 end 用它）
 *   node scripts/lib/restore-guard.mjs end --state=qa-scratch/restore-guard/m4-….json
 *     → 有未还原改动：**醒目红** + 指名文件 + 退出码 2；无差异：退出码 0
 *
 * ── 退出码（CLI）──
 *   0 = 复核通过   2 = 检测到**本轮未还原**的改动（指名文件）   3 = 用法错误/状态文件不可读
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_DIR = join(REPO_ROOT, 'qa-scratch', 'restore-guard');

/** 跑一条 git 命令并取 stdout（失败返回 null，不抛） */
function git(args, root) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

/** `git status --porcelain` 的逐行快照（已排序；空数组 = 干净） */
function dirtySnapshot(root) {
  const out = git(['status', '--porcelain'], root);
  if (out === null) return null; // 不是 git 树 ⇒ 让调用方拒绝
  return out
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .sort();
}

/** 工作树里该路径的 blob 哈希（取不到内容 = null，例如文件被删） */
function worktreeBlob(path, root) {
  const h = git(['hash-object', '--', path], root);
  return h === null ? null : h.trim();
}

/** HEAD 里该路径的 blob 哈希（HEAD 或路径不存在 = null） */
function headBlob(path, root) {
  const h = git(['rev-parse', `HEAD:${path}`], root);
  return h === null ? null : h.trim();
}

/**
 * 起跑：记下**还原基线**。
 * @param {{ label: string, paths?: string[], root?: string }} opts
 *   · label：本轮的名字（进状态文件名，便于事后追溯；**不要用固定名**）
 *   · paths：本轮**将要被改**的文件（逐文件记 blob 哈希；不传则只做「脏条目差集」判据）
 * @returns {{ label: string, root: string, statePath: string, dirty: string[], files: Record<string, {head: string|null, worktree: string|null}>, startedAt: string }}
 */
export function beginRestoreGuard({ label, paths = [], root = REPO_ROOT, stateDir = STATE_DIR }) {
  const dirty = dirtySnapshot(root);
  if (dirty === null) {
    throw new Error(`[restore-guard] 不是 git 工作树，无法记基线：${root}`);
  }
  const files = {};
  for (const p of paths) {
    files[p] = { head: headBlob(p, root), worktree: worktreeBlob(p, root) };
  }
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, '-').slice(0, 19);
  mkdirSync(stateDir, { recursive: true });
  const statePath = join(stateDir, `${label}-${stamp}.json`);
  const state = { label, root, statePath, dirty, files, startedAt, paths };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state;
}

const RED = '\u001b[31m';
const BOLD = '\u001b[1m';
const RESET = '\u001b[0m';

/**
 * 收尾：**无论成败**都要调到。复核「工作树相对基线有没有多出本轮造成的改动」。
 * @param {ReturnType<typeof beginRestoreGuard>} state
 * @returns {{ ok: boolean, addedDirty: string[], hashMismatch: Array<{path: string, expected: string|null, actual: string|null}>, missing: string[], statePath: string }}
 */
export function endRestoreGuard(state) {
  const { root, files, dirty: baselineDirty, paths = Object.keys(files) } = state;

  const now = dirtySnapshot(root);
  const missing = now === null ? [`无法读取工作树状态（不是 git 树？）：${root}`] : [];

  // 判据 A：**新增的脏条目**（现状 − 基线）
  const baseSet = new Set(baselineDirty);
  const addedDirty = (now ?? []).filter((l) => !baseSet.has(l));

  // 判据 B：本轮**点名要改**的文件，内容是否回到基线
  const hashMismatch = [];
  for (const p of paths) {
    const expected = files[p]?.worktree ?? null;
    const actual = worktreeBlob(p, root);
    if (actual !== expected) hashMismatch.push({ path: p, expected, actual, head: files[p]?.head ?? null });
  }

  const ok = missing.length === 0 && addedDirty.length === 0 && hashMismatch.length === 0;

  if (!ok) {
    console.error(`${RED}${BOLD}!! [restore-guard] 本轮「${state.label}」收尾复核**未通过** —— 工作树相对起跑基线多出了改动：${RESET}`);
    for (const m of missing) console.error(`${RED}   · ${m}${RESET}`);
    for (const l of addedDirty) {
      console.error(`${RED}   · 新增脏条目：${l}${RESET}`);
    }
    for (const m of hashMismatch) {
      console.error(
        `${RED}   · 文件内容与基线不一致：${m.path}${RESET}\n` +
          `${RED}       基线(起跑时工作树) = ${m.expected ?? '<无>'}${RESET}\n` +
          `${RED}       现在               = ${m.actual ?? '<无>'}${RESET}\n` +
          `${RED}       （HEAD 版本 = ${m.head ?? '<无>'}）${RESET}`,
      );
    }
    console.error(
      `${RED}   ⇒ 这就是「变异忘了还原」的形态。请先还原这些文件，再重跑；${RESET}\n` +
        `${RED}     基线快照：${state.statePath}${RESET}`,
    );
  } else {
    console.log(`[restore-guard] ✅ 收尾复核通过（${state.label}）：工作树相对基线无新增改动。`);
    console.log(`[restore-guard] 基线快照（留档、轮次命名）：${state.statePath}`);
  }
  return { ok, addedDirty, hashMismatch, missing, statePath: state.statePath };
}

/* ============================================================================================
 * CLI（给**手工变异会话**用：起跑 begin → 收尾 end）
 * ============================================================================================ */
function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
    else out._.push(a);
  }
  return out;
}

function cliMain() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  const root = args.root ? resolve(args.root) : REPO_ROOT;

  if (cmd === 'begin') {
    const label = typeof args.label === 'string' ? args.label : null;
    if (!label) {
      console.error('用法：node scripts/lib/restore-guard.mjs begin --label=<标签> [--paths=a,b] [--root=<dir>]');
      return 3;
    }
    const paths = typeof args.paths === 'string' && args.paths.length > 0 ? args.paths.split(',').map((s) => s.trim()) : [];
    const state = beginRestoreGuard({ label, paths, root });
    console.log(state.statePath); // 只打印路径，便于 `$( )` 接续
    return 0;
  }

  if (cmd === 'end') {
    const statePath = typeof args.state === 'string' ? resolve(root, args.state) : null;
    if (!statePath || !existsSync(statePath)) {
      console.error(`!! 找不到状态文件：${statePath ?? '<未提供 --state=…>'}（先跑 begin）`);
      return 3;
    }
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const r = endRestoreGuard(state);
    return r.ok ? 0 : 2;
  }

  console.error('用法：node scripts/lib/restore-guard.mjs <begin|end> …（详见本文件头注释）');
  return 3;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(cliMain());
}
