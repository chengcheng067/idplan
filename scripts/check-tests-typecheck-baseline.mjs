#!/usr/bin/env node
/**
 * 测试类型检查**棘轮**（opt-in · **出包前**跑）：`tsconfig.tests.json` 的错误条数**只许降、不许涨**。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── 为什么需要它（起因是一条**真实被引入又无人拦**的错）──
 * ══════════════════════════════════════════════════════════════════════════════
 * `npm run typecheck:tests`（= `tsc --noEmit -p tsconfig.tests.json`）**不是合并硬闸**：
 * 它带着一批**既有债**（见下 BASELINE），于是任何时候它都是红的 ⇒ **红不再是信号**，
 * 任何人都不看它。2026-10-14 实测到的那一刻：有人往 `tests/plugin-registry.spec.ts`
 * 里写了 `ts.Node`（类型位置）却只用 `const ts = require('typescript')`（**值**绑定），
 * 一次引入 **2 条** `Cannot find namespace 'ts'`。这 2 条在有 96 条既有债的背景下
 * **完全不可见**：没人会为了 2 条新错去翻 96 条旧错的输出。
 *
 * ⇒ 修法不是「把 96 条一次清干净」（那是另一件事，且不属任何一条线），
 *   而是**把「不许涨」变成机器判据**：既有债冻结在 BASELINE，新增即非零退出。
 *   这是「数字棘轮」范式（同 `tests/i18n.spec.ts` 的 116 条棘轮）：**先冻结，再逐步降**。
 *
 * ── BASELINE 的纪律（改它之前先读这段）──
 *   · **只许变小**。修掉若干条之后，回本文件把 BASELINE 改成新的实测值（会写在同一行）。
 *   · **不许为了让脚本过而调大它**。调大 = 把「本轮新增的类型错」转成「基线的一部分」，
 *     等于这个脚本自废。若确实必须调大（例如团队决定引入一批新债），
 *     必须在同一个 commit 里写清「为什么这批新错是可接受的」。
 *   · 基线是**错误条数**（`error TS` 出现的行数），不是文件数。量法见下方「怎么量」。
 *
 * ── 怎么量（口径必须与脚本一致，否则基线不可复现）──
 *   `npx tsc --noEmit -p tsconfig.tests.json 2>&1 | grep -c "error TS"`
 *   （tsc 每条错都打一次 `error TS<四位码>:`，多行明细不带该标记 ⇒ 逐行计数即条数）
 *
 * ── 为什么**不进** `npm test`（这是刻意的代价取舍，不是漏了）──
 *   本脚本自身跑一次 tsc 要 **10–30 秒**（实测：冷启动更久）。`npm test` 是全仓每次跑批
 *   的入口，把它塞进去等于给**每一次**跑批加这个开销，而它防的是「**出包**前的类型债累积」——
 *   两件事的触发频率差三个数量级。⇒ 它属于 **release checklist**（见
 *   `docs/release-checklist.md`），由人在出包前显式跑；不进 `test` 脚本、不进 CI 默认集。
 *
 * ── 用法 ──
 *   node scripts/check-tests-typecheck-baseline.mjs          # 出包前跑
 *   node scripts/check-tests-typecheck-baseline.mjs --list   # 顺带列出全部错误行（默认只列前 20 条）
 *   node scripts/check-tests-typecheck-baseline.mjs --raw    # 只打印 tsc 原始输出（排障用）
 *
 * ── 退出码（三种，区分「超了」与「量不出来」）──
 *   0 = 未超过基线（含「已减到基线以下」，此时提示下调 BASELINE）
 *   1 = **超过基线**（= 本轮新增了类型错，必须修掉）
 *   2 = **量不出来**（tsc 没跑起来 / 输出不可解析 / 条数与退出码自相矛盾）——
 *       ⇒ 绝不把「量不出来」当成「0 条」。这类假绿正是本仓反复点名要堵的洞。
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ─────────────────────────────────────────────────────────────────────────────
 * ★ BASELINE：既有债的**冻结值**（只许变小；改前读文件头「BASELINE 的纪律」）
 *
 * 实测记录（每次下调请追加一行，便于后人看到下降轨迹）：
 *   2026-10-14  96 条   ← 首设。（设置线修 ⑩-b 那 2 条 `Cannot find namespace 'ts'`
 *                            之后实测；修之前是 98 条。涉及文件数在 41–42 之间浮动 ——
 *                            那只是「同一批错落在哪个文件」的呈现，**基线只锚条数**，别锚文件数，
 *                            否则别人一动文件边界就会误红。）
 * ──────────────────────────────────────────────────────────────────────────── */
const BASELINE = 96;

/** 超基线时最多打印多少条错误行（默认全列会把终端刷满，反而没人看） */
const SHOW_LIMIT_DEFAULT = 20;
const TS_CONFIG = 'tsconfig.tests.json';

const args = new Set(process.argv.slice(2));
const listAll = args.has('--list');
const rawOnly = args.has('--raw');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 跑 tsc 并取「错误条数 + 原始输出」。任何启动/解析异常都返回 measured:false。 */
function measure() {
  // 用 shell 调 npx：Windows 上是 npx.cmd，直接 spawn('npx') 会 ENOENT（本仓在 Windows 上开发）
  const res = spawnSync(`npx tsc --noEmit -p ${TS_CONFIG}`, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) return { measured: false, why: `tsc 启动失败：${res.error.message}` };
  if (res.status === null) return { measured: false, why: 'tsc 被信号中断（未拿到退出码）' };

  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const errorLines = out.split('\n').filter((l) => /error TS\d+/.test(l));
  const files = new Set(errorLines.map((l) => l.split('(')[0]));
  const count = errorLines.length;

  // 自相矛盾检查：tsc 无错误时退出码 0；有错误时退出码 2。据此判「量不出来」。
  if (count === 0 && res.status !== 0) {
    return {
      measured: false,
      why: `tsc 退出码 ${res.status} 但输出里没有任何 error TS 行（输出可能被截断/格式变了）`,
    };
  }
  if (count > 0 && res.status === 0) {
    return { measured: false, why: `输出里有 ${count} 条 error TS，但 tsc 退出码是 0（矛盾）` };
  }
  return { measured: true, count, fileCount: files.size, errorLines, raw: out };
}

const r = measure();

if (rawOnly) {
  if (!r.measured) {
    console.error(r.why);
    process.exit(2);
  }
  process.stdout.write(r.raw ?? '');
  process.exit(0);
}

if (!r.measured) {
  console.error(`\n❌ 量不出来：${r.why}`);
  console.error('   ⇒ 这**不是**「0 条错误」，棘轮结果无效。请先 `npm run typecheck:tests` 人工看一眼。');
  process.exit(2);
}

const { count, fileCount, errorLines } = r;
const delta = count - BASELINE;

if (delta > 0) {
  console.error(`\n❌ 当前 ${count} / 基线 ${BASELINE}（新增 ${delta} 条请修掉；基线只许降）`);
  console.error(`   涉及 ${fileCount} 个文件。前 ${Math.min(SHOW_LIMIT_DEFAULT, errorLines.length)} 条：`);
  for (const line of errorLines.slice(0, listAll ? errorLines.length : SHOW_LIMIT_DEFAULT)) {
    console.error(`   ${line}`);
  }
  if (!listAll && errorLines.length > SHOW_LIMIT_DEFAULT) {
    console.error(`   … 其余 ${errorLines.length - SHOW_LIMIT_DEFAULT} 条加 --list 看全`);
  }
  process.exit(1);
}

if (delta === 0) {
  console.log(
    `✅ 当前 ${count} / 基线 ${BASELINE}（持平：既有债未增未减，涉及 ${fileCount} 个文件）`,
  );
  process.exit(0);
}

console.log(
  `✅ 当前 ${count} / 基线 ${BASELINE}（已减到 ${count}，可下调基线：把本文件 BASELINE 改成 ${count}）`,
);
process.exit(0);
